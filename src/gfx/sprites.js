// Мелкие текстуры, которые проще нарисовать кодом прямо в игре:
// бутылка, пиксель для частиц, костровище, шлейф удара.
// Крупная графика (лес, персонажи, катсцены) — PNG из tools/art.
import { GRIDS } from '../data/grids.js';
import { paletteFor } from './palette.js';

function gridTexture(scene, key, txt, pal) {
  const rows = txt.split('\n');
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w, rows.length);
  const ctx = tex.getContext();
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    ctx.fillStyle = pal[ch] || '#ff00ff';
    ctx.fillRect(x, y, 1, 1);
  }));
  tex.refresh();
}

export function buildFxTextures(scene) {
  if (scene.textures.exists('px')) return;
  gridTexture(scene, 'bottle', GRIDS.bottle, paletteFor('bottle'));

  const px = scene.textures.createCanvas('px', 2, 2);
  px.getContext().fillStyle = '#ffffff';
  px.getContext().fillRect(0, 0, 2, 2);
  px.refresh();

  // Костровище: камни по кругу и брёвна
  const fire = scene.textures.createCanvas('campfire', 28, 14);
  let ctx = fire.getContext();
  [[2, 8], [7, 10], [13, 11], [19, 10], [24, 8], [5, 5], [21, 5]].forEach(([x, y]) => {
    ctx.fillStyle = '#2a2c30'; ctx.fillRect(x, y, 4, 3);
    ctx.fillStyle = '#6e7276'; ctx.fillRect(x, y, 3, 1);
  });
  ctx.fillStyle = '#2a1d17'; ctx.fillRect(7, 6, 15, 3);
  ctx.fillStyle = '#6a4c36'; ctx.fillRect(9, 4, 11, 2);
  ctx.fillStyle = '#1a1210'; ctx.fillRect(10, 8, 9, 2);
  fire.refresh();

  // Шлейф удара: серп, прозрачный у хвоста и яркий у переднего края.
  // Центр окружности — левый край по середине (точка руки).
  const S = 72;
  const smear = scene.textures.createCanvas('smear', S, S);
  ctx = smear.getContext();
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x, dy = y - S / 2;
      const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const inner = 18 + (a + 1.2) * 5;          // серп сужается к хвосту
      if (r < inner || r > 34 || Math.abs(a) > 1.2) continue;
      const lead = (a + 1.2) / 2.4;               // 0 у хвоста .. 1 у края
      const edge = 1 - Math.abs(r - 30) / 10;
      let alpha = Math.max(0, lead * lead * edge);
      alpha = Math.round(alpha * 4) / 4;          // ступеньки — «пиксельно»
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  smear.refresh();

  // Мягкое световое пятно (для костра, фонарей, магии) — рисуется в режиме ADD
  const glow = scene.textures.createCanvas('glow', 64, 64);
  ctx = glow.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  glow.refresh();
}
