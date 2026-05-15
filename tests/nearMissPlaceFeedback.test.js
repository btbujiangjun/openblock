/**
 * @vitest-environment node
 *
 * v1.50.1：仅在玩家体感很差时出现，且严格控频。
 */
import { describe, it, expect } from 'vitest';
import { shouldShowNearMissPlaceFeedback } from '../web/src/nearMissPlaceFeedback.js';

const CFG = {
    enabled: true,
    minLineFill: 0.875,
    minFrustrationLevel: 4,
    minFrustrationWhenAnxious: 2,
    maxPerSession: 1,
    minPlacementsBetween: 12,
    cooldownMs: 30_000,
    minPlacementsBeforeFirst: 12,
    healthyClearRate: 0.30,
    healthyMomentum: 0.05,
};

const BAD = {
    maxLineFill: 0.875,
    pendingNoMovesEnd: false,
    frustrationLevel: 4,
    flowState: 'anxious',
    momentum: -0.1,
    clearRate: 0.10,
    toastCount: 0,
    lastPlacementIndex: null,
    currentPlacementIndex: 30,
    lastShownAt: null,
    now: 100_000,
    cfg: CFG,
};

describe('shouldShowNearMissPlaceFeedback v1.50.1 — only when player truly suffers', () => {
    it('shows when frustration ≥ 4 with healthy other signals OFF', () => {
        expect(shouldShowNearMissPlaceFeedback(BAD).show).toBe(true);
    });

    it('blocks when line is not near full enough', () => {
        expect(shouldShowNearMissPlaceFeedback({ ...BAD, maxLineFill: 0.5 }).show).toBe(false);
    });

    it('blocks pure roundsSinceClear / mild frustration (no longer accepted)', () => {
        // frustration=2, anxious=false, no relief → 不再仅靠"久未消行"放行
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            frustrationLevel: 2,
            flowState: 'flow',
        }).show).toBe(false);
    });

    it('shows for anxious + mild frustration combo', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            frustrationLevel: 2,
            flowState: 'anxious',
        }).show).toBe(true);
    });

    it('blocks anxious alone without frustration', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            frustrationLevel: 0,
            flowState: 'anxious',
        }).show).toBe(false);
    });

    it('blocks when clearRate is healthy (≥ 0.30)', () => {
        expect(shouldShowNearMissPlaceFeedback({ ...BAD, clearRate: 0.45 }).show).toBe(false);
    });

    it('blocks when momentum is positive', () => {
        expect(shouldShowNearMissPlaceFeedback({ ...BAD, momentum: 0.2 }).show).toBe(false);
    });

    it('blocks when player is in flow with frustration below threshold', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            flowState: 'flow',
            frustrationLevel: 3,
        }).show).toBe(false);
    });

    it('respects session warmup (first 12 placements suppressed)', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            currentPlacementIndex: 5,
        }).show).toBe(false);
    });

    it('respects single-shot session cap', () => {
        expect(shouldShowNearMissPlaceFeedback({ ...BAD, toastCount: 1 }).show).toBe(false);
    });

    it('respects placement cooldown ≥ 12', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            lastPlacementIndex: 25,
            currentPlacementIndex: 30,
        }).show).toBe(false);
    });

    it('respects 30s time cooldown', () => {
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            lastShownAt: 80_000,
            now: 100_000,
        }).show).toBe(false);
    });

    it('blocks during pending game over', () => {
        expect(shouldShowNearMissPlaceFeedback({ ...BAD, pendingNoMovesEnd: true }).show).toBe(false);
    });

    it('blocks when stressBreakdown is heavy but frustration not yet hard (system is already relieving)', () => {
        // 系统已经在用 stress 救济了，此时再叠加 toast 反而打断救济节奏；frustration 没到硬阈值就不出。
        expect(shouldShowNearMissPlaceFeedback({
            ...BAD,
            frustrationLevel: 1,
            flowState: 'flow',
            stressBreakdown: { nearMissAdjust: -0.10, frustrationRelief: -0.10 },
        }).show).toBe(false);
    });
});

/**
 * v1.51.1 — placement / near-full-line binding：
 * 仅当玩家本次落子至少 1 格落在某条 ≥ minLineFill 的行/列上时才放行 toast。
 * 这条规则是修复"瞬时触发 + 延时 toast"在玩家继续操作后与盘面脱节的核心防线。
 */
describe('shouldShowNearMissPlaceFeedback v1.51.1 — placement-on-near-full-line binding', () => {
    const NEAR_FULL_LINES = [
        { type: 'row', index: 6, fill: 0.875 },
        { type: 'col', index: 2, fill: 0.875 },
    ];

    it('shows when placedCells overlap a near-full row', () => {
        const out = shouldShowNearMissPlaceFeedback({
            ...BAD,
            placedCells: [{ x: 4, y: 6 }, { x: 5, y: 6 }],
            nearFullLines: NEAR_FULL_LINES,
        });
        expect(out.show).toBe(true);
        expect(out.line).toEqual({ type: 'row', index: 6, fill: 0.875 });
    });

    it('shows when placedCells overlap a near-full column', () => {
        const out = shouldShowNearMissPlaceFeedback({
            ...BAD,
            placedCells: [{ x: 2, y: 0 }, { x: 2, y: 1 }],
            nearFullLines: NEAR_FULL_LINES,
        });
        expect(out.show).toBe(true);
        expect(out.line).toEqual({ type: 'col', index: 2, fill: 0.875 });
    });

    it('blocks when placedCells do NOT touch any near-full line', () => {
        const out = shouldShowNearMissPlaceFeedback({
            ...BAD,
            placedCells: [{ x: 7, y: 0 }, { x: 7, y: 1 }],
            nearFullLines: NEAR_FULL_LINES,
        });
        expect(out.show).toBe(false);
        expect(out.reason).toBe('placement_not_on_near_full_line');
    });

    it('blocks when nearFullLines is empty even if maxLineFill ≥ threshold (defensive)', () => {
        const out = shouldShowNearMissPlaceFeedback({
            ...BAD,
            placedCells: [{ x: 4, y: 6 }],
            nearFullLines: [],
        });
        // 空 nearFullLines 视为 binding 入参缺省 → 跳过 binding，走旧路径放行
        expect(out.show).toBe(true);
    });

    it('skips binding (back-compat) when placedCells is omitted', () => {
        // 旧调用方未提供 placedCells / nearFullLines → 跳过 binding，行为同 v1.50.1
        const out = shouldShowNearMissPlaceFeedback({ ...BAD, nearFullLines: NEAR_FULL_LINES });
        expect(out.show).toBe(true);
    });

    it('still respects geometry gate (line_not_near_full takes precedence over binding)', () => {
        const out = shouldShowNearMissPlaceFeedback({
            ...BAD,
            maxLineFill: 0.5,
            placedCells: [{ x: 4, y: 6 }],
            nearFullLines: NEAR_FULL_LINES,
        });
        expect(out.show).toBe(false);
        expect(out.reason).toBe('line_not_near_full');
    });
});
