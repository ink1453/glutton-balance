/*!
 * 饭桶余额 Mac 显示窗 · Canvas 2D 渲染引擎
 * ---------------------------------------------------------------------------
 * 只做「把主进程发来的状态 JSON 画到 canvas」，不做定位/网络/窗口/配置热载。
 * 逐函数对照移植 Win 版 Panel.V3.cs（行号见各函数注释）：
 *   BowlRenderer.DrawSlot/DrawLabel/LabelColors/DrawStatusDot/MeasureFlag
 *   BowlLayout.ComputePlaque（几何由主进程 layout.js 提供，本文件只消费）
 *   RiceCache.GetMound（渲染器里等价实现：master 等比预缩放 + 位移式填充）
 *   BowlRenderer.WithWheels/DrawWheel
 *   WoodPlaqueFill/Border/Shadow/DrawWoodGrain/EnsureContrast/NameMaxWidth/FitNameForSlot
 *   DetailRenderer / VisualStyle（配色由 state.style 提供）
 *
 * 约定：
 *   - canvas 按 devicePixelRatio 放大；本文件内所有几何/字号一律「逻辑点 pt」，
 *     只在设置 canvas.width/height 与 getImageData 时乘 dpr。
 *   - 颜色全部来自 state.style（主进程负责读 Coopanion 主题，渲染器不联网）。
 *   - 普通脚本（非 ES module），挂 window.PBP；window.pbp 不存在时静默降级。
 * 契约：CONTRACT.md §2-§4；规格：spec-panel.md §2-§4；逐函数对照 Win Panel.V3.cs。
 */
