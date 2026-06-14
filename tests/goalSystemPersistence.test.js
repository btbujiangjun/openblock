import { describe, it, expect, beforeEach, vi } from 'vitest';

/* 部分环境带无效 --localstorage-file，全局 localStorage 无可用方法；用内存实现覆盖。 */
const { mockLS } = vi.hoisted(() => {
    const store = Object.create(null);
    return {
        mockLS: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        },
    };
});
vi.stubGlobal('localStorage', mockLS);

import { initGoalSystem, resetGoalSystem } from '../web/src/retention/goalSystem.js';

describe('LO-2 goalSystem 持久化 + 每日刷新', () => {
    beforeEach(() => {
        resetGoalSystem();
        localStorage.clear();
    });

    it('进度跨会话保留（重新 init 后仍在）', () => {
        const sys = initGoalSystem();
        sys.updateProgress({ score: 12000, clears: 4, perfectClears: false, achieved: true });
        expect(sys.getProgress().totalScore).toBe(12000);

        // 模拟新会话：重新从持久化加载
        sys.init();
        expect(sys.getProgress().totalScore).toBe(12000);
        expect(sys.getProgress().totalGames).toBe(1);
    });

    it('已领取奖励的目标不会因重新 init 被重置（防刷）', () => {
        const sys = initGoalSystem();
        // 累计分数达 10k → score_10k 完成
        sys.updateProgress({ score: 10000, clears: 0, achieved: true });
        const completed = sys.checkGoals();
        const goal = completed.find((g) => g.id === 'score_10k');
        expect(goal).toBeTruthy();
        const reward = sys.claimReward('score_10k');
        expect(reward).toBeTruthy();

        // 新会话重新加载：claimed 状态保留 → 再次 claim 返回 null
        sys.init();
        expect(sys.claimReward('score_10k')).toBeNull();
    });

    it('refreshDaily 同日幂等，跨日返回 true', () => {
        const sys = initGoalSystem();
        expect(sys.refreshDaily()).toBe(false); // init 内已刷新过当日
        // 手动改写持久化的 lastRefresh 为昨天，模拟跨日
        const raw = JSON.parse(localStorage.getItem('openblock_goal_system_v1'));
        raw.lastRefresh = 'Mon Jan 01 2024';
        localStorage.setItem('openblock_goal_system_v1', JSON.stringify(raw));
        sys.init();
        expect(sys.refreshDaily()).toBe(false); // init 已把 lastRefresh 设为今天
    });
});
