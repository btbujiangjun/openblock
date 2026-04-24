/**
 * clearRules.js — 消除规则引擎（可扩展接口）
 *
 * 解决"消除规则封闭"问题：原 grid.js 的 checkLines() 硬编码行/列消除。
 * 本模块将消除规则抽象为可插拔的 ClearRule 对象，无需修改 grid.js 核心。
 *
 * 设计原则
 * --------
 * - grid.js 完全不改动：ClearRuleEngine 在 grid 外部运行检测逻辑
 * - 向后兼容：RowColRule 复现原有行/列消除行为，结果与 checkLines() 相同
 * - 可组合：多个规则叠加时合并消除格子集，自动去重
 * - 关卡模式友好：ZoneClearRule 支持预设区域消除（马赛克等玩法）
 *
 * ClearRule 接口
 * --------------
 *   interface ClearRule {
 *     id: string                  // 唯一标识（调试/序列化用）
 *     detect(grid): DetectResult  // 检测满足条件的格子
 *   }
 *
 *   interface DetectResult {
 *     cells: { x, y, color }[]   // 待消除格子列表
 *     lines: number               // 计分用"消除行数"
 *   }
 *
 * 使用方式
 * --------
 *   import { ClearRuleEngine, RowColRule } from './clearRules.js';
 *   const engine = new ClearRuleEngine([RowColRule]);
 *   const { cells, lines } = engine.detect(grid);
 *   engine.apply(grid);  // 检测 + 执行消除 + 返回 { count, cells }
 *
 * game.js 集成（零侵入）
 * ---------------------
 *   game.js 在初始化时创建 engine，然后用 engine.apply(grid)
 *   代替原来的 grid.checkLines()。原始 checkLines() 保留，不受影响。
 */

/**
 * 行列消除规则（复现 grid.checkLines() 原有行为）
 * @type {ClearRule}
 */
export const RowColRule = {
    id: 'row_col',

    /**
     * @param {import('./grid.js').Grid} grid
     * @returns {{ cells: Array<{x:number,y:number,color:number}>, lines: number,
     *            bonusLines: Array<{type:'row'|'col', idx:number, colorIdx:number}> }}
     */
    detect(grid) {
        const n = grid.size;
        const fullRows = [];
        const fullCols = [];

        for (let y = 0; y < n; y++) {
            if (grid.cells[y].every(c => c !== null)) fullRows.push(y);
        }
        for (let x = 0; x < n; x++) {
            let full = true;
            for (let y = 0; y < n; y++) {
                if (grid.cells[y][x] === null) { full = false; break; }
            }
            if (full) fullCols.push(x);
        }

        // 同色消除检测（在清格前）：整行/列 colorIdx 完全相同 → 加入 bonusLines
        const bonusLines = [];
        for (const y of fullRows) {
            const first = grid.cells[y][0];
            if (first !== null && grid.cells[y].every(c => c === first)) {
                bonusLines.push({ type: 'row', idx: y, colorIdx: first });
            }
        }
        for (const x of fullCols) {
            const first = grid.cells[0][x];
            if (first !== null) {
                let allSame = true;
                for (let y = 1; y < n; y++) {
                    if (grid.cells[y][x] !== first) { allSame = false; break; }
                }
                if (allSame) bonusLines.push({ type: 'col', idx: x, colorIdx: first });
            }
        }

        const seen = new Set();
        const cells = [];

        for (const y of fullRows) {
            for (let x = 0; x < n; x++) {
                const key = `${x},${y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    cells.push({ x, y, color: grid.cells[y][x] });
                }
            }
        }
        for (const x of fullCols) {
            for (let y = 0; y < n; y++) {
                const key = `${x},${y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    cells.push({ x, y, color: grid.cells[y][x] });
                }
            }
        }

        return { cells, lines: fullRows.length + fullCols.length, bonusLines };
    },
};

/**
 * 区域消除规则（关卡模式专用）
 * 预设若干矩形区域，当某区域完全填满时触发整区消除。
 *
 * @param {Array<{x:number,y:number,w:number,h:number}>} zones 预设区域列表
 * @returns {ClearRule}
 */
