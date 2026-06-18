/**
 * bot/spawnPriors.js — 形状权重先验偏置层（v1.71 从 adaptiveSpawn.js 抽出）
 *
 * 单一职责：把已插值的 7 类形状权重再做两道乘性偏置后处理：
 *   ① applySpawnPrior            — 离线画像 spawnPrior.shapeBias（顺玩家/逆玩家训练）
 *   ② applyRelativityShapePrior  — §4.17/§2.10 难度相对论 target-aware 偏置
 *
 * 共同护栏：
 *   - 纯函数，不就地改入参；偏置后各键 ≥ 0；
 *   - 仅改池分布、不绕过任何硬约束；
 *   - λ<=0 / 配置关 / 必要输入缺 → 原样返回（恒等）。
 *
 * **行为契约**：与抽出前严格一致。
 */

import { clamp01 } from '../lib/math.js';

/** 离线画像先验消费的 7 类形状权重键（与 shared/shapes.json categoryOrder 一致）。 */
const _SPAWN_PRIOR_KEYS = ['lines', 'rects', 'squares', 'tshapes', 'zshapes', 'lshapes', 'jshapes'];

/** 难度相对论 6 维考点顺序（与 difficultyVec / θ⃗ 一致）。 */
const _RELATIVITY_DIM_KEYS = ['spatial', 'combo', 'order', 'recovery', 'tempo', 'clearEff'];

/**
 * 离线画像先验（spawnPrior.shapeBias）对插值后 shapeWeights 的偏置后处理。
 *
 * 公式：weight_k *= clamp(1 + λ·sign·bias_k, 1-cap, 1+cap)
 *   - bias_k ∈ [-0.5,0.5] 是「中性方向」的形状胜任/适配度（>0 擅长/适合多投）；
 *   - sign 由出块意图决定：救济/爽感「顺玩家」(+1)，训练「逆玩家练弱项」(-1)；
 *   - 困境帧（distressed）禁止训练，只允许顺玩家方向，避免在玩家难受时加压。
 * 纯函数，不就地修改入参；偏置后各键 ≥ 0，仍交由下游约束验证层兜底可解性。
 *
 * @param {Record<string,number>} shapeWeights 插值后的 7 类权重
 * @param {object|null} spawnPrior 注入的 spawnContext.spawnPrior
 * @param {{ intent?: string, distressed?: boolean, lambda?: number, cap?: number, trainingEnabled?: boolean }} [opts]
 * @returns {{ shapeWeights: Record<string,number>, mode: string, lambda: number }}
 */
export function applySpawnPrior(shapeWeights, spawnPrior, opts = {}) {
    const out = { ...shapeWeights };
    const bias = spawnPrior && spawnPrior.shapeBias;
    const lambda = clamp01(Number(opts.lambda ?? 0));
    if (!bias || lambda <= 0) return { shapeWeights: out, mode: 'none', lambda };

    const cap = Number.isFinite(opts.cap) ? Math.max(0, Math.min(1, opts.cap)) : 0.35;
    const intent = opts.intent || 'maintain';
    let mode = 'comply'; // sign +1：顺玩家（救济/爽感/默认）
    if (!opts.distressed && opts.trainingEnabled
        && (intent === 'engage' || intent === 'flow' || intent === 'maintain')) {
        mode = 'train'; // sign -1：逆玩家，定向暴露弱项促成长
    }
    const sign = mode === 'train' ? -1 : 1;

    for (const k of _SPAWN_PRIOR_KEYS) {
        const b = Number(bias[k]) || 0;
        if (!b || !Number.isFinite(out[k])) continue;
        const m = Math.max(1 - cap, Math.min(1 + cap, 1 + lambda * sign * b));
        out[k] = Math.max(0, out[k] * m);
    }
    return { shapeWeights: out, mode, lambda };
}

