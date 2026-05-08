/**
 * 对局落子序列（schema v1）：与后端 `move_sequences.frames` 一致，供持久化与确定性回放。
 * 可选字段 `ps`：玩家状态快照（见 PLAYER_STATE_SNAPSHOT_VERSION），旧记录无此字段仍可回放盘面。
 */
import { Grid } from './grid.js';
import { computeClearScore } from './clearScoring.js';
import { buildPlayerAbilityVector } from './playerAbilityModel.js';

export const MOVE_SEQUENCE_SCHEMA = 1;
/** 玩家状态快照内部版本，便于日后扩展字段 */
/**
 * 玩家状态快照版本：
 *   1（v1.12 及之前）：metrics 直接写 `PlayerProfile.metrics` 的占位值（thinkMs:3000 / clearRate:0.3 …），
 *      回放时无法区分「真实测量」与「冷启动兜底」，会把冷启动帧的占位值绘入 sparkline。
 *   2（v1.13+）：新增 `metrics.samples / metrics.activeSamples / cognitiveLoadHasData / coldStart`
 *      三个判定字段；samples=0 / activeSamples=0 时把对应数值字段置 null（thinkMs/clearRate/
 *      comboRate/missRate/cognitiveLoad）。回放与实时面板共用同一份 REPLAY_METRICS.extract
 *      访问器，null 自动被 sparkline / `num()` 跳过或显「—」。旧版 ps.pv=1 仍可读，但 sparkline
 *      会保留早期那些占位点（已记录的对局无法回填）。
 */
export const PLAYER_STATE_SNAPSHOT_VERSION = 2;
/**
 * 至少多少次成功落子才写入 SQLite。
 * 注意：内部 frames 仍含 init / spawn / place，用于确定性回放；
 * 产品语义里的「帧」只统计真实落子（t === 'place'）。
 */
export const MIN_PERSIST_PLACE_STEPS = 5;

/** @deprecated 使用 MIN_PERSIST_PLACE_STEPS。保留导出避免旧代码/测试立即失效。 */
export const MIN_PERSIST_MOVE_FRAMES = MIN_PERSIST_PLACE_STEPS;

/**
 * 序列中用户真实落子次数（`t === 'place'`）。
 * 与总帧数关系：总帧 ≈ 1（init）+ 轮数×（1 spawn + 至多 3 place）+ 可能未完成的最后一轮 spawn。
 */
export function countPlaceStepsInFrames(frames) {
    if (!Array.isArray(frames)) {
        return 0;
    }
    let n = 0;
    for (const f of frames) {
        if (f && f.t === 'place') {
            n++;
        }
    }
    return n;
}

function finiteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function avg(values) {
    const xs = values.filter(finiteNumber);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function maxFinite(values) {
    const xs = values.filter(finiteNumber);
    return xs.length ? Math.max(...xs) : null;
}

function pct(v) {
    return v == null ? null : Math.max(0, Math.min(1, v));
}

function trendOf(first, last, eps = 0.03) {
    if (!finiteNumber(first) || !finiteNumber(last)) return 'unknown';
    const d = last - first;
    if (Math.abs(d) <= eps) return 'flat';
    return d > 0 ? 'up' : 'down';
}

function dominant(values) {
    const counts = new Map();
    for (const v of values) {
        if (v == null || v === '') continue;
        counts.set(String(v), (counts.get(String(v)) || 0) + 1);
    }
    let best = null;
    let bestN = 0;
    for (const [k, n] of counts.entries()) {
        if (n > bestN) {
            best = k;
            bestN = n;
        }
    }
    return best;
}

function flowPhrase(flowState, pacingPhase) {
    const f = String(flowState || 'unknown');
    const p = String(pacingPhase || 'unknown');
    if (f.includes('anxiety') || p.includes('over')) return '压力偏高，玩家更像是在被局面追赶';
    if (f.includes('bored') || p.includes('under')) return '挑战偏低，局面刺激不足';
    if (f.includes('flow') || p.includes('steady')) return '节奏相对贴近心流区';
    return '状态信号分散，节奏匹配度不稳定';
}

function trendPhrase(t, upText, downText, flatText) {
    if (t === 'up') return upText;
    if (t === 'down') return downText;
    if (t === 'flat') return flatText;
    return '趋势信号不足';
}

/**
 * @param {string} strategy
 * @param {import('./grid.js').Grid} grid
 * @param {{ singleLine: number, multiLine: number, combo: number }} scoring
 */
/**
 * @param {string} strategy
 * @param {import('./grid.js').Grid} grid
 * @param {{ singleLine: number, multiLine: number, combo: number }} scoring
 * @param {object} [playerState] 可选，本局开局时玩家状态快照 `ps`
 */
export function buildInitFrame(strategy, grid, scoring, playerState) {
    const frame = {
        v: MOVE_SEQUENCE_SCHEMA,
        t: 'init',
        strategy,
        grid: grid.toJSON(),
        scoring: {
            singleLine: scoring.singleLine,
            multiLine: scoring.multiLine,
            combo: scoring.combo
        }
    };
    if (playerState && typeof playerState === 'object') {
        frame.ps = playerState;
    }
    return frame;
}

/**
 * @param {Array<{ id: string, shape: number[][], colorIdx: number, placed?: boolean }>} descriptors
 */
/**
 * @param {Array<{ id: string, shape: number[][], colorIdx: number, placed?: boolean }>} descriptors
 * @param {object} [playerState] 可选，本轮出块后的玩家状态快照 `ps`
 */
export function buildSpawnFrame(descriptors, playerState) {
    const frame = {
        v: MOVE_SEQUENCE_SCHEMA,
        t: 'spawn',
        dock: descriptors.map((d) => ({
            id: d.id,
            shape: d.shape.map((row) => [...row]),
            colorIdx: d.colorIdx,
            placed: Boolean(d.placed)
        }))
    };
    if (playerState && typeof playerState === 'object') {
        frame.ps = playerState;
    }
    return frame;
}

/**
 * @param {number} dockIndex
 * @param {number} gx
 * @param {number} gy
 * @param {object} [playerState] 可选，本步落子后的玩家状态快照 `ps`
 */
export function buildPlaceFrame(dockIndex, gx, gy, playerState) {
    const frame = {
        v: MOVE_SEQUENCE_SCHEMA,
        t: 'place',
        i: dockIndex,
        x: gx,
        y: gy
    };
    if (playerState && typeof playerState === 'object') {
        frame.ps = playerState;
    }
    return frame;
}

/**
 * 从玩家画像 + 对局上下文生成可 JSON 序列化的快照（供写入 frames[].ps）
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {{
 *   score: number,
 *   boardFill: number,
 *   runStreak: number,
 *   strategyId: string,
 *   phase: 'init'|'spawn'|'place',
 *   adaptiveInsight?: object | null
 * }} ctx
 */
export function buildPlayerStateSnapshot(profile, ctx) {
    const m = profile.metrics;
    const a = ctx.adaptiveInsight;
    /* v1.13 / pv=2：冷启动隔离 ——
     * `PlayerProfile.metrics` 在 recent.length=0 时返回硬编码占位（thinkMs:3000/clearRate:0.3/
     * comboRate:0.1/missRate:0.1），是给 stress 主路径的兜底。但写入回放后，离线分析、
     * 回放 sparkline、复盘报告会把它们当成真实测量，导致「这局开局就 30% 消行率」的误判。
     * 这里按 samples / activeSamples 把无效字段置 null，并显式写入判定字段，离线工具可
     * 据此过滤冷启动样本。`cognitiveLoad` 在 placed<3 时同样置 null。
     */
    const samples = Number(m.samples ?? 0) || 0;
    const activeSamples = Number(m.activeSamples ?? 0) || 0;
    const hasAnySample = samples > 0;
    const hasActiveSample = activeSamples > 0;
    const cognitiveLoadHasData = !!profile.cognitiveLoadHasData;
    const coldStart = samples === 0;
    /** @type {Record<string, unknown>} */
    const slim = {
        pv: PLAYER_STATE_SNAPSHOT_VERSION,
        phase: ctx.phase,
        score: ctx.score,
        boardFill: ctx.boardFill,
        runStreak: ctx.runStreak,
        strategyId: ctx.strategyId,
        skill: profile.skillLevel,
        momentum: profile.momentum,
        cognitiveLoad: cognitiveLoadHasData ? profile.cognitiveLoad : null,
        cognitiveLoadHasData,
        coldStart,
        engagementAPM: profile.engagementAPM,
        flowDeviation: profile.flowDeviation,
        flowState: profile.flowState,
        pacingPhase: profile.pacingPhase,
        frustration: profile.frustrationLevel,
        sessionPhase: profile.sessionPhase,
        spawnRound: profile.spawnRoundIndex,
        feedbackBias: profile.feedbackBias,
        needsRecovery: profile.needsRecovery,
        hadNearMiss: profile.hadRecentNearMiss,
        isNewPlayer: profile.isNewPlayer,
        recentComboStreak: profile.recentComboStreak,
        playstyle: profile.playstyle,
        segment5: profile.segment5,
        historicalSkill: profile.historicalSkill,
        trend: profile.trend,
        confidence: profile.confidence,
        ability: buildPlayerAbilityVector(profile, {
            boardFill: ctx.boardFill,
            adaptiveInsight: a,
        }),
        metrics: {
            thinkMs: hasActiveSample ? m.thinkMs : null,
            clearRate: hasActiveSample ? m.clearRate : null,
            comboRate: hasActiveSample ? m.comboRate : null,
            missRate: hasAnySample ? m.missRate : null,
            afkCount: m.afkCount,
            samples,
            activeSamples
        }
    };
    if (a && typeof a === 'object') {
        slim.adaptive = {
            stress: a.stress,
            flowDeviation: a.flowDeviation,
            feedbackBias: a.feedbackBias,
            skillLevel: a.skillLevel,
            fillRatio: a.fillRatio,
            flowState: a.flowState,
            pacingPhase: a.pacingPhase,
            momentum: a.momentum,
            frustration: a.frustration,
            sessionPhase: a.sessionPhase,
            trend: a.trend,
            confidence: a.confidence,
            historicalSkill: a.historicalSkill,
            spawnHints: a.spawnHints ?? null,
            shapeWeightsTop: a.shapeWeightsTop ?? null,
            /* v1.13：把 stress 的细分构成与多轴投放目标也写入快照。
             *
             * 触发原因：拟人化压力表（stressMeter）回放时只能拿到 stress 数值，无法重建
             * 「主要构成 · 当前帧」列表（细分贡献），UI 显示「本帧无明显信号偏移」让回放
             * 失去了核心的可解释性。把 _lastAdaptiveInsight 已经合成好的 stressBreakdown
             * 与 spawnTargets 直接搬进帧快照即可。
             *
             * 体积估算：stressBreakdown ≈ 15 个 number 键、spawnTargets 6 个 axis，每帧
             * 增量约 200~300 B；典型一局百帧级别，整体增量 20~30 KB（远小于已存的 grid 帧），
             * 离线分析也直接可用，不需要解析时再补算。
             *
             * 对老回放（pv=2 但无该字段）的兼容：stressMeter 在 breakdown 缺失时自动退化到
             * level.vibe 叙事 + 「本帧无明显信号偏移」列表，与升级前行为一致；故 pv 不再 bump。
             */
            stressBreakdown: a.stressBreakdown && typeof a.stressBreakdown === 'object'
                ? { ...a.stressBreakdown } : null,
            spawnTargets: a.spawnTargets && typeof a.spawnTargets === 'object'
                ? { ...a.spawnTargets } : null
        };
    }
    return slim;
}

/**
 * 根据完整回放帧生成给设计者复盘用的整局评价和过程分析。
 * 该分析只依赖本局 frames/gameStats，可随 `move_sequences` 一起持久化。
 * @param {object[]} frames
 * @param {{ score?: number, gameStats?: object, durationMs?: number }} [ctx]
 */
export function buildReplayAnalysis(frames, ctx = {}) {
    const placeFrames = Array.isArray(frames) ? frames.filter((f) => f?.t === 'place') : [];
    const psFrames = (Array.isArray(frames) ? frames : [])
        .map((f, idx) => ({ idx, ps: f?.ps, frame: f }))
        .filter((x) => x.ps && typeof x.ps === 'object');
    const score = finiteNumber(ctx.score) ? ctx.score : displayScoreFromReplayFrames(frames) ?? 0;
    const fills = psFrames.map((x) => Number(x.ps.boardFill)).filter(Number.isFinite);
    const scores = psFrames.map((x) => Number(x.ps.score)).filter(Number.isFinite);
    const clearSteps = placeFrames.filter((f) => Number(f?.ps?.linesCleared || 0) > 0);
    const totalCleared = placeFrames.reduce((n, f) => n + Math.max(0, Number(f?.ps?.linesCleared || 0)), 0);
    const clearRate = placeFrames.length ? clearSteps.length / placeFrames.length : 0;
    let longestNoClear = 0;
    let noClear = 0;
    for (const f of placeFrames) {
        if (Number(f?.ps?.linesCleared || 0) > 0) {
            noClear = 0;
        } else {
            noClear += 1;
            longestNoClear = Math.max(longestNoClear, noClear);
        }
    }
    const thirds = [];
    for (let i = 0; i < 3; i++) {
        const lo = Math.floor((placeFrames.length * i) / 3);
        const hi = Math.floor((placeFrames.length * (i + 1)) / 3);
        const seg = placeFrames.slice(lo, hi);
        const segPs = seg.map((f) => f.ps).filter(Boolean);
        const segScore0 = Number(segPs[0]?.score);
        const segScore1 = Number(segPs[segPs.length - 1]?.score);
        thirds.push({
            phase: ['early', 'middle', 'late'][i],
            placements: seg.length,
            scoreGain: Number.isFinite(segScore0) && Number.isFinite(segScore1) ? Math.max(0, segScore1 - segScore0) : null,
            clearRate: seg.length ? seg.filter((f) => Number(f?.ps?.linesCleared || 0) > 0).length / seg.length : null,
            avgFill: avg(segPs.map((ps) => Number(ps.boardFill))),
            avgStress: avg(segPs.map((ps) => Number(ps.adaptive?.stress))),
            avgThinkMs: avg(segPs.map((ps) => Number(ps.metrics?.thinkMs)))
        });
    }
    const finalPs = psFrames[psFrames.length - 1]?.ps ?? null;
    const startFill = fills[0] ?? null;
    const endFill = fills[fills.length - 1] ?? null;
    const avgFill = avg(fills);
    const peakFill = maxFinite(fills);
    const avgStress = avg(psFrames.map((x) => Number(x.ps.adaptive?.stress)));
    const avgThinkMs = avg(psFrames.map((x) => Number(x.ps.metrics?.thinkMs)));
    const avgSkill = avg(psFrames.map((x) => Number(x.ps.skill)));
    const missRate = avg(psFrames.map((x) => Number(x.ps.metrics?.missRate)));
    const flowTrend = trendOf(Number(psFrames[0]?.ps?.flowDeviation), Number(finalPs?.flowDeviation), 0.05);
    const fillTrend = trendOf(startFill, endFill);
    const scoreTrend = scores.length >= 2 ? trendOf(scores[0], scores[scores.length - 1], 10) : 'unknown';
    const dominantFlow = dominant(psFrames.map((x) => x.ps.flowState));
    const dominantPacing = dominant(psFrames.map((x) => x.ps.pacingPhase));
    const recoveryFrames = psFrames.filter((x) => x.ps.needsRecovery === true).length;
    const recoveryRatio = psFrames.length ? recoveryFrames / psFrames.length : null;
    const finalFill = pct(endFill);

    /* v1.13：冷启动隔离统计 ——
     * 标记本局有多少帧仍处于「无任何落子样本」的占位状态，方便离线复盘工具：
     *   - 滤掉 coldFrames，避免把占位 0.3 消行率混入分群均值；
     *   - 若 coldFramesRatio 偏高，说明该 session 太短或 PS 写入时机过早，应在数据
     *     管线侧排除或单独打标。
     * 兼容 pv=1 旧记录：用 metrics.thinkMs===3000 && clearRate===0.3 的启发式判定。
     */
    const isColdPs = (ps) => {
        if (!ps) return false;
        if (ps.coldStart === true) return true;
        const s = Number(ps.metrics?.samples);
        if (Number.isFinite(s)) return s === 0;
        // 旧 pv=1 启发式
        return ps.metrics?.thinkMs === 3000 && ps.metrics?.clearRate === 0.3;
    };
    const coldFrames = psFrames.filter((x) => isColdPs(x.ps)).length;
    const coldFramesRatio = psFrames.length ? coldFrames / psFrames.length : null;
    const firstWarmFrameIdx = psFrames.find((x) => !isColdPs(x.ps))?.idx ?? null;

    let rating = 3;
    if (score >= 2000) rating = 5;
    else if (score >= 800) rating = 4;
    else if (score < 200 || (finalFill != null && finalFill > 0.72)) rating = 2;
    else if (score < 80 || placeFrames.length < 10) rating = 1;

    const tags = [];
    if (clearRate >= 0.45) tags.push('清线效率高');
    if (clearRate < 0.18) tags.push('清线不足');
    if (peakFill != null && peakFill > 0.72) tags.push('高压盘面');
    if (longestNoClear >= 8) tags.push('长时间未清线');
    if (avgThinkMs != null && avgThinkMs > 4500) tags.push('思考偏久');
    if (missRate != null && missRate > 0.08) tags.push('失误偏多');
    if (flowTrend === 'up') tags.push('心流压力上升');
    if (flowTrend === 'down') tags.push('压力回落');
    // v1.13：冷启动占比 > 25% 的样本对均值/趋势分析有较大噪声，提示离线管线打标
    if (coldFramesRatio != null && coldFramesRatio > 0.25) tags.push('冷启动样本偏多');

    const recommendations = [];
    if (clearRate < 0.2) {
        recommendations.push('检查早中期是否需要更多可形成单线/双线的引导块。');
    }
    if (peakFill != null && peakFill > 0.72) {
        recommendations.push('高填充阶段可评估恢复型出块、低负荷块或清线友好块的触发时机。');
    }
    if (longestNoClear >= 8) {
        recommendations.push('连续未清线较长，建议复盘对应阶段的候选块组合是否过于封闭。');
    }
    if (avgThinkMs != null && avgThinkMs > 4500) {
        recommendations.push('平均思考偏久，可能需要降低视觉/形状组合复杂度。');
    }
    if (coldFramesRatio != null && coldFramesRatio > 0.25) {
        recommendations.push(
            `本局有 ${coldFrames} 帧（占 ${(coldFramesRatio * 100).toFixed(0)}%）处于冷启动占位状态，` +
            `离线均值/分群对比时建议过滤 idx < ${firstWarmFrameIdx ?? '∞'} 的帧。`
        );
    }
    if (recommendations.length === 0) {
        recommendations.push('本局指标未触发明显异常，可作为常规样本进入分数/心流趋势对比。');
    }

    const summary = [
        `本局得分 ${Math.round(score)}，成功落子 ${placeFrames.length} 次，消线 ${totalCleared} 条。`,
        `清线步占比 ${(clearRate * 100).toFixed(1)}%，最长未清线 ${longestNoClear} 步。`,
        peakFill != null ? `盘面峰值填充 ${(peakFill * 100).toFixed(1)}%。` : ''
    ].filter(Boolean).join(' ');
    const abstractRead = [
        flowPhrase(dominantFlow, dominantPacing),
        trendPhrase(fillTrend, '盘面压力逐步堆高', '盘面压力被持续释放', '盘面压力大体稳定'),
        trendPhrase(flowTrend, '心流偏移扩大，系统可能给到了过强挑战', '心流偏移收敛，体验逐步被拉回舒适区', '心流偏移基本稳定'),
        clearRate < 0.2
            ? '玩家主要处在“摆放求生”而非“主动组织清线”的循环里'
            : clearRate > 0.42
                ? '玩家形成了较连续的清线闭环'
                : '玩家偶有清线反馈，但闭环还不够连续',
        recoveryRatio != null && recoveryRatio > 0.35
            ? '恢复需求长期存在，说明救济窗口可能来得偏晚或强度不足'
            : '恢复需求没有长期占据主导'
    ];
    const designRead = [
        peakFill != null && peakFill > 0.72
            ? '高填充峰值应作为出块算法复盘锚点：检查此前 1-2 轮候选块是否减少了可行动作。'
            : '盘面没有长期进入极限拥堵，可重点观察节奏与奖励反馈。',
        longestNoClear >= 8
            ? '最长未清线段较长，建议抽取该片段回放，分析是否缺少转折块或预期清线机会。'
            : '未清线段长度可控，说明阻塞主要不是单一长连败造成。',
        avgThinkMs != null && avgThinkMs > 4500
            ? '思考时间偏长，可能是候选组合复杂或盘面可读性下降。'
            : '思考时间未显示明显认知过载。',
        avgStress != null && avgStress > 0.65
            ? '压力信号偏高，算法应谨慎继续加压。'
            : '压力信号未达到强加压阈值。'
    ];

    return {
        schema: 1,
        generatedAt: Date.now(),
        rating,
        summary,
        tags,
        metrics: {
            score,
            placements: placeFrames.length,
            totalCleared,
            clearSteps: clearSteps.length,
            clearRate,
            longestNoClear,
            avgFill,
            peakFill,
            finalFill,
            avgStress,
            avgThinkMs,
            avgSkill,
            missRate,
            recoveryRatio,
            durationMs: finiteNumber(ctx.durationMs) ? ctx.durationMs : null,
            // v1.13：冷启动样本计数（pv≥2 直读 ps.coldStart；pv=1 启发式回填）
            coldFrames,
            coldFramesRatio,
            firstWarmFrameIdx
        },
        interpretation: {
            headline: abstractRead[0],
            abstract: abstractRead,
            designRead,
            dominantFlow,
            dominantPacing
        },
        process: {
            phases: thirds,
            finalState: finalPs ? {
                score: finalPs.score,
                boardFill: finalPs.boardFill,
                flowState: finalPs.flowState,
                pacingPhase: finalPs.pacingPhase,
                frustration: finalPs.frustration,
                needsRecovery: finalPs.needsRecovery
            } : null,
            trends: {
                fill: fillTrend,
                score: scoreTrend,
                flowDeviation: flowTrend
            }
        },
        recommendations
    };
}

/**
 * 回放滑块停在 frames[index] 时，用于展示的玩家状态（优先本帧的 ps，否则向前回溯）
 * @param {object[]} frames
 * @param {number} index
 * @returns {object | null}
 */
export function getPlayerStateAtFrameIndex(frames, index) {
    if (!frames || frames.length === 0 || index < 0) {
        return null;
    }
    const i = Math.min(index, frames.length - 1);
    for (let k = i; k >= 0; k--) {
        const ps = frames[k]?.ps;
        if (ps && typeof ps === 'object') {
            return ps;
        }
    }
    return null;
}

/**
 * @param {object | null} ps
 * @returns {string}
 */
export function formatPlayerStateForReplay(ps) {
    if (!ps || typeof ps !== 'object') {
        return '本帧无玩家状态记录（旧对局或未写入快照）';
    }
    const phase = ps.phase != null ? String(ps.phase) : '?';
    const lc = ps.linesCleared != null && ps.linesCleared > 0 ? ` · 本步消 ${ps.linesCleared} 线` : '';
    /* pv≥2 写入了 coldStart / metrics.samples；pv=1（旧对局）按 metrics.thinkMs===3000 等
     * 启发式回退判断，避免历史回放显示「思考 3000ms / 消行率 30%」迷惑性数字。 */
    const samples = Number(ps.metrics?.samples);
    const isCold = ps.coldStart === true
        || (Number.isFinite(samples) && samples === 0)
        || (ps.pv == null && ps.metrics?.thinkMs === 3000 && ps.metrics?.clearRate === 0.3);
    const coldBadge = isCold ? '🌱 冷启动 · ' : '';
    const lines = [
        `${coldBadge}阶段 ${phase} · 得分 ${ps.score ?? '—'} · 填充 ${ps.boardFill != null ? (Number(ps.boardFill) * 100).toFixed(1) + '%' : '—'}${lc}`,
        `技能 ${num(ps.skill)} · 心流 ${ps.flowState ?? '—'} · F ${num(ps.flowDeviation)} · 动量 ${num(ps.momentum)}`,
        `节奏 ${ps.pacingPhase ?? '—'} · 挫败 ${ps.frustration ?? '—'} · 会话 ${ps.sessionPhase ?? '—'} · 轮次 ${ps.spawnRound ?? '—'}`,
        // 冷启动时 thinkMs/clearRate 是 null（pv≥2）或被替换显示「—」（pv=1 启发式），
        // 避免离线设计师把占位 30%/3000ms 当作能力评估输入。
        `思考 ${num(isCold ? null : ps.metrics?.thinkMs)}ms · 消行率 ${num(isCold ? null : ps.metrics?.clearRate)} · 闭环 ${num(ps.feedbackBias)}`
    ];
    if (ps.adaptive && typeof ps.adaptive === 'object') {
        const ad = ps.adaptive;
        lines.push(
            `投放 stress ${num(ad.stress)} · fill ${num(ad.fillRatio)} · 技能(est) ${num(ad.skillLevel)}`
        );
    }
    return lines.join('\n');
}

function num(v) {
    if (v == null || Number.isNaN(Number(v))) {
        return '—';
    }
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/**
 * 应用 frames[0..lastInclusive]，返回用于渲染的快照（不修改传入的 frames）。
 * @param {object[]} frames
 * @param {number} lastInclusive
 * @returns {{ gridJSON: object, dockDescriptors: Array<{ id: string, shape: number[][], colorIdx: number, placed: boolean }>, score: number, strategy: string } | null}
 */
export function replayStateAt(frames, lastInclusive) {
    if (!frames || frames.length === 0 || lastInclusive < 0) {
        return null;
    }
    const first = frames[0];
    if (first.t !== 'init' || !first.grid) {
        return null;
    }

    const grid = new Grid(first.grid.size || 8);
    grid.fromJSON(first.grid);
    const scoring = first.scoring || {
        singleLine: 10,
        multiLine: 30,
        combo: 50
    };

    let score = 0;
    /** @type {Array<{ id: string, shape: number[][], colorIdx: number, placed: boolean }> | null} */
    let dock = null;

    const end = Math.min(lastInclusive, frames.length - 1);
    for (let fi = 1; fi <= end; fi++) {
        const f = frames[fi];
        if (!f || typeof f.t !== 'string') {
            continue;
        }
        if (f.t === 'spawn' && Array.isArray(f.dock)) {
            dock = f.dock.map((b) => ({
                id: b.id,
                shape: b.shape.map((row) => [...row]),
                colorIdx: b.colorIdx,
                placed: Boolean(b.placed)
            }));
        } else if (f.t === 'place' && dock) {
            const idx = f.i;
            if (idx < 0 || idx >= dock.length || dock[idx].placed) {
                continue;
            }
            const b = dock[idx];
            if (!grid.canPlace(b.shape, f.x, f.y)) {
                continue;
            }
            grid.place(b.shape, b.colorIdx, f.x, f.y);
            const result = grid.checkLines();
            result.perfectClear = result.count > 0 && grid.getFillRatio() === 0;
            const strategyId = first.strategy || 'normal';
            score += computeClearScore(strategyId, result, scoring).clearScore;
            b.placed = true;
        }
    }

    const dockDescriptors = dock
        ? dock.map((b) => ({
              id: b.id,
              shape: b.shape.map((row) => [...row]),
              colorIdx: b.colorIdx,
              placed: b.placed
          }))
        : [];

    return {
        gridJSON: grid.toJSON(),
        dockDescriptors,
        score,
        strategy: first.strategy || 'normal'
    };
}

/**
 * 盘面 + 候选块区的视觉签名（用于检测相邻帧是否「看起来没变」）。
 * 不含 ps 画像字段：避免仅数值快照变化却误判为同一画面。
 * @param {object[]} frames
 * @param {number} lastInclusive
 * @returns {string}
 */
export function replayVisualSignature(frames, lastInclusive) {
    const st = replayStateAt(frames, lastInclusive);
    if (!st) {
        return '\0';
    }
    return JSON.stringify(st.gridJSON);
}

/**
 * 自动播放用：从 cur 往后找第一个「视觉与 cur 不同」的帧下标；若不存在则返回 maxIdx。
 * 可合并因 `replayStateAt` 中 place 被跳过（非法/重复落子）导致的连续重复快照。
 * @param {object[]} frames
 * @param {number} cur 当前已展示的帧下标
 * @param {number} maxIdx 最大合法下标（含）
 * @returns {number}
 */
export function nextDistinctReplayFrameIndex(frames, cur, maxIdx) {
    if (!frames?.length || maxIdx < 0) {
        return 0;
    }
    const c = Math.min(Math.max(0, cur), maxIdx);
    const sigCur = replayVisualSignature(frames, c);
    let n = c + 1;
    while (n <= maxIdx) {
        if (replayVisualSignature(frames, n) !== sigCur) {
            return n;
        }
        n += 1;
    }
    return maxIdx;
}

/**
 * 用于列表/标题展示：优先末帧起向前找 `ps.score`，否则用 `replayStateAt` 重算（修正 sessions.score 未同步的问题）。
 * @param {object[]} frames
 * @returns {number | null}
 */
export function displayScoreFromReplayFrames(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
        return null;
    }
    for (let i = frames.length - 1; i >= 0; i--) {
        const s = frames[i]?.ps?.score;
        if (typeof s === 'number' && !Number.isNaN(s)) {
            return s;
        }
    }
    const st = replayStateAt(frames, frames.length - 1);
    return st && typeof st.score === 'number' ? st.score : null;
}

/* ── Replay Series Metrics ── */

/** 回放时间序列与实时状态序列共用字段定义（tooltip：鼠标悬停时的物理含义说明） */
export const REPLAY_METRICS = [
    {
        key: 'score',
        label: '得分',
        group: 'game',
        extract: ps => ps.score,
        fmt: 'int',
        tooltip: '本局累计得分。分数越高通常局面张力越大，也是自适应出块在「多档形状权重」之间切换的重要输入之一。\n📈 看图：阶梯上升=连续消行；长平台=连续未消行（与右侧「未消行」曲线印证）；陡峭跳变=多消爆发（与「消行率」同步抬升）。逼近历史最佳分（约 80%）时会触发「挑战」加压。'
    },
    {
        key: 'skill',
        label: '技能',
        group: 'ability',
        extract: ps => ps.skill,
        fmt: 'pct',
        tooltip: '综合技能估计（0～100%）：融合本局滑动窗口内的即时表现与历史长周期能力；越高表示系统认为玩家当前操作与决策水平越好，可略提高挑战。\n📈 看图：长期均值约 50~80%；缓慢上行=本局表现稳定优于历史；急剧下挫=连续失误/未消行（看「失误」「未消行」曲线找因）。技能高 + F(t) 偏小=进入心流，技能高 + F(t) 大=可能投放偏难。'
    },
    {
        key: 'boardFill',
        label: '板面',
        group: 'game',
        extract: ps => ps.boardFill,
        fmt: 'pct',
        tooltip: '棋盘占用率：已被方块占据的格子比例。越高表示剩余可落子空间越少、死局风险越大，恢复与救济型出块会更敏感。\n📈 看图：典型节律呈"锯齿状"——逐步抬升到 50~70% → 多消瞬间回落。长时间高位（>60%）平台=接近瓶颈（看「未消行」与「负荷」是否同步飙）；持续低位（<25%）=盘面充裕，可主动留通道。'
    },
    {
        key: 'clearRate',
        label: '消行率',
        group: 'ability',
        extract: ps => ps.metrics?.clearRate,
        fmt: 'pct',
        tooltip: '近期窗口内「落子后成功消行」的步数占比。越高说明玩家持续在有效清除行列，是衡量「打得顺」的核心能力指标之一。\n📈 看图：> 50% 通常对应"舒适流畅区"；< 30% 是关键阈值（结合 F(t)>0.55 会切到 bored/anxious）；与「板面」反向走（消行率高时板面下降）。'
    },
    {
        key: 'stress',
        label: '压力',
        group: 'spawn',
        extract: ps => ps.adaptive?.stress,
        fmt: 'f2',
        tooltip: '自适应综合压力：由分数档、连战、技能、心流偏移、节奏、恢复需求、挫败、连击、近失、闭环反馈等信号叠加并钳制得到，用于在配置的多档形状权重之间插值。\n📈 看图：典型范围 -0.3 ~ +0.6，简单模式整体下移、困难上移。要"拆解"它的成分，可同时看下方「难度/心流/松紧/救济/会话/挑战」六条 stress 分量曲线（六者求和 ≈ stress）。'
    },
    {
        key: 'flowDeviation',
        label: 'F(t)',
        group: 'state',
        extract: ps => ps.flowDeviation,
        fmt: 'f2',
        tooltip: '心流偏移 F(t)：衡量当前挑战强度与玩家能力匹配程度（0 为理想心流区）。数值升高多表示「偏难或焦虑」；降低多表示「偏易或无聊」，会驱动心流三态与压力微调。\n📈 看图：< 0.25 = 沉浸区（默认 flow）；0.25~0.55 = 轻度偏移；> 0.55 = 显著偏移（结合「消行率」高低判定 bored / anxious）。曲线与「心流」分量(stress)同向走——F(t) 拉高，stress 内的"心流偏移"分量也会被推动。'
    },
    {
        key: 'momentum',
        label: '动量',
        group: 'state',
        extract: ps => ps.momentum,
        fmt: 'f2',
        tooltip: '动量：反映近期得分/消行是否处于上升趋势（正反馈累积）。为正时常略加压以延续爽感；为负时可能减压避免连跪挫败。\n📈 看图：典型范围 -0.5 ~ +0.5；正→负的拐点常预告"打不顺"，可作为切换策略的早期信号。与「未消行」反向：未消行步数累积时动量下行。'
    },
    {
        key: 'frustration',
        label: '未消行',
        group: 'state',
        extract: ps => ps.frustration,
        fmt: 'int',
        tooltip: '连续未消行的步数（挫败计数）。越大表示玩家越久没有有效清除，系统越倾向救济：降压、提高消行友好与偏小尺寸偏好。\n📈 看图：每次消行回落到 0 → 锯齿状是健康节奏；> 5 持续不降=瓶颈预警（结合「板面」高位、「负荷」抬升判定）。出现高峰常伴随「救济」分量(stress)走负、spawnIntent 切到 relief。'
    },
    {
        key: 'cognitiveLoad',
        label: '负荷',
        group: 'state',
        extract: ps => ps.cognitiveLoad,
        fmt: 'pct',
        tooltip: '认知负荷：由思考时间、操作密度、局面复杂度等综合估计的决策压力。偏高时常略降难度或缩短「决策窗口」带来的压迫感。\n📈 看图：> 60% 持续高位常伴随焦虑；与「思考」(thinkMs) 强正相关；高负荷 + 高板面 → 系统会减小尺寸偏好、提多样性。'
    },
    {
        key: 'missRate',
        label: '失误',
        group: 'ability',
        extract: ps => ps.metrics?.missRate,
        fmt: 'pct',
        tooltip: '近期窗口内坏手/无效放置占比。越高表示失误增多，常与减压、消行友好块型、恢复策略联动。\n📈 看图：< 5% = 操作稳定；> 10% 持续=进入挣扎区（看「能力」是否被同步压低、F(t) 是否抬到 0.55+）。成段抬升通常预告"动量"将由正转负。'
    },
    {
        key: 'thinkMs',
        label: '思考',
        group: 'ability',
        extract: ps => ps.metrics?.thinkMs,
        fmt: 'int',
        tooltip: '平均思考时间（毫秒）：从候选块出现到落子的间隔。过长可能推高焦虑与负荷；过短可能进入无聊区，均会参与心流判断。\n📈 看图：1000~3000ms = 健康决策；> 8000ms 持续 + 高负荷 → 触发"简化决策"卡；< 500ms 持续 + 高消行率 → 倾向 bored，触发"提升挑战"卡。'
    },
    {
        key: 'feedbackBias',
        label: '闭环',
        group: 'spawn',
        extract: ps => ps.feedbackBias,
        fmt: 'f3',
        tooltip: '闭环反馈偏差：上一轮出新块后，在短窗口内实际消行相对「预期」的差值。为正表示好于预期可略加压；为负表示不及预期应减压，用于微调下一轮投放。\n📈 看图：典型范围 -0.2 ~ +0.2；正向连片=玩家"超预期顺"，stress 会微涨；负向连片=投放预期失准，会微减压。该曲线是"系统自我反思"的信号——不该长期偏离 0。'
    },
    /* ── v1.13：stress 细分构成曲线 ─────────────────────────────────────────────
     * 把原本只在 stressMeter「主要构成 · 当前帧」列表里出现的 5~6 项核心分量也曲线化，
     * 与上方 12 项指标统一为同一组 sparkline。这样：
     *   1) 玩家可以在时间轴上观察"难度模式 / 心流 / 节奏 / 友好盘面 / 会话弧线 / 挑战"等
     *      具体分量随局势的演化（而不是只看综合 stress 一根曲线）；
     *   2) 回放时游标滑动同步显示每帧分量值，免去频繁展开 details 列表；
     *   3) stressMeter 内的 details 区块同步移除（信息已并入此处），减少视觉冗余。
     *
     * 选取标准（覆盖最高频出现 + 调参时优先关注）：
     *   - difficultyBias：玩家选难度直接产生的固定偏移，几乎每帧都有
     *   - flowAdjust：心流偏移（boredom/anxiety）方向修正，反映挑战与能力匹配度
     *   - pacingAdjust：节奏阶段（setup/payoff）切换带来的微调
     *   - friendlyBoardRelief：盘面整洁 + 兑现窗口时的主动减压（v1.13 新机制）
     *   - sessionArcAdjust：会话弧线（warmup/peak/cooldown）整体节奏
     *   - challengeBoost：逼近历史最佳分时的挑战加压（B 类挑战）
     * 其余分量（recoveryAdjust / frustrationRelief / nearMissAdjust 等）出现稀疏，曲线
     * 大多为 0，曲线区会被稀疏点稀释；保留 stressMeter 内 summarizeContributors 函数与
     * SIGNAL_LABELS，未来如需补全只需在此追加。
     *
     * 数据源：v1.13 起 buildPlayerStateSnapshot 已把 a.stressBreakdown 写入 ps.adaptive。
     * 老回放（pv=2 早期无该字段）→ extract 返回 undefined，collectSeriesFromSnapshots 自动
     * 跳过空点，曲线显示空（无填充），不会报错。
     */
    {
        key: 'difficultyBias',
        label: '难度',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.difficultyBias,
        fmt: 'f2',
        tooltip: '难度模式偏移：玩家选简单/普通/困难带来的整体 stress 偏移（简单约 -0.22、普通 0、困难约 +0.22），是 stress 的最稳定分量。\n📈 看图：本局内若未切换难度，应是一条水平直线；出现台阶=玩家中途切换了难度。是 stress 的"基线偏移"，其余 5 条分量在它之上加减。'
    },
    {
        key: 'flowAdjust',
        label: '心流',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.flowAdjust,
        fmt: 'f2',
        tooltip: '心流偏移修正：F(t) 偏向无聊（玩家觉得太简单）→ 加压；偏向焦虑 → 减压。绝对值越大说明系统越主动调整难度。\n📈 看图：与「F(t)」+「消行率」共看——F(t)>0.55 + clearRate>42% → 正向（加压抗 bored）；F(t)>0.55 + clearRate<30% → 负向（减压救 anxious）。值贴近 0 = 玩家在沉浸区，无需主动干预。'
    },
    {
        key: 'pacingAdjust',
        // v1.20：原标签"节奏"与右侧 spawnHints.rhythmPhase pill 的「节奏 收获/中性/搭建」
        // 撞名（同名不同概念：rhythmPhase 是"相位"枚举、pacingAdjust 是"松紧"数值微调），
        // 改用「松紧」与 rhythmPhase 解耦，对应 stressBreakdown 中节奏阶段对 stress 的实际偏移量。
        label: '松紧',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.pacingAdjust,
        fmt: 'f2',
        tooltip: '节奏松紧（pacingAdjust）：搭建期(setup) 略加压、收获期(payoff) 略减压（让多消爽点更易触发），中性时为 0。⚠ 与右侧「节奏 收获/中性/搭建」pill（rhythmPhase 相位枚举）不同——那是"现在处于什么阶段"，本指标是"该阶段对 stress 的具体偏移量"。\n📈 看图：典型范围 -0.05 ~ +0.05，呈"短脉冲"式跳变；与右侧 rhythmPhase pill 切换同步——pill 切到「收获」此值通常变负、切到「搭建」通常变正。'
    },
    {
        key: 'friendlyBoardRelief',
        label: '救济',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.friendlyBoardRelief,
        fmt: 'f2',
        tooltip: '友好盘面救济（v1.13）：当盘面整洁 + 多消候选丰富时主动降压，让玩家享受多消爽点。常为负值。\n📈 看图：典型范围 -0.15 ~ 0；负向"凹陷"=系统判定盘面友好、主动降压"喂"多消（与「板面」走低、「多消候选」走高同步）。长期为 0 = 盘面没出现可兑现窗口。'
    },
    {
        key: 'sessionArcAdjust',
        label: '会话',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.sessionArcAdjust,
        fmt: 'f2',
        tooltip: '会话弧线整体节奏：热身期减压、巅峰期加压、收官期略减压，按本局阶段比例插值。\n📈 看图：单局内呈"半圆弧"——开头负（热身减压）→ 中段正（巅峰加压）→ 结尾微负（收官缓和）。与左上「session 阶段」tag (early/peak/late) 严格对应。'
    },
    {
        key: 'challengeBoost',
        label: '挑战',
        group: 'stress',
        extract: ps => ps.adaptive?.stressBreakdown?.challengeBoost,
        fmt: 'f2',
        tooltip: 'B 类挑战加压：当前分数逼近历史最佳分时主动略加压，让收尾更有仪式感；远离最佳分为 0。\n📈 看图：触发条件是 score ≥ bestScore × 0.8 且 stress < 0.7（公式 min(0.15, (score/best - 0.8) × 0.75)）。在到达 80% 阈值前曲线恒为 0 是预期；从 0 抬到正值说明你正在冲击新高、系统要把节奏推到"决赛圈"。同时会把 spawnIntent 切到 pressure。本局最佳为 0 时（首局）也恒为 0。'
    }
];

/**
 * 从全部帧中提取各关键指标的时间序列，供 sparkline 渲染。
 * @param {object[]} frames
 * @returns {{ series: Record<string, { label:string, group:string, fmt:string, points:{idx:number,value:number}[] }>, totalFrames:number, metrics: typeof REPLAY_METRICS } | null}
 */
export function collectReplayMetricsSeries(frames) {
    if (!Array.isArray(frames) || frames.length === 0) return null;
    const totalFrames = frames.length;
    /** @type {Record<string, { label:string, group:string, fmt:string, points:{idx:number,value:number}[] }>} */
    const series = {};
    for (const m of REPLAY_METRICS) {
        series[m.key] = { label: m.label, group: m.group, fmt: m.fmt, points: [] };
    }
    for (let i = 0; i < totalFrames; i++) {
        const ps = frames[i]?.ps;
        if (!ps || typeof ps !== 'object') continue;
        for (const m of REPLAY_METRICS) {
            const v = m.extract(ps);
            if (v != null && !Number.isNaN(Number(v))) {
                series[m.key].points.push({ idx: i, value: Number(v) });
            }
        }
    }
    let hasData = false;
    for (const key in series) {
        if (series[key].points.length > 0) { hasData = true; break; }
    }
    if (!hasData) return null;
    return { series, totalFrames, metrics: REPLAY_METRICS };
}

/**
 * 由本局内顺序快照（结构与 `buildPlayerStateSnapshot` / `frames[].ps` 一致）计算序列，供实时面板。
 * @param {object[]} snapshots
 * @returns {{ series: Record<string, { label:string, group:string, fmt:string, points:{idx:number,value:number}[] }>, totalFrames:number, metrics: typeof REPLAY_METRICS } | null}
 */
export function collectSeriesFromSnapshots(snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
        return null;
    }
    const totalFrames = snapshots.length;
    /** @type {Record<string, { label:string, group:string, fmt:string, points:{idx:number,value:number}[] }>} */
    const series = {};
    for (const m of REPLAY_METRICS) {
        series[m.key] = { label: m.label, group: m.group, fmt: m.fmt, points: [] };
    }
    for (let i = 0; i < totalFrames; i++) {
        const ps = snapshots[i];
        if (!ps || typeof ps !== 'object') {
            continue;
        }
        for (const m of REPLAY_METRICS) {
            const v = m.extract(ps);
            if (v != null && !Number.isNaN(Number(v))) {
                series[m.key].points.push({ idx: i, value: Number(v) });
            }
        }
    }
    let hasData = false;
    for (const key in series) {
        if (series[key].points.length > 0) {
            hasData = true;
            break;
        }
    }
    if (!hasData) {
        return null;
    }
    return { series, totalFrames, metrics: REPLAY_METRICS };
}

/**
 * 从玩家状态快照中提取单个指标值。
 * @param {object|null} ps
 * @param {string} key
 * @returns {number|null}
 */
export function getMetricFromPS(ps, key) {
    if (!ps) return null;
    const m = REPLAY_METRICS.find(d => d.key === key);
    if (!m) return null;
    const v = m.extract(ps);
    return v != null && !Number.isNaN(Number(v)) ? Number(v) : null;
}

/**
 * @param {number|null|undefined} value
 * @param {string} fmt
 * @returns {string}
 */
export function formatMetricValue(value, fmt) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    switch (fmt) {
        case 'pct': return Math.round(n * 100) + '%';
        case 'int': return String(Math.round(n));
        case 'f2':  return n.toFixed(2);
        case 'f3':  return (n >= 0 ? '+' : '') + n.toFixed(3);
        default:    return Number.isInteger(n) ? String(n) : n.toFixed(2);
    }
}
