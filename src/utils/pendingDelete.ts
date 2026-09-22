/**
 * 延迟删除（5 秒撤销）的持久化登记 + 定时器调度。
 *
 * 登记表是唯一真源：
 * - 页面存活时：窗口结束由定时器触发，但**触发前必须再查一次登记**（撤销过的登记不会再删除）。
 * - 同一 kind+id 被重复确认时，旧定时器会被取消、窗口以最后一次确认重新计时，登记仍只有一条，
 *   因此不会留下「撤销不到」的孤儿定时器（修复：重复确认后只撤销一次仍被删除）。
 * - 页面被刷新/关闭：下次启动时把登记项补做删除；未到期的项按用户意图视为已确认（仍执行删除，
 *   因为用户已经点了确认，只是撤销窗口被刷新打断）。
 */

const STORAGE_KEY = 'task-dashboard-pending-deletes';
/** 撤销窗口（毫秒） */
export const UNDO_WINDOW_MS = 5000;

export type PendingDeleteKind = 'task' | 'habit';

export interface PendingDelete {
  kind: PendingDeleteKind;
  id: string;
  /** 撤销窗口结束时间戳 */
  at: number;
}

/** 每个「kind:id」最多只允许存在一个定时器 */
const timers = new Map<string, number>();

function timerKey(kind: PendingDeleteKind, id: string): string {
  return kind + ':' + id;
}

function clearTimer(kind: PendingDeleteKind, id: string): void {
  const key = timerKey(kind, id);
  const handle = timers.get(key);
  if (handle === undefined) return;
  timers.delete(key);
  try {
    window.clearTimeout(handle);
  } catch {
    // 定时器已失效：忽略
  }
}

function read(): PendingDelete[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingDelete =>
        item !== null &&
        typeof item === 'object' &&
        ((item as PendingDelete).kind === 'task' || (item as PendingDelete).kind === 'habit') &&
        typeof (item as PendingDelete).id === 'string' &&
        typeof (item as PendingDelete).at === 'number',
    );
  } catch {
    return [];
  }
}

function write(items: PendingDelete[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 存储不可用时静默降级为纯内存撤销
  }
}

/** 该目标当前是否仍在撤销窗口内（登记表是唯一真源） */
export function isPendingDelete(kind: PendingDeleteKind, id: string): boolean {
  return read().some((x) => x.kind === kind && x.id === id);
}

/**
 * 登记一次延迟删除，并注册窗口结束时的回调（`onElapsed`）。
 * - 同一 kind+id 重复登记：取消上一个定时器、以最新时间重新计时，登记表仍只有一条。
 * - `onElapsed` 只在「窗口结束时登记仍在」的情况下调用；撤销过的登记不会再触发删除。
 */
export function schedulePendingDelete(
  item: PendingDelete,
  onElapsed?: (item: PendingDelete) => void,
): void {
  clearTimer(item.kind, item.id);

  const items = read().filter((x) => !(x.kind === item.kind && x.id === item.id));
  items.push(item);
  write(items);

  if (onElapsed === undefined) return;

  const delay = Math.max(0, item.at - Date.now());
  const handle = window.setTimeout(() => {
    timers.delete(timerKey(item.kind, item.id));
    // 撤销已经把登记清掉：以登记为准，不再执行删除（避免残留定时器误删）
    if (!isPendingDelete(item.kind, item.id)) return;
    cancelPendingDelete(item.kind, item.id);
    onElapsed(item);
  }, delay);
  timers.set(timerKey(item.kind, item.id), handle);
}

export function cancelPendingDelete(kind: PendingDeleteKind, id: string): void {
  clearTimer(kind, id);
  write(read().filter((x) => !(x.kind === kind && x.id === id)));
}

/**
 * 取出并清空所有登记项（页面启动时调用）。
 * 返回的每一项都应当执行删除：撤销窗口内的项说明用户已确认删除但被刷新打断。
 */
export function takeExpiredDeletions(): PendingDelete[] {
  const items = read();
  write([]);
  return items;
}
