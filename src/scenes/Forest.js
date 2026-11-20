import Phaser from 'phaser';
import { PHRASES, HERMIT, CAMPFIRE_LINES } from '../data/texts.js';
import { WORLD } from '../gfx/palette.js';
import { save } from '../systems/save.js';
import { FieldScene, ORIGIN_Y } from './Field.js';

// Лес Хмарь: вид сверху, туман, лучи света сквозь кроны.
const CAMPFIRE = { x: 300, y: 690 };
const HERMIT_POS = { x: 1420, y: 640 };
const EAST_EXIT = { x: 1540, y: 655 };   // тропа уходит на восток — к Остенграду

const SPAWNS = [
  { type: 'hollow', x: 700, y: 600, n: 2 },
  { type: 'wolf', x: 900, y: 400, n: 3 },
  { type: 'hollow', x: 1150, y: 880, n: 3 },
  { type: 'wolf', x: 1300, y: 330, n: 2 },
  { type: 'hollow', x: 600, y: 260, n: 2 },
  { type: 'hollow', x: 1080, y: 620, n: 1 },
];

const STINK_MS = 3 * 60 * 1000; // сколько воняет после бутылки

export class ForestScene extends FieldScene {
  constructor() { super('Forest'); }

  spawnPoint() {
    return this.entry === 'city' ? { x: EAST_EXIT.x - 30, y: EAST_EXIT.y } : { x: CAMPFIRE.x + 36, y: CAMPFIRE.y + 30 };
  }

  respawnPoint() { return { x: CAMPFIRE.x + 36, y: CAMPFIRE.y + 30 }; }

  onEnter() {
    if (this.entry !== 'start') return;
    this.dialogue.show(this.hero.name, [
      'Рота осталась позади. Теперь мы дезертиры, а лес — наш дом.',
      'У костра можно отдохнуть (E). На востоке, у тропы, живёт отшельник. А дальше — Остенград.',
    ]);
  }

  onRespawn() { this.rest(); }

