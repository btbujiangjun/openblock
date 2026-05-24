/**
 * profileAudit.js — 玩家画像指标自评估系统的"主入口"
 *
 * 输入：单局或多局回放 frames（即 `move_sequences.frames` 一致结构）
 *      ※ 也接受 `{ frames }` 列表（多局聚合）
 * 输出：结构化报告 + 优化建议 hints + 健康分
 *
 * 评估分四层（详见 docs/algorithms/PROFILE_AUDIT.md）：
 *   A. 单指标质量：覆盖率 / 冷启动占比 / 范围合规 / 跳变率 / 基础统计
 *   B. 指标对关系：Pearson / Spearman 相关，识别冗余对
 *   C. 时序行为：趋势 / 自相关 / 首次可信帧
 *   D. 自适应链路：stress 分解主导项 / 闭环反馈滞后相关 / spawnIntent 切换频率
 *
 * 设计原则：
 *   - 纯函数：不读取任何 DOM / 全局，可在 Web / Node / Worker 同源调用
 *   - 缺数据宽容：所有数学工具对 null / 空数组返回 null，模块按"无数据=跳过"处理
 *   - 报告结构稳定：字段命名稳定（profileAuditReport.schema = 1），便于离线比对与 UI 渲染
 *
 * 使用：
 *   import { auditProfile } from './audit/profileAudit.js';
 *   const report = auditProfile(frames);
 *   for (const h of report.hints) console.log(h.severity, h.code, h.msg);
 */

import {
    collectReplayMetricsSeries,
    REPLAY_METRICS,
} from '../moveSequence.js';
import {
    basicStats,
    jitterStats,
    autocorrelation,
    linearTrend,
    halvesMeanDiff,
    outOfRangeCount,
    pearson,
    spearman,
    laggedPearson,
} from './profileAuditMath.js';
import {
    applicableContracts,
} from './profileAuditContracts.js';
import { isRedundantPairExempt } from './metricRelationships.js';
import {
    buildHints,
    summarizeHealthScore,
} from './profileAuditHints.js';

/** 报告 schema 版本——结构变更时 bump，离线工具对照决定如何解析。 */
export const PROFILE_AUDIT_SCHEMA = 1;

/**
 * Audit 引擎版本：契约 / 范围阈值 / hint 规则 等任何"会改变 audit 判定结果"的逻辑
 * 修改时都要 bump 这个版本号。auto-audit 拉到旧版本报告时会提示"建议强制重跑"。
 *
 * 历史：
 *   v1.62.1 — stress-equals-sum-breakdown 改为自动求和 stressBreakdown 全字段；
 *             放宽 pacingAdjust / sessionArcAdjust 的 DEFAULT_RANGE
 *   v1.62.3 — 新增 spawn-intent-no-thrashing 契约；
 *             session-arc-warm-to-cool 加长 session / 持续救济豁免
 *   v1.62.4 — 报告嵌入 engineVersion 元数据，便于检测过期报告
 */
export const PROFILE_AUDIT_ENGINE_VERSION = '1.62.4';

/* ============================================================
 * 默认期望范围（用于"越界"判定）
 *
 * 这些范围是 REPLAY_METRICS.tooltip 与 adaptiveSpawn 注释里写明的约定，
 * 集中在这里方便审计与扩展。新指标若有强范围约束建议补充进来。
 * ============================================================ */
const DEFAULT_RANGE_BY_KEY = {
    score: { min: 0 },
    skill: { min: 0, max: 1 },
    boardFill: { min: 0, max: 1 },
    clearRate: { min: 0, max: 1 },
    cognitiveLoad: { min: 0, max: 1 },
    missRate: { min: 0, max: 1 },
    stress: { min: 0, max: 1 },          // v1.55.17 归一化
    flowDeviation: { min: 0, max: 2 },   // 偏移上界稍宽
    momentum: { min: -1, max: 1 },
    frustration: { min: 0 },
    feedbackBias: { min: -0.3, max: 0.3 },
    difficultyBias: { min: -0.5, max: 0.5 },
    flowAdjust: { min: -0.3, max: 0.3 },
    reactionAdjust: { min: -0.1, max: 0.1 },
    /* v1.62.1：之前设的 ±0.10 与 adaptiveSpawn 实际不符——
     *   release 期 pacingAdjust = pacing.releaseBonus ?? -0.12（默认就超阈值）
     *   配置可调到更大幅度（如 -0.18）；放宽到 ±0.20 涵盖正常配置上限。
     * 真要发现"实际计算异常飙到 0.30+"再触发越界 hint。 */
    pacingAdjust: { min: -0.2, max: 0.2 },
    friendlyBoardRelief: { min: -0.3, max: 0.1 },
    /* v1.62.1：sessionArcAdjust 在长 session / 后置 lifecycleCapAdjust 作用下可能
     * 突破 ±0.15，放宽到 ±0.25。 */
    sessionArcAdjust: { min: -0.25, max: 0.25 },
    challengeBoost: { min: 0, max: 0.2 },
    thinkMs: { min: 0 },
    pickToPlaceMs: { min: 0 },
    topologyHoles: { min: 0 },
    flatness: { min: 0, max: 1 },
    firstMoveFreedom: { min: 0 },
    tripletSolutionCount: { min: 0 },
};

/* ============================================================
 * 内部工具
 * ============================================================ */

/**
 * 从 frames 抽 stressBreakdown 全字段，按帧求和成时间序列。
 *
 * 设计动机（v1.62.1）：
 *   早期契约硬编码 7 项 stressBreakdown 分量求和，但 adaptiveSpawn.js 实际有 24+ 项，
 *   契约永远残差 0.4+。改为"自动抽全字段"后，代码加新分量时契约自动跟上，
 *   不会再出现"契约滞后于代码"的 false-positive。
 *
 * 与 adaptiveSpawn._SUM_SKIP 对齐排除：
 *   - boardRisk     独立分支（不参与 stress 加和，单独传 spawnTargets）
 *   - bottleneckTrough / bottleneckSamples  v1.30 派生痕迹（不参与求和）
 *
 * @returns {number[]} length = totalFrames；某帧无 stressBreakdown → NaN
 */
const _STRESS_BREAKDOWN_SKIP = new Set([
    /* 与 adaptiveSpawn._SUM_SKIP 一致 */
    'boardRisk', 'bottleneckTrough', 'bottleneckSamples',
    /* rawStress 是"Σ(其他非 SKIP 字段) 自己的快照"——不能再加进求和，否则双倍计数。 */
    'rawStress',
    /* v1.62.7（关键修复）：以下 9 个字段是 adaptiveSpawn 在 rawStress 赋值"之后"才写入
     * stressBreakdown 的"后置调制审计字段"——它们已经被反映在最终 stress 里，但**不参与
     * rawStress 求和**。之前 v1.62.6 漏排除这些字段，导致 audit Σ = rawStress + 后置 adjust，
     * 必然 ≠ rawStress，契约 100% 失败。 */
    'lifecycleCapAdjust', 'lifecycleBandAdjust', 'lifecycleStressAdjust',
    'onboardingStressOverrideAdjust', 'winbackStressCapAdjust',
    'clampAdjust', 'smoothingAdjust', 'minStressFloorAdjust', 'flowPayoffCapAdjust',
    /* 元信息（非数字字段） */
    'lifecycleStage', 'lifecycleBand',
]);

function _sumStressBreakdownPerFrame(frames) {
    const totalFrames = Array.isArray(frames) ? frames.length : 0;
    const out = new Array(totalFrames).fill(NaN);
    for (let i = 0; i < totalFrames; i++) {
        const br = frames[i]?.ps?.adaptive?.stressBreakdown;
        if (!br || typeof br !== 'object') continue;
        let s = 0;
        let any = false;
        for (const [k, v] of Object.entries(br)) {
            if (_STRESS_BREAKDOWN_SKIP.has(k)) continue;
            const n = Number(v);
            if (Number.isFinite(n)) { s += n; any = true; }
        }
        if (any) out[i] = s;
    }
    return out;
}

