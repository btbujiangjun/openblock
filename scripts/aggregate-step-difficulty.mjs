#!/usr/bin/env node
/**
 * P4 — 单步出块难度分桶聚合（替代「题目级」聚合）。
 *
 * 无尽模式无「题目」概念，无法按 puzzle_id 跨记录聚合去噪。本工具改用
 * **难度桶 × 算法** 作为聚合主键：读取 move_sequences.frames 里 spawn 帧的
 * `spawnMeta.stepDifficulty`（由 web/src/spawnStepDifficulty.js 落库），按
 * (难度桶 trivial/easy/standard/hard/extreme × 算法 strategyId) 聚合下一步表现，
 * 还原外部提案里的 `avg_*` / `global_*` / `algo_*` / `*_range` / `*_cv` 等指标。
 *
 * 「下一步表现」= 该 spawn 帧之后、下一个 spawn 帧之前的 place 帧聚合：
 *   thinkMs / linesCleared / fill delta。这样把「本轮出块难度」与「玩家随后的表现」对齐。
 *
 * 用法：
 *   node scripts/aggregate-step-difficulty.mjs --sqlite openblock.db --pretty
 *   node scripts/aggregate-step-difficulty.mjs --sessions tmp/sessions.json --json-out tmp/step-diff.json
 *
 * 详见 docs/algorithms/ALGORITHMS_SPAWN.md §14.二。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DIFFICULTY_BUCKETS } from '../web/src/spawnStepDifficulty.js';

function parseArgs(argv) {
    const opts = { pretty: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const n = argv[i + 1];
        if (a === '--sqlite') { opts.sqlite = n; i++; }
        else if (a === '--sessions') { opts.sessions = n; i++; }
        else if (a === '--days') { opts.days = Number(n); i++; }
        else if (a === '--json-out') { opts.jsonOut = n; i++; }
        else if (a === '--pretty') { opts.pretty = true; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
        else throw new Error(`未知参数：${a}`);
    }
    return opts;
}

function usage() {
    return [
        '用法: node scripts/aggregate-step-difficulty.mjs [options]',
        '',
        '输入（二选一）:',
        '  --sqlite path/to/openblock.db    从 SQLite move_sequences 读取 frames',
        '  --sessions path/to/sessions.json [{sessionId,userId,frames}] / {sessions|items:[...]}',
        '',
        '过滤/输出:',
        '  --days N        仅 SQLite：按 sessions.end_time 取近 N 天；0=全部',
        '  --json-out path 输出结构化 JSON',
        '  --pretty        在 stdout 打印聚合表',
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
        if (sessionId != null) console.warn(`跳过 session=${sessionId}：frames JSON 损坏`);
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
            : Array.isArray(data?.items) ? data.items : [];
    return raw.map((s, idx) => {
        const frames = Array.isArray(s.frames) ? s.frames
            : typeof s.move_frames === 'string' ? parseFramesJson(s.move_frames, s.id ?? idx)
                : Array.isArray(s.move_frames) ? s.move_frames : [];
        return { sessionId: s.sessionId ?? s.session_id ?? s.id ?? idx, userId: s.userId ?? s.user_id ?? null, frames };
    }).filter((s) => s.frames.length > 0);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function summarize(values) {
    const xs = values.filter((v) => Number.isFinite(v));
    if (!xs.length) return { n: 0, mean: null, min: null, max: null, stddev: null, cv: null, range: null };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const stddev = Math.sqrt(variance);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return { n: xs.length, mean, min, max, stddev, cv: mean > 0 ? stddev / mean : null, range: max - min };
}

/**
 * 把每个 spawn 帧（带 stepDifficulty）与其后续 place 帧表现配对。
 * @returns {Array<{bucket, algo, stepDifficulty, thinkMs, lines, fillDelta}>}
 */
