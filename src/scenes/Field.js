import Phaser from 'phaser';
import { HEROES, HERO_IDS, derive, xpForLevel, MAX_LEVEL } from '../data/heroes.js';
import { PHRASES, BARKS } from '../data/texts.js';
import { WORLD } from '../gfx/palette.js';
import { txt, Dialogue } from '../systems/ui.js';
import { save } from '../systems/save.js';
import { audio } from '../systems/audio.js';

// Общая основа для локаций с героем: движение, бой, спутники, враги, уровни, смерть,
// предметы для взаимодействия (E) и выходы в другие локации.
// Лес, город и цитадель наследуют этот класс и рисуют свой мир.

export const ORIGIN_Y = 0.97;   // ноги персонажа в кадре 80x80
export const RANGE_K = 1.6;     // персонажи крупные — дальность оружия тоже

// Типы врагов. hp — здоровье, dmg — урон, speed — скорость, xp — опыт,
// reach — с какого расстояния бьёт, windup — замах (время, чтобы успеть перекатиться)
export const ENEMY_TYPES = {
  hollow: { hp: 34, dmg: 9, speed: 34, xp: 12, reach: 34, windup: 600, body: [18, 10, 31, 66], smear: 0x40e0c0 },
  wolf: { hp: 20, dmg: 6, speed: 80, xp: 8, reach: 100, windup: 420, body: [30, 10, 25, 66] },
  soldier: { hp: 52, dmg: 12, speed: 42, xp: 20, reach: 42, windup: 520, body: [18, 10, 31, 66], smear: 0xc8c8e0 },
};

export class FieldScene extends Phaser.Scene {
  init(data) {
    this.saveData = data.save;
    this.entry = data.entry || 'start';
    this.dead = false; this.levelUpOpen = false; this.dodging = false; this.leaving = false;
    this.interactables = []; this.exits = []; this.npcs = [];
    this.nextAttack = 0; this.lungeUntil = 0; this.invuln = 0; this.nextBarkAt = 0;
  }

  // ---- то, что переопределяют локации ----
  buildWorld() {}                 // нарисовать мир, задать this.worldW/H, this.obstacles
  buildAtmosphere() {}            // туман, свет и т.п.
  spawnPoint() { return { x: 100, y: 100 }; }
  spawnEnemies() {}               // расставить врагов
  calmMusic() { return 'm_forest'; }
  updateWorld() {}                // покадровая логика локации
  onEnter() {}                    // первая реплика
  onRespawn() {}                  // после смерти
  onSwing() {}                    // удар героя (для NPC, которых можно ударить)

  create() {
    this.heroId = this.saveData.hero;
    this.hero = HEROES[this.heroId];
    this.sfx = (k, o) => audio(this.game).sfx(k, o);
    this.deadFrame = (key) => this.cache.json.get('anims')[key].dead[0];
    this.obstacles = this.physics.add.staticGroup();
    this.decals = this.add.layer().setDepth(-7);   // лужи крови и трупы

    this.buildWorld();
    this.physics.world.setBounds(0, 0, this.worldW, this.worldH);
    this.buildActors();
    this.buildInput();
    this.buildAtmosphere();
    if (!this.textures.exists('vignette')) this.makeVignette(this.scale.width, this.scale.height);
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0).setScrollFactor(0).setDepth(7000);

    this.dialogue = new Dialogue(this);
    this.recalc(true);
    this.saveData.loc = this.scene.key.toLowerCase();
    save(this.saveData);

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.fadeIn(900);

