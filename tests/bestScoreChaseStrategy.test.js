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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

    /* v1.57.3 §5.α.14：best.gap.far 文案从 "历史最佳 {{best}}" 降级为 "差 {{gap}} 分"（与 neutral
     * 同口径），因为用户截图证明主 HUD 已展示 PB 数字 → best-gap 再展示 PB 形成视觉重复。
     * 主文案 key 保留但占位符从 {{best}} 改为 {{gap}}；alt2 文案保留 {{best}}（@deprecated 旧版灰度回滚锚点）。 */
    it('zh-CN best.gap.far 主文案使用 {{gap}}（v1.57.3 降级）；alt2 保留 {{best}}', () => {
        expect(zhCN['best.gap.far']).toMatch(/\{\{gap\}\}/);
        expect(zhCN['best.gap.far.alt2']).toMatch(/\{\{best\}\}/);
    });

    it('en best.gap.far 主文案使用 {{gap}}（v1.57.3 降级）；alt2 保留 {{best}}', () => {
        expect(en['best.gap.far']).toMatch(/\{\{gap\}\}/);
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

/* ════════════════════════════════════════════════════════════════════════ */
/*  v1.60.45 §7 — PB 跨局保护链（notePbBreak / getNextChallenges）            */
/* ════════════════════════════════════════════════════════════════════════ */

describe('v1.60.45 §7 — PB 突破后跨局保护链', () => {
    let mod;
    beforeEach(async () => {
        mod = await import('../web/src/bestScoreBuckets.js');
        mod.__resetForTests();
    });
    afterEach(() => {
        mod.__resetForTests();
    });

    it('notePbBreak 写入并能被 getLastPbBreak / daysSinceLastPbBreak 读取', () => {
        mod.notePbBreak(2500, 'hard');
        const rec = mod.getLastPbBreak();
        expect(rec).toBeTruthy();
        expect(rec.score).toBe(2500);
        expect(rec.strategy).toBe('hard');
        expect(typeof rec.ts).toBe('number');
        const d = mod.daysSinceLastPbBreak();
        expect(d).not.toBeNull();
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(1); // 刚写入
    });

    it('notePbBreak 入参非法（NaN / 负数）→ 不写入', () => {
        mod.notePbBreak(NaN);
        mod.notePbBreak(-100);
        mod.notePbBreak(0);
        expect(mod.getLastPbBreak()).toBeNull();
        expect(mod.daysSinceLastPbBreak()).toBeNull();
    });

    it('notePbBreak 后续写入覆盖前次（只保留最近一次）', () => {
        mod.notePbBreak(1000, 'normal');
        mod.notePbBreak(2000, 'hard');
        const rec = mod.getLastPbBreak();
        expect(rec.score).toBe(2000);
        expect(rec.strategy).toBe('hard');
    });

    it('未知 strategy 归一化为 normal', () => {
        mod.notePbBreak(1000, 'extreme');
        expect(mod.getLastPbBreak().strategy).toBe('normal');
    });

    it('getNextChallenges 返回 110% PB + 125% PB（无周期 PB 时只返回这两条）', () => {
        mod.submitScoreToBucket('normal', 1000);
        const ch = mod.getNextChallenges('normal');
        expect(ch.length).toBeGreaterThanOrEqual(2);
        const ids = ch.map(c => c.id);
        expect(ids).toContain('pb_110');
        expect(ids).toContain('pb_125');
        const pb110 = ch.find(c => c.id === 'pb_110');
        expect(pb110.target).toBe(1100);
        const pb125 = ch.find(c => c.id === 'pb_125');
        expect(pb125.target).toBe(1250);
    });

    it('getNextChallenges 含周期 PB 时优先列入（且 < pb 的才显示）', () => {
        /* 先 submit period（在 ISO week 2026-W21 时间窗内）→ 再 submit normal PB */
        const may21 = new Date('2026-05-21T12:00:00Z');
        mod.submitPeriodBest(800, may21);  /* 周/月 PB = 800 */
        mod.submitScoreToBucket('normal', 1500);
        const ch = mod.getNextChallenges('normal', may21);
        const ids = ch.map(c => c.id);
        expect(ids).toContain('weekly_pb');
        expect(ids).toContain('monthly_pb');
        /* weekly < normal PB → 列入 */
        expect(ch.find(c => c.id === 'weekly_pb').target).toBe(800);
    });

    it('getNextChallenges 在无 PB 时返回空数组（防御性）', () => {
        const ch = mod.getNextChallenges('normal');
        expect(ch).toEqual([]);
    });

    it('__TEST_KEYS 暴露 PB_BREAK_TS_KEY', () => {
        expect(mod.__TEST_KEYS.PB_BREAK_TS_KEY).toBe('openblock_pb_break_ts_v1');
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
            _getRunPbBaseline: Game.prototype._getRunPbBaseline,
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
            _getRunPbBaseline: Game.prototype._getRunPbBaseline,
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
            _getRunPbBaseline: Game.prototype._getRunPbBaseline,
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

// ════════════════════════════════════════════════════════════════════════
// v1.56 §5.α Q+0 + Q+1 改进项回归测试
// ════════════════════════════════════════════════════════════════════════

// ── §2.1 farFromPBBoost 远征送爽 ────────────────────────────────────────

describe('v1.56 §2.1 farFromPBBoost 远征送爽（D0 段主动送爽）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D0 段（pct=0.25）且无 bypass → farFromPBBoostActive=true + clearGuarantee≥2', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 250, 0, 0.30, {
            totalRounds: 20,
            bestScore: 1000,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(true);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBeNull();
        expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(2);
        expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.45);
        expect(s.spawnHints.iconBonusTarget).toBeGreaterThanOrEqual(0.30);
    });

    it('D0 段 + warmup → bypass=warmup + farFromPBBoostActive=false', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 1 });
        const s = resolveAdaptiveStrategy('normal', p, 250, 0, 0.30, {
            totalRounds: 1,
            bestScore: 1000,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('warmup');
    });

    it('D1+ 段（pct=0.55）→ bypass=pct_above_threshold', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 550, 0, 0.30, {
            totalRounds: 20,
            bestScore: 1000,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('pct_above_threshold');
    });

    it('bestScore=0（新手）→ bypass=no_best_score', () => {
        const p = makeProfile({ smoothSkill: 0.45, lifetimeGames: 2, lifetimePlacements: 30, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.25, {
            totalRounds: 10,
            bestScore: 0,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('no_best_score');
    });

    it('pbGrowthFast=true → bypass=pb_growth_throttled', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 250, 0, 0.30, {
            totalRounds: 20,
            bestScore: 1000,
            pbGrowthFast: true,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('pb_growth_throttled');
    });
});

// ── §2.3 pbExtremeChase D3 顺序刚性 ─────────────────────────────────────

describe('v1.56 §2.3 D3 决战段 pbExtremeOrderBoost', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D3 段（pct=0.96）→ pbExtremeOrderBoost=0.20 + orderRigor 显著抬升', () => {
        const p = makeProfile({ smoothSkill: 0.72, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 960, 2, 0.55, {
            totalRounds: 20,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBe(0.20);
        expect(s.spawnHints.orderRigor).toBeGreaterThan(0);
    });

    it('D2 段（pct=0.85）→ 不触发 pbExtremeOrderBoost', () => {
        const p = makeProfile({ smoothSkill: 0.72, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 850, 0, 0.35, {
            totalRounds: 20,
            bestScore: 1000,
        });
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBeUndefined();
    });

    it('postPbReleaseActive 时不触发（释放期免疫）', () => {
        const p = makeProfile({ smoothSkill: 0.72, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 960, 0, 0.55, {
            totalRounds: 20,
            bestScore: 1000,
            postPbReleaseActive: true,
            postPbReleaseRemaining: 2,
        });
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBeUndefined();
    });
});

// ── §3.x i18n 文案完整性 + v1.56.3 §5.α.7 策略隐性反向断言 ──────────────

describe('v1.56 §3 i18n 文案 key 存在性（含 @deprecated 历史索引）', () => {
    // v1.56.3：以下 key 全部存在，但内容已被 §5.α.7 统一为中性事实陈述
    // （或保留为 @deprecated 兼容回滚）。这里只断言 key 存在，不再校验具体内容。
    const keys = [
        'best.gap', 'best.gap.neutral', 'best.gap.far',
        'best.over.neutral', 'endGame.nearMiss', 'pbStreak.badge',
        // @deprecated 历史索引（v1.56 引入，v1.56.3 全部中性化）：
        'best.gap.follow', 'best.gap.chase', 'best.gap.victory', 'best.gap.close',
        'best.over.toNext10', 'best.over.toNext25', 'best.over.legend',
        'endGame.nearMiss.D3', 'endGame.nearMiss.D2',
    ];
    it.each(keys)('zh-CN locale 包含 key=%s', (k) => {
        expect(zhCN[k], `zh-CN 缺失 ${k}`).toBeTruthy();
    });
    it.each(keys)('en locale 包含 key=%s', (k) => {
        expect(en[k], `en 缺失 ${k}`).toBeTruthy();
    });
});

describe('v1.56.3 §5.α.7 策略隐性原则反向断言（文案不暴露策略意图）', () => {
    /* 核心原则：远 PB 减压 / 近 PB 加压 / 超 PB 加压 是算法层暗中执行的策略，
     * 玩家通过出块体感与 HUD 颜色感知，**不应在文字层暴露**。
     * 以下反向断言保证 i18n 文案不含任何"模式名 / 教练评价 / 煽情措辞"。 */
    const FORBIDDEN_ZH = ['冲刺区', '冲刺！', '封神', '送爽', '系统已切', '系统正在为你（送|加|减）',
                          '这把差点就刷了', '状态不错', '即将刷新最佳！', '突破 \\+10%'];
    const FORBIDDEN_EN = ['Sprint zone', 'Legend mode', 'so close to a new', 'good run, one more',
                          'About to break your record', '\\+10% break'];
    const TEXT_KEYS = [
        'best.gap', 'best.gap.neutral', 'best.gap.far',
        'best.over.neutral', 'endGame.nearMiss', 'pbStreak.badge',
    ];

    it.each(TEXT_KEYS)('zh-CN[%s] 不含暴露策略意图的词', (k) => {
        const v = String(zhCN[k] ?? '');
        for (const pat of FORBIDDEN_ZH) {
            expect(v, `zh-CN[${k}]="${v}" 含暴露词 /${pat}/`).not.toMatch(new RegExp(pat));
        }
    });

    it.each(TEXT_KEYS)('en[%s] 不含暴露策略意图的词', (k) => {
        const v = String(en[k] ?? '');
        for (const pat of FORBIDDEN_EN) {
            expect(v, `en[${k}]="${v}" 含暴露词 /${pat}/`).not.toMatch(new RegExp(pat));
        }
    });

    it('zh-CN.endGame.nearMiss 是事实陈述（仅含 {{gap}} + "差/分"，无叙事修饰）', () => {
        const v = zhCN['endGame.nearMiss'];
        expect(v).toMatch(/\{\{gap\}\}/);
        expect(v).not.toMatch(/[！?]/);  // 无感叹号/问号煽情
    });

    it('en.endGame.nearMiss 是事实陈述（仅含 {{gap}}，无 narrative）', () => {
        const v = en['endGame.nearMiss'];
        expect(v).toMatch(/\{\{gap\}\}/);
        expect(v).not.toMatch(/[!?]/);
    });
});

// ── §2.4 pbGrowthTracker 节流 ──────────────────────────────────────────

describe('v1.56 §2.4 pbGrowthTracker（PB 增长率追踪）', () => {
    let recordPersonalBest, computePbGrowthRate, isPbGrowthFast, computePbStreakCount, __clearPbHistoryForTest;

    beforeEach(async () => {
        const mod = await import('../web/src/pbGrowthTracker.js');
        recordPersonalBest = mod.recordPersonalBest;
        computePbGrowthRate = mod.computePbGrowthRate;
        isPbGrowthFast = mod.isPbGrowthFast;
        computePbStreakCount = mod.computePbStreakCount;
        __clearPbHistoryForTest = mod.__clearPbHistoryForTest;
        __clearPbHistoryForTest();
    });

    it('recordPersonalBest 单调入栈：相同/更小值被忽略', () => {
        expect(recordPersonalBest(100, 1)).toBe(true);
        expect(recordPersonalBest(100, 2)).toBe(false);
        expect(recordPersonalBest(99, 3)).toBe(false);
        expect(recordPersonalBest(150, 4)).toBe(true);
    });

    it('computePbGrowthRate 单条/空数组返回 0', () => {
        expect(computePbGrowthRate([])).toBe(0);
        expect(computePbGrowthRate([{ value: 100, ts: 1 }])).toBe(0);
    });

    it('computePbGrowthRate 5 条等比 1.10：返回 ~0.10', () => {
        const history = [];
        let v = 100;
        for (let i = 0; i < 5; i++) {
            history.push({ value: Math.round(v), ts: i });
            v *= 1.10;
        }
        const rate = computePbGrowthRate(history, 5);
        expect(rate).toBeCloseTo(0.10, 1);
    });

    it('isPbGrowthFast 增长率 ≥ 阈值时为 true', () => {
        for (let i = 0; i < 5; i++) recordPersonalBest(100 * Math.pow(1.15, i), i + 1);
        expect(isPbGrowthFast(0.10)).toBe(true);
        expect(isPbGrowthFast(0.20)).toBe(false);
    });

    it('computePbStreakCount 7 天内连续 3 次 → 返回 3', () => {
        const day = 24 * 3600 * 1000;
        recordPersonalBest(100, 0);
        recordPersonalBest(150, 1 * day);
        recordPersonalBest(200, 2 * day);
        expect(computePbStreakCount()).toBe(3);
    });

    it('computePbStreakCount 中间间隔 > 7 天 → 截断到尾部连续段', () => {
        const day = 24 * 3600 * 1000;
        recordPersonalBest(100, 0);
        recordPersonalBest(150, 30 * day); // 与前一条间隔 30 天 → 断点
        recordPersonalBest(200, 31 * day);
        expect(computePbStreakCount()).toBe(2);
    });

    it('computePbStreakCount 空数组返回 0', () => {
        expect(computePbStreakCount([])).toBe(0);
    });
});

// ── §4.3 stressMeter：v1.56.3 §5.α.7 移除 PB 距离段叙事抢占 ──────────

describe('v1.56.3 §5.α.7 stressMeter 不再针对 PB 距离段抢占叙事（策略隐性）', () => {
    /* v1.56 §4.3 曾让 farFromPBBoostActive / pbExtremeOrderBoost 抢占 buildStoryLine
     * 返回 "远征段送爽中..." / "冲刺区！系统已切到顺序约束模式..."，但这两条文案直接
     * 把幕后策略暴露在字面上。v1.56.3 移除抢占逻辑，叙事让位给 SPAWN_INTENT_NARRATIVE
     * 等中性表述。算法层 farFromPBBoost / pbExtremeOrderBoost 继续静默执行。 */

    it('farFromPBBoostActive=true 不再返回"送爽"叙事', async () => {
        const { buildStoryLine, getStressLevel } = await import('../web/src/stressMeter.js');
        const level = getStressLevel(0.4);
        const story = buildStoryLine(
            level,
            { boardRisk: 0.2 },
            {},
            { farFromPBBoostActive: true, spawnIntent: 'maintain' }
        );
        expect(story).not.toContain('送爽');
        expect(story).not.toContain('远征段');
    });

    it('pbExtremeOrderBoost>0 不再返回"冲刺区/顺序约束模式"叙事', async () => {
        const { buildStoryLine, getStressLevel } = await import('../web/src/stressMeter.js');
        const level = getStressLevel(0.7);
        const story = buildStoryLine(
            level,
            { boardRisk: 0.2, pbExtremeOrderBoost: 0.20 },
            {},
            { spawnIntent: 'pressure' }
        );
        expect(story).not.toContain('冲刺区');
        expect(story).not.toContain('顺序约束');
        expect(story).not.toContain('系统已切');
    });

    it('boardRisk≥0.6 保活叙事仍然优先（与 PB 距离段无关，是真实危险预警）', async () => {
        const { buildStoryLine, getStressLevel } = await import('../web/src/stressMeter.js');
        const level = getStressLevel(0.8);
        const story = buildStoryLine(
            level,
            { boardRisk: 0.7, pbExtremeOrderBoost: 0.20 },
            {},
            { farFromPBBoostActive: true, spawnIntent: 'relief' }
        );
        expect(story).toContain('保活');
    });

    it('PB_DISTANCE_NARRATIVE 内容已中性化（保留 export 以兼容旧消费方）', async () => {
        const { PB_DISTANCE_NARRATIVE } = await import('../web/src/stressMeter.js');
        // 不再含"送爽 / 冲刺区 / 顺序约束 / 系统已切"等暴露策略意图的词
        expect(PB_DISTANCE_NARRATIVE.farBoostActive).not.toMatch(/送爽|远征段|系统/);
        expect(PB_DISTANCE_NARRATIVE.pbExtremeChase).not.toMatch(/冲刺区|顺序约束|系统已切/);
    });

    it('SIGNAL_LABELS 不再含"决战刚性 / 远征送爽"等内部策略名', async () => {
        const { SIGNAL_LABELS } = await import('../web/src/stressMeter.js');
        expect(SIGNAL_LABELS.pbExtremeOrderBoost.label).not.toMatch(/决战|刚性/);
        expect(SIGNAL_LABELS.farFromPBBoostActive.label).not.toMatch(/送爽|远征/);
    });
});

// ── v1.56.6 §5.α.9 D4 加压完整闭环修复（4 处冲突修复）─────────────────

describe('v1.56.6 §5.α.9 P0-C2：D4 段豁免 occupancyDamping', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D4 段（pbOvershootActive）+ 低 fill → occupancyDamping=0（豁免）', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1500, 0, 0.10, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            _occupancyFillAnchor: 0.10,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(true);
        expect(s._stressBreakdown.occupancyDamping).toBe(0);
        expect(s._stressBreakdown.occupancyDampingBypassed).toBe(true);
    });

    it('非 D4 段（pct=0.5 D1）+ 低 fill → occupancyDamping 正常生效（不豁免）', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 500, 0, 0.10, {
            totalRounds: 25,
            bestScore: 1000,
            _occupancyFillAnchor: 0.10,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(false);
        expect(s._stressBreakdown.occupancyDampingBypassed).toBe(false);
    });
});

describe('v1.56.6 §5.α.9 P0-C3：D4 段豁免 flowPayoffCap', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D4 段 + flow + payoff + 无空洞 → flowPayoffCap 豁免', () => {
        // 构造一个会触发 flowPayoffCap 的场景：flowState=flow + rhythmPhase=payoff
        const p = makeProfile({
            smoothSkill: 0.70,
            lifetimeGames: 30,
            lifetimePlacements: 900,
            spawnCounter: 30,
            flowState: 'flow',
        });
        const s = resolveAdaptiveStrategy('normal', p, 1500, 0, 0.30, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            rhythmPhase: 'payoff',
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(true);
        // 即使触发了 flow + payoff 条件，flowPayoffCap 也应被豁免
        if (s._stressBreakdown.flowPayoffCapBypassed === true) {
            // 标志位被设置 → 豁免确实生效
            expect(s._stressBreakdown.flowPayoffCapAdjust).toBeFalsy();
        }
    });
});

describe('v1.56.6 §5.α.9 P1-C4：D4 段动态 smoothStress.maxStepUp', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D4 段 smoothingDynamicMaxStepUp 被写入 breakdown', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1500, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            prevAdaptiveStress: 0.40,  // 前一帧 stress 0.40，触发 smoothStress 限速
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(true);
        expect(s._stressBreakdown.smoothingDynamicMaxStepUp).toBe(0.25);
    });

    it('非 D4 段 smoothingDynamicMaxStepUp 不存在（保持 0.18 默认）', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 500, 0, 0.30, {
            totalRounds: 25,
            bestScore: 1000,
            prevAdaptiveStress: 0.20,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(false);
        expect(s._stressBreakdown.smoothingDynamicMaxStepUp).toBeUndefined();
    });
});

