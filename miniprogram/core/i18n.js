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

function getLanguageList() {
  return LANGUAGES.map((x) => ({ ...x }));
}

module.exports = {
  DEFAULT_LANG,
  LANGUAGES,
  getLanguage,
  setLanguage,
  getLanguageList,
  t,
};
