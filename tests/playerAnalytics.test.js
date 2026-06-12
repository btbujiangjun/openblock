import { describe, it, expect } from 'vitest';
import {
    PLAYER_ANALYTICS_VERSION,
    analyzePlayer,
    extractMoveObservations,
    anchorNorm,
    softmax,
    classifyShape,
} from '../web/src/analysis/playerAnalytics.js';

/* ----------------------------------------------------------------------------
 * 合成会话工厂：生成带 frames[].ps 的回放行。
 *
 * 每步通过 step(i) 回调定制 ps 字段，模拟不同玩家行为。
 * -------------------------------------------------------------------------- */
function makeSession(id, n, step, meta = {}) {
    const frames = [];
    let score = 0;
    for (let i = 0; i < n; i++) {
        const s = step(i, score);
        score = s.score;
        // 每步前发一个 spawn 帧，提供 dock 形状/颜色
        frames.push({
            t: 'spawn',
            dock: [
                { id: `b${i}`, shape: s.shape ?? [[1, 1]], colorIdx: s.colorIdx ?? 0, placed: false },
            ],
        });
        frames.push({
            t: 'place',
            i: 0,
            x: 0,
            y: 0,
            ps: {
                pv: 4,
                score: s.score,
                boardFill: s.boardFill,
                spawnGeo: {
                    holes: s.holes ?? 0,
                    flatness: s.flatness ?? 0.7,
                    nearFullLines: s.nearFull ?? 0,
                    contiguousRegions: s.regions ?? 2,
                    concaveCorners: s.concave ?? 2,
                },
                metrics: {
                    pickToPlaceMs: s.pickToPlaceMs ?? null,
                    thinkMs: s.thinkMs ?? 2000,
                    missRate: s.missRate ?? 0.05,
                    comboRate: s.comboRate ?? 0.1,
                },
                multiClearRate: s.multiClearRate ?? 0,
                comboRate: s.comboRate ?? 0.1,
                ability: { features: { lockRisk: s.lockRisk ?? 0 } },
            },
        });
    }
    return {
        id,
        score,
        strategy: meta.strategy ?? 'normal',
        game_stats: { placements: n, clears: meta.clears ?? Math.floor(n / 2), misses: meta.misses ?? 0, maxCombo: meta.maxCombo ?? 2 },
        analysis: { rating: 3, tags: [] },
        frames,
    };
}

describe('playerAnalytics — 数学工具', () => {
    it('anchorNorm: p10→0.1, p50→0.5, p90→0.9，并支持 invert', () => {
        const a = [1, 3, 7];
        expect(anchorNorm(1, a)).toBeCloseTo(0.1, 3);
        expect(anchorNorm(3, a)).toBeCloseTo(0.5, 3);
        expect(anchorNorm(7, a)).toBeCloseTo(0.9, 3);
        // invert：越小越好
        expect(anchorNorm(1, a, true)).toBeCloseTo(0.9, 3);
        expect(anchorNorm(7, a, true)).toBeCloseTo(0.1, 3);
        // 非有限值兜底中性 0.5
        expect(anchorNorm(NaN, a)).toBe(0.5);
    });

    it('softmax: 归一化且最大值主导', () => {
        const p = softmax([0, 1, 2], 1);
        const sum = p.reduce((s, x) => s + x, 0);
        expect(sum).toBeCloseTo(1, 6);
        expect(p[2]).toBeGreaterThan(p[1]);
        expect(p[1]).toBeGreaterThan(p[0]);
    });

    it('classifyShape: 基础类别', () => {
        expect(classifyShape([[1, 1, 1, 1]])).toBe('line');
        expect(classifyShape([[1, 1], [1, 1]])).toBe('square');
        expect(classifyShape([[1]])).toBe('dot');
        expect(classifyShape([[1, 0], [1, 1]])).toBe('corner');
    });
});

describe('playerAnalytics — 观测抽取', () => {
    it('展平 place 帧、推断消行(scoreDelta>0)与形状/颜色', () => {
        const sess = makeSession('s1', 4, (i, score) => ({
            score: score + (i % 2 === 0 ? 40 : 0),
            boardFill: 0.4,
            shape: [[1, 1, 1, 1]],
            colorIdx: 3,
        }));
        const obs = extractMoveObservations([sess]);
        expect(obs).toHaveLength(4);
        // 第 0 步无 prevPs，scoreDelta 为 null；第 2 步分数增长 → cleared
        expect(obs[0].scoreDelta).toBeNull();
        expect(obs[2].cleared).toBe(true);
        expect(obs[1].shapeCategory).toBe('line');
        expect(obs[1].colorIdx).toBe(3);
    });

    it('空 / 无 frames 输入返回空数组', () => {
        expect(extractMoveObservations([])).toEqual([]);
        expect(extractMoveObservations([{ id: 1 }])).toEqual([]);
        expect(extractMoveObservations(null)).toEqual([]);
    });
});

