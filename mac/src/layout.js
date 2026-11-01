'use strict';
// 饭桶余额 Mac 显示窗 · 布局/几何（Win Panel.V3.cs BowlLayout / ComputePlaque / WearMath 的逐项移植）
// 单位：逻辑点（pt，dpiScale=1）；Retina 只影响画布像素密度（renderer 里 *dpr）。
// 对照：spec-panel.md §2.1-2.6、§1.3-1.4；Win 源码 Panel.V3.cs L808-1215。
const DESIGN_PET_W = 77.0;        // 100% 时角色像素宽（Win 实测）
const BOWL_RATIO = 0.80;          // 盆宽 = 角色宽 × 0.80
const COMPACT_RATIO = 0.92;       // 两排/金字塔紧凑档
const ROW_RATIO = 0.80;           // 一排紧凑档
const BOWL_PIXEL_W = 320;         // 内置盆 PNG 宽
const BOWL_PIXEL_H = 290;         // 内置盆 PNG 高

const DEFAULT_ASSET = {
  id: 'porcelain', pixelW: 320, pixelH: 290,
  rice: { x: 44, y: 8, w: 232, h: 276 }, rimY: 54, rimBottom: 80,
};

function max(a, b) { return a > b ? a : b; }
function min(a, b) { return a < b ? a : b; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function ri(v) { return Math.round(v); }

function pyramidCounts(n) {
  if (!(n > 0)) n = 1;
  let k = 1;
  while (k * (k + 1) / 2 < n) k++;
  const rows = [];
  let rem = n, w = k;
  while (rem > 0 && w > 0) {
    const take = rem > w ? w : rem;
    rows.push(take);
    rem -= take;
    w--;
  }
  return rows;
}

/**
 * graphicsScale = clamp(petScale / petScaleRef, graphicsMin(≥0.95), graphicsMax)
 * 2026-11-01 07:24 老板拍板「匹配比例」：传入实测角色宽 charWpt 时，
 * 按 Win 口径「盆宽 = 角色宽 × 0.80」反推 graphicsScale = charWpt / DESIGN_PET_W（77pt）。
 * 这样碗的大小始终按屏幕里桌宠的实际大小等比匹配（以前只按 /api/state scale 算，Mac 上偏小一档）。
 */
function graphicsScale(cfg, petScale, charWpt) {
  const d = (cfg && cfg.display) || {};
  let ref = Number(d.petScaleRef);
  if (!Number.isFinite(ref) || ref < 0.2) ref = 1.05;
  let lo = Number(d.graphicsMin);
  if (!Number.isFinite(lo) || lo < 0.2) lo = 0.95;
  if (lo < 0.95) lo = 0.95; // 硬性可读下限
  let hi = Number(d.graphicsMax);
  if (!Number.isFinite(hi) || hi < lo) hi = 2.0;
  if (Number.isFinite(charWpt) && charWpt > 20) {
    return clamp(charWpt / DESIGN_PET_W, lo, hi);
  }
  let ps = Number(petScale);
  if (!Number.isFinite(ps) || ps <= 0) ps = 1.05;
  return clamp(ps / ref, lo, hi);
}

function isHead(cfg) {
  return !!(cfg && cfg.display && cfg.display.wear === 'head');
}

function isRicebowl(cfg) {
  return !(cfg && cfg.display && cfg.display.style === 'capsule');
}

/**
 * 主布局。返回 {groupW, groupH, ... slots[]}
 * @param cfg 归一化配置
 * @param n 家数
 * @param dpiScale 逻辑缩放（Mac 固定 1；仅 --shot 或未来多屏可用）
 * @param gs graphicsScale（textScale 另算）
 * @param asset {pixelW,pixelH,rice{x,y,w,h},rimY,rimBottom}
 * @param forceNoWheels 强制无轮（head 形态时传 true）
 */
function computeLayout(cfg, n, dpiScale, gs, asset, forceNoWheels) {
  n = Math.max(1, Math.round(n) || 1);
  dpiScale = (dpiScale > 0) ? dpiScale : 1;
  gs = (gs > 0.2) ? gs : 1.0;
  const a = Object.assign({}, DEFAULT_ASSET, asset || {});
  const disp = (cfg && cfg.display) || {};
  const lay = {
    style: 'ricebowl', count: n, dpiScale, graphicsScale: gs, asset: a,
    compact: false, pyramid: false, twoRows: false,
    bowlW: 0, bowlH: 0, gap: 0, groupW: 0, groupH: 0, wheelH: 0,
    frontCount: 0, rowShift: 0, rowCounts: [], slots: [],
    capsuleW: 0, capsuleH: 0, step: 0,
  };
  const capsule = (cfg && cfg.capsule) || { width: 200, height: 30, overlap: 6 };

  if (!isRicebowl(cfg)) {
    // capsule 回退形态：几何保留（Mac 不渲染胶囊，主程序会记日志并退回 ricebowl）
    lay.style = 'capsule';
    lay.capsuleW = ri(capsule.width * dpiScale);
    lay.capsuleH = ri(capsule.height * dpiScale);
    lay.step = max(4, lay.capsuleH - ri(capsule.overlap * dpiScale));
    lay.groupW = lay.capsuleW;
    lay.groupH = lay.capsuleH + (n - 1) * lay.step;
    lay.rowCounts = [n];
    return lay;
  }

  const px = gs * dpiScale;
  const compactAfter = (disp.compactAfter != null) ? disp.compactAfter : 5;
  lay.compact = n > Math.max(2, compactAfter);
  const wantTwoRows = disp.nineLayout === 'twoRows';
  const wantPyramid = disp.nineLayout === 'pyramid';
  lay.pyramid = lay.compact && wantPyramid && n >= 6;
  lay.twoRows = lay.compact && wantTwoRows && n >= 6 && !lay.pyramid;

  let baseW = ri(DESIGN_PET_W * BOWL_RATIO * px);
  baseW = clamp(baseW, 46, 190);
  if (lay.compact) {
    baseW = ri(baseW * ((lay.twoRows || lay.pyramid) ? COMPACT_RATIO : ROW_RATIO));
    if (baseW < 40) baseW = 40;
  }
  lay.bowlW = baseW;
  lay.bowlH = max(8, ri(baseW * a.pixelH / a.pixelW));
  lay.gap = max(4, ri(6.0 * px));

  const headWear = disp.wear === 'head';
  lay.wheelH = (disp.wheels && !forceNoWheels && !headWear) ? max(3, ri(6.0 * px)) : 0;
  const riceTop = a.pixelH > 0 ? ri((a.rice ? a.rice.y : 8) / a.pixelH * lay.bowlH) : 0;
  lay.groupH = lay.bowlH - riceTop + lay.wheelH;
  const overflowRoom = ri(lay.bowlH * 0.18);
  lay.groupH += overflowRoom;
  if (lay.groupH < 12) lay.groupH = lay.bowlH + lay.wheelH;

  const newSlot = (index, row) => ({
    index, row, x: 0, top: 0, bottom: 0,
    bowlW: lay.bowlW, bowlH: lay.bowlH,
    riceX: 0, riceY: 0, riceW: 0, riceH: 0, rimY: 0, rimBottom: 0,
  });
  const fillSlot = (s) => {
    s.top = s.bottom - s.bowlH;
    const a2 = lay.asset;
    if (a2 && a2.pixelW > 0 && a2.pixelH > 0) {
      const sx = s.bowlW / a2.pixelW, sy = s.bowlH / a2.pixelH;
      const rr = a2.rice || DEFAULT_ASSET.rice;
      s.riceX = s.x + ri(rr.x * sx);
      s.riceY = s.top + ri(rr.y * sy);
      s.riceW = max(4, ri(rr.w * sx));
      s.riceH = max(4, ri(rr.h * sy));
      s.rimY = s.top + ri(a2.rimY * sy);
      s.rimBottom = s.top + (a2.rimBottom / a2.pixelH) * s.bowlH;
    } else {
      s.riceX = s.x + Math.floor(s.bowlW / 5);
      s.riceY = s.top + Math.floor(s.bowlH / 5);
      s.riceW = Math.floor(s.bowlW * 3 / 5);
      s.riceH = Math.floor(s.bowlH * 3 / 5);
      s.rimY = s.top + Math.floor(s.bowlH * 2 / 5);
      s.rimBottom = s.top + s.bowlH * 0.62;
    }
    s.rimY = Math.round(s.rimY);
    return s;
  };

  if (lay.twoRows) {
    const front = Math.ceil(n / 2);
    const back = n - front;
    lay.rowCounts = [front, back];
    lay.frontCount = front;
    const frontW = front * lay.bowlW + (front - 1) * lay.gap;
    const backW = back > 0 ? back * lay.bowlW + (back - 1) * lay.gap : 0;
    lay.groupW = max(frontW, backW);
    lay.rowShift = ri(12.0 * px);
    lay.groupH += lay.rowShift;
    for (let i = 0; i < back; i++) {
      const s = newSlot(front + i, 0);
      s.x = Math.floor((lay.groupW - backW) / 2) + i * (lay.bowlW + lay.gap);
      s.bottom = lay.groupH - lay.wheelH - lay.rowShift;
      lay.slots.push(fillSlot(s));
    }
    for (let i = 0; i < front; i++) {
      const s = newSlot(i, 1);
      s.x = Math.floor((lay.groupW - frontW) / 2) + i * (lay.bowlW + lay.gap);
      s.bottom = lay.groupH - lay.wheelH;
      lay.slots.push(fillSlot(s));
    }
  } else if (lay.pyramid) {
    const counts = pyramidCounts(n);
    lay.rowCounts = counts.slice();
    lay.frontCount = counts[0];
    const overflowAbove = max(0, lay.groupH - lay.bowlH - lay.wheelH);
    lay.rowShift = lay.bowlH + overflowAbove;
    const bottomW = counts[0] * lay.bowlW + (counts[0] - 1) * lay.gap;
    lay.groupW = bottomW;
    lay.groupH = lay.groupH + (counts.length - 1) * lay.rowShift;
    let pi = 0;
    for (let r = 0; r < counts.length; r++) {
      const cnt = counts[r];
      const rowNo = counts.length - 1 - r; // 0=最顶（先画）
      const rowW = cnt * lay.bowlW + (cnt - 1) * lay.gap;
      const x0 = Math.floor((lay.groupW - rowW) / 2);
      for (let i = 0; i < cnt; i++) {
        const s = newSlot(pi++, rowNo);
        s.x = x0 + i * (lay.bowlW + lay.gap);
        s.bottom = lay.groupH - lay.wheelH - r * lay.rowShift;
        lay.slots.push(fillSlot(s));
      }
    }
  } else {
    lay.frontCount = n;
    lay.rowCounts = [n];
    lay.groupW = n * lay.bowlW + (n - 1) * lay.gap;
    for (let i = 0; i < n; i++) {
      const s = newSlot(i, 1);
      s.x = i * (lay.bowlW + lay.gap);
      s.bottom = lay.groupH - lay.wheelH;
      lay.slots.push(fillSlot(s));
    }
  }

  lay.slots.sort((s1, s2) => (s1.row !== s2.row) ? (s1.row - s2.row) : (s1.x - s2.x));
  computePlaque(cfg, lay);
  return lay;
}

/** 木牌/数值三条带几何（V3.ComputePlaque 移植）；参考槽=最前排，其余槽 += dy */
function computePlaque(cfg, lay) {
  const disp = (cfg && cfg.display) || {};
  const px = lay.graphicsScale * lay.dpiScale;
  let plaqueScale = px;
  if (plaqueScale < 0.5) plaqueScale = 0.5;
  lay.plaqueScale = plaqueScale;
  const textScale = max(0.85, lay.graphicsScale) * lay.dpiScale;
  lay.textScale = textScale;

  let refSlot = null;
  for (const s of lay.slots) if (!refSlot || s.bottom > refSlot.bottom) refSlot = s;
  const rimY = refSlot ? refSlot.rimY : 0;
  const rimBottom = refSlot ? refSlot.rimBottom : 0;
  const bottom = refSlot ? refSlot.bottom : (lay.groupH - lay.wheelH);
  const gapBottomMin = 2.0 * plaqueScale;
  const th = (lay.compact ? 12.0 : 13.0) * plaqueScale;
  const frontFaceRef = max(4, bottom - rimBottom);
  lay.frontFaceRef = frontFaceRef;
  const dotD = 4.0 * plaqueScale;
  const wrapLogo = !!(disp.logo && String(disp.logoStyle || '').toLowerCase() === 'wrap');
  const nameCenter = rimBottom + (bottom - rimBottom) * (wrapLogo ? 0.50 : 0.30);
  const plaqueCenter = rimBottom + (bottom - rimBottom) * (wrapLogo ? 0.80 : 0.64);
  const namePx = max(8, 8 * plaqueScale);
  const amountPx = max(9, 9 * plaqueScale);
  const nameH = namePx * 1.10;
  let nameY = nameCenter - nameH / 2;
  let plaqueTop = plaqueCenter - th / 2;
  const needGap = dotD + 3.0 * plaqueScale;
  if (plaqueTop - (nameY + nameH) < needGap) {
    const mid = (nameY + nameH + plaqueTop) / 2;
    nameY = mid - needGap / 2 - nameH;
    plaqueTop = mid + needGap / 2;
  }
  if (nameY < rimBottom + gapBottomMin) nameY = rimBottom + gapBottomMin;
  if (plaqueTop + th > bottom - gapBottomMin) plaqueTop = bottom - gapBottomMin - th;
  const plaqueBottom = plaqueTop + th;
  let plaqueW = max(lay.bowlW * 0.78, amountPx * 3.4);
  const plaqueWMin = 36 * plaqueScale;
  if (plaqueW < plaqueWMin) plaqueW = plaqueWMin;
  const plaqueWMax = lay.bowlW - 2 * plaqueScale;
  if (plaqueW > plaqueWMax) plaqueW = plaqueWMax;

  const base = {
    plaqueScale, plaqueH: th, plaqueW, plaqueTop, plaqueBottom, namePx, amountPx,
    nameY, nameH, dotD, dotCenterY: (nameY + nameH + plaqueTop) / 2,
    refBottom: bottom, refRimY: rimY, refRimBottom: rimBottom, frontFace: frontFaceRef,
    nameBottomGap: bottom - plaqueBottom, gapBottomMin, needGap,
    nameMaxWidth: max(0, Math.min(lay.bowlW * 0.92, lay.bowlW - 6 * plaqueScale - 2)),
  };
  lay.plaque = base;
  // 注意：plaqueH 始终是「数值三条带」高度（12/13*plaqueScale），与 Win ValueBandH 一致；
  // 只有 L3 才画木牌底板（plaqueBody=true），L1 直接复用三条带但无底板，L2 用饭票小旗（自算几何）。
  base.plaqueBody = (String(disp.labelStyle || '').toUpperCase() === 'L3');
  base.valueCenterY = base.plaqueTop + th / 2;
  lay.labelStyle = String(disp.labelStyle || 'L3').toUpperCase();
  // 每槽平移（多排：dy = slot.bottom - refBottom）
  for (const s of lay.slots) {
    const dy = s.bottom - bottom;
    s.dy = dy;
    s.plaque = {
      plaqueTop: base.plaqueTop + dy,
      plaqueH: base.plaqueH,
      plaqueW: base.plaqueW,
      amountPx: base.amountPx,
      namePx: base.namePx,
      nameY: base.nameY + dy,
      nameH: base.nameH,
      dotD: base.dotD,
      dotCenterY: base.dotCenterY + dy,
      frontFace: max(4, s.bottom - s.rimBottom),
      nameBottomGap: s.bottom - (base.plaqueTop + dy + base.plaqueH),
      gapBottomMin: base.gapBottomMin,
      nameMaxWidth: base.nameMaxWidth,
      plaqueBody: base.plaqueBody,
      valueCenterY: base.valueCenterY + dy,
    };
  }
  lay.spacing = base;
  return lay;
}

// ---------------- 定位公式（V3.WearMath + P.ComputePlacement 移植） ----------------
function contactPx(dpiScale) { return max(1, ri(3.0 * (dpiScale || 1))); }
function feetLift(lay, dpiScale) { return ri(6.0 * (dpiScale || 1)) + (lay ? lay.groupH : 0); }
function feetPanelBottom(cfg, workBottom) {
  const gap = (cfg && cfg.position && cfg.position.bottomGap != null) ? cfg.position.bottomGap : 8;
  return workBottom - max(0, gap);
}
function headPanelY(headScreenY, panelHeight, contactPxV, workTop, monBottom) {
  let y = headScreenY - panelHeight + contactPxV;
  let maxY = monBottom - panelHeight;
  if (maxY < workTop) maxY = workTop;
  if (y < workTop) y = workTop;
  if (y > maxY) y = maxY;
  return Math.round(y);
}

/** 明细卡尺寸（V3.DetailRenderer.Measure）：不含 graphicsScale */
function detailSize(n, dpiScale) {
  const s = dpiScale || 1;
  return {
    w: Math.round(max(240 * s, Math.min(460 * s, 460 * s))),
    h: Math.round(34 * s + n * 30 * s + 24 * s),
  };
}

function rowCountsText(lay) {
  if (!lay || !lay.rowCounts || !lay.rowCounts.length) return String(lay ? lay.count : 0);
  return lay.rowCounts.join(',');
}

// ---------------- 自测（node src/layout.js --selftest） ----------------
function _selftest() {
  const { normalizeConfig, defaultConfig } = require('./config');
  const out = [];
  const mk = (over) => {
    const base = defaultConfig();
    const raw = JSON.parse(JSON.stringify(base));
    if (over) over(raw);
    return normalizeConfig(raw);
  };
  const asset = { pixelW: 320, pixelH: 290, rice: { x: 44, y: 8, w: 232, h: 276 }, rimY: 54, rimBottom: 80 };
  const cases = [
    { name: '2家 noncompact', cfg: mk(), n: 2, gs: 1.0 },
    { name: '9家 pyramid gs1', cfg: mk(), n: 9, gs: 1.0 },
    { name: '9家 row gs1', cfg: mk(r => { r.display.nineLayout = 'row'; }), n: 9, gs: 1.0 },
    { name: '9家 twoRows gs1', cfg: mk(r => { r.display.nineLayout = 'twoRows'; }), n: 9, gs: 1.0 },
    { name: '9家 pyramid gs2', cfg: mk(), n: 9, gs: 2.0 },
    { name: '6家 pyramid gs1', cfg: mk(), n: 6, gs: 1.0 },
    { name: '7家 pyramid gs1', cfg: mk(), n: 7, gs: 1.0 },
    { name: '8家 pyramid gs1', cfg: mk(), n: 8, gs: 1.0 },
    { name: '9家 pyramid feet(wheels)', cfg: mk(r => { r.display.wear = 'feet'; r.display.wheels = true; }), n: 9, gs: 1.0 },
  ];
  for (const c of cases) {
    const lay = computeLayout(c.cfg, c.n, 1, c.gs, asset, c.cfg.display.wear === 'head');
    out.push({
      name: c.name,
      bowlW: lay.bowlW, bowlH: lay.bowlH, gap: lay.gap, groupW: lay.groupW, groupH: lay.groupH,
      wheelH: lay.wheelH, rowShift: lay.rowShift, rowCounts: lay.rowCounts,
      plaqueW: +lay.plaque.plaqueW.toFixed(2), plaqueH: +lay.plaque.plaqueH.toFixed(2),
      namePx: +lay.plaque.namePx.toFixed(2), amountPx: +lay.plaque.amountPx.toFixed(2),
      slots: lay.slots.map(s => ({ i: s.index, row: s.row, x: s.x, top: s.top, bottom: s.bottom })),
      firstPlaque: lay.slots.length ? +lay.slots[0].plaque.plaqueTop.toFixed(2) : null,
    });
  }
  console.log(JSON.stringify(out, null, 2));
  console.log('--- wear ---');
  console.log(JSON.stringify({
    headPanelY_786_h64: headPanelY(786, 64, 3, 33, 956),
    feetPanelBottom_work923: feetPanelBottom(mk(), 923),
    contact: contactPx(1),
    detail: detailSize(9, 1),
    graphicsScale_1: graphicsScale(mk(), 1),
    graphicsScale_1_05: graphicsScale(mk(), 1.05),
    graphicsScale_2: graphicsScale(mk(), 2.0),
  }, null, 2));
}

module.exports = {
  computeLayout, computePlaque, graphicsScale, pyramidCounts, isHead, isRicebowl,
  contactPx, feetLift, feetPanelBottom, headPanelY, detailSize, rowCountsText,
  DESIGN_PET_W, BOWL_RATIO, COMPACT_RATIO, ROW_RATIO,
};

if (require.main === module) _selftest();
