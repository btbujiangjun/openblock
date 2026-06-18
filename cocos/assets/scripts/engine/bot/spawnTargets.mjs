/* 自动生成 —— 请勿手改。源：web/src/bot/spawnTargets.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * bot/spawnTargets.js — stress→算法多维难度区间派生器（v1.71 从 adaptiveSpawn.js 抽出）
 *
 * 单一职责：把 stress（玩家压力 raw 域 [-0.2, 1]）映射到一组算法约束区间
 *   { min, max, label }，供 blockSpawn 在 earlyAttempt 阶段对候选 triplet 做软过滤。
 *
 * 维度（11 项）：
 *   ① deriveTargetSolutionRange       — 解空间数量区间
 *   ② deriveTargetHoleIncrement       — 最干净路径新空洞数（v1.57.2 主维度）
 *   ③ deriveTargetMaxHoleIncrement    — 最差解新空洞数上界（v1.57.3 ①）
 *   ④ deriveTargetHoleIncrementGap    — 专注度税差距 max−min（⑨）
 *   ⑤ deriveTargetEndFillRatio        — 终末填充率（②）
 *   ⑥ deriveTargetNearFullDelta       — 近满 delta（③）
 *   ⑦ deriveTargetFirstMoveSurvivorRatio — 第一步存活率（④）
 *   ⑧ deriveTargetSolutionDiversity   — 解多样性 CV（⑤）
 *   ⑨ deriveTargetEndFlatness         — 终末平整度（⑥）
 *   ⑩ deriveTargetEndDangerColumns    — 终末危险列数（⑦）
 *   ⑪ deriveTargetVisualClutter       — 视觉杂乱 delta（⑧）
 *
 * 共同契约：
 *   - 纯函数；零模块状态；不依赖 GAME_RULES（cfg 由调用方注入）。
 *   - cfg.enabled / dimCfg.enabled / fill < activationFill 三道闸任意命中返回 null。
 *   - ranges 按 minStress 升序选最大 ≤stress 档；未命中保底取首档。
 *
 * **行为契约**：与抽出前严格一致（adaptiveSpawn.test.js 1346 行 + 全量 3259 用例守护）。
 */

/**
 * v1.57.1 — 解空间数量区间。
 * 与 v1.57.3 各维度同源结构，但 ranges 字段是 { min, max, label, minStress }（无嵌套 dimCfg）。
 *
 * @param {number} stress  raw 域 [-0.2, 1]
 * @param {object} cfg     adaptiveSpawn.solutionDifficulty
 * @param {number} fill    当前盘面填充率
 * @returns {{ min: number|null, max: number|null, label?: string } | null}
 */
export function deriveTargetSolutionRange(stress, cfg, fill) {
    if (!cfg?.enabled) return null;
    const activationFill = cfg.activationFill ?? 0.45;
    if ((fill ?? 0) < activationFill) return null;
    const ranges = Array.isArray(cfg.ranges) ? cfg.ranges : [];
    if (ranges.length === 0) return null;

    // ranges 按 minStress 升序，挑选 stress >= minStress 的最大档位
    const sorted = [...ranges].sort((a, b) => (a.minStress ?? -1) - (b.minStress ?? -1));
    let chosen = null;
    for (const r of sorted) {
        if (stress >= (r.minStress ?? -1)) chosen = r;
    }
    if (!chosen) chosen = sorted[0];
    return {
        min: chosen.min ?? null,
        max: chosen.max ?? null,
        label: chosen.label
    };
}

/**
 * v1.57.2 — 根据 stress 选择新空洞数难度档（与 targetSolutionRange 并列的第二维度）。
 *
 * 语义：blockSpawn 在 earlyAttempt 阶段对每个候选 triplet 计算 minHoleIncrement
 * （6 种放置顺序所有解的"最干净路径"新空洞数），按本函数返回的 { min, max } 区间软过滤。
 *   - max=0   → 候选必须存在 0 新空洞解（"必有干净放法"，玩家放心放）
 *   - max=N   → 候选最优解新空洞 ≤ N（允许少量空洞解）
 *   - min=N   → 候选最优解新空洞 ≥ N（"无论怎么放都会脏"，玩家被迫接受）
 *
 * 共享 cfg.activationFill 与 cfg.enabled——本函数只在解空间评估开启的前提下生效。
 *
 * @param {number} stress  raw 域 [-0.2, 1]
 * @param {object} cfg     adaptiveSpawn.solutionDifficulty（取其 holeIncrement 子节）
 * @param {number} fill    当前盘面填充率
 * @returns {{ min: number|null, max: number|null, label?: string } | null}
 */
