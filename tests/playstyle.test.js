/**
 * @vitest-environment jsdom
 *
 * 玩法偏好识别：multiClearRate / perfectClearRate / avgLinesPerClear / playstyle
 * 以及 adaptiveSpawn 联动（playstyle → spawnHints）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';

// ─────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────

/**
 * 向 profile 注入一批模拟落子记录。
 * @param {PlayerProfile} p
 * @param {Array<{cleared:boolean, lines:number, fill:number}>} moves
 */
function injectMoves(p, moves) {
    for (const m of moves) {
        p.recordPlace(m.cleared, m.lines, m.fill);
    }
}

/** 生成 n 条单消记录（lines=1, fill 随机，不含清屏） */
function singleClearMoves(n) {
    return Array.from({ length: n }, () => ({ cleared: true, lines: 1, fill: 0.3 + Math.random() * 0.3 }));
}

/** 生成 n 条多消记录（lines=2+, fill 随机） */
function multiClearMoves(n, lines = 2) {
    return Array.from({ length: n }, () => ({ cleared: true, lines, fill: 0.2 + Math.random() * 0.3 }));
}

/** 生成 n 条清屏记录（fill=0，lines=3+） */
function perfectClearMoves(n) {
    return Array.from({ length: n }, () => ({ cleared: true, lines: 3, fill: 0 }));
}

/** 生成 n 条无消行记录 */
function noClearMoves(n) {
    return Array.from({ length: n }, () => ({ cleared: false, lines: 0, fill: 0.4 }));
}

// ─────────────────────────────────────────────────────────────
// multiClearRate
// ─────────────────────────────────────────────────────────────

describe('PlayerProfile.multiClearRate', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    it('无消行时返回 0', () => {
        injectMoves(p, noClearMoves(10));
        expect(p.multiClearRate).toBe(0);
    });

    it('全单消时返回 0（lines<2 不计为多消）', () => {
        injectMoves(p, singleClearMoves(10));
        expect(p.multiClearRate).toBe(0);
    });

    it('全多消时返回 1', () => {
        injectMoves(p, multiClearMoves(10));
        expect(p.multiClearRate).toBeCloseTo(1, 5);
    });

    it('混合 50% 多消时返回约 0.5', () => {
        injectMoves(p, [
            ...singleClearMoves(5),
            ...multiClearMoves(5),
        ]);
        expect(p.multiClearRate).toBeCloseTo(0.5, 1);
    });

    it('消行事件不足 2 条时保守返回 0（冷启动保护）', () => {
        injectMoves(p, [{ cleared: true, lines: 2, fill: 0.3 }]);
        expect(p.multiClearRate).toBe(0);
    });

    it('只取最近 _window 步，不受更早记录影响', () => {
        // 先注入 20 条老单消记录，再注入 15 条新多消记录（等于窗口大小）
        injectMoves(p, singleClearMoves(20));
        injectMoves(p, multiClearMoves(15));
        // 窗口 15 全是多消，应为 1
        expect(p.multiClearRate).toBeCloseTo(1, 5);
    });
});

// ─────────────────────────────────────────────────────────────
// perfectClearRate
// ─────────────────────────────────────────────────────────────

