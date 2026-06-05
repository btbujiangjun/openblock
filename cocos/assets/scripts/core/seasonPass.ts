/**
 * 赛季通行证（Phase P1）。引擎无关。线性阶位：每阶需固定赛季经验；
 * 每阶有免费奖励（金币），可领取一次。付费轨道留接口（premium）。
 */
export interface SeasonTier {
    tier: number;
    freeCoins: number;
    premiumCoins: number;
}

const XP_PER_TIER = 100;
const MAX_TIER = 30;

export function buildTiers(): SeasonTier[] {
    const tiers: SeasonTier[] = [];
    for (let i = 1; i <= MAX_TIER; i++) {
        tiers.push({ tier: i, freeCoins: 20 + (i % 5 === 0 ? 60 : 0), premiumCoins: 50 + (i % 5 === 0 ? 150 : 0) });
    }
    return tiers;
}

export class SeasonPass {
    xp = 0;
    premium = false;
    private claimedFree = new Set<number>();
    private claimedPrem = new Set<number>();
    readonly tiers = buildTiers();

    get tier(): number {
        return Math.min(MAX_TIER, 1 + Math.floor(this.xp / XP_PER_TIER));
    }

    get tierProgress(): number {
        return (this.xp % XP_PER_TIER) / XP_PER_TIER;
    }

    addXp(amount: number): void {
        this.xp += Math.max(0, Math.floor(amount));
    }

    canClaim(tier: number, premium = false): boolean {
        if (tier > this.tier) return false;
        if (premium && !this.premium) return false;
        return !(premium ? this.claimedPrem : this.claimedFree).has(tier);
    }

    /** 领取某阶奖励，返回金币数（不可领取返回 0）。 */
    claim(tier: number, premium = false): number {
        if (!this.canClaim(tier, premium)) return 0;
        (premium ? this.claimedPrem : this.claimedFree).add(tier);
        const def = this.tiers[tier - 1];
        return premium ? def.premiumCoins : def.freeCoins;
    }

    /** 一键领取所有可领的免费奖励，返回总金币。 */
    claimAllFree(): number {
        let total = 0;
        for (let t = 1; t <= this.tier; t++) total += this.claim(t, false);
        return total;
    }

    toJSON(): object {
        return { xp: this.xp, premium: this.premium, free: Array.from(this.claimedFree), prem: Array.from(this.claimedPrem) };
    }

    fromJSON(d: { xp?: number; premium?: boolean; free?: number[]; prem?: number[] } | null): void {
        if (!d) return;
        this.xp = Math.max(0, d.xp ?? 0);
        this.premium = !!d.premium;
        this.claimedFree = new Set(d.free ?? []);
        this.claimedPrem = new Set(d.prem ?? []);
    }
}
