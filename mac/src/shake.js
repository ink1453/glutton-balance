'use strict';
// 饭桶余额 · Mac 显示窗 · 「晃晕唤出余额面板」手势检测（纯逻辑模块，无 electron 依赖、可单测）
//
// 定稿依据：materials/交互-晃晕唤出余额面板-20261101.md（老板 2026-11-01 点选方案 A）
//   A = 来回拖拽抖动：2 秒内左右方向反转 ≥4 次 → 唤出余额明细卡；再抖一次收起；不自动消失。
//
// 为什么只认「方向反转」：把大肥鱼拖到屏幕另一边也是大幅位移，但那是搬家不是晃晕；
//   「左右反转」才是晃的动作特征。幅度/间隔/总行程/安静期四重门槛负责防误触。
//
// 输入：petprobe 采样流（main.js 的 petSampleTick 里，每条新采样喂一次 {t, x}）
//   t = ms（Date.now 或虚拟时钟，自测用虚拟时钟）
//   x = 角色本体 bbox 中心的屏幕 x（逻辑点；main.js 取 locator.info.bodyCenterPt）
// 输出：feed() 返回 { triggered, stats }；触发时先回调 onTrigger(stats)，再由 main.js 切 detail。
//
// 状态机（与定稿文档 3.1 一致）：
//   IDLE（空闲）→ 采到一段有效方向移动（|Δx| ≥ minAmplitudePt）→ COLLECT（收集窗口）
//   COLLECT：每次方向反转（间隔 ≥ minReverseIntervalMs）计数 +1；窗口滑动丢弃 2s 前的样本
//     ├─ 窗口内反转 ≥ reverseCount 且 总行程 ≥ minPathPt → TRIGGER（回调一次）
//     ├─ 出现「静止」≥ quietGapMs（无达标位移）→ 清空窗口回 IDLE
//     └─ 数据过期（> staleMs）/ 启动宽限期内 / 坐标突变（> jumpResetPt）→ 清空
//   TRIGGER → DISARM：继续跟运动但不再计数；安静 ≥ quietGapMs 后重新武装（→ IDLE）
//   ——「安静」按「没有达标的方向移动」算（不是按有没有采样）：晃完松手大肥鱼停住即安静；
//      持续晃动则一直保持 DISARM → 同一次拖拽只切换一次。

const DEFAULTS = {
  enabled: true,
  windowMs: 2000,           // 滑动时间窗（老板口径「2 秒内」）
  reverseCount: 4,          // 窗口内左右方向反转 ≥4 次 → 触发（即至少 5 段方向不同的移动）
  minAmplitudePt: 12,       // 单段位移 ≥12 逻辑点才算一次「有效方向移动」（滤手抖/呼吸动画）
  minReverseIntervalMs: 80, // 相邻（计入的）反转至少隔 80ms（滤毛刺）
  minPathPt: 80,            // 窗口内累计水平行程 ≥80pt（滤原地小幅抖动）
  quietGapMs: 600,          // 静止 ≥600ms：清窗 / 触发后重新武装（同一次拖拽只切一次）
  startupGraceMs: 3000,     // 启动 / 配置重载后 3s 宽限（等面板定位/尺寸稳定）
  staleMs: 300,             // petprobe 数据断档 >300ms → 丢弃窗口重新开始
  jumpResetPt: 240,         // 单次采样水平突变 >240pt → 视为换屏/系统跳变，清窗；normal级晃动远小于此值
  detectMs: 125,            // 抖动判定专用采样间隔（petprobe 下限 120ms；main.js 取与 liveFollow.detectMs 的较小值）
};

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function clampNum(v, lo, hi, dflt) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = dflt;
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}
function int(v, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : dflt; }
function bool(v, dflt) { return typeof v === 'boolean' ? v : dflt; }
function round1(v) { return Math.round(v * 10) / 10; }

