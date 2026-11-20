"""Ночной город Остенград (референс: ночной средневековый город с фонарями и замком на холме).
Рисует: мостовую, фахверковые дома с горящими окнами, замок, лотки базара, фонари, колодец.
Кладёт раскладку города в city_layout.json, чтобы игра расставила всё по тем же местам."""
import json
import os
import numpy as np
from scipy.spatial import cKDTree
from common import ramp, value_noise, shade_ramp, rgba, outline, save, hexc, OUT, BAYER4

W, H = 1600, 1200
STREET_X, STREET_W = 800, 120          # главная улица: от южных ворот к замку
CROSS_Y, CROSS_W = 820, 100            # поперечная улица: от западных ворот на восток
PLAZA = (800, 600, 230, 150)           # базарная площадь: центр и полуоси
CASTLE_BASE = 300                      # где стоит подножие замка

# Лунный свет: всё в холодных тонах, тёплый свет добавляет игра (фонари, окна)
COBBLE = ramp("#1a1c2a", "#232638", "#2d3146", "#383d55", "#454b65", "#565d78")
DIRT = ramp("#14161e", "#1b1e28", "#232733", "#2c313e")
GRASS = ramp("#111a1c", "#162224", "#1c2b2c", "#243535")
ROCK = ramp("#151420", "#1e1c2c", "#282538", "#343046", "#423d56")
PLASTER = ramp("#3a3a4a", "#4a4a5c", "#5c5c70", "#6e6e84", "#828298")
TIMBER = ramp("#120c10", "#1c1418", "#281c20", "#34262a")
ROOF_A = ramp("#1a1420", "#261c2c", "#33263a", "#40304a", "#4e3a58")     # сланец
ROOF_B = ramp("#22121a", "#341a24", "#46222e", "#582c38", "#6a3844")     # черепица
STONE = ramp("#1c1a28", "#262436", "#322f44", "#3e3a54", "#4c4864", "#5c5878")
WOOD = ramp("#1a120e", "#2a1c14", "#3a281c", "#4c3626", "#604632")
WIN_LIT = [hexc("#ffcf6a"), hexc("#ffe7a8"), hexc("#e89a3a")]
WIN_DARK = hexc("#0c0e18")
CLOTH = [ramp("#3a0e14", "#5a1820", "#7a242c"), ramp("#0e2a24", "#1a4038", "#2a5a4c"),
         ramp("#3a2a0c", "#5a4414", "#7a5e20")]
CLOTH_LIGHT = ramp("#5a5a60", "#7a7a80", "#9a9aa0")


def ellipse_d(xs, ys, cx, cy, rx, ry):
    return np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)


# ---------------- ЗЕМЛЯ ----------------
def ground():
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    n1 = value_noise(W, H, 60, seed=41, octaves=4)
    n2 = value_noise(W, H, 8, seed=42, octaves=2)
    img = shade_ramp(0.2 + n1 * 0.5 + (n2 - 0.5) * 0.3, DIRT)
    grass = (n1 > 0.58) & (ys > CASTLE_BASE + 40)
    img[grass] = shade_ramp(n2 * 0.9, GRASS)[grass]

    # Где мостовая: улицы + площадь (с неровным краем)
    jag = (value_noise(W, H, 14, seed=43, octaves=2) - 0.5) * 10
    street = (np.abs(xs - STREET_X) < STREET_W / 2 + jag) & (ys > CASTLE_BASE - 10)
    street |= (np.abs(ys - CROSS_Y) < CROSS_W / 2 + jag)
    street |= ellipse_d(xs, ys, *PLAZA) < 1 + jag / 200

    # Булыжники: ячейки Вороного, у каждой свой тон и свет сверху-слева
    rng = np.random.default_rng(44)
    n = int(W * H / 30)
    pts = np.stack([rng.uniform(0, W, n), rng.uniform(0, H, n)], 1)
    tree = cKDTree(pts)
    d, idx = tree.query(np.stack([xs.ravel(), ys.ravel()], 1), k=2, workers=-1)
    d1 = d[:, 0].reshape(H, W); d2 = d[:, 1].reshape(H, W); i1 = idx[:, 0].reshape(H, W)
    cell_tone = rng.random(n)[i1]
    cx, cy = pts[i1, 0], pts[i1, 1]
    bevel = -((xs - cx) + (ys - cy)) / 5.0          # блик на верхне-левой грани
    v = 0.35 + cell_tone * 0.3 + bevel * 0.18 + (n1 - 0.5) * 0.3
    # к краям площади камень темнее и грязнее
    v -= np.clip(ellipse_d(xs, ys, *PLAZA) - 0.6, 0, 1) * 0.1
    cob = shade_ramp(np.clip(v, 0, 1), COBBLE)
    mortar = (d2 - d1) < 1.1
    cob[mortar] = COBBLE[0]
    img[street] = cob[street]
    # узор на площади: круг из светлого камня вокруг колодца
    ring = np.abs(ellipse_d(xs, ys, PLAZA[0], PLAZA[1], 70, 46) - 1) < 0.06
    img[ring & ~mortar] = COBBLE[5]

    # Холм под замком: скала
    hill = ys < CASTLE_BASE + 20 + (value_noise(W, 1, 30, seed=45)[0] - 0.5) * 30
    rv = 0.3 + value_noise(W, H, 20, seed=46, octaves=4) * 0.6 - (CASTLE_BASE - ys) / 900
    rock = shade_ramp(np.clip(rv, 0, 1), ROCK)
    img[hill & ~street] = rock[hill & ~street]
    # подъём к замку: ступени через каждые 10 px
    steps = street & (ys < CASTLE_BASE + 60) & ((ys.astype(int) % 10) < 2)
    img[steps] = COBBLE[0]
    return rgba(img, np.ones((H, W)))


