/**
 * decisionTable — 通用幂等决策表执行器（v1.71 V5）
 */
import { describe, it, expect } from 'vitest';
import { applyDecisionTable, applyPriorityLadder } from '../web/src/lib/decisionTable.js';

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

describe('applyPriorityLadder — short-circuit 顺序敏感', () => {
    it('空 ladder → defaultValue', () => {
        expect(applyPriorityLadder([], {})).toBeNull();
        expect(applyPriorityLadder([], {}, 'fallback')).toBe('fallback');
        expect(applyPriorityLadder(null, {})).toBeNull();
    });

    it('首个匹配赢，后续不评估', () => {
        const calls = [];
        const ladder = [
            { name: 'never', when: () => false, value: 'A' },
            { name: 'hit',   when: () => { calls.push('B'); return true; }, value: 'B' },
            { name: 'after', when: () => { calls.push('C'); return true; }, value: 'C' },
        ];
        expect(applyPriorityLadder(ladder, {})).toBe('B');
        expect(calls).toEqual(['B']); /* C 未被评估 */
    });

    it('value 为函数 → 动态求值', () => {
        const ladder = [
            { when: (s) => s.x > 0, value: (s) => `pos-${s.x}` },
        ];
        expect(applyPriorityLadder(ladder, { x: 5 })).toBe('pos-5');
    });

    it('全部未命中 → defaultValue', () => {
        const ladder = [
            { when: () => false, value: 'a' },
            { when: () => false, value: 'b' },
        ];
        expect(applyPriorityLadder(ladder, {})).toBeNull();
        expect(applyPriorityLadder(ladder, {}, 'fallback')).toBe('fallback');
    });

    it('when 抛错被吞，规则跳过继续下一条', () => {
        const ladder = [
            { when: () => { throw new Error('boom'); }, value: 'A' },
            { when: () => true, value: 'B' },
        ];
        expect(applyPriorityLadder(ladder, {})).toBe('B');
    });

    it('规则项 when 非函数 → 跳过', () => {
        const ladder = [
            { value: 'A' },
            { when: 'not a function', value: 'B' },
            { when: () => true, value: 'C' },
        ];
        expect(applyPriorityLadder(ladder, {})).toBe('C');
    });

    it('顺序敏感：调换 ladder 顺序改变返回', () => {
        const a = [
            { when: (s) => s.flag, value: 'first-wins' },
            { when: () => true, value: 'always' },
        ];
        const b = [
            { when: () => true, value: 'always' },
            { when: (s) => s.flag, value: 'first-wins' },
        ];
        expect(applyPriorityLadder(a, { flag: true })).toBe('first-wins');
        expect(applyPriorityLadder(b, { flag: true })).toBe('always');
    });
});
