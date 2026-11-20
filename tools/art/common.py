"""Общие инструменты «художника»: палитры, шум, дизеринг, контур, свет.

Вся графика игры рисуется этими скриптами и сохраняется в public/assets/gfx.
Запуск: python3 tools/art/build_all.py
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "assets", "gfx")
os.makedirs(OUT, exist_ok=True)

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def ramp(*hexes):
    """Цветовая лестница от тёмного к светлому."""
    return np.stack([hexc(h) for h in hexes])


def value_noise(w, h, scale, seed=0, octaves=4, tile=False):
    """Фрактальный шум 0..1 (при tile=True бесшовно повторяется)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = scale / (2 ** o)
        gw, gh = max(2, int(np.ceil(w / s)) + 2), max(2, int(np.ceil(h / s)) + 2)
        if tile:
            gw, gh = max(2, int(round(w / s))), max(2, int(round(h / s)))
        grid = rng.random((gh, gw)).astype(np.float32)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        fx, fy = xs / s, ys / s
        x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = fx - x0, fy - y0
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        if tile:
            x1, y1 = (x0 + 1) % gw, (y0 + 1) % gh
            x0, y0 = x0 % gw, y0 % gh
        else:
            x1, y1 = x0 + 1, y0 + 1
        a, b = grid[y0, x0], grid[y0, x1]
        c, d = grid[y1, x0], grid[y1, x1]
        out += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
        total += amp
        amp *= 0.5
    return out / total


def shade_ramp(value, rmp, dither=True, ox=0, oy=0):
    """Значение 0..1 -> цвет из лестницы с упорядоченным дизерингом (как в пиксель-арте)."""
    h, w = value.shape
    n = len(rmp)
    v = np.clip(value, 0, 0.9999) * n
    if dither:
        ys, xs = np.mgrid[0:h, 0:w]
        v = v + (BAYER4[(ys + oy) % 4, (xs + ox) % 4] - 0.5) * 0.9
    idx = np.clip(v.astype(int), 0, n - 1)
    return rmp[idx]


def rgba(rgb, alpha):
    h, w = alpha.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    return out


def outline(img, color="#120c14", diag=False):
    """Тёмный контур в 1 px вокруг непрозрачных пикселей."""
    a = img[..., 3] > 0
    m = np.zeros_like(a)
    m[1:, :] |= a[:-1, :]; m[:-1, :] |= a[1:, :]
    m[:, 1:] |= a[:, :-1]; m[:, :-1] |= a[:, 1:]
    if diag:
        m[1:, 1:] |= a[:-1, :-1]; m[:-1, :-1] |= a[1:, 1:]
    m &= ~a
    out = img.copy()
    out[m, :3] = hexc(color).astype(np.uint8)
    out[m, 3] = 255
    return out


def save(arr, name):
    path = os.path.join(OUT, name)
    Image.fromarray(arr.astype(np.uint8), "RGBA" if arr.shape[-1] == 4 else "RGB").save(path, optimize=True)
    return path
