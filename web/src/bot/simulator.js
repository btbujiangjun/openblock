/**
 * 与 Web 规则轨实局一致的无头对局，用于自博弈、策略训练与出块评估。
 *
 * 出块链路保持同源：
 * PlayerProfile + spawnContext → resolveAdaptiveStrategy → generateDockShapes。
 */
import { Grid } from '../grid.js';
import { getStrategy } from '../config.js';
import { getAllShapes, getShapeCategory } from '../shapes.js';
import { FEATURE_ENCODING, RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD } from '../gameRules.js';
import { derivePbCurve, resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../adaptiveSpawn.js';
import { PlayerProfile } from '../playerProfile.js';
import {
    generateDockShapes,
    getLastSpawnDiagnostics,
    SPECIAL_SHAPES
} from './blockSpawn.js';
import {
    generateExperimentalDockShapes,
    SPAWN_POLICY_RULES,
} from './spawnExperiments.js';
import {
    computeClearScore,
    deriveNextComboCount,
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
// 吸附/贴合约束：暴露边惩罚权重（负值，|值|越大越鼓励落子贴边/贴块）。
const _POT_W_ADHESION = Number.isFinite(Number(_POT_CFG.adhesionWeight)) ? Number(_POT_CFG.adhesionWeight) : -0.12;
const _POT_COEF = Number(_POT_CFG.coef) || 0.5;
const _POT_ENABLED = Boolean(_POT_CFG.enabled);
const _BOARD_POT_NORM = 30.0;
const _AN = FEATURE_ENCODING?.actionNorm || {};

/** 与主局计分对齐的 bonus / 近满染色偏置；icon 语义仅来自 shared.game_rules.rlBonusScoring.blockIcons。 */
function _rlBonusSkin() {
    return getRlTrainingBonusLineSkin();
}

function _countHoles(grid) {
    return countUnfillableCells(grid);
}

/**
 * 暴露边（吸附/贴合约束用）：占用区朝向「界内空格」的 4-邻接边数（墙边不计 → 贴墙=吸附）。
 * 与 rl_pytorch/fast_grid.py fast_board_features.edge_exposure 口径一致。
 */
function _edgeExposure(grid) {
    const n = grid.size;
    let e = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const cur = grid.cells[y][x] !== null;
            if (x + 1 < n && cur !== (grid.cells[y][x + 1] !== null)) e++;
            if (y + 1 < n && cur !== (grid.cells[y + 1][x] !== null)) e++;
        }
    }
    return e;
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
        + _POT_W_ADHESION * _edgeExposure(grid)
    );
}

export class OpenBlockSimulator {
    /**
     * @param {string} [strategyId]
     * @param {{ winScoreThreshold?: number, bestScore?: number, runStreak?: number, spawnGenerator?: string, maxEvaluatedTriplets?: number, modelConfig?: object }} [options]
     */
    constructor(strategyId = 'normal', options = {}) {
        this.strategyId = strategyId;
        this.bestScore = Math.max(0, Number(options?.bestScore) || 0);
        this.runStreak = Math.max(0, Number(options?.runStreak) || 0);
        this.spawnGenerator = options?.spawnGenerator || SPAWN_POLICY_RULES;
        this.maxEvaluatedTriplets = Number(options?.maxEvaluatedTriplets) || undefined;
        this.modelConfig = options?.modelConfig || {};
        const w = options?.winScoreThreshold;
        this.winScoreThreshold = typeof w === 'number' && Number.isFinite(w)
            ? Math.max(1, Math.round(w))
            : WIN_SCORE_THRESHOLD;
        this.reset();
    }

    reset() {
        resetAdaptiveMilestone();
        const cfg = getStrategy(this.strategyId);
        this.strategyConfig = cfg;
        this.scoring = cfg.scoring;
        this.grid = new Grid(cfg.gridWidth || 8);
        this.grid.initBoard(cfg.fillRatio, cfg.shapeWeights);
        this.playerProfile = new PlayerProfile();
        this.playerProfile.recordNewGame();
        this._spawnContext = this._createSpawnContext();
        this._lastAdaptiveInsight = null;
        this.score = 0;
        this.totalClears = 0;
        this.steps = 0;
        this.placements = 0;
        /* Combo 链（grace 窗口）状态 —— 与 web 主局 _comboCount / _roundsSinceLastClear 同口径 */
        this._comboCount = 0;
        this._roundsSinceLastClear = Number.POSITIVE_INFINITY;
        this._spawnDock();
    }

    _createSpawnContext() {
        return {
            lastClearCount: 0,
            roundsSinceClear: 0,
            recentCategories: [],
            totalRounds: 0,
            scoreMilestone: false,
            bestScore: this.bestScore,
            pbGrowthFast: false,
            bottleneckTrough: Infinity,
            bottleneckSolutionTrough: Infinity,
            bottleneckSamples: 0,
            specialShapeUsed: 0,
            specialReliefUsed: 0,
            specialPressureUsed: 0,
            totalClears: 0,
            roundsSinceSpecial: 0,
            dupInjectUsed: 0,
            roundsSinceDupInject: 0,
        };
    }

