/**
 * PP5 / NN-F3.3: baseRules 7 条 DSL 镜像 parity fuzz。
 *
 * 对每条规则单独跑 500 次随机输入对比 oracle（=原 helper 完整复刻），
 * 再额外跑 500 次"全链路串行"对比 DSL 数组 vs oracle 链式 helper，
 * 验证 priority 顺序与 baseRules 原始执行序等价。
 *
 * 任何字段级偏差即 fail。
 */
import { describe, it, expect } from 'vitest';
import { runSpawnRules } from '../web/src/spawn/spawnRulesDsl.js';
import {
    NEAR_MISS_RULE, FRUSTRATION_RULE, NEEDS_RECOVERY_RULE, BORED_RULE,
    ONBOARDING_RULE, LATE_MOMENTUM_RULE, ROUNDS_SINCE_CLEAR_RULE, HOLES_RULE,
    BASE_RULES_DSL,
} from '../web/src/spawn/baseRulesDsl.js';

/* ---------- oracles (复刻 adaptiveSpawn.js helper) ---------- */
function oNearMiss(s, profile, eng) {
    if (!profile?.hadRecentNearMiss) return s;
    return { ...s, clearGuarantee: Math.max(s.clearGuarantee, eng?.nearMissClearGuarantee ?? 2) };
}
function oFrustration(s, profile, frustThreshold) {
    if (!(profile?.frustrationLevel >= frustThreshold)) return s;
    return { ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.3 };
}
function oNeedsRecovery(s, profile) {
    if (!profile?.needsRecovery) return s;
    return { ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.5 };
}
function oBored(s, flow, eng) {
    if (flow !== 'bored') return s;
    return { ...s, diversityBoost: eng?.noveltyDiversityBoost ?? 0.15 };
}
function oOnboarding(s, profile) {
    if (!profile?.isInOnboarding) return s;
    return { ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.4 };
}
function oLateMomentum(s, profile) {
    if (!(profile?.sessionPhase === 'late' && profile.momentum < -0.3)) return s;
    return { ...s, clearGuarantee: Math.max(s.clearGuarantee, 1),
        sizePreference: Math.min(s.sizePreference, -0.2) };
}
function oRsc(s, rsc) {
    if (!(rsc >= 2)) return s;
    let cg = Math.max(s.clearGuarantee, 2);
    let sp = s.sizePreference;
    if (rsc >= 4) { cg = Math.max(cg, 3); sp = Math.min(sp, -0.35); }
    return { ...s, clearGuarantee: cg, sizePreference: sp };
}
function oHoles(s, holes, topoCfg) {
    if (!(holes >= (topoCfg?.holeClearGuaranteeAt ?? 2))) return s;
    const cg = Number.isFinite(topoCfg?.holeClearGuarantee) ? topoCfg.holeClearGuarantee : 2;
    return { ...s,
        clearGuarantee: Math.max(s.clearGuarantee, cg),
        sizePreference: Math.min(s.sizePreference, topoCfg?.holeSizePreference ?? -0.22) };
}

/* ---------- 随机输入 ---------- */
function rndState() {
    return {
        clearGuarantee: Math.floor(Math.random() * 6),
        sizePreference: Math.random() * 2 - 1,
        diversityBoost: Math.random() * 0.3,
    };
}
function rndCtx() {
    return {
        profile: {
            hadRecentNearMiss: Math.random() < 0.4,
            frustrationLevel: Math.random() < 0.5 ? Math.random() : -1,
            needsRecovery: Math.random() < 0.4,
            isInOnboarding: Math.random() < 0.3,
            sessionPhase: Math.random() < 0.5 ? 'late' : 'mid',
            momentum: Math.random() * 2 - 1,
        },
        eng: {
            nearMissClearGuarantee: Math.random() < 0.5 ? Math.floor(Math.random() * 4) : undefined,
            noveltyDiversityBoost: Math.random() < 0.5 ? Math.random() * 0.3 : undefined,
        },
        frustThreshold: Math.random() * 0.8,
        flow: Math.random() < 0.5 ? 'bored' : 'normal',
        roundsSinceClear: Math.floor(Math.random() * 6),
        holes: Math.floor(Math.random() * 6),
        topoCfg: {
            holeClearGuaranteeAt: Math.random() < 0.7 ? Math.floor(Math.random() * 4) : undefined,
            holeClearGuarantee: Math.random() < 0.7 ? Math.floor(Math.random() * 4) : undefined,
            holeSizePreference: Math.random() < 0.7 ? -Math.random() : undefined,
        },
    };
}