/**
 * 抽 rawStress 序列（v1.62.6）。
 *
 * 物理意义：`stressBreakdown.rawStress = Σ(stressBreakdown.* 非 SKIP)`，
 * 即 adaptiveSpawn 后置 clamp/normalize 之前的累计 stress。
 *
 * 顶层 `stress` 是 `clamp(rawStress, 0, 1)`（且可能再被 normalizeStress 归一），
 * 所以 `stress ≈ Σ` 在数学上**不成立**——之前 v1.62.1 契约对真实数据残差 7+ 完全无意义。
 * v1.62.6 契约改为对比 `rawStress vs Σ`，物理正确，预期残差近 0。
 *
 * @returns {number[]} length = totalFrames；某帧无 rawStress → NaN
 */
function _rawStressPerFrame(frames) {
    const totalFrames = Array.isArray(frames) ? frames.length : 0;
    const out = new Array(totalFrames).fill(NaN);
    for (let i = 0; i < totalFrames; i++) {
        const v = Number(frames[i]?.ps?.adaptive?.stressBreakdown?.rawStress);
        if (Number.isFinite(v)) out[i] = v;
    }
    return out;
}

/**
 * 抽 spawnIntent 序列（v1.62.3+：供 spawn-intent-no-thrashing 契约消费）。
 * 优先取 ps.adaptive.spawnHints.spawnIntent，fallback 到 ps.adaptive.spawnIntent。
 *
 * @returns {Array<string|null>} 每帧的 intent 字符串；缺失为 null
 */
function _spawnIntentPerFrame(frames) {
    const totalFrames = Array.isArray(frames) ? frames.length : 0;
    const out = new Array(totalFrames).fill(null);
    for (let i = 0; i < totalFrames; i++) {
        const a = frames[i]?.ps?.adaptive;
        const intent = a?.spawnHints?.spawnIntent ?? a?.spawnIntent ?? null;
        if (intent != null) out[i] = String(intent);
    }
    return out;
}

/**
 * 探测"持续救济期"窗口：连续 N 帧 friendlyBoardRelief / recoveryAdjust / frustrationRelief
 * 三者之一显著为负（≤ -0.03）。用于 session-arc 等契约豁免——救济期间 sessionArc 不会
 * 形成"开头负 → 中段正 → 收官略负"的标准半圆弧（peak 会被持续救济压住）。
 *
 * @returns {{ count: number, ratio: number }}
 */
function _countSustainedReliefFrames(frames) {
    const N = Array.isArray(frames) ? frames.length : 0;
    if (N === 0) return { count: 0, ratio: 0 };
    let reliefCount = 0;
    for (const f of frames) {
        const br = f?.ps?.adaptive?.stressBreakdown;
        if (!br || typeof br !== 'object') continue;
        const triggered =
            (Number(br.friendlyBoardRelief) || 0) <= -0.03 ||
            (Number(br.recoveryAdjust) || 0) <= -0.05 ||
            (Number(br.frustrationRelief) || 0) <= -0.05 ||
            (Number(br.nearMissAdjust) || 0) <= -0.03;
        if (triggered) reliefCount++;
    }
    return { count: reliefCount, ratio: reliefCount / N };
}

/** 把 collectReplayMetricsSeries 的输出（按 idx 稀疏 points）展平为按 idx 密致的 number[] 数组（缺失=NaN）。 */
function _densifySeries(seriesObj, totalFrames) {
    /** @type {Record<string, number[]>} */
    const out = {};
    for (const m of REPLAY_METRICS) {
        const s = seriesObj?.[m.key];
        if (!s || !Array.isArray(s.points)) {
            out[m.key] = [];
            continue;
        }
        const arr = new Array(totalFrames).fill(NaN);
        for (const p of s.points) {
            if (Number.isFinite(p.idx) && Number.isFinite(p.value)) {
                arr[p.idx] = Number(p.value);
            }
        }
        out[m.key] = arr;
    }
    return out;
}

/** 冷启动帧数：与 buildReplayAnalysis 同款启发判定，避免审计与回放分析口径分裂。 */
function _coldFrameCount(frames) {
    if (!Array.isArray(frames) || frames.length === 0) return 0;
    let n = 0;
    for (const f of frames) {
        const ps = f?.ps;
        if (!ps) continue;
        if (ps.coldStart === true) { n++; continue; }
        const s = Number(ps.metrics?.samples);
        if (Number.isFinite(s) && s === 0) { n++; continue; }
        // pv=1 老记录：metrics.thinkMs=3000 && clearRate=0.3 启发式
        if (ps.metrics?.thinkMs === 3000 && ps.metrics?.clearRate === 0.3) { n++; }
    }
    return n;
}

/** spawnIntent 切换次数（从 ps.adaptive.spawnHints.spawnIntent 取，缺失则尝试 ps.adaptive.spawnIntent）。 */
function _countSpawnIntentSwitches(frames) {
    let prev = null;
    let switches = 0;
    for (const f of frames || []) {
        const intent = f?.ps?.adaptive?.spawnHints?.spawnIntent
            ?? f?.ps?.adaptive?.spawnIntent
            ?? null;
        if (intent == null) continue;
        if (prev != null && intent !== prev) switches++;
        prev = intent;
    }
    return switches;
}

/** 找 stress 分量中绝对贡献占比最大的 key（衡量"自适应是否退化为单一信号驱动"）。 */
function _stressDominator(densified) {
    const KEYS = [
        'difficultyBias',
        'flowAdjust',
        'reactionAdjust',
        'pacingAdjust',
        'friendlyBoardRelief',
        'sessionArcAdjust',
        'challengeBoost',
    ];
    const sumAbsByKey = {};
    let totalAbs = 0;
    for (const k of KEYS) {
        const arr = densified[k] || [];
        let s = 0;
        for (const v of arr) {
            if (Number.isFinite(v)) s += Math.abs(v);
        }
        sumAbsByKey[k] = s;
        totalAbs += s;
    }
    if (totalAbs === 0) return { key: null, shareOfAbs: null, breakdown: sumAbsByKey };
    let bestKey = null;
    let bestVal = -1;
    for (const k of KEYS) {
        if (sumAbsByKey[k] > bestVal) {
            bestVal = sumAbsByKey[k];
            bestKey = k;
        }
    }
    return {
        key: bestKey,
        shareOfAbs: bestVal / totalAbs,
        breakdown: sumAbsByKey,
    };
}

/** 默认选择参与"两两相关"扫描的指标白名单（避免 24×24 对 = 276 对噪声）。 */
const PAIR_SCAN_KEYS_DEFAULT = [
    'score', 'skill', 'boardFill', 'clearRate', 'missRate',
    'stress', 'flowDeviation', 'momentum', 'frustration', 'cognitiveLoad',
    'thinkMs', 'pickToPlaceMs', 'feedbackBias',
    'topologyHoles', 'flatness', 'firstMoveFreedom',
];

/* ============================================================
 * 主入口
 * ============================================================ */

/**
 * 评估一局或多局回放，输出结构化报告 + 优化建议。
 *
 * @param {Array<object>|{ frames: Array<object> }|Array<{ frames: Array<object> }>} input
 *        - 单局：frames 数组（每元素是一个 frame）
 *        - 包装：{ frames }
 *        - 多局：[{ frames }, { frames }, ...]
 * @param {{
 *   pairScanKeys?: string[],
 *   ranges?: Record<string, { min?: number, max?: number }>,
 *   thresholds?: object,
 *   contracts?: import('./profileAuditContracts.js').ProfileContract[],
 *   baseline?: Array<object>|{ frames: Array<object> }|Array<{ frames: Array<object> }>,
 *     当传入 baseline 时，会对 baseline 也跑一遍 audit，并在报告里多挂一个
 *     `comparison` 字段：契约/指标覆盖率/链路 的 current vs baseline 对比，
 *     同时追加 REGRESSION_* / IMPROVEMENT_* hints。用于灰度 release 前的回归卡口。
 * }} [opts]
 * @returns {object} 报告对象
 */
