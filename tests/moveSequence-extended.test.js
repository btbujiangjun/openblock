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
        expect(ps.pv).toBe(2);
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
