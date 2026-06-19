/**
 * derivation/selectors.js — v1.58 单一事实源（Single Source of Truth）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1.57.5 治理后，6 项 UI 一致性 bug 的根因被收口为：**同一指标有 N 个 cache，
 * 更新触发器各不相同**——DFV 节点读 ctx.profile.boardFill、sparkline 读 IIFE
 * liveBoardFill、playerInsightPanel 读 game.grid.getFillRatio()，
 * 三处各算各的，去抖指纹又漏算其中一份。
 *
 * v1.58 引入"派生层"（derivation layer），明确职责分离：
 *
 *   ┌────────────────┐    ┌─────────────────┐    ┌────────────┐
 *   │ adaptiveSpawn  │ →  │   derivation/   │ →  │  UI 层      │
 *   │ (算法决策)      │    │ (SSOT + 派生)   │    │ (DFV / ...) │
 *   └────────────────┘    └─────────────────┘    └────────────┘
 *
 * - **算法层** 产出原始信号（stress / breakdown / spawnHints / ...）
 * - **派生层** 把信号 + 实时几何 派生成 UI 唯一消费的 PresentationModel
 * - **UI 层** 只读 PresentationModel，禁止直接读 game.grid / game._lastAdaptiveInsight
 *
 * 本文件是派生层的**最底层入口**：任何"实时几何 / 算法快照"读取都必须经过
 * 这里的 selector 函数。下游模块（intentResolver / displayContracts /
 * presentationReducer）只接受 selector 的返回值，禁止再次穿透到 game 内部字段。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 强制约束（ESLint 规则未来可固化）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ❌ 禁止：`game.grid.getFillRatio()`           （UI 层直接读 grid）
 *   ❌ 禁止：`game._lastAdaptiveInsight.boardFill` （UI 层直接读 cached 字段）
 *   ❌ 禁止：`profile.metrics.clearRate`           （UI 层直接读 profile）
 *
 *   ✅ 应当：`selectLiveBoardFill(game)`
 *   ✅ 应当：`selectInsightWithLiveGeometry(game)`
 *   ✅ 应当：`selectLiveClearRate(game)`
 *
 * 这样的好处：
 *   - 新增 cache 不会让 UI 再出现"同帧两值"
 *   - 字段重命名 / 重构只改 selector 一处
 *   - selector 内部可以加 staleness 检测、降级、断言
 *   - 性质测试 / 监控 probe 可以统一拦截 selector 调用
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  实时几何 Selectors                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 选择当前盘面占用率（实时）。
 *
 * 优先级：grid.getFillRatio() > 顶层 insight.boardFill > 0。
 *
 * @param {{grid?: {getFillRatio?: () => number}}} game
 * @returns {number} 0..1
 */
export function selectLiveBoardFill(game) {
    if (!game) return 0;
    try {
        const v = game.grid?.getFillRatio?.();
        if (Number.isFinite(v)) return v;
    } catch { /* grid 接口异常时回退 */ }
    const cached = Number(game._lastAdaptiveInsight?.boardFill);
    return Number.isFinite(cached) ? cached : 0;
}

/**
 * 选择当前消行率（实时，单位 / 块）。
 *
 * playerProfile.metrics.clearRate 是 EMA 平滑量，玩家每次放置后立即更新，
 * 不存在 dock 周期级的快照滞后。直接读最权威的源。
 *
 * @param {{playerProfile?: {metrics?: {clearRate?: number}}}} game
 * @returns {number}
 */
export function selectLiveClearRate(game) {
    if (!game) return 0;
    const v = Number(game.playerProfile?.metrics?.clearRate);
    return Number.isFinite(v) ? v : 0;
}

/**
 * 选择当前失放率（实时，单位 / 块）。
 *
 * @param {{playerProfile?: {metrics?: {missRate?: number}}}} game
 * @returns {number}
 */
export function selectLiveMissRate(game) {
    if (!game) return 0;
    const v = Number(game.playerProfile?.metrics?.missRate);
    return Number.isFinite(v) ? v : 0;
}

