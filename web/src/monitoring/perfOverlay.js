/**
 * perfOverlay.js — 实时性能 HUD（仅在 ?perf=1 或 Alt+P 启用）
 *
 * 设计原则
 * --------
 * 1. 默认不加载、不挂载、不计时：放在主流程旁边，仅当用户主动启用才装载。
 * 2. 关注 4 类指标：
 *    a. 帧率（rAF 实测，1s 滑窗，p50/p95/min）
 *    b. 长任务（>50ms 的 main thread block，PerformanceObserver{type:'longtask'}）
 *    c. 业务热点计数（每秒）：
 *       - game.markDirty / game.render
 *       - renderer.renderAmbientFxFrame
 *       - renderer.renderBoardWatermark
 *       - DFV.tick
 *       - score animator rAF
 *    d. 合成层指标推断：
 *       - body 子元素中 transform/will-change/filter/opacity<1/position:fixed 数量
 *       - 当前可见的 fxCanvas / ambient 状态
 * 3. 自身开销受控：HUD 文本每 500ms 更新一次（不是每帧）。
 *
 * 用法
 * ----
 *   URL 加 ?perf=1 或键盘 Alt+P 切换显示。
 *   控制台：window.__perfOverlay.snapshot()  → 导出当前快照对象
 *           window.__perfOverlay.startProfile(secs=10)  → 录一段后打出聚合
 *
 * 仪表板 ID 与 selectors
 * ----------------------
 *   #perf-overlay-host (容器)
 *   .perf-row-fps / .perf-row-longtask / .perf-row-hotspot / .perf-row-layers
 */

import { createLogger } from '../lib/logger.js';
const log = createLogger('perfOverlay');

const HOST_ID = 'perf-overlay-host';
const STYLE_ID = 'perf-overlay-style';

const _counters = Object.create(null);
const _lastSecondCounters = Object.create(null);
let _counterFlushTimer = 0;

const _fpsBuffer = [];   // 最近 N 帧间隔（ms）
const _FPS_BUFFER_MAX = 240;
let _lastFrameMs = 0;
let _rafLoopId = 0;
let _open = false;
let _hostEl = null;
let _renderTimer = 0;

let _longTaskObserver = null;
const _longTasks = []; // {at, duration, attribution[]}
const _LONGTASK_KEEP = 60;

let _instrumented = false;
let _origMarkDirty = null;
let _origGameRender = null;

/** 计数器自增；每秒把"本秒"复制到 _lastSecondCounters 然后清零，便于 HUD 取"每秒值"。 */
export function bumpPerfCounter(key, n = 1) {
    if (!_open) return;
    _counters[key] = (_counters[key] || 0) + n;
}

function _flushCountersEverySec() {
    if (_counterFlushTimer) return;
    _counterFlushTimer = window.setInterval(() => {
        for (const k of Object.keys(_counters)) {
            _lastSecondCounters[k] = _counters[k];
            _counters[k] = 0;
        }
    }, 1000);
}

function _stopCounterFlush() {
    if (_counterFlushTimer) {
        clearInterval(_counterFlushTimer);
        _counterFlushTimer = 0;
    }
}

function _startFpsLoop() {
    if (_rafLoopId) return;
    const tick = (now) => {
        if (_lastFrameMs > 0) {
            const dt = now - _lastFrameMs;
            _fpsBuffer.push(dt);
            if (_fpsBuffer.length > _FPS_BUFFER_MAX) _fpsBuffer.shift();
        }
        _lastFrameMs = now;
        _rafLoopId = requestAnimationFrame(tick);
    };
    _rafLoopId = requestAnimationFrame(tick);
}

function _stopFpsLoop() {
    if (_rafLoopId) {
        cancelAnimationFrame(_rafLoopId);
        _rafLoopId = 0;
    }
    _lastFrameMs = 0;
    _fpsBuffer.length = 0;
}

