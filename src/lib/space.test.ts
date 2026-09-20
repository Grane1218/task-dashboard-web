import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveSpaceTag, getSpaceSecret, getSpaceTag, hasSpaceChanged, isSpaceIsolated, markSpaceSynced, setSpaceSecret } from './space';

beforeEach(() => {
  window.localStorage.clear();
  setSpaceSecret('');
});

afterEach(() => {
  setSpaceSecret('');
  window.localStorage.clear();
});

describe('deriveSpaceTag', () => {
  it('确定性：同一密钥每次得到相同标签', () => {
    expect(deriveSpaceTag('my-secret')).toBe(deriveSpaceTag('my-secret'));
  });

  it('不同密钥得到不同标签', () => {
    expect(deriveSpaceTag('a')).not.toBe(deriveSpaceTag('b'));
  });

  it('输出 16 位十六进制', () => {
    expect(deriveSpaceTag('hello world')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('支持中文等多字节字符', () => {
    expect(deriveSpaceTag('空间密钥')).toMatch(/^[0-9a-f]{16}$/);
    expect(deriveSpaceTag('空间密钥')).not.toBe(deriveSpaceTag('空间密钥2'));
  });

  it('为已知输入提供稳定的快照值（跨设备一致性）', () => {
    // 该值必须跨设备、跨浏览器一致，改动算法会导致已有空间"看不见"数据
    expect(deriveSpaceTag('')).toBe('cbf29ce484222325');
  });
});

describe('空间密钥读写', () => {
  it('默认未设置（兼容模式）', () => {
    expect(getSpaceSecret()).toBe('');
    expect(getSpaceTag()).toBe('');
    expect(isSpaceIsolated()).toBe(false);
  });

  it('设置后启用隔离', () => {
    setSpaceSecret('  secret  ');
    expect(getSpaceSecret()).toBe('secret');
    expect(getSpaceTag()).toBe(deriveSpaceTag('secret'));
    expect(isSpaceIsolated()).toBe(true);
  });

  it('可以清除回兼容模式', () => {
    setSpaceSecret('secret');
    setSpaceSecret('');
    expect(getSpaceTag()).toBe('');
  });

  it('写入 localStorage 以便刷新后保留', () => {
    setSpaceSecret('secret');
    expect(window.localStorage.getItem('task-dashboard-space-key')).toBe('secret');
  });
});

describe('hasSpaceChanged', () => {
  it('从未同步过时返回 false（首次使用不算切换）', () => {
    setSpaceSecret('secret');
    expect(hasSpaceChanged()).toBe(false);
  });

  it('同步后密钥未变返回 false', () => {
    setSpaceSecret('secret');
    markSpaceSynced();
    expect(hasSpaceChanged()).toBe(false);
  });

  it('换了密钥返回 true（触发迁移而非跨空间合并）', () => {
    setSpaceSecret('secret-a');
    markSpaceSynced();
    setSpaceSecret('secret-b');
    expect(hasSpaceChanged()).toBe(true);
  });
});
