import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task, View } from './types';
import type { TaskTemplate } from './types/habit';
import { useTaskStore } from './store/useTaskStore';
import { useHabitStore } from './store/useHabitStore';
import { useToastStore } from './store/useToastStore';
import { useReminders } from './hooks/useReminders';
import { DEFAULT_FILTERS, type TaskFilters } from './utils/filter';
import { buildHabitReminderBody, HABIT_NOTIFICATION_TITLE, todayKey } from './utils/habit';
import Header from './components/Header';
import PermissionBanner from './components/PermissionBanner';
import StatsCards from './components/StatsCards';
import FilterBar from './components/FilterBar';
import BoardView from './components/BoardView';
import TaskModal from './components/TaskModal';
import ConfirmDialog from './components/ConfirmDialog';
import ReminderSettingsModal from './components/ReminderSettingsModal';
import HabitsView from './components/habits/HabitsView';
import StatsView from './components/StatsView';
import CalendarView from './components/CalendarView';
import HabitModal from './components/habits/HabitModal';
import HabitReminderSettingsModal from './components/habits/HabitReminderSettingsModal';
import FocusModal from './components/FocusModal';
import KeyboardHelpModal from './components/KeyboardHelpModal';
import ReminderBanner from './components/ReminderBanner';
import Toaster from './components/Toaster';
import StartupSummaryModal from './components/StartupSummaryModal';
import CloudPanelModal from './components/CloudPanelModal';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { isOverdue } from './utils/date';
import { buildNotificationBody, NOTIFICATION_TITLE, showSystemNotification } from './utils/notificationHelper';
import {
  CLOUD_TIMEOUT_MS,
  getCloudStatus,
  hydrateFromCloud,
  isCloudConfigured,
  onCloudStatusChange,
  uploadLocalToCloud,
  withTimeout,
  type CloudStatus,
} from './lib/cloud';
import { mergeCloudSnapshot } from './lib/merge';
import {
  completionKey,
  enqueue,
  enqueueMany,
  flushOutbox,
  getOutbox,
  onOutboxChange,
  pendingCount,
  SETTINGS_KEY,
  startAutoFlush,
  taskKey,
  templateKey,
  type OutboxOp,
} from './lib/syncQueue';
import { getSyncedSpaceTag, hasSpaceChanged, isSpaceIsolated, markSpaceSynced } from './lib/space';
import {
  dismissStartupForToday,
  isInAnyQuietHours,
  readStartupState,
  writeStartupState,
} from './utils/startupState';
import { cancelPendingDelete, schedulePendingDelete, takeExpiredDeletions, UNDO_WINDOW_MS } from './utils/pendingDelete';

