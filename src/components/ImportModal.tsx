import { useState } from 'react';
import { Download, TriangleAlert, X } from 'lucide-react';
import type { ImportMode } from '../utils/backup';
import Modal from './Modal';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (mode: ImportMode) => void;
}

/**
 * 导入方式选择弹窗：合并导入（默认推荐，保留现有数据）或覆盖导入（危险操作，需二次确认）。
 */
export default function ImportModal({ open, onClose, onImport }: ImportModalProps) {
  const [confirming, setConfirming] = useState(false);

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="导入备份" panelClassName="max-w-sm rounded-3xl bg-popover p-6 shadow-apple-lg">
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {confirming ? <TriangleAlert className="h-5 w-5 text-destructive" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight">{confirming ? '确认覆盖导入？' : '选择导入方式'}</h2>
          {confirming ? (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              现有任务与习惯将被备份文件中的内容整体替换，提醒设置与主题也会随备份改变，<span className="font-semibold text-destructive">此操作无法撤销</span>。建议先导出当前数据备份。
            </p>
          ) : (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              合并导入会保留你现有的任务与习惯；覆盖导入会用备份文件替换全部数据。
            </p>
          )}
        </div>
        <button type="button" onClick={handleClose} aria-label="关闭" className="btn-ghost">
          <X className="h-4 w-4" />
        </button>
      </div>

      {confirming ? (
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="btn-secondary">
            返回
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onImport('overwrite');
            }}
            className="btn-danger"
          >
            确认覆盖导入
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => onImport('merge')}
            className="btn-primary w-full"
          >
            合并导入（保留现有数据，仅追加新增项）
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 py-2.5 text-sm font-medium text-destructive transition duration-200 hover:bg-destructive/10 active:scale-[0.98]"
          >
            <TriangleAlert className="h-4 w-4" />
            覆盖导入（用备份替换全部数据）
          </button>
        </div>
      )}
    </Modal>
  );
}
