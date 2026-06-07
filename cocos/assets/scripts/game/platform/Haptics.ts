import { sys } from 'cc';

/**
 * 震动反馈适配（Phase 2/4）。
 *
 * 优先级：
 *  1) Cocos Native 内置 JSB 震动（`native.Device.vibrate` / `jsb.Device.vibrate`）
 *  2) 原生 iOS/Android Taptic 桥（`__openblockNative.postMessage('haptic', { style })` 或简化 `__openblockHaptic('light')`）
 *     —— 对齐 mobile/ios 通过 @capacitor/haptics → UIImpactFeedbackGenerator 的真机体验
 *  3) 微信小游戏 wx.vibrateShort/Long
 *  4) navigator.vibrate（普通浏览器、安卓 WebView）
 *  5) 无能力时打印一次诊断后静默
 *
 * `enabled` 全局开关（玩家可在顶栏按钮里 toggle）；持久化由 GameController.toggleHaptics 负责。
 */
type WxLike = { vibrateShort?: (opts: { type?: 'heavy' | 'medium' | 'light' }) => void; vibrateLong?: () => void };
type NativeHapticBridge = (style: 'light' | 'medium' | 'heavy') => void;
type HapticStyle = 'light' | 'medium' | 'heavy';

let _warnedNoBackend = false;

function getWx(): WxLike | null {
    const g = globalThis as unknown as { wx?: WxLike };
    return g.wx ?? null;
}

function getNativeHaptic(): NativeHapticBridge | null {
    const g = globalThis as unknown as {
        __openblockHaptic?: NativeHapticBridge;
        __openblockNative?: { postMessage?: (json: string) => void };
    };
    if (typeof g.__openblockHaptic === 'function') return g.__openblockHaptic;
    const native = g.__openblockNative;
    if (native && typeof native.postMessage === 'function') {
        return (style) => {
            try { native.postMessage!(JSON.stringify({ action: 'haptic', args: { style } })); } catch { /* ignore */ }
        };
    }
    return null;
}

function styleToMs(style: HapticStyle): number {
    return style === 'heavy' ? 60 : style === 'medium' ? 30 : 15;
}

function styleToSec(style: HapticStyle): number {
    // Cocos Native 历史 API `Device.vibrate` 常用秒作为单位；保持极短触感，避免长振。
    return style === 'heavy' ? 0.06 : style === 'medium' ? 0.035 : 0.018;
}

/**
 * Cocos Creator 原生环境优先走 JSB 内置震动。
 *
 * 不同 Creator / 原生模板版本暴露名不完全一致：
 *   - 3.x 常见：`native.Device.vibrate(seconds)`
 *   - 旧 JSB：`jsb.Device.vibrate(seconds)`
 *   - 个别模板：`native.device` / `jsb.device`
 *
 * 这里做宽松探测，任一成功即返回 true。若当前原生壳没有暴露任何 Device.vibrate，
 * 再交给外部桥 / wx / navigator 处理。
 */
function vibrateCocosNative(style: HapticStyle): boolean {
    if (!sys.isNative) return false;
    const g = globalThis as unknown as {
        native?: { Device?: { vibrate?: (seconds: number) => void }; device?: { vibrate?: (seconds: number) => void } };
        jsb?: { Device?: { vibrate?: (seconds: number) => void }; device?: { vibrate?: (seconds: number) => void } };
    };
    const fn = g.native?.Device?.vibrate
        || g.native?.device?.vibrate
        || g.jsb?.Device?.vibrate
        || g.jsb?.device?.vibrate;
    if (typeof fn !== 'function') return false;
    try {
        fn(styleToSec(style));
        return true;
    } catch {
        return false;
    }
}

function warnNoBackendOnce(): void {
    if (_warnedNoBackend) return;
    _warnedNoBackend = true;
    console.warn('[OpenBlock] Haptics backend not available: no Cocos Device.vibrate / native bridge / wx / navigator.vibrate');
}

export const Haptics = {
    enabled: true,

    light(): void {
        if (!this.enabled) return;
        if (vibrateCocosNative('light')) return;
        const native = getNativeHaptic();
        if (native) { native('light'); return; }
        const wx = getWx();
        if (wx?.vibrateShort) {
            wx.vibrateShort({ type: 'light' });
            return;
        }
        this.web(15);
    },

    medium(): void {
        if (!this.enabled) return;
        if (vibrateCocosNative('medium')) return;
        const native = getNativeHaptic();
        if (native) { native('medium'); return; }
        const wx = getWx();
        if (wx?.vibrateShort) {
            wx.vibrateShort({ type: 'medium' });
            return;
        }
        this.web(30);
    },

    heavy(): void {
        if (!this.enabled) return;
        if (vibrateCocosNative('heavy')) return;
        const native = getNativeHaptic();
        if (native) { native('heavy'); return; }
        const wx = getWx();
        if (wx?.vibrateLong) {
            wx.vibrateLong();
            return;
        }
        this.web(60);
    },

    web(ms: number): void {
        try {
            const nav = globalThis as unknown as { navigator?: { vibrate?: (p: number) => void } };
            if (typeof nav.navigator?.vibrate === 'function') {
                nav.navigator.vibrate(ms);
                return;
            }
        } catch {
            /* ignore */
        }
        warnNoBackendOnce();
    },
};