# ---------------- ДОМА ----------------
def house(seed, w, wall_h, roof_h, storeys=1, roof=ROOF_A):
    """Фахверковый дом, вид сверху-спереди: крыша сверху, фасад снизу."""
    rng = np.random.default_rng(seed)
    h = roof_h + wall_h + 2
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    lit = []

    # Крыша: ряды черепицы, к коньку светлее (луна сверху)
    rt = (ys < roof_h) & (xs >= 1) & (xs < w - 1)
    row = (ys.astype(int) // 4)
    scallop = ((xs.astype(int) + row * 3) % 6 == 0) | (ys.astype(int) % 4 == 3)
    rv = 0.75 - ys / roof_h * 0.45 + (value_noise(w, h, 6, seed=seed, octaves=2) - 0.5) * 0.35 - scallop * 0.18
    rcol = shade_ramp(np.clip(rv, 0, 1), roof)
    img[rt, :3] = rcol[rt]; img[rt, 3] = 255
    img[0:2, 1:w - 1, :3] = roof[4]; img[0:2, 1:w - 1, 3] = 255           # конёк
    img[roof_h - 2:roof_h, :, :3] = roof[0]; img[roof_h - 2:roof_h, :, 3] = 255   # свес
    # слуховое окно на крыше
    if w > 110 and rng.random() < 0.7:
        dx = int(w * rng.uniform(0.3, 0.6)); dy = roof_h // 2 - 4
        img[dy:dy + 9, dx:dx + 12, :3] = PLASTER[2]; img[dy:dy + 9, dx:dx + 12, 3] = 255
        img[dy - 3:dy, dx - 1:dx + 13, :3] = roof[3]
        if rng.random() < 0.7:
            img[dy + 2:dy + 7, dx + 3:dx + 9, :3] = WIN_LIT[0]; lit.append((dx + 6, dy + 4))
        else:
            img[dy + 2:dy + 7, dx + 3:dx + 9, :3] = WIN_DARK
    # труба с дымоходом
    cx = int(w * rng.choice([0.18, 0.78]))
    img[2:roof_h - 8, cx:cx + 7, :3] = STONE[2]; img[2:roof_h - 8, cx:cx + 7, 3] = 255
    img[2:roof_h - 8, cx:cx + 2, :3] = STONE[3]
    img[1:3, cx - 1:cx + 8, :3] = STONE[4]; img[1:3, cx - 1:cx + 8, 3] = 255
    chimney = (cx + 3, 0)

    # Фасад: штукатурка + тёмные балки
    y0 = roof_h
    fw = (ys >= y0) & (ys < h - 2)
    pv = 0.55 + (value_noise(w, h, 5, seed=seed + 1, octaves=3) - 0.5) * 0.4 - (ys - y0) / wall_h * 0.25
    img[fw, :3] = shade_ramp(np.clip(pv, 0, 1), PLASTER)[fw]; img[fw, 3] = 255
    beam = np.zeros((h, w), bool)
    beam[y0:y0 + 3, :] = True
    beam[:, 0:3] |= fw[:, 0:3]; beam[:, w - 3:w] |= fw[:, w - 3:w]
    nposts = max(2, w // 34)
    posts = [int(w * k / nposts) for k in range(1, nposts)]
    for px in posts:
        beam[y0:h - 2, px - 1:px + 2] = True
    floor_y = [y0 + int(wall_h * k / storeys) for k in range(1, storeys)]
    for fy in floor_y:
        beam[fy - 1:fy + 2, :] = True
    # диагональные укосины в простенках
    bounds = [0] + posts + [w]
    for a, b in zip(bounds[:-1], bounds[1:]):
        if rng.random() < 0.5:
            top, bot = y0 + 3, (floor_y[0] if floor_y else h - 4)
            for t in np.linspace(0, 1, 40):
                x = int(a + 3 + (b - a - 6) * t); y = int(bot - (bot - top) * t)
                beam[y:y + 2, x:x + 2] = True
    img[beam & fw, :3] = TIMBER[1]
    img[beam & fw & ((xs.astype(int) % 3) == 0), :3] = TIMBER[2]
    # каменный цоколь
    base = (ys >= h - 8) & (ys < h - 2)
    img[base, :3] = shade_ramp(np.clip(0.4 + (value_noise(w, h, 3, seed=seed + 2) - .5) * .8, 0, 1), STONE[:4])[base]
    img[h - 2:h, :, 3] = 0

    # Окна по этажам; часть горит
    sh = wall_h / storeys
    door_bay = int(rng.integers(0, len(bounds) - 1))
    for si in range(storeys):
        wy = int(y0 + sh * si + sh * 0.3)
        for bi, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
            if si == storeys - 1 and bi == door_bay:
                # дверь с аркой
                dx = (a + b) // 2 - 6; dy = h - 2 - 22
                img[dy:h - 2, dx:dx + 12, :3] = WOOD[1]; img[dy:h - 2, dx:dx + 12, 3] = 255
                img[dy:dy + 2, dx + 2:dx + 10, :3] = WOOD[2]
                for k in range(dx + 2, dx + 12, 3):
                    img[dy + 2:h - 2, k, :3] = WOOD[0]
                img[dy + 12, dx + 9, :3] = hexc("#c8a040")
                continue
            ww, wh = 10, 12
            wx = (a + b) // 2 - ww // 2
            img[wy - 1:wy + wh + 1, wx - 1:wx + ww + 1, :3] = TIMBER[0]
            on = rng.random() < 0.6
            if on:
                gy = np.linspace(0, 1, wh)[:, None]
                for k in range(wh):
                    img[wy + k, wx:wx + ww, :3] = WIN_LIT[1] * (1 - gy[k]) + WIN_LIT[2] * gy[k]
                lit.append((wx + ww // 2, wy + wh // 2))
            else:
                img[wy:wy + wh, wx:wx + ww, :3] = WIN_DARK
                img[wy + 1:wy + 3, wx + 1:wx + 4, :3] = hexc("#2a3048")    # отблеск луны
            img[wy + wh // 2, wx:wx + ww, :3] = TIMBER[0]                 # переплёт
            img[wy:wy + wh, wx + ww // 2, :3] = TIMBER[0]
            img[wy + wh + 1:wy + wh + 3, wx - 2:wx + ww + 2, :3] = WOOD[3]  # подоконник
            if rng.random() < 0.3:   # цветы в ящике
                for k in range(wx - 1, wx + ww + 1, 2):
                    img[wy + wh, k, :3] = [hexc("#a03050"), hexc("#d0b040"), hexc("#3a6040")][k % 3]
    # вывеска на кронштейне у некоторых
    if rng.random() < 0.4:
        sx = 4; sy = y0 + 10
        img[sy:sy + 2, sx:sx + 12, :3] = TIMBER[0]; img[sy:sy + 2, sx:sx + 12, 3] = 255
        img[sy + 2:sy + 10, sx + 4:sx + 13, :3] = WOOD[3]; img[sy + 2:sy + 10, sx + 4:sx + 13, 3] = 255
        img[sy + 4:sy + 8, sx + 6:sx + 11, :3] = hexc("#c8a040")
    out = outline(img.astype(np.uint8), "#07060c")
    return out, lit, chimney


# ---------------- ЗАМОК ----------------
def castle(w=560, h=340):
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    nz = value_noise(w, h, 4, seed=51, octaves=3)
    lit = []

    def masonry(mask, light, dark=0.0):
        brick = ((ys.astype(int) % 7) == 0) | (((xs.astype(int) + (ys.astype(int) // 7) * 6) % 12) == 0)
        v = light + (nz - 0.5) * 0.4 - brick * 0.2 - dark
        c = shade_ramp(np.clip(v, 0, 1), STONE)
        img[mask, :3] = c[mask]; img[mask, 3] = 255

    def crenel(x0, x1, y, step=8):
        for x in range(int(x0), int(x1), step):
            img[y - 6:y, x:x + 5, :3] = STONE[3]; img[y - 6:y, x:x + 5, 3] = 255
            img[y - 6, x:x + 5, :3] = STONE[5]

    def window(x, y, wwid=5, whgt=9, on=True):
        img[y - 1:y + whgt + 1, x - 1:x + wwid + 1, :3] = STONE[0]
        img[y - 1:y + whgt + 1, x - 1:x + wwid + 1, 3] = 255
        if on:
            img[y:y + whgt, x:x + wwid, :3] = WIN_LIT[0]
            img[y + 1:y + whgt - 1, x + 1:x + wwid - 1, :3] = WIN_LIT[1]
            lit.append((x + wwid // 2, y + whgt // 2))
        else:
            img[y:y + whgt, x:x + wwid, :3] = WIN_DARK
        img[y - 2, x:x + wwid, :3] = STONE[0]

    def tower(cx, top, bot, r, roof_h):
        m = (np.abs(xs - cx) <= r) & (ys >= top) & (ys < bot)
        # цилиндр: свет слева, тень справа
        masonry(m, 0.62 - (xs - cx) / r * 0.3)
        # коническая крыша
        for y in range(int(top - roof_h), int(top)):
            t = (y - (top - roof_h)) / roof_h
            hw = int((r + 3) * t)
            for x in range(int(cx - hw), int(cx + hw) + 1):
                if 0 <= x < w and 0 <= y < h:
                    k = 4 - int((x - cx + hw) / max(1, 2 * hw) * 4)
                    k = int(np.clip(k + (BAYER4[y % 4, x % 4] > 0.5), 0, 4))
                    img[y, x, :3] = ROOF_A[k]; img[y, x, 3] = 255
        # флаг
        fy = int(top - roof_h)
        img[fy - 12:fy, int(cx), :3] = STONE[1]; img[fy - 12:fy, int(cx), 3] = 255
        img[fy - 12:fy - 6, int(cx) + 1:int(cx) + 10, :3] = hexc("#8a1c24"); img[fy - 12:fy - 6, int(cx) + 1:int(cx) + 10, 3] = 255
        img[fy - 11:fy - 7, int(cx) + 4:int(cx) + 6, :3] = hexc("#d8a838")
        for wy in range(int(top) + 14, int(bot) - 20, 26):
            window(int(cx) - 2, wy, 5, 9, on=(wy // 26 + int(cx)) % 3 != 0)

    cx = w // 2
    # крепостная стена
    wall = (ys >= 200) & (ys < h) & (xs >= 20) & (xs < w - 20)
    masonry(wall, 0.48, (ys - 200) / 400)
    crenel(20, w - 20, 200)
    # главная башня-донжон
    keep = (np.abs(xs - cx) <= 90) & (ys >= 90) & (ys < 260)
    masonry(keep, 0.58 - (xs - cx) / 90 * 0.18)
    crenel(cx - 90, cx + 90, 90, 10)
    # высокий шпиль
    tower(cx, 40, 120, 22, 46)
    # угловые башни
    tower(cx - 110, 120, 280, 26, 50)
    tower(cx + 110, 120, 280, 26, 50)
    tower(40, 170, h, 24, 44)
    tower(w - 40, 170, h, 24, 44)
    # окна донжона: ряды, большинство горит
    rng = np.random.default_rng(52)
    for wy in (112, 150, 188):
        for wx in range(cx - 74, cx + 74, 18):
            if abs(wx - cx) < 18 and wy > 150:
                continue
            window(wx, wy, 6, 11, on=rng.random() < 0.7)
    # окна в стене
    for wx in list(range(80, cx - 140, 24)) + list(range(cx + 146, w - 80, 24)):
        window(wx, 236, 5, 8, on=rng.random() < 0.5)
    # ворота: арка, решётка, тёплый свет изнутри
    gx0, gx1, gy0 = cx - 24, cx + 24, 268
    gate = (xs >= gx0) & (xs < gx1) & (ys >= gy0) & (ys < h)
    arch = ((xs - cx) ** 2 / 24 ** 2 + (ys - gy0) ** 2 / 18 ** 2) < 1
    gm = gate | (arch & (ys < gy0 + 1) & (ys > gy0 - 18))
    inner = 0.4 + (ys - gy0 + 18) / 90
    img[gm, :3] = (WIN_LIT[2] * 0.45)[None] * np.clip(inner[gm], 0.3, 1)[:, None]
    img[gm, 3] = 255
    portc = gm & (((xs.astype(int) - gx0) % 6 == 0) | ((ys.astype(int) - gy0) % 7 == 0))
    img[portc, :3] = TIMBER[0]
    lit.append((cx, gy0 + 30))
    # гербовые знамёна по бокам ворот
    for bx in (cx - 46, cx + 34):
        img[220:262, bx:bx + 12, :3] = hexc("#6e1820"); img[220:262, bx:bx + 12, 3] = 255
        img[220:262, bx:bx + 2, :3] = hexc("#8a2028")
        img[236:244, bx + 3:bx + 9, :3] = hexc("#d8a838")
        img[262:266, bx + 2:bx + 10, :3] = hexc("#6e1820"); img[262:266, bx + 2:bx + 10, 3] = 255
    out = outline(img.astype(np.uint8), "#07060c")
    return out, lit


# ---------------- ПРЕДМЕТЫ ----------------
def stall(seed, cloth):
    """Лоток базара: навес в полоску, прилавок с товаром."""
    rng = np.random.default_rng(seed)
    w, h = 56, 50
    img = np.zeros((h, w, 4), np.float32)
    # стойки
    for x in (4, w - 6):
        img[14:h - 2, x:x + 2, :3] = WOOD[1]; img[14:h - 2, x:x + 2, 3] = 255
    # прилавок
    img[30:h - 2, 2:w - 2, :3] = WOOD[2]; img[30:h - 2, 2:w - 2, 3] = 255
    img[30:32, 2:w - 2, :3] = WOOD[4]
    for x in range(4, w - 4, 7):
        img[32:h - 2, x, :3] = WOOD[1]
    # товар: яблоки, тыквы, горшки, рыба
    kind = seed % 4
    for i in range(9):
        gx = 6 + i * 5 + int(rng.integers(-1, 2)); gy = 25 + int(rng.integers(-1, 2))
        col = [[hexc("#8a2020"), hexc("#b03a2a")], [hexc("#b0601a"), hexc("#d0802a")],
               [hexc("#5a4a3a"), hexc("#7a6650")], [hexc("#6a7a88"), hexc("#9aa8b4")]][kind]
        img[gy:gy + 5, gx:gx + 5, :3] = col[0]; img[gy:gy + 5, gx:gx + 5, 3] = 255
        img[gy, gx + 1:gx + 3, :3] = col[1]
    # навес в полоску, вид сверху под углом
    for y in range(0, 20):
        sag = int(2 * np.sin(np.pi * y / 20))
        for x in range(0, w):
            stripe = ((x + y // 3) // 7) % 2
            k = 2 - int(y / 10)
            c = cloth[np.clip(k, 0, 2)] if stripe else CLOTH_LIGHT[np.clip(k, 0, 2)]
            img[y + sag, x, :3] = c; img[y + sag, x, 3] = 255
    # фестоны по краю
    for x in range(0, w, 6):
        img[20:23, x + 1:x + 5, :3] = cloth[1]; img[20:23, x + 1:x + 5, 3] = 255
    return outline(img.astype(np.uint8), "#07060c")


def lamp():
    w, h = 14, 48
    img = np.zeros((h, w, 4), np.float32)
    img[10:h - 2, 6:8, :3] = TIMBER[1]; img[10:h - 2, 6:8, 3] = 255
    img[h - 4:h - 1, 4:10, :3] = TIMBER[0]; img[h - 4:h - 1, 4:10, 3] = 255
    img[2:12, 3:11, :3] = TIMBER[0]; img[2:12, 3:11, 3] = 255
    img[4:10, 4:10, :3] = WIN_LIT[0]; img[5:9, 5:9, :3] = WIN_LIT[1]
    img[0:2, 4:10, :3] = TIMBER[1]; img[0:2, 4:10, 3] = 255
    return outline(img.astype(np.uint8), "#07060c")


def well():
    w, h = 40, 36
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    outer = ellipse_d(xs, ys, 20, 22, 18, 12) < 1
    inner = ellipse_d(xs, ys, 20, 20, 12, 7) < 1
    brick = ((xs.astype(int) + (ys.astype(int) // 4) * 3) % 7 == 0) | (ys.astype(int) % 4 == 0)
    v = 0.6 - (ys - 10) / 30 - brick * 0.2
    c = shade_ramp(np.clip(v, 0, 1), STONE)
    img[outer, :3] = c[outer]; img[outer, 3] = 255
    img[inner, :3] = hexc("#06080e")
    img[inner & (ys > 22), :3] = hexc("#1a2440")         # блик воды
    # ворот с крышей
    img[2:20, 4:6, :3] = WOOD[1]; img[2:20, 4:6, 3] = 255
    img[2:20, w - 6:w - 4, :3] = WOOD[1]; img[2:20, w - 6:w - 4, 3] = 255
    img[0:4, 2:w - 2, :3] = ROOF_B[2]; img[0:4, 2:w - 2, 3] = 255
    img[8:10, 6:w - 6, :3] = WOOD[3]; img[8:10, 6:w - 6, 3] = 255
    img[10:16, 19:21, :3] = CLOTH_LIGHT[0]; img[10:16, 19:21, 3] = 255
    return outline(img.astype(np.uint8), "#07060c")


def barrel():
    w, h = 14, 18
    img = np.zeros((h, w, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    body = ellipse_d(xs, ys, 7, 9, 6.5, 8.5) < 1
    v = 0.7 - np.abs(xs - 5) / 8
    c = shade_ramp(np.clip(v, 0, 1), WOOD)
    img[body, :3] = c[body]; img[body, 3] = 255
    for y in (4, 13):
        img[y, 1:w - 1, :3] = TIMBER[0]
    img[1:4, 3:11, :3] = WOOD[4]
    return outline(img.astype(np.uint8), "#07060c")


def crate():
    w, h = 16, 16
    img = np.zeros((h, w, 4), np.float32)
    img[2:h, 0:w, :3] = WOOD[2]; img[2:h, :, 3] = 255
    img[0:5, 0:w, :3] = WOOD[4]; img[0:5, :, 3] = 255
    img[2:h, 0, :3] = WOOD[1]; img[2:h, w - 1, :3] = WOOD[1]
    for k in range(0, 11):
        img[5 + k, k + 2, :3] = WOOD[1]
    return outline(img.astype(np.uint8), "#07060c")


# ---------------- РАСКЛАДКА ----------------
HOUSES = [  # w, wall_h, roof_h, storeys, roof
    (100, 44, 46, 1, ROOF_A), (116, 64, 52, 2, ROOF_B), (132, 46, 54, 1, ROOF_A),
    (148, 70, 58, 2, ROOF_A), (124, 60, 50, 2, ROOF_B), (96, 48, 44, 1, ROOF_B),
]


def layout(house_meta):
    rng = np.random.default_rng(61)
    occupied = []

    def free_rect(x0, y0, x1, y1):
        if x0 < 10 or x1 > W - 10 or y1 > H - 10 or y0 < CASTLE_BASE + 30:
            return False
        # не на улицах и площади (с запасом)
        if x1 > STREET_X - STREET_W / 2 - 14 and x0 < STREET_X + STREET_W / 2 + 14:
            return False
        if y1 > CROSS_Y - CROSS_W / 2 - 14 and y0 < CROSS_Y + CROSS_W / 2 + 14:
            return False
        px, py, rx, ry = PLAZA
        nx = np.clip(px, x0, x1); ny = np.clip(py, y0, y1)
        if ((nx - px) / (rx + 24)) ** 2 + ((ny - py) / (ry + 24)) ** 2 < 1:
            return False
        for (a, b, c, d) in occupied:
            if x0 < c + 8 and x1 > a - 8 and y0 < d + 6 and y1 > b - 6:
                return False
        return True

    houses = []
    # дома рядами вдоль улиц: «низ» дома (его y) выровнен по краю улицы
    for row_y in [CROSS_Y - CROSS_W / 2 - 18, H - 20] + list(range(440, 1200, 84)):
        x = 20
        while x < W - 40:
            v = int(rng.integers(0, len(HOUSES)))
            hw, hh = house_meta[v]["w"], house_meta[v]["h"]
            bx, by = x, row_y
            if free_rect(bx, by - hh, bx + hw, by):
                houses.append({"v": v, "x": int(bx + hw / 2), "y": int(by)})
                occupied.append((bx, by - hh, bx + hw, by))
                x += hw + int(rng.integers(8, 24))
            else:
                x += 24
    lamps = []
    for y in range(CASTLE_BASE + 80, H, 150):
        if abs(y - PLAZA[1]) < PLAZA[3] + 20:
            continue
        lamps.append({"x": STREET_X - STREET_W // 2 - 4, "y": y})
        lamps.append({"x": STREET_X + STREET_W // 2 + 4, "y": y + 75})
    for x in range(60, W, 170):
        if abs(x - STREET_X) > 100:
            lamps.append({"x": x, "y": CROSS_Y - CROSS_W // 2 - 4})
            lamps.append({"x": x + 85, "y": CROSS_Y + CROSS_W // 2 + 4})
    # лотки по кругу площади
    stalls = []
    px, py, rx, ry = PLAZA
    for k in range(10):
        a = -np.pi / 2 + k / 10 * 2 * np.pi + 0.3
        if abs(np.cos(a)) < 0.25 and np.sin(a) > 0:   # проход на юг свободен
            continue
        if k % 3 == 1:  # фонари между лотками
            lamps.append({"x": int(px + np.cos(a + 0.3) * rx * 0.95), "y": int(py + np.sin(a + 0.3) * ry * 0.95 + 10)})
        stalls.append({"v": k % 3, "x": int(px + np.cos(a) * rx * 0.72), "y": int(py + np.sin(a) * ry * 0.72 + 20)})
    props = []
    for (hx, hy) in [(h["x"], h["y"]) for h in houses]:
        if rng.random() < 0.35:
            props.append({"k": "barrel" if rng.random() < 0.6 else "crate", "x": int(hx + rng.integers(-50, 50)), "y": int(hy + 8)})
    return {"w": W, "h": H, "street": [STREET_X, STREET_W], "cross": [CROSS_Y, CROSS_W], "plaza": list(PLAZA),
            "castle": {"x": W // 2, "y": CASTLE_BASE, "gate": [W // 2, CASTLE_BASE - 4]},
            "houses": houses, "lamps": lamps, "stalls": stalls, "props": props,
            "well": [px, py + 6], "west_gate": [0, CROSS_Y], "spawn": [60, CROSS_Y]}


def build():
    save(ground(), "city_ground.png")
    meta = []
    for i, (w, wh, rh, st, roof) in enumerate(HOUSES):
        img, lit, chim = house(70 + i, w, wh, rh, st, roof)
        save(img, f"house{i}.png")
        meta.append({"w": w, "h": img.shape[0], "lit": lit, "chimney": chim, "wall": wh})
    cimg, clit = castle()
    save(cimg, "castle.png")
    for i, cl in enumerate(CLOTH):
        save(stall(80 + i, cl), f"stall{i}.png")
    save(lamp(), "lamp.png"); save(well(), "well.png"); save(barrel(), "barrel.png"); save(crate(), "crate.png")
    lay = layout(meta)
    lay["houseMeta"] = meta
    lay["castleMeta"] = {"w": cimg.shape[1], "h": cimg.shape[0], "lit": clit}
    with open(os.path.join(OUT, "city_layout.json"), "w") as f:
        json.dump(lay, f, separators=(",", ":"), default=int)


if __name__ == "__main__":
    build()
    print("city ok")
