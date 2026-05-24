/**
 * PB 双 S 曲线精简版组件 — 用于 spawn-tuning dashboard Tab ⑤ (结果分析)。
 *
 * 设计目标:
 *   - 给一组 (theta, context, evalRow) 输入,渲染单一 ratio 在 PB 曲线上的位置
 *   - 不包含 spawn-eval 完整版的:
 *     * 试探得分滑块 (单 θ 视图不需要预演)
 *     * 评估行 rug plot (这里就一条数据,不需要 rug)
 *     * 命中率横条 (Tab ⑤ 已有更详细指标)
 *   - 保留:
 *     * 主曲线 (tension/brake sigmoid)
 *     * 7 阶段背景带
 *     * 当前 marker (vertical line + 2 dots + pill label)
 *     * 3 数值徽章 (pbTension/pbBrake/pbRelease)
 *
 * 用法:
 *   import { renderPbCurveMini } from './tuning/pbCurveMini.js';
 *   renderPbCurveMini('#mini-container', {
 *       scoreMean: 1820,
 *       bestScore: 1000,
 *       label: 'normal:budget-p2:1500:growth',
 *   });
 *
 * 设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §3 (PB 双 S 曲线模型)
 */

import { derivePbCurve } from '../adaptiveSpawn.js';

const PB_VIEW = { w: 800, h: 180, padL: 40, padR: 14, padT: 22, padB: 38 };
const PB_RATIO_MAX = 1.6;
const PB_PHASE_BANDS = [
    { start: 0.0,  end: 0.5,  color: 'rgba(148, 163, 184, 0.05)', label: 'idle' },
    { start: 0.5,  end: 0.8,  color: 'rgba(96, 165, 250, 0.08)',  label: 'chase' },
    { start: 0.8,  end: 0.95, color: 'rgba(96, 165, 250, 0.16)',  label: 'tension' },
    { start: 0.95, end: 1.0,  color: 'rgba(251, 191, 36, 0.18)',  label: 'gate' },
    { start: 1.0,  end: 1.05, color: 'rgba(52, 211, 153, 0.20)',  label: 'release' },
    { start: 1.05, end: 1.15, color: 'rgba(251, 146, 60, 0.20)',  label: 'brake' },
    { start: 1.15, end: PB_RATIO_MAX, color: 'rgba(248, 113, 113, 0.22)', label: 'overshoot' },
];
const PHASE_MEANINGS = {
    warmup: '张力 / 刹车均未启动,玩家远离 PB',
    chase: '张力开始预热,玩家朝 PB 区靠近',
    tension: '张力陡升,spatialPressure 加压',
    gate: '张力满载,最后冲刺;刹车即将介入',
    release: '刚破 PB 的释放窗口,刹车暂缓 · payoff 加成',
    brake: '刹车介入 · payoff −16% · 多消折扣 22%',
    overshoot: 'payoff 已被抑制 22%,进一步增长会触发更强刹车',
    unknown: '未配置 PB (best ≤ 0)',
};

function ratioToX(r) {
    return PB_VIEW.padL + (Math.max(0, Math.min(PB_RATIO_MAX, r)) / PB_RATIO_MAX) * (PB_VIEW.w - PB_VIEW.padL - PB_VIEW.padR);
}
function valueToY(v) {
    return (PB_VIEW.h - PB_VIEW.padB) - Math.max(0, Math.min(1, v)) * (PB_VIEW.h - PB_VIEW.padT - PB_VIEW.padB);
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n, d = 2) {
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(d);
}

