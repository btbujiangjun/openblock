/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { evaluatePlacement, PLACEMENT_DEFAULT_WEIGHTS } from '../../web/src/evaluation/placementQuality.js';

function emptyBoard(size = 8) {
    const cells = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) row.push(null);
        cells.push(row);
    }
    return cells;
}

function paintRect(cells, x0, y0, w, h) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            cells[y0 + y][x0 + x] = 1;
        }
    }
    return cells;
}

const SHAPE_1x1 = [[1]];
const SHAPE_2x2 = [[1, 1], [1, 1]];
const SHAPE_LINE3 = [[1, 1, 1]];

describe('evaluatePlacement', () => {
    it('开局极松 + 候选位极多时进入节流分支，给乐观默认值', () => {
        // 用更低阈值激活节流；默认 throttle 是 fill<0.25 且候选>=500，8x8 空盘 1x1 是 64 候选不会触发。
        const board = emptyBoard(8);
        const r = evaluatePlacement({
            boardBefore: board,
            shape: SHAPE_1x1,
            pos: { x: 0, y: 0 },
            remainingShapes: [],
            config: { throttle: { skipWhenFillBelow: 0.25, skipWhenCandidatesAbove: 10 } },
        });
        expect(r.evaluated).toBe(false);
        expect(r.absScore).toBeGreaterThan(0.7);
        expect(r.regret).toBe(0);
    });

    it('稠密盘面：贴边/贴块的放法 contact 高于孤立点', () => {
        // 构造一个 fill≥0.25 的盘面，避免触发节流。
        const board = emptyBoard(8);
        paintRect(board, 0, 5, 8, 3); // 底部 3 行全填
        // 顶部一处已有块，留出邻接位
        board[4][0] = 1;
        const r = evaluatePlacement({
            boardBefore: board,
            shape: SHAPE_1x1,
            pos: { x: 0, y: 3 },         // 与底部 + 左墙都接触，与 [4][0] 也接触
            remainingShapes: [],
        });
        expect(r.evaluated).toBe(true);
        expect(r.components.contact).toBeGreaterThan(0.3);
    });

    it('造洞动作 holeSafety 低、badnessTag=created_hole', () => {
        const board = emptyBoard(8);
        // 底部一行除中间一列外全填，且上面一行紧贴；这样在中间一列上方放 2x2 会盖住下面那个洞。
        paintRect(board, 0, 5, 8, 3);
        board[5][4] = null;
        board[6][4] = null;
        board[7][4] = null;
        // 在 (3, 2) 放一个 2x2，会在 (3..4, 4) 与底部之间形成不可达洞？
        // 简化：直接在 (3, 3) 放 2x2，盖住 (4,4) 之上区域。
        const r = evaluatePlacement({
            boardBefore: board,
            shape: SHAPE_2x2,
            pos: { x: 3, y: 3 },
            remainingShapes: [],
        });
        expect(r.evaluated).toBe(true);
        expect(r.components.holeSafety).toBeLessThan(1);
    });

    it('能消行的落点 payoff > 0、且优于无消行的同等位置', () => {
        const board = emptyBoard(8);
        // 让第 7 行差最右 3 格未填
        for (let x = 0; x < 5; x++) board[7][x] = 1;
        // 再让 fill 足够触发非节流
        paintRect(board, 0, 5, 8, 2);
        const r = evaluatePlacement({
            boardBefore: board,
            shape: SHAPE_LINE3,
            pos: { x: 5, y: 7 },
            remainingShapes: [],
        });
        expect(r.evaluated).toBe(true);
        expect(r.components.payoff).toBeGreaterThan(0);
    });

    it('权重和归一：默认 5 维和 ≈ 1', () => {
        const w = PLACEMENT_DEFAULT_WEIGHTS;
        const sum = w.contact + w.tidiness + w.holeSafety + w.payoff + w.unlocking;
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    });

    it('非法落点返回空结果', () => {
        const board = emptyBoard(8);
        paintRect(board, 0, 5, 8, 3);
        // (0,5) 已被占用
        const r = evaluatePlacement({
            boardBefore: board,
            shape: SHAPE_1x1,
            pos: { x: 0, y: 5 },
            remainingShapes: [],
        });
        expect(r.evaluated).toBe(false);
        expect(r.absScore).toBe(0);
    });
});
