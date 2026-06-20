/**
 * insightMetricModal.js — 玩家洞察面板「指标详读」浮层
 *
 * 触发：点击实时状态/回放面板上任一指标行 → 弹出全屏遮罩 + 居中卡片，
 * 内含：
 *   1) 放大版折线图（独立 SVG，比 sparkline 大 ~6x），带坐标轴 / 0 基线 / 当前游标
 *   2) hover 时根据鼠标 X 反查最近帧 → 顶部 readout 显示 "帧 i / 总 N · 值 v · 时长"
 *   3) 物理含义说明（来自 REPLAY_METRICS.tooltip 的"📈 看图"之前部分）
 *   4) 曲线分析（"📈 看图"之后的部分；若 tooltip 里没分隔符则全部归到含义）
 *   5) 摘要：min / max / avg / last / 帧数
 *
 * v1.61 新增：
 *   - 头部工具栏「副坐标」下拉，可从面板其他指标里选一项作为对比曲线，
 *     双 Y 轴叠加显示（主左 / 副右），readout 同步显示两条值。
 *   - X 轴默认改为「游戏开始的时长」（mm:ss），让玩家直观看到操作节奏；
 *     回放/无时间戳时自动回退到帧序号。
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

import { describeMetricLineage } from './audit/metricRelationships.js';

const _SVG_NS = 'http://www.w3.org/2000/svg';

const PLOT_W = 720;
const PLOT_H = 220;
const PAD_L = 56;
/* v1.61：副坐标启用时右侧需要留出额外刻度宽度（与左 Y 轴对称感）；
 * 没有副坐标时使用窄 PAD_R 以保留早期版本一致的曲线宽度。 */
const PAD_R_SINGLE = 24;
const PAD_R_DUAL = 56;
const PAD_T = 18;
const PAD_B = 30;

