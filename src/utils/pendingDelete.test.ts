import { beforeEach, describe, expect, it } from 'vitest';
import { cancelPendingDelete, schedulePendingDelete, takeExpiredDeletions } from './pendingDelete';

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