export function auditProfile(input, opts = {}) {
    /* 核心评估：抽成独立闭包，baseline 对照模式下同一套逻辑也跑一遍 baseline，
     * 不要 copy/paste 的二次实现。 */
    const buildReport = (rawInput) => _runSingleAudit(rawInput, opts);
    const report = buildReport(input);

    if (opts.baseline != null) {
        const baselineReport = buildReport(opts.baseline);
        const comparison = _compareReports(report, baselineReport);
        const extraHints = _buildComparisonHints(comparison);
        report.comparison = comparison;
        report.baselineHealthScore = baselineReport.healthScore;
        report.hints = _mergeAndSortHints([...report.hints, ...extraHints]);
        // 重算 healthScore（把 regression hint 也算进扣分）
        report.healthScore = summarizeHealthScore(report.hints);
    }

    return report;
}

/**
 * 单次 audit（不含 baseline 对照）。封装为独立函数，供主入口与对照分析两路复用。
 *
 * @param {*} input
 * @param {object} opts
 */
function _runSingleAudit(input, opts) {
    const sessionFramesList = _normalizeInput(input);
    const sessionsCount = sessionFramesList.length;

    /* 多局聚合的语义：每局独立 audit 完，把"指标 densified 数组"按 idx 拼接，
     * 用于跨局看冗余/契约/链路（注意趋势/自相关跨局拼接的语义需谨慎使用）。
     * 单局是 1 元素，等价于不聚合。 */
    const merged = _mergeSessions(sessionFramesList);
    const { densified, totalFrames, allFrames } = merged;

    /* v1.62.1：把"全 stressBreakdown 字段按帧求和"作为特殊 series 注入 densified，
     * 供 stress-equals-sum-breakdown 契约直接对比，避免硬编码字段名导致的契约滞后。 */
    densified.__stressBreakdownTotal = _sumStressBreakdownPerFrame(allFrames);

    /* v1.62.6：把 stressBreakdown.rawStress 单独抽出，供契约对比 rawStress vs Σ
     * （而不是错误地对比顶层 stress vs Σ——stress = clamp(rawStress) 不是 = Σ）。 */
    densified.__rawStressSeries = _rawStressPerFrame(allFrames);

    /* v1.62.3：把每帧 spawnIntent 字符串序列也挂为特殊 series，
     * 供 spawn-intent-no-thrashing 契约直接消费。 */
    densified.__spawnIntentSeries = _spawnIntentPerFrame(allFrames);

    /* v1.62.3：探测"持续救济期"占比，供 session-arc-warm-to-cool 契约做豁免判定。
     * 救济期间 sessionArc 不会形成标准半圆弧（peak 会被持续压住），不应误报。 */
    const reliefStats = _countSustainedReliefFrames(allFrames);
    densified.__sustainedReliefRatio = [reliefStats.ratio];
    densified.__sessionLength = [allFrames.length];

    /* ----- A. 单指标质量 ----- */
    const metrics = {};
    for (const m of REPLAY_METRICS) {
        const arr = densified[m.key] || [];
        const finite = arr.filter(Number.isFinite);
        const count = finite.length;
        const coverage = totalFrames > 0 ? count / totalFrames : 0;
        const range = (opts.ranges?.[m.key]) ?? DEFAULT_RANGE_BY_KEY[m.key] ?? null;
        const oor = range ? outOfRangeCount(arr, range) : { count: 0, firstIdx: null };
        metrics[m.key] = {
            key: m.key,
            label: m.label,
            group: m.group,
            count,
            coverage,
            stats: basicStats(finite),
            jitter: jitterStats(finite),
            trendSlope: linearTrend(finite).slope,
            trendHalvesDiff: halvesMeanDiff(finite),
            autocorrLag1: autocorrelation(finite, 1),
            outOfRange: oor,
            range,
        };
    }

    /* ----- B. 指标对关系（白名单内两两相关） -----
     * 低方差序列（≈常量）跳过：信息量太低，相关性数学上无意义，且容易因浮点误差被误算成 ±1。
     * 通过 metrics.stats.stddev 直接读，与 A 层口径保持一致。 */
    const LOW_VARIANCE_THRESHOLD = 1e-6;
    const isLowVar = (key) => {
        const s = metrics[key]?.stats?.stddev;
        return s == null || s < LOW_VARIANCE_THRESHOLD;
    };
    const pairKeys = opts.pairScanKeys ?? PAIR_SCAN_KEYS_DEFAULT;
    const pairs = [];
    const skippedPairs = [];
    for (let i = 0; i < pairKeys.length; i++) {
        for (let j = i + 1; j < pairKeys.length; j++) {
            const a = pairKeys[i];
            const b = pairKeys[j];
            if (isLowVar(a) || isLowVar(b)) {
                skippedPairs.push({ a, b, reason: 'low-variance' });
                continue;
            }
            const { r, n: pn } = pearson(densified[a] || [], densified[b] || []);
            if (r == null || pn < 5) continue;
            const { rho } = spearman(densified[a] || [], densified[b] || []);
            pairs.push({ a, b, pearson: r, spearman: rho, n: pn });
        }
    }
    // 按 |r| 降序，方便扫"最强相关 / 最强冗余"
    pairs.sort((x, y) => Math.abs(y.pearson || 0) - Math.abs(x.pearson || 0));

    /* ----- C. 契约 ----- */
    const contractList = opts.contracts ?? applicableContracts(densified);
    const contracts = [];
    for (const c of contractList) {
        const r = c.eval(densified);
        contracts.push({
            id: c.id,
            desc: c.desc,
            source: c.source,
            metrics: c.metrics,
            passed: !!r.passed,
            evidence: r.evidence,
            reason: r.reason,
            details: r.details,
        });
    }

    /* ----- D. 自适应链路 ----- */
    const stressDom = _stressDominator(densified);
    const intentSwitches = _countSpawnIntentSwitches(allFrames);
    const feedbackHasData = (densified.feedbackBias || []).some(Number.isFinite);
    const { r: feedbackLagCorr } = feedbackHasData
        ? laggedPearson(densified.feedbackBias || [], densified.stress || [], 3)
        : { r: null };

    /* v1.62.5（优化建议 #6）：画像稳定性 meta 指标 —— 让"画像系统自身是否健康输出稳定"
     * 也成为可观测信号。这些指标都是从其他维度派生的统计量，不需要额外采样成本。
     *
     *   intentStability   ∈ [0,1]：1 = spawnIntent 整局不切；0 = 每帧都切
     *   stressBalance     ∈ [0,1]：1 = 各 stress 分量贡献均衡；0 = 单分量 100% 主导
     *   signalConsistency ∈ [0,1]：契约通过率
     */
    const passedContractsLocal = contracts.filter((c) => c.passed).length;
    const failedContractsLocal = contracts.filter((c) => !c.passed).length;
    const contractsTotal = passedContractsLocal + failedContractsLocal;
    const intentStability = totalFrames > 0
        ? Math.max(0, Math.min(1, 1 - intentSwitches / Math.max(1, totalFrames - 1)))
        : 1;
    const stressBalance = stressDom.shareOfAbs != null
        ? Math.max(0, Math.min(1, 1 - stressDom.shareOfAbs))
        : null;
    const signalConsistency = contractsTotal > 0
        ? passedContractsLocal / contractsTotal
        : 1;
    const profileMeta = { intentStability, stressBalance, signalConsistency };

    const linkages = {
        stressDominator: stressDom,
        intentSwitches,
        feedbackHasData,
        feedbackLagCorr,
        profileMeta,    // v1.62.5
    };

    /* ----- 全局摘要 ----- */
    const coldFrames = sessionFramesList.reduce((sum, fs) => sum + _coldFrameCount(fs), 0);
    const coldFramesRatio = totalFrames > 0 ? coldFrames / totalFrames : null;

    const summary = {
        totalFrames,
        sessionsCount,
        passedContracts: contracts.filter((c) => c.passed).length,
        failedContracts: contracts.filter((c) => !c.passed).length,
        coldFrames,
        coldFramesRatio,
        skippedPairsLowVar: skippedPairs.length,
    };

    /* ----- Hints + 健康分 ----- */
    const audit = { metrics, pairs, contracts, linkages, summary };
    const hints = buildHints(audit, { thresholds: opts.thresholds });
    const healthScore = summarizeHealthScore(hints);

    return {
        schema: PROFILE_AUDIT_SCHEMA,
        engineVersion: PROFILE_AUDIT_ENGINE_VERSION,    // v1.62.4：让 auto-audit 能识别旧报告
        generatedAt: Date.now(),
        ...audit,
        hints,
        healthScore,
    };
}

