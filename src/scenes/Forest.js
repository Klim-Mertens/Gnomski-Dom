import Phaser from 'phaser';
import { HEROES, HERO_IDS, derive, xpForLevel, MAX_LEVEL } from '../data/heroes.js';
import { PHRASES, BARKS, HERMIT, CAMPFIRE_LINES } from '../data/texts.js';
import { WORLD } from '../gfx/palette.js';
import { txt, Dialogue } from '../systems/ui.js';
import { save } from '../systems/save.js';

const WORLD_W = 1200, WORLD_H = 800;
const CAMPFIRE = { x: 300, y: 420 };
const HERMIT_POS = { x: 930, y: 250 };

// Типы врагов. hp — здоровье, dmg — урон, speed — скорость, xp — опыт за убийство
const ENEMY_TYPES = {
  hollow: { tex: 'hollow', hp: 34, dmg: 9, speed: 30, xp: 12, reach: 24, windup: 600, body: [14, 10, 9, 36] },
  wolf: { tex: 'wolf', hp: 20, dmg: 6, speed: 72, xp: 8, reach: 70, windup: 380, body: [24, 10, 10, 14] },
};

// Где появляются враги
const SPAWNS = [
  { type: 'hollow', x: 560, y: 520, n: 2 },
  { type: 'wolf', x: 700, y: 300, n: 3 },
  { type: 'hollow', x: 900, y: 600, n: 3 },
  { type: 'wolf', x: 1050, y: 450, n: 2 },
  { type: 'hollow', x: 520, y: 180, n: 1 },
];

const STINK_MS = 3 * 60 * 1000; // сколько воняет после бутылки (в прототипе 3 минуты)

export class ForestScene extends Phaser.Scene {
  constructor() { super('Forest'); }

  init(data) {
    this.saveData = data.save;
  }

  create() {
    this.heroId = this.saveData.hero;
    this.hero = HEROES[this.heroId];
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this.buildWorld();
    this.buildActors();
    this.buildInput();
    this.buildAtmosphere();

    this.dialogue = new Dialogue(this);
    this.recalc(true);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.fadeIn(600);

    this.scene.launch('Hud');
    this.events.on('resume', (_sys, data) => this.onResume(data));
    this.events.on('shutdown', () => this.scene.stop('Hud'));

    this.time.delayedCall(1200, () => this.dialogue.show(this.hero.name, [
      'Рота осталась позади. Теперь мы дезертиры, а лес — наш дом.',
      'У костра можно отдохнуть (E). У ручья, говорят, живёт отшельник.',
    ]));
  }

  // ---------- МИР ----------
  buildWorld() {
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'grass').setOrigin(0).setDepth(-10);

    // Ручей у отшельника
    const g = this.add.graphics().setDepth(-9);
    g.fillStyle(0x16304a, 1);
    for (let y = 0; y < WORLD_H; y += 4) {
      const x = 1010 + Math.sin(y / 40) * 18;
      g.fillRect(x, y, 26, 4);
    }
    g.fillStyle(0x2a5a7a, 1);
    for (let y = 0; y < WORLD_H; y += 12) g.fillRect(1018 + Math.sin(y / 40) * 18, y, 6, 2);

    // Грибы-украшения
    for (let i = 0; i < 40; i++) {
      this.add.image(Phaser.Math.Between(20, WORLD_W - 20), Phaser.Math.Between(20, WORLD_H - 20), 'shroom').setDepth(-8);
    }

    // Деревья: стена по краям + россыпь внутри (не у костра)
    this.trees = this.physics.add.staticGroup();
    const addTree = (x, y) => {
      if (Phaser.Math.Distance.Between(x, y, CAMPFIRE.x, CAMPFIRE.y) < 80) return;
      if (Phaser.Math.Distance.Between(x, y, HERMIT_POS.x, HERMIT_POS.y) < 50) return;
      const t = this.trees.create(x, y, 'tree').setOrigin(0.5, 0.95);
      t.body.setSize(10, 8).setOffset(15, 52);
      t.setDepth(y);
      t.setFlipX(Math.random() < 0.5);
    };
    for (let x = 0; x <= WORLD_W; x += 26) { addTree(x, 20 + Math.random() * 10); addTree(x, WORLD_H - 4 - Math.random() * 10); }
    for (let y = 40; y < WORLD_H; y += 30) { addTree(10 + Math.random() * 10, y); addTree(WORLD_W - 10 - Math.random() * 10, y); }
    for (let i = 0; i < 70; i++) addTree(Phaser.Math.Between(60, WORLD_W - 60), Phaser.Math.Between(70, WORLD_H - 40));

