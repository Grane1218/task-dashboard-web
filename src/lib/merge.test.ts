import { describe, expect, it } from 'vitest';
import type { ReminderSettings, Task } from '../types';
import type { HabitReminderSettings, TaskTemplate } from '../types/habit';
import type { CloudSnapshot } from './cloud';
import { mergeCloudSnapshot, type LocalData } from './merge';
import type { OutboxEntry, OutboxOp } from './syncQueue';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    priority: 'medium',
    status: 'todo',
    startDate: '',
    dueDate: '',
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    ...over,
  };
}

function template(id: string, over: Partial<TaskTemplate> = {}): TaskTemplate {
  return { id, title: id, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: 0, ...over };
}

const taskReminder: ReminderSettings = {
  enabled: false,
  frequency: 'daily',
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
};
const habitReminder: HabitReminderSettings = {
  enabled: false,
  time: '09:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  lastSentAt: null,
};

function snapshot(over: Partial<CloudSnapshot> = {}): CloudSnapshot {
  const base: CloudSnapshot = {
    tasks: [],
    templates: [],
    completions: {},
    settings: null,
    empty: true,
    ...over,
  };
  if (over.empty === undefined) {
    base.empty = base.tasks.length === 0 && base.templates.length === 0;
  }
  return base;
}

function local(over: Partial<LocalData> = {}): LocalData {
  return {
    tasks: [],
    templates: [],
    completions: {},
    taskReminder,
    habitReminder,
    theme: 'dark',
    ...over,
  };
}

function entry(op: OutboxOp, at = 1): OutboxEntry {
  return { op, at };
}

describe('mergeCloudSnapshot：任务 LWW 合并', () => {
  it('本地更新时采用本地版本并回推云端', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('a', { title: '云端标题', updatedAt: 100 })] }),
      local({ tasks: [task('a', { title: '本地标题', updatedAt: 200 })] }),
      [],
    );
    expect(outcome.tasks).toHaveLength(1);
    expect(outcome.tasks[0].title).toBe('本地标题');
    expect(outcome.push.tasks.map((t) => t.id)).toEqual(['a']);
    expect(outcome.conflicts).toBe(1);
  });

  it('云端更新时采用云端版本且不回推', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('a', { title: '云端标题', updatedAt: 300 })] }),
      local({ tasks: [task('a', { title: '本地标题', updatedAt: 200 })] }),
      [],
    );
    expect(outcome.tasks[0].title).toBe('云端标题');
    expect(outcome.push.tasks).toEqual([]);
  });

  it('时间戳相同时以云端为准（避免无意义的回推循环）', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('a', { title: '云端', updatedAt: 100 })] }),
      local({ tasks: [task('a', { title: '本地', updatedAt: 100 })] }),
      [],
    );
    expect(outcome.tasks[0].title).toBe('云端');
    expect(outcome.push.tasks).toEqual([]);
  });

  it('云端独有的任务被合并进来', () => {
    const outcome = mergeCloudSnapshot(snapshot({ tasks: [task('remote', { updatedAt: 5 })] }), local(), []);
    expect(outcome.tasks.map((t) => t.id)).toEqual(['remote']);
  });
});

