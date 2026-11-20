import Phaser from 'phaser';
import { txt } from '../systems/ui.js';
import { audio } from '../systems/audio.js';
import { CHAPTERS } from '../data/texts.js';
import { buildLandscape } from './Intro.js';

// Катсцена между главами: пейзаж с параллаксом, название главы и пара строк истории.
const MUSIC = { city: 'm_city', fortress: 'm_fortress' };

export class ChapterScene extends Phaser.Scene {
  constructor() { super('Chapter'); }

  init(data) { this.data_ = data; this.done = false; }

  create() {
    const { chapter } = this.data_;
    const W = this.scale.width, H = this.scale.height;
    const ch = CHAPTERS[chapter];
    audio(this.game).music(MUSIC[chapter], this, 2000);
    this.land = buildLandscape(this, 0, chapter);
    this.panT = 0;
    this.cameras.main.fadeIn(1800);

    this.add.rectangle(0, 0, W, 26, 0x000000).setOrigin(0).setDepth(10);
    this.add.rectangle(0, H - 40, W, 40, 0x000000).setOrigin(0).setDepth(10);
    const title = txt(this, W / 2, 56, ch.title, 14, '#e8dccc', { origin: 0.5, pixel: true, strokeThickness: 4 }).setDepth(11).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 1500, delay: 600 });
    this.tweens.add({ targets: title, alpha: 0, duration: 1200, delay: 5200 });
    this.caption = txt(this, W / 2, H - 20, '', 10, '#e8dccc', { origin: 0.5, align: 'center', wrap: 440 }).setDepth(11);
    txt(this, W - 8, 13, 'Пробел — пропустить', 8, '#8a7e98', { origin: [1, 0.5] }).setDepth(11);

    let i = 0;
    const next = () => {
      if (i >= ch.lines.length) return this.finish();
      this.caption.setAlpha(0).setText(ch.lines[i++]);
      this.tweens.add({ targets: this.caption, alpha: 1, duration: 900 });
      this.tweens.add({ targets: this.caption, alpha: 0, duration: 700, delay: 4300 });
      this.time.delayedCall(5200, next);
    };
    this.time.delayedCall(2200, next);
    this.input.keyboard.on('keydown-SPACE', () => this.finish());
    this.input.keyboard.on('keydown-ENTER', () => this.finish());
  }

  update(_t, dt) {
    this.panT = Math.min(160, this.panT + dt * 0.008);
    this.land.pan(this.panT);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const { next, save, entry } = this.data_;
    this.cameras.main.fadeOut(1200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(next, { save, entry }));
  }
}
