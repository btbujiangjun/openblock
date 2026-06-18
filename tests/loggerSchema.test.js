/**
 * AA4: lib/logger 结构化日志 schema 契约单测。
 *
 * 与 Z4 *_window contract tests 同思路 —— 不测行为，测**模块导出 + 数据结构表面**。
 *
 * 远程 sink 收到的 entry / recentContext 字段被服务端 / Sentry 等下游消费，
 * 重命名 `ts` / `level` / `tag` / `args` 会让所有错误聚合失效。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createLogger, setLogLevel, setRemoteSink,
    getRecentLogs, _resetLoggerState, LOG_LEVELS,
} from '../web/src/lib/logger.js';

beforeEach(() => {
    _resetLoggerState();
    setLogLevel('debug');
    setRemoteSink(null);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AA4 LOG_LEVELS 常量 schema', () => {
    it('5 个标准 level 全在', () => {
        expect(LOG_LEVELS).toHaveProperty('debug');
        expect(LOG_LEVELS).toHaveProperty('info');
        expect(LOG_LEVELS).toHaveProperty('warn');
        expect(LOG_LEVELS).toHaveProperty('error');
        expect(LOG_LEVELS).toHaveProperty('silent');
    });

    it('数值单调递增（保证级别过滤可比较）', () => {
        expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info);
        expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn);
        expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
        expect(LOG_LEVELS.error).toBeLessThan(LOG_LEVELS.silent);
    });

    it('LOG_LEVELS 是 frozen（防业务侧污染）', () => {
        expect(Object.isFrozen(LOG_LEVELS)).toBe(true);
    });
});

describe('AA4 createLogger 返回 logger 形状', () => {
    it('含 5 个方法 + 1 个 getter (isDebug) + DD4 errorWithExtra', () => {
        const log = createLogger('test');
        expect(typeof log.debug).toBe('function');
        expect(typeof log.info).toBe('function');
        expect(typeof log.log).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.isDebug).toBe('boolean');
        /* DD4：新方法 */
        expect(typeof log.errorWithExtra).toBe('function');
    });

    it('默认 tag = "app" 当 tag 为空', () => {
        const log = createLogger();
        log.error('test');
        const logs = getRecentLogs();
        expect(logs[0].tag).toBe('app');
    });
});

describe('AA4 ring buffer entry schema 契约', () => {
    it('entry 含 ts/level/tag/args 四字段（重命名即测试失败）', () => {
        const log = createLogger('test');
        log.info('hello', { a: 1 });
        const logs = getRecentLogs();
        expect(logs).toHaveLength(1);
        const e = logs[0];
        expect(e).toHaveProperty('ts');
        expect(e).toHaveProperty('level');
        expect(e).toHaveProperty('tag');
        expect(e).toHaveProperty('args');
    });

    it('entry 类型正确：ts=number, level/tag=string, args=array', () => {
        const log = createLogger('test');
        log.warn('hello', { a: 1 });
        const e = getRecentLogs()[0];
        expect(typeof e.ts).toBe('number');
        expect(typeof e.level).toBe('string');
        expect(typeof e.tag).toBe('string');
        expect(Array.isArray(e.args)).toBe(true);
    });

    it('level 字段值在 LOG_LEVELS keys 中', () => {
        const log = createLogger('test');
        log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
        const levels = getRecentLogs().map(e => e.level);
        for (const l of levels) {
            expect(LOG_LEVELS[l] !== undefined || l === 'log').toBe(true);
        }
    });

    it('ring buffer 按时间顺序保留（旧→新）', async () => {
        const log = createLogger('t');
        log.info('first');
        await new Promise(r => setTimeout(r, 2));
        log.info('second');
        const logs = getRecentLogs();
        expect(logs).toHaveLength(2);
        expect(logs[0].args[0]).toBe('first');
        expect(logs[1].args[0]).toBe('second');
        expect(logs[0].ts).toBeLessThanOrEqual(logs[1].ts);
    });
});

