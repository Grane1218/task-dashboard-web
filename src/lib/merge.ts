import type { ReminderSettings, Task, Theme } from '../types';
import type { CompletionMap, HabitReminderSettings, TaskTemplate } from '../types/habit';
import type { CloudSettings, CloudSnapshot } from './cloud';
import { pendingDeletions, type OutboxEntry } from './syncQueue';

/**
 * 本地数据与云端快照的合并（修复「hydrate 全量覆盖导致本地较新改动丢失」）。
 *
 * 规则：
 * 1. 同一 id 双方都有 → 取 updatedAt 较大者（last-write-wins），本地更新则把本地版本回推云端。
 * 2. 本地独有：
 *    - 在写队列里（离线期间的新建/修改）→ 保留并补推；
 *    - 云端整体为空（首次迁移）→ 保留并补推；
 *    - 否则视为「其他设备已删除」→ 丢弃。
 * 3. 云端独有 → 采用云端版本。
 * 4. 写队列中的删除（tombstone）优先级最高，合并结果里一定被删除。
 * 5. 打卡记录按日期取并集（只保留仍然存在的习惯 id），写队列中的日期以队列值为准。
 * 6. 设置项：本地有未同步修改则以本地为准，否则以云端为准（云端是权威源）。
 */

export interface LocalData {
  tasks: Task[];
  templates: TaskTemplate[];
  completions: CompletionMap;
  taskReminder: ReminderSettings;
  habitReminder: HabitReminderSettings;
  theme: Theme;
}

export interface MergeOutcome {
  tasks: Task[];
  templates: TaskTemplate[];
  completions: CompletionMap;
  settings: CloudSettings;
  /** 合并后需要回推云端的条目（不含写队列里已有的） */
  push: {
    tasks: Task[];
    templates: TaskTemplate[];
    completions: Array<{ date: string; templateIds: string[] }>;
    settings: boolean;
  };
  /** 被判定为「其他设备已删除」而丢弃的本地任务数 */
  removedByRemote: number;
  /** 双方版本不一致（发生 LWW 取舍）的条目数 */
  conflicts: number;
}