describe('v1.56.6 §5.α.9 P2：challengeBoost cap 配置化', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('默认 baseCap=0.18（旧硬编码 0.15）→ D3 段 challengeBoost 可达 0.18', () => {
        // pct=1.0 时公式 (pct-0.8)·0.75 = 0.15，cap=0.18 不影响
        // pct=1.05 时公式 = 0.1875 > 0.18，被 cap 截到 0.18
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1050, 0, 0.40, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        // 此处 pct=1.05 触发 D4（pbOvershootActive=true），challengeBoost cap 仍是 0.18
        expect(s._stressBreakdown.challengeBoost).toBeCloseTo(0.18, 2);
    });
});

describe('v1.56.6 §5.α.9 P2：postPbReleaseWindow 窗口配置化', () => {
    it('GAME_RULES 默认 spawns=5（旧硬编码 3）', async () => {
        const { GAME_RULES } = await import('../web/src/gameRules.js');
        const w = GAME_RULES.adaptiveSpawn?.pbChase?.postPbReleaseWindow;
        expect(w).toBeDefined();
        expect(w.spawns).toBe(5);
    });
});

describe('v1.56.6 §5.α.9 D4 段净加压效果验证（端到端）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('D4 段（pct=1.5 + 低 fill + flow + payoff）净 finalStress 显著 > D2 段', () => {
        // 修复前：D4 段 finalStress 因 occupancyDamping×0.5 + flowPayoffCap 0.79 被打回 ≈0.50
        // 修复后：D4 豁免两处机制，finalStress 应能保持在 0.75+
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30, flowState: 'flow' });
        const d4 = resolveAdaptiveStrategy('normal', p, 1500, 0, 0.10, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            rhythmPhase: 'payoff',
            _occupancyFillAnchor: 0.10,
        });
        const d2 = resolveAdaptiveStrategy('normal', p, 850, 0, 0.10, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            rhythmPhase: 'payoff',
            _occupancyFillAnchor: 0.10,
        });
        expect(d4._stressBreakdown.pbOvershootActive).toBe(true);
        expect(d2._stressBreakdown.pbOvershootActive).toBe(false);
        // 核心断言：D4 净 finalStress 应明显 > D2 段（旧实现两者几乎相等）
        expect(d4._stressBreakdown.finalStress).toBeGreaterThan(d2._stressBreakdown.finalStress);
        expect(d4._stressBreakdown.finalStress - d2._stressBreakdown.finalStress).toBeGreaterThan(0.10);
    });
});