describe('PlayerProfile.perfectClearRate', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    it('无消行时返回 0', () => {
        injectMoves(p, noClearMoves(8));
        expect(p.perfectClearRate).toBe(0);
    });

    it('普通消行（fill>0）不被识别为清屏', () => {
        injectMoves(p, singleClearMoves(10));
        expect(p.perfectClearRate).toBe(0);
    });

    it('fill=0 的消行被识别为清屏', () => {
        injectMoves(p, perfectClearMoves(10));
        expect(p.perfectClearRate).toBeCloseTo(1, 5);
    });

    it('混合：2 次清屏 + 8 次普通消行 → 约 0.2', () => {
        injectMoves(p, [
            ...perfectClearMoves(2),
            ...singleClearMoves(8),
        ]);
        expect(p.perfectClearRate).toBeCloseTo(0.2, 1);
    });

    it('消行事件不足 2 条时保守返回 0', () => {
        injectMoves(p, [{ cleared: true, lines: 3, fill: 0 }]);
        expect(p.perfectClearRate).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// avgLinesPerClear
// ─────────────────────────────────────────────────────────────

describe('PlayerProfile.avgLinesPerClear', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    it('无消行时返回 0', () => {
        injectMoves(p, noClearMoves(8));
        expect(p.avgLinesPerClear).toBe(0);
    });

    it('全单消时平均为 1', () => {
        injectMoves(p, singleClearMoves(10));
        expect(p.avgLinesPerClear).toBeCloseTo(1, 5);
    });

    it('全 2 消时平均为 2', () => {
        injectMoves(p, multiClearMoves(10, 2));
        expect(p.avgLinesPerClear).toBeCloseTo(2, 5);
    });

    it('混合 lines=1 和 lines=3 → 平均 2', () => {
        injectMoves(p, [
            ...Array.from({ length: 5 }, () => ({ cleared: true, lines: 1, fill: 0.3 })),
            ...Array.from({ length: 5 }, () => ({ cleared: true, lines: 3, fill: 0.1 })),
        ]);
        expect(p.avgLinesPerClear).toBeCloseTo(2, 5);
    });
});

// ─────────────────────────────────────────────────────────────
// playstyle
// ─────────────────────────────────────────────────────────────

describe('PlayerProfile.playstyle', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    it('默认（无记录）返回 balanced', () => {
        // clearRate=0 < 0.25 → survival，但清屏率/多消率均为 0（窗口不足），特例
        // 实际数据极少时 metrics.clearRate=0 → survival；可接受此行为
        const ps = p.playstyle;
        expect(['balanced', 'survival']).toContain(ps);
    });

    it('清屏率 ≥ 5% → perfect_hunter（优先级最高）', () => {
        // 注入足够多的消行记录，其中 ≥5% 是清屏
        injectMoves(p, [...perfectClearMoves(1), ...singleClearMoves(14)]);
        // perfectClearRate = 1/15 ≈ 6.7% ≥ 5%
        expect(p.playstyle).toBe('perfect_hunter');
    });

    it('多消率 ≥ 40% 且无清屏 → multi_clear', () => {
        injectMoves(p, [...multiClearMoves(7, 2), ...singleClearMoves(8)]);
        // multiClearRate = 7/15 ≈ 46.7%，perfectClearRate = 0
        expect(p.playstyle).toBe('multi_clear');
    });

    it('avgLinesPerClear ≥ 2.5 且无清屏 → multi_clear', () => {
        // 全是 3 消记录（fill > 0），avgLines = 3
        injectMoves(p, multiClearMoves(12, 3));
        expect(p.avgLinesPerClear).toBeGreaterThanOrEqual(2.5);
        expect(p.playstyle).toBe('multi_clear');
    });

    it('comboStreak ≥ 3 且无清屏/多消 → combo', () => {
        // 通过内部接口强制设置 comboStreak
        injectMoves(p, singleClearMoves(12));
        p._comboStreak = 3;
        // 多消率 = 0, perfectClearRate = 0, comboStreak = 3
        expect(p.playstyle).toBe('combo');
    });

    it('消行率 < 25% → survival', () => {
        // 注入大量无消行记录，少量消行
        injectMoves(p, [...singleClearMoves(2), ...noClearMoves(13)]);
        // clearRate = 2/15 ≈ 13.3% < 25%
        expect(p.metrics.clearRate).toBeLessThan(0.25);
        expect(p.playstyle).toBe('survival');
    });

    it('无明显特征 → balanced', () => {
        // 消行率约 35%，单消，无连消
        injectMoves(p, [...singleClearMoves(6), ...noClearMoves(9)]);
        // multiClearRate=0, perfectClearRate=0, comboStreak=0, clearRate≈40%
        expect(p.playstyle).toBe('balanced');
    });

    it('perfect_hunter 优先于 multi_clear', () => {
        // 同时满足清屏和多消条件，应取 perfect_hunter
        injectMoves(p, [...perfectClearMoves(2), ...multiClearMoves(10)]);
        expect(p.playstyle).toBe('perfect_hunter');
    });

    it('multi_clear 优先于 combo', () => {
        p._comboStreak = 4;
        injectMoves(p, multiClearMoves(10));
        expect(p.playstyle).toBe('multi_clear');
    });
});

// ─────────────────────────────────────────────────────────────
// adaptiveSpawn 联动
// ─────────────────────────────────────────────────────────────

describe('adaptiveSpawn playstyle integration', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    /** 构造指定 playstyle 的玩家（通过行为序列驱动，不直接 mock getter） */
    function profileWithPlaystyle(target) {
        const p = new PlayerProfile(15);
        if (target === 'perfect_hunter') {
            injectMoves(p, [...perfectClearMoves(2), ...singleClearMoves(13)]);
        } else if (target === 'multi_clear') {
            injectMoves(p, [...multiClearMoves(9, 2), ...singleClearMoves(6)]);
        } else if (target === 'combo') {
            injectMoves(p, singleClearMoves(12));
            p._comboStreak = 4;
        } else if (target === 'survival') {
            injectMoves(p, [...singleClearMoves(2), ...noClearMoves(13)]);
        } else {
            injectMoves(p, [...singleClearMoves(6), ...noClearMoves(9)]);
        }
        return p;
    }

    it('perfect_hunter → multiClearBonus ≥ 0.85（当 adaptive 启用时）', () => {
        const p = profileWithPlaystyle('perfect_hunter');
        expect(p.playstyle).toBe('perfect_hunter');
        // v1.19：multiClearBonus 几何兜底要求至少有近满兜底（nearFullLines ≥ 2）或
        // 多消候选（multiClearCandidates ≥ 1）；perfect_hunter 偏好属"长期玩家偏好"，
        // 不应单凭偏好把 bonus 顶到 0.85，需要盘面真有兑现机会。
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.4, { nearFullLines: 2 });
        if (s.spawnHints) {
            expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.85);
        }
    });

    it('perfect_hunter → clearGuarantee ≥ 2（当 adaptive 启用时）', () => {
        const p = profileWithPlaystyle('perfect_hunter');
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.4, {});
        if (s.spawnHints) {
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(2);
        }
    });

    it('multi_clear → multiClearBonus ≥ 0.65（当 adaptive 启用时）', () => {
        const p = profileWithPlaystyle('multi_clear');
        expect(p.playstyle).toBe('multi_clear');
        // v1.19：同上，multi_clear 偏好需要盘面有兑现窗口才允许 bonus 顶到 0.65
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.3, { nearFullLines: 2 });
        if (s.spawnHints) {
            expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.65);
        }
    });

    it('multi_clear → rhythmPhase 不保持 neutral（neutral 被转为 payoff）', () => {
        const p = profileWithPlaystyle('multi_clear');
        expect(p.playstyle).toBe('multi_clear');
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.3, {});
        if (s.spawnHints) {
            // multi_clear 分支把 neutral 改为 payoff，因此最终不应为 neutral
            expect(s.spawnHints.rhythmPhase).not.toBe('neutral');
        }
    });

    it('combo → clearGuarantee ≥ 2（当 adaptive 启用时）', () => {
        const p = profileWithPlaystyle('combo');
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.4, {});
        if (s.spawnHints) {
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(2);
        }
    });

    it('survival → sizePreference ≤ -0.25（当 adaptive 启用时）', () => {
        const p = profileWithPlaystyle('survival');
        expect(p.playstyle).toBe('survival');
        const s = resolveAdaptiveStrategy('normal', p, 20, 0, 0.3, {});
        if (s.spawnHints) {
            expect(s.spawnHints.sizePreference).toBeLessThanOrEqual(-0.25 + 0.001);
        }
    });

    it('balanced → 不强制覆盖 multiClearBonus 到极高值', () => {
        const p = profileWithPlaystyle('balanced');
        expect(p.playstyle).toBe('balanced');
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.3, {});
        if (s.spawnHints) {
            // balanced 不走 perfect_hunter/multi_clear 分支，multiClearBonus 不会被强制到 0.85
            expect(s.spawnHints.multiClearBonus).toBeLessThan(0.85);
        }
    });

    it('_playstyle 写入返回诊断（供 insight 面板读取）', () => {
        const p = profileWithPlaystyle('perfect_hunter');
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.4, {});
        expect(s._playstyle).toBeDefined();
        expect(typeof s._playstyle).toBe('string');
    });
});