function fieldsEqual(a, b) {
    if (a.clearGuarantee !== b.clearGuarantee) return false;
    if (Math.abs((a.sizePreference ?? 0) - (b.sizePreference ?? 0)) > 1e-12) return false;
    if (Math.abs((a.diversityBoost ?? 0) - (b.diversityBoost ?? 0)) > 1e-12) return false;
    return true;
}

describe('PP5 / NN-F3.3 baseRules DSL parity', () => {
    it.each([
        ['nearMiss',       NEAR_MISS_RULE,           (s, c) => oNearMiss(s, c.profile, c.eng)],
        ['frustration',    FRUSTRATION_RULE,         (s, c) => oFrustration(s, c.profile, c.frustThreshold)],
        ['needsRecovery',  NEEDS_RECOVERY_RULE,      (s, c) => oNeedsRecovery(s, c.profile)],
        ['bored',          BORED_RULE,               (s, c) => oBored(s, c.flow, c.eng)],
        ['onboarding',     ONBOARDING_RULE,          (s, c) => oOnboarding(s, c.profile)],
        ['lateMomentum',   LATE_MOMENTUM_RULE,       (s, c) => oLateMomentum(s, c.profile)],
        ['rsc',            ROUNDS_SINCE_CLEAR_RULE,  (s, c) => oRsc(s, c.roundsSinceClear)],
        ['holes',          HOLES_RULE,               (s, c) => oHoles(s, c.holes, c.topoCfg)],
    ])('单条规则 parity：%s（500 次）', (_name, rule, oracle) => {
        for (let i = 0; i < 500; i++) {
            const st = rndState();
            const ctx = rndCtx();
            const { state: got } = runSpawnRules([rule], st, ctx);
            const exp = oracle(st, ctx);
            expect(fieldsEqual(got, exp)).toBe(true);
        }
    });

    it('全链路 parity：BASE_RULES_DSL 数组 vs oracle 链式（500 次）', () => {
        for (let i = 0; i < 500; i++) {
            const st = rndState();
            const ctx = rndCtx();
            const { state: got } = runSpawnRules(BASE_RULES_DSL, st, ctx);

            /* oracle 链按 priority 降序：nearMiss → frustration → needsRecovery
             * → bored → onboarding → lateMomentum → rsc → holes
             * （与 BASE_RULES_DSL 中 priority 数值排序一致） */
            let exp = st;
            exp = oNearMiss(exp, ctx.profile, ctx.eng);
            exp = oFrustration(exp, ctx.profile, ctx.frustThreshold);
            exp = oNeedsRecovery(exp, ctx.profile);
            exp = oBored(exp, ctx.flow, ctx.eng);
            exp = oOnboarding(exp, ctx.profile);
            exp = oLateMomentum(exp, ctx.profile);
            exp = oRsc(exp, ctx.roundsSinceClear);
            exp = oHoles(exp, ctx.holes, ctx.topoCfg);
            expect(fieldsEqual(got, exp)).toBe(true);
        }
    });

    it('disabled abTest 关闭单条规则 → 与跳过该 oracle 等价', () => {
        const st = { clearGuarantee: 0, sizePreference: 0, diversityBoost: 0 };
        const ctx = {
            profile: { hadRecentNearMiss: true, isInOnboarding: true },
            eng: {}, frustThreshold: Infinity, flow: '',
            roundsSinceClear: 0, holes: 0, topoCfg: {},
        };
        const { state: gotAll } = runSpawnRules(BASE_RULES_DSL, st, ctx);
        const { state: gotNoNm } = runSpawnRules(BASE_RULES_DSL, st, ctx, {
            disabled: ['near-miss'],
        });
        expect(gotAll.clearGuarantee).toBe(2); /* 任一命中均抬到 2 */
        expect(gotNoNm.clearGuarantee).toBe(2); /* onboarding 也抬 */
        /* 测纯隔离效果：仅 nearMiss 命中、其他全关 */
        const ctx2 = { ...ctx, profile: { hadRecentNearMiss: true } };
        const { state: only } = runSpawnRules([NEAR_MISS_RULE], st, ctx2);
        expect(only.clearGuarantee).toBe(2);
    });
});
