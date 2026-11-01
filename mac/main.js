'use strict';
// 饭桶余额 · Mac 显示窗（Electron 主进程）
// 结构：配置(只读热载) / 定位(petprobe 截图扫描) / 主题轮询 / 余额抓取 / 渲染状态下发 / 60fps 跟随 / 点击穿透 / 权限引导 / 出图与自测
const { app, BrowserWindow, ipcMain, screen, systemPreferences, shell, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');

const configMod = require('./src/config');
const layoutMod = require('./src/layout');
const styleMod = require('./src/style');
const { PetLocator } = require('./src/petinfo');
const { ProviderManager, demoViews } = require('./src/providers');
const { computePlacement } = require('./src/position');
const logger = require('./src/logger');

const APP_ROOT = __dirname;
const APP_NAME = '饭桶余额';
const APP_VERSION = '0.1.0';
const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const RENDERER_HTML = process.env.PBP_RENDERER || path.join(APP_ROOT, 'renderer', 'index.html');
const PRELOAD = path.join(APP_ROOT, 'preload.js');
const PETPROBE = path.join(APP_ROOT, 'native', 'petprobe');
const GUIDE_HTML = path.join(APP_ROOT, 'permission.html');

// ---------------- 参数 ----------------
function parseArgs(argv) {
  const out = { shot: false, shotDir: '', selftest: '', demo: 0, config: '', quit: false, guide: false, capture: '', captureWait: 6, click: '', capture2: '', autostart: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shot') { out.shot = true; out.shotDir = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : ''; }
    else if (a === '--selftest') { out.selftest = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : path.join(APP_ROOT, 'selftest.json'); }
    else if (a === '--demo') { out.demo = parseInt(argv[++i] || '0', 10) || 0; }
    else if (a === '--config') { out.config = argv[++i] || ''; }
    else if (a === '--quit') { out.quit = true; }
    else if (a === '--guide') { out.guide = true; }
    else if (a === '--autostart') { out.autostart = true; }
    else if (a === '--capture') { out.capture = argv[i + 1] || ''; if (out.capture) i++; }
    else if (a === '--capture-wait') { out.captureWait = parseInt(argv[++i] || '6', 10) || 6; }
    else if (a === '--click') { out.click = argv[++i] || ''; }
    else if (a === '--capture2') { out.capture2 = argv[++i] || ''; }
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(1));

// ---------------- 全局状态 ----------------
let cfg = null;
let lastAppliedCharW = -1000; // 最近一次生效的 graphicsScale（匹配比例）
let rawCfg = null;
let configMtime = 0;
let configPathUsed = '';
let demoMode = false;
let assets = { map: {}, order: [] };
let assetSignature = '';
let petScale = 1.05;
let themeState = { theme: 'dark', palettes: null, style: null };
let locator = null;
let providerMgr = null;
let panelWin = null;
let guideWin = null;
let tray = null;
let expanded = false;
let seq = 0;
let lastRenderedSeq = 0;
let lastContentKey = '';
let panelSize = { w: 1, h: 1 };
let anim = { x: null, y: null, vx: 0, vy: 0 };
let lastPos = { x: null, y: null };
let fallbackDisplayId = null;
let loopStopped = false;
let startedAt = Date.now();
let stateCache = null;
let wheelAngle = 0;
let lastWheelSend = 0;
let renderedWaiters = new Map();
let shotMode = !!ARGS.shot;
let shotOutDir = '';
let trayQuitRequested = false;

function displayScaleOf(win) {
  try {
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    return d && d.scaleFactor ? d.scaleFactor : 2;
  } catch (e) { return 2; }
}

// ---------------- 老板拍板（2026-11-01 07:24）----------------
// ① 数值口径选 A：允许读本机 ~/.dsh/.env 的 DeepSeek key 直接查官方余额（config.providers[].keySource 已指向 DEEPSEEK_API_KEY）。
// ② 尺寸「匹配比例」：盆宽 = 实测角色宽 × 0.80（见 src/layout.js graphicsScale）。
// ③ 脚下形态先不做（Mac 暂时无这个选项）：配置里即使写了 feet 也强制按 head 渲染。
function enforceMacDecisions(where) {
  if (!cfg) return;
  if (cfg.display.wear !== 'head') {
    logger.write(`WARN boss-decision 2026-11-01-0724 Mac 本轮不做脚下形态（${where} wear=${cfg.display.wear}）→ 强制 head`);
    cfg.display.wear = 'head';
  }
}

// 实测角色宽（pt）中值（最近 7 帧）：待机呼吸动画会让 bbox 宽抖 ±1~2pt，中值消抖。
// 再「锁定」基准宽：只有持续偏离 >8%（约 20 帧≈0.32s，例如换皮肤/改桌宠缩放）才重新定基准，
// 保证面板大小稳定、不跟着动画一帧一变大变小。
const charWHist = [];
let lockedCharW = NaN;
let charWDrift = 0;

// ---------------- 拖拽抖动抑制（第 3 轮 A4；对应 B1 §3 已知现象）----------------
// 现象：Coopanion 拖拽时会把桌宠「提起」（B1 实测角色宽 87.5→140.5pt、角色高 108→152pt），
//       「匹配比例 + 中值锁定」跟着重定基准 → 盆宽 70pt 瞬时变大（窗口 147→235pt），约 0.8s 回稳。
// 修法（最小改动）：检测到「拖拽瞬态」就冻结 scale —— 冻结期间不采样角色宽、不累计重定基准帧数、
//       不重排面板，盆宽保持原值；松手后（不再检测到移动）再保持 DRAG_HOLD_MS 才解冻。
//       冻结只是「不更新」：锁定基准没被改写 → 解冻后也不跳变，即「平滑恢复」。
// 触发（二选一，任一即冻结）：
//   ① 桌宠在动：相邻 petprobe 采样间本体中心/头顶位移 > 3pt（拖拽中持续触发，覆盖整段拖拽）；
//   ② 角色宽突变：上一采样还在基准附近、这一采样突然偏离 >15%（拖拽提起第一帧；20 帧重定基准约需
//      0.32s，若等「位移」确认可能被抢跑，用突变先兜住）。
// 静止时的真实尺寸变化（换皮肤/改桌宠缩放）通常是「持续偏离」而非「位移/突变」：解冻后仍按原逻辑
//       重定基准（代价是比改前晚约 0.7s 生效，只在改设置时可见；跟随/穿透/主题等行为不变，见报告 §5）。
const DRAG_MOVE_PT = 3;          // 相邻采样位移阈值（pt）
const DRAG_HOLD_MS = 700;        // 最后一次拖拽瞬态后再冻结的时长（ms）
const CHARW_JUMP_RATIO = 0.15;   // 角色宽「突变」阈值（相对锁定基准）
let scaleFrozen = false;         // 当前是否冻结 scale
let scaleFrozenUntil = 0;        // 冻结截止时间（Date.now() ms）
let scaleFrozenAt = 0;           // 本次冻结开始时间（ms，日志用）
let sampleLineSeen = -1;         // 已处理的 petprobe 采样行号（同一条采样在 60fps 循环里会重复出现）
let lastSamplePos = null;        // 上一条采样的桌宠位置 { cx, headY }
let lastSampleDeviated = false;  // 上一条采样的角色宽是否已偏离锁定基准 >8%

function petSampleTick(now) {
  if (locator && locator.lines !== sampleLineSeen) {
    sampleLineSeen = locator.lines;
    const i = locator.info || {};
    const cx = Number(i.bodyCenterPt);
    const hy = Number(i.headPt);
    const cw = Number(i.charWpt);
    // ① 位移检测：桌宠本体中心（x）/头顶（y）在相邻采样间移动 → 拖拽
    if (cx > 0 && hy > 0) {
      if (lastSamplePos && (Math.abs(cx - lastSamplePos.cx) > DRAG_MOVE_PT || Math.abs(hy - lastSamplePos.headY) > DRAG_MOVE_PT)) {
        scaleFrozenUntil = now + DRAG_HOLD_MS;
      }
      lastSamplePos = { cx: cx, headY: hy };
    }
    // ② 角色宽突变检测：拖拽提起的第一帧
    let deviated = false;
    if (Number.isFinite(cw) && cw > 20 && Number.isFinite(lockedCharW) && lockedCharW > 20) {
      deviated = Math.abs(cw - lockedCharW) / lockedCharW > 0.08;
      if (deviated && !lastSampleDeviated) {
        const jump = Math.abs(cw - lockedCharW) / lockedCharW > CHARW_JUMP_RATIO;
        if (jump) scaleFrozenUntil = now + DRAG_HOLD_MS;
      }
    }
    lastSampleDeviated = deviated;
  }
  // 冻结状态切换（每个位置循环都判一次：petprobe 短暂无新采样也能按时解冻；panel.log 有 begin/end 行）
  const frozen = now < scaleFrozenUntil;
  if (frozen !== scaleFrozen) {
    scaleFrozen = frozen;
    const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : 'NaN');
    if (frozen) {
      scaleFrozenAt = now;
      const cw = locator && locator.info ? Number(locator.info.charWpt) : NaN;
      logger.write(`scale freeze begin（拖拽瞬态：冻结盆宽基准 charW=${f1(cw)} locked=${f1(lockedCharW)}）`);
    } else {
      charWDrift = 0;
      logger.write(`scale freeze end（冻结 ${now - scaleFrozenAt}ms，基准 locked=${f1(lockedCharW)} 未变 → 盆宽平滑恢复）`);
    }
  }
}

function updateCharW() {
  if (scaleFrozen) { charWDrift = 0; return; } // 拖拽瞬态：不采样、不累计重定基准帧数
  try {
    const cw = locator && locator.info ? locator.info.charWpt : NaN;
    if (Number.isFinite(cw) && cw > 20) {
      charWHist.push(cw);
      if (charWHist.length > 7) charWHist.shift();
    }
  } catch (e) { /* ignore */ }
}
function currentCharW() {
  if (scaleFrozen && Number.isFinite(lockedCharW)) return lockedCharW; // 冻结期间保持原基准（盆宽不变）
  if (!charWHist.length) return NaN;
  const a = charWHist.slice().sort((x, y) => x - y);
  const med = a[Math.floor(a.length / 2)];
  if (!Number.isFinite(lockedCharW)) { lockedCharW = med; return lockedCharW; }
  if (Math.abs(med - lockedCharW) / lockedCharW > 0.08) {
    charWDrift++;
    if (charWDrift >= 20) { lockedCharW = med; charWDrift = 0; }
  } else {
    charWDrift = 0;
  }
  return lockedCharW;
}

// ---------------- 配置 ----------------
function loadConfig() {
  const p = ARGS.config || configMod.configPath();
  configPathUsed = p;
  const r = configMod.readConfigFile(p);
  if (r.ok) {
    rawCfg = r.raw;
    cfg = configMod.normalizeConfig(r.raw);
    configMtime = r.mtimeMs;
    demoMode = false;
    logger.write(`config loaded path=${p} providers=${cfg.providers.length} mode=${cfg.position.mode} zOrder=${cfg.position.zOrder} clickThrough=${cfg.clickThrough} refreshSeq=${cfg.refreshSeq} wear=${cfg.display.wear} nineLayout=${cfg.display.nineLayout} bowl=${cfg.display.bowlStyle} label=${cfg.display.labelStyle} gsMin=${cfg.display.graphicsMin}`);
  } else {
    demoMode = true;
    cfg = configMod.normalizeConfig({
      providers: [
        { id: 'demo1', name: '大白饭', type: 'rice', threshold: null, intervalSec: 60, enabled: true },
        { id: 'demo2', name: '大白饭', type: 'rice', threshold: null, intervalSec: 60, enabled: true },
        { id: 'demo3', name: '大白饭', type: 'rice', threshold: null, intervalSec: 60, enabled: true },
      ],
    });
    configMtime = 0;
    logger.write(`config missing/invalid path=${p} err=${r.error} -> demo mode 3 rice bowls`);
  }
  if (ARGS.demo > 0) { demoMode = true; }
  enforceMacDecisions('loadConfig');
}

function checkConfigReload() {
  if (shotMode) return;
  try {
    const p = configPathUsed;
    if (!fs.existsSync(p)) { if (!demoMode) { loadConfig(); applyAfterConfigChange(); } return; }
    const st = fs.statSync(p);
    if (st.mtimeMs !== configMtime) {
      loadConfig();
      applyAfterConfigChange();
      logger.write(`config reloaded refreshSeq=${cfg.refreshSeq} wear=${cfg.display.wear} nineLayout=${cfg.display.nineLayout} count=${cfg.providers.length}`);
    }
  } catch (e) { /* ignore */ }
}

function applyAfterConfigChange() {
  enforceMacDecisions('reload');
  if (providerMgr) { providerMgr.configure(cfg); }
  if (petScale <= 0.2) petScale = 1.05;
  expanded = false;
  // 点击穿透开关
  if (panelWin) {
    try { panelWin.setIgnoreMouseEvents(!!cfg.clickThrough, { forward: true }); } catch (e) { /* ignore */ }
  }
  registerHotkey();
  if (!cfg.enabled && panelWin) panelWin.hide();
  if (cfg.enabled && panelWin && !panelWin.isVisible()) panelWin.showInactive();
  requestState(true);
}

// ---------------- 素材 ----------------
function pngSize(buf) {
  try {
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function scanAssets() {
  const map = {};
  const order = [];
  const dirs = [path.join(configMod.userDir(), 'bowls'), path.join(ASSETS_DIR, 'bowls')];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of files.sort()) {
      if (!/\.json$/i.test(f)) continue;
      const id = f.replace(/\.json$/i, '');
      if (map[id]) continue; // 用户目录优先
      try {
        const jsonPath = path.join(dir, f);
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const frontName = id + '.png';
        const frontPath = path.join(dir, frontName);
        if (!fs.existsSync(frontPath)) continue;
        const frontBuf = fs.readFileSync(frontPath);
        const size = pngSize(frontBuf) || { w: 320, h: 290 };
        const backName = meta.back || (id + '-back.png');
        const backPath = path.join(dir, backName);
        const hasBack = fs.existsSync(backPath);
        const rice = meta.rice || null;
        const a = {
          id,
          name: meta.name || id,
          pixelW: size.w, pixelH: size.h,
          rice: rice ? { x: rice.x, y: rice.y, w: rice.w, h: rice.h } : null,
          rimY: Number(meta.rimY) > 0 ? Number(meta.rimY) : null,
          rimBottom: Number(meta.rimBottom) > 0 ? Number(meta.rimBottom) : null,
          front: frontName,
          back: hasBack ? backName : null,
          frontUrl: pathToFileURL(frontPath).href,
          backUrl: hasBack ? pathToFileURL(backPath).href : null,
        };
        if (!a.rice) {
          a.rice = { x: Math.round(size.w * 0.225), y: Math.round(size.h * 0.215), w: Math.round(size.w * 0.55), h: Math.round(size.h * 0.58) };
        }
        if (!(a.rimY > 0)) a.rimY = Math.round(size.h * 0.42);
        if (!(a.rimBottom > 0)) a.rimBottom = a.rimY + (size.h - a.rimY) * 0.33;
        map[id] = a;
        order.push(id);
      } catch (e) { /* ignore bad json */ }
    }
  }
  // rice 素材
  const riceDir = path.join(ASSETS_DIR, 'rice');
  let riceMaster = null, riceFrames = [];
  try {
    if (fs.existsSync(path.join(riceDir, 'rice-master.png'))) {
      const b = fs.readFileSync(path.join(riceDir, 'rice-master.png'));
      riceMaster = { file: 'rice-master.png', w: (pngSize(b) || { w: 400, h: 263 }).w, h: (pngSize(b) || { w: 400, h: 263 }).h };
    }
    riceFrames = fs.readdirSync(riceDir).filter(f => /^rice-\d+\.png$/.test(f)).sort();
  } catch (e) { /* ignore */ }
  const sig = JSON.stringify({ ids: order, master: riceMaster, frames: riceFrames.length });
  assets = { map, order, riceMaster, riceFrames, assetDir: pathToFileURL(ASSETS_DIR).href, signature: sig };
  return sig !== assetSignature;
}

function assetPayload() {
  const out = {};
  for (const id of assets.order) out[id] = assets.map[id];
  out.__riceMaster = assets.riceMaster;
  out.__riceFrames = assets.riceFrames;
  out.__assetDir = assets.assetDir;
  return out;
}

function checkAssetReload() {
  if (shotMode) return;
  const oldSig = assetSignature;
  const changed = scanAssets();
  assetSignature = assets.signature;
  if (changed && oldSig) {
    logger.write('bowl reload sig=' + assets.signature.slice(0, 120));
    if (panelWin) panelWin.webContents.send('pbp:init', { assetDir: assets.assetDir, assets: assetPayload() });
    requestState(true);
  }
}

// ---------------- HTTP 小工具 ----------------
function httpJson(url, timeoutMs, headers) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''), method: 'GET',
      headers: Object.assign({ 'User-Agent': 'PetBalancePanel/1.0 (Mac)', 'Accept': 'application/json', 'Connection': 'close' }, headers || {}),
      timeout: timeoutMs || 1500,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json')); }
        } else reject(new Error('HTTP ' + res.statusCode));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ---------------- 主题 ----------------
