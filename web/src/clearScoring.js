/**
 * 消行计分与 bonus 检测（与对局、回放、RL 无头模拟器共用）。
 *
 * RL / 训练路径与主局对齐：计分倍率来自 `shared/game_rules.json` → `clearScoring`；
 * 无头局 icon 语义只来自 `rlBonusScoring.blockIcons`，避免 JS/Python 读取皮肤实现漂移。
 *
 * 注意：不要从本文件 import game.js，避免循环依赖。
 *
 * ─── 术语权威：「Combo」的两个独立维度（详见 docs/product/CLEAR_SCORING.md §〇）─────
 *   - **空间维度** `c` (= result.count) = 单次落子触发的「行+列」总数 → 影响 baseScore = baseUnit × c²；
 *     代码里很多旧字段把这叫 'combo'（如 game.js isCombo=c>=3、effectType='combo'、gameStats.maxCombo）
 *   - **时间维度** `_comboCount` = 当前 combo 链中已累计的清线次数（粉色爱心 ♥N），采用「带 grace 窗口的 chain 模型」：
 *       · 清线 → combo 启动/延续：_comboCount += 1（首次启动 = 1）
 *       · 0 ~ gracePlacements-1 步未清 → combo 不打断、♥N 常驻
 *       · 连续 ≥ gracePlacements 步未清 → combo「待断」，下次清线重置为 1
 *     → 进入 `computeClearScore(... comboCount)` 的第 4 参，产出 `comboMultiplier`；与 `c` 完全独立、可同时成立
 *   - 本文件的 `computeClearScore` 同时消费两个维度：clearScore = (base + iconBonus) × perfectMult × comboMult
 */
import { getStrategy } from './config.js';
import { GAME_RULES } from './gameRules.js';

/**
 * 在 clearEngine.apply() / grid.checkLines() **之前**（格子尚未被置 null）扫描
 * 满行/满列，判断是否全为同一 icon（优先）或同一 colorIdx（无 icon 皮肤）。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {{ blockIcons?: string[] }|null} skin
 * @returns {Array<{type:'row'|'col', idx:number, colorIdx:number, icon:string|null}>}
 */
export function detectBonusLines(grid, skin) {
    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = ci => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
    const result = [];

    for (let y = 0; y < n; y++) {
        const row = grid.cells[y];
        if (row.some(c => c === null)) continue;
        const icon0 = getIcon(row[0]);
        const allSame = icon0 !== null
            ? row.every(c => getIcon(c) === icon0)
            : row.every(c => c === row[0]);
        if (allSame) result.push({ type: 'row', idx: y, colorIdx: row[0], icon: icon0 });
    }

    for (let x = 0; x < n; x++) {
        const col = [];
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] === null) { col.length = 0; break; }
            col.push(grid.cells[y][x]);
        }
        if (!col.length) continue;
        const icon0 = getIcon(col[0]);
        const allSame = icon0 !== null
            ? col.every(c => getIcon(c) === icon0)
            : col.every(c => c === col[0]);
        if (allSame) result.push({ type: 'col', idx: x, colorIdx: col[0], icon: icon0 });
    }

    return result;
}

/**
 * 每条「差 1～2 格就满、且已占格同 icon / 同色」的行列给相关颜色加的采样权重（出块染色与加分目标对齐）。
 */
export const MONO_NEAR_FULL_COLOR_WEIGHT = 0.55;

/**
 * 扫描近满/已成型同色行/列：已填入部分若已为同一 icon（优先）或同色（无 icon），则提高对应颜色在本轮 dock 的出现概率。
 *
 * **v1.60.26 拓宽**：与 `Grid.bestMonoFlushPotential` 严格同口径——
 *   - 旧版：仅 `empty ∈ [1, 2]` 时加 bias（"立即兑现期"）
 *   - 新版：`empty ∈ [1, n-2]` 且已填部分全同 icon 时加 bias（覆盖 shape 占 K=1..n-2 cells 的所有同花潜力）
 *
 * **bias 衰减**：empty 越大（同花尚远）权重越低；empty=1/2 维持原 0.55，empty 增大时按 `0.55 × (n-2-empty)/(n-2-1)` 递减到 0.15 最小值，
 * 让"立即可兑现"线仍主导染色，"建设期同色线"在边际加 bias，避免染色 bias 过度集中导致 dock 颜色单调。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {{ blockIcons?: string[] } | null} [skin]
 * @returns {number[]} length 8
 */
