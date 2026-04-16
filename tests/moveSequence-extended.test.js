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
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    collectReplayMetricsSeries,
    formatMetricValue,
    getMetricFromPS,
    REPLAY_METRICS
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
        expect(ps.pv).toBe(1);
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
