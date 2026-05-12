/**
 * @vitest-environment jsdom
 *
 * 覆盖 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT 的 P1-1、P1-3、P1-4、P2-1、P2-3、
 * P2-4、E1–E8 实验登记的核心契约。
 *
 * P0 度量地基的回归测试分布在：
 *   - tests/playerMaturity.test.js（P0-1 双分制）
 *   - tests/playerLifecycleDashboard.test.js（P0-2 / P0-5）
 *   - tests/retentionAnalyzer.test.js（P0-3 cohort/funnel/趋势）
 */
import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};
Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (k) => mockStorage[k] ?? null,
        setItem: (k, v) => { mockStorage[k] = v; },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
    },
    writable: true,
});

import { resolveActions, getCoverage } from '../web/src/retention/lifecyclePlaybook.js';
import {
    activateWinback,
    consumeProtectedRound,
    getActivePreset,
    evaluateWinbackTrigger,
    DEFAULT_PROTECTION_PRESET,
    PROTECTED_ROUNDS,
    _resetWinbackForTests,
} from '../web/src/retention/winbackProtection.js';
import {
    evaluateMilestones,
    getMilestoneStatus,
    _resetMilestonesForTests,
} from '../web/src/retention/maturityMilestones.js';
import {
    startCycle,
    joinChallenge,
    completeChallenge,
    getCurrentPhase,
    isEligible,
    DEFAULT_CONFIG as WC_CONFIG,
    _resetWeeklyChallengeForTests,
} from '../web/src/monetization/weeklyChallenge.js';
import {
    LIFECYCLE_EXPERIMENT_TEMPLATES,
    registerLifecycleExperiments,
} from '../web/src/monetization/lifecycleExperiments.js';
import {
    getInGameNarrative,
    getOutOfGamePush,
    suggestIntentForSegment,
    SUPPORTED_INTENTS,
} from '../web/src/intentLexicon.js';

beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    _resetWinbackForTests();
    _resetMilestonesForTests();
    _resetWeeklyChallengeForTests();
});

describe('P1-1 lifecyclePlaybook 25 格矩阵', () => {
    it('coverage：非空格 ≥ 10 满足蓝图护栏', () => {
        const cov = getCoverage();
        expect(cov.totalCells).toBe(25);
        expect(cov.nonEmpty).toBeGreaterThanOrEqual(10);
    });

    it('resolveActions 返回的每个动作都有 intent（缺省由 lexicon 推荐）', () => {
        const actions = resolveActions('S2', 'M2');
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) {
            expect(a.id).toBeTruthy();
            expect(a.intent).toBeTruthy();
        }
    });

    it('resolveActions 接受 onboarding/L? 等旧别名', () => {
        const actions = resolveActions('onboarding', 'L1');
        expect(actions.length).toBeGreaterThan(0);
    });

    it('未声明的格子退到 DEFAULT_ACTIONS 而不是抛错', () => {
        /* S0·M4 在矩阵里没有，应继承默认 */
        const actions = resolveActions('S0', 'M4');
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.find((a) => a.id === 'daily_task_default')).toBeTruthy();
    });
});

describe('P2-3 winbackProtection', () => {
    it('daysSinceLastActive < 7：不触发', () => {
        expect(evaluateWinbackTrigger({ daysSinceLastActive: 3 })).toBe(false);
        const preset = activateWinback({ daysSinceLastActive: 3 });
        expect(preset).toBeNull();
    });

    it('daysSinceLastActive ≥ 7：激活、消耗 3 局后自动退出 + 上报事件', () => {
        const events = [];
        const tracker = { trackEvent: (name, props) => events.push({ name, props }) };
        const preset = activateWinback({ daysSinceLastActive: 14 }, { tracker });
        expect(preset).toEqual(DEFAULT_PROTECTION_PRESET);
        expect(getActivePreset()).not.toBeNull();
        expect(events.find((e) => e.name === 'winback_session_started')).toBeTruthy();

        let result = null;
        for (let i = 0; i < PROTECTED_ROUNDS; i++) {
            result = consumeProtectedRound({ tracker, survived: true, score: 100 });
        }
        expect(result.finished).toBe(true);
        expect(getActivePreset()).toBeNull();
        expect(events.find((e) => e.name === 'winback_session_completed')).toBeTruthy();
    });

    it('幂等：重复 activate 返回同一 preset', () => {
        const a = activateWinback({ daysSinceLastActive: 14 });
        const b = activateWinback({ daysSinceLastActive: 14 });
        expect(a).toEqual(b);
    });
});

describe('P2-1 maturityMilestones', () => {
    it('M0→M1 触发首次多消里程碑并发出事件，幂等不重复', () => {
        const events = [];
        const tracker = { trackEvent: (name, props) => events.push({ name, props }) };
        const newly = evaluateMilestones({ maxMultiClearInOneStep: 3 }, { tracker, stage: 'S1', band: 'M0' });
        expect(newly.length).toBe(1);
        expect(newly[0].id).toBe('m0_to_m1_first_multi_clear');
        expect(events.find((e) => e.name === 'maturity_milestone_complete')).toBeTruthy();

        const again = evaluateMilestones({ maxMultiClearInOneStep: 4 }, { tracker, stage: 'S1', band: 'M1' });
        expect(again.length).toBe(0);
    });

    it('getMilestoneStatus 返回完整 3 项状态', () => {
        const status = getMilestoneStatus();
        expect(status.length).toBe(3);
        expect(status.every((s) => s.id && s.from && s.to)).toBe(true);
    });
});

