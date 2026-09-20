import type { ReminderSettings, Task, TaskStatus, Theme } from '../types';
import type { CompletionMap, HabitReminderSettings, TaskTemplate } from '../types/habit';
import { getSpaceTag } from './space';

/**
 * 云开发接入层
 *
 * 设计约束：
 * - envId 通过 .env 的 VITE_CLOUDBASE_ENV 配置；未配置时应用保持纯本地模式，零影响。
 * - **envId 会随 bundle 公开，不能被当作访问控制的依据**；数据隔离依赖 lib/space.ts 的空间密钥。
 * - 匿名登录（需在云开发控制台开启「匿名登录」）；owner 字段仅用于写入归属记录。
 *   匿名 uid 每台设备独立，**不能用于过滤**，否则换设备读不到已有数据。
 * - 所有写操作幂等：doc(id).set() 天然 upsert，_id = 空间前缀 + 业务 id。
 * - SDK 通过动态 import 加载，不进入首屏包；初始化失败按退避策略重试，不阻塞本地写入。
 */

const ENV_ID: string | undefined = import.meta.env.VITE_CLOUDBASE_ENV as string | undefined;

export type CloudStatus = 'unconfigured' | 'ready' | 'failed';

/** 单次云请求超时（毫秒）：避免离线/弱网时挂死整个启动流程 */
export const CLOUD_TIMEOUT_MS = 12000;

/** 初始化失败后的退避区间 */
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60000;

/** 云数据库最小类型面（对齐 @cloudbase/js-sdk 的 ICollection/IQuery/IDocument 常用链） */
interface CloudDoc {
  set(data: unknown): Promise<unknown>;
  remove(): Promise<unknown>;
  get(): Promise<{ data: unknown[] }>;
}
/** where 之后的查询链：SDK 禁止再次 where，且无 doc 方法 */
interface CloudQuery {
  skip(n: number): CloudQuery;
  limit(n: number): CloudQuery;
  get(): Promise<{ data: unknown[] }>;
}
interface CloudCollection {
  doc(id: string): CloudDoc;
  where(query: unknown): CloudQuery;
  skip(n: number): CloudQuery;
  limit(n: number): CloudQuery;
  get(): Promise<{ data: unknown[] }>;
}
interface CloudDb {
  collection(name: string): CloudCollection;
}

interface CloudbaseApp {
  auth(config: { persistence: string }): {
    signInAnonymously(): Promise<{ data?: { user?: { id?: string } } | null; error?: { message?: string } | null }>;
  };
  database(): CloudDb;
}

/**
 * 默认导出是**带 init() 方法的对象，不是可调用函数**（见 @cloudbase/js-sdk 的
 * `CloudbaseCore`：`init: (config) => cloudbase.app.App`）。
 * 这里必须用 `Cloudbase.init({...})`，写成 `Cloudbase({...})` 会在运行时报
 * 「not a function」并被 catch 掉，表现为云端永远连不上、数据一条都传不上去。
 */
interface CloudbaseSdk {
  init(config: { env: string }): CloudbaseApp;
}

let db: CloudDb | null = null;
let owner = 'anonymous';
let status: CloudStatus = 'unconfigured';
let initPromise: Promise<boolean> | null = null;
/** 退避截止时间戳：在此之前 ensureCloud 直接返回 false，不再发起网络请求 */
let retryNotBefore = 0;
let retryDelayMs = RETRY_BASE_MS;

type StatusListener = (s: CloudStatus) => void;
const listeners = new Set<StatusListener>();

/** SDK 懒加载：首屏不加载 @cloudbase/js-sdk（约 1MB） */
let sdkPromise: Promise<CloudbaseSdk | null> | null = null;

function loadSdkOnce(): Promise<CloudbaseSdk | null> {
  if (sdkPromise === null) {
    sdkPromise = import('@cloudbase/js-sdk')
      .then((mod) => (mod.default ?? mod) as unknown as CloudbaseSdk)
      .catch((e: unknown) => {
        console.error('[cloud] SDK 加载失败:', e);
        sdkPromise = null; // 允许下次重试（例如离线时 chunk 未缓存）
        return null;
      });
  }
  return sdkPromise;
}

/**
 * 加载 SDK 并加超时。动态 import 无法取消：若 chunk 卡住（弱网 / 强制门户），
 * 超时后必须把缓存的 promise 置空，否则后续每次调用都会复用同一个永不 settle 的 promise，
 * 导致 ensureCloud 永不返回、写队列再也无法冲刷。
 */
async function loadSdk(): Promise<CloudbaseSdk | null> {
  try {
    return await withTimeout(loadSdkOnce(), CLOUD_TIMEOUT_MS, '加载 CloudBase SDK');
  } catch (e) {
    console.error('[cloud] SDK 加载超时:', e);
    sdkPromise = null;
    return null;
  }
}

