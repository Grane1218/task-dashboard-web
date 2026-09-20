import { useMemo } from 'react';
import { BarChart3, CalendarCheck2, CheckCircle2, Clock, Flame, ListChecks, Loader } from 'lucide-react';
import { useTaskStore } from '../store/useTaskStore';
import { useHabitStore } from '../store/useHabitStore';
import { calcStreak, formatDateKey, todayKey } from '../utils/habit';
import { getHabitHeatmap, getHabitWeekRate, getStatusCounts, getTaskCompletionByDay } from '../utils/stats';

const HEATMAP_WEEKS = 12; // 最近 12 周（84 天）

const LEVEL_CLASSES = [
  'bg-gray-200 dark:bg-gray-800',
  'bg-blue-200 dark:bg-blue-950',
  'bg-blue-300 dark:bg-blue-800',
  'bg-blue-500 dark:bg-blue-600',
  'bg-blue-600 dark:bg-blue-500',
];

function heatLevel(completed: number, total: number): number {
  if (total === 0 || completed === 0) return 0;
  const ratio = completed / total;
  if (ratio >= 1) return 4;
  if (ratio > 2 / 3) return 3;
  if (ratio > 1 / 3) return 2;
  return 1;
}

export default function StatsView() {
  const tasks = useTaskStore((state) => state.tasks);
  const templates = useHabitStore((state) => state.templates);
  const completions = useHabitStore((state) => state.completions);

  const activeTasks = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);
  const statusCounts = useMemo(() => getStatusCounts(activeTasks), [activeTasks]);
  const donePct = statusCounts.total === 0 ? 0 : Math.round((statusCounts.done / statusCounts.total) * 100);
  const trend = useMemo(() => getTaskCompletionByDay(activeTasks, 7), [activeTasks]);
  const maxTrend = Math.max(1, ...trend.map((d) => d.count));

  const activeTemplates = useMemo(() => templates.filter((t) => !t.archived), [templates]);
  const heatmap = useMemo(() => getHabitHeatmap(templates, completions, HEATMAP_WEEKS), [templates, completions]);
  const streak = useMemo(() => calcStreak(activeTemplates, completions), [activeTemplates, completions]);
  const weekRate = useMemo(() => getHabitWeekRate(templates, completions), [templates, completions]);
  const today = todayKey();

  return (
    <div className="space-y-4">
      {/* 任务统计 */}
      <section className="surface p-5 shadow-apple">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          任务统计
        </h2>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip icon={<Clock className="h-4 w-4" />} label="待处理" value={statusCounts.todo} tone="text-blue-600 dark:text-blue-400" />
          <StatChip icon={<Loader className="h-4 w-4" />} label="进行中" value={statusCounts['in-progress']} tone="text-amber-600 dark:text-amber-400" />
          <StatChip icon={<CheckCircle2 className="h-4 w-4" />} label="已完成" value={statusCounts.done} tone="text-emerald-600 dark:text-emerald-400" />
          <StatChip icon={<CalendarCheck2 className="h-4 w-4" />} label="完成率" value={donePct + '%'} tone="text-primary" />
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">近 7 天完成任务数</h3>
            <span className="text-xs text-muted-foreground/70">按任务实际完成时间统计</span>
          </div>
          {activeTasks.length === 0 ? (
            <p className="mt-3 rounded-xl bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">还没有任务数据</p>
          ) : (
            <div className="mt-3 flex h-28 items-end gap-1.5">
              {trend.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={d.date + '：完成 ' + d.count + ' 项'}>
                  <span className={'text-[10px] font-semibold tabular-nums ' + (d.count > 0 ? 'text-foreground' : 'text-transparent')}>{d.count}</span>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-primary/70 to-primary"
                    style={{ height: Math.max(4, Math.round((d.count / maxTrend) * 72)) + 'px' }}
                  />
                  <span className="text-[10px] text-muted-foreground/70">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 习惯统计 */}
      <section className="surface p-5 shadow-apple">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="h-4 w-4" />
          </span>
          习惯统计
        </h2>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatChip icon={<Flame className="h-4 w-4" />} label="连续完成" value={streak + ' 天'} tone="text-amber-600 dark:text-amber-400" />
          <StatChip icon={<ListChecks className="h-4 w-4" />} label="进行中习惯" value={activeTemplates.length} tone="text-primary" />
          <StatChip
            icon={<CalendarCheck2 className="h-4 w-4" />}
            label="本周完成率"
            value={activeTemplates.length === 0 ? '—' : weekRate.percent + '%'}
            tone="text-emerald-600 dark:text-emerald-400"
          />
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">最近 12 周完成热力图</h3>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              少
              {LEVEL_CLASSES.map((cls, i) => (
                <span key={i} className={'h-3 w-3 rounded-[4px] ' + cls} />
              ))}
              多
            </div>
          </div>
          {activeTemplates.length === 0 ? (
            <p className="mt-3 rounded-xl bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">还没有习惯数据</p>
          ) : (
            <>
              <div className="mt-3 grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto pb-1">
                {heatmap.map((day) => (
                  <div
                    key={day.date}
                    title={formatDateKey(day.date) + '：完成 ' + day.completed + '/' + day.total}
                    className={'h-3 w-3 rounded-[4px] ' + LEVEL_CLASSES[heatLevel(day.completed, day.total)]}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground/70">
                共 {heatmap.length} 天（{formatDateKey(heatmap[0]?.date ?? '')} 至 {formatDateKey(today)}），颜色越深表示当日完成比例越高
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

interface StatChipProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: string;
}

function StatChip({ icon, label, value, tone }: StatChipProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
      <span className={'shrink-0 ' + tone}>{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight tracking-tight tabular-nums text-foreground">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
