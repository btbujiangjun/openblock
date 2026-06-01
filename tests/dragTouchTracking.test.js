/**
 * @vitest-environment jsdom
 *
 * 触摸拖拽手感回归（v1.61.15）：所有触摸输入（安卓 / iOS / 任意触屏）一律 1:1 直接跟手，
 * 不套用鼠标的指针加速（pointer ballistics）。锁定三条契约：
 *   1) 默认 track=1.0 → 幽灵块位移严格等于手指位移（不放大、不敏感）；
 *   2) 不依赖平台探测：即便 _isAndroidClient()=false（iOS / 普通触屏）也走 1:1；
 *   3) 无逐帧速度增益累加 → 幂等且不漂移（回到起手点落点即回原位）。
 *
 * 背景：此前触摸误用速度感知增益（1.05→1.7 + 累计 6 格偏移），在安卓/鸿蒙高 DPR WebView
 * 上表现为「拖拽过于敏感 / 乱飘 / 几乎无法操作」。
 */
import { describe, it, expect } from 'vitest';
import { Game } from '../web/src/game.js';
import { CONFIG } from '../web/src/config.js';

/** 构造可直接 .call() _applyDragPointerGain 的最小 this（不实例化完整 Game）。 */
function touchDragStub(startX, startY, { isAndroid = false } = {}) {
    return {
        drag: {
            inputType: 'touch',
            startX,
            startY,
            _extraOffset: { x: 0, y: 0 },
        },
        _touchDragLiftPx: () => 0,         // 抬升只影响 y 的恒定偏移，置 0 便于断言
        _isAndroidClient: () => isAndroid, // 验证手感不再依赖平台探测
    };
}

describe('_applyDragPointerGain — 触摸 1:1 直接跟手', () => {
    it('默认 DRAG_TOUCH_TRACK_GAIN 为 1.0（标准休闲游戏响应速度）', () => {
        expect(CONFIG.DRAG_TOUCH_TRACK_GAIN).toBe(1.0);
    });

    it('幽灵块位移严格等于手指位移（无放大）', () => {
        const g = touchDragStub(100, 200, { isAndroid: true });
        const p = Game.prototype._applyDragPointerGain.call(g, 160, 260); // 手指 +60/+60
        expect(p.x).toBeCloseTo(160, 5); // 100 + 60×1.0
        expect(p.y).toBeCloseTo(260, 5); // 200 + 60×1.0 − lift(0)
    });

    it('非安卓触屏（iOS 等）同样 1:1，不再依赖平台探测', () => {
        const g = touchDragStub(0, 0, { isAndroid: false });
        const p = Game.prototype._applyDragPointerGain.call(g, 50, 0);
        expect(p.x).toBeCloseTo(50, 5);
    });

    it('幂等且不漂移：重复同点结果一致，回到起手点落点归零（无逐帧累加）', () => {
        const g = touchDragStub(0, 0, { isAndroid: true });
        const a = Game.prototype._applyDragPointerGain.call(g, 300, 0);
        const b = Game.prototype._applyDragPointerGain.call(g, 300, 0);
        expect(b.x).toBeCloseTo(a.x, 5); // 重复采样不累加
        const back = Game.prototype._applyDragPointerGain.call(g, 0, 0);
        expect(back.x).toBeCloseTo(0, 5); // 残留加速偏移为 0 → 不漂移
    });

    it('长距离拖动不超调：500px 手指位移 → 500px 幽灵位移（线性、可预测）', () => {
        const g = touchDragStub(0, 0, { isAndroid: true });
        const p = Game.prototype._applyDragPointerGain.call(g, 500, 0);
        expect(p.x).toBeCloseTo(500, 5);
    });
});
