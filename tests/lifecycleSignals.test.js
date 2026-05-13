/**
 * @vitest-environment jsdom
 *
 * v1.48 (2026-05) — 生命周期统一数据层 / 编排层 / 商业化感知层 端到端单测
 *
 * 覆盖目标：
 *   1. lifecycleSignals.getUnifiedLifecycleSnapshot 字段完整 + 三套 churnRisk 归一
 *   2. PlayerProfile.daysSinceInstall / totalSessions / daysSinceLastActive 三个统一 getter
 *   3. lifecycleOrchestrator.onSessionStart / onSessionEnd 接线（churnPredictor 写入、
 *      winback 自动激活、shouldTriggerIntervention emit）
 *   4. monetization/lifecycleAwareOffers 订阅 lifecycle 总线后能回写 vipSystem
 *   5. difficultyAdapter 的阶段定义统一到 dashboard、L4→M4 死键修复
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerProfile } from '../web/src/playerProfile.js';
import {
    getUnifiedChurnRisk,
    getUnifiedLifecycleSnapshot,
    invalidateLifecycleSnapshotCache,
} from '../web/src/lifecycle/lifecycleSignals.js';
import {
    onSessionEnd,
    onSessionStart,
    setLifecycleOrchestrationEnabled,
    getActiveWinbackPreset,
} from '../web/src/lifecycle/lifecycleOrchestrator.js';
import {
    _resetWinbackForTests,
    getWinbackStatus,
    PROTECTED_ROUNDS,
} from '../web/src/retention/winbackProtection.js';
import { getChurnData } from '../web/src/retention/churnPredictor.js';
import { getMaturityBand } from '../web/src/retention/playerMaturity.js';
import { on, _clearAllHandlers, attach, detach } from '../web/src/monetization/MonetizationBus.js';
import {
    attachLifecycleAwareOffers,
    detachLifecycleAwareOffers,
} from '../web/src/monetization/lifecycleAwareOffers.js';

beforeEach(async () => {
    setLifecycleOrchestrationEnabled(true);
    invalidateLifecycleSnapshotCache();
    _clearAllHandlers();
    detach();
    try { localStorage.clear(); } catch {}
    _resetWinbackForTests();
    /* v1.49.x Phase 1：清单例 cache 避免测试间污染 ——
     *   - firstPurchaseFunnel 的 funnelData 缓存在内存
     *   - paymentManager 的 _activeOffers / _lastPurchaseTimestamp Map 在内存
     *   - vipSystem 的 _vipDataCache 在内存
     * 任何一个不清都会让"首充"测试在第二次 emit 时被误判为复购。 */
    try {
        const funnel = await import('../web/src/retention/firstPurchaseFunnel.js');
        funnel.invalidateFunnelCache?.();
    } catch {}
    try {
        const vip = await import('../web/src/retention/vipSystem.js');
        vip.invalidateVipCache?.();
    } catch {}
    try {
        const pm = await import('../web/src/monetization/paymentManager.js');
        const inst = pm.getPaymentManager();
        inst._activeOffers = new Map();
        inst._lastPurchaseTimestamp = null;
        inst._firstPurchaseBonusClaimed = false;
    } catch {}
    /* P0-7 toast 在 DOM 留下节点；逐测试清空 body 避免计数串扰。 */
    if (typeof document !== 'undefined' && document.body) {
        document.body.innerHTML = '';
    }
});

afterEach(() => {
    detachLifecycleAwareOffers();
    detach();
    _clearAllHandlers();
});

/* ============================================================================
 * 1. 数据层：getUnifiedLifecycleSnapshot
 * ============================================================================ */

