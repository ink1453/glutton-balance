#!/usr/bin/env node
'use strict';
/**
 * 0.0.6 · 「打游戏时饭桶莫名变大」回归仿真（不启动 GUI、不依赖 Electron、不碰显示窗）
 *
 * 真机证据（2026-11-12 03:04 / 03:39，panel.log）：
 *   ① 03:04 说话气泡把 bbox 撑到 191.5×174（宽 2.2×、高 1.6×，宽高不等比）→ 旧门控只认「稳定 8s」→ 重定基准 → 面板 168×84→258×128；
 *   ② 03:39 再复现：charW 86.5→165.5、charH 107.5→214.0（宽高等比 1.9×，形状门控拦不住）→ 面板 145×72→258×128→15s 后缩回。
 * 因此 0.0.6 用两道门控：
 *   A. 权威门控：Coopanion /api/state 的桌宠 scale / skin.figure 没变 → 像素「变宽」一律不认（气泡/菜单/遮挡都只改像素）；
 *      变窄仍放行（气泡回落 / 启动在气泡态的自愈）；持续 >2min 的不变宽安全阀放行。
 *   B. 形状门控：charH 必须 ≈ lockedCharH×(charW/lockedCharW)（±10%），防不等比气泡；持续 >2min 放行。
 *
 * 本仿真把 main.js 里「角色宽去噪 / 冻结 / 双门控」整块原样抽出来回放（不是复制品）。
 * 用法：node test/scale-gate-sim.js   （退出码 0=全过）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN_JS = path.join(APP_DIR, 'main.js');
const TICK_MS = 16;
const SAMPLE_MS = 250; // petprobe watch --interval 250 同口径

function fail(msgs) {
  console.log('\n❌ 仿真断言失败：');
  for (const m of msgs) console.log('   - ' + m);
  process.exit(1);
}

function loadGuardBlock() {
  const src = fs.readFileSync(MAIN_JS, 'utf8');
  const a = src.indexOf('// 实测角色宽（pt）中值（最近 7 帧）');
  const b = src.indexOf('// ---------------- 配置 ----------------');
  if (a < 0 || b <= a) fail(['main.js 里找不到角色宽去噪代码块']);
  const block = src.slice(a, b);
  for (const mark of ['CHARW_SHAPE_TOL', 'api-gate', 'observeCharWCandidate']) {
    if (block.indexOf(mark) < 0) fail(['代码块里缺少标记：' + mark]);
  }
  return block;
}

function makeLogic(block) {
  const logs = [];
  const ctx = vm.createContext({
    locator: { lines: 0, info: null },
    logger: { write: (s) => logs.push({ t: ctx.__t || 0, s: s }) },
    console: console,
    shotMode: false,
    // Coopanion 权威值（main.js 里是模块级变量；回放时由 __setApi 注入）
    petScale: 1.05,
    petScaleKnown: true,
    petFigure: '',
    __setApi: null,
  });
  vm.runInContext(block + `
;globalThis.__api = {
  petSampleTick: petSampleTick,
  updateCharW: updateCharW,
  currentCharW: currentCharW,
  state: () => ({ lockedCharW: lockedCharW, lockedCharH: lockedCharH, lockedPetScale: lockedPetScale,
                  lockedPetFigure: lockedPetFigure, scaleFrozen: scaleFrozen, pending: charWPending.length }),
};`, ctx, { filename: 'main.js#scale-gate' });
  return { api: ctx.__api, ctx: ctx, logs: logs };
}

/**
 * frames: [{ durMs, charW, charH?, apiScale?, figure? }]
 * apiScale 缺省 = 上一帧（默认 1.05）。
 */
function replay(block, frames) {
  const L = makeLogic(block);
  let t = 0;
  let apiScale = 1.05;
  let figure = '';
  for (const f of frames) {
    if (f.apiScale != null) apiScale = f.apiScale;
    if (f.figure != null) figure = f.figure;
    const end = t + f.durMs;
    for (; t < end; t += TICK_MS) {
      if (t % SAMPLE_MS === 0) {
        L.ctx.locator.lines += 1;
        L.ctx.locator.info = {
          bodyCenterPt: f.cx != null ? f.cx : 1300,
          headPt: 785,
          feetPt: 891.5,
          charWpt: f.charW,
          charHpt: f.charH,
        };
        L.ctx.petScale = apiScale;
        L.ctx.petScaleKnown = true;
        L.ctx.petFigure = figure;
      }
      L.ctx.__t = t;
      L.api.petSampleTick(t);
      L.api.updateCharW();
    }
  }
  return { api: L.api, logs: L.logs, state: L.api.state() };
}