/** 配置归一化：缺字段用默认值（旧配置不用改），越界夹紧；未知字段忽略。 */
function normalizeShake(raw) {
  const o = isObj(raw) ? raw : {};
  return {
    enabled: bool(o.enabled, DEFAULTS.enabled),
    windowMs: int(clampNum(o.windowMs, 500, 10000, DEFAULTS.windowMs), DEFAULTS.windowMs),
    reverseCount: int(clampNum(o.reverseCount, 2, 12, DEFAULTS.reverseCount), DEFAULTS.reverseCount),
    minAmplitudePt: clampNum(o.minAmplitudePt, 2, 200, DEFAULTS.minAmplitudePt),
    minReverseIntervalMs: int(clampNum(o.minReverseIntervalMs, 0, 1000, DEFAULTS.minReverseIntervalMs), DEFAULTS.minReverseIntervalMs),
    minPathPt: clampNum(o.minPathPt, 0, 2000, DEFAULTS.minPathPt),
    quietGapMs: int(clampNum(o.quietGapMs, 100, 5000, DEFAULTS.quietGapMs), DEFAULTS.quietGapMs),
    startupGraceMs: int(clampNum(o.startupGraceMs, 0, 60000, DEFAULTS.startupGraceMs), DEFAULTS.startupGraceMs),
    staleMs: int(clampNum(o.staleMs, 100, 5000, DEFAULTS.staleMs), DEFAULTS.staleMs),
    jumpResetPt: clampNum(o.jumpResetPt, 50, 5000, DEFAULTS.jumpResetPt),
    detectMs: int(clampNum(o.detectMs, 100, 1000, DEFAULTS.detectMs), DEFAULTS.detectMs),
  };
}

function sameShake(a, b) {
  if (!a || !b) return false;
  return Object.keys(DEFAULTS).every((k) => a[k] === b[k]);
}

class ShakeDetector {
  /**
   * @param {object} [opts]
   * @param {object} [opts.shake]     interaction.shake 配置（可为空 → 默认值）
   * @param {function} [opts.onTrigger] 触发回调：onTrigger(stats)
   */
  constructor(opts) {
    const o = isObj(opts) ? opts : {};
    this.cfg = normalizeShake(o.shake);
    this.onTrigger = (typeof o.onTrigger === 'function') ? o.onTrigger : null;
    this._resetState(0);
  }

  /** 运行期热更新配置；返回是否发生变化（调用方据此决定是否 reset）。 */
  configure(raw) {
    const next = normalizeShake(raw);
    const changed = !sameShake(this.cfg, next);
    this.cfg = next;
    return changed;
  }

  _resetState(now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : 0;
    this.lastT = NaN;
    this.lastX = NaN;
    this.anchorX = NaN;
    this.dir = 0;
    this.reversals = [];
    this.segments = [];
    this.lastReboundAt = -Infinity;
    this.lastMotionAt = t;
    this.armAt = t + this.cfg.startupGraceMs;
    this.disarmed = false;
    this.triggerCount = 0;
    this.lastTriggerAt = 0;
    this.lastTriggerStats = null;
    this.lastReason = '';
    this.lastClear = '';
  }

  /** 启动 / 配置重载 / 换屏后重置：清空窗口 + 重新进入启动宽限。 */
  reset(now, reason) {
    const t = Number.isFinite(Number(now)) ? Number(now) : 0;
    this._resetState(t);
    this.lastReason = String(reason || 'reset');
    return this;
  }

  /** 只清窗口（不重置宽限/计数）；换屏、坐标跳变时用。 */
  clear(now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : this.lastT;
    this._clearWindow(Number.isFinite(t) ? t : 0);
    this.lastClear = 'explicit';
    return this;
  }

  /** 切换面板后「保持不响应」：防止刚唤出时残留抖动立刻又收起。 */
  hold(now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    this.disarmed = true;
    this._clearWindow(t);
    this.lastMotionAt = t;
    return this;
  }

  _clearWindow(t) {
    this.reversals = [];
    this.segments = [];
    this.anchorX = NaN;
    this.dir = 0;
    this.lastReboundAt = -Infinity;
    if (Number.isFinite(t)) this.lastMotionAt = Math.max(Number.isFinite(this.lastMotionAt) ? this.lastMotionAt : t, t);
  }

  _windowOf(t) {
    const cut = t - this.cfg.windowMs;
    const reversals = [];
    for (const r of this.reversals) if (r >= cut) reversals.push(r);
    const segments = [];
    for (const s of this.segments) if (s.t >= cut) segments.push(s);
    let pathPt = 0;
    for (const s of segments) pathPt += s.dist;
    return { reversals, segments, pathPt };
  }

  /** 当前窗口状态快照（日志/自测/调试用） */
  state(now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : (Number.isFinite(this.lastT) ? this.lastT : 0);
    const w = this._windowOf(t);
    return {
      t,
      enabled: this.cfg.enabled,
      armed: !this.disarmed && t >= this.armAt,
      disarmed: this.disarmed,
      grace: t < this.armAt,
      windowMs: this.cfg.windowMs,
      reversals: w.reversals.length,
      pathPt: round1(w.pathPt),
      triggerCount: this.triggerCount,
      lastTriggerAt: this.lastTriggerAt,
      lastClear: this.lastClear,
    };
  }

