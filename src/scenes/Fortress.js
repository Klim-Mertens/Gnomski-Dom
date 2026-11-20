import Phaser from 'phaser';
import { FORTRESS_DOOR } from '../data/texts.js';
import { save } from '../systems/save.js';
import { FieldScene } from './Field.js';

// Цитадель Регента: вид под углом (изометрия), фиолетовая ночь, факелы у дверей.
// Пол — одна картинка, стены — отдельные блоки, которые сортируются по глубине с героями.
const WARM = 0xffa040;

// Где стоят враги (клетки сетки i, j)
const SPAWNS = [
  ['soldier', 9, 16], ['soldier', 19, 15], ['hollow', 12, 18], ['hollow', 15, 21],
  ['soldier', 14, 15], ['hollow', 21, 19], ['soldier', 8, 21], ['hollow', 18, 22],
];

export class FortressScene extends FieldScene {
  constructor() { super('Fortress'); }

  iso(i, j) { const L = this.L; return { x: L.ox + (i - j) * L.tw / 2, y: L.oy + (i + j) * L.th / 2 }; }

  spawnPoint() { const [x, y] = this.cache.json.get('fortressLayout').spawn; return { x, y }; }

  calmMusic() { return 'm_fortress'; }

  onEnter() {
    if (this.entry === 'city' && !this.saveData.flags.fortressIntro) {
      this.saveData.flags.fortressIntro = true;
      save(this.saveData);
      this.dialogue.show(this.hero.name, [
        'Цитадель. Камни тёплые, будто дышат.',
        'Серая Рота здесь. И Пустые — те, кому «Покоя» досталось слишком много.',
      ]);
    }
  }

  onRespawn() { this.clearEnemies(); this.spawnEnemies(); }

  spawnEnemies() {
    SPAWNS.forEach(([type, i, j]) => {
      const p = this.iso(i, j);
      this.spawnEnemy(type, p.x, p.y);
    });
  }