    _remainingDockShapePool() {
        return (this.dock || [])
            .filter((b) => b && !b.placed && Array.isArray(b.shape))
            .map((b) => ({ data: b.shape }));
    }

    _resolveLayeredStrategy() {
        // 把 modelConfig (寻参 θ) 注入 spawn ctx, 让 rule 路径的 deriveSpawnTargets /
        // augmentPool 等下游消费点能读到当前 θ.
        this._spawnContext.modelConfig = this.modelConfig;
        const layered = resolveAdaptiveStrategy(
            this.strategyId,
            this.playerProfile,
            this.score,
            this.runStreak,
            this.grid.getFillRatio(),
            {
                ...this._spawnContext,
                _gridRef: this.grid,
                _dockShapePool: this._remainingDockShapePool(),
                modelConfig: this.modelConfig,
            }
        );
        this._spawnContext.scoreMilestone = layered?.spawnHints?.scoreMilestone === true;
        this._spawnContext.roundsSinceSpecial = (this._spawnContext.roundsSinceSpecial ?? 0) + 1;
        this._spawnContext.roundsSinceDupInject = (this._spawnContext.roundsSinceDupInject ?? 0) + 1;
        this._spawnContext.skin = _rlBonusSkin();
        this._lastAdaptiveInsight = {
            adaptiveEnabled: true,
            score: this.score,
            bestScore: this.bestScore,
            fill: this.grid.getFillRatio(),
            spawnHints: { ...(layered.spawnHints || {}) },
            adaptiveStressRaw: layered._adaptiveStressRaw,
        };
        return layered;
    }

    _pickDockColors(layered, diagnostics = null) {
        const iconBonusTarget = Math.max(0, Math.min(1, layered?.spawnHints?.iconBonusTarget ?? 0));
        const bonusBias = monoNearFullLineColorWeights(this.grid, _rlBonusSkin())
            .map((w) => w * (1 + iconBonusTarget * 2.5));
        const diag = diagnostics || getLastSpawnDiagnostics();
        const chosenMetas = diag?.chosen || [];
        const dockColors = new Array(3).fill(null);
        const lockedSlots = new Set();

        for (let i = 0; i < 3; i++) {
            const meta = chosenMetas[i];
            if (meta && (meta.monoFlush ?? 0) >= 1 && Number.isInteger(meta.monoFlushTargetCi)) {
                dockColors[i] = meta.monoFlushTargetCi;
                lockedSlots.add(i);
            }
        }

        const usedSet = new Set();
        for (const slot of lockedSlots) usedSet.add(dockColors[slot]);
        const primaryPicks = pickThreeDockColors(bonusBias).filter((c) => !usedSet.has(c));
        const fallbackPool = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !usedSet.has(c));
        let primaryIdx = 0;

