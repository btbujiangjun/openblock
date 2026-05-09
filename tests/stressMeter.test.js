/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    STRESS_LEVELS,
    SIGNAL_LABELS,
    getStressLevel,
    getStressDisplay,
    summarizeContributors,
    computeTrend,
    buildStoryLine,
    renderStressMeter,
    classifyHarvestDensity,
    shouldUseScorePushHighStress
} from '../web/src/stressMeter.js';

describe('getStressLevel', () => {
    it('低于 -0.05 走 calm 档', () => {
        expect(getStressLevel(-0.2).id).toBe('calm');
        expect(getStressLevel(-0.06).id).toBe('calm');
    });

    it('心流区间稳定落在 flow 档', () => {
        expect(getStressLevel(0.20).id).toBe('flow');
        expect(getStressLevel(0.30).id).toBe('flow');
        expect(getStressLevel(0.44).id).toBe('flow');
    });

    it('紧张/高压档边界正确', () => {
        expect(getStressLevel(0.65).id).toBe('tense');
        expect(getStressLevel(0.79).id).toBe('tense');
        expect(getStressLevel(0.80).id).toBe('intense');
        expect(getStressLevel(1.0).id).toBe('intense');
    });

    it('非数字回退到 flow 默认档', () => {
        expect(getStressLevel(NaN).id).toBe('flow');
        expect(getStressLevel(undefined).id).toBe('flow');
    });

    it('每个等级都有 face 与 label', () => {
        for (const lv of STRESS_LEVELS) {
            expect(lv.face).toBeTruthy();
            expect(lv.label).toBeTruthy();
        }
    });
});

describe('summarizeContributors', () => {
    it('过滤标量元数据并按绝对值排序', () => {
        const breakdown = {
            scoreStress: 0.18,
            comboAdjust: 0.04,
            recoveryAdjust: -0.32,
            frustrationRelief: -0.12,
            // 应被过滤
            boardRisk: 0.5,
            rawStress: 0.42,
            beforeClamp: 0.42,
            afterClamp: 0.42,
            afterSmoothing: 0.40,
            finalStress: 0.40
        };
        const list = summarizeContributors(breakdown, 5);
        expect(list[0].key).toBe('recoveryAdjust');
        expect(list[1].key).toBe('scoreStress');
        expect(list[2].key).toBe('frustrationRelief');
        expect(list.every((c) => !['boardRisk', 'rawStress', 'finalStress'].includes(c.key))).toBe(true);
    });

    it('小于 0.005 的微小信号被忽略', () => {
        const list = summarizeContributors({
            comboAdjust: 0.003,
            scoreStress: 0.20
        });
        expect(list).toHaveLength(1);
        expect(list[0].key).toBe('scoreStress');
    });

    it('正负信号正确标记 sign', () => {
        const list = summarizeContributors({
            scoreStress: 0.18,
            recoveryAdjust: -0.10
        });
        expect(list.find((c) => c.key === 'scoreStress').sign).toBe('pos');
        expect(list.find((c) => c.key === 'recoveryAdjust').sign).toBe('neg');
    });

    it('未注册的 key 用原始名兜底', () => {
        const list = summarizeContributors({ noSuchKey: 0.42 });
        expect(list[0].label).toBe('noSuchKey');
        expect(list[0].hint).toBe('');
    });

    it('空 / 非对象输入返回空数组', () => {
        expect(summarizeContributors(null)).toEqual([]);
        expect(summarizeContributors(undefined)).toEqual([]);
        expect(summarizeContributors(123)).toEqual([]);
    });
});

