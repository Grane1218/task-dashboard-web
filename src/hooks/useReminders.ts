import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useHabitStore } from '../store/useHabitStore';
import { shouldTriggerReminder } from '../utils/reminderScheduler';
import {
  HABIT_NOTIFICATION_TITLE,
  buildHabitReminderBody,
  shouldTriggerHabitReminder,
  todayKey,
} from '../utils/habit';
import { buildNotificationBody, NOTIFICATION_TITLE, showSystemNotification } from '../utils/notificationHelper';

const CHECK_INTERVAL_MS = 60 * 1000;
const BANNER_DURATION_MS = 15 * 1000;

export interface ReminderBannerState {
  title: string;
  message: string;
}

/**
 * 统一的分钟级轮询：一次定时器内完成三件事 ——
 * 1) 到达开始时间的「待处理」任务自动转入「进行中」
 * 2) 任务提醒检查（系统通知 + 应用内横幅）
 * 3) 习惯提醒检查（系统通知 + 应用内横幅）
 *
 * 定时器只在挂载时创建一次（tick 内通过 getState() 读取最新状态），
 * 不随任务/设置变化重建；切回前台时立即补检一次。
 *
 * enabled 为 false 时完全不启动：配置了云端时必须等 hydrate + 合并完成后再跑，
 * 否则会基于过期的本地数据把任务误转「进行中」并推回云端。
 */
export function useReminders(enabled = true) {
  const [taskBanner, setTaskBanner] = useState<ReminderBannerState | null>(null);
  const [habitBanner, setHabitBanner] = useState<ReminderBannerState | null>(null);
  const timersRef = useRef<{ task: number | null; habit: number | null }>({ task: null, habit: null });

  const tick = useCallback(() => {
    // 1) 任务自动转入进行中
    useTaskStore.getState().promoteStartedTasks();

    // 2) 任务提醒
    const taskState = useTaskStore.getState();
    if (taskState.reminderSettings.enabled) {
      const pendingTasks = taskState.tasks.filter((task) => task.status !== 'done' && !task.archived);
      const result = shouldTriggerReminder(taskState.reminderSettings, pendingTasks);
      if (result.shouldNotify) {
        const body = buildNotificationBody(result.pendingTasks);
        showSystemNotification(NOTIFICATION_TITLE, body);
        taskState.recordReminderSent(Date.now());

        setTaskBanner({ title: NOTIFICATION_TITLE, message: body });
        if (timersRef.current.task !== null) window.clearTimeout(timersRef.current.task);
        timersRef.current.task = window.setTimeout(() => setTaskBanner(null), BANNER_DURATION_MS);
      }
    }

    // 3) 习惯提醒
    const habitState = useHabitStore.getState();
    if (habitState.reminderSettings.enabled) {
      const today = todayKey();
      const doneIds = habitState.completions[today] ?? [];
      const pendingHabits = habitState.templates.filter(
        (template) => !template.archived && !doneIds.includes(template.id),
      );
      const result = shouldTriggerHabitReminder(habitState.reminderSettings, pendingHabits);
      if (result.shouldNotify) {
        const body = buildHabitReminderBody(result.pending);
        showSystemNotification(HABIT_NOTIFICATION_TITLE, body);
        habitState.recordReminderSent(Date.now());

        setHabitBanner({ title: HABIT_NOTIFICATION_TITLE, message: body });
        if (timersRef.current.habit !== null) window.clearTimeout(timersRef.current.habit);
        timersRef.current.habit = window.setTimeout(() => setHabitBanner(null), BANNER_DURATION_MS);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    tick(); // 挂载立即检查一次

    const intervalId = window.setInterval(tick, CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timersRef.current.task !== null) window.clearTimeout(timersRef.current.task);
      if (timersRef.current.habit !== null) window.clearTimeout(timersRef.current.habit);
    };
  }, [tick, enabled]);

  const dismissTaskBanner = useCallback(() => {
    setTaskBanner(null);
    if (timersRef.current.task !== null) {
      window.clearTimeout(timersRef.current.task);
      timersRef.current.task = null;
    }
  }, []);

  const dismissHabitBanner = useCallback(() => {
    setHabitBanner(null);
    if (timersRef.current.habit !== null) {
      window.clearTimeout(timersRef.current.habit);
      timersRef.current.habit = null;
    }
  }, []);

  return { taskBanner, habitBanner, dismissTaskBanner, dismissHabitBanner };
}