function _fpsStats() {
    if (_fpsBuffer.length < 2) return null;
    const sorted = _fpsBuffer.slice().sort((a, b) => a - b);
    const dtP50 = sorted[Math.floor(sorted.length * 0.5)];
    const dtP95 = sorted[Math.floor(sorted.length * 0.95)];
    const dtMax = sorted[sorted.length - 1];
    const mean = _fpsBuffer.reduce((a, b) => a + b, 0) / _fpsBuffer.length;
    return {
        meanFps: 1000 / mean,
        p50Fps: 1000 / dtP50,
        p95Fps: 1000 / dtP95,
        worstFps: 1000 / dtMax,
        samples: _fpsBuffer.length,
    };
}

function _startLongTaskObserver() {
    if (_longTaskObserver || typeof PerformanceObserver === 'undefined') return;
    try {
        _longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                _longTasks.push({
                    at: entry.startTime,
                    duration: entry.duration,
                    attribution: (entry.attribution || []).map((a) => a.containerType || a.name || '').filter(Boolean),
                });
                if (_longTasks.length > _LONGTASK_KEEP) _longTasks.shift();
            }
        });
        _longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
        /* longtask 不被支持时直接放弃，HUD 显示 "n/a" */
        _longTaskObserver = null;
    }
}

function _stopLongTaskObserver() {
    if (_longTaskObserver) {
        try { _longTaskObserver.disconnect(); } catch { /* ignore */ }
        _longTaskObserver = null;
    }
    _longTasks.length = 0;
}

function _longTaskSummary() {
    if (!_longTasks.length) return { count: 0, totalMs: 0, maxMs: 0 };
    let total = 0;
    let max = 0;
    for (const t of _longTasks) {
        total += t.duration;
        if (t.duration > max) max = t.duration;
    }
    return { count: _longTasks.length, totalMs: total, maxMs: max };
}

function _instrumentGame() {
    if (_instrumented) return;
    const game = typeof window !== 'undefined' ? window.openBlockGame : null;
    if (!game) return;
    if (typeof game.markDirty === 'function' && !_origMarkDirty) {
        _origMarkDirty = game.markDirty.bind(game);
        game.markDirty = function _perfMarkDirty(...args) {
            bumpPerfCounter('markDirty');
            return _origMarkDirty.apply(this, args);
        };
    }
    if (typeof game.render === 'function' && !_origGameRender) {
        _origGameRender = game.render.bind(game);
        game.render = function _perfGameRender(...args) {
            bumpPerfCounter('game.render');
            return _origGameRender.apply(this, args);
        };
    }
    const renderer = game.renderer;
    if (renderer) {
        if (typeof renderer.renderAmbientFxFrame === 'function' && !renderer.__perfRenderAmbientWrapped) {
            const orig = renderer.renderAmbientFxFrame.bind(renderer);
            renderer.renderAmbientFxFrame = function _perfRenderAmbient(...args) {
                bumpPerfCounter('renderer.renderAmbientFxFrame');
                return orig.apply(this, args);
            };
            renderer.__perfRenderAmbientWrapped = true;
        }
        if (typeof renderer._renderBoardWatermark === 'function' && !renderer.__perfRenderWmWrapped) {
            const orig = renderer._renderBoardWatermark.bind(renderer);
            renderer._renderBoardWatermark = function _perfRenderWm(...args) {
                bumpPerfCounter('renderer._renderBoardWatermark');
                return orig.apply(this, args);
            };
            renderer.__perfRenderWmWrapped = true;
        }
        if (typeof renderer.clear === 'function' && !renderer.__perfClearWrapped) {
            const orig = renderer.clear.bind(renderer);
            renderer.clear = function _perfClear(...args) {
                bumpPerfCounter('renderer.clear');
                return orig.apply(this, args);
            };
            renderer.__perfClearWrapped = true;
        }
    }
    _instrumented = true;
}

