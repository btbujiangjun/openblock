import {
    runSpawnEvaluation,
    buildEvaluationInsights,
    computeGoalSubscores,
    SPAWN_EVAL_GENERATORS,
    SPAWN_EVAL_POLICIES,
    SPAWN_EVAL_STRATEGIES,
} from './bot/spawnEvaluation.js';
import { derivePbCurve } from './adaptiveSpawn.js';
import { getApiBaseUrl } from './config.js';
import { getUserId } from './lib/userId.js';
import { latinHypercube } from './tuning/lhsSampler.js';

const $ = (id) => document.getElementById(id);
const LOCAL_CONFIG_KEY = 'openblock_spawn_optimizer_configs_v1';
let _worker = null;
let _workerSeq = 0;
const _workerPending = new Map();

function getEvalWorker() {
    if (typeof Worker === 'undefined') return null;
    if (!_worker) {
        _worker = new Worker(new URL('./spawnEval.worker.js', import.meta.url), { type: 'module' });
        _worker.addEventListener('message', (event) => {
            const { id, ok, report, error } = event.data || {};
            const pending = _workerPending.get(id);
            if (!pending) return;
            _workerPending.delete(id);
            if (ok) pending.resolve(report);
            else pending.reject(new Error(error || 'spawn evaluation failed'));
        });
        _worker.addEventListener('error', (event) => {
            for (const pending of _workerPending.values()) {
                pending.reject(new Error(event.message || 'spawn eval worker error'));
            }
            _workerPending.clear();
            _worker?.terminate();
            _worker = null;
        });
    }
    return _worker;
}

function runEvaluationAsync(options) {
    const worker = getEvalWorker();
    if (!worker) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(runSpawnEvaluation(options)), 20);
        });
    }
    const id = ++_workerSeq;
    return new Promise((resolve, reject) => {
        _workerPending.set(id, { resolve, reject });
        worker.postMessage({ id, options });
    });
}

function fmt(value, digits = 2) {
    if (value == null || Number.isNaN(Number(value))) return '-';
    if (typeof value === 'number') return value.toFixed(digits);
    return String(value);
}

function fillOptions(select, values, defaults) {
    select.innerHTML = '';
    for (const value of values) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        opt.selected = defaults.includes(value);
        select.appendChild(opt);
    }
}

function selectedValues(select) {
    return [...select.selectedOptions].map((opt) => opt.value);
}

function renderSummary(report) {
    const rows = report.rows || [];
    const totalGames = rows.reduce((sum, row) => sum + row.games, 0);
    const maxNoMove = Math.max(0, ...rows.map((row) => row.noMoveRate));
    const bestScore = Math.max(0, ...rows.map((row) => row.scoreMean));
    const maxOvershoot = Math.max(0, ...rows.map((row) => row.overshootRate || 0));

    $('summary').innerHTML = [
        stat('总局数', totalGames),
        stat('最高均分', fmt(bestScore, 1)),
        stat('最大死局率', fmt(maxNoMove * 100, 1) + '%'),
        stat('最大超PB', fmt(maxOvershoot * 100, 1) + '%'),
    ].join('');
}

/**
 * 读取 3 个业务目标滑块,返回偏好强度 (任意比例,内部会归一化)。
 */
function goalsFromUi() {
    return {
        fairness:      Number($('goal-fairness')?.value) || 0,
        excitement:    Number($('goal-excitement')?.value) || 0,
        antiInflation: Number($('goal-anti-inflation')?.value) || 0,
    };
}

/**
 * 把 3 个业务目标偏好映射为底层 6 个权重,喂给 scoreEvaluationRow。
 * 全部为 0 时回退到旧默认 (向后兼容已保存的方案)。
 */
function deriveWeightsFromGoals(goals) {
    const g = {
        fairness:      Math.max(0, Number(goals?.fairness) || 0),
        excitement:    Math.max(0, Number(goals?.excitement) || 0),
        antiInflation: Math.max(0, Number(goals?.antiInflation) || 0),
    };
    const total = g.fairness + g.excitement + g.antiInflation;
    if (total <= 0) {
        return { noMove: 0.35, rewardAgency: 0.25, skillLift: 0.20, fallback: 0.12, pacing: 0.08, antiInflation: 0 };
    }
    const fN = g.fairness / total;
    const eN = g.excitement / total;
    const aN = g.antiInflation / total;
    return {
        noMove:        Number((fN * 0.55).toFixed(4)),
        skillLift:     Number((fN * 0.25).toFixed(4)),
        fallback:      Number((fN * 0.20).toFixed(4)),
        rewardAgency:  Number((eN * 0.65).toFixed(4)),
        pacing:        Number((eN * 0.35).toFixed(4)),
        antiInflation: Number((aN * 1.00).toFixed(4)),
    };
}

function objectiveWeightsFromUi() {
    return deriveWeightsFromGoals(goalsFromUi());
}

function renderWeightDetail() {
    const host = $('weight-detail-table');
    if (!host) return;
    const w = objectiveWeightsFromUi();
    const items = [
        { name: 'noMove',        from: '公平 ⚖️',     value: w.noMove },
        { name: 'skillLift',     from: '公平 ⚖️',     value: w.skillLift },
        { name: 'fallback',      from: '公平 ⚖️',     value: w.fallback },
        { name: 'rewardAgency',  from: '爽点 🎉',     value: w.rewardAgency },
        { name: 'pacing',        from: '爽点 🎉',     value: w.pacing },
        { name: 'antiInflation', from: '抑制膨胀 🛑', value: w.antiInflation },
    ];
    host.innerHTML = items
        .map((it) => `<div title="来源: ${escapeHtml(it.from)}"><span>${escapeHtml(it.name)}</span><span>${it.value.toFixed(3)}</span></div>`)
        .join('');
}

function refreshGoalSliderValues() {
    const f = $('goal-fairness');
    const e = $('goal-excitement');
    const a = $('goal-anti-inflation');
    if (f && $('goal-fairness-pct'))      $('goal-fairness-pct').textContent      = String(f.value);
    if (e && $('goal-excitement-pct'))    $('goal-excitement-pct').textContent    = String(e.value);
    if (a && $('goal-anti-inflation-pct')) $('goal-anti-inflation-pct').textContent = String(a.value);
    renderWeightDetail();
}

function modelConfigFromUi() {
    return {
        personalizationStrength: Number($('personalization-strength')?.value) || 0,
        temperature: Number($('random-temperature')?.value) || 0,
        surpriseBudgetGain: Number($('surprise-gain')?.value) || 0,
        surpriseCooldown: Number($('surprise-cooldown')?.value) || 6,
    };
}

const PB_RATIO_MAX = 1.6;
const PB_CHART_VIEW = { w: 960, h: 220, padL: 44, padR: 16, padT: 28, padB: 46 };

// 评估结果缓存（PB panel 用 rug plot + 命中率横条展示评估行）
let _evalRows = [];
let _bestRow = null;

const PB_GEN_COLORS = {
    'baseline':   '#60a5fa',
    'triplet-p1': '#34d399',
    'budget-p2':  '#fb923c',
};