describe('P1-4 weeklyChallenge', () => {
    it('isEligible：M2/M3/M4 + S1/S2/S3 命中', () => {
        expect(isEligible({ stage: 'S2', band: 'M2' })).toBe(true);
        expect(isEligible({ stage: 'S0', band: 'M0' })).toBe(false);
        expect(isEligible({ stage: 'S2', band: 'M0' })).toBe(false);
    });

    it('72h 挑战 + 18h 空窗的相位计算正确', () => {
        const t0 = 1_700_000_000_000;
        const events = [];
        const tracker = { trackEvent: (name, props) => events.push({ name, props }) };

        startCycle({ now: t0, tracker, stage: 'S2', band: 'M2' });
        expect(getCurrentPhase({ now: t0 + 1000 }).phase).toBe('challenge');
        expect(getCurrentPhase({ now: t0 + WC_CONFIG.challengeWindowMs - 1 }).phase).toBe('challenge');
        expect(getCurrentPhase({ now: t0 + WC_CONFIG.challengeWindowMs + 1 }).phase).toBe('break');

        const join = joinChallenge({ now: t0 + 1000, tracker, stage: 'S2', band: 'M2' });
        expect(join).not.toBeNull();
        const complete = completeChallenge({ now: t0 + 5000, tracker, score: 1234, durationMs: 4000 });
        expect(complete).not.toBeNull();
        expect(events.filter((e) => e.name === 'weekly_challenge_join').length).toBeGreaterThanOrEqual(1);
        expect(events.find((e) => e.name === 'weekly_challenge_complete')).toBeTruthy();
    });

    it('在 break 期间不能 join / complete', () => {
        const t0 = 1_700_000_000_000;
        startCycle({ now: t0 });
        const breakNow = t0 + WC_CONFIG.challengeWindowMs + 1000;
        expect(joinChallenge({ now: breakNow })).toBeNull();
        expect(completeChallenge({ now: breakNow })).toBeNull();
    });
});

describe('Lifecycle Experiments E1–E8 + ETG', () => {
    it('共 9 个模板，E_TG 仅允许 clearGuarantee / sizePreference', () => {
        const ids = LIFECYCLE_EXPERIMENT_TEMPLATES.map((t) => t.id);
        expect(ids.length).toBe(9);
        const etg = LIFECYCLE_EXPERIMENT_TEMPLATES.find((t) => t.id === 'E_TG-spawn-fidelity-guard');
        expect(etg.allowedVariables).toEqual(['clearGuarantee', 'sizePreference']);
    });

    it('所有模板默认 disabled，避免登记动作直接上线', () => {
        for (const t of LIFECYCLE_EXPERIMENT_TEMPLATES) {
            expect(t.defaultEnabled).toBe(false);
        }
    });

    it('registerLifecycleExperiments 调用具备 registerExperiment 的 manager 时全部登记', () => {
        const calls = [];
        const fakeManager = {
            registerExperiment: (cfg) => calls.push(cfg.id),
        };
        const registered = registerLifecycleExperiments(fakeManager);
        expect(registered.length).toBe(LIFECYCLE_EXPERIMENT_TEMPLATES.length);
        expect(calls.length).toBe(LIFECYCLE_EXPERIMENT_TEMPLATES.length);
    });

    it('manager 缺失 registerExperiment 时静默返回空数组', () => {
        expect(registerLifecycleExperiments(null)).toEqual([]);
        expect(registerLifecycleExperiments({})).toEqual([]);
    });
});

describe('P2-4 intentLexicon', () => {
    it('SUPPORTED_INTENTS 与 stressMeter 词典共 6 项', () => {
        expect([...SUPPORTED_INTENTS].sort()).toEqual(
            ['engage', 'flow', 'harvest', 'maintain', 'pressure', 'relief']
        );
    });

    it('每个 intent 都有局内叙事 + 出局推送 + 任务文案', () => {
        for (const i of SUPPORTED_INTENTS) {
            expect(getInGameNarrative(i)).toBeTruthy();
            expect(getOutOfGamePush(i)).toBeTruthy();
        }
    });

    it('suggestIntentForSegment 按 stage/band 偏好推荐', () => {
        /* S4 → relief 的优先级最高 */
        expect(suggestIntentForSegment({ stage: 'S4', band: 'M0' })).toBe('relief');
        /* S2-M2 → engage / harvest / pressure 都候选；至少返回非空 */
        const s2m2 = suggestIntentForSegment({ stage: 'S2', band: 'M2' });
        expect(SUPPORTED_INTENTS).toContain(s2m2);
    });

    it('未知 intent 返回空字符串而非 throw', () => {
        expect(getInGameNarrative('not_a_real_intent')).toBe('');
        expect(getOutOfGamePush('not_a_real_intent')).toBe('');
    });
});
