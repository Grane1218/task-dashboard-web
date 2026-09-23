import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  DEFAULT_DATE_SCOPE,
  countAlwaysVisibleTasks,
  countTasksOnDate,
  countVisibleTasksOnDate,
  dayOfMonth,
  formatScopeLabel,
  matchesSelectedDate,
  parseDateKey,
  readDateScope,
  scopeDateKey,
  shiftDateKey,
  taskDateKeys,
  todayKeyOf,
  weekdayLabel,
  weekKeysOf,
  writeDateScope,
  type DateScope,
} from './dateScope';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: 't',
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

const scope = (over: Partial<DateScope> = {}): DateScope => ({ ...DEFAULT_DATE_SCOPE, ...over });

describe('parseDateKey', () => {
  it('按本地时区解析，不受 UTC 影响', () => {
    const parsed = parseDateKey('2026-02-14');
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(14);
    expect(parsed?.getHours()).toBe(0);
  });

  it('拒绝格式错误与日历上不存在的日期', () => {
    expect(parseDateKey('')).toBeNull();
    expect(parseDateKey('2026-2-14')).toBeNull();
    expect(parseDateKey('2026/02/14')).toBeNull();
    expect(parseDateKey('2026-02-31')).toBeNull();
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('not-a-date')).toBeNull();
  });

  it('接受闰年 2 月 29 日', () => {
    expect(parseDateKey('2024-02-29')).not.toBeNull();
    expect(parseDateKey('2026-02-29')).toBeNull();
  });
});

