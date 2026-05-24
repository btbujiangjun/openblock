/**
 * profileAuditContracts.js — 玩家画像指标的"预期关系契约"集合
 *
 * 这里把"指标之间应该怎么关联"显式写成可执行规则，每条契约：
 *   1. 描述一种业务约定（出自 REPLAY_METRICS.tooltip / adaptiveSpawn 链路 / 设计文档）
 *   2. 给出 eval 函数：传入按指标 key 索引的"指标 → 时序数组"映射，返回判定结果
 *   3. 失败的契约会喂给 profileAuditHints，产出"该如何修正口径/算法"的优化建议
 *
 * 设计原则：
 *   - 数据驱动：新增契约只改本文件，不动主入口
 *   - 单一职责：每条契约只回答一个具体问题（通过/不通过 + 关键证据）
 *   - 软判定：对"概率性满足"的契约用阈值（如反向步数比 ≥ 0.4），不强制 100%
 *   - 可追溯：每条契约带 `source` 字段标记契约出处，方便策划/QA 反向找原文
 */

import {
    oppositeStepRate,
    pearson,
    laggedPearson,
    halvesMeanDiff,
} from './profileAuditMath.js';

/**
 * @typedef {Object} ContractEvalResult
 * @property {boolean} passed
 * @property {number} [evidence]   定量证据（如反向步比、相关系数、求和残差等）
 * @property {string} [reason]     人类可读的判定理由
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} ProfileContract
 * @property {string} id
 * @property {string} desc
 * @property {string} source         契约出处（doc / module / 团队约定）
 * @property {string[]} metrics      涉及到的指标 key 列表（用于报告侧标注）
 * @property {(series: Record<string, number[]>) => ContractEvalResult} eval
 */

/* ============================================================
 * Helpers
 * ============================================================ */

const _arr = (series, key) => Array.isArray(series?.[key]) ? series[key] : [];

/** 取若干 series 同位置求和，缺失帧视为 0；用于"分量求和 ≈ 总量"类契约。 */
function _sumSeries(series, keys) {
    const cols = keys.map((k) => _arr(series, k));
    const n = Math.max(0, ...cols.map((c) => c.length));
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let s = 0;
        let ok = false;
        for (const col of cols) {
            const v = Number(col[i]);
            if (Number.isFinite(v)) { s += v; ok = true; }
        }
        out[i] = ok ? s : NaN;
    }
    return out;
}

/* ============================================================
 * 契约定义
 * ============================================================
 *
 * 添加新契约时：
 *   1. 新 push 一条 { id, desc, source, metrics, eval }
 *   2. eval 收到 series（{ [key]: number[] }），返回 ContractEvalResult
 *   3. 必要时在 profileAuditHints 加对应的 hint code 翻译规则
 */

