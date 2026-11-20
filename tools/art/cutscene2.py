"""Катсцены между главами.
Глава II «Остенград»: ночной город, луна, замок на холме, крыши с горящими окнами (референс 6).
Глава III «Цитадель»: фиолетовая буря, крепость на скале, огни факелов (референс 3)."""
import numpy as np
from common import ramp, value_noise, shade_ramp, rgba, save, hexc, BAYER4

W, H = 640, 300
NIGHT = ramp("#0a0c1e", "#10142c", "#161c3a", "#1e2648", "#283258", "#344068")
PURPLE = ramp("#0e0818", "#160c24", "#201232", "#2c1a42", "#3a2254", "#4c2c68", "#603a7c")
SIL = ramp("#06060e", "#0b0b18", "#111222", "#181a2e")
ROOF = ramp("#0e0c18", "#161424", "#1e1a30", "#28223c")
WIN = [hexc("#ffcf6a"), hexc("#ffe7a8"), hexc("#e89a3a")]


def sky(rmp, seed, moon=None, stars=160):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    v = ys / H * 1.05 + (value_noise(W, H, 70, seed=seed, octaves=3) - 0.5) * 0.18
    img = shade_ramp(np.clip(v, 0, 1), rmp)
    rng = np.random.default_rng(seed)
    for _ in range(stars):
        x, y = rng.integers(0, W), rng.integers(0, int(H * 0.55))
        img[y, x] = hexc("#c8d0f0") if rng.random() < 0.7 else hexc("#ffffff")
    if moon:
        mx, my, r = moon
        d = np.hypot(xs - mx, ys - my)
        halo = np.clip(1 - (d - r) / 60, 0, 1) ** 2 * 0.35
        img = img * (1 - halo[..., None]) + hexc("#8a96c8") * halo[..., None]
        disc = d < r
        crater = value_noise(W, H, 5, seed=seed + 3, octaves=2)
        mc = shade_ramp(np.clip(0.75 + (crater - 0.5) * 0.5 - (xs - mx) / r * 0.15, 0, 1),
                        ramp("#9aa0c0", "#b8bed8", "#d4d8ec", "#eef0fa"))
        img[disc] = mc[disc]
    # облака: полосы шума, подсвеченные снизу
    cl = value_noise(W, H, 50, seed=seed + 5, octaves=5)
    band = np.exp(-((ys - H * 0.3) / 50) ** 2)
    cm = (cl * band) > 0.42
    cc = shade_ramp(np.clip((cl - 0.4) * 2.2, 0, 1), rmp[1:5] if len(rmp) > 5 else rmp)
    img[cm] = cc[cm]
    return rgba(img, np.ones((H, W)))


def hill_castle(base_y=170, cx=430):
    """Силуэт замка на холме с огоньками окон."""
    img = np.zeros((H, W, 4), np.float32)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    hill = ys > base_y + 40 - 70 * np.exp(-((xs - cx) / 120) ** 2) + (value_noise(W, 1, 30, seed=7)[0] - 0.5) * 12
    img[hill, :3] = SIL[1]; img[hill, 3] = 255
    rng = np.random.default_rng(8)
    top = base_y - 30
    def rect(x0, x1, y0, y1, c=SIL[2]):
        img[int(y0):int(y1), int(x0):int(x1), :3] = c; img[int(y0):int(y1), int(x0):int(x1), 3] = 255
    rect(cx - 70, cx + 70, top + 20, base_y + 10)
    for k in range(int(cx - 70), int(cx + 70), 8):
        rect(k, k + 4, top + 15, top + 20)
    rect(cx - 25, cx + 25, top - 30, top + 20)
    for tx, th in ((cx - 80, 70), (cx + 80, 60), (cx - 30, 110), (cx + 30, 95), (cx, 140)):
        rect(tx - 7, tx + 7, base_y + 10 - th, base_y + 10)
        for y in range(int(base_y + 10 - th - 18), int(base_y + 10 - th)):
            hw = (y - (base_y + 10 - th - 18)) / 18 * 9
            img[y, int(tx - hw):int(tx + hw) + 1, :3] = SIL[3]; img[y, int(tx - hw):int(tx + hw) + 1, 3] = 255
    for _ in range(40):
        x = int(rng.integers(cx - 85, cx + 85)); y = int(rng.integers(top - 25, base_y + 5))
        if img[y, x, 3] and img[y - 1, x, 3]:
            img[y:y + 2, x, :3] = WIN[int(rng.integers(0, 3))]
    return img.astype(np.uint8)


