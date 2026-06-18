/**
 * newbieVillageCore.js — 新手村纯逻辑（引擎无关 · 多端同步）
 *
 * 权威源：Web 主端 `newbieVillage.js` 的计分 / 盘面 / 5 课脚本。
 * 经 `scripts/sync-core.sh` → miniprogram/core；
 * 经 `scripts/sync-cocos-engine.mjs` → cocos/assets/scripts/engine/。
 *
 * 各端 UI 层（DOM / Canvas / Cocos Node）只负责渲染与输入，逻辑必须调用本模块。
 */

import { getShapeById } from '../shapes.js';
import {
    computeClearScore,
    detectBonusLines,
    deriveNextComboCount,
    ICON_BONUS_LINE_MULT,
    PERFECT_CLEAR_MULT,
} from '../clearScoring.js';

export const NEWBIE_VILLAGE_STORAGE_KEY = 'openblock_newbie_village_v1';

export const NV_COLS = 8;
export const NV_ROWS = 8;
/** 与主局默认策略一致（shared/game_rules.json → defaultStrategyId = 'normal'） */
export const NV_STRATEGY_ID = 'normal';

/** 调色板：索引即 colorIdx（0~7）；同花判定按 colorIdx 相等。 */
export const NV_PALETTE = [
    '#38bdf8', '#a78bfa', '#34d399', '#fbbf24',
    '#fb7185', '#f472b6', '#60a5fa', '#f59e0b',
];

export function loadVillageState(storage) {
    try {
        const raw = storage?.getItem?.(NEWBIE_VILLAGE_STORAGE_KEY);
        if (!raw) return { done: false, skipped: false };
        const s = JSON.parse(raw);
        return { done: !!s.done, skipped: !!s.skipped };
    } catch {
        return { done: false, skipped: false };
    }
}

export function saveVillageState(storage, patch) {
    try {
        const cur = loadVillageState(storage);
        storage?.setItem?.(
            NEWBIE_VILLAGE_STORAGE_KEY,
            JSON.stringify({ ...cur, ...patch, ts: Date.now() }),
        );
    } catch { /* ignore */ }
}

/**
 * 是否应当展示新手村（引擎无关）。
 * @param {{ game?: object, storage?: { getItem: Function }, force?: boolean, skip?: boolean }} [opts]
 */
export function shouldShowNewbieVillageCore({ game, storage, force = false, skip = false } = {}) {
    if (skip) return false;
    if (force) return true;
    if (!storage?.getItem) return false;
    const st = loadVillageState(storage);
    if (st.done || st.skipped) return false;
    const lifetime = Number(game?.playerProfile?.lifetimeGames);
    if (Number.isFinite(lifetime) && lifetime > 0) return false;
    return true;
}

export function emptyNvBoard() {
    return Array.from({ length: NV_ROWS }, () => Array.from({ length: NV_COLS }, () => null));
}

export function toGridLike(board) {
    return { size: board.length, cells: board };
}

export function computeClears(board) {
    const rows = board.length;
    const cols = rows > 0 ? board[0].length : 0;
    const fullRows = [];
    const fullCols = [];
    for (let r = 0; r < rows; r++) {
        if (board[r].every((v) => v !== null)) fullRows.push(r);
    }
    for (let c = 0; c < cols; c++) {
        let full = true;
        for (let r = 0; r < rows; r++) { if (board[r][c] === null) { full = false; break; } }
        if (full) fullCols.push(c);
    }
    const set = new Set();
    const cells = [];
    const push = (r, c) => { const k = `${r},${c}`; if (!set.has(k)) { set.add(k); cells.push([r, c]); } };
    for (const r of fullRows) for (let c = 0; c < cols; c++) push(r, c);
    for (const c of fullCols) for (let r = 0; r < rows; r++) push(r, c);
    return { cells, lines: fullRows.length + fullCols.length };
}

export function applyPiece(board, piece, origin) {
    const next = board.map((row) => row.slice());
    const [ox, oy] = origin;
    for (const [dx, dy] of piece.cells) {
        next[oy + dy][ox + dx] = piece.colorIdx;
    }
    return next;
}

export function isPlacementValid(board, piece, origin) {
    const [ox, oy] = origin;
    if (piece.target && (ox !== piece.target[0] || oy !== piece.target[1])) return false;
    for (const [dx, dy] of piece.cells) {
        const c = ox + dx;
        const r = oy + dy;
        if (c < 0 || c >= NV_COLS || r < 0 || r >= NV_ROWS) return false;
        if (board[r][c] !== null) return false;
    }
    return true;
}

export function scorePlacement(filledBoard, comboCount) {
    const clears = computeClears(filledBoard);
    const c = clears.lines;
    const bonusLines = c > 0 ? detectBonusLines(toGridLike(filledBoard), null) : [];
    const afterBoard = filledBoard.map((row) => row.slice());
    for (const [r, cc] of clears.cells) afterBoard[r][cc] = null;
    const perfect = c > 0 && afterBoard.every((row) => row.every((v) => v === null));
    const result = { count: c, bonusLines, perfectClear: perfect };
    const score = computeClearScore(NV_STRATEGY_ID, result, null, comboCount);
    return { result, score, clears, perfect, afterBoard };
}

export function shapeCells(shapeId) {
    const shape = getShapeById(shapeId);
    const data = shape?.data || [[1]];
    const cells = [];
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) {
            if (data[y][x]) cells.push([x, y]);
        }
    }
    return cells;
}

