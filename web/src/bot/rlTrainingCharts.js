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

    for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.lineWidth ?? 1.5;
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

    el.innerHTML = [
        `<span>末局 <strong>${lastEp}</strong></span> · `,
        `<span>近${SUMMARY_N}局均分 <strong>${fmt(avgScore, 1)}</strong></span> · `,
        `<span>近${SUMMARY_N}局胜率 <strong>${winRate == null ? '—' : fmtPct(winRate)}</strong></span> · `,
        `<span>近${SUMMARY_N}局均熵 <strong>${fmt(avgEnt, 2)}</strong></span> · `,
        `<span>近${SUMMARY_N}局均Lv <strong>${fmt(avgLv, 1)}</strong></span>`,
        `<span class="rl-dash-note">单局 Lv 尖峰常见；看<strong>深色滑动线</strong>与本摘要趋势更稳。得分/胜率依赖日志字段 <code>score</code>/<code>won</code>。</span>`
    ].join('');
}

/**
 * @param {HTMLElement | null} root
 * @param {object[]} entries
 * @param {HTMLElement | null} [summaryEl]
 */
export function updateRlTrainingCharts(root, entries, summaryEl = null) {
    const sumEl = summaryEl ?? document.getElementById('rl-dash-summary');

    if (!root) {
        if (sumEl) {
            sumEl.textContent = '';
        }
        return;
    }
    root.replaceChildren();
    const rows = extractTrainEpisodeRows(entries);
    if (rows.length < 2) {
        if (sumEl) {
            sumEl.innerHTML =
                '<span class="rl-dash-note">数据不足：至少需要 2 条 train_episode 记录。</span>';
        }
        const p = document.createElement('p');
        p.className = 'rl-dash-empty';
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
    const lp = rows.map((r) => (typeof r.loss_policy === 'number' ? r.loss_policy : NaN));
    const lv = rows.map((r) => (typeof r.loss_value === 'number' ? r.loss_value : NaN));
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

    const mk = (title, series, chartOpts) => {
        const wrap = document.createElement('div');
        wrap.className = 'rl-chart-wrap';
        const c = document.createElement('canvas');
        c.className = 'rl-chart-canvas';
        wrap.appendChild(c);
        root.appendChild(wrap);
        requestAnimationFrame(() => paint(c, title, x, series, chartOpts));
    };

    mk(
        `Lπ 策略损失（浅=逐局，深=MA${MA_LOSS}）`,
        [
            { label: 'Lπ', color: 'rgba(68, 114, 196, 0.18)', y: lp, lineWidth: 0.7 },
            { label: `MA${MA_LOSS}`, color: '#1a3f7a', y: lpMa, lineWidth: 2 }
        ],
        { robustClip: true }
    );

    mk(
        `Lv 价值损失（浅=逐局，深=MA${MA_LOSS}）`,
        [
            { label: 'Lv', color: 'rgba(197, 90, 17, 0.18)', y: lv, lineWidth: 0.7 },
            { label: `MA${MA_LOSS}`, color: '#7a2d00', y: lvMa, lineWidth: 2 }
        ],
        { robustClip: true }
    );

    mk('策略熵 H(π)', [{ label: 'entropy', color: '#5b1f8a', y: ent, lineWidth: 1.5 }], {
        yMinFloor: 0
    });

    mk('轨迹长度 step_count（批量为当批均值）', [{ label: 'steps', color: '#3a6b1e', y: st, lineWidth: 1.5 }], {
        yMinFloor: 0
    });

    const wrMa = rollingMean(won01, MA_PERF);
    mk(
        `近${MA_PERF}局滑动胜率（0–1；批量为窗口内平均）`,
        [{ label: `winRate MA${MA_PERF}`, color: '#9a1040', y: wrMa, lineWidth: 1.75 }],
        {
            yMinFloor: 0,
            yMaxCeil: 1,
            yTick: (v) => `${(v * 100).toFixed(0)}%`
        }
    );

    const scMa = rollingMean(scores, MA_PERF);
    mk(
        `对局得分（浅=逐局，深=MA${MA_PERF} 趋势）`,
        [
            { label: 'score', color: 'rgba(0, 160, 144, 0.18)', y: scores, lineWidth: 0.7 },
            { label: `MA${MA_PERF}`, color: '#005a52', y: scMa, lineWidth: 2.5 }
        ],
        { yMinFloor: 0 }
    );
}
