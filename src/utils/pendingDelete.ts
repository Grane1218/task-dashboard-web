/**
 * 延迟删除（5 秒撤销）的持久化登记。
 *
 * 原实现只把定时器放在内存里：删除确认后若刷新/关闭页面，定时器随页面销毁，
 * 任务会「既没删除也没提示」。这里把待删除项写入 localStorage：
 * - 页面存活时：定时器到点执行删除，并清除登记。
 * - 页面被刷新/关闭：下次启动时把「已过撤销期」的项补做删除；未到期的项按用户意图视为已确认（仍执行删除，
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

export function schedulePendingDelete(item: PendingDelete): void {
  const items = read().filter((x) => !(x.kind === item.kind && x.id === item.id));
  items.push(item);
  write(items);
}

export function cancelPendingDelete(kind: PendingDeleteKind, id: string): void {
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
