'use strict';
// 饭桶余额 · 共享配置核心（第 27 轮双端统一）
//
// 定位：纯 CommonJS / 纯 JS / 不 require('electron') / 不碰 UI，
//       Mac 端（app-mac）与后续 Win 端（app-win）共用这一份归一化逻辑。
// 来源：第 26 轮 app-mac/src/config.js 整份搬迁（逐字节搬运，非重写），
//       唯一行为改动 = providerDefaultKeySource 的默认密钥路径改为按 process.platform 派生；
//       darwin 输出与第 26 轮逐字段一致（由 app-mac/test/shared-core-parity.js 快照守住）。
// 口径：Win 版 world/src/index.ts normalizeConfig() + Panel.cs ConfigStore/WriteDefault；详见项目规格文档 spec-docs.md §2
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeShake } = require('./shake');

const MAX_PROVIDERS = 9;

const OFFICIAL_PRESETS = {
  deepseek: 'https://api.deepseek.com/user/balance',
  kimi: 'https://api.moonshot.cn/v1/users/me/balance',
  siliconflow: 'https://api.siliconflow.cn/v1/user/info',
  stepfun: 'https://api.stepfun.com/v1/accounts',
  openrouter: 'https://openrouter.ai/api/v1/credits',
  // Qoder：endpoint 是 base（不是完整余额地址），允许用户改成国际版 openapi.qoder.sh
  qoder: 'https://openapi.qoder.com.cn',
};

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function bool(v, dflt) { return typeof v === 'boolean' ? v : dflt; }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function clampNum(v, lo, hi, dflt) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = dflt;
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}
function int(v, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : dflt; }
function str(v, dflt) { return typeof v === 'string' ? v : dflt; }
function round2(v) { return Math.round(v * 100) / 100; }

function defaultConfig() {
  return {
    version: 1,
    enabled: true,
    clickThrough: true,
    refreshSeq: 0,
    hotkey: { enabled: false, combo: 'Ctrl+Alt+Shift+R' },
    position: {
      mode: 'under-feet', bottomGap: 8, offsetX: 0, offsetY: 0,
      zOrder: 'topmost', petPort: 7797, clampMargin: 8, monitorFollow: true,
    },
    display: {
      style: 'ricebowl', bowlStyle: 'porcelain', labelStyle: 'L3', wear: 'head',
      nineLayout: 'pyramid', compactAfter: 5, refYuan: 100, wheels: false,
      petScaleRef: 1.05, graphicsMin: 0.95, graphicsMax: 2.0,
      // 第 27 轮·缩小：整体缩放系数（百分比）。100 = 与第 26 轮逐字节一致；
      // 叠加在「盆宽 = 桌宠实测宽 × 0.80」的自动匹配之上，只做整体倍率，不替换匹配逻辑。
      sizePct: 100,
      logo: false, logoStyle: 'deepseek',
    },
    theme: { follow: true, port: 17788, statePort: 7797, force: '', pollMs: 3000 },
    interaction: { expandOnClick: false, shake: normalizeShake(null) },
    capsule: { width: 200, height: 30, overlap: 6, maxProviders: 9 },
    liveFollow: { detectMs: 250, smooth: true },
    petLift: { enabled: true },
    providers: [],
  };
}

function normalizeBowlStyle(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 'porcelain';
  if (/^custom:/i.test(s)) return s;
  const low = s.toLowerCase();
  // 第 9 轮：搪瓷（enamel）外观已整套下线（老板 2026-11-01 20:0x）；旧配置 enamel/未知值统一回退白瓷。
  if (['porcelain', 'black', 'steel'].includes(low)) return low;
  return 'porcelain'; // X 缺失/未知 → porcelain（默认白瓷）
}

function normalizeNineLayout(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s === 'row') return 'row';
  if (s === 'tworows') return 'twoRows';
  // 注意：row9（旧默认值）按 X v5 语义迁移为 pyramid；缺省/未知 → pyramid
  return 'pyramid';
}

function normalizeLabelStyle(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (s === 'L1' || s === 'L2' || s === 'L3') return s;
  return 'L3';
}

