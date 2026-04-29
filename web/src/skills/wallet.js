/**
 * wallet.js — v10.16 玩家通货钱包（hint / undo / bomb / rainbow token + coin）
 *
 * 统一管理所有道具消耗品和虚拟货币的发放与扣除，避免每个模块自建一套。
 *
 * 设计要点
 * --------
 * - **localStorage 单一事实**：`openblock_skill_wallet_v1`
 * - **每日免费配额**：hint / undo 默认每日各 3 次免费（ymd 日切自动复活）
 * - **来源追踪**：addBalance / spendBalance 都接收 source / reason 字符串便于埋点
 * - **事件总线**：`onChange(kind, listener)` 让 skillBar UI 实时刷新计数
 *
 * 通货枚举
 * --------
 *   hintToken    建议落点（长按方块查看推荐）
 *   undoToken    撤销一步
 *   bombToken    炸弹（清除 3×3）
 *   rainbowToken 彩虹（染色触发 bonus）
 *   coin         通用金币（未来扩展）
 *   trialPass    限定皮肤试穿券（24h 期限）
 */

const STORAGE_KEY = 'openblock_skill_wallet_v1';

const KINDS = [
    'hintToken', 'undoToken', 'bombToken', 'rainbowToken',
    'freezeToken', 'previewToken', 'rerollToken',   /* v10.17 W3 道具池扩展 */
    'coin', 'trialPass', 'fragment',
];

const DAILY_FREE_QUOTA = {
    hintToken: 3,
    undoToken: 3,
    // bomb / rainbow / coin / trialPass / fragment 无每日免费
};

/**
 * v10.17 每日发放上限（防御-②）— 防止通胀
 * 多个发币入口同时发放（首日礼包/签到/任务/迷你目标/回归礼包/首胜加分）会让
 * 提示 / 撤销券存量过快堆积，稀释道具的稀缺感。
 *
 * 上限按"自然日 ymd 内通过 addBalance 累加值"计算，每天 00:00 重置。
 * IAP 与赛季宝箱 / 转盘大奖通过特殊 source（在 GRANT_BYPASS_SOURCES 中）绕过限制。
 */
const DAILY_GRANT_CAP = {
    hintToken: 8,
    undoToken: 6,
    bombToken: 3,
    rainbowToken: 2,
    freezeToken: 2,
    previewToken: 4,
    rerollToken: 3,
    coin: 500,
    fragment: 5,
    // trialPass 不限（24h 自动过期）
};
const GRANT_BYPASS_SOURCES = new Set([
    'iap',
    'season-chest-grand',
    'lucky-wheel-grand',
    'first-day-pack',     // 首日礼包绕过（一次性）
    'admin',
    'test',                // 单元测试绕过 cap（生产代码不会使用此 source）
]);

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _emptyState() {
    const balance = {};
    for (const k of KINDS) balance[k] = 0;
    return {
        balance,
        dailyConsumed: {},   // { ymd: { hintToken: n, undoToken: n } }
        dailyGranted: {},    // v10.17：{ ymd: { hintToken: n, ... } } 防通胀计数
        trials: [],          // [{ skinId, expiresAt }]
        lastSeenYmd: _ymd(),
    };
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return _emptyState();
        const s = JSON.parse(raw);
        // 修复字段缺失
        const empty = _emptyState();
        s.balance = { ...empty.balance, ...(s.balance || {}) };
        s.dailyConsumed = s.dailyConsumed || {};
        s.dailyGranted = s.dailyGranted || {};
        s.trials = Array.isArray(s.trials) ? s.trials : [];
        s.lastSeenYmd = s.lastSeenYmd || _ymd();
        return s;
    } catch { return _emptyState(); }
}

function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* ignore */ }
}

class Wallet {
    constructor() {
        this.state = _load();
        this._listeners = {};
        this._purgeExpiredTrials();
    }

    /* ============ 余额读写 ============ */

    /** 当前可用余额：库存 + 当日剩余免费配额 */
    getBalance(kind) {
        if (!KINDS.includes(kind)) return 0;
        const stock = this.state.balance[kind] | 0;
        const freeLeft = this.getDailyFreeRemaining(kind);
        return stock + freeLeft;
    }

    /** 仅库存（不含每日免费） */
    getStock(kind) { return this.state.balance[kind] | 0; }

    /** 当日剩余免费配额 */
    getDailyFreeRemaining(kind) {
        const quota = DAILY_FREE_QUOTA[kind] || 0;
        if (quota <= 0) return 0;
        const today = _ymd();
        const consumed = (this.state.dailyConsumed[today] || {})[kind] | 0;
        return Math.max(0, quota - consumed);
    }