// 健康区间约定（基于 docs/algorithms/SPAWN_EVALUATION.md 的"切主路径门槛")
const PB_RATE_TARGETS = {
    nearPbRate:    { label: '近 PB',  ok: [0.25, 0.40], warn: [0.15, 0.60], desc: '85%~100% PB 区间局占比' },
    breakPbRate:   { label: '破 PB',  ok: [0.08, 0.15], warn: [0.03, 0.30], desc: '突破 PB 的局占比' },
    overshootRate: { label: '超 PB',  ok: [0.0,  0.05], warn: [0.0,  0.15], desc: '>115% PB 的局占比', severeAt: 0.35 },
};

function classifyRate(key, value) {
    const t = PB_RATE_TARGETS[key];
    if (!t) return 'unknown';
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    if (key === 'overshootRate') {
        if (v <= t.ok[1]) return 'ok';
        if (v <= t.warn[1]) return 'warn';
        if (v <= (t.severeAt || 0.35)) return 'bad';
        return 'severe';
    }
    if (v >= t.ok[0] && v <= t.ok[1]) return 'ok';
    if (v >= t.warn[0] && v <= t.warn[1]) return 'warn';
    return 'bad';
}

function statusBadge(status) {
    switch (status) {
        case 'ok':     return '✓ 健康';
        case 'warn':   return '⚠ 边界';
        case 'bad':    return '⚠⚠ 偏离';
        case 'severe': return '⚠⚠⚠ 严重';
        default:       return '-';
    }
}
const PB_PHASE_BANDS = [
    { start: 0.0,  end: 0.5,  color: 'rgba(148, 163, 184, 0.05)', label: 'idle' },
    { start: 0.5,  end: 0.8,  color: 'rgba(96, 165, 250, 0.08)',  label: 'chase' },
    { start: 0.8,  end: 0.95, color: 'rgba(96, 165, 250, 0.16)',  label: 'tension' },
    { start: 0.95, end: 1.0,  color: 'rgba(251, 191, 36, 0.18)',  label: 'gate' },
    { start: 1.0,  end: 1.05, color: 'rgba(52, 211, 153, 0.20)',  label: 'release' },
    { start: 1.05, end: 1.15, color: 'rgba(251, 146, 60, 0.20)',  label: 'brake' },
    { start: 1.15, end: PB_RATIO_MAX, color: 'rgba(248, 113, 113, 0.22)', label: 'overshoot' },
];
const PB_PHASE_MEANINGS = {
    warmup: '张力 / 刹车均未启动，玩家远离 PB',
    chase: '张力开始预热，玩家朝 PB 区靠近',
    tension: '张力陡升，spatialPressure +12% / solutionSpacePressure +10%',
    gate: '张力满载，最后冲刺；刹车即将介入',
    release: '刚破 PB 的释放窗口，刹车暂缓 · payoff 加成',
    brake: '刹车介入 · payoff −16% · 多消折扣 22%',
    overshoot: 'payoff 已被抑制 22%，进一步增长会触发更强刹车',
    unknown: '未配置 PB (best ≤ 0)，曲线视图作为示意',
};

function getPbBadge(type, value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    if (type === 'tension') {
        if (v >= 0.95) return { text: '已满载', state: 'hot-tension' };
        if (v >= 0.5)  return { text: '拉升中', state: 'warm-tension' };
        if (v >= 0.05) return { text: '预热中', state: 'warm-tension' };
        return { text: '未启动', state: 'idle' };
    }
    if (type === 'brake') {
        if (v >= 0.95) return { text: '已踩死', state: 'hot-brake' };
        if (v >= 0.5)  return { text: '介入中', state: 'warm-brake' };
        if (v >= 0.05) return { text: '试压中', state: 'warm-brake' };
        return { text: '未触发', state: 'idle' };
    }
    if (type === 'release') {
        if (v > 0.5) return { text: '释放中', state: 'release' };
        return { text: '已关闭', state: 'idle' };
    }
    return { text: '-', state: 'idle' };
}

function buildSigmoidMini(type, ratio) {
    const W = 60, H = 24, padX = 3, padY = 3;
    const center = type === 'tension' ? 0.82 : 1.05;
    const slope  = type === 'tension' ? 0.08 : 0.06;
    const color  = type === 'tension' ? '#60a5fa' : '#fb923c';
    const sigmoid01 = (x) => 1 / (1 + Math.exp(-x));
    const N = 60;
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const r = (i / N) * PB_RATIO_MAX;
        const v = sigmoid01((r - center) / slope);
        const x = padX + (r / PB_RATIO_MAX) * (W - 2 * padX);
        const y = (H - padY) - v * (H - 2 * padY);
        pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    const r = Math.max(0, Math.min(PB_RATIO_MAX, ratio));
    const xm = padX + (r / PB_RATIO_MAX) * (W - 2 * padX);
    const ym = (H - padY) - sigmoid01((r - center) / slope) * (H - 2 * padY);
    return `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <line x1="${padX}" y1="${H - padY}" x2="${W - padX}" y2="${H - padY}" class="pb-mini-axis" />
            <path d="${pts.join(' ')}" class="pb-mini-curve" stroke="${color}" />
            <circle cx="${xm.toFixed(2)}" cy="${ym.toFixed(2)}" r="2.4" class="pb-mini-dot" fill="${color}" />
        </svg>
    `;
}

function updatePbMetricTile(type, value, ratio) {
    const elBadge = $(`pb-${type}-badge`);
    if (elBadge) {
        const badge = getPbBadge(type, value);
        elBadge.textContent = badge.text;
        elBadge.setAttribute('data-state', badge.state);
    }
    const elMini = $(`pb-${type}-mini`);
    if (!elMini) return;
    if (type === 'release') {
        elMini.innerHTML = value > 0.5 ? '● 触发' : '— 事件态';
    } else {
        elMini.innerHTML = buildSigmoidMini(type, ratio);
    }
}

function updatePbPreview(score = 0) {
    const bestScore = Number($('best-score')?.value) || 1000;
    const curve = derivePbCurve(score, bestScore, false);
    const ratio = curve.pbRatio == null ? 0 : curve.pbRatio;

    $('pb-tension-preview').textContent = fmt(curve.pbTension, 2);
    $('pb-brake-preview').textContent = fmt(curve.pbBrake, 2);
    $('pb-release-preview').textContent = fmt(curve.pbRelease, 2);

    updatePbMetricTile('tension', curve.pbTension, ratio);
    updatePbMetricTile('brake', curve.pbBrake, ratio);
    updatePbMetricTile('release', curve.pbRelease, ratio);

    const ratioText = curve.pbRatio == null ? '未知' : fmt(curve.pbRatio, 2);
    const phase = curve.pbPhase || 'unknown';
    const meaning = PB_PHASE_MEANINGS[phase] || '';
    const safePhase = escapeHtml(phase);
    const meaningHtml = meaning ? `<span class="pb-formula-meaning"> — ${escapeHtml(meaning)}</span>` : '';
    $('pb-formula-preview').innerHTML = `
        pbRatio = ${Number(score) || 0} / ${Number(bestScore) || 0} = ${escapeHtml(ratioText)}
        <span class="pb-formula-sep">·</span>
        <span class="pb-formula-phase" data-phase="${safePhase}">当前阶段 <b>${safePhase}</b>${meaningHtml}</span>
    `;

    renderPbChart(score, bestScore, curve);
}

function pbRatioToX(r) {
    const v = PB_CHART_VIEW;
    return v.padL + (Math.max(0, Math.min(PB_RATIO_MAX, r)) / PB_RATIO_MAX) * (v.w - v.padL - v.padR);
}
function pbValueToY(val) {
    const v = PB_CHART_VIEW;
    return (v.h - v.padB) - Math.max(0, Math.min(1, val)) * (v.h - v.padT - v.padB);
}

