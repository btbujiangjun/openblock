/**
 * @vitest-environment jsdom
 *
 * lib/logger.js 行为契约（v1.70）：级别过滤、tag 前缀、setLogLevel 双向控制、
 * console 缺失兜底。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createLogger, setLogLevel, configureLoggerFromConfig, LOG_LEVELS,
    setRemoteSink, getRecentLogs, _resetLoggerState,
} from '../web/src/lib/logger.js';

describe('lib/logger', () => {
    let warnSpy;
    let errorSpy;
    let infoSpy;
    let debugSpy;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        setLogLevel('info'); // reset 到默认
        setRemoteSink(null);  // 清 sink
        _resetLoggerState();  // 清 ring buffer + 去重
    });

    it('LOG_LEVELS 暴露已知级别', () => {
        expect(LOG_LEVELS.debug).toBeDefined();
        expect(LOG_LEVELS.info).toBeDefined();
        expect(LOG_LEVELS.warn).toBeDefined();
        expect(LOG_LEVELS.error).toBeDefined();
        expect(LOG_LEVELS.silent).toBeDefined();
    });

    it('warn/error 在默认 info 级别下可见，且前缀含 [tag]', () => {
        const log = createLogger('spawn');
        log.warn('hello', 1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toBe('[spawn]');
        expect(warnSpy.mock.calls[0][1]).toBe('hello');
        log.error('boom');
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('debug 在 info 级别默认被屏蔽；调到 debug 后可见', () => {
        const log = createLogger('lifecycle');
        log.debug('hidden');
        expect(debugSpy).not.toHaveBeenCalled();
        expect(log.isDebug).toBe(false);

        setLogLevel('debug');
        expect(log.isDebug).toBe(true);
        log.debug('visible');
        expect(debugSpy).toHaveBeenCalledTimes(1);
    });

    it('silent 级别屏蔽全部', () => {
        setLogLevel('silent');
        const log = createLogger('x');
        log.warn('w'); log.error('e'); log.info('i'); log.debug('d');
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
        expect(debugSpy).not.toHaveBeenCalled();
    });

    it('未知 tag 落回 "app"', () => {
        const log = createLogger();
        log.warn('m');
        expect(warnSpy.mock.calls[0][0]).toBe('[app]');
    });

    it('log() 别名走 info 级别（迁移 console.log 友好）', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = createLogger('migrate');
        log.log('a', 'b');
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0][0]).toBe('[migrate]');
        setLogLevel('warn');
        log.log('hidden');
        expect(logSpy).toHaveBeenCalledTimes(1); // warn 级别屏蔽 log
        logSpy.mockRestore();
    });

    it('configureLoggerFromConfig: 生产环境 prodLevel 生效', () => {
        // jsdom 默认 hostname=localhost → dev；显式 env='prod' 走 prodLevel
        configureLoggerFromConfig({ logging: { defaultLevel: 'info', prodLevel: 'error' } }, 'prod');
        const log = createLogger('mp');
        log.warn('warn-should-be-hidden');
        expect(warnSpy).not.toHaveBeenCalled();
        log.error('err-visible');
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('configureLoggerFromConfig: dev 走 defaultLevel', () => {
        configureLoggerFromConfig({ logging: { defaultLevel: 'debug', prodLevel: 'warn' } }, 'dev');
        const log = createLogger('mp');
        log.debug('visible');
        expect(debugSpy).toHaveBeenCalledTimes(1);
    });
});

describe('lib/logger — ring buffer + 远程上报 (T4)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        setLogLevel('info');
        setRemoteSink(null);
        _resetLoggerState();
    });

    it('每条日志都写入 ring buffer（结构化 entry）', () => {
        const log = createLogger('t');
        log.info('hello');
        log.warn('careful');
        const buf = getRecentLogs();
        expect(buf).toHaveLength(2);
        expect(buf[0]).toMatchObject({ level: 'info', tag: 't', args: ['hello'] });
        expect(buf[1]).toMatchObject({ level: 'warn', tag: 't', args: ['careful'] });
        expect(buf[0].ts).toBeGreaterThan(0);
    });

    it('ring buffer 容量上限 200，超出后覆盖最旧的（FIFO）', () => {
        const log = createLogger('t');
        for (let i = 0; i < 250; i++) log.info('msg', i);
        const buf = getRecentLogs();
        expect(buf).toHaveLength(200);
        /* 最旧的 50 条被覆盖：剩下的应该是 50..249 */
        expect(buf[0].args).toEqual(['msg', 50]);
        expect(buf[199].args).toEqual(['msg', 249]);
    });

    it('error 触发 sink，sink 收到 entry + 最近上下文', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.info('warmup-1');
        log.info('warmup-2');
        log.error('boom', { code: 42 });
        expect(sink).toHaveBeenCalledTimes(1);
        const [entry, context] = sink.mock.calls[0];
        expect(entry).toMatchObject({ level: 'error', tag: 't', args: ['boom', { code: 42 }] });
        expect(context).toHaveLength(3);
        expect(context[0].args).toEqual(['warmup-1']);
        expect(context[2].args).toEqual(['boom', { code: 42 }]);
    });

    it('warn / info 不触发 sink', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.warn('w');
        log.info('i');
        expect(sink).not.toHaveBeenCalled();
    });

    it('同 tag+message 错误 30s 去重（默认 ts=Date.now，本测试用 fake timer）', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error('boom');
        log.error('boom');
        log.error('boom');
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('不同 message 不去重', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error('boom-A');
        log.error('boom-B');
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('Error 对象的 .message 用于去重 key', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error(new Error('same-cause'));
        log.error(new Error('same-cause'));
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('sink 抛错不传染 logger（依然把日志输出到 console）', () => {
        setRemoteSink(() => { throw new Error('sink dead'); });
        const log = createLogger('t');
        expect(() => log.error('boom')).not.toThrow();
        /* ring buffer 仍然记下 */
        expect(getRecentLogs().length).toBe(1);
    });

    it('setRemoteSink(null) 禁用上报', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        createLogger('t').error('boom');
        expect(sink).toHaveBeenCalledTimes(1);
        setRemoteSink(null);
        _resetLoggerState();
        createLogger('t').error('boom');
        expect(sink).toHaveBeenCalledTimes(1); // 不再涨
    });

    it('_resetLoggerState 清空 ring 与去重表', () => {
        const sink = vi.fn();
        setRemoteSink(sink);
        const log = createLogger('t');
        log.error('boom');
        _resetLoggerState();
        expect(getRecentLogs()).toHaveLength(0);
        log.error('boom');
        expect(sink).toHaveBeenCalledTimes(2);
    });
});
