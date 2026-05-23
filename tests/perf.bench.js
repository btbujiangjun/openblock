/**
 * perf.bench.js — 渲染层 CPU 基准（Vitest bench 模式）
 *
 * 运行：
 *   npm run perf:bench              # 跑全部
 *   npm run perf:bench -- --grep spawn   # 过滤场景
 *
 * 输出：
 *   每个 bench 给出 hz（次/秒）/ rme（误差）/ p99 / mean / median，
 *   多场景之间会自动做 baseline 对比。
 *
 * 设计原则
 * --------
 * - 只测 CPU/逻辑层（adaptiveSpawn / blockSpawn / stress / PB curve）；
 *   不测 canvas / GPU 合成（那是 perfOverlay 在浏览器里做的事）。
 * - 每个 bench 的输入是真实 game-loop 触发路径上的数据形态（profile + grid + ctx），
 *   不能手搓空对象骗过早返回分支。
 * - 复用 vitest 已经处理好的 JSON import-attributes 与 ESM module 解析。
 */

import { bench, describe } from 'vitest';
import { resolveAdaptiveStrategy, derivePbCurve, deriveSpawnTargets } from '../web/src/adaptiveSpawn.js';
import { generateDockShapes } from '../web/src/bot/blockSpawn.js';
import { Grid } from '../web/src/grid.js';
import { getStressAmbience } from '../web/src/stressAmbience.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { analyzeBoardTopology, countUnfillableCells, detectNearClears, computeCoverableCells } from '../web/src/boardTopology.js';
import { getAllShapes } from '../web/src/shapes.js';

function makeProfile(overrides = {}) {
    return {
        smoothSkill: 0.55,
        lifetimeGames: 12,
        lifetimePlacements: 300,
        spawnCounter: 30,
        frustrationLevel: 0,
        needsRecovery: false,
        sessionPhase: 'mid',
        momentum: 0,
        comboChain: 0.2,
        hadRecentNearMiss: false,
        isInOnboarding: false,
        playstyle: 'balanced',
        metrics: { comboRate: 0.18 },
        ...overrides,
    };
}

function makeGrid(fillRatio = 0.35) {
    const g = new Grid(8);
    /* Grid.createEmptyGrid() 把空格初始化为 null（不是 0），所以判空必须用 == null。 */
    const filled = Math.round(8 * 8 * fillRatio);
    let placed = 0;
    let seed = 1234567;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    while (placed < filled) {
        const x = Math.floor(rand() * 8);
        const y = Math.floor(rand() * 8);
        if (g.cells[y][x] == null) {
            g.cells[y][x] = 1 + Math.floor(rand() * 5);
            placed++;
        }
    }
    return g;
}

/* time=800ms 在精度（rme ±2%）与总耗时（每场景 1s 左右）之间取折衷。
 * 全部 bench 跑 < 30s，方便 PR 工作流 / 本地迭代。 */
const BENCH_OPTS = { time: 800, warmupTime: 150, warmupIterations: 10 };

describe('perf · adaptiveSpawn', () => {
    const profile = makeProfile();
    const ctx = { totalRounds: 24, bestScore: 1500, roundsSinceClear: 1 };

    bench('resolveAdaptiveStrategy(normal, mid-game)', () => {
        resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, ctx);
    }, BENCH_OPTS);

    bench('resolveAdaptiveStrategy(hard, frustrated)', () => {
        resolveAdaptiveStrategy('hard', { ...profile, frustrationLevel: 0.6 }, 200, 0, 0.62, {
            ...ctx, roundsSinceClear: 5,
        });
    }, BENCH_OPTS);

    bench('derivePbCurve(near-PB)', () => {
        derivePbCurve(1400, 1500, false);
    }, BENCH_OPTS);

    bench('derivePbCurve(release-window)', () => {
        derivePbCurve(1600, 1500, true);
    }, BENCH_OPTS);

    bench('deriveSpawnTargets(stress=0.55)', () => {
        deriveSpawnTargets(0.55, profile, 24, 0.4);
    }, BENCH_OPTS);
});

describe('perf · blockSpawn', () => {
    const profile = makeProfile();
    /* 真实 game loop 输入：先跑 resolveAdaptiveStrategy 拿 strategyConfig，
     * 这是 generateDockShapes 的实际入参（含 shapeWeights / hints / 玩家快照）。 */
    const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, {
        totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
    });
    const grid35 = makeGrid(0.35);
    const grid55 = makeGrid(0.55);
    const grid70 = makeGrid(0.70);
    const spawnCtx = { score: 800, bestScore: 1500, roundCounter: 24 };

    bench('generateDockShapes(fill=0.35)', () => {
        generateDockShapes(grid35, strategy, spawnCtx);
    }, BENCH_OPTS);

    bench('generateDockShapes(fill=0.55)', () => {
        generateDockShapes(grid55, strategy, spawnCtx);
    }, BENCH_OPTS);

    bench('generateDockShapes(fill=0.70)', () => {
        generateDockShapes(grid70, strategy, spawnCtx);
    }, BENCH_OPTS);
});

