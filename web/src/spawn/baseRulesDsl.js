/**
 * PP5 / NN-F3.3: baseRules 7 条 DSL 镜像。
 *
 * 把 adaptiveSpawn.js 中 7 条独立 helper 转写为 DSL 规则数组。
 * **不替换** adaptiveSpawn 主路径——平行共存，parity 测试守护。
 * 后续 F3.6 拆除旧 helper 前，必须 DSL 形式跑通 spawnGolden（PP4 模板）。
 *
 * 规则顺序遵循 adaptiveSpawn._applySpawnHintsBaseRules 的执行序：
 *   nearMiss → frustration → needsRecovery → bored → onboarding
 *   → lateMomentum → roundsSinceClear → holes
 *
 * 注意：本数组中规则的 priority 用降序数字（从大到小执行）映射上述顺序。
 * 这样既保留原始语义，又允许将来按数字微调而非整体重排。
 */

import { POC_HOLES_RULE } from './spawnRulesDsl.js';

/* ---------- 1. nearMiss ---------- */
export const NEAR_MISS_RULE = {
    id: 'near-miss',
    priority: 700,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'profile.hadRecentNearMiss → cg ≥ eng.nearMissClearGuarantee (默认 2)',
    when: (ctx) => !!ctx?.profile?.hadRecentNearMiss,
    apply: (s, ctx) => ({
        ...s,
        clearGuarantee: Math.max(s.clearGuarantee, ctx?.eng?.nearMissClearGuarantee ?? 2),
    }),
};

/* ---------- 2. frustration（非幂等：sp 直接赋值 -0.3） ---------- */
export const FRUSTRATION_RULE = {
    id: 'frustration',
    priority: 600,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'frustrationLevel ≥ frustThreshold → cg ≥ 2 + sp = -0.3 (非幂等覆盖)',
    when: (ctx) => (ctx?.profile?.frustrationLevel ?? -Infinity) >= (ctx?.frustThreshold ?? Infinity),
    apply: (s) => ({ ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.3 }),
};

/* ---------- 3. needsRecovery（非幂等：sp = -0.5） ---------- */
export const NEEDS_RECOVERY_RULE = {
    id: 'needs-recovery',
    priority: 500,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'profile.needsRecovery → cg ≥ 2 + sp = -0.5 (覆盖更负值，与原码同)',
    when: (ctx) => !!ctx?.profile?.needsRecovery,
    apply: (s) => ({ ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.5 }),
};

/* ---------- 4. bored（直接赋值 diversityBoost） ---------- */
export const BORED_RULE = {
    id: 'bored',
    priority: 400,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'flow === bored → diversityBoost = eng.noveltyDiversityBoost ?? 0.15',
    when: (ctx) => ctx?.flow === 'bored',
    apply: (s, ctx) => ({ ...s, diversityBoost: ctx?.eng?.noveltyDiversityBoost ?? 0.15 }),
};

/* ---------- 5. onboarding ---------- */
export const ONBOARDING_RULE = {
    id: 'onboarding',
    priority: 300,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'profile.isInOnboarding → cg ≥ 2 + sp = -0.4',
    when: (ctx) => !!ctx?.profile?.isInOnboarding,
    apply: (s) => ({ ...s, clearGuarantee: Math.max(s.clearGuarantee, 2), sizePreference: -0.4 }),
};

/* ---------- 6. lateMomentum ---------- */
export const LATE_MOMENTUM_RULE = {
    id: 'late-momentum',
    priority: 200,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'sessionPhase=late & momentum < -0.3 → cg ≥ 1 + sp ≤ -0.2',
    when: (ctx) => ctx?.profile?.sessionPhase === 'late'
        && (ctx?.profile?.momentum ?? 0) < -0.3,
    apply: (s) => ({
        ...s,
        clearGuarantee: Math.max(s.clearGuarantee, 1),
        sizePreference: Math.min(s.sizePreference, -0.2),
    }),
};

/* ---------- 7. roundsSinceClear（两档阈值，单条规则内分支） ---------- */
export const ROUNDS_SINCE_CLEAR_RULE = {
    id: 'rounds-since-clear',
    priority: 150,
    since: 'PP5',
    owner: 'gameplay',
    comment: 'rsc ≥ 2 → cg ≥ 2; rsc ≥ 4 → 进一步 cg ≥ 3 + sp ≤ -0.35',
    when: (ctx) => (ctx?.roundsSinceClear ?? 0) >= 2,
    apply: (s, ctx) => {
        const rsc = ctx?.roundsSinceClear ?? 0;
        let cg = Math.max(s.clearGuarantee, 2);
        let sp = s.sizePreference;
        if (rsc >= 4) {
            cg = Math.max(cg, 3);
            sp = Math.min(sp, -0.35);
        }
        return { ...s, clearGuarantee: cg, sizePreference: sp };
    },
};

/* holes 复用 OO5 已写的 PoC（PP4 已 fuzz-parity） */
export { POC_HOLES_RULE as HOLES_RULE };

export const BASE_RULES_DSL = [
    NEAR_MISS_RULE,
    FRUSTRATION_RULE,
    NEEDS_RECOVERY_RULE,
    BORED_RULE,
    ONBOARDING_RULE,
    LATE_MOMENTUM_RULE,
    ROUNDS_SINCE_CLEAR_RULE,
    POC_HOLES_RULE,
];