describe('mergeCloudSnapshot：本地独有任务的取舍', () => {
  it('未在队列中且云端非空 → 视为其他设备已删除（修复「删除被复活」）', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('kept', { updatedAt: 1 })] }),
      local({ tasks: [task('kept'), task('ghost')] }),
      [],
    );
    expect(outcome.tasks.map((t) => t.id)).toEqual(['kept']);
    expect(outcome.removedByRemote).toBe(1);
  });

  it('离线期间新建（在写队列中）的任务一定保留', () => {
    const offline = task('offline', { updatedAt: 999 });
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('kept', { updatedAt: 1 })] }),
      local({ tasks: [task('kept'), offline] }),
      [entry({ type: 'task-upsert', key: 'task:offline', task: offline })],
    );
    expect(outcome.tasks.map((t) => t.id).sort()).toEqual(['kept', 'offline']);
    // 已在队列里，不需要重复回推
    expect(outcome.push.tasks).toEqual([]);
  });

  it('云端整体为空（首次迁移）时本地数据全部保留并回推', () => {
    const outcome = mergeCloudSnapshot(snapshot({ empty: true }), local({ tasks: [task('a'), task('b')] }), []);
    expect(outcome.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(outcome.push.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(outcome.removedByRemote).toBe(0);
  });

  it('本地新建的任务排在合并结果最前（与本地插入行为一致）', () => {
    const offline = task('offline');
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('remote')] }),
      local({ tasks: [offline] }),
      [entry({ type: 'task-upsert', key: 'task:offline', task: offline })],
    );
    expect(outcome.tasks.map((t) => t.id)).toEqual(['offline', 'remote']);
  });

  it('本设备从未同步过时不做「远端删除」判定（老版本升级迁移中断的保护）', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('uploaded')] }),
      local({ tasks: [task('uploaded'), task('never-uploaded')] }),
      [],
      { deviceNeverSynced: true },
    );
    expect(outcome.tasks.map((t) => t.id)).toEqual(['never-uploaded', 'uploaded']);
    expect(outcome.removedByRemote).toBe(0);
    // 补推云端，避免下次同步又被当成远端删除
    expect(outcome.push.tasks.map((t) => t.id)).toEqual(['never-uploaded']);
  });

  it('本设备已经同步过时仍然正常同步远端删除', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('uploaded')] }),
      local({ tasks: [task('uploaded'), task('ghost')] }),
      [],
      { deviceNeverSynced: false },
    );
    expect(outcome.tasks.map((t) => t.id)).toEqual(['uploaded']);
    expect(outcome.removedByRemote).toBe(1);
  });
});

describe('mergeCloudSnapshot：删除 tombstone', () => {
  it('队列中的删除优先级最高（双方都有的任务也会被删掉）', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('a'), task('b')] }),
      local({ tasks: [task('a'), task('b')] }),
      [entry({ type: 'task-remove', key: 'task:a', id: 'a' })],
    );
    expect(outcome.tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('本地已删除的任务不会被云端版本复活', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ tasks: [task('a', { updatedAt: 999 })] }),
      local({ tasks: [] }),
      [entry({ type: 'task-remove', key: 'task:a', id: 'a' })],
    );
    expect(outcome.tasks).toEqual([]);
  });

  it('习惯模板的删除 tombstone 同样生效', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('h1'), template('h2')] }),
      local({ templates: [template('h1'), template('h2')] }),
      [entry({ type: 'template-remove', key: 'template:h1', id: 'h1' })],
    );
    expect(outcome.templates.map((t) => t.id)).toEqual(['h2']);
  });
});

describe('mergeCloudSnapshot：习惯模板', () => {
  it('按 updatedAt 做 LWW，本地较新时回推', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('h', { title: '云端', updatedAt: 10 })] }),
      local({ templates: [template('h', { title: '本地', updatedAt: 20 })] }),
      [],
    );
    expect(outcome.templates[0].title).toBe('本地');
    expect(outcome.push.templates.map((t) => t.id)).toEqual(['h']);
  });

  it('缺少 updatedAt 时回退到 createdAt（旧数据兼容）', () => {
    const older = template('h', { title: '旧', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: undefined });
    const newer = template('h', { title: '新', createdAt: '2024-06-01T00:00:00.000Z', updatedAt: undefined });
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [older] }),
      local({ templates: [newer] }),
      [],
    );
    expect(outcome.templates[0].title).toBe('新');
  });
});

