import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompletionMap, HabitReminderSettings, TaskTemplate } from '../types/habit';
import { isCloudConfigured } from '../lib/cloud';
import { completionKey, enqueue, templateKey } from '../lib/syncQueue';

export const DEFAULT_HABIT_REMINDER_SETTINGS: HabitReminderSettings = {
  enabled: false,
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
};

interface HabitStoreState {
  templates: TaskTemplate[];
  completions: CompletionMap;
  reminderSettings: HabitReminderSettings;
  addTemplate: (input: { title: string; emoji?: string; category?: string }) => Promise<TaskTemplate | null>;
  updateTemplate: (id: string, updates: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  archiveTemplate: (id: string) => Promise<boolean>;
  unarchiveTemplate: (id: string) => Promise<boolean>;
  toggleCompletion: (templateId: string, date: string) => Promise<boolean>;
  setCompleted: (templateId: string, date: string, done: boolean) => Promise<boolean>;
  updateReminderSettings: (updates: Partial<HabitReminderSettings>) => void;
  recordReminderSent: (timestamp: number) => void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

/** 未配置云端时跳过入队：纯本地模式不写队列，保持「零影响」 */
function pushTemplate(template: TaskTemplate): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'template-upsert', key: templateKey(template.id), template });
}

function pushTemplateRemoval(id: string): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'template-remove', key: templateKey(id), id });
}

/**
 * 打卡补推。base 是本次改动前该日期的值（三方合并的公共祖先），
 * 云端合并时用它算出「本机新增/取消」的增量，避免覆盖其他设备同时打的卡。
 */
function pushCompletion(date: string, templateIds: string[], base: string[]): void {
  if (!isCloudConfigured()) return;
  enqueue({ type: 'completion-set', key: completionKey(date), date, templateIds, base });
}

export const useHabitStore = create<HabitStoreState>()(
  persist(
    (set, get) => ({
      templates: [],
      completions: {},
      reminderSettings: DEFAULT_HABIT_REMINDER_SETTINGS,

      addTemplate: async (input) => {
        const template: TaskTemplate = {
          id: createId(),
          title: input.title,
          emoji: input.emoji?.trim() === '' ? undefined : input.emoji?.trim(),
          category: input.category?.trim() === '' ? undefined : input.category?.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: Date.now(),
        };
        set((state) => ({ templates: [...state.templates, template] }));
        pushTemplate(template);
        return template;
      },

      updateTemplate: async (id, updates) => {
        const existing = get().templates.find((t) => t.id === id);
        if (existing === undefined) return false;
        const merged: TaskTemplate = { ...existing, ...updates, updatedAt: Date.now() };
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? merged : t)),
        }));
        pushTemplate(merged);
        return true;
      },

      deleteTemplate: async (id) => {
        const existing = get().templates.find((t) => t.id === id);
        if (existing === undefined) return false;
        const completions: CompletionMap = {};
        for (const key of Object.keys(get().completions)) {
          const day = get().completions[key];
          const ids = day.filter((x) => x !== id);
          if (ids.length > 0) completions[key] = ids;
          // 只重写真正包含该习惯的日期：否则会把本地可能过期的打卡列表写回云端
          if (ids.length !== day.length) pushCompletion(key, ids, day);
        }
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          completions,
        }));
        pushTemplateRemoval(id);
        return true;
      },

      archiveTemplate: async (id) => {
        const existing = get().templates.find((t) => t.id === id);
        if (existing === undefined) return false;
        const merged: TaskTemplate = { ...existing, archived: true, updatedAt: Date.now() };
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? merged : t)),
        }));
        pushTemplate(merged);
        return true;
      },

      unarchiveTemplate: async (id) => {
        const existing = get().templates.find((t) => t.id === id);
        if (existing === undefined) return false;
        const merged: TaskTemplate = { ...existing, archived: false, updatedAt: Date.now() };
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? merged : t)),
        }));
        pushTemplate(merged);
        return true;
      },

      toggleCompletion: async (templateId, date) => {
        const day = get().completions[date] ?? [];
        const has = day.includes(templateId);
        const next = has ? day.filter((x) => x !== templateId) : [...day, templateId];
        set((state) => ({ completions: { ...state.completions, [date]: next } }));
        pushCompletion(date, next, day);
        return true;
      },

      setCompleted: async (templateId, date, done) => {
        const day = get().completions[date] ?? [];
        const has = day.includes(templateId);
        if (has === done) return true;
        const next = done ? [...day, templateId] : day.filter((x) => x !== templateId);
        set((state) => ({ completions: { ...state.completions, [date]: next } }));
        pushCompletion(date, next, day);
        return true;
      },

      updateReminderSettings: (updates) =>
        // 本地立即生效；云端弱一致推送由 App 层统一监听后入队执行
        set((state) => ({ reminderSettings: { ...state.reminderSettings, ...updates } })),

      recordReminderSent: (timestamp) =>
        set((state) => ({ reminderSettings: { ...state.reminderSettings, lastSentAt: timestamp } })),
    }),
    {
      name: 'daily-habit-storage',
      version: 2,
      migrate: (persistedState, version) => {
        // 与任务 store 对齐：建立版本迁移机制，为后续字段变更提供兜底路径。
        if (persistedState === null || typeof persistedState !== 'object') return persistedState;
        const obj = persistedState as Record<string, unknown>;
        const inner = obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
        if (!Array.isArray(inner.templates)) inner.templates = [];
        if (inner.completions === null || typeof inner.completions !== 'object' || Array.isArray(inner.completions)) {
          inner.completions = {};
        }
        // v2：补齐模板 updatedAt（合并冲突判定需要）
        if (version < 2 && Array.isArray(inner.templates)) {
          inner.templates = (inner.templates as unknown[]).map((raw) => {
            const template = (raw ?? {}) as Record<string, unknown>;
            if (typeof template.updatedAt === 'number') return template;
            const parsed = typeof template.createdAt === 'string' ? Date.parse(template.createdAt) : NaN;
            return { ...template, updatedAt: Number.isNaN(parsed) ? Date.now() : parsed };
          });
        }
        return persistedState as HabitStoreState;
      },
    },
  ),
);
