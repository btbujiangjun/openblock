/**
 * 玩家能力统一输出层。
 *
 * 该模块把 PlayerProfile 的实时规则信号、盘面拓扑和局级统计聚合为可展示、
 * 可用于自适应投放、也可离线训练校准的 AbilityVector。
 */
import { analyzeBoardTopology } from './boardTopology.js';
import { GAME_RULES } from './gameRules.js';
/* v1.48 (2026-05) — `getPlayerAbilityModel` facade 适配器依赖。
 * 静态 import 不引入循环依赖（personalization / ltvPredictor / MonetizationBus
 * 均不 import 本文件）；任何模块加载失败都被适配器内部的 try/catch 软化为空骨架。 */
import * as _personalizationMod from './monetization/personalization.js';
import * as _ltvPredictorMod from './monetization/ltvPredictor.js';
import * as _monBusMod from './monetization/MonetizationBus.js';

/* v2 (2026-05)：扩展能力向量
 *
 *   - controlScore 接入「反应」(pickToPlaceMs)，让 v1.46 投入的"激活→落子"耗时
 *     真正进入闭环（反应快 → 控制力 +、反应慢 → 控制力 -）
 *   - clearEfficiency 接入 multiClearRate（多消深度）与 perfectClearRate（清屏稀缺事件），
 *     与原 comboRate 解耦——comboRate 是"消行密度"，multiClear 是"消行深度"
 *   - riskLevel 加 boardFillVelocity（盘面变满速度）与 lockRisk（dock 全锁死概率），
 *     把"静态满"和"急速满 / 即将无解"区分开
 *   - confidence 加 recencyDecay（exp(-days/14)），长草玩家不再被当老用户对待
 *   - 各能力指标允许使用各自合适的时间窗口（PlayerProfile.metricsForWindow）
 *   - 主要 *_Max 阈值按"基于产品体感的初始猜测"在 game_rules.json/calibrationNote
 *     中标注待离线分位数回填
 *
 * 升 ABILITY_VECTOR_VERSION 让消费方（spawnModel / churnPredictor / 回放面板）
 * 能感知到字段集合扩展（新增 reactionScore / lockRisk / fillVelocity / recencyDecay
 * 在 features 字段里）；version 单调递增，向后兼容旧字段。
 */
