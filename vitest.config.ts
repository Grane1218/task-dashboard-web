import { defineConfig } from 'vitest/config';

/**
 * 单元测试只覆盖纯逻辑（utils / lib），不加载 DOM。
 * 需要 localStorage 的模块在测试内自带最小桩实现（见 src/test/setup.ts）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    globals: false,
  },
});
