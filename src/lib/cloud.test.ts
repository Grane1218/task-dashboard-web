import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 云端初始化 / 写入链路的回归测试。
 *
 * 这里用假的 @cloudbase/js-sdk 跑通「ensureCloud → 匿名登录 → 写文档」，
 * 重点锁死两件曾经出过错的事：
 * 1. SDK 默认导出是**带 init() 方法的对象**，不是可调用函数（写成 Cloudbase({...})
 *    会静默失败，表现为一条数据都传不上云）。
 * 2. 文档 id 与信封字段必须带空间前缀，保证空间隔离。
 */

const mocks = vi.hoisted(() => {
  /** 每个集合的查询返回数据，用例可以按需替换 */
  const responses = new Map<string, unknown[]>();
  // 参数类型必须显式声明，否则 mock.calls 会被推断成空元组，取不到写入载荷
  const set = vi.fn(async (_payload: Record<string, unknown>) => ({}));
  const remove = vi.fn(async () => ({}));
  const doc = vi.fn(() => ({ set, remove, get: async () => ({ data: [] as unknown[] }) }));
  const collectionNames: string[] = [];

  const makeQuery = (name: string) => {
    const query: { skip: () => unknown; limit: () => unknown; get: () => Promise<{ data: unknown[] }> } = {
      skip: () => query,
      limit: () => query,
      get: async () => ({ data: responses.get(name) ?? [] }),
    };
    return query;
  };

  const collection = vi.fn((name: string) => {
    collectionNames.push(name);
    const query = makeQuery(name);
    return { doc, where: () => query, skip: query.skip, limit: query.limit, get: query.get };
  });
  const where = vi.fn();
  const database = vi.fn(() => ({ collection }));
  const signInAnonymously = vi.fn(async () => ({ data: { user: { id: 'uid-1' } }, error: null }));
  const init = vi.fn(() => ({ auth: () => ({ signInAnonymously }), database }));

  return { init, signInAnonymously, set, remove, doc, collection, where, database, responses, collectionNames };
});

vi.mock('@cloudbase/js-sdk', () => ({ default: { init: mocks.init } }));

vi.stubEnv('VITE_CLOUDBASE_ENV', 'test-env-id');

const cloud = await import('./cloud');
const { setSpaceSecret, deriveSpaceTag } = await import('./space');

function task(id: string) {
  return {
    id,
    title: id,
    description: '',
    priority: 'medium' as const,
    status: 'todo' as const,
    startDate: '',
    dueDate: '',
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  };
}

/** 取最后一次 set() 的写入载荷（tsconfig 目标为 ES2020，不能用 Array.prototype.at） */
function lastSetPayload(): Record<string, unknown> {
  const calls = mocks.set.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.responses.clear();
  setSpaceSecret('');
  cloud.resetCloudBackoff();
  expect(await cloud.ensureCloud()).toBe(true);
});

describe('ensureCloud 初始化', () => {
  // 说明：beforeEach 里的 expect(await cloud.ensureCloud()).toBe(true) 就是本文件最关键的回归断言——
  // 一旦初始化写法出错（例如把默认导出当函数调用），ensureCloud 会返回 false，所有用例都会失败。
  it('通过 Cloudbase.init({ env }) 初始化并完成匿名登录才算就绪', () => {
    expect(mocks.init).toHaveBeenCalledWith({ env: 'test-env-id' });
    expect(mocks.signInAnonymously).toHaveBeenCalled();
    expect(cloud.getCloudStatus()).toBe('ready');
  });

  it('envId 来自构建期变量', () => {
    expect(cloud.isCloudConfigured()).toBe(true);
    expect(cloud.getCloudEnvId()).toBe('test-env-id');
  });
});

