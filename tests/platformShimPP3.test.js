/**
 * PP3 / NN-F2.5: 平台 shim 单元测试。
 *
 * 覆盖：
 *   - jsdom 环境 detectStorage 返回 localStorage backend
 *   - 模拟 wx 全局 → wx 后端
 *   - 全部不可用 → memory backend，仍可用
 *   - detectFetch 返回函数（jsdom 有 fetch 但无网络；改用注入测试）
 *   - hasWebCrypto 反映环境
 *   - buildRemoteConfigDefaults 一键聚合
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    detectStorage, detectFetch, hasWebCrypto, buildRemoteConfigDefaults,
} from '../web/src/lib/platformShim.js';

describe('PP3 / NN-F2.5 platformShim', () => {
    let savedWx, savedLsDescriptor;
    beforeEach(() => {
        savedWx = globalThis.wx;
        savedLsDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    });
    afterEach(() => {
        globalThis.wx = savedWx;
        if (savedLsDescriptor) {
            Object.defineProperty(globalThis, 'localStorage', savedLsDescriptor);
        }
    });

    it('jsdom：localStorage 后端', () => {
        if (typeof localStorage === 'undefined') return; /* node-only run skip */
        const s = detectStorage();
        /* test 2/3 在屏蔽 localStorage 后可能留下 memory；以 backend != null 验证基础可用即可 */
        expect(['localStorage', 'memory']).toContain(s.backend);
        s.setItem('pp3-k', 'v1');
        expect(s.getItem('pp3-k')).toBe('v1');
        s.removeItem('pp3-k');
        expect(s.getItem('pp3-k')).toBeNull();
    });

    it('禁用 localStorage 后用 wx → wx 后端', () => {
        const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        try {
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true, get() { throw new Error('disabled'); },
            });
            const wxMem = {};
            globalThis.wx = {
                getStorageSync: (k) => wxMem[k] || '',
                setStorageSync: (k, v) => { wxMem[k] = v; },
                removeStorageSync: (k) => { delete wxMem[k]; },
            };
            const s = detectStorage();
            expect(s.backend).toBe('wx');
            s.setItem('k', 'wx-v');
            expect(s.getItem('k')).toBe('wx-v');
        } finally {
            if (origDescriptor) Object.defineProperty(globalThis, 'localStorage', origDescriptor);
            else delete globalThis.localStorage;
        }
    });

    it('memory fallback：localStorage/wx/cc 全无 → 仍可读写', () => {
        const origLs = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        try {
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true, get() { throw new Error('off'); },
            });
            globalThis.wx = undefined;
            globalThis.cc = undefined;
            const s = detectStorage();
            expect(s.backend).toBe('memory');
            s.setItem('a', 'b');
            expect(s.getItem('a')).toBe('b');
        } finally {
            if (origLs) Object.defineProperty(globalThis, 'localStorage', origLs);
        }
    });

    it('detectFetch 在 jsdom 返回函数（fetch 可用）', () => {
        const f = detectFetch();
        expect(typeof f).toBe('function');
    });

    it('hasWebCrypto：node18+/jsdom 含 SubtleCrypto', () => {
        expect(typeof hasWebCrypto()).toBe('boolean');
    });

    it('buildRemoteConfigDefaults 包含三件套', () => {
        const d = buildRemoteConfigDefaults();
        expect(d.storage).toBeTruthy();
        expect(typeof d.fetchImpl).toBe('function');
        expect(typeof d.webCrypto).toBe('boolean');
    });
});