function buildPbChartSvg(score, bestScore, curve) {
    const v = PB_CHART_VIEW;
    const y0 = pbValueToY(0);
    const y1 = pbValueToY(1);
    const xL = pbRatioToX(0);
    const xR = pbRatioToX(PB_RATIO_MAX);

    const bands = PB_PHASE_BANDS.map((b) => {
        const x1 = pbRatioToX(b.start);
        const x2 = pbRatioToX(b.end);
        return `<rect x="${x1.toFixed(2)}" y="${y1.toFixed(2)}" width="${(x2 - x1).toFixed(2)}" height="${(y0 - y1).toFixed(2)}" fill="${b.color}" />`;
    }).join('');

    const bandLabels = PB_PHASE_BANDS.map((b) => {
        const mid = (pbRatioToX(b.start) + pbRatioToX(b.end)) / 2;
        return `<text x="${mid.toFixed(2)}" y="${(y1 - 6).toFixed(2)}" class="pb-chart-band-label" text-anchor="middle">${b.label}</text>`;
    }).join('');

    const yGrid = [0.25, 0.5, 0.75].map((g) => {
        const y = pbValueToY(g);
        return `<line x1="${xL}" y1="${y.toFixed(2)}" x2="${xR}" y2="${y.toFixed(2)}" class="pb-chart-grid" />`;
    }).join('');

    const N = 140;
    const tensionPts = [];
    const brakePts = [];
    for (let i = 0; i <= N; i++) {
        const r = (i / N) * PB_RATIO_MAX;
        const c = derivePbCurve(r, 1, false);
        const cmd = i === 0 ? 'M' : 'L';
        tensionPts.push(`${cmd}${pbRatioToX(r).toFixed(2)},${pbValueToY(c.pbTension).toFixed(2)}`);
        brakePts.push(`${cmd}${pbRatioToX(r).toFixed(2)},${pbValueToY(c.pbBrake).toFixed(2)}`);
    }

    const xTickValues = [0, 0.5, 0.82, 1.0, 1.05, 1.15, 1.5];
    const majorTicks = new Set([0.82, 1.0, 1.05, 1.15]);
    const xTicks = xTickValues.map((t) => {
        const x = pbRatioToX(t);
        const cls = majorTicks.has(t) ? 'pb-chart-tick-label--major' : '';
        return `
            <line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${(y0 + 4).toFixed(2)}" class="pb-chart-tick" />
            <text x="${x.toFixed(2)}" y="${(y0 + 18).toFixed(2)}" class="pb-chart-tick-label ${cls}" text-anchor="middle">${t.toFixed(2)}</text>
        `;
    }).join('');

    const yTicks = [0, 0.5, 1.0].map((t) => {
        const y = pbValueToY(t);
        return `
            <line x1="${(xL - 4).toFixed(2)}" y1="${y.toFixed(2)}" x2="${xL}" y2="${y.toFixed(2)}" class="pb-chart-tick" />
            <text x="${(xL - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" class="pb-chart-tick-label" text-anchor="end">${t.toFixed(1)}</text>
        `;
    }).join('');

    const xAxisTitle = `<text x="${((xL + xR) / 2).toFixed(2)}" y="${(y0 + 34).toFixed(2)}" class="pb-chart-axis-title" text-anchor="middle">pbRatio = score / bestScore</text>`;
    const yAxisTitleX = xL - 30;
    const yAxisTitleY = (y0 + y1) / 2;
    const yAxisTitle = `<text x="${yAxisTitleX.toFixed(2)}" y="${yAxisTitleY.toFixed(2)}" class="pb-chart-axis-title" text-anchor="middle" transform="rotate(-90 ${yAxisTitleX.toFixed(2)} ${yAxisTitleY.toFixed(2)})">压力 (0–1)</text>`;

    const safeBest = bestScore || 1;
    const rawRatio = score / safeBest;
    const ratio = Math.max(0, Math.min(PB_RATIO_MAX, rawRatio));
    const overflowMark = rawRatio > PB_RATIO_MAX
        ? `<text x="${(xR - 4).toFixed(2)}" y="${(y1 + 14).toFixed(2)}" class="pb-chart-tick-label" text-anchor="end" fill="#f87171">超出 ${rawRatio.toFixed(2)}×</text>`
        : '';
    const xm = pbRatioToX(ratio);
    const yT = pbValueToY(curve.pbTension);
    const yB = pbValueToY(curve.pbBrake);
    const midX = (xL + xR) / 2;
    const pillW = 124;
    const pillH = 34;
    const pillX = xm > midX ? xm - pillW - 8 : xm + 8;
    const pillY = Math.min(y1 + 4, Math.min(yT, yB) - pillH - 6);
    const adjPillY = Math.max(y1 + 4, pillY);
    const phaseLabel = `${curve.pbPhase}`;
    const ratioLabel = `r=${ratio.toFixed(2)}  T=${fmt(curve.pbTension, 2)}  B=${fmt(curve.pbBrake, 2)}`;

    const marker = `
        <line x1="${xm.toFixed(2)}" y1="${y1}" x2="${xm.toFixed(2)}" y2="${y0}" class="pb-chart-marker-line" />
        <circle cx="${xm.toFixed(2)}" cy="${yT.toFixed(2)}" r="4.5" class="pb-chart-dot pb-chart-dot--tension" />
        <circle cx="${xm.toFixed(2)}" cy="${yB.toFixed(2)}" r="4.5" class="pb-chart-dot pb-chart-dot--brake" />
        <rect x="${pillX.toFixed(2)}" y="${adjPillY.toFixed(2)}" width="${pillW}" height="${pillH}" rx="6" class="pb-chart-marker-pill" />
        <text x="${(pillX + 8).toFixed(2)}" y="${(adjPillY + 13).toFixed(2)}" class="pb-chart-marker-text pb-chart-marker-text--phase">${phaseLabel}</text>
        <text x="${(pillX + 8).toFixed(2)}" y="${(adjPillY + 27).toFixed(2)}" class="pb-chart-marker-text">${ratioLabel}</text>
    `;

    // 评估行 rug plot：每个评估行一个小圆点 + 上挑短线，按 generator 着色
    const safeBestForRows = bestScore || 1;
    const rugY = y0 - 5;
    const rowMarkers = (_evalRows || []).map((row) => {
        if (!row || row.scoreMean == null) return '';
        const r = (Number(row.scoreMean) || 0) / safeBestForRows;
        const overflow = r > PB_RATIO_MAX;
        const clamped = Math.max(0, Math.min(PB_RATIO_MAX, r));
        const rx = pbRatioToX(clamped);
        const gen = String(row.spawnGenerator || 'baseline');
        const color = PB_GEN_COLORS[gen] || '#9ca3af';
        const isBest = _bestRow
            && row.strategy === _bestRow.strategy
            && row.spawnGenerator === _bestRow.spawnGenerator
            && row.policy === _bestRow.policy;
        const tip = `${row.strategy || ''} / ${gen} / ${row.policy || ''}  ·  score=${fmt(row.scoreMean, 1)}  ·  r=${fmt(r, 2)}${overflow ? ' (超出图域)' : ''}${isBest ? '  ★ 推荐方案' : ''}`;
        const ringR = isBest ? 5.5 : 3.5;
        const ring = isBest
            ? `<circle cx="${rx.toFixed(2)}" cy="${rugY.toFixed(2)}" r="${ringR + 2}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="2 2" opacity="0.7" />`
            : '';
        return `
            <g class="pb-row-marker">
                <title>${escapeHtml(tip)}</title>
                <line x1="${rx.toFixed(2)}" y1="${y0}" x2="${rx.toFixed(2)}" y2="${(y0 - 14).toFixed(2)}" stroke="${color}" stroke-width="1" opacity="0.5" />
                ${ring}
                <circle cx="${rx.toFixed(2)}" cy="${rugY.toFixed(2)}" r="${ringR}" fill="${color}" stroke="#0f172a" stroke-width="1" />
            </g>
        `;
    }).join('');

    return `
        <svg viewBox="0 0 ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="PB 压力曲线图：X 轴 pbRatio 0~${PB_RATIO_MAX}，Y 轴压力 0~1，包含 pbTension 与 pbBrake 两条 sigmoid 曲线及当前位置标记">
            ${bands}
            ${bandLabels}
            ${yGrid}
            <line x1="${xL}" y1="${y0}" x2="${xR}" y2="${y0}" class="pb-chart-axis" />
            <line x1="${xL}" y1="${y1}" x2="${xL}" y2="${y0}" class="pb-chart-axis" />
            ${xTicks}
            ${yTicks}
            ${xAxisTitle}
            ${yAxisTitle}
            <path d="${tensionPts.join(' ')}" class="pb-chart-curve pb-chart-curve--tension" />
            <path d="${brakePts.join(' ')}" class="pb-chart-curve pb-chart-curve--brake" />
            ${rowMarkers}
            ${marker}
            ${overflowMark}
        </svg>
    `;
}

