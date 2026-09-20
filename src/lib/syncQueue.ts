import type { Task, TaskStatus } from '../types';
import type { TaskTemplate } from '../types/habit';
import {
  ensureCloud,
  removeTask,
  removeTemplate,
  syncTaskOrderRecord,
  upsertCompletion,
  upsertSettings,
  upsertTask,
  upsertTemplate,
  type CloudSettings,
} from './cloud';
import { getSpaceTag } from './space';

/**
 * 离线写队列（outbox）
 *
 * 目标：所有写操作「本地先行、云端异步补写」。
 * - 网络不通时用户操作不再被拒绝（修复「已配置云后断网即完全不可写」）。
 * - 队列持久化在 localStorage，刷新/关闭页面不丢。
 * - 同 key 操作自动合并（coalesce），只保留最新一次，队列不会无限膨胀。
 * - 删除操作作为 tombstone 保留在队列里，供 hydrate 合并时判断「云端已删」。
 */

export type OutboxOp =
  | { type: 'task-upsert'; key: string; task: Task }
  | { type: 'task-remove'; key: string; id: string }
  | { type: 'template-upsert'; key: string; template: TaskTemplate }
  | { type: 'template-remove'; key: string; id: string }
  | { type: 'completion-set'; key: string; date: string; templateIds: string[]; base?: string[] }
  | { type: 'task-order'; key: string; order: Record<TaskStatus, string[]> }
  | { type: 'settings-set'; key: string; settings: CloudSettings };

export interface OutboxEntry {
  op: OutboxOp;
  /** 入队时间戳（毫秒） */
  at: number;
}

const STORAGE_KEY = 'task-dashboard-sync-queue';
/**
 * 队列长度上限。每个任务/习惯最多只占一条（同 key 合并），
 * 因此这个上限只有在「离线期间改动过 5000 个不同条目」时才会触发；
 * 触发时丢的是最老的条目并打印警告，便于排查。
 */
const MAX_ENTRIES = 5000;
/** 失败后的重试间隔（毫秒） */
const RETRY_DELAY_MS = 20000;
/** 入队后延迟冲刷，合并同一批连续操作 */
const FLUSH_DEBOUNCE_MS = 800;

type Listener = (entries: OutboxEntry[]) => void;

let entries: OutboxEntry[] | null = null;
let flushing: Promise<FlushResult> | null = null;
let retryNotBefore = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<Listener>();

function load(): OutboxEntry[] {
  if (entries !== null) return entries;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      entries = [];
      return entries;
    }
    const parsed = JSON.parse(raw) as unknown;
    const payload = Array.isArray(parsed)
      ? { space: '', list: parsed }
      : ((parsed ?? {}) as { space?: unknown; list?: unknown });
    // 空间切换后旧队列必须丢弃：否则会把上一个空间的数据写进新空间
    if (typeof payload.space === 'string' && payload.space !== getSpaceTag()) {
      entries = [];
      persist();
      return entries;
    }
    if (!Array.isArray(payload.list)) {
      entries = [];
      return entries;
    }
    entries = payload.list.filter(
      (e): e is OutboxEntry =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as OutboxEntry).at === 'number' &&
        (e as OutboxEntry).op !== undefined &&
        typeof ((e as OutboxEntry).op as OutboxOp).key === 'string',
    );
    return entries;
  } catch {
    entries = [];
    return entries;
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ space: getSpaceTag(), list: load() }),
    );
  } catch {
    // 存储不可用时仅内存生效：本次会话内仍会尝试同步
  }
}

function emit(): void {
  const snapshot = [...load()];
  for (const fn of listeners) fn(snapshot);
}

export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getOutbox(): OutboxEntry[] {
  return [...load()];
}

export function pendingCount(): number {
  return load().length;
}

/** 队列中是否有针对某任务/习惯的未同步变更（含删除 tombstone） */
export function hasPendingKey(key: string): boolean {
  return load().some((e) => e.op.key === key);
}

/** 未同步的删除 id 集合（tombstone），供 hydrate 合并使用 */
export function pendingDeletions(source?: OutboxEntry[]): { tasks: Set<string>; templates: Set<string> } {
  const tasks = new Set<string>();
  const templates = new Set<string>();
  for (const e of source ?? load()) {
    if (e.op.type === 'task-remove') tasks.add(e.op.id);
    else if (e.op.type === 'template-remove') templates.add(e.op.id);
  }
  return { tasks, templates };
}

export const taskKey = (id: string): string => `task:${id}`;
export const templateKey = (id: string): string => `template:${id}`;
export const completionKey = (date: string): string => `completion:${date}`;
export const TASK_ORDER_KEY = 'task-order';
export const SETTINGS_KEY = 'settings';

/** 入队并尝试冲刷；同 key 覆盖（后写胜出），保证队列长度有界 */
export function enqueue(op: OutboxOp): void {
  enqueueMany([op]);
}

/**
 * 批量入队：合并同 key 后只持久化一次。
 * 首次迁移 / 覆盖导入会一次产生几百条操作，逐条写入会造成 O(n²) 的 localStorage 开销。
 */
