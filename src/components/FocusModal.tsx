import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import type { Task } from '../types';
import { useFocusStore, getFocusRemainingMs, FOCUS_DURATION_MIN } from '../store/useFocusStore';
import { useToastStore } from '../store/useToastStore';
import { showSystemNotification } from '../utils/notificationHelper';
import Modal from './Modal';

const QUICK_DURATIONS = [15, 25, 45];

interface FocusModalProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onMarkDone: (task: Task) => void;
}

function formatClock(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return mm + ':' + ss;
}

export default function FocusModal({ open, task, onClose, onMarkDone }: FocusModalProps) {
  const focus = useFocusStore();
  const addToast = useToastStore((state) => state.addToast);
  const [nowMs, setNowMs] = useState(Date.now());
  const [duration, setDuration] = useState(FOCUS_DURATION_MIN);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [open]);

  const remainingMs = getFocusRemainingMs(focus, nowMs);
  const started = focus.deadline !== null;
  const running = started && focus.pausedAt === null && remainingMs > 0;
  const done = started && remainingMs <= 0;

  // 倒计时结束一次性触发：系统通知 + Toast（不自动停止，方便「标记完成」）
  useEffect(() => {
    if (done && !firedRef.current && focus.taskId !== null) {
      firedRef.current = true;
      showSystemNotification('专注完成', '「' + focus.taskTitle + '」的专注时段已结束');
      addToast('专注完成，休息一下吧');
    }
    if (!done) firedRef.current = false;
  }, [done, focus.taskId, focus.taskTitle, addToast]);

  if (!open) return null;

  const displayMs = started ? remainingMs : duration * 60 * 1000;

  const handleStart = () => {
    if (task === null) return;
    focus.start(task.id, task.title, duration);
    addToast('开始专注 ' + duration + ' 分钟');
  };

  const handleClose = () => {
    if (done || !started) {
      focus.stop(); // 已完成或从未开始：清理会话
    }
    onClose();
  };

  const handleMarkDone = () => {
    if (task === null) return;
    focus.stop();
    onMarkDone(task);
  };

  return (
    <Modal open={open} onClose={handleClose} title="专注计时" panelClassName="rounded-3xl bg-popover p-6 shadow-apple-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Timer className="h-5 w-5" />
          </span>
          专注计时
        </h2>
        <button type="button" onClick={handleClose} aria-label="关闭" className="btn-ghost">
          <X className="h-5 w-5" />
        </button>
      </div>

      {task !== null && (
        <p className="truncate text-sm text-muted-foreground">
          {done ? '已完成' : running ? '正在专注' : focus.pausedAt !== null ? '已暂停' : '即将开始'}：
          <span className="font-semibold text-foreground">「{task.title}」</span>
        </p>
      )}

      <div
        className={
          'mt-6 text-center font-mono text-6xl font-bold tracking-tight tabular-nums ' +
          (done ? 'text-emerald-500' : 'text-foreground')
        }
      >
        {formatClock(displayMs)}
      </div>

      <div className="mt-6 space-y-3">
        {!started && (
          <>
            <div className="flex justify-center gap-2">
              {QUICK_DURATIONS.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setDuration(min)}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition duration-200 ' +
                    (duration === min
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent')
                  }
                >
                  {min} 分钟
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleStart}
              disabled={task === null}
              className="btn-primary w-full py-2.5"
            >
              <Play className="h-4 w-4" />
              开始专注
            </button>
          </>
        )}

        {started && !done && (
          <div className="flex justify-center gap-2">
            {running ? (
              <button
                type="button"
                onClick={focus.pause}
                className="btn-primary px-6 py-2.5"
              >
                <Pause className="h-4 w-4" />
                暂停
              </button>
            ) : (
              <button
                type="button"
                onClick={focus.resume}
                className="btn-primary px-6 py-2.5"
              >
                <Play className="h-4 w-4" />
                继续
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary px-6 py-2.5"
            >
              <RotateCcw className="h-4 w-4" />
              结束
            </button>
          </div>
        )}

        {done && (
          <div className="space-y-2">
            <p className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              专注完成！
            </p>
            <button
              type="button"
              onClick={handleMarkDone}
              disabled={task === null}
              className="btn-primary w-full py-2.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              标记任务完成
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary w-full py-2.5"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