function renderPbChart(score, bestScore, curve) {
    const host = $('pb-chart-host');
    if (!host) return;
    host.innerHTML = buildPbChartSvg(score, bestScore, curve);
}

// PB 预览的"当前显示分数"：只能从评估推荐方案 / 重置 / 配置加载处更新，
// 不再提供 UI 滑块；改个人最佳时会用这个值重新计算 ratio。
let _lastPreviewScore = 0;

function setPreviewScore(score) {
    const safe = Math.max(0, Math.round(Number(score) || 0));
    _lastPreviewScore = safe;
    updatePbPreview(safe);
}

function buildRateRow(key, value) {
    const t = PB_RATE_TARGETS[key];
    if (!t) return '';
    const pctNum = Math.max(0, Math.min(1, Number(value) || 0));
    const pct = pctNum * 100;
    const status = classifyRate(key, pctNum);
    const targetLeft = t.ok[0] * 100;
    const targetWidth = (t.ok[1] - t.ok[0]) * 100;
    const targetLabel = key === 'overshootRate'
        ? `目标 ≤${(t.ok[1] * 100).toFixed(0)}%`
        : `目标 ${(t.ok[0] * 100).toFixed(0)}%–${(t.ok[1] * 100).toFixed(0)}%`;
    return `
        <div class="pb-rate-row" data-status="${status}" title="${escapeHtml(t.desc)} · ${escapeHtml(targetLabel)}">
            <span class="pb-rate-label">${escapeHtml(t.label)}</span>
            <div class="pb-rate-track">
                <div class="pb-rate-target" style="left:${targetLeft.toFixed(1)}%; width:${targetWidth.toFixed(1)}%"></div>
                <div class="pb-rate-fill" style="width:${Math.max(2, pct).toFixed(1)}%"></div>
            </div>
            <span class="pb-rate-value">${pct.toFixed(1)}%</span>
            <span class="pb-rate-health">${statusBadge(status)}</span>
        </div>
    `;
}

function renderPbRateBars() {
    const host = $('pb-rate-bars');
    if (!host) return;
    if (!_bestRow) {
        host.innerHTML = `
            <div class="pb-rate-head">
                <b>推荐方案的 PB 命中率</b>
                <span>条纹绿带 = 健康范围</span>
            </div>
            <p class="pb-rate-empty">▶ 点「运行评估」后显示命中率与健康度评估。</p>
        `;
        return;
    }
    const bestLabel = `${_bestRow.strategy || ''} / ${_bestRow.spawnGenerator || ''} / ${_bestRow.policy || ''}`;
    host.innerHTML = `
        <div class="pb-rate-head">
            <b>推荐方案 PB 命中率</b>
            <span>${escapeHtml(bestLabel)} · 条纹绿带 = 健康范围</span>
        </div>
        ${buildRateRow('nearPbRate', _bestRow.nearPbRate)}
        ${buildRateRow('breakPbRate', _bestRow.breakPbRate)}
        ${buildRateRow('overshootRate', _bestRow.overshootRate)}
    `;
}

function renderPbEvalLegend() {
    const host = $('pb-eval-legend');
    if (!host) return;
    if (!Array.isArray(_evalRows) || _evalRows.length === 0) {
        host.className = 'pb-eval-legend pb-eval-legend--empty';
        host.innerHTML = '📍 评估完成后，曲线下方会按生成器着色显示每行的 ratio 落点';
        return;
    }
    const generators = [...new Set(_evalRows.map((r) => r.spawnGenerator).filter(Boolean))];
    const items = generators.map((gen) => {
        const count = _evalRows.filter((r) => r.spawnGenerator === gen).length;
        const colorCls = `pb-eval-legend-dot--${escapeHtml(gen)}`;
        return `
            <span class="pb-eval-legend-item">
                <span class="pb-eval-legend-dot ${colorCls}"></span>
                <code>${escapeHtml(gen)}</code> × ${count} 行
            </span>
        `;
    }).join('');
    host.className = 'pb-eval-legend';
    host.innerHTML = `
        <span class="pb-eval-legend-item">📍 曲线下方的圆点 = 评估行落点（hover 看详情）：</span>
        ${items}
        <span class="pb-eval-legend-item" style="margin-left:auto">★ 虚线圈 = 推荐方案</span>
    `;
}

