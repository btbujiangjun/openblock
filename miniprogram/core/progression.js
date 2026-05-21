/**
 * 小程序成长系统（与 web/src/progression.js 镜像）：经验、等级、每日连续活跃。
 *
 * 与 web 版差异：
 *   - 用 CommonJS（小程序壳）；
 *   - titleForLevel 通过传入的 t() 函数解 i18n，避免硬依赖（与 web 一致语义）；
 *   - localStorage 由 miniprogram/adapters/storageShim 注入，行为完全一致。
 *
 * 数据契约：与 web 共用同一 STORAGE_KEY，跨设备同步走 storage shim。
 */

const STORAGE_KEY = 'openblock_progression_v1';

const LEVEL_ACHIEVEMENT_THRESHOLDS = [
  { minLevel: 5,  id: 'level_5'  },
  { minLevel: 10, id: 'level_10' },
  { minLevel: 25, id: 'level_25' },
];

const STRATEGY_XP_MUL = { easy: 0.92, normal: 1, hard: 1.12 };

let _progressLoadCache = null;

function _todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _yesterdayYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function invalidateProgressCache() {
  _progressLoadCache = null;
}

function loadProgress() {
  if (_progressLoadCache) return { ..._progressLoadCache };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        _progressLoadCache = {
          totalXp:     Math.max(0, Number(o.totalXp) || 0),
          bonusDayYmd: typeof o.bonusDayYmd === 'string' ? o.bonusDayYmd : '',
          streakYmd:   typeof o.streakYmd   === 'string' ? o.streakYmd   : '',
          dailyStreak: Math.max(0, Number(o.dailyStreak) || 0),
        };
        return { ..._progressLoadCache };
      }
    }
  } catch { /* ignore */ }
  _progressLoadCache = { totalXp: 0, bonusDayYmd: '', streakYmd: '', dailyStreak: 0 };
  return { ..._progressLoadCache };
}

function saveProgress(state) {
  const normalized = {
    totalXp:     Math.max(0, Number(state.totalXp) || 0),
    bonusDayYmd: typeof state.bonusDayYmd === 'string' ? state.bonusDayYmd : '',
    streakYmd:   typeof state.streakYmd   === 'string' ? state.streakYmd   : '',
    dailyStreak: Math.max(0, Number(state.dailyStreak) || 0),
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    _progressLoadCache = normalized;
  } catch {
    invalidateProgressCache();
  }
}

/** totalXp → 等级（1..99）；公式 Lv = 1 + floor(sqrt(totalXp / 100)) */
function getLevelFromTotalXp(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0);
  const lv = 1 + Math.floor(Math.sqrt(xp / 100));
  return Math.min(99, Math.max(1, lv));
}

function getLevelProgress(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0);
  const level = getLevelFromTotalXp(xp);
  const levelStartXp = (level - 1) ** 2 * 100;
  const nextLevelXp = level ** 2 * 100;
  const span = Math.max(1, nextLevelXp - levelStartXp);
  const frac = Math.min(1, Math.max(0, (xp - levelStartXp) / span));
  return { level, levelStartXp, nextLevelXp, frac };
}

/**
 * 等级称号（与 web 同 6 档：novice/apprentice/adept/expert/master/legend）。
 *
 * @param {number} level
 * @param {(key: string) => string} [tFn] 可选 i18n 解析；缺省回退到中文硬编码
 *   （小程序环境若未注入 i18n，HUD 渲染仍能正常显示）
 */
