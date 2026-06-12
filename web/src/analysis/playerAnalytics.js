/**
 * 玩家能力·偏好分析器（离线 / 聚合）
 * ============================================================================
 *
 * 与实时链路的分工（务必区分，避免与 `playerAbilityModel.js` 混淆）：
 *
 *   | 模块                     | 数据 / 时间窗口            | 输出                              | 用途                   |
 *   |--------------------------|---------------------------|-----------------------------------|------------------------|
 *   | playerProfile.js         | 单局滑窗（步级）           | 即时 metrics / flowState          | 喂 adaptiveSpawn       |
 *   | playerAbilityModel.js    | 单帧 + 短中窗 EMA         | AbilityVector（每帧即时值）       | 局内难度自适应         |
 *   | **playerAnalytics.js**   | **跨局 move_sequences 时序** | **能力 5 维 + 软概率偏好 + 置信度** | **复盘 / 分群 / 冷启动先验** |
 *
 * 本模块是**纯函数 + 无副作用 + 无 DOM 依赖**：消费 `frames[].ps` 富快照（见
 * moveSequence.buildPlayerStateSnapshot）与会话摘要，输出带显式数学公式与置信度的
 * 玩家画像。所有权重 / 分位锚点集中在 `shared/game_rules.json -> playerAnalysis`。
 *
 * 数学模型概览
 * ------------
 *  归一化：分位锚定分段线性 anchor(x; p10,p50,p90) → [0,1]（0.5 落在 p50）。
 *
 *  能力（5 维 + 综合）：
 *    T 拓扑规划   = 空洞负担 + 空洞增长 + 平整度 + 碎片化 + 近满转化
 *    S 计分掌控   = 分数杠杆(score/(placements·baseUnit)) + combo + 多消 + bonus
 *    E 执行质量   = 逐步拓扑增量质量 q_t + (1-missRate)        ← 「用户方块质量」
 *    R 反应节奏   = 反应速度(anchorInv pickToPlaceMs) + 果断度(1-CV) + APM
 *    V 生存韧性   = 存活步数 + 高 fill 恢复率 + (1-lockRisk)
 *    SkillScore   = Σ w_i · dim_i
 *
 *  偏好（软概率，非单一硬标签）：
 *    风格分布     = softmax(β·z)  z∈{perfect_hunter, multi_clear, combo, survival, balanced}
 *    风险偏好 ρ   = 落子前 fill + 近失 + 多消 + fillVelocity 容忍
 *    节奏偏好 τ   = anchorInv(thinkMs) + {snappy / measured / deliberate}
 *    方块/颜色亲和 = 类别频次 + 成功(得分增量)加权
 *    动机         = 由偏好 + 能力映射 {competence / challenge / relaxation / collection / social}
 *
 *  置信度：conf = 1 - exp(-n / n0)（逐维 + 整体）。
 */

import { GAME_RULES } from '../gameRules.js';
import { clamp01, clamp } from '../lib/math.js';

export const PLAYER_ANALYTICS_VERSION = 2;

const CFG = GAME_RULES.playerAnalysis ?? {};

/* ============================================================================
 * 数学工具
 * ========================================================================== */

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function round(v, digits = 3) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const k = 10 ** digits;
    return Math.round(n * k) / k;
}

function mean(xs) {
    const ns = xs.map(Number).filter(Number.isFinite);
    return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : 0;
}

function std(xs) {
    const ns = xs.map(Number).filter(Number.isFinite);
    if (ns.length < 2) return 0;
    const m = ns.reduce((s, x) => s + x, 0) / ns.length;
    const v = ns.reduce((s, x) => s + (x - m) ** 2, 0) / ns.length;
    return Math.sqrt(v);
}

/**
 * 序列对索引的普通最小二乘斜率（每步变化量）。空 / 单点返回 0。
 * @param {number[]} ys 按步序排列的观测值
 * @returns {number}
 */
