/**
 * mlGovernance.js — ML 能力治理与显式封存（ML-1）
 *
 * 决策：ZILN-LTV / MTL / bandit-spawn 等 ML 能力在未完成离线↔在线一致性验证 +
 * A/B 放量前，**显式封存**（SEALED），统一在此声明状态与原因，杜绝"暗开"。
 * 放量时把 status 改为 'canary'/'ga' 并设 rolloutPct，业务侧只调 isMlFeatureEnabled。
 */

export const ML_FEATURES = {
    ziln_ltv: {
        status: 'sealed',        // sealed | canary | ga
        rolloutPct: 0,
        reason: '离线 ZILN 与线上回收口径未对齐（UA-4 校准已上线，待 30d 真实回收回归验证）',
    },
    mtl_head: {
        status: 'sealed',
        rolloutPct: 0,
        reason: '多任务头未通过护栏（DA-3）离线评估',
    },
    bandit_spawn: {
        status: 'sealed',
        rolloutPct: 0,
        reason: 'spawn bandit 探索可能伤害爽感覆盖率，需 DA-1 北极星护栏放量',
    },
    coordination_bandit: {
        status: 'sealed',
        rolloutPct: 0,
        reason: '跨飞轮协调老虎机（ad/offer 探索）：在线奖励-LTV 折算口径与护栏需 DA-3 验证后放量；sealed 时 arbiter 走确定性最优',
    },
};

function _hashPct(userId, feature) {
    const key = `mlgov:${feature}:${userId}`;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
    return h % 100;
}

/** 某 ML 能力对该用户是否启用（sealed→恒 false；canary→按 rolloutPct 灰度；ga→true）。 */
export function isMlFeatureEnabled(feature, userId = '') {
    const f = ML_FEATURES[feature];
    if (!f) return false;
    if (f.status === 'ga') return true;
    if (f.status === 'sealed') return false;
    if (f.status === 'canary') return _hashPct(userId, feature) < (f.rolloutPct || 0);
    return false;
}

/** 治理状态快照（运营看板 / 文档审计用）。 */
export function getMlGovernanceReport() {
    return Object.entries(ML_FEATURES).map(([name, f]) => ({
        feature: name, status: f.status, rolloutPct: f.rolloutPct, reason: f.reason,
        sealed: f.status === 'sealed',
    }));
}