const SP = (shapeId, colorIdx, target) => ({ shapeId, cells: shapeCells(shapeId), colorIdx, target });

function _stamp(board, shapeId, ox, oy, colorIdx) {
    for (const [dx, dy] of shapeCells(shapeId)) {
        const x = ox + dx;
        const y = oy + dy;
        if (y >= 0 && y < NV_ROWS && x >= 0 && x < NV_COLS) board[y][x] = colorIdx;
    }
    return board;
}

export const SCENARIO = [
    {
        id: 'single',
        coach: {
            icon: '🧩',
            title: '第 1 课 · 单消',
            body: '按住下方发光的方块拖到闪烁缺口松手落子。这是一条「1×4」候选块——填满一整行即可消除，基础分 = 20 × 行列数²。',
        },
        pieces: [SP('1x4', 6, [4, 7])],
        seed() {
            const b = emptyNvBoard();
            _stamp(b, '1x4', 0, 7, 0);
            _stamp(b, 'l-2', 1, 1, 2);
            _stamp(b, '2x2', 5, 3, 4);
            return b;
        },
        reveal: {
            title: '单消达成！',
            body: '消除 1 条线，基础分 = 20 × 1² = 20。每消一行/列都会立即结算并飘出「+分数」。',
        },
    },
    {
        id: 'multi',
        coach: {
            icon: '✨',
            title: '第 2 课 · 多消',
            body: '这是「2×2」方块。放进右下角缺口，会**一手同时填满两行**！多消基础分按数量平方放大：20 × 2² = 80。',
        },
        pieces: [SP('2x2', 3, [6, 6])],
        seed() {
            const b = emptyNvBoard();
            _stamp(b, '2x3', 0, 6, 0);
            _stamp(b, '2x3', 3, 6, 5);
            _stamp(b, '2x2', 1, 2, 2);
            return b;
        },
        reveal: {
            title: '多消 ×2！',
            body: '一次落子清掉 2 条线，基础分 = 20 × 2² = 80。这就是「多消」的平方奖励——消得越多越值。',
        },
    },
    {
        id: 'mono',
        coach: {
            icon: '🌈',
            title: '第 3 课 · 同花消除',
            body: '这是「4×1」竖条。把它补进左侧同色列，让**整列颜色一致** —— 触发「同花」奖励，该列得分 ×5！',
        },
        pieces: [SP('4x1', 2, [0, 4])],
        seed() {
            const b = emptyNvBoard();
            _stamp(b, '4x1', 0, 0, 2);
            _stamp(b, '2x2', 3, 1, 5);
            _stamp(b, '1x4', 3, 5, 0);
            return b;
        },
        reveal: {
            title: '同花 BONUS！',
            body: '整列同色触发同花：该线得分 ×5（20 → 100）。凑同色是高分的关键技巧之一。',
        },
    },
    {
        id: 'combo',
        coach: {
            icon: '🔥',
            title: '第 4 课 · 连击 Combo',
            body: '连续多手都消行会点燃 combo（♥N）：♥3 起得分 ×2、♥4 ×3、♥5+ ×4！连放 3 条「1×4」横条，逐行补满。',
        },
        pieces: [
            SP('1x4', 4, [4, 5]),
            SP('1x4', 6, [4, 6]),
            SP('1x4', 1, [4, 7]),
        ],
        seed() {
            const b = emptyNvBoard();
            _stamp(b, '1x4', 0, 5, 0);
            _stamp(b, '1x4', 0, 6, 3);
            _stamp(b, '1x4', 0, 7, 5);
            _stamp(b, '2x2', 1, 1, 6);
            _stamp(b, 'l-2', 4, 2, 1);
            return b;
        },
        reveal: {
            title: '连击 ♥3 ×2！',
            body: 'combo 在整局里持续累积：连续清线越多，♥N 越高、倍率越大。这一手已经吃到 ×2 加成。',
        },
    },
    {
        id: 'perfect',
        coach: {
            icon: '🌟',
            title: '第 5 课 · 清屏 Perfect',
            body: '终极爽点：用这枚「2×3」方块补满最后两行，把**整个棋盘清空** —— 触发 PERFECT，全部得分 ×10！',
        },
        pieces: [SP('2x3', 5, [5, 6])],
        seed() {
            const b = emptyNvBoard();
            _stamp(b, '2x2', 0, 6, 0);
            _stamp(b, '2x3', 2, 6, 3);
            return b;
        },
        reveal: {
            title: 'PERFECT 清屏！',
            body: '盘面被彻底清空，触发完美清屏：全部得分 ×10。这是冲击高分的最强一击！',
        },
    },
];

/** 按真实结算生成得分拆解文案 */
export function breakdownText(scored) {
    if (!scored) return '';
    const { result, score } = scored;
    const c = result.count;
    const parts = [`基础 20×${c}²=${score.baseScore}`];
    if (score.iconBonusScore > 0) parts.push(`同花 +${score.iconBonusScore}`);
    if (result.perfectClear) parts.push(`完美清屏 ×${PERFECT_CLEAR_MULT}`);
    if (score.comboMultiplier > 1) parts.push(`连击 ×${score.comboMultiplier}`);
    return `本手 +${score.clearScore} = ${parts.join('  ·  ')}`;
}

export { deriveNextComboCount, ICON_BONUS_LINE_MULT, PERFECT_CLEAR_MULT };