/* ============================================================
 * Normalize / Merge 帮助函数
 * ============================================================ */

function _normalizeInput(input) {
    if (input == null) return [];
    if (Array.isArray(input)) {
        // 多局：[{frames}, ...] 或单局：[frame, ...]
        if (input.length === 0) return [];
        const first = input[0];
        if (first && typeof first === 'object' && Array.isArray(first.frames)) {
            return input.map((s) => Array.isArray(s.frames) ? s.frames : []).filter((fs) => fs.length > 0);
        }
        // 单局（frame 数组）
        return [input];
    }
    if (typeof input === 'object' && Array.isArray(input.frames)) {
        return [input.frames];
    }
    return [];
}

/**
 * 把多局 frames 各自 densify 后按 idx 拼接（每局首尾相连），返回合并 series + 帧总数。
 *
 * 多局拼接的注意：
 *   - 趋势/自相关在跨局边界会有跳变，结果偏保守，不会误报"违反单调契约"（因为契约只检查
 *     绝对差/反向比例等局部指标，跨局拼接对其影响有限）。
 *   - 多局 audit 主要用于跨局看「冗余/契约通过率/链路主导项」等结构信号。
 */
function _mergeSessions(sessionFramesList) {
    const allFrames = [];
    for (const fs of sessionFramesList) allFrames.push(...fs);
    const data = collectReplayMetricsSeries(allFrames);
    const totalFrames = data?.totalFrames ?? allFrames.length;
    const densified = data ? _densifySeries(data.series, totalFrames) : {};
    return { densified, totalFrames, allFrames };
}

/* ============================================================
 * Baseline 对照分析（v1.62 +）
 * ============================================================
 *
 * 输入：current report + baseline report（两份独立的 auditProfile() 输出）
 * 输出：
 *   - comparison：契约/指标覆盖率/链路 的 current vs baseline 差异
 *   - 衍生 hint：REGRESSION_* / IMPROVEMENT_* / COVERAGE_REGRESSION / HEALTH_SCORE_REGRESSION
 *
 * 使用场景：
 *   1. 灰度 release 前的回归卡口：旧版本对一段真实回放跑一次 audit 当 baseline，
 *      新版本同一段回放再跑一次，若 comparison 里出现 regressedContracts → 阻止发布。
 *   2. 实验组 vs 对照组：A/B 测试两个版本各自的 frames，看哪些契约稳定通过、哪些抖。
 * ============================================================ */

const COVERAGE_REGRESSION_PP = 0.15;          // 覆盖率下降 ≥ 15 个百分点 → 警告
const HEALTH_SCORE_REGRESSION_DELTA = 10;     // 健康分下降 ≥ 10 → 错误

function _compareReports(current, baseline) {
    const cMetrics = current.metrics || {};
    const bMetrics = baseline.metrics || {};
    const cContracts = new Map((current.contracts || []).map((c) => [c.id, c]));
    const bContracts = new Map((baseline.contracts || []).map((c) => [c.id, c]));

    /* ---- 契约对比 ---- */
    const contractDelta = [];
    const allContractIds = new Set([...cContracts.keys(), ...bContracts.keys()]);
    for (const id of allContractIds) {
        const c = cContracts.get(id);
        const b = bContracts.get(id);
        const cPassed = c ? !!c.passed : null;
        const bPassed = b ? !!b.passed : null;
        contractDelta.push({
            id,
            desc: c?.desc ?? b?.desc ?? '',
            metrics: c?.metrics ?? b?.metrics ?? [],
            currentPassed: cPassed,
            baselinePassed: bPassed,
            regressed: bPassed === true && cPassed === false,
            improved: bPassed === false && cPassed === true,
            currentEvidence: c?.evidence ?? null,
            baselineEvidence: b?.evidence ?? null,
        });
    }
    contractDelta.sort((a, b) => {
        // 回归排最前 → 改善 → 同状态；id 字母序兜底
        const ra = a.regressed ? 0 : (a.improved ? 2 : 1);
        const rb = b.regressed ? 0 : (b.improved ? 2 : 1);
        if (ra !== rb) return ra - rb;
        return String(a.id).localeCompare(String(b.id));
    });

    /* ---- 指标覆盖率对比 ---- */
    const coverageDelta = {};
    const allKeys = new Set([...Object.keys(cMetrics), ...Object.keys(bMetrics)]);
    for (const k of allKeys) {
        const cc = cMetrics[k]?.coverage ?? null;
        const bc = bMetrics[k]?.coverage ?? null;
        coverageDelta[k] = {
            current: cc,
            baseline: bc,
            delta: (cc != null && bc != null) ? cc - bc : null,
        };
    }

    /* ---- 链路对比 ---- */
    const cLink = current.linkages || {};
    const bLink = baseline.linkages || {};
    const linkages = {
        stressDominatorChanged:
            cLink.stressDominator?.key != null
            && bLink.stressDominator?.key != null
            && cLink.stressDominator.key !== bLink.stressDominator.key,
        stressDominator: {
            current: cLink.stressDominator?.key ?? null,
            baseline: bLink.stressDominator?.key ?? null,
        },
        intentSwitchesDelta:
            (cLink.intentSwitches ?? null) != null && (bLink.intentSwitches ?? null) != null
                ? cLink.intentSwitches - bLink.intentSwitches : null,
        feedbackLagCorrDelta:
            (cLink.feedbackLagCorr ?? null) != null && (bLink.feedbackLagCorr ?? null) != null
                ? cLink.feedbackLagCorr - bLink.feedbackLagCorr : null,
    };

    return {
        healthScoreDelta: current.healthScore - baseline.healthScore,
        contracts: contractDelta,
        coverage: coverageDelta,
        linkages,
        baselineSummary: {
            totalFrames: baseline.summary?.totalFrames ?? null,
            passedContracts: baseline.summary?.passedContracts ?? null,
            failedContracts: baseline.summary?.failedContracts ?? null,
        },
    };
}

function _buildComparisonHints(comparison) {
    const hints = [];

    /* 1) 契约回归（最严重） */
    for (const c of comparison.contracts) {
        if (c.regressed) {
            hints.push({
                severity: 'error',
                code: 'REGRESSION_CONTRACT',
                contract: c.id,
                metrics: c.metrics,
                evidence: { current: c.currentEvidence, baseline: c.baselineEvidence },
                msg: `回归：契约「${c.desc}」从 baseline 的通过变为当前失败——建议立即阻断发布并定位变更点`,
            });
        } else if (c.improved) {
            hints.push({
                severity: 'info',
                code: 'IMPROVEMENT_CONTRACT',
                contract: c.id,
                metrics: c.metrics,
                evidence: { current: c.currentEvidence, baseline: c.baselineEvidence },
                msg: `改善：契约「${c.desc}」从 baseline 失败转为通过——可作为本次变更的正向证据`,
            });
        }
    }

    /* 2) 覆盖率回归 */
    for (const [k, v] of Object.entries(comparison.coverage)) {
        if (v.delta != null && v.delta <= -COVERAGE_REGRESSION_PP) {
            hints.push({
                severity: 'warn',
                code: 'COVERAGE_REGRESSION',
                metrics: [k],
                evidence: v,
                msg: `「${k}」覆盖率从 ${(v.baseline * 100).toFixed(0)}% 降至 ${(v.current * 100).toFixed(0)}%（−${(-v.delta * 100).toFixed(0)} pp）——检查 PS 写入时机或冷启动门限是否被收紧`,
            });
        }
    }

    /* 3) 健康分回归（合成指标，阈值 -10） */
    if (comparison.healthScoreDelta <= -HEALTH_SCORE_REGRESSION_DELTA) {
        hints.push({
            severity: 'error',
            code: 'HEALTH_SCORE_REGRESSION',
            evidence: comparison.healthScoreDelta,
            msg: `健康分较 baseline 下降 ${(-comparison.healthScoreDelta).toFixed(0)} 分——多项指标同时退化，建议回滚或挂起灰度`,
        });
    }

    /* 4) stress 主导分量切换（信息层） */
    if (comparison.linkages.stressDominatorChanged) {
        hints.push({
            severity: 'info',
            code: 'STRESS_DOMINATOR_CHANGED',
            evidence: comparison.linkages.stressDominator,
            msg: `stress 主导分量从「${comparison.linkages.stressDominator.baseline}」切换为「${comparison.linkages.stressDominator.current}」——若是预期内的调参可忽略，否则定位为何主导项变了`,
        });
    }

    return hints;
}

