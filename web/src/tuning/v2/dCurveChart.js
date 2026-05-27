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

import { targetCurveVector, targetCurveCalibratedVector, CURVE_N_BINS, CURVE_R_MAX } from './targetSCurve.js';

// ─────────── 默认样式 ───────────

const DEFAULT_STYLE = {
    width: 600,
    height: 280,
    // v2.10.26: top 20 → 32 给图例换行留空间 (分组维度多时一行容不下)
    padding: { top: 32, right: 16, bottom: 32, left: 36 },
    colors: {
        target: '#3b82f6',       // blue-500 — 业务 ideal
        calibrated: '#a78bfa',   // purple-400 — v2.9 训练 target
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
    showCalibrated: true,        // v2.9: 默认展示校准 target
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

/** v2.10.20: 计算最大局部倒退幅度 (max(c[i-1] - c[i])), 用于诊断 "单调 = ✗" 严重度 */
function _maxMonotonicDrop(c) {
    let maxDrop = 0;
    for (let i = 1; i < c.length; i++) {
        const drop = c[i - 1] - c[i];
        if (drop > maxDrop) maxDrop = drop;
    }
    return maxDrop;
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
 * @param {number[]|null} [data.predictedCurve] - 模型预测; null/undefined 表示未推断, 不画该线 + 不显示图例
 * @param {number[]} [data.observedCurve] - 实测样本均值 (可选)
 * @param {object} [data.options] - 样式覆盖
 */
export function renderDCurveChart(canvas, data) {
    if (!canvas) throw new Error('canvas required');
    const opt = { ...DEFAULT_STYLE, ...(data.options || {}) };
    const target = data.targetCurve || targetCurveVector();
    const pred = (data.predictedCurve && data.predictedCurve.length === target.length)
        ? data.predictedCurve : null;
    const obs = (data.observedCurve && data.observedCurve.length === target.length)
        ? data.observedCurve : null;
    // v2.10.24: 多分组对比线 (浅色画在背景)
    const extras = Array.isArray(data.extraCurves)
        ? data.extraCurves.filter((e) => Array.isArray(e?.curve) && e.curve.length === target.length)
        : [];

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
        // 业务关键 r 拐点 (与 target_curve SEG_* 对应): 0.5 / 0.70 / 1.10
        for (const rv of [0.5, 0.70, 1.10]) {
            if (rv > CURVE_R_MAX) continue;
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

    // v2.10.24/25: 分组对比线 (彩色细线, 画在最底层但保证可见性)
    if (extras.length > 0) {
        const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
        ctx.lineWidth = 1.4;       // v2.10.25: 1.0 → 1.4 (更显眼)
        ctx.globalAlpha = 0.85;    // v2.10.25: 0.55 → 0.85 (避免被黑底吃光)
        extras.slice(0, 8).forEach((e, idx) => {
            ctx.strokeStyle = palette[idx % palette.length];
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                const x = xAt(i), y = yAt(e.curve[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });
        ctx.globalAlpha = 1.0;
    }

    // ─── 实测曲线 (灰虚线, 先画在下层) ───
    if (obs) {
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

    // ─── 校准 target (紫细虚线) — v2.9 训练目标, 让用户看到"实际可达" ───
    if (opt.showCalibrated) {
        const calibrated = targetCurveCalibratedVector(N);
        ctx.strokeStyle = opt.colors.calibrated;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            const x = xAt(i), y = yAt(calibrated[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ─── 目标曲线 (蓝粗) — 业务 ideal ───
    ctx.strokeStyle = opt.colors.target;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
        const x = xAt(i), y = yAt(target[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ─── 预测曲线 (绿实) — 仅当 pred != null 时画, 避免与目标线重叠误导 ───
    if (pred) {
        ctx.strokeStyle = opt.colors.predicted;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            const x = xAt(i), y = yAt(pred[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

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
    // x 刻度: 0 / 0.5 / 1.0 / 1.5 / r_max — 自动按当前 CURVE_R_MAX 渲染
    const xTicks = [0, 0.5, 1.0, 1.5, 2.0].filter((v) => v <= CURVE_R_MAX + 1e-9);
    for (const rv of xTicks) {
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

    // ─── 图例 (v2.10.26: 自动换行 + 留出右上指标空间) ───
    if (opt.showLegend) {
        // 给右上指标预留 230px (avg "预测 MAE = X.XXXX" + "单调 ✗ (max 倒退 X.XXX)" + "D=0.5 偏移 Δr = X.XXX")
        const metricsReserveW = opt.showMetrics ? 230 : 8;
        const maxLegendX = W - right - metricsReserveW;
        let legendY = top - 22;   // chart 顶部上方 (padding.top 留了 32)
        let legendX = left + 8;
        const lineH = 13;
        const drawLegend = (color, label, dashed = false) => {
            ctx.font = '11px ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const textW = ctx.measureText(label).width;
            // v2.10.26: 当前行装不下 → 换行 (但只允许 1 次额外换行, 避免 chart 区被压缩)
            if (legendX + 18 + textW > maxLegendX && legendX > left + 8) {
                legendX = left + 8;
                legendY += lineH;
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (dashed) ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(legendX, legendY);
            ctx.lineTo(legendX + 14, legendY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = opt.colors.text;
            ctx.fillText(label, legendX + 18, legendY);
            legendX += 18 + textW + 14;
        };
        drawLegend(opt.colors.target, '目标 (业务)');
        if (opt.showCalibrated) drawLegend(opt.colors.calibrated, '训练 target (校准)', true);
        if (pred) drawLegend(opt.colors.predicted, '模型预测');
        if (obs) drawLegend(opt.colors.observed, '实测均值', true);
        // v2.10.25/26: 分组对比图例 (最多前 8 组)
        if (extras.length > 0) {
            const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
            extras.slice(0, 8).forEach((e, idx) => {
                const labelShort = e.label.length > 20 ? e.label.slice(0, 18) + '…' : e.label;
                drawLegend(palette[idx % palette.length], labelShort);
            });
        }
    }

    // ─── 指标 ─── (无预测时改成显示实测 vs 目标)
    if (opt.showMetrics) {
        let mae = null;
        let monotone = null;
        let critDelta = null;
        let maeLabel = 'MAE';
        if (pred) {
            mae = _mae(pred, target);
            monotone = _isMonotonic(pred);
            const critR = _findCriticalR(pred);
            const critTargetR = _findCriticalR(target);
            critDelta = critR != null && critTargetR != null ? (critR - critTargetR) : null;
            maeLabel = '预测 MAE';
        } else if (obs) {
            mae = _mae(obs, target);
            monotone = _isMonotonic(obs);
            const critR = _findCriticalR(obs);
            const critTargetR = _findCriticalR(target);
            critDelta = critR != null && critTargetR != null ? (critR - critTargetR) : null;
            maeLabel = '实测 MAE';
        }

        ctx.fillStyle = opt.colors.text;
        ctx.font = '10.5px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';

        // v2.10.20: 明确"单调"跟"临界点 Δ"的含义, 加倒退幅度诊断
        // v2.10.22 修 bug: 用作用域内变量 pred (不是不存在的 predictedCurve)
        const maxDrop = (monotone === false && pred) ? _maxMonotonicDrop(pred) : 0;
        const lines = [
            `${maeLabel} = ${mae != null ? mae.toFixed(4) : '—'}`,
            monotone == null ? '单调 —'
                : monotone ? '单调 ✓'
                : `单调 ✗ (max 倒退 ${maxDrop.toFixed(3)})`,
            critDelta != null ? `D=0.5 偏移 Δr = ${critDelta >= 0 ? '+' : ''}${critDelta.toFixed(3)}` : 'D=0.5 偏移 —',
        ];
        // v2.10.26: 指标位置 — 跟图例同 Y 区域 (上方 padding 留出来), 靠右
        // 之前在 top+4+i*13 会跟图例重叠
        lines.forEach((t, i) => {
            ctx.fillText(t, W - right - 4, top - 22 + i * 13);
        });
    }

    // v2.10.25: 绑定 hover 显示 r 位置各曲线值
    _bindHover(canvas, {
        N, rMax: CURVE_R_MAX, left, right, top, bottom, W, H,
        target, pred, obs, extras,
        showCalibrated: opt.showCalibrated,
        colors: opt.colors,
    });
}

/** v2.10.25: 鼠标 hover 在 chart 上时, 显示当前 r 位置各曲线值 (tooltip + 竖线) */
function _bindHover(canvas, info) {
    // 复用 dataset 上的 tooltip div (避免每次 render 重建)
    let tooltip = canvas._dcurveTooltip;
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: absolute; pointer-events: none; z-index: 100;
            background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(96, 165, 250, 0.3);
            border-radius: 4px; padding: 6px 8px; font-size: 11px;
            font-family: ui-monospace, monospace; color: #e5e7eb;
            white-space: nowrap; display: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        `;
        document.body.appendChild(tooltip);
        canvas._dcurveTooltip = tooltip;

        canvas.addEventListener('mousemove', (e) => {
            const lastInfo = canvas._dcurveInfo;
            if (!lastInfo) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const cssW = rect.width;
            const { left: pl, right: pr, top: pt, bottom: pb, N, rMax, target, pred, obs, extras, showCalibrated, colors } = lastInfo;
            const chartLeft = pl, chartRight = cssW - pr;
            if (x < chartLeft || x > chartRight || y < pt || y > rect.height - pb) {
                tooltip.style.display = 'none';
                return;
            }
            // 反推 bin (近邻整数)
            const t = (x - chartLeft) / (chartRight - chartLeft);
            const bin = Math.max(0, Math.min(N - 1, Math.round(t * (N - 1))));
            const r = (bin + 0.5) * (rMax / N);
            const fmt = (v) => v == null ? '-' : v.toFixed(3);
            let lines = [`<b>r = ${r.toFixed(2)}</b> (bin ${bin})`];
            lines.push(`<span style="color:${colors.target}">●</span> 目标 = ${fmt(target?.[bin])}`);
            if (showCalibrated) {
                // 重新计算 calibrated 这点 (没存)
                lines.push(`<span style="color:${colors.calibrated}">●</span> 校准 (估)`);
            }
            if (pred) lines.push(`<span style="color:${colors.predicted}">●</span> 预测 = ${fmt(pred[bin])}`);
            if (obs) lines.push(`<span style="color:${colors.observed}">●</span> 实测 = ${fmt(obs[bin])}`);
            // 分组对比
            if (extras && extras.length > 0) {
                const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
                extras.slice(0, 8).forEach((ex, idx) => {
                    const labelShort = ex.label.length > 24 ? ex.label.slice(0, 22) + '…' : ex.label;
                    lines.push(`<span style="color:${palette[idx % palette.length]}">●</span> ${labelShort} = ${fmt(ex.curve[bin])}`);
                });
            }
            tooltip.innerHTML = lines.join('<br>');
            tooltip.style.display = 'block';
            // 定位 tooltip (避免超出视窗)
            const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
            const winW = window.innerWidth, winH = window.innerHeight;
            let tx = e.clientX + 12, ty = e.clientY + 12;
            if (tx + tw > winW - 8) tx = e.clientX - tw - 12;
            if (ty + th > winH - 8) ty = e.clientY - th - 12;
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
        });
        canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    }
    // 每次 render 更新 info (供 mousemove 读)
    canvas._dcurveInfo = info;
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
