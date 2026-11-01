#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「饭桶余额」应用图标底图（1024×1024 PNG，无任何本机路径/用户名）。

设计：深色圆角底 + 白瓷饭桶（一盆白饭冒出盆沿）+ 盆身木牌上的 ¥ 与绿点（状态正常）。

用法：
  python3 make-icon.py --out <输出 PNG>            # 默认 icon-1024.png
  python3 make-icon.py --preview <目录>            # 额外输出 16/32/64/128/256 小图，便于人眼检查
依赖：Pillow（本机 ~/.dsh/dsh-runtimes 的 python3 里已有）。
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 4                     # 超采样倍数：1024 * 4 = 4096 画布，最后 LANCZOS 缩回 1024
BASE = 1024
W = BASE * SS

# ---- 配色（与显示窗暗色主题同族）----
BG_TOP = (33, 40, 53)
BG_BOTTOM = (12, 15, 21)
BOWL_LIGHT = (253, 253, 251)
BOWL_MID = (231, 236, 242)
BOWL_DARK = (183, 194, 208)
WHITE = (255, 255, 255)
RIM_SHADE = (198, 208, 220)
MOUTH = (158, 170, 186)
MOUTH_DARK = (128, 140, 158)
RICE = (250, 249, 240)
RICE_SHADE = (219, 216, 195)
RICE_LINE = (199, 196, 172)
WOOD_LIGHT = (140, 103, 64)
WOOD_DARK = (92, 65, 40)
WOOD_EDGE = (170, 131, 84)
CREAM = (248, 233, 203)
GREEN = (118, 202, 159)
GREEN_DARK = (66, 136, 100)
BLUE_DECOR = (116, 143, 174)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def vertical_gradient(size, top, bottom):
    """竖向线性渐变（先做 256 高的小图再放大，省时间且平滑）。"""
    small = Image.new("RGB", (1, 256))
    px = small.load()
    for y in range(256):
        px[0, y] = lerp(top, bottom, y / 255.0)
    return small.resize((size, size), Image.BILINEAR)


def bezier(p0, p1, p2, p3, n=160):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = (u ** 3) * p0[0] + 3 * (u ** 2) * t * p1[0] + 3 * u * (t ** 2) * p2[0] + (t ** 3) * p3[0]
        y = (u ** 3) * p0[1] + 3 * (u ** 2) * t * p1[1] + 3 * u * (t ** 2) * p2[1] + (t ** 3) * p3[1]
        out.append((x, y))
    return out


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def clip_alpha(layer, mask):
    """把图层 alpha 限制在 mask 范围内（避免阴影/高光溢出形体）。"""
    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (W, W), 0), mask))
    return layer


