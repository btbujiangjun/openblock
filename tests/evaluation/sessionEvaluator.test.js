/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { buildSessionEvalRecord } from '../../web/src/evaluation/sessionEvaluator.js';
import { createEvaluationLedger, recordStressSample, recordFlowSample, recordBoardSample, recordMoveQuality, recordRoundQuality, recordSpawnEvent, finalizeSpawnEvent, setLedgerOutcome, patchLedgerMeta } from '../../web/src/evaluation/evaluationLedger.js';

describe('buildSessionEvalRecord', () => {
    it('空 ledger 也返回完整 schema', () => {
        const led = createEvaluationLedger({ userId: 'u1' });
        setLedgerOutcome(led, { finalScore: 0, survivedSteps: 0, runDurationMs: 1000, endCause: 'normal' });
        const r = buildSessionEvalRecord(led);
        expect(r.schemaVersion).toBe(1);
        expect(r.outcome.finalScore).toBe(0);
        expect(r.trajectory).toHaveProperty('boardStressAUC');
        expect(r.spawnAudit).toHaveProperty('intentRealizationRate');
        expect(r.cross.regretPerStep).toBe(0);
        expect(r.guard.flowStarvationFlag).toBe(true); // 没有任何 flow 样本
    });

    it('intentRealizationRate 按 intent 分桶', () => {
        const led = createEvaluationLedger();
        const t = 1_700_000_000_000;
        // 三个 spawn 事件：一个 relief 成功（stress 下降），一个 pressure 失败，一个 maintain。
        const i1 = recordSpawnEvent(led, { spawnIntent: 'relief', ts: t, stressAtSpawn: 0.7 });
        finalizeSpawnEvent(led, i1, { stressAfter: 0.5, linesInRound: 1, dockPermUsed: [0, 1, 2] });
        const i2 = recordSpawnEvent(led, { spawnIntent: 'pressure', ts: t + 1000, stressAtSpawn: 0.3 });
        finalizeSpawnEvent(led, i2, { stressAfter: 0.25, linesInRound: 0, dockPermUsed: [1, 2, 0] });
        const i3 = recordSpawnEvent(led, { spawnIntent: 'maintain', ts: t + 2000, stressAtSpawn: 0.4 });
        finalizeSpawnEvent(led, i3, { stressAfter: 0.42, linesInRound: 1, dockPermUsed: [0, 2, 1] });
        setLedgerOutcome(led, { finalScore: 100, runDurationMs: 60000, endCause: 'normal' });
        const r = buildSessionEvalRecord(led);
        expect(r.spawnAudit.intentRealizationRate.relief).toBe(1);
        expect(r.spawnAudit.intentRealizationRate.pressure).toBe(0);
        expect(r.spawnAudit.intentRealizationRate.maintain).toBe(1);
        expect(r.spawnAudit.dockUsageEntropy).toBeGreaterThan(1.5);
    });

    it('rageQuit 标志位：短局 + 远低于 PB', () => {
        const led = createEvaluationLedger({ pbBefore: 1000 });
        setLedgerOutcome(led, { finalScore: 100, runDurationMs: 15000, endCause: 'jam' });
        const r = buildSessionEvalRecord(led);
        expect(r.guard.rageQuitFlag).toBe(true);
    });

    it('forcedBadRatio = forced_bad 轮数 / 总轮数', () => {
        const led = createEvaluationLedger();
        recordRoundQuality(led, { classification: 'forced_bad' });
        recordRoundQuality(led, { classification: 'optimal' });
        recordRoundQuality(led, { classification: 'payoff_missed' });
        recordRoundQuality(led, { classification: 'forced_bad' });
        setLedgerOutcome(led, { finalScore: 200, runDurationMs: 60000 });
        const r = buildSessionEvalRecord(led);
        expect(r.cross.forcedBadRatio).toBeCloseTo(0.5, 2);
        expect(r.cross.optimalRoundRatio).toBeCloseTo(0.25, 2);
    });

    it('arcContext 透传 RoR 字段', () => {
        const led = createEvaluationLedger({
            dailyRunIndex: 3, runOverRunArc: 'fatigue', runStreak: 2,
            pbBefore: 1500, lifecycleStage: 'growth', maturityBand: 'M2',
        });
        patchLedgerMeta(led, { pbAfter: 1600 });
        setLedgerOutcome(led, { finalScore: 800, runDurationMs: 60000 });
        const r = buildSessionEvalRecord(led);
        expect(r.arcContext.runOverRunArc).toBe('fatigue');
        expect(r.arcContext.dailyRunIndex).toBe(3);
        expect(r.arcContext.pbAfter).toBe(1600);
        expect(r.arcContext.maturityBand).toBe('M2');
    });

    it('trajectory.boardStressAUC 是 stress 流的梯形积分', () => {
        const led = createEvaluationLedger();
        const t0 = 1_700_000_000_000;
        recordStressSample(led, 0.2, t0);
        recordStressSample(led, 0.4, t0 + 1000);
        recordStressSample(led, 0.6, t0 + 2000);
        recordFlowSample(led, 'flow');
        recordFlowSample(led, 'flow');
        recordBoardSample(led, { holes: 0, flatness: 1, firstMoveFreedom: 5 });
        setLedgerOutcome(led, { finalScore: 100, runDurationMs: 2000 });
        const r = buildSessionEvalRecord(led);
        expect(r.trajectory.boardStressAUC).toBeCloseTo(0.4, 2);
        expect(r.trajectory.peakStress).toBeCloseTo(0.6, 2);
        expect(r.guard.flowRatio).toBe(1);
        expect(r.guard.flowStarvationFlag).toBe(false);
    });
});
