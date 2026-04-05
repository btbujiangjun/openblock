/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { buildInitFrame, buildSpawnFrame, buildPlaceFrame, replayStateAt } from '../web/src/moveSequence.js';

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
        expect(st.score).toBe(10);
        expect(st.dockDescriptors.length).toBe(1);
        expect(st.dockDescriptors[0].placed).toBe(true);
    });
});
