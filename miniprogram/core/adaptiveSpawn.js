/**
 * 自适应出块策略引擎（三层架构）
 *
 * 综合多维信号计算 adaptiveStress + spawnHints，在 10 档出块权重 profile
 * 间线性插值，并向 blockSpawn.js 传递精细控制提示。
 *
 * === 信号维度 ===
 *   1. scoreStress       分数驱动的基础压力
 *   2. runStreakStress    连战加成
 *   3. skillAdjust       高手加压 / 新手减压（置信度门控）
 *   4. flowAdjust        无聊 +δ / 焦虑 -δ / 心流 0
 *   5. pacingAdjust      节奏张弛（tension +δ / release -δ）
 *   6. recoveryAdjust    板面快满时短期降压
 *   7. frustrationRelief 连续无消行 → 降压
 *   8. comboReward       连续 combo → 轻微加压（正反馈）
 *   9. trendAdjust       长周期趋势
 *  10. confidenceGate    置信度低时收窄调节
 *
 * === Layer 2 新增 spawnHints ===
 *   comboChain      (0~1)  combo 链强度 → blockSpawn 偏好续链块
 *   multiClearBonus (0~1)  多消鼓励 → blockSpawn 偏好多行同消块
 *   multiLineTarget (0|1|2) v10.33：显式「多线兑现」目标强度 → blockSpawn 加权 multiClear≥2
 *   rhythmPhase     'setup'|'payoff'|'neutral'  出块节奏相位
 *
 * === Layer 3 新增 spawnHints ===
 *   sessionArc          'warmup'|'peak'|'cooldown'  单局弧线
 *   scoreMilestone      boolean  是否刚达到局内分数里程碑（区别于跨局成熟度里程碑）
 *   scoreMilestoneValue number|null  当 scoreMilestone=true 时给出具体跨过的分数档
 *
 * v1.49：字段命名统一——内部 `_milestoneHit` 重命名为 `_scoreMilestoneHit`；
 *         "里程碑表"改为按 ctx.bestScore 派生的相对档位（见 deriveScoreMilestones）。
 *         注意与 retention/maturityMilestones.js 中的「成熟度晋升里程碑」是完全不同的概念。
 *
 * 当 adaptiveSpawn.enabled=false 时透传 resolveLayeredStrategy。
 */

const { getStrategy } = require('./config');
const { GAME_RULES } = require('./gameRules');
let _softDeps_platformProfile = {}; try { _softDeps_platformProfile = require('./config/platformProfile'); } catch (_e) { /* miniprogram 不分发 config/ 子目录，软依赖回退空骨架 */ } const { pickByPlatform } = _softDeps_platformProfile;
const {
    getSpawnStressFromScore,
    getRunDifficultyModifiers,
    resolveLayeredStrategy,
    deriveEffectivePb
} = require('./difficulty');
const { buildPlayerAbilityVector } = require('./playerAbilityModel');
const { analyzeBoardTopology } = require('./boardTopology');
const { getAllShapes } = require('./shapes');
const { analyzePerfectClearSetup } = require('./bot/blockSpawn');
let _softDeps_playerLifecycleDashboard = {}; try { _softDeps_playerLifecycleDashboard = require('./retention/playerLifecycleDashboard'); } catch (_e) { /* miniprogram 不分发 retention/ 子目录，软依赖回退空骨架 */ } const { getLifecycleMaturitySnapshot } = _softDeps_playerLifecycleDashboard;
let _softDeps_lifecycleSignals = {}; try { _softDeps_lifecycleSignals = require('./lifecycle/lifecycleSignals'); } catch (_e) { /* miniprogram 不分发 lifecycle/ 子目录，软依赖回退空骨架 */ } const { getCachedLifecycleSnapshot } = _softDeps_lifecycleSignals;
/* v1.48：winback 保护包接入；通过 lifecycleOrchestrator 包装层避免直接依赖
 * retention 模块（保持单向依赖：spawn 层 → lifecycle 编排层 → retention 模块）。 */
let _softDeps_lifecycleOrchestrator = {}; try { _softDeps_lifecycleOrchestrator = require('./lifecycle/lifecycleOrchestrator'); } catch (_e) { /* miniprogram 不分发 lifecycle/ 子目录，软依赖回退空骨架 */ } const { getActiveWinbackPreset } = _softDeps_lifecycleOrchestrator;
/* v1.50：lifecycleStressCapMap 抽到独立模块，与 playerInsightPanel /
 * 文档共用 single source of truth；本地不再保留副本，避免漂移。 */
let _softDeps_lifecycleStressCapMap = {}; try { _softDeps_lifecycleStressCapMap = require('./lifecycle/lifecycleStressCapMap'); } catch (_e) { /* miniprogram 不分发 lifecycle/ 子目录，软依赖回退空骨架 */ } const { getLifecycleStressCap, resolveArcLifecycleModifier } = _softDeps_lifecycleStressCapMap;
let _softDeps_math = {}; try { _softDeps_math = require('./lib/math'); } catch (_e) { /* miniprogram 不分发 lib/ 子目录，软依赖回退空骨架 */ } const { clamp01 } = _softDeps_math;

/* ------------------------------------------------------------------ */
/*  v1.17：harvest / payoff 触发的最低占用率门槛
 *
 * pcSetup（perfect-clear setup 候选数）在低占用盘面上经常 ≥1（12 格散布
 * 也能凑出"某 3 块组合可清屏"的解），但这并不是"密集消行机会"，把
 * spawnIntent 拉到 'harvest' 或 rhythmPhase 拉到 'payoff' 都会让 UI 撒谎。
 * 要求 fill ≥ PC_SETUP_MIN_FILL 才允许把 pcSetup 单独当成兑现窗口。
 */
const PC_SETUP_MIN_FILL = 0.45;

/* ------------------------------------------------------------------ */
/*  v1.55.17：stress 对外归一化（B-Clean）                              */
/*
 * 历史背景：内部 stress 标量值域为 [-0.2, 1]（17 个分量带符号求和后 clamp）；
 * 但 [-0.2, 1] 对外暴露给玩家面板 / 运营看板 / 策略卡 / DFV / 文档时不直观
 * （"-0.20 表示什么？"），且与"压力指数"通常的 [0,1] 心智模型不一致。
 *
 * 决策（详见 docs/algorithms/ADAPTIVE_SPAWN.md §3.5 与 docs/algorithms/REALTIME_STRATEGY.md
 * 的「stress 域口径」章节）：
 *   - 算法内部全过程保持 raw 域 [-0.2, 1] 不变（不动 17 个 delta 常数、25+ 比较阈值、
 *     profile 锚点、lifecycle cap 表、game_rules.json 配置等）；
 *   - 所有「对外暴露」的字段（_adaptiveStress / insight.stress / DFV / 面板 / 策略卡
 *     toast）统一归一化为 [0, 1]：display = (raw + 0.2) / 1.2；
 *   - 内部状态字段（_adaptiveStressRaw）继续以 raw 域返回，供 game.js 的
 *     prevAdaptiveStress 平滑链路、spawnModel.js 的 ML 推理（按 raw 训练）等
 *     "保持训练时分布"的下游使用，避免域错位。
 *
 * 数学：normalizeStress(raw) = clamp01((raw + 0.2) / 1.2)
 *   raw = -0.2  →  norm = 0       （完全减压）
 *   raw =  0    →  norm = 1/6 ≈ 0.1667（baseline / 中性，对应 _stressTarget=0.325 之前
 *                                        的「无任何 adjust」起点）
 *   raw =  0.5  →  norm ≈ 0.5833  （中度加压）
 *   raw =  0.7  →  norm = 0.75    （challengeBoost 饱和门槛）
 *   raw =  0.79 →  norm = 0.825   （flowPayoffStressCap，兑现窗口硬顶）
 *   raw =  0.85 →  norm = 0.875   （challengeBoost 上限）
 *   raw =  1    →  norm = 1       （全局硬顶）
 *
 * 调参提示：源码内部 if/min/max 处的阈值（如 `stress < 0.7`）保留 raw 写法，旁边
 * 加 "raw 0.7 ≈ norm 0.75" 行内注释（不写在 JSDoc 内以避免注释结束符嵌套），
 * 让源码读者即刻反查对外口径。
 */
const STRESS_NORM_OFFSET = 0.2;
const STRESS_NORM_SCALE = 1.2;

function normalizeStress(raw) {
    const n = (Number(raw) + STRESS_NORM_OFFSET) / STRESS_NORM_SCALE;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function denormalizeStress(norm) {
    const r = Number(norm) * STRESS_NORM_SCALE - STRESS_NORM_OFFSET;
    if (!Number.isFinite(r)) return 0;
    return Math.max(-0.2, Math.min(1, r));
}

/* ------------------------------------------------------------------ */
/*  profile 插值                                                       */
/* ------------------------------------------------------------------ */

function interpolateProfileWeights(profiles, stress) {
    const sorted = [...profiles].sort((a, b) => a.stress - b.stress);
    if (sorted.length === 0) return {};
    if (stress <= sorted[0].stress) return { ...sorted[0].shapeWeights };
    if (stress >= sorted[sorted.length - 1].stress) return { ...sorted[sorted.length - 1].shapeWeights };

    let lower = sorted[0];
    let upper = sorted[1];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].stress >= stress) {
            lower = sorted[i - 1];
            upper = sorted[i];
            break;
        }
    }

    const span = upper.stress - lower.stress;
    const t = span > 0 ? (stress - lower.stress) / span : 0;
    const keys = new Set([...Object.keys(lower.shapeWeights), ...Object.keys(upper.shapeWeights)]);
    const result = {};
    for (const k of keys) {
        const a = lower.shapeWeights[k] ?? 1;
        const b = upper.shapeWeights[k] ?? 1;
        result[k] = a + (b - a) * t;
    }
    return result;
}

function _signalScale(signalCfg, name) {
    const spec = signalCfg?.[name];
    if (spec?.enabled === false) return 0;
    return Number.isFinite(spec?.scale) ? spec.scale : 1;
}

/**
 * 应用 signalCfg 的 scale 缩放 + 可选的"全局值域归一"clampAbs。
 *
 * v1.62.5（优化建议 #1）：增加 `signalCfg.__normalizeBudget` 全局上限选项。
 *
 *   game_rules.json:
 *     "adaptiveSpawn": { "signalCfg": { "__normalizeBudget": 0.05 } }
 *
 *   作用：对所有 *Adjust 类分量统一加 |x| ≤ 0.05 钳制，让 pacingAdjust（默认 ±0.12）、
 *   sessionArcAdjust 等强势分量不再压制 flowAdjust / reactionAdjust 等弱信号，
 *   stress 真正变成"多源驱动"。
 *
 *   默认值 = null 即关闭：保持现有行为完全不变。开启需在 game_rules 显式配置。
 *
 *   不在 normalize 范围内的分量（属于"宏调"信号，本就该有更大幅度）：
 *     - difficultyBias  ←  玩家选难度直接产生的基线偏移
 *     - challengeBoost  ←  接近 PB 时的明确加压
 *     - scoreStress / runStreakStress  ←  分数/连战的累积压力
 *     - friendlyBoardRelief / recoveryAdjust / frustrationRelief
 *       ←  救济类信号本就需要 -0.15 ~ -0.20 量级才能"压住"难度
 */
const _NORMALIZE_EXEMPT = new Set([
    'difficultyBias', 'challengeBoost',
    'scoreStress', 'runStreakStress', 'skillAdjust',
    'friendlyBoardRelief', 'recoveryAdjust', 'frustrationRelief',
    /* nearMissAdjust 是"差一点就消"的强反馈信号，设计上需要 ≤-0.10 才能让玩家感受到
     * 救济（test 1175 期望 < -0.05），加入豁免保留原始幅度。 */
    'nearMissAdjust',
    'preFrustrationRelief', 'boardFrustrationRelief', 'decisionLoadRelief',
    'feedbackBiasDampingAdjust',
    'returningWarmupAdjust', 'lifecycleCapAdjust', 'lifecycleBandAdjust',
    'onboardingStressOverrideAdjust', 'endSessionDistress',
    'boardRiskReliefAdjust', 'delightStressAdjust', 'motivationStressAdjust',
    'accessibilityStressAdjust', 'bottleneckRelief',
]);

function applySignal(signalCfg, name, value) {
    const scaled = value * _signalScale(signalCfg, name);
    const budget = Number(signalCfg?.__normalizeBudget);
    if (Number.isFinite(budget) && budget > 0 && !_NORMALIZE_EXEMPT.has(name)) {
        return Math.max(-budget, Math.min(budget, scaled));
    }
    return scaled;
}

function _bestMultiClearPotential(grid, shapeData) {
    if (!grid || !shapeData) return 0;
    let best = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            const outcome = grid.previewClearOutcome?.(shapeData, x, y, 0);
            if (!outcome) continue;
            best = Math.max(best, (outcome.rows?.length ?? 0) + (outcome.cols?.length ?? 0));
            if (best >= 2) return best;
        }
    }
    return best;
}

function _countMultiClearCandidatesFromShapePool(grid, shapePool) {
    if (!grid || !Array.isArray(shapePool) || shapePool.length === 0) return null;
    let count = 0;
    for (const shape of shapePool) {
        if (_bestMultiClearPotential(grid, shape.data) >= 2) count++;
    }
    return count;
}

/**
 * v1.25：spawn 决策前优先用“当前盘面”重算几何信号，减少 ctx 快照时序滞后。
 * - nearFullLines：来自 analyzeBoardTopology(grid)
 * - multiClearCandidates：优先按当前 dock 三块；dock 不可用时回退全形状库
 * - pcSetup（v1.57.4 补漏）：来自 analyzePerfectClearSetup(grid)；旧实现只刷新 nfl/mcc
 *   把 pcSetup 留在快照上，导致 17% 散布盘面玩家消行后 spawnIntent='harvest' 仍命中
 *   `pcSetup ≥1 && fill ≥ 0.45` 分支（fill 也只有 mergeLiveGeometrySignals 没刷新）。
 *
 * @param {object} ctx
 * @returns {object}
 */
function _mergeLiveGeometrySignals(ctx) {
    const grid = ctx?._gridRef;
    if (!grid?.cells?.length || !Number.isFinite(grid.size)) return ctx;
    let next = ctx;
    /* v1.60.1：adaptiveSpawn 是"玩家失误评估"链路，独立库块产生的孤岛豁免 */
    const topo = analyzeBoardTopology(grid, { skipSpecialCells: true });
    if (Number.isFinite(topo?.nearFullLines)) {
        next = { ...next, nearFullLines: topo.nearFullLines };
    }
    const dockPool = Array.isArray(ctx?._dockShapePool)
        ? ctx._dockShapePool
            .filter((s) => Array.isArray(s?.data))
            .map((s) => ({ data: s.data }))
        : [];
    const shapePool = dockPool.length > 0 ? dockPool : getAllShapes();
    const liveMcc = _countMultiClearCandidatesFromShapePool(grid, shapePool);
    if (Number.isFinite(liveMcc)) {
        next = { ...next, multiClearCandidates: liveMcc };
    }
    /* v1.57.4：pcSetup 也实时重算。它进入两个口径：
     *   (a) deriveSpawnIntent 的 harvestable 判定（与 nfl 并列）
     *   (b) deriveSpawnTargets 的 perfectClearOpportunity 加权
     * 不重算会让"上次 spawn 时 pcSetup=1"的快照一直驻留，玩家消行后 fill < 0.45
     * 仍可能误命中 harvest 分支（虽被 PC_SETUP_MIN_FILL 拦住一部分，但 fill 自身
     * 是 _boardFill 入参的实时值，pcSetup 不重算就让两者口径不对齐）。 */
    try {
        const livePc = analyzePerfectClearSetup(grid);
        if (Number.isFinite(livePc)) {
            next = { ...next, pcSetup: livePc };
        }
    } catch {
        // pcSetup 重算失败不影响主流程（旧 ctx.pcSetup 兜底）
    }
    return next;
}

/**
 * v1.57.4：spawnIntent 派生纯函数（从 resolveAdaptiveStrategy in-line 块抽出）。
 *
 * 抽出动机：让 game.js 能在【玩家每次放置后】用同一套逻辑增量重算 spawnIntent，
 * 解决 DFV "盘面具备消行机会" / stressMeter "识别到密集消行机会" 与玩家实时
 * 操作后盘面（已消行 / 已变化）严重错位的"快照滞后"问题。
 *
 * 优先级（自高到低）：
 *   1. relief    — playerDistress<-0.10 ∨ delightMode='relief' ∨ forceReliefIntent
 *   2. engage    — afkEngageActive（玩家停顿但状态尚可）
 *   3. harvest   — geometry.nearFullLines≥2 ∨ (geometry.pcSetup≥1 ∧ boardFill≥pcSetupMinFill)
 *   4. pressure  — challengeBoost>0 ∨ (delightMode='challenge_payoff' ∧ stress≥0.55)
 *   5. sprint    — sprintCfg.enabled ∧ stress∈[sprintMin, sprintMax)
 *   6. flow      — delightMode='flow_payoff' ∨ rhythmPhase='payoff'
 *   7. maintain  — 默认中性
 *
 * 设计原则：
 * - 纯函数（无副作用），所有依赖通过 inputs 传入。
 * - 几何敏感字段（nearFullLines / pcSetup / boardFill）放在 inputs.geometry 子对象，
 *   方便 game.js 增量刷新时只换 geometry 而保留决策侧不变量。
 * - 决策侧不变量（playerDistress / forceReliefIntent / delightMode / stress / 等）
 *   在 spawn 决策时一次计算、写入 _lastAdaptiveInsight._intentInputs；
 *   _refreshIntentSnapshot 仅以实时 geometry 配合这些不变量重判 intent。
 *
 * @param {object} inputs
 * @returns {'relief'|'engage'|'harvest'|'pressure'|'sprint'|'flow'|'maintain'}
 */
function deriveSpawnIntent(inputs = {}) {
    const {
        playerDistress = 0,
        forceReliefIntent = false,
        delightStarved = false,        // v1.60.45：爽感饥渴（playerProfile.isDelightStarved()）
        pbChasePressureActive = false, // v1.61：接近/超越 PB 时加压优先级高于救济
        afkEngageActive = false,
        challengeBoost = 0,
        delightMode = null,
        rhythmPhase = 'neutral',
        stress = 0,
        sprintCfg = {},
        geometry = {},
        pcSetupMinFill = PC_SETUP_MIN_FILL,
        /* v1.62.5（优化建议 #5）：滞回参数（opt-in） */
        prevIntent = null,         // 上一帧的 spawnIntent
        hysteresis = null,         // { enabled, sprintExpand, sprintShrink, reliefMargin }
    } = inputs;

    const nearFullForIntent = Number(geometry?.nearFullLines) || 0;
    const pcSetupForIntent = Number(geometry?.pcSetup) || 0;
    const boardFillForIntent = Number(geometry?.boardFill) || 0;

    const sprintEnabled = sprintCfg?.enabled !== false;
    let sprintMin = Number.isFinite(sprintCfg?.minStress) ? sprintCfg.minStress : 0.45;
    let sprintMax = Number.isFinite(sprintCfg?.maxStress) ? sprintCfg.maxStress : 0.55;

    /* v1.62.5（优化建议 #5）+ v1.62.7：spawnIntent 滞回。
     *
     * 背景：INTENT_THRASHING 巡检显示真实切换 78% 局违规，且 hysteresis 0.05 仍不够。
     * 真正根因不只是 sprint 边界，更主要是 `harvestable` 几何状态在 nearFullLines 1↔2
     * 之间频繁切换 → harvest ↔ maintain/flow 频繁切。
     *
     * v1.62.7 三处滞回：
     *   1) sprintExpand/Shrink     ← v1.62.5 已有，控制 sprint 区间
     *   2) reliefMargin            ← v1.62.5 已有，控制 playerDistress 阈值
     *   3) harvestStickyMode       ← v1.62.7 新增，prevIntent=harvest 时降低保持阈值
     *      ↓ 进入 harvest 需要 nearFullLines>=2 (原阈值)
     *      ↓ 但 prev=harvest 时只要 >=1 就保持，避免 harvest↔其他来回切
     */
    const hysteresisOn = hysteresis?.enabled === true;
    if (hysteresisOn && sprintEnabled) {
        const expand = Number.isFinite(hysteresis.sprintExpand) ? hysteresis.sprintExpand : 0.02;
        const shrink = Number.isFinite(hysteresis.sprintShrink) ? hysteresis.sprintShrink : 0.02;
        if (prevIntent === 'sprint') {
            sprintMin -= expand;
            sprintMax += expand;
        } else {
            sprintMin += shrink;
            sprintMax -= shrink;
        }
    }
    const effectiveDistressThreshold = (hysteresisOn && prevIntent === 'relief')
        ? -0.10 + (Number.isFinite(hysteresis.reliefMargin) ? hysteresis.reliefMargin : 0.02)
        : -0.10;

    /* v1.62.7：harvestable 滞回 —— 进入门槛 strict（≥2），保持门槛 lenient（≥1）。
     * 单独 stickyMode 可配（默认跟随 hysteresisEnabled）。 */
    const harvestStickyMode = hysteresisOn && hysteresis.harvestStickyMode !== false;
    const harvestEnterMin = 2;
    const harvestKeepMin = harvestStickyMode && prevIntent === 'harvest' ? 1 : 2;
    const harvestable = nearFullForIntent >= harvestKeepMin
        || (pcSetupForIntent >= 1
            && (boardFillForIntent >= pcSetupMinFill
                || (harvestStickyMode && prevIntent === 'harvest')));
    // 校验 harvestEnterMin 仅作语义文档（实际 enter 由 boundary 配合）；避免 lint 未引用
    void harvestEnterMin;

    /* v1.62.8（INTENT_THRASHING 80% → 目标 ≤30%）：dwell time（最小停留帧数）
     *
     * 背景：v1.62.7 加 hysteresis + harvest stickiness 后，违规率仍 80%。根因是
     * 真实切换不止 sprint/harvest，还有 maintain↔flow↔engage↔harvest 多向跳变。
     * 仅靠"边界扩展"无法抑制多状态间的小幅高频抖动。
     *
     * dwell time：进入某 intent 后，N 帧内不允许再切换（即使新条件满足），
     * 强制系统"消化完"上一次决策再做下一次。
     *
     * 例外（不受 dwell 限制）：
     *   - relief / pressure：紧急救济或加压，必须立即响应（设计上优先级最高）
     *   - 第一帧（prevIntent=null）
     *   - 切换目标本身就是 prevIntent（自洽，无开销）
     *
     * 配置：spawnIntentCfg.dwellFrames（默认 3，0 = 禁用）
     *      spawnIntentCfg.dwellAge：上一帧 intent 已停留多少帧（由调用方传入）
     */
    const dwellFrames = hysteresisOn && Number.isFinite(hysteresis.dwellFrames)
        ? Math.max(0, hysteresis.dwellFrames)
        : (hysteresisOn ? 3 : 0);
    const dwellAge = Number.isFinite(hysteresis?.dwellAge) ? hysteresis.dwellAge : 0;
    const inDwell = dwellFrames > 0 && prevIntent && dwellAge < dwellFrames;

    /* v1.61 pb_chase_pressure（priority 102）：
     * 接近/超越 PB 且 B 类挑战条件满足时，加压优先级高于普通救济（playerDistress < -0.10）。
     * 安全门：forceReliefIntent=true 时仍走 relief（临终救济 / 高挫败不可打断）。
     * 与 intentResolver.js INTENT_RULES 'pb_chase_pressure' 规则 priority=102 同口径。 */
    if (pbChasePressureActive) return 'pressure';

    if (playerDistress < effectiveDistressThreshold || delightMode === 'relief' || forceReliefIntent) return 'relief';
    /* v1.60.45：爽感饥渴 → 强 relief（priority 95，介于 relief 与 engage 之间）。
     * 与 intentResolver INTENT_RULES 'delight_starved' 规则 spawnIntent='relief' 同口径。
     * 设计依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5。 */
    if (delightStarved) return 'relief';

    /* 决策候选 intent（不含 relief/pressure 紧急路径，那些已在上面早退） */
    let candidate;
    if (afkEngageActive) candidate = 'engage';
    else if (harvestable) candidate = 'harvest';
    else if (challengeBoost > 0 || (delightMode === 'challenge_payoff' && stress >= 0.55)) candidate = 'pressure';
    else if (sprintEnabled && stress >= sprintMin && stress < sprintMax) candidate = 'sprint';
    else if (delightMode === 'flow_payoff' || rhythmPhase === 'payoff') candidate = 'flow';
    else candidate = 'maintain';

    /* v1.62.8：dwell time 后置应用 —— 紧急 intent (relief/pressure) 已早退，不受 dwell 限制。
     * pressure 也允许立即切（challenge_boost 等通常代表玩家主动求战）。 */
    if (inDwell && candidate !== prevIntent && candidate !== 'pressure') {
        return prevIntent;
    }
    return candidate;
}

