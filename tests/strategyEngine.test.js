/**
 * @vitest-environment jsdom
 *
 * 商业化策略引擎单元测试（L1 + L2）
 * 验证重构后的 strategy/ 子系统：分层 + 解耦 + 配置驱动
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
    DEFAULT_STRATEGY_CONFIG,
    getStrategyConfig,
    setStrategyConfig,
    resetStrategyConfig,
    registerStrategyRule,
    unregisterStrategyRule,
    classifySegment,
    getSegmentDef,
    evaluate,
    buildWhyLines,
    shouldTriggerRule,
    HELP_TEXTS,
    getHelpText,
    helpAttrs,
    listHelpKeys,
    dumpConfigSchema,
} from '../web/src/monetization/strategy/index.js';

describe('strategyConfig', () => {
    beforeEach(() => { resetStrategyConfig(); });

    it('默认配置包含 3 个分群', () => {
        const cfg = getStrategyConfig();
        expect(cfg.segments).toHaveLength(3);
        expect(cfg.segments.map(s => s.id)).toEqual(['whale', 'dolphin', 'minnow']);
    });

    it('classifySegment 按 whaleScore 正确分群', () => {
        expect(classifySegment(0.75)).toBe('whale');
        expect(classifySegment(0.45)).toBe('dolphin');
        expect(classifySegment(0.10)).toBe('minnow');
        expect(classifySegment(0)).toBe('minnow');
    });

    it('classifySegment 在自定义阈值下重新分群', () => {
        setStrategyConfig({
            segments: [
                { id: 'vip',     label: 'VIP',     icon: '👑', color: '#000', minWhaleScore: 0.8 },
                { id: 'regular', label: 'Regular', icon: '👤', color: '#333', minWhaleScore: 0   },
            ],
        });
        expect(classifySegment(0.85)).toBe('vip');
        expect(classifySegment(0.5)).toBe('regular');
    });

    it('setStrategyConfig 深合并 thresholds 而不丢失其他字段', () => {
        const before = getStrategyConfig().thresholds.frustrationWarning;
        setStrategyConfig({ thresholds: { frustrationRescue: 8 } });
        const after = getStrategyConfig().thresholds;
        expect(after.frustrationRescue).toBe(8);
        expect(after.frustrationWarning).toBe(before);
    });

    it('registerStrategyRule 同 id 替换', () => {
        const before = getStrategyConfig().rules.length;
        registerStrategyRule({
            id: 'whale_default_monthly',
            segments: ['whale'],
            action: { type: 'iap', product: 'annual_pass' },
            why: '改为年卡', effect: '+',
        });
        const after = getStrategyConfig().rules;
        expect(after.length).toBe(before);  // 未新增
        const replaced = after.find(r => r.id === 'whale_default_monthly');
        expect(replaced.action.product).toBe('annual_pass');
    });

    it('unregisterStrategyRule 删除规则', () => {
        const before = getStrategyConfig().rules.length;
        unregisterStrategyRule('minnow_interstitial_on_game_over');
        expect(getStrategyConfig().rules.length).toBe(before - 1);
    });

    it('resetStrategyConfig 恢复默认（隔离上一个测试的修改）', () => {
        setStrategyConfig({ thresholds: { frustrationRescue: 99 } });
        resetStrategyConfig();
        expect(getStrategyConfig().thresholds.frustrationRescue)
            .toBe(DEFAULT_STRATEGY_CONFIG.thresholds.frustrationRescue);
    });

    it('getSegmentDef 兜底返回最后一个', () => {
        expect(getSegmentDef('unknown').id).toBe('minnow');
    });
});

describe('strategyEngine.evaluate', () => {
    beforeEach(() => { resetStrategyConfig(); });

    it('Whale 用户在挫败时同时返回 monthly_pass + hint_pack_5', () => {
        const result = evaluate({
            persona:  { segment: 'whale', whaleScore: 0.7, activityScore: 0.8 },
            realtime: { frustration: 6, hadNearMiss: false },
        });
        const products = result.actions
            .filter(a => a.action.type === 'iap')
            .map(a => a.action.product);
        expect(products).toContain('monthly_pass');
        expect(products).toContain('hint_pack_5');
    });

    it('Whale 用户屏蔽插屏（action.format=none）', () => {
        const result = evaluate({
            persona:  { segment: 'whale', whaleScore: 0.7 },
            realtime: { frustration: 0 },
        });
        expect(result.actions.some(a => a.action.format === 'none')).toBe(true);
    });

    it('Dolphin 在 hadNearMiss 时插入 rewarded 规则', () => {
        const result = evaluate({
            persona:  { segment: 'dolphin', whaleScore: 0.45, activityScore: 0.5 },
            realtime: { frustration: 1, hadNearMiss: true },
        });
        const rewarded = result.actions.find(
            a => a.action.type === 'ads' && a.action.format === 'rewarded'
        );
        expect(rewarded).toBeDefined();
        expect(rewarded.active).toBe(true);
    });

    it('Dolphin 低活跃度时返回 push 推荐', () => {
        const result = evaluate({
            persona:  { segment: 'dolphin', whaleScore: 0.4, activityScore: 0.2 },
            realtime: {},
        });
        expect(result.actions.some(a => a.action.type === 'push')).toBe(true);
    });

    it('Minnow 默认插屏 + 任务激励', () => {
        const result = evaluate({
            persona:  { segment: 'minnow', whaleScore: 0.1, activityScore: 0.5 },
            realtime: {},
        });
        const types = result.actions.map(a => a.action.type);
        expect(types).toContain('ads');
        expect(types).toContain('task');
    });

    it('Minnow 挫败时切换到 starter_pack（替代默认插屏顺序）', () => {
        const result = evaluate({
            persona:  { segment: 'minnow', whaleScore: 0.1 },
            realtime: { frustration: 6 },
        });
        const starter = result.actions.find(a => a.action.product === 'starter_pack');
        expect(starter).toBeDefined();
        // 由于带 when 的规则被视为 active，排序应该靠前
        expect(starter.active).toBe(true);
    });

    it('active 规则排在 inactive 前面（同优先级）', () => {
        const result = evaluate({
            persona:  { segment: 'dolphin', whaleScore: 0.45 },
            realtime: { hadNearMiss: true },
        });
        // 第一条应该是 active 的（rewarded 规则）
        expect(result.actions[0].active).toBe(true);
    });

    it('动态 explain 函数生成的文案能覆盖静态 why', () => {
        const result = evaluate({
            persona:  { segment: 'whale', whaleScore: 0.7 },
            realtime: { frustration: 7 },
        });
        const hintPack = result.actions.find(a => a.action.product === 'hint_pack_5');
        expect(hintPack.why).toContain('7');  // 动态文案带入 frustration 数字
    });

    it('自定义新增规则在结果中出现', () => {
        registerStrategyRule({
            id: 'test_custom_rule',
            segments: ['minnow'],
            action: { type: 'email', template: 'win_back' },
            priority: 'low',
            why: 'test', effect: 'test',
        });
        const result = evaluate({
            persona:  { segment: 'minnow', whaleScore: 0.1 },
            realtime: {},
        });
        expect(result.actions.some(a => a.ruleId === 'test_custom_rule')).toBe(true);
    });

    it('whyLines 包含分群、挫败、近失、心流四类摘要', () => {
        const result = evaluate({
            persona:  { segment: 'dolphin', whaleScore: 0.42, activityScore: 0.65,
                        nearMissRate: 0.34 },
            realtime: { frustration: 6, hadNearMiss: true, flowState: 'anxious' },
        });
        const lines = result.whyLines.join('\n');
        expect(lines).toContain('分群');
        expect(lines).toContain('近失');
        expect(lines).toContain('救济');
        expect(lines).toContain('焦虑');
    });
});

describe('strategyEngine.shouldTriggerRule', () => {
    beforeEach(() => { resetStrategyConfig(); });

    it('未知 ruleId 返回 false', () => {
        expect(shouldTriggerRule('not_exist', { persona: {}, realtime: {} })).toBe(false);
    });

    it('分群不匹配返回 false', () => {
        expect(shouldTriggerRule('whale_default_monthly', {
            persona: { segment: 'minnow' }, realtime: {},
        })).toBe(false);
    });

    it('分群匹配且无 when 返回 true', () => {
        expect(shouldTriggerRule('whale_default_monthly', {
            persona: { segment: 'whale' }, realtime: {},
        })).toBe(true);
    });

    it('when 条件未满足返回 false', () => {
        expect(shouldTriggerRule('whale_hint_pack_on_frustration', {
            persona: { segment: 'whale' }, realtime: { frustration: 1 },
        })).toBe(false);
    });

    it('when 条件满足返回 true', () => {
        expect(shouldTriggerRule('whale_hint_pack_on_frustration', {
            persona: { segment: 'whale' }, realtime: { frustration: 8 },
        })).toBe(true);
    });
});

describe('strategyHelp', () => {
    it('HELP_TEXTS 覆盖核心 6 个信号', () => {
        ['signal.segment', 'signal.activity', 'signal.skill',
         'signal.frustration', 'signal.nearMiss', 'signal.flow'
        ].forEach(k => {
            expect(HELP_TEXTS[k]).toBeDefined();
            expect(HELP_TEXTS[k].length).toBeGreaterThan(10);
        });
    });

    it('HELP_TEXTS 覆盖 3 个分群权重', () => {
        ['weight.best_score_norm', 'weight.total_games_norm', 'weight.session_time_norm']
            .forEach(k => expect(getHelpText(k)).toBeTruthy());
    });

    it('HELP_TEXTS 覆盖所有 Feature Flag', () => {
        const flagKeys = ['adsRewarded', 'adsInterstitial', 'iap', 'dailyTasks',
            'leaderboard', 'skinUnlock', 'seasonPass', 'pushNotifications',
            'replayShare', 'stubMode'];
        flagKeys.forEach(k => {
            expect(getHelpText(`flag.${k}`)).toBeTruthy();
        });
    });

    it('helpAttrs 生成合法 HTML 属性串', () => {
        const attr = helpAttrs('signal.frustration');
        expect(attr).toContain('class="mon-help"');
        expect(attr).toContain('title="');
        expect(attr).toContain('data-help-key="signal.frustration"');
        // 不包含未转义的双引号
        const titleMatch = attr.match(/title="([^"]*)"/);
        expect(titleMatch).toBeTruthy();
    });

    it('helpAttrs 对未注册 key 返回空字符串', () => {
        expect(helpAttrs('not.registered')).toBe('');
    });

    it('listHelpKeys 返回排序后的 key 列表', () => {
        const keys = listHelpKeys();
        expect(keys.length).toBeGreaterThan(20);
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
    });

    it('dumpConfigSchema 包含权重 / 阈值 / 分群三类条目', () => {
        const rows = dumpConfigSchema();
        const keys = rows.map(r => r.key);
        expect(keys.some(k => k.startsWith('weight.'))).toBe(true);
        expect(keys.some(k => k.startsWith('threshold.'))).toBe(true);
        expect(keys.some(k => k.startsWith('segment.'))).toBe(true);
    });
});
