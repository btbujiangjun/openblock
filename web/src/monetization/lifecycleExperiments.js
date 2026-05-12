/**
 * lifecycleExperiments.js — 8 个生命周期/成熟度实验模板登记器
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT §5（E1–E8）：
 *   把蓝图建议立刻启动的 8 个实验抽成静态模板，统一登记到 experimentPlatform。
 *   仅"登记 + 默认 disabled"，由运营或 dev 工具按需开启某次 A/B；护栏指标
 *   （D1/D7/IAA/IAP）不在本文件硬编码，由 ABTest 平台统一对照。
 *
 *   - 同时落地 P1-3"玩法保真实验"：E_TG（Treatment Guard）只允许变量
 *     {clearGuarantee, sizePreference}，禁止动 spawnIntent 词典与 stress 字典；
 *     在 metadata.allowedVariables 中显式声明。
 */

/**
 * 实验模板：与 monetization/abTestManager 期望的形状对齐。
 *   - id：与蓝图 ID 严格一致
 *   - segment：分群匹配（可空，等价于全体）
 *   - hypothesis / successMetrics：纯文本，便于 dev 面板渲染
 *   - variants：默认两组（control / treatment），调用方可 override
 *   - allowedVariables：白名单——这是 P1-3 保真实验最核心的工程契约
 *   - defaultEnabled：默认 false，避免登记动作就直接上线
 */
export const LIFECYCLE_EXPERIMENT_TEMPLATES = Object.freeze([
    {
        id: 'E1-first-day-payoff-accelerator',
        title: '首日爽点加速',
        segment: { stage: 'S0', band: 'M0' },
        hypothesis: '首局 90 秒内出现一次高价值反馈可显著抬升 D1。',
        successMetrics: ['d1_retention', 'ftue_completion_rate'],
        allowedVariables: ['clearGuarantee', 'firstSpawnPool'],
        variants: [
            { id: 'control', weight: 0.5 },
            { id: 'treatment', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E2-bottleneck-prompt',
        title: '瓶颈预警提示',
        segment: { stage: 'S1', band: ['M0', 'M1'] },
        hypothesis: 'firstMoveFreedom ≤ 2 时给轻提示可降低早期流失。',
        successMetrics: ['d3_retention', 'next_run_open_rate_after_loss'],
        allowedVariables: ['hintEnabled', 'firstMoveFreedomThreshold'],
        variants: [
            { id: 'control', weight: 0.5 },
            { id: 'treatment', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E3-weekly-rhythm',
        title: '周活动节律',
        segment: { stage: 'S2', band: ['M1', 'M2'] },
        hypothesis: '72h 活动 + 空窗优于连续活动。',
        successMetrics: ['weekly_challenge_join_rate', 'd14_retention'],
        allowedVariables: ['challengeWindowMs', 'breakWindowMs'],
        variants: [
            { id: 'continuous', weight: 0.5 },
            { id: 'pulsed_72_18', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E4-tier-challenge-pack',
        title: '挑战包分层',
        segment: { stage: ['S2', 'S3'], band: ['M2', 'M3', 'M4'] },
        hypothesis: '按成熟度发挑战可提升留存且不伤满意度。',
        successMetrics: ['d30_retention', 'churn_rate'],
        allowedVariables: ['challengeDifficultyTier'],
        variants: [
            { id: 'flat', weight: 0.5 },
            { id: 'tiered', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E5-winback-3-rounds',
        title: '回流三局保护',
        segment: { stage: 'S4' },
        hypothesis: '回流首 3 局减压可提升回流 7 日留存。',
        successMetrics: ['winback_7day_retention'],
        allowedVariables: ['winbackProtectionEnabled'],
        variants: [
            { id: 'no_protection', weight: 0.5 },
            { id: 'protected', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E6-ad-fatigue-frequency-cap',
        title: '广告疲劳频控',
        segment: { adExposure: 'high' },
        hypothesis: '按 ad fatigue 动态限频可减少流失。',
        successMetrics: ['next_day_return_rate', 'iaa_arpdau'],
        allowedVariables: ['adFatigueWindowMs', 'adDailyCap'],
        variants: [
            { id: 'static_cap', weight: 0.5 },
            { id: 'fatigue_aware', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E7-first-purchase-timing',
        title: '首充时机模型',
        segment: { stage: ['S1', 'S2'], band: 'M1' },
        hypothesis: '首次高峰体验后 1–2 局推首充转化更高。',
        successMetrics: ['first_purchase_conversion'],
        allowedVariables: ['triggerDelayRounds', 'offerSku'],
        variants: [
            { id: 'session_start', weight: 0.5 },
            { id: 'after_peak', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    {
        id: 'E8-intent-lexicon-unification',
        title: 'Intent 文案统一',
        segment: {},
        hypothesis: 'spawnIntent 与运营文案一致可提升策略理解与接受度。',
        successMetrics: ['advice_follow_rate', 'avg_session_duration'],
        allowedVariables: ['intentLexiconVersion'],
        variants: [
            { id: 'legacy', weight: 0.5 },
            { id: 'lexicon_v1', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
    /* P1-3 保真实验：仅允许 clearGuarantee / sizePreference 两个变量被实验改写。
     * 任何把 spawnIntent 或 stress 字典加进 allowedVariables 的 PR 应被拒绝。 */
    {
        id: 'E_TG-spawn-fidelity-guard',
        title: '玩法保真实验（P1-3）',
        segment: {},
        hypothesis: '仅在不动核心手感（spawnIntent/stress 字典）的前提下，clearGuarantee/sizePreference 微调可改善挫败救济效果。',
        successMetrics: ['recovery_success_count', 'session_duration', 'd3_retention'],
        allowedVariables: ['clearGuarantee', 'sizePreference'],
        variants: [
            { id: 'baseline', weight: 0.5 },
            { id: 'shift_minus_0_1', weight: 0.5 },
        ],
        defaultEnabled: false,
    },
]);

/**
 * 把模板登记到 abTest 管理器（如果对方暴露 registerExperiment 接口；
 * 若无该接口，本函数仅返回模板列表，由 dev 面板渲染。
 */
export function registerLifecycleExperiments(abTestManager) {
    const registered = [];
    if (!abTestManager) return registered;
    for (const tmpl of LIFECYCLE_EXPERIMENT_TEMPLATES) {
        try {
            if (typeof abTestManager.registerExperiment === 'function') {
                abTestManager.registerExperiment({
                    id: tmpl.id,
                    name: tmpl.title,
                    enabled: tmpl.defaultEnabled,
                    variants: tmpl.variants,
                    metadata: {
                        segment: tmpl.segment,
                        hypothesis: tmpl.hypothesis,
                        successMetrics: tmpl.successMetrics,
                        allowedVariables: tmpl.allowedVariables,
                    },
                });
                registered.push(tmpl.id);
            }
        } catch { /* 单个登记失败不阻塞其它 */ }
    }
    return registered;
}

export function listLifecycleExperiments() {
    return LIFECYCLE_EXPERIMENT_TEMPLATES.map((t) => ({ ...t }));
}
