/**
 * platformProfile.js — v1.60.45 miniprogram 镜像
 *
 * 与 web/src/config/platformProfile.js 行为一致；小程序壳在 app.js onLaunch 中
 * 通过 globalThis.__OPENBLOCK_PLATFORM__='wechat' 显式注入，本模块直接读取即可。
 *
 * 详细注释见 web 版（web/src/config/platformProfile.js）。
 */

let _cached = null;

function _detect() {
    if (typeof globalThis !== 'undefined' && globalThis.__OPENBLOCK_PLATFORM__) {
        const v = String(globalThis.__OPENBLOCK_PLATFORM__).toLowerCase();
        if (v === 'ios' || v === 'android' || v === 'wechat' || v === 'web') return v;
    }
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 'web';
    const ua = navigator.userAgent;
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
}

function getPlatform() {
    if (_cached === null) _cached = _detect();
    return _cached;
}

function _setPlatformForTest(p) {
    _cached = p === null ? null : String(p).toLowerCase();
}

function pickByPlatform(map) {
    if (!map || typeof map !== 'object') return undefined;
    const p = getPlatform();
    if (map[p] !== undefined) return map[p];
    return map.default;
}

function isAndroidLike() {
    const p = getPlatform();
    return p === 'android' || p === 'wechat';
}

module.exports = { getPlatform, _setPlatformForTest, pickByPlatform, isAndroidLike };
