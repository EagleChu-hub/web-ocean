#!/usr/bin/env python3
"""Turn the AI-generated source images into the textures the page uses.

    python3 -I tools/prepare_assets.py SAND_DRY SAND_WET SHELLS PALM [PALM ...]

SAND_*  photos of sand, made seamlessly tileable here
SHELLS  shells, starfish and pebbles on a flat #00FF00 background, cut out into an atlas
PALM    coconut palms on a flat #00FF00 background, keyed out and aligned at the trunk base

Writes assets/*.webp and js/assets.js (paths plus the measurements the shaders need).
The sources themselves are not kept in the repository.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
KEY = np.array([0.0, 255.0, 0.0])


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def seamless(path, size=768):
    """Cross-fade the image with a copy rolled by half its size, so the edges wrap. The blend
    weights would lower the grain contrast in the overlap, so the deviation from the mean is
    rescaled to keep it even."""
    img = Image.open(path).convert('RGB')
    s = min(img.size)
    img = img.crop(((img.width - s) // 2, (img.height - s) // 2, (img.width + s) // 2, (img.height + s) // 2))
    a = np.asarray(img).astype(np.float64)
    b = np.roll(a, (s // 2, s // 2), axis=(0, 1))
    t = np.linspace(0.0, 1.0, s)
    w1 = np.clip(np.minimum(t, 1.0 - t) * 4.0, 0.0, 1.0)      # 0 at the edges, 1 inside
    w1 = w1 * w1 * (3.0 - 2.0 * w1)
    w = (w1[:, None] * w1[None, :])[..., None]
    mean = a.reshape(-1, 3).mean(0)
    mix = a * w + b * (1.0 - w)
    out = mean + (mix - mean) / np.sqrt(w * w + (1.0 - w) ** 2)
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    lin = srgb_to_linear(np.asarray(im).astype(np.float64)).reshape(-1, 3).mean(0)
    return im, [round(float(x), 4) for x in lin]


def key_out(path):
    """Alpha from the distance to the key green; edge colours un-mixed from the green and
    any remaining green spill clamped."""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    d = np.linalg.norm(a - KEY, axis=2)
    alpha = np.clip((d - 70.0) / 90.0, 0.0, 1.0)
    al = np.maximum(alpha, 1e-3)[..., None]
    rgb = (a - (1.0 - alpha)[..., None] * KEY) / al
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]) * 1.25 + 12.0)
    rgb = np.clip(rgb, 0, 255)
    return np.dstack([rgb, alpha * 255.0]).astype(np.uint8)


def bbox(alpha, thr=40):
    ys, xs = np.nonzero(alpha > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def palms(paths, w=576, h=768):
    """Each palm scaled so its full height fills the frame and centred in it. Returns the
    images and, per palm, the trunk base position across the frame (0..1) and which way the
    crown leans (+1 right, -1 left)."""
    out, lean, base_u = [], [], []
    for p in paths:
        rgba = key_out(p)
        x0, y0, x1, y1 = bbox(rgba[..., 3])
        crop = rgba[y0:y1, x0:x1]
        base = np.nonzero(crop[-6:, :, 3].max(0) > 100)[0]
        base_x = (base.min() + base.max()) / 2.0
        top = np.nonzero(crop[: crop.shape[0] // 3, :, 3].max(0) > 100)[0]
        lean.append(1 if (top.min() + top.max()) / 2.0 > base_x else -1)
        k = min(h / crop.shape[0], w / crop.shape[1])
        im = Image.fromarray(crop).resize((max(1, round(crop.shape[1] * k)), max(1, round(crop.shape[0] * k))), Image.LANCZOS)
        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        left, top = (w - im.width) // 2, h - im.height
        canvas.alpha_composite(im, (left, top))
        base_u.append(round((left + base_x * k) / w, 4))
        out.append(canvas)
    return out, lean, base_u


def components(mask):
    """Connected components of a boolean mask (4-neighbour flood fill)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    boxes = []
    for sy, sx in zip(*np.nonzero(mask)):
        if lab[sy, sx]:
            continue
        n = len(boxes) + 1
        stack = [(sy, sx)]
        lab[sy, sx] = n
        x0 = x1 = sx
        y0 = y1 = sy
        while stack:
            y, x = stack.pop()
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
        boxes.append((x0, y0, x1 + 1, y1 + 1))
    return lab, boxes


