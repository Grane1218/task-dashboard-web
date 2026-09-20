import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import type { TaskTemplate } from '../types/habit';
import {
  completionTimestamp,
  getHabitHeatmap,
  getHabitWeekRate,
  getStatusCounts,
  getTaskCompletionByDay,
} from './stats';
import { dateKey } from './habit';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    description: '',
    priority: 'medium',
    status: 'todo',
    startDate: '',
    dueDate: '',
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    ...over,
  };
}

const daysAgo = (n: number, hour = 12): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

describe('getStatusCounts', () => {
  it('统计各状态数量与总数', () => {
    const counts = getStatusCounts([
      task({ id: 'a', status: 'todo' }),
      task({ id: 'b', status: 'in-progress' }),
      task({ id: 'c', status: 'done' }),
      task({ id: 'd', status: 'done' }),
    ]);
    expect(counts).toEqual({ todo: 1, 'in-progress': 1, done: 2, total: 4 });
  });

  it('空数组返回全 0', () => {
    expect(getStatusCounts([])).toEqual({ todo: 0, 'in-progress': 0, done: 0, total: 0 });
  });
});

describe('completionTimestamp', () => {
  it('未完成任务返回 null', () => {
    expect(completionTimestamp(task({ id: 'a', status: 'todo', updatedAt: 123 }))).toBeNull();
  });

  it('优先使用 completedAt', () => {
    expect(completionTimestamp(task({ id: 'a', status: 'done', completedAt: 111, updatedAt: 999 }))).toBe(111);
  });

  it('旧数据没有 completedAt 时回退到 updatedAt', () => {
    expect(completionTimestamp(task({ id: 'a', status: 'done', completedAt: null, updatedAt: 999 }))).toBe(999);
  });
});

describe('getTaskCompletionByDay（按完成时间统计）', () => {
  it('返回指定天数的连续日期序列', () => {
    const result = getTaskCompletionByDay([], 7);
    expect(result).toHaveLength(7);
    expect(result[6].date).toBe(dateKey(new Date()));
  });

  it('按 completedAt 归日，而不是 updatedAt', () => {
    // 3 天前完成，但今天被编辑过（updatedAt = 今天）
    const completed = daysAgo(3).getTime();
    const tasks = [
      task({ id: 'a', status: 'done', completedAt: completed, updatedAt: Date.now() }),
    ];
    const result = getTaskCompletionByDay(tasks, 7);
    const today = result[result.length - 1];
    const threeDaysAgo = result[result.length - 4];
    expect(today.count).toBe(0);
    expect(threeDaysAgo.count).toBe(1);
  });

  it('编辑已完成任务不会把它计入「今天完成」', () => {
    const before = getTaskCompletionByDay(
      [task({ id: 'a', status: 'done', completedAt: daysAgo(2).getTime(), updatedAt: daysAgo(2).getTime() })],
      7,
    );
    const after = getTaskCompletionByDay(
      [task({ id: 'a', status: 'done', completedAt: daysAgo(2).getTime(), updatedAt: Date.now() })],
      7,
    );
    expect(after).toEqual(before);
  });

  it('未完成任务不计入', () => {
    const result = getTaskCompletionByDay([task({ id: 'a', status: 'in-progress', updatedAt: Date.now() })], 7);
    expect(result.every((d) => d.count === 0)).toBe(true);
  });

  it('超过统计窗口的完成记录不计入', () => {
    const tasks = [task({ id: 'a', status: 'done', completedAt: daysAgo(30).getTime(), updatedAt: Date.now() })];
    const result = getTaskCompletionByDay(tasks, 7);
    expect(result.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });
});

function template(id: string, archived = false): TaskTemplate {
  return { id, title: id, createdAt: new Date().toISOString(), archived };
}

describe('getHabitHeatmap', () => {
  it('按周生成 7 × weeks 天，且只统计未归档习惯', () => {
    const templates = [template('a'), template('b', true)];
    const today = dateKey(new Date());
    const heatmap = getHabitHeatmap(templates, { [today]: ['a'] }, 2);
    expect(heatmap).toHaveLength(14);
    const last = heatmap[heatmap.length - 1];
    expect(last.date).toBe(today);
    expect(last.completed).toBe(1);
    expect(last.total).toBe(1);
  });
});

describe('getHabitWeekRate', () => {
  it('无习惯时返回 0，不产生除零', () => {
    expect(getHabitWeekRate([], {}, new Date())).toEqual({ completedItems: 0, totalItems: 0, percent: 0 });
  });

  it('按本周（周一起）7 天计算完成率', () => {
    const now = new Date('2024-05-08T12:00:00'); // 周三
    const templates = [template('a')];
    const completions = {
      '2024-05-06': ['a'], // 周一
      '2024-05-08': ['a'], // 周三
    };
    const rate = getHabitWeekRate(templates, completions, now);
    expect(rate.completedItems).toBe(2);
    expect(rate.totalItems).toBe(7);
    expect(rate.percent).toBe(29);
  });

  it('归档习惯不参与统计', () => {
    const now = new Date('2024-05-08T12:00:00');
    const rate = getHabitWeekRate([template('a', true)], { '2024-05-06': ['a'] }, now);
    expect(rate).toEqual({ completedItems: 0, totalItems: 0, percent: 0 });
  });
});
