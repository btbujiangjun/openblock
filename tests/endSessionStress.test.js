/**
 * @vitest-environment jsdom
 *
 * v1.51 末段崩盘修复回归测试：
 *   - flowState borderline 方向判定（boardPressure>skill 不再误判 bored）
 *   - flowState 末段瞬时挣扎窗口（最近 8 步消行塌陷立即触发 anxious）
 *   - flowState momentum 强烈下行硬触发（momentum ≤ -0.35 → anxious）
 *   - endSessionDistress stressBreakdown 信号
 *   - spawnIntent 末段/高挫败强制 relief
 *   - stressMeter 挣扎中变体
 *
 * 这 6 个守护测试对应 docs/algorithms/ADAPTIVE_SPAWN.md §5.x v1.51
 * 「末段崩盘修复」一节的 6 项行为契约，未来回归立即可见。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { getStressDisplay } from '../web/src/stressMeter.js';

/**
 * 构造一个 PlayerProfile 并直接灌入 _moves，避免依赖 Date.now() 与 setTimeout。
 * pattern 中每条 move 字段：{ thinkMs, cleared, fill, miss }
 */
function makeProfileWithMoves(pattern, overrides = {}) {
    const p = new PlayerProfile(15);
    const baseTs = Date.now() - pattern.length * 1500;
    p._moves = pattern.map((m, i) => ({
        ts: baseTs + i * 1500,
        thinkMs: m.thinkMs ?? 1500,
        pickToPlaceMs: m.pickToPlaceMs ?? 600,
        cleared: !!m.cleared,
        lines: m.lines ?? (m.cleared ? 1 : 0),
        fill: m.fill ?? 0.4,
        miss: !!m.miss,
    }));
    p._spawnCounter = overrides.spawnCounter ?? 6;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    /* 让 sessionPhase 跳到 late：sessionStartTs 推到 6 分钟前 */
    if (overrides.late) p._sessionStartTs = Date.now() - 6 * 60_000;
    return p;
}

describe('v1.51 flowState 末段崩盘修复', () => {
    beforeEach(() => resetAdaptiveMilestone());

    it('momentum 强烈下行（≤ -0.35）→ 优先返 anxious，不被 bored 覆盖', () => {
        /* 前 6 步全消（cleared=true），后 6 步全不消，制造 momentum ≈ -1。
         * thinkMs 与 fill 都很温和，旧版会落到 borderline 误判 bored。 */
        const moves = [
            ...Array(6).fill({ cleared: true,  thinkMs: 1200, fill: 0.30 }),
            ...Array(6).fill({ cleared: false, thinkMs: 1200, fill: 0.40 }),
        ];
        const p = makeProfileWithMoves(moves);
        expect(p.momentum).toBeLessThanOrEqual(-0.35);
        expect(p.flowState).toBe('anxious');
    });

    it('末段瞬时窗口：最近 8 步全部不消行 → 即便累计均值漂亮也判 anxious', () => {
        /* 前 12 步全消（拉高累计 clearRate），后 8 步全部不消 + 思考时间显著上升。 */
        const moves = [
            ...Array(12).fill({ cleared: true,  thinkMs: 1200, fill: 0.35 }),
            ...Array(8).fill({ cleared: false, thinkMs: 4500, fill: 0.78 }),
        ];
        const p = makeProfileWithMoves(moves);
        expect(p.flowState).toBe('anxious');
    });

    it('borderline 方向判定：板面偏弱（fd>0.55 + 高 clearRate + momentum 稳定）才允许 bored', () => {
        /* 极易消、思考极短、avgFill 低、momentum 平稳 → 真"无聊"。 */
        const moves = Array(12).fill({ cleared: true, thinkMs: 600, fill: 0.18, lines: 1 });
        const p = makeProfileWithMoves(moves);
        /* clearRate=1、thinkMs=600、missRate=0 → 走 thinkTimeLowMs 早返回 'bored' 即满足契约。 */
        expect(['bored', 'flow']).toContain(p.flowState);
    });
});

describe('v1.51 endSessionDistress stress 信号', () => {
    beforeEach(() => resetAdaptiveMilestone());

    it('sessionPhase=late + momentum<-0.30 → endSessionDistress 为负', () => {
        const moves = [
            ...Array(6).fill({ cleared: true,  thinkMs: 1200, fill: 0.30 }),
            ...Array(6).fill({ cleared: false, thinkMs: 1500, fill: 0.50 }),
        ];
        const p = makeProfileWithMoves(moves, { late: true });
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.5, { totalRounds: 30, scoreMilestoneSeen: true });
        expect(s._stressBreakdown.endSessionDistress).toBeLessThan(0);
        /* spawnIntent 应该走 relief（playerDistress 已经够强或被强制 relief） */
        expect(s.spawnHints.spawnIntent).toBe('relief');
    });

    it('sessionPhase=peak（非 late）→ endSessionDistress = 0', () => {
        const moves = [
            ...Array(6).fill({ cleared: true,  thinkMs: 1200, fill: 0.30 }),
            ...Array(6).fill({ cleared: false, thinkMs: 1500, fill: 0.50 }),
        ];
        const p = makeProfileWithMoves(moves /* 不 late */);
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.5, { totalRounds: 30 });
        expect(s._stressBreakdown.endSessionDistress).toBe(0);
    });

    it('frustrationLevel ≥ 5 单独触发 forceReliefIntent（即便 distress 信号弱）', () => {
        const moves = Array(8).fill({ cleared: false, thinkMs: 1500, fill: 0.45, lines: 0 });
        const p = makeProfileWithMoves(moves, { consecutiveNonClears: 6 });
        expect(p.frustrationLevel).toBeGreaterThanOrEqual(5);
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.5, { totalRounds: 20 });
        expect(s.spawnHints.spawnIntent).toBe('relief');
    });
});

describe('v1.51 stressMeter 挣扎中变体', () => {
    it('calm 档 + late + momentum<-0.30 → label 切到「挣扎中（救济中）」', () => {
        const display = getStressDisplay(-0.10, 'relief', {
            sessionPhase: 'late',
            momentum: -0.45,
            frustrationLevel: 3,
        });
        expect(display.label).toContain('挣扎中');
        expect(display.face).toBe('😣');
    });

    it('easy 档 + frustrationLevel ≥ 5 → label 切到「挣扎中」（与 sessionPhase 解耦）', () => {
        const display = getStressDisplay(0.10, 'relief', {
            sessionPhase: 'peak',
            momentum: -0.10,
            frustrationLevel: 6,
        });
        expect(display.label).toContain('挣扎中');
    });

    it('正常低压（无 late + 无高挫败）→ 维持 calm 原样', () => {
        const display = getStressDisplay(-0.10, null, {
            sessionPhase: 'peak',
            momentum: 0.10,
            frustrationLevel: 1,
        });
        expect(display.label).not.toContain('挣扎');
        expect(display.id).toBe('calm');
    });

    it('relief + calm 但无挣扎 → 走原 v1.18 救济中变体', () => {
        const display = getStressDisplay(-0.10, 'relief', {
            sessionPhase: 'peak',
            momentum: 0.10,
            frustrationLevel: 1,
        });
        expect(display.label).toContain('救济中');
        expect(display.face).toBe('🤗');
    });
});
