import { defineConfig } from 'vitest/config';

/**
 * 单元测试覆盖纯逻辑（utils / lib）与组件的「服务端渲染冒烟」
 * （react-dom/server 渲染成字符串，不加载 DOM / jsdom）。
 * 需要 localStorage 的模块由 src/test/setup.ts 提供最小桩实现。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    globals: false,
  },
});
