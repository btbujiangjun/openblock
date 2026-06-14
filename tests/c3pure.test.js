/**
 * @vitest-environment jsdom
 * C3 纯逻辑：experimentUnified(DA-5) / mlGovernance(ML-1) / complexityGuard(EX-1) /
 * feedGuard(EX-2) / consentManager(CS-3)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _store = vi.hoisted(() => {
    let m = {};
    return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        clear: () => { m = {}; },
    };
});
vi.stubGlobal('localStorage', _store);

import { resolveVariant, mergeRegistries, __setPausedForTest, getUnifiedVariant } from '../web/src/monetization/experiment/experimentUnified.js';
import { isMlFeatureEnabled, getMlGovernanceReport, ML_FEATURES } from '../web/src/monetization/ml/mlGovernance.js';
import { governComplexityStep, evaluateArcHealth } from '../web/src/engine/complexityGuard.js';
import { makeFeedRecord, auditPlatformDivergence } from '../web/src/monetization/feedGuard.js';
import { defaultConsent, applyMinorPolicy, isAllowed, saveConsent, loadConsent, needsConsent } from '../web/src/privacy/consentManager.js';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

describe('DA-5 experimentUnified', () => {
    it('稳定分桶 + 同用户同桶', () => {
        const a = resolveVariant({ userId: 'u1', experiment: 'e', variants: [0, 1] });
        const b = resolveVariant({ userId: 'u1', experiment: 'e', variants: [0, 1] });
        expect(a.bucket).toBe(b.bucket);
    });
    it('暂停回退对照桶', () => {
        const r = resolveVariant({ userId: 'u1', experiment: 'e', variants: ['ctrl', 'treat'], pausedSet: new Set(['e']) });
        expect(r.bucket).toBe(0);
        expect(r.value).toBe('ctrl');
        expect(r.paused).toBe(true);
    });
    it('QA 覆写', () => {
        const r = resolveVariant({ userId: 'u1', experiment: 'e', variants: ['a', 'b'], overrides: { e: 1 } });
        expect(r.value).toBe('b');
        expect(r.forced).toBe(true);
    });
    it('mergeRegistries 合并内置 + lifecycle', () => {
        const reg = mergeRegistries({ my_lc_exp: { variants: [0, 1] } });
        expect(reg.my_lc_exp).toBeDefined();
        expect(reg.interstitial_delay).toBeDefined(); // abTest 内置
    });
    it('getUnifiedVariant 暂停时不报曝光', () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true }));
        __setPausedForTest(new Set(['e']));
        const r = getUnifiedVariant('u1', 'e', ['c', 't']);
        expect(r.paused).toBe(true);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('ML-1 mlGovernance', () => {
    it('默认全部封存', () => {
        expect(isMlFeatureEnabled('ziln_ltv', 'u')).toBe(false);
        expect(isMlFeatureEnabled('bandit_spawn', 'u')).toBe(false);
        expect(getMlGovernanceReport().every((f) => f.sealed)).toBe(true);
    });
    it('canary 按 rollout 灰度', () => {
        ML_FEATURES.ziln_ltv.status = 'canary';
        ML_FEATURES.ziln_ltv.rolloutPct = 100;
        expect(isMlFeatureEnabled('ziln_ltv', 'anyuser')).toBe(true);
        ML_FEATURES.ziln_ltv.rolloutPct = 0;
        expect(isMlFeatureEnabled('ziln_ltv', 'anyuser')).toBe(false);
        ML_FEATURES.ziln_ltv.status = 'sealed'; // 还原
    });
});

describe('EX-1 complexityGuard', () => {
    it('限制单步上升斜率', () => {
        const r = governComplexityStep(0.5, 0.9, { risingStreak: 0 });
        expect(r.difficulty).toBeLessThanOrEqual(0.5 + 0.06 + 1e-9);
    });
    it('连升触发强制回落', () => {
        let prev = 0.2; let st = { risingStreak: 4 };
        const r = governComplexityStep(prev, prev + 0.05, st);
        expect(r.relief).toBe(true);
        expect(r.difficulty).toBeLessThan(prev);
    });
    it('evaluateArcHealth 检出违规', () => {
        const bad = evaluateArcHealth([0, 0.2, 0.4, 0.6]); // 斜率 0.2 > 0.06
        expect(bad.ok).toBe(false);
        const good = evaluateArcHealth([0, 0.05, 0.1, 0.05, 0.1]);
        expect(good.ok).toBe(true);
    });
});

describe('EX-2 feedGuard', () => {
    it('夹紧助力强度', () => {
        const rec = makeFeedRecord({ playerId: 'p', platform: 'web', assist: 0.9, reason: 'rescue' });
        expect(rec.assist).toBe(0.35);
        expect(rec.clamped).toBe(true);
    });
    it('跨平台差异审计', () => {
        expect(auditPlatformDivergence([{ assist: 0.2 }, { assist: 0.22 }]).ok).toBe(true);
        const bad = auditPlatformDivergence([{ assist: 0.1 }, { assist: 0.3 }]);
        expect(bad.ok).toBe(false);
        expect(bad.divergence).toBeCloseTo(0.2, 4);
    });
});

describe('CS-3 consentManager', () => {
    it('默认 opt-in 关闭', () => {
        const d = defaultConsent();
        expect(d.functional).toBe(true);
        expect(d.analytics).toBe(false);
    });
    it('未成年人策略强制关闭', () => {
        const c = applyMinorPolicy({ ...defaultConsent(), minor: true, analytics: true, ads_personalization: true });
        expect(c.analytics).toBe(false);
        expect(c.ads_personalization).toBe(false);
    });
    it('isAllowed + 持久化', () => {
        expect(needsConsent()).toBe(true);
        saveConsent({ analytics: true, ads_personalization: false });
        expect(needsConsent()).toBe(false);
        const c = loadConsent();
        expect(isAllowed(c, 'analytics')).toBe(true);
        expect(isAllowed(c, 'ads_personalization')).toBe(false);
        expect(isAllowed(c, 'functional')).toBe(true);
    });
});
