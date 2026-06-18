/**
 * HH4: weekly-dead-code workflow 接入 lint:strict 契约守护。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HH4 weekly-dead-code 接入 lint:strict', () => {
    const wf = readFileSync('.github/workflows/weekly-dead-code.yml', 'utf8');

    it('workflow 含 lint:strict 步骤', () => {
        expect(wf).toMatch(/npm run lint:strict/);
    });

    it('lint 步骤 advisory（continue-on-error）— 不阻塞 dead-code 主流程', () => {
        const idx = wf.indexOf('lint:strict');
        const slice = wf.slice(Math.max(0, idx - 400), idx + 400);
        expect(slice).toMatch(/continue-on-error:\s*true/);
    });

    it('lint 步骤导出 lint_status / lint_problem_count', () => {
        expect(wf).toMatch(/lint_status=ok/);
        expect(wf).toMatch(/lint_status=fail/);
        expect(wf).toMatch(/lint_problem_count=/);
    });

    it('report body 含 lint 健康度段', () => {
        expect(wf).toMatch(/Lint:strict 健康度（HH4 新增）/);
        expect(wf).toMatch(/lint\.outputs\.lint_status/);
    });

    it('issue 触发条件含 lint_status == fail', () => {
        const idx = wf.indexOf('Create or update tracking issue');
        const slice = wf.slice(idx, idx + 400);
        expect(slice).toMatch(/lint\.outputs\.lint_status == 'fail'/);
    });
});