describe('computeTrend', () => {
    it('历史不足时给 flat', () => {
        expect(computeTrend([], 0.5).direction).toBe('flat');
        expect(computeTrend([0.5], 0.5).direction).toBe('flat');
    });

    it('明显升高时返回 up', () => {
        const t = computeTrend([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5], 0.5);
        expect(t.direction).toBe('up');
        expect(t.icon).toBe('↗');
        expect(t.delta).toBeGreaterThan(0);
    });

    it('明显降低时返回 down', () => {
        const t = computeTrend([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.2], 0.2);
        expect(t.direction).toBe('down');
        expect(t.icon).toBe('↘');
    });

    it('小波动认为平稳', () => {
        const t = computeTrend([0.40, 0.41, 0.39, 0.40, 0.41, 0.40], 0.41);
        expect(t.direction).toBe('flat');
    });
});

describe('buildStoryLine', () => {
    const flowLevel = STRESS_LEVELS.find((l) => l.id === 'flow');

    it('盘面风险高时优先讲保活', () => {
        const story = buildStoryLine(flowLevel, { boardRisk: 0.7 }, null, null);
        expect(story).toMatch(/保活/);
    });

    it('挫败救济触发时给减压叙事', () => {
        const story = buildStoryLine(flowLevel, { frustrationRelief: -0.08 }, null, null);
        expect(story).toMatch(/挫败|减压/);
    });

    it('挑战 boost 触发时讲挑战历史最佳', () => {
        const story = buildStoryLine(flowLevel, { challengeBoost: 0.10 }, null, null);
        expect(story).toMatch(/历史最佳/);
    });

    it('无任何特殊信号回落到 level vibe', () => {
        const story = buildStoryLine(flowLevel, {}, null, null);
        expect(story).toBe(flowLevel.vibe);
    });

    it('rhythmPhase=payoff 时讲收获节奏', () => {
        const story = buildStoryLine(flowLevel, {}, null, { rhythmPhase: 'payoff' });
        expect(story).toMatch(/收获/);
    });

    it('friendlyBoardRelief 触发时讲清爽盘面（优先于 challenge）', () => {
        const story = buildStoryLine(flowLevel,
            { friendlyBoardRelief: -0.15, challengeBoost: 0.08 },
            null, null);
        expect(story).toMatch(/通透|减压|多消/);
    });

    it('SIGNAL_LABELS 已包含 v1.13 新增信号 friendlyBoardRelief', () => {
        expect(SIGNAL_LABELS.friendlyBoardRelief).toBeDefined();
        expect(SIGNAL_LABELS.friendlyBoardRelief.label).toBe('友好盘面');
    });

    /* v1.23：spawnIntent 是出块意图的唯一对外口径，永远优先 ——
     * 旧版 v1.16 加了 gating `frust > -0.08 && recovery > -0.08`，让 frustRelief 触发时
     * 绕过 SPAWN_INTENT_NARRATIVE，与 v1.18 stressMeter "救济中" label + 友好 vibe 拉扯。
     * 新版让 spawnIntent 永远优先（除非 boardRisk 极高让"保活"抢占）。 */
    it('v1.23 spawnIntent=relief + frustRelief=-0.18 时优先 SPAWN_INTENT_NARRATIVE.relief（不再退到老严厉文案）', () => {
        const story = buildStoryLine(flowLevel,
            { frustrationRelief: -0.18 },
            null,
            { spawnIntent: 'relief' });
        expect(story).toBe('盘面通透又是兑现窗口，悄悄给你减压享受多消。');
        expect(story).not.toMatch(/挫败感偏高/);
    });

    it('v1.23 spawnIntent=harvest + recoveryAdjust=-0.20 时优先 SPAWN_INTENT_NARRATIVE.harvest（低压档）', () => {
        const story = buildStoryLine(flowLevel,
            { recoveryAdjust: -0.20 },
            null,
            { spawnIntent: 'harvest' });
        expect(story).toBe('识别到密集消行机会，正在投放促清的形状。');
        expect(story).not.toMatch(/恢复窗口/);
    });

    it('v1.29 spawnIntent=harvest + level=tense → 高压守卫叙事（与头像「紧张」同口径）', () => {
        const tenseLevel = STRESS_LEVELS.find((l) => l.id === 'tense');
        const story = buildStoryLine(tenseLevel, { boardRisk: 0.2 }, null, { spawnIntent: 'harvest' });
        expect(story).toMatch(/吃紧|可消行|促清|降压/);
        expect(story).not.toBe('识别到密集消行机会，正在投放促清的形状。');
    });

    it('v1.29 spawnIntent=harvest + level=intense → 高压守卫叙事', () => {
        const intenseLevel = STRESS_LEVELS.find((l) => l.id === 'intense');
        const story = buildStoryLine(intenseLevel, { boardRisk: 0.2 }, null, { spawnIntent: 'harvest' });
        expect(story).toMatch(/高压|促清|解压/);
    });

    it('v1.23 boardRisk≥0.6 仍能抢占 spawnIntent（极端保活信号最高优先）', () => {
        const story = buildStoryLine(flowLevel,
            { boardRisk: 0.7 },
            null,
            { spawnIntent: 'flow' });
        expect(story).toMatch(/保活/);
    });

    it('v1.23 spawnIntent 缺失（老回放兼容）→ 仍走 frustrationRelief 兜底', () => {
        const story = buildStoryLine(flowLevel,
            { frustrationRelief: -0.18 },
            null,
            null); // spawnHints 缺失
        expect(story).toMatch(/挫败感偏高/);
    });

    /* v1.24：SPAWN_INTENT_NARRATIVE.flow 拆按 rhythmPhase 选变体 ——
     * 旧版硬编码"节奏进入收获期"在 R1 空盘 + delight.mode='flow_payoff' + rhythmPhase='setup'
     * 时与 pill「节奏 搭建」+ strategyAdvisor「搭建期」三方对立（截图复现）。 */
    it('v1.24 spawnIntent=flow + rhythmPhase=setup → 用"搭建/留通道"变体（不再说"收获期"）', () => {
        const story = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'flow', rhythmPhase: 'setup' });
        expect(story).toMatch(/搭建|留好通道|等下一波/);
        expect(story).not.toMatch(/收获期|享受多消快感/);
    });

    it('v1.24 spawnIntent=flow + rhythmPhase=payoff → 用"收获期"爽点变体', () => {
        const story = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'flow', rhythmPhase: 'payoff' });
        expect(story).toMatch(/收获期/);
        expect(story).toMatch(/多消快感/);
    });

    it('v1.24 spawnIntent=flow + rhythmPhase=neutral → 用"维持"中性变体', () => {
        const story = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'flow', rhythmPhase: 'neutral' });
        expect(story).toMatch(/自然流畅|维持当前出块/);
        expect(story).not.toMatch(/收获期/);
    });

    it('v1.24 spawnIntent=flow + rhythmPhase 缺失（老回放兼容）→ 兜底 SPAWN_INTENT_NARRATIVE.flow', () => {
        const story = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'flow' }); // rhythmPhase 缺失
        expect(story).toBe('心流稳定，系统继续维持流畅的出块节奏。');
        expect(story).not.toMatch(/收获期/); // v1.24 兜底文案也不再硬编码"收获期"
    });

    it('v1.27 level=tense + spawnIntent=flow 时不再输出"心流稳定"（与档位一致）', () => {
        const tenseLevel = STRESS_LEVELS.find((l) => l.id === 'tense');
        const story = buildStoryLine(tenseLevel, {}, null,
            { spawnIntent: 'flow', rhythmPhase: 'setup' });
        expect(story).toMatch(/压力|优先保留|通道/);
        expect(story).not.toMatch(/心流稳定/);
    });

    it('v1.27 level=intense + spawnIntent=flow 时改为高压保活语义', () => {
        const intenseLevel = STRESS_LEVELS.find((l) => l.id === 'intense');
        const story = buildStoryLine(intenseLevel, {}, null,
            { spawnIntent: 'flow', rhythmPhase: 'payoff' });
        expect(story).toMatch(/高压区|优先保活|基础消行/);
        expect(story).not.toMatch(/心流稳定|收获期/);
    });

    it('v1.24 其他 intent (relief/harvest 等) 不受 flow 变体表影响', () => {
        const reliefStory = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'relief', rhythmPhase: 'setup' });
        expect(reliefStory).toBe('盘面通透又是兑现窗口，悄悄给你减压享受多消。');

        // v1.31：geometry 缺失时 harvest 仍回退到旧默认（兼容老回放/缺 spawnDiagnostics）
        const harvestStory = buildStoryLine(flowLevel, {}, null,
            { spawnIntent: 'harvest', rhythmPhase: 'setup' });
        expect(harvestStory).toBe('识别到密集消行机会，正在投放促清的形状。');
    });
});