async function pollTheme() {
  if (shotMode || loopStopped) return;
  try {
    const stateJ = await httpJson(`http://127.0.0.1:${cfg.theme.statePort}/api/state`, 1500);
    if (stateJ && typeof stateJ.theme === 'string' && stateJ.theme) themeState.theme = stateJ.theme.toLowerCase();
  } catch (e) { /* state 端口失败时保持上次主题 */ }
  let themeJ = null;
  try { themeJ = await httpJson(`http://127.0.0.1:${cfg.theme.port}/api/theme`, 2500); } catch (e) { themeJ = null; }
  themeState.palettes = themeJ ? styleMod.parseThemePalettes(themeJ) : null;
  let st;
  if (!cfg.theme.follow && !cfg.theme.force) {
    // Win 口径：follow=false 且无 force → 保持初始深色回退样式
    st = styleMod.buildStyle({ theme: 'dark', force: '', palettes: null });
  } else {
    st = styleMod.buildStyle({ theme: themeState.theme, force: cfg.theme.force, palettes: themeState.palettes });
  }
  const prevKey = themeState.style ? themeState.style.key : '';
  themeState.style = st;
  if (st.key !== prevKey) {
    logger.write(`theme apply src=${st.paletteSource} theme=${st.theme} selectedId=${st.selectedId} force=${cfg.theme.force} bowl=${cfg.display.bowlStyle}`);
    requestState(true);
  }
}

