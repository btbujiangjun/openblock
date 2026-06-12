/**
 * 离线画像先验注入（playerAnalytics → adaptiveSpawn）单测。
 * 覆盖：buildSpawnPrior 结构/钳制、applySpawnPrior 偏置方向与门控、isDelightStarved 个性化。
 */
import { describe, it, expect } from 'vitest';
import { buildSpawnPrior, analyzePlayer } from '../web/src/analysis/playerAnalytics.js';
import { applySpawnPrior } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

const SHAPE_KEYS = ['lines', 'rects', 'squares', 'tshapes', 'zshapes', 'lshapes', 'jshapes'];
const FLAT = { lines: 1, rects: 1, squares: 1, tshapes: 1, zshapes: 1, lshapes: 1, jshapes: 1 };

function makeSession(id, n, step, meta = {}) {
    const frames = [];
    let score = 0;
    for (let i = 0; i < n; i++) {
        const s = step(i, score);
        score = s.score;
        frames.push({ t: 'spawn', dock: [{ id: `b${i}`, shape: s.shape ?? [[1, 1]], colorIdx: s.colorIdx ?? 0, placed: false }] });
        frames.push({
            t: 'place', i: 0, x: 0, y: 0,
            ps: {
                pv: 4, score: s.score, boardFill: s.boardFill ?? 0.4,
                spawnGeo: { holes: s.holes ?? 1, flatness: s.flatness ?? 0.7, nearFullLines: s.nearFull ?? 0, contiguousRegions: s.regions ?? 2, concaveCorners: s.concave ?? 2 },
                metrics: { pickToPlaceMs: 800, thinkMs: 2000, missRate: 0.05, comboRate: 0.1 },
                multiClearRate: 0.2, comboRate: 0.1, ability: { features: { lockRisk: 0 } },
            },
        });
    }
    return {
        id, score, strategy: meta.strategy ?? 'normal',
        game_stats: { placements: n, clears: Math.floor(n / 2), misses: 0, maxCombo: 3 },
        analysis: { rating: 3, tags: [] }, frames,
    };
}

describe('buildSpawnPrior', () => {
    it('样本充足时产出含 shapeBias(7键) 的精简先验', () => {
        const sessions = [0, 1, 2, 3].map((g) => makeSession(`g${g}`, 20, (i, sc) => ({ score: sc + 40, boardFill: 0.4 })));
        const result = analyzePlayer(sessions);
        const prior = buildSpawnPrior(result);
        expect(prior).not.toBeNull();
        expect(prior.v).toBe(1);
        expect(Object.keys(prior.shapeBias).sort()).toEqual([...SHAPE_KEYS].sort());
        for (const k of SHAPE_KEYS) {
            expect(prior.shapeBias[k]).toBeGreaterThanOrEqual(-0.5);
            expect(prior.shapeBias[k]).toBeLessThanOrEqual(0.5);
        }
        expect(prior.strength).toBeGreaterThanOrEqual(0);
        expect(prior.strength).toBeLessThanOrEqual(1);
    });

    it('数据不足返回 null', () => {
        const r = analyzePlayer([makeSession('tiny', 2, (i, sc) => ({ score: sc + 10 }))]);
        expect(buildSpawnPrior(r)).toBeNull();
        expect(buildSpawnPrior(null)).toBeNull();
    });
});