/* v1.31：score-push 高压守卫
 *
 * 复现场景：玩家正逼近/打破个人最佳，scoreStress + feedbackBias + challengeBoost
 *   把 stress 推到 tense/intense，但盘面还很空（fill<0.30、holes=0）；
 *   旧版 FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL.intense 文案是「保活/确保可落位」，
 *   与玩家所见空旷盘面错位。新守卫切到"冲分仪式感"语义。 */
describe('v1.31 score-push 高压守卫', () => {
    const tenseLevel = STRESS_LEVELS.find((l) => l.id === 'tense');
    const intenseLevel = STRESS_LEVELS.find((l) => l.id === 'intense');
    const flowLevel = STRESS_LEVELS.find((l) => l.id === 'flow');

    describe('shouldUseScorePushHighStress 判定函数', () => {
        it('flow + intense + fill=0.20 + holes=0 → true', () => {
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.20, holes: 0 })).toBe(true);
        });

        it('harvest + tense + fill=0.25 + holes=0 → true', () => {
            expect(shouldUseScorePushHighStress(tenseLevel, 'harvest',
                { boardFill: 0.25, holes: 0 })).toBe(true);
        });

        it('intent=relief / pressure / engage → false（仅 flow/harvest 适用）', () => {
            const geom = { boardFill: 0.10, holes: 0 };
            expect(shouldUseScorePushHighStress(intenseLevel, 'relief', geom)).toBe(false);
            expect(shouldUseScorePushHighStress(intenseLevel, 'pressure', geom)).toBe(false);
            expect(shouldUseScorePushHighStress(intenseLevel, 'engage', geom)).toBe(false);
        });

        it('level=flow / engaged / easy → false（不到 tense/intense）', () => {
            const easyLevel = STRESS_LEVELS.find((l) => l.id === 'easy');
            const engagedLevel = STRESS_LEVELS.find((l) => l.id === 'engaged');
            const geom = { boardFill: 0.20, holes: 0 };
            expect(shouldUseScorePushHighStress(easyLevel, 'flow', geom)).toBe(false);
            expect(shouldUseScorePushHighStress(engagedLevel, 'flow', geom)).toBe(false);
            expect(shouldUseScorePushHighStress(flowLevel, 'flow', geom)).toBe(false);
        });

        it('boardFill ≥ 0.30 → false（盘面已不算"友好"）', () => {
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.30, holes: 0 })).toBe(false);
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.55, holes: 0 })).toBe(false);
        });

        it('holes > 0 → false（盘面已有结构性问题，"冲分"叙事不再合适）', () => {
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.20, holes: 1 })).toBe(false);
        });

        it('boardFill 缺失 / 非数 → false（保守不抢占既有守卫）', () => {
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow', {})).toBe(false);
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: NaN, holes: 0 })).toBe(false);
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow', undefined)).toBe(false);
        });

        it('自定义 fillThreshold 生效', () => {
            // 0.45 阈值下 fill=0.40 仍算友好
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.40, holes: 0 }, 0.45)).toBe(true);
            expect(shouldUseScorePushHighStress(intenseLevel, 'flow',
                { boardFill: 0.40, holes: 0 }, 0.30)).toBe(false);
        });
    });

    describe('buildStoryLine 集成 score-push 守卫', () => {
        it('flow + intense + 友好盘面 → 切到"冲分仪式感"叙事（不再说"保活"）', () => {
            const story = buildStoryLine(intenseLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'flow', rhythmPhase: 'payoff' },
                { boardFill: 0.20, holes: 0, nearFullLines: 0, multiClearCandidates: 0 });
            expect(story).toMatch(/冲击新高|冲分/);
            expect(story).not.toMatch(/保活|确保可落位/);
        });

        it('harvest + tense + 友好盘面 → 切到"冲分仪式感"叙事（抢占 HARVEST 高压守卫）', () => {
            const story = buildStoryLine(tenseLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.25, holes: 0, nearFullLines: 2, multiClearCandidates: 2 });
            expect(story).toMatch(/冲分|节奏拉紧/);
            expect(story).not.toMatch(/吃紧|降压/);
        });

        it('boardRisk ≥ 0.6 仍最高优先（即使满足 score-push 条件，保活仍抢占）', () => {
            const story = buildStoryLine(intenseLevel, { boardRisk: 0.7 }, null,
                { spawnIntent: 'flow' },
                { boardFill: 0.20, holes: 0 });
            expect(story).toMatch(/保活/);
            expect(story).not.toMatch(/冲分/);
        });

        it('盘面 fill 升高（≥ 0.30）→ 退回 FLOW 高压守卫文案', () => {
            const story = buildStoryLine(intenseLevel, { boardRisk: 0.2 }, null,
                { spawnIntent: 'flow', rhythmPhase: 'payoff' },
                { boardFill: 0.55, holes: 0 });
            expect(story).toMatch(/高压区|优先保活/);
            expect(story).not.toMatch(/冲分/);
        });

        it('geometry 缺失（旧回放）→ 退回 FLOW 高压守卫，向后兼容', () => {
            const story = buildStoryLine(intenseLevel, { boardRisk: 0.2 }, null,
                { spawnIntent: 'flow', rhythmPhase: 'payoff' });
            expect(story).toMatch(/高压区|优先保活/);
            expect(story).not.toMatch(/冲分/);
        });
    });
});