function stat(label, value) {
    return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderTable(report) {
    const tbody = $('result-body');
    tbody.innerHTML = '';
    for (const row of report.rows || []) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.strategy}</td>
            <td>${row.spawnGenerator}</td>
            <td>${row.policy}</td>
            <td>${fmt(row.scoreMean, 1)}</td>
            <td>${fmt(row.stepsMean, 1)}</td>
            <td>${fmt(row.clearsMean, 2)}</td>
            <td>${fmt(row.noMoveRate * 100, 1)}%</td>
            <td>${fmt(row.clearIntervalMean, 2)}</td>
            <td>${fmt(row.fallbackRate * 100, 2)}%</td>
            <td>${fmt(row.attemptMean, 2)}</td>
            <td>${fmt(row.firstMoveFreedomMean, 2)}</td>
            <td>${fmt((row.nearPbRate ?? 0) * 100, 1)}%</td>
            <td>${fmt((row.overshootRate ?? 0) * 100, 1)}%</td>
        `;
        tbody.appendChild(tr);
    }
}

function renderComparisons(report) {
    const wrap = $('comparison-list');
    wrap.innerHTML = '';
    for (const item of report.comparisons || []) {
        const div = document.createElement('div');
        div.className = 'comparison';
        div.innerHTML = `
            <strong>${item.strategy}</strong>
            <span>生成器: ${item.spawnGenerator}</span>
            <span>自然公平差: ${item.naturalFairnessGap == null ? '-' : (item.naturalFairnessGap * 100).toFixed(1) + '%'}</span>
            <span>技能收益: ${item.skillScoreLift == null ? '-' : item.skillScoreLift.toFixed(1) + ' 分'}</span>
            <span>奖励自主性: ${item.rewardAgencyGap == null ? '-' : item.rewardAgencyGap.toFixed(2) + ' 消行/局'}</span>
        `;
        wrap.appendChild(div);
    }
}

function renderBars(report) {
    const chart = $('bars');
    chart.innerHTML = '';
    const rows = report.rows || [];
    const maxScore = Math.max(1, ...rows.map((row) => row.scoreMean));
    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'bar-row';
        item.innerHTML = `
            <span>${row.strategy}/${row.spawnGenerator}/${row.policy}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${Math.max(2, row.scoreMean / maxScore * 100)}%"></div>
            </div>
            <b>${fmt(row.scoreMean, 1)}</b>
        `;
        chart.appendChild(item);
    }
}

function renderRaw(report) {
    $('raw-json').textContent = JSON.stringify(report, null, 2);
}

function buildGoalSubscoreHtml(row) {
    if (!row) return '';
    const subs = computeGoalSubscores(row);
    const goals = goalsFromUi();
    const total = (goals.fairness + goals.excitement + goals.antiInflation) || 1;
    const items = [
        { key: 'fairness',      name: '⚖️ 公平',     value: subs.fairness,      weight: goals.fairness / total,      color: 'var(--accent)' },
        { key: 'excitement',    name: '🎉 爽点',     value: subs.excitement,    weight: goals.excitement / total,    color: 'var(--good)' },
        { key: 'antiInflation', name: '🛑 抑制膨胀', value: subs.antiInflation, weight: goals.antiInflation / total, color: '#fb923c' },
    ];
    const rows = items.map((it) => {
        const pct = Math.max(2, it.value * 100);
        const status = it.value >= 0.7 ? '✓' : it.value >= 0.4 ? '◐' : '✗';
        return `
            <div class="goal-subscore-row">
                <span class="goal-subscore-name" style="color:${it.color}">${it.name}</span>
                <div class="goal-subscore-track">
                    <div class="goal-subscore-fill" style="width:${pct.toFixed(1)}%; background:${it.color}"></div>
                </div>
                <span class="goal-subscore-value">${it.value.toFixed(2)}</span>
                <span class="goal-subscore-status">${status}</span>
                <span class="goal-subscore-weight">(你设置权重 ${(it.weight * 100).toFixed(0)}%)</span>
            </div>
        `;
    }).join('');
    return `<div class="goal-subscore-grid">${rows}</div>`;
}

function renderInsights(report) {
    const insights = report.insights || buildEvaluationInsights(report, objectiveWeightsFromUi());
    const el = $('insights');
    if (!el) return;
    const best = insights.best
        ? `<p><strong>推荐方案：</strong>${escapeHtml(insights.best.strategy)} / ${escapeHtml(insights.best.spawnGenerator)} / ${escapeHtml(insights.best.policy)}，综合分 <b>${insights.best.optimizerScore ?? '-'}</b></p>${buildGoalSubscoreHtml(insights.best)}`
        : '';
    el.innerHTML = `
        ${best}
        <h3>关键发现</h3>
        <ul>${(insights.findings || []).map((x) => `<li>${x}</li>`).join('')}</ul>
        <h3>改进建议</h3>
        <ul>${(insights.recommendations || []).map((x) => `<li>${x}</li>`).join('')}</ul>
    `;
}

function renderReport(report) {
    renderSummary(report);
    renderTable(report);
    renderComparisons(report);
    renderBars(report);
    renderInsights(report);
    renderRaw(report);
    $('timestamp').textContent = `生成时间：${report.generatedAt}`;
    const bestRow = report.insights?.best;
    _evalRows = Array.isArray(report.rows) ? report.rows : [];
    _bestRow = bestRow || null;
    renderPbRateBars();
    renderPbEvalLegend();
    setPreviewScore(bestRow?.scoreMean || 0);
}

function renderInitialState() {
    $('summary').innerHTML = [
        stat('状态', '等待'),
        stat('总局数', 0),
        stat('最大死局率', '-'),
        stat('平均兜底率', '-'),
    ].join('');
    $('result-body').innerHTML = '';
    $('comparison-list').innerHTML = '<p class="muted">点击“运行评估”后展示公平与自主性对比。</p>';
    $('bars').innerHTML = '<p class="muted">等待评估数据。</p>';
    $('insights').innerHTML = '<p class="muted">点击“运行评估”或“自动寻优”后生成报告解读。</p>';
    $('raw-json').textContent = '';
    const opt = $('optimizer-output');
    if (opt) opt.innerHTML = '<p class="auto-result-empty">点击“自动寻优”后，这里会按综合评分排出 baseline / P1 / P2 候选方案。</p>';
    $('timestamp').textContent = '等待评估';
    _evalRows = [];
    _bestRow = null;
    renderPbRateBars();
    renderPbEvalLegend();
    setPreviewScore(0);
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setOptimizerProgress(text) {
    const root = $('optimizer-output');
    if (!root) return;
    root.innerHTML = `<p class="auto-result-empty">${escapeHtml(text)}</p>`;
}

function renderAutoOptimizeResult(results, bestPatch, bestScore) {
    const root = $('optimizer-output');
    if (!root) return;
    if (!Array.isArray(results) || results.length === 0) {
        root.innerHTML = '<p class="auto-result-empty">无可用候选。请检查参数后重试。</p>';
        return;
    }
    const sorted = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
    const maxScore = Math.max(0.0001, ...sorted.map((r) => Math.abs(Number(r.score) || 0)));
    const cards = sorted.map((row, idx) => {
        const patch = row.patch || {};
        const mc = patch.modelConfig || {};
        const gen = (Array.isArray(patch.spawnGenerators) && patch.spawnGenerators[0]) || '-';
        const isBest = idx === 0;
        const score = Number(row.score) || 0;
        const pct = Math.max(2, Math.min(100, Math.abs(score) / maxScore * 100));
        const chips = [];
        if (patch.maxEvaluatedTriplets != null) chips.push(`maxTriplets ${patch.maxEvaluatedTriplets}`);
        if (mc.personalizationStrength != null) chips.push(`个性化 ${fmt(mc.personalizationStrength, 2)}`);
        if (mc.temperature != null) chips.push(`温度 ${fmt(mc.temperature, 2)}`);
        if (mc.surpriseBudgetGain != null) chips.push(`惊喜 ${fmt(mc.surpriseBudgetGain, 2)}`);
        if (mc.surpriseCooldown != null) chips.push(`冷却 ${mc.surpriseCooldown}`);
        const chipHtml = chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('');
        const rankLabel = isBest ? '⭐ #1 推荐' : `#${idx + 1}`;
        const bestTag = isBest ? '<span class="auto-tag">综合分最高</span>' : '';
        const labelChip = patch._label ? `<span class="chip" style="background:rgba(96,165,250,0.15); color:var(--accent);">${escapeHtml(patch._label)}</span>` : '';
        return `
            <div class="auto-card ${isBest ? 'auto-card--best' : ''}">
                <div class="auto-card-head">
                    <span class="auto-rank">${rankLabel}</span>
                    <span class="auto-gen">${escapeHtml(gen)}</span>
                    ${labelChip}
                    ${bestTag}
                </div>
                <div class="auto-chips">${chipHtml}</div>
                <div class="auto-score-row">
                    <div class="auto-score-track"><div class="auto-score-fill" style="width:${pct.toFixed(1)}%"></div></div>
                    <b class="auto-score-num">${fmt(score, 3)}</b>
                </div>
            </div>
        `;
    });
    const rawJson = JSON.stringify({
        selected: bestPatch,
        score: bestScore,
        candidates: sorted.map((x) => ({ patch: x.patch, score: x.score })),
    }, null, 2);
    root.innerHTML = `
        <div class="auto-list">${cards.join('')}</div>
        <details class="auto-raw">
            <summary>查看原始 JSON（开发调试用）</summary>
            <pre>${escapeHtml(rawJson)}</pre>
        </details>
    `;
}

