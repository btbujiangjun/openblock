#!/usr/bin/env node
/* global process, console */
/**
 * scripts/audit-profile.mjs — 玩家画像指标自评估 CLI
 *
 * 输入来源（4 选 1）：
 *   1) --frames path/to/frames.json
 *      一个 JSON 文件，内容是 `move_sequences.frames`（即 frame 数组）；也接受 { frames: [...] }
 *   2) --sessions path/to/sessions.json
 *      一个 JSON 文件，内容是 [{frames:[...]}, {frames:[...]}, ...]（多局聚合 audit）
 *   3) --sqlite path/to/openblock.db --session-id 123
 *      直连 SQLite，从 move_sequences 表按 session_id 拉 frames（需要 better-sqlite3）
 *   4) --sqlite path/to/db --db-recent 7   （v1.62+）
 *      从 SQLite 拉近 N 天所有有 frames 的 session，逐局 audit + aggregateAuditReports
 *      聚合输出（不传 --session-id）
 *
 * 对照分析（v1.62+）：
 *   --baseline path/to/baseline.json
 *      读一份 baseline frames（{ frames } 或 frame 数组），与当前输入做 current vs baseline
 *      对照分析；触发 REGRESSION_CONTRACT / IMPROVEMENT_CONTRACT / COVERAGE_REGRESSION /
 *      HEALTH_SCORE_REGRESSION 等额外 hints。适合灰度 release 卡口。
 *      （当前只支持 --frames / --sessions 与 baseline 配对，--db-recent 聚合模式忽略）
 *
 * 输出：
 *   - 默认：JSON 报告到 stdout
 *   - --out path/to/report.json：写入指定文件
 *   - --pretty：额外打印人类可读的"健康分 + Top 建议"摘要到 stderr
 *
 * 退出码：
 *   0  报告生成成功（无论是否有 error hint）
 *   1  参数错误 / 文件读不到
 *   2  报告中有 error 级别 hint（适合 CI 拉警）
 *
 * 示例：
 *   npm run profile:audit -- --frames .cursor-stress-logs/session-456.json --pretty
 *   npm run profile:audit -- --sessions runs/all.json --out .cursor-stress-logs/audit.json
 *   npm run profile:audit -- --sqlite openblock.db --session-id 42
 *   npm run profile:audit -- --sqlite openblock.db --db-recent 7 --pretty
 *   npm run profile:audit -- --frames new.json --baseline old.json --pretty --ci
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';

function parseArgs(argv) {
    const opts = { ci: false, pretty: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const n = argv[i + 1];
        if (a === '--frames')          { opts.frames = n; i++; }
        else if (a === '--sessions')   { opts.sessions = n; i++; }
        else if (a === '--sqlite')     { opts.sqlite = n; i++; }
        else if (a === '--session-id') { opts.sessionId = Number(n); i++; }
        else if (a === '--db-recent')  { opts.dbRecentDays = Number(n); i++; }
        else if (a === '--baseline')   { opts.baselinePath = n; i++; }
        else if (a === '--out')        { opts.out = n; i++; }
        else if (a === '--pretty')     { opts.pretty = true; }
        else if (a === '--ci')         { opts.ci = true; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
    }
    return opts;
}

function usage() {
    return [
        '用法: npm run profile:audit -- [options]',
        '',
        '输入（4 选 1）:',
        '  --frames path/to/frames.json              单局 frames 数组 / { frames: [...] }',
        '  --sessions path/to/sessions.json          多局 [{frames:[...]}, ...]',
        '  --sqlite path/to/db --session-id 42       从 SQLite 拉指定 session',
        '  --sqlite path/to/db --db-recent 7         从 SQLite 拉近 N 天所有 session 做聚合',
        '',
        '对照分析（可选）:',
        '  --baseline path/to/baseline.json          与当前输入做 current vs baseline 对照',
        '                                            触发 REGRESSION_/IMPROVEMENT_ hints',
        '',
        '输出:',
        '  --out path/to/report.json                 写入 JSON 报告；省略则 stdout',
        '  --pretty                                  额外打印健康分/Top hints 摘要到 stderr',
        '  --ci                                      存在 error hint 时退出码 2（便于 CI 拉警）',
        '',
    ].join('\n');
}

async function loadFromFile(path, mode) {
    const text = await readFile(resolve(process.cwd(), path), 'utf8');
    const data = JSON.parse(text);
    if (mode === 'frames') {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.frames)) return data.frames;
        throw new Error(`${path}: 既不是 frame 数组也不是 { frames: [...] }`);
    }
    if (mode === 'sessions') {
        if (Array.isArray(data) && data.every((s) => s && Array.isArray(s.frames))) return data;
        throw new Error(`${path}: 不是 [{frames:[...]}, ...] 结构`);
    }
    throw new Error('unknown mode');
}

async function _loadSqliteDriver() {
    try {
        const mod = await import('better-sqlite3');
        return mod.default;
    } catch (e) {
        throw new Error(
            '从 SQLite 拉数据需要 better-sqlite3：`npm i -D better-sqlite3` 后重试。' +
            `\n原始错误：${e?.message || e}`
        );
    }
}

async function loadFromSqlite(dbPath, sessionId) {
    const Database = await _loadSqliteDriver();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    const row = db.prepare('SELECT frames FROM move_sequences WHERE session_id = ?').get(sessionId);
    db.close();
    if (!row) throw new Error(`session_id=${sessionId} 在 move_sequences 中不存在`);
    const parsed = JSON.parse(row.frames);
    if (!Array.isArray(parsed)) throw new Error('move_sequences.frames 解析后不是数组');
    return parsed;
}

/**
 * 从 SQLite 拉近 N 天所有有 frames 的 session，返回 [{ sessionId, frames }]。
 *
 * 选用 sessions.end_time（毫秒/秒兼容）做"近 N 天"判定；不存在或为 0 的 session 视为活跃中
 * 一并纳入（avoid 把进行中的对局排除）。
 */