/** 给任意 Promise 加超时，超时后 reject；用于防止弱网/离线挂死 */
export function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_TIMEOUT_MS, label = 'cloud'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[cloud] ${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function isCloudConfigured(): boolean {
  return typeof ENV_ID === 'string' && ENV_ID.trim() !== '';
}

export function getCloudStatus(): CloudStatus {
  return status;
}

/** 便于 UI 展示的云环境 id（本身不是秘密，公开可见） */
export function getCloudEnvId(): string {
  return isCloudConfigured() ? (ENV_ID as string) : '';
}

export function onCloudStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setStatus(s: CloudStatus): void {
  if (status === s) return;
  status = s;
  for (const fn of listeners) fn(s);
}

/** 网络恢复/用户手动重试时调用：清空退避，允许立即重连 */
export function resetCloudBackoff(): void {
  retryNotBefore = 0;
  retryDelayMs = RETRY_BASE_MS;
}

/**
 * 确保云已初始化并完成匿名登录。
 * - 未配置 envId：返回 false（纯本地模式）
 * - 初始化/登录失败：返回 false，并按指数退避（3s→60s）抑制重试，
 *   避免「每次操作都重新走一次匿名登录 + 网络超时」。
 * - 成功：返回 true，之后 status 恒为 ready
 */
export async function ensureCloud(): Promise<boolean> {
  if (!isCloudConfigured()) return false;
  if (status === 'ready' && db !== null) return true;
  if (initPromise !== null) return initPromise;
  if (Date.now() < retryNotBefore) return false;

  initPromise = (async () => {
    try {
      const sdk = await loadSdk();
      if (sdk === null) throw new Error('SDK 不可用');
      const instance = sdk.init({ env: ENV_ID as string });
      const auth = instance.auth({ persistence: 'local' });
      const { data, error } = await withTimeout(auth.signInAnonymously(), CLOUD_TIMEOUT_MS, 'signInAnonymously');
      if (error) throw new Error(error.message ?? '匿名登录失败');
      owner = data?.user?.id ?? 'anonymous';
      db = instance.database();
      resetCloudBackoff();
      setStatus('ready');
      return true;
    } catch (e) {
      console.error('[cloud] 初始化失败，降级为本地模式:', e);
      retryNotBefore = Date.now() + retryDelayMs;
      retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
      setStatus('failed');
      return false;
    } finally {
      // 关键：失败时不再把 initPromise 置空任由调用方重试，
      // 而是保留退避窗口（retryNotBefore）来抑制重试风暴。
      initPromise = null;
    }
  })();
  return initPromise;
}

// ---------- 空间范围（space）与文档 id ----------

/** 把业务 id 映射为云端文档 id：带空间标签时加前缀，避免不同空间互相覆盖 */
function scopedId(id: string): string {
  const tag = getSpaceTag();
  return tag === '' ? id : `${tag}_${id}`;
}

/** 写入时的公共信封字段：space（隔离过滤依据）+ owner（写入归属，仅记录不用于过滤） */
function envelope(): Record<string, unknown> {
  const tag = getSpaceTag();
  return tag === '' ? { owner } : { space: tag, owner };
}

async function upsertDoc(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    await withTimeout(
      db!.collection(collection).doc(scopedId(id)).set({ ...data, ...envelope() }),
      CLOUD_TIMEOUT_MS,
      `upsert ${collection}/${id}`,
    );
    return true;
  } catch (e) {
    console.error('[cloud] upsert 失败:', collection, id, e);
    return false;
  }
}

async function removeDoc(collection: string, id: string): Promise<boolean> {
  try {
    await withTimeout(
      db!.collection(collection).doc(scopedId(id)).remove(),
      CLOUD_TIMEOUT_MS,
      `remove ${collection}/${id}`,
    );
    return true;
  } catch (e) {
    console.error('[cloud] remove 失败:', collection, id, e);
    return false;
  }
}

async function queryAll(collection: string): Promise<Record<string, unknown>[]> {
  // 隔离模式：按 space 过滤，只能读到本空间数据；兼容模式（未设空间密钥）不过滤，保持历史行为。
  // 注意：微信云数据库单次 get 上限 20 条，需分页拉全量。
  const tag = getSpaceTag();
  const pageSize = 20;
  const result: Record<string, unknown>[] = [];
  let skip = 0;
  for (;;) {
    const base = db!.collection(collection);
    const scoped = tag === '' ? base : base.where({ space: tag });
    const res = await withTimeout(
      scoped.skip(skip).limit(pageSize).get(),
      CLOUD_TIMEOUT_MS,
      `query ${collection}`,
    );
    const rawBatch = (res.data ?? []) as Record<string, unknown>[];
    // 兼容模式下过滤掉带 space 的文档（历史混合数据），分页仍按服务端原始条数推进
    result.push(...rawBatch.filter((doc) => tag !== '' || doc.space === undefined));
    if (rawBatch.length < pageSize) break;
    skip += pageSize;
  }
  return result;
}

