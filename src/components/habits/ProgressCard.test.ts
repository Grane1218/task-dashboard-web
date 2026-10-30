import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProgressCard from './ProgressCard';

describe('ProgressCard', () => {
  it('进度条用 transform: scaleX 表达比例，而不是动画 width', () => {
    const html = renderToStaticMarkup(createElement(ProgressCard, { total: 4, completed: 1, streak: 3 }));

    expect(html).toContain('scaleX(0.25)');
    expect(html).not.toContain('width:25%');
    // 无障碍：进度条带 progressbar 语义与当前值
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="25"');
  });

  it('全部完成时使用完成态配色与满格比例', () => {
    const html = renderToStaticMarkup(createElement(ProgressCard, { total: 2, completed: 2, streak: 5 }));

    expect(html).toContain('scaleX(1)');
    expect(html).toContain('bg-emerald-500');
  });

  it('没有习惯时给空态提示，不显示完成文案', () => {
    const html = renderToStaticMarkup(createElement(ProgressCard, { total: 0, completed: 0, streak: 0 }));

    expect(html).toContain('还没有习惯');
    expect(html).not.toContain('习惯已全部完成');
    expect(html).toContain('scaleX(0)');
  });
});