function buildPbCurveSvg(scoreMean, bestScore, curve) {
    const y0 = valueToY(0);
    const y1 = valueToY(1);
    const xL = ratioToX(0);
    const xR = ratioToX(PB_RATIO_MAX);

    // 背景阶段带
    const bands = PB_PHASE_BANDS.map((b) => {
        const x1 = ratioToX(b.start);
        const x2 = ratioToX(b.end);
        return `<rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${b.color}" />`;
    }).join('');
    const bandLabels = PB_PHASE_BANDS.map((b) => {
        const mid = (ratioToX(b.start) + ratioToX(b.end)) / 2;
        return `<text x="${mid.toFixed(1)}" y="${(y1 - 4).toFixed(1)}" font-size="8" fill="#9ca3af" text-anchor="middle" font-family="ui-monospace,monospace">${b.label}</text>`;
    }).join('');

    // 主曲线采样 100 点
    const N = 100;
    const tensionPts = [], brakePts = [];
    for (let i = 0; i <= N; i++) {
        const r = (i / N) * PB_RATIO_MAX;
        const c = derivePbCurve(r, 1, false);
        const cmd = i === 0 ? 'M' : 'L';
        tensionPts.push(`${cmd}${ratioToX(r).toFixed(1)},${valueToY(c.pbTension).toFixed(1)}`);
        brakePts.push(`${cmd}${ratioToX(r).toFixed(1)},${valueToY(c.pbBrake).toFixed(1)}`);
    }

    // 当前 marker
    const safeBest = bestScore || 1;
    const rawRatio = scoreMean / safeBest;
    const ratio = Math.max(0, Math.min(PB_RATIO_MAX, rawRatio));
    const xm = ratioToX(ratio);
    const yT = valueToY(curve.pbTension);
    const yB = valueToY(curve.pbBrake);
    const overflowMark = rawRatio > PB_RATIO_MAX
        ? `<text x="${(xR - 4).toFixed(1)}" y="${(y1 + 14).toFixed(1)}" font-size="9" fill="#f87171" text-anchor="end" font-family="ui-monospace,monospace">超出 ${rawRatio.toFixed(2)}×</text>`
        : '';
    const midX = (xL + xR) / 2;
    const pillW = 110;
    const pillX = xm > midX ? xm - pillW - 6 : xm + 6;
    const pillY = Math.max(y1 + 4, Math.min(yT, yB) - 30);

    // X 轴刻度
    const tickValues = [0, 0.5, 0.82, 1.0, 1.15, 1.5];
    const xTicks = tickValues.map((t) => {
        const x = ratioToX(t);
        return `<line x1="${x.toFixed(1)}" y1="${y0}" x2="${x.toFixed(1)}" y2="${(y0 + 3).toFixed(1)}" stroke="#6b7280" stroke-width="1" />
                <text x="${x.toFixed(1)}" y="${(y0 + 14).toFixed(1)}" font-size="9" fill="#9ca3af" text-anchor="middle" font-family="ui-monospace,monospace">${t.toFixed(2)}</text>`;
    }).join('');

    return `
        <svg viewBox="0 0 ${PB_VIEW.w} ${PB_VIEW.h}" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; max-height:240px; display:block;" role="img" aria-label="PB 双 S 曲线">
            ${bands}
            ${bandLabels}
            <line x1="${xL}" y1="${y0}" x2="${xR}" y2="${y0}" stroke="#374151" stroke-width="1" />
            <line x1="${xL}" y1="${y1}" x2="${xL}" y2="${y0}" stroke="#374151" stroke-width="1" />
            ${xTicks}
            <text x="${((xL + xR) / 2).toFixed(1)}" y="${(y0 + 28).toFixed(1)}" font-size="9" fill="#9ca3af" text-anchor="middle">pbRatio = score / bestScore</text>
            <path d="${tensionPts.join(' ')}" fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round" />
            <path d="${brakePts.join(' ')}" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" />
            <line x1="${xm.toFixed(1)}" y1="${y1}" x2="${xm.toFixed(1)}" y2="${y0}" stroke="#e5e7eb" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.7" />
            <circle cx="${xm.toFixed(1)}" cy="${yT.toFixed(1)}" r="4" fill="#60a5fa" stroke="#0f172a" stroke-width="1.2" />
            <circle cx="${xm.toFixed(1)}" cy="${yB.toFixed(1)}" r="4" fill="#fb923c" stroke="#0f172a" stroke-width="1.2" />
            <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW}" height="28" rx="4" fill="rgba(15,23,42,0.92)" stroke="#e5e7eb" stroke-width="0.8" />
            <text x="${(pillX + 6).toFixed(1)}" y="${(pillY + 12).toFixed(1)}" font-size="9" fill="#60a5fa" font-weight="700" font-family="ui-monospace,monospace">${escapeHtml(curve.pbPhase)}</text>
            <text x="${(pillX + 6).toFixed(1)}" y="${(pillY + 23).toFixed(1)}" font-size="8" fill="#e5e7eb" font-family="ui-monospace,monospace">r=${ratio.toFixed(2)} T=${fmt(curve.pbTension, 2)} B=${fmt(curve.pbBrake, 2)}</text>
            ${overflowMark}
        </svg>
    `;
}

/**
 * 渲染 PB 曲线 mini panel 到指定容器。
 *
 * @param {string|HTMLElement} container - 选择器或 DOM 元素
 * @param {object} opts
 * @param {number} opts.scoreMean - 当前评估行的均分
 * @param {number} opts.bestScore - 上下文 PB
 * @param {string} [opts.label] - 上方显示的 context 标签
 * @param {object} [opts.theta] - 可选 θ,显示在底部供参考
 */
export function renderPbCurveMini(container, opts) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;
    const { scoreMean = 0, bestScore = 1000, label = '', theta = null } = opts || {};

    const curve = derivePbCurve(scoreMean, bestScore, false);
    const meaning = PHASE_MEANINGS[curve.pbPhase] || '';

    host.innerHTML = `
        <div style="background:rgba(2,6,23,0.55); border:1px solid var(--line); border-radius:10px; padding:12px 14px;">
            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <div>
                    <div style="font-size:13px; font-weight:600; color:var(--text);">PB 双 S 曲线 ${label ? `· <code style="font-size:11px;">${escapeHtml(label)}</code>` : ''}</div>
                    <div style="font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; margin-top:2px;">scoreMean ${fmt(scoreMean, 0)} / bestScore ${bestScore} = ratio ${fmt(scoreMean / Math.max(1, bestScore), 2)}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <span style="font-size:11px; color:var(--muted);">─ 张力 ${fmt(curve.pbTension, 2)}</span>
                    <span style="font-size:11px; color:#fb923c;">─ 刹车 ${fmt(curve.pbBrake, 2)}</span>
                </div>
            </div>
            ${buildPbCurveSvg(scoreMean, bestScore, curve)}
            <div style="font-size:11px; color:var(--muted); margin-top:6px; padding:6px 10px; background:rgba(2,6,23,0.5); border-radius:4px;">
                <b style="color:var(--accent);">${escapeHtml(curve.pbPhase)}</b> — ${escapeHtml(meaning)}
            </div>
        </div>
    `;
}

/**
 * 清空 panel (用于无选中状态)。
 */
export function clearPbCurveMini(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (host) host.innerHTML = '';
}