export function makeZoneClearRule(zones) {
    return {
        id: 'zone',
        zones,

        detect(grid) {
            const cells = [];
            const seen = new Set();
            let lines = 0;

            for (const zone of zones) {
                let full = true;
                for (let dy = 0; dy < zone.h && full; dy++) {
                    for (let dx = 0; dx < zone.w && full; dx++) {
                        const gy = zone.y + dy;
                        const gx = zone.x + dx;
                        if (gy >= grid.size || gx >= grid.size || grid.cells[gy][gx] === null) {
                            full = false;
                        }
                    }
                }
                if (full) {
                    for (let dy = 0; dy < zone.h; dy++) {
                        for (let dx = 0; dx < zone.w; dx++) {
                            const gy = zone.y + dy;
                            const gx = zone.x + dx;
                            const key = `${gx},${gy}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                cells.push({ x: gx, y: gy, color: grid.cells[gy][gx] });
                            }
                        }
                    }
                    lines++;
                }
            }

            return { cells, lines };
        },
    };
}

/**
 * 对角线消除规则（扩展玩法示例）
 * 主对角线或反对角线全填满时触发消除。
 * @returns {ClearRule}
 */
export const DiagonalRule = {
    id: 'diagonal',

    detect(grid) {
        const n = grid.size;
        const cells = [];
        const seen = new Set();
        let lines = 0;

        // 主对角线（左上→右下）
        let diagFull = true;
        for (let i = 0; i < n; i++) {
            if (grid.cells[i][i] === null) { diagFull = false; break; }
        }
        if (diagFull) {
            lines++;
            for (let i = 0; i < n; i++) {
                const key = `${i},${i}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    cells.push({ x: i, y: i, color: grid.cells[i][i] });
                }
            }
        }

        // 反对角线（右上→左下）
        let antiDiagFull = true;
        for (let i = 0; i < n; i++) {
            if (grid.cells[i][n - 1 - i] === null) { antiDiagFull = false; break; }
        }
        if (antiDiagFull) {
            lines++;
            for (let i = 0; i < n; i++) {
                const key = `${n - 1 - i},${i}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    cells.push({ x: n - 1 - i, y: i, color: grid.cells[i][n - 1 - i] });
                }
            }
        }

        return { cells, lines };
    },
};

/**
 * 消除规则引擎
 *
 * 组合多个 ClearRule，合并消除结果，执行实际格子清除。
 */
export class ClearRuleEngine {
    /**
     * @param {ClearRule[]} [rules]  规则列表，默认仅行列规则
     */
    constructor(rules = [RowColRule]) {
        this.rules = rules;
    }

    /**
     * 检测所有规则的触发格子（不修改 grid）
     * @param {import('./grid.js').Grid} grid
     * @returns {{ cells: Array<{x,y,color}>, lines: number,
     *            bonusLines: Array<{type:'row'|'col', idx:number, colorIdx:number}> }}
     */
    detect(grid) {
        const seen = new Set();
        const cells = [];
        const bonusLines = [];
        let lines = 0;

        for (const rule of this.rules) {
            const result = rule.detect(grid);
            for (const cell of result.cells) {
                const key = `${cell.x},${cell.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    cells.push(cell);
                }
            }
            lines += result.lines;
            if (result.bonusLines) bonusLines.push(...result.bonusLines);
        }

        return { cells, lines, bonusLines };
    }

    /**
     * 检测 + 执行消除：将触发格子置为 null
     * 返回值与 grid.checkLines() 相同（{ count, cells }），向后兼容。
     * @param {import('./grid.js').Grid} grid
     * @returns {{ count: number, cells: Array<{x,y,color}>, bonusLines: Array<{type,idx,colorIdx}> }}
     */
    apply(grid) {
        const { cells, lines, bonusLines } = this.detect(grid);
        for (const cell of cells) {
            grid.cells[cell.y][cell.x] = null;
        }
        return { count: lines, cells, bonusLines };
    }

    /** 向规则列表末尾追加一条规则（链式调用） */
    addRule(rule) {
        this.rules.push(rule);
        return this;
    }

    /** 移除指定 id 的规则 */
    removeRule(id) {
        this.rules = this.rules.filter(r => r.id !== id);
        return this;
    }
}

/** 默认引擎（行列规则）——游戏全局共用 */
export const defaultClearEngine = new ClearRuleEngine([RowColRule]);
