/**
 * d_curve 可视化组件 (Canvas) — 业务直观图。
 *
 * 显示 3 条曲线在同一坐标系:
 *   - 蓝粗线: 目标 S 曲线 (targetSCurve)
 *   - 绿实线: 模型预测 curve
 *   - 灰虚线: 实测样本均值 (可选)
 *
 * 关键指标显示:
 *   - curve_MAE: 预测与目标的平均绝对误差
 *   - 单调性: 预测曲线是否单调非降
 *   - 临界点 (D=0.5) 位置偏移
 *
 * 用法:
 *   import { renderDCurveChart } from './dCurveChart.js';
 *   renderDCurveChart(canvas, { targetCurve, predictedCurve, observedCurve, options });
 */

import { targetCurveVector, CURVE_N_BINS, CURVE_R_MAX } from './targetSCurve.js';

// ─────────── 默认样式 ───────────

const DEFAULT_STYLE = {
    width: 600,
    height: 280,
    padding: { top: 20, right: 16, bottom: 32, left: 36 },
    colors: {
        target: '#3b82f6',       // blue-500
        predicted: '#10b981',    // emerald-500
        observed: '#9ca3af',     // gray-400
        grid: 'rgba(148,163,184,0.18)',
        axis: '#64748b',
        text: '#cbd5e1',
        critical: '#fbbf24',     // 临界线 D=0.5
        background: '#020617',
    },
    showGrid: true,
    showLegend: true,
    showMetrics: true,
};


// ─────────── 工具 ───────────

function _mae(a, b) {
    if (a.length !== b.length) return null;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
}

function _isMonotonic(c, tol = 1e-4) {
    for (let i = 1; i < c.length; i++) {
        if (c[i] < c[i - 1] - tol) return false;
    }
    return true;
}

function _findCriticalR(curve, criticalD = 0.5, rMax = CURVE_R_MAX) {
    // 曲线第一次穿过 D=criticalD 的 r 位置
    for (let i = 1; i < curve.length; i++) {
        if (curve[i - 1] < criticalD && curve[i] >= criticalD) {
            // 线性插值
            const t = (criticalD - curve[i - 1]) / (curve[i] - curve[i - 1]);
            return ((i - 1) + t + 0.5) * rMax / curve.length;
        }
    }
    return null;
}


// ─────────── 主渲染 ───────────

/**
 * 渲染 d_curve 对比图。
 * @param {HTMLCanvasElement} canvas
 * @param {object} data
 * @param {number[]} data.targetCurve - 目标 S 曲线 (可省略, 自动从 targetCurveVector())
 * @param {number[]} data.predictedCurve - 模型预测
 * @param {number[]} [data.observedCurve] - 实测样本均值 (可选)
 * @param {object} [data.options] - 样式覆盖
 */