// ---------- 任务 ----------

export async function upsertTask(task: Task): Promise<boolean> {
  return upsertDoc('tasks', task.id, { ...task });
}

export async function removeTask(id: string): Promise<boolean> {
  return removeDoc('tasks', id);
}

/** 由任务数组生成顺序结构（供 task-order 文档写入） */
export function buildTaskOrder(tasks: Task[]): Record<TaskStatus, string[]> {
  const order: Record<TaskStatus, string[]> = { todo: [], 'in-progress': [], done: [] };
  for (const t of tasks) {
    if (t.archived) continue;
    (order[t.status] ?? order.todo).push(t.id);
  }
  return order;
}

/** 把本地任务数组的顺序/状态结构同步到云端 task-order 集合（单文档，一次写） */
export async function syncTaskOrder(tasks: Task[]): Promise<boolean> {
  return syncTaskOrderRecord(buildTaskOrder(tasks));
}

export async function syncTaskOrderRecord(order: Record<TaskStatus, string[]>): Promise<boolean> {
  return upsertDoc('task-order', 'default', { order });
}

// ---------- 习惯 ----------

export async function upsertTemplate(t: TaskTemplate): Promise<boolean> {
  return upsertDoc('habits', t.id, { ...t });
}

export async function removeTemplate(id: string): Promise<boolean> {
  return removeDoc('habits', id);
}

/** 打卡记录按日期聚合：{ _id: date, date, templateIds }；空数组时删除该日文档 */
export async function upsertCompletion(date: string, templateIds: string[]): Promise<boolean> {
  if (templateIds.length === 0) return removeDoc('completions', date);
  return upsertDoc('completions', date, { date, templateIds });
}

// ---------- 设置（弱一致：失败忽略，下次成功时覆盖） ----------

export interface CloudSettings {
  taskReminder: ReminderSettings;
  habitReminder: HabitReminderSettings;
  theme: Theme;
}

export async function upsertSettings(s: CloudSettings): Promise<boolean> {
  return upsertDoc('settings', 'default', { ...s });
}

// ---------- 全量拉取 / 全量上传 ----------

export interface CloudSnapshot {
  tasks: Task[];
  templates: TaskTemplate[];
  completions: CompletionMap;
  /** 云端设置可能部分缺失（旧数据/未写入过），字段缺失由调用方按缺省处理 */
  settings: Partial<CloudSettings> | null;
  /** 云端是否完全为空（用于「首次迁移」判定） */
  empty: boolean;
}

export function sanitizeTask(raw: unknown): Task | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id === '') return null;
  const status: TaskStatus =
    t.status === 'todo' || t.status === 'in-progress' || t.status === 'done' ? t.status : 'todo';
  const completedAt =
    status === 'done' && typeof t.completedAt === 'number' ? t.completedAt : undefined;
  return {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : '未命名任务',
    description: typeof t.description === 'string' ? t.description : '',
    priority: t.priority === 'high' || t.priority === 'medium' || t.priority === 'low' ? t.priority : 'medium',
    status,
    startDate: typeof t.startDate === 'string' ? t.startDate : '',
    dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now(),
    completedAt,
    repeat: t.repeat === 'daily' || t.repeat === 'weekly' || t.repeat === 'monthly' ? t.repeat : undefined,
    repeatOf: typeof t.repeatOf === 'string' && t.repeatOf !== '' ? t.repeatOf : undefined,
    archived: t.archived === true,
  };
}

export function sanitizeTemplate(raw: unknown): TaskTemplate | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id === '') return null;
  return {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : '未命名习惯',
    emoji: typeof t.emoji === 'string' && t.emoji.trim() !== '' ? t.emoji : undefined,
    category: typeof t.category === 'string' && t.category.trim() !== '' ? t.category : undefined,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : undefined,
    archived: t.archived === true,
  };
}

