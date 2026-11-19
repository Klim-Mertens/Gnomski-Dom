"""Катсцена-заставка: заснеженные горы и одинокая башня (референс 1).
Рисуется слоями для параллакса: небо, дальние горы, ближние горы, башня, ели, туман."""
import numpy as np
from common import ramp, value_noise, shade_ramp, rgba, save, hexc, BAYER4

W, H = 640, 300   # шире экрана, чтобы камера могла медленно проезжать

SKY = ramp("#1a2440", "#22305a", "#2c3e6e", "#3a5084", "#4c6698", "#6280ac")
SNOW = ramp("#2a3a5e", "#3a5078", "#506c96", "#7290b8", "#9ab4d4", "#c8daf0", "#eef4ff")
ROCK = ramp("#141c30", "#1c2640", "#263452", "#304264")
PINE = ramp("#0a1020", "#0f1830", "#16223e", "#1e2e4e", "#2a3e60")
STONE = ramp("#141a28", "#1e2638", "#2a3448", "#3a4458", "#4e5a6c", "#66707e")


def ridge(seed, base, amp, scale, w=W):
    n = value_noise(w, 1, scale, seed=seed, octaves=6)[0]
    # заострённые вершины: |шум| даёт пики
    return base - (np.abs(n - 0.5) * 2) ** 0.8 * amp - n * amp * 0.4


def mountains(seed, base, amp, scale, light_bias, dark=0.0):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    top = ridge(seed, base, amp, scale)
    mask = ys >= top[None, :]
    # Рельеф: «гребневой» 2D-шум, свет слева -> левые склоны гребней светлые
    n = value_noise(W, H, 34, seed=seed + 1, octaves=5)
    r = 1 - np.abs(2 * n - 1)                      # хребты
    rx = np.roll(r, 1, axis=1) - np.roll(r, -1, axis=1)
    ry = np.roll(r, 1, axis=0) - np.roll(r, -1, axis=0)
    light = (rx * 1.3 + ry * 0.6) * 4 * light_bias
    depth = np.clip((ys - top[None, :]) / 140, 0, 1)
    v = 0.55 + light + (r - 0.5) * 0.35 - depth * 0.5 - dark
    snow = shade_ramp(np.clip(v, 0, 1), SNOW)
    rockm = (light < -0.18) & (r > 0.55)
    snow[rockm] = shade_ramp(np.clip(v * 0.8, 0, 1), ROCK)[rockm]
    return rgba(snow, mask.astype(np.float32))


def sky():
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    v = ys / H * 1.1 + (value_noise(W, H, 60, seed=5, octaves=3) - 0.5) * 0.2
    img = shade_ramp(np.clip(v, 0, 1), SKY)
    rng = np.random.default_rng(3)
    for _ in range(140):
        x, y = rng.integers(0, W), rng.integers(0, int(H * 0.5))
        img[y, x] = hexc("#c8d8f0") if rng.random() < 0.7 else hexc("#ffffff")
    return rgba(img, np.ones((H, W)))


def pines(seed, base, height, color_shift, density=1.0):
    rng = np.random.default_rng(seed)
    img = np.zeros((H, W, 4), np.float32)
    x = -10
    while x < W + 10:
        h = int(height * rng.uniform(0.6, 1.2))
        top = base - h
        for y in range(max(0, top), min(H, base + 40)):
            t = (y - top) / max(1, h)
            # ярусы ветвей: зубчатый край
            half = max(0, t * h * 0.28 * (0.75 + 0.25 * ((y - top) % 5) / 5))
            for xx in range(int(x - half), int(x + half) + 1):
                if 0 <= xx < W:
                    lit = xx < x - half * 0.3
                    k = int(np.clip(color_shift + (1 if lit else 0) + (BAYER4[y % 4, xx % 4] > 0.6) * lit, 0, 4))
                    img[y, xx, :3] = PINE[k]
                    img[y, xx, 3] = 255
                    if lit and rng.random() < 0.025 and y < base:   # снег на лапах
                        img[y, xx, :3] = SNOW[4]
        x += rng.integers(5, 12) / density
    img[base + 40:, :, :3] = PINE[0]; img[base + 40:, :, 3] = 255
    return img.astype(np.uint8)


