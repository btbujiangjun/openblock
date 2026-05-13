/**
 * insightMetricModal.js — 玩家洞察面板「指标详读」浮层
 *
 * 触发：点击实时状态/回放面板上任一指标行 → 弹出全屏遮罩 + 居中卡片，
 * 内含：
 *   1) 放大版折线图（独立 SVG，比 sparkline 大 ~6x），带坐标轴 / 0 基线 / 当前游标
 *   2) hover 时根据鼠标 X 反查最近帧 → 顶部 readout 显示 "帧 i / 总 N · 值 v · 占比 p%"
 *   3) 物理含义说明（来自 REPLAY_METRICS.tooltip 的"📈 看图"之前部分）
 *   4) 曲线分析（"📈 看图"之后的部分；若 tooltip 里没分隔符则全部归到含义）
 *   5) 摘要：min / max / avg / last / 帧数
 *
 * 关闭：点击遮罩 / 关闭按钮 / Esc / 再次调用 openInsightMetricModal 自动替换
 *
 * 设计原则
 * --------
 *   - **零依赖 + 可单独单测**：仅 DOM；样式由 main.css 与本文件全局 stylesheet 注入
 *   - **可重入**：同一指标重复点击会复用并刷新数据，不留遗孤 DOM
 *   - **可降级**：无 document 时静默返回（SSR/test 兜底）
 *   - **不打断 game loop**：modal 仅消费"打开瞬间"的数据快照；live 数据继续在背后刷新
 *     用户关闭后再次点击会拿到最新快照
 */

const _SVG_NS = 'http://www.w3.org/2000/svg';

const PLOT_W = 720;
const PLOT_H = 220;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 18;
const PAD_B = 30;

let _state = {
    overlay: null,
    onKey: null,
    onResize: null,
    config: null,
};

function _formatValue(value, fmt) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    switch (fmt) {
        case 'pct': return Math.round(n * 100) + '%';
        case 'int': return String(Math.round(n));
        case 'f2':  return n.toFixed(2);
        case 'f3':  return (n >= 0 ? '+' : '') + n.toFixed(3);
        default:    return Number.isInteger(n) ? String(n) : n.toFixed(2);
    }
}

/**
 * 把 REPLAY_METRICS.tooltip 拆为「物理含义」「曲线分析」两段。
 * 约定 tooltip 内 "\n📈 看图：" 之前是含义、之后是分析；若没有分隔则全部当含义。
 */
export function splitTooltipForModal(tooltip) {
    const t = String(tooltip || '').trim();
    if (!t) return { meaning: '', analysis: '' };
    const idx = t.indexOf('📈');
    if (idx < 0) return { meaning: t, analysis: '' };
    const meaning = t.slice(0, idx).trim();
    let analysis = t.slice(idx).trim();
    // 去掉前缀的 "📈 看图：" 或 "📈" 装饰，让正文更干净
    analysis = analysis.replace(/^📈\s*看图[：:]\s*/, '').replace(/^📈\s*/, '');
    return { meaning, analysis };
}

/**
 * 计算曲线统计摘要。
 */
export function summarizePoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return { count: 0, min: null, max: null, avg: null, last: null };
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const p of points) {
        const v = Number(p.value);
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    return {
        count: points.length,
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
        avg: points.length > 0 ? sum / points.length : null,
        last: Number(points[points.length - 1].value),
    };
}

/**
 * 在 points 中按帧 idx 找最近的样本。
 */
export function nearestPointByIdx(points, targetIdx) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let best = points[0];
    let bestDist = Math.abs(points[0].idx - targetIdx);
    for (let i = 1; i < points.length; i++) {
        const d = Math.abs(points[i].idx - targetIdx);
        if (d < bestDist) {
            best = points[i];
            bestDist = d;
        }
    }
    return best;
}

function _setText(el, text) {
    if (!el) return;
    el.textContent = String(text);
}

