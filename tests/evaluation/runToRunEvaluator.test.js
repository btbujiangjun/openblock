/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { buildIntraDayReport, buildMultiDayReport, compareModelVersions } from '../../web/src/evaluation/runToRunEvaluator.js';

function makeSession({ ts, arc, score, regret = 0.1, forcedBad = 0, salvage = 0, peak = 0.5, flowRatio = 0.4, pbBefore = 1000, pbAfter = null, endCause = 'normal', durationMs = 60000 }) {
    return {
        schemaVersion: 1,
        meta: { startedAt: ts, endedAt: ts + durationMs, modelVersion: 'v1' },
        outcome: { finalScore: score, runDurationMs: durationMs, endCause },
        trajectory: { boardStressAUC: peak * 0.8, peakStress: peak },
        cross: { regretPerStep: regret, forcedBadRatio: forcedBad, salvageRatio: salvage },
        spawnAudit: { guaranteeBreachRate: 0.05, payoffRealizationRate: 0.6, intentRealizationRate: { relief: 0.8, pressure: 0.7 } },
        guard: { rageQuitFlag: false, flowStarvationFlag: false, flowRatio },
        arcContext: { runOverRunArc: arc, dailyRunIndex: 1, pbBefore, pbAfter: pbAfter ?? pbBefore },
    };
}

describe('buildIntraDayReport', () => {
    const D0 = new Date('2026-06-09T08:00:00').getTime();
    const D1 = D0 + 30 * 60 * 1000;
    const D2 = D0 + 60 * 60 * 1000;

    it('返回 dailyRunCount / arcCoverage / 各项斜率', () => {
        const sessions = [
            makeSession({ ts: D0, arc: 'opener', score: 200, regret: 0.2 }),
            makeSession({ ts: D1, arc: 'momentum', score: 400, regret: 0.18 }),
            makeSession({ ts: D2, arc: 'peak', score: 600, regret: 0.15 }),
        ];
        const r = buildIntraDayReport(sessions);
        expect(r.dailyRunCount).toBe(3);
        expect(r.arcCoverage.sort()).toEqual(['momentum', 'opener', 'peak']);
        expect(r.intraDayScoreSlope).toBeGreaterThan(0);
        expect(r.intraDayRegretSlope).toBeLessThan(0);
    });

    it('cooldown 后回到 opener/momentum → breakAfterCooldownRate=1', () => {
        const sessions = [
            makeSession({ ts: D0, arc: 'cooldown', score: 100 }),
            makeSession({ ts: D1, arc: 'opener', score: 300 }),
        ];
        const r = buildIntraDayReport(sessions);
        expect(r.breakAfterCooldownRate).toBe(1);
    });

    it('60s 窗口 vs 5s 窗口：捕获率比值', () => {
        // 制造两次"低分立刻重开"，gap 在 10s（>5s 但 <60s）。
        const ts0 = D0;
        const dur = 8000;
        const ts1 = ts0 + dur + 10000; // 与上局结束相差 10s
        const sessions = [
            makeSession({ ts: ts0, arc: 'opener', score: 100, pbBefore: 1000, durationMs: dur }),
            makeSession({ ts: ts1, arc: 'cooldown', score: 200, pbBefore: 1000 }),
        ];
        const r = buildIntraDayReport(sessions);
        expect(r.rageRestartCatch.within60s).toBe(1);
        expect(r.rageRestartCatch.within5s).toBe(0);
    });
});

describe('buildMultiDayReport', () => {
    it('PB 推进与窗口聚合', () => {
        const day = 24 * 3600 * 1000;
        const now = Date.now();
        const sessions = [
            makeSession({ ts: now - 6 * day, arc: 'opener', score: 200, pbBefore: 1000, pbAfter: 1100 }),
            makeSession({ ts: now - 3 * day, arc: 'momentum', score: 500, pbBefore: 1100, pbAfter: 1300 }),
            makeSession({ ts: now - 1 * day, arc: 'peak', score: 800, pbBefore: 1300, pbAfter: 1500 }),
        ];
        const r = buildMultiDayReport(sessions, { windowDays: 7 });
        expect(r.sessionCount).toBe(3);
        expect(r.pbProgression.delta).toBe(500);
        expect(r.pbProgression.end).toBe(1500);
    });
});

describe('compareModelVersions', () => {
    it('regret 显著升高 → 推荐回滚', () => {
        const day = 24 * 3600 * 1000;
        const now = Date.now();
        const A = [
            makeSession({ ts: now - 2 * day, arc: 'opener', score: 600, regret: 0.10, forcedBad: 0.05 }),
            makeSession({ ts: now - 1 * day, arc: 'momentum', score: 700, regret: 0.12, forcedBad: 0.05 }),
        ];
        const B = [
            makeSession({ ts: now - 2 * day, arc: 'opener', score: 400, regret: 0.30, forcedBad: 0.20 }),
            makeSession({ ts: now - 1 * day, arc: 'momentum', score: 500, regret: 0.32, forcedBad: 0.22 }),
        ];
        const r = compareModelVersions(A, B);
        expect(r.trigger.rollbackRecommended).toBe(true);
        expect(r.trigger.reasons.length).toBeGreaterThan(0);
    });
});