function runFromUi() {
    const btn = $('run-btn');
    btn.disabled = true;
    btn.textContent = '评估中...';
    setTimeout(() => {
        void (async () => {
            try {
                const report = await runEvaluationAsync({
                seed: Number($('seed').value) || 20260523,
                sessions: Number($('sessions').value) || 30,
                maxSteps: Number($('max-steps').value) || 240,
                maxEvaluatedTriplets: Number($('max-triplets').value) || 80,
                bestScore: Number($('best-score').value) || 1000,
                strategies: selectedValues($('strategies')),
                policies: selectedValues($('policies')),
                spawnGenerators: selectedValues($('spawn-generators')),
                objectiveWeights: objectiveWeightsFromUi(),
                modelConfig: modelConfigFromUi(),
            });
                renderReport(report);
            } catch (error) {
                $('timestamp').textContent = `评估失败：${error.message || error}`;
            } finally {
                btn.disabled = false;
                btn.textContent = '运行评估';
            }
        })();
    }, 20);
}

function currentConfigPayload() {
    return {
        seed: Number($('seed').value) || 20260523,
        sessions: Number($('sessions').value) || 30,
        maxSteps: Number($('max-steps').value) || 240,
        maxEvaluatedTriplets: Number($('max-triplets').value) || 80,
        bestScore: Number($('best-score').value) || 1000,
        strategies: selectedValues($('strategies')),
        policies: selectedValues($('policies')),
        spawnGenerators: selectedValues($('spawn-generators')),
        goals: goalsFromUi(),
        objectiveWeights: objectiveWeightsFromUi(),
        modelConfig: modelConfigFromUi(),
    };
}

function applyConfigPayload(payload = {}) {
    if (payload.seed) $('seed').value = payload.seed;
    if (payload.sessions) $('sessions').value = payload.sessions;
    if (payload.maxSteps) $('max-steps').value = payload.maxSteps;
    if (payload.maxEvaluatedTriplets) $('max-triplets').value = payload.maxEvaluatedTriplets;
    if (payload.bestScore) $('best-score').value = payload.bestScore;
    setPreviewScore(_lastPreviewScore);
    for (const [id, values] of [
        ['strategies', payload.strategies],
        ['policies', payload.policies],
        ['spawn-generators', payload.spawnGenerators],
    ]) {
        if (Array.isArray(values)) {
            for (const opt of $(id).options) opt.selected = values.includes(opt.value);
        }
    }
    // v1.62.9+: 优先读 goals; 老方案没有则保持当前滑块值不动
    const g = payload.goals || {};
    if (g.fairness != null      && $('goal-fairness'))       $('goal-fairness').value      = g.fairness;
    if (g.excitement != null    && $('goal-excitement'))     $('goal-excitement').value    = g.excitement;
    if (g.antiInflation != null && $('goal-anti-inflation')) $('goal-anti-inflation').value = g.antiInflation;
    refreshGoalSliderValues();
    const m = payload.modelConfig || {};
    if (m.personalizationStrength != null) $('personalization-strength').value = m.personalizationStrength;
    if (m.temperature != null) $('random-temperature').value = m.temperature;
    if (m.surpriseBudgetGain != null) $('surprise-gain').value = m.surpriseBudgetGain;
    if (m.surpriseCooldown != null) $('surprise-cooldown').value = m.surpriseCooldown;
}

async function apiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function refreshSavedConfigs() {
    const select = $('saved-configs');
    if (!select) return;
    const userId = getUserId();
    let items = readLocalConfigs(userId);
    let source = '本地';
    try {
        const data = await apiJson(`/api/spawn-optimizer/configs?user_id=${encodeURIComponent(userId)}`);
        items = [...(data.items || []), ...items.filter((local) => !(data.items || []).some((x) => x.id === local.id))];
        source = 'SQLite + 本地';
    } catch {
        source = '本地（SQLite 不可用）';
    }
    select.innerHTML = '<option value="">选择已保存方案</option>';
    for (const item of items) {
        const opt = document.createElement('option');
        opt.value = String(item.id);
        opt.textContent = `${item.is_active ? '已生效 · ' : ''}${item.name}`;
        opt._payload = item.payload;
        select.appendChild(opt);
    }
    $('save-status').textContent = `${source}：已加载 ${items.length} 个方案`;
}

function readLocalConfigs(userId) {
    try {
        const all = JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}');
        return Array.isArray(all[userId]) ? all[userId] : [];
    } catch {
        return [];
    }
}

function writeLocalConfig(userId, config) {
    const all = JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}');
    const list = Array.isArray(all[userId]) ? all[userId] : [];
    if (config.is_active) {
        for (const item of list) item.is_active = false;
    }
    const item = {
        id: config.id || `local-${Date.now()}`,
        user_id: userId,
        name: config.name,
        payload: config.payload,
        is_active: !!config.is_active,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };
    list.unshift(item);
    all[userId] = list.slice(0, 50);
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(all));
    return item;
}

async function saveCurrentConfig() {
    const name = $('config-name').value.trim() || '出块优化方案';
    const userId = getUserId();
    const payload = currentConfigPayload();
    try {
        await apiJson('/api/spawn-optimizer/configs', {
            method: 'PUT',
            body: JSON.stringify({
                user_id: userId,
                name,
                payload,
                is_active: $('activate-on-save').checked,
            }),
        });
        $('save-status').textContent = '已保存到 SQLite';
    } catch (e) {
        writeLocalConfig(userId, {
            name,
            payload,
            is_active: $('activate-on-save').checked,
        });
        $('save-status').textContent = `SQLite 不可用，已保存到本地：${e.message || e}`;
    }
    await refreshSavedConfigs();
}

function loadSelectedConfig() {
    const opt = $('saved-configs').selectedOptions[0];
    if (opt?._payload) {
        applyConfigPayload(opt._payload);
        $('save-status').textContent = '方案已加载并对下一次评估生效';
    }
}