let _state = {
    overlay: null,
    onKey: null,
    onResize: null,
    config: null,
    /** 当前选中的副指标 key（''/null 表示不启用） */
    secondaryKey: null,
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
 * 把毫秒偏移格式化为 `mm:ss` / `h:mm:ss`（h>0 时）。
 * - 99:59 以内 → `mm:ss`
 * - 1 小时以上 → `h:mm:ss`
 * - 非有限/负数 → '—'
 *
 * 例：0 → '0:00'、 12_000 → '0:12'、 95_000 → '1:35'、 3_725_000 → '1:02:05'
 *
 * @param {number|null|undefined} ms 相对游戏开始的毫秒偏移
 * @returns {string}
 */
export function formatElapsedMs(ms) {
    if (ms == null) return '—';
    const v = Number(ms);
    if (!Number.isFinite(v) || v < 0) return '—';
    const totalSec = Math.floor(v / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
        const mm = String(m).padStart(2, '0');
        return `${h}:${mm}:${ss}`;
    }
    return `${m}:${ss}`;
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

/**
 * 计算 points 的 [lo, hi] 区间（带 1e-9 抗压平兜底）。
 */
function _computeRange(points) {
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
        const c = (hi + lo) / 2;
        lo = c - 0.5;
        hi = c + 0.5;
    }
    return { lo, hi };
}

/**
 * 渲染主图：含网格、轴标签、主曲线，可选副曲线。
 *
 * @param {SVGElement} svg
 * @param {Array<{idx:number,value:number}>} primaryPoints
 * @param {number} totalFrames
 * @param {string} primaryColor
 * @param {object} [opts]
 * @param {Array<{idx:number,value:number}>} [opts.secondaryPoints]
 * @param {string} [opts.secondaryColor]
 * @param {string} [opts.secondaryFmt]
 * @param {string} [opts.primaryFmt]
 * @param {Array<number|null>} [opts.frameTimestamps]  每帧距游戏开始 ms；启用时长 X 轴
 */
function _renderPlot(svg, primaryPoints, totalFrames, primaryColor, opts = {}) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const secondaryPoints = Array.isArray(opts.secondaryPoints) ? opts.secondaryPoints : null;
    const hasSecondary = !!(secondaryPoints && secondaryPoints.length > 0);
    const padR = hasSecondary ? PAD_R_DUAL : PAD_R_SINGLE;
    const innerW = PLOT_W - PAD_L - padR;
    const innerH = PLOT_H - PAD_T - PAD_B;
    const maxIdx = Math.max(totalFrames - 1, 1);

    const { lo: loP, hi: hiP } = _computeRange(primaryPoints);
    const rangeP = hiP - loP;
    const toX = (idx) => PAD_L + (idx / maxIdx) * innerW;
    const toY = (val) => PAD_T + innerH - ((val - loP) / rangeP) * innerH;

    let loS = 0;
    let hiS = 1;
    let rangeS = 1;
    let toYSecondary = null;
    if (hasSecondary) {
        const sr = _computeRange(secondaryPoints);
        loS = sr.lo;
        hiS = sr.hi;
        rangeS = hiS - loS;
        toYSecondary = (val) => PAD_T + innerH - ((val - loS) / rangeS) * innerH;
    }

    /* X 轴时长模式启用条件：frameTimestamps 长度对得上、且至少前后两端都有有效 ms。 */
    const fts = Array.isArray(opts.frameTimestamps) ? opts.frameTimestamps : null;
    const xUseTime =
        fts != null &&
        fts.length >= 2 &&
        Number.isFinite(fts[0]) &&
        Number.isFinite(fts[fts.length - 1]) &&
        fts[fts.length - 1] > fts[0];

    // 网格 4 横 + 4 纵 + 双侧 Y 刻度
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
        // 主指标 Y 刻度
        const vP = hiP - (rangeP * i) / 4;
        const labelP = document.createElementNS(_SVG_NS, 'text');
        labelP.setAttribute('class', 'imm-axis-label imm-axis-label--y imm-axis-label--y-primary');
        labelP.setAttribute('x', String(PAD_L - 6));
        labelP.setAttribute('y', (y + 4).toFixed(1));
        labelP.setAttribute('text-anchor', 'end');
        labelP.setAttribute('fill', primaryColor);
        labelP.textContent = _formatValue(vP, opts.primaryFmt || '');
        gridGroup.appendChild(labelP);
        // 副指标 Y 刻度
        if (hasSecondary) {
            const vS = hiS - (rangeS * i) / 4;
            const labelS = document.createElementNS(_SVG_NS, 'text');
            labelS.setAttribute('class', 'imm-axis-label imm-axis-label--y imm-axis-label--y-secondary');
            labelS.setAttribute('x', String(PAD_L + innerW + 6));
            labelS.setAttribute('y', (y + 4).toFixed(1));
            labelS.setAttribute('text-anchor', 'start');
            labelS.setAttribute('fill', opts.secondaryColor || '#94a3b8');
            labelS.textContent = _formatValue(vS, opts.secondaryFmt || '');
            gridGroup.appendChild(labelS);
        }
    }
    for (let i = 0; i <= 4; i++) {
        const x = PAD_L + (innerW * i) / 4;
        const line = document.createElementNS(_SVG_NS, 'line');
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('x2', x.toFixed(1));
        line.setAttribute('y1', String(PAD_T));
        line.setAttribute('y2', String(PAD_T + innerH));
        gridGroup.appendChild(line);
        // X 轴刻度：时长（默认）/ 帧序号（回退）
        const fi = Math.round((maxIdx * i) / 4);
        const label = document.createElementNS(_SVG_NS, 'text');
        label.setAttribute('class', 'imm-axis-label imm-axis-label--x');
        label.setAttribute('x', x.toFixed(1));
        label.setAttribute('y', String(PAD_T + innerH + 16));
        label.setAttribute('text-anchor', 'middle');
        if (xUseTime) {
            const tms = fts[fi];
            label.textContent = Number.isFinite(tms) ? formatElapsedMs(tms) : '—';
        } else {
            label.textContent = '#' + fi;
        }
        gridGroup.appendChild(label);
    }
    svg.appendChild(gridGroup);

    // 0 基线（仅当 0 落在 [lo, hi] 区间内时绘制；只画主指标的 0 线）
    if (loP < 0 && hiP > 0) {
        const zeroY = toY(0);
        const zero = document.createElementNS(_SVG_NS, 'line');
        zero.setAttribute('class', 'imm-zeroline');
        zero.setAttribute('x1', String(PAD_L));
        zero.setAttribute('x2', String(PAD_L + innerW));
        zero.setAttribute('y1', zeroY.toFixed(1));
        zero.setAttribute('y2', zeroY.toFixed(1));
        svg.appendChild(zero);
    }

    if (primaryPoints.length === 0) {
        return { toX, toY, toYSecondary, loP, hiP, loS, hiS, maxIdx, padR, hasSecondary };
    }

    // 主指标填充
    const fill = document.createElementNS(_SVG_NS, 'path');
    const fillD =
        `M${toX(primaryPoints[0].idx).toFixed(1)},${(PAD_T + innerH).toFixed(1)} ` +
        primaryPoints.map((p) => `L${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
        ` L${toX(primaryPoints[primaryPoints.length - 1].idx).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;
    fill.setAttribute('d', fillD);
    fill.setAttribute('fill', primaryColor);
    fill.setAttribute('opacity', '0.14');
    fill.setAttribute('class', 'imm-fill imm-fill--primary');
    svg.appendChild(fill);

    // 主折线
    const poly = document.createElementNS(_SVG_NS, 'polyline');
    poly.setAttribute('class', 'imm-line imm-line--primary');
    poly.setAttribute('points',
        primaryPoints.map((p) => `${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')
    );
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', primaryColor);
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    svg.appendChild(poly);

    // 副折线（虚线 + 独立 Y 缩放，不画填充）
    if (hasSecondary && toYSecondary) {
        const polyS = document.createElementNS(_SVG_NS, 'polyline');
        polyS.setAttribute('class', 'imm-line imm-line--secondary');
        polyS.setAttribute('points',
            secondaryPoints.map((p) => `${toX(p.idx).toFixed(1)},${toYSecondary(p.value).toFixed(1)}`).join(' ')
        );
        polyS.setAttribute('fill', 'none');
        polyS.setAttribute('stroke', opts.secondaryColor || '#94a3b8');
        polyS.setAttribute('stroke-width', '1.8');
        polyS.setAttribute('stroke-linejoin', 'round');
        polyS.setAttribute('stroke-linecap', 'round');
        polyS.setAttribute('stroke-dasharray', '5 3');
        polyS.setAttribute('opacity', '0.92');
        svg.appendChild(polyS);
    }

    return { toX, toY, toYSecondary, loP, hiP, loS, hiS, maxIdx, padR, hasSecondary };
}

/**
 * 给图表挂 hover 行为：根据鼠标 X 反查最近主点，更新游标 + readout。
 * 副曲线启用时同步显示副点和副点 dot。
 *
 * @param {SVGElement} svg
 * @param {object} renderInfo  _renderPlot 的返回值
 * @param {Array<{idx:number,value:number}>} primaryPoints
 * @param {object} opts
 * @param {number} opts.totalFrames
 * @param {string} opts.primaryColor
 * @param {string} opts.primaryFmt
 * @param {Array<{idx:number,value:number}>|null} opts.secondaryPoints
 * @param {string|null} opts.secondaryColor
 * @param {string} opts.secondaryFmt
 * @param {Array<number|null>|null} opts.frameTimestamps
 * @param {object} readout  各 data-role 字段引用
 */
function _attachHover(svg, renderInfo, primaryPoints, opts, readout) {
    const { padR, hasSecondary } = renderInfo;
    const innerW = PLOT_W - PAD_L - padR;
    const maxIdx = Math.max(opts.totalFrames - 1, 1);

    // 游标层
    const cursorLine = document.createElementNS(_SVG_NS, 'line');
    cursorLine.setAttribute('class', 'imm-hover-cursor');
    cursorLine.setAttribute('y1', String(PAD_T));
    cursorLine.setAttribute('y2', String(PAD_T + (PLOT_H - PAD_T - PAD_B)));
    cursorLine.setAttribute('x1', '-100');
    cursorLine.setAttribute('x2', '-100');
    svg.appendChild(cursorLine);

    const dotPrimary = document.createElementNS(_SVG_NS, 'circle');
    dotPrimary.setAttribute('class', 'imm-hover-dot imm-hover-dot--primary');
    dotPrimary.setAttribute('r', '4');
    dotPrimary.setAttribute('cx', '-100');
    dotPrimary.setAttribute('cy', '-100');
    dotPrimary.setAttribute('fill', opts.primaryColor);
    dotPrimary.setAttribute('stroke', '#fff');
    dotPrimary.setAttribute('stroke-width', '1.5');
    svg.appendChild(dotPrimary);

    let dotSecondary = null;
    if (hasSecondary) {
        dotSecondary = document.createElementNS(_SVG_NS, 'circle');
        dotSecondary.setAttribute('class', 'imm-hover-dot imm-hover-dot--secondary');
        dotSecondary.setAttribute('r', '3.5');
        dotSecondary.setAttribute('cx', '-100');
        dotSecondary.setAttribute('cy', '-100');
        dotSecondary.setAttribute('fill', opts.secondaryColor || '#94a3b8');
        dotSecondary.setAttribute('stroke', '#fff');
        dotSecondary.setAttribute('stroke-width', '1.2');
        svg.appendChild(dotSecondary);
    }

    // 完全覆盖 plot 区域的透明矩形作为 hover 接收层
    const hit = document.createElementNS(_SVG_NS, 'rect');
    hit.setAttribute('class', 'imm-hit');
    hit.setAttribute('x', String(PAD_L));
    hit.setAttribute('y', String(PAD_T));
    hit.setAttribute('width', String(innerW));
    hit.setAttribute('height', String(PLOT_H - PAD_T - PAD_B));
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    function _renderReadoutAt(target) {
        if (!target) return;
        const cxView = PAD_L + (target.idx / maxIdx) * innerW;
        const innerH = PLOT_H - PAD_T - PAD_B;
        const { lo: loP, hi: hiP } = _computeRange(primaryPoints);
        const rangeP = hiP - loP;
        const cyView = PAD_T + innerH - ((target.value - loP) / rangeP) * innerH;
        cursorLine.setAttribute('x1', cxView.toFixed(1));
        cursorLine.setAttribute('x2', cxView.toFixed(1));
        dotPrimary.setAttribute('cx', cxView.toFixed(1));
        dotPrimary.setAttribute('cy', cyView.toFixed(1));

        const pct = opts.totalFrames > 0
            ? Math.round((target.idx / Math.max(opts.totalFrames - 1, 1)) * 100)
            : 0;
        if (readout.frame) readout.frame.textContent = `# ${target.idx + 1} / ${opts.totalFrames}`;
        if (readout.value) readout.value.textContent = _formatValue(target.value, opts.primaryFmt);
        if (readout.pct) readout.pct.textContent = `${pct}%`;
        if (readout.time) {
            const tms = opts.frameTimestamps?.[target.idx];
            readout.time.textContent = Number.isFinite(tms) ? formatElapsedMs(tms) : '—';
        }

        if (hasSecondary && dotSecondary && opts.secondaryPoints?.length > 0) {
            const s = nearestPointByIdx(opts.secondaryPoints, target.idx);
            if (s) {
                const sr = _computeRange(opts.secondaryPoints);
                const cyS = PAD_T + innerH - ((s.value - sr.lo) / (sr.hi - sr.lo)) * innerH;
                const cxS = PAD_L + (s.idx / maxIdx) * innerW;
                dotSecondary.setAttribute('cx', cxS.toFixed(1));
                dotSecondary.setAttribute('cy', cyS.toFixed(1));
                if (readout.valueSecondary) {
                    readout.valueSecondary.textContent = _formatValue(s.value, opts.secondaryFmt);
                }
            } else if (readout.valueSecondary) {
                readout.valueSecondary.textContent = '—';
            }
        }
    }

    function _move(evt) {
        if (primaryPoints.length === 0) return;
        const rect = svg.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const xRatio = (evt.clientX - rect.left) / rect.width;
        const xView = xRatio * PLOT_W;
        const localX = Math.max(PAD_L, Math.min(PAD_L + innerW, xView));
        const idxFloat = ((localX - PAD_L) / innerW) * maxIdx;
        const target = nearestPointByIdx(primaryPoints, idxFloat);
        _renderReadoutAt(target);
    }

    function _leave() {
        cursorLine.setAttribute('x1', '-100');
        cursorLine.setAttribute('x2', '-100');
        dotPrimary.setAttribute('cx', '-100');
        dotPrimary.setAttribute('cy', '-100');
        if (dotSecondary) {
            dotSecondary.setAttribute('cx', '-100');
            dotSecondary.setAttribute('cy', '-100');
        }
    }

    hit.addEventListener('mousemove', _move);
    hit.addEventListener('mouseleave', _leave);
    return { _move, _leave, hit, _renderReadoutAt };
}

/**
 * 渲染「副坐标」下拉的 options HTML。
 *
 * - 传入 `secondaryGroups` 时按 `<optgroup label="title">` 分组渲染：
 *   组内严格按 `keys` 顺序、自动剔除主指标自身、跳过 allSeries 中缺失的 key、
 *   完全为空的组自动隐藏（不出现空 optgroup）。
 *   未被任一组覆盖的 candidate（脏数据 / 新增指标尚未挂分组）落入末尾"其它"组，
 *   保证下拉永远是 candidates 的超集，避免"漏掉一项无法选"。
 * - 不传时回退到平铺渲染（与 v1.61 初版一致，保持向后兼容）。
 *
 * @param {object} args
 * @param {Record<string, object>} args.allSeries
 * @param {Array<object>} args.secondaryCandidates  已剔除主指标的候选数组
 * @param {Array<{group:string,title:string,keys:string[]}>|null} args.secondaryGroups
 * @param {string} args.mainMetricKey
 * @returns {string}
 */
function _buildSecondaryOptionsHtml({ allSeries, secondaryCandidates, secondaryGroups, mainMetricKey }) {
    const _opt = (s) =>
        `<option value="${_escape(s.metricKey)}">${_escape(s.label)}</option>`;
    if (!Array.isArray(secondaryGroups) || secondaryGroups.length === 0) {
        return secondaryCandidates.map(_opt).join('');
    }
    const claimed = new Set();
    const parts = [];
    for (const g of secondaryGroups) {
        if (!g || !Array.isArray(g.keys)) continue;
        const optionsHtml = [];
        for (const k of g.keys) {
            if (!k || k === mainMetricKey) continue;
            const s = allSeries[k];
            if (!s) continue;
            optionsHtml.push(_opt(s));
            claimed.add(k);
        }
        if (optionsHtml.length === 0) continue;
        parts.push(`<optgroup label="${_escape(g.title || g.group || '')}">${optionsHtml.join('')}</optgroup>`);
    }
    // 兜底：未被任何 group 接管的候选 → 落入"其它"组，避免 UI 漏选
    const orphans = secondaryCandidates.filter((s) => !claimed.has(s.metricKey));
    if (orphans.length > 0) {
        parts.push(`<optgroup label="其它">${orphans.map(_opt).join('')}</optgroup>`);
    }
    return parts.join('');
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
    _state = { overlay: null, onKey: null, onResize: null, config: null, secondaryKey: null };
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
 * @param {Record<string,{metricKey:string,label:string,group:string,fmt:string,color:string,tooltip:string,points:Array<{idx:number,value:number}>}>} [cfg.allSeries]
 *        面板上全部指标的快照（含自身），用于副坐标下拉
 * @param {Array<{group:string,title:string,keys:string[]}>} [cfg.secondaryGroups]
 *        副坐标下拉的分组顺序。传入则下拉按 `<optgroup label="title">` 渲染，
 *        组内按 `keys` 顺序展开；不传时回退到 `allSeries` 平铺，保持向后兼容。
 * @param {Array<number|null>} [cfg.frameTimestamps]
 *        每帧相对游戏开始的毫秒偏移；启用时长 X 轴；缺失/全 null 时回退到帧序号
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

    /* 副坐标候选：剔除主指标自身；空集合时下拉直接隐藏。 */
    const allSeries = cfg.allSeries && typeof cfg.allSeries === 'object' ? cfg.allSeries : {};
    const secondaryCandidates = Object.values(allSeries)
        .filter((s) => s && s.metricKey && s.metricKey !== metricKey && Array.isArray(s.points));

    const frameTimestamps = Array.isArray(cfg.frameTimestamps) ? cfg.frameTimestamps : null;
    const xAxisModeLabel = (frameTimestamps && frameTimestamps.length >= 2
        && Number.isFinite(frameTimestamps[0])
        && Number.isFinite(frameTimestamps[frameTimestamps.length - 1]))
        ? '时长'
        : '帧';

    const overlay = document.createElement('div');
    overlay.className = 'insight-metric-modal-backdrop';
    overlay.setAttribute('data-metric-key', String(metricKey || ''));
    // 信息布局（自上而下）：
    //   1. Header — 标题 / key / 关闭
    //   2. 工具栏 — 副坐标下拉（v1.61 新增）
    //   3. 物理含义 — 帮助玩家先建立"这是什么"的认知（先理解、再看图）
    //   4. 图表 — 居中主视觉；上方挂 readout（hover 时定位帧/值/时长）
    //   5. 曲线分析 — 紧贴图表下方，给"该如何读这条曲线"的解读
    //   6. 摘要数字 — min/max/avg/last/样本，放最后做收口
    const secondaryOptions = _buildSecondaryOptionsHtml({
        allSeries,
        secondaryCandidates,
        secondaryGroups: Array.isArray(cfg.secondaryGroups) ? cfg.secondaryGroups : null,
        mainMetricKey: metricKey,
    });
    const toolbarHtml = secondaryCandidates.length > 0
        ? `<div class="imm-toolbar">
                <label class="imm-toolbar-row">
                    <span class="imm-toolbar-label">副坐标</span>
                    <select class="imm-secondary-select" data-role="secondary-select" aria-label="选择副指标做双坐标对比">
                        <option value="">（无）</option>
                        ${secondaryOptions}
                    </select>
                    <span class="imm-toolbar-hint">从面板其他指标里选一项做对比（右侧 Y 轴）</span>
                </label>
            </div>`
        : '';
    /* v1.62.5（优化建议 #2）：如果该指标在 metricRelationships 里登记了派生关系，
     * 显示一行 "📎 派生自 X" 小提示，让玩家/开发者知道这条指标不是独立的。 */
    const lineage = metricKey ? describeMetricLineage(metricKey) : null;
    const _lineageLabel = (rel) =>
        ({ fusion: '融合自', derived: '派生自', identity: '同源于', correlated: '强相关' }[rel] || rel);
    const lineageHtml = lineage ? `
        <div class="imm-lineage" title="${_escape(lineage.source || '')}">
            📎 <span class="imm-lineage-tag imm-lineage-tag--${lineage.relation}">${_lineageLabel(lineage.relation)}</span>
            <span class="imm-lineage-pair">${_escape(lineage.pair.filter((k) => k !== metricKey).join(', '))}</span>
            <span class="imm-lineage-desc">— ${_escape(lineage.description)}</span>
        </div>` : '';

    overlay.innerHTML = `
        <div class="insight-metric-modal" role="dialog" aria-modal="true" aria-labelledby="imm-title">
            <header class="imm-head">
                <span class="imm-color-dot" style="background:${color}"></span>
                <h3 class="imm-title" id="imm-title">${_escape(label)}</h3>
                <span class="imm-key" title="指标 key（与 REPLAY_METRICS / ps 字段对应）">${_escape(metricKey || '')}</span>
                <button type="button" class="imm-close" aria-label="关闭">×</button>
            </header>
            ${lineageHtml}
            ${toolbarHtml}
            <section class="imm-section imm-section--meaning">
                <h4 class="imm-section-title">物理含义</h4>
                <p class="imm-section-body">${_escape(meaning) || '<i class="imm-empty">该指标暂无含义说明。</i>'}</p>
                <div class="imm-section-aux" data-role="meaning-secondary" hidden></div>
            </section>
            <div class="imm-readout">
                <span class="imm-readout-cell" data-role="cell-frame">
                    <span class="imm-readout-tag">帧</span>
                    <span class="imm-readout-val" data-role="frame">—</span>
                </span>
                <span class="imm-readout-cell" data-role="cell-time">
                    <span class="imm-readout-tag">时长</span>
                    <span class="imm-readout-val" data-role="time">—</span>
                </span>
                <span class="imm-readout-cell" data-role="cell-value">
                    <span class="imm-readout-tag" style="color:${color}">值</span>
                    <span class="imm-readout-val" data-role="value">—</span>
                </span>
                <span class="imm-readout-cell imm-readout-cell--secondary" data-role="cell-secondary" hidden>
                    <span class="imm-readout-tag" data-role="secondary-tag">副值</span>
                    <span class="imm-readout-val" data-role="value-secondary">—</span>
                </span>
                <span class="imm-readout-cell">
                    <span class="imm-readout-tag">进度</span>
                    <span class="imm-readout-val" data-role="pct">—</span>
                </span>
                <span class="imm-readout-hint">${_escape('横坐标：' + xAxisModeLabel + '；鼠标移到曲线上读取每一帧')}</span>
            </div>
            <div class="imm-plot-wrap">
                <svg class="imm-plot" viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" aria-label="${_escape(label)} 曲线"></svg>
            </div>
            <section class="imm-section imm-section--analysis">
                <h4 class="imm-section-title">曲线分析</h4>
                <p class="imm-section-body imm-section-body--analysis">${_escape(analysis) || '<i class="imm-empty">该指标暂无曲线分析。</i>'}</p>
                <div class="imm-section-aux" data-role="analysis-secondary" hidden></div>
            </section>
            <div class="imm-summary-wrap">
                <div class="imm-summary-row imm-summary-row--primary" style="--imm-row-color:${color}">
                    <div class="imm-summary-row-head">
                        <span class="imm-summary-row-dot" style="background:${color}"></span>
                        <span class="imm-summary-row-label">${_escape(label)}</span>
                        <span class="imm-summary-row-key" title="主指标 key">${_escape(metricKey || '')}</span>
                        <span class="imm-summary-row-tag">主指标</span>
                    </div>
                    <ul class="imm-summary">
                        <li><span>min</span><b>${_escape(_formatValue(summary.min, fmt))}</b></li>
                        <li><span>max</span><b>${_escape(_formatValue(summary.max, fmt))}</b></li>
                        <li><span>avg</span><b>${_escape(_formatValue(summary.avg, fmt))}</b></li>
                        <li><span>last</span><b>${_escape(_formatValue(summary.last, fmt))}</b></li>
                        <li><span>样本</span><b>${summary.count} / ${totalFrames}</b></li>
                    </ul>
                </div>
                <div class="imm-summary-row imm-summary-row--secondary" data-role="summary-secondary" hidden></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const svg = overlay.querySelector('.imm-plot');
    const readout = {
        frame: overlay.querySelector('[data-role="frame"]'),
        value: overlay.querySelector('[data-role="value"]'),
        pct:   overlay.querySelector('[data-role="pct"]'),
        time:  overlay.querySelector('[data-role="time"]'),
        valueSecondary: overlay.querySelector('[data-role="value-secondary"]'),
        secondaryTag:   overlay.querySelector('[data-role="secondary-tag"]'),
        secondaryCell:  overlay.querySelector('[data-role="cell-secondary"]'),
    };
    const meaningSecondaryEl = overlay.querySelector('[data-role="meaning-secondary"]');
    const analysisSecondaryEl = overlay.querySelector('[data-role="analysis-secondary"]');
    const summarySecondaryEl = overlay.querySelector('[data-role="summary-secondary"]');

    /**
     * 把副指标的「物理含义 / 曲线分析」渲染到对应 aux 槽位。
     *   - 顶部一行：色点 + 副指标名 + 灰色 key（保持与主指标 header 同款语法，
     *     让玩家一眼看出"这段属于副坐标，不是主曲线的延伸"）
     *   - 下方文本：tooltip 拆出来的对应段；空段显示占位"暂无 …"
     *   - 主/副 tooltip 同源（来自 REPLAY_METRICS[i].tooltip），共用 splitTooltipForModal。
     */
    /**
     * 副指标的 min/max/avg/last/样本 摘要——独立成行、显式标"副指标"，
     * 与主指标行物理分隔，杜绝"主曲线上方的数字其实是副指标 last 值"这类误判。
     */
    function _renderSecondarySummary(secondary) {
        if (!summarySecondaryEl) return;
        if (!secondary) {
            summarySecondaryEl.hidden = true;
            summarySecondaryEl.innerHTML = '';
            return;
        }
        const sSummary = summarizePoints(secondary.points || []);
        const sColor = secondary.color || '#94a3b8';
        const fmtS = secondary.fmt || '';
        summarySecondaryEl.style.setProperty('--imm-row-color', sColor);
        summarySecondaryEl.innerHTML =
            `<div class="imm-summary-row-head">` +
                `<span class="imm-summary-row-dot" style="background:${sColor}"></span>` +
                `<span class="imm-summary-row-label">${_escape(secondary.label)}</span>` +
                `<span class="imm-summary-row-key" title="副指标 key">${_escape(secondary.metricKey)}</span>` +
                `<span class="imm-summary-row-tag imm-summary-row-tag--secondary">副指标</span>` +
            `</div>` +
            `<ul class="imm-summary imm-summary--secondary">` +
                `<li><span>min</span><b>${_escape(_formatValue(sSummary.min, fmtS))}</b></li>` +
                `<li><span>max</span><b>${_escape(_formatValue(sSummary.max, fmtS))}</b></li>` +
                `<li><span>avg</span><b>${_escape(_formatValue(sSummary.avg, fmtS))}</b></li>` +
                `<li><span>last</span><b>${_escape(_formatValue(sSummary.last, fmtS))}</b></li>` +
                `<li><span>样本</span><b>${sSummary.count} / ${totalFrames}</b></li>` +
            `</ul>`;
        summarySecondaryEl.hidden = false;
    }

    function _renderSecondaryDocs(secondary) {
        const slots = [
            { el: meaningSecondaryEl, key: 'meaning', emptyText: '该指标暂无含义说明。' },
            { el: analysisSecondaryEl, key: 'analysis', emptyText: '该指标暂无曲线分析。' },
        ];
        if (!secondary) {
            for (const { el } of slots) {
                if (el) { el.hidden = true; el.innerHTML = ''; }
            }
            return;
        }
        const split = splitTooltipForModal(secondary.tooltip || '');
        const dotColor = secondary.color || '#94a3b8';
        for (const { el, key, emptyText } of slots) {
            if (!el) continue;
            const text = split[key];
            const body = text
                ? `<p class="imm-aux-body${key === 'analysis' ? ' imm-aux-body--analysis' : ''}">${_escape(text)}</p>`
                : `<p class="imm-aux-body"><i class="imm-empty">${_escape(emptyText)}</i></p>`;
            el.innerHTML =
                `<div class="imm-aux-head" style="--imm-aux-color:${dotColor}">` +
                    `<span class="imm-aux-dot" style="background:${dotColor}"></span>` +
                    `<span class="imm-aux-label">${_escape(secondary.label)}</span>` +
                    `<span class="imm-aux-key" title="副指标 key">${_escape(secondary.metricKey)}</span>` +
                `</div>` + body;
            el.hidden = false;
        }
    }

    /* 主/副指标渲染管线 ——
     * 把"当前副指标 key → 重新画 plot + 重挂 hover"封装为一个闭包，
     * 副坐标下拉 change 与初次渲染共用同一路径，避免 DOM 状态分裂。 */
    function _renderWithSecondary(secondaryKey) {
        const secondary = secondaryKey && allSeries[secondaryKey] ? allSeries[secondaryKey] : null;
        const plotOpts = {
            primaryFmt: fmt,
            frameTimestamps,
            secondaryPoints: secondary ? secondary.points : null,
            secondaryColor: secondary ? secondary.color : null,
            secondaryFmt: secondary ? secondary.fmt : '',
        };
        const renderInfo = _renderPlot(svg, points, totalFrames, color, plotOpts);
        const hoverHandle = _attachHover(svg, renderInfo, points, {
            totalFrames,
            primaryColor: color,
            primaryFmt: fmt,
            secondaryPoints: secondary ? secondary.points : null,
            secondaryColor: secondary ? secondary.color : null,
            secondaryFmt: secondary ? secondary.fmt : '',
            frameTimestamps,
        }, readout);

        if (readout.secondaryCell) {
            readout.secondaryCell.hidden = !secondary;
        }
        if (readout.secondaryTag && secondary) {
            readout.secondaryTag.textContent = secondary.label;
            readout.secondaryTag.style.color = secondary.color || '';
        }
        // v1.61 +：副指标含义/分析与色点同框展示，方便对比阅读
        _renderSecondaryDocs(secondary);
        // v1.61 ++：副指标摘要独立成行，与主指标摘要物理分隔，明确数值归属
        _renderSecondarySummary(secondary);

        // 默认 readout 显示当前游标（默认 last）
        const initialIdx = Number.isFinite(Number(cfg.cursorIdx))
            ? Math.max(0, Math.min(totalFrames - 1, Number(cfg.cursorIdx)))
            : (totalFrames - 1);
        const initialPoint = nearestPointByIdx(points, initialIdx);
        if (initialPoint) {
            hoverHandle._renderReadoutAt(initialPoint);
        } else {
            // 空数据时仍刷新 time / secondary 字段，避免遗留旧值
            if (readout.time) readout.time.textContent = '—';
            if (readout.valueSecondary) readout.valueSecondary.textContent = '—';
        }

        _state.secondaryKey = secondary ? secondary.metricKey : null;
    }

    _renderWithSecondary(null);

    /* 副坐标下拉：change 时重画 plot + 重挂 hover。 */
    const select = overlay.querySelector('[data-role="secondary-select"]');
    if (select) {
        select.addEventListener('change', (e) => {
            const v = e.target?.value || '';
            _renderWithSecondary(v || null);
        });
    }

    // 关闭事件
    const close = () => closeInsightMetricModal();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.imm-close')?.addEventListener('click', close);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    _state = { overlay, onKey, onResize: null, config: cfg, secondaryKey: null };
    _injectStyles();

    return {
        close,
        /** 测试钩子：编程方式切换副指标，便于断言双坐标渲染。 */
        setSecondary: (k) => _renderWithSecondary(k || null),
    };
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
/** 确保浮层样式已注入（玩家洞察 / RL 训练曲线放大详读共用）。 */
export function ensureInsightMetricModalStyles() {
    _injectStyles();
}

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
        .imm-lineage {
            font-size: 11px; padding: 6px 10px; margin: 8px 0 0;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 5%, transparent);
            border-radius: 6px;
            display: flex; flex-wrap: wrap; gap: 5px; align-items: baseline;
            color: var(--text-secondary, #94a3b8);
        }
        .imm-lineage-tag {
            font-weight: 700; font-size: 10px;
            padding: 1px 5px; border-radius: 3px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 12%, transparent);
        }
        .imm-lineage-tag--fusion { color: #60a5fa; }
        .imm-lineage-tag--derived { color: #fbbf24; }
        .imm-lineage-tag--identity { color: #f87171; }
        .imm-lineage-tag--correlated { color: #94a3b8; }
        .imm-lineage-pair { font-family: ui-monospace, monospace; font-weight: 700; color: var(--text-primary, #e2e8f0); }
        .imm-lineage-desc { opacity: 0.85; }
        .imm-toolbar {
            display: flex; align-items: center;
            padding: 10px 0 4px;
            border-bottom: 1px dashed color-mix(in srgb, var(--text-primary, #e2e8f0) 12%, transparent);
        }
        .imm-toolbar-row {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 12px; flex-wrap: wrap;
        }
        .imm-toolbar-label {
            opacity: 0.6; font-weight: 700;
        }
        .imm-secondary-select {
            font-size: 12px; padding: 3px 6px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 6%, transparent);
            color: inherit;
            border: 1px solid color-mix(in srgb, var(--text-primary, #e2e8f0) 18%, transparent);
            border-radius: 5px;
            min-width: 130px;
        }
        /* optgroup 在大多数 OS 下使用浏览器原生外观（深色 menu 已有合理对比），
         * 这里只对显式可控的字体粗细/色相做轻微强化，避免分组标题与子项混在一起。 */
        .imm-secondary-select optgroup {
            font-weight: 700;
            font-style: normal;
            color: var(--text-primary, #e2e8f0);
        }
        .imm-secondary-select option {
            font-weight: 500;
        }
        .imm-toolbar-hint {
            opacity: 0.45; font-size: 11px;
        }
        .imm-readout {
            display: flex; align-items: baseline; flex-wrap: wrap; gap: 14px;
            font-size: 12px; padding: 10px 0 6px;
        }
        .imm-readout-cell { display: inline-flex; align-items: baseline; gap: 4px; }
        .imm-readout-cell[hidden] { display: none; }
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
        .imm-axis-label--y-primary { font-weight: 700; }
        .imm-axis-label--y-secondary { font-weight: 700; opacity: 0.9; }
        .imm-zeroline { stroke: color-mix(in srgb, currentColor 36%, transparent); stroke-width: 1; stroke-dasharray: 3 3; }
        .imm-hover-cursor { stroke: var(--replay-cursor, #e74c3c); stroke-width: 1.2; opacity: 0.85; }
        .imm-hit { cursor: crosshair; }
        .imm-summary-wrap {
            display: flex; flex-direction: column; gap: 8px;
            margin: 12px 0 4px;
        }
        .imm-summary-row {
            border: 1px solid color-mix(in srgb, var(--imm-row-color, #94a3b8) 28%, transparent);
            border-radius: 8px;
            padding: 6px 10px 8px;
            background: color-mix(in srgb, var(--imm-row-color, #94a3b8) 5%, transparent);
        }
        .imm-summary-row[hidden] { display: none; }
        .imm-summary-row--secondary {
            border-style: dashed;
        }
        .imm-summary-row-head {
            display: flex; align-items: center; gap: 6px;
            margin-bottom: 6px; font-size: 12px; font-weight: 700;
        }
        .imm-summary-row-dot {
            width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto;
            box-shadow: 0 0 5px var(--imm-row-color, currentColor);
        }
        .imm-summary-row-label { color: var(--imm-row-color, currentColor); }
        .imm-summary-row-key {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-size: 10px; opacity: 0.55; font-weight: 500;
            padding: 1px 5px; border-radius: 4px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 8%, transparent);
        }
        .imm-summary-row-tag {
            margin-left: auto;
            font-size: 10px; font-weight: 600;
            padding: 1px 6px; border-radius: 999px;
            color: var(--imm-row-color, currentColor);
            background: color-mix(in srgb, var(--imm-row-color, currentColor) 14%, transparent);
            border: 1px solid color-mix(in srgb, var(--imm-row-color, currentColor) 30%, transparent);
        }
        .imm-summary {
            list-style: none; padding: 0; margin: 0;
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
        .imm-section-aux {
            margin-top: 10px; padding-top: 8px;
            border-top: 1px dashed color-mix(in srgb, var(--text-primary, #e2e8f0) 14%, transparent);
        }
        .imm-section-aux[hidden] { display: none; }
        .imm-aux-head {
            display: flex; align-items: center; gap: 6px;
            margin-bottom: 4px; font-size: 12px; font-weight: 700;
        }
        .imm-aux-dot {
            width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto;
            box-shadow: 0 0 5px var(--imm-aux-color, currentColor);
        }
        .imm-aux-label { color: var(--imm-aux-color, currentColor); }
        .imm-aux-key {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-size: 10px; opacity: 0.55; font-weight: 500;
            padding: 1px 5px; border-radius: 4px;
            background: color-mix(in srgb, var(--text-primary, #e2e8f0) 8%, transparent);
        }
        .imm-aux-body {
            font-size: 12.5px; line-height: 1.6; margin: 0;
            white-space: pre-wrap; opacity: 0.88;
        }
        .imm-aux-body--analysis { opacity: 0.85; }
        @media (max-width: 540px) {
            .insight-metric-modal { padding: 14px; }
            .imm-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .imm-readout-hint { display: none; }
            .imm-toolbar-hint { display: none; }
            .imm-summary-row-tag { display: none; }
        }
    `;
    document.head.appendChild(style);
}

export const __test_only__ = {
    PLOT_W,
    PLOT_H,
    PAD_L,
    PAD_R_SINGLE,
    PAD_R_DUAL,
    PAD_T,
    PAD_B,
    _formatValue,
    _renderPlot,
    _state: () => _state,
};
