import { useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, Inbox, RotateCcw, Trash2 } from 'lucide-react';
import type { Task, TaskStatus } from '../types';
import { REPEAT_LABELS, STATUS_LABELS } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { filterTasks, type TaskFilters } from '../utils/filter';
import { matchesSelectedDate } from '../utils/dateScope';
import TaskCard from './TaskCard';

const COLUMNS: TaskStatus[] = ['todo', 'in-progress', 'done'];

const COLUMN_ACCENTS: Record<TaskStatus, string> = {
  todo: 'bg-blue-500',
  'in-progress': 'bg-amber-500',
  done: 'bg-emerald-500',
};

interface BoardViewProps {
  tasks: Task[];
  filters: TaskFilters;
  /** 日期视图选中的日期；null = 「全部」模式（不按日期过滤，行为与改造前一致） */
  dateKey: string | null;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onFocus: (task: Task) => void;
  onClearFilters: () => void;
  onClearDateScope: () => void;
}

interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  filtering: boolean;
  dateScoped: boolean;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onFocus: (task: Task) => void;
  onClearFilters: () => void;
  onClearDateScope: () => void;
}

interface SortableCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onFocus: (task: Task) => void;
}

function groupIds(tasks: Task[]): Record<TaskStatus, string[]> {
  const result: Record<TaskStatus, string[]> = { todo: [], 'in-progress': [], done: [] };
  for (const task of tasks) result[task.status].push(task.id);
  return result;
}

function findContainer(id: string, items: Record<TaskStatus, string[]>): TaskStatus | null {
  if (COLUMNS.includes(id as TaskStatus)) return id as TaskStatus;
  for (const status of COLUMNS) if (items[status].includes(id)) return status;
  return null;
}

// 将新的可见（过滤后）顺序映射回全量顺序：被隐藏的任务保持原位，可见任务按新顺序排列
function remapVisibleOrder(full: string[], movedVisible: string[]): string[] {
  const visibleSet = new Set(movedVisible);
  const result: string[] = [];
  let pointer = 0;
  for (const id of full) {
    if (visibleSet.has(id)) {
      result.push(movedVisible[pointer] ?? id);
      pointer += 1;
    } else {
      result.push(id);
    }
  }
  return result;
}

export default function BoardView({
  tasks,
  filters,
  dateKey,
  onEdit,
  onDelete,
  onFocus,
  onClearFilters,
  onClearDateScope,
}: BoardViewProps) {
  const applyOrder = useTaskStore((state) => state.applyOrder);
  const unarchiveTask = useTaskStore((state) => state.unarchiveTask);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const activeTasks = useMemo(() => tasks.filter((task) => !task.archived), [tasks]);
  const archivedTasks = useMemo(() => tasks.filter((task) => task.archived), [tasks]);
  // 日期视图是第一道过滤（纯显示层）：之后仍走原有 search/priority/status 过滤，语义不变
  const scopedTasks = useMemo(
    () => (dateKey === null ? activeTasks : activeTasks.filter((task) => matchesSelectedDate(task, dateKey))),
    [activeTasks, dateKey],
  );
  const visibleTasks = useMemo(() => filterTasks(scopedTasks, filters), [scopedTasks, filters]);
  const filtering = filters.search.trim() !== '' || filters.priority !== 'all' || filters.status !== 'all';
  const dateScoped = dateKey !== null;

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeTaskId = String(active.id);
    const overId = String(over.id);
    // fullItems 始终取「未归档全量」：日期/关键词过滤只是显示层，
    // 拖拽仍写入全局顺序，被隐藏的任务由 remapVisibleOrder 保持原位（见下方同列分支）。
    const fullItems = groupIds(activeTasks);
    const visibleItems = groupIds(visibleTasks);
    const activeContainer = findContainer(activeTaskId, fullItems);
    const overContainer = findContainer(overId, fullItems);
    if (!activeContainer || !overContainer) return;

    const next: Record<TaskStatus, string[]> = { ...fullItems };

    if (activeContainer === overContainer) {
      const container = activeContainer;
      // 同列排序：以「可见（过滤后）」序列计算插入位置，再映射回全量，
      // 被筛选隐藏的任务保持原位，避免筛选状态下排序错位。
      const visible = visibleItems[container];
      const oldIndex = visible.indexOf(activeTaskId);
      if (oldIndex < 0) return;
      const newIndex = overId === container ? visible.length - 1 : visible.indexOf(overId);
      if (newIndex < 0 || oldIndex === newIndex) return;
      next[container] = remapVisibleOrder(fullItems[container], arrayMove(visible, oldIndex, newIndex));
    } else {
      const activeIds = [...fullItems[activeContainer]];
      const overIds = [...fullItems[overContainer]];
      const activeIndex = activeIds.indexOf(activeTaskId);
      activeIds.splice(activeIndex, 1);
      const overIndex = overIds.indexOf(overId);
      const insertIndex = overIndex >= 0 ? overIndex : overIds.length;
      overIds.splice(insertIndex, 0, activeTaskId);
      next[activeContainer] = activeIds;
      next[overContainer] = overIds;
    }

    applyOrder(next);
  };

  const activeTask = activeId === null ? null : activeTasks.find((task) => task.id === activeId) ?? null;

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={visibleTasks.filter((task) => task.status === status)}
              filtering={filtering}
              dateScoped={dateScoped}
              onEdit={onEdit}
              onDelete={onDelete}
              onFocus={onFocus}
              onClearFilters={onClearFilters}
              onClearDateScope={onClearDateScope}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask !== null ? (
            <TaskCard task={activeTask} onEdit={onEdit} onDelete={onDelete} onFocus={onFocus} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* 已归档：恢复或永久删除（删除走 App 的 5 秒撤销确认） */}
      {archivedTasks.length > 0 && (
        <section className="surface p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Archive className="h-4 w-4" />
            已归档（{archivedTasks.length}）
          </h3>
          <div className="mt-2 space-y-2">
            {archivedTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">{task.title}</span>
                {task.repeat !== undefined && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {REPEAT_LABELS[task.repeat]}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => unarchiveTask(task.id)}
                  aria-label="恢复任务"
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  aria-label="永久删除任务"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Column({ status, tasks, filtering, dateScoped, onEdit, onDelete, onFocus, onClearFilters, onClearDateScope }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const ids = tasks.map((task) => task.id);

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted/40">
      <header className="flex items-center gap-2.5 px-4 py-3.5">
        <span className={'h-2.5 w-2.5 rounded-full ' + COLUMN_ACCENTS[status]} />
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{STATUS_LABELS[status]}</h2>
        <span className="ml-auto rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-muted-foreground shadow-sm">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={
          'flex min-h-[140px] flex-1 flex-col gap-3 p-3 transition-colors ' +
          (isOver ? 'bg-accent/60' : '')
        }
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} onEdit={onEdit} onDelete={onDelete} onFocus={onFocus} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-50" />
            {filtering ? (
              <>
                <span className="text-sm">没有匹配的任务</span>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="mt-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  清除筛选
                </button>
              </>
            ) : dateScoped ? (
              <>
                <span className="text-sm">这一天没有任务</span>
                <button
                  type="button"
                  onClick={onClearDateScope}
                  className="mt-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  显示全部任务
                </button>
              </>
            ) : (
              <span className="text-sm">暂无任务</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SortableCard({ task, onEdit, onDelete, onFocus }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : undefined}>
      <TaskCard task={task} onEdit={onEdit} onDelete={onDelete} onFocus={onFocus} />
    </div>
  );
}