function normalizeWear(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s === 'feet') return 'feet';
  return 'head'; // 缺省/空/未知 → head（第 4 轮新默认）
}

function normalizePreset(pc, type) {
  const raw = String(pc.preset == null ? '' : pc.preset).trim().toLowerCase();
  const map = {
    a6: 'newapi', a6_newapi: 'newapi', 'new-api': 'newapi', newapi: 'newapi',
    official: 'deepseek', relay: 'newapi', rice: 'rice', custom: 'custom',
    deepseek: 'deepseek', kimi: 'kimi', siliconflow: 'siliconflow', stepfun: 'stepfun', openrouter: 'openrouter',
    qoder: 'qoder',
  };
  if (raw && map[raw]) return map[raw];
  if (type === 'official') return 'deepseek';
  if (type === 'relay') return 'newapi';
  if (type === 'rice') return 'rice';
  return 'custom';
}

/** 币种/单位：'CNY' | 'USD' | 'CREDITS'（大小写不敏感）；缺省按预设推导（三端同口径）。 */
function normalizeUnit(raw, preset) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (s === 'CNY' || s === 'USD' || s === 'CREDITS') return s;
  if (preset === 'qoder') return 'CREDITS';
  if (preset === 'openrouter') return 'USD';
  return 'CNY';
}

function normalizeKeySource(ks, idx) {
  const o = isObj(ks) ? ks : {};
  let kind = String(o.kind == null ? 'file' : o.kind).trim().toLowerCase();
  if (!['dotenv', 'file', 'env'].includes(kind)) kind = 'file';
  return {
    kind,
    file: str(o.file, ''),
    var: str(o.var, ''),
  };
}

// ---- 平台派生的默认密钥路径（第 27 轮共享核心新增）----
// 共享核心要同时服务 Mac / Win 两端，所以「默认密钥文件在哪」不能写死某一端：
//   · darwin：`~/` 口径（shell 家目录简写，expandPath 再展开）
//   · win32 ：`%USERPROFILE%` 口径（Windows 环境变量，expandPath 再展开）
// 兼容口径（本轮**故意不动**）：newapi / deepseek 的 `%USERPROFILE%\...` 字面量是第 26 轮的历史值，
// 改它会让 Mac 上已有配置的解析结果变化（不是零变化），因此本轮保持原样；
// 已登记进 evidence/round27-stage0/ 待下一轮统一（届时需老板确认，属行为变更）。
const IS_WIN32 = process.platform === 'win32';
function platformSecretFile(preset) {
  if (preset === 'qoder') {
    // 规格 §3：Mac 读 ~/.dsh/secrets/qoder-pat.txt；Win 读 %USERPROFILE%\.dsh\secrets\qoder-pat.txt
    // 内容都形如 QODER_PAT=pt-…
    return IS_WIN32 ? '%USERPROFILE%\\.dsh\\secrets\\qoder-pat.txt' : '~/.dsh/secrets/qoder-pat.txt';
  }
  if (preset === 'newapi') return '%USERPROFILE%\\.dsh\\secrets\\a6-console.txt';
  if (preset === 'deepseek') return '%USERPROFILE%\\.dsh\\.env';
  return '';
}

function providerDefaultKeySource(type, preset) {
  if (type === 'rice') return { kind: 'file', file: '', var: '' };
  if (preset === 'qoder') {
    return { kind: 'file', file: platformSecretFile('qoder'), var: 'QODER_PAT' };
  }
  if (preset === 'newapi') {
    return { kind: 'file', file: platformSecretFile('newapi'), var: 'A6_CONSOLE_TOKEN' };
  }
  if (preset === 'deepseek') {
    return { kind: 'dotenv', file: platformSecretFile('deepseek'), var: 'DEEPSEEK_OFFICIAL_API_KEY' };
  }
  return { kind: 'file', file: '', var: '' };
}

