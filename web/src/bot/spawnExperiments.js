/**
 * P1/P2 出块实验轨。
 *
 * 这些生成器只用于离线评估和可视化对比，不替换线上 generateDockShapes 主路径。
 */
import { getAllShapes, getShapeCategory, isSpecialShapeId } from '../shapes.js';
import {
    evaluateTripletSolutions,
    validateSpawnTriplet,
} from './blockSpawn.js';

export const SPAWN_GENERATOR_BASELINE = 'baseline';
export const SPAWN_GENERATOR_TRIPLET_P1 = 'triplet-p1';
export const SPAWN_GENERATOR_BUDGET_P2 = 'budget-p2';
export const SPAWN_GENERATOR_MODES = [
    SPAWN_GENERATOR_BASELINE,
    SPAWN_GENERATOR_TRIPLET_P1,
    SPAWN_GENERATOR_BUDGET_P2,
];

export const DEFAULT_MAX_EVALUATED_TRIPLETS = 80;
const MAX_DEEP_EVALUATED_TRIPLETS = 8;

const CATEGORY_COMPLEXITY = {
    lines: 0.15,
    rects: 0.25,
    squares: 0.2,
    tshapes: 0.62,
    zshapes: 0.75,
    lshapes: 0.68,
    jshapes: 0.68,
};

function clamp01(v) {
    if (!Number.isFinite(Number(v))) return 0;
    return Math.max(0, Math.min(1, Number(v)));
}

function normalizePreferenceVector(input = {}) {
    return {
        clearSeeker: clamp01(input.clearSeeker ?? 0.5),
        comboPlanner: clamp01(input.comboPlanner ?? 0.5),
        survivalist: clamp01(input.survivalist ?? 0.5),
        riskTaker: clamp01(input.riskTaker ?? 0.35),
        noveltyLover: clamp01(input.noveltyLover ?? 0.5),
    };
}

export function derivePreferenceVector(profile = {}, ctx = {}) {
    const metrics = profile.metrics || {};
    const playstyle = profile.playstyle || 'balanced';
    const clearRate = clamp01(metrics.clearRate ?? 0.35);
    const comboRate = clamp01(metrics.comboRate ?? 0.2);
    const skill = clamp01(profile.skillLevel ?? 0.5);
    const frustration = clamp01((profile.frustrationLevel ?? 0) / 5);
    const rounds = Math.min(1, (ctx.totalRounds ?? 0) / 80);
    const pref = normalizePreferenceVector({
        clearSeeker: clearRate * 0.7 + (playstyle === 'multi_clear' ? 0.25 : 0.1),
        comboPlanner: comboRate * 0.7 + (playstyle === 'combo' ? 0.25 : 0.1),
        survivalist: frustration * 0.45 + (1 - skill) * 0.25 + (playstyle === 'survival' ? 0.25 : 0.1),
        riskTaker: skill * 0.5 + (playstyle === 'perfect_hunter' ? 0.25 : 0.05),
        noveltyLover: rounds * 0.35 + (profile.flowState === 'bored' ? 0.35 : 0.15),
    });
    return pref;
}

function shapeCellCount(data) {
    let n = 0;
    for (const row of data || []) {
        for (const cell of row) if (cell) n++;
    }
    return n;
}

function countLegalPlacements(grid, shapeData) {
    let c = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            if (grid.canPlace(shapeData, x, y)) c++;
        }
    }
    return c;
}

function bestClearPotential(grid, shapeData) {
    let best = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            const outcome = grid.previewClearOutcome?.(shapeData, x, y, 0);
            if (!outcome) continue;
            best = Math.max(best, (outcome.rows?.length ?? 0) + (outcome.cols?.length ?? 0));
        }
    }
    return best;
}