function templateUpdatedAt(t: TaskTemplate): number {
  if (typeof t.updatedAt === 'number') return t.updatedAt;
  const parsed = Date.parse(t.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((x, i) => x === right[i]);
}

export interface MergeOptions {
  /**
   * 本设备还从未成功同步过（没有归属空间标记）。
   * 用于兼容升级场景：老版本可能只把一部分本地数据推上云（迁移中断），
   * 此时「云端没有的本地任务」不能判定为「其他设备已删除」，否则会静默丢数据。
   */
  deviceNeverSynced?: boolean;
}

export function mergeCloudSnapshot(
  cloud: CloudSnapshot,
  local: LocalData,
  outbox: OutboxEntry[],
  options: MergeOptions = {},
): MergeOutcome {
  const pendingKeys = new Set(outbox.map((e) => e.op.key));
  const pendingTaskIds = new Set<string>();
  const pendingTemplateIds = new Set<string>();
  const pendingCompletions = new Map<string, { templateIds: string[]; base?: string[] }>();
  for (const entry of outbox) {
    const op = entry.op;
    if (op.type === 'task-upsert') pendingTaskIds.add(op.task.id);
    else if (op.type === 'template-upsert') pendingTemplateIds.add(op.template.id);
    else if (op.type === 'completion-set') {
      pendingCompletions.set(op.date, { templateIds: op.templateIds, base: op.base });
    }
  }
  const deleted = pendingDeletions(outbox);
  // 云端为空（首次迁移）或本设备从未同步过（升级/首次配置）时，本地数据一律保留
  const keepLocalOnly = cloud.empty || options.deviceNeverSynced === true;

  // ---- 任务 ----
  const localById = new Map(local.tasks.map((t) => [t.id, t]));
  const pushTasks: Task[] = [];
  const merged: Task[] = [];
  const seen = new Set<string>();
  let removedByRemote = 0;
  let conflicts = 0;

  for (const remote of cloud.tasks) {
    if (deleted.tasks.has(remote.id)) continue;
    const mine = localById.get(remote.id);
    if (mine === undefined) {
      merged.push(remote);
      continue;
    }
    if (mine.updatedAt > remote.updatedAt) {
      conflicts += 1;
      merged.push(mine);
      if (!pendingTaskIds.has(mine.id)) pushTasks.push(mine);
    } else {
      if (mine.updatedAt < remote.updatedAt) conflicts += 1;
      merged.push(remote);
    }
    seen.add(remote.id);
  }

  const localOnly: Task[] = [];
  for (const task of local.tasks) {
    if (seen.has(task.id) || deleted.tasks.has(task.id)) continue;
    const queued = pendingTaskIds.has(task.id);
    if (queued || keepLocalOnly) {
      // 本地新增（离线期间或首次迁移）：保留，未在队列中的补推
      if (!queued) pushTasks.push(task);
      localOnly.push(task);
    } else {
      removedByRemote += 1;
    }
  }

  // ---- 习惯模板 ----
  const localTemplateById = new Map(local.templates.map((t) => [t.id, t]));
  const pushTemplates: TaskTemplate[] = [];
  const mergedTemplates: TaskTemplate[] = [];
  const seenTemplates = new Set<string>();

  for (const remote of cloud.templates) {
    if (deleted.templates.has(remote.id)) continue;
    const mine = localTemplateById.get(remote.id);
    if (mine === undefined) {
      mergedTemplates.push(remote);
      continue;
    }
    if (templateUpdatedAt(mine) > templateUpdatedAt(remote)) {
      conflicts += 1;
      mergedTemplates.push(mine);
      if (!pendingTemplateIds.has(mine.id)) pushTemplates.push(mine);
    } else {
      if (templateUpdatedAt(mine) < templateUpdatedAt(remote)) conflicts += 1;
      mergedTemplates.push(remote);
    }
    seenTemplates.add(remote.id);
  }

  const localOnlyTemplates: TaskTemplate[] = [];
  for (const template of local.templates) {
    if (seenTemplates.has(template.id) || deleted.templates.has(template.id)) continue;
    const queued = pendingTemplateIds.has(template.id);
    if (queued || keepLocalOnly) {
      if (!queued) pushTemplates.push(template);
      localOnlyTemplates.push(template);
    }
  }

  const templates = [...localOnlyTemplates, ...mergedTemplates];
  const survivingTemplateIds = new Set(templates.map((t) => t.id));

  // ---- 打卡记录 ----
  const completions: CompletionMap = {};
  const pushCompletions: Array<{ date: string; templateIds: string[] }> = [];
  const allDates = new Set([...Object.keys(cloud.completions), ...Object.keys(local.completions)]);
  for (const date of allDates) {
    const remote = cloud.completions[date] ?? [];
    let ids: string[];
    const queued = pendingCompletions.get(date);
    if (queued !== undefined) {
      // 三方合并：base（本机改动前的值）→ queued（本机改动后的值）作为增量，
      // 应用到云端值上。这样既不会丢掉本机的离线打卡，也不会抹掉其他设备同时打的卡。
      const base = queued.base ?? [];
      const added = queued.templateIds.filter((id) => !base.includes(id));
      const removed = base.filter((id) => !queued.templateIds.includes(id));
      ids = Array.from(new Set([...remote.filter((id) => !removed.includes(id)), ...added]));
    } else {
      ids = Array.from(new Set([...remote, ...(local.completions[date] ?? [])]));
    }
    ids = ids.filter((id) => survivingTemplateIds.has(id));
    if (ids.length === 0) continue;
    completions[date] = ids;
    if (!pendingKeys.has(`completion:${date}`) && !sameIds(ids, remote)) {
      pushCompletions.push({ date, templateIds: ids });
    }
  }

  // ---- 设置 ----
  const remoteSettings = cloud.settings;
  const localSettings: CloudSettings = {
    taskReminder: local.taskReminder,
    habitReminder: local.habitReminder,
    theme: local.theme,
  };
  const settingsPending = pendingKeys.has('settings');
  const settings: CloudSettings = settingsPending
    ? localSettings
    : {
        taskReminder: remoteSettings?.taskReminder ?? local.taskReminder,
        habitReminder: remoteSettings?.habitReminder ?? local.habitReminder,
        theme: remoteSettings?.theme ?? local.theme,
      };

  return {
    // 本地独有任务置于最前，与「新建任务插到列表头部」的本地行为一致
    tasks: [...localOnly, ...merged],
    templates,
    completions,
    settings,
    push: { tasks: pushTasks, templates: pushTemplates, completions: pushCompletions, settings: !settingsPending && remoteSettings === null },
    removedByRemote,
    conflicts,
  };
}
