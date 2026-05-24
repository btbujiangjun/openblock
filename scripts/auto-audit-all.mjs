#!/usr/bin/env node
/* global process, console, fetch */
/**
 * scripts/auto-audit-all.mjs —— 玩家画像指标"全库一键体检"闭环
 *
 * 流程：
 *   1. 直读 SQLite，扫所有有 frames 的 session
 *   2. 跳过已 audit 过的（除非 --force）
 *   3. 对未 audit 的逐局跑 auditProfile → 同时（可选）POST 到 server.py 持久化
 *   4. 聚合所有 audit 报告（含历史已存档）→ 输出"可执行优化建议清单"
 *   5. （可选）写 Markdown 报告到 .cursor-stress-logs/
 *
 * 这是 PROFILE_AUDIT 工具链的"自动化闭环"——把"遍历用户行为序列 → 自我评估
 * → 汇聚结果 → 输出代码优化方向"一气呵成，运营/开发只需读最终的 Markdown 建议。
 *
 * 用法：
 *   npm run profile:auto-audit -- --sqlite .cursor-data/openblock.db --pretty
 *   npm run profile:auto-audit -- --sqlite db --days 30 --upload http://localhost:5050 --out audit.md
 *   npm run profile:auto-audit -- --sqlite db --force --skip-upload   # 重跑所有 session
 *
 * Options:
 *   --sqlite path/to/db        必须；SQLite 路径
 *   --days N                   只扫近 N 天的 session（默认 30）
 *   --user-id <id>             仅扫某个用户（默认扫全库，需 OPENBLOCK_DB_DEBUG=1 也无所谓——直连 DB 没限制）
 *   --limit N                  最多处理多少局（默认 500）
 *   --force                    重跑已 audit 过的 session（默认跳过）
 *   --upload <url>             server.py 根 URL（如 http://localhost:5050）；不传则不持久化
 *   --skip-upload              即便给了 --upload 也不上传（dry-run）
 *   --out audit.md             写 Markdown 优化建议报告到此路径
 *   --pretty                   stderr 打印进度与最终摘要
 *
 * 退出码：
 *   0  成功（含没新增 audit 的情况）
 *   1  参数 / SQLite / 网络错误
 *   2  有 priority=1 的 action（适合 CI 拉警）
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

function parseArgs(argv) {
    const opts = { days: 30, limit: 500, pretty: false, force: false, skipUpload: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const n = argv[i + 1];
        if (a === '--sqlite')        { opts.sqlite = n; i++; }
        else if (a === '--days')     { opts.days = Number(n); i++; }
        else if (a === '--user-id')  { opts.userId = n; i++; }
        else if (a === '--limit')    { opts.limit = Number(n); i++; }
        else if (a === '--upload')   { opts.upload = n; i++; }
        else if (a === '--out')      { opts.out = n; i++; }
        else if (a === '--force')    { opts.force = true; }
        else if (a === '--skip-upload') { opts.skipUpload = true; }
        else if (a === '--aggregate-only-fresh')   { opts.aggregateOnlyFresh = true; }
        else if (a === '--aggregate-only-archive') { opts.aggregateOnlyArchive = true; }
        else if (a === '--pretty')   { opts.pretty = true; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
    }
    return opts;
}

function usage() {
    return [
        '用法: npm run profile:auto-audit -- --sqlite path/to/db [options]',
        '',
        '关键参数:',
        '  --sqlite path        必须',
        '  --days N             只扫近 N 天 session（默认 30）',
        '  --user-id <id>       仅扫某用户',
        '  --upload <url>       server.py 根 URL（如 http://localhost:5050）',
        '  --out report.md      写 Markdown 优化建议到指定路径',
        '  --pretty             stderr 打印进度与摘要',
        '  --force              重跑已 audit 的 session',
    ].join('\n');
}

async function _loadSqlite() {
    try { return (await import('better-sqlite3')).default; }
    catch (e) {
        throw new Error('需要 better-sqlite3：`npm i -D better-sqlite3` 后重试。\n' + (e?.message || e));
    }
}

/** 从 SQLite 拉所有候选 session（含已 audit/未 audit 的） */
async function loadCandidates(dbPath, { days, userId, limit, force }) {
    const Database = await _loadSqlite();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    try {
        const since = days > 0 ? (Math.floor(Date.now() / 1000) - days * 86400) : 0;
        const conds = ['m.frames IS NOT NULL'];
        const params = [];
        if (userId) { conds.push('s.user_id = ?'); params.push(userId); }
        if (since > 0) { conds.push('s.start_time >= ?'); params.push(since); }
        if (!force) { conds.push('pa.session_id IS NULL'); }
        const rows = db.prepare(
            'SELECT s.id AS session_id, s.user_id AS user_id, s.score AS score, ' +
            '       m.frames AS frames, pa.session_id AS audit_sid ' +
            '  FROM sessions s ' +
            '  INNER JOIN move_sequences m ON m.session_id = s.id ' +
            '  LEFT JOIN profile_audits pa ON pa.session_id = s.id ' +
            ' WHERE ' + conds.join(' AND ') +
            ' ORDER BY s.start_time DESC ' +
            ' LIMIT ?'
        ).all(...params, limit);
        return rows.map((r) => ({
            sessionId: r.session_id,
            userId: r.user_id,
            score: r.score,
            framesJson: r.frames,
            alreadyAudited: r.audit_sid != null,
        }));
    } finally { db.close(); }
}

