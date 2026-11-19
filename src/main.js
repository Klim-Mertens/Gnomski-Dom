import Phaser from 'phaser';
import { BootScene } from './scenes/Boot.js';
import { TitleScene } from './scenes/Title.js';
import { ForestScene } from './scenes/Forest.js';
import { HudScene } from './scenes/Hud.js';
import { BottlesScene } from './scenes/Bottles.js';

// Внутреннее разрешение 480x270 — растягивается до экрана ровно в целое число раз.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 480,
  height: 270,
  pixelArt: true,
  backgroundColor: '#07040c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  input: { gamepad: true },
  scene: [BootScene, TitleScene, ForestScene, HudScene, BottlesScene],
});

// Для отладки из консоли браузера: window.game.scene.getScene('Forest')
window.game = game;