/** 与 buildHints 同款排序：error > warn > info，同级 code 字母序，便于稳定 diff。 */
function _mergeAndSortHints(all) {
    const sevOrder = { error: 0, warn: 1, info: 2 };
    return all.slice().sort((a, b) => {
        const s = sevOrder[a.severity] - sevOrder[b.severity];
        if (s !== 0) return s;
        return String(a.code).localeCompare(String(b.code));
    });
}

/* ============================================================
 * 批量聚合（aggregateAuditReports）
 * ============================================================
 *
 * 输入：一组 audit 报告 [report1, report2, ...]（通常来自 SQLite 近 N 天扫描）
 * 输出：跨局聚合指标
 *   - sessionsCount / framesTotal
 *   - healthScore 分布（min/p10/median/p90/max + mean）
 *   - contractStats：每条契约的"出现局数 / 违规局数 / 违规率"，按违规率降序
 *   - hintCounts：按 code 聚合的出现次数（含每个 code 的最大严重度）
 *   - stressDominatorCounts：哪个分量在多少局被识别为主导项
 *   - topRegressions：跨局看哪些契约最容易出问题（违规率 ≥ 25%）
 *
 * 这是"指标体系的体检日报"——离线管线/CI 每天扫一次，把高违规率契约推到团队 Slack/issue。
 * ============================================================ */

/**
 * @param {Array<{ sessionId?: number, report: object }>|Array<object>} reports
 *        每元素可以是 audit report，也可以是 { sessionId, report }
 * @returns {object} 聚合报告
 */
export function aggregateAuditReports(reports) {
    if (!Array.isArray(reports) || reports.length === 0) {
        return {
            schema: PROFILE_AUDIT_SCHEMA,
            engineVersion: PROFILE_AUDIT_ENGINE_VERSION,
            sessionsCount: 0,
            framesTotal: 0,
            healthScore: null,
            contractStats: [],
            hintCounts: [],
            stressDominatorCounts: [],
            topRegressions: [],
            engineVersionStats: { current: PROFILE_AUDIT_ENGINE_VERSION, mismatchCount: 0, perVersion: {} },
            redundantPairTop: [],
        };
    }

    const items = reports.map((r) => r?.report ? r : { sessionId: null, report: r });
    const sessionsCount = items.length;
    let framesTotal = 0;

    /** @type {Map<string, { id:string, desc:string, appeared:number, failed:number }>} */
    const contractStats = new Map();
    /** @type {Map<string, { code:string, count:number, severity:string }>} */
    const hintCounts = new Map();
    /** @type {Map<string, number>} */
    const stressDominatorCounts = new Map();
    /** @type {number[]} */
    const healthScores = [];
    /** @type {Map<string, number>} */
    const versionCounts = new Map();
    /** @type {Map<string, { a:string, b:string, count:number, pearsons:number[] }>} */
    const redundantPairCounts = new Map();

    const sevOrder = { error: 0, warn: 1, info: 2 };
    const stronger = (a, b) => sevOrder[a] <= sevOrder[b] ? a : b;

    for (const { report } of items) {
        if (!report) continue;
        framesTotal += Number(report.summary?.totalFrames) || 0;
        if (Number.isFinite(report.healthScore)) healthScores.push(Number(report.healthScore));

        // v1.62.4：记录每份报告的 engineVersion，让 UI 能提示"这局是旧规则跑的，建议重跑"
        const ver = String(report.engineVersion || 'pre-1.62.4');
        versionCounts.set(ver, (versionCounts.get(ver) ?? 0) + 1);

        for (const c of (report.contracts || [])) {
            const stat = contractStats.get(c.id) ?? { id: c.id, desc: c.desc, appeared: 0, failed: 0 };
            stat.appeared++;
            if (!c.passed) stat.failed++;
            contractStats.set(c.id, stat);
        }
        for (const h of (report.hints || [])) {
            const prev = hintCounts.get(h.code) ?? { code: h.code, count: 0, severity: 'info' };
            prev.count++;
            prev.severity = stronger(prev.severity, h.severity);
            hintCounts.set(h.code, prev);

            // v1.62.4：REDUNDANT_PAIR / CORRELATED_PAIR 把具体的 pair 收集起来，
            // 让 summarizeOptimizationActions 能告诉用户"是哪两个指标信息重叠"。
            if ((h.code === 'REDUNDANT_PAIR' || h.code === 'CORRELATED_PAIR')
                && Array.isArray(h.metrics) && h.metrics.length === 2) {
                const [a, b] = h.metrics.slice().sort();   // 排序让 (X,Y) 与 (Y,X) 合并
                const key = `${a}↔${b}`;
                const entry = redundantPairCounts.get(key)
                    ?? { a, b, count: 0, pearsons: [] };
                entry.count++;
                const r = Number(h.evidence);
                if (Number.isFinite(r)) entry.pearsons.push(r);
                redundantPairCounts.set(key, entry);
            }
        }
        const dom = report.linkages?.stressDominator?.key;
        if (dom) {
            stressDominatorCounts.set(dom, (stressDominatorCounts.get(dom) ?? 0) + 1);
        }
    }

    /* ---- contractStats 按违规率降序 ---- */
    const contractStatsList = [...contractStats.values()].map((s) => ({
        ...s,
        violationRate: s.appeared > 0 ? s.failed / s.appeared : 0,
    }));
    contractStatsList.sort((a, b) => b.violationRate - a.violationRate);

    /* ---- topRegressions：违规率 ≥ 25% 的契约（即"这条契约值得专项立项排查"） ---- */
    const topRegressions = contractStatsList.filter((s) => s.violationRate >= 0.25 && s.appeared >= 3);

    /* ---- hintCounts 按"严重度 × 频次"排序（error 优先，同级看 count） ---- */
    const hintCountsList = [...hintCounts.values()].sort((a, b) => {
        const s = sevOrder[a.severity] - sevOrder[b.severity];
        if (s !== 0) return s;
        return b.count - a.count;
    });

    /* ---- stressDominatorCounts 按出现次数降序 ---- */
    const stressDominatorList = [...stressDominatorCounts.entries()]
        .map(([key, count]) => ({ key, count, share: count / sessionsCount }))
        .sort((a, b) => b.count - a.count);

    /* ---- 健康分分布 ---- */
    const healthScoreStats = healthScores.length > 0 ? {
        count: healthScores.length,
        min: Math.min(...healthScores),
        max: Math.max(...healthScores),
        mean: healthScores.reduce((s, x) => s + x, 0) / healthScores.length,
        p10: _quantile(healthScores, 0.10),
        p50: _quantile(healthScores, 0.50),
        p90: _quantile(healthScores, 0.90),
    } : null;

    /* v1.62.4：engineVersion 一致性统计 */
    const perVersion = Object.fromEntries(versionCounts.entries());
    const mismatchCount = sessionsCount - (perVersion[PROFILE_AUDIT_ENGINE_VERSION] || 0);
    const engineVersionStats = {
        current: PROFILE_AUDIT_ENGINE_VERSION,
        mismatchCount,
        perVersion,
    };

    /* v1.62.4：高频冗余对 Top（按出现次数降序）。每对附带平均 |r|。 */
    const redundantPairTop = [...redundantPairCounts.values()]
        .map((p) => ({
            a: p.a, b: p.b, count: p.count,
            avgPearson: p.pearsons.length > 0
                ? p.pearsons.reduce((s, x) => s + x, 0) / p.pearsons.length
                : null,
        }))
        .sort((x, y) => y.count - x.count)
        .slice(0, 8);

    return {
        schema: PROFILE_AUDIT_SCHEMA,
        engineVersion: PROFILE_AUDIT_ENGINE_VERSION,
        generatedAt: Date.now(),
        sessionsCount,
        framesTotal,
        healthScore: healthScoreStats,
        contractStats: contractStatsList,
        hintCounts: hintCountsList,
        stressDominatorCounts: stressDominatorList,
        topRegressions,
        engineVersionStats,
        redundantPairTop,
    };
}

