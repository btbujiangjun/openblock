/**
 * playerMaturity.js — 玩家成熟度（双分制）
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-1：
 *   把"玩法能力"与"商业价值"解耦为 SkillScore（M0–M4 分群依据）和 ValueScore
 *   （商业化报价/频控依据），任何把付费/广告塞回 SkillScore 的改动应被拒绝。
 *
 * 兼容性：
 *   - 旧 API 全部保留：calculateMaturityScore / getMaturityLevel / getRecommendedActions
 *     / updateMaturity / getMaturityInsights / getPlayerMaturity / invalidateMaturityCache。
 *   - calculateMaturityScore(playerData) 返回 SkillScore（旧实现混合付费时同等数据下
 *     enthusiast/veteran/core 的分数仍落在原区间，旧 vitest 不破坏）。
 *   - getPlayerMaturity 额外返回 skillScore / valueScore / matureIndex / band。
 *
 * 详细映射见 docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md §2.3。
 */

const STORAGE_KEY = 'openblock_player_maturity_v1';

/* ---------- 双分制权重（和 = 1，便于读取） ---------- */

/** 玩法能力：仅与"会不会玩、是否回访、是否解锁玩法"有关，不混商业化。 */
const SKILL_WEIGHTS = {
    avgSessionCount: 0.1875,
    sessionDuration: 0.125,
    returnFrequency: 0.1875,
    featureAdoption: 0.125,
    maxLevel: 0.125,
    totalScore: 0.125,
    achievementCount: 0.125,
};

/** 商业价值：付费深度 + 广告曝光 + 留存深度（用作 LTV 代理，而非 SkillScore 输入）。 */
const VALUE_WEIGHTS = {
    totalSpend: 0.5,
    adExposureCount: 0.3,
    retainedDays: 0.2,
};

/* 旧 API 兼容：保留 9 项混合权重的 alias，仅供历史调用方读权重表，不再用于评分。 */
const MATURITY_WEIGHTS = {
    ...SKILL_WEIGHTS,
    totalSpend: VALUE_WEIGHTS.totalSpend,
    adExposureCount: VALUE_WEIGHTS.adExposureCount,
};

const MATURITY_THRESHOLDS = {
    L1: { min: 0, max: 39 },
    L2: { min: 40, max: 59 },
    L3: { min: 60, max: 79 },
    L4: { min: 80, max: 100 },
};

/** SkillScore → M0–M3 兼容映射（L1..L4 标签 → M0..M3）。
 *
 * 注意：M4 不通过 L?→M? 表查表，而由 `getMaturityBand` 在 SkillScore ≥ 90 时
 * 单独返回；此前 v1.47 之前因为没有 L→M4 映射，`lifecycleStressCapMap` 里的
 * `S*·M4` 键永远不命中（死键）。详见 v1.48 CHANGELOG。 */
const MATURITY_BAND_MAP = {
    L1: 'M0',
    L2: 'M1',
    L3: 'M2',
    L4: 'M3',
};

/** v1.48：M-band 阈值（独立于 L 标签）。SkillScore ≥ 90 才进 M4，让顶端核心
 * 玩家与一般 L4 拉开差距，对应蓝图里"S*·M4"的高压配置真正能被命中。 */
const M_BAND_THRESHOLDS = Object.freeze([
    { band: 'M4', min: 90 },
    { band: 'M3', min: 80 },
    { band: 'M2', min: 60 },
    { band: 'M1', min: 40 },
    { band: 'M0', min: 0 },
]);

/** 综合 MatureIndex 默认融合权重；ValueScore 不再左右 M0–M4 分群。 */
const DEFAULT_COMBINED_ALPHA = 0.6;

let _maturityCache = null;

function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function _daysBetween(ymd1, ymd2) {
    const [y1, m1, d1] = ymd1.split('-').map(Number);
    const [y2, m2, d2] = ymd2.split('-').map(Number);
    const date1 = new Date(y1, m1 - 1, d1);
    const date2 = new Date(y2, m2 - 1, d2);
    return Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));
}