export function monoNearFullLineColorWeights(grid, skin = null) {
    const w = new Array(8).fill(0);
    if (!grid?.cells) return w;

    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
    const dockSlot = (ci) => ((ci % 8) + 8) % 8;

    /** v1.60.26：根据 empty 数计算 bias 权重 — empty 越小（越近兑现）权重越大。
     *  分段：兑现期（empty ≤ 2）= 0.55；建设期（empty ∈ [3, n-2]）= 0.40 → 0.15 线性衰减。 */
    function biasFor(empty) {
        if (empty < 1 || empty > n - 2) return 0;
        if (empty <= 2) return MONO_NEAR_FULL_COLOR_WEIGHT;          /* 0.55 兑现期 */
        const buildupMaxBias = 0.40;
        const buildupMinBias = 0.15;
        const t = (empty - 3) / Math.max(1, n - 5);                  /* empty=3 → 0; empty=n-2 → 1 */
        return buildupMaxBias - (buildupMaxBias - buildupMinBias) * Math.max(0, Math.min(1, t));
    }

    /**
     * @param {number[]} filledVals row/col 上非 null 的 colorIdx（有序）
     * @param {number} biasWeight
     */
    function addWeightsForLine(filledVals, biasWeight) {
        if (filledVals.length === 0 || biasWeight <= 0) return;
        const icon0 = getIcon(filledVals[0]);
        const monoIcon = icon0 !== null && filledVals.every((c) => getIcon(c) === icon0);
        const monoColor = icon0 === null && filledVals.every((c) => c === filledVals[0]);
        if (!monoIcon && !monoColor) return;

        if (monoIcon) {
            const distinctDock = [...new Set(filledVals.map(dockSlot))];
            const share = biasWeight / distinctDock.length;
            for (const s of distinctDock) w[s] += share;
        } else {
            w[dockSlot(filledVals[0])] += biasWeight;
        }
    }

    for (let y = 0; y < n; y++) {
        const filled = [];
        for (let x = 0; x < n; x++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= n - 2) addWeightsForLine(filled, biasFor(empty));
    }

    for (let x = 0; x < n; x++) {
        const filled = [];
        for (let y = 0; y < n; y++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= n - 2) addWeightsForLine(filled, biasFor(empty));
    }

    return w;
}

/**
 * 三连块颜色：在 8 色中无放回加权抽样，偏置仍保持随机性（与纯洗牌相比略提高「急需色」占比）。
 *
 * @param {number[]} biasWeights length 8
 * @param {() => number} [rnd]
 * @returns {[number, number, number]}
 */
export function pickThreeDockColors(biasWeights, rnd = Math.random) {
    const bias = biasWeights || [];
    const pool = [0, 1, 2, 3, 4, 5, 6, 7];
    const out = [];
    for (let k = 0; k < 3; k++) {
        let total = 0;
        for (const c of pool) {
            total += 1 + (bias[c] || 0);
        }
        let r = rnd() * total;
        let chosen = pool[0];
        for (const c of pool) {
            r -= 1 + (bias[c] || 0);
            if (r <= 0) {
                chosen = c;
                break;
            }
        }
        out.push(chosen);
        pool.splice(pool.indexOf(chosen), 1);
    }
    return /** @type {[number, number, number]} */ (out);
}

/** 整行/列同色或同 icon：bonus 线在 UI 上按该倍数展示 */
export const ICON_BONUS_LINE_MULT = Number(GAME_RULES.clearScoring?.iconBonusLineMult) || 5;
export const PERFECT_CLEAR_MULT = Number(GAME_RULES.clearScoring?.perfectClearMult) || 10;

