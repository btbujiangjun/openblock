/**
 * 商业化功能特性开关（Feature Flags）
 *
 * 优先级：localStorage > import.meta.env > DEFAULT
 * 支持运行时热切换：setFlag(key, value) 立即生效，刷新后持久。
 *
 * 设计原则：
 *   - 每个功能独立开关，互不依赖
 *   - 默认按"观测先行、决策后行"分级：
 *       * 已稳定的基础功能（dailyTasks / leaderboard / skinUnlock / seasonPass /
 *         replayShare / insightPanel / rlPanel / lifecycleOfferToast 等）默认 true
 *       * 涉及外部依赖（adsRewarded / adsInterstitial / iap / pushNotifications）
 *         默认 false，需要显式打开
 *       * 算法层观测能力（commercialModelQualityRecording / actionOutcomeMatrix /
 *         distributionDriftMonitoring）默认 true
 *       * 算法层决策路径（commercialCalibration / explorerEpsilonGreedy /
 *         multiTaskEncoder / adInsertionBandit / adDecisionEngine /
 *         adInsertionRL）默认 false（金丝雀，验证通过后再放量）
 *   - 纯数据层，不依赖 DOM / 游戏逻辑
 */

const STORAGE_KEY = 'openblock_mon_flags_v1';

/** 各功能默认值（按"观测先行、决策后行"分级，详见模块头部说明） */
export const FLAG_DEFAULTS = {
    /** OPT-01：激励视频广告 */
    adsRewarded: false,
    /** OPT-01：插屏广告（游戏结束后） */
    adsInterstitial: false,
    /** OPT-02：IAP 内购 */
    iap: false,
    /** OPT-03：每日任务 */
    dailyTasks: true,
    /** OPT-04：在线排行榜 */
    leaderboard: true,
    /** OPT-05：皮肤等级解锁 */
    skinUnlock: true,
    /** OPT-06：赛季通行证 */
    seasonPass: true,
    /** OPT-07：Web Push 通知 */
    pushNotifications: false,
    /** OPT-08：回放分享 */
    replayShare: true,
    /**
     * OPT-09：玩家画像内嵌的「💰 商业化策略」section
     *
     * v1.13 修复：之前 `LAZY_MODULES`（monetization/index.js）里 commercialInsight 模块声明
     * `flag: 'insightPanel'`，但本对象**未声明该 key**，`getFlag('insightPanel')` 始终返回 false，
     * 导致 commercialInsight 永远不被 import — 玩家画像底部的「💰 商业化策略」section 一直隐身。
     * 默认开启以恢复其可见性；个别 e2e/截图测试可通过 setFlag('insightPanel', false) 临时关闭。
     */
    insightPanel: true,
    /**
     * OPT-09：右下角「📊 商业化模型训练面板」浮窗（MonPanel）
     *
     * v1.13 修复：与上同源 — LAZY_MODULES 里 monPanel 声明 `flag: 'rlPanel'`（历史命名沿用 RL 面板的
     * 复用习惯），同样未在 FLAG_DEFAULTS 注册，导致 `initMonPanel` 永不执行、右下角悬浮按钮缺失，
     * 玩家画像里「💰 商业化策略」标题旁边的 ⚙ 按钮点击 `openMonPanel()` 也只会走到一个未挂载的入口。
     * 默认开启，与 insightPanel 配套（去掉一个对应功能链路就断半截）。
     */
    rlPanel: true,
    /** 调试模式：广告/IAP 使用存根实现 */
    stubMode: true,
    /**
     * v1.49.x P0-7：lifecycle:offer_available / first_purchase / churn_high
     * 三个事件的 UI Toast 接线总开关。默认 on——补齐"事件已 emit 但屏幕无感知"
     * 的最后一公里；如需在 e2e/截图测试中关闭，setFlag('lifecycleOfferToast', false)。
     */
    lifecycleOfferToast: true,
    /**
     * v1.49.x P1-1：abilityVector 信号灰度入口。
     * 当 on（默认）时，commercialModel 在计算 payerScore / iapPropensity 等 vector
     * 时叠加 abilityVector 的 boardPlanning / confidence 等维度——让"高规划/高
     * 自信"玩家被识别为更高 IAP 倾向；
     * 当 off 时，commercialModel 退回到不依赖 abilityVector 的旧版规则。
     */
    abilityCommercial: true,
    /**
     * v1.49.x P1-3：付费定价矩阵（stage × unifiedRisk）灰度入口。
     * 当 on（默认）时，paymentManager.calculateDiscountedPrice 在原 LIMITED_OFFERS
     * 折扣基础上叠加 stage×risk 的动态加成（最高 +20%）。
     */
    dynamicPricing: true,
    /**
     * v1.49.x P1-5：progression.isSkinUnlocked 委托给 skinUnlock 的灰度入口。
     * 当 on（默认）时，等级解锁前置条件改用 skinUnlock 单一权威源；
     * 当 off 时，退回旧的 progression 内置查表逻辑。
     */
    skinUnlockBridge: true,
    /**
     * v1.49.x P2-3：adTrigger 委托 adDecisionEngine 做"插屏 vs 激励"的统一决策灰度。
     * 当 on 时，adTrigger 在 game_over 时调用 adDecisionEngine.requestAd
     * （场景化决策 + 体验分护栏 + 内部记录）；当 off 时，沿用旧的"硬调 showInterstitialAd"路径。
     * 默认 off 直到金丝雀验证；可在 monPanel 切换。
     */
    adDecisionEngine: false,
    /**
     * v1.49.x P3-2：广告插入 RL scaffolding 灰度入口。
     * 当 on 时，adDecisionEngine 在 _selectBestAdType 之前先走 buildAdInsertionState +
     * selectAdInsertionAction（默认规则版策略 = 与 _selectBestAdType 等价；
     * 线下训练好后可通过 setAdInsertionPolicy 注入真 RL 推理函数）。
     * 默认 off：scaffolding 已就位但需金丝雀实测确认无回归再放量。
     */
    adInsertionRL: false,
    /**
     * v1.49.x P3-3：首充时机优化（规则版）灰度入口。
     * 当 on（默认）时，firstPurchaseFunnel 在玩家"高 confidence 段 + connection_high"
     * 等关键时点主动 emit lifecycle:offer_available（type=first_purchase_window）。
     */
    firstPurchaseTiming: true,
    /**
     * v1.49.x P3-4：高 LTV 玩家自动加深广告拦截。
     * 当 on（默认）时，adTrigger / adDecisionEngine 对 vip.tier ≥ T2 / lifetimeSpend ≥ 50
     * 的玩家在插屏路径上额外乘 0.3 的展示概率，保护核心付费用户体验。
     */
    ltvAdShield: true,

    /* ─── v1.49.x 算法层一揽子改造（snapshot / calibration / monitoring / explorer / MTL / drift） ─── */

    /**
     * 算法层 P0-1：propensity 校准在线生效灰度。
     * 当 on 时，commercialModel 输出 vector.calibrated；下游可消费校准后的概率
     * 做阈值决策（默认 off：avoid 行为漂移，先观察 calibrated 与 raw 的 lift）。
     */
    commercialCalibration: false,

    /**
     * 算法层 P0-2：模型质量监控写入。
     * 当 on（默认）时，commercialModel 推理时把 (raw, calibrated, label) 写入 modelQualityMonitor
     * 的滑动缓冲，供 /api/ops/dashboard 看 PR-AUC / Brier。
     * label 由 actionOutcomeMatrix 的 outcome 回填（30min 窗口内）。
     */
    commercialModelQualityRecording: true,

    /**
     * 算法层 P0-3：action × outcome 矩阵的 bus 接线。
     * 当 on（默认）时，actionOutcomeMatrix 监听 purchase_completed / ad_complete /
     * lifecycle:session_end，自动维护 24h 矩阵；运营看板可调 getMatrix() 拿数据。
     */
    actionOutcomeMatrix: true,

    /**
     * 算法层 P1-1：5–10% 探索流量。
     * 当 on 时，commercialModel.recommendedAction 经 wrapWithExplorer 后输出，并打
     * mode='explore' 的 IPS 标签写入 actionOutcomeMatrix。默认 off，灰度小流量验证。
     */
    explorerEpsilonGreedy: false,

    /**
     * 算法层 P1-2：MTL encoder 推理路径。
     * 当 on 时，commercialModel 在 vector 上额外输出 mtl 字段（4 个 head 的预测）；
     * 默认 off：还在 raw vs mtl 对照阶段，等离线 head 训练好再切到 decision 路径。
     */
    multiTaskEncoder: false,

    /**
     * 算法层 P2-3：分布漂移监控写入。
     * 当 on（默认）时，buildCommercialModelVector 会把 snapshot.vector 喂给
     * distributionDriftMonitor，便于线上累积线上分布并对照训练分布算 KL。
     */
    distributionDriftMonitoring: true,

    /**
     * 算法层 P3-1：LinUCB contextual bandit。
     * 当 on 时，adInsertionRL.selectAdInsertionAction 走 buildBanditPolicyForAdInsertion
     * 而不是规则版；默认 off。
     */
    adInsertionBandit: false,
};

