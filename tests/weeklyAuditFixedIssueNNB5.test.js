/**
 * NN-B5: weekly-artifact-audit 改固定 Issue tracker（避免年度累积）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WF = join(__dirname, '..', '.github/workflows/weekly-artifact-audit.yml');

describe('NN-B5 fixed-issue tracker pattern', () => {
    it('workflow 存在', () => {
        expect(existsSync(WF)).toBe(true);
    });

    const txt = readFileSync(WF, 'utf8');

    it('用 search API 找 tracker label（不靠 listForRepo open 状态）', () => {
        expect(txt).toMatch(/search\.issuesAndPullRequests/);
        expect(txt).toMatch(/audit:artifact:tracker/);
    });

    it('存在即更新（含重开 state: open）', () => {
        expect(txt).toMatch(/issues\.update[\s\S]{0,300}state:\s*'open'/);
    });

    it('FAIL 时额外 ping comment', () => {
        expect(txt).toMatch(/createComment[\s\S]{0,200}Audit FAIL/);
    });

    it('NN-B2 合规：AUDIT_STATUS 走 env 中转（防注入）', () => {
        expect(txt).toMatch(/env:[\s\S]{0,100}AUDIT_STATUS:/);
        expect(txt).toMatch(/process\.env\.AUDIT_STATUS/);
    });

    it('不再用 monthly cron 创新 Issue 模式（旧实现已废）', () => {
        expect(txt).not.toMatch(/event\.schedule\s*==\s*'0 4 1/);
    });

    it('if: always() 确保失败也走 tracker 更新', () => {
        expect(txt).toMatch(/Create or reuse fixed audit issue[\s\S]{0,80}if:\s*always\(\)/);
    });
});
