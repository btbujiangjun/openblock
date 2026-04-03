/**
 * 与主游戏一致的无头对局，用于自博弈与策略训练
 */
import { Grid } from '../grid.js';
import { getStrategy } from '../config.js';
import { getAllShapes, getShapeCategory } from '../shapes.js';

/**
 * @param {Grid} grid
 * @param {object} strategyConfig
 */
export function generateBlocksForGrid(grid, strategyConfig) {
    const blocks = [];
    const usedIds = {};
    const allShapes = getAllShapes();
    const weights = strategyConfig.shapeWeights;

    const scored = allShapes
        .map((shape) => {
            const canPlace = grid.canPlaceAnywhere(shape.data);
            const gapFills = canPlace ? grid.countGapFills(shape.data) : 0;
            const category = getShapeCategory(shape.id);
            const weight = weights[category] || 1;
            return { shape, canPlace, gapFills, weight, category };
        })
        .filter((s) => s.canPlace);

    if (scored.length === 0) {
        return [];
    }

    scored.sort((a, b) => b.gapFills - a.gapFills);

    const clearCandidates = scored.filter((s) => s.gapFills > 0);
    if (clearCandidates.length > 0) {
        const idx = Math.floor(Math.random() * Math.min(3, clearCandidates.length));
        blocks.push(clearCandidates[idx].shape);
        usedIds[clearCandidates[idx].shape.id] = true;
    }

    const remaining = scored.filter((s) => !usedIds[s.shape.id]);

    while (blocks.length < 3 && remaining.length > 0) {
        const totalWeight = remaining.reduce((sum, s) => sum + s.weight, 0);
        let rand = Math.random() * totalWeight;
        let selectedIdx = 0;
        for (let i = 0; i < remaining.length; i++) {
            rand -= remaining[i].weight;
            if (rand <= 0) {
                selectedIdx = i;
                break;
            }
        }
        blocks.push(remaining[selectedIdx].shape);
        usedIds[remaining[selectedIdx].shape.id] = true;
        remaining.splice(selectedIdx, 1);
    }

    for (let i = blocks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }

    while (blocks.length < 3) {
        blocks.push(allShapes[Math.floor(Math.random() * allShapes.length)]);
    }

    return blocks.slice(0, 3);
}

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
        this.grid = new Grid(cfg.gridWidth || 9);
        this.grid.initBoard(cfg.fillRatio, cfg.shapeWeights);
        this.score = 0;
        this.totalClears = 0;
        this.steps = 0;
        this.placements = 0;
        this._spawnDock();
    }

    _spawnDock() {
        const shapes = generateBlocksForGrid(this.grid, this.strategyConfig);
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

        this.grid.place(b.shape, b.colorIdx, gx, gy);
        this.placements++;
        this.steps++;

        const result = this.grid.checkLines();
        let gain = 0;
        if (result.count > 0) {
            this.totalClears += result.count;
            if (result.count === 1) {
                gain = this.scoring.singleLine;
            } else if (result.count === 2) {
                gain = this.scoring.multiLine;
            } else {
                gain = this.scoring.combo + (result.count - 2) * this.scoring.multiLine;
            }
            this.score += gain;
        }

        b.placed = true;

        if (this.dock.every((x) => x.placed)) {
            this._spawnDock();
        }

        return gain;
    }
}
