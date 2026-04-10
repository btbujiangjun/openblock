/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    buildInitFrame,
    buildSpawnFrame,
    buildPlaceFrame,
    displayScoreFromReplayFrames,
    getPlayerStateAtFrameIndex,
    nextDistinctReplayFrameIndex,
    replayStateAt,
    replayVisualSignature
} from '../web/src/moveSequence.js';

describe('moveSequence replay', () => {
    it('replays init then spawn then one place with clear', () => {
        const grid = new Grid(8);
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 8; x++) {
                grid.cells[y][x] = 1;
            }
        }
        for (let x = 0; x < 4; x++) {
            grid.cells[7][x] = 1;
        }
        for (let x = 4; x < 8; x++) {
            grid.cells[7][x] = null;
        }
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([
                { id: '1x4', shape: [[1, 1, 1, 1]], colorIdx: 0, placed: false }
            ])
        ];
        frames.push(buildPlaceFrame(0, 4, 7));

        const st = replayStateAt(frames, frames.length - 1);
        expect(st).not.toBeNull();
        /* 末行填满后共 8 整行 + 8 整列 → 16 线；combo + 14×multiLine = 50 + 420 = 470 */
        expect(st.score).toBe(470);
        expect(st.dockDescriptors.length).toBe(1);
        expect(st.dockDescriptors[0].placed).toBe(true);
    });

    it('getPlayerStateAtFrameIndex walks back for legacy frames without ps', () => {
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const grid = new Grid(8);
        const init = buildInitFrame('normal', grid, scoring, { pv: 1, phase: 'init', skill: 0.5 });
        const spawn = buildSpawnFrame([], { pv: 1, phase: 'spawn', skill: 0.6 });
        const place = buildPlaceFrame(0, 0, 0);
        const frames = [init, spawn, place];
        expect(getPlayerStateAtFrameIndex(frames, 2)?.phase).toBe('spawn');
        expect(getPlayerStateAtFrameIndex(frames, 1)?.phase).toBe('spawn');
        expect(getPlayerStateAtFrameIndex(frames, 0)?.phase).toBe('init');
    });

    it('displayScoreFromReplayFrames prefers ps.score then replayStateAt', () => {
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }]),
            buildPlaceFrame(0, 0, 0, { score: 200, phase: 'place' })
        ];
        expect(displayScoreFromReplayFrames(frames)).toBe(200);

        const noPs = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }]),
            buildPlaceFrame(0, 0, 0)
        ];
        expect(displayScoreFromReplayFrames(noPs)).toBe(replayStateAt(noPs, noPs.length - 1)?.score ?? null);
    });

    it('replayVisualSignature differs after spawn (dock) even if grid unchanged', () => {
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }])
        ];
        expect(replayVisualSignature(frames, 0)).not.toBe(replayVisualSignature(frames, 1));
        expect(nextDistinctReplayFrameIndex(frames, 0, 1)).toBe(1);
    });
});
