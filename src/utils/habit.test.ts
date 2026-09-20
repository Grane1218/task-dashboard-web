import { describe, expect, it } from 'vitest';
import type { HabitReminderSettings, TaskTemplate } from '../types/habit';
import { isInQuietHours } from './quietHours';
import {
  buildHabitReminderBody,
  calcStreak,
  dateKey,
  formatDateKey,
  getDayStats,
  hasReachedTime,
  hasSentToday,
  pad2,
  shouldTriggerHabitReminder,
  todayKey,
} from './habit';

function template(id: string, archived = false): TaskTemplate {
  return { id, title: id, createdAt: new Date().toISOString(), archived };
}

const settings = (over: Partial<HabitReminderSettings> = {}): HabitReminderSettings => ({
  enabled: true,
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
  ...over,
});

describe('日期工具', () => {
  it('pad2 / dateKey / todayKey / formatDateKey', () => {
    expect(pad2(3)).toBe('03');
    expect(dateKey(new Date(2024, 4, 6))).toBe('2024-05-06');
    expect(todayKey()).toBe(dateKey(new Date()));
    expect(formatDateKey('2024-05-06')).toBe('2024/05/06');
    expect(formatDateKey('')).toBe('');
    expect(formatDateKey('bad')).toBe('bad');
  });
});

describe('getDayStats', () => {
  it('统计当天完成数/总数', () => {
    const stats = getDayStats('2024-05-06', [template('a'), template('b')], { '2024-05-06': ['a'] });
    expect(stats).toEqual({ total: 2, completed: 1 });
  });
});

describe('calcStreak', () => {
  const keyFor = (offset: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return dateKey(d);
  };

  it('没有习惯时返回 0', () => {
    expect(calcStreak([], {})).toBe(0);
  });

  it('今天未全部完成时从昨天往前算', () => {
    const templates = [template('a')];
    const completions = { [keyFor(1)]: ['a'], [keyFor(2)]: ['a'] };
    expect(calcStreak(templates, completions)).toBe(2);
  });

  it('今天全部完成则包含今天', () => {
    const templates = [template('a')];
    const completions = { [keyFor(0)]: ['a'], [keyFor(1)]: ['a'] };
    expect(calcStreak(templates, completions)).toBe(2);
  });

  it('中间断档则停止累计', () => {
    const templates = [template('a')];
    const completions = { [keyFor(0)]: ['a'], [keyFor(1)]: ['a'], [keyFor(3)]: ['a'] };
    expect(calcStreak(templates, completions)).toBe(2);
  });
});

describe('shouldTriggerHabitReminder', () => {
  const pending = [template('a')];
  const at = (h: number, m = 0): Date => new Date(2024, 4, 6, h, m);

  it('未启用时不提醒', () => {
    expect(shouldTriggerHabitReminder(settings({ enabled: false }), pending, at(10)).reason).toBe('disabled');
  });

  it('全部完成时不提醒', () => {
    expect(shouldTriggerHabitReminder(settings(), [], at(10)).reason).toBe('all-done');
  });

  it('未到提醒时间不提醒', () => {
    expect(shouldTriggerHabitReminder(settings(), pending, at(8, 59)).reason).toBe('not-time');
  });

  it('到达时间且未发送过则提醒', () => {
    const result = shouldTriggerHabitReminder(settings(), pending, at(9));
    expect(result.shouldNotify).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('静默时段优先于提醒时间', () => {
    const s = settings({ quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' });
    expect(shouldTriggerHabitReminder(s, pending, at(23)).reason).toBe('quiet-hours');
  });

  it('当天已发送则不再提醒', () => {
    const s = settings({ lastSentAt: at(9).getTime() });
    expect(shouldTriggerHabitReminder(s, pending, at(11)).reason).toBe('already-sent');
  });

  it('昨天发送过不影响今天', () => {
    const s = settings({ lastSentAt: new Date(2024, 4, 5, 9).getTime() });
    expect(shouldTriggerHabitReminder(s, pending, at(11)).shouldNotify).toBe(true);
  });
});

describe('hasReachedTime / hasSentToday', () => {
  it('按分钟比较', () => {
    expect(hasReachedTime(settings({ time: '09:00' }), new Date(2024, 4, 6, 8, 59))).toBe(false);
    expect(hasReachedTime(settings({ time: '09:00' }), new Date(2024, 4, 6, 9, 0))).toBe(true);
  });

  it('未发送过时为 false', () => {
    expect(hasSentToday(settings(), new Date())).toBe(false);
  });
});

describe('buildHabitReminderBody', () => {
  it('3 项以内列出全部', () => {
    expect(buildHabitReminderBody([template('喝水'), template('阅读')])).toBe('还有 2 项习惯未完成：喝水、阅读');
  });

  it('超过 3 项时截断', () => {
    const body = buildHabitReminderBody([template('a'), template('b'), template('c'), template('d')]);
    expect(body).toBe('还有 4 项习惯未完成：a、b、c...等');
  });
});

describe('isInQuietHours（习惯与任务共用）', () => {
  it('未开启静默时为 false', () => {
    expect(isInQuietHours({ quietEnabled: false, quietStart: '22:00', quietEnd: '08:00' }, new Date(2024, 4, 6, 23))).toBe(
      false,
    );
  });

  it('跨天区间 22:00-08:00', () => {
    const s = { quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
    expect(isInQuietHours(s, new Date(2024, 4, 6, 23))).toBe(true);
    expect(isInQuietHours(s, new Date(2024, 4, 6, 7, 59))).toBe(true);
    expect(isInQuietHours(s, new Date(2024, 4, 6, 12))).toBe(false);
  });

  it('同日区间 12:00-14:00', () => {
    const s = { quietEnabled: true, quietStart: '12:00', quietEnd: '14:00' };
    expect(isInQuietHours(s, new Date(2024, 4, 6, 13))).toBe(true);
    expect(isInQuietHours(s, new Date(2024, 4, 6, 14))).toBe(false);
  });

  it('起止相同时视为未配置静默', () => {
    const s = { quietEnabled: true, quietStart: '09:00', quietEnd: '09:00' };
    expect(isInQuietHours(s, new Date(2024, 4, 6, 9))).toBe(false);
  });
});
