import Phaser from 'phaser';
import { txt } from '../systems/ui.js';
import { audio } from '../systems/audio.js';

// Катсцены: слои пейзажа с параллаксом, снег, туман и титры.
const LAYERS = [
  ['cs_sky', 0.05], ['cs_mtn_far', 0.15], ['cs_fog_far', 0.25], ['cs_mtn_near', 0.35],
  ['cs_pines_far', 0.55], ['cs_tower', 0.6], ['cs_fog_near', 0.8], ['cs_pines_near', 1.0],
];

const CAPTIONS = [
  'Королевство Остенград. Двадцатый год правления Регента Аурелия.',
  'Регент дал народу «Покой» — зелье, которое забирает боль, страх и сомнения.',
  'Город стал счастливым. И пустым.',
  'Серая Рота не задаёт вопросов. Серая Рота жжёт деревни, где «Покой» не пьют.',
  'Но этой ночью трое отказались жечь.',
];

// Общая функция: построить пейзаж катсцены в любой сцене (используется и в меню)
export function buildLandscape(scene, depth = 0) {
  const layers = LAYERS.map(([k, f]) => scene.add.image(0, -15, k).setOrigin(0).setDepth(depth).setData('f', f));
  const W = scene.scale.width;
  const snow = scene.add.particles(0, 0, 'px', {
    x: { min: -20, max: W + 40 }, y: -6, lifespan: 7000, speedY: { min: 14, max: 30 }, speedX: { min: -12, max: -2 },
    scale: { min: 0.4, max: 1 }, alpha: { min: 0.5, max: 0.9 }, tint: 0xe8f0ff, frequency: 45,
  }).setDepth(depth + 1);
  return {
    layers, snow,
    pan(t) { layers.forEach((l) => { l.x = -t * l.getData('f'); }); },
  };
}

export class IntroScene extends Phaser.Scene {
  constructor() { super('Intro'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    audio(this.game).music('m_title', this, 2500);
    this.land = buildLandscape(this);
    this.panT = 0;
    this.cameras.main.fadeIn(2000);

    // Чёрные полосы кино
    this.add.rectangle(0, 0, W, 26, 0x000000).setOrigin(0).setDepth(10);
    this.add.rectangle(0, H - 40, W, 40, 0x000000).setOrigin(0).setDepth(10);
    this.caption = txt(this, W / 2, H - 20, '', 10, '#e8dccc', { origin: 0.5, align: 'center', wrap: 440 }).setDepth(11);
    txt(this, W - 8, 13, 'Пробел — пропустить', 7, '#5a5068', { origin: [1, 0.5] }).setDepth(11);

    let i = 0;
    const next = () => {
      if (i >= CAPTIONS.length) return this.finish();
      this.caption.setAlpha(0).setText(CAPTIONS[i++]);
      this.tweens.add({ targets: this.caption, alpha: 1, duration: 900 });
      this.tweens.add({ targets: this.caption, alpha: 0, duration: 700, delay: 4300 });
      this.time.delayedCall(5200, next);
    };
    this.time.delayedCall(1500, next);
    this.input.keyboard.on('keydown-SPACE', () => this.finish());
    this.input.keyboard.on('keydown-ENTER', () => this.finish());
  }

  update(_t, dt) {
    this.panT = Math.min(160, this.panT + dt * 0.006);   // медленный проезд камеры
    this.land.pan(this.panT);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.cameras.main.fadeOut(1200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
  }
}
