import { describe, expect, it } from 'vitest';
import {
    buildInitFrame,
    buildPlaceFrame,
    buildSpawnFrame,
    countPlaceStepsInFrames,
    MIN_PERSIST_PLACE_STEPS,
} from '../web/src/moveSequence.js';
import { Grid } from '../web/src/grid.js';

describe('move sequence frame semantics', () => {
    it('只把成功落子 place 计为产品展示帧', () => {
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, { singleLine: 20, multiLine: 60, combo: 120 }),
            buildSpawnFrame([{ id: 'a', shape: [[1]], colorIdx: 0 }]),
            buildPlaceFrame(0, 0, 0),
            buildSpawnFrame([{ id: 'b', shape: [[1]], colorIdx: 1 }]),
            buildPlaceFrame(0, 1, 0),
        ];

        expect(frames).toHaveLength(5);
        expect(countPlaceStepsInFrames(frames)).toBe(2);
        expect(MIN_PERSIST_PLACE_STEPS).toBe(5);
    });
});
/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    buildInitFrame,
    buildSpawnFrame,
    buildPlaceFrame,
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    getPlayerStateAtFrameIndex,
    nextDistinctReplayFrameIndex,
    replayStateAt,
    replayVisualSignature
} from '../web/src/moveSequence.js';

describe('moveSequence replay', () => {
    it('countPlaceStepsInFrames counts only place frames', () => {
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([
                { id: 'a', shape: [[1]], colorIdx: 0, placed: false },
                { id: 'b', shape: [[1]], colorIdx: 0, placed: false },
                { id: 'c', shape: [[1]], colorIdx: 0, placed: false }
            ]),
            buildPlaceFrame(0, 0, 0),
            buildPlaceFrame(1, 1, 0),
            buildPlaceFrame(2, 2, 0)
        ];
        expect(frames.length).toBe(5);
        expect(countPlaceStepsInFrames(frames)).toBe(3);
    });

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

    it('replayVisualSignature is grid-only: spawn without place keeps same grid signature', () => {
        const scoring = { singleLine: 10, multiLine: 30, combo: 50 };
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }])
        ];
        expect(replayVisualSignature(frames, 0)).toBe(replayVisualSignature(frames, 1));
        /* 无新盘面变化时自动播放跳到区间末尾 */
        expect(nextDistinctReplayFrameIndex(frames, 0, 1)).toBe(1);
    });
});