function collectStepRows(sessions) {
    const rows = [];
    for (const { frames } of sessions) {
        if (!Array.isArray(frames)) continue;
        let pending = null;
        for (const f of frames) {
            if (f?.t === 'spawn') {
                const sd = f?.spawnMeta?.stepDifficulty;
                if (sd && typeof sd === 'object' && typeof sd.bucket === 'string') {
                    pending = {
                        bucket: sd.bucket,
                        algo: f?.ps?.strategyId ?? f?.ps?.adaptive?.strategyId ?? 'unknown',
                        stepDifficulty: num(sd.stepDifficulty),
                        scdScore: num(sd.scdScore),
                        comboKillerCnt: num(sd.comboKillerCnt),
                        /* 客观几何（blockSpawn 在 stepDifficulty 落库对象上 post-hoc 附挂） */
                        contiguousRegions: num(sd.contiguousRegions),
                        concaveCorners: num(sd.concaveCorners),
                        fillAtSpawn: num(f?.ps?.boardFill)
                    };
                } else {
                    pending = null;
                }
            } else if (f?.t === 'place' && pending) {
                const think = num(f?.ps?.metrics?.thinkMs);
                const lines = num(f?.ps?.linesCleared) ?? 0;
                const fillNow = num(f?.ps?.boardFill);
                /* 清屏：本步有消行且消完后盘面归零（perfect clear 代理口径） */
                const cleanScreen = lines > 0 && fillNow != null && fillNow <= 0 ? 1 : 0;
                rows.push({
                    bucket: pending.bucket,
                    algo: pending.algo,
                    stepDifficulty: pending.stepDifficulty,
                    scdScore: pending.scdScore,
                    comboKillerCnt: pending.comboKillerCnt,
                    contiguousRegions: pending.contiguousRegions,
                    concaveCorners: pending.concaveCorners,
                    thinkMs: think,
                    lines,
                    cleanScreen,
                    fillDelta: fillNow != null && pending.fillAtSpawn != null ? fillNow - pending.fillAtSpawn : null
                });
            }
        }
    }
    return rows;
}

function aggregate(rows) {
    const byBucket = {};
    const byBucketAlgo = {};
    const algos = new Set();
    for (const r of rows) {
        (byBucket[r.bucket] ??= []).push(r);
        const key = `${r.bucket}::${r.algo}`;
        (byBucketAlgo[key] ??= []).push(r);
        algos.add(r.algo);
    }
    const rate = (rs, pred) => (rs.length ? rs.filter(pred).length / rs.length : null);
    const bucketStats = {};
    for (const b of DIFFICULTY_BUCKETS) {
        const rs = byBucket[b] || [];
        bucketStats[b] = {
            samples: rs.length,
            stepDifficulty: summarize(rs.map((r) => r.stepDifficulty)),
            thinkMs: summarize(rs.map((r) => r.thinkMs)),
            lines: summarize(rs.map((r) => r.lines)),
            /* 结果质量分布（爽感 / 垃圾时间归因） */
            noBlastRate: rate(rs, (r) => (r.lines ?? 0) === 0),
            multiBlastRate: rate(rs, (r) => (r.lines ?? 0) >= 2),
            cleanScreenRate: rate(rs, (r) => r.cleanScreen === 1),
            /* 客观几何（空白连通块数 / 凹角数）随难度桶的均值 */
            contiguousRegions: summarize(rs.map((r) => r.contiguousRegions)),
            concaveCorners: summarize(rs.map((r) => r.concaveCorners))
        };
    }
    const cells = {};
    for (const [key, rs] of Object.entries(byBucketAlgo)) {
        cells[key] = {
            samples: rs.length,
            thinkMs: summarize(rs.map((r) => r.thinkMs)),
            lines: summarize(rs.map((r) => r.lines))
        };
    }
    /* algoScoreSpread：各算法平均难度的跨度（无题目下的「算法间难度跨度诊断」） */
    const algoMeanDiff = {};
    for (const a of algos) {
        const rs = rows.filter((r) => r.algo === a);
        algoMeanDiff[a] = summarize(rs.map((r) => r.stepDifficulty)).mean;
    }
    const algoMeans = Object.values(algoMeanDiff).filter((v) => Number.isFinite(v));
    const algoScoreSpread = algoMeans.length >= 2 ? Math.max(...algoMeans) - Math.min(...algoMeans) : null;

    /* 离散度 / 跨度诊断（零成本，提升算法间难度可比性）：
     *   scd_cv     空间约束密度变异系数（>0.3 表示难度起伏显著）
     *   scd_range  空间约束密度绝对跨度
     *   killer_range 杀手块数量跨度（如 3 表示数据里从 0 到 3 个都出现过） */
    const scdSummary = summarize(rows.map((r) => r.scdScore));
    const killerSummary = summarize(rows.map((r) => r.comboKillerCnt));
    const spread = {
        scdCv: scdSummary.cv,
        scdRange: scdSummary.range,
        killerRange: killerSummary.range,
        algoScoreSpread
    };

    return {
        totalSteps: rows.length,
        algos: [...algos],
        bucketStats,
        byBucketAlgo: cells,
        algoMeanDifficulty: algoMeanDiff,
        algoScoreSpread,
        spread
    };
}