function _norm(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(value / max, 1));
}

export function getPlayerMaturity() {
    if (_maturityCache) {
        return { ..._maturityCache };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _maturityCache = JSON.parse(raw);
            return { ..._maturityCache };
        }
    } catch {}

    _maturityCache = {
        level: 'L1',
        band: 'M0',
        score: 0,
        skillScore: 0,
        valueScore: 0,
        matureIndex: 0,
        lastUpdated: _todayYmd(),
        history: [],
    };
    return { ..._maturityCache };
}

/**
 * 玩法能力分（**maturity SkillScore**，M0–M4 分群依据；不含付费/广告）
 *
 * ⚠️ 不要与 `web/src/playerAbilityModel.js` 输出的 `AbilityVector.skillScore`
 * 混淆——后者是局内 5 维加权 EMA，每帧刷新，直接进 `adaptiveSpawn.skillAdjust`；
 * 这里的 SkillScore 是**跨局画像**，按天 EMA，仅用于决定 maturity band（M0..M4），
 * band 再通过 `lifecycle/lifecycleStressCapMap.js` 影响出块算法 stress cap/adjust。
 *
 * 输入字段（来自 `lifecycleOrchestrator.onSessionEnd → updateMaturity`）：
 *   - avgSessionCount   会话频次
 *   - sessionDuration   平均时长
 *   - returnFrequency   回访频次
 *   - featureAdoption   功能采用率（落子完成率代理）
 *   - maxLevel          score/1000 代理
 *   - totalScore        本局得分
 *   - achievementCount  成就数
 *
 * 阈值映射（见 `getMaturityBand`）：
 *   ≥ 90 → M4 核心 / 80–89 → M3 资深 / 60–79 → M2 熟练 / 40–59 → M1 成长 / < 40 → M0 新手
 */
export function calculateSkillScore(playerData) {
    if (!playerData) return 0;
    let s = 0;
    s += _norm(playerData.avgSessionCount, 10) * SKILL_WEIGHTS.avgSessionCount;
    s += _norm(playerData.sessionDuration, 300) * SKILL_WEIGHTS.sessionDuration;
    s += _norm(playerData.returnFrequency, 7) * SKILL_WEIGHTS.returnFrequency;
    s += Math.max(0, Math.min(playerData.featureAdoption || 0, 1)) * SKILL_WEIGHTS.featureAdoption;
    s += _norm(playerData.maxLevel, 50) * SKILL_WEIGHTS.maxLevel;
    s += _norm(playerData.totalScore, 100000) * SKILL_WEIGHTS.totalScore;
    s += _norm(playerData.achievementCount, 30) * SKILL_WEIGHTS.achievementCount;
    return Math.round(s * 100);
}

/** 商业价值分（驱动报价 / 频控 / IAA-IAP 切换；不参与 M0–M4 分群） */
export function calculateValueScore(playerData) {
    if (!playerData) return 0;
    let v = 0;
    v += _norm(playerData.totalSpend, 100) * VALUE_WEIGHTS.totalSpend;
    v += _norm(playerData.adExposureCount, 50) * VALUE_WEIGHTS.adExposureCount;
    v += _norm(playerData.retainedDays, 30) * VALUE_WEIGHTS.retainedDays;
    return Math.round(v * 100);
}

/** 兼容旧 API：返回 SkillScore，保持 L1–L4 阈值与历史测试边界一致。 */
export function calculateMaturityScore(playerData) {
    return calculateSkillScore(playerData);
}

/** 综合 MatureIndex（仅用于展示、报告和加权 LTV 估算，不进入分群判定） */
export function calculateCombinedMatureIndex(skillScore, valueScore, alpha = DEFAULT_COMBINED_ALPHA) {
    const a = Math.max(0, Math.min(alpha, 1));
    const s = Number.isFinite(skillScore) ? skillScore : 0;
    const v = Number.isFinite(valueScore) ? valueScore : 0;
    return Math.round(a * s + (1 - a) * v);
}

