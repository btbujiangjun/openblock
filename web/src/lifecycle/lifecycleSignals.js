/**
 * lifecycleSignals.js — 玩家生命周期 / 成熟度的"统一数据层"
 *
 * 落地 v1.48 (2026-05) 的架构原则：
 *
 *   底层采用尽可能统一的数据层，数据层负责指标定义、数据采集和数据存储；
 *   在数据层之上，按照业务需求（出块体验 / 运营 / 商业化 / 召回）进行
 *   策略设计和指标数据消费。
 *
 * 此前代码里至少存在 4 套互不归一的"成熟度家族"和 3 套"流失风险"，互不互通：
 *
 *   - PlayerProfile.isNewPlayer / isInOnboarding / returningWarmupStrength（局内）
 *   - playerLifecycleDashboard.getPlayerLifecycleStage（运营 5 段：onboarding..veteran）
 *   - playerMaturity.L1..L4 / M0..M3（双轴评分）
 *   - playerProfile.segment5 (A..E)
 *
 *   - commercialModel.churnRisk（规则模型加权 0..1）
 *   - churnPredictor.calculateChurnRisk（近 7 vs 前 7 天下降率 0..100）
 *   - playerMaturity._calculateChurnRisk（历史 SkillScore 斜率）
 *
 * 三套流失各产出不同结果、上层模块各自挑一个使用，结果就是同一个玩家在
 * 商业化、出块、运营干预里被打成不同档位，决策互相抵消。
 *
 * 本模块做两件事：
 *
 *   1. `getUnifiedLifecycleSnapshot(profile, options)` —— 把 4 套家族打包成
 *      一个稳定契约，所有上层（adaptiveSpawn / monetization / strategyAdvisor /
 *      retentionManager / pushNotificationManager）都从这里取数。
 *
 *   2. `getUnifiedChurnRisk(profile, options)` —— 把 3 套流失风险按"权重投票"
 *      合成单一 [0..1] 标量 + 5 档枚举，并保留每个来源的明细供 UI 调试。
 *
 * 设计约束：
 *
 *   - **纯函数**：不写 localStorage、不发事件、不修改 profile；所有持久化和
 *     副作用由上层（lifecycleBus / retention 模块）负责。
 *   - **不引入新 ML**：本层只做信号聚合 / 归一 / 兜底；ML 模型留给离线管线。
 *   - **强单测**：每个家族字段都有 fallback 路径，避免 undefined 传到下游。
 */

import {
    getLifecycleMaturitySnapshot,
    getPlayerLifecycleStageDetail,
} from '../retention/playerLifecycleDashboard.js';
import { evaluateWinbackTrigger, getWinbackStatus } from '../retention/winbackProtection.js';
import { getMaturityInsights } from '../retention/playerMaturity.js';

const SCHEMA_VERSION = 1;

/**
 * @typedef {Object} UnifiedLifecycleSnapshot
 * @property {number}  schemaVersion       本数据契约版本（升级字段时同步升）
 * @property {Object}  install             装机/累计身份元
 * @property {number}  install.daysSinceInstall
 * @property {number}  install.totalSessions
 * @property {number}  install.totalPlacements
 * @property {number}  install.lastActiveTs
 * @property {Object}  onboarding          局内"新手 / 首局保护"家族
 * @property {boolean} onboarding.isNewPlayer
 * @property {boolean} onboarding.isInOnboarding
 * @property {number}  onboarding.spawnRoundIndex
 * @property {Object}  returning           沉默回归家族
 * @property {number}  returning.daysSinceLastActive
 * @property {number}  returning.warmupStrength            0..1
 * @property {boolean} returning.isWinbackCandidate        ≥7 天未活跃
 * @property {boolean} returning.protectionActive          已激活的 winback 保护包是否在生效
 * @property {Object}  stage               运营 5 段（dashboard 单一权威源）
 * @property {string}  stage.code          'S0' / 'S1' / ... / 'S4'
 * @property {string}  stage.name          'onboarding' / .. / 'veteran'
 * @property {number}  stage.confidence    0..1
 * @property {Object}  maturity            成熟度 L1-L4 / M0-M4
 * @property {string}  maturity.level      'L1' / 'L2' / 'L3' / 'L4'
 * @property {string}  maturity.band       'M0' / 'M1' / 'M2' / 'M3' / 'M4'
 * @property {number}  maturity.skillScore 0..100
 * @property {number}  maturity.valueScore 0..100
 * @property {Object}  churn               统一流失风险（adapter 后的归一结果）
 * @property {number}  churn.unifiedRisk   0..1
 * @property {string}  churn.level         'critical' / 'high' / 'medium' / 'low' / 'stable'
 * @property {Object}  churn.sources       三个来源的原始值（debug / 训练样本）
 * @property {Object}  segment             玩家分群 / 动机
 * @property {string}  segment.behaviorSegment
 * @property {string}  segment.motivationIntent
 * @property {string}  segment.segment5
 */

