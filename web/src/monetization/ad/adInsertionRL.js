/**
 * adInsertionRL.js — 广告插入决策 RL Scaffolding
 *
 * v1.49.x P3-2：为"广告何时何种类型插入"留出 RL 接入面。当前实现为 **纯规则版**
 * 占位策略，但所有状态特征 / 奖励信号 / 策略接口都按 RL pipeline 习惯设计：
 *
 *   buildAdInsertionState(ctx)      —— 状态向量 s（features + 元数据）
 *   computeAdInsertionReward(...)   —— 奖励函数 r（单次广告完成后回写）
 *   selectAdInsertionAction(state)  —— 策略 π(a|s)：当前规则版；可注入 RL policy
 *   setAdInsertionPolicy(fn)        —— 策略热替换（线下训练好之后下发）
 *
 * 设计：
 *   - **纯函数 + 无副作用**：本模块不写 storage、不发事件；adDecisionEngine 决定何时调用。
 *   - **状态可序列化**：features 全部为标量 / one-hot，方便离线训练管线 dump 成 parquet。
 *   - **退化路径**：策略缺失 / 异常时一律走规则版，永不阻塞主流程。
 *
 * 状态特征（v1）：
 *   - confidence, frustrationLevel, missRate, flowState（玩家体感）
 *   - daysSinceInstall, totalSessions, daysSinceLastActive（生命周期）
 *   - rewardedToday, interstitialToday, secondsSinceLastAd（广告疲劳）
 *   - payerScore, churnRisk, adFatigueRisk（commercial vector）
 *   - sceneCode（one-hot：game_over / no_moves / daily_reward / ...）
 *
 * v1.49.x 算法层 eng-2 改造：
 *   - state.features 同时提供 array / dict 两个视图（FEATURE_KEYS 给出 array 索引语义）
 *   - 任何下游（policy / bandit / 训练 pipeline）都可以选 array (latency-sensitive) 或
 *     dict (代码可读性) 任一形式，避免"魔术索引 11=churnRisk"散落在多个 module。
 *
 * 奖励（v1，规则版）：
 *   r = +1.0 * filled                  广告填充成功
 *     + 0.5 * (rewarded ? 1 : 0)       玩家完整观看激励视频
 *     - 1.5 * sessionAbandonAfter      展示广告后 2min 内退出（流失惩罚）
 *     - 0.3 * fatigueExceeded          疲劳上限被打穿
 */
import { getFlag } from '../featureFlags.js';
import { buildBanditPolicyForAdInsertion } from '../ml/contextualBandit.js';

const SCENES = ['game_over', 'no_moves', 'daily_reward', 'stamina_empty', 'level_complete', 'shop_view', 'pause_menu', 'settings'];

/* v1.49.x 算法层 eng-2：array 索引 → 语义 key 的映射，供下游消费时按语义而不是
 * 魔术数取值。任何对 features[i] 的硬编码访问都应优先查这个表。 */
export const FEATURE_KEYS = Object.freeze([
    'confidence',           // 0
    'frustrationLevel',     // 1
    'missRate',             // 2
    'flowState',            // 3
    'daysSinceInstall',     // 4
    'totalSessions',        // 5
    'daysSinceLastActive',  // 6
    'rewardedToday',        // 7
    'interstitialToday',    // 8
    'secondsSinceLastAd',   // 9
    'payerScore',           // 10
    'churnRisk',            // 11
    'adFatigueRisk',        // 12
    'rewardedAdPropensity', // 13
    'interstitialPropensity', // 14
    /* sceneOneHot 从 15 开始，按 SCENES 顺序展开 */
    ...SCENES.map((s) => `scene_${s}`),
]);

let _policy = null;

function _clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }

/**
 * 构造状态向量 + 元数据。
 *
 * @param {Object} ctx
 * @param {Object} [ctx.player]            { confidence, frustrationLevel, missRate, flowState }
 * @param {Object} [ctx.lifecycle]         { daysSinceInstall, totalSessions, daysSinceLastActive, stage }
 * @param {Object} [ctx.adFreq]            { rewardedToday, interstitialToday, lastAdTs }
 * @param {Object} [ctx.commercialVector]  { payerScore, churnRisk, adFatigueRisk, rewardedAdPropensity, interstitialPropensity }
 * @param {string} [ctx.scene]             场景 ID（来自 AD_SCENES）
 * @returns {{ features: number[], meta: object }}
 */
