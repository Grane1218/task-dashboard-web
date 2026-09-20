import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../types';
import type { TaskTemplate } from '../types/habit';
import {
  __resetOutboxForTests,
  clearOutbox,
  enqueue,
  enqueueMany,
  getOutbox,
  hasPendingKey,
  onOutboxChange,
  pendingCount,
  pendingDeletions,
  taskKey,
  TASK_ORDER_KEY,
  templateKey,
} from './syncQueue';
import { getSpaceTag, setSpaceSecret } from './space';

const STORAGE_KEY = 'task-dashboard-sync-queue';

function task(id: string, title = id): Task {
  return {
    id,
    title,
    description: '',
    priority: 'medium',
    status: 'todo',
    startDate: '',
    dueDate: '',
    createdAt: 0,
    updatedAt: 0,
  };
}

function template(id: string): TaskTemplate {
  return { id, title: id, createdAt: '2024-01-01T00:00:00.000Z' };
}

beforeEach(() => {
  window.localStorage.clear();
  setSpaceSecret('');
  __resetOutboxForTests();
});

afterEach(() => {
  __resetOutboxForTests();
  window.localStorage.clear();
});

describe('enqueue：按 key 合并', () => {
  it('同一任务的多次修改只保留最新一条', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a', '第一次') });
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a', '第二次') });
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type).toBe('task-upsert');
    expect(entries[0].op.type === 'task-upsert' && entries[0].op.task.title).toBe('第二次');
  });

  it('不同任务分别保留', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    enqueue({ type: 'task-upsert', key: taskKey('b'), task: task('b') });
    expect(pendingCount()).toBe(2);
  });

  it('先改后删 → 只留删除（tombstone）', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    enqueue({ type: 'task-remove', key: taskKey('a'), id: 'a' });
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type).toBe('task-remove');
  });

  it('先删后改 → 只留修改（重新创建）', () => {
    enqueue({ type: 'task-remove', key: taskKey('a'), id: 'a' });
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a', '复活') });
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type).toBe('task-upsert');
  });

  it('任务顺序结构始终只有一条', () => {
    enqueue({ type: 'task-order', key: TASK_ORDER_KEY, order: { todo: ['a'], 'in-progress': [], done: [] } });
    enqueue({ type: 'task-order', key: TASK_ORDER_KEY, order: { todo: ['b'], 'in-progress': [], done: [] } });
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type === 'task-order' && entries[0].op.order.todo).toEqual(['b']);
  });

  it('同一天的打卡连续修改：保留最早的 base（三方合并公共祖先）', () => {
    enqueue({
      type: 'completion-set',
      key: 'completion:2024-05-06',
      date: '2024-05-06',
      templateIds: ['a'],
      base: [],
    });
    enqueue({
      type: 'completion-set',
      key: 'completion:2024-05-06',
      date: '2024-05-06',
      templateIds: ['a', 'b'],
      base: ['a'],
    });
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    const op = entries[0].op;
    expect(op.type).toBe('completion-set');
    if (op.type === 'completion-set') {
      expect(op.templateIds).toEqual(['a', 'b']);
      expect(op.base).toEqual([]); // 仍是第一次改动前的值
    }
  });

  it('习惯模板同样按 id 合并', () => {
    enqueue({ type: 'template-upsert', key: templateKey('h'), template: template('h') });
    enqueue({ type: 'template-upsert', key: templateKey('h'), template: template('h') });
    expect(pendingCount()).toBe(1);
  });
});

describe('pendingDeletions / hasPendingKey', () => {
  it('区分任务与习惯的删除', () => {
    enqueue({ type: 'task-remove', key: taskKey('a'), id: 'a' });
    enqueue({ type: 'template-remove', key: templateKey('h'), id: 'h' });
    const deleted = pendingDeletions();
    expect([...deleted.tasks]).toEqual(['a']);
    expect([...deleted.templates]).toEqual(['h']);
  });

  it('可以按 key 查询是否有未同步变更', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    expect(hasPendingKey(taskKey('a'))).toBe(true);
    expect(hasPendingKey(taskKey('b'))).toBe(false);
  });
});

describe('持久化', () => {
  it('重新加载模块后队列仍在（刷新页面不丢）', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a', '离线新建') });
    __resetOutboxForTests(); // 等价于模块重新加载
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type === 'task-upsert' && entries[0].op.task.title).toBe('离线新建');
  });

  it('清除后为空', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    clearOutbox();
    __resetOutboxForTests();
    expect(getOutbox()).toEqual([]);
  });

  it('存储内容损坏时降级为空队列而不是抛错', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json');
    __resetOutboxForTests();
    expect(getOutbox()).toEqual([]);
  });
});

describe('空间隔离', () => {
  it('切换空间密钥后旧队列被丢弃（避免写进新空间）', () => {
    setSpaceSecret('space-A');
    __resetOutboxForTests();
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    expect(pendingCount()).toBe(1);

    setSpaceSecret('space-B');
    __resetOutboxForTests();
    expect(getSpaceTag()).not.toBe('');
    expect(pendingCount()).toBe(0);
  });

  it('同一空间内队列保持有效', () => {
    setSpaceSecret('space-A');
    __resetOutboxForTests();
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    __resetOutboxForTests();
    expect(pendingCount()).toBe(1);
  });
});

describe('enqueueMany：批量入队（首次迁移 / 导入）', () => {
  it('一次写入多条且只通知一次', () => {
    const seen: number[] = [];
    const off = onOutboxChange((entries) => seen.push(entries.length));
    enqueueMany([
      { type: 'task-upsert', key: taskKey('a'), task: task('a') },
      { type: 'task-upsert', key: taskKey('b'), task: task('b') },
      { type: 'template-upsert', key: templateKey('h'), template: template('h') },
    ]);
    off();
    expect(pendingCount()).toBe(3);
    expect(seen).toEqual([3]);
  });

  it('与队列中已有的同 key 条目合并', () => {
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a', '旧') });
    enqueueMany([{ type: 'task-upsert', key: taskKey('a'), task: task('a', '新') }]);
    const entries = getOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].op.type === 'task-upsert' && entries[0].op.task.title).toBe('新');
  });

  it('大批量入队不会丢失条目（首迁场景）', () => {
    const ops = Array.from({ length: 800 }, (_, i) => ({
      type: 'task-upsert' as const,
      key: taskKey('t' + i),
      task: task('t' + i),
    }));
    enqueueMany(ops);
    expect(pendingCount()).toBe(800);
  });

  it('空数组不做任何事', () => {
    enqueueMany([]);
    expect(pendingCount()).toBe(0);
  });
});

describe('订阅通知', () => {
  it('入队后通知监听者', () => {
    const seen: number[] = [];
    const off = onOutboxChange((entries) => seen.push(entries.length));
    enqueue({ type: 'task-upsert', key: taskKey('a'), task: task('a') });
    enqueue({ type: 'task-upsert', key: taskKey('b'), task: task('b') });
    off();
    enqueue({ type: 'task-upsert', key: taskKey('c'), task: task('c') });
    expect(seen).toEqual([1, 2]);
  });
});
