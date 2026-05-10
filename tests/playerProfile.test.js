/**
 * @vitest-environment jsdom
 *
 * 玩家实时能力画像：技能估计、心流状态、动量、挫败、持久化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';

function simulatePlays(profile, n, opts = {}) {
    const { clearRate = 0.3, linesPerClear = 1, fillBase = 0.3 } = opts;
    for (let i = 0; i < n; i++) {
        const cleared = Math.random() < clearRate;
        profile.recordPlace(cleared, cleared ? linesPerClear : 0, fillBase + Math.random() * 0.1);
    }
}

describe('PlayerProfile', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    describe('initial state', () => {
        it('starts with default skill 0.5', () => {
            expect(p.skillLevel).toBeCloseTo(0.5, 1);
        });

        it('isNewPlayer true when fresh', () => {
            expect(p.isNewPlayer).toBe(true);
        });

        it('frustrationLevel starts at 0', () => {
            expect(p.frustrationLevel).toBe(0);
        });

        it('momentum starts at 0', () => {
            expect(p.momentum).toBe(0);
        });
    });

    describe('recordPlace skill convergence', () => {
        it('skill rises with many clears', () => {
            const initial = p.skillLevel;
            simulatePlays(p, 30, { clearRate: 0.9, linesPerClear: 2 });
            expect(p.skillLevel).toBeGreaterThan(initial);
        });

        it('skill drops with many misses and no clears', () => {
            simulatePlays(p, 10, { clearRate: 0.5 });
            const mid = p.skillLevel;
            for (let i = 0; i < 20; i++) {
                p.recordPlace(false, 0, 0.7);
            }
            expect(p.skillLevel).toBeLessThan(mid + 0.05);
        });
    });

    describe('frustration tracking', () => {
        it('increases with consecutive non-clears', () => {
            for (let i = 0; i < 5; i++) {
                p.recordPlace(false, 0, 0.3);
            }
            expect(p.frustrationLevel).toBe(5);
        });

        it('resets on clear', () => {
            for (let i = 0; i < 5; i++) p.recordPlace(false, 0, 0.3);
            p.recordPlace(true, 1, 0.3);
            expect(p.frustrationLevel).toBe(0);
        });
    });

    describe('combo streak', () => {
        it('increments on multi-line clears', () => {
            p.recordPlace(true, 2, 0.3);
            p.recordPlace(true, 3, 0.3);
            expect(p.recentComboStreak).toBe(2);
        });

        it('resets on single-line or no clear', () => {
            p.recordPlace(true, 2, 0.3);
            p.recordPlace(true, 1, 0.3);
            expect(p.recentComboStreak).toBe(0);
        });
    });

    describe('flowState', () => {
        it('returns one of the three valid states', () => {
            simulatePlays(p, 20, { clearRate: 0.4 });
            expect(['bored', 'flow', 'anxious']).toContain(p.flowState);
        });

        it('starts in flow with few moves', () => {
            expect(p.flowState).toBe('flow');
        });

        it('v1.18 复合挣扎：高 missRate + 长 thinkMs + 低 clearRate + 板面 ≥0.55 → anxious', () => {
            // 模拟用户截图场景：每个单一阈值都没踩穿，但 ≥3 个弱挣扎信号同时成立
            // - missRate ≈ 12% (>0.10) ✓
            // - thinkMs avg ≈ 4000ms (>3500) ✓
            // - clearRate ≈ 22% (<0.30) ✓
            // - avgFill 0.58 (>0.55) && clearRate <0.40 ✓
            const now = Date.now();
            const moves = [
                { ts: now + 0,    thinkMs: 4200, cleared: true,  lines: 1, fill: 0.55, miss: false },
                { ts: now + 1000, thinkMs: 3800, cleared: false, lines: 0, fill: 0.58, miss: false },
                { ts: now + 2000, thinkMs: 4500, cleared: false, lines: 0, fill: 0.60, miss: false },
                { ts: now + 3000, thinkMs: 3700, cleared: false, lines: 0, fill: 0.62, miss: false },
                { ts: now + 4000, thinkMs: 4100, cleared: false, lines: 0, fill: 0.55, miss: false },
                { ts: now + 5000, thinkMs: 3900, cleared: false, lines: 0, fill: 0.58, miss: false },
                { ts: now + 6000, thinkMs: 3600, cleared: true,  lines: 1, fill: 0.60, miss: false },
                { ts: now + 7000, thinkMs: 4000, cleared: false, lines: 0, fill: 0.58, miss: true  },
                { ts: now + 8000, thinkMs: 3950, cleared: false, lines: 0, fill: 0.60, miss: false }
            ];
            for (const m of moves) p._pushMove(m);
            expect(p.flowState).toBe('anxious');
        });

        it('v1.18 复合挣扎：单一信号成立（仅高 missRate）→ 不升 anxious（避免误报）', () => {
            const now = Date.now();
            // 只有 missRate ≈ 12.5%：思考短、消行率高、板面低
            const moves = [];
            for (let i = 0; i < 7; i++) {
                moves.push({
                    ts: now + i * 1000, thinkMs: 800, cleared: true, lines: 1, fill: 0.30, miss: false
                });
            }
            moves.push({ ts: now + 7000, thinkMs: 600, cleared: false, lines: 0, fill: 0.30, miss: true });
            for (const m of moves) p._pushMove(m);
            expect(p.flowState).not.toBe('anxious');
        });

        it('v1.21 borderline 去抖：fd≈0.52 + clearRate=0.41（紧贴旧阈值上方）→ 不再 bored', () => {
            // 截图 R36 帧的 borderline：fd>0.5 + clearRate>0.4 旧版会判 bored，
            // snapshot 与 live 在同一帧落在阈值两侧 → 解释说 bored、tag 显示 flow。
            // v1.21 阈值收紧到 fd>0.55 && clearRate>0.42 后此处 fall through 到 'flow'。
            const now = Date.now();
            // 让 m.clearRate=0.41，且 thinkMs/missRate 不踩任何 anxious/bored 早判
            // clearRate = lines / placed_moves (clearable)
            const moves = [];
            for (let i = 0; i < 12; i++) {
                moves.push({
                    ts: now + i * 1000,
                    thinkMs: 2500, // 中速思考，绕开 bored 早判（<1200）和 anxious 早判
                    cleared: i % 5 < 2, // ≈ 0.40 clearRate
                    lines: i % 5 < 2 ? 1 : 0,
                    fill: 0.40,
                    miss: false
                });
            }
            for (const m of moves) p._pushMove(m);
            // 强行把 flowDeviation 推到 ~0.52（介于旧阈 0.5 与新阈 0.55 之间）
            p._flowDeviationOverride = 0.52;
            Object.defineProperty(p, 'flowDeviation', { value: 0.52, configurable: true });
            // 在 v1.21 之前会判 bored；现在应 fall through 到 'flow'
            expect(p.flowState).toBe('flow');
        });
    });

    describe('needsRecovery', () => {
        it('triggers at high board fill', () => {
            p.recordPlace(false, 0, 0.9);
            expect(p.needsRecovery).toBe(true);
        });

        it('decays over subsequent placements', () => {
            p.recordPlace(false, 0, 0.9);
            for (let i = 0; i < 10; i++) {
                p.recordPlace(false, 0, 0.2);
            }
            expect(p.needsRecovery).toBe(false);
        });
    });

    describe('hadRecentNearMiss', () => {
        it('true after non-clear on high-fill board', () => {
            p.recordPlace(false, 0, 0.7);
            expect(p.hadRecentNearMiss).toBe(true);
        });

        it('false after a clear', () => {
            p.recordPlace(true, 1, 0.7);
            expect(p.hadRecentNearMiss).toBe(false);
        });
    });

    describe('pacingPhase', () => {
        it('returns tension or release', () => {
            expect(['tension', 'release']).toContain(p.pacingPhase);
        });
    });

    describe('sessionPhase', () => {
        it('starts as early', () => {
            expect(p.sessionPhase).toBe('early');
        });
    });

    describe('metrics', () => {
        it('returns defaults with no moves', () => {
            const m = p.metrics;
            expect(m.thinkMs).toBe(3000);
            expect(m.clearRate).toBeCloseTo(0.3);
        });

        it('clearRate updates after plays', () => {
            for (let i = 0; i < 10; i++) p.recordPlace(true, 1, 0.3);
            expect(p.metrics.clearRate).toBeGreaterThan(0.5);
        });

        // v1.13：冷启动隔离字段
        it('冷启动时 metrics.samples / activeSamples 均为 0', () => {
            const m = p.metrics;
            expect(m.samples).toBe(0);
            expect(m.activeSamples).toBe(0);
        });

        it('落子后 samples 与 activeSamples 同步更新', () => {
            p.recordPlace(true, 1, 0.3);
            p.recordPlace(false, 0, 0.3);
            const m = p.metrics;
            expect(m.samples).toBe(2);
            expect(m.activeSamples).toBeGreaterThanOrEqual(0);
            expect(m.activeSamples).toBeLessThanOrEqual(2);
        });

        it('cognitiveLoadHasData：placed<3 时为 false，≥3 时为 true', () => {
            expect(p.cognitiveLoadHasData).toBe(false);
            p.recordPlace(true, 1, 0.3);
            p.recordPlace(false, 0, 0.3);
            expect(p.cognitiveLoadHasData).toBe(false);
            p.recordPlace(true, 1, 0.3);
            expect(p.cognitiveLoadHasData).toBe(true);
        });
    });

    describe('global personalization boundary', () => {
        it('stores only explicit personalization switches and reports no sensitive attributes', () => {
            p.setPersonalizationOptions({ difficulty: false, visuals: false, unknown: true });
            p.recordPreferenceSignal('qualityLow');
            const ctx = p.personalizationContext;
            expect(ctx.options.difficulty).toBe(false);
            expect(ctx.options.visuals).toBe(false);
            expect(ctx.usesSensitiveAttributes).toBe(false);
            expect(ctx.allowedSignals).toContain('behavior');
        });

        it('derives collection motivation from non-sensitive preference signals', () => {
            p._totalLifetimePlacements = 80;
            p._totalLifetimeGames = 5;
            p.recordPreferenceSignal('collection');
            p.recordPreferenceSignal('collection');
            p.recordPreferenceSignal('collection');
            expect(p.behaviorSegment).toBe('collector');
            expect(p.motivationIntent).toBe('collection');
        });

        it('computes returning warmup after persisted session gap', () => {
            const old = Date.now() - 4 * 86_400_000;
            const restored = PlayerProfile.fromJSON({
                smoothSkill: 0.6,
                totalLifetimePlacements: 120,
                totalLifetimeGames: 6,
                sessionHistory: [{ ts: old, placements: 10, skill: 0.6, score: 100, mode: 'endless' }],
                lastSessionEndTs: old,
            });
            expect(restored.returningWarmupStrength).toBeGreaterThanOrEqual(0.7);
            expect(restored.personalizationContext.usesSensitiveAttributes).toBe(false);
        });
    });

    describe('recordNewGame / recordSessionEnd', () => {
        it('recordNewGame increments lifetime games', () => {
            p.recordNewGame();
            p.recordNewGame();
            expect(p.lifetimeGames).toBe(2);
        });

        it('recordSessionEnd appends to session history', () => {
            p.recordNewGame();
            simulatePlays(p, 10);
            p.recordSessionEnd({ score: 100, placements: 10, clears: 3, misses: 1, maxCombo: 2 });
            expect(p._sessionHistory.length).toBe(1);
            expect(p._sessionHistory[0].score).toBe(100);
        });
    });

    describe('ingestHistoricalStats', () => {
        it('sets baseline skill from aggregated stats', () => {
            p.ingestHistoricalStats({
                totalGames: 50, totalScore: 50000, totalClears: 300,
                totalPlacements: 600, totalMisses: 30, maxCombo: 4
            });
            expect(p.historicalSkill).toBeGreaterThan(0);
            expect(p.historicalSkill).toBeLessThanOrEqual(1);
        });
    });

    describe('toJSON / fromJSON round-trip', () => {
        it('preserves skill and lifetime stats', () => {
            p._smoothSkill = 0.75;
            p._totalLifetimeGames = 10;
            p._totalLifetimePlacements = 200;
            const json = p.toJSON();
            const p2 = PlayerProfile.fromJSON(json);
            expect(p2._smoothSkill).toBeCloseTo(0.75, 2);
            expect(p2._totalLifetimeGames).toBe(10);
            expect(p2._totalLifetimePlacements).toBe(200);
        });
    });

    describe('cognitiveLoad', () => {
        it('returns a number between 0 and 1', () => {
            simulatePlays(p, 15);
            expect(p.cognitiveLoad).toBeGreaterThanOrEqual(0);
            expect(p.cognitiveLoad).toBeLessThanOrEqual(1);
        });
    });

    describe('confidence / trend / historicalSkill', () => {
        it('confidence = 0 with no history', () => {
            expect(p.confidence).toBe(0);
        });

        it('trend = 0 with no history', () => {
            expect(p.trend).toBe(0);
        });

        it('confidence rises with more sessions', () => {
            for (let i = 0; i < 10; i++) {
                p.recordNewGame();
                simulatePlays(p, 5);
                p.recordSessionEnd({ score: 100 + i * 10, placements: 5, clears: 2, misses: 0, maxCombo: 1 });
            }
            expect(p.confidence).toBeGreaterThan(0.1);
        });
    });
});