function normalizeProvider(pc, idx, cfgDisplay) {
  const o = isObj(pc) ? pc : {};
  let type = String(o.type == null ? '' : o.type).trim().toLowerCase();
  // 旧值映射
  if (type === 'deepseek') type = 'official';
  if (type === 'a6_newapi') type = 'relay';
  if (!['official', 'relay', 'custom', 'rice'].includes(type)) type = 'official';
  const preset = normalizePreset(o, type);
  let endpoint = str(o.endpoint, '');
  if (type === 'official' && preset === 'qoder') {
    // Qoder 的 endpoint 是 base：用户填了就用用户的（国内/国际版），没填才落预设默认值
    if (!endpoint) endpoint = OFFICIAL_PRESETS.qoder;
  } else if (type === 'official' && OFFICIAL_PRESETS[preset]) endpoint = OFFICIAL_PRESETS[preset];
  let baseUrl = str(o.baseUrl, '');
  if (type === 'relay' && !baseUrl && /^https?:\/\//i.test(endpoint)) {
    try { const u = new URL(endpoint); baseUrl = u.origin; } catch (e) { /* ignore */ }
  }
  let statusEndpoint = str(o.statusEndpoint, '');
  if (type === 'relay' && !statusEndpoint && baseUrl) statusEndpoint = baseUrl + '/api/status';
  let threshold = null;
  if (o.threshold !== null && o.threshold !== undefined && o.threshold !== '' && type !== 'rice') {
    const t = Number(o.threshold);
    if (Number.isFinite(t) && t >= 0) threshold = round2(t);
  }
  let fullAmount = null;
  if (type !== 'rice') {
    const fa = Number(o.fullAmount);
    fullAmount = Number.isFinite(fa) && fa > 0 ? round2(fa) : null;
    // Qoder 的单位是 Credits（Pro 套餐每月 2000），沿用金额默认值 100 会让米饭永远满盆
    if (!fullAmount) fullAmount = (preset === 'qoder') ? 2000 : cfgDisplay.refYuan;
  }
  const name = str(o.name, preset === 'qoder' ? 'Qoder' : (type === 'official' ? 'DeepSeek' : 'A6')).slice(0, 24);
  // keySource：qoder 没显式给 file/var 时补 macOS 预设（其余预设保持旧行为不变）
  let keySource = normalizeKeySource(o.keySource, idx);
  const ksRaw = isObj(o.keySource) ? o.keySource : {};
  const ksEmpty = !String(ksRaw.file == null ? '' : ksRaw.file).trim()
    && !String(ksRaw.var == null ? '' : ksRaw.var).trim();
  if (preset === 'qoder' && ksEmpty) keySource = providerDefaultKeySource(type, preset);
  return {
    id: str(o.id, 'p' + idx).slice(0, 48),
    name: name || ('p' + idx),
    type,
    preset,
    endpoint,
    baseUrl,
    statusEndpoint,
    a6User: str(o.a6User, '').slice(0, 64),
    jsonPath: str(o.jsonPath, 'data.balance'),
    currency: (String(o.currency == null ? 'CNY' : o.currency).trim().toUpperCase() === 'USD') ? 'USD' : 'CNY',
    unit: normalizeUnit(o.unit, preset),
    keySource,
    threshold,
    fullAmount,
    intervalSec: int(clampNum(o.intervalSec, 10, 3600, 60), 60),
    enabled: bool(o.enabled, true),
  };
}

