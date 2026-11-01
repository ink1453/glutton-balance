'use strict';
// 位置计算：head（头顶，默认）/ feet（脚下）两态；水平居中 + clampMargin；多屏/DPI（Mac 逻辑点为 DIP，与 CGWindow 点坐标一致）
// 口径：Win Panel.cs ComputePlacementLocked + Panel.V3.cs WearMath（spec-panel.md §1.2-1.4）
const { headPanelY, feetPanelBottom } = require('./layout');

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function displayCenter(d) {
  return { x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height / 2 };
}

/** 选显示器：monitorFollow=false → 用 fallbackDisplay（启动时那台）；否则按桌宠窗中心所在屏 */
function chooseDisplay(displays, petBounds, monitorFollow, fallbackDisplayId) {
  if (!displays || !displays.length) return null;
  if (!monitorFollow) {
    const f = displays.find(d => d.id === fallbackDisplayId);
    return f || displays[0];
  }
  if (petBounds && Number.isFinite(petBounds.x)) {
    const cx = petBounds.x + petBounds.width / 2;
    const cy = petBounds.y + petBounds.height / 2;
    for (const d of displays) {
      const b = d.bounds;
      if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) return d;
    }
    // 取离桌宠窗中心最近的屏
    let best = displays[0], bestD = Infinity;
    for (const d of displays) {
      const c = displayCenter(d);
      const dist = Math.hypot(c.x - cx, c.y - cy);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }
  return displays[0];
}

/**
 * @param cfg 归一化配置
 * @param w 面板宽（逻辑点）
 * @param h 面板高（逻辑点）
 * @param pet {petBounds, headY, feetY, centerX(head), centerY(feet)}（NaN=不可用）
 * @param displays Electron Display[]
 * @param opts {monitorFollow, fallbackDisplayId, dpiScale}
 */
function computePlacement(cfg, w, h, pet, displays, opts) {
  const o = opts || {};
  const dpi = o.dpiScale || 1;
  const pos = (cfg && cfg.position) || {};
  const display = chooseDisplay(displays, pet && pet.petBounds, pos.monitorFollow !== false, o.fallbackDisplayId);
  if (!display) return { x: 0, y: 0, src: 'no-display' };
  const mon = display.bounds;
  const work = display.workArea || display.bounds;
  const clampMargin = Number.isFinite(pos.clampMargin) ? pos.clampMargin : 8;
  const offsetX = Number.isFinite(pos.offsetX) ? pos.offsetX : 0;
  const offsetY = Number.isFinite(pos.offsetY) ? pos.offsetY : 0;
  const headWear = !!(cfg && cfg.display && cfg.display.wear === 'head');

  // 水平
  let centerSrc = 'detect';
  let centerX = pet ? pet.centerX : NaN;
  if (!Number.isFinite(centerX)) {
    // 兜底优先用桌宠窗中心（petprobe 启动瞬间就能拿到窗口 bounds），再退到工作区 95%
    const pb = pet && pet.petBounds;
    if (pb && Number.isFinite(pb.x) && pb.width > 0) {
      centerSrc = 'fallback-window';
      centerX = pb.x + pb.width / 2;
    } else {
      centerSrc = 'fallback-95';
      centerX = work.x + work.width * 0.95;
    }
  }
  let rawX = Math.round(centerX - w / 2 + offsetX);
  let minX = mon.x + clampMargin;
  let maxX = mon.x + mon.width - w - clampMargin;
  if (maxX < minX) maxX = minX;
  const x = clamp(rawX, minX, maxX);

  // 纵向
  let y;
  let ySrc = 'detect';
  if (headWear) {
    let headY = pet ? pet.headY : NaN;
    if (!Number.isFinite(headY)) {
      ySrc = 'fallback-head';
      const pb = pet && pet.petBounds;
      headY = pb ? (pb.y + Math.max(24, pb.height / 4)) : (work.y + Math.max(24, h));
    }
    const contact = Math.max(1, Math.round(3 * dpi));
    const rawY = headY - h + contact + offsetY;
    y = clamp(rawY, work.y, Math.max(work.y, mon.y + mon.height - h));
  } else {
    ySrc = 'feet-bottom';
    const bottom = feetPanelBottom(cfg, work.y + work.height);
    const rawY = bottom - h + offsetY;
    y = clamp(rawY, work.y, Math.max(work.y, mon.y + mon.height - h));
  }
  return {
    x, y,
    src: `${ySrc}/${centerSrc}`,
    displayId: display.id,
    displayName: display.label || '',
    work: { x: work.x, y: work.y, w: work.width, h: work.height },
    mon: { x: mon.x, y: mon.y, w: mon.width, h: mon.height },
    rawX,
    centerX,
  };
}

module.exports = { computePlacement, chooseDisplay };
