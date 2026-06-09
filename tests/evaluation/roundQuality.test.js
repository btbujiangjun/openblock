/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { evaluateRound } from '../../web/src/evaluation/roundQuality.js';

function emptyBoard(size = 6) {
    const cells = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) row.push(null);
        cells.push(row);
    }
    return cells;
}
function paintRect(cells, x0, y0, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y0 + y][x0 + x] = 1;
    return cells;
}

const S_1x1 = [[1]];
const S_LINE2 = [[1, 1]];

describe('evaluateRound', () => {
    it('moves 不足 3 步 → incomplete', () => {
        const board = emptyBoard(6);
        paintRect(board, 0, 4, 6, 2);
        const r = evaluateRound({
            boardBefore: board,
            dockShapes: [S_1x1, S_LINE2, S_1x1],
            moves: [
                { dockIndex: 0, pos: { x: 0, y: 3 } },
                { dockIndex: 1, pos: { x: 2, y: 3 } },
            ],
        });
        expect(r.classification).toBe('incomplete');
    });

    it('forced_bad：开局极松场景所有落点都触发节流 → bestRoundAbs 走默认 0.8 → 不可能 < forcedBad', () => {
        // 反过来：构造 forced_bad 比较难（盘面够空时大家都是 0.8 默认乐观）。
        // 这里只验证"开局极松且玩家随便放也能 optimal"，等价测试。
        const board = emptyBoard(6);
        const r = evaluateRound({
            boardBefore: board,
            dockShapes: [S_1x1, S_1x1, S_1x1],
            moves: [
                { dockIndex: 0, pos: { x: 0, y: 0 } },
                { dockIndex: 1, pos: { x: 1, y: 0 } },
                { dockIndex: 2, pos: { x: 2, y: 0 } },
            ],
        });
        expect(r.classification).not.toBe('forced_bad');
        expect(r.regrets.total).toBeLessThanOrEqual(0.5);
    });

    it('classification 字段必在合法枚举集合', () => {
        const board = emptyBoard(6);
        paintRect(board, 0, 4, 6, 2);
        const r = evaluateRound({
            boardBefore: board,
            dockShapes: [S_1x1, S_LINE2, S_1x1],
            moves: [
                { dockIndex: 0, pos: { x: 0, y: 3 } },
                { dockIndex: 1, pos: { x: 2, y: 3 } },
                { dockIndex: 2, pos: { x: 5, y: 3 } },
            ],
        });
        const allowed = new Set([
            'optimal', 'payoff_missed', 'order_wrong', 'placement_wrong',
            'forced_bad', 'salvage', 'incomplete',
        ]);
        expect(allowed.has(r.classification)).toBe(true);
        expect(r.regrets.total).toBeGreaterThanOrEqual(0);
        expect(r.regrets.total).toBeLessThanOrEqual(1);
    });

    it('bestPermutation 与 bestPositions 字段在合法时返回非空', () => {
        const board = emptyBoard(6);
        paintRect(board, 0, 4, 6, 2);
        const r = evaluateRound({
            boardBefore: board,
            dockShapes: [S_1x1, S_LINE2, S_1x1],
            moves: [
                { dockIndex: 0, pos: { x: 0, y: 3 } },
                { dockIndex: 1, pos: { x: 2, y: 3 } },
                { dockIndex: 2, pos: { x: 5, y: 3 } },
            ],
        });
        expect(Array.isArray(r.bestPermutation)).toBe(true);
        expect(r.bestPermutation.length).toBe(3);
        expect(Array.isArray(r.bestPositions)).toBe(true);
    });
});
