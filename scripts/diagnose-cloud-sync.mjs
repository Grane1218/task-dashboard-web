/**
 * 云端同步诊断脚本（Node 运行，无需浏览器）
 *
 * 用途：当「网页端 / 小程序端显示同步失败」时，判断到底是**云环境**、**集合权限**
 * 还是**数据归属**的问题。它复用 dist 里真实的 @cloudbase/js-sdk 产物，
 * 以一个全新的匿名身份登录——相当于一台从没同步过的新设备，
 * 因此它能否写别人的文档，等价于小程序端能否写网页端建的数据。
 *
 * 运行（默认以脚本所在仓库为项目根，需要 .env + dist；也可以显式指定项目根）：
 *   node scripts/diagnose-cloud-sync.mjs                        # 只读体检（不写任何数据）
 *   node scripts/diagnose-cloud-sync.mjs --project "D:\项目\任务看板"
 *   node scripts/diagnose-cloud-sync.mjs --write-probe
 *        # 追加一次「原样回写他人文档」的写探针：内容逐字段照抄，零内容变化，
 *        # 只用来判定写权限是否限创建者。会自行校验回读内容一致。
 *
 * 退出码：0 = 正常；1 = 云环境/登录不可用。
 */
import { resolve } from 'node:path';
import { readEnvId, findSdkFile, connectAnonymous, PAGE_SIZE, parseFlags } from './lib/cloud-node.mjs';

const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const projectRoot = resolve(flags.value('--project') || resolve(import.meta.dirname, '..'));
const envId = readEnvId(projectRoot, flags.value('--env'));
const sdkFile = findSdkFile(projectRoot);
const WRITE_PROBE = flags.has('--write-probe');

console.log('项目根目录   =', projectRoot);
if (!envId) {
  console.error(
    '未找到 VITE_CLOUDBASE_ENV（.env / --env / 环境变量），无法诊断。\n' +
      '若项目根不对，请用 --project 指定，例如：node scripts/diagnose-cloud-sync.mjs --project "D:\\项目\\任务看板"',
  );
  process.exit(1);
}
if (!sdkFile) {
  console.error('未找到 dist/assets/vendor-cloudbase-*.js，请先在项目根执行 npm run build。');
  process.exit(1);
}
console.log('云环境 envId =', envId);
console.log('SDK 产物     =', sdkFile);

// ---------- 匿名登录（等价于新设备首次接入） ----------
let db;
let uid;
let describe;
let readAll;
let docGet;
let hasSpace;
try {
  ({ db, uid, describe, readAll, docGet, hasSpace } = await connectAnonymous({ envId, sdkFile }));
} catch (e) {
  console.error('匿名登录失败（云环境不可用，或控制台未开启「匿名登录」）:', e?.message || String(e));
  process.exit(1);
}
console.log('匿名登录成功，本次身份 uid =', uid, '\n');

// ---------- 只读体检：每个集合的条数与 _openid 归属 ----------
console.log('===== 只读体检：谁能写、数据归谁 =====');
for (const coll of ['tasks', 'habits', 'completions', 'settings', 'task-order']) {
  const docs = await readAll(coll);
  const owners = new Map();
  const spaces = new Map();
  for (const d of docs) {
    const owner = String(d._openid ?? '(none)');
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
    const sp = String(d.space ?? '(无 space 字段)');
    spaces.set(sp, (spaces.get(sp) ?? 0) + 1);
  }
  console.log(`\n[${coll}] 共 ${docs.length} 条`);
  for (const [owner, n] of owners) {
    console.log(`   _openid=${owner}  ${n} 条 ${owner === uid ? '← 本次（新设备）身份' : ''}`);
  }
  for (const [sp, n] of spaces) {
    console.log(
      `   space=${sp}  ${n} 条${
        sp === '(无 space 字段)' ? '（当前「未设空间密钥」模式下可见）' : '（当前模式下被过滤，不可见）'
      }`,
    );
  }
}

// ---------- 写探针（可选）：自己 vs 别人 ----------
console.log('\n===== 写权限判定 =====');
const PROBE_ID = '__diag_probe__';
try {
  await db.collection('completions').doc(PROBE_ID).set({ data: { date: PROBE_ID, templateIds: ['a'] } });
  await db.collection('completions').doc(PROBE_ID).set({ data: { date: PROBE_ID, templateIds: ['a', 'b'] } });
  console.log('[对照] 新建并二次覆盖「自己的文档」→ 成功（写通道本身正常，set 对本人文档是替换语义）');
} catch (e) {
  console.log('[对照] 自己的文档写入失败（问题比权限更基础）:', describe(e));
} finally {
  try {
    await db.collection('completions').doc(PROBE_ID).remove();
  } catch {
    console.log(`（提示：探针文档 completions/${PROBE_ID} 未能自动清理，可在控制台手动删除）`);
  }
}

if (!WRITE_PROBE) {
  console.log('[写探针] 未启用。需要判定「非创建者能否改别人的文档」时加 --write-probe 再跑一次。');
} else {
  // 优先挑当前模式下不可见的遗留文档（带 space）做零内容变化回写，避免影响正在使用的数据
  let target = null;
  for (const coll of ['completions', 'settings', 'tasks']) {
    const docs = await readAll(coll);
    const foreign = docs.filter((d) => d._openid !== uid);
    const picked = foreign.find(hasSpace) ?? foreign[0];
    if (picked) {
      target = { coll, id: picked._id, doc: picked, inert: hasSpace(picked) };
      break;
    }
  }
  if (!target) {
    console.log('[写探针] 没有找到属于其他身份的文档，无法判定。');
  } else {
    const payload = { ...target.doc };
    delete payload._id;
    delete payload._openid;
    console.log(
      `[写探针] 目标 ${target.coll}/${target.id}（owner=${target.doc._openid}${
        target.inert === true ? '，带 space，当前模式下不可见' : '，当前可见数据'
      }），原样回写……`,
    );
    try {
      // ⚠️ 两个端的 SDK 签名不同，别写混：
      //   Web 端  @cloudbase/js-sdk v3 ：doc(id).set(文档本身)
      //   小程序端 wx.cloud.database() ：doc(id).set({ data: 文档本身 })
      // 传错会把整个文档嵌进一个 data 字段里（内容没丢，但结构坏了）。
      await db.collection(target.coll).doc(target.id).set(payload);
      console.log('  → 成功：写权限对所有人开放，同步失败的原因不在权限。');
    } catch (e) {
      console.log('  → 被拒：集合写权限「仅创建者可写」，这就是跨端同步失败的根因。');
      console.log('    错误:', describe(e));
    }
    const after = await docGet(target.coll, target.id);
    const stripSystem = (d) => {
      const copy = { ...d };
      delete copy._id;
      delete copy._openid;
      return copy;
    };
    const contentSame =
      JSON.stringify(stripSystem(after)) === JSON.stringify(stripSystem(target.doc));
    console.log('  回读业务内容一致:', contentSame ? '是（零改动）' : '否（有变化，请检查）');
    if (after && after._openid !== target.doc._openid) {
      console.log(
        `  提示：_openid ${target.doc._openid} → ${after._openid ?? '(字段被移除)'}` +
          '（跨身份覆盖时服务端不会保留原创建者字段；本应用不使用 _openid，故不影响功能）',
      );
    }
    console.log(
      `（分页大小 ${PAGE_SIZE}；带 space 的文档数：${(await readAll(target.coll)).filter(hasSpace).length}）`,
    );
  }
}

process.exit(0);
