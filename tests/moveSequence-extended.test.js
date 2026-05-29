/**
 * @vitest-environment node
 *
 * moveSequence 补充测试：buildPlayerStateSnapshot / collectReplayMetricsSeries /
 * formatMetricValue / countPlaceStepsInFrames 边界
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    buildInitFrame,
    buildSpawnFrame,
    buildPlaceFrame,
    buildPlayerStateSnapshot,
    buildReplayAnalysis,
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    collectReplayMetricsSeries,
    formatMetricValue,
    formatPlayerStateForReplay,
    getMetricFromPS,
    getFrameElapsedMs,
    extractFrameTimestamps,
    MOVE_SEQUENCE_SCHEMA,
    PLAYER_STATE_SNAPSHOT_VERSION
} from '../web/src/moveSequence.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

const scoring = { singleLine: 10, multiLine: 30, combo: 50 };

describe('buildPlayerStateSnapshot', () => {
    it('produces a snapshot with required fields', () => {
        const profile = new PlayerProfile(10);
        const ctx = {
            score: 100,
            boardFill: 0.4,
            runStreak: 1,
            strategyId: 'normal',
            phase: 'spawn',
            adaptiveInsight: null
        };
        const ps = buildPlayerStateSnapshot(profile, ctx);
        expect(ps.pv).toBe(PLAYER_STATE_SNAPSHOT_VERSION);
        expect(ps.pv).toBe(3);
        expect(ps.phase).toBe('spawn');
        expect(ps.score).toBe(100);
        expect(typeof ps.skill).toBe('number');
        expect(typeof ps.momentum).toBe('number');
        expect(typeof ps.flowState).toBe('string');
    });

    it('includes adaptive data when provided', () => {
        const profile = new PlayerProfile(10);
        const ctx = {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init',
            adaptiveInsight: { stress: 0.3, flowDeviation: 0.1 }
        };
        const ps = buildPlayerStateSnapshot(profile, ctx);
        expect(ps.adaptive).toBeDefined();
        expect(ps.adaptive.stress).toBe(0.3);
    });

    // v1.63 / pv=3：PB 相对进度基线
    it('写入 bestScore 并推导 pbRatio=score/bestScore（best<=0 时 pbRatio=null）', () => {
        const profile = new PlayerProfile(10);
        const base = { boardFill: 0, runStreak: 0, strategyId: 'normal', phase: 'spawn', adaptiveInsight: null };
        const ps = buildPlayerStateSnapshot(profile, { ...base, score: 300, bestScore: 1000 });
        expect(ps.bestScore).toBe(1000);
        expect(ps.pbRatio).toBeCloseTo(0.3, 6);
        // 首局 best=0 → bestScore=null、pbRatio=null（避免除零）
        const ps0 = buildPlayerStateSnapshot(profile, { ...base, score: 300, bestScore: 0 });
        expect(ps0.bestScore).toBeNull();
        expect(ps0.pbRatio).toBeNull();
    });

    // v1.63 / pv=3：近消行拓扑落库（dataset behaviorContext[28-30] 此前恒 0）
    it('spawnGeo 写入 nearFullLines/close1/close2/maxColHeight', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0.2, runStreak: 0, strategyId: 'normal', phase: 'spawn',
            adaptiveInsight: null,
            spawnGeo: { holes: 1, nearFullLines: 3, close1: 2, close2: 1, maxColHeight: 5 }
        });
        expect(ps.spawnGeo.nearFullLines).toBe(3);
        expect(ps.spawnGeo.close1).toBe(2);
        expect(ps.spawnGeo.close2).toBe(1);
        expect(ps.spawnGeo.maxColHeight).toBe(5);
    });

    // v1.63 / pv=3：逐 spawn 策略来源（provenance）
    it('当 adaptiveInsight.provenance 存在时拷贝到快照', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal', phase: 'spawn',
            adaptiveInsight: { stress: 0.1, provenance: { spawnSource: 'model-v3', fallbackReason: null } }
        });
        expect(ps.provenance).toEqual({ spawnSource: 'model-v3', fallbackReason: null });
    });

    // v1.13 / pv=2 冷启动隔离
    it('冷启动帧：metrics 数值字段为 null，coldStart=true，samples=0', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init', adaptiveInsight: null
        });
        expect(ps.coldStart).toBe(true);
        expect(ps.cognitiveLoadHasData).toBe(false);
        expect(ps.cognitiveLoad).toBeNull();
        expect(ps.metrics.samples).toBe(0);
        expect(ps.metrics.activeSamples).toBe(0);
        expect(ps.metrics.thinkMs).toBeNull();
        expect(ps.metrics.clearRate).toBeNull();
        expect(ps.metrics.comboRate).toBeNull();
        expect(ps.metrics.missRate).toBeNull();
    });

    it('落子≥3 之后：coldStart=false，metrics 全为有限数值', () => {
        const profile = new PlayerProfile(10);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        expect(ps.coldStart).toBe(false);
        expect(ps.cognitiveLoadHasData).toBe(true);
        expect(typeof ps.cognitiveLoad).toBe('number');
        expect(ps.metrics.samples).toBeGreaterThanOrEqual(4);
        expect(typeof ps.metrics.thinkMs).toBe('number');
        expect(typeof ps.metrics.clearRate).toBe('number');
    });
});

describe('formatPlayerStateForReplay 冷启动徽标', () => {
    it('pv=2 冷启动帧带 🌱 前缀，思考/消行率显「—」', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init', adaptiveInsight: null
        });
        const txt = formatPlayerStateForReplay(ps);
        expect(txt).toContain('🌱 冷启动');
        expect(txt).toContain('思考 —ms');
        expect(txt).toContain('消行率 —');
    });

    it('落子后无 🌱 徽标，思考/消行率显示真实数值', () => {
        const profile = new PlayerProfile(10);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        const txt = formatPlayerStateForReplay(ps);
        expect(txt).not.toContain('🌱 冷启动');
        expect(txt).not.toContain('思考 —ms');
    });

    it('pv=1 旧记录的占位组合（thinkMs=3000 + clearRate=0.3）按启发式标记为冷启动', () => {
        const legacyPs = {
            phase: 'init', score: 0, boardFill: 0,
            metrics: { thinkMs: 3000, clearRate: 0.3, comboRate: 0.1, missRate: 0.1 }
        };
        expect(formatPlayerStateForReplay(legacyPs)).toContain('🌱 冷启动');
    });
});

describe('buildReplayAnalysis 冷启动统计', () => {
    it('全部冷启动帧：coldFramesRatio=1，tags 含「冷启动样本偏多」', () => {
        const profile = new PlayerProfile(10);
        const grid = new Grid(8);
        const psCold = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'spawn', adaptiveInsight: null
        });
        const initFrame = buildInitFrame('normal', grid, scoring, psCold);
        const spawnFrame = buildSpawnFrame([], psCold);
        const analysis = buildReplayAnalysis([initFrame, spawnFrame], { score: 0 });
        expect(analysis.metrics.coldFrames).toBe(2);
        expect(analysis.metrics.coldFramesRatio).toBe(1);
        expect(analysis.metrics.firstWarmFrameIdx).toBeNull();
        expect(analysis.tags).toContain('冷启动样本偏多');
        expect(analysis.recommendations.some((r) => r.includes('冷启动占位状态'))).toBe(true);
    });

    it('热身后样本充足：coldFramesRatio=0、firstWarmFrameIdx 指向首帧', () => {
        const profile = new PlayerProfile(10);
        const grid = new Grid(8);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const psWarm = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        const frames = [
            buildInitFrame('normal', grid, scoring, psWarm),
            buildSpawnFrame([], psWarm),
            buildPlaceFrame(0, 0, 0, psWarm)
        ];
        const analysis = buildReplayAnalysis(frames, { score: 40 });
        expect(analysis.metrics.coldFrames).toBe(0);
        expect(analysis.metrics.coldFramesRatio).toBe(0);
        expect(analysis.metrics.firstWarmFrameIdx).toBe(0);
        expect(analysis.tags).not.toContain('冷启动样本偏多');
    });
});

describe('countPlaceStepsInFrames edge cases', () => {
    it('null / undefined returns 0', () => {
        expect(countPlaceStepsInFrames(null)).toBe(0);
        expect(countPlaceStepsInFrames(undefined)).toBe(0);
    });

    it('empty array returns 0', () => {
        expect(countPlaceStepsInFrames([])).toBe(0);
    });

    it('only init+spawn returns 0', () => {
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([])
        ];
        expect(countPlaceStepsInFrames(frames)).toBe(0);
    });
});

describe('displayScoreFromReplayFrames edge cases', () => {
    it('null returns null', () => {
        expect(displayScoreFromReplayFrames(null)).toBeNull();
    });

    it('empty returns null', () => {
        expect(displayScoreFromReplayFrames([])).toBeNull();
    });

    it('frames without ps fallback to replayStateAt', () => {
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }]),
            buildPlaceFrame(0, 0, 0)
        ];
        const score = displayScoreFromReplayFrames(frames);
        expect(typeof score).toBe('number');
    });
});

describe('collectReplayMetricsSeries', () => {
    it('returns null for empty frames', () => {
        expect(collectReplayMetricsSeries([])).toBeNull();
        expect(collectReplayMetricsSeries(null)).toBeNull();
    });

    it('produces series data for frames with ps', () => {
        const grid = new Grid(8);
        const ps1 = { pv: 1, phase: 'init', score: 0, skill: 0.5, boardFill: 0, metrics: {} };
        const ps2 = { pv: 1, phase: 'spawn', score: 0, skill: 0.52, boardFill: 0.1, metrics: {} };
        const ps3 = { pv: 1, phase: 'place', score: 10, skill: 0.55, boardFill: 0.15, metrics: { clearRate: 0.5 } };
        const frames = [
            buildInitFrame('normal', grid, scoring, ps1),
            buildSpawnFrame([{ id: 'a', shape: [[1]], colorIdx: 0 }], ps2),
            buildPlaceFrame(0, 0, 0, ps3)
        ];
        const result = collectReplayMetricsSeries(frames);
        expect(result).not.toBeNull();
        expect(result.totalFrames).toBe(3);
        expect(result.series).toBeDefined();
        expect(result.series.score).toBeDefined();
        expect(result.series.score.points.length).toBeGreaterThan(0);
    });
});

describe('formatMetricValue', () => {
    it('int format', () => {
        expect(formatMetricValue(42, 'int')).toBe('42');
        expect(formatMetricValue(null, 'int')).toBe('—');
    });

    it('pct format', () => {
        const r = formatMetricValue(0.456, 'pct');
        expect(r).toBe('46%');
    });

    it('f2 format', () => {
        expect(formatMetricValue(0.1234, 'f2')).toBe('0.12');
    });
});

describe('getMetricFromPS', () => {
    it('extracts top-level field', () => {
        expect(getMetricFromPS({ score: 100 }, 'score')).toBe(100);
    });

    it('returns null for missing field', () => {
        expect(getMetricFromPS({}, 'score')).toBeNull();
    });
});

/* ============================================================
 * v1.62：frame.ts 时间戳 — schema 升级 + 提取工具
 * ============================================================ */

