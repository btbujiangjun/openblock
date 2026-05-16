/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { __test_only__ as syncInternals } from '../web/src/checkin/checkinSync.js';

describe('checkinSync merge 防回滚', () => {
    it('服务端旧数据不会覆盖本地新签到', () => {
        const local = {
            lastClaimYmd: '2026-05-16',
            streak: 9,
            totalDays: 23,
            history: ['2026-05-14', '2026-05-15', '2026-05-16'],
        };
        const remote = {
            lastClaimYmd: '2026-05-14',
            streak: 1,
            totalDays: 15,
            history: ['2026-05-13', '2026-05-14'],
        };
        const merged = syncInternals._mergeCheckinState(local, remote);
        expect(merged.lastClaimYmd).toBe('2026-05-16');
        expect(merged.streak).toBe(9);
        expect(merged.totalDays).toBe(23);
        expect(merged.history).toContain('2026-05-16');
    });

    it('服务端更新时可前进到更新日期', () => {
        const local = {
            lastClaimYmd: '2026-05-15',
            streak: 8,
            totalDays: 21,
            history: ['2026-05-15'],
        };
        const remote = {
            lastClaimYmd: '2026-05-16',
            streak: 9,
            totalDays: 22,
            history: ['2026-05-15', '2026-05-16'],
        };
        const merged = syncInternals._mergeCheckinState(local, remote);
        expect(merged.lastClaimYmd).toBe('2026-05-16');
        expect(merged.streak).toBe(9);
        expect(merged.totalDays).toBe(22);
    });

    it('同一天时不降级 streak/totalDays', () => {
        const local = {
            lastClaimYmd: '2026-05-16',
            streak: 12,
            totalDays: 40,
            history: ['2026-05-16'],
        };
        const remote = {
            lastClaimYmd: '2026-05-16',
            streak: 3,
            totalDays: 38,
            history: ['2026-05-15', '2026-05-16'],
        };
        const merged = syncInternals._mergeCheckinState(local, remote);
        expect(merged.lastClaimYmd).toBe('2026-05-16');
        expect(merged.streak).toBe(12);
        expect(merged.totalDays).toBe(40);
        expect(merged.history).toContain('2026-05-15');
    });
});

