/**
 * @vitest-environment jsdom
 *
 * v1.60.45 — platformProfile 单源平台判定与 pickByPlatform 助手测试。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getPlatform,
    pickByPlatform,
    isAndroidLike,
    _setPlatformForTest,
} from '../web/src/config/platformProfile.js';

describe('platformProfile', () => {
    let originalUA;
    let originalOverride;

    beforeEach(() => {
        _setPlatformForTest(null);
        originalUA = navigator?.userAgent;
        originalOverride = globalThis.__OPENBLOCK_PLATFORM__;
        delete globalThis.__OPENBLOCK_PLATFORM__;
    });

    afterEach(() => {
        _setPlatformForTest(null);
        try {
            Object.defineProperty(navigator, 'userAgent', {
                value: originalUA,
                configurable: true,
            });
        } catch { /* ignore */ }
        if (originalOverride === undefined) {
            delete globalThis.__OPENBLOCK_PLATFORM__;
        } else {
            globalThis.__OPENBLOCK_PLATFORM__ = originalOverride;
        }
    });

    /* ---------- UA 启发式 ---------- */

    it('UA = iPhone → ios', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            configurable: true,
        });
        expect(getPlatform()).toBe('ios');
    });

    it('UA = iPad → ios', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            configurable: true,
        });
        expect(getPlatform()).toBe('ios');
    });

    it('UA = Android → android', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 13; SM-G998U) AppleWebKit/537.36',
            configurable: true,
        });
        expect(getPlatform()).toBe('android');
    });

    it('UA 含 MicroMessenger → wechat（优先于 Android，因为微信 UA 同时含 Android）', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 13; SM-G998U) AppleWebKit/537.36 MicroMessenger/8.0.40 NetType/WIFI',
            configurable: true,
        });
        expect(getPlatform()).toBe('wechat');
    });

    it('UA = 桌面浏览器 → web', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
            configurable: true,
        });
        expect(getPlatform()).toBe('web');
    });

    /* ---------- 显式注入（小程序壳 / Capacitor） ---------- */

    it('__OPENBLOCK_PLATFORM__ = wechat 优先于 UA', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone) AppleWebKit',
            configurable: true,
        });
        globalThis.__OPENBLOCK_PLATFORM__ = 'wechat';
        _setPlatformForTest(null);
        expect(getPlatform()).toBe('wechat');
    });

    it('__OPENBLOCK_PLATFORM__ = android 优先于 iOS UA（Capacitor Android 壳场景）', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone) AppleWebKit',
            configurable: true,
        });
        globalThis.__OPENBLOCK_PLATFORM__ = 'android';
        _setPlatformForTest(null);
        expect(getPlatform()).toBe('android');
    });

    it('__OPENBLOCK_PLATFORM__ 无效值 → 退化到 UA', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit',
            configurable: true,
        });
        globalThis.__OPENBLOCK_PLATFORM__ = 'invalid_value';
        _setPlatformForTest(null);
        expect(getPlatform()).toBe('android');
    });

    /* ---------- 缓存 ---------- */

    it('getPlatform 缓存：判定一次，后续返回同值', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone) AppleWebKit',
            configurable: true,
        });
        const a = getPlatform();
        /* 改 UA 但不清缓存 → 仍返回首次结果 */
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit',
            configurable: true,
        });
        expect(getPlatform()).toBe(a);
    });

    /* ---------- pickByPlatform ---------- */

    it('pickByPlatform 命中对应平台值', () => {
        _setPlatformForTest('android');
        expect(pickByPlatform({ ios: 'a', android: 'b', wechat: 'c', default: 'd' })).toBe('b');
    });

    it('pickByPlatform 未命中 → default', () => {
        _setPlatformForTest('web');
        expect(pickByPlatform({ ios: 'a', android: 'b', default: 'd' })).toBe('d');
    });

    it('pickByPlatform 缺 default → undefined', () => {
        _setPlatformForTest('web');
        expect(pickByPlatform({ ios: 'a', android: 'b' })).toBeUndefined();
    });

    it('pickByPlatform 入参非对象 → undefined', () => {
        expect(pickByPlatform(null)).toBeUndefined();
        expect(pickByPlatform(undefined)).toBeUndefined();
        expect(pickByPlatform('string')).toBeUndefined();
    });

    /* ---------- isAndroidLike ---------- */

    it('isAndroidLike: android / wechat → true；ios / web → false', () => {
        _setPlatformForTest('android');
        expect(isAndroidLike()).toBe(true);
        _setPlatformForTest('wechat');
        expect(isAndroidLike()).toBe(true);
        _setPlatformForTest('ios');
        expect(isAndroidLike()).toBe(false);
        _setPlatformForTest('web');
        expect(isAndroidLike()).toBe(false);
    });
});