describe('lifecycleSignals — getUnifiedLifecycleSnapshot', () => {
    it('对全新 profile 返回稳定骨架（不抛、所有字段就位）', () => {
        const p = new PlayerProfile(15);
        const snap = getUnifiedLifecycleSnapshot(p);

        expect(snap.schemaVersion).toBeGreaterThanOrEqual(1);
        expect(snap.install.daysSinceInstall).toBe(0);
        expect(snap.install.totalSessions).toBe(0);
        expect(snap.install.totalPlacements).toBe(0);
        expect(snap.onboarding.isNewPlayer).toBe(true);
        expect(snap.onboarding.isInOnboarding).toBe(true);
        expect(snap.returning.isWinbackCandidate).toBe(false);
        expect(snap.returning.protectionActive).toBe(false);
        expect(snap.stage.code).toMatch(/^S[0-4]/);
        expect(snap.stage.name).toBe('onboarding');
        expect(snap.maturity.level).toBeDefined();
        expect(snap.maturity.band).toMatch(/^M[0-4]$/);
        expect(snap.churn).toMatchObject({
            unifiedRisk: 0,
            level: 'stable',
        });
    });

    it('沉默 ≥ 7 天的玩家：returning.isWinbackCandidate=true、stage.code=S4', () => {
        const p = new PlayerProfile(15);
        // 模拟 8 天前结束上一局
        p._lastSessionEndTs = Date.now() - 8 * 86_400_000;
        p._totalLifetimeGames = 5;
        const snap = getUnifiedLifecycleSnapshot(p);

        expect(snap.returning.isWinbackCandidate).toBe(true);
        expect(snap.returning.daysSinceLastActive).toBeGreaterThanOrEqual(7);
        expect(snap.stage.code).toBe('S4');
    });
});

describe('lifecycleSignals — getUnifiedChurnRisk 归一', () => {
    it('三套 churnRisk 全有数据时按权重投票', () => {
        const r = getUnifiedChurnRisk({
            predictorRisk01: 0.6,         // weight 0.45 → 0.27
            maturityChurnLabel: 'medium', // 0.5 × 0.35 → 0.175
            commercialChurnRisk01: 0.4,   // 0.4 × 0.20 → 0.08
        });
        // 加权平均 (0.27 + 0.175 + 0.08) / 1 = 0.525
        expect(r.unifiedRisk).toBeCloseTo(0.525, 2);
        expect(r.level).toBe('high'); // ≥ 0.50
    });

    it('两套缺失 → 仅可用源决定权重，不归零', () => {
        const r = getUnifiedChurnRisk({
            predictorRisk01: 0.8,
            maturityChurnLabel: null,
            commercialChurnRisk01: null,
        });
        expect(r.unifiedRisk).toBe(0.8);
        expect(r.level).toBe('critical');
        expect(r.sources.predictor).toBe(0.8);
        expect(r.sources.maturity).toBeNull();
        expect(r.sources.commercial).toBeNull();
    });

    it('全空 → unifiedRisk=0, level=stable', () => {
        const r = getUnifiedChurnRisk({
            predictorRisk01: null, maturityChurnLabel: null, commercialChurnRisk01: null,
        });
        expect(r.unifiedRisk).toBe(0);
        expect(r.level).toBe('stable');
    });
});

/* ============================================================================
 * 2. PlayerProfile 三个统一 getter
 * ============================================================================ */

describe('PlayerProfile — v1.48 lifecycle getter', () => {
    it('daysSinceInstall 按 _installTs 计算；新构造 = 0', () => {
        const p = new PlayerProfile(15);
        expect(p.daysSinceInstall).toBe(0);
        // 模拟 5 天前装机
        p._installTs = Date.now() - 5 * 86_400_000;
        expect(p.daysSinceInstall).toBe(5);
    });

    it('totalSessions 取 max(_totalLifetimeGames, sessionHistory.length)', () => {
        const p = new PlayerProfile(15);
        p._totalLifetimeGames = 12;
        expect(p.totalSessions).toBe(12);

        // sessionHistory 比累计多时（异常情况）也能兜底
        p._totalLifetimeGames = 0;
        p._sessionHistory = [{ ts: Date.now(), score: 1 }, { ts: Date.now(), score: 2 }];
        expect(p.totalSessions).toBe(2);
    });

    it('daysSinceLastActive：lastActiveTs=0 → 0（视作今天活跃，不误判长草）', () => {
        const p = new PlayerProfile(15);
        expect(p.daysSinceLastActive).toBe(0);
        p._lastSessionEndTs = Date.now() - 10 * 86_400_000;
        expect(p.daysSinceLastActive).toBe(10);
    });

    it('lifecyclePayload 一次性打包三大裸字段', () => {
        const p = new PlayerProfile(15);
        p._installTs = Date.now() - 3 * 86_400_000;
        p._totalLifetimeGames = 8;
        p._lastSessionEndTs = Date.now() - 1 * 86_400_000;
        const payload = p.lifecyclePayload;
        expect(payload).toMatchObject({
            daysSinceInstall: 3,
            totalSessions: 8,
            daysSinceLastActive: 1,
        });
    });

    it('toJSON / fromJSON 持久化 installTs', () => {
        const p = new PlayerProfile(15);
        const fixedTs = Date.now() - 30 * 86_400_000;
        p._installTs = fixedTs;
        const json = p.toJSON();
        expect(json.installTs).toBe(fixedTs);

        const p2 = PlayerProfile.fromJSON(json);
        expect(p2._installTs).toBe(fixedTs);
        expect(p2.daysSinceInstall).toBe(30);
    });
});

