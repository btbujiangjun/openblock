/**
 * lifecycleStressCapMap.js — 玩家生命周期 (stage × band) → 出块 stress 调制表
 *
 * v1.50 抽取（原内嵌于 adaptiveSpawn.js L827-845）：把这张表从出块算法
 * 内部常量提升为公共契约，让 playerInsightPanel / strategyAdvisor / 文档
 * 都能读同一份数据；任何"调难度档"的运营改动只改本文件即可。
 *
 * === 表的语义 ===
 *
 *   key = `${stageCode}·${band}`，例如 'S3·M0'。
 *
 *   - stageCode（生命周期阶段，driven by daysSinceInstall + totalSessions
 *     + daysSinceLastActive，详见 retention/playerLifecycleDashboard.js）
 *       S0 新入场（onboarding，days≤3 且 sessions≤10）
 *       S1 激活  （exploration，days≤14 且 sessions≤50）
 *       S2 习惯  （growth，days≤30 且 sessions≤200）
 *       S3 稳定  （stability，days≤90 且 sessions≤500）
 *       S4 回流  （veteran 或 daysSinceLastActive≥7 的 winback 候选）
 *
 *   - band（成熟度 M-band，driven by SkillScore，见 retention/playerMaturity.js）
 *       M0 新手  （SkillScore  0–39）
 *       M1 成长  （SkillScore 40–59）
 *       M2 熟练  （SkillScore 60–79）
 *       M3 资深  （SkillScore 80–89）
 *       M4 核心  （SkillScore ≥ 90）
 *
 * === 调制语义 ===
 *
 *   每个 (stage·band) 配对给两个数值：
 *     - cap     当前 raw stress 的硬上限；超过即压回到 cap
 *     - adjust  上限处理后再施加的整体偏移（负值=进一步减压，正值=加压）
 *
 *   两个数值组合后写回 stress，再 clamp 到 [-0.2, 1]，下游：
 *     - 选 10 档 difficulty profile（adaptiveStress → interpolateProfileWeights）
 *     - spawnHints.clearGuarantee / sizePreference / multiClearBonus / spatialPressure
 *     - generateDockShapes 的两阶段加权抽样 + 序贯可解 DFS 阈值
 *
 * === 调表设计原则 ===
 *
 *   - S0 新入场 + S4 回流：均给最低 cap（0.50–0.60）+ 强负 adjust，保护新人 / 防流失。
 *   - S2/S3 高 band（M3/M4）：cap 抬到 0.85–0.88 + 正 adjust，让核心玩家有挑战感。
 *   - 每行（同 stage 内）从低 band 到高 band 单调递增，保证"成长有奖励"。
 *   - 每列（同 band 跨 stage）：S0/S4 弱、S2/S3 强，反映生命周期价值曲线。
 *
 * === 表外 fallback 行为 ===
 *
 *   未在表中出现的组合（如 S2·M4 / S3·M0）→ getLifecycleStressCap 返回
 *   null，调用方应跳过本调制（不应用 cap/adjust），避免硬编码兜底污染。
 */

/**
 * @typedef {Object} LifecycleStressCapEntry
 * @property {number} cap     stress 硬上限，[0, 1]
 * @property {number} adjust  cap 处理后的整体偏移，[-0.2, 0.2]
 */

/**
 * 完整 5×5 调制表。
 *
 * v1.55（BEST_SCORE_CHASE_STRATEGY §4.1）补全此前缺失的 8 格组合
 * （S0·M1+ / S2·M4 / S3·M0 / 等），消除"表外组合 → null → raw stress 直通"
 * 的死键问题。补全原则：
 *
 *   1. 行内单调（同 stage 内 M0→M4 cap 单调递增、adjust 单调上升）；
 *   2. 列内 S0/S4 弱（保护新人/回流），S2/S3 强（成长期/稳定期承受力强）；
 *   3. S0 行整体钳制在 cap ≤ 0.65（即便高 M-band 玩家在 onboarding 期也不应被压制）；
 *   4. S1 行延续 S0 弱保护风格但放开承受力上限；
 *   5. 新格的 cap/adjust 在相邻已知格之间线性插值，不破坏原有梯度。
 *
 * 历史值（v1.50 抽出时）的 17 格保留不变，避免影响已上线行为。
 */