async function pollPetState() {
  if (shotMode || loopStopped) return;
  try {
    const j = await httpJson(`http://127.0.0.1:${cfg.position.petPort}/api/state`, 1500);
    if (j && Number.isFinite(Number(j.scale)) && Number(j.scale) > 0) {
      const ns = Number(j.scale);
      if (Math.abs(ns - petScale) > 0.001) {
        petScale = ns;
        logger.write(`scale apply petScale=${petScale} petScaleRef=${cfg.display.petScaleRef} charW=${currentCharW()} graphicsScale=${layoutMod.graphicsScale(cfg, petScale, currentCharW()).toFixed(3)}`);
        requestState(true);
      }
    }
  } catch (e) { /* 桌宠接口失败保持上次 */ }
}

// ---------------- 状态构建 ----------------
function amountText(v) {
  if (v.rice) return '满盆金额';
  if (!v.hasResult || !v.ok) return '连接失败';
  const sym = (v.currency === 'USD') ? '$' : '¥';
  const n = Number(v.amount);
  return sym + (Number.isFinite(n) ? n.toFixed(2) : '0.00');
}

function buildDetail(views, w, h) {
  const rows = views.map(v => {
    let sub;
    if (v.rice) sub = '大白饭档 · 不联网 · 永远满盆';
    else {
      const th = (v.threshold == null) ? '阈值 无' : ('阈值 ¥' + Number(v.threshold).toFixed(2));
      let recent = '等待刷新';
      if (v.hasResult && v.ok) recent = '成功';
      else if (v.hasResult) recent = '失败';
      sub = `${th} · 每 ${v.intervalSec}s 刷新 · 最近 ${recent}`;
    }
    return { name: v.name, amountText: amountText(v), low: v.low, ok: v.ok, rice: v.rice, sub };
  });
  return { w, h, rows, title: '余额明细 · 点击面板收起', footer: '窗口置顶 · 点击面板收起' };
}

