/**
 * 测试环境桩：给 node 环境补一个最小的 window / localStorage，
 * 让依赖浏览器存储的模块（space / syncQueue / startupState）可以在无 DOM 下测试。
 */

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

function createStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const globalScope = globalThis as unknown as Record<string, unknown>;

if (globalScope.window === undefined) {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const win = {
    localStorage: createStorage(),
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
  };
  globalScope.window = win;
}

if (globalScope.localStorage === undefined) {
  globalScope.localStorage = (globalScope.window as { localStorage: StorageLike }).localStorage;
}
