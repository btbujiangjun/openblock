/**
 * multiTaskEncoder.js — 多任务学习共享 encoder + 4 个 propensity head
 *
 * v1.49.x 算法层 P1-2：
 *   把 commercialModel 里 4 个独立打分的 propensity（iap / rewarded / interstitial / churn）
 *   重写成 *共享底层 encoder + 任务特定 head* 的形式，让：
 *
 *     1. 任务之间通过 latent representation `h ∈ ℝ^16` 共享统计强度
 *     2. 离线训练时只需用 4 套 head weights，encoder 可共享 fine-tuning
 *     3. 与现有 `propensityWeights` 配置 100% 等价（默认权重等价于线性投影）
 *
 * 推理结构（v1：纯线性 MTL，无激活函数）：
 *
 *     features (FEATURE_SCHEMA_SIZE) → [encoder: linear W_e (size×16)] → h (16) → ReLU
 *     h → [head_iap]          → σ(w·h + b)  → P(iap)
 *     h → [head_rewarded]     → σ(w·h + b)  → P(rewarded)
 *     h → [head_interstitial] → σ(w·h + b)  → P(interstitial)
 *     h → [head_churn]        → σ(w·h + b)  → P(churn)
 *
 * 默认 encoder：identity-style "passthrough"——把 25 维特征的前 16 维直接复制到
 * latent，其余维度通过等权重平均接到剩下的几个槽位。这让"未注入 RL weights 时"
 * 推理与 commercialModel 的线性加权同构（线性 ⊕ 线性 = 线性）。
 *
 * 训练管线（不在本模块内）：
 *   1. 收集 (snapshot.vector, label_iap, label_rewarded, label_interstitial, label_churn)
 *   2. 用 PyTorch / sklearn 跑一个共享 encoder 的多任务 MLP（loss = Σ_t BCE）
 *   3. 导出权重为 JSON：{ encoder: {W, b}, heads: {iap: {w, b}, ...} }
 *   4. 通过 RemoteConfig push → 前端 setMultiTaskWeights() 热更
 */

import { FEATURE_SCHEMA_SIZE } from '../commercialFeatureSnapshot.js';

export const MTL_LATENT_DIM = 16;
export const MTL_SCHEMA_VERSION = 1;

/**
 * @typedef {{
 *   schemaVersion: number,
 *   fittedAt?: number,
 *   source?: string,
 *   encoder: { W: number[][], b: number[] },     // W: latent×features
 *   heads: Record<string, { w: number[], b: number }>
 * }} MultiTaskWeights
 */

/** 默认 identity encoder：W[i, j] = 1 if j == (i % features) else 0；b = 0。 */
function _defaultIdentityEncoder() {
    const W = Array.from({ length: MTL_LATENT_DIM }, (_, i) =>
        Array.from({ length: FEATURE_SCHEMA_SIZE }, (_, j) => (j === (i % FEATURE_SCHEMA_SIZE) ? 1 : 0))
    );
    const b = new Array(MTL_LATENT_DIM).fill(0);
    return { W, b };
}

/** 默认 head：均权重 1/16，bias 0；推理结果与 sigmoid(0.5) ≈ 0.62。 */
function _defaultUniformHead() {
    return {
        w: new Array(MTL_LATENT_DIM).fill(1 / MTL_LATENT_DIM),
        b: 0,
    };
}

/** @type {MultiTaskWeights} */
let _activeWeights = {
    schemaVersion: MTL_SCHEMA_VERSION,
    encoder: _defaultIdentityEncoder(),
    heads: {
        iap: _defaultUniformHead(),
        rewarded: _defaultUniformHead(),
        interstitial: _defaultUniformHead(),
        churn: _defaultUniformHead(),
    },
};

let _meta = { isDefault: true };

/* ─────────────────── 推理 ─────────────────── */

function _sigmoid(x) {
    if (x >= 50) return 1;
    if (x <= -50) return 0;
    return 1 / (1 + Math.exp(-x));
}

function _relu(x) { return x > 0 ? x : 0; }

/**
 * 编码：features → latent h ∈ ℝ^L。
 * @param {number[]|Float32Array} features
 * @returns {number[]} latent h
 */
