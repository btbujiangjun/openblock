/**
 * 奖励循环（Phase P1）：结算宝箱 + 幸运转盘。引擎无关，纯 RNG。
 */
import { Rng, defaultRng } from './rng';
import { getConfig } from './remoteConfig';

/** 结算宝箱：基础金币 + 按分数加成。 */
export function openChest(score: number, rng: Rng = defaultRng): number {
    const cfg = getConfig();
    const base = cfg.chestBaseCoins + Math.floor(score * cfg.chestScoreFactor);
    const jitter = 0.85 + rng() * 0.3; // ±15%
    return Math.max(1, Math.round(base * jitter));
}

export interface WheelResult {
    index: number;
    coins: number;
}

/** 幸运转盘：从奖励池等概率抽取。 */
export function spinWheel(rng: Rng = defaultRng): WheelResult {
    const pool = getConfig().wheelRewards;
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    return { index, coins: pool[index] };
}