/* v1.31：harvest 按几何密度分级 ——
 * 旧版 SPAWN_INTENT_NARRATIVE.harvest 一律说"密集消行机会"，但 harvest 触发门槛
 * 只是 nfl≥2，nfl=2/mcc=2 时并不算"密集"。本组分 dense / visible / edge 三档。 */
describe('v1.31 harvest 密度分级', () => {
    const flowLevel = STRESS_LEVELS.find((l) => l.id === 'flow');

    describe('classifyHarvestDensity 判定函数', () => {
        it('nfl ≥ 3 → dense', () => {
            expect(classifyHarvestDensity({ nearFullLines: 3, multiClearCandidates: 1 })).toBe('dense');
            expect(classifyHarvestDensity({ nearFullLines: 5, multiClearCandidates: 0 })).toBe('dense');
        });

        it('mcc ≥ 3 → dense（即使 nfl 较小也算密集）', () => {
            expect(classifyHarvestDensity({ nearFullLines: 1, multiClearCandidates: 3 })).toBe('dense');
            expect(classifyHarvestDensity({ nearFullLines: 2, multiClearCandidates: 5 })).toBe('dense');
        });

        it('nfl = 2（最低触发档）→ visible（最常见，对应截图 2）', () => {
            expect(classifyHarvestDensity({ nearFullLines: 2, multiClearCandidates: 2 })).toBe('visible');
            expect(classifyHarvestDensity({ nearFullLines: 2, multiClearCandidates: 1 })).toBe('visible');
            expect(classifyHarvestDensity({ nearFullLines: 2, multiClearCandidates: 0 })).toBe('visible');
        });

        it('nfl < 2 → edge（pcSetup-only path）', () => {
            expect(classifyHarvestDensity({ nearFullLines: 1, multiClearCandidates: 1 })).toBe('edge');
            expect(classifyHarvestDensity({ nearFullLines: 0, multiClearCandidates: 0 })).toBe('edge');
        });

        it('字段缺失 / 非法值容忍处理', () => {
            expect(classifyHarvestDensity({})).toBe('edge');
            expect(classifyHarvestDensity(null)).toBe('edge');
            expect(classifyHarvestDensity(undefined)).toBe('edge');
            expect(classifyHarvestDensity({ nearFullLines: NaN, multiClearCandidates: NaN })).toBe('edge');
        });
    });

    describe('buildStoryLine 集成 harvest 密度分级', () => {
        it('dense（nfl=3） → "密集"措辞贴切', () => {
            const story = buildStoryLine(flowLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.55, holes: 0, nearFullLines: 3, multiClearCandidates: 2 });
            expect(story).toMatch(/密集/);
            expect(story).toMatch(/促清/);
        });

        it('visible（nfl=2、mcc=2，截图 2 复现） → "清晰可见"中等强度', () => {
            const story = buildStoryLine(flowLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.31, holes: 0, nearFullLines: 2, multiClearCandidates: 2 });
            expect(story).toMatch(/清晰|可见|通道|易兑现/);
            expect(story).not.toMatch(/密集/);  // 关键：不再夸大成"密集"
            expect(story).not.toMatch(/首个/);
        });

        it('edge（pcSetup-only path，nfl=0） → "首个窗口"试一手', () => {
            const story = buildStoryLine(flowLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.50, holes: 0, nearFullLines: 0, multiClearCandidates: 0 });
            expect(story).toMatch(/首个|试一手|窗口/);
            expect(story).not.toMatch(/密集/);
        });

        it('geometry 缺失（旧回放） → 沿用 SPAWN_INTENT_NARRATIVE.harvest（不改写历史）', () => {
            const story = buildStoryLine(flowLevel, { boardRisk: 0.1 }, null,
                { spawnIntent: 'harvest' });
            expect(story).toBe('识别到密集消行机会，正在投放促清的形状。');
        });

        it('harvest + tense（高压档）+ 友好盘面 → score-push 守卫优先（v1.31 新优先级）', () => {
            const tenseLevel = STRESS_LEVELS.find((l) => l.id === 'tense');
            const story = buildStoryLine(tenseLevel, { boardRisk: 0.2 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.20, holes: 0, nearFullLines: 3, multiClearCandidates: 3 });
            // 即使 dense，score-push 守卫先抢
            expect(story).toMatch(/冲分/);
            expect(story).not.toMatch(/促清|密集/);
        });

        it('harvest + tense（高压档）+ 高 fill → HARVEST 高压守卫（密度分级被绕过）', () => {
            const tenseLevel = STRESS_LEVELS.find((l) => l.id === 'tense');
            const story = buildStoryLine(tenseLevel, { boardRisk: 0.2 }, null,
                { spawnIntent: 'harvest' },
                { boardFill: 0.65, holes: 0, nearFullLines: 3, multiClearCandidates: 3 });
            expect(story).toMatch(/吃紧|可消行|促清|降压/);
        });
    });
});

