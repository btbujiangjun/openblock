/**
 * 对局落子序列（schema v1）：与后端 `move_sequences.frames` 一致，供持久化与确定性回放。
 */
import { Grid } from './grid.js';

export const MOVE_SEQUENCE_SCHEMA = 1;

/**
 * @param {string} strategy
 * @param {import('./grid.js').Grid} grid
 * @param {{ singleLine: number, multiLine: number, combo: number }} scoring
 */
export function buildInitFrame(strategy, grid, scoring) {
    return {
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
}

/**
 * @param {Array<{ id: string, shape: number[][], colorIdx: number, placed?: boolean }>} descriptors
 */
export function buildSpawnFrame(descriptors) {
    return {
        v: MOVE_SEQUENCE_SCHEMA,
        t: 'spawn',
        dock: descriptors.map((d) => ({
            id: d.id,
            shape: d.shape.map((row) => [...row]),
            colorIdx: d.colorIdx,
            placed: Boolean(d.placed)
        }))
    };
}

/** @param {number} dockIndex @param {number} gx @param {number} gy */
export function buildPlaceFrame(dockIndex, gx, gy) {
    return {
        v: MOVE_SEQUENCE_SCHEMA,
        t: 'place',
        i: dockIndex,
        x: gx,
        y: gy
    };
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