export function enqueueMany(ops: OutboxOp[]): void {
  if (ops.length === 0) return;
  const merged = new Map<string, OutboxEntry>();
  for (const entry of load()) merged.set(entry.op.key, entry);
  const at = Date.now();
  for (const op of ops) {
    const existing = merged.get(op.key);
    let next = { op, at };
    // 同一天的打卡连续修改：保留最早的 base（三方合并的公共祖先），只更新目标值
    if (
      op.type === 'completion-set' &&
      existing !== undefined &&
      existing.op.type === 'completion-set' &&
      existing.op.base !== undefined
    ) {
      next = { op: { ...op, base: existing.op.base }, at };
    }
    merged.delete(op.key); // 重新插入以保持「最新操作在队尾」的顺序
    merged.set(op.key, next);
  }
  const list = [...merged.values()];
  if (list.length > MAX_ENTRIES) {
    console.warn('[syncQueue] 待同步队列超过上限，丢弃最旧的条目:', list.length - MAX_ENTRIES);
    list.splice(0, list.length - MAX_ENTRIES);
  }
  entries = list;
  persist();
  emit();
  scheduleFlush();
}

/** 清空队列（仅用于测试与「重置同步状态」） */
export function clearOutbox(): void {
  entries = [];
  persist();
  emit();
}

export interface FlushResult {
  ok: boolean;
  pushed: number;
  remaining: number;
}

async function applyOp(op: OutboxOp): Promise<boolean> {
  switch (op.type) {
    case 'task-upsert':
      return upsertTask(op.task);
    case 'task-remove':
      return removeTask(op.id);
    case 'template-upsert':
      return upsertTemplate(op.template);
    case 'template-remove':
      return removeTemplate(op.id);
    case 'completion-set':
      return upsertCompletion(op.date, op.templateIds);
    case 'task-order':
      return syncTaskOrderRecord(op.order);
    case 'settings-set':
      return upsertSettings(op.settings);
    default:
      return true; // 未知类型直接丢弃，避免卡死队列
  }
}

/**
 * 顺序冲刷队列。遇到第一个失败立即停止（保持顺序语义），并进入退避窗口。
 * 成功推送的条目按 key 精确出队（期间可能有新操作入队覆盖同 key）。
 */
export async function flushOutbox(force = false): Promise<FlushResult> {
  if (flushing !== null) return flushing;
  if (!force && Date.now() < retryNotBefore) {
    return { ok: false, pushed: 0, remaining: pendingCount() };
  }
  flushing = (async (): Promise<FlushResult> => {
    const startCount = pendingCount();
    if (startCount === 0) return { ok: true, pushed: 0, remaining: 0 };
    if (!(await ensureCloud())) {
      retryNotBefore = Date.now() + RETRY_DELAY_MS;
      return { ok: false, pushed: 0, remaining: pendingCount() };
    }
    let pushed = 0;
    let dirty = 0;
    while (true) {
      const list = load();
      const next = list[0];
      if (next === undefined) break;
      const ok = await applyOp(next.op);
      if (!ok) {
        retryNotBefore = Date.now() + RETRY_DELAY_MS;
        persist();
        emit();
        return { ok: false, pushed, remaining: pendingCount() };
      }
      // 用对象同一性出队：若期间同 key 被新操作覆盖，头部的对象已经换了，
      // 此时不能出队（新条目已排到队尾，会在本轮稍后被推送）。
      // 不要用 (key, at) 之类的值比较——同一毫秒内的覆盖会被误判成「已推送」而丢数据。
      if (load()[0] === next) load().shift();
      pushed += 1;
      dirty += 1;
      // 批量落盘：逐条 persist（整队列 JSON 序列化）+ emit（触发 React 重渲染）是 O(n²)
      if (dirty >= 20) {
        persist();
        emit();
        dirty = 0;
      }
    }
    persist();
    emit();
    return { ok: true, pushed, remaining: pendingCount() };
  })();

  try {
    return await flushing;
  } finally {
    flushing = null;
  }
}

function scheduleFlush(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushOutbox();
  }, FLUSH_DEBOUNCE_MS);
}

let autoFlushStarted = false;

/** 启动自动补写：入队后自动冲刷 + 网络恢复时立即冲刷 + 兜底轮询 */
export function startAutoFlush(): void {
  if (autoFlushStarted) return;
  autoFlushStarted = true;
  const tryFlush = () => {
    if (pendingCount() === 0) return;
    void flushOutbox();
  };
  window.addEventListener('online', () => {
    // 网络恢复：清空退避窗口后立即补写
    retryNotBefore = 0;
    void flushOutbox(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryFlush();
  });
  window.setInterval(tryFlush, RETRY_DELAY_MS);
  tryFlush();
}

/** 测试用：重置模块内部状态（entries = null 等价于模块重新加载，会重新读 localStorage） */
export function __resetOutboxForTests(): void {
  entries = null;
  flushing = null;
  retryNotBefore = 0;
  autoFlushStarted = false;
  listeners = new Set<Listener>();
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
}
