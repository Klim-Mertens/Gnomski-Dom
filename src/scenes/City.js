import Phaser from 'phaser';
import {
  MERCHANT_SHOUTS, MERCHANT_TALK, BAZAAR_WALK, MARISHKA, CRAZY, GUARD, WELL_LINES,
} from '../data/texts.js';
import { save } from '../systems/save.js';
import { FieldScene } from './Field.js';

// Ночной Остенград: вид сверху, фонари, горящие окна, базар на площади, замок на холме.
const WARM = 0xffb860;

export class CityScene extends FieldScene {
  constructor() { super('City'); }

  spawnPoint() {
    const L = this.cache.json.get('cityLayout');
    if (this.entry === 'fortress') return { x: L.castle.x, y: L.castle.y + 46 };
    return { x: 70, y: L.cross[0] };
  }

  respawnPoint() { const [x, y] = this.L.well; return { x: x + 40, y: y + 40 }; }

  onRespawn() {
    this.dialogue.show(this.hero.name, ['Очнулся у колодца. Кто-то оттащил. Даже карманы не обчистили — нечего было.']);
  }

  calmMusic() { return this.inPlaza() ? 'm_bazaar' : 'm_city'; }

  inPlaza(x = this.player.x, y = this.player.y) {
    const [px, py, rx, ry] = this.L.plaza;
    return ((x - px) / rx) ** 2 + ((y - py) / ry) ** 2 < 1;
  }

  onShutdown() { this.crowd?.stop(); }

  onEnter() {
    if (this.entry === 'forest' && !this.saveData.flags.cityIntro) {
      this.saveData.flags.cityIntro = true;
      save(this.saveData);
      this.dialogue.show(this.hero.name, [
        'Остенград. Пахнет «Покоем», дымом и страхом.',
        'Базар — в центре, на площади. Замок Регента — на холме, к северу.',
      ]);
    }
  }

