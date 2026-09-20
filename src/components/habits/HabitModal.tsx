import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { TaskTemplate } from '../../types/habit';
import { useHabitStore } from '../../store/useHabitStore';
import { useToastStore } from '../../store/useToastStore';
import Modal from '../Modal';

interface HabitModalProps {
  open: boolean;
  habit: TaskTemplate | null;
  onClose: () => void;
}

interface HabitFormState {
  title: string;
  emoji: string;
  category: string;
}

const EMPTY_FORM: HabitFormState = { title: '', emoji: '', category: '' };
const EMOJI_PRESETS = ['🏃', '📖', '💧', '🧘', '💪', '🥗', '😴', '✍️', '🧠', '🎯'];

export default function HabitModal({ open, habit, onClose }: HabitModalProps) {
  const templates = useHabitStore((state) => state.templates);
  const addTemplate = useHabitStore((state) => state.addTemplate);
  const updateTemplate = useHabitStore((state) => state.updateTemplate);
  const addToast = useToastStore((state) => state.addToast);

  const [form, setForm] = useState<HabitFormState>(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(
        habit
          ? { title: habit.title, emoji: habit.emoji ?? '', category: habit.category ?? '' }
          : EMPTY_FORM,
      );
      setError('');
    }
  }, [open, habit]);

  if (!open) return null;

  const categories = Array.from(
    new Set(templates.map((t) => t.category).filter((c): c is string => !!c && c !== '')),
  );

  const updateField = <K extends keyof HabitFormState>(key: K, value: HabitFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    if (title === '') {
      setError('请输入习惯标题');
      return;
    }
    const emoji = form.emoji.trim();
    const category = form.category.trim();
    let saved = false;
    if (habit) {
      saved = await updateTemplate(habit.id, {
        title,
        emoji: emoji === '' ? undefined : emoji,
        category: category === '' ? undefined : category,
      });
      if (saved) addToast('习惯已更新');
    } else {
      const created = await addTemplate({
        title,
        emoji: emoji === '' ? undefined : emoji,
        category: category === '' ? undefined : category,
      });
      if (created !== null) {
        saved = true;
        addToast('习惯已添加');
      }
    }
    // 写入为本地先行（云端由离线队列异步补推），只有取不到习惯时 saved 才为 false
    if (saved) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={habit ? '编辑习惯' : '添加习惯'} panelClassName="rounded-3xl bg-popover p-6 shadow-apple-lg">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">{habit ? '编辑习惯' : '添加习惯'}</h2>
        <button type="button" onClick={onClose} aria-label="关闭" className="btn-ghost">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="habit-title" className="mb-1.5 block text-sm font-medium text-foreground">
            标题 <span className="text-destructive">*</span>
          </label>
          <input
            id="habit-title"
            type="text"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="例如：早起喝水、锻炼30分钟"
            autoFocus
            className="input-apple"
          />
          {error !== '' && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        <div>
          <label htmlFor="habit-emoji" className="mb-1.5 block text-sm font-medium text-foreground">
            图标（可选）
          </label>
          <input
            id="habit-emoji"
            type="text"
            value={form.emoji}
            onChange={(event) => updateField('emoji', event.target.value)}
            placeholder="输入一个 emoji，如 🏃"
            maxLength={4}
            className="input-apple"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EMOJI_PRESETS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => updateField('emoji', em)}
                className={
                  'rounded-xl px-2 py-1 text-lg transition-all duration-200 ' +
                  (form.emoji === em
                    ? 'bg-primary/10 ring-2 ring-primary/40'
                    : 'bg-muted hover:bg-accent')
                }
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="habit-category" className="mb-1.5 block text-sm font-medium text-foreground">
            分类（可选）
          </label>
          <input
            id="habit-category"
            type="text"
            list="habit-category-list"
            value={form.category}
            onChange={(event) => updateField('category', event.target.value)}
            placeholder="如：健康、工作、学习"
            className="input-apple"
          />
          <datalist id="habit-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" className="btn-primary">
            {habit ? '保存修改' : '添加习惯'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