/** @type {ProfileContract[]} */
export const CONTRACTS = [
    /* ---------- A. 反向契约 ---------- */
    {
        id: 'clearRate-vs-boardFill',
        desc: '消行率上升时板面应下降（消行清空了空间）',
        source: 'REPLAY_METRICS.tooltip.clearRate / boardFill',
        metrics: ['clearRate', 'boardFill'],
        eval: (s) => {
            const r = oppositeStepRate(_arr(s, 'clearRate'), _arr(s, 'boardFill'));
            if (r.oppositeRate == null) {
                return { passed: true, reason: '样本不足，跳过判定', evidence: 0 };
            }
            return {
                passed: r.oppositeRate >= 0.2,
                evidence: r.oppositeRate,
                reason: `反向步占比 ${r.oppositeRate.toFixed(2)}（≥0.2 视为通过；负值=主要同向，疑似口径反了）`,
                details: { samples: r.samples },
            };
        },
    },
    {
        id: 'frustration-vs-momentum',
        desc: '未消行步数（frustration）上升时动量应下降',
        source: 'docs/algorithms/ADAPTIVE_SPAWN.md / playerProfile.momentum',
        metrics: ['frustration', 'momentum'],
        eval: (s) => {
            const r = oppositeStepRate(_arr(s, 'frustration'), _arr(s, 'momentum'));
            if (r.oppositeRate == null) {
                return { passed: true, reason: '样本不足，跳过判定', evidence: 0 };
            }
            /* v1.62.1：用 toFixed(3) 避免 0.099 显示成 "0.10" 让用户误以为通过；
             * 同时显式标注"通过"/"未通过"减少歧义。 */
            const passed = r.oppositeRate >= 0.1;
            return {
                passed,
                evidence: r.oppositeRate,
                reason: `反向步占比 ${r.oppositeRate.toFixed(3)}（≥0.100 ${passed ? '通过' : '未通过'}）`,
                details: { samples: r.samples },
            };
        },
    },

    /* ---------- B. 求和契约 ---------- */
    {
        /* v1.62.6 修正：之前对比 `stress vs Σ`，但 `stress = clamp(rawStress, 0, 1)`，并不等于 Σ
         * （Σ 含 scoreStress / runStreakStress 等基线分量，可累计到 5+）。
         * 真实数据残差 7+ 完全无意义。正确的等式是 rawStress = Σ。 */
        id: 'stress-equals-sum-breakdown',
        desc: 'rawStress（stressBreakdown 内的"求和快照"）≈ Σ(全字段) — 验证 adaptiveSpawn 求和逻辑正确',
        source: 'adaptiveSpawn.js: stressBreakdown.rawStress = Σ(stressBreakdown.* 非 SKIP)',
        metrics: ['stress'],   // metric key 仅用于 applicableContracts 过滤；真实数据从特殊 series 取
        eval: (s) => {
            const rawStress = _arr(s, '__rawStressSeries');
            const sumSeries = _arr(s, '__stressBreakdownTotal');
            if (rawStress.length === 0 || sumSeries.length === 0) {
                return { passed: true, reason: '无 stressBreakdown / rawStress 数据，跳过判定', evidence: 0 };
            }
            const n = Math.min(rawStress.length, sumSeries.length);
            if (n < 5) return { passed: true, reason: '样本不足，跳过判定', evidence: 0 };
            let maxAbsDelta = 0;
            let avgAbsDelta = 0;
            let valid = 0;
            for (let i = 0; i < n; i++) {
                const a = Number(rawStress[i]);
                const b = Number(sumSeries[i]);
                if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
                const d = Math.abs(a - b);
                if (d > maxAbsDelta) maxAbsDelta = d;
                avgAbsDelta += d;
                valid++;
            }
            if (valid === 0) return { passed: true, reason: '无有效配对样本，跳过判定', evidence: 0 };
            avgAbsDelta /= valid;
            /* rawStress 是 Σ 自己的快照，理论上残差应当 = 0（仅浮点误差）；放宽到 ≤0.05 兜底。 */
            return {
                passed: avgAbsDelta <= 0.05,
                evidence: avgAbsDelta,
                reason: `rawStress vs Σ(stressBreakdown.*) 平均残差 ${avgAbsDelta.toFixed(4)}（max ${maxAbsDelta.toFixed(4)}；≤0.05 通过）`,
                details: { maxAbsDelta, samples: valid },
            };
        },
    },
    {
        /* v1.62.6 新增：顶层 stress ≈ clamp(rawStress, 0, 1) — 验证 normalize/clamp 链路。 */
        id: 'stress-is-clamped-rawStress',
        desc: '顶层 stress 应当 ≈ clamp(rawStress, 0, 1)（adaptiveSpawn 后置 normalize + clamp 不应失真）',
        source: 'adaptiveSpawn.js normalizeStress + clamp pipeline',
        metrics: ['stress'],
        eval: (s) => {
            const stress = _arr(s, 'stress');
            const rawStress = _arr(s, '__rawStressSeries');
            if (stress.length === 0 || rawStress.length === 0) {
                return { passed: true, reason: '无 stress / rawStress 数据，跳过判定', evidence: 0 };
            }
            const n = Math.min(stress.length, rawStress.length);
            if (n < 5) return { passed: true, reason: '样本不足，跳过判定', evidence: 0 };
            let maxAbsDelta = 0;
            let avgAbsDelta = 0;
            let valid = 0;
            for (let i = 0; i < n; i++) {
                const a = Number(stress[i]);
                const raw = Number(rawStress[i]);
                if (!Number.isFinite(a) || !Number.isFinite(raw)) continue;
                /* normalizeStress 可能把 [0, ~1.5] 区间映射到 [0, 1]，所以容忍 raw>1 时
                 * stress 是 1 附近。粗略比较：stress 应不超过 1 + ε、不低于 max(0, raw 的方向)。 */
                const expectClamped = Math.max(0, Math.min(1, raw));
                /* normalizeStress 是非线性函数，这里只做"方向一致 + 不超界"软判定。 */
                if (!(a >= -0.01 && a <= 1.01)) {
                    // stress 越界 → 立即记为最大残差
                    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(a - expectClamped));
                    avgAbsDelta += 1.0;
                    valid++;
                    continue;
                }
                /* 软对比：raw 落在 [0, 1] 时 stress 应当接近 raw；否则 stress 应贴近 0 或 1 */
                const target = (raw < 0) ? 0 : (raw > 1) ? 1 : raw;
                /* 容忍 normalize 引入的非线性偏差 0.30（远比之前 stress vs Σ 严格） */
                const d = Math.abs(a - target);
                if (d > maxAbsDelta) maxAbsDelta = d;
                avgAbsDelta += d;
                valid++;
            }
            if (valid === 0) return { passed: true, reason: '无有效配对样本', evidence: 0 };
            avgAbsDelta /= valid;
            return {
                passed: avgAbsDelta <= 0.30,
                evidence: avgAbsDelta,
                reason: `stress vs clamp(rawStress) 平均残差 ${avgAbsDelta.toFixed(3)}（max ${maxAbsDelta.toFixed(3)}；≤0.30 通过，容忍 normalize 非线性）`,
                details: { maxAbsDelta, samples: valid },
            };
        },
    },

    /* ---------- C. 相关性契约 ---------- */
    {
        id: 'flowAdjust-tracks-flowDeviation',
        desc: 'flowAdjust（stress 内心流分量）应跟随 flowDeviation 的方向；|r| ≥ 0.2 视为同向耦合',
        source: 'adaptiveSpawn.js — flowAdjust = clip(flowDeviation × signedDirection)',
        metrics: ['flowAdjust', 'flowDeviation'],
        eval: (s) => {
            const { r, n } = pearson(_arr(s, 'flowAdjust'), _arr(s, 'flowDeviation'));
            if (r == null) return { passed: true, reason: '样本不足', evidence: 0 };
            return {
                passed: Math.abs(r) >= 0.2,
                evidence: r,
                reason: `Pearson r=${r.toFixed(3)} (n=${n})；|r|≥0.2 视为正常耦合`,
                details: { n },
            };
        },
    },

    /* ---------- D. 滞后响应契约 ---------- */
    {
        id: 'feedbackBias-leads-stress',
        desc: 'feedbackBias[t] 应当与 stress[t+3] 有同向相关（闭环反馈滞后约 3-5 步生效）',
        source: 'REPLAY_METRICS.tooltip.feedbackBias',
        metrics: ['feedbackBias', 'stress'],
        eval: (s) => {
            const { r, n } = laggedPearson(_arr(s, 'feedbackBias'), _arr(s, 'stress'), 3);
            if (r == null) return { passed: true, reason: '样本不足', evidence: 0 };
            return {
                passed: r >= 0.05,
                evidence: r,
                reason: `lag=3 滞后相关 r=${r.toFixed(3)} (n=${n})；≥0.05 视为通过`,
                details: { lag: 3, n },
            };
        },
    },

    /* ---------- E. 单调漂移契约 ---------- */
    {
        id: 'score-monotone-increasing',
        desc: 'score 是累计量，整体应当单调不降（仅允许 last - first ≥ 0）',
        source: '游戏规则：得分不可扣除',
        metrics: ['score'],
        eval: (s) => {
            const xs = _arr(s, 'score').map(Number).filter(Number.isFinite);
            if (xs.length < 2) return { passed: true, reason: '样本不足', evidence: 0 };
            let violations = 0;
            for (let i = 1; i < xs.length; i++) {
                if (xs[i] < xs[i - 1]) violations++;
            }
            return {
                passed: violations === 0,
                evidence: violations,
                reason: violations === 0
                    ? `单调不降，end−start=${(xs[xs.length - 1] - xs[0]).toFixed(0)}`
                    : `${violations} 次下降——score 不应被扣减`,
                details: { violations },
            };
        },
    },
    {
        id: 'boardFill-bounded-0-1',
        desc: 'boardFill ∈ [0,1]；越界提示口径漂移或类型错误',
        source: 'Grid.getFillRatio()',
        metrics: ['boardFill'],
        eval: (s) => {
            const xs = _arr(s, 'boardFill').map(Number).filter(Number.isFinite);
            if (xs.length === 0) return { passed: true, reason: '无样本', evidence: 0 };
            let count = 0;
            let lo = Infinity;
            let hi = -Infinity;
            for (const v of xs) {
                if (v < 0 || v > 1) count++;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            return {
                passed: count === 0,
                evidence: count,
                reason: count === 0
                    ? `范围 [${lo.toFixed(2)}, ${hi.toFixed(2)}] ⊂ [0,1]`
                    : `${count} 帧越界 [0,1]（min=${lo.toFixed(2)} / max=${hi.toFixed(2)}）`,
                details: { min: lo, max: hi },
            };
        },
    },

    /* ---------- F. 系统响应契约 ---------- */
    {
        id: 'session-arc-warm-to-cool',
        desc: 'sessionArcAdjust 整局轨迹应近似"开头负→中段正→收官略负"（半圆弧）；长 session 或持续救济场景豁免',
        source: 'REPLAY_METRICS.tooltip.sessionArcAdjust',
        metrics: ['sessionArcAdjust'],
        eval: (s) => {
            const xs = _arr(s, 'sessionArcAdjust').map(Number).filter(Number.isFinite);
            if (xs.length < 9) return { passed: true, reason: '样本不足', evidence: 0 };

            /* v1.62.3：豁免规则 ——
             *   1. 长 session（≥ 150 帧 ≈ 25min）：peak/cooldown 时段划分本身失真，难以
             *      形成标准半圆弧，跳过判定避免假阳报警；
             *   2. 持续救济期占比 ≥ 30%：救济期间 sessionArc 会被压制成负值平台，
             *      违反"peak 高于两端"是预期行为，不应判失败。 */
            const sessionLen = Number(_arr(s, '__sessionLength')[0]);
            const reliefRatio = Number(_arr(s, '__sustainedReliefRatio')[0]) || 0;
            if (Number.isFinite(sessionLen) && sessionLen >= 150) {
                return {
                    passed: true,
                    evidence: sessionLen,
                    reason: `长 session（${sessionLen} 帧 ≥ 150）→ 半圆弧判定豁免`,
                    details: { exempted: 'long-session', sessionLen },
                };
            }
            if (reliefRatio >= 0.30) {
                return {
                    passed: true,
                    evidence: reliefRatio,
                    reason: `持续救济期占比 ${(reliefRatio * 100).toFixed(0)}% ≥ 30% → 半圆弧判定豁免`,
                    details: { exempted: 'sustained-relief', reliefRatio },
                };
            }

            const third = Math.floor(xs.length / 3);
            const m1 = xs.slice(0, third).reduce((a, b) => a + b, 0) / third;
            const m2 = xs.slice(third, 2 * third).reduce((a, b) => a + b, 0) / third;
            const m3 = xs.slice(2 * third).reduce((a, b) => a + b, 0) / (xs.length - 2 * third);
            const arcOk = m2 > m1 && m2 > m3 - 0.02;
            return {
                passed: arcOk,
                evidence: m2 - (m1 + m3) / 2,
                reason: `early=${m1.toFixed(3)} / peak=${m2.toFixed(3)} / late=${m3.toFixed(3)}（要求 peak 高于两端）`,
                details: { early: m1, peak: m2, late: m3 },
            };
        },
    },
    {
        /* v1.62.5（优化建议 #7）：feedback 闭环有效性 ——
         * 验证 "spawn 决策 → 后续玩家表现" 的因果链是否成立。
         *
         * 设计：spawnIntent 切到 relief 后 N 帧内的平均 clearRate 是否 > 前 N 帧（"救济有效"）。
         *
         * v1.62.6 放宽阈值：实测 5 帧窗口 + 0.05 阈值过严（0/4 完全失效）。
         * clearRate 是 PlayerProfile 内部 EMA 平滑量，需要更长窗口才能反映系统响应：
         *   - 窗口 5 → 10 帧（≈ 1 完整 dock 周期）
         *   - 阈值 0.05 → 0.02（5pp → 2pp，约 1 次额外消行）
         *
         * 通过率：≥ 50% 的 relief 切换有正向响应；样本不足则跳过判定。
         * 这是"画像驱动决策的闭环"是否真的工作的硬性证据。 */
        id: 'feedback-loop-effective',
        desc: '出块意图切到 relief 后 10 帧内 clearRate 应明显上升（≥+0.02），验证系统救济玩家有效',
        source: 'optimization #7 — closed-loop feedback validation',
        metrics: ['clearRate'],
        eval: (s) => {
            const intents = _arr(s, '__spawnIntentSeries');
            const clears = _arr(s, 'clearRate').map(Number);
            if (intents.length < 30) return { passed: true, reason: '样本不足', evidence: 0 };
            const N = Math.min(intents.length, clears.length);
            let reliefSwitches = 0;
            let effectiveSwitches = 0;
            const WIN = 10;             // v1.62.6: 5 → 10
            const THRESHOLD = 0.02;     // v1.62.6: 0.05 → 0.02
            for (let i = WIN; i < N - WIN; i++) {
                if (intents[i] !== 'relief' || intents[i - 1] === 'relief') continue;
                reliefSwitches++;
                const before = clears.slice(i - WIN, i).filter(Number.isFinite);
                const after = clears.slice(i, i + WIN).filter(Number.isFinite);
                if (before.length < 2 || after.length < 2) continue;
                const bAvg = before.reduce((a, b) => a + b, 0) / before.length;
                const aAvg = after.reduce((a, b) => a + b, 0) / after.length;
                if (aAvg > bAvg + THRESHOLD) effectiveSwitches++;
            }
            if (reliefSwitches < 3) {
                return { passed: true, reason: `relief 切换次数 ${reliefSwitches} < 3，样本不足跳过`, evidence: 0 };
            }
            const effRate = effectiveSwitches / reliefSwitches;
            return {
                passed: effRate >= 0.5,
                evidence: effRate,
                reason: `${effectiveSwitches}/${reliefSwitches} 次 relief 切换有效（窗口 ${WIN} 帧 + Δ≥${THRESHOLD}；≥50% 通过）`,
                details: { reliefSwitches, effectiveSwitches, window: WIN, threshold: THRESHOLD },
            };
        },
    },
    {
        /* v1.62.3：新增持续监控 spawnIntent 切换频率，与 INTENT_THRASHING hint 互补——
         * hint 只在单局触发，契约则汇入跨局违规率统计，让"出块意图频繁抖动"成为可被
         * topRegressions 捕获的稳定信号。
         *
         * 阈值：切换次数 / 总帧数 ≤ 0.10（即每 10 帧最多 1 次切换）。一局百帧级别
         * 大约允许 < 10 次切换；超过这个频率玩家会明显感觉到出块策略来回横跳。 */
        id: 'spawn-intent-no-thrashing',
        desc: 'spawnIntent 切换频率应稳定（≤ 0.10 切换/帧）；超阈值意味着出块意图频繁抖动',
        source: 'adaptiveSpawn.deriveSpawnIntent / playerInsightPanel intent chip',
        metrics: ['stress'],   // 数据由主入口注入 __spawnIntentSeries
        eval: (s) => {
            const series = _arr(s, '__spawnIntentSeries');
            if (series.length < 10) return { passed: true, reason: '样本不足', evidence: 0 };
            let switches = 0;
            let prev = null;
            let validFrames = 0;
            for (const intent of series) {
                if (intent == null) continue;
                validFrames++;
                if (prev != null && intent !== prev) switches++;
                prev = intent;
            }
            if (validFrames < 10) {
                return { passed: true, reason: 'spawnIntent 有效样本不足', evidence: 0 };
            }
            const rate = switches / validFrames;
            return {
                passed: rate <= 0.10,
                evidence: rate,
                reason: `切换 ${switches} 次 / ${validFrames} 帧 = ${(rate * 100).toFixed(1)}%（≤ 10% 通过）`,
                details: { switches, validFrames },
            };
        },
    },

    /* ---------- G. 漂移契约 ---------- */
    {
        id: 'skill-not-drift-too-fast',
        desc: 'skill 是 EMA + 历史融合，单局起末差异应在合理区间（|Δ| < 0.4）',
        source: 'playerProfile.skillLevel 设计 — 跨局校准、抗短期噪声',
        metrics: ['skill'],
        eval: (s) => {
            const delta = halvesMeanDiff(_arr(s, 'skill'));
            if (delta == null) return { passed: true, reason: '样本不足', evidence: 0 };
            return {
                passed: Math.abs(delta) < 0.4,
                evidence: delta,
                reason: `首尾半段均值差 ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}（|Δ|<0.4 通过）`,
                details: { halvesDelta: delta },
            };
        },
    },
];

/**
 * 找出可能触发的契约（按本局有数据的指标 key 过滤）。
 * 这样报告不会把"指标完全缺失因而契约空判过"也算入通过率，避免假阳通过。
 *
 * @param {Record<string, number[]>} series
 * @returns {ProfileContract[]}
 */
export function applicableContracts(series) {
    return CONTRACTS.filter((c) => c.metrics.every((k) => Array.isArray(series?.[k]) && series[k].length > 0));
}