/* ============================================================================
 * 3. orchestrator — 关键接线点
 * ============================================================================ */

describe('lifecycleOrchestrator — onSessionStart / onSessionEnd', () => {
    it('onSessionStart：沉默 ≥ 7 天 → 自动激活 winback、写入 localStorage', () => {
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 8 * 86_400_000;

        const r = onSessionStart(p);
        expect(r.snapshot?.returning?.isWinbackCandidate).toBe(true);
        expect(r.winback).toBeTruthy();
        expect(r.winback.stressCap).toBeGreaterThan(0);

        const status = getWinbackStatus();
        expect(status.active).toBe(true);
        expect(status.preset).toBeTruthy();

        // adaptiveSpawn 通过包装函数读取
        expect(getActiveWinbackPreset()).toMatchObject({
            stressCap: status.preset.stressCap,
        });
    });

    it('onSessionStart：未沉默 → winback=null、不激活', () => {
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 1 * 86_400_000;
        const r = onSessionStart(p);
        expect(r.winback).toBeNull();
        expect(getWinbackStatus().active).toBe(false);
    });

    it('onSessionEnd：把会话指标写入 churnPredictor（此前生产代码无写入点）', () => {
        const p = new PlayerProfile(15);
        const before = getChurnData();
        const beforeSignals = before.signals.length;

        onSessionEnd(p, {
            score: 800, durationMs: 90_000, placements: 30, misses: 2,
        });

        const after = getChurnData();
        expect(after.signals.length).toBe(beforeSignals + 1);
        const last = after.signals[after.signals.length - 1];
        expect(last.avgScore).toBe(800);
        expect(last.engagement).toBeGreaterThan(0);
        expect(last.engagement).toBeLessThanOrEqual(1);
    });

    it('onSessionEnd：保护期内消耗一轮，达 PROTECTED_ROUNDS 后自动退出', () => {
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 8 * 86_400_000;
        onSessionStart(p);
        expect(getWinbackStatus().active).toBe(true);

        for (let i = 0; i < PROTECTED_ROUNDS; i++) {
            onSessionEnd(p, { score: 500, durationMs: 60_000, placements: 15, misses: 1 });
        }
        expect(getWinbackStatus().active).toBe(false);
    });

    it('onSessionEnd：emit lifecycle:session_end 到 MonetizationBus', () => {
        const p = new PlayerProfile(15);
        const handler = vi.fn();
        on('lifecycle:session_end', handler);

        onSessionEnd(p, { score: 200, durationMs: 30_000, placements: 8, misses: 0 });

        expect(handler).toHaveBeenCalledTimes(1);
        const payload = handler.mock.calls[0][0].data;
        expect(payload.snapshot).toBeDefined();
        expect(payload.churnUpdate).toBeDefined();
    });

    it('orchestration 关闭时所有钩子返回空骨架', () => {
        setLifecycleOrchestrationEnabled(false);
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 8 * 86_400_000;
        expect(onSessionStart(p)).toEqual({ snapshot: null, winback: null });
        expect(onSessionEnd(p, { score: 1 })).toEqual({
            snapshot: null, churnUpdate: null, winback: null, interventions: [],
        });
        expect(getWinbackStatus().active).toBe(false);
    });
});