function _quantile(arr, q) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const t = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
    const lo = Math.floor(t);
    const hi = Math.ceil(t);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - t) + sorted[hi] * (t - lo);
}

/* ============================================================
 * summarizeOptimizationActions —— 跨局聚合 → 可执行代码优化清单
 * ============================================================
 *
 * 输入：aggregateAuditReports(reports) 的输出
 * 输出：按优先级排序的 action 数组：
 *   [{
 *     priority,           // 1=最高、5=最低
 *     code,               // 稳定标识，与 hint code 对齐
 *     category,           // 'contract' | 'metric-coverage' | 'metric-range' | 'metric-noise' | 'linkage'
 *     title,              // 一句话总结
 *     evidence,           // 客观数据（"3/4 局触发"等）
 *     affected,           // 受影响的指标/契约 key 列表
 *     rootCauseHints,     // 可能根因（多个备选）
 *     suggestedActions,   // 具体改哪几个文件/做什么操作（步骤）
 *     effort,             // 'low' | 'medium' | 'high'
 *     expectedBenefit,    // 一句话预期收益
 *   }]
 *
 * 设计原则：
 *   - 一个 hint code 对应一个 action 模板，把"频次+严重度"翻译为优先级
 *   - 多个 hint 联动时合并成一条复合 action（如 INTENT_THRASHING + STRESS_SINGLE_DOMINATOR 同时
 *     高频出现 → "自适应输出抖动"复合 action）
 *   - 引导用户到具体文件（adaptiveSpawn.js / playerProfile.js 等），不给空话
 *
 * @param {object} aggregate
 * @returns {Array<object>}
 */
