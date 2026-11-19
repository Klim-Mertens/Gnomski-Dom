import Phaser from 'phaser';
import { HEROES, HERO_IDS } from '../data/heroes.js';
import { txt } from '../systems/ui.js';
import { load, defaultSave, save, wipe } from '../systems/save.js';

// Экран предупреждения 18+ и выбора героя
export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.starting = false;
    const W = this.scale.width, H = this.scale.height;
    this.cameras.main.setBackgroundColor('#0b0612');

    // Звёзды-пепел на фоне
    this.add.particles(0, 0, 'px', {
      x: { min: 0, max: W }, y: -4, lifespan: 9000, speedY: { min: 6, max: 14 },
      speedX: { min: -4, max: 4 }, scale: { min: 0.3, max: 0.8 }, alpha: { start: 0.6, end: 0 },
      tint: [0x8a8090, 0xd8283a], frequency: 220,
    });

    txt(this, W / 2, 22, 'ПЕПЕЛ И ШИШКИ', 20, '#d8283a', { origin: 0.5, bold: true, strokeThickness: 3 });
    txt(this, W / 2, 42, 'прототип · только для взрослых (18+): мат, кровь, медведи', 7, '#8a8090', { origin: 0.5 });

    this.saveData = load();
    this.sel = this.saveData ? HERO_IDS.indexOf(this.saveData.hero) : 0;
    this.cards = HERO_IDS.map((id, i) => {
      const x = W / 2 + (i - 1) * 140, y = 130;
      const frame = this.add.rectangle(x, y, 120, 128, 0x140c1e, 0.9).setStrokeStyle(1, 0x3a3054);
      const spr = this.add.image(x, y - 22, id).setScale(1.5);
      const h = HEROES[id];
      txt(this, x, y + 22, h.name, 10, '#e8dccc', { origin: 0.5, bold: true });
      txt(this, x, y + 33, h.title, 7, '#6ff0e0', { origin: 0.5 });
      txt(this, x, y + 50, h.desc, 6, '#a898a8', { origin: 0.5, align: 'center', wrap: 108 });
      frame.setInteractive({ useHandCursor: true })
        .on('pointerover', () => { this.sel = i; this.refresh(); })
        .on('pointerdown', () => { this.sel = i; this.start(); });
      return { frame, spr, id };
    });

    const contLabel = this.saveData ? `Enter — продолжить за ${HEROES[this.saveData.hero].name} (ур. ${this.saveData.level})   ·   N — новая игра` : 'Enter или клик — начать';
    txt(this, W / 2, 214, '← → выбрать героя.  Двое других пойдут спутниками.', 7, '#c8b8a8', { origin: 0.5 });
    txt(this, W / 2, 228, contLabel, 7, '#e0b040', { origin: 0.5 });
    txt(this, W / 2, 252, 'WASD — ходить · ЛКМ/J — удар · Пробел — перекат · R — ярость · E — действие', 6, '#6a6078', { origin: 0.5 });

    const k = this.input.keyboard;
    k.on('keydown-LEFT', () => { this.sel = (this.sel + 2) % 3; this.refresh(); });
    k.on('keydown-A', () => { this.sel = (this.sel + 2) % 3; this.refresh(); });
    k.on('keydown-RIGHT', () => { this.sel = (this.sel + 1) % 3; this.refresh(); });
    k.on('keydown-D', () => { this.sel = (this.sel + 1) % 3; this.refresh(); });
    k.on('keydown-ENTER', () => this.start(true));
    k.on('keydown-N', () => { wipe(); this.saveData = null; this.start(); });
    this.refresh();
  }

  refresh() {
    this.cards.forEach((c, i) => {
      const on = i === this.sel;
      c.frame.setStrokeStyle(on ? 2 : 1, on ? HEROES[c.id].color : 0x3a3054);
      c.spr.setAlpha(on ? 1 : 0.55);
      this.tweens.killTweensOf(c.spr);
      c.spr.y = 108;
      if (on) this.tweens.add({ targets: c.spr, y: 104, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });
  }

  start(continueIfSaved = false) {
    if (this.starting) return; // защита от двойного запуска
    this.starting = true;
    const hero = HERO_IDS[this.sel];
    let data = continueIfSaved && this.saveData ? this.saveData : defaultSave(hero);
    if (data.hero !== hero) data = defaultSave(hero);
    save(data);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Forest', { save: data }));
  }
}
