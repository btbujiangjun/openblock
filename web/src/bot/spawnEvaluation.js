/**
 * 离线出块评估工具。
 *
 * 目标：在不改核心出块行为的前提下，用多类 bot 批量跑局，衡量出块公平性、
 * 奖励节奏和失败质量，作为后续 P1/P2 算法重构的基线。
 */
import { OpenBlockSimulator, boardPotential } from './simulator.js';
import { getLastSpawnDiagnostics, resetSpawnMemory } from './blockSpawn.js';
import { SPAWN_POLICY_RULES, SPAWN_POLICY_RULES_MODES } from './spawnExperiments.js';
import { analyzeBoardTopology } from '../boardTopology.js';

export const SPAWN_EVAL_POLICIES = ['random', 'clear-greedy', 'survival'];
export const SPAWN_EVAL_STRATEGIES = ['easy', 'normal', 'hard'];
export const SPAWN_EVAL_GENERATORS = SPAWN_POLICY_RULES_MODES;

const DEFAULT_OPTIONS = {
    seed: 20260523,
    sessions: 60,
    maxSteps: 360,
    maxEvaluatedTriplets: 80,
    bestScore: 1000,
    modelConfig: {
        personalizationStrength: 0,
        temperature: 0,
        surpriseBudgetGain: 0,
        surpriseCooldown: 6,
    },
    policies: SPAWN_EVAL_POLICIES,
    strategies: ['normal'],
    spawnGenerators: [SPAWN_POLICY_RULES],
};