async function loadRecentFromSqlite(dbPath, days) {
    const Database = await _loadSqliteDriver();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    try {
        const nowMs = Date.now();
        const sinceMs = nowMs - days * 86400_000;
        /* sessions.end_time 既可能是 ms 也可能是秒（不同 schema 版本），用启发式判定：
         *   > 1e12 视为 ms；否则视为秒。 */
        const rows = db.prepare(
            'SELECT ms.session_id AS session_id, ms.frames AS frames, s.end_time AS end_time' +
            '  FROM move_sequences ms LEFT JOIN sessions s ON s.id = ms.session_id' +
            '  ORDER BY ms.session_id DESC'
        ).all();
        const out = [];
        for (const r of rows) {
            let endMs = null;
            const t = Number(r.end_time);
            if (Number.isFinite(t) && t > 0) {
                endMs = t > 1e12 ? t : t * 1000;
            }
            if (endMs != null && endMs < sinceMs) continue; // 太老，跳过
            try {
                const frames = JSON.parse(r.frames);
                if (!Array.isArray(frames) || frames.length === 0) continue;
                out.push({ sessionId: r.session_id, frames });
            } catch {
                /* JSON 损坏的 session 静默跳过，避免拖垮整个聚合 */
            }
        }
        return out;
    } finally {
        db.close();
    }
}

function prettyPrint(report) {
    const lines = [];
    lines.push(`────────────────────────────────────────────────────────────────`);
    lines.push(`📊 玩家画像指标自评估报告  (schema v${report.schema})`);
    lines.push(`────────────────────────────────────────────────────────────────`);
    if (report.baselineHealthScore != null) {
        const delta = report.healthScore - report.baselineHealthScore;
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
        lines.push(`健康分: ${report.healthScore} / 100  (baseline ${report.baselineHealthScore}  ${arrow}${delta >= 0 ? '+' : ''}${delta})`);
    } else {
        lines.push(`健康分: ${report.healthScore} / 100`);
    }
    lines.push(
        `局数: ${report.summary.sessionsCount}   帧总数: ${report.summary.totalFrames}` +
        `   契约 ${report.summary.passedContracts}✓ / ${report.summary.failedContracts}✗` +
        (report.summary.coldFramesRatio != null
            ? `   冷启动占比 ${(report.summary.coldFramesRatio * 100).toFixed(0)}%`
            : '')
    );
    const link = report.linkages || {};
    if (link.stressDominator?.key) {
        lines.push(
            `stress 主导分量: ${link.stressDominator.key}  ` +
            `(${(link.stressDominator.shareOfAbs * 100).toFixed(0)}%)`
        );
    }
    if (link.intentSwitches != null) {
        lines.push(`spawnIntent 切换次数: ${link.intentSwitches}`);
    }
    /* 对照分析摘要 */
    if (report.comparison) {
        const regressed = report.comparison.contracts.filter((c) => c.regressed);
        const improved = report.comparison.contracts.filter((c) => c.improved);
        lines.push(`📈 对照分析: ${regressed.length} 项契约回归 / ${improved.length} 项改善`);
    }
    lines.push(``);
    if (report.hints?.length) {
        lines.push(`──────── Top 优化建议 ────────`);
        for (const h of report.hints.slice(0, 12)) {
            const tag =
                h.severity === 'error' ? '❌' :
                h.severity === 'warn'  ? '⚠️ ' : 'ℹ️ ';
            const subj = h.contract ?? (h.metrics || []).join(',') ?? '';
            lines.push(`${tag}[${h.code}] ${subj}`);
            lines.push(`     ${h.msg}`);
        }
        if (report.hints.length > 12) {
            lines.push(`     ... 还有 ${report.hints.length - 12} 条 hint 未列出（见完整 JSON）`);
        }
    } else {
        lines.push(`🎉 无 hint 触发——本局指标体系运作健康`);
    }
    lines.push(`────────────────────────────────────────────────────────────────`);
    return lines.join('\n');
}