function pickAssetFor(cfgV) {
  const c = cfgV || cfg;
  const id = c.display.bowlStyle;
  if (assets.map[id]) return assets.map[id];
  const raw = String(id || '');
  if (/^custom:/i.test(raw)) {
    const name = raw.slice(7);
    if (assets.map[name]) return assets.map[name];
  }
  return assets.map.porcelain || assets.map.black || Object.values(assets.map)[0] || {
    id: 'porcelain', pixelW: 320, pixelH: 290, rice: { x: 44, y: 8, w: 232, h: 276 }, rimY: 54, rimBottom: 80,
  };
}

function pickAsset() {
  const id = cfg.display.bowlStyle;
  if (assets.map[id]) return assets.map[id];
  const raw = String(id || '');
  if (/^custom:/i.test(raw)) {
    const name = raw.slice(7);
    if (assets.map[name]) return assets.map[name];
  }
  return assets.map.porcelain || assets.map.black || Object.values(assets.map)[0] || {
    id: 'porcelain', pixelW: 320, pixelH: 290, rice: { x: 44, y: 8, w: 232, h: 276 }, rimY: 54, rimBottom: 80,
  };
}

let capsuleWarned = false;
function composeState(opts) {
  const o = opts || {};
  let cfgV = o.cfg || cfg;
  if (cfgV.display && cfgV.display.style === 'capsule') {
    // Mac 不实现 v2 胶囊回退形态：按 ricebowl 渲染并记日志（读入不崩）
    cfgV = Object.assign({}, cfgV, { display: Object.assign({}, cfgV.display, { style: 'ricebowl' }) });
    if (!capsuleWarned) { capsuleWarned = true; logger.write('WARN display.style=capsule 未实现，Mac 按 ricebowl 渲染'); }
  }
  const views = o.views || (providerMgr ? providerMgr.views() : demoViews(3, 'normal'));
  const n = views.length;
  const head = layoutMod.isHead(cfgV);
  const asset = o.asset || pickAssetFor(cfgV);
  const gs = (o.graphicsScale != null) ? o.graphicsScale : layoutMod.graphicsScale(cfgV, petScale, currentCharW());
  const lay = layoutMod.computeLayout(cfgV, n, 1, gs, asset, head);
  lay.wheelAngle = (o.wheelAngle != null) ? o.wheelAngle : wheelAngle;
  const style = o.style || themeState.style || styleMod.buildStyle({ theme: 'dark', force: '', palettes: null });
  const wantExpand = (o.expanded != null) ? o.expanded : expanded;
  const canExpand = !cfgV.clickThrough && cfgV.interaction.expandOnClick && cfgV.display.style === 'ricebowl';
  const mode = (wantExpand && canExpand) ? 'detail' : 'bowls';
  let size;
  let detail = null;
  if (mode === 'detail') {
    const s = 1;
    const w = Math.round(Math.max(240 * s, Math.min(lay.groupW, 460 * s)));
    const h = Math.round(34 * s + n * 30 * s + 24 * s);
    detail = buildDetail(views, w, h);
    size = { w, h };
  } else {
    size = { w: lay.groupW, h: lay.groupH };
  }
  const dpr = o.dpr || (panelWin && !panelWin.isDestroyed() ? displayScaleOf(panelWin) : 2);
  const st = {
    seq: ++seq,
    mode,
    canvas: { w: size.w, h: size.h, dpr },
    cfg: { display: cfgV.display, interaction: cfgV.interaction },
    style,
    layout: lay,
    views,
    expanded: mode === 'detail',
    detail,
    assets: o.includeAssets ? assetPayload() : undefined,
  };
  return { state: st, size };
}

function contentKeyOf(state) {
  const views = state.views.map(v => [v.id, v.name, v.amount, v.ok, v.hasResult, v.low, v.rice, +Number(v.ratio).toFixed(3)].join('|')).join(';');
  const lay = state.layout;
  return [
    state.mode, state.expanded ? 1 : 0, state.canvas.w, state.canvas.h, state.canvas.dpr,
    state.style.key, state.cfg.display.labelStyle, state.cfg.display.wear, state.cfg.display.nineLayout,
    state.cfg.display.bowlStyle, state.cfg.display.compactAfter, state.layout.wheelH, lay.groupW, lay.groupH,
    lay.plaque ? lay.plaque.plaqueW : '', lay.slots.length, views, state.style.theme,
  ].join('#');
}

function sendState(force, opts) {
  if (!panelWin || panelWin.isDestroyed()) return null;
  const composed = composeState(opts || {});
  const key = contentKeyOf(composed.state);
  if (!force && key === lastContentKey) return composed;
  lastContentKey = key;
  stateCache = composed;
  if (composed.size.w !== panelSize.w || composed.size.h !== panelSize.h) {
    panelSize = { w: composed.size.w, h: composed.size.h };
    try { panelWin.setSize(panelSize.w, panelSize.h, false); } catch (e) { /* ignore */ }
  }
  try { panelWin.webContents.send('pbp:state', composed.state); } catch (e) { /* ignore */ }
  return composed;
}

function requestState(force, opts) {
  if (shotMode) return;
  sendState(!!force, opts || {});
}

// ---------------- 点击穿透 / 交互 ----------------
function onPanelClick() {
  if (!cfg || cfg.clickThrough) return;
  if (!cfg.interaction.expandOnClick) return;
  if (cfg.display.style === 'capsule') return;
  expanded = !expanded;
  logger.write('interact ' + (expanded ? 'expand' : 'collapse') + ' source=click');
  requestState(true);
}

