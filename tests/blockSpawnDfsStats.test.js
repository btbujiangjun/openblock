/**
 * blockSpawn DFS budget 占用观测（v1.71 V4）：
 * 零行为变更前提下，验证 _recordDfsUsage 正确计数 + getBlockSpawnDfsStats 暴露快照。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { generateDockShapes, getBlockSpawnDfsStats, resetBlockSpawnDfsStats } from '../web/src/bot/blockSpawn.js';
import { resolveAdaptiveStrategy } from '../web/src/adaptiveSpawn.js';

function makeProfile(overrides = {}) {
    return {
        smoothSkill: 0.55, lifetimeGames: 12, lifetimePlacements: 300, spawnCounter: 30,
        frustrationLevel: 0, needsRecovery: false, sessionPhase: 'mid', momentum: 0,
        comboChain: 0.2, hadRecentNearMiss: false, isInOnboarding: false,
        playstyle: 'balanced', metrics: { comboRate: 0.18 }, ...overrides,
    };
}

function makeGrid(fillRatio = 0.45) {
    const g = new Grid(8);
    const filled = Math.round(64 * fillRatio);
    let placed = 0, seed = 1234567;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    while (placed < filled) {
        const x = Math.floor(rand() * 8);
        const y = Math.floor(rand() * 8);
        if (g.cells[y][x] == null) { g.cells[y][x] = 1; placed++; }
    }
    return g;
}

describe('blockSpawn V4 — DFS budget 占用观测', () => {
    beforeEach(() => {
        resetBlockSpawnDfsStats();
    });

    it('初始快照：全 0', () => {
        const s = getBlockSpawnDfsStats();
        expect(s.totalCalls).toBe(0);
        expect(s.truncatedCount).toBe(0);
        expect(s.truncatedRatio).toBe(0);
        expect(s.budgetUsageHist).toEqual([0, 0, 0, 0]);
    });

    it('一次 generateDockShapes 至少触发 1 次 dfs 统计', () => {
        const grid = makeGrid(0.55);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.55, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        const s = getBlockSpawnDfsStats();
        expect(s.totalCalls).toBeGreaterThan(0);
    });

    it('多次累加：totalCalls 单调递增', () => {
        const grid = makeGrid(0.45);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        const ctx = { score: 800, bestScore: 1500, roundCounter: 24 };

        generateDockShapes(grid, strategy, ctx);
        const s1 = getBlockSpawnDfsStats();
        generateDockShapes(grid, strategy, ctx);
        const s2 = getBlockSpawnDfsStats();
        expect(s2.totalCalls).toBeGreaterThanOrEqual(s1.totalCalls);
    });

    it('budgetUsageHist 之和 ≤ totalCalls（某些 short-circuit 不入桶）', () => {
        const grid = makeGrid(0.55);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.55, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        const s = getBlockSpawnDfsStats();
        const histSum = s.budgetUsageHist.reduce((a, b) => a + b, 0);
        expect(histSum).toBeLessThanOrEqual(s.totalCalls);
    });

    it('truncatedRatio 在 [0, 1] 范围', () => {
        const grid = makeGrid(0.7); /* 高 fill 更可能 truncated */
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.7, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        const s = getBlockSpawnDfsStats();
        expect(s.truncatedRatio).toBeGreaterThanOrEqual(0);
        expect(s.truncatedRatio).toBeLessThanOrEqual(1);
    });

    it('reset 清零所有计数', () => {
        const grid = makeGrid(0.5);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.5, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        expect(getBlockSpawnDfsStats().totalCalls).toBeGreaterThan(0);
        resetBlockSpawnDfsStats();
        expect(getBlockSpawnDfsStats().totalCalls).toBe(0);
        expect(getBlockSpawnDfsStats().budgetUsageHist).toEqual([0, 0, 0, 0]);
    });

    it('快照是副本，外部修改不影响内部', () => {
        const s = getBlockSpawnDfsStats();
        s.budgetUsageHist[0] = 99999;
        expect(getBlockSpawnDfsStats().budgetUsageHist[0]).toBe(0);
    });
});

describe('blockSpawn X4 — leafCap 观测', () => {
    beforeEach(() => {
        resetBlockSpawnDfsStats();
    });

    it('初始快照含 leafCap 字段且全 0', () => {
        const s = getBlockSpawnDfsStats();
        expect(s.cappedCount).toBe(0);
        expect(s.cappedRatio).toBe(0);
        expect(s.leafUsageHist).toEqual([0, 0, 0, 0]);
        expect(s.evalTripletCalls).toBe(0);
    });

    it('一次 generateDockShapes 后 evalTripletCalls > 0', () => {
        const grid = makeGrid(0.55);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.55, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        const s = getBlockSpawnDfsStats();
        expect(s.evalTripletCalls).toBeGreaterThan(0);
        const histSum = s.leafUsageHist.reduce((a, b) => a + b, 0);
        expect(histSum).toBe(s.evalTripletCalls);
    });

    it('cappedRatio 在 [0, 1] 范围', () => {
        const grid = makeGrid(0.3); /* 低 fill 解空间大，更可能触顶 */
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.3, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        const s = getBlockSpawnDfsStats();
        expect(s.cappedRatio).toBeGreaterThanOrEqual(0);
        expect(s.cappedRatio).toBeLessThanOrEqual(1);
    });

    it('reset 同时清零 leafCap 计数', () => {
        const grid = makeGrid(0.45);
        const profile = makeProfile();
        const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, {
            totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
        });
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: 24 });
        expect(getBlockSpawnDfsStats().evalTripletCalls).toBeGreaterThan(0);
        resetBlockSpawnDfsStats();
        const s = getBlockSpawnDfsStats();
        expect(s.cappedCount).toBe(0);
        expect(s.evalTripletCalls).toBe(0);
        expect(s.leafUsageHist).toEqual([0, 0, 0, 0]);
    });

    it('leafUsageHist 快照是副本', () => {
        const s = getBlockSpawnDfsStats();
        s.leafUsageHist[2] = 99999;
        expect(getBlockSpawnDfsStats().leafUsageHist[2]).toBe(0);
    });
});