export function renderDCurveChart(canvas, data) {
    if (!canvas) throw new Error('canvas required');
    const opt = { ...DEFAULT_STYLE, ...(data.options || {}) };
    const target = data.targetCurve || targetCurveVector();
    const pred = data.predictedCurve;
    const obs = data.observedCurve;
    if (!pred || pred.length !== target.length) {
        throw new Error(`predictedCurve length mismatch: expected ${target.length}, got ${pred?.length}`);
    }

    // ─── 设置 canvas (HiDPI) ───
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = opt.width * dpr;
    canvas.height = opt.height * dpr;
    canvas.style.width = opt.width + 'px';
    canvas.style.height = opt.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = opt.width, H = opt.height;
    const { top, right, bottom, left } = opt.padding;
    const plotW = W - left - right;
    const plotH = H - top - bottom;

    // ─── 背景 ───
    ctx.fillStyle = opt.colors.background;
    ctx.fillRect(0, 0, W, H);

    // ─── 坐标系 ───
    const N = target.length;
    const xAt = (i) => left + (i + 0.5) / N * plotW;
    const yAt = (d) => top + (1 - Math.max(0, Math.min(1, d))) * plotH;

    // ─── 网格 ───
    if (opt.showGrid) {
        ctx.strokeStyle = opt.colors.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        for (let yv = 0; yv <= 1.001; yv += 0.2) {
            const y = yAt(yv);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(W - right, y);
            ctx.stroke();
        }
        // r=0.5, 0.95, 1.0 三条关键 vert
        for (const rv of [0.5, 0.95, 1.0]) {
            const xi = (rv / CURVE_R_MAX) * N - 0.5;
            const x = xAt(xi);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, H - bottom);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    // ─── 临界线 D=0.5 ───
    ctx.strokeStyle = opt.colors.critical;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const y50 = yAt(0.5);
    ctx.beginPath();
    ctx.moveTo(left, y50);
    ctx.lineTo(W - right, y50);
    ctx.stroke();
    ctx.setLineDash([]);

    // ─── 实测曲线 (灰虚线, 先画在下层) ───
    if (obs && obs.length === N) {
        ctx.strokeStyle = opt.colors.observed;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            const x = xAt(i), y = yAt(obs[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ─── 目标曲线 (蓝粗) ───
    ctx.strokeStyle = opt.colors.target;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
        const x = xAt(i), y = yAt(target[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ─── 预测曲线 (绿实) ───
    ctx.strokeStyle = opt.colors.predicted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
        const x = xAt(i), y = yAt(pred[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ─── 坐标轴 ───
    ctx.strokeStyle = opt.colors.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, H - bottom);
    ctx.lineTo(W - right, H - bottom);
    ctx.stroke();

    // ─── 坐标刻度 ───
    ctx.fillStyle = opt.colors.text;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let yv = 0; yv <= 1.001; yv += 0.25) {
        ctx.fillText(yv.toFixed(2), left - 4, yAt(yv));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const rv of [0, 0.5, 1.0, 1.5]) {
        const xi = (rv / CURVE_R_MAX) * N - 0.5;
        ctx.fillText(rv.toFixed(1), xAt(xi), H - bottom + 4);
    }
    // 轴标签
    ctx.fillStyle = opt.colors.axis;
    ctx.fillText('r = score / PB', W / 2, H - 12);
    ctx.save();
    ctx.translate(12, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('难度 D', 0, 0);
    ctx.restore();

    // ─── 图例 ───
    if (opt.showLegend) {
        const legendY = top + 6;
        let legendX = left + 8;
        const drawLegend = (color, label, dashed = false) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (dashed) ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(legendX, legendY);
            ctx.lineTo(legendX + 14, legendY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = opt.colors.text;
            ctx.font = '11px ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, legendX + 18, legendY);
            legendX += ctx.measureText(label).width + 32;
        };
        drawLegend(opt.colors.target, '目标 S 曲线');
        drawLegend(opt.colors.predicted, '模型预测');
        if (obs) drawLegend(opt.colors.observed, '实测均值', true);
    }

    // ─── 指标 ───
    if (opt.showMetrics) {
        const mae = _mae(pred, target);
        const monotone = _isMonotonic(pred);
        const critR = _findCriticalR(pred);
        const critTargetR = _findCriticalR(target);
        const critDelta = critR != null && critTargetR != null ? (critR - critTargetR) : null;

        ctx.fillStyle = opt.colors.text;
        ctx.font = '10.5px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';

        const lines = [
            `MAE = ${mae != null ? mae.toFixed(4) : '—'}`,
            `单调 = ${monotone ? '✓' : '✗'}`,
            critDelta != null ? `临界点 Δ = ${critDelta >= 0 ? '+' : ''}${critDelta.toFixed(3)}` : '临界点 —',
        ];
        lines.forEach((t, i) => {
            ctx.fillText(t, W - right - 4, top + 4 + i * 13);
        });
    }
}


// ─────────── 计算指标 (单独导出供 dashboard 显示) ───────────

export function computeChartMetrics(predictedCurve, targetCurve = null) {
    const tgt = targetCurve || targetCurveVector();
    return {
        mae: _mae(predictedCurve, tgt),
        monotonic: _isMonotonic(predictedCurve),
        criticalR: _findCriticalR(predictedCurve),
        targetCriticalR: _findCriticalR(tgt),
    };
}
