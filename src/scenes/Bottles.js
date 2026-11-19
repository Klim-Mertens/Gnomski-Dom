import Phaser from 'phaser';
import { txt } from '../systems/ui.js';
import { WORLD } from '../gfx/palette.js';
import { audio } from '../systems/audio.js';

// Мини-игра: 10 бутылок в сосну. Точность (прицел) + реакция (сила броска).
// Шестая бутылка ВСЕГДА трескается в руке и обливает героя вонючей жижей.
const TOTAL = 10;
const STINKY_BOTTLE = 6;
const IDEAL_POWER = 0.72;

const TARGETS = [
  { name: 'ствол', type: 'trunk' },
  { name: 'дупло', type: 'hollow' },
  { name: 'белка!', type: 'squirrel' },
];

export class BottlesScene extends Phaser.Scene {
  constructor() { super('Bottles'); }

  init(data) { this.heroId = data.hero; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    this.n = 0; this.hits = 0;

    this.sfx = (k, o) => audio(this.game).sfx(k, o);
    audio(this.game).music('m_bottles', this, 800);

    // Фон: туманное зелёное небо, три слоя леса (дальние — светлее и в тумане), земля
    const sky = this.add.graphics();
    const skyCols = [0x1c3a30, 0x24473a, 0x2e5644, 0x3a654e, 0x4a7458, 0x5a8262];
    skyCols.forEach((c, i) => sky.fillStyle(c).fillRect(0, i * 36, W, 37));
    const layer = (n, y, scale, tint, alpha) => {
      for (let i = 0; i < n; i++) {
        this.add.image(i * (W / (n - 1)) + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-6, 6), `tree${Phaser.Math.Between(0, 4)}`)
          .setOrigin(0.5, 1).setScale(scale * Phaser.Math.FloatBetween(0.85, 1.15)).setTint(tint).setAlpha(alpha).setFlipX(Math.random() < 0.5);
      }
    };
    layer(16, 190, 0.9, 0x6a9a7a, 0.55);
    this.add.tileSprite(0, 0, W, H, 'fog0').setOrigin(0).setTint(0xd8f0d8).setAlpha(0.8);
    layer(11, 202, 1.3, 0x3a6048, 0.9);
    this.add.tileSprite(0, 0, W, H, 'fog1').setOrigin(0).setTint(0xc8e8d0).setAlpha(0.6);
    // земля: кусок лесной подстилки
    this.add.tileSprite(0, 200, W, 70, 'forest_ground').setOrigin(0).setTilePosition(300, 120);
    this.add.rectangle(0, 200, W, 3, 0x0e1a12, 0.6).setOrigin(0);
    for (let i = 0; i < 18; i++) this.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(214, 266), `fern${i % 2}`).setOrigin(0.5, 1);
    // лучи
    [120, 260, 420].forEach((x, i) => {
      const r = this.add.image(x, 210, 'ray').setOrigin(0.5, 1).setBlendMode('ADD').setTint(0xe8ffc8).setAlpha(0.35);
      this.tweens.add({ targets: r, alpha: 0.15, duration: 3000 + i * 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });

    // Мишень: старая сосна с дуплом и веткой
    this.treeX = 340;
    const tg = this.add.graphics();
    tg.fillStyle(0x2a1c14).fillRect(this.treeX - 11, 30, 22, 178);
    for (let y = 30; y < 208; y += 3) {           // кора: полосы и трещины
      tg.fillStyle(0x3e2a1c).fillRect(this.treeX - 11, y, 7, 2);
      tg.fillStyle(0x1a100a).fillRect(this.treeX + 3 + ((y * 7) % 5), y, 1, 2);
    }
    tg.fillStyle(0x4e3624).fillRect(this.treeX - 11, 30, 2, 178);
    tg.fillStyle(0x2a1c14).fillTriangle(this.treeX - 11, 208, this.treeX - 22, 210, this.treeX - 11, 190);
    tg.fillStyle(0x2a1c14).fillTriangle(this.treeX + 11, 208, this.treeX + 20, 210, this.treeX + 11, 192);
    tg.fillStyle(0x0a0604).fillEllipse(this.treeX + 1, 110, 12, 15); // дупло
    tg.fillStyle(0x2a1c14).fillRect(this.treeX + 10, 70, 48, 5);   // ветка для белки
    tg.fillStyle(0x3e2a1c).fillRect(this.treeX + 10, 70, 48, 2);
    // крона из лиственных «клубков», не закрывает ветку и дупло
    [[-4, 6, 2.6], [-22, 18, 2.0], [16, 16, 2.1], [0, 26, 2.2], [-30, 32, 1.5], [26, 32, 1.4]].forEach(([dx, y, sc]) =>
      this.add.image(this.treeX + dx, y, `bush${Math.abs(dx) % 3}`).setScale(sc).setTint(0x9ac0a0));
    this.squirrel = this.add.rectangle(this.treeX + 30, 64, 8, 7, 0xa0502a).setVisible(false);
    this.squirrelTail = this.add.rectangle(this.treeX + 25, 60, 4, 8, 0xc06a3a).setVisible(false);

    // Герой и отшельник на пне (ржёт над тобой)
    this.hero = this.add.sprite(70, 238, this.heroId, 0).setOrigin(0.5, 0.97).play(`${this.heroId}_idle`);
    this.add.ellipse(440, 236, 30, 8, 0x3a2818);
    this.hermitSpr = this.add.sprite(440, 236, 'hermit', 0).setOrigin(0.5, 0.97).setFlipX(true).play('hermit_idle');
    const lamp = this.add.image(425, 174, 'glow').setTint(0xffc070).setScale(1.5).setAlpha(0.6).setBlendMode('ADD');
    this.tweens.add({ targets: lamp, alpha: 0.8, duration: 900, yoyo: true, repeat: -1 });

    // Интерфейс
    this.counter = txt(this, 8, 6, '', 10, '#e8dccc', { bold: true });
    this.targetLabel = txt(this, W / 2, 8, '', 10, '#e0b040', { origin: [0.5, 0], bold: true });
    this.windLabel = txt(this, W - 8, 6, '', 9, '#6ff0e0', { origin: [1, 0] });
    this.hint = txt(this, W / 2, H - 12, '', 8, '#a898a8', { origin: 0.5 });
    this.big = txt(this, W / 2, 108, '', 16, '#f0f4ff', { origin: 0.5, bold: true, strokeThickness: 3 }).setDepth(50);
    this.sub = txt(this, W / 2, 124, '', 9, '#e8dccc', { origin: [0.5, 0], align: 'center', wrap: 380 }).setDepth(50);
    this.cross = this.add.graphics().setDepth(40);
    this.powerG = this.add.graphics().setDepth(40);
    this.green = this.add.rectangle(0, 0, W, H, 0x6a9a20, 0).setOrigin(0).setDepth(45);

    this.glass = this.add.particles(0, 0, 'px', {
      speed: { min: 40, max: 140 }, gravityY: 300, lifespan: 700, scale: { start: 1.2, end: 0.4 },
      tint: [0xb8e0c0, 0x4a8a3a, 0xffffff], emitting: false,
    }).setDepth(30);
    this.splash = this.add.particles(0, 0, 'px', {
      speed: { min: 60, max: 180 }, angle: { min: 180, max: 360 }, gravityY: 320, lifespan: 1100,
      scale: { start: 2, end: 0.8 }, tint: WORLD.stink, emitting: false,
    }).setDepth(30);
    this.stinkCloud = this.add.particles(70, 190, 'px', {
      x: { min: -14, max: 14 }, speedY: { min: -20, max: -8 }, lifespan: 1500, scale: { start: 1.5, end: 3 },
      alpha: { start: 0.6, end: 0 }, tint: WORLD.stink, frequency: 60, emitting: false,
    }).setDepth(31);

    this.input.keyboard.on('keydown-SPACE', () => this.press());
    this.input.on('pointerdown', () => this.press());
    this.nextBottle();
  }

  nextBottle() {
    this.n++;
    if (this.n > TOTAL) return this.finish();
    this.big.setText(''); this.sub.setText('');
    this.target = TARGETS[(this.n - 1) % TARGETS.length];
    this.wind = Phaser.Math.FloatBetween(-1, 1);
    this.counter.setText(`Бутылка ${this.n}/${TOTAL} · попаданий ${this.hits}`);
    this.targetLabel.setText(`Цель: ${this.target.name}`);
    this.windLabel.setText(`ветер ${this.wind < 0 ? '←' : '→'} ${Math.round(Math.abs(this.wind) * 10)}`);
    const sq = this.target.type === 'squirrel';
    this.squirrel.setVisible(sq); this.squirrelTail.setVisible(sq);

    // Бутылка в руке
    this.inHand?.destroy();
    this.inHand = this.add.image(88, 200, 'bottle').setScale(1.4).setDepth(20);

    if (this.n === STINKY_BOTTLE) return this.stinkyBottle();
    this.state = 'aim';
    this.hint.setText('Пробел/клик — зафиксировать прицел');
    this.aimT = 0;
  }

  // Шестая бутылка: сюрприз
  stinkyBottle() {
    this.state = 'cutscene';
    this.hint.setText('');
    this.tweens.add({ targets: this.inHand, angle: { from: -8, to: 8 }, duration: 70, yoyo: true, repeat: 8 });
    this.time.delayedCall(900, () => {
      this.sub.setText('*хрусь*');
      this.sfx('s_glass', { volume: 0.4, rate: 1.6 });
    });
    this.time.delayedCall(1400, () => {
      this.inHand.destroy();
      this.splash.explode(70, 88, 196);
      this.glass.explode(16, 88, 200);
      this.sfx('s_glass'); this.sfx('s_splash');
      this.time.delayedCall(500, () => this.sfx('s_hurt', { rate: 0.9 }));
      this.hero.play(`${this.heroId}_hurt`);
      this.time.delayedCall(2500, () => this.hero.play(`${this.heroId}_idle`));
      this.hero.setTint(0x9ad050);
      this.stinkCloud.emitting = true;
      this.cameras.main.shake(400, 0.012);
      this.tweens.add({ targets: this.green, fillAlpha: 0.45, duration: 150, yoyo: true, hold: 500 });
      this.big.setColor('#8ad040').setText('ФУУУУУУ, БЛЯ!');
      this.sub.setText('Шестая бутылка треснула прямо в руке и окатила тебя чем-то тёплым, зелёным и едким.\nОтшельник ржёт так, что падает с пня.');
      this.tweens.add({ targets: this.hero, x: { from: 66, to: 74 }, duration: 50, yoyo: true, repeat: 12 });
    });
    this.time.delayedCall(5200, () => { this.big.setColor('#f0f4ff'); this.nextBottle(); });
  }

  press() {
    if (this.state === 'aim') {
      this.lock = { ...this.aim };
      this.sfx('s_click');
      this.state = 'power';
      this.powerT = 0;
      this.hint.setText('Пробел/клик — бросить. Лучшая сила — в золотой зоне');
    } else if (this.state === 'power') {
      this.throwBottle(this.power);
    }
  }

  targetPoint(time) {
    const t = this.target.type;
    if (t === 'trunk') return { x: this.treeX, y: 150, r: 11 };
    if (t === 'hollow') return { x: this.treeX + 1, y: 110, r: 7 };
    // белка бегает по ветке
    const x = this.treeX + 28 + Math.sin(time / 380) * 16;
    this.squirrel.x = x; this.squirrelTail.x = x - 5;
    return { x, y: 64, r: 6 };
  }

  update(time, delta) {
    this.cross.clear(); this.powerG.clear();
    if (this.target) this.tp = this.targetPoint(time);
    if (this.state === 'aim') {
      // Прицел гуляет по фигуре Лиссажу вокруг цели — ловим момент
      this.aimT += delta / 1000;
      const sp = 1.6 + this.n * 0.12;
      this.aim = { x: this.tp.x + Math.sin(this.aimT * sp * 1.3) * 46, y: this.tp.y + Math.sin(this.aimT * sp * 1.9 + 1) * 34 };
      this.drawCross(this.aim, 0xf0f4ff);
    } else if (this.state === 'power') {
      this.drawCross(this.lock, 0x6ff0e0);
      this.powerT += delta / 1000;
      this.power = (Math.sin(this.powerT * (3.2 + this.n * 0.15) - Math.PI / 2) + 1) / 2;
      const x = 30, y = 120, h = 80;
      this.powerG.fillStyle(0x07040c).fillRect(x - 2, y - 2, 12, h + 4);
      this.powerG.fillStyle(0x2a1a44).fillRect(x, y, 8, h);
      this.powerG.fillStyle(0xe0b040, 0.8).fillRect(x, y + h * (1 - IDEAL_POWER - 0.07), 8, h * 0.14);
      this.powerG.fillStyle(0xd8283a).fillRect(x - 3, y + h * (1 - this.power) - 1, 14, 3);
    }
  }

  drawCross(p, color) {
    this.cross.lineStyle(1, color, 1);
    this.cross.strokeCircle(p.x, p.y, 6);
    this.cross.lineBetween(p.x - 10, p.y, p.x - 3, p.y); this.cross.lineBetween(p.x + 3, p.y, p.x + 10, p.y);
    this.cross.lineBetween(p.x, p.y - 10, p.x, p.y - 3); this.cross.lineBetween(p.x, p.y + 3, p.x, p.y + 10);
  }

  throwBottle(power) {
    this.state = 'flying';
    this.hint.setText('');
    // Ошибка силы: недобросил — ниже, перебросил — выше. Плюс снос ветром.
    const land = { x: this.lock.x + this.wind * 14, y: this.lock.y + (IDEAL_POWER - power) * 110 };
    const b = this.inHand; this.inHand = null;
    const start = { x: b.x, y: b.y };
    const peak = Math.min(start.y, land.y) - 70;
    const tween = { t: 0 };
    this.tweens.add({
      targets: tween, t: 1, duration: 650, ease: 'Linear',
      onUpdate: () => {
        const t = tween.t;
        b.x = Phaser.Math.Linear(start.x, land.x, t);
        b.y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * peak + t * t * land.y; // квадратичная кривая
        b.angle += 18;
      },
      onComplete: () => this.resolve(b, land),
    });
    this.hero.play({ key: `${this.heroId}_attack`, frameRate: 16 });
    this.hero.once('animationcomplete', () => this.hero.play(`${this.heroId}_idle`));
    this.sfx('s_throw');
  }

  resolve(b, land) {
    const tp = this.tp;
    const d = Phaser.Math.Distance.Between(land.x, land.y, tp.x, tp.y);
    const onTrunk = Math.abs(land.x - this.treeX) < 11 && land.y > 40 && land.y < 205;
    const hit = d <= tp.r + 3;
    if (hit) {
      this.hits++;
      b.destroy();
      this.glass.explode(22, land.x, land.y);
      this.sfx('s_glass');
      this.cameras.main.shake(100, 0.004);
      this.big.setText(this.target.type === 'squirrel' ? 'БЕЛКА В АУТЕ!' : 'ПОПАЛ!');
    } else if (onTrunk) {
      b.destroy();
      this.glass.explode(12, land.x, land.y);
      this.sfx('s_glass', { volume: 0.6 });
      this.big.setText('Не туда, но дзынь');
    } else {
      this.tweens.add({ targets: b, y: 230, angle: b.angle + 200, duration: 400, ease: 'Quad.in', onComplete: () => b.destroy() });
      this.big.setText('Мимо');
    }
    this.counter.setText(`Бутылка ${this.n}/${TOTAL} · попаданий ${this.hits}`);
    this.time.delayedCall(1100, () => this.nextBottle());
  }

  finish() {
    this.state = 'done';
    this.targetLabel.setText('');
    this.big.setText(`Итог: ${this.hits} из ${TOTAL}`);
    this.sub.setText('Пробел — вернуться в лес');
    this.input.keyboard.once('keydown-SPACE', () => {
      this.scene.stop();
      this.scene.resume('Forest', { from: 'bottles', hits: this.hits });
    });
  }
}