/** @type {Readonly<Record<string, LifecycleStressCapEntry>>} */
export const LIFECYCLE_STRESS_CAP_MAP = Object.freeze({
    // S0 新入场：onboarding 期所有 band 都强保护
    'S0·M0': { cap: 0.50, adjust: -0.15 },   // 新手强保护
    'S0·M1': { cap: 0.55, adjust: -0.12 },   // v1.55 补：onboarding 期高频玩家
    'S0·M2': { cap: 0.58, adjust: -0.10 },   // v1.55 补：onboarding 期老带号
    'S0·M3': { cap: 0.62, adjust: -0.08 },   // v1.55 补：onboarding 期资深迁移
    'S0·M4': { cap: 0.65, adjust: -0.05 },   // v1.55 补：onboarding 期核心迁移（最严限）
    // S1 激活：探索期，允许 M-band 拉开承受力
    'S1·M0': { cap: 0.60, adjust: -0.10 },   // 探索期减压
    'S1·M1': { cap: 0.65, adjust: -0.05 },
    'S1·M2': { cap: 0.70, adjust:  0    },
    'S1·M3': { cap: 0.75, adjust:  0.04 },   // v1.55 补：探索期资深略加压
    'S1·M4': { cap: 0.78, adjust:  0.06 },   // v1.55 补：探索期核心可挑战
    // S2 习惯：成长期，PB 主战场，承受力按 M-band 显著分层
    'S2·M0': { cap: 0.65, adjust: -0.10 },   // 成长新手友好
    'S2·M1': { cap: 0.70, adjust:  0    },
    'S2·M2': { cap: 0.75, adjust:  0.05 },
    'S2·M3': { cap: 0.82, adjust:  0.10 },   // 高手可承受更高压力
    'S2·M4': { cap: 0.85, adjust:  0.11 },   // v1.55 补：成长期核心（与 S3·M3 接近）
    // S3 稳定：稳定期 + 资深 / 核心，PB 增长曲线最陡
    'S3·M0': { cap: 0.65, adjust: -0.05 },   // v1.55 补：稳定期回退到新手（罕见 case）
    'S3·M1': { cap: 0.72, adjust:  0    },
    'S3·M2': { cap: 0.78, adjust:  0.05 },
    'S3·M3': { cap: 0.85, adjust:  0.10 },
    'S3·M4': { cap: 0.88, adjust:  0.12 },   // 核心玩家
    // S4 回流：≥7 天未活跃，首要任务是"找回手感"
    'S4·M0': { cap: 0.55, adjust: -0.15 },   // 回流保护
    'S4·M1': { cap: 0.60, adjust: -0.10 },
    'S4·M2': { cap: 0.70, adjust:  0    },
    'S4·M3': { cap: 0.75, adjust:  0.05 },
    'S4·M4': { cap: 0.80, adjust:  0.08 },
});

/**
 * 所有合法 stage 代码（与 LIFECYCLE_STAGE_LABEL 对齐）。
 * v1.55：用于 getLifecycleStressCap 兜底校验与单测全格覆盖。
 */
export const LIFECYCLE_STAGE_CODES = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4']);

/**
 * 所有合法 band 代码（与 LIFECYCLE_BAND_LABEL 对齐）。
 */
export const LIFECYCLE_BAND_CODES = Object.freeze(['M0', 'M1', 'M2', 'M3', 'M4']);

/** Stage code → 中文短名（与 playerInsightPanel tooltip 一致：新入场/激活/习惯/稳定/回流） */
export const LIFECYCLE_STAGE_LABEL = Object.freeze({
    S0: '新入场',
    S1: '激活',
    S2: '习惯',
    S3: '稳定',
    S4: '回流',
});

/** Band code → 中文短名（与 playerInsightPanel tooltip 一致） */
export const LIFECYCLE_BAND_LABEL = Object.freeze({
    M0: '新手',
    M1: '成长',
    M2: '熟练',
    M3: '资深',
    M4: '核心',
});

/**
 * Stage code → 主题色（与 retention/playerLifecycleDashboard.js getLifecycleConfig
 * 的 stageColor 同源；S4 回流单独取 retention 红，区别于其他四档的暖色递进）。
 */
export const LIFECYCLE_STAGE_COLOR = Object.freeze({
    S0: '#4CAF50',  // 导入期 绿
    S1: '#2196F3',  // 探索期 蓝
    S2: '#9C27B0',  // 成长期 紫
    S3: '#FF9800',  // 稳定期 橙
    S4: '#F44336',  // 核心 / 回流 红
});

/** Band code → 阶梯色（M0 浅灰 → M4 金，与"技能等级"语义对齐） */
export const LIFECYCLE_BAND_COLOR = Object.freeze({
    M0: '#94A3B8',  // 新手 浅灰
    M1: '#22C55E',  // 成长 绿
    M2: '#0EA5E9',  // 熟练 蓝
    M3: '#A855F7',  // 资深 紫
    M4: '#F59E0B',  // 核心 金
});

/**
 * 查找 (stage, band) 对应的 cap/adjust。返回 null 表示该组合不在调制表内，
 * 调用方应跳过 stress cap/adjust，避免引入硬编码兜底。
 *
 * @param {string|null|undefined} stageCode  S0..S4
 * @param {string|null|undefined} band       M0..M4
 * @returns {LifecycleStressCapEntry | null}
 */
export function getLifecycleStressCap(stageCode, band) {
    if (!stageCode || !band) return null;
    return LIFECYCLE_STRESS_CAP_MAP[`${stageCode}·${band}`] || null;
}

/**
 * 给 UI 用的"出块影响"一句话摘要：把 cap/adjust 翻译成中文叙事，
 * 让运营 / QA 在画像面板上直接看到"当前阶段给出块设了什么上限/偏移"。
 *
 * @param {string|null|undefined} stageCode
 * @param {string|null|undefined} band
 * @returns {string}  形如 "压力上限 0.65 · 整体减压 -0.10（成长新手友好）"
 */
export function describeLifecycleStressCap(stageCode, band) {
    const entry = getLifecycleStressCap(stageCode, band);
    if (!entry) {
        return `${stageCode || 'S?'}·${band || 'M?'}：未在调制表内，按 raw stress 直通。`;
    }
    const adjustTxt =
        entry.adjust > 0 ? `整体加压 +${entry.adjust.toFixed(2)}`
        : entry.adjust < 0 ? `整体减压 ${entry.adjust.toFixed(2)}`
        : '无整体偏移';
    return `压力上限 ${entry.cap.toFixed(2)} · ${adjustTxt}`;
}
