import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Task } from '../types';
import {
  countAlwaysVisibleTasks,
  countTasksOnDate,
  countVisibleTasksOnDate,
  dayOfMonth,
  formatScopeLabel,
  scopeDateKey,
  shiftDateKey,
  todayKeyOf,
  weekKeysOf,
  weekdayLabel,
  type DateScope,
} from '../utils/dateScope';

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

interface DateScopeBarProps {
  scope: DateScope;
  onChange: (scope: DateScope) => void;
  /** 全部任务（含已归档）；组件内部只统计未归档的 */
  tasks: Task[];
  /** 在指定日期新建任务（复用 App 的任务弹窗日期预填） */
  onCreateOnDate: (dateKey: string) => void;
}

const PILL_ACTIVE = 'bg-primary text-primary-foreground shadow-sm';
const PILL_IDLE = 'text-muted-foreground hover:bg-accent hover:text-foreground';

function monthOf(key: string): { year: number; month: number } {
  const parts = key.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year, month };
}

/**
 * 看板「日期视图」切换条：全部 / 今天 / 前后一天 / 本周 7 天 / 月历弹层。
 *
 * 只负责产生 `DateScope`，不做任何任务数据写入；实际过滤在 BoardView 里完成。
 * 每分钟刷新一次 now：跨天后「今天」高亮与 followToday 会自动跟随，无需刷新页面。
 */
