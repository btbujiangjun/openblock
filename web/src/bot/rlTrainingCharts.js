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
    let segmentStart = 0;
    for (let i = 1; i < raw.length; i++) {
        if (raw[i].episodes < raw[i - 1].episodes) {
            segmentStart = i;
        }
    }
    const map = new Map();
    for (const r of raw.slice(segmentStart)) {
        map.set(r.episodes, r);
    }
    return [...map.values()];
}

/** 单图 CSS 高度：紧凑展示 8 个同级面板 */
const CHART_CSS_H = 64;
/** 逐局序列：细线宽；滑动平均仍用 2～2.5 */
const RAW_LINE_WIDTH = 0.68;

/** 旧版日志或未裁剪的异常标量：不参与折线绘制，避免纵轴被单点拉到 1e30+ */
function sanitizeLossForChart(v, maxAbs = 1e7) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NaN;
    if (Math.abs(v) > maxAbs) return NaN;
    return v;
}

/** 熵应为非负小量；过滤后端哨兵值（如 -1e6），避免摘要和纵轴被污染。 */
function sanitizeEntropyForChart(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NaN;
    if (v < 0 || v > 10) return NaN;
    return v;
}

/** @param {number[]} values */
function hasFinite(values) {
    return values.some((v) => typeof v === 'number' && Number.isFinite(v));
}

