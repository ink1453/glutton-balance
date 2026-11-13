'use strict';
// 饭桶余额 · Mac 显示窗（Electron 主进程）
// 结构：配置(只读热载) / 定位(petprobe 截图扫描) / 主题轮询 / 余额抓取 / 渲染状态下发 / 60fps 跟随 / 点击穿透 / 权限引导 / 出图与自测
const { app, BrowserWindow, ipcMain, screen, systemPreferences, shell, Tray, Menu, nativeImage, globalShortcut, nativeTheme, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');

const configMod = require('./src/config');
const layoutMod = require('./src/layout');
const styleMod = require('./src/style');
const { PetLocator } = require('./src/petinfo');
const { ProviderManager, demoViews, verifyKey, errorText: providerErrorText } = require('./src/providers');
const { computePlacement } = require('./src/position');
const { ShakeDetector } = require('./src/shake');
const logger = require('./src/logger');

const APP_ROOT = __dirname;
const APP_NAME = '饭桶余额';
const APP_VERSION = '0.0.7';
const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const RENDERER_HTML = process.env.PBP_RENDERER || path.join(APP_ROOT, 'renderer', 'index.html');
const PRELOAD = path.join(APP_ROOT, 'preload.js');
const PETPROBE = path.join(APP_ROOT, 'native', 'petprobe');
const GUIDE_HTML = path.join(APP_ROOT, 'permission.html');

// ---------------- 参数 ----------------
function parseArgs(argv) {
  const out = { shot: false, shotDir: '', selftest: '', demo: 0, config: '', quit: false, guide: false, capture: '', captureWait: 6, click: '', capture2: '', autostart: false, shakeSelftest: '', shakeScript: '', securitySelftest: '', connUiSelftest: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shot') { out.shot = true; out.shotDir = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : ''; }
    else if (a === '--selftest') { out.selftest = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : path.join(APP_ROOT, 'selftest.json'); }
    else if (a === '--shake-selftest') { out.shakeSelftest = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : path.join(APP_ROOT, 'shake-selftest.json'); }
    else if (a === '--shake-script') { out.shakeScript = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : ''; }
    else if (a === '--security-selftest') { out.securitySelftest = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : path.join(APP_ROOT, 'security-selftest.json'); }
    else if (a === '--conn-ui-selftest') { out.connUiSelftest = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : path.join(APP_ROOT, 'conn-ui-selftest.json'); }
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
let petScale = 1.05;        // Coopanion /api/state 的桌宠大小（用户设置；pollPetState 每 500ms 刷新）
let petScaleKnown = false;   // 是否拿到过真实 /api/state 读数（false 时权威门控不启用，避免默认值误判）
let petFigure = '';          // 桌宠当前皮肤 figure（换皮肤也属于「用户改设置」，允许重定基准）
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
// #5：面板显示时序 / 跨屏跟踪
let panelShown = false;        // 是否已首次显示（等定位就绪再显示，避免兜底目标闪跳）
let panelShowDeadline = 0;     // 首次显示兜底截止 ms（无定位也要显示，避免窗口永不出现）
let lastDisplayId = null;      // 上次所在显示器 id（跨屏时 snap + 重下发 dpr）
// 第 11 轮丁路：桌宠生命周期跟随 —— 桌宠消失 ≥5s 隐藏显示窗，检测恢复后自动显示
let appStartedAt = Date.now();       // 进程启动时间（启动宽限判据）
let petMissingSince = 0;             // 桌宠连续缺失起点 ms（0=当前有桌宠）
let probeWatchLines = -1;            // 看门狗：上次看到的 petprobe 行号
let probeWatchAdvanceAt = 0;         // 看门狗：行号最近一次推进的时刻 ms
let probeRestartCount = 0;           // 看门狗：本进程重启探针次数（退避用）
let probeNextRestartAt = 0;          // 看门狗：下一次允许重启的时刻 ms（退避）
let probeStaleLogged = false;        // 看门狗：本轮挂死的 begin 日志只写一次
let noPetHidden = false;             // 是否因桌宠缺失而隐藏了显示窗
const NO_PET_HIDE_MS = 5000;         // 桌宠消失多久后隐藏显示窗（0.0.6 起 5s 兜底改为 30s 探针死透才隐藏，见 PROBE_DEAD_HIDE_MS）
const NO_PET_STARTUP_GRACE_MS = 10000; // 启动宽限：启动后 10s 内不因桌宠缺失而隐藏
// 第 21 轮甲路：桌宠「窗口存在性」快路径 —— 窗口连续缺失 ≥600ms（125ms×4~5 帧去抖）立即隐藏，
// 不再等 5s 兜底；capture-error 带 wid = 窗口还在，不计缺失（不拿扫描新鲜度代替窗口存在性）。
const PET_WINDOW_HIDE_MS = 600;
// 0.0.6 探针看门狗 + 「隐藏」判定修正（真机日志证据：打游戏时 petprobe 行号 3 分钟不推进、进程 0% CPU 挂死，
// 旧逻辑 5s 后把面板隐藏、且探针永远不重启 → 面板一直不回来）：
//   ① 行号超过 PROBE_STALE_RESTART_MS 不推进 → 重启 petprobe（指数退避 6s→12s→…→60s，日志留痕）；
//   ② 「定位失败」不再在 5s 就隐藏：探针挂死是探针自己的事，面板应原地保持；
//      只有探针信号持续未知 PROBE_DEAD_HIDE_MS（30s）仍救不回来才隐藏（窗口真消失走 600ms 快路径，不受影响）。
const PROBE_STALE_RESTART_MS = 6000;
const PROBE_RESTART_BACKOFF_MAX_MS = 60000;
const PROBE_DEAD_HIDE_MS = 30000;
// #1（0.0.4）：晃晕唤出余额面板 —— 抖动检测器 + 最近一次触发统计（日志/自测用）
let shakeDetector = null;
let lastShakeTrigger = null;   // {t,x,reversals,pathPt,...} 每次触发写一次，供日志/自测读取

function displayScaleOf(win) {
  try {
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    return d && d.scaleFactor ? d.scaleFactor : 2;
  } catch (e) { return 2; }
}

// ---------------- 跟随动画（第 6 轮 A · #5 去漂移） ----------------
// 临界阻尼跟随：x(t) = T + (e + c·t)·e^(-ωt)，c = v + ω·e（e = x - T，v = 速度 px/s）
// 从静止出发永不越过目标 →「抵达即稳定、无回弹」；按真实 dt 积分 → 不受帧率抖动影响。
const FOLLOW_OMEGA = 26;          // rad/s：100pt 位移约 0.27s 收敛到 0.6pt
const FOLLOW_SNAP_PX = 0.6;       // 小于该距离且速度很低 → 直接贴到目标（消除亚像素抖）
const FOLLOW_SNAP_V = 30;         // px/s
function followAxisStep(pos, vel, target, dt) {
  const e = pos - target;
  if (Math.abs(e) <= FOLLOW_SNAP_PX && Math.abs(vel) <= FOLLOW_SNAP_V) return { pos: target, vel: 0, settled: true };
  const w = FOLLOW_OMEGA;
  const decay = Math.exp(-w * dt);
  const c = vel + w * e;
  const np = target + (e + c * dt) * decay;
  const nv = (vel - w * c * dt) * decay;
  // 严格禁止越过目标（旧弹簧 ζ≈0.81 会过冲 3~4px 再回弹 —— 「到位漂一下」的根因）
  if ((e > 0 && np < target) || (e < 0 && np > target)) return { pos: target, vel: 0, settled: true };
  return { pos: np, vel: nv, settled: false };
}

// 面板改尺寸：以「底边中点」为锚，一次 setBounds 同时改位置+尺寸。
// 旧实现只 setSize（左上角锚定）→ 面板贴桌宠头顶时底边被顶偏 Δh，下一帧再被弹簧拉回 = 重排漂移。
function resizePanelAnchored(w, h) {
  if (!panelWin || panelWin.isDestroyed()) return;
  let b;
  try { b = panelWin.getBounds(); } catch (e) { return; }
  if (!(b.width > 0) || !(b.height > 0)) return;
  const nx = Math.round(b.x + (b.width - w) / 2);
  const ny = Math.round(b.y + (b.height - h));
  try { panelWin.setBounds({ x: nx, y: ny, width: w, height: h }, false); } catch (e) { return; }
  const dx = nx - b.x, dy = ny - b.y;
  if (anim.x != null) { anim.x += dx; anim.y += dy; if (anim.tx != null) { anim.tx += dx; anim.ty += dy; } }
  lastPos = { x: nx, y: ny };
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
// 再「锁定」基准宽：只有持续偏离 >8% 才重新定基准，保证面板大小稳定、不跟着动画一帧一变大变小。
const charWHist = [];
let lockedCharW = NaN;
let charWDrift = 0;
// charW 去噪（第 22 轮甲路重写）：菜单/气泡窗口会制造 3~4 倍尖刺，且菜单态在 2.2–3.5s 内也能稳定
// → 旧门控（稳 2.2/3.5s 就认）会把「点击/右击桌宠」的尖刺当真实尺寸变化，graphicsScale 跳到
// 1.33/1.74/1.99、panel resize 变大。本轮三层门控：
//   ① 「冻结只管布局值」补齐为「冻结也管重定基准」：scaleFrozen 期间清空 charWPending、不改 lockedCharW；
//   ② 「大变化」= 相对基准 >1.25×（或 <0.8×），或本次偏离开场就是 >15% 跳变：必须新中值稳定 ≥8s、
//      且桌宠位置静止 ≥2s、且不在拖拽冻结中，才允许重定基准 —— 菜单态尖刺 2.2–3.5s 永远到不了 8s；
//   ③ 单次跳变只触发冻结（DRAG_HOLD_MS），回到基准附近即清空候选，不重定基准。
// 真实改缩放/换皮肤仍是「持续偏离」：等满 8s 后按比例重排（延迟可接受，匹配比例特性不回退）。
const CHARW_STABLE_MS = 2200;
const CHARW_EXTREME_STABLE_MS = 3500;
const CHARW_STABLE_SPREAD = 0.10;
const CHARW_EXTREME_RATIO = 0.25;      // >1.25× 视为极端变化（大变化门控的另一判据）
const CHARW_HARD_RATIO = 2.20;
const CHARW_PENDING_MAX = 20;
const CHARW_BIG_STABLE_MS = 8000;      // 大变化/跳变开场：长稳定下限（第 22 轮）
const CHARW_BIG_STILL_MS = 2000;       // 大变化：桌宠位置静止下限（第 22 轮）
const CHARW_REBASE_TOL = 0.08;         // 偏离基准多少才算「真变化」（第 22 轮，原魔数 0.08 提取）
// 第 22 轮加固（真机点击复验发现「拎起后按住 >8s」/「菜单态驻留 >8s」仍会被当真实变化）：
//   ④ 大变化 episode 期间，若光标在桌宠本体中心 ≤80pt（点击/右击/菜单/悬停/拎起时光标必在桌宠身上）
//      → 「计时暂停」：不拒绝也不接受，charWStableSince 每帧重置（交互期间不累计），光标离开后重新累计，
//      满 8s + 桌宠静止 + 无拖拽仍可接受 —— 所以「从桌宠右键菜单里改缩放」不会误杀（菜单关闭光标移开后 8s 生效）。
//   ⑤ bodyCenter x 相对 episode 起点漂移 >10pt 只作日志字段 move=0/1，不单独拦截（真实缩放时 bbox 中心
//      也会随缩放锚点移动 ~19pt，单靠 x 判据会误杀真缩放）。
const CHARW_CURSOR_NEAR_PT = 80;       // 光标距桌宠本体中心 ≤ 该值 → 交互态「计时暂停」
const CHARW_BIG_MOVE_X_PT = 10;        // 大变化 episode 内 bodyCenter x 漂移 > 该值 → 日志 move=1
// 0.0.6 形状一致性门控（真机日志证据：打游戏时桌宠说话/倾听气泡把 bbox 撑到 191.5×174，宽 2.2×/高 1.6×）：
//   气泡/遮挡只把「宽」撑大（高不按比例），真·缩放（Coopanion 改桌宠大小）是等比缩放 → 宽高同倍率。
//   重定基准前先查 charH 是否等于「按宽度等比应有的高」：
//     等比（±10%）→ 照旧走稳定计时，可重定基准；
//     不等比      → 判为气泡/遮挡帧，当帧丢弃候选、不累计；只有持续 >60s 的稳定不等比（比如换了个宽扁皮肤）
//                   才当真实形状变化放行（打游戏时的气泡/菜单停留都是秒级，到不了 60s）。
const CHARW_SHAPE_TOL = 0.10;          // charH 相对「按宽度等比应有值」的容差
const CHARW_SHAPE_HOLD_MS = 120000;    // 不等比变化持续多久才当真实形状变化放行（>2min；气泡/语音停留是秒级）
let charWLastLine = -1;
let charWPending = [];
let charWStableSince = 0;
let charWBigSince = -1;                // 本次「大变化」偏离起点 ms（-1=不在偏离中；回到基准附近即清零）
let charWJumpEpisode = false;          // 本次偏离是否以 >15% 跳变开场（跳变=先只冻结，需长稳定才认）
let lastPetMoveAt = 0;                 // 最近一次检测到桌宠移动的时间 ms（大变化要求静止 ≥2s）
let lastSampleCx = NaN;                // 最近一条采样的桌宠本体中心 x（pt，屏幕左上原点；光标邻近判据用）
let lastSampleCy = NaN;                // 最近一条采样的桌宠本体中心 y = (headY+feetY)/2（pt）
let lastSampleCharH = NaN;             // 最近一条采样的角色高（pt，probe charHpt；形状门控用）
let lockedCharH = NaN;                 // 与 lockedCharW 同一时刻的角色高（pt，形状门控基准）
let lockedPetScale = NaN;              // 与 lockedCharW 同一时刻的 Coopanion 桌宠 scale（权威门控基准）
let lockedPetFigure = '';              // 与 lockedCharW 同一时刻的桌宠皮肤 figure
let charWShapeRejectSince = 0;         // 不等比偏 episode 起点 ms（0=当前不在不等比态）
let charWShapeRejectLogged = false;    // 本 episode 的「不等比丢弃」日志只写一次，避免刷屏
let charWShapeLongLogged = false;      // 本 episode 的「不等比 >2min 放行」日志只写一次
let charWEpisodeAnchorX = NaN;         // 大变化 episode 起点 bodyCenter x（move=0/1 日志用）
let charWCursorPaused = false;         // 当前大变化 episode 是否正因「光标在桌宠身上」暂停计时（日志用）
let charWCursorPausedLogged = false;   // 本 episode 的「计时暂停」日志只写一次，避免刷屏

function medianCharW(values) {
  if (!Array.isArray(values) || !values.length) return NaN;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// 第 22 轮加固④：光标是否在桌宠本体附近。Electron screen.getCursorScreenPoint() 与 petprobe 的
// bodyCenterPt/headPt/feetPt 同一坐标口径（屏幕左上原点、逻辑点），无需任何系统权限。
// typeof 守卫：test/scale-freeze-sim.js 抽取本段代码在 vm 里回放时没有 screen。
function petCursorInfo() {
  const out = { near: false, cursor: null, center: null };
  if (!Number.isFinite(lastSampleCx) || !Number.isFinite(lastSampleCy)) return out;
  out.center = { x: lastSampleCx, y: lastSampleCy };
  try {
    if (typeof screen === 'undefined' || !screen || typeof screen.getCursorScreenPoint !== 'function') return out;
    const p = screen.getCursorScreenPoint();
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return out;
    out.cursor = { x: p.x, y: p.y };
    out.near = Math.hypot(p.x - lastSampleCx, p.y - lastSampleCy) <= CHARW_CURSOR_NEAR_PT;
  } catch (e) { return out; }
  return out;
}

function observeCharWCandidate(candidate, now) {
  if (!(Number.isFinite(candidate) && candidate > 20)) return;
  // 第 22 轮①：拖拽/尖刺冻结期间「只冻结」—— 不累计候选、不改锁定基准（补齐旧缺口：
  // 旧实现 scaleFrozen 只冻结 currentCharW 布局值，observeCharWCandidate 仍照常重定基准）。
  if (scaleFrozen || now < scaleFrozenUntil) {
    charWPending = [];
    charWStableSince = 0;
    return;
  }
  if (!Number.isFinite(lockedCharW)) {
    lockedCharW = candidate;
    if (Number.isFinite(lastSampleCharH) && lastSampleCharH > 20) lockedCharH = lastSampleCharH;
    if (typeof petScaleKnown === 'boolean' && petScaleKnown && typeof petScale === 'number' && Number.isFinite(petScale)) {
      lockedPetScale = petScale;
      lockedPetFigure = (typeof petFigure === 'string') ? petFigure : '';
    }
    charWPending = [];
    charWStableSince = now;
    charWBigSince = -1;
    charWJumpEpisode = false;
    charWCursorPaused = false;
    charWCursorPausedLogged = false;
    charWEpisodeAnchorX = NaN;
    charWShapeRejectSince = 0;
    charWShapeRejectLogged = false;
    charWShapeLongLogged = false;
    return;
  }
  // 权威基准懒初始化：启动时首条像素采样可能早于首次 /api/state 轮询（500ms），
  // 拿到第一个真实 petScale 后补基准，避免开局窗口期门控不生效。
  if (!Number.isFinite(lockedPetScale) && typeof petScaleKnown === 'boolean' && petScaleKnown
      && typeof petScale === 'number' && Number.isFinite(petScale)) {
    lockedPetScale = petScale;
    lockedPetFigure = (typeof petFigure === 'string') ? petFigure : '';
  }
  const rel = Math.abs(candidate - lockedCharW) / lockedCharW;
  // 回到基准附近（待机呼吸/动画抖动）→ 清空候选与「大变化」跟踪，不重定基准。
  if (rel <= CHARW_REBASE_TOL) {
    charWPending = [];
    charWStableSince = 0;
    charWBigSince = -1;
    charWJumpEpisode = false;
    charWCursorPaused = false;
    charWCursorPausedLogged = false;
    charWEpisodeAnchorX = NaN;
    charWShapeRejectSince = 0;
    charWShapeRejectLogged = false;
    charWShapeLongLogged = false;
    return;
  }
  // 3~4 倍尖刺直接丢弃，避免菜单/气泡把 graphicsScale 推到上限；换肤/缩放仍保留至 2.2 倍范围。
  // 尖刺同时打断「持续偏离」连续性：连续候选不能跨过 >2.2× 的坏样本累加。
  if (candidate > lockedCharW * CHARW_HARD_RATIO || candidate < lockedCharW / CHARW_HARD_RATIO) {
    charWPending = [];
    charWStableSince = 0;
    charWBigSince = -1;
    charWJumpEpisode = false;
    charWShapeRejectSince = 0;
    charWShapeRejectLogged = false;
    charWShapeLongLogged = false;
    return;
  }
  // 0.0.6 二版 · 权威尺寸门控（真机反例：说话气泡能让宽高**等比**膨胀 1.9×，形状门控拦不住）：
  //   Coopanion /api/state 的桌宠 scale / skin.figure 是「用户设置」权威值 —— 只有它们变了才允许重定基准；
  //   像素变宽而权威值没变 → 判为气泡/菜单/遮挡帧（丢弃，保持原盆宽）；变窄仍放行
  //   （气泡结束回落、以及启动时正好在气泡态的自愈路径）。
  const apiScale = (typeof petScaleKnown === 'boolean' && petScaleKnown && typeof petScale === 'number' && Number.isFinite(petScale)) ? petScale : NaN;
  const apiFigure = (typeof petFigure === 'string') ? petFigure : '';
  if (Number.isFinite(lockedPetScale) && Number.isFinite(apiScale)) {
    const apiRel = Math.abs(apiScale - lockedPetScale) / Math.max(0.001, lockedPetScale);
    const figChanged = !!(lockedPetFigure && apiFigure && apiFigure !== lockedPetFigure);
    if (!figChanged && apiRel <= 0.001 && candidate > lockedCharW * (1 + CHARW_REBASE_TOL)) {
      if (!charWShapeRejectSince) charWShapeRejectSince = now;
      if (now - charWShapeRejectSince < CHARW_SHAPE_HOLD_MS) {
        charWPending = [];
        charWStableSince = 0;
        charWBigSince = -1;
        charWJumpEpisode = false;
        if (!charWShapeRejectLogged) {
          charWShapeRejectLogged = true;
          logger.write(`scale charW api-gate charW=${candidate.toFixed(1)} charH=${Number.isFinite(lastSampleCharH) ? lastSampleCharH.toFixed(1) : 'NaN'} locked=${lockedCharW.toFixed(1)} petScale=${apiScale}（桌宠大小/皮肤没变却变宽：气泡/遮挡帧，保持原盆宽）`);
        }
        return;
      }
      // 持续 >2min 的安全阀：仍允许放行（避免 Coopanion 接口异常时永久卡住）
      if (!charWShapeLongLogged) {
        charWShapeLongLogged = true;
        logger.write(`scale charW api-gate-long charW=${candidate.toFixed(1)} heldMs=${Math.round(now - charWShapeRejectSince)}（权威值未变但像素变宽 >2min，安全阀放行）`);
      }
    } else {
      charWShapeRejectSince = 0;
      charWShapeRejectLogged = false;
      charWShapeLongLogged = false;
    }
  }
  // 0.0.6 形状门控：气泡/遮挡把「宽」撑大但「高」不按比例 → 当帧丢弃（不累计、不改基准）。
  // 真·等比缩放会通过（charH ≈ lockedCharH × k）；持续 >60s 的不等比才当真实形状变化放行。
  if (Number.isFinite(lockedCharH) && lockedCharH > 20
      && Number.isFinite(lastSampleCharH) && lastSampleCharH > 20) {
    const k = candidate / lockedCharW;
    const shape = lastSampleCharH / (lockedCharH * k); // 1 = 与宽度等比
    if (Math.abs(shape - 1) > CHARW_SHAPE_TOL) {
      if (!charWShapeRejectSince) charWShapeRejectSince = now;
      if (now - charWShapeRejectSince < CHARW_SHAPE_HOLD_MS) {
        charWPending = [];
        charWStableSince = 0;
        charWBigSince = -1;
        charWJumpEpisode = false;
        if (!charWShapeRejectLogged) {
          charWShapeRejectLogged = true;
          logger.write(`scale charW shape-reject charW=${candidate.toFixed(1)} charH=${lastSampleCharH.toFixed(1)} locked=${lockedCharW.toFixed(1)}×${lockedCharH.toFixed(1)} shape=${shape.toFixed(3)}（宽高不等比：疑似说话/倾听气泡或遮挡帧，保持原盆宽）`);
        }
        return;
      }
      // 持续 >2min 的不等比：视为真实形状变化（如换了宽扁皮肤），走正常计时放行（只记一次日志）。
      if (!charWShapeLongLogged) {
        charWShapeLongLogged = true;
        logger.write(`scale charW shape-accept-long charW=${candidate.toFixed(1)} charH=${lastSampleCharH.toFixed(1)} locked=${lockedCharW.toFixed(1)}×${lockedCharH.toFixed(1)} heldMs=${Math.round(now - charWShapeRejectSince)}（持续不等比 >2min，当真实形状变化处理）`);
      }
    } else {
      charWShapeRejectSince = 0;
      charWShapeRejectLogged = false;
      charWShapeLongLogged = false;
    }
  }
  // 第 22 轮②：偏离开场（相对基准 >8%）→ 记起点；若第一帧就是 >15% 跳变，本次按「大变化」处理。
  if (charWBigSince < 0) {
    charWBigSince = now;
    charWJumpEpisode = rel > CHARW_JUMP_RATIO;
    charWEpisodeAnchorX = lastSampleCx;
    charWCursorPaused = false;
    charWCursorPausedLogged = false;
  }
  if (!charWPending.length) {
    charWPending = [candidate];
    charWStableSince = now;
  } else {
    const pendingMed = medianCharW(charWPending);
    if (!Number.isFinite(pendingMed) || Math.abs(candidate - pendingMed) / pendingMed > CHARW_STABLE_SPREAD) {
      charWPending = [candidate];
      charWStableSince = now;
    } else {
      charWPending.push(candidate);
      if (charWPending.length > CHARW_PENDING_MAX) charWPending.shift();
    }
  }
  const pMed = medianCharW(charWPending);
  if (!Number.isFinite(pMed) || charWPending.length < 3) return;
  const pMin = Math.min(...charWPending), pMax = Math.max(...charWPending);
  const spread = (pMax - pMin) / pMed;
  if (spread > CHARW_STABLE_SPREAD) {
    charWPending = [candidate];
    charWStableSince = now;
    return;
  }
  const big = rel > CHARW_EXTREME_RATIO || charWJumpEpisode;
  const neededMs = big ? CHARW_BIG_STABLE_MS
    : (rel > CHARW_EXTREME_RATIO ? CHARW_EXTREME_STABLE_MS : CHARW_STABLE_MS);
  // 第 22 轮加固④：大变化 episode 期间光标在桌宠身上（点击/右击/菜单/悬停/拎起）→ 计时暂停
  // （不拒绝、也不接受；charWStableSince 每帧重置 = 交互期间不累计重定基准；光标离开后重新累计）。
  if (big) {
    const ci = petCursorInfo();
    if (ci.near) {
      charWStableSince = now;
      charWCursorPaused = true;
      if (!charWCursorPausedLogged) {
        charWCursorPausedLogged = true;
        logger.write(`scale charW paused cursor-near charW=${pMed.toFixed(1)} locked=${lockedCharW.toFixed(1)} cursor=${ci.cursor ? ci.cursor.x.toFixed(1) + ',' + ci.cursor.y.toFixed(1) : '?'} petCenter=${ci.center ? ci.center.x.toFixed(1) + ',' + ci.center.y.toFixed(1) : '?'}（交互/移动态：重新定基准计时暂停，光标离开后重新累计）`);
      }
      return;
    }
    charWCursorPaused = false;
  }
  if (now - charWStableSince < neededMs) return;
  // 第 22 轮②附加条件：大变化还要「桌宠位置静止 ≥2s + 不在拖拽冻结中」，否则继续等。
  if (big && (now < scaleFrozenUntil || (lastPetMoveAt > 0 && now - lastPetMoveAt < CHARW_BIG_STILL_MS))) return;
  const stableMs = now - charWStableSince;
  // 第 22 轮加固⑤：bodyCenter x 相对 episode 起点漂移 >10pt 只作日志字段（不单独拦截）
  const move = (Number.isFinite(charWEpisodeAnchorX) && Number.isFinite(lastSampleCx)
    && Math.abs(lastSampleCx - charWEpisodeAnchorX) > CHARW_BIG_MOVE_X_PT) ? 1 : 0;
  const prevCharW = lockedCharW, prevCharH = lockedCharH;
  lockedCharW = pMed;
  if (Number.isFinite(lastSampleCharH) && lastSampleCharH > 20) lockedCharH = lastSampleCharH;
  if (Number.isFinite(apiScale)) { lockedPetScale = apiScale; lockedPetFigure = apiFigure; }
  charWDrift = 0;
  charWPending = [];
  charWStableSince = now;
  charWBigSince = -1;
  charWJumpEpisode = false;
  charWCursorPaused = false;
  charWCursorPausedLogged = false;
  charWEpisodeAnchorX = NaN;
  charWShapeRejectSince = 0;
  charWShapeRejectLogged = false;
  charWShapeLongLogged = false;
  logger.write(`scale charW baseline accepted charW=${lockedCharW.toFixed(1)} charH=${Number.isFinite(lockedCharH) ? lockedCharH.toFixed(1) : 'NaN'} prev=${Number.isFinite(prevCharW) ? prevCharW.toFixed(1) : 'NaN'}×${Number.isFinite(prevCharH) ? prevCharH.toFixed(1) : 'NaN'} stableMs=${stableMs} spread=${spread.toFixed(3)} kind=${big ? 'big' : 'small'} move=${move}`);
}

// 明细卡：展开后给用户一个短暂操作窗口，默认 8 秒无操作自动收起。
const DETAIL_AUTO_COLLAPSE_MS = 8000;
let detailAutoCollapseTimer = null;

function clearDetailAutoCollapse() {
  if (detailAutoCollapseTimer) clearTimeout(detailAutoCollapseTimer);
  detailAutoCollapseTimer = null;
}

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
    const fy = Number(i.feetPt);
    const cw = Number(i.charWpt);
    const ch = Number(i.charHpt);
    lastSampleCharH = (Number.isFinite(ch) && ch > 20) ? ch : NaN;
    // 第 22 轮加固④：记录本体中心点（光标邻近判据），head/feet 用于取本体中心 y
    if (cx > 0 && hy > 0) {
      lastSampleCx = cx;
      lastSampleCy = (Number.isFinite(fy) && fy > hy) ? (hy + fy) / 2 : (hy + 54);
    }
    if (Number.isFinite(cw) && cw > 20) {
      charWLastLine = sampleLineSeen;
      charWHist.push(cw);
      if (charWHist.length > 7) charWHist.shift();
    }
    // ① 位移检测：桌宠本体中心（x）/头顶（y）在相邻采样间移动 → 拖拽
    if (cx > 0 && hy > 0) {
      if (!lastPetMoveAt) lastPetMoveAt = now;
      if (lastSamplePos && (Math.abs(cx - lastSamplePos.cx) > DRAG_MOVE_PT || Math.abs(hy - lastSamplePos.headY) > DRAG_MOVE_PT)) {
        scaleFrozenUntil = now + DRAG_HOLD_MS;
        lastPetMoveAt = now;   // 第 22 轮：大变化门控要求「桌宠位置静止 ≥2s」
      }
      lastSamplePos = { cx: cx, headY: hy };
    }
    // ② 角色宽突变检测：拖拽提起的第一帧
    let deviated = false;
    if (Number.isFinite(cw) && cw > 20 && Number.isFinite(lockedCharW) && lockedCharW > 20) {
      deviated = Math.abs(cw - lockedCharW) / lockedCharW > CHARW_REBASE_TOL;
      if (deviated && !lastSampleDeviated) {
        const jump = Math.abs(cw - lockedCharW) / lockedCharW > CHARW_JUMP_RATIO;
        if (jump) scaleFrozenUntil = now + DRAG_HOLD_MS;
      }
    }
    lastSampleDeviated = deviated;
    // 第 22 轮①：候选门控放在「本帧移动/跳变冻结」之后 → 冻结期间不会累计候选、不会重定基准。
    if (Number.isFinite(cw) && cw > 20) observeCharWCandidate(cw, now);
    // ③ #1 晃晕唤出：同一条 petprobe 采样喂给抖动检测器（与面板跟随同源，天然抵消「面板自己动」）
    //    typeof 守卫：test/scale-freeze-sim.js 会原样抽取本段代码单独回放，抽取环境里没有该函数定义。
    if (typeof feedShakeSample === 'function') feedShakeSample(now);
  }
  // 冻结状态切换（每个位置循环都判一次：petprobe 短暂无新采样也能按时解冻；panel.log 有 begin/end 行）
  const frozen = now < scaleFrozenUntil;
  if (frozen !== scaleFrozen) {
    scaleFrozen = frozen;
    const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : 'NaN');
    if (frozen) {
      scaleFrozenAt = now;
      // 第 22 轮①：冻结开始即清空候选（冻结期间不许重定基准）
      charWPending = [];
      charWStableSince = 0;
      const cw = locator && locator.info ? Number(locator.info.charWpt) : NaN;
      logger.write(`scale freeze begin（拖拽/尖刺瞬态：冻结盆宽基准 charW=${f1(cw)} locked=${f1(lockedCharW)}）`);
    } else {
      charWDrift = 0;
      charWPending = [];
      charWStableSince = now;
      logger.write(`scale freeze end（冻结 ${now - scaleFrozenAt}ms，基准 locked=${f1(lockedCharW)} 未变 → 盆宽平滑恢复）`);
    }
  }
}

// 0.0.6 探针看门狗：petprobe 的 SCK 采图在「打游戏/窗口重建」时会挂死（进程还在、0% CPU、不再出行）。
// 行号停滞 >6s → 重启 petprobe；重启间隔指数退避（6s、12s、24s、48s、60s 封顶），避免狂重启。
function probeWatchdog(now) {
  if (!locator || shotMode) return;
  const lines = Number(locator.lines) || 0;
  if (lines !== probeWatchLines) {
    probeWatchLines = lines;
    probeWatchAdvanceAt = now;
    if (probeStaleLogged) {
      probeStaleLogged = false;
      logger.write(`probe watchdog recover lines=${lines}（探针恢复出行，重启次数=${probeRestartCount}）`);
    }
    return;
  }
  if (!probeWatchAdvanceAt) { probeWatchAdvanceAt = now; return; }
  const staleMs = now - probeWatchAdvanceAt;
  if (staleMs < PROBE_STALE_RESTART_MS || now < probeNextRestartAt) return;
  const waitMs = Math.min(PROBE_RESTART_BACKOFF_MAX_MS, PROBE_STALE_RESTART_MS * Math.pow(2, Math.min(probeRestartCount, 4)));
  probeRestartCount += 1;
  probeNextRestartAt = now + waitMs;
  logger.write(`probe watchdog restart staleMs=${Math.round(staleMs)} lines=${lines} count=${probeRestartCount} nextIn=${Math.round(waitMs)}ms（petprobe 行号停滞：重启探针）`);
  try { locator.stop(); } catch (e) { /* ignore */ }
  try { locator.start(); } catch (e) { /* ignore */ }
  probeWatchAdvanceAt = now;
  probeStaleLogged = true;
}

function updateCharW() {
  // 采样只在 petSampleTick 的新行分支写入，避免 60fps 重复计入菜单/气泡尖刺。
  if (scaleFrozen) { charWDrift = 0; return; }
}
function currentCharW() {
  if (scaleFrozen && Number.isFinite(lockedCharW)) return lockedCharW; // 冻结期间保持原基准（盆宽不变）
  if (Number.isFinite(lockedCharW)) return lockedCharW;
  return medianCharW(charWHist);
}

// ---------------- 配置 ----------------
function loadConfig() {
  const p = ARGS.config || configMod.configPath();
  configPathUsed = p;
  const r = configMod.readConfigFile(p);
  if (r.ok) {
    rawCfg = r.raw;
    cfg = configMod.normalizeConfig(r.raw);
    // 第 9 轮：搪瓷（enamel）已下线。旧配置写 bowlStyle=enamel/未知值 → normalize 回退白瓷，
    // 这里补一条可追溯日志（不崩、不报错、不写回配置）；属于「优雅回退」的用户可见提示。
    try {
      const reqBowl = String((r.raw && r.raw.display && r.raw.display.bowlStyle) || '').trim();
      if (reqBowl && !/^custom:/i.test(reqBowl) && cfg.display.bowlStyle === 'porcelain' && reqBowl.toLowerCase() !== 'porcelain') {
        logger.write(`WARN bowlStyle=${reqBowl} 已下线/未知 → 回退 porcelain（白瓷）`);
      }
    } catch (e) { /* ignore */ }
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
  clearDetailAutoCollapse();
  expanded = false;
  // 层级随配置热载重算：明细卡/切换形态复用窗口时不回退到旧层级。
  applyPanelWindowLevel('config-reload');
  // 点击穿透开关
  if (panelWin) {
    try { panelWin.setIgnoreMouseEvents(expanded ? false : !!cfg.clickThrough, { forward: true }); } catch (e) { /* ignore */ }
  }
  registerHotkey();
  // #1：配置热载 → 重算抖动采样间隔 + 检测器配置（重新进入 3s 启动宽限）
  applyShakeRuntime('config-reload');
  if (!cfg.enabled && panelWin) panelWin.hide();
  // 第 11 轮丁路：因桌宠缺失而隐藏的窗口，配置热载/重新启用时不得错误显示回来（等检测恢复再显示）
  if (cfg.enabled && panelWin && panelShown && !noPetHidden && !panelWin.isVisible()) panelWin.showInactive();
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
      headers: Object.assign({ 'User-Agent': 'GluttonBalance/1.0 (Mac)', 'Accept': 'application/json', 'Connection': 'close' }, headers || {}),
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
// #7：系统深浅色的唯一可信来源是 Electron nativeTheme（跟 macOS 外观）。
// 旧实现读 Coopanion /api/state 的 theme —— 那是桌宠自己的 UI 主题，不随系统外观变 → 面板一直停在深色。
function systemIsDark() {
  try { return !!(nativeTheme && nativeTheme.shouldUseDarkColors); } catch (e) { return true; }
}

// 主题优先级：老板手设 force > follow（跟系统）> 兜底深色；同步执行，nativeTheme updated 时零延迟生效。
function applyTheme(reason) {
  if (!cfg) return;
  const sysDark = systemIsDark();
  themeState.systemTheme = sysDark ? 'dark' : 'light';
  let theme, src;
  if (cfg.theme.force === 'dark' || cfg.theme.force === 'light') { theme = cfg.theme.force; src = 'config-force'; }
  else if (!cfg.theme.follow) { theme = 'dark'; src = 'config-off'; }
  else { theme = themeState.systemTheme; src = 'native'; }
  const st = styleMod.buildStyle({ theme, force: '', palettes: themeState.palettes });
  const prevKey = themeState.style ? themeState.style.key : '';
  themeState.theme = theme;
  themeState.style = st;
  if (st.key !== prevKey) {
    logger.write(`theme apply src=${src} theme=${st.theme} nativeDark=${sysDark} nativeSource=${(nativeTheme && nativeTheme.themeSource) || ''} palette=${st.paletteSource} selectedId=${st.selectedId} force=${cfg.theme.force} reason=${reason} bowl=${cfg.display.bowlStyle}`);
    requestState(true);
  }
}

// 监听系统外观切换：Electron 发 nativeTheme 'updated' → 立即重算 style 并下发给渲染层（渲染器全部用色都取自 state.style）。
function installThemeWatch() {
  try {
    nativeTheme.on('updated', () => applyTheme('nativeTheme-updated'));
    logger.write(`theme watch installed themeSource=${(nativeTheme && nativeTheme.themeSource) || ''}`);
  } catch (e) { logger.write('nativeTheme watch failed ' + String(e && e.message || e)); }
}

async function pollTheme() {
  if (shotMode || loopStopped) return;
  // 调色板仍从 Coopanion /api/theme 取（可选；失败就用内置 light/dark 回退色板，主题本身只认系统）
  let themeJ = null;
  try { themeJ = await httpJson(`http://127.0.0.1:${cfg.theme.port}/api/theme`, 1200); } catch (e) { themeJ = null; }
  themeState.palettes = themeJ ? styleMod.parseThemePalettes(themeJ) : null;
  applyTheme('poll');
}

async function pollPetState() {
  if (shotMode || loopStopped) return;
  try {
    const j = await httpJson(`http://127.0.0.1:${cfg.position.petPort}/api/state`, 1500);
    if (j && Number.isFinite(Number(j.scale)) && Number(j.scale) > 0) {
      const ns = Number(j.scale);
      // 0.0.6 二版：同时记皮肤 figure（换皮肤会改像素形状但不改 scale）
      const fig = (j.skin && typeof j.skin.figure === 'string') ? j.skin.figure : '';
      if (fig && fig !== petFigure) { petFigure = fig; logger.write(`pet state figure=${fig}（换皮肤，允许尺寸重定基准）`); }
      petScaleKnown = true;
      if (Math.abs(ns - petScale) > 0.001) {
        petScale = ns;
        logger.write(`scale apply petScale=${petScale} petScaleRef=${cfg.display.petScaleRef} charW=${currentCharW()} graphicsScale=${layoutMod.graphicsScale(cfg, petScale, currentCharW()).toFixed(3)}`);
        requestState(true);
      }
    }
  } catch (e) { /* 桌宠接口失败保持上次 */ }
}

// ---------------- 状态构建 ----------------
// 0.0.7：金额一律取整（老板 2026-11-13「把小数点后去掉」，两处都改）。
// 口径与 renderer/renderer.js 的 moneyText() 完全一致，避免明细卡与主显示窗数字打架。
// 积分符号由 ₡ 改 'C '：U+20A1 在 PingFang SC 里缺字，会掉到系统回退字体、字重明显不匹配。
function moneyText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  // 负数按「远离零」四舍五入、并把 -0 归一成 0 —— 与 renderer/renderer.js 的 moneyText 逐字一致，
  // 否则两端对同一笔余额会显示不同的数字（Math.round(-0.5) === -0）。
  let r = n < 0 ? -Math.round(-n) : Math.round(n);
  if (r === 0) r = 0;
  return String(r);
}
function amountText(v) {
  if (v.rice) return '盆满钵满';
  if (!v.hasResult || !v.ok) return '连接失败';
  const cur = String(v.currency || 'CNY').toUpperCase();
  const num = moneyText(v.amount);
  // Qoder 这类积分源不是钱：2177 Credits，不加 ¥/$
  if (cur === 'CREDITS') return 'C ' + num;
  return ((cur === 'USD') ? '$' : '¥') + num;
}

// ---------------- #4（0.0.4 二阶段）失败分类文案 · 用户可见面接入 ----------------
// 数据层在 src/providers.js（乙路第 7 轮）：views() 每条带 errorCode，errorText(code) 给中文可操作文案。
// 这里只做展示：明细卡失败行副标题 =「上次 失败：<分类中文>」；未知码回退 UNKNOWN 通用文案。
// 安全口径：不展示服务端响应体、不展示 HTTP 原文、不展示任何密钥；日志侧 providers.js 只记 code。
const DETAIL_SUB_PX = 8.5;       // 与 renderer drawDetail 的 subPx 一致（dpiScale=1）
function failureReasonText(v) {
  const code = (v && v.errorCode) ? String(v.errorCode) : 'UNKNOWN';
  let text = '';
  try { text = providerErrorText(code); } catch (e) { text = ''; }
  if (!text) { try { text = providerErrorText('UNKNOWN'); } catch (e) { text = '未知错误'; } }
  return String(text);
}
/** 明细卡某一行副标题（失败行带分类原因；成功/等待不变）。 */
function detailSubText(v) {
  if (!v || v.rice) return '大白饭档 · 不联网 · 永远盆满钵满';
  const credits = String(v.currency || '').toUpperCase() === 'CREDITS';
  const th = (v.threshold == null) ? '不设低额提醒'
    : (credits ? ('低于 ' + moneyText(v.threshold) + ' Credits 变红')
               : ('低于 ¥' + moneyText(v.threshold) + ' 变红'));
  let recent = '等待刷新';
  if (v.hasResult && v.ok) recent = '成功';
  else if (v.hasResult) recent = '失败：' + failureReasonText(v);
  return `${th} · 每 ${v.intervalSec} 秒刷新 · 上次 ${recent}`;
}
/** 估算一行文字宽度（pt）：CJK 按 1em，ASCII 按 0.55em（只用于给明细卡留够宽度，不追求精确）。 */
function estimateTextWidth(text, px) {
  let units = 0;
  for (const ch of String(text)) units += (ch.charCodeAt(0) > 0xff) ? 1 : 0.55;
  return units * px;
}
/** 明细卡需要的最小宽度：按最长副标题估算（失败原因可能很长），夹在 [minW, maxW]。 */
function detailCardWidthNeeded(views, minW, maxW) {
  let need = Number.isFinite(minW) ? minW : 240;
  const lo = Number.isFinite(minW) ? minW : 240;
  const hi = Number.isFinite(maxW) ? maxW : 460;
  for (const v of (Array.isArray(views) ? views : [])) {
    const w = 12 * 2 + 14 + estimateTextWidth(detailSubText(v), DETAIL_SUB_PX) + 6;
    if (w > need) need = w;
  }
  return Math.round(Math.max(lo, Math.min(hi, need)));
}

function buildDetail(views, w, h) {
  const rows = views.map(v => ({
    name: v.name,
    amountText: amountText(v),
    low: v.low,
    ok: v.ok,
    rice: v.rice,
    errorCode: v.errorCode || '',
    sub: detailSubText(v),
  }));
  // #1 晃晕唤出后：默认配置是点击穿透 + 点击展开关闭 → 卡片点不到，「再晃一次」才是收起入口。
  // 若用户关穿透并开了点击展开，点击也能收起，文案同时提示两种方式。
  const clickable = !!(expanded || (cfg && !cfg.clickThrough && cfg.interaction.expandOnClick));
  const hint = clickable ? '点击或再晃一次收起 · 8秒无操作自动收起' : '再晃一次收起 · 8秒无操作自动收起';
  return { w, h, rows, title: '余额明细 · ' + hint, footer: '窗口置顶 · ' + hint };
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
  // #1：入口 = 点击展开（穿透关闭）或 晃晕唤出（抖动）任一；晃晕是独立入口，不影响点击穿透
  const canExpand = canExpandDetailFor(cfgV);
  const mode = (wantExpand && canExpand) ? 'detail' : 'bowls';
  let size;
  let detail = null;
  if (mode === 'detail') {
    const s = 1;
    let w = Math.round(Math.max(240 * s, Math.min(lay.groupW, 460 * s)));
    // #4：失败行副标题带分类中文原因可能较长 → 按最长行撑宽（成功/等待场景宽度不变）
    const needW = detailCardWidthNeeded(views, 240 * s, 460 * s);
    if (needW > w) w = needW;
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
    const oldW = panelSize.w, oldH = panelSize.h;
    panelSize = { w: composed.size.w, h: composed.size.h };
    // #5：改尺寸以「底边中点」为锚（一次 setBounds），不再左上角定死→底边被顶偏→弹簧拉回
    resizePanelAnchored(panelSize.w, panelSize.h);
    logger.write(`panel resize ${oldW}x${oldH} -> ${panelSize.w}x${panelSize.h}（底边中点锚定）`);
  }
  try { panelWin.webContents.send('pbp:state', composed.state); } catch (e) { /* ignore */ }
  return composed;
}

function requestState(force, opts) {
  if (shotMode) return;
  sendState(!!force, opts || {});
}

// ---------------- #1（0.0.4）晃晕唤出余额面板 · 主进程接线 ----------------
// 定稿：materials/交互-晃晕唤出余额面板-20261101.md（方案 A：2s 内左右反转 ≥4 次唤出，再抖收起）
// 纯识别逻辑在 src/shake.js（可单测）；这里只负责：采样输入、切换入口、配置热载、日志。
// 与 #5 防漂移 / #7 主题跟随 / 隐藏窗逻辑无耦合：不改跟随公式、不改主题来源、不动 show/hide 判定。

/** 当前配置下「余额明细卡」是否有入口：点击展开（穿透关闭时）或晃晕唤出，任一可用即可。 */
function canExpandDetailFor(c) {
  const cc = c || cfg;
  if (!cc || !cc.display || !cc.interaction) return false;
  if (cc.display.style !== 'ricebowl') return false; // capsule 回退形态不展开
  const byClick = !cc.clickThrough && cc.interaction.expandOnClick;
  const byShake = !!(cc.interaction.shake && cc.interaction.shake.enabled);
  return !!(byClick || byShake);
}

/** 抖动检测器触发（在 feed 的同步回调里）：只切一次 detail，并写可追溯日志。 */
function onShakeTrigger(stats) {
  lastShakeTrigger = stats || null;
  toggleDetail('shake', stats);
}

/**
 * 展开 / 收起余额明细卡（点击、抖动、托盘共用同一状态，不会打结）。
 * @param {string} source click | shake | tray
 * @param {object} [stats] 抖动触发时的统计（写日志用）
 */
function toggleDetail(source, stats) {
  if (!cfg) return false;
  // C 方案：已展开时即使原配置 clickThrough=true，也允许点击卡片收起；展开入口仍需 shake/显式点击。
  if (!expanded && !canExpandDetailFor(cfg)) {
    logger.write(`interact ignore source=${source} reason=no-entry clickThrough=${cfg.clickThrough} expandOnClick=${cfg.interaction.expandOnClick} shake=${cfg.interaction.shake.enabled}`);
    return false;
  }
  const nowT = stats && Number.isFinite(Number(stats.t)) ? Number(stats.t) : Date.now();
  if (shakeDetector) shakeDetector.hold(nowT);
  clearDetailAutoCollapse();
  expanded = !expanded;
  const extra = stats
    ? ` reversals=${stats.reversals} pathPt=${stats.pathPt} spanMs=${stats.spanMs} windowMs=${stats.windowMs}`
    : '';
  logger.write(`interact ${expanded ? 'expand' : 'collapse'} source=${source}${extra}`);
  if (panelWin && !panelWin.isDestroyed()) {
    try { panelWin.setIgnoreMouseEvents(expanded ? false : !!cfg.clickThrough, { forward: true }); } catch (e) { /* ignore */ }
  }
  if (expanded) {
    detailAutoCollapseTimer = setTimeout(() => {
      detailAutoCollapseTimer = null;
      if (expanded) toggleDetail('timeout');
    }, DETAIL_AUTO_COLLAPSE_MS);
  }
  requestState(true);
  return true;
}

/** 采样入口：只在「面板已显示 + 配置启用」时判手势，取角色本体 bbox 中心 x（拖拽时随桌宠移动）。 */
function feedShakeSample(now) {
  if (!cfg || !shakeDetector || shotMode || loopStopped) return;
  const sc = cfg.interaction && cfg.interaction.shake;
  if (!sc || !sc.enabled) return;
  if (!cfg.enabled || !panelShown) return; // 隐藏窗 / 启动显示前不判（避免启动瞬态误触）
  const i = (locator && locator.info) || {};
  let x = Number(i.bodyCenterPt);
  if (!(Number.isFinite(x) && x > 0)) x = Number(i.centerPt);
  if (!(Number.isFinite(x) && x > 0)) return; // 本条采样没有角色横向坐标（如 no-pet-window 行）→ 跳过
  shakeDetector.feed({ t: now, x });
}

function ensureShakeDetector() {
  if (!cfg) return null;
  if (!shakeDetector) {
    shakeDetector = new ShakeDetector({ shake: cfg.interaction.shake, onTrigger: (stats) => onShakeTrigger(stats) });
  } else {
    shakeDetector.configure(cfg.interaction.shake);
  }
  return shakeDetector;
}

/**
 * 应用抖动运行参数：采样间隔 + 检测器配置 + 启动宽限重置。
 * 采样间隔：抖动判定专用 detectMs（默认 125ms，petprobe 下限 120），与 liveFollow.detectMs 取小者；
 * 未启用抖动时保持 liveFollow.detectMs 原值（不改变旧行为）。
 */
function applyShakeRuntime(reason) {
  if (!cfg) return;
  const sc = cfg.interaction.shake;
  const baseMs = Math.max(120, cfg.liveFollow.detectMs || 250);
  const wantMs = sc.enabled ? Math.max(120, sc.detectMs || 125) : baseMs;
  const intervalMs = Math.min(baseMs, wantMs);
  if (locator && typeof locator.setIntervalMs === 'function') {
    const changed = locator.setIntervalMs(intervalMs);
    if (changed) logger.write(`petprobe interval ${locator.intervalMs}ms（shake detectMs=${sc.detectMs} liveFollow.detectMs=${baseMs}）`);
  }
  ensureShakeDetector();
  shakeDetector.reset(Date.now(), reason);
  logger.write(`shake reset reason=${reason} enabled=${sc.enabled} windowMs=${sc.windowMs} reverse=${sc.reverseCount} amp=${sc.minAmplitudePt} path=${sc.minPathPt} quiet=${sc.quietGapMs} grace=${sc.startupGraceMs} detect=${intervalMs}ms`);
}

// ---------------- 点击穿透 / 交互 ----------------
function onPanelClick() {
  if (!cfg) return;
  if (expanded) { toggleDetail('click'); return; }
  if (cfg.clickThrough || !cfg.interaction.expandOnClick) return;
  toggleDetail('click');
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
    if (ok) {
      if (locator && !locator.proc) { logger.write('screen permission granted (guide retry) -> start petprobe'); locator.start(); }
      setTimeout(() => { if (guideWin && !guideWin.isDestroyed()) guideWin.close(); startPanelIfReady(); }, 600);
    }
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
/**
 * 设置面板原生窗口层级。
 *
 * Coopanion 的聊天气泡与桌宠同属 floating 层。头顶饭桶必须落在气泡下方，不能
 * 使用 screen-saver（它会压住气泡）；floating/-1 是 macOS/Electron 能提供的
 * 最小相对层级。脚下形态仍尊重 position.zOrder，便于复核两种形态的原有语义。
 * 这个函数在建窗和热载时都调用，明细卡 resize / 复用同一窗口时不会回退层级。
 */
function applyPanelWindowLevel(reason) {
  if (!panelWin || panelWin.isDestroyed() || !cfg) return false;
  const head = layoutMod.isHead(cfg);
  const belowBubble = head;
  const requestedBelowPet = cfg.position && cfg.position.zOrder === 'below-pet';
  const level = (belowBubble || requestedBelowPet) ? 'floating' : 'screen-saver';
  const relativeLevel = (belowBubble || requestedBelowPet) ? -1 : 0;
  try {
    panelWin.setAlwaysOnTop(true, level, relativeLevel);
    logger.write(`panel layer level=${level} relative=${relativeLevel} wear=${cfg.display.wear} belowBubble=${belowBubble ? 1 : 0} zOrder=${cfg.position.zOrder} reason=${reason}`);
    return true;
  } catch (e) {
    logger.write(`panel layer failed level=${level} wear=${cfg.display.wear} reason=${reason} err=${String(e && e.message || e)}`);
    return false;
  }
}

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
  // 头顶模式必须在 Coopanion 聊天气泡下层；脚下模式继续尊重 zOrder 配置。
  applyPanelWindowLevel('create');
  try { panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* ignore */ }
  try { panelWin.setIgnoreMouseEvents(!!cfg.clickThrough, { forward: true }); } catch (e) { /* ignore */ }
  panelWin.loadFile(RENDERER_HTML);
  panelWin.webContents.once('did-finish-load', () => {
    logger.write(`display style=${cfg.display.style} bowl=${cfg.display.bowlStyle} labelStyle=${cfg.display.labelStyle} wear=${cfg.display.wear} count=${providerMgr ? providerMgr.views().length : 0} compact=${lay.compact} layout=${cfg.display.nineLayout} rows=${layoutMod.rowCountsText(lay)} groupW=${lay.groupW} groupH=${lay.groupH} wheelH=${lay.wheelH} expanded=${expanded ? 1 : 0}`);
    try { panelWin.webContents.send('pbp:init', { assetDir: assets.assetDir, assets: assetPayload() }); } catch (e) { /* ignore */ }
    setTimeout(() => requestState(true), 60);
  });
  panelWin.on('closed', () => { panelWin = null; panelShown = false; petMissingSince = 0; noPetHidden = false; });
  // #5：先不显示 —— 等第一次定位（或兜底截止）后再 showInactive，避免「先出现在兜底位置再飞到桌宠头顶」
  panelShown = false;
  panelShowDeadline = Date.now() + 2500;
}

// ---------------- 跟随 / 动画 ----------------
function positionTick() {
  if (loopStopped || shotMode) return;
  const started = Date.now();
  petSampleTick(started); // 拖拽瞬态检测（决定本次循环是否冻结 scale；须在 updateCharW 之前）
  probeWatchdog(started); // 0.0.6：petprobe 挂死检测/重启（在采样读取之后，避免重启瞬间丢行号）
  updateCharW();
  try {
    if (!panelWin || panelWin.isDestroyed() || !cfg) { schedulePosition(); return; }
    if (!cfg.enabled) { schedulePosition(); return; }
    const head = layoutMod.isHead(cfg);
    // —— 第 11 轮丁路：桌宠生命周期跟随（桌宠退出 → 隐藏显示窗；桌宠回来 → 自动显示）——
    // —— 第 21 轮甲路：窗口存在性快路径（≤1s 隐藏；capture-error 不误判）——
    // hasPet 口径：定位器的桌宠窗 bounds 有效 且 最近一次真实检测未过期（petinfo 失败时会保留 last-good bounds，
    // 不能只看 windowBounds()，否则桌宠退出后 bounds 仍残留、永远不会隐藏）
    const locState = locator ? locator.status() : null;
    const petBoundsRaw = locator ? locator.windowBounds() : null;
    const hasPet = !!(locState && locState.ok === true && petBoundsRaw && Number.isFinite(petBoundsRaw.x));
    // 窗口存在性（CGWindowList 口径）：true=在 / false=缺失中 / null=信号未知（探针没起或信号过期，走旧兜底）
    const winPresent = locator && typeof locator.windowPresent === 'function' ? locator.windowPresent() : null;
    const winMissingMs = locator && typeof locator.windowMissingMs === 'function' ? locator.windowMissingMs() : 0;
    const hasWin = winPresent !== false;
    const nowPet = Date.now();
    const pastGrace = (nowPet - appStartedAt) >= NO_PET_STARTUP_GRACE_MS;
    let reshowPending = false;
    if (hasPet && hasWin) {
      petMissingSince = 0;
      if (noPetHidden && cfg.enabled) reshowPending = true;
    } else {
      // 起算点用「最后一次成功检测的时间」：petinfo 在新采样失败时不刷新 lastOkAt，
      // 这样「桌宠退出 → 5s 后隐藏」的计时从真·最后一帧算起，而不是等 3s 新鲜度过期后才开始
      if (!petMissingSince) {
        const ageMs = locState && Number.isFinite(locState.ageMs) ? Number(locState.ageMs) : NaN;
        petMissingSince = Number.isFinite(ageMs) ? (nowPet - ageMs) : nowPet;
      }
      const missingMs = nowPet - petMissingSince;
      // 异常兜底（保留原 5s 路径）：只在「窗口存在性信号未知」时生效（探针没起/挂了、信号过期）；
      // 明确判定窗口还在（capture-error 带 wid）→ 不隐藏；明确判定窗口缺失 → 走下面的 600ms 快路径。
      if (!noPetHidden && panelShown && missingMs >= PROBE_DEAD_HIDE_MS && pastGrace && winPresent === null) {
        try { panelWin.hide(); } catch (e) { /* ignore */ }
        panelShown = false;
        noPetHidden = true;
        logger.write(`panel hide reason=no-pet detectFailMs=${Math.round(missingMs)}`);
      }
    }
    // 第 21 轮甲路：快路径 —— 桌宠窗口连续缺失 ≥600ms 立即隐藏（与 5s 兜底互斥：noPetHidden 守卫）
    if (!noPetHidden && panelShown && winPresent === false && winMissingMs >= PET_WINDOW_HIDE_MS && pastGrace) {
      try { panelWin.hide(); } catch (e) { /* ignore */ }
      panelShown = false;
      noPetHidden = true;
      logger.write(`panel hide reason=pet-hidden missingMs=${Math.round(winMissingMs)}`);
    }
    // 第 12 轮甲路：桌宠缺失期间「原地不动」——宽限期保持最后位置直到点隐藏，隐藏后同样不跑兜底 placement。
    // 旧实现会用 computePlacement 的 fallback 坐标 setPosition，导致隐藏前先漂移到屏幕顶部兜底位。
    // 第 21 轮甲路：窗口缺失（hasWin=false）也走这里 —— 从第一帧缺失起就不跑 placement/动画。
    if (!hasWin || !hasPet) { schedulePosition(); return; }
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
    // —— 跟随时序（第 6 轮 A · #5 修复版）——
    // ① 帧率无关：真实 dt 积分（旧版固定 16ms 系数，setTimeout 抖动会改变缓动曲线）
    const tickNow = Date.now();
    const dt = anim.t ? Math.min(0.064, Math.max(0.001, (tickNow - anim.t) / 1000)) : 0.016;
    anim.t = tickNow;
    if (anim.x == null) { anim.x = place.x; anim.y = place.y; anim.vx = 0; anim.vy = 0; anim.tx = place.x; anim.ty = place.y; }
    // #5：窗口还没显示时不做动画，直接贴住当前目标 —— 保证「首次可见」就在最终位置（旧版会先出现在兜底位置再飞过去）
    if (!panelShown) { anim.x = place.x; anim.y = place.y; anim.vx = 0; anim.vy = 0; anim.tx = place.x; anim.ty = place.y; }
    // ② 跨屏：显示器变了 → 直接贴到新目标（不在两屏之间飞）+ 重下发（按新屏 dpr 重绘画布）
    if (place.displayId !== lastDisplayId) {
      if (lastDisplayId != null) {
        logger.write(`display change ${lastDisplayId}->${place.displayId} snap&refresh`);
        anim.x = place.x; anim.y = place.y; anim.vx = 0; anim.vy = 0; anim.tx = place.x; anim.ty = place.y;
        // #1 误触防护 ⑨：换屏 = 坐标基准变了 → 丢掉抖动窗口，不把系统跳变当晃动
        if (shakeDetector) shakeDetector.clear(Date.now());
        requestState(true);
      }
      lastDisplayId = place.displayId;
    }
    // ③ 目标死区：停稳后目标变化 <1px（桌宠呼吸/采样中值抖动）不跟 → 消除「到位后一直微漂」
    const followSettled = anim.vx === 0 && anim.vy === 0;
    if (!followSettled || Math.abs(place.x - anim.tx) >= 1 || Math.abs(place.y - anim.ty) >= 1) {
      anim.tx = place.x; anim.ty = place.y;
    }
    // ④ 临界阻尼跟随（无过冲）；⑤ 去掉旧版「静止时最多向上浮 0.9px」——那是老板看到的上下漂移之一
    const stepX = followAxisStep(anim.x, anim.vx, anim.tx, dt);
    const stepY = followAxisStep(anim.y, anim.vy, anim.ty, dt);
    anim.x = stepX.pos; anim.vx = stepX.vel;
    anim.y = stepY.pos; anim.vy = stepY.vel;
    const stationary = stepX.settled && stepY.settled;
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
        wheelAngle = (wheelAngle + speed * dt * 8) % 360;
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
    const ny = Math.round(anim.y);
    if (nx !== lastPos.x || ny !== lastPos.y) {
      try { panelWin.setPosition(nx, ny, false); } catch (e) { /* ignore */ }
      lastPos = { x: nx, y: ny };
      const nowLog = Date.now();
      if (!positionTick.lastLog || nowLog - positionTick.lastLog > 2000) {
        positionTick.lastLog = nowLog;
        logger.write(`place src=${place.src} petCenter=${place.centerX.toFixed(1)} targetX=${place.x} targetY=${place.y} w=${panelSize.w} h=${panelSize.h} wear=${cfg.display.wear} focusHead=${cfg.display.wear === 'head'} detect=${locator ? JSON.stringify(locator.status()) : '{}'}`);
      }
    }
    // 第 11 轮丁路：桌宠回来 → 自动显示（本帧位置已更新，避免在兜底位置闪一下）
    if (reshowPending && cfg.enabled) {
      try { panelWin.showInactive(); } catch (e) { /* ignore */ }
      panelShown = true;
      noPetHidden = false;
      logger.write('panel show reason=pet-detected');
    }
    // #5：定位就绪（或兜底截止）后才显示窗口，避免启动时在兜底位置闪一下再飞到桌宠头顶
    if (!panelShown && cfg.enabled) {
      // 就绪 = 目标已经来自真实定位（detect/detect），而不是兜底值；兜底截止只防权限异常时窗口不出现
      const detectReady = String(place.src || '').split('/')[0] === 'detect' && String(place.src || '').split('/')[1] === 'detect';
      // 尺寸基准也稳定后（charW 中值有 5 帧）再显示 → 首次可见就是最终尺寸/最终位置（旧版显示后还会重排一次）
      const sizeReady = charWHist.length >= 5 && Number.isFinite(currentCharW());
      // 第 11 轮丁路：启动时没有桌宠要保持隐藏（等检测到再出现），避免登录时无 Coopanion 也弹兜底窗
      if (hasPet && ((detectReady && sizeReady) || Date.now() >= panelShowDeadline)) {
        try { panelWin.showInactive(); } catch (e) { /* ignore */ }
        panelShown = true;
        logger.write(`panel shown detectReady=${detectReady} sizeReady=${sizeReady} src=${place.src} pos=${nx},${ny}`);
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

// ---------------- #4 托盘「测试余额连接…」（只读校验；不显示、不记录任何 key） ----------------
// 数据层：providers.verifyKey(pc) 只读 GET 余额接口 → {ok, code, latencyMs}（不返回密钥）。
// 用户可见：弹窗 ≤3 行摘要（成功 n 家 / 失败分类计数）；日志只记「分类码 + 耗时」，不记 key / 响应体。
const CONN_TEST_MAX_LINES = 3;
/** 分类码 → 短标签（取 errorText 冒号前的第一段，避免另维护一份文案表）。 */
function shortErrorLabel(code) {
  const c = String(code || 'UNKNOWN');
  try {
    const txt = String(providerErrorText(c) || '');
    const head = txt.split('：')[0].split('（')[0].trim();
    if (head) return head;
  } catch (e) { /* ignore */ }
  return c;
}

/** 托盘弹窗的 3 行内摘要（纯函数，可单测）：成功 n 家 / 失败分类计数 / 提示看日志。 */
function buildConnectionSummary(results) {
  const list = Array.isArray(results) ? results : [];
  const nonRice = list.filter(r => r && !r.rice);
  const riceN = list.length - nonRice.length;
  const okN = nonRice.filter(r => r.ok).length;
  const failN = nonRice.length - okN;
  const lines = [];
  let head = `测试完成：成功 ${okN} 家`;
  if (failN > 0) head += ` / 失败 ${failN} 家`;
  if (riceN > 0) head += `（大白饭 ${riceN} 家不联网，已跳过）`;
  lines.push(head);
  if (failN > 0) {
    const order = [];
    const cnt = new Map();
    for (const r of nonRice) {
      if (r.ok) continue;
      const c = String(r.code || 'UNKNOWN');
      if (!cnt.has(c)) { cnt.set(c, 0); order.push(c); }
      cnt.set(c, cnt.get(c) + 1);
    }
    lines.push('失败分类：' + order.slice(0, 4).map(c => `${shortErrorLabel(c)} ×${cnt.get(c)}`).join(' · '));
    lines.push('详情见面板日志（已脱敏，只记分类码）');
  } else {
    lines.push('全部连接正常（详情见面板日志，已脱敏）');
  }
  return lines.slice(0, CONN_TEST_MAX_LINES);
}

/**
 * 对全部 enabled provider 做一次只读主动校验（大白眼档跳过，不联网）。
 * @param {string} source tray | selftest
 * @returns {Promise<{results:Array, lines:string[]}>}
 */
async function runConnectionTest(source) {
  const src = String(source || 'tray');
  if (!cfg) return { results: [], lines: ['配置未加载，无法测试'] };
  const list = (cfg.providers || []).filter(p => p && p.enabled);
  const results = [];
  for (const pc of list) {
    const t0 = Date.now();
    let r = null;
    try {
      r = (pc.type === 'rice')
        ? { ok: true, code: 'OK', rice: true, latencyMs: 0, amount: null }
        : await verifyKey(pc);
    } catch (e) {
      r = { ok: false, code: 'UNKNOWN', latencyMs: Date.now() - t0 };
    }
    if (!r || typeof r !== 'object') r = { ok: false, code: 'UNKNOWN', latencyMs: Date.now() - t0 };
    const item = {
      id: String(pc.id || ''),
      name: String(pc.name || pc.id || ''),
      type: String(pc.type || ''),
      rice: pc.type === 'rice',
      ok: !!r.ok,
      code: r.ok ? 'OK' : String(r.code || 'UNKNOWN'),
      latencyMs: Number(r.latencyMs) || (Date.now() - t0),
      amount: Number.isFinite(r.amount) ? r.amount : null,
    };
    results.push(item);
    // 只记分类码 + 耗时（金额是用户自己的余额，属可展示数据）；不记 key / 响应体 / 完整错误文案
    logger.write(`test-connection source=${src} id=${item.id} ok=${item.ok ? 1 : 0} code=${item.code} ms=${item.latencyMs}` + (item.amount != null ? ` amount=${item.amount}` : ''));
  }
  const lines = buildConnectionSummary(results);
  logger.write(`test-connection done source=${src} tested=${results.filter(r => !r.rice).length} ok=${results.filter(r => !r.rice && r.ok).length} fail=${results.filter(r => !r.rice && !r.ok).length} lines=${lines.length}`);
  return { results, lines };
}

/** 显示 3 行内摘要（系统弹窗；不抢焦点、不带图标）。 */
function showConnectionTestResult(lines) {
  const body = (Array.isArray(lines) ? lines : []).slice(0, CONN_TEST_MAX_LINES).join('\n');
  logger.write(`test-connection dialog lines=${body ? body.split('\n').length : 0}`);
  try {
    if (dialog && typeof dialog.showMessageBox === 'function') {
      return dialog.showMessageBox({ type: 'info', title: '余额连接测试', message: '余额连接测试结果', detail: body, buttons: ['好'], defaultId: 0, noLink: true }).catch(() => {});
    }
  } catch (e) {
    logger.write('test-connection dialog failed ' + String(e && e.message || e));
  }
  return Promise.resolve();
}

/** 托盘菜单项点击入口：跑测试 → 弹摘要（异常只记日志，不弹错误详情）。 */
function runConnectionTestFromTray() {
  logger.write('test-connection tray click');
  return runConnectionTest('tray')
    .then((r) => { if (r) return showConnectionTestResult(r.lines); return null; })
    .catch((e) => { logger.write('test-connection tray failed ' + String(e && e.message || e)); });
}

/** 托盘菜单模板（独立成函数：自测可 dump 标签，不依赖真实 Tray） */
function buildTrayMenuTemplate() {
  return [
    { label: '饭桶余额 · Mac 显示窗', enabled: false },
    { type: 'separator' },
    { label: '立即刷新', click: () => { if (providerMgr) providerMgr.configure(cfg); requestState(true); } },
    { label: expanded ? '收起明细' : '展开明细', click: () => { if (toggleDetail('tray')) { try { tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate())); } catch (e) { /* ignore */ } } } },
    { label: '测试余额连接…', click: () => { runConnectionTestFromTray(); } },
    { label: '打开配置目录', click: () => { try { shell.openPath(configMod.userDir()); } catch (e) { /* ignore */ } } },
    { type: 'separator' },
    { label: '退出', click: () => { trayQuitRequested = true; app.quit(); } },
  ];
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
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
    tray.on('click', () => { if (toggleDetail('tray')) tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate())); });
    logger.write('tray setup ok items=' + buildTrayMenuTemplate().filter(x => x.label).length);
  } catch (e) {
    logger.write('tray setup failed ' + String(e && e.message || e));
  }
}

// ---------------- 启动 ----------------
function startPanelIfReady() {
  if (!panelWin) createPanelWindow();
  // 第 11 轮丁路：因桌宠缺失而隐藏的窗口不在这里复活（等 positionTick 检测到桌宠再显示）
  else if (cfg.enabled && panelShown && !noPetHidden) panelWin.showInactive();
}

function startLoops() {
  if (loopStopped) return;
  providerMgr = new ProviderManager({ onUpdate: () => requestState(true) });
  providerMgr.configure(cfg);
  providerMgr.start();
  if (ARGS.demo > 0) { providerMgr.demoCount = Math.min(9, ARGS.demo); }
  else if (demoMode) { providerMgr.demoCount = 3; }

  // #1：启用了抖动判定时采样间隔取 min(liveFollow.detectMs, shake.detectMs)，默认 250→125ms
  const baseDetectMs = Math.max(120, cfg.liveFollow.detectMs || 250);
  const shakeDetectMs = cfg.interaction.shake.enabled ? Math.max(120, cfg.interaction.shake.detectMs || 125) : baseDetectMs;
  locator = new PetLocator({ binary: PETPROBE, intervalMs: Math.min(baseDetectMs, shakeDetectMs) });
  applyShakeRuntime('loops-start');
  // R-49 系统权限身份闸：先用不弹窗的 preflight 判断；没有「录屏与系统录音」授权时
  // 不启动 petprobe（它会直接退出，不调 SCK、不弹窗），只静默等老板在引导窗授权。
  if (checkScreenPermission()) {
    locator.start();
  } else {
    logger.write('petprobe deferred: no-screen-permission（静默等待授权，不反复请求）');
    setTimeout(() => { if (!loopStopped) showGuideWindow('screen-capture-not-granted'); }, 1200);
  }
  // 静默复查授权（2s 一次，只读状态、不触发系统弹窗）；授权后自动起 petprobe 并收起引导窗
  const permWatchTimer = setInterval(() => {
    if (loopStopped || !locator) { clearInterval(permWatchTimer); return; }
    if (!locator.proc && checkScreenPermission()) {
      logger.write('screen permission granted -> start petprobe');
      locator.start();
      if (guideWin && !guideWin.isDestroyed()) guideWin.close();
      startPanelIfReady();
    }
  }, 2000);

  // 主题轮询（按 pollMs 链式）
  const themeLoop = async () => {
    await pollTheme();
    if (!loopStopped) setTimeout(themeLoop, Math.max(1000, cfg.theme.pollMs));
  };
  setTimeout(themeLoop, 200);
  setTimeout(() => applyTheme('loops-start'), 250);
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
    // #1：抖动手势配置归一化结果（含默认值），随自测 JSON 一起落盘便于回归核对
    interaction: { expandOnClick: cfg.interaction.expandOnClick, shake: cfg.interaction.shake, canExpand: canExpandDetailFor(cfg) },
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

// ---------------- 抖动识别 headless 自测（无窗口、无 GUI；走真实 main.js 代码路径）----------------
// 用法：node main.js --shake-selftest <out.json> --shake-script <in.json> --config <test.json>
// 输入脚本：{ "baseT": 0, "samples": [ {"t":0,"x":100}, {"t":125,"x":140}, {"reset":true,"t":3000}, ... ] }
//   每条 sample = 一次 petprobe 新采样（t=虚拟时钟 ms，x=bodyCenterPt）；经
//   petSampleTick → feedShakeSample → ShakeDetector → onShakeTrigger → toggleDetail('shake') → requestState。
//   petSampleTick / 检测器 / 切换入口 / 日志 / 配置归一化全部是正式代码，只有采样源是脚本注入。
// 输出：每条采样的触发/expanded/检测器窗口状态 + 配置归一化结果 + canExpand + 触发汇总。
function runShakeSelftest(scriptPath, outPath) {
  const out = {
    tool: 'shake-selftest', app: APP_NAME, version: APP_VERSION,
    generatedAt: new Date().toISOString(), scriptPath: String(scriptPath || ''), errors: [],
    shakeConfig: cfg ? cfg.interaction.shake : null,
    interaction: cfg ? cfg.interaction : null,
    clickThrough: cfg ? cfg.clickThrough : null,
    expandOnClick: cfg ? cfg.interaction.expandOnClick : null,
    liveFollowDetectMs: cfg ? cfg.liveFollow.detectMs : null,
    effectiveDetectMs: 0, baseT: 0, canExpand: false,
    steps: [], triggers: [], triggerCount: 0, expandedFinal: false,
  };
  let script = null;
  try { script = JSON.parse(fs.readFileSync(scriptPath, 'utf8')); } catch (e) { out.errors.push('读取 --shake-script 失败: ' + String(e && e.message || e)); }
  if (!cfg) out.errors.push('配置未加载（cfg=null）');
  if (!script && !out.errors.length) out.errors.push('脚本内容为空');
  if (out.errors.length) {
    try { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); } catch (e) { /* ignore */ }
    console.log('shake-selftest failed ->', outPath, out.errors.join('; '));
    app.quit();
    return;
  }
  // 真实采样间隔（与 applyShakeRuntime 同口径）
  const baseMs = Math.max(120, cfg.liveFollow.detectMs || 250);
  const sc = cfg.interaction.shake;
  out.effectiveDetectMs = sc.enabled ? Math.min(baseMs, Math.max(120, sc.detectMs || 125)) : baseMs;
  out.canExpand = canExpandDetailFor(cfg);
  // 假 locator：字段与真实 petprobe 一致；每次喂样前递增 lines 触发 petSampleTick 的「新采样」分支
  locator = {
    lines: 0, info: {}, intervalMs: out.effectiveDetectMs, stopped: false,
    isFresh: () => true, start() {}, stop() {}, setIntervalMs() { return false; },
    windowBounds: () => null, headY: () => 800, feetY: () => 900, centerX: () => 0,
    status: () => ({ ok: true, fake: true }),
  };
  panelShown = true; // 无窗自测：让 feedShakeSample 走「面板已显示」分支
  sampleLineSeen = -1;
  expanded = false;
  ensureShakeDetector();
  const baseT = Number.isFinite(Number(script.baseT)) ? Number(script.baseT) : 0;
  shakeDetector.reset(baseT, 'shake-selftest');
  out.baseT = baseT;
  logger.write(`shake reset reason=shake-selftest enabled=${sc.enabled} windowMs=${sc.windowMs} reverse=${sc.reverseCount} amp=${sc.minAmplitudePt} path=${sc.minPathPt} quiet=${sc.quietGapMs} grace=${sc.startupGraceMs} detect=${out.effectiveDetectMs}ms`);
  for (const item of (Array.isArray(script.samples) ? script.samples : [])) {
    const t = Number(item && item.t);
    if (!Number.isFinite(t)) { out.steps.push({ invalid: true, raw: item }); continue; }
    if (item && item.reset) {
      shakeDetector.reset(t, 'case-reset');
      expanded = false;
      out.steps.push({ t, reset: true, expanded, canExpand: canExpandDetailFor(cfg) });
      continue;
    }
    const x = Number(item && item.x);
    locator.lines += 1;
    locator.info = { bodyCenterPt: x, centerPt: x, headPt: 800, feetY: 900, charWpt: 86.5 };
    lastShakeTrigger = null;
    petSampleTick(t);
    const trig = lastShakeTrigger;
    if (trig) out.triggers.push(trig);
    out.steps.push({
      t, x, triggered: !!trig, trigger: trig || null,
      expanded, state: shakeDetector.state(t),
    });
  }
  out.expandedFinal = expanded;
  out.triggerCount = out.triggers.length;
  try { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); } catch (e) { out.errors.push('写输出失败: ' + String(e && e.message || e)); }
  console.log('shake-selftest ->', outPath, 'steps=' + out.steps.length, 'triggers=' + out.triggers.length);
  logger.write(`shake-selftest steps=${out.steps.length} triggers=${out.triggers.length}`);
  app.quit();
}

// ---------------- #4 安全数据层接入 · headless 自测（无窗口；真实 providers.js） ----------------
// 用法：node main.js --security-selftest <out.json> --config <测试配置>
// 内容：① 「测试余额连接…」同一函数（providers.verifyKey 只读校验）→ 每家分类码 + 3 行内摘要；
//      ② 拉真实 views() → buildDetail() → 明细卡每行副标题（失败行带分类中文）；
//      ③ 未知分类码回退文案 + 托盘菜单标签 dump（证明新入口存在）。
async function runSecuritySelftest(outPath) {
  const out = {
    tool: 'security-selftest', app: APP_NAME, version: APP_VERSION,
    generatedAt: new Date().toISOString(), configPath: configPathUsed, errors: [],
    env: { platform: process.platform, arch: process.arch, electron: process.versions.electron || '', node: process.version },
    connection: null, menuLabels: [], detail: null, unknownFallback: '',
    limits: { summaryMaxLines: CONN_TEST_MAX_LINES },
  };
  try { out.menuLabels = buildTrayMenuTemplate().map(it => (it && it.type === 'separator') ? '---' : String((it && it.label) || '')); }
  catch (e) { out.errors.push('menu: ' + String(e && e.message || e)); }
  try {
    const conn = await runConnectionTest('selftest');
    out.connection = { results: conn.results, lines: conn.lines, lineCount: (conn.lines || []).length };
  } catch (e) { out.errors.push('connection: ' + String(e && e.message || e)); }
  // 等 ProviderManager 首轮结果，取真实 views 构建明细卡（桌面真实状态；超时 12s）
  try {
    providerMgr = new ProviderManager({ onUpdate: () => requestState(true) });
    providerMgr.configure(cfg);
    providerMgr.start();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const vs = providerMgr.views();
      const pending = vs.filter(v => !v.rice && !v.hasResult).length;
      if (vs.length && pending === 0) break;
      await new Promise(r => setTimeout(r, 120));
    }
    const views = providerMgr.views();
    const w = detailCardWidthNeeded(views, 240, 460);
    const h = 34 + views.length * 30 + 24;
    const detail = buildDetail(views, w, h);
    out.detail = {
      count: views.length, w, h, title: detail.title, footer: detail.footer,
      rows: detail.rows.map((r, i) => ({
        name: r.name, amountText: r.amountText, ok: r.ok, rice: r.rice,
        errorCode: r.errorCode, sub: r.sub,
        viewOk: !!(views[i] && views[i].ok), viewHasResult: !!(views[i] && views[i].hasResult),
      })),
    };
    try { providerMgr.stop(); } catch (e) { /* ignore */ }
  } catch (e) { out.errors.push('detail: ' + String(e && e.message || e)); }
  // 未知分类码回退（不依赖真实数据）
  try {
    const fake = buildDetail([{ name: '未知码', rice: false, ok: false, hasResult: true, errorCode: 'NO_SUCH_CODE_XYZ', threshold: 5, intervalSec: 60, amount: null, currency: 'CNY', low: false }], 300, 80);
    out.unknownFallback = fake.rows[0] ? fake.rows[0].sub : '';
  } catch (e) { out.errors.push('unknown: ' + String(e && e.message || e)); }
  try { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); } catch (e) { out.errors.push('write: ' + String(e && e.message || e)); }
  console.log('security-selftest ->', outPath, 'conn=' + (out.connection ? out.connection.results.length : 0), 'detailRows=' + (out.detail ? out.detail.rows.length : 0), 'errors=' + out.errors.length);
  logger.write(`security-selftest conn=${out.connection ? out.connection.results.length : 0} detailRows=${out.detail ? out.detail.rows.length : 0} errors=${out.errors.length}`);
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
    // 3) 3 种饭桶（白瓷 / 黑陶 / 不锈钢；搪瓷已下线，旧配置 enamel 会回退白瓷）
    for (const bowl of ['porcelain', 'black', 'steel']) {
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
    } else if (panelWin && !panelWin.isDestroyed() && panelShown) {
      panelWin.showInactive();
    }
  });

  if (ARGS.quit) { app.quit(); }

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    try { if (process.platform === 'darwin' && app.dock) app.dock.hide(); } catch (e) { /* ignore */ }
    logger.init();
    logger.write(`start ${APP_NAME} v${APP_VERSION} electron=${process.versions.electron} platform=${process.platform} ${process.arch}`);
    // 改名兼容（2026-11-02）：首次启动把旧配置目录的数据迁到新目录（旧目录保留、幂等、不覆盖新文件）。
    try {
      const mig = configMod.migrateLegacyUserData();
      if (mig.migrated) logger.write(`config migrated from legacy dir -> ${mig.to} files=${mig.copied.length}（旧目录原样保留；兼容回退）`);
    } catch (e) { logger.write('WARN config migrate failed ' + String(e && e.message || e)); }
    setupIpc();
    loadConfig();
    installThemeWatch();
    if (ARGS.selftest) { runSelftest(ARGS.selftest); return; }
    if (ARGS.shakeSelftest) { runShakeSelftest(ARGS.shakeScript, ARGS.shakeSelftest); return; }
    if (ARGS.securitySelftest) { runSecuritySelftest(ARGS.securitySelftest).catch((e) => { logger.write('security-selftest fatal ' + String(e && e.message || e)); app.quit(); }); return; }
    if (ARGS.connUiSelftest) {
      // 真机验证「托盘测试余额连接…」的弹窗路径：跑同一函数 → 弹同一摘要 → 外部按 Esc 关闭后退出
      setTimeout(async () => {
        const rec = { tool: 'conn-ui-selftest', lines: [], dialogShown: false, dialogClosed: false, error: '', startedAt: new Date().toISOString() };
        try {
          const r = await runConnectionTest('tray');
          rec.lines = (r && r.lines) || [];
          logger.write('conn-ui-selftest lines=' + rec.lines.length);
          const p = showConnectionTestResult(rec.lines);
          rec.dialogShown = true;
          await p;
          rec.dialogClosed = true;
          rec.closedAt = new Date().toISOString();
          logger.write('conn-ui-selftest closed');
        } catch (e) {
          rec.error = String(e && e.message || e);
          logger.write('conn-ui-selftest failed ' + rec.error);
        }
        try { fs.writeFileSync(ARGS.connUiSelftest, JSON.stringify(rec, null, 2)); } catch (e) { /* ignore */ }
        app.quit();
      }, 2000);
      return;
    }
    scanAssets();
    assetSignature = assets.signature;
    applyTheme('boot'); // #7：启动即按系统深浅色出首帧（不再先深色后切）

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
