/**
 * 计分/规则常量（引擎无关）。对齐 web 主局 clearScoring 口径的最小子集。
 * 后续接入完整 gameRules 时，只需替换此处的取值来源。
 */
export interface ComboMultiplierConfig {
    enabled: boolean;
    /** 连续 ≥ gracePlacements 步未清线 → combo 进入"待断"，下次清线重置为 1。
     *  1 = 严格连击；3 = 默认（缓冲 2 步）。 */
    gracePlacements: number;
    activationCount: number;
    /** @deprecated 使用 activationCount；保留作历史兼容 */
    activationStreak?: number;
    stepBonus: number;
    maxMultiplier: number;
}

export interface ScoringConfig {
    singleLine: number;
    placeUnit: number;
    iconBonusLineMult: number;
    perfectClearMult: number;
    /** 连击倍数（与 shared/game_rules.json clearScoring.comboMultiplier 同口径）；
     * 缺省时退化为旧的无连击倍数行为（mult=1）。 */
    comboMultiplier?: ComboMultiplierConfig | null;
}

export const DEFAULT_COMBO_MULTIPLIER: ComboMultiplierConfig = {
    enabled: true,
    gracePlacements: 3,
    activationCount: 3,
    activationStreak: 3,
    stepBonus: 1.0,
    /* max=4 与 shared/game_rules.json 同源：♥3 ×2 / ♥4 ×3 / ♥5+ ×4 线性递增，
     * 避免旧 max=2 在 ♥≥3 后倍数永远封顶 ×2 的"看似没变化"现象。 */
    maxMultiplier: 4.0,
};

export const DEFAULT_SCORING: ScoringConfig = {
    singleLine: 20,
    // 与 web 对齐：落子本身不计分，分数仅来自消行（web/src/game.js 只在消行时 score += clearScore）。
    placeUnit: 0,
    iconBonusLineMult: 5,
    perfectClearMult: 10,
    comboMultiplier: DEFAULT_COMBO_MULTIPLIER,
};

export const MONO_NEAR_FULL_COLOR_WEIGHT = 0.55;

export const BOARD_SIZE = 8;
export const DOCK_SLOTS = 3;