describe('applySpawnPrior', () => {
    const prior = { shapeBias: { lines: 0.4, rects: 0, squares: -0.4, tshapes: 0, zshapes: 0, lshapes: 0, jshapes: 0 } };

    it('λ=0 或无 bias 时不改权重', () => {
        expect(applySpawnPrior(FLAT, prior, { lambda: 0 }).shapeWeights).toEqual(FLAT);
        expect(applySpawnPrior(FLAT, null, { lambda: 0.5 }).shapeWeights).toEqual(FLAT);
    });

    it('顺玩家(comply)：擅长项升权、不擅长项降权', () => {
        const r = applySpawnPrior(FLAT, prior, { intent: 'relief', lambda: 0.5, cap: 0.35 });
        expect(r.mode).toBe('comply');
        expect(r.shapeWeights.lines).toBeGreaterThan(1);   // +0.4
        expect(r.shapeWeights.squares).toBeLessThan(1);    // -0.4
        expect(r.shapeWeights.tshapes).toBe(1);            // bias 0 不变
    });

    it('训练(train)：方向取反——擅长项降权以暴露弱项', () => {
        const r = applySpawnPrior(FLAT, prior, { intent: 'flow', lambda: 0.5, trainingEnabled: true });
        expect(r.mode).toBe('train');
        expect(r.shapeWeights.lines).toBeLessThan(1);
        expect(r.shapeWeights.squares).toBeGreaterThan(1);
    });

    it('困境帧禁止训练，强制 comply', () => {
        const r = applySpawnPrior(FLAT, prior, { intent: 'flow', lambda: 0.5, trainingEnabled: true, distressed: true });
        expect(r.mode).toBe('comply');
    });

    it('cap 限幅：乘子不超过 1±cap', () => {
        const strong = { shapeBias: { lines: 0.5, rects: 0, squares: 0, tshapes: 0, zshapes: 0, lshapes: 0, jshapes: 0 } };
        const r = applySpawnPrior(FLAT, strong, { intent: 'relief', lambda: 1, cap: 0.2 });
        expect(r.shapeWeights.lines).toBeLessThanOrEqual(1.2 + 1e-9);
    });

    it('不就地修改入参', () => {
        const src = { ...FLAT };
        applySpawnPrior(src, prior, { intent: 'relief', lambda: 0.5 });
        expect(src).toEqual(FLAT);
    });

    it('cap=0 等价关闭（乘子恒为1）', () => {
        const r = applySpawnPrior(FLAT, prior, { intent: 'relief', lambda: 1, cap: 0 });
        for (const k of SHAPE_KEYS) expect(r.shapeWeights[k]).toBe(1);
    });

    it('负 cap 被 clamp 到 0（不反转）', () => {
        const r = applySpawnPrior(FLAT, prior, { intent: 'relief', lambda: 1, cap: -0.5 });
        for (const k of SHAPE_KEYS) expect(r.shapeWeights[k]).toBe(1);
    });

    it('shapeWeights 含 0 的键不会变负', () => {
        const w = { ...FLAT, lines: 0 };
        const r = applySpawnPrior(w, prior, { intent: 'relief', lambda: 1 });
        expect(r.shapeWeights.lines).toBe(0);
    });

    it('bias 键缺失时跳过该键', () => {
        const partial = { shapeBias: { lines: 0.3 } };
        const r = applySpawnPrior(FLAT, partial, { intent: 'relief', lambda: 0.5 });
        expect(r.shapeWeights.lines).toBeGreaterThan(1);
        expect(r.shapeWeights.squares).toBe(1);
    });

    it('harvest/sprint/pressure 属于 comply（不训练）', () => {
        for (const intent of ['harvest', 'sprint', 'pressure']) {
            const r = applySpawnPrior(FLAT, prior, { intent, lambda: 0.5, trainingEnabled: true });
            expect(r.mode).toBe('comply');
        }
    });
});

describe('isDelightStarved 个性化', () => {
    it('注入更紧的 starvationThreshold 时会更早进入饥渴', () => {
        const p = new PlayerProfile();
        // 平台默认 web=7。注入 prior 阈值=3、强度=1 → 个性化阈值收紧（<7）
        p.setSpawnPrior({ starvationThreshold: 3, strength: 1 });
        p._roundsSinceLastDelight = 5;
        // 收紧后 5 轮应已饥渴（默认 7 轮则不会）
        const personalized = p.isDelightStarved();

        const p2 = new PlayerProfile();
        p2._roundsSinceLastDelight = 5;
        const baseline = p2.isDelightStarved();

        expect(baseline).toBe(false);
        expect(personalized).toBe(true);
    });

    it('starvationThreshold > 平台默认时不延后（clamp 上界）', () => {
        const p = new PlayerProfile();
        p.setSpawnPrior({ starvationThreshold: 20, strength: 1 });
        p._roundsSinceLastDelight = 6;
        // 平台默认 7，阈值 20 但 clamp 到 7 → 6<7 → 不饥渴
        expect(p.isDelightStarved()).toBe(false);
        p._roundsSinceLastDelight = 7;
        expect(p.isDelightStarved()).toBe(true);
    });

    it('strength=0 时个性化不生效', () => {
        const p = new PlayerProfile();
        p.setSpawnPrior({ starvationThreshold: 2, strength: 0 });
        p._roundsSinceLastDelight = 5;
        expect(p.isDelightStarved()).toBe(false); // 平台默认7, 5<7
    });

    it('setSpawnPrior 拒绝数组', () => {
        const p = new PlayerProfile();
        p.setSpawnPrior([1, 2, 3]);
        expect(p._spawnPrior).toBeNull();
    });

    it('无先验时回退平台默认', () => {
        const p = new PlayerProfile();
        p._roundsSinceLastDelight = 100;
        expect(p.isDelightStarved()).toBe(true);
    });
});
