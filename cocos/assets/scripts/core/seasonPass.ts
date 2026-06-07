/**
 * 赛季通行证（严格对齐 web `web/src/seasonPass.js`）。
 *
 * 当前赛季 S1「第一赛季 · 方块觉醒」是任务型赛季页：
 *   - progress 按 clears / score_once / streak_days / levels_done / games 五类追踪；
 *   - 任务首次完成加入 completed，并奖励 season points +100；
 *   - premium 状态保留，用于 UI 展示「高级通行证」按钮 / 徽章；
 *   - 存储结构兼容旧版 XP 轨道 `{ xp, premium, free, paid }`：xp 会迁移为 points 下限，避免升级后归零。
 */
import type { Wallet, WalletKind } from './economy';

export type SeasonTaskType = 'clears' | 'score_once' | 'streak_days' | 'levels_done' | 'games';

export interface SeasonTask {
    id: string;
    label: string;
    type: SeasonTaskType;
    target: number;
    reward: string;
}

export interface CurrentSeason {
    id: string;
    name: string;
    startTs: number;
    endTs: number;
    tasks: SeasonTask[];
}

export const CURRENT_SEASON: CurrentSeason = {
    id: 'S1',
    name: '第一赛季 · 方块觉醒',
    startTs: new Date('2026-04-01').getTime(),
    endTs: new Date('2026-06-30').getTime(),
    tasks: [
        { id: 't1', label: '累计消除 100 行', type: 'clears', target: 100, reward: '金色方块皮肤' },
        { id: 't2', label: '单局得分超过 2000', type: 'score_once', target: 2000, reward: '额外复活 ×1' },
        { id: 't3', label: '连续游玩 7 天', type: 'streak_days', target: 7, reward: '赛季专属徽章' },
        { id: 't4', label: '完成 5 个关卡', type: 'levels_done', target: 5, reward: '彩虹皮肤解锁' },
        { id: 't5', label: '累计游玩 50 局', type: 'games', target: 50, reward: '赛季点数 ×200' },
    ],
};

export interface SeasonTaskView extends SeasonTask {
    progress: number;
    done: boolean;
    pct: number;
}

export interface SeasonPassData {
    seasonId?: string;
    premium?: boolean;
    progress?: Partial<Record<SeasonTaskType, number>>;
    completed?: string[];
    points?: number;
    purchasedAt?: number | null;
    /** 旧版 XP 轨道字段，迁移兼容。 */
    xp?: number;
}

export interface SeasonClaim {
    reward: Partial<Record<WalletKind, number>>;
    source: string;
}

/** 保留旧 API：其它奖励轨道仍可用该函数把 token 礼包入账。 */
export function grantSeasonReward(wallet: Wallet, reward: Partial<Record<WalletKind, number>>, source: string): void {
    for (const [k, v] of Object.entries(reward)) {
        if (v) wallet.addBalance(k as WalletKind, v as number, source);
    }
}

export class SeasonPass {
    premium = false;
    points = 0;
    progress: Partial<Record<SeasonTaskType, number>> = {};
    completed: string[] = [];
    purchasedAt: number | null = null;
    readonly season = CURRENT_SEASON;

    /** 兼容旧 API：旧调用 addXp 时把 XP 作为 season points 累积，不再驱动分档领奖。 */
    addXp(amount: number): void {
        this.points += Math.max(0, Math.floor(amount));
    }

    get isActive(): boolean {
        const now = Date.now();
        return now >= this.season.startTs && now <= this.season.endTs;
    }

    get daysLeft(): number {
        return Math.max(0, Math.ceil((this.season.endTs - Date.now()) / 86_400_000));
    }

    /** MetaPanel 旧摘要兼容：用已完成任务数作为“阶”。 */
    get tier(): number {
        return this.completed.length;
    }

    /** 兼容旧面板 API：整体任务完成率。 */
    get tierProgress(): number {
        return this.season.tasks.length ? this.completed.length / this.season.tasks.length : 1;
    }

    /** 兼容旧面板 API：下一个任务 target。 */
    get nextXp(): number {
        const next = this.season.tasks.find((x) => !this.completed.includes(x.id));
        return next ? next.target : this.season.tasks[this.season.tasks.length - 1]?.target ?? 0;
    }

    views(): SeasonTaskView[] {
        return this.season.tasks.map((task) => {
            const progress = Math.min(this.progress[task.type] ?? 0, task.target);
            return {
                ...task,
                progress,
                done: this.completed.includes(task.id),
                pct: Math.max(0, Math.min(1, progress / task.target)),
            };
        });
    }

    /** 任务型赛季无可领分档；保留空实现兼容旧调用。 */
    claimAll(): SeasonClaim[] {
        return [];
    }

    recordEvent(type: SeasonTaskType, value = 1): SeasonTask[] {
        if (!this.isActive) return [];
        if (type === 'score_once' || type === 'streak_days') {
            this.progress[type] = Math.max(this.progress[type] ?? 0, value);
        } else if (type === 'games') {
            this.progress[type] = (this.progress[type] ?? 0) + 1;
        } else {
            this.progress[type] = (this.progress[type] ?? 0) + Math.max(0, value);
        }
        return this.checkTaskCompletion();
    }

    private checkTaskCompletion(): SeasonTask[] {
        const fresh: SeasonTask[] = [];
        for (const task of this.season.tasks) {
            if (this.completed.includes(task.id)) continue;
            const prog = this.progress[task.type] ?? 0;
            if (prog >= task.target) {
                this.completed.push(task.id);
                this.points += 100;
                fresh.push(task);
            }
        }
        return fresh;
    }

    toJSON(): object {
        return {
            seasonId: this.season.id,
            premium: this.premium,
            progress: this.progress,
            completed: this.completed,
            points: this.points,
            purchasedAt: this.purchasedAt,
        };
    }

    fromJSON(d: SeasonPassData | null): void {
        if (!d) {
            this.ensureData({});
            return;
        }
        this.premium = !!d.premium;
        this.purchasedAt = d.purchasedAt ?? null;
        this.ensureData(d);
    }

    private ensureData(d: SeasonPassData): void {
        if (!d.seasonId || d.seasonId !== this.season.id) {
            this.progress = {};
            this.completed = [];
            // 新赛季保留 premium 与 points（与 web 一致保留积分/付费状态）；旧 xp 作为 points 下限迁移。
            this.points = Math.max(d.points ?? 0, d.xp ?? 0);
            return;
        }
        this.progress = { ...(d.progress ?? {}) };
        this.completed = Array.isArray(d.completed) ? d.completed.slice() : [];
        this.points = Math.max(d.points ?? 0, d.xp ?? 0);
    }
}
