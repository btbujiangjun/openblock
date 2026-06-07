/**
 * 赛季进阶宝箱（对齐 web `rewards/seasonChest.js`）。引擎无关。
 *
 * 复用生涯累计经验 `Progression.totalXp`，每跨过 1000 / 5000 / 12000 / 25000 XP
 * 解锁阶梯宝箱（普通 / 稀有 / 史诗 / 传说），首次到达即发放并庆祝（每阶一次）。
 * 奖励与 web 完全一致：token 道具礼包（+ 史诗/传说附带限时试穿券）。
 */
import { WalletKind } from './economy';

export type SeasonChestId = 'common' | 'rare' | 'epic' | 'legend';

export interface SeasonChestTier {
    id: SeasonChestId;
    xp: number;
    /** token 道具礼包（对齐 web TIERS[].reward）。 */
    reward: Partial<Record<WalletKind, number>>;
    /** 附带限时试穿券 [skinId, hours]（仅 epic/legend）。 */
    trial?: [skinId: string, hours: number];
}

/** 阈值与奖励严格对齐 web `seasonChest.js` TIERS。 */
export const SEASON_CHEST_TIERS: SeasonChestTier[] = [
    { id: 'common', xp: 1000, reward: { hintToken: 5, undoToken: 3 } },
    { id: 'rare', xp: 5000, reward: { hintToken: 12, bombToken: 1, rainbowToken: 1 } },
    { id: 'epic', xp: 12000, reward: { hintToken: 30, bombToken: 3, rainbowToken: 3 }, trial: ['fairy', 24] },
    { id: 'legend', xp: 25000, reward: { hintToken: 100, bombToken: 10, rainbowToken: 10 }, trial: ['forbidden', 48] },
];

export class SeasonChestState {
    readonly tiers = SEASON_CHEST_TIERS;
    private claimed = new Set<SeasonChestId>();

    /**
     * 按累计经验结算新解锁的阶梯宝箱（幂等：已领取的阶不再返回）。
     * 返回本次新解锁的阶位列表（通常 0~1 个，跨度大时可能多个）。
     */
    check(totalXp: number): SeasonChestTier[] {
        const out: SeasonChestTier[] = [];
        for (const tier of this.tiers) {
            if (totalXp >= tier.xp && !this.claimed.has(tier.id)) {
                this.claimed.add(tier.id);
                out.push(tier);
            }
        }
        return out;
    }

    isClaimed(id: SeasonChestId): boolean {
        return this.claimed.has(id);
    }

    toJSON(): { claimed: SeasonChestId[] } {
        return { claimed: Array.from(this.claimed) };
    }

    fromJSON(d: { claimed?: SeasonChestId[] } | null): void {
        if (!d) return;
        this.claimed = new Set(d.claimed ?? []);
    }
}
