import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { DEFAULT_FILTERS, filterTasks, type TaskFilters } from './filter';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    priority: 'medium',
    status: 'todo',
    startDate: '',
    dueDate: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({ ...DEFAULT_FILTERS, ...over });

describe('filterTasks', () => {
  const tasks = [
    task('写周报', { priority: 'high', status: 'todo' }),
    task('Write Report', { priority: 'low', status: 'done' }),
    task('修复登录 Bug', { priority: 'high', status: 'in-progress' }),
  ];

  it('默认过滤器返回全部', () => {
    expect(filterTasks(tasks, DEFAULT_FILTERS)).toHaveLength(3);
  });

  it('按状态筛选', () => {
    expect(filterTasks(tasks, filters({ status: 'done' })).map((t) => t.id)).toEqual(['Write Report']);
  });

  it('按优先级筛选', () => {
    expect(filterTasks(tasks, filters({ priority: 'high' })).map((t) => t.id)).toEqual(['写周报', '修复登录 Bug']);
  });

  it('关键词大小写不敏感且支持中文', () => {
    expect(filterTasks(tasks, filters({ search: 'report' })).map((t) => t.id)).toEqual(['Write Report']);
    expect(filterTasks(tasks, filters({ search: '周报' })).map((t) => t.id)).toEqual(['写周报']);
  });

  it('搜索词首尾空格被忽略', () => {
    expect(filterTasks(tasks, filters({ search: '  bug  ' })).map((t) => t.id)).toEqual(['修复登录 Bug']);
  });

  it('多个条件同时生效', () => {
    expect(filterTasks(tasks, filters({ search: '报', priority: 'high', status: 'todo' })).map((t) => t.id)).toEqual([
      '写周报',
    ]);
  });

  it('无匹配时返回空数组', () => {
    expect(filterTasks(tasks, filters({ search: '不存在的任务' }))).toEqual([]);
  });
});
