/**
 * 玩家成长：经验、等级、每日连续活跃（localStorage）；主题与等级解耦，见 skins.js
 */
import { t } from './i18n/i18n.js';

const STORAGE_KEY = 'openblock_progression_v1';

/**
 * @typedef {{
 *   totalXp: number,
 *   bonusDayYmd: string,
 *   streakYmd: string,
 *   dailyStreak: number
 * }} ProgressState
 */

/** @type {ProgressState | null} */
let _progressLoadCache = null;

/** 测试或跨模块写入 progression 后调用，使 loadProgress 重新读盘 */
export function invalidateProgressCache() {
    _progressLoadCache = null;
}

/** 等级成就：达到 minLevel 时解锁对应成就 id */
export const LEVEL_ACHIEVEMENT_THRESHOLDS = [
    { minLevel: 5, id: 'level_5' },
    { minLevel: 10, id: 'level_10' },
    { minLevel: 25, id: 'level_25' }
];

const STRATEGY_XP_MUL = {
    easy: 0.92,
    normal: 1,
    hard: 1.12
};

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

/** @returns {ProgressState} */
export function loadProgress() {
    if (_progressLoadCache) {
        return { ..._progressLoadCache };
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const o = JSON.parse(raw);
            _progressLoadCache = {
                totalXp: Math.max(0, Number(o.totalXp) || 0),
                bonusDayYmd: typeof o.bonusDayYmd === 'string' ? o.bonusDayYmd : '',
                streakYmd: typeof o.streakYmd === 'string' ? o.streakYmd : '',
                dailyStreak: Math.max(0, Number(o.dailyStreak) || 0)
            };
            return { ..._progressLoadCache };
        }
    } catch {
        /* ignore */
    }
    _progressLoadCache = {
        totalXp: 0,
        bonusDayYmd: '',
        streakYmd: '',
        dailyStreak: 0
    };
    return { ..._progressLoadCache };
}

/** @param {ProgressState} state */
export function saveProgress(state) {
    const normalized = {
        totalXp: Math.max(0, Number(state.totalXp) || 0),
        bonusDayYmd: typeof state.bonusDayYmd === 'string' ? state.bonusDayYmd : '',
        streakYmd: typeof state.streakYmd === 'string' ? state.streakYmd : '',
        dailyStreak: Math.max(0, Number(state.dailyStreak) || 0)
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        _progressLoadCache = normalized;
    } catch {
        invalidateProgressCache();
    }
}

/**
 * totalXp → 等级（1..99）
 * 公式：Lv = 1 + floor(sqrt(totalXp / 100))
 */
export function getLevelFromTotalXp(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    const lv = 1 + Math.floor(Math.sqrt(xp / 100));
    return Math.min(99, Math.max(1, lv));
}

/**
 * @param {number} totalXp
 * @returns {{ level: number, levelStartXp: number, nextLevelXp: number, frac: number }}
 */
export function getLevelProgress(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    const level = getLevelFromTotalXp(xp);
    const levelStartXp = (level - 1) ** 2 * 100;
    const nextLevelXp = level ** 2 * 100;
    const span = Math.max(1, nextLevelXp - levelStartXp);
    const frac = Math.min(1, Math.max(0, (xp - levelStartXp) / span));
    return { level, levelStartXp, nextLevelXp, frac };
}

export function titleForLevel(level) {
    const lv = Math.min(99, Math.max(1, level | 0));
    if (lv >= 50) return t('progress.rank.legend');
    if (lv >= 35) return t('progress.rank.master');
    if (lv >= 20) return t('progress.rank.expert');
    if (lv >= 10) return t('progress.rank.adept');
    if (lv >= 5) return t('progress.rank.apprentice');
    return t('progress.rank.novice');
}

/** 主题不再与等级挂钩，任意主题可随时选用 */
export function isSkinUnlocked(_skinId, _totalXp) {
    return true;
}

/**
 * @param {object} params
 * @param {number} params.score
 * @param {{ clears: number, maxLinesCleared: number }} params.gameStats
 * @param {string} params.strategy easy|normal|hard
 * @param {number} [params.runStreak] 局间连战（本局开始时）
 * @param {ProgressState} params.state
 */
export function computeXpGain(params) {
    const { score, gameStats, strategy, runStreak = 0, state } = params;
    const ymd = _todayYmd();
    const yest = _yesterdayYmd(ymd);
    const mul = STRATEGY_XP_MUL[strategy] ?? 1;

    let firstOfDayBonus = 0;
    if (state.bonusDayYmd !== ymd) {
        firstOfDayBonus = 25;
    }

    /** 本局结算后即将生效的连续日数（用于当日首局奖励；同日后续局用已写入的 dailyStreak） */
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
            baseAndLines: Math.floor((base + lineBonus) * mul)
        },
        willSetBonusDay: state.bonusDayYmd !== ymd,
        ymd
    };
}

/**
 * 结算一局：写回 state、返回升级与解锁信息
 * @param {object} opts
 * @param {number} opts.score
 * @param {object} opts.gameStats
 * @param {string} opts.strategy
 * @param {number} [opts.runStreak]
 */
export function applyGameEndProgression(opts) {
    const state = loadProgress();
    const gain = computeXpGain({
        score: opts.score,
        gameStats: opts.gameStats,
        strategy: opts.strategy,
        runStreak: opts.runStreak ?? 0,
        state
    });

    const oldXp = state.totalXp;
    const oldLevel = getLevelFromTotalXp(oldXp);

    const ymd = gain.ymd;
    if (gain.willSetBonusDay) {
        state.bonusDayYmd = ymd;
    }

    if (state.streakYmd !== ymd) {
        const yest = _yesterdayYmd(ymd);
        if (state.streakYmd === yest) {
            state.dailyStreak = (state.dailyStreak || 0) + 1;
        } else {
            state.dailyStreak = 1;
        }
        state.streakYmd = ymd;
    }

    state.totalXp = oldXp + gain.total;
    const newLevel = getLevelFromTotalXp(state.totalXp);

    saveProgress(state);

    const newlyUnlockedSkins = [];

    const achievementIds = [];
    for (const row of LEVEL_ACHIEVEMENT_THRESHOLDS) {
        if (oldLevel < row.minLevel && newLevel >= row.minLevel) {
            achievementIds.push(row.id);
        }
    }

    return {
        state,
        xpGained: gain.total,
        breakdown: gain.breakdown,
        oldLevel,
        newLevel,
        leveledUp: newLevel > oldLevel,
        newlyUnlockedSkins,
        achievementIds
    };
}
