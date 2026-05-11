/**
 * 游戏常量、策略与成就配置。
 * API 基址：构建时由仓库根 `.env` 的 OPENBLOCK_API_ORIGIN（或 VITE_API_BASE_URL）经 Vite 注入为
 * import.meta.env.VITE_API_BASE_URL；运行时可用 localStorage `api_url` 覆盖（便于调试）。
 * 难度与得分等玩法参数默认来自 shared/game_rules.json（经 gameRules.js）。
 */
import { GAME_RULES, buildDefaultStrategiesMap } from './gameRules.js';
import { CLASSIC_PALETTE } from './skins.js';

const _defaultSid = GAME_RULES.defaultStrategyId || 'normal';
const _defaultGrid = GAME_RULES.strategies[_defaultSid]?.gridWidth ?? 8;

export const CONFIG = {
    GRID_SIZE: _defaultGrid,
    /** 棋盘 & 候选区共用的单格像素 */
    CELL_SIZE: 38,
    /** 落点吸附：悬停预览半径（切比雪夫，格）。保守值避免预览跳到太远的"全局好点" */
    PLACE_SNAP_RADIUS: 2,
    /**
     * 落点吸附：释放（mouseup/touchend）时半径。比 PLACE_SNAP_RADIUS 更宽容 1 格 —
     * 预览阶段保守是为了让玩家清楚"将落在哪"；释放阶段宽容是为了"既然你已经选择放手，就尽量帮你放成功"，
     * 避免离合法点 2.5 格被静默丢弃。
     */
    PLACE_RELEASE_SNAP_RADIUS: 3,
    /**
     * 鼠标拖拽最大增益（高速时）：幽灵块相对起点放大移动，减少从候选区拖到盘面的手腕距离。
     * 与 DRAG_MOUSE_GAIN_MIN 配合形成"低速 1:1、高速加速"的动态曲线（参考桌面操作系统的
     * pointer ballistics），慢速精准、快速省力。
     */
    DRAG_MOUSE_GAIN: 1.32,
    /** 鼠标拖拽最小增益（低速 / 静止时）：保留 1:1 跟随，避免精细落点对位时幽灵块抢跑 */
    DRAG_MOUSE_GAIN_MIN: 1.0,
    /** 鼠标速度下界（px/ms）：≤ 此速度按 DRAG_MOUSE_GAIN_MIN，对应"对位精细动作" */
    DRAG_MOUSE_SPEED_SLOW_PX_MS: 0.30,
    /** 鼠标速度上界（px/ms）：≥ 此速度按 DRAG_MOUSE_GAIN，对应"快速甩动到目标格" */
    DRAG_MOUSE_SPEED_FAST_PX_MS: 1.50,
    /** 触屏拖拽增益：轻微放大手指位移，减少从候选区拖到盘面的滑动距离 */
    DRAG_TOUCH_GAIN: 1.12,
    /** 拖拽增益额外偏移上限（格）：避免快速甩动时幽灵块过度领先鼠标 */
    DRAG_GAIN_MAX_OFFSET_CELLS: 3.0,
    /** 触屏防遮挡：幽灵块在手指上方额外留出的间隙（格） */
    DRAG_TOUCH_LIFT_GAP_CELLS: 0.35,
    /** 触屏防遮挡：上移距离上限（格），避免长条块离手指过远 */
    DRAG_TOUCH_LIFT_MAX_CELLS: 2.4,
    /** 悬停落点：附近消行点的每条消行奖励，帮助鼠标自动吸向“看起来想放”的消行位 */
    HOVER_CLEAR_LINE_BONUS: 0.9,
    /** 悬停落点：消除格数量的弱奖励，用于同为消行时偏向收益更大的局部候选 */
    HOVER_CLEAR_CELL_BONUS: 0.015,
    /** 悬停落点：只有距离最近点不超过该平方差时才启用消行辅助，避免跳去太远的“全局好点” */
    HOVER_CLEAR_ASSIST_WINDOW: 1.35,
    /** 悬停落点：上一帧预览位粘滞奖励，降低鼠标停在边界时的预览抖动 */
    HOVER_STICKY_BONUS: 0.32,
    /** 悬停落点：粘滞只在上一帧距离本帧最近点足够近时生效，避免拖走后还吸回旧点 */
    HOVER_STICKY_WINDOW: 0.75,
    /** 候选块预览槽位边长（格）：需覆盖 1×5 等长条 */
    DOCK_PREVIEW_MAX_CELLS: 5
};

