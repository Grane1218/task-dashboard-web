/**
 * 清理「旧空间」遗留数据（带 space 字段、当前模式下看不到的那些文档）。
 *
 * 背景：每换一次「空间密钥」，云端就会多出一份带新 space 标签的数据；
 * 退回「未设空间密钥」的兼容模式后，这些带 space 字段的文档会被 queryAll 全部过滤掉，
 * 既看不到、也不会参与同步——就是一堆只在控制台里存在的历史包袱。
 *
 * 用法：
 *   node scripts/purge-space-tagged.mjs --project "D:\项目\任务看板"
 *        # 试运行：只体检 + 备份，不删任何东西
 *   node scripts/purge-space-tagged.mjs --project "D:\项目\任务看板" --yes
 *        # 真删：默认只删 tasks 集合里的旧空间任务
 *   node scripts/purge-space-tagged.mjs --project "D:\项目\任务看板" --yes --all
 *        # 连 habits / completions / settings / task-order 的旧空间数据一起删
 *   node scripts/purge-space-tagged.mjs --project "D:\项目\任务看板" --yes --collections tasks,habits
 *   node scripts/purge-space-tagged.mjs --project "D:\项目\任务看板" --yes --out "D:\备份"
 *
 * 安全设计：
 *  - 只处理**带 space 字段**的文档；当前正在使用（无 space 字段）的数据绝不触碰；
 *  - 无论是否 --yes，都先做全量备份 JSON（默认写到 当前目录/backup/）；
 *  - 逐条删除并回读校验，避免「接口返回成功但实际没删」（权限不足时就是这样）。
 *
 * 注意：删除别人的文档需要写权限。如果集合权限是「仅创建者可写」，
 * 这些属于其他身份的文档会**删不掉**（接口不报错但文档仍在）——先按 README 把 5 个集合
 * 改成「所有用户可读写」，再跑本脚本即可。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvId, findSdkFile, connectAnonymous, parseFlags } from './lib/cloud-node.mjs';

const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const projectRoot = resolve(flags.value('--project') || resolve(import.meta.dirname, '..'));
const envId = readEnvId(projectRoot, flags.value('--env'));
const sdkFile = findSdkFile(projectRoot);
const CONFIRMED = flags.has('--yes');
const ALL = flags.has('--all');
const outDir = resolve(flags.value('--out') || resolve(process.cwd(), 'backup'));
const collections = ALL
  ? ['tasks', 'habits', 'completions', 'settings', 'task-order']
  : (flags.value('--collections') || 'tasks')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

console.log('项目根目录 =', projectRoot);
if (!envId) {
  console.error('未找到 VITE_CLOUDBASE_ENV（.env / --env），无法连接云环境。');
  process.exit(1);
}
if (!sdkFile) {
  console.error('未找到 dist/assets/vendor-cloudbase-*.js，请先在项目根执行 npm run build。');
  process.exit(1);
}
console.log('云环境     =', envId);
console.log('待清理集合 =', collections.join(', '), CONFIRMED ? '（真删模式）' : '（试运行，不删除）');

const { db, uid, describe, readAll, docGet, hasSpace } = await connectAnonymous({ envId, sdkFile });
console.log('匿名身份   =', uid, '\n');

// ---------- 1. 体检 + 备份（永远先备份） ----------
const ALL_COLLECTIONS = ['tasks', 'habits', 'completions', 'settings', 'task-order'];
const backup = { exportedAt: new Date().toISOString(), envId, spaceTagged: {} };
const report = {};
for (const coll of ALL_COLLECTIONS) {
  const docs = await readAll(coll);
  const tagged = docs.filter(hasSpace);
  backup.spaceTagged[coll] = tagged;
  report[coll] = { total: docs.length, tagged: tagged.length, visible: docs.length - tagged.length };
  const bySpace = new Map();
  for (const d of tagged) bySpace.set(String(d.space), (bySpace.get(String(d.space)) ?? 0) + 1);
  console.log(
    `[${coll}] 共 ${docs.length} 条：当前可见（无 space）${docs.length - tagged.length} 条，旧空间（带 space）${tagged.length} 条` +
      (bySpace.size > 0 ? ` → ${[...bySpace].map(([s, n]) => `${s}:${n}`).join('  ')}` : ''),
  );
}
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = resolve(outDir, `space-tagged-backup-${stamp}.json`);
writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
console.log('\n全量备份已写入 =', backupFile);

// ---------- 2. 删除 ----------
const targets = collections.flatMap((coll) =>
  (backup.spaceTagged[coll] ?? []).map((d) => ({ coll, id: d._id, owner: d._openid })),
);
if (!CONFIRMED) {
  console.log(`\n试运行结束：本次将删除 ${targets.length} 条（${collections.join('/')}）。`);
  console.log('确认无误后加 --yes 再跑一次即可真正删除。');
  process.exit(0);
}
if (targets.length === 0) {
  console.log('\n没有需要删除的文档。');
  process.exit(0);
}

console.log(`\n开始删除 ${targets.length} 条……`);
let ok = 0;
const failures = [];
for (const t of targets) {
  try {
    await db.collection(t.coll).doc(t.id).remove();
    const still = await docGet(t.coll, t.id); // 回读校验：权限不足时 remove 不报错但删不掉
    if (still) failures.push({ ...t, reason: '接口未报错但文档仍存在（写权限不足）' });
    else ok += 1;
  } catch (e) {
    failures.push({ ...t, reason: describe(e) });
  }
}

console.log(`删除成功 ${ok} / ${targets.length}`);
if (failures.length > 0) {
  console.log(`删除失败 ${failures.length} 条，例如：`);
  for (const f of failures.slice(0, 5)) {
    console.log(`  ${f.coll}/${f.id} (owner=${f.owner}): ${f.reason}`);
  }
  const owners = [...new Set(failures.map((f) => f.owner))];
  console.log('\n失败文档的 owner：', owners.join(', '));
  console.log('本次身份：', uid);
  console.log(
    '→ 这些文档是**别的身份**创建的。把云开发控制台里 5 个集合的权限改成「所有用户可读写」后重跑本脚本即可删除。',
  );
}

// ---------- 3. 复核 ----------
const after = {};
for (const coll of collections) after[coll] = (await readAll(coll)).filter(hasSpace).length;
console.log('\n复核（仍在的旧空间文档数）：', JSON.stringify(after));
process.exit(0);
