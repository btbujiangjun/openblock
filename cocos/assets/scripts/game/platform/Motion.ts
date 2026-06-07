/**
 * Motion Preferences —— 减少动效（无障碍 + 设备节流）。
 *
 * 任何"装饰性"动画（模态 fade/scale、技能 shake、连击炫耀、粒子 ambience 强度等）
 * 都应在执行前查询 `Motion.reduced`，开启时跳过/缩短，避免：
 *   - 前庭敏感 / 晕动玩家不适
 *   - 低端机 / 省电模式下叠加帧率压力
 *
 * 玩家偏好持久化到 Storage（reduceMotion=true/false）；运行期 `onChange` 让 UI 即时响应。
 *
 * 默认 false：保留完整动效；玩家从顶栏切换或操作系统检测到 prefers-reduced-motion 时打开。
 */
import { sys } from 'cc';
import { Storage, STORAGE_KEYS } from './Storage';

let _reduced = false;
const _listeners: Array<(reduced: boolean) => void> = [];

/** 从 Storage / 系统偏好读初始值；Bootstrap 启动一次即可。 */
export function initMotion(): void {
    const persisted = Storage.get(STORAGE_KEYS.reduceMotion, '');
    if (persisted === '1') { _reduced = true; console.log('[OpenBlock] Motion.reduced = true (user persisted)'); return; }
    if (persisted === '0') { _reduced = false; return; }
    // 无玩家明示 → 默认 false，但在浏览器/WKWebView 下读 matchMedia 听 OS 偏好。
    // ⭐ iOS native (sys.isNative + sys.os === iOS) 必须 SKIP matchMedia：
    //    1. iOS 系统级"减少动效"在很多用户上默认开启（辅助功能引导推荐），
    //       且 Cocos JSB 把 matchMedia polyfill 成读 UIAccessibility prefersReducedMotion，
    //       结果是大量 iOS 用户被静默禁用所有屏幕抖动 → 业务感受是"iOS 振屏没生效"。
    //    2. 我们的振屏振幅已经很温和（≤18px / ≤0.4s）且只在重要事件（perfect / multi-line）触发，
    //       即便用户开了 OS reduce motion，游戏内振屏也应保留以传达「这次操作很关键」的反馈。
    //    3. 若极端晕动用户需要禁用，会在游戏内 HUD 显式有「减少动效」按钮（toggleMotion）调用 set(true)。
    if (sys.isNative && (sys.os === sys.OS.IOS || sys.os === sys.OS.OSX)) {
        _reduced = false;
        return;
    }
    try {
        const mm = (globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
        if (mm) {
            _reduced = !!mm('(prefers-reduced-motion: reduce)').matches;
            if (_reduced) console.log('[OpenBlock] Motion.reduced = true (matchMedia prefers-reduced-motion)');
        }
    } catch { /* ignore */ }
}

export const Motion = {
    get reduced(): boolean { return _reduced; },
    set(reduced: boolean): void {
        if (_reduced === reduced) return;
        _reduced = reduced;
        Storage.set(STORAGE_KEYS.reduceMotion, reduced ? '1' : '0');
        for (const fn of _listeners.slice()) { try { fn(reduced); } catch { /* ignore */ } }
    },
    toggle(): boolean { this.set(!_reduced); return _reduced; },
    onChange(fn: (reduced: boolean) => void): () => void {
        _listeners.push(fn);
        return () => {
            const i = _listeners.indexOf(fn);
            if (i >= 0) _listeners.splice(i, 1);
        };
    },
};
