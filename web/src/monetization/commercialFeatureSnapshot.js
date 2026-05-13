/**
 * commercialFeatureSnapshot.js — 商业化模型统一特征快照（Single Source of Truth）
 *
 * v1.49.x 算法层改造（snapshot）：
 *   解决 commercialModel / adInsertionRL / explorerPolicy / qualityMonitor 等模块
 *   各自从 personalization._state / getLTVEstimate / getAdFreqSnapshot 散读特征导致
 *   "训练-推理 skew"问题：离线训练时无法精确复现 ctx；任何字段名 / 默认值改动都
 *   可能在某个调用点漏掉。
 *
 * 本模块定义：
 *   1. `CommercialFeatureSchema` —— 字段集合 + 物理含义 + 取值范围 + 默认值
 *   2. `buildCommercialFeatureSnapshot(rawCtx)` —— 把任意来源的输入归一成一个不可变
 *      snapshot 对象（dict + array 两种视图均提供，array 视图用于 ML 训练管线）
 *   3. `featureSnapshotToVector(snapshot)` —— 输出 `Float32Array`（按 schema 顺序）
 *   4. `featureSnapshotDigest(snapshot)` —— 短哈希，用作 modelQualityMonitor 的 sample id
 *
 * 设计约束：
 *   - 纯函数：无 storage / 无网络 / 无 emit；上层负责注入数据。
 *   - 不可变：返回的 snapshot 通过 Object.freeze 防止下游误改。
 *   - Schema versioned：新增字段必须递增 SCHEMA_VERSION，方便日志归档。
 *   - 缺失字段使用 schema 默认值并记录在 `_missing` 列表，便于线上看"哪些信号在裸跑"。
 */

export const SCHEMA_VERSION = 1;

/** @typedef {{ key:string, kind:'persona'|'realtime'|'lifecycle'|'adFreq'|'ltv'|'ability'|'commercial', range:[number,number], default:number, desc:string }} FeatureSpec */

/** @type {FeatureSpec[]} 严格保持顺序——array 视图按此顺序输出。 */
export const FEATURE_SCHEMA = [
    /* persona — 来自服务端画像 / mon_model_config */
    { key: 'whaleScore',      kind: 'persona',   range: [0, 1], default: 0,    desc: '鲸鱼分（best_score×0.4 + total_games×0.3 + session_time×0.3）' },
    { key: 'activityScore',   kind: 'persona',   range: [0, 1], default: 0,    desc: '近 7 日活跃度评分' },
    { key: 'skillScore',      kind: 'persona',   range: [0, 1], default: 0,    desc: 'EMA 消行率（技能分代理）' },
    { key: 'frustrationAvg',  kind: 'persona',   range: [0, 1], default: 0,    desc: '历史平均挫败分（0..1）' },
    { key: 'nearMissRate',    kind: 'persona',   range: [0, 1], default: 0,    desc: '历史近失率' },

    /* realtime — 来自 PlayerProfile（每出块同步一次） */
    { key: 'frustration',     kind: 'realtime',  range: [0, 12], default: 0,   desc: '当前连续未消行次数（绝对值）' },
    { key: 'hadNearMiss',     kind: 'realtime',  range: [0, 1], default: 0,    desc: '本局是否触发过近失（0/1）' },
    { key: 'flowFlow',        kind: 'realtime',  range: [0, 1], default: 0,    desc: 'flow_state == "flow" one-hot' },
    { key: 'flowBored',       kind: 'realtime',  range: [0, 1], default: 0,    desc: 'flow_state == "bored" one-hot' },
    { key: 'flowAnxious',     kind: 'realtime',  range: [0, 1], default: 0,    desc: 'flow_state == "anxious" one-hot' },

    /* lifecycle — 来自 lifecycleSignals.UnifiedSnapshot */
    { key: 'daysSinceInstall',  kind: 'lifecycle', range: [0, 1], default: 0,  desc: 'min(daysSinceInstall, 90) / 90' },
    { key: 'totalSessions',     kind: 'lifecycle', range: [0, 1], default: 0,  desc: 'min(totalSessions, 200) / 200' },
    { key: 'daysSinceLastActive', kind: 'lifecycle', range: [0, 1], default: 0, desc: 'min(daysSinceLastActive, 14) / 14' },
    { key: 'isWinbackCandidate',  kind: 'lifecycle', range: [0, 1], default: 0, desc: '是否触发过真实 winback（≥7 天未活跃）' },

    /* adFreq — 来自 getAdFreqSnapshot */
    { key: 'rewardedToday',       kind: 'adFreq', range: [0, 1], default: 0,   desc: 'min(rewardedCount, 12) / 12' },
    { key: 'interstitialToday',   kind: 'adFreq', range: [0, 1], default: 0,   desc: 'min(interstitialCount, 6) / 6' },
    { key: 'experienceScore',     kind: 'adFreq', range: [0, 1], default: 1,   desc: '广告体验分 / 100' },
    { key: 'inRecoveryPeriod',    kind: 'adFreq', range: [0, 1], default: 0,   desc: '当前是否在 60s 冷却期' },

    /* ltv — 来自 ltvPredictor */
    { key: 'ltv30',               kind: 'ltv',     range: [0, 1], default: 0,  desc: 'ltv30 / 20（与 ltvNormMax 同步）' },
    { key: 'ltvConfidence',       kind: 'ltv',     range: [0, 1], default: 0,  desc: '0.9/0.6/0.25 三档（high/medium/low）' },

    /* ability — 来自 buildPlayerAbilityVector */
    { key: 'abilityBoardPlanning', kind: 'ability', range: [0, 1], default: 0.5, desc: '盘面规划能力' },
    { key: 'abilityConfidence',    kind: 'ability', range: [0, 1], default: 0.5, desc: '能力打分置信度' },
    { key: 'abilityClearEff',      kind: 'ability', range: [0, 1], default: 0.5, desc: '消行效率' },
    { key: 'abilityRiskLevel',     kind: 'ability', range: [0, 1], default: 0,   desc: '短期风险（死局接近度）' },
    { key: 'abilitySkillScore',    kind: 'ability', range: [0, 1], default: 0,   desc: '综合技能分（与 persona.skillScore 来源不同）' },

    /* commercial — 派生量（已经从其他特征算出来，但写入 snapshot 便于训练 / 监控复现） */
    { key: 'unifiedChurnRisk',     kind: 'commercial', range: [0, 1], default: 0, desc: '三腿投票后的统一流失风险（v1.49.x P0-2）' },
];

