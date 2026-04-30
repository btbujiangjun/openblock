/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    initI18n,
    setLocale,
    getLocale,
    t,
    tSkinName,
    applyDom,
    applyMeta,
    AVAILABLE_LOCALES,
} from '../web/src/i18n/i18n.js';

beforeEach(() => {
    try {
        localStorage.removeItem('openblock_locale_v1');
    } catch {
        /* ignore */
    }
});

describe('i18n', () => {
    it('initI18n defaults to zh-CN', () => {
        initI18n();
        expect(getLocale()).toBe('zh-CN');
        expect(t('menu.start')).toBe('开始游戏');
    });

    it('setLocale switches strings', () => {
        initI18n();
        setLocale('en');
        expect(getLocale()).toBe('en');
        expect(t('menu.start')).toBe('Play');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('Arabic uses rtl', () => {
        initI18n();
        setLocale('ar');
        expect(getLocale()).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toBe('ar');
        setLocale('de');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('AVAILABLE_LOCALES covers extended packs', () => {
        const codes = AVAILABLE_LOCALES.map((x) => x.code);
        expect(codes.length).toBeGreaterThanOrEqual(19);
        expect(codes).toEqual(
            expect.arrayContaining([
                'it', 'pt-BR', 'ru', 'uk', 'pl', 'tr', 'vi', 'th', 'id', 'nl',
            ]),
        );
    });

    it('pt-BR sets BCP47 lang', () => {
        initI18n();
        setLocale('pt-BR');
        expect(document.documentElement.lang).toBe('pt-BR');
        expect(t('menu.start')).toBe('Jogar');
    });

    it('t interpolates {{vars}}', () => {
        initI18n();
        setLocale('en');
        expect(t('progress.streakDays', { n: 3 })).toBe('3 days streak');
    });

    it('tSkinName uses locale then skin.name', () => {
        initI18n();
        setLocale('en');
        expect(tSkinName({ id: 'titanium', name: '💎 钛晶矩阵' })).toBe('💎 Titanium Matrix');
        expect(tSkinName({ id: 'unknownSkinId', name: 'Fallback' })).toBe('Fallback');
    });

    it('applyDom updates data-i18n nodes', () => {
        document.body.innerHTML =
            '<span id="x" data-i18n="game.retry"></span>';
        initI18n();
        setLocale('fr');
        applyDom(document.body);
        expect(document.getElementById('x').textContent).toBe('Rejouer');
    });

    it('applyMeta sets title and description', () => {
        document.head.innerHTML =
            '<title></title><meta name="description" content="" />';
        initI18n();
        setLocale('en');
        applyMeta();
        expect(document.title).toBe('Open Block');
        expect(
            document.querySelector('meta[name="description"]').getAttribute('content'),
        ).toContain('spatial');
    });
});
