import { describe, expect, it } from 'vitest';
import {
  formatDate,
  isOverdue,
  parseDueDate,
  repeatPeriodsUntilFuture,
  shiftRepeatDate,
  shiftRepeatDateByPeriods,
  shiftRepeatDates,
  toDateTimeLocal,
} from './date';

const at = (value: string): Date => new Date(value);

describe('parseDueDate', () => {
  it('解析 YYYY-MM-DDTHH:mm（本地时区，精确到分钟）', () => {
    const d = parseDueDate('2024-05-06T07:08');
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(6);
    expect(d?.getHours()).toBe(7);
    expect(d?.getMinutes()).toBe(8);
  });

  it('兼容旧数据 YYYY-MM-DD（按当天 00:00）', () => {
    const d = parseDueDate('2024-05-06');
    expect(d?.getHours()).toBe(0);
    expect(d?.getMinutes()).toBe(0);
  });

  it('空值/非法值返回 null', () => {
    expect(parseDueDate('')).toBeNull();
    expect(parseDueDate('2024/05/06')).toBeNull();
  });
});

describe('isOverdue', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const key = (d: Date) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  it('已完成任务永不逾期', () => {
    expect(isOverdue('2020-01-01', '2020-01-01', 'done')).toBe(false);
  });

  it('截止日期次日 00:00 起才算逾期（当天不标红）', () => {
    const today = new Date();
    expect(isOverdue('', key(today), 'todo')).toBe(false);
    expect(isOverdue('', key(yesterday), 'todo')).toBe(true);
  });

  it('开始日期超过 2 个自然日仍未完成算逾期', () => {
    expect(isOverdue(key(yesterday), '', 'in-progress')).toBe(false);
    expect(isOverdue(key(twoDaysAgo), '', 'in-progress')).toBe(true);
  });

  it('无日期不逾期', () => {
    expect(isOverdue('', '', 'todo')).toBe(false);
  });
});

describe('formatDate / toDateTimeLocal', () => {
  it('格式化日期与时间', () => {
    expect(formatDate('2024-05-06T07:08')).toBe('2024/05/06 07:08');
    expect(formatDate('2024-05-06')).toBe('2024/05/06');
    expect(formatDate('')).toBe('');
  });

  it('补全 datetime-local 需要的格式', () => {
    expect(toDateTimeLocal('2024-05-06')).toBe('2024-05-06T00:00');
    expect(toDateTimeLocal('2024-05-06T07:08')).toBe('2024-05-06T07:08');
    expect(toDateTimeLocal('')).toBe('');
  });
});

describe('shiftRepeatDateByPeriods', () => {
  it('按周期数顺延，保留时刻', () => {
    expect(shiftRepeatDateByPeriods('2024-01-01T09:30', 'daily', 1)).toBe('2024-01-02T09:30');
    expect(shiftRepeatDateByPeriods('2024-01-01T09:30', 'weekly', 2)).toBe('2024-01-15T09:30');
  });

  it('每月顺延按目标月天数截断（1/31 + 1 月 → 2 月末）', () => {
    expect(shiftRepeatDateByPeriods('2024-01-31', 'monthly', 1)).toBe('2024-02-29');
    expect(shiftRepeatDateByPeriods('2023-01-31', 'monthly', 1)).toBe('2023-02-28');
    expect(shiftRepeatDateByPeriods('2023-01-31', 'monthly', 2)).toBe('2023-03-31');
  });

  it('空值与非法值原样返回', () => {
    expect(shiftRepeatDateByPeriods('', 'daily', 1)).toBe('');
    expect(shiftRepeatDateByPeriods('bad', 'daily', 1)).toBe('bad');
  });
});