describe('MOVE_SEQUENCE_SCHEMA v2 / frame.ts', () => {
    const grid = new Grid(8);

    it('SCHEMA 升级到 2，承诺 frames 携带 ts 字段', () => {
        expect(MOVE_SEQUENCE_SCHEMA).toBe(2);
    });

    it('buildInitFrame 默认 ts=0（init 帧总是时间原点）', () => {
        const init = buildInitFrame('normal', grid, scoring);
        expect(init.v).toBe(2);
        expect(init.ts).toBe(0);
    });

    it('buildInitFrame 显式 ts 也被采纳；负数 / NaN / 非数 → 强制回退 0', () => {
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: 1234 }).ts).toBe(1234);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: -5 }).ts).toBe(0);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: NaN }).ts).toBe(0);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: 'bad' }).ts).toBe(0);
    });

    it('buildSpawnFrame / buildPlaceFrame 未传 ts 时不写字段（保持与 v1 字节级兼容）', () => {
        const spawn = buildSpawnFrame([]);
        const place = buildPlaceFrame(0, 0, 0);
        expect('ts' in spawn).toBe(false);
        expect('ts' in place).toBe(false);
    });

    it('buildSpawnFrame / buildPlaceFrame 接受 ts 入参', () => {
        const spawn = buildSpawnFrame([], undefined, { ts: 1500 });
        const place = buildPlaceFrame(0, 0, 0, undefined, { ts: 2800 });
        expect(spawn.ts).toBe(1500);
        expect(place.ts).toBe(2800);
    });

    it('build*Frame 静默丢弃无效 ts（不写入错误时间戳）', () => {
        expect('ts' in buildSpawnFrame([], undefined, { ts: -1 })).toBe(false);
        expect('ts' in buildSpawnFrame([], undefined, { ts: NaN })).toBe(false);
        expect('ts' in buildPlaceFrame(0, 0, 0, undefined, { ts: 'oops' })).toBe(false);
    });

    it('ts 与 playerState 可并存（顺序无歧义）', () => {
        const ps = { pv: 2, phase: 'place', score: 42 };
        const place = buildPlaceFrame(0, 1, 2, ps, { ts: 9999 });
        expect(place.ts).toBe(9999);
        expect(place.ps).toEqual(ps);
    });

    // v1.63 / pv=3：spawn 帧逐块 feat + 帧级 spawnMeta
    it('buildSpawnFrame 写入逐块 feat 与帧级 spawnMeta', () => {
        const spawn = buildSpawnFrame(
            [{ id: '1x4', shape: [[1, 1, 1, 1]], colorIdx: 0, feat: { placements: 12, gapFills: 1, multiClear: 2, pcPotential: 0, exactFit: 1, monoFlush: 0, topDriver: 'clear' } }],
            undefined,
            { ts: 100, spawnMeta: { attempt: 2, fallback: false, solutionRejects: { tooFew: 1 } } }
        );
        expect(spawn.dock[0].feat).toEqual({
            placements: 12, gapFills: 1, multiClear: 2, pcPotential: 0, exactFit: 1, monoFlush: 0, topDriver: 'clear'
        });
        expect(spawn.spawnMeta).toEqual({ attempt: 2, fallback: false, solutionRejects: { tooFew: 1 } });
    });

    it('buildSpawnFrame 无 feat / spawnMeta 时保持旧结构（向后兼容）', () => {
        const spawn = buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0 }]);
        expect('feat' in spawn.dock[0]).toBe(false);
        expect('spawnMeta' in spawn).toBe(false);
    });
});