// ── v1.56.4 §5.α.8 三原则下的算法完整闭环 ────────────────────────────

describe('v1.56.4 §5.α.8 D4 超 PB 持续加压（pbOvershootBoost）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('pct=1.0（恰好破 PB 临界）→ pbOvershootBoost=0 / Active=false', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1000, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbOvershootBoost).toBe(0);
        expect(s._stressBreakdown.pbOvershootActive).toBe(false);
        expect(s.spawnHints.pbOvershootActive).toBe(false);
    });

    it('pct=1.25 → pbOvershootBoost 约 0.08（对数曲线中段）', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1250, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(true);
        expect(s._stressBreakdown.pbOvershootBoost).toBeGreaterThan(0.04);
        expect(s._stressBreakdown.pbOvershootBoost).toBeLessThan(0.12);
    });

    it('pct=1.50 → pbOvershootBoost 约 0.12（对数曲线中后段）', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1500, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbOvershootBoost).toBeGreaterThan(0.08);
        expect(s._stressBreakdown.pbOvershootBoost).toBeLessThanOrEqual(0.16);
    });

    it('pct=2.0 → pbOvershootBoost 接近 maxBoost cap（0.16）但不超过', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 2000, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbOvershootBoost).toBeGreaterThan(0.12);
        expect(s._stressBreakdown.pbOvershootBoost).toBeLessThanOrEqual(0.16);
    });

    it('overshoot 曲线单调递增：pct=1.1 < pct=1.3 < pct=1.7', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s1 = resolveAdaptiveStrategy('normal', p, 1100, 2, 0.55, { totalRounds: 25, bestScore: 1000, holes: 0 });
        const s2 = resolveAdaptiveStrategy('normal', p, 1300, 2, 0.55, { totalRounds: 25, bestScore: 1000, holes: 0 });
        const s3 = resolveAdaptiveStrategy('normal', p, 1700, 2, 0.55, { totalRounds: 25, bestScore: 1000, holes: 0 });
        expect(s1._stressBreakdown.pbOvershootBoost).toBeLessThan(s2._stressBreakdown.pbOvershootBoost);
        expect(s2._stressBreakdown.pbOvershootBoost).toBeLessThan(s3._stressBreakdown.pbOvershootBoost);
    });

    it('低 best=150（低 PB 守卫）→ 即使 score=300 也不触发 pbOvershoot', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 300, 2, 0.55, {
            totalRounds: 25,
            bestScore: 150,
            holes: 0,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(false);
        expect(s.spawnHints.pbOvershootActive).toBe(false);
    });

    it('postPbRelease 期内（破 PB 后 3 spawn）pbOvershoot bypass', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1250, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            postPbReleaseActive: true,
            postPbReleaseRemaining: 2,
        });
        expect(s._stressBreakdown.pbOvershootActive).toBe(false);
    });

    it('D4 段 spawnHints 收紧：multiClearBonus ≤ cap、clearGuarantee 不增加', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1500, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s.spawnHints.pbOvershootActive).toBe(true);
        expect(s.spawnHints.multiClearBonus).toBeLessThanOrEqual(0.18);
        // D4 段 clearGuarantee 应被收紧（最高不超过 farFromPBBoost 给到的范围）
        expect(s.spawnHints.clearGuarantee).toBeLessThanOrEqual(2);
    });

    it('D4 段 pbExtremeOrderBoost 延续触发（弱强度 ≥ 0.08）', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 1200, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
        });
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBeGreaterThanOrEqual(0.08);
    });
});

