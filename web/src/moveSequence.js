/**
 * 对局落子序列（schema v1）：与后端 `move_sequences.frames` 一致，供持久化与确定性回放。
 * 可选字段 `ps`：玩家状态快照（见 PLAYER_STATE_SNAPSHOT_VERSION），旧记录无此字段仍可回放盘面。
 */
import { Grid } from './grid.js';

export const MOVE_SEQUENCE_SCHEMA = 1;
/** 玩家状态快照内部版本，便于日后扩展字段 */
export const PLAYER_STATE_SNAPSHOT_VERSION = 1;
/** 至少多少帧才写入 SQLite（含 init/spawn/place）；过短对局视为无效，不占用回放列表 */
export const MIN_PERSIST_MOVE_FRAMES = 5;

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
        cognitiveLoad: profile.cognitiveLoad,
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
        metrics: {
            thinkMs: m.thinkMs,
            clearRate: m.clearRate,
            comboRate: m.comboRate,
            missRate: m.missRate,
            afkCount: m.afkCount
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
            spawnHints: a.spawnHints ?? null,
            shapeWeightsTop: a.shapeWeightsTop ?? null
        };
    }
    return slim;
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
    const lines = [
        `阶段 ${phase} · 得分 ${ps.score ?? '—'} · 填充 ${ps.boardFill != null ? (Number(ps.boardFill) * 100).toFixed(1) + '%' : '—'}${lc}`,
        `技能 ${num(ps.skill)} · 心流 ${ps.flowState ?? '—'} · F ${num(ps.flowDeviation)} · 动量 ${num(ps.momentum)}`,
        `节奏 ${ps.pacingPhase ?? '—'} · 挫败 ${ps.frustration ?? '—'} · 会话 ${ps.sessionPhase ?? '—'} · 轮次 ${ps.spawnRound ?? '—'}`,
        `思考 ${num(ps.metrics?.thinkMs)}ms · 消行率 ${num(ps.metrics?.clearRate)} · 闭环 ${num(ps.feedbackBias)}`
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

function scoreForClears(count, scoring) {
    if (count <= 0) {
        return 0;
    }
    if (count === 1) {
        return scoring.singleLine;
    }
    if (count === 2) {
        return scoring.multiLine;
    }
    return scoring.combo + (count - 2) * scoring.multiLine;
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
            score += scoreForClears(result.count, scoring);
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
    return JSON.stringify({ grid: st.gridJSON, dock: st.dockDescriptors });
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
