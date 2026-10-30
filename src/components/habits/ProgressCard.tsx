import { Flame, ListChecks } from 'lucide-react';

interface ProgressCardProps {
  total: number;
  completed: number;
  streak: number;
  /** 标题，默认「今日进度」；补记历史日期时传入日期文案 */
  title?: string;
}

export default function ProgressCard({ total, completed, streak, title = '今日进度' }: ProgressCardProps) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section className="surface p-5 shadow-apple">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground">
              {title} <span className="tabular-nums">{completed}/{total}</span>
            </div>
            <div className="text-[13px] text-muted-foreground">{pct}% 已完成</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-3.5 py-1.5 text-amber-600 dark:text-amber-400">
          <Flame className="h-4 w-4" />
          <span className="text-sm font-semibold tabular-nums">{streak} 天连续</span>
        </div>
      </div>

      <div
        className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${title} ${completed}/${total}`}
      >
        <div
          className={
            'h-full w-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none ' +
            (pct === 100 ? 'bg-emerald-500' : 'bg-primary')
          }
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>

      {total > 0 && pct === 100 && (
        <p className="mt-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">🎉 今日习惯已全部完成！</p>
      )}
      {total === 0 && (
        <p className="mt-2.5 text-sm text-muted-foreground">还没有习惯，点击右上角「添加习惯」开始。</p>
      )}
    </section>
  );
}