def shell_atlas(path, sheet_m=0.42, size=1024, pad=6):
    """Cut every object out of the sheet and shelf-pack them into one atlas. sheet_m is the
    real width of the photographed sheet, which gives each object its size in metres."""
    rgba = key_out(path)
    small = rgba[::2, ::2, 3] > 128
    lab, boxes = components(small)
    sprites = []
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        if (x1 - x0) * (y1 - y0) < 300:
            continue
        x0, y0, x1, y1 = x0 * 2 - 4, y0 * 2 - 4, x1 * 2 + 4, y1 * 2 + 4
        piece = rgba[max(y0, 0):y1, max(x0, 0):x1].copy()
        own = np.kron(lab == i + 1, np.ones((2, 2), bool))[max(y0, 0):y1, max(x0, 0):x1]
        piece[..., 3] = np.where(own | (piece[..., 3] < 250), piece[..., 3], 0)
        sprites.append((piece, max(piece.shape[:2]) * sheet_m / rgba.shape[1]))
    sprites.sort(key=lambda s: -s[0].shape[0])
    atlas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    scale = 0.75
    x = y = shelf = 0
    rects = []
    for piece, metres in sprites:
        im = Image.fromarray(piece)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        if x + im.width + pad > size:
            x, y, shelf = 0, y + shelf + pad, 0
        atlas.alpha_composite(im, (x + pad, y + pad))
        # rect in UV (x, y, w, h) and the object's longest side in metres
        rects.append([round((x + pad) / size, 5), round((y + pad) / size, 5), round(im.width / size, 5),
                      round(im.height / size, 5), round(metres, 4)])
        x += im.width + pad
        shelf = max(shelf, im.height)
    if y + shelf + pad > size:
        sys.exit('shell atlas overflow: lower the scale')
    return atlas, rects


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    dry, wet, shells, *palm_paths = sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name, path in (('sandDry', dry), ('sandWet', wet)):
        im, mean = seamless(path)
        im.save(os.path.join(OUT, f'{name}.webp'), quality=78, method=6)
        meta[name + 'Mean'] = mean
    atlas, rects = shell_atlas(shells)
    atlas.save(os.path.join(OUT, 'shells.webp'), quality=88, method=6)
    meta['shellRects'] = rects
    ims, lean, base_u = palms(palm_paths)
    for i, im in enumerate(ims):
        im.save(os.path.join(OUT, f'palm{i}.webp'), quality=85, method=6)
    meta['palmLean'] = lean
    meta['palmBaseU'] = base_u
    meta['palmAspect'] = round(ims[0].width / ims[0].height, 4)
    files = ['sandDry', 'sandWet', 'shells'] + [f'palm{i}' for i in range(len(ims))]
    urls = {f: f'assets/{f}.webp' for f in files}
    js = ('// Generated by tools/prepare_assets.py; build.mjs inlines the files as data URLs.\n'
          f'export const ASSET_URLS = {json.dumps(urls, indent=2)};\n'
          f'export const ASSET_META = {json.dumps(meta)};\n')
    with open(os.path.join(ROOT, 'js', 'assets.js'), 'w') as fh:
        fh.write(js)
    for f in files:
        print(f, os.path.getsize(os.path.join(OUT, f + '.webp')) // 1024, 'KB')
    print('shells:', len(rects), 'palm lean:', lean, 'sand means:', meta['sandDryMean'], meta['sandWetMean'])


if __name__ == '__main__':
    main()
