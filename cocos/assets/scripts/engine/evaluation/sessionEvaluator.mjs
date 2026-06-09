/* 自动生成 —— 请勿手改。源：web/src/evaluation/sessionEvaluator.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * sessionEvaluator.js — 单局评估聚合
 *
 * 输入：在一局游戏过程中累积的 ledger（每步、每轮、每次 spawn 的轻量记录），
 *       局尾汇总成一条 `sessionEvalRecord`，落到后端 `evaluation_session` 表
 *       供 SpawnTransformer 训练样本筛选、A/B 实验、灰度回滚自动门使用。
 *
 * 详细 KPI 定义见 docs/algorithms/SESSION_EVALUATION.md §2。
 *
 * 三类指标：
 *   - outcome     ：与玩家可见结局对齐
 *   - trajectory  ：盘面/压力轨迹（AUC、方差、峰停留）
 *   - spawnAudit  ：spawn 算法承诺兑现率（intent / guarantee / payoff / dock 熵）
 *   - cross       ：玩家 × 难度交叉（regretPerStep、forcedBad/salvage 比例）
 *   - guard       ：异常护栏（rageQuit / topOutBeforeFlow / flowStarvation）
 *
 * 这是纯函数：不读全局状态、不写网络；上层负责把 record POST 到后端。
 */

const DEFAULT_GUARD = Object.freeze({
    rageQuitDurationMs: 30000,
    rageQuitScoreRatio: 0.3,
    topOutMeanStressMax: 0.3,
    flowStarvationRatioMin: 0.15,
});

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function safeMean(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (const v of arr) s += Number(v) || 0;
    return s / arr.length;
}

function safeVariance(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = safeMean(arr);
    let s = 0;
    for (const v of arr) s += ((Number(v) || 0) - m) ** 2;
    return s / arr.length;
}

