/**
 * commercialPolicy.js — 商业化决策"打包"层
 *
 * v1.49.x 算法层：把 `buildCommercialModelVector` → `recommendedAction` →
 * 探索包装 → `actionOutcomeMatrix.recordRecommendation` 这个完整链路打包成
 * 单一入口 `decideAndRecord(ctx)`，让上游业务（paymentManager / lifecycleOutreach
 * / popupCoordinator）从一行调用拿到：
 *
 *   1. 推理出来的 commercial vector
 *   2. 探索/利用包装后的最终 action
 *   3. 已经把"我推荐了什么 action"记入 actionOutcomeMatrix（用 snapshotDigest 关联）
 *
 * 这个层是"决策端"的 Single Source of Truth；不是必须用，但任何走"模型推荐 → 落地"
 * 完整链路的上游都建议用它，避免漏接 explore 标签或 outcome attribution。
 */

import { buildCommercialModelVector } from './commercialModel.js';
import { getFlag } from './featureFlags.js';
import { wrapWithExplorer } from './explorer/epsilonGreedyExplorer.js';
import { recordRecommendation } from './quality/actionOutcomeMatrix.js';

const ACTION_CANDIDATES = ['iap_offer', 'rewarded_ad', 'interstitial', 'task_or_push', 'observe'];

/* 默认 deterministic policy：直接读 vector.recommendedAction。 */
function _deterministicPolicy(vector) {
    return {
        action: vector?.recommendedAction || 'observe',
        candidates: ACTION_CANDIDATES,
        vector,
    };
}

const _explorerWrapped = wrapWithExplorer(_deterministicPolicy, { epsilon: 0.05 });

/**
 * 执行完整推理 → 决策 → 记录链路。
 *
 * @param {Object} ctx              传给 buildCommercialModelVector 的上下文
 * @param {Object} [opts]
 * @param {string} [opts.userId]    用户 ID（探索器去重 + 矩阵 attribution）
 * @returns {{
 *   vector: object,
 *   action: string,
 *   mode: 'explore'|'exploit',
 *   propensity: number,
 *   exploredFrom: string|null,
 *   snapshotDigest: string|null,
 * }}
 */
export function decideAndRecord(ctx = {}, opts = {}) {
    const vector = buildCommercialModelVector(ctx);
    const snapshotDigest = vector?.snapshotDigest || null;

    let decision;
    if (getFlag('explorerEpsilonGreedy')) {
        const wrapped = _explorerWrapped(vector, {
            userId: opts.userId,
            sampleId: snapshotDigest,
        });
        decision = {
            action: wrapped.action || vector.recommendedAction || 'observe',
            mode: wrapped.mode,
            propensity: wrapped.propensity,
            exploredFrom: wrapped.exploredFrom,
        };
    } else {
        decision = {
            action: vector?.recommendedAction || 'observe',
            mode: 'exploit',
            propensity: 1,
            exploredFrom: null,
        };
    }

    /* P0-3：记录推荐到矩阵；后续 outcome 进来时按 snapshotDigest 关联。 */
    if (getFlag('actionOutcomeMatrix')) {
        try {
            recordRecommendation(decision.action, {
                snapshotDigest,
                propensities: {
                    iap: vector?.iapPropensity,
                    rewarded: vector?.rewardedAdPropensity,
                    interstitial: vector?.interstitialPropensity,
                    churn: vector?.churnRisk,
                    payer: vector?.payerScore,
                },
            });
        } catch { /* ignore */ }
    }

    return {
        vector,
        action: decision.action,
        mode: decision.mode,
        propensity: decision.propensity,
        exploredFrom: decision.exploredFrom,
        snapshotDigest,
    };
}
