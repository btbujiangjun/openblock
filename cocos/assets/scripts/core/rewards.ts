/**
 * 奖励循环（Phase P1）：结算宝箱 + 幸运转盘。引擎无关，纯 RNG。
 */
import { Rng, defaultRng } from './rng';
import { getConfig } from './remoteConfig';
import { WalletKind } from './economy';

/** 结算宝箱：基础金币 + 按分数加成。 */
export function openChest(score: number, rng: Rng = defaultRng): number {
    const cfg = getConfig();
    const base = cfg.chestBaseCoins + Math.floor(score * cfg.chestScoreFactor);
    const jitter = 0.85 + rng() * 0.3; // ±15%
    return Math.max(1, Math.round(base * jitter));
}

/**
 * 幸运转盘奖品（严格对齐 web `rewards/luckyWheel.js` 的 PRIZES）：
 *   8 段加权奖池——4× 提示 / 3× 撤销 / 2× 炸弹 / 1× 彩虹 / 金币 50 / 金币 200 / 12h 试穿 / 金币 10。
 *   `items` 为 token/金币礼包；`trialHours` 对应 web 的 `_trial`（随机皮肤限时试穿）。
 */
export interface WheelPrize {
    id: string;
    /** 扇区主标题（web PRIZES.name）。 */
    name: string;
    /** 扇区数量/时长副标题（web PRIZES.count）。 */
    count: string;
    /** 结果展示完整文案（web PRIZES.label）。 */
    label: string;
    items: Partial<Record<WalletKind, number>>;
    /** 限时皮肤试穿小时数（对齐 web `_trial`）；存在时从 WHEEL_TRIAL_POOL 随机发一个。 */
    trialHours?: number;
    weight: number;
}

/** 与 web `PRIZES` 逐条一致（id / 礼包 / 权重）。权重合计 100。 */
export const WHEEL_PRIZES: WheelPrize[] = [
    { id: 'hint4', name: '提示券', count: '×4', label: '提示券 ×4', items: { hintToken: 4 }, weight: 22 },
    { id: 'undo3', name: '撤销', count: '×3', label: '撤销 ×3', items: { undoToken: 3 }, weight: 18 },
    { id: 'bomb2', name: '炸弹', count: '×2', label: '炸弹 ×2', items: { bombToken: 2 }, weight: 12 },
    { id: 'rainbow1', name: '彩虹', count: '×1', label: '彩虹 ×1', items: { rainbowToken: 1 }, weight: 8 },
    { id: 'coin50', name: '金币', count: '×50', label: '金币 ×50', items: { coin: 50 }, weight: 16 },
    { id: 'coin200', name: '金币', count: '×200', label: '金币 ×200', items: { coin: 200 }, weight: 6 },
    { id: 'trial12h', name: '皮肤试穿', count: '12h', label: '12h 限定皮肤试穿', items: {}, trialHours: 12, weight: 4 },
    // 第 8 段：小额金币安慰奖（承接 web "必有奖"设计）。
    { id: 'coin10', name: '金币', count: '×10', label: '金币 ×10', items: { coin: 10 }, weight: 14 },
];

/** 试穿皮肤池（对齐 web `luckyWheel.js` TRIAL_POOL）。 */
export const WHEEL_TRIAL_POOL = ['forbidden', 'demon', 'fairy', 'mahjong', 'aurora'];

export interface WheelResult {
    index: number;
    prize: WheelPrize;
}

/** 幸运转盘：按权重抽取（对齐 web `_pickPrize`）。 */
export function spinWheel(rng: Rng = defaultRng): WheelResult {
    const total = WHEEL_PRIZES.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    for (let i = 0; i < WHEEL_PRIZES.length; i++) {
        r -= WHEEL_PRIZES[i].weight;
        if (r < 0) return { index: i, prize: WHEEL_PRIZES[i] };
    }
    const last = WHEEL_PRIZES.length - 1;
    return { index: last, prize: WHEEL_PRIZES[last] };
}