describe('playerAnalytics — 顶层画像', () => {
    it('产出完整结构与版本号，分值落在 [0,1]', () => {
        const sess = makeSession('s1', 20, (i, score) => ({
            score: score + (i % 2 === 0 ? 60 : 0),
            boardFill: 0.45,
            holes: 1,
            pickToPlaceMs: 1200,
            multiClearRate: 0.3,
        }), { clears: 10, maxCombo: 3 });

        const r = analyzePlayer([sess]);
        expect(r.version).toBe(PLAYER_ANALYTICS_VERSION);
        expect(r.ability.skillScore).toBeGreaterThanOrEqual(0);
        expect(r.ability.skillScore).toBeLessThanOrEqual(1);
        for (const dim of Object.values(r.ability.dims)) {
            expect(dim.value).toBeGreaterThanOrEqual(0);
            expect(dim.value).toBeLessThanOrEqual(1);
            expect(dim.confidence).toBeGreaterThanOrEqual(0);
        }
        const probSum = Object.values(r.preference.playstyle.distribution).reduce((s, x) => s + x, 0);
        expect(probSum).toBeCloseTo(1, 2);
        expect(r.explain.length).toBeGreaterThan(0);
        expect(r.meta.sufficientData).toBe(true);
    });

    it('反应快的玩家 reaction 维度高于反应慢的玩家', () => {
        const fast = makeSession('f', 16, (i, score) => ({ score: score + 40, boardFill: 0.4, pickToPlaceMs: 350, holes: 1 }));
        const slow = makeSession('s', 16, (i, score) => ({ score: score + 40, boardFill: 0.4, pickToPlaceMs: 3800, holes: 1 }));
        const rFast = analyzePlayer([fast]);
        const rSlow = analyzePlayer([slow]);
        expect(rFast.ability.dims.reaction.value).toBeGreaterThan(rSlow.ability.dims.reaction.value);
    });

    it('低空洞/稳定盘面的拓扑规划高于高空洞/碎片化盘面', () => {
        const clean = makeSession('c', 18, (i, score) => ({ score: score + 30, boardFill: 0.4, holes: 0, regions: 1, concave: 1, flatness: 0.9 }));
        const messy = makeSession('m', 18, (i, score) => ({ score: score + 30, boardFill: 0.7, holes: 6, regions: 12, concave: 14, flatness: 0.2 }));
        const rClean = analyzePlayer([clean]);
        const rMessy = analyzePlayer([messy]);
        expect(rClean.ability.dims.topology.value).toBeGreaterThan(rMessy.ability.dims.topology.value);
    });

    it('多消/清屏玩家风格分布主导为 multi_clear 或 perfect_hunter', () => {
        const multi = makeSession('mc', 20, (i, score) => ({
            score: score + (i % 2 === 0 ? 120 : 0),
            boardFill: i % 2 === 0 ? 0.0 : 0.5,
            multiClearRate: 0.9,
            holes: 1,
        }), { clears: 10, maxCombo: 4 });
        const r = analyzePlayer([multi]);
        expect(['multi_clear', 'perfect_hunter']).toContain(r.preference.playstyle.dominant);
    });

    it('激进玩家(高 fill + 高 velocity)风险偏好高于稳健玩家', () => {
        const aggressive = makeSession('a', 16, (i, score) => ({
            score: score + (i % 4 === 0 ? 80 : 0),
            boardFill: Math.min(0.9, 0.3 + i * 0.04),
            holes: 2,
        }));
        const cautious = makeSession('c', 16, (i, score) => ({
            score: score + 40,
            boardFill: 0.3,
            holes: 0,
        }));
        const rA = analyzePlayer([aggressive]);
        const rC = analyzePlayer([cautious]);
        expect(rA.preference.riskAppetite.value).toBeGreaterThan(rC.preference.riskAppetite.value);
    });

    it('数据不足时 sufficientData=false，置信度低但不崩溃', () => {
        const tiny = makeSession('t', 3, (i, score) => ({ score: score + 20, boardFill: 0.3 }));
        const r = analyzePlayer([tiny]);
        expect(r.meta.sufficientData).toBe(false);
        expect(r.confidence).toBeLessThan(0.3);
        expect(r.ability.skillScore).toBeGreaterThanOrEqual(0);
    });

    it('完全空输入返回中性骨架，不抛异常', () => {
        const r = analyzePlayer([]);
        expect(r.meta.observations).toBe(0);
        expect(r.ability.skillScore).toBeGreaterThanOrEqual(0);
        expect(r.preference.playstyle.dominant).toBeDefined();
    });

    it('节奏：深思玩家 label=deliberate，速断玩家 label=snappy', () => {
        const slow = makeSession('d', 12, (i, score) => ({ score: score + 30, boardFill: 0.4, thinkMs: 6000 }));
        const fast = makeSession('q', 12, (i, score) => ({ score: score + 30, boardFill: 0.4, thinkMs: 900 }));
        expect(analyzePlayer([slow]).preference.tempo.label).toBe('deliberate');
        expect(analyzePlayer([fast]).preference.tempo.label).toBe('snappy');
    });
});