  // ---------- МИР ----------
  buildWorld() {
    const L = this.L = this.cache.json.get('cityLayout');
    this.worldW = L.w; this.worldH = L.h;
    this.add.image(0, 0, 'city_ground').setOrigin(0).setDepth(-10);
    this.lights = [];
    const light = (x, y, scale, alpha, tint = WARM, flicker = 0) => {
      const g = this.add.image(x, y, 'glow').setScale(scale).setAlpha(alpha).setTint(tint).setBlendMode('ADD').setDepth(6100);
      if (flicker) this.tweens.add({ targets: g, alpha: alpha * (1 - flicker), duration: Phaser.Math.Between(120, 260), yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.lights.push(g);
      return g;
    };

    // Замок на холме. Всё севернее подножия — скала, туда не пройти, кроме ворот.
    const c = L.castle, cm = L.castleMeta;
    this.add.image(c.x, c.y, 'castle').setOrigin(0.5, 1).setDepth(c.y);
    this.addBlock(L.w / 2, (c.y - 14) / 2, L.w, c.y - 14);
    cm.lit.forEach(([lx, ly]) => light(c.x - cm.w / 2 + lx, c.y - cm.h + ly, 0.22, 0.7));
    light(c.x, c.y - 20, 1.6, 0.35, WARM, 0.15);   // свет из ворот

    // Дома: фахверк, горящие окна, дым из труб
    L.houses.forEach((h, i) => {
      const m = L.houseMeta[h.v];
      this.add.image(h.x, h.y, `house${h.v}`).setOrigin(0.5, 1).setDepth(h.y);
      this.addBlock(h.x, h.y - m.h * 0.36, m.w - 6, m.h * 0.72);
      const x0 = h.x - m.w / 2, y0 = h.y - m.h;
      m.lit.forEach(([lx, ly]) => {
        light(x0 + lx, y0 + ly, 0.3, 0.55, WARM, 0.08);
        light(x0 + lx, h.y + 10, 1.2, 0.16);       // отсвет окна на мостовой
      });
      if (i % 3 === 0) {
        this.add.particles(x0 + m.chimney[0], y0 + m.chimney[1], 'px', {
          speedY: { min: -14, max: -8 }, speedX: { min: 2, max: 8 }, lifespan: 3200, frequency: 260,
          scale: { start: 1.5, end: 4 }, alpha: { start: 0.35, end: 0 }, tint: 0x6a6a80,
        }).setDepth(6050);
      }
    });

    // Фонари вдоль улиц
    L.lamps.forEach((l) => {
      this.add.image(l.x, l.y, 'lamp').setOrigin(0.5, 1).setDepth(l.y);
      this.addBlock(l.x, l.y - 2, 6, 4);
      light(l.x, l.y - 42, 0.55, 0.9, 0xffd890, 0.1);
      light(l.x, l.y - 10, 3.2, 0.3, WARM);
    });

    // Базар: лотки и торговцы за ними
    this.merchants = [];
    L.stalls.forEach((s, i) => {
      this.add.image(s.x, s.y, `stall${s.v}`).setOrigin(0.5, 1).setDepth(s.y);
      this.addBlock(s.x, s.y - 8, 50, 16);
      this.merchantSpots = this.merchantSpots || [];
      this.merchantSpots.push({ x: s.x, y: s.y - 20, i });
    });

    const [wx, wy] = L.well;
    this.add.image(wx, wy + 10, 'well').setOrigin(0.5, 1).setDepth(wy + 10);
    this.addBlock(wx, wy + 4, 32, 14);
    this.addInteractable(wx, wy + 10, 40, '[E] попить воды', '#9ad0ff', () => {
      this.st.hp = this.d.maxHp; this.reviveAll();
      this.sfx('s_heal', { volume: 0.6 }); save(this.saveData);
      this.dialogue.show('Колодец', [...WELL_LINES, 'Здоровье восстановлено. Игра сохранена.']);
    }, -36);

    L.props.forEach((p) => {
      this.add.image(p.x, p.y, p.k).setOrigin(0.5, 1).setDepth(p.y);
      this.addBlock(p.x, p.y - 4, 12, 8);
    });

    // Выходы: западные ворота — в лес, ворота замка — в цитадель
    this.addExit(0, L.cross[0] - 50, 14, 100, () => this.leaveTo('Forest', { entry: 'city' }));
    this.addInteractable(40, L.cross[0], 60, '← Лес Хмарь', '#a8e0a0', () => {}, -50);
    this.addExit(c.x - 24, c.y - 14, 48, 16, () => this.toFortress());
  }

  toFortress() {
    const first = !this.saveData.flags.seenFortress;
    this.saveData.flags.seenFortress = true;
    if (first) this.leaveTo('Chapter', { chapter: 'fortress', next: 'Fortress', entry: 'city' });
    else this.leaveTo('Fortress', { entry: 'city' });
  }

  // ---------- ЖИТЕЛИ ----------
  spawnEnemies() {
    const L = this.L;
    // Торговцы за лотками
    this.merchantSpots.forEach((sp) => {
      const m = this.addNpc('merchant', sp.x, sp.y, { flip: sp.x > L.plaza[0] });
      m.setDepth(sp.y);
      this.merchants.push(m);
      const it = this.addInteractable(sp.x, sp.y + 20, 44, '[E] поговорить', '#e8dccc',
        () => this.dialogue.show('Торговец', MERCHANT_TALK[sp.i % MERCHANT_TALK.length]), -70);
      it.follow = null;
    });
    // Маришка бродит у западного края площади
    this.marishka = this.addNpc('marishka', L.plaza[0] - 170, L.plaza[1] + 120, { wander: 70, speed: 20 });
    const im = this.addInteractable(0, 0, 44, '[E] Маришка', '#d870a0', () => this.talkMarishka(), -76);
    im.follow = this.marishka;
    // Сумасшедший мужик у восточного края
    this.crazy = this.addNpc('crazy', L.plaza[0] + 190, L.plaza[1] + 90, { wander: 90, speed: 30 });
    const ic = this.addInteractable(0, 0, 44, '[E] мужик', '#e0b040', () => this.dialogue.show(CRAZY.name, CRAZY.talk), -76);
    ic.follow = this.crazy;
    // Стража у ворот замка
    const c = L.castle;
    this.addNpc('guard', c.x - 44, c.y + 26);
    this.addNpc('guard', c.x + 44, c.y + 26, { flip: true });
    this.addInteractable(c.x - 44, c.y + 26, 44, '[E] стражник', '#9ab0d8', () => this.dialogue.show(GUARD.name, GUARD.talk), -76);
  }

  talkMarishka() {
    this.marishka.setFlipX(this.player.x < this.marishka.x);
    this.dialogue.show(MARISHKA.name, MARISHKA.talk);
  }

  // Мужика можно ударить — он только рад
  onSwing(inArc) {
    const c = this.crazy;
    if (!c || c.npc.down || !inArc(c.x, c.y - 20)) return false;
    c.npc.down = true;
    c.setVelocity(0);
    this.oneShot(c, 'dead', { lock: 1e12 });
    this.blood.explode(8, c.x, c.y - 20);
    this.sfx('s_hit', { volume: 0.7 });
    this.say(c, Phaser.Utils.Array.GetRandom(CRAZY.hit), '#e0b040', 2600, -40);
    this.time.delayedCall(4000, () => {
      c.npc.down = false; c.animLock = 0; this.loco(c, false);
      this.say(c, 'Ещё приходи, пацан!', '#e0b040');
    });
    return true;
  }

  // ---------- АТМОСФЕРА ----------
  buildAtmosphere() {
    const W = this.scale.width, H = this.scale.height;
    // Ночь: всё под лунным светом становится холоднее и темнее, огни — поверх
    this.add.rectangle(0, 0, W, H, 0xb8bce8).setOrigin(0).setScrollFactor(0).setDepth(5900).setBlendMode('MULTIPLY');
    this.mist = this.add.tileSprite(0, 0, W, H, 'fog1').setOrigin(0).setScrollFactor(0).setDepth(6200).setTint(0x9098c8).setAlpha(0.35);
    this.crowd = this.sound.add('s_crowd', { loop: true, volume: 0 });
    this.crowd.play();
    this.nextShout = 0; this.nextCrazy = 0;
  }

  updateWorld(time) {
    const cam = this.cameras.main;
    this.mist.tilePositionX = cam.scrollX * 1.1 + time * 0.008;
    this.mist.tilePositionY = cam.scrollY * 1.1;
    if (this.dead || this.leaving) return;
    const p = this.player, [px, py] = this.L.plaza;
    const d = Phaser.Math.Distance.Between(p.x, p.y, px, py);
    this.crowd.setVolume(Phaser.Math.Clamp(1 - (d - 120) / 300, 0, 1) * 0.5);

    // Торговцы зазывают, когда герой рядом с базаром
    if (d < 320 && time > this.nextShout && !this.dialogue.active) {
      this.nextShout = time + Phaser.Math.Between(2500, 5000);
      this.ambientSay(Phaser.Utils.Array.GetRandom(this.merchants), Phaser.Utils.Array.GetRandom(MERCHANT_SHOUTS), '#ffe0a0', 2400, -70);
    }
    // Маришка матерится на проходящих
    const dm = Phaser.Math.Distance.Between(p.x, p.y, this.marishka.x, this.marishka.y);
    if (dm < 90 && time > (this.nextCurse || 0) && !this.dialogue.active) {
      if (this.ambientSay(this.marishka, Phaser.Utils.Array.GetRandom(MARISHKA.curses), '#ff90c0', 3000)) this.nextCurse = time + 7000;
    }
    // Мужик подбегает и просит пизды
    const c = this.crazy, dc = Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y);
    if (!c.npc.down && dc < 150 && dc > 40 && time > this.nextCrazy && time > this.nextBarkAt && !this.dialogue.active) {
      this.nextCrazy = time + 10000;
      c.npc.target = { x: p.x + (c.x > p.x ? 30 : -30), y: p.y };
      c.npc.speed = 70;
      this.time.delayedCall(1200, () => { c.npc.speed = 30; });
      this.ambientSay(c, CRAZY.shout, '#ffd040', 2600);
    }

    // Иду по базару... — первый заход на площадь, ~30 секунд
    if (!this.saveData.flags.bazaarDone && !this.bazaarRunning && this.inPlaza() && !this.dialogue.active) this.bazaarWalk();
  }

  bazaarWalk() {
    this.bazaarRunning = true;
    BAZAAR_WALK.forEach((line, i) => {
      this.time.delayedCall(i * 3300, () => {
        if (this.leaving) return;
        this.say(this.player, line, '#c8e8ff', 3000, -76);
      });
    });
    this.time.delayedCall(BAZAAR_WALK.length * 3300 + 400, () => {
      this.saveData.flags.bazaarDone = true;
      save(this.saveData);
      const c = this.companions.find((x) => x.cid === 'yarka') || this.companions[0];
      this.nextBarkAt = 0;
      this.ambientSay(c, 'Может, хватит уже ходить по базару?', '#f0f4ff', 2800);
    });
  }
}