/**
 * 选择当前盘面几何摘要（实时，5 字段）。
 *
 * 优先级：
 *   1. game._lastAdaptiveInsight.spawnDiagnostics.layer1.{fill,holes,nearFullLines,multiClearCandidates,pcSetup}
 *      —— 由 v1.57.4 `_refreshIntentSnapshot` 在玩家每次放置后实时刷新
 *   2. grid.getFillRatio() —— 顶层 fill 兜底
 *
 * 这是 "实时几何" 的权威源，下游 contracts / reducer 都从这里取。
 *
 * @param {object} game
 * @returns {{fill:number, holes:number, nearFullLines:number, multiClearCandidates:number, pcSetup:number}}
 */
export function selectLiveGeometry(game) {
    const empty = { fill: 0, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 };
    if (!game) return empty;
    const layer1 = game._lastAdaptiveInsight?.spawnDiagnostics?.layer1;
    if (layer1 && typeof layer1 === 'object') {
        return {
            fill: Number.isFinite(layer1.fill) ? layer1.fill : selectLiveBoardFill(game),
            holes: Number.isFinite(layer1.holes) ? layer1.holes : 0,
            nearFullLines: Number.isFinite(layer1.nearFullLines) ? layer1.nearFullLines : 0,
            multiClearCandidates: Number.isFinite(layer1.multiClearCandidates) ? layer1.multiClearCandidates : 0,
            pcSetup: Number.isFinite(layer1.pcSetup) ? layer1.pcSetup : 0,
        };
    }
    return { ...empty, fill: selectLiveBoardFill(game) };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  决策快照 Selectors                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 选择当前 adaptive insight 决策快照（v1.57.4 后已含增量刷新的 spawnIntent +
 * spawnDiagnostics.layer1 + 顶层 boardFill）。
 *
 * @param {object} game
 * @returns {object|null}
 */
export function selectInsight(game) {
    return game?._lastAdaptiveInsight ?? null;
}

/**
 * 选择"合并实时几何后的 insight 视图"——把 selectLiveGeometry 的结果合入
 * insight.spawnDiagnostics.layer1 与顶层 boardFill，确保下游 reducer/contracts
 * 看到的几何一定是最新的，即便 _refreshIntentSnapshot 之后又过了若干帧。
 *
 * 这是 reducer 与 contracts 的**唯一推荐入口**。
 *
 * @param {object} game
 * @returns {object|null}
 */
export function selectInsightWithLiveGeometry(game) {
    const insight = selectInsight(game);
    if (!insight) return null;
    const geom = selectLiveGeometry(game);
    return {
        ...insight,
        boardFill: geom.fill,
        spawnDiagnostics: {
            ...(insight.spawnDiagnostics ?? {}),
            layer1: {
                ...(insight.spawnDiagnostics?.layer1 ?? {}),
                fill: geom.fill,
                holes: geom.holes,
                nearFullLines: geom.nearFullLines,
                multiClearCandidates: geom.multiClearCandidates,
                pcSetup: geom.pcSetup,
            },
        },
    };
}

/**
 * 选择「难度相对论」一帧标定快照（§4.17/§2.10）。SSOT：`_lastAdaptiveInsight.relativity`
 * （由 game.js `_captureAdaptiveInsight` 汇总 resolveAdaptiveStrategy + generateDockShapes 诊断）。
 *
 * 返回结构稳定（缺失字段补 null/0），下游 reducer/contracts/DFV/透视仪只读这里，
 * 禁止再穿透到 insight.relativity / spawnDiagnostics.relativity。
 *
 * @param {object} game
 * @returns {{
 *   enabled: boolean, active: boolean, bypass: string|null, lambda: number,
 *   dStar: number|null, objectiveTarget: object|null, latentCalibration: object|null,
 *   thetaConfidence: number|null, thetaN: number|null, chosenAlign: number|null,
 *   chosenVec: object|null, candidatesConsidered: number|null, targetGap: number|null
 * }}
 */
export function selectRelativity(game) {
    return relativityViewFromInsight(selectInsight(game));
}

/**
 * 纯函数版（不依赖 game 实例）：从一份 insight（含 `relativity` 子对象）派生稳定的
 * 难度相对论视图。供 selectRelativity / presentationReducer.buildChipCtxFromInsight /
 * DFV 直接传 insight 的场景复用，避免口径漂移。
 *
 * @param {object|null} insight game._lastAdaptiveInsight（或回放帧重建的等价对象）
 * @returns {object} 见 selectRelativity 返回结构
 */
export function relativityViewFromInsight(insight) {
    const base = {
        enabled: false, active: false, bypass: null, lambda: 0,
        /* §O1/O2/O5：新增三项稳定字段（缺省 null/false）。 */
        intent: null, phaseGeomGain: null, earlyPhaseCapHit: false,
        /* §O3：PEOG 让位计数器快照（仅 PEOG active 时有值，否则 null）。 */
        peogYieldHits: null,
        dStar: null, objectiveTarget: null, latentCalibration: null,
        thetaConfidence: null, thetaN: null, chosenAlign: null,
        chosenVec: null, candidatesConsidered: null, targetGap: null,
    };
    const r = insight?.relativity;
    if (!r || typeof r !== 'object') return base;
    const bStar = r.objectiveTarget && typeof r.objectiveTarget === 'object' ? r.objectiveTarget : null;
    const chosen = r.chosen && typeof r.chosen === 'object' ? r.chosen : null;
    const chosenVec = chosen && chosen.chosenVec && typeof chosen.chosenVec === 'object' ? chosen.chosenVec : null;
    const meanAbsDelta = (a, b) => {
        if (!a || !b) return null;
        const keys = ['spatial', 'combo', 'order', 'recovery', 'tempo', 'clearEff'];
        let s = 0; let n = 0;
        for (const k of keys) {
            const x = Number(a[k]); const y = Number(b[k]);
            if (Number.isFinite(x) && Number.isFinite(y)) { s += Math.abs(x - y); n++; }
        }
        return n ? s / n : null;
    };
    const lambda = Number.isFinite(Number(r.lambda)) ? Number(r.lambda) : 0;
    const bypass = r.bypass ?? null;
    return {
        enabled: r.enabled === true,
        /* active = 真正发生了个性化（已启用 + 无 bypass + λ>0）。UI 据此显示"已个性化"徽标。 */
        active: r.enabled === true && bypass == null && lambda > 0,
        bypass,
        lambda,
        /* §O1 相位化对齐预算：'off'|'prior_only'|'kbest_only'|'full'|null。 */
        intent: typeof r.intent === 'string' ? r.intent : null,
        /* §O2 本帧 ability 几何信号增益（1=完全消费/默认，<1=onboarding/warmRun 期衰减）。 */
        phaseGeomGain: Number.isFinite(Number(r.phaseGeomGain)) ? Number(r.phaseGeomGain) : null,
        /* §O5 本帧 b* 是否触前期上界。 */
        earlyPhaseCapHit: r.earlyPhaseCapHit === true,
        /* §O3 PEOG bottleneck/near_miss 让位连续帧计数（含 bypass 原因）。 */
        peogYieldHits: r.peogYieldHits && typeof r.peogYieldHits === 'object'
            ? { ...r.peogYieldHits } : null,
        dStar: Number.isFinite(Number(r.dStar)) ? Number(r.dStar) : null,
        objectiveTarget: bStar ? { ...bStar } : null,
        latentCalibration: r.latentCalibration ? { ...r.latentCalibration } : null,
        thetaConfidence: r.latent && Number.isFinite(Number(r.latent.confidence)) ? Number(r.latent.confidence) : null,
        thetaN: r.latent && Number.isFinite(Number(r.latent.n)) ? Number(r.latent.n) : null,
        chosenAlign: chosen && Number.isFinite(Number(chosen.chosenAlign)) ? Number(chosen.chosenAlign) : null,
        chosenVec: chosenVec ? { ...chosenVec } : null,
        candidatesConsidered: chosen && Number.isFinite(Number(chosen.candidatesConsidered)) ? Number(chosen.candidatesConsidered) : null,
        targetGap: meanAbsDelta(chosenVec, bStar),
    };
}

/**
 * 选择当前 spawnIntent（v1.57.4 起在 spawnHints.spawnIntent 与顶层 spawnIntent
 * 两处冗余存在；优先取 spawnHints 的最新派生值）。
 *
 * @param {object} game
 * @returns {string|null}
 */
export function selectSpawnIntent(game) {
    const insight = selectInsight(game);
    if (!insight) return null;
    return insight.spawnHints?.spawnIntent ?? insight.spawnIntent ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  玩家档案 Selectors                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 选择 playerProfile 的"压力链路相关字段"子集，供 reducer / contracts 消费。
 * 不暴露整个 profile 是为了让契约层依赖明确（profile 字段重命名只改这里）。
 *
 * @param {object} game
 * @returns {object|null}
 */
export function selectProfileForPresentation(game) {
    const p = game?.playerProfile;
    if (!p) return null;
    return {
        skillLevel: p.skillLevel,
        momentum: p.momentum,
        frustrationLevel: p.frustrationLevel,
        flowState: p.flowState,
        sessionPhase: p.sessionPhase,
        cognitiveLoad: p.cognitiveLoad,
        recentComboStreak: p.recentComboStreak ?? 0,
        boardFill: selectLiveBoardFill(game),
        metrics: {
            clearRate: selectLiveClearRate(game),
            missRate: selectLiveMissRate(game),
            ...(p.metrics ?? {}),
        },
        isInOnboarding: p.isInOnboarding,
    };
}

/**
 * 选择"实时几何 + spawnIntent + 顶层 stress" 三件套——presentationReducer
 * 的最小输入。
 *
 * @param {object} game
 * @returns {{intent: string|null, stress: number, geometry: object, breakdown: object, hints: object, distress: object}}
 */
export function selectReducerInputs(game) {
    const insight = selectInsightWithLiveGeometry(game);
    const profile = game?.playerProfile;
    if (!insight) {
        return {
            intent: null,
            stress: 0,
            geometry: selectLiveGeometry(game),
            breakdown: {},
            hints: {},
            distress: {
                sessionPhase: profile?.sessionPhase,
                momentum: profile?.momentum,
                frustrationLevel: profile?.frustrationLevel ?? 0,
                boardFill: selectLiveBoardFill(game),
            },
            intentInputs: null,
            relativity: selectRelativity(game),
        };
    }
    /* v1.58.1：派生 harvestReady = 当前是否真的存在可兑现的消行路径。
     * 用于 displayContracts 的"节奏类承诺"守卫（flow.payoff / relief.friendly 等），
     * 避免 spawnHints.rhythmPhase='payoff' 但 dock+盘面尚无任何 nearFullLines/mcc/pcSetup
     * 时撒谎"享受多消快感"（v1.58.1 截图 bug 的根因）。 */
    const layer1 = insight.spawnDiagnostics.layer1;
    const harvestReady = (Number(layer1.nearFullLines) >= 1)
        || (Number(layer1.multiClearCandidates) >= 1)
        || (Number(layer1.pcSetup) >= 1);
    return {
        intent: insight.spawnHints?.spawnIntent ?? insight.spawnIntent ?? null,
        stress: Number.isFinite(insight.stress) ? insight.stress : 0,
        geometry: {
            fill: layer1.fill,
            holes: layer1.holes,
            nearFullLines: layer1.nearFullLines,
            multiClearCandidates: layer1.multiClearCandidates,
            pcSetup: layer1.pcSetup,
            boardFill: layer1.fill,
            harvestReady,
        },
        breakdown: insight.stressBreakdown ?? {},
        hints: insight.spawnHints ?? {},
        intentInputs: insight._intentInputs ?? null,
        distress: {
            sessionPhase: insight.sessionPhase ?? profile?.sessionPhase,
            momentum: insight.momentum ?? profile?.momentum,
            frustrationLevel: insight.frustration ?? insight.frustrationLevel ?? profile?.frustrationLevel ?? 0,
            boardFill: insight.spawnDiagnostics.layer1.fill,
            /* v1.58.3：暴露 flowState（profile 中长期心流判定）给 reducer 派生跨维度冲突。
             * flowState='bored' 与 intent='relief' 等组合时，reducer 输出 conflicts 数组。 */
            flowState: profile?.flowState ?? null,
        },
        afkEngageActive: !!insight.afkEngageActive,
        scoreMilestoneHit: !!insight.scoreMilestoneHit,
        personalizationApplied: !!insight.personalizationApplied,
        onboarding: !!profile?.isInOnboarding,
        /* §4.17/§2.10：难度相对论标定快照，供 reducer 派生 presentationModel.relativity，
         * 让 DFV / 透视仪 / stressMeter 统一从 PresentationModel 读取，禁止穿透 insight。 */
        relativity: selectRelativity(game),
    };
}