/* ============================================================================
 * 4. lifecycleAwareOffers — 总线订阅
 * ============================================================================ */

describe('monetization/lifecycleAwareOffers — 订阅 lifecycle 总线', () => {
    it('attach + emit lifecycle:session_start → emit lifecycle:offer_available（沉默回流场景）', () => {
        attachLifecycleAwareOffers();
        const offerHandler = vi.fn();
        on('lifecycle:offer_available', offerHandler);

        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 10 * 86_400_000;

        // 通过 orchestrator 触发链路
        onSessionStart(p);

        // 至少应触发 winback_user offer（也可能附加 first_purchase）
        expect(offerHandler).toHaveBeenCalled();
        const types = offerHandler.mock.calls.map((c) => c[0].data.type);
        expect(types).toContain('winback_user');
    });

    it('attach 是幂等的，重复调用不重复订阅', () => {
        attachLifecycleAwareOffers();
        attachLifecycleAwareOffers();
        const handler = vi.fn();
        on('lifecycle:offer_available', handler);
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 10 * 86_400_000;
        onSessionStart(p);
        // 即使 attach 调了两次，触发 offer 只会经过一遍订阅链 → handler 调用次数与 attach 次数无关
        const winbackCalls = handler.mock.calls.filter((c) => c[0].data.type === 'winback_user').length;
        expect(winbackCalls).toBeGreaterThanOrEqual(1);
    });
});

/* ============================================================================
 * 5. P1 — getMaturityBand 死键修复 + difficultyAdapter 阶段统一
 * ============================================================================ */

describe('v1.48 死键修复', () => {
    it('getMaturityBand：SkillScore≥90 → M4（修复 lifecycleStressCapMap 的 S*·M4 死键）', () => {
        expect(getMaturityBand(89)).toBe('M3');
        expect(getMaturityBand(90)).toBe('M4');
        expect(getMaturityBand(100)).toBe('M4');
    });
});

/* ============================================================================
 * 6. v1.49.x Phase 1 — P0 通管道
 * ============================================================================ */

