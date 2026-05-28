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
    // v2.10.26: top 20 → 32 给图例换行留空间 (分组维度多时一行容不下)
    padding: { top: 32, right: 16, bottom: 32, left: 36 },
    colors: {
        target: '#3b82f6',       // blue-500 — 业务 ideal
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
    // v2.10.33 (P2.3 UI): 模型预测不确定性 ±2σ 带 (MC Dropout 估计)
    const predStd = (data.predictedStd && data.predictedStd.length === target.length)
        ? data.predictedStd : null;
    // v2.10.24: 多分组对比线 (浅色画在背景)
    const extras = Array.isArray(data.extraCurves)
        ? data.extraCurves.filter((e) => Array.isArray(e?.curve) && e.curve.length === target.length)
        : [];
    // v3.0.14 (A): 每 bin 真实观察占比 [0,1] — < 0.3 视为"填充段" (lastValue), 渲染虚淡线
    const obsFillRatio = (Array.isArray(data.observedFillRatio) && data.observedFillRatio.length === target.length)
        ? data.observedFillRatio : null;
    // v3.0.17 (严格逐 sample 打点): scatterMode=true 时只画 target + 散点 (移除 mean 折线/marker)
    const scatterMode = !!opt.scatterMode;
    const scatterPoints = Array.isArray(data.scatterPoints) ? data.scatterPoints : null;
    // v3.0.18: baseline 散点 (橙色, 每条 baseline sample 一个点 [r, d_obs])
    const baselineScatterPoints = Array.isArray(data.baselineScatterPoints) ? data.baselineScatterPoints : null;
    // v3.0.22: 分维度散点 — { key, points: [[r,d_obs,d_pred,dim_key], ...] } 数组
    //   存在时, 整 set 灰/绿散点不画 (避免视觉重叠); 每组同色 obs 浅+pred 深
    const groupScatterPoints = Array.isArray(data.groupScatterPoints) ? data.groupScatterPoints : null;
    const hasGroupScatter = !!(groupScatterPoints && groupScatterPoints.length > 0);

    // v2.10.28: 缓存最后一次 render 的 data + opts (供图例 click toggle 重新 render)
    canvas._dcurveLastData = data;
    if (!canvas._dcurveVisible) canvas._dcurveVisible = {};   // {lineId: false} 表示隐藏
    if (!canvas._dcurveLegendHits) canvas._dcurveLegendHits = [];   // 图例点击区域
    const visible = canvas._dcurveVisible;
    const isVisible = (id) => visible[id] !== false;   // 默认 true
    // v2.10.28: hover 高亮的曲线 id (鼠标在 chart 内, 距离最近的曲线 id)
    const hoverLine = canvas._dcurveHoverLine || null;

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

    // v3.0.13: 分组对比线扩展到 16 条 (8 分组 × 2 线: pred 实线 + obs 虚线 同色配对)
    //   颜色按 __pairIndex 算 — 计算"非 baseline 项"配对索引, baseline 不参与配对
    if (extras.length > 0) {
        const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
        // 给每个 extra 计算 pairIdx (相邻同组 pred/obs 共享同一 palette 索引)
        let nonBaselinePos = 0;
        extras.slice(0, 16).forEach((e, idx) => {
            const lineId = `extra_${idx}`;
            if (!isVisible(lineId)) return;
            const isHover = hoverLine === lineId;
            let color;
            if (e.__isBaseline) {
                color = '#fb923c';   // baseline 固定橙色
            } else {
                // 同组 pred/obs 配对: pred 是偶数位 obs 是奇数位 → pair = floor(pos / 2)
                const pairIdx = Math.floor(nonBaselinePos / 2);
                color = palette[pairIdx % palette.length];
                nonBaselinePos++;
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = isHover ? 2.5 : 1.4;
            ctx.globalAlpha = hoverLine && !isHover ? 0.25 : 0.85;
            // v3.0.13: __isObserved → 虚线; baseline 也是虚线
            const useDashed = !!e.__isObserved || !!e.__isBaseline;
            if (useDashed) ctx.setLineDash([5, 4]);
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                const x = xAt(i), y = yAt(e.curve[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            if (useDashed) ctx.setLineDash([]);
        });
        ctx.globalAlpha = 1.0;
    }

    // v2.10.28: 4 条主线统一支持 visibility + hover 高亮
    const drawMainLine = (id, curve, color, dashed, baseLW) => {
        if (!isVisible(id) || !curve) return;
        const isHover = hoverLine === id;
        ctx.strokeStyle = color;
        ctx.lineWidth = isHover ? baseLW + 1.5 : baseLW;
        ctx.globalAlpha = hoverLine && !isHover ? 0.30 : 1.0;
        if (dashed) ctx.setLineDash(dashed);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            const x = xAt(i), y = yAt(curve[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
    };
    // v2.10.33/38 (P2.3 UI): 模型预测 ±2σ 置信带 — MC Dropout 估计的 epistemic uncertainty
    //   高 std bin: model "自知没把握", UI 上自动用半透明带宽暴露这点
    //   v2.10.38 视觉保底: σ 可能 < 0.001 (model 自信), 真实 2σ < 1 像素看不见,
    //   render 时用 max(2σ, 0.008) 保证至少 ~0.8% 视觉宽度, meta 区显示真实数值
    //
    // v3.0.20 修复 scatterMode 下 ±2σ 失效:
    //   原因: scatterMode 不画 pred mean 折线 + 半透明 fill (alpha 0.25) 被密集 scatter 覆盖
    //   方案: fill 之外加上下虚线 stroke (alpha 0.65), 让带子能从散点云中凸出来
    if (pred && predStd && isVisible('predicted')) {
        const sigmaK = 2.0;
        const MIN_VISUAL_HALF_WIDTH = 0.008;   // D 轴单位, ≥ 0.8% 可视
        // 预计算上下边界路径
        const upperXY = new Array(N);
        const lowerXY = new Array(N);
        for (let i = 0; i < N; i++) {
            const halfW = Math.max(sigmaK * predStd[i], MIN_VISUAL_HALF_WIDTH);
            const upper = Math.max(0, Math.min(1, pred[i] + halfW));
            const lower = Math.max(0, Math.min(1, pred[i] - halfW));
            upperXY[i] = [xAt(i), yAt(upper)];
            lowerXY[i] = [xAt(i), yAt(lower)];
        }
        // 1) 半透明填充 polygon
        ctx.fillStyle = opt.colors.predicted;
        ctx.globalAlpha = hoverLine && hoverLine !== 'predicted' ? 0.10 : 0.20;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            if (i === 0) ctx.moveTo(upperXY[i][0], upperXY[i][1]);
            else ctx.lineTo(upperXY[i][0], upperXY[i][1]);
        }
        for (let i = N - 1; i >= 0; i--) {
            ctx.lineTo(lowerXY[i][0], lowerXY[i][1]);
        }
        ctx.closePath();
        ctx.fill();
        // 2) 上下边界虚线 stroke — 让 σ 带从散点云中凸显
        ctx.strokeStyle = opt.colors.predicted;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = hoverLine && hoverLine !== 'predicted' ? 0.25 : 0.70;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            if (i === 0) ctx.moveTo(upperXY[i][0], upperXY[i][1]);
            else ctx.lineTo(upperXY[i][0], upperXY[i][1]);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            if (i === 0) ctx.moveTo(lowerXY[i][0], lowerXY[i][1]);
            else ctx.lineTo(lowerXY[i][0], lowerXY[i][1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
    }
    // ─── 实测曲线 (v3.0.14 mean 折线; v3.0.17 scatterMode 下不画) ───
    if (!scatterMode && obs && isVisible('observed')) {
        const isHover = hoverLine === 'observed';
        const baseAlpha = hoverLine && !isHover ? 0.30 : 1.0;
        ctx.strokeStyle = opt.colors.observed;
        if (obsFillRatio) {
            // 分段绘制: 相邻两点都 fill_ratio >= 0.3 → 实段; 否则虚 + 半透明
            for (let i = 0; i < N - 1; i++) {
                const rL = obsFillRatio[i];
                const rR = obsFillRatio[i + 1];
                const real = rL >= 0.3 && rR >= 0.3;
                ctx.lineWidth = isHover ? 3.5 : 2.5;
                ctx.globalAlpha = real ? baseAlpha : baseAlpha * 0.35;
                ctx.setLineDash(real ? [5, 4] : [2, 5]);   // 真实段大虚线 / 填充段细密虚线
                ctx.beginPath();
                ctx.moveTo(xAt(i), yAt(obs[i]));
                ctx.lineTo(xAt(i + 1), yAt(obs[i + 1]));
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;
        } else {
            // 老路径 (无 obsFillRatio 数据时, 全段同一虚线)
            drawMainLine('observed', obs, opt.colors.observed, [5, 4], 2.5);
        }
    }
    // ─── v3.0.18: baseline 散点 (橙色) — 画在最底层 ───
    if (baselineScatterPoints && baselineScatterPoints.length > 0 && isVisible('baseline')) {
        const N_b = baselineScatterPoints.length;
        const alpha = Math.max(0.20, Math.min(0.55, 150 / N_b));
        const radius = N_b > 5000 ? 1.4 : (N_b > 2000 ? 2.0 : 2.8);
        ctx.fillStyle = '#fb923c';   // orange-400
        ctx.globalAlpha = alpha;
        for (const p of baselineScatterPoints) {
            const r = p[0], d = p[1];
            if (!Number.isFinite(r) || !Number.isFinite(d)) continue;
            const x = left + (r / CURVE_R_MAX) * (W - left - right);
            const y = yAt(Math.max(0, Math.min(1, d)));
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }

    // ─── v3.0.16 (严格逐 sample 打点): 实测点 (灰) + 预测点 (绿) ───
    //   每条 sample 产生 1 个 [r, d_obs] 或 [r, d_obs, d_pred] (有 model_id 时)
    //   点位置: r=final_score/pb, d=sample.d_curve[final_bin] (真实 bin 才算)
    //   v3.0.22: 有分维度散点 (hasGroupScatter) 时, 整 set 灰/绿散点不画 (避免视觉重叠 + 信息冗余)
    if (!hasGroupScatter && scatterPoints && scatterPoints.length > 0) {
        const N_pt = scatterPoints.length;
        // 自适应 alpha + radius: 点 < 500 时清晰显示, > 5000 时密度展示
        const alpha = Math.max(0.20, Math.min(0.75, 200 / N_pt));
        const radius = N_pt > 5000 ? 1.4 : (N_pt > 2000 ? 2.0 : 2.8);
        const drawPoint = (color, x, y) => {
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        };
        for (const p of scatterPoints) {
            const r = p[0];
            const dObs = p[1];
            const x = left + (r / CURVE_R_MAX) * (W - left - right);
            // 实测点 (灰)
            if (Number.isFinite(dObs) && isVisible('observed')) {
                drawPoint(opt.colors.observed, x, yAt(Math.max(0, Math.min(1, dObs))));
            }
            // 预测点 (绿) — 只在 3 元组时画
            const dPred = p.length >= 3 ? p[2] : null;
            if (Number.isFinite(dPred) && isVisible('predicted')) {
                drawPoint(opt.colors.predicted, x, yAt(Math.max(0, Math.min(1, dPred))));
            }
        }
        ctx.globalAlpha = 1.0;
    }

    // ─── v3.0.22 / v3.0.23: 分维度散点 — 每组 实测/预测 两类, 颜色不同 ───
    //   v3.0.23 调整: 改"同色浅深"为"两类两色":
    //     - obs 用 LIGHT_PALETTE[gIdx] (浅色调)
    //     - pred 用 DARK_PALETTE[gIdx] (深色调, 同色系)
    //   图例分别画 "easy 实测" / "easy 预测", 各一个图例项 (toggle 独立)
    if (hasGroupScatter) {
        // 8 组色对 (light obs / dark pred), 同列同色系, 视觉对应明显
        const LIGHT_PALETTE = ['#fde68a', '#fbcfe8', '#ddd6fe', '#a5f3fc', '#fed7aa', '#a7f3d0', '#fecaca', '#bfdbfe'];
        const DARK_PALETTE  = ['#d97706', '#be185d', '#5b21b6', '#0e7490', '#c2410c', '#15803d', '#b91c1c', '#1d4ed8'];
        const totalPts = groupScatterPoints.reduce((s, g) => s + g.points.length, 0);
        const alphaBase = Math.max(0.20, Math.min(0.75, 200 / Math.max(1, totalPts)));
        const radius = totalPts > 5000 ? 1.4 : (totalPts > 2000 ? 2.0 : 2.6);
        groupScatterPoints.slice(0, LIGHT_PALETTE.length).forEach((g, gIdx) => {
            const obsId = `group_${gIdx}_obs`;
            const predId = `group_${gIdx}_pred`;
            const obsShow = isVisible(obsId);
            const predShow = isVisible(predId);
            const obsHover = hoverLine === obsId;
            const predHover = hoverLine === predId;
            const obsDim = hoverLine && !obsHover ? 0.20 : 1.0;
            const predDim = hoverLine && !predHover ? 0.20 : 1.0;
            const obsColor = LIGHT_PALETTE[gIdx % LIGHT_PALETTE.length];
            const predColor = DARK_PALETTE[gIdx % DARK_PALETTE.length];
            for (const p of g.points) {
                const r = p[0];
                const dObs = p[1];
                const dPred = p.length >= 3 ? p[2] : null;
                const x = left + (r / CURVE_R_MAX) * (W - left - right);
                if (obsShow && Number.isFinite(dObs)) {
                    ctx.fillStyle = obsColor;
                    ctx.globalAlpha = alphaBase * obsDim;
                    ctx.beginPath();
                    ctx.arc(x, yAt(Math.max(0, Math.min(1, dObs))), radius, 0, Math.PI * 2);
                    ctx.fill();
                }
                if (predShow && Number.isFinite(dPred)) {
                    ctx.fillStyle = predColor;
                    ctx.globalAlpha = alphaBase * predDim;
                    ctx.beginPath();
                    ctx.arc(x, yAt(Math.max(0, Math.min(1, dPred))), radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
        ctx.globalAlpha = 1.0;
    }
    // ─── 目标曲线 (蓝粗) — scatterMode 下也保留, 作为参照 ───
    drawMainLine('target', target, opt.colors.target, null, 3);
    // ─── 预测 mean 折线 ───
    //   - 非 scatterMode: 常规绘制
    //   - scatterMode 默认不画 (避免聚合假象)
    //   - v3.0.20: scatterMode 但用户勾选了 ±2σ (predStd 存在) 时, mean 是带子的中线锚点, 必须画
    const shouldDrawPredMean = pred && (!scatterMode || !!predStd);
    if (shouldDrawPredMean) drawMainLine('predicted', pred, opt.colors.predicted, null, 2);

    // ─── v3.0.15: 20 bin 中心 marker (v3.0.17 scatterMode 下不画) ───
    if (!scatterMode) {
        //   预测点 (绿实心圆) + 实测点 (灰实心圆 / 填充段空心)
        const drawMarkers = (curve, color, lineId, fillRatio) => {
            if (!curve || !isVisible(lineId)) return;
            const isHover = hoverLine === lineId;
            const baseAlpha = hoverLine && !isHover ? 0.30 : 1.0;
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            for (let i = 0; i < N; i++) {
                const x = xAt(i), y = yAt(curve[i]);
                const real = fillRatio ? (fillRatio[i] >= 0.3) : true;
                ctx.globalAlpha = real ? baseAlpha : baseAlpha * 0.4;
                if (real) {
                    ctx.beginPath();
                    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1.0;
        };
        if (pred) drawMarkers(pred, opt.colors.predicted, 'predicted', null);
        if (obs) drawMarkers(obs, opt.colors.observed, 'observed', obsFillRatio);
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

    // ─── 图例 (v2.10.26: 自动换行 + 留出右上指标空间; v2.10.28: 可点击 toggle) ───
    canvas._dcurveLegendHits = [];   // 重置点击区域 (每次 render)
    if (opt.showLegend) {
        const metricsReserveW = opt.showMetrics ? 230 : 8;
        const maxLegendX = W - right - metricsReserveW;
        let legendY = top - 22;
        let legendX = left + 8;
        const lineH = 13;
        const drawLegend = (lineId, color, label, dashed = false) => {
            ctx.font = '11px ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const textW = ctx.measureText(label).width;
            const itemW = 18 + textW + 14;
            if (legendX + itemW - 14 > maxLegendX && legendX > left + 8) {
                legendX = left + 8;
                legendY += lineH;
            }
            const hidden = !isVisible(lineId);
            // v2.10.28: 隐藏的图例文字变灰 + 减淡线段
            ctx.globalAlpha = hidden ? 0.35 : 1.0;
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
            // 隐藏时画删除线
            if (hidden) {
                ctx.strokeStyle = opt.colors.text;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(legendX + 18, legendY);
                ctx.lineTo(legendX + 18 + textW, legendY);
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;
            // 记录点击区域 (bbox + lineId)
            canvas._dcurveLegendHits.push({
                lineId, x: legendX, y: legendY - 6, w: itemW, h: 12,
            });
            legendX += itemW;
        };
        drawLegend('target', opt.colors.target, '目标');
        // v3.0.23: 分维度散点存在时, 全局"预测/实测"图例不画 — 避免跟"easy 实测/easy 预测"重复语义
        //   chart 上整 set 散点本身也因 hasGroupScatter 不画 (在散点渲染处), 图例隐藏保持一致
        if (!hasGroupScatter) {
            if (pred) drawLegend('predicted', opt.colors.predicted, '预测');
            if (obs) drawLegend('observed', opt.colors.observed, '实测', !scatterMode);
        }
        if (baselineScatterPoints && baselineScatterPoints.length > 0) {
            drawLegend('baseline', '#fb923c', 'baseline');
        }
        if (extras.length > 0) {
            const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
            // v3.0.13: 同 pred 主线一样, 用 __pairIndex 配对 + 虚线区分 obs
            let nonBaselinePos = 0;
            extras.slice(0, 16).forEach((e, idx) => {
                const labelShort = e.label.length > 24 ? e.label.slice(0, 22) + '…' : e.label;
                let color;
                if (e.__isBaseline) {
                    color = '#fb923c';
                } else {
                    color = palette[Math.floor(nonBaselinePos / 2) % palette.length];
                    nonBaselinePos++;
                }
                drawLegend(`extra_${idx}`, color, labelShort, !!e.__isObserved || !!e.__isBaseline);
            });
        }
        // v3.0.22 / v3.0.23: 分维度散点图例 — 每组拆"实测/预测"两项, 颜色不同
        if (hasGroupScatter) {
            const LIGHT_PALETTE = ['#fde68a', '#fbcfe8', '#ddd6fe', '#a5f3fc', '#fed7aa', '#a7f3d0', '#fecaca', '#bfdbfe'];
            const DARK_PALETTE  = ['#d97706', '#be185d', '#5b21b6', '#0e7490', '#c2410c', '#15803d', '#b91c1c', '#1d4ed8'];
            groupScatterPoints.slice(0, LIGHT_PALETTE.length).forEach((g, gIdx) => {
                const obsColor = LIGHT_PALETTE[gIdx % LIGHT_PALETTE.length];
                const predColor = DARK_PALETTE[gIdx % DARK_PALETTE.length];
                const keyShort = g.key.length > 20 ? g.key.slice(0, 18) + '…' : g.key;
                drawLegend(`group_${gIdx}_obs`, obsColor, `${keyShort} 实测 (${g.points.length})`);
                drawLegend(`group_${gIdx}_pred`, predColor, `${keyShort} 预测`);
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
        colors: opt.colors,
    });
}

/**
 * v2.10.25/28: 鼠标交互
 *   - mousemove on chart: tooltip 显示各曲线 D 值 + 高亮鼠标 Y 最近的曲线
 *   - mousemove on legend: 鼠标变 pointer 提示可点击
 *   - click on legend: toggle 该曲线 visibility, 重新 render
 */
function _bindHover(canvas, info) {
    let tooltip = canvas._dcurveTooltip;
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: fixed; pointer-events: none; z-index: 100;
            background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(96, 165, 250, 0.3);
            border-radius: 4px; padding: 6px 8px; font-size: 11px;
            font-family: ui-monospace, monospace; color: #e5e7eb;
            white-space: nowrap; display: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        `;
        document.body.appendChild(tooltip);
        canvas._dcurveTooltip = tooltip;

        const _hitLegend = (cssX, cssY) => {
            const hits = canvas._dcurveLegendHits || [];
            for (const h of hits) {
                if (cssX >= h.x && cssX <= h.x + h.w && cssY >= h.y && cssY <= h.y + h.h) return h.lineId;
            }
            return null;
        };

        canvas.addEventListener('mousemove', (e) => {
            const lastInfo = canvas._dcurveInfo;
            if (!lastInfo) return;
            const rect = canvas.getBoundingClientRect();
            const cssW = rect.width, cssH = rect.height;
            // 用 CSS 坐标 (canvas 内部坐标系跟 CSS 一致 — 我们用 dpr scale)
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            // v2.10.28: 命中图例 → pointer cursor + tooltip 提示
            const legendHit = _hitLegend(x, y);
            if (legendHit) {
                canvas.style.cursor = 'pointer';
                const visible = canvas._dcurveVisible || {};
                tooltip.innerHTML = `点击 ${visible[legendHit] === false ? '<b style="color:#34d399">显示</b>' : '<b style="color:#f87171">隐藏</b>'} 该曲线`;
                tooltip.style.display = 'block';
                tooltip.style.left = (e.clientX + 12) + 'px';
                tooltip.style.top = (e.clientY + 12) + 'px';
                // 清 hover 高亮
                if (canvas._dcurveHoverLine != null) {
                    canvas._dcurveHoverLine = null;
                    renderDCurveChart(canvas, canvas._dcurveLastData);
                }
                return;
            }
            canvas.style.cursor = 'default';

            const { left: pl, right: pr, top: pt, bottom: pb, N, rMax, target, pred, obs, extras, colors } = lastInfo;
            const chartLeft = pl, chartRight = cssW - pr, chartTop = pt, chartBottom = cssH - pb;
            if (x < chartLeft || x > chartRight || y < chartTop || y > chartBottom) {
                tooltip.style.display = 'none';
                // 清 hover 高亮
                if (canvas._dcurveHoverLine != null) {
                    canvas._dcurveHoverLine = null;
                    renderDCurveChart(canvas, canvas._dcurveLastData);
                }
                return;
            }
            // 反推 bin
            const t = (x - chartLeft) / (chartRight - chartLeft);
            const bin = Math.max(0, Math.min(N - 1, Math.round(t * (N - 1))));
            const r = (bin + 0.5) * (rMax / N);

            // v2.10.28: 找鼠标 Y 最近的曲线 (Y 值差最小, 且该曲线 visible)
            const dVal = 1 - (y - chartTop) / (chartBottom - chartTop);   // CSS Y → D 值反推
            const visible = canvas._dcurveVisible || {};
            const isV = (id) => visible[id] !== false;
            const candidates = [];
            if (isV('target')) candidates.push({ id: 'target', v: target[bin] });
            if (pred && isV('predicted')) candidates.push({ id: 'predicted', v: pred[bin] });
            if (obs && isV('observed')) candidates.push({ id: 'observed', v: obs[bin] });
            (extras || []).forEach((ex, idx) => {
                if (isV(`extra_${idx}`)) candidates.push({ id: `extra_${idx}`, v: ex.curve[bin] });
            });
            let nearest = null, nearestDist = Infinity;
            candidates.forEach((c) => {
                const d = Math.abs(c.v - dVal);
                if (d < nearestDist) { nearestDist = d; nearest = c.id; }
            });
            // 距离 > 0.08 (D 单位) 时不高亮 (鼠标不算"贴近")
            const newHover = nearestDist < 0.08 ? nearest : null;
            if (newHover !== canvas._dcurveHoverLine) {
                canvas._dcurveHoverLine = newHover;
                renderDCurveChart(canvas, canvas._dcurveLastData);
            }

            // tooltip 内容
            const fmt = (v) => v == null ? '-' : v.toFixed(3);
            const lines = [`<b>r = ${r.toFixed(2)}</b> (bin ${bin})`];
            const mark = (id) => id === newHover ? ' <b>◀</b>' : '';
            if (isV('target')) lines.push(`<span style="color:${colors.target}">●</span> 目标 = ${fmt(target[bin])}${mark('target')}`);
            if (pred && isV('predicted')) lines.push(`<span style="color:${colors.predicted}">●</span> 预测 = ${fmt(pred[bin])}${mark('predicted')}`);
            if (obs && isV('observed')) lines.push(`<span style="color:${colors.observed}">●</span> 实测 = ${fmt(obs[bin])}${mark('observed')}`);
            if (extras && extras.length > 0) {
                const palette = ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#34d399', '#f87171', '#60a5fa'];
                let nonBaselinePos = 0;
                extras.slice(0, 16).forEach((ex, idx) => {
                    if (!isV(`extra_${idx}`)) { if (!ex.__isBaseline) nonBaselinePos++; return; }
                    const labelShort = ex.label.length > 24 ? ex.label.slice(0, 22) + '…' : ex.label;
                    let color;
                    if (ex.__isBaseline) {
                        color = '#fb923c';
                    } else {
                        color = palette[Math.floor(nonBaselinePos / 2) % palette.length];
                        nonBaselinePos++;
                    }
                    lines.push(`<span style="color:${color}">●</span> ${labelShort} = ${fmt(ex.curve[bin])}${mark(`extra_${idx}`)}`);
                });
            }
            tooltip.innerHTML = lines.join('<br>');
            tooltip.style.display = 'block';
            const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
            const winW = window.innerWidth, winH = window.innerHeight;
            let tx = e.clientX + 12, ty = e.clientY + 12;
            if (tx + tw > winW - 8) tx = e.clientX - tw - 12;
            if (ty + th > winH - 8) ty = e.clientY - th - 12;
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'default';
            if (canvas._dcurveHoverLine != null) {
                canvas._dcurveHoverLine = null;
                renderDCurveChart(canvas, canvas._dcurveLastData);
            }
        });

        // v2.10.28: 图例点击 toggle
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const id = _hitLegend(x, y);
            if (!id) return;
            const visible = canvas._dcurveVisible || (canvas._dcurveVisible = {});
            // toggle: undefined (默认 true) / true → false; false → true
            visible[id] = (visible[id] === false);
            renderDCurveChart(canvas, canvas._dcurveLastData);
        });
    }
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
