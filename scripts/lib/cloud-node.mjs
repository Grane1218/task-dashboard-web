/**
 * 诊断/维护脚本共用的「Node 里跑 CloudBase SDK」适配层。
 *
 * 为什么这么做：网页端的 SDK（@cloudbase/js-sdk v3）是浏览器产物，直接 require 会缺 window。
 * 这里复用 dist 里**已经构建好的 SDK chunk**（与线上运行时代码逐字节相同），
 * 并补一层最小垫片，从而在 Node 里以匿名身份复现网页端的云端读写行为。
 */
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** 解析 `--flag value` / `--flag=value` 形式参数 */
export function parseFlags(argv) {
  const value = (name) => {
    const hit = argv.find((a) => a === name || a.startsWith(name + '='));
    if (!hit) return '';
    if (hit === name) return argv[argv.indexOf(hit) + 1] ?? '';
    return hit.slice(name.length + 1);
  };
  return { has: (name) => argv.includes(name), value };
}

/** envId：命令行 --env > 环境变量 > 项目根 .env */
export function readEnvId(projectRoot, override = '') {
  if (override) return override.trim();
  if (process.env.VITE_CLOUDBASE_ENV) return process.env.VITE_CLOUDBASE_ENV.trim();
  const envPath = resolve(projectRoot, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('VITE_CLOUDBASE_ENV='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

/** 从 dist/assets 里找已构建的 CloudBase SDK chunk（找不到说明还没 npm run build） */
export function findSdkFile(projectRoot) {
  const dir = resolve(projectRoot, 'dist/assets');
  if (!existsSync(dir)) return '';
  return (
    readdirSync(dir)
      .filter((f) => f.startsWith('vendor-cloudbase') && f.endsWith('.js'))
      .map((f) => resolve(dir, f))[0] ?? ''
  );
}

/** 最小浏览器垫片：先不给 document（让同 chunk 图里的 React 走 server 分支），import 之后再补 */
function installShimsBeforeImport() {
  const store = new Map();
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'Node-script', language: 'zh-CN' };
  globalThis.location = {
    href: 'http://127.0.0.1:4173/',
    protocol: 'http:',
    host: '127.0.0.1:4173',
    origin: 'http://127.0.0.1:4173',
    pathname: '/',
  };
}

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    nodeName: String(tag).toUpperCase(),
    nodeType: 1,
    style: { setProperty() {}, removeProperty() {} },
    attributes: {},
    children: [],
    childNodes: [],
    firstChild: null,
    lastChild: null,
    parentNode: null,
    textContent: '',
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    hasAttribute: () => false,
    appendChild: (c) => c,
    removeChild: (c) => c,
    insertBefore: (c) => c,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    cloneNode: () => makeEl(tag),
    contains: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {},
    blur() {},
  };
}

function installShimsAfterImport() {
  globalThis.document = {
    cookie: '',
    nodeType: 9,
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: t, nodeValue: t }),
    createDocumentFragment: () => makeEl('fragment'),
    getElementById: () => null,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    body: makeEl('body'),
    head: makeEl('head'),
    documentElement: makeEl('html'),
  };
  if (!globalThis.HTMLElement) globalThis.HTMLElement = function HTMLElement() {};
}

/** 单次云请求的默认分页大小（客户端 SDK 单次 get 上限 20 条） */
export const PAGE_SIZE = 20;

/**
 * 以全新匿名身份连接云环境。
 * 返回 { db, uid, describe, readAll, hasSpace, docGet } —— 够诊断与清理脚本使用。
 */
export async function connectAnonymous({ envId, sdkFile }) {
  installShimsBeforeImport();
  const mod = await import(pathToFileURL(sdkFile).href);
  const cloudbase = mod.default ?? mod;
  installShimsAfterImport();

  const app = cloudbase.init({ env: envId });
  const auth = app.auth({ persistence: 'none' });
  const signIn = await auth.signInAnonymously();
  if (signIn?.error) throw new Error('匿名登录失败: ' + JSON.stringify(signIn.error));
  const uid = signIn?.data?.user?.id ?? '(unknown)';
  const db = app.database();

  const describe = (e) =>
    e ? `${e.code ?? ''} ${e.message ?? e.errMsg ?? String(e)}`.trim() : '(无错误)';

  const readAll = async (coll) => {
    const out = [];
    let skip = 0;
    for (;;) {
      const res = await db.collection(coll).skip(skip).limit(PAGE_SIZE).get();
      const batch = res.data ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    return out;
  };

  const docGet = async (coll, id) => {
    const res = await db.collection(coll).doc(id).get().catch(() => ({ data: [] }));
    const list = Array.isArray(res.data) ? res.data : [res.data];
    return list.filter(Boolean)[0] ?? null;
  };

  const hasSpace = (d) => Object.prototype.hasOwnProperty.call(d, 'space');

  return { db, uid, describe, readAll, docGet, hasSpace };
}
