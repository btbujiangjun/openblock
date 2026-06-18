/**
 * @vitest-environment jsdom
 *
 * lib/logger.js 行为契约（v1.70）：级别过滤、tag 前缀、setLogLevel 双向控制、
 * console 缺失兜底。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLogger, setLogLevel, LOG_LEVELS } from '../web/src/lib/logger.js';

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
});
