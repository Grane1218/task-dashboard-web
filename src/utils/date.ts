import type { RepeatFrequency, TaskStatus } from '../types';

// 解析时间。支持 "YYYY-MM-DDTHH:mm"（精确到分钟）；兼容旧数据 "YYYY-MM-DD"（按当天 00:00 处理）。
export function parseDueDate(time: string): Date | null {
  const value = time ?? '';
  if (value === '') return null;
  const datePart = value.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  let hour = 0;
  let minute = 0;
  const timePart = value.slice(11);
  if (timePart.length >= 5) {
    const seg = timePart.split(':').map(Number);
    hour = seg[0] ?? 0;
    minute = seg[1] ?? 0;
  }
  return new Date(year, month, day, hour, minute);
}

export function isDueToday(time: string): boolean {
  const date = parseDueDate(time);
  if (date === null) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// 逾期判定（按自然日末计算，不精确到分钟）：
// - 有开始日期：开始日期的次日「自然日末」仍未完成 → 逾期（即开始后第 2 天 00:00 起标记）
// - 有截止日期：截止日期当天「自然日末」仍未完成 → 逾期（即截止后第 1 天 00:00 起标记）
// 今天截止/开始的任务在当天不会标逾期，避免「刚过截止时刻就变红」的误导。
export function isOverdue(startDate: string, dueDate: string, status: TaskStatus): boolean {
  if (status === 'done') return false;
  const now = new Date();

  const start = parseDueDate(startDate);
  if (start !== null) {
    // 开始日期次日 24:00（即 +2 天的 00:00）为最后期限
    const startDeadline = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 2);
    if (startDeadline.getTime() <= now.getTime()) return true;
  }

  const due = parseDueDate(dueDate);
  if (due !== null) {
    // 截止日期当天 24:00（即 +1 天的 00:00）为最后期限
    const dueDeadline = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
    if (dueDeadline.getTime() <= now.getTime()) return true;
  }

  return false;
}

export function formatDate(time: string): string {
  const value = time ?? '';
  if (value === '') return '';
  const datePart = value.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return value;
  const timePart = value.slice(11);
  const timeText = timePart.length >= 5 ? ' ' + timePart.slice(0, 5) : '';
  return parts[0] + '/' + parts[1] + '/' + parts[2] + timeText;
}

// 转成 <input type="datetime-local"> 所需的 "YYYY-MM-DDTHH:mm" 格式
export function toDateTimeLocal(time: string): string {
  const value = time ?? '';
  if (value === '') return '';
  if (value.indexOf('T') >= 0) return value;
  return value + 'T00:00';
}

// 将时间按重复频率顺延一个周期，格式保持 "YYYY-MM-DDTHH:mm"（旧数据可为 "YYYY-MM-DD"，顺延后同样不带时刻）。
// 每月顺延按目标月实际天数截断（如 1/31 +1 月 → 2 月末），避免溢出到下下月。
export function shiftRepeatDateByPeriods(time: string, frequency: RepeatFrequency, periods: number): string {
  const value = time ?? '';
  if (value === '') return '';
  const datePart = value.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return value;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const step = Math.max(0, Math.floor(periods));

  let next: Date;
  if (frequency === 'monthly') {
    const firstOfTarget = new Date(year, month + step, 1);
    const daysInTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
    next = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(day, daysInTarget));
  } else {
    next = new Date(year, month, day + step * (frequency === 'daily' ? 1 : 7));
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const date = next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());
  const timePart = value.slice(11);
  return timePart.length >= 5 ? date + 'T' + timePart.slice(0, 5) : date;
}

/** 向下/向上校正的步数上限（正常只需 1～2 步；仅用于防御异常数据） */
export const MAX_REPEAT_PERIOD_STEPS = 400;

/**
 * 计算重复任务的下一个周期需要顺延多少个周期，使**所有**锚点日期（开始/截止）都落在 now 之后。
 * 返回 >= 1（至少顺延一个周期）。逾期很久才完成的任务会自动跳过已经过去的所有周期，
 * 避免新副本一生成就是逾期状态。
 */
export function repeatPeriodsUntilFuture(
  startDate: string,
  dueDate: string,
  frequency: RepeatFrequency,
  now: Date = new Date(),
): number {
  const anchors = [startDate, dueDate]
    .map((value) => parseDueDate(value))
    .filter((d): d is Date => d !== null);
  if (anchors.length === 0) return 1;

  const isFuture = (count: number): boolean =>
    anchors.every((anchor) => {
      const shifted = parseDueDate(shiftRepeatDateByPeriods(formatDateTimeLike(anchor), frequency, count));
      return shifted !== null && shifted.getTime() > now.getTime();
    });

  // 闭式估算：每个锚点各自需要多少周期，取最大值。
  // 必须逐锚点取最大——开始日期通常远早于截止日期，只按最晚的那个估算会让早的那个仍落在过去。
  const estimateFor = (anchor: Date): number => {
    if (frequency === 'monthly') {
      return (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth()) + 1;
    }
    const msPerPeriod = frequency === 'daily' ? 86400000 : 7 * 86400000;
    return Math.floor((now.getTime() - anchor.getTime()) / msPerPeriod) + 1;
  };
  let periods = Math.max(1, ...anchors.map(estimateFor));

  // 月末截断会让估算偏大（1/31 的下一周期可能是 2/29 而不是 3/31），向下收敛到真正的最小值；
  // 夏令时/月末截断也可能让估算偏小，再向上校正。两步都有硬上限，避免异常数据死循环。
  for (let step = 0; step < MAX_REPEAT_PERIOD_STEPS && periods > 1 && isFuture(periods - 1); step += 1) {
    periods -= 1;
  }
  for (let step = 0; step < MAX_REPEAT_PERIOD_STEPS && !isFuture(periods); step += 1) {
    periods += 1;
  }
  return periods;
}

/** 把 Date 还原成 parseDueDate 能解析的格式（保持本地时区语义） */
function formatDateTimeLike(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

/**
 * 计算重复任务完成后的下一周期日期对。
 * - 顺延周期数由开始/截止日期中「最晚」的那个决定，两者保持原有的周期差
 * - 结果始终落在 now 之后（逾期任务不会生成仍然逾期的副本）
 */
export function shiftRepeatDates(
  startDate: string,
  dueDate: string,
  frequency: RepeatFrequency,
  now: Date = new Date(),
): { startDate: string; dueDate: string } {
  const periods = repeatPeriodsUntilFuture(startDate, dueDate, frequency, now);
  return {
    startDate: shiftRepeatDateByPeriods(startDate, frequency, periods),
    dueDate: shiftRepeatDateByPeriods(dueDate, frequency, periods),
  };
}

/**
 * 单个日期的顺延（向后兼容入口）：从原日期起至少顺延一个周期，直到落在 now 之后。
 */
export function shiftRepeatDate(time: string, frequency: RepeatFrequency, now: Date = new Date()): string {
  const periods = repeatPeriodsUntilFuture(time, '', frequency, now);
  return shiftRepeatDateByPeriods(time, frequency, periods);
}