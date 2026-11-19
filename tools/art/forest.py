"""Туманный лес (референс: зелёный лес с тропой и туманом).
Рисует: землю с тропой, деревья, кусты, папоротники, камни, туман, лучи света."""
import json
import numpy as np
from PIL import Image
from common import ramp, value_noise, shade_ramp, rgba, outline, save, hexc, OUT, BAYER4
import os

WORLD_W, WORLD_H = 1600, 1040

# Палитры, подобранные под референс: приглушённая зелень, охра тропы, тёплые листья
GRASS = ramp("#1d2b22", "#24362a", "#2c4230", "#365035", "#43603c", "#557346")
DIRT = ramp("#3b2c22", "#4d3a2b", "#5f4835", "#735a42", "#8a6d50")
LEAF = ramp("#122016", "#1b2e1d", "#264026", "#33542f", "#46693a", "#5f8247", "#7e9c58", "#a3b56c")
BARK = ramp("#1a1210", "#2a1d17", "#3c2a1f", "#523a2a", "#6a4c36")
FALLEN = [hexc("#9a5a2a"), hexc("#b8763a"), hexc("#7a3e22"), hexc("#c89a4a")]
STONE = ramp("#2a2c30", "#3c3f44", "#53575c", "#6e7276", "#8c9094")


def path_points(seed=7):
    """Извилистая тропа через весь лес (ломаная, потом сглаживается)."""
    rng = np.random.default_rng(seed)
    pts = [(-40, 640)]
    x, y = -40, 640
    while x < WORLD_W + 60:
        x += rng.integers(90, 150)
        y = int(np.clip(y + rng.integers(-90, 90), 260, WORLD_H - 200))
        pts.append((x, y))
    return pts


def dist_to_polyline(xs, ys, pts):
    d = np.full(xs.shape, 1e9, np.float32)
    for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        t = np.clip(((xs - x1) * dx + (ys - y1) * dy) / (dx * dx + dy * dy), 0, 1)
        px, py = x1 + t * dx, y1 + t * dy
        d = np.minimum(d, np.hypot(xs - px, ys - py))
    return d


def ground(pts):
    h, w = WORLD_H, WORLD_W
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    n1 = value_noise(w, h, 64, seed=1, octaves=5)
    n2 = value_noise(w, h, 9, seed=2, octaves=2)
    grass_v = 0.18 + n1 * 0.55 + (n2 - 0.5) * 0.35
    img = shade_ramp(grass_v, GRASS)

    # Тропа: шумный край, светлее в центре
    d = dist_to_polyline(xs, ys, pts)
    width = 15 + value_noise(w, h, 40, seed=3, octaves=3) * 12
    edge = d - width
    on_path = edge < 0
    dirt_v = 0.25 + (1 - np.clip(d / width, 0, 1)) * 0.35 + (n2 - 0.5) * 0.45 + (n1 - 0.5) * 0.3
    dirt = shade_ramp(dirt_v, DIRT)
    img[on_path] = dirt[on_path]
    # травяная кромка у тропы
    rim = (edge >= 0) & (edge < 3) & (n2 > 0.45)
    img[rim] = GRASS[4]

    rng = np.random.default_rng(11)
    # Опавшие листья (гуще на тропе)
    for _ in range(9000):
        x, y = rng.integers(0, w - 3), rng.integers(0, h - 2)
        if not on_path[y, x] and rng.random() > 0.12:
            continue
        c = FALLEN[rng.integers(0, 4)]
        img[y, x:x + 2] = c
        if rng.random() < 0.5:
            img[y + 1, x] = c * 0.8
    # Травинки и цветочки
    for _ in range(9000):
        x, y = rng.integers(1, w - 1), rng.integers(3, h)
        if on_path[y, x]:
            continue
        hgt = rng.integers(1, 4)
        img[y - hgt:y, x] = GRASS[5] if rng.random() < 0.4 else GRASS[4]
    for _ in range(700):
        x, y = rng.integers(0, w), rng.integers(0, h)
        if not on_path[y, x]:
            img[y, x] = [hexc("#d8d0a0"), hexc("#c86a7a"), hexc("#8ab0c8")][rng.integers(0, 3)]
    return img.astype(np.uint8), on_path


