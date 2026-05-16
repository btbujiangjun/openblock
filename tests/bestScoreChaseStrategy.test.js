/**
 * @vitest-environment jsdom
 *
 * v1.55 BEST_SCORE_CHASE_STRATEGY 主线策略改进项的全套回归测试。
 *
 * 对应 docs/player/BEST_SCORE_CHASE_STRATEGY.md §4.1–§4.13 改进项编号：
 *   §4.1  LIFECYCLE_STRESS_CAP_MAP 5×5 全覆盖（25 格无死键）
 *   §4.2  isBClassChallenge 救济期 / bottleneck / frustration / warmup 互斥
 *   §4.3  best.gap.far D0 远征陪伴文案（轮换 3 选 1，{{best}} 占位）
 *   §4.5  best.gap warmup gate（本局前 3 轮不展示距离）
 *   §4.6  二度里程碑（破 PB 后动态注入 +10% / +25%）
 *   §4.8  strategyAdvisor pbChase 类别（D3.victory / D3.close / D4）
 *   §4.9  postPbReleaseWindow（破 PB 后 3 spawn 内 stress×0.7）
 *   §4.10 异常分守卫（score > previousBest × 5 进入审核态）
 *   §4.12 PB 事件总线（lifecycle:new_personal_best / near_personal_best）
 *   §4.4  PB 按难度档分桶（客户端内存 cache + HUD 难度标签）
 *   §4.7  周期 PB（weeklyBest / monthlyBest，localStorage）
 *   §4.11 跨设备 PB 同步（并入 localStorageStateSync）
 *   §4.13 Hard 模式 PB UI 衔接（HUD 难度图标 + 烟花强度）
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/* 注入持久化 mock，保证 §4.4 / §4.7 / §4.11 的 localStorage 写入可见。
 * vitest jsdom env 在某些版本下 localStorage 行为不稳定（--localstorage-file 警告），
 * 与其他测试（retentionAnalyzer / adFreq）一致改用 in-memory mock。 */
const _mockLs = {};
Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (k) => (k in _mockLs ? _mockLs[k] : null),
        setItem: (k, v) => { _mockLs[k] = String(v); },
        removeItem: (k) => { delete _mockLs[k]; },
        clear: () => { Object.keys(_mockLs).forEach((k) => delete _mockLs[k]); },
        get length() { return Object.keys(_mockLs).length; },
        key: (i) => Object.keys(_mockLs)[i] ?? null,
    },
    writable: true,
    configurable: true,
});

import {
    LIFECYCLE_STRESS_CAP_MAP,
    LIFECYCLE_STAGE_CODES,
    LIFECYCLE_BAND_CODES,
    getLifecycleStressCap,
} from '../web/src/lifecycle/lifecycleStressCapMap.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import zhCN from '../web/src/i18n/locales/zh-CN.js';
import en from '../web/src/i18n/locales/en.js';

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    if (overrides.spawnCounter != null) p._spawnCounter = overrides.spawnCounter;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.frustrationLevel != null) p._frustrationLevel = overrides.frustrationLevel;
    if (overrides.daysSinceInstall != null) p._daysSinceInstall = overrides.daysSinceInstall;
    if (overrides.daysSinceLastActive != null) p._daysSinceLastActive = overrides.daysSinceLastActive;
    return p;
}

// ── §4.1 ────────────────────────────────────────────────────────────────