function slopePerStep(ys) {
    const pts = ys.map(Number).filter(Number.isFinite);
    const n = pts.length;
    if (n < 2) return 0;
    let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    for (let i = 0; i < n; i++) {
        sx += i; sy += pts[i]; sxx += i * i; sxy += i * pts[i];
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return 0;
    return (n * sxy - sx * sy) / denom;
}

/**
 * 分位锚定分段线性归一化到 [0,1]。
 * anchor(p10)=0.1, anchor(p50)=0.5, anchor(p90)=0.9，两段线性外推并 clamp。
 *
 * @param {number} x
 * @param {[number,number,number]} anchors [p10,p50,p90]
 * @param {boolean} [invert=false] 越小越好的指标传 true（返回 1-anchor）
 * @returns {number}
 */
export function anchorNorm(x, anchors, invert = false) {
    const v = Number(x);
    if (!Number.isFinite(v) || !Array.isArray(anchors) || anchors.length < 3) return 0.5;
    const [p10, p50, p90] = anchors.map(Number);
    let out;
    if (v <= p50) {
        const span = p50 - p10;
        out = Math.abs(span) < 1e-9 ? 0.5 : 0.1 + 0.4 * ((v - p10) / span);
    } else {
        const span = p90 - p50;
        out = Math.abs(span) < 1e-9 ? 0.5 : 0.5 + 0.4 * ((v - p50) / span);
    }
    out = clamp01(out);
    return invert ? 1 - out : out;
}

/** 数值稳定 softmax。 */
export function softmax(values, beta = 1) {
    const xs = values.map((v) => Number(v) * beta).map((v) => (Number.isFinite(v) ? v : 0));
    const mx = Math.max(...xs);
    const exps = xs.map((v) => Math.exp(v - mx));
    const sum = exps.reduce((s, e) => s + e, 0) || 1;
    return exps.map((e) => e / sum);
}

/** 香农熵归一化到 [0,1]（除以 log(k)）。 */
function normalizedEntropy(probs) {
    const k = probs.length;
    if (k <= 1) return 0;
    let h = 0;
    for (const p of probs) {
        if (p > 1e-12) h -= p * Math.log(p);
    }
    return clamp01(h / Math.log(k));
}

/** 样本量驱动的置信度：1 - exp(-n / n0)。 */
function sampleConfidence(n, n0) {
    const k = Math.max(1, num(n0, 40));
    return clamp01(1 - Math.exp(-Math.max(0, num(n)) / k));
}

/* ============================================================================
 * 形状分类（用于方块亲和；自包含，避免耦合 shapes.js 运行时池）
 * ========================================================================== */

/**
 * 由形状矩阵推断粗类别。纯几何，不依赖皮肤 / 形状库实现。
 * @param {number[][]} shape 0/1 矩阵
 * @returns {string} 类别 key
 */
export function classifyShape(shape) {
    if (!Array.isArray(shape) || shape.length === 0) return 'unknown';
    const h = shape.length;
    const w = Math.max(...shape.map((r) => (Array.isArray(r) ? r.length : 0)));
    let cells = 0;
    for (const row of shape) {
        if (!Array.isArray(row)) continue;
        for (const c of row) if (c) cells++;
    }
    if (cells === 0) return 'unknown';
    if (cells === 1) return 'dot';
    const isFullRect = cells === w * h;
    if (isFullRect) {
        if (w === 1 || h === 1) return 'line';
        if (w === h) return 'square';
        return 'rect';
    }
    // 非满矩形：按外接框与缺格数粗分 L/T/Z/其它
    const longSide = Math.max(w, h);
    if (cells === 3 && longSide === 2) return 'corner';
    if (longSide >= 3 && cells <= longSide + 1) return 'lshape';
    if (cells >= 4 && Math.abs(w - h) <= 1) return 'tzshape';
    return 'poly';
}

/* ============================================================================
 * 阶段 1：观测抽取
 * ========================================================================== */

function asArray(v) {
    return Array.isArray(v) ? v : [];
}

function safeObj(v) {
    if (!v) return {};
    if (typeof v === 'object') return v;
    try {
        const p = JSON.parse(v);
        return p && typeof p === 'object' ? p : {};
    } catch {
        return {};
    }
}

/**
 * @typedef {object} MoveObservation
 * @property {string|number|null} sessionId
 * @property {number} idx 局内步序（0 起）
 * @property {number|null} score 累计分
 * @property {number|null} scoreDelta 相对上一步增量
 * @property {boolean} cleared 本步是否消行（由分数增量 / fill 下降推断）
 * @property {number|null} boardFill
 * @property {number|null} prevBoardFill
 * @property {number} holes
 * @property {number} flatness
 * @property {number} regions contiguousRegions
 * @property {number} concave concaveCorners
 * @property {number} nearFull nearFullLines
 * @property {number} lockRisk
 * @property {number|null} pickToPlaceMs
 * @property {number|null} thinkMs
 * @property {number|null} missRate
 * @property {number|null} multiClearRate
 * @property {number|null} comboRate
 * @property {string|null} shapeCategory
 * @property {number|null} colorIdx
 */

/**
 * 把会话行（含 frames[].ps）展平为按步序的落子观测序列。
 *
 * 输入兼容 `Database.listReplaySessions` / `buildAbilityTrainingDataset` 入参：
 * 每行需有 `frames`（或 `move_frames`）。spawn 帧用于把 place.i 映射到形状 / 颜色。
 *
 * @param {object[]} sessions
 * @returns {MoveObservation[]}
 */
export function extractMoveObservations(sessions) {
    if (!Array.isArray(sessions)) return [];
    /** @type {MoveObservation[]} */
    const out = [];

    for (const row of sessions) {
        const frames = asArray(row?.frames).length ? asArray(row.frames) : asArray(row?.move_frames);
        if (!frames.length) continue;
        const sessionId = row?.id ?? row?.session_id ?? row?.sessionId ?? null;

        let lastDock = null;
        let prevPs = null;
        let idx = 0;

        for (const frame of frames) {
            if (!frame || typeof frame !== 'object') continue;
            if (frame.t === 'spawn') {
                lastDock = asArray(frame.dock);
                continue;
            }
            if (frame.t !== 'place') continue;
            const ps = frame.ps && typeof frame.ps === 'object' ? frame.ps : null;
            if (!ps) { idx++; continue; }

            const geo = safeObj(ps.spawnGeo);
            const metrics = safeObj(ps.metrics);
            const abilityFeat = safeObj(safeObj(ps.ability).features);

            const score = Number.isFinite(Number(ps.score)) ? Number(ps.score) : null;
            const prevScore = prevPs && Number.isFinite(Number(prevPs.score)) ? Number(prevPs.score) : null;
            const scoreDelta = score != null && prevScore != null ? score - prevScore : null;

            const boardFill = Number.isFinite(Number(ps.boardFill)) ? Number(ps.boardFill) : null;
            const prevBoardFill = prevPs && Number.isFinite(Number(prevPs.boardFill)) ? Number(prevPs.boardFill) : null;
            const fillDropped = boardFill != null && prevBoardFill != null && boardFill < prevBoardFill - 1e-6;
            const cleared = (scoreDelta != null && scoreDelta > 0) || fillDropped;

            // place.i → 形状 / 颜色（来自最近一个 spawn 帧的 dock 槽位）
            let shapeCategory = null;
            let colorIdx = null;
            const slot = Number(frame.i);
            if (lastDock && Number.isInteger(slot) && lastDock[slot]) {
                const d = lastDock[slot];
                if (Array.isArray(d.shape)) shapeCategory = classifyShape(d.shape);
                if (Number.isFinite(Number(d.colorIdx))) colorIdx = Number(d.colorIdx);
            }

            out.push({
                sessionId,
                idx,
                score,
                scoreDelta,
                cleared,
                boardFill,
                prevBoardFill,
                holes: num(geo.holes, 0),
                flatness: num(geo.flatness, 0),
                regions: num(geo.contiguousRegions, 0),
                concave: num(geo.concaveCorners, 0),
                nearFull: num(geo.nearFullLines, 0),
                lockRisk: num(abilityFeat.lockRisk, 0),
                pickToPlaceMs: Number.isFinite(Number(metrics.pickToPlaceMs)) ? Number(metrics.pickToPlaceMs) : null,
                thinkMs: Number.isFinite(Number(metrics.thinkMs)) ? Number(metrics.thinkMs) : null,
                missRate: Number.isFinite(Number(metrics.missRate)) ? Number(metrics.missRate) : null,
                multiClearRate: Number.isFinite(Number(ps.multiClearRate ?? metrics.multiClearRate))
                    ? Number(ps.multiClearRate ?? metrics.multiClearRate) : null,
                comboRate: Number.isFinite(Number(metrics.comboRate)) ? Number(metrics.comboRate) : null,
                shapeCategory,
                colorIdx,
            });
            prevPs = ps;
            idx++;
        }
    }
    return out;
}

/** 会话级摘要（不依赖 frames 也可用，作为 ps 缺失时的兜底）。 */
function sessionAggregates(sessions) {
    const rows = asArray(sessions);
    const placementsArr = [];
    const scores = [];
    const maxCombos = [];
    let totalPlacements = 0;
    let totalClears = 0;
    let totalMisses = 0;
    let totalScore = 0;
    const strategyMix = {};

    for (const row of rows) {
        const gs = safeObj(row?.game_stats ?? row?.gameStats);
        const placements = num(gs.placements ?? row?.placements, 0);
        const clears = num(gs.clears ?? row?.clears, 0);
        const misses = num(gs.misses ?? row?.misses, 0);
        const score = num(row?.score ?? gs.score, 0);
        const maxCombo = num(gs.maxCombo, 0);
        const strategy = row?.strategy ?? 'normal';

        if (placements > 0) placementsArr.push(placements);
        scores.push(score);
        if (maxCombo > 0) maxCombos.push(maxCombo);
        totalPlacements += placements;
        totalClears += clears;
        totalMisses += misses;
        totalScore += score;
        strategyMix[strategy] = (strategyMix[strategy] || 0) + 1;
    }

    return {
        sessions: rows.length,
        placementsArr,
        scores,
        maxCombos,
        totalPlacements,
        totalClears,
        totalMisses,
        totalScore,
        strategyMix,
        medianPlacements: median(placementsArr),
    };
}

function median(xs) {
    const ns = xs.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ns.length) return 0;
    const mid = Math.floor(ns.length / 2);
    return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
}

/* ============================================================================
 * 阶段 2：能力模型
 * ========================================================================== */

function abilityCfg() {
    return CFG.ability ?? {};
}

