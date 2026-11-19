import Phaser from 'phaser';
import { HEROES } from '../data/heroes.js';
import { xpForLevel } from '../data/heroes.js';
import { txt } from '../systems/ui.js';

// Интерфейс поверх леса: здоровье, выносливость, ярость, опыт, спутники
export class HudScene extends Phaser.Scene {
  constructor() { super('Hud'); }

  create() {
    this.forest = this.scene.get('Forest');
    this.g = this.add.graphics();
    this.lvl = txt(this, 8, 6, '', 8, '#e0b040', { bold: true });
    this.rageHint = txt(this, 118, 30, 'R!', 8, '#ff9a3a', { bold: true }).setVisible(false);
    this.status = txt(this, 8, 52, '', 7, '#8ad040');
    this.compNames = this.forest.companions.map((c, i) =>
      txt(this, this.scale.width - 8, 8 + i * 18, HEROES[c.cid].name, 7, '#c8b8a8', { origin: [1, 0] }));
    this.noStamFlash = 0;
    this.forest.events.on('noStamina', () => { this.noStamFlash = this.time.now + 300; });
  }

  bar(x, y, w, h, frac, color, back = 0x1a1024) {
    this.g.fillStyle(0x07040c, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    this.g.fillStyle(back, 1).fillRect(x, y, w, h);
    this.g.fillStyle(color, 1).fillRect(x, y, Math.max(0, Math.round(w * Phaser.Math.Clamp(frac, 0, 1))), h);
    this.g.fillStyle(0xffffff, 0.18).fillRect(x, y, Math.round(w * Phaser.Math.Clamp(frac, 0, 1)), 1);
  }

  update(time) {
    const f = this.forest;
    if (!f.st) return;
    const st = f.st, d = f.d, s = f.saveData;
    this.g.clear();
    this.lvl.setText(`${HEROES[f.heroId].name} · ур. ${s.level}`);
    this.bar(8, 18, 104, 6, st.hp / d.maxHp, 0xd8283a);
    this.bar(8, 27, 104, 3, st.stamina / d.maxStamina, time < this.noStamFlash ? 0xffffff : 0x6ff0e0);
    const rageFull = st.rage >= 100 && !st.raging;
    this.bar(8, 33, 104, 3, st.raging ? (st.raging - time) / 7000 : st.rage / 100, st.raging || rageFull ? 0xff6030 : 0x9a4a20);
    this.rageHint.setVisible(rageFull && Math.floor(time / 300) % 2 === 0);
    this.bar(8, 41, 104, 2, s.xp / xpForLevel(s.level), 0xe0b040);

    f.companions.forEach((c, i) => {
      const y = 18 + i * 18;
      this.bar(this.scale.width - 72, y, 64, 3, c.hp / c.maxHp, c.down ? 0x5a5464 : 0x6ff0e0);
      this.compNames[i].setColor(c.down ? '#6a6078' : '#c8b8a8')
        .setText(HEROES[c.cid].name + (c.down ? ' (поднять: стой рядом)' : ''));
    });

    const left = st.stinkUntil - f.time.now;
    if (left > 0) {
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
      this.status.setText(`☁ Смердящий ${m}:${sec}`);
    } else this.status.setText('');
  }
}
