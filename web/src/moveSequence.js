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
        historicalSkill: profile.historicalSkill,
        trend: profile.trend,
        confidence: profile.confidence,
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
            trend: a.trend,
            confidence: a.confidence,
            historicalSkill: a.historicalSkill,
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
        tooltip: '本局累计得分。分数越高通常局面张力越大，也是自适应出块在「多档形状权重」之间切换的重要输入之一。'
    },
    {
        key: 'skill',
        label: '技能',
        group: 'ability',
        extract: ps => ps.skill,
        fmt: 'pct',
        tooltip: '综合技能估计（0～100%）：融合本局滑动窗口内的即时表现与历史长周期能力；越高表示系统认为玩家当前操作与决策水平越好，可略提高挑战。'
    },
    {
        key: 'boardFill',
        label: '板面',
        group: 'game',
        extract: ps => ps.boardFill,
        fmt: 'pct',
        tooltip: '棋盘占用率：已被方块占据的格子比例。越高表示剩余可落子空间越少、死局风险越大，恢复与救济型出块会更敏感。'
    },
    {
        key: 'clearRate',
        label: '消行率',
        group: 'ability',
        extract: ps => ps.metrics?.clearRate,
        fmt: 'pct',
        tooltip: '近期窗口内「落子后成功消行」的步数占比。越高说明玩家持续在有效清除行列，是衡量「打得顺」的核心能力指标之一。'
    },
    {
        key: 'stress',
        label: '压力',
        group: 'spawn',
        extract: ps => ps.adaptive?.stress,
        fmt: 'f2',
        tooltip: '自适应综合压力：由分数档、连战、技能、心流偏移、节奏、恢复需求、挫败、连击、近失、闭环反馈等信号叠加并钳制得到，用于在配置的多档形状权重之间插值。'
    },
    {
        key: 'flowDeviation',
        label: 'F(t)',
        group: 'state',
        extract: ps => ps.flowDeviation,
        fmt: 'f2',
        tooltip: '心流偏移 F(t)：衡量当前挑战强度与玩家能力匹配程度（0 为理想心流区）。数值升高多表示「偏难或焦虑」；降低多表示「偏易或无聊」，会驱动心流三态与压力微调。'
    },
    {
        key: 'momentum',
        label: '动量',
        group: 'state',
        extract: ps => ps.momentum,
        fmt: 'f2',
        tooltip: '动量：反映近期得分/消行是否处于上升趋势（正反馈累积）。为正时常略加压以延续爽感；为负时可能减压避免连跪挫败。'
    },
    {
        key: 'frustration',
        label: '未消行',
        group: 'state',
        extract: ps => ps.frustration,
        fmt: 'int',
        tooltip: '连续未消行的步数（挫败计数）。越大表示玩家越久没有有效清除，系统越倾向救济：降压、提高消行友好与偏小尺寸偏好。'
    },
    {
        key: 'cognitiveLoad',
        label: '负荷',
        group: 'state',
        extract: ps => ps.cognitiveLoad,
        fmt: 'pct',
        tooltip: '认知负荷：由思考时间、操作密度、局面复杂度等综合估计的决策压力。偏高时常略降难度或缩短「决策窗口」带来的压迫感。'
    },
    {
        key: 'missRate',
        label: '失误',
        group: 'ability',
        extract: ps => ps.metrics?.missRate,
        fmt: 'pct',
        tooltip: '近期窗口内坏手/无效放置占比。越高表示失误增多，常与减压、消行友好块型、恢复策略联动。'
    },
    {
        key: 'thinkMs',
        label: '思考',
        group: 'ability',
        extract: ps => ps.metrics?.thinkMs,
        fmt: 'int',
        tooltip: '平均思考时间（毫秒）：从候选块出现到落子的间隔。过长可能推高焦虑与负荷；过短可能进入无聊区，均会参与心流判断。'
    },
    {
        key: 'feedbackBias',
        label: '闭环',
        group: 'spawn',
        extract: ps => ps.feedbackBias,
        fmt: 'f3',
        tooltip: '闭环反馈偏差：上一轮出新块后，在短窗口内实际消行相对「预期」的差值。为正表示好于预期可略加压；为负表示不及预期应减压，用于微调下一轮投放。'
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
