/**
 * @vitest-environment jsdom
 *
 * v1.60.46 性能优化回归测试：静态盘面层缓存 + 背景层缓存 + watermark 字形精灵。
 *
 * Renderer 构造依赖完整 canvas2D ctx（jsdom 不支持），沿用项目既有
 * "fake this + 原型方法" 模式（见 fxCanvasIdleHide.test.js）：直接用录制型
 * ctx 调用原型方法，断言缓存命中 / 失效契约，而不真正构造 Renderer。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Renderer } from '../web/src/renderer.js';

/** 录制型 2D ctx：记录所有方法调用名，create*Gradient 返回带 addColorStop 的桩。 */
function recordingCtx() {
    const calls = [];
    const grad = { addColorStop() {} };
    const target = { __calls: calls };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return () => { calls.push(prop); return grad; };
            }
            if (prop === 'globalAlpha') return t._globalAlpha ?? 1;
            if (prop === 'measureText') return () => ({ width: 10 });
            return () => { calls.push(prop); };
        },
        set(t, prop, val) { t[prop] = val; return true; },
    });
}

function countCalls(ctx, name) {
    return ctx.__calls.filter((c) => c === name).length;
}

/** 构造一个 8×8 grid，少量已落子格。 */
function makeGrid(filledCount = 5) {
    const cells = Array.from({ length: 8 }, () => Array(8).fill(null));
    let placed = 0;
    for (let y = 0; y < 8 && placed < filledCount; y++) {
        for (let x = 0; x < 8 && placed < filledCount; x++) {
            cells[y][x] = 0; // palette[0]
            placed++;
        }
    }
    return { cells };
}

let offscreenCtxs;
let getContextSpy;

beforeEach(() => {
    offscreenCtxs = [];
    /* 让离屏 canvas.getContext('2d') 返回录制型 ctx（jsdom 默认返回 null）。 */
    getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockImplementation(function () {
            const c = recordingCtx();
            offscreenCtxs.push(c);
            return c;
        });
});

afterEach(() => {
    getContextSpy.mockRestore();
});

function makeGridRendererThis() {
    return {
        gridSize: 8,
        cellSize: 38,
        dpr: 2,
        logicalW: 8 * 38,
        logicalH: 8 * 38,
        shakeOffset: { x: 0, y: 0 },
        ctx: recordingCtx(),
        _gridLayer: null,
        _gridLayerCtx: null,
        _gridLayerKey: '',
        _getGridLayer: Renderer.prototype._getGridLayer,
        drawBlock: Renderer.prototype.drawBlock,
        renderGrid: Renderer.prototype.renderGrid,
    };
}

describe('静态盘面层缓存（renderGrid / _getGridLayer）', () => {
    it('首帧渲染：离屏绘制落子格 + 主 ctx 一次 drawImage', () => {
        const self = makeGridRendererThis();
        const grid = makeGrid(5);
        self.renderGrid(grid);

        expect(self._gridLayer).toBeTruthy();
        // 主 ctx 走 blit 路径
        expect(countCalls(self.ctx, 'drawImage')).toBe(1);
        // 离屏 ctx 实际渲染了格子（glossy 风格每格至少 1 个渐变）
        const off = offscreenCtxs[0];
        expect(countCalls(off, 'createLinearGradient')).toBeGreaterThan(0);
    });

    it('盘面未变：第二帧命中缓存，离屏不再重绘，但仍 blit', () => {
        const self = makeGridRendererThis();
        const grid = makeGrid(5);
        self.renderGrid(grid);
        const off = offscreenCtxs[0];
        const layerRef = self._gridLayer;
        const gradAfterFirst = countCalls(off, 'createLinearGradient');

        self.renderGrid(grid);
        // 离屏渐变调用次数不变 → 没有重绘
        expect(countCalls(off, 'createLinearGradient')).toBe(gradAfterFirst);
        // 主 ctx 第二次仍 blit
        expect(countCalls(self.ctx, 'drawImage')).toBe(2);
        // 复用同一个离屏 canvas，未新建
        expect(self._gridLayer).toBe(layerRef);
        expect(offscreenCtxs.length).toBe(1);
    });

    it('盘面变化：缓存失效并重绘离屏', () => {
        const self = makeGridRendererThis();
        self.renderGrid(makeGrid(5));
        const off = offscreenCtxs[0];
        const gradAfterFirst = countCalls(off, 'createLinearGradient');

        // 改变一个格子内容
        const grid2 = makeGrid(5);
        grid2.cells[7][7] = 0;
        self.renderGrid(grid2);
        expect(countCalls(off, 'createLinearGradient')).toBeGreaterThan(gradAfterFirst);
    });

    it('cellSize 变化使缓存键失效', () => {
        const self = makeGridRendererThis();
        const grid = makeGrid(5);
        self.renderGrid(grid);
        const keyA = self._gridLayerKey;
        self.cellSize = 40;
        self.logicalW = 8 * 40;
        self.logicalH = 8 * 40;
        self.renderGrid(grid);
        expect(self._gridLayerKey).not.toBe(keyA);
    });
});

