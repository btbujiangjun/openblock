/**
 * wallet.js — v10.16 玩家通货钱包（hint / undo / bomb / rainbow token + coin）
 *
 * 统一管理所有道具消耗品和虚拟货币的发放与扣除，避免每个模块自建一套。
 *
 * 设计要点
 * --------
 * - **SQLite 优先**（`VITE_USE_SQLITE_DB` 且 API 可用）：服务端 `skill_wallets` 表 + `GET/PUT /api/wallet`
 * - **localStorage 回退**：未启用后端或请求失败时沿用 `openblock_skill_wallet_v1`
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

import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

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
    /** 局末宝箱（endGameChest.js：`chest-${tier}`）— 里程碑式发放，不应被每日 cap 截断 */
    'chest-common',
    'chest-rare',
    'chest-epic',
    /** 赛季进阶宝箱（seasonChest.js：`season-chest-${tier.id}`）；原误写 season-chest-grand 与 id 不一致 */
    'season-chest-common',
    'season-chest-rare',
    'season-chest-epic',
    'season-chest-legend',
    'season-chest-grand', // 兼容历史/文档中的别名
    'lucky-wheel-grand',
    'first-day-pack',     // 首日礼包绕过（一次性）
    'admin',
    'test',                // 单元测试绕过 cap（生产代码不会使用此 source）
]);

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* v1.13：钱包流水明细环形缓冲上限。
 * 玩家在「个人数据」面板要看到「最近从哪些来源拿到了哪些奖励」，但流水不能无限增长
 * （单条 ~80 字节，Σ 写入 PUT /api/wallet 的 payload）。这里取 200 条覆盖几天的活动，
 * 超过上限按 FIFO 丢弃最旧记录，不会破坏 UI 显示也不会让 payload 飞涨。 */
const LEDGER_MAX = 200;

function _emptyState() {
    const balance = {};
    for (const k of KINDS) balance[k] = 0;
    return {
        balance,
        dailyConsumed: {},   // { ymd: { hintToken: n, undoToken: n } }
        dailyGranted: {},    // v10.17：{ ymd: { hintToken: n, ... } } 防通胀计数
        trials: [],          // [{ skinId, expiresAt }]
        lastSeenYmd: _ymd(),
        /* v1.13：钱包入账/消费流水明细，最新在末尾。
         * 每项形如：{ ts, kind, amount, source, action: 'add'|'spend'|'trial'|'cap', cappedFrom? } */
        ledger: [],
    };
}

function _normalizeParsedState(s) {
    const empty = _emptyState();
    if (!s || typeof s !== 'object') return empty;
    s.balance = { ...empty.balance, ...(s.balance || {}) };
    s.dailyConsumed = s.dailyConsumed || {};
    s.dailyGranted = s.dailyGranted || {};
    s.trials = Array.isArray(s.trials) ? s.trials : [];
    s.lastSeenYmd = s.lastSeenYmd || _ymd();
    // v1.13：旧 schema（无 ledger）水合时补空数组，确保 UI 与持久化兼容。
    s.ledger = Array.isArray(s.ledger) ? s.ledger.slice(-LEDGER_MAX) : [];
    return s;
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return _emptyState();
        return _normalizeParsedState(JSON.parse(raw));
    } catch { return _emptyState(); }
}

async function _walletApiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { _raw: text };
        }
    }
    if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function _save(state) {
    const inst = _instance;
    try {
        if (!inst || !isSqliteClientDatabase() || !inst._remotePersistEnabled) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            return;
        }
        inst._queueRemoteSave();
    } catch { /* ignore */ }
}

class Wallet {
    constructor() {
        this.state = _load();
        this._listeners = {};
        /** @type {boolean} */
        this._remotePersistEnabled = false;
        /** @type {string} */
        this._remoteUserId = '';
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._remoteTimer = null;
        this._purgeExpiredTrials();
    }

    _queueRemoteSave() {
        if (!this._remotePersistEnabled || !this._remoteUserId) return;
        if (this._remoteTimer) clearTimeout(this._remoteTimer);
        this._remoteTimer = setTimeout(() => void this._flushRemoteSave(), 400);
    }

