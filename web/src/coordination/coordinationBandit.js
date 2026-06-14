/**
 * coordinationBandit.js — 受治理的上下文老虎机（跨飞轮在线决策）
 *
 * 角色：当 policyArbiter 用「损失厌恶标量化」算出**约束安全候选集**后，由本 bandit 在
 * 安全集内做探索/利用（Thompson sampling，Beta 共轭）。上下文 = unifiedSignals 离散化的
 * context key，保证「探索」也只在统一信号下进行，不会与确定性策略口径分叉。
 *
 * 前沿对应：off-policy / contextual bandit 做 ad-load·offer 个性化（见调研）。奖励统一用
 * **LTV 折算的 [0,1] reward**（变现+留存的混合），与 flywheelObjective 同货币。
 *
 * 治理：经 mlGovernance('coordination_bandit')，默认 sealed → select() 直接回退到
 * 候选集首项（=arbiter 的确定性最优），**默认不改变线上行为**；放量改 governance 即可。
 *
 * 持久化：内存 + 可选 localStorage（端上轻量；离线训练/聚合在服务端）。纯逻辑可单测。
 */

import { isMlFeatureEnabled } from '../monetization/ml/mlGovernance.js';

const FEATURE = 'coordination_bandit';
const STORE_KEY = 'openblock_coord_bandit_v1';

function _now() { return Date.now(); }

/** 把连续 unifiedSignals 离散成低基数 context key（控制 bandit 维度）。 */
export function contextKey(signals = {}) {
    const churn = signals.churnRisk >= 0.6 ? 'cH' : signals.churnRisk >= 0.3 ? 'cM' : 'cL';
    const flow = signals.flow >= 0.66 ? 'fH' : signals.flow >= 0.33 ? 'fM' : 'fL';
    const payer = signals.payerScore >= 0.6 ? 'pH' : 'pL';
    const stage = String(signals.lifecycleStage || 'S0');
    return `${stage}|${churn}|${flow}|${payer}`;
}

/* β 采样（Marsaglia-Tsang gamma → Beta）。无需高精度，给确定性 rng 以便单测。 */
function _gamma(k, rng) {
    if (k < 1) return _gamma(1 + k, rng) * Math.pow(rng(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x, v;
        do { x = _gaussian(rng); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = rng();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}
function _gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function _betaSample(a, b, rng) {
    const x = _gamma(a, rng);
    const y = _gamma(b, rng);
    return x / (x + y);
}

export class CoordinationBandit {
    constructor({ persist = true, rng = Math.random } = {}) {
        this._persist = persist;
        this._rng = rng;
        this._arms = this._load();          // { `${ctx}::${arm}`: {a,b,n} }
    }

    _load() {
        if (!this._persist) return {};
        try {
            const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _save() {
        if (!this._persist) return;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(this._arms));
        } catch { /* ignore */ }
    }

    _stat(ctx, arm) {
        const k = `${ctx}::${arm}`;
        if (!this._arms[k]) this._arms[k] = { a: 1, b: 1, n: 0 };  // Beta(1,1) uniform 先验
        return this._arms[k];
    }

    /**
     * 在「约束安全候选集」内选一个动作。
     * 治理 sealed/未启用 → 直接返回候选首项（arbiter 确定性最优），不探索。
     *
     * @param {string} ctx       contextKey(signals)
     * @param {string[]} candidates  已过硬约束的候选（首项=确定性最优）
     * @param {string} [userId]
     * @returns {{arm:string, explored:boolean}}
     */
    select(ctx, candidates, userId = '') {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return { arm: null, explored: false };
        }
        if (candidates.length === 1 || !isMlFeatureEnabled(FEATURE, userId)) {
            return { arm: candidates[0], explored: false };
        }
        let best = candidates[0];
        let bestSample = -Infinity;
        for (const arm of candidates) {
            const s = this._stat(ctx, arm);
            const sample = _betaSample(s.a, s.b, this._rng);
            if (sample > bestSample) { bestSample = sample; best = arm; }
        }
        return { arm: best, explored: best !== candidates[0] };
    }

    /**
     * 回填奖励（LTV 折算的 [0,1]）。reward 越高 → 该 (ctx,arm) 越被偏好。
     */
    update(ctx, arm, reward01) {
        if (!arm) return;
        const r = Math.max(0, Math.min(1, Number(reward01) || 0));
        const s = this._stat(ctx, arm);
        s.a += r;
        s.b += 1 - r;
        s.n += 1;
        s.lastTs = _now();
        this._save();
    }

    snapshot() { return JSON.parse(JSON.stringify(this._arms)); }
    reset() { this._arms = {}; this._save(); }
}

let _singleton = null;
export function getCoordinationBandit(opts) {
    if (!_singleton) _singleton = new CoordinationBandit(opts);
    return _singleton;
}
export function __resetCoordinationBanditSingleton() { _singleton = null; }
