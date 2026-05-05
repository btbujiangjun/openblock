const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_lang';
const DEFAULT_LANG = 'zh-CN';

const LANGUAGES = [
  { id: 'zh-CN', name: '简体中文' },
  { id: 'en', name: 'English' },
];

const MESSAGES = {
  'zh-CN': {
    title: 'Open Block',
    subtitle: '方块消除',
    skin: '皮肤',
    language: '语言',
    difficulty: '难度',
    startGame: '开始游戏',
    footer: 'Open Source Block Blast',
    score: '得分',
    steps: '步数',
    clears: '消行',
    best: '最佳',
    bestGap: '差 {n} 分',
    gameOver: '游戏结束',
    finalScore: '得分：{n}',
    finalClears: '消行：{n}',
    restart: '再来一局',
    effectPerfectClear: '清屏',
    effectMultiClear: '{n} 消',
    effectDoubleClear: '双消',
    effectIconBonus: '爆炸大消除',
    effectNewRecord: '新纪录',
    difficultyEasy: '简单模式',
    difficultyNormal: '普通模式',
    difficultyHard: '挑战模式',
    skinNames: {
      classic: '✨ 极简经典',
      titanium: '💎 钛晶矩阵',
      aurora: '🌌 冰川极光',
      neonCity: '🌃 霓虹都市',
      ocean: '🌊 深海幽域',
      sunset: '🌅 琥珀流光',
      sakura: '🌸 樱花飞雪',
      koi: '🎏 锦鲤跃龙',
      candy: '🍭 糖果甜心',
      bubbly: '🫧 元气泡泡',
      toon: '🎨 卡通乐园',
      pixel8: '👾 街机格斗',
      dawn: '☀️ 晨光微曦',
      food: '🍕 美食盛宴',
      music: '🎹 音乐律动',
      pets: '🐶 萌宠天地',
      universe: '🪐 宇宙星际',
      fantasy: '🔮 魔幻秘境',
      beast: '🗺️ 冒险奇境',
      greece: '🏛️ 希腊神话',
      demon: '😈 恶魔冥界',
      jurassic: '🦕 恐龙世界',
      fairy: '🧚 花仙梦境',
      industrial: '🏭 古典工业',
      forbidden: '👑 北京皇城',
      mahjong: '🀄 麻将牌局',
      boardgame: '🃏 扑克博弈',
      sports: '⚽ 运动竞技',
      outdoor: '🥾 户外运动',
      vehicles: '🏎️ 极速引擎',
      forest: '🌳 山林秘境',
      pirate: '🦜 海盗航行',
      farm: '🐄 田园农场',
      desert: '🐫 沙漠绿洲',
    },
  },
  en: {
    title: 'Open Block',
    subtitle: 'Block Puzzle',
    skin: 'Skin',
    language: 'Language',
    difficulty: 'Difficulty',
    startGame: 'Start Game',
    footer: 'Open Source Block Blast',
    score: 'Score',
    steps: 'Steps',
    clears: 'Clears',
    best: 'Best',
    bestGap: '{n} pts to best',
    gameOver: 'Game Over',
    finalScore: 'Score: {n}',
    finalClears: 'Clears: {n}',
    restart: 'Play Again',
    effectPerfectClear: 'Perfect Clear',
    effectMultiClear: '{n}x Clear',
    effectDoubleClear: 'Double Clear',
    effectIconBonus: 'Big Blast Clear',
    effectNewRecord: 'New Record',
    difficultyEasy: 'Easy',
    difficultyNormal: 'Normal',
    difficultyHard: 'Hard',
    skinNames: {
      classic: '✨ Minimal Classic',
      titanium: '💎 Titanium Matrix',
      aurora: '🌌 Glacier Aurora',
      neonCity: '🌃 Neon City',
      ocean: '🌊 Deep Ocean',
      sunset: '🌅 Amber Sunset',
      sakura: '🌸 Sakura Snow',
      koi: '🎏 Koi Dragon',
      candy: '🍭 Candy Pop',
      bubbly: '🫧 Bubble Pop',
      toon: '🎨 Toon Park',
      pixel8: '👾 Arcade Pixel',
      dawn: '☀️ Soft Dawn',
      food: '🍕 Food Feast',
      music: '🎹 Music Beat',
      pets: '🐶 Pet Friends',
      universe: '🪐 Cosmic Space',
      fantasy: '🔮 Mystic Realm',
      beast: '🗺️ Wild Adventure',
      greece: '🏛️ Greek Myth',
      demon: '😈 Demon Realm',
      jurassic: '🦕 Jurassic World',
      fairy: '🧚 Fairy Garden',
      industrial: '🏭 Industrial Age',
      forbidden: '👑 Imperial Palace',
      mahjong: '🀄 Mahjong Table',
      boardgame: '🃏 Board Game',
      sports: '⚽ Sports Arena',
      outdoor: '🥾 Outdoor Trail',
      vehicles: '🏎️ Speed Engine',
      forest: '🌳 Forest Haven',
      pirate: '🦜 Pirate Voyage',
      farm: '🐄 Farm Life',
      desert: '🐫 Desert Oasis',
    },
  },
};

function getLanguage() {
  const saved = storage.getItem(STORAGE_KEY);
  return MESSAGES[saved] ? saved : DEFAULT_LANG;
}

function setLanguage(lang) {
  if (!MESSAGES[lang]) return false;
  storage.setItem(STORAGE_KEY, lang);
  return true;
}

function t(key, params = {}) {
  const dict = MESSAGES[getLanguage()] || MESSAGES[DEFAULT_LANG];
  const raw = dict[key] || MESSAGES[DEFAULT_LANG][key] || key;
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

function skinName(id, fallback = id, lang = getLanguage()) {
  const dict = MESSAGES[lang] || MESSAGES[DEFAULT_LANG];
  return dict.skinNames?.[id] || MESSAGES[DEFAULT_LANG].skinNames?.[id] || fallback;
}

function getLanguageList() {
  return LANGUAGES.map((x) => ({ ...x }));
}

module.exports = {
  DEFAULT_LANG,
  LANGUAGES,
  getLanguage,
  setLanguage,
  getLanguageList,
  skinName,
  t,
};