function _unInstrumentGame() {
    const game = typeof window !== 'undefined' ? window.openBlockGame : null;
    if (game && _origMarkDirty) {
        game.markDirty = _origMarkDirty;
        _origMarkDirty = null;
    }
    if (game && _origGameRender) {
        game.render = _origGameRender;
        _origGameRender = null;
    }
    _instrumented = false;
    // 注意：renderer 上的 wrap 不还原（无害——只是 counter 没递增）
}

/* 合成层与可疑 GPU 单点的"启发式探测"——非精确，仅作为大方向指引。 */
function _layerSuspectStats() {
    if (typeof document === 'undefined') return null;
    let promoters = 0;
    let bigShadows = 0;
    let backdropFilters = 0;
    let canvasCount = 0;
    let positionFixedOrSticky = 0;
    let willChangeNotAuto = 0;
    const all = document.querySelectorAll('body *');
    for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.willChange && cs.willChange !== 'auto') willChangeNotAuto++;
        if (cs.transform && cs.transform !== 'none') promoters++;
        if (cs.filter && cs.filter !== 'none') promoters++;
        if (cs.backdropFilter && cs.backdropFilter !== 'none') backdropFilters++;
        if (cs.position === 'fixed' || cs.position === 'sticky') positionFixedOrSticky++;
        const sh = cs.boxShadow;
        if (sh && sh !== 'none' && /\b\d{2,}px\b/.test(sh)) bigShadows++;
        if (el.tagName === 'CANVAS') canvasCount++;
    }
    return {
        domNodes: all.length,
        willChangeNotAuto,
        promoters,
        bigShadows,
        backdropFilters,
        canvasCount,
        positionFixedOrSticky,
    };
}

function _ensureStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
#${HOST_ID} {
    position: fixed;
    right: 8px;
    bottom: 8px;
    z-index: 99999;
    width: 260px;
    padding: 8px 10px;
    background: rgba(8, 12, 22, 0.92);
    color: #e7eefb;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.42;
    border-radius: 8px;
    border: 1px solid rgba(120, 160, 220, 0.28);
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    user-select: text;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}
#${HOST_ID} h4 {
    margin: 0 0 6px 0;
    font-size: 11px;
    color: #9ddcff;
    letter-spacing: 0.02em;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