export default function App() {
  const tasks = useTaskStore((state) => state.tasks);
  const theme = useTaskStore((state) => state.theme);
  const setTheme = useTaskStore((state) => state.setTheme);
  const reminderSettings = useTaskStore((state) => state.reminderSettings);
  const habitReminder = useHabitStore((state) => state.reminderSettings);
  const addToast = useToastStore((state) => state.addToast);

  // —— 云端：状态订阅 / 离线队列 ——
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(getCloudStatus());
  // 用队列真实条数初始化：离线刷新时首轮 flushOutbox 会在 ensureCloud 失败处直接返回（不 emit），
  // 若从 0 起步，云面板与角标会在整个启动窗口期谎报「0 项待同步」，而队列其实是满的。
  const [pendingSync, setPendingSync] = useState(() => pendingCount());
  // 未配置云时无需等待：本地数据即为权威源；配置了云则必须等 hydrate 完成，
  // 否则启动清单会基于「过期的本地数据」推送错误内容。
  const [booted, setBooted] = useState(!isCloudConfigured());
  /** 本次会话是否已经成功完成过一次云端「拉取 + 合并」 */
  const syncOkRef = useRef(false);
  /** 重新触发同步（离线启动后恢复连接时使用） */
  const [syncNonce, setSyncNonce] = useState(0);

  const reminders = useReminders(booted);

  const [view, setView] = useState<View>('board');
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskDatePrefill, setTaskDatePrefill] = useState<string | null>(null);
  const [taskSettingsOpen, setTaskSettingsOpen] = useState(false);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<TaskTemplate | null>(null);
  const [habitSettingsOpen, setHabitSettingsOpen] = useState(false);
  const [deleteHabitTarget, setDeleteHabitTarget] = useState<TaskTemplate | null>(null);
  const [startupTasks, setStartupTasks] = useState<Task[]>([]);
  const [startupHabits, setStartupHabits] = useState<TaskTemplate[]>([]);
  const [showStartupModal, setShowStartupModal] = useState(false);
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // —— 云状态订阅 / 离线队列自动冲刷 ——
  useEffect(() => onCloudStatusChange(setCloudStatus), []);
  useEffect(() => onOutboxChange((entries) => setPendingSync(entries.length)), []);

  useEffect(() => {
    if (booted && isCloudConfigured()) startAutoFlush();
  }, [booted]);

  // 设置类变更（提醒设置/主题）：本地立即生效，云端弱一致入队推送。
  // 等到 booted 之后再推，避免用启动时的旧本地设置覆盖云端权威设置。
  useEffect(() => {
    if (!isCloudConfigured() || !booted) return;
    enqueue({
      type: 'settings-set',
      key: SETTINGS_KEY,
      settings: { taskReminder: reminderSettings, habitReminder, theme },
    });
  }, [reminderSettings, habitReminder, theme, booted]);

  // 启动引导：拉云端 → 与本地按 updatedAt 合并（last-write-wins）→ 未同步内容回推。
  // syncNonce 用于「离线启动」场景：首次同步失败后，云端恢复连接时补一次拉取 + 合并。
  useEffect(() => {
    if (!isCloudConfigured()) return;
    let cancelled = false;

    const hydrate = async (): Promise<void> => {
      // 空间切换（用户改了空间密钥）：先把本地数据搬到新空间，成功前不与新空间合并，
      // 避免把旧空间的数据混进新空间。这里必须有超时兜底：
      // uploadAllLocal 会走 ensureCloud（动态加载 SDK + 匿名登录），卡住会让 booted 永远为 false。
      if (hasSpaceChanged()) {
        const upload = await withTimeout(uploadAllLocal(), CLOUD_TIMEOUT_MS * 2, '空间迁移').catch(() => false);
        if (!upload) {
          if (!cancelled) {
            addToast('切换空间后首次上传失败，已保留本地数据（联网后自动补同步）', 'error');
          }
          return;
        }
        markSpaceSynced();
      }

      // hydrateFromCloud 内部已有单请求超时，这里再加一层整体兜底
      const snapshot = await withTimeout(
        hydrateFromCloud(),
        CLOUD_TIMEOUT_MS * 2,
        'hydrate',
      ).catch(() => null);
      if (cancelled || snapshot === null) return;

      const taskState = useTaskStore.getState();
      const habitState = useHabitStore.getState();
      // deviceNeverSynced：本设备还没成功同步过（老版本升级 / 首次配置云端），
      // 合并时不能把「云端没有的本地任务」当成其他设备的删除，否则会静默丢数据。
      const deviceNeverSynced = getSyncedSpaceTag() === null;
      const outcome = mergeCloudSnapshot(
        snapshot,
        {
          tasks: taskState.tasks,
          templates: habitState.templates,
          completions: habitState.completions,
          taskReminder: taskState.reminderSettings,
          habitReminder: habitState.reminderSettings,
          theme: taskState.theme,
        },
        getOutbox(),
        { deviceNeverSynced },
      );

      useTaskStore.setState({
        tasks: outcome.tasks,
        reminderSettings: outcome.settings.taskReminder,
        theme: outcome.settings.theme,
      });
      useHabitStore.setState({
        templates: outcome.templates,
        completions: outcome.completions,
        reminderSettings: outcome.settings.habitReminder,
      });

      // 合并中「本地更新」的条目回推云端；首次迁移（云端为空）同样走这条路。
      // 批量入队：首迁可能一次产生几百条操作，逐条写入会带来 O(n²) 的存储开销。
      const pendingOps: OutboxOp[] = [
        ...outcome.push.tasks.map((task): OutboxOp => ({ type: 'task-upsert', key: taskKey(task.id), task })),
        ...outcome.push.templates.map(
          (template): OutboxOp => ({ type: 'template-upsert', key: templateKey(template.id), template }),
        ),
        ...outcome.push.completions.map(
          (item): OutboxOp => ({
            type: 'completion-set',
            key: completionKey(item.date),
            date: item.date,
            templateIds: item.templateIds,
          }),
        ),
      ];
      if (outcome.push.settings) {
        pendingOps.push({ type: 'settings-set', key: SETTINGS_KEY, settings: outcome.settings });
      }
      enqueueMany(pendingOps);

      markSpaceSynced();
      syncOkRef.current = true;
      void flushOutbox(true);

      if (snapshot.empty && (taskState.tasks.length > 0 || habitState.templates.length > 0)) {
        addToast('已同步到云端（首次迁移完成）');
      } else if (outcome.conflicts > 0 || outcome.removedByRemote > 0) {
        const parts: string[] = [];
        if (outcome.conflicts > 0) parts.push('合并 ' + outcome.conflicts + ' 处多设备改动（以较新版本为准）');
        if (outcome.removedByRemote > 0) parts.push('同步 ' + outcome.removedByRemote + ' 项其他设备的删除');
        addToast(parts.join('，'));
      }
    };

    void hydrate().finally(() => {
      if (!cancelled) setBooted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [addToast, syncNonce]);

  // 离线启动（首次同步失败）后，一旦云端恢复连接就补做一次「拉取 + 合并」，
  // 否则本次会话只会补推本地改动，看不到其他设备的新数据。
  useEffect(() => {
    if (!isCloudConfigured() || !booted || cloudStatus !== 'ready') return;
    if (syncOkRef.current) return; // 已经成功同步过一次
    setSyncNonce((n) => n + 1);
  }, [booted, cloudStatus]);

  // 每次运行（页面加载）时：检查未完成的任务与习惯，弹出清单并（已授权且非静默时段时）发送系统通知。
  // 严格在 booted（云端 hydrate + 合并完成）之后执行，保证清单基于权威数据。
  useEffect(() => {
    if (!booted) return;
    const tasksState = useTaskStore.getState();
    const habitState = useHabitStore.getState();
    const pendingTasks = tasksState.tasks.filter((t) => t.status !== 'done' && !t.archived);
    const today = todayKey();
    const doneIds = habitState.completions[today] ?? [];
    const pendingHabits = habitState.templates.filter((t) => !t.archived && !doneIds.includes(t.id));

    setStartupTasks(pendingTasks);
    setStartupHabits(pendingHabits);

    const state = readStartupState();
    const current =
      state.date !== today ? { date: today, dismissed: false, notified: false } : state;

    if (pendingTasks.length > 0 || pendingHabits.length > 0) {
      if (!current.dismissed) setShowStartupModal(true);
      if (!current.notified && !isInAnyQuietHours(tasksState.reminderSettings, habitState.reminderSettings)) {
        current.notified = true;
        if (pendingTasks.length > 0) showSystemNotification(NOTIFICATION_TITLE, buildNotificationBody(pendingTasks));
        if (pendingHabits.length > 0) showSystemNotification(HABIT_NOTIFICATION_TITLE, buildHabitReminderBody(pendingHabits));
      }
    }
    writeStartupState(current);
  }, [booted]);

  // 刷新页面时把「已过撤销期」的延迟删除落地（删除不再因刷新而丢失）
  useEffect(() => {
    const expired = takeExpiredDeletions();
    for (const item of expired) {
      if (item.kind === 'task') void useTaskStore.getState().deleteTask(item.id);
      else void useHabitStore.getState().deleteTemplate(item.id);
    }
  }, []);

  const openCreateTask = () => {
    setEditingTask(null);
    setTaskDatePrefill(null);
    setTaskModalOpen(true);
  };

  const openCreateTaskOn = (dateKey: string) => {
    setEditingTask(null);
    setTaskDatePrefill(dateKey);
    setTaskModalOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskModalOpen(true);
  };

  const openFocus = (task: Task) => {
    setFocusTask(task);
  };

  const confirmDeleteTask = () => {
    const target = deleteTaskTarget;
    setDeleteTaskTarget(null);
    if (target === null) return;
    // 延迟 5 秒真正删除，期间可在 Toast 中撤销（登记持久化，刷新后仍会落地删除）。
    // 定时器由 pendingDelete 统一管理：同一任务重复确认只会重置窗口，不会排第二个定时器；
    // 撤销会同时取消定时器与登记，窗口结束时还会再查一次登记，因此撤销后绝不会被删除。
    schedulePendingDelete(
      { kind: 'task', id: target.id, at: Date.now() + UNDO_WINDOW_MS },
      (item) => void useTaskStore.getState().deleteTask(item.id),
    );
    addToast('任务已删除，5 秒内可撤销', 'success', {
      actionLabel: '撤销',
      // 与撤销窗口保持一致：窗口一过按钮同步消失，不会出现「点了没反应」
      duration: UNDO_WINDOW_MS,
      onAction: () => cancelPendingDelete('task', target.id),
    });
  };

  const openCreateHabit = () => {
    setEditingHabit(null);
    setHabitModalOpen(true);
  };

  const openEditHabit = (habit: TaskTemplate) => {
    setEditingHabit(habit);
    setHabitModalOpen(true);
  };

  const confirmDeleteHabit = () => {
    const target = deleteHabitTarget;
    setDeleteHabitTarget(null);
    if (target === null) return;
    // 延迟 5 秒真正删除，期间可在 Toast 中撤销（完成记录随删除一并清除）；
    // 定时器与撤销语义同任务删除，见 pendingDelete.ts
    schedulePendingDelete(
      { kind: 'habit', id: target.id, at: Date.now() + UNDO_WINDOW_MS },
      (item) => void useHabitStore.getState().deleteTemplate(item.id),
    );
    addToast('习惯已删除，5 秒内可撤销', 'success', {
      actionLabel: '撤销',
      duration: UNDO_WINDOW_MS,
      onAction: () => cancelPendingDelete('habit', target.id),
    });
  };

  const handleDismissStartupToday = () => {
    dismissStartupForToday(todayKey());
    setShowStartupModal(false);
  };

  const handleOpenSettings = () => {
    if (view === 'board') setTaskSettingsOpen(true);
    else setHabitSettingsOpen(true);
  };

  const handleCreate = () => {
    if (view === 'board' || view === 'calendar') openCreateTask();
    else openCreateHabit();
  };

  // 番茄钟完成时标记任务完成（与卡片完成逻辑一致：重复任务生成下一周期副本）
  const handleMarkDoneFromFocus = async (task: Task) => {
    const wasOverdue = isOverdue(task.startDate, task.dueDate, task.status);
    if (task.repeat !== undefined) {
      const next = await useTaskStore.getState().completeRecurring(task.id);
      addToast(next !== null ? '任务已完成，已生成下一周期任务' : '任务已完成');
    } else {
      await useTaskStore.getState().toggleDone(task.id);
      addToast(wasOverdue ? '任务已完成（已逾期）' : '任务已完成');
    }
    setFocusTask(null);
  };

  const handleRetrySync = useCallback(() => {
    void flushOutbox(true);
  }, []);

  // 键盘快捷键：N 新建 / / 搜索 / 1-4 切视图 / D 切主题 / ? 帮助
  useKeyboardShortcuts({
    onNew: handleCreate,
    onSearch: () => {
      setView('board');
      window.requestAnimationFrame(() => {
        const input = document.getElementById('task-search');
        if (input !== null) (input as HTMLInputElement).focus();
      });
    },
    onSwitchView: setView,
    onToggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    onHelp: () => setShowKeyboardHelp(true),
  });

  const cloudConfigured = isCloudConfigured();
  const showSpaceWarning = cloudConfigured && !isSpaceIsolated();

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      <Header
        view={view}
        onSwitchView={setView}
        onOpenSettings={handleOpenSettings}
        onOpenCloud={() => setCloudPanelOpen(true)}
        pendingSync={pendingSync}
        onCreate={handleCreate}
      />
      <PermissionBanner />

      <div className="mx-auto max-w-7xl space-y-2 px-4 sm:px-6 lg:px-8">
        {cloudConfigured && cloudStatus === 'failed' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <span>
              云端未连接，当前写入保存在本机并进入待同步队列（联网后自动补同步）。请检查网络或
              <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">VITE_CLOUDBASE_ENV</code>
              配置。
            </span>
            <button type="button" onClick={handleRetrySync} className="rounded-full border border-amber-400 px-2.5 py-0.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50">
              立即重试
            </button>
          </div>
        )}

        {cloudConfigured && cloudStatus !== 'failed' && pendingSync > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <span>{pendingSync} 项改动待同步到云端，正在自动重试。</span>
            <button type="button" onClick={handleRetrySync} className="rounded-full border border-sky-400 px-2.5 py-0.5 text-xs font-semibold hover:bg-sky-100 dark:hover:bg-sky-900/50">
              立即同步
            </button>
          </div>
        )}

        {showSpaceWarning && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <span>
              未设置空间密钥：当前云端为「全局共享」模式，任何拿到 envId 的人都能读写全部数据。建议设置空间密钥开启隔离。
            </span>
            <button type="button" onClick={() => setCloudPanelOpen(true)} className="rounded-full border border-rose-400 px-2.5 py-0.5 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/50">
              去设置
            </button>
          </div>
        )}
      </div>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {view === 'board' ? (
          <>
            <StatsCards tasks={tasks} />
            <FilterBar filters={filters} onChange={setFilters} />
            <BoardView
              tasks={tasks}
              filters={filters}
              onEdit={openEditTask}
              onDelete={setDeleteTaskTarget}
              onFocus={openFocus}
              onClearFilters={() => setFilters(DEFAULT_FILTERS)}
            />
          </>
        ) : view === 'habits' ? (
          <HabitsView onEdit={openEditHabit} onDelete={setDeleteHabitTarget} />
        ) : view === 'calendar' ? (
          <CalendarView tasks={tasks} onEdit={openEditTask} onCreateForDate={openCreateTaskOn} />
        ) : (
          <StatsView />
        )}
      </main>

      {/* 任务相关弹窗 */}
      <TaskModal open={taskModalOpen} task={editingTask} initialStartDate={taskDatePrefill} onClose={() => setTaskModalOpen(false)} />
      <FocusModal open={focusTask !== null} task={focusTask} onClose={() => setFocusTask(null)} onMarkDone={handleMarkDoneFromFocus} />
      <KeyboardHelpModal open={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
      <ConfirmDialog
        open={deleteTaskTarget !== null}
        title="删除任务"
        description={'确定要删除任务「' + (deleteTaskTarget !== null ? deleteTaskTarget.title : '') + '」吗？删除后 5 秒内可在提示中撤销。'}
        onConfirm={confirmDeleteTask}
        onCancel={() => setDeleteTaskTarget(null)}
      />
      <ReminderSettingsModal open={taskSettingsOpen} onClose={() => setTaskSettingsOpen(false)} />
      <CloudPanelModal open={cloudPanelOpen} onClose={() => setCloudPanelOpen(false)} pendingSync={pendingSync} />

      {/* 习惯相关弹窗 */}
      <HabitModal open={habitModalOpen} habit={editingHabit} onClose={() => setHabitModalOpen(false)} />
      <ConfirmDialog
        open={deleteHabitTarget !== null}
        title="删除习惯"
        description={'确定要删除习惯「' + (deleteHabitTarget !== null ? deleteHabitTarget.title : '') + '」吗？完成记录将一并清除，删除后 5 秒内可在提示中撤销。'}
        onConfirm={confirmDeleteHabit}
        onCancel={() => setDeleteHabitTarget(null)}
      />
      <HabitReminderSettingsModal open={habitSettingsOpen} onClose={() => setHabitSettingsOpen(false)} />

      {/* 启动时未完成清单弹窗 */}
      <StartupSummaryModal
        open={showStartupModal}
        pendingTasks={startupTasks}
        pendingHabits={startupHabits}
        onClose={() => setShowStartupModal(false)}
        onDismissToday={handleDismissStartupToday}
      />

      {/* 内部提醒横幅（右下角堆叠） */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2">
        {reminders.taskBanner !== null && (
          <ReminderBanner message={reminders.taskBanner.message} onDismiss={reminders.dismissTaskBanner} />
        )}
        {reminders.habitBanner !== null && (
          <ReminderBanner title={reminders.habitBanner.title} message={reminders.habitBanner.message} onDismiss={reminders.dismissHabitBanner} />
        )}
      </div>

      <Toaster />
    </div>
  );
}

/** 全量上传本地数据（空间切换时的首次迁移） */
async function uploadAllLocal(): Promise<boolean> {
  const taskState = useTaskStore.getState();
  const habitState = useHabitStore.getState();
  const result = await uploadLocalToCloud({
    tasks: taskState.tasks,
    templates: habitState.templates,
    completions: habitState.completions,
    settings: {
      taskReminder: taskState.reminderSettings,
      habitReminder: habitState.reminderSettings,
      theme: taskState.theme,
    },
  });
  return result.ok;
}
