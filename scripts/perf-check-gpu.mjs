#!/usr/bin/env node
/* global process, console */
/**
 * perf-check-gpu.mjs — GPU/渲染基线对比（手动采集，本地校对）
 *
 * 为什么是"手动"？
 * --------------
 * GPU 端指标（FPS / longtask / 合成层数）必须在真实浏览器跑，
 * Node 模拟没有意义。我们的取舍：
 *
 *   - CPU 端 → `npm run perf:check`：可自动化（Node bench + 阈值），进 CI/release:check
 *   - GPU 端 → `npm run perf:check:gpu`：玩家/开发者跑完 startProfile 后，
 *     把 JSON 粘进 tests/perf-baseline-gpu.json 的对应 scenario.lastCapture，
 *     本脚本读出来跟 expectations 对照，超出范围打 warn/fail
 *
 * 完整采集流程见 docs/engineering/PERFORMANCE_BASELINE.md。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASELINE = process.argv[2] || 'tests/perf-baseline-gpu.json';

let baseline;
try {
    baseline = JSON.parse(await readFile(resolve(process.cwd(), BASELINE), 'utf8'));
} catch (e) {
    console.error(`[perf-check-gpu] failed to load ${BASELINE}: ${e.message}`);
    process.exit(2);
}

const scenarios = baseline.scenarios || {};
const names = Object.keys(scenarios);
if (names.length === 0) {
    console.error('[perf-check-gpu] no scenarios found in baseline');
    process.exit(2);
}

/* 简单解析器：把 ">= 55"、"<= 80" 等表达式分解成 op + value */
function parseExpectation(expr) {
    const m = String(expr).trim().match(/^([<>]=?|=)\s*(-?\d+(\.\d+)?)/);
    if (!m) return null;
    return { op: m[1], value: parseFloat(m[2]) };
}

function evalExpectation(actual, expr) {
    const parsed = parseExpectation(expr);
    if (!parsed) return { ok: true, note: 'unparseable: skipped' };
    const { op, value } = parsed;
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
        return { ok: false, note: `actual is ${actual}` };
    }
    let ok;
    switch (op) {
        case '>=': ok = actual >= value; break;
        case '>': ok = actual > value; break;
        case '<=': ok = actual <= value; break;
        case '<': ok = actual < value; break;
        case '=': ok = actual === value; break;
        default: ok = true;
    }
    return { ok, expected: `${op}${value}`, actual };
}

function getPath(obj, dottedPath) {
    return dottedPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

let totalFail = 0;
let totalScenarios = 0;
let missingCaptures = 0;

console.log(`[perf-check-gpu] baseline: ${BASELINE}`);
console.log(`             scenarios=${names.length}\n`);

for (const name of names) {
    const sc = scenarios[name];
    console.log(`▸ scenario: ${name}`);
    console.log(`  ${sc.description || '(no description)'}`);
    if (!sc.lastCapture) {
        console.log(`  [skip] lastCapture is null — 在浏览器跑 startProfile(10) 后粘 JSON 到这里`);
        if (sc.lastCaptureNotes) console.log(`  hint: ${sc.lastCaptureNotes}`);
        missingCaptures++;
        console.log('');
        continue;
    }
    totalScenarios++;
    const exps = sc.expectations || {};
    const keys = Object.keys(exps);
    if (keys.length === 0) {
        console.log(`  (no expectations defined)`);
    }
    let scenarioFail = 0;
    for (const k of keys) {
        const actual = getPath(sc.lastCapture, k);
        const verdict = evalExpectation(actual, exps[k]);
        const tag = verdict.ok ? 'OK  ' : 'FAIL';
        console.log(`  ${tag}  ${k.padEnd(36)} expect ${verdict.expected || exps[k]}  actual=${actual}`);
        if (!verdict.ok) scenarioFail++;
    }
    if (scenarioFail > 0) totalFail += scenarioFail;
    console.log(`  capturedAt: ${sc.lastCapture.capturedAt || '?'}  dpr=${sc.lastCapture.dpr || '?'}`);
    console.log('');
}

console.log(`scenarios with capture=${totalScenarios}  missing=${missingCaptures}  failed expectations=${totalFail}`);
if (totalFail > 0) {
    console.log(`[perf-check-gpu] FAILED: ${totalFail} GPU expectation(s) regressed`);
    console.log(`             → 如果是有意优化导致基线轮换，更新 tests/perf-baseline-gpu.json 中对应 scenario.expectations`);
    process.exit(1);
}
console.log(`[perf-check-gpu] ${missingCaptures ? 'INCOMPLETE (some captures missing)' : 'OK'}`);
/* 缺采集不算失败，便于 CI 仅在采集完整时报 OK；本地开发者可见提示去补 */
process.exit(0);