/* ----------------------------------------------------------------------------
 * v2 新增：能力第 6 维 consistency / traits / spawnAdvice / summary
 * -------------------------------------------------------------------------- */
describe('playerAnalytics v2 — 精细维度', () => {
    it('能力含第 6 维 consistency，雷达可消费 6 维', () => {
        const sess = makeSession('s', 18, (i, score) => ({ score: score + 40, boardFill: 0.4, holes: 1 }));
        const r = analyzePlayer([sess]);
        expect(r.ability.dims.consistency).toBeDefined();
        expect(r.ability.dims.consistency.value).toBeGreaterThanOrEqual(0);
        expect(Object.keys(r.ability.dims)).toHaveLength(6);
    });

    it('稳定玩家(每局每步得分接近)的 consistency 高于忽高忽低玩家', () => {
        // 稳定：每局 20 步、每 2 步清 1 行、得分均匀
        const steady = [0, 1, 2].map((g) => makeSession(`st${g}`, 20, (i, score) => ({ score: score + (i % 2 === 0 ? 40 : 0), boardFill: 0.4, holes: 1 })));
        // 波动：有的局疯狂得分，有的局几乎不得分
        const volatile = [0, 1, 2].map((g) => makeSession(`vo${g}`, 20, (i, score) => ({ score: score + (g === 1 ? 0 : i % 2 === 0 ? 200 : 0), boardFill: g === 1 ? 0.85 : 0.4, holes: g === 1 ? 5 : 1 })));
        const rSteady = analyzePlayer(steady);
        const rVol = analyzePlayer(volatile);
        expect(rSteady.ability.dims.consistency.value).toBeGreaterThan(rVol.ability.dims.consistency.value);
    });

    it('traits：trend / endurance / clutch 字段齐全且有界', () => {
        const sessions = [0, 1, 2, 3].map((g) => makeSession(`g${g}`, 20, (i, score) => ({ score: score + 40 + g * 20, boardFill: 0.4, holes: 1 }), {}));
        sessions.forEach((s, g) => { s.start_time = 1000 + g * 100000; });
        const r = analyzePlayer(sessions);
        expect(r.traits.trend.value).toBeGreaterThanOrEqual(-1);
        expect(r.traits.trend.value).toBeLessThanOrEqual(1);
        expect(['improving', 'stable', 'declining']).toContain(r.traits.trend.label);
        expect(r.traits.endurance.value).toBeGreaterThanOrEqual(0);
        expect(r.traits.clutch.value).toBeGreaterThanOrEqual(0);
    });

    it('trend：每步得分逐局上升 → improving', () => {
        const sessions = [0, 1, 2, 3, 4].map((g) => makeSession(`u${g}`, 16, (i, score) => ({ score: score + 20 + g * 40, boardFill: 0.4, holes: 1 })));
        sessions.forEach((s, g) => { s.start_time = 1000 + g * 100000; });
        const r = analyzePlayer(sessions);
        expect(r.traits.trend.label).toBe('improving');
    });

    it('spawnAdvice：结构完整，难度随能力变化，含形状胜任度/舒适带/救济节奏', () => {
        const strong = makeSession('hi', 24, (i, score) => ({ score: score + 150, boardFill: 0.45, holes: 0, pickToPlaceMs: 400, multiClearRate: 0.8 }), { maxCombo: 6 });
        const weak = makeSession('lo', 12, (i, score) => ({ score: score + (i % 5 === 0 ? 20 : 0), boardFill: 0.8, holes: 5, pickToPlaceMs: 3500 }), { maxCombo: 1 });
        const rStrong = analyzePlayer([strong, strong]);
        const rWeak = analyzePlayer([weak]);
        const adv = rStrong.spawnAdvice;
        expect(adv).toBeDefined();
        expect(['easy', 'normal', 'hard']).toContain(adv.recommendedDifficulty);
        expect(adv.targetStress.value).toBeGreaterThanOrEqual(-0.3);
        expect(adv.targetStress.value).toBeLessThanOrEqual(0.6);
        expect(adv.relief.reliefAfterRounds).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(adv.shapeCompetence)).toBe(true);
        // 强玩家推荐难度不低于弱玩家
        const order = { easy: 0, normal: 1, hard: 2 };
        expect(order[adv.recommendedDifficulty]).toBeGreaterThanOrEqual(order[rWeak.spawnAdvice.recommendedDifficulty]);
        // 低置信（弱玩家单局）个性化强度应较低
        expect(rWeak.spawnAdvice.personalizationStrength).toBeLessThan(1);
    });

    it('summary 为非空白话总结字符串', () => {
        const sess = makeSession('s', 18, (i, score) => ({ score: score + 40, boardFill: 0.4, holes: 1 }));
        const r = analyzePlayer([sess]);
        expect(typeof r.summary).toBe('string');
        expect(r.summary.length).toBeGreaterThan(10);
        expect(r.summary).toContain('综合能力');
    });
});
