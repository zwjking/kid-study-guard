#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""知识图谱 App 图标生成器。

设计：圆角方形底 + 节点网络（1 个核心节点 + 5 个卫星节点 + 辐射连线），
寓意「知识点与其先修关系」。全部矢量绘制（渐变 + 抗锯齿 + 高斯柔光），
在 48px 的小图标上也能看清结构，不依赖任何在线素材。

两套配色：
  deep  —— 蓝紫渐变底 + 白色网络（默认写进 res，深色更抢眼）
  light —— 浅色玻璃底 + 蓝紫网络（轻奢浅色，适合浅色桌面）

用法：
  python make_icon.py            # 两套预览都出，deep 写进 res
  python make_icon.py light      # light 写进 res
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

S = 2048
HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.normpath(os.path.join(HERE, "..", "app", "src", "main", "res"))
PREVIEW = os.path.join(HERE, "preview")

THEMES = {
    "deep": {
        # 三色渐变：深海军蓝 → 电光紫 → 亮紫，比单色紫更有层次
        "bg": [(0x24, 0x2E, 0x8F), (0x5B, 0x4B, 0xE8), (0x8B, 0x5C, 0xF6)],
        "fg": (255, 255, 255),
        "glow": (255, 255, 255, 58),
        "line_alpha": 170,
        "line_fade": True,
        "shadow": None,
    },
    "light": {
        "bg": [(0xFF, 0xFF, 0xFF), (0xD9, 0xE2, 0xFA)],
        "fg": (0x55, 0x68, 0xF0),
        "glow": (0x6C, 0x7B, 0xFF, 26),
        "line_alpha": 110,
        "line_fade": False,
        "shadow": (0x2A, 0x35, 0x66, 46),
    },
}


def diagonal_gradient(size: int, stops) -> Image.Image:
    """左上到右下的对角渐变，支持 2 段以上色标。

    先在 512×512 上逐像素算（纯 Python，不用 numpy），再 BICUBIC 放大到目标尺寸。
    渐变是平滑函数，放大后不会出现色带。
    """
    small = 512
    buf = bytearray(small * small * 3)
    n = len(stops) - 1
    i = 0
    for y in range(small):
        ty = y / small * 0.55
        for x in range(small):
            t = ty + x / small * 0.45
            if t < 0.0:
                t = 0.0
            elif t > 1.0:
                t = 1.0
            pos = t * n
            seg = int(pos)
            if seg >= n:
                seg = n - 1
            k = pos - seg
            c1, c2 = stops[seg], stops[seg + 1]
            buf[i] = int(c1[0] + (c2[0] - c1[0]) * k)
            buf[i + 1] = int(c1[1] + (c2[1] - c1[1]) * k)
            buf[i + 2] = int(c1[2] + (c2[2] - c1[2]) * k)
            i += 3
    img = Image.frombytes("RGB", (small, small), bytes(buf))
    if size != small:
        img = img.resize((size, size), Image.BICUBIC)
    return img


def rounded_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    return m


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def node_layout(size: int):
    """返回核心点与卫星点坐标。大小交替，避免机械对称。"""
    cx, cy = size * 0.5, size * 0.52
    sats = [
        (-96, 0.285, 0.047),
        (-16, 0.300, 0.037),
        (58, 0.282, 0.044),
        (128, 0.298, 0.036),
        (198, 0.280, 0.042),
    ]
    pts = []
    for deg, dist, rad in sats:
        a = math.radians(deg)
        pts.append((cx + math.cos(a) * size * dist,
                    cy + math.sin(a) * size * dist,
                    size * rad))
    return (cx, cy), pts


