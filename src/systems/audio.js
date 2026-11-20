// Музыка и звуки. Музыка плавно перетекает между темами (лес <-> бой и т.д.).
// M — выключить/включить звук. Настройка хранится в localStorage.
const MUSIC_VOL = 0.45;
const SFX_VOL = 0.7;
const MUTE_KEY = 'gnomski-dom-mute';

export const MUSIC = ['m_title', 'm_forest', 'm_battle', 'm_campfire', 'm_bottles', 'm_city', 'm_bazaar', 'm_fortress'];
export const SFX = ['s_swing', 's_swing_heavy', 's_hit', 's_metal', 's_step', 's_dodge', 's_glass', 's_splash',
  's_levelup', 's_growl', 's_yelp', 's_groan', 's_hurt', 's_death', 's_click', 's_rage', 's_fire', 's_heal', 's_throw', 's_crowd', 's_door'];

export function preloadAudio(scene) {
  [...MUSIC, ...SFX].forEach((k) => scene.load.audio(k, `assets/audio/${k}.mp3`));
}

class AudioManager {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.currentKey = null;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { this.muted = false; }
    game.sound.mute = this.muted;
  }

  // Плавно изменить громкость. Считаем по реальному времени, а не твином сцены:
  // сцена может встать на паузу или закрыться посреди перехода.
  fadeTo(_scene, snd, to, ms, done) {
    const from = snd.volume, t0 = performance.now();
    const step = () => {
      if (!snd.manager || snd.pendingRemove) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      snd.setVolume(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(step); else done?.();
    };
    requestAnimationFrame(step);
  }

  // Переключить музыку с плавным переходом
  music(key, scene, fade = 1200) {
    if (this.currentKey === key) return;
    const old = this.current;
    if (old) this.fadeTo(scene, old, 0, fade, () => { if (old.manager) { old.stop(); old.destroy(); } });
    this.currentKey = key;
    if (!key) { this.current = null; return; }
    const m = this.game.sound.add(key, { loop: true, volume: 0 });
    m.play();
    this.fadeTo(scene, m, MUSIC_VOL, fade);
    this.current = m;
  }

  sfx(key, opts = {}) {
    if (!this.game.cache.audio.exists(key)) return;
    this.game.sound.play(key, {
      volume: (opts.volume ?? 1) * SFX_VOL,
      rate: opts.rate ?? 1 + (Math.random() - 0.5) * (opts.vary ?? 0.1), // разброс высоты — звук не надоедает
      detune: 0,
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    this.game.sound.mute = this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* ничего */ }
    return this.muted;
  }
}

export function audio(game) {
  if (!game.audioMgr) game.audioMgr = new AudioManager(game);
  return game.audioMgr;
}