def draw_icon():
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # ---------- 1. 圆角底板 ----------
    radius = int(0.225 * W)
    plate = vertical_gradient(W, BG_TOP, BG_BOTTOM).convert("RGBA")
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([int(W * 0.20), int(W * 0.14), int(W * 0.80), int(W * 0.80)], fill=(192, 160, 112, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(int(W * 0.06)))
    plate = Image.alpha_composite(plate, glow)
    img.paste(plate, (0, 0), rounded_mask(W, radius))

    edge = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [3 * SS, 3 * SS, W - 3 * SS, W - 3 * SS],
        radius=radius - 3 * SS,
        outline=(255, 255, 255, 46),
        width=max(2, int(0.008 * W)),
    )
    img = Image.alpha_composite(img, edge)
    d = ImageDraw.Draw(img)

    # ---------- 2. 饭桶几何 ----------
    cx = W // 2
    rim_cy = int(0.452 * W)              # 盆沿椭圆中心 y
    rim_rx = int(0.248 * W)
    rim_ry = int(0.058 * W)
    mouth_rx = rim_rx - int(0.026 * W)   # 盆口内沿
    mouth_ry = rim_ry - int(0.012 * W)
    rim_left, rim_right = cx - rim_rx, cx + rim_rx
    foot_y = int(0.800 * W)
    foot_rx = int(0.118 * W)

    # ---------- 3. 落影 ----------
    shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [cx - int(0.30 * W), foot_y - int(0.030 * W), cx + int(0.30 * W), foot_y + int(0.078 * W)],
        fill=(0, 0, 0, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(0.026 * W)))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)

    # ---------- 4. 桶身轮廓（白瓷）----------
    body_pts = [(rim_left, rim_cy), (rim_right, rim_cy)]
    body_pts += bezier(
        (rim_right, rim_cy),
        (rim_right + int(0.010 * W), int(0.640 * W)),
        (cx + int(0.190 * W), foot_y - int(0.028 * W)),
        (cx + foot_rx, foot_y - int(0.006 * W)),
        n=90,
    )
    body_pts += bezier(
        (cx + foot_rx, foot_y - int(0.006 * W)),
        (cx + int(0.075 * W), foot_y + int(0.018 * W)),
        (cx - int(0.075 * W), foot_y + int(0.018 * W)),
        (cx - foot_rx, foot_y - int(0.006 * W)),
        n=60,
    )
    body_pts += bezier(
        (cx - foot_rx, foot_y - int(0.006 * W)),
        (cx - int(0.190 * W), foot_y - int(0.028 * W)),
        (rim_left - int(0.010 * W), int(0.640 * W)),
        (rim_left, rim_cy),
        n=90,
    )

    body_mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(body_mask).polygon(body_pts, fill=255)
    body_grad = vertical_gradient(W, BOWL_LIGHT, BOWL_MID).convert("RGBA")
    body_grad.putalpha(body_mask)
    img = Image.alpha_composite(img, body_grad)

    # 右侧压暗，左侧提亮（体积感）
    shade = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse(
        [cx + int(0.03 * W), rim_cy - int(0.02 * W), cx + int(0.44 * W), foot_y + int(0.09 * W)],
        fill=(118, 134, 158, 92),
    )
    shade = clip_alpha(shade.filter(ImageFilter.GaussianBlur(int(0.034 * W))), body_mask)
    img = Image.alpha_composite(img, shade)

    high = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(high).ellipse(
        [rim_left + int(0.050 * W), rim_cy + int(0.010 * W), rim_left + int(0.130 * W), foot_y - int(0.01 * W)],
        fill=(255, 255, 255, 116),
    )
    high = clip_alpha(high.filter(ImageFilter.GaussianBlur(int(0.028 * W))), body_mask)
    img = Image.alpha_composite(img, high)

    # 桶身下缘微暗
    low = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(low).ellipse(
        [cx - int(0.26 * W), foot_y - int(0.070 * W), cx + int(0.26 * W), foot_y + int(0.030 * W)],
        fill=(122, 134, 152, 52),
    )
    low = clip_alpha(low.filter(ImageFilter.GaussianBlur(int(0.028 * W))), body_mask)
    img = Image.alpha_composite(img, low)

    # 青花双细线（瓷器味道，低对比）
    d = ImageDraw.Draw(img)
    for t, wdt, alpha in ((0.600, 0.0055, 92), (0.618, 0.0035, 64)):
        y = int(t * W)
        half = int(0.198 * W)
        d.line([(cx - half, y), (cx + half, y)], fill=BLUE_DECOR + (alpha,), width=max(2, int(wdt * W)))

    # ---------- 5. 圈足（内收，不溢出桶身）----------
    foot = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    fd = ImageDraw.Draw(foot)
    fd.ellipse(
        [cx - foot_rx - int(0.012 * W), foot_y - int(0.030 * W), cx + foot_rx + int(0.012 * W), foot_y + int(0.026 * W)],
        fill=(206, 214, 225, 255),
    )
    fd.arc(
        [cx - foot_rx - int(0.012 * W), foot_y - int(0.030 * W), cx + foot_rx + int(0.012 * W), foot_y + int(0.026 * W)],
        start=20, end=160, fill=(158, 170, 187, 210), width=max(2, int(0.006 * W)),
    )
    foot = clip_alpha(foot.filter(ImageFilter.GaussianBlur(int(0.004 * W))), body_mask)
    img = Image.alpha_composite(img, foot)

    # ---------- 6. 盆内暗部 ----------
    d = ImageDraw.Draw(img)
    d.ellipse(
        [cx - mouth_rx, rim_cy - mouth_ry, cx + mouth_rx, rim_cy + mouth_ry],
        fill=MOUTH + (255,),
    )
    d.ellipse(
        [cx - int(0.90 * mouth_rx), rim_cy - int(0.90 * mouth_ry), cx + int(0.90 * mouth_rx), rim_cy + int(0.92 * mouth_ry)],
        fill=MOUTH_DARK + (255,),
    )

    # ---------- 7. 米山（平滑圆顶 + 轻微起伏的米粒山尖）----------
    rice_top = int(0.316 * W)
    rice_half = int(0.196 * W)
    rice_bottom = rim_cy + int(0.026 * W)     # 探进盆口，前面只留一条薄暗边

    def dome_y(x):
        dx = min(1.0, abs(x - cx) / float(rice_half))
        return int(rice_top + (rice_bottom - rice_top) * (dx ** 1.8))

    rice_pts = [(cx - rice_half, rice_bottom)]
    step = max(1, int(0.004 * W))
    for x in range(cx - rice_half, cx + rice_half + 1, step):
        rice_pts.append((x, dome_y(x)))
    rice_pts.append((cx + rice_half, rice_bottom))

    rice_mask = Image.new("L", (W, W), 0)
    rmd = ImageDraw.Draw(rice_mask)
    rmd.polygon(rice_pts, fill=255)
    # 山尖的小圆鼓（只鼓一点点，多了会像云）
    bumps = []
    for k in (-4, -3, -2, -1, 0, 1, 2, 3, 4):
        bx = cx + int(k * 0.041 * W)
        by = min(rice_bottom - int(0.010 * W), dome_y(bx) + int(0.017 * W))
        br = int(0.023 * W) if abs(k) < 3 else int(0.018 * W)
        bumps.append((bx, by, br))
    for bx, by, br in bumps:
        rmd.ellipse([bx - br, by - br, bx + br, by + br], fill=255)

    rice_layer = Image.new("RGBA", (W, W), RICE + (255,))
    rice_layer.putalpha(rice_mask)
    img = Image.alpha_composite(img, rice_layer)

    # 米堆体积：下缘偏暗、右侧偏暗；再用一圈柔和暗线压出米堆前缘
    rice_shade = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rsd = ImageDraw.Draw(rice_shade)
    rsd.ellipse(
        [cx - int(0.24 * W), rim_cy - int(0.075 * W), cx + int(0.12 * W), rim_cy + int(0.040 * W)],
        fill=RICE_SHADE + (150,),
    )
    rsd.ellipse(
        [cx + int(0.02 * W), rice_top - int(0.005 * W), cx + int(0.31 * W), rim_cy + int(0.01 * W)],
        fill=RICE_SHADE + (95,),
    )
    rice_shade = clip_alpha(rice_shade.filter(ImageFilter.GaussianBlur(int(0.024 * W))), rice_mask)
    img = Image.alpha_composite(img, rice_shade)

    # 米粒纹理（几道很淡的小弧；画完裁剪进米堆，绝不飘到米山外）
    grains = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grains)
    for off, bias in ((-0.150, 0.055), (-0.085, 0.040), (-0.015, 0.036), (0.060, 0.042), (0.130, 0.058)):
        gx = cx + int(off * W)
        gy = min(rim_cy - int(0.010 * W), dome_y(gx) + int(bias * W))
        gr = int(0.026 * W)
        gd.arc([gx - gr, gy - gr, gx + gr, gy + gr], start=205, end=335,
               fill=RICE_LINE + (190,), width=max(2, int(0.0040 * W)))
    grains = clip_alpha(grains, rice_mask)
    img = Image.alpha_composite(img, grains)

    # ---------- 8. 盆沿（盖住米堆下缘，让饭「在盆里」）----------
    d = ImageDraw.Draw(img)
    rim_w = max(3, int(0.0135 * W))
    d.ellipse(
        [cx - rim_rx, rim_cy - rim_ry, cx + rim_rx, rim_cy + rim_ry],
        outline=WHITE + (255,),
        width=rim_w,
    )
    d.arc(
        [cx - rim_rx, rim_cy - rim_ry, cx + rim_rx, rim_cy + rim_ry],
        start=18, end=162, fill=RIM_SHADE + (200,), width=max(2, int(0.0050 * W)),
    )
    d.arc(
        [cx - rim_rx + rim_w, rim_cy - rim_ry + rim_w, cx + rim_rx - rim_w, rim_cy + rim_ry - rim_w],
        start=186, end=298, fill=(255, 255, 255, 230), width=max(2, int(0.0060 * W)),
    )
    # 米堆前缘投在盆口里的薄影
    d.arc(
        [cx - mouth_rx, rim_cy - mouth_ry, cx + mouth_rx, rim_cy + mouth_ry],
        start=200, end=340, fill=(96, 108, 124, 120), width=max(2, int(0.0055 * W)),
    )

    # ---------- 9. 盆身木牌（¥ + 状态绿点）----------
    pl_w, pl_h = int(0.360 * W), int(0.118 * W)
    pl_x = cx - pl_w // 2
    pl_y = int(0.598 * W)
    pl_r = int(0.018 * W)

    # 木牌落在桶身上的软阴影
    pl_shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(pl_shadow).rounded_rectangle(
        [pl_x + int(0.006 * W), pl_y + int(0.012 * W), pl_x + pl_w + int(0.006 * W), pl_y + pl_h + int(0.012 * W)],
        radius=pl_r, fill=(0, 0, 0, 92),
    )
    pl_shadow = pl_shadow.filter(ImageFilter.GaussianBlur(int(0.010 * W)))
    img = Image.alpha_composite(img, pl_shadow)

    plaque = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    plank = vertical_gradient(W, WOOD_LIGHT, WOOD_DARK).convert("RGBA")
    plank_mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(plank_mask).rounded_rectangle(
        [pl_x, pl_y, pl_x + pl_w, pl_y + pl_h], radius=pl_r, fill=255
    )
    plank.putalpha(plank_mask)
    plaque = Image.alpha_composite(plaque, plank)
    pd = ImageDraw.Draw(plaque)
    for tt in (0.34, 0.66):
        yy = int(pl_y + pl_h * tt)
        pd.line([(pl_x + int(0.02 * W), yy), (pl_x + pl_w - int(0.02 * W), yy)],
                fill=(58, 38, 22, 95), width=max(1, int(0.0025 * W)))
    pd.rounded_rectangle(
        [pl_x, pl_y, pl_x + pl_w, pl_y + pl_h], radius=pl_r,
        outline=WOOD_EDGE + (215,), width=max(2, int(0.0045 * W)),
    )
    # 上沿一条高光
    pd.line([(pl_x + int(0.02 * W), pl_y + int(0.006 * W)), (pl_x + pl_w - int(0.02 * W), pl_y + int(0.006 * W))],
            fill=(214, 176, 128, 130), width=max(2, int(0.0030 * W)))
    img = Image.alpha_composite(img, plaque)

    # 绿点（状态正常）
    dot_r = int(0.021 * W)
    dot_x = pl_x + int(0.042 * W)
    dot_y = pl_y + pl_h // 2
    dd = ImageDraw.Draw(img)
    dd.ellipse(
        [dot_x - dot_r - int(0.004 * W), dot_y - dot_r - int(0.004 * W),
         dot_x + dot_r + int(0.004 * W), dot_y + dot_r + int(0.004 * W)],
        fill=(255, 255, 255, 70),
    )
    dd.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r], fill=GREEN + (255,))
    dd.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + int(dot_r * 0.15), dot_y + int(dot_r * 0.15)],
               fill=(224, 255, 240, 210))
    dd.arc([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
           start=20, end=160, fill=GREEN_DARK + (230,), width=max(2, int(0.005 * W)))

    # ¥ 字（Helvetica Bold；找不到字体时退回手绘）
    text = "¥"
    font = None
    for path, idx in (
        ("/System/Library/Fonts/Helvetica.ttc", 1),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
        ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
    ):
        try:
            font = ImageFont.truetype(path, int(0.076 * W), index=idx)
            break
        except Exception:
            continue
    if font is not None:
        bbox = dd.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = pl_x + (pl_w + int(0.038 * W)) // 2 - tw // 2 - bbox[0]
        ty = pl_y + (pl_h - th) // 2 - bbox[1]
        dd.text((tx + int(0.003 * W), ty + int(0.004 * W)), text, font=font, fill=(38, 24, 12, 190))
        dd.text((tx, ty), text, font=font, fill=CREAM + (255,))
    else:
        tx0 = cx + int(0.035 * W)
        ty0 = pl_y + int(0.026 * W)
        lw = max(2, int(0.007 * W))
        dd.line([(tx0 - int(0.028 * W), ty0), (tx0, ty0 + int(0.030 * W))], fill=CREAM + (255,), width=lw)
        dd.line([(tx0 + int(0.028 * W), ty0), (tx0, ty0 + int(0.030 * W))], fill=CREAM + (255,), width=lw)
        dd.line([(tx0, ty0 + int(0.020 * W)), (tx0, ty0 + int(0.068 * W))], fill=CREAM + (255,), width=lw)
        dd.line([(tx0 - int(0.022 * W), ty0 + int(0.038 * W)), (tx0 + int(0.022 * W), ty0 + int(0.038 * W))], fill=CREAM + (255,), width=lw)
        dd.line([(tx0 - int(0.022 * W), ty0 + int(0.052 * W)), (tx0 + int(0.022 * W), ty0 + int(0.052 * W))], fill=CREAM + (255,), width=lw)

    # ---------- 10. 缩回 1024 ----------
    return img.resize((BASE, BASE), Image.LANCZOS)


def draw_tray():
    """菜单栏模板图底稿（白瓷饭桶剪影）。

    macOS 模板图只认 alpha：RGB 会被系统忽略，深色菜单栏画白、浅色菜单栏自动画黑。
    所以这里用「纯白 + 透明」画剪影，主程序 setTemplateImage(true) 后系统自适应明暗。
    返回 16×16 与 32×32（@2x）两张。
    """
    S = 128 * SS
    k = S / 128.0
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)

    def E(*a):
        d.ellipse([v * k for v in a], fill=white)

    def P(seq):
        d.polygon([(x * k, y * k) for x, y in seq], fill=white)

    # 米饭山（矮一点、宽一点，避免小尺寸看成「人头」）
    E(30, 22, 98, 48)
    d.rectangle([30 * k, 34 * k, 98 * k, 48 * k], fill=white)
    # 盆沿（明显探出米山两侧）
    E(6, 38, 122, 62)
    # 盆身（上口贴盆沿，向下收）
    P([(15, 46), (113, 46), (98, 96), (90, 104), (38, 104), (30, 96)])
    # 圆底 + 小圈足
    E(36, 90, 92, 112)
    E(48, 104, 80, 116)

    return (
        img.resize((16, 16), Image.LANCZOS),
        img.resize((32, 32), Image.LANCZOS),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="icon-1024.png", help="输出 1024×1024 PNG 路径")
    ap.add_argument("--preview", default="", help="可选：额外输出 16/32/64/128/256 小图到该目录")
    ap.add_argument("--tray-out", default="", help="可选：输出菜单栏模板图 trayTemplate.png(16) + trayTemplate@2x.png(32) 到该目录")
    args = ap.parse_args()

    img = draw_icon()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    img.save(out, "PNG")
    print("saved", out, img.size)

    if args.tray_out:
        tdir = os.path.abspath(args.tray_out)
        os.makedirs(tdir, exist_ok=True)
        t16, t32 = draw_tray()
        p1 = os.path.join(tdir, "trayTemplate.png")
        p2 = os.path.join(tdir, "trayTemplate@2x.png")
        t16.save(p1, "PNG")
        t32.save(p2, "PNG")
        print("saved", p1, t16.size)
        print("saved", p2, t32.size)

    if args.preview:
        pdir = os.path.abspath(args.preview)
        os.makedirs(pdir, exist_ok=True)
        for s in (16, 32, 64, 128, 256):
            small = img.resize((s, s), Image.LANCZOS)
            p = os.path.join(pdir, "preview-%d.png" % s)
            small.save(p, "PNG")
            print("saved", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
