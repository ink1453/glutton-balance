'use strict';
// 饭桶余额 Mac 显示窗 · 主题 → VisualStyle（Win Panel.V3.cs ThemeInfo/VisualStyleBuilder/FromPalette 移植）
// 输出 CSS 颜色字符串，直接给渲染器用。

function hexToRgb(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim();
  if (t.startsWith('#')) t = t.slice(1);
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  if (t.length === 6) t = 'ff' + t; // #rrggbb → alpha 255
  if (t.length !== 8) return null;
  const v = parseInt(t, 16);
  if (!Number.isFinite(v)) return null;
  return { a: (v >>> 24) & 0xff, r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff };
}
function rgba(c) { return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(4)})`; }
function mix(a, b, t) {
  return {
    a: a.a,
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}
// alpha 合成：前景（带 alpha）叠到不透明背景上
function compositeOver(fg, bg) {
  const al = fg.a / 255;
  return rgba({
    a: 255,
    r: Math.round(fg.r * al + bg.r * (1 - al)),
    g: Math.round(fg.g * al + bg.g * (1 - al)),
    b: Math.round(fg.b * al + bg.b * (1 - al)),
  });
}

const A = (a, r, g, b) => ({ a, r, g, b });
const C = (r, g, b) => ({ a: 255, r, g, b });

function fallback(theme) {
  const light = theme === 'light';
  let pal;
  if (light) {
    pal = {
      plaqueFill: A(246, 248, 249, 250), plaqueBorder: C(174, 174, 179), plaqueTop: A(40, 255, 255, 255),
      nameColor: C(139, 139, 145), amountColor: C(27, 27, 31), lowColor: C(180, 89, 80),
      failColor: C(139, 139, 145), warnColor: C(150, 116, 59), hintColor: C(92, 92, 98),
      dotGreen: C(25, 129, 94), dotRed: C(180, 89, 80), dotGrey: C(139, 139, 145), dotRice: C(190, 150, 80),
      cardFill: A(246, 251, 251, 252), cardTop: A(38, 255, 255, 255), cardBorder: C(174, 174, 179), cardDivider: A(70, 174, 174, 179),
      paper: C(245, 245, 246), sheet: C(251, 251, 252), ink: C(27, 27, 31), inkSoft: C(92, 92, 98), inkDim: C(139, 139, 145),
      lineStrong: C(174, 174, 179), ok: C(25, 129, 94), danger: C(180, 89, 80), warn: C(150, 116, 59),
    };
  } else {
    pal = {
      plaqueFill: A(238, 18, 18, 20), plaqueBorder: C(85, 85, 91), plaqueTop: A(30, 255, 255, 255),
      nameColor: C(131, 131, 137), amountColor: C(234, 234, 236), lowColor: C(226, 126, 112),
      failColor: C(131, 131, 137), warnColor: C(196, 163, 114), hintColor: C(177, 177, 182),
      dotGreen: C(118, 202, 159), dotRed: C(226, 126, 112), dotGrey: C(131, 131, 137), dotRice: C(238, 198, 120),
      cardFill: A(244, 18, 18, 20), cardTop: A(30, 255, 255, 255), cardBorder: C(85, 85, 91), cardDivider: A(70, 85, 85, 91),
      paper: C(18, 18, 20), sheet: C(30, 30, 33), ink: C(234, 234, 236), inkSoft: C(177, 177, 182), inkDim: C(131, 131, 137),
      lineStrong: C(85, 85, 91), ok: C(118, 202, 159), danger: C(226, 126, 112), warn: C(196, 163, 114),
    };
  }
  return pal;
}

function fromPalette(pal, theme) {
  const light = theme === 'light';
  const get = (k, dflt) => (pal && pal[k]) ? pal[k] : dflt;
  const paper = get('paper', light ? C(245, 245, 246) : C(18, 18, 20));
  const paper2 = get('paper-2', paper);
  const sheet = get('sheet', paper);
  const ink = get('ink', light ? C(27, 27, 31) : C(234, 234, 236));
  const inkSoft = get('ink-soft', ink);
  const inkDim = get('ink-dim', inkSoft);
  const line = get('line', paper2);
  const lineStrong = get('line-strong', line);
  const ok = get('ok', light ? C(25, 129, 94) : C(118, 202, 159));
  const danger = get('danger', light ? C(180, 89, 80) : C(226, 126, 112));
  const accent = get('accent', ok);
  const warn = get('warn', light ? C(150, 116, 59) : C(196, 163, 114));
  return {
    plaqueFill: A(light ? 246 : 238, paper.r, paper.g, paper.b),
    plaqueBorder: C(lineStrong.r, lineStrong.g, lineStrong.b),
    plaqueTop: A(30, 255, 255, 255),
    nameColor: C(inkDim.r, inkDim.g, inkDim.b),
    amountColor: C(ink.r, ink.g, ink.b),
    lowColor: C(danger.r, danger.g, danger.b),
    failColor: C(inkDim.r, inkDim.g, inkDim.b),
    warnColor: C(warn.r, warn.g, warn.b),
    hintColor: C(inkSoft.r, inkSoft.g, inkSoft.b),
    dotGreen: C(ok.r, ok.g, ok.b),
    dotRed: C(danger.r, danger.g, danger.b),
    dotGrey: C(inkDim.r, inkDim.g, inkDim.b),
    dotRice: C(light ? 176 : 238, light ? 132 : 198, light ? 56 : 120),
    cardFill: A(light ? 246 : 244, sheet.r, sheet.g, sheet.b),
    cardTop: A(34, 255, 255, 255),
    cardBorder: C(lineStrong.r, lineStrong.g, lineStrong.b),
    cardDivider: A(70, lineStrong.r, lineStrong.g, lineStrong.b),
    paper: C(paper.r, paper.g, paper.b), sheet: C(sheet.r, sheet.g, sheet.b), ink: C(ink.r, ink.g, ink.b),
    inkSoft: C(inkSoft.r, inkSoft.g, inkSoft.b), inkDim: C(inkDim.r, inkDim.g, inkDim.b),
    lineStrong: C(lineStrong.r, lineStrong.g, lineStrong.b), ok: C(ok.r, ok.g, ok.b),
    danger: C(danger.r, danger.g, danger.b), warn: C(warn.r, warn.g, warn.b),
  };
}

/** 从 /api/theme 响应里挑出当前主题的 palettes（Win QueryTheme 同口径） */
function parseThemePalettes(themeJson) {
  const out = { selectedId: '', dark: null, light: null, ok: false };
  try {
    const root = (themeJson && themeJson.theme) || {};
    const selectedId = String(root.selectedId || '');
    out.selectedId = selectedId;
    const custom = Array.isArray(root.custom) ? root.custom : [];
    for (const item of custom) {
      if (!item) continue;
      const id = String(item.id || '');
      if (selectedId.length > 0 && id !== selectedId) continue;
      const pal = item.palettes || {};
      out.dark = pal.dark || null;
      out.light = pal.light || null;
      out.ok = !!(out.dark || out.light);
      break;
    }
  } catch (e) { /* ignore */ }
  return out;
}

/** 生成渲染用 style（CSS 颜色字符串 + 木牌预混色） */
function buildStyle(opts) {
  // opts: {theme:'dark'|'light', force:'', palettes:{dark,light,ok,selectedId}, bowlStyle}
  let theme = 'dark';
  if (opts.force === 'dark' || opts.force === 'light') theme = opts.force;
  else if (opts.theme === 'dark' || opts.theme === 'light') theme = opts.theme;
  const light = theme === 'light';
  let pal = null;
  if (opts.palettes && opts.palettes.ok) {
    const raw = light ? opts.palettes.light : opts.palettes.dark;
    if (raw) {
      pal = {};
      for (const k of Object.keys(raw)) {
        const c = hexToRgb(raw[k]);
        if (c) pal[k] = c;
      }
      if (!Object.keys(pal).length) pal = null;
    }
  }
  const tokens = pal ? fromPalette(pal, theme) : fallback(theme);
  const lightBodyBase = C(243, 240, 235);
  const darkBodyBase = C(30, 33, 38);
  const baseMix = mix(tokens.plaqueFill, tokens.warn, light ? 0.20 : 0.18); // J：浅主题木牌加深一档（0.12→0.20）
  const solid = A(246, baseMix.r, baseMix.g, baseMix.b);
  const style = {
    light, theme,
    selectedId: opts.palettes ? (opts.palettes.selectedId || '') : '',
    paletteSource: pal ? 'api' : 'fallback',
  };
  for (const k of ['plaqueFill', 'plaqueBorder', 'plaqueTop', 'nameColor', 'amountColor', 'lowColor',
    'failColor', 'warnColor', 'hintColor', 'dotGreen', 'dotRed', 'dotGrey', 'dotRice',
    'cardFill', 'cardTop', 'cardBorder', 'cardDivider',
    'paper', 'sheet', 'ink', 'inkSoft', 'inkDim', 'lineStrong', 'ok', 'danger', 'warn']) {
    style[k] = rgba(tokens[k]);
  }
  // 木牌预混色（渲染器按 LightBody 二选一，也可按公式自己算）
  style.plaqueFillLightBody = compositeOver(solid, lightBodyBase);
  style.plaqueFillDarkBody = compositeOver(solid, darkBodyBase);
  style.plaqueShadow = light ? 'rgba(84,66,44,0.1961)' : 'rgba(0,0,0,0.3725)';
  style.woodGrainLight = 'rgba(120,96,60,0.0941)';
  style.woodGrainDark = 'rgba(255,238,205,0.1020)';
  style.key = `${theme}/${pal ? 'api:' + style.selectedId : 'fallback'}`;
  return style;
}

module.exports = { buildStyle, parseThemePalettes, hexToRgb, rgba, mix, compositeOver };
