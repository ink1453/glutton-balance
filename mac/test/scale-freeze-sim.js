#!/usr/bin/env node
'use strict';
/**
 * 拖拽冻结 scale · 离线仿真/回归（不启动 GUI、不依赖 Electron、不碰显示窗）
 *
 * 用 B1 真机「10 秒跟随 + 3 次拖桌宠」轨迹（evidence/b1-recheck/05-跟随-桌宠轨迹.jsonl）
 * 回放给 app/main.js 里「拖拽抖动抑制」代码块本身（从源文件抽取后原样执行，不是复制品）：
 *   每 16ms 一个位置循环（≈60fps）；每 ~250ms 一条 petprobe 采样（与 watch --interval 250 同口径）。
 * 对比：
 *   旧逻辑 = 第 2 轮（无冻结）—— 应在 3 段拖拽里各重定一次盆宽基准（复现 B1 §3 的瞬时变大）；
 *   新逻辑 = 当前 main.js —— 拖拽全程冻结，0 次重定基准；解冻后基准不变（盆宽平滑恢复）。
 *
 * 用法：node app/test/scale-freeze-sim.js [轨迹.jsonl]
 * 退出码：0=全部断言通过；1=有断言失败（打印失败项）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN_JS = path.join(APP_DIR, 'main.js');
const TICK_MS = 16;                       // 位置循环周期（main.js schedulePosition 的 16ms）
const DESIGN_PET_W = 77.0;                // src/layout.js DESIGN_PET_W
const RELAYOUT_CW = 0.03 * DESIGN_PET_W;  // main.js：graphicsScale 变化 ≥0.03 才重排 → 约 2.31pt 角色宽
const HIGH_CW = 100;                      // 「瞬时变大」判定：角色宽 >100pt（正常 87.5pt）

function fail(msgs) {
  console.log('\n❌ 仿真断言失败：');
  for (const m of msgs) console.log('   - ' + m);
  process.exit(1);
}

// ---------- 1. 从 main.js 抽取「拖拽抖动抑制」代码块（原样执行） ----------
function loadGuardBlock() {
  const src = fs.readFileSync(MAIN_JS, 'utf8');
  const startMark = '// 实测角色宽（pt）中值（最近 7 帧）';
  const endMark = '// ---------------- 配置 ----------------';
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark);
  if (a < 0 || b <= a) fail(['main.js 里找不到拖拽冻结代码块（标记 ' + startMark + ' / ' + endMark + '）']);
  const block = src.slice(a, b);
  if (block.indexOf('petSampleTick') < 0 || block.indexOf('scaleFrozen') < 0) {
    fail(['main.js 抽取到的代码块里没有 petSampleTick / scaleFrozen（修复是否被改动？）']);
  }
  return block;
}

function makeNewLogic(block) {
  const logs = [];
  const ctx = vm.createContext({
    locator: { lines: 0, info: null },
    logger: { write: (s) => logs.push({ t: ctx.__t || 0, s: s }) },
    console: console,
  });
  vm.runInContext(block + `
;globalThis.__api = {
  petSampleTick: petSampleTick,
  updateCharW: updateCharW,
  currentCharW: currentCharW,
  state: () => ({ lockedCharW: lockedCharW, charWDrift: charWDrift, scaleFrozen: scaleFrozen, hist: charWHist.slice() }),
};`, ctx, { filename: 'main.js#scale-freeze' });
  return { api: ctx.__api, ctx: ctx, logs: logs };
}

// 旧逻辑（第 2 轮，无冻结）：与改前 main.js 逐行同口径
function makeOldLogic() {
  const st = { hist: [], locked: NaN, drift: 0 };
  return {
    state: () => ({ lockedCharW: st.locked, scaleFrozen: false, hist: st.hist.slice() }),
    update: (cw) => {
      if (Number.isFinite(cw) && cw > 20) {
        st.hist.push(cw);
        if (st.hist.length > 7) st.hist.shift();
      }
    },
    current: () => {
      if (!st.hist.length) return NaN;
      const a = st.hist.slice().sort((x, y) => x - y);
      const med = a[Math.floor(a.length / 2)];
      if (!Number.isFinite(st.locked)) { st.locked = med; return st.locked; }
      if (Math.abs(med - st.locked) / st.locked > 0.08) {
        st.drift++;
        if (st.drift >= 20) { st.locked = med; st.drift = 0; }
      } else {
        st.drift = 0;
      }
      return st.locked;
    },
  };
}

// ---------- 2. B1 真机轨迹 → petprobe 采样流（250ms 口径） ----------
function loadSamples(tracePath) {
  if (!fs.existsSync(tracePath)) fail(['找不到 B1 轨迹：' + tracePath]);
  const rows = fs.readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const t0 = rows[0].ts;
  const samples = [];
  let last = -1e9;
  for (const r of rows) {
    if (r.ts - last < 230) continue; // 与 watch --interval 250 同口径（轨迹本身 130–400ms 一条）
    last = r.ts;
    samples.push({
      t: r.ts - t0,
      cx: +r.centerX.toFixed(2),
      headY: +r.top.toFixed(2),
      charW: +(r.bbox[2] - r.bbox[0]).toFixed(2), // bbox 宽 ≈ 产品 watch 口径的 charW（静止 87.5 / 提起 135~145）
    });
  }
  // 补尾部：B1 轨迹在「拖拽提起」态截断（末帧 charW 仍 ~135），真实 watch 下一采样才回稳 87.5。
  // 这里按末帧位置 + 正常 charW 中值补 2.5s 静止稳态采样（标注为 tail，不属于原始轨迹）。
  const normal = rows.map((r) => (r.bbox[2] - r.bbox[0])).filter((w) => w <= 100).sort((a, b) => a - b);
  const normalW = normal[Math.floor(normal.length / 2)];
  const lastS = samples[samples.length - 1];
  const tailFrom = lastS.t + 250;
  for (let t = tailFrom; t <= tailFrom + 2500; t += 250) {
    samples.push({ t: t, cx: lastS.cx, headY: lastS.headY, charW: +normalW.toFixed(2), tail: true });
  }
  return samples;
}

// 归一化：轨迹时间从 0 开始；主循环从 0 跑到最后一帧 + 1.6s（看解冻后的稳态）
function replay(samples, tickFn) {
  let si = 0;
  const endT = samples[samples.length - 1].t + 600;
  const events = [];
  let appliedCw = NaN;
  for (let t = 0; t <= endT; t += TICK_MS) {
    while (si < samples.length && samples[si].t <= t) {
      tickFn.onSample(samples[si], si);
      si += 1;
    }
    tickFn.tick(t);
    const cw = tickFn.current();
    if (Number.isFinite(cw)) {
      if (!Number.isFinite(appliedCw)) { appliedCw = cw; events.push({ t: t, cw: cw, frozen: tickFn.frozen() }); }
      else if (Math.abs(cw - appliedCw) >= RELAYOUT_CW) { appliedCw = cw; events.push({ t: t, cw: cw, frozen: tickFn.frozen() }); }
    }
  }
  return { events: events, endT: endT };
}

function replayNew(samples, block) {
  const L = makeNewLogic(block);
  const ticks = [];
  const r = replay(samples, {
    onSample: (s) => { L.ctx.locator.lines += 1; L.ctx.locator.info = { bodyCenterPt: s.cx, headPt: s.headY, charWpt: s.charW }; },
    tick: (t) => { L.ctx.__t = t; L.api.petSampleTick(t); L.api.updateCharW(); ticks.push({ t: t, cw: null, frozen: L.api.state().scaleFrozen }); },
    current: () => L.api.currentCharW(),
    frozen: () => L.api.state().scaleFrozen,
  });
  return { ret: r, logs: L.logs, api: L.api, finalState: L.api.state(), ticks: ticks };
}

function ymd(n) { return Number(n).toFixed(3); }

// ---------- 3. 主流程 ----------
const tracePath = process.argv[2] || process.env.PBP_TRACE ||
  path.join(__dirname, 'fixtures', 'pet-trajectory.jsonl');
const samples = loadSamples(tracePath);
const block = loadGuardBlock();

console.log('== 拖拽冻结 scale 仿真（不启动 GUI）==');
console.log('main.js: ' + MAIN_JS);
console.log('轨迹:     ' + tracePath);
console.log('采样:     ' + samples.length + ' 条 / ' + ymd(samples[samples.length - 1].t / 1000) + 's（含尾部 2.5s 静止稳态补齐：轨迹在提起态截断）');
console.log('主循环:   ' + TICK_MS + 'ms/帧；盆宽=charW×0.80；重排阈值 ΔcharW≥' + RELAYOUT_CW.toFixed(2) + 'pt');

// --- 3.1 旧逻辑：复现 B1 §3 现象 ---
// 旧逻辑需要「每个 tick 都 push 当前采样」：重写一个按采样推进的驱动器
function runOldFull(samples) {
  const L = makeOldLogic();
  let si = 0;
  let cur = null;
  const events = [];
  let applied = NaN;
  const endT = samples[samples.length - 1].t + 600;
  for (let t = 0; t <= endT; t += TICK_MS) {
    while (si < samples.length && samples[si].t <= t) { cur = samples[si]; si += 1; }
    L.update(cur ? cur.charW : NaN);
    const cw = L.current();
    if (Number.isFinite(cw)) {
      if (!Number.isFinite(applied)) { applied = cw; events.push({ t: t, cw: cw }); }
      else if (Math.abs(cw - applied) >= RELAYOUT_CW) { applied = cw; events.push({ t: t, cw: cw }); }
    }
  }
  return events;
}

const highSamples = samples.filter((s) => s.charW > HIGH_CW);
const oldEvents = runOldFull(samples);
const oldHigh = oldEvents.filter((e) => e.cw > HIGH_CW);

// --- 3.2 新逻辑（当前 main.js 代码块）---
const newRun = replayNew(samples, block);
const newEvents = newRun.ret.events;
const newHigh = newEvents.filter((e) => e.cw > HIGH_CW);
const begins = newRun.logs.filter((x) => x.s.indexOf('scale freeze begin') >= 0);
const ends = newRun.logs.filter((x) => x.s.indexOf('scale freeze end') >= 0);
const finalState = newRun.finalState;

// 冻结覆盖检查：凡是「采样 charW>100」的 tick，必须处于冻结中
const freezeIntervals = [];
{
  // 用日志 begin/end 配对出冻结区间（begin 后最近一个 end）
  const bs = begins.map((x) => x.t).sort((a, b) => a - b);
  const es = ends.map((x) => x.t).sort((a, b) => a - b);
  let j = 0;
  for (const b of bs) {
    while (j < es.length && es[j] <= b) j += 1;
    freezeIntervals.push({ from: b, to: j < es.length ? es[j] : Infinity });
  }
}
const inFreeze = (t) => freezeIntervals.some((iv) => t >= iv.from && t < iv.to);
const highTicks = [];
{
  let si = 0, cur = null;
  for (let t = 0; t <= newRun.ret.endT; t += TICK_MS) {
    while (si < samples.length && samples[si].t <= t) { cur = samples[si]; si += 1; }
    if (cur && cur.charW > HIGH_CW) highTicks.push(t);
  }
}
// 未被冻结覆盖的高 charW tick：允许短暂「采样尾巴」（冻结到期后、下一条采样到来前），
// 但连续段必须 <20 帧（=0.32s 重定基准阈值），即不会触发重定基准 → 盆宽不抖。
const uncoveredHighTicks = highTicks.filter((t) => !inFreeze(t));
let maxUncoveredRun = 0;
{
  let run = 0, prev = -1e9;
  for (const t of highTicks) {
    if (inFreeze(t)) { run = 0; prev = -1e9; continue; }
    if (t - prev <= TICK_MS + 1) run += 1; else run = 1;
    prev = t;
    if (run > maxUncoveredRun) maxUncoveredRun = run;
  }
}

console.log('\n-- 旧逻辑（第 2 轮，无冻结）--');
console.log('盆宽基准重定事件 ' + oldEvents.length + ' 次；其中「变大」(' + HIGH_CW + 'pt 以上) ' + oldHigh.length + ' 次');
for (const e of oldEvents) console.log('   t=' + ymd(e.t / 1000) + 's  charW→' + ymd(e.cw));
console.log('\n-- 新逻辑（当前 main.js）--');
console.log('冻结 ' + begins.length + ' 段 / 解冻 ' + ends.length + ' 次');
for (const b of begins) {
  const iv = freezeIntervals.find((x) => x.from === b.t) || { to: NaN };
  console.log('   t=' + ymd(b.t / 1000) + 's → ' + ymd(iv.to / 1000) + 's（' + (isFinite(iv.to) ? ymd(iv.to - b.t) : '?') + 'ms）  ' + b.s.slice(0, 60) + '…');
}
console.log('盆宽基准重定事件 ' + newEvents.length + ' 次；其中「变大」' + newHigh.length + ' 次');
for (const e of newEvents) console.log('   t=' + ymd(e.t / 1000) + 's  charW→' + ymd(e.cw));
console.log('结束时：frozen=' + finalState.scaleFrozen + '  locked=' + finalState.lockedCharW);
console.log('高 charW 采样共 ' + highTicks.length + ' 个 tick；未处于冻结的 ' + uncoveredHighTicks.length + ' 个（最长连续 ' + maxUncoveredRun + ' 帧，<20 帧重定基准阈值即安全）');

// --- 3.3 真实尺寸变化（静止换皮肤/改缩放）：仍应在合理时间内生效 ---
function fakeStream(totalMs, changeAt, before, after) {
  const out = [];
  for (let t = 0; t <= totalMs; t += 250) out.push({ t: t, cx: 1296.0, headY: 786.5, charW: t < changeAt ? before : after });
  return out;
}
function adoptTimeNew(samples2, block2) {
  const L = makeNewLogic(block2);
  let si = 0, cur = null, adopted = NaN;
  const endT = samples2[samples2.length - 1].t;
  for (let t = 0; t <= endT; t += TICK_MS) {
    while (si < samples2.length && samples2[si].t <= t) { cur = samples2[si]; si += 1; L.ctx.locator.lines += 1; L.ctx.locator.info = { bodyCenterPt: cur.cx, headPt: cur.headY, charWpt: cur.charW }; }
    L.ctx.__t = t; L.api.petSampleTick(t); L.api.updateCharW();
    if (!Number.isFinite(adopted) && L.api.currentCharW() >= 104.5) adopted = t;
  }
  return adopted;
}
function adoptTimeOld(samples2) {
  const L = makeOldLogic();
  let si = 0, cur = null, adopted = NaN;
  for (let t = 0; t <= samples2[samples2.length - 1].t; t += TICK_MS) {
    while (si < samples2.length && samples2[si].t <= t) { cur = samples2[si]; si += 1; }
    L.update(cur ? cur.charW : NaN);
    if (!Number.isFinite(adopted) && L.current() >= 104.5) adopted = t;
  }
  return adopted;
}
const changeSamples = fakeStream(8000, 4000, 87.5, 105.0); // 静止 +20% 真实变化
const oldAdopt = adoptTimeOld(changeSamples);
const newAdopt = adoptTimeNew(changeSamples, block);
console.log('\n-- 静态真实尺寸变化（87.5→105.0pt，+20%，无位移）--');
console.log('旧逻辑生效耗时：' + (oldAdopt - 4000) + 'ms；新逻辑生效耗时：' + (newAdopt - 4000) + 'ms（差异=拖拽冻结的保护窗口）');

// ---------- 4. 断言 ----------
const errs = [];
if (oldHigh.length < 3) errs.push('旧逻辑只复现了 ' + oldHigh.length + ' 次「变大」，B1 记录应有 3 次');
if (newHigh.length !== 0) errs.push('新逻辑仍出现 ' + newHigh.length + ' 次「变大」（拖拽期间盆宽仍会抖）');
if (begins.length < 3) errs.push('新逻辑冻结段只有 ' + begins.length + ' 段，应至少覆盖 3 次拖拽');
if (begins.length !== ends.length) errs.push('冻结/解冻次数不配平（' + begins.length + ' / ' + ends.length + '）');
if (begins.length && begins[0].t < 2000) errs.push('静止基线期（0–2s）就误冻结了：t=' + begins[0].t + 'ms');
if (maxUncoveredRun >= 20) errs.push('有连续 ' + maxUncoveredRun + ' 帧 charW>100 时未冻结（≥20 帧会重定基准）');
if (finalState.scaleFrozen) errs.push('仿真结束时仍处于冻结状态（解冻逻辑异常）');
if (Math.abs(finalState.lockedCharW - 87.5) > 4) errs.push('结束时基准 ' + finalState.lockedCharW + ' 偏离正常值 87.5 过远');
if (!Number.isFinite(newAdopt) || newAdopt - 4000 > 2500) errs.push('静态真实尺寸变化没有在 2.5s 内生效（改缩放/换皮肤会被冻住）');
if (!Number.isFinite(oldAdopt)) errs.push('旧逻辑真实尺寸变化未生效（对照组异常）');

console.log('\n结论：' + (errs.length ? '❌ 失败 ' + errs.length + ' 项' : '✅ 全部通过（旧逻辑复现 ≥3 次抖动（B1 记录 3 次）/ 新逻辑 0 次；冻结覆盖全部高 charW 采样；解冻后基准不变；真实尺寸变化仍生效）'));
if (errs.length) fail(errs);