/** @returns {string} 规范化后的 API 根 URL（无末尾斜杠；开发模式下可为空串表示走当前源的 /api 代理） */
export function getApiBaseUrl() {
    try {
        const legacy = localStorage.getItem('api_url');
        if (legacy && legacy.trim()) {
            return legacy.replace(/\/+$/, '');
        }
    } catch {
        /* private mode */
    }
    /**
     * Vite dev：`vite.config` 会把 API 指到 127.0.0.1:5000，若仍用绝对地址请求会绕过 dev-server 的 `/api` 代理；
     * 用手机 / 局域网 IP 打开前端时，浏览器会误连「设备本机」的 127.0.0.1，导致 SQLite API 全部失败。
     * 开发构建下改为同源相对路径，由代理转发到真实 Flask。
     */
    if (import.meta.env.DEV) {
        return '';
    }
    const fromEnv = import.meta.env.VITE_API_BASE_URL;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).replace(/\/+$/, '');
    }
    /* 浏览器不能稳定访问 0.0.0.0；与服务监听 0.0.0.0 时客户端应连 127.0.0.1 */
    return 'http://127.0.0.1:5000';
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

const DEFAULT_STRATEGIES = buildDefaultStrategiesMap();

/** 与 DEFAULT_STRATEGIES 相同，保留别名以兼容测试与外部引用 */
export const STRATEGIES = DEFAULT_STRATEGIES;

/**
 * 游戏事件常量
 *
 * 通过 MonetizationBus.on(GAME_EVENTS.XXX, handler) 订阅这些事件。
 * handler 签名：({ data: object, game: GameInstance }) => void
 *
 * 各事件的 data 字段：
 *   PLACE        — { shape, position, cleared, boardFill, combo }
 *   PLACE_FAILED — { shape, reason }
 *   CLEAR        — { count, lines, score, combo }
 *   NO_CLEAR     — { boardFill, nearMiss, placement }
 *   GAME_OVER    — { finalScore, totalClears, duration, strategy }
 *   SPAWN_BLOCKS — { shapes, adaptiveInsight, stress }
 *   SELECT_BLOCK — { blockIndex, shape }
 *   DRAG_START   — { blockIndex }
 *   DRAG_END     — { placed: boolean }
 */
export const GAME_EVENTS = {
    /** 成功放置方块 */
    PLACE: 'place',
    /** 放置失败（位置非法） */
    PLACE_FAILED: 'place_failed',
    /** 成功消除行/列 */
    CLEAR: 'clear',
    /** 放置后未触发消行 */
    NO_CLEAR: 'no_clear',
    /** 游戏结束（无合法位置） */
    GAME_OVER: 'game_over',
    /** 新一轮出块（3 块候选刷新） */
    SPAWN_BLOCKS: 'spawn_blocks',
    /** 玩家选中候选块 */
    SELECT_BLOCK: 'select_block',
    /** 开始拖拽方块 */
    DRAG_START: 'drag_start',
    /** 拖拽结束（放置成功或取消） */
    DRAG_END: 'drag_end',
};

export function getStrategy(id) {
    return DEFAULT_STRATEGIES[id] || DEFAULT_STRATEGIES.normal;
}

function _saveCustomStrategy(strategy) {
    const strategies = JSON.parse(localStorage.getItem('custom_strategies') || '{}');
    strategies[strategy.id] = strategy;
    localStorage.setItem('custom_strategies', JSON.stringify(strategies));
}

function getCustomStrategies() {
    return JSON.parse(localStorage.getItem('custom_strategies') || '{}');
}

function _getAllStrategies() {
    return { ...DEFAULT_STRATEGIES, ...getCustomStrategies() };
}
