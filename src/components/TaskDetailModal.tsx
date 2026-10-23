import type { ReactNode } from 'react';
import {
  AlertCircle,
  Archive,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Pencil,
  Play,
  Repeat,
  X,
} from 'lucide-react';
import type { Priority, Task, TaskStatus } from '../types';
import { PRIORITY_LABELS, REPEAT_LABELS, STATUS_LABELS } from '../types';
import { formatDate, formatTimestamp, isDueToday, isOverdue } from '../utils/date';
import Modal from './Modal';

interface TaskDetailModalProps {
  open: boolean;
  /** 要查看的任务；为 null 时弹窗内不渲染任何内容（显隐仍由 open 控制） */
  task: Task | null;
  onClose: () => void;
  onEdit: (task: Task) => void;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  'in-progress': 'bg-primary/10 text-primary',
  done: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

const BADGE = 'rounded-full px-2 py-0.5 text-xs font-medium';

/** 时间戳展示：缺失、0 或非法值统一显示「—」，避免把 0 渲染成 1970 年 */
function showTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return '—';
  return formatTimestamp(ms) || '—';
}

interface DetailFieldProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}

/** 单个字段行：图标 + 标签 + 值 */
function DetailField({ icon, label, children }: DetailFieldProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-sm font-medium text-card-foreground">{children}</p>
      </div>
    </div>
  );
}

/**
 * 只读的任务详情弹窗：完整展示标题、描述与各项时间，所有字段都不可编辑。
 * 需要修改时通过底部「编辑任务」转给 TaskModal（由 App 统一切换，两个弹窗不叠加）。
 */
export default function TaskDetailModal({ open, task, onClose, onEdit }: TaskDetailModalProps) {
  const done = task?.status === 'done';
  const overdue = task !== null && isOverdue(task.startDate, task.dueDate, task.status);
  const dueToday = task !== null && !done && isDueToday(task.dueDate);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="任务详情"
      panelClassName="rounded-3xl bg-popover p-6 shadow-apple-lg"
    >
      {task === null ? null : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Eye className="h-5 w-5 text-primary" />
              任务详情
            </h2>
            <button type="button" onClick={onClose} aria-label="关闭" className="btn-ghost">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div>
              <h3
                className={
                  'break-words text-lg font-bold tracking-tight ' +
                  (done ? 'text-muted-foreground line-through' : 'text-card-foreground')
                }
              >
                {task.title}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={BADGE + ' ' + STATUS_STYLES[task.status]}>{STATUS_LABELS[task.status]}</span>
                <span className={BADGE + ' ' + PRIORITY_STYLES[task.priority]}>
                  {PRIORITY_LABELS[task.priority]}优先级
                </span>
                {task.repeat !== undefined && (
                  <span className={BADGE + ' inline-flex items-center gap-1 bg-primary/10 text-primary'}>
                    <Repeat className="h-3 w-3" />
                    {REPEAT_LABELS[task.repeat]}
                  </span>
                )}
                {task.archived === true && (
                  <span className={BADGE + ' inline-flex items-center gap-1 bg-muted text-muted-foreground'}>
                    <Archive className="h-3 w-3" />
                    已归档
                  </span>
                )}
                {overdue && (
                  <span
                    className={
                      BADGE + ' inline-flex items-center gap-1 bg-red-500/10 text-red-600 dark:text-red-400'
                    }
                  >
                    <AlertCircle className="h-3 w-3" />
                    已逾期
                  </span>
                )}
                {dueToday && (
                  <span className={BADGE + ' bg-amber-500/10 text-amber-600 dark:text-amber-400'}>今日截止</span>
                )}
              </div>
            </div>

            <section className="rounded-xl border border-border/50 bg-muted/40 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                详细描述
              </p>
              {task.description !== '' ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-card-foreground">
                  {task.description}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">暂无详细描述</p>
              )}
            </section>

            <div className="grid gap-2 sm:grid-cols-2">
              <DetailField icon={<Play className="h-3.5 w-3.5" />} label="开始时间">
                {task.startDate !== '' ? formatDate(task.startDate) : '未安排'}
              </DetailField>
              <DetailField icon={<Calendar className="h-3.5 w-3.5" />} label="截止时间">
                {task.dueDate !== '' ? (
                  <span className={overdue || dueToday ? 'font-semibold text-red-600 dark:text-red-400' : undefined}>
                    {formatDate(task.dueDate)}
                  </span>
                ) : (
                  '无截止日期'
                )}
              </DetailField>
              <DetailField icon={<Clock className="h-3.5 w-3.5" />} label="创建时间">
                {showTimestamp(task.createdAt)}
              </DetailField>
              <DetailField icon={<Clock className="h-3.5 w-3.5" />} label="最后更新">
                {showTimestamp(task.updatedAt)}
              </DetailField>
              {task.completedAt !== undefined && (
                <DetailField icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="完成时间">
                  {showTimestamp(task.completedAt)}
                </DetailField>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="btn-primary" onClick={() => onEdit(task)}>
              <Pencil className="h-4 w-4" />
              编辑任务
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
