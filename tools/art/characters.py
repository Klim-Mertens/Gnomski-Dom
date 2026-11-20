"""Персонажи: «бумажная кукла» со скелетом и обратной кинематикой.

Каждый кадр задаётся позой (положение бёдер, ступней, кистей, угол оружия),
а руки и ноги вычисляются автоматически. Части тела рисуются в карту меток,
потом каждой метке даётся материал (сталь, кожа, ткань...) со светом сверху-слева.
Результат — спрайт-листы 64x64 на кадр в public/assets/gfx/.
"""
import json
import math
import os
import numpy as np
from PIL import Image, ImageDraw
from common import ramp, hexc, OUT, BAYER4

S = 80          # размер кадра в игре
K = 1.4         # масштаб: позы описаны для фигуры ~30 px, рисуем крупнее и детальнее
CX = 31         # центр позы по X (в координатах позы)
GROUND = 59     # где стоят ступни (в координатах позы)
OX, OY = S / 2, S - 5   # куда попадает (CX, GROUND) в кадре


def T(p):
    return (OX + (p[0] - CX) * K, OY + (p[1] - GROUND) * K)
OUTLINE = hexc("#0d0910")

# ---------------- МАТЕРИАЛЫ ----------------
MAT = {
    # лестницы: 0 самый тёмный ... 4 самый светлый
    "steel_dark": ramp("#16161e", "#262833", "#3b3f4d", "#5a6070", "#8a92a4"),
    "steel": ramp("#22252e", "#3d4250", "#606878", "#8c95a6", "#c6ccd8"),
    "skin": ramp("#4a2a22", "#7a4a3a", "#a86a50", "#cc8c6c", "#e8b090"),
    "skin_dead": ramp("#232822", "#3a4438", "#56624f", "#76846a", "#9aa88a"),
    "hair_blond": ramp("#4a3418", "#7a5a26", "#a8823a", "#d0a850", "#ecd080"),
    "hair_grey": ramp("#3a3a3a", "#5a5a58", "#7e7e7a", "#a6a6a0", "#d0d0c8"),
    "cloak_black": ramp("#0e0c12", "#18151e", "#24202c", "#332d3c", "#463e50"),
    "cloak_red": ramp("#2a0a0e", "#4e1218", "#7a1c22", "#a42a2c", "#c84a40"),
    "cloak_green": ramp("#141c1a", "#1f2c28", "#2c3e38", "#3e544a", "#56705e"),
    "cloak_brown": ramp("#1e1612", "#30241c", "#463428", "#5e4836", "#7a6048"),
    "tabard_blue": ramp("#0e1a30", "#18294a", "#243e68", "#345a8c", "#4c7cb0"),
    "leather": ramp("#1e130e", "#33221a", "#4c3426", "#684a34", "#8a6648"),
    "cloth_rag": ramp("#1c1a16", "#2e2b24", "#444034", "#5e5848", "#7a7260"),
    "gold": ramp("#4a3010", "#7a5418", "#b08024", "#d8a838", "#f4d470"),
    "blade": ramp("#3a4048", "#6a7480", "#9aa6b4", "#c8d2dc", "#f2f6fa"),
    "wood": ramp("#24160e", "#3a2618", "#523822", "#6c4c30", "#8a6640"),
    "fur": ramp("#141216", "#24212a", "#38343e", "#4e4a56", "#6a6672"),
    "cloth_grey": ramp("#1a1c22", "#2a2d36", "#3e424e", "#565c6a", "#727a88"),
    "dress_wine": ramp("#200a14", "#3a1222", "#561c32", "#742844", "#94385a"),
    "apron": ramp("#2a2620", "#46402f", "#665c44", "#8a7e5e", "#b0a47e"),
    "fur_light": ramp("#2e2a30", "#46404a", "#605a64", "#7c7680", "#9a94a0"),
}
GLOW = {"eye_red": hexc("#ff3040"), "eye_teal": hexc("#70f4e4"), "eye_white": hexc("#f0f0e0"),
        "lamp": hexc("#ffd070")}


def rot(x, y, a):
    c, s = math.cos(a), math.sin(a)
    return x * c - y * s, x * s + y * c


def ik(base, target, l1, l2, bend=1):
    """Двухзвенная обратная кинематика: где будет локоть/колено."""
    bx, by = base
    tx, ty = target
    dx, dy = tx - bx, ty - by
    d = max(1e-3, min(math.hypot(dx, dy), l1 + l2 - 0.01))
    a = math.atan2(dy, dx)
    cos_b = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    b = math.acos(max(-1, min(1, cos_b)))
    ea = a + b * bend
    elbow = (bx + math.cos(ea) * l1, by + math.sin(ea) * l1)
    hand = (bx + math.cos(a) * d, by + math.sin(a) * d)
    return elbow, hand


