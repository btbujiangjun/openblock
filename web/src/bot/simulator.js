/**
 * 与主游戏一致的无头对局，用于自博弈与策略训练
 */
import { Grid } from '../grid.js';
import { getStrategy } from '../config.js';
import { getAllShapes } from '../shapes.js';
import { RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD } from '../gameRules.js';
import { generateDockShapes, generateBlocksForGrid } from './blockSpawn.js';

export { generateDockShapes, generateBlocksForGrid };

export class BlockBlastSimulator {
    /**
     * @param {string} [strategyId]
     */
    constructor(strategyId = 'normal') {
        this.strategyId = strategyId;
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
        const colors = [0, 1, 2, 3, 4, 5, 6, 7];
        for (let i = colors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [colors[i], colors[j]] = [colors[j], colors[i]];
        }
        this.dock = [];
        for (let i = 0; i < 3; i++) {
            const shape = shapes[i] || getAllShapes()[0];
            this.dock.push({
                id: shape.id,
                shape: shape.data,
                colorIdx: colors[i % colors.length],
                placed: false
            });
        }
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

    /**
     * @returns {number} 本步获得的分数增量
     */
    step(blockIdx, gx, gy) {
        const b = this.dock[blockIdx];
        if (b.placed || !this.grid.canPlace(b.shape, gx, gy)) {
            return 0;
        }

        const prevScore = this.score;
        this.grid.place(b.shape, b.colorIdx, gx, gy);
        this.placements++;
        this.steps++;

        const result = this.grid.checkLines();
        let gain = 0;
        let clears = 0;
        if (result.count > 0) {
            clears = result.count;
            this.totalClears += clears;
            if (clears === 1) {
                gain = this.scoring.singleLine;
            } else if (clears === 2) {
                gain = this.scoring.multiLine;
            } else {
                gain = this.scoring.combo + (clears - 2) * this.scoring.multiLine;
            }
            this.score += gain;
        }

        b.placed = true;

        if (this.dock.every((x) => x.placed)) {
            this._spawnDock();
        }

        const rs = RL_REWARD_SHAPING;
        let r = gain;
        const pb = Number(rs.placeBonus);
        if (Number.isFinite(pb) && pb !== 0) {
            r += pb;
        }
        const dc = Number(rs.densePerClear);
        if (Number.isFinite(dc) && dc !== 0 && clears > 0) {
            r += dc * clears;
        }
        const wb = Number(rs.winBonus);
        if (Number.isFinite(wb) && wb !== 0 && this.score >= WIN_SCORE_THRESHOLD && prevScore < WIN_SCORE_THRESHOLD) {
            r += wb;
        }
        return r;
    }
}