function setupIpc() {
  ipcMain.on('pbp:rendered', (_e, s) => {
    lastRenderedSeq = Number(s) || 0;
    const w = renderedWaiters.get(lastRenderedSeq);
    if (w) { renderedWaiters.delete(lastRenderedSeq); w(); }
  });
  ipcMain.on('pbp:ready', () => {
    // 注意：渲染器每次收到 init 都会回 ready（防御性实现）→ 这里绝不能再发 init，否则死循环。
    // init（资源清单）只在 did-finish-load 时发一次；ready 只触发一次状态下发。
    requestState(true);
  });
  ipcMain.on('pbp:click', () => onPanelClick());
  ipcMain.on('pbp:hover', (_e, inside) => {
    if (!panelWin || panelWin.isDestroyed()) return;
    if (!cfg || cfg.clickThrough) return;
    try { panelWin.setIgnoreMouseEvents(!inside, { forward: true }); } catch (e) { /* ignore */ }
  });
  ipcMain.on('pbp:log', (_e, msg) => logger.write('renderer ' + String(msg).slice(0, 300)));
  ipcMain.on('guide:open-settings', (_e, which) => openPrivacySettings(which));
  ipcMain.on('guide:retry', () => {
    const ok = checkScreenPermission();
    if (guideWin && !guideWin.isDestroyed()) {
      try { guideWin.webContents.send('guide:status', ok ? '已授权，正在启动显示窗…' : '还没检测到授权。请在系统设置里勾选「饭桶余额」，然后回到这里点「重新检测」。'); } catch (e) { /* ignore */ }
    }
    if (ok) { setTimeout(() => { if (guideWin && !guideWin.isDestroyed()) guideWin.close(); startPanelIfReady(); }, 600); }
  });
}

function openPrivacySettings(which) {
  const url = which === 'accessibility'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
  try { shell.openExternal(url); } catch (e) { /* ignore */ }
}

function checkScreenPermission() {
  try {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.getMediaAccessStatus('screen') === 'granted';
  } catch (e) { return true; }
}

