import Phaser from 'phaser';
import { buildCharacterTextures, buildWorldTextures } from '../gfx/sprites.js';

// Генерирует все текстуры кодом (внешних картинок пока нет)
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    buildCharacterTextures(this);
    buildWorldTextures(this);
    this.scene.start('Title');
  }
}
