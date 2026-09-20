import { useRef, useState, type ChangeEvent } from 'react';
import { BarChart3, Bell, CalendarDays, CheckSquare, CloudOff, Cloudy, Download, ListChecks, Moon, Plus, Sun, Upload } from 'lucide-react';
import type { View } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useHabitStore } from '../store/useHabitStore';
import { useToastStore } from '../store/useToastStore';
import { exportDataToFile, importDataFromText, type ImportMode } from '../utils/backup';
import { isCloudConfigured, buildTaskOrder } from '../lib/cloud';
import { completionKey, enqueueMany, flushOutbox, SETTINGS_KEY, TASK_ORDER_KEY, taskKey, templateKey, type OutboxOp } from '../lib/syncQueue';
import ImportModal from './ImportModal';

interface HeaderProps {
  view: View;
  onSwitchView: (view: View) => void;
  onOpenSettings: () => void;
  onOpenCloud: () => void;
  /** 待同步条目数（>0 时云图标显示提示点） */
  pendingSync: number;
  onCreate: () => void;
}

const TABS: Array<{ key: View; label: string }> = [
  { key: 'board', label: '任务看板' },
  { key: 'habits', label: '每日习惯' },
  { key: 'calendar', label: '日历' },
  { key: 'stats', label: '统计' },
];

export default function Header({ view, onSwitchView, onOpenSettings, onOpenCloud, pendingSync, onCreate }: HeaderProps) {
  const theme = useTaskStore((state) => state.theme);
  const setTheme = useTaskStore((state) => state.setTheme);
  const addToast = useToastStore((state) => state.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);
  const isDark = theme === 'dark';
  const isBoard = view === 'board';
  const isStats = view === 'stats';
  const isCalendar = view === 'calendar';
  const title = isBoard ? '任务看板' : isStats ? '统计' : isCalendar ? '日历' : '每日习惯';

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setPendingImportText(text); // 先弹出导入方式选择
    };
    reader.onerror = () => addToast('读取文件失败', 'error');
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleImport = async (mode: ImportMode) => {
    const text = pendingImportText;
    setPendingImportText(null);
    if (text === null) return;
    const result = importDataFromText(text, mode);
    if (!result.ok) {
      addToast(result.error ?? '导入失败', 'error');
      return;
    }
    const s = result.stats;
    if (mode === 'overwrite') {
      addToast('覆盖导入完成：已替换 ' + (s?.tasksAdded ?? 0) + ' 个任务、' + (s?.habitsAdded ?? 0) + ' 个习惯');
    } else {
      const parts: string[] = [];
      if (s) {
        if (s.tasksAdded > 0) parts.push('新增 ' + s.tasksAdded + ' 个任务');
        if (s.habitsAdded > 0) parts.push('新增 ' + s.habitsAdded + ' 个习惯');
        if (s.tasksSkipped + s.habitsSkipped > 0) {
          parts.push('跳过 ' + (s.tasksSkipped + s.habitsSkipped) + ' 条已存在');
        }
        if (s.completionsMerged > 0) parts.push('合并 ' + s.completionsMerged + ' 天打卡记录');
      }
      addToast(parts.length > 0 ? '导入完成：' + parts.join('，') + '（原有数据保留）' : '导入完成：没有新增数据');
    }
    // 导入直接改写了 store：把全量数据入队补推云端（幂等，可重跑；离线时排队等联网）
    if (isCloudConfigured()) {
      const taskState = useTaskStore.getState();
      const habitState = useHabitStore.getState();
      enqueueMany([
        ...taskState.tasks.map((task): OutboxOp => ({ type: 'task-upsert', key: taskKey(task.id), task })),
        ...habitState.templates.map(
          (template): OutboxOp => ({ type: 'template-upsert', key: templateKey(template.id), template }),
        ),
        ...Object.entries(habitState.completions).map(
          ([date, ids]): OutboxOp => ({ type: 'completion-set', key: completionKey(date), date, templateIds: ids }),
        ),
        { type: 'task-order', key: TASK_ORDER_KEY, order: buildTaskOrder(taskState.tasks) },
        {
          type: 'settings-set',
          key: SETTINGS_KEY,
          settings: {
            taskReminder: taskState.reminderSettings,
            habitReminder: habitState.reminderSettings,
            theme: taskState.theme,
          },
        },
      ]);
      const result = await flushOutbox(true);
      if (!result.ok) addToast('导入已生效，云端同步已排队（联网后自动补同步）', 'error');
    }
  };

  return (
    <header className="glass sticky top-0 z-30 border-b border-border/60 bg-background/70">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {isBoard ? (
              <CheckSquare className="h-5 w-5" />
            ) : isStats ? (
              <BarChart3 className="h-5 w-5" />
            ) : isCalendar ? (
              <CalendarDays className="h-5 w-5" />
            ) : (
              <ListChecks className="h-5 w-5" />
            )}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        </div>

        {/* iOS 分段控件式页签 */}
        <nav className="flex items-center gap-1 rounded-full bg-muted/80 p-1" aria-label="视图切换">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSwitchView(tab.key)}
              aria-current={view === tab.key ? 'page' : undefined}
              className={
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ' +
                (view === tab.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCloud}
            aria-label="云端连接与空间密钥"
            title={
              !isCloudConfigured()
                ? '云端未配置（纯本地模式）'
                : pendingSync > 0
                  ? '云端已连接，' + pendingSync + ' 项待同步'
                  : '云端连接与空间密钥'
            }
            className="btn-ghost relative"
          >
            {isCloudConfigured() ? <Cloudy className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
            {pendingSync > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            )}
          </button>

          <button type="button" onClick={exportDataToFile} aria-label="导出数据备份" title="导出数据备份（JSON）" className="btn-ghost">
            <Download className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="导入数据备份"
            title="导入数据备份（JSON）"
            className="btn-ghost"
          >
            <Upload className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />

          <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
            className="btn-ghost"
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {!isStats && (
            <button type="button" onClick={onOpenSettings} aria-label="提醒设置" className="btn-ghost">
              <Bell className="h-5 w-5" />
            </button>
          )}

          {!isStats && (
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-apple transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{isBoard || isCalendar ? '新建任务' : '添加习惯'}</span>
            </button>
          )}
        </div>
      </div>
      <ImportModal
        open={pendingImportText !== null}
        onClose={() => setPendingImportText(null)}
        onImport={handleImport}
      />
    </header>
  );
}