describe('写入链路', () => {
  it('upsertTask 落到 tasks 集合，并带上写入归属 owner', async () => {
    await expect(cloud.upsertTask(task('a'))).resolves.toBe(true);
    expect(mocks.collection).toHaveBeenCalledWith('tasks');
    expect(mocks.doc).toHaveBeenCalledWith('a');
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', owner: 'uid-1' }));
  });

  it('upsertCompletion 传空数组时删除当天文档', async () => {
    await expect(cloud.upsertCompletion('2024-05-06', [])).resolves.toBe(true);
    expect(mocks.collection).toHaveBeenCalledWith('completions');
    expect(mocks.remove).toHaveBeenCalled();
  });

  it('写入失败时返回 false（调用方据此留在队列里重试）', async () => {
    mocks.set.mockRejectedValueOnce(new Error('network down'));
    await expect(cloud.upsertTask(task('b'))).resolves.toBe(false);
  });

  it('syncTaskOrder 把顺序结构写进 task-order 单文档', async () => {
    await expect(cloud.syncTaskOrder([task('a')])).resolves.toBe(true);
    expect(mocks.collection).toHaveBeenCalledWith('task-order');
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ order: { todo: ['a'], 'in-progress': [], done: [] } }),
    );
  });
});

describe('空间隔离', () => {
  it('未设置空间密钥时保持兼容：文档 id 不变且不带 space 字段', async () => {
    await cloud.upsertTask(task('a'));
    expect(mocks.doc).toHaveBeenCalledWith('a');
    expect(lastSetPayload().space).toBeUndefined();
  });

  it('设置空间密钥后：文档 id 加空间前缀，并写入 space 字段', async () => {
    setSpaceSecret('my-secret');
    const tag = deriveSpaceTag('my-secret');
    await cloud.upsertTask(task('a'));
    expect(mocks.doc).toHaveBeenCalledWith(tag + '_a');
    expect(lastSetPayload()).toMatchObject({ id: 'a', space: tag, owner: 'uid-1' });
  });

  it('五个集合都会查询，读到的是本空间数据', async () => {
    mocks.responses.set('tasks', []);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.tasks).toEqual([]);
    expect(mocks.collectionNames).toEqual(
      expect.arrayContaining(['tasks', 'habits', 'completions', 'settings', 'task-order']),
    );
  });
});

describe('hydrateFromCloud：empty 判定', () => {
  it('所有集合都为空时才视为「云端从未被本应用写入」', async () => {
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.empty).toBe(true);
  });

  it('只剩 settings 文档（任务被删光）时不再视为首次迁移', async () => {
    mocks.responses.set('settings', [{ theme: 'dark' }]);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.tasks).toEqual([]);
    expect(snapshot?.empty).toBe(false);
  });

  it('只剩 task-order 文档时同样不视为首次迁移', async () => {
    mocks.responses.set('task-order', [{ order: { todo: [], 'in-progress': [], done: [] } }]);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.empty).toBe(false);
  });
});

describe('hydrateFromCloud：数据清洗', () => {
  it('任务按 order 重建顺序，归档任务排在最后', async () => {
    mocks.responses.set('tasks', [
      { id: 'b', title: 'B', status: 'todo', updatedAt: 2 },
      { id: 'a', title: 'A', status: 'todo', updatedAt: 1 },
      { id: 'z', title: 'Z', status: 'todo', archived: true, updatedAt: 3 },
    ]);
    mocks.responses.set('task-order', [{ order: { todo: ['a', 'b'], 'in-progress': [], done: [] } }]);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.tasks.map((t) => t.id)).toEqual(['a', 'b', 'z']);
  });

  it('缺少 id 的脏数据被丢弃', async () => {
    mocks.responses.set('tasks', [{ title: '没有 id' }, { id: 'ok', title: 'OK' }]);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.tasks.map((t) => t.id)).toEqual(['ok']);
  });

  it('打卡记录里指向已删除习惯的 id 被清理', async () => {
    mocks.responses.set('habits', [{ id: 'h1', title: '喝水' }]);
    mocks.responses.set('completions', [{ date: '2024-05-06', templateIds: ['h1', 'ghost'] }]);
    const snapshot = await cloud.hydrateFromCloud();
    expect(snapshot?.completions).toEqual({ '2024-05-06': ['h1'] });
  });
});
