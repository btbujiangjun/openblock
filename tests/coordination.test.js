/**
 * coordination.test.js — 增长飞轮协调层单测
 * 覆盖：底层信号统一、损失厌恶标量化、硬约束、跨飞轮冲突解消、受治理老虎机。
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
    shapeContribution,
    scalarize,
    objectiveVector,
    constraints,
    getObjectiveWeights,
    setObjectiveWeights,
    resetObjectiveWeights,
} from '../web/src/coordination/flywheelObjective.js';
import {
    buildUnifiedSignals,
    setLtvNormRef,
} from '../web/src/coordination/unifiedSignals.js';
import {
    coordinate,
    arbitrate,
    arbitrateUaBid,
} from '../web/src/coordination/policyArbiter.js';
import {
    CoordinationBandit,
    contextKey,
} from '../web/src/coordination/coordinationBandit.js';

describe('flywheelObjective — 损失厌恶标量化', () => {
    it('同幅度下损失被放大多于收益（loss aversion）', () => {
        const gain = shapeContribution(0.5);
        const loss = shapeContribution(-0.5);
        expect(gain).toBeGreaterThan(0);
        expect(loss).toBeLessThan(0);
        expect(Math.abs(loss)).toBeGreaterThan(Math.abs(gain)); // 放大损失
    });

    it('收益边际递减（凹）', () => {
        expect(shapeContribution(1)).toBeCloseTo(1, 5);
        expect(shapeContribution(0.5)).toBeGreaterThan(0.5); // x^0.85 > x for x<1
    });

    it('scalarize 按权重聚合', () => {
        const u = scalarize({ revenue: 1, retention: 0, experience: 0 }, { revenue: 1, retention: 0, experience: 0 });
        expect(u).toBeCloseTo(1, 5);
    });
});

describe('flywheelObjective — objectiveVector / constraints', () => {
    it('插屏在高 churn/高 flow 下重罚留存与体验', () => {
        const v = objectiveVector({ domain: 'ad', choice: 'interstitial' }, { churnRisk: 0.8, flow: 0.8 });
        expect(v.revenue).toBeGreaterThan(0);
        expect(v.retention).toBeLessThan(0);
        expect(v.experience).toBeLessThan(0);
    });

    it('flow 中禁插屏、保护付费/新手/召回', () => {
        expect(constraints({ flow: 0.7 }).allowInterstitial).toBe(false);
        expect(constraints({ payerScore: 0.7 }).allowInterstitial).toBe(false);
        expect(constraints({ lifecycleStage: 'S0' }).allowInterstitial).toBe(false);
        expect(constraints({ winbackActive: true }).allowInterstitial).toBe(false);
        expect(constraints({}).allowInterstitial).toBe(true);
    });

    it('高 churn 禁加压、禁动态加价', () => {
        const g = constraints({ churnRisk: 0.7 });
        expect(g.allowDifficultyPressure).toBe(false);
        expect(g.allowDynamicMarkup).toBe(false);
        expect(g.reasons).toContain('churn_protect');
    });

    it('激励视频恒允许', () => {
        expect(constraints({ flow: 0.9, payerScore: 0.9 }).allowRewarded).toBe(true);
    });
});

describe('unifiedSignals — 底层信号统一 SSOT', () => {
    beforeEach(() => setLtvNormRef(20));

    it('选取唯一权威源并冻结 provenance', () => {
        const s = buildUnifiedSignals({
            churn: { value: 0.42, level: 'medium' },
            ltv: { ltv30: 10, bid: 4, confidence: 'high' },
            seg: { segment5: 'C', lifecycleStage: 'S2', maturityBand: 'M2' },
            profile: { skill: 0.7, flow: 0.5, frustration: 0.2, engagement: 0.6 },
            commercial: { payerScore: 0.3, adFatigue: 0.1 },
        });
        expect(s.churnRisk).toBeCloseTo(0.42, 5);
        expect(s.ltvBid).toBe(4);
        expect(s.ltvNorm).toBeCloseTo(0.5, 5); // 10/20
        expect(s.lifecycleStage).toBe('S2');
        expect(s.provenance.churnRisk).toMatch(/lifecycleSignals/);
        expect(s.provenance.ltv).toMatch(/ltvPredictor/);
    });

    it('缺失源安全兜底，不产出 undefined', () => {
        const s = buildUnifiedSignals({});
        expect(s.churnRisk).toBe(0);
        expect(s.segment5).toBe('A');
        expect(s.lifecycleStage).toBe('S0');
        expect(Number.isFinite(s.ltvNorm)).toBe(true);
    });
});

describe('policyArbiter — 跨飞轮冲突解消（同一信号·同一目标·同一约束）', () => {
    beforeEach(() => resetObjectiveWeights());

    it('高 churn 玩家：救济 + 抑制插屏 + 留存礼包 + 降出价（方向一致）', () => {
        const signals = buildUnifiedSignals({
            churn: { value: 0.8, level: 'critical' },
            ltv: { ltv30: 10, bid: 4 },
            seg: { lifecycleStage: 'S2' },
            profile: { flow: 0.1, frustration: 0.6 },
        });
        const plan = coordinate(signals, { userId: 'u-churn' });
        expect(plan.experience.intent).toBe('relief');
        expect(plan.ad.allowInterstitial).toBe(false);
        expect(plan.offer.choice).toBe('retention_gift');
        expect(plan.uaBid.bid).toBeLessThan(plan.uaBid.baseBid); // 脆弱 cohort 降价买量
    });

    it('付费玩家心流中：插屏被硬约束砍掉', () => {
        const signals = buildUnifiedSignals({
            churn: { value: 0.1 },
            ltv: { ltv30: 18, bid: 10 },
            seg: { lifecycleStage: 'S3', valueTier: 'T4' },
            profile: { flow: 0.85, frustration: 0.1 },
            commercial: { payerScore: 0.8 },
        });
        const plan = coordinate(signals, { userId: 'u-whale' });
        expect(plan.ad.allowInterstitial).toBe(false);
        expect(plan.ad.choice).not.toBe('interstitial');
        expect(plan.gates.reasons).toContain('flow_protect');
    });

    it('新手 S0：不插屏、不加价', () => {
        const signals = buildUnifiedSignals({
            churn: { value: 0.2 },
            seg: { lifecycleStage: 'S0' },
            profile: { flow: 0.3 },
        });
        const plan = coordinate(signals, { userId: 'u-new' });
        expect(plan.ad.allowInterstitial).toBe(false);
        expect(plan.offer.allowDynamicMarkup).toBe(false);
    });

    it('arbitrate 单域返回 ranked + choice（确定性最优在首位）', () => {
        const signals = buildUnifiedSignals({
            churn: { value: 0.1 }, ltv: { ltv30: 10, bid: 4 },
            seg: { lifecycleStage: 'S2' }, profile: { flow: 0.2 },
        });
        const r = arbitrate('ad', signals, { userId: 'u-arb' });
        expect(Array.isArray(r.ranked)).toBe(true);
        expect(r.ranked[0].choice).toBe(r.choice);   // sealed bandit → 首位=确定性最优
        expect(r.ranked.every((x) => Number.isFinite(x.utility))).toBe(true);
    });

    it('uaBid 随 churn 单调收缩', () => {
        const low = arbitrateUaBid({ ltvBid: 10, churnRisk: 0.0 });
        const high = arbitrateUaBid({ ltvBid: 10, churnRisk: 0.9 });
        expect(low.bid).toBe(10);
        expect(high.bid).toBeLessThan(low.bid);
    });

    it('权重可注入并影响排序', () => {
        setObjectiveWeights({ revenue: 1, retention: 0, experience: 0 });
        expect(getObjectiveWeights().revenue).toBeCloseTo(1, 5);
        resetObjectiveWeights();
    });
});

describe('coordinationBandit — 受治理（默认 sealed → 确定性）', () => {
    it('sealed 时返回候选首项、不探索', () => {
        const b = new CoordinationBandit({ persist: false });
        const out = b.select('ctx', ['none', 'rewarded', 'interstitial'], 'u1');
        expect(out.arm).toBe('none');     // 候选首项 = arbiter 确定性最优
        expect(out.explored).toBe(false);
    });

    it('单候选直接返回', () => {
        const b = new CoordinationBandit({ persist: false });
        expect(b.select('ctx', ['rewarded']).arm).toBe('rewarded');
    });

    it('update 偏好高奖励臂（Beta 后验）', () => {
        const b = new CoordinationBandit({ persist: false });
        for (let i = 0; i < 50; i++) { b.update('ctx', 'A', 1); b.update('ctx', 'B', 0); }
        const snap = b.snapshot();
        expect(snap['ctx::A'].a).toBeGreaterThan(snap['ctx::B'].a);
        expect(snap['ctx::B'].b).toBeGreaterThan(snap['ctx::A'].b);
    });

    it('contextKey 离散化稳定', () => {
        const k = contextKey({ lifecycleStage: 'S2', churnRisk: 0.7, flow: 0.7, payerScore: 0.7 });
        expect(k).toBe('S2|cH|fH|pH');
    });
});
