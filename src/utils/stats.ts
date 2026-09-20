import type { Task, TaskStatus } from '../types';
import type { CompletionMap, TaskTemplate } from '../types/habit';
import { dateKey } from './habit';

export interface StatusCounts {
  todo: number;
  'in-progress': number;
  done: number;
  total: number;
}

export function getStatusCounts(tasks: Task[]): StatusCounts {
  let todo = 0;
  let inProgress = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'todo') todo += 1;
    else if (task.status === 'in-progress') inProgress += 1;
    else done += 1;
  }
  return { todo, 'in-progress': inProgress, done, total: tasks.length };
}

export interface DayCount {
  date: string;
  label: string;
  count: number;
}

/**
 * 任务完成时间：优先使用 completedAt（真正的完成时刻）；
 * 旧数据没有该字段时回退到 updatedAt（完成/编辑都会更新，属于近似值）。
 */
export function completionTimestamp(task: Task): number | null {
  if (task.status !== 'done') return null;
  if (typeof task.completedAt === 'number') return task.completedAt;
  return task.updatedAt;
}

// 近 days 天每天完成的任务数。口径为「完成时间」（completedAt），
// 因此编辑一个已完成任务不会把它算进「今天完成」。
export function getTaskCompletionByDay(tasks: Task[], days: number): DayCount[] {
  const result: DayCount[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dateKey(d);
    const count = tasks.filter((task) => {
      const at = completionTimestamp(task);
      return at !== null && dateKey(new Date(at)) === key;
    }).length;
    result.push({ date: key, label: d.getMonth() + 1 + '/' + d.getDate(), count });
  }
  return result;
}

export interface HeatmapDay {
  date: string;
  completed: number;
  total: number;
}

// 习惯热力图：最近 weeks 周（每天一个格子）的完成情况，仅统计进行中的习惯
export function getHabitHeatmap(templates: TaskTemplate[], completions: CompletionMap, weeks: number): HeatmapDay[] {
  const active = templates.filter((template) => !template.archived);
  const result: HeatmapDay[] = [];
  const now = new Date();
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dateKey(d);
    const done = completions[key] ?? [];
    result.push({
      date: key,
      completed: active.filter((template) => done.includes(template.id)).length,
      total: active.length,
    });
  }
  return result;
}

// 本周（周一起）习惯完成率：已完成的“习惯×天” ÷（习惯数 × 7）
export function getHabitWeekRate(
  templates: TaskTemplate[],
  completions: CompletionMap,
  now: Date = new Date(),
): { completedItems: number; totalItems: number; percent: number } {
  const active = templates.filter((template) => !template.archived);
  if (active.length === 0) return { completedItems: 0, totalItems: 0, percent: 0 };
  const day = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  let completedItems = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const done = completions[dateKey(d)] ?? [];
    completedItems += active.filter((template) => done.includes(template.id)).length;
  }
  const totalItems = active.length * 7;
  return { completedItems, totalItems, percent: Math.round((completedItems / totalItems) * 100) };
}

// 状态计数（供热力图与趋势图复用）
export const STATUS_ORDER: TaskStatus[] = ['todo', 'in-progress', 'done'];
