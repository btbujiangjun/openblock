/**
 * Bonus 行列特征测试：
 * - 整行/整列同 icon（允许不同 colorIdx 映射到同一 icon）触发 bonus
 * - 无 icon 皮肤时，退化为“同颜色”触发 bonus
 * - 与 ClearRuleEngine.apply 联动时，必须在清除前检测
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { ClearRuleEngine, RowColRule } from '../web/src/clearRules.js';
import { detectBonusLines } from '../web/src/game.js';

function fillRow(grid, row, values) {
    for (let x = 0; x < grid.size; x++) grid.cells[row][x] = values[x];
}

function fillCol(grid, col, values) {
    for (let y = 0; y < grid.size; y++) grid.cells[y][col] = values[y];
}

describe('bonus line feature', () => {
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
});

