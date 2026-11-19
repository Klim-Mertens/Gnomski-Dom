// Превращает ASCII-сетки в текстуры Phaser.
// Алгоритм: Scale2x (удвоение без «мыла») + проход света и тени для объёма.
import { GRIDS } from '../data/grids.js';
import { paletteFor, WORLD } from './palette.js';

const LIGHT = { m: 'a', d: 'm', C: 'c', S: 's', H: 'h', L: 'l', R: 'r', W: 'w' };
const DARK = { a: 'm', m: 'd', c: 'C', s: 'S', h: 'H', l: 'L', r: 'R', w: 'W' };

function parse(txt) {
  const rows = txt.split('\n');
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.'));
}

function scale2x(g) {
  const h = g.length, w = g[0].length;
  const at = (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? g[y][x] : '.');
  const out = Array.from({ length: h * 2 }, () => new Array(w * 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      out[2 * y][2 * x] = C === A && C !== D && A !== B ? C : P;
      out[2 * y][2 * x + 1] = A === B && A !== C && B !== D ? B : P;
      out[2 * y + 1][2 * x] = D === C && D !== B && C !== A ? C : P;
      out[2 * y + 1][2 * x + 1] = B === D && B !== A && D !== C ? B : P;
    }
  }
  return out.map((r) => r.join(''));
}

function shade(g) {
  const h = g.length, w = g[0].length;
  const edge = (x, y) => x < 0 || y < 0 || x >= w || y >= h || '.ok'.includes(g[y][x]);
  return g.map((row, y) =>
    [...row].map((ch, x) => {
      if ('.oke'.includes(ch)) return ch;
      if (edge(x - 1, y - 1) && LIGHT[ch]) return LIGHT[ch];
      if ((edge(x + 1, y + 1) || edge(x + 1, y)) && DARK[ch]) return DARK[ch];
      return ch;
    }).join('')
  );
}

function gridToCanvas(scene, key, grid, pal) {
  const tex = scene.textures.createCanvas(key, grid[0].length, grid.length);
  const ctx = tex.getContext();
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = pal[ch] || '#ff00ff'; // пурпурный = забытая роль цвета
      ctx.fillRect(x, y, 1, 1);
    });
  });
  tex.refresh();
}

// Строит все спрайты персонажей
export function buildCharacterTextures(scene) {
  for (const [key, txt] of Object.entries(GRIDS)) {
    const grid = key === 'bottle' ? parse(txt) : shade(scale2x(parse(txt)));
    gridToCanvas(scene, key, grid, paletteFor(key));
  }
}

// Процедурные текстуры мира: трава, ёлки, пиксель частиц, костёр
export function buildWorldTextures(scene, rnd = Math.random) {
  // Тайл травы 32x32 с шумом
  const grass = scene.textures.createCanvas('grass', 64, 64);
  let ctx = grass.getContext();
  ctx.fillStyle = WORLD.grass[0];
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = WORLD.grass[1 + Math.floor(rnd() * 3)];
    ctx.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 1, 1 + Math.floor(rnd() * 2));
  }
  grass.refresh();

  // Ёлка 40x64: ярусы треугольников
  const tree = scene.textures.createCanvas('tree', 40, 64);
  ctx = tree.getContext();
  ctx.fillStyle = WORLD.trunk;
  ctx.fillRect(17, 50, 6, 14);
  const tiers = [[20, 2, 10, 22], [20, 14, 15, 36], [20, 28, 19, 54]];
  tiers.forEach(([cx, top, half, bottom], ti) => {
    for (let y = top; y < bottom; y++) {
      const t = (y - top) / (bottom - top);
      const hw = Math.round(half * t);
      for (let x = cx - hw; x <= cx + hw; x++) {
        const edgeL = x < cx - hw + 2, edgeB = y > bottom - 3;
        ctx.fillStyle = edgeB || edgeL ? WORLD.tree[0] : x > cx + hw / 3 ? WORLD.tree[1] : WORLD.tree[2 + (ti === 0 ? 1 : 0)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  tree.refresh();

  // Пиксель для частиц
  const px = scene.textures.createCanvas('px', 2, 2);
  px.getContext().fillStyle = '#ffffff';
  px.getContext().fillRect(0, 0, 2, 2);
  px.refresh();

  // Костровище: камни и брёвна
  const fire = scene.textures.createCanvas('campfire', 24, 12);
  ctx = fire.getContext();
  [[2, 7], [6, 9], [11, 10], [16, 9], [20, 7]].forEach(([x, y]) => {
    ctx.fillStyle = '#5a5464'; ctx.fillRect(x, y, 3, 3);
    ctx.fillStyle = '#8a8090'; ctx.fillRect(x, y, 2, 1);
  });
  ctx.fillStyle = '#4a2c1c'; ctx.fillRect(5, 5, 14, 3);
  ctx.fillStyle = '#8a5a38'; ctx.fillRect(7, 3, 10, 2);
  fire.refresh();

  // Гриб (украшение поляны)
  const shroom = scene.textures.createCanvas('shroom', 6, 6);
  ctx = shroom.getContext();
  ctx.fillStyle = '#d8283a'; ctx.fillRect(0, 0, 6, 3);
  ctx.fillStyle = '#f0f4ff'; ctx.fillRect(1, 1, 1, 1); ctx.fillRect(4, 0, 1, 1);
  ctx.fillStyle = '#e0d0b0'; ctx.fillRect(2, 3, 2, 3);
  shroom.refresh();
}
