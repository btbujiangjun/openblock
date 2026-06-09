/**
 * runToRunEvaluator.js — 局间（多局）评估聚合
 *
 * 输入一组 `sessionEvalRecord`（按 startedAt 升序），输出短窗（同一日）与
 * 中窗（多日）的聚合指标，专门支撑 v1.68 RoR 系统验收、A/B 实验与灰度回滚。
 * 详细 KPI 与公式见 docs/algorithms/SESSION_EVALUATION.md §3。
 *
 * 纯函数：不读全局状态、不依赖网络；上层负责传入历史数据。
 */

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function safeMean(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0; let n = 0;
    for (const v of arr) {
        if (!Number.isFinite(v)) continue;
        s += v; n += 1;
    }
    return n > 0 ? s / n : 0;
}

function regressionSlope(arr) {
    if (!arr || arr.length < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < arr.length; i++) {
        const y = Number(arr[i]) || 0;
        sumX += i; sumY += y; sumXY += i * y; sumXX += i * i;
    }
    const denom = arr.length * sumXX - sumX * sumX;
    return denom === 0 ? 0 : (arr.length * sumXY - sumX * sumY) / denom;
}

function dayKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function groupBy(records, keyFn) {
    const out = new Map();
    for (const r of records) {
        const k = keyFn(r);
        if (k == null) continue;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(r);
    }
    return out;
}

/* ─────────────────────────── 短窗（按日聚合）───────────────────────── */

export function buildIntraDayReport(sessions, opts = {}) {
    const today = opts.dayKey || (sessions[0]?.meta?.startedAt ? dayKey(sessions[0].meta.startedAt) : null);
    if (!today) return null;
    const sorted = sessions
        .filter((s) => s?.meta?.startedAt && dayKey(s.meta.startedAt) === today)
        .sort((a, b) => a.meta.startedAt - b.meta.startedAt);
    if (!sorted.length) return null;

    const scores = sorted.map((s) => s.outcome?.finalScore || 0);
    const regrets = sorted.map((s) => s.cross?.regretPerStep || 0);
    const arcs = sorted.map((s) => s.arcContext?.runOverRunArc).filter(Boolean);
    const arcSet = new Set(arcs);
    const arcOfLast = arcs.length ? arcs[arcs.length - 1] : null;
    const arcBuckets = arcs.reduce((acc, a) => { acc[a] = (acc[a] || 0) + 1; return acc; }, {});

    // arcCapAdherence：实际 peakStress 是否落在该 arc 的预期 cap 内。
    const capExpect = opts.arcCapExpect || {};
    let capAdhere = 0; let capCheck = 0;
    for (const s of sorted) {
        const arc = s.arcContext?.runOverRunArc;
        const cap = capExpect[arc];
        if (!arc || !Number.isFinite(cap)) continue;
        capCheck++;
        if ((s.trajectory?.peakStress || 0) <= cap + 0.05) capAdhere++;
    }

    // cooldown 后是否成功回到 opener/momentum 而不是连 cooldown。
    let cooldownNext = 0; let cooldownRecovered = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].arcContext?.runOverRunArc !== 'cooldown') continue;
        cooldownNext++;
        const nextArc = sorted[i + 1].arcContext?.runOverRunArc;
        if (nextArc === 'opener' || nextArc === 'momentum') cooldownRecovered++;
    }
    const breakAfterCooldownRate = cooldownNext > 0 ? cooldownRecovered / cooldownNext : null;

    // rageRestartCatch：60s 窗口实际抓到的赌气重开数 / 5s 旧窗口（窗口对比）。
    let catch60 = 0; let catch5 = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].meta.startedAt - sorted[i - 1].meta.endedAt;
        const pb = sorted[i].arcContext?.pbBefore || 0;
        const low = pb > 0 && (sorted[i - 1].outcome?.finalScore || 0) < pb * 0.3;
        if (!low) continue;
        if (gap <= 60000) catch60++;
        if (gap <= 5000) catch5++;
    }

    return {
        dayKey: today,
        dailyRunCount: sorted.length,
        arcCoverage: Array.from(arcSet),
        arcDistribution: arcBuckets,
        arcOfLast,
        intraDayScoreSlope: regressionSlope(scores),
        intraDayRegretSlope: regressionSlope(regrets),
        meanForcedBadRatio: safeMean(sorted.map((s) => s.cross?.forcedBadRatio || 0)),
        meanSalvageRatio: safeMean(sorted.map((s) => s.cross?.salvageRatio || 0)),
        arcCapAdherence: capCheck > 0 ? capAdhere / capCheck : null,
        breakAfterCooldownRate,
        rageRestartCatch: {
            within60s: catch60,
            within5s: catch5,
            widenedRatio: catch5 > 0 ? catch60 / catch5 : (catch60 > 0 ? Infinity : 0),
        },
    };
}

