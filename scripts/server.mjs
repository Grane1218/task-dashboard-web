/**
 * 任务看板 · 生产静态服务器（零依赖，Node 18+）
 *
 * 用法：
 *   node scripts/server.mjs [--port 4173] [--host 127.0.0.1]
 *
 * 特性：
 *   - 托管 dist/（需先运行 npm run build）
 *   - SPA 回退：无扩展名的路径统一返回 index.html
 *   - /health 健康检查（供启动脚本做就绪探测）
 *   - 缓存策略：index.html 不缓存；/assets/ 哈希资源永久缓存
 *   - 兼容开发探针 /__hello、/__bye（静默返回 204，不污染日志语义）
 *   - 优雅退出（SIGINT/SIGTERM），端口占用时给出友好报错
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** 解析命令行参数（--port/-p、--host），并支持 PORT/HOST 环境变量 */
function parseArgs(argv) {
  let port = Number(process.env.PORT) || 4173;
  let host = process.env.HOST || '127.0.0.1';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0 && next < 65536) port = next;
      i += 1;
    } else if (argv[i] === '--host') {
      if (typeof argv[i + 1] === 'string' && argv[i + 1] !== '') host = argv[i + 1];
      i += 1;
    }
  }
  return { port, host };
}

const { port, host } = parseArgs(process.argv.slice(2));

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function isRegularFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function handler(req, res) {
  const started = Date.now();
  let status = 200;
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    // 健康检查：启动脚本就绪探测用
    if (pathname === '/health') {
      send(res, 200, JSON.stringify({ status: 'ok', pid: process.pid, uptime: Math.round(process.uptime()) }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }

    // 开发探针（开发服务器自动关停机制）：生产环境静默响应，避免报错
    if (pathname === '/__hello' || pathname === '/__bye') {
      send(res, 204, null);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      status = 405;
      send(res, status, 'Method Not Allowed');
      return;
    }

    // 路径规整 + 防目录穿越
    const rel = normalize(pathname).replace(/^[\\/]+/, '');
    const filePath = resolve(ROOT, rel);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      status = 403;
      send(res, status, 'Forbidden');
      return;
    }

    if (await isRegularFile(filePath)) {
      const body = req.method === 'HEAD' ? null : await readFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      // Vite 产物带内容哈希，可永久缓存
      const cache = rel.startsWith('assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
      send(res, status, body, { 'Content-Type': type, 'Cache-Control': cache });
      return;
    }

    if (extname(rel) !== '') {
      status = 404;
      send(res, status, 'Not Found');
      return;
    }

    // SPA 回退：无扩展名的前端路由统一返回 index.html
    const body = req.method === 'HEAD' ? null : await readFile(join(ROOT, 'index.html'));
    send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  } catch {
    status = 500;
    send(res, status, 'Internal Server Error');
  } finally {
    const ms = Date.now() - started;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${status} (${ms}ms)`);
  }
}

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('[server] 未找到 dist/index.html，请先运行 npm run build 完成构建。');
  process.exit(1);
}

const server = createServer(handler);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] 端口 ${port} 已被其他进程占用，请更换端口（--port）或先停止占用进程。`);
    process.exit(1);
  }
  console.error('[server] 启动失败:', err);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[server] 任务看板服务已启动：http://${host}:${port}  (PID ${process.pid})`);
});

// 优雅退出：先关闭连接再退出；5 秒兜底强退
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[server] 收到 ${sig}，正在停止...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