function normalizeConfig(raw) {
  const d = defaultConfig();
  const r = isObj(raw) ? raw : {};
  const cfg = d;
  cfg.version = 1;
  cfg.enabled = bool(r.enabled, d.enabled);
  cfg.clickThrough = bool(r.clickThrough, d.clickThrough);
  cfg.refreshSeq = int(r.refreshSeq, 0);

  const rh = isObj(r.hotkey) ? r.hotkey : {};
  cfg.hotkey = { enabled: bool(rh.enabled, d.hotkey.enabled), combo: str(rh.combo, d.hotkey.combo) };
  if (!/[A-Za-z0-9]|F([1-9]|1[0-9]|2[0-4])/.test(cfg.hotkey.combo)) cfg.hotkey.combo = d.hotkey.combo;

  const rp = isObj(r.position) ? r.position : {};
  cfg.position = {
    mode: (String(rp.mode || '').toLowerCase() === 'hug-taskbar') ? 'hug-taskbar' : 'under-feet',
    bottomGap: int(clampNum(rp.bottomGap, 0, 64, d.position.bottomGap), d.position.bottomGap),
    offsetX: int(clampNum(rp.offsetX, -3000, 3000, 0), 0),
    offsetY: int(clampNum(rp.offsetY, -3000, 3000, 0), 0),
    zOrder: (String(rp.zOrder || '').toLowerCase() === 'below-pet') ? 'below-pet' : 'topmost',
    petPort: int(clampNum(rp.petPort, 1, 65535, d.position.petPort), d.position.petPort),
    clampMargin: int(clampNum(rp.clampMargin, 0, 200, d.position.clampMargin), d.position.clampMargin),
    monitorFollow: bool(rp.monitorFollow, d.position.monitorFollow),
  };

  const rd = isObj(r.display) ? r.display : {};
  cfg.display = {
    // 第 27 轮：新增第三种显示形态 minicard（macOS 风格小面板）。
    // 未知值仍折叠成 ricebowl（保持旧行为，不会因为写错字而白屏）。
    style: (function () {
      const s = String(rd.style || '').toLowerCase();
      return (s === 'capsule' || s === 'minicard') ? s : 'ricebowl';
    })(),
    bowlStyle: normalizeBowlStyle(rd.bowlStyle),
    labelStyle: normalizeLabelStyle(rd.labelStyle),
    wear: normalizeWear(rd.wear),
    nineLayout: normalizeNineLayout(rd.nineLayout),
    compactAfter: int(clampNum(rd.compactAfter, 2, 9, d.display.compactAfter), d.display.compactAfter),
    refYuan: round2(clampNum(rd.refYuan, 0.01, 1000000, d.display.refYuan)),
    wheels: bool(rd.wheels, d.display.wheels),
    petScaleRef: clampNum(rd.petScaleRef, 0.4, 4.0, d.display.petScaleRef),
    graphicsMin: clampNum(rd.graphicsMin, 0.3, 3.0, d.display.graphicsMin),
    graphicsMax: clampNum(rd.graphicsMax, 0.3, 4.0, d.display.graphicsMax),
    // 整体缩放百分比：40–200（100=不变；下限 40 防止缩到看不清，上限 200 给放大留余量）
    // 注意：clampNum/int 会把 null 当 0 处理（Number(null)===0）→ 落成下限 40，
    // 等于「配置写了 null 饭桶突然缩一半」。故与 normalizeKeySource 等处一致，显式把 null/'' 视作未设置。
    sizePct: int(clampNum((rd.sizePct == null || rd.sizePct === '') ? undefined : rd.sizePct,
      40, 200, d.display.sizePct), d.display.sizePct),
    logo: bool(rd.logo, false),
    logoStyle: str(rd.logoStyle, 'deepseek'),
  };
  // 硬性可读下限：graphicsMin 至少 0.95（与 X 实现一致）
  if (cfg.display.graphicsMin < 0.95) cfg.display.graphicsMin = 0.95;
  if (cfg.display.graphicsMax < cfg.display.graphicsMin) cfg.display.graphicsMax = 2.0;
  // head 强制无轮（配置值保留在 raw 里；归一化后的 display.wheels 仍保留，渲染时按 wear 判定）
  if (cfg.display.wear === 'head' && cfg.display.wheels) {
    // 保留值，不在此处清零（渲染/布局时按 head 强制 WheelH=0）
  }

  const rt = isObj(r.theme) ? r.theme : {};
  cfg.theme = {
    follow: bool(rt.follow, d.theme.follow),
    port: int(clampNum(rt.port, 1, 65535, d.theme.port), d.theme.port),
    statePort: int(clampNum(rt.statePort, 1, 65535, d.theme.statePort), d.theme.statePort),
    force: ['dark', 'light'].includes(String(rt.force || '').toLowerCase()) ? String(rt.force).toLowerCase() : '',
    pollMs: int(clampNum(rt.pollMs, 1000, 30000, d.theme.pollMs), d.theme.pollMs),
  };

  const ri = isObj(r.interaction) ? r.interaction : {};
  cfg.interaction = {
    expandOnClick: bool(ri.expandOnClick, d.interaction.expandOnClick),
    // #1 晃晕唤出：全部字段有默认值，旧配置不写 interaction.shake 也能用（enabled 默认 true）
    shake: normalizeShake(ri.shake),
  };

  const rc = isObj(r.capsule) ? r.capsule : {};
  cfg.capsule = {
    width: int(clampNum(rc.width, 80, 600, d.capsule.width), d.capsule.width),
    height: int(clampNum(rc.height, 16, 120, d.capsule.height), d.capsule.height),
    overlap: int(clampNum(rc.overlap, 0, 30, d.capsule.overlap), d.capsule.overlap),
    maxProviders: int(clampNum(rc.maxProviders, 1, 9, d.capsule.maxProviders), d.capsule.maxProviders),
  };
  const rf = isObj(r.liveFollow) ? r.liveFollow : {};
  cfg.liveFollow = {
    detectMs: int(clampNum(rf.detectMs, 100, 5000, d.liveFollow.detectMs), d.liveFollow.detectMs),
    smooth: bool(rf.smooth, true),
  };
  const rl = isObj(r.petLift) ? r.petLift : {};
  cfg.petLift = { enabled: bool(rl.enabled, true) };

  // providers：最多 9 家；空数组回退默认 2 家（Win 口径）
  let arr = Array.isArray(r.providers) ? r.providers : null;
  if (!arr || arr.length === 0) {
    arr = [
      { id: 'deepseek', name: 'DeepSeek', type: 'official', preset: 'deepseek', threshold: 5, fullAmount: 100, intervalSec: 60, enabled: true },
      { id: 'a6', name: 'A6', type: 'relay', preset: 'newapi', a6User: '', threshold: 5, fullAmount: 100, intervalSec: 60, enabled: true },
    ];
  }
  const seen = new Set();
  const providers = [];
  for (let i = 0; i < Math.min(arr.length, MAX_PROVIDERS); i++) {
    const p = normalizeProvider(arr[i], i, cfg.display);
    let pid = p.id || ('p' + i);
    if (seen.has(pid)) pid = pid + '-' + (i + 1);
    seen.add(pid);
    p.id = pid;
    providers.push(p);
  }
  cfg.providers = providers;
  return cfg;
}

