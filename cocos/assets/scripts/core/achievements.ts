/**
 * 成就系统（Phase P1）。引擎无关。定义来自 web config.ACHIEVEMENTS 的等价子集，
 * 按累计统计判定解锁；已解锁集合由调用方持久化。
 */

export interface AchievementDef {
    id: string;
    name: string;
    desc: string;
    icon: string;
    /** 判定函数：达成返回 true */
    test: (s: AchievementStats) => boolean;
    /** 解锁奖励金币 */
    reward: number;
}

export interface AchievementStats {
    bestScore: number;
    totalLines: number;
    maxComboLines: number;
    totalGames: number;
    level: number;
    perfectClears: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
    { id: 'first_clear', name: '初次消除', desc: '完成第一次消行', icon: '⭐', reward: 10, test: (s) => s.totalLines >= 1 },
    { id: 'score_100', name: '百分达成', desc: '单局达到 100 分', icon: '💯', reward: 20, test: (s) => s.bestScore >= 100 },
    { id: 'score_500', name: '高分玩家', desc: '单局达到 500 分', icon: '🔥', reward: 40, test: (s) => s.bestScore >= 500 },
    { id: 'score_1000', name: '大师', desc: '单局达到 1000 分', icon: '👑', reward: 80, test: (s) => s.bestScore >= 1000 },
    { id: 'triple', name: '三连消', desc: '一次消除 3 行', icon: '⚡', reward: 30, test: (s) => s.maxComboLines >= 3 },
    { id: 'penta', name: '连击大师', desc: '一次消除 5 行', icon: '💥', reward: 60, test: (s) => s.maxComboLines >= 5 },
    { id: 'perfect', name: '完美清屏', desc: '达成一次完美清屏', icon: '🏆', reward: 100, test: (s) => s.perfectClears >= 1 },
    { id: 'games_10', name: '坚持不懈', desc: '游玩 10 局', icon: '🎮', reward: 30, test: (s) => s.totalGames >= 10 },
    { id: 'level_5', name: '初窥门径', desc: '等级达到 5', icon: '📈', reward: 50, test: (s) => s.level >= 5 },
    { id: 'level_10', name: '渐入佳境', desc: '等级达到 10', icon: '⬆️', reward: 100, test: (s) => s.level >= 10 },
];

export class AchievementState {
    unlocked = new Set<string>();

    /** 评估并返回本次「新解锁」的成就（含奖励）。 */
    evaluate(stats: AchievementStats): AchievementDef[] {
        const fresh: AchievementDef[] = [];
        for (const a of ACHIEVEMENTS) {
            if (this.unlocked.has(a.id)) continue;
            if (a.test(stats)) {
                this.unlocked.add(a.id);
                fresh.push(a);
            }
        }
        return fresh;
    }

    progress(): { unlocked: number; total: number } {
        return { unlocked: this.unlocked.size, total: ACHIEVEMENTS.length };
    }

    toJSON(): { unlocked: string[] } {
        return { unlocked: Array.from(this.unlocked) };
    }

    fromJSON(d: { unlocked?: string[] } | null): void {
        this.unlocked = new Set(d?.unlocked ?? []);
    }
}