describe('getFrameElapsedMs', () => {
    it('返回 v2 frame.ts', () => {
        expect(getFrameElapsedMs({ t: 'spawn', ts: 1234 })).toBe(1234);
        expect(getFrameElapsedMs({ t: 'init', ts: 0 })).toBe(0);
    });

    it('v1 老帧（无 ts） → null', () => {
        expect(getFrameElapsedMs({ t: 'spawn' })).toBeNull();
    });

    it('非有限值 → null', () => {
        expect(getFrameElapsedMs(null)).toBeNull();
        expect(getFrameElapsedMs(undefined)).toBeNull();
        expect(getFrameElapsedMs({ ts: NaN })).toBeNull();
        expect(getFrameElapsedMs({ ts: -1 })).toBeNull();
    });
});

describe('extractFrameTimestamps', () => {
    const grid = new Grid(8);

    it('空 / null → 空数组', () => {
        expect(extractFrameTimestamps([])).toEqual({ startMs: null, frameTimestamps: [] });
        expect(extractFrameTimestamps(null)).toEqual({ startMs: null, frameTimestamps: [] });
    });

    it('v2 frames：每帧 ts 直接成数组，startMs=0', () => {
        const frames = [
            buildInitFrame('normal', grid, scoring, undefined, { ts: 0 }),
            buildSpawnFrame([], undefined, { ts: 1200 }),
            buildPlaceFrame(0, 0, 0, undefined, { ts: 2400 }),
            buildPlaceFrame(0, 1, 0, undefined, { ts: 3600 }),
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(0);
        expect(frameTimestamps).toEqual([0, 1200, 2400, 3600]);
    });

    it('v1 老 frames：无 ts、无 ps._recordedAt → 全部 null', () => {
        const frames = [
            { v: 1, t: 'init' },
            { v: 1, t: 'spawn' },
            { v: 1, t: 'place', i: 0, x: 0, y: 0 },
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBeNull();
        expect(frameTimestamps).toEqual([null, null, null]);
    });

    it('wall-clock 后备：ps._recordedAt 模式（live 历史），相对首个 _recordedAt 算偏移', () => {
        const frames = [
            { t: 'live', ps: { _recordedAt: 1_700_000_000_000 } },
            { t: 'live', ps: { _recordedAt: 1_700_000_005_000 } },
            { t: 'live', ps: { _recordedAt: 1_700_000_012_000 } },
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(1_700_000_000_000);
        expect(frameTimestamps).toEqual([0, 5_000, 12_000]);
    });

    it('混合：部分 v2 ts + 部分缺失时间戳 → 缺失位置 null', () => {
        const frames = [
            buildInitFrame('normal', grid, scoring, undefined, { ts: 0 }),
            buildSpawnFrame([], undefined, { ts: 1000 }),
            { t: 'place', i: 0, x: 0, y: 0 }, // 无 ts
            buildPlaceFrame(0, 1, 0, undefined, { ts: 3000 }),
        ];
        const { frameTimestamps } = extractFrameTimestamps(frames);
        // 有 v2 ts 的 4 帧 → 走 v2 直通路径；缺失的 1 帧在 v2 路径中会让整组走 wall-clock 后备
        // 第 3 帧无 ts 且无 _recordedAt → null
        expect(frameTimestamps[0]).toBe(0);
        expect(frameTimestamps[1]).toBe(1000);
        expect(frameTimestamps[2]).toBeNull();
        expect(frameTimestamps[3]).toBe(3000);
    });

    it('保护：ts 异常大（>1e12 当成 wall-clock 而非偏移）时走后备', () => {
        const frames = [
            { t: 'init', ts: 1_700_000_000_000 },
            { t: 'spawn', ts: 1_700_000_005_000 },
        ];
        // 这两个 ts 都 > 1e12（wall-clock），不应被当成"相对 0 的 1.7 万亿 ms"
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(1_700_000_000_000);
        expect(frameTimestamps).toEqual([0, 5_000]);
    });
});
