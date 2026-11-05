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
// 第 21 轮甲路：窗口存在性信号超过该时长没有任何刷新 → 视为「未知」（探针挂了/没权限），
// 交给 main.js 的 5s 新鲜度兜底，避免拿一条很早的「存在」行永久挡住隐藏。
const WINDOW_SIGNAL_STALE_MS = 3000;

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
    // 第 21 轮甲路：桌宠「窗口存在性」信号（CGWindowList 口径，不依赖 SCK 截图是否成功）
    //   —— ok:true 行或带 wid 的行（含 capture-error）都算「窗口存在」；reason=no-pet-window 记缺失起点。
    //   不能拿「扫描成功/新鲜度」代替：SCK capture-error 时窗口其实还在，用它判缺失会误隐藏。
    this.windowSeenAt = 0;     // 最近一次窗口存在采样时刻 ms
    this.windowMissingAt = 0;  // 窗口连续缺失起点 ms（0=当前存在/未知）
    this.windowSignalAt = 0;   // 最近一次与存在性有关的采样时刻（存在行或 no-pet-window 行）
  }

  start() {
    if (this.proc) return;
    this.stopped = false; // 显式 start = 希望它在跑（配置热载改采样间隔时会 stop→start）
    this.permDenied = false; // R-49：每次显式启动重置权限标记，由首条采样重新判定
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
      const child = this.proc;
      child.on('exit', (code, sig) => {
        logger.write(`petprobe exit code=${code} sig=${sig}`);
        // 只清理自己这一代进程的引用：热载改采样间隔会 stop→start，旧进程的 exit 事件
        // 晚到也不能把新进程引用清掉（否则会重复拉起多个 watcher）
        if (this.proc === child) this.proc = null;
        // R-49：无屏幕录制权限时 petprobe 会直接退出（只做 CGPreflight，不调 SCK、不弹窗）。
        // 此时不做秒级自动重启，避免后台反复请求系统权限；由 App 静默轮询到授权后再显式 start。
        setTimeout(() => {
          if (this.stopped || this.proc) return;
          if (this.permDenied) { logger.write('petprobe auto-restart skipped (no-screen-permission, 等授权后再起)'); return; }
          this.start();
        }, 1000);
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

  /**
   * 运行期改采样间隔（#1 晃晕唤出：抖动判定要用 120~125ms）。
   * 与当前一致返回 false；变了则重启 watcher 并返回 true（petprobe 下限 120ms）。
   */
  setIntervalMs(ms) {
    const next = Math.max(120, Math.round(Number(ms) || 0) || 250);
    if (next === this.intervalMs) return false;
    this.intervalMs = next;
    if (this.proc || this.stopped) {
      this.stop();
      this.start(); // start() 内部复位 stopped
    }
    return true;
  }

  _onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch (e) { return; }
    this.lines++;
    const now = Date.now();
    this.lastAnyAt = now;
    // 第 21 轮甲路：先更新「窗口存在性」信号（独立于定位是否成功）
    //   ok:true  → 窗口存在（同一行必然带窗口信息）
    //   带 wid   → 窗口存在（capture-error / fast warming 行也带 CGWindowList 的窗口号）
    //   reason=no-pet-window → 窗口缺失：记连续缺失起点（已在一段缺失中则不重置）
    const reason = String(m.reason || '');
    if (m.ok === true || m.wid) {
      this.windowSeenAt = now;
      this.windowMissingAt = 0;
      this.windowSignalAt = now;
    } else if (reason === 'no-pet-window') {
      this.windowSignalAt = now;
      if (!this.windowMissingAt) this.windowMissingAt = now;
    }
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
  /**
   * 第 21 轮甲路：桌宠窗口当前是否存在（CGWindowList 口径，不依赖 SCK 截图成功）。
   * 返回：true=存在 / false=连续缺失中 / null=还没有可用信号（探针未起，或信号超过 3s 未刷新）
   */
  windowPresent() {
    const now = Date.now();
    if (!this.windowSignalAt || (now - this.windowSignalAt) > WINDOW_SIGNAL_STALE_MS) return null;
    if (this.windowMissingAt) return false;
    return this.windowSeenAt ? true : null;
  }
  /** 第 21 轮甲路：桌宠窗口连续缺失时长 ms（窗口存在或信号未知 → 0） */
  windowMissingMs() {
    if (!this.windowMissingAt) return 0;
    const now = Date.now();
    if (!this.windowSignalAt || (now - this.windowSignalAt) > WINDOW_SIGNAL_STALE_MS) return 0;
    return Math.max(0, now - this.windowMissingAt);
  }
  status() {
    return {
      ok: this.isFresh(), infoOk: this.isInfoFresh(), ageMs: this.ageMs(), lines: this.lines,
      failStreak: this.failStreak, permDenied: this.permDenied, lastError: this.lastError,
      feetY: this.feetY(), headY: this.headY(),
      windowPresent: this.windowPresent(), windowMissingMs: Math.round(this.windowMissingMs()),
    };
  }
}

module.exports = { PetLocator };
