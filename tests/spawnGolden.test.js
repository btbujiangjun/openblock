/**
 * @vitest-environment jsdom
 *
 * 出块黄金快照（v1.70 拆分安全网）
 *
 * 目的：
 *   为 `_tryInjectSpecial` / 主管线后续拆分提供"行为差分捕获"——任何 dock 序列、
 *   chosen 顺序、topDriver 分布的偏移都会让快照 diff fail，比 121 个功能测试
 *   更早暴露隐性回归。
 *
 * 设计：
 *   - 3 个盘面预设（空 / 半满 / 高压）× 6 个 seed × 30 轮 = 540 个三连样本
 *   - 每个样本 = `[round, [ids], [topDriverKeys], attemptCount]`
 *     - `ids` 与 `topDriverKeys` 之间的索引必须严格对齐（v1.59.19 不变式守护）
 *     - 不抓 timestamp / 对象引用 / 浮点小数，避免快照不稳
 *   - resetSpawnMemory() 每轮前调用，确保 spawn 历史记忆隔离
 *
 * 维护：
 *   - 故意改动行为（如 _tryInjectSpecial 调参）→ 评审 diff 后 `vitest -u` 更新快照
 *   - 拆分重构（应零行为变化）→ 任何 diff 都说明出错，先回滚再排查
 *
 * 性能：
 *   3 × 6 × 30 = 540 次 generateDockShapes 调用，本机约 2 秒；CI 可接受。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getStrategy } from '../web/src/config.js';
import { createMulberry32 } from '../web/src/lib/seededRng.js';
import { generateDockShapes, getLastSpawnDiagnostics, resetSpawnMemory } from '../web/src/bot/blockSpawn.js';

const SEEDS = [0xA11CE, 0xB0BCAFE, 0xC0DECAFE, 0xDEC0DE, 0xFEEDBEE, 0x101010];
const ROUNDS_PER_SEED = 30;

/** 预设盘面：用固定 seed 跑 grid.initBoard，结果跨平台逐字节一致。 */
function buildBoard(preset) {
    const grid = new Grid(8);
    if (preset === 'empty') return grid;
    const fillRng = createMulberry32(0x5EED ^ (preset === 'half' ? 1 : 2));
    grid.initBoard(preset === 'half' ? 0.35 : 0.6, {}, fillRng);
    return grid;
}

/** 跑 N 轮，返回精简快照（仅锁定结构性字段，避免浮点漂移）。 */
function captureSnapshot(preset, seed) {
    resetSpawnMemory();
    const grid = buildBoard(preset);
    const rng = createMulberry32(seed);
    const samples = [];
    for (let r = 0; r < ROUNDS_PER_SEED; r++) {
        const config = { ...getStrategy('normal') };
        const shapes = generateDockShapes(grid, config, { rng });
        const diag = getLastSpawnDiagnostics();
        const ids = shapes.map(s => s.id);
        const drivers = (diag?.chosen || []).map(c => c?.topDriver?.key ?? null);
        const attempt = diag?.attempt ?? null;
        samples.push({ r, ids, drivers, attempt });
    }
    return samples;
}

describe('spawn 黄金快照（拆分安全网）', () => {
    beforeEach(() => resetSpawnMemory());

    for (const preset of ['empty', 'half', 'high']) {
        for (const seed of SEEDS) {
            it(`preset=${preset} seed=0x${seed.toString(16).toUpperCase()}`, () => {
                const snap = captureSnapshot(preset, seed);
                expect(snap).toHaveLength(ROUNDS_PER_SEED);
                /* 形状不变式：每轮恒 3 块，driver 数组与 ids 等长。 */
                for (const s of snap) {
                    expect(s.ids).toHaveLength(3);
                    expect(s.drivers).toHaveLength(3);
                }
                expect(snap).toMatchSnapshot();
            });
        }
    }
});
