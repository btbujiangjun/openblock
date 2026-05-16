/**
 * @vitest-environment jsdom
 *
 * v1.55.16：scoreMilestone dead-branch 修复契约回归测试。
 *
 * 背景（事实 3 复核结论）：
 *   - adaptiveSpawn 把里程碑命中信号写在 layered.spawnHints.scoreMilestone（权威源）
 *   - blockSpawn (line 870-872) 读 ctx.scoreMilestone（即 _spawnContext）做 *= 1.3 加权
 *   - _commitSpawn 只在每轮末把 _spawnContext.scoreMilestone 清为 false、从不置 true
 *   → 历史上 blockSpawn 那条 1.3 倍加权在主路径下从未触发（dead branch）
 *
 * 修复（web/src/game.js spawnBlocks() 顶部桥接）：
 *   在调 generateDockShapes 之前把 layered.spawnHints.scoreMilestone 写回
 *   this._spawnContext.scoreMilestone，让 hints 成为唯一权威输入。
 *
 * 本测试用 vi.mock 替换 resolveAdaptiveStrategy / generateDockShapes（避免依赖
 * grid / blockSpawn 的真实抽块），只校验桥接这一行的契约：
 *   1) hints.scoreMilestone === true 时，generateDockShapes 收到的 ctx.scoreMilestone === true
 *   2) hints.scoreMilestone === false 时，ctx.scoreMilestone === false
 *   3) hints.scoreMilestone 缺省（undefined）时，ctx.scoreMilestone === false
 *   4) _commitSpawn 末尾会把 _spawnContext.scoreMilestone 清回 false（栈底重置不变）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const layeredCapture = { value: null };
const ctxCapture = { value: null };

vi.mock('../web/src/adaptiveSpawn.js', async () => {
    const actual = await vi.importActual('../web/src/adaptiveSpawn.js');
    return {
        ...actual,
        resolveAdaptiveStrategy: vi.fn(() => layeredCapture.value),
    };
});

vi.mock('../web/src/bot/blockSpawn.js', async () => {
    const actual = await vi.importActual('../web/src/bot/blockSpawn.js');
    return {
        ...actual,
        generateDockShapes: vi.fn((_grid, _layered, ctx) => {
            ctxCapture.value = {
                scoreMilestone: ctx?.scoreMilestone,
                ctxRef: ctx,
            };
            return [
                { id: 1, data: [[1]] },
                { id: 2, data: [[1]] },
                { id: 3, data: [[1]] },
            ];
        }),
        getLastSpawnDiagnostics: vi.fn(() => ({ layer1: {} })),
    };
});

vi.mock('../web/src/spawnModel.js', async () => {
    const actual = await vi.importActual('../web/src/spawnModel.js');
    return {
        ...actual,
        // 强制走 rule 路径，避免 spawnBlocks 走入模型异步分支
        getSpawnMode: vi.fn(() => actual.SPAWN_MODE_RULE),
    };
});

const { Game } = await import('../web/src/game.js');

function makeFakeGame(initialScoreMilestoneOnCtx = false) {
    const game = {
        strategy: 'normal',
        playerProfile: {
            recordSpawn: vi.fn(),
        },
        score: 600,
        runStreak: 0,
        bestScore: 1000,
        grid: {
            getFillRatio: () => 0.3,
        },
        dockBlocks: [],
        _spawnContext: {
            lastClearCount: 0,
            roundsSinceClear: 0,
            recentCategories: [],
            totalRounds: 0,
            scoreMilestone: initialScoreMilestoneOnCtx,
            bestScore: 1000,
            bottleneckTrough: Infinity,
            bottleneckSolutionTrough: Infinity,
            bottleneckSamples: 0,
        },
        _captureAdaptiveInsight: vi.fn(),
        checkGameOver: vi.fn(),
    };
    /* 简化版 _commitSpawn：只复现"栈底重置 scoreMilestone = false"这一与本测试相关的语义；
     * 其它副作用（populateDockUI / 诊断回写 / postPb 计数等）不在本契约范围内。 */
    game._commitSpawn = vi.fn(function commitSpawnStub() {
        this._spawnContext.scoreMilestone = false;
    });
    return game;
}

describe('Game.spawnBlocks(): scoreMilestone hints → ctx bridge (v1.55.16)', () => {
    beforeEach(() => {
        layeredCapture.value = null;
        ctxCapture.value = null;
    });

    it('当 layered.spawnHints.scoreMilestone === true，传给 blockSpawn 的 ctx.scoreMilestone === true', () => {
        layeredCapture.value = {
            spawnHints: { scoreMilestone: true, scoreMilestoneValue: 500 },
            _adaptiveStress: 0.4,
        };

        const game = makeFakeGame(false);
        Game.prototype.spawnBlocks.call(game, { checkGameOver: false });

        expect(ctxCapture.value).not.toBeNull();
        expect(ctxCapture.value.scoreMilestone).toBe(true);
    });

    it('当 layered.spawnHints.scoreMilestone === false，传给 blockSpawn 的 ctx.scoreMilestone === false（即便桥接前 ctx 旧值是 true，桥接也强制对齐 hints）', () => {
        layeredCapture.value = {
            spawnHints: { scoreMilestone: false, scoreMilestoneValue: null },
            _adaptiveStress: 0.4,
        };

        const game = makeFakeGame(true); // 故意把旧 ctx 值设成 true
        Game.prototype.spawnBlocks.call(game, { checkGameOver: false });

        expect(ctxCapture.value.scoreMilestone).toBe(false);
    });

    it('当 layered.spawnHints 缺省 scoreMilestone（undefined），ctx.scoreMilestone === false（避免 truthy 误判）', () => {
        layeredCapture.value = {
            spawnHints: { /* no scoreMilestone field */ },
            _adaptiveStress: 0.4,
        };

        const game = makeFakeGame(false);
        Game.prototype.spawnBlocks.call(game, { checkGameOver: false });

        expect(ctxCapture.value.scoreMilestone).toBe(false);
    });

    it('_commitSpawn 末尾会把 _spawnContext.scoreMilestone 清回 false（栈底重置语义不变）', () => {
        layeredCapture.value = {
            spawnHints: { scoreMilestone: true, scoreMilestoneValue: 500 },
            _adaptiveStress: 0.4,
        };

        const game = makeFakeGame(false);
        Game.prototype.spawnBlocks.call(game, { checkGameOver: false });

        // 出块完成后 _spawnContext.scoreMilestone 应被 _commitSpawn 清零，
        // 防止隔轮残留（下一轮 spawnBlocks 顶部会再按新 hints 重新桥接）。
        expect(game._spawnContext.scoreMilestone).toBe(false);
    });
});
