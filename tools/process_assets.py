#!/usr/bin/env python3
"""Process raw artwork into web-ready assets for the Lucky BRIDGE slot machine.

- Transparent-background art (stickers, emblem): trim alpha bounding box, resize, PNG.
- Prize photos: trim uniform/gradient background margin, resize, JPEG.
"""
import math
import sys
from PIL import Image

STICKER_DIR = "/Users/yuhengsmac/Downloads/物料 3/贴纸"
RAW = {
    "special": "/Volumes/acer/WeChat/微信图片_20261108195637_14_3.png",
    "coaster": "/Volumes/acer/WeChat/杯垫.jpg",
    "postcard": "/Volumes/acer/WeChat/明信片.png",
    "stickersheet": "/Volumes/acer/WeChat/贴纸.png",
    "keychain": "/Volumes/acer/WeChat/钥匙扣.jpg",
}
OUT_SYM = "/Volumes/acer/zcode_file/.zcode/workspace/2d53a5f3-ca0c-47f3-b67a-906e17857dfa/lucky-bridge/assets/symbols"
OUT_PRZ = "/Volumes/acer/zcode_file/.zcode/workspace/2d53a5f3-ca0c-47f3-b67a-906e17857dfa/lucky-bridge/assets/prizes"


def trim_alpha(im, thresh=8):
    alpha = im.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > thresh else 0).getbbox()
    return im.crop(bbox) if bbox else im


def color_dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a[:3], b[:3])))


def trim_background(im, tol=50, step=2, keep=4):
    """Trim margin pixels similar to the edge background colour.

    Samples the four corners as background references so a soft gradient
    backdrop (e.g. the coaster photo) still trims cleanly.
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    refs = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]

    def is_bg(p):
        return min(color_dist(p, r) for r in refs) < tol

    def scan(get, length, other):
        lo, hi = 0, length - 1
        for i in range(0, length, step):
            row_bg = sum(1 for j in range(0, other, max(1, other // 24)) if is_bg(get(i, j)))
            if row_bg < max(1, other // 24) * 0.55:
                lo = i
                break
        for i in range(length - 1, -1, -step):
            row_bg = sum(1 for j in range(0, other, max(1, other // 24)) if is_bg(get(i, j)))
            if row_bg < max(1, other // 24) * 0.55:
                hi = i
                break
        return max(0, lo - keep), min(length - 1, hi + keep)

    x0, x1 = scan(lambda x, y: px[x, y], w, h)
    y0, y1 = scan(lambda y, x: px[x, y], h, w)
    if x1 - x0 < 10 or y1 - y0 < 10:
        return im
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def resize_max(im, maxpx):
    w, h = im.size
    s = maxpx / max(w, h)
    if s >= 1:
        return im
    return im.resize((round(w * s), round(h * s)), Image.LANCZOS)


def save_png(im, path):
    im.save(path, "PNG", optimize=True)


def save_jpg(im, path, q=86):
    im.convert("RGB").save(path, "JPEG", quality=q, optimize=True, progressive=True)


def report(path):
    import os
    print(f"  -> {path}  {os.path.getsize(path)//1024} KB")


def main():
    print("Reel symbols (stickers + special emblem)...")
    names = ["anxious", "back", "confused", "greeting", "proud", "shocked"]
    for n in names:
        im = Image.open(f"{STICKER_DIR}/{n}.png").convert("RGBA")
        im = trim_alpha(im)
        im = resize_max(im, 512)
        out = f"{OUT_SYM}/{n}.png"
        save_png(im, out)
        report(out)
    im = Image.open(RAW["special"]).convert("RGBA")
    im = trim_alpha(im)
    im = resize_max(im, 512)
    out = f"{OUT_SYM}/special.png"
    save_png(im, out)
    report(out)

    print("Prize photos (auto-trim margins)...")
    for key, src, jpgq in [
        ("keychain", RAW["keychain"], 86),
        ("coaster", RAW["coaster"], 86),
        ("stickersheet", RAW["stickersheet"], 86),
        ("postcard", RAW["postcard"], 88),
    ]:
        im = Image.open(src)
        before = im.size
        im = trim_background(im)
        im = resize_max(im, 900)
        out = f"{OUT_PRZ}/{key}.jpg"
        save_jpg(im, out, jpgq)
        print(f"  {key}: {before} trimmed to {im.size}")
        report(out)


if __name__ == "__main__":
    sys.exit(main())
