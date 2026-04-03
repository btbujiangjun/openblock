/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';

describe('Grid', () => {
    let grid;
    
    beforeEach(() => {
        grid = new Grid(9);
    });
    
    it('should initialize with empty cells', () => {
        expect(grid.size).toBe(9);
        expect(grid.cells.every(row => row.every(cell => cell === null))).toBe(true);
    });
    
    it('should clear all cells', () => {
        grid.place([[1]], 0, 0, 0);
        grid.clear();
        expect(grid.cells[0][0]).toBe(null);
    });
    
    it('should detect valid placement', () => {
        expect(grid.canPlace([[1,1],[1,1]], 0, 0)).toBe(true);
    });
    
    it('should reject placement outside bounds', () => {
        expect(grid.canPlace([[1,1,1,1,1]], 7, 0)).toBe(false);
    });
    
    it('should reject placement on occupied cells', () => {
        grid.place([[1]], 0, 0, 0);
        expect(grid.canPlace([[1]], 0, 0)).toBe(false);
    });
    
    it('should place blocks correctly', () => {
        grid.place([[1,1],[1,1]], 0, 2, 3);
        expect(grid.cells[3][2]).toBe(0);
        expect(grid.cells[4][3]).toBe(0);
    });
    
    it('should detect full rows', () => {
        for (let x = 0; x < 9; x++) grid.cells[0][x] = 1;
        expect(grid.checkLines().count).toBe(1);
    });
    
    it('should detect full columns', () => {
        for (let y = 0; y < 9; y++) grid.cells[y][0] = 1;
        expect(grid.checkLines().count).toBe(1);
    });
    
    it('should clear both rows and columns', () => {
        for (let x = 0; x < 9; x++) grid.cells[0][x] = 1;
        for (let y = 0; y < 9; y++) grid.cells[y][0] = 1;
        expect(grid.checkLines().count).toBe(2);
    });
    
    it('should return 0 when no lines complete', () => {
        grid.cells[0][0] = 1;
        expect(grid.checkLines().count).toBe(0);
    });
    
    it('should detect when moves are available', () => {
        const blocks = [{ shape: [[1]], placed: false }];
        expect(grid.hasAnyMove(blocks)).toBe(true);
    });
    
    it('should detect when no moves available', () => {
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                grid.cells[y][x] = 1;
            }
        }
        const blocks = [{ shape: [[1]], placed: false }];
        expect(grid.hasAnyMove(blocks)).toBe(false);
    });
});
