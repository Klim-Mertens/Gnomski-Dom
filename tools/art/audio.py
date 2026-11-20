"""Музыка и звуки игры — синтезируются с нуля (оригинальные композиции).

Инструменты: «хор» (детюн-пилы через форманты), квадратный лид, треугольник,
бас-пила, щипковая «лютня» (алгоритм Карплуса-Стронга), флейта, ударные.
Результат — mp3 в public/assets/audio/.  Запуск: python3 tools/art/audio.py
"""
import os
import subprocess
import tempfile
import wave
import numpy as np
from scipy.signal import lfilter, butter

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "assets", "audio")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def n(name):
    """'D4' -> midi 62, 'Bb3' -> 58."""
    name = name.replace("Db", "C#").replace("Eb", "D#").replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#")
    return NOTE[name[:-1]] + 12 * (int(name[-1]) + 1)


def env(length, a=0.01, d=0.1, s=0.7, r=0.1):
    t = np.arange(length) / SR
    total = length / SR
    e = np.ones(length) * s
    e[t < a] = t[t < a] / max(a, 1e-4)
    m = (t >= a) & (t < a + d)
    e[m] = 1 - (1 - s) * (t[m] - a) / max(d, 1e-4)
    rel = t > total - r
    e[rel] *= np.clip((total - t[rel]) / max(r, 1e-4), 0, 1)
    return e


def lp(x, cutoff, order=2):
    b, a = butter(order, min(cutoff / (SR / 2), 0.99))
    return lfilter(b, a, x)


def hp(x, cutoff, order=2):
    b, a = butter(order, min(cutoff / (SR / 2), 0.99), "high")
    return lfilter(b, a, x)


def bp(x, lo, hi, order=2):
    b, a = butter(order, [lo / (SR / 2), min(hi / (SR / 2), 0.99)], "band")
    return lfilter(b, a, x)


def saw(f, t):
    return 2 * ((t * f) % 1) - 1


def square(f, t, duty=0.5):
    return np.where((t * f) % 1 < duty, 1.0, -1.0)


def tri(f, t):
    return 2 * np.abs(2 * ((t * f) % 1) - 1) - 1


# ---------------- ИНСТРУМЕНТЫ ----------------
def choir(f, dur):
    L = int(dur * SR); t = np.arange(L) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.6, 0, 1)
    x = sum(saw(f * d * vib, t + rng.random()) for d in (0.995, 1.0, 1.006))
    x = bp(x, 500, 1100) * 1.2 + bp(x, 1900, 2600) * 0.5 + lp(x, 400) * 0.4   # форманты «а-о»
    return x * env(L, a=0.5, d=0.3, s=0.8, r=0.6) * 0.18


def pad(f, dur):
    L = int(dur * SR); t = np.arange(L) / SR
    x = sum(saw(f * d, t + rng.random()) for d in (0.993, 1.0, 1.007))
    return lp(x, 1400) * env(L, a=0.4, d=0.2, s=0.8, r=0.5) * 0.12


def lead(f, dur, duty=0.25):
    L = int(dur * SR); t = np.arange(L) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.3, 0, 1)
    x = square(f * vib, t, duty)
    return lp(x, 3500) * env(L, a=0.01, d=0.15, s=0.6, r=0.08) * 0.11


def tri_note(f, dur):
    L = int(dur * SR); t = np.arange(L) / SR
    return tri(f, t) * env(L, a=0.005, d=dur * 0.7, s=0.2, r=0.05) * 0.22


def bass(f, dur):
    L = int(dur * SR); t = np.arange(L) / SR
    x = saw(f, t) * 0.6 + square(f / 2, t) * 0.4
    return lp(x, 700) * env(L, a=0.005, d=0.12, s=0.6, r=0.04) * 0.28


def pluck(f, dur, bright=0.5):
    """Карплус-Стронг: шум в линии задержки с затуханием = щипок струны."""
    L = int(dur * SR)
    N = max(2, int(SR / f))
    burst = np.zeros(L); burst[:N] = lp(rng.uniform(-1, 1, N), 2000 + bright * 5000)
    g = 0.996
    a = np.zeros(N + 2); a[0] = 1; a[N] = -g * 0.5; a[N + 1] = -g * 0.5
    y = lfilter([1], a, burst)
    return y * env(L, a=0.001, d=0.01, s=1, r=0.05) * 0.32


