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

export function initVisualFx(): void {
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