def tower():
    """Каменная башня на скале с горящим окном."""
    img = np.zeros((H, W, 4), np.float32)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, top, bot, half = 170, 60, 250, 22
    body = (np.abs(xs - cx) <= half) & (ys >= top) & (ys <= bot)
    # кладка: ряды камней со смещением
    brick = ((ys.astype(int) % 6) == 0) | (((xs.astype(int) + (ys.astype(int) // 6) * 5) % 10) == 0)
    v = 0.62 - (xs - cx) / half * 0.35 + (value_noise(W, H, 6, seed=9, octaves=3) - 0.5) * 0.5 - brick * 0.25
    v -= np.clip((ys - top) / (bot - top), 0, 1) * 0.25
    col = shade_ramp(np.clip(v, 0, 1), STONE)
    img[body, :3] = col[body]; img[body, 3] = 255
    # зубцы
    for k in range(-half, half + 1, 8):
        m = (xs >= cx + k) & (xs < cx + k + 5) & (ys >= top - 6) & (ys < top)
        img[m, :3] = STONE[3]; img[m, 3] = 255
    cornice = (np.abs(xs - cx) <= half + 3) & (ys >= top) & (ys < top + 5)
    img[cornice, :3] = shade_ramp(np.clip(v + 0.2, 0, 1), STONE)[cornice]; img[cornice, 3] = 255
    # снег на зубцах
    for k in range(-half, half + 1, 8):
        img[top - 7, cx + k:cx + k + 5, :3] = SNOW[6]; img[top - 7, cx + k:cx + k + 5, 3] = 255
    # окна (тёмные) и одно горящее
    for wy in (90, 130, 170, 205):
        for wx in (cx - 9, cx + 5):
            img[wy:wy + 9, wx:wx + 4, :3] = hexc("#0a0e18"); img[wy:wy + 9, wx:wx + 4, 3] = 255
    img[170:179, cx + 5:cx + 9, :3] = hexc("#ffb050")
    img[171:178, cx + 6:cx + 8, :3] = hexc("#ffe0a0")
    # флаг
    img[44:60, cx - 1, :3] = STONE[2]; img[44:60, cx - 1, 3] = 255
    flag = (xs > cx) & (xs < cx + 14) & (ys > 44) & (ys < 50 + (xs - cx) * 0.15)
    img[flag, :3] = hexc("#7a1c22"); img[flag, 3] = 255
    # скала под башней
    rock_top = 245 + (value_noise(W, 1, 12, seed=4)[0] - 0.5) * 20
    rm = (ys >= rock_top[None, :]) & (np.abs(xs - cx) < 80 - (ys - 245) * -0.6)
    rv = 0.5 - (xs - cx) / 80 * 0.4 + (value_noise(W, H, 5, seed=8, octaves=3) - .5) * .6
    img[rm, :3] = shade_ramp(np.clip(rv, 0, 1), STONE[:5])[rm]; img[rm, 3] = 255
    return img.astype(np.uint8)


def fog_band(y0, thickness, alpha, seed):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    n = value_noise(W, H, 40, seed=seed, octaves=4)
    a = np.exp(-((ys - y0) / thickness) ** 2) * (0.5 + n * 0.8) * alpha
    a = np.floor(a * 6 + (BAYER4[ys.astype(int) % 4, xs.astype(int) % 4] - .5) * .9) / 6
    return rgba(np.ones((H, W, 3)) * hexc("#b8c8e0"), np.clip(a, 0, 1))


def build():
    save(sky(), "cs_sky.png")
    save(mountains(11, 150, 120, 140, 0.9), "cs_mtn_far.png")
    save(fog_band(170, 30, 0.6, 21), "cs_fog_far.png")
    save(mountains(12, 210, 90, 90, 1.2, dark=0.25), "cs_mtn_near.png")
    save(pines(31, 230, 40, 1), "cs_pines_far.png")
    save(tower(), "cs_tower.png")
    save(fog_band(250, 25, 0.5, 22), "cs_fog_near.png")
    save(pines(32, 285, 70, 0, density=0.8), "cs_pines_near.png")


if __name__ == "__main__":
    build()
    print("cutscene ok")
