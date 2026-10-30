import { CheckSquare, ClipboardList, ListChecks, X } from 'lucide-react';
import type { Task } from '../types';
import type { TaskTemplate } from '../types/habit';
import { PRIORITY_LABELS } from '../types';
import { formatDate, isDueToday, isOverdue } from '../utils/date';
import Modal from './Modal';

interface StartupSummaryModalProps {
  open: boolean;
  pendingTasks: Task[];
  pendingHabits: TaskTemplate[];
  onClose: () => void;
  onDismissToday: () => void;
}

const PRIORITY_TEXT: Record<Task['priority'], string> = {
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-success',
};

export default function StartupSummaryModal({ open, pendingTasks, pendingHabits, onClose, onDismissToday }: StartupSummaryModalProps) {
  if (!open) return null;
  const total = pendingTasks.length + pendingHabits.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="开工提醒"
      panelClassName="overflow-hidden rounded-3xl bg-popover shadow-apple-lg"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-bold tracking-tight">开工提醒</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭" className="btn-ghost">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted-foreground">
          你还有 <span className="font-semibold text-foreground tabular-nums">{total}</span> 项未完成：
        </p>

        {pendingTasks.length > 0 && (
          <div className="mt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <CheckSquare className="h-4 w-4 text-primary" />
              未完成任务（{pendingTasks.length}）
            </h3>
            <ul className="mt-2 space-y-1.5">
              {pendingTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2">
                  <span className={'shrink-0 text-xs font-semibold ' + PRIORITY_TEXT[t.priority]}>{PRIORITY_LABELS[t.priority]}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                  {t.dueDate !== '' && (
                    <span
                      className={
                        'shrink-0 text-xs ' +
                        (isOverdue(t.startDate, t.dueDate, t.status) || isDueToday(t.dueDate)
                          ? 'font-semibold text-destructive'
                          : 'text-muted-foreground')
                      }
                    >
                      {formatDate(t.dueDate)}
                      {isOverdue(t.startDate, t.dueDate, t.status) ? ' · 已逾期' : isDueToday(t.dueDate) ? ' · 今日截止' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pendingHabits.length > 0 && (
          <div className="mt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ListChecks className="h-4 w-4 text-primary" />
              未完成习惯（{pendingHabits.length}）
            </h3>
            <ul className="mt-2 space-y-1.5">
              {pendingHabits.map((h) => (
                <li key={h.id} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2">
                  {h.emoji !== undefined && h.emoji !== '' && <span className="text-lg leading-none">{h.emoji}</span>}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h.title}</span>
                  {h.category !== undefined && h.category !== '' && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{h.category}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 px-5 py-3.5">
        <button
          type="button"
          onClick={onDismissToday}
          className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          今天不再提醒
        </button>
        <button type="button" onClick={onClose} className="btn-primary">
          知道了
        </button>
      </div>
    </Modal>
  );
}
