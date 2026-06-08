/**
 * Visual FX Preferences —— 对齐 web `feedbackToggles.js` 的 visual-effects-toggle。
 *
 * 只控制“视觉特效/环境动效”：
 *   - 皮肤环境粒子
 *   - 水印漂移
 *   - 消行全屏闪光 / icon 喷涌
 *
 * 不控制通用 UI 入场动画；后者属于 Motion.reduced（无障碍减少动态效果）。
 */
import { Storage, STORAGE_KEYS } from './Storage';

let _enabled = true;
const _listeners: Array<(enabled: boolean) => void> = [];

/**
 * OS「减少动效」偏好（prefers-reduced-motion）。
 *
 * 严格对齐 web `feedbackToggles.loadVisualPrefs()`：装饰性视觉特效（盘面环境粒子 / 流光 /
 * 水印漂移 / 消行闪光）在系统开启「减少动效」时默认且强制关闭。
 *
 * 注意：这里**直接**读 matchMedia，不复用 `Motion.reduced`——后者在 iOS native 上被刻意跳过
 * 以保留振屏（重要操作反馈），但持续运动的装饰性粒子恰是减动效要规避的前庭刺激，应与 web 一样
 * 跟随 OS 减动效关闭。两条语义轴由此正交：Motion=振屏/UI 入场，VisualFx=盘面装饰动效。
 */
function prefersReducedMotion(): boolean {
    try {
        const mm = (globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
        return !!(mm && mm('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

export function initVisualFx(): void {
    // 对齐 web loadVisualPrefs：减动效偏好优先于持久化设置——直接强制关闭，并使 ✨ 按钮显示为「关」。
    // （web 还会对低端机 isLowEndClient 默认关，但 cocos 原生缺少可靠的内存/核数 API，此处仅落地可检测的减动效轴。）
    if (prefersReducedMotion()) { _enabled = false; return; }
    const raw = Storage.get(STORAGE_KEYS.visualFx, '');
    if (!raw) { _enabled = true; return; }
    try {
        const parsed = JSON.parse(raw) as { enabled?: boolean };
        _enabled = parsed.enabled !== false;
    } catch {
        _enabled = raw !== '0';
    }
}

export const VisualFx = {
    get enabled(): boolean { return _enabled; },
    set(enabled: boolean): void {
        const next = !!enabled;
        if (_enabled === next) return;
        _enabled = next;
        Storage.set(STORAGE_KEYS.visualFx, JSON.stringify({ enabled: next }));
        for (const fn of _listeners.slice()) { try { fn(next); } catch { /* ignore */ } }
    },
    toggle(): boolean {
        this.set(!_enabled);
        return _enabled;
    },
    onChange(fn: (enabled: boolean) => void): () => void {
        _listeners.push(fn);
        return () => {
            const i = _listeners.indexOf(fn);
            if (i >= 0) _listeners.splice(i, 1);
        };
    },
};