/** 从 localStorage 加载已持久化的 flag 覆盖 */
function _loadPersisted() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
}

/** 内存缓存（进程级，保证 getFlag 同步快速） */
let _cache = null;

function _build() {
    const persisted = _loadPersisted();
    return { ...FLAG_DEFAULTS, ...persisted };
}

/**
 * 读取一个 flag 值
 * @param {keyof typeof FLAG_DEFAULTS} key
 * @returns {boolean}
 */
export function getFlag(key) {
    if (!_cache) _cache = _build();
    return Boolean(_cache[key]);
}

/**
 * 热设置 flag（立即生效 + localStorage 持久化）
 * @param {keyof typeof FLAG_DEFAULTS} key
 * @param {boolean} value
 */
export function setFlag(key, value) {
    if (!_cache) _cache = _build();
    _cache[key] = Boolean(value);
    try {
        const persisted = _loadPersisted();
        persisted[key] = Boolean(value);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch { /* ignore */ }
}

/**
 * 重置所有 flag 为默认值
 */
export function resetFlags() {
    _cache = { ...FLAG_DEFAULTS };
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

/**
 * 返回当前完整 flag 快照（用于调试面板）
 * @returns {Record<string, boolean>}
 */
export function getAllFlags() {
    if (!_cache) _cache = _build();
    return { ..._cache };
}
