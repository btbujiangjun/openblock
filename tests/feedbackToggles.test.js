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

function mountButtons() {
    document.body.innerHTML = `
        <button id="visual-effects-toggle"></button>
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
        document.documentElement.classList.remove('quality-high', 'quality-balanced', 'quality-low');
    });

    it('初始化时应用持久化的视觉特效偏好', () => {
        _store.set('openblock_visualfx_v1', JSON.stringify({ enabled: false }));
        mountButtons();
        const deps = makeDeps();

        initFeedbackToggles(deps);

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenCalledWith(false);
        expect(deps.ambient.setEnabled).toHaveBeenCalledWith(false);
        expect(document.getElementById('visual-effects-toggle').textContent).toBe('✦');
    });

    it('点击视觉按钮会切换特效并持久化', () => {
        mountButtons();
        const deps = makeDeps();
        initFeedbackToggles(deps);

        document.getElementById('visual-effects-toggle').click();

        expect(deps.game.renderer.setEffectsEnabled).toHaveBeenLastCalledWith(false);
        expect(deps.ambient.setEnabled).toHaveBeenLastCalledWith(false);
        expect(JSON.parse(_store.get('openblock_visualfx_v1'))).toEqual({ enabled: false });
    });

    it('点击音效按钮只切换 audioFx 声音偏好', () => {
        mountButtons();
        const deps = makeDeps(true);
        initFeedbackToggles(deps);

        document.getElementById('sound-effects-toggle').click();

        expect(deps.audioFx.setEnabled).toHaveBeenLastCalledWith(false);
        expect(document.getElementById('sound-effects-toggle').textContent).toBe('🔇');
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
});