/** @param {number[]} values */
function hasPositiveFinite(values) {
    return values.some((v) => typeof v === 'number' && Number.isFinite(v) && v > 1e-9);
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

/** 图例标签缩短，节省画布内空间（完整语义见 legendHint / title 气泡） */
const LEGEND_ABBREV = {
    'Q coverage': 'Qcov',
    'visit coverage': 'visit',
    'q entropy norm': 'qHn',
    'q top margin': 'marg',
    'visit_pi distill': 'vπdst',
    'replay ratio': 'replay',
};

/** @param {string} raw @param {boolean} compact */
function abbrevLegendLabel(raw, compact) {
    if (LEGEND_ABBREV[raw]) {
        return LEGEND_ABBREV[raw];
    }
    const max = compact ? 9 : 14;
    if (raw.length <= max) {
        return raw;
    }
    return `${raw.slice(0, max - 1)}…`;
}

/**
 * 图例悬停（canvas.title）：本条曲线说明 + 整张图说明，便于 cursor:help 展示完整口径。
 * @param {string} [lineHint]
 * @param {string} [panelHint]
 * @param {string} labelFallback
 */
function formatLegendHoverHint(lineHint, panelHint, labelFallback) {
    const L = lineHint && String(lineHint).trim();
    const P = panelHint && String(panelHint).trim();
    if (L && P) {
        return `【本条曲线】${L}\n\n【整张图说明】${P}`;
    }
    return L || P || labelFallback;
}

/**
 * 画布内右上角紧凑图例（自动换行、无底色），避免 HTML 下图例撑高侧栏。
 * @param {string} [panelHint] 与 paint 传入的整张图说明合并进悬停提示
 * @returns {{ x: number, y: number, w: number, h: number, hint: string }[]}
 */
function drawInlineLegendStrip(
    ctx,
    series,
    padL,
    padT,
    plotW,
    plotH,
    compact,
    panelHint = ''
) {
    const hits = [];
    if (!series?.length || plotW < 72 || plotH < 18) {
        return hits;
    }

    /* 侧栏图极矮：用小字号图例，避免占满纵向空间 */
    const fontPx = compact ? 5.5 : 7;
    const sw = compact ? 7 : 10;
    const sh = 2;
    const gap = 2;
    const padSeg = 3;
    const rowPad = 2;
    const maxRowW = Math.max(72, plotW - 24);

    ctx.font = `${fontPx}px system-ui, sans-serif`;

    /** @type {{ s: (typeof series)[0], lab: string, w: number }[][] } */
    const rows = [];
    let cur = [];
    let rowW = 0;
    for (const s of series) {
        const lab = abbrevLegendLabel(s.label, compact);
        const tw = ctx.measureText(lab).width;
        const segW = sw + gap + tw + padSeg;
        if (rowW + segW > maxRowW && cur.length > 0) {
            rows.push(cur);
            cur = [];
            rowW = 0;
        }
        cur.push({ s, lab, w: segW });
        rowW += segW;
    }
    if (cur.length) {
        rows.push(cur);
    }

    const rowH = Math.max(fontPx, sh) + 3;
    const drawH = rows.length * rowH + rowPad * 2;
    /* 仍过高则放弃绘制（避免遮挡整条曲线） */
    if (drawH > plotH * 0.42) {
        return hits;
    }

    let boxW = 0;
    for (const row of rows) {
        const rw = row.reduce((a, seg) => a + seg.w, 0);
        boxW = Math.max(boxW, rw);
    }
    boxW += 8;
    const bx = padL + plotW - boxW - 1;
    const by = padT + 1;

    ctx.save();

    let y = by + rowPad;
    for (const row of rows) {
        let x = bx + rowPad;
        for (const seg of row) {
            const { s } = seg;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 1.35;
            ctx.setLineDash(s.dash || []);
            if (s.dash?.length) {
                ctx.beginPath();
                ctx.moveTo(x, y + sh / 2 + 0.5);
                ctx.lineTo(x + sw, y + sh / 2 + 0.5);
                ctx.stroke();
            } else {
                ctx.fillStyle = s.color;
                ctx.fillRect(x, y + 1, sw, sh);
            }
            ctx.setLineDash([]);
            /* 无底色时用电晕描边提高标签在曲线上的可读性 */
            ctx.save();
            ctx.shadowColor = 'rgba(8, 12, 20, 0.9)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = '#b8cad9';
            ctx.font = `${fontPx}px system-ui, sans-serif`;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(seg.lab, x + sw + gap, y + fontPx);
            ctx.restore();

            x += seg.w;
        }
        y += rowH;
    }
    ctx.restore();

    y = by + rowPad;
    for (const row of rows) {
        let x = bx + rowPad;
        for (const seg of row) {
            const hint = formatLegendHoverHint(seg.s.legendHint, panelHint, seg.lab);
            hits.push({
                x: x - 1,
                y: y - 1,
                w: seg.w + 1,
                h: rowH,
                hint,
            });
            x += seg.w;
        }
        y += rowH;
    }

    return hits;
}

/** @type {WeakSet<HTMLCanvasElement>} */
const _legendHoverWired = new WeakSet();

/** @param {HTMLCanvasElement} canvas */
function wireLegendHover(canvas) {
    if (_legendHoverWired.has(canvas)) {
        return;
    }
    _legendHoverWired.add(canvas);
    canvas.addEventListener(
        'mousemove',
        (ev) => {
            const ox = ev.offsetX;
            const oy = ev.offsetY;
            const hits = canvas._rlLegendHits;
            const fb = canvas._rlCanvasHint || '';
            if (!hits?.length) {
                canvas.title = fb;
                canvas.style.cursor = '';
                return;
            }
            for (const h of hits) {
                if (ox >= h.x && ox <= h.x + h.w && oy >= h.y && oy <= h.y + h.h) {
                    canvas.title = h.hint;
                    canvas.style.cursor = 'help';
                    return;
                }
            }
            canvas.title = fb;
            canvas.style.cursor = '';
        },
        { passive: true }
    );
    canvas.addEventListener(
        'mouseleave',
        () => {
            canvas.title = canvas._rlCanvasHint || '';
            canvas.style.cursor = '';
        },
        { passive: true }
    );
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cssW
 * @param {number} cssH
 * @param {string} title
 * @param {number[]} x
 * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[], legendHint?: string }[]} series
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number, robustClip?: boolean, emptyMessage?: string, showCanvasTitle?: boolean } | undefined} chartOpts
 * @param {string} [panelHint] 整张图说明；与每条 legendHint 合并后写入图例悬停 title
 * @returns {{ x: number, y: number, w: number, h: number, hint: string }[]}
 */
function drawLineChart(ctx, cssW, cssH, title, x, series, chartOpts, panelHint = '') {
    const compact = cssH <= 96;
    const padL = compact ? 40 : 50;
    const padR = compact ? 5 : 10;
    const showCanvasTitle = chartOpts?.showCanvasTitle === true;
    const padT = showCanvasTitle ? (compact ? 13 : 20) : (compact ? 5 : 10);
    const padB = compact ? 18 : 30;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    ctx.clearRect(0, 0, cssW, cssH);
    if (showCanvasTitle) {
        ctx.fillStyle = '#5d7a96';
        ctx.font = compact ? '600 8.5px system-ui, sans-serif' : '600 10px system-ui, sans-serif';
        ctx.fillText(title, padL, compact ? 11 : 14);
    }

    if (chartOpts?.emptyMessage) {
        ctx.fillStyle = '#8a9bab';
        ctx.font = compact ? '8px system-ui, sans-serif' : '10px system-ui, sans-serif';
        const maxW = Math.max(120, cssW - padL - padR - 8);
        const text = chartOpts.emptyMessage;
        const words = text.split('');
        let line = '';
        let y = padT + Math.max(18, plotH * 0.42);
        for (const ch of words) {
            const next = line + ch;
            if (ctx.measureText(next).width > maxW && line) {
                ctx.fillText(line, padL, y);
                line = ch;
                y += compact ? 12 : 15;
            } else {
                line = next;
            }
        }
        if (line) {
            ctx.fillText(line, padL, y);
        }
        return [];
    }

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

    return drawInlineLegendStrip(ctx, series, padL, padT, plotW, plotH, compact, panelHint);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} title
 * @param {number[]} x
 * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[], legendHint?: string }[]} series
 * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number } | undefined} chartOpts
 * @param {string} [canvasHint] 悬停空白处 canvas.title；图例项为 legendHint 与本字符串合并后的完整说明
 */
