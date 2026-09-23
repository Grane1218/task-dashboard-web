/**
 * DateScopeBar 的渲染冒烟测试。
 *
 * 用 `react-dom/server` 把组件渲染成字符串（不加载 DOM），验证：
 * - 默认「全部」模式与日期模式的摘要文案计算正确（已归档不计入）；
 * - 月历弹层默认关闭。
 * 组件内依赖 window/document 的逻辑都写在 effect 里，SSR 下不会执行。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import DateScopeBar from './DateScopeBar';

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

const tasks: Task[] = [
  task({ id: 'no-date' }),
  task({ id: 'start-only', startDate: '2026-02-10T09:00' }),
  task({ id: 'span', startDate: '2026-02-10T09:00', dueDate: '2026-02-14T18:00' }),
  task({ id: 'archived', archived: true }),
];

const noop = () => undefined;

describe('DateScopeBar 渲染冒烟', () => {
  it('「全部」模式：三列不受影响的默认视图', () => {
    const html = renderToStaticMarkup(
      createElement(DateScopeBar, {
        scope: { mode: 'all', date: '', followToday: false },
        onChange: noop,
        tasks,
        onCreateOnDate: noop,
      }),
    );
    expect(html).toContain('全部任务 · 看板共 3 项'); // 已归档不计入
    expect(html).toContain('日期视图');
    expect(html).toContain('aria-label="本周日期"');
  });

  it('日期模式：摘要按「当天 / 共显示 / 未设完整日期」正确计算', () => {
    const html = renderToStaticMarkup(
      createElement(DateScopeBar, {
        scope: { mode: 'day', date: '2026-02-14', followToday: false },
        onChange: noop,
        tasks,
        onCreateOnDate: noop,
      }),
    );
    expect(html).toContain('当天 1 项，共显示 3 项');
    expect(html).toContain('2 项未设完整日期，始终显示');
  });

  it('月历弹层默认关闭，不渲染弹层内容', () => {
    const html = renderToStaticMarkup(
      createElement(DateScopeBar, {
        scope: { mode: 'day', date: '2026-02-14', followToday: true },
        onChange: noop,
        tasks,
        onCreateOnDate: noop,
      }),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
  });
});
