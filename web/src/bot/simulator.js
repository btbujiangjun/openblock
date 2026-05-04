/**
 * 与主游戏一致的无头对局，用于自博弈与策略训练（v5：含直接监督信号）
 */
import { Grid } from '../grid.js';
import { getStrategy } from '../config.js';
import { getAllShapes } from '../shapes.js';
import { FEATURE_ENCODING, RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD } from '../gameRules.js';
import { generateDockShapes, generateBlocksForGrid } from './blockSpawn.js';
import {
    computeClearScore,
    detectBonusLines,
    monoNearFullLineColorWeights,
    pickThreeDockColors
} from '../clearScoring.js';
import { getRlTrainingBonusLineSkin } from '../skins.js';
import { analyzeBoardTopology, countUnfillableCells } from '../boardTopology.js';

const _POT_CFG = RL_REWARD_SHAPING?.potentialShaping || {};
const _POT_W_HOLE = Number(_POT_CFG.holeWeight) || -0.4;
const _POT_W_TRANS = Number(_POT_CFG.transitionWeight) || -0.08;
const _POT_W_WELL = Number(_POT_CFG.wellWeight) || -0.15;
const _POT_W_CLOSE = Number(_POT_CFG.closeToFullWeight) || 0.35;
const _POT_W_MOB = Number(_POT_CFG.mobilityWeight) || 0.12;
const _POT_COEF = Number(_POT_CFG.coef) || 0.5;
const _POT_ENABLED = Boolean(_POT_CFG.enabled);
const _BOARD_POT_NORM = 30.0;
const _AN = FEATURE_ENCODING?.actionNorm || {};

/** 与主局计分对齐的 bonus / 近满染色偏置（固定 canonical 主题，见 getRlTrainingBonusLineSkin） */
function _rlBonusSkin() {
    return getRlTrainingBonusLineSkin();
}

export { generateDockShapes, generateBlocksForGrid };

function _countHoles(grid) {
    return countUnfillableCells(grid);
}

function _countTransitions(grid) {
    const n = grid.size;
    let t = 0;
    for (let y = 0; y < n; y++) {
        let prev = true;
        for (let x = 0; x < n; x++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) t++;
            prev = cur;
        }
        if (!prev) t++;
    }
    for (let x = 0; x < n; x++) {
        let prev = true;
        for (let y = 0; y < n; y++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) t++;
            prev = cur;
        }
        if (!prev) t++;
    }
    return t;
}

function _wellDepthSum(grid) {
    const n = grid.size;
    let total = 0;
    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) continue;
            const left = x === 0 || grid.cells[y][x - 1] !== null;
            const right = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (left && right) total++;
        }
    }
    return total;
}

function _closeToFullCount(grid) {
    const n = grid.size;
    let count = 0;
    for (let y = 0; y < n; y++) {
        let f = 0;
        for (let x = 0; x < n; x++) if (grid.cells[y][x] !== null) f++;
        if (f >= n - 2) count++;
    }
    for (let x = 0; x < n; x++) {
        let f = 0;
        for (let y = 0; y < n; y++) if (grid.cells[y][x] !== null) f++;
        if (f >= n - 2) count++;
    }
    return count;
}

function _lineCloseCounts(grid) {
    const topo = analyzeBoardTopology(grid);
    return { close1: topo.close1, close2: topo.close2 };
}

function _rowColTransitions(grid) {
    const n = grid.size;
    let rowTrans = 0;
    let colTrans = 0;
    for (let y = 0; y < n; y++) {
        let prev = true;
        for (let x = 0; x < n; x++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) rowTrans++;
            prev = cur;
        }
        if (!prev) rowTrans++;
    }
    for (let x = 0; x < n; x++) {
        let prev = true;
        for (let y = 0; y < n; y++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) colTrans++;
            prev = cur;
        }
        if (!prev) colTrans++;
    }
    return { rowTrans, colTrans };
}

function _dockMobility(grid, dock) {
    const n = grid.size;
    let total = 0;
    for (const b of dock) {
        if (b.placed) continue;
        for (let gy = 0; gy < n; gy++)
            for (let gx = 0; gx < n; gx++)
                if (grid.canPlace(b.shape, gx, gy)) total++;
    }
    return total;
}

function _topologyAuxTargets(grid, dock) {
    const n = grid.size;
    const area = Math.max(n * n, 1);
    let filled = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) filled++;
        }
    }
    const { rowTrans, colTrans } = _rowColTransitions(grid);
    const { close1, close2 } = _lineCloseCounts(grid);
    return [
        Math.min(_countHoles(grid) / Math.max(_AN.maxHoles ?? 16, 1), 1),
        Math.min(rowTrans / Math.max(_AN.maxTransitions ?? 64, 1), 1),
        Math.min(colTrans / Math.max(_AN.maxTransitions ?? 64, 1), 1),
        Math.min(_wellDepthSum(grid) / Math.max(_AN.maxWellDepth ?? 24, 1), 1),
        Math.min(close1 / Math.max(n, 1), 1),
        Math.min(close2 / Math.max(n, 1), 1),
        Math.min(_dockMobility(grid, dock) / Math.max(_AN.maxMobility ?? 192, 1), 1),
        Math.min(filled / area, 1),
    ];
}

export function boardPotential(grid, dock) {
    return (
        _POT_W_HOLE * _countHoles(grid)
        + _POT_W_TRANS * _countTransitions(grid)
        + _POT_W_WELL * _wellDepthSum(grid)
        + _POT_W_CLOSE * _closeToFullCount(grid)
        + _POT_W_MOB * (_dockMobility(grid, dock) / 10)
    );
}