/**
 * 流失风险归一权重：默认让"事件驱动"的 churnPredictor 和"规则模型"的
 * playerMaturity 各占主导，commercialModel 作为辅助。
 *
 * - churnPredictor：基于 14 天会话 / 分数 / 时长 / engagement 下降率，最具时效性
 * - maturity      ：基于近 5 局 SkillScore 斜率，对"突然变差"敏感
 * - commercial    ：基于 segment + 实时 frustration 等代理量，最不直接
 *
 * 三者输入都缺失时返回 unifiedRisk=0、level='stable'。
 */
const CHURN_BLEND_WEIGHTS_DEFAULT = Object.freeze({
    predictor: 0.45,
    maturity: 0.35,
    commercial: 0.20,
});

/* v1.49.x 算法层 P1-3：unifiedRisk 投票权重可被注入。
 *
 * 默认权重是产品先验。线下用历史 churn 标签算出三路 PR-AUC 后，可以让权重
 * 与 PR-AUC 成正比（业界常见做法）：
 *   weights = { source: PR_AUC[source] / Σ PR_AUC[*] }
 *
 * `setChurnBlendWeights({...})` 由 RemoteConfig 拉取后调用；当三路 AUC 接近时
 * 不替换可显著降低运营成本（差距在 ±0.02 内时建议保留默认）。 */
let _churnBlendWeights = { ...CHURN_BLEND_WEIGHTS_DEFAULT };

export function setChurnBlendWeights(weights) {
    if (!weights || typeof weights !== 'object') return false;
    const next = { ...CHURN_BLEND_WEIGHTS_DEFAULT };
    let touched = false;
    for (const key of ['predictor', 'maturity', 'commercial']) {
        const v = Number(weights[key]);
        if (Number.isFinite(v) && v >= 0) { next[key] = v; touched = true; }
    }
    if (!touched) return false;
    /* 重新归一到和 = 1，避免下游再除一次。 */
    const sum = next.predictor + next.maturity + next.commercial;
    if (sum > 0) {
        _churnBlendWeights = {
            predictor: next.predictor / sum,
            maturity: next.maturity / sum,
            commercial: next.commercial / sum,
        };
        return true;
    }
    return false;
}

export function getChurnBlendWeights() {
    return { ..._churnBlendWeights };
}

export function resetChurnBlendWeights() {
    _churnBlendWeights = { ...CHURN_BLEND_WEIGHTS_DEFAULT };
}

/** 兼容旧导入：保留 CHURN_BLEND_WEIGHTS 名字（指向当前激活权重的快照）。 */
const CHURN_BLEND_WEIGHTS = new Proxy({}, {
    get(_target, key) { return _churnBlendWeights[key]; },
    ownKeys() { return Object.keys(_churnBlendWeights); },
    getOwnPropertyDescriptor(_target, key) {
        return { enumerable: true, configurable: true, value: _churnBlendWeights[key] };
    },
});

const CHURN_LEVEL_THRESHOLDS = Object.freeze([
    { level: 'critical', min: 0.70 },
    { level: 'high',     min: 0.50 },
    { level: 'medium',   min: 0.30 },
    { level: 'low',      min: 0.15 },
    { level: 'stable',   min: 0 },
]);

function _clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
}

function _churnLevelFromRisk(risk01) {
    const r = _clamp01(risk01);
    for (const t of CHURN_LEVEL_THRESHOLDS) {
        if (r >= t.min) return t.level;
    }
    return 'stable';
}

/**
 * 把 playerMaturity._calculateChurnRisk 的离散标签映射回 0..1 标量，
 * 让三套流失能放在同一个权重投票里。无数据 → null（投票时跳过）。
 */
function _maturityChurnTo01(label) {
    switch (label) {
        case 'high': return 0.75;
        case 'medium': return 0.5;
        case 'low': return 0.25;
        case 'stable': return 0.05;
        case 'unknown':
        case undefined:
        case null:
        default: return null;
    }
}

/**
 * 三套流失风险归一适配器。
 *
 * @param {Object}  options
 * @param {?number} options.predictorRisk01   churnPredictor 的 risk/100；无数据传 null
 * @param {?string} options.maturityChurnLabel playerMaturity 的 churnRisk 标签；无数据传 null
 * @param {?number} options.commercialChurnRisk01 commercialModel.churnRisk；无数据传 null
 * @returns {{unifiedRisk:number, level:string, sources:Object}}
 */
export function getUnifiedChurnRisk({
    predictorRisk01 = null,
    maturityChurnLabel = null,
    commercialChurnRisk01 = null,
} = {}) {
    const sources = {
        predictor: Number.isFinite(predictorRisk01) ? _clamp01(predictorRisk01) : null,
        maturity: _maturityChurnTo01(maturityChurnLabel),
        commercial: Number.isFinite(commercialChurnRisk01) ? _clamp01(commercialChurnRisk01) : null,
    };

    let weightSum = 0;
    let valSum = 0;
    if (sources.predictor != null) {
        weightSum += _churnBlendWeights.predictor;
        valSum += sources.predictor * _churnBlendWeights.predictor;
    }
    if (sources.maturity != null) {
        weightSum += _churnBlendWeights.maturity;
        valSum += sources.maturity * _churnBlendWeights.maturity;
    }
    if (sources.commercial != null) {
        weightSum += _churnBlendWeights.commercial;
        valSum += sources.commercial * _churnBlendWeights.commercial;
    }

    const unifiedRisk = weightSum > 0 ? valSum / weightSum : 0;
    return {
        unifiedRisk: _clamp01(unifiedRisk),
        level: _churnLevelFromRisk(unifiedRisk),
        sources,
    };
}