def flute(f, dur):
    L = int(dur * SR); t = np.arange(L) / SR
    vib = 1 + 0.008 * np.sin(2 * np.pi * 5 * t) * np.clip((t - 0.2) / 0.4, 0, 1)
    x = np.sin(2 * np.pi * np.cumsum(f * vib) / SR) + 0.25 * np.sin(4 * np.pi * np.cumsum(f * vib) / SR)
    x += bp(rng.normal(0, 1, L), f, f * 3) * 0.08        # дыхание
    return x * env(L, a=0.08, d=0.1, s=0.8, r=0.15) * 0.13


def kick(dur=0.35):
    L = int(dur * SR); t = np.arange(L) / SR
    f = 40 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.55


def taiko(dur=0.9):
    L = int(dur * SR); t = np.arange(L) / SR
    f = 55 + 40 * np.exp(-t * 18)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    slap = lp(rng.normal(0, 1, L), 900) * np.exp(-t * 40)
    return (body * 0.6 + slap * 0.25)


def snare(dur=0.22):
    L = int(dur * SR); t = np.arange(L) / SR
    return (bp(rng.normal(0, 1, L), 1200, 7000) * np.exp(-t * 18) * 0.35 +
            np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.25)


def hat(dur=0.06, open_=False):
    L = int((0.25 if open_ else dur) * SR); t = np.arange(L) / SR
    return hp(rng.normal(0, 1, L), 7000) * np.exp(-t * (12 if open_ else 60)) * 0.12


# ---------------- СЕКВЕНСОР ----------------
class Track:
    def __init__(self, bpm, bars, beats_per_bar=4):
        self.bpm = bpm
        self.spb = 60 / bpm
        self.len = int(bars * beats_per_bar * self.spb * SR)
        self.buf = np.zeros(self.len + SR * 4)

    def add(self, beat, sig, gain=1.0, wrap=True):
        i = int(beat * self.spb * SR)
        if i >= len(self.buf):
            return
        sig = sig[:len(self.buf) - i]
        self.buf[i:i + len(sig)] += sig * gain

    def note(self, inst, beat, dur_beats, midi, gain=1.0, **kw):
        self.add(beat, inst(mtof(midi), dur_beats * self.spb, **kw), gain)

    def chord(self, inst, beat, dur_beats, midis, gain=1.0):
        for m in midis:
            self.note(inst, beat, dur_beats, m, gain)

    def render(self, verb=0.25):
        x = self.buf
        if verb:
            x = x + reverb(x) * verb
        # хвост реверба заворачиваем в начало — бесшовная петля
        tail = x[self.len:]
        loop = x[:self.len].copy()
        loop[:len(tail)] += tail[:self.len]
        return loop


def reverb(x):
    """Ревербератор Шрёдера: 4 гребенчатых + 2 всепропускающих фильтра."""
    out = np.zeros_like(x)
    for d, g in ((1557, 0.84), (1617, 0.83), (1491, 0.85), (1422, 0.86)):
        a = np.zeros(d + 1); a[0] = 1; a[d] = -g
        out += lfilter([1], a, x)
    out /= 4
    for d, g in ((225, 0.7), (556, 0.7)):
        b = np.zeros(d + 1); b[0] = -g; b[d] = 1
        a = np.zeros(d + 1); a[0] = 1; a[d] = -g
        out = lfilter(b, a, out)
    return lp(out, 5000)


def write_mp3(x, name, quality=5):
    x = x / max(1e-6, np.max(np.abs(x))) * 0.89
    pcm = (x * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-codec:a", "libmp3lame", "-q:a", str(quality),
                    os.path.join(OUT, name + ".mp3")], check=True)
    os.remove(tmp)