export function buildAdInsertionState(ctx = {}) {
    const player = ctx.player ?? {};
    const lifecycle = ctx.lifecycle ?? {};
    const adFreq = ctx.adFreq ?? {};
    const cv = ctx.commercialVector ?? {};
    const scene = String(ctx.scene || '');

    const now = Date.now();
    const lastAdTs = Number(adFreq.lastAdTs) || 0;
    const secondsSinceLastAd = lastAdTs > 0 ? Math.max(0, (now - lastAdTs) / 1000) : 99999;

    const sceneOneHot = SCENES.map((s) => (s === scene ? 1 : 0));

    const features = [
        _clamp01(player.confidence ?? 0.5),
        _clamp01(player.frustrationLevel ?? 0),
        _clamp01(player.missRate ?? 0),
        _clamp01(player.flowState ?? 0),

        Math.min(1, (Number(lifecycle.daysSinceInstall) || 0) / 90),
        Math.min(1, (Number(lifecycle.totalSessions) || 0) / 200),
        Math.min(1, (Number(lifecycle.daysSinceLastActive) || 0) / 14),

        Math.min(1, (Number(adFreq.rewardedToday) || 0) / 12),
        Math.min(1, (Number(adFreq.interstitialToday) || 0) / 6),
        Math.min(1, secondsSinceLastAd / 600),

        _clamp01(cv.payerScore ?? 0),
        _clamp01(cv.churnRisk ?? 0),
        _clamp01(cv.adFatigueRisk ?? 0),
        _clamp01(cv.rewardedAdPropensity ?? 0),
        _clamp01(cv.interstitialPropensity ?? 0),

        ...sceneOneHot,
    ];

    /* eng-2：dict 视图——key 与 array 索引语义一一对应。 */
    const featuresByKey = {};
    for (let i = 0; i < FEATURE_KEYS.length && i < features.length; i++) {
        featuresByKey[FEATURE_KEYS[i]] = features[i];
    }

    return {
        features,
        featuresByKey,
        meta: {
            scene,
            stage: lifecycle.stage ?? 'unknown',
            ts: now,
        },
    };
}

/**
 * 计算单次广告决策的奖励（事件驱动；adAdapter 回调 / sessionEnd 时写入）。
 *
 * @param {Object} outcome
 * @param {boolean} [outcome.filled]               广告成功填充
 * @param {boolean} [outcome.rewarded]             玩家完整观看（仅激励视频）
 * @param {boolean} [outcome.sessionAbandonAfter]  广告后 ≤2min 内退出
 * @param {boolean} [outcome.fatigueExceeded]      触达疲劳上限
 * @returns {number}
 */
export function computeAdInsertionReward(outcome = {}) {
    let r = 0;
    if (outcome.filled) r += 1.0;
    if (outcome.rewarded) r += 0.5;
    if (outcome.sessionAbandonAfter) r -= 1.5;
    if (outcome.fatigueExceeded) r -= 0.3;
    return r;
}

/**
 * 默认规则策略：与 adDecisionEngine._selectBestAdType 等价（轻量复刻），
 * 同时返回 confidence/score 以便后续 RL 推理替换时能直接对比。
 *
 * eng-2 改造：优先用 featuresByKey（dict）取值，无该字段时退回 array index。
 */
function _ruleBasedPolicy(state) {
    const f = state.features || [];
    const fk = state.featuresByKey || {};
    const churnRisk = fk.churnRisk ?? f[11] ?? 0;
    const fatigueRisk = fk.adFatigueRisk ?? f[12] ?? 0;
    const rewardedProp = fk.rewardedAdPropensity ?? f[13] ?? 0;
    const interstitialProp = fk.interstitialPropensity ?? f[14] ?? 0;
    const isNoMoves = (fk.scene_no_moves ?? f[16] ?? 0) === 1;
    const isDaily = (fk.scene_daily_reward ?? f[17] ?? 0) === 1;
    const isStamina = (fk.scene_stamina_empty ?? f[18] ?? 0) === 1;

    /* 高疲劳 / 高流失风险 → skip */
    if (fatigueRisk >= 0.8 || churnRisk >= 0.7) {
        return { action: 'skip', score: 0.9, reason: 'fatigue_or_churn_high' };
    }
    if (isNoMoves || isDaily || isStamina) {
        return { action: 'rewarded', score: 0.8 + 0.2 * rewardedProp, reason: 'scene_rewarded_first' };
    }
    if (rewardedProp >= interstitialProp) {
        return { action: 'rewarded', score: 0.5 + 0.3 * rewardedProp, reason: 'rewarded_higher_propensity' };
    }
    return { action: 'interstitial', score: 0.5 + 0.3 * interstitialProp, reason: 'interstitial_default' };
}

/**
 * 选择动作 a = π(s)。优先级：
 *   1. 显式注入的 _policy（setAdInsertionPolicy 注入；线下训练好的 RL/MTL 等）
 *   2. feature flag `adInsertionBandit` on 时走 LinUCB（contextualBandit.buildBanditPolicyForAdInsertion）
 *   3. 否则规则版 _ruleBasedPolicy
 * 返回 { action: 'skip' | 'rewarded' | 'interstitial', score, reason }。
 */
export function selectAdInsertionAction(state) {
    if (typeof _policy === 'function') {
        try {
            const r = _policy(state);
            if (r && typeof r === 'object' && typeof r.action === 'string') {
                return {
                    action: r.action,
                    score: Math.max(0, Math.min(1, Number(r.score ?? 0.5))),
                    reason: r.reason || 'policy',
                };
            }
        } catch { /* fallthrough to rule */ }
    }
    /* P3-1：bandit 灰度开关。 */
    try {
        if (getFlag('adInsertionBandit')) {
            const policy = buildBanditPolicyForAdInsertion();
            const r = policy({ features: state.features });
            if (r?.type) {
                return { action: r.type, score: 0.6, reason: 'bandit_linucb' };
            }
        }
    } catch { /* fallthrough to rule */ }
    return _ruleBasedPolicy(state);
}

/** 注入 RL policy（线下训练 → JSON 推理函数）。 */
export function setAdInsertionPolicy(fn) {
    _policy = typeof fn === 'function' ? fn : null;
}

/** 仅供测试 / 单测 reset。 */
export function _resetAdInsertionPolicyForTests() {
    _policy = null;
}

export { SCENES as AD_INSERTION_SCENES };
