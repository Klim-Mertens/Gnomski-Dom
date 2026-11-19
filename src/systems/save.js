// Сохранение в localStorage браузера. Сервера нет — данные остаются у игрока.
// Безопасность: файл сохранения может быть подделан или испорчен, поэтому
// при загрузке всё проверяем и обрезаем до допустимых значений, а не доверяем.
import { HERO_IDS, MAX_LEVEL } from '../data/heroes.js';

const KEY = 'gnomski-dom-save-v1';

const clampInt = (v, min, max, def) =>
  Number.isInteger(v) && v >= min && v <= max ? v : def;

export function defaultSave(hero) {
  return {
    hero,
    level: 1,
    xp: 0,
    bonus: { str: 0, dex: 0, con: 0, wil: 0 }, // очки, вложенные игроком
    flags: { bottlesDone: false },
    trust: { valder: 0, edrik: 0, yarka: 0 },
  };
}

export function validate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!HERO_IDS.includes(raw.hero)) return null; // только известные герои
  const s = defaultSave(raw.hero);
  s.level = clampInt(raw.level, 1, MAX_LEVEL, 1);
  s.xp = clampInt(raw.xp, 0, 1e6, 0);
  for (const k of Object.keys(s.bonus)) s.bonus[k] = clampInt(raw.bonus?.[k], 0, 30, 0);
  s.flags.bottlesDone = raw.flags?.bottlesDone === true;
  for (const k of Object.keys(s.trust)) s.trust[k] = clampInt(raw.trust?.[k], 0, 100, 0);
  return s;
}

export function load() {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt || txt.length > 10000) return null; // защита от мусора огромного размера
    return validate(JSON.parse(txt));
  } catch {
    return null; // битый JSON — просто начинаем заново
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // приватный режим браузера или переполнение
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ничего */ }
}