describe('mergeCloudSnapshot：打卡记录', () => {
  it('按日期取并集，且只保留仍存在的习惯 id', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a'), template('b')], completions: { '2024-05-06': ['a'] } }),
      local({ templates: [template('a'), template('b')], completions: { '2024-05-06': ['b', 'deleted'] } }),
      [],
    );
    expect(outcome.completions['2024-05-06'].sort()).toEqual(['a', 'b']);
  });

  it('队列中的离线取消打卡会生效（base 记录改动前的值）', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a')], completions: { '2024-05-06': ['a'] } }),
      local({ templates: [template('a')], completions: { '2024-05-06': [] } }),
      [
        entry({
          type: 'completion-set',
          key: 'completion:2024-05-06',
          date: '2024-05-06',
          templateIds: [],
          base: ['a'],
        }),
      ],
    );
    expect(outcome.completions['2024-05-06']).toBeUndefined();
  });

  it('离线打卡不会覆盖其他设备同时打的卡（三方合并）', () => {
    // 本机离线时给 a 打卡（改动前该日为空），期间另一台设备给 b 打了卡
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a'), template('b')], completions: { '2024-05-06': ['b'] } }),
      local({ templates: [template('a'), template('b')], completions: { '2024-05-06': ['a'] } }),
      [
        entry({
          type: 'completion-set',
          key: 'completion:2024-05-06',
          date: '2024-05-06',
          templateIds: ['a'],
          base: [],
        }),
      ],
    );
    expect(outcome.completions['2024-05-06'].sort()).toEqual(['a', 'b']);
  });

  it('离线打卡后云端记录被删除，本机增量仍然保留', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a')], completions: {} }),
      local({ templates: [template('a')], completions: { '2024-05-06': ['a'] } }),
      [
        entry({
          type: 'completion-set',
          key: 'completion:2024-05-06',
          date: '2024-05-06',
          templateIds: ['a'],
          base: [],
        }),
      ],
    );
    expect(outcome.completions['2024-05-06']).toEqual(['a']);
  });

  it('本地多出的打卡日期会回推云端', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a')] }),
      local({ templates: [template('a')], completions: { '2024-05-07': ['a'] } }),
      [],
    );
    expect(outcome.completions['2024-05-07']).toEqual(['a']);
    expect(outcome.push.completions).toEqual([{ date: '2024-05-07', templateIds: ['a'] }]);
  });

  it('与云端一致的日期不重复回推', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ templates: [template('a')], completions: { '2024-05-07': ['a'] } }),
      local({ templates: [template('a')], completions: { '2024-05-07': ['a'] } }),
      [],
    );
    expect(outcome.push.completions).toEqual([]);
  });
});

describe('mergeCloudSnapshot：设置', () => {
  const cloudSettings = { taskReminder, habitReminder, theme: 'light' as const };

  it('云端是权威源', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ settings: cloudSettings }),
      local({ theme: 'dark' }),
      [],
    );
    expect(outcome.settings.theme).toBe('light');
    expect(outcome.push.settings).toBe(false);
  });

  it('本地有未同步修改时以本地为准', () => {
    const outcome = mergeCloudSnapshot(
      snapshot({ settings: cloudSettings }),
      local({ theme: 'dark' }),
      [entry({ type: 'settings-set', key: 'settings', settings: { taskReminder, habitReminder, theme: 'dark' } })],
    );
    expect(outcome.settings.theme).toBe('dark');
    expect(outcome.push.settings).toBe(false);
  });

  it('云端没有设置记录时回推本地设置（首次迁移）', () => {
    const outcome = mergeCloudSnapshot(snapshot({ settings: null }), local({ theme: 'dark' }), []);
    expect(outcome.settings.theme).toBe('dark');
    expect(outcome.push.settings).toBe(true);
  });

  it('云端设置缺字段时按本地补齐', () => {
    const outcome = mergeCloudSnapshot(snapshot({ settings: { theme: 'light' } }), local({ theme: 'dark' }), []);
    expect(outcome.settings.theme).toBe('light');
    expect(outcome.settings.taskReminder).toEqual(taskReminder);
  });
});
