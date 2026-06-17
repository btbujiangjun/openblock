/**
 * 潜在能力标定器 θ⃗（PlayerLatentAbility）—— 难度相对论（§4.17 / §2.10）的「体感↔客观」标定层。
 *
 * 设计要点：
 *   - **S 形 stress 曲线仍是调控主线**；θ⃗ 不取代 PB 作锚点，只把「目标体感难度 d*=stress」
 *     反解为「客观目标 b* = θ⃗ ⊕ d*」供等体感选块对齐。
 *   - θ⃗ 是 6 维（与 difficultyVec/b⃗ 同维：spatial/combo/order/recovery/tempo/clearEff）的
 *     贝叶斯潜在能力后验 `θ_d ~ N(μ_d, σ_d²)`，每局/里程碑段以一次「答题」观测做 1-D Kalman 更新。
 *   - **θ⃗ 只吃行为质量与盘面应对（AbilityVector），不吃绝对分数**——故"耐心刷高 PB 的新手"
 *     与"3 局高 PB 的天才"得到不同 θ⃗（effectivePB 做不到）。
 *   - 纯函数式 API，无 DOM / 网络依赖；跨端镜像见 cocos / miniprogram 同名文件，跨语言契约对齐。
 *
 * 退化保证：confidence < minConfidence 时 getCalibrationVector 返回 null →
 * 上游退回恒等标定（行为 = 现状）。
 */

import { DIFFICULTY_VECTOR_DIMS } from './spawnStepDifficulty.js';

/** θ⃗ 维度顺序（与 difficultyVec 一致，SSOT）。 */
export const LATENT_DIMS = DIFFICULTY_VECTOR_DIMS;

export const LATENT_ABILITY_VERSION = 1;

const DEFAULT_LATENT_CFG = Object.freeze({
    priorMu: 0.5,
    priorSigma: 0.25,
    beta: 0.12,
    sigmaFloor: 0.06,
    confN0: 12
});

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

function mergeLatentCfg(cfg) {
    const sub = cfg && typeof cfg === 'object'
        ? (cfg.latentAbility && typeof cfg.latentAbility === 'object' ? cfg.latentAbility : cfg)
        : null;
    if (!sub) return DEFAULT_LATENT_CFG;
    return { ...DEFAULT_LATENT_CFG, ...sub };
}

/** 新建初始 θ⃗ 状态（各维先验 μ/σ）。 */
export function createLatentState(cfg) {
    const c = mergeLatentCfg(cfg);
    const dims = {};
    for (let i = 0; i < LATENT_DIMS.length; i++) {
        dims[LATENT_DIMS[i]] = { mu: c.priorMu, sigma: c.priorSigma };
    }
    return { version: LATENT_ABILITY_VERSION, n: 0, dims };
}

/**
 * 把 AbilityVector（playerAbilityModel.buildPlayerAbilityVector 输出）映射为 6 维 θ 观测（[0,1]）。
 * 是「行为质量 / 盘面应对」的代理，不含绝对分数。
 * @param {{skillScore?:number,controlScore?:number,clearEfficiency?:number,boardPlanning?:number,riskLevel?:number}} ability
 * @returns {Record<string,number>}
 */
export function mapAbilityToObservation(ability) {
    const a = ability && typeof ability === 'object' ? ability : {};
    const skill = clamp01(a.skillScore);
    const control = clamp01(a.controlScore);
    const clearEff = clamp01(a.clearEfficiency);
    const planning = clamp01(a.boardPlanning);
    const risk = clamp01(a.riskLevel);
    return {
        spatial: planning,
        combo: clearEff,
        order: clamp01(0.6 * planning + 0.4 * control),
        recovery: clamp01(1 - risk),
        tempo: control,
        clearEff: clamp01(0.5 * clearEff + 0.5 * skill)
    };
}

/**
 * 用一次观测对 θ⃗ 做 1-D Kalman 更新（纯函数，返回新 state，不改入参）。
 * @param {object} state createLatentState 产物 / 反序列化结果
 * @param {Record<string,number>} observation 6 维 [0,1] 观测
 * @param {object} [cfg] difficultyRelativity（取其 latentAbility 子块）
 * @returns {object} 新 state
 */
