/**
 * @vitest-environment jsdom
 *
 * 端无关 evaluationHost 契约测试：用 mockHost 走完整 spawn→3 place→spawn→gameOver
 * 流程，断言：
 *  - ledger 在 session 开始后存在
 *  - 三次 evalOnPlace 调用后 lastMoveEvalSnapshot 已更新
 *  - 关轮后 lastRoundEvalMetrics 写入 + ledger.roundQualities 长度 ≥ 1
 *  - gameOver 触发 postSessionEvalRecord，且 record 含 outcome.finalScore
 */
import { describe, it, expect, vi } from 'vitest';
import {
    evalOnSessionStart,
    evalOnSpawn,
    evalOnPlace,
    evalCloseRound,
    evalOnGameOver,
} from '../../web/src/evaluation/evaluationHost.js';

const N = 8;
const emptyBoard = () => Array.from({ length: N }, () => Array(N).fill(null));

function mkHost(post) {
    const grid = emptyBoard();
    return {
        // host 状态字段
        evalLedger: null,
        evalActiveSpawnIdx: -1,
        evalRoundStartCells: null,
        evalRoundMoves: [],
        evalRoundDockShapes: null,
        evalRoundLines: 0,
        evalRoundStressAtSpawn: 0,
        lastMoveEvalMetrics: null,
        lastRoundEvalMetrics: null,
        lastMoveEvalSnapshot: null,
        evalPendingBoardBefore: null,
        // host getters
        _grid: grid,
        getGridCells() { return this._grid.map((r) => r.slice()); },
        getDockBlocks() { return [{ placed: false }, { placed: false }, { placed: false }]; },
        getAdaptiveInsight() {
            return {
                spawnHints: {
                    spawnIntent: 'engage', clearGuarantee: 1,
                    targetSolutionRange: [3, 6],
                    spawnTargets: { payoffIntensity: 0.4 },
                },
                flowState: 'flow',
            };
        },
        getSpawnDiagnostics() {
            return {
                layer1: { holes: 0, flatness: 1.0,
                    solutionMetrics: { solutionCount: 4, firstMoveFreedom: 0.5 } },
                solutionRejects: { tooFew: 1, tooMany: 0 },
                attempt: 2,
            };
        },
        getStress() { return 0.4; },
        getRulesConfig(section, fb) {
            if (section === 'placementEvaluation') return { enabled: true, weights: { contact: 0.25, tidiness: 0.25, holeSafety: 0.2, payoff: 0.2, unlocking: 0.1 } };
            if (section === 'roundEvaluation') return { enabled: true, weights: { solutionUsage: 0.2, pathQuality: 0.2, payoffRealized: 0.3, endFlatness: 0.2, continuity: 0.1 } };
            return fb || {};
        },
        getUserId() { return 'u-test'; },
        getStrategy() { return 'normal'; },
        postSessionEvalRecord: post,
    };
}

describe('evaluationHost end-to-end', () => {
    it('完整一局：spawn → 3 place → gameOver → 上报 record', async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const host = mkHost(post);
        const shape = [[1, 1]];        // 1x2 形状

        evalOnSessionStart(host, { runId: 'r1' });
        expect(host.evalLedger).toBeTruthy();

        evalOnSpawn(host, [{ shape, data: shape }, { shape, data: shape }, { shape, data: shape }]);
        expect(host.evalActiveSpawnIdx).toBeGreaterThanOrEqual(0);

        for (let i = 0; i < 3; i++) {
            host.evalPendingBoardBefore = host.getGridCells();
            evalOnPlace(host, i, { x: i * 2, y: 7 }, 0);
        }
        expect(host.lastMoveEvalSnapshot).toBeTruthy();
        expect(['optimal', 'fine', 'created_hole', 'top_stacking', 'wasted_payoff'])
            .toContain(host.lastMoveEvalSnapshot.badnessTag);

        evalCloseRound(host);
        expect(host.lastRoundEvalMetrics).toBeTruthy();
        expect(host.evalActiveSpawnIdx).toBe(-1);
        expect(host.evalLedger.roundQualities.length).toBe(1);
        expect(host.evalLedger.moveQualities.length).toBe(3);

        await evalOnGameOver(host, {
            finalScore: 120, survivedSteps: 3, placedCount: 3,
            linesCleared: 0, maxCombo: 0, runDurationMs: 5000, endCause: 'normal',
        });

        expect(post).toHaveBeenCalledTimes(1);
        const rec = post.mock.calls[0][0];
        expect(rec.outcome.finalScore).toBe(120);
        expect(rec.spawnAudit).toBeTruthy();
        expect(host.evalLedger).toBeNull();
    });

    it('ledger 缺失时所有钩子 noop，不抛错', async () => {
        const host = mkHost(vi.fn());
        // 不调 evalOnSessionStart
        expect(() => evalOnSpawn(host, [])).not.toThrow();
        expect(() => evalOnPlace(host, 0, { x: 0, y: 0 }, 0)).not.toThrow();
        expect(() => evalCloseRound(host)).not.toThrow();
        await expect(evalOnGameOver(host, {})).resolves.toBeUndefined();
    });

    it('host getters 抛错时不传染到主流程', () => {
        const host = mkHost(vi.fn());
        host.getSpawnDiagnostics = () => { throw new Error('boom'); };
        evalOnSessionStart(host);
        expect(() => evalOnSpawn(host, [{ shape: [[1]], data: [[1]] }])).not.toThrow();
    });
});
