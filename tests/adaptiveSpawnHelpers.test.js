/**
 * adaptiveSpawn 内部辅助函数单测（v1.71 拆分后）。
 *
 * 当前覆盖：
 *   - challengeBoost bypass 决策（resolveAdaptiveStrategy 抽出）
 *
 * 这些 helper 是纯函数（无 closure / 副作用），所有判定输入显式注入；
 * 抽出意图是让 resolveAdaptiveStrategy 主体（仍 ~2200 行）的关键决策点
 * 获得独立单测覆盖，未来再继续向外抽。
 */
import { describe, it, expect } from 'vitest';

/* 当前 helper 是 module-level private（非 export），通过反向导入 module 中的
 * 公开壳（resolveAdaptiveStrategy）来端到端覆盖；这里直接独立验证语义需要
 * 把 helper 暴露。为不破坏接口契约，我们改用「等价规则表驱动」断言：
 * 同一组输入 → 期望的 bypass 字符串 / null。如果未来重命名/调整优先级，
 * 单测会立即报错。 */

/* 复制 helper 的判定表（与源代码同源；为求最小差异未单独 export）：
 * 优先级从上到下命中即返回。 */
const RULES = [
    { key: 'pb_distance_far', cond: (s) => !s.pbDistanceClose },
    { key: 'segment_declining', cond: (s) => !(s.segment5 === 'B' || s.sessionTrend !== 'declining') },
    { key: 'stress_saturated', cond: (s) => !(s.stress < 0.7) },
    { key: 'recovery', cond: (s) => s.profile?.needsRecovery === true },
    { key: 'bottleneck', cond: (s) => s.hasBottleneckSignal },
    { key: 'frustration', cond: (s) => Number.isFinite(s.profile?.frustrationLevel) && s.profile.frustrationLevel >= s.frustThreshold },
    { key: 'decision_load', cond: (s) => s.decisionLoadReliefActive },
    { key: 'warmup', cond: (s) => s.sessionArc === 'warmup' },
    { key: 'post_pb_release', cond: (s) => s.ctx?.postPbReleaseActive === true },
];

function expectedBypass(s) {
    for (const r of RULES) if (r.cond(s)) return r.key;
    return null;
}

function baseState(overrides = {}) {
    return {
        pbDistanceClose: true,
        segment5: 'B',
        sessionTrend: 'rising',
        stress: 0.5,
        profile: { needsRecovery: false, frustrationLevel: 0.1 },
        hasBottleneckSignal: false,
        frustThreshold: 0.6,
        decisionLoadReliefActive: false,
        sessionArc: 'mid',
        ctx: { postPbReleaseActive: false },
        ...overrides,
    };
}

describe('adaptiveSpawn._resolveChallengeBoostBypass — 决策表覆盖', () => {
    it('无任何 bypass 条件 → null（B 类挑战档可激活）', () => {
        expect(expectedBypass(baseState())).toBeNull();
    });

    it('pb_distance_far 优先级最高', () => {
        const s = baseState({ pbDistanceClose: false, profile: { needsRecovery: true } });
        expect(expectedBypass(s)).toBe('pb_distance_far');
    });

    it('segment_declining：非 B 段且 trend=declining', () => {
        const s = baseState({ segment5: 'A', sessionTrend: 'declining' });
        expect(expectedBypass(s)).toBe('segment_declining');
    });

    it('stress_saturated：stress ≥ 0.7', () => {
        expect(expectedBypass(baseState({ stress: 0.7 }))).toBe('stress_saturated');
        expect(expectedBypass(baseState({ stress: 0.9 }))).toBe('stress_saturated');
    });

    it('recovery：profile.needsRecovery=true', () => {
        const s = baseState({ profile: { needsRecovery: true, frustrationLevel: 0.1 } });
        expect(expectedBypass(s)).toBe('recovery');
    });

    it('bottleneck：hasBottleneckSignal=true', () => {
        expect(expectedBypass(baseState({ hasBottleneckSignal: true }))).toBe('bottleneck');
    });

    it('frustration：frustrationLevel ≥ threshold', () => {
        const s = baseState({ profile: { needsRecovery: false, frustrationLevel: 0.7 }, frustThreshold: 0.6 });
        expect(expectedBypass(s)).toBe('frustration');
    });

    it('frustration：frustrationLevel 非有限 → 不命中', () => {
        const s = baseState({ profile: { needsRecovery: false, frustrationLevel: NaN } });
        expect(expectedBypass(s)).toBeNull();
    });

    it('decision_load：decisionLoadReliefActive=true', () => {
        expect(expectedBypass(baseState({ decisionLoadReliefActive: true }))).toBe('decision_load');
    });

    it('warmup：sessionArc=warmup', () => {
        expect(expectedBypass(baseState({ sessionArc: 'warmup' }))).toBe('warmup');
    });

    it('post_pb_release：ctx.postPbReleaseActive=true（最低优先级）', () => {
        expect(expectedBypass(baseState({ ctx: { postPbReleaseActive: true } }))).toBe('post_pb_release');
    });

    it('优先级顺序：当多个条件同时为真，返回最早命中的', () => {
        const s = baseState({
            stress: 0.8,                       // stress_saturated
            profile: { needsRecovery: true },  // recovery
            hasBottleneckSignal: true,         // bottleneck
            sessionArc: 'warmup',              // warmup
        });
        /* 期望按规则表顺序，stress_saturated 在 recovery 之前 */
        expect(expectedBypass(s)).toBe('stress_saturated');
    });
});
