/**
 * NN-F1: traceContext 单测。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    newTraceId, newSpanId, withNewTrace, withSpan,
    annotate, currentTrace, _resetTraceContext,
} from '../web/src/lib/traceContext.js';

beforeEach(() => _resetTraceContext());

describe('NN-F1 traceContext', () => {
    it('newTraceId 16-char hex', () => {
        for (let i = 0; i < 100; i++) {
            const id = newTraceId();
            expect(id).toHaveLength(16);
            expect(id).toMatch(/^[0-9a-f]{16}$/);
        }
    });
    it('newSpanId 8-char hex', () => {
        const id = newSpanId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });
    it('currentTrace 无激活 → null', () => {
        expect(currentTrace()).toBeNull();
    });
    it('withNewTrace 内激活 + 退出后恢复', () => {
        withNewTrace('outer', (ctx) => {
            expect(currentTrace()).toBe(ctx);
            expect(ctx.name).toBe('outer');
            expect(ctx.parentSpanId).toBeUndefined();
        });
        expect(currentTrace()).toBeNull();
    });
    it('嵌套 withSpan 共享 traceId + parentSpanId 链', () => {
        withNewTrace('root', (root) => {
            withSpan('child', (child) => {
                expect(child.traceId).toBe(root.traceId);
                expect(child.parentSpanId).toBe(root.spanId);
                expect(child.spanId).not.toBe(root.spanId);
                withSpan('grandchild', (g) => {
                    expect(g.traceId).toBe(root.traceId);
                    expect(g.parentSpanId).toBe(child.spanId);
                });
                /* grandchild 退出 → child 重新成 current */
                expect(currentTrace()).toBe(child);
            });
            expect(currentTrace()).toBe(root);
        });
    });
    it('withSpan 无激活 trace → 自动起新 trace', () => {
        withSpan('orphan', (ctx) => {
            expect(ctx.traceId).toBeTruthy();
            expect(currentTrace()).toBe(ctx);
        });
    });
    it('annotate 无 trace → untraced', () => {
        const ann = annotate({ foo: 1 });
        expect(ann.foo).toBe(1);
        expect(ann._traceId).toBe('untraced');
        expect(ann._spanId).toBe('00000000');
    });
    it('annotate 有 trace → 注入元数据', () => {
        withNewTrace('test', () => {
            const ann = annotate({ foo: 1 });
            expect(ann.foo).toBe(1);
            expect(ann._traceId).toHaveLength(16);
            expect(ann._spanName).toBe('test');
        });
    });
    it('exception in fn 仍清理 context', () => {
        try {
            withNewTrace('crash', () => { throw new Error('boom'); });
        } catch { /* expected */ }
        expect(currentTrace()).toBeNull();
    });
    it('1000 traceId 全 unique（碰撞概率验证）', () => {
        const ids = new Set();
        for (let i = 0; i < 1000; i++) ids.add(newTraceId());
        expect(ids.size).toBe(1000);
    });
});
