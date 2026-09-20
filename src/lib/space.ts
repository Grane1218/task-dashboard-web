/**
 * 云端「空间密钥」：解决共享集合无隔离的问题。
 *
 * 背景：
 * - 云数据库集合权限为「所有用户可读写」时，任何拿到 envId 的人都能读写全部数据。
 * - envId 会随前端 bundle 公开发布，因此 **envId 不是秘密**。
 * - 匿名登录的 uid 每台设备独立，所以不能用 owner 做过滤（否则换设备读不到数据）。
 *
 * 方案：
 * - 让用户在本机（每台设备首次配置时）输入一串「空间密钥」，只保存在 localStorage，
 *   **不参与构建、不进入 bundle**；同密钥的设备共享同一份数据。
 * - 密钥经 FNV-1a 64 位散列得到 16 位空间标签，作为云端文档 _id 前缀与 space 字段。
 *   所有查询都带 space 过滤，因此不同密钥的数据互不可见（应用层逻辑隔离）。
 *
 * 边界（务必知悉）：
 * - 这是**逻辑隔离**，不是授权。绕过本应用直接调用 CloudBase SDK 仍可读取集合内数据。
 * - 真正的授权必须依赖云开发安全规则（见 README「云端安全」一节）。
 */

const STORAGE_KEY = 'task-dashboard-space-key';
/** 记录「本地数据已归属哪个空间」，用于识别空间切换（避免跨空间合并污染） */
const SYNCED_KEY = 'task-dashboard-space-synced';

/** 构建期提示值：注意它会被打进 bundle，仅用于本地/演示，不应视为秘密 */
const BUILD_HINT: string = (
  (import.meta.env.VITE_CLOUDBASE_SPACE as string | undefined) ?? ''
).trim();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage 不可用时静默降级：本次会话仍以内存值运行
  }
}

let memorySecret: string | null = null;

/** 当前空间密钥（明文）。空字符串表示未配置 → 兼容模式（无隔离） */
export function getSpaceSecret(): string {
  if (memorySecret !== null) return memorySecret;
  const stored = safeGet(STORAGE_KEY);
  if (stored !== null) {
    memorySecret = stored.trim();
    return memorySecret;
  }
  memorySecret = BUILD_HINT;
  return memorySecret;
}

/** 设置空间密钥；传空字符串表示清除（回到兼容模式） */
export function setSpaceSecret(value: string): void {
  memorySecret = value.trim();
  safeSet(STORAGE_KEY, memorySecret);
}

/** 是否使用构建期提示值（提醒用户：它已公开，不要当作秘密） */
export function isUsingBuildHint(): boolean {
  return BUILD_HINT !== '' && getSpaceSecret() === BUILD_HINT && safeGet(STORAGE_KEY) === null;
}

/** FNV-1a 64 位散列 → 16 位十六进制。纯 JS、跨设备确定性（不依赖 SubtleCrypto 与安全上下文） */
export function deriveSpaceTag(secret: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < secret.length; i += 1) {
    hash ^= BigInt(secret.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 当前空间标签（云端文档 id 前缀 + space 字段值）；'' 表示兼容模式 */
export function getSpaceTag(): string {
  const secret = getSpaceSecret();
  return secret === '' ? '' : deriveSpaceTag(secret);
}

/** 是否启用了空间隔离 */
export function isSpaceIsolated(): boolean {
  return getSpaceTag() !== '';
}

/** 本地数据上一次同步所属的空间标签（null = 从未同步过） */
export function getSyncedSpaceTag(): string | null {
  return safeGet(SYNCED_KEY);
}

/** 标记本地数据已归属当前空间 */
export function markSpaceSynced(tag: string = getSpaceTag()): void {
  safeSet(SYNCED_KEY, tag);
}

/** 空间是否发生了切换：已同步过、且与当前空间标签不一致 */
export function hasSpaceChanged(): boolean {
  const synced = getSyncedSpaceTag();
  return synced !== null && synced !== getSpaceTag();
}