class Canvas:
    """Карта меток: каждому пикселю — имя материала (или пусто)."""

    def __init__(self):
        self.labels = []          # список (материал)
        self.img = Image.new("I", (S, S), 0)
        self.d = ImageDraw.Draw(self.img)
        self.glows = []

    def _id(self, mat):
        self.labels.append(mat)
        return len(self.labels)

    def limb(self, p1, p2, w, mat):
        i = self._id(mat)
        p1, p2, w = T(p1), T(p2), w * K
        self.d.line([p1, p2], fill=i, width=int(w))
        r = w / 2 - 0.5
        for p in (p1, p2):
            self.d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=i)

    def poly(self, pts, mat):
        self.d.polygon([tuple(round(v) for v in T(q)) for q in pts], fill=self._id(mat))

    def ellipse(self, cx, cy, rx, ry, mat):
        (cx, cy), rx, ry = T((cx, cy)), rx * K, ry * K
        self.d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=self._id(mat))

    def rect(self, x, y, w, h, mat):
        (x, y), w, h = T((x, y)), max(1, round(w * K)), max(1, round(h * K))
        x, y = round(x), round(y)
        self.d.rectangle([x, y, x + w - 1, y + h - 1], fill=self._id(mat))

    def glow(self, x, y, kind, size=1):
        (x, y) = T((x, y))
        self.glows.append((x, y, kind, max(1, round(size * K))))

    def render(self):
        L = np.array(self.img, dtype=np.int32)
        out = np.zeros((S, S, 4), np.uint8)
        h, w = L.shape
        pad = np.pad(L, 1)
        up, left = pad[:-2, 1:-1], pad[1:-1, :-2]
        down, right = pad[2:, 1:-1], pad[1:-1, 2:]
        ys, xs = np.mgrid[0:h, 0:w]
        for i, mat in enumerate(self.labels, start=1):
            m = L == i
            if not m.any():
                continue
            rmp = MAT[mat]
            v = np.full((h, w), 2.0)
            v += ((up != i) | (left != i)) * 1.0            # блик сверху-слева
            v -= ((down != i) | (right != i)) * 1.0         # тень снизу-справа
            v -= ((down != i) & (right != i)) * 0.4
            # Фактура материала
            if mat.startswith("cloak") or mat in ("cloth_rag", "tabard_blue"):
                v += ((xs + (ys // 3)) % 5 == 0) * -0.6      # складки ткани
            if mat in ("steel", "steel_dark"):
                v += ((ys % 4) == 0) * -0.4                  # стыки пластин
            if mat == "fur" or mat == "fur_light":
                v += (BAYER4[ys % 4, xs % 4] - 0.5) * 0.9
            idx = np.clip(np.round(v), 0, 4).astype(int)
            col = rmp[idx]
            out[m, :3] = col[m]
            out[m, 3] = 255
        # Контур снаружи силуэта
        a = out[..., 3] > 0
        mm = np.zeros_like(a)
        mm[1:, :] |= a[:-1, :]; mm[:-1, :] |= a[1:, :]
        mm[:, 1:] |= a[:, :-1]; mm[:, :-1] |= a[:, 1:]
        mm &= ~a
        out[mm, :3] = OUTLINE.astype(np.uint8); out[mm, 3] = 255
        for x, y, kind, size in self.glows:
            xi, yi = int(round(x)), int(round(y))
            for dx in range(size):
                if 0 <= xi + dx < S and 0 <= yi < S:
                    out[yi, xi + dx, :3] = GLOW[kind].astype(np.uint8); out[yi, xi + dx, 3] = 255
        return out


# ---------------- ПОЗЫ ----------------
def pose(**kw):
    p = dict(hip=(0, 0), lean=0.0, foot_f=(3, 0), foot_b=(-3, 0), hand_f=(6, -9), hand_b=(-4, -9),
             weapon=-1.2, cloak=0.0, crouch=0, dead=False, smear=None)
    p.update(kw)
    return p


def walk_cycle(n=6):
    frames = []
    for i in range(n):
        t = i / n * 2 * math.pi
        frames.append(pose(
            hip=(0, -abs(math.sin(t)) * 1.2 + 0.6),
            foot_f=(math.sin(t) * 6, -max(0, math.cos(t)) * 3),
            foot_b=(-math.sin(t) * 6, -max(0, -math.cos(t)) * 3),
            hand_f=(5 - math.sin(t) * 3, -10), hand_b=(-3 + math.sin(t) * 3, -10),
            weapon=-1.25 + math.sin(t) * 0.08, cloak=math.sin(t) * 0.12 + 0.15, lean=0.08))
    return frames


def idle_cycle(n=4):
    return [pose(hip=(0, round(math.sin(i / n * 2 * math.pi) * 0.6 + 0.4)),
                 hand_f=(6, -10 + round(math.sin(i / n * 2 * math.pi) * 0.6)),
                 cloak=math.sin(i / n * 2 * math.pi) * 0.05) for i in range(n)]


def attack_frames(style):
    """Замах -> удар (со шлейфом) -> доводка -> возврат."""
    if style == "heavy":     # двуручник Вальдера: из-за спины широкой дугой
        return [
            pose(hand_f=(-2, -20), hand_b=(-4, -19), weapon=-2.4, lean=-0.15, foot_f=(5, 0), foot_b=(-5, 0), cloak=0.2),
            pose(hand_f=(-4, -22), hand_b=(-5, -21), weapon=-2.9, lean=-0.22, foot_f=(6, 0), foot_b=(-5, 0), cloak=0.25),
            pose(hand_f=(9, -14), hand_b=(6, -14), weapon=-0.2, lean=0.25, foot_f=(8, 0), foot_b=(-6, 0), cloak=-0.2, smear=(-2.9, -0.2)),
            pose(hand_f=(10, -6), hand_b=(7, -7), weapon=0.9, lean=0.32, foot_f=(8, 0), foot_b=(-7, 0), cloak=-0.3, smear=(-0.2, 0.9)),
            pose(hand_f=(8, -8), hand_b=(5, -9), weapon=0.7, lean=0.2, foot_f=(7, 0), foot_b=(-6, 0), cloak=-0.1),
        ]
    if style == "sword":
        return [
            pose(hand_f=(0, -18), weapon=-2.2, lean=-0.1, foot_f=(4, 0), foot_b=(-4, 0), hand_b=(4, -11)),
            pose(hand_f=(-1, -19), weapon=-2.6, lean=-0.15, foot_f=(5, 0), foot_b=(-4, 0), hand_b=(5, -11)),
            pose(hand_f=(11, -13), weapon=-0.3, lean=0.2, foot_f=(7, 0), foot_b=(-5, 0), hand_b=(5, -11), smear=(-2.6, -0.3)),
            pose(hand_f=(11, -8), weapon=0.7, lean=0.25, foot_f=(7, 0), foot_b=(-5, 0), hand_b=(5, -11), smear=(-0.3, 0.7)),
            pose(hand_f=(8, -10), weapon=0.2, lean=0.1, foot_f=(5, 0), foot_b=(-4, 0), hand_b=(5, -11)),
        ]
    # кинжалы Ярки: быстрый выпад
    return [
        pose(hand_f=(2, -11), hand_b=(-4, -13), weapon=-0.5, lean=-0.05, foot_f=(3, 0), foot_b=(-5, 0)),
        pose(hand_f=(0, -12), hand_b=(-5, -14), weapon=-0.9, lean=-0.1, foot_f=(4, 0), foot_b=(-6, 0), crouch=1),
        pose(hand_f=(14, -12), hand_b=(-2, -11), weapon=0.0, lean=0.35, foot_f=(9, 0), foot_b=(-7, 0), crouch=2, smear=(-0.9, 0.1)),
        pose(hand_f=(13, -10), hand_b=(6, -12), weapon=0.1, lean=0.3, foot_f=(9, 0), foot_b=(-7, 0), crouch=2, smear=(0.4, -0.3)),
        pose(hand_f=(7, -10), hand_b=(-3, -11), weapon=-0.3, lean=0.1, foot_f=(5, 0), foot_b=(-5, 0)),
    ]


def dodge_frames():
    return [pose(crouch=4, lean=0.5, foot_f=(5, 0), foot_b=(-4, 0), hand_f=(6, -6), hand_b=(0, -6), cloak=0.5),
            pose(crouch=8, lean=0.9, foot_f=(4, -2), foot_b=(-3, -1), hand_f=(5, -3), hand_b=(1, -3), cloak=0.7),
            pose(crouch=8, lean=1.1, foot_f=(2, -3), foot_b=(-2, -2), hand_f=(4, -2), hand_b=(0, -2), cloak=0.8),
            pose(crouch=3, lean=0.4, foot_f=(5, 0), foot_b=(-5, 0), hand_f=(7, -7), hand_b=(-1, -7), cloak=0.3)]


def hurt_frame():
    return pose(lean=-0.35, hip=(-2, 0), foot_f=(4, 0), foot_b=(-3, 0), hand_f=(2, -14), hand_b=(-7, -12), weapon=-1.8, cloak=0.4)


# ---------------- ГЕРОИ ----------------
HERO = {
    "valder": dict(armor="steel_dark", under="steel_dark", legs="steel_dark", boots="steel_dark",
                   cloak="cloak_black", head="helm_closed", weapon="greatsword", bulk=1.25, height=0),
    "edrik": dict(armor="steel", under="tabard_blue", legs="steel", boots="leather",
                  cloak="tabard_blue", head="blond", weapon="sword_shield", bulk=1.0, height=0),
    "yarka": dict(armor="leather", under="leather", legs="leather", boots="leather",
                  cloak="cloak_red", head="hood_red", weapon="daggers", bulk=0.85, height=1),
}


def draw_humanoid(c, spec, p, flip_shadow=True):
    bulk = spec["bulk"]
    hx, hy = p["hip"]
    hip = (31 + hx, GROUND - 19 + hy + p["crouch"] + spec["height"])
    lean = p["lean"]
    neck = (hip[0] + math.sin(lean) * 13, hip[1] - math.cos(lean) * 13)
    head = (neck[0] + math.sin(lean) * 4.5, neck[1] - math.cos(lean) * 4.5)
    sh_f = (neck[0] + 1.5, neck[1] + 2)
    sh_b = (neck[0] - 1.5, neck[1] + 2)
    gy = GROUND
    foot_f = (hip[0] + p["foot_f"][0] + 1, gy + p["foot_f"][1])
    foot_b = (hip[0] + p["foot_b"][0] - 1, gy + p["foot_b"][1])
    hand_f = (hip[0] + p["hand_f"][0], hip[1] + p["hand_f"][1] + 13)
    hand_b = (hip[0] + p["hand_b"][0], hip[1] + p["hand_b"][1] + 13)
    if spec["weapon"] == "greatsword":
        hand_b = (hand_f[0] - 2 * math.cos(p["weapon"]), hand_f[1] - 2 * math.sin(p["weapon"]))

    limb_w = 4 * bulk
    leg_w = 4.5 * bulk

    # Плащ сзади: развевается против движения
    cloak = spec["cloak"]
    sway = p["cloak"]
    cl_len = 22 if cloak != "tabard_blue" else 12
    back = (sh_b[0] - 2, sh_b[1])
    tip1 = (back[0] - 6 - sway * 10, back[1] + cl_len)
    tip2 = (back[0] + 4 - sway * 6, back[1] + cl_len + 1)
    if spec["head"] != "blond" or True:
        c.poly([(back[0] + 1, back[1] - 1), (back[0] - 4, back[1] + 4), tip1,
                ((tip1[0] + tip2[0]) / 2, tip1[1] - 2), tip2, (neck[0] + 2, neck[1] + 6)], cloak)

    # Задние конечности
    knee_b, _ = ik(hip, foot_b, 9, 9.5, bend=-1 if foot_b[0] > hip[0] else -1)
    c.limb(hip, knee_b, leg_w, spec["legs"]); c.limb(knee_b, foot_b, leg_w - 0.5, spec["legs"])
    c.rect(foot_b[0] - 2, foot_b[1] - 2, 5, 3, spec["boots"])
    elb_b, hb = ik(sh_b, hand_b, 7, 7, bend=1)
    c.limb(sh_b, elb_b, limb_w - 0.5, spec["armor"]); c.limb(elb_b, hb, limb_w - 1, spec["armor"])

    # Оружие за телом (щит Эдрика на задней руке)
    if spec["weapon"] == "sword_shield":
        c.ellipse(hb[0] + 1, hb[1] - 1, 4.5, 6, "wood")
        c.ellipse(hb[0] + 1, hb[1] - 1, 2.5, 3.5, "tabard_blue")
        c.rect(hb[0], hb[1] - 2, 2, 2, "gold")
    if spec["weapon"] == "daggers":
        draw_blade(c, hb, p["weapon"] - 0.6, 7, 1.6, "blade", grip=2)

    # Торс
    tw = 8 * bulk
    torso = [(hip[0] - tw / 2 + 1, hip[1] + 1), (hip[0] + tw / 2, hip[1] + 1),
             (sh_f[0] + tw / 2 * 0.95, sh_f[1] - 1), (sh_b[0] - tw / 2 * 0.95, sh_b[1] - 1)]
    c.poly(torso, spec["armor"])
    # Нагрудник/табард
    if spec["under"] != spec["armor"]:
        c.poly([(hip[0] - 2, hip[1] + 4), (hip[0] + 3, hip[1] + 4), (neck[0] + 2.5, neck[1] + 3), (neck[0] - 2, neck[1] + 3)], spec["under"])
        c.rect(round(neck[0] - 0.5), round(neck[1] + 6), 2, 2, "gold")
    c.rect(round(hip[0] - tw / 2 + 1), round(hip[1] - 1), round(tw), 2, "leather")       # пояс
    c.rect(round(hip[0] + 1), round(hip[1] - 1), 2, 2, "gold")                         # пряжка
    if spec["head"] == "hood_red":
        c.rect(round(hip[0] - 3), round(hip[1]), 3, 3, "leather")                       # сумка

    # Передняя нога
    knee_f, _ = ik(hip, foot_f, 9, 9.5, bend=-1)
    c.limb(hip, knee_f, leg_w, spec["legs"]); c.limb(knee_f, foot_f, leg_w - 0.5, spec["legs"])
    c.rect(foot_f[0] - 2, foot_f[1] - 2, 6, 3, spec["boots"])
    if spec["legs"].startswith("steel"):
        c.rect(round(knee_f[0] - 1), round(knee_f[1] - 1), 3, 3, spec["legs"])         # наколенник

    # Голова
    draw_head(c, spec["head"], head, lean, bulk)
    # Наплечник
    if spec["armor"].startswith("steel"):
        c.ellipse(sh_f[0] + 0.5, sh_f[1] + 0.5, 3.4 * bulk, 2.6 * bulk, spec["armor"])

    # Передняя рука и оружие
    elb_f, hf = ik(sh_f, hand_f, 7, 7, bend=1)
    wpn = spec["weapon"]
    if wpn == "greatsword":
        draw_blade(c, hf, p["weapon"], 27, 3.2, "blade", grip=5, guard=6)
    elif wpn == "sword_shield":
        draw_blade(c, hf, p["weapon"], 17, 2.4, "blade", grip=3, guard=4)
    else:
        draw_blade(c, hf, p["weapon"], 8, 1.8, "blade", grip=2, guard=2)
    c.limb(sh_f, elb_f, limb_w, spec["armor"]); c.limb(elb_f, hf, limb_w - 0.5, spec["armor"])
    c.ellipse(hf[0], hf[1], 1.6, 1.6, "leather" if spec["armor"] != "leather" else "skin")


    return hip


def draw_blade(c, hand, ang, length, width, mat, grip=3, guard=4):
    ux, uy = math.cos(ang), math.sin(ang)
    px, py = -uy, ux
    g0 = (hand[0] - ux * grip * 0.5, hand[1] - uy * grip * 0.5)
    c.limb(g0, (hand[0] + ux * grip * 0.5, hand[1] + uy * grip * 0.5), 2, "wood")
    base = (hand[0] + ux * (grip * 0.5 + 1), hand[1] + uy * (grip * 0.5 + 1))
    if guard:
        c.limb((base[0] - px * guard / 2, base[1] - py * guard / 2), (base[0] + px * guard / 2, base[1] + py * guard / 2), 2, "gold")
    tip = (base[0] + ux * length, base[1] + uy * length)
    hw = width / 2
    c.poly([(base[0] - px * hw, base[1] - py * hw), (base[0] + px * hw, base[1] + py * hw),
            (tip[0] - ux * 2 + px * hw * 0.6, tip[1] - uy * 2 + py * hw * 0.6), tip,
            (tip[0] - ux * 2 - px * hw * 0.6, tip[1] - uy * 2 - py * hw * 0.6)], mat)


def draw_smear(c, hand, arc, length):
    """Шлейф удара: светлая дуга, которую оставляет клинок (рисуется в спрайт)."""
    a0, a1 = arc
    steps = 14
    for k in range(steps):
        a = a0 + (a1 - a0) * k / (steps - 1)
        r0, r1 = length * 0.45, length + 4
        for r in np.linspace(r0, r1, int(r1 - r0)):
            x, y = hand[0] + math.cos(a) * r, hand[1] + math.sin(a) * r
            if 0 <= x < S and 0 <= y < S and (k / steps > 0.25 or r > length * 0.8):
                c.glows.append((x, y, "eye_white", 1))


def draw_head(c, kind, head, lean, bulk):
    hx, hy = head
    if kind == "helm_closed":
        c.ellipse(hx, hy, 3.8 * bulk, 4.6, "steel_dark")
        c.rect(round(hx - 3), round(hy - 6), 6, 2, "steel_dark")             # гребень
        c.rect(round(hx), round(hy - 1), 4, 1, "steel_dark")
        c.glow(hx + 1, hy - 1, "eye_red", 2)                                    # огонь в забрале
        c.rect(round(hx + 1), round(hy + 2), 3, 1, "steel_dark")
    elif kind == "blond":
        c.ellipse(hx - 0.5, hy - 0.5, 3.6, 4.2, "hair_blond")
        c.ellipse(hx + 1, hy + 0.5, 2.6, 3.4, "skin")
        c.rect(round(hx - 3), round(hy - 4), 6, 2, "hair_blond")
        c.glow(hx + 2, hy - 0.5, "eye_white", 1)
        c.rect(round(hx - 1), round(hy + 3), 3, 2, "hair_blond")               # бородка
    elif kind == "hood_red":
        c.poly([(hx - 5, hy + 4), (hx - 4, hy - 4), (hx, hy - 6), (hx + 3, hy - 5), (hx + 5, hy - 1), (hx + 4, hy + 4)], "cloak_red")
        c.ellipse(hx + 1.5, hy + 0.5, 2, 2.6, "skin")
        c.rect(round(hx - 1), round(hy + 2), 5, 2, "cloak_red")                 # шарф
        c.glow(hx + 2, hy - 0.5, "eye_white", 1)
        c.rect(round(hx - 5), round(hy + 1), 2, 4, "hair_blond")
    elif kind == "hollow":
        c.ellipse(hx, hy, 3.4, 4.2, "skin_dead")
        c.poly([(hx - 4, hy - 1), (hx - 2, hy - 5), (hx + 2, hy - 5), (hx + 4, hy - 2), (hx + 3, hy + 3), (hx - 3, hy + 3)], "cloth_rag")
        c.ellipse(hx + 1.5, hy + 0.5, 2.2, 2.8, "skin_dead")
        c.glow(hx + 2, hy - 0.5, "eye_teal", 2)
        c.rect(round(hx + 1), round(hy + 3), 2, 1, "steel_dark")               # рот-дыра
    elif kind == "cap":         # торговец: шапка-колпак, усы
        c.ellipse(hx + 1, hy + 0.5, 2.8, 3.4, "skin")
        c.poly([(hx - 4, hy - 1), (hx - 3, hy - 5), (hx + 1, hy - 7), (hx + 4, hy - 4), (hx + 4, hy - 1)], "cloak_green")
        c.rect(round(hx - 4), round(hy - 2), 9, 2, "leather")
        c.rect(round(hx + 1), round(hy + 2), 4, 1, "hair_grey")
        c.glow(hx + 2, hy - 0.5, "eye_white", 1)
    elif kind == "wild_grey":   # Маришка: копна седых волос
        c.ellipse(hx - 1, hy - 0.5, 4.6, 5.2, "hair_grey")
        c.poly([(hx - 5, hy), (hx - 7, hy + 6), (hx - 3, hy + 4), (hx - 4, hy + 8), (hx, hy + 3)], "hair_grey")
        c.ellipse(hx + 1.5, hy + 0.5, 2.4, 3.0, "skin")
        c.glow(hx + 2, hy - 0.5, "eye_red", 1)
        c.rect(round(hx + 1), round(hy + 2), 3, 1, "dress_wine")
    elif kind == "bald":        # сумасшедший: лысый, выпученные глаза
        c.ellipse(hx + 0.5, hy, 3.4, 4.0, "skin")
        c.rect(round(hx - 3), round(hy - 1), 2, 3, "hair_grey")
        c.glow(hx + 2, hy - 1, "eye_white", 2)
        c.rect(round(hx + 1), round(hy + 2), 3, 2, "cloak_red")             # орущий рот
    elif kind == "helm_open":   # стражник / солдат Серой Роты
        c.ellipse(hx + 0.5, hy, 3.6, 4.4, "steel")
        c.ellipse(hx + 1.5, hy + 1, 2.2, 2.8, "skin")
        c.rect(round(hx - 4), round(hy - 2), 9, 1, "steel")
        c.rect(round(hx + 1), round(hy - 2), 1, 5, "steel")                  # наносник
        c.glow(hx + 2.5, hy, "eye_white", 1)
    elif kind == "hermit":
        c.poly([(hx - 5, hy + 5), (hx - 4, hy - 4), (hx, hy - 6), (hx + 4, hy - 4), (hx + 5, hy + 1), (hx + 3, hy + 5)], "cloak_brown")
        c.ellipse(hx + 1.5, hy, 2.2, 2.6, "skin")
        c.poly([(hx - 1, hy + 2), (hx + 4, hy + 1), (hx + 3, hy + 8), (hx, hy + 7)], "hair_grey")
        c.glow(hx + 2, hy - 1, "eye_white", 1)


def frames_for(name):
    spec = HERO[name]
    style = {"greatsword": "heavy", "sword_shield": "sword", "daggers": "dagger"}[spec["weapon"]]
    anims = {
        "idle": idle_cycle(), "walk": walk_cycle(), "attack": attack_frames(style),
        "dodge": dodge_frames(), "hurt": [hurt_frame()],
    }
    return spec, anims


def sheet(name, spec, anims, draw):
    order, frames = {}, []
    for an, poses in anims.items():
        order[an] = [len(frames), len(frames) + len(poses) - 1]
        for p in poses:
            c = Canvas()
            draw(c, spec, p)
            frames.append(c.render())
    # Кадр смерти: последний кадр «боли», повёрнутый на бок
    dead = np.rot90(frames[order["hurt"][0]], 1).copy()
    dead = np.roll(dead, 22, axis=0)
    order["dead"] = [len(frames), len(frames)]
    frames.append(dead)
    cols = 8
    rows = math.ceil(len(frames) / cols)
    out = np.zeros((rows * S, cols * S, 4), np.uint8)
    for i, f in enumerate(frames):
        r, cc = divmod(i, cols)
        out[r * S:(r + 1) * S, cc * S:(cc + 1) * S] = f
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, f"{name}.png"), optimize=True)
    return order


# ---------------- ВРАГИ И NPC ----------------
HOLLOW = dict(armor="cloth_rag", under="cloth_rag", legs="skin_dead", boots="skin_dead",
              cloak="cloth_rag", head="hollow", weapon="claws", bulk=0.9, height=2)
HERMIT = dict(armor="cloak_brown", under="leather", legs="cloak_brown", boots="leather",
              cloak="cloak_brown", head="hermit", weapon="staff", bulk=1.0, height=1)


MERCHANT = dict(armor="cloak_green", under="leather", legs="leather", boots="leather", cloak="cloak_green",
                head="cap", weapon="none", bulk=1.2, height=1, skirt="apron")
MARISHKA = dict(armor="dress_wine", under="dress_wine", legs="cloth_rag", boots="leather", cloak="cloth_rag",
                head="wild_grey", weapon="none", bulk=0.9, height=2, skirt="dress_wine")
CRAZY = dict(armor="cloth_rag", under="cloth_rag", legs="cloth_rag", boots="skin", cloak="cloth_rag",
             head="bald", weapon="none", bulk=0.95, height=1)
GUARD = dict(armor="steel", under="tabard_blue", legs="cloth_grey", boots="leather", cloak="tabard_blue",
             head="helm_open", weapon="spear", bulk=1.05, height=0)
SOLDIER = dict(armor="steel_dark", under="cloth_grey", legs="cloth_grey", boots="leather",
               cloak="cloth_grey", head="helm_open", weapon="sword_shield", bulk=1.05, height=0)


def npc_anims():
    walk = walk_cycle()
    return {"idle": idle_cycle(), "walk": walk, "attack": [pose(hand_f=(6, -14), lean=0.15), pose(hand_f=(8, -18), lean=0.2)],
            "dodge": idle_cycle()[:1], "hurt": [hurt_frame()]}


def draw_hollow(c, spec, p):
    # Сгорбленный, руки до колен, когти вместо оружия
    p = dict(p); p["lean"] = p["lean"] + 0.35
    hip = draw_humanoid_simple(c, spec, p)
    return hip


def draw_humanoid_simple(c, spec, p):
    """Как герой, но без оружия (когти) — для Пустых и отшельника."""
    bulk = spec["bulk"]
    hx, hy = p["hip"]
    hip = (31 + hx, GROUND - 19 + hy + p["crouch"] + spec["height"])
    lean = p["lean"]
    neck = (hip[0] + math.sin(lean) * 12, hip[1] - math.cos(lean) * 12)
    head = (neck[0] + math.sin(lean) * 4, neck[1] - math.cos(lean) * 4)
    sh_f, sh_b = (neck[0] + 1, neck[1] + 2), (neck[0] - 1.5, neck[1] + 2)
    foot_f = (hip[0] + p["foot_f"][0] + 1, GROUND + p["foot_f"][1])
    foot_b = (hip[0] + p["foot_b"][0] - 1, GROUND + p["foot_b"][1])
    hand_f = (hip[0] + p["hand_f"][0], hip[1] + p["hand_f"][1] + 17)
    hand_b = (hip[0] + p["hand_b"][0], hip[1] + p["hand_b"][1] + 17)
    staff = spec["weapon"] in ("staff", "spear")
    if staff:
        hand_f = (hip[0] + 8, hip[1] - 2)
    skirt = spec.get("skirt")
    # лохмотья сзади
    c.poly([(sh_b[0], sh_b[1] - 1), (sh_b[0] - 6 - p["cloak"] * 8, hip[1] + 14), (sh_b[0] - 1, hip[1] + 12),
            (sh_b[0] + 3, hip[1] + 15), (neck[0] + 2, neck[1] + 4)], spec["cloak"])
    knee_b, _ = ik(hip, foot_b, 9, 9.5, -1)
    c.limb(hip, knee_b, 3.5, spec["legs"]); c.limb(knee_b, foot_b, 3, spec["legs"])
    elb_b, hb = ik(sh_b, hand_b, 8, 9, 1)
    c.limb(sh_b, elb_b, 3, spec["legs"] if not staff else spec["armor"]); c.limb(elb_b, hb, 2.5, spec["legs"] if not staff else "skin")
    tw = 8 * bulk
    c.poly([(hip[0] - tw / 2, hip[1] + 3), (hip[0] + tw / 2, hip[1] + 3), (sh_f[0] + tw / 2, sh_f[1]), (sh_b[0] - tw / 2, sh_b[1])], spec["armor"])
    c.rect(round(hip[0] - tw / 2), round(hip[1]), round(tw), 2, "leather")
    if skirt:   # юбка / фартук до колен
        c.poly([(hip[0] - tw / 2, hip[1]), (hip[0] + tw / 2, hip[1]), (hip[0] + tw / 2 + 3, hip[1] + 13), (hip[0] - tw / 2 - 3, hip[1] + 13)], skirt)
    knee_f, _ = ik(hip, foot_f, 9, 9.5, -1)
    c.limb(hip, knee_f, 3.5, spec["legs"]); c.limb(knee_f, foot_f, 3, spec["legs"])
    draw_head(c, spec["head"], head, lean, bulk)
    if spec["weapon"] == "staff":
        top = (hand_f[0] + 1, hand_f[1] - 22)
        c.limb((hand_f[0] + 1, GROUND), top, 2, "wood")
        c.rect(round(top[0]) - 2, round(top[1]) - 5, 5, 5, "gold")
        c.glow(top[0] - 1, top[1] - 3, "lamp", 3)
        c.glow(top[0], top[1] - 4, "lamp", 1)
    elif spec["weapon"] == "spear":
        top = (hand_f[0] + 1, hand_f[1] - 30)
        c.limb((hand_f[0] + 1, GROUND), top, 2, "wood")
        c.poly([(top[0] - 2, top[1] + 1), (top[0], top[1] - 6), (top[0] + 2, top[1] + 1)], "blade")
    elb_f, hf = ik(sh_f, hand_f, 8, 9, 1)
    arm_mat = spec["armor"] if staff else spec["legs"]
    c.limb(sh_f, elb_f, 3, arm_mat); c.limb(elb_f, hf, 2.5, "skin" if staff else spec["legs"])
    if spec["weapon"] == "claws":  # когти
        for k in (-1, 0, 1):
            c.limb(hf, (hf[0] + 3, hf[1] + 1 + k * 1.5), 1, "fur_light")

    return hip


def hollow_anims():
    walk = walk_cycle()
    for f in walk:
        f["hand_f"] = (f["hand_f"][0] - 1, f["hand_f"][1] + 3); f["hand_b"] = (f["hand_b"][0], f["hand_b"][1] + 3)
    return {
        "idle": idle_cycle(), "walk": walk,
        "attack": [pose(hand_f=(-2, -20), hand_b=(-5, -16), lean=-0.2),
                   pose(hand_f=(-4, -22), hand_b=(-6, -18), lean=-0.3),
                   pose(hand_f=(12, -6), hand_b=(4, -10), lean=0.3, smear=(-1.6, 0.6)),
                   pose(hand_f=(11, -2), hand_b=(5, -8), lean=0.35)],
        "dodge": dodge_frames()[:1], "hurt": [hurt_frame()],
    }


def wolf_frame(t, mode="run"):
    """Гнилой волк, вид сбоку. t — фаза бега 0..2π."""
    c = Canvas()
    by = 46 - (abs(math.sin(t)) * 2 if mode == "run" else 0)
    stretch = 1.0
    if mode == "lunge":
        stretch, by = 1.25, 40
    if mode == "crouch":
        by = 49
    bx = 30
    legs = [(bx + 9, 0.0), (bx + 7, math.pi), (bx - 9, math.pi * 0.5), (bx - 11, math.pi * 1.5)]
    # дальние лапы
    for i, (lx, ph) in enumerate(legs):
        if i % 2 == 1:
            sw = math.sin(t + ph) * 5 * (1 if mode == "run" else 0.2) + (6 if mode == "lunge" else 0) * (1 if lx > bx else -1)
            knee = (lx + sw * 0.4, by + 6)
            c.limb((lx, by + 1), knee, 3, "fur"); c.limb(knee, (lx + sw, GROUND), 2.5, "fur")
    # хвост
    c.limb((bx - 13 * stretch, by - 2), (bx - 20 * stretch, by - 6 + math.sin(t) * 2), 3, "fur")
    # тело
    c.ellipse(bx, by - 1, 14 * stretch, 6.5, "fur")
    c.ellipse(bx + 7 * stretch, by - 3, 7, 6, "fur")         # загривок
    c.ellipse(bx - 2, by + 2, 9 * stretch, 3, "fur_light")   # брюхо
    # рёбра торчат (гниль)
    for k in range(3):
        c.rect(round(bx - 4 + k * 3), round(by - 1), 1, 3, "skin_dead")
    # голова
    hxp, hyp = bx + 17 * stretch, by - 6 + (3 if mode == "crouch" else 0)
    c.ellipse(hxp, hyp, 5, 4, "fur")
    c.poly([(hxp + 2, hyp - 1), (hxp + 10, hyp + 1), (hxp + 9, hyp + 3), (hxp + 2, hyp + 3)], "fur")
    c.poly([(hxp - 2, hyp - 3), (hxp - 1, hyp - 8), (hxp + 2, hyp - 3)], "fur")          # ухо
    if mode == "lunge":
        c.poly([(hxp + 3, hyp + 3), (hxp + 10, hyp + 5), (hxp + 4, hyp + 6)], "cloak_red")  # пасть
    c.glow(hxp + 2, hyp - 1, "eye_red", 2)
    # ближние лапы
    for i, (lx, ph) in enumerate(legs):
        if i % 2 == 0:
            sw = math.sin(t + ph) * 5 * (1 if mode == "run" else 0.2) + (6 if mode == "lunge" else 0) * (1 if lx > bx else -1)
            knee = (lx + sw * 0.4, by + 6)
            c.limb((lx, by + 1), knee, 3.5, "fur"); c.limb(knee, (lx + sw, GROUND), 3, "fur")
    return c.render()


def wolf_sheet():
    frames, order = [], {}
    def add(name, fr):
        order[name] = [len(frames), len(frames) + len(fr) - 1]; frames.extend(fr)
    add("idle", [wolf_frame(0, "idle"), wolf_frame(0.3, "idle")])
    add("walk", [wolf_frame(i / 6 * 2 * math.pi) for i in range(6)])
    add("attack", [wolf_frame(0, "crouch"), wolf_frame(0, "crouch"), wolf_frame(0, "lunge"), wolf_frame(0, "lunge")])
    add("hurt", [wolf_frame(0, "crouch")])
    dead = np.flipud(wolf_frame(0, "idle")).copy()
    dead = np.roll(dead, 30, axis=0)
    add("dead", [dead])
    cols = 8
    rows = math.ceil(len(frames) / cols)
    out = np.zeros((rows * S, cols * S, 4), np.uint8)
    for i, f in enumerate(frames):
        r, cc = divmod(i, cols)
        out[r * S:(r + 1) * S, cc * S:(cc + 1) * S] = f
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, "wolf.png"), optimize=True)
    return order


def build():
    meta = {}
    for name in HERO:
        spec, anims = frames_for(name)
        meta[name] = sheet(name, spec, anims, draw_humanoid)
    meta["hollow"] = sheet("hollow", HOLLOW, hollow_anims(), draw_hollow)
    meta["hermit"] = sheet("hermit", HERMIT, {"idle": idle_cycle(), "walk": idle_cycle()[:1], "attack": idle_cycle()[:1],
                                              "dodge": idle_cycle()[:1], "hurt": [hurt_frame()]}, draw_humanoid_simple)
    meta["wolf"] = wolf_sheet()
    for name, spec in (("merchant", MERCHANT), ("marishka", MARISHKA), ("crazy", CRAZY), ("guard", GUARD)):
        meta[name] = sheet(name, spec, npc_anims(), draw_humanoid_simple)
    _, anims = frames_for("edrik")
    meta["soldier"] = sheet("soldier", SOLDIER, anims, draw_humanoid)
    with open(os.path.join(OUT, "anims.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    build()
    print("characters ok")