/** Schema 字段总数（snapshot.vector.length）。 */
export const FEATURE_SCHEMA_SIZE = FEATURE_SCHEMA.length;

/** 字典：key → FeatureSpec（O(1) 查找）。 */
const _SPEC_BY_KEY = Object.freeze(
    FEATURE_SCHEMA.reduce((acc, spec) => { acc[spec.key] = spec; return acc; }, {})
);

/** 简单 clamp 到 [lo, hi]。 */
function _clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

/**
 * 把 [min, max] 映射到 [0, 1]，min/max 不等时线性归一；range 为 [0,1] 时直接 clamp。
 * 这是 schema 规定的归一函数；任何下游模型（calibrator / MTL encoder / bandit）都从
 * 归一后的 vector 出发，避免重复实现。
 */
function _normalize(value, range) {
    const [lo, hi] = range;
    if (lo === 0 && hi === 1) return _clamp(value, 0, 1);
    const span = hi - lo;
    if (span <= 0) return 0;
    return _clamp((Number(value) - lo) / span, 0, 1);
}

/**
 * 构造特征快照。
 *
 * @param {Object} raw  原始上下文，常见字段：persona / realtime / lifecycle / adFreq / ltv / ability / commercial
 * @returns {Readonly<{
 *   schemaVersion: number,
 *   ts: number,
 *   features: Record<string, number>,   // dict 视图（推荐供推理使用）
 *   vector: number[],                    // 按 FEATURE_SCHEMA 顺序的 0..1 归一向量
 *   _missing: string[],                  // 哪些字段走了 default（线上观测信号缺失率）
 * }>}
 */