export function getMaturityLevel(score) {
    if (score >= 80) return 'L4';
    if (score >= 60) return 'L3';
    if (score >= 40) return 'L2';
    return 'L1';
}

/**
 * 蓝图统一对外的 M-band 标签。v1.48 起：
 *   - SkillScore ≥ 90 → M4（顶端核心）
 *   - 80-89 → M3 / 60-79 → M2 / 40-59 → M1 / 0-39 → M0
 *
 * 与 L1..L4 标签的关系：L4(80-100) 内部按 SkillScore 进一步分 M3 / M4，
 * 让 `lifecycleStressCapMap` 里的 `S*·M4` 键有机会命中（此前永远是死键）。
 */
export function getMaturityBand(skillScore) {
    const s = Number(skillScore) || 0;
    for (const t of M_BAND_THRESHOLDS) {
        if (s >= t.min) return t.band;
    }
    return 'M0';
}

export function updateMaturity(gameData) {
    const today = _todayYmd();
    const current = getPlayerMaturity();

    const sessionCount = gameData.sessionCount || 1;
    const avgDuration = gameData.avgDuration || gameData.lastDuration || 0;
    const returnFreq = gameData.returnFrequency || 1;
    const featureRate = gameData.featureAdoption || 0.1;

    const maxLevel = gameData.maxLevel || 0;
    const totalScore = gameData.totalScore || 0;
    const achievementCount = gameData.achievementCount || 0;

    const totalSpend = gameData.totalSpend || 0;
    const adExposureCount = gameData.adExposureCount || 0;
    /* retainedDays：玩家从首装机到今天的总天数；P0-1 引入用于 ValueScore 第三项。
     * 对历史档（无 history）退化为 daysSinceInstall，避免冷启动时 valueScore 永为 0。 */
    const retainedDays = gameData.retainedDays
        ?? gameData.daysSinceInstall
        ?? _calculateDaysAsPlayer(current);

    const playerData = {
        avgSessionCount: sessionCount,
        sessionDuration: avgDuration,
        returnFrequency: returnFreq,
        featureAdoption: featureRate,
        maxLevel,
        totalScore,
        achievementCount,
        totalSpend,
        adExposureCount,
        retainedDays,
    };

    const skillScore = calculateSkillScore(playerData);
    const valueScore = calculateValueScore(playerData);
    const matureIndex = calculateCombinedMatureIndex(skillScore, valueScore);
    const newLevel = getMaturityLevel(skillScore);
    const newBand = getMaturityBand(skillScore);

    const historyEntry = {
        date: today,
        level: newLevel,
        band: newBand,
        score: skillScore,
        skillScore,
        valueScore,
        matureIndex,
        sessionCount,
        totalScore,
        totalSpend,
        daysSinceInstall: gameData.daysSinceInstall || 0,
    };

    const updatedHistory = [...current.history, historyEntry].slice(-30);

    const updated = {
        level: newLevel,
        band: newBand,
        score: skillScore,
        skillScore,
        valueScore,
        matureIndex,
        lastUpdated: today,
        history: updatedHistory,
        totalScore,
        totalSessions: (current.totalSessions || 0) + (gameData.sessionsAdded || 1),
        totalSpend,
        maxLevel: Math.max(maxLevel, current.maxLevel || 0),
        achievementCount: Math.max(achievementCount, current.achievementCount || 0),
        adExposureCount: (current.adExposureCount || 0) + (gameData.adsWatched || 0),
        retainedDays,
    };

    _maturityCache = updated;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}

    return {
        level: newLevel,
        band: newBand,
        score: skillScore,
        skillScore,
        valueScore,
        matureIndex,
        levelChanged: newLevel !== current.level,
        previousLevel: current.level,
    };
}