/**
 * v1.57.4：实时盘面几何快照（供 game.js 在每次玩家放置后增量刷新 _lastAdaptiveInsight）。
 *
 * 返回字段与 _commitSpawn 写入 spawnDiagnostics.layer1 的 4 字段完全一致：
 *   { fill, holes, nearFullLines, multiClearCandidates, pcSetup }
 *
 * 计算成本：
 *   - fill / holes / nearFullLines：复用 analyzeBoardTopology(grid) 一次 O(n²)
 *   - multiClearCandidates：dock 三块各跑 _bestMultiClearPotential O(n² · pool)
 *   - pcSetup：analyzePerfectClearSetup 一次 O(n²)
 * dock=3 时整体 ~3 倍 O(n²)，n=10 即 ~300 次 cell 扫描，远低于每帧渲染开销。
 *
 * 失败保护：grid 缺失或任一 helper 抛错时返回 null，调用方降级回上一次 spawn 时的快照。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Array<{data:number[][]}>} [dockShapePool] 当前 dock 中未放置的形状池
 * @returns {{fill:number, holes:number, nearFullLines:number, multiClearCandidates:number, pcSetup:number}|null}
 */
function snapshotInsightGeometry(grid, dockShapePool) {
    if (!grid?.cells?.length || !Number.isFinite(grid.size)) return null;
    try {
        /* v1.60.1：insight 几何快照走"玩家失误评估"口径，独立库散点孤岛豁免 */
        const topo = analyzeBoardTopology(grid, { skipSpecialCells: true });
        const dockPool = Array.isArray(dockShapePool)
            ? dockShapePool.filter((s) => Array.isArray(s?.data)).map((s) => ({ data: s.data }))
            : [];
        const shapePool = dockPool.length > 0 ? dockPool : getAllShapes();
        const liveMcc = _countMultiClearCandidatesFromShapePool(grid, shapePool);
        const pcSetup = analyzePerfectClearSetup(grid);
        const fill = typeof grid.getFillRatio === 'function' ? grid.getFillRatio() : NaN;
        return {
            fill: Number.isFinite(fill) ? fill : 0,
            holes: Number.isFinite(topo?.holes) ? topo.holes : 0,
            nearFullLines: Number.isFinite(topo?.nearFullLines) ? topo.nearFullLines : 0,
            multiClearCandidates: Number.isFinite(liveMcc) ? liveMcc : 0,
            pcSetup: Number.isFinite(pcSetup) ? pcSetup : 0,
            /* v1.66 P7：客观几何（空白连通块数 / 凹角陷阱数）随实时几何快照外露，
             * 供 DFV 决策数据流面板与 insight.spawnDiagnostics.layer1 统一口径展示。 */
            contiguousRegions: Number.isFinite(topo?.contiguousRegions) ? topo.contiguousRegions : 0,
            concaveCorners: Number.isFinite(topo?.concaveCorners) ? topo.concaveCorners : 0,
        };
    } catch {
        return null;
    }
}

/**
 * 盘面几何风险（0..1）。
 *
 * **设计注记**：`boardRisk` **不直接参与 stress 标量求和**（见本文件 `_SUM_SKIP` 排除规则，约 line 918），
 * 而是通过三条独立通路体现，避免与其它风险信号双重计数：
 *   1. `boardRiskReliefAdjust` —— 走 stressBreakdown 内的"舒缓"通道
 *   2. `immediateRelief` / `flowPayoffStressCap` —— 作为下游门控条件
 *   3. `deriveSpawnTargets` —— 作为减法风险舒缓项影响 spawnTargets
 */
function deriveBoardRisk(fill, holePressure, abilityRisk) {
    const fillRisk = Math.max(0, Math.min(1, ((fill ?? 0) - 0.45) / 0.4));
    return Math.max(0, Math.min(1, fillRisk * 0.45 + holePressure * 0.35 + (abilityRisk ?? 0) * 0.2));
}

function deriveBoardDifficulty(fill, holePressure, cfg = {}) {
    const holeFillEquivalent = Math.max(0, Number(cfg.holeFillEquivalent ?? 0.8) || 0);
    return clamp01((fill ?? 0) + holePressure * holeFillEquivalent);
}

/**
 * v1.13：友好盘面救济
 *
 * 当盘面 holes=0、临消行/多消候选/清屏机会都很充沛、且节奏处于「兑现期」时，
 * 直接对 stress 注入一笔减压，让玩家面板上看到的「心情」与盘面实际状态一致
 * （避免出现「🥵 高压」与「享受多消快感」并列的认知冲突）。
 *
 * 减压幅度按机会强度在 [baseRelief, maxRelief] 之间插值：
 *   intensity = clamp(0.4 + 0.6 * (opportunity * 0.7 + cleanBoard * 0.3), 0, 1)
 *   relief    = baseRelief + (maxRelief − baseRelief) * intensity
 *
 * @param {object} ctx              spawnContext
 * @param {number} fill             当前盘面填充率
 * @param {number} holes            盘面空洞数
 * @param {string} rhythmPhase      'setup' | 'payoff' | 'neutral'
 * @param {object} [cfg]            adaptiveSpawn.friendlyBoard 配置
 * @returns {number}                ≤ 0；不满足条件时返回 0
 */
function deriveFriendlyBoardRelief(ctx, fill, holes, rhythmPhase, cfg = {}) {
    if (holes > 0) return 0;
    const nearFullLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
    const multiClearCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
    const pcSetup = Math.max(0, Math.floor(ctx.pcSetup ?? 0));

    const minNearFullLines = cfg.minNearFullLines ?? 2;
    const minMultiClearCandidates = cfg.minMultiClearCandidates ?? 2;
    const requirePayoff = cfg.requirePayoff !== false;

    const hasGeometry = nearFullLines >= minNearFullLines
        && (multiClearCands >= minMultiClearCandidates || pcSetup >= 1);
    const hasPayoffWindow = !requirePayoff || rhythmPhase === 'payoff';
    if (!hasGeometry || !hasPayoffWindow) return 0;

    const opportunity = Math.min(1, nearFullLines / 4 + multiClearCands / 4 + pcSetup * 0.3);
    const cleanBoard = 1 - Math.min(1, Math.max(0, fill ?? 0));
    const intensity = Math.max(0, Math.min(1, 0.4 + 0.6 * (opportunity * 0.7 + cleanBoard * 0.3)));

    const baseRelief = cfg.baseRelief ?? -0.12;
    const maxRelief = cfg.maxRelief ?? -0.18;
    return baseRelief + (maxRelief - baseRelief) * intensity;
}

function smoothStress(current, ctx, cfg, immediateRelief) {
    if (!cfg?.enabled) return current;
    const prev = Number(ctx?.prevAdaptiveStress);
    if (!Number.isFinite(prev)) return current;
    if (immediateRelief && current < prev) return current;

    const alpha = Math.max(0.01, Math.min(1, cfg.alpha ?? 0.35));
    const maxStepUp = Math.max(0.01, cfg.maxStepUp ?? 0.18);
    const maxStepDown = Math.max(0.01, cfg.maxStepDown ?? 0.28);
    const smoothed = prev + (current - prev) * alpha;
    if (current > prev) return Math.min(current, Math.min(smoothed, prev + maxStepUp));
    return Math.max(current, Math.max(smoothed, prev - maxStepDown));
}

/* v1.61.17: clamp01 已抽到 lib/math.js 单源（含 NaN 防护，性能差异可忽略） */

function sigmoid01(x) {
    return 1 / (1 + Math.exp(-x));
}

/**
 * 默认 PB 双 S 曲线参数 — 与 v2.1 之前硬编码完全一致, 保持向后兼容。
 * v2.2: 暴露为可覆盖的常量, 让 spawn-tuning v2 寻参可以把这些常数纳入 θ。
 *
 * 业务含义:
 *   pbTensionCenter — 张力 sigmoid 拐点 (玩家接近 PB 多少比例时开始增加难度)
 *   pbTensionWidth  — 张力 sigmoid 斜率宽度 (越小越陡, 即拐点附近变化越剧烈)
 *   pbBrakeCenter   — 刹车 sigmoid 拐点 (超过 PB 多少倍后强力压制 payoff)
 *   pbBrakeWidth    — 刹车 sigmoid 斜率宽度
 */
/* ──────────────────────────────────────────────────────────────────
 * DEFAULT_SPAWN_PARAMS_PB_CURVE — SpawnParam θ 中「组 B: PB 双 S 曲线 (4 维)」的默认值。
 * 当 SpawnParamTuner 未部署 / policies.json 加载失败时 derivePbCurve 自动 fallback 到这里。
 *
 * SPAWN_PARAM_KEYS — L1 (SpawnPolicyRules) 与 L2 (SpawnParamTuner) 之间的 9 维 θ 数据契约
 * （与 rl_pytorch/spawn_tuning_v2/feature_io.THETA_KEYS 同源）。
 *
 * 详见 docs/algorithms/SPAWN_OVERVIEW.md §5。
 * ────────────────────────────────────────────────────────────────── */
const DEFAULT_SPAWN_PARAMS_PB_CURVE = Object.freeze({
    pbTensionCenter: 0.82,
    pbTensionWidth: 0.08,
    pbBrakeCenter: 1.05,
    pbBrakeWidth: 0.06,
});

const SPAWN_PARAM_KEYS = Object.freeze([
    'personalizationStrength',
    'temperature',
    'surpriseBudgetGain',
    'surpriseCooldown',
    'maxEvaluatedTriplets',
    'pbTensionCenter',
    'pbTensionWidth',
    'pbBrakeCenter',
    'pbBrakeWidth',
]);

/** 把 options 中的 PB 曲线参数 (可能浮点 / NaN) 整型化并填充默认值。 */
function _resolvePbCurveParams(options) {
    const numOrDefault = (v, d) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
        tensionCenter: numOrDefault(options?.pbTensionCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionCenter),
        tensionWidth: numOrDefault(options?.pbTensionWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionWidth),
        brakeCenter: numOrDefault(options?.pbBrakeCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeCenter),
        brakeWidth: numOrDefault(options?.pbBrakeWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeWidth),
    };
}

function derivePbCurve(score = 0, bestScore = 0, releaseActive = false, options = null) {
    const best = Number(bestScore) || 0;
    if (best <= 0) {
        return {
            pbRatio: null,
            pbTension: 0,
            pbBrake: 0,
            pbRelease: releaseActive ? 1 : 0,
            pbPhase: 'unknown',
        };
    }
    const ratio = Math.max(0, Number(score) || 0) / best;
    const p = _resolvePbCurveParams(options);
    const pbTension = clamp01(sigmoid01((ratio - p.tensionCenter) / p.tensionWidth));
    const pbBrake = clamp01(sigmoid01((ratio - p.brakeCenter) / p.brakeWidth));
    const pbRelease = releaseActive ? 1 : 0;
    let pbPhase = 'warmup';
    if (ratio >= 1.15) pbPhase = 'overshoot';
    else if (ratio >= 1.05) pbPhase = 'brake';
    else if (ratio >= 1.0) pbPhase = 'release';
    else if (ratio >= 0.95) pbPhase = 'gate';
    else if (ratio >= 0.8) pbPhase = 'tension';
    else if (ratio >= 0.5) pbPhase = 'chase';
    return { pbRatio: ratio, pbTension, pbBrake, pbRelease, pbPhase };
}

function deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight, cfg = {}, boardDifficulty = fill) {
    const stress01 = clamp01((stress + 0.2) / 1.2);
    const recoveryNeed = profile.needsRecovery || profile.hadRecentNearMiss
        ? 1
        : clamp01((profile.frustrationLevel ?? 0) / Math.max(1, cfg.frustrationReliefThreshold ?? 5));
    const payoffOpportunity = clamp01(
        ((ctx.nearFullLines ?? 0) / 4)
        + (ctx.pcSetup ?? 0) * 0.35
        + Math.max(0, (fill ?? 0) - 0.42)
    );
    const skill = clamp01(profile.skillLevel ?? 0.5);
    const boredHighSkill = profile.flowState === 'bored' ? Math.max(0, skill - 0.5) * 1.4 : 0;
    const riskRelief = Math.max(boardRisk, recoveryNeed);

    // θ-D: deriveSpawnTargets 翻译矩阵 (5 维)
    const mc = ctx.modelConfig || {};
    const kComplexity   = Number.isFinite(mc.complexityFromStress) ? mc.complexityFromStress : 0.75;
    const kRiskRelief   = Number.isFinite(mc.complexityRiskRelief) ? mc.complexityRiskRelief : -0.45;
    const kSolution     = Number.isFinite(mc.solutionFromStress)   ? mc.solutionFromStress   : 0.7;

    const shapeComplexity = clamp01(stress01 * kComplexity + boredHighSkill * 0.25 + riskRelief * kRiskRelief);
    const solutionSpacePressure = clamp01(stress01 * kSolution + shapeComplexity * 0.25 - boardRisk * 0.55 - recoveryNeed * 0.35);
    const clearOpportunity = clamp01(recoveryNeed * 0.55 + payoffOpportunity * 0.45 + (profile.pacingPhase === 'release' ? 0.12 : 0) - stress01 * 0.18);
    const spatialPressure = clamp01(stress01 * 0.65 + (boardDifficulty ?? fill ?? 0) * 0.25 - boardRisk * 0.5 - recoveryNeed * 0.3);
    const payoffIntensity = clamp01((delight.multiClearBoost ?? 0) * 0.45 + payoffOpportunity * 0.4 + Math.max(0, profile.momentum ?? 0) * 0.15);
    const novelty = clamp01((profile.flowState === 'bored' ? 0.45 : 0) + stress01 * 0.25 + (ctx.totalRounds ?? 0) / 80 - recoveryNeed * 0.2);

    return {
        shapeComplexity,
        solutionSpacePressure,
        clearOpportunity,
        spatialPressure,
        payoffIntensity,
        novelty
    };
}

/* ------------------------------------------------------------------ */
/*  Layer 2: combo 链 + 节奏推演                                       */
/* ------------------------------------------------------------------ */

/**
 * 从 spawnContext 推导 combo 链强度
 * @param {object} ctx spawnContext from game.js
 * @param {object} profile PlayerProfile
 * @returns {number} 0~1
 */
function deriveComboChain(ctx, profile) {
    const lastClear = ctx.lastClearCount ?? 0;
    const streak = profile.recentComboStreak ?? 0;
    if (lastClear === 0 && streak === 0) return 0;
    const base = Math.min(1, streak * 0.25 + (lastClear > 0 ? 0.3 : 0));
    return base;
}

/**
 * 从 spawnContext 推导多消鼓励强度
 * @param {object} ctx
 * @param {number} fill
 * @returns {number} 0~1
 */
function deriveMultiClearBonus(ctx, fill) {
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    // ctx.nearFullLines / ctx.pcSetup 由 game.js 在每轮出块后从诊断中回写
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;

    // 清屏机会（blockSpawn 诊断确认）→ 最大鼓励
    if (pcSetup >= 2) return 1.0;
    if (pcSetup >= 1) return 0.9;
    // 棋盘临消行极多 → 强烈鼓励多消（清屏机会）
    if (nearFullLines >= 5) return 1.0;
    if (nearFullLines >= 3) return 0.8;
    // 久未消行 → 高多消鼓励
    if (roundsSinceClear > 3) return 0.7;
    // 高填充 → 中等多消鼓励
    if (fill > 0.60) return 0.6;
    if (fill > 0.45) return 0.4;
    // 基础鼓励（始终保持一定引导）
    return 0.22;
}

/**
 * 从 pacing + spawnContext 推导节奏相位
 * @param {object} profile
 * @param {object} ctx
 * @returns {'setup'|'payoff'|'neutral'}
 */
/**
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {object} ctx
 * @param {number} fill 当前盘面填充率（与 game 传入的 boardFill 一致）
 */
function deriveRhythmPhase(profile, ctx, fill = 0) {
    const pacingPhase = profile.pacingPhase;
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    /* v1.17：pcSetup 单独不足以判定 payoff —— 低占用盘面经常误触发。
     * pcSetup 必须配合 fill ≥ PC_SETUP_MIN_FILL 才视为「已经有可兑现的几何」，
     * 否则只是"理论清屏"，与 UI「收获期」叙事不符。
     */
    const pcSetupMeaningful = pcSetup >= 1 && fill >= PC_SETUP_MIN_FILL;
    // 几何兑现条件：无「临消 / 清屏准备」时不要把 payoff 拉满，避免盘面配不上仍强行「收获期」
    const nearGeom = pcSetupMeaningful
        || nearFullLines >= 2
        || (fill > 0.52 && nearFullLines >= 1);

    if (pcSetupMeaningful) return 'payoff';
    if (nearFullLines >= 3) return 'payoff';
    if (pacingPhase === 'release' && nearGeom) return 'payoff';
    if (roundsSinceClear >= 2 && nearGeom) return 'payoff';
    /* v1.21：'setup' 与 'harvest' 互斥兜底 ——
     * 旧版只判 (pacingPhase==='tension' && roundsSinceClear===0) 就返回 'setup'，
     * 但 spawnIntent='harvest' 的判定（line 975）只看 nearFullLines>=2 / pcSetupMeaningful，
     * 两者口径不同 → 同帧出现 pill「节奏 搭建」+「意图 兑现」、stress story
     * 「投放促清形状」+ strategyAdvisor「搭建期 稳定堆叠 留通道」对立叙事。
     * 加 `&& !nearGeom`：紧张期开头若几何已经支持兑现就不再"蓄力"，
     * fall through 到 'neutral'，再由后续 `canPromoteToPayoff` 升 'payoff'，
     * 与 spawnIntent='harvest' 同口径。 */
    if (pacingPhase === 'tension' && roundsSinceClear === 0 && !nearGeom) return 'setup';
    return 'neutral';
}

/**
 * 多线兑现目标：与 multiClearBonus 互补；偏高时 blockSpawn 阶段 1/2 显式偏好 multiClear≥2
 * @param {object} ctx
 * @param {number} fill
 * @returns {0|1|2}
 */
function deriveMultiLineTarget(ctx, fill) {
    const pcSetup = ctx.pcSetup ?? 0;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const lastClear = ctx.lastClearCount ?? 0;

    if (pcSetup >= 2) return 2;
    if (pcSetup >= 1) return 2;
    if (nearFullLines >= 5) return 2;
    if (nearFullLines >= 3) return 1;
    // 刚完成多线消除后的短窗口：鼓励下一手「可落位的单行兑现」，避免只有巨型块堵死续combo
    if (lastClear >= 2 && fill > 0.35) return 1;
    if (fill > 0.58 && nearFullLines >= 2) return 1;
    return 0;
}

/**
 * 根据玩家能力 + 心流状态生成“爽感兑现”偏置。
 * 目标：高手/无聊时给更高挑战与更强多消机会；焦虑/恢复时降低难度但保留清线爽点。
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {object} ctx
 * @param {number} fill
 * @param {object} cfg adaptiveSpawn.delight
 */
function deriveDelightTuning(profile, ctx, fill, cfg = {}) {
    const skill = Math.max(0, Math.min(1, profile.skillLevel ?? 0.5));
    const momentum = Math.max(-1, Math.min(1, profile.momentum ?? 0));
    const flow = profile.flowState;
    const pacing = profile.pacingPhase;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    const frustration = profile.frustrationLevel ?? 0;
    const recovery = profile.needsRecovery === true;

    const highSkill = Math.max(0, (skill - (cfg.highSkillThreshold ?? 0.62)) / 0.38);
    const positiveMomentum = Math.max(0, momentum);
    const pressureOpportunity = Math.min(1, nearFullLines / 4 + pcSetup * 0.35 + Math.max(0, fill - 0.42));
    const recoveryNeed = recovery ? 1 : Math.min(1, frustration / Math.max(1, cfg.frustrationReliefThreshold ?? 5));

    let stressAdjust = 0;
    if (flow === 'bored' && skill > 0.52) {
        stressAdjust += (cfg.boredSkillStressBoost ?? 0.07) * Math.min(1, highSkill + 0.35);
    }
    if (flow === 'anxious' || recovery) {
        stressAdjust -= (cfg.anxiousReliefStress ?? 0.08) * Math.max(0.4, recoveryNeed);
    }

    let multiClearBoost = cfg.baseMultiClearBoost ?? 0.22;
    multiClearBoost += highSkill * (cfg.highSkillMultiBoost ?? 0.22);
    multiClearBoost += positiveMomentum * (cfg.momentumMultiBoost ?? 0.16);
    multiClearBoost += pressureOpportunity * (cfg.opportunityMultiBoost ?? 0.30);
    if (flow === 'flow' || pacing === 'release') {
        multiClearBoost += cfg.flowPayoffBoost ?? 0.14;
    }
    if (flow === 'anxious' || recovery) {
        multiClearBoost += recoveryNeed * (cfg.reliefMultiBoost ?? 0.20);
    }

    /* v1.60.34：大幅提升清屏概率（用户反馈，让位给同花降频）
     * 派生阶段把 pcSetup>=1 时 boost 提到 0.95（near-max），各场景门槛同步抬升。
     * 配合 scoreShape pcPotential===2 加权 ×(25+pcb×20) → 峰值 45 倍硬碾压。 */
    let perfectClearBoost = 0;
    if (pcSetup >= 2) perfectClearBoost = 1;
    else if (pcSetup >= 1) perfectClearBoost = 0.95;
    else if (nearFullLines >= 4 && fill > 0.45) perfectClearBoost = 0.65;
    /* 疏板 / 双线临门：提高清屏块抽样权重（v1.60.34 全面抬升） */
    if (nearFullLines >= 2 && fill > 0.30) perfectClearBoost = Math.max(perfectClearBoost, 0.58);
    if (nearFullLines >= 1 && fill <= 0.42) perfectClearBoost = Math.max(perfectClearBoost, 0.45);

    const mode = recovery || flow === 'anxious'
        ? 'relief'
        : flow === 'bored' && skill > 0.55
            ? 'challenge_payoff'
            : (flow === 'flow' || positiveMomentum > 0.35)
                ? 'flow_payoff'
                : 'neutral';

    return {
        stressAdjust,
        multiClearBoost: Math.max(0, Math.min(1, multiClearBoost)),
        perfectClearBoost: Math.max(0, Math.min(1, perfectClearBoost)),
        mode
    };
}

/* ------------------------------------------------------------------ */
/*  Layer 3: session 弧线 + 局内分数里程碑                              */
/*                                                                    */
/*  注意：本节的「里程碑」指 *局内分数突破档位*（score milestone），与   */
/*  retention/maturityMilestones.js 中的「成熟度晋升里程碑」（跨局      */
/*  M0→M1→M2 等，事件 `maturity_milestone_complete`）是两个完全独立的概念。 */
/*  字段命名 v1.49 已统一改为 scoreMilestone* 前缀，便于跨模块辨识。       */
/* ------------------------------------------------------------------ */

/**
 * v1.55.10 score milestone 触发的最低 bestScore 门槛。
 *
 * 用户反馈："总分很低时，很容易达成最佳，给激励特效不符合认知"——例如新手 best=0
 * 时跨过 50 就弹"分数突破 50！"，玩家会觉得"我都没努力就突破了"，激励特效反而
 * 削弱了"挑战自己 PB"的核心叙事。
 *
 * 阈值定为 500：大致对应玩家 5-10 分钟稳定游戏后的水平，能区分"还在熟悉游戏"
 * vs "在挑战自己 PB"两种用户心态。低于 500 时不出 milestone toast，让 PB 庆祝
 * （_maybeCelebrateNewBest）和"追平最佳"（_maybeCelebrateTiePersonalBest）
 * 接管所有"分数相关"的情绪反馈。
 */
