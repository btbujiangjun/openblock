/* 自动生成 —— 请勿手改。源：web/src/bot/pbCurve.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * bot/pbCurve.js — PB（个人最好分）双 S 曲线（v1.71 从 adaptiveSpawn.js 抽出）
 *
 * 单一职责：把 score/bestScore 比值映射为 { pbTension, pbBrake, pbRelease, pbPhase }
 *   ① pbTension — 张力 sigmoid（接近 PB 时增加难度）
 *   ② pbBrake   — 刹车 sigmoid（超过 PB 一定倍数后压制 payoff）
 *   ③ pbRelease — 显式释放开关
 *   ④ pbPhase   — 离散阶段标签（warmup/chase/tension/gate/release/brake/overshoot）
 *
 * 参数来源：option 缺省时回退到 DEFAULT_SPAWN_PARAMS_PB_CURVE；
 *           SpawnParamTuner（L2）部署后由 θ 参数动态注入。
 *
 * **行为契约**：与抽出前严格一致。
 */

import { clamp01 } from '../lib/math.mjs';

function sigmoid01(x) {
    return 1 / (1 + Math.exp(-x));
}

/**
 * 默认 PB 双 S 曲线参数 — 与 v2.1 之前硬编码完全一致, 保持向后兼容。
 * v2.2: 暴露为可覆盖的常量, 让 spawn-tuning v2 寻参可以把这些常数纳入 θ。
 *
 * 业务含义:
 *   pbTensionCenter — 张力 sigmoid 拐点 (玩家接近 PB 多少比例时开始增加难度)
 *   pbTensionWidth  — 张力 sigmoid 斜率宽度 (越小越陡, 即拐点附近变化越剧烈)
 *   pbBrakeCenter   — 刹车 sigmoid 拐点 (超过 PB 多少倍后强力压制 payoff)
 *   pbBrakeWidth    — 刹车 sigmoid 斜率宽度
 *
 * DEFAULT_SPAWN_PARAMS_PB_CURVE — SpawnParam θ 中「组 B: PB 双 S 曲线 (4 维)」的默认值。
 * 当 SpawnParamTuner 未部署 / policies.json 加载失败时 derivePbCurve 自动 fallback 到这里。
 *
 * SPAWN_PARAM_KEYS — L1 (SpawnPolicyRules) 与 L2 (SpawnParamTuner) 之间的 9 维 θ 数据契约
 * （与 rl_pytorch/spawn_tuning_v2/feature_io.THETA_KEYS 同源）。
 *
 * 详见 docs/algorithms/SPAWN_OVERVIEW.md §5。
 */
export const DEFAULT_SPAWN_PARAMS_PB_CURVE = Object.freeze({
    pbTensionCenter: 0.82,
    pbTensionWidth: 0.08,
    pbBrakeCenter: 1.05,
    pbBrakeWidth: 0.06,
});

export const SPAWN_PARAM_KEYS = Object.freeze([
    'personalizationStrength',
    'temperature',
    'surpriseBudgetGain',
    'surpriseCooldown',
    'maxEvaluatedTriplets',
    'pbTensionCenter',
    'pbTensionWidth',
    'pbBrakeCenter',
    'pbBrakeWidth',
]);

/** 把 options 中的 PB 曲线参数 (可能浮点 / NaN) 整型化并填充默认值。 */
function _resolvePbCurveParams(options) {
    const numOrDefault = (v, d) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
        tensionCenter: numOrDefault(options?.pbTensionCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionCenter),
        tensionWidth: numOrDefault(options?.pbTensionWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionWidth),
        brakeCenter: numOrDefault(options?.pbBrakeCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeCenter),
        brakeWidth: numOrDefault(options?.pbBrakeWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeWidth),
    };
}

export function derivePbCurve(score = 0, bestScore = 0, releaseActive = false, options = null) {
    const best = Number(bestScore) || 0;
    if (best <= 0) {
        return {
            pbRatio: null,
            pbTension: 0,
            pbBrake: 0,
            pbRelease: releaseActive ? 1 : 0,
            pbPhase: 'unknown',
        };
    }
    const ratio = Math.max(0, Number(score) || 0) / best;
    const p = _resolvePbCurveParams(options);
    const pbTension = clamp01(sigmoid01((ratio - p.tensionCenter) / p.tensionWidth));
    const pbBrake = clamp01(sigmoid01((ratio - p.brakeCenter) / p.brakeWidth));
    const pbRelease = releaseActive ? 1 : 0;
    let pbPhase = 'warmup';
    if (ratio >= 1.15) pbPhase = 'overshoot';
    else if (ratio >= 1.05) pbPhase = 'brake';
    else if (ratio >= 1.0) pbPhase = 'release';
    else if (ratio >= 0.95) pbPhase = 'gate';
    else if (ratio >= 0.8) pbPhase = 'tension';
    else if (ratio >= 0.5) pbPhase = 'chase';
    return { pbRatio: ratio, pbTension, pbBrake, pbRelease, pbPhase };
}