function prettyPrint(agg) {
    const lines = [];
    lines.push(`总步数: ${agg.totalSteps} | 算法: ${agg.algos.join(', ') || '—'}`);
    lines.push('');
    lines.push('难度桶 × 表现:');
    lines.push('  bucket     n     stepD   thinkMs   lines  noBlast multiBlast cleanScr  regions concave');
    for (const b of DIFFICULTY_BUCKETS) {
        const s = agg.bucketStats[b];
        const f = (v, d = 3) => (v == null ? '—' : v.toFixed(d));
        lines.push(
            `  ${b.padEnd(9)} ${String(s.samples).padStart(4)}  ` +
            `${f(s.stepDifficulty.mean).padStart(6)}  ${f(s.thinkMs.mean, 0).padStart(7)}  ` +
            `${f(s.lines.mean).padStart(5)}  ${f(s.noBlastRate).padStart(7)}  ${f(s.multiBlastRate).padStart(9)}  ` +
            `${f(s.cleanScreenRate).padStart(7)}  ${f(s.contiguousRegions.mean, 2).padStart(7)}  ${f(s.concaveCorners.mean, 1).padStart(6)}`
        );
    }
    lines.push('');
    const sp = agg.spread || {};
    const g = (v, d = 4) => (v == null ? '—' : v.toFixed(d));
    lines.push(`algoScoreSpread (算法间平均难度跨度): ${g(sp.algoScoreSpread)}`);
    lines.push(`scd_cv / scd_range (空间约束密度 变异系数 / 跨度): ${g(sp.scdCv, 3)} / ${g(sp.scdRange, 3)}`);
    lines.push(`killer_range (杀手块数量跨度): ${g(sp.killerRange, 1)}`);
    return lines.join('\n');
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(usage()); return; }
    if (!opts.sqlite && !opts.sessions) {
        console.error('需要 --sqlite 或 --sessions 之一。\n');
        console.error(usage());
        process.exitCode = 1;
        return;
    }
    const sessions = opts.sqlite
        ? await loadFromSqlite(opts.sqlite, opts.days || 0)
        : await loadSessionsFile(opts.sessions);
    const rows = collectStepRows(sessions);
    const agg = aggregate(rows);

    if (opts.jsonOut) {
        await mkdir(dirname(resolve(process.cwd(), opts.jsonOut)), { recursive: true });
        await writeFile(resolve(process.cwd(), opts.jsonOut), JSON.stringify(agg, null, 2), 'utf8');
        console.error(`已写出 ${opts.jsonOut}`);
    }
    if (opts.pretty || !opts.jsonOut) {
        console.log(prettyPrint(agg));
    }
}

import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

/* 仅在作为入口脚本直接运行时执行 main；被测试 import 时不触发。 */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1])) {
    main().catch((err) => {
        console.error(err?.stack || err?.message || String(err));
        process.exitCode = 1;
    });
}

export { collectStepRows, aggregate, summarize };