/** Combo 倍数与 grace 窗口默认配置（与 shared/game_rules.json → clearScoring.comboMultiplier 同源） */
export const COMBO_MULTIPLIER_CFG = (() => {
    const raw = GAME_RULES.clearScoring?.comboMultiplier;
    if (!raw || typeof raw !== 'object') return null;
    /* activationCount 是新名（语义=「combo count 达到此值起开始加成」），
     * activationStreak 是历史别名，仍支持以兼容旧配置文件。 */
    const activation = Number(raw.activationCount ?? raw.activationStreak ?? 3);
    return {
        enabled: raw.enabled !== false,
        /** 连续 ≥ gracePlacements 步未清线 → combo 进入「待断」态，下次清线重置为 1。
         *  1 = 严格连击（旧 _clearStreak 行为）；3 = 默认（缓冲 2 步） */
        gracePlacements: Math.max(1, Math.floor(Number(raw.gracePlacements) || 3)),
        activationCount: Math.max(1, Math.floor(activation)),
        /** @deprecated 用 activationCount，保留作历史兼容 */
        activationStreak: Math.max(1, Math.floor(activation)),
        stepBonus: Math.max(0, Number(raw.stepBonus) || 0),
        maxMultiplier: Math.max(1, Number(raw.maxMultiplier) || 1)
    };
})();

/**
 * 由「combo 链中累计清线次数」推导得分倍数（向后兼容：count<1 或 cfg.enabled=false 时恒返回 1）。
 *
 * 公式：`mult = clamp(1 + max(0, comboCount - activationCount + 1) × stepBonus, 1, maxMultiplier)`
 *
 * 默认配置 activation=3 / step=1 / max=2 时：comboCount 1~2 → ×1；comboCount ≥ 3 → ×2（cap）。
 * 调 max=4 / step=1 可放大为 ♥3 ×2、♥4 ×3、♥5+ ×4 的线性递增。
 *
 * ⚠️ **comboCount 由调用方按 grace 窗口逻辑维护**（见 deriveNextComboCount），本函数只做纯倍数映射；
 * 不要把"连续落子都消行的 streak"或"单手多消数 c"直接传进来——那是另外两个维度。
 *
 * @param {number} comboCount 当前 combo 链中累计清线次数（含本次落子的清线，由 grace 窗口决定是否重置）
 * @param {{ enabled?: boolean, activationCount?: number, activationStreak?: number, stepBonus?: number, maxMultiplier?: number }|null} [cfgOverride]
 * @returns {number} 倍数，恒 ≥ 1
 */
export function deriveComboMultiplier(comboCount, cfgOverride) {
    /* cfgOverride 语义区分：
     *   - undefined（默认） → 用 shared/game_rules.json 全局 COMBO_MULTIPLIER_CFG
     *   - null              → 显式禁用（回退 ×1，与 enabled=false 等价）
     *   - object            → 使用调用方提供的配置（回放/多端 init 帧）
     */
    const cfg = cfgOverride === undefined ? COMBO_MULTIPLIER_CFG : cfgOverride;
    if (!cfg || cfg.enabled === false) return 1;
    const n = Math.max(0, Math.floor(Number(comboCount) || 0));
    const activation = cfg.activationCount ?? cfg.activationStreak ?? 3;
    if (n < activation) return 1;
    const max = Math.max(1, Number(cfg.maxMultiplier) || 1);
    const step = Math.max(0, Number(cfg.stepBonus) || 0);
    const raw = 1 + (n - activation + 1) * step;
    return Math.min(max, Math.max(1, raw));
}

/**
 * 由「本步是否清线 + 此前已未清线步数」推导下一个 _comboCount（**grace 窗口判定的纯函数**）。
 *
 * 调用方在落子结算时按此公式更新 _comboCount，所有端（web/小程序/cocos/RL）共用同口径。
 *
 * @param {number} prevComboCount      落子前的 _comboCount（首次清线前应为 0）
 * @param {number} roundsSinceLastClear 落子前已累计的「未清线步数」（首次清线前应为 ∞ 或 ≥ grace）
 * @param {boolean} clearedThisPlacement 本步是否触发了清线（result.count > 0）
 * @param {{ enabled?: boolean, gracePlacements?: number }|null} [cfgOverride]
 * @returns {number} 下一个 _comboCount（若未清线 → 保持 prevComboCount；若清线但 grace 已过 → 1；若清线且 grace 内 → prev+1）
 */