export const ABILITY_VECTOR_VERSION = 2;
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
    const windowsCfg = cfg.windows ?? {};

    /* v2：每个能力指标使用各自合适的时间窗口（控制看短窗体现手感、消行看中窗等待机会积累）。
     * profile.metricsForWindow 是 v2 新增的窗口聚合 API；老 profile / 测试桩
     * 不实现该方法时回退到 profile.metrics（与 v1 行为完全一致）。 */
    const fallbackMetrics = profile?.metrics ?? {};
    const _metricsAt = (windowSize) => (
        typeof profile?.metricsForWindow === 'function'
            ? profile.metricsForWindow(windowSize)
            : fallbackMetrics
    );
    const controlMetrics = _metricsAt(num(windowsCfg.control, 8));
    const clearMetrics = _metricsAt(num(windowsCfg.clearEfficiency, 16));
    const generalMetrics = fallbackMetrics;

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

    const missRate = clamp01(controlMetrics.missRate ?? 0);
    const clearRate = clamp01(clearMetrics.clearRate ?? 0);
    const comboRate = clamp01(clearMetrics.comboRate ?? 0);
    const multiClearRate = clamp01(clearMetrics.multiClearRate ?? profile?.multiClearRate ?? 0);
    const perfectClearRate = clamp01(clearMetrics.perfectClearRate ?? profile?.perfectClearRate ?? 0);
    const afkCount = Math.max(0, Number(controlMetrics.afkCount ?? 0) || 0);
    const cognitiveLoad = clamp01(profile?.cognitiveLoad ?? 0.3);
    const engagementAPM = Math.max(0, Number(profile?.engagementAPM ?? 6) || 0);
    const avgLines = Math.max(0, Number(clearMetrics.avgLines ?? profile?.avgLinesPerClear ?? 0) || 0);

    const baseSkill = clamp01(profile?.skillLevel ?? 0.5);
    const baseline = modelBaseline(ctx);
    const skillBlendScale = num(baselineCfg.skillBlendScale, 0.35);
    const skillScore = baseline && baseline.confidence >= num(baselineCfg.skillMinConfidence, 0.35)
        ? clamp01(baseSkill * (1 - baseline.confidence * skillBlendScale) + baseline.skillScore * baseline.confidence * skillBlendScale)
        : baseSkill;

    /* v2 controlScore：在原 miss / cognitiveLoad / afk / apm 四项之外加入「反应」项。
     * 反应项语义：pickToPlaceMs ≤ fastMs 满分，≥ slowMs 0 分，中间线性插值；
     * 样本不足（reactionSamples < reactionMinSamples）→ 反应项不参与，权重按比例
     * 重分配给其他四项（normalize 同行实现），避免冷启动出现"无反应数据=控制力 0.84"
     * 这种伪精确。
     */
    const reactionFastMs = num(controlCfg.reactionFastMs, 350);
    const reactionSlowMs = num(controlCfg.reactionSlowMs, 2200);
    const reactionMinSamples = num(controlCfg.reactionMinSamples, 3);
    const pickToPlaceMs = controlMetrics.pickToPlaceMs;
    const reactionSamples = Math.max(0, Number(controlMetrics.reactionSamples ?? 0) || 0);
    const hasReactionData = pickToPlaceMs != null
        && Number.isFinite(pickToPlaceMs)
        && reactionSamples >= reactionMinSamples;
    const reactionScore = hasReactionData
        ? 1 - Math.max(0, Math.min(1, (pickToPlaceMs - reactionFastMs) / Math.max(1, reactionSlowMs - reactionFastMs)))
        : null;

    const wMiss = num(controlWeights.miss, 0.34);
    const wLoad = num(controlWeights.cognitiveLoad, 0.22);
    const wAfk = num(controlWeights.afk, 0.13);
    const wApm = num(controlWeights.apm, 0.15);
    const wReact = num(controlWeights.reaction, 0.16);
    const reactWeightActive = reactionScore != null ? wReact : 0;
    const controlWeightSum = wMiss + wLoad + wAfk + wApm + reactWeightActive;
    const controlScore = controlWeightSum > 0
        ? clamp01((
            (1 - Math.min(1, missRate / num(controlCfg.missRateMax, 0.3))) * wMiss
            + (1 - cognitiveLoad) * wLoad
            + (1 - Math.min(1, afkCount / num(controlCfg.afkMax, 3))) * wAfk
            + clamp01(engagementAPM / num(controlCfg.apmMax, 18)) * wApm
            + (reactionScore != null ? reactionScore * wReact : 0)
        ) / controlWeightSum)
        : 0;

    /* v2 clearEfficiency：把"消行密度"(clearRate)、"连消密度"(comboRate)、
     * "消行深度"(multiClearRate, lines≥2 的占比)、"清屏稀缺事件"(perfectClearRate)
     * 与"单次平均行数"(avgLines) 解耦为 5 项独立权重。
     * 旧版只用前 3 项，无法区分"光会拼单消"与"会做多消大爆发"的玩家。 */
    const clearEfficiency = clamp01(
        Math.min(1, clearRate / num(clearCfg.clearRateMax, 0.55)) * num(clearWeights.clearRate, 0.40)
        + Math.min(1, comboRate / num(clearCfg.comboRateMax, 0.45)) * num(clearWeights.comboRate, 0.18)
        + Math.min(1, avgLines / num(clearCfg.avgLinesMax, 2.5)) * num(clearWeights.avgLines, 0.14)
        + Math.min(1, multiClearRate / num(clearCfg.multiClearRateMax, 0.5)) * num(clearWeights.multiClear, 0.18)
        + Math.min(1, perfectClearRate / num(clearCfg.perfectClearRateMax, 0.15)) * num(clearWeights.perfectClear, 0.10)
    );

    const holePenalty = Math.min(1, holes / num(boardCfg.holeMax, 8));
    const fillPenalty = Math.max(0, (boardFill - num(boardCfg.fillPenaltyStart, 0.58)) / num(boardCfg.fillPenaltySpan, 0.36));
    const mobilityScore = mobility > 0
        ? Math.min(1, mobility / num(boardCfg.mobilityMax, 200))
        : num(boardCfg.fallbackMobilityScore, 0.55);
    const nearClearScore = Math.min(1, closeLines / num(boardCfg.closeLinesMax, 6));
    const boardPlanning = clamp01(
        (1 - holePenalty) * num(boardWeights.holes, 0.36)
        + (1 - fillPenalty) * num(boardWeights.fill, 0.22)
        + mobilityScore * num(boardWeights.mobility, 0.22)
        + nearClearScore * num(boardWeights.nearClear, 0.20)
    );

    /* v2 riskLevel：在原 fill / holes / frustration / roundsSinceClear / (1-control) 五项之外
     * 加入两个动态信号：
     *   - boardFillVelocity：最近 N 步 fill 增量均值，把"急速变满"和"稳定停在满"区分开
     *   - lockRisk：dock 全锁死概率（由 ctx.placementSolutionScore 注入），
     *     越接近 0 表示 dock 在当前盘面找不到任何合法落位 → 死局风险高
     */
    const frustration = Math.max(0, Number(profile?.frustrationLevel ?? 0) || 0);
    const roundsSinceClear = Math.max(0, Number(ctx.spawnContext?.roundsSinceClear ?? 0) || 0);
    const fillVelocityRaw = typeof profile?.boardFillVelocity === 'function'
        ? Number(profile.boardFillVelocity()) || 0
        : 0;
    const fillVelocityScore = Math.max(0, Math.min(1, fillVelocityRaw / num(riskCfg.boardFillVelocityMax, 0.18)));
    /* lockRisk：dock 当前在盘面上能否落子的安全垫。
     * 优先级：直接传入的 placementSolutionScore（[0,1]）→ ctx.firstMoveFreedom
     * 归一化（safe=8 个合法点 → 安全度 1，0 个合法点 → 死局风险 1）。
     * 两者都没传 → lockRisk 不参与（=0），避免在缺数据时给出"风险偏高"的伪信号。 */
    const placementScoreRaw = ctx.placementSolutionScore;
    let lockRiskScore = 0;
    if (Number.isFinite(placementScoreRaw)) {
        lockRiskScore = Math.max(0, Math.min(1, 1 - clamp01(placementScoreRaw)));
    } else if (Number.isFinite(ctx.firstMoveFreedom)) {
        const safe = num(riskCfg.firstMoveFreedomSafe, 8);
        const safety = Math.max(0, Math.min(1, ctx.firstMoveFreedom / Math.max(1, safe)));
        lockRiskScore = 1 - safety;
    }
    const liveRisk = clamp01(
        boardFill * num(riskWeights.boardFill, 0.26)
        + holePenalty * num(riskWeights.holes, 0.22)
        + Math.min(1, frustration / num(riskCfg.frustrationMax, 5)) * num(riskWeights.frustration, 0.14)
        + Math.min(1, roundsSinceClear / num(riskCfg.roundsSinceClearMax, 4)) * num(riskWeights.roundsSinceClear, 0.10)
        + (1 - controlScore) * num(riskWeights.control, 0.10)
        + fillVelocityScore * num(riskWeights.boardFillVelocity, 0.10)
        + lockRiskScore * num(riskWeights.lockRisk, 0.08)
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

    /* v2 confidence：加 recencyDecay 项（exp(-days/halfLife)）。
     * 老玩家长草后 lifetimePlacements 仍很大但近 N 天没玩，模型对其当前状态把握应衰减。
     * 当前没历史会话时间戳时 recencyDecay 默认 1.0（不惩罚冷启动）。 */
    const halfLifeDays = Math.max(1, num(confidenceCfg.recencyHalfLifeDays, 14));
    const lastActiveTs = Number(profile?.lastActiveTs ?? 0) || 0;
    let recencyDecay = 1;
    if (lastActiveTs > 0) {
        const days = Math.max(0, (Date.now() - lastActiveTs) / 86_400_000);
        recencyDecay = Math.exp(-days / halfLifeDays);
    }
    const confidence = clamp01(
        ((profile?.confidence ?? 0) * num(confidenceCfg.profileWeight, 0.55)
            + Math.min(1, (profile?.lifetimePlacements ?? 0) / num(confidenceCfg.lifetimePlacementsMax, 200)) * num(confidenceCfg.lifetimePlacementsWeight, 0.25)
            + (ctx.gameStats?.placements
                ? Math.min(1, ctx.gameStats.placements / num(confidenceCfg.gamePlacementsMax, 20)) * num(confidenceCfg.gamePlacementsWeight, 0.10)
                : 0)
            + recencyDecay * num(confidenceCfg.recencyWeight, 0.10))
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
            multiClearRate: round(multiClearRate),
            perfectClearRate: round(perfectClearRate),
            avgLines: round(avgLines, 2),
            cognitiveLoad: round(cognitiveLoad),
            engagementAPM: round(engagementAPM, 2),
            frustration,
            roundsSinceClear,
            // v2 新增动态信号 / 子分项（供 UI tooltip / 训练样本特征列）
            reactionScore: reactionScore != null ? round(reactionScore) : null,
            reactionSamples,
            pickToPlaceMs: pickToPlaceMs != null && Number.isFinite(pickToPlaceMs) ? round(pickToPlaceMs) : null,
            boardFillVelocity: round(fillVelocityRaw, 4),
            lockRisk: round(lockRiskScore),
            recencyDecay: round(recencyDecay),
        },
        windows: {
            control: controlMetrics.windowSize ?? null,
            clearEfficiency: clearMetrics.windowSize ?? null,
            general: generalMetrics.windowSize ?? null,
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

/* ============================================================================
 * v1.48 (2026-05) — getPlayerAbilityModel 兼容适配器
 *
 * 此前 4 个商业化模块（adDecisionEngine / pushNotificationManager /
 * paymentPredictionModel / analyticsDashboard）import `getPlayerAbilityModel`
 * 期望返回一个 `{ getPersona, getRealtimeState, getLTV }` 形态的对象，但本文件
 * 从未导出该函数 —— 4 个 import 在生产中要么直接报 ReferenceError 被外层 try
 * 吞掉，要么对应模块整体未启动，导致大量功能空转。
 *
 * 本适配器把"商业化语境下的能力模型"代理到真正实现这些字段的模块：
 *   - persona / realtime → monetization/personalization.getCommercialModelContext
 *   - ltv → monetization/ltvPredictor.getLTVEstimate（需要当前 game 实例的 profile）
 *
 * 使用 lazy import 避免与 monetization 子系统的初始化顺序冲突；任何字段缺失
 * 都返回稳定的空骨架，保证调用方不会再因 .getPersona is not a function 崩溃。
 * ============================================================================ */
const _EMPTY_PERSONA = Object.freeze({
    segment: 'unknown', whaleScore: 0, activityScore: 0, skillScore: 0,
    frustrationAvg: 0, nearMissRate: 0,
});
const _EMPTY_REALTIME = Object.freeze({
    frustration: 0, skill: 0.5, flowState: 'flow',
    hadNearMiss: false, sessionPhase: 'early', momentum: 0,
    playstyle: 'balanced', segment5: 'A', confidence: 0.5,
    skillLabel: '入门', spawnIntent: null,
});
const _EMPTY_LTV = Object.freeze({ estimate: 0, currency: 'CNY', confidence: 0 });

/**
 * 返回"商业化视角的玩家能力模型" facade：
 *
 *   {
 *     getPersona():       segment / whaleScore / activityScore / ... 长期画像
 *     getRealtimeState(): frustration / flowState / ...               实时状态
 *     getLTV():           estimate                                     生命价值预测
 *   }
 *
 * 实现委托给 personalization + ltvPredictor + MonetizationBus.getGame。
 *
 * @returns {{ getPersona:Function, getRealtimeState:Function, getLTV:Function }}
 */
export function getPlayerAbilityModel() {
    return {
        getPersona() {
            try {
                const ctx = _personalizationMod?.getCommercialModelContext?.();
                return ctx?.persona ? { ..._EMPTY_PERSONA, ...ctx.persona } : { ..._EMPTY_PERSONA };
            } catch { return { ..._EMPTY_PERSONA }; }
        },
        getRealtimeState() {
            try {
                const ctx = _personalizationMod?.getCommercialModelContext?.();
                return ctx?.realtime ? { ..._EMPTY_REALTIME, ...ctx.realtime } : { ..._EMPTY_REALTIME };
            } catch { return { ..._EMPTY_REALTIME }; }
        },
        getLTV() {
            try {
                const game = _monBusMod?.getGame?.();
                const profile = game?.playerProfile ?? null;
                const est = _ltvPredictorMod?.getLTVEstimate?.(profile);
                return est ? { ..._EMPTY_LTV, ...est } : { ..._EMPTY_LTV };
            } catch { return { ..._EMPTY_LTV }; }
        },
    };
}

/* 兼容期望"persona = ability.getPersona()"风格的同名 named export 直接调用。 */
export function getPersona() { return getPlayerAbilityModel().getPersona(); }
export function getRealtimeState() { return getPlayerAbilityModel().getRealtimeState(); }
export function getLTV() { return getPlayerAbilityModel().getLTV(); }
