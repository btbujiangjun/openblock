#!/usr/bin/env node
/* global process */
/**
 * v1.71 NN-C2: ops/grafana/*.dashboard.json schemaVersion lint contract。
 *
 * 规则：
 *   - 所有 *.dashboard.json 必须有 schemaVersion 字段
 *   - schemaVersion 必须是 number ≥ 16（Grafana v7+ 起步）
 *   - 同 repo 内所有 dashboard schemaVersion 必须一致（防漂移）
 *   - title / uid / panels 必填（结构契约）
 *
 * 退出码：0=ok，1=违规。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DIR = join(ROOT, 'ops/grafana');

let files;
try {
    files = readdirSync(DIR).filter(f => f.endsWith('.dashboard.json'));
} catch {
    console.error(`[lint-dashboards] ops/grafana 目录不存在，跳过`);
    process.exit(0);
}

if (files.length === 0) {
    console.log('[lint-dashboards] no dashboards found, OK');
    process.exit(0);
}

const violations = [];
const schemaVersions = new Set();

for (const f of files) {
    const path = join(DIR, f);
    let dash;
    try {
        dash = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        violations.push({ file: f, rule: 'invalid-json', msg: `JSON parse failed: ${e.message}` });
        continue;
    }
    if (typeof dash.schemaVersion !== 'number') {
        violations.push({ file: f, rule: 'missing-schemaVersion', msg: 'schemaVersion 必填且必须是 number' });
    } else {
        if (dash.schemaVersion < 16) {
            violations.push({ file: f, rule: 'schemaVersion-too-old', msg: `schemaVersion=${dash.schemaVersion} 低于 v16（Grafana v7+ 起步）` });
        }
        schemaVersions.add(dash.schemaVersion);
    }
    if (typeof dash.title !== 'string' || !dash.title) {
        violations.push({ file: f, rule: 'missing-title', msg: 'title 必填' });
    }
    if (typeof dash.uid !== 'string' || !dash.uid) {
        violations.push({ file: f, rule: 'missing-uid', msg: 'uid 必填（绑定 Grafana 持久 ID）' });
    }
    if (!Array.isArray(dash.panels)) {
        violations.push({ file: f, rule: 'missing-panels', msg: 'panels 必须是数组' });
    }
}

if (schemaVersions.size > 1) {
    violations.push({
        file: 'ALL',
        rule: 'schemaVersion-drift',
        msg: `dashboards schemaVersion 不一致: ${[...schemaVersions].join(', ')}（统一在同一 Grafana 版本同步迁移）`,
    });
}

if (violations.length === 0) {
    console.log(`[lint-dashboards] OK - ${files.length} dashboards, schemaVersion=${[...schemaVersions].join(',')}, 0 violations`);
    process.exit(0);
}

console.error(`[lint-dashboards] FAIL - ${violations.length} violation(s):`);
for (const v of violations) {
    console.error(`  ✖ ${v.file}  [${v.rule}]  ${v.msg}`);
}
process.exit(1);