function runAutoOptimize() {
    const btn = $('auto-btn');
    btn.disabled = true;
    btn.textContent = '自动寻优中...';
    setTimeout(() => {
        void (async () => {
        try {
            const base = currentConfigPayload();

            // v0.3.5: 用 LHS 5 维 (personalization/temperature/surpriseGain/surpriseCooldown/maxTriplets)
            // 替代原 4 个 hardcoded 候选,生成 8 个 budget-p2 候选,均匀覆盖参数空间。
            // 多保留 1 个 baseline + 1 个 triplet-p1 作为对照基线 → 共 10 个候选。
            // 算法与 spawn-tuning 完全一致 (复用 lhsSampler),保证两套工具结果可比。
            const TRIPLET_CHOICES = [32, 48, 64, 80, 96, 128];
            const lhs = latinHypercube(8, 5, { seed: (Date.now() & 0xFFFFFFFF) >>> 0 });
            const lhsCandidates = lhs.map((v, i) => ({
                spawnGenerators: ['budget-p2'],
                maxEvaluatedTriplets: TRIPLET_CHOICES[Math.min(TRIPLET_CHOICES.length - 1, Math.floor(v[4] * TRIPLET_CHOICES.length))],
                modelConfig: {
                    ...base.modelConfig,
                    personalizationStrength: Number((0.05 + v[0] * 0.13).toFixed(3)),  // [0.05, 0.18]
                    temperature: Number((0.03 + v[1] * 0.05).toFixed(3)),              // [0.03, 0.08]
                    surpriseBudgetGain: Number((0.05 + v[2] * 0.05).toFixed(3)),       // [0.05, 0.10]
                    surpriseCooldown: Math.round(4 + v[3] * 6),                        // [4, 10]
                },
                _label: `LHS#${i + 1}`,
            }));
            const candidates = [
                { spawnGenerators: ['baseline'], maxEvaluatedTriplets: base.maxEvaluatedTriplets, _label: 'baseline' },
                { spawnGenerators: ['triplet-p1'], maxEvaluatedTriplets: 32,
                  modelConfig: { ...base.modelConfig, personalizationStrength: 0.06, temperature: 0.03 },
                  _label: 'triplet-p1' },
                ...lhsCandidates,
            ];
            setOptimizerProgress(`正在评估 ${candidates.length} 个候选 (1 baseline + 1 P1 + 8 LHS P2)…`);
            const results = [];
            for (const patch of candidates) {
                const report = await runEvaluationAsync({
                    ...base,
                    sessions: Math.min(3, base.sessions),
                    maxSteps: Math.min(120, base.maxSteps),
                    ...patch,
                });
                results.push({
                    patch,
                    report,
                    score: report.insights?.best?.optimizerScore ?? 0,
                });
                setOptimizerProgress(`已评估 ${results.length}/${candidates.length} 个候选…`);
            }
            results.sort((a, b) => b.score - a.score);
            const best = results[0];
            applyConfigPayload({ ...base, ...best.patch });
            renderReport(best.report);
            renderAutoOptimizeResult(results, best.patch, best.score);
        } finally {
            btn.disabled = false;
            btn.textContent = '自动寻优';
        }
        })();
    }, 20);
}

const ARCH_DETAILS = {
    input: {
        title: '⓪ 评估输入',
        role: '驱动一次评估的所有外部输入',
        body: '顶部控件（种子 / 局数 / 步数 / 难度 / 生成器 / Bot / 个人最佳）加 PB 区的「试探得分」滑块——所有用户配置的入口。点击「运行评估」会把这些参数打包传给 runSpawnEvaluation()。',
        related: ['pbcurve', 'p2gen', 'metrics'],
    },
    model: {
        title: '① 4 个模型参数',
        role: '事前调参 · 改变评估指标本身',
        body: '个性化强度 / 随机温度 / 惊喜增长 / 惊喜冷却。这 4 个参数喂给 P2 generator，改变它的"出块意图"——<b>只在选用 budget-p2 生成器时生效</b>。改了必须重跑评估才能看到效果。',
        related: ['p2gen'],
    },
    pbcurve: {
        title: '② derivePbCurve()',
        role: '引擎核心 · 每个落子都跑一次',
        body: '以 score/bestScore 为输入，输出 pbTension / pbBrake / pbRelease。评估每一步都被调用，并<b>直接修改 spawnTargets.payoffIntensity、spatialPressure、multiClearBonus 等 7 个字段</b>，所以它不是"事后展示"，而是"事中介入"。',
        related: ['input', 'pbpanel', 'p2gen', 'metrics'],
    },
    p2gen: {
        title: '② P2 generator (budget-p2)',
        role: '引擎核心 · 出块决策点',
        body: '消费 modelConfig（来自 ①）+ 受 derivePbCurve 修改后的 spawnTargets，按四类预算 (survival / payoff / pressure / novelty) 决定出哪 3 块。仅当生成器选择 budget-p2 时介入；baseline / triplet-p1 走各自的子路径。',
        related: ['input', 'model', 'pbcurve', 'metrics'],
    },
    pbpanel: {
        title: '③ PB 双 S 曲线 panel',
        role: '可视化 · 预演 / 定位',
        body: 'derivePbCurve() 的可视化镜像——曲线是真实采样自该函数。<b>评估前</b>可拖滑块预演任意 ratio，看徽章/迷你/主图 marker 联动；<b>评估后</b> marker 自动跳到推荐方案的 scoreMean/bestScore，告诉你"玩家落在曲线哪个阶段"。',
        related: ['pbcurve'],
    },
    metrics: {
        title: '④ 核心指标 rows[]',
        role: '唯一真值源',
        body: 'runSpawnEvaluation() 的唯一返回值。每行 = 一个 (策略×生成器×Bot) 组合的 13 列原始指标：scoreMean / noMoveRate / clearsMean / fallbackRate / firstMoveFreedomMean / nearPbRate / overshootRate / ...。<b>下游所有视图/分析都从这里取数</b>，没有它就什么都没有。',
        related: ['input', 'pbcurve', 'p2gen', 'bars', 'insights'],
    },
    bars: {
        title: '⑤ 均分对比',
        role: '视图层 · 同源不同形',
        body: '把 rows[] 里 <code>scoreMean</code> 这一列单独抽出来排序绘条。本质是核心指标表的"局部可视化"，<b>无任何自己的计算</b>。它的价值是把 random/clear-greedy/survival 的均分差距用视觉对比放大。',
        related: ['metrics'],
    },
    insights: {
        title: '⑥ buildInsights()',
        role: '逻辑层 · 指标→推荐唯一翻译器',
        body: '把每行指标 × 5 个权重 → 综合 <code>optimizerScore</code>，选出最高得分的行作为"推荐方案"。同时生成关键发现（最高死局率、fallback 过高等）与改进建议清单。',
        related: ['metrics', 'weights', 'report'],
    },
    weights: {
        title: '⑦ 5 个权重',
        role: '事后调分 · 改打分公式',
        body: '死局 / 奖励 / 技能 / 兜底 / 节奏 5 个权重。它们<b>只决定 optimizerScore 的加权方式</b>，不改变评估指标本身——所以理论上改权重不需要重跑评估也能切换"推荐方案"（当前实现把它放在评估请求里，所以仍会触发重跑，可后续优化）。',
        related: ['insights'],
    },
    report: {
        title: '⑧ 报告解读与建议',
        role: '最终输出 · 反馈起点',
        body: 'buildInsights 输出的可读形式：推荐方案 / 关键发现 / 改进建议。看到这里发现问题（如 overshootRate=100% / fallbackRate 偏高） → 回头调权重 ⑦ 或模型参数 ① → 重跑 ⓪ → 形成闭环。',
        related: ['insights', 'input'],
    },
};