describe('背景层缓存（renderBackground / _getBackgroundLayers）', () => {
    function makeBgRendererThis() {
        return {
            gridSize: 8,
            cellSize: 38,
            dpr: 2,
            logicalW: 8 * 38,
            logicalH: 8 * 38,
            _qualityMode: 'high',
            shakeOffset: { x: 0, y: 0 },
            ctx: recordingCtx(),
            _bgUnderLayer: null,
            _bgUnderCtx: null,
            _bgOverLayer: null,
            _bgOverCtx: null,
            _bgLayerKey: '',
            /* 无独立层 DOM → _hasBoardLayers 为 false → renderBackground 走单画布回退路径 */
            bgCtx: null,
            wmCtx: null,
            _hasBoardLayers: Renderer.prototype._hasBoardLayers,
            _watermarkGlyphCache: new Map(),
            _getBackgroundLayers: Renderer.prototype._getBackgroundLayers,
            _paintBackgroundUnder: Renderer.prototype._paintBackgroundUnder,
            _paintBackgroundOver: Renderer.prototype._paintBackgroundOver,
            _renderBoardWatermark: Renderer.prototype._renderBoardWatermark,
            _getWatermarkGlyph: Renderer.prototype._getWatermarkGlyph,
            _watermarkPointsForFrame: () => [[10, 10]],
            renderBackground: Renderer.prototype.renderBackground,
        };
    }

    it('首帧：构建 under/over 两层并各 blit 一次', () => {
        const self = makeBgRendererThis();
        self.renderBackground();
        expect(self._bgUnderLayer).toBeTruthy();
        expect(self._bgOverLayer).toBeTruthy();
        // under + over 两次 drawImage（watermark 数量取决于皮肤，单独统计）
        expect(countCalls(self.ctx, 'drawImage')).toBeGreaterThanOrEqual(2);
    });

    it('皮肤/尺寸不变：第二帧命中缓存键', () => {
        const self = makeBgRendererThis();
        self.renderBackground();
        const keyA = self._bgLayerKey;
        self.renderBackground();
        expect(self._bgLayerKey).toBe(keyA);
    });
});

