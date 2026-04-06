/**
 * 游戏常量、策略与成就配置。
 * API 基址优先读取 Vite 环境变量，其次 localStorage（便于运行时覆盖）。
 * 难度与得分等玩法参数默认来自 shared/game_rules.json（经 gameRules.js）。
 */
import { GAME_RULES, buildDefaultStrategiesMap } from './gameRules.js';
import { CLASSIC_PALETTE } from './skins.js';

const _defaultSid = GAME_RULES.defaultStrategyId || 'normal';
const _defaultGrid = GAME_RULES.strategies[_defaultSid]?.gridWidth ?? 8;

export const CONFIG = {
    GRID_SIZE: _defaultGrid,
    CELL_SIZE: 38,
    /** 落点吸附：仅在以「指针粗对齐」为锚点的切比雪夫半径内选最近合法位，不做全盘策略 */
    PLACE_SNAP_RADIUS: 2,
    /** 待选区单坑预览边长（格），与 shapes 最大边长一致，避免换块时槽位高度变化带动整页视觉抖动 */
    DOCK_PREVIEW_MAX_CELLS: 4
};

/** @returns {string} 规范化后的 API 根 URL（无末尾斜杠） */
export function getApiBaseUrl() {
    const fromEnv = import.meta.env.VITE_API_BASE_URL;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).replace(/\/+$/, '');
    }
    try {
        const legacy = localStorage.getItem('api_url');
        if (legacy && legacy.trim()) {
            return legacy.replace(/\/+$/, '');
        }
    } catch {
        /* private mode */
    }
    return 'http://localhost:5000';
}

/** 为 `true` 时向 Flask 后端同步会话与行为（需可访问的 API） */
export function isBackendSyncEnabled() {
    return import.meta.env.VITE_SYNC_BACKEND === 'true';
}

/**
 * 为 `true`（默认）时本地持久化走 SQLite API（`server.py`），不再使用浏览器 IndexedDB。
 * 设为 `false` 时 `Database.init()` 会失败；仅用于明确禁用或静态托管无后端场景。
 */
export function isSqliteClientDatabase() {
    const v = import.meta.env.VITE_USE_SQLITE_DB;
    if (v === 'false' || v === '0') {
        return false;
    }
    return true;
}

/**
 * 为 `true` 时 RL 面板优先使用 `/api/rl/*`（rl_pytorch），否则用浏览器线性模型 + localStorage。
 * 也可运行时 localStorage `rl_use_pytorch` = '1'。
 */
export function isRlPytorchBackendPreferred() {
    if (import.meta.env.VITE_RL_PYTORCH === 'true') {
        return true;
    }
    try {
        return localStorage.getItem('rl_use_pytorch') === '1';
    } catch {
        return false;
    }
}

/** 经典调色板；运行时棋盘/消除粒子请用 `getBlockColors()`（见 skins.js） */
export const COLORS = CLASSIC_PALETTE;

export const ACHIEVEMENTS = {
    firstClear: { id: 'first_clear', name: 'First Clear', desc: 'Clear your first line', icon: '⭐' },
    score100: { id: 'score_100', name: 'Century', desc: 'Reach 100 points', icon: '💯' },
    score500: { id: 'score_500', name: 'High Scorer', desc: 'Reach 500 points', icon: '🔥' },
    score1000: { id: 'score_1000', name: 'Master', desc: 'Reach 1000 points', icon: '👑' },
    tripleClear: { id: 'triple_clear', name: 'Triple Threat', desc: 'Clear 3 lines at once', icon: '⚡' },
    fiveClear: { id: 'five_clear', name: 'Combo Master', desc: 'Clear 5 lines at once', icon: '💥' },
    tenGames: { id: 'ten_games', name: 'Dedicated', desc: 'Play 10 games', icon: '🎮' },
    perfectGame: { id: 'perfect_game', name: 'Perfect Game', desc: 'Score over 500 in one game', icon: '🏆' },
    combo: { id: 'combo', name: 'Combo King', desc: 'Clear 10+ lines in one game', icon: '🌟' },
    speedRunner: { id: 'speed_runner', name: 'Speed Runner', desc: 'Complete a game in under 2 minutes', icon: '⚡' },
    level5: { id: 'level_5', name: '初窥门径', desc: '玩家等级达到 5', icon: '📈' },
    level10: { id: 'level_10', name: '渐入佳境', desc: '玩家等级达到 10', icon: '⬆️' },
    level25: { id: 'level_25', name: '登堂入室', desc: '玩家等级达到 25', icon: '🎖️' }
};

/** 按成就业务 id（如 score_100）索引，供解锁逻辑使用 */
export const ACHIEVEMENTS_BY_ID = Object.fromEntries(
    Object.values(ACHIEVEMENTS).map((a) => [a.id, a])
);

export const DEFAULT_STRATEGIES = buildDefaultStrategiesMap();

/** 与 DEFAULT_STRATEGIES 相同，保留别名以兼容测试与外部引用 */
export const STRATEGIES = DEFAULT_STRATEGIES;

export const GAME_EVENTS = {
    PLACE: 'place',
    PLACE_FAILED: 'place_failed',
    CLEAR: 'clear',
    NO_CLEAR: 'no_clear',
    GAME_OVER: 'game_over',
    SPAWN_BLOCKS: 'spawn_blocks',
    SELECT_BLOCK: 'select_block',
    DRAG_START: 'drag_start',
    DRAG_END: 'drag_end'
};

export function getStrategy(id) {
    return DEFAULT_STRATEGIES[id] || DEFAULT_STRATEGIES.normal;
}

export function saveCustomStrategy(strategy) {
    const strategies = JSON.parse(localStorage.getItem('custom_strategies') || '{}');
    strategies[strategy.id] = strategy;
    localStorage.setItem('custom_strategies', JSON.stringify(strategies));
}

export function getCustomStrategies() {
    return JSON.parse(localStorage.getItem('custom_strategies') || '{}');
}

export function getAllStrategies() {
    return { ...DEFAULT_STRATEGIES, ...getCustomStrategies() };
}
