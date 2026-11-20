import Phaser from 'phaser';
import { txt } from '../systems/ui.js';
import { audio } from '../systems/audio.js';

// Катсцены: слои пейзажа с параллаксом, снег, туман и титры.
// Наборы слоёв: [картинка, скорость параллакса]
export const LAYER_SETS = {
  snow: [['cs_sky', 0.05], ['cs_mtn_far', 0.15], ['cs_fog_far', 0.25], ['cs_mtn_near', 0.35],
    ['cs_pines_far', 0.55], ['cs_tower', 0.6], ['cs_fog_near', 0.8], ['cs_pines_near', 1.0]],
  city: [['cs2_sky', 0.05], ['cs2_castle', 0.2], ['cs2_fog', 0.3], ['cs2_roofs_far', 0.55],
    ['cs2_roofs_near', 0.8], ['cs2_street', 1.0]],
  fortress: [['cs3_sky', 0.05], ['cs3_fog_far', 0.2], ['cs3_cliffs', 0.4], ['cs3_fortress', 0.4], ['cs3_fog_near', 0.9]],
};
// Что летит в воздухе: снег, редкий туман, пепел
const WEATHER = {
  snow: { tint: 0xe8f0ff, speedY: { min: 14, max: 30 }, speedX: { min: -12, max: -2 }, frequency: 45, alpha: { min: 0.5, max: 0.9 } },
  city: { tint: 0xc8d0ff, speedY: { min: 3, max: 8 }, speedX: { min: -3, max: 3 }, frequency: 260, alpha: { min: 0.2, max: 0.5 } },
  fortress: { tint: [0xd0a0ff, 0xffa060], speedY: { min: -10, max: 6 }, speedX: { min: 6, max: 18 }, frequency: 70, alpha: { min: 0.4, max: 0.9 }, blendMode: 'ADD' },
};

const CAPTIONS = [
  'Королевство Остенград. Двадцатый год правления Регента Аурелия.',
  'Регент дал народу «Покой» — зелье, которое забирает боль, страх и сомнения.',
  'Город стал счастливым. И пустым.',
  'Серая Рота не задаёт вопросов. Серая Рота жжёт деревни, где «Покой» не пьют.',
  'Но этой ночью трое отказались жечь.',
];

// Общая функция: построить пейзаж катсцены в любой сцене (используется и в меню)
export function buildLandscape(scene, depth = 0, set = 'snow') {
  const layers = LAYER_SETS[set].map(([k, f]) => scene.add.image(0, -15, k).setOrigin(0).setDepth(depth).setData('f', f));
  const W = scene.scale.width, H = scene.scale.height;
  const w = WEATHER[set];
  const snow = scene.add.particles(0, 0, 'px', {
    x: { min: -20, max: W + 40 }, y: set === 'snow' ? -6 : { min: 0, max: H }, lifespan: 7000,
    scale: { min: 0.4, max: 1 }, ...w,
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
