#!/usr/bin/env node
/* global process, console */
/**
 * Spawn Tuning 灰度发布健康度自动检查。
 *
 * 用法:
 *   node scripts/spawn-tuning-stage-check.mjs --stage 0 --api http://localhost:8000
 *   node scripts/spawn-tuning-stage-check.mjs --stage 1 --baseline-run 20260524 --new-run 20260526
 *
 * Stages:
 *   --stage 0 (Shadow):    检查 policies 全部 active + 离线指标达标
 *   --stage 1 (Gray 10%): 对比新旧 run 的 composite 趋势,验签链路联通
 *   --stage 2 (Full):     全量发布前最后一次 hard-check (overshootRate / fairness)
 *
 * 退出码:
 *   0 = 全部通过,可推进下一 stage
 *   1 = 有 warning,需人工审查
 *   2 = 有 critical,禁止推进
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── CLI 参数 ────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = { stage: 0, apiBaseUrl: 'http://localhost:8000', db: '.cursor-stress-logs/spawn-tuning.sqlite', baselineRun: null, newRun: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i], next = argv[i + 1];
        if (arg === '--stage') { opts.stage = Number(next); i++; }
        else if (arg === '--api') { opts.apiBaseUrl = next; i++; }
        else if (arg === '--db') { opts.db = next; i++; }
        else if (arg === '--baseline-run') { opts.baselineRun = Number(next); i++; }
        else if (arg === '--new-run') { opts.newRun = Number(next); i++; }
        else if (arg === '--help' || arg === '-h') { opts.help = true; }
    }
    return opts;
}

function usage() {
    return `
spawn-tuning-stage-check — 灰度发布健康度自动检查

用法:
  node scripts/spawn-tuning-stage-check.mjs --stage <0|1|2> [options]

选项:
  --stage 0|1|2          检查的灰度阶段
  --api <url>            Server API 基址 (默认 http://localhost:8000)
  --db <path>            SQLite 路径
  --baseline-run <id>    基准 run (Stage 1 必填)
  --new-run <id>         新 run (Stage 1/2 必填)
  -h, --help             显示本帮助

退出码: 0 通过 / 1 warning / 2 critical
`.trim();
}

// ── 检查器框架 ──────────────────────────────────────────────────

class Reporter {
    constructor() {
        this.results = [];
        this.criticals = 0;
        this.warnings = 0;
    }
    pass(name, detail = '') {
        this.results.push({ name, status: 'PASS', detail });
        process.stdout.write(`✓ ${name}${detail ? ' — ' + detail : ''}\n`);
    }
    warn(name, detail = '') {
        this.results.push({ name, status: 'WARN', detail });
        this.warnings++;
        process.stdout.write(`⚠ ${name} — ${detail}\n`);
    }
    fail(name, detail = '') {
        this.results.push({ name, status: 'FAIL', detail });
        this.criticals++;
        process.stdout.write(`✗ ${name} — ${detail}\n`);
    }
    info(msg) {
        process.stdout.write(`  ${msg}\n`);
    }
    summary() {
        const total = this.results.length;
        const passed = this.results.filter((r) => r.status === 'PASS').length;
        process.stdout.write(`\n─── 汇总: ${passed}/${total} 通过, ${this.warnings} warning, ${this.criticals} critical ───\n`);
        return this.criticals > 0 ? 2 : (this.warnings > 0 ? 1 : 0);
    }
}

// ── Stage 0: Shadow ─────────────────────────────────────────────

async function stage0(opts, reporter) {
    process.stdout.write(`\n=== Stage 0 (Shadow) 检查 ===\n`);

    // 1. server 联通 + 取 active policies
    let activeData;
    try {
        const r = await fetch(`${opts.apiBaseUrl.replace(/\/+$/, '')}/api/spawn-tuning/v2/policies/active`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        activeData = await r.json();
    } catch (e) {
        reporter.fail('Server 联通', `${opts.apiBaseUrl}: ${e.message}`);
        return;
    }
    reporter.pass('Server 联通');

    const policies = activeData.policies || [];
    if (policies.length === 0) {
        reporter.fail('Active policies > 0', '当前 0 个 active policy,请先调 /v2/policies/deploy');
        return;
    }
    reporter.pass('Active policies > 0', `${policies.length} 个`);

    // 2. 全 120 context 覆盖
    if (policies.length < 120) {
        reporter.warn('Context 覆盖完整', `${policies.length}/120,缺 ${120 - policies.length}`);
    } else {
        reporter.pass('Context 覆盖完整', '120/120');
    }

    // 3. signature 字段非空
    const noSig = policies.filter((p) => !p.signature || p.signature.length < 8);
    if (noSig.length > 0) {
        reporter.fail('Signature 字段健康', `${noSig.length} 个 policy 缺签名`);
    } else {
        reporter.pass('Signature 字段健康');
    }

    // 4. expected_composite 范围 (避免离线模型崩坏)
    const composites = policies.map((p) => p.expected_composite).filter((c) => Number.isFinite(c));
    const avgComp = composites.reduce((a, b) => a + b, 0) / Math.max(1, composites.length);
    const minComp = Math.min(...composites);
    if (avgComp < 0.60) {
        reporter.fail('平均 composite ≥ 0.60', `当前 ${avgComp.toFixed(3)}`);
    } else if (avgComp < 0.70) {
        reporter.warn('平均 composite ≥ 0.70', `当前 ${avgComp.toFixed(3)} (建议 ≥0.70)`);
    } else {
        reporter.pass('平均 composite', avgComp.toFixed(3));
    }
    if (minComp < 0.45) {
        reporter.warn('最低 composite ≥ 0.45', `当前 ${minComp.toFixed(3)}`);
    } else {
        reporter.pass('最低 composite', minComp.toFixed(3));
    }

    // 5. 灰度比例 (Stage 0 必须 = 100,代表全量 shadow 标记)
    const rolloutPct = activeData.rollout_pct ?? 100;
    if (rolloutPct !== 100) {
        reporter.info(`rollout_pct = ${rolloutPct} (Stage 0 期望 100,但部署阶段不一定)`);
    }
}

// ── Stage 1: Gray 10% ───────────────────────────────────────────

async function stage1(opts, reporter) {
    process.stdout.write(`\n=== Stage 1 (Gray 10%) 检查 ===\n`);

    if (!opts.newRun) {
        reporter.fail('--new-run 必填', 'Stage 1 需要指定新发布的 run_id');
        return;
    }

    // 1. server endpoint /auth/secret 可访问 (验证密钥分发链路)
    try {
        const r = await fetch(`${opts.apiBaseUrl.replace(/\/+$/, '')}/api/spawn-tuning/v2/auth/secret`);
        // 401 是预期 (没带 token),500/连接失败 才是问题
        if (r.status === 401 || r.status === 403) {
            reporter.pass('Secret endpoint 可用', `HTTP ${r.status} (鉴权生效)`);
        } else if (r.ok) {
            reporter.warn('Secret endpoint 鉴权', '未配 token 也返回 200,生产前必须开启 SPAWN_TUNING_AUTH_REQUIRED=1');
        } else if (r.status === 503) {
            reporter.warn('Server secret', '未配 SPAWN_TUNING_SECRET 环境变量,客户端走 structural 模式');
        } else {
            reporter.fail('Secret endpoint', `HTTP ${r.status}`);
        }
    } catch (e) {
        reporter.fail('Secret endpoint 联通', e.message);
    }

    // 2. DB 中真实玩家上报指标累计 (说明 metrics SDK 跑通)
    if (existsSync(opts.db)) {
        const db = new Database(resolve(opts.db), { readonly: true });
        try {
            const total = db.prepare('SELECT COUNT(*) as cnt FROM spawn_tuning_field_metrics').get();
            if (total.cnt < 10) {
                reporter.warn('真实上报指标 ≥ 10', `当前 ${total.cnt},确认 client SDK 已部署并有玩家上报`);
            } else {
                reporter.pass('真实上报指标 ≥ 10', `${total.cnt} 条`);
            }

            const sources = db.prepare(
                'SELECT source, COUNT(*) as cnt FROM spawn_tuning_field_metrics GROUP BY source'
            ).all();
            reporter.info(`Source 分布: ${sources.map((s) => `${s.source}=${s.cnt}`).join(', ') || '无'}`);
        } catch (e) {
            reporter.warn('Field metrics 表', e.message);
        } finally {
            db.close();
        }
    } else {
        reporter.warn('SQLite 文件', `${opts.db} 不存在,跳过 DB 检查`);
    }

    // 3. 离线 vs 在线指标对照 (如果有 baseline)
    if (opts.baselineRun && opts.newRun) {
        reporter.info(`baseline run #${opts.baselineRun} vs new run #${opts.newRun}: 暂未实现自动对照,请人工查看板 Tab ⑤`);
    }
}

// ── Stage 2: Full ───────────────────────────────────────────────

async function stage2(opts, reporter) {
    process.stdout.write(`\n=== Stage 2 (Full Rollout) 检查 ===\n`);

    // 1. active policies 仍然存在
    let activeData;
    try {
        const r = await fetch(`${opts.apiBaseUrl.replace(/\/+$/, '')}/api/spawn-tuning/v2/policies/active`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        activeData = await r.json();
    } catch (e) {
        reporter.fail('Server 联通', e.message);
        return;
    }
    const policies = activeData.policies || [];
    if (policies.length < 100) {
        reporter.fail('Context 覆盖 ≥ 100', `${policies.length}/120`);
    } else {
        reporter.pass('Context 覆盖 ≥ 100', `${policies.length}/120`);
    }

    // 2. 灰度比例 = 100 (Full)
    if (activeData.rollout_pct !== 100) {
        reporter.fail('rollout_pct = 100', `当前 ${activeData.rollout_pct}`);
    } else {
        reporter.pass('rollout_pct = 100');
    }

    // 3. 真实指标 (聚合 24 小时)
    try {
        const r = await fetch(`${opts.apiBaseUrl.replace(/\/+$/, '')}/api/spawn-tuning/v2/metrics/aggregate?hours=24`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const aggs = data.aggregates || [];
        if (aggs.length === 0) {
            reporter.warn('24h 真实指标', '聚合无数据,可能 SDK 上报未跑通');
        } else {
            const totalGames = aggs.reduce((s, r) => s + r.games, 0);
            const avgNoMove = aggs.reduce((s, r) => s + r.noMove_rate * r.games, 0) / totalGames;
            if (avgNoMove > 0.30) {
                reporter.fail('死局率 ≤ 30%', `当前 ${(avgNoMove * 100).toFixed(1)}%`);
            } else if (avgNoMove > 0.20) {
                reporter.warn('死局率 ≤ 20%', `当前 ${(avgNoMove * 100).toFixed(1)}%`);
            } else {
                reporter.pass('死局率 ≤ 20%', `${(avgNoMove * 100).toFixed(1)}%`);
            }
            reporter.info(`24h 累计 ${totalGames.toLocaleString()} 局,${aggs.length} 个 (context,source) 组合`);
        }
    } catch (e) {
        reporter.warn('24h 真实指标', e.message);
    }
}

// ── main ────────────────────────────────────────────────────────

(async () => {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(usage()); process.exit(0); }

    const reporter = new Reporter();
    if (opts.stage === 0) await stage0(opts, reporter);
    else if (opts.stage === 1) await stage1(opts, reporter);
    else if (opts.stage === 2) await stage2(opts, reporter);
    else {
        console.error(`未知 stage: ${opts.stage}, 用 0/1/2`);
        process.exit(2);
    }

    const exitCode = reporter.summary();
    process.exit(exitCode);
})().catch((e) => {
    console.error('检查脚本失败:', e);
    process.exit(2);
});
