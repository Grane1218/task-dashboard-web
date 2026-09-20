import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA, BACKUP_VERSION, buildBackup, importDataFromText } from './backup';
import { DEFAULT_REMINDER_SETTINGS, useTaskStore } from '../store/useTaskStore';
import { DEFAULT_HABIT_REMINDER_SETTINGS, useHabitStore } from '../store/useHabitStore';
import type { Task } from '../types';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    priority: 'medium',
    status: 'todo',
    startDate: '',
    dueDate: '',
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    ...over,
  };
}

function resetStores(): void {
  useTaskStore.setState({ tasks: [], reminderSettings: DEFAULT_REMINDER_SETTINGS, theme: 'dark' });
  useHabitStore.setState({
    templates: [],
    completions: {},
    reminderSettings: DEFAULT_HABIT_REMINDER_SETTINGS,
  });
}

function backupText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    taskStore: { tasks: [], reminderSettings: DEFAULT_REMINDER_SETTINGS, theme: 'dark' },
    habitStore: { templates: [], completions: {}, reminderSettings: DEFAULT_HABIT_REMINDER_SETTINGS },
    ...over,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetStores();
});

describe('buildBackup', () => {
  it('包含任务、习惯、完成记录、设置与主题', () => {
    useTaskStore.setState({ tasks: [task('a')], theme: 'light' });
    useHabitStore.setState({ templates: [{ id: 'h', title: '喝水', createdAt: '2024-01-01T00:00:00.000Z' }] });
    const data = buildBackup();
    expect(data.app).toBe(BACKUP_SCHEMA);
    expect(data.taskStore.tasks).toHaveLength(1);
    expect(data.taskStore.theme).toBe('light');
    expect(data.habitStore.templates).toHaveLength(1);
  });

  it('保留 completedAt（统计口径依赖该字段）', () => {
    useTaskStore.setState({ tasks: [task('a', { status: 'done', completedAt: 42 })] });
    expect(buildBackup().taskStore.tasks[0].completedAt).toBe(42);
  });
});

describe('importDataFromText：校验', () => {
  it('非法 JSON', () => {
    expect(importDataFromText('{oops').ok).toBe(false);
    expect(importDataFromText('{oops').error).toBe('文件不是有效的 JSON');
  });

  it('非本应用备份', () => {
    expect(importDataFromText(JSON.stringify({ app: 'other' })).ok).toBe(false);
  });

  it('缺少任务数据', () => {
    const result = importDataFromText(backupText({ taskStore: { theme: 'dark' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('备份缺少任务数据');
  });

  it('缺少习惯数据', () => {
    const result = importDataFromText(backupText({ habitStore: { templates: [] } }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('备份缺少习惯数据');
  });
});

describe('importDataFromText：合并模式', () => {
  it('按 id 去重，仅追加新任务', () => {
    useTaskStore.setState({ tasks: [task('existing', { title: '本地已有' })] });
    const text = backupText({
      taskStore: {
        tasks: [task('existing', { title: '备份版本' }), task('fresh', { title: '新任务' })],
        reminderSettings: DEFAULT_REMINDER_SETTINGS,
        theme: 'light',
      },
    });
    const result = importDataFromText(text, 'merge');
    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({
      tasksAdded: 1,
      tasksSkipped: 1,
      habitsAdded: 0,
      habitsSkipped: 0,
      completionsMerged: 0,
    });
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.map((t) => t.id)).toEqual(['existing', 'fresh']);
    // 本地版本保留，不被备份覆盖
    expect(tasks[0].title).toBe('本地已有');
    // 合并模式不改变主题
    expect(useTaskStore.getState().theme).toBe('dark');
  });

  it('打卡记录按日期取并集', () => {
    useHabitStore.setState({
      templates: [{ id: 'h', title: '喝水', createdAt: '2024-01-01T00:00:00.000Z' }],
      completions: { '2024-05-06': ['h'] },
    });
    const text = backupText({
      habitStore: {
        templates: [{ id: 'h', title: '喝水', createdAt: '2024-01-01T00:00:00.000Z' }],
        completions: { '2024-05-06': ['h'], '2024-05-07': ['h'] },
        reminderSettings: DEFAULT_HABIT_REMINDER_SETTINGS,
      },
    });
    const result = importDataFromText(text, 'merge');
    expect(result.stats?.completionsMerged).toBe(1);
    expect(useHabitStore.getState().completions).toEqual({ '2024-05-06': ['h'], '2024-05-07': ['h'] });
  });
});

describe('importDataFromText：覆盖模式', () => {
  it('整体替换并保留 completedAt', () => {
    useTaskStore.setState({ tasks: [task('old')] });
    const text = backupText({
      taskStore: {
        tasks: [task('new', { status: 'done', completedAt: 777 })],
        reminderSettings: { ...DEFAULT_REMINDER_SETTINGS, enabled: true },
        theme: 'light',
      },
    });
    const result = importDataFromText(text, 'overwrite');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('overwrite');
    const state = useTaskStore.getState();
    expect(state.tasks.map((t) => t.id)).toEqual(['new']);
    expect(state.tasks[0].completedAt).toBe(777);
    expect(state.theme).toBe('light');
    expect(state.reminderSettings.enabled).toBe(true);
  });

  it('清理指向已不存在习惯的打卡记录', () => {
    const text = backupText({
      habitStore: {
        templates: [{ id: 'kept', title: '保留', createdAt: '2024-01-01T00:00:00.000Z' }],
        completions: { '2024-05-06': ['kept', 'ghost'] },
        reminderSettings: DEFAULT_HABIT_REMINDER_SETTINGS,
      },
    });
    importDataFromText(text, 'overwrite');
    expect(useHabitStore.getState().completions).toEqual({ '2024-05-06': ['kept'] });
  });

  it('未完成任务的 completedAt 会被清空（避免污染统计）', () => {
    const text = backupText({
      taskStore: {
        tasks: [task('a', { status: 'todo', completedAt: 999 })],
        reminderSettings: DEFAULT_REMINDER_SETTINGS,
        theme: 'dark',
      },
    });
    importDataFromText(text, 'overwrite');
    expect(useTaskStore.getState().tasks[0].completedAt).toBeNull();
  });
});
