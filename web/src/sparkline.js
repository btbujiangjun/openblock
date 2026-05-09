/**
 * 指标迷你折线图（回放面板与玩家画像「实时状态」共用）
 */
export const SPARK_W = 200;
export const SPARK_H = 24;
const SPARK_PAD = 3;

/** 与回放序列分组一致；v1.13 新增 stress 组（pink）承载 stressBreakdown 各分量曲线，
 *  与 game(蓝)/ability(绿)/state(橙)/spawn(紫) 区分。*/
export const METRIC_GROUP_COLORS = {
    game: '#5b9bd5',
    ability: '#27ae60',
    state: '#e67e22',
    spawn: '#8e44ad',
    stress: '#ec407a'
};

/** 指标名专用高饱和配色（用于「实时状态/回放」左侧标签）。 */
export const METRIC_LABEL_COLORS = {
    topologyHoles: '#94a3b8',
    tripletSolutionCount: '#fbbf24',
    score: '#ffd166',
    boardFill: '#4cc9f0',
    stress: '#ff6b6b',
    momentum: '#ff9f1c',
    cognitiveLoad: '#b388ff',
    difficultyBias: '#ff4d8d',

    skill: '#2dd4bf',
    clearRate: '#6ee7b7',
    flowDeviation: '#fbbf24',
    frustration: '#f97316',
    missRate: '#f43f5e',
    thinkMs: '#93c5fd',

    feedbackBias: '#a78bfa',
    flowAdjust: '#22d3ee',
    pacingAdjust: '#34d399',
    friendlyBoardRelief: '#60a5fa',
    sessionArcAdjust: '#e879f9',
    challengeBoost: '#fb7185'
};

const METRIC_LABEL_FALLBACK_PALETTE = [
    '#ffd166', '#4cc9f0', '#ff6b6b', '#6ee7b7', '#b388ff', '#fbbf24'
];

/**
 * 返回指标名标签颜色：优先 key 专属色，再回退分组色/循环调色盘。
 * @param {string} key
 * @param {string} fallback
 * @param {number} index
 * @returns {string}
 */
export function getMetricLabelColor(key, fallback, index = 0) {
    if (METRIC_LABEL_COLORS[key]) return METRIC_LABEL_COLORS[key];
    if (fallback) return fallback;
    return METRIC_LABEL_FALLBACK_PALETTE[index % METRIC_LABEL_FALLBACK_PALETTE.length];
}

/**
 * @param {{ idx: number, value: number }[]} points
 * @param {number} totalFrames 序列长度（横轴归一化用）
 * @param {string} color 折线/填充色
 * @returns {string} SVG 片段
 */
export function sparklineSvg(points, totalFrames, color) {
    const cursorAttrs =
        'class="spark-cursor" x1="0" y1="0" x2="0" y2="' +
        SPARK_H +
        '" stroke="var(--replay-cursor,#e74c3c)" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.7"';
    if (points.length === 0) {
        return (
            `<svg class="replay-sparkline" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none">` +
            `<line x1="0" y1="${SPARK_H / 2}" x2="${SPARK_W}" y2="${SPARK_H / 2}" stroke="${color}" stroke-width="0.7" opacity="0.25" vector-effect="non-scaling-stroke"/>` +
            `<line ${cursorAttrs}/></svg>`
        );
    }
    const maxIdx = Math.max(totalFrames - 1, 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
    }
    const range = hi - lo || 1;
    const plotH = SPARK_H - SPARK_PAD * 2;
    const toX = (idx) => (idx / maxIdx) * SPARK_W;
    const toY = (val) => SPARK_PAD + plotH - ((val - lo) / range) * plotH;

    const pts = points.map((p) => `${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ');
    const firstX = toX(points[0].idx).toFixed(1);
    const lastX = toX(points[points.length - 1].idx).toFixed(1);
    const fillD =
        `M${firstX},${SPARK_H} ` +
        points.map((p) => `L${toX(p.idx).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
        ` L${lastX},${SPARK_H} Z`;

    return (
        `<svg class="replay-sparkline" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none">` +
        `<path d="${fillD}" fill="${color}" opacity="0.1"/>` +
        `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `<line ${cursorAttrs}/>` +
        `</svg>`
    );
}