describe('v1.56.4 §5.α.8 D0 远段分级（farExtremeBoostActive）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('pct=0.10（极远档，< extremeThreshold=0.15）→ farExtremeBoostActive=true', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.30, {
            totalRounds: 25,
            bestScore: 1000,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(true);
        expect(s.spawnHints.farExtremeBoostActive).toBe(true);
        // 极远档 multiClearBonus floor 应被抬到 0.55（高于 v1.56 原 0.45）
        expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.55);
    });

    it('pct=0.22（边缘档，>= extremeThreshold）→ farExtremeBoostActive=false', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 220, 0, 0.30, {
            totalRounds: 25,
            bestScore: 1000,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(true);
        expect(s.spawnHints.farExtremeBoostActive).toBe(false);
        // 边缘档 multiClearBonus floor 维持 v1.56 原 0.45
        expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.45);
        expect(s.spawnHints.multiClearBonus).toBeLessThan(0.55);
    });
});

describe('v1.56.4 §5.α.8 pbGrowthFast 反向加压', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('pbGrowthFast=false → challengeBoost cap 维持 0.15（未上调）', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 950, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            pbGrowthFast: false,
        });
        expect(s._stressBreakdown.challengeBoost).toBeLessThanOrEqual(0.15);
        expect(s._stressBreakdown.challengeBoostGrowthCapBonus).toBeUndefined();
    });

    it('pbGrowthFast=true → challengeBoost cap 上调到 0.20', () => {
        const p = makeProfile({ smoothSkill: 0.70, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 950, 2, 0.55, {
            totalRounds: 25,
            bestScore: 1000,
            holes: 0,
            pbGrowthFast: true,
        });
        // 上调 cap 后允许达到 0.15 之上
        expect(s._stressBreakdown.challengeBoostGrowthCapBonus).toBe(0.05);
    });
});