describe('AA4 远程 sink 契约', () => {
    it('error 触发 sink；sink 收到 (entry, recentContext)', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('mod1');
        log.error('boom', { code: 500 });
        expect(sink).toHaveBeenCalledTimes(1);
        const [entry, context] = sink.mock.calls[0];
        expect(entry.tag).toBe('mod1');
        expect(entry.level).toBe('error');
        expect(entry.args[0]).toBe('boom');
        expect(Array.isArray(context)).toBe(true);
    });

    it('非 error 级别不触发 sink', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('test');
        log.debug('d'); log.info('i'); log.warn('w');
        expect(sink).not.toHaveBeenCalled();
    });

    it('sink 抛错不影响 logger 自身（兜底契约）', () => {
        setRemoteSink(() => { throw new Error('sink crashed'); });
        const log = createLogger('test');
        expect(() => log.error('boom')).not.toThrow();
        /* logger 仍正常 emit */
        expect(getRecentLogs()).toHaveLength(1);
    });

    it('30s 去重窗口：同 tag+msg 30s 内只上报 1 次', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error('same-msg');
        log.error('same-msg'); /* 应被去重 */
        log.error('same-msg');
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('不同 msg 不被去重', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error('msg1');
        log.error('msg2');
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('setRemoteSink(null) 解除上报', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        setRemoteSink(null);
        createLogger('t').error('boom');
        expect(sink).not.toHaveBeenCalled();
    });
});

describe('DD4 errorWithExtra 结构化字段契约', () => {
    it('entry.extra 透传完整 object', () => {
        const log = createLogger('test');
        log.errorWithExtra({ gameMode: 'classic', buildId: '1.71.2' }, 'boom');
        const e = getRecentLogs()[0];
        expect(e.extra).toEqual({ gameMode: 'classic', buildId: '1.71.2' });
        expect(e.args).toEqual(['boom']);
    });

    it('entry.extra 是 undefined 当用 .error()（非 errorWithExtra）', () => {
        const log = createLogger('test');
        log.error('plain');
        const e = getRecentLogs()[0];
        expect(e.extra).toBeUndefined();
    });

    it('sink 收到 entry 含 extra（远端可按 extra.X group_by）', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('m');
        log.errorWithExtra({ screen: 'lobby' }, 'click failed');
        expect(sink).toHaveBeenCalledTimes(1);
        const [entry] = sink.mock.calls[0];
        expect(entry.extra).toEqual({ screen: 'lobby' });
        expect(entry.level).toBe('error');
        expect(entry.tag).toBe('m');
    });

    it('args 与 extra 完全独立：args 用人读、extra 用机读', () => {
        const log = createLogger('test');
        const err = new Error('decode fail');
        log.errorWithExtra({ retry: 3, code: 'E_DECODE' }, 'parse error:', err);
        const e = getRecentLogs()[0];
        expect(e.args).toEqual(['parse error:', err]);
        expect(e.extra).toEqual({ retry: 3, code: 'E_DECODE' });
    });

    it('extra 为空 object → 上报但不影响 args', () => {
        const log = createLogger('t');
        log.errorWithExtra({}, 'msg');
        const e = getRecentLogs()[0];
        expect(e.extra).toEqual({});
        expect(e.args).toEqual(['msg']);
    });

    it('低于 error 级别时不写入（与原 .error 一致）', () => {
        setLogLevel('silent');
        const log = createLogger('t');
        log.errorWithExtra({ x: 1 }, 'should not appear');
        expect(getRecentLogs()).toHaveLength(0);
    });

    it('30s 去重窗口对 errorWithExtra 同样生效', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.errorWithExtra({ a: 1 }, 'dup-msg');
        log.errorWithExtra({ a: 2 }, 'dup-msg'); /* 同 tag+msg → 被去重 */
        expect(sink).toHaveBeenCalledTimes(1);
        /* 第一次的 extra 被透传 */
        expect(sink.mock.calls[0][0].extra).toEqual({ a: 1 });
    });
});

describe('AA4 setLogLevel 契约', () => {
    it('调到 error → debug/info/warn 不进 ring buffer', () => {
        setLogLevel('error');
        const log = createLogger('t');
        log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
        const logs = getRecentLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0].level).toBe('error');
    });

    it('调到 silent → 所有级别都不进 ring buffer', () => {
        setLogLevel('silent');
        const log = createLogger('t');
        log.error('e');
        expect(getRecentLogs()).toHaveLength(0);
    });

    it('未知 level → 保持原值（不抛错）', () => {
        setLogLevel('debug');
        setLogLevel('UNKNOWN_LEVEL');
        const log = createLogger('t');
        log.debug('d');
        /* debug 仍然能进 */
        expect(getRecentLogs()).toHaveLength(1);
    });
});
