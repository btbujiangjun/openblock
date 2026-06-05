/**
 * 每日系统（Phase P1）：签到连签 / 月度里程碑 / 首胜加成 / 每日菜单。
 * 引擎无关；以 `dateKey`（YYYY-MM-DD）驱动，可注入 Date 便于测试。
 */
import { getConfig } from './remoteConfig';

export function dateKey(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function prevKey(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return dateKey(dt);
}

export interface CheckinResult {
    already: boolean;
    coins: number;
    streak: number;
    weekBonus: boolean;
}

export interface DailyDish {
    key: string;
    /** 目标消行数 */
    targetLines: number;
    reward: number;
    progress: number;
    claimed: boolean;
}

export class DailyState {
    lastCheckin = '';
    streak = 0;
    monthCheckins: string[] = [];
    lastWinDate = '';
    dish: DailyDish | null = null;

    checkin(today = dateKey()): CheckinResult {
        if (this.lastCheckin === today) {
            return { already: true, coins: 0, streak: this.streak, weekBonus: false };
        }
        this.streak = this.lastCheckin === prevKey(today) ? this.streak + 1 : 1;
        this.lastCheckin = today;
        if (!this.monthCheckins.includes(today)) this.monthCheckins.push(today);
        this.pruneMonth(today);
        const cfg = getConfig();
        const weekBonus = this.streak % 7 === 0;
        const coins = cfg.checkinBaseCoins + (weekBonus ? cfg.checkinWeekBonus : 0);
        return { already: false, coins, streak: this.streak, weekBonus };
    }

    private pruneMonth(today: string): void {
        const mm = today.slice(0, 7);
        this.monthCheckins = this.monthCheckins.filter((k) => k.startsWith(mm));
    }

    /** 月度里程碑：本月签到天数命中 7/15/28 时返回奖励，否则 0。 */
    monthlyMilestone(today = dateKey()): number {
        this.pruneMonth(today);
        const n = this.monthCheckins.length;
        if (n === 7) return 80;
        if (n === 15) return 180;
        if (n === 28) return 400;
        return 0;
    }

    /** 是否今日首胜（消耗式：调用后标记今日已胜）。 */
    consumeFirstWin(today = dateKey()): boolean {
        if (this.lastWinDate === today) return false;
        this.lastWinDate = today;
        return true;
    }

    firstWinMultiplier(): number {
        return getConfig().firstWinMultiplier;
    }

    /** 取/建今日菜单（每日确定性目标）。 */
    getDish(today = dateKey()): DailyDish {
        if (this.dish && this.dish.key === today) return this.dish;
        // 由日期派生确定性目标
        const seed = today.split('-').reduce((a, b) => a + Number(b), 0);
        const targetLines = 8 + (seed % 5) * 2; // 8..16
        this.dish = { key: today, targetLines, reward: 60, progress: 0, claimed: false };
        return this.dish;
    }

    addDishProgress(lines: number, today = dateKey()): DailyDish {
        const dish = this.getDish(today);
        dish.progress = Math.min(dish.targetLines, dish.progress + lines);
        return dish;
    }

    claimDish(today = dateKey()): number {
        const dish = this.getDish(today);
        if (dish.claimed || dish.progress < dish.targetLines) return 0;
        dish.claimed = true;
        return dish.reward;
    }

    toJSON(): object {
        return {
            lastCheckin: this.lastCheckin,
            streak: this.streak,
            monthCheckins: this.monthCheckins,
            lastWinDate: this.lastWinDate,
            dish: this.dish,
        };
    }

    fromJSON(d: Partial<DailyState> | null): void {
        if (!d) return;
        this.lastCheckin = d.lastCheckin ?? '';
        this.streak = d.streak ?? 0;
        this.monthCheckins = Array.isArray(d.monthCheckins) ? d.monthCheckins : [];
        this.lastWinDate = d.lastWinDate ?? '';
        this.dish = (d.dish as DailyDish) ?? null;
    }
}
