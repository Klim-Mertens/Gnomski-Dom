"""Цитадель Регента: вид под углом (изометрия), фиолетовые тона, факелы у дверей (референс 3).
Пол рисуется одной большой картинкой, стены — отдельными блоками, чтобы игра могла
сортировать их по глубине вместе с персонажами. Раскладка — в fortress_layout.json."""
import json
import os
import numpy as np
from common import ramp, value_noise, shade_ramp, rgba, outline, save, hexc, OUT, BAYER4

N = 30                 # клеток по каждой оси
TW, TH = 32, 16        # размер ромба клетки
PAD_TOP = 120          # место сверху под высокие стены и башни
OX = N * TW // 2 + 32  # где центр клетки (0,0)
OY = PAD_TOP
WW = N * TW + 64
WH = N * TH + PAD_TOP + 120

FLOOR = ramp("#1a1426", "#221a32", "#2b2140", "#352a4e", "#41345e", "#4f406e")
MOSS = ramp("#1a2226", "#22302e", "#2c3e36")
WALL_L = ramp("#241c36", "#2f2546", "#3b3056", "#483b68", "#56487a", "#66588c")   # грань к свету
WALL_R = ramp("#140f20", "#1b142a", "#231a36", "#2c2142", "#352a4e")               # теневая грань
WALL_T = ramp("#3a3050", "#4a3e64", "#5a4e78", "#6c5e8c")
CLIFF = ramp("#0c0a14", "#130f1e", "#1a1528", "#221b34", "#2b2240")
WOOD = ramp("#1a100e", "#2a1a14", "#3a261c", "#4c3426")
WIN = [hexc("#ffb050"), hexc("#ffe0a0")]


def iso(i, j):
    return OX + (i - j) * TW / 2, OY + (i + j) * TH / 2


# ---------------- КАРТА ----------------
def build_map():
    """0 — пустота, 1 — пол, 'стены' задаются отдельным списком блоков."""
    floor = np.zeros((N, N), np.int8)
    floor[2:28, 2:28] = 1
    # неровный край плато
    rng = np.random.default_rng(91)
    for i in range(N):
        for j in range(N):
            if floor[i, j] and (i in (2, 27) or j in (2, 27)) and rng.random() < 0.35:
                floor[i, j] = 0
    floor[13:16, 27:30] = 1          # мост-подход с юга (к городу)
    blocks = []

    def add(i, j, t):
        blocks.append({"i": i, "j": j, "t": t})

    lo, hi = 5, 24
    for k in range(lo, hi + 1):
        # задние стены (их видно целиком): высокие, с окнами
        add(k, lo, "win" if k % 4 == 2 else "hi")
        if k != lo:
            add(lo, k, "win" if k % 4 == 0 else "hi")
    # передние стены — разрушенные, низкие, с проломами (чтобы не закрывать двор)
    for k in range(lo + 1, hi + 1):
        if k not in (13, 14, 15) and rng.random() < 0.75:
            add(k, hi, "lo")
        if rng.random() < 0.7:
            add(hi, k, "lo")
    # угловые башни
    for (i, j) in ((lo, lo), (hi, lo), (lo, hi), (hi, hi)):
        blocks[:] = [b for b in blocks if not (b["i"] == i and b["j"] == j)]
        add(i, j, "tower")
    # Донжон Регента: глухой блок с дверью и факелами
    for i in range(10, 18):
        for j in range(8, 13):
            if i in (10, 17) or j in (8, 12):
                t = "hi"
                if j == 12 and i == 14:
                    t = "door"
                elif j == 12 and i in (11, 16):
                    t = "win"
                elif i == 17 and j == 10:
                    t = "win_r"
                add(i, j, t)
    for (i, j) in ((10, 8), (17, 8), (10, 12), (17, 12)):
        blocks[:] = [b for b in blocks if not (b["i"] == i and b["j"] == j)]
        add(i, j, "tower")
    # руины внутри двора
    for (i, j) in ((7, 17), (8, 17), (8, 18), (20, 16), (20, 17), (19, 20), (12, 20)):
        add(i, j, "lo")
    blocks.sort(key=lambda b: (b["i"] + b["j"], b["i"]))
    return floor, blocks


