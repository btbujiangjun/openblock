/**
 * RL 训练环境出块桥：与线上同一套 resolveAdaptiveStrategy + generateDockShapes（规则轨）。
 * 刻意不 import OpenBlockSimulator，避免拉起 spawnExperiments / DOM 侧模块。
 */
import { Grid } from '../grid.js';
import { getStrategy } from '../config.js';
import { resolveAdaptiveStrategy } from '../adaptiveSpawn.js';
import { PlayerProfile } from '../playerProfile.js';
import { generateDockShapes, getLastSpawnDiagnostics } from './blockSpawn.js';
import {
    monoNearFullLineColorWeights,
    pickThreeDockColors,
} from '../clearScoring.js';
import { getRlTrainingBonusLineSkin } from '../skins.js';

function _pickDockColors(grid, layered, diagnostics) {
    const iconBonusTarget = Math.max(0, Math.min(1, layered?.spawnHints?.iconBonusTarget ?? 0));
    const bonusBias = monoNearFullLineColorWeights(grid, getRlTrainingBonusLineSkin())
        .map((w) => w * (1 + iconBonusTarget * 2.5));
    const chosenMetas = diagnostics?.chosen || [];
    const dockColors = [null, null, null];
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

/**
 * @param {object} snapshot
 */
export function spawnDockOnlineSnapshot(snapshot) {
    const strategyId = snapshot.strategyId || 'normal';
    const cfg = getStrategy(strategyId);
    const grid = new Grid(cfg.gridWidth || 8);
    const n = grid.size;
    const cells = snapshot.cells || [];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const row = cells[y];
            grid.cells[y][x] = row && row[x] !== undefined ? row[x] : null;
        }
    }

    const score = Number(snapshot.score) || 0;
    const runStreak = Number(snapshot.runStreak) || 0;
    const bestScore = Number(snapshot.bestScore) || 0;

    const spawnContext = {
        lastClearCount: 0,
        roundsSinceClear: 0,
        recentCategories: [],
        totalRounds: 0,
        scoreMilestone: false,
        bestScore,
        pbGrowthFast: false,
        bottleneckTrough: Infinity,
        bottleneckSolutionTrough: Infinity,
        bottleneckSamples: 0,
        specialShapeUsed: 0,
        specialReliefUsed: 0,
        specialPressureUsed: 0,
        totalClears: Number(snapshot.totalClears) || 0,
        roundsSinceSpecial: 0,
        dupInjectUsed: 0,
        roundsSinceDupInject: 0,
        ...(snapshot.spawnContext || {}),
    };
    spawnContext.bestScore = Math.max(spawnContext.bestScore ?? 0, bestScore);

    let profile;
    if (snapshot.profileJson && typeof snapshot.profileJson === 'object') {
        profile = PlayerProfile.fromJSON(snapshot.profileJson);
    } else {
        profile = new PlayerProfile();
        profile.recordNewGame();
    }

    spawnContext.roundsSinceSpecial = (spawnContext.roundsSinceSpecial ?? 0) + 1;
    spawnContext.roundsSinceDupInject = (spawnContext.roundsSinceDupInject ?? 0) + 1;
    spawnContext.skin = getRlTrainingBonusLineSkin();

    const layered = resolveAdaptiveStrategy(
        strategyId,
        profile,
        score,
        runStreak,
        grid.getFillRatio(),
        {
            ...spawnContext,
            _gridRef: grid,
            _dockShapePool: [],
            modelConfig: snapshot.modelConfig || {},
        },
    );
    spawnContext.scoreMilestone = layered?.spawnHints?.scoreMilestone === true;

    profile.recordSpawn();
    const shapes = generateDockShapes(grid, layered, spawnContext);
    const diagnostics = getLastSpawnDiagnostics();
    const dockColors = _pickDockColors(grid, layered, diagnostics);

    spawnContext.totalRounds++;
    spawnContext.scoreMilestone = false;
    spawnContext.prevAdaptiveStress = layered._adaptiveStressRaw;
    spawnContext.bottleneckTrough = Infinity;
    spawnContext.bottleneckSolutionTrough = Infinity;
    spawnContext.bottleneckSamples = 0;
    spawnContext.nearFullLines = diagnostics?.layer1?.nearFullLines ?? 0;
    spawnContext.pcSetup = diagnostics?.layer1?.pcSetup ?? 0;
    spawnContext.holes = diagnostics?.layer1?.holes ?? 0;
    spawnContext.multiClearCandidates = diagnostics?.layer1?.multiClearCandidates ?? 0;
    spawnContext.perfectClearCandidates = diagnostics?.layer1?.perfectClearCandidates ?? 0;

    return {
        shapes: shapes.map((s) => ({ id: s.id, data: s.data.map((r) => [...r]) })),
        dockColors,
        diagnostics,
        spawnContext,
        profileJson: profile.toJSON(),
    };
}
