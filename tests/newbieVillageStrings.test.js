/**
 * 新手村多语言字典完整性测试 —— 防止单语言包遗漏关键 UI 键导致玩家看到 raw key。
 *
 * 校验范围：
 *   - 19 个语言代码全部存在；
 *   - 关键 UI key（按钮、标题、奖励项）在每个语言里都有非空字符串；
 *   - zh-CN / en 必须有「教程长文」(scenario.* coach/reveal) 的完整翻译；
 *   - 其它 17 语言教程长文可缺译（运行时回退 en/zh-CN，UI 也用内嵌 fallback 兜底）。
 *
 * 占位符 {{n}} 不做替换校验（nvT 实现已经在自身函数中处理）。
 */
import { describe, it, expect } from 'vitest';
import { nvT, nvAvailableLocales, NV_LOCALE_PACKS } from '../web/src/onboarding/newbieVillageStrings.js';

const REQUIRED_LOCALES = [
    'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt-BR', 'nl',
    'ru', 'uk', 'pl', 'tr', 'vi', 'th', 'id', 'ar', 'el',
];

/** 每个语言包都必须有的核心 UI 键（按钮、标题、奖励、技能名） */
const CORE_UI_KEYS = [
    'ui.title',
    'ui.skip',
    'graduate.title',
    'graduate.subtitle',
    'graduate.scoreLabel',
    'graduate.skill.single',
    'graduate.skill.multi',
    'graduate.skill.mono',
    'graduate.skill.combo',
    'graduate.skill.perfect',
    'graduate.reward.title',
    'graduate.reward.hint',
    'graduate.reward.undo',
    'graduate.reward.coin',
    'graduate.cta',
    'graduate.ctaHint',
];

/** zh-CN 和 en 必须完整含教程长文（其它语言缺译可接受，运行时 fallback） */
const FULL_SCENARIO_KEYS = [
    'scenario.single.coach.title', 'scenario.single.coach.body',
    'scenario.single.reveal.title', 'scenario.single.reveal.body',
    'scenario.multi.coach.title', 'scenario.multi.coach.body',
    'scenario.multi.reveal.title', 'scenario.multi.reveal.body',
    'scenario.mono.coach.title', 'scenario.mono.coach.body',
    'scenario.mono.reveal.title', 'scenario.mono.reveal.body',
    'scenario.combo.coach.title', 'scenario.combo.coach.body',
    'scenario.combo.reveal.title', 'scenario.combo.reveal.body',
    'scenario.perfect.coach.title', 'scenario.perfect.coach.body',
    'scenario.perfect.reveal.title', 'scenario.perfect.reveal.body',
];

describe('newbieVillageStrings · locale packs', () => {
    it('exports all 19 required locales', () => {
        const locs = nvAvailableLocales();
        for (const code of REQUIRED_LOCALES) {
            expect(locs, `missing locale: ${code}`).toContain(code);
        }
    });

    it('every locale has all CORE_UI_KEYS with non-empty string', () => {
        for (const code of REQUIRED_LOCALES) {
            const pack = NV_LOCALE_PACKS[code];
            expect(pack, `pack ${code} missing`).toBeDefined();
            for (const key of CORE_UI_KEYS) {
                const v = pack[key];
                expect(v, `${code} missing key ${key}`).toBeDefined();
                expect(typeof v, `${code}.${key} type`).toBe('string');
                expect(v.length, `${code}.${key} empty`).toBeGreaterThan(0);
            }
        }
    });

    it('zh-CN and en include full scenario tutorial keys', () => {
        for (const code of ['zh-CN', 'en']) {
            const pack = NV_LOCALE_PACKS[code];
            for (const key of FULL_SCENARIO_KEYS) {
                const v = pack[key];
                expect(v, `${code} missing scenario key ${key}`).toBeDefined();
                expect(v.length, `${code}.${key} empty`).toBeGreaterThan(0);
            }
        }
    });
});

describe('newbieVillageStrings · nvT translation', () => {
    it('returns localized string when key exists in target locale', () => {
        expect(nvT('zh-CN', 'graduate.title')).toBe('出师啦！');
        expect(nvT('en', 'graduate.title')).toBe('Graduated!');
        expect(nvT('ja', 'graduate.title')).toBe('卒業！');
    });

    it('falls back from locale → en → zh-CN → fallback param → key', () => {
        // 教程长文在 ja 缺译 → 回退 en
        const v = nvT('ja', 'scenario.single.coach.title');
        expect(v).toBe('Lesson 1 · Single clear');
        // 完全不存在的 key + 提供 fallback → 返回 fallback
        expect(nvT('en', 'nonexistent.key', undefined, 'FALLBACK_VAL')).toBe('FALLBACK_VAL');
        // 完全不存在的 key + 无 fallback → 返回 key 字符串
        expect(nvT('en', 'totally.missing')).toBe('totally.missing');
    });

    it('interpolates {{n}} variables', () => {
        expect(nvT('zh-CN', 'ui.totalScore', { n: 1080 })).toBe('总分 1080');
        expect(nvT('en', 'ui.totalScore', { n: 1080 })).toBe('Total 1080');
        expect(nvT('zh-CN', 'banner.combo', { n: 3 })).toBe('连击 ×3');
    });

    it('unknown locale falls back to en', () => {
        expect(nvT('xx-YY', 'graduate.title')).toBe('Graduated!');
    });
});