function createRng(seed) {
    let t = Number(seed) >>> 0;
    return function rng() {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function pickRandom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

function countLegalActionsFor(grid, dock) {
    let total = 0;
    for (const b of dock) {
        if (b.placed) continue;
        for (let gy = 0; gy < grid.size; gy++) {
            for (let gx = 0; gx < grid.size; gx++) {
                if (grid.canPlace(b.shape, gx, gy)) total++;
            }
        }
    }
    return total;
}

function evaluateAction(sim, action) {
    const b = sim.dock[action.blockIdx];
    const grid = sim.grid.clone();
    const dock = sim.dock.map((x, i) => ({
        ...x,
        placed: i === action.blockIdx ? true : x.placed,
        shape: x.shape.map((row) => [...row]),
    }));
    grid.place(b.shape, b.colorIdx, action.gx, action.gy);
    const clears = grid.checkLines().count;
    const potential = boardPotential(grid, dock);
    const legalActions = countLegalActionsFor(grid, dock);
    const fill = grid.getFillRatio();
    return { clears, potential, legalActions, fill };
}

function selectAction(sim, policy, rng) {
    const actions = sim.getLegalActions();
    if (actions.length === 0) return null;
    if (policy === 'random') return pickRandom(actions, rng);

    let best = null;
    let bestScore = -Infinity;
    for (const action of actions) {
        const ev = evaluateAction(sim, action);
        let score;
        if (policy === 'clear-greedy') {
            score = ev.clears * 100 + ev.potential + ev.legalActions * 0.02 - ev.fill * 2;
        } else {
            score = ev.legalActions * 0.12 + ev.potential + ev.clears * 8 - ev.fill * 3;
        }
        score += rng() * 1e-6;
        if (score > bestScore) {
            bestScore = score;
            best = action;
        }
    }
    return best;
}

function emptyBucket(strategy, policy, spawnGenerator) {
    return {
        strategy,
        policy,
        spawnGenerator,
        games: 0,
        scores: [],
        steps: [],
        clears: [],
        terminalFill: [],
        terminalHoles: [],
        clearIntervals: [],
        multiClearEvents: 0,
        perfectClears: 0,
        noMoveDeaths: 0,
        spawnCount: 0,
        fallbackSpawns: 0,
        attempts: [],
        firstMoveFreedom: [],
        solutionCount: [],
        chosenReasons: {},
        chosenCategories: {},
        solutionRejects: {},
        budgetSamples: [],
        evaluatedTriplets: [],
        deepEvaluatedTriplets: [],
        nearPbGames: 0,
        breakPbGames: 0,
        overshootGames: 0,
        pbRatios: [],
    };
}

function inc(map, key, by = 1) {
    if (!key) return;
    map[key] = (map[key] || 0) + by;
}

function recordDiagnostics(bucket, sim) {
    const diag = sim?._lastAdaptiveInsight?.spawnDiagnostics || getLastSpawnDiagnostics();
    if (!diag) return;
    bucket.spawnCount++;
    bucket.attempts.push(diag.attempt ?? 0);
    if ((diag.attempt ?? 0) >= 22 || diag.chosen?.some((c) => c.reason === 'fallback')) {
        bucket.fallbackSpawns++;
    }
    for (const chosen of diag.chosen || []) {
        inc(bucket.chosenReasons, chosen.reason || 'unknown');
        inc(bucket.chosenCategories, chosen.category || 'unknown');
    }
    for (const [key, value] of Object.entries(diag.solutionRejects || {})) {
        if (value) inc(bucket.solutionRejects, key, value);
    }
    if (diag.layer2?.experienceBudget) {
        bucket.budgetSamples.push(diag.layer2.experienceBudget);
    }
    if (Number.isFinite(diag.evaluatedTriplets)) {
        bucket.evaluatedTriplets.push(diag.evaluatedTriplets);
    }
    if (Number.isFinite(diag.deepEvaluatedTriplets)) {
        bucket.deepEvaluatedTriplets.push(diag.deepEvaluatedTriplets);
    }
    const sm = diag.layer1?.solutionMetrics;
    if (sm) {
        if (Number.isFinite(sm.firstMoveFreedom)) bucket.firstMoveFreedom.push(sm.firstMoveFreedom);
        if (Number.isFinite(sm.solutionCount)) bucket.solutionCount.push(sm.solutionCount);
    }
}

function mean(values) {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[idx];
}

function round(value, digits = 3) {
    const m = 10 ** digits;
    return Math.round((Number(value) || 0) * m) / m;
}

function summarizeBucket(bucket) {
    const games = Math.max(1, bucket.games);
    const clearIntervalMean = mean(bucket.clearIntervals);
    return {
        strategy: bucket.strategy,
        policy: bucket.policy,
        spawnGenerator: bucket.spawnGenerator,
        games: bucket.games,
        scoreMean: round(mean(bucket.scores), 1),
        scoreP50: round(quantile(bucket.scores, 0.5), 1),
        scoreP90: round(quantile(bucket.scores, 0.9), 1),
        stepsMean: round(mean(bucket.steps), 1),
        clearsMean: round(mean(bucket.clears), 2),
        noMoveRate: round(bucket.noMoveDeaths / games, 4),
        terminalFillMean: round(mean(bucket.terminalFill), 4),
        terminalHolesMean: round(mean(bucket.terminalHoles), 2),
        multiClearRate: round(bucket.multiClearEvents / Math.max(1, bucket.steps.reduce((a, b) => a + b, 0)), 4),
        perfectClearRate: round(bucket.perfectClears / Math.max(1, bucket.steps.reduce((a, b) => a + b, 0)), 4),
        clearIntervalMean: round(clearIntervalMean, 2),
        clearIntervalP90: round(quantile(bucket.clearIntervals, 0.9), 2),
        spawnCount: bucket.spawnCount,
        fallbackRate: round(bucket.fallbackSpawns / Math.max(1, bucket.spawnCount), 4),
        attemptMean: round(mean(bucket.attempts), 2),
        firstMoveFreedomMean: round(mean(bucket.firstMoveFreedom), 2),
        solutionCountMean: round(mean(bucket.solutionCount), 2),
        chosenReasons: bucket.chosenReasons,
        chosenCategories: bucket.chosenCategories,
        solutionRejects: bucket.solutionRejects,
        budgetMean: summarizeBudget(bucket.budgetSamples),
        evaluatedTripletsMean: round(mean(bucket.evaluatedTriplets), 1),
        deepEvaluatedTripletsMean: round(mean(bucket.deepEvaluatedTriplets), 1),
        nearPbRate: round(bucket.nearPbGames / games, 4),
        breakPbRate: round(bucket.breakPbGames / games, 4),
        overshootRate: round(bucket.overshootGames / games, 4),
        pbRatioMean: round(mean(bucket.pbRatios), 3),
    };
}

function summarizeBudget(samples) {
    if (!samples.length) return null;
    return {
        survival: round(mean(samples.map((x) => x.survival)), 3),
        payoff: round(mean(samples.map((x) => x.payoff)), 3),
        pressure: round(mean(samples.map((x) => x.pressure)), 3),
        novelty: round(mean(samples.map((x) => x.novelty)), 3),
        pbTension: round(mean(samples.map((x) => x.pbTension)), 3),
        pbBrake: round(mean(samples.map((x) => x.pbBrake)), 3),
        pbRelease: round(mean(samples.map((x) => x.pbRelease)), 3),
    };
}

function summarizeComparisons(rows) {
    const byStrategy = {};
    for (const row of rows) {
        const key = `${row.strategy}/${row.spawnGenerator}`;
        byStrategy[key] = byStrategy[key] || {};
        byStrategy[key][row.policy] = row;
    }
    return Object.entries(byStrategy).map(([key, group]) => {
        const random = group.random;
        const survival = group.survival;
        const greedy = group['clear-greedy'];
        const [strategy, spawnGenerator] = key.split('/');
        return {
            strategy,
            spawnGenerator,
            naturalFairnessGap: random && survival ? round(random.noMoveRate - survival.noMoveRate, 4) : null,
            skillScoreLift: random && survival ? round(survival.scoreMean - random.scoreMean, 1) : null,
            rewardAgencyGap: random && greedy ? round(greedy.clearsMean - random.clearsMean, 2) : null,
        };
    });
}

/**
 * 把一行评估指标按 5+1 项权重打分,得到综合 optimizerScore。
 *
 * 5 个底层权重 (向后兼容):
 *   noMove / rewardAgency / skillLift / fallback / pacing
 *
 * 1 个新增权重 (v1.62.9+ 反膨胀目标):
 *   antiInflation - 抑制分数膨胀 (overshootRate ≤ 5% 为目标),默认 0 保持向后兼容
 */
/* v1.71 U5：原 `export`，但仅本文件内部 deriveOptimizerScore 调用，无外部消费者。
 * 改为模块内函数收窄公共面。 */
function scoreEvaluationRow(row, weights = {}) {
    const w = {
        noMove: Number(weights.noMove ?? 0.35),
        rewardAgency: Number(weights.rewardAgency ?? 0.25),
        skillLift: Number(weights.skillLift ?? 0.20),
        fallback: Number(weights.fallback ?? 0.12),
        pacing: Number(weights.pacing ?? 0.08),
        antiInflation: Number(weights.antiInflation ?? 0),
    };
    const subs = computeGoalSubscores(row);
    const noMoveScore = 1 - Math.min(1, row.noMoveRate ?? 0);
    const fallbackScore = 1 - Math.min(1, (row.fallbackRate ?? 0) * 8);
    const pacingScore = 1 - Math.min(1, Math.max(0, (row.clearIntervalP90 ?? 0) - 5) / 10);
    const rewardScore = Math.min(1, (row.clearsMean ?? 0) / 40);
    const skillProxy = Math.min(1, (row.firstMoveFreedomMean ?? 0) / 12);
    return Number((
        noMoveScore * w.noMove
        + rewardScore * w.rewardAgency
        + skillProxy * w.skillLift
        + fallbackScore * w.fallback
        + pacingScore * w.pacing
        + subs.antiInflation * w.antiInflation
    ).toFixed(4));
}

/**
 * 把一行评估指标拆解为 3 个业务子分数 (0~1),用于在 UI 上对齐
 * 「是否公平 / 是否有爽点 / 是否会让分数膨胀」这 3 个核心目标。
 *
 * 与 scoreEvaluationRow 的关系: scoreEvaluationRow 用 5+1 底层权重加权,
 * 这里直接给出每个业务目标的 0~1 分,便于 UI 显示"哪个目标拖了后腿"。
 */
export function computeGoalSubscores(row) {
    if (!row || typeof row !== 'object') {
        return { fairness: 0, excitement: 0, antiInflation: 0 };
    }
    const noMoveScore = 1 - Math.min(1, row.noMoveRate ?? 0);
    const skillProxy = Math.min(1, (row.firstMoveFreedomMean ?? 0) / 12);
    const fallbackScore = 1 - Math.min(1, (row.fallbackRate ?? 0) * 8);
    const fairness = (
        noMoveScore * 0.55
        + skillProxy * 0.25
        + fallbackScore * 0.20
    );

    const clearsScore = Math.min(1, (row.clearsMean ?? 0) / 40);
    const multiClearScore = Math.min(1, (row.multiClearRate ?? 0) * 2);
    const pacingScore = 1 - Math.min(1, Math.max(0, (row.clearIntervalP90 ?? 0) - 5) / 10);
    const excitement = (
        clearsScore * 0.50
        + multiClearScore * 0.30
        + pacingScore * 0.20
    );

    // 抑制膨胀: overshootRate ≤ 5% 健康; > 35% 严重
    const overshootScore = 1 - Math.min(1, (row.overshootRate ?? 0) * 4);
    // breakPbRate 健康范围 8-15%, 偏离扣分
    const breakRate = row.breakPbRate ?? 0;
    let breakHealthScore;
    if (breakRate >= 0.08 && breakRate <= 0.15) breakHealthScore = 1;
    else if (breakRate < 0.08) breakHealthScore = Math.max(0, breakRate / 0.08);
    else breakHealthScore = Math.max(0, 1 - (breakRate - 0.15) / 0.30);
    const antiInflation = (
        overshootScore * 0.70
        + breakHealthScore * 0.30
    );

    return {
        fairness: Number(fairness.toFixed(4)),
        excitement: Number(excitement.toFixed(4)),
        antiInflation: Number(antiInflation.toFixed(4)),
    };
}

export function buildEvaluationInsights(report, weights = {}) {
    const rows = report?.rows || [];
    const comparisons = report?.comparisons || [];
    if (!rows.length) {
        return { best: null, findings: [], recommendations: ['先运行至少 1 组评估。'] };
    }
    const ranked = rows.map((row) => ({
        ...row,
        optimizerScore: scoreEvaluationRow(row, weights),
    })).sort((a, b) => b.optimizerScore - a.optimizerScore);
    const best = ranked[0];
    const findings = [];
    const recommendations = [];
    const worstNoMove = [...rows].sort((a, b) => (b.noMoveRate ?? 0) - (a.noMoveRate ?? 0))[0];
    const highFallback = rows.filter((x) => (x.fallbackRate ?? 0) > 0.03);
    const p2Wins = comparisons.filter((x) => x.spawnGenerator === 'budget-p2' && (x.rewardAgencyGap ?? 0) > 0);
    const highOvershoot = rows.filter((x) => (x.overshootRate ?? 0) > 0.15);

    findings.push(`综合评分最高：${best.strategy}/${best.spawnGenerator}/${best.policy}，score=${best.optimizerScore}`);
    if (worstNoMove?.noMoveRate > 0) {
        findings.push(`最高死局率：${worstNoMove.strategy}/${worstNoMove.spawnGenerator}/${worstNoMove.policy} = ${(worstNoMove.noMoveRate * 100).toFixed(1)}%`);
    }
    if (highFallback.length) {
        findings.push(`有 ${highFallback.length} 组 fallbackRate > 3%，说明过滤条件或候选池可能过紧。`);
    }
    if (p2Wins.length) {
        findings.push(`P2 在 ${p2Wins.length} 个难度上 rewardAgencyGap 为正，具备继续放大样本价值。`);
    }
    if (highOvershoot.length) {
        findings.push(`有 ${highOvershoot.length} 组 overshootRate > 15%，存在 PB 膨胀风险。`);
    }

    if (best.spawnGenerator === 'budget-p2') {
        recommendations.push('优先放大 P2 样本，建议 --sessions 100 且只比较 baseline,budget-p2。');
    } else if (best.spawnGenerator === 'triplet-p1') {
        recommendations.push('P1 当前只适合继续实验；上线前需确认 random bot 低填充失败没有增加。');
    } else {
        recommendations.push('baseline 仍占优，P1/P2 需要调预算或降低压力项后再比较。');
    }
    if (worstNoMove?.noMoveRate > 0.25) {
        recommendations.push('降低随机玩家死局率：提高 survival 权重、增加首步自由度约束或降低 pressure 权重。');
    }
    if (rows.some((x) => (x.clearIntervalP90 ?? 0) > 8)) {
        recommendations.push('奖励间隔偏长：提高 payoff 权重或 clearOpportunity 目标。');
    }
    if (highOvershoot.length) {
        recommendations.push('PB 膨胀偏高：提高 pbBrake / pressure，降低 payoff 或 surpriseBudgetGain。');
    }
    return { best, ranked, findings, recommendations };
}

function runOneGame(bucket, strategy, policy, spawnGenerator, rng, options) {
    resetSpawnMemory();
    const sim = new OpenBlockSimulator(strategy, {
        spawnGenerator,
        maxEvaluatedTriplets: options.maxEvaluatedTriplets,
        bestScore: options.bestScore,
        modelConfig: options.modelConfig,
    });
    recordDiagnostics(bucket, sim);

    let sinceLastClear = 0;
    for (let step = 0; step < options.maxSteps; step++) {
        if (sim.isTerminal()) break;
        const action = selectAction(sim, policy, rng);
        if (!action) break;

        const placedBefore = sim.dock.filter((b) => b.placed).length;
        sim.step(action.blockIdx, action.gx, action.gy);
        sinceLastClear++;

        const clears = sim._lastClears || 0;
        if (clears > 0) {
            bucket.clearIntervals.push(sinceLastClear);
            sinceLastClear = 0;
            if (clears >= 2) bucket.multiClearEvents++;
            if (sim.grid.getFillRatio() === 0) bucket.perfectClears++;
        }

        if (placedBefore === 2) {
            recordDiagnostics(bucket, sim);
        }
    }

    const topo = analyzeBoardTopology(sim.grid, { skipSpecialCells: true });
    bucket.games++;
    bucket.scores.push(sim.score);
    bucket.steps.push(sim.steps);
    bucket.clears.push(sim.totalClears);
    bucket.terminalFill.push(sim.grid.getFillRatio());
    bucket.terminalHoles.push(topo.holes ?? 0);
    const bestScore = Number(options.bestScore) || 0;
    if (bestScore > 0) {
        const ratio = sim.score / bestScore;
        bucket.pbRatios.push(ratio);
        if (ratio >= 0.85) bucket.nearPbGames++;
        if (ratio > 1) bucket.breakPbGames++;
        if (ratio > 1.15) bucket.overshootGames++;
    }
    if (sim.isTerminal()) bucket.noMoveDeaths++;
}

export function runSpawnEvaluation(options = {}) {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
        policies: options.policies?.length ? options.policies : DEFAULT_OPTIONS.policies,
        strategies: options.strategies?.length ? options.strategies : DEFAULT_OPTIONS.strategies,
        spawnGenerators: options.spawnGenerators?.length ? options.spawnGenerators : DEFAULT_OPTIONS.spawnGenerators,
    };
    const rng = createRng(opts.seed);
    const originalRandom = Math.random;
    Math.random = rng;
    try {
        const buckets = [];
        for (const strategy of opts.strategies) {
            for (const spawnGenerator of opts.spawnGenerators) {
                for (const policy of opts.policies) {
                    const bucket = emptyBucket(strategy, policy, spawnGenerator);
                    for (let i = 0; i < opts.sessions; i++) {
                        runOneGame(bucket, strategy, policy, spawnGenerator, rng, opts);
                    }
                    buckets.push(bucket);
                }
            }
        }
        const rows = buckets.map(summarizeBucket);
        return {
            generatedAt: new Date().toISOString(),
            options: opts,
            rows,
            comparisons: summarizeComparisons(rows),
            insights: buildEvaluationInsights({ rows, comparisons: summarizeComparisons(rows) }, opts.objectiveWeights),
        };
    } finally {
        Math.random = originalRandom;
    }
}