function computeTopologyDim(obs) {
    const cfg = abilityCfg().topology ?? {};
    const w = cfg.weights ?? {};
    const anchors = cfg.anchors ?? {};

    const avgHoles = mean(obs.map((o) => o.holes));
    // 局内空洞增长斜率：按 session 分组求斜率再平均（跨局不连续，不能直接全序列回归）
    const bySession = groupBy(obs, (o) => o.sessionId);
    const slopes = Object.values(bySession).map((g) => slopePerStep(g.map((o) => o.holes)));
    const holeGrowth = mean(slopes);
    const flatnessAvg = mean(obs.map((o) => o.flatness));
    const avgConcave = mean(obs.map((o) => o.concave));
    const avgRegions = mean(obs.map((o) => o.regions));

    // 空洞修复率：在已有空洞(prev.holes>0)的状态下，下一步真正减少空洞的比例（形态恢复力）
    let repairOpp = 0; let repaired = 0;
    for (const g of Object.values(bySession)) {
        for (let i = 1; i < g.length; i++) {
            if (g[i - 1].holes > 0) {
                repairOpp++;
                if (g[i].holes < g[i - 1].holes) repaired++;
            }
        }
    }
    const holeRepairRate = repairOpp > 0 ? repaired / repairOpp : 0.5;

    // 近满转化率：存在近满机会(prev.nearFull>0)的步中，下一步消行的比例
    let opp = 0; let conv = 0;
    for (const o of obs) {
        if (o.nearFull > 0) {
            opp++;
            if (o.cleared) conv++;
        }
    }
    const nearClearConversion = opp > 0 ? conv / opp : 0.5;

    const holeBurden = anchorNorm(avgHoles, anchors.avgHoles ?? [0.2, 1.5, 5.0], true);
    const holeGrowthScore = anchorNorm(holeGrowth, anchors.holeGrowthPerStep ?? [-0.05, 0.04, 0.18], true);
    const flatnessScore = clamp01(flatnessAvg);
    const concaveControl = anchorNorm(avgConcave, anchors.avgConcave ?? [1.0, 4.0, 10.0], true);
    const regionCohesion = anchorNorm(avgRegions, anchors.avgRegions ?? [1.0, 3.0, 7.0], true);
    const holeRepair = clamp01(holeRepairRate);

    const parts = {
        holeBurden: round(holeBurden),
        holeGrowth: round(holeGrowthScore),
        flatness: round(flatnessScore),
        concaveControl: round(concaveControl),
        regionCohesion: round(regionCohesion),
        holeRepair: round(holeRepair),
        nearClearConversion: round(nearClearConversion),
    };

    const value = clamp01(
        holeBurden * num(w.holeBurden, 0.22)
        + holeGrowthScore * num(w.holeGrowth, 0.14)
        + flatnessScore * num(w.flatness, 0.16)
        + concaveControl * num(w.concaveControl, 0.14)
        + regionCohesion * num(w.regionCohesion, 0.12)
        + holeRepair * num(w.holeRepair, 0.10)
        + clamp01(nearClearConversion) * num(w.nearClearConversion, 0.12)
    );

    // 最薄弱的形态短板（供解读 / 出块算法定向施压或救济）
    const formWeakness = Object.entries(parts).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;

    return {
        value: round(value),
        parts,
        raw: {
            avgHoles: round(avgHoles, 2),
            holeGrowthPerStep: round(holeGrowth, 4),
            avgConcave: round(avgConcave, 2),
            avgRegions: round(avgRegions, 2),
            holeRepairRate: round(holeRepairRate, 3),
            formWeakness,
        },
    };
}

function computeScoringDim(obs, agg) {
    const cfg = abilityCfg().scoring ?? {};
    const w = cfg.weights ?? {};
    const anchors = cfg.anchors ?? {};

    const baseUnit = scoringBaseUnit(agg);
    const placements = agg.totalPlacements || obs.length || 1;
    const leverageRaw = agg.totalScore / Math.max(1, placements * baseUnit);
    const leverage = anchorNorm(leverageRaw, anchors.scoreLeverage ?? [1.0, 2.2, 5.0]);

    const maxComboAvg = mean(agg.maxCombos);
    const comboScore = anchorNorm(maxComboAvg, anchors.maxCombo ?? [1.0, 3.0, 7.0]);

    const multiClear = mean(obs.map((o) => o.multiClearRate).filter((v) => v != null));
    const multiScore = clamp01(multiClear / num(cfg.multiClearRateMax, 0.5));

    // bonus：清屏稀缺事件（perfectClear），由 fill 落 0 步占消行步比例近似
    const clearedObs = obs.filter((o) => o.cleared);
    const pcRate = clearedObs.length
        ? clearedObs.filter((o) => o.boardFill === 0).length / clearedObs.length
        : 0;
    const bonusScore = clamp01(pcRate / num(cfg.bonus?.perfectClearRateMax, 0.15));

    const value = clamp01(
        leverage * num(w.leverage, 0.38)
        + comboScore * num(w.combo, 0.22)
        + multiScore * num(w.multiLine, 0.24)
        + bonusScore * num(w.bonus, 0.16)
    );

    return {
        value: round(value),
        parts: {
            leverage: round(leverage),
            combo: round(comboScore),
            multiLine: round(multiScore),
            bonus: round(bonusScore),
        },
        raw: { scoreLeverage: round(leverageRaw, 2), baseUnit, maxComboAvg: round(maxComboAvg, 2), perfectClearRate: round(pcRate, 3) },
    };
}

/** 取主导策略的 singleLine 作为计分基准单位（对照 base·c² 计分规则）。 */
function scoringBaseUnit(agg) {
    const strategies = GAME_RULES.strategies ?? {};
    const mix = agg.strategyMix ?? {};
    const dominant = Object.keys(mix).sort((a, b) => (mix[b] || 0) - (mix[a] || 0))[0] ?? 'normal';
    const s = strategies[dominant] ?? strategies.normal ?? {};
    return num(s.scoring?.singleLine, 20);
}

/**
 * 逐步「方块质量」序列 q_t（用拓扑增量反推，需要局内前一步）。
 * q_t = neutral + clearReward·1[cleared] - 空洞增penalty - 碎片增penalty + 修复bonus·1[Δholes<0]
 * @param {MoveObservation[]} group 单局按步序的观测
 * @param {object} mq moveQuality 配置
 * @returns {number[]} 每步 q（从第 1 步起，长度 = group.length-1）
 */
function moveQualitySeries(group, mq) {
    const qs = [];
    for (let i = 1; i < group.length; i++) {
        const cur = group[i];
        const prev = group[i - 1];
        const dHoles = cur.holes - prev.holes;
        const dRegions = cur.regions - prev.regions;
        let q = num(mq.neutral, 0.4);
        if (cur.cleared) q += num(mq.clearReward, 0.4);
        q -= clamp01(Math.max(0, dHoles) / num(mq.holeDeltaMax, 3)) * num(mq.holeDeltaPenalty, 0.3);
        q -= clamp01(Math.max(0, dRegions) / num(mq.regionDeltaMax, 3)) * num(mq.regionDeltaPenalty, 0.2);
        if (dHoles < 0) q += num(mq.repairBonus, 0.1);
        qs.push(clamp01(q));
    }
    return qs;
}

function computeExecutionDim(obs) {
    const cfg = abilityCfg().execution ?? {};
    const w = cfg.weights ?? {};
    const mq = cfg.moveQuality ?? {};

    const bySession = groupBy(obs, (o) => o.sessionId);
    const qs = [];
    for (const g of Object.values(bySession)) qs.push(...moveQualitySeries(g, mq));
    const moveQuality = qs.length ? mean(qs) : 0.5;

    const missRate = mean(obs.map((o) => o.missRate).filter((v) => v != null));
    const missScore = 1 - clamp01(missRate / num(cfg.missRateMax, 0.3));

    const value = clamp01(
        moveQuality * num(w.moveQuality, 0.62)
        + missScore * num(w.miss, 0.38)
    );

    return {
        value: round(value),
        parts: { moveQuality: round(moveQuality), miss: round(missScore) },
        raw: { moveQualitySamples: qs.length, missRate: round(missRate, 3) },
    };
}

function computeReactionDim(obs) {
    const cfg = abilityCfg().reaction ?? {};
    const w = cfg.weights ?? {};
    const anchors = cfg.anchors ?? {};

    const rs = obs.map((o) => o.pickToPlaceMs).filter((v) => v != null && v > 0);
    const rMean = rs.length ? mean(rs) : null;
    const rStd = rs.length >= 2 ? std(rs) : 0;
    const cv = rMean && rMean > 0 ? rStd / rMean : 0;

    const speed = rMean != null
        ? anchorNorm(rMean, anchors.pickToPlaceMs ?? [400, 1400, 4200], true)
        : 0.5;
    const decisiveness = clamp01(1 - clamp(cv, 0, num(cfg.cvCap, 1.2)) / num(cfg.cvCap, 1.2));

    // APM 代理：由 think 时间中位数推 60000/medianThink，再按 apmMax 归一
    const thinks = obs.map((o) => o.thinkMs).filter((v) => v != null && v > 0);
    const medThink = median(thinks);
    const apm = medThink > 0 ? 60000 / medThink : 6;
    const apmScore = clamp01(apm / num(cfg.apmMax, 18));

    const hasReaction = rMean != null;
    // 反应数据缺失时把 speed 权重重分配给 decisiveness/apm（避免伪精确）
    const wSpeed = hasReaction ? num(w.speed, 0.45) : 0;
    const wDec = num(w.decisiveness, 0.35);
    const wApm = num(w.apm, 0.20);
    const wSum = wSpeed + wDec + wApm;
    const value = wSum > 0
        ? clamp01((speed * wSpeed + decisiveness * wDec + apmScore * wApm) / wSum)
        : 0.5;

    return {
        value: round(value),
        parts: { speed: hasReaction ? round(speed) : null, decisiveness: round(decisiveness), apm: round(apmScore) },
        raw: { meanReactionMs: rMean != null ? round(rMean) : null, reactionCV: round(cv, 3), medianThinkMs: round(medThink), reactionSamples: rs.length },
    };
}