export function deriveExperienceBudget(layered = {}, ctx = {}, fill = 0, mode = SPAWN_GENERATOR_TRIPLET_P1, options = {}) {
    const hints = layered.spawnHints || {};
    const targets = hints.spawnTargets || {};
    const stress01 = clamp01(((layered._adaptiveStressRaw ?? 0) + 0.2) / 1.2);
    const recovery = hints.delightMode === 'relief' || (ctx.roundsSinceClear ?? 0) >= 3 || fill >= 0.62;
    const p2 = mode === SPAWN_GENERATOR_BUDGET_P2;

    const personalizationStrength = clamp01(options.personalizationStrength ?? 0);
    const preference = normalizePreferenceVector(options.preference || derivePreferenceVector(options.profile, ctx));
    const pbTension = clamp01(options.pbTension ?? 0);
    const pbBrake = clamp01(options.pbBrake ?? 0);
    const pbRelease = clamp01(options.pbRelease ?? 0);
    const personalizationGate = (1 - pbTension * 0.5) * (1 - pbBrake * 0.6);
    const personal = personalizationStrength * personalizationGate;
    const surpriseBudget = clamp01(
        (Number(options.surpriseBudgetGain) || 0)
        * Math.min(1, ((ctx.roundsSinceClear ?? 0) + (ctx.totalRounds ?? 0) / 20) / Math.max(1, Number(options.surpriseCooldown) || 6))
    );

    const survival = clamp01(
        (recovery ? 0.42 : 0.16)
        + (1 - stress01) * 0.16
        + fill * 0.28
        + clamp01(targets.solutionSpacePressure ?? 0.4) * (p2 ? 0.18 : 0.08)
        + preference.survivalist * personal * 0.22
        + pbRelease * 0.2
    );
    const payoff = clamp01(
        (targets.clearOpportunity ?? 0.35) * 0.48
        + (targets.payoffIntensity ?? 0.25) * 0.34
        + (hints.multiClearBonus ?? 0) * 0.18
        + (p2 ? 0.08 : 0)
        + (preference.clearSeeker * 0.14 + preference.comboPlanner * 0.1) * personal
        + surpriseBudget * 0.1
        + pbRelease * 0.12
        - pbBrake * 0.16
    );
    const pressure = clamp01(
        stress01 * 0.42
        + (targets.spatialPressure ?? 0.35) * 0.28
        + (targets.shapeComplexity ?? 0.4) * 0.3
        - survival * 0.18
        + preference.riskTaker * personal * 0.18
        + pbTension * 0.22
        + pbBrake * 0.24
        - pbRelease * 0.2
    );
    const novelty = clamp01(
        (targets.novelty ?? 0.25) * 0.55
        + (hints.diversityBoost ?? 0) * 0.35
        + (ctx.totalRounds ?? 0) / 120
        + preference.noveltyLover * personal * 0.2
        + surpriseBudget * 0.16
    );

    return {
        survival,
        payoff,
        pressure,
        novelty,
        personalizationStrength: round3(personal),
        surpriseBudget: round3(surpriseBudget),
        pbRatio: options.pbRatio == null ? null : round3(options.pbRatio),
        pbTension: round3(pbTension),
        pbBrake: round3(pbBrake),
        pbRelease: round3(pbRelease),
        pbPhase: options.pbPhase || 'unknown',
    };
}

function round3(v) {
    return Math.round((Number(v) || 0) * 1000) / 1000;
}

