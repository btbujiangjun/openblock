/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 部分环境会带无效 `--localstorage-file`，jsdom 持久化 localStorage 会抛错。
 * 用内存实现覆盖，与 wallet / monetization 等测试一致。
 */
const { mockLS } = vi.hoisted(() => {
    const store = Object.create(null);
    const mockLS = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => {
            store[k] = String(v);
        },
        removeItem: (k) => {
            delete store[k];
        },
        clear: () => {
            Object.keys(store).forEach((k) => delete store[k]);
        },
        get length() {
            return Object.keys(store).length;
        },
        key: (i) => Object.keys(store)[i] ?? null,
    };
    return { mockLS };
});
vi.stubGlobal('localStorage', mockLS);

import {
    getLevelFromTotalXp,
    getLevelProgress,
    applyGameEndProgression,
    loadProgress,
    computeXpGain,
    saveProgress,
    invalidateProgressCache,
    isSkinUnlocked,
    setSkinUnlockProvider,
    resetSkinUnlockProvider,
} from '../web/src/progression.js';

beforeEach(() => {
    mockLS.clear();
    invalidateProgressCache();
});

describe('progression', () => {
    it('getLevelFromTotalXp uses sqrt curve', () => {
        expect(getLevelFromTotalXp(0)).toBe(1);
        expect(getLevelFromTotalXp(99)).toBe(1);
        expect(getLevelFromTotalXp(100)).toBe(2);
        expect(getLevelFromTotalXp(399)).toBe(2);
        expect(getLevelFromTotalXp(400)).toBe(3);
    });

    it('getLevelProgress frac in range', () => {
        const p = getLevelProgress(150);
        expect(p.level).toBe(2);
        expect(p.frac).toBeGreaterThanOrEqual(0);
        expect(p.frac).toBeLessThanOrEqual(1);
    });

    it('applyGameEndProgression persists totalXp', () => {
        const r = applyGameEndProgression({
            score: 400,
            gameStats: { clears: 4, maxLinesCleared: 2 },
            strategy: 'normal',
            runStreak: 0
        });
        expect(r.xpGained).toBeGreaterThanOrEqual(10);
        expect(r.state.totalXp).toBe(r.xpGained);
    });

    it('saveProgress 成功后 loadProgress 命中内存缓存并与存储一致', () => {
        saveProgress({ totalXp: 10, bonusDayYmd: '', streakYmd: '', dailyStreak: 1 });
        expect(loadProgress().totalXp).toBe(10);
        expect(loadProgress().totalXp).toBe(10);
        saveProgress({ totalXp: 22, bonusDayYmd: '', streakYmd: '', dailyStreak: 1 });
        expect(loadProgress().totalXp).toBe(22);
    });

    /* v1.49.x P1-5：progression.isSkinUnlocked 默认放开（向后兼容），
     * 注入 provider 后改用真分级；调 reset 后恢复默认。 */
    it('P1-5 isSkinUnlocked 默认全部开放（向后兼容）', () => {
        resetSkinUnlockProvider();
        expect(isSkinUnlocked('forest', 100)).toBe(true);
        expect(isSkinUnlocked('midnight', 0)).toBe(true);
    });

    it('P1-5 注入 provider 后委托给 monetization/skinUnlock 真逻辑', () => {
        setSkinUnlockProvider((skinId, _xp) => skinId === 'free_skin');
        expect(isSkinUnlocked('free_skin')).toBe(true);
        expect(isSkinUnlocked('locked_skin')).toBe(false);
        resetSkinUnlockProvider();
        expect(isSkinUnlocked('locked_skin')).toBe(true);
    });

    it('P1-5 provider 抛错时退化为 true（不阻塞 UI 渲染）', () => {
        setSkinUnlockProvider(() => { throw new Error('boom'); });
        expect(isSkinUnlocked('any')).toBe(true);
        resetSkinUnlockProvider();
    });

    it('computeXpGain applies strategy multiplier', () => {
        const state = loadProgress();
        const easy = computeXpGain({
            score: 200,
            gameStats: { clears: 0, maxLinesCleared: 0 },
            strategy: 'easy',
            runStreak: 0,
            state
        });
        const state2 = loadProgress();
        const hard = computeXpGain({
            score: 200,
            gameStats: { clears: 0, maxLinesCleared: 0 },
            strategy: 'hard',
            runStreak: 0,
            state: state2
        });
        expect(hard.total).toBeGreaterThan(easy.total);
    });
});