  calmMusic() {
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, CAMPFIRE.x, CAMPFIRE.y);
    return d < 110 ? 'm_campfire' : 'm_forest';
  }

  create() {
    super.create();
    // слушатель снимаем при выходе, иначе при каждом заходе в лес он бы добавлялся заново
    this.events.on('resume', this.handleResume, this);
  }

  onShutdown() {
    this.fireLoop?.stop();
    this.events.off('resume', this.handleResume, this);
  }

  handleResume(_sys, data) { this.onResume(data); }

  spawnEnemies() {
    SPAWNS.forEach((sp) => {
      for (let i = 0; i < sp.n; i++) this.spawnEnemy(sp.type, sp.x + Phaser.Math.Between(-50, 50), sp.y + Phaser.Math.Between(-40, 40));
    });
  }

  // ---------- МИР ----------
  buildWorld() {
    this.worldW = 1600; this.worldH = 1040;
    this.add.image(0, 0, 'forest_ground').setOrigin(0).setDepth(-10);
    const path = this.cache.json.get('forestPath').path;
    const rnd = new Phaser.Math.RandomDataGenerator(['hmar']);

    // расстояние от точки до тропы (ломаная)
    const distPath = (x, y) => {
      let best = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const [x1, y1] = path[i], [x2, y2] = path[i + 1];
        const dx = x2 - x1, dy = y2 - y1;
        const t = Phaser.Math.Clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
        best = Math.min(best, Phaser.Math.Distance.Between(x, y, x1 + dx * t, y1 + dy * t));
      }
      return best;
    };
    const free = (x, y, pathGap) => distPath(x, y) > pathGap
      && Phaser.Math.Distance.Between(x, y, CAMPFIRE.x, CAMPFIRE.y) > 120
      && Phaser.Math.Distance.Between(x, y, HERMIT_POS.x, HERMIT_POS.y) > 90;

    // Деревья: сетка с разбросом, гуще по краям мира. Коллизия — только у ствола.
    this.treeImgs = [];
    const addTree = (x, y) => {
      const big = rnd.frac() < 0.35;
      const img = this.add.image(x, y, `tree${big ? rnd.between(3, 4) : rnd.between(0, 2)}`)
        .setOrigin(0.52, 0.98).setDepth(y).setFlipX(rnd.frac() < 0.5);
      const sh = 0.82 + rnd.frac() * 0.18;          // лёгкая разница в тоне — лес не выглядит копипастой
      img.setTint(Phaser.Display.Color.GetColor(255 * sh, 255 * Math.min(1, sh + 0.05), 255 * sh));
      this.treeImgs.push(img);
      this.addBlock(x, y - 4, big ? 16 : 12, 8);
    };
    for (let y = 40; y < this.worldH + 40; y += 44) {
      for (let x = 10; x < this.worldW; x += 46) {
        const tx = x + rnd.between(-18, 18), ty = y + rnd.between(-16, 16);
        const edge = Math.min(tx, ty, this.worldW - tx, this.worldH - ty) < 70;
        if (!free(tx, ty, 58)) continue;
        if (edge || rnd.frac() < 0.36) addTree(tx, ty);
      }
    }

    // Подлесок: кусты, папоротники, камни
    for (let i = 0; i < 260; i++) {
      const x = rnd.between(10, this.worldW - 10), y = rnd.between(10, this.worldH - 10);
      if (!free(x, y, 30)) continue;
      const r = rnd.frac();
      const key = r < 0.4 ? `fern${rnd.between(0, 1)}` : r < 0.8 ? `bush${rnd.between(0, 2)}` : `rock${rnd.between(0, 1)}`;
      this.add.image(x, y, key).setOrigin(0.5, 0.95).setDepth(y).setFlipX(rnd.frac() < 0.5);
    }

    // Костёр: камни, огонь, тёплый свет на земле
    this.add.image(CAMPFIRE.x, CAMPFIRE.y, 'campfire').setScale(1.5).setDepth(CAMPFIRE.y - 1);
    const g1 = this.add.image(CAMPFIRE.x, CAMPFIRE.y - 4, 'glow').setScale(3.2).setTint(0xff8a2a)
      .setAlpha(0.35).setBlendMode('ADD').setDepth(-5);
    const g2 = this.add.image(CAMPFIRE.x, CAMPFIRE.y - 6, 'glow').setScale(1.1).setTint(0xffc060)
      .setAlpha(0.6).setBlendMode('ADD').setDepth(CAMPFIRE.y + 1);
    this.tweens.add({ targets: g1, scale: 3.5, alpha: 0.45, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: g2, scale: 1.25, duration: 180, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.add.particles(CAMPFIRE.x, CAMPFIRE.y - 4, 'px', {
      x: { min: -5, max: 5 }, speedY: { min: -46, max: -20 }, speedX: { min: -6, max: 6 },
      lifespan: { min: 300, max: 760 }, scale: { start: 1.8, end: 0.2 }, tint: WORLD.fire,
      blendMode: 'ADD', frequency: 25,
    }).setDepth(CAMPFIRE.y);
    this.add.particles(CAMPFIRE.x, CAMPFIRE.y - 10, 'px', {
      speedY: { min: -70, max: -40 }, speedX: { min: -14, max: 14 }, lifespan: 1400,
      scale: { start: 0.6, end: 0.1 }, tint: 0xffd070, blendMode: 'ADD', frequency: 260,
    }).setDepth(CAMPFIRE.y + 2);
    this.addInteractable(CAMPFIRE.x, CAMPFIRE.y, 56, '[E] отдохнуть', '#ffe08a', () => this.rest(), -34);
    this.fireLoop = this.sound.add('s_fire', { loop: true, volume: 0 });
    this.fireLoop.play();

    // Отшельник с фонарём на посохе
    this.hermit = this.add.sprite(HERMIT_POS.x, HERMIT_POS.y, 'hermit', 0).setOrigin(0.5, ORIGIN_Y).setDepth(HERMIT_POS.y);
    this.hermit.play('hermit_idle');
    this.addBlock(HERMIT_POS.x, HERMIT_POS.y - 4, 18, 10);
    this.hermitLamp = this.add.image(HERMIT_POS.x + 15, HERMIT_POS.y - 62, 'glow').setTint(0xffc070)
      .setScale(1.6).setAlpha(0.55).setBlendMode('ADD').setDepth(HERMIT_POS.y + 1);
    this.tweens.add({ targets: this.hermitLamp, alpha: 0.75, scale: 1.75, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.addInteractable(HERMIT_POS.x, HERMIT_POS.y, 54, '[E] поговорить', '#6ff0e0', () => this.talkHermit(), -76);

    // Выход на восток: указатель и переход в город
    this.addInteractable(EAST_EXIT.x + 20, EAST_EXIT.y, 70, '→ Остенград', '#e0b040', () => {}, -50);
    this.addExit(this.worldW - 24, EAST_EXIT.y - 90, 24, 180, () => this.toCity());
  }

  toCity() {
    const first = !this.saveData.flags.seenCity;
    this.saveData.flags.seenCity = true;
    this.registry.set('stinkUntil', 0);
    if (first) this.leaveTo('Chapter', { chapter: 'city', next: 'City', entry: 'forest' });
    else this.leaveTo('City', { entry: 'forest' });
  }

  // ---------- АТМОСФЕРА ----------
  buildAtmosphere() {
    const W = this.scale.width, H = this.scale.height;
    const rnd = new Phaser.Math.RandomDataGenerator(['rays']);
    for (let i = 0; i < 14; i++) {
      const r = this.add.image(rnd.between(80, this.worldW - 80), rnd.between(80, this.worldH - 60), 'ray')
        .setOrigin(0.5, 0.9).setBlendMode('ADD').setTint(0xe8ffc8).setAlpha(0.5).setDepth(6400)
        .setScale(rnd.realInRange(0.8, 1.3));
      this.tweens.add({ targets: r, alpha: 0.2, duration: rnd.between(2500, 5000), yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: rnd.between(0, 3000) });
    }
    this.fogA = this.add.tileSprite(0, 0, W, H, 'fog0').setOrigin(0).setScrollFactor(0).setDepth(6500).setTint(0xd8f0d8).setAlpha(0.9);
    this.fogB = this.add.tileSprite(0, 0, W, H, 'fog1').setOrigin(0).setScrollFactor(0).setDepth(6501).setTint(0xc8e8d0).setAlpha(0.7);
    this.add.particles(0, 0, 'px', {
      x: { min: 0, max: this.worldW }, y: { min: 0, max: this.worldH }, lifespan: 4000,
      speedX: { min: -6, max: 6 }, speedY: { min: -6, max: 6 },
      scale: { start: 0.8, end: 0.2 }, alpha: { start: 0, end: 0.9, ease: 'Sine.inOut' },
      tint: [0xd8ff9a, 0x6ff0e0, 0xfff0b0], blendMode: 'ADD', frequency: 90,
    }).setDepth(6000);
  }

  updateWorld(time) {
    const cam = this.cameras.main;
    this.fogA.tilePositionX = cam.scrollX * 0.9 + time * 0.006;
    this.fogA.tilePositionY = cam.scrollY * 0.9 + Math.sin(time / 7000) * 10;
    this.fogB.tilePositionX = cam.scrollX * 1.2 - time * 0.01;
    this.fogB.tilePositionY = cam.scrollY * 1.2;

    // Кроны над героем становятся полупрозрачными, чтобы его было видно
    const actors = [this.player, ...this.companions];
    for (const t of this.treeImgs) {
      if (Math.abs(t.x - this.player.x) > 120 || Math.abs(t.y - this.player.y) > 160) { if (t.alpha < 1) t.setAlpha(Math.min(1, t.alpha + 0.08)); continue; }
      const hide = actors.some((a) => a.y < t.y - 2 && a.y > t.y - t.displayHeight * 0.95 && Math.abs(a.x - t.x) < t.displayWidth * 0.42);
      t.setAlpha(Phaser.Math.Linear(t.alpha, hide ? 0.45 : 1, 0.15));
    }
    // Треск костра громче вблизи
    const fd = Phaser.Math.Distance.Between(this.player.x, this.player.y, CAMPFIRE.x, CAMPFIRE.y);
    this.fireLoop.setVolume(Phaser.Math.Clamp(1 - fd / 260, 0, 1) * 0.6);
  }

  // ---------- ВЗАИМОДЕЙСТВИЕ ----------
  rest() {
    this.recalc(true);
    this.reviveAll();
    this.clearEnemies();
    this.spawnEnemies();
    save(this.saveData);
    this.sfx('s_heal', { volume: 0.6 });
    this.cameras.main.flash(400, 255, 150, 60);
    this.dialogue.show('У костра', [
      Phaser.Utils.Array.GetRandom(CAMPFIRE_LINES),
      `«${Phaser.Utils.Array.GetRandom(PHRASES)}»`,
      'Здоровье восстановлено. Игра сохранена. Твари в лесу снова проснулись.',
    ]);
  }

  talkHermit() {
    this.hermit.setFlipX(this.player.x < this.hermit.x);
    this.hermitLamp.x = HERMIT_POS.x + (this.hermit.flipX ? -15 : 15);
    if (this.saveData.flags.bottlesDone) {
      return this.dialogue.show(HERMIT.name, HERMIT.again);
    }
    this.dialogue.show(HERMIT.name, HERMIT.intro, () => {
      this.player.setVelocity(0);
      this.fireLoop.setVolume(0);
      this.scene.pause();
      this.scene.pause('Hud');
      this.scene.launch('Bottles', { hero: this.heroId });
    });
  }

  onResume(data) {
    this.scene.resume('Hud');
    this.musicMode = null; this.nextMusicCheck = 0;   // вернуть лесную музыку
    if (!data || data.from !== 'bottles') return;
    this.saveData.flags.bottlesDone = true;
    this.st.stinkUntil = this.time.now + STINK_MS;
    const xp = 10 + data.hits * 6;
    this.dialogue.show(HERMIT.name, [
      ...HERMIT.after,
      `Попаданий: ${data.hits} из 10. Опыт +${xp}. Ты смердишь ещё 3 минуты: звери разбегаются, спутники держатся подальше.`,
    ], () => {
      this.gainXp(xp);
      this.companions.forEach((c, i) => this.time.delayedCall(400 + i * 1400, () => this.bark(c, 'stink')));
    });
    save(this.saveData);
  }
}
