import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Priority, ReminderSettings, RepeatFrequency, Task, TaskStatus, Theme } from '../types';
import { parseDueDate, shiftRepeatDates } from '../utils/date';
import { buildTaskOrder, isCloudConfigured } from '../lib/cloud';
import { enqueue, taskKey, TASK_ORDER_KEY } from '../lib/syncQueue';

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  frequency: 'daily',
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
};

export interface NewTaskInput {
  title: string;
  description: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  status?: TaskStatus;
  repeat?: RepeatFrequency;
}

export interface ToggleDoneResult {
  /** false 仅表示任务不存在（本地先行写入不会因网络失败而失败） */
  ok: boolean;
  /** 取消完成时回收掉的自动生成副本 id；null 表示没有可回收的副本 */
  reclaimedCopyId: string | null;
}

interface TaskStoreState {
  tasks: Task[];
  reminderSettings: ReminderSettings;
  theme: Theme;
  addTask: (input: NewTaskInput) => Promise<Task | null>;
  updateTask: (id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  applyOrder: (orderedByStatus: Record<TaskStatus, string[]>) => Promise<boolean>;
  promoteStartedTasks: () => void;
  toggleDone: (id: string) => Promise<ToggleDoneResult>;
  /**
   * 完成任务；若任务设置了重复，自动生成下一周期副本（待处理、日期顺延到未来）并返回副本。
   * 返回 null 表示未生成副本（任务不存在 / 已完成 / 非重复任务）。
   */
  completeRecurring: (id: string) => Promise<Task | null>;
  archiveTask: (id: string) => Promise<boolean>;
  unarchiveTask: (id: string) => Promise<boolean>;
  updateReminderSettings: (updates: Partial<ReminderSettings>) => void;
  recordReminderSent: (timestamp: number) => void;
  setTheme: (theme: Theme) => void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

/** 写入归属时间：维护 completedAt（统计口径），并在离开 done 时清空 */
function withCompletionTime(next: Task, prev: Task | null, now: number): Task {
  if (next.status !== 'done') return { ...next, completedAt: null };
  if (prev !== null && prev.status === 'done') {
    // 已完成任务再次编辑：沿用原完成时间（旧数据没有该字段时用当时的 updatedAt 兜底）
    return { ...next, completedAt: prev.completedAt ?? prev.updatedAt };
  }
  return { ...next, completedAt: now };
}

/**
 * 单调递增的「修改时间」：保证每次改动都严格大于该条目上一次的值。
 *
 * 两个用途：
 * 1) `lib/merge` 的 last-write-wins 在同一毫秒内发生两次改动时也有确定顺序（否则会平局）；
 * 2) 让「副本是否被触碰过」可以用 `updatedAt === createdAt` 可靠判定
 *    （见 findReclaimableCopy）——若沿用裸 `Date.now()`，
 *    同一毫秒内「创建副本后立刻编辑」会被误判成未触碰，进而误删用户改动。
 */
function bumpUpdatedAt(previous: number, now: number = Date.now()): number {
  return now > previous ? now : previous + 1;
}

/**
 * 本地写入 + 入队补推：云写不再阻塞用户操作（离线可用）。
 * 未配置云端时直接跳过：纯本地模式不写队列，保持「零影响」。
 */
function pushTask(task: Task): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'task-upsert', key: taskKey(task.id), task });
}

function pushTaskOrder(tasks: Task[]): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'task-order', key: TASK_ORDER_KEY, order: buildTaskOrder(tasks) });
}

/** 删除 tombstone：既是指令，也是 hydrate 合并时「本地已删」的依据（同样只在配置了云端时入队） */
function pushTaskRemoval(id: string): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'task-remove', key: taskKey(id), id });
}

/** 本地写入成功后统一入队任务本体 + 顺序结构 */
function persistLocally(task: Task): void {
  pushTask(task);
  pushTaskOrder(useTaskStore.getState().tasks);
}

/**
 * 找出「由 sourceId 自动生成、且至今未被触碰」的下一周期副本。
 *
 * 三个条件缺一不可：
 * - `repeatOf` 指向该源任务 —— 确保是自动生成的副本，而不是用户自己新建的另一个重复任务；
 * - 仍为「待处理」—— 一旦被拖走、自动开始或再次完成，它就已经是用户正在使用的任务；
 * - `updatedAt === createdAt` —— 创建后从未被修改过（拖拽同列排序不会改动 updatedAt）。
 *
 * 这样「误点完成 → 立刻取消完成」能精确回到操作前的状态，
 * 又不会把用户已经动过的副本连同改动一起删掉。
 */
export function findReclaimableCopy(tasks: Task[], sourceId: string): Task | null {
  return (
    tasks.find(
      (task) => task.repeatOf === sourceId && task.status === 'todo' && task.updatedAt === task.createdAt,
    ) ?? null
  );
}

