import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 最后一个浏览器页面关闭后，自动停止开发服务器（关掉页面即停止项目）
function autoShutdownPlugin(): Plugin {
  let openTabs = 0;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelShutdown = () => {
    if (shutdownTimer !== null) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  };

  const armShutdown = () => {
    openTabs = Math.max(0, openTabs - 1);
    if (openTabs > 0) return;
    cancelShutdown();
    shutdownTimer = setTimeout(() => {
      console.log('[auto-shutdown] 所有页面已关闭，停止开发服务器。');
      process.exit(0);
    }, 5000);
  };

  return {
    name: 'auto-shutdown-on-page-close',
    configureServer(server) {
      server.middlewares.use('/__hello', (_req, res) => {
        openTabs += 1;
        cancelShutdown();
        res.statusCode = 200;
        res.end('ok');
      });
      server.middlewares.use('/__bye', (_req, res) => {
        res.statusCode = 200;
        res.end('ok');
        setTimeout(armShutdown, 10);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), autoShutdownPlugin()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    // 首屏包只保留应用代码与 React；CloudBase SDK（约 730KB）通过动态 import 单独成块，
    // 只有配置了云端并真正发起同步时才加载，因此这里的阈值按「懒加载大块」放宽。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@cloudbase')) return 'vendor-cloudbase';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('zustand')) return 'vendor-state';
          return 'vendor';
        },
      },
    },
  },
});