export async function hydrateFromCloud(): Promise<CloudSnapshot | null> {
  if (!(await ensureCloud())) return null;
  try {
    const [taskDocs, templateDocs, completionDocs, settingsDocs, orderDocs] = await Promise.all([
      queryAll('tasks'),
      queryAll('habits'),
      queryAll('completions'),
      queryAll('settings'),
      queryAll('task-order'),
    ]);

    const tasks = taskDocs.map(sanitizeTask).filter((t): t is Task => t !== null);
    const templates = templateDocs.map(sanitizeTemplate).filter((t): t is TaskTemplate => t !== null);

    // 顺序重建：活跃任务按云端 order 排序（跨列后仍按实际 status 归类），不在 order 的追加列尾，归档任务放尾部
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const orderDoc = orderDocs[0] as { order?: Record<TaskStatus, string[]> } | undefined;
    const order = orderDoc?.order ?? null;
    const ordered: Task[] = [];
    const placed = new Set<string>();
    if (order !== null) {
      for (const status of ['todo', 'in-progress', 'done'] as TaskStatus[]) {
        for (const id of order[status] ?? []) {
          const t = byId.get(id);
          if (t !== undefined && !t.archived && !placed.has(id)) {
            placed.add(id);
            ordered.push(t);
          }
        }
      }
    }
    for (const t of tasks) {
      if (!t.archived && !placed.has(t.id)) {
        placed.add(t.id);
        ordered.push(t);
      }
    }
    for (const t of tasks) {
      if (t.archived) ordered.push(t);
    }

    const completions: CompletionMap = {};
    const templateIds = new Set(templates.map((t) => t.id));
    for (const d of completionDocs) {
      const c = d as { date?: unknown; templateIds?: unknown };
      if (typeof c.date === 'string' && Array.isArray(c.templateIds)) {
        // 仅保留仍存在的习惯模板 id（删除习惯后云端残留在此收敛）
        const ids = c.templateIds.filter((x): x is string => typeof x === 'string' && templateIds.has(x));
        if (ids.length > 0) completions[c.date] = ids;
      }
    }

    let settings: Partial<CloudSettings> | null = null;
    const s = settingsDocs[0] as Partial<CloudSettings> | undefined;
    if (s !== undefined && s !== null) {
      settings = {
        ...(s.taskReminder ? { taskReminder: s.taskReminder } : {}),
        ...(s.habitReminder ? { habitReminder: s.habitReminder } : {}),
        ...(s.theme === 'light' || s.theme === 'dark' ? { theme: s.theme } : {}),
      };
    }

    return {
      tasks: ordered,
      templates,
      completions,
      settings,
      // 「云端从未被本应用写入过」而不是「当前没有任务/习惯」：
      // 只看任务/习惯会让「某台设备删光了所有任务」被误判成首次迁移，
      // 从而把其他设备的旧副本当成新数据重新推回云端（删除被复活）。
      // settings / task-order 是每次成功同步必然存在的单文档，可作为「已初始化」的标志。
      empty:
        tasks.length === 0 &&
        templates.length === 0 &&
        Object.keys(completions).length === 0 &&
        settingsDocs.length === 0 &&
        orderDocs.length === 0,
    };
  } catch (e) {
    console.error('[cloud] hydrate 失败:', e);
    return null;
  }
}

export interface CloudUploadInput {
  tasks: Task[];
  templates: TaskTemplate[];
  completions: CompletionMap;
  settings: CloudSettings;
}

/**
 * 全量上传（空间切换迁移用）：幂等，可重复执行。
 * ok 为 true 表示**每一条都写入成功**——空间切换依赖这个语义来决定是否可以开始合并，
 * 因此任何一条失败都必须返回 false（调用方会保持本地数据并在下次启动重试）。
 */
export async function uploadLocalToCloud(input: CloudUploadInput): Promise<{ ok: boolean; written: number }> {
  if (!(await ensureCloud())) return { ok: false, written: 0 };
  let written = 0;
  let failed = 0;
  // 首条失败即中止：迁移是全有全无语义，继续逐条重试只会让调用方在弱网下等满 N × 超时
  const track = async (write: Promise<boolean>): Promise<boolean> => {
    if (await write) {
      written += 1;
      return true;
    }
    failed += 1;
    return false;
  };
  try {
    for (const t of input.tasks) {
      if (!(await track(upsertTask(t)))) break;
    }
    if (failed === 0) await track(syncTaskOrder(input.tasks));
    if (failed === 0) {
      for (const t of input.templates) {
        if (!(await track(upsertTemplate(t)))) break;
      }
    }
    if (failed === 0) {
      for (const [date, ids] of Object.entries(input.completions)) {
        if (ids.length > 0 && !(await track(upsertCompletion(date, ids)))) break;
      }
    }
    if (failed === 0) await track(upsertSettings(input.settings));
    if (failed > 0) console.error('[cloud] 全量上传中止，失败条目:', failed);
    return { ok: failed === 0, written };
  } catch (e) {
    console.error('[cloud] 全量上传失败:', e);
    return { ok: false, written };
  }
}
