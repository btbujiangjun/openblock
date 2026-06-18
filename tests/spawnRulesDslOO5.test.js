/**
 * OO5 / NN-F3.1: spawn DSL runtime 单元测试。
 *
 * 覆盖：
 *   - validateRules：缺字段、重 id、类型错
 *   - 排序：priority 降序 + 稳定
 *   - dryRun：state 不变，trace 标记
 *   - disabled：id / abTestKey 都生效
 *   - when 抛错 → 标记 error 但不中断
 *   - apply 抛错 → state 不变继续
 *   - POC_HOLES_RULE：行为契约（不动 + 抬升）
 */
import { describe, it, expect } from 'vitest';
import {
    validateRules, runSpawnRules, POC_HOLES_RULE, _internal,
} from '../web/src/spawn/spawnRulesDsl.js';

describe('OO5 / NN-F3.1 spawn DSL', () => {
    it('validateRules 通过空数组与正确规则集', () => {
        expect(validateRules([])).toEqual([]);
        expect(validateRules([POC_HOLES_RULE])).toEqual([]);
    });

    it('validateRules 标记缺字段 / 重 id', () => {
        const errs = validateRules([
            { id: 'a', when: () => true, apply: (s) => s },
            { id: 'a', when: () => true, apply: (s) => s }, /* dup */
            { id: 'b', when: 'not-fn', apply: (s) => s },   /* bad type */
            { id: '', when: () => true, apply: (s) => s },  /* missing id */
        ]);
        expect(errs.some(e => e.includes('duplicate'))).toBe(true);
        expect(errs.some(e => e.includes('when not fn'))).toBe(true);
        expect(errs.some(e => e.includes('missing id'))).toBe(true);
    });

    it('排序：priority 降序，相同 priority 稳定（声明顺序）', () => {
        const rules = [
            { id: 'a', priority: 10, when: () => true, apply: (s) => s },
            { id: 'b', priority: 100, when: () => true, apply: (s) => s },
            { id: 'c', priority: 100, when: () => true, apply: (s) => s },
            { id: 'd', when: () => true, apply: (s) => s }, /* default 0 */
        ];
        const sorted = _internal._sortRules(rules);
        expect(sorted.map(r => r.id)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('dryRun：state 不变，trace 记录命中', () => {
        const rules = [
            { id: 'r1', when: () => true, apply: () => ({ x: 999 }) },
        ];
        const { state, trace } = runSpawnRules(rules, { x: 1 }, {}, { dryRun: true });
        expect(state).toEqual({ x: 1 });
        expect(trace[0]).toMatchObject({ id: 'r1', matched: true, dryRun: true });
    });

    it('disabled：id 或 abTestKey 命中即跳过', () => {
        const rules = [
            { id: 'r1', abTestKey: 'A', when: () => true, apply: (s) => ({ ...s, hit1: true }) },
            { id: 'r2', when: () => true, apply: (s) => ({ ...s, hit2: true }) },
        ];
        let res = runSpawnRules(rules, {}, {}, { disabled: ['A'] });
        expect(res.state).toEqual({ hit2: true });
        res = runSpawnRules(rules, {}, {}, { disabled: ['r2'] });
        expect(res.state).toEqual({ hit1: true });
    });

    it('when 抛错 → trace 标 error 但不中断后续', () => {
        const errors = [];
        const rules = [
            { id: 'bad', when: () => { throw new Error('boom'); }, apply: (s) => s },
            { id: 'ok', when: () => true, apply: (s) => ({ ...s, ok: true }) },
        ];
        const { state, trace } = runSpawnRules(rules, {}, {}, {
            onError: (e, r) => errors.push([r.id, e.message]),
        });
        expect(state).toEqual({ ok: true });
        expect(trace[0].error).toContain('boom');
        expect(errors).toEqual([['bad', 'boom']]);
    });

    it('apply 抛错 → state 不变，trace 标 error，继续后续', () => {
        const rules = [
            { id: 'crash', when: () => true, apply: () => { throw new Error('xx'); } },
            { id: 'next', when: () => true, apply: (s) => ({ ...s, n: 1 }) },
        ];
        const { state, trace } = runSpawnRules(rules, { keep: true }, {});
        expect(state).toEqual({ keep: true, n: 1 });
        expect(trace[0]).toMatchObject({ matched: true, error: expect.stringContaining('xx') });
    });

    /* PP4: POC_HOLES_RULE 现已对齐 adaptiveSpawn 真实实现（基于 holes 计数 +
     * holeClearGuaranteeAt 阈值）。完整 parity 测试见 spawnDslParityPP4.test.js。 */
    it('POC_HOLES_RULE：低 holes 不命中', () => {
        const { state, trace } = runSpawnRules(
            [POC_HOLES_RULE],
            { clearGuarantee: 0, sizePreference: 0 },
            { holes: 1, topoCfg: { holeClearGuaranteeAt: 2 } },
        );
        expect(state.clearGuarantee).toBe(0);
        expect(trace[0].matched).toBe(false);
    });

    it('POC_HOLES_RULE：命中时同时抬 clearGuarantee + 调 sizePreference', () => {
        const { state } = runSpawnRules(
            [POC_HOLES_RULE],
            { clearGuarantee: 1, sizePreference: 0 },
            { holes: 3, topoCfg: { holeClearGuaranteeAt: 2, holeClearGuarantee: 2, holeSizePreference: -0.22 } },
        );
        expect(state.clearGuarantee).toBe(2);
        expect(state.sizePreference).toBeCloseTo(-0.22);
    });

    it('POC_HOLES_RULE：已 ≥ 阈值则保持原值（不下调）', () => {
        const { state } = runSpawnRules(
            [POC_HOLES_RULE],
            { clearGuarantee: 5, sizePreference: -0.5 },
            { holes: 3, topoCfg: { holeClearGuarantee: 2 } },
        );
        expect(state.clearGuarantee).toBe(5);
        expect(state.sizePreference).toBeCloseTo(-0.5); /* min(-0.5, -0.22) */
    });
});