export class OpenBlockSimulator {
    /**
     * @param {string} [strategyId]
     * @param {{ winScoreThreshold?: number }} [options]
     */
    constructor(strategyId = 'normal', options = {}) {
        this.strategyId = strategyId;
        const w = options?.winScoreThreshold;
        this.winScoreThreshold = typeof w === 'number' && Number.isFinite(w)
            ? Math.max(1, Math.round(w))
            : WIN_SCORE_THRESHOLD;
        this.reset();
    }

    reset() {
        const cfg = getStrategy(this.strategyId);
        this.strategyConfig = cfg;
        this.scoring = cfg.scoring;
        this.grid = new Grid(cfg.gridWidth || 8);
        this.grid.initBoard(cfg.fillRatio, cfg.shapeWeights);
        this.score = 0;
        this.totalClears = 0;
        this.steps = 0;
        this.placements = 0;
        this._spawnDock();
    }

    _spawnDock() {
        const shapes = generateDockShapes(this.grid, this.strategyConfig);
        const bias = monoNearFullLineColorWeights(this.grid, _rlBonusSkin());
        const dockColors = pickThreeDockColors(bias);
        this.dock = [];
        for (let i = 0; i < 3; i++) {
            const shape = shapes[i] || getAllShapes()[0];
            this.dock.push({
                id: shape.id,
                shape: shape.data,
                colorIdx: dockColors[i],
                placed: false
            });
        }
    }

    saveState() {
        return {
            cells: this.grid.cells.map(row => [...row]),
            dock: this.dock.map(b => ({ ...b, shape: b.shape.map(r => [...r]) })),
            score: this.score,
            totalClears: this.totalClears,
            steps: this.steps,
            placements: this.placements,
        };
    }

    restoreState(s) {
        const n = this.grid.size;
        for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++)
                this.grid.cells[y][x] = s.cells[y][x];
        this.dock = s.dock.map(b => ({ ...b, shape: b.shape.map(r => [...r]) }));
        this.score = s.score;
        this.totalClears = s.totalClears;
        this.steps = s.steps;
        this.placements = s.placements;
    }

    /** @returns {{ blockIdx: number, gx: number, gy: number }[]} */
    getLegalActions() {
        const actions = [];
        for (let bi = 0; bi < this.dock.length; bi++) {
            const b = this.dock[bi];
            if (b.placed) {
                continue;
            }
            for (let gy = 0; gy < this.grid.size; gy++) {
                for (let gx = 0; gx < this.grid.size; gx++) {
                    if (this.grid.canPlace(b.shape, gx, gy)) {
                        actions.push({ blockIdx: bi, gx, gy });
                    }
                }
            }
        }
        return actions;
    }

    /**
     * 模拟落子后消除几行/列（不修改 this.grid）
     */
    countClearsIfPlaced(blockIdx, gx, gy) {
        const b = this.dock[blockIdx];
        const sim = this.grid.clone();
        sim.place(b.shape, b.colorIdx, gx, gy);
        return sim.checkLines().count;
    }

    isTerminal() {
        const remaining = this.dock.filter((b) => !b.placed);
        if (remaining.length === 0) {
            return false;
        }
        return !this.grid.hasAnyMove(remaining);
    }

    checkFeasibility() {
        const n = this.grid.size;
        for (const b of this.dock) {
            if (b.placed) continue;
            let ok = false;
            for (let gy = 0; gy < n && !ok; gy++)
                for (let gx = 0; gx < n && !ok; gx++)
                    if (this.grid.canPlace(b.shape, gx, gy)) ok = true;
            if (!ok) return 0;
        }
        return 1;
    }

    getSupervisionSignals() {
        return {
            board_quality: boardPotential(this.grid, this.dock) / _BOARD_POT_NORM,
            feasibility: this.checkFeasibility(),
            topology_after: _topologyAuxTargets(this.grid, this.dock),
        };
    }

    /**
     * @returns {number} 本步获得的即时奖励
     */
    step(blockIdx, gx, gy) {
        const b = this.dock[blockIdx];
        if (b.placed || !this.grid.canPlace(b.shape, gx, gy)) {
            return 0;
        }

        const potBefore = _POT_ENABLED ? boardPotential(this.grid, this.dock) : 0;
        const prevScore = this.score;
        this.grid.place(b.shape, b.colorIdx, gx, gy);
        this.placements++;
        this.steps++;

        // 与主局一致：在 checkLines 清空前 detectBonusLines（canonical 主题，非玩家皮肤）
        const bonusSnap = detectBonusLines(this.grid, _rlBonusSkin());
        const result = this.grid.checkLines();
        let gain = 0;
        let clears = 0;
        if (result.count > 0) {
            result.bonusLines = bonusSnap;
            clears = result.count;
            this.totalClears += clears;
            gain = computeClearScore(this.strategyId, result, this.scoring).clearScore;
            this.score += gain;
        }
        this._lastClears = clears;

        b.placed = true;
        if (this.dock.every((x) => x.placed)) {
            this._spawnDock();
        }

        let r = gain;
        if (_POT_ENABLED) {
            r += _POT_COEF * (boardPotential(this.grid, this.dock) - potBefore);
        }
        const wb = Number(RL_REWARD_SHAPING?.winBonus);
        if (Number.isFinite(wb) && wb !== 0 && this.score >= this.winScoreThreshold && prevScore < this.winScoreThreshold) {
            r += wb;
        }
        return r;
    }
}