function computeSurvivalDim(obs, agg) {
    const cfg = abilityCfg().survival ?? {};
    const w = cfg.weights ?? {};
    const anchors = cfg.anchors ?? {};

    const survived = anchorNorm(agg.medianPlacements || obs.length, anchors.placements ?? [10, 30, 80]);

    // 高 fill 恢复率：高 fill 步后 recoveryHorizon 步内 fill 下降的比例
    const highFill = num(cfg.highFillThreshold, 0.8);
    const horizon = Math.max(1, num(cfg.recoveryHorizon, 2));
    const bySession = groupBy(obs, (o) => o.sessionId);
    let danger = 0; let recovered = 0;
    for (const g of Object.values(bySession)) {
        for (let i = 0; i < g.length; i++) {
            if (g[i].boardFill == null || g[i].boardFill < highFill) continue;
            danger++;
            for (let j = i + 1; j <= Math.min(g.length - 1, i + horizon); j++) {
                if (g[j].boardFill != null && g[j].boardFill < g[i].boardFill - 1e-6) { recovered++; break; }
            }
        }
    }
    const recoveryRate = danger > 0 ? recovered / danger : 0.5;
    const lockAvoidance = 1 - clamp01(mean(obs.map((o) => o.lockRisk)));

    const value = clamp01(
        survived * num(w.survivedSteps, 0.42)
        + recoveryRate * num(w.recovery, 0.30)
        + lockAvoidance * num(w.lockAvoidance, 0.28)
    );

    return {
        value: round(value),
        parts: { survivedSteps: round(survived), recovery: round(recoveryRate), lockAvoidance: round(lockAvoidance) },
        raw: { medianPlacements: agg.medianPlacements, dangerStates: danger },
    };
}

/**
 * 稳定性维度：局间分数离散度低 + 步级方块质量方差小 → 表现稳定可预测。
 * 计入 skillScore（越高越好）。
 */
function computeConsistencyDim(obs, sessionSummaries) {
    const cfg = abilityCfg().consistency ?? {};
    const w = cfg.weights ?? {};
    const mqCfg = (abilityCfg().execution ?? {}).moveQuality ?? {};

    // 局间分数离散度（每步得分的变异系数 CV）
    const perStepScores = sessionSummaries.map((s) => s.scorePerPlacement).filter((v) => Number.isFinite(v) && v >= 0);
    let scoreCvScore = 0.5;
    if (perStepScores.length >= num(cfg.minSessions, 2)) {
        const m = mean(perStepScores);
        const cv = m > 0 ? std(perStepScores) / m : 0;
        scoreCvScore = 1 - clamp01(cv / num(cfg.scoreCvMax, 0.8));
    }

    // 步级方块质量方差（全局）
    const bySession = groupBy(obs, (o) => o.sessionId);
    const allQ = [];
    for (const g of Object.values(bySession)) allQ.push(...moveQualitySeries(g, mqCfg));
    const qStd = allQ.length >= 2 ? std(allQ) : 0;
    const qStdScore = 1 - clamp01(qStd / num(cfg.moveQualityStdMax, 0.32));

    const value = clamp01(scoreCvScore * num(w.scoreCv, 0.5) + qStdScore * num(w.moveQualityStd, 0.5));
    return {
        value: round(value),
        parts: { scoreCv: round(scoreCvScore), moveQualityStd: round(qStdScore) },
        raw: { sessionCount: perStepScores.length, moveQualityStd: round(qStd, 3) },
    };
}

function abilityBand(v) {
    const b = abilityCfg().bands ?? {};
    if (v >= num(b.expert, 0.78)) return 'expert';
    if (v >= num(b.advanced, 0.58)) return 'advanced';
    if (v >= num(b.developing, 0.36)) return 'developing';
    return 'beginner';
}

/* ============================================================================
 * 阶段 2.5：会话级摘要（trend / endurance / consistency / clutch 复用）
 * ========================================================================== */

/**
 * 把观测按 session 聚合为局级摘要，并按开局时间排序（trend 需要时间序）。
 * @param {MoveObservation[]} obs
 * @param {object[]} sessions 原始会话行（取 score / placements / start_time）
 * @returns {Array<{ sessionId:*, startTime:number, placements:number, scorePerPlacement:number, clearRate:number, firstHalfQ:number|null, secondHalfQ:number|null, highFillQ:number|null }>}
 */
function buildSessionSummaries(obs, sessions) {
    const mqCfg = (abilityCfg().execution ?? {}).moveQuality ?? {};
    const traitsCfg = CFG.traits ?? {};
    const minHalf = num((traitsCfg.endurance ?? {}).minMovesPerHalf, 4);
    const highFill = num((traitsCfg.clutch ?? {}).highFill, 0.7);

    const startById = {};
    for (const row of asArray(sessions)) {
        const id = String(row?.id ?? row?.session_id ?? row?.sessionId ?? '');
        startById[id] = num(row?.start_time ?? row?.startTime, 0);
    }

    const bySession = groupBy(obs, (o) => o.sessionId);
    const out = [];
    for (const [sid, g] of Object.entries(bySession)) {
        const placements = g.length;
        const lastScore = lastFinite(g.map((o) => o.score), 0);
        const scorePerPlacement = placements > 0 ? lastScore / placements : 0;
        const clears = g.filter((o) => o.cleared).length;
        const qs = moveQualitySeries(g, mqCfg);

        let firstHalfQ = null;
        let secondHalfQ = null;
        if (qs.length >= minHalf * 2) {
            const mid = Math.floor(qs.length / 2);
            firstHalfQ = mean(qs.slice(0, mid));
            secondHalfQ = mean(qs.slice(mid));
        }
        const highQ = g.filter((o) => o.prevBoardFill != null && o.prevBoardFill >= highFill);
        const highIdx = new Set(highQ.map((o) => o.idx));
        const highFillQList = [];
        for (let i = 1; i < g.length; i++) {
            if (highIdx.has(g[i].idx)) highFillQList.push(qs[i - 1]);
        }
        const highFillQ = highFillQList.length ? mean(highFillQList) : null;

        out.push({
            sessionId: sid,
            startTime: startById[sid] ?? 0,
            placements,
            scorePerPlacement,
            clearRate: placements > 0 ? clears / placements : 0,
            firstHalfQ,
            secondHalfQ,
            highFillQ,
        });
    }
    out.sort((a, b) => a.startTime - b.startTime);
    return out;
}