// ---------------- 配置目录 / 环境变量（2026-11-02 改名：glutton-balance）----------------
// 口径：新变量 GLUTTONBALANCE_PANEL_DIR/CONFIG/LOG 优先；旧变量 PET_BALANCE_PANEL_* 保留为兼容回退。
// 默认目录：~/.dsh/glutton-balance；旧目录 ~/.dsh/pet-balance-panel 只在首次启动迁移时读取。
const ENV_DIR = 'GLUTTONBALANCE_PANEL_DIR';
const ENV_CONFIG = 'GLUTTONBALANCE_PANEL_CONFIG';
const ENV_LOG = 'GLUTTONBALANCE_PANEL_LOG';
const LEGACY_ENV_DIR = 'PET_BALANCE_PANEL_DIR';
const LEGACY_ENV_CONFIG = 'PET_BALANCE_PANEL_CONFIG';
const LEGACY_ENV_LOG = 'PET_BALANCE_PANEL_LOG';
const DEFAULT_DIR = path.join(os.homedir(), '.dsh', 'glutton-balance');
const LEGACY_DIR = path.join(os.homedir(), '.dsh', 'pet-balance-panel');

function envFirst(newName, legacyName) {
  const v = process.env[newName];
  if (v) return v;
  const old = legacyName ? process.env[legacyName] : '';
  return old || '';
}

function configPath() {
  const override = envFirst(ENV_CONFIG, LEGACY_ENV_CONFIG);
  if (override) return override;
  return path.join(userDir(), 'config.json');
}

function userDir() {
  return envFirst(ENV_DIR, LEGACY_ENV_DIR) || DEFAULT_DIR;
}