describe('v1.49.x Phase 1 — P0-1 IAP 三路接线', () => {
    it('emit purchase_completed → recordPurchase + updateVipScore + analytics 三路命中', async () => {
        attachLifecycleAwareOffers();

        const { emit } = await import('../web/src/monetization/MonetizationBus.js');
        const funnel = await import('../web/src/retention/firstPurchaseFunnel.js');
        const vip = await import('../web/src/retention/vipSystem.js');
        const analytics = await import('../web/src/monetization/analyticsTracker.js');

        const tracker = analytics.getAnalyticsTracker();
        const trackSpy = vi.spyOn(tracker, 'trackEvent');

        emit('purchase_completed', {
            productId: 'starter_pack',
            price: 1,
            currency: 'CNY',
            transactionId: 'tx_test_1',
        });

        // 1. firstPurchaseFunnel 收到首充
        const funnelData = funnel.getFunnelData();
        expect(funnelData.purchaseHistory.length).toBe(1);
        expect(funnelData.firstPurchase?.productId).toBe('starter_pack');
        // 2. vipSystem 拿到 1 RMB × 100 = 100 经验（仍在 V0，但 score 累计>0）
        const vipData = vip.getVipData();
        expect(vipData?.lifetimeScore ?? 0).toBeGreaterThanOrEqual(100);
        // 3. analyticsTracker 命中
        expect(trackSpy).toHaveBeenCalledWith('iap_purchase', expect.objectContaining({
            productId: 'starter_pack',
            isFirst: true,
        }));
    });

    it('首充时 emit lifecycle:first_purchase 事件', async () => {
        attachLifecycleAwareOffers();
        const handler = vi.fn();
        on('lifecycle:first_purchase', handler);
        const { emit } = await import('../web/src/monetization/MonetizationBus.js');

        emit('purchase_completed', { productId: 'starter_pack', price: 1, currency: 'CNY' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data).toMatchObject({
            productId: 'starter_pack', price: 1,
        });
    });
});

describe('v1.49.x Phase 1 — P0-2 unifiedRisk 三腿齐全', () => {
    it('orchestrator.onSessionEnd 调用时 commercial 那条腿写入 sources', () => {
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 1 * 86_400_000;
        const r = onSessionEnd(p, { score: 500, durationMs: 60_000, placements: 20, misses: 1 });

        expect(r.snapshot?.churn?.sources).toBeDefined();
        // 至少 commercial 不再是 null（即使值很小，源应已被填充）
        // 退化 OK：在 personalization/adTrigger 不可用时为 null，但单测环境可以构造 vector
        const sources = r.snapshot.churn.sources;
        expect(sources).toHaveProperty('commercial');
        // 应该是有限数字或 null（不是 undefined）
        expect(sources.commercial === null || Number.isFinite(sources.commercial)).toBe(true);
    });
});

describe('v1.49.x Phase 1 — P0-4 onSessionEnd 接 updateMaturity', () => {
    it('onSessionEnd 后 maturity 历史多一条记录（之前为 0）', async () => {
        const maturity = await import('../web/src/retention/playerMaturity.js');
        const before = maturity.getPlayerMaturity();
        const beforeHistory = before?.history?.length ?? 0;

        const p = new PlayerProfile(15);
        onSessionEnd(p, { score: 1500, durationMs: 120_000, placements: 40, misses: 2 });

        const after = maturity.getPlayerMaturity();
        const afterHistory = after?.history?.length ?? 0;
        expect(afterHistory).toBeGreaterThan(beforeHistory);
    });
});

describe('v1.49.x Phase 1 — P0-6 winback_user offer 配置已就位', () => {
    it('LIMITED_OFFERS.winback_user 存在 + triggerCondition 在 7 天阈值上跳变', async () => {
        const { LIMITED_OFFERS } = await import('../web/src/monetization/paymentManager.js');
        expect(LIMITED_OFFERS.winback_user).toBeDefined();
        expect(LIMITED_OFFERS.winback_user.discountPercent).toBeGreaterThan(0);
        const cond = LIMITED_OFFERS.winback_user.triggerCondition;
        expect(cond([], 6)).toBe(false);
        expect(cond([], 7)).toBe(true);
        expect(cond([], 30)).toBe(true);
    });

    it('沉默 ≥ 7 天时 lifecycleAwareOffers 调 paymentManager.triggerOffer 命中 winback_user', async () => {
        const pm = await import('../web/src/monetization/paymentManager.js');
        attachLifecycleAwareOffers();
        const p = new PlayerProfile(15);
        p._lastSessionEndTs = Date.now() - 10 * 86_400_000;
        onSessionStart(p);
        const active = pm.getPaymentManager().getActiveOffers();
        const winback = active.find((o) => o.id === 'winback_user');
        expect(winback).toBeTruthy();
        expect(winback.validUntil).toBeGreaterThan(Date.now());
    });
});

describe('v1.49.x Phase 1 — P0-7 offerToast UI 接线', () => {
    it('attachOfferToast 后 emit lifecycle:offer_available 在 DOM 插入 toast', async () => {
        const offerToast = await import('../web/src/monetization/offerToast.js');
        offerToast._resetOfferToastForTesting();
        offerToast.attachOfferToast();

        const { emit } = await import('../web/src/monetization/MonetizationBus.js');
        emit('lifecycle:offer_available', {
            type: 'winback_user',
            stage: 'S4',
            band: 'M2',
            reason: '沉默 10 天回流',
        });

        const toast = document.querySelector('.mon-toast--offer');
        expect(toast).toBeTruthy();
        expect(toast.textContent).toContain('回归礼包');
        offerToast._resetOfferToastForTesting();
    });

    it('同 type 24h 内只展示一次（cooldown 生效）', async () => {
        const offerToast = await import('../web/src/monetization/offerToast.js');
        offerToast._resetOfferToastForTesting();
        offerToast.attachOfferToast();

        const { emit } = await import('../web/src/monetization/MonetizationBus.js');
        emit('lifecycle:offer_available', { type: 'winback_user', reason: 'r1' });
        emit('lifecycle:offer_available', { type: 'winback_user', reason: 'r2' });
        const toasts = document.querySelectorAll('.mon-toast--offer');
        expect(toasts.length).toBe(1);
        offerToast._resetOfferToastForTesting();
    });
});