function quantileSorted(sortedArr, q) {
    if (!sortedArr.length) return 0;
    const idx = clamp01(q) * (sortedArr.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

/* AUC：用相邻样本梯形积分，按时间归一化到 [0, 1]。 */
function trapezoidAUC(samples) {
    if (!samples || samples.length < 2) return safeMean((samples || []).map((s) => s.v));
    let area = 0;
    let span = 0;
    for (let i = 1; i < samples.length; i++) {
        const dt = Math.max(0, samples[i].t - samples[i - 1].t);
        area += (samples[i].v + samples[i - 1].v) * 0.5 * dt;
        span += dt;
    }
    return span > 0 ? area / span : safeMean(samples.map((s) => s.v));
}

/* 简单线性回归斜率（最小二乘）。 */
function regressionSlope(arr) {
    const n = arr.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += arr[i];
        sumXY += i * arr[i];
        sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
}

function shannonEntropy(buckets) {
    let total = 0;
    for (const v of buckets.values()) total += v;
    if (total === 0) return 0;
    let h = 0;
    for (const v of buckets.values()) {
        if (v <= 0) continue;
        const p = v / total;
        h -= p * Math.log2(p);
    }
    return h;
}

/* ─────────────────────────── 聚合 ─────────────────────────── */

/**
 * @param {object} ledger 一局累计的轻量 ledger（见 evaluationLedger.js 字段表）
 * @param {object} [opts] { guard?: {...} }
 */
export function buildSessionEvalRecord(ledger, opts = {}) {
    const guard = { ...DEFAULT_GUARD, ...(opts.guard || {}) };
    const meta = ledger.meta || {};
    const outcomeRaw = ledger.outcome || {};

    /* ── outcome ── */
    const outcome = {
        finalScore: Number(outcomeRaw.finalScore) || 0,
        survivedSteps: Number(outcomeRaw.survivedSteps) || 0,
        placedCount: Number(outcomeRaw.placedCount) || 0,
        linesCleared: Number(outcomeRaw.linesCleared) || 0,
        multiClears: Number(outcomeRaw.multiClears) || 0,
        perfectClears: Number(outcomeRaw.perfectClears) || 0,
        maxCombo: Number(outcomeRaw.maxCombo) || 0,
        runDurationMs: Number(outcomeRaw.runDurationMs) || 0,
        endCause: String(outcomeRaw.endCause || 'unknown'),
    };

    /* ── trajectory ── */
    const stressSamples = Array.isArray(ledger.stressSamples) ? ledger.stressSamples : [];
    const sortedStress = stressSamples.map((s) => s.v).sort((a, b) => a - b);
    const boardStressAUC = trapezoidAUC(stressSamples);
    const stressVariance = safeVariance(stressSamples.map((s) => s.v));
    const peakStress = sortedStress.length ? sortedStress[sortedStress.length - 1] : 0;
    const peakStressDwellRatio = stressSamples.length
        ? stressSamples.filter((s) => s.v >= peakStress - 0.05).length / stressSamples.length
        : 0;
    const holesSeries = (ledger.boardSamples || []).map((b) => Number(b.holes) || 0);
    const flatnessSeries = (ledger.boardSamples || []).map((b) => Number(b.flatness) || 0);
    const freedomSeries = (ledger.boardSamples || []).map((b) => Number(b.firstMoveFreedom) || 0);
    const freedomMin = freedomSeries.length ? Math.min(...freedomSeries) : 0;
    const freedomDwell = freedomSeries.length
        ? freedomSeries.filter((v) => v <= 1).length / freedomSeries.length
        : 0;
    const trajectory = {
        boardStressAUC,
        stressVariance,
        peakStress,
        peakStressDwellRatio,
        meanHoles: safeMean(holesSeries),
        holesSlope: regressionSlope(holesSeries),
        meanFlatness: safeMean(flatnessSeries),
        freedomMin,
        freedomDwell,
        stressQuartiles: {
            q25: quantileSorted(sortedStress, 0.25),
            q50: quantileSorted(sortedStress, 0.5),
            q75: quantileSorted(sortedStress, 0.75),
        },
    };

    /* ── spawnAudit ── */
    const spawnEvents = ledger.spawnEvents || [];
    const intentBuckets = new Map();
    const intentRealized = new Map();
    let guaranteeAttempts = 0;
    let guaranteeBreaches = 0;
    let solutionHits = 0;
    let solutionEvaluable = 0;
    const dockUseBuckets = new Map();
    let payoffPromised = 0;
    let payoffRealized = 0;
    let softFilterRejectSum = 0;
    let softFilterReSamples = 0;
    for (const ev of spawnEvents) {
        const intent = ev.spawnIntent || 'maintain';
        intentBuckets.set(intent, (intentBuckets.get(intent) || 0) + 1);
        if (ev.intentRealized === true) {
            intentRealized.set(intent, (intentRealized.get(intent) || 0) + 1);
        }
        if (Number.isFinite(ev.clearGuarantee) && ev.clearGuarantee > 0) {
            guaranteeAttempts++;
            if (ev.guaranteeBreached === true) guaranteeBreaches++;
        }
        if (Number.isFinite(ev.solutionCount) && Array.isArray(ev.targetSolutionRange)) {
            solutionEvaluable++;
            const [lo, hi] = ev.targetSolutionRange;
            if (ev.solutionCount >= lo && ev.solutionCount <= hi) solutionHits++;
        }
        if (Array.isArray(ev.dockPermUsed)) {
            const key = ev.dockPermUsed.join(',');
            dockUseBuckets.set(key, (dockUseBuckets.get(key) || 0) + 1);
        }
        if (Number.isFinite(ev.payoffIntensity) && ev.payoffIntensity >= 0.6) {
            payoffPromised++;
            if (ev.payoffRealizedLines >= 2) payoffRealized++;
        }
        if (Number.isFinite(ev.softFilterRejects)) softFilterRejectSum += ev.softFilterRejects;
        if (Number.isFinite(ev.softFilterResamples)) softFilterReSamples += ev.softFilterResamples;
    }
    const intentRealizationRate = {};
    for (const [intent, n] of intentBuckets.entries()) {
        intentRealizationRate[intent] = n > 0
            ? (intentRealized.get(intent) || 0) / n : 0;
    }
    const spawnAudit = {
        intentDistribution: Object.fromEntries(intentBuckets),
        intentRealizationRate,
        guaranteeBreachRate: guaranteeAttempts > 0 ? guaranteeBreaches / guaranteeAttempts : 0,
        solutionRangeHitRate: solutionEvaluable > 0 ? solutionHits / solutionEvaluable : 0,
        dockUsageEntropy: shannonEntropy(dockUseBuckets),
        payoffRealizationRate: payoffPromised > 0 ? payoffRealized / payoffPromised : 0,
        softFilterRejectRate: spawnEvents.length > 0
            ? softFilterRejectSum / spawnEvents.length : 0,
        softFilterResamplesMean: spawnEvents.length > 0
            ? softFilterReSamples / spawnEvents.length : 0,
        spawnCount: spawnEvents.length,
    };

    /* ── cross（玩家 × 难度）── */
    const moveQualities = ledger.moveQualities || [];
    const roundQualities = ledger.roundQualities || [];
    const evaluatedMoves = moveQualities.filter((m) => m && m.evaluated);
    const regretPerStep = safeMean(evaluatedMoves.map((m) => m.regret));
    const classification = roundQualities.reduce((acc, r) => {
        if (!r) return acc;
        const c = r.classification || 'incomplete';
        acc[c] = (acc[c] || 0) + 1;
        return acc;
    }, {});
    const totalRounds = Math.max(1, roundQualities.length);
    const cross = {
        regretPerStep,
        optimalityPerStep: safeMean(evaluatedMoves.map((m) => m.optimality)),
        roundClassificationDist: classification,
        forcedBadRatio: (classification.forced_bad || 0) / totalRounds,
        salvageRatio: (classification.salvage || 0) / totalRounds,
        optimalRoundRatio: (classification.optimal || 0) / totalRounds,
        badnessTagDist: evaluatedMoves.reduce((acc, m) => {
            const t = m.badnessTag || 'fine';
            acc[t] = (acc[t] || 0) + 1;
            return acc;
        }, {}),
    };

    /* ── guard ── */
    const flowState = ledger.flowStateSamples || [];
    const flowRatio = flowState.length
        ? flowState.filter((s) => s === 'flow').length / flowState.length : 0;
    const meanStress = safeMean(stressSamples.map((s) => s.v));
    const pb = Number(meta.pbBefore) || 0;
    const guardOut = {
        rageQuitFlag: outcome.runDurationMs > 0
            && outcome.runDurationMs < guard.rageQuitDurationMs
            && pb > 0
            && outcome.finalScore < guard.rageQuitScoreRatio * pb,
        topOutBeforeFlow: outcome.endCause === 'jam'
            && meanStress < guard.topOutMeanStressMax,
        flowStarvationFlag: flowRatio < guard.flowStarvationRatioMin,
        flowRatio,
    };

    /* ── arcContext（透传 v1.68 RoR 字段）── */
    const arcContext = {
        dailyRunIndex: meta.dailyRunIndex ?? null,
        runOverRunArc: meta.runOverRunArc ?? null,
        runOverRunArcReason: meta.runOverRunArcReason ?? null,
        runStreak: meta.runStreak ?? null,
        pbBefore: meta.pbBefore ?? null,
        pbAfter: meta.pbAfter ?? null,
        lifecycleStage: meta.lifecycleStage ?? null,
        maturityBand: meta.maturityBand ?? null,
    };

    return {
        schemaVersion: 1,
        meta: {
            runId: meta.runId || null,
            userId: meta.userId || null,
            modelVersion: meta.modelVersion || null,
            spawnPolicyMode: meta.spawnPolicyMode || null,
            configHash: meta.configHash || null,
            strategy: meta.strategy || null,
            startedAt: meta.startedAt || null,
            endedAt: meta.endedAt || null,
        },
        outcome,
        trajectory,
        spawnAudit,
        cross,
        guard: guardOut,
        arcContext,
    };
}

export const SESSION_EVAL_DEFAULT_GUARD = DEFAULT_GUARD;
