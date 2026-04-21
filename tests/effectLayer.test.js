/**
 * @vitest-environment jsdom
 *
 * EffectLayer 单元测试
 * 覆盖：事件派发、默认处理器调用、自定义覆盖、reducedMotion、无 renderer 安全
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EffectLayer } from '../web/src/effects/effectLayer.js';

// ------------------------------------------------------------------ helpers
function makeRenderer() {
    return {
        setClearCells: vi.fn(),
        setShake: vi.fn(),
        triggerPerfectFlash: vi.fn(),
        triggerComboFlash: vi.fn(),
        triggerDoubleWave: vi.fn(),
        clearParticles: vi.fn(),
        render: vi.fn(),
    };
}

// ------------------------------------------------------------------ tests

describe('EffectLayer — 无 renderer 时安全', () => {
    it('emit 不抛出', () => {
        const layer = new EffectLayer(null);
        expect(() => layer.emit('clear', { cells: [], count: 1, type: 'single' })).not.toThrow();
    });

    it('所有事件类型均安全', () => {
        const layer = new EffectLayer(null);
        const events = ['clear', 'combo', 'place', 'revive', 'level_win'];
        events.forEach(e => expect(() => layer.emit(e, {})).not.toThrow());
    });
});

describe('EffectLayer — clear 事件', () => {
    let r, layer;
    beforeEach(() => {
        r = makeRenderer();
        layer = new EffectLayer(r);
    });

    it('单行消除：调用 setShake（轻）', () => {
        layer.emit('clear', { cells: [], count: 1, type: 'single' });
        expect(r.setShake).toHaveBeenCalledWith(5, 280);
    });

    it('multi 消除：triggerDoubleWave', () => {
        layer.emit('clear', { cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }], count: 2, type: 'multi' });
        expect(r.triggerDoubleWave).toHaveBeenCalled();
        expect(r.setShake).toHaveBeenCalledWith(8, 400);
    });

    it('combo：triggerComboFlash', () => {
        layer.emit('clear', { cells: [], count: 3, type: 'combo' });
        expect(r.triggerComboFlash).toHaveBeenCalledWith(3);
        expect(r.setShake).toHaveBeenCalledWith(11, 520);
    });

    it('perfect：triggerPerfectFlash + 强震', () => {
        layer.emit('clear', { cells: [], count: 2, type: 'perfect' });
        expect(r.triggerPerfectFlash).toHaveBeenCalled();
        expect(r.setShake).toHaveBeenCalledWith(16, 720);
    });

    it('setClearCells 始终被调用', () => {
        const cells = [{ x: 0, y: 0, color: 1 }];
        layer.emit('clear', { cells, count: 1, type: 'single' });
        expect(r.setClearCells).toHaveBeenCalledWith(cells);
    });
});

describe('EffectLayer — reducedMotion', () => {
    it('reducedMotion=true 时不抖动', () => {
        const r = makeRenderer();
        const layer = new EffectLayer(r, { reducedMotion: true });
        layer.emit('clear', { cells: [], count: 1, type: 'perfect' });
        expect(r.setShake).not.toHaveBeenCalled();
        expect(r.triggerPerfectFlash).not.toHaveBeenCalled();
    });
});

describe('EffectLayer — 自定义处理器', () => {
    it('on() 追加处理器', () => {
        const r = makeRenderer();
        const layer = new EffectLayer(r);
        const custom = vi.fn();
        layer.on('clear', custom);
        layer.emit('clear', { cells: [], count: 1, type: 'single' });
        expect(custom).toHaveBeenCalled();
    });

    it('off() 清除后恢复默认', () => {
        const r = makeRenderer();
        const layer = new EffectLayer(r);
        layer.off('clear');
        layer.emit('clear', { cells: [], count: 1, type: 'single' });
        // 重新注册了默认处理器，setShake 应被调用
        expect(r.setShake).toHaveBeenCalled();
    });
});

describe('EffectLayer — revive / level_win', () => {
    it('revive：setClearCells + 轻微抖动', () => {
        const r = makeRenderer();
        const layer = new EffectLayer(r);
        const cells = [{ x: 1, y: 1, color: 2 }];
        layer.emit('revive', { clearedCells: cells });
        expect(r.setClearCells).toHaveBeenCalledWith(cells);
        expect(r.setShake).toHaveBeenCalledWith(4, 300);
    });

    it('level_win (3 星)：triggerPerfectFlash', () => {
        const r = makeRenderer();
        const layer = new EffectLayer(r);
        layer.emit('level_win', { stars: 3 });
        expect(r.triggerPerfectFlash).toHaveBeenCalled();
        expect(r.setShake).toHaveBeenCalledWith(18, 900);
    });
});
