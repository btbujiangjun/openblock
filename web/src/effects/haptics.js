/**
 * haptics.js — 跨平台触觉反馈适配层
 *
 * 策略：
 *   1. Capacitor 原生应用（iOS / Android）→ @capacitor/haptics（原生精确振动）
 *   2. Android 浏览器 / Capacitor Android → navigator.vibrate（Web Vibration API）
 *   3. iOS 浏览器 → 无操作（Safari 不支持 Web Vibration API，Haptics 只在 Capacitor 里可用）
 *
 * 使用：
 *   import { vibrate, impactLight, impactMedium } from './haptics.js';
 *   vibrate([10, 30, 10]);     // 模式振动
 *   impactLight();             // Capacitor 轻触
 *   impactMedium();            // Capacitor 中等触
 *   impactHeavy();             // Capacitor 强触
 *
 * Capacitor 可用性检测：
 *   如果 window.Capacitor && window.Capacitor.isNativePlatform() 返回 true，
 *   说明运行在原生 App 内，@capacitor/haptics 的原生实现可用。
 *   纯 Web 浏览器下 @capacitor/haptics 是空实现，自动降级。
 */

let _hapticsModule = null;
let _loadAttempted = false;

/**
 * 懒加载 @capacitor/haptics，失败时静默降级。
 * 避免非 Capacitor 环境（纯 Web 开发模式）引入不必要的报错。
 */
async function _getHaptics() {
    if (_loadAttempted) return _hapticsModule;
    _loadAttempted = true;
    try {
        const mod = await import('@capacitor/haptics');
        _hapticsModule = mod;
    } catch {
        _hapticsModule = null;
    }
    return _hapticsModule;
}

/** 是否运行在 Capacitor 原生容器内 */
function _isNative() {
    return (
        typeof window !== 'undefined'
        && window.Capacitor
        && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform()
    );
}

/** 是否运行在 iOS（Capacitor 或浏览器） */
function _isIOS() {
    if (typeof window !== 'undefined' && window.Capacitor?.getPlatform) {
        return window.Capacitor.getPlatform() === 'ios';
    }
    return /iPad|iPhone|iPod/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
}

/**
 * 模式振动：优先 Capacitor Haptics，降级 navigator.vibrate。
 *
 * @param {number | number[]} pattern  毫秒，或 [vibrate, pause, vibrate ...] 数组
 */
export function vibrate(pattern) {
    if (_isNative()) {
        _vibrateNative(pattern);
        return;
    }
    /* Android 浏览器 / Capacitor Android WebView（无原生容器时） */
    if (!_isIOS() && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(pattern); } catch { /* ignore */ }
    }
    /* iOS 浏览器：无操作 */
}

/** 原生 Capacitor 振动（带 ImpactStyle 最优映射） */
async function _vibrateNative(pattern) {
    const mod = await _getHaptics();
    if (!mod) return;
    const { Haptics, ImpactStyle } = mod;
    try {
        /* 单次短振动 → Impact；多步模式 → vibrate（Android only native）或多次 Impact */
        const arr = Array.isArray(pattern) ? pattern : [pattern];
        const firstMs = arr[0] ?? 10;
        if (arr.length <= 1 || arr.every((v, i) => i % 2 === 0 && v <= 30)) {
            /* 短振动：用 Impact（iOS 有精确触觉马达反馈） */
            const style = firstMs >= 40 ? ImpactStyle.Heavy
                : firstMs >= 20 ? ImpactStyle.Medium
                : ImpactStyle.Light;
            await Haptics.impact({ style });
        } else {
            /* 复合模式：逐段模拟（iOS 原生不支持任意 pattern，用多次 impact 近似） */
            for (let i = 0; i < arr.length; i++) {
                if (i % 2 === 0 && arr[i] > 0) {
                    const style = arr[i] >= 40 ? ImpactStyle.Medium : ImpactStyle.Light;
                    await Haptics.impact({ style });
                }
                if (arr[i] > 0) {
                    await _sleep(arr[i]);
                }
            }
        }
    } catch { /* ignore */ }
}

/** 轻触：菜单点击、方块放置 */
export async function impactLight() {
    const mod = await _getHaptics();
    if (!mod) { vibrate(8); return; }
    try { await mod.Haptics.impact({ style: mod.ImpactStyle.Light }); } catch { /* ignore */ }
}

/** 中等触：消行 */
export async function impactMedium() {
    const mod = await _getHaptics();
    if (!mod) { vibrate(22); return; }
    try { await mod.Haptics.impact({ style: mod.ImpactStyle.Medium }); } catch { /* ignore */ }
}

/** 重触：完美清屏 / combo */
export async function impactHeavy() {
    const mod = await _getHaptics();
    if (!mod) { vibrate(40); return; }
    try { await mod.Haptics.impact({ style: mod.ImpactStyle.Heavy }); } catch { /* ignore */ }
}

/** 通知成功振动（解锁 / 奖励） */
export async function notificationSuccess() {
    const mod = await _getHaptics();
    if (!mod) { vibrate([10, 20, 10]); return; }
    try { await mod.Haptics.notification({ type: mod.NotificationType.Success }); } catch { /* ignore */ }
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
