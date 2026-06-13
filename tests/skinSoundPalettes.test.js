/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SKINS, setActiveSkinId, setSkinTransitionHook } from '../web/src/skins.js';
import { initSkinSoundPalettes, __test_only__ } from '../web/src/effects/skinSoundPalettes.js';

const _store = new Map();
const _mockLS = {
    getItem: vi.fn((key) => _store.has(key) ? _store.get(key) : null),
    setItem: vi.fn((key, value) => { _store.set(key, String(value)); }),
    removeItem: vi.fn((key) => { _store.delete(key); }),
};

function makeAudioFx() {
    return {
        _tone: vi.fn(),
        _noiseBurst: vi.fn(),
        _tonePlace: vi.fn(),
        _toneClear: vi.fn(),
        _toneMulti: vi.fn(),
        _toneCombo: vi.fn(),
        _tonePerfect: vi.fn(),
        _toneBonus: vi.fn(),
        _toneUnlock: vi.fn(),
        _toneTick: vi.fn(),
    };
}

describe('skinSoundPalettes', () => {
    beforeEach(() => {
        _store.clear();
        Object.defineProperty(window, 'localStorage', {
            value: _mockLS,
            configurable: true,
        });
        setSkinTransitionHook(null);
    });

    it('为每个当前皮肤提供声音主题配置', () => {
        for (const id of Object.keys(SKINS)) {
            expect(__test_only__.SKIN_SOUND_THEMES[id], id).toBeTruthy();
        }
    });

    it('按皮肤和主题生成外部音频候选路径', () => {
        const theme = __test_only__._resolveTheme('mahjong');

        expect(__test_only__._externalAssetUrl(theme, 'clear')).toEqual([
            '/audio/skins/mahjong/clear.ogg',
            '/audio/skins/mahjong/clear.mp3',
            '/audio/skins/mahjong/clear.wav',
            '/audio/skins/mahjong/clear.m4a',
            '/audio/skins/_themes/mahjong/clear.ogg',
            '/audio/skins/_themes/mahjong/clear.mp3',
            '/audio/skins/_themes/mahjong/clear.wav',
            '/audio/skins/_themes/mahjong/clear.m4a',
        ]);
    });

    it('初始化时按当前皮肤安装主题音色', () => {
        window.localStorage.setItem('openblock_skin', 'ocean');
        const audioFx = makeAudioFx();

        initSkinSoundPalettes({ audioFx });

        expect(audioFx.getSkinSoundTheme()).toMatchObject({ skinId: 'ocean', material: 'water', motif: 'bubble' });
        audioFx._tonePlace(1);
        expect(audioFx._tone).toHaveBeenCalled();
    });

    it('切换皮肤后同步替换后续声效主题', () => {
        const audioFx = makeAudioFx();
        initSkinSoundPalettes({ audioFx });

        expect(audioFx.getSkinSoundTheme()).toMatchObject({ skinId: 'titanium' });
        expect(setActiveSkinId('music')).toBe(true);

        expect(audioFx.getSkinSoundTheme()).toMatchObject({ skinId: 'music', material: 'piano' });
        audioFx._toneUnlock(2);
        expect(audioFx._tone).toHaveBeenCalled();
    });

    it('主题动机音会叠加到消行反馈', () => {
        window.localStorage.setItem('openblock_skin', 'mahjong');
        const audioFx = makeAudioFx();

        initSkinSoundPalettes({ audioFx });
        audioFx._toneClear(3);

        expect(audioFx.getSkinSoundTheme()).toMatchObject({ skinId: 'mahjong', motif: 'mahjong' });
        expect(audioFx._noiseBurst).toHaveBeenCalled();
        expect(audioFx._tone).toHaveBeenCalled();
    });
});