describe('shiftDateKey / weekKeysOf', () => {
  it('跨月与跨年位移正确', () => {
    expect(shiftDateKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('非法输入原样返回，不抛错', () => {
    expect(shiftDateKey('', 3)).toBe('');
    expect(shiftDateKey('2026-02-31', 1)).toBe('2026-02-31');
  });

  it('本周以周一为起点，共 7 天', () => {
    // 2026-02-14 是周六 → 本周为 02-09(周一) ~ 02-15(周日)
    expect(weekKeysOf('2026-02-14')).toEqual([
      '2026-02-09',
      '2026-02-10',
      '2026-02-11',
      '2026-02-12',
      '2026-02-13',
      '2026-02-14',
      '2026-02-15',
    ]);
  });

  it('周一自身与周日都归属同一周（不跨到下周）', () => {
    expect(weekKeysOf('2026-02-09')[0]).toBe('2026-02-09');
    expect(weekKeysOf('2026-02-15')[6]).toBe('2026-02-15');
    expect(weekKeysOf('2026-02-15')[0]).toBe('2026-02-09');
  });

  it('跨月/跨年的周也能正确展开', () => {
    expect(weekKeysOf('2026-01-01')).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('非法输入返回空数组', () => {
    expect(weekKeysOf('')).toEqual([]);
  });
});

describe('weekdayLabel / dayOfMonth / formatScopeLabel', () => {
  it('周几与几号', () => {
    expect(weekdayLabel('2026-02-14')).toBe('周六');
    expect(weekdayLabel('2026-02-09')).toBe('周一');
    expect(weekdayLabel('2026-02-15')).toBe('周日');
    expect(dayOfMonth('2026-02-14')).toBe(14);
    expect(dayOfMonth('bad')).toBe(0);
  });

  it('今天/明天/昨天带后缀，其它日期不带', () => {
    const now = new Date(2026, 1, 14, 10, 0);
    expect(formatScopeLabel('2026-02-14', now)).toBe('2月14日 周六 · 今天');
    expect(formatScopeLabel('2026-02-15', now)).toBe('2月15日 周日 · 明天');
    expect(formatScopeLabel('2026-02-13', now)).toBe('2月13日 周五 · 昨天');
    expect(formatScopeLabel('2026-02-20', now)).toBe('2月20日 周五');
  });

  it('跨年时补上年份', () => {
    const now = new Date(2026, 1, 14);
    expect(formatScopeLabel('2025-12-31', now)).toBe('2025年12月31日 周三');
  });

  it('非法日期原样返回', () => {
    expect(formatScopeLabel('', new Date(2026, 1, 14))).toBe('');
  });
});

describe('scopeDateKey', () => {
  it('「全部」模式返回 null（不按日期过滤）', () => {
    expect(scopeDateKey(DEFAULT_DATE_SCOPE)).toBeNull();
    expect(scopeDateKey(scope({ mode: 'all', date: '2026-02-14' }))).toBeNull();
  });

  it('固定日期模式返回所选日期', () => {
    const now = new Date(2026, 1, 14);
    expect(scopeDateKey(scope({ mode: 'day', date: '2026-02-20' }), now)).toBe('2026-02-20');
  });

  it('followToday 跨天后自动跟随到新的一天', () => {
    const day1 = new Date(2026, 1, 14, 23, 30);
    const day2 = new Date(2026, 1, 15, 0, 10);
    const scoped = scope({ mode: 'day', date: '2026-02-14', followToday: true });
    expect(scopeDateKey(scoped, day1)).toBe('2026-02-14');
    expect(scopeDateKey(scoped, day2)).toBe('2026-02-15');
  });

  it('日期字段非法时回退到今天（不显示空视图）', () => {
    const now = new Date(2026, 1, 14, 8, 0);
    expect(scopeDateKey(scope({ mode: 'day', date: '' }), now)).toBe(todayKeyOf(now));
    expect(scopeDateKey(scope({ mode: 'day', date: '2026-02-31' }), now)).toBe(todayKeyOf(now));
  });
});

describe('matchesSelectedDate（核心口径）', () => {
  it('开始与截止都未设置 → 任何日期都显示', () => {
    const t = task();
    expect(matchesSelectedDate(t, '2026-02-14')).toBe(true);
    expect(matchesSelectedDate(t, '1999-01-01')).toBe(true);
  });

  it('只设了开始日期 → 任何日期都显示（缺任一日期即常显）', () => {
    const t = task({ startDate: '2026-02-10T09:00' });
    expect(matchesSelectedDate(t, '2026-02-10')).toBe(true);
    expect(matchesSelectedDate(t, '2026-03-01')).toBe(true);
  });

  it('只设了截止日期 → 任何日期都显示', () => {
    const t = task({ dueDate: '2026-02-14T18:00' });
    expect(matchesSelectedDate(t, '2026-02-14')).toBe(true);
    expect(matchesSelectedDate(t, '2026-01-01')).toBe(true);
  });

  it('两个日期都设置：命中开始日或截止日才显示', () => {
    const t = task({ startDate: '2026-02-10T09:00', dueDate: '2026-02-14T18:00' });
    expect(matchesSelectedDate(t, '2026-02-10')).toBe(true);
    expect(matchesSelectedDate(t, '2026-02-14')).toBe(true);
    expect(matchesSelectedDate(t, '2026-02-12')).toBe(false); // 区间中间不显示（严格按当日日期）
    expect(matchesSelectedDate(t, '2026-02-15')).toBe(false);
  });

  it('开始与截止同一天：只在该日显示（不会被误判成常显）', () => {
    const t = task({ startDate: '2026-02-14T09:00', dueDate: '2026-02-14T18:00' });
    expect(matchesSelectedDate(t, '2026-02-14')).toBe(true);
    expect(matchesSelectedDate(t, '2026-02-13')).toBe(false);
    expect(matchesSelectedDate(t, '2026-02-15')).toBe(false);
  });

  it('旧数据 "YYYY-MM-DD"（无时刻）同样按当天匹配', () => {
    const t = task({ startDate: '2026-02-01', dueDate: '2026-02-02' });
    expect(matchesSelectedDate(t, '2026-02-01')).toBe(true);
    expect(matchesSelectedDate(t, '2026-02-02')).toBe(true);
    expect(matchesSelectedDate(t, '2026-02-03')).toBe(false);
  });

  it('非法日期按「未设置」处理 → 常显（不因脏数据把任务藏起来）', () => {
    const t = task({ startDate: '???', dueDate: '' });
    expect(matchesSelectedDate(t, '2026-02-14')).toBe(true);
    expect(matchesSelectedDate(task({ startDate: '2026-02-31', dueDate: '2026-03-01' }), '2026-05-05')).toBe(true);
  });

  it('跨年任务在正确年份命中', () => {
    const t = task({ startDate: '2025-12-31T22:00', dueDate: '2026-01-01T02:00' });
    expect(matchesSelectedDate(t, '2025-12-31')).toBe(true);
    expect(matchesSelectedDate(t, '2026-01-01')).toBe(true);
    expect(matchesSelectedDate(t, '2026-12-31')).toBe(false);
  });
});

describe('taskDateKeys 与计数', () => {
  const tasks: Task[] = [
    task({ id: 'no-date' }),
    task({ id: 'start-only', startDate: '2026-02-10T09:00' }),
    task({ id: 'due-only', dueDate: '2026-02-14T18:00' }),
    task({ id: 'span', startDate: '2026-02-10T09:00', dueDate: '2026-02-14T18:00' }),
    task({ id: 'same-day', startDate: '2026-02-14T09:00', dueDate: '2026-02-14T18:00' }),
  ];

  it('有效日期键去重且忽略未设置/非法', () => {
    expect(taskDateKeys(tasks[0])).toEqual([]);
    expect(taskDateKeys(tasks[1])).toEqual(['2026-02-10']);
    expect(taskDateKeys(tasks[3])).toEqual(['2026-02-10', '2026-02-14']);
    expect(taskDateKeys(tasks[4])).toEqual(['2026-02-14']);
  });

  it('角标计数：该日「安排了」的任务数（开始日或截止日命中）', () => {
    expect(countTasksOnDate(tasks, '2026-02-10')).toBe(2); // start-only + span
    expect(countTasksOnDate(tasks, '2026-02-14')).toBe(3); // due-only + span + same-day
    expect(countTasksOnDate(tasks, '2026-02-11')).toBe(0);
  });

  it('常显任务计数与实显计数', () => {
    expect(countAlwaysVisibleTasks(tasks)).toBe(3); // no-date + start-only + due-only
    expect(countVisibleTasksOnDate(tasks, '2026-02-14')).toBe(5); // 3 常显 + span + same-day
    expect(countVisibleTasksOnDate(tasks, '2026-02-11')).toBe(3); // 仅常显
  });
});

describe('readDateScope / writeDateScope', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('无存储时默认「全部」模式（与改造前行为一致）', () => {
    expect(readDateScope()).toEqual(DEFAULT_DATE_SCOPE);
  });

  it('写入后可原样读回', () => {
    writeDateScope({ mode: 'day', date: '2026-02-14', followToday: false });
    expect(readDateScope()).toEqual({ mode: 'day', date: '2026-02-14', followToday: false });
    writeDateScope({ mode: 'all', date: '2026-02-14', followToday: false });
    expect(readDateScope().mode).toBe('all');
  });

  it('坏 JSON 回退默认值，不抛错', () => {
    window.localStorage.setItem('task-dashboard-date-scope', '{oops');
    expect(readDateScope()).toEqual(DEFAULT_DATE_SCOPE);
  });

  it('字段非法时回退默认值', () => {
    window.localStorage.setItem(
      'task-dashboard-date-scope',
      JSON.stringify({ mode: 'day', date: '2026-02-31', followToday: false }),
    );
    expect(readDateScope()).toEqual(DEFAULT_DATE_SCOPE);
    window.localStorage.setItem(
      'task-dashboard-date-scope',
      JSON.stringify({ mode: 'day', date: '2026-02-14', followToday: false }),
    );
    expect(readDateScope().mode).toBe('day');
  });

  it('followToday 标记被保留', () => {
    window.localStorage.setItem(
      'task-dashboard-date-scope',
      JSON.stringify({ mode: 'day', date: '2026-02-14', followToday: true }),
    );
    expect(readDateScope()).toEqual({ mode: 'day', date: '2026-02-14', followToday: true });
  });
});