# ---------------- МУЗЫКА ----------------
def theme_title():
    """Главная тема: ре минор, хор и барабаны тайко — эпично и грустно."""
    tr = Track(72, 16)
    prog = [["D3", "F3", "A3", "D4"], ["Bb2", "D3", "F3", "Bb3"], ["F2", "A2", "C3", "F3"], ["C3", "E3", "G3", "C4"],
            ["D3", "F3", "A3", "D4"], ["Bb2", "D3", "F3", "Bb3"], ["G2", "Bb2", "D3", "G3"], ["A2", "C#3", "E3", "A3"]]
    for bar in range(16):
        ch = prog[bar % 8]
        tr.chord(choir, bar * 4, 4.2, [n(x) for x in ch], 1.0)
        tr.note(bass, bar * 4, 3.5, n(ch[0]) - 12, 0.6)
        tr.add(bar * 4, taiko(), 0.8)
        tr.add(bar * 4 + 2.5, taiko(), 0.45)
        tr.add(bar * 4 + 3, taiko(), 0.6)
        if bar % 4 == 3:
            for k in range(4):
                tr.add(bar * 4 + 3 + k * 0.25, taiko(0.4), 0.3 + k * 0.1)
    mel = [("D5", 2), ("F5", 1), ("E5", 1), ("D5", 2), ("A4", 2), ("Bb4", 1.5), ("C5", 0.5), ("D5", 1), ("F5", 1), ("E5", 4),
           ("D5", 2), ("F5", 1), ("G5", 1), ("A5", 3), ("G5", 1), ("F5", 1.5), ("E5", 0.5), ("D5", 1), ("C#5", 1), ("D5", 4)]
    beat = 16
    for name, d in mel:
        tr.note(lead, beat, d * 0.95, n(name), 1.0, duty=0.3)
        beat += d
    return tr.render(0.45)