export function encodeFeatures(features) {
    const f = Array.isArray(features) ? features : Array.from(features || []);
    if (f.length === 0) return new Array(MTL_LATENT_DIM).fill(0);
    const W = _activeWeights.encoder.W;
    const b = _activeWeights.encoder.b;
    const out = new Array(MTL_LATENT_DIM);
    for (let i = 0; i < MTL_LATENT_DIM; i++) {
        let sum = b[i] || 0;
        const row = W[i] || [];
        const len = Math.min(row.length, f.length);
        for (let j = 0; j < len; j++) sum += row[j] * f[j];
        out[i] = _relu(sum);
    }
    return out;
}

/** 单 head 推理：σ(w·h + b)。 */
export function predictTask(latent, taskName) {
    const head = _activeWeights.heads[taskName];
    if (!head || !Array.isArray(head.w)) return 0;
    const len = Math.min(latent.length, head.w.length);
    let z = head.b || 0;
    for (let i = 0; i < len; i++) z += head.w[i] * latent[i];
    return _sigmoid(z);
}

/**
 * 一次性输出所有 4 个 propensity（推理入口）。
 * @param {number[]|Float32Array} features  来自 buildCommercialFeatureSnapshot.vector
 * @returns {{ iap:number, rewarded:number, interstitial:number, churn:number, latent:number[] }}
 */
export function predictAllTasks(features) {
    const h = encodeFeatures(features);
    return {
        iap:          predictTask(h, 'iap'),
        rewarded:     predictTask(h, 'rewarded'),
        interstitial: predictTask(h, 'interstitial'),
        churn:        predictTask(h, 'churn'),
        latent:       h,
    };
}

/* ─────────────────── 注入接口 ─────────────────── */

/**
 * 注入训练好的多任务权重（来自 RemoteConfig 或本地实验）。
 * 任何字段格式不对的 head 会退回默认权重并 console.warn；不会全表 reject，
 * 避免一个 head 出错把所有任务全打回 default。
 */
export function setMultiTaskWeights(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== MTL_SCHEMA_VERSION) {
        console.warn(`[mtl] schema mismatch: got ${payload.schemaVersion}, expected ${MTL_SCHEMA_VERSION}`);
        return false;
    }
    const encoder = _validateEncoder(payload.encoder) || _defaultIdentityEncoder();
    const heads = {};
    for (const taskName of ['iap', 'rewarded', 'interstitial', 'churn']) {
        heads[taskName] = _validateHead(payload.heads?.[taskName]) || _defaultUniformHead();
    }
    _activeWeights = {
        schemaVersion: MTL_SCHEMA_VERSION,
        encoder,
        heads,
        fittedAt: Number(payload.fittedAt) || Date.now(),
        source: String(payload.source || 'unknown'),
    };
    _meta = { isDefault: false, fittedAt: _activeWeights.fittedAt, source: _activeWeights.source };
    return true;
}

function _validateEncoder(e) {
    if (!e || !Array.isArray(e.W) || !Array.isArray(e.b)) return null;
    if (e.W.length !== MTL_LATENT_DIM) return null;
    if (e.b.length !== MTL_LATENT_DIM) return null;
    if (!e.W.every((row) => Array.isArray(row) && row.every(Number.isFinite))) return null;
    if (!e.b.every(Number.isFinite)) return null;
    return { W: e.W.map((r) => r.slice()), b: e.b.slice() };
}

function _validateHead(h) {
    if (!h || !Array.isArray(h.w) || !Number.isFinite(h.b)) return null;
    if (h.w.length !== MTL_LATENT_DIM) return null;
    if (!h.w.every(Number.isFinite)) return null;
    return { w: h.w.slice(), b: Number(h.b) };
}

export function getMultiTaskMeta() {
    return { ..._meta, latentDim: MTL_LATENT_DIM };
}

/** 仅供测试 reset。 */
export function _resetMultiTaskForTests() {
    _activeWeights = {
        schemaVersion: MTL_SCHEMA_VERSION,
        encoder: _defaultIdentityEncoder(),
        heads: {
            iap: _defaultUniformHead(),
            rewarded: _defaultUniformHead(),
            interstitial: _defaultUniformHead(),
            churn: _defaultUniformHead(),
        },
    };
    _meta = { isDefault: true };
}

export const _MTL_INTERNALS = { _defaultIdentityEncoder, _defaultUniformHead };
