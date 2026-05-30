#!/usr/bin/env node
/**
 * 历史用户实时状态分析 + 自适应出块参数建议/应用工具。
 *
 * 默认行为：
 *   - 读取 SQLite 或 sessions JSON 中的 move_sequences.frames
 *   - 汇总实时状态分布、互操作关系、stress 分量贡献
 *   - 生成 Markdown 报告
 *   - 只给出推荐参数，不写回规则文件
 *
 * 显式传 --apply 时：
 *   - 更新 shared/game_rules.json 的 adaptiveSpawn.reactionAdjust / realtimeStateTuning
 *   - 同步 miniprogram/core/gameRulesData.js
 *
 * 用法：
 *   npm run spawn:realtime-tune -- --sqlite openblock.db --out docs/algorithms/REALTIME_STATE_HISTORY_ANALYSIS.md --pretty
 *   npm run spawn:realtime-tune -- --sqlite openblock.db --days 30 --apply --pretty
 *   npm run spawn:realtime-tune -- --sessions tmp/replay-sessions.json --json-out tmp/realtime-tune.json
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_OUT = 'docs/algorithms/REALTIME_STATE_HISTORY_ANALYSIS.md';
const DEFAULT_SHARED_RULES = 'shared/game_rules.json';
const DEFAULT_MP_RULES = 'miniprogram/core/gameRulesData.js';

function parseArgs(argv) {
    const opts = {
        out: DEFAULT_OUT,
        rules: DEFAULT_SHARED_RULES,
        mpRules: DEFAULT_MP_RULES,
        days: 0,
        apply: false,
        pretty: false,
        minSessions: 3,
        minFrames: 100,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const n = argv[i + 1];
        if (a === '--sqlite') { opts.sqlite = n; i++; }
        else if (a === '--sessions') { opts.sessions = n; i++; }
        else if (a === '--out') { opts.out = n; i++; }
        else if (a === '--json-out') { opts.jsonOut = n; i++; }
        else if (a === '--rules') { opts.rules = n; i++; }
        else if (a === '--mp-rules') { opts.mpRules = n; i++; }
        else if (a === '--days') { opts.days = Number(n); i++; }
        else if (a === '--min-sessions') { opts.minSessions = Number(n); i++; }
        else if (a === '--min-frames') { opts.minFrames = Number(n); i++; }
        else if (a === '--apply') { opts.apply = true; }
        else if (a === '--pretty') { opts.pretty = true; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
        else throw new Error(`未知参数：${a}`);
    }
    return opts;
}

function usage() {
    return [
        '用法: npm run spawn:realtime-tune -- [options]',
        '',
        '输入（二选一）:',
        '  --sqlite path/to/openblock.db       从 SQLite move_sequences 读取历史 frames',
        '  --sessions path/to/sessions.json    读取 [{sessionId,userId,frames}] 或 replay API 结构',
        '',
        '过滤:',
        '  --days N                            仅 SQLite 模式：按 sessions.end_time 取近 N 天；0=全部',
        '  --min-sessions N                    样本局数低于 N 时阻止 --apply（默认 3）',
        '  --min-frames N                      样本帧数低于 N 时阻止 --apply（默认 100）',
        '',
        '输出:',
        `  --out ${DEFAULT_OUT}   Markdown 报告路径`,
        '  --json-out path                     额外输出结构化 JSON',
        '  --pretty                            在 stderr 打印摘要',
        '',
        '应用:',
        '  --apply                             写回 shared/game_rules.json 并同步小程序镜像',
        '  --rules path                        shared 规则路径（默认 shared/game_rules.json）',
        '  --mp-rules path                     小程序镜像路径（默认 miniprogram/core/gameRulesData.js）',
        '',
    ].join('\n');
}

async function loadSqliteDriver() {
    try {
        const mod = await import('better-sqlite3');
        return mod.default;
    } catch (e) {
        throw new Error(`读取 SQLite 需要 better-sqlite3。原始错误：${e?.message || e}`);
    }
}

function parseFramesJson(text, sessionId) {
    try {
        const frames = JSON.parse(text || '[]');
        return Array.isArray(frames) ? frames : [];
    } catch {
        if (sessionId != null) {
            console.warn(`跳过 session=${sessionId}：frames JSON 损坏`);
        }
        return [];
    }
}

async function loadFromSqlite(dbPath, days) {
    const Database = await loadSqliteDriver();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    try {
        const rows = db.prepare(
            'SELECT m.session_id AS session_id, m.user_id AS user_id, m.frames AS frames, s.end_time AS end_time ' +
            'FROM move_sequences m LEFT JOIN sessions s ON s.id = m.session_id ' +
            'WHERE m.frames IS NOT NULL ORDER BY m.session_id DESC'
        ).all();
        const sinceMs = days > 0 ? Date.now() - days * 86400_000 : 0;
        const sessions = [];
        for (const row of rows) {
            const t = Number(row.end_time);
            const endMs = Number.isFinite(t) && t > 0 ? (t > 1e12 ? t : t * 1000) : null;
            if (sinceMs > 0 && endMs != null && endMs < sinceMs) continue;
            const frames = parseFramesJson(row.frames, row.session_id);
            if (frames.length === 0) continue;
            sessions.push({ sessionId: row.session_id, userId: row.user_id, frames });
        }
        return sessions;
    } finally {
        db.close();
    }
}

async function loadSessionsFile(path) {
    const data = JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
    const raw = Array.isArray(data) ? data
        : Array.isArray(data?.sessions) ? data.sessions
            : Array.isArray(data?.items) ? data.items
                : [];
    return raw.map((s, idx) => {
        const frames = Array.isArray(s.frames) ? s.frames
            : Array.isArray(s.move_frames) ? s.move_frames
                : typeof s.move_frames === 'string' ? parseFramesJson(s.move_frames, s.id ?? idx)
                    : [];
        return {
            sessionId: s.sessionId ?? s.session_id ?? s.id ?? idx,
            userId: s.userId ?? s.user_id ?? null,
            frames,
        };
    }).filter((s) => s.frames.length > 0);
}

function firstFinite(...values) {
    for (const v of values) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function framePs(frame) {
    return frame?.ps
        ?? frame?.playerState
        ?? frame?.state?.ps
        ?? frame?.snapshot?.ps
        ?? null;
}

function frameRow(frame, session) {
    const ps = framePs(frame);
    if (!ps || typeof ps !== 'object') return null;
    const metrics = ps.metrics ?? {};
    const ability = ps.ability ?? ps.abilityVector ?? {};
    const adaptive = ps.adaptive ?? {};
    const bd = adaptive.stressBreakdown ?? ps.stressBreakdown ?? {};
    return {
        sessionId: session.sessionId,
        userId: session.userId,
        stress: firstFinite(bd.finalStress, adaptive.stressRaw, ps.stressRaw, adaptive.stress, ps.stress),
        boardFill: firstFinite(ps.boardFill, metrics.boardFill, ps.fillRatio, adaptive.boardFill, frame.boardFill),
        skill: firstFinite(ps.skillLevel, ability.skillScore, ps.skillScore, metrics.skillScore),
        flowDeviation: firstFinite(ps.flowDeviation, metrics.flowDeviation, adaptive.flowDeviation),
        momentum: firstFinite(ps.momentum, metrics.momentum),
        cognitiveLoad: firstFinite(ps.cognitiveLoad, metrics.cognitiveLoad),
        frustration: firstFinite(ps.frustrationLevel, metrics.frustrationLevel, ps.frustration),
        thinkMs: firstFinite(metrics.thinkMs, ps.thinkMs),
        pickToPlaceMs: firstFinite(metrics.pickToPlaceMs, ps.pickToPlaceMs),
        clearRate: firstFinite(metrics.clearRate, ps.clearRate),
        missRate: firstFinite(metrics.missRate, ps.missRate),
        controlScore: firstFinite(ability.controlScore, ps.controlScore),
        riskLevel: firstFinite(ability.riskLevel, ps.riskLevel),
        flowState: ps.flowState ?? metrics.flowState ?? adaptive.flowState ?? null,
        pacingPhase: ps.pacingPhase ?? adaptive.pacingPhase ?? null,
        stressBreakdown: bd,
    };
}

function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        n: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: sum / sorted.length,
        p1: quantile(sorted, 0.01),
        p5: quantile(sorted, 0.05),
        p10: quantile(sorted, 0.10),
        p25: quantile(sorted, 0.25),
        p50: quantile(sorted, 0.50),
        p67: quantile(sorted, 0.67),
        p75: quantile(sorted, 0.75),
        p80: quantile(sorted, 0.80),
        p85: quantile(sorted, 0.85),
        p90: quantile(sorted, 0.90),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
    };
}

function pearson(rows, a, b) {
    const pairs = rows
        .map((r) => [r[a], r[b]])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pairs.length < 3) return null;
    const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
    const my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
    let num = 0, dx = 0, dy = 0;
    for (const [x, y] of pairs) {
        const vx = x - mx;
        const vy = y - my;
        num += vx * vy;
        dx += vx * vx;
        dy += vy * vy;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

function pct(n, d) {
    return d > 0 ? n / d : 0;
}

function roundStep(v, step, mode = 'nearest') {
    if (!Number.isFinite(v)) return null;
    const f = v / step;
    const r = mode === 'floor' ? Math.floor(f) : mode === 'ceil' ? Math.ceil(f) : Math.round(f);
    return r * step;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function compactNum(v, digits = 3) {
    if (v == null || !Number.isFinite(v)) return '—';
    return Number(v).toFixed(digits).replace(/\.?0+$/, '');
}

function ms(v) {
    return v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}ms`;
}

function percent(v, digits = 1) {
    return `${(v * 100).toFixed(digits)}%`;
}

function collectAnalysis(sessions) {
    const rows = [];
    for (const session of sessions) {
        for (const frame of session.frames) {
            const row = frameRow(frame, session);
            if (row) rows.push(row);
        }
    }
    const users = new Set(sessions.map((s) => s.userId).filter(Boolean));
    const metrics = [
        'stress', 'boardFill', 'skill', 'flowDeviation', 'momentum',
        'cognitiveLoad', 'frustration', 'thinkMs', 'pickToPlaceMs',
        'clearRate', 'missRate', 'controlScore', 'riskLevel',
    ];
    const metricStats = Object.fromEntries(metrics.map((m) => [m, stats(rows.map((r) => r[m]))]));
    const correlations = Object.fromEntries(metrics
        .filter((m) => m !== 'stress')
        .map((m) => [m, pearson(rows, 'stress', m)]));

    const conditions = {
        highLoad: (r) => r.cognitiveLoad >= 0.6,
        lowClear: (r) => r.clearRate < 0.25,
        anxious: (r) => r.flowState === 'anxious',
        highFrustration: (r) => r.frustration >= 4,
        bored: (r) => r.flowState === 'bored',
        highBoard: (r) => r.boardFill >= 0.58,
        slowReaction: (r) => r.pickToPlaceMs > 2200,
        fastReaction: (r) => r.pickToPlaceMs < 900,
    };
    const conditionShare = Object.fromEntries(Object.entries(conditions).map(([k, fn]) => [
        k,
        { count: rows.filter(fn).length, share: pct(rows.filter(fn).length, rows.length) },
    ]));
    const cooccurrence = [
        ['高板面 -> 高挫败', conditions.highBoard, conditions.highFrustration],
        ['低消行 -> 高挫败', conditions.lowClear, conditions.highFrustration],
        ['焦虑 -> 高负荷', conditions.anxious, conditions.highLoad],
        ['高负荷 -> 慢反应', conditions.highLoad, conditions.slowReaction],
        ['无聊 -> 快反应', conditions.bored, conditions.fastReaction],
    ].map(([label, base, target]) => {
        const baseRows = rows.filter(base);
        const hit = baseRows.filter(target).length;
        const targetAll = rows.filter(target).length;
        return {
            label,
            count: hit,
            baseCount: baseRows.length,
            probability: pct(hit, baseRows.length),
            baseline: pct(targetAll, rows.length),
        };
    });

    const comp = new Map();
    for (const r of rows) {
        for (const [key, value] of Object.entries(r.stressBreakdown ?? {})) {
            const n = Number(value);
            if (!Number.isFinite(n) || typeof value === 'boolean') continue;
            if (['finalStress', 'rawStress'].includes(key)) continue;
            const cur = comp.get(key) ?? { key, values: [], nonzero: 0 };
            cur.values.push(n);
            if (Math.abs(n) > 1e-6) cur.nonzero++;
            comp.set(key, cur);
        }
    }
    const stressComponents = [...comp.values()].map((c) => {
        const n = c.values.length || 1;
        const mean = c.values.reduce((a, b) => a + b, 0) / n;
        const meanAbs = c.values.reduce((a, b) => a + Math.abs(b), 0) / n;
        return { key: c.key, nonzeroRate: c.nonzero / n, meanAbs, mean };
    }).sort((a, b) => b.meanAbs - a.meanAbs).slice(0, 14);

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            sessions: sessions.length,
            users: users.size,
            frames: rows.length,
            reactionFrames: rows.filter((r) => Number.isFinite(r.pickToPlaceMs)).length,
        },
        rows,
        metricStats,
        correlations,
        conditionShare,
        cooccurrence,
        stressComponents,
    };
}

function recommendConfig(analysis, currentRules) {
    const adaptive = currentRules.adaptiveSpawn ?? {};
    const currentReaction = adaptive.reactionAdjust ?? {};
    const currentRt = adaptive.realtimeStateTuning ?? {};
    const r = analysis.metricStats.pickToPlaceMs;
    const board = analysis.metricStats.boardFill;
    const clear = analysis.metricStats.clearRate;
    const load = analysis.metricStats.cognitiveLoad;

    const reaction = { ...currentReaction };
    if (r && r.n >= 50) {
        const fastMs = clamp(roundStep(r.p5, 50, 'floor'), 500, 1400);
        const slowMs = clamp(roundStep(r.p95, 50, 'ceil'), fastMs + 400, 4500);
        reaction.fastMs = fastMs;
        reaction.slowMs = slowMs;
        reaction.fastFullMs = clamp(roundStep(Math.min(r.p1 ?? fastMs * 0.55, fastMs * 0.60), 50, 'floor'), 250, fastMs - 100);
        reaction.slowFullMs = clamp(roundStep(Math.max(r.p99 ?? slowMs * 1.45, slowMs + 800), 50, 'ceil'), slowMs + 300, 6000);
        reaction.maxAdjust = currentReaction.maxAdjust ?? 0.05;
    }

    const lowClearShare = analysis.conditionShare.lowClear?.share ?? 0;
    const highBoardToFrust = analysis.cooccurrence.find((c) => c.label.startsWith('高板面'))?.probability ?? 0;
    const anxiousToLoad = analysis.cooccurrence.find((c) => c.label.startsWith('焦虑'))?.probability ?? 0;

    const realtimeStateTuning = {
        comment: currentRt.comment ?? '基于历史实时状态序列的复合早期救济：低消行+中高板面提前防挫败，高板面+挫败处理死局感合流，anxious+高认知负荷降低决策复杂度；同时在困境中削弱长期偏正的 feedbackBias。',
        preFrustrationRelief: {
            enabled: true,
            clearRateMax: clamp(roundStep(clear?.p25 ?? 0.25, 0.01, 'nearest'), 0.18, 0.32),
            boardFillMin: clamp(roundStep(board?.p75 ?? 0.45, 0.01, 'nearest'), 0.38, 0.55),
            maxRelief: lowClearShare >= 0.12 ? 0.06 : 0.04,
        },
        boardFrustrationRelief: {
            enabled: true,
            boardFillMin: clamp(roundStep(board?.p95 ?? 0.58, 0.01, 'nearest'), 0.52, 0.70),
            frustrationMin: highBoardToFrust >= 0.25 ? 3 : 4,
            maxRelief: highBoardToFrust >= 0.30 ? 0.12 : 0.08,
        },
        decisionLoadRelief: {
            enabled: true,
            cognitiveLoadMin: clamp(roundStep(load?.p67 ?? 0.60, 0.01, 'nearest'), 0.50, 0.75),
            maxRelief: anxiousToLoad >= 0.55 ? 0.07 : 0.05,
        },
        feedbackBiasDamping: {
            enabled: true,
            factor: 0.5,
            maxDamping: 0.08,
        },
    };

    return { reactionAdjust: reaction, realtimeStateTuning };
}

function table(rows) {
    return rows.join('\n');
}

function renderMarkdown(analysis, recommended, currentRules, applied) {
    const s = analysis.metricStats;
    const c = analysis.conditionShare;
    const corrEntries = Object.entries(analysis.correlations)
        .filter(([, v]) => Number.isFinite(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 10);
    const currentReaction = currentRules.adaptiveSpawn?.reactionAdjust ?? {};
    const currentRt = currentRules.adaptiveSpawn?.realtimeStateTuning ?? {};

    const lines = [];
    lines.push('# 用户实时状态历史序列分析');
    lines.push('');
    lines.push(`> 生成时间：${analysis.generatedAt}`);
    lines.push(`> 样本：${analysis.summary.sessions} 局、${analysis.summary.frames} 帧、${analysis.summary.reactionFrames} 个反应样本帧、${analysis.summary.users} 个用户。`);
    lines.push(`> 运行模式：${applied ? '已应用推荐参数到规则文件' : 'dry-run，仅生成建议未写回参数'}。`);
    lines.push('');
    lines.push('## 1. 工具化流程');
    lines.push('');
    lines.push('后续更新历史数据后，直接运行：');
    lines.push('');
    lines.push('```bash');
    lines.push('npm run spawn:realtime-tune -- --sqlite openblock.db --pretty');
    lines.push('npm run spawn:realtime-tune -- --sqlite openblock.db --apply --pretty');
    lines.push('```');
    lines.push('');
    lines.push('第一条只分析并更新本报告；第二条会把推荐参数写入 `shared/game_rules.json`，并同步 `miniprogram/core/gameRulesData.js`。');
    lines.push('');
    lines.push('## 2. 关键指标分布');
    lines.push('');
    lines.push('| 指标 | n | p10 | p50 | p90 | p95 | mean |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const key of ['stress', 'boardFill', 'cognitiveLoad', 'frustration', 'thinkMs', 'pickToPlaceMs', 'clearRate', 'missRate']) {
        const st = s[key];
        const fmt = key.endsWith('Ms') ? ms : (v) => compactNum(v, 3);
        lines.push(`| \`${key}\` | ${st?.n ?? 0} | ${fmt(st?.p10)} | ${fmt(st?.p50)} | ${fmt(st?.p90)} | ${fmt(st?.p95)} | ${fmt(st?.mean)} |`);
    }
    lines.push('');
    lines.push('## 3. 状态触发占比');
    lines.push('');
    lines.push('| 条件 | 帧占比 | 命中帧 |');
    lines.push('|---|---:|---:|');
    const labels = {
        highLoad: '`cognitiveLoad >= 0.6`',
        lowClear: '`clearRate < 0.25`',
        anxious: '`flowState = anxious`',
        highFrustration: '`frustration >= 4`',
        bored: '`flowState = bored`',
        highBoard: '`boardFill >= 0.58`',
        slowReaction: '`pickToPlaceMs > 2200ms`',
        fastReaction: '`pickToPlaceMs < 900ms`',
    };
    for (const [key, label] of Object.entries(labels)) {
        lines.push(`| ${label} | ${percent(c[key]?.share ?? 0)} | ${c[key]?.count ?? 0} |`);
    }
    lines.push('');
    lines.push('## 4. 与 `stress` 的相关性');
    lines.push('');
    lines.push('| 指标 | Pearson r |');
    lines.push('|---|---:|');
    for (const [key, value] of corrEntries) {
        lines.push(`| \`${key}\` | ${compactNum(value, 3)} |`);
    }
    lines.push('');
    lines.push('## 5. 关键互操作链路');
    lines.push('');
    lines.push('| 链路 | 条件概率 | 基线 | 命中/条件样本 |');
    lines.push('|---|---:|---:|---:|');
    for (const item of analysis.cooccurrence) {
        lines.push(`| ${item.label} | ${percent(item.probability)} | ${percent(item.baseline)} | ${item.count}/${item.baseCount} |`);
    }
    lines.push('');
    lines.push('## 6. stress 分量贡献');
    lines.push('');
    lines.push('| 分量 | 非零率 | meanAbs | mean |');
    lines.push('|---|---:|---:|---:|');
    for (const item of analysis.stressComponents) {
        lines.push(`| \`${item.key}\` | ${percent(item.nonzeroRate)} | ${compactNum(item.meanAbs, 3)} | ${compactNum(item.mean, 3)} |`);
    }
    lines.push('');
    lines.push('## 7. 推荐参数');
    lines.push('');
    lines.push('### 7.1 reactionAdjust');
    lines.push('');
    lines.push('| 参数 | 当前 | 推荐 |');
    lines.push('|---|---:|---:|');
    for (const key of ['fastMs', 'fastFullMs', 'slowMs', 'slowFullMs', 'maxAdjust']) {
        lines.push(`| \`${key}\` | ${compactNum(currentReaction[key], 3)} | ${compactNum(recommended.reactionAdjust[key], 3)} |`);
    }
    lines.push('');
    lines.push('### 7.2 realtimeStateTuning');
    lines.push('');
    lines.push('| 模块 | 当前 | 推荐 |');
    lines.push('|---|---|---|');
    for (const key of ['preFrustrationRelief', 'boardFrustrationRelief', 'decisionLoadRelief', 'feedbackBiasDamping']) {
        lines.push(`| \`${key}\` | \`${JSON.stringify(currentRt[key] ?? {})}\` | \`${JSON.stringify(recommended.realtimeStateTuning[key])}\` |`);
    }
    lines.push('');
    lines.push('## 8. 调参判断');
    lines.push('');
    lines.push('- `reactionAdjust` 使用当前反应分布的 p5/p95 作为尾部触发点，并用 p1/p99 或安全比例推导饱和点。');
    lines.push('- `preFrustrationRelief` 使用低消行分位和中高板面分位，目标是在 `frustration>=4` 前介入。');
    lines.push('- `boardFrustrationRelief` 根据“高板面 -> 高挫败”的条件概率决定强度。');
    lines.push('- `decisionLoadRelief` 根据“焦虑 -> 高认知负荷”的条件概率决定强度。');
    lines.push('- `feedbackBiasDamping` 固定为困境去偏，不改变顺局正反馈。');
    lines.push('');
    lines.push('## 9. 后续观察指标');
    lines.push('');
    lines.push('- `preFrustrationRelief` 触发后，后续 3–5 帧内 `frustration` 是否下降。');
    lines.push('- `boardFrustrationRelief` 触发后，game over 前高板面帧是否减少。');
    lines.push('- `decisionLoadRelief` 触发后，`thinkMs` 与 `cognitiveLoad` 是否回落。');
    lines.push('- `reactionAdjust` 非零率是否稳定在 5%–12%，避免变成主导分量。');
    lines.push('- `feedbackBiasDampingAdjust` 是否只在困境帧出现。');
    lines.push('');
    return table(lines);
}

async function writeJson(path, data) {
    await mkdir(dirname(resolve(process.cwd(), path)), { recursive: true });
    await writeFile(resolve(process.cwd(), path), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function syncMiniprogramRules(sharedRulesPath, mpRulesPath) {
    const data = JSON.parse(await readFile(resolve(process.cwd(), sharedRulesPath), 'utf8'));
    const body = JSON.stringify(data, null, 2);
    const comment = '小程序运行时数据模块；避免直接 require JSON 导致部分开发工具配置下解析为 .json.js。\\n * 数据来自 shared/game_rules.json。';
    await writeFile(
        resolve(process.cwd(), mpRulesPath),
        '/**\n * ' + comment + '\n */\nmodule.exports = ' + body + ';\n',
        'utf8'
    );
}

