'use strict';
// 桌宠定位器客户端：spawn native/petprobe watch，解析 JSON 行；中值滤波 + 死区 + 新鲜度；失败保 last-good（不回跳 startX）
// petprobe 输出字段（逻辑点，屏幕坐标）：winX/winY/winW/winH/scale/feetPt/headPt/centerPt/bodyCenterPt/charWpt/charHpt/captureMs/scanMs
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const MAX_AGE_MS = 3000;     // 头顶/脚底锚点超过 3s 视为过期
const STALE_INFO_MS = 15000; // 定位信息超过 15s 视为过期
const FAIL_KEEP_MS = 15000;  // 连续失败时保留 last-good 多久

function median(arr) {
  const a = arr.filter(v => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.floor(a.length / 2)];
}

class PetLocator {
  constructor(opts) {
    this.opts = opts || {};
    this.binary = this.opts.binary;   // petprobe 路径
    this.intervalMs = this.opts.intervalMs || 250;
    this.proc = null;
    this.lines = 0;
    this.lastOkAt = 0;
    this.lastAnyAt = 0;
    this.info = null;                 // 最近一次原始信息
    // 中值滤波缓冲
    this.buf = { feet: [], head: [], center: [], bodyCenter: [], feetT: [], headT: [] };
    this.smoothed = { feet: NaN, head: NaN, center: NaN, bodyCenter: NaN };
    this.smoothedAt = { feet: 0, head: 0, center: 0, bodyCenter: 0 };
    this.failStreak = 0;
    this.permDenied = false;
    this.lastError = '';
  }

  start() {
    if (this.proc) return;
    try {
      if (!fs.existsSync(this.binary)) throw new Error('petprobe not found: ' + this.binary);
      this.proc = spawn(this.binary, ['watch', '--interval', String(this.intervalMs)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let acc = '';
      this.proc.stdout.on('data', (chunk) => {
        acc += chunk.toString('utf8');
        let idx;
        while ((idx = acc.indexOf('\n')) >= 0) {
          const line = acc.slice(0, idx).trim();
          acc = acc.slice(idx + 1);
          if (line) this._onLine(line);
        }
      });
      this.proc.stderr.on('data', (d) => {
        const s = String(d).trim();
        if (s) logger.write('petprobe stderr ' + s.slice(0, 200));
      });
      this.proc.on('exit', (code, sig) => {
        logger.write(`petprobe exit code=${code} sig=${sig}`);
        this.proc = null;
        setTimeout(() => { if (!this.stopped) this.start(); }, 1000); // 崩溃自动重启
      });
      logger.write('petprobe start interval=' + this.intervalMs);
    } catch (e) {
      logger.write('petprobe start failed ' + String(e && e.message || e));
    }
  }

  stop() {
    this.stopped = true;
    if (this.proc) { try { this.proc.kill('SIGTERM'); } catch (e) { /* ignore */ } this.proc = null; }
  }

  _onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch (e) { return; }
    this.lines++;
    this.lastAnyAt = Date.now();
    if (m.reason && String(m.reason).indexOf('screen-permission') >= 0) this.permDenied = true;
    if (!m.ok) {
      // fast / 失败行也可能带窗口 bounds（CGWindowList 不需要权限、几乎瞬时）→ 先用于兜底定位
      if (m.wid) {
        this.info = {
          wid: m.wid, winX: m.winX, winY: m.winY, winW: m.winW, winH: m.winH,
          scale: m.scale || 2, feetPt: NaN, headPt: NaN, centerPt: NaN, bodyCenterPt: NaN,
        };
        this.boundsOnlyAt = Date.now();
      }
      if (!m.fast) { this.failStreak++; this.lastError = String(m.reason || 'unknown'); }
      return;
    }
    this.failStreak = 0;
    this.lastOkAt = Date.now();
    const clean = {
      wid: m.wid, winX: m.winX, winY: m.winY, winW: m.winW, winH: m.winH, scale: m.scale || 2,
      feetPt: m.feetPt, headPt: m.headPt, centerPt: m.centerPt, bodyCenterPt: m.bodyCenterPt,
      charWpt: m.charWpt, charHpt: m.charHpt, captureMs: m.captureMs, scanMs: m.scanMs,
    };
    this.info = clean;
    this._push('feet', m.feetPt);
    this._push('head', m.headPt);
    this._push('center', m.centerPt);
    this._push('bodyCenter', m.bodyCenterPt);
  }

  _push(key, value) {
    if (!Number.isFinite(value) || value < 0) return;
    const arr = this.buf[key];
    arr.push(value);
    if (arr.length > 5) arr.shift();
    const med = median(arr);
    const deadband = (key === 'head' || key === 'bodyCenter') ? 0.75 : 0.75;
    const prev = this.smoothed[key];
    if (!Number.isFinite(prev) || Math.abs(med - prev) >= deadband) {
      this.smoothed[key] = med;
      this.smoothedAt[key] = Date.now();
    }
  }

  ageMs() { return this.lastOkAt ? (Date.now() - this.lastOkAt) : Number.POSITIVE_INFINITY; }
  infoAgeMs() { return this.lastAnyAt ? (Date.now() - this.lastAnyAt) : Number.POSITIVE_INFINITY; }
  isFresh() { return this.ageMs() <= MAX_AGE_MS; }
  isInfoFresh() {
    if (this.boundsOnlyAt && (Date.now() - this.boundsOnlyAt) <= STALE_INFO_MS) return true;
    return this.infoAgeMs() <= STALE_INFO_MS;
  }

  /** 头顶屏幕 y（逻辑点）；不新鲜返回 NaN */
  headY() { return this.isFresh() ? this.smoothed.head : NaN; }
  /** 脚底屏幕 y */
  feetY() { return this.isFresh() ? this.smoothed.feet : NaN; }
  /** 水平锚点：head 用角色本体 bbox 中心，feet 用脚部质心 */
  centerX(wearHead) {
    if (!this.isFresh()) return NaN;
    return wearHead ? this.smoothed.bodyCenter : this.smoothed.center;
  }
  /** 桌宠窗 bounds（逻辑点，屏幕左上原点） */
  windowBounds() {
    const i = this.info;
    if (!i || !Number.isFinite(i.winX)) return null;
    return { x: i.winX, y: i.winY, width: i.winW, height: i.winH, scale: i.scale || 2 };
  }
  hasBounds() { return !!this.windowBounds(); }
  status() {
    return {
      ok: this.isFresh(), infoOk: this.isInfoFresh(), ageMs: this.ageMs(), lines: this.lines,
      failStreak: this.failStreak, permDenied: this.permDenied, lastError: this.lastError,
      feetY: this.feetY(), headY: this.headY(),
    };
  }
}

module.exports = { PetLocator };
