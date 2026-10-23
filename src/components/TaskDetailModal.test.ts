/**
 * TaskDetailModal 的渲染冒烟测试。
 *
 * 与 DateScopeBar.test.ts 同一套路：用 `react-dom/server` 渲染成字符串（不加载 DOM），
 * 验证只读详情弹窗展示的是完整内容而不是卡片上的截断版本。
 * Modal 里依赖 window/document 的逻辑都在 effect 中，SSR 下不会执行。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import TaskDetailModal from './TaskDetailModal';

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

const noop = () => undefined;

function render(over: Partial<Task> = {}, open = true): string {
  return renderToStaticMarkup(
    createElement(TaskDetailModal, { open, task: task(over), onClose: noop, onEdit: noop }),
  );
}

describe('TaskDetailModal 渲染冒烟', () => {
  it('展示完整标题与未被截断的长描述', () => {
    const longDescription =
      '第一行：写清楚验收标准。\n第二行：把边界条件也列出来，避免联调时反复确认。\n第三行：结尾补一句备注。';
    const html = render({
      title: '重构任务详情弹窗',
      description: longDescription,
      priority: 'high',
      status: 'in-progress',
    });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="任务详情"');
    expect(html).toContain('重构任务详情弹窗');
    // 卡片上用的是 line-clamp-2，详情里必须是全文（含换行）
    expect(html).toContain('第一行：写清楚验收标准。');
    expect(html).toContain('第三行：结尾补一句备注。');
    expect(html).not.toContain('line-clamp');
    expect(html).toContain('进行中');
    expect(html).toContain('高优先级');
  });

  it('空描述与未设置的时间给出占位文案', () => {
    const html = render();

    expect(html).toContain('暂无详细描述');
    expect(html).toContain('未安排');
    expect(html).toContain('无截止日期');
    // createdAt / updatedAt 为 0 时不能渲染成 1970 年
    expect(html).not.toContain('1970');
    expect(html).toContain('创建时间');
    expect(html).toContain('最后更新');
  });

  it('有开始/截止/创建时间时按统一格式展示', () => {
    const createdAt = new Date(2024, 4, 6, 7, 8).getTime();
    const html = render({
      startDate: '2024-05-06T09:00',
      dueDate: '2024-05-07T18:00',
      createdAt,
      updatedAt: createdAt,
    });

    expect(html).toContain('2024/05/06 09:00');
    expect(html).toContain('2024/05/07 18:00');
    expect(html).toContain('2024/05/06 07:08');
    expect(html).not.toContain('未安排');
  });

  it('已归档且已完成的任务带对应徽标', () => {
    const html = render({
      status: 'done',
      archived: true,
      completedAt: new Date(2024, 4, 7, 10, 30).getTime(),
    });

    expect(html).toContain('已完成');
    expect(html).toContain('已归档');
    expect(html).toContain('完成时间');
    expect(html).toContain('2024/05/07 10:30');
  });

  it('open=false 时不渲染弹窗', () => {
    const html = render({ title: '不该出现' }, false);
    expect(html).toBe('');
  });
});