function titleForLevel(level, tFn) {
  const lv = Math.min(99, Math.max(1, level | 0));
  const key = lv >= 50 ? 'progress.rank.legend'
            : lv >= 35 ? 'progress.rank.master'
            : lv >= 20 ? 'progress.rank.expert'
            : lv >= 10 ? 'progress.rank.adept'
            : lv >=  5 ? 'progress.rank.apprentice'
            : 'progress.rank.novice';
  if (typeof tFn === 'function') {
    try {
      const v = tFn(key);
      if (v && v !== key) return v;
    } catch { /* fall through */ }
  }
  /* 兜底中文文案（与 web zh-CN 同源） */
  return {
    'progress.rank.legend':     '传奇',
    'progress.rank.master':     '大师',
    'progress.rank.expert':     '高手',
    'progress.rank.adept':      '熟练',
    'progress.rank.apprentice': '学徒',
    'progress.rank.novice':     '新手',
  }[key];
}

/**
 * 计算本局结算 XP 增益。与 web 同公式。
 *
 * @param {object} params
 * @param {number} params.score
 * @param {{ clears: number, maxLinesCleared: number }} params.gameStats
 * @param {string} params.strategy easy|normal|hard
 * @param {number} [params.runStreak]
 * @param {object} params.state ProgressState
 */
function computeXpGain(params) {
  const { score, gameStats, strategy, runStreak = 0, state } = params;
  const ymd = _todayYmd();
  const yest = _yesterdayYmd(ymd);
  const mul = STRATEGY_XP_MUL[strategy] ?? 1;

  let firstOfDayBonus = 0;
  if (state.bonusDayYmd !== ymd) firstOfDayBonus = 25;

  let streakForXp = state.dailyStreak || 0;
  if (state.streakYmd !== ymd) {
    streakForXp = state.streakYmd === yest ? (state.dailyStreak || 0) + 1 : 1;
  }
  const streakBonus = Math.min(60, streakForXp * 3);

  const base = Math.floor(score * 0.12) + Math.floor((gameStats.clears || 0) * 1.5);
  const lineBonus = Math.floor(Math.min(gameStats.maxLinesCleared || 0, 8) * 2);
  const runBonus = Math.min(45, Math.max(0, runStreak) * 5);
  let subtotal = Math.floor((base + lineBonus) * mul);
  subtotal += firstOfDayBonus;
  subtotal += streakBonus;
  subtotal += runBonus;

  const total = Math.max(10, subtotal);

  return {
    total,
    breakdown: {
      firstOfDayBonus,
      streakBonus,
      runStreakBonus: runBonus,
      baseAndLines: Math.floor((base + lineBonus) * mul),
    },
    willSetBonusDay: state.bonusDayYmd !== ymd,
    ymd,
  };
}

/**
 * 结算一局：写回 state，返回升级与解锁信息。
 */
function applyGameEndProgression(opts) {
  const state = loadProgress();
  const gain = computeXpGain({
    score: opts.score,
    gameStats: opts.gameStats,
    strategy: opts.strategy,
    runStreak: opts.runStreak ?? 0,
    state,
  });

  const oldXp = state.totalXp;
  const oldLevel = getLevelFromTotalXp(oldXp);
  const ymd = gain.ymd;

  if (gain.willSetBonusDay) state.bonusDayYmd = ymd;

  if (state.streakYmd !== ymd) {
    const yest = _yesterdayYmd(ymd);
    state.dailyStreak = state.streakYmd === yest ? (state.dailyStreak || 0) + 1 : 1;
    state.streakYmd = ymd;
  }

  state.totalXp = oldXp + gain.total;
  const newLevel = getLevelFromTotalXp(state.totalXp);

  saveProgress(state);

  const achievementIds = [];
  for (const row of LEVEL_ACHIEVEMENT_THRESHOLDS) {
    if (oldLevel < row.minLevel && newLevel >= row.minLevel) achievementIds.push(row.id);
  }

  return {
    state,
    xpGained: gain.total,
    breakdown: gain.breakdown,
    oldLevel,
    newLevel,
    leveledUp: newLevel > oldLevel,
    achievementIds,
  };
}

module.exports = {
  STORAGE_KEY,
  invalidateProgressCache,
  loadProgress,
  saveProgress,
  getLevelFromTotalXp,
  getLevelProgress,
  titleForLevel,
  computeXpGain,
  applyGameEndProgression,
};
