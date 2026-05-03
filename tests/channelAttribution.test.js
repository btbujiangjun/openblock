/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLocalStorageMock() {
    const store = Object.create(null);
    return {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => {
            store[k] = String(v);
        },
        removeItem: k => {
            delete store[k];
        },
        clear: () => {
            Object.keys(store).forEach(k => delete store[k]);
        },
        get length() {
            return Object.keys(store).length;
        },
        key: i => Object.keys(store)[i] ?? null,
    };
}

const _mockLS = makeLocalStorageMock();
vi.stubGlobal('localStorage', _mockLS);

import {
    initChannelAttribution,
    getSessionAttributionSnapshot,
} from '../web/src/channelAttribution.js';

describe('channelAttribution', () => {
    beforeEach(() => {
        _mockLS.clear();
        window.history.replaceState({}, '', '/');
    });

    it('getSessionAttributionSnapshot is empty without campaign params', () => {
        expect(getSessionAttributionSnapshot()).toEqual({});
    });

    it('gclid yields google_gclid source in snapshot', () => {
        window.history.replaceState({}, '', '/?gclid=abc123');
        initChannelAttribution();
        const snap = getSessionAttributionSnapshot();
        expect(snap.utm_source).toBe('google_gclid');
        expect(snap.gclid).toBe('abc123');
    });

    it('utm_campaign appears in snapshot', () => {
        window.history.replaceState({}, '', '/?utm_source=newsletter&utm_campaign=spring');
        initChannelAttribution();
        const snap = getSessionAttributionSnapshot();
        expect(snap.utm_source).toBe('newsletter');
        expect(snap.utm_campaign).toBe('spring');
    });
});