const MIN_BEST_FOR_MILESTONE_TOAST = 500;

/**
 * v1.55.10 当 bestScore ≥ MIN_BEST_FOR_MILESTONE_TOAST 时使用的相对档位（百分比锚点）。
 *
 * 仅保留 50% / 75% / 90% 三档（旧版 0.25/0.5/0.75/1.0/1.25 五档过于频繁，且 1.0 与
 * "追平最佳"撞车、1.25 与"破 PB"庆祝撞车）：
 *   - 50%：到达半程，激励"继续"
 *   - 75%：进入冲刺区，激励"再加把劲"
 *   - 90%：决战前夜（与 _maybeEmitNearPersonalBest @ 95% 互补）
 * 100% 由"追平最佳"特效专门处理；> 100% 由 PB 庆祝处理。
 */
const SCORE_MILESTONES_REL = [0.50, 0.75, 0.90];

/**
 * 派生当前生效的分数里程碑表。
 *
 * v1.55.10 改造（用户反馈）：
 *   - 旧版 best < 200 走绝对档位 [50,100,150,200,300,500] —— 已删除：新手 best 很低时
 *     不该出 milestone toast，否则"刚得 50 分就突破"不符合认知。
 *   - 旧版 best ≥ 200 走 [0.25, 0.5, 0.75, 1.0, 1.25] —— 改为 [0.50, 0.75, 0.90]
 *     三档，且要求 best ≥ MIN_BEST_FOR_MILESTONE_TOAST（500）才返回非空表。
 *   - post-PB 二度里程碑（+10%/+25%）保留（v1.55 §4.6）。
 *
 * @param {number} bestScore     当前账号历史最佳；0 或缺失或 < MIN 时返回空表。
 * @param {number} [currentScore] 当前局内分数，用于派生二度里程碑（v1.55 §4.6）。
 * @returns {number[]} 单调递增的里程碑分数数组；best < MIN 时返回空表 → 不出 toast
 */
function deriveScoreMilestones(bestScore, currentScore = 0) {
    if (!Number.isFinite(bestScore) || bestScore < MIN_BEST_FOR_MILESTONE_TOAST) {
        /* v1.55.10：低 best 不触发 score milestone toast，把"分数相关情绪反馈"
         * 完全让位给 PB 庆祝 / 追平 / near-PB 提示。 */
        return [];
    }
    let base = SCORE_MILESTONES_REL.map(r => Math.round(bestScore * r));
    /* v1.55 §4.6：玩家已破 PB 时追加 [+10%, +25%] × bestScore 作为"再征服"节点。 */
    if (Number.isFinite(currentScore) && currentScore > bestScore) {
        const extras = [1.10, 1.25]
            .map(r => Math.round(bestScore * r))
            .filter(m => m > bestScore);
        if (extras.length > 0) {
            const merged = Array.from(new Set([...base, ...extras]));
            merged.sort((a, b) => a - b);
            base = merged;
        }
    }
    return base;
}

/**
 * 推导 session 弧线阶段
 * @param {number} totalRounds 本局已出块轮数
 * @param {string} sessionPhase profile.sessionPhase
 * @returns {'warmup'|'peak'|'cooldown'}
 */
function deriveSessionArc(totalRounds, sessionPhase) {
    if (totalRounds <= 3) return 'warmup';
    if (sessionPhase === 'late') return 'cooldown';
    return 'peak';
}

/**
 * 检查分数是否刚跨越分数里程碑（局内）。
 * @param {number} score 当前局内分数
 * @param {number} prevMilestone 上次触发的里程碑分数（已写入 _prevScoreMilestone）
 * @param {number[]} milestones 当前生效的里程碑表（来自 deriveScoreMilestones）
 * @returns {{ hit: boolean, milestone: number }}
 */
function checkScoreMilestone(score, prevMilestone, milestones, bestScore = 0) {
    /* v1.55.10 局内频次控制（分两阶段计数，"局内一次"按阶段计算）：
     *
     *   阶段 A — base 档（玩家分数 ≤ bestScore 阶段）：
     *     50% / 75% / 90% 三档，本局最多 hit 1 次。
     *
     *   阶段 B — post-PB 二度档（玩家分数 > bestScore，已破纪录的"再征服"段）：
     *     +10% / +25% 两档，本局最多 hit 1 次。
     *
     * 拆成两阶段的原因：
     *   - 用户反馈"局内特效只出现一次"是针对 base 段的审美疲劳；
     *   - §4.6 二度档的设计意图是"破纪录之后给一个'再创新高'的节奏"，
     *     与 base 段属于不同心理时刻，合并计数会让破 PB 玩家完全失去节奏点。
     *
     * 单局最多 2 次激励 toast（base + post-PB），且都在玩家"有意义的进度时刻"。
     */
    const inPostPbSegment = Number.isFinite(bestScore) && bestScore > 0 && score > bestScore;
    const firedThisSegment = inPostPbSegment
        ? _milestoneToastPostPbFiredThisRun
        : _milestoneToastBaseFiredThisRun;
    if (firedThisSegment) {
        return { hit: false, milestone: prevMilestone ?? 0 };
    }
    for (const m of milestones) {
        if (score < m || (prevMilestone ?? 0) >= m) continue;
        const isPostPbDoor = Number.isFinite(bestScore) && bestScore > 0 && m > bestScore;
        /* 段隔离：当前若在 post-PB 段，不回头命中 base 档（避免破 PB 后第一次 resolve
         * 还把"50% PB"的 toast 弹出来——那已经不再有意义）；反之亦然。 */
        if (inPostPbSegment !== isPostPbDoor) continue;
        if (isPostPbDoor) _milestoneToastPostPbFiredThisRun = true;
        else _milestoneToastBaseFiredThisRun = true;
        return { hit: true, milestone: m };
    }
    return { hit: false, milestone: prevMilestone ?? 0 };
}

/** 记录上次触发的分数里程碑（模块级状态，每局开始由 resetAdaptiveMilestone 清零） */
let _prevScoreMilestone = 0;
/** v1.55.10：本局是否已经触发过 base 段（≤ PB）的 milestone toast */
let _milestoneToastBaseFiredThisRun = false;
/** v1.55.10：本局是否已经触发过 post-PB 段（> PB）的 milestone toast */
let _milestoneToastPostPbFiredThisRun = false;

function resetAdaptiveMilestone() {
    _prevScoreMilestone = 0;
    _milestoneToastBaseFiredThisRun = false;
    _milestoneToastPostPbFiredThisRun = false;
}

/* ------------------------------------------------------------------ */
/*  v9: 解法数量难度调控（targetSolutionRange）                         */
/*                                                                    */
/*  根据综合 stress 在 adaptiveSpawn.solutionDifficulty.ranges 中选择档位， */
/*  传给 blockSpawn.js 用于在三连块通过 sequentiallySolvable 校验后再做  */
/*  解空间收缩/扩张。                                                  */
/* ------------------------------------------------------------------ */

/**
 * 根据 stress 选择解法数量档位。
 * @param {number} stress 综合压力（内部 raw 域 [-0.2, 1]；本函数在算法内部消费，
 *                        对外面板 stress 域 [0, 1] 见本文件顶部 normalizeStress 注释）
 * @param {object} cfg adaptiveSpawn.solutionDifficulty
 * @param {number} fill 当前盘面填充率
 * @returns {{ min: number|null, max: number|null, label?: string } | null}
 */
function deriveTargetSolutionRange(stress, cfg, fill) {
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
 * v1.57.2：根据 stress 选择新空洞数难度档（与 targetSolutionRange 并列的第二维度）。
 *
 * 语义：blockSpawn 在 earlyAttempt 阶段对每个候选 triplet 计算 minHoleIncrement
 * （6 种放置顺序所有解的"最干净路径"新空洞数），按本函数返回的 { min, max } 区间软过滤。
 *
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
function deriveTargetHoleIncrement(stress, cfg, fill) {
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
function _deriveRangeByStress(stress, dimCfg, parentCfg, fill) {
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
function deriveTargetMaxHoleIncrement(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.maxHoleIncrement, cfg, fill);
}
/** v1.57.3 ⑨ — 专注度税差距 = max − min */
function deriveTargetHoleIncrementGap(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.holeIncrementGap, cfg, fill);
}
/** v1.57.3 ② — 终末填充率（空间窒息）*/
function deriveTargetEndFillRatio(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endFillRatio, cfg, fill);
}
/** v1.57.3 ③ — 近满 delta（消行节律）*/
function deriveTargetNearFullDelta(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.nearFullDelta, cfg, fill);
}
/** v1.57.3 ④ — 第一步存活率（试错代价）*/
function deriveTargetFirstMoveSurvivorRatio(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.firstMoveSurvivor, cfg, fill);
}
/** v1.57.3 ⑤ — 解多样性 CV */
function deriveTargetSolutionDiversity(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.solutionDiversity, cfg, fill);
}
/** v1.57.3 ⑥ — 终末平整度 */
function deriveTargetEndFlatness(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endFlatness, cfg, fill);
}
/** v1.57.3 ⑦ — 终末危险列数 */
function deriveTargetEndDangerColumns(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.endDangerColumns, cfg, fill);
}
/** v1.57.3 ⑧ — 视觉杂乱 delta */
function deriveTargetVisualClutter(stress, cfg, fill) {
    return _deriveRangeByStress(stress, cfg?.visualClutter, cfg, fill);
}

/* ------------------------------------------------------------------ */
/*  自适应策略解析（三层整合）                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {string} baseStrategyId 玩家选择的基础难度
 * @param {import('./playerProfile.js').PlayerProfile} profile 玩家实时画像
 * @param {number} score 当前分数
 * @param {number} runStreak 连战局数
 * @param {number} _boardFill 当前板面填充率
 * @param {object} [spawnContext] 来自 game.js 的跨轮上下文
 * @returns {object} 策略对象 + spawnHints
 */