/**
 * 把 lifecycleStageDetail 的 stage 字符串映射到 S0..S3+；S4 由
 * isWinbackCandidate（≥7 天未活跃）单独覆盖，与 getLifecycleMaturitySnapshot 一致。
 */
function _stageToCode(stageName) {
    return ({
        onboarding: 'S0',
        exploration: 'S1',
        growth: 'S2',
        stability: 'S3',
        veteran: 'S3+',
    })[stageName] || 'S0';
}

/**
 * 构建生命周期 / 成熟度的统一快照 —— 上层策略只需要从这一个对象取数。
 *
 * @param {import('../playerProfile.js').PlayerProfile} profile  实时玩家画像
 * @param {Object} [options]
 * @param {?number} [options.predictorRisk01]    可选：churnPredictor 已算好的 risk/100
 * @param {?number} [options.commercialChurnRisk01] 可选：commercialModel.churnRisk
 * @returns {UnifiedLifecycleSnapshot}
 */
export function getUnifiedLifecycleSnapshot(profile, options = {}) {
    const payload = profile?.lifecyclePayload ?? {
        daysSinceInstall: 0,
        totalSessions: 0,
        daysSinceLastActive: 0,
    };

    const stageDetail = getPlayerLifecycleStageDetail(payload);
    const lifecycleSnap = getLifecycleMaturitySnapshot(payload);
    const insights = getMaturityInsights();
    const winbackStatus = (() => {
        try { return getWinbackStatus(); } catch { return { active: false }; }
    })();

    return {
        schemaVersion: SCHEMA_VERSION,

        install: {
            daysSinceInstall: payload.daysSinceInstall,
            totalSessions: payload.totalSessions,
            totalPlacements: profile?.lifetimePlacements ?? 0,
            lastActiveTs: profile?.lastActiveTs ?? 0,
        },

        onboarding: {
            isNewPlayer: !!profile?.isNewPlayer,
            isInOnboarding: !!profile?.isInOnboarding,
            spawnRoundIndex: profile?.spawnRoundIndex ?? 0,
        },

        returning: {
            daysSinceLastActive: payload.daysSinceLastActive,
            warmupStrength: profile?.returningWarmupStrength ?? 0,
            isWinbackCandidate: evaluateWinbackTrigger(payload),
            protectionActive: !!winbackStatus?.active,
        },

        stage: {
            code: lifecycleSnap.stageCode || _stageToCode(stageDetail.stage),
            name: stageDetail.stage,
            confidence: stageDetail.confidence,
        },

        maturity: {
            level: insights.level || 'L1',
            band: lifecycleSnap.band || insights.band || 'M0',
            skillScore: insights.skillScore ?? 0,
            valueScore: insights.valueScore ?? 0,
        },

        churn: getUnifiedChurnRisk({
            predictorRisk01: options.predictorRisk01,
            maturityChurnLabel: insights.churnRisk,
            commercialChurnRisk01: options.commercialChurnRisk01,
        }),

        segment: {
            behaviorSegment: profile?.behaviorSegment ?? 'balanced',
            motivationIntent: profile?.motivationIntent ?? 'balanced',
            segment5: profile?.segment5 ?? 'A',
        },
    };
}

/**
 * 内部缓存：每帧只算一次，避免 adaptiveSpawn / strategyAdvisor / playerInsightPanel
 * 在同一渲染帧重复触发 getMaturityInsights → localStorage 读取。
 *
 * 缓存粒度 = (profile reference, options stringified)。300ms TTL 与玩家洞察面板
 * 节流刷新一致；retentionManager 在写入后会调 invalidate() 强制清缓存。
 */
const SNAPSHOT_CACHE_TTL_MS = 300;
let _cache = null;
let _cacheKey = null;
let _cacheTs = 0;

export function getCachedLifecycleSnapshot(profile, options = {}) {
    const key = `${profile?._installTs || 0}|${profile?._lastSessionEndTs || 0}|${profile?._totalLifetimeGames || 0}|${options.predictorRisk01 ?? ''}|${options.commercialChurnRisk01 ?? ''}`;
    const now = Date.now();
    if (_cache && _cacheKey === key && (now - _cacheTs) < SNAPSHOT_CACHE_TTL_MS) {
        return _cache;
    }
    _cache = getUnifiedLifecycleSnapshot(profile, options);
    _cacheKey = key;
    _cacheTs = now;
    return _cache;
}

/** 主动失效缓存（recordSessionEnd / activateWinback 后调用）。 */
export function invalidateLifecycleSnapshotCache() {
    _cache = null;
    _cacheKey = null;
    _cacheTs = 0;
}

export {
    SCHEMA_VERSION,
    CHURN_BLEND_WEIGHTS,
    CHURN_LEVEL_THRESHOLDS,
};
