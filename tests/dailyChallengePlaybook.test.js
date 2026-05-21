/**
 * @vitest-environment jsdom
 *
 * v1.60.45 §10 — Android 每日高分挑战任务系统
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.7
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/* 注入持久化 mock —— vitest jsdom env 在某些版本下 localStorage 行为不稳定
 * （--localstorage-file 警告），与其他测试（bestScoreChaseStrategy / progression）
 * 一致改用 in-memory mock，保证 dailyChallengePlaybook 的写入/读取在测试间一致。 */
const _mockLs = {};
Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (k) => (k in _mockLs ? _mockLs[k] : null),
        setItem: (k, v) => { _mockLs[k] = String(v); },
        removeItem: (k) => { delete _mockLs[k]; },
        clear: () => { Object.keys(_mockLs).forEach((k) => delete _mockLs[k]); },
        get length() { return Object.keys(_mockLs).length; },
        key: (i) => Object.keys(_mockLs)[i] ?? null,
    },
    writable: true,
    configurable: true,
});

import {
    isEnabled,
    noteHighScore,
    getProgress,
    computeHighScoreThreshold,
    __resetForTests,
    DAILY_TARGET,
    WEEKLY_TARGET,
} from '../web/src/retention/dailyChallengePlaybook.js';
import { _setPlatformForTest } from '../web/src/config/platformProfile.js';

describe('dailyChallengePlaybook', () => {
    beforeEach(() => {
        __resetForTests();
        _setPlatformForTest('android');
    });

    afterEach(() => {
        __resetForTests();
        _setPlatformForTest(null);
    });

    /* ---- isEnabled 平台门控 ---- */

    it('Android 启用', () => {
        _setPlatformForTest('android');
        expect(isEnabled()).toBe(true);
    });

    it('微信小程序启用', () => {
        _setPlatformForTest('wechat');
        expect(isEnabled()).toBe(true);
    });

    it('iOS 不启用', () => {
        _setPlatformForTest('ios');
        expect(isEnabled()).toBe(false);
    });

    it('web 不启用（与 iOS 同档）', () => {
        _setPlatformForTest('web');
        expect(isEnabled()).toBe(false);
    });

    it('iOS 调用 noteHighScore / getProgress 都返回 null', () => {
        _setPlatformForTest('ios');
        expect(noteHighScore()).toBeNull();
        expect(getProgress()).toBeNull();
    });

    /* ---- noteHighScore 日计数 + 奖励 ----
     * 注：通过显式传入 now 确保 _today 在多次调用间一致；
     * 部分 vitest 测试环境 localStorage 行为偶有差异，使用同一 Date 实例可避免边界。 */

    it('累计 3 次触发日奖励（coins/skinTrial/reviveBonus）', () => {
        const now = new Date('2026-05-21T10:00:00Z');
        const a = noteHighScore(now);
        expect(a.dailyDone).toBe(false);
        expect(a.reward).toBeNull();
        expect(a.progress.daily.count).toBe(1);

        const b = noteHighScore(now);
        expect(b.dailyDone).toBe(false);
        expect(b.reward).toBeNull();
        expect(b.progress.daily.count).toBe(2);

        const c = noteHighScore(now);
        expect(c.dailyDone).toBe(true);
        expect(c.reward).toEqual({ coins: 200, skinTrial: 1, reviveBonus: 1 });

        /* 第 4 次不应再次发日奖励 */
        const d = noteHighScore(now);
        expect(d.dailyDone).toBe(true);
        expect(d.reward).toBeNull();
        expect(d.progress.daily.count).toBe(4);
    });

    /* ---- 跨日重置 ---- */

    it('跨日自动重置 count + 不发重复日奖励', () => {
        const day1 = new Date('2026-05-21T10:00:00Z');
        const day2 = new Date('2026-05-22T10:00:00Z');

        noteHighScore(day1);
        noteHighScore(day1);
        const r3 = noteHighScore(day1);
        expect(r3.dailyDone).toBe(true);
        expect(r3.reward).toBeTruthy();

        /* 次日第一次 → 重置，count=1 */
        const r4 = noteHighScore(day2);
        expect(r4.dailyDone).toBe(false);
        expect(r4.progress.daily.count).toBe(1);
        expect(r4.reward).toBeNull();
    });

    /* ---- 周计数 + 周奖励 ---- */

    it('累计 21 次触发周奖励（coins=2000, skinUnlock=1）', () => {
        const start = new Date('2026-05-21T10:00:00Z').getTime();
        for (let i = 0; i < 20; i++) {
            const t = new Date(start + i * 3600_000); /* 同周内推进 1h */
            noteHighScore(t);
        }
        const r21 = noteHighScore(new Date(start + 20 * 3600_000));
        expect(r21.weeklyDone).toBe(true);
        expect(r21.weeklyReward).toEqual({ coins: 2000, skinUnlock: 1 });

        /* 第 22 次不应再发周奖励 */
        const r22 = noteHighScore(new Date(start + 21 * 3600_000));
        expect(r22.weeklyReward).toBeNull();
    });

    it('跨周（≥7 天）自动重置 weekCount + 不发重复周奖励', () => {
        const day1 = new Date('2026-05-21T10:00:00Z');
        const day8 = new Date('2026-05-28T10:00:00Z'); /* +7 天 */
        noteHighScore(day1);
        const r2 = noteHighScore(day8);
        expect(r2.progress.weekly.count).toBe(1); /* 已重置 */
    });

    /* ---- getProgress ---- */

    it('getProgress 返回正确进度（不修改 state）', () => {
        const now = new Date('2026-05-21T10:00:00Z');
        noteHighScore(now);
        noteHighScore(now);
        const p = getProgress(now);
        expect(p.daily).toEqual({ count: 2, target: DAILY_TARGET });
        expect(p.weekly.count).toBe(2);
        expect(p.weekly.target).toBe(WEEKLY_TARGET);
        expect(p.dailyDone).toBe(false);
        /* 二次 getProgress 不应误改 */
        const p2 = getProgress(now);
        expect(p2.daily.count).toBe(2);
    });

    /* ---- computeHighScoreThreshold ---- */

    it('computeHighScoreThreshold: 5 局 [100,200,300,400,500] 中位 300 × 0.95 = 285', () => {
        expect(computeHighScoreThreshold([100, 200, 300, 400, 500])).toBe(285);
    });

    it('computeHighScoreThreshold: 4 局 [100,200,400,800] 中位 (200+400)/2 = 300 × 0.95 = 285', () => {
        expect(computeHighScoreThreshold([100, 200, 400, 800])).toBe(285);
    });

    it('computeHighScoreThreshold: < 3 局 → 返回 0（历史不足）', () => {
        expect(computeHighScoreThreshold([100, 200])).toBe(0);
        expect(computeHighScoreThreshold([])).toBe(0);
        expect(computeHighScoreThreshold(null)).toBe(0);
    });

    it('computeHighScoreThreshold 过滤非法值', () => {
        expect(computeHighScoreThreshold([100, NaN, 200, -50, 300])).toBe(190); /* 中位 200 × 0.95 = 190 */
    });

    it('computeHighScoreThreshold 自定义 multiplier', () => {
        expect(computeHighScoreThreshold([100, 200, 300], 0.5)).toBe(100);
    });
});
