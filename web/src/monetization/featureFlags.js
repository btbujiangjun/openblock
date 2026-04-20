/**
 * 商业化功能特性开关（Feature Flags）
 *
 * 优先级：localStorage > import.meta.env > DEFAULT
 * 支持运行时热切换：setFlag(key, value) 立即生效，刷新后持久。
 *
 * 设计原则：
 *   - 每个功能独立开关，互不依赖
 *   - 默认全部关闭（opt-in），防止意外上线
 *   - 纯数据层，不依赖 DOM / 游戏逻辑
 */

const STORAGE_KEY = 'openblock_mon_flags_v1';

/** 各功能默认值（全部 false = 默认关闭，需显式开启） */
export const FLAG_DEFAULTS = {
    /** OPT-01：激励视频广告 */
    adsRewarded: false,
    /** OPT-01：插屏广告（游戏结束后） */
    adsInterstitial: false,
    /** OPT-02：IAP 内购 */
    iap: false,
    /** OPT-03：每日任务 */
    dailyTasks: true,
    /** OPT-04：在线排行榜 */
    leaderboard: true,
    /** OPT-05：皮肤等级解锁 */
    skinUnlock: true,
    /** OPT-06：赛季通行证 */
    seasonPass: true,
    /** OPT-07：Web Push 通知 */
    pushNotifications: false,
    /** OPT-08：回放分享 */
    replayShare: true,
    /** 调试模式：广告/IAP 使用存根实现 */
    stubMode: true,
};

/** 从 localStorage 加载已持久化的 flag 覆盖 */
function _loadPersisted() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
}

/** 内存缓存（进程级，保证 getFlag 同步快速） */
let _cache = null;

function _build() {
    const persisted = _loadPersisted();
    return { ...FLAG_DEFAULTS, ...persisted };
}

/**
 * 读取一个 flag 值
 * @param {keyof typeof FLAG_DEFAULTS} key
 * @returns {boolean}
 */
export function getFlag(key) {
    if (!_cache) _cache = _build();
    return Boolean(_cache[key]);
}

/**
 * 热设置 flag（立即生效 + localStorage 持久化）
 * @param {keyof typeof FLAG_DEFAULTS} key
 * @param {boolean} value
 */
export function setFlag(key, value) {
    if (!_cache) _cache = _build();
    _cache[key] = Boolean(value);
    try {
        const persisted = _loadPersisted();
        persisted[key] = Boolean(value);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch { /* ignore */ }
}

/**
 * 重置所有 flag 为默认值
 */
export function resetFlags() {
    _cache = { ...FLAG_DEFAULTS };
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

/**
 * 返回当前完整 flag 快照（用于调试面板）
 * @returns {Record<string, boolean>}
 */
export function getAllFlags() {
    if (!_cache) _cache = _build();
    return { ..._cache };
}
