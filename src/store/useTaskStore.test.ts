import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskStatus } from '../types';
import { parseDueDate } from '../utils/date';
import { DEFAULT_REMINDER_SETTINGS, findReclaimableCopy, useTaskStore } from './useTaskStore';

/**
 * 记录入队操作，替代「真实 localStorage 队列 + 后台网络冲刷」，
 * 既让测试保持确定性，也能断言「回收副本时确实发出了删除 tombstone」。
 */
const recorder = vi.hoisted(() => ({ ops: [] as Array<{ type: string; key: string; id?: string }> }));

vi.mock('../lib/cloud', () => ({
  isCloudConfigured: () => true,
  buildTaskOrder: (tasks: Task[]): Record<TaskStatus, string[]> => {
    const order: Record<TaskStatus, string[]> = { todo: [], 'in-progress': [], done: [] };
    for (const task of tasks) {
      if (task.archived !== true) order[task.status].push(task.id);
    }
    return order;
  },
}));

vi.mock('../lib/syncQueue', () => ({
  enqueue: (op: { type: string; key: string; id?: string }): void => {
    recorder.ops.push(op);
  },
  taskKey: (id: string): string => `task:${id}`,
  TASK_ORDER_KEY: 'task-order',
}));

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 生成相对今天的 "YYYY-MM-DDTHH:mm"（本地时区） */
function dateAt(offsetDays: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

function makeTask(over: Partial<Task> & { id: string }): Task {
  const now = Date.now();
  return {
    title: over.id,
    description: '',
    priority: 'medium',
    status: 'done',
    startDate: '',
    dueDate: '',
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    ...over,
  };
}

function currentTasks(): Task[] {
  return useTaskStore.getState().tasks;
}

function removalIds(): string[] {
  return recorder.ops.filter((op) => op.type === 'task-remove').map((op) => op.id ?? '');
}

function seed(tasks: Task[]): void {
  useTaskStore.setState({ tasks });
}

beforeEach(() => {
  window.localStorage.clear();
  recorder.ops.length = 0;
  useTaskStore.setState({ tasks: [], reminderSettings: DEFAULT_REMINDER_SETTINGS, theme: 'dark' });
});

describe('completeRecurring：生成下一周期副本', () => {
  it('副本带 repeatOf 溯源、保留重复设置并顺延到未来', async () => {
    seed([makeTask({ id: 'src', status: 'in-progress', repeat: 'daily', startDate: dateAt(0), dueDate: dateAt(0) })]);

    const copy = await useTaskStore.getState().completeRecurring('src');

    expect(copy).not.toBeNull();
    expect(copy?.repeatOf).toBe('src');
    expect(copy?.status).toBe('todo');
    expect(copy?.repeat).toBe('daily');
    expect(copy?.completedAt).toBeNull();
    expect(copy?.id).not.toBe('src');

    const due = parseDueDate(copy?.dueDate ?? '');
    expect(due).not.toBeNull();
    expect((due as Date).getTime()).toBeGreaterThan(Date.now());

    const source = currentTasks().find((t) => t.id === 'src');
    expect(source?.status).toBe('done');
    expect(typeof source?.completedAt).toBe('number');
  });

  it('逾期很久才完成时，副本仍落在未来（不会一生成就逾期）', async () => {
    seed([makeTask({ id: 'late', status: 'todo', repeat: 'daily', startDate: dateAt(-10), dueDate: dateAt(-10) })]);

    const copy = await useTaskStore.getState().completeRecurring('late');

    const due = parseDueDate(copy?.dueDate ?? '');
    expect(due).not.toBeNull();
    expect((due as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('非重复任务不生成副本', async () => {
    seed([makeTask({ id: 'once', status: 'todo' })]);

    expect(await useTaskStore.getState().completeRecurring('once')).toBeNull();
  });

  it('已完成的任务不重复生成副本', async () => {
    seed([makeTask({ id: 'done-src', status: 'done', repeat: 'daily', startDate: dateAt(0) })]);

    expect(await useTaskStore.getState().completeRecurring('done-src')).toBeNull();
  });
});

describe('findReclaimableCopy：回收条件', () => {
  const copyOf = (over: Partial<Task>): Task =>
    makeTask({ id: 'copy', status: 'todo', repeatOf: 'src', completedAt: null, ...over });

  it('未触碰的副本可回收（updatedAt === createdAt）', () => {
    expect(findReclaimableCopy([copyOf({ createdAt: 1000, updatedAt: 1000 })], 'src')?.id).toBe('copy');
  });

  it('被修改过的副本不回收', () => {
    expect(findReclaimableCopy([copyOf({ createdAt: 1000, updatedAt: 2000 })], 'src')).toBeNull();
  });

  it('已离开「待处理」（被拖动/自动开始/再次完成）的副本不回收', () => {
    expect(
      findReclaimableCopy([copyOf({ status: 'in-progress', createdAt: 1000, updatedAt: 1000 })], 'src'),
    ).toBeNull();
    expect(
      findReclaimableCopy([copyOf({ status: 'done', createdAt: 1000, updatedAt: 1000 })], 'src'),
    ).toBeNull();
  });

  it('不是该源任务生成的副本不回收', () => {
    expect(
      findReclaimableCopy([copyOf({ repeatOf: 'other', createdAt: 1000, updatedAt: 1000 })], 'src'),
    ).toBeNull();
  });

  it('用户自己新建的重复任务（无 repeatOf）不会被误回收', () => {
    expect(
      findReclaimableCopy([copyOf({ repeatOf: undefined, createdAt: 1000, updatedAt: 1000 })], 'src'),
    ).toBeNull();
  });
});

describe('toggleDone：取消完成时回收副本', () => {
  it('回收未触碰的副本、发出删除 tombstone，并清空原任务的完成时间', async () => {
    seed([makeTask({ id: 'src', status: 'in-progress', repeat: 'daily', startDate: dateAt(0), dueDate: dateAt(0) })]);
    const copy = await useTaskStore.getState().completeRecurring('src');
    const copyId = copy?.id ?? '';
    expect(copyId).not.toBe('');

    const result = await useTaskStore.getState().toggleDone('src');

    expect(result.ok).toBe(true);
    expect(result.reclaimedCopyId).toBe(copyId);
    expect(currentTasks().some((t) => t.id === copyId)).toBe(false);
    expect(removalIds()).toContain(copyId);

    const source = currentTasks().find((t) => t.id === 'src');
    expect(source?.status).not.toBe('done');
    expect(source?.completedAt).toBeNull();
  });

  it('副本已被修改过则保留，不回收（同一毫秒内创建后立刻编辑也算触碰）', async () => {
    seed([makeTask({ id: 'src', status: 'in-progress', repeat: 'daily', startDate: dateAt(0), dueDate: dateAt(0) })]);
    const copy = await useTaskStore.getState().completeRecurring('src');
    const copyId = copy?.id ?? '';
    await useTaskStore.getState().updateTask(copyId, { title: '我改过这个副本' });

    const result = await useTaskStore.getState().toggleDone('src');

    expect(result.reclaimedCopyId).toBeNull();
    expect(currentTasks().some((t) => t.id === copyId)).toBe(true);
    expect(removalIds()).not.toContain(copyId);
  });

  it('非重复任务取消完成时没有可回收对象', async () => {
    seed([makeTask({ id: 'once', status: 'done' })]);

    const result = await useTaskStore.getState().toggleDone('once');

    expect(result.ok).toBe(true);
    expect(result.reclaimedCopyId).toBeNull();
  });

  it('任务不存在时返回 ok: false', async () => {
    const result = await useTaskStore.getState().toggleDone('missing');

    expect(result.ok).toBe(false);
    expect(result.reclaimedCopyId).toBeNull();
  });

  it('标记完成（非取消）不触发回收', async () => {
    seed([makeTask({ id: 'fresh', status: 'todo', repeat: 'daily', startDate: dateAt(2), dueDate: dateAt(2) })]);

    const result = await useTaskStore.getState().toggleDone('fresh');

    expect(result.ok).toBe(true);
    expect(result.reclaimedCopyId).toBeNull();
    expect(currentTasks().find((t) => t.id === 'fresh')?.status).toBe('done');
  });
});
