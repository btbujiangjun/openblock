/**
 * @vitest-environment jsdom
 * fxCanvas 闲置下沉合成层回归测试（v1.55.12 GPU 优化）
 *
 * Renderer 构造依赖完整 canvas2D ctx，jsdom 不支持；这里直接 import 类后
 * 用 fake `this` 调原型方法，验证 _hasFxContent / _setFxCanvasVisible /
 * syncFxCanvasVisibility 的契约。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Renderer } from '../web/src/renderer.js';

function makeFakeRenderer() {
    /* 仅声明 _hasFxContent / _setFxCanvasVisible / syncFxCanvasVisibility 用到的字段 */
    return {
        fxCanvas: document.createElement('canvas'),
        _effectsEnabled: true,
        particles: [],
        iconParticles: [],
        clearCells: [],
        _comboFlash: 0,
        _bonusMatchFlash: 0,
        _perfectFlash: 0,
        _doubleWave: 0,
        _iconGushLines: [],
        _colorGushLines: [],
        _ambientLayer: null,
        fxCtx: {},
        /* 拷贝原型方法 */
        _hasFxContent: Renderer.prototype._hasFxContent,
        _setFxCanvasVisible: Renderer.prototype._setFxCanvasVisible,
        syncFxCanvasVisibility: Renderer.prototype.syncFxCanvasVisibility,
        hasAmbientMotion: Renderer.prototype.hasAmbientMotion,
    };
}

describe('fxCanvas 闲置下沉合成层', () => {
    let r;
    beforeEach(() => {
        r = makeFakeRenderer();
    });

    it('初始无内容 → syncFxCanvasVisibility 隐藏 fxCanvas', () => {
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('none');
    });

    it('particles 非空 → fxCanvas 显示', () => {
        r.particles = [{ x: 0, y: 0, size: 1, life: 1, color: '#fff' }];
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('clearCells 非空 → fxCanvas 显示', () => {
        r.clearCells = [{ x: 0, y: 0 }];
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('_comboFlash > 0 → fxCanvas 显示', () => {
        r._comboFlash = 0.5;
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('_perfectFlash > 0 → fxCanvas 显示', () => {
        r._perfectFlash = 0.5;
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('_iconGushLines 非空 → fxCanvas 显示', () => {
        r._iconGushLines = [{ bonusLine: { type: 'row', idx: 0 }, icon: '🌸' }];
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('内容清空后再次 sync → fxCanvas 重新隐藏', () => {
        r.particles = [{ x: 0, y: 0, size: 1, life: 1, color: '#fff' }];
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
        r.particles = [];
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('none');
    });

    it('hasAmbientMotion=true（樱花皮肤等）→ fxCanvas 显示', () => {
        r._ambientLayer = { hasActiveMotion: () => true };
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('');
    });

    it('effectsEnabled=false → fxCanvas 隐藏（粒子被禁用）', () => {
        r.particles = [{ x: 0, y: 0, size: 1, life: 1, color: '#fff' }];
        r._effectsEnabled = false;
        r.syncFxCanvasVisibility();
        expect(r.fxCanvas.style.display).toBe('none');
    });

    it('_setFxCanvasVisible 幂等：同值多次调用不抖动 display', () => {
        r._setFxCanvasVisible(false);
        const before = r.fxCanvas.style.display;
        r._setFxCanvasVisible(false);
        expect(r.fxCanvas.style.display).toBe(before);
    });

    it('fxCanvas 为 null 时 _setFxCanvasVisible 不抛错（边界）', () => {
        r.fxCanvas = null;
        expect(() => r._setFxCanvasVisible(true)).not.toThrow();
        expect(() => r._setFxCanvasVisible(false)).not.toThrow();
    });
});