export function summarizeOptimizationActions(aggregate) {
    if (!aggregate || aggregate.sessionsCount === 0) return [];
    const sessionsCount = Number(aggregate.sessionsCount) || 1;
    const actions = [];

    const hintByCode = new Map((aggregate.hintCounts || []).map((h) => [h.code, h]));

    /* === 工具函数 === */
    const hintShare = (code) => (hintByCode.get(code)?.count ?? 0) / sessionsCount;
    /** 把违规率映射成优先级：≥80% → 1；≥50% → 2；≥25% → 3；>0 → 4 */
    const shareToPriority = (share) =>
        share >= 0.80 ? 1 :
        share >= 0.50 ? 2 :
        share >= 0.25 ? 3 :
        share > 0 ? 4 : 5;

    /* === 0) ⚠️ 旧版本 audit 报告残留检测（v1.62.4+）—— 最高优先级
     *
     * 当聚合数据里有 ≥1 局是用旧规则（engineVersion < current）跑出来的，
     * 说明 audit 工具升级后这些局没重跑 → 它们的"违规"可能是已经修复的假阳。
     * 提示用户在「🤖 一键自动巡检」点"强制重跑"刷新到最新规则。 */
    const verStats = aggregate.engineVersionStats;
    if (verStats && verStats.mismatchCount > 0) {
        const verList = Object.entries(verStats.perVersion)
            .filter(([v]) => v !== verStats.current)
            .map(([v, n]) => `${v} × ${n} 局`).join('，');
        actions.push({
            priority: 1,
            code: 'STALE_AUDIT_REPORTS',
            category: 'meta',
            title: `${verStats.mismatchCount}/${sessionsCount} 局是旧 audit 规则跑的（建议重跑）`,
            evidence: `当前引擎版本 ${verStats.current}；过期版本：${verList || 'pre-1.62.4'}`,
            affected: ['engineVersion'],
            rootCauseHints: [
                'audit 工具升级后，已上传的报告仍是旧规则的产物',
                '旧规则可能误报已修复的问题（如 stress-equals-sum-breakdown v1.62.1 改为自动求和；session-arc v1.62.3 加长 session 豁免）',
                '下方其他 action 里如果出现"已知应通过的契约还在失败"，多半是这个原因',
            ],
            suggestedActions: [
                '1. 打开 /profile-audit.html → 聚合视图 → 点 "↻ 强制重跑" 用最新规则刷新所有局',
                '2. 或 CLI：npm run profile:auto-audit -- --sqlite db --force --upload http://localhost:5050',
                '3. 重跑后再读本报告：若契约违规率大幅下降，说明之前是旧规则误报',
            ],
            effort: 'low',
            expectedBenefit: '消除旧规则的假阳报警，让 actions 清单聚焦真问题',
        });
    }

    /* === A) 契约高违规率 → 高优先级 action === */
    for (const c of aggregate.contractStats || []) {
        if (!c.failed || c.appeared < 3 || c.violationRate < 0.25) continue;
        const priority = shareToPriority(c.violationRate);
        actions.push(_actionForContract(c, priority));
    }

    /* === A.5) 高频冗余指标对（v1.62.4+）—— 把 REDUNDANT_PAIR 的具体 pair 暴露出来
     *
     * 之前 hintCounts 只汇总 REDUNDANT_PAIR ×N 总数，看不出是哪两个指标。现在 aggregate
     * 携带 redundantPairTop，按出现次数排序、附带平均 Pearson |r|，直接告诉团队
     * "哪些指标对长期高相关 → 考虑合并 / 取其一减少 UI 噪声"。 */
    /* v1.62.5（优化建议 #2）：过滤掉 metricRelationships.js 已标"auditExempt:true"的预期相关对，
     * 让 action 只关注"未被设计预期、真的冗余"的指标对，不打扰团队。 */
    const allPairs = (aggregate.redundantPairTop || []).filter(
        (p) => p.count >= Math.max(2, sessionsCount * 0.3)
    );
    const realDupPairs = allPairs.filter((p) => !isRedundantPairExempt(p.a, p.b));
    const exemptedPairs = allPairs.filter((p) => isRedundantPairExempt(p.a, p.b));

    if (realDupPairs.length > 0) {
        actions.push({
            priority: realDupPairs[0].count >= sessionsCount * 0.5 ? 3 : 4,
            code: 'REDUNDANT_METRIC_PAIRS',
            category: 'metric-coverage',
            title: `${realDupPairs.length} 组指标长期高度相关 → 信息冗余`,
            evidence: realDupPairs.slice(0, 5).map((p) =>
                `${p.a} ↔ ${p.b}: ×${p.count}${p.avgPearson != null ? ` (avg |r|=${Math.abs(p.avgPearson).toFixed(2)})` : ''}`
            ).join('；') + (exemptedPairs.length > 0
                ? `；另有 ${exemptedPairs.length} 对在 metricRelationships 标记为"预期相关"已豁免`
                : ''),
            affected: realDupPairs.flatMap((p) => [p.a, p.b]),
            rootCauseHints: [
                '某些指标在画像系统中本质是同一信号的不同变换（如 skill 与 historicalSkill）',
                '强 EMA 平滑链使下游指标都跟着主信号走（如 cognitiveLoad 跟随 thinkMs）',
                '指标设计时就是预期重叠的（互相印证），不是 bug',
            ],
            suggestedActions: [
                '1. 「指标详读」浮层 → 选这组对里任一指标 → 副坐标选另一项，肉眼确认是否真的高度同步',
                '2. 若确认冗余且非"印证关系"：UI 上隐藏其中一个；模型训练时也只取一个',
                '3. 若是"印证关系"（如 skill vs historicalSkill）：在 web/src/audit/metricRelationships.js 增加 `auditExempt: true` 条目，下次 audit 不再报警',
                '4. 若是新发现的冗余关系，记得回 metricRelationships.js 登记 relation: derived/correlated',
            ],
            effort: 'low',
            expectedBenefit: '减少面板冗余信息；模型训练去共线性提升泛化',
        });
    }

    /* === A.6) stress 长期被单一分量主导（v1.62.4+）—— 比 STRESS_SINGLE_DOMINATOR hint 更严格
     *
     * 之前 ADAPTIVE_OUTPUT_INSTABILITY 复合 action 要求 STRESS_SINGLE_DOMINATOR + INTENT_THRASHING
     * 同时高频；但截图里 pacingAdjust 4/6 局主导 + 只 1 次 INTENT_THRASHING，复合 action 不触发，
     * 却又是个明显问题。这里单独把"某分量 ≥50% 局担任主导"作为一类 action。 */
    const topDom = aggregate.stressDominatorCounts?.[0];
    if (topDom && topDom.share >= 0.5) {
        actions.push({
            priority: topDom.share >= 0.8 ? 2 : 3,
            code: 'STRESS_DOMINATOR_PERSISTENT',
            category: 'linkage',
            title: `${(topDom.share * 100).toFixed(0)}% 局 stress 主导分量都是「${topDom.key}」`,
            evidence: `跨 ${sessionsCount} 局中，${topDom.count} 局都是 ${topDom.key} 主导 → 该信号取值偏强或其他分量被钳制`,
            affected: ['stress', topDom.key],
            rootCauseHints: [
                `${topDom.key} 的计算值域可能比设计大（如 pacingAdjust 默认 ±0.12，已大于其它分量典型 ±0.05）`,
                '其他分量的触发条件过严，常年为 0 让 absShare 偏向少数活跃分量',
                'difficultyBias 主导 = 玩家集中在某个难度且无明显加压/减压，可能是正常的',
            ],
            suggestedActions: [
                `1. web/src/adaptiveSpawn.js → 查 ${topDom.key} 的计算，看默认值域是否需要收紧`,
                '2. 查其他长期为 0 的分量：是否触发阈值过严？例如 flowAdjust 在 |flowDeviation| < 0.25 时被 deadzone 置 0',
                '3. 如果是 difficultyBias 主导：说明这批 session 的 stress 几乎完全由难度档位决定，自适应未充分介入 → 检查是否所有玩家都在新手保护期内',
            ],
            effort: 'medium',
            expectedBenefit: '改善 stress 分量的"多源驱动"特性，让自适应系统真正参与决策',
        });
    }

    /* === B) 指标覆盖率系统性低 → 中优先级 === */
    const covLowShare = hintShare('COVERAGE_LOW') + hintShare('COVERAGE_TOO_LOW');
    if (covLowShare >= 0.3) {
        actions.push({
            priority: covLowShare >= 0.6 ? 1 : 2,
            code: 'METRIC_COVERAGE_SYSTEMIC',
            category: 'metric-coverage',
            title: `${(covLowShare * 100).toFixed(0)}% 局存在指标覆盖率不足`,
            evidence: `COVERAGE_LOW / COVERAGE_TOO_LOW 累计在 ${Math.round(covLowShare * sessionsCount)}/${sessionsCount} 局触发`,
            affected: ['coverage'],
            rootCauseHints: [
                'PlayerProfile 冷启动期 metrics.{thinkMs, clearRate, comboRate, missRate, pickToPlaceMs} 返回 null',
                'buildPlayerStateSnapshot 在 samples=0 / activeSamples=0 时主动写 null（v1.13 起的设计），但部分场景写入时机过早',
                '回放分析时把 ps.{cognitiveLoad, pickToPlaceMs} 视为缺失',
            ],
            suggestedActions: [
                '1. 检查 web/src/moveSequence.js → buildPlayerStateSnapshot：是否可以把 metrics.* 的 null 改为"最近 EMA 兜底 + 标注 isFallback=true"',
                '2. 或在 web/src/audit/profileAudit.js 的 DEFAULT_THRESHOLDS.coverage 把阈值放宽（如 warn 0.30 → 0.20），让冷启动短局不被误报',
                '3. 离线分析侧（buildReplayAnalysis）已有 coldFramesRatio 标注，可据此跳过冷启动帧的均值统计',
            ],
            effort: 'medium',
            expectedBenefit: '消除约 70-80% 的覆盖率告警噪声，让 audit 关注真实指标问题',
        });
    }

    /* === C) METRIC_JITTERY/METRIC_NOISY 系统性 → 低优先级 === */
    const noiseShare = hintShare('METRIC_JITTERY') + hintShare('METRIC_NOISY');
    if (noiseShare >= 0.5) {
        actions.push({
            priority: 4,
            code: 'METRIC_NOISE_SYSTEMIC',
            category: 'metric-noise',
            title: `${Math.round(noiseShare * sessionsCount)} 局出现指标抖动`,
            evidence: `METRIC_JITTERY + METRIC_NOISY 累计 ${Math.round(noiseShare * sessionsCount)}/${sessionsCount} 局`,
            affected: ['boardFill', 'frustration', 'momentum', 'firstMoveFreedom'],
            rootCauseHints: [
                'boardFill 在消行时跳变是正常的（不需平滑）',
                'frustration / momentum 在 PlayerProfile 内已有 EMA，但窗口可能偏短',
                'spawnGeo 类指标（firstMoveFreedom / tripletSolutionCount）逐帧重算，本身就抖',
            ],
            suggestedActions: [
                '1. 若是 UI 显示问题：给 sparkline 增加可选 EMA 平滑开关，不动数据本身',
                '2. 若是建模需要：考虑在 web/src/audit/profileAudit.js 增加 _smoothBeforeStats 选项，对噪声指标先平滑再统计',
                '3. 默认阈值已经在 info 级别，先观察是否影响决策；不影响则不动',
            ],
            effort: 'low',
            expectedBenefit: '减少报告噪音；不影响游戏体验',
        });
    }

    /* === D) STRESS_SINGLE_DOMINATOR + INTENT_THRASHING 联动 → 自适应抖动复合 action === */
    const stressDominShare = hintShare('STRESS_SINGLE_DOMINATOR');
    const intentThrashShare = hintShare('INTENT_THRASHING');
    if (stressDominShare >= 0.3 || intentThrashShare >= 0.3) {
        const topDominator = aggregate.stressDominatorCounts?.[0];
        actions.push({
            priority: stressDominShare >= 0.5 || intentThrashShare >= 0.5 ? 1 : 2,
            code: 'ADAPTIVE_OUTPUT_INSTABILITY',
            category: 'linkage',
            title: 'stress 主导单一 + spawnIntent 抖动（自适应系统输出不稳定）',
            evidence: [
                stressDominShare > 0 ? `STRESS_SINGLE_DOMINATOR 在 ${Math.round(stressDominShare * sessionsCount)} 局触发` : null,
                intentThrashShare > 0 ? `INTENT_THRASHING 在 ${Math.round(intentThrashShare * sessionsCount)} 局触发` : null,
                topDominator ? `主导分量 Top: ${topDominator.key} (${(topDominator.share * 100).toFixed(0)}%)` : null,
            ].filter(Boolean).join('；'),
            affected: ['stress', 'spawnIntent', topDominator?.key].filter(Boolean),
            rootCauseHints: [
                `${topDominator?.key ?? '某分量'} 长期占主导 → 其他分量被掩盖（如 pacingAdjust 主导意味着 setup/payoff 切换主导了 stress）`,
                'spawnIntent 阈值无滞回，pacingAdjust 在边界附近震荡 → intent 高频切换',
                'flowAdjust / reactionAdjust 等弱信号被强信号淹没',
            ],
            suggestedActions: [
                '1. web/src/adaptiveSpawn.js：给 spawnIntent 派生加滞回（hysteresis），如 stress 跨阈值 ±0.02 才切换',
                '2. 检查主导分量的计算公式，是否取值范围过大压制其他分量（如 pacingAdjust 默认 ±0.12 vs flowAdjust ±0.05）',
                '3. 如果是 difficultyBias 主导：说明本局窗口内自适应未介入，正常；如果是其他分量主导：需要把信号取值收敛',
            ],
            effort: 'medium',
            expectedBenefit: '改善玩家体感连贯性（不会感受到出块策略频繁切换）',
        });
    }

    /* === E) 健康分整体偏低 → 元 action === */
    const hs = aggregate.healthScore;
    if (hs && Number.isFinite(hs.p50) && hs.p50 < 60) {
        actions.push({
            priority: hs.p50 < 40 ? 1 : 2,
            code: 'HEALTH_SCORE_OVERALL_LOW',
            category: 'meta',
            title: `健康分中位数 ${hs.p50.toFixed(0)} 偏低（p10=${hs.p10.toFixed(0)} / p90=${hs.p90.toFixed(0)}）`,
            evidence: `${hs.count} 局中位数健康分 ${hs.p50.toFixed(0)}/100，min=${hs.min}、max=${hs.max}`,
            affected: ['healthScore'],
            rootCauseHints: [
                '可能是契约设计过严（与代码实际不一致）→ 见上方契约 action',
                '可能是指标范围 DEFAULT_RANGE_BY_KEY 设计过严 → 见 OUT_OF_RANGE 详情',
                '可能是真实代码 bug → 按上方 contract action 优先级排查',
            ],
            suggestedActions: [
                '1. 先解决上方优先级 1-2 的契约/链路 action，预计能让健康分中位数从 60 → 80+',
                '2. 跨局对比：找 p90 健康分 ≥ 85 的局 → 看它们的共同特征，反推问题局的差异',
                '3. 如果问题集中在某个用户 → 看用户行为模式（new player / power user）',
            ],
            effort: 'medium',
            expectedBenefit: '把整套 audit 工具从"经常报警"调到"只在真出问题时报警"',
        });
    }

    /* === 排序 === */
    actions.sort((a, b) => a.priority - b.priority);
    return actions;
}