# ---------------- ПОЛ ----------------
def floor_image(floor):
    img = np.zeros((WH, WW, 4), np.float32)
    ys, xs = np.mgrid[0:WH, 0:WW].astype(np.float32)
    # обратное преобразование: из пикселя в клетку
    u = (xs - OX) / (TW / 2); v = (ys - OY) / (TH / 2)
    fi = (u + v) / 2 + 0.5; fj = (v - u) / 2 + 0.5
    ii, jj = np.floor(fi).astype(int), np.floor(fj).astype(int)
    inside = (ii >= 0) & (ii < N) & (jj >= 0) & (jj < N)
    on = np.zeros_like(inside)
    on[inside] = floor[ii[inside], jj[inside]] == 1
    rng = np.random.default_rng(92)
    tone = rng.random((N, N))
    n1 = value_noise(WW, WH, 40, seed=93, octaves=4)
    n2 = value_noise(WW, WH, 5, seed=94, octaves=2)
    lu, lv = fi - ii, fj - jj                     # координаты внутри клетки
    edge = (lu < 0.06) | (lv < 0.06)
    # каждая клетка — 2x2 плиты
    sub = (np.abs(lu - 0.5) < 0.03) | (np.abs(lv - 0.5) < 0.03)
    tci = np.clip(ii, 0, N - 1); tcj = np.clip(jj, 0, N - 1)
    val = 0.35 + tone[tci, tcj] * 0.25 + (n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.25 + (lu + lv - 1) * -0.08
    col = shade_ramp(np.clip(val, 0, 1), FLOOR)
    col[edge | sub] = FLOOR[0]
    moss = (n1 > 0.62) & (n2 > 0.4)
    col[moss] = shade_ramp(n2, MOSS)[moss]
    # трещины
    cracks = (np.abs(value_noise(WW, WH, 18, seed=95, octaves=3) - 0.5) < 0.012)
    col[cracks] = FLOOR[0]
    img[on, :3] = col[on]; img[on, 3] = 255

    # Обрыв под плато: для клеток, под которыми пусто, рисуем каменный срез вниз
    cliff_h = 70
    for i in range(N):
        for j in range(N):
            if not floor[i, j]:
                continue
            below_i = i + 1 >= N or not floor[i + 1, j]   # правая-нижняя грань
            below_j = j + 1 >= N or not floor[i, j + 1]   # левая-нижняя грань
            cx, cy = iso(i, j)
            depth = cliff_h + int(rng.integers(-20, 25))
            if below_j:   # грань от левого угла к нижнему
                for x in range(int(cx - TW / 2), int(cx)):
                    top = cy + (x - (cx - TW / 2)) * 0.5
                    for y in range(int(top), int(top + depth * (0.6 + 0.4 * rng.random() if x % 3 == 0 else 1))):
                        if 0 <= y < WH and img[y, x, 3] == 0:
                            k = 3 - int((y - top) / depth * 4)
                            k = int(np.clip(k + (BAYER4[y % 4, x % 4] > 0.6), 0, 4))
                            img[y, x, :3] = CLIFF[k]; img[y, x, 3] = 255
            if below_i:   # грань от нижнего угла к правому
                for x in range(int(cx), int(cx + TW / 2)):
                    top = cy + TH / 2 - (x - cx) * 0.5
                    for y in range(int(top), int(top + depth)):
                        if 0 <= y < WH and img[y, x, 3] == 0:
                            k = 2 - int((y - top) / depth * 3)
                            k = int(np.clip(k, 0, 4))
                            img[y, x, :3] = CLIFF[k]; img[y, x, 3] = 255
    return img.astype(np.uint8)


# ---------------- БЛОКИ СТЕН ----------------
def faces(hgt):
    h = TH + hgt
    ys, xs = np.mgrid[0:h, 0:TW].astype(np.float32)
    top = (np.abs(xs + 0.5 - 16) / 16 + np.abs(ys + 0.5 - 8) / 8) <= 1
    lv = ys - (8 + xs * 0.5)
    left = (xs < 16) & (lv >= 0) & (lv < hgt) & ~top
    rv = ys - (16 - (xs - 16) * 0.5)
    right = (xs >= 16) & (rv >= 0) & (rv < hgt) & ~top
    return h, xs, ys, top, left, right, lv, rv


def block(hgt, kind="hi", seed=0):
    h, xs, ys, top, left, right, lv, rv = faces(hgt)
    img = np.zeros((h, TW, 4), np.float32)
    nz = value_noise(TW, h, 4, seed=seed, octaves=2)
    # кладка: ряды по 6 px, швы со сдвигом
    def bricks(u, v):
        course = np.floor(v / 6).astype(int)
        return ((v % 6) < 1) | (((u + course * 4) % 9) < 1)
    lb = bricks(xs, lv); rb = bricks(xs - 16, rv)
    lval = 0.62 - lv / max(hgt, 1) * 0.35 + (nz - 0.5) * 0.35 - lb * 0.22
    rval = 0.5 - rv / max(hgt, 1) * 0.3 + (nz - 0.5) * 0.3 - rb * 0.25
    lc = shade_ramp(np.clip(lval, 0, 1), WALL_L); rc = shade_ramp(np.clip(rval, 0, 1), WALL_R)
    tc = shade_ramp(np.clip(0.6 + (nz - 0.5) * 0.5, 0, 1), WALL_T)
    img[left, :3] = lc[left]; img[left, 3] = 255
    img[right, :3] = rc[right]; img[right, 3] = 255
    img[top, :3] = tc[top]; img[top, 3] = 255
    # ребро между гранями светлее
    img[(xs >= 15.5) & (xs < 16.5) & (ys > 16) & (ys < 16 + hgt), :3] = WALL_L[5]
    lit = []
    if kind in ("win", "tower"):
        # окно на левой грани (горит)
        for wy in ([hgt // 2 - 6] if kind == "win" else [16, hgt - 30]):
            for x in range(6, 11):
                y0 = int(8 + x * 0.5 + wy)
                img[y0 - 1:y0 + 11, x, :3] = WALL_R[0]
                img[y0:y0 + 10, x, :3] = WIN[0] if x in (6, 10) else WIN[1]
            lit.append((8, int(8 + 8 * 0.5 + wy + 5)))
    if kind == "win_r":
        for x in range(21, 26):
            y0 = int(16 - (x - 16) * 0.5 + hgt // 2 - 6)
            img[y0 - 1:y0 + 11, x, :3] = WALL_R[0]
            img[y0:y0 + 10, x, :3] = WIN[0] if x in (21, 25) else WIN[1]
        lit.append((23, int(16 - 7 * 0.5 + hgt // 2 - 1)))
    if kind == "door":
        # арка двери на левой грани, тёплый свет из щели
        for x in range(3, 14):
            base = 8 + x * 0.5 + hgt
            dh = 26 - abs(x - 8.5) ** 2 * 0.25
            for y in range(int(base - dh), int(base)):
                img[y, x, :3] = WOOD[1] if x % 3 else WOOD[0]
            img[int(base - dh), x, :3] = WALL_T[3]
        for y in range(int(8 + 8 * 0.5 + hgt - 20), int(8 + 8 * 0.5 + hgt)):
            img[y, 8, :3] = WIN[0]
        lit.append((8, int(8 + 4 + hgt - 10)))
    if kind == "lo":
        # обломанный верх: случайные выщерблины
        rng = np.random.default_rng(seed)
        for x in range(TW):
            bite = int(rng.integers(0, 5))
            col = img[:, x, 3] > 0
            idx = np.nonzero(col)[0]
            if len(idx):
                img[idx[0]:idx[0] + bite, x, 3] = 0
    if kind == "tower":
        # зубцы по верху
        for x in range(0, TW, 6):
            for y in range(0, 6):
                if img[y + 6, x:x + 3, 3].any():
                    img[y, x:x + 3, :3] = WALL_T[2]; img[y, x:x + 3, 3] = 255
    out = outline(img.astype(np.uint8), "#06040a")
    return out, lit


def torch():
    w, h = 8, 18
    img = np.zeros((h, w, 4), np.float32)
    img[8:h, 3:5, :3] = WOOD[2]; img[8:h, 3:5, 3] = 255
    img[6:9, 2:6, :3] = hexc("#2a2230"); img[6:9, 2:6, 3] = 255
    img[1:6, 2:6, :3] = hexc("#ff9a30"); img[1:6, 2:6, 3] = 255
    img[0:4, 3:5, :3] = hexc("#ffe08a"); img[0:4, 3:5, 3] = 255
    return outline(img.astype(np.uint8), "#06040a")


def brazier():
    w, h = 20, 24
    img = np.zeros((h, w, 4), np.float32)
    img[8:12, 2:18, :3] = hexc("#2a2230"); img[8:12, 2:18, 3] = 255
    img[8:9, 2:18, :3] = hexc("#4a3e58")
    for x in (4, 10, 15):
        img[12:h, x:x + 2, :3] = hexc("#1e1828"); img[12:h, x:x + 2, 3] = 255
    img[3:8, 4:16, :3] = hexc("#ff8a2a"); img[3:8, 4:16, 3] = 255
    img[1:6, 7:13, :3] = hexc("#ffd070"); img[1:6, 7:13, 3] = 255
    return outline(img.astype(np.uint8), "#06040a")


def rubble(seed):
    rng = np.random.default_rng(seed)
    w, h = 26, 14
    img = np.zeros((h, w, 4), np.float32)
    for _ in range(9):
        x, y = int(rng.integers(1, w - 7)), int(rng.integers(3, h - 4))
        sw, sh = int(rng.integers(3, 7)), int(rng.integers(2, 4))
        img[y:y + sh, x:x + sw, :3] = WALL_L[int(rng.integers(1, 4))]; img[y:y + sh, x:x + sw, 3] = 255
        img[y, x:x + sw, :3] = WALL_T[2]
    return outline(img.astype(np.uint8), "#06040a")


HEIGHTS = {"hi": 56, "win": 56, "win_r": 56, "door": 56, "lo": 22, "tower": 92}


def build():
    floor, blocks = build_map()
    save(floor_image(floor), "fortress_floor.png")
    meta = {}
    for t, hgt in HEIGHTS.items():
        for v in range(2 if t in ("hi", "lo") else 1):
            img, lit = block(hgt, t, seed=100 + v * 7 + hgt)
            key = f"iso_{t}{v}"
            save(img, key + ".png")
            meta[key] = {"h": img.shape[0], "lit": lit}
    save(torch(), "torch.png"); save(brazier(), "brazier.png")
    save(rubble(1), "rubble0.png"); save(rubble(2), "rubble1.png")
    rng = np.random.default_rng(97)
    out_blocks = []
    for b in blocks:
        v = int(rng.integers(0, 2)) if b["t"] in ("hi", "lo") else 0
        x, y = iso(b["i"], b["j"])
        out_blocks.append({"i": b["i"], "j": b["j"], "key": f"iso_{b['t']}{v}", "x": x, "y": y + TH / 2})
    # факелы по бокам двери донжона и у ворот
    torches = []
    for (i, j) in ((13, 12), (15, 12)):
        x, y = iso(i, j)
        torches.append({"x": x - 6, "y": y - 18})
    for (i, j) in ((12, 24), (16, 24)):
        x, y = iso(i, j)
        torches.append({"x": x, "y": y - 6})
    braziers = [iso(9, 15), iso(19, 14), iso(14, 19), iso(8, 22), iso(21, 21)]
    rub = [iso(*p) for p in ((7, 16), (21, 17), (11, 21), (18, 9), (16, 22))]
    door = iso(14, 13)
    lay = {"w": WW, "h": WH, "n": N, "tw": TW, "th": TH, "ox": OX, "oy": OY,
           "floor": floor.tolist(), "blocks": out_blocks, "meta": meta, "torches": torches,
           "braziers": [{"x": x, "y": y} for x, y in braziers], "rubble": [{"x": x, "y": y} for x, y in rub],
           "spawn": list(iso(14, 27)), "exit": list(iso(14, 29)), "door": list(door)}
    with open(os.path.join(OUT, "fortress_layout.json"), "w") as f:
        json.dump(lay, f, separators=(",", ":"), default=float)


if __name__ == "__main__":
    build()
    print("fortress ok")