/* ─────────────────────────── 中窗（多日聚合）───────────────────────── */

export function buildMultiDayReport(sessions, opts = {}) {
    const windowDays = Math.max(1, Number(opts.windowDays) || 7);
    const now = Number(opts.now) || Date.now();
    const cutoff = now - windowDays * 24 * 3600 * 1000;
    const inWindow = sessions
        .filter((s) => s?.meta?.startedAt && s.meta.startedAt >= cutoff)
        .sort((a, b) => a.meta.startedAt - b.meta.startedAt);
    if (!inWindow.length) return null;

    const byDay = groupBy(inWindow, (s) => dayKey(s.meta.startedAt));
    const days = Array.from(byDay.keys()).sort();
    const dailyMeanRegret = days.map((d) => safeMean(byDay.get(d).map((s) => s.cross?.regretPerStep || 0)));
    const dailyMeanScore = days.map((d) => safeMean(byDay.get(d).map((s) => s.outcome?.finalScore || 0)));
    const dailyFlowMinutes = days.map((d) => {
        const total = byDay.get(d).reduce((acc, s) => {
            const ms = (s.outcome?.runDurationMs || 0) * (s.guard?.flowRatio || 0);
            return acc + ms;
        }, 0);
        return total / 60000;
    });

    // PB 推进：最近 1 局 vs 窗口起点 PB
    const pbStart = inWindow[0]?.arcContext?.pbBefore || 0;
    const pbEnd = inWindow[inWindow.length - 1]?.arcContext?.pbAfter
        || inWindow[inWindow.length - 1]?.arcContext?.pbBefore
        || 0;

    let frustrationStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        const flowOk = dailyFlowMinutes[i] >= (opts.flowMinutesMin ?? 3);
        if (!flowOk) frustrationStreak++; else break;
    }

    return {
        windowDays,
        sessionCount: inWindow.length,
        dayCount: days.length,
        days,
        dailyMeanRegret,
        dailyMeanScore,
        dailyFlowMinutes,
        regretSlope: regressionSlope(dailyMeanRegret),
        scoreSlope: regressionSlope(dailyMeanScore),
        pbProgression: {
            start: pbStart,
            end: pbEnd,
            delta: pbEnd - pbStart,
            growthRate: pbStart > 0 ? clamp01((pbEnd - pbStart) / pbStart) : 0,
        },
        frustrationStreakDays: frustrationStreak,
        meanForcedBadRatio: safeMean(inWindow.map((s) => s.cross?.forcedBadRatio || 0)),
        meanSalvageRatio: safeMean(inWindow.map((s) => s.cross?.salvageRatio || 0)),
    };
}

/* ─────────────────────────── A/B 与模型漂移 ─────────────────────────── */

/**
 * 给定两个分组的 session 列表（如新旧 spawn 模型版本），输出主指标差异，用于
 * 灰度回滚自动门：当主指标恶化超过 thresholds，应触发回滚告警。
 */
export function compareModelVersions(groupA, groupB, opts = {}) {
    const metric = (records, path) => {
        const get = (rec) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), rec);
        return safeMean(records.map((r) => Number(get(r)) || 0));
    };
    const fields = [
        'trajectory.boardStressAUC',
        'cross.regretPerStep',
        'cross.forcedBadRatio',
        'cross.salvageRatio',
        'spawnAudit.guaranteeBreachRate',
        'spawnAudit.payoffRealizationRate',
        'spawnAudit.intentRealizationRate.relief',
        'spawnAudit.intentRealizationRate.pressure',
    ];
    const summary = {};
    for (const f of fields) {
        const a = metric(groupA, f);
        const b = metric(groupB, f);
        summary[f] = { a, b, delta: b - a, ratio: a !== 0 ? (b - a) / Math.abs(a) : 0 };
    }
    const trigger = {
        rollbackRecommended: false,
        reasons: [],
    };
    const t = { ...{
        regretDeltaMax: 0.05,
        forcedBadDeltaMax: 0.05,
        guaranteeBreachDeltaMax: 0.05,
    }, ...(opts.thresholds || {}) };
    if (summary['cross.regretPerStep'].delta > t.regretDeltaMax) {
        trigger.rollbackRecommended = true;
        trigger.reasons.push('regretPerStep degraded');
    }
    if (summary['cross.forcedBadRatio'].delta > t.forcedBadDeltaMax) {
        trigger.rollbackRecommended = true;
        trigger.reasons.push('forcedBadRatio increased');
    }
    if (summary['spawnAudit.guaranteeBreachRate'].delta > t.guaranteeBreachDeltaMax) {
        trigger.rollbackRecommended = true;
        trigger.reasons.push('guaranteeBreachRate increased');
    }
    return { summary, trigger, sampleSizeA: groupA.length, sampleSizeB: groupB.length };
}
