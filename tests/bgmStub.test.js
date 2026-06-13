/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initBgm } from '../web/src/effects/bgmStub.js';

const _store = new Map();
const _mockLS = {
    getItem: (key) => _store.has(key) ? _store.get(key) : null,
    setItem: (key, value) => { _store.set(key, String(value)); },
    removeItem: (key) => { _store.delete(key); },
};

describe('bgmStub procedural ambience', () => {
    beforeEach(() => {
        _store.clear();
        Object.defineProperty(window, 'localStorage', {
            value: _mockLS,
            configurable: true,
        });
        delete window.__bgm;
    });

    it('暴露已实现的程序化皮肤氛围 API', () => {
        initBgm();

        expect(window.__bgm.isImplemented()).toBe(true);
        expect(window.__bgm.getPrefs()).toMatchObject({ enabled: true, volume: 0.12 });

        window.__bgm.setEnabled(false);
        expect(window.__bgm.getPrefs().enabled).toBe(false);

        window.__bgm.setSkin('mahjong');
        window.__bgm.setVolume(0.2);
        expect(window.__bgm.getPrefs().volume).toBe(0.2);
    });
});