export function updateLatentState(state, observation, cfg) {
    const c = mergeLatentCfg(cfg);
    const base = state && state.dims ? state : createLatentState(cfg);
    const obsVar = c.priorSigma * c.priorSigma; // 观测噪声方差（以先验 σ 为基准）
    const dims = {};
    for (let i = 0; i < LATENT_DIMS.length; i++) {
        const dim = LATENT_DIMS[i];
        const prev = base.dims[dim] || { mu: c.priorMu, sigma: c.priorSigma };
        const obs = observation && Number.isFinite(observation[dim]) ? clamp01(observation[dim]) : null;
        if (obs == null) { dims[dim] = { mu: prev.mu, sigma: prev.sigma }; continue; }
        const sig2 = prev.sigma * prev.sigma;
        let K = sig2 / (sig2 + obsVar);
        if (K < c.beta) K = c.beta; // 保底学习步长
        const mu = clamp01(prev.mu + K * (obs - prev.mu));
        const sigma = Math.max(c.sigmaFloor, Math.sqrt(Math.max(0, (1 - K) * sig2)));
        dims[dim] = { mu, sigma };
    }
    return { version: LATENT_ABILITY_VERSION, n: (base.n || 0) + 1, dims };
}

/** 样本量驱动的置信度 1 - e^{-n/N0} ∈ [0,1]。 */
export function latentConfidence(state, cfg) {
    const c = mergeLatentCfg(cfg);
    const n = state && Number.isFinite(state.n) ? state.n : 0;
    if (n <= 0) return 0;
    return clamp01(1 - Math.exp(-n / Math.max(1, c.confN0)));
}

/**
 * 返回标定向量 { dim: μ }；当置信度 < minConfidence 时返回 null（上游退回恒等标定）。
 * @param {object} state
 * @param {object} fullCfg difficultyRelativity 整块（含 minConfidence + latentAbility）
 */
export function getCalibrationVector(state, fullCfg) {
    const conf = latentConfidence(state, fullCfg);
    const minConf = fullCfg && Number.isFinite(fullCfg.minConfidence) ? fullCfg.minConfidence : 0.45;
    if (conf < minConf) return null;
    if (!state || !state.dims) return null;
    const out = {};
    for (let i = 0; i < LATENT_DIMS.length; i++) {
        const dim = LATENT_DIMS[i];
        out[dim] = clamp01(state.dims[dim] ? state.dims[dim].mu : 0.5);
    }
    return out;
}

/** 完整可观测快照（面板 / 回放帧 / 诊断用）。 */
export function snapshotLatent(state, cfg) {
    const base = state && state.dims ? state : createLatentState(cfg);
    const mu = {};
    const sigma = {};
    for (let i = 0; i < LATENT_DIMS.length; i++) {
        const dim = LATENT_DIMS[i];
        const d = base.dims[dim] || {};
        mu[dim] = clamp01(d.mu);
        sigma[dim] = Number.isFinite(d.sigma) ? d.sigma : null;
    }
    return { version: LATENT_ABILITY_VERSION, n: base.n || 0, confidence: latentConfidence(base, cfg), mu, sigma };
}

/** 序列化 / 反序列化（端侧持久化）。 */
export function serializeLatent(state) {
    if (!state || !state.dims) return null;
    return { version: state.version || LATENT_ABILITY_VERSION, n: state.n || 0, dims: state.dims };
}

export function deserializeLatent(json, cfg) {
    if (!json || typeof json !== 'object' || !json.dims) return createLatentState(cfg);
    const dims = {};
    for (let i = 0; i < LATENT_DIMS.length; i++) {
        const dim = LATENT_DIMS[i];
        const d = json.dims[dim];
        dims[dim] = d && Number.isFinite(d.mu) && Number.isFinite(d.sigma)
            ? { mu: clamp01(d.mu), sigma: d.sigma }
            : createLatentState(cfg).dims[dim];
    }
    return { version: LATENT_ABILITY_VERSION, n: Number.isFinite(json.n) ? json.n : 0, dims };
}
