import { Archive, Check, Pencil, Trash2 } from 'lucide-react';
import type { TaskTemplate } from '../../types/habit';

interface HabitItemProps {
  habit: TaskTemplate;
  done: boolean;
  onToggle: (id: string) => void;
  onEdit: (habit: TaskTemplate) => void;
  onDelete: (habit: TaskTemplate) => void;
  onArchive: (habit: TaskTemplate) => void;
}

export default function HabitItem({ habit, done, onToggle, onEdit, onDelete, onArchive }: HabitItemProps) {
  return (
    <div
      className={
        'group flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-apple transition duration-200 hover:shadow-apple-md ' +
        (done
          ? 'border-success/30 bg-success/5 dark:bg-success/10'
          : 'border-border/60')
      }
    >
      <button
        type="button"
        onClick={() => onToggle(habit.id)}
        aria-label={done ? '标记为未完成' : '标记为已完成'}
        className={
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition duration-200 active:scale-90 ' +
          (done
            ? 'border-success bg-success text-white shadow-sm'
            : 'border-muted-foreground/30 bg-transparent text-transparent hover:border-primary hover:text-primary/40 dark:border-muted-foreground/40')
        }
      >
        <Check className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {habit.emoji !== undefined && habit.emoji !== '' && (
            <span className="text-xl leading-none">{habit.emoji}</span>
          )}
          <h3
            className={
              'truncate font-semibold tracking-tight ' +
              (done ? 'text-muted-foreground line-through' : 'text-foreground')
            }
          >
            {habit.title}
          </h3>
          {habit.category !== undefined && habit.category !== '' && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {habit.category}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(habit)}
          aria-label="编辑习惯"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onArchive(habit)}
          aria-label="归档习惯"
          title="归档：暂停参与每日统计与提醒，保留完成记录"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-warning"
        >
          <Archive className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(habit)}
          aria-label="删除习惯"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}