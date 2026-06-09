/**
 * @vitest-environment jsdom
 *
 * runOverRunArc — 局间难度弧线推导单测。
 * 与 web/src/retention/runOverRunArc.js 的优先级表 1:1 对齐。
 */
import { describe, it, expect } from 'vitest';
import {
    deriveRunOverRunArc,
    resolveArcThresholds,
    describeRunOverRunArc,
    RUN_OVER_RUN_ARCS,
    DEFAULT_ARC_THRESHOLDS,
} from '../web/src/retention/runOverRunArc.js';

const NOW = 1717920000000; // 2024-06-09 12:00:00 UTC 锚点

describe('resolveArcThresholds', () => {
    it('空配置回落默认', () => {
        expect(resolveArcThresholds()).toBe(DEFAULT_ARC_THRESHOLDS);
        expect(resolveArcThresholds(null)).toBe(DEFAULT_ARC_THRESHOLDS);
    });

    it('部分字段覆盖时其余仍走默认', () => {
        const th = resolveArcThresholds({ openerIdleMs: 60000, momentumMax: 4 });
        expect(th.openerIdleMs).toBe(60000);
        expect(th.momentumMax).toBe(4);
        expect(th.peakMin).toBe(DEFAULT_ARC_THRESHOLDS.peakMin);
    });

    it('非法字段（NaN / 负值）被忽略', () => {
        const th = resolveArcThresholds({ openerIdleMs: -1, peakMin: 'abc' });
        expect(th.openerIdleMs).toBe(DEFAULT_ARC_THRESHOLDS.openerIdleMs);
        expect(th.peakMin).toBe(DEFAULT_ARC_THRESHOLDS.peakMin);
    });
});

describe('deriveRunOverRunArc', () => {
    it('完全冷启动（无 lastGameOver）→ opener (first_of_day)', () => {
        const r = deriveRunOverRunArc({ dailyRunIndex: 1, now: NOW });
        expect(r.arc).toBe('opener');
        expect(r.reason).toBe('first_of_day');
        expect(r.sinceLastBreakMs).toBe(Infinity);
    });

    it('第 2 局（紧邻上局结束）→ momentum', () => {
        const r = deriveRunOverRunArc({
            dailyRunIndex: 2,
            now: NOW,
            lastGameOver: { ts: NOW - 60 * 1000, score: 500 },
            bestScore: 1000,
        });
        expect(r.arc).toBe('momentum');
    });

    it('第 3 局→ momentum；第 4/5 局→ peak', () => {
        const base = { now: NOW, lastGameOver: { ts: NOW - 60_000, score: 800 }, bestScore: 1000 };
        expect(deriveRunOverRunArc({ ...base, dailyRunIndex: 3 }).arc).toBe('momentum');
        expect(deriveRunOverRunArc({ ...base, dailyRunIndex: 4 }).arc).toBe('peak');
        expect(deriveRunOverRunArc({ ...base, dailyRunIndex: 5 }).arc).toBe('peak');
    });

    it('第 6 局后 → fatigue (daily_index)', () => {
        const r = deriveRunOverRunArc({
            dailyRunIndex: 7,
            now: NOW,
            lastGameOver: { ts: NOW - 60_000, score: 900 },
            bestScore: 1000,
        });
        expect(r.arc).toBe('fatigue');
        expect(r.reason).toBe('daily_index');
    });

    it('空闲 ≥ openerIdleMs 后即便 dailyRunIndex>1 也算 opener', () => {
        const r = deriveRunOverRunArc({
            dailyRunIndex: 4,
            now: NOW,
            lastGameOver: { ts: NOW - 35 * 60 * 1000, score: 800 },
            bestScore: 1000,
        });
        expect(r.arc).toBe('opener');
        expect(r.reason).toBe('idle_reset');
    });

    it('连续 3 局得分 < 60%·PB → fatigue (loss_streak)，优先级高于 opener', () => {
        // dailyRunIndex=1 本来是 opener，但 loss_streak 优先
        const r = deriveRunOverRunArc({
            dailyRunIndex: 1,
            now: NOW,
            lastGameOver: null,
            bestScore: 1000,
            recentScores: [200, 300, 400], // 全部 < 600
        });
        expect(r.arc).toBe('fatigue');
        expect(r.reason).toBe('loss_streak');
    });

    it('赌气重开链 ≥ rageMinChainLen → cooldown，最高优先级', () => {
        // 上一局 5s 内崩盘（score=100 < 0.3·1000=300），且 rageChainLen=1 → 累加到 2
        const r = deriveRunOverRunArc({
            dailyRunIndex: 2,
            now: NOW,
            lastGameOver: { ts: NOW - 3000, score: 100 },
            bestScore: 1000,
            rageChainLen: 1,
            recentScores: [100, 50, 80], // 同时 loss_streak 触发，但 cooldown 应胜出
        });
        expect(r.arc).toBe('cooldown');
        expect(r.reason).toBe('rage_restart_chain');
    });

    it('赌气但分数不算崩盘 → 不进 cooldown', () => {
        const r = deriveRunOverRunArc({
            dailyRunIndex: 2,
            now: NOW,
            lastGameOver: { ts: NOW - 3000, score: 800 },
            bestScore: 1000,
            rageChainLen: 1,
        });
        expect(r.arc).not.toBe('cooldown');
    });

    it('bestScore=0（新手）时 loss_streak / cooldown 失效', () => {
        const r = deriveRunOverRunArc({
            dailyRunIndex: 7,
            now: NOW,
            lastGameOver: { ts: NOW - 1000, score: 0 },
            bestScore: 0,
            rageChainLen: 5,
            recentScores: [0, 0, 0],
        });
        // 既不进 cooldown 也不进 loss_streak，按 daily_index 进 fatigue
        expect(r.arc).toBe('fatigue');
        expect(r.reason).toBe('daily_index');
    });

    it('阈值可覆盖（peakMax 拉宽到 7）', () => {
        const thresholds = { peakMax: 7, fatigueMinIndex: 8 };
        const r = deriveRunOverRunArc({
            dailyRunIndex: 7,
            now: NOW,
            lastGameOver: { ts: NOW - 60_000, score: 900 },
            bestScore: 1000,
            thresholds,
        });
        expect(r.arc).toBe('peak');
    });

    it('五档枚举字符串与 RUN_OVER_RUN_ARCS 同步', () => {
        const cases = [
            { dailyRunIndex: 1 },
            { dailyRunIndex: 2, lastGameOver: { ts: NOW - 60_000, score: 500 }, bestScore: 1000 },
            { dailyRunIndex: 4, lastGameOver: { ts: NOW - 60_000, score: 500 }, bestScore: 1000 },
            { dailyRunIndex: 7, lastGameOver: { ts: NOW - 60_000, score: 900 }, bestScore: 1000 },
            { dailyRunIndex: 2, lastGameOver: { ts: NOW - 1000, score: 100 }, bestScore: 1000, rageChainLen: 1 },
        ];
        const arcs = new Set(cases.map((c) => deriveRunOverRunArc({ ...c, now: NOW }).arc));
        for (const a of arcs) expect(RUN_OVER_RUN_ARCS).toContain(a);
        expect(arcs.size).toBe(5);
    });
});

describe('describeRunOverRunArc', () => {
    it('生成中文摘要', () => {
        const r = deriveRunOverRunArc({ dailyRunIndex: 1, now: NOW });
        const s = describeRunOverRunArc(r);
        expect(s).toContain('今日首局');
        expect(s).toContain('first_of_day');
    });

    it('空输入返回兜底', () => {
        expect(describeRunOverRunArc(null)).toContain('未派生');
    });
});