// ---------------- 权限引导窗 ----------------
function showGuideWindow(reason) {
  if (guideWin && !guideWin.isDestroyed()) { guideWin.showInactive(); return; }
  logger.write('permission guide shown reason=' + reason);
  guideWin = new BrowserWindow({
    width: 480, height: 470, show: false, resizable: false, minimizable: false, maximizable: false,
    title: '饭桶余额 · 权限引导', backgroundColor: '#121214',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  guideWin.loadFile(GUIDE_HTML);
  guideWin.once('ready-to-show', () => guideWin.show());
  guideWin.on('closed', () => { guideWin = null; });
}

// ---------------- 面板窗口 ----------------
function createPanelWindow() {
  const head = layoutMod.isHead(cfg);
  const gs = layoutMod.graphicsScale(cfg, petScale, currentCharW());
  const lay = layoutMod.computeLayout(cfg, Math.max(1, (providerMgr ? providerMgr.views().length : 3)), 1, gs, pickAsset(), head);
  panelSize = { w: lay.groupW, h: lay.groupH };
  panelWin = new BrowserWindow({
    width: panelSize.w, height: panelSize.h,
    transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (cfg.position.zOrder === 'below-pet') {
    // Mac 无 Win 的「插在桌宠之后」层级；用 floating 相对层级 -1 近似（角色尽量不遮挡），并在报告注明偏差
    panelWin.setAlwaysOnTop(true, 'floating', -1);
  } else {
    panelWin.setAlwaysOnTop(true, 'screen-saver');
  }
  try { panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* ignore */ }
  try { panelWin.setIgnoreMouseEvents(!!cfg.clickThrough, { forward: true }); } catch (e) { /* ignore */ }
  panelWin.loadFile(RENDERER_HTML);
  panelWin.webContents.once('did-finish-load', () => {
    logger.write(`display style=${cfg.display.style} bowl=${cfg.display.bowlStyle} labelStyle=${cfg.display.labelStyle} wear=${cfg.display.wear} count=${providerMgr ? providerMgr.views().length : 0} compact=${lay.compact} layout=${cfg.display.nineLayout} rows=${layoutMod.rowCountsText(lay)} groupW=${lay.groupW} groupH=${lay.groupH} wheelH=${lay.wheelH} expanded=${expanded ? 1 : 0}`);
    try { panelWin.webContents.send('pbp:init', { assetDir: assets.assetDir, assets: assetPayload() }); } catch (e) { /* ignore */ }
    setTimeout(() => requestState(true), 60);
  });
  panelWin.on('closed', () => { panelWin = null; });
  if (cfg.enabled) panelWin.showInactive();
}

// ---------------- 跟随 / 动画 ----------------
function positionTick() {
  if (loopStopped || shotMode) return;
  const started = Date.now();
  petSampleTick(started); // 拖拽瞬态检测（决定本次循环是否冻结 scale；须在 updateCharW 之前）
  updateCharW();
  try {
    if (!panelWin || panelWin.isDestroyed() || !cfg) { schedulePosition(); return; }
    if (!cfg.enabled) { schedulePosition(); return; }
    const head = layoutMod.isHead(cfg);
    const pet = {
      petBounds: locator ? locator.windowBounds() : null,
      headY: locator ? locator.headY() : NaN,
      feetY: locator ? locator.feetY() : NaN,
      centerX: locator ? locator.centerX(head) : NaN,
    };
    const displays = screen.getAllDisplays();
    const place = computePlacement(cfg, panelSize.w, panelSize.h, pet, displays, {
      monitorFollow: cfg.position.monitorFollow,
      fallbackDisplayId: fallbackDisplayId,
      dpiScale: 1,
    });
    if (anim.x == null) { anim.x = place.x; anim.y = place.y; anim.vx = 0; anim.vy = 0; }
    // 弹簧：vel = (vel + (target-anim)*0.26)*0.50
    anim.vx = (anim.vx + (place.x - anim.x) * 0.26) * 0.50;
    anim.vy = (anim.vy + (place.y - anim.y) * 0.26) * 0.50;
    anim.x += anim.vx;
    anim.y += anim.vy;
    if (Math.abs(place.x - anim.x) < 0.5 && Math.abs(anim.vx) < 0.08) { anim.x = place.x; anim.vx = 0; }
    if (Math.abs(place.y - anim.y) < 0.5 && Math.abs(anim.vy) < 0.08) { anim.y = place.y; anim.vy = 0; }
    const stationary = anim.vx === 0 && anim.vy === 0;
    const floatOffset = stationary ? -Math.abs(Math.sin(Date.now() / 900)) * 0.9 : 0;
    // 轮子彩蛋：仅 feet + wheels 时随移动速度旋转（Win: WheelAngle += speed×8 度/帧）
    // 匹配比例：实测角色宽变化（换皮肤/缩放）时重排一次面板（老板 2026-11-01 07:24 拍板）
    {
      const cw = currentCharW();
      if (Number.isFinite(cw) && charWHist.length >= 5) {
        const ngs = layoutMod.graphicsScale(cfg, petScale, cw);
        // 只有缩放真的变了（≥0.03，约 2.4pt 角色宽）才重排，避免待机动画引发反复缩放
        if (Math.abs(ngs - lastAppliedCharW) >= 0.03) {
          lastAppliedCharW = ngs;
          logger.write(`scale apply charW=${cw.toFixed(1)} graphicsScale=${ngs.toFixed(3)}（匹配比例 盆宽=角色宽×0.80）`);
          requestState(true);
        }
      }
    }
    const wheelsOn = !!(cfg.display.wheels && cfg.display.wear === 'feet');
    const speed = Math.hypot(anim.vx, anim.vy);
    if (wheelsOn) {
      const moving = speed > 0.05;
      if (moving) {
        wheelAngle = (wheelAngle + speed * 8) % 360;
        const wnow = Date.now();
        if (wnow - lastWheelSend > 33) {
          lastWheelSend = wnow;
          sendState(true, { wheelAngle }); // 强制重绘：内容键不含角度
        }
      } else if (lastWheelSend) {
        lastWheelSend = 0; // 停稳；最后一帧已经带上最终角度
      }
    }
    const nx = Math.round(anim.x);
    const ny = Math.round(anim.y + floatOffset);
    if (nx !== lastPos.x || ny !== lastPos.y) {
      try { panelWin.setPosition(nx, ny, false); } catch (e) { /* ignore */ }
      lastPos = { x: nx, y: ny };
      const nowLog = Date.now();
      if (!positionTick.lastLog || nowLog - positionTick.lastLog > 2000) {
        positionTick.lastLog = nowLog;
        logger.write(`place src=${place.src} petCenter=${place.centerX.toFixed(1)} targetX=${place.x} targetY=${place.y} w=${panelSize.w} h=${panelSize.h} wear=${cfg.display.wear} focusHead=${cfg.display.wear === 'head'} detect=${locator ? JSON.stringify(locator.status()) : '{}'}`);
      }
    }
    if (Date.now() - started > 15) logger.write('place slow ms=' + (Date.now() - started));
  } catch (e) {
    logger.write('position tick error ' + String(e && e.message || e));
  }
  schedulePosition();
}

function schedulePosition() {
  if (loopStopped || shotMode) return;
  const now = Date.now();
  const wait = 16;
  setTimeout(positionTick, wait);
}

// ---------------- 快捷键 ----------------
function registerHotkey() {
  try {
    if (globalShortcut) globalShortcut.unregisterAll();
    if (!cfg || !cfg.hotkey || !cfg.hotkey.enabled) return;
    let combo = String(cfg.hotkey.combo || 'Ctrl+Alt+Shift+R');
    combo = combo.replace(/\bCtrl\b/gi, 'CommandOrControl').replace(/\bAlt\b/gi, 'Alt').replace(/\bShift\b/gi, 'Shift');
    const ok = globalShortcut.register(combo, () => {
      logger.write('hotkey refresh');
      if (providerMgr) providerMgr.configure(cfg);
      requestState(true);
    });
    logger.write('hotkey register combo=' + combo + ' ok=' + (ok ? 1 : 0));
  } catch (e) { /* ignore */ }
}

// ---------------- 托盘 ----------------
function setupTray() {
  try {
    const iconPath = path.join(ASSETS_DIR, 'trayTemplate.png');
    if (!fs.existsSync(iconPath)) { logger.write('tray skipped (no trayTemplate.png)'); return; }
    const img = nativeImage.createFromPath(iconPath);
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip(APP_NAME);
    const build = () => Menu.buildFromTemplate([
      { label: '饭桶余额 · Mac 显示窗', enabled: false },
      { type: 'separator' },
      { label: '立即刷新', click: () => { if (providerMgr) providerMgr.configure(cfg); requestState(true); } },
      { label: expanded ? '收起明细' : '展开明细', click: () => { expanded = !expanded; requestState(true); } },
      { label: '打开配置目录', click: () => { try { shell.openPath(configMod.userDir()); } catch (e) { /* ignore */ } } },
      { type: 'separator' },
      { label: '退出', click: () => { trayQuitRequested = true; app.quit(); } },
    ]);
    tray.setContextMenu(build());
    tray.on('click', () => { expanded = !expanded; requestState(true); tray.setContextMenu(build()); });
  } catch (e) {
    logger.write('tray setup failed ' + String(e && e.message || e));
  }
}

// ---------------- 启动 ----------------
function startPanelIfReady() {
  if (!panelWin) createPanelWindow();
  else if (cfg.enabled) panelWin.showInactive();
}

function startLoops() {
  if (loopStopped) return;
  providerMgr = new ProviderManager({});
  providerMgr.configure(cfg);
  providerMgr.start();
  if (ARGS.demo > 0) { providerMgr.demoCount = Math.min(9, ARGS.demo); }
  else if (demoMode) { providerMgr.demoCount = 3; }

  locator = new PetLocator({ binary: PETPROBE, intervalMs: Math.max(120, cfg.liveFollow.detectMs || 250) });
  locator.start();

  // 主题轮询（按 pollMs 链式）
  const themeLoop = async () => {
    await pollTheme();
    if (!loopStopped) setTimeout(themeLoop, Math.max(1000, cfg.theme.pollMs));
  };
  setTimeout(themeLoop, 200);
  setInterval(pollPetState, 500);
  setInterval(checkConfigReload, 5000);
  setInterval(checkAssetReload, 5000);
  schedulePosition();
  // 首次状态
  setTimeout(() => requestState(true), 300);
  // 权限复查
  setTimeout(() => {
    const ok = checkScreenPermission();
    if (!ok) showGuideWindow('screen-capture-not-granted');
    else if (locator && locator.permDenied) showGuideWindow('petprobe-perm-denied');
  }, 2500);
}

// ---------------- 自测（无窗口） ----------------
function runSelftest(outPath) {
  const { computeLayout } = layoutMod;
  const asset = { pixelW: 320, pixelH: 290, rice: { x: 44, y: 8, w: 232, h: 276 }, rimY: 54, rimBottom: 80 };
  const mk = (displayOver) => {
    const raw = { display: Object.assign({}, displayOver || {}) };
    return configMod.normalizeConfig(raw);
  };
  const cases = [];
  const labels = ['L3', 'L1', 'L2'];
  const layouts = ['row', 'twoRows', 'pyramid'];
  const wears = ['head', 'feet'];
  for (const label of labels) for (const nl of layouts) for (const wear of wears) for (const scale of [0.5, 1, 1.5, 2]) {
    const raw = { display: { labelStyle: label, nineLayout: nl, wear, wheels: wear === 'feet' } };
    const c = configMod.normalizeConfig(raw);
    const gs = layoutMod.graphicsScale(c, scale);
    const lay = computeLayout(c, 9, 1, gs, asset, wear === 'head');
    cases.push({
      label, layout: nl, wear, scale, graphicsScale: +gs.toFixed(3),
      bowlW: lay.bowlW, bowlH: lay.bowlH, gap: lay.gap, groupW: lay.groupW, groupH: lay.groupH,
      wheelH: lay.wheelH, rowShift: lay.rowShift, rowCounts: lay.rowCounts,
      plaqueW: +lay.plaque.plaqueW.toFixed(2), plaqueH: +lay.plaque.plaqueH.toFixed(2),
      namePx: +lay.plaque.namePx.toFixed(2), amountPx: +lay.plaque.amountPx.toFixed(2),
      slots: lay.slots.map(s => ({ i: s.index, row: s.row, x: s.x, top: s.top, bottom: s.bottom })),
    });
  }
  const counts = {};
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const c = configMod.normalizeConfig({});
    const lay = computeLayout(c, n, 1, 1, asset, true);
    counts[n] = { bowlW: lay.bowlW, groupW: lay.groupW, groupH: lay.groupH, compact: lay.compact, pyramid: lay.pyramid, rowCounts: lay.rowCounts };
  }
  const out = {
    tool: 'authored-selftest', app: APP_NAME, version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    env: { platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node },
    graphicsScale: { p1: +layoutMod.graphicsScale(configMod.normalizeConfig({}), 1).toFixed(4), p105: +layoutMod.graphicsScale(configMod.normalizeConfig({}), 1.05).toFixed(4), p2: +layoutMod.graphicsScale(configMod.normalizeConfig({}), 2).toFixed(4) },
    wear: {
      contactPx: layoutMod.contactPx(1),
      headPanelY: layoutMod.headPanelY(786, 64, 3, 33, 956),
      feetPanelBottom: layoutMod.feetPanelBottom(configMod.normalizeConfig({}), 923),
    },
    counts,
    cases,
  };
  try { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); } catch (e) { /* ignore */ }
  logger.write('selftest written ' + outPath + ' cases=' + cases.length);
  console.log('selftest ->', outPath);
  app.quit();
}

// ---------------- 组合出图（--shot） ----------------
async function runShots(outDir) {
  shotMode = true;
  shotOutDir = outDir || path.join(require('os').tmpdir(), 'pbp-shots');
  fs.mkdirSync(shotOutDir, { recursive: true });
  logger.write('shot start out=' + shotOutDir);
  scanAssets();
  assetSignature = assets.signature;
  themeState.style = styleMod.buildStyle({ theme: 'dark', force: '', palettes: null });

  const win = new BrowserWindow({
    width: 800, height: 600, show: false, transparent: true, frame: false, hasShadow: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.once('did-finish-load', () => {
    try { win.webContents.send('pbp:init', { assetDir: assets.assetDir, assets: assetPayload() }); } catch (e) { /* ignore */ }
  });
  win.loadFile(RENDERER_HTML);
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    ipcMain.once('pbp:ready', () => { clearTimeout(t); resolve(); });
  });
  // 等待首帧渲染（触发一次）
  await new Promise(r => setTimeout(r, 300));

  const assetMeta = assets.map.porcelain || Object.values(assets.map)[0];
  const cases = [];
  const labels = ['L1', 'L2', 'L3'];
  const layouts = ['row', 'twoRows', 'pyramid'];
  const wears = ['head', 'feet'];
  const themes = ['dark', 'light'];
  const scales = [0.5, 1, 1.5, 2];
  const views9 = demoViews(9, 'normal');
  let captured = 0;

  async function captureCase(name, cfgV, views, style, scale, extra) {
    const item = extra || {};
    const head = layoutMod.isHead(cfgV);
    const asset = pickAssetFor(cfgV);
    const gs = layoutMod.graphicsScale(cfgV, scale);
    const lay = layoutMod.computeLayout(cfgV, views.length, 1, gs, asset, head);
    const w = lay.groupW, h = lay.groupH;
    const st = {
      seq: ++seq, mode: 'bowls',
      canvas: { w, h, dpr: 2 },
      cfg: { display: cfgV.display, interaction: cfgV.interaction },
      style: style, layout: lay, views,
      expanded: false, detail: null,
    };
    win.setSize(w, h, false);
    win.webContents.send('pbp:state', st);
    // 等渲染 ack 或 600ms
    await new Promise((resolve) => {
      const key = st.seq;
      const timer = setTimeout(resolve, 800);
      renderedWaiters.set(key, () => { clearTimeout(timer); resolve(); });
    });
    let image = await win.webContents.capturePage();
    if (image.isEmpty()) {
      win.showInactive();
      await new Promise(r => setTimeout(r, 250));
      image = await win.webContents.capturePage();
    }
    const png = image.toPNG();
    const file = path.join(shotOutDir, name + '.png');
    fs.writeFileSync(file, png);
    const sz = image.getSize();
    cases.push(Object.assign({
      file: name + '.png', w: sz.width, h: sz.height, logicalW: w, logicalH: h,
      labelStyle: cfgV.display.labelStyle, nineLayout: cfgV.display.nineLayout,
      wear: cfgV.display.wear, theme: style.theme, petScale: scale, graphicsScale: +gs.toFixed(3),
      wheels: cfgV.display.wheels, n: views.length, compact: lay.compact, pyramid: lay.pyramid, twoRows: lay.twoRows,
      rowCounts: lay.rowCounts,
    }, item));
    captured++;
  }

  try {
    // 1) 主矩阵 3×3×2×2×4 = 144
    for (const label of labels) for (const nl of layouts) for (const wear of wears) for (const theme of themes) for (const scale of scales) {
      const cfgV = configMod.normalizeConfig(Object.assign({}, rawOrDemo(), {
        display: Object.assign({}, (rawOrDemo().display || {}), {
          labelStyle: label, nineLayout: nl, wear, wheels: false,
        }),
        theme: Object.assign({}, (rawOrDemo().theme || {}), { force: theme, follow: true }),
      }));
      cfgV.display.labelStyle = label; cfgV.display.nineLayout = nl; cfgV.display.wear = wear;
      const style = styleMod.buildStyle({ theme, force: theme, palettes: null });
      const wearTag = wear === 'head' ? 'head' : 'feet';
      const name = `${label}_${nl === 'row' ? 'row' : nl === 'twoRows' ? 'twoRows' : 'pyramid'}_${wearTag}_${theme}_s${scale.toFixed(2)}_9p`;
      await captureCase(name, cfgV, views9, style, scale);
    }
    // 2) 状态抽样（L3 pyramid head dark s1）
    const baseCfg = () => configMod.normalizeConfig(Object.assign({}, rawOrDemo(), {
      display: { labelStyle: 'L3', nineLayout: 'pyramid', wear: 'head', wheels: false },
      theme: { force: 'dark', follow: true },
    }));
    const darkStyle = styleMod.buildStyle({ theme: 'dark', force: 'dark', palettes: null });
    const lightStyle = styleMod.buildStyle({ theme: 'light', force: 'light', palettes: null });
    const states = ['normal', 'low', 'offline', 'rice'];
    for (const stName of states) {
      const views = demoViews(9, stName);
      await captureCase(`state_${stName}_L3_pyramid_head_dark_s1`, baseCfg(), views, darkStyle, 1, { state: stName });
    }
    // mix：正常+低额+满盆+断线+大白饭混合
    await captureCase('state_mix_L3_pyramid_head_dark_s1', baseCfg(), demoViews(9, 'normal'), darkStyle, 1, { state: 'mix' });
    // 3) 4 种饭桶
    for (const bowl of ['porcelain', 'black', 'steel', 'enamel']) {
      const raw = Object.assign({}, rawOrDemo(), {
        display: { bowlStyle: bowl, labelStyle: 'L3', nineLayout: 'pyramid', wear: 'head' },
        theme: { force: 'dark', follow: true },
      });
      const cfgV = configMod.normalizeConfig(raw);
      await captureCase(`bowl_${bowl}_L3_pyramid_head_dark_s1`, cfgV, demoViews(9, 'normal'), darkStyle, 1, { bowlStyle: bowl });
    }
    // 4) pyramid 家数边界 6/7/8/9 × wear 2
    for (const n of [6, 7, 8, 9]) for (const wear of wears) {
      const cfgV = configMod.normalizeConfig(Object.assign({}, rawOrDemo(), {
        display: { labelStyle: 'L3', nineLayout: 'pyramid', wear },
        theme: { force: 'dark', follow: true },
      }));
      await captureCase(`n${n}_pyramid_${wear}_dark_s1`, cfgV, demoViews(n, 'normal'), darkStyle, 1, { n });
    }
    // 5) 明暗主题 + 轮子彩蛋（feet）
    for (const theme of ['dark', 'light']) {
      const cfgV = configMod.normalizeConfig(Object.assign({}, rawOrDemo(), {
        display: { labelStyle: 'L3', nineLayout: 'pyramid', wear: 'feet', wheels: true },
        theme: { force: theme, follow: true },
      }));
      const style = styleModelStyle(theme);
      await captureCase(`wheels_feet_${theme}_s1`, cfgV, demoViews(9, 'normal'), style, 1, { wheels: true });
    }
  } catch (e) {
    logger.write('shot error ' + String(e && e.message || e));
  }
  fs.writeFileSync(path.join(shotOutDir, 'metadata.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), app: APP_NAME, version: APP_VERSION,
    combos: 'labelStyle(3)×nineLayout(3)×wear(2)×theme(2)×petScale(4)+states+bowls+counts+wheels',
    count: cases.length, cases,
  }, null, 2));
  logger.write('shot done captured=' + captured + ' out=' + shotOutDir);
  console.log('shots ->', shotOutDir, 'count=', cases.length);
  setTimeout(() => app.quit(), 300);
}

function styleModelStyle(theme) { return styleMod.buildStyle({ theme, force: theme, palettes: null }); }

function rawOrDemo() {
  if (rawCfg) return rawCfg;
  return {
    display: { bowlStyle: 'porcelain', labelStyle: 'L3', wear: 'head', nineLayout: 'pyramid' },
    theme: { follow: true, force: '' },
    interaction: { expandOnClick: false },
    providers: [],
  };
}

// ---------------- 主入口 ----------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv && argv.includes('--quit')) {
      logger.write('quit requested by second instance');
      app.quit();
    } else if (panelWin && !panelWin.isDestroyed()) {
      panelWin.showInactive();
    }
  });

  if (ARGS.quit) { app.quit(); }

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    try { if (process.platform === 'darwin' && app.dock) app.dock.hide(); } catch (e) { /* ignore */ }
    logger.init();
    logger.write(`start ${APP_NAME} v${APP_VERSION} electron=${process.versions.electron} platform=${process.platform} ${process.arch}`);
    setupIpc();
    loadConfig();
    if (ARGS.selftest) { runSelftest(ARGS.selftest); return; }
    scanAssets();
    assetSignature = assets.signature;
    themeState.style = styleMod.buildStyle({ theme: 'dark', force: '', palettes: null });

    if (ARGS.shot) {
      try { await runShots(ARGS.shotDir); } catch (e) { logger.write('shot fatal ' + String(e && e.message || e)); app.quit(); }
      return;
    }
    if (ARGS.guide) { showGuideWindow('manual --guide'); return; }
    if (ARGS.capture) {
      createPanelWindow();
      startLoops();
      setTimeout(async () => {
        try {
          const img = await panelWin.webContents.capturePage();
          fs.writeFileSync(ARGS.capture, img.toPNG());
          const sz = img.getSize();
          logger.write(`capture panel -> ${ARGS.capture} ${sz.width}x${sz.height} bounds=${JSON.stringify(panelWin.getBounds())}`);
          if (ARGS.click) {
            const parts = ARGS.click.split(',');
            const cx = Number(parts[0]), cy = Number(parts[1]);
            logger.write(`capture click at ${cx},${cy}`);
            panelWin.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
            panelWin.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
            await new Promise(r => setTimeout(r, 900));
            if (ARGS.capture2) {
              const img2 = await panelWin.webContents.capturePage();
              fs.writeFileSync(ARGS.capture2, img2.toPNG());
              const sz2 = img2.getSize();
              logger.write(`capture panel2 -> ${ARGS.capture2} ${sz2.width}x${sz2.height} bounds=${JSON.stringify(panelWin.getBounds())}`);
            }
          }
        } catch (e) { logger.write('capture failed ' + String(e && e.message || e)); }
        setTimeout(() => app.quit(), 300);
      }, Math.max(1500, ARGS.captureWait * 1000));
      return;
    }
    if (!checkScreenPermission()) {
      showGuideWindow('no-screen-permission');
      // 仍创建面板（不会立即出画面，但便于授权后马上恢复）
      createPanelWindow();
      startLoops();
    } else {
      createPanelWindow();
      startLoops();
    }
    setupTray();
    try { fallbackDisplayId = screen.getPrimaryDisplay().id; } catch (e) { fallbackDisplayId = null; }
  });

  app.on('window-all-closed', () => {
    // 权限引导窗关掉不应退出主程序（面板可能还活着）；面板关闭才退
    if (!panelWin && !shotMode) app.quit();
  });
  app.on('will-quit', () => {
    loopStopped = true;
    try { if (globalShortcut) globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
    try { if (locator) locator.stop(); } catch (e) { /* ignore */ }
    logger.write('quit');
  });
}