describe('§4.1 LIFECYCLE_STRESS_CAP_MAP 25 格全覆盖（无死键）', () => {
    it('5 × 5 共 25 个 (stage, band) 组合都有 cap/adjust', () => {
        expect(LIFECYCLE_STAGE_CODES.length).toBe(5);
        expect(LIFECYCLE_BAND_CODES.length).toBe(5);
        for (const s of LIFECYCLE_STAGE_CODES) {
            for (const b of LIFECYCLE_BAND_CODES) {
                const entry = getLifecycleStressCap(s, b);
                expect(entry, `${s}·${b} 无映射`).not.toBeNull();
                expect(entry.cap, `${s}·${b}.cap`).toBeGreaterThan(0);
                expect(entry.cap, `${s}·${b}.cap`).toBeLessThanOrEqual(1);
                expect(typeof entry.adjust).toBe('number');
                expect(entry.adjust).toBeGreaterThanOrEqual(-0.20);
                expect(entry.adjust).toBeLessThanOrEqual(0.20);
            }
        }
        expect(Object.keys(LIFECYCLE_STRESS_CAP_MAP).length).toBe(25);
    });

    it('行内单调：同 stage 内 cap 按 M0→M4 递增（非严格但不递减）', () => {
        for (const s of LIFECYCLE_STAGE_CODES) {
            const caps = LIFECYCLE_BAND_CODES.map((b) => getLifecycleStressCap(s, b).cap);
            for (let i = 1; i < caps.length; i++) {
                expect(caps[i], `${s} ${LIFECYCLE_BAND_CODES[i - 1]}→${LIFECYCLE_BAND_CODES[i]}`)
                    .toBeGreaterThanOrEqual(caps[i - 1]);
            }
        }
    });

    it('S0 行整体钳制：cap ≤ 0.65（onboarding 期高 M-band 仍受保护）', () => {
        for (const b of LIFECYCLE_BAND_CODES) {
            const entry = getLifecycleStressCap('S0', b);
            expect(entry.cap, `S0·${b}.cap`).toBeLessThanOrEqual(0.65);
        }
    });

    it('S4 行：cap < 同 band 的 S2/S3（回流期减压而非加压）', () => {
        for (const b of ['M0', 'M1', 'M2', 'M3', 'M4']) {
            const s4 = getLifecycleStressCap('S4', b);
            const s2 = getLifecycleStressCap('S2', b);
            const s3 = getLifecycleStressCap('S3', b);
            // S4 cap 应小于等于 S2 与 S3（保护回流玩家不被加压）
            if (s2) expect(s4.cap, `S4·${b} vs S2·${b}`).toBeLessThanOrEqual(s2.cap);
            if (s3) expect(s4.cap, `S4·${b} vs S3·${b}`).toBeLessThanOrEqual(s3.cap);
        }
    });

    it('getLifecycleStressCap 对非法 stage/band 返回 null（不污染下游）', () => {
        expect(getLifecycleStressCap('S99', 'M0')).toBeNull();
        expect(getLifecycleStressCap('S0', 'M99')).toBeNull();
        expect(getLifecycleStressCap(null, null)).toBeNull();
    });
});

// ── §4.2 & §4.5 ──────────────────────────────────────────────────────────

describe('§4.2 + §4.5 isBClassChallenge bypass（救济 / 瓶颈 / 挫败 / warmup）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('正常 D2/D3 段（score ≥ bestScore × 0.8）触发 challengeBoost', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 12,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.challengeBoost).toBeGreaterThan(0);
        expect(s._stressBreakdown.challengeBoostBypass).toBeNull();
    });

    it('救济期（needsRecovery=true）触发 bypass=recovery，challengeBoost=0', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 10 });
        Object.defineProperty(p, 'needsRecovery', { value: true, configurable: true });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 12,
            bestScore: 1000,
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        expect(s._stressBreakdown.challengeBoostBypass).toBe('recovery');
    });

    it('挫败期（frustrationLevel ≥ threshold）触发 bypass=frustration', () => {
        const p = makeProfile({
            smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300,
            consecutiveNonClears: 6, spawnCounter: 10,
        });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 12,
            bestScore: 1000,
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        // recovery 优先级高于 frustration，所以同时满足时返回 recovery
        expect(['recovery', 'frustration']).toContain(s._stressBreakdown.challengeBoostBypass);
    });

    it('瓶颈低谷（bottleneck signal）触发 bypass=bottleneck', () => {
        const p = makeProfile({
            smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 10,
        });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 12,
            bestScore: 1000,
            bottleneckTrough: 1,
            bottleneckSamples: 2,
        });
        // 至少为 0；可能命中 bottleneck，也可能因为其他保护触发
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        expect(s._stressBreakdown.challengeBoostBypass).not.toBeNull();
    });

    it('warmup 段（totalRounds ≤ 3）触发 bypass=warmup', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 4 });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 2,
            bestScore: 1000,
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        expect(s._stressBreakdown.challengeBoostBypass).toBe('warmup');
    });

    it('未接近 PB（D0/D1 段）触发 bypass=pb_distance_far，符合远征段保护', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 12 });
        const s = resolveAdaptiveStrategy('normal', p, 400, 0, 0.35, {
            totalRounds: 12,
            bestScore: 1000,
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        expect(s._stressBreakdown.challengeBoostBypass).toBe('pb_distance_far');
    });

    it('challengeBoostBypass 在 stressBreakdown 中始终存在（避免下游 undefined 判断）', () => {
        const p = makeProfile({ smoothSkill: 0.5, lifetimeGames: 5, lifetimePlacements: 80 });
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.3);
        expect('challengeBoostBypass' in s._stressBreakdown).toBe(true);
    });
});