describe('repeatPeriodsUntilFuture（逾期任务顺延到未来）', () => {
  it('未逾期时至少顺延一个周期', () => {
    // 2024-01-01 的每日任务，今天也是 2024-01-01 → 仍要顺延到 01-02
    expect(repeatPeriodsUntilFuture('2024-01-01', '', 'daily', at('2024-01-01T23:00'))).toBe(1);
  });

  it('逾期两周的每周任务会跳过已经过去的周期', () => {
    // 起点 1/1，周任务：1/8、1/15、1/22 都已过去，应落到 1/29（截止 2/4）
    expect(shiftRepeatDates('2024-01-01', '2024-01-07', 'weekly', at('2024-01-23T10:00'))).toEqual({
      startDate: '2024-01-29',
      dueDate: '2024-02-04',
    });
  });

  it('开始与截止保持原有周期差（同时顺延相同的周期数）', () => {
    const result = shiftRepeatDates('2024-01-01', '2024-01-05', 'weekly', at('2024-03-01T00:00'));
    expect(result.startDate).toBe('2024-03-04');
    expect(result.dueDate).toBe('2024-03-08');
    // 两者都必须在 now 之后
    expect(new Date(result.startDate + 'T00:00').getTime()).toBeGreaterThan(at('2024-03-01T00:00').getTime());
    expect(new Date(result.dueDate + 'T00:00').getTime()).toBeGreaterThan(at('2024-03-01T00:00').getTime());
  });

  it('无任何日期时返回 1 个周期', () => {
    expect(repeatPeriodsUntilFuture('', '', 'daily', at('2024-01-01T00:00'))).toBe(1);
    expect(shiftRepeatDates('', '', 'daily', at('2024-01-01T00:00'))).toEqual({ startDate: '', dueDate: '' });
  });

  it('副本日期一定落在 now 之后（修复「副本一生成就逾期」）', () => {
    const now = at('2024-06-15T12:00');
    for (const freq of ['daily', 'weekly', 'monthly'] as const) {
      const result = shiftRepeatDates('2023-01-01', '2023-01-03', freq, now);
      expect(parseDueDate(result.startDate)?.getTime() ?? 0).toBeGreaterThan(now.getTime());
      expect(parseDueDate(result.dueDate)?.getTime() ?? 0).toBeGreaterThan(now.getTime());
    }
  });

  it('开始与截止相隔很远时，两者都要落在未来（不能只看较晚的那个）', () => {
    // 每日任务：开始 1/1、截止 6/1（相隔 152 天），7/1 才完成
    const now = at('2024-07-01T12:00');
    const result = shiftRepeatDates('2024-01-01', '2024-06-01', 'daily', now);
    expect(parseDueDate(result.startDate)?.getTime() ?? 0).toBeGreaterThan(now.getTime());
    expect(parseDueDate(result.dueDate)?.getTime() ?? 0).toBeGreaterThan(now.getTime());
    // 顺延周期数由较早的开始日期决定（183 天后两日期一起落到未来）
    expect(result.startDate).toBe('2024-07-02');
    expect(result.dueDate).toBe('2024-12-01');
  });

  it('月末截断不会跳过仍然有效的更早周期', () => {
    // 1/31 每月重复，2/1 完成 → 下一周期应是被截断的 2/29，而不是 3/31
    expect(shiftRepeatDates('2024-01-31', '2024-01-31', 'monthly', at('2024-02-01T00:00'))).toEqual({
      startDate: '2024-02-29',
      dueDate: '2024-02-29',
    });
  });

  it('长期未完成的月度任务不会无限循环，且结果仍在未来', () => {
    const now = at('2024-01-01T00:00');
    const periods = repeatPeriodsUntilFuture('1900-01-01', '', 'monthly', now);
    expect(periods).toBeGreaterThan(0);
    expect(periods).toBeLessThan(2000);
    expect(new Date(shiftRepeatDateByPeriods('1900-01-01', 'monthly', periods) + 'T00:00').getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });
});

describe('shiftRepeatDate（单日期兼容入口）', () => {
  it('逾期时顺延到未来', () => {
    expect(shiftRepeatDate('2024-01-01', 'daily', at('2024-01-05T10:00'))).toBe('2024-01-06');
  });

  it('未逾期时顺延一个周期', () => {
    expect(shiftRepeatDate('2024-01-01T09:00', 'daily', at('2024-01-01T08:00'))).toBe('2024-01-02T09:00');
  });
});
