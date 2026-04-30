/**
 * Bonus 行列特征测试：
 * - 整行/整列同 icon（允许不同 colorIdx 映射到同一 icon）触发 bonus
 * - 无 icon 皮肤时，退化为“同颜色”触发 bonus
 * - 与 ClearRuleEngine.apply 联动时，必须在清除前检测
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { ClearRuleEngine, RowColRule } from '../web/src/clearRules.js';
import {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors,
} from '../web/src/game.js';
import { getAllShapes } from '../web/src/shapes.js';

function fillRow(grid, row, values) {
    for (let x = 0; x < grid.size; x++) grid.cells[row][x] = values[x];
}

function fillCol(grid, col, values) {
    for (let y = 0; y < grid.size; y++) grid.cells[y][col] = values[y];
}

function shapeLinePotential(shape) {
    const rows = new Set();
    const cols = new Set();
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            rows.add(y);
            cols.add(x);
        }
    }
    return rows.size + cols.size;
}

function expectedScore(count, bonusCount, baseUnit = 20) {
    const safeBonus = Math.min(bonusCount, count);
    const baseScore = count > 0 ? baseUnit * count * count : 0;
    const lineScore = baseUnit * count;
    const iconBonusScore = lineScore * safeBonus * (ICON_BONUS_LINE_MULT - 1);
    return { baseScore, iconBonusScore, clearScore: baseScore + iconBonusScore };
}

describe('bonus line feature', () => {
    it('当前形状库单次理论最大消除行列数为 6', () => {
        const maxLines = Math.max(...getAllShapes().map((s) => shapeLinePotential(s.data)));
        expect(maxLines).toBe(6);
    });

    it(`computeClearScore：每条 bonus 线为 ${ICON_BONUS_LINE_MULT} 倍行摊分（单消 +1 bonus 线）`, () => {
        const r = computeClearScore('normal', { count: 1, bonusLines: [{ type: 'row', idx: 0 }] });
        expect(r.baseScore).toBe(20);
        expect(r.iconBonusScore).toBe(80);
        expect(r.clearScore).toBe(100);
    });

    it('computeClearScore：覆盖 1~6 消、0~count 条 bonus 线，结果符合平方基础分公式', () => {
        for (let count = 1; count <= 6; count++) {
            for (let bonusCount = 0; bonusCount <= count; bonusCount++) {
                const r = computeClearScore('normal', {
                    count,
                    bonusLines: Array.from({ length: bonusCount }, (_, idx) => ({ type: 'row', idx })),
                });
                const expected = expectedScore(count, bonusCount);
                expect(r).toEqual(expected);
                expect(r.baseScore % 10).toBe(0);
                expect(r.iconBonusScore % 10).toBe(0);
                expect(r.clearScore % 10).toBe(0);
            }
        }
    });

    it('computeClearScore：异常 bonusLines 数量超过消除线数时钳制到 count', () => {
        const r = computeClearScore('normal', {
            count: 2,
            bonusLines: [{}, {}, {}],
        });
        expect(r).toEqual(expectedScore(2, 2));
    });

    it('bonusEffectHoldMs 落在 3000–5000ms', () => {
        expect(bonusEffectHoldMs(1)).toBe(3400);
        expect(bonusEffectHoldMs(6)).toBe(5000);
        expect(bonusEffectHoldMs(0)).toBe(0);
    });

    it('整行同 icon（不同 colorIdx）可触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        // 0/4/8/12 -> 都映射到 icon 'A'
        fillRow(g, 2, [0, 4, 8, 12, 0, 4, 8, 12]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'row', idx: 2, icon: 'A' });
    });

    it('整列同 icon（不同 colorIdx）可触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['X', 'Y'] };
        // 1/3/5/7 -> 都映射到 icon 'Y'
        fillCol(g, 6, [1, 3, 5, 7, 1, 3, 5, 7]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'col', idx: 6, icon: 'Y' });
    });

    it('无 blockIcons 时按同颜色判断 bonus（同色行）', () => {
        const g = new Grid(8);
        const skin = { blockIcons: [] };
        fillRow(g, 4, [5, 5, 5, 5, 5, 5, 5, 5]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'row', idx: 4, colorIdx: 5, icon: null });
    });

    it('整行已满但 icon 不一致时不触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 1, [0, 1, 2, 3, 0, 1, 2, 3]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(0);
    });

    it('演示：先检测 bonus，再 apply 清除，特征不会丢失', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 0, [0, 4, 8, 12, 0, 4, 8, 12]); // row bonus
        fillCol(g, 7, [12, 0, 4, 8, 12, 0, 4, 8]); // col bonus（均映射为 A）

        const bonusBeforeApply = detectBonusLines(g, skin);
        const cleared = new ClearRuleEngine([RowColRule]).apply(g);

        expect(cleared.count).toBe(2);
        expect(bonusBeforeApply.map(b => `${b.type}:${b.idx}`).sort()).toEqual(['col:7', 'row:0']);
        // apply 后网格已清空对应行列（证明必须先检测）
        expect(g.cells[0].every(c => c === null)).toBe(true);
        expect(g.cells.every(row => row[7] === null)).toBe(true);
    });

    it('monoNearFullLineColorWeights：近满且同色行提高该 dock 色权重', () => {
        const g = new Grid(8);
        for (let x = 0; x < 6; x++) g.cells[2][x] = 3;
        // 两格空
        const w = monoNearFullLineColorWeights(g, { blockIcons: [] });
        expect(w[3]).toBeGreaterThan(0);
        expect(w[0]).toBe(0);
    });

    it('monoNearFullLineColorWeights：近满行同 icon 时给相关 dock 色加分', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 5, [0, 4, 8, 12, 0, 4, null, null]);
        const w = monoNearFullLineColorWeights(g, skin);
        expect(w[0]).toBeGreaterThan(0);
        expect(w[4]).toBeGreaterThan(0);
    });

    it('pickThreeDockColors：强偏置时高概率取到该色；且三色互异', () => {
        const bias = [100, 0, 0, 0, 0, 0, 0, 0];
        let hits = 0;
        for (let t = 0; t < 200; t++) {
            const c = pickThreeDockColors(bias);
            expect(new Set(c).size).toBe(3);
            if (c.includes(0)) hits++;
        }
        expect(hits).toBeGreaterThan(180);
    });
});

