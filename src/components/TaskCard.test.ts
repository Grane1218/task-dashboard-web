/**
 * TaskCard 的渲染冒烟测试：只验证「查看任务内容」入口存在且语义正确，
 * 以及卡片本身仍然截断描述（全文在 TaskDetailModal 里看）。
 * 交互（点击/拖拽/Toast）不在 SSR 覆盖范围内，见 手动测试清单 P1-2.9~P1-2.11。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import TaskCard from './TaskCard';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: '示例任务',
    description: '描述',
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

function render(over: Partial<Task> = {}): string {
  return renderToStaticMarkup(
    createElement(TaskCard, {
      task: task(over),
      onEdit: noop,
      onDelete: noop,
      onFocus: noop,
      onView: noop,
    }),
  );
}

describe('TaskCard 渲染冒烟', () => {
  it('操作区提供「查看任务内容」入口（带可读的 aria-label 与 title）', () => {
    const html = render();
    expect(html).toContain('aria-label="查看任务内容"');
    expect(html).toContain('title="查看完整任务内容"');
  });

  it('卡片上的描述仍然截断为两行，完整内容交给详情弹窗', () => {
    expect(render()).toContain('line-clamp-2');
  });

  it('已完成任务标题加删除线（详情弹窗沿用同一状态）', () => {
    expect(render({ status: 'done' })).toContain('line-through');
  });
});
