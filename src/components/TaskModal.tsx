import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Priority, RepeatFrequency, Task } from '../types';
import { PRIORITY_LABELS, REPEAT_OPTIONS } from '../types';
import { toDateTimeLocal } from '../utils/date';
import { useTaskStore } from '../store/useTaskStore';
import { useToastStore } from '../store/useToastStore';
import Modal from './Modal';

interface TaskModalProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  /** 新建时预填的开始日期（"YYYY-MM-DD"），用于日历点击空白格子快速创建 */
  initialStartDate?: string | null;
}

interface TaskFormState {
  title: string;
  description: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  repeat: RepeatFrequency | 'none';
}

const EMPTY_FORM: TaskFormState = {
  title: '',
  description: '',
  priority: 'medium',
  startDate: '',
  dueDate: '',
  repeat: 'none',
};

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

const PRIORITY_BUTTON_STYLES: Record<Priority, string> = {
  high: 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300',
  medium: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

const PRIORITY_ACTIVE_STYLES: Record<Priority, string> = {
  high: 'border-red-500 bg-red-100 ring-2 ring-red-500/30 dark:border-red-400 dark:bg-red-900/50',
  medium: 'border-amber-500 bg-amber-100 ring-2 ring-amber-500/30 dark:border-amber-400 dark:bg-amber-900/50',
  low: 'border-emerald-500 bg-emerald-100 ring-2 ring-emerald-500/30 dark:border-emerald-400 dark:bg-emerald-900/50',
};

export default function TaskModal({ open, task, onClose, initialStartDate = null }: TaskModalProps) {
  const addTask = useTaskStore((state) => state.addTask);
  const updateTask = useTaskStore((state) => state.updateTask);
  const addToast = useToastStore((state) => state.addToast);

  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [noDue, setNoDue] = useState(true);

  useEffect(() => {
    if (open) {
      setForm(
        task
          ? {
              title: task.title,
              description: task.description,
              priority: task.priority,
              startDate: toDateTimeLocal(task.startDate),
              dueDate: toDateTimeLocal(task.dueDate),
              repeat: task.repeat ?? 'none',
            }
          : initialStartDate !== null && initialStartDate !== ''
            ? { ...EMPTY_FORM, startDate: initialStartDate + 'T09:00' }
            : EMPTY_FORM,
      );
      setNoDue(task ? task.dueDate === '' : true);
      setError('');
    }
  }, [open, task, initialStartDate]);

  if (!open) return null;

  const updateField = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    if (title === '') {
      setError('请输入任务标题');
      return;
    }
    const dueDate = noDue ? '' : form.dueDate;
    const repeat = form.repeat === 'none' ? undefined : form.repeat;
    let saved = false;
    if (task) {
      saved = await updateTask(task.id, {
        title,
        description: form.description.trim(),
        priority: form.priority,
        startDate: form.startDate,
        dueDate,
        repeat,
      });
      if (saved) addToast('任务已更新');
    } else {
      const created = await addTask({
        title,
        description: form.description.trim(),
        priority: form.priority,
        startDate: form.startDate,
        dueDate,
        repeat,
      });
      if (created !== null) {
        saved = true;
        addToast('任务已创建');
      }
    }
    // 写入为本地先行（云端由离线队列异步补推），只有取不到任务时 saved 才为 false
    if (saved) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={task ? '编辑任务' : '新建任务'} panelClassName="rounded-3xl bg-popover p-6 shadow-apple-lg">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">{task ? '编辑任务' : '新建任务'}</h2>
        <button type="button" onClick={onClose} aria-label="关闭" className="btn-ghost">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="task-title" className="mb-1.5 block text-sm font-medium text-foreground">
            标题 <span className="text-destructive">*</span>
          </label>
          <input
            id="task-title"
            type="text"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="请输入任务标题"
            autoFocus
            className="input-apple"
          />
          {error !== '' && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        <div>
          <label htmlFor="task-description" className="mb-1.5 block text-sm font-medium text-foreground">
            详细描述
          </label>
          <textarea
            id="task-description"
            value={form.description}
            onChange={(event) => updateField('description', event.target.value)}
            placeholder="补充任务的详细说明（可选）"
            rows={4}
            className="input-apple resize-none"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">优先级</span>
          <div className="grid grid-cols-3 gap-2">
            {PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                onClick={() => updateField('priority', priority)}
                className={
                  'rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200 ' +
                  (form.priority === priority ? PRIORITY_ACTIVE_STYLES[priority] : PRIORITY_BUTTON_STYLES[priority])
                }
              >
                {PRIORITY_LABELS[priority]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">重复</span>
          <div className="grid grid-cols-4 gap-2">
            {REPEAT_OPTIONS.map((option) => {
              const active = form.repeat === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateField('repeat', option.value)}
                  className={
                    'rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200 ' +
                    (active
                      ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/25'
                      : 'border-border text-muted-foreground hover:bg-accent')
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">设为重复后，完成任务时自动生成下一周期任务（日期顺延），当前任务保留在已完成。</p>
        </div>

        <div>
          <label htmlFor="task-start-date" className="mb-1.5 block text-sm font-medium text-foreground">
            开始时间
          </label>
          <input
            id="task-start-date"
            type="datetime-local"
            value={form.startDate}
            onChange={(event) => updateField('startDate', event.target.value)}
            className="input-apple"
          />
          <p className="mt-1 text-xs text-muted-foreground">到达开始时间后，任务会自动转入「进行中」。</p>
        </div>

        <div>
          <label htmlFor="task-due-date" className="mb-1.5 block text-sm font-medium text-foreground">
            截止时间
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="task-due-date"
              type="datetime-local"
              value={noDue ? '' : form.dueDate}
              onChange={(event) => updateField('dueDate', event.target.value)}
              disabled={noDue}
              className="input-apple flex-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={noDue}
                onChange={(event) => setNoDue(event.target.checked)}
                className="h-4 w-4 rounded border-border text-primary accent-primary focus:ring-primary"
              />
              无截止日期
            </label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">超过截止日期当天仍未完成，将标记为「已逾期」。</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" className="btn-primary">
            {task ? '保存修改' : '创建任务'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
