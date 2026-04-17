/**
 * RL 训练日志可视化：纯 Canvas，无第三方依赖。
 * 摘要条：近 N 局均分 / 胜率 / 均熵（诊断优先看趋势，非单局 Lv 尖峰）。
 */

/**
 * @param {number[]} arr
 * @param {number} win
 * @returns {number[]}
 */
export function rollingMean(arr, win) {
    const n = arr.length;
    const out = new Array(n).fill(NaN);
    const w = Math.max(1, Math.floor(win));
    for (let i = 0; i < n; i++) {
        const j0 = Math.max(0, i - w + 1);
        let s = 0;
        let c = 0;
        for (let j = j0; j <= i; j++) {
            const v = arr[j];
            if (typeof v === 'number' && Number.isFinite(v)) {
                s += v;
                c += 1;
            }
        }
        out[i] = c ? s / c : NaN;
    }
    return out;
}

/**
 * @param {object[]} entries 来自 /api/rl/training_log
 * @returns {object[]}
 */
export function extractTrainEpisodeRows(entries) {
    const raw = (entries || []).filter(
        (e) => e && e.event === 'train_episode' && typeof e.episodes === 'number'
    );
    const map = new Map();
    for (const r of raw) {
        map.set(r.episodes, r);
    }
    return [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v);
}

/** 单图 CSS 高度：压缩后固定展示 Lπ / Lv / 熵 / step / 胜率 / 得分 六条曲线 */
const CHART_CSS_H = 88;
/** 逐局序列：细线宽；滑动平均仍用 2～2.5 */
const RAW_LINE_WIDTH = 0.68;

/** 旧版日志或未裁剪的异常标量：不参与折线绘制，避免纵轴被单点拉到 1e30+ */
function sanitizeLossForChart(v, maxAbs = 1e7) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NaN;
    if (Math.abs(v) > maxAbs) return NaN;
    return v;
}

/**
 * 智能 y 轴标签：根据数值范围自动选择精度，固定保留 2 位小数。
 * @param {number} v
 * @returns {string}
 */
function autoYTick(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    return v.toFixed(2);
}

/**
 * 用 IQR 方法裁剪离群值，返回裁剪后的 [lo, hi]；离群点在绘制时会被 clamp。
 * @param {number[]} values
 * @param {number} k IQR 倍数（默认 3）
 * @returns {{ lo: number, hi: number }}
 */
function robustRange(values, k = 3) {
    const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (finite.length < 4) return null;
    const sorted = [...finite].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    if (iqr < 1e-12) return null;
    return { lo: q1 - k * iqr, hi: q3 + k * iqr };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cssW
 * @param {number} cssH
 * @param {string} title
 * @param {number[]} x
 * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[] }[]} series
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number, robustClip?: boolean } | undefined} chartOpts
 */
