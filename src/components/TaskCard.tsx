import { AlertCircle, Archive, Calendar, CheckCircle2, GripVertical, Pencil, Play, Repeat, Timer, Trash2 } from 'lucide-react';
import type { Priority, Task } from '../types';
import { PRIORITY_LABELS, REPEAT_LABELS } from '../types';
import { formatDate, isDueToday, isOverdue } from '../utils/date';
import { useTaskStore } from '../store/useTaskStore';
import { useToastStore } from '../store/useToastStore';
import { useFocusStore } from '../store/useFocusStore';

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onFocus: (task: Task) => void;
  overlay?: boolean;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export default function TaskCard({ task, onEdit, onDelete, onFocus, overlay = false }: TaskCardProps) {
  const toggleDone = useTaskStore((state) => state.toggleDone);
  const completeRecurring = useTaskStore((state) => state.completeRecurring);
  const archiveTask = useTaskStore((state) => state.archiveTask);
  const addToast = useToastStore((state) => state.addToast);
  const focusTaskId = useFocusStore((state) => state.taskId);

  const done = task.status === 'done';
  const overdue = isOverdue(task.startDate, task.dueDate, task.status);
  const dueToday = !done && isDueToday(task.dueDate);
  const inFocus = focusTaskId === task.id;
  const focusBlocked = focusTaskId !== null && !inFocus;

  const handleToggleDone = async () => {
    const completing = task.status !== 'done';
    const wasOverdue = isOverdue(task.startDate, task.dueDate, task.status);
    if (completing && task.repeat !== undefined) {
      const next = await completeRecurring(task.id);
      addToast(next !== null ? '任务已完成，已生成下一周期任务' : wasOverdue ? '任务已完成（已逾期）' : '任务已完成');
      return;
    }
    const result = await toggleDone(task.id);
    if (!result.ok) return;
    if (completing) {
      addToast(wasOverdue ? '任务已完成（已逾期）' : '任务已完成');
    } else {
      // 取消完成可能顺带回收刚才自动生成的副本，需要明确告知，避免任务「莫名消失」
      addToast(result.reclaimedCopyId !== null ? '已取消完成，并移除了自动生成的下一周期任务' : '已取消完成');
    }
  };

  const handleArchive = async () => {
    const ok = await archiveTask(task.id);
    if (ok) addToast('任务已归档，可在看板下方恢复');
  };

  return (
    <article
      className={
        'group relative rounded-2xl border border-border/60 bg-card p-4 shadow-apple transition-all duration-200 hover:shadow-apple-md' +
        (overlay ? ' cursor-grabbing ring-2 ring-primary shadow-apple-lg' : '') +
        (done ? ' opacity-70' : '')
      }
    >
      <div className="flex items-start gap-2.5">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={
                'truncate font-semibold tracking-tight ' +
                (done ? 'text-muted-foreground line-through' : 'text-card-foreground')
              }
            >
              {task.title}
            </h3>
            <span className={'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' + PRIORITY_STYLES[task.priority]}>
              {PRIORITY_LABELS[task.priority]}
            </span>
            {task.repeat !== undefined && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Repeat className="h-3 w-3" />
                {REPEAT_LABELS[task.repeat]}
              </span>
            )}
          </div>

          {task.description !== '' && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {task.startDate !== '' && (
              <span className="inline-flex items-center gap-1">
                <Play className="h-3.5 w-3.5" />
                {formatDate(task.startDate)}
              </span>
            )}
            {task.dueDate !== '' && (
              <span className={'inline-flex items-center gap-1 ' + (dueToday ? 'font-semibold text-red-600 dark:text-red-400' : '')}>
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(task.dueDate)}
                {dueToday ? ' · 今日截止' : ''}
              </span>
            )}
            {overdue && (
              <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                已逾期
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-1">
          <button
            type="button"
            onClick={handleToggleDone}
            aria-label={done ? '取消完成' : '标记完成'}
            className={
              'mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-200 ' +
              (done
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-gray-300 text-transparent hover:border-emerald-400 hover:text-emerald-500/60 dark:border-gray-600')
            }
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onFocus(task)}
              aria-label={inFocus ? '专注进行中' : focusBlocked ? '已有专注进行中' : '开始专注'}
              title={inFocus ? '专注进行中' : focusBlocked ? '已有其他任务专注中' : '番茄钟专注'}
              disabled={focusBlocked}
              className={
                'rounded-full p-1.5 transition-colors ' +
                (inFocus
                  ? 'text-emerald-500 hover:bg-accent'
                  : 'text-muted-foreground hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40')
              }
            >
              <Timer className={'h-4 w-4 ' + (inFocus ? 'animate-pulse' : '')} />
            </button>
            <button
              type="button"
              onClick={handleArchive}
              aria-label="归档任务"
              title="归档（不参与统计与提醒，可恢复）"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <Archive className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onEdit(task)}
              aria-label="编辑任务"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(task)}
              aria-label="删除任务"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}