        for (let i = 0; i < 3; i++) {
            if (lockedSlots.has(i)) continue;
            let color = primaryPicks[primaryIdx++];
            if (color == null || usedSet.has(color)) {
                color = fallbackPool.find((c) => !usedSet.has(c));
            }
            if (color == null) color = Math.floor(Math.random() * 8);
            dockColors[i] = color;
            usedSet.add(color);
        }
        return dockColors;
    }

    _commitSpawnContext(shapes, layered, diagnostics = null) {
        this._spawnContext.totalRounds++;
        if (shapes?.some((s) => SPECIAL_SHAPES.includes(s.id))) {
            this._spawnContext.roundsSinceSpecial = 0;
        }
        this._spawnContext.scoreMilestone = false;
        this.playerProfile.recordSpawn();
        this.playerProfile.tickRoundForDelight?.();
        this._spawnContext.prevAdaptiveStress = layered._adaptiveStressRaw;
        this._spawnContext.bottleneckTrough = Infinity;
        this._spawnContext.bottleneckSolutionTrough = Infinity;
        this._spawnContext.bottleneckSamples = 0;

        const diag = diagnostics || getLastSpawnDiagnostics();
        this._spawnContext.nearFullLines = diag?.layer1?.nearFullLines ?? 0;
        this._spawnContext.pcSetup = diag?.layer1?.pcSetup ?? 0;
        this._spawnContext.holes = diag?.layer1?.holes ?? 0;
        this._spawnContext.multiClearCandidates = diag?.layer1?.multiClearCandidates ?? 0;
        this._spawnContext.perfectClearCandidates = diag?.layer1?.perfectClearCandidates ?? 0;
        this._lastAdaptiveInsight = {
            ...(this._lastAdaptiveInsight || {}),
            spawnDiagnostics: diag,
            spawnSource: 'rule',
        };
    }

    _spawnDock() {
        const layered = this._resolveLayeredStrategy();
        let shapes;
        let diagnostics = null;
        if (this.spawnGenerator === SPAWN_POLICY_RULES) {
            shapes = generateDockShapes(this.grid, layered, this._spawnContext);
            diagnostics = getLastSpawnDiagnostics();
        } else {
            // v2.2: 把 modelConfig 的 PB 曲线参数透传到 derivePbCurve, 让寻参 θ
            //       真实驱动双 S 曲线的拐点/斜率。modelConfig 缺省时 fallback 默认值。
            const pbCurve = derivePbCurve(
                this.score,
                this.bestScore,
                this._spawnContext.postPbReleaseActive === true,
                this.modelConfig,
            );
            const generated = generateExperimentalDockShapes(this.grid, layered, this._spawnContext, {
                mode: this.spawnGenerator,
                maxEvaluatedTriplets: this.maxEvaluatedTriplets,
                profile: this.playerProfile,
                ...pbCurve,
                ...this.modelConfig,
            });
            shapes = generated.shapes;
            diagnostics = generated.diagnostics;
        }
        this._commitSpawnContext(shapes, layered, diagnostics);
        const dockColors = this._pickDockColors(layered, diagnostics);
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
            spawnContext: clonePlain(this._spawnContext),
            playerProfile: cloneProfile(this.playerProfile),
            lastAdaptiveInsight: clonePlain(this._lastAdaptiveInsight),
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
        this._spawnContext = clonePlain(s.spawnContext);
        this.playerProfile = restoreProfile(s.playerProfile);
        this._lastAdaptiveInsight = clonePlain(s.lastAdaptiveInsight);
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
        this.grid.place(
            b.shape,
            b.colorIdx,
            gx,
            gy,
            { shapeId: b.id, isSpecial: SPECIAL_SHAPES.includes(b.id) }
        );
        this.placements++;
        this.steps++;

        // 与主局一致：在 checkLines 清空前 detectBonusLines（canonical 主题，非玩家皮肤）
        const bonusSnap = detectBonusLines(this.grid, _rlBonusSkin());
        const result = this.grid.checkLines();
        let gain = 0;
        let clears = 0;
        if (result.count > 0) {
            result.bonusLines = bonusSnap;
            result.perfectClear = this.grid.getFillRatio() === 0;
            clears = result.count;
            this.totalClears += clears;
            /* Combo（grace 窗口模型）—— 与 web 主局 deriveNextComboCount 同口径：
             *   清线 → 若距上次清线步数 < grace：combo+=1；否则重启 = 1。
             * 保持 RL / 评估 / 浏览器主局/小程序/Cocos 完全同源。 */
            this._comboCount = deriveNextComboCount(this._comboCount, this._roundsSinceLastClear, true);
            this._roundsSinceLastClear = 0;
            gain = computeClearScore(this.strategyId, result, this.scoring, this._comboCount).clearScore;
            this.score += gain;
            this._spawnContext.lastClearCount = result.count;
            this._spawnContext.roundsSinceClear = 0;
            if (result.perfectClear) {
                this.playerProfile.recordDelight?.('pcClear');
            } else if (result.count >= 2) {
                this.playerProfile.recordDelight?.('multiClear');
            } else if ((result.bonusLines || []).some((x) => x?.kind === 'monoFlush' || x?.iconBonus >= 5)) {
                this.playerProfile.recordDelight?.('monoFlush');
            }
        } else {
            this._spawnContext.lastClearCount = 0;
            /* 未清线 → 累加 grace 计数；_comboCount 自身不在此归零，
             * 等到下次清线由 deriveNextComboCount 决定（gap≥grace → 重置为 1）。 */
            this._roundsSinceLastClear = (this._roundsSinceLastClear === Number.POSITIVE_INFINITY)
                ? Number.POSITIVE_INFINITY
                : this._roundsSinceLastClear + 1;
        }
        this._lastClears = clears;
        this.playerProfile.recordPlace(result.count > 0, result.count, this.grid.getFillRatio());

        b.placed = true;
        if (this.dock.every((x) => x.placed)) {
            if (this._spawnContext.lastClearCount === 0) {
                this._spawnContext.roundsSinceClear++;
            }
            this._rememberRecentCategories();
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

    _rememberRecentCategories() {
        const cats = this.dock.map((b) => getShapeCategory(b.id));
        this._spawnContext.recentCategories = [
            ...(this._spawnContext.recentCategories || []),
            ...cats,
        ].slice(-9);
        this._spawnContext.totalClears = this.totalClears;
    }
}

function clonePlain(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(value));
}

function cloneProfile(profile) {
    const data = {};
    for (const key of Object.keys(profile || {})) {
        data[key] = clonePlain(profile[key]);
    }
    return data;
}

function restoreProfile(snapshot) {
    const profile = new PlayerProfile();
    for (const [key, value] of Object.entries(snapshot || {})) {
        profile[key] = clonePlain(value);
    }
    return profile;
}