/**
 * §4.17/§2.10 阶段5「构造算子 target-aware」：把客观目标 b* 与玩家能力 θ⃗ 的逐维缺口
 * gap = b*[dim] − θ⃗[dim]，经 dimAffinity[dim][cat] 映射为 7 类形状权重的乘性偏置，
 * 提升候选池里"贴近 b* 的三块"的密度（与 blockSpawn best-of-K 选块互补）。
 *
 * 设计护栏：
 *   - 纯函数，不就地改入参；偏置后各键 ≥ 0，可解性仍交下游硬约束兜底；
 *   - 仅改池分布、不绕过任何约束、不抬高 d*（体感主线不变）；
 *   - lambda<=0 / 无 b* / 配置关 → 原样返回（恒等）；
 *   - 缺 θ⃗ 时退化为以 0.5 为基线（gap=b*−0.5），仍是"朝客观目标推"的温和偏置。
 *
 * 公式：weight_k *= clamp(1 + λ · Σ_dim affinity[dim][k]·gap[dim], 1−cap, 1+cap)
 *
 * @param {Record<string,number>} shapeWeights 已经过 applySpawnPrior 的权重
 * @param {object|null} bStar 客观目标向量（6 维，[0,1]）
 * @param {object|null} calibration θ⃗ 标定向量（6 维 μ）；缺省以 0.5 为基线
 * @param {object} shapePriorCfg difficultyRelativity.shapePrior 配置块
 * @param {number} lambda 实际个性化强度（relativityLambda）
 * @returns {{ shapeWeights: Record<string,number>, applied: boolean, lambda: number }}
 */
export function applyRelativityShapePrior(shapeWeights, bStar, calibration, shapePriorCfg, lambda) {
    const out = { ...shapeWeights };
    const cfg = shapePriorCfg || {};
    /* 修复原 bug（2026-06-18）：Number(x) 永不为 null/undefined，原写法 `?? 0.6` 是 dead branch，
     * 缺失 cfg.strength 时实际退化为 clamp01(NaN)=0 → 关闭功能（与作者意图"默认 0.6"相反）。
     * 实测：生产路径在 adaptiveSpawn L2844 已守卫 drCfg.shapePrior?.enabled !== false 且
     * shared/game_rules.json#shapePrior.strength 始终配置（当前=0.4），bug 不影响生产；
     * 修正后保持作者本意，对未配置 strength 的测试夹具/兜底路径返回默认 0.6。 */
    const _cfgStrength = Number(cfg.strength);
    const _safeStrength = Number.isFinite(_cfgStrength) ? _cfgStrength : 0.6;
    const lam = clamp01(Number(lambda) || 0) * clamp01(_safeStrength);
    if (cfg.enabled === false || !bStar || lam <= 0) {
        return { shapeWeights: out, applied: false, lambda: 0 };
    }
    const affinity = cfg.dimAffinity || {};
    const cap = Number.isFinite(cfg.cap) ? Math.max(0, Math.min(1, cfg.cap)) : 0.30;
    const cal = calibration && typeof calibration === 'object' ? calibration : null;
    /* 预算逐维缺口 gap=b*−θ⃗（θ⃗ 缺省 0.5）。 */
    const gap = {};
    for (const dim of _RELATIVITY_DIM_KEYS) {
        const b = Number(bStar[dim]);
        if (!Number.isFinite(b)) { gap[dim] = 0; continue; }
        const t = cal && Number.isFinite(Number(cal[dim])) ? Number(cal[dim]) : 0.5;
        gap[dim] = b - t;
    }
    let applied = false;
    for (const k of _SPAWN_PRIOR_KEYS) {
        if (!Number.isFinite(out[k])) continue;
        let acc = 0;
        for (const dim of _RELATIVITY_DIM_KEYS) {
            const a = affinity[dim] ? Number(affinity[dim][k]) : 0;
            if (Number.isFinite(a) && a !== 0) acc += a * gap[dim];
        }
        if (acc === 0) continue;
        const m = Math.max(1 - cap, Math.min(1 + cap, 1 + lam * acc));
        out[k] = Math.max(0, out[k] * m);
        applied = true;
    }
    return { shapeWeights: out, applied, lambda: lam };
}