describe('getStressDisplay v1.18 救济变体', () => {
    it('relief intent + 低 stress（calm）→ 切到「被照顾」face/label', () => {
        const d = getStressDisplay(-0.15, 'relief');
        expect(d.face).toBe('🤗');
        expect(d.label).toMatch(/救济中/);
        expect(d.id).toBe('calm');
        expect(d.vibe).toMatch(/系统正在为你减压/);
    });

    it('relief intent 但 stress 在 easy 区 → 不切（"舒缓 + 主动减压"语义不冲突）', () => {
        const d = getStressDisplay(0.10, 'relief');
        expect(d.face).not.toBe('🤗');
        expect(d.label).not.toMatch(/救济中/);
        expect(d.id).toBe('easy');
    });

    it('relief intent 但 stress 在 flow 区 → 不切（已离开低压档）', () => {
        const d = getStressDisplay(0.30, 'relief');
        expect(d.face).not.toBe('🤗');
        expect(d.label).not.toMatch(/救济中/);
    });

    it('其它 intent 完全沿用 getStressLevel', () => {
        const d = getStressDisplay(-0.10, 'flow');
        const base = getStressLevel(-0.10);
        expect(d.face).toBe(base.face);
        expect(d.label).toBe(base.label);
    });

    it('未提供 intent → 沿用基础档', () => {
        const d = getStressDisplay(-0.10);
        const base = getStressLevel(-0.10);
        expect(d.face).toBe(base.face);
        expect(d.label).toBe(base.label);
    });
});

