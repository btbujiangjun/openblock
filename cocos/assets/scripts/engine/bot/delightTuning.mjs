/* 自动生成 —— 请勿手改。源：web/src/bot/delightTuning.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * bot/delightTuning.js — Layer 2 体感增益（v1.71 从 adaptiveSpawn.js 抽出）
 *
 * 单一职责：根据玩家画像（skill/momentum/flow/pacing/frustration/recovery）+ 盘面信号
 * （nearFullLines/pcSetup/fill）派生四元 delight 调节：
 *   - stressAdjust       — 在 stress 主链路上叠加的轻量补偿
 *   - multiClearBoost    — 多消机会权重（送爽点）
 *   - perfectClearBoost  — 清屏块抽样权重（v1.60.34 大幅抬升）
 *   - mode               — 'relief' | 'challenge_payoff' | 'flow_payoff' | 'neutral'
 *
 * 目标：高手/无聊时给更高挑战与更强多消机会；焦虑/恢复时降低难度但保留清线爽点。
 * 纯函数：仅依赖入参，无模块状态。
 *
 * **行为契约**：与抽出前严格一致。
 */

/**
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {object} ctx
 * @param {number} fill
 * @param {object} cfg adaptiveSpawn.delight
 */
export function deriveDelightTuning(profile, ctx, fill, cfg = {}) {
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