function drawLineChart(ctx, cssW, cssH, title, x, series, chartOpts) {
    const compact = cssH <= 96;
    const padL = compact ? 40 : 50;
    const padR = compact ? 6 : 10;
    const padT = compact ? 13 : 20;
    const padB = compact ? 22 : 34;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#5d7a96';
    ctx.font = compact ? '600 8.5px system-ui, sans-serif' : '600 10px system-ui, sans-serif';
    ctx.fillText(title, padL, compact ? 11 : 14);

    let clip = null;
    if (chartOpts?.robustClip) {
        const allVals = series.flatMap((s) => s.y);
        clip = robustRange(allVals);
    }

    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of series) {
        for (let i = 0; i < s.y.length; i++) {
            let v = s.y[i];
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            if (clip) v = Math.max(clip.lo, Math.min(clip.hi, v));
            ymin = Math.min(ymin, v);
            ymax = Math.max(ymax, v);
        }
    }
    if (!Number.isFinite(ymin)) {
        ymin = 0;
        ymax = 1;
    }
    if (ymax <= ymin) {
        ymax = ymin + 1e-6;
    }
    const yPad = (ymax - ymin) * 0.06 || 0.05;
    ymin -= yPad;
    ymax += yPad;

    if (chartOpts?.yMinFloor != null) {
        ymin = Math.max(chartOpts.yMinFloor, ymin);
    }
    if (chartOpts?.yMaxCeil != null) {
        ymax = Math.min(chartOpts.yMaxCeil, ymax);
        if (ymax <= ymin) {
            ymax = ymin + 1e-6;
        }
    }

    const xmin = x[0];
    const xmax = x[x.length - 1];
    const xspan = xmax - xmin || 1;

    const xi = (ep) => padL + ((ep - xmin) / xspan) * plotW;
    const yi = (v) => padT + plotH - ((v - ymin) / (ymax - ymin)) * plotH;

    const yTick = chartOpts?.yTick ?? autoYTick;

    ctx.strokeStyle = 'rgba(44, 62, 80, 0.12)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
        const v = ymin + (g / 4) * (ymax - ymin);
        const y = yi(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillStyle = '#8a9bab';
        ctx.font = compact ? '7.5px ui-monospace, monospace' : '9px ui-monospace, monospace';
        ctx.fillText(yTick(v), 2, y + (compact ? 2.5 : 3));
    }

    ctx.fillStyle = '#8a9bab';
    ctx.font = compact ? '7.5px system-ui, sans-serif' : '9px system-ui, sans-serif';
    const xAxisY = padT + plotH + (compact ? 9 : 14);
    ctx.fillText(String(xmin), padL, xAxisY);
    ctx.fillText(String(xmax), padL + plotW - 28, xAxisY);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const s of series) {
        ctx.strokeStyle = s.color;
        /* 默认略加粗：高 DPR 下 1.5 以下在窄图里易糊成一条灰线 */
        ctx.lineWidth = s.lineWidth ?? 1.65;
        ctx.setLineDash(s.dash || []);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < x.length; i++) {
            let v = s.y[i];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                started = false;
                continue;
            }
            if (clip) v = Math.max(clip.lo, Math.min(clip.hi, v));
            const px = xi(x[i]);
            const py = yi(v);
            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} title
 * @param {number[]} x
 * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[] }[]} series
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number } | undefined} chartOpts
 */
function paint(canvas, title, x, series, chartOpts) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = canvas.parentElement;
    const cssW = Math.max(260, parent?.clientWidth || canvas.clientWidth || 320);
    const cssH = typeof chartOpts?.cssH === 'number' ? chartOpts.cssH : CHART_CSS_H;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return;
    }
    ctx.scale(dpr, dpr);
    drawLineChart(ctx, cssW, cssH, title, x, series, chartOpts);
}

/** 策略/价值损失滑动窗口 */
const MA_LOSS = 20;
/** 得分、胜率等「对局表现」滑动窗口（略长，抑尖峰） */
const MA_PERF = 40;
/** 摘要条统计用的最近局数 */
const SUMMARY_N = 40;

/** @param {string} s */
function escapeHtmlAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

/**
 * @param {HTMLElement | null} el
 * @param {object[]} rows sorted train_episode rows
 */
function fillSummary(el, rows) {
    if (!el || !rows.length) {
        return;
    }
    const last = rows[rows.length - 1];
    const lastEp = last.episodes;
    const slice = rows.slice(-SUMMARY_N);

    const scores = slice.map((r) => r.score).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    const withWinRate = slice.filter((r) => typeof r.win_rate === 'number');
    const withWon = slice.filter((r) => typeof r.won === 'boolean');
    const winRate = withWinRate.length > 0
        ? withWinRate.reduce((a, r) => a + r.win_rate, 0) / withWinRate.length
        : withWon.length > 0
            ? withWon.filter((r) => r.won).length / withWon.length
            : null;

    const ents = slice.map((r) => r.entropy).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgEnt = ents.length ? ents.reduce((a, b) => a + b, 0) / ents.length : null;

    const lvTail = slice
        .map((r) => r.loss_value)
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const lvClip = robustRange(lvTail);
    const lvClean = lvClip
        ? lvTail.filter((v) => v >= lvClip.lo && v <= lvClip.hi)
        : lvTail;
    const avgLv = lvClean.length ? lvClean.reduce((a, b) => a + b, 0) / lvClean.length : null;

    const fmt = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
    const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

    const tipLast =
        '训练日志中最后一条 train_episode 对应的回合序号（episodes），即当前已记录到的最新一局编号。';
    const tipAvgScore = `在最近 ${SUMMARY_N} 条 train_episode 中，对有效 score 字段求算术平均；用于观察近期对局得分水平（受右侧「最近 N 局」裁剪影响）。`;
    const tipWin = `在最近 ${SUMMARY_N} 条记录上：若存在 win_rate 则对其求平均；否则若有 won（胜负）字段则统计胜率。反映近期胜负走势。`;
    const tipEnt =
        '策略分布熵 H(π) 在最近若干局上的平均。偏高表示策略更随机、探索更足；偏低表示策略更尖锐、更确定。';
    const tipLv = `价值网络损失 loss_value 在最近 ${SUMMARY_N} 局上的平均；已对极端离群值做 IQR 裁剪后再平均，减轻单局尖峰对摘要的干扰。`;
    const tipNote =
        '摘要依赖日志中的 score、won/win_rate、entropy、loss_value 等字段；单局 Lv 常有尖峰，解读时优先看图表中粗线滑动平均与本行趋势。';

    el.innerHTML = [
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipLast)}">末局 <strong>${lastEp}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipAvgScore)}">近${SUMMARY_N}局均分 <strong>${fmt(avgScore, 1)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipWin)}">近${SUMMARY_N}局胜率 <strong>${winRate == null ? '—' : fmtPct(winRate)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipEnt)}">近${SUMMARY_N}局均熵 <strong>${fmt(avgEnt, 2)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipLv)}">近${SUMMARY_N}局均Lv <strong>${fmt(avgLv, 1)}</strong></span>`,
        `<span class="rl-dash-note" title="${escapeHtmlAttr(tipNote)}">单局 Lv 尖峰常见；看<strong>粗线滑动平均</strong>与本摘要趋势更稳。得分/胜率依赖日志字段 <code>score</code>/<code>won</code>。</span>`
    ].join('');
}

