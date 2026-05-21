/**
 * platformProfile.js — v1.60.45
 *
 * 单源平台判定（Web / iOS / Android / WeChat）+ 平台化配置查询助手。
 *
 * **设计目的**
 *   留存信号在 iOS 与 Android 上结构差异显著（见
 *   `docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md`）：
 *     - Android：爽感时刻 + 复活漏斗 + 高分频次是直接留存抓手（多个 |r(D7)| >= 0.15）
 *     - iOS：广告漏斗为主（仅 2 项强信号）+ 需要复合留存评分 (PRS)
 *   出块概率、复活上限、广告频控等配置需要按平台分发，本模块是所有需要按平台
 *   切分的代码的**单源入口**——避免在 monoFlush / revive / strategy 等多处
 *   重复解析 navigator.userAgent。
 *
 * **设计原则**
 *   1. **单源**：所有需按平台分发的配置都通过 pickByPlatform 读取
 *   2. **静态缓存**：一次启动判定一次，模块级 const 缓存，无运行时反复查询
 *   3. **渐进检测**：
 *      - 浏览器侧用 `navigator.userAgent` 兜底
 *      - Capacitor / 小程序壳启动时显式设 `globalThis.__OPENBLOCK_PLATFORM__`，
 *        优先级最高，避免误判（例如 iOS Capacitor 壳里 navigator.userAgent
 *        可能含 Mac OS 字符）
 *   4. **可测**：暴露 `_setPlatformForTest` 用于单元测试，生产代码勿用
 *
 * **取值**
 *   - 'ios'      — iOS WebView（Safari / Capacitor iOS）
 *   - 'android'  — Android WebView（Chrome / Capacitor Android）
 *   - 'wechat'   — 微信小程序（小程序入口注入）
 *   - 'web'      — 桌面浏览器 / 未识别（默认归类，避免任何意图分发）
 *
 * @file
 */

let _cached = null;

function _detect() {
    /* 优先读小程序 / Capacitor 壳显式注入值 */
    if (typeof globalThis !== 'undefined' && globalThis.__OPENBLOCK_PLATFORM__) {
        const v = String(globalThis.__OPENBLOCK_PLATFORM__).toLowerCase();
        if (v === 'ios' || v === 'android' || v === 'wechat' || v === 'web') return v;
    }
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 'web';
    const ua = navigator.userAgent;
    /* 微信内置浏览器优先于 Android（微信 UA 同时包含 Android 字段） */
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
}

/**
 * 获取当前平台 id。第一次调用判定后缓存，后续调用 O(1)。
 * @returns {'ios' | 'android' | 'wechat' | 'web'}
 */
export function getPlatform() {
    if (_cached === null) _cached = _detect();
    return _cached;
}

/**
 * 仅供单元测试用：强制覆写平台缓存。
 * 生产代码勿用——平台不可在运行时变更。
 * @param {string|null} p 平台 id，传 null 表示清空缓存让下次 getPlatform 重新检测
 */
export function _setPlatformForTest(p) {
    _cached = p === null ? null : String(p).toLowerCase();
}

/**
 * 平台化配置查询：传入 { ios, android, wechat, web, default } 映射表，
 * 返回当前平台对应的值；未命中返回 `default`，default 也缺省则返回 undefined。
 *
 * @example
 *   // monoFlush 命中概率：Android/小程序提至 0.05，iOS/Web 维持 0.033
 *   const monoFlushRate = pickByPlatform({
 *       ios:     0.033,
 *       android: 0.050,
 *       wechat:  0.050,
 *       default: 0.033,
 *   });
 *
 * @template T
 * @param {{ ios?: T, android?: T, wechat?: T, web?: T, default?: T }} map
 * @returns {T | undefined}
 */
export function pickByPlatform(map) {
    if (!map || typeof map !== 'object') return undefined;
    const p = getPlatform();
    if (map[p] !== undefined) return map[p];
    return map.default;
}

/**
 * v1.60.45 留存策略中"Android 类平台"分组——
 * Android 与 微信小程序享受同一档留存抓手（高频复活 / 爽感激励 / 高分频次任务等），
 * 因 wechat 小程序 OS 底层为 Android、用户画像与 Android 包高度重叠。
 *
 * 与 `getPlatform() === 'android'` 严格区分：
 *   - `getPlatform()` 用于打点 / 看板字段拆分等"严格平台标记"
 *   - `isAndroidLike()` 用于"留存策略类同等对待"
 *
 * @returns {boolean}
 */
export function isAndroidLike() {
    const p = getPlatform();
    return p === 'android' || p === 'wechat';
}
