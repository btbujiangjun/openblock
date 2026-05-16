/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __test_only__ as syncInternals } from '../web/src/localStorageStateSync.js';

function createStorageMock() {
    const store = Object.create(null);
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
    };
}

describe('localStorageStateSync section mapping', () => {
    beforeEach(() => {
        const ls = createStorageMock();
        vi.stubGlobal('localStorage', ls);
        ls.clear();
    });

    it('核心进度键归入 core', () => {
        expect(syncInternals._sectionForKey('openblock_progression_v1')).toBe('core');
        expect(syncInternals._sectionForKey('openblock_checkin_v1')).toBe('core');
    });

    it('商业化键归入 monetization', () => {
        expect(syncInternals._sectionForKey('openblock_mon_purchases_v1')).toBe('monetization');
        expect(syncInternals._sectionForKey('offer_flash_sale_valid_until')).toBe('monetization');
    });

    it('社交键归入 social', () => {
        expect(syncInternals._sectionForKey('openblock_friends_v1')).toBe('social');
        expect(syncInternals._sectionForKey('openblock_replay_album_v1')).toBe('social');
    });

    it('偏好键归入 preferences', () => {
        expect(syncInternals._sectionForKey('openblock_audiofx_v1')).toBe('preferences');
        expect(syncInternals._sectionForKey('openblock_locale_v1')).toBe('preferences');
    });

    it('实验键归入 experiment', () => {
        expect(syncInternals._sectionForKey('openblock_ab_overrides')).toBe('experiment');
        expect(syncInternals._sectionForKey('openblock_remote_config_v1')).toBe('experiment');
    });
});

describe('localStorageStateSync merge behavior', () => {
    beforeEach(() => {
        const ls = createStorageMock();
        vi.stubGlobal('localStorage', ls);
        ls.clear();
    });

    it('远端仅补齐本地缺项，不覆盖本地已有值', () => {
        localStorage.setItem('openblock_progression_v1', '{"totalGames":10}');
        const changed = syncInternals._mergeRemoteIntoLocal({
            core: {
                state: {
                    openblock_progression_v1: '{"totalGames":1}',
                    openblock_rank_v1: '{"rank":"S"}',
                },
                updatedAt: Date.now(),
            },
        });
        expect(changed).toBe(true);
        expect(localStorage.getItem('openblock_progression_v1')).toBe('{"totalGames":10}');
        expect(localStorage.getItem('openblock_rank_v1')).toBe('{"rank":"S"}');
    });
});