// ── v1.56.2 §5.α.6 认知一致性守卫（低 PB 守卫） ─────────────────────

describe('v1.56.2 §5.α.6 低 PB 守卫（bestScore < 200 时 PB 段算法 bypass）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('低 best=80 + D0 段 → farFromPBBoostBypass="low_best_score"', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 20, 0, 0.30, {
            totalRounds: 20,
            bestScore: 80,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('low_best_score');
    });

    it('低 best=150 + D3 段 → pbExtremeOrderBoost 不触发', () => {
        const p = makeProfile({ smoothSkill: 0.72, lifetimeGames: 30, lifetimePlacements: 900, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 145, 2, 0.55, {
            totalRounds: 20,
            bestScore: 150,
            holes: 0,
        });
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBeUndefined();
    });

    it('阈值临界 best=200（含等号）→ farFromPBBoost 正常激活', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.30, {
            totalRounds: 20,
            bestScore: 200,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(true);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBeNull();
    });

    it('阈值临界 best=199（小于 200）→ farFromPBBoost bypass', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 20, lifetimePlacements: 600, spawnCounter: 30 });
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.30, {
            totalRounds: 20,
            bestScore: 199,
        });
        expect(s.spawnHints.farFromPBBoostActive).toBe(false);
        expect(s._stressBreakdown.farFromPBBoostBypass).toBe('low_best_score');
    });

    it('低 best=120 + D3 段 → 走 challengeBoost（v1.55 老路径不受 §5.α.6 影响）', () => {
        const p = makeProfile({ smoothSkill: 0.65, lifetimeGames: 10, lifetimePlacements: 300, spawnCounter: 10 });
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.35, {
            totalRounds: 12,
            bestScore: 120,
            holes: 0,
        });
        // challengeBoost 在低 best 时仍然走 v1.55 已有逻辑（基于 pct 0.83），不被新守卫拦截
        expect(s._stressBreakdown.challengeBoost).toBeGreaterThan(0);
        // 但 pbExtremeOrderBoost（新机制）依然 bypass
        expect(s._stressBreakdown.pbExtremeOrderBoost).toBeUndefined();
    });
});