const block = loadGuardBlock();
const base = { charW: 86.5, charH: 107.5 };            // 现场静止真值
const base2 = { charW: 99.5, charH: 106.0 };           // 气泡前被旧门控推高的基准
const bubbleShape = { charW: 191.5, charH: 174.0 };    // 03:04 现场（宽高不等比）
const bubbleUniform = { charW: 165.5, charH: 214.0 };  // 03:39 现场（宽高等比 1.9×）
const scaled15 = { charW: 130.0, charH: 160.0 };       // 用户把桌宠改大 1.5×（等比）
const frames = (f, ms) => ({ durMs: ms, charW: f.charW, charH: f.charH });
const count = (logs, s) => logs.filter((x) => x.s.indexOf(s) >= 0).length;

const results = [];
const push = (name, ok, detail) => results.push({ name, ok, detail });

// A 03:04 气泡（api 不变，宽高不等比）→ 不放大
{
  const r = replay(block, [frames(base2, 3000), frames(bubbleShape, 20000), frames(base2, 2000)]);
  push('A 03:04 不等比气泡不放大', Math.abs(r.state.lockedCharW - 99.5) < 0.6 && count(r.logs, 'baseline accepted') === 0,
    `locked=${r.state.lockedCharW} accepted=${count(r.logs, 'baseline accepted')} api-gate=${count(r.logs, 'api-gate')} shape=${count(r.logs, 'shape-reject')}`);
}

// B 03:39 等比气泡（api 不变）→ 权威门控拦下
{
  const r = replay(block, [frames(base, 3000), frames(bubbleUniform, 20000), frames(base, 2000)]);
  push('B 03:39 等比气泡不放大（权威门控）', Math.abs(r.state.lockedCharW - 86.5) < 0.6 && count(r.logs, 'baseline accepted') === 0,
    `locked=${r.state.lockedCharW} accepted=${count(r.logs, 'baseline accepted')} api-gate=${count(r.logs, 'api-gate')}`);
}

// C 真·缩放：api 1.05→1.5 + 等比像素 → 8s 后接受
{
  const r = replay(block, [frames(base, 3000), { durMs: 14000, charW: scaled15.charW, charH: scaled15.charH, apiScale: 1.5 }]);
  push('C 真·缩放 1.5×（api 变）被接受', Math.abs(r.state.lockedCharW - 130) < 0.6 && count(r.logs, 'baseline accepted') === 1,
    `locked=${r.state.lockedCharW} accepted=${count(r.logs, 'baseline accepted')} api-gate=${count(r.logs, 'api-gate')}`);
}

// D 启动时正好在气泡态（基准 165.5×214）→ 气泡结束像素回落 → 允许缩回
{
  const r = replay(block, [frames(bubbleUniform, 3000), frames(base, 12000)]);
  push('D 气泡态启动后回落能自愈', Math.abs(r.state.lockedCharW - 86.5) < 0.6 && count(r.logs, 'baseline accepted') === 1,
    `locked=${r.state.lockedCharW} accepted=${count(r.logs, 'baseline accepted')}`);
}

// E 权威值长期不变但像素持续变宽 >2min → 安全阀放行（不永久卡死）
{
  const r = replay(block, [frames(base2, 3000), frames(bubbleShape, 140000)]);
  push('E >2min 安全阀放行（不永久卡死）', Math.abs(r.state.lockedCharW - 191.5) < 1.5 && count(r.logs, 'baseline accepted') >= 1 && count(r.logs, 'api-gate-long') >= 1,
    `locked=${r.state.lockedCharW} long=${count(r.logs, 'api-gate-long')} accepted=${count(r.logs, 'baseline accepted')}`);
}

// F 老探针没有 charHpt + api 变（真缩放）→ 不误杀
{
  const r = replay(block, [frames({ charW: 86.5, charH: NaN }, 3000), { durMs: 14000, charW: 130, charH: NaN, apiScale: 1.5 }]);
  push('F 无 charHpt + api 变 → 接受（不误杀）', Math.abs(r.state.lockedCharW - 130) < 0.6 && count(r.logs, 'baseline accepted') === 1,
    `locked=${r.state.lockedCharW} accepted=${count(r.logs, 'baseline accepted')}`);
}

console.log('== 0.0.6 双门控仿真（不启动 GUI）==');
console.log('main.js: ' + MAIN_JS);
for (const r of results) console.log((r.ok ? '✅' : '❌') + ' ' + r.name + '  [' + r.detail + ']');
const bad = results.filter((r) => !r.ok);
if (bad.length) fail(bad.map((r) => r.name + ' → ' + r.detail));
console.log('\n全部断言通过 (' + results.length + '/' + results.length + ')');