/**
 * @param {HTMLElement | null} root
 * @param {object[]} entries
 * @param {HTMLElement | null} [summaryEl]
 * @param {number} [maxEpisodes] 仅显示最近 N 局（按 episodes 字段裁剪）；0 或不传表示全部
 */
export function updateRlTrainingCharts(root, entries, summaryEl = null, maxEpisodes = 0) {
    const sumEl = summaryEl ?? document.getElementById('rl-dash-summary');

    if (!root) {
        if (sumEl) {
            sumEl.textContent = '';
        }
        return;
    }
    root.replaceChildren();
    let rows = extractTrainEpisodeRows(entries);
    if (maxEpisodes > 0 && rows.length > 0) {
        const cutoff = rows[rows.length - 1].episodes - maxEpisodes;
        rows = rows.filter((r) => r.episodes >= cutoff);
    }
    if (rows.length < 2) {
        if (sumEl) {
            sumEl.innerHTML =
                '<span class="rl-dash-note" title="训练曲线需要至少 2 个回合点才能画折线。请完成自博弈或 PyTorch 训练并写入 train_episode 日志后刷新。">数据不足：至少需要 2 条 train_episode 记录。</span>';
        }
        const p = document.createElement('p');
        p.className = 'rl-dash-empty';
        p.title =
            rows.length === 0
                ? '训练日志中尚无 train_episode 事件。请启动带 PyTorch 后端的训练并确保服务端写入 JSONL，或使用浏览器内训练将指标写入本机后再点「刷新图表」。'
                : '折线图至少需要两个数据点。请继续训练几局或拉取更多历史日志后再刷新。';
        p.textContent =
            rows.length === 0
                ? '暂无 train_episode 记录。勾选 PyTorch 后端训练并刷新，或使用浏览器训练（指标写入本机后自动出曲线）。'
                : '至少需要 2 条训练记录才能绘制曲线。';
        root.appendChild(p);
        return;
    }

    if (sumEl) {
        fillSummary(sumEl, rows);
    }

    const x = rows.map((r) => r.episodes);
    const lp = rows.map((r) => sanitizeLossForChart(r.loss_policy, 1e8));
    const lv = rows.map((r) => sanitizeLossForChart(r.loss_value));
    const ent = rows.map((r) => (typeof r.entropy === 'number' ? r.entropy : NaN));
    const st = rows.map((r) => (typeof r.step_count === 'number' ? r.step_count : NaN));
    const scores = rows.map((r) => (typeof r.score === 'number' ? r.score : NaN));
    const won01 = rows.map((r) =>
        typeof r.win_rate === 'number' ? r.win_rate
        : typeof r.won === 'boolean' ? (r.won ? 1 : 0)
        : NaN
    );

    const lpMa = rollingMean(lp, MA_LOSS);
    const lvMa = rollingMean(lv, MA_LOSS);

    /* 双序列：粗线=滑动平均；细线=逐局。色相错开，避免与 MA 混淆 */
    const C_LP_MA = '#142d52';
    const C_LP_RAW = 'rgba(0, 188, 212, 0.82)';
    const C_LV_MA = '#4a1c10';
    const C_LV_RAW = 'rgba(255, 179, 0, 0.88)';
    const C_SC_MA = '#004d40';
    const C_SC_RAW = 'rgba(255, 112, 67, 0.82)';

    /**
     * @param {string} title
     * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[] }[]} series
     * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number, robustClip?: boolean } | undefined} chartOpts
     * @param {string} [hint] 鼠标悬停整块图表时的说明
     */
    const mk = (title, series, chartOpts, hint) => {
        const wrap = document.createElement('div');
        wrap.className = 'rl-chart-wrap';
        if (hint) {
            wrap.title = hint;
        }
        const c = document.createElement('canvas');
        c.className = 'rl-chart-canvas';
        wrap.appendChild(c);
        root.appendChild(wrap);
        requestAnimationFrame(() => paint(c, title, x, series, chartOpts));
    };

    mk(
        `Lπ 策略损失（细=逐局，粗=MA${MA_LOSS}）`,
        [
            { label: `MA${MA_LOSS}`, color: C_LP_MA, y: lpMa, lineWidth: 2 },
            { label: 'Lπ', color: C_LP_RAW, y: lp, lineWidth: RAW_LINE_WIDTH }
        ],
        { robustClip: true },
        `Lπ：策略网络（actor）的损失，与带优势的策略梯度相关。细线为逐局值（噪声大），粗线为最近 ${MA_LOSS} 局滑动平均，便于看收敛趋势；纵轴对离群点做了温和裁剪。`
    );

    mk(
        `Lv 价值损失（细=逐局，粗=MA${MA_LOSS}）`,
        [
            { label: `MA${MA_LOSS}`, color: C_LV_MA, y: lvMa, lineWidth: 2 },
            { label: 'Lv', color: C_LV_RAW, y: lv, lineWidth: RAW_LINE_WIDTH }
        ],
        { robustClip: true },
        `Lv：价值网络（critic）的损失，衡量对回报或价值目标的拟合误差。单局尖峰常见，请优先看粗线滑动平均与摘要中的「均Lv」。`
    );

    mk(
        '策略熵 H(π)',
        [{ label: 'entropy', color: '#5b1f8a', y: ent, lineWidth: 1.75 }],
        {
            yMinFloor: 0
        },
        '策略输出分布的熵。较高表示策略更随机、探索更强；过低可能过早收敛到次优动作。'
    );

    mk(
        '轨迹长度 step_count（批量为当批均值）',
        [{ label: 'steps', color: '#2d5a18', y: st, lineWidth: 1.75 }],
        {
            yMinFloor: 0
        },
        '单局环境推进的步数（批量训练时可为批内平均）。步数异常升高或波动可提示环境卡住、局过长或批量设置变化。'
    );

    const wrMa = rollingMean(won01, MA_PERF);
    mk(
        `近${MA_PERF}局滑动胜率（0–1；批量为窗口内平均）`,
        [{ label: `winRate MA${MA_PERF}`, color: '#8a0e38', y: wrMa, lineWidth: 1.9 }],
        {
            yMinFloor: 0,
            yMaxCeil: 1,
            yTick: (v) => `${(v * 100).toFixed(0)}%`
        },
        `最近 ${MA_PERF} 局的滑动平均胜率（0～1）。需日志中含 win_rate 或 won 字段；纵轴以百分比刻度显示。`
    );

    const scMa = rollingMean(scores, MA_PERF);
    mk(
        `对局得分（细=逐局，粗=MA${MA_PERF} 趋势）`,
        [
            { label: `MA${MA_PERF}`, color: C_SC_MA, y: scMa, lineWidth: 2.5 },
            { label: 'score', color: C_SC_RAW, y: scores, lineWidth: RAW_LINE_WIDTH }
        ],
        { yMinFloor: 0 },
        `每局游戏得分；细线为逐局、粗线为最近 ${MA_PERF} 局滑动平均。需 train_episode 中含 score 字段。`
    );
}