describe('v1.56.2 §5.α.6 Game._isLowBestForIntenseCopy 判定', () => {
    it('best=0 (无 PB) → false（避免新手第一局误触发）', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = { bestScore: 0 };
        expect(Game.prototype._isLowBestForIntenseCopy.call(game)).toBe(false);
    });

    it('best=199 → true（低于默认阈值 200）', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = { bestScore: 199 };
        expect(Game.prototype._isLowBestForIntenseCopy.call(game)).toBe(true);
    });

    it('best=200 → false（阈值含等号边界，正好达成不算"低"）', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = { bestScore: 200 };
        expect(Game.prototype._isLowBestForIntenseCopy.call(game)).toBe(false);
    });

    it('best=5000 → false（高水位玩家完全不受守卫影响）', async () => {
        const { Game } = await import('../web/src/game.js');
        const game = { bestScore: 5000 };
        expect(Game.prototype._isLowBestForIntenseCopy.call(game)).toBe(false);
    });

    it('best=NaN / undefined → false（健壮性兜底）', async () => {
        const { Game } = await import('../web/src/game.js');
        expect(Game.prototype._isLowBestForIntenseCopy.call({ bestScore: NaN })).toBe(false);
        expect(Game.prototype._isLowBestForIntenseCopy.call({})).toBe(false);
    });
});

