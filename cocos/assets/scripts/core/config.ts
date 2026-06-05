/**
 * 计分/规则常量（引擎无关）。对齐 web 主局 clearScoring 口径的最小子集。
 * 后续接入完整 gameRules 时，只需替换此处的取值来源。
 */
export interface ScoringConfig {
    singleLine: number;
    placeUnit: number;
    iconBonusLineMult: number;
    perfectClearMult: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
    singleLine: 20,
    // 与 web 对齐：落子本身不计分，分数仅来自消行（web/src/game.js 只在消行时 score += clearScore）。
    placeUnit: 0,
    iconBonusLineMult: 5,
    perfectClearMult: 10,
};

export const MONO_NEAR_FULL_COLOR_WEIGHT = 0.55;

export const BOARD_SIZE = 8;
export const DOCK_SLOTS = 3;