/** 拉已存档的 audit 报告，用于聚合（含本轮新跑的 + 历史的） */
async function loadAuditedReports(dbPath, { days, userId, limit }) {
    const Database = await _loadSqlite();
    const db = new Database(resolve(process.cwd(), dbPath), { readonly: true });
    try {
        const since = days > 0 ? (Math.floor(Date.now() / 1000) - days * 86400) : 0;
        const conds = ['pa.report IS NOT NULL'];
        const params = [];
        if (userId) { conds.push('pa.user_id = ?'); params.push(userId); }
        if (since > 0) { conds.push('pa.updated_at >= ?'); params.push(since); }
        const rows = db.prepare(
            'SELECT pa.session_id AS session_id, pa.user_id AS user_id, pa.report AS report ' +
            '  FROM profile_audits pa ' +
            ' WHERE ' + conds.join(' AND ') +
            ' ORDER BY pa.updated_at DESC LIMIT ?'
        ).all(...params, limit);
        const out = [];
        for (const r of rows) {
            try {
                const report = JSON.parse(r.report);
                if (report) out.push({ sessionId: r.session_id, userId: r.user_id, report });
            } catch { /* skip 损坏报告 */ }
        }
        return out;
    } finally { db.close(); }
}

async function uploadReport(baseUrl, sessionId, userId, report) {
    const url = baseUrl.replace(/\/$/, '') + `/api/profile-audit/${sessionId}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, report }),
    });
    if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
}

/* ========== Markdown 报告 ========== */

function renderActionsMarkdown(aggregate, actions) {
    const lines = [];
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    lines.push(`# 玩家画像指标自评估 — 优化建议汇总`);
    lines.push('');
    lines.push(`> 生成时间：${now}`);
    lines.push(`> 样本：${aggregate.sessionsCount} 局 / ${aggregate.framesTotal} 帧`);
    if (aggregate.healthScore) {
        const hs = aggregate.healthScore;
        lines.push(`> 健康分：min=${hs.min} · p10=${hs.p10.toFixed(0)} · **p50=${hs.p50.toFixed(0)}** · p90=${hs.p90.toFixed(0)} · max=${hs.max}`);
    }
    lines.push('');

    if (actions.length === 0) {
        lines.push('## 🎉 暂无需要优化的项');
        lines.push('');
        lines.push('当前所有契约通过率良好，hint 频次未触达阈值。');
        return lines.join('\n');
    }

    // 按优先级分组
    const byPrio = new Map();
    for (const a of actions) {
        if (!byPrio.has(a.priority)) byPrio.set(a.priority, []);
        byPrio.get(a.priority).push(a);
    }
    const prioLabels = { 1: '🔴 P1 高优先级（建议立即处理）', 2: '🟠 P2 中优先级', 3: '🟡 P3 中低优先级', 4: '🟢 P4 低优先级', 5: 'ℹ️ P5 提示' };

    lines.push(`## 优化清单（共 ${actions.length} 项）`);
    lines.push('');

    for (const [prio, items] of [...byPrio.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(`### ${prioLabels[prio] || `P${prio}`}`);
        lines.push('');
        for (const a of items) {
            lines.push(`#### ${a.title}`);
            lines.push('');
            lines.push(`- **证据**：${a.evidence}`);
            if (a.affected?.length) lines.push(`- **涉及**：${a.affected.map((x) => `\`${x}\``).join(' / ')}`);
            lines.push(`- **代码 code**：\`${a.code}\` · 类别 \`${a.category}\` · 工作量 \`${a.effort}\``);
            lines.push(`- **预期收益**：${a.expectedBenefit}`);
            if (a.rootCauseHints?.length) {
                lines.push(`- **可能根因**：`);
                for (const r of a.rootCauseHints) lines.push(`  - ${r}`);
            }
            if (a.suggestedActions?.length) {
                lines.push(`- **建议动作**：`);
                for (const s of a.suggestedActions) lines.push(`  - ${s}`);
            }
            lines.push('');
        }
    }

    // 附：跨局指标
    lines.push('---');
    lines.push('');
    lines.push('## 附录：跨局聚合数据');
    lines.push('');
    if (aggregate.topRegressions?.length) {
        lines.push('### 高违规率契约（≥25%，至少 3 局）');
        lines.push('');
        for (const c of aggregate.topRegressions) {
            lines.push(`- \`${c.id}\` — ${(c.violationRate * 100).toFixed(0)}% (${c.failed}/${c.appeared} 局)`);
        }
        lines.push('');
    }
    if (aggregate.stressDominatorCounts?.length) {
        lines.push('### stress 主导分量分布');
        lines.push('');
        for (const d of aggregate.stressDominatorCounts) {
            lines.push(`- \`${d.key}\` × ${d.count} 局 (${(d.share * 100).toFixed(0)}%)`);
        }
        lines.push('');
    }
    if (aggregate.hintCounts?.length) {
        lines.push('### 最频繁 hint Top 15');
        lines.push('');
        lines.push('| 严重 | code | 次数 |');
        lines.push('|---|---|---|');
        for (const h of aggregate.hintCounts.slice(0, 15)) {
            const sev = { error: '❌', warn: '⚠️', info: 'ℹ️' }[h.severity] || '·';
            lines.push(`| ${sev} | \`${h.code}\` | ×${h.count} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function renderActionsPretty(actions) {
    const lines = [];
    lines.push(`──────── 优化建议（共 ${actions.length} 项） ────────`);
    for (const a of actions) {
        const tag = { 1: '🔴 P1', 2: '🟠 P2', 3: '🟡 P3', 4: '🟢 P4', 5: 'ℹ️ P5' }[a.priority] || `P${a.priority}`;
        lines.push(`${tag} [${a.code}] ${a.title}`);
        lines.push(`        证据: ${a.evidence}`);
        lines.push(`        预期收益: ${a.expectedBenefit}`);
        if (a.suggestedActions?.length) {
            lines.push(`        建议:`);
            for (const s of a.suggestedActions.slice(0, 2)) {
                lines.push(`           ${s}`);
            }
            if (a.suggestedActions.length > 2) {
                lines.push(`           ... 还有 ${a.suggestedActions.length - 2} 条（见 Markdown 报告）`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

/* ========== 主流程 ========== */

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.sqlite) {
        console.log(usage());
        process.exit(args.help ? 0 : 1);
    }
    const log = args.pretty ? (msg) => console.error(msg) : () => {};

    /* 1) 扫候选 session */
    log(`📡 扫描 ${args.sqlite}（近 ${args.days} 天${args.userId ? `, user=${args.userId}` : ''}, force=${args.force}）...`);
    let candidates = [];
    try {
        candidates = await loadCandidates(args.sqlite, args);
    } catch (e) {
        console.error(`❌ SQLite 读取失败：${e?.message || e}`);
        process.exit(1);
    }
    log(`✓ 找到 ${candidates.length} 个候选 session（未 audit 的优先）`);
    if (candidates.length === 0 && !args.force) {
        log(`💡 所有 session 都已 audit 过；用 --force 重跑`);
    }

    /* 2) 启 vite SSR 跑 auditProfile */
    log(`🔥 启动 vite SSR 加载 auditProfile...`);
    const server = await createServer({
        configFile: false,
        root: process.cwd(),
        appType: 'custom',
        server: { middlewareMode: true },
    });

    let succeeded = 0;
    let failed = 0;
    let uploaded = 0;
    /* v1.62.8：本轮新跑的 audit 报告（用于 dry-run 时直接聚合，不依赖 DB 持久化） */
    const localReports = [];
    try {
        const mod = await server.ssrLoadModule('/web/src/audit/profileAudit.js');

        /* 3) 逐局 audit + 可选上传 */
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            try {
                const frames = JSON.parse(c.framesJson || '[]');
                if (!Array.isArray(frames) || frames.length === 0) continue;
                const report = mod.auditProfile(frames);
                succeeded++;
                localReports.push({ sessionId: c.sessionId, userId: c.userId, report });
                if (args.upload && !args.skipUpload) {
                    try {
                        await uploadReport(args.upload, c.sessionId, c.userId, report);
                        uploaded++;
                    } catch (uploadErr) {
                        log(`  ⚠️ #${c.sessionId} 上传失败：${uploadErr.message || uploadErr}`);
                    }
                }
                if (i % 5 === 0 || i === candidates.length - 1) {
                    log(`  · ${i + 1}/${candidates.length} (#${c.sessionId} health=${report.healthScore})`);
                }
            } catch (e) {
                failed++;
                log(`  ❌ #${c.sessionId} 失败：${e.message || e}`);
            }
        }
        log(`✓ Audit 完成：成功 ${succeeded}，失败 ${failed}${uploaded ? `，上传 ${uploaded}` : ''}`);

        /* 4) 聚合策略 (v1.62.8)：
         *    - 默认：合并 [本轮新跑] + [DB 历史] → session_id 去重（本轮优先）
         *    - --aggregate-only-fresh：只用本轮新跑（不读 DB）
         *    - --aggregate-only-archive：只用 DB 历史（旧行为）
         *
         * 之前 bug：永远只读 DB，--skip-upload 模式下新跑的报告白跑（聚合看不到 v1.62.8 数据）
         */
        let aggregateInputs;
        if (args.aggregateOnlyArchive) {
            log(`📊 仅聚合 DB 历史报告...`);
            try { aggregateInputs = await loadAuditedReports(args.sqlite, args); }
            catch (e) { log(`  ⚠️ 拉取已 audit 失败：${e.message || e}`); aggregateInputs = []; }
        } else if (args.aggregateOnlyFresh) {
            log(`📊 仅聚合本轮新跑报告 (${localReports.length} 局)...`);
            aggregateInputs = localReports;
        } else {
            log(`📊 合并聚合：本轮 ${localReports.length} 局 + DB 历史...`);
            let archivedReports = [];
            try {
                archivedReports = await loadAuditedReports(args.sqlite, args);
            } catch (e) {
                log(`  ⚠️ 拉取已 audit 失败：${e.message || e}（继续用本轮新跑的）`);
            }
            // session_id 去重，本轮优先（含 v1.62.8 最新规则）
            const seen = new Set(localReports.map((r) => r.sessionId));
            const merged = [...localReports];
            for (const r of archivedReports) {
                if (!seen.has(r.sessionId)) merged.push(r);
            }
            aggregateInputs = merged;
            log(`  → 合并后 ${merged.length} 局参与聚合`);
        }
        const aggregate = mod.aggregateAuditReports(aggregateInputs);

        /* 5) 翻译为可执行优化清单 */
        const actions = mod.summarizeOptimizationActions(aggregate);

        /* 6) 输出 */
        if (args.pretty) {
            log('');
            log(`📋 聚合：${aggregate.sessionsCount} 局 / ${aggregate.framesTotal} 帧`);
            if (aggregate.healthScore) {
                const hs = aggregate.healthScore;
                log(`   健康分 min=${hs.min} p10=${hs.p10.toFixed(0)} p50=${hs.p50.toFixed(0)} p90=${hs.p90.toFixed(0)} max=${hs.max}`);
            }
            log('');
            log(renderActionsPretty(actions));
        }
        if (args.out) {
            const md = renderActionsMarkdown(aggregate, actions);
            const outPath = resolve(process.cwd(), args.out);
            await mkdir(dirname(outPath), { recursive: true });
            await writeFile(outPath, md + '\n', 'utf8');
            log(`✓ Markdown 报告写入：${outPath}`);
        } else if (!args.pretty) {
            // 既没 --pretty 也没 --out → stdout 输出 JSON 便于管道
            console.log(JSON.stringify({ aggregate, actions, processedSessions: succeeded }, null, 2));
        }

        /* CI 模式：有 P1 action 退出 2 */
        if (actions.some((a) => a.priority === 1)) {
            log(`\n⚠️  存在 P1 优先级 action → 退出码 2（建议立即处理）`);
            process.exit(2);
        }
    } finally {
        await server.close();
    }
}

main().catch((e) => {
    console.error(`auto-audit-all 异常：${e?.stack || e}`);
    process.exit(1);
});