  buildWorld() {
    const L = this.L = this.cache.json.get('fortressLayout');
    this.worldW = L.w; this.worldH = L.h;
    this.cameras.main.setBackgroundColor('#0c0814');
    this.add.image(0, 0, 'fortress_floor').setOrigin(0).setDepth(-10);

    const light = (x, y, scale, alpha, tint = WARM, flicker = 0) => {
      const g = this.add.image(x, y, 'glow').setScale(scale).setAlpha(alpha).setTint(tint).setBlendMode('ADD').setDepth(6100);
      if (flicker) this.tweens.add({ targets: g, alpha: alpha * (1 - flicker), scale: scale * 1.08, duration: Phaser.Math.Between(90, 200), yoyo: true, repeat: -1 });
      return g;
    };

    // Пустота вокруг плато непроходима
    for (let i = 0; i < L.n; i++) {
      for (let j = 0; j < L.n; j++) {
        if (!L.floor[i][j]) { const p = this.iso(i, j); this.addBlock(p.x, p.y, 22, 11); }
      }
    }
    // Края мира тоже
    for (let k = -1; k <= L.n; k++) {
      [[k, -1], [k, L.n], [-1, k], [L.n, k]].forEach(([i, j]) => { const p = this.iso(i, j); this.addBlock(p.x, p.y, 22, 11); });
    }

    // Стены, башни, донжон
    L.blocks.forEach((b) => {
      this.add.image(b.x, b.y, b.key).setOrigin(0.5, 1).setDepth(b.y - 8);
      this.addBlock(b.x, b.y - 8, 22, 11);
      const m = L.meta[b.key];
      m.lit.forEach(([lx, ly]) => light(b.x - 16 + lx, b.y - m.h + ly, 0.28, 0.7, 0xffc070, 0.08));
    });

    // Факелы у дверей
    L.torches.forEach((t) => {
      this.add.image(t.x, t.y, 'torch').setOrigin(0.5, 0).setDepth(t.y + 60);
      light(t.x, t.y + 2, 0.5, 0.9, 0xffd080, 0.15);
      light(t.x, t.y + 30, 2.4, 0.3, WARM, 0.1);
      this.add.particles(t.x, t.y + 1, 'px', {
        speedY: { min: -30, max: -14 }, speedX: { min: -4, max: 4 }, lifespan: { min: 200, max: 500 },
        scale: { start: 1.2, end: 0 }, tint: [0xffd070, 0xff8a2a], blendMode: 'ADD', frequency: 60,
      }).setDepth(6101);
    });
    // Жаровни во дворе
    L.braziers.forEach((b) => {
      this.add.image(b.x, b.y, 'brazier').setOrigin(0.5, 1).setDepth(b.y);
      this.addBlock(b.x, b.y - 3, 14, 6);
      light(b.x, b.y - 20, 0.7, 0.9, 0xffc060, 0.15);
      light(b.x, b.y - 4, 3.2, 0.3, WARM, 0.1);
      this.add.particles(b.x, b.y - 20, 'px', {
        x: { min: -5, max: 5 }, speedY: { min: -46, max: -20 }, lifespan: { min: 300, max: 700 },
        scale: { start: 1.6, end: 0.2 }, tint: [0xffd070, 0xff8a2a, 0xd84020], blendMode: 'ADD', frequency: 40,
      }).setDepth(6101);
    });
    L.rubble.forEach((r, i) => this.add.image(r.x, r.y, `rubble${i % 2}`).setOrigin(0.5, 0.8).setDepth(r.y - 10));

    // Дверь донжона заперта
    const [dx, dy] = L.door;
    this.addInteractable(dx, dy, 40, '[E] дверь', '#d0a0ff', () => {
      this.sfx('s_door');
      this.cameras.main.shake(120, 0.004);
      this.dialogue.show(FORTRESS_DOOR.name, FORTRESS_DOOR.locked);
    }, -50);

    // Мост на юг — назад в город
    const [ex, ey] = L.exit;
    this.addExit(ex - 50, ey - 4, 100, 40, () => this.leaveTo('City', { entry: 'fortress' }));
    this.addInteractable(ex, ey - 16, 50, '↓ Остенград', '#e0b040', () => {}, -40);
  }

  buildAtmosphere() {
    const W = this.scale.width, H = this.scale.height;
    // Фиолетовая ночь поверх всего, огни — сверху
    this.add.rectangle(0, 0, W, H, 0xa088d8).setOrigin(0).setScrollFactor(0).setDepth(5900).setBlendMode('MULTIPLY');
    this.fogA = this.add.tileSprite(0, 0, W, H, 'fog0').setOrigin(0).setScrollFactor(0).setDepth(6200).setTint(0xb090e0).setAlpha(0.6);
    this.fogB = this.add.tileSprite(0, 0, W, H, 'fog1').setOrigin(0).setScrollFactor(0).setDepth(6201).setTint(0x9070c8).setAlpha(0.45);
    // пепел и искры в воздухе
    this.add.particles(0, 0, 'px', {
      x: { min: 0, max: this.worldW }, y: { min: 0, max: this.worldH }, lifespan: 5000,
      speedX: { min: 4, max: 14 }, speedY: { min: -8, max: 4 }, scale: { start: 0.7, end: 0.2 },
      alpha: { start: 0, end: 0.8, ease: 'Sine.inOut' }, tint: [0xd0a0ff, 0xffa060], blendMode: 'ADD', frequency: 80,
    }).setDepth(6150);
  }

  updateWorld(time) {
    const cam = this.cameras.main;
    this.fogA.tilePositionX = cam.scrollX * 0.9 + time * 0.007;
    this.fogA.tilePositionY = cam.scrollY * 0.9;
    this.fogB.tilePositionX = cam.scrollX * 1.2 - time * 0.012;
    this.fogB.tilePositionY = cam.scrollY * 1.2;
  }
}
