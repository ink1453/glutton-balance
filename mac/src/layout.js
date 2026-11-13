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

// ---------------- 第 27 轮 · 第三种形态 minicard（macOS 毛玻璃小面板） ----------------
// 老板 2026-11-13 06:5x：「增加一种显示方式，用一个小面板显示，信息集成高，适合 mac 端小屏幕使用，
//   ui 风格就用 macos 目前这个版本的」。已确认：竖排小卡片（一行一家，左家名右金额、固定宽度）+
//   家名/金额/状态点 + macOS 毛玻璃卡片 + 跟着桌宠（与饭碗同一定位逻辑，故本函数只给几何，定位仍走 main.js）。
// 数值全部以「gs=1 时」为基准，实际按 px=gs*dpiScale 等比放大 —— 这样桌宠变大面板也变大。
// 硬下限与 computeLayout 既有口径一致写成「原值 * K」，避免 sizePct 缩小时「卡小了字没小」。
const MC_RATIO = 2.8;             // 卡宽 = 桌宠实测宽 × 2.8（与「盆宽 = 桌宠宽 × 0.80」同源思路）
const MC_ROW_H = 30.0;            // 行高 30pt
const MC_PAD_X = 16.0;            // 卡片左右内边距 16pt
const MC_PAD_Y = 10.0;            // 卡片上下内边距
const MC_RADIUS = 14.0;           // 圆角 14pt
const MC_NAME_PX = 13.0;          // 家名字号 13px
const MC_AMOUNT_PX = 13.0;        // 金额字号 13px
const MC_DOT = 8.0;               // 状态点直径
const MC_DOT_GAP = 7.0;           // 状态点与文字的间距
const MC_MID_GAP = 8.0;           // 家名区与金额区之间的最小空隙
const MC_MIN_W = 168.0;           // 卡宽下限（保证 ¥987654.32 这种长金额放得下）
const MC_MAX_W = 460.0;           // 卡宽上限

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
 *
 * 第 27 轮「缩小 30%」：在自动匹配之上再乘整体倍率 K = sizePct/100（默认 1.00 → 结果与第 26 轮逐字节一致）。
 * ⚠️ 只乘 K 不够：computeLayout / computePlaque 里还有若干硬下限（盆宽 46、盆高 8、间距 4、
 * 字号 8/9、plaqueScale 0.5 …），若不按 K 同比放开就会出现「碗小了字没小」的挤压丑态。
 * 因此 K 同时通过 sizeScaleOf() 暴露给下游，所有硬下限统一写成「原值 * K」。
 */
function graphicsScale(cfg, petScale, charWpt) {
  const d = (cfg && cfg.display) || {};
  const k = sizeScaleOf(cfg);
  let ref = Number(d.petScaleRef);
  if (!Number.isFinite(ref) || ref < 0.2) ref = 1.05;
  let lo = Number(d.graphicsMin);
  if (!Number.isFinite(lo) || lo < 0.2) lo = 0.95;
  if (lo < 0.95) lo = 0.95; // 硬性可读下限
  let hi = Number(d.graphicsMax);
  if (!Number.isFinite(hi) || hi < lo) hi = 2.0;
  if (Number.isFinite(charWpt) && charWpt > 20) {
    return clamp(charWpt / DESIGN_PET_W, lo, hi) * k;
  }
  let ps = Number(petScale);
  if (!Number.isFinite(ps) || ps <= 0) ps = 1.05;
  return clamp(ps / ref, lo, hi) * k;
}

/** 整体缩放倍率 K = sizePct/100（缺省/非法 → 1.00，保证零变化）。 */
function sizeScaleOf(cfg) {
  const d = (cfg && cfg.display) || {};
  const pct = Number(d.sizePct);
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  return pct / 100;
}

function isHead(cfg) {
  return !!(cfg && cfg.display && cfg.display.wear === 'head');
}

function isRicebowl(cfg) {
  return !(cfg && cfg.display && cfg.display.style === 'capsule');
}

/** 第 27 轮 · 是否为小面板（minicard）形态。大小写不敏感（与 config-core 口径一致，但不 trim）。 */
function isMinicard(cfg) {
  const s = cfg && cfg.display && cfg.display.style;
  return typeof s === 'string' && s.toLowerCase() === 'minicard';
}

/**
 * 小面板几何（全部逻辑点，未乘 dpr；渲染层再按 dpr 缩放）。
 * 竖排小卡片：一行一家，左家名、右金额、中间状态点，固定宽度。
 * 宽度跟桌宠走（MC_RATIO × 桌宠实测宽），但夹在 [MC_MIN_W, MC_MAX_W] 内，
 * 保证「小屏幕不占地方」和「长金额不溢出」两个都不破。
 *
 * 关键：金额列宽不是猜的，用与渲染器同一套字符宽度估算回算出「最长金额」的宽度，
 * 再反推卡宽 —— 这样 ¥987654 / C 2016 这类都能放得下（0.0.7 起金额不带小数），且布局层先算好给渲染层用。
 */