    async _flushRemoteSave() {
        this._remoteTimer = null;
        if (!this._remotePersistEnabled || !this._remoteUserId) return;
        try {
            await _walletApiJson('/api/wallet', {
                method: 'PUT',
                body: JSON.stringify({ user_id: this._remoteUserId, wallet: this.state }),
            });
        } catch (e) {
            console.warn('[wallet] 同步 SQLite 失败，回退写入 localStorage:', e);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
            } catch { /* ignore */ }
        }
    }

    /**
     * 用服务端快照替换内存状态（hydrate 后调用）
     */
    _replaceWithHydratedState(next) {
        this.state = _normalizeParsedState(next);
        this._purgeExpiredTrials();
        for (const k of KINDS) {
            this._emit(k, { kind: k, action: 'hydrate' });
        }
        this._emit('trialPass', { kind: 'trialPass', action: 'hydrate' });
        this._emit('*', { action: 'hydrate' });
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
            // 完全被截断 — 仍然 emit + 入流水（标记 action: 'cap'），让 UI 提示"已达每日上限"
            this._appendLedger({ kind, amount: 0, source, action: 'cap', cappedFrom: amount });
            _save(this.state);
            this._emit(kind, { kind, amount: 0, source, action: 'add', cappedFrom: amount });
            return false;
        }
        this.state.balance[kind] = Math.max(0, (this.state.balance[kind] | 0) + toAdd);
        // 清理 7 天前的 dailyGranted
        this._gcDailyGranted();
        // v1.13：写入流水明细，便于个人面板展示「最近入账」（含 cappedFrom 体现部分截断）
        this._appendLedger({
            kind,
            amount: toAdd,
            source,
            action: 'add',
            ...(amount > toAdd ? { cappedFrom: amount } : {})
        });
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
        // v1.13：消费也入流水（amount 取负值，便于面板按符号上色 / 时间序展示）
        this._appendLedger({ kind, amount: -amount, source: reason, action: 'spend' });
        _save(this.state);
        this._emit(kind, { kind, amount, reason, action: 'spend' });
        return true;
    }

    /* ============ 试穿券 ============ */

    addTrial(skinId, hours = 24) {
        const expiresAt = Date.now() + hours * 3600_000;
        this.state.trials.push({ skinId, expiresAt });
        // v1.13：试穿券也入流水（kind=trialPass，amount=1，source 含 skinId 便于回溯）
        this._appendLedger({
            kind: 'trialPass', amount: 1, source: `trial-${skinId}`, action: 'trial', expiresAt
        });
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

    /* ============ v1.13：流水明细 ============ */

    /**
     * 写入一条流水到环形缓冲；自动加 ts，超过 LEDGER_MAX 按 FIFO 丢弃最旧。
     * 调用方：addBalance / spend / addTrial 内部，外部不应直接调用。
     */
    _appendLedger(entry) {
        if (!Array.isArray(this.state.ledger)) this.state.ledger = [];
        const row = { ts: Date.now(), ...entry };
        this.state.ledger.push(row);
        if (this.state.ledger.length > LEDGER_MAX) {
            this.state.ledger.splice(0, this.state.ledger.length - LEDGER_MAX);
        }
    }

    /**
     * 读取最近 N 条流水（最新在末尾）。可按 kind / action 过滤。
     * @param {{ limit?: number, kind?: string, action?: string }} [opts]
     * @returns {Array<{ts:number, kind:string, amount:number, source:string, action:string, cappedFrom?:number, expiresAt?:number}>}
     */
    getLedger(opts = {}) {
        const arr = Array.isArray(this.state.ledger) ? this.state.ledger : [];
        const limit = Math.max(1, Math.min(LEDGER_MAX, Number(opts.limit) || 20));
        let out = arr;
        if (opts.kind) out = out.filter((r) => r.kind === opts.kind);
        if (opts.action) out = out.filter((r) => r.action === opts.action);
        return out.slice(-limit);
    }

    /** 调试 / 测试用 */
    _reset() {
        if (this._remoteTimer) clearTimeout(this._remoteTimer);
        this._remoteTimer = null;
        this._remotePersistEnabled = false;
        this._remoteUserId = '';
        this.state = _emptyState();
        _save(this.state);
    }
}

let _instance = null;
export function getWallet() {
    if (!_instance) {
        _instance = new Wallet();
        if (typeof window !== 'undefined') window.__wallet = _instance;
    }
    return _instance;
}

/**
 * 在 `Database.init()` 成功后调用：从服务端拉取钱包或把本地迁移上传。
 * @param {string} userId `bb_user_id`
 */
export async function hydrateWalletFromApi(userId) {
    if (!userId || !isSqliteClientDatabase()) return;
    const w = getWallet();
    w._remoteUserId = userId;
    try {
        const data = await _walletApiJson(`/api/wallet?user_id=${encodeURIComponent(userId)}`);
        const remote = data?.wallet;
        if (remote && typeof remote === 'object' && remote.balance && typeof remote.balance === 'object') {
            w._replaceWithHydratedState(remote);
            w._remotePersistEnabled = true;
            return;
        }
        await _walletApiJson('/api/wallet', {
            method: 'PUT',
            body: JSON.stringify({ user_id: userId, wallet: w.state }),
        });
        w._remotePersistEnabled = true;
    } catch (e) {
        console.warn('[wallet] SQLite 钱包不可用，使用 localStorage:', e);
        w._remotePersistEnabled = false;
    }
}

export const __test_only__ = { KINDS, DAILY_FREE_QUOTA, DAILY_GRANT_CAP, GRANT_BYPASS_SOURCES };