export function deriveTargetHoleIncrement(stress, cfg, fill) {
    if (!cfg?.enabled) return null;
    const hi = cfg.holeIncrement;
    if (!hi?.enabled) return null;
    const activationFill = cfg.activationFill ?? 0.45;
    if ((fill ?? 0) < activationFill) return null;
    const ranges = Array.isArray(hi.ranges) ? hi.ranges : [];
    if (ranges.length === 0) return null;

    const sorted = [...ranges].sort((a, b) => (a.minStress ?? -1) - (b.minStress ?? -1));
    let chosen = null;
    for (const r of sorted) {
        if (stress >= (r.minStress ?? -1)) chosen = r;
    }
    if (!chosen) chosen = sorted[0];
    return {
        min: chosen.minIncrement ?? null,
        max: chosen.maxIncrement ?? null,
        label: chosen.label
    };
}

/* ================================================================== */
/*  v1.57.3 — 9 项 stress→算法 多维难度区间通用派生器                  */
/*                                                                    */
/*  与 deriveTargetSolutionRange / deriveTargetHoleIncrement 同源结构  */
/*  共享 cfg.activationFill 与 cfg.enabled；每个维度独立 enabled 开关  */
/*  ranges 字段约定：{ minStress, label, min, max }（min/max 均可 null）*/
/* ================================================================== */

/**
 * 通用 ranges → { min, max, label } 派生器。
 *
 * @param {number} stress       raw 域 [-0.2, 1]
 * @param {object} dimCfg       某一维度的子节，必须含 { enabled, ranges }
 * @param {object} parentCfg    父级 solutionDifficulty 节，提供 activationFill 兜底
 * @param {number} fill         当前盘面填充率
 * @returns {{ min: number|null, max: number|null, label?: string } | null}
 */
export function _deriveRangeByStress(stress, dimCfg, parentCfg, fill) {
    if (!parentCfg?.enabled) return null;
    if (!dimCfg?.enabled) return null;
    const activationFill = parentCfg.activationFill ?? 0.45;
    if ((fill ?? 0) < activationFill) return null;
    const ranges = Array.isArray(dimCfg.ranges) ? dimCfg.ranges : [];
    if (ranges.length === 0) return null;

    const sorted = [...ranges].sort((a, b) => (a.minStress ?? -1) - (b.minStress ?? -1));
    let chosen = null;
    for (const r of sorted) {
        if (stress >= (r.minStress ?? -1)) chosen = r;
    }
    if (!chosen) chosen = sorted[0];
    return {
        min: chosen.min ?? null,
        max: chosen.max ?? null,
        label: chosen.label
    };
}

/** v1.57.3 ① — 最差解新空洞数（专注度税上界）*/
export function deriveTargetMaxHoleIncrement(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.maxHoleIncrement, cfg, fill);
}
/** v1.57.3 ⑨ — 专注度税差距 = max − min */
export function deriveTargetHoleIncrementGap(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.holeIncrementGap, cfg, fill);
}
/** v1.57.3 ② — 终末填充率（空间窒息）*/
export function deriveTargetEndFillRatio(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endFillRatio, cfg, fill);
}
/** v1.57.3 ③ — 近满 delta（消行节律）*/
export function deriveTargetNearFullDelta(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.nearFullDelta, cfg, fill);
}
/** v1.57.3 ④ — 第一步存活率（试错代价）*/
export function deriveTargetFirstMoveSurvivorRatio(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.firstMoveSurvivor, cfg, fill);
}
/** v1.57.3 ⑤ — 解多样性 CV */
export function deriveTargetSolutionDiversity(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.solutionDiversity, cfg, fill);
}
/** v1.57.3 ⑥ — 终末平整度 */
export function deriveTargetEndFlatness(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endFlatness, cfg, fill);
}
/** v1.57.3 ⑦ — 终末危险列数 */
export function deriveTargetEndDangerColumns(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endDangerColumns, cfg, fill);
}
/** v1.57.3 ⑧ — 视觉杂乱 delta */
export function deriveTargetVisualClutter(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.visualClutter, cfg, fill);
}