  /**
   * 喂一条 petprobe 采样。
   * @param {{t:number, x:number, ok?:boolean}} sample
   * @returns {{triggered:boolean, valid:boolean, stats:object}}
   */
  feed(sample) {
    const s = isObj(sample) ? sample : {};
    const t = Number(s.t);
    const x = Number(s.x);
    const valid = Number.isFinite(t) && Number.isFinite(x) && s.ok !== false;
    if (!valid) return { triggered: false, valid: false, stats: this.state(t) };
    if (!this.cfg.enabled) {
      this.lastT = t;
      this.lastX = x;
      return { triggered: false, valid: true, stats: this.state(t) };
    }

    // ① 采样断档 / 时间倒退：窗口作废重来（不拿旧数据判手势）
    if (Number.isFinite(this.lastT) && (t - this.lastT > this.cfg.staleMs || t < this.lastT)) {
      this._clearWindow(t);
      this.lastClear = 'stale';
    }
    // ② 单次采样水平突变：换屏 / 分辨率变化 / 系统跳变 → 清窗
    if (Number.isFinite(this.lastX) && Math.abs(x - this.lastX) > this.cfg.jumpResetPt) {
      this._clearWindow(t);
      this.lastClear = 'jump';
    }
    this.lastT = t;
    this.lastX = x;

    // ③ 启动宽限：只记录基准，不计数、不触发
    if (t < this.armAt) {
      this.anchorX = x;
      this.dir = 0;
      this.lastMotionAt = t;
      return { triggered: false, valid: true, stats: this.state(t) };
    }

    // ④ DISARM（刚切换完面板）：继续跟踪运动（推后安静计时），安静够久再重新武装
    if (this.disarmed) {
      this._updateMotion(t, x);
      if (t - this.lastMotionAt >= this.cfg.quietGapMs) {
        this.disarmed = false;
        this._clearWindow(t);
        this.lastMotionAt = t;
        return { triggered: false, valid: true, rearmed: true, stats: this.state(t) };
      }
      return { triggered: false, valid: true, stats: this.state(t) };
    }

    // ⑤ ARMED：静止够久 → 清窗回 IDLE；否则累计方向/反转/行程
    if (t - this.lastMotionAt >= this.cfg.quietGapMs) {
      this._clearWindow(t);
      this.lastMotionAt = t;
      this.lastClear = 'quiet';
    }
    const seg = this._updateMotion(t, x);
    if (seg) {
      this.segments.push(seg);
      if (seg.reversal) this.reversals.push(seg.t);
    }
    const w = this._windowOf(t);
    if (w.reversals.length >= this.cfg.reverseCount && w.pathPt >= this.cfg.minPathPt) {
      const spanMs = w.reversals.length ? (w.reversals[w.reversals.length - 1] - w.reversals[0]) : 0;
      const stats = {
        t,
        x,
        reversals: w.reversals.length,
        pathPt: round1(w.pathPt),
        spanMs,
        windowMs: this.cfg.windowMs,
        reverseCount: this.cfg.reverseCount,
        minPathPt: this.cfg.minPathPt,
      };
      this.triggerCount++;
      this.lastTriggerAt = t;
      this.lastTriggerStats = stats;
      this._clearWindow(t);
      this.disarmed = true;
      this.lastMotionAt = t;
      if (this.onTrigger) {
        try { this.onTrigger(stats); } catch (e) { /* 回调异常不能打断采样循环 */ }
      }
      return { triggered: true, valid: true, stats: this.state(t), trigger: stats };
    }
    return { triggered: false, valid: true, stats: this.state(t) };
  }

  /**
   * 方向分段：只有 |Δx| ≥ minAmplitudePt 才更新「极值点」并返回一段有效移动。
   * 相邻两段方向不同且间隔 ≥ minReverseIntervalMs → 记一次反转。
   * 返回 null = 未达幅度（手抖/呼吸噪声，不计方向、不刷新安静计时）。
   */
  _updateMotion(t, x) {
    if (!Number.isFinite(this.anchorX)) {
      this.anchorX = x;
      this.dir = 0;
      return null;
    }
    const dx = x - this.anchorX;
    const dist = Math.abs(dx);
    if (!(dist >= this.cfg.minAmplitudePt)) return null;
    const ndir = dx > 0 ? 1 : -1;
    const reversal = this.dir !== 0 && ndir !== this.dir && (t - this.lastReboundAt) >= this.cfg.minReverseIntervalMs;
    if (reversal) this.lastReboundAt = t;
    this.dir = ndir;
    this.anchorX = x;
    this.lastMotionAt = t;
    return { t, dist, reversal };
  }
}

module.exports = { ShakeDetector, normalizeShake, DEFAULTS };