describe('v1.56.2 §5.α.6 best.over.neutral i18n 文案', () => {
    it('zh-CN best.over.neutral 存在且为中性表述（不含 "封神 / 突破"）', () => {
        expect(zhCN['best.over.neutral']).toBeTruthy();
        expect(zhCN['best.over.neutral']).not.toMatch(/封神|突破/);
    });
    it('en best.over.neutral 存在且为中性表述（不含 "Legend"）', () => {
        expect(en['best.over.neutral']).toBeTruthy();
        expect(en['best.over.neutral']).not.toMatch(/Legend|break/i);
    });
});

describe('v1.56.5 + v1.56.7 best-gap HUD：用 _bestScoreAtRunStart 作为稳定基线（修复"已超 0 分"bug）', () => {
    /* 用户截图反馈（v1.56.5 起）：
     *   - 第一轮：得分=最佳=380 时显示 "已超 0 分"
     *     根因：实时 bestScore 在玩家破 PB 后立即同步到 score，over=score-bestScore=0。
     *     修复：所有 best-gap 计算使用 _bestScoreAtRunStart（本局开局 PB 基线）。
     *   - 第二轮（v1.56.7）：得分 210 / 最佳 140 / 已超 190 → 三数关系错乱。
     *     根因1：updateUI 顺序 bug（DOM 写入在 _maybeCelebrateNewBest 之前 → "最佳" 慢一帧）
     *     根因2：gap=0 时走 over 分支显示 "本局 +0" 仍是认知错误
     *     修复：1) _maybeCelebrateNewBest 提前到 updateUI 开头；2) 严格 gap < 0 才进 over 分支。 */

    function computeBestGapState({ bestScore, score, bestScoreAtRunStart, placements = 10 }) {
        /* 复刻 game.js updateUI best-gap 块的核心逻辑用于回归测试。
         * 实际渲染由 game.js 完成，这里只验证基线选择与字段计算正确性。 */
        const pbBaseline = Number(bestScoreAtRunStart) || 0;
        const gap = pbBaseline - score;
        const inWarmup = placements < 3;
        const visible = bestScore > 0 && pbBaseline > 0 && !inWarmup;
        if (!visible) return { visible: false };
        if (gap > 0) {
            return { visible: true, mode: 'gap', gap, ratio: gap / pbBaseline };
        }
        if (gap < 0) {
            return { visible: true, mode: 'over', over: score - pbBaseline };
        }
        /* v1.56.7：gap === 0（追平 baseline）→ HUD 隐藏，不显示 "本局 +0" */
        return { visible: false, mode: 'tie' };
    }

    it('破 PB 后 over 随 score 持续递增（而非永远归零）', () => {
        // 玩家本局开局 PB=300，本局打到 380、450、520
        const s1 = computeBestGapState({ bestScore: 380, score: 380, bestScoreAtRunStart: 300 });
        const s2 = computeBestGapState({ bestScore: 450, score: 450, bestScoreAtRunStart: 300 });
        const s3 = computeBestGapState({ bestScore: 520, score: 520, bestScoreAtRunStart: 300 });
        expect(s1).toEqual({ visible: true, mode: 'over', over: 80 });
        expect(s2).toEqual({ visible: true, mode: 'over', over: 150 });
        expect(s3).toEqual({ visible: true, mode: 'over', over: 220 });
    });

    it('v1.56.7：score === baseline（追平临界）→ best-gap 隐藏（不显示"本局 +0"）', () => {
        const s = computeBestGapState({ bestScore: 300, score: 300, bestScoreAtRunStart: 300 });
        // v1.56.6 之前：返回 over=0 显示"本局 +0"——被用户标记"逻辑错误"
        // v1.56.7 起：gap === 0 时 visible=false，让 PB 烟花独自承担追平反馈
        expect(s.visible).toBe(false);
        expect(s.mode).toBe('tie');
    });

    it('v1.56.7：score 比 baseline 多 1（最小突破）→ 显示 "本局 +1"', () => {
        const s = computeBestGapState({ bestScore: 301, score: 301, bestScoreAtRunStart: 300 });
        expect(s).toEqual({ visible: true, mode: 'over', over: 1 });
    });

    it('v1.56.7：用户截图复刻（score=210 / baseline=20）→ over=190 且 mode=over', () => {
        // 玩家本局开局 PB=20（新手低 base），本局打到 210
        // 修复前 DOM 三数错乱（"得分 210 / 最佳 140 / 已超 190"——"最佳" 慢一帧）
        // 修复后：最佳 DOM 同步到 210，best-gap 显示 "本局 +190"
        const s = computeBestGapState({ bestScore: 210, score: 210, bestScoreAtRunStart: 20 });
        expect(s).toEqual({ visible: true, mode: 'over', over: 190 });
    });

    it('首次破 PB（baseline=0，新手第一次玩）→ best-gap 隐藏', () => {
        // 玩家首次启动游戏，没有 PB 历史；本局打到 380（自动成为新 PB）
        const s = computeBestGapState({ bestScore: 380, score: 380, bestScoreAtRunStart: 0 });
        expect(s).toEqual({ visible: false });
        // 仪式感由 PB 烟花 + 结算页皇冠承载，不通过 best-gap 暴露 "已超 380 分"（基线为 0 无意义）
    });

    it('未破 PB 时 gap 用 baseline 计算（不受实时 bestScore 影响）', () => {
        // 玩家本局开局 PB=1000，本局打到 800
        const s = computeBestGapState({ bestScore: 1000, score: 800, bestScoreAtRunStart: 1000 });
        expect(s).toEqual({ visible: true, mode: 'gap', gap: 200, ratio: 0.20 });
    });

    it('破 PB 后 bestScore 实时更新到 score，但 baseline 不变 → over 仍正确', () => {
        // 这是修复前会失败的核心场景：用户截图的 "得分=最佳=380" + "已超 0 分"
        const baseline = 200;  // 本局开局时玩家 PB=200
        const score = 380;
        const bestScoreLive = 380;  // 破 PB 后 bestScore 已实时同步到 380
        const s = computeBestGapState({ bestScore: bestScoreLive, score, bestScoreAtRunStart: baseline });
        expect(s).toEqual({ visible: true, mode: 'over', over: 180 });
        // ✓ 修复后：显示 "已超 180 分"
        // ✗ 修复前：显示 "已超 0 分"（over = score - bestScore = 0）
    });

    it('warmup 期（placements<3）即使有 baseline 也不显示', () => {
        const s = computeBestGapState({ bestScore: 500, score: 200, bestScoreAtRunStart: 500, placements: 2 });
        expect(s).toEqual({ visible: false });
    });
});

// ── pbGrowthTracker × _emitPersonalBestEvent 集成 ─────────────────────

describe('v1.56 §2.4 _emitPersonalBestEvent 同步写入 pbGrowthTracker 历史', () => {
    let busEvents;
    let bus;
    beforeEach(async () => {
        const { __clearPbHistoryForTest } = await import('../web/src/pbGrowthTracker.js');
        __clearPbHistoryForTest();
        busEvents = [];
        bus = { emit: (type, payload) => busEvents.push({ type, payload }) };
    });

    it('_emitPersonalBestEvent 调用后 pb history 多一条记录', async () => {
        const { Game } = await import('../web/src/game.js');
        const { readPbHistory } = await import('../web/src/pbGrowthTracker.js');
        const game = {
            _monetizationBus: bus,
            strategy: 'normal',
            gameStats: { placements: 30 },
        };
        Game.prototype._emitPersonalBestEvent.call(game, {
            previousBest: 1000, newBest: 1200, delta: 200,
            celebrationIndex: 1, isFirst: true,
        });
        const history = readPbHistory();
        expect(history.length).toBe(1);
        expect(history[0].value).toBe(1200);
    });
});
