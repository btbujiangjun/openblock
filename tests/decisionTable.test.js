/**
 * decisionTable — 通用幂等决策表执行器（v1.71 V5）
 */
import { describe, it, expect } from 'vitest';
import { applyDecisionTable } from '../web/src/lib/decisionTable.js';

describe('applyDecisionTable', () => {
    it('空 rules / 空 state 安全返回', () => {
        expect(applyDecisionTable([], { a: 1 })).toEqual({ a: 1 });
        expect(applyDecisionTable(null, { a: 1 })).toEqual({ a: 1 });
        expect(applyDecisionTable([{ when: () => true, apply: [{ field: 'a', op: 'max', value: 5 }] }], null)).toBeNull();
    });

    it('单 max 规则触发', () => {
        const s = { x: 1 };
        applyDecisionTable([{ when: () => true, apply: [{ field: 'x', op: 'max', value: 3 }] }], s);
        expect(s.x).toBe(3);
    });

    it('单 max 规则不触发时 state 不变', () => {
        const s = { x: 5 };
        applyDecisionTable([{ when: () => false, apply: [{ field: 'x', op: 'max', value: 99 }] }], s);
        expect(s.x).toBe(5);
    });

    it('min 规则取较小值', () => {
        const s = { y: 0 };
        applyDecisionTable([{ when: () => true, apply: [{ field: 'y', op: 'min', value: -0.5 }] }], s);
        expect(s.y).toBe(-0.5);
    });

    it('多规则幂等叠加（顺序无关）', () => {
        const s = { v: 0 };
        const rules = [
            { when: () => true, apply: [{ field: 'v', op: 'max', value: 2 }] },
            { when: () => true, apply: [{ field: 'v', op: 'max', value: 5 }] },
            { when: () => true, apply: [{ field: 'v', op: 'max', value: 3 }] },
        ];
        applyDecisionTable(rules, s);
        expect(s.v).toBe(5);
    });

    it('set 无条件赋值（小心：与 V1 类幂等规则不同语义）', () => {
        const s = { phase: 'a' };
        applyDecisionTable([{ when: () => true, apply: [{ field: 'phase', op: 'set', value: 'b' }] }], s);
        expect(s.phase).toBe('b');
    });

    it('set 条件赋值（步骤级 when）', () => {
        const s = { phase: 'setup' };
        applyDecisionTable([{
            when: () => true,
            apply: [{ field: 'phase', op: 'set', value: 'neutral', when: (st) => st.phase === 'setup' }],
        }], s);
        expect(s.phase).toBe('neutral');

        const s2 = { phase: 'payoff' };
        applyDecisionTable([{
            when: () => true,
            apply: [{ field: 'phase', op: 'set', value: 'neutral', when: (st) => st.phase === 'setup' }],
        }], s2);
        expect(s2.phase).toBe('payoff'); /* 步骤 when 未通过，不赋值 */
    });

    it('value 为函数 → 动态求值', () => {
        const s = { x: 10 };
        applyDecisionTable([{
            when: () => true,
            apply: [{ field: 'x', op: 'max', value: (st) => st.x * 2 }],
        }], s);
        expect(s.x).toBe(20);
    });

    it('未知 op 静默跳过', () => {
        const s = { x: 1 };
        applyDecisionTable([{
            when: () => true,
            apply: [{ field: 'x', op: 'multiply', value: 100 }],
        }], s);
        expect(s.x).toBe(1);
    });

    it('rule.when 抛错被吞，rule 跳过', () => {
        const s = { x: 0 };
        applyDecisionTable([
            { when: () => { throw new Error('boom'); }, apply: [{ field: 'x', op: 'max', value: 99 }] },
            { when: () => true, apply: [{ field: 'x', op: 'max', value: 5 }] },
        ], s);
        expect(s.x).toBe(5);
    });

    it('step.when 抛错被吞，step 跳过', () => {
        const s = { x: 1 };
        applyDecisionTable([{
            when: () => true,
            apply: [
                { field: 'x', op: 'max', value: 9, when: () => { throw new Error('boom'); } },
                { field: 'x', op: 'max', value: 3 },
            ],
        }], s);
        expect(s.x).toBe(3);
    });

    it('类型不匹配（max 但 value 非 number）→ 跳过', () => {
        const s = { x: 1 };
        applyDecisionTable([{
            when: () => true,
            apply: [{ field: 'x', op: 'max', value: 'oops' }],
        }], s);
        expect(s.x).toBe(1);
    });

    it('返回的是同一 state 引用（支持链式 / 原地修改）', () => {
        const s = { x: 1 };
        expect(applyDecisionTable([], s)).toBe(s);
    });
});
