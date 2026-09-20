export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type ReminderFrequency = 'daily' | 'weekly' | 'monthly';
export type RepeatFrequency = 'daily' | 'weekly' | 'monthly';
export type Theme = 'light' | 'dark';
export type View = 'board' | 'habits' | 'calendar' | 'stats';

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  startDate: string; // 开始时间，格式 "YYYY-MM-DDTHH:mm"（为空表示未安排开始时间，不自动转入进行中）
  dueDate: string; // 截止时间，格式 "YYYY-MM-DDTHH:mm"（为空表示无截止日期；旧数据可为 "YYYY-MM-DD"）
  createdAt: number;
  /** 最后一次内容修改时间（用于多设备冲突的 last-write-wins 合并） */
  updatedAt: number;
  /** 实际完成时间戳；未完成时为 null/undefined。统计口径以此为准，不再用 updatedAt 近似 */
  completedAt?: number | null;
  /** 重复频率：完成任务时自动生成下一周期副本（每天/每周/每月） */
  repeat?: RepeatFrequency;
  /**
   * 自动生成的副本溯源：记录「本任务是哪个重复任务生成的」。
   * 用于取消完成原任务时回收尚未被触碰的副本（见 store 的 findReclaimableCopy）。
   */
  repeatOf?: string;
  /** 已归档：从看板移入「已归档」区，不参与统计与提醒，可恢复 */
  archived?: boolean;
}

export interface ReminderSettings {
  enabled: boolean;
  frequency: ReminderFrequency;
  time: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  lastSentAt: number | null;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待处理',
  'in-progress': '进行中',
  done: '已完成',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const FREQUENCY_LABELS: Record<ReminderFrequency, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

export const REPEAT_LABELS: Record<RepeatFrequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

export const REPEAT_OPTIONS: Array<{ value: RepeatFrequency | 'none'; label: string }> = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];