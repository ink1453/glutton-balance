#!/usr/bin/env node
'use strict';
/**
 * 第 27 轮 · 阶段 0 · 共享核心「前后一致性」回归闸
 *
 * 目的：把 providers.js / config.js 的核心逻辑搬进 shared/ 之后，证明**对外行为一字未变**。
 *   只比 Object.keys 不够——所以这里连「导出形状（函数名/参数个数/类原型方法）」和
 *   「一批纯函数在固定输入下的输出」一起快照。
 *
 * 用法：
 *   node app-mac/test/shared-core-parity.js --write   # 改动前：记录基线
 *   node app-mac/test/shared-core-parity.js           # 改动后：比对（必须干净）
 *
 * 退出码：0 = 完全一致；1 = 有差异（打印第一处差异的路径与两侧值）。
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'shared-core-golden.json');
const FIXED_TMP = path.join(require('os').tmpdir(), 'r27-shared-parity');

// ---------------------------------------------------------------- 工具
/** 稳定序列化：对象键排序，保证两次运行字符串可比。 */
function stable(v) {
  if (v === undefined) return '«undefined»';
  if (typeof v === 'function') return '«function:' + (v.name || '') + '»';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

/** 导出形状：键名排序 + 每项的类型；函数额外记 name/arity，类额外记原型方法。 */
function shapeOf(mod) {
  const out = {};
  for (const k of Object.keys(mod).sort()) {
    const v = mod[k];
    if (typeof v === 'function') {
      const item = { kind: 'function', name: String(v.name || ''), arity: v.length };
      const proto = v.prototype ? Object.getOwnPropertyNames(v.prototype) : [];
      const methods = proto.filter((n) => n !== 'constructor').sort();
      if (methods.length) item.protoMethods = methods;
      out[k] = item;
    } else if (v === null || typeof v !== 'object') {
      out[k] = { kind: typeof v, value: v };
    } else {
      // 常量对象（ERROR_CODES / OFFICIAL_PRESETS…）直接快照内容
      out[k] = { kind: Array.isArray(v) ? 'array' : 'object', value: JSON.parse(JSON.stringify(v)) };
    }
  }
  return out;
}

/** 包一层：任何探测抛错都记成 {error}，不让一点异常炸掉整轮比对。 */
function probe(fn) {
  try {
    const r = fn();
    return r === undefined ? '«undefined»' : JSON.parse(JSON.stringify(r));
  } catch (e) {
    return { probeError: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------- 固定输入（不含时间/随机/真实密钥）
const RICH_CONFIG = {
  version: 1,
  enabled: false,
  clickThrough: true,
  hotkey: { enabled: true, combo: 'Ctrl+Alt+B' },
  position: { mode: 'hug-taskbar', bottomGap: 8, offsetX: -12, offsetY: 30, zOrder: 'below-pet', petPort: 1234, clampMargin: 5, monitorFollow: true },
  display: {
    style: 'capsule', bowlStyle: 'square', labelStyle: 'compact', wear: 'head', nineLayout: 'grid',
    compactAfter: 4, refYuan: 250, wheels: true, petScaleRef: 1.25, graphicsMin: 0.5, graphicsMax: 2.5,
    logo: true, logoStyle: 'x',
  },
  theme: { follow: false, port: 9999, statePort: 9998, force: 'Light', pollMs: 2000 },
  interaction: { expandOnClick: false, shake: { enabled: false, reverseCount: 6, minAmplitudePt: 20 } },
  capsule: { width: 300, height: 60, overlap: 4, maxProviders: 5 },
  liveFollow: { detectMs: 500, smooth: false },
  petLift: { enabled: false },
  providers: [
    { id: 'ds', name: 'DeepSeek', type: 'official', preset: 'deepseek', threshold: 5, fullAmount: 100, intervalSec: 60, enabled: true },
    { id: 'relay1', name: 'A6', type: 'relay', preset: 'newapi', endpoint: 'https://a6.example.com/api/user/self', a6User: 'u-1', threshold: 10, fullAmount: 200, intervalSec: 120 },
    { id: 'q', name: 'Qoder', type: 'official', preset: 'qoder', threshold: 100, intervalSec: 300 },
    { id: 'q-intl', type: 'official', preset: 'qoder', endpoint: 'https://openapi.qoder.sh', unit: 'usd', intervalSec: 90 },
    { id: 'cus', name: '自定义', type: 'custom', endpoint: 'https://x.example.com/bal', jsonPath: 'data.total', currency: 'USD', intervalSec: 30 },
    { id: 'r', name: '大白饭', type: 'rice', intervalSec: 600 },
    { id: 'bad-type', type: 'deepseek', preset: 'weird', threshold: -5, fullAmount: 0, intervalSec: 1 },
    { id: 'dup', name: 'dup', type: 'a6_newapi', preset: 'a6', intervalSec: 999999 },
    { id: 'dup', name: 'dup2', type: 'official', intervalSec: 60 },
    { id: 'over10', name: '超出上限的第 10 家', type: 'custom', intervalSec: 60 },
  ],
};

const NODE_ERRORS = [
  { code: 'ENOTFOUND' },
  { code: 'ETIMEDOUT' },
  { code: 'ECONNRESET' },
  { code: 'CERT_HAS_EXPIRED' },
  { code: 'ERR_INVALID_URL', message: 'Invalid URL' },
  { message: 'Unexpected token < in JSON at position 0' },
  { message: 'socket hang up' },
  {},
  null,
];

const QODER_BODIES = [
  null,
  {},
  { userQuota: { total: 2000, used: 500 } },
  { userQuota: { remaining: 1500 }, addOnQuota: { remaining: 100.005 }, orgResourcePackage: { total: 50, used: 10 } },
  { userQuota: { total: 2000, used: 500 }, addOnQuota: { remaining: 0 }, orgResourcePackage: {} },
  { userQuota: { remaining: 'abc' }, addOnQuota: { total: 10 }, orgResourcePackage: { remaining: 2.345 } },
  { quota: { remaining: 7 }, data: { remaining: 9 } },
];

// ---------------------------------------------------------------- 快照
function buildSnapshot() {
  const providers = require(path.join(APP_DIR, 'src', 'providers'));
  const config = require(path.join(APP_DIR, 'src', 'config'));

  // 固定临时 key 文件（路径稳定，避免 mkdtemp 每轮不同导致基线漂移）
  fs.rmSync(FIXED_TMP, { recursive: true, force: true });
  fs.mkdirSync(FIXED_TMP, { recursive: true });
  const keyFile = path.join(FIXED_TMP, 'fake-pat.txt');
  fs.writeFileSync(keyFile, 'QODER_PAT=pt-parity-fake\n', 'utf8');
  const singleKeyFile = path.join(FIXED_TMP, 'single.txt');
  fs.writeFileSync(singleKeyFile, 'pt-single-line-fake\n', 'utf8');
  const emptyVarFile = path.join(FIXED_TMP, 'emptyvar.txt');
  fs.writeFileSync(emptyVarFile, 'OTHER=1\n', 'utf8');

  const snap = {};

  // ① 导出形状（键名 + 函数名/参数个数 + 类原型方法）
  snap.exports = { providers: shapeOf(providers), config: shapeOf(config) };

  // ② 配置归一化：默认 / 空 / 富输入
  snap.configBehavior = {
    defaultConfig: probe(() => config.defaultConfig()),
    normalizeEmpty: probe(() => config.normalizeConfig({})),
    normalizeNull: probe(() => config.normalizeConfig(null)),
    normalizeRich: probe(() => config.normalizeConfig(RICH_CONFIG)),
    normalizeRichTwice: probe(() => config.normalizeConfig(config.normalizeConfig(RICH_CONFIG))), // 幂等性
    defaultProvidersFallback: probe(() => config.normalizeConfig({ providers: [] }).providers.map((p) => p.id + '|' + p.type + '|' + p.preset)),
  };

  // ③ 单位与预设
  snap.units = {
    table: probe(() => {
      const rows = [];
      for (const raw of ['CNY', 'usd', 'CREDITS', 'cny', '', null, 'weird', ' Credits ']) {
        for (const preset of ['deepseek', 'openrouter', 'qoder', 'newapi', 'custom', 'rice', undefined]) {
          rows.push([String(raw), String(preset), config.normalizeUnit(raw, preset)]);
        }
      }
      return rows;
    }),
    presets: probe(() => config.OFFICIAL_PRESETS),
    maxProviders: probe(() => config.MAX_PROVIDERS),
  };

  // ④ 平台默认密钥来源（每 type/preset 组合）
  snap.keyDefaults = probe(() => {
    const rows = [];
    for (const type of ['official', 'relay', 'custom', 'rice']) {
      for (const preset of ['qoder', 'newapi', 'deepseek', 'kimi', 'siliconflow', 'stepfun', 'openrouter', 'rice', 'custom']) {
        rows.push([type, preset, config.providerDefaultKeySource(type, preset)]);
      }
    }
    return rows;
  });

  // ⑤ expandPath（只测与平台无关的稳定输入，避免依赖真实 HOME）
  //    ⚠️ 必须先做 <HOME> 归一化：`~` 会被 expandPath 展开成 os.homedir()，而基线文件是进仓库的
  //    （公开仓库），既不能把某台机器的用户名路径写死，也不能让换机器/换 HOME 跑就必然误报 1 处。
  snap.expandPath = probe(() => {
    const home = require('os').homedir();
    const norm = (s) => (typeof s === 'string' && home ? s.split(home).join('<HOME>') : s);
    return ['~/.dsh/secrets/qoder-pat.txt', '/abs/path', '', null, 'plain.txt'].map((p) => norm(config.expandPath(p)));
  });

  // ⑥ 环境变量常量与目录口径（不在此处真的读文件系统）
  snap.envConstants = probe(() => ({
    ENV_DIR: config.ENV_DIR, ENV_CONFIG: config.ENV_CONFIG, ENV_LOG: config.ENV_LOG,
    LEGACY_ENV_DIR: config.LEGACY_ENV_DIR, LEGACY_ENV_CONFIG: config.LEGACY_ENV_CONFIG, LEGACY_ENV_LOG: config.LEGACY_ENV_LOG,
    userDirIsString: typeof config.userDir() === 'string',
    configPathIsString: typeof config.configPath() === 'string',
    configPathEndsWithConfigJson: /config\.json$/.test(String(config.configPath())),
  }));

  // ⑦ 错误映射表
  snap.errors = {
    codes: probe(() => providers.ERROR_CODES),
    text: probe(() => providers.ERROR_TEXT),
    errorTextTable: probe(() => {
      const rows = [];
      for (const code of Object.keys(providers.ERROR_CODES)) {
        rows.push([code, providers.errorText(code), providers.errorText(code, 'qoder.quota')]);
      }
      rows.push(['__UNKNOWN__', providers.errorText('NOPE'), providers.errorText(undefined, 'x')]);
      return rows;
    }),
    httpStatus: probe(() => [200, 201, 204, 301, 400, 401, 403, 404, 418, 429, 500, 503, 0, -1, 999].map((s) => [s, providers.classifyHttpStatus(s)])),
    nodeError: probe(() => NODE_ERRORS.map((e) => providers.classifyNodeError(e))),
    redact: probe(() => [
      providers.redact('token is sk-abcdef1234567890abcdef', 'sk-abcdef1234567890abcdef'),
      providers.redact('key=pt-1234567890abcdef tail', 'pt-1234567890abcdef'),
      providers.redact('nothing secret here', ''),
      providers.redact('', 'zzz'),
      providers.redact('服务端回显 sk-9876543210abcdef 结束', ''),
    ]),
    pathTail: probe(() => [['a.b.c', 1], ['a.b.c', 2], ['', 1], ['noperiod', 1], ['x.y', 5]].map(([p, n]) => providers.pathTail(p, n))),
  };

  // ⑧ 数值/路径工具
  snap.numberUtils = {
    round2: probe(() => [0, 1, 1.005, 1.0049, 123.456, -0.005, 2.675, 1e6 + 0.333].map((v) => providers.round2(v))),
    resolvePath: probe(() => {
      const obj = { a: { b: [{ c: 1 }, { c: 2 }] }, data: { balance: 42 }, 'k.d': 7, arr: [10, 20] };
      return ['data.balance', 'a.b.1.c', 'a.b.5.c', 'k.d', 'arr.0', '', 'missing.x', null].map((p) => providers.resolvePath(obj, p));
    }),
  };

  // ⑨ Qoder 余额公式（三池相加口径）
  snap.qoder = {
    quotaAmounts: probe(() => QODER_BODIES.map((b) => providers.qoderQuotaAmount(b))),
    constants: probe(() => ({ base: providers.QODER_DEFAULT_ENDPOINT, ttl: providers.QODER_TOKEN_TTL_MS })),
    clearCacheIsFunction: probe(() => typeof providers.clearQoderTokenCache === 'function'),
  };

  // ⑩ 密钥读取（固定临时文件；不产生真实密钥）
  snap.keys = {
    fallbackList: probe(() => providers.KEY_FALLBACKS),
    officialUrls: probe(() => providers.OFFICIAL_URLS),
    fromFile: probe(() => providers.loadKey({ type: 'official', preset: 'qoder', keySource: { kind: 'file', file: keyFile, var: 'QODER_PAT' } }, false)),
    fromFileMissing: probe(() => providers.loadKey({ type: 'official', preset: 'qoder', keySource: { kind: 'file', file: path.join(FIXED_TMP, 'nope.txt'), var: 'QODER_PAT' } }, false)),
    varNotInFile: probe(() => providers.loadKey({ type: 'official', preset: 'qoder', keySource: { kind: 'file', file: emptyVarFile, var: 'QODER_PAT' } }, false)),
    singleLineFile: probe(() => providers.loadKey({ type: 'custom', preset: 'custom', keySource: { kind: 'file', file: singleKeyFile, var: '' } }, false)),
    envMissing: probe(() => providers.loadKey({ type: 'custom', keySource: { kind: 'env', var: 'R27_PARITY_NO_SUCH_VAR' } }, false)),
    envNoVarName: probe(() => providers.loadKey({ type: 'custom', keySource: { kind: 'env' } }, false)),
    noSource: probe(() => providers.loadKey({ type: 'custom', keySource: { kind: 'file', file: '', var: '' } }, false)),
  };

  // ⑪ 演示视图（纯函数、不联网）
  snap.demoViews = probe(() => ({
    n2normal: providers.demoViews(2, 'normal'),
    n5low: providers.demoViews(5, 'low'),
    n9full: providers.demoViews(9, 'full'),
  }));

  // ⑫ ProviderManager 构造形状（只看结构，不启动定时器）
  snap.providerManager = probe(() => {
    const M = new providers.ProviderManager({});
    M.configure(config.normalizeConfig(RICH_CONFIG));
    return {
      hasCfg: !!M.cfg,
      runtimeCount: M.runtimes.length,
      runtimeKeys: Object.keys(M.runtimes[0] || {}).sort(),
      runtimeIds: M.runtimes.map((r) => r.pc.id),
      dueNow: M.runtimes.every((r) => r.nextDueMs > 0),
      rateCacheIsMap: M.rateCache instanceof Map,
      running: M.running,
    };
  });

  // ⑬ 异步纯本地分支：rice 不联网 + verifyKey(rice)
  snap.asyncLocal = {
    riceVerify: probe(() => typeof providers.verifyKey === 'function'),
  };

  return snap;
}

async function buildAsyncSnapshot(snap) {
  const providers = require(path.join(APP_DIR, 'src', 'providers'));
  snap.asyncLocal.verifyRice = await (async () => {
    try { return JSON.parse(JSON.stringify(await providers.verifyKey({ type: 'rice', preset: 'rice' }))); } catch (e) { return { probeError: String(e && e.message || e) }; }
  })();
  return snap;
}

// ---------------------------------------------------------------- 比对
function firstDiff(a, b, trail) {
  const here = trail || '$';
  if (a === b) return null;
  if (typeof a !== typeof b) return { path: here, before: a, after: b };
  if (a === null || b === null) return { path: here, before: a, after: b };
  if (typeof a !== 'object') return { path: here, before: a, after: b };
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  const missing = ka.filter((k) => !kb.includes(k));
  const added = kb.filter((k) => !ka.includes(k));
  if (missing.length || added.length) return { path: here, before: { missing, added }, after: '键集合不同' };
  for (const k of ka) {
    const d = firstDiff(a[k], b[k], here + '.' + k);
    if (d) return d;
  }
  return null;
}

function countDiff(a, b, trail, acc) {
  const out = acc || [];
  if (a === b) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push({ path: trail, before: a, after: b });
    return out;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  for (const k of ka.filter((x) => !kb.includes(x))) out.push({ path: trail + '.' + k, before: a[k], after: '«缺失»' });
  for (const k of kb.filter((x) => !ka.includes(x))) out.push({ path: trail + '.' + k, before: '«缺失»', after: b[k] });
  for (const k of ka.filter((x) => kb.includes(x))) countDiff(a[k], b[k], trail + '.' + k, out);
  return out;
}

(async function main() {
  const write = process.argv.includes('--write');
  let snap = buildSnapshot();
  snap = await buildAsyncSnapshot(snap);
  const text = stable(snap) + '\n';

  if (write) {
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(GOLDEN_PATH, text, 'utf8');
    const provKeys = Object.keys(snap.exports.providers).length;
    const confKeys = Object.keys(snap.exports.config).length;
    console.log(`✅ 已记录基线：${path.relative(process.cwd(), GOLDEN_PATH)}`);
    console.log(`   providers 导出 ${provKeys} 项 / config 导出 ${confKeys} 项 / 快照 ${text.length} 字节`);
    return;
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    console.error('❌ 找不到基线 ' + GOLDEN_PATH + '，先跑 --write');
    process.exitCode = 1;
    return;
  }
  const before = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
  const after = JSON.parse(text);
  const diffs = countDiff(before, after, '$');
  const provKeys = Object.keys(after.exports.providers).length;
  const confKeys = Object.keys(after.exports.config).length;

  if (!diffs.length) {
    console.log(`PASS=1 FAIL=0  导出形状与行为快照完全一致（providers ${provKeys} 项 / config ${confKeys} 项）`);
    return;
  }
  const first = firstDiff(before, after, '$');
  console.log(`PASS=0 FAIL=1  发现 ${diffs.length} 处差异`);
  console.log('  首个差异：' + first.path);
  console.log('    改动前：' + stable(first.before).slice(0, 400));
  console.log('    改动后：' + stable(first.after).slice(0, 400));
  for (const d of diffs.slice(0, 20)) console.log('  · ' + d.path + '  ' + stable(d.before).slice(0, 120) + '  →  ' + stable(d.after).slice(0, 120));
  process.exitCode = 1;
})();
