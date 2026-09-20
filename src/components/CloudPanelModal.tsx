import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import Modal from './Modal';
import { useToastStore } from '../store/useToastStore';
import {
  ensureCloud,
  getCloudEnvId,
  getCloudStatus,
  isCloudConfigured,
  resetCloudBackoff,
  type CloudStatus,
} from '../lib/cloud';
import { clearOutbox, flushOutbox } from '../lib/syncQueue';
import { getSpaceSecret, isSpaceIsolated, isUsingBuildHint, setSpaceSecret } from '../lib/space';

interface CloudPanelProps {
  open: boolean;
  onClose: () => void;
  pendingSync: number;
}

const STATUS_LABEL: Record<CloudStatus, string> = {
  unconfigured: '未配置（纯本地模式）',
  ready: '已连接',
  failed: '连接失败（离线可用，写入会排队）',
};

/**
 * 云端连接面板：展示连接状态、待同步数量，并管理「空间密钥」。
 *
 * 空间密钥不参与构建、不进入 bundle，只保存于本机 localStorage；
 * 同密钥的设备共享同一份云端数据，不同密钥互相看不到对方数据。
 */
export default function CloudPanelModal({ open, onClose, pendingSync }: CloudPanelProps) {
  const addToast = useToastStore((state) => state.addToast);
  const [status, setStatus] = useState<CloudStatus>(getCloudStatus());
  const [secret, setSecret] = useState(getSpaceSecret());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus(getCloudStatus());
      setSecret(getSpaceSecret());
    }
  }, [open]);

  if (!isCloudConfigured()) {
    return (
      <Modal open={open} onClose={onClose} title="云端连接">
        <div className="p-6">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <CloudOff className="h-4 w-4" /> 云端连接
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            当前为纯本地模式：数据仅保存在本机浏览器。如需多设备共享，请在项目根目录
            <code className="mx-1 rounded bg-muted px-1">.env</code>
            中配置 <code className="rounded bg-muted px-1">VITE_CLOUDBASE_ENV</code> 并重新构建。
          </p>
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              知道了
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const isolated = isSpaceIsolated();

  const handleSave = async () => {
    const next = secret.trim();
    if (next === getSpaceSecret()) {
      addToast('空间密钥未变化');
      return;
    }
    setBusy(true);
    // 切空间前尽量把旧空间的待同步内容推上去；队列本身必须清空，
    // 否则残留的旧空间操作会在重载后被误写进新空间（本地数据仍会整体迁移到新空间，不会丢）。
    const flushed = await flushOutbox(true);
    clearOutbox();
    setSpaceSecret(next);
    if (!flushed.ok) {
      addToast('旧空间尚有未上传的改动，已放弃上传；本地数据会整体迁移到新空间');
    }
    addToast(next === '' ? '已清除空间密钥，回到全局共享模式，正在重新加载…' : '空间密钥已保存，正在重新加载以切换空间…');
    // 切换空间需要重新 hydrate + 迁移本地数据，直接重载最稳妥（避免内存里混入两个空间的数据）
    window.setTimeout(() => window.location.reload(), 800);
  };

  const handleRetry = async () => {
    setBusy(true);
    resetCloudBackoff();
    await ensureCloud();
    setStatus(getCloudStatus());
    const result = await flushOutbox(true);
    setBusy(false);
    addToast(result.ok ? '云端连接正常，待同步内容已补推' : '仍然无法连接云端，内容已安全保存在本地队列', result.ok ? 'success' : 'error');
  };

  return (
    <Modal open={open} onClose={onClose} title="云端连接">
      <div className="space-y-5 p-6">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Cloud className="h-4 w-4" /> 云端连接
        </h2>

        <dl className="space-y-1.5 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">状态</dt>
            <dd className="font-medium">{STATUS_LABEL[status]}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">环境 ID</dt>
            <dd className="truncate font-mono text-xs">{getCloudEnvId()}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">待同步</dt>
            <dd className="font-medium tabular-nums">{pendingSync} 项</dd>
          </div>
        </dl>

        <div>
          <label htmlFor="cloud-space" className="flex items-center gap-1.5 text-sm font-semibold">
            {isolated ? (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            )}
            空间密钥
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="cloud-space"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="留空 = 全局共享（任何拿到 envId 的人都能读写）"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleSave}
              className="shrink-0 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"
            >
              保存
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            只保存在本机浏览器，不会进入构建产物。<strong className="text-foreground">不同设备填入同一密钥即可共享数据；不同密钥之间互相看不到对方的数据。</strong>
            修改后页面会重新加载，本地数据会迁移到新空间。
          </p>
          {isUsingBuildHint() && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              当前使用的是构建期 <code>VITE_CLOUDBASE_SPACE</code> 的值——它已被打进公开的 bundle，只能算「防误入」，不算秘密。建议改为在本机手动设置。
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">安全边界</p>
          <p className="mt-1">
            空间密钥提供的是「应用层逻辑隔离」，不是授权。envId 与空间标签最终都会出现在前端请求里，
            绕过本应用直接调用 CloudBase SDK 仍可能读到集合内的数据。真正的访问控制需要在
            云开发控制台为集合配置安全规则（见 README「云端安全」）。
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm font-medium">
            关闭
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <RefreshCw className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
            测试连接并同步
          </button>
        </div>
      </div>
    </Modal>
  );
}
