import { describe, expect, it } from 'vitest';
import type { ReminderSettings, Task } from '../types';
import { hasReachedTime, hasSentInCurrentCycle, shouldTriggerReminder } from './reminderScheduler';
import { toMinutes } from './quietHours';

function task(id: string): Task {
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
  };
}

const settings = (over: Partial<ReminderSettings> = {}): ReminderSettings => ({
  enabled: true,
  frequency: 'daily',
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
  ...over,
});

describe('toMinutes', () => {
  it('解析 HH:mm', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('00:00')).toBe(0);
  });
});

describe('shouldTriggerReminder', () => {
  const pending = [task('a')];
  const at = (h: number, m = 0): Date => new Date(2024, 4, 6, h, m); // 2024-05-06 周一

  it('未启用 / 无任务 / 未到时间 / 已发送 各自的原因', () => {
    expect(shouldTriggerReminder(settings({ enabled: false }), pending, at(10)).reason).toBe('disabled');
    expect(shouldTriggerReminder(settings(), [], at(10)).reason).toBe('no-tasks');
    expect(shouldTriggerReminder(settings(), pending, at(8)).reason).toBe('not-time');
    expect(shouldTriggerReminder(settings({ lastSentAt: at(9).getTime() }), pending, at(10)).reason).toBe('already-sent');
  });

  it('满足条件时提醒', () => {
    const result = shouldTriggerReminder(settings(), pending, at(9));
    expect(result.shouldNotify).toBe(true);
    expect(result.pendingTasks).toEqual(pending);
  });

  it('静默时段内不提醒', () => {
    const s = settings({ quietEnabled: true });
    expect(shouldTriggerReminder(s, pending, at(23)).reason).toBe('quiet-hours');
  });
});

describe('hasReachedTime', () => {
  it('按分钟比较', () => {
    expect(hasReachedTime(settings({ time: '09:00' }), new Date(2024, 4, 6, 8, 59))).toBe(false);
    expect(hasReachedTime(settings({ time: '09:00' }), new Date(2024, 4, 6, 9, 0))).toBe(true);
  });
});

describe('hasSentInCurrentCycle', () => {
  it('每日：同一天算已发送', () => {
    const s = settings({ lastSentAt: new Date(2024, 4, 6, 1).getTime() });
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 6, 23))).toBe(true);
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 7, 1))).toBe(false);
  });

  it('每周：同一自然周（周一起）算已发送', () => {
    // 2024-05-06 是周一，05-12 是周日
    const s = settings({ frequency: 'weekly', lastSentAt: new Date(2024, 4, 6, 9).getTime() });
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 12, 9))).toBe(true);
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 13, 9))).toBe(false);
  });

  it('每周：周日的上一次发送属于上一周', () => {
    // 2024-05-05 是周日，属于 04-29 那一周
    const s = settings({ frequency: 'weekly', lastSentAt: new Date(2024, 4, 5, 9).getTime() });
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 6, 9))).toBe(false);
  });

  it('每月：同一自然月算已发送', () => {
    const s = settings({ frequency: 'monthly', lastSentAt: new Date(2024, 4, 1).getTime() });
    expect(hasSentInCurrentCycle(s, new Date(2024, 4, 31))).toBe(true);
    expect(hasSentInCurrentCycle(s, new Date(2024, 5, 1))).toBe(false);
  });

  it('从未发送过时为 false', () => {
    expect(hasSentInCurrentCycle(settings(), new Date())).toBe(false);
  });
});