#${HOST_ID} h4 button {
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.04);
    color: inherit;
    font: inherit;
    padding: 1px 6px;
    border-radius: 6px;
    cursor: pointer;
}
#${HOST_ID} .perf-section {
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed rgba(255, 255, 255, 0.10);
}
#${HOST_ID} .perf-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    white-space: nowrap;
}
#${HOST_ID} .perf-row span:first-child {
    color: #8aa1c4;
}
#${HOST_ID} .perf-row.warn span:last-child { color: #ffd166; }
#${HOST_ID} .perf-row.bad  span:last-child { color: #ff6b6b; }
`;
    document.head.appendChild(css);
}

function _buildHost() {
    if (typeof document === 'undefined') return null;
    _ensureStyle();
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.innerHTML = `
        <h4>
            <span>⚙️ perf · live</span>
            <button type="button" data-act="close" title="关闭 (Alt+P)">×</button>
        </h4>
        <div class="perf-section">
            <div class="perf-row"><span>fps mean</span><span data-k="fps-mean">–</span></div>
            <div class="perf-row"><span>fps p50</span><span data-k="fps-p50">–</span></div>
            <div class="perf-row"><span>fps p95</span><span data-k="fps-p95">–</span></div>
            <div class="perf-row"><span>fps worst</span><span data-k="fps-worst">–</span></div>
        </div>
        <div class="perf-section">
            <div class="perf-row"><span>longtask /min</span><span data-k="lt-count">–</span></div>
            <div class="perf-row"><span>longtask max</span><span data-k="lt-max">–</span></div>
            <div class="perf-row"><span>longtask total</span><span data-k="lt-total">–</span></div>
        </div>
        <div class="perf-section">
            <div class="perf-row"><span>game.render /s</span><span data-k="c-gr">–</span></div>
            <div class="perf-row"><span>markDirty /s</span><span data-k="c-md">–</span></div>
            <div class="perf-row"><span>renderer.clear /s</span><span data-k="c-rc">–</span></div>
            <div class="perf-row"><span>ambient fx /s</span><span data-k="c-amb">–</span></div>
            <div class="perf-row"><span>watermark /s</span><span data-k="c-wm">–</span></div>
        </div>
        <div class="perf-section">
            <div class="perf-row"><span>DOM nodes</span><span data-k="l-dom">–</span></div>
            <div class="perf-row"><span>canvas</span><span data-k="l-canvas">–</span></div>
            <div class="perf-row"><span>filter/transform</span><span data-k="l-promo">–</span></div>
            <div class="perf-row"><span>big shadow</span><span data-k="l-shadow">–</span></div>
            <div class="perf-row"><span>backdrop-filter</span><span data-k="l-bdf">–</span></div>
            <div class="perf-row"><span>will-change</span><span data-k="l-wc">–</span></div>
        </div>
    `;
    document.body.appendChild(host);
    host.querySelector('[data-act="close"]')?.addEventListener('click', () => closePerfOverlay());
    return host;
}

function _fmtFps(v) { return Number.isFinite(v) ? v.toFixed(1) : '–'; }
function _fmtMs(v) { return Number.isFinite(v) ? `${v.toFixed(1)}ms` : '–'; }

function _setRow(host, key, value, warnAbove, badAbove) {
    const cell = host.querySelector(`[data-k="${key}"]`);
    if (!cell) return;
    cell.textContent = value;
    const row = cell.closest('.perf-row');
    if (!row) return;
    row.classList.remove('warn', 'bad');
    const raw = parseFloat(value);
    if (!Number.isFinite(raw)) return;
    if (badAbove != null && raw >= badAbove) row.classList.add('bad');
    else if (warnAbove != null && raw >= warnAbove) row.classList.add('warn');
}

function _setFpsRow(host, key, fps, warnBelow, badBelow) {
    const cell = host.querySelector(`[data-k="${key}"]`);
    if (!cell) return;
    cell.textContent = _fmtFps(fps);
    const row = cell.closest('.perf-row');
    if (!row) return;
    row.classList.remove('warn', 'bad');
    if (!Number.isFinite(fps)) return;
    if (badBelow != null && fps <= badBelow) row.classList.add('bad');
    else if (warnBelow != null && fps <= warnBelow) row.classList.add('warn');
}

function _renderTickPaint() {
    if (!_open || !_hostEl) return;
    const fps = _fpsStats();
    if (fps) {
        _setFpsRow(_hostEl, 'fps-mean', fps.meanFps, 50, 30);
        _setFpsRow(_hostEl, 'fps-p50', fps.p50Fps, 50, 30);
        _setFpsRow(_hostEl, 'fps-p95', fps.p95Fps, 30, 15);
        _setFpsRow(_hostEl, 'fps-worst', fps.worstFps, 20, 10);
    }
    const lt = _longTaskSummary();
    _setRow(_hostEl, 'lt-count', String(lt.count), 5, 15);
    _setRow(_hostEl, 'lt-max', _fmtMs(lt.maxMs), 100, 200);
    _setRow(_hostEl, 'lt-total', _fmtMs(lt.totalMs), 200, 500);

    const c = _lastSecondCounters;
    _setRow(_hostEl, 'c-gr', String(c['game.render'] ?? 0), 30, 55);
    _setRow(_hostEl, 'c-md', String(c['markDirty'] ?? 0), 30, 55);
    _setRow(_hostEl, 'c-rc', String(c['renderer.clear'] ?? 0), 30, 55);
    _setRow(_hostEl, 'c-amb', String(c['renderer.renderAmbientFxFrame'] ?? 0), 5, 20);
    _setRow(_hostEl, 'c-wm', String(c['renderer._renderBoardWatermark'] ?? 0), 5, 20);

    const ls = _layerSuspectStats();
    if (ls) {
        _setRow(_hostEl, 'l-dom', String(ls.domNodes), 1000, 2500);
        _setRow(_hostEl, 'l-canvas', String(ls.canvasCount), 4, 8);
        _setRow(_hostEl, 'l-promo', String(ls.promoters), 20, 60);
        _setRow(_hostEl, 'l-shadow', String(ls.bigShadows), 20, 60);
        _setRow(_hostEl, 'l-bdf', String(ls.backdropFilters), 1, 4);
        _setRow(_hostEl, 'l-wc', String(ls.willChangeNotAuto), 4, 10);
    }
}

/** 取一份当前指标快照，便于在 DevTools 控制台导出做事后对比。 */
function snapshot() {
    return {
        ts: Date.now(),
        fps: _fpsStats(),
        longtask: _longTaskSummary(),
        countersPerSec: { ..._lastSecondCounters },
        layers: _layerSuspectStats(),
    };
}

/** v1.55.13：一键打印当前 GPU 相关状态（ambient / fxCanvas / 合成层启发式）
 * 不需要开 HUD 也能在 console 跑 `window.__perfOverlay.diagnoseGpu()`。 */
function diagnoseGpu() {
    if (typeof window === 'undefined') return null;
    const ambient = window.__ambientParticles;
    const ambientInfo = ambient?.getDebugInfo?.() || { note: 'ambientParticles not found' };
    const fxCanvas = document.getElementById('game-grid-fx');
    const fxStyle = fxCanvas ? getComputedStyle(fxCanvas) : null;
    const ambientHost = document.querySelector('.ambient-particles-host');
    const ambientHostStyle = ambientHost ? getComputedStyle(ambientHost) : null;
    const particles = ambientHost ? ambientHost.querySelectorAll('.ambient-particle') : [];
    const result = {
        ambient: ambientInfo,
        fxCanvas: fxCanvas ? {
            display: fxStyle?.display,
            visibility: fxStyle?.visibility,
            opacity: fxStyle?.opacity,
            width: fxCanvas.width,
            height: fxCanvas.height,
            cssWidth: fxStyle?.width,
            cssHeight: fxStyle?.height,
        } : null,
        ambientHost: ambientHost ? {
            display: ambientHostStyle?.display,
            visibility: ambientHostStyle?.visibility,
            particleCount: particles.length,
            firstParticleTransform: particles[0]?.style?.transform || null,
        } : { note: 'ambient-particles-host not found' },
        suspectLayers: _layerSuspectStats(),
        dpr: window.devicePixelRatio || 1,
        viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    log.log('[perfOverlay] GPU diagnosis:', result);
    log.log(JSON.stringify(result, null, 2));
    return result;
}

/** 录一段固定时长（默认 10s），结束后在 console 打表，便于 A/B 比较。
 * 同时把结果挂到 window.__perfOverlay._lastProfile，方便复制粘贴。
 *
 * 返回 GPU 基线友好的结构：每秒平均的 counter、整个录制窗口里的聚合 fps/longtask、
 * 一次性的 layer 估计——三类指标已覆盖一份"前端渲染基线"的最小集。 */
async function startProfile(secs = 10) {
    const t0 = performance.now();
    const startLongTaskCount = _longTasks.length;
    const fpsStartLen = _fpsBuffer.length;
    /* 取 startProfile 调用瞬间的"上一秒"计数器作为起点；窗口里的 perSec 计数会自动累计。 */
    const accumulated = Object.create(null);
    const onSec = window.setInterval(() => {
        for (const k of Object.keys(_lastSecondCounters)) {
            accumulated[k] = (accumulated[k] || 0) + _lastSecondCounters[k];
        }
    }, 1000);
    await new Promise((resolve) => setTimeout(resolve, secs * 1000));
    clearInterval(onSec);
    const elapsedSec = (performance.now() - t0) / 1000;
    const fps = _fpsStats();
    const longtaskInWindow = _longTasks.length - startLongTaskCount;
    /* 重算 longtask 聚合，仅对窗口内的样本 */
    let ltTotal = 0, ltMax = 0;
    for (let i = startLongTaskCount; i < _longTasks.length; i++) {
        const t = _longTasks[i];
        ltTotal += t.duration;
        if (t.duration > ltMax) ltMax = t.duration;
    }
    /* fps 取 startProfile 开始之后流入的样本（按 _fpsBuffer 起点偏移） */
    const fpsWindow = _fpsBuffer.slice(fpsStartLen);
    let fpsAgg = null;
    if (fpsWindow.length >= 2) {
        const sorted = fpsWindow.slice().sort((a, b) => a - b);
        const sum = fpsWindow.reduce((s, v) => s + v, 0);
        fpsAgg = {
            meanFps: 1000 / (sum / fpsWindow.length),
            p50Fps: 1000 / sorted[Math.floor(sorted.length * 0.5)],
            p95Fps: 1000 / sorted[Math.floor(sorted.length * 0.95)],
            worstFps: 1000 / sorted[sorted.length - 1],
            samples: fpsWindow.length,
        };
    }
    const result = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        durationSec: elapsedSec,
        fpsWindow: fpsAgg,
        fpsAllTime: fps,
        longtask: { countInWindow: longtaskInWindow, totalMs: ltTotal, maxMs: ltMax },
        countersTotal: { ...accumulated },
        layers: _layerSuspectStats(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null,
        viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : null,
    };
    if (typeof window !== 'undefined' && window.__perfOverlay) {
        window.__perfOverlay._lastProfile = result;
    }
    log.log('[perfOverlay] profile DONE', result);
    log.log('[perfOverlay] copy as JSON:\n' + JSON.stringify(result, null, 2));
    return result;
}

export function openPerfOverlay() {
    if (_open || typeof window === 'undefined') return;
    _open = true;
    _hostEl = _buildHost();
    _startFpsLoop();
    _startLongTaskObserver();
    _flushCountersEverySec();
    _instrumentGame();
    if (_renderTimer) clearInterval(_renderTimer);
    /* 文本更新 2Hz：足以看趋势，且 HUD 自己不会成为 GPU 持续热点。 */
    _renderTimer = window.setInterval(_renderTickPaint, 500);
    _renderTickPaint();
    log.info('[perfOverlay] opened — call window.__perfOverlay.startProfile(10) to record 10s.');
}

export function closePerfOverlay() {
    if (!_open) return;
    _open = false;
    if (_renderTimer) {
        clearInterval(_renderTimer);
        _renderTimer = 0;
    }
    _stopFpsLoop();
    _stopLongTaskObserver();
    _stopCounterFlush();
    _unInstrumentGame();
    if (_hostEl?.parentNode) _hostEl.parentNode.removeChild(_hostEl);
    _hostEl = null;
}

export function togglePerfOverlay() {
    if (_open) closePerfOverlay();
    else openPerfOverlay();
}

export function initPerfOverlay({ autoOpen = false } = {}) {
    if (typeof window === 'undefined') return;
    /* 仅注册 Alt+P 快捷键 + 暴露全局命名空间，避免任何隐式启动。 */
    if (window.__perfOverlay?.__installed) return;

    window.__perfOverlay = {
        open: openPerfOverlay,
        close: closePerfOverlay,
        toggle: togglePerfOverlay,
        snapshot,
        startProfile,
        diagnoseGpu,
        __installed: true,
    };

    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.code === 'KeyP' || e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            togglePerfOverlay();
        }
    }, false);

    if (autoOpen) openPerfOverlay();
}

export const __test_only__ = {
    bumpPerfCounter,
    snapshot,
    _resetForTest: () => {
        closePerfOverlay();
        for (const k of Object.keys(_counters)) delete _counters[k];
        for (const k of Object.keys(_lastSecondCounters)) delete _lastSecondCounters[k];
    },
};