    // Костёр + огонь + свет
    this.add.image(CAMPFIRE.x, CAMPFIRE.y, 'campfire').setDepth(CAMPFIRE.y - 1);
    this.fireGlow = this.add.circle(CAMPFIRE.x, CAMPFIRE.y - 4, 60, 0xff9a3a, 0.12).setBlendMode('ADD').setDepth(-5);
    this.tweens.add({ targets: this.fireGlow, scale: 1.12, alpha: 0.18, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.add.particles(CAMPFIRE.x, CAMPFIRE.y - 4, 'px', {
      x: { min: -5, max: 5 }, speedY: { min: -40, max: -18 }, speedX: { min: -6, max: 6 },
      lifespan: { min: 300, max: 700 }, scale: { start: 1.6, end: 0.2 }, tint: WORLD.fire,
      blendMode: 'ADD', frequency: 30,
    }).setDepth(CAMPFIRE.y);
    this.fireLabel = txt(this, CAMPFIRE.x, CAMPFIRE.y - 30, '[E] отдохнуть', 7, '#ffe08a', { origin: 0.5 }).setDepth(9999).setVisible(false);

    // Брызги крови на земле копятся здесь
    this.decals = this.add.layer().setDepth(-7);
  }

  // ---------- ПЕРСОНАЖИ ----------
  makeHeroSprite(id, x, y) {
    const s = this.physics.add.sprite(x, y, id).setOrigin(0.5, 0.92);
    s.body.setSize(14, 10).setOffset(9, 36);
    s.setCollideWorldBounds(true);
    return s;
  }

  buildActors() {
    this.player = this.makeHeroSprite(this.heroId, CAMPFIRE.x + 30, CAMPFIRE.y + 20);
    this.physics.add.collider(this.player, this.trees);

    // Спутники — двое других героев
    this.companions = HERO_IDS.filter((id) => id !== this.heroId).map((id, i) => {
      const s = this.makeHeroSprite(id, CAMPFIRE.x - 20 + i * 40, CAMPFIRE.y + 30);
      s.cid = id;
      s.side = i === 0 ? -1 : 1;
      const d = derive(HEROES[id].stats, this.saveData.level);
      s.maxHp = Math.round(d.maxHp * 0.8); s.hp = s.maxHp;
      s.dmg = d.damage * 0.55; s.speed = d.speed * 0.95;
      s.cool = HEROES[id].weapon.cooldown * 2.2; s.nextHit = 0; s.down = false; s.revive = 0;
      s.nextHeal = 0; s.nextIdleBark = this.time.now + Phaser.Math.Between(15000, 30000);
      this.physics.add.collider(s, this.trees);
      return s;
    });

    // Отшельник
    this.hermit = this.physics.add.staticImage(HERMIT_POS.x, HERMIT_POS.y, 'hermit').setOrigin(0.5, 0.92).setDepth(HERMIT_POS.y);
    this.hermit.body.setSize(14, 10).setOffset(9, 36);
    this.physics.add.collider(this.player, this.hermit);
    this.hermitLabel = txt(this, HERMIT_POS.x, HERMIT_POS.y - 54, '[E] поговорить', 7, '#6ff0e0', { origin: 0.5 }).setDepth(9999).setVisible(false);

    this.enemies = this.physics.add.group();
    this.physics.add.collider(this.enemies, this.trees);
    this.physics.add.collider(this.enemies, this.enemies);
    this.spawnAll();

    // Частицы крови и вони
    this.blood = this.add.particles(0, 0, 'px', {
      speed: { min: 30, max: 120 }, angle: { min: 200, max: 340 }, gravityY: 260,
      lifespan: { min: 300, max: 700 }, scale: { start: 1.4, end: 0.6 }, tint: WORLD.blood, emitting: false,
    }).setDepth(5000);
    this.stinkFx = this.add.particles(0, 0, 'px', {
      speedY: { min: -18, max: -6 }, speedX: { min: -8, max: 8 }, x: { min: -8, max: 8 },
      lifespan: 1200, scale: { start: 1.2, end: 2.4 }, alpha: { start: 0.7, end: 0 }, tint: WORLD.stink,
      frequency: 70, emitting: false,
    }).setDepth(5001);
    this.stinkFx.startFollow(this.player, 0, -20);
  }

  spawnAll() {
    this.enemies.clear(true, true);
    SPAWNS.forEach((sp) => {
      for (let i = 0; i < sp.n; i++) this.spawnEnemy(sp.type, sp.x + Phaser.Math.Between(-40, 40), sp.y + Phaser.Math.Between(-30, 30));
    });
  }

  spawnEnemy(type, x, y) {
    const T = ENEMY_TYPES[type];
    const e = this.enemies.create(x, y, T.tex).setOrigin(0.5, 0.92);
    e.body.setSize(T.body[0], T.body[1]).setOffset(T.body[2], T.body[3]);
    e.setCollideWorldBounds(true);
    e.T = T; e.type = type; e.hp = T.hp + this.saveData.level * 3; e.state = 'idle'; e.until = 0;
    e.home = { x, y };
    return e;
  }

  // ---------- ВВОД ----------
  buildInput() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard.addKeys({
      up: K.W, down: K.S, left: K.A, right: K.D,
      up2: K.UP, down2: K.DOWN, left2: K.LEFT, right2: K.RIGHT,
      dodge: K.SPACE, attack: K.J, rage: K.R, use: K.E,
      one: K.ONE, two: K.TWO, three: K.THREE, four: K.FOUR,
    });
    this.input.on('pointerdown', (p) => { if (p.leftButtonDown()) this.tryAttack(true); });
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.dialogue.active) return this.dialogue.next();
      this.tryDodge();
    });
    this.input.keyboard.on('keydown-J', () => this.tryAttack(false));
    this.input.keyboard.on('keydown-R', () => this.tryRage());
    this.input.keyboard.on('keydown-E', () => {
      if (this.dialogue.active) return this.dialogue.next();
      this.interact();
    });
    this.facing = new Phaser.Math.Vector2(1, 0);
  }

  // ---------- АТМОСФЕРА ----------
  buildAtmosphere() {
    // Светлячки
    this.add.particles(0, 0, 'px', {
      x: { min: 0, max: WORLD_W }, y: { min: 0, max: WORLD_H }, lifespan: 4000,
      speedX: { min: -6, max: 6 }, speedY: { min: -6, max: 6 },
      scale: { start: 0.8, end: 0.2 }, alpha: { start: 0, end: 0.9, ease: 'Sine.inOut' },
      tint: [0x6ff0e0, 0xc84a9a], blendMode: 'ADD', frequency: 120,
    }).setDepth(6000);

    // Виньетка: тёмные края экрана
    const W = this.scale.width, H = this.scale.height;
    if (!this.textures.exists('vignette')) this.makeVignette(W, H);
    this.add.image(0, 0, 'vignette').setOrigin(0).setScrollFactor(0).setDepth(7000);
  }

  makeVignette(W, H) {
    const v = this.textures.createCanvas('vignette', W, H);
    const ctx = v.getContext();
    const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62);
    grd.addColorStop(0, 'rgba(7,4,12,0)');
    grd.addColorStop(1, 'rgba(7,4,12,0.85)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H); v.refresh();
  }

  // ---------- ХАРАКТЕРИСТИКИ ----------
  stats() {
    const s = { ...this.hero.stats };
    for (const k of Object.keys(s)) s[k] += this.saveData.bonus[k];
    return s;
  }

  recalc(full = false) {
    this.d = derive(this.stats(), this.saveData.level);
    if (full || !this.st) {
      this.st = { hp: this.d.maxHp, stamina: this.d.maxStamina, rage: 0, raging: 0, stinkUntil: this.st?.stinkUntil || 0 };
    }
  }

  // ---------- ЦИКЛ ----------
  update(time, delta) {
    if (this.dead || this.levelUpOpen) return;
    const dt = delta / 1000;
    this.updatePlayer(time, dt);
    this.updateCompanions(time);
    this.updateEnemies(time);
    this.updateProximity();

    // Сортировка по глубине: кто ниже на экране — тот ближе
    this.player.setDepth(this.player.y);
    this.companions.forEach((c) => c.setDepth(c.down ? c.y - 20 : c.y));
    this.enemies.getChildren().forEach((e) => e.setDepth(e.y));

    const stinky = time < this.st.stinkUntil;
    this.stinkFx.emitting = stinky;
  }

  updatePlayer(time, dt) {
    const k = this.keys, p = this.player, st = this.st;
    st.stamina = Math.min(this.d.maxStamina, st.stamina + 26 * dt);
    if (st.raging && time > st.raging) { st.raging = 0; p.clearTint(); }

    if (this.dialogue.active) { p.setVelocity(0); return; }
    if (this.dodging) return;
    if (time < this.lungeUntil) return;

    let vx = 0, vy = 0;
    if (k.left.isDown || k.left2.isDown) vx -= 1;
    if (k.right.isDown || k.right2.isDown) vx += 1;
    if (k.up.isDown || k.up2.isDown) vy -= 1;
    if (k.down.isDown || k.down2.isDown) vy += 1;
    const v = new Phaser.Math.Vector2(vx, vy);
    if (v.lengthSq() > 0) {
      v.normalize();
      this.facing.copy(v);
      if (vx) p.setFlipX(vx < 0);
      // покачивание при ходьбе вместо анимации (кадры нарисуем позже)
      p.setAngle(Math.sin(time / 70) * 4);
    } else p.setAngle(0);
    const speed = this.d.speed * (st.raging ? 1.15 : 1);
    p.setVelocity(v.x * speed, v.y * speed);
  }

  tryDodge() {
    const st = this.st;
    if (this.dodging || this.dead || st.stamina < 20) return;
    st.stamina -= 20;
    this.dodging = true;
    const dir = this.facing.clone().normalize();
    this.player.setVelocity(dir.x * 260, dir.y * 260).setAlpha(0.6);
    this.tweens.add({ targets: this.player, angle: this.player.flipX ? -360 : 360, duration: 220 });
    this.time.delayedCall(220, () => { this.dodging = false; this.player.setAlpha(1).setAngle(0); });
  }

  tryRage() {
    if (this.st.rage < 100 || this.st.raging) return;
    this.st.rage = 0;
    this.st.raging = this.time.now + 7000;
    this.player.setTint(0xff6060);
    this.cameras.main.flash(200, 120, 0, 0);
    this.cameras.main.shake(200, 0.006);
    this.floatText(this.player.x, this.player.y - 50, 'ЯРОСТЬ!', '#d8283a', 10);
  }

  tryAttack(fromMouse) {
    if (this.dead || this.dodging || this.dialogue.active) return;
    const now = this.time.now, w = this.hero.weapon, st = this.st;
    if (now < (this.nextAttack || 0)) return;
    if (st.stamina < w.cost) { this.events.emit('noStamina'); return; }
    st.stamina -= w.cost;
    this.nextAttack = now + w.cooldown;
    this.combo = now - (this.lastAttack || 0) < 750 ? ((this.combo || 0) + 1) % 3 : 0;
    this.lastAttack = now;

    const p = this.player;
    let ang;
    if (fromMouse) {
      const wp = this.input.activePointer.positionToCamera(this.cameras.main);
      ang = Phaser.Math.Angle.Between(p.x, p.y - 20, wp.x, wp.y);
      this.facing.set(Math.cos(ang), Math.sin(ang));
    } else ang = Math.atan2(this.facing.y, this.facing.x);
    p.setFlipX(Math.cos(ang) < 0);

    const heavy = this.combo === 2;
    const range = w.range * (heavy ? 1.25 : 1);
    // Дуга удара
    const g = this.add.graphics().setDepth(p.y + 1);
    g.lineStyle(heavy ? 4 : 2, heavy ? 0xffffff : 0xdde6ff, 0.9);
    g.beginPath(); g.arc(p.x, p.y - 18, range, ang - w.arc / 2, ang + w.arc / 2); g.strokePath();
    g.lineStyle(1, this.hero.color, 0.8);
    g.beginPath(); g.arc(p.x, p.y - 18, range - 4, ang - w.arc / 2, ang + w.arc / 2); g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });

    // Рывок вперёд при ударе
    this.lungeUntil = now + 90;
    p.setVelocity(Math.cos(ang) * 90, Math.sin(ang) * 90);

    const dmg = this.d.damage * (heavy ? 1.8 : 1) * (st.raging ? 2 : 1);
    this.enemies.getChildren().forEach((e) => {
      const dist = Phaser.Math.Distance.Between(p.x, p.y - 18, e.x, e.y - e.height / 4);
      const a = Phaser.Math.Angle.Between(p.x, p.y - 18, e.x, e.y - e.height / 4);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(a - ang));
      if (dist < range + 12 && diff < w.arc / 2 + 0.35) this.hitEnemy(e, dmg * Phaser.Math.FloatBetween(0.85, 1.15), ang, heavy);
    });
  }

  // ---------- УРОН ----------
  hitEnemy(e, dmg, ang, heavy, byCompanion = false) {
    if (!e.active || e.hp <= 0) return;
    e.hp -= dmg;
    e.setTintFill(0xffffff);
    this.time.delayedCall(70, () => e.active && e.clearTint());
    const kb = heavy ? 220 : 120;
    e.setVelocity(Math.cos(ang) * kb, Math.sin(ang) * kb);
    e.state = 'stagger'; e.until = this.time.now + (heavy ? 420 : 220);
    this.blood.explode(heavy ? 18 : 9, e.x, e.y - 16);
    this.floatText(e.x, e.y - 40, Math.round(dmg).toString(), heavy ? '#ffe08a' : '#f0f4ff', heavy ? 10 : 8);
    if (!byCompanion) {
      // Хитстоп: короткая заморозка для ощущения веса удара
      this.physics.world.pause();
      this.time.delayedCall(heavy ? 80 : 45, () => this.physics.world.resume());
      this.cameras.main.shake(heavy ? 120 : 60, heavy ? 0.006 : 0.003);
    }
    if (e.hp <= 0) this.killEnemy(e, ang);
  }

  killEnemy(e, ang) {
    const { x, y } = e;
    // Ошмётки
    for (let i = 0; i < 7; i++) {
      const piece = this.add.image(x, y - 16, 'px').setTint(Phaser.Utils.Array.GetRandom([0x6e1020, 0xd8283a, e.type === 'wolf' ? 0x4a4450 : 0x5a5048]))
        .setScale(Phaser.Math.FloatBetween(1.5, 3)).setDepth(y + 2);
      const a = ang + Phaser.Math.FloatBetween(-0.9, 0.9), d = Phaser.Math.Between(18, 46);
      this.tweens.add({ targets: piece, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, angle: 360, duration: 380, ease: 'Quad.out' });
    }
    this.blood.explode(28, x, y - 16);
    // Лужа крови и труп остаются лежать
    const pool = this.add.ellipse(x, y - 2, Phaser.Math.Between(16, 26), Phaser.Math.Between(6, 10), 0x6e1020, 0.85);
    this.decals.add(pool);
    const corpse = this.add.image(x, y - 4, e.texture.key).setAngle(e.flipX ? -90 : 90).setTint(0x704848).setDepth(-6).setScale(0.9);
    this.decals.add(corpse);

    this.gainXp(e.T.xp);
    e.destroy();
    if (Math.random() < 0.45) this.bark(Phaser.Utils.Array.GetRandom(this.companions.filter((c) => !c.down)), 'kill');
  }

  hurtPlayer(dmg, from) {
    if (this.dodging || this.dead || this.time.now < (this.invuln || 0)) return;
    const st = this.st;
    st.hp -= dmg;
    st.rage = Math.min(100, st.rage + dmg * this.d.rageGain * 2.5);
    this.invuln = this.time.now + 350;
    this.player.setTintFill(0xff2040);
    this.time.delayedCall(90, () => (st.raging ? this.player.setTint(0xff6060) : this.player.clearTint()));
    this.blood.explode(10, this.player.x, this.player.y - 18);
    this.cameras.main.shake(120, 0.008);
    if (from) {
      const a = Phaser.Math.Angle.Between(from.x, from.y, this.player.x, this.player.y);
      this.lungeUntil = this.time.now + 120;
      this.player.setVelocity(Math.cos(a) * 150, Math.sin(a) * 150);
    }
    this.floatText(this.player.x, this.player.y - 48, `-${dmg}`, '#ff4060', 9);
    if (st.hp <= 0) this.die();
  }

  hurtCompanion(c, dmg) {
    if (c.down) return;
    c.hp -= dmg;
    c.setTintFill(0xff2040);
    this.time.delayedCall(90, () => c.clearTint());
    this.blood.explode(6, c.x, c.y - 18);
    if (Math.random() < 0.25) this.bark(c, 'hurt');
    if (c.hp <= 0) {
      c.down = true; c.hp = 0; c.setVelocity(0); c.setAngle(90).setAlpha(0.7);
      this.floatText(c.x, c.y - 30, 'без сознания', '#a898a8', 7);
    }
  }

  // ---------- СПУТНИКИ ----------
  updateCompanions(time) {
    const p = this.player, stinky = time < this.st.stinkUntil;
    this.companions.forEach((c) => {
      if (c.down) {
        c.setVelocity(0);
        // Поднять спутника: постоять рядом 2 секунды
        if (Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y) < 26) {
          c.revive += this.game.loop.delta;
          if (c.revive > 2000) {
            c.down = false; c.revive = 0; c.hp = Math.round(c.maxHp * 0.5); c.setAngle(0).setAlpha(1);
            this.floatText(c.x, c.y - 40, 'Встаю...', '#6ff0e0', 7);
          }
        } else c.revive = 0;
        return;
      }

      // Эдрик лечит героя, если тому плохо
      if (c.cid === 'edrik' && this.st.hp < this.d.maxHp * 0.45 && time > c.nextHeal) {
        c.nextHeal = time + 14000;
        const heal = Math.round(this.d.maxHp * 0.3);
        this.st.hp = Math.min(this.d.maxHp, this.st.hp + heal);
        this.floatText(p.x, p.y - 50, `+${heal}`, '#6ff0e0', 9);
        this.add.particles(p.x, p.y - 16, 'px', { speed: 40, lifespan: 600, tint: 0x6ff0e0, blendMode: 'ADD', emitting: false }).explode(20);
      }

      // Ближайший враг
      let target = null, best = 120;
      this.enemies.getChildren().forEach((e) => {
        const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
        if (d < best) { best = d; target = e; }
      });

      if (target) {
        const reach = c.cid === 'valder' ? 30 : 24;
        if (best > reach) this.physics.moveToObject(c, target, c.speed);
        else {
          c.setVelocity(0);
          if (time > c.nextHit) {
            c.nextHit = time + c.cool;
            const ang = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
            c.setFlipX(target.x < c.x);
            this.tweens.add({ targets: c, x: c.x + Math.cos(ang) * 4, duration: 60, yoyo: true });
            this.hitEnemy(target, c.dmg * Phaser.Math.FloatBetween(0.8, 1.2), ang, false, true);
          }
        }
        c.setAngle(Math.sin(time / 80) * 3);
      } else {
        // Идём за героем; если герой воняет — держимся подальше
        const keep = stinky ? 70 : 34;
        const tx = p.x + c.side * keep, ty = p.y + 10;
        const d = Phaser.Math.Distance.Between(c.x, c.y, tx, ty);
        if (d > 12) {
          this.physics.moveTo(c, tx, ty, Math.min(c.speed * 1.2, d * 3));
          c.setFlipX(tx < c.x);
          c.setAngle(Math.sin(time / 75) * 3);
        } else { c.setVelocity(0); c.setAngle(0); }
      }

      if (time > c.nextIdleBark) {
        c.nextIdleBark = time + Phaser.Math.Between(25000, 45000);
        this.bark(c, stinky ? 'stink' : 'idle');
      }
    });
  }

  // ---------- ВРАГИ ----------
  updateEnemies(time) {
    const p = this.player, stinky = time < this.st.stinkUntil;
    const targets = [p, ...this.companions.filter((c) => !c.down)];
    this.enemies.getChildren().forEach((e) => {
      if (e.state === 'stagger') { if (time > e.until) e.state = 'idle'; else return; }

      // ближайшая цель в радиусе агрессии
      let t = null, best = 150;
      targets.forEach((cand) => {
        const d = Phaser.Math.Distance.Between(e.x, e.y, cand.x, cand.y);
        if (d < best) { best = d; t = cand; }
      });

      // Звери боятся вони
      if (e.type === 'wolf' && stinky && Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y) < 130) {
        const a = Phaser.Math.Angle.Between(p.x, p.y, e.x, e.y);
        e.setVelocity(Math.cos(a) * e.T.speed * 1.3, Math.sin(a) * e.T.speed * 1.3);
        e.setFlipX(Math.cos(a) < 0);
        if (!e.fleeBark || time > e.fleeBark) { e.fleeBark = time + 4000; this.floatText(e.x, e.y - 24, 'скулит', '#8ad040', 6); }
        return;
      }

      switch (e.state) {
        case 'idle':
          if (t) { e.state = 'chase'; e.target = t; }
          else {
            const dh = Phaser.Math.Distance.Between(e.x, e.y, e.home.x, e.home.y);
            if (dh > 20) this.physics.moveTo(e, e.home.x, e.home.y, e.T.speed * 0.5); else e.setVelocity(0);
          }
          break;
        case 'chase': {
          if (!t) { e.state = 'idle'; break; }
          e.target = t;
          e.setFlipX(t.x < e.x);
          if (best <= e.T.reach) {
            e.state = 'windup'; e.until = time + e.T.windup; e.setVelocity(0);
            // Мигание перед ударом — подсказка, когда перекатываться
            e.setTint(0xff8080);
          } else this.physics.moveToObject(e, t, e.T.speed);
          e.setAngle(Math.sin(time / (e.type === 'wolf' ? 50 : 110)) * 4);
          break;
        }
        case 'windup':
          if (time > e.until) {
            e.clearTint();
            const tg = e.target;
            if (!tg?.active) { e.state = 'idle'; break; }
            if (e.type === 'wolf') {
              // Прыжок
              const a = Phaser.Math.Angle.Between(e.x, e.y, tg.x, tg.y);
              e.setVelocity(Math.cos(a) * 240, Math.sin(a) * 240);
              e.state = 'lunge'; e.until = time + 260; e.hitDone = false;
            } else {
              const d = Phaser.Math.Distance.Between(e.x, e.y, tg.x, tg.y);
              this.tweens.add({ targets: e, scaleX: 1.15, duration: 80, yoyo: true });
              if (d <= e.T.reach + 8) this.damageTarget(tg, e.T.dmg, e);
              e.state = 'recover'; e.until = time + 700;
            }
          }
          break;
        case 'lunge':
          if (!e.hitDone) {
            targets.forEach((cand) => {
              if (!e.hitDone && Phaser.Math.Distance.Between(e.x, e.y, cand.x, cand.y) < 20) { e.hitDone = true; this.damageTarget(cand, e.T.dmg, e); }
            });
          }
          if (time > e.until) { e.setVelocity(0); e.state = 'recover'; e.until = time + 750; }
          break;
        case 'recover':
          e.setVelocity(e.body.velocity.x * 0.85, e.body.velocity.y * 0.85);
          if (time > e.until) e.state = 'idle';
          break;
      }
    });
  }

  damageTarget(t, dmg, from) {
    if (t === this.player) this.hurtPlayer(dmg, from);
    else this.hurtCompanion(t, dmg);
  }

  // ---------- ВЗАИМОДЕЙСТВИЕ ----------
  updateProximity() {
    const p = this.player;
    this.nearFire = Phaser.Math.Distance.Between(p.x, p.y, CAMPFIRE.x, CAMPFIRE.y) < 46;
    this.nearHermit = Phaser.Math.Distance.Between(p.x, p.y, HERMIT_POS.x, HERMIT_POS.y) < 44;
    this.fireLabel.setVisible(this.nearFire && !this.dialogue.active);
    this.hermitLabel.setVisible(this.nearHermit && !this.dialogue.active);
  }

  interact() {
    if (this.nearFire) return this.rest();
    if (this.nearHermit) return this.talkHermit();
  }

  rest() {
    this.recalc(true);
    this.companions.forEach((c) => { c.down = false; c.hp = c.maxHp; c.setAngle(0).setAlpha(1); });
    this.spawnAll();
    save(this.saveData);
    this.cameras.main.flash(300, 255, 160, 60);
    this.dialogue.show('У костра', [
      Phaser.Utils.Array.GetRandom(CAMPFIRE_LINES),
      `«${Phaser.Utils.Array.GetRandom(PHRASES)}»`,
      'Здоровье восстановлено. Игра сохранена. Твари в лесу снова проснулись.',
    ]);
  }

  talkHermit() {
    this.hermit.setFlipX(this.player.x < this.hermit.x);
    if (this.saveData.flags.bottlesDone) {
      return this.dialogue.show(HERMIT.name, HERMIT.again);
    }
    this.dialogue.show(HERMIT.name, HERMIT.intro, () => {
      this.player.setVelocity(0);
      this.scene.pause();
      this.scene.pause('Hud');
      this.scene.launch('Bottles', { hero: this.heroId });
    });
  }

  onResume(data) {
    this.scene.resume('Hud');
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

  // ---------- ОПЫТ И УРОВНИ ----------
  gainXp(n) {
    const s = this.saveData;
    if (s.level >= MAX_LEVEL) return;
    s.xp += n;
    this.floatText(this.player.x, this.player.y - 60, `+${n} опыта`, '#e0b040', 7);
    if (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level++;
      this.pendingPoints = (this.pendingPoints || 0) + 2;
      this.openLevelUp();
    }
  }

  openLevelUp() {
    this.levelUpOpen = true;
    this.physics.world.pause();
    this.player.setVelocity(0);
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    objs.push(this.add.rectangle(W / 2, H / 2, 260, 130, 0x0d0814, 0.95).setStrokeStyle(2, 0xe0b040).setScrollFactor(0).setDepth(9000));
    const title = txt(this, W / 2, H / 2 - 48, '', 11, '#e0b040', { origin: 0.5, bold: true }).setScrollFactor(0).setDepth(9001);
    const names = [['str', 'Сила', 'урон'], ['dex', 'Ловкость', 'скорость, выносливость'], ['con', 'Выносливость', 'здоровье'], ['wil', 'Воля', 'ярость копится быстрее']];
    const lines = names.map(([, n, hint], i) => txt(this, W / 2 - 110, H / 2 - 26 + i * 16, '', 8, '#e8dccc').setScrollFactor(0).setDepth(9001).setData('hint', hint).setData('n', n));
    objs.push(title, ...lines);
    const redraw = () => {
      title.setText(`Уровень ${this.saveData.level}! Очков: ${this.pendingPoints}`);
      const st = this.stats();
      lines.forEach((l, i) => l.setText(`${i + 1} — ${l.getData('n')} ${st[names[i][0]]}  (${l.getData('hint')})`));
    };
    redraw();
    const handler = (ev) => {
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(ev.code);
      if (idx < 0) return;
      this.saveData.bonus[names[idx][0]]++;
      this.pendingPoints--;
      if (this.pendingPoints > 0) return redraw();
      this.input.keyboard.off('keydown', handler);
      objs.forEach((o) => o.destroy());
      this.recalc(true);
      this.levelUpOpen = false;
      this.physics.world.resume();
      save(this.saveData);
      this.floatText(this.player.x, this.player.y - 50, 'Сильнее.', '#e0b040', 9);
    };
    this.input.keyboard.on('keydown', handler);
  }

  // ---------- СМЕРТЬ ----------
  die() {
    this.dead = true;
    this.physics.world.pause();
    this.player.setAngle(90).setTint(0x884444);
    this.cameras.main.shake(300, 0.01);
    const W = this.scale.width, H = this.scale.height;
    const shade = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(9500);
    this.tweens.add({ targets: shade, fillAlpha: 0.85, duration: 900 });
    const t1 = txt(this, W / 2, H / 2 - 30, 'ТЫ ПАЛ', 22, '#d8283a', { origin: 0.5, bold: true, strokeThickness: 3 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    const t2 = txt(this, W / 2, H / 2 + 6, `«${Phaser.Utils.Array.GetRandom(PHRASES)}»`, 8, '#e8dccc', { origin: 0.5, align: 'center', wrap: 360 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    const t3 = txt(this, W / 2, H / 2 + 46, 'нажми любую клавишу — очнуться у костра', 7, '#8a8090', { origin: 0.5 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    this.tweens.add({ targets: [t1, t2, t3], alpha: 1, duration: 900, delay: 400 });
    this.time.delayedCall(1400, () => {
      const go = () => {
        this.input.keyboard.off('keydown', go); this.input.off('pointerdown', go);
        [shade, t1, t2, t3].forEach((o) => o.destroy());
        this.player.setPosition(CAMPFIRE.x + 30, CAMPFIRE.y + 20).setAngle(0).clearTint();
        this.companions.forEach((c, i) => { c.setPosition(CAMPFIRE.x - 20 + i * 40, CAMPFIRE.y + 30); });
        this.dead = false;
        this.physics.world.resume();
        this.rest();
      };
      this.input.keyboard.on('keydown', go);
      this.input.on('pointerdown', go);
    });
  }

  // ---------- МЕЛОЧИ ----------
  floatText(x, y, str, color, size = 8) {
    const t = txt(this, x, y, str, size, color, { origin: 0.5, bold: true }).setDepth(9990);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  bark(c, kind) {
    if (!c || c.down) return;
    const lines = BARKS[c.cid]?.[kind];
    if (!lines) return;
    // одна реплика за раз, чтобы фразы не налезали друг на друга
    if (this.time.now < (this.nextBarkAt || 0)) return;
    this.nextBarkAt = this.time.now + 2800;
    c.barkText?.destroy();
    const t = txt(this, c.x, c.y - 56, Phaser.Utils.Array.GetRandom(lines), 7, '#f0f4ff', { origin: 0.5, align: 'center', wrap: 140 }).setDepth(9980);
    c.barkText = t;
    const follow = this.time.addEvent({ delay: 16, loop: true, callback: () => t.active && t.setPosition(c.x, c.y - 56) });
    this.time.delayedCall(2600, () => { follow.remove(); this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() }); });
  }
}