export function deriveNextComboCount(prevComboCount, roundsSinceLastClear, clearedThisPlacement, cfgOverride) {
    const cfg = cfgOverride === undefined ? COMBO_MULTIPLIER_CFG : cfgOverride;
    if (!cfg || cfg.enabled === false) return 0;
    if (!clearedThisPlacement) return Math.max(0, Math.floor(Number(prevComboCount) || 0));
    const prev = Math.max(0, Math.floor(Number(prevComboCount) || 0));
    const gap = Math.max(0, Math.floor(Number(roundsSinceLastClear) || 0));
    const grace = Math.max(1, Math.floor(Number(cfg.gracePlacements) || 3));
    /* gap = 「上次清线之后、本步之前」累计的未清步数。
     * grace=3 时：gap ∈ {0,1,2} 视为「窗口内、combo 延续」；gap ≥ 3 视为「窗口已过、combo 已断、重启」。
     * 首次启动时 prev=0、gap=∞ → 视作 "重启"，返回 1（语义一致）。 */
    if (prev === 0) return 1;
    return gap >= grace ? 1 : prev + 1;
}

/**
 * 判断当前 combo 链是否处于「待断」态（爱心徽章应淡出）。
 * 当连续未清步数 ≥ gracePlacements 时返回 true，UI 据此清空爱心。
 */
export function isComboBroken(roundsSinceLastClear, cfgOverride) {
    const cfg = cfgOverride === undefined ? COMBO_MULTIPLIER_CFG : cfgOverride;
    if (!cfg || cfg.enabled === false) return true;
    const gap = Math.max(0, Math.floor(Number(roundsSinceLastClear) || 0));
    const grace = Math.max(1, Math.floor(Number(cfg.gracePlacements) || 3));
    return gap >= grace;
}

/** 同色/同 icon bonus：粒子 + UI 整段时长（目标约 3–5 秒） */
export function bonusEffectHoldMs(bonusCount) {
    if (bonusCount <= 0) return 0;
    return Math.min(5000, Math.max(3000, 3000 + bonusCount * 400));
}

/**
 * @param {string} strategyId
 * @param {{ count: number, bonusLines?: Array<unknown>, perfectClear?: boolean }} result
 * @param {{ singleLine?: number, multiLine?: number, combo?: number, comboMultiplier?: object }|null} [scoringOverride] 回放等场景使用 init 帧内嵌的 scoring，避免与当前策略默认值漂移
 * @param {number} [comboCount=0] 当前 combo 链中累计清线次数（含本次落子的清线，由调用方按 grace 窗口维护，见 `deriveNextComboCount`）。0/1 不加成；≥ activationCount 触发 ×comboMult
 * @returns {{ baseScore: number, iconBonusScore: number, clearScore: number, comboMultiplier: number }}
 */
export function computeClearScore(strategyId, result, scoringOverride, comboCount = 0) {
    const scoring = scoringOverride && typeof scoringOverride === 'object'
        ? scoringOverride
        : getStrategy(strategyId).scoring;
    const c = result?.count ?? 0;
    const baseUnit = scoring.singleLine ?? 20;
    const baseScore = c > 0 ? baseUnit * c * c : 0;

    const bonusLines = result?.bonusLines || [];
    const bonusCount = bonusLines.length;
    if (c <= 0) return { baseScore, iconBonusScore: 0, clearScore: baseScore, comboMultiplier: 1 };
    const effectiveBonusCount = Math.min(bonusCount, c);
    const lineScore = baseUnit * c;
    const iconBonusScore = lineScore * effectiveBonusCount * (ICON_BONUS_LINE_MULT - 1);
    const subtotal = baseScore + iconBonusScore;
    const perfectMult = result?.perfectClear ? PERFECT_CLEAR_MULT : 1;
    /* 连击倍数：clearScoring.comboMultiplier 可整体禁用以退化为旧行为；scoringOverride
     * 优先（回放 / 多端 init 帧自带），否则走 shared/game_rules.json 全局默认。 */
    const comboCfg = scoringOverride && typeof scoringOverride.comboMultiplier === 'object'
        ? scoringOverride.comboMultiplier
        : COMBO_MULTIPLIER_CFG;
    const comboMultiplier = deriveComboMultiplier(comboCount, comboCfg);
    return {
        baseScore,
        iconBonusScore,
        clearScore: subtotal * perfectMult * comboMultiplier,
        comboMultiplier
    };
}