function _renderPlot(svg, points, totalFrames, color) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const innerW = PLOT_W - PAD_L - PAD_R;
    const innerH = PLOT_H - PAD_T - PAD_B;
    const maxIdx = Math.max(totalFrames - 1, 1);

    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        lo = 0;
        hi = 1;
    }
    if (hi - lo < 1e-9) {
        // 防止压成一根线
        const c = (hi + lo) / 2;
        lo = c - 0.5;
        hi = c + 0.5;
    }
    const range = hi - lo;
    const toX = (idx) => PAD_L + (idx / maxIdx) * innerW;
    const toY = (val) => PAD_T + innerH - ((val - lo) / range) * innerH;

    // 网格 4 横 + 4 纵
    const gridGroup = document.createElementNS(_SVG_NS, 'g');
    gridGroup.setAttribute('class', 'imm-grid');
    for (let i = 0; i <= 4; i++) {
        const y = PAD_T + (innerH * i) / 4;
        const line = document.createElementNS(_SVG_NS, 'line');
        line.setAttribute('x1', String(PAD_L));
        line.setAttribute('x2', String(PAD_L + innerW));
        line.setAttribute('y1', y.toFixed(1));
        line.setAttribute('y2', y.toFixed(1));
        gridGroup.appendChild(line);
        // y 轴刻度
        const v = hi - (range * i) / 4;
        const label = document.createElementNS(_SVG_NS, 'text');
        label.setAttribute('class', 'imm-axis-label imm-axis-label--y');
        label.setAttribute('x', String(PAD_L - 6));
        label.setAttribute('y', (y + 4).toFixed(1));
        label.setAttribute('text-anchor', 'end');
        label.textContent = _formatValue(v, '');
        gridGroup.appendChild(label);
    }
    for (let i = 0; i <= 4; i++) {
        const x = PAD_L + (innerW * i) / 4;
        const line = document.createElementNS(_SVG_NS, 'line');
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('x2', x.toFixed(1));
        line.setAttribute('y1', String(PAD_T));
        line.setAttribute('y2', String(PAD_T + innerH));
        gridGroup.appendChild(line);
        // x 轴刻度（帧序号）
        const fi = Math.round((maxIdx * i) / 4);
        const label = document.createElementNS(_SVG_NS, 'text');
        label.setAttribute('class', 'imm-axis-label imm-axis-label--x');
        label.setAttribute('x', x.toFixed(1));
        label.setAttribute('y', String(PAD_T + innerH + 16));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = '#' + fi;
        gridGroup.appendChild(label);
    }
    svg.appendChild(gridGroup);

    // 0 基线（仅当 0 落在 [lo, hi] 区间内时绘制）
    if (lo < 0 && hi > 0) {
        const zeroY = toY(0);
        const zero = document.createElementNS(_SVG_NS, 'line');
        zero.setAttribute('class', 'imm-zeroline');
        zero.setAttribute('x1', String(PAD_L));
        zero.setAttribute('x2', String(PAD_L + innerW));
        zero.setAttribute('y1', zeroY.toFixed(1));
        zero.setAttribute('y2', zeroY.toFixed(1));
        svg.appendChild(zero);
    }

    if (points.length === 0) return { toX, toY, lo, hi, maxIdx };

    // 填充
    const fill = document.createElementNS(_SVG_NS, 'path');
    const fillD =
        `M${toX(points[0].idx).toFixed(1)},${(PAD_T + innerH).toFixed(1)} ` +
        points.map((p) => `L${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
        ` L${toX(points[points.length - 1].idx).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;
    fill.setAttribute('d', fillD);
    fill.setAttribute('fill', color);
    fill.setAttribute('opacity', '0.14');
    svg.appendChild(fill);

    // 折线
    const poly = document.createElementNS(_SVG_NS, 'polyline');
    poly.setAttribute('points',
        points.map((p) => `${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')
    );
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', color);
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    svg.appendChild(poly);

    return { toX, toY, lo, hi, maxIdx };
}

function _attachHover(svg, points, totalFrames, color, fmt, readout) {
    const innerW = PLOT_W - PAD_L - PAD_R;
    const maxIdx = Math.max(totalFrames - 1, 1);

    // 游标层
    const cursorLine = document.createElementNS(_SVG_NS, 'line');
    cursorLine.setAttribute('class', 'imm-hover-cursor');
    cursorLine.setAttribute('y1', String(PAD_T));
    cursorLine.setAttribute('y2', String(PAD_T + (PLOT_H - PAD_T - PAD_B)));
    cursorLine.setAttribute('x1', '-100');
    cursorLine.setAttribute('x2', '-100');
    svg.appendChild(cursorLine);

    const dot = document.createElementNS(_SVG_NS, 'circle');
    dot.setAttribute('class', 'imm-hover-dot');
    dot.setAttribute('r', '4');
    dot.setAttribute('cx', '-100');
    dot.setAttribute('cy', '-100');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '1.5');
    svg.appendChild(dot);

    // 完全覆盖 plot 区域的透明矩形作为 hover 接收层（避免 SVG 各 path 的 hover 漏区）
    const hit = document.createElementNS(_SVG_NS, 'rect');
    hit.setAttribute('class', 'imm-hit');
    hit.setAttribute('x', String(PAD_L));
    hit.setAttribute('y', String(PAD_T));
    hit.setAttribute('width', String(innerW));
    hit.setAttribute('height', String(PLOT_H - PAD_T - PAD_B));
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    function _move(evt) {
        if (points.length === 0) return;
        const rect = svg.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const xRatio = (evt.clientX - rect.left) / rect.width; // 0~1
        const xView = xRatio * PLOT_W;                          // 反推到 viewBox
        const localX = Math.max(PAD_L, Math.min(PAD_L + innerW, xView));
        const idxFloat = ((localX - PAD_L) / innerW) * maxIdx;
        const target = nearestPointByIdx(points, idxFloat);
        if (!target) return;
        const cxView = PAD_L + (target.idx / maxIdx) * innerW;
        const innerH = PLOT_H - PAD_T - PAD_B;
        // 重新算 lo/hi —— 与 _renderPlot 保持一致
        let lo = Infinity, hi = -Infinity;
        for (const p of points) {
            if (p.value < lo) lo = p.value;
            if (p.value > hi) hi = p.value;
        }
        if (hi - lo < 1e-9) { const c = (hi + lo) / 2; lo = c - 0.5; hi = c + 0.5; }
        const cyView = PAD_T + innerH - ((target.value - lo) / (hi - lo)) * innerH;
        cursorLine.setAttribute('x1', cxView.toFixed(1));
        cursorLine.setAttribute('x2', cxView.toFixed(1));
        dot.setAttribute('cx', cxView.toFixed(1));
        dot.setAttribute('cy', cyView.toFixed(1));
        const pct = totalFrames > 0 ? Math.round((target.idx / Math.max(totalFrames - 1, 1)) * 100) : 0;
        readout.frame.textContent = `# ${target.idx + 1} / ${totalFrames}`;
        readout.value.textContent = _formatValue(target.value, fmt);
        readout.pct.textContent = `${pct}%`;
    }

    function _leave() {
        cursorLine.setAttribute('x1', '-100');
        cursorLine.setAttribute('x2', '-100');
        dot.setAttribute('cx', '-100');
        dot.setAttribute('cy', '-100');
    }

    hit.addEventListener('mousemove', _move);
    hit.addEventListener('mouseleave', _leave);
    return { _move, _leave, hit };
}

/**
 * 关闭当前浮层（若存在）。
 */
export function closeInsightMetricModal() {
    if (!_state.overlay) return;
    try { _state.overlay.remove(); } catch { /* ignore */ }
    if (_state.onKey && typeof document !== 'undefined') {
        document.removeEventListener('keydown', _state.onKey);
    }
    if (_state.onResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', _state.onResize);
    }
    _state = { overlay: null, onKey: null, onResize: null, config: null };
}

/**
 * 打开「指标详读」浮层。
 *
 * @param {object} cfg
 * @param {string} cfg.metricKey
 * @param {string} cfg.label
 * @param {string} [cfg.group]
 * @param {string} [cfg.fmt]
 * @param {string} cfg.color
 * @param {string} [cfg.tooltip]
 * @param {{ points: Array<{idx:number, value:number}>, totalFrames: number }} cfg.data
 * @param {number} [cfg.cursorIdx]   当前游标位置（默认最后一帧）
 * @returns {{ close: () => void } | null}
 */
export function openInsightMetricModal(cfg) {
    if (typeof document === 'undefined' || !cfg || !cfg.data) return null;

    closeInsightMetricModal();

    const { label, color, fmt = '', tooltip = '', data, metricKey } = cfg;
    const points = Array.isArray(data.points) ? data.points : [];
    const totalFrames = Math.max(0, Number(data.totalFrames) || 0);
    const { meaning, analysis } = splitTooltipForModal(tooltip);
    const summary = summarizePoints(points);

    const overlay = document.createElement('div');
    overlay.className = 'insight-metric-modal-backdrop';
    overlay.setAttribute('data-metric-key', String(metricKey || ''));
    // 信息布局（自上而下）：
    //   1. Header — 标题 / key / 关闭
    //   2. 物理含义 — 帮助玩家先建立"这是什么"的认知（先理解、再看图）
    //   3. 图表 — 居中主视觉；上方挂 readout（hover 时定位帧/值/进度）
    //   4. 曲线分析 — 紧贴图表下方，给"该如何读这条曲线"的解读
    //   5. 摘要数字 — min/max/avg/last/样本，放最后做收口
    overlay.innerHTML = `
        <div class="insight-metric-modal" role="dialog" aria-modal="true" aria-labelledby="imm-title">
            <header class="imm-head">
                <span class="imm-color-dot" style="background:${color}"></span>
                <h3 class="imm-title" id="imm-title">${_escape(label)}</h3>
                <span class="imm-key" title="指标 key（与 REPLAY_METRICS / ps 字段对应）">${_escape(metricKey || '')}</span>
                <button type="button" class="imm-close" aria-label="关闭">×</button>
            </header>
            <section class="imm-section imm-section--meaning">
                <h4 class="imm-section-title">物理含义</h4>
                <p class="imm-section-body">${_escape(meaning) || '<i class="imm-empty">该指标暂无含义说明。</i>'}</p>
            </section>
            <div class="imm-readout">
                <span class="imm-readout-cell">
                    <span class="imm-readout-tag">帧</span>
                    <span class="imm-readout-val" data-role="frame">—</span>
                </span>
                <span class="imm-readout-cell">
                    <span class="imm-readout-tag">值</span>
                    <span class="imm-readout-val" data-role="value">—</span>
                </span>
                <span class="imm-readout-cell">
                    <span class="imm-readout-tag">进度</span>
                    <span class="imm-readout-val" data-role="pct">—</span>
                </span>
                <span class="imm-readout-hint">将鼠标移到曲线上读取每一帧具体数值</span>
            </div>
            <div class="imm-plot-wrap">
                <svg class="imm-plot" viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" aria-label="${_escape(label)} 曲线"></svg>
            </div>
            <section class="imm-section imm-section--analysis">
                <h4 class="imm-section-title">曲线分析</h4>
                <p class="imm-section-body imm-section-body--analysis">${_escape(analysis) || '<i class="imm-empty">该指标暂无曲线分析。</i>'}</p>
            </section>
            <ul class="imm-summary">
                <li><span>min</span><b>${_escape(_formatValue(summary.min, fmt))}</b></li>
                <li><span>max</span><b>${_escape(_formatValue(summary.max, fmt))}</b></li>
                <li><span>avg</span><b>${_escape(_formatValue(summary.avg, fmt))}</b></li>
                <li><span>last</span><b>${_escape(_formatValue(summary.last, fmt))}</b></li>
                <li><span>样本</span><b>${summary.count} / ${totalFrames}</b></li>
            </ul>
        </div>
    `;
    document.body.appendChild(overlay);

    const svg = overlay.querySelector('.imm-plot');
    _renderPlot(svg, points, totalFrames, color);

    const readout = {
        frame: overlay.querySelector('[data-role="frame"]'),
        value: overlay.querySelector('[data-role="value"]'),
        pct:   overlay.querySelector('[data-role="pct"]'),
    };
    _attachHover(svg, points, totalFrames, color, fmt, readout);

    // 默认 readout 显示当前游标（默认 last）
    const initialIdx = Number.isFinite(Number(cfg.cursorIdx))
        ? Math.max(0, Math.min(totalFrames - 1, Number(cfg.cursorIdx)))
        : (totalFrames - 1);
    const initialPoint = nearestPointByIdx(points, initialIdx);
    if (initialPoint) {
        const pct = totalFrames > 0 ? Math.round((initialPoint.idx / Math.max(totalFrames - 1, 1)) * 100) : 0;
        _setText(readout.frame, `# ${initialPoint.idx + 1} / ${totalFrames}`);
        _setText(readout.value, _formatValue(initialPoint.value, fmt));
        _setText(readout.pct, `${pct}%`);
    }

    // 关闭事件
    const close = () => closeInsightMetricModal();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.imm-close')?.addEventListener('click', close);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    _state = { overlay, onKey, onResize: null, config: cfg };
    _injectStyles();

    return { close };
}

function _escape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 注入一次轻量样式（结构与色值；细节排版由 main.css 接管）。
 * main.css 没加载时（如单测）依然能看到正常结构；与 main.css 同名 class 由后者覆盖更精细的视觉。
 */
function _injectStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById('insight-metric-modal-fallback-styles')) return;
    const style = document.createElement('style');
    style.id = 'insight-metric-modal-fallback-styles';
    style.textContent = `
        .insight-metric-modal-backdrop {
            position: fixed; inset: 0; z-index: 9000;
            background: rgba(8, 12, 22, 0.62);
            backdrop-filter: blur(2px);
            display: flex; align-items: center; justify-content: center;
            padding: 24px;
        }
        .insight-metric-modal {
            width: min(820px, 96vw);
            max-height: 92vh; overflow-y: auto;
            background: var(--surface-elevated, #161b25);
            color: var(--text-primary, #e2e8f0);
            border-radius: 14px;
            box-shadow: 0 24px 64px rgba(0,0,0,0.42);
            padding: 18px 22px 20px;
            border: 1px solid color-mix(in srgb, var(--text-primary, #e2e8f0) 8%, transparent);
        }
        .imm-head {
            display: flex; align-items: center; gap: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid color-mix(in srgb, var(--text-primary, #e2e8f0) 10%, transparent);
        }
        .imm-color-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; box-shadow: 0 0 8px currentColor; }
        .imm-title { font-size: 18px; margin: 0; font-weight: 800; flex: 1; }
        .imm-key {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-size: 11px; opacity: 0.55;
            padding: 2px 6px; border-radius: 4px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 8%, transparent);
        }
        .imm-close {
            background: transparent; color: inherit; border: 0;
            font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
            opacity: 0.7;
        }
        .imm-close:hover { opacity: 1; }
        .imm-readout {
            display: flex; align-items: baseline; flex-wrap: wrap; gap: 14px;
            font-size: 12px; padding: 10px 0 6px;
        }
        .imm-readout-cell { display: inline-flex; align-items: baseline; gap: 4px; }
        .imm-readout-tag { opacity: 0.55; font-weight: 600; }
        .imm-readout-val {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
        }
        .imm-readout-hint { opacity: 0.45; font-size: 11px; margin-left: auto; }
        .imm-plot-wrap {
            position: relative; width: 100%;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 4%, transparent);
            border-radius: 8px; padding: 6px;
        }
        .imm-plot { display: block; width: 100%; height: auto; }
        .imm-grid line { stroke: color-mix(in srgb, currentColor 14%, transparent); stroke-width: 0.7; }
        .imm-axis-label {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-size: 10px;
            fill: color-mix(in srgb, currentColor 55%, transparent);
        }
        .imm-zeroline { stroke: color-mix(in srgb, currentColor 36%, transparent); stroke-width: 1; stroke-dasharray: 3 3; }
        .imm-hover-cursor { stroke: var(--replay-cursor, #e74c3c); stroke-width: 1.2; opacity: 0.85; }
        .imm-hit { cursor: crosshair; }
        .imm-summary {
            list-style: none; padding: 0; margin: 12px 0 4px;
            display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
            font-size: 12px;
        }
        .imm-summary li {
            display: flex; flex-direction: column; align-items: center; gap: 2px;
            padding: 6px 4px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 5%, transparent);
            border-radius: 6px;
        }
        .imm-summary li > span { opacity: 0.55; font-size: 10px; }
        .imm-summary li > b {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-variant-numeric: tabular-nums;
            font-weight: 700; font-size: 13px;
        }
        .imm-section { margin-top: 14px; }
        .imm-section-title {
            font-size: 12px; font-weight: 700; opacity: 0.85;
            margin: 0 0 6px; padding-bottom: 4px;
            border-bottom: 1px dashed color-mix(in srgb, var(--text-primary, #e2e8f0) 18%, transparent);
        }
        .imm-section-body {
            font-size: 13px; line-height: 1.65; margin: 0; white-space: pre-wrap;
        }
        .imm-section-body--analysis { opacity: 0.92; }
        .imm-empty { opacity: 0.45; font-style: normal; }
        @media (max-width: 540px) {
            .insight-metric-modal { padding: 14px; }
            .imm-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .imm-readout-hint { display: none; }
        }
    `;
    document.head.appendChild(style);
}

export const __test_only__ = {
    PLOT_W,
    PLOT_H,
    PAD_L,
    PAD_R,
    PAD_T,
    PAD_B,
    _formatValue,
    _renderPlot,
    _state: () => _state,
};