def rooftops(seed, base, hmin, hmax, shade, win_p):
    """Ряд домов: крутые крыши, трубы, горящие окна."""
    rng = np.random.default_rng(seed)
    img = np.zeros((H, W, 4), np.float32)
    x = -10
    while x < W + 10:
        w = int(rng.integers(28, 60)); wall = int(rng.integers(hmin, hmax)); roof = int(w * rng.uniform(0.45, 0.7))
        y0 = base - wall
        img[y0:H, max(0, x):min(W, x + w), :3] = ROOF[shade]; img[y0:H, max(0, x):min(W, x + w), 3] = 255
        for y in range(y0 - roof, y0):
            t = (y - (y0 - roof)) / roof
            hw = int(w / 2 * t) + 1
            a, b = max(0, x + w // 2 - hw), min(W, x + w // 2 + hw)
            img[y, a:b, :3] = ROOF[max(0, shade - 1)]; img[y, a:b, 3] = 255
            # лунный блик на левом скате
            img[y, a:min(b, a + 2), :3] = ROOF[min(3, shade + 1)]
        if rng.random() < 0.6:
            cx = x + int(w * rng.uniform(0.2, 0.7))
            img[y0 - roof // 2 - 10:y0 - roof // 2 + 4, max(0, cx):min(W, cx + 5), :3] = ROOF[shade]
            img[y0 - roof // 2 - 10:y0 - roof // 2 + 4, max(0, cx):min(W, cx + 5), 3] = 255
        for wy in range(y0 + 6, H - 6, 16):
            for wx in range(x + 5, x + w - 6, 11):
                if 0 <= wx < W - 4 and rng.random() < win_p:
                    c = WIN[int(rng.integers(0, 3))]
                    img[wy:wy + 6, wx:wx + 4, :3] = c
                    img[wy + 3, wx:wx + 4, :3] = ROOF[0]
        x += w + int(rng.integers(-4, 3))
    return img.astype(np.uint8)


def street_front():
    """Ближний план: брусчатка и два фонаря."""
    img = np.zeros((H, W, 4), np.float32)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    ground = ys > 262
    v = 0.3 + (value_noise(W, H, 4, seed=12, octaves=2) - 0.5) * 0.6 - (ys - 262) / 120
    img[ground, :3] = shade_ramp(np.clip(v, 0, 1), NIGHT[:4])[ground]; img[ground, 3] = 255
    for lx in (120, 520):
        img[200:270, lx:lx + 3, :3] = SIL[0]; img[200:270, lx:lx + 3, 3] = 255
        img[186:202, lx - 5:lx + 8, :3] = SIL[0]; img[186:202, lx - 5:lx + 8, 3] = 255
        img[189:199, lx - 3:lx + 6, :3] = WIN[0]; img[191:197, lx - 1:lx + 4, :3] = WIN[1]
        d = np.hypot(xs - lx - 1, ys - 194)
        glow = np.clip(1 - d / 40, 0, 1) ** 2 * 0.5
        a = np.floor(glow * 6 + (BAYER4[ys.astype(int) % 4, xs.astype(int) % 4] - 0.5) * 0.9) / 6
        m = (img[..., 3] == 0) & (a > 0)
        img[m, :3] = WIN[2]; img[m, 3] = a[m] * 255
    return img.astype(np.uint8)


def fog(y0, thick, alpha, seed, color):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    n = value_noise(W, H, 40, seed=seed, octaves=4)
    a = np.exp(-((ys - y0) / thick) ** 2) * (0.5 + n * 0.8) * alpha
    a = np.floor(a * 6 + (BAYER4[ys.astype(int) % 4, xs.astype(int) % 4] - .5) * .9) / 6
    return rgba(np.ones((H, W, 3)) * hexc(color), np.clip(a, 0, 1))


def cliffs():
    """Скала-утёс под цитаделью и дальние зубцы гор."""
    img = np.zeros((H, W, 4), np.float32)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    far = ys > 210 - (np.abs(value_noise(W, 1, 60, seed=21, octaves=5)[0] - 0.5) * 2) * 90
    img[far, :3] = PURPLE[2]; img[far, 3] = 255
    # утёс: шире книзу
    cx = 360
    edge = 120 + (ys - 140) * 0.6 + (value_noise(1, H, 10, seed=22, octaves=3)[:, 0:1] - 0.5) * 30
    m = (np.abs(xs - cx) < edge) & (ys > 140)
    rv = 0.4 - (xs - cx) / 300 + (value_noise(W, H, 8, seed=23, octaves=3) - 0.5) * 0.5 - (ys - 140) / 400
    img[m, :3] = shade_ramp(np.clip(rv, 0, 1), PURPLE[:5])[m]; img[m, 3] = 255
    return img.astype(np.uint8)


def fortress_sil():
    """Полуразрушенная цитадель на утёсе: башни, проломы, факелы."""
    img = np.zeros((H, W, 4), np.float32)
    rng = np.random.default_rng(31)
    cx, base = 360, 146
    tex = value_noise(W, H, 3, seed=33, octaves=2)
    def rect(x0, x1, y0, y1, c):
        # свет слева (от луны за спиной зрителя), тень справа, кладка
        lvl = int(np.argmin(np.abs(PURPLE - c).sum(1)))
        for x in range(int(x0), int(x1)):
            t = (x - x0) / max(1, x1 - x0)
            for y in range(int(y0), int(y1)):
                k = lvl + 2 - int(t * 3.2) + (1 if tex[y, x] > 0.62 else 0) - (1 if (y % 6 == 0) else 0)
                img[y, x, :3] = PURPLE[int(np.clip(k, 0, 6))]; img[y, x, 3] = 255
    rect(cx - 110, cx + 110, base - 40, base + 4, PURPLE[1])
    for k in range(cx - 110, cx + 110, 9):
        if rng.random() < 0.8:
            rect(k, k + 5, base - 46 + int(rng.integers(0, 4)), base - 40, PURPLE[1])
    rect(cx - 30, cx + 30, base - 100, base, PURPLE[2])
    rect(cx - 3, cx + 3, base - 140, base - 100, PURPLE[2])
    for tx, th, ruined in ((cx - 115, 80, False), (cx + 115, 70, True), (cx - 55, 95, False), (cx + 55, 85, False)):
        rect(tx - 9, tx + 9, base - th, base + 4, PURPLE[2])
        if ruined:
            for x in range(tx - 9, tx + 9):
                img[base - th:base - th + int(rng.integers(0, 14)), x, 3] = 0
        else:
            for k in range(tx - 9, tx + 9, 5):
                rect(k, k + 3, base - th - 4, base - th, PURPLE[2])
    # огни: окна и факелы
    lights = []
    for _ in range(26):
        x = int(rng.integers(cx - 120, cx + 120)); y = int(rng.integers(base - 95, base - 2))
        if img[y, x, 3] and img[y - 2, x, 3]:
            img[y:y + 3, x:x + 2, :3] = WIN[int(rng.integers(0, 3))]
            lights.append((x, y))
    # тёплое свечение у огней
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    for (x, y) in lights[:14]:
        d = np.hypot(xs - x, ys - y)
        g = np.clip(1 - d / 10, 0, 1) * 0.5
        a = np.floor(g * 5 + (BAYER4[ys.astype(int) % 4, xs.astype(int) % 4] - 0.5) * 0.9) / 5
        m = (img[..., 3] == 0) & (a > 0)
        img[m, :3] = WIN[2]; img[m, 3] = a[m] * 200
    return img.astype(np.uint8)


def build():
    save(sky(NIGHT, 41, moon=(150, 70, 26)), "cs2_sky.png")
    save(hill_castle(), "cs2_castle.png")
    save(fog(200, 26, 0.5, 43, "#8a90c0"), "cs2_fog.png")
    save(rooftops(44, 230, 20, 40, 1, 0.25), "cs2_roofs_far.png")
    save(rooftops(45, 262, 30, 60, 0, 0.18), "cs2_roofs_near.png")
    save(street_front(), "cs2_street.png")
    save(sky(PURPLE, 51, moon=(470, 60, 34), stars=60), "cs3_sky.png")
    save(cliffs(), "cs3_cliffs.png")
    save(fortress_sil(), "cs3_fortress.png")
    save(fog(170, 30, 0.55, 52, "#a080c8"), "cs3_fog_far.png")
    save(fog(260, 30, 0.6, 53, "#b090d8"), "cs3_fog_near.png")


if __name__ == "__main__":
    build()
    print("cutscene2 ok")