describe('summarizeContributors v1.13 元数据过滤', () => {
    it('flowPayoffCap 派生标记不计入贡献条', () => {
        const list = summarizeContributors({
            scoreStress: 0.18,
            friendlyBoardRelief: -0.14,
            flowPayoffCap: 0.79
        });
        const keys = list.map((c) => c.key);
        expect(keys).toContain('friendlyBoardRelief');
        expect(keys).toContain('scoreStress');
        expect(keys).not.toContain('flowPayoffCap');
    });
});

describe('renderStressMeter', () => {
    let host;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    it('未启用自适应时渲染 disabled 状态', () => {
        renderStressMeter(host, { adaptiveEnabled: false });
        const meter = host.querySelector('.stress-meter');
        expect(meter.classList.contains('stress-meter--disabled')).toBe(true);
        expect(host.textContent).toMatch(/未启用/);
    });

    it('正常输入渲染头像 + 数值 + 主体', () => {
        renderStressMeter(host, {
            adaptiveEnabled: true,
            stress: 0.42,
            stressBreakdown: { scoreStress: 0.18, recoveryAdjust: -0.04 }
        }, [0.30, 0.32, 0.35, 0.38, 0.40, 0.42]);
        const meter = host.querySelector('.stress-meter');
        expect(meter.dataset.level).toBe('flow');
        expect(host.querySelector('.stress-meter__face')).toBeTruthy();
        expect(host.querySelector('.stress-meter__num').textContent).toMatch(/0\.42/);
        expect(host.querySelector('.stress-meter__bar-fill')).toBeTruthy();
    });

    it('v1.13：信号贡献已整合进下方 sparkline 曲线，stressMeter 不再渲染 .stress-meter__signal 列表', () => {
        renderStressMeter(host, {
            adaptiveEnabled: true,
            stress: 0.6,
            stressBreakdown: { scoreStress: 0.30, recoveryAdjust: -0.15 }
        });
        // details/列表 DOM 应被完全移除（信号分量改由 REPLAY_METRICS 内 stress 组曲线呈现）
        expect(host.querySelector('.stress-meter__details')).toBeNull();
        expect(host.querySelectorAll('.stress-meter__signal').length).toBe(0);
        // 但综合 stress 数值与等级仍正常渲染
        expect(host.querySelector('.stress-meter__num').textContent).toMatch(/0\.60/);
    });

    it('SIGNAL_LABELS 覆盖所有 stressBreakdown 主要 key', () => {
        const expectedKeys = [
            'scoreStress', 'runStreakStress', 'difficultyBias', 'skillAdjust',
            'flowAdjust', 'pacingAdjust', 'recoveryAdjust', 'frustrationRelief',
            'comboAdjust', 'nearMissAdjust', 'feedbackBias', 'trendAdjust',
            'sessionArcAdjust', 'holeReliefAdjust', 'boardRiskReliefAdjust',
            'abilityRiskAdjust', 'delightStressAdjust', 'challengeBoost'
        ];
        for (const k of expectedKeys) {
            expect(SIGNAL_LABELS[k], `missing label for ${k}`).toBeTruthy();
        }
    });

    it('趋势上升时显示 ↗', () => {
        renderStressMeter(host, {
            adaptiveEnabled: true,
            stress: 0.55,
            stressBreakdown: {}
        }, [0.10, 0.10, 0.10, 0.10, 0.10, 0.10]);
        const delta = host.querySelector('.stress-meter__delta');
        expect(delta.dataset.dir).toBe('up');
        expect(delta.textContent).toBe('↗');
    });
});
