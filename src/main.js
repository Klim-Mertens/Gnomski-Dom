import Phaser from 'phaser';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/press-start-2p/400.css';
import { BootScene } from './scenes/Boot.js';
import { IntroScene } from './scenes/Intro.js';
import { TitleScene } from './scenes/Title.js';
import { ForestScene } from './scenes/Forest.js';
import { HudScene } from './scenes/Hud.js';
import { BottlesScene } from './scenes/Bottles.js';
import { CityScene } from './scenes/City.js';
import { FortressScene } from './scenes/Fortress.js';
import { ChapterScene } from './scenes/Chapter.js';

// Внутреннее разрешение 480x270 — растягивается до экрана ровно в целое число раз.
// Ждём загрузки шрифтов, иначе первый текст отрисуется запасным шрифтом
await Promise.all([
  document.fonts.load('500 16px "Alegreya Sans"', 'Ая'),
  document.fonts.load('700 16px "Alegreya Sans"', 'Ая'),
  document.fonts.load('16px "Press Start 2P"', 'Ая1'),
]).catch(() => {});

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
  scene: [BootScene, IntroScene, TitleScene, ChapterScene, ForestScene, CityScene, FortressScene, HudScene, BottlesScene],
});

// Для отладки из консоли браузера: window.game.scene.getScene('Forest')
window.game = game;