def build_master(theme: str = "deep") -> Image.Image:
    t = THEMES[theme]
    size = S
    base = diagonal_gradient(size, t["bg"]).convert("RGBA")
    (cx, cy), pts = node_layout(size)
    fg = t["fg"]

    # 网络背后的柔光
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [cx - size * 0.22, cy - size * 0.22, cx + size * 0.22, cy + size * 0.22],
        fill=t["glow"])
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.045))
    base = Image.alpha_composite(base, glow)

    # 浅色版：节点与连线整体带一层柔和投影，才有「浮起来」的质感
    if t["shadow"]:
        sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        off = size * 0.012
        for x, y, r in pts:
            sd.line([(cx, cy + off), (x, y + off)],
                    fill=t["shadow"], width=int(size * 0.014))
            sd.ellipse([x - r, y - r + off, x + r, y + r + off], fill=t["shadow"])
        sd.ellipse([cx - size * 0.092, cy - size * 0.092 + off,
                    cx + size * 0.092, cy + size * 0.092 + off], fill=t["shadow"])
        sh = sh.filter(ImageFilter.GaussianBlur(size * 0.012))
        base = Image.alpha_composite(base, sh)

    # 连线（独立图层才能用 alpha 叠加）：从核心辐射出去的 5 条
    lines = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    lw = int(size * 0.014)
    for x, y, _ in pts:
        if t["line_fade"]:
            # 由内向外 alpha 递减，近核心更实、到卫星处渐隐，比等粗线有层次
            steps = 12
            for k in range(steps):
                a0, a1 = k / steps, (k + 1) / steps
                alpha = int(t["line_alpha"] * (1.0 - 0.55 * (a0 + a1) / 2))
                ld.line(
                    [(cx + (x - cx) * a0, cy + (y - cy) * a0),
                     (cx + (x - cx) * a1, cy + (y - cy) * a1)],
                    fill=fg + (alpha,), width=lw)
        else:
            ld.line([(cx, cy), (x, y)], fill=fg + (t["line_alpha"],), width=lw)
    base = Image.alpha_composite(base, lines)

    nodes = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    nd = ImageDraw.Draw(nodes)
    for x, y, r in pts:
        nd.ellipse([x - r, y - r, x + r, y + r], fill=fg + (240,))

    # 核心节点：实心圆 + 两圈渐隐细环（近实远虚，像发光的核心）
    R = size * 0.092
    nd.ellipse([cx - R, cy - R, cx + R, cy + R], fill=fg + (255,))
    for ring_r, alpha, w in ((0.128, 92, 0.013), (0.163, 46, 0.010)):
        rr = size * ring_r
        nd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                   outline=fg + (alpha,), width=int(size * w))

    return Image.alpha_composite(base, nodes)


def export(master: Image.Image, theme: str, to_res: bool) -> None:
    square = Image.composite(master, Image.new("RGBA", master.size, (0, 0, 0, 0)),
                             rounded_mask(S))
    round_master = Image.composite(square, Image.new("RGBA", square.size, (0, 0, 0, 0)),
                                   circle_mask(S))

    if to_res:
        densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96,
                     "xxhdpi": 144, "xxxhdpi": 192}
        for name, px in densities.items():
            d = os.path.join(RES, f"mipmap-{name}")
            os.makedirs(d, exist_ok=True)
            square.resize((px, px), Image.LANCZOS).save(
                os.path.join(d, "ic_launcher.png"))
            round_master.resize((px, px), Image.LANCZOS).save(
                os.path.join(d, "ic_launcher_round.png"))
        print("  -> res/mipmap-*: 48/72/96/144/192 已更新")

    os.makedirs(PREVIEW, exist_ok=True)
    square.resize((512, 512), Image.LANCZOS).save(
        os.path.join(PREVIEW, f"icon_{theme}_512.png"))
    round_master.resize((512, 512), Image.LANCZOS).save(
        os.path.join(PREVIEW, f"icon_{theme}_round_512.png"))
    square.resize((192, 192), Image.LANCZOS).save(
        os.path.join(PREVIEW, f"icon_{theme}_192.png"))
    square.resize((96, 96), Image.LANCZOS).save(
        os.path.join(PREVIEW, f"icon_{theme}_96.png"))


if __name__ == "__main__":
    primary = sys.argv[1] if len(sys.argv) > 1 else "deep"
    for name in THEMES:
        m = build_master(name)
        export(m, name, to_res=(name == primary))
        print(f"  {name}: preview/icon_{name}_512.png")
    print("done")