    /** 充值（充消耗品 / 看广告 / IAP / 任务奖励）
     *
     *  v10.17 防通胀：除特殊 source 外，单 kind 单日上限 = DAILY_GRANT_CAP[kind]
     *  超出部分会被截断（返回 actually 加成数量）。
     */
    addBalance(kind, amount, source = 'unknown') {
        if (!KINDS.includes(kind) || !amount) return false;
        let toAdd = amount | 0;
        if (toAdd > 0 && !GRANT_BYPASS_SOURCES.has(source)) {
            const cap = DAILY_GRANT_CAP[kind];
            if (cap !== undefined) {
                const today = _ymd();
                this.state.dailyGranted[today] = this.state.dailyGranted[today] || {};
                const granted = (this.state.dailyGranted[today][kind] | 0);
                const room = Math.max(0, cap - granted);
                if (toAdd > room) toAdd = room;
                this.state.dailyGranted[today][kind] = granted + toAdd;
            }
        }
        if (toAdd <= 0 && (amount | 0) > 0) {
            // 完全被截断 — 仍然 emit，让 UI 提示"已达每日上限"
            this._emit(kind, { kind, amount: 0, source, action: 'add', cappedFrom: amount });
            return false;
        }
        this.state.balance[kind] = Math.max(0, (this.state.balance[kind] | 0) + toAdd);
        // 清理 7 天前的 dailyGranted
        this._gcDailyGranted();
        _save(this.state);
        this._emit(kind, { kind, amount: toAdd, source, action: 'add', cappedFrom: amount > toAdd ? amount : undefined });
        return true;
    }

    /**
     * 消耗（优先消耗每日免费配额，再消耗库存）
     * @returns {boolean} 是否消耗成功
     */
    spend(kind, amount = 1, reason = 'unknown') {
        if (!KINDS.includes(kind) || amount <= 0) return false;
        if (this.getBalance(kind) < amount) return false;

        let remaining = amount;
        const freeLeft = this.getDailyFreeRemaining(kind);
        if (freeLeft > 0) {
            const useFree = Math.min(freeLeft, remaining);
            const today = _ymd();
            this.state.dailyConsumed[today] = this.state.dailyConsumed[today] || {};
            this.state.dailyConsumed[today][kind] = (this.state.dailyConsumed[today][kind] | 0) + useFree;
            remaining -= useFree;
        }
        if (remaining > 0) {
            this.state.balance[kind] = (this.state.balance[kind] | 0) - remaining;
        }
        // 清理 7 天前的 dailyConsumed 记录
        this._gcDailyConsumed();
        _save(this.state);
        this._emit(kind, { kind, amount, reason, action: 'spend' });
        return true;
    }

    /* ============ 试穿券 ============ */

    addTrial(skinId, hours = 24) {
        const expiresAt = Date.now() + hours * 3600_000;
        this.state.trials.push({ skinId, expiresAt });
        _save(this.state);
        this._emit('trialPass', { skinId, expiresAt, action: 'add' });
        return expiresAt;
    }

    isOnTrial(skinId) {
        this._purgeExpiredTrials();
        return this.state.trials.some(t => t.skinId === skinId);
    }

    getActiveTrials() {
        this._purgeExpiredTrials();
        return this.state.trials.slice();
    }

    _purgeExpiredTrials() {
        const now = Date.now();
        const before = this.state.trials.length;
        this.state.trials = this.state.trials.filter(t => t.expiresAt > now);
        if (this.state.trials.length !== before) _save(this.state);
    }

    /* ============ 事件总线 ============ */

    onChange(kind, fn) {
        if (!this._listeners[kind]) this._listeners[kind] = [];
        this._listeners[kind].push(fn);
        return () => {
            this._listeners[kind] = (this._listeners[kind] || []).filter(f => f !== fn);
        };
    }

    _emit(kind, data) {
        for (const fn of (this._listeners[kind] || [])) {
            try { fn(data); } catch { /* ignore */ }
        }
        for (const fn of (this._listeners['*'] || [])) {
            try { fn(data); } catch { /* ignore */ }
        }
    }

    /* ============ 内部 ============ */

    _gcDailyConsumed() {
        const days = Object.keys(this.state.dailyConsumed).sort();
        if (days.length <= 7) return;
        for (const d of days.slice(0, days.length - 7)) {
            delete this.state.dailyConsumed[d];
        }
    }

    _gcDailyGranted() {
        const days = Object.keys(this.state.dailyGranted).sort();
        if (days.length <= 7) return;
        for (const d of days.slice(0, days.length - 7)) {
            delete this.state.dailyGranted[d];
        }
    }

    /** v10.17：查询今日某 kind 已发放数量（测试 / 防通胀提示用） */
    getTodayGranted(kind) {
        const today = _ymd();
        return (this.state.dailyGranted[today] || {})[kind] | 0;
    }
    getDailyGrantCap(kind) {
        return DAILY_GRANT_CAP[kind] ?? Infinity;
    }

    /** 调试 / 测试用 */
    _reset() { this.state = _emptyState(); _save(this.state); }
}

let _instance = null;
export function getWallet() {
    if (!_instance) {
        _instance = new Wallet();
        if (typeof window !== 'undefined') window.__wallet = _instance;
    }
    return _instance;
}

export const __test_only__ = { KINDS, DAILY_FREE_QUOTA, DAILY_GRANT_CAP, GRANT_BYPASS_SOURCES };