export function getMaturityInsights() {
    const maturity = getPlayerMaturity();

    const recentHistory = maturity.history?.slice(-7) || [];
    const scoreTrend = recentHistory.length >= 2
        ? recentHistory[recentHistory.length - 1].score - recentHistory[0].score
        : 0;

    const sessionTrend = recentHistory.length >= 2
        ? recentHistory[recentHistory.length - 1].sessionCount - recentHistory[0].sessionCount
        : 0;

    const churnRisk = _calculateChurnRisk(maturity);

    return {
        level: maturity.level,
        band: maturity.band || getMaturityBand(maturity.skillScore ?? maturity.score ?? 0),
        score: maturity.score,
        skillScore: maturity.skillScore ?? maturity.score ?? 0,
        valueScore: maturity.valueScore ?? 0,
        matureIndex: maturity.matureIndex
            ?? calculateCombinedMatureIndex(maturity.skillScore ?? maturity.score ?? 0, maturity.valueScore ?? 0),
        scoreTrend,
        sessionTrend,
        churnRisk,
        totalSessions: maturity.totalSessions || 0,
        totalScore: maturity.totalScore || 0,
        totalSpend: maturity.totalSpend || 0,
        maxLevel: maturity.maxLevel || 0,
        daysAsPlayer: _calculateDaysAsPlayer(maturity),
    };
}

function _calculateChurnRisk(maturity) {
    const recentHistory = maturity.history?.slice(-5) || [];

    if (recentHistory.length < 3) {
        return 'unknown';
    }

    const avgRecentScore = recentHistory.reduce((sum, h) => sum + h.score, 0) / recentHistory.length;
    const firstScore = recentHistory[0].score;

    const declineRate = (firstScore - avgRecentScore) / Math.max(firstScore, 1);

    if (declineRate > 0.3) return 'high';
    if (declineRate > 0.15) return 'medium';
    if (declineRate > 0.05) return 'low';
    return 'stable';
}

function _calculateDaysAsPlayer(maturity) {
    if (!maturity.history || maturity.history.length === 0) {
        return 0;
    }
    const firstDate = maturity.history[0].date;
    const today = _todayYmd();
    return _daysBetween(firstDate, today);
}

export function getRecommendedActions(maturityLevel) {
    const actions = {
        L1: [
            { id: 'tutorial_boost', priority: 'high', description: '简化引导流程' },
            { id: 'first_day_pack', priority: 'high', description: '推送首日大礼包' },
            { id: 'difficulty_easy', priority: 'medium', description: '降低初期难度' },
            { id: 'quick_win', priority: 'medium', description: '引导快速成功体验' },
        ],
        L2: [
            { id: 'daily_task', priority: 'high', description: '强化每日任务引导' },
            { id: 'social_intro', priority: 'medium', description: '引入社交功能' },
            { id: 'first_purchase', priority: 'medium', description: '推送首充优惠' },
            { id: 'feature_unlock', priority: 'low', description: '解锁更多游戏模式' },
        ],
        L3: [
            { id: 'guild_invite', priority: 'high', description: '邀请加入公会' },
            { id: 'rank_push', priority: 'high', description: '推送段位冲刺' },
            { id: 'collection_goal', priority: 'medium', description: '推动收藏目标' },
            { id: 'friend_battle', priority: 'medium', description: '引导好友对战' },
        ],
        L4: [
            { id: 'vip_badge', priority: 'high', description: '展示VIP标识' },
            { id: 'exclusive_content', priority: 'high', description: '提供专属内容' },
            { id: 'community_leader', priority: 'medium', description: '邀请成为社区领袖' },
            { id: 'feedback_channel', priority: 'medium', description: '开通反馈直通车' },
        ],
    };

    return actions[maturityLevel] || actions['L1'];
}

export function invalidateMaturityCache() {
    _maturityCache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

export {
    SKILL_WEIGHTS,
    VALUE_WEIGHTS,
    MATURITY_WEIGHTS,
    MATURITY_THRESHOLDS,
    MATURITY_BAND_MAP,
    DEFAULT_COMBINED_ALPHA,
};