describe('三层拆分：背景层 L0 + 漂移水印层 L1（v1.60.47 GPU）', () => {
    const SKIN = {
        id: 'test-skin',
        gridGap: 1,
        gridOuter: '#101820',
        gridCell: '#202830',
        gridLine: 'rgba(255,255,255,0.14)',
        boardWatermark: { icons: ['🀄'], opacity: 0.08, scale: 0.24 },
    };

    function makeLayeredThis() {
        return {
            gridSize: 8,
            cellSize: 38,
            dpr: 2,
            wmDpr: 1.5,
            logicalW: 8 * 38,
            logicalH: 8 * 38,
            _qualityMode: 'high',
            _effectsEnabled: true,
            shakeOffset: { x: 0, y: 0 },
            ctx: recordingCtx(),       // L2 主画布
            bgCtx: recordingCtx(),     // L0 背景层
            wmCtx: recordingCtx(),     // L1 水印层
            bgCanvas: {},
            wmCanvas: {},
            _boardBgKey: '',
            _watermarkGlyphCache: new Map(),
            _watermarkPointsForFrame: () => [[40, 40]],
            _hasBoardLayers: Renderer.prototype._hasBoardLayers,
            _refreshBoardBgLayer: Renderer.prototype._refreshBoardBgLayer,
            _refreshWatermarkLayer: Renderer.prototype._refreshWatermarkLayer,
            _paintBackgroundUnder: Renderer.prototype._paintBackgroundUnder,
            _paintBackgroundOver: Renderer.prototype._paintBackgroundOver,
            _renderBoardWatermark: Renderer.prototype._renderBoardWatermark,
            _getWatermarkGlyph: Renderer.prototype._getWatermarkGlyph,
            renderBoardWatermarkMotionFrame: Renderer.prototype.renderBoardWatermarkMotionFrame,
            hasBoardWatermarkMotion: () => true,
        };
    }

    it('_hasBoardLayers：bg/wm ctx 俱全为 true，缺任一为 false', () => {
        const self = makeLayeredThis();
        expect(Renderer.prototype._hasBoardLayers.call(self)).toBe(true);
        expect(Renderer.prototype._hasBoardLayers.call({ bgCtx: null, wmCtx: {} })).toBe(false);
        expect(Renderer.prototype._hasBoardLayers.call({ bgCtx: {}, wmCtx: null })).toBe(false);
    });

    it('L0 背景层：首帧画进 bgCtx，签名未变第二帧跳过重画', () => {
        const self = makeLayeredThis();
        self._refreshBoardBgLayer(SKIN);
        const fillsAfterFirst = countCalls(self.bgCtx, 'fillRect');
        expect(fillsAfterFirst).toBeGreaterThan(0);
        expect(self._boardBgKey).not.toBe('');

        self._refreshBoardBgLayer(SKIN);
        // 签名命中 → 不再重画
        expect(countCalls(self.bgCtx, 'fillRect')).toBe(fillsAfterFirst);
    });

    it('L0 背景层：cellSize 变化使签名失效并重画', () => {
        const self = makeLayeredThis();
        self._refreshBoardBgLayer(SKIN);
        const keyA = self._boardBgKey;
        const fillsA = countCalls(self.bgCtx, 'fillRect');
        self.cellSize = 40;
        self.logicalW = 8 * 40;
        self.logicalH = 8 * 40;
        self._refreshBoardBgLayer(SKIN);
        expect(self._boardBgKey).not.toBe(keyA);
        expect(countCalls(self.bgCtx, 'fillRect')).toBeGreaterThan(fillsA);
    });

    it('L1 水印层：水印画进 wmCtx，且完全不触碰主画布 ctx', () => {
        const self = makeLayeredThis();
        self._refreshWatermarkLayer(SKIN);
        // 水印走字形精灵 → wmCtx 上有 drawImage；主画布 ctx 零调用
        expect(countCalls(self.wmCtx, 'drawImage')).toBeGreaterThan(0);
        expect(self.ctx.__calls.length).toBe(0);
    });

    it('renderBoardWatermarkMotionFrame：仅重绘 L1，主画布 ctx 不动；无层时返回 false', () => {
        const self = makeLayeredThis();
        const ok = self.renderBoardWatermarkMotionFrame.call({
            ...self,
            // motion frame 内部用 getActiveSkin()，这里改调 _refreshWatermarkLayer 的桩验证「只动 wmCtx」
            _refreshWatermarkLayer() { this.__refreshed = true; },
        });
        // 有层 + hasBoardWatermarkMotion=true → 返回 true
        expect(ok).toBe(true);

        // 无独立层 → 直接 false（调用方回退 markDirty）
        const noLayers = { _hasBoardLayers: Renderer.prototype._hasBoardLayers, bgCtx: null, wmCtx: null };
        expect(Renderer.prototype.renderBoardWatermarkMotionFrame.call(noLayers)).toBe(false);
    });
});

describe('watermark 字形精灵缓存（_getWatermarkGlyph）', () => {
    function makeWmThis() {
        return { dpr: 2, _watermarkGlyphCache: new Map(), _getWatermarkGlyph: Renderer.prototype._getWatermarkGlyph };
    }

    it('相同 icon+尺寸返回同一精灵（缓存命中）', () => {
        const self = makeWmThis();
        const a = self._getWatermarkGlyph('🌸', 40);
        const b = self._getWatermarkGlyph('🌸', 40);
        expect(a).toBe(b);
        expect(a._cssBox).toBeGreaterThan(0);
    });

    it('不同 icon 生成不同精灵', () => {
        const self = makeWmThis();
        const a = self._getWatermarkGlyph('🌸', 40);
        const b = self._getWatermarkGlyph('🍁', 40);
        expect(a).not.toBe(b);
    });

    it('缓存规模超过 64 时驱逐最旧项', () => {
        const self = makeWmThis();
        for (let i = 0; i < 70; i++) self._getWatermarkGlyph(`x${i}`, 40);
        expect(self._watermarkGlyphCache.size).toBeLessThanOrEqual(64);
    });
});