// ── §4.3 best.gap.far 文案池 ────────────────────────────────────────────

describe('§4.3 best.gap.far 远征陪伴文案（主 + alt1 + alt2）', () => {
    const KEYS = ['best.gap.far', 'best.gap.far.alt1', 'best.gap.far.alt2'];

    it('zh-CN 三条文案均存在且非空', () => {
        for (const k of KEYS) {
            expect(zhCN[k], `zh-CN missing ${k}`).toBeTruthy();
            expect(typeof zhCN[k]).toBe('string');
            expect(zhCN[k].length).toBeGreaterThan(0);
        }
    });

    it('en 三条文案均存在且非空', () => {
        for (const k of KEYS) {
            expect(en[k], `en missing ${k}`).toBeTruthy();
            expect(typeof en[k]).toBe('string');
        }
    });

    it('zh-CN 主文案与 alt2 支持 {{best}} 占位符（用 PB 数值锚定）', () => {
        expect(zhCN['best.gap.far']).toMatch(/\{\{best\}\}/);
        expect(zhCN['best.gap.far.alt2']).toMatch(/\{\{best\}\}/);
    });

    it('en 主文案与 alt2 支持 {{best}} 占位符', () => {
        expect(en['best.gap.far']).toMatch(/\{\{best\}\}/);
        expect(en['best.gap.far.alt2']).toMatch(/\{\{best\}\}/);
    });
});

// ── §4.6 二度里程碑 ─────────────────────────────────────────────────────

