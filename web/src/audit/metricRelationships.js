/**
 * metricRelationships.js — 玩家画像指标之间的"已知关系"知识表
 *
 * 用途：
 *   1. audit 的 REDUNDANT_METRIC_PAIRS action 排除"设计如此"的强相关 pair，避免误报
 *   2. UI 「指标详读」浮层可以显示"📎 派生自 X"提示，帮玩家/开发者理解信号源头
 *   3. 模型训练（如 spawnTransformerV3）可以据此做特征选择，避免共线性
 *
 * 数据来源：人工梳理 playerProfile.js / adaptiveSpawn.js 的实际计算依赖。
 * 新增/修改指标时记得回到这里同步关系，否则 audit 会把"预期相关"误报为冗余。
 */

/**
 * @typedef {Object} MetricRelation
 * @property {[string, string]} pair        两个指标 key（顺序无关）
 * @property {'fusion'|'derived'|'identity'|'correlated'} relation
 *   - fusion:     A 是 B 与其他信号的融合（如 skill = EMA(局内) + historicalSkill）
 *   - derived:    A 由 B 计算派生（如 boardRisk = f(fillRatio, holes, abilityRisk)）
 *   - identity:   A 与 B 表达同一概念的不同视角（如 frustration / longestNoClear）
 *   - correlated: A 与 B 设计上强相关但非派生（如 stress / cognitiveLoad）
 * @property {string} description           人类可读说明（UI / 文档可直接用）
 * @property {[number, number]} expectedAbsR 预期 |Pearson r| 范围；超出此范围才算异常
 * @property {boolean} auditExempt          true → audit 不要报为冗余对
 * @property {string} [source]              出处文件 / 模块
 */

/** @type {MetricRelation[]} */
export const METRIC_RELATIONSHIPS = [
    // ============== 能力维度 ==============
    {
        pair: ['skill', 'historicalSkill'],
        relation: 'fusion',
        description: 'skill 是 historicalSkill 跨局校准与本局即时 EMA 的融合结果；高度相关属预期',
        expectedAbsR: [0.60, 0.98],
        auditExempt: true,
        source: 'playerProfile.skillLevel',
    },
    {
        pair: ['clearRate', 'comboRate'],
        relation: 'correlated',
        description: '消行率与连消率都基于 _moves 滑窗的 cleared 事件统计，相互印证（comboRate ⊂ clearRate）',
        expectedAbsR: [0.50, 0.95],
        auditExempt: true,
        source: 'playerProfile.metrics',
    },

    // ============== 状态维度 ==============
    {
        pair: ['frustration', 'momentum'],
        relation: 'correlated',
        description: 'v1.62.5 起 momentum 在 frustration ≥3 时加负向 penalty，所以两者契约反向相关',
        expectedAbsR: [0.30, 0.85],
        auditExempt: false,   // 这条要报，且通过 frustration-vs-momentum 契约监控
        source: 'playerProfile.momentum（v1.62.5 修订）',
    },
    {
        pair: ['stress', 'cognitiveLoad'],
        relation: 'correlated',
        description: 'cognitiveLoad（thinkMs 方差）是 stress 的输入之一（flowDeviation 的 loadPressure 项），中度相关是预期',
        expectedAbsR: [0.30, 0.85],
        auditExempt: true,
        source: 'adaptiveSpawn.stressBreakdown.flowAdjust ← playerProfile.flowDeviation ← cognitiveLoad',
    },
    {
        pair: ['stress', 'flowDeviation'],
        relation: 'derived',
        description: 'flowAdjust（stress 分量之一）∝ flowDeviation，所以 stress 与 flowDeviation 中度相关',
        expectedAbsR: [0.30, 0.85],
        auditExempt: true,
        source: 'adaptiveSpawn.stressBreakdown.flowAdjust',
    },

    // ============== 盘面几何维度 ==============
    {
        pair: ['boardFill', 'topologyHoles'],
        relation: 'correlated',
        description: '高填充板面更容易出现空洞（统计意义上，但不严格）',
        expectedAbsR: [0.20, 0.80],
        auditExempt: false,   // 仍可报为冗余，提示"可能合并显示"
        source: 'grid.cells 同源计算',
    },
    {
        pair: ['firstMoveFreedom', 'tripletSolutionCount'],
        relation: 'correlated',
        description: '首手自由度低 → 三块解空间也窄，两者从不同角度刻画同一"机动性"',
        expectedAbsR: [0.40, 0.95],
        auditExempt: true,
        source: 'computeCandidatePlacementMetric',
    },
    {
        pair: ['boardFill', 'firstMoveFreedom'],
        relation: 'correlated',
        description: '满板面 → 首手自由度低（反向相关）',
        expectedAbsR: [0.40, 0.95],
        auditExempt: true,
        source: 'grid 同源',
    },

    // ============== stress 分量维度 ==============
    {
        pair: ['flowAdjust', 'flowDeviation'],
        relation: 'derived',
        description: 'flowAdjust = clip(flowDeviation × signedDirection)，定义上同向',
        expectedAbsR: [0.50, 1.00],
        auditExempt: true,
        source: 'adaptiveSpawn — 见 flowAdjust-tracks-flowDeviation 契约',
    },
    {
        pair: ['feedbackBias', 'stress'],
        relation: 'correlated',
        description: 'feedbackBias 是 stress 的一个分量；lag=3 步滞后相关，详见 feedbackBias-leads-stress 契约',
        expectedAbsR: [0.10, 0.80],
        auditExempt: true,
        source: 'adaptiveSpawn.stressBreakdown.feedbackBias',
    },
];

/**
 * 查询某 pair 是否在已知关系表里，返回关系条目（无则 null）。
 * 接受任意顺序的 (a, b)。
 */
export function findRelationship(a, b) {
    const sorted = [a, b].slice().sort();
    for (const rel of METRIC_RELATIONSHIPS) {
        const p = rel.pair.slice().sort();
        if (p[0] === sorted[0] && p[1] === sorted[1]) return rel;
    }
    return null;
}

/**
 * 判断某 pair 是否应该从 REDUNDANT_PAIR 报警中豁免。
 * 用于 audit 的 _shouldExemptRedundantPair 钩子。
 */
export function isRedundantPairExempt(a, b) {
    const rel = findRelationship(a, b);
    return !!(rel && rel.auditExempt);
}

/**
 * 给 UI「指标详读」浮层用：返回某指标的"派生关系"短句。
 *   - 如果某指标在多个关系里出现，按优先级 fusion > derived > identity > correlated 取一条
 */
export function describeMetricLineage(metricKey) {
    const matches = METRIC_RELATIONSHIPS.filter(
        (r) => r.pair[0] === metricKey || r.pair[1] === metricKey
    );
    if (matches.length === 0) return null;
    const order = { fusion: 0, derived: 1, identity: 2, correlated: 3 };
    matches.sort((a, b) => order[a.relation] - order[b.relation]);
    return matches[0];
}