def blob_mask(w, h, cx, cy, r, seed, rough=0.35):
    """Круглое пятно с рваным «лиственным» краем."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot(xs - cx, (ys - cy) * 1.1) / r
    n = value_noise(w, h, max(3, r / 3), seed=seed, octaves=2)
    return d < 1 - rough * (n - 0.3), d


def tree(seed, size=1.0):
    """Лиственное дерево в виде 3/4: крона из гроздей листвы, ствол с корнями."""
    rng = np.random.default_rng(seed)
    W, H = int(84 * size), int(118 * size)
    img = np.zeros((H, W, 4), np.float32)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)

    # Ствол
    tx = W / 2 + rng.integers(-3, 4)
    trunk_top, trunk_bot = H * 0.42, H - 4
    tw = 4.2 * size + 0.5
    t = np.clip((ys - trunk_top) / (trunk_bot - trunk_top), 0, 1)
    halfw = tw * (1 + np.clip((t - 0.8) / 0.2, 0, 1) ** 2 * 1.4)  # расширяется только у корней
    bend = np.sin(t * 2.2 + seed) * 2
    tm = (ys > trunk_top) & (ys < trunk_bot) & (np.abs(xs - tx - bend) < halfw)
    # корни
    for k in (-1, 1):
        rx = tx + k * np.linspace(0, 12 * size, 30)
        ry = trunk_bot - 4 + np.linspace(0, 4, 30)
        for xx, yy in zip(rx, ry):
            tm |= (np.abs(xs - xx) < 1.6) & (np.abs(ys - yy) < 1.6)
    bark_v = 0.55 - (xs - tx) / (tw * 2.2) * 0.45 + (value_noise(W, H, 2, seed=seed + 5, octaves=1) - 0.5) * 0.3
    stripes = value_noise(W, H * 4, 3, seed=seed + 6, octaves=1)[::4, :]  # вертикальные волокна коры
    bark_v += (stripes[:H, :W] - 0.5) * 0.5
    img[tm, :3] = shade_ramp(bark_v, BARK)[tm]
    img[tm, 3] = 255

    # Ветки
    for _ in range(3):
        a = rng.uniform(-2.4, -0.7)
        L = rng.uniform(14, 22) * size
        y0 = rng.uniform(trunk_top, trunk_top + 18 * size)
        for s in np.linspace(0, 1, 40):
            x = tx + np.cos(a) * L * s * (1 if rng.random() > 0.5 else 1)
            y = y0 + np.sin(a) * L * s
            m = (np.abs(xs - x) < 1.3 - s * 0.5) & (np.abs(ys - y) < 1.3)
            img[m, :3] = BARK[2]; img[m, 3] = 255

    # Крона: грозди листвы, нижние темнее, свет сверху-слева
    clusters = []
    base_r = 15 * size
    for i in range(rng.integers(9, 13)):
        r = base_r * rng.uniform(0.6, 1.0)
        cx = float(np.clip(W / 2 + rng.normal(0, 12 * size), r + 2, W - r - 2))
        cy = float(np.clip(H * 0.34 + rng.normal(0, 8 * size), r + 2, H * 0.5))
        clusters.append((cy, cx, r))
    clusters.sort()  # сначала дальние (верхние)
    clusters += [(H * 0.36 + rng.normal(0, 4), W / 2 + k * 15 * size, base_r * 0.75) for k in (-1, 1)]
    clusters.sort()
    for i, (cy, cx, r) in enumerate(clusters):
        m, d = blob_mask(W, H, cx, cy, r, seed * 31 + i)
        nx, ny = (xs - cx) / r, (ys - cy) / r
        light = 0.62 - nx * 0.32 - ny * 0.42 - d * 0.18
        light += (value_noise(W, H, 4, seed=seed + i * 7, octaves=1) - 0.5) * 0.3
        light += (cy / H - 0.3) * -0.6  # нижние грозди в тени
        col = shade_ramp(np.clip(light, 0, 1), LEAF, ox=i, oy=i)
        img[m, :3] = col[m]; img[m, 3] = 255
    # Текстура листвы: мелкие «листочки» — светлый верх, тёмный низ
    canopy = (img[..., 3] > 0) & (ys < H * 0.62)
    cy_idx, cx_idx = np.nonzero(canopy)
    for _ in range(int(420 * size * size)):
        k = rng.integers(0, len(cy_idx))
        y, x = cy_idx[k], cx_idx[k]
        if y < 1 or y > H - 3 or x < 1 or x > W - 3 or not canopy[y + 1, x]:
            continue
        base = int(np.argmin(np.abs(LEAF - img[y, x, :3]).sum(1)))
        up = min(7, base + 1 + (x < W * 0.5) + (y < H * 0.25))
        img[y, x, :3] = LEAF[up]
        img[y, x + 1, :3] = LEAF[max(0, base)]
        img[y + 1, x, :3] = LEAF[max(0, base - 2)]
    # тень кроны на стволе
    shade_m = (img[..., 3] > 0) & (ys > H * 0.42) & (ys < H * 0.55) & tm
    img[shade_m, :3] = img[shade_m, :3] * 0.6
    out = outline(img.astype(np.uint8), "#0c140e")
    return out


def bush(seed, w=34, h=22):
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    for i in range(4):
        cx, cy, r = w / 2 + rng.normal(0, 6), h * 0.6 + rng.normal(0, 2), rng.uniform(7, 10)
        m, d = blob_mask(w, h, cx, cy, r, seed + i, 0.4)
        light = 0.55 - (xs - cx) / r * 0.3 - (ys - cy) / r * 0.45 + (value_noise(w, h, 2, seed=seed + i, octaves=1) - .5) * .5
        img[m, :3] = shade_ramp(np.clip(light, 0, 1), LEAF[1:7])[m]; img[m, 3] = 255
    return outline(img.astype(np.uint8), "#0c140e")


def fern(seed):
    rng = np.random.default_rng(seed)
    w, h = 26, 18
    img = np.zeros((h, w, 4), np.uint8)
    for k in range(7):
        a = -np.pi / 2 + (k - 3) * 0.42 + rng.normal(0, 0.08)
        L = rng.uniform(9, 14)
        for s in np.linspace(0, 1, 30):
            x = w / 2 + np.cos(a) * L * s
            y = h - 1 + np.sin(a) * L * s + s * s * 5
            xi, yi = int(x), int(y)
            if 0 <= xi < w and 0 <= yi < h:
                img[yi, xi] = [*LEAF[4 if s < .6 else 5].astype(int), 255]
                for side in (-1, 1):  # листочки
                    xx = int(x + side * (1 - s) * 2.5)
                    if 0 <= xx < w and s > 0.15:
                        img[yi, xx] = [*LEAF[3 if side < 0 else 5].astype(int), 255]
    return outline(img, "#0c140e")


def rock(seed, w=22, h=15):
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    m, d = blob_mask(w, h, w / 2, h * 0.58, w * 0.42, seed, 0.25)
    light = 0.7 - (xs - w / 2) / w * 0.6 - (ys - h / 2) / h * 0.9 + (value_noise(w, h, 3, seed=seed) - .5) * .3
    img[m, :3] = shade_ramp(np.clip(light, 0, 1), STONE)[m]; img[m, 3] = 255
    # мох сверху
    moss = m & (ys < h * 0.45) & (value_noise(w, h, 3, seed=seed + 9) > 0.45)
    img[moss, :3] = LEAF[4]
    return outline(img.astype(np.uint8), "#101014")


def fog_tile(seed, size=256, density=0.55):
    """Бесшовная текстура тумана (белая с прозрачностью)."""
    n = value_noise(size, size, 64, seed=seed, octaves=4, tile=True)
    a = np.clip((n - (1 - density)) / density, 0, 1) ** 1.4
    # квантуем прозрачность ступеньками — так туман «пиксельный»
    ys, xs = np.mgrid[0:size, 0:size]
    a = np.floor(a * 6 + (BAYER4[ys % 4, xs % 4] - .5) * 0.8) / 6
    rgb = np.ones((size, size, 3)) * hexc("#d8e0d4")
    return rgba(rgb, np.clip(a, 0, 1) * 0.55)


def light_ray(w=90, h=260):
    """Луч солнца сквозь кроны (рисуется со смешиванием ADD)."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = w * 0.3 + ys * 0.22
    halfw = 10 + ys * 0.12
    core = 1 - np.clip(np.abs(xs - cx) / halfw, 0, 1)
    fade = np.clip(1 - ys / h, 0, 1) ** 0.7 * np.clip(ys / 30, 0, 1)
    a = core ** 1.5 * fade
    a = np.floor(a * 5 + (BAYER4[ys.astype(int) % 4, xs.astype(int) % 4] - .5) * .9) / 5
    rgb = np.ones((h, w, 3)) * hexc("#e8c878")
    return rgba(rgb, np.clip(a, 0, 1) * 0.5)


def build():
    pts = path_points()
    g, on_path = ground(pts)
    Image.fromarray(g, "RGB").quantize(64, dither=Image.Dither.NONE).save(os.path.join(OUT, "forest_ground.png"), optimize=True)
    for i in range(5):
        save(tree(100 + i, 1.0 if i < 3 else 1.25), f"tree{i}.png")
    for i in range(3):
        save(bush(200 + i), f"bush{i}.png")
    for i in range(2):
        save(fern(300 + i), f"fern{i}.png")
    for i in range(2):
        save(rock(400 + i), f"rock{i}.png")
    save(fog_tile(1, density=0.55), "fog0.png")
    save(fog_tile(2, density=0.4), "fog1.png")
    save(light_ray(), "ray.png")
    with open(os.path.join(OUT, "forest_path.json"), "w") as f:
        json.dump({"w": WORLD_W, "h": WORLD_H, "path": [list(map(int, p)) for p in pts]}, f)


if __name__ == "__main__":
    build()
    print("forest ok")