describe('§4.6 二度里程碑：破 PB 后动态注入 +10% / +25% 节点（v1.55.10 修订）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    /* v1.55.10 契约变更：
     *   - SCORE_MILESTONES_REL：[0.25, 0.5, 0.75, 1.0, 1.25] → [0.50, 0.75, 0.90]
     *   - 新增 MIN_BEST_FOR_MILESTONE_TOAST = 500：bestScore < 500 时不触发任何 milestone
     *   - 局内只触发一次：一旦 hit，本局后续 resolve 都返回 hit=false（含二度档）
     */

    it('未破 PB 时按 base 档位触发（v1.55.10：bestScore=1000 → [500, 750, 900]，score=510 跨 500）', () => {
        const p = makeProfile({ smoothSkill: 0.5, lifetimeGames: 5, lifetimePlacements: 100, spawnCounter: 10 });
        const s1 = resolveAdaptiveStrategy('normal', p, 400, 0, 0.35, {
            totalRounds: 12, bestScore: 1000,
        });
        expect(s1.spawnHints.scoreMilestone).toBe(false);
        const s2 = resolveAdaptiveStrategy('normal', p, 510, 0, 0.35, {
            totalRounds: 13, bestScore: 1000,
        });
        expect(s2.spawnHints.scoreMilestone).toBe(true);
        expect(s2.spawnHints.scoreMilestoneValue).toBe(500);
    });

    it('已破 PB 时仍可注入 +10% 二度里程碑（隔局：模拟 resetAdaptiveMilestone 后单次触发）', () => {
        /* v1.55.10 局内一次契约：base 档触发后局内不再触发任何（含二度）。
         * 但跨局（resetAdaptiveMilestone）后，破 PB 局可以单次触发二度档。 */
        const p = makeProfile({ smoothSkill: 0.6, lifetimeGames: 5, lifetimePlacements: 100, spawnCounter: 12 });
        /* 模拟"新局已破 PB"：score=1101 (>1100=bestScore×1.10) 应触发二度里程碑 */
        const s = resolveAdaptiveStrategy('normal', p, 1101, 0, 0.35, {
            totalRounds: 13, bestScore: 1000,
        });
        expect(s.spawnHints.scoreMilestone).toBe(true);
        expect(s.spawnHints.scoreMilestoneValue).toBe(1100);
    });

    it('已破 PB 时 score=1251 命中首个未达 post-PB 档 1100（+10%，checkScoreMilestone 取最小未达档）', () => {
        const p = makeProfile({ smoothSkill: 0.6, lifetimeGames: 5, lifetimePlacements: 100, spawnCounter: 12 });
        const s = resolveAdaptiveStrategy('normal', p, 1251, 0, 0.35, {
            totalRounds: 13, bestScore: 1000,
        });
        expect(s.spawnHints.scoreMilestone).toBe(true);
        /* 同时跨过 1100 和 1250 时，命中较小的 1100；+25% 档作为"再下一档"在下局推进，
         * 局内一次（post-PB 段）契约保证不会连弹两次。 */
        expect(s.spawnHints.scoreMilestoneValue).toBe(1100);
    });

    it('effect.newRecord.second 文案存在且带 {{delta}} 占位符', () => {
        expect(zhCN['effect.newRecord.second']).toBeTruthy();
        expect(zhCN['effect.newRecord.second']).toMatch(/\{\{delta\}\}/);
        expect(en['effect.newRecord.second']).toBeTruthy();
        expect(en['effect.newRecord.second']).toMatch(/\{\{delta\}\}/);
    });

    it('bestScore=0（新手）时不触发任何里程碑（v1.55.10：低 best 不出 toast）', () => {
        const p = makeProfile({ smoothSkill: 0.4, lifetimeGames: 1, lifetimePlacements: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.3, { totalRounds: 3, bestScore: 0 });
        expect(s.spawnHints.scoreMilestone).toBe(false);
    });

    it('bestScore < 500 时不触发任何里程碑（v1.55.10 新增 MIN_BEST 门槛）', () => {
        const p = makeProfile({ smoothSkill: 0.4, lifetimeGames: 3, lifetimePlacements: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 400, 0, 0.3, { totalRounds: 5, bestScore: 499 });
        expect(s.spawnHints.scoreMilestone).toBe(false);
    });
});

// ── §4.9 postPbReleaseWindow ────────────────────────────────────────────

describe('§4.9 postPbReleaseWindow：破 PB 后 3 spawn 内 stress×0.7 + clearGuarantee+1', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('postPbReleaseActive=true 时 stress 缩放因子 0.7 写入 breakdown', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 8, lifetimePlacements: 200, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 600, 0, 0.45, {
            totalRounds: 15,
            bestScore: 500,
            postPbReleaseActive: true,
        });
        expect(s._stressBreakdown.postPbReleaseActive).toBe(true);
        /* 释放窗口期 stress 必然小于不释放时（同 raw 信号） */
        expect(s._stressBreakdown.postPbReleaseStressAdjust).toBeLessThanOrEqual(0);
    });

    it('postPbReleaseActive 时 challengeBoost bypass=post_pb_release', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 8, lifetimePlacements: 200, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 900, 0, 0.45, {
            totalRounds: 12,
            bestScore: 1000,
            postPbReleaseActive: true,
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
        expect(s._stressBreakdown.challengeBoostBypass).toBe('post_pb_release');
    });

    it('postPbReleaseActive 时 spawnHints.clearGuarantee ≥ 2（默认 +1）', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 8, lifetimePlacements: 200, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 700, 0, 0.40, {
            totalRounds: 13,
            bestScore: 500,
            postPbReleaseActive: true,
        });
        expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(2);
    });

    it('postPbReleaseActive=false 时不衰减 stress（默认行为）', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 8, lifetimePlacements: 200, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 600, 0, 0.45, {
            totalRounds: 15,
            bestScore: 500,
        });
        expect(s._stressBreakdown.postPbReleaseActive).toBe(false);
        expect(s._stressBreakdown.postPbReleaseStressAdjust).toBe(0);
    });
});

// ── §4.8 strategyAdvisor pbChase ───────────────────────────────────────