    this.musicMode = null; this.calmSince = 0; this.nextMusicCheck = 0;
    this.scene.launch('Hud', { field: this.scene.key });
    this.events.once('shutdown', () => { this.scene.stop('Hud'); this.onShutdown?.(); });
    this.time.delayedCall(900, () => this.onEnter());
  }

  makeVignette(W, H) {
    const v = this.textures.createCanvas('vignette', W, H);
    const ctx = v.getContext();
    const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
    grd.addColorStop(0, 'rgba(4,6,10,0)');
    grd.addColorStop(1, 'rgba(4,6,10,0.8)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H); v.refresh();
  }

  // ---------- ПРЕДМЕТЫ И ВЫХОДЫ ----------
  // Точка, у которой появляется подсказка [E]
  addInteractable(x, y, r, label, color, action, labelDy = -40) {
    const t = txt(this, x, y + labelDy, label, 8, color, { origin: 0.5 }).setDepth(9999).setVisible(false);
    const it = { x, y, r, label: t, action, labelDy };
    this.interactables.push(it);
    return it;
  }

  // Прямоугольник; когда герой в него входит — переход
  addExit(x, y, w, h, go) { this.exits.push({ rect: new Phaser.Geom.Rectangle(x, y, w, h), go }); }

  // Твёрдое препятствие (коллизия) — невидимый прямоугольник
  addBlock(x, y, w, h) {
    const z = this.add.zone(x, y, w, h);
    this.physics.add.existing(z, true);
    this.obstacles.add(z);
    return z;
  }

  leaveTo(sceneKey, data) {
    if (this.leaving) return;
    this.leaving = true;
    this.player.setVelocity(0);
    save(this.saveData);
    this.cameras.main.fadeOut(700, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(sceneKey, { save: this.saveData, ...data }));
  }

  // ---------- ПЕРСОНАЖИ ----------
  makeActor(key, x, y, body = [18, 10, 31, 66]) {
    const s = this.physics.add.sprite(x, y, key, 0).setOrigin(0.5, ORIGIN_Y);
    s.body.setSize(body[0], body[1]).setOffset(body[2], body[3]);
    s.setCollideWorldBounds(true);
    s.play(`${key}_idle`);
    s.animLock = 0;
    return s;
  }

  // Анимации: «петли» (стоит/идёт) и «разовые» (удар, перекат, боль), которые нельзя прерывать
  loco(s, moving) {
    if (this.time.now < s.animLock) return;
    s.play(`${s.texture.key}_${moving ? 'walk' : 'idle'}`, true);
  }

  oneShot(s, anim, cfg = {}) {
    const key = `${s.texture.key}_${anim}`;
    if (!this.anims.exists(key)) return 0;
    s.play({ key, ...cfg });
    const a = this.anims.get(key);
    const len = cfg.frameRate ? (a.frames.length / cfg.frameRate) * 1000 : a.duration;
    s.animLock = this.time.now + (cfg.lock ?? len);
    return len;
  }

  // NPC: стоит или бродит рядом с домом, говорит по E
  addNpc(key, x, y, opts = {}) {
    const s = this.makeActor(key, x, y);
    s.body.setImmovable(true);
    s.npc = { home: { x, y }, wander: opts.wander || 0, next: 0, ...opts };
    s.anims.setProgress(Math.random());
    if (opts.flip) s.setFlipX(true);
    this.physics.add.collider(this.player, s);
    this.npcs.push(s);
    return s;
  }

  updateNpcs(time) {
    for (const s of this.npcs) {
      const n = s.npc;
      if (n.down) { s.setVelocity(0); continue; }
      if (n.wander && time > n.next) {
        n.next = time + Phaser.Math.Between(1500, 4000);
        if (Math.random() < 0.5) { s.setVelocity(0); n.target = null; }
        else n.target = { x: n.home.x + Phaser.Math.Between(-n.wander, n.wander), y: n.home.y + Phaser.Math.Between(-n.wander / 2, n.wander / 2) };
      }
      if (n.target) {
        const d = Phaser.Math.Distance.Between(s.x, s.y, n.target.x, n.target.y);
        if (d < 4) { s.setVelocity(0); n.target = null; }
        else { this.physics.moveTo(s, n.target.x, n.target.y, n.speed || 22); s.setFlipX(n.target.x < s.x); }
      }
      this.loco(s, !!n.target);
      s.setDepth(s.y);
    }
  }

  buildActors() {
    const sp = this.spawnPoint();
    this.player = this.makeActor(this.heroId, sp.x, sp.y);
    this.physics.add.collider(this.player, this.obstacles);
    // Шаги — на кадрах, где нога касается земли
    this.player.on('animationupdate', (anim, frame) => {
      if (anim.key.endsWith('_walk') && (frame.index === 2 || frame.index === 5)) {
        this.sfx('s_step', { volume: 0.35, vary: 0.25 });
      }
    });

    this.companions = HERO_IDS.filter((id) => id !== this.heroId).map((id, i) => {
      const s = this.makeActor(id, sp.x - 30 + i * 60, sp.y + 24);
      s.cid = id;
      s.side = i === 0 ? -1 : 1;
      const d = derive(HEROES[id].stats, this.saveData.level);
      s.maxHp = Math.round(d.maxHp * 0.8); s.hp = s.maxHp;
      s.dmg = d.damage * 0.55; s.speed = d.speed * 1.05;
      s.cool = HEROES[id].weapon.cooldown * 2.2; s.nextHit = 0; s.down = false; s.revive = 0;
      s.nextHeal = 0; s.nextIdleBark = this.time.now + Phaser.Math.Between(15000, 30000);
      this.physics.add.collider(s, this.obstacles);
      return s;
    });

    this.enemies = this.physics.add.group();
    this.physics.add.collider(this.enemies, this.obstacles);
    this.physics.add.collider(this.enemies, this.enemies);
    this.spawnEnemies();

    // Кровь, искры, вонь
    this.blood = this.add.particles(0, 0, 'px', {
      speed: { min: 40, max: 150 }, angle: { min: 200, max: 340 }, gravityY: 300,
      lifespan: { min: 300, max: 800 }, scale: { start: 1.6, end: 0.6 }, tint: WORLD.blood, emitting: false,
    }).setDepth(5000);
    this.sparks = this.add.particles(0, 0, 'px', {
      speed: { min: 60, max: 200 }, lifespan: { min: 100, max: 260 }, scale: { start: 1, end: 0 },
      tint: [0xffffff, 0xffe08a, 0xffb040], blendMode: 'ADD', emitting: false,
    }).setDepth(5002);
    this.stinkFx = this.add.particles(0, 0, 'px', {
      speedY: { min: -18, max: -6 }, speedX: { min: -8, max: 8 }, x: { min: -10, max: 10 },
      lifespan: 1300, scale: { start: 1.4, end: 2.8 }, alpha: { start: 0.7, end: 0 }, tint: WORLD.stink,
      frequency: 60, emitting: false,
    }).setDepth(5001);
    this.stinkFx.startFollow(this.player, 0, -30);
  }

  clearEnemies() { this.enemies.clear(true, true); }

  spawnEnemy(type, x, y) {
    const T = ENEMY_TYPES[type];
    const e = this.makeActor(type, x, y, T.body);
    this.enemies.add(e);
    e.T = T; e.type = type; e.hp = T.hp + this.saveData.level * 3; e.state = 'idle'; e.until = 0;
    e.home = { x, y };
    e.anims.setProgress(Math.random());   // чтобы не дышали в унисон
    return e;
  }

  // ---------- ВВОД ----------
  buildInput() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard.addKeys({
      up: K.W, down: K.S, left: K.A, right: K.D,
      up2: K.UP, down2: K.DOWN, left2: K.LEFT, right2: K.RIGHT,
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
      if (this.nearest && !this.dead && !this.levelUpOpen) this.nearest.action();
    });
    this.facing = new Phaser.Math.Vector2(1, 0);
  }

  // ---------- ХАРАКТЕРИСТИКИ ----------
  stats() {
    const s = { ...this.hero.stats };
    for (const k of Object.keys(s)) s[k] += this.saveData.bonus[k];
    return s;
  }

  recalc(full = false) {
    this.d = derive(this.stats(), this.saveData.level);
    this.d.speed *= 1.15;   // миры большие
    if (full || !this.st) {
      const keep = this.registry.get('stinkUntil') || 0;
      this.st = { hp: this.d.maxHp, stamina: this.d.maxStamina, rage: 0, raging: 0, stinkUntil: this.st?.stinkUntil || keep };
    }
  }

  // ---------- ЦИКЛ ----------
  update(time, delta) {
    this.updateWorld(time, delta);
    if (this.dead || this.levelUpOpen || this.leaving) return;
    const dt = delta / 1000;
    this.updatePlayer(time, dt);
    if (this.dialogue.active) {
      // пока идёт разговор, мир замирает: никто не нападает
      [...this.companions, ...this.enemies.getChildren(), ...this.npcs].forEach((s) => {
        s.setVelocity(0); if (!s.down && !s.npc?.down) this.loco(s, false);
      });
    } else {
      this.updateCompanions(time);
      this.updateEnemies(time);
      this.updateNpcs(time);
    }
    this.updateProximity();
    this.updateMusic(time);

    // Сортировка по глубине: кто ниже на экране — тот ближе
    this.player.setDepth(this.player.y);
    this.companions.forEach((c) => c.setDepth(c.down ? c.y - 20 : c.y));
    this.enemies.getChildren().forEach((e) => e.setDepth(e.y));
    this.stinkFx.emitting = time < this.st.stinkUntil;

    for (const ex of this.exits) {
      if (ex.rect.contains(this.player.x, this.player.y)) { ex.go(); break; }
    }
  }

  updateMusic(time) {
    if (time < this.nextMusicCheck) return;
    this.nextMusicCheck = time + 400;
    const p = this.player;
    const fight = this.enemies.getChildren().some((e) => e.state !== 'idle'
      && Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y) < 260);
    let key = this.musicMode;
    if (fight) { key = 'm_battle'; this.calmSince = time; }
    else if (this.musicMode !== 'm_battle' || time - this.calmSince > 3500) key = this.calmMusic();
    if (key !== this.musicMode) {
      this.musicMode = key;
      audio(this.game).music(key, this, key === 'm_battle' ? 600 : 2000);
    }
  }

  updatePlayer(time, dt) {
    const k = this.keys, p = this.player, st = this.st;
    st.stamina = Math.min(this.d.maxStamina, st.stamina + 26 * dt);
    if (st.raging && time > st.raging) { st.raging = 0; p.clearTint(); }

    if (this.dialogue.active || this.cinematic) { p.setVelocity(0); this.loco(p, false); return; }
    if (this.dodging) return;
    if (time < this.lungeUntil) return;

    let vx = 0, vy = 0;
    if (k.left.isDown || k.left2.isDown) vx -= 1;
    if (k.right.isDown || k.right2.isDown) vx += 1;
    if (k.up.isDown || k.up2.isDown) vy -= 1;
    if (k.down.isDown || k.down2.isDown) vy += 1;
    const v = new Phaser.Math.Vector2(vx, vy);
    const attacking = time < p.animLock;
    if (v.lengthSq() > 0) {
      v.normalize();
      this.facing.copy(v);
      if (vx && !attacking) p.setFlipX(vx < 0);
    }
    // во время удара двигаемся медленнее — удар «весит»
    const speed = this.d.speed * (st.raging ? 1.15 : 1) * (attacking ? 0.35 : 1);
    p.setVelocity(v.x * speed, v.y * speed);
    this.loco(p, v.lengthSq() > 0);
  }

  tryDodge() {
    const st = this.st, p = this.player;
    if (this.dodging || this.dead || this.leaving || st.stamina < 20) return;
    st.stamina -= 20;
    this.dodging = true;
    const dir = this.facing.clone().normalize();
    if (dir.x) p.setFlipX(dir.x < 0);
    p.setVelocity(dir.x * 270, dir.y * 270);
    this.oneShot(p, 'dodge', { frameRate: 18 });
    this.sfx('s_dodge', { volume: 0.6 });
    this.add.particles(p.x, p.y, 'px', { speed: { min: 10, max: 40 }, angle: { min: 180, max: 360 }, lifespan: 400,
      scale: { start: 1.4, end: 0 }, tint: 0x6a6040, alpha: { start: 0.6, end: 0 }, emitting: false }).setDepth(p.y - 1).explode(10);
    this.time.delayedCall(230, () => {
      this.dodging = false;
      p.setVelocity(dir.x * 60, dir.y * 60);
    });
  }

  tryRage() {
    if (this.st.rage < 100 || this.st.raging) return;
    this.st.rage = 0;
    this.st.raging = this.time.now + 7000;
    this.player.setTint(0xff6060);
    this.cameras.main.flash(200, 120, 0, 0);
    this.cameras.main.shake(250, 0.008);
    this.sfx('s_rage');
    this.floatText(this.player.x, this.player.y - 70, 'ЯРОСТЬ!', '#d8283a', 12);
  }

  tryAttack(fromMouse) {
    if (this.dead || this.dodging || this.dialogue.active || this.levelUpOpen || this.leaving || this.cinematic) return;
    const now = this.time.now, w = this.hero.weapon, st = this.st, p = this.player;
    if (now < this.nextAttack) return;
    if (st.stamina < w.cost) { this.events.emit('noStamina'); return; }
    st.stamina -= w.cost;
    this.nextAttack = now + w.cooldown;
    this.combo = now - (this.lastAttack || 0) < 800 ? ((this.combo || 0) + 1) % 3 : 0;
    this.lastAttack = now;

    let ang;
    if (fromMouse) {
      const wp = this.input.activePointer.positionToCamera(this.cameras.main);
      ang = Phaser.Math.Angle.Between(p.x, p.y - 24, wp.x, wp.y);
      this.facing.set(Math.cos(ang), Math.sin(ang));
    } else ang = Math.atan2(this.facing.y, this.facing.x);
    p.setFlipX(Math.cos(ang) < 0);

    const heavy = this.combo === 2;
    // Анимация удара: замах -> удар (кадр 3 из 5) -> возврат. Под скорость оружия героя.
    const fps = Math.max(14, 5 / (w.cooldown * 0.9 / 1000)) * (heavy ? 0.85 : 1);
    const len = this.oneShot(p, 'attack', { frameRate: fps });
    this.sfx(heavy ? 's_swing_heavy' : 's_swing', { volume: 0.7 });

    this.time.delayedCall(len * 0.4, () => {
      if (this.dead) return;
      const range = w.range * RANGE_K * (heavy ? 1.25 : 1);
      this.swingSmear(p.x, p.y - 26, ang, range, w.arc, heavy, this.combo % 2 === 1, this.hero.color);
      this.lungeUntil = this.time.now + 90;
      p.setVelocity(Math.cos(ang) * (heavy ? 140 : 90), Math.sin(ang) * (heavy ? 140 : 90));

      const inArc = (tx, ty) => {
        const dist = Phaser.Math.Distance.Between(p.x, p.y - 24, tx, ty);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(p.x, p.y - 24, tx, ty) - ang));
        return dist < range + 16 && diff < w.arc / 2 + 0.4;
      };
      const dmg = this.d.damage * (heavy ? 1.8 : 1) * (st.raging ? 2 : 1);
      let hitAny = false;
      this.enemies.getChildren().slice().forEach((e) => {
        if (inArc(e.x, e.y - 20)) { hitAny = true; this.hitEnemy(e, dmg * Phaser.Math.FloatBetween(0.85, 1.15), ang, heavy); }
      });
      if (this.onSwing(inArc, ang, heavy)) hitAny = true;
      if (hitAny) this.hitStop(heavy ? 90 : 50);
    });
  }

  // Светящийся шлейф клинка
  swingSmear(x, y, ang, range, arc, heavy, flip, color) {
    const sm = this.add.image(x, y, 'smear').setOrigin(0, 0.5).setRotation(ang)
      .setBlendMode('ADD').setDepth(y + 40).setFlipY(flip)
      .setScale(range / 66, (range / 66) * Math.min(1.4, arc / 1.2));
    sm.setTint(heavy ? 0xffffff : 0xdde8ff);
    const sm2 = this.add.image(x, y, 'smear').setOrigin(0, 0.5).setRotation(ang)
      .setBlendMode('ADD').setDepth(y + 39).setFlipY(flip).setTint(color).setAlpha(0.6)
      .setScale(sm.scaleX * 1.12, sm.scaleY * 1.12);
    this.tweens.add({ targets: [sm, sm2], alpha: 0, scaleX: sm.scaleX * 1.15, duration: heavy ? 220 : 150, ease: 'Quad.out',
      onComplete: () => { sm.destroy(); sm2.destroy(); } });
  }

  // Хитстоп: короткая заморозка — удар ощущается тяжёлым
  hitStop(ms) {
    this.physics.world.pause();
    const all = [this.player, ...this.enemies.getChildren()];
    all.forEach((s) => s.anims.pause());
    this.time.delayedCall(ms, () => {
      if (!this.levelUpOpen && !this.dead) this.physics.world.resume();
      all.forEach((s) => s.active && s.anims.resume());
    });
  }

  // ---------- УРОН ----------
  hitEnemy(e, dmg, ang, heavy, byCompanion = false) {
    if (!e.active || e.hp <= 0) return;
    e.hp -= dmg;
    e.setTintFill(0xffffff);
    this.time.delayedCall(70, () => e.active && e.clearTint());
    const kb = heavy ? 230 : 130;
    e.setVelocity(Math.cos(ang) * kb, Math.sin(ang) * kb);
    e.state = 'stagger'; e.until = this.time.now + (heavy ? 420 : 240);
    this.oneShot(e, 'hurt', { lock: heavy ? 400 : 220 });
    this.blood.explode(heavy ? 20 : 10, e.x, e.y - 22);
    this.sparks.explode(heavy ? 10 : 5, e.x - Math.cos(ang) * 6, e.y - 24);
    this.sfx('s_hit', { volume: byCompanion ? 0.4 : 0.8 });
    if (heavy || e.type === 'soldier') this.sfx('s_metal', { volume: 0.4 });
    if (e.type === 'wolf' && Math.random() < 0.5) this.sfx('s_yelp', { volume: 0.5 });
    this.floatText(e.x, e.y - 58, Math.round(dmg).toString(), heavy ? '#ffe08a' : '#f0f4ff', heavy ? 11 : 9);
    if (!byCompanion) this.cameras.main.shake(heavy ? 130 : 60, heavy ? 0.007 : 0.003);
    if (e.hp <= 0) this.killEnemy(e, ang);
  }

  killEnemy(e, ang) {
    const { x, y } = e;
    for (let i = 0; i < 8; i++) {
      const piece = this.add.image(x, y - 20, 'px').setTint(Phaser.Utils.Array.GetRandom([0x6e1020, 0xd8283a, e.type === 'wolf' ? 0x4a4450 : 0x5a5048]))
        .setScale(Phaser.Math.FloatBetween(1.5, 3)).setDepth(y + 2);
      const a = ang + Phaser.Math.FloatBetween(-0.9, 0.9), d = Phaser.Math.Between(20, 54);
      this.tweens.add({ targets: piece, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, angle: 360, duration: 400, ease: 'Quad.out',
        onComplete: () => { this.decals.add(piece); piece.setDepth(0); } });
    }
    this.blood.explode(30, x, y - 20);
    this.sfx(e.type === 'wolf' ? 's_yelp' : 's_groan', { volume: 0.7, rate: 0.8 });
    const pool = this.add.ellipse(x, y - 2, Phaser.Math.Between(22, 34), Phaser.Math.Between(8, 12), 0x5a0c18, 0.85);
    this.decals.add(pool);
    this.tweens.add({ targets: pool, scaleX: 1.4, scaleY: 1.3, duration: 3000 });
    const corpse = this.add.image(x, y, e.texture.key, this.deadFrame(e.texture.key)).setOrigin(0.5, ORIGIN_Y)
      .setFlipX(e.flipX).setTint(0x9a8080);
    this.decals.add(corpse);

    this.gainXp(e.T.xp);
    e.destroy();
    if (Math.random() < 0.45) this.bark(Phaser.Utils.Array.GetRandom(this.companions.filter((c) => !c.down)), 'kill');
  }

  hurtPlayer(dmg, from) {
    if (this.dodging || this.dead || this.time.now < this.invuln) return;
    const st = this.st, p = this.player;
    st.hp -= dmg;
    st.rage = Math.min(100, st.rage + dmg * this.d.rageGain * 2.5);
    this.invuln = this.time.now + 400;
    p.setTintFill(0xff2040);
    this.time.delayedCall(90, () => (st.raging ? p.setTint(0xff6060) : p.clearTint()));
    this.oneShot(p, 'hurt', { lock: 200 });
    this.blood.explode(12, p.x, p.y - 24);
    this.sfx('s_hurt', { volume: 0.8 });
    this.cameras.main.shake(140, 0.009);
    if (from) {
      const a = Phaser.Math.Angle.Between(from.x, from.y, p.x, p.y);
      this.lungeUntil = this.time.now + 130;
      p.setVelocity(Math.cos(a) * 160, Math.sin(a) * 160);
    }
    this.floatText(p.x, p.y - 66, `-${dmg}`, '#ff4060', 10);
    if (st.hp <= 0) this.die();
  }

  hurtCompanion(c, dmg) {
    if (c.down) return;
    c.hp -= dmg;
    c.setTintFill(0xff2040);
    this.time.delayedCall(90, () => c.clearTint());
    this.oneShot(c, 'hurt', { lock: 200 });
    this.blood.explode(8, c.x, c.y - 24);
    if (Math.random() < 0.25) this.bark(c, 'hurt');
    if (c.hp <= 0) {
      c.down = true; c.hp = 0; c.setVelocity(0);
      this.oneShot(c, 'dead', { lock: 1e12 });
      this.sfx('s_death', { volume: 0.5 });
      this.floatText(c.x, c.y - 40, 'без сознания', '#a898a8', 8);
    }
  }

  reviveAll() {
    this.companions.forEach((c) => { c.down = false; c.hp = c.maxHp; c.animLock = 0; this.loco(c, false); });
  }

  // ---------- СПУТНИКИ ----------
  updateCompanions(time) {
    const p = this.player, stinky = time < this.st.stinkUntil;
    this.companions.forEach((c) => {
      if (c.down) {
        c.setVelocity(0);
        // Поднять спутника: постоять рядом 2 секунды
        if (Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y) < 34) {
          c.revive += this.game.loop.delta;
          if (c.revive > 2000) {
            c.down = false; c.revive = 0; c.hp = Math.round(c.maxHp * 0.5);
            c.animLock = 0; this.loco(c, false);
            this.sfx('s_heal', { volume: 0.5 });
            this.floatText(c.x, c.y - 60, 'Встаю...', '#6ff0e0', 8);
          }
        } else c.revive = 0;
        return;
      }

      // Эдрик лечит героя, если тому плохо
      if (c.cid === 'edrik' && this.st.hp < this.d.maxHp * 0.45 && time > c.nextHeal) {
        c.nextHeal = time + 14000;
        const heal = Math.round(this.d.maxHp * 0.3);
        this.st.hp = Math.min(this.d.maxHp, this.st.hp + heal);
        this.floatText(p.x, p.y - 70, `+${heal}`, '#6ff0e0', 10);
        this.sfx('s_heal', { volume: 0.7 });
        this.add.particles(p.x, p.y - 24, 'px', { speed: 40, lifespan: 700, tint: 0x6ff0e0, blendMode: 'ADD', emitting: false }).explode(24);
      }

      let target = null, best = 160;
      this.enemies.getChildren().forEach((e) => {
        const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
        if (d < best) { best = d; target = e; }
      });

      let moving = false;
      if (target) {
        const reach = c.cid === 'valder' ? 46 : 38;
        if (best > reach) { this.physics.moveToObject(c, target, c.speed); moving = true; c.setFlipX(target.x < c.x); }
        else {
          c.setVelocity(0);
          if (time > c.nextHit) {
            c.nextHit = time + c.cool;
            c.setFlipX(target.x < c.x);
            const w = HEROES[c.cid].weapon;
            const len = this.oneShot(c, 'attack', { frameRate: Math.max(12, 5 / (w.cooldown * 1.2 / 1000)) });
            this.time.delayedCall(len * 0.4, () => {
              if (c.down || !target.active) return;
              const ang = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
              this.swingSmear(c.x, c.y - 26, ang, w.range * RANGE_K, w.arc, false, false, HEROES[c.cid].color);
              this.sfx('s_swing', { volume: 0.35 });
              this.hitEnemy(target, c.dmg * Phaser.Math.FloatBetween(0.8, 1.2), ang, false, true);
            });
          }
        }
      } else {
        // Идём за героем; если герой воняет — держимся подальше
        const keep = stinky ? 90 : 44;
        const tx = p.x + c.side * keep, ty = p.y + 14;
        const d = Phaser.Math.Distance.Between(c.x, c.y, tx, ty);
        if (d > 300) c.setPosition(p.x + c.side * 30, p.y + 10);   // застрял — догоняет
        if (d > 14) {
          this.physics.moveTo(c, tx, ty, Math.min(c.speed * 1.25, d * 3));
          c.setFlipX(tx < c.x);
          moving = true;
        } else c.setVelocity(0);
      }
      this.loco(c, moving);

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
    const meta = this.cache.json.get('anims');
    this.enemies.getChildren().forEach((e) => {
      if (e.state === 'stagger') { if (time > e.until) e.state = 'idle'; else return; }

      let t = null, best = 180;
      targets.forEach((cand) => {
        const d = Phaser.Math.Distance.Between(e.x, e.y, cand.x, cand.y);
        if (d < best) { best = d; t = cand; }
      });

      // Звери боятся вони
      if (e.type === 'wolf' && stinky && Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y) < 150) {
        const a = Phaser.Math.Angle.Between(p.x, p.y, e.x, e.y);
        e.setVelocity(Math.cos(a) * e.T.speed * 1.3, Math.sin(a) * e.T.speed * 1.3);
        e.setFlipX(Math.cos(a) < 0);
        e.state = 'idle'; e.clearTint();
        this.loco(e, true);
        if (!e.fleeBark || time > e.fleeBark) { e.fleeBark = time + 4000; this.sfx('s_yelp', { volume: 0.4 }); this.floatText(e.x, e.y - 40, 'скулит', '#8ad040', 8); }
        return;
      }

      switch (e.state) {
        case 'idle': {
          if (t) { e.state = 'chase'; e.target = t; if (e.type === 'wolf') this.sfx('s_growl', { volume: 0.5 }); break; }
          const dh = Phaser.Math.Distance.Between(e.x, e.y, e.home.x, e.home.y);
          if (dh > 20) { this.physics.moveTo(e, e.home.x, e.home.y, e.T.speed * 0.5); e.setFlipX(e.home.x < e.x); this.loco(e, true); }
          else { e.setVelocity(0); this.loco(e, false); }
          break;
        }
        case 'chase': {
          if (!t) { e.state = 'idle'; break; }
          e.target = t;
          e.setFlipX(t.x < e.x);
          if (best <= e.T.reach) {
            e.state = 'windup'; e.until = time + e.T.windup; e.setVelocity(0);
            // Замах: первый кадр удара + красное мигание — подсказка, когда перекатываться
            e.anims.stop();
            e.setFrame(meta[e.type].attack[0]);
            e.setTint(0xff8080);
            this.tweens.add({ targets: e, x: e.x - (e.flipX ? -3 : 3), duration: e.T.windup * 0.8, ease: 'Sine.out' });
            if (e.type === 'wolf') this.sfx('s_growl', { volume: 0.55, rate: 1.2 });
            else this.sfx('s_groan', { volume: 0.45, rate: e.type === 'soldier' ? 0.8 : 1 });
          } else { this.physics.moveToObject(e, t, e.T.speed); this.loco(e, true); }
          break;
        }
        case 'windup':
          if (time > e.until) {
            e.clearTint();
            const tg = e.target;
            if (!tg?.active) { e.state = 'idle'; break; }
            this.oneShot(e, 'attack', { frameRate: 16 });
            if (e.type === 'wolf') {
              const a = Phaser.Math.Angle.Between(e.x, e.y, tg.x, tg.y);
              e.setVelocity(Math.cos(a) * 260, Math.sin(a) * 260);
              e.state = 'lunge'; e.until = time + 280; e.hitDone = false;
            } else {
              this.time.delayedCall(e.type === 'soldier' ? 110 : 70, () => {
                if (!e.active || e.state === 'stagger') return;
                const d = Phaser.Math.Distance.Between(e.x, e.y, tg.x, tg.y);
                this.swingSmear(e.x, e.y - 24, Phaser.Math.Angle.Between(e.x, e.y, tg.x, tg.y), e.T.reach, 1.2, false, false, e.T.smear);
                if (e.type === 'soldier') this.sfx('s_swing', { volume: 0.5, rate: 0.9 });
                if (d <= e.T.reach + 10) this.damageTarget(tg, e.T.dmg, e);
              });
              e.state = 'recover'; e.until = time + 750;
            }
          }
          break;
        case 'lunge':
          if (!e.hitDone) {
            targets.forEach((cand) => {
              if (!e.hitDone && Phaser.Math.Distance.Between(e.x, e.y, cand.x, cand.y) < 28) { e.hitDone = true; this.damageTarget(cand, e.T.dmg, e); }
            });
          }
          if (time > e.until) { e.setVelocity(0); e.state = 'recover'; e.until = time + 750; }
          break;
        case 'recover':
          e.setVelocity(e.body.velocity.x * 0.85, e.body.velocity.y * 0.85);
          this.loco(e, false);
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
    let best = null, bd = Infinity;
    for (const it of this.interactables) {
      const x = it.follow ? it.follow.x : it.x, y = it.follow ? it.follow.y : it.y;
      if (it.follow) it.label.setPosition(x, y + it.labelDy);
      const d = Phaser.Math.Distance.Between(p.x, p.y, x, y);
      if (d < it.r && d < bd && !(it.enabled === false)) { best = it; bd = d; }
    }
    this.nearest = best;
    for (const it of this.interactables) {
      const talking = it.follow?.sayText?.active;   // не закрывать подсказкой реплику NPC
      it.label.setVisible(it === best && !this.dialogue.active && !talking);
    }
  }

  // ---------- ОПЫТ И УРОВНИ ----------
  gainXp(n) {
    const s = this.saveData;
    if (s.level >= MAX_LEVEL) return;
    s.xp += n;
    this.floatText(this.player.x, this.player.y - 80, `+${n} опыта`, '#e0b040', 8);
    if (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level++;
      this.pendingPoints = (this.pendingPoints || 0) + 2;
      this.time.delayedCall(250, () => this.openLevelUp());
    }
  }

  openLevelUp() {
    if (this.levelUpOpen || this.dead) return;
    this.levelUpOpen = true;
    this.physics.world.pause();
    this.player.setVelocity(0);
    this.sfx('s_levelup');
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    objs.push(this.add.rectangle(W / 2, H / 2, 290, 140, 0x0d0814, 0.95).setStrokeStyle(2, 0xe0b040).setScrollFactor(0).setDepth(9000));
    const title = txt(this, W / 2, H / 2 - 52, '', 12, '#e0b040', { origin: 0.5, bold: true }).setScrollFactor(0).setDepth(9001);
    const names = [['str', 'Сила', 'урон'], ['dex', 'Ловкость', 'скорость, выносливость'], ['con', 'Выносливость', 'здоровье'], ['wil', 'Воля', 'ярость копится быстрее']];
    const lines = names.map(([, n, hint], i) => txt(this, W / 2 - 128, H / 2 - 30 + i * 18, '', 9, '#e8dccc').setScrollFactor(0).setDepth(9001).setData('hint', hint).setData('n', n));
    const help = txt(this, W / 2, H / 2 + 52, 'нажми 1, 2, 3 или 4', 8, '#8a7e98', { origin: 0.5 }).setScrollFactor(0).setDepth(9001);
    objs.push(title, help, ...lines);
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
      this.sfx('s_click');
      if (this.pendingPoints > 0) return redraw();
      this.input.keyboard.off('keydown', handler);
      objs.forEach((o) => o.destroy());
      this.recalc(true);
      this.levelUpOpen = false;
      this.physics.world.resume();
      save(this.saveData);
      this.floatText(this.player.x, this.player.y - 70, 'Сильнее.', '#e0b040', 10);
    };
    this.input.keyboard.on('keydown', handler);
  }

  // ---------- СМЕРТЬ ----------
  die() {
    this.dead = true;
    this.physics.world.pause();
    this.player.setVelocity(0);
    this.oneShot(this.player, 'dead', { lock: 1e12 });
    this.player.setTint(0xaa6666);
    this.sfx('s_death');
    audio(this.game).music(null, this, 1500);
    this.musicMode = null;
    this.cameras.main.shake(300, 0.01);
    const W = this.scale.width, H = this.scale.height;
    const shade = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(9500);
    this.tweens.add({ targets: shade, fillAlpha: 0.85, duration: 1200 });
    const t1 = txt(this, W / 2, H / 2 - 30, 'ТЫ ПАЛ', 22, '#d8283a', { origin: 0.5, pixel: true, strokeThickness: 4 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    const t2 = txt(this, W / 2, H / 2 + 8, `«${Phaser.Utils.Array.GetRandom(PHRASES)}»`, 9, '#e8dccc', { origin: 0.5, align: 'center', wrap: 380 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    const t3 = txt(this, W / 2, H / 2 + 50, 'нажми любую клавишу — очнуться', 8, '#8a8090', { origin: 0.5 }).setScrollFactor(0).setDepth(9501).setAlpha(0);
    this.tweens.add({ targets: [t1, t2, t3], alpha: 1, duration: 900, delay: 500 });
    this.time.delayedCall(1600, () => {
      const go = () => {
        this.input.keyboard.off('keydown', go); this.input.off('pointerdown', go);
        [shade, t1, t2, t3].forEach((o) => o.destroy());
        const sp = this.respawnPoint();
        this.player.setPosition(sp.x, sp.y).clearTint();
        this.player.animLock = 0; this.loco(this.player, false);
        this.companions.forEach((c, i) => { c.setPosition(sp.x - 30 + i * 60, sp.y + 24); });
        this.dead = false;
        this.physics.world.resume();
        this.nextMusicCheck = 0;
        this.recalc(true);
        this.reviveAll();
        this.onRespawn();
      };
      this.input.keyboard.on('keydown', go);
      this.input.on('pointerdown', go);
    });
  }

  respawnPoint() { return this.spawnPoint(); }

  // ---------- МЕЛОЧИ ----------
  floatText(x, y, str, color, size = 9) {
    const t = txt(this, x, y, str, size, color, { origin: 0.5, bold: true }).setDepth(9990);
    this.tweens.add({ targets: t, y: y - 20, alpha: 0, duration: 950, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  // Фоновая реплика (торговцы, прохожие, спутники): не больше одной за раз,
  // и не поверх реплики героя — иначе текст налезает и ничего не прочитать
  ambientSay(s, str, color, ms = 2600, dy = -74) {
    if (!s || this.time.now < this.nextBarkAt) return null;
    this.nextBarkAt = this.time.now + ms + 300;
    return this.say(s, str, color, ms, dy);
  }

  // Реплика над головой (для NPC и самого героя)
  say(s, str, color = '#f0f4ff', ms = 2600, dy = -74) {
    if (s === this.player) this.nextBarkAt = Math.max(this.nextBarkAt, this.time.now + ms + 300);
    s.sayText?.destroy();
    const t = txt(this, s.x, s.y + dy, str, 8, color, { origin: 0.5, align: 'center', wrap: 160 }).setDepth(9980);
    s.sayText = t;
    const follow = this.time.addEvent({ delay: 16, loop: true, callback: () => t.active && t.setPosition(s.x, s.y + dy) });
    this.time.delayedCall(ms, () => { follow.remove(); this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() }); });
    return t;
  }

  bark(c, kind) {
    if (!c || c.down) return;
    const lines = BARKS[c.cid]?.[kind];
    if (!lines) return;
    this.ambientSay(c, Phaser.Utils.Array.GetRandom(lines));
  }
}
