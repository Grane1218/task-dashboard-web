import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { isNotificationSupported, requestNotificationPermission } from '../utils/notificationHelper';

export default function PermissionBanner() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [dismissed, setDismissed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isNotificationSupported()) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
  }, []);

  if (!supported || permission === 'granted' || dismissed) return null;

  const handleAllow = async () => {
    if (requesting) return;
    setRequesting(true);
    setStatus(null);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result === 'granted') {
        setStatus('已开启通知权限，将按时提醒你。');
      } else if (result === 'denied') {
        setStatus('你已拒绝通知权限。如需开启，请点击地址栏左侧标识，在「网站设置」中允许通知。');
      } else {
        setStatus('未获得授权：若浏览器弹出了询问框，请点其中的「允许」；若没有出现，请检查浏览器通知设置。');
      }
    } catch (error) {
      setPermission('default');
      setStatus('获取通知权限时出错：' + String(error));
    } finally {
      setRequesting(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <div className="relative z-20 border-b border-primary/15 bg-primary/[0.06]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
        <BellRing className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <span className="text-foreground">
            {permission === 'denied'
              ? '通知权限已被拒绝，请在浏览器设置中允许通知，以接收未完成任务提醒。'
              : '开启桌面通知，及时接收未完成任务提醒。'}
          </span>
          {status !== null && (
            <div className="mt-0.5 text-xs font-medium text-primary">{status}</div>
          )}
        </div>
        {permission !== 'denied' && (
          <button
            type="button"
            onClick={handleAllow}
            disabled={requesting}
            className="ml-2 shrink-0 cursor-pointer rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground transition duration-200 hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
          >
            {requesting ? '请求中…' : '允许'}
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="关闭提示"
          className="ml-auto shrink-0 cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