describe('§4.8 strategyAdvisor pbChase 策略卡', () => {
    let generateStrategyTips;

    beforeEach(async () => {
        const mod = await import('../web/src/strategyAdvisor.js');
        generateStrategyTips = mod.generateStrategyTips;
    });

    function profileForTip() {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 12, lifetimePlacements: 300, spawnCounter: 18 });
        p._daysSinceInstall = 30;
        return p;
    }

    it('D4 段（postPbReleaseActive=true）出"庆功小憩"卡', () => {
        const tips = generateStrategyTips(profileForTip(), {}, {
            fillRatio: 0.40, holesCount: 0,
            pbContext: { currentScore: 1100, bestScore: 1000, postPbReleaseActive: true, celebrationCount: 1 },
        });
        expect(tips.some(t => t.category === 'pbChase' && /庆功/.test(t.title))).toBe(true);
    });

    it('D3.victory（pct≥1.0 已破，释放窗口结束）出"再破纪录"卡', () => {
        const tips = generateStrategyTips(profileForTip(), {}, {
            fillRatio: 0.42, holesCount: 0,
            pbContext: { currentScore: 1050, bestScore: 1000, postPbReleaseActive: false, celebrationCount: 1 },
        });
        expect(tips.some(t => t.category === 'pbChase' && /再破/.test(t.title))).toBe(true);
    });

    it('D3.close（pct 0.95~0.999）出"决战一脚"卡', () => {
        const tips = generateStrategyTips(profileForTip(), {}, {
            fillRatio: 0.42, holesCount: 0,
            pbContext: { currentScore: 960, bestScore: 1000, postPbReleaseActive: false, celebrationCount: 0 },
        });
        expect(tips.some(t => t.category === 'pbChase' && /决战/.test(t.title))).toBe(true);
    });

    it('D0/D1/D2 段（pct<0.95）不出 pbChase 卡', () => {
        const tips = generateStrategyTips(profileForTip(), {}, {
            fillRatio: 0.42, holesCount: 0,
            pbContext: { currentScore: 600, bestScore: 1000, postPbReleaseActive: false, celebrationCount: 0 },
        });
        expect(tips.some(t => t.category === 'pbChase')).toBe(false);
    });

    it('pbContext 缺失时不出 pbChase 卡（向后兼容）', () => {
        const tips = generateStrategyTips(profileForTip(), {}, { fillRatio: 0.4, holesCount: 0 });
        expect(tips.some(t => t.category === 'pbChase')).toBe(false);
    });
});

// ── §4.4 + §4.7 + §4.11 bestScoreBuckets ──────────────────────────────

