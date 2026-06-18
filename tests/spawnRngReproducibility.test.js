/**
 * @vitest-environment jsdom
 *
 * 出块链路可复现性（Issue 4 收尾 / 重构方案阶段 1.1）：
 *   generateDockShapes 内部所有概率/随机抽签（monoFlush 判定、Stage-1 clearSeat 选块、
 *   特殊/构造注入、最终洗牌、_sanitizeShapeArr 兜底）统一走可注入 ctx.rng。
 *
 * 保证：
 *   1. 相同 seed → 完全相同的 dock 序列（daily / replay / A-B 可回放）
 *   2. 不同 seed → 序列存在差异（证明随机确实由 seed 驱动，而非被钉死）
 *   3. 不传 rng → 退回 Math.random，仍产出合法 3 块（向后兼容，由既有套件守护）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getStrategy } from '../web/src/config.js';
import { createMulberry32 } from '../web/src/lib/seededRng.js';
import { generateDockShapes, resetSpawnMemory } from '../web/src/bot/blockSpawn.js';

/** 用固定 seed 跑 n 轮出块，返回每轮三块 id 的串行快照。 */
function runSeq(seed, n) {
    resetSpawnMemory();
    const grid = new Grid(8);
    const rng = createMulberry32(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
        // 每轮用全新 config 副本，避免跨轮 diagnostics 写回污染对照
        const config = { ...getStrategy('normal') };
        const shapes = generateDockShapes(grid, config, { rng });
        out.push(shapes.map(s => s.id).join(','));
    }
    return out;
}

describe('spawn RNG 可复现性', () => {
    beforeEach(() => resetSpawnMemory());

    it('相同 seed 产出逐位相同的出块序列', () => {
        const a = runSeq(0xC0FFEE, 40);
        const b = runSeq(0xC0FFEE, 40);
        expect(a).toEqual(b);
        expect(a).toHaveLength(40);
        // 每轮恒为 3 块
        for (const row of a) expect(row.split(',')).toHaveLength(3);
    });

    it('不同 seed 产出的序列存在差异（随机由 seed 驱动）', () => {
        const a = runSeq(1, 60);
        const b = runSeq(2, 60);
        expect(a).not.toEqual(b);
    });

    it('多个固定 seed 的复现互不串扰', () => {
        const seeds = [11, 22, 33];
        const first = seeds.map(s => runSeq(s, 25));
        const second = seeds.map(s => runSeq(s, 25));
        expect(first).toEqual(second);
    });
});