(function () {
  'use strict';

  // =========================================================================
  // 0. 常量 / 小工具
  // =========================================================================
  var FONT_FAMILY = '"PingFang SC","Hiragino Sans GB","Heiti SC","Helvetica Neue",sans-serif';
  var VERSION = '1.0.0';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function numOr(v, dflt) { return isNum(v) ? v : dflt; }
  function round(v) { return Math.round(v); }
  function maxNum(a, b) { return a > b ? a : b; }
  function minNum(a, b) { return a < b ? a : b; }

  // =========================================================================
  // 1. 颜色工具（Win 用 GDI+ Color；这里统一成 {r,g,b,a}，a=0..255）
  // =========================================================================
  function parseColor(value) {
    if (value == null) return null;
    if (typeof value === 'object' && isNum(value.r) && isNum(value.g) && isNum(value.b)) {
      return { r: value.r | 0, g: value.g | 0, b: value.b | 0, a: isNum(value.a) ? clamp(Math.round(value.a), 0, 255) : 255 };
    }
    if (typeof value !== 'string') return null;
    var s = value.trim();
    if (!s) return null;
    if (s.charAt(0) === '#') {
      var hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        var ex = '';
        for (var i = 0; i < hex.length; i++) ex += hex.charAt(i) + hex.charAt(i);
        hex = ex;
      }
      if (hex.length === 6) hex = hex + 'ff';
      if (hex.length !== 8) return null;
      var v = parseInt(hex, 16);
      if (!isFinite(v)) return null;
      return {
        r: (v >>> 24) & 0xff, g: (v >>> 16) & 0xff, b: (v >>> 8) & 0xff, a: v & 0xff  // #rrggbbaa（CSS 口径）
      };
    }
    var m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var parts = m[1].split(',');
      if (parts.length < 3) return null;
      var r = clamp(Math.round(parseFloat(parts[0])), 0, 255);
      var g = clamp(Math.round(parseFloat(parts[1])), 0, 255);
      var b = clamp(Math.round(parseFloat(parts[2])), 0, 255);
      var a = 255;
      if (parts.length >= 4) {
        var av = parseFloat(parts[3]);
        a = clamp(Math.round((av <= 1 ? av * 255 : av)), 0, 255);
      }
      if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
      return { r: r, g: g, b: b, a: a };
    }
    return null;
  }

  /** 生成 canvas 可用的 css 颜色（保留 alpha）。 */
  function css(c) {
    if (!c) return 'rgba(0,0,0,0)';
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.a / 255).toFixed(4) + ')';
  }
  /** 强制 alpha（0..255）后的 css。 */
  function cssA(c, alpha) { return css({ r: c.r, g: c.g, b: c.b, a: alpha }); }

  /** Win BowlRenderer.Mix：t=0 → a，t=1 → b，保留 a 的 alpha。 */
  function mix(a, b, t) {
    if (!a) return b ? { r: b.r, g: b.g, b: b.b, a: b.a } : null;
    if (!b) return { r: a.r, g: a.g, b: a.b, a: a.a };
    if (t <= 0) return { r: a.r, g: a.g, b: a.b, a: a.a };
    if (t >= 1) return { r: b.r, g: b.g, b: b.b, a: a.a };
    return {
      r: clamp(Math.round(a.r * (1 - t) + b.r * t), 0, 255),
      g: clamp(Math.round(a.g * (1 - t) + b.g * t), 0, 255),
      b: clamp(Math.round(a.b * (1 - t) + b.b * t), 0, 255),
      a: a.a
    };
  }

  /** Win CompositeOver：半透明前景叠到（近似）不透明底色上，返回不透明色。 */
  function compositeOver(fg, bg) {
    if (!fg) return bg ? { r: bg.r, g: bg.g, b: bg.b, a: 255 } : { r: 0, g: 0, b: 0, a: 255 };
    if (!bg) bg = { r: 0, g: 0, b: 0, a: 255 };
    var al = fg.a / 255;
    return {
      r: clamp(Math.round(fg.r * al + bg.r * (1 - al)), 0, 255),
      g: clamp(Math.round(fg.g * al + bg.g * (1 - al)), 0, 255),
      b: clamp(Math.round(fg.b * al + bg.b * (1 - al)), 0, 255),
      a: 255
    };
  }

  /** WCAG 相对亮度（Win BowlLayout.RelLum）。 */
  function relLum(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    var la = relLum(a), lb = relLum(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Win EnsureContrast：朝更远的一端（黑/白）按 10% 步进，直到对比度 ≥ minRatio。 */
  function ensureContrast(fg, bg, minRatio) {
    if (!fg || !bg) return fg || { r: 255, g: 255, b: 255, a: 255 };
    if (contrastRatio(fg, bg) >= minRatio) return fg;
    var toWhite = relLum(bg) < 0.5;
    var target = toWhite ? { r: 255, g: 255, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 255 };
    var best = fg;
    for (var i = 1; i <= 10; i++) {
      var c = mix(fg, target, i / 10);
      best = c;
      if (contrastRatio(c, bg) >= minRatio) return c;
    }
    return best;
  }

  // =========================================================================
  // 2. 状态 / 资源
  // =========================================================================
  var canvasEl = null;
  var ctx2d = null;
  var currentState = null;
  var currentTokens = null;      // 解析后的 style
  var renderSeq = 0;

  var assetDir = '';
  var assetsRaw = null;
  var bowls = Object.create(null);  // id -> {id, name, pixelW, pixelH, rice, rimY, rimBottom, frontUrl, backUrl, frontImg, backImg, lightBody, ok}
  var bowlOrder = [];
  var riceMaster = null;            // {img, w, h}
  var riceFrames = Object.create(null); // level(0..10) -> img
  var assetLoadPromise = null;
  var assetsLoaded = false;

  var moundCache = Object.create(null);
  var moundCacheCount = 0;

  var textEnabled = true;          // 自测钩子：render(state,{text:false}) 时跳过所有文字
  var lastTextInfo = [];           // 最近一次 render 的文字自适应结果（PBP.debug 用）

  var maskData = null;
  var maskDirty = true;

  function bridge() { return (typeof window !== 'undefined' && window.pbp) ? window.pbp : null; }
  function bridgeCall(name) {
    var b = bridge();
    if (!b || typeof b[name] !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try { return b[name].apply(b, args); } catch (e) { return undefined; }
  }
  function bridgeLog(msg) { if (bridge()) bridgeCall('log', msg); }

  function joinAssetUrl(dir, sub, file) {
    if (!file) return '';
    var f = String(file);
    if (/^(file:|https?:|data:)/i.test(f)) return f;
    var d = String(dir || '');
    if (!d) return f;
    if (d.charAt(d.length - 1) === '/') d = d.slice(0, -1);
    // 已带子目录（bowls/xxx.png）或绝对路径 → 不再拼 sub
    if (f.charAt(0) === '/') return 'file://' + f;
    if (f.indexOf('/') >= 0) return d + '/' + f.replace(/^\.?\//, '');
    return d + '/' + sub + '/' + f;
  }

  /** 组织 assets（init 或 state.assets 均可）；返回是否有变化。 */
  function setAssets(raw, dir) {
    if (!raw && !dir) return false;
    if (dir) assetDir = String(dir);
    if (!raw) return false;
    var changed = false;
    if (raw.__assetDir && String(raw.__assetDir) !== assetDir) {
      assetDir = String(raw.__assetDir);
      changed = true;
    }
    var newBowls = Object.create(null);
    var newOrder = [];
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key.length > 2 && key.indexOf('__') === 0) continue;
      var a = raw[key] || {};
      var id = String(a.id || key).toLowerCase();
      if (newBowls[id]) continue;
      var rice = a.rice || { x: 44, y: 8, w: 232, h: 276 };
      var pixelW = numOr(a.pixelW, numOr(a.width, 320));
      var pixelH = numOr(a.pixelH, numOr(a.height, 290));
      var front = a.front || (id + '.png');
      var back = a.back || (id + '-back.png');
      var prev = bowls[id];
      var entry = {
        id: id,
        name: a.name || id,
        pixelW: pixelW,
        pixelH: pixelH,
        rice: { x: numOr(rice.x, 44), y: numOr(rice.y, 8), w: numOr(rice.w, 232), h: numOr(rice.h, 276) },
        rimY: numOr(a.rimY, 54),
        rimBottom: numOr(a.rimBottom, 80),
        frontUrl: joinAssetUrl(assetDir, 'bowls', front),
        backUrl: joinAssetUrl(assetDir, 'bowls', back),
        frontImg: null, backImg: null, lightBody: false, ok: false
      };
      if (prev && prev.frontUrl === entry.frontUrl && prev.backUrl === entry.backUrl) {
        entry.frontImg = prev.frontImg;
        entry.backImg = prev.backImg;
        entry.lightBody = prev.lightBody;
        entry.ok = prev.ok;
      }
      newBowls[id] = entry;
      newOrder.push(id);
      changed = true;
    }
    if (newOrder.length) {
      bowls = newBowls;
      bowlOrder = newOrder;
      changed = true;
    }
    // 米堆 master + 兜底帧
    var rm = raw.__riceMaster;
    var masterChanged = false;
    if (rm && rm.file) {
      var mw = numOr(rm.w, 400), mh = numOr(rm.h, 263);
      var murl = joinAssetUrl(assetDir, 'rice', rm.file);
      if (!riceMaster || riceMaster.url !== murl) {
        riceMaster = { url: murl, w: mw, h: mh, img: null };
        masterChanged = true;
      }
    }
    var frames = raw.__riceFrames;
    if (frames && frames.length) {
      var nextFrames = Object.create(null);
      for (var k = 0; k < frames.length; k++) {
        var f = frames[k];
        if (!f) continue;
        var lvl = parseInt(String(f).replace(/[^0-9]/g, ''), 10);
        if (!isFinite(lvl)) lvl = k;
        var furl = joinAssetUrl(assetDir, 'rice', f);
        var old = riceFrames[lvl];
        var ni = (old && old.url === furl) ? old : { url: furl, img: null };
        if (ni !== old) masterChanged = true;
        nextFrames[lvl] = ni;
      }
      riceFrames = nextFrames;
    }
    if (changed || masterChanged) {
      moundCache = Object.create(null);
      moundCacheCount = 0;
      frameCache = Object.create(null);
      frameCacheCount = 0;
      startPreload();
    }
    return changed || masterChanged;
  }

  function startPreload() {
    assetsLoaded = false;
    assetLoadPromise = preloadAll().then(function () {
      assetsLoaded = true;
      if (currentState) {
        // 资源晚到：补画一次（主进程正常会等 ready 再发 state，这里只兜底）
        try { render(currentState); } catch (e) { }
      }
      return true;
    }).catch(function () { assetsLoaded = true; return false; });
    return assetLoadPromise;
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      try { img.src = url; } catch (e) { resolve(null); }
    });
  }

  /** Win BowlAssets.IsLight：下半部、每 4px 采样、跳过 alpha<20，平均亮度 >140 → 浅色盆身。 */
  function isLightFromImage(img) {
    try {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) return false;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      var data = g.getImageData(0, 0, w, h).data;
      var sum = 0, n = 0;
      for (var y = Math.floor(h / 2); y < h; y += 4) {
        for (var x = 2; x < w; x += 4) {
          var idx = (y * w + x) * 4;
          var a = data[idx + 3];
          if (a < 20) continue;
          sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          n++;
        }
      }
      return n > 0 && (sum / n) > 140;
    } catch (e) {
      return false;
    }
  }

  function preloadAll() {
    var jobs = [];
    var ids = bowlOrder.slice();
    ids.forEach(function (id) {
      var b = bowls[id];
      if (!b) return;
      if (!b.frontImg && b.frontUrl) {
        jobs.push(loadImage(b.frontUrl).then(function (img) {
          b.frontImg = img;
          b.ok = !!img;
          b.lightBody = img ? isLightFromImage(img) : false;
        }));
      }
      if (!b.backImg && b.backUrl) {
        jobs.push(loadImage(b.backUrl).then(function (img) { b.backImg = img; }));
      }
    });
    if (riceMaster && !riceMaster.img) {
      // 自带 w/h 优先，缺省用图片真实尺寸
      jobs.push(loadImage(riceMaster.url).then(function (img) {
        riceMaster.img = img;
        if (img) {
          riceMaster.w = img.naturalWidth || riceMaster.w;
          riceMaster.h = img.naturalHeight || riceMaster.h;
        }
      }));
    }
    if (riceMaster && riceMaster.img === null && riceMaster.url) {
      // master 缺失（加载失败）时把 11 帧全载入做兜底
    }
    Object.keys(riceFrames).forEach(function (lvl) {
      var f = riceFrames[lvl];
      if (!f || f.img) return;
      jobs.push(loadImage(f.url).then(function (img) { f.img = img; }));
    });
    return Promise.all(jobs).then(function () {
      // master 加载失败 → 兜底帧可能已载入；再补一次 lightBody（图片可能刚载入）
      return Promise.all(bowlOrder.map(function (id) {
        var b = bowls[id];
        if (b && b.frontImg && !b.lightBody) b.lightBody = isLightFromImage(b.frontImg);
        return null;
      }));
    });
  }

  function pickBowl(state) {
    var want = '';
    try { want = String((state.cfg && state.cfg.display && state.cfg.display.bowlStyle) || '').toLowerCase(); } catch (e) { }
    if (want && bowls[want]) return bowls[want];
    if (want && bowls[want.replace(/^custom:/, '')]) return bowls[want.replace(/^custom:/, '')];
    if (bowls.porcelain) return bowls.porcelain;
    if (bowlOrder.length) return bowls[bowlOrder[0]];
    return null;
  }

  // =========================================================================
  // 3. 文本工具（Win GDI+ DrawString 的近似：字号=逻辑点，行盒按字体 ascent/descent 居中）
  // =========================================================================
  function fontSpec(px, weight) { return (weight || 'normal') + ' ' + px + 'px ' + FONT_FAMILY; }

  function fontMetrics(ctx, px, weight) {
    ctx.font = fontSpec(px, weight);
    var m = ctx.measureText('国Ag');
    var asc = m.fontBoundingBoxAscent;
    var desc = m.fontBoundingBoxDescent;
    if (!isNum(asc)) asc = px * 0.92;
    if (!isNum(desc)) desc = px * 0.24;
    return { asc: asc, desc: desc, lineH: asc + desc };
  }

  function measureText(ctx, text, px, weight) {
    ctx.font = fontSpec(px, weight);
    return ctx.measureText(text == null ? '' : String(text)).width;
  }

  /**
   * 绘制一行文字（逻辑点）。
   * opts: {x, cy?|top?, align:'center'|'left'|'right', px, weight, color(已 css 字符串)}
   *  - cy 给定时按 Win StringFormat Center/Center 口径纵向居中（行盒中心 = cy）
   *  - top 给定时按 Win 默认 DrawString 左上口径（行盒顶 = top）
   */
  function drawText(ctx, text, opts) {
    if (!textEnabled) return;
    if (text == null || text === '') return;
    var px = opts.px;
    var weight = opts.weight || 'normal';
    var align = opts.align || 'center';
    if (!isNum(px) || px <= 0) return;
    var fm = fontMetrics(ctx, px, weight);
    var y;
    if (isNum(opts.cy)) y = opts.cy + (fm.asc - fm.desc) / 2;
    else y = numOr(opts.top, 0) + fm.asc;
    ctx.save();
    ctx.font = fontSpec(px, weight);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    // P0-I：可选 1px 反色描边（家名用「单遍实色 + halo」替代旧版三遍偏移刻痕，小尺寸更清楚）
    if (opts.halo) {
      ctx.strokeStyle = opts.halo;
      ctx.lineWidth = numOr(opts.haloWidth, Math.max(1, px * 0.18));
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(String(text), opts.x, y);
    }
    ctx.fillStyle = opts.color || '#fff';
    ctx.fillText(String(text), opts.x, y);
    ctx.restore();
  }

  /** Win FitText / FitTextEx：按 0.25px 步长缩字号到 maxW 内，不低于 floorPx。 */
  function fitShrink(ctx, text, basePx, maxW, floorPx, weight, step) {
    text = text == null ? '' : String(text);
    var px = basePx;
    var w = measureText(ctx, text, px, weight);
    var guard = 0;
    var st = step || 0.25;
    while (w > maxW && px > floorPx && guard++ < 240) {
      px -= st;
      if (px < floorPx) px = floorPx;
      w = measureText(ctx, text, px, weight);
    }
    return { px: px, w: w, shrunk: px < basePx - 0.01, ellipsized: w > maxW + 0.5 };
  }

  /** Win NAME-AUTOFIT 的中间省略：保留头尾，直到含「…」后宽度放得下。 */
  function ellipsizeMiddle(ctx, text, px, weight, maxW) {
    var cut = String(text);
    var cand = cut + '…';
    var ew = measureText(ctx, cand, px, weight);
    var guard = 0;
    while (cut.length > 1 && ew > maxW && guard++ < 200) {
      var mid = Math.floor(cut.length / 2);
      cut = cut.slice(0, mid) + cut.slice(mid + 1);
      cand = cut + '…';
      ew = measureText(ctx, cand, px, weight);
    }
    return { text: cut.length > 0 ? cut + '…' : '…', w: ew };
  }

  /** 名称自适应：先缩字号，缩到下限仍放不下 → 中间省略。 */
  function fitName(ctx, name, basePx, maxW, floorPx, weight) {
    var r = fitShrink(ctx, name, basePx, maxW, floorPx, weight);
    if (r.w > maxW) {
      var e = ellipsizeMiddle(ctx, name, r.px, weight, maxW);
      r.text = e.text;
      r.w = e.w;
      r.ellipsized = true;
    } else {
      r.text = String(name);
    }
    return r;
  }

  /** GDI EllipsisCharacter 的近似：尾部省略到宽度内（L2 旗面用）。 */
  function ellipsizeEnd(ctx, text, px, weight, maxW) {
    text = text == null ? '' : String(text);
    var w = measureText(ctx, text, px, weight);
    if (w <= maxW) return text;
    var t = text;
    var guard = 0;
    while (t.length > 1 && guard++ < 200) {
      t = t.slice(0, -1);
      if (measureText(ctx, t + '…', px, weight) <= maxW) return t + '…';
    }
    return '…';
  }

  // =========================================================================
  // 4. 通用图形工具
  // =========================================================================
  function roundRectPath(ctx, x, y, w, h, r) {
    if (r < 0.5) r = 0.5;
    var d = r * 2;
    if (d > w) d = w;
    if (d > h) d = h;
    r = d / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, w, h, r, fillStyle) {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  function strokeRoundRect(ctx, x, y, w, h, r, strokeStyle, lineWidth) {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // =========================================================================
  // 5. style → 渲染 token（全部颜色来自 state.style）
  // =========================================================================
  var FALLBACK_DARK = {
    plaqueFill: '#121214ee', plaqueBorder: '#55555b', plaqueTop: 'rgba(255,255,255,0.12)',
    nameColor: '#838389', amountColor: '#eaeaec', lowColor: '#e27e70', failColor: '#838389',
    warnColor: '#c4a372', hintColor: '#b1b1b6',
    dotGreen: '#76ca9f', dotRed: '#e27e70', dotGrey: '#838389', dotRice: '#eec678',
    cardFill: '#121214f4', cardTop: 'rgba(255,255,255,0.12)', cardBorder: '#55555b',
    cardDivider: 'rgba(85,85,91,0.27)', paper: '#121214', sheet: '#1e1e21', warn: '#c4a372',
    lineStrong: '#55555b', ink: '#eaeaec', inkDim: '#838389'
  };
  var FALLBACK_LIGHT = {
    plaqueFill: '#f6f8f9fa', plaqueBorder: '#aeaeb3', plaqueTop: 'rgba(255,255,255,0.157)',
    nameColor: '#8b8b91', amountColor: '#1b1b1f', lowColor: '#b45950', failColor: '#8b8b91',
    warnColor: '#96743b', hintColor: '#5c5c62',
    dotGreen: '#19815e', dotRed: '#b45950', dotGrey: '#8b8b91', dotRice: '#be9650',
    cardFill: '#fbfbfcf6', cardTop: 'rgba(255,255,255,0.149)', cardBorder: '#aeaeb3',
    cardDivider: 'rgba(174,174,179,0.275)', paper: '#f5f5f6', sheet: '#fbfbfc', warn: '#96743b',
    lineStrong: '#aeaeb3', ink: '#1b1b1f', inkDim: '#8b8b91'
  };

  function buildTokens(style) {
    var raw = style || {};
    var light = (raw.light === true) || (String(raw.theme || '').toLowerCase() === 'light');
    var dflt = light ? FALLBACK_LIGHT : FALLBACK_DARK;
    function col(key) {
      return parseColor(raw[key]) || parseColor(dflt[key]) || { r: 128, g: 128, b: 128, a: 255 };
    }
    var t = {
      light: light,
      theme: light ? 'light' : 'dark',
      selectedId: raw.selectedId || '',
      plaqueFill: col('plaqueFill'),
      plaqueBorder: col('plaqueBorder'),
      plaqueTop: col('plaqueTop'),
      nameColor: col('nameColor'),
      amountColor: col('amountColor'),
      lowColor: col('lowColor'),
      failColor: col('failColor'),
      warnColor: col('warnColor'),
      hintColor: col('hintColor'),
      dotGreen: col('dotGreen'),
      dotRed: col('dotRed'),
      dotGrey: col('dotGrey'),
      dotRice: col('dotRice'),
      cardFill: col('cardFill'),
      cardTop: col('cardTop'),
      cardBorder: col('cardBorder'),
      cardDivider: col('cardDivider'),
      paper: col('paper'),
      sheet: col('sheet'),
      ink: col('ink'),
      inkDim: col('inkDim'),
      warn: col('warn'),
      lineStrong: col('lineStrong'),
      plaqueFillLightBody: parseColor(raw.plaqueFillLightBody),
      plaqueFillDarkBody: parseColor(raw.plaqueFillDarkBody),
      plaqueShadow: parseColor(raw.plaqueShadow),
      woodGrainLight: parseColor(raw.woodGrainLight),
      woodGrainDark: parseColor(raw.woodGrainDark),
    };
    if (!t.plaqueFillLightBody || !t.plaqueFillDarkBody) {
      // 主进程未给预混色时，按 Win WoodPlaqueFill 公式自行合成
      var tt = light ? 0.20 : 0.18; // J：与 src/style.js 同步（浅主题木牌加深）
      var baseMix = mix(t.paper, t.warn, tt);
      var solid = { r: baseMix.r, g: baseMix.g, b: baseMix.b, a: 246 };
      t.plaqueFillLightBody = compositeOver(solid, { r: 243, g: 240, b: 235, a: 255 });
      t.plaqueFillDarkBody = compositeOver(solid, { r: 30, g: 33, b: 38, a: 255 });
    }
    t.tagBorder = mix(t.lineStrong, t.warn, light ? 0.55 : 0.30); // J：浅主题描边加深
    t.tagShadow = t.plaqueShadow || (light ? { r: 84, g: 66, b: 44, a: 50 } : { r: 0, g: 0, b: 0, a: 95 });
    t.grain = (light ? t.woodGrainLight : t.woodGrainDark) || (light
      ? { r: 120, g: 96, b: 60, a: 24 }
      : { r: 255, g: 238, b: 205, a: 26 });
    // —— 第 6 轮 A2 · #3 P0 渲染层小改：主题感知派生用色（全部由现有 token 推导；不动 assets / 布局几何）——
    t.rimOutline = light ? { r: 169, g: 180, b: 198, a: 150 } : { r: 255, g: 255, b: 255, a: 70 };
    t.rimOutlineStrong = light ? { r: 140, g: 152, b: 172, a: 205 } : { r: 255, g: 255, b: 255, a: 128 };
    t.bowlGroundShadow = light ? { r: 46, g: 40, b: 32, a: 44 } : { r: 0, g: 0, b: 0, a: 26 };
    t.backShade = light ? 0.86 : 1.0; // D：浅主题内壁整体压暗 14%（浅底看清内壁/轮廓）
    t.backEdge = light ? { r: 0, g: 0, b: 0, a: 52 } : { r: 0, g: 0, b: 0, a: 72 };
    t.seamShadow = light ? { r: 0, g: 0, b: 0, a: 46 } : { r: 0, g: 0, b: 0, a: 60 };
    t.contactShadow = light ? { r: 0, g: 0, b: 0, a: 46 } : { r: 0, g: 0, b: 0, a: 58 };
    return t;
  }

  function bowlBodyBase(lightBody) {
    return lightBody
      ? { r: 243, g: 240, b: 235, a: 255 }
      : { r: 30, g: 33, b: 38, a: 255 };
  }

  /** Win BowlRenderer.LabelColors：三款共用名称/数值/阴影/点配色。 */
  function labelColors(view, lightBody, t) {
    if (!view) return null;
    var nameCol, valCol, shadowCol, dot;
    if (view.rice) {
      nameCol = lightBody ? { r: 120, g: 96, b: 52, a: 255 } : { r: 238, g: 205, b: 140, a: 255 };
      valCol = nameCol;
      shadowCol = lightBody ? { r: 255, g: 255, b: 255, a: 150 } : { r: 0, g: 0, b: 0, a: 190 };
    } else if (!view.hasResult || !view.ok) {
      nameCol = lightBody ? { r: 104, g: 110, b: 122, a: 255 } : { r: 196, g: 202, b: 214, a: 255 };
      valCol = nameCol;
      shadowCol = lightBody ? { r: 255, g: 255, b: 255, a: 150 } : { r: 0, g: 0, b: 0, a: 190 };
    } else if (view.low) {
      nameCol = lightBody ? { r: 168, g: 46, b: 40, a: 255 } : { r: 255, g: 158, b: 148, a: 255 };
      valCol = nameCol;
      shadowCol = lightBody ? { r: 255, g: 255, b: 255, a: 140 } : { r: 0, g: 0, b: 0, a: 190 };
    } else {
      nameCol = lightBody ? { r: 72, g: 64, b: 52, a: 255 } : { r: 246, g: 242, b: 232, a: 255 };
      valCol = lightBody ? { r: 48, g: 42, b: 34, a: 255 } : { r: 252, g: 249, b: 242, a: 255 };
      shadowCol = lightBody ? { r: 255, g: 255, b: 255, a: 160 } : { r: 0, g: 0, b: 0, a: 200 };
    }
    dot = view.rice ? t.dotRice
      : (!view.hasResult || !view.ok ? t.dotGrey : (view.low ? t.dotRed : t.dotGreen));
    return { nameCol: nameCol, valCol: valCol, shadowCol: shadowCol, dot: dot };
  }

  /**
   * 名称带：CREDITS 时把单位并进名称（木牌内宽约 40px，放不下整段「数值 Credits」；
   * 明细卡等宽处仍用 valueText 的完整「2177.00 Credits」）。
   */
  function labelName(view) {
    var name = view && view.name ? String(view.name) : '';
    if (!name) return '';
    // 2026-11-13 老板令：木牌上不写 "Credits" 字样，单位改成金额前的符号（见 CREDITS_SYMBOL）
    return name;
  }

  /**
   * 金额取整（老板 2026-11-13 令：「把小数点后去掉」）。
   * 只影响**显示文本**，不影响任何阈值/液面/状态点判断——主进程算 low 用的是原始 amount。
   * 四舍五入到个位：1626.7 → 1627、82.4 → 82。负数按绝对值舍入后补负号，避免 -0。
   */
  function moneyText(amount) {
    var n = Number(amount);
    if (!isFinite(n)) return '0';
    var r = n < 0 ? -Math.round(-n) : Math.round(n);
    if (r === 0) r = 0;  // 归一 -0
    return String(r);
  }

  /** 木牌/饭票上的金额：CREDITS 只给整数数值（不带 ¥/$），单位由名称带标注。 */
  function labelAmountText(view) {
    if (!view) return '';
    if (String(view.currency || 'CNY').toUpperCase() !== 'CREDITS') return valueText(view);
    if (view.rice) return '盆满钵满';
    if (!view.hasResult || !view.ok) return '连接失败';
    var amount = Number(view.amount);
    if (!isFinite(amount)) amount = 0;
    return CREDITS_SYMBOL + moneyText(amount);
  }
  /** Credits 的符号（老板 2026-11-13 令：和 ¥/$ 一样放在金额前面，不写 Credits 字样）。 */
  // 第 27 轮改：原用 ₡（U+20A1 科朗符号）。老板实测小卡片里「太粗、突兀」——根因是 PingFang SC
  // 不含 U+20A1，系统回退到后备字体渲染，字重与旁边数字不匹配。改用拉丁大写 C + 一个空格：
  // C = Credits 首字母，PingFang SC 原生自带，粗细与 ¥/$ 同档，不再被后备字体接管。
  // 空格是必须的：不留空格时 C 与数字视觉粘连（C1642 易误读成标识符）。
  var CREDITS_SYMBOL = 'C ';
  /** Win BowlRenderer.ValueText：大白饭/断线/币种符号 + 两位小数；CREDITS 不带 ¥/$，单位写 Credits。 */
  function valueText(view) {
    if (!view) return '';
    if (view.rice) return '盆满钵满';
    if (!view.hasResult || !view.ok) return '连接失败';
    var code = String(view.currency || 'CNY').toUpperCase();
    var amount = Number(view.amount);
    if (!isFinite(amount)) amount = 0;
    if (code === 'CREDITS') return CREDITS_SYMBOL + moneyText(amount);
    var symbol = code === 'USD' ? '$' : '¥';
    return symbol + moneyText(amount);
  }

  // =========================================================================
  // 6. 饭桶 / 米饭 / 轮子
  // =========================================================================
  function drawImageStretch(ctx, img, x, y, w, h) {
    if (!img || w <= 0 || h <= 0) return false;
    try { ctx.drawImage(img, x, y, w, h); return true; } catch (e) { return false; }
  }

  // -------------------------------------------------------------------------
  // 第 6 轮 A2 · #3 P0 渲染层小改（不动 assets、不改布局几何口径）
  //   C：主题感知 1px 描边 + 桶底淡落影（浅底白瓷/浅色桶轮廓不再隐形）
  //   D：back 浅主题压暗 14% + 内沿 1px 描边 + 接缝柔和暗弧
  //   K：深主题下深色桶身（黑陶/不锈钢）整幅提亮 8% + 弱亮边
  // -------------------------------------------------------------------------
  var silhouetteCache = Object.create(null);
  var silhouetteCount = 0;
  /** 取「整幅染色剪影」缓存（按 front 图 alpha 上色），用于 1px 描边。 */
  function getSilhouette(img, w, h, dpr, colorCss) {
    if (!img || !(w > 0) || !(h > 0)) return null;
    var cw = Math.max(2, Math.round(w * dpr)), ch = Math.max(2, Math.round(h * dpr));
    var key = String(img.src || '') + '|' + cw + 'x' + ch + '|' + colorCss;
    var hit = silhouetteCache[key];
    if (hit) return hit;
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    try {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, cw, ch);
    } catch (e) { return null; }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = colorCss;
    g.fillRect(0, 0, cw, ch);
    if (silhouetteCount > 96) { silhouetteCache = Object.create(null); silhouetteCount = 0; }
    silhouetteCache[key] = c; silhouetteCount++;
    return c;
  }

  /** P0-C：桶底淡落影（浅主题更实、深主题更淡），给桶身一个落地边界。 */
  function drawBowlGroundShadow(ctx, slot, scale, t) {
    var bw = numOr(slot.bowlW, 62), bh = numOr(slot.bowlH, 56);
    var bottom = numOr(slot.bottom, numOr(slot.top, 0) + bh);
    var cx = numOr(slot.x, 0) + bw / 2;
    ctx.save();
    try { ctx.filter = 'blur(' + (1.6 * scale).toFixed(2) + 'px)'; } catch (e) { /* ignore */ }
    ctx.fillStyle = css(t.bowlGroundShadow);
    ctx.beginPath();
    ctx.ellipse(cx, bottom - 0.4 * scale, bw * 0.40, Math.max(1.2, 1.9 * scale), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** P0-D：背面（内壁）——浅主题压暗 + 内沿描边 + 接缝暗弧；深主题保持原样。 */
  function drawBowlBack(ctx, img, x, y, w, h, scale, t) {
    if (!img) return;
    ctx.save();
    if (t.backShade < 0.999) { try { ctx.filter = 'brightness(' + t.backShade.toFixed(3) + ')'; } catch (e) { /* ignore */ } }
    drawImageStretch(ctx, img, x, y, w, h);
    ctx.restore();
    // 内壁椭圆（资产口径：bbox x 20..301 / y 30..78，基于 320×290）
    var ecx = x + w * 0.5016, ecy = y + h * 0.1862;
    var erx = w * 0.4391, ery = h * 0.0828;
    ctx.save();
    ctx.strokeStyle = css(t.backEdge);
    ctx.lineWidth = Math.max(1, 0.7 * scale);
    ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.stroke();
    // 接缝：内壁下沿一条柔和暗弧（米/桶沿交界不再「平切贴上去」）
    ctx.strokeStyle = css(t.seamShadow);
    ctx.lineWidth = Math.max(1, 0.9 * scale);
    ctx.beginPath(); ctx.ellipse(ecx, ecy + Math.max(0.5, 0.8 * scale), erx, ery, 0, 0.10 * Math.PI, 0.90 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  /** P0-C/K：正面（壳）——主题感知 1px 描边 + 深主题深色桶身提亮。 */
  function drawBowlFront(ctx, img, x, y, w, h, scale, t, dpr, opts) {
    if (!img) return;
    var o = opts || {};
    var outline = o.outlineColor || t.rimOutline;
    if (o.darkBowl && !t.light) outline = t.rimOutlineStrong;
    var sil = getSilhouette(img, w, h, dpr, css(outline));
    if (sil) {
      var sw = sil.width / dpr, sh = sil.height / dpr;
      var off = Math.max(0.7, 0.85 * scale);
      var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
      for (var i = 0; i < dirs.length; i++) {
        try { ctx.drawImage(sil, x + dirs[i][0] * off, y + dirs[i][1] * off, sw, sh); } catch (e) { /* ignore */ }
      }
    }
    ctx.save();
    if (o.brighten && o.brighten !== 1) { try { ctx.filter = 'brightness(' + o.brighten + ')'; } catch (e) { /* ignore */ } }
    drawImageStretch(ctx, img, x, y, w, h);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 米饭口径（2026-11-10 热修 · 对齐 Win BowlRenderer.DrawSlot）
  //   旧口径（第 6 轮 A3）：11 档帧「内容顶贴米尖线」，米尖行程只有 0.236×前脸 →
  //     Mac 上米饭只露出帧的一道小尖，视觉「稀、少」，与 Win 明显不一致（老板 2026-11-10 反馈）。
  //   现行：rice-master 整堆按 fill 平移（= Win 口径）——
  //     surface = (rimBottom-2) - fill × (0.45 × frontFace)，整堆等比缩到宽 riceW
  //     （高 = 263/400 × riceW），顶边贴 surface、下缘被前层自然盖住；
  //     满盆米山高出桶沿 45% 前脸（突出饱满），低余额米山随 fill 平滑下沉。
  //   11 档帧只在 rice-master 缺失（自定义/残缺素材）时兜底，保证米饭不空白。
  // -------------------------------------------------------------------------
  var RICE_MAX_OVERFLOW = 0.45;    // 米山行程 = 0.45×前脸（Win 口径；旧帧口径 0.236）
  var RICE_FRAME_TIP_TRAVEL = 0.236; // 兜底帧口径的米尖行程（仅 master 缺失时用）

  var frameCache = Object.create(null);
  var frameCacheCount = 0;

  /** 取第 level 档米饭帧的缩放画布（400×320 → 宽 w、高 w×0.8），并量出内容顶（兜底路径用）。 */
  function getRiceFrame(level, w, dpr) {
    var f = riceFrames[level];
    if (!f || !f.img) return null;
    w = Math.max(8, Math.round(w));
    var sw = f.img.naturalWidth || 400;
    var sh = f.img.naturalHeight || 320;
    var h = Math.max(4, Math.round(sh * w / sw));
    var key = 'f' + level + '|' + w + '|' + h + '|' + dpr;
    var hit = frameCache[key];
    if (hit) return hit;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    try { g.drawImage(f.img, 0, 0, c.width, c.height); } catch (e) { return null; }
    var contentTopPx = 0;
    try {
      var data = g.getImageData(0, 0, c.width, c.height).data;
      for (var y = 0; y < c.height; y++) {
        var has = false;
        for (var x = 0; x < c.width; x++) { if (data[(y * c.width + x) * 4 + 3] > 16) { has = true; break; } }
        if (has) { contentTopPx = y; break; }
      }
    } catch (e) { contentTopPx = 0; }
    var out = { canvas: c, w: w, h: h, contentTop: contentTopPx / dpr, contentH: h - contentTopPx / dpr };
    if (frameCacheCount > 200) { frameCache = Object.create(null); frameCacheCount = 0; }
    frameCache[key] = out; frameCacheCount++;
    return out;
  }

  /** rice-master 整堆按目标宽等比缩放（Win：高 = 263/400×w），60fps 只 blit。 */
  function getMoundCanvas(level, w, dpr) {
    if (!riceMaster || !riceMaster.img) return null;
    w = Math.max(8, Math.round(w));
    var sw = riceMaster.w || 400, sh = riceMaster.h || 263;
    var h = Math.max(4, Math.round(sh * w / sw));
    var key = 'm|' + w + '|' + h + '|' + dpr;
    var hit = moundCache[key];
    if (hit) return hit;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    try { g.drawImage(riceMaster.img, 0, 0, c.width, c.height); } catch (e) { return null; }
    if (moundCacheCount > 200) { moundCache = Object.create(null); moundCacheCount = 0; }
    moundCache[key] = c; moundCacheCount++;
    return c;
  }

  /** 米饭段：rice-master 整堆按 fill 平移（Win 口径）+ master 缺失时 11 档帧兜底。 */
  function drawRice(ctx, state, bowl, slot, view, dpr, scale) {
    if (!view) return;
    var rice = !!view.rice;
    var ratio = clamp(numOr(view.ratio, 0), 0, 1);
    if (!rice && ratio <= 0.015) return;
    var level = rice ? 10 : Math.round(ratio * 10);
    if (level <= 0) return;
    var fill = rice ? 1 : ratio;
    var t = currentTokens || buildTokens(state.style);
    var plaque = slot.plaque || {};
    var rimBottom = numOr(slot.rimBottom, numOr(slot.rimY, slot.top + slot.bowlH * 0.42));
    var bottom = slot.bottom;
    var frontFace = isNum(plaque.frontFace) ? plaque.frontFace : maxNum(4, bottom - rimBottom);
    if (frontFace < 4) frontFace = 4;
    var baseY = rimBottom - 2;                     // 空盆米面基准（沿前沿线）
    if (baseY > bottom) baseY = bottom;
    var surface = baseY - fill * (RICE_MAX_OVERFLOW * frontFace); // 米山顶边
    var riceW = numOr(slot.riceW, Math.round(slot.bowlW * 0.55));

    var mound = getMoundCanvas(level, riceW, dpr);
    if (mound) {
      var dw = mound.width / dpr, dh = mound.height / dpr;   // dw == riceW（等比缩放画布）
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(mound, Math.round(slot.riceX), Math.round(surface), dw, dh); } catch (e) { /* ignore */ }
      ctx.restore();
      return;
    }

    // 兜底：master 缺失（自定义/残缺素材）→ 11 档帧，内容顶贴米尖线（旧帧口径）
    var frame = getRiceFrame(level, riceW, dpr);
    if (frame) {
      var tipY = baseY - fill * (RICE_FRAME_TIP_TRAVEL * frontFace);
      if (tipY > rimBottom) tipY = rimBottom;
      var drawX2 = slot.riceX;
      var drawY2 = tipY - frame.contentTop;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(frame.canvas, Math.round(drawX2), Math.round(drawY2), frame.w, frame.h); } catch (e) { /* ignore */ }
      // P0-F：米堆与桶沿接触阴影
      if (scale > 0 && rimBottom > tipY + 0.5 * scale) {
        var cTop = Math.max(tipY + 0.5 * scale, rimBottom - 4.2 * scale);
        if (rimBottom > cTop) {
          var grd = ctx.createLinearGradient(0, cTop, 0, rimBottom + 0.4 * scale);
          grd.addColorStop(0, 'rgba(0,0,0,0)');
          grd.addColorStop(1, css(t.contactShadow));
          ctx.save();
          ctx.fillStyle = grd;
          ctx.fillRect(drawX2 - 0.5, cTop, frame.w + 1, rimBottom + 0.4 * scale - cTop);
          ctx.restore();
        }
      }
    }
  }

  /** Win BowlRenderer.DrawWheel：轮胎 + 轮毂 + 3 辐条 + 不对称亮片。 */
  function drawWheel(ctx, cx, cy, r, angleDeg) {
    if (r <= 0) return;
    var rot = (angleDeg || 0) * Math.PI / 180;
    ctx.save();
    ctx.fillStyle = 'rgba(74,82,94,0.9412)'; // 240/255
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(204,213,224,0.9608)'; // 245/255
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(96,108,122,0.9216)'; // 235/255
    ctx.lineWidth = Math.max(1, r * 0.26);
    ctx.lineCap = 'butt'; // Win GDI+ Pen 默认平头（不要圆头，避免盖住轮毂中心）
    for (var k = 0; k < 3; k++) {
      var a = rot + k * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.28);
      ctx.lineTo(cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84);
      ctx.stroke();
    }
    var mx = cx + Math.cos(rot - Math.PI / 2) * r * 0.72;
    var my = cy + Math.sin(rot - Math.PI / 2) * r * 0.72;
    var mr = Math.max(0.7, r * 0.17);
    ctx.fillStyle = 'rgba(236,240,246,0.9804)'; // 250/255
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** Win BowlRenderer.DrawStatusDot：暗影 + 实心 + 1px 白边 + 左上高光（三款共用）。 */
  function drawStatusDot(ctx, dcx, dcy, dotD, dot, scale) {
    if (!dot) return;
    var dr = Math.max(1.1, dotD / 2);
    ctx.save();
    // 状态灯缩小约 25%：细化灯座/高光，避免缩小后描边仍显得过大。
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = Math.max(0.6, 0.65 * scale);
    ctx.beginPath(); ctx.arc(dcx, dcy, dr + 0.6 * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.2745)'; // 70/255
    ctx.beginPath(); ctx.arc(dcx, dcy + scale * 0.5, dr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(dot);
    ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8039)'; // 205/255
    ctx.lineWidth = Math.max(0.7, 0.65 * scale);
    ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4706)'; // 120/255
    ctx.beginPath();
    ctx.ellipse(dcx - dr * 0.5, dcy - dr * 0.6, dr * 0.375, dr * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // 7. 数值三条带：
  //    L3 = 木牌（牌内金额 + 牌下刻字家名 + 中间绿点）
  //    L1 = 无底板的盆沿小字（复用三条带）
  //    L2 = 饭票小旗（插在盆沿上方）
  // =========================================================================
  function recordText(info) {
    if (lastTextInfo.length < 16) lastTextInfo.push(info);
  }

  function layoutScale(lay) {
    var gs = numOr(lay && lay.graphicsScale, 1);
    var dpi = numOr(lay && lay.dpiScale, 1);
    return maxNum(0.85, gs) * dpi;
  }

  /** Win WoodPlaqueFill/Border/Shadow/DrawWoodGrain 的等价实现（颜色全部来自 token）。 */
  function drawWoodPlaque(ctx, t, tx, ty, tw, th, scale, lightBody) {
    var corner = Math.max(2, scale * 1.8);
    // 投影（浅主题更淡）：偏移 (0.7s, 1.6s)
    fillRoundRect(ctx, tx + scale * 0.7, ty + scale * 1.6, tw, th, corner, css(t.tagShadow));
    var fill = lightBody ? t.plaqueFillLightBody : t.plaqueFillDarkBody;
    fillRoundRect(ctx, tx, ty, tw, th, corner, css(fill));
    // P0-J：木纹只保留 1 条更粗的线（旧版 2 条在小尺寸下几乎不可见）
    ctx.save();
    ctx.strokeStyle = css(t.grain);
    ctx.lineWidth = Math.max(1, 0.8 * scale);
    var x0 = tx + 2.6 * scale;
    var x1 = tx + tw - 2.6 * scale;
    var y1 = ty + th * 0.46;
    ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    // P0-J：浅主题内缩 1px 深描边（内缩 1.1*scale，避开木牌底色取样点）
    if (t.light) {
      var inset = Math.max(1, 1.1 * scale);
      strokeRoundRect(ctx, tx + inset, ty + inset, Math.max(1, tw - 2 * inset), Math.max(1, th - 2 * inset),
        Math.max(1, corner - inset), 'rgba(0,0,0,0.16)', Math.max(0.8, 0.7 * scale));
    }
    // 描边：Mix(lineStrong, warn, light?0.55:0.30)，线宽 max(1, 0.7*scale)
    strokeRoundRect(ctx, tx, ty, tw, th, corner, css(t.tagBorder), Math.max(1, 0.7 * scale));
    return fill;
  }

  /** L3 盆沿木牌。 */
  function drawLabelL3(ctx, t, slot, view, bowl, scale) {
    var plaque = slot.plaque || {};
    var cx = slot.x + slot.bowlW / 2;
    var th = numOr(plaque.plaqueH, 0);
    var tw = numOr(plaque.plaqueW, 0);
    if (!plaque.plaqueBody || th <= 0 || tw <= 0) {
      // 布局未给底板但样式是 L3：退化为 L1 三条带，避免空白
      return drawLabelL1(ctx, t, slot, view, bowl, scale);
    }
    var ty = numOr(plaque.plaqueTop, 0);
    var gapBottomMin = numOr(plaque.gapBottomMin, 2 * scale);
    if (ty + th > slot.bottom - gapBottomMin) ty = slot.bottom - gapBottomMin - th;
    var tx = cx - tw / 2;
    var lightBody = !!(bowl && bowl.lightBody);

    var tagFill = drawWoodPlaque(ctx, t, tx, ty, tw, th, scale, lightBody);

    // 金额：牌内只放数值（CREDITS 不带 ¥/$；单位见名称带）；按对比度补齐可读性
    var val = labelAmountText(view);
    var amountPx = numOr(plaque.amountPx, Math.max(9, 9 * scale));
    var amountFloor = Math.max(9, amountPx * 0.70);
    var valAreaW = Math.max(4, tw - 6 * scale);
    var valMaxW = valAreaW - 2 * scale;
    var fitV = fitShrink(ctx, val, amountPx, valMaxW, amountFloor, 'bold', 0.5);
    // 极端金额（如 ¥987654.32）在 Win 的 9px 下限下会溢出木牌：再缩到 6px 保「不溢出」，仍溢出才裁在牌内
    if (fitV.w > valMaxW + 0.5) fitV = fitShrink(ctx, val, fitV.px, valMaxW, 6, 'bold', 0.25);
    var valClip = fitV.w > valMaxW + 0.5;
    var ink;
    if (view.low) ink = t.lowColor;
    else if (view.rice) ink = t.dotRice;
    else if (!view.hasResult || !view.ok) ink = t.failColor;
    else ink = t.amountColor;
    ink = ensureContrast(ink, tagFill, 4.5);
    if (valClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx + scale, ty + 0.5, Math.max(1, tw - 2 * scale), th - 1);
      ctx.clip();
    }
    drawText(ctx, val, { x: cx, cy: ty + th * 0.5, align: 'center', px: fitV.px, weight: 'bold', color: css(ink) });
    if (valClip) ctx.restore();
    recordText({ style: 'L3', slot: slot.index, amount: val, amountPx: +fitV.px.toFixed(2), amountBasePx: amountPx, amountClip: valClip });

    // 家名：刻在木牌下方碗身上（暗 + 亮 + 本色三遍偏移刻痕）
    var name = labelName(view);
    if (name) {
      var namePx = numOr(plaque.namePx, Math.max(8, 8 * scale));
      var off = Math.max(0.6, 0.7 * scale);
      var nameMaxW = numOr(plaque.nameMaxWidth, 0);
      if (!(nameMaxW > 0)) nameMaxW = minNum(slot.bowlW * 0.92, slot.bowlW - 6 * scale - off - 2);
      if (nameMaxW < 8) nameMaxW = 8;
      var floorPx = Math.max(6, 7 * scale);
      var fit = fitName(ctx, name, namePx, nameMaxW, floorPx, 'normal');
      var nh = numOr(plaque.nameH, namePx * 1.10);
      var ny = numOr(plaque.nameY, ty - nh);
      if (ny + nh > ty - 0.5 * scale) ny = Math.max(slot.rimY + 0.5 * scale, ty - 0.5 * scale - nh);
      var maxNy = slot.bottom - 0.5 * scale - nh;
      if (ny > maxNy) ny = maxNy;
      // P0-I：单遍实色 + 1px 反色描边（替代旧版暗/亮/本色三遍 ±0.7pt 偏移刻痕，小尺寸更清楚）
      var engrave = lightBody
        ? mix({ r: 96, g: 84, b: 64, a: 255 }, t.ink, 0.10)
        : mix({ r: 236, g: 240, b: 246, a: 255 }, t.amountColor, 0.10);
      var nameHalo = lightBody ? 'rgba(255,252,244,0.85)' : 'rgba(10,12,16,0.85)';
      var nameCy = ny + nh / 2;
      drawText(ctx, fit.text, { x: cx, cy: nameCy, align: 'center', px: fit.px, weight: 'normal', color: css(engrave), halo: nameHalo, haloWidth: Math.max(1, 0.20 * fit.px) });
      recordText({
        style: 'L3', slot: slot.index, name: fit.text, namePx: +fit.px.toFixed(2),
        nameBasePx: namePx, nameMaxW: +nameMaxW.toFixed(2), nameShrunk: !!fit.shrunk,
        nameEllipsized: !!fit.ellipsized
      });
    }

    // Mac 视觉微调：状态灯直径缩小约 25%；灯心正好位于名称下缘与木牌上缘中点。
    var dotD = 3 * scale;
    var dcy = numOr(plaque.dotCenterY, ty - dotD - 1.5 * scale);
    var lc = labelColors(view, lightBody, t);
    drawStatusDot(ctx, cx, dcy, dotD, lc.dot, scale);
  }

  /** L1 盆沿小字：复用 L3 三条带，无底板，文字带阴影。 */
  function drawLabelL1(ctx, t, slot, view, bowl, scale) {
    var plaque = slot.plaque || {};
    var cx = slot.x + slot.bowlW / 2;
    var lightBody = !!(bowl && bowl.lightBody);
    var lc = labelColors(view, lightBody, t);
    var valPx = Math.max(9, 9 * scale);
    var namePx = numOr(plaque.namePx, Math.max(8, 8 * scale));
    var rimY = numOr(slot.rimY, 0);
    var bottom = slot.bottom;

    // 名称带
    var name = labelName(view);
    if (name) {
      var off = Math.max(0.6, 0.7 * scale);
      var nameMaxW = numOr(plaque.nameMaxWidth, 0);
      if (!(nameMaxW > 0)) nameMaxW = minNum(slot.bowlW * 0.92, slot.bowlW - 6 * scale - off - 2);
      if (nameMaxW < 8) nameMaxW = 8;
      var fit = fitName(ctx, name, namePx, nameMaxW, Math.max(6, 7 * scale), 'normal');
      var nh = numOr(plaque.nameH, namePx * 1.10);
      var ny = numOr(plaque.nameY, rimY + 0.5 * scale);
      var nameCy = ny + nh / 2;
      // P0-I：单遍实色 + 1px 反色描边（L1 无底板，旧双偏移阴影在小尺寸下发虚）
      var l1Halo = lightBody ? 'rgba(255,252,244,0.85)' : 'rgba(10,12,16,0.85)';
      drawText(ctx, fit.text, { x: cx, cy: nameCy, align: 'center', px: fit.px, weight: 'normal', color: css(lc.nameCol), halo: l1Halo, haloWidth: Math.max(1, 0.20 * fit.px) });
    }

    // Mac 视觉微调：状态灯直径缩小约 25%，灯心落在文字与数值带之间的中心。
    var dotD = 3 * scale;
    var dcy = numOr(plaque.dotCenterY, numOr(plaque.valueCenterY, bottom) - dotD);
    drawStatusDot(ctx, cx, dcy, dotD, lc.dot, scale);

    // 数值：居中在 valueCenterY（= L3 木牌带中心），缩字保证完整显示
    var val = labelAmountText(view);
    var areaW = Math.max(8, slot.bowlW - 4 * scale);
    var fitV = fitShrink(ctx, val, valPx, areaW, Math.max(7, valPx * 0.75), 'bold', 0.25);
    if (fitV.w > areaW + 0.5) fitV = fitShrink(ctx, val, fitV.px, areaW, 6, 'bold', 0.25);
    var valClip = fitV.w > areaW + 0.5;
    var vh = numOr(plaque.plaqueH, 0) > 0 ? Math.max(plaque.plaqueH, valPx * 1.05) : valPx * 1.15;
    var vcy = numOr(plaque.valueCenterY, numOr(plaque.plaqueTop, rimY + (bottom - rimY) * 0.62) + vh / 2);
    var vy = clamp(vcy - vh / 2, rimY, bottom - vh);
    var vOff = Math.max(0.6, 0.7 * scale);
    if (valClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x, rimY, slot.bowlW, Math.max(1, bottom - rimY));
      ctx.clip();
    }
    drawText(ctx, val, { x: cx + vOff, cy: vy + vh / 2 + vOff, align: 'center', px: fitV.px, weight: 'bold', color: css(lc.shadowCol) });
    drawText(ctx, val, { x: cx, cy: vy + vh / 2, align: 'center', px: fitV.px, weight: 'bold', color: css(lc.valCol) });
    if (valClip) ctx.restore();
    recordText({ style: 'L1', slot: slot.index, name: fit.text, namePx: +fit.px.toFixed(2), amount: val, amountPx: +fitV.px.toFixed(2) });
  }

  /** L2 饭票小旗：贴在饭桶前脸中心，轻微倾斜约15度。 */
  function drawLabelL2(ctx, t, slot, view, bowl, scale) {
    var cx = slot.x + slot.bowlW / 2;
    var lightBody = !!(bowl && bowl.lightBody);
    var lc = labelColors(view, lightBody, t);
    var plaque = slot.plaque || {};
    var name = labelName(view);
    var val = labelAmountText(view);

    var baseNamePx = Math.max(8, 8 * scale);
    var baseValPx = Math.max(9, 9 * scale);
    var padX = 3.2 * scale;
    // Mac 视觉微调：旗面与灯的既有位置不变，只缩小约 25%。
    var dotD = 3 * scale;
    if (dotD < 2.4) dotD = 2.4;
    var flagH = Math.max(17, (baseNamePx + baseValPx) + 4);
    var flagAngle = -15 * Math.PI / 180; // Canvas 负角度：旗面右侧略上扬
    var sinAngle = Math.abs(Math.sin(flagAngle));
    var cosAngle = Math.abs(Math.cos(flagAngle));
    var availableW = Math.max(8, (slot.bowlW - flagH * sinAngle - 2 * scale) / cosAngle);
    var minW = Math.min(Math.max(slot.bowlW * 0.62, baseValPx * 4.2), availableW);
    var maxW = availableW;
    var nameW0 = measureText(ctx, name, baseNamePx, 'normal');
    var valW0 = measureText(ctx, val, baseValPx, 'bold');
    var dotReserve = dotD + 1.5 * scale;
    var needW = Math.max(nameW0 + dotReserve, valW0) + 2 * padX + 1.5 * scale;
    var flagW = Math.min(maxW, Math.max(minW, needW));
    var innerW = Math.max(8, flagW - 2 * padX);
    var textW = innerW;
    var nameAreaW = Math.max(8, innerW - dotReserve);
    var nameFit = fitShrink(ctx, name, baseNamePx, nameAreaW, Math.max(7, baseNamePx * 0.80), 'normal', 0.25);
    var valFit = fitShrink(ctx, val, baseValPx, textW, Math.max(7, baseValPx * 0.75), 'bold', 0.25);
    var nameDraw = nameFit.w > nameAreaW + 0.5 ? ellipsizeEnd(ctx, name, nameFit.px, 'normal', nameAreaW) : name;
    var valDraw = valFit.w > textW + 0.5 ? ellipsizeEnd(ctx, val, valFit.px, 'bold', textW) : val;

    var rimBottom = numOr(slot.rimBottom, numOr(slot.rimY, 0));
    var bottom = numOr(slot.bottom, rimBottom + slot.bowlH);
    var flagTopExtent = flagW * sinAngle / 2 + flagH * cosAngle / 2;
    var flagBottomExtent = flagTopExtent + 5 * scale * cosAngle;
    var minCenterY = rimBottom + flagTopExtent + 0.5 * scale;
    var maxCenterY = bottom - flagBottomExtent - 0.5 * scale;
    var flagCenterY = (rimBottom + bottom) / 2;
    if (minCenterY <= maxCenterY) flagCenterY = clamp(flagCenterY, minCenterY, maxCenterY);

    ctx.save();
    ctx.translate(cx, flagCenterY);
    ctx.rotate(flagAngle);

    // 旗杆从旗底向下贴在桶身上；与旗面同向旋转。
    ctx.strokeStyle = 'rgba(150,138,118,0.9608)'; // 245/255
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(0, flagH / 2 - 1);
    ctx.lineTo(0, flagH / 2 + 5 * scale);
    ctx.stroke();

    var flagCorner = Math.max(1.5, scale * 1.2);
    var flagX = -flagW / 2 + 0.5;
    var flagY = -flagH / 2;
    fillRoundRect(ctx, flagX, flagY, flagW, flagH, flagCorner, 'rgba(250,247,239,0.9804)');
    strokeRoundRect(ctx, flagX, flagY, flagW, flagH, flagCorner, 'rgba(182,172,154,0.9608)', Math.max(1, 0.8 * scale));

    // 名称、金额、状态点均在旗面的旋转坐标系中。
    var nameRectX = flagX + padX;
    var nameRectY = flagY + flagH * 0.02;
    var nameRectW = nameAreaW;
    var nameCy = nameRectY + flagH * 0.46 / 2;
    drawText(ctx, nameDraw, { x: nameRectX + nameRectW / 2, cy: nameCy, align: 'center', px: nameFit.px, weight: 'normal', color: 'rgba(118,108,90,1)' });
    var valRectX = flagX + padX;
    var valRectY = flagY + flagH * 0.46;
    var valCy = valRectY + flagH * 0.52 / 2;
    drawText(ctx, valDraw, {
      x: valRectX + textW / 2, cy: valCy, align: 'center', px: valFit.px, weight: 'bold',
      color: lightBody ? 'rgba(56,50,40,1)' : 'rgba(60,54,44,1)'
    });
    var dDotD = dotD;
    var dCx = flagW / 2 - 1.5 * scale - dDotD / 2;
    var dCy = flagY + 1.2 * scale + dDotD / 2;
    drawStatusDot(ctx, dCx, dCy, dDotD, lc.dot, scale);
    ctx.restore();

    recordText({
      style: 'L2', slot: slot.index, name: nameDraw, namePx: +nameFit.px.toFixed(2),
      amount: valDraw, amountPx: +valFit.px.toFixed(2),
      flagW: +flagW.toFixed(2), flagH: +flagH.toFixed(2),
      flagCenterY: +flagCenterY.toFixed(2), flagAngleDeg: -15,
      nameEllipsized: nameDraw !== name, valEllipsized: valDraw !== val
    });
  }

  function drawLabel(ctx, t, lay, slot, view, bowl) {
    var scale = layoutScale(lay);
    var labelStyle = String((lay && lay.labelStyle) || '').toUpperCase();
    if (!labelStyle) labelStyle = 'L3';
    if (labelStyle === 'L2') drawLabelL2(ctx, t, slot, view, bowl, scale);
    else if (labelStyle === 'L1') drawLabelL1(ctx, t, slot, view, bowl, scale);
    else drawLabelL3(ctx, t, slot, view, bowl, scale);
  }

  // =========================================================================
  // 8. 饭桶组总绘制（Win BowlRenderer.Render / DrawSlot）
  // =========================================================================
  function orderedSlots(lay) {
    var slots = (lay && lay.slots) ? lay.slots.slice() : [];
    slots.sort(function (a, b) {
      var ra = numOr(a.row, 0), rb = numOr(b.row, 0);
      if (ra !== rb) return ra - rb;
      return numOr(a.x, 0) - numOr(b.x, 0);
    });
    return slots;
  }

  function drawBowlsGroup(ctx, state, dpr) {
    var lay = state.layout || {};
    var slots = orderedSlots(lay);
    if (!slots.length) return;
    var t = currentTokens || buildTokens(state.style);
    var views = state.views || [];
    var bowl = pickBowl(state);
    var wheelH = numOr(lay.wheelH, 0);
    var angleDeg = numOr(lay.wheelAngle, numOr(state.wheelAngle, 0));
    var grain = bowl ? bowl.lightBody : false;
    var bgScale = layoutScale(lay); // P0：桶身/米饭渲染用的缩放基准（与数值层同口径）

    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var view = views[numOr(slot.index, i)] || null;
      var x = numOr(slot.x, 0), top = numOr(slot.top, 0);
      var bw = numOr(slot.bowlW, 62), bh = numOr(slot.bowlH, 56);
      var bottom = numOr(slot.bottom, top + bh);

      // 轮子（盆底）：静态首帧角度 = 0（Win DrawSlot 同款）
      if (wheelH > 0) {
        var wr = wheelH * 0.46;
        var wy = bottom + wheelH * 0.60;
        drawWheel(ctx, x + bw * 0.27, wy, wr, angleDeg);
        drawWheel(ctx, x + bw * 0.73, wy, wr, angleDeg);
      }

      // P0-C：桶底淡落影（浅主题更实、深主题更淡）
      drawBowlGroundShadow(ctx, slot, bgScale, t);
      // 后层（内壁）：P0-D 浅主题压暗 + 内沿描边 + 接缝暗弧
      if (bowl && bowl.backImg) drawBowlBack(ctx, bowl.backImg, x, top, bw, bh, bgScale, t);
      // 米饭：P0-F 接触阴影 / 满盆收窄露内壁 / 内壁暗边
      drawRice(ctx, state, bowl, slot, view, dpr, bgScale);
      // 前层（壳 + 前沿）：P0-C 主题感知 1px 描边；P0-K 深主题深色桶身提亮
      if (bowl && bowl.frontImg) {
        var darkBowl = !bowl.lightBody;
        drawBowlFront(ctx, bowl.frontImg, x, top, bw, bh, bgScale, t, dpr, {
          darkBowl: darkBowl,
          brighten: (!t.light && darkBowl) ? 1.08 : 1
        });
      }
      // 数值
      if (view) drawLabel(ctx, t, lay, slot, view, bowl || { lightBody: grain });
    }
  }

  // =========================================================================
  // 9. 明细卡（Win DetailRenderer.Render）
  // =========================================================================
  function drawDetail(ctx, state, dpr) {
    var t = currentTokens || buildTokens(state.style);
    var detail = state.detail || {};
    var lay = state.layout || {};
    var scale = numOr(lay.dpiScale, 1);
    if (!(scale > 0)) scale = 1;
    var w = numOr(state.canvas && state.canvas.w, numOr(detail.w, 260));
    var h = numOr(state.canvas && state.canvas.h, numOr(detail.h, 178));
    var rows = detail.rows || [];
    if (!rows.length && state.views && state.views.length) {
      rows = state.views.map(function (v) {
        return {
          name: v.name, amountText: valueText(v), low: !!v.low,
          ok: !!v.ok && !!v.hasResult, rice: !!v.rice, sub: ''
        };
      });
    }
    // 主进程 buildDetail 的 amountText 只认 ¥/$；CREDITS 行在渲染层按 currency 复算（CNY/USD 原样不动）
    if (rows.length && state.views && state.views.length) {
      rows = rows.map(function (row, i) {
        var v = state.views[i];
        if (!v || (row.name && v.name !== row.name)) return row;
        if (String(v.currency || 'CNY').toUpperCase() !== 'CREDITS') return row;
        var copy = {};
        for (var k in row) copy[k] = row[k];
        copy.amountText = valueText(v);
        return copy;
      });
    }
    var title = detail.title != null ? String(detail.title) : '余额明细 · 点击面板收起';
    var footer = detail.footer != null ? String(detail.footer) : '窗口置顶 · 点击面板收起';

    var rad = Math.max(1, Math.round(10 * scale));
    // 卡面
    fillRoundRect(ctx, 0.5, 0.5, w - 1, h - 1, rad, css(t.cardFill));
    strokeRoundRect(ctx, 0.5, 0.5, w - 1, h - 1, rad, css(t.cardBorder), Math.max(1, scale));

    var pad = Math.max(1, Math.round(12 * scale));
    var headPx = 11 * scale;
    var rowPx = 10.5 * scale;
    var subPx = 8.5 * scale;
    var amountPx = 11 * scale;
    var rowH = Math.max(1, Math.round(30 * scale));

    // 标题
    drawText(ctx, title, { x: pad, top: pad * 0.8, align: 'left', px: headPx, weight: 'bold', color: css(t.amountColor) });

    var y = Math.max(1, Math.round(34 * scale));
    var dotSize = Math.max(5, 6 * scale);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var okState = !(row.hasResult === false) && row.ok !== false;
      var dot;
      if (row.rice) dot = t.dotRice;
      else if (!okState) dot = t.dotGrey;
      else if (row.low) dot = t.dotRed;
      else dot = t.dotGreen;
      ctx.save();
      ctx.fillStyle = css(dot);
      // Win DetailRenderer：FillEllipse(pad, y+rowH*0.34, size, size) → 圆心 = 顶边 + size/2
      ctx.beginPath();
      ctx.arc(pad + dotSize / 2, y + rowH * 0.34 + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawText(ctx, row.name || '', { x: pad + Math.round(14 * scale), top: y + rowH * 0.06, align: 'left', px: rowPx, weight: 'normal', color: css(t.amountColor) });

      var amountColor;
      if (row.rice) amountColor = t.dotRice;
      else if (!okState) amountColor = t.failColor;
      else if (row.low) amountColor = t.lowColor;
      else amountColor = t.amountColor;
      var amountText = row.amountText != null ? String(row.amountText) : '';
      drawText(ctx, amountText, {
        x: w - pad, top: y + rowH * 0.04, align: 'right', px: amountPx, weight: 'bold',
        color: css(amountColor)
      });

      var sub = row.sub != null ? String(row.sub) : '';
      if (sub) {
        // #4：失败行副标题可能较长（含分类中文原因）→ 按卡宽省略尾部，保证不溢出卡面
        var subMaxW = Math.max(20, w - pad * 2 - Math.round(14 * scale));
        drawText(ctx, ellipsizeEnd(ctx, sub, subPx, 'normal', subMaxW), {
          x: pad + Math.round(14 * scale), top: y + rowH * 0.56, align: 'left',
          px: subPx, weight: 'normal', color: css(t.hintColor)
        });
      }
      if (i + 1 < rows.length) {
        ctx.save();
        ctx.strokeStyle = css(t.cardDivider);
        ctx.lineWidth = Math.max(0.5, scale * 0.7);
        ctx.beginPath();
        ctx.moveTo(pad, y + rowH - 1);
        ctx.lineTo(w - pad, y + rowH - 1);
        ctx.stroke();
        ctx.restore();
      }
      y += rowH;
    }

    drawText(ctx, footer, {
      x: pad, top: h - Math.max(1, Math.round(20 * scale)), align: 'left',
      px: subPx, weight: 'normal', color: css(t.hintColor)
    });
  }

  // =========================================================================
  // 第 27 轮 · 第三种形态：minicard（macOS 毛玻璃小面板）
  //   老板：「增加一种显示方式，用一个小面板显示，信息集成高，适合 mac 端小屏幕使用，
  //          ui 风格就用 macos 目前这个版本的」。
  //   已确认口径：竖排小卡片（一行一家，左家名右金额、固定宽度）+ 家名/金额/状态点
  //              + macOS 毛玻璃卡片（圆角+半透明+细描边）+ 跟着桌宠（几何由 layout.js 给）。
  //   ⚠️ 与 vibrancy 的关系：若窗口开了原生 vibrancy（需改 main.js，当前未开），token.mc.fill
  //      会自动降到极淡色调（见 style.js MINICARD_NATIVE_VIBRANCY），此函数无需改动。
  // =========================================================================

  /** minicard 的 token：优先用主进程给的 style.mc（style.js 产出），缺失时按主题兜底。 */
  function minicardTokens(state) {
    var raw = state && state.style;
    if (raw && raw.mc && typeof raw.mc === 'object') return raw.mc;
    var light = !!(raw && (raw.light === true || String(raw.theme || '').toLowerCase() === 'light'));
    // 兜底与 style.js buildMinicardStyle 同值（两边必须一致，改一处要同步）
    return light
      ? {
          light: true, dotOk: 'rgba(40,205,65,1)', dotWarn: 'rgba(255,149,0,1)', dotFail: 'rgba(255,59,48,1)',
          dotIdle: 'rgba(142,142,147,1)', border: 'rgba(0,0,0,0.09)', innerTop: 'rgba(255,255,255,0.62)',
          divider: 'rgba(0,0,0,0.06)', shadow: 'rgba(0,0,0,0.14)', name: 'rgba(0,0,0,0.86)',
          amount: 'rgba(0,0,0,0.94)', amountLow: 'rgba(255,149,0,1)', amountFail: 'rgba(0,0,0,0.42)',
          amountRice: 'rgba(146,100,20,0.95)', fill: 'rgba(255,255,255,0.55)', fillTop: 'rgba(255,255,255,0.72)',
        }
      : {
          light: false, dotOk: 'rgba(48,209,88,1)', dotWarn: 'rgba(255,159,10,1)', dotFail: 'rgba(255,69,58,1)',
          dotIdle: 'rgba(152,152,157,1)', border: 'rgba(255,255,255,0.14)', innerTop: 'rgba(255,255,255,0.16)',
          divider: 'rgba(255,255,255,0.07)', shadow: 'rgba(0,0,0,0.38)', name: 'rgba(255,255,255,0.92)',
          amount: 'rgba(255,255,255,0.98)', amountLow: 'rgba(255,159,10,1)', amountFail: 'rgba(255,255,255,0.45)',
          amountRice: 'rgba(255,214,140,0.96)', fill: 'rgba(28,28,32,0.55)', fillTop: 'rgba(255,255,255,0.12)',
        };
  }

  /** 一行的状态 → 点色与金额色。优先级：饭(米色) > 失败/无结果(灰) > 低余额(橙) > 成功(绿)。 */
  function minicardRowColors(view, mc) {
    if (!view) return { dot: mc.dotIdle, amount: mc.amountFail };
    if (view.rice) return { dot: mc.dotOk, amount: mc.amountRice, rice: true };
    var okState = !!view.hasResult && !!view.ok;
    if (!okState) return { dot: mc.dotFail, amount: mc.amountFail };
    if (view.low) return { dot: mc.dotWarn, amount: mc.amountLow };
    return { dot: mc.dotOk, amount: mc.amount };
  }

  /**
   * 画小面板：一张圆角毛玻璃卡片 + n 行 (状态点 家名 ... 金额)。
   * 几何全部读 lay.mc（layout.js 算好的），这里只负责画，不自己算尺寸 —— 保证
   * layout 的单测能覆盖几何、渲染层不会偷偷改口径。
   */
  function drawMinicard(ctx, state, dpr) {
    var lay = state.layout || {};
    var mc = lay.mc;
    var mct = minicardTokens(state);
    var views = state.views || [];
    if (!mc || !(mc.cardW > 0) || !(mc.cardH > 0)) return;

    var scale = numOr(lay.dpiScale, 1) || 1;
    var W = mc.cardW, H = mc.cardH;
    var rad = Math.max(2, numOr(mc.radius, 14));

    // ---- 卡面：半透明底 + 顶部内高光 + 1px 细描边（macOS 毛玻璃三件套）----
    // 阴影用 canvas shadowBlur 画在卡外，模拟 macOS 的柔和落影（窗口本身 hasShadow:false）
    ctx.save();
    ctx.shadowColor = mct.shadow;
    ctx.shadowBlur = Math.max(4, 12 * scale);
    ctx.shadowOffsetY = Math.max(1, 2 * scale);
    fillRoundRect(ctx, 1, 1, W - 2, H - 2, rad, mct.fill);
    ctx.restore();

    // 顶部高光：一条从顶部渐隐的白，制造玻璃受光面
    ctx.save();
    roundRectPath(ctx, 1, 1, W - 2, H - 2, rad);
    ctx.clip();
    var gloss = ctx.createLinearGradient(0, 0, 0, Math.max(2, H * 0.55));
    gloss.addColorStop(0, mct.fillTop);
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, W, Math.max(2, H * 0.55));
    ctx.restore();

    // 细描边（半像素对齐，1px 视觉宽度）
    strokeRoundRect(ctx, 0.5, 0.5, W - 1, H - 1, rad, mct.border, Math.max(1, scale));

    // ---- 行 ----
    var rows = mc.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var view = views[numOr(row.index, i)] || null;
      var col = minicardRowColors(view, mct);
      var rowCy = numOr(row.cy, 0);

      // 状态点：macOS 系统色实心圆 + 极淡描边（不加饭桶那套高光/灯座，小面板要干净）
      var dotD = numOr(mc.dotD, 8);
      var dcx = numOr(row.dotCx, 20);
      ctx.save();
      ctx.beginPath();
      ctx.arc(dcx, rowCy, Math.max(1, dotD / 2), 0, Math.PI * 2);
      ctx.fillStyle = col.dot;
      ctx.fill();
      if (scale >= 1.5) {
        ctx.strokeStyle = mct.light ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.28)';
        ctx.lineWidth = Math.max(0.5, 0.6 * scale);
        ctx.stroke();
      }
      ctx.restore();

      // 家名（左对齐，放不下先缩字号再中间省略 —— 复用饭桶同一套 fitName，口径一致）
      var name = (view && view.name != null) ? String(view.name) : String(row.name || '');
      var namePx = numOr(mc.namePx, 13);
      var nameMaxW = numOr(mc.nameMaxW, 80);
      var nameFit = fitName(ctx, name, namePx, nameMaxW, Math.max(7, namePx * 0.85), 'normal');
      var textX = numOr(row.textX, 31);
      drawText(ctx, nameFit.text || name, {
        x: textX, cy: rowCy, align: 'left',
        px: nameFit.px || namePx, weight: 'normal', color: mct.name,
      });
      var nameW = measureText(ctx, nameFit.text || name, nameFit.px || namePx, 'normal');
      recordText({
        part: 'mc-name', text: nameFit.text || name, px: nameFit.px || namePx,
        left: textX, right: textX + nameW, cy: rowCy, row: i,
        ellipsized: !!nameFit.ellipsized,
      });

      // 金额（右对齐；CREDITS 走 'C ' 前缀，与饭桶 labelAmountText 同一口径）
      var amount = labelAmountText(view);
      var amountPx = numOr(mc.amountPx, 13);
      var amountMaxW = numOr(mc.amountMaxW, 80);
      var amountRight = numOr(row.amountRight, W - 16);
      var amountFit = fitShrink(ctx, amount, amountPx, amountMaxW, Math.max(7, amountPx * 0.85), 'bold');
      var amountShown = amount; // fitShrink 只回字号+宽度，文本原样按缩小后的字号画
      // fitShrink 只缩字号不省略；极端长金额仍放不下时按尾部省略兜底（永不溢出卡面）
      if (amountFit.ellipsized) {
        var e = ellipsizeEnd(ctx, amount, amountFit.px, 'bold', amountMaxW);
        amountShown = e;
      }
      drawText(ctx, amountShown, {
        x: amountRight, cy: rowCy, align: 'right',
        px: amountFit.px || amountPx, weight: 'bold', color: col.amount,
      });
      var amountW = measureText(ctx, amountShown, amountFit.px || amountPx, 'bold');
      recordText({
        part: 'mc-amount', text: amountShown, px: amountFit.px || amountPx,
        left: amountRight - amountW, right: amountRight, cy: rowCy, row: i,
        shrunk: !!amountFit.shrunk, cardRight: W, padX: numOr(mc.padX, 16),
      });

      // 行分隔线（最后一行不画，与 macOS 列表口径一致）
      if (i + 1 < rows.length) {
        ctx.save();
        ctx.strokeStyle = mct.divider;
        ctx.lineWidth = Math.max(0.5, 0.6 * scale);
        ctx.beginPath();
        var divY = Math.round(numOr(row.top, 0) + numOr(mc.rowH, 30)) - 0.5;
        ctx.moveTo(numOr(mc.padX, 16), divY);
        ctx.lineTo(W - numOr(mc.padX, 16), divY);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // =========================================================================
  // 10. render（全量重画）+ hitTest（alpha 掩码）
  // =========================================================================
  function getDpr(state) {
    var d = numOr(state && state.canvas && state.canvas.dpr, 0);
    if (d > 0) return d;
    return (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  }

  function ensureCanvas(w, h, dpr) {
    if (!canvasEl) canvasEl = document.getElementById('pbp');
    if (!canvasEl) {
      canvasEl = document.createElement('canvas');
      canvasEl.id = 'pbp';
      document.body.appendChild(canvasEl);
    }
    var pw = Math.max(1, Math.round(w * dpr));
    var ph = Math.max(1, Math.round(h * dpr));
    if (canvasEl.width !== pw) canvasEl.width = pw;
    if (canvasEl.height !== ph) canvasEl.height = ph;
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
    if (!ctx2d || ctx2d.__owner !== canvasEl) {
      ctx2d = canvasEl.getContext('2d');
      ctx2d.__owner = canvasEl;
    }
    return ctx2d;
  }

  /**
   * 全量重画入口（契约 §4.10）。返回是否画成功。
   * @param {object} state 主进程状态 JSON（CONTRACT §3）
   */
  function render(state, opts) {
    if (!state || typeof state !== 'object') return false;
    currentState = state;
    textEnabled = !(opts && opts.text === false);
    lastTextInfo = [];
    if (!currentTokens) currentTokens = buildTokens(state.style);
    else if (state.style) currentTokens = buildTokens(state.style);
    if (state.assets) {
      // state.assets 可能只随资源变化发；有则合并
      if (state.assets !== assetsRaw) { assetsRaw = state.assets; setAssets(state.assets, state.assets.__assetDir); }
    }
    var dpr = getDpr(state);
    var canvasCfg = state.canvas || {};
    var mode = String(state.mode || 'bowls').toLowerCase();
    var detail = state.detail || {};
    var w = numOr(canvasCfg.w, mode === 'detail' ? numOr(detail.w, 260) : numOr(state.layout && state.layout.groupW, 130));
    var h = numOr(canvasCfg.h, mode === 'detail' ? numOr(detail.h, 178) : numOr(state.layout && state.layout.groupH, 64));
    if (!(w > 0)) w = 1;
    if (!(h > 0)) h = 1;
    var ctx = ensureCanvas(w, h, dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textBaseline = 'alphabetic';

    try {
      // 第 27 轮 · 第三种形态 minicard：style==='minicard' 走小面板，其余完全维持原路径
      // （ricebowl / capsule 回退 / detail 一个字节都不变）
      var minicardMode = !!(state.layout && String(state.layout.style || '').toLowerCase() === 'minicard')
        || String((state.cfg && state.cfg.display && state.cfg.display.style) || '').toLowerCase() === 'minicard';
      if (minicardMode && mode !== 'detail') drawMinicard(ctx, state, dpr);
      else if (mode === 'detail') drawDetail(ctx, state, dpr);
      else drawBowlsGroup(ctx, state, dpr);
    } catch (err) {
      bridgeLog('render error: ' + (err && err.message ? err.message : String(err)));
    }

    textEnabled = true;
    maskDirty = true;
    renderSeq = numOr(state.seq, renderSeq);
    bridgeCall('rendered', state.seq);
    return true;
  }

  /** 取 canvas alpha 掩码（懒加载 + 每次 render 失效）。 */
  function getMask() {
    if (!canvasEl || !ctx2d) return null;
    if (maskData && !maskDirty) return maskData;
    try {
      maskData = ctx2d.getImageData(0, 0, canvasEl.width, canvasEl.height);
      maskDirty = false;
      return maskData;
    } catch (e) {
      maskData = null;
      return null;
    }
  }

  /** 契约 §4.11：该点 alpha≥16 的布尔值。 */
  function hitTest(x, y) {
    if (!isNum(x) || !isNum(y)) return false;
    var mask = getMask();
    if (mask) {
      var dpr = getDpr(currentState);
      var px = Math.floor(x * dpr);
      var py = Math.floor(y * dpr);
      if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
      var idx = (py * mask.width + px) * 4 + 3;
      return mask.data[idx] >= 16;
    }
    return analyticHitTest(x, y);
  }

  /** getImageData 不可用（画布被污染）时的近似命中：盆槽矩形 + 轮带 + 木牌/旗面 + 明细卡。 */
  function analyticHitTest(x, y) {
    if (!currentState) return false;
    var s = currentState;
    if (String(s.mode || '') === 'detail') return true; // 卡面铺满窗口
    var slots = (s.layout && s.layout.slots) || [];
    var wheelH = numOr(s.layout && s.layout.wheelH, 0);
    for (var i = 0; i < slots.length; i++) {
      var sl = slots[i];
      var sx = numOr(sl.x, 0), sy = numOr(sl.top, 0);
      var bw = numOr(sl.bowlW, 62), bh = numOr(sl.bowlH, 56);
      if (x >= sx && x <= sx + bw && y >= sy && y <= sy + bh) return true;
      if (wheelH > 0) {
        var by = numOr(sl.bottom, sy + bh) + wheelH * 0.6;
        var wr = wheelH * 0.46;
        var cx1 = sx + bw * 0.27, cx2 = sx + bw * 0.73;
        if ((x - cx1) * (x - cx1) + (y - by) * (y - by) <= wr * wr) return true;
        if ((x - cx2) * (x - cx2) + (y - by) * (y - by) <= wr * wr) return true;
      }
      var pl = sl.plaque;
      if (pl) {
        var tw = numOr(pl.plaqueW, 0), th = numOr(pl.plaqueH, 0);
        if (tw > 0 && th > 0) {
          var tx = sx + bw / 2 - tw / 2;
          var ty = numOr(pl.plaqueTop, 0);
          if (x >= tx && x <= tx + tw && y >= ty && y <= ty + th) return true;
        }
      }
    }
    return false;
  }

  // =========================================================================
  // 11. 鼠标交互（契约 §4.12/§4.13）：点击上报 + 逐像素 hover
  // =========================================================================
  var downPoint = null;
  var lastHover = null;

  function canvasPoint(ev) {
    var rect = canvasEl ? canvasEl.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onMouseDown(ev) {
    if (ev.button !== 0) return;
    var p = canvasPoint(ev);
    downPoint = { x: p.x, y: p.y };
  }
  function onMouseUp(ev) {
    if (ev.button !== 0 || !downPoint) return;
    var p = canvasPoint(ev);
    var dx = p.x - downPoint.x, dy = p.y - downPoint.y;
    var same = (dx * dx + dy * dy) <= 4;   // 同一位置（±2pt）
    var hit = hitTest(p.x, p.y);
    if (same && hit) bridgeCall('click', p.x, p.y);
    downPoint = null;
  }
  function onMouseMove(ev) {
    var p = canvasPoint(ev);
    var inside = hitTest(p.x, p.y);
    if (inside !== lastHover) {
      lastHover = inside;
      bridgeCall('hover', inside);
    }
  }

  // =========================================================================
  // 12. 初始化 / 对外 API
  // =========================================================================
  function initBridge() {
    var b = bridge();
    if (!b) return;
    if (typeof b.onInit === 'function') {
      try {
        b.onInit(function (payload) {
          payload = payload || {};
          var assets = payload.assets || null;
          var dir = payload.assetDir || (assets && assets.__assetDir) || '';
          if (dir) assetDir = String(dir);
          if (assets) { assetsRaw = assets; setAssets(assets, assetDir); }
          else startPreload();
          // 资源预载完 → 通知主进程就绪（只发一次）
          var p = assetLoadPromise || startPreload();
          p.then(function () {
            bridgeLog('renderer ready assets=' + bowlOrder.length + ' riceMaster=' + !!(riceMaster && riceMaster.img));
            bridgeCall('ready');
          });
        });
      } catch (e) { }
    }
    if (typeof b.onState === 'function') {
      try { b.onState(function (state) { render(state); }); } catch (e) { }
    }
  }

  function bindMouse() {
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousemove', onMouseMove, true);
  }

  function boot() {
    try { canvasEl = document.getElementById('pbp'); } catch (e) { }
    if (canvasEl) {
      ctx2d = canvasEl.getContext('2d');
      ctx2d.__owner = canvasEl;
    }
    bindMouse();
    initBridge();
  }

  window.PBP = {
    version: VERSION,
    render: render,
    hitTest: hitTest,
    /** 测试/离线用：直接灌资源并返回预载 Promise。 */
    loadAssets: function (assets, dir) {
      assetsRaw = assets || null;
      if (dir) assetDir = String(dir);
      if (assets) setAssets(assets, assetDir);
      return assetLoadPromise || startPreload();
    },
    assetsReady: function () { return assetLoadPromise || Promise.resolve(true); },
    isAssetsLoaded: function () { return assetsLoaded; },
    debug: function () {
      var out = { version: VERSION, assetDir: assetDir, riceMaster: !!(riceMaster && riceMaster.img), bowls: {} };
      bowlOrder.forEach(function (id) {
        var b = bowls[id];
        out.bowls[id] = {
          lightBody: !!b.lightBody, front: !!b.frontImg, back: !!b.backImg,
          pixelW: b.pixelW, pixelH: b.pixelH
        };
      });
      out.seq = renderSeq;
      out.stateMode = currentState ? currentState.mode : null;
      out.texts = lastTextInfo.slice();
      out.canvas = currentState ? { w: currentState.canvas && currentState.canvas.w, h: currentState.canvas && currentState.canvas.h } : null;
      return out;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
