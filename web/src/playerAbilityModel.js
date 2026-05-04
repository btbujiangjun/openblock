/**
 * 玩家能力统一输出层。
 *
 * 该模块把 PlayerProfile 的实时规则信号、盘面拓扑和局级统计聚合为可展示、
 * 可用于自适应投放、也可离线训练校准的 AbilityVector。
 */
import { analyzeBoardTopology } from './boardTopology.js';
import { GAME_RULES } from './gameRules.js';

export const ABILITY_VECTOR_VERSION = 1;
const ABILITY_CFG = GAME_RULES.playerAbilityModel ?? {};

const PLAYSTYLE_LABEL = {
    perfect_hunter: '清屏猎人',
    multi_clear: '多消流',
    combo: '连消流',
    survival: '生存流',
    balanced: '均衡',
};

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function round(v, digits = 3) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const k = 10 ** digits;
    return Math.round(n * k) / k;
}

function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function avg(xs) {
    const nums = xs.map(Number).filter(Number.isFinite);
    return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0;
}

function lastFinite(xs, fallback = 0) {
    for (let i = xs.length - 1; i >= 0; i--) {
        const n = Number(xs[i]);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

function riskBand(v) {
    const bands = ABILITY_CFG.bands ?? {};
    if (v >= num(bands.riskHigh, 0.72)) return 'high';
    if (v >= num(bands.riskMid, 0.42)) return 'mid';
    return 'low';
}

function skillBand(v) {
    const bands = ABILITY_CFG.bands ?? {};
    if (v >= num(bands.skillExpert, 0.78)) return 'expert';
    if (v >= num(bands.skillAdvanced, 0.58)) return 'advanced';
    if (v >= num(bands.skillDeveloping, 0.36)) return 'developing';
    return 'beginner';
}

function topologyFromContext(ctx) {
    if (ctx?.topology && typeof ctx.topology === 'object') {
        return ctx.topology;
    }
    if (ctx?.grid?.cells?.length) {
        return analyzeBoardTopology(ctx.grid);
    }
    return null;
}

function modelBaseline(ctx) {
    const m = ctx?.modelBaseline;
    if (!m || typeof m !== 'object') return null;
    const confidence = clamp01(m.confidence ?? 0);
    if (confidence <= 0) return null;
    return {
        skillScore: clamp01(m.skillScore),
        riskLevel: clamp01(m.riskLevel),
        confidence,
        source: m.source || 'offline',
    };
}

function explainTop(v) {
    const explainCfg = ABILITY_CFG.explain ?? {};
    const out = [];
    if (v.clearEfficiency >= num(explainCfg.clearEfficiencyHigh, 0.72)) out.push('消行效率高，多消兑现能力强');
    else if (v.clearEfficiency <= num(explainCfg.clearEfficiencyLow, 0.35)) out.push('消行效率偏低，需要更多保活与消行机会');

    if (v.boardPlanning >= num(explainCfg.boardPlanningHigh, 0.70)) out.push('盘面规划稳定，空洞与可落位风险较低');
    else if (v.boardPlanning <= num(explainCfg.boardPlanningLow, 0.38)) out.push('盘面规划承压，空洞或高填充风险较高');

    if (v.controlScore <= num(explainCfg.controlLow, 0.42)) out.push('操作稳定性偏低，失误或决策负荷偏高');
    if (v.riskLevel >= num(explainCfg.riskHigh, 0.70)) out.push('短期死局风险偏高，建议降低投放压力');
    if (v.flowState === 'bored') out.push('当前挑战偏低，可轻微加压');
    if (v.flowState === 'anxious') out.push('当前挑战偏高，应优先减压');
    if (out.length === 0) out.push('能力与挑战匹配度稳定，维持当前节奏');
    return out.slice(0, 3);
}

/**
 * @typedef {object} AbilityVector
 * @property {number} version
 * @property {number} skillScore 综合能力 [0,1]
 * @property {number} controlScore 操作稳定性 [0,1]
 * @property {number} clearEfficiency 消行效率 [0,1]
 * @property {number} boardPlanning 盘面规划能力 [0,1]
 * @property {number} riskTolerance 风险偏好 [0,1]
 * @property {number} riskLevel 短期风险 [0,1]
 * @property {number} confidence 数据置信 [0,1]
 * @property {string} skillBand
 * @property {string} riskBand
 * @property {string} playstyle
 * @property {string} playstyleLabel
 * @property {string} flowState
 * @property {string[]} explain
 * @property {object} features
 * @property {object|null} baseline
 */

/**
 * 构建统一玩家能力向量。
 *
 * @param {object} profile PlayerProfile 或与其 getter 兼容的对象
 * @param {{
 *   grid?: object,
 *   topology?: object,
 *   boardFill?: number,
 *   gameStats?: object,
 *   spawnContext?: object,
 *   adaptiveInsight?: object,
 *   modelBaseline?: { skillScore?: number, riskLevel?: number, confidence?: number, source?: string }
 * }} [ctx]
 * @returns {AbilityVector}
 */
export function buildPlayerAbilityVector(profile, ctx = {}) {
    const cfg = ABILITY_CFG;
    const baselineCfg = cfg.baseline ?? {};
    const controlCfg = cfg.control ?? {};
    const controlWeights = controlCfg.weights ?? {};
    const clearCfg = cfg.clearEfficiency ?? {};
    const clearWeights = clearCfg.weights ?? {};
    const boardCfg = cfg.boardPlanning ?? {};
    const boardWeights = boardCfg.weights ?? {};
    const riskCfg = cfg.risk ?? {};
    const riskWeights = riskCfg.weights ?? {};
    const toleranceCfg = cfg.riskTolerance ?? {};
    const toleranceWeights = toleranceCfg.weights ?? {};
    const confidenceCfg = cfg.confidence ?? {};
    const metrics = profile?.metrics ?? {};
    const topology = topologyFromContext(ctx);
    const boardFill = clamp01(
        ctx.boardFill
        ?? topology?.fillRatio
        ?? ctx.adaptiveInsight?.boardFill
        ?? 0
    );
    const holes = Math.max(0, Number(topology?.holes ?? 0) || 0);
    const mobility = Math.max(0, Number(ctx.spawnContext?.mobility ?? topology?.mobility ?? 0) || 0);
    const closeLines = Math.max(0, Number(topology?.close1 ?? 0) || 0) + Math.max(0, Number(topology?.close2 ?? 0) || 0);

    const missRate = clamp01(metrics.missRate ?? 0);
    const clearRate = clamp01(metrics.clearRate ?? 0);
    const comboRate = clamp01(metrics.comboRate ?? 0);
    const afkCount = Math.max(0, Number(metrics.afkCount ?? 0) || 0);
    const cognitiveLoad = clamp01(profile?.cognitiveLoad ?? 0.3);
    const engagementAPM = Math.max(0, Number(profile?.engagementAPM ?? 6) || 0);
    const avgLines = Math.max(0, Number(profile?.avgLinesPerClear ?? 0) || 0);

    const baseSkill = clamp01(profile?.skillLevel ?? 0.5);
    const baseline = modelBaseline(ctx);
    const skillBlendScale = num(baselineCfg.skillBlendScale, 0.35);
    const skillScore = baseline && baseline.confidence >= num(baselineCfg.skillMinConfidence, 0.35)
        ? clamp01(baseSkill * (1 - baseline.confidence * skillBlendScale) + baseline.skillScore * baseline.confidence * skillBlendScale)
        : baseSkill;

    const controlScore = clamp01(
        (1 - Math.min(1, missRate / num(controlCfg.missRateMax, 0.3))) * num(controlWeights.miss, 0.38)
        + (1 - cognitiveLoad) * num(controlWeights.cognitiveLoad, 0.27)
        + (1 - Math.min(1, afkCount / num(controlCfg.afkMax, 3))) * num(controlWeights.afk, 0.17)
        + clamp01(engagementAPM / num(controlCfg.apmMax, 14)) * num(controlWeights.apm, 0.18)
    );

    const clearEfficiency = clamp01(
        Math.min(1, clearRate / num(clearCfg.clearRateMax, 0.55)) * num(clearWeights.clearRate, 0.55)
        + Math.min(1, comboRate / num(clearCfg.comboRateMax, 0.45)) * num(clearWeights.comboRate, 0.25)
        + Math.min(1, avgLines / num(clearCfg.avgLinesMax, 2.5)) * num(clearWeights.avgLines, 0.20)
    );

    const holePenalty = Math.min(1, holes / num(boardCfg.holeMax, 10));
    const fillPenalty = Math.max(0, (boardFill - num(boardCfg.fillPenaltyStart, 0.58)) / num(boardCfg.fillPenaltySpan, 0.36));
    const mobilityScore = mobility > 0
        ? Math.min(1, mobility / num(boardCfg.mobilityMax, 120))
        : num(boardCfg.fallbackMobilityScore, 0.55);
    const nearClearScore = Math.min(1, closeLines / num(boardCfg.closeLinesMax, 6));
    const boardPlanning = clamp01(
        (1 - holePenalty) * num(boardWeights.holes, 0.36)
        + (1 - fillPenalty) * num(boardWeights.fill, 0.22)
        + mobilityScore * num(boardWeights.mobility, 0.22)
        + nearClearScore * num(boardWeights.nearClear, 0.20)
    );

    const frustration = Math.max(0, Number(profile?.frustrationLevel ?? 0) || 0);
    const roundsSinceClear = Math.max(0, Number(ctx.spawnContext?.roundsSinceClear ?? 0) || 0);
    const liveRisk = clamp01(
        boardFill * num(riskWeights.boardFill, 0.32)
        + holePenalty * num(riskWeights.holes, 0.28)
        + Math.min(1, frustration / num(riskCfg.frustrationMax, 5)) * num(riskWeights.frustration, 0.18)
        + Math.min(1, roundsSinceClear / num(riskCfg.roundsSinceClearMax, 4)) * num(riskWeights.roundsSinceClear, 0.12)
        + (1 - controlScore) * num(riskWeights.control, 0.10)
    );
    const riskBlend = num(baselineCfg.riskBlend, 0.25);
    const riskLevel = baseline && baseline.confidence >= num(baselineCfg.riskMinConfidence, 0.45)
        ? clamp01(liveRisk * (1 - riskBlend) + baseline.riskLevel * riskBlend)
        : liveRisk;

    const riskTolerance = clamp01(
        boardFill * num(toleranceWeights.boardFill, 0.35)
        + (profile?.hadRecentNearMiss ? num(toleranceCfg.nearMissBonus, 0.18) : 0)
        + Math.min(1, comboRate / num(toleranceCfg.comboRateMax, 0.5)) * num(toleranceWeights.comboRate, 0.22)
        + (profile?.needsRecovery ? num(toleranceCfg.recoveryPenalty, -0.15) : 0)
        + Math.min(1, clearEfficiency) * num(toleranceWeights.clearEfficiency, 0.20)
    );

    const confidence = clamp01(
        (profile?.confidence ?? 0) * num(confidenceCfg.profileWeight, 0.65)
        + Math.min(1, (profile?.lifetimePlacements ?? 0) / num(confidenceCfg.lifetimePlacementsMax, 80)) * num(confidenceCfg.lifetimePlacementsWeight, 0.25)
        + (ctx.gameStats?.placements
            ? Math.min(1, ctx.gameStats.placements / num(confidenceCfg.gamePlacementsMax, 20)) * num(confidenceCfg.gamePlacementsWeight, 0.10)
            : 0)
    );

    const vector = {
        version: ABILITY_VECTOR_VERSION,
        skillScore: round(skillScore),
        controlScore: round(controlScore),
        clearEfficiency: round(clearEfficiency),
        boardPlanning: round(boardPlanning),
        riskTolerance: round(riskTolerance),
        riskLevel: round(riskLevel),
        confidence: round(confidence),
        skillBand: skillBand(skillScore),
        riskBand: riskBand(riskLevel),
        playstyle: profile?.playstyle ?? 'balanced',
        playstyleLabel: PLAYSTYLE_LABEL[profile?.playstyle] ?? PLAYSTYLE_LABEL.balanced,
        flowState: profile?.flowState ?? 'flow',
        explain: [],
        features: {
            boardFill: round(boardFill),
            holes,
            closeLines,
            mobility: round(mobility),
            missRate: round(missRate),
            clearRate: round(clearRate),
            comboRate: round(comboRate),
            cognitiveLoad: round(cognitiveLoad),
            engagementAPM: round(engagementAPM, 2),
            frustration,
            roundsSinceClear,
        },
        baseline,
    };
    vector.explain = explainTop(vector);
    return vector;
}

function psFeatureSummary(frames) {
    const ps = (frames || []).map((f) => f?.ps).filter(Boolean);
    const metrics = ps.map((p) => p.metrics || {});
    return {
        samples: ps.length,
        skillAvg: round(avg(ps.map((p) => p.skill))),
        skillLast: round(lastFinite(ps.map((p) => p.skill), 0.5)),
        flowDeviationAvg: round(avg(ps.map((p) => p.flowDeviation))),
        cognitiveLoadAvg: round(avg(ps.map((p) => p.cognitiveLoad))),
        boardFillAvg: round(avg(ps.map((p) => p.boardFill))),
        clearRateAvg: round(avg(metrics.map((m) => m.clearRate))),
        missRateAvg: round(avg(metrics.map((m) => m.missRate))),
        comboRateAvg: round(avg(metrics.map((m) => m.comboRate))),
        flowStateLast: ps.length ? ps[ps.length - 1].flowState || 'flow' : 'flow',
        playstyleLast: ps.length ? ps[ps.length - 1].playstyle || null : null,
    };
}

function safeJsonObject(v) {
    if (!v) return {};
    if (typeof v === 'object') return v;
    try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * 从回放会话构建离线训练样本。输入兼容 Database.listReplaySessions 返回行。
 *
 * @param {object[]} sessions
 * @returns {Array<{ userId:string|null, sessionId:number|string|null, features:object, labels:object, meta:object }>}
 */
export function buildAbilityTrainingDataset(sessions) {
    if (!Array.isArray(sessions)) return [];
    return sessions.map((row) => {
        const frames = Array.isArray(row.frames) ? row.frames : (Array.isArray(row.move_frames) ? row.move_frames : []);
        const analysis = safeJsonObject(row.analysis ?? row.move_analysis);
        const gameStats = safeJsonObject(row.game_stats ?? row.gameStats);
        const ps = psFeatureSummary(frames);
        const placements = Number(gameStats.placements ?? row.placements ?? frames.filter((f) => f?.t === 'place').length) || 0;
        const clears = Number(gameStats.clears ?? row.clears ?? 0) || 0;
        const misses = Number(gameStats.misses ?? row.misses ?? 0) || 0;
        const score = Number(row.score ?? gameStats.score ?? analysis.metrics?.score ?? 0) || 0;
        const duration = Number(row.duration ?? gameStats.duration ?? 0) || 0;
        return {
            userId: row.user_id ?? row.userId ?? null,
            sessionId: row.id ?? row.session_id ?? row.sessionId ?? null,
            features: {
                ...ps,
                placements,
                clears,
                misses,
                duration,
                clearRateSession: round(clears / Math.max(placements, 1)),
                missRateSession: round(misses / Math.max(placements + misses, 1)),
            },
            labels: {
                finalScore: score,
                survivedSteps: placements,
                totalClears: clears,
                earlyDeath: placements > 0 && placements < 12,
                highScore: score >= 1000,
                replayRating: analysis.rating ?? null,
                tags: Array.isArray(analysis.tags) ? analysis.tags : [],
            },
            meta: {
                strategy: row.strategy ?? ps.strategyId ?? null,
                startTime: row.start_time ?? row.startTime ?? null,
                status: row.status ?? null,
            },
        };
    });
}