async function applyRecommendations(rulesPath, mpRulesPath, recommended) {
    const path = resolve(process.cwd(), rulesPath);
    const rules = JSON.parse(await readFile(path, 'utf8'));
    rules.adaptiveSpawn = rules.adaptiveSpawn ?? {};
    rules.adaptiveSpawn.reactionAdjust = {
        ...(rules.adaptiveSpawn.reactionAdjust ?? {}),
        ...recommended.reactionAdjust,
    };
    rules.adaptiveSpawn.realtimeStateTuning = recommended.realtimeStateTuning;
    await writeFile(path, JSON.stringify(rules, null, 2) + '\n', 'utf8');
    await syncMiniprogramRules(rulesPath, mpRulesPath);
    return rules;
}

function assertEnoughData(analysis, opts) {
    const problems = [];
    if (analysis.summary.sessions < opts.minSessions) {
        problems.push(`样本局数 ${analysis.summary.sessions} < min-sessions ${opts.minSessions}`);
    }
    if (analysis.summary.frames < opts.minFrames) {
        problems.push(`样本帧数 ${analysis.summary.frames} < min-frames ${opts.minFrames}`);
    }
    if (problems.length > 0) {
        throw new Error(`样本不足，拒绝 --apply：${problems.join('；')}`);
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(usage());
        return;
    }
    if (!opts.sqlite && !opts.sessions) {
        throw new Error('必须传入 --sqlite 或 --sessions。\n' + usage());
    }
    if (opts.sqlite && !existsSync(resolve(process.cwd(), opts.sqlite))) {
        throw new Error(`SQLite 文件不存在：${opts.sqlite}`);
    }
    const sessions = opts.sqlite
        ? await loadFromSqlite(opts.sqlite, opts.days)
        : await loadSessionsFile(opts.sessions);
    if (sessions.length === 0) {
        throw new Error('没有可用的历史 frames。');
    }

    const currentRules = JSON.parse(await readFile(resolve(process.cwd(), opts.rules), 'utf8'));
    const analysis = collectAnalysis(sessions);
    const recommended = recommendConfig(analysis, currentRules);

    let effectiveRules = currentRules;
    if (opts.apply) {
        assertEnoughData(analysis, opts);
        effectiveRules = await applyRecommendations(opts.rules, opts.mpRules, recommended);
    }

    const markdown = renderMarkdown(analysis, recommended, effectiveRules, opts.apply);
    if (opts.out && opts.out !== '-') {
        await mkdir(dirname(resolve(process.cwd(), opts.out)), { recursive: true });
        await writeFile(resolve(process.cwd(), opts.out), markdown, 'utf8');
    } else {
        console.log(markdown);
    }
    if (opts.jsonOut) {
        await writeJson(opts.jsonOut, {
            generatedAt: analysis.generatedAt,
            summary: analysis.summary,
            metricStats: analysis.metricStats,
            correlations: analysis.correlations,
            conditionShare: analysis.conditionShare,
            cooccurrence: analysis.cooccurrence,
            stressComponents: analysis.stressComponents,
            recommended,
            applied: opts.apply,
        });
    }
    if (opts.pretty) {
        console.error(`实时状态分析完成：${analysis.summary.sessions} 局 / ${analysis.summary.frames} 帧 / reaction ${analysis.summary.reactionFrames} 帧`);
        console.error(`报告：${opts.out || '(stdout)'}`);
        console.error(`参数：${opts.apply ? '已应用' : 'dry-run 未应用'}`);
    }
}

main().catch((e) => {
    console.error(`错误：${e?.message || e}`);
    process.exit(1);
});
