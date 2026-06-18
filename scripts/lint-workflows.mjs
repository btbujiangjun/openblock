#!/usr/bin/env node
/* global process, console */
/**
 * lint-workflows.mjs — GitHub Actions workflow 静态检查（v1.71 JJ5）
 *
 * 目的：把 II4 "upload-artifact 必须显式 retention-days" 文档规则
 * 升级为可执行 lint，CI 阶段硬阻断违规。同时保留扩展位以备未来加
 * 更多规则（如 actions/checkout@v4 版本固定、secret 引用规范等）。
 *
 * 用法：
 *   node scripts/lint-workflows.mjs              # 检查 .github/workflows/*
 *   node scripts/lint-workflows.mjs --strict     # 退化项也 fail（默认仅 violation fail）
 *
 * 退出码：
 *   0 = 无 violation
 *   1 = 有 violation（hard fail）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WF_DIR = '.github/workflows';
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');

if (!existsSync(WF_DIR)) {
    console.error(`[lint-workflows] ${WF_DIR} 不存在，跳过检查`);
    process.exit(0);
}

const files = readdirSync(WF_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

const violations = [];
const warnings = [];

for (const f of files) {
    const path = join(WF_DIR, f);
    const txt = readFileSync(path, 'utf8');
    /* 找所有 upload-artifact 使用块。简单 split：从 `uses: actions/upload-artifact`
     * 到下个步骤起始（- name:）或 job 末。 */
    const blocks = txt.split(/(?=uses:\s*actions\/upload-artifact)/);
    for (let i = 1; i < blocks.length; i++) {
        /* 取该 block 到下个 `      - ` 步骤之间 */
        const block = blocks[i].split(/\n(?=\s{6}- |jobs?:|on:|name:\s)/)[0];
        if (!/retention-days:\s*\d+/.test(block)) {
            const lineNum = txt.substring(0, txt.indexOf(blocks[i].slice(0, 80))).split('\n').length;
            violations.push({
                file: f,
                line: lineNum,
                rule: 'upload-artifact-needs-retention',
                msg: 'actions/upload-artifact 步骤缺少 retention-days（II4 规范要求显式声明）',
            });
        }
    }
    /* 警告（不 fail）：actions/checkout 应固定 major 版本 */
    if (/uses:\s*actions\/checkout\s*$/m.test(txt)) {
        warnings.push({ file: f, rule: 'pin-action-version', msg: 'actions/checkout 未固定版本' });
    }

    /* KK5: secret 引用规范检查
     * 规则：
     *   - secrets.X 必须全大写 + 下划线（GITHUB_TOKEN, SLACK_WEBHOOK，不能 githubToken）
     *   - 禁用裸 echo "${{ secrets.X }}"（会写到日志泄露）
     *   - 未引用 ${{ secrets.GITHUB_TOKEN }} 时不允许声明 `permissions: write-all`（最小权限）
     */
    const secretRefs = txt.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g);
    for (const m of secretRefs) {
        const name = m[1];
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            const lineNum = txt.substring(0, m.index).split('\n').length;
            violations.push({
                file: f,
                line: lineNum,
                rule: 'secret-name-convention',
                msg: `secrets.${name} 不符合 UPPER_SNAKE_CASE 命名规范`,
            });
        }
    }
    /* 禁用 echo "${{ secrets.X }}"（GitHub 自动屏蔽，但 base64/拼接绕过会泄露） */
    const echoSecretMatches = txt.matchAll(/echo[^\n]*\$\{\{\s*secrets\.\w+\s*\}\}/g);
    for (const m of echoSecretMatches) {
        const lineNum = txt.substring(0, m.index).split('\n').length;
        violations.push({
            file: f,
            line: lineNum,
            rule: 'no-echo-secrets',
            msg: 'echo 输出 secret 风险——日志静默泄露面攻击',
        });
    }
    /* permissions: write-all 全权限警告 */
    if (/permissions:\s*write-all/.test(txt)) {
        warnings.push({ file: f, rule: 'avoid-write-all', msg: 'permissions: write-all 过宽，建议改 token-level 最小权限' });
    }
}

if (violations.length === 0) {
    console.log(`[lint-workflows] OK - ${files.length} files scanned, 0 violations${warnings.length ? `, ${warnings.length} warnings` : ''}`);
    if (STRICT && warnings.length > 0) {
        for (const w of warnings) console.warn(`  ⚠️  ${w.file}: ${w.msg}`);
        process.exit(1);
    }
    process.exit(0);
}

console.error(`[lint-workflows] FAIL - ${violations.length} violation(s):`);
for (const v of violations) {
    console.error(`  ✖ ${v.file}:${v.line}  [${v.rule}]  ${v.msg}`);
}
console.error('');
console.error('规则参考：');
console.error('  - upload-artifact-needs-retention: 详见 docs/engineering/CI_ARTIFACT_RETENTION.md');
console.error('  - secret-name-convention: secrets.X 必须 UPPER_SNAKE_CASE');
console.error('  - no-echo-secrets: 不要 echo 输出 secret（日志泄露面）');
process.exit(1);