// 递归复制、只补缺不覆盖（迁移必须幂等，且不动新目录已有文件）
function copyTreeNoOverwrite(src, dst, base, copied) {
  let st;
  try { st = fs.statSync(src); } catch (e) { return; }
  if (st.isDirectory()) {
    try { fs.mkdirSync(dst, { recursive: true, mode: 0o700 }); } catch (e) { return; }
    let names = [];
    try { names = fs.readdirSync(src); } catch (e) { return; }
    for (const name of names) copyTreeNoOverwrite(path.join(src, name), path.join(dst, name), base, copied);
    return;
  }
  if (!st.isFile()) return;
  if (fs.existsSync(dst)) return; // 幂等：新目录已有同名文件就跳过
  try {
    fs.copyFileSync(src, dst);
    try { fs.chmodSync(dst, st.mode & 0o700); } catch (e) { /* 权限失败不影响迁移 */ }
    copied.push(path.relative(base, dst));
  } catch (e) { /* 单个文件失败不阻断整体迁移 */ }
}

/**
 * 首次启动：旧目录 → 新目录一次性迁移（改名兼容，2026-11-02）。
 * 规则：只在用默认位置时做；新目录已有 config.json 或旧目录没有 config.json 就不做；
 * 复制 config.json、bowls/、rice/（递归）；不覆盖新目录已有文件；旧目录原样保留；幂等。
 * 返回值给 main.js 打一行日志用（本函数不直接写日志，避免循环依赖）。
 */
function migrateLegacyUserData() {
  const res = { migrated: false, from: LEGACY_DIR, to: DEFAULT_DIR, copied: [], reason: '' };
  try {
    if (envFirst(ENV_DIR, LEGACY_ENV_DIR)) { res.reason = 'env-dir'; return res; }
    const legacyCfg = path.join(LEGACY_DIR, 'config.json');
    const newCfg = path.join(DEFAULT_DIR, 'config.json');
    if (fs.existsSync(newCfg)) { res.reason = 'already-migrated'; return res; }
    if (!fs.existsSync(legacyCfg)) { res.reason = 'no-legacy-config'; return res; }
    fs.mkdirSync(DEFAULT_DIR, { recursive: true, mode: 0o700 });
    copyTreeNoOverwrite(legacyCfg, newCfg, DEFAULT_DIR, res.copied);
    copyTreeNoOverwrite(path.join(LEGACY_DIR, 'bowls'), path.join(DEFAULT_DIR, 'bowls'), DEFAULT_DIR, res.copied);
    copyTreeNoOverwrite(path.join(LEGACY_DIR, 'rice'), path.join(DEFAULT_DIR, 'rice'), DEFAULT_DIR, res.copied);
    res.migrated = res.copied.length > 0;
  } catch (e) {
    res.reason = 'error:' + String((e && e.message) || e);
  }
  return res;
}

function readConfigFile(p) {
  try {
    const st = fs.statSync(p);
    const text = fs.readFileSync(p, 'utf8');
    const raw = JSON.parse(text);
    return { ok: true, raw, mtimeMs: st.mtimeMs, error: '' };
  } catch (e) {
    return { ok: false, raw: null, mtimeMs: 0, error: String(e && e.message || e) };
  }
}

// 展开 ~ / $HOME / %VAR% 形式的路径
function expandPath(p) {
  if (!p) return '';
  let s = String(p);
  if (s.startsWith('~')) s = os.homedir() + s.slice(1);
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => process.env[name] || '');
  s = s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => process.env[name] || '');
  return s;
}

module.exports = {
  defaultConfig, normalizeConfig, configPath, userDir, readConfigFile, expandPath,
  migrateLegacyUserData, OFFICIAL_PRESETS, MAX_PROVIDERS,
  providerDefaultKeySource, normalizeProvider, normalizeUnit,
  ENV_DIR, ENV_CONFIG, ENV_LOG, LEGACY_ENV_DIR, LEGACY_ENV_CONFIG, LEGACY_ENV_LOG,
};