/** 把单条 contract violation 翻译为定制 action。 */
function _actionForContract(c, priority) {
    const FIX_MAP = {
        'clearRate-vs-boardFill': {
            rootCauseHints: [
                '极少见：clearRate / boardFill 计算口径其中一个反了',
                '可能是本局有特殊机制（清屏倍率、bonus 行）改变了 boardFill 的更新时机',
            ],
            suggestedActions: [
                '1. 检查 web/src/playerProfile.js → recordPlace：cleared 时 clearRate 上调是否伴随 boardFill 下调',
                '2. 查 web/src/grid.js → getFillRatio() 是否在消行 settle 之后才更新',
            ],
        },
        'frustration-vs-momentum': {
            rootCauseHints: [
                'momentum 更新延迟于 frustration（前者周期性、后者即时）',
                'frustration 在消行后立即归 0，而 momentum 用 EMA 衰减，产生小段同向',
            ],
            suggestedActions: [
                '1. web/src/playerProfile.js → momentum 计算：考虑同步 frustration 归零事件做"反向脉冲"',
                '2. 或者把契约阈值从 0.10 放宽到 0.05（接受 momentum 的延迟特性）',
            ],
        },
        'stress-equals-sum-breakdown': {
            rootCauseHints: [
                'adaptiveSpawn.js 后置 lifecycleCapAdjust / clamp 让 stress ≠ Σ',
                '存在没被持久化到 stressBreakdown 的分量（buildPlayerStateSnapshot 漏写）',
            ],
            suggestedActions: [
                '1. 检查 web/src/moveSequence.js → buildPlayerStateSnapshot.adaptive.stressBreakdown 是否复制了完整的 a.stressBreakdown',
                '2. v1.62.1 已自动求和全字段；若仍残差，说明有 ${字段} 未被 reduce 加和（看 _STRESS_BREAKDOWN_SKIP 是否漏了）',
            ],
        },
        'flowAdjust-tracks-flowDeviation': {
            rootCauseHints: [
                'flowAdjust 在 flowDeviation 较小时被 clamp 为 0，相关性看起来弱',
                'flowState 三态判定有滞回，与 flowDeviation 不严格同步',
            ],
            suggestedActions: [
                '1. 在 web/src/adaptiveSpawn.js 看 flowAdjust 的 deadzone（小幅 flowDeviation 直接置 0），考虑用线性过渡代替硬钳制',
                '2. 或放宽契约 |r| 阈值从 0.2 到 0.15',
            ],
        },
        'feedbackBias-leads-stress': {
            rootCauseHints: [
                'feedbackBias 在本局内可能整体很小（接近 0），相关系数被噪声主导',
                'lag=3 步可能不适合本局采样密度',
            ],
            suggestedActions: [
                '1. 检查 web/src/playerProfile.js → feedbackBias 计算窗口是否过短',
                '2. 在 web/src/audit/profileAuditContracts.js 把 lag 从 3 调到 5 试试',
            ],
        },
        'score-monotone-increasing': {
            rootCauseHints: [
                '⚠️ 严重：score 持久化逻辑有 bug，不应该有任何下降',
                '可能是测试桩或回放 frames 中 ps.score 写错',
            ],
            suggestedActions: [
                '1. 立刻定位失败 session 的 frames：找下降帧的 idx，看是真实 bug 还是数据污染',
                '2. 修复 web/src/game.js / playerProfile.js 中 score 写入路径',
            ],
        },
        'boardFill-bounded-0-1': {
            rootCauseHints: [
                '⚠️ Grid.getFillRatio 返回值超出 [0, 1]',
                '可能是 cells 数量计算错（如清屏后 occupied 没归零）',
            ],
            suggestedActions: [
                '1. 检查 web/src/grid.js → getFillRatio() 实现，确认分母是 size×size',
                '2. 看是否有"已消行但还在 cells 里"的脏数据',
            ],
        },
        'session-arc-warm-to-cool': {
            rootCauseHints: [
                '长 session（>20min）破坏了 early/peak/late 阶段划分',
                '触发 endSessionDistress / lifecycleCapAdjust 等后置压制了 peak',
            ],
            suggestedActions: [
                '1. web/src/adaptiveSpawn.js → sessionArcAdjust：长 session 阈值动态延长',
                '2. 或者契约加例外条款：长 session + 持续 relief 信号 → 跳过半圆弧判定',
            ],
        },
        'skill-not-drift-too-fast': {
            rootCauseHints: [
                'skill EMA 窗口短 + 单局极端表现（连续清屏/连续 missplace）',
                '历史 skill 校准与本局即时表现差距大',
            ],
            suggestedActions: [
                '1. web/src/playerProfile.js → skillLevel 计算：考虑加上限 |Δ| 0.3 per session',
                '2. 或者契约阈值放宽到 |Δ| < 0.5',
            ],
        },
        'spawn-intent-no-thrashing': {
            rootCauseHints: [
                'pacingAdjust 在 release/tension 边界震荡 → setup/payoff 频繁切',
                'stress 在 sprint 区间 [0.45, 0.55) 反复出入 → sprint/flow 频繁切',
                'harvestable 几何判定（nearFullLines / pcSetup）逐帧重算，没有 hysteresis',
                'playerDistress 在 -0.10 边界震荡 → relief/maintain 频繁切',
            ],
            suggestedActions: [
                '1. ⚠️ 改 web/src/adaptiveSpawn.js → deriveSpawnIntent 是破坏性改动，建议先看哪个 intent pair 切换最多（在前端打印 intent transition 矩阵）',
                '2. 在 deriveSpawnIntent 加入可选 hysteresis：接收 prevIntent 参数，边界 ±0.02 内保持上一帧 intent',
                '3. 通过 game_rules.json adaptiveSpawn.spawnIntent.hysteresis 控制启用（默认关闭，opt-in），先做小流量 A/B',
                '4. 不动游戏代码的话，可在 UI 层做"intent chip 显示去抖"（仅视觉平滑、不影响出块决策）',
            ],
        },
    };
    const fix = FIX_MAP[c.id] || {
        rootCauseHints: ['未知契约，请查阅 docs/algorithms/PROFILE_AUDIT.md'],
        suggestedActions: ['1. 复现：跑单局 audit 找具体失败原因；2. 决定是改代码还是改契约'],
    };
    return {
        priority,
        code: 'CONTRACT_VIOLATION_RECURRING',
        category: 'contract',
        title: `契约「${c.id}」违规率 ${(c.violationRate * 100).toFixed(0)}%`,
        evidence: `${c.failed}/${c.appeared} 局失败 · ${c.desc || ''}`,
        affected: [c.id],
        rootCauseHints: fix.rootCauseHints,
        suggestedActions: fix.suggestedActions,
        effort: c.violationRate >= 0.5 ? 'medium' : 'low',
        expectedBenefit: `把该契约通过率从 ${((1 - c.violationRate) * 100).toFixed(0)}% 提升到目标 95%+，健康分预期 +${Math.round(c.violationRate * 10)}`,
    };
}
