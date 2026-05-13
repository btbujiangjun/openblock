/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { Grid } from '../web/src/grid.js';
import {
    ABILITY_VECTOR_VERSION,
    buildAbilityTrainingDataset,
    buildPlayerAbilityVector
} from '../web/src/playerAbilityModel.js';

function play(profile, n, opts = {}) {
    const { clearEvery = 2, lines = 1, fill = 0.35 } = opts;
    for (let i = 0; i < n; i++) {
        const cleared = clearEvery > 0 && i % clearEvery === 0;
        profile.recordPlace(cleared, cleared ? lines : 0, fill);
    }
}

describe('playerAbilityModel', () => {
    it('builds a bounded ability vector from PlayerProfile and board topology', () => {
        const p = new PlayerProfile(15);
        play(p, 18, { clearEvery: 2, lines: 2, fill: 0.42 });
        const grid = new Grid(8);
        grid.cells[7][0] = { colorIdx: 0 };
        grid.cells[7][1] = { colorIdx: 0 };

        const v = buildPlayerAbilityVector(p, {
            grid,
            boardFill: grid.getFillRatio(),
            gameStats: { placements: 18 },
            spawnContext: { roundsSinceClear: 0 },
        });

        expect(v.version).toBe(ABILITY_VECTOR_VERSION);
        expect(v.version).toBeGreaterThanOrEqual(2);
        expect(v.skillScore).toBeGreaterThanOrEqual(0);
        expect(v.skillScore).toBeLessThanOrEqual(1);
        expect(v.clearEfficiency).toBeGreaterThan(0.3);
        expect(v.playstyle).toBe(p.playstyle);
        expect(v.explain.length).toBeGreaterThan(0);
    });

    it('raises risk on high fill and consecutive non-clears', () => {
        const p = new PlayerProfile(15);
        // v2：盘面"急速变满"——boardFillVelocity 起作用 + 持续高 fill；
        // 配合死局信号 firstMoveFreedom=0 → lockRisk=1，让 riskBand 越过 high 阈值。
        const climb = [0.40, 0.55, 0.68, 0.78, 0.84, 0.88, 0.92, 0.94];
        climb.forEach((f) => p.recordPlace(false, 0, f));

        const low = buildPlayerAbilityVector(new PlayerProfile(15), { boardFill: 0.2 });
        const high = buildPlayerAbilityVector(p, {
            boardFill: 0.94,
            topology: { holes: 7, fillRatio: 0.94 },
            spawnContext: { roundsSinceClear: 5 },
            firstMoveFreedom: 0,
        });

        expect(high.riskLevel).toBeGreaterThan(low.riskLevel);
        expect(high.riskBand).toBe('high');
    });

    /* ============================================================================
     * v2 (2026-05) 新增分项覆盖
     * ============================================================================ */

    describe('v2 — controlScore 接入「反应」(pickToPlaceMs)', () => {
        function playWithReaction(profile, n, pickToPlaceMs) {
            for (let i = 0; i < n; i++) {
                profile.recordPickup();
                // 简单模拟：紧接着的 recordPlace 会用 (now - _pickupAt) 作为 pickToPlaceMs；
                // 测试里直接给 _pickupAt 一个相对值确保计算一致
                profile._pickupAt = Date.now() - pickToPlaceMs;
                profile.recordPlace(i % 2 === 0, i % 2 === 0 ? 1 : 0, 0.35);
            }
        }

        it('反应快（≈250ms）应比反应慢（≈2500ms）的 controlScore 更高', () => {
            const fast = new PlayerProfile(15);
            const slow = new PlayerProfile(15);
            playWithReaction(fast, 8, 250);
            playWithReaction(slow, 8, 2500);

            const vFast = buildPlayerAbilityVector(fast, { boardFill: 0.3 });
            const vSlow = buildPlayerAbilityVector(slow, { boardFill: 0.3 });

            expect(vFast.controlScore).toBeGreaterThan(vSlow.controlScore);
            expect(vFast.features.reactionScore).toBeGreaterThan(0.7);
            expect(vSlow.features.reactionScore).toBeLessThan(0.3);
        });

        it('反应样本不足（< minSamples）时反应项不参与，权重重分配给其它四项', () => {
            const p = new PlayerProfile(15);
            playWithReaction(p, 2, 250);   // 只有 2 个反应样本，低于 minSamples=3
            const v = buildPlayerAbilityVector(p, { boardFill: 0.3 });
            expect(v.features.reactionScore).toBeNull();
            // controlScore 仍是 [0,1] 的合理值，没有因为反应项缺失变成 NaN / 极端值
            expect(v.controlScore).toBeGreaterThanOrEqual(0);
            expect(v.controlScore).toBeLessThanOrEqual(1);
        });
    });

    describe('v2 — clearEfficiency 接入 multiClearRate / perfectClearRate', () => {
        it('多消玩家（lines=2 频繁）clearEfficiency 显著高于纯单消玩家', () => {
            const single = new PlayerProfile(20);
            const multi = new PlayerProfile(20);
            // 单消：每两步清 1 行
            for (let i = 0; i < 20; i++) {
                single.recordPlace(i % 2 === 0, i % 2 === 0 ? 1 : 0, 0.4);
            }
            // 多消：每两步清 2 行（multiClearRate ~ 1.0）
            for (let i = 0; i < 20; i++) {
                multi.recordPlace(i % 2 === 0, i % 2 === 0 ? 2 : 0, 0.4);
            }

            const vSingle = buildPlayerAbilityVector(single, { boardFill: 0.4 });
            const vMulti = buildPlayerAbilityVector(multi, { boardFill: 0.4 });

            expect(vMulti.clearEfficiency).toBeGreaterThan(vSingle.clearEfficiency);
            expect(vMulti.features.multiClearRate).toBeGreaterThan(0.8);
            expect(vSingle.features.multiClearRate).toBeLessThan(0.2);
        });

        it('清屏（fill 落 0）的玩家 perfectClearRate > 0 且 clearEfficiency 进一步提升', () => {
            const normal = new PlayerProfile(20);
            const perfect = new PlayerProfile(20);
            // 正常多消玩家
            for (let i = 0; i < 20; i++) {
                normal.recordPlace(i % 2 === 0, i % 2 === 0 ? 2 : 0, 0.4);
            }
            // 同样多消但每次清行后 fill=0（清屏）
            for (let i = 0; i < 20; i++) {
                perfect.recordPlace(i % 2 === 0, i % 2 === 0 ? 2 : 0, i % 2 === 0 ? 0 : 0.4);
            }

            const vNormal = buildPlayerAbilityVector(normal, { boardFill: 0.4 });
            const vPerfect = buildPlayerAbilityVector(perfect, { boardFill: 0.4 });

            expect(vPerfect.features.perfectClearRate).toBeGreaterThan(0.5);
            expect(vNormal.features.perfectClearRate).toBe(0);
            expect(vPerfect.clearEfficiency).toBeGreaterThan(vNormal.clearEfficiency);
        });
    });

    describe('v2 — riskLevel 加 boardFillVelocity / lockRisk', () => {
        it('盘面急速变满（fill 从 0.3 一路冲到 0.85）的 riskLevel 高于稳定 0.85', () => {
            const climbing = new PlayerProfile(15);
            // 6 步 fill 从 0.3 → 0.85，velocity ≈ +0.092/step（高于 0.18 → 全归一为 1）
            const fills = [0.30, 0.45, 0.55, 0.65, 0.75, 0.85];
            fills.forEach((f) => climbing.recordPlace(false, 0, f));
            const stable = new PlayerProfile(15);
            for (let i = 0; i < 6; i++) stable.recordPlace(false, 0, 0.85);

            const vClimb = buildPlayerAbilityVector(climbing, { boardFill: 0.85 });
            const vStable = buildPlayerAbilityVector(stable, { boardFill: 0.85 });

            expect(vClimb.features.boardFillVelocity).toBeGreaterThan(0.05);
            expect(vStable.features.boardFillVelocity).toBe(0);
            expect(vClimb.riskLevel).toBeGreaterThan(vStable.riskLevel);
        });

        it('lockRisk：firstMoveFreedom=0（dock 全锁死）→ lockRisk=1，riskLevel 显著抬升', () => {
            const p = new PlayerProfile(15);
            for (let i = 0; i < 6; i++) p.recordPlace(true, 1, 0.5);

            const safe = buildPlayerAbilityVector(p, { boardFill: 0.5, firstMoveFreedom: 8 });
            const lock = buildPlayerAbilityVector(p, { boardFill: 0.5, firstMoveFreedom: 0 });

            expect(safe.features.lockRisk).toBe(0);
            expect(lock.features.lockRisk).toBe(1);
            expect(lock.riskLevel).toBeGreaterThan(safe.riskLevel);
        });

        it('两者都未传时 lockRisk=0、boardFillVelocity=0，不对老调用方造成回归', () => {
            const p = new PlayerProfile(15);
            const v = buildPlayerAbilityVector(p, { boardFill: 0.4 });
            expect(v.features.lockRisk).toBe(0);
            expect(v.features.boardFillVelocity).toBe(0);
        });
    });

    describe('v2 — confidence 加 recencyDecay', () => {
        it('近期活跃玩家 recencyDecay≈1，confidence 更高', () => {
            const p = new PlayerProfile(15);
            for (let i = 0; i < 8; i++) p.recordPlace(true, 1, 0.4);
            // 模拟"刚刚结束上一局"
            p._lastSessionEndTs = Date.now() - 1000;

            const v = buildPlayerAbilityVector(p, { boardFill: 0.4, gameStats: { placements: 8 } });
            expect(v.features.recencyDecay).toBeGreaterThan(0.95);
        });

        it('长草玩家（30 天前）recencyDecay 衰减到 0.12 附近，confidence 显著下降', () => {
            const fresh = new PlayerProfile(15);
            const stale = new PlayerProfile(15);
            for (let i = 0; i < 8; i++) {
                fresh.recordPlace(true, 1, 0.4);
                stale.recordPlace(true, 1, 0.4);
            }
            fresh._lastSessionEndTs = Date.now() - 1000;
            stale._lastSessionEndTs = Date.now() - 30 * 86_400_000;   // 30 天前

            const vFresh = buildPlayerAbilityVector(fresh, { boardFill: 0.4, gameStats: { placements: 8 } });
            const vStale = buildPlayerAbilityVector(stale, { boardFill: 0.4, gameStats: { placements: 8 } });

            expect(vStale.features.recencyDecay).toBeLessThan(0.2);
            expect(vFresh.features.recencyDecay).toBeGreaterThan(0.95);
            expect(vFresh.confidence).toBeGreaterThan(vStale.confidence);
        });
    });

    describe('v2 — 各能力指标使用独立时间窗口', () => {
        it('返回 vector 暴露 windows 字段，control 短 / clearEfficiency 中', () => {
            const p = new PlayerProfile(20);
            for (let i = 0; i < 12; i++) p.recordPlace(true, 1, 0.4);

            const v = buildPlayerAbilityVector(p, { boardFill: 0.4 });
            expect(v.windows).toBeDefined();
            expect(v.windows.control).toBeLessThanOrEqual(v.windows.clearEfficiency);
        });

        it('profile 不实现 metricsForWindow 时回退到 metrics（向后兼容）', () => {
            const stub = {
                metrics: { missRate: 0.1, clearRate: 0.4, comboRate: 0.2, afkCount: 0, samples: 5, activeSamples: 5, multiClearRate: 0, perfectClearRate: 0, avgLines: 1, pickToPlaceMs: null, reactionSamples: 0 },
                cognitiveLoad: 0.3, engagementAPM: 6, frustrationLevel: 0,
                hadRecentNearMiss: false, needsRecovery: false,
                confidence: 0.4, lifetimePlacements: 60,
                playstyle: 'balanced', flowState: 'flow',
            };
            const v = buildPlayerAbilityVector(stub, { boardFill: 0.3 });
            expect(v.controlScore).toBeGreaterThan(0);
            expect(v.controlScore).toBeLessThanOrEqual(1);
        });
    });

    it('builds offline training samples from replay sessions', () => {
        const rows = [{
            id: 7,
            user_id: 'u1',
            score: 1280,
            strategy: 'normal',
            game_stats: { placements: 24, clears: 9, misses: 1 },
            frames: [
                { t: 'init', ps: { skill: 0.5, boardFill: 0.1, flowDeviation: 0.1, cognitiveLoad: 0.2, metrics: { clearRate: 0.2, missRate: 0, comboRate: 0 } } },
                { t: 'place', ps: { skill: 0.7, boardFill: 0.4, flowDeviation: 0.2, cognitiveLoad: 0.3, flowState: 'flow', playstyle: 'multi_clear', metrics: { clearRate: 0.45, missRate: 0.05, comboRate: 0.3 } } },
            ],
            analysis: { rating: 4, tags: ['steady'] },
        }];

        const data = buildAbilityTrainingDataset(rows);
        expect(data).toHaveLength(1);
        expect(data[0].features.skillLast).toBeCloseTo(0.7);
        expect(data[0].labels.finalScore).toBe(1280);
        expect(data[0].labels.tags).toContain('steady');
    });
});