function resolveAdaptiveStrategy(baseStrategyId, profile, score, runStreak, _boardFill, spawnContext) {
    const cfg = GAME_RULES.adaptiveSpawn;
    if (!cfg?.enabled || !cfg.profiles?.length || !profile) {
        return resolveLayeredStrategy(baseStrategyId, score, runStreak);
    }

    const difficultyTuning = cfg.difficultyTuning?.[baseStrategyId] || {};
    const fz = cfg.flowZone ?? {};
    const eng = cfg.engagement ?? {};
    const pacing = cfg.pacing ?? {};
    const topoCfg = cfg.topologyDifficulty ?? {};
    const signalCfg = cfg.signals ?? {};
    const base = getStrategy(baseStrategyId);
    let ctx = spawnContext || {};
    ctx = _mergeLiveGeometrySignals(ctx);

    /* ---------- 基础信号 ----------
     * v1.13：scoreStress 改为按「个人百分位」映射（基于 ctx.bestScore），
     * 避免一次冲过 milestones 末档后 scoreStress 永远锁死最高值。
     */
    const scoreStress = getSpawnStressFromScore(score, { bestScore: ctx.bestScore });
    const runMods = getRunDifficultyModifiers(runStreak);
    const holes = Math.max(0, Number(ctx.holes ?? 0) || 0);
    const holePressure = Math.max(0, Math.min(1, holes / Math.max(1, topoCfg.holePressureMax ?? 8)));
    const ability = buildPlayerAbilityVector(profile, {
        boardFill: _boardFill ?? 0,
        spawnContext: ctx,
        topology: {
            holes,
            fillRatio: _boardFill ?? 0,
            close1: ctx.close1 ?? 0,
            close2: ctx.close2 ?? 0,
            mobility: ctx.mobility ?? 0,
        },
    });

    /* ---------- 技能调节（置信度门控） ---------- */
    const skill = ability.skillScore;
    const conf = ability.confidence;
    const confGate = 0.4 + 0.6 * conf;
    const skillAdjust = (skill - 0.5) * (fz.skillAdjustScale ?? 0.3) * confGate;

    /* ---------- 心流调节 ----------
     * v1.62.8：软边界 —— flowAdjust 应当跟踪 flowDeviation 方向。
     * 原行为：只在 flowState ∈ {bored, anxious} 时输出非零；neutral 时硬置 0。
     * 巡检 (flowAdjust-tracks-flowDeviation 40% 违规) 显示 |r| < 0.2 ——
     * flow 状态切到 neutral 时 flowAdjust 突然归零，与 flowDeviation 出现"断层"。
     *
     * 新行为（fz.softEdgeEnabled=true）：
     *   - flow ∈ {bored, anxious}：原逻辑（保持兼容）
     *   - flow === 'neutral' 但 |flowDev| ≥ softEdgeMin：线性外推
     *     flowAdjust = sign(flowDev) * baseStep * (|flowDev| - softEdgeMin) / (softEdgeMax - softEdgeMin)
     *
     * baseStep 取 bored/anxious 强度的 50%，保证 neutral 区域贡献温和不抢戏。
     */
    const flow = profile.flowState;
    const flowDev = profile.flowDeviation;
    let flowAdjust = 0;
    if (flow === 'bored') flowAdjust = (fz.flowBoredAdjust ?? 0.08) * Math.min(2, 1 + flowDev);
    else if (flow === 'anxious') flowAdjust = (fz.flowAnxiousAdjust ?? -0.12) * Math.min(2, 1 + flowDev);
    else if (fz.softEdgeEnabled === true && Number.isFinite(flowDev)) {
        const softMin = Number.isFinite(fz.softEdgeMin) ? fz.softEdgeMin : 0.05;
        const softMax = Number.isFinite(fz.softEdgeMax) ? fz.softEdgeMax : 0.20;
        const absDev = Math.abs(flowDev);
        if (absDev >= softMin && softMax > softMin) {
            const sign = flowDev >= 0 ? 1 : -1;
            const strength = Math.min(1, (absDev - softMin) / (softMax - softMin));
            const base = sign > 0 ? (fz.flowBoredAdjust ?? 0.08) : -(fz.flowAnxiousAdjust ?? -0.12);
            flowAdjust = sign * Math.abs(base) * 0.5 * strength;
        }
    }

    /* ---------- 节奏张弛 ----------
     * v1.62.8：pacingAdjust deadzone + 软过渡（针对 STRESS_DOMINATOR pacingAdjust 50% 主导）
     *
     * 原行为：phase=release → -0.12 / phase=tension → +0.04，常驻非零，平均 |x| ≈ 0.08
     * 经 __normalizeBudget=0.05 钳后仍是"几乎恒压源"，长期主导 stress 分量。
     *
     * 新行为（pacing.deadzoneEnabled=true）：
     *   - phase=neutral → 0（原行为）
     *   - phase=release/tension 但 ageInPhase < deadzoneFrames → 0（刚切相，先观察）
     *   - 超出 deadzone 后正常输出
     * 这让 pacingAdjust 平均 |x| 降到 ≈0.04，stress 多源驱动恢复。
     *
     * ageInPhase 由 profile.pacingPhaseAge 提供（playerProfile 已维护或回退 0）。
     */
    let pacingAdjust = 0;
    if (pacing.enabled) {
        const phase = profile.pacingPhase;
        const ageInPhase = Number(profile.pacingPhaseAge) || 0;
        const deadzoneOn = pacing.deadzoneEnabled === true;
        const deadzoneFrames = Number.isFinite(pacing.deadzoneFrames) ? pacing.deadzoneFrames : 2;
        const inDeadzone = deadzoneOn && phase !== 'neutral' && ageInPhase < deadzoneFrames;
        if (!inDeadzone) {
            pacingAdjust = phase === 'release'
                ? (pacing.releaseBonus ?? -0.12)
                : phase === 'tension'
                    ? (pacing.tensionBonus ?? 0.04)
                    : 0;
        }
    }

    /* ---------- 恢复 / 挫败 / combo ---------- */
    const recoveryAdjust = profile.needsRecovery ? (fz.recoveryAdjust ?? -0.2) : 0;
    const comboAdjust = profile.recentComboStreak >= 2 ? (fz.comboRewardAdjust ?? 0.05) : 0;

    const frustThreshold = eng.frustrationThreshold ?? 4;
    const frustRelief = profile.frustrationLevel >= frustThreshold
        ? (eng.frustrationRelief ?? -0.18)
        : 0;

    /* ---------- 差一点效应 ---------- */
    const nearMissAdjust = profile.hadRecentNearMiss
        ? (eng.nearMissStressBonus ?? -0.1)
        : 0;

    /* ---------- 闭环反馈偏移 ---------- */
    const feedbackBias = profile.feedbackBias ?? 0;

    /* ---------- 历史实时状态优化：低消行 / 高板面挫败 / 认知负荷前置救济 ----------
     *
     * 数据依据（openblock.db 历史回放）：
     *   - clearRate < 0.25 的帧中 33.9% 已进入 frustration>=4（基线 9.3%）
     *   - boardFill >= 0.58 的帧中 40.0% 同时 frustration>=4
     *   - anxious 帧中 72.3% 同时 cognitiveLoad>=0.6
     *
     * 因此这里不等到单一强信号触顶才救济，而是增加三个“复合早期信号”：
     *   1) preFrustrationRelief：低消行 + 中高板面，提前抑制挫败链
     *   2) boardFrustrationRelief：高板面 + frustration>=3，处理死局感合流
     *   3) decisionLoadRelief：anxious + 高认知负荷，降低决策复杂度而不只降 stress
     */
    const rtCfg = cfg.realtimeStateTuning ?? {};
    const clearRate = Number(profile.metrics?.clearRate);
    const cognitiveLoadRaw = Number(profile.cognitiveLoad);
    const cognitiveLoad = Number.isFinite(cognitiveLoadRaw) ? clamp01(cognitiveLoadRaw) : null;
    const boardFillNow = clamp01(Number(_boardFill ?? 0) || 0);
    const frustNow = Math.max(0, Number(profile.frustrationLevel ?? 0) || 0);

    const preCfg = rtCfg.preFrustrationRelief ?? {};
    const preClearRateMax = Number.isFinite(preCfg.clearRateMax) ? preCfg.clearRateMax : 0.25;
    const preFillMin = Number.isFinite(preCfg.boardFillMin) ? preCfg.boardFillMin : 0.45;
    const preMaxRelief = Math.max(0, Number(preCfg.maxRelief ?? 0.06));
    let preFrustrationRelief = 0;
    if (preCfg.enabled !== false
        && Number.isFinite(clearRate)
        && clearRate < preClearRateMax
        && boardFillNow >= preFillMin
        && frustNow < frustThreshold) {
        const lowClear = clamp01((preClearRateMax - clearRate) / Math.max(0.001, preClearRateMax));
        const fillPressure = clamp01((boardFillNow - preFillMin) / Math.max(0.001, 0.72 - preFillMin));
        preFrustrationRelief = -preMaxRelief * clamp01(0.55 * lowClear + 0.45 * fillPressure);
    }

    const bfCfg = rtCfg.boardFrustrationRelief ?? {};
    const bfFillMin = Number.isFinite(bfCfg.boardFillMin) ? bfCfg.boardFillMin : 0.58;
    const bfFrustMin = Number.isFinite(bfCfg.frustrationMin) ? bfCfg.frustrationMin : 3;
    const bfMaxRelief = Math.max(0, Number(bfCfg.maxRelief ?? 0.12));
    let boardFrustrationRelief = 0;
    if (bfCfg.enabled !== false && boardFillNow >= bfFillMin && frustNow >= bfFrustMin) {
        const fillPressure = clamp01((boardFillNow - bfFillMin) / Math.max(0.001, 0.78 - bfFillMin));
        const frustPressure = clamp01((frustNow - bfFrustMin + 1) / Math.max(1, frustThreshold - bfFrustMin + 2));
        boardFrustrationRelief = -bfMaxRelief * clamp01(0.45 * fillPressure + 0.55 * frustPressure);
    }

    const dlCfg = rtCfg.decisionLoadRelief ?? {};
    const dlLoadMin = Number.isFinite(dlCfg.cognitiveLoadMin) ? dlCfg.cognitiveLoadMin : 0.60;
    const dlMaxRelief = Math.max(0, Number(dlCfg.maxRelief ?? 0.07));
    const decisionLoadReliefActive = dlCfg.enabled !== false
        && flow === 'anxious'
        && cognitiveLoad != null
        && cognitiveLoad >= dlLoadMin;
    const decisionLoadRelief = decisionLoadReliefActive
        ? -dlMaxRelief * clamp01((cognitiveLoad - dlLoadMin) / Math.max(0.001, 1 - dlLoadMin))
        : 0;

    const fbCfg = rtCfg.feedbackBiasDamping ?? {};
    const feedbackDistress = Math.max(
        preFrustrationRelief < 0 ? Math.min(1, Math.abs(preFrustrationRelief) / Math.max(0.001, preMaxRelief)) : 0,
        boardFrustrationRelief < 0 ? Math.min(1, Math.abs(boardFrustrationRelief) / Math.max(0.001, bfMaxRelief)) : 0,
        decisionLoadRelief < 0 ? Math.min(1, Math.abs(decisionLoadRelief) / Math.max(0.001, dlMaxRelief)) : 0,
        frustNow >= 3 ? Math.min(1, frustNow / Math.max(1, frustThreshold + 2)) : 0
    );
    const fbDampingFactor = Math.max(0, Math.min(1, Number(fbCfg.factor ?? 0.5)));
    const fbDampingCap = Math.max(0, Number(fbCfg.maxDamping ?? 0.08));
    const feedbackBiasDampingAdjust = fbCfg.enabled === false || feedbackBias <= 0 || feedbackDistress <= 0
        ? 0
        : -Math.min(fbDampingCap, feedbackBias * fbDampingFactor * feedbackDistress);

    /* ---------- 长周期趋势 ---------- */
    const trend = profile.trend ?? 0;
    const trendScale = fz.trendAdjustScale ?? 0.08;
    const trendAdjust = trend * trendScale * conf;

    /* ---------- Layer 3: session 弧线调节 ----------
     * v1.51 强化 cooldown 救济：旧版 -0.05 固定值对"动量从 0 跌到 -0.53"这种崩盘
     * 力度不足，导致截图实测玩家临 game over 时 stress 仍显示 0.04（舒缓档）。
     * 新版按 |momentum| 在 [-0.2, -0.6] 区间线性放大到 [-0.05, -0.20]：
     *   momentum = -0.30 → -0.075；-0.40 → -0.10；-0.53 → -0.135；-0.60 → -0.20。 */
    const totalRounds = ctx.totalRounds ?? 0;
    const sessionArc = deriveSessionArc(totalRounds, profile.sessionPhase);
    let sessionArcAdjust = 0;
    if (sessionArc === 'warmup') sessionArcAdjust = -0.08;
    else if (sessionArc === 'cooldown' && profile.momentum < -0.2) {
        const momentumExcess = Math.min(0.4, Math.abs(profile.momentum) - 0.2);
        sessionArcAdjust = -0.05 - momentumExcess * 0.375; /* -0.05 ~ -0.20 */
    }

    /* v1.62.5（优化建议 #3）：session-arc 自适应模板（opt-in）。
     *
     * 背景：profileAudit 契约 session-arc-warm-to-cool 在 67%+ 局违规——sessionArc
     * 全程为负，没有 "peak 正向" 段，违反"开头负 → 中段正 → 收官略负"半圆弧设计。
     *
     * 根因：现状 peak 段 sessionArcAdjust=0，没有"中段加压"的正向输出。
     *
     * 修复（opt-in）：通过 game_rules.json 显式开启：
     *   "adaptiveSpawn": { "sessionArcCfg": { "peakBoostEnabled": true, "peakBoost": 0.05 } }
     *
     *   - peak 段（mid-session）+ momentum 在 [-0.2, 0.3] 区间 → 给 sessionArcAdjust += peakBoost
     *   - momentum 强势正向（>0.3，已经进入兴奋期）→ 不再加 boost，避免叠加爽点
     *   - momentum 强负向（<-0.2）→ 也不加 boost，避免在挣扎期反向加压
     *
     * 默认关闭：保持现有 sessionArc 行为完全不变。开启需走小流量 A/B 验证。
     */
    const sessionArcCfg = GAME_RULES.adaptiveSpawn?.sessionArcCfg ?? {};
    if (sessionArcCfg.peakBoostEnabled === true && sessionArc === 'peak') {
        const m = profile.momentum;
        if (m >= -0.2 && m <= 0.3) {
            const peakBoost = Number.isFinite(sessionArcCfg.peakBoost) ? sessionArcCfg.peakBoost : 0.05;
            sessionArcAdjust += peakBoost;
        }
    }

    /* v1.51 末段崩盘救济（endSessionDistress）—— 解决"前 5 分钟良好 + 最后 1 分钟崩盘"
     * 时累计 stress 仍判舒缓的盲区。当 sessionPhase=late + momentum 强烈下行时，
     * 给一笔独立的减压脉冲，确保 stress 与玩家真实体感同向。
     *   momentum ≤ -0.30 触发；frustrationLevel ≥ 4 时再叠加 0.06。
     * 与 sessionArcAdjust 互补：sessionArcAdjust 看 cooldown 弧线档位、本信号看
     * "玩家自己的崩盘强度"，两者同时为负但语义独立。 */
    let endSessionDistress = 0;
    if (profile.sessionPhase === 'late' && profile.momentum <= -0.30) {
        const slope = Math.min(0.30, Math.abs(profile.momentum) - 0.30);
        endSessionDistress = -(0.05 + slope * 0.5);
        if ((profile.frustrationLevel ?? 0) >= 4) endSessionDistress -= 0.06;
        endSessionDistress = Math.max(-0.25, endSessionDistress);
    }

    /* ---------- Layer 3: 局内分数里程碑（与跨局成熟度里程碑无关） ----------
     * v1.55 §4.6：把 currentScore 透传给 deriveScoreMilestones，让"已破 PB 的本局"
     * 自动追加 +10% / +25% 的二度里程碑节点，避免破 PB 后失去节奏。 */
    const scoreMilestones = deriveScoreMilestones(ctx.bestScore ?? 0, score);
    const scoreMilestoneCheck = checkScoreMilestone(score, _prevScoreMilestone, scoreMilestones, ctx.bestScore ?? 0);
    if (scoreMilestoneCheck.hit) _prevScoreMilestone = scoreMilestoneCheck.milestone;
    const delight = deriveDelightTuning(profile, ctx, _boardFill ?? 0, cfg.delight ?? {});
    const abilityRiskCfg = GAME_RULES.playerAbilityModel?.adaptiveSpawnRiskAdjust ?? {};
    const abilityRiskMinConf = abilityRiskCfg.minConfidence ?? 0.25;
    const abilityRiskThreshold = abilityRiskCfg.riskThreshold ?? 0.62;
    const abilityRiskRelief = abilityRiskCfg.stressRelief ?? -0.08;
    const abilityRiskAdjust = ability.confidence >= abilityRiskMinConf && ability.riskLevel >= abilityRiskThreshold
        ? abilityRiskRelief * Math.min(1, (ability.riskLevel - abilityRiskThreshold) / Math.max(0.001, 1 - abilityRiskThreshold))
        : 0;
    const boardRisk = deriveBoardRisk(_boardFill ?? 0, holePressure, ability.riskLevel ?? 0);
    const boardDifficulty = deriveBoardDifficulty(_boardFill ?? 0, holePressure, topoCfg);
    const boardRiskReliefAdjust = boardRisk * (topoCfg.boardRiskReliefStress ?? -0.1);
    const holeReliefAdjust = holePressure * (topoCfg.holeReliefStress ?? -0.16);

    /* ---------- 难度偏移：让 easy/normal/hard 显著影响自适应 stress 基线 ---------- */
    const fallbackDifficultyBias = baseStrategyId === 'easy' ? -0.22
        : baseStrategyId === 'hard' ? 0.22 : 0;
    const difficultyBias = Number.isFinite(difficultyTuning.stressBias)
        ? difficultyTuning.stressBias
        : fallbackDifficultyBias;

    /* ---------- 全球化个性化边界：只消费行为/偏好/设备负担，不消费敏感属性 ----------
     * motivationIntent 是中长期动机口径；spawnIntent 仍负责本轮出块意图。
     * ctx.fairChallenge / ctx.socialFairChallenge 可用于异步挑战等公平模式，强制关闭个体化调节。
     */
    const personalizationContext = profile.personalizationContext ?? {};
    const personalizationOptions = personalizationContext.options ?? profile.personalizationOptions ?? {};
    const socialFairChallenge = ctx.fairChallenge === true || ctx.socialFairChallenge === true;
    const personalizationEnabled = personalizationOptions.enabled !== false
        && personalizationOptions.difficulty !== false
        && !socialFairChallenge;
    const motivationIntent = personalizationEnabled
        ? (personalizationContext.motivationIntent ?? profile.motivationIntent ?? 'balanced')
        : 'balanced';
    const behaviorSegment = personalizationEnabled
        ? (personalizationContext.behaviorSegment ?? profile.behaviorSegment ?? 'balanced')
        : 'balanced';
    const accessibilityLoad = personalizationEnabled
        ? Math.max(0, Math.min(1, Number(personalizationContext.accessibilityLoad ?? profile.accessibilityLoad ?? 0) || 0))
        : 0;
    const returningWarmupStrength = personalizationEnabled
        ? Math.max(0, Math.min(1, Number(personalizationContext.returningWarmupStrength ?? profile.returningWarmupStrength ?? 0) || 0))
        : 0;
    let motivationStressAdjust = 0;
    if (motivationIntent === 'challenge' && skill >= 0.68 && (ability.riskLevel ?? 0) <= 0.48) {
        motivationStressAdjust = 0.045;
    } else if (motivationIntent === 'relaxation' || motivationIntent === 'competence') {
        motivationStressAdjust = -0.045;
    }
    const accessibilityStressAdjust = accessibilityLoad > 0.2 ? -0.08 * accessibilityLoad : 0;
    const returningWarmupAdjust = returningWarmupStrength > 0 ? -0.10 * returningWarmupStrength : 0;

    /* ---------- v1.13：友好盘面救济（提前推算节奏相位）----------
     * deriveRhythmPhase 是纯函数，提前调用一次用于 friendlyBoardRelief 判定，
     * 真正写入 spawnHints 的 rhythmPhase 仍由后续主路径决定。
     */
    const earlyRhythmPhase = deriveRhythmPhase(profile, ctx, _boardFill ?? 0);
    const friendlyBoardRelief = deriveFriendlyBoardRelief(
        ctx, _boardFill ?? 0, holes, earlyRhythmPhase, cfg.friendlyBoard ?? {}
    );

    /* ---------- v1.30：瓶颈低谷救济（bottleneckRelief） ----------
     *
     * 物理含义：上个 dock 周期内，玩家所看到的"未放置候选块"中可放位最少的那一块
     * 在该时刻能放进多少个格子（trough = min over the cycle）。
     *
     *   - trough=0  → 上一刻已经放不进任何位置（极端死局边缘）
     *   - trough=1~2→ 只剩 1~2 个落点（玩家被迫接受唯一解，体验高压）
     *   - trough≥5 → 仍有充分自由度
     *
     * 该信号是对 holes/friendlyBoard 等"盘面静态拓扑"信号的**动态补充**：
     * 即便 holes=0、近满线充足，若某一拍候选块只剩 1~2 个合法落子，依然是高压。
     * 用作 stressBreakdown.bottleneckRelief（负值），并：
     *   1. 进入 playerDistress → 影响 spawnIntent='relief' 派生
     *   2. 抬高 spawnHints.clearGuarantee + 偏小块（在主路径里实现，下方 hint 段）
     *
     * 互抑：与 friendlyBoardRelief / recoveryAdjust 同向时按 0.5 折扣，避免过度叠加；
     *       新手保护期内置零，避免被动减压被进一步推高造成插值越档。
     */
    let bottleneckRelief = 0;
    const bottleneckTroughRaw = Number(ctx.bottleneckTrough);
    const bottleneckSamples = Math.max(0, Number(ctx.bottleneckSamples) || 0);
    const bottleneckThreshold = Number.isFinite(topoCfg.bottleneckTroughThreshold)
        ? topoCfg.bottleneckTroughThreshold : 2;
    const bottleneckReliefMax = Number.isFinite(topoCfg.bottleneckReliefMax)
        ? topoCfg.bottleneckReliefMax : -0.12;
    const hasBottleneckSignal = Number.isFinite(bottleneckTroughRaw)
        && bottleneckSamples > 0
        && bottleneckTroughRaw <= bottleneckThreshold
        /* 新手保护期：onboarding 自身已用 firstSessionStressOverride 显著钳制 stress，
         * 再叠加 bottleneckRelief 既无意义（被覆写吃掉）又会让 breakdown 误显示「双重救济」。 */
        && profile.isInOnboarding !== true;
    if (hasBottleneckSignal) {
        const sev = Math.max(0, (bottleneckThreshold - bottleneckTroughRaw))
            / Math.max(1, bottleneckThreshold);
        bottleneckRelief = bottleneckReliefMax * Math.min(1, 0.4 + 0.6 * sev);
        /* 与 friendlyBoardRelief / recoveryAdjust 显著同向时减半，避免减压栈叠 */
        if (friendlyBoardRelief <= -0.10) bottleneckRelief *= 0.5;
        if ((profile.needsRecovery === true)
            || (Number.isFinite(profile.frustrationLevel)
                && profile.frustrationLevel >= (eng.frustrationThreshold ?? 4))) {
            bottleneckRelief *= 0.5;
        }
    }

    /* ---------- v1.46：反应时间纳入 stress 微调 ----------
     *
     * 物理含义：pickToPlaceMs = 玩家激活候选块（startDrag）→ 落子完成 的纯执行段。
     * 与 thinkMs 不同，它已经剔除「等系统出新块 / 看新一波」等系统侧延迟，更接近
     * 「玩家本人此刻的认知 / 操作负担」。
     *
     * 调控规则：
     *   - reactionMs < fastMs（默认 900ms）持续 → 反射式快放，倾向 bored，+stress（最多 +maxAdjust）
     *   - reactionMs > slowMs（默认 2200ms）持续 → 拖动中犹豫，倾向 anxious，−stress（最多 −maxAdjust）
     *   - 中段（fastMs~slowMs）= 健康，0
     *
     * 阈值依据：本地回放有效 reaction 样本（n=4260）p5≈929ms、p50≈1447ms、p95≈2140ms。
     * 旧阈值 350/4500 在该分布上触发率均为 0%，无法承担反馈职责。
     *
     * 钳值 maxAdjust 默认 0.05，刻意小于 flowAdjust(±0.12)、recoveryAdjust(−0.2) 等主信号
     * 一个量级——它是对 thinkMs/missRate 等已有信号的"轻量补充"，不应主导 stress。
     *
     * 启用门槛 minSamples=3，避免冷启动 / 教程脚本路径上的程序化样本污染。
     *
     * 互抑：与 nearMissAdjust（玩家差一点失败的极强减压信号）显著同向时，reactionAdjust
     *      作为弱信号自动让位（直接零），避免在已经强烈减压的瞬间再叠加微小同向偏移。
     */
    const reactionCfg = cfg.reactionAdjust ?? {};
    const reactionEnabled = reactionCfg.enabled !== false;
    const reactionMs = Number(profile.metrics?.pickToPlaceMs);
    const reactionSamples = Math.max(0, Number(profile.metrics?.reactionSamples ?? 0) || 0);
    const reactionMinSamples = Math.max(1, Number(reactionCfg.minSamples ?? 3));
    const reactionFastMs = Math.max(50, Number(reactionCfg.fastMs ?? 900));
    const reactionSlowMs = Math.max(reactionFastMs + 100, Number(reactionCfg.slowMs ?? 2200));
    const reactionFastFullMs = Math.max(50, Math.min(reactionFastMs - 1, Number(reactionCfg.fastFullMs ?? 500)));
    const reactionSlowFullMs = Math.max(reactionSlowMs + 1, Number(reactionCfg.slowFullMs ?? 3200));
    const reactionMaxAdjust = Math.max(0, Number(reactionCfg.maxAdjust ?? 0.05));
    let reactionAdjust = 0;
    if (
        reactionEnabled
        && Number.isFinite(reactionMs)
        && reactionSamples >= reactionMinSamples
    ) {
        if (reactionMs < reactionFastMs) {
            const intensity = Math.min(1, (reactionFastMs - reactionMs) / Math.max(1, reactionFastMs - reactionFastFullMs));
            reactionAdjust = +reactionMaxAdjust * intensity;
        } else if (reactionMs > reactionSlowMs) {
            const overshoot = Math.min(1, (reactionMs - reactionSlowMs) / Math.max(1, reactionSlowFullMs - reactionSlowMs));
            reactionAdjust = -reactionMaxAdjust * overshoot;
        }
        /* 与 nearMissAdjust 显著同向时让位（弱信号让弱给强） */
        if (nearMissAdjust < -0.05 && reactionAdjust < 0) {
            reactionAdjust = 0;
        }
    }

    /* ---------- 综合 stress ---------- */
    const stressBreakdown = {
        scoreStress: applySignal(signalCfg, 'scoreStress', scoreStress),
        runStreakStress: applySignal(signalCfg, 'runStreakStress', runMods.stressBonus),
        difficultyBias: applySignal(signalCfg, 'difficultyBias', difficultyBias),
        skillAdjust: applySignal(signalCfg, 'skillAdjust', skillAdjust),
        flowAdjust: applySignal(signalCfg, 'flowAdjust', flowAdjust),
        reactionAdjust: applySignal(signalCfg, 'reactionAdjust', reactionAdjust),
        pacingAdjust: applySignal(signalCfg, 'pacingAdjust', pacingAdjust),
        recoveryAdjust: applySignal(signalCfg, 'recoveryAdjust', recoveryAdjust),
        frustrationRelief: applySignal(signalCfg, 'frustrationRelief', frustRelief),
        preFrustrationRelief: applySignal(signalCfg, 'preFrustrationRelief', preFrustrationRelief),
        boardFrustrationRelief: applySignal(signalCfg, 'boardFrustrationRelief', boardFrustrationRelief),
        decisionLoadRelief: applySignal(signalCfg, 'decisionLoadRelief', decisionLoadRelief),
        comboAdjust: applySignal(signalCfg, 'comboAdjust', comboAdjust),
        nearMissAdjust: applySignal(signalCfg, 'nearMissAdjust', nearMissAdjust),
        feedbackBias: applySignal(signalCfg, 'feedbackBias', feedbackBias),
        feedbackBiasDampingAdjust: applySignal(signalCfg, 'feedbackBiasDampingAdjust', feedbackBiasDampingAdjust),
        trendAdjust: applySignal(signalCfg, 'trendAdjust', trendAdjust),
        sessionArcAdjust: applySignal(signalCfg, 'sessionArcAdjust', sessionArcAdjust),
        endSessionDistress: applySignal(signalCfg, 'endSessionDistress', endSessionDistress),
        holeReliefAdjust: applySignal(signalCfg, 'holeReliefAdjust', holeReliefAdjust),
        boardRiskReliefAdjust: applySignal(signalCfg, 'boardRiskReliefAdjust', boardRiskReliefAdjust),
        abilityRiskAdjust: applySignal(signalCfg, 'abilityRiskAdjust', abilityRiskAdjust),
        delightStressAdjust: applySignal(signalCfg, 'delightStressAdjust', delight.stressAdjust),
        friendlyBoardRelief: applySignal(signalCfg, 'friendlyBoardRelief', friendlyBoardRelief),
        bottleneckRelief: applySignal(signalCfg, 'bottleneckRelief', bottleneckRelief),
        motivationStressAdjust: applySignal(signalCfg, 'motivationStressAdjust', motivationStressAdjust),
        accessibilityStressAdjust: applySignal(signalCfg, 'accessibilityStressAdjust', accessibilityStressAdjust),
        returningWarmupAdjust: applySignal(signalCfg, 'returningWarmupAdjust', returningWarmupAdjust),
        boardRisk,
        /* v1.30 派生痕迹：原始 trough 与样本数，用于面板/回放反查 */
        bottleneckTrough: hasBottleneckSignal ? bottleneckTroughRaw : null,
        bottleneckSamples
    };

    /* v1.30：求和时排除 boardRisk（独立分支）与 bottleneckTrough/Samples（派生痕迹） */
    const _SUM_SKIP = new Set(['boardRisk', 'bottleneckTrough', 'bottleneckSamples']);
    let stress = Object.entries(stressBreakdown)
        .filter(([key, v]) => !_SUM_SKIP.has(key) && Number.isFinite(v))
        .reduce((sum, [, value]) => sum + value, 0);
    stressBreakdown.rawStress = stress;
    /* 审计字段：后置调制均以 *Adjust 记录 delta，便于还原 finalStress 来源。 */
    stressBreakdown.lifecycleCapAdjust = 0;
    stressBreakdown.lifecycleBandAdjust = 0;
    stressBreakdown.onboardingStressOverrideAdjust = 0;
    stressBreakdown.winbackStressCapAdjust = 0;
    stressBreakdown.clampAdjust = 0;
    stressBreakdown.smoothingAdjust = 0;
    stressBreakdown.minStressFloorAdjust = 0;
    stressBreakdown.flowPayoffCapAdjust = 0;

    /* ---------- v1.32：S/M 标签生命周期难度调制 ----------
     * 基于 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT，不同阶段的玩家承受不同的压力上限。
     * S0/S4 回流期需要保护；S2/S3 成长/稳定期可以承受更高压力。
     */
    let lifecycleStressAdjust = 0;
    let lifecycleCapAdjust = 0;
    let lifecycleBandAdjust = 0;
    try {
        /* v1.49.x P2-4：优先用 getCachedLifecycleSnapshot（300ms TTL，避免每帧重算）。
         * lifecycleOrchestrator 在 sessionStart/End 会主动 invalidate，
         * 所以 cache 与状态变化同步；同帧内 advisor / 面板 / spawn 共用一份 snapshot。
         *
         * 注意：测试和某些直读场景下 profile 的私有字段（_daysSinceInstall 等）
         * 可能直接被 mock 而 lifecyclePayload getter 与之不一致，因此当外部
         * 显式传入 profile.daysSinceInstall / daysSinceLastActive 与 payload
         * 不匹配时，仍以原始 getLifecycleMaturitySnapshot 为准，避免偏移。 */
        /* 优先读 profile 私有字段（测试 / lifecycleOrchestrator 直接 mock 时唯一来源），
         * 再 fallback 到公开 getter；这样既保留 v1.32 既有契约（_daysSinceInstall 等），
         * 也兼容 lifecyclePayload getter 路径。 */
        const snap = getLifecycleMaturitySnapshot({
            daysSinceInstall: profile?._daysSinceInstall ?? profile?.daysSinceInstall ?? 0,
            totalSessions: profile?._totalSessions ?? profile?.totalSessions ?? profile?.lifetimeGames ?? 0,
            daysSinceLastActive: profile?._daysSinceLastActive ?? profile?.daysSinceLastActive ?? 0,
        });
        let stage = snap?.stageCode ?? 'S0';
        let band = snap?.band ?? 'M0';

        /* 如果存在 cached snapshot 且 stage 与直读结果一致，则复用 band 以节省其他下游调用。 */
        const cached = getCachedLifecycleSnapshot(profile);
        if (cached?.stage?.code && cached.stage.code === stage) {
            band = cached.maturity?.band ?? band;
        }
        /* v1.50：调制表抽到 lifecycle/lifecycleStressCapMap.js（单一来源），
         * 此处仅查表 + 应用；详细 (S·M) → cap/adjust 字典见该模块。
         *
         * v1.68（PR2）：把 RunOverRunArc（today's run number → opener/momentum/peak/
         * fatigue/cooldown）作为乘性 modifier 叠加进来；arc 缺失或配置缺失即不调制，
         * 保持向后兼容。这样 25 格 S×M 表自动派生出 125 格"日内疲劳/赌气"语义视图。 */
        const arcMod = resolveArcLifecycleModifier(ctx.runOverRunArc, GAME_RULES.runOverRunArc);
        const config = getLifecycleStressCap(stage, band, arcMod);
        if (config) {
            /* 1. 应用压力上限：当前 stress 超过上限时压低 */
            if (stress > config.cap) {
                lifecycleStressAdjust = config.cap - stress;
                lifecycleCapAdjust = lifecycleStressAdjust;
                stress = config.cap;
            }
            /* 2. 额外偏移：某些阶段整体减压或加压 */
            lifecycleBandAdjust = Number(config.adjust) || 0;
            stress += lifecycleBandAdjust;
            stress = Math.max(-0.2, Math.min(1, stress));
        }
        stressBreakdown.lifecycleStage = stage;
        stressBreakdown.lifecycleBand = band;
        stressBreakdown.lifecycleCapAdjust = lifecycleCapAdjust;
        stressBreakdown.lifecycleBandAdjust = lifecycleBandAdjust;
        stressBreakdown.lifecycleStressAdjust = lifecycleStressAdjust;
        /* v1.68：暴露 arc 标签和 modifier，让 advisor/insight 面板能解释"为什么今天
         * 这局 stress cap 比平时低 X%"。无 arc 时字段为 null，下游应作 fallback。 */
        stressBreakdown.runOverRunArc = ctx.runOverRunArc ?? null;
        stressBreakdown.runOverRunArcCapScale = arcMod?.capScale ?? 1;
        stressBreakdown.runOverRunArcAdjustDelta = arcMod?.adjustDelta ?? 0;
    } catch { /* lifecycle 数据缺失不影响主流程 */ }

    /* ---------- 特殊覆写：新手保护 ---------- */
    const inOnboarding = profile.isInOnboarding;
    if (inOnboarding) {
        const prevStress = stress;
        stress = Math.min(stress, eng.firstSessionStressOverride ?? -0.15);
        stressBreakdown.onboardingStressOverrideAdjust = stress - prevStress;
    }

    /* ---------- v1.48 winback 保护包：sress cap ----------
     * `winbackProtection` 在 game.startGame → onSessionStart 时检测玩家是否
     * ≥7 天未活跃，若是则激活 PROTECTED_ROUNDS=3 局保护期；保护期内：
     *   - stress 取 min(当前, preset.stressCap=0.6)：避免回流第一局就死局
     *   - clearGuarantee +preset.clearGuaranteeBoost（在下方 spawnHints 段叠加）
     *   - sizePreference 进一步偏小块（在下方 spawnHints 段叠加）
     * 这是 P0-B 的接线点；此前 winbackProtection.getActivePreset 在
     * adaptiveSpawn / blockSpawn / game.js 全无引用，回流玩家完全无保护。 */
    let winbackPreset = null;
    try { winbackPreset = getActiveWinbackPreset(); } catch { /* ignore */ }
    if (winbackPreset && Number.isFinite(winbackPreset.stressCap)) {
        const prevStress = stress;
        stress = Math.min(stress, winbackPreset.stressCap);
        stressBreakdown.winbackStressCap = winbackPreset.stressCap;
        stressBreakdown.winbackStressCapAdjust = stress - prevStress;
    }

    /* ---------- B 类进阶挑战档：高分段自动加压 ----------
     * 触发条件：
     *   1. 玩家分群为 B（中度无尽）或 sessionTrend=stable/rising
     *   2. 当前分数 ≥ 历史最高分 × 0.8（接近最高分时增加挑战感，对应 D2/D3 段）
     *   3. stress 尚未满档（避免叠加溢出）
     *
     * v1.55（BEST_SCORE_CHASE_STRATEGY §4.2 + §4.5）新增四重 bypass：
     *   - profile.needsRecovery：玩家正在被救场，加压会与减压打架
     *   - hasBottleneckSignal：v1.30 bottleneckRelief 已介入，再加压等于双重打击
     *   - frustrationLevel ≥ frustThreshold：已经连失多步，加压会让玩家彻底放弃
     *   - sessionArc === 'warmup'：本局前 3 轮，不应让玩家开局就被告知"已接近 PB"
     *   - profile.isInOnboarding：onboarding 期已强制 stressOverride
     *
     * v1.55 同时把"被 bypass 的触发原因"写入 stressBreakdown.challengeBoostBypass
     * 供 DFV / playerInsightPanel / 单测验证；未触发时为 null。
     * 效果：stress 额外 +0.08~+0.15，使出块更复杂、填充更密
     * ---------------------------------------------------------- */
    const segment5 = profile.segment5 ?? 'A';
    const sessionTrend = profile.sessionTrend ?? 'stable';
    const pbDistanceClose = ctx.bestScore > 0 && score >= ctx.bestScore * 0.8;
    /** @type {string|null} 命中的 bypass 原因（按优先级返回首个）；未触发任何 bypass 时为 null */
    let challengeBoostBypass = null;
    if (!pbDistanceClose) {
        challengeBoostBypass = 'pb_distance_far';
    } else if (!(segment5 === 'B' || sessionTrend !== 'declining')) {
        challengeBoostBypass = 'segment_declining';
    } else if (!(stress < 0.7)) {
        challengeBoostBypass = 'stress_saturated';
    } else if (profile.needsRecovery === true) {
        challengeBoostBypass = 'recovery';
    } else if (hasBottleneckSignal) {
        challengeBoostBypass = 'bottleneck';
    } else if (Number.isFinite(profile.frustrationLevel)
        && profile.frustrationLevel >= frustThreshold) {
        challengeBoostBypass = 'frustration';
    } else if (decisionLoadReliefActive) {
        challengeBoostBypass = 'decision_load';
    } else if (sessionArc === 'warmup') {
        challengeBoostBypass = 'warmup';
    } else if (ctx.postPbReleaseActive === true) {
        /* v1.55 §4.9：破纪录释放窗口期内 challengeBoost 完全禁用，
         * 给玩家"破纪录后短暂的'我赢了'情绪"留出释放空间。 */
        challengeBoostBypass = 'post_pb_release';
    }
    const isBClassChallenge = challengeBoostBypass === null;
    /* v1.56.4 §5.α.8 PB 增长率反向加压：pbGrowthFast=true 时把 challengeBoost cap
     * 从 baseCap 临时上调到 baseCap+capDelta。pbGrowthTracker 检测到 7d 内 PB
     * 连续 ≥10% 增长时，game.js 通过 ctx.pbGrowthFast 注入，让 D2/D3 段提前进入
     * 更强加压区，防止 PB 在短时间内继续膨胀。仅在 challengeBoost 未 bypass 时生效。
     *
     * v1.56.6 §5.α.9 P2：baseCap 配置化（默认 0.18，旧硬编码 0.15）。D3 段（pct=0.95）
     * 加压增量从 17% 提升到 ~20%，让"决战感"在 stress 维度更可感。 */
    const _growthThrottleCfg = (cfg.pbChase?.pbGrowthThrottle) ?? {};
    const _growthCapDelta = (_growthThrottleCfg.enabled !== false
        && ctx.pbGrowthFast === true
        && Number.isFinite(_growthThrottleCfg.challengeBoostCapDelta))
        ? Math.max(0, Math.min(0.20, _growthThrottleCfg.challengeBoostCapDelta))
        : 0;
    const _challengeBoostCfg = (cfg.pbChase?.challengeBoost) ?? {};
    // θ-E: challengeBoost cap + slope (modelConfig 优先, 否则 cfg.pbChase.*, 否则硬默认)
    const _mc = ctx.modelConfig || {};
    const _challengeBaseCap = Number.isFinite(_mc.challengeBoostCap)
        ? _mc.challengeBoostCap
        : (Number.isFinite(_challengeBoostCfg.baseCap) ? _challengeBoostCfg.baseCap : 0.18);
    const _challengeSlope = Number.isFinite(_mc.challengeBoostSlope) ? _mc.challengeBoostSlope : 0.75;
    if (isBClassChallenge) {
        const _challengeCap = _challengeBaseCap + _growthCapDelta;
        let challengeBoost = Math.min(_challengeCap, (score / ctx.bestScore - 0.8) * _challengeSlope);
        /* v1.29：友好盘面救济与 B 类挑战加压同帧显著时互抑，减轻 stress 锯齿抖动 */
        const fbr = stressBreakdown.friendlyBoardRelief ?? 0;
        if (Number.isFinite(fbr) && fbr < -0.09 && challengeBoost > 0) {
            challengeBoost *= 0.42;
        }
        stress = Math.min(0.85, stress + challengeBoost);
        stressBreakdown.challengeBoost = challengeBoost;
        if (_growthCapDelta > 0) stressBreakdown.challengeBoostGrowthCapBonus = _growthCapDelta;
    } else {
        stressBreakdown.challengeBoost = 0;
    }
    /* v1.55：把 bypass 原因写入 breakdown 供面板/单测；未来 DFV 可显示一句话解释。 */
    stressBreakdown.challengeBoostBypass = challengeBoostBypass;

    /* v1.61：PB 追击压力激活 — 接近/超越 PB 时加压优先级高于普通救济信号。
     *
     * 触发条件：
     *   - isBClassChallenge=true（score>=best×0.8 且 challengeBoost bypass 全通过）
     *   - !_pbcRelief（端到端的 relief 信号：endSessionDistress / frustrationCritical
     *     / ctx.forceReliefIntent 三者任一 —— 与下方 line 2299 forceReliefIntent 同口径，
     *     此处提前算一次避免 TDZ 引用）
     *   - _boardFill < 0.72（非临满，玩家危险时不加压）
     *   - !isInOnboarding（新手引导期豁免）
     *
     * v1.61.17 修复：旧版直接引用尚未声明的 forceReliefIntent → ReferenceError。 */
    const _pbcEndDistress = !(ctx.bestScore > 0 && score > ctx.bestScore)
        && profile.sessionPhase === 'late' && profile.momentum <= -0.30;
    const _pbcFrustCritical = (profile.frustrationLevel ?? 0) >= 5;
    const _pbcRelief = _pbcEndDistress || _pbcFrustCritical || ctx.forceReliefIntent === true;
    const pbChasePressureActive = isBClassChallenge
        && !_pbcRelief
        && (_boardFill ?? 0) < 0.72
        && !profile?.isInOnboarding;
    stressBreakdown.pbChasePressureActive = pbChasePressureActive;

    /* v1.56 §2.3：D3 决战段 pbExtremeChase 顺序刚性提升 ——
     * 当 pct ∈ [0.95, 1.0) 且未在释放窗口 / 救济期 / 瓶颈 / warmup 时，
     * 给 orderRigor 公式注入 modeBoost-like 的额外提升量（pbExtremeOrderBoost），
     * 让"顺序约束"在最后 5% 临界段比 challengeBoost 数值加压更精细。
     * 注意：本变量仅暂存，在下方 orderRigor 计算块消费；不直接改 stress。
     * 与 §4.2 D3 单线特效克制配套，形成"过程加难 + 失败反差"的最大化叙事。
     *
     * v1.56.2 §5.α.6 认知一致性守卫：bestScore < pbChase.minBestScoreForIntenseFeedback
     * （默认 200）时不触发——避免新手 best=80 时 score=78 也走"顺序约束"导致开局
     * 莫名其妙感受到一波规则压。 */
    let pbExtremeOrderBoost = 0;
    const _pbChaseCfg = cfg.pbChase ?? {};
    const _intenseFloor = Number.isFinite(_pbChaseCfg.minBestScoreForIntenseFeedback)
        ? _pbChaseCfg.minBestScoreForIntenseFeedback
        : 200;
    const _commonOrderGates = ctx.bestScore >= _intenseFloor
        && !ctx.postPbReleaseActive
        && profile.needsRecovery !== true
        && !hasBottleneckSignal
        && sessionArc !== 'warmup'
        && !inOnboarding;
    if (_commonOrderGates && score >= ctx.bestScore * 0.95 && score < ctx.bestScore) {
        pbExtremeOrderBoost = 0.20;  // 与 difficultyTuning.hard.orderRigorBoost=0.30 同量级但更克制
        stressBreakdown.pbExtremeOrderBoost = pbExtremeOrderBoost;
    }

    /* v1.56.4 §5.α.8 D4 超 PB 持续加压（pbOvershootBoost + 弱顺序约束扩展）——
     *
     * 用户原则："超 PB 高强度加压（防止分数膨胀，透支生命周期）"。
     * v1.56 原版 challengeBoost cap=0.15 在 pct ≥ 1.0 即饱和（公式 (pct-0.8)·0.75
     * 在 pct=1.0 时已 =0.15），因此 D4 段加压度不再随分数比例提升 —— 与原则冲突。
     *
     * 本机制在 D4 段（score > bestScore）追加：
     *   1) stress 维度：pbOvershootBoost = maxBoost · log10(1 + slope·overshoot)
     *      - overshoot = score/best - 1.0
     *      - pct=1.0 → 0；pct=1.25 → ~0.08；pct=1.50 → ~0.12；pct=2.0 → ~0.16
     *      - 对数曲线保证"超得越多越难，但边际递减"，避免线性失控
     *      - 与 challengeBoost 共享 cap 调到 capStress（默认 0.90，高于普通 0.85）
     *   2) orderRigor 维度：pbExtremeOrderBoost 延续到 D4 但强度更弱（默认 0.08，约 D3 的 40%）
     *      与"破 PB 后顺序约束立即消失"相反，给玩家"超得越多越紧"的连续体感
     *   3) spawnHints 维度（下方 spawnHints 段处理）：multiClearBonus 上限收紧、
     *      sizePreference 上移、clearGuarantee 下移
     *
     * 同源 bypass 链：minBestScoreForIntenseFeedback / postPbRelease / recovery /
     * bottleneck / warmup / onboarding 全部直接跳过，与 pbExtremeOrderBoost 同口径。 */
    const _overshootCfg = (cfg.pbChase?.overshoot) ?? {};
    let pbOvershootBoost = 0;
    let pbOvershootActive = false;
    if (_overshootCfg.enabled !== false
        && _commonOrderGates
        && score > ctx.bestScore) {
        const overshoot = (score / ctx.bestScore) - 1.0;
        // θ-E: pbOvershootMax (modelConfig 优先)
        const maxBoost = Number.isFinite(_mc.pbOvershootMax)
            ? _mc.pbOvershootMax
            : (Number.isFinite(_overshootCfg.maxBoost) ? _overshootCfg.maxBoost : 0.16);
        const slope = Number.isFinite(_overshootCfg.slope) ? _overshootCfg.slope : 5.0;
        const capStress = Number.isFinite(_overshootCfg.capStress) ? _overshootCfg.capStress : 0.90;
        pbOvershootBoost = Math.min(maxBoost, maxBoost * Math.log10(1 + slope * overshoot) / Math.log10(1 + slope));
        if (pbOvershootBoost > 0) {
            stress = Math.min(capStress, stress + pbOvershootBoost);
            pbOvershootActive = true;
        }
        // D4 段弱顺序约束扩展：与 D3 同机制但强度更弱，让"超 PB 后越来越紧"连续可感
        const orderBoostInD4 = Number.isFinite(_overshootCfg.orderBoostInD4) ? _overshootCfg.orderBoostInD4 : 0.08;
        if (orderBoostInD4 > 0) {
            pbExtremeOrderBoost = Math.max(pbExtremeOrderBoost, orderBoostInD4);
            stressBreakdown.pbExtremeOrderBoost = pbExtremeOrderBoost;
        }
    }
    stressBreakdown.pbOvershootBoost = pbOvershootBoost;
    stressBreakdown.pbOvershootActive = pbOvershootActive;

    stressBreakdown.beforeClamp = stress;
    stress = Math.max(-0.2, Math.min(1, stress));
    stressBreakdown.afterClamp = stress;
    stressBreakdown.clampAdjust = stressBreakdown.afterClamp - stressBreakdown.beforeClamp;

    /* v1.16：占用率衰减（occupancyDamping）
     * 当盘面填充很低时，scoreStress / runStreakStress 等"分数驱动"信号会把综合 stress
     * 推到 0.8+，但拟人化压力表此时显示「🥵 高压」与玩家在空盘上的实际体感严重不符。
     * 这里在 clamp 之后、smoothing 之前对正向 stress 乘一个 [0.4, 1.0] 的缩放因子：
     *   - fill=0    → ×0.4（最大衰减；空盘只剩底色压力）
     *   - fill=0.25 → ×0.5
     *   - fill=0.39 → ×0.78（产线观察到的 stress=0.89 → 0.69，进入 tense 而非 intense）
     *   - fill≥0.5  → ×1.0（完全不衰减；中高占用以上保留原有信号）
     * 负向 stress（救济/挫败）不衰减，避免空盘减压被无意撤销。
     *
     * v1.29：对衰减用 `_occupancyFillAnchor`（跨 spawn 缓降）—— 消行后瞬时变空盘时，
     * 仍短暂沿用较高占用锚点，避免正向 stress 因 damping 撤除而单帧跳升。 */
    const rawFillOcc = _boardFill ?? 0;
    let occAnchor = Number(ctx._occupancyFillAnchor);
    if (!Number.isFinite(occAnchor)) occAnchor = rawFillOcc;
    if (rawFillOcc >= occAnchor) occAnchor = rawFillOcc;
    else occAnchor = Math.max(rawFillOcc, occAnchor * 0.86 + rawFillOcc * 0.14);
    let occupancyDamping = 0;
    /* v1.56.6 §5.α.9 P0-C2：D4 段豁免 occupancyDamping ——
     * 玩家破 PB 后通常伴随 perfect clear / 多消大消（盘面骤空 → fill 极低），
     * 旧 damping 公式 ×0.4~×0.5 会把 pbOvershootBoost 的加压全部消解，与"超 PB 高强度
     * 加压防分数膨胀"原则直接冲突。本豁免让 D4 段保留完整的加压量。
     * 受 pbChase.overshoot.bypassOccupancyDamping 配置开关控制。 */
    const _ohBypassOcc = (cfg.pbChase?.overshoot?.bypassOccupancyDamping) !== false;
    const _ohActiveBypassOcc = pbOvershootActive && _ohBypassOcc;
    if (stress > 0 && !_ohActiveBypassOcc) {
        const occupancyScale = Math.max(0.4, Math.min(1, occAnchor / 0.5));
        if (occupancyScale < 1) {
            const damped = stress * occupancyScale;
            occupancyDamping = damped - stress;
            stress = damped;
        }
    }
    stressBreakdown.occupancyDamping = occupancyDamping;
    stressBreakdown.occupancyDampingBypassed = _ohActiveBypassOcc;
    stressBreakdown.afterOccupancy = stress;
    const immediateRelief = profile.needsRecovery
        || profile.hadRecentNearMiss
        || profile.frustrationLevel >= frustThreshold
        || boardRisk >= (cfg.stressSmoothing?.immediateReliefBoardRisk ?? 0.72);
    /* v1.56.6 §5.α.9 P1-C4：D4 段动态提高 smoothStress.maxStepUp ——
     * 旧默认 0.18 让 challengeBoost(0.18) + pbOvershootBoost(0~0.16) 的单帧上扬被截断，
     * "超 PB 后骤然变难"的体感被平滑抹去。D4 段（pbOvershootActive=true）临时把
     * maxStepUp 提到 pbChase.overshoot.smoothMaxStepUp（默认 0.25），允许"突然变难"
     * 在 1 个 spawn 内完成传达。其他段位维持原 0.18，不引入锯齿。 */
    const _ohSmoothMaxStepUp = Number(cfg.pbChase?.overshoot?.smoothMaxStepUp);
    const _smoothingCfg = pbOvershootActive && Number.isFinite(_ohSmoothMaxStepUp)
        ? { ...(cfg.stressSmoothing ?? {}), maxStepUp: _ohSmoothMaxStepUp }
        : cfg.stressSmoothing;
    stress = smoothStress(stress, ctx, _smoothingCfg, immediateRelief);
    stressBreakdown.afterSmoothing = stress;
    stressBreakdown.smoothingAdjust = stressBreakdown.afterSmoothing - stressBreakdown.afterOccupancy;
    if (pbOvershootActive && Number.isFinite(_ohSmoothMaxStepUp)) {
        stressBreakdown.smoothingDynamicMaxStepUp = _ohSmoothMaxStepUp;
    }
    if (!inOnboarding && !profile.needsRecovery && Number.isFinite(difficultyTuning.minStress)) {
        const prevStress = stress;
        stress = Math.max(stress, difficultyTuning.minStress);
        stressBreakdown.minStressFloorAdjust = stress - prevStress;
    }
    /* v1.13：flow + payoff 时把 stress 封顶到 tense（默认 0.79），避免拟人化压力表
     * 出现「🥵 高压」与叙事「享受多消快感」并列的认知冲突。仅在盘面无空洞、风险不高时生效。
     *
     * v1.56.6 §5.α.9 P0-C3：D4 段豁免 flowPayoffCap ——
     * 玩家破 PB 时常处 flow + payoff 状态（爽点击穿带来 flowState='flow' + rhythmPhase='payoff'），
     * 旧 cap 0.79 会把 D4 加压锁死，与"超 PB 高强度加压"原则直接冲突。本豁免让 D4 段
     * 保持完整的加压能力。受 pbChase.overshoot.bypassFlowPayoffCap 配置开关控制。 */
    const _ohBypassFpc = (cfg.pbChase?.overshoot?.bypassFlowPayoffCap) !== false;
    const _ohActiveBypassFpc = pbOvershootActive && _ohBypassFpc;
    const flowPayoffCap = cfg.flowPayoffStressCap;
    if (Number.isFinite(flowPayoffCap)
        && profile.flowState === 'flow'
        && earlyRhythmPhase === 'payoff'
        && holes === 0
        && boardRisk < (cfg.flowPayoffMaxBoardRisk ?? 0.5)
        && !_ohActiveBypassFpc) {
        const prevStress = stress;
        stress = Math.min(stress, flowPayoffCap);
        stressBreakdown.flowPayoffCap = flowPayoffCap;
        stressBreakdown.flowPayoffCapAdjust = stress - prevStress;
    }
    if (_ohActiveBypassFpc) {
        stressBreakdown.flowPayoffCapBypassed = true;
    }
    /* v1.55 §4.9：postPbReleaseWindow ——
     * 玩家刚刚刷新 PB 后，game.js 在 _spawnContext 上写 postPbReleaseActive=true
     * 与 postPbReleaseRemaining=3（消费完 3 个 spawn 后自动归零）。释放窗口期内：
     *   - 正向 stress 按 RELEASE_FACTOR=0.7 衰减（让"破纪录后的一瞬间"轻盈）
     *   - challengeBoost 已经在前面 bypass='post_pb_release'
     *   - clearGuarantee +1（下方 spawnHints 处再加）
     * 与 occupancyDamping 互补：occupancyDamping 看"盘面空"，本信号看"刚破 PB"。 */
    let postPbReleaseStressAdjust = 0;
    if (ctx.postPbReleaseActive === true && stress > 0) {
        // θ-E: releaseFactor (modelConfig 优先, 否则默认 0.7)
        const _releaseFactor = Number.isFinite(ctx.modelConfig?.releaseFactor) ? ctx.modelConfig.releaseFactor : 0.7;
        const scaled = stress * _releaseFactor;
        postPbReleaseStressAdjust = scaled - stress;
        stress = scaled;
    }
    stressBreakdown.postPbReleaseActive = ctx.postPbReleaseActive === true;
    stressBreakdown.postPbReleaseStressAdjust = postPbReleaseStressAdjust;
    stressBreakdown.finalStress = stress;

    /* ---------- v1.32：顺序刚性（orderRigor / orderMaxValidPerms） ----------
     *
     * 背景：v9 evaluateTripletSolutions 已经能数出"6 种排列里有几种可解"
     * （validPerms ∈ [0,6]），但此前只用了 solutionCount / firstMoveFreedom，
     * 这个**顺序自由度**指标完全没有被消费。
     *
     * 物理含义：当 validPerms ≤ 2 时，三连块**必须按特定顺序**才能放下；
     * 选错先后顺序会卡死至少一块。这是对"空间规划深度"的精细加压：
     *   - 空间难度（已有）：给"难塞"的形状（spatialPressure / sizePreference）
     *   - 时序难度（v1.32 新增）：给"必须按特定顺序"的三连块组合
     *
     * 与 Yerkes-Dodson 的关系：高 stress + 高 skill 时，传统加压（更大块、
     * 更碎形状）已经触顶，再加只会让玩家挫败；orderRigor 把压力从"哪一块难
     * 摆"切换到"先后顺序怎么规划"，把认知负荷转向**前瞻规划**而非**操作精度**，
     * 满足"高承受力玩家依然有挑战"的自驱需求。
     *
     * orderRigor ∈ [0, 1] 由三项加和：
     *   1. stressTerm = max(0, stress - threshold) * scale    （压力驱动）
     *   2. skillTerm  = max(0, skill - 0.5) * skillScale     （承受力门槛）
     *   3. modeBoost  = difficultyTuning.orderRigorBoost     （Hard 模式自动加 0.30）
     *
     * orderMaxValidPerms = round(loose - (loose - tight) * orderRigor)：
     *   - rigor=0.0 → maxPerms=4（宽松：6 种排列里 ≤4 种通即可）
     *   - rigor=0.5 → maxPerms=3
     *   - rigor=1.0 → maxPerms=2（紧绷：必须按特定顺序）
     *
     * 五重 bypass（任一成立 → orderRigor=0、maxPerms=6）：
     *   1. 新手保护期内（与 bottleneckRelief 同源 onboarding bypass）
     *   2. profile.needsRecovery（玩家正在被救场）
     *   3. hasBottleneckSignal（已经通过 bottleneckRelief 减压，再加 rigor 是双重打击）
     *   4. holes > orderRigorMaxHolesAllow（盘面已糟糕，加顺序约束等于不公平）
     *   5. boardFill < orderRigorActivationFill（空盘强制顺序无意义）
     *
     * blockSpawn 端只在 attempt < ratio * MAX 时硬过滤，避免无解死循环。
     * truncated=true 时跳过过滤（结果不可信，按通过处理），与 v9 同口径。
     */
    /* ---------- v1.66：压力阶段（phaseFreq）—— 达成率强化的统一锚 ----------
     * 单一真相 = raw stress + boardFill（不依赖晚到的 spawnIntent，规避派生顺序风险）。
     *   high：stress ≥ highStressMin 且 boardFill ≥ orderRigorActivationFill（与 orderRigor 同门槛）
     *         → 强化「顺序方块」达成率（下方 orderRigor 加 boost + 透传更大 solutionBudget 修截断失效）
     *   low ：stress ≤ lowStressMax 且非 onboarding / recovery
     *         → 强化「清屏」达成率（仅在机会已存在时抬 clearGuarantee + 抬 nearFullDelta 下限做跨轮造势）
     * enabled=false（或配置缺失）时全部回退、与旧行为逐字段等价。 */
    const _pf = topoCfg.phaseFreq ?? {};
    const _pfEnabled = _pf.enabled === true;
    const _pfLowMax = Number.isFinite(_pf.lowStressMax) ? _pf.lowStressMax : 0.40;
    const _pfHighMin = Number.isFinite(_pf.highStressMin) ? _pf.highStressMin : 0.55;
    const _pfActivFill = Number.isFinite(topoCfg.orderRigorActivationFill) ? topoCfg.orderRigorActivationFill : 0.50;
    const highPhase = _pfEnabled && stress >= _pfHighMin && (_boardFill ?? 0) >= _pfActivFill;
    const lowPhase = _pfEnabled && stress <= _pfLowMax && !inOnboarding && profile.needsRecovery !== true;
    const pressurePhase = highPhase ? 'high' : (lowPhase ? 'low' : 'mid');
    const _pfHighOrderBoost = highPhase && Number.isFinite(_pf.highOrderBoost) ? Math.max(0, _pf.highOrderBoost) : 0;
    const _pfHighOrderPermsFloor = Number.isFinite(_pf.highOrderMaxPermsFloor) ? _pf.highOrderMaxPermsFloor : 2;

    let orderRigor = 0;
    let orderMaxValidPerms = 6;
    let pbOvershootOrderBoostApplied = 0;
    {
        const enabled = topoCfg.orderRigorEnabled !== false;
        const threshold = Number.isFinite(topoCfg.orderRigorStressThreshold)
            ? topoCfg.orderRigorStressThreshold : 0.55;
        /* v1.57.1 P0：阈值平滑度（softplus smoothness）。0 退化为旧硬阈值 max(0, x)；
         * 默认 0.08 让 stress ∈ [threshold-0.15, threshold+0.15] 区间从"硬台阶"变为
         * 平滑过渡，消除玩家在 stress=0.55 跨越点感受到的"突然变难"台阶感。 */
        const smoothness = Number.isFinite(topoCfg.orderRigorStressSmoothness)
            ? Math.max(0, topoCfg.orderRigorStressSmoothness) : 0.08;
        const orderScale = Number.isFinite(topoCfg.orderRigorScale)
            ? topoCfg.orderRigorScale : 1.6;
        const skillScale = Number.isFinite(topoCfg.orderRigorSkillScale)
            ? topoCfg.orderRigorSkillScale : 0.20;
        const tight = Math.max(1, Math.min(6, topoCfg.orderRigorMaxPermsTight ?? 2));
        const loose = Math.max(tight, Math.min(6, topoCfg.orderRigorMaxPermsLoose ?? 4));
        const activFill = Number.isFinite(topoCfg.orderRigorActivationFill)
            ? topoCfg.orderRigorActivationFill : 0.50;
        const maxHolesAllow = Number.isFinite(topoCfg.orderRigorMaxHolesAllow)
            ? topoCfg.orderRigorMaxHolesAllow : 3;
        const modeBoost = Math.max(0, Number(difficultyTuning.orderRigorBoost) || 0);
        const motivationBoost = motivationIntent === 'challenge' ? 0.10 : 0;

        const bypass = !enabled
            || inOnboarding
            || profile.needsRecovery === true
            || hasBottleneckSignal
            || decisionLoadReliefActive
            || motivationIntent === 'relaxation'
            || motivationIntent === 'competence'
            || accessibilityLoad >= 0.45
            || returningWarmupStrength >= 0.35
            || socialFairChallenge
            || holes > maxHolesAllow
            || (_boardFill ?? 0) < activFill;

        if (!bypass) {
            /* v1.57.1 P0 softplus ramp：
             *   stressTerm = softplus((stress - threshold) / smoothness) * smoothness * orderScale
             * 数学性质：
             *   - smoothness → 0 时退化为 max(0, stress - threshold) * orderScale（旧公式）
             *   - 远离 threshold 时与旧公式渐近一致（高 stress 段强度无显著变化）
             *   - 在 threshold 附近 ±2·smoothness 范围内平滑过渡（消除台阶感）
             * 例（smoothness=0.08, orderScale=1.6）：
             *   stress=0.40 → 0.018（旧公式 0）
             *   stress=0.55 → 0.089（旧公式 0）
             *   stress=0.70 → 0.258（旧公式 0.240）
             *   stress=0.85 → 0.484（旧公式 0.480） */
            let stressTerm;
            if (smoothness > 0) {
                const x = (stress - threshold) / smoothness;
                /* Math.log1p(Math.exp(x)) 等价于 softplus(x)；x 过大时直接退化为 x 避免溢出 */
                const softplus = x > 20 ? x : Math.log1p(Math.exp(x));
                stressTerm = softplus * smoothness * orderScale;
            } else {
                stressTerm = Math.max(0, stress - threshold) * orderScale;
            }
            const skillTerm = Math.max(0, skill - 0.5) * skillScale;
            /* v1.56 §2.3：D3 决战段（pct 0.95~1.0）追加 pbExtremeOrderBoost，
             * 把临界段的"顺序约束"提升到与 Hard 模式相当的水平，让规则压取代部分数值压。 */
            /* v1.57.1 P2：D4 段 + stress 已经高位时 orderBoostInD4HighStress 进一步强锁死。
             * 与现有 _overshootCfg.orderBoostInD4 互补：弱场景（仅 overshoot 触发）走 0.08；
             * 强场景（pbOvershootActive=true 且 stress ≥ orderHighStressMin，默认 0.85）
             * 在弱档基础上额外注入 0.25 的 boost，让 maxValidPerms 真正压到 tight=2，
             * 顺序刚性彻底锁死，体感"系统在和我较劲"。
             * bypass 链与现有 orderRigor 完全一致（onboarding/recovery/bottleneck/holes/fill）。 */
            const overshootBoostCfg = cfg.pbChase?.overshoot ?? {};
            const overshootBoostHighStress = Number.isFinite(overshootBoostCfg.orderBoostInD4HighStress)
                ? overshootBoostCfg.orderBoostInD4HighStress : 0.25;
            const overshootMinStress = Number.isFinite(overshootBoostCfg.orderHighStressMin)
                ? overshootBoostCfg.orderHighStressMin : 0.85;
            if (overshootBoostCfg.enabled !== false
                && pbOvershootActive
                && stress >= overshootMinStress
                && overshootBoostHighStress > 0) {
                pbOvershootOrderBoostApplied = overshootBoostHighStress;
            }
            orderRigor = Math.max(0, Math.min(1,
                stressTerm + skillTerm + modeBoost + motivationBoost
                + pbExtremeOrderBoost + pbOvershootOrderBoostApplied
                /* v1.66：高压阶段统一加权，提高顺序方块达成率（与上方 highPhase 同源 stress+fill 门控） */
                + _pfHighOrderBoost
            ));
            orderMaxValidPerms = Math.max(
                tight,
                Math.min(loose, Math.round(loose - (loose - tight) * orderRigor))
            );
            /* v1.66：高压 perms 下限护栏——即便未来 tight 调到 1，也不让顺序约束越过配置下限。 */
            if (highPhase && _pfHighOrderPermsFloor > orderMaxValidPerms) {
                orderMaxValidPerms = Math.min(6, _pfHighOrderPermsFloor);
            }
        }
    }
    stressBreakdown.orderRigor = orderRigor;
    stressBreakdown.orderMaxValidPerms = orderMaxValidPerms;
    stressBreakdown.pbOvershootOrderBoost = pbOvershootOrderBoostApplied;

    // v2.10.18 (G11): 把 SpawnParamTuner 部署的 theta 注入 derivePbCurve
    //   - 部署 bundle 后 clientPolicyV2 加载 360 ctx policies, 每个 ctx 对应一组 theta
    //   - 这里按 player ctx (难度/生成器/bot/pb档/生命周期/userId) resolve theta
    //   - 失败时 resolveThetaV2 自己 fallback 到 DEFAULT_THETA_V2, 跟原行为一致
    //   - 灰度门控 (rollout_pct) 也内嵌在 resolveThetaV2 (用 userId 哈希)
    let _tuningTheta = null, _tuningSource = 'skipped';
    if (ctx.tuningV2Context) {
        try {
            // 动态 import 避免循环 (adaptiveSpawn 是底层, clientPolicyV2 是上层)。
            // globalThis 优先：Web/小程序设 window 也设 globalThis；Cocos 原生(jsb)/部分小游戏
            // 运行时无 window，但 globalThis 恒可用，故以 globalThis 兜底保证各端都能取到策略模块。
            const _g = (typeof globalThis !== 'undefined') ? globalThis
                : (typeof window !== 'undefined') ? window : null;
            const mod = _g ? _g.__openblockClientPolicyV2 : null;
            if (mod && typeof mod.resolveThetaV2 === 'function') {
                const r = mod.resolveThetaV2(ctx.tuningV2Context);
                _tuningTheta = r.theta;
                _tuningSource = r.source;
            }
        } catch { /* not critical, 继续 fallback DEFAULT */ }
    }
    if (stressBreakdown) stressBreakdown.tuningV2Source = _tuningSource;
    /* v1.61.0：把"本帧实际生效的 4 个 PB 曲线 θ"显式落到 stressBreakdown.pbCurveParams。
     * 用途：(1) 运行时供 SpawnPolicyNet 的 behaviorContext[57-60] 作为显式条件输入；
     *       (2) 经 buildPlayerStateSnapshot 写入 ps.adaptive.stressBreakdown → 训练样本可读
     *           → 把 L2→L1-Net 的"隐式耦合"转成"显式条件"，消除换 θ 不重训导致的分布漂移。
     * 未部署 SpawnParamTuner 时取 DEFAULT_SPAWN_PARAMS_PB_CURVE（与历史 HandTuned 数据同域）。*/
    const _pbN = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    if (stressBreakdown) {
        stressBreakdown.pbCurveParams = {
            pbTensionCenter: _pbN(_tuningTheta?.pbTensionCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionCenter),
            pbTensionWidth: _pbN(_tuningTheta?.pbTensionWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionWidth),
            pbBrakeCenter: _pbN(_tuningTheta?.pbBrakeCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeCenter),
            pbBrakeWidth: _pbN(_tuningTheta?.pbBrakeWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeWidth),
        };
    }
    const pbCurve = derivePbCurve(score, ctx.bestScore, ctx.postPbReleaseActive === true, _tuningTheta);
    stressBreakdown.pbRatio = pbCurve.pbRatio;
    stressBreakdown.pbTension = pbCurve.pbTension;
    stressBreakdown.pbBrake = pbCurve.pbBrake;
    stressBreakdown.pbRelease = pbCurve.pbRelease;
    stressBreakdown.pbPhase = pbCurve.pbPhase;

    let spawnTargets = deriveSpawnTargets(
        stress,
        profile,
        ctx,
        _boardFill ?? 0,
        boardRisk,
        delight,
        cfg.spawnTargets ?? {},
        boardDifficulty
    );
    // θ-D: PB 曲线对 spawnTargets 的调制力度 (5 类各自的 tension/brake 系数)
    const _mcTarget = ctx.modelConfig || {};
    const kPbT = Number.isFinite(_mcTarget.pbTensionTargetWeight) ? _mcTarget.pbTensionTargetWeight : 0.10;
    const kPbB = Number.isFinite(_mcTarget.pbBrakeTargetWeight)   ? _mcTarget.pbBrakeTargetWeight   : 0.10;
    spawnTargets = {
        ...spawnTargets,
        // 基线: tension*0.10, brake*0.12, release*0.08 → 替换为 θ 控制
        solutionSpacePressure: clamp01((spawnTargets.solutionSpacePressure ?? 0) + pbCurve.pbTension * kPbT      + pbCurve.pbBrake * (kPbB + 0.02) - pbCurve.pbRelease * 0.08),
        clearOpportunity:      clamp01((spawnTargets.clearOpportunity ?? 0)      - pbCurve.pbBrake * kPbB        + pbCurve.pbRelease * 0.12),
        spatialPressure:       clamp01((spawnTargets.spatialPressure ?? 0)       + pbCurve.pbTension * (kPbT + 0.02) + pbCurve.pbBrake * (kPbB + 0.06) - pbCurve.pbRelease * 0.10),
        payoffIntensity:       clamp01((spawnTargets.payoffIntensity ?? 0)       - pbCurve.pbBrake * (kPbB + 0.06) + pbCurve.pbRelease * 0.12),
        novelty:               clamp01((spawnTargets.novelty ?? 0)               + pbCurve.pbBrake * 0.05),
    };
    if (decisionLoadReliefActive) {
        const loadRelief = Math.min(1, Math.abs(decisionLoadRelief) / Math.max(0.001, dlMaxRelief));
        spawnTargets = {
            ...spawnTargets,
            shapeComplexity: clamp01((spawnTargets.shapeComplexity ?? 0) - 0.18 * loadRelief),
            solutionSpacePressure: clamp01((spawnTargets.solutionSpacePressure ?? 0) - 0.22 * loadRelief),
            spatialPressure: clamp01((spawnTargets.spatialPressure ?? 0) - 0.18 * loadRelief),
            clearOpportunity: clamp01((spawnTargets.clearOpportunity ?? 0) + 0.18 * loadRelief),
            novelty: clamp01((spawnTargets.novelty ?? 0) - 0.08 * loadRelief),
        };
    }

    /* ---------- 插值 shapeWeights ---------- */
    const shapeWeights = interpolateProfileWeights(cfg.profiles, stress);

    /* ---------- fillRatio ---------- */
    // fillRatio=0（如简单模式空盘）不叠加连战加成，保持纯净空盘开局
    const _baseFill = base.fillRatio ?? 0.2;
    const fillRatio = _baseFill === 0
        ? 0
        : Math.min(0.36, Math.max(0, _baseFill + runMods.fillDelta));

    /* ================================================================ */
    /*  spawnHints 三层构建                                              */
    /* ================================================================ */
    let clearGuarantee = 1;
    let sizePreference = 0;
    let diversityBoost = 0;

    /* --- Layer 2: combo 链 --- */
    const comboChain = deriveComboChain(ctx, profile);

    /* --- Layer 2: 多消鼓励 --- */
    let multiClearBonus = Math.max(
        deriveMultiClearBonus(ctx, _boardFill ?? 0),
        delight.multiClearBoost
    );

    /* v1.60.45：Android / 微信小程序档 multiClearBonus 抬底 0.15。
     *
     * **数据依据**（docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2 / §4.2）：
     *   Android 多消 r(D7)=0.205（iOS 0.089 的 ×2.3），是该平台爽感时刻最强抓手。
     *   即便 deriveMultiClearBonus / delight.multiClearBoost 都未触发（中性意图 + 无 nearMiss），
     *   Android 上仍保留 0.15 底值，让 scoreShape 加权稳定偏向多消候选。
     *
     * 设计原则：
     *   - 仅抬底，不上限——保留现有强信号下 max() 叠加路径（避免上限掩盖真实强度）
     *   - iOS / web 走原路径（稀缺爽感模型不应被频次稀释） */
    const platformMultiClearFloor = pickByPlatform({
        ios:     0,
        android: 0.15,
        wechat:  0.15,
        web:     0,
        default: 0,
    });
    if (platformMultiClearFloor > 0) {
        multiClearBonus = Math.max(multiClearBonus, platformMultiClearFloor);
    }

    /* --- Layer 2: 节奏相位 + 多线目标 --- */
    let rhythmPhase = deriveRhythmPhase(profile, ctx, _boardFill ?? 0);
    let multiLineTarget = deriveMultiLineTarget(ctx, _boardFill ?? 0);
    const realtimeStateReliefActive = preFrustrationRelief < 0
        || boardFrustrationRelief < 0
        || decisionLoadReliefActive;

    /* --- 原有条件逻辑 --- */
    if (profile.hadRecentNearMiss) {
        clearGuarantee = Math.max(clearGuarantee, eng.nearMissClearGuarantee ?? 2);
    }
    if (profile.frustrationLevel >= frustThreshold) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.3;
    }
    if (profile.needsRecovery) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.5;
    }
    if (flow === 'bored') {
        diversityBoost = eng.noveltyDiversityBoost ?? 0.15;
    }
    if (profile.isInOnboarding) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.4;
    }
    if (profile.sessionPhase === 'late' && profile.momentum < -0.3) {
        sizePreference = Math.min(sizePreference, -0.2);
        clearGuarantee = Math.max(clearGuarantee, 1);
    }
    // 连续多轮无消行时进入救援态，强制提高可解压出块比例
    if ((ctx.roundsSinceClear ?? 0) >= 2) {
        clearGuarantee = Math.max(clearGuarantee, 2);
    }
    if ((ctx.roundsSinceClear ?? 0) >= 4) {
        clearGuarantee = Math.max(clearGuarantee, 3);
        sizePreference = Math.min(sizePreference, -0.35);
    }
    if (holes >= (topoCfg.holeClearGuaranteeAt ?? 2)) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, topoCfg.holeSizePreference ?? -0.22);
    }
    /* --- v1.30：上一周期出现严重瓶颈时，下一波抬保消 + 偏小块。
     * `hasBottleneckSignal` 已在主路径里排除 onboarding，因此这里不必再判一次；
     * 仅当 bottleneckTrough <= 配置阈值时触发；调整量由配置决定，避免代码内硬编码。 */
    if (hasBottleneckSignal) {
        const cgAt = Number.isFinite(topoCfg.bottleneckClearGuaranteeAt)
            ? topoCfg.bottleneckClearGuaranteeAt : 2;
        const sizeDelta = Number.isFinite(topoCfg.bottleneckSizePreferenceDelta)
            ? topoCfg.bottleneckSizePreferenceDelta : -0.18;
        clearGuarantee = Math.max(clearGuarantee, cgAt);
        sizePreference = Math.min(sizePreference, sizeDelta);
    }

    /* --- Layer 2: combo 活跃时提高消行保证 --- */
    if (comboChain > 0.5) {
        clearGuarantee = Math.max(clearGuarantee, 2);
    }

    /* --- v1.48 winback 保护包：spawnHints 加成 ---
     * 与上方 stress cap 同来源；进入回流保护期后给 spawnHints 加固，确保
     * "保护包确实让前 3 局更轻松"。 */
    if (winbackPreset) {
        if (Number.isFinite(winbackPreset.clearGuaranteeBoost) && winbackPreset.clearGuaranteeBoost > 0) {
            clearGuarantee = Math.min(3, clearGuarantee + winbackPreset.clearGuaranteeBoost);
        }
        if (Number.isFinite(winbackPreset.sizePreferenceShift) && winbackPreset.sizePreferenceShift < 0) {
            sizePreference = Math.max(-1, sizePreference + winbackPreset.sizePreferenceShift);
        }
    }

    /* --- v1.55 §4.9：postPbRelease spawnHints 加成 ---
     * 与上方 stress×0.7 同来源；释放窗口期内进一步抬保消（+1）+ 略偏小块，
     * 确保玩家在"破纪录后下三波"切实感到轻盈而不是被下波加压重新攻击。 */
    if (ctx.postPbReleaseActive === true) {
        clearGuarantee = Math.min(3, clearGuarantee + 1);
        sizePreference = Math.min(sizePreference, -0.15);
    }

    /* --- Ability 风险护栏：高风险时优先保活，低风险高手允许更强挑战/多消兑现 --- */
    const riskLevel = ability.riskLevel ?? 0;
    if (ability.confidence >= 0.25 && riskLevel >= 0.62) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.22);
        multiClearBonus = Math.max(multiClearBonus, 0.45);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    } else if (ability.confidence >= 0.45 && ability.skillScore >= 0.72 && riskLevel <= 0.38) {
        diversityBoost = Math.max(diversityBoost, 0.12);
        multiClearBonus = Math.max(multiClearBonus, 0.5);
        if (rhythmPhase === 'neutral' && (ctx.nearFullLines ?? 0) >= 1) rhythmPhase = 'payoff';
    }

    /* --- 历史实时状态优化：把复合早期救济落到可感知的 spawnHints ---
     * stress 只会改变插值档位；真正让玩家感到"变容易"还需要提高消行机会、
     * 降低块型尺寸/复杂度，并在高认知负荷时关闭顺序/解空间压迫。 */
    if (preFrustrationRelief < 0) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.18);
        multiClearBonus = Math.max(multiClearBonus, 0.42);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }
    if (boardFrustrationRelief < 0) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.28);
        multiClearBonus = Math.max(multiClearBonus, 0.55);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }
    if (decisionLoadReliefActive) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.22);
        diversityBoost = Math.max(diversityBoost, 0.08);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }

    /* --- 拓扑机会：临消线/清屏准备对规则轨和生成式上下文保持同一口径 --- */
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    const multiClearCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
    let perfectClearBoost = delight.perfectClearBoost;
    let iconBonusTarget = 0;

    /* v1.17：rhythmPhase 升 'payoff' 需要"盘面真的能 harvest"才允许。
     * pcSetup 在低占用盘面上是噪声，flow_payoff / challenge_payoff / multi_clear
     * 等基于玩家状态的路径过去会无条件拉 payoff，造成 17% 散布盘面也推长条 +
     * stressMeter 报"收获期"。统一通过此 helper 兜底，UI 与出块偏向对齐。 */
    const canPromoteToPayoff = nearFullLines >= 1
        || multiClearCands >= 1
        || (pcSetup >= 1 && (_boardFill ?? 0) >= PC_SETUP_MIN_FILL);

    if (pcSetup >= 1) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.75);
        if ((_boardFill ?? 0) >= PC_SETUP_MIN_FILL) {
            rhythmPhase = 'payoff';
        }
    } else if (nearFullLines >= 3) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 1);
        multiClearBonus = Math.max(multiClearBonus, 0.6);
        if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
    }

    /* --- v1.66：低压阶段强化「清屏」达成率 ---
     * 只在机会已存在（pcSetup≥1 ∨ nearFullLines≥1）时抬 clearGuarantee 到配置地板，
     * 让低压期"该送的清屏更确定地送出"。机会不存在时不做任何事——不凭空制造清屏块，
     * 与 perfectClearBoost 的几何门控（deriveDelightSignals）保持同一哲学。 */
    if (lowPhase && (pcSetup >= 1 || nearFullLines >= 1)) {
        const _lowCg = Number.isFinite(_pf.lowClearGuaranteeAt) ? _pf.lowClearGuaranteeAt : 2;
        clearGuarantee = Math.max(clearGuarantee, _lowCg);
        multiClearBonus = Math.max(multiClearBonus, 0.6);
    }

    /* --- Layer 2: payoff 节奏期提高多样性 --- */
    if (rhythmPhase === 'payoff') {
        diversityBoost = Math.max(diversityBoost, 0.1);
    }
    if (delight.mode === 'challenge_payoff') {
        diversityBoost = Math.max(diversityBoost, 0.12);
        /* v1.17：仅当盘面真的有 harvest 几何时才升 payoff —— 否则
         * "心流挑战"叙事会在空盘面上仍说"收获期"，与 UI 现实不符。 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
        multiLineTarget = Math.max(multiLineTarget, 1);
    } else if (delight.mode === 'flow_payoff') {
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
        multiLineTarget = Math.max(multiLineTarget, 1);
    } else if (delight.mode === 'relief') {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.25);
    }
    if (delight.perfectClearBoost >= 0.75) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
    }

    /* --- Layer 3: 分数里程碑庆祝 — 出块友好化（v1.49 字段更名 milestoneCheck → scoreMilestoneCheck） --- */
    if (scoreMilestoneCheck.hit) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.2);
    }

    /* --- Layer 3: warmup 阶段友好化 --- */
    if (sessionArc === 'warmup') {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.2);
    }

    /* --- v1.56 §2.1：farFromPBBoost 远征送爽 spawnHints 加成 ---
     *
     * 触发条件：
     *   - ctx.bestScore > 0（必须有历史 PB，新手 best=0 不触发）
     *   - score / bestScore < FAR_THRESHOLD（默认 0.30，对应"差 70% 以上"D0 远征段）
     *   - 至少进入 peak 段（!warmup），避免与新手 toast 拥堵
     *   - !needsRecovery：玩家正在被救场时让 recovery 路径先处理，避免"双重照顾"
     *   - !hadRecentNearMiss：nearMiss 已有专属 clearGuarantee 路径
     *   - !ctx.pbGrowthFast（Q+1.4 节流；若上游识别 PB 增长率过快则跳过）
     *
     * 与现有 spawnHints 加成（postPbRelease/recovery/nearMiss）的关键差异：
     *   - postPbRelease：玩家"刚破 PB"，是奖励性减压
     *   - recovery / nearMiss：玩家"陷入困境"，是救济性减压
     *   - farFromPBBoost（本节）：玩家"远征段提前送爽"，主动加 multiClearBonus + iconBonusTarget
     *     让"差 PB 70%"的中长局开局不会被 challengeBoost 反复打击，降低畏难情绪。
     *
     * 配置位于 game_rules.json adaptiveSpawn.engagement.farFromPBBoost（v1.56 新增）。
     * 详见 docs/player/BEST_SCORE_CHASE_STRATEGY.md §5.α v1.56。 */
    const farCfg = eng.farFromPBBoost ?? null;
    let farFromPBBoostActive = false;
    let farFromPBBoostBypass = null;
    if (farCfg && farCfg.enabled !== false && ctx.bestScore > 0) {
        const pctOfBest = score / ctx.bestScore;
        const farThreshold = Number.isFinite(farCfg.pctThreshold) ? farCfg.pctThreshold : 0.30;
        if (ctx.bestScore < _intenseFloor) {
            // v1.56.2 §5.α.6：低 PB 守卫——best 太低时（默认 < 200），
            // 远征送爽对新手无意义（盘面本就空旷、PB 太近无压力），跳过算法注入。
            farFromPBBoostBypass = 'low_best_score';
        } else if (pctOfBest >= farThreshold) {
            farFromPBBoostBypass = 'pct_above_threshold';
        } else if (sessionArc === 'warmup') {
            farFromPBBoostBypass = 'warmup';
        } else if (profile.needsRecovery === true) {
            farFromPBBoostBypass = 'recovery';
        } else if (profile.hadRecentNearMiss) {
            farFromPBBoostBypass = 'near_miss';
        } else if (ctx.pbGrowthFast === true) {
            // Q+1.4：PB 增长率过快 → 节流；交由 game.js 上游计算
            farFromPBBoostBypass = 'pb_growth_throttled';
        } else if (ctx.postPbReleaseActive === true) {
            farFromPBBoostBypass = 'post_pb_release';
        } else {
            farFromPBBoostActive = true;
            const cgBoost = Math.max(0, Math.min(2, Number(farCfg.clearGuaranteeBoost) || 1));
            // θ-E: farFromPBBoost (modelConfig 优先) - 控制 multiClearBonus floor 总强度
            const _farTheta = Number.isFinite(ctx.modelConfig?.farFromPBBoost) ? ctx.modelConfig.farFromPBBoost : null;
            const _mcbFloorRaw = _farTheta !== null ? _farTheta : (Number(farCfg.multiClearBonusFloor) || 0.45);
            let mcbFloor = Math.max(0, Math.min(1, _mcbFloorRaw));
            let iconFloor = Math.max(0, Math.min(1, Number(farCfg.iconBonusTargetFloor) || 0.30));
            let sizeShift = Number(farCfg.sizePreferenceShift) || -0.12;
            /* v1.56.4 §5.α.8 远段分级：pct<extremeThreshold（默认 0.15）为"极远档"，
             * 玩家畏难情绪最强、最需要"敢挑战"信号；额外抬高 multiClearBonus / iconBonusTarget
             * floor，并下压 sizePreference，让初期更易兑现奖励。边缘档（[0.15, 0.30)）
             * 沿用 v1.56 原参数，避免"即将进 D1"时还在大幅送爽导致 PB 加速膨胀。 */
            const farRampCfg = (cfg.pbChase?.farRamp) ?? {};
            const extremeThreshold = Number.isFinite(farRampCfg.extremeThreshold) ? farRampCfg.extremeThreshold : 0.15;
            const isExtremeFar = farRampCfg.enabled !== false && pctOfBest < extremeThreshold;
            if (isExtremeFar) {
                mcbFloor = Math.max(mcbFloor, Number(farRampCfg.extremeMultiClearBonusFloor) || 0.55);
                iconFloor = Math.max(iconFloor, Number(farRampCfg.extremeIconBonusTargetFloor) || 0.40);
                sizeShift = Math.min(sizeShift, Number(farRampCfg.extremeSizePreferenceShift) || -0.18);
            }
            clearGuarantee = Math.min(3, clearGuarantee + cgBoost);
            multiClearBonus = Math.max(multiClearBonus, mcbFloor);
            iconBonusTarget = Math.max(iconBonusTarget, iconFloor);
            sizePreference = Math.min(sizePreference, sizeShift);
            stressBreakdown.farExtremeBoostActive = isExtremeFar;
        }
    } else if (farCfg && farCfg.enabled === false) {
        farFromPBBoostBypass = 'config_disabled';
    } else if (!(ctx.bestScore > 0)) {
        farFromPBBoostBypass = 'no_best_score';
    }
    stressBreakdown.farFromPBBoostActive = farFromPBBoostActive;
    stressBreakdown.farFromPBBoostBypass = farFromPBBoostBypass;

    /* --- expertEarlyBoost：高手早期「得分机会」加速 spawnHints 加成 ---
     *
     * corner case：高 PB 玩家（best 很高）前期 r=score/PB 长期贴近 0，需要漫长铺垫才进
     * 挑战区 → 前期无趣。effectivePB 压缩已在「难度坐标」上让其更快进挑战区；本块在
     * 「得分机会」维度配套——让高手早期盘面主动多产出多消/清屏/续消机会，使真实分数
     * 上升更快、更早穿过铺垫区，且分数是玩家自己打出来的（非系统改进度坐标）。
     *
     * 关键差异（与 farFromPBBoost 互补、非替代）：
     *   - farFromPBBoost：按 raw pct=score/bestScore 在远征段（<0.30）对「所有」有 PB 的
     *     玩家送爽；不区分 PB 高低，且高 PB 玩家在 raw 30%~挑战区之间会失去该加成。
     *   - expertEarlyBoost：仅对高手（bestScore ≥ expertThreshold），按 effectivePB 定义的
     *     「早期相位」（rDifficulty < earlyRampUntil）追加一档放大，把送爽窗口对齐到压缩后
     *     的「进挑战区之前」，覆盖 raw 30%~挑战区这段 farFromPBBoost 顾不到的真空。
     *
     * 救济优先级与 farFromPBBoost 一致：warmup / recovery / nearMiss / postPbRelease 让位。
     * warmup 段本就有专属友好化（clearGuarantee+2 等），形成「warmup 友好 → expertEarly
     * 送爽 → 挑战区」的平滑接力。仅作用于 spawnHints；纪录线（derivePbCurve / challengeBoost）
     * 不受影响。配置位于 game_rules.json adaptiveSpawn.pbChase.expertEarlyBoost。 */
    const eebCfg = cfg.pbChase?.expertEarlyBoost ?? null;
    let expertEarlyBoostActive = false;
    let expertEarlyBoostBypass = null;
    if (eebCfg && eebCfg.enabled !== false && ctx.bestScore > 0) {
        const expertThreshold = Number.isFinite(eebCfg.expertThreshold) ? eebCfg.expertThreshold : 1200;
        const earlyUntil = Number.isFinite(eebCfg.earlyRampUntil) ? eebCfg.earlyRampUntil : 0.45;
        const effPb = deriveEffectivePb(ctx.bestScore, GAME_RULES.dynamicDifficulty);
        const rDifficulty = effPb > 0 ? score / effPb : 0;
        if (ctx.bestScore < expertThreshold) {
            expertEarlyBoostBypass = 'not_expert';
        } else if (rDifficulty >= earlyUntil) {
            expertEarlyBoostBypass = 'past_early_phase';
        } else if (sessionArc === 'warmup') {
            expertEarlyBoostBypass = 'warmup';
        } else if (profile.needsRecovery === true) {
            expertEarlyBoostBypass = 'recovery';
        } else if (profile.hadRecentNearMiss) {
            expertEarlyBoostBypass = 'near_miss';
        } else if (ctx.postPbReleaseActive === true) {
            expertEarlyBoostBypass = 'post_pb_release';
        } else {
            expertEarlyBoostActive = true;
            const mcbFloor = Math.max(0, Math.min(1, Number(eebCfg.multiClearBonusFloor) || 0.5));
            const pcFloor = Math.max(0, Math.min(1, Number(eebCfg.perfectClearBoostFloor) || 0.5));
            const cgBoost = Math.max(0, Math.min(2, Number(eebCfg.clearGuaranteeBoost) || 1));
            multiClearBonus = Math.max(multiClearBonus, mcbFloor);
            perfectClearBoost = Math.max(perfectClearBoost, pcFloor);
            clearGuarantee = Math.min(3, clearGuarantee + cgBoost);
        }
    } else if (eebCfg && eebCfg.enabled === false) {
        expertEarlyBoostBypass = 'config_disabled';
    } else if (!(ctx.bestScore > 0)) {
        expertEarlyBoostBypass = 'no_best_score';
    }
    stressBreakdown.expertEarlyBoostActive = expertEarlyBoostActive;
    stressBreakdown.expertEarlyBoostBypass = expertEarlyBoostBypass;

    /* v1.56.4 §5.α.8 D4 spawnHints 收紧 ——
     *
     * pbOvershootActive 已在 stress 维度生效；本块在出块维度配套：
     *   - multiClearBonus 上限（默认 0.18）：抑制"超 PB 后还频繁多消"导致 PB 继续膨胀
     *   - sizePreference 上移（默认 +0.12）：让大块/复杂形态更密集
     *   - clearGuarantee 下移（默认 -1）：减少"白送一块易消行"的兜底
     *
     * 与 farFromPBBoost 处于同一 spawnHints 段，但语义对称（一减压一加压）。
     * 同源 bypass 链同 pbOvershootBoost。 */
    if (pbOvershootActive) {
        const _ohCfg = (cfg.pbChase?.overshoot) ?? {};
        const mcbCap = Number.isFinite(_ohCfg.multiClearBonusCap) ? _ohCfg.multiClearBonusCap : 0.18;
        const spShift = Number.isFinite(_ohCfg.sizePreferenceShift) ? _ohCfg.sizePreferenceShift : 0.12;
        const cgShift = Number.isFinite(_ohCfg.clearGuaranteeShift) ? _ohCfg.clearGuaranteeShift : -1;
        multiClearBonus = Math.min(multiClearBonus, mcbCap);
        sizePreference = Math.max(sizePreference, sizePreference + spShift);
        clearGuarantee = Math.max(0, clearGuarantee + cgShift);
    }

    /* v1.62：PB 双 S 曲线直接进入主规则轨 spawnHints。
     * - PB 前张力：轻微提高 pressure / 顺序规划倾向（主要已进入 spawnTargets）
     * - PB 后刹车：抑制 payoff、降低白送消行
     * - 突破释放：短暂提高生存与奖励，避免"刚破纪录就被针对"
     * 这里只做小幅连续调节，原有 pbOvershoot / farFromPB / postPbRelease 规则仍保留。 */
    if (pbCurve.pbRelease > 0) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.35);
        sizePreference = Math.min(sizePreference, -0.12);
    }
    /* 释放窗口期内（pbRelease > 0）不应用 brake：postPbReleaseActive 期望"刚破 PB 还能轻盈"，
     * brake 段会反向把 clearGuarantee 拉回 1，与释放窗口语义冲突（见 §4.9 测试）。
     * brake 仍作用于"超 PB 后释放窗口已耗尽 + 持续在超 PB 区"的情况。 */
    if (pbCurve.pbBrake > 0.35 && !(pbCurve.pbRelease > 0)) {
        multiClearBonus = Math.max(0, multiClearBonus * (1 - pbCurve.pbBrake * 0.22));
        clearGuarantee = Math.max(0, clearGuarantee - (pbCurve.pbBrake > 0.75 ? 1 : 0));
        sizePreference = Math.max(sizePreference, pbCurve.pbBrake * 0.10);
    }

    /* ================================================================ */
    /*  玩法偏好联动（playstyle → spawnHints 精细调控）                  */
    /*  在所有条件规则之后执行，作为最终风格对齐层                        */
    /* ================================================================ */
    const playstyle = profile.playstyle ?? 'balanced';
    if (playstyle === 'perfect_hunter') {
        // 清屏猎人：大幅提升多消潜力块权重 + 保障消行供给
        // 该玩家主动追求清空棋盘，需要提供更多能触发多行消除的方块组合
        multiClearBonus = Math.max(multiClearBonus, 0.85);
        clearGuarantee  = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
        if (pcSetup >= 1 || nearFullLines >= 2) perfectClearBoost = Math.max(perfectClearBoost, 0.82);
        iconBonusTarget = Math.max(iconBonusTarget, 0.55);
    } else if (playstyle === 'multi_clear') {
        // 多消玩家：提升多消鼓励，顺势切入 payoff 节奏
        multiClearBonus = Math.max(multiClearBonus, 0.65);
        multiLineTarget = Math.max(multiLineTarget, 1);
        iconBonusTarget = Math.max(iconBonusTarget, 0.38);
        /* v1.17：与上同——多消玩家偏好不能凭空把节奏拉到 payoff，需要几何兜底 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
    } else if (playstyle === 'combo') {
        // 连消玩家：comboChain 信号已由 recentComboStreak 自动拉高，
        // 这里额外保障至少有 2 个消行槽位供续链
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.52);
        iconBonusTarget = Math.max(iconBonusTarget, 0.28);
    } else if (playstyle === 'survival') {
        // 生存型：减压 + 偏小块，降低卡死风险，保障最低可放置性
        sizePreference = Math.min(sizePreference, -0.25);
        clearGuarantee = Math.max(clearGuarantee, 1);
    }
    // 'balanced'：不做额外调整，沿用上方所有条件规则的结果

    /* --- 最新用户行为特征 → 奖励概率目标 -----------------------------
     * AbilityVector / 窗口统计用于判断玩家是否正在追求高价值反馈：
     *   - 清屏猎人/高规划能力：提高清屏候选概率
     *   - 多消/连消倾向：提高多消概率
     *   - 盘面已有同 icon/同色临门线：提高 dock 染色命中概率
     * 这些是"概率倾向"，仍受几何兜底和可解性校验约束。
     */
    {
        const clearEff = Math.max(0, Math.min(1, ability.clearEfficiency ?? 0.5));
        const planning = Math.max(0, Math.min(1, ability.boardPlanning ?? 0.5));
        const risk = Math.max(0, Math.min(1, ability.riskLevel ?? 0.5));
        const activeSamples = Math.max(0, Number(profile.metrics?.activeSamples ?? profile.metrics?.samples ?? 0) || 0);
        const behaviorConf = Math.max(ability.confidence ?? 0, Math.min(1, activeSamples / 12));
        const rewardReady = canPromoteToPayoff || nearFullLines >= 1;
        const highAgency = behaviorConf >= 0.35 && clearEff >= 0.62 && planning >= 0.55 && risk <= 0.58;
        if (rewardReady) {
            iconBonusTarget = Math.max(iconBonusTarget, 0.18 + Math.min(0.28, clearEff * 0.28));
            if (highAgency) {
                multiClearBonus = Math.max(multiClearBonus, 0.58 + Math.min(0.20, (clearEff - 0.62) * 0.8));
                iconBonusTarget = Math.max(iconBonusTarget, 0.46);
            }
        }
        if (highAgency && (pcSetup >= 1 || nearFullLines >= 2)) {
            perfectClearBoost = Math.max(perfectClearBoost, 0.58 + Math.min(0.24, (planning - 0.55) * 0.8));
            clearGuarantee = Math.max(clearGuarantee, 2);
        }
        if (comboChain >= 0.5 || (profile.metrics?.comboRate ?? 0) >= 0.35) {
            multiClearBonus = Math.max(multiClearBonus, rewardReady ? 0.62 : 0.48);
            multiLineTarget = Math.max(multiLineTarget, rewardReady ? 1 : 0);
        }
    }

    /* --- v10.33 局间热身：上一局无步可走后，下局前几轮由 game.js 写入 warmupRemaining / warmupClearBoost --- */
    const wr = ctx.warmupRemaining ?? 0;
    const wb = Math.max(0, Math.min(2, ctx.warmupClearBoost ?? 0));
    if (wr > 0) {
        clearGuarantee = Math.max(clearGuarantee, 2 + Math.min(1, wb));
        clearGuarantee = Math.min(3, clearGuarantee);
        sizePreference = Math.min(sizePreference, -0.28);
        multiClearBonus = Math.max(multiClearBonus, 0.42);
        multiLineTarget = Math.max(multiLineTarget, wb >= 2 ? 2 : 1);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }

    /* --- 全球化个性化动机层：行为画像只调节策略倾向，不绕过几何与可解性护栏 --- */
    if (personalizationEnabled) {
        if (returningWarmupStrength >= 0.35) {
            clearGuarantee = Math.max(clearGuarantee, 2);
            sizePreference = Math.min(sizePreference, -0.24 - returningWarmupStrength * 0.12);
            multiClearBonus = Math.max(multiClearBonus, 0.38);
            if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
        }
        if (accessibilityLoad >= 0.35) {
            clearGuarantee = Math.max(clearGuarantee, 2);
            sizePreference = Math.min(sizePreference, -0.20 - accessibilityLoad * 0.25);
            diversityBoost = Math.max(diversityBoost, 0.08);
        }
        if (motivationIntent === 'collection') {
            iconBonusTarget = Math.max(iconBonusTarget, canPromoteToPayoff ? 0.50 : 0.32);
            if (canPromoteToPayoff) {
                multiClearBonus = Math.max(multiClearBonus, 0.52);
                multiLineTarget = Math.max(multiLineTarget, 1);
            }
        } else if (motivationIntent === 'challenge') {
            diversityBoost = Math.max(diversityBoost, 0.18);
            if (canPromoteToPayoff) {
                multiClearBonus = Math.max(multiClearBonus, 0.58);
                multiLineTarget = Math.max(multiLineTarget, 1);
            }
        } else if (motivationIntent === 'relaxation' || motivationIntent === 'competence') {
            clearGuarantee = Math.max(clearGuarantee, 2);
            sizePreference = Math.min(sizePreference, -0.22);
        } else if (motivationIntent === 'social') {
            diversityBoost = Math.max(diversityBoost, 0.12);
        }
    }

    /* --- v1.16：AFK 召回（engage 路径） ---
     * 玩家在窗口内出现 ≥1 次 AFK（>15s 思考），传统做法是「降难度+小块」让 TA 喘息，
     * 但实际效果常常是连续给出 4 个单格 + 1×3 横条——盘面瞬间清爽，玩家依然提不起兴趣。
     * 这里改走「显著正反馈 + 可见目标」：
     *   - 多消鼓励 ≥0.6（提供 1 个能多消的长条）
     *   - 多线目标 ≥1（让 dock 至少 1 块为 multiClear≥2 的候选）
     *   - clearGuarantee ≥2（确保至少 2 块能立即兑现）
     *   - 多样性 ≥0.15（避免重复块进一步劝退）
     *   - rhythmPhase: neutral → payoff，让 stressMeter / 商业化文案统一切到「收获期」
     * 仅在 stress 不极高时启用，避免把已经救场状态再"加戏"压垮。 */
    const afkCount = Math.max(0, Number(profile?.metrics?.afkCount ?? 0) || 0);
    const afkEngageActive = afkCount >= 1
        && stress < 0.55
        && !inOnboarding
        && !profile.needsRecovery
        && profile.frustrationLevel < frustThreshold;
    if (afkEngageActive) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.6);
        multiLineTarget = Math.max(multiLineTarget, 1);
        diversityBoost = Math.max(diversityBoost, 0.15);
        /* v1.17：AFK 召回也走几何兜底——空盘面上即便要召回，也通过 spawnIntent='engage'
         * 表达，rhythmPhase 不再骗用户"现在是收获期"。 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
    }

    /* ---------- 玩家所选难度直接影响 spawnHints ----------
     * 降低 clearGuarantee 只作用于普通状态，不削弱救场、挫败恢复、新手保护和跨局热身。
     */
    const clearGuaranteeDelta = difficultyTuning.clearGuaranteeDelta ?? 0;
    if (clearGuaranteeDelta > 0) {
        clearGuarantee += clearGuaranteeDelta;
    } else if (
        clearGuaranteeDelta < 0
        && !inOnboarding
        && !profile.needsRecovery
        && profile.frustrationLevel < frustThreshold
        && !realtimeStateReliefActive
        && (ctx.roundsSinceClear ?? 0) < 2
        && wr <= 0
    ) {
        clearGuarantee += clearGuaranteeDelta;
    }
    sizePreference += difficultyTuning.sizePreferenceDelta ?? 0;
    multiClearBonus += difficultyTuning.multiClearBonusDelta ?? 0;

    /* ---------- v1.17：clearGuarantee 物理可行性兜底 ----------
     * 上方多条规则（warmup wb=1 / roundsSinceClear≥4）会把 clearGuarantee 顶到 3，
     * 含义是"本轮强制至少推出 3 块能立刻消行的形状"。但如果当前盘面既没有
     * ≥2 条临消行也没有 ≥2 个真实多消候选，"立刻能消"在物理上无法兑现——
     * panel 上 pill 显示「目标保消 3」会变成空头支票。
     * 这里在所有 cg 调整完毕后回钳一次：当 cg≥3 但盘面不支持时降回 2，
     * 仍保持友好出块的语义，但不再做无法兑现的承诺。
     */
    if (clearGuarantee >= 3) {
        const mcCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
        const nfLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
        if (mcCands < 2 && nfLines < 2) {
            clearGuarantee = 2;
        }
    }

    /* ---------- v1.19：multiClearBonus / multiLineTarget 几何兜底 ----------
     * 与 v1.17 cg 兜底同源 —— 多消鼓励/多线目标也应与盘面几何匹配。
     * 当：
     *   - 当前没有任何多消候选（multiClearCandidates < 1）
     *   - 没有近满兜底（nearFullLines < 2，连"清了一条剩两条"都做不到）
     *   - 没有真 perfect-clear 窗口（pcSetup ≥1 但 fill < PC_SETUP_MIN_FILL 是噪声）
     *   - 不在 warmup 阶段（warmup 是显式的"结构性偏好"，跨局给玩家友好印象，
     *     即便当前盘面没几何也允许保留 multi-line 倾向；与 v1.17 cg 兜底相反，
     *     cg 是承诺、必须可兑现，multiLineTarget 是偏好、可以前瞻）
     * 三条同时成立时，把 multiClearBonus 软封顶到 0.4、multiLineTarget 归 0。
     * 否则会出现"长条 3.0 + 多消 0.65"重押多消形状，但落地后只能触发单行消除，
     * 与玩家在 dock 里看到的"明显多消导向"形成预期落差。
     * 软封顶：仍保留温和偏好（≤0.4 表示"略偏好但不重押"），不归 0 是因为
     * 单行消除的形状与多消候选形状大量重合，bonus 仍能起到正向作用。
     */
    {
        const _mcCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
        const _nfLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
        const _realPcSetup = pcSetup >= 1 && (_boardFill ?? 0) >= PC_SETUP_MIN_FILL;
        const _isWarmup = (Number(ctx.warmupRemaining) || 0) > 0;
        // AFK engage 与 warmup 同源：是显式的"召回"信号，需要保留鼓励兑现的偏好，
        // 即便此刻盘面几何不支持兑现；给玩家留出"放下手机回来→落几块就有消行"的体感。
        // v1.56 §2.1：farFromPBBoostActive 与 afkEngageActive 同类——是显式"送爽"信号，
        // 远征段开局通常恰好命中 _mcCands<1 && _nfLines<2 && !_realPcSetup 的空盘特征，
        // 此处兜底会撤回上方 farFromPBBoost 的 multiClearBonus floor=0.45 注入，故同等豁免。
        if (_mcCands < 1 && _nfLines < 2 && !_realPcSetup && !_isWarmup && !afkEngageActive
            && !farFromPBBoostActive && !realtimeStateReliefActive) {
            multiClearBonus = Math.min(multiClearBonus, 0.4);
            multiLineTarget = 0;
        }
    }

    /* ---------- v9: 解法数量难度区间 ---------- */
    const solutionStress = Math.max(-0.2, Math.min(
        1,
        stress + (difficultyTuning.solutionStressDelta ?? 0)
    ));
    const targetSolutionRange = deriveTargetSolutionRange(
        solutionStress,
        cfg.solutionDifficulty,
        _boardFill ?? 0
    );
    /* ---------- v1.57.2: 新空洞难度区间（与解法数量区间并列的第二维度） ----------
     * 共享 solutionStress（同源 stress 修饰），保证两维度对 stress 单调一致。 */
    const targetHoleIncrement = deriveTargetHoleIncrement(
        solutionStress,
        cfg.solutionDifficulty,
        _boardFill ?? 0
    );
    /* ---------- v1.57.3: 9 项多维 stress→算法 难度区间 ----------
     * 全部基于 solutionStress 派生（与 v1.57.2 保持单调一致）。任一维度的 enabled=false
     * 或 boardFill < activationFill 时返回 null（blockSpawn 跳过该轴过滤）。
     * 不同维度对应不同的玩家心智轴（详见 §5.α.14）：
     *   ① maxHoleIncrement          —— 专注度税（上界）
     *   ⑨ holeIncrementGap          —— 专注度税（差距）
     *   ② endFillRatio              —— 空间窒息感
     *   ③ nearFullDelta             —— 消行节律
     *   ④ firstMoveSurvivor         —— 试错代价
     *   ⑤ solutionDiversity         —— 解多样性陷阱
     *   ⑥ endFlatness               —— 盘面凹凸审美
     *   ⑦ endDangerColumns          —— 爆顶预警
     *   ⑧ visualClutter             —— 颜色边界审美 */
    const targetMaxHoleIncrement       = deriveTargetMaxHoleIncrement(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetHoleIncrementGap       = deriveTargetHoleIncrementGap(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetEndFillRatio           = deriveTargetEndFillRatio(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    let targetNearFullDelta            = deriveTargetNearFullDelta(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    /* v1.66：低压阶段「清屏造势」——把近满 delta 下限温和上抬到 lowNearFullDeltaMin，
     * 引导生成式/规则轨在玩家舒适期主动堆出"快满线"，为后续清屏铺路（跨轮动量）。
     * 仅 Math.max 单调上抬、且 blockSpawn 端为带 fallback 的软过滤，不会造成死锁。 */
    if (lowPhase && Number.isFinite(_pf.lowNearFullDeltaMin) && targetNearFullDelta) {
        const _curMin = Number.isFinite(targetNearFullDelta.min) ? targetNearFullDelta.min : -Infinity;
        targetNearFullDelta = { ...targetNearFullDelta, min: Math.max(_curMin, _pf.lowNearFullDeltaMin) };
    }
    const targetFirstMoveSurvivorRatio = deriveTargetFirstMoveSurvivorRatio(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetSolutionDiversity      = deriveTargetSolutionDiversity(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetEndFlatness            = deriveTargetEndFlatness(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetEndDangerColumns       = deriveTargetEndDangerColumns(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);
    const targetVisualClutter          = deriveTargetVisualClutter(solutionStress, cfg.solutionDifficulty, _boardFill ?? 0);

    /* ---------- v1.16：spawnIntent — 出块意图的单一对外口径 ----------
     * 让「压力表叙事 / 商业化策略文案 / 回放标签」读同一个意图字段，避免出现：
     *   spawn 实际给了 4 个单格（极致泄压），但 stressMeter 仍说「悄悄加点料维持新鲜感」。
     *
     * 派生顺序（优先级从高到低）：
     *   relief    → 玩家有难：frustration/recovery/holeRelief/boardRiskRelief 主导
     *   engage    → 召回：AFK engage 触发（玩家停顿但状态尚可）
     *   harvest   → 几何兑现：pcSetup ≥1 或 nearFullLines ≥3（含 friendlyBoardRelief 场景）
     *   pressure  → 压力期：B 类挑战 / 接近最佳 / 高 stress
     *   flow      → 心流期：flow_payoff 或节奏 payoff
     *   maintain  → 默认中性维持
     *
     * ⚠ 注意：`friendlyBoardRelief` 是「盘面通透 + 兑现机会」的副产品，不是玩家有难的信号；
     *   归入 `harvest` 更贴合玩家体感。`relief` 仅由 frustration/recovery/holes/boardRisk 触发。
     */
    const playerDistress = (stressBreakdown.recoveryAdjust ?? 0)
        + (stressBreakdown.frustrationRelief ?? 0)
        + (stressBreakdown.preFrustrationRelief ?? 0)
        + (stressBreakdown.boardFrustrationRelief ?? 0)
        + (stressBreakdown.decisionLoadRelief ?? 0)
        + (stressBreakdown.nearMissAdjust ?? 0)
        + (stressBreakdown.holeReliefAdjust ?? 0)
        + (stressBreakdown.boardRiskReliefAdjust ?? 0)
        /* v1.30：瓶颈低谷救济也作为困境信号，让 spawnIntent 优先派生 'relief'。 */
        + (stressBreakdown.bottleneckRelief ?? 0)
        /* v1.51：末段崩盘救济也参与 distress 累加，确保濒死玩家走 relief 叙事。 */
        + (stressBreakdown.endSessionDistress ?? 0);
    /* v1.51：末段崩盘 / 高挫败否决 —— 当玩家明显挣扎时强制走 relief 叙事，
     * 解决截图实测中 game over 前一帧仍显"识别到密集消行机会，正在投放促清的形状"
     * 与濒死状态严重错位的问题。
     * v1.60.37：已破 PB 豁免 —— 若玩家分数已超越历史最佳，说明全局并未"崩盘"，
     * momentum 下行只是局内节奏起伏；此时 forceReliefIntent 会错误覆盖高分加压状态，
     * 导致"大幅突破最佳分 + 加压状态 → 仍强制救济"的体感矛盾。 */
    const abovePb = ctx.bestScore > 0 && score > ctx.bestScore;
    const endSessionDistressActive = !abovePb && profile.sessionPhase === 'late' && profile.momentum <= -0.30;
    const frustrationCritical = (profile.frustrationLevel ?? 0) >= 5;
    /* v1.60.45：ctx.forceReliefIntent 由 game.js 在复活后注入（_postReviveBoost
     * 已激活时连续 2 轮 spawn 走强 relief）—— 让出块引擎给玩家"喘息"机会，
     * 避免"复活后局面仍差很快再死"导致复活成功 r ≈ 0 现状。 */
    const forceReliefIntent = endSessionDistressActive || frustrationCritical
        || ctx.forceReliefIntent === true;
    /* v1.17：harvest 收紧 —— 必须存在真实的"近一手就能兑现"的几何
     *   - nearFullLines ≥ 2：已有≥2 条临消行/列（与 deriveRhythmPhase 中 nearGeom 同口径）
     *   - 或 pcSetup ≥1 且占用 ≥ PC_SETUP_MIN_FILL：清屏候选+足够"满"才算窗口
     * 修正前：pcSetup ≥1 单独触发，会在 17% 散布盘面上仍宣布"密集消行机会"。
     */
    const nearFullForIntent = ctx.nearFullLines ?? 0;
    const pcSetupForIntent = ctx.pcSetup ?? 0;
    /* v1.57.1 P3：spawnIntent 'sprint' 中间档（详见 deriveSpawnIntent JSDoc）。
     * sprintCfg 不变量在此读取一次，供 deriveSpawnIntent 与下方 sprint hints 应用层共用。 */
    const _sprintCfg = cfg.sprintIntent ?? {};
    /* v1.62.5（优化建议 #5）：spawnIntent 滞回配置 + 上一帧 intent。
     * prevSpawnIntent 由 game.js 通过 ctx 传入；未传时 hysteresis 在 deriveSpawnIntent 内 noop。 */
    const _spawnIntentCfg = cfg.spawnIntentCfg ?? {};
    /* v1.69.2：evaluation 派生信号 —— 把 playerProfile.evalMetrics（步/轮级评估的
     * 滑窗摘要）注入意图决策。这是 evaluation 系统对 adaptiveSpawn 的"反馈闭环"：
     *   - consecutiveForcedBad ≥ 2 → forceRelief（算法连续给死局，下一轮立刻减压）
     *   - recentForcedBadRate > 0.3 → reliefBoost（最近 1/3 轮被判 forced_bad）
     *   - lastRoundClassification === 'forced_bad' → 单轮信号（轻度）
     *   - recentMeanRegret > 0.4 + recentSalvageRate < 0.1 → 玩家持续高 regret 且救场
     *     率低 → engageBoost（盘面太难且玩家无能力救场，需 relief + 简化）
     * 详见 docs/algorithms/PLACEMENT_QUALITY.md §"adaptiveSpawn 反馈闭环"。 */
    const evalSnapshot = (typeof profile?.evalMetrics === 'object' && profile.evalMetrics)
        || { recentMeanRegret: 0, recentForcedBadRate: 0, recentSalvageRate: 0,
            consecutiveForcedBad: 0, lastRoundClassification: null,
            samples: 0, roundSamples: 0 };
    const evalReliefForced = evalSnapshot.consecutiveForcedBad >= 2
        || evalSnapshot.recentForcedBadRate > 0.3;

    const _intentInputs = {
        playerDistress,
        /* v1.69.2：evaluation 反馈进入 forceReliefIntent —— 连续 forced_bad ≥ 2 或
         * 最近 forcedBadRate > 0.3 时强制 relief 意图。deriveSpawnIntent 不需要知道
         * "为什么" force，只看 boolean；evaluation 派生的明细在 clearGuarantee /
         * targetSolutionRange.max 反馈处单独消费（见本函数 return 之前）。 */
        forceReliefIntent: forceReliefIntent || evalReliefForced,
        /* v1.60.45：爽感饥渴（profile.isDelightStarved() 在新一轮 spawn 时读取）。
         * 注意 _intentInputs 是 snapshot——只在 spawn 决策那一刻取值；
         * _refreshIntentSnapshot 在玩家放置后只重判 intent 不重算 delightStarved，
         * 避免一局内连续切 intent 与 dock 已展示的 hints 撒谎。 */
        delightStarved: typeof profile?.isDelightStarved === 'function'
            ? profile.isDelightStarved()
            : false,
        roundsSinceLastDelight: profile?._roundsSinceLastDelight ?? 0,
        abovePb,                                   // v1.60.37：供 DFV lateCollapse chip 豁免诊断
        pbChasePressureActive,                     // v1.61：接近/超越 PB 时加压（priority 102）
        afkEngageActive,
        challengeBoost: stressBreakdown.challengeBoost ?? 0,
        delightMode: delight.mode,
        rhythmPhase,
        stress,
        sprintCfg: _sprintCfg,
        pcSetupMinFill: PC_SETUP_MIN_FILL,
        prevIntent: ctx.prevSpawnIntent ?? null,   // v1.62.5
        /* v1.62.8：把 dwellAge 透传到 hysteresis 字段（避免新增第三个参数破坏 API） */
        hysteresis: { ..._spawnIntentCfg, dwellAge: ctx.prevSpawnIntentAge ?? 0 },
    };
    const spawnIntent = deriveSpawnIntent({
        ..._intentInputs,
        geometry: {
            nearFullLines: nearFullForIntent,
            pcSetup: pcSetupForIntent,
            boardFill: _boardFill ?? 0,
        },
    });

    /* v1.57.1 P3：sprint 意图的 hints 应用层 —— 只在判定为 sprint 时调整，
     * 不影响其他意图（relief/engage/harvest 等已被前置分支拦截）。
     * sizePreference 上移 +0.10（中等大块）、multiClearBonus 抬到 floor（默认 0.40），
     * clearGuarantee 维持当前值（不像 pressure 那样削减）。
     *
     * v1.57.4 说明：此处仍只在 spawn 决策时生效。_refreshIntentSnapshot 在玩家放置后
     * 重判 intent，但不再覆盖 hints 套装——sprint→其他切换时 hints 仍是上次出块决策的
     * 偏好，与"已经出在 dock 里的块"语义保持一致，不撒谎说"这批块是按新意图生成的"。 */
    if (spawnIntent === 'sprint') {
        const _sprintSizeShift = Number.isFinite(_sprintCfg.sizePreferenceShift)
            ? _sprintCfg.sizePreferenceShift : 0.10;
        const _sprintMCFloor = Number.isFinite(_sprintCfg.multiClearBonusFloor)
            ? _sprintCfg.multiClearBonusFloor : 0.40;
        sizePreference = Math.max(-1, Math.min(1, sizePreference + _sprintSizeShift));
        multiClearBonus = Math.max(multiClearBonus, _sprintMCFloor);
    }

    /* v1.69.2：evaluation 反馈闭环 —— 在 spawnHints clamp 前给 clearGuarantee 加一档
     * 救场。原则：宁可"算法过度友善"也不要让玩家在 forced_bad 局连续受挫。
     *   - consecutiveForcedBad ≥ 2     → +2 档（强抢救）
     *   - lastRoundClassification=='forced_bad' → +1 档（即时补偿）
     *   - recentForcedBadRate > 0.4    → +1 档（持续高 forced_bad）
     * targetSolutionRange.max 同步放宽 +2，避免软滤继续按"窄区间"拒收应急样本。 */
    if (evalSnapshot.consecutiveForcedBad >= 2) {
        clearGuarantee += 2;
    } else if (evalSnapshot.lastRoundClassification === 'forced_bad') {
        clearGuarantee += 1;
    } else if (evalSnapshot.recentForcedBadRate > 0.4) {
        clearGuarantee += 1;
    }
    /* salvage 玩家高频救场说明算法可以维持当前难度；不下放，但记 1 阶
     * sizePreference 微调让用户能继续表达技术（避免一直 relief 让强玩家枯燥）。 */
    if (evalSnapshot.recentSalvageRate > 0.3 && evalSnapshot.consecutiveForcedBad === 0) {
        sizePreference = Math.min(1, sizePreference + 0.05);
    }
    /* targetSolutionRange.max 放宽阶梯：与 clearGuarantee 同档位匹配，避免上面三个
     * 反馈分支只抬 guarantee 不放宽软滤区间，导致 blockSpawn earlyAttempt 仍按
     * 窄区间拒收应急样本（详见 blockSpawn.js solutionRejects 路径）。 */
    let _evalTargetSolutionRelax = 0;
    if (evalSnapshot.consecutiveForcedBad >= 2) {
        _evalTargetSolutionRelax = 2;
    } else if (evalSnapshot.lastRoundClassification === 'forced_bad'
        || evalSnapshot.recentForcedBadRate > 0.4) {
        _evalTargetSolutionRelax = 1;
    }

    return {
        ...base,
        shapeWeights,
        fillRatio,
        spawnHints: {
            clearGuarantee: Math.max(0, Math.min(3, clearGuarantee)),
            sizePreference: Math.max(-1, Math.min(1, sizePreference)),
            diversityBoost: Math.max(0, Math.min(1, diversityBoost)),
            spawnTargets,
            pbCurve,
            pbRatio: pbCurve.pbRatio,
            pbTension: pbCurve.pbTension,
            pbBrake: pbCurve.pbBrake,
            pbRelease: pbCurve.pbRelease,
            pbPhase: pbCurve.pbPhase,
            comboChain: Math.max(0, Math.min(1, comboChain)),
            multiClearBonus: Math.max(0, Math.min(1, multiClearBonus)),
            multiLineTarget: Math.max(0, Math.min(2, multiLineTarget)),
            delightBoost: Math.max(0, Math.min(1, delight.multiClearBoost)),
            perfectClearBoost: Math.max(0, Math.min(1, perfectClearBoost)),
            iconBonusTarget: Math.max(0, Math.min(1, iconBonusTarget)),
            delightMode: delight.mode,
            rhythmPhase,
            sessionArc,
            scoreMilestone: scoreMilestoneCheck.hit,
            scoreMilestoneValue: scoreMilestoneCheck.hit ? scoreMilestoneCheck.milestone : null,
            targetSolutionRange: _evalTargetSolutionRelax > 0 && targetSolutionRange
                ? {
                    ...targetSolutionRange,
                    max: targetSolutionRange.max != null
                        ? targetSolutionRange.max + _evalTargetSolutionRelax
                        : targetSolutionRange.max,
                }
                : targetSolutionRange,
            /* v1.57.2：新空洞难度区间，与 targetSolutionRange 并列双轴：
             * - targetSolutionRange 控制"解空间宽度"（多少种可解放法）
             * - targetHoleIncrement 控制"空洞强迫度"（最干净放法也带几个空洞）
             * blockSpawn earlyAttempt 阶段两者并行硬过滤，stress 越高 minIncrement 越高。 */
            targetHoleIncrement,
            /* v1.57.3：9 项多维 stress→算法 难度区间（与 v1.57.2 同源 stress 派生）。
             * 详见 §5.α.14 / docs/algorithms/ADAPTIVE_SPAWN.md §3.5。 */
            targetMaxHoleIncrement,
            targetHoleIncrementGap,
            targetEndFillRatio,
            targetNearFullDelta,
            targetFirstMoveSurvivorRatio,
            targetSolutionDiversity,
            targetEndFlatness,
            targetEndDangerColumns,
            targetVisualClutter,
            spawnIntent,
            /* v1.60.46（P1）：relief 救济紧迫度——供 blockSpawn._tryInjectSpecial 选 fill 地板。
             *   true（紧迫）= forceReliefIntent（末段崩盘 / 高挫败 / 复活）或深度 distress
             *                 → relief 注入维持 0.25 低地板，盘面偏空也兜底响应；
             *   false（温和）= delightStarved / 轻度 distress 等机会型救济
             *                 → 抬到 0.35 高地板，避免 near-empty 盘面送减压块的违和。
             * 阈值 -0.22 ≈ 2× 基础 relief 触发线（-0.10），代表"明显深陷"而非刚过线。 */
            reliefUrgent: forceReliefIntent || Number(playerDistress) < -0.22,
            motivationIntent,
            behaviorSegment,
            personalizationApplied: personalizationEnabled,
            accessibilityLoad,
            returningWarmupStrength,
            socialFairChallenge,
            /* v1.32：顺序刚性 — 见上方 orderRigor 注释。0=不约束，1=必须按特定顺序。
             * blockSpawn.js 消费 orderMaxValidPerms 作为硬性上限。 */
            orderRigor: Math.max(0, Math.min(1, orderRigor)),
            orderMaxValidPerms: Math.max(1, Math.min(6, orderMaxValidPerms)),
            /* v1.66：压力阶段（low/mid/high）—— blockSpawn 据此做形状池预加权 + 截断兜底；
             * orderSolutionBudget 仅高压透传，修复高 fill 下三连解评估被截断导致顺序过滤静默跳过。 */
            pressurePhase,
            orderSolutionBudget: highPhase && Number.isFinite(_pf.highOrderSolutionBudget)
                ? Math.max(1, Math.floor(_pf.highOrderSolutionBudget)) : null,
            phaseLargeCells: Number.isFinite(_pf.highPoolLargeCells) ? _pf.highPoolLargeCells : 6,
            phaseHighPoolBoost: highPhase && Number.isFinite(_pf.highPoolBoost) ? Math.max(0, _pf.highPoolBoost) : 0,
            phaseLowPoolClearBoost: lowPhase && Number.isFinite(_pf.lowPoolClearBoost) ? Math.max(0, _pf.lowPoolClearBoost) : 0,
            /* v1.48：winback 保护标识；UI / 商业化 / 推送可据此判断"是否在回流前 3 局"。 */
            winbackProtectionActive: !!winbackPreset,
            /* v1.56 §2.1：远征送爽激活态；blockSpawn / stressMeter / DFV 都可据此联动。
             * v1.56.4 §5.α.8 新增：
             *   - farExtremeBoostActive：D0 极远段（pct<extremeThreshold）；blockSpawn 进一步抬多消权重
             *   - pbOvershootActive：D4 超 PB 段；blockSpawn 抑制多消权重 + 抬大块权重 */
            farFromPBBoostActive,
            farExtremeBoostActive: !!(stressBreakdown.farExtremeBoostActive),
            pbOvershootActive,
        },
        /* v1.55.17：对外暴露 [0,1] 归一化 stress，便于面板 / DFV / 文档 / 策略卡
         * 用同一套口径解读。算法内部仍以 raw 域 [-0.2, 1] 进行所有阈值比较与
         * cap/adjust 计算，避免动 17 个 delta 常数与 25+ 阈值带来的代数漂移
         * 风险（B-Clean 决策；详见本文件顶部 normalizeStress 注释）。
         *
         * - _adaptiveStress：对外字段，归一化 [0, 1]，UI / DFV / 面板 / 文档共用
         * - _adaptiveStressRaw：对内字段，原始 raw [-0.2, 1]，供 game.js 的
         *   prevAdaptiveStress 平滑链路、spawnModel.js 的 ML 推理使用，保持
         *   smoothStress 步长语义与训练时特征分布不变 */
        _adaptiveStress: normalizeStress(stress),
        _adaptiveStressRaw: stress,
        /* _stressTarget：归一化后的中性锚（raw 0.325 ≈ norm 0.4375），供面板
         * 显示「当前 stress 距离中性锚多远」的偏差柱。 */
        _stressTarget: normalizeStress(0.325),
        _stressTargetRaw: 0.325,
        _difficultyBias: difficultyBias,
        _difficultyTuning: difficultyTuning,
        _holePressure: holePressure,
        _holes: holes,
        _solutionStress: solutionStress,
        _flowState: flow,
        _flowDeviation: flowDev,
        _feedbackBias: feedbackBias,
        _skillLevel: skill,
        _pacingPhase: profile.pacingPhase,
        _momentum: profile.momentum,
        _frustration: profile.frustrationLevel,
        _sessionPhase: profile.sessionPhase,
        _trend: trend,
        _confidence: conf,
        _historicalSkill: profile.historicalSkill,
        _sessionArc: sessionArc,
        _comboChain: comboChain,
        _rhythmPhase: rhythmPhase,
        /* v1.49：字段更名 _milestoneHit → _scoreMilestoneHit，避免与跨局成熟度里程碑（maturityMilestones.js）混淆。 */
        _scoreMilestoneHit: scoreMilestoneCheck.hit,
        _scoreMilestoneValue: scoreMilestoneCheck.hit ? scoreMilestoneCheck.milestone : null,
        _playstyle: playstyle,
        _delightMode: delight.mode,
        _delightBoost: delight.multiClearBoost,
        _perfectClearBoost: delight.perfectClearBoost,
        _targetSolutionRange: targetSolutionRange,
        _targetHoleIncrement: targetHoleIncrement,
        // v1.57.3：9 项多维难度区间顶层暴露（_ 前缀字段供 game.js / RL / 面板诊断使用）
        _targetMaxHoleIncrement: targetMaxHoleIncrement,
        _targetHoleIncrementGap: targetHoleIncrementGap,
        _targetEndFillRatio: targetEndFillRatio,
        _targetNearFullDelta: targetNearFullDelta,
        _targetFirstMoveSurvivorRatio: targetFirstMoveSurvivorRatio,
        _targetSolutionDiversity: targetSolutionDiversity,
        _targetEndFlatness: targetEndFlatness,
        _targetEndDangerColumns: targetEndDangerColumns,
        _targetVisualClutter: targetVisualClutter,
        _abilityVector: ability,
        _abilityRiskAdjust: abilityRiskAdjust,
        _boardRisk: boardRisk,
        _boardDifficulty: boardDifficulty,
        _stressBreakdown: stressBreakdown,
        _spawnTargets: spawnTargets,
        _pbCurve: pbCurve,
        _pbRatio: pbCurve.pbRatio,
        _pbTension: pbCurve.pbTension,
        _pbBrake: pbCurve.pbBrake,
        _pbRelease: pbCurve.pbRelease,
        _pbPhase: pbCurve.pbPhase,
        _spawnIntent: spawnIntent,
        /* v1.57.4：决策侧不变量快照——供 game.js _refreshIntentSnapshot() 在玩家每次
         * 放置后用同一套规则、配合实时几何（snapshotInsightGeometry）重判 spawnIntent。
         * 不含 geometry，调用方需在重判时传入实时 geometry。 */
        _intentInputs,
        _motivationIntent: motivationIntent,
        _behaviorSegment: behaviorSegment,
        _personalizationApplied: personalizationEnabled,
        _accessibilityLoad: accessibilityLoad,
        _returningWarmupStrength: returningWarmupStrength,
        _socialFairChallenge: socialFairChallenge,
        _afkEngageActive: afkEngageActive,
        /** @type {number} 供 game 写回 `_spawnContext`，见 occupancy 锚点注释 */
        _occupancyFillAnchor: occAnchor,
        /* v1.32：顺序刚性诊断字段（与 spawnHints 同源，便于 panel/replay 直接读取）。 */
        _orderRigor: orderRigor,
        _orderMaxValidPerms: orderMaxValidPerms,
        /* v1.66：压力阶段诊断字段（DFV / replay / 达成率聚合脚本读取）。 */
        _pressurePhase: pressurePhase,
        /* v1.48：winback 保护包诊断字段（供 panel / 回放追踪"为何这一帧 stress 被压低"）。 */
        _winbackPreset: winbackPreset,
    };
}

module.exports = { DEFAULT_SPAWN_PARAMS_PB_CURVE, denormalizeStress, derivePbCurve, deriveSpawnIntent, MIN_BEST_FOR_MILESTONE_TOAST, normalizeStress, resetAdaptiveMilestone, resolveAdaptiveStrategy, snapshotInsightGeometry, SPAWN_PARAM_KEYS, STRESS_NORM_OFFSET, STRESS_NORM_SCALE };