function buildShapeCandidates(grid, layered, budget) {
    const weights = layered.shapeWeights || {};
    return getAllShapes()
        .filter((shape) => !isSpecialShapeId(shape.id))
        .map((shape) => {
            if (!grid.canPlaceAnywhere(shape.data)) return null;
            const category = getShapeCategory(shape.id);
            const placements = countLegalPlacements(grid, shape.data);
            const cells = shapeCellCount(shape.data);
            const clearPotential = bestClearPotential(grid, shape.data);
            const exactFit = grid.bestExactFit ? grid.bestExactFit(shape.data) : 0;
            const complexity = CATEGORY_COMPLEXITY[category] ?? 0.5;
            const base = weights[category] ?? 1;
            const score = base
                + budget.survival * Math.log1p(placements) * 1.4
                + budget.payoff * (clearPotential * 2.2 + exactFit * 1.2)
                + budget.pressure * (cells / 5 + complexity)
                + budget.novelty * complexity * 0.7;
            return { shape, category, placements, cells, clearPotential, exactFit, complexity, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 18);
}

function categoryDiversity(triplet) {
    return new Set(triplet.map((x) => x.category)).size / 3;
}

function scoreTriplet(grid, triplet, budget, mode) {
    const shapes = triplet.map((x) => x.shape);
    const validation = validateSpawnTriplet(grid, shapes);
    if (!validation.ok) return null;

    const metrics = evaluateTripletSolutions(grid, shapes.map((s) => s.data), {
        leafCap: 48,
        budget: 3600,
    });
    const totalClear = triplet.reduce((s, x) => s + x.clearPotential, 0);
    const totalCells = triplet.reduce((s, x) => s + x.cells, 0);
    const meanComplexity = triplet.reduce((s, x) => s + x.complexity, 0) / triplet.length;
    const minPlacements = Math.min(...triplet.map((x) => x.placements));
    const diversity = categoryDiversity(triplet);

    const survivalScore =
        Math.log1p(metrics.firstMoveFreedom || minPlacements) * 1.6
        + clamp01(metrics.firstMoveSurvivorRatio) * 3
        + Math.max(0, 1 - metrics.meanEndFillRatio) * 1.6;
    const payoffScore = totalClear * 2.4 + triplet.reduce((s, x) => s + x.exactFit, 0);
    const pressureScore =
        (totalCells / 10)
        + meanComplexity * 2
        + Math.max(0, 6 - (metrics.validPerms || 6)) * 0.35;
    const noveltyScore = diversity * 2 + meanComplexity;

    const modeBoost = mode === SPAWN_GENERATOR_BUDGET_P2 ? 1.2 : 1;
    const score =
        budget.survival * survivalScore * modeBoost
        + budget.payoff * payoffScore * modeBoost
        + budget.pressure * pressureScore
        + budget.novelty * noveltyScore
        + minPlacements * 0.04;

    return { score, metrics, minPlacements, totalClear, totalCells, diversity };
}

function cheapTripletScore(triplet, budget) {
    const totalClear = triplet.reduce((s, x) => s + x.clearPotential, 0);
    const totalCells = triplet.reduce((s, x) => s + x.cells, 0);
    const minPlacements = Math.min(...triplet.map((x) => x.placements));
    const meanComplexity = triplet.reduce((s, x) => s + x.complexity, 0) / triplet.length;
    const diversity = categoryDiversity(triplet);
    return (
        budget.survival * Math.log1p(minPlacements) * 2.2
        + budget.payoff * totalClear * 2.6
        + budget.pressure * (totalCells / 6 + meanComplexity)
        + budget.novelty * (diversity * 2 + meanComplexity)
        + triplet.reduce((s, x) => s + x.score, 0) * 0.08
    );
}

export function generateExperimentalDockShapes(grid, layered, ctx = {}, options = {}) {
    const mode = options.mode || SPAWN_GENERATOR_TRIPLET_P1;
    const maxEvaluatedTriplets = Math.max(
        12,
        Math.min(240, Number(options.maxEvaluatedTriplets) || DEFAULT_MAX_EVALUATED_TRIPLETS)
    );
    const fill = grid.getFillRatio();
    const budget = deriveExperienceBudget(layered, ctx, fill, mode, options);
    const candidates = buildShapeCandidates(grid, layered, budget);
    let best = null;
    let evaluated = 0;
    let rejected = 0;
    const cheapTop = [];

    for (let i = 0; i < candidates.length - 2; i++) {
        for (let j = i + 1; j < candidates.length - 1; j++) {
            for (let k = j + 1; k < candidates.length; k++) {
                if (evaluated >= maxEvaluatedTriplets) break;
                const triplet = [candidates[i], candidates[j], candidates[k]];
                const score = cheapTripletScore(triplet, budget);
                cheapTop.push({ score, triplet });
                evaluated++;
                if (cheapTop.length > maxEvaluatedTriplets) {
                    cheapTop.sort((a, b) => b.score - a.score);
                    cheapTop.length = maxEvaluatedTriplets;
                }
            }
            if (evaluated >= maxEvaluatedTriplets) break;
        }
        if (evaluated >= maxEvaluatedTriplets) break;
    }

    cheapTop.sort((a, b) => b.score - a.score);
    const deepPool = cheapTop.slice(0, Math.min(MAX_DEEP_EVALUATED_TRIPLETS, cheapTop.length));
    let deepEvaluated = 0;
    const validDeep = [];
    for (const item of deepPool) {
        deepEvaluated++;
        const scored = scoreTriplet(grid, item.triplet, budget, mode);
        if (!scored) {
            rejected++;
            continue;
        }
        const packed = { ...scored, triplet: item.triplet };
        validDeep.push(packed);
        if (!best || packed.score > best.score) {
            best = packed;
        }
    }

    if (!best) {
        const fallback = candidates.slice(0, 3).map((x) => x.shape);
        return {
            shapes: fallback,
            diagnostics: buildDiagnostics(mode, budget, null, fallback, evaluated, deepEvaluated, rejected, true),
        };
    }

    const picked = pickScoredTriplet(validDeep, best, options);
    const shapes = picked.triplet.map((x) => x.shape);
    return {
        shapes,
        diagnostics: buildDiagnostics(mode, budget, picked, shapes, evaluated, deepEvaluated, rejected, false),
    };
}

function pickScoredTriplet(validDeep, best, options = {}) {
    const temperature = clamp01(options.temperature ?? 0);
    if (temperature <= 0.01 || validDeep.length <= 1) return best;
    const scored = validDeep
        .map((item) => ({ item, score: item.score + Math.random() * temperature * 0.15 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
    const temp = Math.max(0.05, temperature);
    const max = Math.max(...scored.map((x) => x.score));
    const weights = scored.map((x) => Math.exp((x.score - max) / temp));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < scored.length; i++) {
        r -= weights[i];
        if (r <= 0) {
            return { ...scored[i].item, score: scored[i].score, sampled: true };
        }
    }
    return best;
}

function buildDiagnostics(mode, budget, best, shapes, evaluated, deepEvaluated, rejected, fallback) {
    const chosen = shapes.map((shape) => ({
        id: shape.id,
        category: getShapeCategory(shape.id),
        reason: mode,
        topDriver: { key: mode, label: mode === SPAWN_GENERATOR_BUDGET_P2 ? '体验预算' : '组合评分' },
        pcPotential: 0,
        multiClear: 0,
        gapFills: 0,
        exactFit: 0,
        monoFlush: 0,
        monoFlushBuildup: 0,
        placements: 0,
    }));
    return {
        experimentMode: mode,
        layer1: {
            solutionMetrics: best?.metrics || null,
            firstMoveFreedom: best?.metrics?.firstMoveFreedom ?? 0,
            solutionCount: best?.metrics?.solutionCount ?? 0,
        },
        layer2: {
            experienceBudget: budget,
            totalClearPotential: best?.totalClear ?? 0,
            categoryDiversity: best?.diversity ?? 0,
            sampled: best?.sampled === true,
        },
        chosen,
        attempt: 0,
        solutionRejects: { experimentalRejected: rejected },
        evaluatedTriplets: evaluated,
        deepEvaluatedTriplets: deepEvaluated,
        fallback,
    };
}