function computeMinicard(cfg, n, dpiScale, gs, viewNames) {
  dpiScale = (dpiScale > 0) ? dpiScale : 1;
  gs = (gs > 0.2) ? gs : 1.0;
  const px = gs * dpiScale;
  const K = sizeScaleOf(cfg);
  const names = Array.isArray(viewNames) ? viewNames : [];

  // 卡宽：优先跟桌宠（MC_RATIO × DESIGN_PET_W × px），再按行内容需求抬高。
  // 第 27 轮修：基础卡宽与上限都随 K 等比缩放，且内容需求 needW 一并作为下限，
  // 否则高缩放（sizePct>100）时卡宽增长跟不上字号增长，家名被挤成省略号。
  const needW = minicardContentWidth(names, px, K);
  let cardW = MC_RATIO * DESIGN_PET_W * px * K;
  const loW = Math.max(ri(MC_MIN_W * K), needW);
  const hiW = Math.max(ri(MC_MAX_W * K), needW);
  cardW = clamp(ri(cardW), loW, hiW);
  if (cardW < needW) cardW = needW;

  // 第 27 轮修：卡宽 clamp 早先乘了 K（sizePct 生效），但行高/内边距/字号没乘，
  // 结果 sizePct<100 时「卡缩小、内容不缩」，家名列被挤到下限、名字全成省略号。
  // 现在所有纵向与文字几何统一乘 K，卡面整体等比缩放。
  const rowH = ri(MC_ROW_H * px * K);
  const padX = ri(MC_PAD_X * Math.max(0.85, gs) * dpiScale * K);
  const padY = ri(MC_PAD_Y * Math.max(0.85, gs) * dpiScale * K);
  const radius = ri(MC_RADIUS * Math.max(0.85, gs) * dpiScale * K);
  const dotD = Math.max(4, ri(MC_DOT * Math.max(0.85, gs) * dpiScale * K));
  const dotGap = ri(MC_DOT_GAP * Math.max(0.85, gs) * dpiScale * K);
  const namePx = Math.max(8 * K, MC_NAME_PX * px * K);
  const amountPx = Math.max(8 * K, MC_AMOUNT_PX * px * K);

  const cardH = padY * 2 + rowH * n;
  const lay = {
    style: 'minicard',
    count: n, dpiScale, graphicsScale: gs, asset: DEFAULT_ASSET,
    compact: false, pyramid: false, twoRows: false,
    bowlW: 0, bowlH: 0, gap: 0, groupW: cardW, groupH: cardH, wheelH: 0,
    frontCount: 0, rowShift: 0, rowCounts: [n], slots: [],
    capsuleW: 0, capsuleH: 0, step: 0,
    // —— minicard 专属几何（渲染层只读这些，不再自己算尺寸）——
    mc: {
      cardW, cardH, rowH, padX, padY, radius, dotD, dotGap,
      namePx, amountPx,
      // 家名列可用宽度 / 金额列可用宽度（两列互斥，中间留 MC_MID_GAP）
      midGap: ri(MC_MID_GAP * Math.max(0.85, gs) * dpiScale * K),
      nameMaxW: 0, amountMaxW: 0,
      rows: [],
    },
  };
  const midGap = lay.mc.midGap;
  // 金额列固定占「最长金额」宽度（右对齐），家名占剩下的（左对齐）
  const amountW = minicardAmountWidth(px, K);
  lay.mc.amountMaxW = amountW;
  lay.mc.nameMaxW = Math.max(12, cardW - padX * 2 - dotD - dotGap - midGap - amountW);

  for (let i = 0; i < n; i++) {
    const rowTop = padY + rowH * i;
    lay.mc.rows.push({
      index: i,
      name: names[i] != null ? String(names[i]) : '',
      top: rowTop,
      cy: rowTop + rowH / 2,
      // 状态点圆心（家名左侧）
      dotCx: padX + dotD / 2,
      // 家名左边界
      textX: padX + dotD + dotGap,
      // 金额右边界
      amountRight: cardW - padX,
    });
    lay.slots.push({
      index: i, x: padX, y: rowTop, w: cardW - padX * 2, h: rowH,
      cx: cardW / 2, cy: rowTop + rowH / 2,
    });
  }
  return lay;
}

/** 小面板「金额列」最宽需要多少：按最长金额文本估算（保守，宁宽不溢）。K = sizePct/100，随缩放一起变。 */
function minicardAmountWidth(px, K) {
  // 最长金额形态：符号 + 7 位整数（C 1234567）——第 27 轮老板令去掉小数后无「.00」。
  // 7 位是「Credits 余额极端上界」；再长由渲染层缩字号/尾部省略兜底，永不溢出卡面。
  // 第 27 轮改两次：① 符号 ₡ → 'C '（渲染层 CREDITS_SYMBOL 同步）；② 去掉小数位。
  // 探测串必须与渲染层实际输出形态一致，否则金额列宽算偏。保留 .89 作上界余量也可以，
  // 但会让卡宽偏胖，这里按实际形态取「C + 7 位整数」。
  const k = (K > 0) ? K : 1;
  const probe = 'C 1234567';
  return ri(estimateTextW(probe, MC_AMOUNT_PX * px * k, 'bold') + 1);
}