export function buildCommercialFeatureSnapshot(raw = {}) {
    const persona = raw.persona ?? {};
    const realtime = raw.realtime ?? {};
    const lifecycle = raw.lifecycle ?? {};
    const adFreq = raw.adFreq ?? {};
    const ltv = raw.ltv ?? {};
    const ability = raw.ability ?? {};
    const commercial = raw.commercial ?? {};

    /* flowState 是字符串，需要在写 schema 之前转成三路 one-hot。 */
    const flowState = realtime.flowState || persona.flowState || null;

    const lookup = {
        whaleScore:           persona.whaleScore,
        activityScore:        persona.activityScore,
        skillScore:           persona.skillScore ?? realtime.skill,
        frustrationAvg:       persona.frustrationAvg,
        nearMissRate:         persona.nearMissRate,

        frustration:          realtime.frustration,
        hadNearMiss:          realtime.hadNearMiss ? 1 : 0,
        flowFlow:             flowState === 'flow' ? 1 : 0,
        flowBored:            flowState === 'bored' ? 1 : 0,
        flowAnxious:          flowState === 'anxious' ? 1 : 0,

        daysSinceInstall:     lifecycle.daysSinceInstall,
        totalSessions:        lifecycle.totalSessions,
        daysSinceLastActive:  lifecycle.daysSinceLastActive,
        isWinbackCandidate:   lifecycle.isWinbackCandidate ? 1 : 0,

        rewardedToday:        adFreq.rewardedCount,
        interstitialToday:    adFreq.interstitialCount,
        experienceScore:      adFreq.experienceScore != null ? Number(adFreq.experienceScore) / 100 : null,
        inRecoveryPeriod:     adFreq.inRecoveryPeriod ? 1 : 0,

        ltv30:                ltv.ltv30,
        ltvConfidence:        typeof ltv.confidence === 'string'
            ? ({ high: 0.9, medium: 0.6, low: 0.25 }[ltv.confidence] ?? 0)
            : ltv.confidence,

        abilityBoardPlanning: ability.boardPlanning,
        abilityConfidence:    ability.confidence,
        abilityClearEff:      ability.clearEfficiency,
        abilityRiskLevel:     ability.riskLevel,
        abilitySkillScore:    ability.skillScore,

        unifiedChurnRisk:     commercial.unifiedChurnRisk ?? commercial.churnRisk,
    };

    /* 一些字段的"原始量纲"在 schema range 之外（例如 daysSinceInstall ∈ [0, ∞)），
     * range 在 schema 中已经写成 [0, 1] 的归一目标；下面按 spec 决定是直接 clamp
     * 还是先做物理归一再 clamp。 */
    const features = {};
    const missing = [];
    for (const spec of FEATURE_SCHEMA) {
        const raw = lookup[spec.key];
        const present = raw != null && raw !== '' && Number.isFinite(Number(raw));
        if (!present) {
            features[spec.key] = spec.default;
            missing.push(spec.key);
            continue;
        }
        /* 大量"绝对值字段"（frustration / daysSinceInstall / rewardedToday）需要先除以
         * 物理上限再 clamp 到 [0, 1]。 */
        if (spec.key === 'daysSinceInstall')    features[spec.key] = _clamp(Number(raw) / 90, 0, 1);
        else if (spec.key === 'totalSessions')  features[spec.key] = _clamp(Number(raw) / 200, 0, 1);
        else if (spec.key === 'daysSinceLastActive') features[spec.key] = _clamp(Number(raw) / 14, 0, 1);
        else if (spec.key === 'rewardedToday')  features[spec.key] = _clamp(Number(raw) / 12, 0, 1);
        else if (spec.key === 'interstitialToday') features[spec.key] = _clamp(Number(raw) / 6, 0, 1);
        else if (spec.key === 'frustration')    features[spec.key] = _clamp(Number(raw) / 12, 0, 1);
        else if (spec.key === 'ltv30')          features[spec.key] = _clamp(Number(raw) / 20, 0, 1);
        else features[spec.key] = _normalize(raw, spec.range);
    }

    const vector = FEATURE_SCHEMA.map((s) => features[s.key]);

    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        ts: Date.now(),
        features: Object.freeze(features),
        vector: Object.freeze(vector),
        _missing: Object.freeze(missing),
    });
}

/** 按 FEATURE_SCHEMA 顺序输出 Float32Array（训练 pipeline 用）。 */
export function featureSnapshotToVector(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.vector)) {
        return new Float32Array(FEATURE_SCHEMA_SIZE);
    }
    return Float32Array.from(snapshot.vector);
}

/** 32-bit FNV-1a 哈希，用作 sample id（足够区分单帧内的 snapshot）。 */
export function featureSnapshotDigest(snapshot) {
    const v = snapshot?.vector ?? [];
    let h = 2166136261 >>> 0;
    for (let i = 0; i < v.length; i++) {
        const x = Math.round(Number(v[i]) * 1e6) | 0;
        h = ((h ^ (x & 0xff)) * 16777619) >>> 0;
        h = ((h ^ ((x >> 8) & 0xff)) * 16777619) >>> 0;
        h = ((h ^ ((x >> 16) & 0xff)) * 16777619) >>> 0;
        h = ((h ^ ((x >> 24) & 0xff)) * 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** 按 key 读取 spec（供测试 / UI 工具）。 */
export function getFeatureSpec(key) {
    return _SPEC_BY_KEY[key] || null;
}
