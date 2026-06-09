/* 自动生成 —— 请勿手改。源：web/src/evaluation/evaluationLedger.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * evaluationLedger.js — 单局评估数据累计器
 *
 * 由 Game 实例在 start() 创建、在 endGame() 交给 sessionEvaluator 聚合。
 * Ledger 保留**轻量原始数据**（采样 + 步/轮/spawn 事件），不做派生计算；
 * 聚合发生在局尾，是为了避免每步触发结构化运算造成主线程抖动。
 *
 * 字段表（与 sessionEvaluator 输入契约一一对应）：
 *
 *   meta              { runId, userId, modelVersion, spawnPolicyMode, configHash,
 *                       strategy, startedAt, endedAt, dailyRunIndex, runOverRunArc,
 *                       runOverRunArcReason, runStreak, pbBefore, pbAfter,
 *                       lifecycleStage, maturityBand }
 *   outcome           { finalScore, survivedSteps, placedCount, linesCleared,
 *                       multiClears, perfectClears, maxCombo, runDurationMs, endCause }
 *   stressSamples     [{ t, v }]              // norm 域 [0,1]
 *   flowStateSamples  [string]                // bored/flow/anxious
 *   boardSamples      [{ holes, flatness, firstMoveFreedom }]
 *   moveQualities     [moveQuality]
 *   roundQualities    [roundQuality]
 *   spawnEvents       [{ ts, spawnIntent, clearGuarantee, payoffIntensity,
 *                        solutionCount, targetSolutionRange, dockPermUsed,
 *                        softFilterRejects, softFilterResamples,
 *                        intentRealized, guaranteeBreached, payoffRealizedLines }]
 */

export function createEvaluationLedger(meta = {}) {
    return {
        meta: { startedAt: Date.now(), ...meta },
        outcome: {},
        stressSamples: [],
        flowStateSamples: [],
        boardSamples: [],
        moveQualities: [],
        roundQualities: [],
        spawnEvents: [],
    };
}

export function recordStressSample(ledger, value, ts) {
    if (!ledger) return;
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    ledger.stressSamples.push({ t: Number(ts) || Date.now(), v });
}

export function recordFlowSample(ledger, flowState) {
    if (!ledger || !flowState) return;
    ledger.flowStateSamples.push(String(flowState));
}

export function recordBoardSample(ledger, sample) {
    if (!ledger || !sample) return;
    ledger.boardSamples.push({
        holes: Number(sample.holes) || 0,
        flatness: Number(sample.flatness) || 0,
        firstMoveFreedom: Number(sample.firstMoveFreedom) || 0,
    });
}

export function recordMoveQuality(ledger, moveQuality) {
    if (!ledger || !moveQuality) return;
    ledger.moveQualities.push(moveQuality);
}

export function recordRoundQuality(ledger, roundQuality) {
    if (!ledger || !roundQuality) return;
    ledger.roundQualities.push(roundQuality);
}

/**
 * 新的 spawn 事件（写入时 spawnHints 已 resolve，下游兑现状态先留空）；
 * 在下一次 spawn 之前由 finalizeSpawnEvent 回填 intentRealized / guaranteeBreached
 * / payoffRealizedLines 等"事后"字段。
 */
export function recordSpawnEvent(ledger, event) {
    if (!ledger || !event) return -1;
    ledger.spawnEvents.push({
        ts: Number(event.ts) || Date.now(),
        spawnIntent: event.spawnIntent || 'maintain',
        clearGuarantee: Number(event.clearGuarantee) || 0,
        payoffIntensity: Number(event.payoffIntensity) || 0,
        solutionCount: Number.isFinite(event.solutionCount) ? event.solutionCount : null,
        targetSolutionRange: Array.isArray(event.targetSolutionRange)
            ? [Number(event.targetSolutionRange[0]) || 0, Number(event.targetSolutionRange[1]) || 0]
            : null,
        dockPermUsed: null,
        softFilterRejects: Number(event.softFilterRejects) || 0,
        softFilterResamples: Number(event.softFilterResamples) || 0,
        intentRealized: null,
        guaranteeBreached: null,
        payoffRealizedLines: 0,
        stressAtSpawn: Number(event.stressAtSpawn) || 0,
    });
    return ledger.spawnEvents.length - 1;
}

/**
 * 在轮结束时（dock 三块均落子后），回填本轮 spawn 事件的事后字段。
 * @param {object} ledger
 * @param {number} index             目标 spawn 事件下标
 * @param {object} resolution        { stressAfter, linesInRound, dockPermUsed }
 */
export function finalizeSpawnEvent(ledger, index, resolution) {
    if (!ledger || index < 0 || index >= ledger.spawnEvents.length) return;
    const ev = ledger.spawnEvents[index];
    const stressAfter = Number(resolution?.stressAfter);
    const linesInRound = Number(resolution?.linesInRound) || 0;
    if (resolution?.dockPermUsed) ev.dockPermUsed = resolution.dockPermUsed;
    ev.payoffRealizedLines = linesInRound;
    if (ev.clearGuarantee > 0) ev.guaranteeBreached = linesInRound < ev.clearGuarantee;
    if (Number.isFinite(stressAfter)) {
        // intent 兑现：relief→stress 下降；pressure→上升；其他→维持在 0.1 内。
        const delta = stressAfter - ev.stressAtSpawn;
        switch (ev.spawnIntent) {
            case 'relief': ev.intentRealized = delta <= -0.05; break;
            case 'pressure':
            case 'sprint':  ev.intentRealized = delta >= 0.05; break;
            case 'harvest': ev.intentRealized = linesInRound >= 1; break;
            case 'flow':    ev.intentRealized = Math.abs(delta) <= 0.10 && linesInRound >= 1; break;
            case 'engage':  ev.intentRealized = linesInRound >= 1 || delta >= 0; break;
            default:         ev.intentRealized = Math.abs(delta) <= 0.10; break;
        }
    }
}

export function setLedgerOutcome(ledger, outcome) {
    if (!ledger || !outcome) return;
    ledger.outcome = { ...ledger.outcome, ...outcome };
    ledger.meta.endedAt = Date.now();
}

export function patchLedgerMeta(ledger, patch) {
    if (!ledger || !patch) return;
    ledger.meta = { ...ledger.meta, ...patch };
}
