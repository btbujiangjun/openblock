/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initFeedbackToggles } from '../web/src/feedbackToggles.js';

const _store = new Map();
const _mockLS = {
    getItem: vi.fn((key) => _store.has(key) ? _store.get(key) : null),
    setItem: vi.fn((key, value) => { _store.set(key, String(value)); }),
    removeItem: vi.fn((key) => { _store.delete(key); }),
    clear: vi.fn(() => { _store.clear(); }),
};

vi.stubGlobal('localStorage', _mockLS);

function setNavigatorHints({ cores, mem, ua = '' } = {}) {
    Object.defineProperty(window.navigator, 'hardwareConcurrency', {
        value: cores,
        configurable: true,
    });
    Object.defineProperty(window.navigator, 'deviceMemory', {
        value: mem,
        configurable: true,
    });
    Object.defineProperty(window.navigator, 'userAgent', {
        value: ua,
        configurable: true,
    });
}

function mockMatchMedia(matches = false) {
    window.matchMedia = vi.fn((query) => ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

function mountButtons() {
    document.body.innerHTML = `
        <button id="appearance-mode-toggle"></button>
        <button id="quality-toggle"></button>
        <button id="sound-effects-toggle"></button>
    `;
}

function makeDeps(sound = true) {
    const renderer = {
        enabled: true,
        setEffectsEnabled: vi.fn(function setEffectsEnabled(enabled) { renderer.enabled = !!enabled; }),
        getEffectsEnabled: vi.fn(() => renderer.enabled),
        clearFx: vi.fn(),
        quality: 'high',
        setQualityMode: vi.fn(function setQualityMode(mode) { renderer.quality = mode; }),
        getQualityMode: vi.fn(() => renderer.quality),
    };
    return {
        game: { renderer, markDirty: vi.fn() },
        ambient: { setEnabled: vi.fn() },
        audioFx: {
            _sound: sound,
            setEnabled: vi.fn(function setEnabled(enabled) { this._sound = !!enabled; }),
            setHaptic: vi.fn(),
            getPrefs: vi.fn(function getPrefs() { return { sound: this._sound }; }),
            play: vi.fn(),
        },
    };
}

describe('feedbackToggles', () => {
    beforeEach(() => {
        _store.clear();
        _mockLS.getItem.mockClear();
        _mockLS.setItem.mockClear();
        document.body.innerHTML = '';
        document.documentElement.classList.remove('quality-high', 'quality-balanced', 'quality-low', 'ios-client', 'android-client', 'native-client');
        window.__isNativeClient = false;
        window.innerWidth = 1280;
        setNavigatorHints({ cores: 8, mem: 8, ua: 'Mozilla/5.0' });
        mockMatchMedia(false);
    });

    it('初始化时应用持久化的界面风格偏好', () => {
        _store.set('openblock_visualfx_v1', JSON.stringify({ enabled: false }));
        mountButtons();
        const deps = makeDeps();

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(false);
        expect(deps.ambient.setEnabled).toHaveBeenCalledWith(false);
        expect(document.getElementById('appearance-mode-toggle').textContent).toBe('◇');
    });

    it('点击界面风格按钮会三档循环并持久化', () => {
        _store.set('openblock_visualfx_v1', JSON.stringify({ enabled: false }));
        mountButtons();
        const deps = makeDeps();
        const toggles = initFeedbackToggles(deps);
        const btn = document.getElementById('appearance-mode-toggle');

        expect(btn.textContent).toBe('◇');
        btn.click();
        expect(btn.textContent).toBe('💎');
        expect(JSON.parse(_store.get('openblock_skin_premium_v1')).enabled).toBe(true);
        expect(JSON.parse(_store.get('openblock_visualfx_v1')).enabled).toBe(false);

        btn.click();
        expect(btn.textContent).toBe('✨');
        expect(JSON.parse(_store.get('openblock_visualfx_v1')).enabled).toBe(true);

        btn.click();
        expect(btn.textContent).toBe('◇');
        expect(JSON.parse(_store.get('openblock_skin_premium_v1')).enabled).toBe(false);
        expect(JSON.parse(_store.get('openblock_visualfx_v1')).enabled).toBe(false);
        expect(toggles.getAppearanceMode()).toBe('basic');
    });

    it('点击音效按钮只切换 audioFx 声音偏好', () => {
        mountButtons();
        const deps = makeDeps(true);
        initFeedbackToggles(deps);

        document.getElementById('sound-effects-toggle').click();

        expect(deps.audioFx.setEnabled).toHaveBeenLastCalledWith(false);
        expect(deps.audioFx.setHaptic).toHaveBeenLastCalledWith(false);
        expect(document.getElementById('sound-effects-toggle').textContent).toBe('🔇');
    });

    it('iOS 原生端首次初始化会恢复视觉特效、音效和触感默认开启', () => {
        _store.set('openblock_visualfx_v1', JSON.stringify({ enabled: false }));
        _store.set('openblock_quality_v1', JSON.stringify({ mode: 'low' }));
        document.documentElement.classList.add('ios-client', 'native-client');
        mountButtons();
        const deps = makeDeps(false);

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(true);
        expect(deps.game.renderer.setQualityMode).toHaveBeenCalledWith('high');
        expect(deps.audioFx.setEnabled).toHaveBeenCalledWith(true);
        expect(deps.audioFx.setHaptic).toHaveBeenCalledWith(true);
        expect(JSON.parse(_store.get('openblock_visualfx_v1'))).toEqual({ enabled: true });
        expect(JSON.parse(_store.get('openblock_quality_v1'))).toEqual({ mode: 'high' });
        expect(_store.get('openblock_ios_native_feedback_init_v2')).toBe('1');
    });

    it('初始化并点击画质按钮会循环档位并持久化', () => {
        _store.set('openblock_quality_v1', JSON.stringify({ mode: 'balanced' }));
        mountButtons();
        const deps = makeDeps();
        initFeedbackToggles(deps);

        expect(deps.game.renderer.setQualityMode).toHaveBeenCalledWith('balanced');
        expect(document.documentElement.classList.contains('quality-balanced')).toBe(true);
        expect(document.getElementById('quality-toggle').title).toBe('画质：均衡画质');

        document.getElementById('quality-toggle').click();

        expect(deps.game.renderer.setQualityMode).toHaveBeenLastCalledWith('low');
        expect(document.documentElement.classList.contains('quality-low')).toBe(true);
        expect(JSON.parse(_store.get('openblock_quality_v1'))).toEqual({ mode: 'low' });
    });

    it('低配 Android 默认关闭视觉特效并启用省电画质', () => {
        document.documentElement.classList.add('android-client', 'native-client');
        setNavigatorHints({ cores: 4, mem: 3, ua: 'Mozilla/5.0 Android' });
        mountButtons();
        const deps = makeDeps();

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(false);
        expect(deps.ambient.setEnabled).toHaveBeenCalledWith(false);
        expect(deps.game.renderer.setQualityMode).toHaveBeenCalledWith('low');
        expect(document.documentElement.classList.contains('quality-low')).toBe(true);
    });

    it('普通触屏设备无偏好时默认使用均衡画质', () => {
        window.__isNativeClient = true;
        document.documentElement.classList.add('native-client');
        setNavigatorHints({ cores: 8, mem: 8, ua: 'Mozilla/5.0 Mobile' });
        mountButtons();
        const deps = makeDeps();

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(true);
        expect(deps.game.renderer.setQualityMode).toHaveBeenCalledWith('balanced');
        expect(document.documentElement.classList.contains('quality-balanced')).toBe(true);
    });

    it('系统减少动态偏好默认关闭视觉特效并启用省电画质', () => {
        mockMatchMedia(true);
        mountButtons();
        const deps = makeDeps();

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(false);
        expect(deps.ambient.setEnabled).toHaveBeenCalledWith(false);
        expect(deps.game.renderer.setQualityMode).toHaveBeenCalledWith('low');
    });
});
