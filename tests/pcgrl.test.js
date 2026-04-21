/**
 * pcgrl.test.js — PCGRL 盘面生成器单元测试
 */
import { describe, it, expect } from 'vitest';
import { generateBoard, generateMosaicBoard, validateBoard, calcFillRatio, boardToJson } from '../web/src/level/pcgrl.js';

// -----------------------------------------------------------------------
// validateBoard
// -----------------------------------------------------------------------
describe('validateBoard', () => {
    it('空盘面 → 可放置 → true', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(null));
        expect(validateBoard(board)).toBe(true);
    });

    it('全填满盘面 → 无法放置 → false', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(1));
        expect(validateBoard(board)).toBe(false);
    });

    it('只有 1 个空格 → 1×1 形状可放 → true', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(1));
        board[3][3] = null;
        // MINI_SHAPES 中有 [[1]] 形状，可以放在 (3,3)
        expect(validateBoard(board)).toBe(true);
    });
});

// -----------------------------------------------------------------------
// generateBoard
// -----------------------------------------------------------------------
describe('generateBoard', () => {
    it('默认参数生成 8×8 盘面', () => {
        const board = generateBoard();
        expect(board).toHaveLength(8);
        board.forEach(row => expect(row).toHaveLength(8));
    });

    it('返回盘面可以通过 validateBoard 验证', () => {
        const board = generateBoard({ fillRatio: 0.3 });
        expect(validateBoard(board)).toBe(true);
    });

    it('填充率 0 → 空盘面', () => {
        const board = generateBoard({ fillRatio: 0, size: 8 });
        const ratio = calcFillRatio(board);
        expect(ratio).toBe(0);
    });

    it('填充率 0.5 → 约 50% 格子被填充（±15%）', () => {
        const board = generateBoard({ fillRatio: 0.5, size: 8 });
        const ratio = calcFillRatio(board);
        expect(ratio).toBeGreaterThanOrEqual(0.3);
        expect(ratio).toBeLessThanOrEqual(0.7);
    });

    it('颜色值在 1~colorCount 范围内', () => {
        const colorCount = 4;
        const board = generateBoard({ fillRatio: 0.5, colorCount, size: 8 });
        for (const row of board) {
            for (const cell of row) {
                if (cell !== null) {
                    expect(cell).toBeGreaterThanOrEqual(1);
                    expect(cell).toBeLessThanOrEqual(colorCount);
                }
            }
        }
    });
});

// -----------------------------------------------------------------------
// generateMosaicBoard
// -----------------------------------------------------------------------
describe('generateMosaicBoard', () => {
    const ZONES = [
        { x: 0, y: 0, w: 4, h: 4 },
        { x: 4, y: 0, w: 4, h: 4 },
        { x: 0, y: 4, w: 4, h: 4 },
        { x: 4, y: 4, w: 4, h: 4 },
    ];

    it('返回 8×8 盘面', () => {
        const board = generateMosaicBoard(ZONES);
        expect(board).toHaveLength(8);
        board.forEach(row => expect(row).toHaveLength(8));
    });

    it('生成的盘面通过可玩性验证', () => {
        const board = generateMosaicBoard(ZONES, { zoneFillRatio: 0.25 });
        expect(validateBoard(board)).toBe(true);
    });

    it('区域内有预填格子（非全空）', () => {
        const board = generateMosaicBoard(ZONES, { zoneFillRatio: 0.5 });
        const ratio = calcFillRatio(board);
        // 各区域填充 50%，总体应有非零填充
        expect(ratio).toBeGreaterThan(0);
    });
});

// -----------------------------------------------------------------------
// calcFillRatio
// -----------------------------------------------------------------------
describe('calcFillRatio', () => {
    it('空盘 → 0', () => {
        const board = Array.from({ length: 4 }, () => Array(4).fill(null));
        expect(calcFillRatio(board)).toBe(0);
    });

    it('全填 → 1', () => {
        const board = Array.from({ length: 4 }, () => Array(4).fill(1));
        expect(calcFillRatio(board)).toBe(1);
    });

    it('半填 → 0.5', () => {
        const board = [
            [1, 1, null, null],
            [null, null, 1, 1],
            [1, null, 1, null],
            [null, 1, null, 1],
        ];
        expect(calcFillRatio(board)).toBe(0.5);
    });
});

// -----------------------------------------------------------------------
// boardToJson
// -----------------------------------------------------------------------
describe('boardToJson', () => {
    it('序列化包含 null 的盘面', () => {
        const board = [[null, 1], [2, null]];
        const json = boardToJson(board);
        expect(JSON.parse(json)).toEqual([[null, 1], [2, null]]);
    });
});
