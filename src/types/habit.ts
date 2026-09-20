export interface TaskTemplate {
  id: string;
  title: string;
  emoji?: string;
  category?: string;
  createdAt: string;
  /** 最后一次修改时间戳（毫秒）。旧数据可能缺失，合并时回退到 createdAt */
  updatedAt?: number;
  /** 已归档：暂停参与每日统计/提醒，但保留完成记录 */
  archived?: boolean;
}

export interface HabitReminderSettings {
  enabled: boolean;
  time: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  lastSentAt: number | null;
}

// 每日完成记录：日期 "YYYY-MM-DD" -> 已完成的习惯模板 id 列表
export type CompletionMap = Record<string, string[]>;