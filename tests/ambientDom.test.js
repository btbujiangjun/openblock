/**
 * @vitest-environment jsdom
 * AmbientParticles DOM 模式回归测试（v1.55.13）
 *
 * 验证：
 *   1. 离散粒子皮肤（sakura/forest/ocean/fairy/universe）在 domHost 存在时切到 DOM 模式
 *   2. DOM 模式下 hasActiveMotion() 返回 false（fxCanvas 可下沉合成层）
 *   3. tickAndRender(fxCtx, ...) 在 DOM 模式下不写 fxCtx（no-op）
 *   4. setEnabled(false) 清空 DOM 元素并停止 scheduler
 *   5. applySkin 切走时清掉旧 DOM 粒子
 *   6. 流体型（aurora-band / ripple）即使有 domHost 也走 canvas 模式
 *   7. 没传 domHost 时全程走 canvas 模式（向后兼容）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AmbientParticles } from '../web/src/effects/ambientParticles.js';

beforeEach(() => {
    /* 重置 localStorage（_loadPrefs 会读 openblock_ambient_v1）。
     * jsdom 不一定有完整 Storage API，try/catch 兜底。 */
    try { localStorage.removeItem?.('openblock_ambient_v1'); } catch { /* ignore */ }
    /* mock prefers-reduced-motion = false */
    window.matchMedia = vi.fn((q) => ({
        matches: q.includes('prefers-reduced-motion') ? false : false,
        media: q, addEventListener() {}, removeEventListener() {},
    }));
    document.body.innerHTML = '';
});

function makeHost() {
    const host = document.createElement('div');
    /* mock getBoundingClientRect 让 _tickDom 拿到非零尺寸 */
    host.getBoundingClientRect = () => ({ width: 480, height: 480, left: 0, top: 0, right: 480, bottom: 480, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(host);
    return host;
}

describe('AmbientParticles DOM mode', () => {
    it('sakura 皮肤 + domHost 存在 → 切到 DOM 模式', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        expect(a._renderMode).toBe('dom');
    });

    it('forest 皮肤 + domHost → DOM 模式', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('forest');
        expect(a._renderMode).toBe('dom');
    });

    it('aurora 皮肤（流体型）→ 即使有 domHost 也走 canvas', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('aurora');
        expect(a._renderMode).toBe('canvas');
    });

    it('DOM 模式下 hasActiveMotion=false（让 fxCanvas 可下沉合成层）', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        expect(a.hasActiveMotion()).toBe(false);
        expect(a.isRunning()).toBe(true);
    });

    it('canvas 模式下 hasActiveMotion=true（旧版语义）', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('aurora');
        expect(a.hasActiveMotion()).toBe(true);
    });

    it('DOM 模式下 tickAndRender(fxCtx) 是 no-op：不调任何 fxCtx 方法', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        const fxCtx = {
            save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
            beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(),
        };
        a.tickAndRender(fxCtx, { logicalW: 480, logicalH: 480, paintMargin: 50 });
        expect(fxCtx.save).not.toHaveBeenCalled();
        expect(fxCtx.fill).not.toHaveBeenCalled();
    });

    it('_tickDom 后 domHost 内有 .ambient-particle 子元素', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        a._tickDom();
        const els = host.querySelectorAll('.ambient-particle');
        expect(els.length).toBeGreaterThan(0);
        expect(els.length).toBeLessThanOrEqual(5 * 2);  // sakura target=5，留余量
        /* 每个粒子的 style.transform 应是 translate3d */
        const first = els[0];
        expect(first.style.transform).toContain('translate3d');
    });

    it('setEnabled(false) 清空 DOM 元素 + 停 scheduler', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        a._tickDom();
        expect(host.querySelectorAll('.ambient-particle').length).toBeGreaterThan(0);
        a.setEnabled(false);
        expect(host.querySelectorAll('.ambient-particle').length).toBe(0);
        expect(a._domTimer).toBe(0);
    });

    it('applySkin 切走时清掉旧 DOM 粒子', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        a._tickDom();
        expect(host.querySelectorAll('.ambient-particle').length).toBeGreaterThan(0);
        a.applySkin('titanium');   // 非预设皮肤
        expect(host.querySelectorAll('.ambient-particle').length).toBe(0);
        expect(a._renderMode).toBe('canvas');
    });

    it('没传 domHost → 全程 canvas 模式（向后兼容）', () => {
        const a = new AmbientParticles({ renderer: null });   // 无 domHost
        a.applySkin('sakura');
        expect(a._renderMode).toBe('canvas');
        expect(a.hasActiveMotion()).toBe(true);
    });

    it('粒子位置随 _tickDom 多次调用而更新（transform 变化）', () => {
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        a._tickDom();
        const els1 = Array.from(host.querySelectorAll('.ambient-particle'));
        const transform1 = els1.map((el) => el.style.transform).join('|');
        /* 模拟时间流逝 */
        a._lastTickTs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - 700;
        a._tickDom();
        const els2 = Array.from(host.querySelectorAll('.ambient-particle'));
        const transform2 = els2.map((el) => el.style.transform).join('|');
        expect(transform1).not.toBe(transform2);
    });

    it('reduced-motion=true → DOM 模式不启动 scheduler（isRunning=false）', () => {
        window.matchMedia = vi.fn(() => ({ matches: true, media: '', addEventListener() {}, removeEventListener() {} }));
        const host = makeHost();
        const a = new AmbientParticles({ renderer: null, domHost: host });
        a.applySkin('sakura');
        expect(a.isRunning()).toBe(false);
        expect(a._domTimer).toBe(0);
    });
});