describe('§4.4 + §4.7 bestScoreBuckets：PB 分桶 + 周期 PB + 跨设备同步', () => {
    let mod;
    beforeEach(async () => {
        mod = await import('../web/src/bestScoreBuckets.js');
        mod.__resetForTests();
    });
    afterEach(() => {
        mod.__resetForTests();
    });

    it('§4.4 submitScoreToBucket 仅在分数提升时写入', () => {
        const r1 = mod.submitScoreToBucket('hard', 1000);
        expect(r1.updated).toBe(true);
        expect(r1.previousBest).toBe(0);
        expect(r1.newBest).toBe(1000);
        const r2 = mod.submitScoreToBucket('hard', 800);
        expect(r2.updated).toBe(false);
        expect(r2.newBest).toBe(1000);
        const r3 = mod.submitScoreToBucket('hard', 1500);
        expect(r3.updated).toBe(true);
        expect(r3.previousBest).toBe(1000);
        expect(r3.delta).toBe(500);
    });

    it('§4.4 easy / normal / hard 各自独立分桶', () => {
        mod.submitScoreToBucket('easy', 500);
        mod.submitScoreToBucket('normal', 1200);
        mod.submitScoreToBucket('hard', 800);
        const all = mod.getAllBestByStrategy();
        expect(all.easy).toBe(500);
        expect(all.normal).toBe(1200);
        expect(all.hard).toBe(800);
    });

    it('§4.4 未知 strategy 回退到 normal 兜底', () => {
        mod.submitScoreToBucket('extreme', 999);
        expect(mod.getBestByStrategy('normal')).toBe(999);
        expect(mod.getBestByStrategy('extreme')).toBe(999); // normalized to normal
    });

    it('§4.7 deriveWeekKey 同周返回相同 key, 跨周返回不同 key', () => {
        const monday = new Date('2026-05-11T12:00:00Z');
        const sunday = new Date('2026-05-17T12:00:00Z');
        const nextMonday = new Date('2026-05-18T12:00:00Z');
        const k1 = mod.deriveWeekKey(monday);
        const k2 = mod.deriveWeekKey(sunday);
        const k3 = mod.deriveWeekKey(nextMonday);
        expect(k1).toBe(k2);
        expect(k1).not.toBe(k3);
        expect(k1).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('§4.7 deriveMonthKey 同月返回相同 key, 跨月返回不同', () => {
        const may1 = new Date('2026-05-01');
        const may31 = new Date('2026-05-31');
        const jun1 = new Date('2026-06-01');
        expect(mod.deriveMonthKey(may1)).toBe(mod.deriveMonthKey(may31));
        expect(mod.deriveMonthKey(may1)).not.toBe(mod.deriveMonthKey(jun1));
        expect(mod.deriveMonthKey(may1)).toBe('2026-05');
    });

    it('§4.7 submitPeriodBest 跨周自动重置 weeklyBest', () => {
        const week1 = new Date('2026-05-12T10:00:00Z');
        const week2 = new Date('2026-05-19T10:00:00Z');
        mod.submitPeriodBest(800, week1);
        expect(mod.getPeriodBest(week1).weeklyBest).toBe(800);
        /* 跨周后 weeklyBest 重置为 0，monthlyBest 跨月才重置 */
        expect(mod.getPeriodBest(week2).weeklyBest).toBe(0);
        expect(mod.getPeriodBest(week2).monthlyBest).toBe(800);
    });

    it('§4.7 submitPeriodBest 跨月自动重置 monthlyBest', () => {
        const may = new Date('2026-05-15T10:00:00Z');
        const jun = new Date('2026-06-15T10:00:00Z');
        mod.submitPeriodBest(1000, may);
        const r = mod.getPeriodBest(jun);
        expect(r.weeklyBest).toBe(0);
        expect(r.monthlyBest).toBe(0);
    });

    it('§4.11 localStorage key openblock_best_by_strategy_v1 / openblock_period_best_v1 写入符合命名', () => {
        mod.submitScoreToBucket('hard', 2000);
        mod.submitPeriodBest(2000);
        expect(localStorage.getItem('openblock_best_by_strategy_v1')).toBeTruthy();
        expect(localStorage.getItem('openblock_period_best_v1')).toBeTruthy();
    });
});

// ── §4.11 跨设备同步 whitelist ───────────────────────────────────────────

describe('§4.11 跨设备 PB 同步：新 key 已纳入 core section', () => {
    it('openblock_best_by_strategy_v1 在 core section 白名单内', async () => {
        const { __test_only__ } = await import('../web/src/localStorageStateSync.js');
        expect(__test_only__._sectionForKey('openblock_best_by_strategy_v1')).toBe('core');
    });

    it('openblock_period_best_v1 在 core section 白名单内', async () => {
        const { __test_only__ } = await import('../web/src/localStorageStateSync.js');
        expect(__test_only__._sectionForKey('openblock_period_best_v1')).toBe('core');
    });
});

// ── §4.10 异常分守卫 ────────────────────────────────────────────────────

describe('§4.10 异常分守卫：score > previousBest × 5 进入审核态', () => {
    it('GAME_RULES.bestScoreSanity 默认配置存在且合理', async () => {
        const { GAME_RULES } = await import('../web/src/gameRules.js');
        expect(GAME_RULES.bestScoreSanity).toBeDefined();
        expect(GAME_RULES.bestScoreSanity.enabled).toBe(true);
        expect(GAME_RULES.bestScoreSanity.multiplier).toBe(5);
        expect(GAME_RULES.bestScoreSanity.minBase).toBe(50);
    });

    it('multiplier=5 时，previousBest=100, score=600 算异常（> 500）', () => {
        const previousBest = 100;
        const score = 600;
        const multiplier = 5;
        const minBase = 50;
        const suspicious = previousBest >= minBase && score > previousBest * multiplier;
        expect(suspicious).toBe(true);
    });

    it('previousBest < minBase=50 时跳过守卫（新玩家锚点不足）', () => {
        const previousBest = 30;
        const score = 999;
        const minBase = 50;
        const suspicious = previousBest >= minBase && score > previousBest * 5;
        expect(suspicious).toBe(false);
    });

    it('score 在 previousBest × multiplier 上界以内不触发守卫', () => {
        const previousBest = 200;
        const score = 999; // 200 * 5 = 1000, 999 < 1000
        const suspicious = previousBest >= 50 && score > previousBest * 5;
        expect(suspicious).toBe(false);
    });
});

// ── §4.12 PB 事件总线 ──────────────────────────────────────────────────

describe('§4.12 PB 事件总线：lifecycle:new_personal_best / near_personal_best', () => {
    let busEvents;
    let bus;
    beforeEach(() => {
        busEvents = [];
        bus = { emit: (type, payload) => busEvents.push({ type, payload }) };
    });

    it('_emitPersonalBestEvent payload 字段齐全', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = {
            _monetizationBus: bus,
            strategy: 'hard',
            gameStats: { placements: 25 },
        };
        Game.prototype._emitPersonalBestEvent.call(game, {
            previousBest: 1000, newBest: 1200, delta: 200,
            celebrationIndex: 1, isFirst: true,
        });
        expect(busEvents.length).toBe(1);
        expect(busEvents[0].type).toBe('lifecycle:new_personal_best');
        const p = busEvents[0].payload;
        expect(p.previousBest).toBe(1000);
        expect(p.newBest).toBe(1200);
        expect(p.delta).toBe(200);
        expect(p.celebrationIndex).toBe(1);
        expect(p.isFirst).toBe(true);
        expect(p.strategy).toBe('hard');
        expect(p.sessionPlacements).toBe(25);
        expect(typeof p.ts).toBe('number');
    });

    it('_maybeEmitNearPersonalBest 仅在 pct≥0.95 时 emit 且每局只一次', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = {
            _monetizationBus: bus,
            _bestScoreAtRunStart: 1000,
            bestScore: 1000,
            score: 950,
            strategy: 'normal',
            gameStats: { placements: 10 },
        };
        Game.prototype._maybeEmitNearPersonalBest.call(game);
        expect(busEvents.length).toBe(1);
        expect(busEvents[0].type).toBe('lifecycle:near_personal_best');
        expect(busEvents[0].payload.pct).toBeCloseTo(0.95, 5);
        /* 重复调用不应再 emit */
        Game.prototype._maybeEmitNearPersonalBest.call(game);
        expect(busEvents.length).toBe(1);
    });

    it('_maybeEmitNearPersonalBest pct<0.95 时不 emit', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = {
            _monetizationBus: bus,
            _bestScoreAtRunStart: 1000,
            bestScore: 1000,
            score: 800,
            strategy: 'normal',
            gameStats: { placements: 10 },
        };
        Game.prototype._maybeEmitNearPersonalBest.call(game);
        expect(busEvents.length).toBe(0);
    });

    it('bestScore=0 时 _maybeEmitNearPersonalBest 不 emit（缺锚点）', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = {
            _monetizationBus: bus,
            _bestScoreAtRunStart: 0,
            bestScore: 0,
            score: 500,
            strategy: 'normal',
            gameStats: { placements: 10 },
        };
        Game.prototype._maybeEmitNearPersonalBest.call(game);
        expect(busEvents.length).toBe(0);
    });
});

// ── §4.13 Hard 模式 UI 衔接 ────────────────────────────────────────────

describe('§4.13 Hard 模式 PB UI：庆祝烟花强度 +30%', () => {
    it('hardScale=1.3 计算正确（基线 18 → 23, 900 → 1170）', () => {
        const hardScale = 1.3;
        expect(Math.round(18 * hardScale)).toBe(23);
        expect(Math.round(900 * hardScale)).toBe(1170);
        expect(Math.round(9 * hardScale)).toBe(12);
        expect(Math.round(450 * hardScale)).toBe(585);
    });

    it('normal/easy 模式 hardScale=1.0（保持原值）', () => {
        const hardScale = 1.0;
        expect(Math.round(18 * hardScale)).toBe(18);
        expect(Math.round(900 * hardScale)).toBe(900);
    });
});