export const useTaskStore = create<TaskStoreState>()(
  persist(
    (set, get) => ({
      tasks: [],
      reminderSettings: DEFAULT_REMINDER_SETTINGS,
      theme: 'dark',

      addTask: async (input) => {
        const now = Date.now();
        // 开始时间已到的任务，创建后直接进入「进行中」
        let status = input.status ?? 'todo';
        const start = parseDueDate(input.startDate);
        if (start !== null && start.getTime() <= now) {
          status = 'in-progress';
        }
        const task: Task = withCompletionTime(
          {
            id: createId(),
            title: input.title,
            description: input.description,
            priority: input.priority,
            status,
            startDate: input.startDate,
            dueDate: input.dueDate,
            createdAt: now,
            updatedAt: now,
            repeat: input.repeat,
          },
          null,
          now,
        );
        set((state) => ({ tasks: [task, ...state.tasks] }));
        persistLocally(task);
        return task;
      },

      updateTask: async (id, updates) => {
        const now = Date.now();
        const existing = get().tasks.find((task) => task.id === id);
        if (existing === undefined) return false;
        const merged = { ...existing, ...updates, updatedAt: bumpUpdatedAt(existing.updatedAt, now) };
        let status = merged.status;
        const start = parseDueDate(merged.startDate);
        if (status === 'todo' && start !== null && start.getTime() <= now) {
          status = 'in-progress';
        }
        const finalTask: Task = withCompletionTime({ ...merged, status }, existing, now);
        set((state) => ({
          tasks: state.tasks.map((task): Task => (task.id === id ? finalTask : task)),
        }));
        persistLocally(finalTask);
        return true;
      },

      deleteTask: async (id) => {
        const existing = get().tasks.find((task) => task.id === id);
        if (existing === undefined) return false;
        set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
        // 删除用 tombstone 入队：既是补推指令，也是 hydrate 合并时「本地已删」的依据
        pushTaskRemoval(id);
        pushTaskOrder(get().tasks);
        return true;
      },

      applyOrder: async (orderedByStatus) => {
        const state = get();
        const byId = new Map(state.tasks.map((task) => [task.id, task]));
        const statuses: TaskStatus[] = ['todo', 'in-progress', 'done'];
        const now = Date.now();
        const next: Task[] = [];
        const changed: Task[] = [];
        for (const status of statuses) {
          const ids = orderedByStatus[status] ?? [];
          for (const id of ids) {
            const task = byId.get(id);
            if (!task) continue;
            if (task.status === status) {
              next.push(task);
            } else {
              const moved = withCompletionTime(
                { ...task, status, updatedAt: bumpUpdatedAt(task.updatedAt, now) },
                task,
                now,
              );
              changed.push(moved);
              next.push(moved);
            }
          }
        }
        // 未出现在 order 里的任务（例如「已归档」区）原样保留在尾部，避免拖拽导致数据丢失
        const placed = new Set(next.map((task) => task.id));
        for (const task of state.tasks) {
          if (!placed.has(task.id)) next.push(task);
        }
        set({ tasks: next });
        for (const task of changed) pushTask(task);
        pushTaskOrder(next);
        return true;
      },

      promoteStartedTasks: () => {
        const now = Date.now();
        const state = get();
        const changed: Task[] = [];
        const tasks: Task[] = state.tasks.map((task): Task => {
          if (task.status === 'todo' && task.startDate !== '') {
            const start = parseDueDate(task.startDate);
            if (start !== null && start.getTime() <= now) {
              const next: Task = { ...task, status: 'in-progress', updatedAt: bumpUpdatedAt(task.updatedAt, now) };
              changed.push(next);
              return next;
            }
          }
          return task;
        });
        if (changed.length === 0) return;
        set({ tasks });
        for (const task of changed) pushTask(task);
        pushTaskOrder(tasks);
      },

      toggleDone: async (id) => {
        const now = Date.now();
        const existing = get().tasks.find((task) => task.id === id);
        if (existing === undefined) return { ok: false, reclaimedCopyId: null };
        let nextStatus: TaskStatus;
        // 取消完成时顺带回收此前自动生成的下一周期副本（仅限从未被触碰的副本）
        let reclaimed: Task | null = null;
        if (existing.status === 'done') {
          const started = existing.startDate !== '' && (parseDueDate(existing.startDate)?.getTime() ?? 0) <= now;
          nextStatus = started ? 'in-progress' : 'todo';
          reclaimed = findReclaimableCopy(get().tasks, id);
        } else {
          nextStatus = 'done';
        }
        const finalTask: Task = withCompletionTime(
          { ...existing, status: nextStatus, updatedAt: bumpUpdatedAt(existing.updatedAt, now) },
          existing,
          now,
        );
        set((state) => ({
          tasks: state.tasks
            .map((task): Task => (task.id === id ? finalTask : task))
            .filter((task) => reclaimed === null || task.id !== reclaimed.id),
        }));
        persistLocally(finalTask);
        // 回收的副本要发删除 tombstone；若它还有未推的 upsert，同 key 入队会被这条覆盖（合并成删除）
        if (reclaimed !== null) pushTaskRemoval(reclaimed.id);
        return { ok: true, reclaimedCopyId: reclaimed !== null ? reclaimed.id : null };
      },

      // 完成任务并生成下一周期副本。副本保留标题/描述/优先级/重复设置，
      // 开始与截止时间顺延到「下一个尚未过去的周期」（逾期很久才完成也不会立刻又是逾期）。
      // 副本带 repeatOf 溯源，供「取消完成」时回收。
      completeRecurring: async (id) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (task === undefined || task.status === 'done' || task.repeat === undefined) return null;

        const now = Date.now();
        const shifted = shiftRepeatDates(task.startDate, task.dueDate, task.repeat, new Date(now));
        const next: Task = {
          id: createId(),
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: 'todo',
          startDate: shifted.startDate,
          dueDate: shifted.dueDate,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          repeat: task.repeat,
          repeatOf: task.id,
        };
        const doneTask: Task = withCompletionTime(
          { ...task, status: 'done', updatedAt: bumpUpdatedAt(task.updatedAt, now) },
          task,
          now,
        );
        set((prev) => ({
          tasks: [...prev.tasks.map((t): Task => (t.id === id ? doneTask : t)), next],
        }));
        pushTask(next);
        pushTask(doneTask);
        pushTaskOrder(get().tasks);
        return next;
      },

      archiveTask: async (id) => {
        const existing = get().tasks.find((task) => task.id === id);
        if (existing === undefined) return false;
        const finalTask: Task = { ...existing, archived: true, updatedAt: bumpUpdatedAt(existing.updatedAt) };
        set((state) => ({
          tasks: state.tasks.map((task): Task => (task.id === id ? finalTask : task)),
        }));
        persistLocally(finalTask);
        return true;
      },

      unarchiveTask: async (id) => {
        const existing = get().tasks.find((task) => task.id === id);
        if (existing === undefined) return false;
        const finalTask: Task = { ...existing, archived: false, updatedAt: bumpUpdatedAt(existing.updatedAt) };
        set((state) => ({
          tasks: state.tasks.map((task): Task => (task.id === id ? finalTask : task)),
        }));
        persistLocally(finalTask);
        return true;
      },

      updateReminderSettings: (updates) =>
        // 本地立即生效；云端弱一致推送由 App 层统一监听后入队执行
        set((state) => ({ reminderSettings: { ...state.reminderSettings, ...updates } })),

      recordReminderSent: (timestamp) =>
        set((state) => ({ reminderSettings: { ...state.reminderSettings, lastSentAt: timestamp } })),

      setTheme: (theme) =>
        // 本地立即生效；云端弱一致推送由 App 层统一监听后入队执行
        set({ theme }),
    }),
    {
      name: 'task-dashboard-storage',
      version: 2,
      migrate: (persistedState, version) => {
        // 主题统一切到深色（Linear 风格），仅对旧版本数据生效一次
        if (version < 1 && persistedState !== null && typeof persistedState === 'object') {
          const obj = persistedState as Record<string, unknown>;
          const inner = obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
          inner.theme = 'dark';
        }
        // v2：补齐 completedAt 字段（旧数据没有完成时间，保持 null 由统计层回退到 updatedAt）
        if (version < 2 && persistedState !== null && typeof persistedState === 'object') {
          const obj = persistedState as Record<string, unknown>;
          const inner = obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
          if (Array.isArray(inner.tasks)) {
            inner.tasks = inner.tasks.map((t) => {
              const task = (t ?? {}) as Record<string, unknown>;
              return task.completedAt === undefined ? { ...task, completedAt: null } : task;
            });
          }
        }
        return persistedState as TaskStoreState;
      },
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<TaskStoreState>) } as TaskStoreState;
        if (Array.isArray(merged.tasks)) {
          merged.tasks = merged.tasks.map((t) => ({
            ...t,
            startDate: typeof t.startDate === 'string' ? t.startDate : '',
            dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
            updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : t.createdAt,
            completedAt:
              t.status === 'done' && typeof t.completedAt === 'number' ? t.completedAt : null,
            repeat:
              t.repeat === 'daily' || t.repeat === 'weekly' || t.repeat === 'monthly' ? t.repeat : undefined,
            archived: t.archived === true,
          }));
        }
        return merged;
      },
    },
  ),
);
