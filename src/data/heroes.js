// Герои. Цифры баланса можно менять здесь, не трогая код.
// str — сила (урон), dex — ловкость (скорость), con — выносливость (здоровье), wil — воля (ярость)
export const HEROES = {
  valder: {
    name: 'Вальдер',
    title: 'Тяжёлый рыцарь',
    desc: 'Двуручник в рост человека. Медленный, страшный, молчит.',
    stats: { str: 8, dex: 3, con: 8, wil: 5 },
    weapon: { range: 34, arc: 1.4, cost: 22, cooldown: 430 },
    color: 0xd8283a,
  },
  edrik: {
    name: 'Эдрик',
    title: 'Рыцарь со щитом',
    desc: 'Бывший любимец Регента. Меч, щит и слишком много мыслей.',
    stats: { str: 6, dex: 5, con: 6, wil: 6 },
    weapon: { range: 28, arc: 1.2, cost: 16, cooldown: 330 },
    color: 0x6ff0e0,
  },
  yarka: {
    name: 'Ярка',
    title: 'Разбойница',
    desc: 'Два кинжала, улицы Остенграда и самый грязный рот в отряде.',
    stats: { str: 5, dex: 8, con: 4, wil: 6 },
    weapon: { range: 22, arc: 1.0, cost: 10, cooldown: 210 },
    color: 0xe8c060,
  },
};

export const HERO_IDS = Object.keys(HEROES);

// Производные характеристики из базовых
export function derive(stats, level) {
  return {
    maxHp: 40 + stats.con * 8 + level * 4,
    damage: 4 + stats.str * 1.6 + level,
    speed: 70 + stats.dex * 6,
    maxStamina: 60 + stats.dex * 4 + stats.con * 2,
    rageGain: 0.6 + stats.wil * 0.08,
  };
}

// Опыт, нужный для следующего уровня
export const xpForLevel = (lvl) => Math.floor(30 * Math.pow(lvl, 1.5));
export const MAX_LEVEL = 15;
