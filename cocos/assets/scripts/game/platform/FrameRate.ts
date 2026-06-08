import { game } from 'cc';

/**
 * 自适应帧率（移动端散热 / 省电）。
 *
 * 背景：方块谜题大部分时间是「玩家盯着盘面思考」的静止态，但 Cocos 原生会**无条件每帧重绘整个场景**。
 * 持续 60fps 满帧渲染在 iPhone 上长时间累积发热，iOS 触达热阈值后会**突然调暗屏幕**散热
 * （用户报「玩一会儿屏幕变暗 + 发热」，而 fps 始终稳定 60、无泄漏 —— 即纯功耗/热问题）。
 *
 * 策略：
 *   - 交互 / 动画期 → ACTIVE_FPS（60，保证拖拽跟手、消行特效流畅）；
 *   - 空闲思考期   → IDLE_FPS（30，功耗近乎减半，盘面静止时肉眼无差）。
 *   任何触摸 / 消行 / 需要动画的时刻调 `poke()` 维持高帧一个窗口（覆盖消行特效 + 粒子余韵）。
 *   `tick()` 每帧调用：窗口过期即降到 IDLE_FPS。切换被 `_current` 去重，仅在 idle↔active 翻转时
 *   真正写一次 game.frameRate，无频繁抖动。
 *
 * 计时全部走 Date.now()（与拖拽看门狗一致），dt 逻辑均帧率无关 → 30/60 切换不影响手感与判定。
 */
const ACTIVE_FPS = 60;
const IDLE_FPS = 30;
/** 交互/动画后维持高帧的窗口：覆盖消行高亮(~0.5s) + 碎屑粒子余韵(combo/perfect 最长 ~2.5s) + 缓冲。 */
const ACTIVE_HOLD_MS = 3000;

let _activeUntil = 0;
let _current = 0;
let _enabled = true;

function apply(fps: number): void {
    if (_current === fps) return;
    _current = fps;
    try { (game as unknown as { frameRate: number }).frameRate = fps; } catch { /* ignore */ }
}

export const FrameRate = {
    /** 总开关（默认开）。关闭即恒定 ACTIVE_FPS。 */
    setEnabled(on: boolean): void {
        _enabled = on;
        if (!on) apply(ACTIVE_FPS);
    },

    /** 标记「此刻有交互/动画」，维持高帧 holdMs；默认覆盖消行+粒子余韵窗口。 */
    poke(holdMs = ACTIVE_HOLD_MS): void {
        if (!_enabled) { apply(ACTIVE_FPS); return; }
        const until = Date.now() + holdMs;
        if (until > _activeUntil) _activeUntil = until;
        apply(ACTIVE_FPS);
    },

    /** 每帧调用：窗口过期则降到 IDLE_FPS。 */
    tick(): void {
        if (!_enabled) return;
        apply(Date.now() < _activeUntil ? ACTIVE_FPS : IDLE_FPS);
    },
};
