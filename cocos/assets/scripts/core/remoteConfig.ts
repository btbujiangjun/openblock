/**
 * RemoteConfig + FeatureFlags（Phase P1）—— 引擎无关。
 *
 * 默认值内置，运行期可 `applyRemote(json)` 合并（来自微信云 / 你的 API / CDN），
 * 实现「不发版调数值与开关」。所有玩法/变现数值都应从这里取，便于 A/B 与运营。
 */

export interface GameConfig {
    /** 全平台统一应用 id（与 mobile 套壳 capacitor.config.json appId 一致，用于变现/统计归因）。 */
    appId: string;
    /** 复活花费金币（随复活次数递增：cost * (n+1)） */
    reviveCostCoins: number;
    /** 每局最多复活次数 */
    reviveMaxPerGame: number;
    /** 结算宝箱基础金币 */
    chestBaseCoins: number;
    /** 结算宝箱按分数加成系数（coins += floor(score * k)） */
    chestScoreFactor: number;
    /** 幸运转盘奖励池（金币数组，等概率） */
    wheelRewards: number[];
    /** 首胜金币加成倍率 */
    firstWinMultiplier: number;
    /** 每日签到基础奖励 */
    checkinBaseCoins: number;
    /** 连签第 7 天额外奖励 */
    checkinWeekBonus: number;
    /** 升级每级所需经验基数（need = base * level） */
    xpPerLevelBase: number;
    /** 微信激励视频广告位 id（按 placement） */
    adUnitIds: Record<string, string>;
    /** IAP 商品表 */
    iapProducts: Record<string, { coins: number; priceCNY: number }>;
}

export interface FeatureFlags {
    revive: boolean;
    rewards: boolean;
    wheel: boolean;
    modes: boolean;
    share: boolean;
    leaderboard: boolean;
    seasonPass: boolean;
    cloudSave: boolean;
    analytics: boolean;
    bgm: boolean;
    rlSpawn: boolean;
    /** 方块用 sprite 贴图渲染（art/block）；关闭或贴图缺失时回退纯代码 Graphics 渲染。 */
    spriteBlocks: boolean;
}

const DEFAULT_CONFIG: GameConfig = {
    appId: 'com.openblock.game',
    reviveCostCoins: 30,
    reviveMaxPerGame: 3,
    chestBaseCoins: 15,
    chestScoreFactor: 0.02,
    wheelRewards: [10, 20, 30, 50, 80, 120, 200, 5],
    firstWinMultiplier: 2,
    checkinBaseCoins: 10,
    checkinWeekBonus: 50,
    xpPerLevelBase: 100,
    adUnitIds: {
        revive: '',
        doubleChest: '',
        wheel: '',
        reroll: '',
    },
    iapProducts: {
        coins_60: { coins: 60, priceCNY: 6 },
        coins_300: { coins: 330, priceCNY: 30 },
        coins_680: { coins: 800, priceCNY: 68 },
        noads: { coins: 0, priceCNY: 12 },
    },
};

const DEFAULT_FLAGS: FeatureFlags = {
    revive: true,
    rewards: true,
    wheel: true,
    /** 玩法模式切换（禅/闪电等）：web 主菜单无入口，Cocos 休闲壳默认关闭。 */
    modes: false,
    share: true,
    leaderboard: true,
    seasonPass: true,
    cloudSave: true,
    analytics: true,
    bgm: true,
    rlSpawn: false,
    spriteBlocks: true,
};

let _config: GameConfig = { ...DEFAULT_CONFIG };
let _flags: FeatureFlags = { ...DEFAULT_FLAGS };

export function getConfig(): GameConfig {
    return _config;
}

export function getFlags(): FeatureFlags {
    return _flags;
}

export function flag(name: keyof FeatureFlags): boolean {
    return _flags[name];
}

/** 合并远程下发（部分字段即可）。容错：非对象忽略。 */
export function applyRemote(remote: { config?: Partial<GameConfig>; flags?: Partial<FeatureFlags> } | null): void {
    if (!remote || typeof remote !== 'object') return;
    if (remote.config) _config = { ..._config, ...remote.config, adUnitIds: { ..._config.adUnitIds, ...(remote.config.adUnitIds || {}) }, iapProducts: { ..._config.iapProducts, ...(remote.config.iapProducts || {}) } };
    if (remote.flags) _flags = { ..._flags, ...remote.flags };
}

export function resetConfigForTest(): void {
    _config = { ...DEFAULT_CONFIG };
    _flags = { ...DEFAULT_FLAGS };
}