function renderArchDetail(nodeId) {
    const el = $('arch-detail');
    if (!el) return;
    if (!nodeId) {
        el.className = 'arch-detail arch-detail--idle';
        el.innerHTML = '👆 鼠标悬停任意节点查看角色与数据流，点击钉住选择。';
        return;
    }
    const d = ARCH_DETAILS[nodeId];
    if (!d) return;
    const relatedHtml = (d.related || [])
        .map((id) => {
            const r = ARCH_DETAILS[id];
            const label = r ? r.title : id;
            return `<span class="arch-chip" data-arch-jump="${escapeHtml(id)}">${escapeHtml(label)}</span>`;
        })
        .join('');
    el.className = 'arch-detail';
    el.innerHTML = `
        <div class="arch-detail-title">
            ${escapeHtml(d.title)}
            <span class="arch-detail-role">${escapeHtml(d.role)}</span>
        </div>
        <div class="arch-detail-body">${d.body}</div>
        ${relatedHtml ? `<div class="arch-detail-related">关联节点：${relatedHtml}</div>` : ''}
    `;
}

function archHighlight(nodeId) {
    const svg = $('arch-svg');
    if (!svg) return;
    svg.querySelectorAll('.arch-node').forEach((n) => {
        n.classList.remove('is-active', 'is-related');
    });
    svg.querySelectorAll('.arch-edge').forEach((e) => {
        e.classList.remove('is-edge-active');
        e.removeAttribute('marker-end');
        e.setAttribute('marker-end', 'url(#arch-arrow)');
    });
    svg.querySelectorAll('.arch-edge-label').forEach((t) => {
        t.classList.remove('is-active');
    });
    if (!nodeId) {
        renderArchDetail(null);
        return;
    }
    const node = svg.querySelector(`.arch-node[data-id="${nodeId}"]`);
    if (node) node.classList.add('is-active');
    const relatedIds = new Set();
    svg.querySelectorAll('.arch-edge').forEach((edge) => {
        const from = edge.getAttribute('data-from');
        const to = edge.getAttribute('data-to');
        if (from === nodeId || to === nodeId) {
            edge.classList.add('is-edge-active');
            edge.setAttribute('marker-end', 'url(#arch-arrow-active)');
            const other = from === nodeId ? to : from;
            if (other) relatedIds.add(other);
            const labelKey = `${from}-${to}`;
            const label = svg.querySelector(`.arch-edge-label[data-edge="${labelKey}"]`);
            if (label) label.classList.add('is-active');
        }
    });
    relatedIds.forEach((id) => {
        const el = svg.querySelector(`.arch-node[data-id="${id}"]`);
        if (el) el.classList.add('is-related');
    });
    renderArchDetail(nodeId);
}

function initArchDiagram() {
    const svg = $('arch-svg');
    if (!svg) return;
    let pinnedId = null;
    const onEnter = (event) => {
        const node = event.target.closest('.arch-node');
        if (!node) return;
        if (pinnedId) return;
        const id = node.getAttribute('data-id');
        archHighlight(id);
    };
    const onLeave = (event) => {
        const node = event.target.closest('.arch-node');
        if (!node) return;
        if (pinnedId) return;
        archHighlight(null);
    };
    const onClick = (event) => {
        const node = event.target.closest('.arch-node');
        if (!node) {
            pinnedId = null;
            archHighlight(null);
            return;
        }
        const id = node.getAttribute('data-id');
        if (pinnedId === id) {
            pinnedId = null;
            archHighlight(null);
        } else {
            pinnedId = id;
            archHighlight(id);
        }
    };
    svg.querySelectorAll('.arch-node').forEach((node) => {
        node.addEventListener('mouseenter', onEnter);
        node.addEventListener('mouseleave', onLeave);
        node.addEventListener('focus', onEnter);
        node.addEventListener('blur', onLeave);
    });
    svg.addEventListener('click', onClick);
    const detail = $('arch-detail');
    if (detail) {
        detail.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-arch-jump]');
            if (!chip) return;
            const id = chip.getAttribute('data-arch-jump');
            pinnedId = id;
            archHighlight(id);
        });
    }
}

/**
 * 从 URL 查询参数预填表单 — 让看板"③ 单次评估"能继承 ② 样本构建里某个 run 的配置。
 *
 * 支持参数:
 *   ?seed=20260524
 *   ?sessions=30
 *   ?maxSteps=240
 *   ?maxTriplets=80
 *   ?bestScore=1500
 *   ?strategies=easy,normal    (多选, 逗号分隔)
 *   ?spawnGenerators=budget-p2 (同上)
 *   ?policies=clear-greedy     (同上)
 *   ?autorun=1                 (可选: 表单填好后自动点"运行评估")
 */
function applyQueryParamsToForm() {
    let params;
    try { params = new URLSearchParams(window.location.search); }
    catch { return false; }
    if ([...params.keys()].length === 0) return false;

    let touched = false;
    const setNum = (id, key) => {
        const v = params.get(key);
        if (v != null && v !== '') {
            const el = $(id);
            if (el) { el.value = String(Number(v)); touched = true; }
        }
    };
    const setMulti = (id, key) => {
        const v = params.get(key);
        if (v == null) return;
        const values = v.split(',').map((s) => s.trim()).filter(Boolean);
        if (values.length === 0) return;
        const el = $(id);
        if (!el) return;
        [...el.options].forEach((o) => { o.selected = values.includes(o.value); });
        touched = true;
    };
    setNum('seed', 'seed');
    setNum('sessions', 'sessions');
    setNum('max-steps', 'maxSteps');
    setNum('max-triplets', 'maxTriplets');
    setNum('best-score', 'bestScore');
    setMulti('strategies', 'strategies');
    setMulti('spawn-generators', 'spawnGenerators');
    setMulti('policies', 'policies');
    return touched;
}

export function initSpawnEvalApp() {
    fillOptions($('strategies'), SPAWN_EVAL_STRATEGIES, ['normal']);
    fillOptions($('policies'), SPAWN_EVAL_POLICIES, SPAWN_EVAL_POLICIES);
    fillOptions($('spawn-generators'), SPAWN_EVAL_GENERATORS, ['baseline']);
    // URL 参数继承 — 在 fillOptions 设默认后覆盖
    const fromUrl = applyQueryParamsToForm();
    // "个人最佳" 改动后，用当前显示分数重新计算 ratio
    $('best-score')?.addEventListener('input', () => {
        updatePbPreview(_lastPreviewScore);
    });
    // 3 个业务目标滑块: 改动时实时更新百分比显示 + 派生权重明细
    ['goal-fairness', 'goal-excitement', 'goal-anti-inflation'].forEach((id) => {
        $(id)?.addEventListener('input', refreshGoalSliderValues);
    });
    refreshGoalSliderValues();
    $('run-btn').addEventListener('click', runFromUi);
    $('auto-btn')?.addEventListener('click', runAutoOptimize);
    $('save-config-btn')?.addEventListener('click', saveCurrentConfig);
    $('load-config-btn')?.addEventListener('click', loadSelectedConfig);
    initArchDiagram();
    void refreshSavedConfigs();
    renderInitialState();

    // URL ?autorun=1 → 表单填好后自动跑评估 (看板继承场景用)
    try {
        const params = new URLSearchParams(window.location.search);
        if (fromUrl && params.get('autorun') === '1') {
            setTimeout(() => runFromUi(), 200);
        }
    } catch {}
}

document.addEventListener('DOMContentLoaded', initSpawnEvalApp);