function paint(canvas, title, x, series, chartOpts, canvasHint = '') {
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
    const legendHits = drawLineChart(ctx, cssW, cssH, title, x, series, chartOpts, canvasHint);
    canvas._rlLegendHits = legendHits;
    canvas._rlCanvasHint = canvasHint;
    canvas.title = canvasHint;
    wireLegendHover(canvas);
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

/** @param {string} s */
function escapeHtmlText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * @param {number[]} values
 * @returns {{ avg: number | null, count: number }}
 */
function avgFiniteInfo(values) {
    const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return {
        avg: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null,
        count: finite.length
    };
}

/**
 * @param {object[]} rows
 * @returns {{
 *   size: number,
 *   avgScore: number | null,
 *   scoreCount: number,
 *   winRate: number | null,
 *   winCount: number,
 *   avgEnt: number | null,
 *   entCount: number,
 *   avgLv: number | null,
 *   lvCount: number,
 *   avgTqCov: number | null,
 *   tqCount: number,
 *   avgReplayRatio: number | null,
 *   replayCount: number,
 *   avgQH: number | null,
 *   qhCount: number,
 *   optimizerKnown: number,
 *   optimizerStepped: number,
 *   optimizerSkipReason: string
 * }}
 */
function summarizeRows(rows) {
    const scores = avgFiniteInfo(rows.map((r) => r.score));
    const withWinRate = rows.filter((r) => typeof r.win_rate === 'number' && Number.isFinite(r.win_rate));
    const withWon = rows.filter((r) => typeof r.won === 'boolean');
    const winRate = withWinRate.length > 0
        ? withWinRate.reduce((a, r) => a + r.win_rate, 0) / withWinRate.length
        : withWon.length > 0
            ? withWon.filter((r) => r.won).length / withWon.length
            : null;
    const ents = avgFiniteInfo(rows.map((r) => sanitizeEntropyForChart(r.entropy)));
    const lvTail = rows
        .map((r) => r.loss_value)
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const lvClip = robustRange(lvTail);
    const lvClean = lvClip
        ? lvTail.filter((v) => v >= lvClip.lo && v <= lvClip.hi)
        : lvTail;
    const lv = avgFiniteInfo(lvClean);
    const tq = avgFiniteInfo(rows.map((r) => r.teacher_q_coverage));
    const qh = avgFiniteInfo(rows.map((r) => r.teacher_q_entropy_norm));
    const replay = avgFiniteInfo(rows.map((r) => {
        const pg = typeof r.pg_steps === 'number' ? r.pg_steps : 0;
        const replaySteps = typeof r.replay_steps === 'number' ? r.replay_steps : 0;
        const total = pg + replaySteps;
        return total > 0 ? Math.max(0, Math.min(1, replaySteps / total)) : NaN;
    }));
    const optimizerRows = rows.filter((r) => typeof r.optimizer_step === 'boolean');
    const optimizerStepped = optimizerRows.filter((r) => r.optimizer_step === true).length;
    const skipReasons = rows
        .map((r) => (typeof r.optimizer_skip_reason === 'string' ? r.optimizer_skip_reason : ''))
        .filter(Boolean);
    return {
        size: rows.length,
        avgScore: scores.avg,
        scoreCount: scores.count,
        winRate,
        winCount: withWinRate.length > 0 ? withWinRate.length : withWon.length,
        avgEnt: ents.avg,
        entCount: ents.count,
        avgLv: lv.avg,
        lvCount: lv.count,
        avgTqCov: tq.avg,
        tqCount: tq.count,
        avgReplayRatio: replay.avg,
        replayCount: replay.count,
        avgQH: qh.avg,
        qhCount: qh.count,
        optimizerKnown: optimizerRows.length,
        optimizerStepped,
        optimizerSkipReason: skipReasons.length ? skipReasons[skipReasons.length - 1] : ''
    };
}

/**
 * @param {number | null} current
 * @param {number | null} prev
 * @param {number} minDelta
 */
function trendLabel(current, prev, minDelta) {
    if (current == null) {
        return '暂无当前样本';
    }
    if (prev == null) {
        return '暂无上窗对比';
    }
    const delta = current - prev;
    if (Math.abs(delta) < minDelta) {
        return '基本持平';
    }
    return delta > 0 ? '上行' : '回落';
}

/**
 * @param {object[]} rows sorted train_episode rows
 * @returns {string}
 */
function buildInsightHtml(rows) {
    const slice = rows.slice(-SUMMARY_N);
    const prevSlice = rows.slice(-SUMMARY_N * 2, -SUMMARY_N);
    const now = summarizeRows(slice);
    const prev = summarizeRows(prevSlice);
    const fmt = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
    const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
    const val = (v) => `<strong>${escapeHtmlText(v)}</strong>`;

    const teacherText = now.avgTqCov == null
        ? 'teacher 暂无覆盖数据'
        : now.avgTqCov <= 1e-9
            ? `teacher 覆盖为 ${val('0')}`
            : `teacher 覆盖 ${val(fmtPct(now.avgTqCov))}`;
    const replayText = now.avgReplayRatio == null
        ? 'replay 暂无占比'
        : `replay 占比 ${val(fmtPct(now.avgReplayRatio))}`;
    const optimizerText = now.optimizerKnown
        ? `更新成功 ${val(`${now.optimizerStepped}/${now.optimizerKnown}`)}${now.optimizerStepped < now.optimizerKnown && now.optimizerSkipReason ? `（${escapeHtmlText(now.optimizerSkipReason)}）` : ''}`
        : '更新状态暂无字段';
    const windowLabel = now.size < SUMMARY_N ? `最近${now.size}条` : `近${SUMMARY_N}局`;
    const updatedAt = new Date().toLocaleTimeString();
    const html =
        `运行状态：${windowLabel}均分 ${val(fmt(now.avgScore, 1))}` +
        `（${escapeHtmlText(trendLabel(now.avgScore, prev.avgScore, 10))}，有效 ${val(`${now.scoreCount}/${now.size}`)}），` +
        `胜率 ${val(fmtPct(now.winRate))}` +
        `（${escapeHtmlText(trendLabel(now.winRate, prev.winRate, 0.03))}，有效 ${val(`${now.winCount}/${now.size}`)}），` +
        `均Lv ${val(fmt(now.avgLv, 1))}。` +
        `单局 Lv 尖峰常见，看粗线滑动平均与本摘要趋势更稳；熵 ${val(fmt(now.avgEnt, 2))}，${teacherText}，${replayText}，${optimizerText}。`;

    return `<span class="rl-dash-insight-line">${html} <time datetime="${new Date().toISOString()}">更新 ${escapeHtmlText(updatedAt)}</time></span>`;
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
    const stats = summarizeRows(slice);

    const fmt = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
    const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

    const tipLast =
        '训练日志中最后一条 train_episode 对应的回合序号（episodes），即当前已记录到的最新一局编号。';
    const tipAvgScore = `在最近 ${SUMMARY_N} 条 train_episode 中，对有效 score 字段求算术平均；用于观察近期对局得分水平（受右侧「最近 N 局」裁剪影响）。`;
    const tipWin = `在最近 ${SUMMARY_N} 条记录上：若存在 win_rate 则对其求平均；否则若有 won（胜负）字段则统计胜率。反映近期胜负走势。`;
    const tipEnt =
        '策略分布熵 H(π) 在最近若干局上的平均。偏高表示策略更随机、探索更足；偏低表示策略更尖锐、更确定。';
    const tipLv = `价值网络损失 loss_value 在最近 ${SUMMARY_N} 局上的平均；已对极端离群值做 IQR 裁剪后再平均，减轻单局尖峰对摘要的干扰。`;
    const tipTq = `最近 ${SUMMARY_N} 条记录中 teacher_q_coverage 的平均值。0 表示没有 Q teacher 目标，越高表示越多步骤有 beam/MCTS Q 蒸馏监督。`;
    const tipReplay = `最近 ${SUMMARY_N} 条记录中 replay_steps / (pg_steps + replay_steps) 的平均值。过高时需警惕 replay 对 value/aux/distill 的占比压过新鲜样本。`;
    const tipQH = `最近 ${SUMMARY_N} 条记录中 teacher_q_entropy_norm 的平均值。接近 1 表示 teacher 目标较平，接近 0 表示目标很尖锐。`;

    const parts = [
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipLast)}">末局 <strong>${lastEp}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipAvgScore)}">均分 <strong>${fmt(stats.avgScore, 1)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipWin)}">胜率 <strong>${stats.winRate == null ? '—' : fmtPct(stats.winRate)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipEnt)}">熵 <strong>${fmt(stats.avgEnt, 2)}</strong></span> · `,
        `<span class="rl-dash-metric" title="${escapeHtmlAttr(tipLv)}">Lv <strong>${fmt(stats.avgLv, 1)}</strong></span>`
    ];
    if (stats.avgTqCov != null) {
        parts.push(` · <span class="rl-dash-metric" title="${escapeHtmlAttr(tipTq)}">tq <strong>${fmtPct(stats.avgTqCov)}</strong></span>`);
    }
    if (stats.avgReplayRatio != null) {
        parts.push(` · <span class="rl-dash-metric" title="${escapeHtmlAttr(tipReplay)}">replay <strong>${fmtPct(stats.avgReplayRatio)}</strong></span>`);
    }
    if (stats.avgQH != null) {
        parts.push(` · <span class="rl-dash-metric" title="${escapeHtmlAttr(tipQH)}">qH <strong>${fmt(stats.avgQH, 2)}</strong></span>`);
    }
    el.innerHTML = `<span class="rl-dash-summary-line">${parts.join('')}</span>${buildInsightHtml(rows)}`;
}

/**
 * @param {HTMLElement | null} root
 * @param {object[]} entries
 * @param {HTMLElement | null} [summaryEl]
 * @param {number} [maxEpisodes] 仅显示最近 N 局（按 episodes 字段裁剪）；0 或不传表示全部
 * @param {{ path?: string, source?: string } | null} [_sourceInfo]
 */
export function updateRlTrainingCharts(root, entries, summaryEl = null, maxEpisodes = 0, _sourceInfo = null) {
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
                '<span class="rl-dash-note" title="训练曲线需要至少 2 个回合点才能画折线。请完成自博弈或 PyTorch 训练并写入 train_episode 日志后刷新。">运行状态：数据不足，至少需要 2 条 train_episode 记录。继续训练或刷新日志后，本卡片会同步更新摘要与解读。</span>';
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
    const lp = rows.map((r) => sanitizeLossForChart(r.loss_policy, 1e5));
    const lv = rows.map((r) => sanitizeLossForChart(r.loss_value));
    const ent = rows.map((r) => sanitizeEntropyForChart(r.entropy));
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

    let panelIdx = 0;
    /**
     * @param {HTMLElement} target
     * @param {string} title
     * @param {{ label: string, color: string, y: number[], lineWidth?: number, dash?: number[] }[]} series
     * @param {{ yMinFloor?: number, yMaxCeil?: number, yTick?: (v: number) => string, cssH?: number, robustClip?: boolean, emptyMessage?: string, showCanvasTitle?: boolean } | undefined} chartOpts
     * @param {string} [hint] 鼠标悬停整块图表时的说明
     */
    const mkInto = (target, title, series, chartOpts, hint) => {
        panelIdx += 1;
        const panel = document.createElement('details');
        panel.className = 'rl-chart-panel';
        panel.open = true;
        if (hint) {
            panel.title = hint;
        }
        const summary = document.createElement('summary');
        summary.className = 'rl-chart-panel-head';
        const label = document.createElement('span');
        label.className = 'rl-chart-panel-title';
        label.textContent = `${panelIdx}. ${title}`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'rl-chart-toggle';
        const syncToggle = () => {
            toggle.textContent = panel.open ? '收起' : '展开';
            toggle.setAttribute('aria-label', `${panel.open ? '收起' : '展开'} ${title}`);
        };
        syncToggle();
        toggle.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            panel.open = !panel.open;
            syncToggle();
        });
        panel.addEventListener('toggle', syncToggle);
        summary.append(label, toggle);
        const wrap = document.createElement('div');
        wrap.className = 'rl-chart-wrap';
        const c = document.createElement('canvas');
        if (chartOpts?.emptyMessage) {
            const empty = document.createElement('p');
            empty.className = 'rl-chart-empty-inline';
            empty.textContent = chartOpts.emptyMessage;
            wrap.appendChild(empty);
        } else {
            c.className = 'rl-chart-canvas';
            wrap.appendChild(c);
        }
        panel.append(summary, wrap);
        target.appendChild(panel);
        if (!chartOpts?.emptyMessage) {
            requestAnimationFrame(() => paint(c, title, x, series, chartOpts, hint || ''));
        }
    };
    const mk = (title, series, chartOpts, hint) => mkInto(root, title, series, chartOpts, hint);

    mk(
        `Lπ 策略损失（细=逐局，粗=MA${MA_LOSS}）`,
        [
            {
                label: `MA${MA_LOSS}`,
                color: C_LP_MA,
                y: lpMa,
                lineWidth: 2,
                legendHint: `粗线：对日志字段 loss_policy 取最近 ${MA_LOSS} 局算术滑动平均（MA${MA_LOSS}）。表示策略网络（actor）的 surrogate / 策略梯度类损失的整体趋势，噪声已平滑。本图纵轴启用 robust 裁剪，弱化个别极端离群点。判读：优先看粗线是否缓慢下行或窄幅横盘；粗线持续上行且胜率不再改善时需警惕。`,
            },
            {
                label: 'Lπ',
                color: C_LP_RAW,
                y: lp,
                lineWidth: RAW_LINE_WIDTH,
                legendHint: `细线：每一局 train_episode 的 loss_policy 原始标量。与带优势（advantage）的策略更新直接相关，局间波动大属常态。判读：不要单独被尖峰吓到，应结合粗线 MA 与右侧胜率/得分。`,
            },
        ],
        { robustClip: true },
        `本图展示策略网络（actor）损失 Lπ。细线=逐局 loss_policy；粗线=最近 ${MA_LOSS} 局滑动平均。与 PPO 系 surrogate、重要性采样裁剪等相关；纵轴对离群点温和裁剪仅便于看图，不改变训练数学。`
    );

    mk(
        `Lv 价值损失（细=逐局，粗=MA${MA_LOSS}）`,
        [
            {
                label: `MA${MA_LOSS}`,
                color: C_LV_MA,
                y: lvMa,
                lineWidth: 2,
                legendHint: `粗线：对 loss_value 的最近 ${MA_LOSS} 局滑动平均。价值网络（critic）对折扣回报、GAE/bootstrap 等价值目标的拟合误差平滑结果；单局尖峰常见，粗线更能反映 critic 是否长期稳定。日志字段：loss_value。`,
            },
            {
                label: 'Lv',
                color: C_LV_RAW,
                y: lv,
                lineWidth: RAW_LINE_WIDTH,
                legendHint: `细线：逐局 loss_value。反映单局回报尺度、目标非平稳或难样本冲击；与摘要条「均Lv」同源字段（摘要侧可能另有统计裁剪）。判读：尖峰单独出现未必异常，关注粗线与外在指标（胜率、得分）是否同步恶化。`,
            },
        ],
        { robustClip: true },
        `本图展示价值网络（critic）损失 Lv（loss_value）。价值分支拟合难度常高于策略分支；单局尖峰常见。优先看粗线 MA 与摘要「均Lv」；若粗线阶跃上升请对照数值稳定性文档中的裁剪与环境变量。纵轴 robust 裁剪便于观察主体趋势。`
    );

    mk(
        '策略熵 H(π)',
        [
            {
                label: 'entropy',
                color: '#5b1f8a',
                y: ent,
                lineWidth: 1.75,
                legendHint: `策略输出分布熵 H(π)，来自 train_episode 的 entropy 字段（当前策略在采样状态下的动作分布熵）。较高：探索更充分、策略更随机；较低：策略更尖锐、更贪心。训练初中期常见缓慢下降（从探索走向利用）。长期贴近 0 且胜率停滞：可能过早收敛；长期过高：策略仍很随机，可利用不足。`,
            },
        ],
        {
            yMinFloor: 0
        },
        `本图为单曲线：策略熵 H(π)。与 actor 输出层的 softmax 分布 spread 相关；常用于观察探索—利用权衡。纵轴下限钳为 0 仅便于显示，实际熵下界取决于动作空间大小。`
    );

    mk(
        '轨迹长度 step_count（批量为当批均值）',
        [
            {
                label: 'steps',
                color: '#2d5a18',
                y: st,
                lineWidth: 1.75,
                legendHint: `单局与环境交互步数，日志字段 step_count（批量训练时部分日志为该批内均值，标题已注明）。反映一局存活长度或交互轮数。异常飙高：局过长、卡住或日志合并口径变化；突然塌缩：提前终止、环境重置或记录缺失。建议与得分、胜率同读。`,
            },
        ],
        {
            yMinFloor: 0
        },
        `本图：轨迹长度 step_count。与任务难度、策略存活能力、最大步数上限等相关；批量训练下可能显示批均值而非 strict 单局，请以日志管线为准。`
    );

    const wrMa = rollingMean(won01, MA_PERF);
    mk(
        `近${MA_PERF}局滑动胜率（0–1；批量为窗口内平均）`,
        [
            {
                label: `winRate MA${MA_PERF}`,
                color: '#8a0e38',
                y: wrMa,
                lineWidth: 1.9,
                legendHint: `最近 ${MA_PERF} 局滑动平均胜率，取值 0～1。数据来源：优先使用每条 train_episode 的 win_rate；若无该字段则用 won 布尔折算当局 1/0。纵轴按百分比显示仅为可读性。判读：是否相对当前对手（含自博弈）稳定占优；平台化后持续下滑需对照课程/阈值/对手分布是否变化。`,
            },
        ],
        {
            yMinFloor: 0,
            yMaxCeil: 1,
            yTick: (v) => `${(v * 100).toFixed(0)}%`
        },
        `本图：近 ${MA_PERF} 局滑动窗口内的平均胜率（非单点瞬时胜率）。需日志含 win_rate 或 won；否则该图为空或断续。自博弈下胜率回落不一定为 bug，需结合得分、步数与超参变更记录。`
    );

    const scMa = rollingMean(scores, MA_PERF);
    mk(
        `对局得分（细=逐局，粗=MA${MA_PERF} 趋势）`,
        [
            {
                label: `MA${MA_PERF}`,
                color: C_SC_MA,
                y: scMa,
                lineWidth: 2.5,
                legendHint: `粗线：对 score 的最近 ${MA_PERF} 局滑动平均，用于抑制逐局噪声、观察长期得分趋势。应与胜率、步数同向对照；若得分涨而胜率跌，可能奖励与胜负口径不一致或存在「刷分不赢」行为。`,
            },
            {
                label: 'score',
                color: C_SC_RAW,
                y: scores,
                lineWidth: RAW_LINE_WIDTH,
                legendHint: `细线：每局 train_episode 的 score 原始值。依赖环境奖励定义与局长；缺失 score 字段则该序列为空。判读：勿孤立看分，需结合胜利标签与步数。`,
            },
        ],
        { yMinFloor: 0 },
        `本图：对局得分。细线=逐局 score；粗线=最近 ${MA_PERF} 局滑动平均。字段来自 train_episode.score；与任务奖励缩放、存活步数强相关。`
    );

    const qCov = rows.map((r) => (typeof r.teacher_q_coverage === 'number' ? r.teacher_q_coverage : NaN));
    const vCov = rows.map((r) => (typeof r.teacher_visit_coverage === 'number' ? r.teacher_visit_coverage : NaN));
    const qEntropy = rows.map((r) => (typeof r.teacher_q_entropy_norm === 'number' ? r.teacher_q_entropy_norm : NaN));
    const qMargin = rows.map((r) => (typeof r.teacher_q_margin === 'number' ? r.teacher_q_margin : NaN));
    const qDistill = rows.map((r) => sanitizeLossForChart(r.loss_q_distill));
    const visitDistill = rows.map((r) => sanitizeLossForChart(r.loss_visit_pi));
    const replayRatio = rows.map((r) => {
        const pg = typeof r.pg_steps === 'number' ? r.pg_steps : 0;
        const replay = typeof r.replay_steps === 'number' ? r.replay_steps : 0;
        const total = pg + replay;
        return total > 0 ? Math.max(0, Math.min(1, replay / total)) : NaN;
    });

    const hasAnyTeacherField = [qCov, vCov, qEntropy, qMargin].some(hasFinite);
    const hasActiveTeacher = [qCov, vCov, qEntropy, qMargin].some(hasPositiveFinite);
    const teacherEmpty = !hasAnyTeacherField
        ? '当前日志没有 teacher_q / teacher_visit 字段；请确认读取的是新的 PyTorch 批量训练日志。'
        : !hasActiveTeacher
            ? '当前日志已有 v9.3 字段，但 teacher 覆盖率与目标形态均为 0：在线训练路径暂未产生 Q/visit_pi teacher 数据。'
            : '';

    mk(
        'Teacher 覆盖与目标形态',
        [
            {
                label: 'Q coverage',
                color: '#1b5e20',
                y: qCov,
                lineWidth: 1.65,
                legendHint:
                    '日志字段 teacher_q_coverage：本批（或本日志步）中，带 Q teacher 监督（beam / lookahead 的 q_vals、在线 q_teacher 等）的优化步占「相关 PG 步」的比例，取值约 0～1。1 表示几乎全部步参与 Q 蒸馏；长期接近 0 表示当前管线未提供 Q teacher，本曲线仅供参考。',
            },
            {
                label: 'visit coverage',
                color: '#0d47a1',
                y: vCov,
                lineWidth: 1.35,
                dash: [4, 3],
                legendHint:
                    '日志字段 teacher_visit_coverage：带 MCTS visit_pi（访问计数分布）teacher 的步占比。纯浏览器轻量 lookahead、无离线 MCTS 时多为 0；启用深度搜索或离线棋谱蒸馏后可上升。',
            },
            {
                label: 'q entropy norm',
                color: '#4a148c',
                y: qEntropy,
                lineWidth: 1.35,
                legendHint:
                    '日志字段 teacher_q_entropy_norm：将 teacher Q 转为概率分布后的熵，再归一化到约 0～1。高：teacher 目标较平、多动作接近；低：目标尖锐、几乎单点。长期接近 1 且 margin 很小：蒸馏信号可能偏弱，需对照 beam 温度/搜索宽度。',
            },
            {
                label: 'q top margin',
                color: '#bf360c',
                y: qMargin,
                lineWidth: 1.15,
                dash: [3, 3],
                legendHint:
                    '日志字段 teacher_q_margin：teacher Q 经归一化/温度 softmax 后，第一名与第二名的差距（top1−top2）。长期过小：teacher 难以区分优劣动作，蒸馏梯度弱；需结合 coverage 与损失曲线判断是否 worth 继续加重 teacher 权重。',
            },
        ],
        { yMinFloor: 0, yMaxCeil: 1, yTick: (v) => `${(v * 100).toFixed(0)}%`, emptyMessage: teacherEmpty || undefined },
        `本图汇总 Teacher 侧诊断：Q / visit 覆盖率（teacher 有没有进场）与 Q 目标形态（teacher 好不好教）。纵轴 0～100% 对应字段一般记录为 0～1。若为空板提示无字段或全 0，说明当前训练路径未写入或未启用对应 teacher。`
    );

    const hasAnyReplayField = [qDistill, visitDistill, replayRatio].some(hasFinite);
    const hasActiveReplay = [qDistill, visitDistill, replayRatio].some(hasPositiveFinite);
    const replayEmpty = !hasAnyReplayField
        ? '当前日志没有 distillation/replay 字段；请确认读取的是新的 PyTorch 批量训练日志。'
        : !hasActiveReplay
            ? '当前批量训练还没有 Q/visit_pi 蒸馏损失或 replay 样本；该面板会在 search teacher 或 replay 生效后出现曲线。'
            : '';

    mk(
        '蒸馏吸收与 Replay 占比',
        [
            {
                label: 'Q distill',
                color: '#00695c',
                y: qDistill,
                lineWidth: 1.65,
                legendHint:
                    '日志字段 loss_q_distill（数值一般为未乘 q_distill_coef 前的原始项）：策略网络对 teacher Q 分布的交叉熵 / KL 类蒸馏损失。下降：学生在贴近 teacher；横盘高位：可能 teacher 弱、权重过小或与 PG 梯度冲突。务必与 teacher_q_coverage 同读：coverage 近 0 时该项参考价值有限。',
            },
            {
                label: 'visit_pi distill',
                color: '#ad1457',
                y: visitDistill,
                lineWidth: 1.25,
                dash: [4, 3],
                legendHint:
                    '日志字段 loss_visit_pi：对 MCTS 访问分布 visit_pi 的蒸馏损失。无离线 MCTS、未提供 visit teacher 时常接近 0；若 coverage 有值而该项仍接近 0，需检查是否单独关闭了 visit 分支或尺度被裁剪。',
            },
            {
                label: 'replay ratio',
                color: '#6d4c41',
                y: replayRatio,
                lineWidth: 1.35,
                legendHint:
                    '由 replay_steps÷(pg_steps+replay_steps) 得到的 search replay 混入比例，取值 0～1。表示旧困难样本 / 搜索缓存Replay 在本批总优化步中的占比；摘要条「replay」与之同源。占比长期过高：新鲜 on-policy 占比不足，可调低 searchReplay.sampleRatio、maxSamples 等。注意：本图三条曲线共用纵轴且启用 robust 裁剪，蒸馏损失量级可与 0～1 的 replay 同时显示——勿把纵轴读数当作同一物理量直接对比。',
            },
        ],
        { yMinFloor: 0, robustClip: true, emptyMessage: replayEmpty || undefined },
        `本图：蒸馏吸收（loss_q_distill、loss_visit_pi）与 replay 占比。用于判断搜索 teacher 是否真的在优化里起作用，以及 replay 是否挤占新鲜样本。三条曲线共用纵轴且 robust 裁剪，数值尺度不可横向混读；replay 始终在 0～1，而蒸馏损失可大于 1。`
    );
}
