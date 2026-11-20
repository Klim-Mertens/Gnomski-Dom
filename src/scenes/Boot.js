import Phaser from 'phaser';
import { buildFxTextures } from '../gfx/sprites.js';
import { preloadAudio, audio } from '../systems/audio.js';
import { txt } from '../systems/ui.js';

export const SPRITES = ['valder', 'edrik', 'yarka', 'hollow', 'wolf', 'hermit'];
export const FRAME = 80;
const FPS = { idle: 5, walk: 10, attack: 14, dodge: 16, hurt: 8, dead: 1 };

// Загрузка графики и звука + экран «нажми любую клавишу»
// (браузеры не дают играть звук, пока игрок ничего не нажал)
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    const W = this.scale.width, H = this.scale.height;
    const bar = this.add.rectangle(W / 2 - 100, H / 2, 0, 4, 0xd8283a).setOrigin(0, 0.5);
    this.add.rectangle(W / 2, H / 2, 202, 6).setStrokeStyle(1, 0x3a3054);
    this.load.on('progress', (p) => { bar.width = 200 * p; });

    const G = 'assets/gfx/';
    this.load.json('anims', G + 'anims.json');
    this.load.json('forestPath', G + 'forest_path.json');
    SPRITES.forEach((k) => this.load.spritesheet(k, G + k + '.png', { frameWidth: FRAME, frameHeight: FRAME }));
    ['forest_ground', 'fog0', 'fog1', 'ray',
      'tree0', 'tree1', 'tree2', 'tree3', 'tree4', 'bush0', 'bush1', 'bush2', 'fern0', 'fern1', 'rock0', 'rock1',
      'cs_sky', 'cs_mtn_far', 'cs_fog_far', 'cs_mtn_near', 'cs_pines_far', 'cs_tower', 'cs_fog_near', 'cs_pines_near',
    ].forEach((k) => this.load.image(k, G + k + '.png'));
    preloadAudio(this);
  }

  create() {
    buildFxTextures(this);
    this.makeAnims();
    const W = this.scale.width, H = this.scale.height;
    this.children.removeAll();
    txt(this, W / 2, H / 2 - 10, 'ПЕПЕЛ И ШИШКИ', 16, '#d8283a', { origin: 0.5, pixel: true, strokeThickness: 3 });
    const hint = txt(this, W / 2, H / 2 + 22, 'нажми любую клавишу', 10, '#c8bcd0', { origin: 0.5 });
    txt(this, W / 2, H - 14, 'звук включён · M — выключить', 8, '#8a7e98', { origin: 0.5 });
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    const go = () => {
      audio(this.game).sfx('s_click');
      this.scene.start('Intro');
    };
    this.input.keyboard.once('keydown', go);
    this.input.once('pointerdown', go);
    // M — звук вкл/выкл в любой сцене
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') audio(this.game).toggleMute(); });
  }

  makeAnims() {
    const meta = this.cache.json.get('anims');
    for (const key of SPRITES) {
      for (const [name, [a, b]] of Object.entries(meta[key])) {
        const animKey = `${key}_${name}`;
        if (this.anims.exists(animKey)) continue;
        this.anims.create({
          key: animKey,
          frames: this.anims.generateFrameNumbers(key, { start: a, end: b }),
          frameRate: FPS[name] || 8,
          repeat: ['idle', 'walk'].includes(name) ? -1 : 0,
        });
      }
    }
  }
}
