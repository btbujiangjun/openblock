/**
 * campaignManager.js — 运营活动日历（LO-1，配置化下发）
 *
 * 纯函数：给定当前时间 + 活动配置（来自 shared/campaigns.json 或远端 CMS），
 * 解析出「当前生效」的活动列表（含周期活动 weekly/daily + 受众过滤）。
 * 不依赖 DOM，可跨端复用（web/miniprogram/cocos）。
 */

function _toTs(dateStr) {
    if (!dateStr) return null;
    const t = Date.parse(dateStr);
    return Number.isNaN(t) ? null : t;
}

/** 单个活动在 nowTs 是否处于投放窗口。 */
export function isCampaignActive(campaign, nowTs = Date.now()) {
    const start = _toTs(campaign.start);
    const end = _toTs(campaign.end);
    if (start !== null && nowTs < start) return false;
    if (end !== null && nowTs > end + 86400000 - 1) return false; // end 当天有效
    if (campaign.recurring === 'weekly' && Array.isArray(campaign.weekdays)) {
        const dow = new Date(nowTs).getUTCDay(); // 0=周日…6=周六
        if (!campaign.weekdays.includes(dow)) return false;
    }
    return true;
}

/** 受众匹配：audience='all' 或与玩家 lifecycleStage/segment 一致。 */
export function matchesAudience(campaign, ctx = {}) {
    const aud = campaign.audience || 'all';
    if (aud === 'all') return true;
    return aud === ctx.lifecycleStage || aud === ctx.segment || aud === ctx.spendTier;
}

/**
 * 返回当前生效且匹配受众的活动（按 priority 降序）。
 * @param {object} config { campaigns: [...] }
 * @param {object} ctx { lifecycleStage, segment, spendTier }
 * @param {number} nowTs
 */
export function getActiveCampaigns(config, ctx = {}, nowTs = Date.now()) {
    const list = Array.isArray(config?.campaigns) ? config.campaigns : [];
    return list
        .filter((c) => isCampaignActive(c, nowTs) && matchesAudience(c, ctx))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/** 取最高优先级的当前活动（首屏 banner 用）。 */
export function getTopCampaign(config, ctx = {}, nowTs = Date.now()) {
    return getActiveCampaigns(config, ctx, nowTs)[0] || null;
}
