/**
 * @vitest-environment jsdom
 *
 * 触摸拖拽手感回归：所有触摸输入（安卓 / iOS / 任意触屏）走「相对抓取点的线性缩放」，
 * 不套用鼠标的指针加速（pointer ballistics）。核心契约（与 track 倍率具体值解耦）：
 *   1) 倍率从 `CONFIG.DRAG_TOUCH_TRACK_GAIN` 读取，必须是有限正数（≥ 1，避免减速滞后）；
 *   2) 幽灵块位移 = 手指位移 × track（线性、可预测，不存在「越拖越快」的累加加速）；
 *   3) 不依赖平台探测：即便 _isAndroidClient()=false（iOS / 普通触屏）也走同一公式；
 *   4) 无逐帧速度增益累加 → 幂等且不漂移（同一位置重复采样结果一致；回到起手点落点归零）。
 *
 * 背景：此前触摸误用鼠标速度感知增益（1.05→1.7 + 累计 6 格偏移），在安卓/鸿蒙高 DPR WebView
 * 上表现为「拖拽过于敏感 / 乱飘 / 几乎无法操作」。v1.61.15 改为相对抓取点线性缩放后，
 * 倍率值可由 CONFIG 在 [1.0, ~2.5] 区间调参：1.0 = 严格 1:1（更精细但行程长）、
 * 2.0 ≈ 温和放大（减少候选区到盘面的手指行程，当前默认）。
 */
import { describe, it, expect } from 'vitest';
import { Game } from '../web/src/game.js';
import { CONFIG } from '../web/src/config.js';

/** 当前 CONFIG 下的实际 track 倍率（与实现 `_applyDragPointerGain` 内的钳制逻辑同源）。 */
const TRACK = (() => {
    const raw = Number(CONFIG.DRAG_TOUCH_TRACK_GAIN);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

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

describe('_applyDragPointerGain — 触摸跟手·相对抓取点线性缩放', () => {
    it('DRAG_TOUCH_TRACK_GAIN 是有限正数（≥ 1，避免减速带来的可见滞后）', () => {
        expect(CONFIG.DRAG_TOUCH_TRACK_GAIN).toBeTypeOf('number');
        expect(Number.isFinite(CONFIG.DRAG_TOUCH_TRACK_GAIN)).toBe(true);
        expect(CONFIG.DRAG_TOUCH_TRACK_GAIN).toBeGreaterThanOrEqual(1.0);
        /* 上界软约束：>2.5 会重新引入"乱飘 / 失控"的安卓触屏 issue，超过即视为回归。 */
        expect(CONFIG.DRAG_TOUCH_TRACK_GAIN).toBeLessThanOrEqual(2.5);
    });

    it('幽灵块位移 = 手指位移 × CONFIG.DRAG_TOUCH_TRACK_GAIN（线性，无随距离漂移）', () => {
        const g = touchDragStub(100, 200, { isAndroid: true });
        const p = Game.prototype._applyDragPointerGain.call(g, 160, 260); // 手指 +60/+60
        expect(p.x).toBeCloseTo(100 + 60 * TRACK, 5);
        expect(p.y).toBeCloseTo(200 + 60 * TRACK, 5); // lift(0)
    });

    it('非安卓触屏（iOS 等）走同一线性公式，不再依赖平台探测', () => {
        const g = touchDragStub(0, 0, { isAndroid: false });
        const p = Game.prototype._applyDragPointerGain.call(g, 50, 0);
        expect(p.x).toBeCloseTo(50 * TRACK, 5);
    });

    it('幂等且不漂移：重复同点结果一致，回到起手点落点归零（无逐帧累加）', () => {
        const g = touchDragStub(0, 0, { isAndroid: true });
        const a = Game.prototype._applyDragPointerGain.call(g, 300, 0);
        const b = Game.prototype._applyDragPointerGain.call(g, 300, 0);
        expect(b.x).toBeCloseTo(a.x, 5); // 重复采样不累加
        const back = Game.prototype._applyDragPointerGain.call(g, 0, 0);
        expect(back.x).toBeCloseTo(0, 5); // 残留加速偏移为 0 → 不漂移
    });

    it('长距离拖动严格线性可预测：500px 手指位移 → 500 × track 幽灵位移（不超调）', () => {
        const g = touchDragStub(0, 0, { isAndroid: true });
        const p = Game.prototype._applyDragPointerGain.call(g, 500, 0);
        expect(p.x).toBeCloseTo(500 * TRACK, 5);
    });

    it('不同距离的位移比保持恒定 = 1：1（线性，无速度感知曲线漏入）', () => {
        const g1 = touchDragStub(0, 0, { isAndroid: true });
        const p1 = Game.prototype._applyDragPointerGain.call(g1, 100, 0);
        const g2 = touchDragStub(0, 0, { isAndroid: true });
        const p2 = Game.prototype._applyDragPointerGain.call(g2, 200, 0);
        /* 关键回归：p2.x / p1.x 必须恰好等于 200/100 = 2.0，
         * 一旦实现引入非线性（速度感知 / 距离 boost），此比值会偏离 2.0。 */
        expect(p2.x / p1.x).toBeCloseTo(2.0, 5);
    });
});

describe('_dockPointerHitsBlockShape — 起拖热区仅 shape 实体格', () => {
    const cell = CONFIG.CELL_SIZE;
    const slotPx = CONFIG.DOCK_PREVIEW_MAX_CELLS * cell;
    const block = {
        width: 2,
        height: 2,
        shape: [
            [1, 1],
            [1, 0],
        ],
    };
    const ox = (slotPx - block.width * cell) / 2;
    const oy = (slotPx - block.height * cell) / 2;
    const canvas = {
        getBoundingClientRect: () => ({ left: 100, top: 200, width: slotPx, height: slotPx }),
    };
    const gameStub = { _getDockCellPx: () => cell };

    it('点在实体格内 → true', () => {
        const cx = 100 + ox + cell * 0.5;
        const cy = 200 + oy + cell * 0.5;
        expect(Game.prototype._dockPointerHitsBlockShape.call(gameStub, canvas, cx, cy, block)).toBe(true);
    });

    it('点在 5×5 槽留白（shape 外）→ false', () => {
        expect(Game.prototype._dockPointerHitsBlockShape.call(gameStub, canvas, 110, 210, block)).toBe(false);
    });

    it('点在 shape 内空格（L 形缺口）→ false', () => {
        const cx = 100 + ox + cell * 1.5;
        const cy = 200 + oy + cell * 1.5;
        expect(Game.prototype._dockPointerHitsBlockShape.call(gameStub, canvas, cx, cy, block)).toBe(false);
    });
});
