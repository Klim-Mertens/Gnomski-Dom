import Phaser from 'phaser';
import { HEROES, HERO_IDS } from '../data/heroes.js';
import { txt } from '../systems/ui.js';
import { load, defaultSave, save, wipe } from '../systems/save.js';
import { buildLandscape } from './Intro.js';
import { audio } from '../systems/audio.js';

// Экран предупреждения 18+ и выбора героя
export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.starting = false;
    const W = this.scale.width, H = this.scale.height;
    audio(this.game).music('m_title', this);
    this.land = buildLandscape(this);
    this.land.pan(160);
    this.add.rectangle(0, 0, W, H, 0x07040c, 0.45).setOrigin(0);   // затемнение под меню
    this.cameras.main.fadeIn(800);

    txt(this, W / 2, 22, 'ПЕПЕЛ И ШИШКИ', 22, '#d8283a', { origin: 0.5, pixel: true, strokeThickness: 4 });
    txt(this, W / 2, 42, 'только для взрослых (18+): мат, кровь и медведи', 8, '#b0a4b8', { origin: 0.5 });

    this.saveData = load();
    this.sel = this.saveData ? HERO_IDS.indexOf(this.saveData.hero) : 0;
    this.cards = HERO_IDS.map((id, i) => {
      const x = W / 2 + (i - 1) * 140, y = 128;
      const frame = this.add.rectangle(x, y + 5, 128, 158, 0x0d0814, 0.82).setStrokeStyle(1, 0x3a3054);
      const spr = this.add.sprite(x, y + 4, id).setOrigin(0.5, 0.97).play(`${id}_idle`);
      const h = HEROES[id];
      txt(this, x, y + 15, h.name, 11, '#e8dccc', { origin: 0.5, bold: true });
      txt(this, x, y + 28, h.title, 8, '#6ff0e0', { origin: 0.5 });
      txt(this, x, y + 37, h.desc, 8, '#b8acb8', { origin: [0.5, 0], align: 'center', wrap: 112 });
      frame.setInteractive({ useHandCursor: true })
        .on('pointerover', () => { this.sel = i; this.refresh(); })
        .on('pointerdown', () => { this.sel = i; this.start(); });
      return { frame, spr, id };
    });

    const contLabel = this.saveData ? `Enter — продолжить за ${HEROES[this.saveData.hero].name} (ур. ${this.saveData.level})   ·   N — новая игра` : 'Enter или клик — начать';
    txt(this, W / 2, 219, '← → выбрать героя.  Двое других пойдут спутниками.', 8, '#c8b8a8', { origin: 0.5 });
    txt(this, W / 2, 233, contLabel, 8, '#e0b040', { origin: 0.5 });
    txt(this, W / 2, 254, 'WASD — ходить · ЛКМ/J — удар · Пробел — перекат · R — ярость · E — действие · M — звук', 7, '#8a7e98', { origin: 0.5 });

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
    if (this.lastSel !== undefined && this.lastSel !== this.sel) audio(this.game).sfx('s_click');
    this.lastSel = this.sel;
    this.cards.forEach((c, i) => {
      const on = i === this.sel;
      c.frame.setStrokeStyle(on ? 2 : 1, on ? HEROES[c.id].color : 0x3a3054);
      c.spr.setAlpha(on ? 1 : 0.5);
      if (on && c.spr.anims.currentAnim?.key !== `${c.id}_walk`) c.spr.play(`${c.id}_walk`);
      if (!on && c.spr.anims.currentAnim?.key !== `${c.id}_idle`) c.spr.play(`${c.id}_idle`);
    });
  }

  start(continueIfSaved = false) {
    if (this.starting) return; // защита от двойного запуска
    this.starting = true;
    const hero = HERO_IDS[this.sel];
    let data = continueIfSaved && this.saveData ? this.saveData : defaultSave(hero);
    if (data.hero !== hero) data = defaultSave(hero);
    save(data);
    audio(this.game).sfx('s_swing_heavy');
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Forest', { save: data }));
  }
}