function lastFinite(xs, fallback = 0) {
    for (let i = xs.length - 1; i >= 0; i--) {
        const n = Number(xs[i]);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

/* ============================================================================
 * 阶段 2.6：时序特质（descriptive traits，不计入 skillScore）
 * ========================================================================== */

function computeTraits(obs, sessionSummaries) {
    const cfg = CFG.traits ?? {};

    /* --- 成长趋势 trend：每步得分随开局时间的回归斜率 --- */
    const trendCfg = cfg.trend ?? {};
    let trendValue = 0;
    let trendLabel = 'stable';
    if (sessionSummaries.length >= num(trendCfg.minSessions, 3)) {
        const slope = slopePerStep(sessionSummaries.map((s) => s.scorePerPlacement));
        const anchors = trendCfg.anchorSlope ?? [-0.6, 0.0, 0.6];
        trendValue = round((anchorNorm(slope, anchors) - 0.5) * 2, 3); // → [-1,1]
        if (trendValue >= num(trendCfg.improvingThreshold, 0.15)) trendLabel = 'improving';
        else if (trendValue <= num(trendCfg.decliningThreshold, -0.15)) trendLabel = 'declining';
    }

    /* --- 局内耐力 endurance：后半段质量保持率 --- */
    const endCfg = cfg.endurance ?? {};
    const ratios = [];
    for (const s of sessionSummaries) {
        if (s.firstHalfQ != null && s.secondHalfQ != null && s.firstHalfQ > 1e-6) {
            ratios.push(Math.min(1.2, s.secondHalfQ / s.firstHalfQ));
        }
    }
    const enduranceValue = ratios.length ? round(clamp01(mean(ratios)), 3) : 0.5;
    const fatigue = enduranceValue < num(endCfg.fatigueThreshold, 0.8);

    /* --- 高压表现 clutch：高 fill 时平均方块质量（highFill 阈值在 buildSessionSummaries 应用） --- */
    const clutchVals = sessionSummaries.map((s) => s.highFillQ).filter((v) => v != null);
    const clutchSamples = clutchVals.length;
    const clutchValue = clutchSamples >= 1 ? round(clamp01(mean(clutchVals)), 3) : 0.5;

    return {
        trend: { value: trendValue, label: trendLabel, samples: sessionSummaries.length },
        endurance: { value: enduranceValue, fatigue, samples: ratios.length },
        clutch: { value: clutchValue, samples: clutchSamples },
    };
}

/* ============================================================================
 * 阶段 3：偏好模型
 * ========================================================================== */

const PLAYSTYLE_KEYS = ['perfect_hunter', 'multi_clear', 'combo', 'survival', 'balanced'];
const PLAYSTYLE_LABEL = {
    perfect_hunter: '清屏猎人',
    multi_clear: '多消流',
    combo: '连消流',
    survival: '生存流',
    balanced: '均衡',
};

function computePlaystyleDistribution(obs) {
    const cfg = (CFG.preference ?? {}).playstyle ?? {};
    const anchors = cfg.anchors ?? {};
    const beta = num(cfg.beta, 4.0);

    const clearedObs = obs.filter((o) => o.cleared);
    const pcRate = clearedObs.length ? clearedObs.filter((o) => o.boardFill === 0).length / clearedObs.length : 0;
    const multiClear = mean(obs.map((o) => o.multiClearRate).filter((v) => v != null));
    const comboRate = mean(obs.map((o) => o.comboRate).filter((v) => v != null));
    const clearRate = obs.length ? clearedObs.length / obs.length : 0;
    const fillTolerance = clamp01(mean(obs.map((o) => o.prevBoardFill).filter((v) => v != null)));

    const survCfg = cfg.survival ?? {};
    const z = [
        clamp01(pcRate / num(anchors.perfectClearRateMax, 0.15)),
        clamp01(multiClear / num(anchors.multiClearRateMax, 0.5)),
        clamp01(comboRate / num(anchors.comboRateMax, 0.45)),
        clamp01((1 - clearRate) * num(survCfg.clearRateWeight, 0.7) + fillTolerance * num(survCfg.fillToleranceWeight, 0.3)),
        num(cfg.balancedPrior, 0.4),
    ];
    const probs = softmax(z, beta);
    const distribution = {};
    PLAYSTYLE_KEYS.forEach((k, i) => { distribution[k] = round(probs[i], 3); });
    let dom = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[dom]) dom = i;
    const dominant = PLAYSTYLE_KEYS[dom];

    return {
        distribution,
        dominant,
        label: PLAYSTYLE_LABEL[dominant],
        commitment: round(1 - normalizedEntropy(probs)),
        evidence: { perfectClearRate: round(pcRate, 3), multiClearRate: round(multiClear, 3), comboRate: round(comboRate, 3), clearRate: round(clearRate, 3), fillTolerance: round(fillTolerance, 3) },
    };
}

function computeRiskAppetite(obs) {
    const cfg = (CFG.preference ?? {}).riskAppetite ?? {};
    const w = cfg.weights ?? {};
    const anchors = cfg.anchors ?? {};
    const bands = cfg.bands ?? {};

    const fillBefore = mean(obs.map((o) => o.prevBoardFill).filter((v) => v != null));
    const fillScore = anchorNorm(fillBefore, anchors.fillBeforePlace ?? [0.30, 0.50, 0.72]);

    // 近失：较满盘面(>0.6)未消行后续续玩（近似 nearMiss 频率）
    const nearMiss = obs.length
        ? obs.filter((o) => o.prevBoardFill != null && o.prevBoardFill > 0.6 && !o.cleared).length / obs.length
        : 0;
    const multiClear = mean(obs.map((o) => o.multiClearRate).filter((v) => v != null));

    // fillVelocity：局内相邻 fill 正增量均值（激进玩家堆得快）
    const bySession = groupBy(obs, (o) => o.sessionId);
    const velos = [];
    for (const g of Object.values(bySession)) {
        for (let i = 1; i < g.length; i++) {
            if (g[i].boardFill != null && g[i - 1].boardFill != null) {
                velos.push(Math.max(0, g[i].boardFill - g[i - 1].boardFill));
            }
        }
    }
    const fillVel = mean(velos);
    const velScore = anchorNorm(fillVel, anchors.fillVelocity ?? [0.01, 0.06, 0.16]);

    const value = clamp01(
        fillScore * num(w.fillBeforePlace, 0.45)
        + clamp01(nearMiss / 0.3) * num(w.nearMiss, 0.20)
        + clamp01(multiClear) * num(w.multiClear, 0.20)
        + velScore * num(w.fillVelocity, 0.15)
    );
    const band = value >= num(bands.aggressive, 0.62) ? 'aggressive'
        : value <= num(bands.conservative, 0.40) ? 'conservative' : 'balanced';

    return {
        value: round(value),
        band,
        raw: { fillBeforePlace: round(fillBefore, 3), nearMissRate: round(nearMiss, 3), fillVelocity: round(fillVel, 4) },
    };
}

function computeTempo(obs) {
    const cfg = (CFG.preference ?? {}).tempo ?? {};
    const anchors = cfg.anchors ?? {};
    const bands = cfg.bands ?? {};

    const thinks = obs.map((o) => o.thinkMs).filter((v) => v != null && v > 0);
    const meanThink = thinks.length ? mean(thinks) : null;
    const speed = meanThink != null ? anchorNorm(meanThink, anchors.thinkMs ?? [800, 2600, 7000], true) : 0.5;

    let label = 'measured';
    if (meanThink != null) {
        if (meanThink <= num(bands.snappyMaxMs, 1500)) label = 'snappy';
        else if (meanThink >= num(bands.deliberateMinMs, 5000)) label = 'deliberate';
    }
    const reacts = obs.map((o) => o.pickToPlaceMs).filter((v) => v != null && v > 0);
    return {
        value: round(speed),
        label,
        meanThinkMs: meanThink != null ? round(meanThink) : null,
        meanReactionMs: reacts.length ? round(mean(reacts)) : null,
    };
}

function computeAffinity(obs, key, topN) {
    const counts = {};
    const gainSum = {};
    let total = 0;
    for (const o of obs) {
        const k = o[key];
        if (k == null) continue;
        const id = String(k);
        counts[id] = (counts[id] || 0) + 1;
        gainSum[id] = (gainSum[id] || 0) + (o.scoreDelta != null ? Math.max(0, o.scoreDelta) : 0);
        total++;
    }
    const list = Object.keys(counts).map((id) => ({
        key: id,
        count: counts[id],
        share: round(counts[id] / Math.max(1, total), 3),
        avgGain: round(gainSum[id] / counts[id], 1),
    }));
    list.sort((a, b) => b.count - a.count || b.avgGain - a.avgGain);
    return list.slice(0, Math.max(1, num(topN, 3)));
}

function computeMotivation(ability, preference) {
    const scores = {
        competence: 0,
        challenge: 0,
        relaxation: 0,
        collection: 0,
        social: 0,
    };
    const dom = preference.playstyle.dominant;
    const skill = ability.skillScore;
    const risk = preference.riskAppetite.value;

    scores.competence += clamp01(ability.dims.execution.value) * 0.5 + clamp01(skill) * 0.3;
    scores.challenge += clamp01(skill) * 0.4 + clamp01(risk) * 0.4 + clamp01(ability.dims.scoring.value) * 0.2;
    scores.relaxation += clamp01(1 - skill) * 0.4 + clamp01(1 - risk) * 0.3 + (dom === 'survival' ? 0.3 : 0);
    scores.collection += (dom === 'perfect_hunter' ? 0.6 : 0) + clamp01(ability.dims.scoring.parts.bonus) * 0.4;
    scores.social += 0.1; // 社交需明示信号（分享/挑战）注入，缺省给极低先验

    let primary = 'competence';
    let best = -Infinity;
    for (const [k, v] of Object.entries(scores)) {
        scores[k] = round(v, 3);
        if (v > best) { best = v; primary = k; }
    }
    const PRIMARY_LABEL = { competence: '胜任成长', challenge: '挑战征服', relaxation: '休闲放松', collection: '收集完美', social: '社交竞争' };
    return { primary, label: PRIMARY_LABEL[primary], scores };
}

/* ============================================================================
 * 解释层
 * ========================================================================== */

function buildExplain(ability, preference, traits) {
    const out = [];
    const d = ability.dims;
    const topDim = Object.entries(d).sort((a, b) => b[1].value - a[1].value)[0];
    const lowDim = Object.entries(d).sort((a, b) => a[1].value - b[1].value)[0];
    const DIM_LABEL = DIM_CN;

    if (topDim) out.push(`优势能力：${DIM_LABEL[topDim[0]]}（${pctInt(topDim[1].value)}）`);
    if (lowDim && lowDim[0] !== topDim?.[0]) out.push(`待提升：${DIM_LABEL[lowDim[0]]}（${pctInt(lowDim[1].value)}）`);

    out.push(`风格主导：${preference.playstyle.label}（承诺度 ${pctInt(preference.playstyle.commitment)}%）`);
    if (preference.riskAppetite.band === 'aggressive') out.push('偏好激进堆叠、容忍高 fill，可投放更强爽感与挑战');
    else if (preference.riskAppetite.band === 'conservative') out.push('偏好稳健保活，建议保证消行友好与减压');

    if (preference.tempo.label === 'snappy') out.push('节奏速断，反射式落子明显');
    else if (preference.tempo.label === 'deliberate') out.push('节奏深思，决策耗时偏长');

    if (traits) {
        if (traits.trend.label === 'improving') out.push('跨局表现持续进步，可逐步加压避免无聊');
        else if (traits.trend.label === 'declining') out.push('跨局表现下滑，留意流失风险，建议减压回暖');
        if (traits.endurance.fatigue) out.push('局内后程易疲劳，长局应在后段降压');
    }

    out.push(`核心动机：${preference.motivation.label}`);
    return out.slice(0, 8);
}

/* ============================================================================
 * 阶段 3.5：出块算法建议层（供 adaptiveSpawn / spawn 寻参直接消费）
 * ========================================================================== */

/** 连续未消行 drought 的最大游程长度集合（跨局），用于救济敏感度。 */
function droughtRunLengths(obs) {
    const bySession = groupBy(obs, (o) => o.sessionId);
    const runs = [];
    for (const g of Object.values(bySession)) {
        let run = 0;
        for (const o of g) {
            if (o.cleared) {
                if (run > 0) runs.push(run);
                run = 0;
            } else {
                run++;
            }
        }
        if (run > 0) runs.push(run);
    }
    return runs;
}

function computeSpawnAdvice(obs, ability, preference, traits, confidence, baseUnit) {
    const cfg = CFG.spawnAdvice ?? {};

    /* 推荐难度（跨局先验，仍可被实时信号覆盖） */
    const diffCfg = cfg.difficulty ?? {};
    const skill = ability.skillScore;
    const recommendedDifficulty = skill >= num(diffCfg.hardSkill, 0.62) ? 'hard'
        : skill >= num(diffCfg.normalSkill, 0.40) ? 'normal' : 'easy';

    /* 个性化强度：低置信时收敛到 0（spawn 少个性化、多走通用策略） */
    const psCfg = cfg.personalizationStrength ?? {};
    const floor = num(psCfg.confidenceFloor, 0.2);
    const personalizationStrength = round(clamp01((confidence - floor) / Math.max(1e-6, 1 - floor)) * num(psCfg.max, 1.0));

    /* 目标 stress 先验 */
    const tsCfg = cfg.targetStress ?? {};
    const risk = preference.riskAppetite.value;
    const survival = ability.dims.survival?.value ?? 0.5;
    const targetStressVal = clamp(
        num(tsCfg.base, 0.10)
        + num(tsCfg.skillK, 0.5) * (skill - 0.5)
        + num(tsCfg.riskK, 0.2) * (risk - 0.5)
        - num(tsCfg.fragilityK, 0.3) * (1 - survival),
        num(tsCfg.min, -0.3), num(tsCfg.max, 0.6)
    );
    const tsBands = tsCfg.bands ?? {};
    const targetStressBand = targetStressVal >= num(tsBands.high, 0.30) ? 'high'
        : targetStressVal <= num(tsBands.low, 0.0) ? 'low' : 'mid';

    /* 救济敏感度（drought P50） */
    const reliefCfg = cfg.relief ?? {};
    const runs = droughtRunLengths(obs);
    const droughtP50 = runs.length ? median(runs) : 0;
    const reliefSensitivity = round(clamp01(droughtP50 / num(reliefCfg.droughtMax, 6)));
    const reliefAfterRounds = Math.max(1, Math.ceil(droughtP50) + 1);

    /* 爽感节奏（delight 间隔） */
    const delCfg = cfg.delight ?? {};
    const threshold = num(delCfg.scoreMultThreshold, 2.0) * baseUnit;
    const delightEvents = obs.filter((o) => o.scoreDelta != null && o.scoreDelta >= threshold).length;
    const delightCadenceRounds = delightEvents > 0 ? round(obs.length / delightEvents, 1) : null;
    const suggestedStarvationThreshold = delightCadenceRounds != null
        ? Math.max(2, Math.round(delightCadenceRounds))
        : num(delCfg.starvationFallback, 6);

    /* 舒适填充带（prevBoardFill 分桶取最高质量桶） */
    const cfCfg = cfg.comfortFill ?? {};
    const edges = cfCfg.buckets ?? [0.2, 0.35, 0.5, 0.65, 0.8, 1.0];
    const mqCfg = (abilityCfg().execution ?? {}).moveQuality ?? {};
    const bySession = groupBy(obs, (o) => o.sessionId);
    const buckets = edges.map(() => []);
    for (const g of Object.values(bySession)) {
        const qs = moveQualitySeries(g, mqCfg);
        for (let i = 1; i < g.length; i++) {
            const f = g[i].prevBoardFill;
            if (f == null) continue;
            let bi = edges.findIndex((e) => f <= e);
            if (bi < 0) bi = edges.length - 1;
            buckets[bi].push(qs[i - 1]);
        }
    }
    let bestBucket = -1;
    let bestQ = -1;
    buckets.forEach((arr, i) => {
        if (arr.length >= 3) {
            const m = mean(arr);
            if (m > bestQ) { bestQ = m; bestBucket = i; }
        }
    });
    const comfortFillBand = bestBucket >= 0
        ? { low: round(bestBucket === 0 ? 0 : edges[bestBucket - 1], 2), high: round(edges[bestBucket], 2), quality: round(bestQ) }
        : null;

    /* 形状胜任度 */
    const scCfg = cfg.shapeCompetence ?? {};
    const minAttempts = num(scCfg.minAttempts, 2);
    const byShape = groupBy(obs.filter((o) => o.shapeCategory != null), (o) => o.shapeCategory);
    const shapeCompetence = Object.entries(byShape).map(([cat, g]) => {
        const attempts = g.length;
        const clearRate = attempts ? g.filter((o) => o.cleared).length / attempts : 0;
        const gains = g.map((o) => (o.scoreDelta != null ? Math.max(0, o.scoreDelta) : 0));
        const avgGain = mean(gains);
        const competence = clamp01(0.7 * clearRate + 0.3 * clamp01(avgGain / Math.max(1, 2 * baseUnit)));
        return { category: cat, attempts, clearRate: round(clearRate, 3), avgGain: round(avgGain, 1), competence: round(competence) };
    }).filter((s) => s.attempts >= minAttempts).sort((a, b) => b.attempts - a.attempts);

    /* 颜色先验（沿用 colorAffinity，给 spawn 染色 bias 参考） */
    const colorPriors = (preference.colorAffinity || []).map((c) => ({ colorIdx: Number(c.key), share: c.share }));

    /* 拓扑形态短板：spawn 可据此定向施压（训练）或规避（救济） */
    const topoRaw = ability.dims.topology?.raw ?? {};
    const topologyForm = {
        weakness: topoRaw.formWeakness ?? null,
        avgHoles: topoRaw.avgHoles ?? null,
        avgConcave: topoRaw.avgConcave ?? null,
        avgRegions: topoRaw.avgRegions ?? null,
        holeRepairRate: topoRaw.holeRepairRate ?? null,
    };

    return {
        recommendedDifficulty,
        personalizationStrength,
        targetStress: { value: round(targetStressVal, 3), band: targetStressBand },
        relief: { sensitivity: reliefSensitivity, reliefAfterRounds, droughtP50: round(droughtP50, 1) },
        delight: { cadenceRounds: delightCadenceRounds, suggestedStarvationThreshold, events: delightEvents },
        comfortFillBand,
        topologyForm,
        shapeCompetence,
        colorPriors,
    };
}

/* ============================================================================
 * 阶段 4：白话总结（提升可读性）
 * ========================================================================== */

const DIM_CN = { topology: '拓扑规划', scoring: '计分掌控', execution: '执行质量', reaction: '反应节奏', survival: '生存韧性', consistency: '稳定性' };
const STYLE_CN = { perfect_hunter: '清屏猎人', multi_clear: '多消流', combo: '连消流', survival: '生存流', balanced: '均衡' };

function buildSummary(ability, preference, traits, spawnAdvice) {
    const bandCn = { expert: '专家级', advanced: '进阶', developing: '成长中', beginner: '入门' }[ability.band] || ability.band;
    const dimsArr = Object.entries(ability.dims);
    const top = dimsArr.slice().sort((a, b) => b[1].value - a[1].value)[0];
    const low = dimsArr.slice().sort((a, b) => a[1].value - b[1].value)[0];
    const riskCn = { aggressive: '偏激进、敢于把盘面堆满', balanced: '攻守均衡', conservative: '偏稳健、注重保活' }[preference.riskAppetite.band];
    const tempoCn = { snappy: '落子果断快速', measured: '节奏从容', deliberate: '决策偏慢、深思熟虑' }[preference.tempo.label];
    const trendCn = { improving: '近期在进步', declining: '近期状态下滑', stable: '状态稳定' }[traits.trend.label];
    const diffCn = { easy: '简单', normal: '普通', hard: '困难' }[spawnAdvice.recommendedDifficulty];

    const parts = [];
    parts.push(`综合能力 ${pctInt(ability.skillScore)} 分（${bandCn}）。`);
    if (top && low && top[0] !== low[0]) {
        parts.push(`最擅长「${DIM_CN[top[0]]}」(${pctInt(top[1].value)})，「${DIM_CN[low[0]]}」(${pctInt(low[1].value)}) 相对薄弱。`);
    }
    parts.push(`打法主导「${STYLE_CN[preference.playstyle.dominant]}」，${riskCn}，${tempoCn}。`);
    parts.push(`${trendCn}；${traits.endurance.fatigue ? '后程易疲劳，质量回落明显' : '局内耐力良好'}。`);
    parts.push(`出块建议：难度「${diffCn}」、目标压力「${{ high: '偏高', mid: '适中', low: '偏低' }[spawnAdvice.targetStress.band]}」；约每 ${spawnAdvice.relief.reliefAfterRounds} 轮内保证一次消行机会。`);
    return parts.join('');
}

function pctInt(v) {
    return Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
}

/**
 * 指标释义词典（供 UI tooltip / 文档复用，统一口径，避免前端各写一份）。
 */
export const ANALYTICS_GLOSSARY = {
    skillScore: '综合能力：6 个能力维度按权重合成的总分。',
    topology: '拓扑规划：控制空洞、保持盘面平整、避免碎片化、把握近满转化的能力。',
    scoring: '计分掌控：单位落子榨取分数（分数杠杆）、Combo 利用、多消与清屏 bonus 的能力。',
    execution: '执行质量：每次落子对盘面的实际贡献（消行/修复空洞 vs 制造空洞/碎片），即“方块质量”。',
    reaction: '反应节奏：从拿起方块到落子的速度、稳定性与操作密度。',
    survival: '生存韧性：存活步数、高压盘面下的恢复力、规避死局的能力。',
    consistency: '稳定性：跨局发挥与逐步质量的离散度，越高越稳定可预测。',
    trend: '成长趋势：跨局表现随时间的走向（进步/稳定/下滑）。',
    endurance: '局内耐力：一局后半段相对前半段的发挥保持率，低则后程易疲劳。',
    clutch: '高压表现：盘面接近满时的处理质量（逆境/抗压）。',
    riskAppetite: '风险偏好：倾向把盘面堆满冒险换爽感（激进）还是稳健保活（保守）。',
    tempo: '节奏：决策与操作的快慢偏好。',
    recommendedDifficulty: '推荐难度：基于综合能力的跨局先验，供出块算法选择策略档。',
    personalizationStrength: '个性化强度：数据置信度越高，出块算法越可大胆按此画像个性化。',
    targetStress: '目标压力：建议 adaptiveSpawn 维持的综合压力水位先验。',
    reliefAfterRounds: '救济节奏：建议在多少轮内保证一次消行机会，避免挫败流失。',
    delightCadence: '爽感节奏：玩家平均多少轮触发一次多消/清屏爽感，用于个性化“爽感饥渴”阈值。',
    comfortFillBand: '舒适填充带：玩家发挥最好的盘面满度区间，出块可把盘面维持在此带。',
    shapeCompetence: '形状胜任度：玩家对各类形状的处理能力，低胜任形状救济时少投、训练时可多投。',
};

/* ============================================================================
 * 工具：分组
 * ========================================================================== */

function groupBy(arr, keyFn) {
    const out = {};
    for (const x of arr) {
        const k = String(keyFn(x));
        (out[k] = out[k] || []).push(x);
    }
    return out;
}

/* ============================================================================
 * 顶层编排
 * ========================================================================== */

/**
 * 从一个玩家的会话历史构建完整能力·偏好画像。
 *
 * @param {object[]} sessions 会话行数组（含 frames[].ps），兼容 buildAbilityTrainingDataset 入参
 * @param {{ now?: number }} [opts]
 * @returns {{
 *   version:number,
 *   meta:object,
 *   ability:{ skillScore:number, band:string, confidence:number, dims:Record<string,object> },
 *   preference:{ playstyle:object, riskAppetite:object, tempo:object, shapeAffinity:object[], colorAffinity:object[], motivation:object },
 *   confidence:number,
 *   explain:string[]
 * }}
 */
export function analyzePlayer(sessions, opts = {}) {
    const rows = asArray(sessions);
    const obs = extractMoveObservations(rows);
    const agg = sessionAggregates(rows);
    const n0 = num(CFG.confidenceN0, 40);
    const minObs = num(CFG.minObservations, 8);

    const sessionSummaries = buildSessionSummaries(obs, rows);

    const topology = computeTopologyDim(obs);
    const scoring = computeScoringDim(obs, agg);
    const execution = computeExecutionDim(obs);
    const reaction = computeReactionDim(obs);
    const survival = computeSurvivalDim(obs, agg);
    const consistency = computeConsistencyDim(obs, sessionSummaries);

    const aw = abilityCfg().weights ?? {};
    const skillScore = clamp01(
        topology.value * num(aw.topology, 0.22)
        + scoring.value * num(aw.scoring, 0.20)
        + execution.value * num(aw.execution, 0.20)
        + reaction.value * num(aw.reaction, 0.14)
        + survival.value * num(aw.survival, 0.12)
        + consistency.value * num(aw.consistency, 0.12)
    );

    // 逐维置信度：以各维有效样本量驱动
    const reactionSamples = obs.filter((o) => o.pickToPlaceMs != null && o.pickToPlaceMs > 0).length;
    const dims = {
        topology: { ...topology, confidence: round(sampleConfidence(obs.length, n0)) },
        scoring: { ...scoring, confidence: round(sampleConfidence(agg.totalPlacements, n0)) },
        execution: { ...execution, confidence: round(sampleConfidence(execution.raw.moveQualitySamples, n0)) },
        reaction: { ...reaction, confidence: round(sampleConfidence(reactionSamples, n0)) },
        survival: { ...survival, confidence: round(sampleConfidence(agg.sessions * 4, n0)) },
        consistency: { ...consistency, confidence: round(sampleConfidence(sessionSummaries.length * 6, n0)) },
    };

    const ability = {
        skillScore: round(skillScore),
        band: abilityBand(skillScore),
        confidence: round(sampleConfidence(obs.length, n0)),
        dims,
    };

    const playstyle = computePlaystyleDistribution(obs);
    const riskAppetite = computeRiskAppetite(obs);
    const tempo = computeTempo(obs);
    const prefCfg = CFG.preference ?? {};
    const shapeAffinity = computeAffinity(obs, 'shapeCategory', prefCfg.shapeAffinity?.topN ?? 3);
    const colorAffinity = computeAffinity(obs, 'colorIdx', prefCfg.colorAffinity?.topN ?? 3);

    const preference = { playstyle, riskAppetite, tempo, shapeAffinity, colorAffinity, motivation: null };
    preference.motivation = computeMotivation(ability, preference);

    const traits = computeTraits(obs, sessionSummaries);
    const overallConfidence = round(sampleConfidence(obs.length, n0));
    const baseUnit = scoringBaseUnit(agg);
    const spawnAdvice = computeSpawnAdvice(obs, ability, preference, traits, overallConfidence, baseUnit);

    const summary = buildSummary(ability, preference, traits, spawnAdvice);
    const explain = buildExplain(ability, preference, traits);

    return {
        version: PLAYER_ANALYTICS_VERSION,
        meta: {
            sessions: agg.sessions,
            observations: obs.length,
            totalPlacements: agg.totalPlacements,
            strategyMix: agg.strategyMix,
            sufficientData: obs.length >= minObs,
            generatedAt: num(opts.now, Date.now()),
        },
        summary,
        ability,
        traits,
        preference,
        spawnAdvice,
        confidence: overallConfidence,
        explain,
    };
}

/* ============================================================================
 * 阶段 5：出块先验导出（buildSpawnPrior）—— 把离线画像精简为 adaptiveSpawn 可消费的运行时先验
 *
 * 设计见 docs/algorithms/ADAPTIVE_SPAWN.md「离线画像先验注入」。核心：
 *  - 把 spawnAdvice.shapeCompetence（9 类）映射到出块 shapeWeights 的 7 键，得到「中性方向」
 *    的 shapeBias（>0=擅长/适合多投，<0=不擅长/应少投）；
 *  - 叠加 topologyForm.weakness 对相关形状族的微调；
 *  - 运行时 applySpawnPrior 再按 spawnIntent 决定符号（救济/爽感顺玩家、训练逆玩家）。
 * ========================================================================== */

export const SPAWN_PRIOR_VERSION = 1;

/** classifyShape 的 9 类 → 出块 shapeWeights 的 7 键映射（L/J、T/Z 合并类平摊）。poly/unknown 跳过。 */
const SHAPE_CAT_TO_WEIGHT_KEYS = {
    line: ['lines'],
    rect: ['rects'],
    square: ['squares'],
    dot: ['squares'],
    lshape: ['lshapes', 'jshapes'],
    corner: ['lshapes', 'jshapes'],
    tzshape: ['tshapes', 'zshapes'],
};

/** 拓扑形态短板 → 形状族微调：relieve=适合多投(缓解短板)，aggravate=应少投(加剧短板)。启发式，可在配置侧再调。 */
const TOPO_WEAKNESS_SHAPE_NUDGE = {
    holeBurden: { relieve: ['squares'], aggravate: ['tshapes', 'zshapes', 'lshapes', 'jshapes'] },
    holeRepair: { relieve: ['squares'], aggravate: ['tshapes', 'zshapes', 'lshapes', 'jshapes'] },
    holeGrowth: { relieve: ['squares'], aggravate: ['tshapes', 'zshapes'] },
    flatness: { relieve: ['lines', 'rects'], aggravate: ['tshapes', 'zshapes'] },
    concaveControl: { relieve: ['lines', 'squares'], aggravate: ['tshapes', 'zshapes', 'lshapes', 'jshapes'] },
    regionCohesion: { relieve: ['squares', 'rects'], aggravate: ['tshapes', 'zshapes'] },
};

const SHAPE_WEIGHT_KEYS = ['lines', 'rects', 'squares', 'tshapes', 'zshapes', 'lshapes', 'jshapes'];

/**
 * 把 analyzePlayer 的结果精简为运行时出块先验（spawnPrior）。
 * 纯函数，无副作用；运行时由 game 注入 spawnContext.spawnPrior，adaptiveSpawn.applySpawnPrior 消费。
 *
 * @param {ReturnType<typeof analyzePlayer>} analysis
 * @param {{ topoNudgeGain?: number, now?: number }} [opts]
 * @returns {object|null} 数据不足时返回 null
 */
export function buildSpawnPrior(analysis, opts = {}) {
    if (!analysis || !analysis.spawnAdvice || !analysis.meta?.sufficientData) return null;
    const adv = analysis.spawnAdvice;
    const topoNudge = num(opts.topoNudgeGain, 0.15);

    const shapeBias = {};
    for (const k of SHAPE_WEIGHT_KEYS) shapeBias[k] = 0;

    // 1) shapeCompetence → bias（competence 居中 0.5；平摊到合并键）
    for (const sc of adv.shapeCompetence || []) {
        const keys = SHAPE_CAT_TO_WEIGHT_KEYS[sc.category];
        if (!keys) continue;
        const delta = (clamp01(sc.competence) - 0.5) / keys.length;
        for (const k of keys) shapeBias[k] += delta;
    }

    // 2) topologyForm.weakness → 形状族微调
    const weakness = adv.topologyForm?.weakness;
    const nudge = weakness && TOPO_WEAKNESS_SHAPE_NUDGE[weakness];
    if (nudge) {
        for (const k of nudge.relieve || []) shapeBias[k] += topoNudge;
        for (const k of nudge.aggravate || []) shapeBias[k] -= topoNudge;
    }

    // clamp 每键到 [-0.5, 0.5]
    for (const k of SHAPE_WEIGHT_KEYS) shapeBias[k] = round(clamp(shapeBias[k], -0.5, 0.5), 3);

    return {
        v: SPAWN_PRIOR_VERSION,
        analyticsVersion: analysis.version,
        generatedAt: num(opts.now, Date.now()),
        strength: round(clamp01(adv.personalizationStrength)),
        confidence: round(clamp01(analysis.confidence)),
        shapeBias,
        topoWeakness: weakness ?? null,
        comfortFill: adv.comfortFillBand
            ? { low: adv.comfortFillBand.low, high: adv.comfortFillBand.high }
            : null,
        reliefAfterRounds: adv.relief?.reliefAfterRounds ?? null,
        starvationThreshold: adv.delight?.suggestedStarvationThreshold ?? null,
        targetStress: adv.targetStress?.value ?? null,
        recommendedDifficulty: adv.recommendedDifficulty ?? null,
    };
}
