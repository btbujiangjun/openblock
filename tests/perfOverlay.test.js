/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    initPerfOverlay,
    openPerfOverlay,
    closePerfOverlay,
    togglePerfOverlay,
    bumpPerfCounter,
    __test_only__,
} from '../web/src/monitoring/perfOverlay.js';

beforeEach(() => {
    /* jsdom 默认没 rAF；用 setTimeout 兜底，保证 _startFpsLoop 不爆。 */
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    document.body.innerHTML = '';
    delete window.__perfOverlay;
    __test_only__._resetForTest();
});

afterEach(() => {
    closePerfOverlay();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('perfOverlay', () => {
    it('默认不挂载任何 DOM，不暴露面板', () => {
        initPerfOverlay({ autoOpen: false });
        expect(document.getElementById('perf-overlay-host')).toBeNull();
        expect(window.__perfOverlay).toBeDefined();
        expect(window.__perfOverlay.__installed).toBe(true);
    });

    it('autoOpen=true 时立即挂载 DOM 与样式', () => {
        initPerfOverlay({ autoOpen: true });
        expect(document.getElementById('perf-overlay-host')).not.toBeNull();
        expect(document.getElementById('perf-overlay-style')).not.toBeNull();
    });

    it('open / close 可重入', () => {
        initPerfOverlay({ autoOpen: false });
        openPerfOverlay();
        expect(document.getElementById('perf-overlay-host')).not.toBeNull();
        openPerfOverlay(); // 第二次无副作用
        expect(document.querySelectorAll('#perf-overlay-host').length).toBe(1);
        closePerfOverlay();
        expect(document.getElementById('perf-overlay-host')).toBeNull();
        closePerfOverlay(); // 关闭后再关闭也不抛
    });

    it('toggle 切换显示', () => {
        initPerfOverlay({ autoOpen: false });
        togglePerfOverlay();
        expect(document.getElementById('perf-overlay-host')).not.toBeNull();
        togglePerfOverlay();
        expect(document.getElementById('perf-overlay-host')).toBeNull();
    });

    it('snapshot 在关闭状态也能调用，不抛错', () => {
        initPerfOverlay({ autoOpen: false });
        const snap = window.__perfOverlay.snapshot();
        expect(snap).toHaveProperty('ts');
        expect(snap).toHaveProperty('layers');
    });

    it('bumpPerfCounter 在关闭状态不积累（避免静默累积内存）', () => {
        initPerfOverlay({ autoOpen: false });
        bumpPerfCounter('demo');
        const snap = window.__perfOverlay.snapshot();
        expect(snap.countersPerSec.demo == null || snap.countersPerSec.demo === 0).toBe(true);
    });

    it('开启后 bumpPerfCounter 计数；关闭后停止', async () => {
        vi.useFakeTimers();
        initPerfOverlay({ autoOpen: true });
        for (let i = 0; i < 5; i++) bumpPerfCounter('game.render');
        /* counter 每秒 flush 一次到 lastSecondCounters；快进 1.1s */
        vi.advanceTimersByTime(1100);
        const snap = window.__perfOverlay.snapshot();
        expect(snap.countersPerSec['game.render']).toBe(5);
        closePerfOverlay();
        bumpPerfCounter('game.render');
        vi.advanceTimersByTime(1100);
        const snap2 = window.__perfOverlay.snapshot();
        /* 关闭后不再有新计数（lastSecondCounters 保留旧值无所谓） */
        expect(snap2.countersPerSec['game.render']).toBe(5);
    });
});
