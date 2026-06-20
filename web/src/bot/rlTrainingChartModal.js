/**
 * rlTrainingChartModal.js — RL 训练指标「放大详读」浮层
 *
 * 触发：点击侧栏任一训练曲线 canvas → 弹出居中卡片，展示放大版多序列折线图 +
 * 指标说明 / 当前解读 / 各序列摘要。交互与玩家洞察面板的 openInsightMetricModal 对齐。
 */

import { ensureInsightMetricModalStyles } from '../insightMetricModal.js';
import { paintRlChartCanvas, splitRlPanelHelp, summarizeSeriesValues } from './rlTrainingCharts.js';

const MODAL_CHART_H = 280;
const MODAL_CHART_W = 760;

let _overlay = null;
let _onKey = null;

function _escape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _formatSeriesValue(v, yTick) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    if (typeof yTick === 'function') return yTick(v);
    const a = Math.abs(v);
    if (a >= 1e6) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    return v.toFixed(2);
}

/**
 * @param {object} plotMeta
 * @param {number} offsetX
 * @param {number[]} x
 * @param {object[]} series
 * @returns {{ index: number, episode: number } | null}
 */
function _nearestIndexFromX(plotMeta, offsetX, x) {
    if (!plotMeta || !x?.length) return null;
    const { padL, plotW, xmin, xmax } = plotMeta;
    const rel = Math.max(0, Math.min(1, (offsetX - padL) / Math.max(plotW, 1)));
    const ep = xmin + rel * ((xmax - xmin) || 1);
    let best = 0;
    let bestDist = Math.abs(x[0] - ep);
    for (let i = 1; i < x.length; i++) {
        const d = Math.abs(x[i] - ep);
        if (d < bestDist) {
            best = i;
            bestDist = d;
        }
    }
    return { index: best, episode: x[best] };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} plotMeta
 * @param {number[]} x
 * @param {object[]} series
 * @param {{ yTick?: (v:number)=>string }} chartOpts
 * @param {HTMLElement} readoutEl
 */
function _wirePlotHover(canvas, plotMeta, x, series, chartOpts, readoutEl) {
    if (!canvas || !plotMeta || !readoutEl) return;

    const render = (idx) => {
        const ep = x[idx];
        const parts = series.map((s) => {
            const v = s.y?.[idx];
            return `<span style="color:${s.color}">${_escape(s.label)} ${_escape(_formatSeriesValue(v, chartOpts?.yTick))}</span>`;
        });
        readoutEl.innerHTML = `<span class="rtcm-readout-ep">局 ${ep}</span> · ${parts.join(' · ')}`;
    };

    render(x.length - 1);

    canvas.addEventListener('mousemove', (ev) => {
        const hit = _nearestIndexFromX(plotMeta, ev.offsetX, x);
        if (hit) render(hit.index);
    });
    canvas.addEventListener('mouseleave', () => {
        render(x.length - 1);
    });
}

/**
 * @param {object} cfg
 * @param {string} cfg.chartId
 * @param {string} cfg.title
 * @param {number[]} cfg.x
 * @param {object[]} cfg.series
 * @param {object} [cfg.chartOpts]
 * @param {string} [cfg.hint]
 * @returns {{ close: () => void } | null}
 */
export function openRlTrainingChartModal(cfg) {
    if (typeof document === 'undefined' || !cfg || !Array.isArray(cfg.x) || cfg.x.length < 2) {
        return null;
    }
    if (cfg.chartOpts?.emptyMessage) {
        return null;
    }

    closeRlTrainingChartModal();
    ensureInsightMetricModalStyles();

    const { chartId, title, x, series, chartOpts = {}, hint = '' } = cfg;
    const { meaning, analysis } = splitRlPanelHelp(hint);
    const primaryColor = series?.[0]?.color || '#5b9bd5';

    const overlay = document.createElement('div');
    overlay.className = 'insight-metric-modal-backdrop rtcm-backdrop';
    overlay.setAttribute('data-chart-id', String(chartId || ''));

    const seriesSummaryHtml = (series || []).map((s) => {
        const summary = summarizeSeriesValues(s.y || []);
        const yTick = chartOpts?.yTick;
        return `<div class="imm-summary-row" style="--imm-row-color:${s.color}">
            <div class="imm-summary-row-head">
                <span class="imm-summary-row-dot" style="background:${s.color}"></span>
                <span class="imm-summary-row-label">${_escape(s.label)}</span>
            </div>
            <ul class="imm-summary">
                <li><span>min</span><b>${_escape(_formatSeriesValue(summary.min, yTick))}</b></li>
                <li><span>max</span><b>${_escape(_formatSeriesValue(summary.max, yTick))}</b></li>
                <li><span>avg</span><b>${_escape(_formatSeriesValue(summary.avg, yTick))}</b></li>
                <li><span>last</span><b>${_escape(_formatSeriesValue(summary.last, yTick))}</b></li>
                <li><span>样本</span><b>${summary.count} / ${x.length}</b></li>
            </ul>
        </div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="insight-metric-modal rtcm-modal" role="dialog" aria-modal="true" aria-labelledby="rtcm-title">
            <header class="imm-head">
                <span class="imm-color-dot" style="background:${primaryColor}"></span>
                <h3 class="imm-title" id="rtcm-title">${_escape(title)}</h3>
                <span class="imm-key" title="图表 id">${_escape(chartId || '')}</span>
                <button type="button" class="imm-close" aria-label="关闭">×</button>
            </header>
            <section class="imm-section imm-section--meaning">
                <h4 class="imm-section-title">指标说明</h4>
                <p class="imm-section-body">${_escape(meaning) || '<i class="imm-empty">该图暂无说明。</i>'}</p>
            </section>
            <div class="imm-readout rtcm-readout">
                <span class="imm-readout-hint">横坐标：训练局数（episodes）；鼠标移到曲线上读取各序列数值</span>
                <div class="rtcm-readout-body" data-role="readout"></div>
            </div>
            <div class="rtcm-plot-wrap">
                <canvas class="rtcm-plot-canvas" aria-label="${_escape(title)} 放大曲线"></canvas>
            </div>
            <section class="imm-section imm-section--analysis">
                <h4 class="imm-section-title">当前解读</h4>
                <p class="imm-section-body imm-section-body--analysis">${_escape(analysis) || '<i class="imm-empty">暂无动态解读；继续训练或刷新后会更新。</i>'}</p>
            </section>
            <div class="imm-summary-wrap rtcm-summary-wrap">${seriesSummaryHtml}</div>
        </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.rtcm-plot-canvas');
    const readout = overlay.querySelector('[data-role="readout"]');
    const modalChartOpts = {
        ...chartOpts,
        cssH: MODAL_CHART_H,
        showCanvasTitle: false,
    };
    const { plotMeta } = paintRlChartCanvas(canvas, title, x, series, modalChartOpts, hint, MODAL_CHART_W);
    _wirePlotHover(canvas, plotMeta, x, series, chartOpts, readout);

    const close = () => closeRlTrainingChartModal();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.imm-close')?.addEventListener('click', close);
    _onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', _onKey);

    _overlay = overlay;
    return { close };
}

export function closeRlTrainingChartModal() {
    if (_onKey) {
        document.removeEventListener('keydown', _onKey);
        _onKey = null;
    }
    if (_overlay) {
        _overlay.remove();
        _overlay = null;
    }
}
