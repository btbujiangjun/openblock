/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    STRESS_LEVELS,
    SIGNAL_LABELS,
    getStressLevel,
    summarizeContributors,
    computeTrend,
    buildStoryLine,
    renderStressMeter
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