def theme_forest():
    """Лес Хмарь: ля дорийский, треугольные арпеджио, флейта и мягкий свинг."""
    tr = Track(84, 16)
    chords = [["A2", "E3", "G3", "C4", "E4"], ["D3", "F#3", "A3", "C4", "E4"]]
    for bar in range(16):
        ch = [n(x) for x in chords[(bar // 2) % 2]]
        tr.chord(pad, bar * 4, 4.1, ch[1:4], 0.7)
        tr.note(bass, bar * 4, 1.5, ch[0] - 12 + 12, 0.5)
        tr.note(bass, bar * 4 + 2.5, 1, ch[0] - 12 + 12, 0.35)
        pat = [0, 2, 3, 4, 3, 2, 1, 2]
        for k, idx in enumerate(pat):
            sw = 0.08 if k % 2 else 0   # свинг
            tr.note(tri_note, bar * 4 + k * 0.5 + sw, 0.45, ch[idx] + 12, 0.55)
        for k in range(4):
            tr.add(bar * 4 + k + 0.58, hat(), 0.5)
        if bar % 2 == 1:
            tr.add(bar * 4 + 3.5, hat(open_=True), 0.4)
    mel = [(8, "E5", 1.5), (9.5, "G5", 0.5), (10, "A5", 2), (13, "G5", 0.5), (13.5, "E5", 0.5), (14, "D5", 2),
           (24, "C5", 1), (25, "D5", 1), (26, "E5", 1.5), (27.5, "G5", 0.5), (28, "F#5", 3),
           (40, "A5", 1.5), (41.5, "G5", 0.5), (42, "E5", 2), (45, "D5", 1), (46, "E5", 2),
           (56, "G5", 1), (57, "E5", 1), (58, "D5", 1), (59, "C5", 1), (60, "A4", 3.5)]
    for b, name, d in mel:
        tr.note(flute, b, d, n(name), 1.0)
    return tr.render(0.4)


def theme_battle():
    """Бой: ми минор, 138 BPM, бас восьмыми и злой лид."""
    tr = Track(138, 16)
    roots = ["E2", "C2", "D2", "B1"]
    for bar in range(16):
        r = n(roots[(bar // 2) % 4])
        for k in range(8):
            tr.note(bass, bar * 4 + k * 0.5, 0.45, r + (12 if k in (3, 6) else 0), 0.8)
        for k in range(4):
            tr.add(bar * 4 + k, kick(), 0.9 if k % 2 == 0 else 0.5)
            if k % 2 == 1:
                tr.add(bar * 4 + k, snare(), 0.9)
            tr.add(bar * 4 + k + 0.5, hat(), 0.6)
        tr.chord(pad, bar * 4, 4, [r + 24, r + 27 if roots[(bar // 2) % 4] in ("E2", "B1") else r + 28, r + 31], 0.5)
    riff = [("E5", .5), ("G5", .5), ("B5", 1), ("A5", .5), ("G5", .5), ("F#5", 1), ("E5", .5), ("F#5", .5), ("G5", .5), ("A5", .5), ("B5", 2)]
    for start in (16, 48):
        b = start
        for _ in range(2):
            for name, d in riff:
                tr.note(lead, b, d * 0.9, n(name), 1.0, duty=0.5)
                b += d
            b = start + 8
    return tr.render(0.2)


def theme_campfire():
    """У костра: ре мажор, «лютня» и флейта — самая ламповая тема."""
    tr = Track(76, 12)
    prog = [["D3", "A3", "D4", "F#4"], ["G2", "D3", "G3", "B3"], ["B2", "F#3", "B3", "D4"], ["A2", "E3", "A3", "C#4"]]
    for bar in range(12):
        ch = [n(x) for x in prog[bar % 4]]
        order = [0, 1, 2, 3, 2, 1, 2, 3]
        for k, idx in enumerate(order):
            tr.note(pluck, bar * 4 + k * 0.5, 1.6, ch[idx], 0.8)
        tr.chord(pad, bar * 4, 4, ch[1:3], 0.35)
    mel = [(16, "F#5", 1.5), (17.5, "E5", .5), (18, "D5", 2), (20, "B4", 1), (21, "D5", 1), (22, "E5", 2),
           (24, "F#5", 1), (25, "A5", 1), (26, "G5", 1.5), (27.5, "F#5", .5), (28, "E5", 4),
           (32, "D5", 1), (33, "E5", 1), (34, "F#5", 2), (36, "E5", 1), (37, "D5", 1), (38, "C#5", 2), (40, "D5", 4)]
    for b, name, d in mel:
        tr.note(flute, b, d, n(name), 0.9)
    crackle = np.zeros(tr.len)
    for _ in range(400):
        i = rng.integers(0, tr.len - 600)
        crackle[i:i + 300] += hp(rng.normal(0, 1, 300), 2000) * np.exp(-np.arange(300) / 40) * rng.uniform(0.05, 0.25)
    tr.buf[:tr.len] += crackle
    return tr.render(0.35)


def theme_bottles():
    """Мини-игра с бутылками: до мажор, 124 BPM, задорно и глуповато."""
    tr = Track(124, 8)
    prog = ["C3", "A2", "F2", "G2"]
    for bar in range(8):
        r = n(prog[bar % 4])
        for k in range(4):
            tr.note(bass, bar * 4 + k, 0.4, r if k % 2 == 0 else r + 7, 0.8)
            tr.add(bar * 4 + k, kick(0.2), 0.5)
            tr.add(bar * 4 + k + 0.5, snare(0.1), 0.35)
    mel = ["E5", "G5", "C6", "G5", "A5", "F5", "A5", "C6", "F5", "A5", "D5", "F5", "G5", "B4", "D5", "G5"]
    for i, name in enumerate(mel * 2):
        b = i * 1.0
        tr.note(lead, b, 0.4, n(name), 0.9, duty=0.125)
        if i % 4 == 3:
            tr.note(lead, b + 0.5, 0.3, n(name) - 1, 0.7, duty=0.125)   # «фальшивая» нота-шутка
    return tr.render(0.15)


# ---------------- ЗВУКИ ----------------
def sfx_swing(heavy=False):
    L = int((0.32 if heavy else 0.2) * SR); t = np.arange(L) / SR
    x = rng.normal(0, 1, L)
    sweep = np.linspace(600, 3500 if not heavy else 1800, L)
    y = np.zeros(L)
    for k in range(0, L, 512):    # фильтр, бегущий по частотам
        seg = x[k:k + 512]
        y[k:k + 512] = bp(seg, sweep[k] * 0.7, sweep[k] * 1.4)
    return y * np.sin(np.pi * t / t[-1]) * 0.8


def sfx_hit_flesh():
    L = int(0.25 * SR); t = np.arange(L) / SR
    thump = np.sin(2 * np.pi * np.cumsum(90 + 80 * np.exp(-t * 40)) / SR) * np.exp(-t * 18)
    squish = lp(rng.normal(0, 1, L), 1500) * np.exp(-t * 25)
    return thump * 0.8 + squish * 0.6


def sfx_hit_metal():
    L = int(0.6 * SR); t = np.arange(L) / SR
    ring = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * dcy) for f, dcy in ((1230, 6), (1870, 8), (2610, 10), (3390, 13)))
    clank = hp(rng.normal(0, 1, L), 2000) * np.exp(-t * 60)
    return ring * 0.18 + clank * 0.5


def sfx_step():
    L = int(0.09 * SR); t = np.arange(L) / SR
    return lp(rng.normal(0, 1, L), 900) * np.exp(-t * 50) * 0.5


def sfx_dodge():
    return sfx_swing() * 0.7


def sfx_glass():
    L = int(0.7 * SR); t = np.arange(L) / SR
    shatter = hp(rng.normal(0, 1, L), 4000) * np.exp(-t * 14)
    pings = sum(np.sin(2 * np.pi * rng.uniform(2500, 6000) * t) * np.exp(-t * rng.uniform(8, 20)) * (t > d)
                for d in rng.uniform(0, 0.15, 7))
    return shatter * 0.6 + pings * 0.12


def sfx_splash():
    """«Бульк»: пузыри + плеск — для вонючей бутылки."""
    L = int(1.4 * SR); t = np.arange(L) / SR
    x = lp(rng.normal(0, 1, L), 1200) * np.exp(-t * 4) * 0.5
    for _ in range(14):
        st = rng.uniform(0, 0.9); dur = rng.uniform(0.04, 0.09); f0 = rng.uniform(250, 600)
        m = (t > st) & (t < st + dur)
        tt = t[m] - st
        x[m] += np.sin(2 * np.pi * (f0 * tt + 2500 * tt * tt)) * np.sin(np.pi * tt / dur) * 0.6
    return x


def sfx_levelup():
    tr = Track(240, 2)
    for i, m in enumerate([72, 76, 79, 84]):
        tr.note(lead, i * 0.5, 1.2, m, 1.0, duty=0.25)
    return tr.render(0.3)[:int(1.6 * SR)]


def sfx_wolf_growl():
    L = int(0.8 * SR); t = np.arange(L) / SR
    am = 0.6 + 0.4 * np.sin(2 * np.pi * 28 * t)
    x = bp(rng.normal(0, 1, L), 90, 400) * am
    return x * env(L, a=0.08, d=0.2, s=0.8, r=0.2) * 1.2


def sfx_wolf_yelp():
    L = int(0.35 * SR); t = np.arange(L) / SR
    f = 900 + 500 * np.sin(np.pi * t / t[-1]) - t * 1200
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * square(f, t)
    return bp(x, 400, 3000) * env(L, a=0.01, d=0.1, s=0.6, r=0.1) * 0.6


def sfx_groan():
    L = int(1.0 * SR); t = np.arange(L) / SR
    f = 85 + 8 * np.sin(2 * np.pi * 3 * t) - t * 15
    x = saw(1, np.cumsum(f) / SR)
    x = bp(x, 300, 800) + bp(x, 1000, 1400) * 0.5
    return x * env(L, a=0.1, d=0.3, s=0.7, r=0.3) * 0.7


def sfx_hurt():
    L = int(0.28 * SR); t = np.arange(L) / SR
    f = 220 - t * 300
    x = saw(1, np.cumsum(f) / SR)
    y = bp(x, 400, 1500) * env(L, a=0.01, d=0.1, s=0.5, r=0.08) * 0.7
    hit = sfx_hit_flesh()
    y[:len(hit)] += hit[:L] * 0.5
    return y


def sfx_death():
    L = int(2.0 * SR); t = np.arange(L) / SR
    f = 110 * np.exp(-t * 0.6)
    x = sum(saw(f * d, t) for d in (1, 1.01, 0.5))
    return lp(x, 600) * env(L, a=0.02, d=0.5, s=0.5, r=1.0) * 0.4 + taiko(2.0)[:L] * 0.6


def sfx_click():
    L = int(0.05 * SR); t = np.arange(L) / SR
    return square(1200, t, 0.5) * np.exp(-t * 80) * 0.25


def sfx_rage():
    L = int(1.0 * SR); t = np.arange(L) / SR
    x = sum(saw(f, t) for f in (55, 82.4, 110))
    return lp(x, 900) * env(L, a=0.01, d=0.3, s=0.4, r=0.5) * 0.35 + taiko(1.0) * 0.7


def sfx_fire_loop():
    L = int(4.0 * SR)
    x = lp(rng.normal(0, 1, L), 600) * 0.15
    for _ in range(90):
        i = rng.integers(0, L - 800)
        x[i:i + 500] += hp(rng.normal(0, 1, 500), 2500) * np.exp(-np.arange(500) / 50) * rng.uniform(0.1, 0.5)
    fade = np.ones(L); k = int(0.05 * SR)
    fade[:k] = np.linspace(0, 1, k); fade[-k:] = np.linspace(1, 0, k)
    return x * fade


def sfx_heal():
    tr = Track(300, 2)
    for i, m in enumerate([79, 83, 86, 91]):
        tr.note(tri_note, i * 0.5, 1.0, m, 1.0)
    return tr.render(0.5)[:int(1.2 * SR)]


def theme_city():
    """Ночной Остенград: ре минор, медленная лютня, флейта издалека, колокол."""
    tr = Track(80, 16)
    prog = [["D3", "A3", "D4", "F4"], ["A#2", "F3", "A#3", "D4"], ["C3", "G3", "C4", "E4"], ["A2", "E3", "A3", "C#4"]]
    for bar in range(16):
        ch = [n(x) for x in prog[bar % 4]]
        for k, idx in enumerate([0, 2, 1, 3, 2, 1]):
            tr.note(pluck, bar * 4 + k * (4 / 6), 1.8, ch[idx], 0.65)
        tr.chord(pad, bar * 4, 4, ch[1:3], 0.3)
        tr.note(bass, bar * 4, 3.5, ch[0] - 12, 0.5)
    mel = [(16, "A4", 2), (18, "D5", 1), (19, "E5", 1), (20, "F5", 3), (23, "E5", 1), (24, "D5", 2), (26, "C5", 2),
           (28, "A4", 4), (36, "F5", 1.5), (37.5, "G5", .5), (38, "A5", 2), (40, "G5", 1), (41, "F5", 1), (42, "E5", 2),
           (44, "C#5", 4), (48, "D5", 2), (50, "F5", 2), (52, "E5", 2), (54, "C5", 2), (56, "D5", 6)]
    for b, name, d in mel:
        tr.note(flute, b, d, n(name), 0.7)
    for b in (0, 32):   # далёкий колокол
        tr.note(lambda f, dur: tri_note(f, dur) * np.exp(-np.linspace(0, 6, int(dur * SR))), b, 6, n("D3"), 0.5)
    return tr.render(0.45)


def theme_bazaar():
    """Базар: бодрая «ярмарочная» пляска в ре дорийском, бубен и хлопки."""
    tr = Track(132, 16)
    prog = [["D3", "A3", "D4"], ["C3", "G3", "C4"], ["D3", "A3", "D4"], ["A2", "E3", "A3"]]
    for bar in range(16):
        ch = [n(x) for x in prog[bar % 4]]
        for k in range(8):
            tr.note(pluck, bar * 4 + k * 0.5, 0.6, ch[k % 3] + (12 if k % 4 == 3 else 0), 0.55)
        tr.note(bass, bar * 4, 1, ch[0] - 12, 0.6); tr.note(bass, bar * 4 + 2, 1, ch[0] - 5, 0.5)
        for k in range(4):
            tr.add(bar * 4 + k, kick(0.25), 0.5 if k % 2 == 0 else 0.0)
            tr.add(bar * 4 + k + 0.5, hat(0.05), 0.35)
            if k % 2 == 1:
                tr.add(bar * 4 + k, snare(0.18), 0.35)
    phrase = ["D5", "E5", "F5", "G5", "A5", "G5", "F5", "E5", "D5", "C5", "D5", "E5", "F5", "E5", "D5", "A4"]
    for rep in range(2):
        for k, name in enumerate(phrase):
            tr.note(lead, 16 + rep * 32 + k * 1.0, 0.9, n(name), 0.35)
            tr.note(flute, 16 + rep * 32 + k * 1.0, 0.9, n(name) + 12, 0.25)
    return tr.render(0.25)


def theme_fortress():
    """Цитадель Регента: гул, хор, редкие удары — давящая, фиолетовая."""
    tr = Track(60, 12)
    for bar in range(12):
        root = n(["C3", "C3", "C#3", "B2"][bar % 4])
        tr.note(pad, bar * 4, 4.2, root - 12, 0.5)
        tr.chord(choir, bar * 4, 4.2, [root, root + 3, root + 7], 0.35)
        tr.add(bar * 4, taiko(1.2), 0.6)
        if bar % 2:
            tr.add(bar * 4 + 2.5, taiko(0.9), 0.3)
    for b, name, d in [(8, "G4", 4), (12, "G#4", 4), (16, "G4", 2), (18, "D#4", 2), (20, "D4", 4),
                       (32, "C5", 4), (36, "B4", 4), (40, "G4", 8)]:
        tr.note(choir, b, d, n(name), 0.4)
    return tr.render(0.5)


def sfx_crowd_loop(dur=6.0):
    """Гул толпы на базаре: много «голосов» — полосовой шум с огибающими слогов."""
    t = int(dur * SR)
    out = np.zeros(t)
    for _ in range(40):
        f = rng.uniform(250, 900)
        noise = bp(rng.normal(0, 1, t), f * 0.8, f * 1.3)
        syll = (np.sin(np.linspace(0, dur * rng.uniform(3, 7) * 2 * np.pi, t) + rng.uniform(0, 6)) > 0.2).astype(float)
        syll = lp(syll, 12)
        out += noise * syll * rng.uniform(0.2, 1)
    out /= np.abs(out).max() + 1e-9
    fade = int(0.3 * SR)   # бесшовная петля
    out[:fade] = out[:fade] * np.linspace(0, 1, fade) + out[-fade:] * np.linspace(1, 0, fade)
    return out[:-fade] * 0.6


def sfx_door():
    """Тяжёлая запертая дверь: глухой удар и лязг засова."""
    thud = lp(rng.normal(0, 1, int(0.4 * SR)), 300) * np.exp(-np.linspace(0, 8, int(0.4 * SR)))
    clank = sfx_hit_metal()[: int(0.3 * SR)] * 0.5
    out = np.zeros(int(0.7 * SR)); out[:len(thud)] += thud * 2; out[int(0.15 * SR):int(0.15 * SR) + len(clank)] += clank
    return out / (np.abs(out).max() + 1e-9) * 0.9


def build():
    music = {"m_title": theme_title, "m_forest": theme_forest, "m_battle": theme_battle,
             "m_campfire": theme_campfire, "m_bottles": theme_bottles,
             "m_city": theme_city, "m_bazaar": theme_bazaar, "m_fortress": theme_fortress}
    import sys
    only = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")), None)
    if only:   # перегенерировать только указанные файлы
        for name in only:
            fn = music.get(name)
            if fn:
                write_mp3(fn(), name, quality=5)
    elif "--sfx" not in sys.argv:
        for name, fn in music.items():
            write_mp3(fn(), name, quality=5)
    sfx = {"s_swing": sfx_swing, "s_swing_heavy": lambda: sfx_swing(True), "s_hit": sfx_hit_flesh,
           "s_metal": sfx_hit_metal, "s_step": sfx_step, "s_dodge": sfx_dodge, "s_glass": sfx_glass,
           "s_splash": sfx_splash, "s_levelup": sfx_levelup, "s_growl": sfx_wolf_growl, "s_yelp": sfx_wolf_yelp,
           "s_groan": sfx_groan, "s_hurt": sfx_hurt, "s_death": sfx_death, "s_click": sfx_click,
           "s_rage": sfx_rage, "s_fire": sfx_fire_loop, "s_heal": sfx_heal, "s_throw": lambda: sfx_swing() * 0.6}
    sfx.update({"s_crowd": sfx_crowd_loop, "s_door": sfx_door})
    for name, fn in sfx.items():
        if only and name not in only:
            continue
        write_mp3(fn(), name, quality=4)


if __name__ == "__main__":
    build()
    print("audio ok")
