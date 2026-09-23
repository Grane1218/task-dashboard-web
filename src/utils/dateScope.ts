import type { Task } from '../types';
import { dateKey as toDateKey } from './habit';

/**
 * 看板「日期视图」的纯逻辑层。
 *
 * 设计要点（与 UI 解耦，便于单测）：
 * - 日期一律以 **本地时区** 构造（`new Date(y, m - 1, d)`），绝不用 `new Date('2026-02-14')`
 *   ——后者按 UTC 解析，东八区会整体偏成前一天；
 * - 「日期作用域」是纯粹的显示过滤：不改任务数据、不进云端同步、不进备份，
 *   只保存在独立的 localStorage 键里；
 * - 过滤口径：`startDate` 与 `dueDate` **任一未设置（或非法）** → 任务在任何日期下都显示；
 *   只有两个日期都有效时才要求「其中一个等于选中日期」。
 */

export interface DateScope {
  mode: 'all' | 'day';
  /** 选中日期 "YYYY-MM-DD"；mode='all' 时保留上次选择但忽略 */
  date: string;
  /** true = 用户点的是「今天」：跨天后自动跟随到新的一天 */
  followToday: boolean;
}

export const DEFAULT_DATE_SCOPE: DateScope = { mode: 'all', date: '', followToday: false };

const STORAGE_KEY = 'task-dashboard-date-scope';
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 周一为一周的起点（与 CalendarView 的 `(getDay() + 6) % 7` 保持一致） */
const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_FULL = ['日', '一', '二', '三', '四', '五', '六'];

export function todayKeyOf(now: Date = new Date()): string {
  return toDateKey(now);
}

/** 解析 "YYYY-MM-DD" 为本地 00:00 的 Date；格式或日历日期非法（如 2026-02-31）返回 null */
export function parseDateKey(key: string): Date | null {
  const value = typeof key === 'string' ? key : '';
  if (!DATE_KEY_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(year, month - 1, day);
  // 回读校验：溢出日期（2 月 31 日）会被 Date 静默滚到下个月，必须拦掉
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** 日期键位移（跨月/跨年/闰年由 Date 处理）；非法输入原样返回 */
export function shiftDateKey(key: string, days: number): string {
  const date = parseDateKey(key);
  if (date === null) return key;
  const step = Number.isFinite(days) ? Math.trunc(days) : 0;
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + step));
}

/** 该日期所在自然周（周一 → 周日）的 7 个日期键；非法输入返回空数组 */
export function weekKeysOf(key: string): string[] {
  const date = parseDateKey(key);
  if (date === null) return [];
  const offset = (date.getDay() + 6) % 7; // 周一 = 0
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) =>
    toDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
}

/** 周几短标签：「周一」…「周日」 */
export function weekdayLabel(key: string): string {
  const date = parseDateKey(key);
  if (date === null) return '';
  return '周' + WEEKDAY_SHORT[(date.getDay() + 6) % 7];
}

/** 该日期是几号（1-31）；非法输入返回 0 */
export function dayOfMonth(key: string): number {
  return parseDateKey(key)?.getDate() ?? 0;
}

/**
 * 作用域解析成「实际选中的日期键」：'all' → null（不按日期过滤）。
 * `followToday` 为 true 时始终返回「今天」，从而跨天自动跟随，不会停在昨天。
 */
export function scopeDateKey(scope: DateScope, now: Date = new Date()): string | null {
  if (scope.mode !== 'day') return null;
  if (scope.followToday) return todayKeyOf(now);
  return parseDateKey(scope.date) === null ? todayKeyOf(now) : scope.date;
}

/** 把任务上的时间字段规范化成日期键；未设置或非法 → null */
function normalizeTaskDate(value: string): string | null {
  const raw = (typeof value === 'string' ? value : '').slice(0, 10);
  return parseDateKey(raw) === null ? null : raw;
}

/** 任务的有效日期键（去重）：未设置/非法的日期不参与 */
export function taskDateKeys(task: Task): string[] {
  const start = normalizeTaskDate(task.startDate);
  const due = normalizeTaskDate(task.dueDate);
  const keys: string[] = [];
  if (start !== null) keys.push(start);
  if (due !== null && due !== start) keys.push(due);
  return keys;
}

/**
 * 任务是否「不设完整日期」：开始或截止任一未设置（或非法）→ 任何日期下都常显。
 * 只有两个日期都有效时，任务才受日期视图约束。
 */
export function isAlwaysVisible(task: Task): boolean {
  return normalizeTaskDate(task.startDate) === null || normalizeTaskDate(task.dueDate) === null;
}

/** 日期视图下的可见判定 */
export function matchesSelectedDate(task: Task, dateKey: string): boolean {
  if (isAlwaysVisible(task)) return true;
  return taskDateKeys(task).includes(dateKey);
}

/** 该日期「安排了」的任务数（开始日或截止日命中，用于日期条角标） */
export function countTasksOnDate(tasks: Task[], dateKey: string): number {
  let count = 0;
  for (const task of tasks) if (taskDateKeys(task).includes(dateKey)) count += 1;
  return count;
}

/** 日期视图中「始终显示」的任务数（未设完整日期） */
export function countAlwaysVisibleTasks(tasks: Task[]): number {
  let count = 0;
  for (const task of tasks) if (isAlwaysVisible(task)) count += 1;
  return count;
}

/** 选中该日期时看板实际会显示的任务数 */
export function countVisibleTasksOnDate(tasks: Task[], dateKey: string): number {
  let count = 0;
  for (const task of tasks) if (matchesSelectedDate(task, dateKey)) count += 1;
  return count;
}

/** 「2月14日 周六 · 今天」这类可读标签（跨年时补上年份） */
export function formatScopeLabel(dateKey: string, now: Date = new Date()): string {
  const date = parseDateKey(dateKey);
  if (date === null) return dateKey;
  const base = date.getMonth() + 1 + '月' + date.getDate() + '日 周' + WEEKDAY_FULL[date.getDay()];
  const today = todayKeyOf(now);
  if (dateKey === today) return base + ' · 今天';
  if (dateKey === shiftDateKey(today, 1)) return base + ' · 明天';
  if (dateKey === shiftDateKey(today, -1)) return base + ' · 昨天';
  return date.getFullYear() === now.getFullYear() ? base : date.getFullYear() + '年' + base;
}

/**
 * 读取持久化的日期视图选择。
 * - 坏 JSON / 存储不可用 / 字段非法 → 回退「全部」模式（保持改造前的默认行为）；
 * - `followToday` 的解析交给 `scopeDateKey`，这里只做格式校验。
 */
export function readDateScope(): DateScope {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DATE_SCOPE;
    const parsed = JSON.parse(raw) as Partial<DateScope>;
    // 用 parseDateKey 校验（而非只测格式）："2026-02-31" 这类日历上不存在的日期必须落回默认值，
    // 否则 scopeDateKey 会静默把它替换成「今天」，用户看到的是一个没选过的日期。
    const date = typeof parsed.date === 'string' && parseDateKey(parsed.date) !== null ? parsed.date : '';
    if (parsed.mode !== 'day') return { mode: 'all', date, followToday: false };
    if (parsed.followToday === true) return { mode: 'day', date, followToday: true };
    if (date === '') return DEFAULT_DATE_SCOPE; // 日期不完整 → 回退「全部」，避免显示一个随机日期
    return { mode: 'day', date, followToday: false };
  } catch {
    return DEFAULT_DATE_SCOPE;
  }
}

export function writeDateScope(scope: DateScope): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // localStorage 不可用时静默降级：本次会话内选择仍在内存中生效
  }
}