export default function DateScopeBar({ scope, onChange, tasks, onCreateOnDate }: DateScopeBarProps) {
  const [now, setNow] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!calendarOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (popoverRef.current !== null && !popoverRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [calendarOpen]);

  const today = todayKeyOf(now);
  const selectedKey = scopeDateKey(scope, now);
  const dayMode = selectedKey !== null;
  // 「全部」模式下以今天为基准：点箭头即从今天开始按天浏览
  const cursorKey = selectedKey ?? today;

  const activeTasks = useMemo(() => tasks.filter((task) => !task.archived), [tasks]);
  const weekKeys = useMemo(() => weekKeysOf(cursorKey), [cursorKey]);
  const dayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const key of weekKeys) map[key] = countTasksOnDate(activeTasks, key);
    return map;
  }, [weekKeys, activeTasks]);

  /** 选择某一天：选到今天就开启「跨天跟随」，否则固定在该日期 */
  const selectDay = (key: string) => {
    onChange({ mode: 'day', date: key, followToday: key === today });
  };

  const alwaysVisibleCount = dayMode ? countAlwaysVisibleTasks(activeTasks) : 0;
  const summary = dayMode
    ? formatScopeLabel(selectedKey, now) +
      ' · 当天 ' +
      countTasksOnDate(activeTasks, selectedKey) +
      ' 项，共显示 ' +
      countVisibleTasksOnDate(activeTasks, selectedKey) +
      ' 项' +
      (alwaysVisibleCount > 0 ? '（其中 ' + alwaysVisibleCount + ' 项未设完整日期，始终显示）' : '')
    : '全部任务 · 看板共 ' + activeTasks.length + ' 项';

  return (
    <section className="surface flex flex-col gap-2 p-3" aria-label="看板日期视图">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 hidden items-center gap-1.5 text-sm font-semibold text-foreground sm:flex">
          <CalendarDays className="h-4 w-4 text-primary" />
          日期视图
        </span>

        <div className="flex items-center gap-0.5 rounded-full bg-muted/80 p-0.5">
          <button
            type="button"
            onClick={() => onChange({ mode: 'all', date: scope.date, followToday: false })}
            aria-pressed={!dayMode}
            className={'rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ' + (!dayMode ? PILL_ACTIVE : PILL_IDLE)}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => selectDay(today)}
            aria-pressed={dayMode && selectedKey === today}
            className={'rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ' + (dayMode && selectedKey === today ? PILL_ACTIVE : PILL_IDLE)}
          >
            今天
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => selectDay(shiftDateKey(cursorKey, -1))}
            aria-label="前一天"
            title="前一天"
            className="btn-ghost"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => selectDay(shiftDateKey(cursorKey, 1))}
            aria-label="后一天"
            title="后一天"
            className="btn-ghost"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* 本周 7 天快捷（周一为起点） */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5" role="group" aria-label="本周日期">
          {weekKeys.map((key) => {
            const selected = dayMode && key === selectedKey;
            const isToday = key === today;
            const count = dayCounts[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectDay(key)}
                aria-pressed={selected}
                aria-current={isToday ? 'date' : undefined}
                title={formatScopeLabel(key, now) + ' · ' + count + ' 个任务'}
                className={
                  'relative flex min-w-[3.1rem] shrink-0 flex-col items-center rounded-xl px-1.5 py-1 leading-tight transition-colors ' +
                  (selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isToday
                      ? 'bg-muted font-semibold text-foreground hover:bg-accent'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground')
                }
              >
                <span className="text-[10px] opacity-80">{weekdayLabel(key)}</span>
                <span className="text-sm font-semibold tabular-nums">{dayOfMonth(key)}</span>
                <span
                  className={
                    'mt-0.5 h-1 w-1 rounded-full ' +
                    (count > 0 ? (selected ? 'bg-primary-foreground/80' : 'bg-primary/60') : 'bg-transparent')
                  }
                  aria-hidden="true"
                />
                {count > 0 && (
                  <span
                    className={
                      'absolute right-0.5 top-0.5 rounded-full px-1 text-[9px] font-bold tabular-nums ' +
                      (selected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary')
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 月历弹层 */}
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setCalendarOpen((open) => !open)}
            aria-label="打开月历选择日期"
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            title="按月选择日期"
            className={
              'btn-ghost ' + (calendarOpen ? 'bg-accent text-foreground' : '')
            }
          >
            <CalendarDays className="h-4 w-4" />
          </button>
          {calendarOpen && (
            <MiniCalendar
              value={cursorKey}
              today={today}
              now={now}
              onSelect={(key) => {
                selectDay(key);
                setCalendarOpen(false);
              }}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => onCreateOnDate(cursorKey)}
          title={'在 ' + formatScopeLabel(cursorKey, now) + ' 新建任务'}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-all duration-200 hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新建当天任务</span>
          <span className="sm:hidden">新建</span>
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{summary}</p>
    </section>
  );
}

interface MiniCalendarProps {
  value: string;
  today: string;
  now: Date;
  onSelect: (dateKey: string) => void;
}

/** 轻量月历弹层（不套用全屏 Modal）：周一为起点、可翻月、可一键回今天 */
function MiniCalendar({ value, today, now, onSelect }: MiniCalendarProps) {
  const [cursor, setCursor] = useState(() => monthOf(value));

  // 每次打开（或外部选中日期变化）时，把月份对齐到选中日期
  useEffect(() => {
    setCursor(monthOf(value));
  }, [value]);

  const cells = useMemo(() => {
    const firstDay = new Date(cursor.year, cursor.month, 1);
    const offset = (firstDay.getDay() + 6) % 7; // 周一起点
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const list: Array<Date | null> = [
      ...(Array.from({ length: offset }, () => null) as Array<Date | null>),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.year, cursor.month, i + 1)),
    ];
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [cursor]);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const keyOf = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  const moveMonth = (delta: number) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div
      role="dialog"
      aria-label="选择日期"
      className="absolute right-0 top-full z-40 mt-2 w-[17rem] animate-modal-in rounded-2xl border border-border/60 bg-popover p-3 shadow-apple-lg"
    >
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => moveMonth(-1)} aria-label="上个月" className="btn-ghost">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold tabular-nums">
          {cursor.year} 年 {cursor.month + 1} 月
        </span>
        <button type="button" onClick={() => moveMonth(1)} aria-label="下个月" className="btn-ghost">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
        {WEEKDAY_HEADERS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={'empty-' + index} />;
          const key = keyOf(day);
          const selected = key === value;
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={selected}
              aria-current={isToday ? 'date' : undefined}
              title={formatScopeLabel(key, now)}
              className={
                'flex h-8 items-center justify-center rounded-lg text-xs tabular-nums transition-colors ' +
                (selected
                  ? 'bg-primary font-bold text-primary-foreground shadow-sm'
                  : isToday
                    ? 'bg-muted font-semibold text-foreground ring-1 ring-primary/40 hover:bg-accent'
                    : 'text-foreground hover:bg-accent')
              }
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{formatScopeLabel(value, now)}</span>
        <button
          type="button"
          onClick={() => onSelect(today)}
          className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-accent"
        >
          今天
        </button>
      </div>
    </div>
  );
}
