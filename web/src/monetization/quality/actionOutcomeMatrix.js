/**
 * actionOutcomeMatrix.js — 推荐动作 × 实际行为矩阵
 *
 * v1.49.x 算法层 P0-3：
 *   解决"模型推荐了什么"和"玩家实际做了什么"之间的对应关系当前未被记录的问题，
 *   用于：
 *
 *     1. 监控 policy gain：推荐 IAP 的玩家点 IAP 的概率 vs 推荐 ads 的玩家点 IAP 的概率
 *     2. 估 propensity model 的 lift：top-k 推荐的真实正样率
 *     3. 后续 explorer / bandit 的 ground truth 数据源
 *
 * 工作原理：
 *   - `recordRecommendation(action, snapshotDigest, propensities)` 记录推荐
 *   - 监听 MonetizationBus 上的 `purchase_completed` / `ad_show` / `ad_complete` 等
 *     事件，根据 digest 关联回推荐
 *   - `getMatrix()` 输出 N×M 矩阵：行=推荐 action，列=实际 outcome（buy / watch_ad / skip / churn）
 *
 * 数据生命周期：
 *   - 推荐记录：保留 30 分钟（玩家在该窗口内做出的行为算"被影响"）
 *   - 矩阵汇总：localStorage 累积，每 24h 切换日期 key 防爆
 *
 * 注：本模块只做"配对 + 计数"，不参与决策；纯观测层。
 */

import { on } from '../MonetizationBus.js';

const RECOMMENDATION_TTL_MS = 30 * 60 * 1000;
const MATRIX_STORAGE_KEY = 'openblock_action_outcome_matrix_v1';

/** @typedef {{ action: string, snapshotDigest?: string, ts: number, propensities?: object, outcome?: string }} Recommendation */

/** @type {Recommendation[]} 进行中的推荐（30min 内可被 outcome 关联） */
let _pending = [];

/** @type {{ day: string, cells: Record<string, Record<string, number>> }} 累积矩阵 */
let _matrix = _loadMatrix();

let _attached = false;
let _unsubscribers = [];

/* ─────────────────── 持久化 ─────────────────── */

function _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _loadMatrix() {
    try {
        const raw = localStorage.getItem(MATRIX_STORAGE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj?.day === _todayKey()) return obj;
        }
    } catch { /* ignore */ }
    return { day: _todayKey(), cells: {} };
}

function _saveMatrix() {
    try {
        localStorage.setItem(MATRIX_STORAGE_KEY, JSON.stringify(_matrix));
    } catch { /* ignore */ }
}

function _ensureToday() {
    const today = _todayKey();
    if (_matrix.day !== today) {
        _matrix = { day: today, cells: {} };
        _saveMatrix();
    }
}

function _bump(action, outcome) {
    _ensureToday();
    if (!_matrix.cells[action]) _matrix.cells[action] = {};
    _matrix.cells[action][outcome] = (_matrix.cells[action][outcome] || 0) + 1;
    _saveMatrix();
}

/* ─────────────────── 公共 API ─────────────────── */

/**
 * 记录一次推荐。typically 由 commercialModel.recommendedAction 输出后调用。
 *
 * @param {string} action  推荐动作（'iap' / 'rewarded_ad' / 'interstitial' / 'task_or_push' / 'observe' / ...）
 * @param {Object} [meta] { snapshotDigest, propensities }
 */
export function recordRecommendation(action, meta = {}) {
    if (!action) return;
    /* 修剪过期 */
    const now = Date.now();
    _pending = _pending.filter((r) => now - r.ts < RECOMMENDATION_TTL_MS);
    _pending.push({
        action: String(action),
        snapshotDigest: meta.snapshotDigest || null,
        ts: now,
        propensities: meta.propensities || null,
    });
    _bump(action, 'recommended');
}

/**
 * 标记一个 outcome 发生（例如 `purchase_completed`）。
 * 若过去 30min 内有未关联的推荐，把最近一条作为 attribution。
 *
 * @param {string} outcome  'buy' / 'watch_rewarded' / 'skip' / 'leave_session' 等
 * @param {Object} [meta] { snapshotDigest }（若提供，按 digest 精确匹配）
 */
export function recordOutcome(outcome, meta = {}) {
    if (!outcome) return;
    const now = Date.now();
    _pending = _pending.filter((r) => now - r.ts < RECOMMENDATION_TTL_MS);

    let matched = null;
    if (meta.snapshotDigest) {
        const idx = _pending.findIndex((r) => r.snapshotDigest === meta.snapshotDigest);
        if (idx >= 0) {
            matched = _pending[idx];
            _pending.splice(idx, 1);
        }
    }
    if (!matched && _pending.length > 0) {
        matched = _pending.pop();
    }

    /* 落到矩阵：(推荐 action) × (实际 outcome) +1，未匹配到推荐时 action='unrecommended' */
    _bump(matched ? matched.action : 'unrecommended', outcome);
}

/** 当前矩阵（看板用）。 */
export function getMatrix() {
    _ensureToday();
    return JSON.parse(JSON.stringify(_matrix));
}

/**
 * 计算 policy gain：在所有推荐过的 action 中，每个 action 触发对应 outcome 的概率。
 * gain[action][outcome] = count(action, outcome) / count(action, recommended)
 */
export function getPolicyGain() {
    _ensureToday();
    const out = {};
    for (const action of Object.keys(_matrix.cells)) {
        const total = _matrix.cells[action]?.recommended || 0;
        if (total === 0) continue;
        out[action] = {};
        for (const outcome of Object.keys(_matrix.cells[action])) {
            if (outcome === 'recommended') continue;
            out[action][outcome] = _matrix.cells[action][outcome] / total;
        }
    }
    return out;
}

/* ─────────────────── 总线接线 ─────────────────── */

function _onPurchaseCompleted({ data }) {
    recordOutcome('buy', { snapshotDigest: data?.snapshotDigest });
}

function _onAdComplete({ data }) {
    if (data?.type === 'rewarded' && data?.rewarded) {
        recordOutcome('watch_rewarded', { snapshotDigest: data?.snapshotDigest });
    } else if (data?.type === 'interstitial') {
        recordOutcome('saw_interstitial', { snapshotDigest: data?.snapshotDigest });
    }
}

function _onLifecycleSessionEnd({ data }) {
    if (data?.churnLevel === 'high' || data?.churnLevel === 'critical') {
        recordOutcome('churn_signal', {});
    }
}

/** 挂载到 MonetizationBus（建议在 monetization/index.js 启动时调用）。 */
export function attachActionOutcomeMatrix() {
    if (_attached) return detachActionOutcomeMatrix;
    _attached = true;
    _unsubscribers = [
        on('purchase_completed', _onPurchaseCompleted),
        on('ad_complete', _onAdComplete),
        on('lifecycle:session_end', _onLifecycleSessionEnd),
    ];
    return detachActionOutcomeMatrix;
}

export function detachActionOutcomeMatrix() {
    _unsubscribers.forEach((u) => { try { u?.(); } catch { /* ignore */ } });
    _unsubscribers = [];
    _attached = false;
}

export function isActionOutcomeMatrixAttached() {
    return _attached;
}

/** 仅供测试 reset。 */
export function _resetActionOutcomeForTests() {
    _pending = [];
    _matrix = { day: _todayKey(), cells: {} };
    detachActionOutcomeMatrix();
    try { localStorage.removeItem(MATRIX_STORAGE_KEY); } catch { /* ignore */ }
}

export const _AOM_INTERNALS = { RECOMMENDATION_TTL_MS };
