import { FilterX, Search } from 'lucide-react';
import type { Priority, TaskStatus } from '../types';
import { PRIORITY_LABELS, STATUS_LABELS } from '../types';
import { DEFAULT_FILTERS, type TaskFilters } from '../utils/filter';

interface FilterBarProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const hasActiveFilters =
    filters.search !== '' || filters.priority !== 'all' || filters.status !== 'all';

  return (
    <section className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Apple 风格搜索框：圆角胶囊、柔和底色 */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="task-search"
          type="text"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          placeholder="搜索任务..."
          className="w-full rounded-full border-0 bg-muted/70 py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition duration-200 placeholder:text-muted-foreground focus:bg-card focus:ring-4 focus:ring-primary/15"
        />
      </div>

      <select
        value={filters.priority}
        onChange={(event) => onChange({ ...filters, priority: event.target.value as Priority | 'all' })}
        className="rounded-full border border-border/70 bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition duration-200 focus:border-primary/45 focus:ring-4 focus:ring-primary/15"
      >
        <option value="all">全部优先级</option>
        {(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITY_LABELS[priority]}优先级
          </option>
        ))}
      </select>

      <select
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value as TaskStatus | 'all' })}
        className="rounded-full border border-border/70 bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition duration-200 focus:border-primary/45 focus:ring-4 focus:ring-primary/15"
      >
        <option value="all">全部状态</option>
        {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-2.5 text-sm text-foreground transition duration-200 hover:bg-accent"
        >
          <FilterX className="h-4 w-4" />
          清除筛选
        </button>
      )}
    </section>
  );
}
