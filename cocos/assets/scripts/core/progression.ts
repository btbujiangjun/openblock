/**
 * 玩家成长：经验 / 等级（Phase P1）。引擎无关；持久化由调用方 toJSON/fromJSON。
 * need(level) = xpPerLevelBase * level（线性递增）。
 */
import { getConfig } from './remoteConfig';

export interface LevelUpResult {
    leveledUp: boolean;
    fromLevel: number;
    level: number;
    xp: number;
    need: number;
}

export class Progression {
    level = 1;
    xp = 0;
    /** 生涯累计经验（只增不减，对齐 web progression `totalXp`）—— 供赛季进阶宝箱阈值判定。 */
    totalXp = 0;

    need(): number {
        return getConfig().xpPerLevelBase * this.level;
    }

    /** 获得经验，处理连续升级。返回升级信息。 */
    addXp(amount: number): LevelUpResult {
        const from = this.level;
        const gain = Math.max(0, Math.floor(amount));
        this.xp += gain;
        this.totalXp += gain;
        let need = this.need();
        while (this.xp >= need) {
            this.xp -= need;
            this.level++;
            need = this.need();
        }
        return { leveledUp: this.level > from, fromLevel: from, level: this.level, xp: this.xp, need };
    }

    toJSON(): { level: number; xp: number; totalXp: number } {
        return { level: this.level, xp: this.xp, totalXp: this.totalXp };
    }

    fromJSON(d: { level?: number; xp?: number; totalXp?: number } | null): void {
        if (!d) return;
        this.level = Math.max(1, d.level ?? 1);
        this.xp = Math.max(0, d.xp ?? 0);
        // 旧存档无 totalXp：按等级公式回推一份累计值（xpPerLevelBase * Σ(1..level-1) + xp）。
        if (d.totalXp != null) {
            this.totalXp = Math.max(0, d.totalXp);
        } else {
            const base = getConfig().xpPerLevelBase;
            this.totalXp = base * ((this.level - 1) * this.level) / 2 + this.xp;
        }
    }
}