/** 小面板「内容需求宽度」：状态点 + 家名 + 间隙 + 金额列 + 内边距。 */
function minicardContentWidth(names, px, K) {
  const k = (K > 0) ? K : 1;
  let nameW = 0;
  for (let i = 0; i < names.length; i++) {
    const w = estimateTextW(String(names[i] == null ? '' : names[i]), MC_NAME_PX * px * k, 'normal');
    if (w > nameW) nameW = w;
  }
  // 家名最长可到 120pt（超出走中间省略），这里只保证「典型家名不被压」
  nameW = Math.min(nameW, 120 * px * k);
  const g = Math.max(0.85, px) * k;
  const dotD = MC_DOT * g, dotGap = MC_DOT_GAP * g, midGap = MC_MID_GAP * g;
  const padX = MC_PAD_X * g;
  return ri(padX * 2 + dotD + dotGap + nameW + midGap + minicardAmountWidth(px, k));
}

/**
 * 文本宽度估算（不依赖 canvas，纯布局用）。
 * 与渲染器 FONT_FAMILY 同族的粗估：PingFang 小字号下 ASCII 数字/字母 ≈ 0.58em、
 * 货币符号 ≈ 0.62em、中文 ≈ 1.0em。只用于「算卡宽」，最终绘制仍由 canvas measureText 决定，
 * 所以这里宁可高估 6%，保证布局留够地方永不溢出。
 */
function estimateTextW(text, px, weight) {
  const s = String(text == null ? '' : text);
  let em = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      if (c === 0x2e || c === 0x2c || c === 0x3a) em += 0.28;      // . , :
      else if (c >= 0x30 && c <= 0x39) em += 0.58;                 // 数字
      else em += 0.55;                                             // 其它 ASCII
    } else if (c >= 0x4e00 && c <= 0x9fff) em += 1.0;              // 中日韩汉字
    else em += 0.62;                                               // 货币符号 / 全角标点
  }
  const boldK = (weight === 'bold') ? 1.04 : 1.0;
  return em * px * boldK * 1.06; // 1.06 = 安全余量
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
function computeLayout(cfg, n, dpiScale, gs, asset, forceNoWheels, viewNames) {
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

  if (isMinicard(cfg)) {
    // 第 27 轮 · 第三种形态：小面板。viewNames 可选（第 7 参）；main.js 不传也能定卡宽，
    // 渲染层再按实际文本做缩字号/省略，保证永不溢出。
    const vn = Array.isArray(viewNames) ? viewNames : [];
    return computeMinicard(cfg, n, dpiScale, gs, vn);
  }

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
  // 整体缩放倍率：gs 里已经乘过 K，但下面的硬下限必须同比放开，否则小档会被下限卡住
  // （碗按 K 缩了、字被 8pt 下限顶住 → 「碗小字不小」的挤压丑态）。
  const K = sizeScaleOf(cfg);
  const compactAfter = (disp.compactAfter != null) ? disp.compactAfter : 5;
  lay.compact = n > Math.max(2, compactAfter);
  const wantTwoRows = disp.nineLayout === 'twoRows';
  const wantPyramid = disp.nineLayout === 'pyramid';
  lay.pyramid = lay.compact && wantPyramid && n >= 6;
  lay.twoRows = lay.compact && wantTwoRows && n >= 6 && !lay.pyramid;

  let baseW = ri(DESIGN_PET_W * BOWL_RATIO * px);
  baseW = clamp(baseW, 46 * K, 190 * K);
  if (lay.compact) {
    baseW = ri(baseW * ((lay.twoRows || lay.pyramid) ? COMPACT_RATIO : ROW_RATIO));
    if (baseW < 40 * K) baseW = 40 * K;
  }
  lay.bowlW = baseW;
  lay.bowlH = max(8 * K, ri(baseW * a.pixelH / a.pixelW));
  lay.gap = max(4 * K, ri(6.0 * px));

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
  // 整体缩放倍率（与 computeLayout 同一口径）；下面所有硬下限同比放开
  const K = sizeScaleOf(cfg);
  let plaqueScale = px;
  if (plaqueScale < 0.5 * K) plaqueScale = 0.5 * K;
  lay.plaqueScale = plaqueScale;
  const textScale = max(0.85 * K, lay.graphicsScale) * lay.dpiScale;
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
  const namePx = max(8 * K, 8 * plaqueScale);
  const amountPx = max(9 * K, 9 * plaqueScale);
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
  // 第 27 轮 · minicard
  isMinicard, computeMinicard, estimateTextW,
  MC_RATIO, MC_ROW_H, MC_PAD_X, MC_PAD_Y, MC_RADIUS, MC_NAME_PX, MC_AMOUNT_PX,
  MC_DOT, MC_DOT_GAP, MC_MID_GAP, MC_MIN_W, MC_MAX_W,
};

if (require.main === module) _selftest();