function prettyPrintAggregate(agg) {
    const lines = [];
    lines.push(`────────────────────────────────────────────────────────────────`);
    lines.push(`📊 玩家画像指标聚合报告  (schema v${agg.schema})`);
    lines.push(`────────────────────────────────────────────────────────────────`);
    lines.push(`局数: ${agg.sessionsCount}   帧总数: ${agg.framesTotal}`);
    if (agg.healthScore) {
        const hs = agg.healthScore;
        lines.push(
            `健康分: min=${hs.min}  p10=${hs.p10.toFixed(0)}  ` +
            `p50=${hs.p50.toFixed(0)}  p90=${hs.p90.toFixed(0)}  ` +
            `max=${hs.max}  mean=${hs.mean.toFixed(1)}`
        );
    }
    if (agg.topRegressions.length > 0) {
        lines.push(``);
        lines.push(`──────── 高违规率契约（≥25% 局） ────────`);
        for (const c of agg.topRegressions) {
            lines.push(`  ❌ ${c.id}  违规率 ${(c.violationRate * 100).toFixed(0)}%  (${c.failed}/${c.appeared} 局)`);
            lines.push(`     ${c.desc}`);
        }
    } else {
        lines.push(``);
        lines.push(`✅ 无高违规率契约（所有契约违规率 < 25%）`);
    }
    if (agg.hintCounts.length > 0) {
        lines.push(``);
        lines.push(`──────── 最频繁 hint Top 10 ────────`);
        for (const h of agg.hintCounts.slice(0, 10)) {
            const tag =
                h.severity === 'error' ? '❌' :
                h.severity === 'warn'  ? '⚠️ ' : 'ℹ️ ';
            lines.push(`  ${tag} ${h.code.padEnd(28)}  ×${h.count}`);
        }
    }
    if (agg.stressDominatorCounts.length > 0) {
        lines.push(``);
        lines.push(`──────── stress 主导分量分布 ────────`);
        for (const d of agg.stressDominatorCounts) {
            lines.push(`  ${d.key.padEnd(24)}  ${d.count} 局  (${(d.share * 100).toFixed(0)}%)`);
        }
    }
    /* v1.62.2：自动追加 action 清单（如果聚合时一起算了） */
    if (Array.isArray(agg.actions) && agg.actions.length > 0) {
        lines.push(``);
        lines.push(`──────── 🛠 优化建议 Top ${Math.min(8, agg.actions.length)} ────────`);
        for (const a of agg.actions.slice(0, 8)) {
            const tag = { 1: '🔴 P1', 2: '🟠 P2', 3: '🟡 P3', 4: '🟢 P4', 5: 'ℹ️ P5' }[a.priority] || `P${a.priority}`;
            lines.push(`  ${tag} [${a.code}] ${a.title}`);
            lines.push(`         ${a.evidence}`);
        }
        if (agg.actions.length > 8) {
            lines.push(`         ... 共 ${agg.actions.length} 项，详情见完整 JSON`);
        }
        lines.push(`  💡 完整建议（含具体改哪个文件）：npm run profile:auto-audit -- --sqlite db --out audit.md`);
    }
    lines.push(`────────────────────────────────────────────────────────────────`);
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        process.exit(0);
    }

    /* 决定运行模式：
     *   - aggregate：--sqlite + --db-recent N（聚合所有近 N 天的 session）
     *   - single：--frames / --sessions / --sqlite + --session-id
     */
    const isAggregate = Boolean(args.sqlite && Number.isFinite(args.dbRecentDays));

    /* 1. 装载输入 */
    let singleInput = null;
    let baselineFrames = null;
    let sqliteSessions = null;
    try {
        if (isAggregate) {
            sqliteSessions = await loadRecentFromSqlite(args.sqlite, args.dbRecentDays);
            if (sqliteSessions.length === 0) {
                console.error(`警告：近 ${args.dbRecentDays} 天 SQLite 中没有可用的 move_sequences，退出`);
                process.exit(1);
            }
        } else if (args.frames) {
            singleInput = await loadFromFile(args.frames, 'frames');
        } else if (args.sessions) {
            singleInput = await loadFromFile(args.sessions, 'sessions');
        } else if (args.sqlite) {
            if (!Number.isFinite(args.sessionId)) {
                console.error('错误：--sqlite 需配合 --session-id 或 --db-recent N');
                process.exit(1);
            }
            singleInput = await loadFromSqlite(args.sqlite, args.sessionId);
        } else {
            console.error('错误：必须传入 --frames / --sessions / --sqlite 之一');
            console.error(usage());
            process.exit(1);
        }

        if (args.baselinePath) {
            baselineFrames = await loadFromFile(args.baselinePath, 'frames');
        }
    } catch (e) {
        console.error(`输入装载失败：${e?.message || e}`);
        process.exit(1);
    }

    /* 2. 通过 vite SSR 加载 profileAudit（同 evaluate-spawn 模式，处理 shapes.json 等 import） */
    const server = await createServer({
        configFile: false,
        root: process.cwd(),
        appType: 'custom',
        server: { middlewareMode: true },
    });

    let report;
    let aggregate = null;
    let actions = [];
    try {
        const mod = await server.ssrLoadModule('/web/src/audit/profileAudit.js');
        if (isAggregate) {
            const reports = sqliteSessions.map((s) => ({
                sessionId: s.sessionId,
                report: mod.auditProfile(s.frames),
            }));
            aggregate = mod.aggregateAuditReports(reports);
            // 同时保留逐局 report 摘要（不含详细 metrics/pairs，避免 JSON 过大）
            aggregate.sessions = reports.map((r) => ({
                sessionId: r.sessionId,
                healthScore: r.report.healthScore,
                passedContracts: r.report.summary?.passedContracts,
                failedContracts: r.report.summary?.failedContracts,
                hintsCount: r.report.hints?.length ?? 0,
            }));
            // v1.62.2：聚合模式自动生成可执行 action 清单
            actions = mod.summarizeOptimizationActions(aggregate);
            aggregate.actions = actions;
        } else {
            const auditOpts = baselineFrames ? { baseline: baselineFrames } : {};
            report = mod.auditProfile(singleInput, auditOpts);
        }
    } finally {
        await server.close();
    }

    /* 3. 输出 JSON */
    const payload = aggregate ?? report;
    const json = JSON.stringify(payload, null, 2);
    if (args.out) {
        const target = resolve(process.cwd(), args.out);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, json + '\n', 'utf8');
        console.error(`profile audit report written: ${target}`);
    } else if (!args.pretty) {
        console.log(json);
    }

    /* 4. 可选 pretty 摘要 */
    if (args.pretty) {
        console.error(aggregate ? prettyPrintAggregate(aggregate) : prettyPrint(report));
        // pretty 模式下 stdout 留给 JSON（如果没 --out 就把 JSON 也打出去，方便管道）
        if (!args.out) console.log(json);
    }

    /* 5. CI 模式：单局 audit 有 error hint 时退出码 2；聚合模式按是否有 topRegressions 判断 */
    if (args.ci) {
        const hasError = aggregate
            ? aggregate.topRegressions.length > 0
            : report?.hints?.some((h) => h.severity === 'error');
        if (hasError) process.exit(2);
    }
}

main().catch((e) => {
    console.error(`audit-profile 异常：${e?.stack || e}`);
    process.exit(1);
});