describe('perf · sub-paths (heaviest internal helpers)', () => {
    const grid55 = makeGrid(0.55);
    const shapePool = getAllShapes();
    const shape4 = shapePool.find((s) => s.id === 'l4-a')?.data || [[1, 1], [1, 1]];
    const shape2 = [[1, 1]];
    const topo = analyzeBoardTopology(grid55);
    // eslint-disable-next-line no-console
    console.log(`[diag] makeGrid(0.55): holes=${topo.holes} nearFullLines=${topo.nearFullLines} shapes=${shapePool.length}`);

    bench('Grid.clone()', () => {
        grid55.clone();
    }, BENCH_OPTS);

    bench('Grid.canPlaceAnywhere(shape4)', () => {
        grid55.canPlaceAnywhere(shape4);
    }, BENCH_OPTS);

    bench('Grid.previewClearOutcome', () => {
        grid55.previewClearOutcome(shape4, 0, 0, 0);
    }, BENCH_OPTS);

    bench('Grid.bestExactFit(shape4)', () => {
        grid55.bestExactFit?.(shape4);
    }, BENCH_OPTS);

    bench('Grid.bestMonoFlushPotential(shape4)', () => {
        grid55.bestMonoFlushPotential?.(shape4, null, { returnTarget: true });
    }, BENCH_OPTS);

    bench('Grid.bestMonoFlushBuildup(shape4)', () => {
        grid55.bestMonoFlushBuildup?.(shape4, null, 6);
    }, BENCH_OPTS);

    bench('analyzeBoardTopology(grid55)', () => {
        analyzeBoardTopology(grid55);
    }, BENCH_OPTS);

    bench('detectNearClears(grid55)', () => {
        detectNearClears(grid55);
    }, BENCH_OPTS);

    bench('Grid.countValidPlacements(shape4)', () => {
        grid55.countValidPlacements(shape4);
    }, BENCH_OPTS);

    bench('Grid.countGapFills(shape4)', () => {
        grid55.countGapFills?.(shape4);
    }, BENCH_OPTS);

    /* 模拟 generateDockShapes 主循环：对 40+ shape 各跑一组 best*Potential —— 这是真正的热点路径
     * 如果这里也很慢，说明优化方向是减少 shape pool 遍历或缓存重复操作。 */
    bench('main loop: 40 shapes × {canPlace,bestExactFit,bestMonoFlush*} on grid55', () => {
        for (const sh of shapePool) {
            if (!grid55.canPlaceAnywhere(sh.data)) continue;
            grid55.bestExactFit?.(sh.data);
            grid55.bestMonoFlushPotential?.(sh.data, null, { returnTarget: true });
            grid55.bestMonoFlushBuildup?.(sh.data, null, 6);
        }
    }, BENCH_OPTS);

    /* 直接 bench bestMultiClearPotential：generateDockShapes 内部每形状调用一次，
     * 它对每个合法位都 previewClearOutcome（含一次 grid.cells map([...row]) full copy）。
     * 这是 P0 候选热点。 */
    bench('Grid.previewClearOutcome × all valid positions for shape4', () => {
        const n = 8;
        for (let y = 0; y <= n - 2; y++) {
            for (let x = 0; x <= n - 2; x++) {
                grid55.previewClearOutcome(shape4, x, y, 0);
            }
        }
    }, BENCH_OPTS);

    /* "best multi clear potential" 等价路径：所有合法位 previewClearOutcome 取 max */
    bench('main loop +: 40 shapes × bestMultiClearPotential-like (N² previewClear)', () => {
        const n = 8;
        for (const sh of shapePool) {
            if (!grid55.canPlaceAnywhere(sh.data)) continue;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    if (!grid55.canPlace(sh.data, x, y)) continue;
                    grid55.previewClearOutcome(sh.data, x, y, 0);
                }
            }
        }
    }, BENCH_OPTS);

    bench('main loop +: × countValidPlacements / countGapFills', () => {
        for (const sh of shapePool) {
            if (!grid55.canPlaceAnywhere(sh.data)) continue;
            grid55.countValidPlacements(sh.data);
            grid55.countGapFills?.(sh.data);
        }
    }, BENCH_OPTS);
});

describe('perf · stress / profile', () => {
    bench('getStressAmbience(stress=0.55)', () => {
        getStressAmbience(0.55);
    }, BENCH_OPTS);

    const profile = new PlayerProfile();
    bench('PlayerProfile.recordPlace(cleared=true,3lines)', () => {
        profile.recordPlace(true, 3, 0.45);
    }, BENCH_OPTS);

    bench('PlayerProfile.recordPlace(cleared=false)', () => {
        profile.recordPlace(false, 0, 0.55);
    }, BENCH_OPTS);

    bench('PlayerProfile.metricsForWindow(50)', () => {
        profile.metricsForWindow(50);
    }, BENCH_OPTS);
});
