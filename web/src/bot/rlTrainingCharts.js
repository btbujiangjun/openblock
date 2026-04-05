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

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cssW
 * @param {number} cssH
 * @param {string} title
 * @param {number[]} x
 * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[] }[]} series
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string } | undefined} chartOpts
 */
function drawLineChart(ctx, cssW, cssH, title, x, series, chartOpts) {
    const padL = 46;
    const padR = 10;
    const padT = 20;
    const padB = 24;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#5d7a96';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(title, padL, 14);

    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of series) {
        for (let i = 0; i < s.y.length; i++) {
            const v = s.y[i];
            if (typeof v === 'number' && Number.isFinite(v)) {
                ymin = Math.min(ymin, v);
                ymax = Math.max(ymax, v);
            }
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

    const yTick = chartOpts?.yTick ?? ((v) => v.toFixed(3));

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
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(yTick(v), 2, y + 3);
    }

    ctx.fillStyle = '#8a9bab';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(String(xmin), padL, cssH - 6);
    ctx.fillText(String(xmax), padL + plotW - 28, cssH - 6);

    for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.lineWidth ?? 1.5;
        ctx.setLineDash(s.dash || []);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < x.length; i++) {
            const v = s.y[i];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                started = false;
                continue;
            }
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
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string } | undefined} chartOpts
 */
function paint(canvas, title, x, series, chartOpts) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = canvas.parentElement;
    const cssW = Math.max(260, parent?.clientWidth || canvas.clientWidth || 320);
    const cssH = 108;
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

    const withWon = slice.filter((r) => typeof r.won === 'boolean');
    const winRate =
        withWon.length > 0 ? withWon.filter((r) => r.won).length / withWon.length : null;

    const ents = slice.map((r) => r.entropy).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgEnt = ents.length ? ents.reduce((a, b) => a + b, 0) / ents.length : null;

    const lvTail = slice
        .map((r) => r.loss_value)
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgLv = lvTail.length ? lvTail.reduce((a, b) => a + b, 0) / lvTail.length : null;

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
                ? '暂无 train_episode 记录。勾选 PyTorch 后端并开始训练后刷新。'
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
        typeof r.won === 'boolean' ? (r.won ? 1 : 0) : NaN
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
            { label: 'Lπ', color: 'rgba(68, 114, 196, 0.35)', y: lp, lineWidth: 1 },
            { label: `MA${MA_LOSS}`, color: '#2e5090', y: lpMa, lineWidth: 2 }
        ],
        undefined
    );

    mk(
        `Lv 价值损失（浅=逐局，深=MA${MA_LOSS}；诊断看深色线）`,
        [
            { label: 'Lv', color: 'rgba(197, 90, 17, 0.35)', y: lv, lineWidth: 1 },
            { label: `MA${MA_LOSS}`, color: '#a04000', y: lvMa, lineWidth: 2 }
        ],
        undefined
    );

    mk('策略熵 H(π)', [{ label: 'entropy', color: '#7030a0', y: ent, lineWidth: 1.5 }], {
        yMinFloor: 0
    });

    mk('本局轨迹长度 step_count', [{ label: 'steps', color: '#548235', y: st, lineWidth: 1.5 }], {
        yMinFloor: 0
    });

    const hasWon = won01.some((v) => Number.isFinite(v));
    if (hasWon) {
        const wrMa = rollingMean(won01, MA_PERF);
        mk(
            `近${MA_PERF}局滑动胜率（0–1，均值为窗口内胜局比例）`,
            [{ label: `winRate MA${MA_PERF}`, color: '#b83b5e', y: wrMa, lineWidth: 2 }],
            {
                yMinFloor: 0,
                yMaxCeil: 1,
                yTick: (v) => `${(v * 100).toFixed(0)}%`
            }
        );
    }

    const hasScore = scores.some((v) => Number.isFinite(v));
    if (hasScore) {
        const scMa = rollingMean(scores, MA_PERF);
        mk(
            `对局得分（浅=逐局，深=MA${MA_PERF} 趋势）`,
            [
                { label: 'score', color: 'rgba(0, 160, 144, 0.35)', y: scores, lineWidth: 1 },
                { label: `MA${MA_PERF}`, color: '#007a6e', y: scMa, lineWidth: 2.5 }
            ],
            { yMinFloor: 0 }
        );
    }
}
