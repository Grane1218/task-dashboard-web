import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelPendingDelete,
  isPendingDelete,
  schedulePendingDelete,
  takeExpiredDeletions,
  UNDO_WINDOW_MS,
} from './pendingDelete';

const STORAGE_KEY = 'task-dashboard-pending-deletes';

beforeEach(() => {
  window.localStorage.clear();
});

describe('延迟删除登记', () => {
  it('登记后可被取出并清空', () => {
    schedulePendingDelete({ kind: 'task', id: 'a', at: 1000 });
    const items = takeExpiredDeletions();
    expect(items).toEqual([{ kind: 'task', id: 'a', at: 1000 }]);
    // 取出即清空，避免下次启动重复删除
    expect(takeExpiredDeletions()).toEqual([]);
  });

  it('撤销后不再删除', () => {
    schedulePendingDelete({ kind: 'task', id: 'a', at: 1000 });
    schedulePendingDelete({ kind: 'habit', id: 'h', at: 1000 });
    cancelPendingDelete('task', 'a');
    expect(takeExpiredDeletions()).toEqual([{ kind: 'habit', id: 'h', at: 1000 }]);
  });

  it('同一目标重复登记只保留一条', () => {
    schedulePendingDelete({ kind: 'task', id: 'a', at: 1000 });
    schedulePendingDelete({ kind: 'task', id: 'a', at: 2000 });
    expect(takeExpiredDeletions()).toEqual([{ kind: 'task', id: 'a', at: 2000 }]);
  });

  it('任务与习惯使用同一 id 时互不影响', () => {
    schedulePendingDelete({ kind: 'task', id: 'x', at: 1 });
    schedulePendingDelete({ kind: 'habit', id: 'x', at: 1 });
    cancelPendingDelete('task', 'x');
    expect(takeExpiredDeletions()).toEqual([{ kind: 'habit', id: 'x', at: 1 }]);
  });

  it('登记写入 localStorage，刷新后仍会落地删除', () => {
    schedulePendingDelete({ kind: 'task', id: 'a', at: 1000 });
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"id":"a"');
  });

  it('存储内容损坏时返回空数组而不是抛错', () => {
    window.localStorage.setItem(STORAGE_KEY, '{{{');
    expect(takeExpiredDeletions()).toEqual([]);
  });

  it('过滤掉结构不合法的条目', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ kind: 'task' }, { kind: 'nope', id: 'a', at: 1 }, null]));
    expect(takeExpiredDeletions()).toEqual([]);
  });
});

/**
 * 定时器与撤销的回归用例。
 * 用手写定时器表替换 window.setTimeout，以便确定性地推进「撤销窗口」。
 */
describe('延迟删除的定时器（回归：撤销后不得再删除）', () => {
  const win = window as unknown as {
    setTimeout: (fn: () => void, ms?: number) => number;
    clearTimeout: (id: number) => void;
  };
  const originalSetTimeout = win.setTimeout;
  const originalClearTimeout = win.clearTimeout;

  let now = 0;
  let nextId = 1;
  let active = new Map<number, { fn: () => void; at: number }>();

  beforeEach(() => {
    now = 1000000;
    nextId = 1;
    active = new Map();
    win.setTimeout = (fn, ms) => {
      const id = nextId;
      nextId += 1;
      active.set(id, { fn, at: now + (ms ?? 0) });
      return id;
    };
    win.clearTimeout = (id) => {
      active.delete(id);
    };
  });

  afterEach(() => {
    win.setTimeout = originalSetTimeout;
    win.clearTimeout = originalClearTimeout;
  });

  function advance(ms: number): void {
    now += ms;
    for (const [id, timer] of [...active]) {
      if (timer.at <= now) {
        active.delete(id);
        timer.fn();
      }
    }
  }

  it('窗口结束前撤销：不删除，且定时器被取消', () => {
    const deleted: string[] = [];
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, (i) => deleted.push(i.id));
    expect(active.size).toBe(1);
    cancelPendingDelete('task', 'a');
    expect(active.size).toBe(0);
    advance(UNDO_WINDOW_MS + 1);
    expect(deleted).toEqual([]);
    expect(isPendingDelete('task', 'a')).toBe(false);
  });

  it('未撤销时到点删除一次，并清空登记', () => {
    const deleted: string[] = [];
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, (i) => deleted.push(i.id));
    advance(UNDO_WINDOW_MS);
    expect(deleted).toEqual(['a']);
    expect(isPendingDelete('task', 'a')).toBe(false);
  });

  it('回归修复：同一目标重复确认只保留一个定时器，撤销一次后不会被删除', () => {
    const deleted: string[] = [];
    const onElapsed = (item: { id: string }) => deleted.push(item.id);
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, onElapsed);
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, onElapsed);
    // 修复前：两次确认各排一个定时器，此处为 2，撤销其中一个后另一个照常删除
    expect(active.size).toBe(1);
    cancelPendingDelete('task', 'a');
    advance(UNDO_WINDOW_MS + 1);
    expect(deleted).toEqual([]);
  });

  it('回归修复：撤销后残留的定时器回调也不会删除（以登记为准）', () => {
    const deleted: string[] = [];
    schedulePendingDelete({ kind: 'task', id: 'b', at: Date.now() + UNDO_WINDOW_MS }, (i) => deleted.push(i.id));
    const stray = [...active.values()][0].fn;
    cancelPendingDelete('task', 'b');
    stray();
    expect(deleted).toEqual([]);
  });

  it('重复确认时窗口从最后一次确认重新计时', () => {
    const deleted: string[] = [];
    const onElapsed = (item: { id: string }) => deleted.push(item.id);
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, onElapsed);
    advance(3000);
    schedulePendingDelete({ kind: 'task', id: 'a', at: Date.now() + UNDO_WINDOW_MS }, onElapsed);
    advance(3000); // 距第一次确认已 6 秒，但窗口已重新计时
    expect(deleted).toEqual([]);
    advance(2000);
    expect(deleted).toEqual(['a']);
  });

  it('任务与习惯的定时器互不影响', () => {
    const deleted: string[] = [];
    schedulePendingDelete({ kind: 'task', id: 'x', at: Date.now() + UNDO_WINDOW_MS }, (i) => deleted.push('task:' + i.id));
    schedulePendingDelete({ kind: 'habit', id: 'x', at: Date.now() + UNDO_WINDOW_MS }, (i) => deleted.push('habit:' + i.id));
    expect(active.size).toBe(2);
    cancelPendingDelete('task', 'x');
    advance(UNDO_WINDOW_MS);
    expect(deleted).toEqual(['habit:x']);
  });
});
