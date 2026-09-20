import { useTaskStore, DEFAULT_REMINDER_SETTINGS } from '../store/useTaskStore';
import { useHabitStore, DEFAULT_HABIT_REMINDER_SETTINGS } from '../store/useHabitStore';
import type { Priority, ReminderSettings, Task, TaskStatus, Theme } from '../types';
import type { CompletionMap, HabitReminderSettings, TaskTemplate } from '../types/habit';

export const BACKUP_SCHEMA = 'task-dashboard-backup';
export const BACKUP_VERSION = 1;

interface BackupData {
  app: typeof BACKUP_SCHEMA;
  version: number;
  exportedAt: string;
  taskStore: {
    tasks: Task[];
    reminderSettings: ReminderSettings;
    theme: Theme;
  };
  habitStore: {
    templates: TaskTemplate[];
    completions: CompletionMap;
    reminderSettings: HabitReminderSettings;
  };
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayStamp(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function buildBackup(): BackupData {
  const taskState = useTaskStore.getState();
  const habitState = useHabitStore.getState();
  return {
    app: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    taskStore: {
      tasks: taskState.tasks,
      reminderSettings: taskState.reminderSettings,
      theme: taskState.theme,
    },
    habitStore: {
      templates: habitState.templates,
      completions: habitState.completions,
      reminderSettings: habitState.reminderSettings,
    },
  };
}

/** 导出全部数据为 JSON 文件（触发浏览器下载） */
export function exportDataToFile(): void {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'task-dashboard-backup-' + todayStamp() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportStats {
  tasksAdded: number;
  tasksSkipped: number;
  habitsAdded: number;
  habitsSkipped: number;
  completionsMerged: number;
}

export type ImportMode = 'merge' | 'overwrite';

export interface ImportResult {
  ok: boolean;
  error?: string;
  stats?: ImportStats;
  mode?: ImportMode;
}

function sanitizeTask(raw: unknown): Task {
  const t = (raw ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const status: TaskStatus =
    t.status === 'todo' || t.status === 'in-progress' || t.status === 'done' ? t.status : 'todo';
  const priority: Priority =
    t.priority === 'high' || t.priority === 'medium' || t.priority === 'low' ? t.priority : 'medium';
  return {
    id: typeof t.id === 'string' && t.id !== '' ? t.id : createId(),
    title: typeof t.title === 'string' && t.title.trim() !== '' ? t.title : '未命名任务',
    description: typeof t.description === 'string' ? t.description : '',
    priority,
    status,
    startDate: typeof t.startDate === 'string' ? t.startDate : '',
    dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : now,
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : now,
    completedAt: status === 'done' && typeof t.completedAt === 'number' ? t.completedAt : null,
    repeat:
      t.repeat === 'daily' || t.repeat === 'weekly' || t.repeat === 'monthly' ? t.repeat : undefined,
    repeatOf: typeof t.repeatOf === 'string' && t.repeatOf !== '' ? t.repeatOf : undefined,
    archived: t.archived === true,
  };
}

function sanitizeTemplate(raw: unknown): TaskTemplate {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof t.id === 'string' && t.id !== '' ? t.id : createId(),
    title: typeof t.title === 'string' && t.title.trim() !== '' ? t.title : '未命名习惯',
    emoji: typeof t.emoji === 'string' && t.emoji.trim() !== '' ? t.emoji : undefined,
    category: typeof t.category === 'string' && t.category.trim() !== '' ? t.category : undefined,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : undefined,
    archived: t.archived === true,
  };
}

function sanitizeCompletions(raw: unknown): CompletionMap {
  const out: CompletionMap = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter((x): x is string => typeof x === 'string');
    }
  }
  return out;
}

/** 解析并应用备份文件内容；mode='merge' 合并（本地已有的任务/习惯保留，仅追加新数据），mode='overwrite' 整体覆盖 */
export function importDataFromText(text: string, mode: ImportMode = 'merge'): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: '备份文件格式不正确' };
  }
  const data = parsed as Partial<BackupData>;
  if (data.app !== BACKUP_SCHEMA) {
    return { ok: false, error: '不是本应用导出的备份文件' };
  }

  const ts = data.taskStore;
  if (ts === undefined || ts === null || !Array.isArray(ts.tasks)) {
    return { ok: false, error: '备份缺少任务数据' };
  }
  const hs = data.habitStore;
  if (hs === undefined || hs === null || !Array.isArray(hs.templates) || hs.completions === undefined) {
    return { ok: false, error: '备份缺少习惯数据' };
  }

  // —— 覆盖模式：用备份整体替换任务/习惯/完成记录/设置/主题 ——
  if (mode === 'overwrite') {
    const theme: Theme = ts.theme === 'light' || ts.theme === 'dark' ? ts.theme : 'dark';
    const importedTasks = ts.tasks.map(sanitizeTask);
    const importedTemplates = hs.templates.map(sanitizeTemplate);
    const importedCompletions = sanitizeCompletions(hs.completions);
    const finalTemplateIds = new Set(importedTemplates.map((t) => t.id));
    const completions: CompletionMap = {};
    for (const [date, ids] of Object.entries(importedCompletions)) {
      const kept = ids.filter((id) => finalTemplateIds.has(id));
      if (kept.length > 0) completions[date] = kept;
    }
    useTaskStore.setState({
      tasks: importedTasks,
      reminderSettings: {
        ...DEFAULT_REMINDER_SETTINGS,
        ...(ts.reminderSettings ?? {}),
        enabled: ts.reminderSettings?.enabled === true,
      },
      theme,
    });
    useHabitStore.setState({
      templates: importedTemplates,
      completions,
      reminderSettings: {
        ...DEFAULT_HABIT_REMINDER_SETTINGS,
        ...(hs.reminderSettings ?? {}),
        enabled: hs.reminderSettings?.enabled === true,
      },
    });
    return {
      ok: true,
      mode,
      stats: {
        tasksAdded: importedTasks.length,
        tasksSkipped: 0,
        habitsAdded: importedTemplates.length,
        habitsSkipped: 0,
        completionsMerged: Object.keys(completions).length,
      },
    };
  }

  // —— 合并模式：本地已有 id 保留，仅追加新任务 ——
  const existingTasks = useTaskStore.getState().tasks;
  const existingTaskIds = new Set(existingTasks.map((t) => t.id));
  const importedTasks = ts.tasks.map(sanitizeTask);
  const seenIds = new Set<string>();
  const tasksToAdd: Task[] = [];
  let tasksSkipped = 0;
  for (const task of importedTasks) {
    if (seenIds.has(task.id)) continue; // 备份内部重复 id，只取第一个
    seenIds.add(task.id);
    if (existingTaskIds.has(task.id)) {
      tasksSkipped += 1; // 本地已存在，保留本地版本
    } else {
      tasksToAdd.push(task);
    }
  }

  // —— 合并习惯：本地已有模板保留，仅追加新模板 ——
  const existingTemplates = useHabitStore.getState().templates;
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));
  const importedTemplates = hs.templates.map(sanitizeTemplate);
  const seenTemplateIds = new Set<string>();
  const templatesToAdd: TaskTemplate[] = [];
  let habitsSkipped = 0;
  for (const template of importedTemplates) {
    if (seenTemplateIds.has(template.id)) continue;
    seenTemplateIds.add(template.id);
    if (existingTemplateIds.has(template.id)) {
      habitsSkipped += 1;
    } else {
      templatesToAdd.push(template);
    }
  }

  // —— 合并完成记录：按日期取并集，仅保留最终存在的模板 id ——
  const finalTemplateIds = new Set<string>([
    ...existingTemplates.map((t) => t.id),
    ...templatesToAdd.map((t) => t.id),
  ]);
  const localCompletions = useHabitStore.getState().completions;
  const importedCompletions = sanitizeCompletions(hs.completions);
  const completions: CompletionMap = { ...localCompletions };
  let completionsMerged = 0;
  for (const [date, ids] of Object.entries(importedCompletions)) {
    const merged = Array.from(
      new Set<string>([...(localCompletions[date] ?? []), ...ids.filter((id) => finalTemplateIds.has(id))]),
    );
    if (merged.length > (localCompletions[date]?.length ?? 0)) {
      completionsMerged += 1;
    }
    if (merged.length > 0) {
      completions[date] = merged;
    } else if (!(date in localCompletions)) {
      delete completions[date];
    }
  }

  // —— 提醒设置与主题保留本地，不做覆盖 ——
  useTaskStore.setState({
    tasks: [...existingTasks, ...tasksToAdd],
  });
  useHabitStore.setState({
    templates: [...existingTemplates, ...templatesToAdd],
    completions,
  });

  return {
    ok: true,
    mode,
    stats: {
      tasksAdded: tasksToAdd.length,
      tasksSkipped,
      habitsAdded: templatesToAdd.length,
      habitsSkipped,
      completionsMerged,
    },
  };
}
