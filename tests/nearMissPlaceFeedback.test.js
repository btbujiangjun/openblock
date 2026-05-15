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
