/**
 * vipSystem.js - VIP体系实现
 *
 * 为核心玩家(L4)提供专属VIP权益，提升长期价值
 * 与 playerMaturity.js, rankSystem.js 配合
 */

import { getPlayerMaturity, getMaturityInsights } from './playerMaturity.js';

const STORAGE_KEY = 'openblock_vip_system_v1';

const VIP_LEVELS = {
    vip0: {
        name: '普通玩家',
        minScore: 0,
        benefits: [],
        badge: null
    },
    vip1: {
        name: 'VIP1',
        minScore: 1000,
        benefits: [
            { type: 'ad_removal', value: 'interstitial' },
            { type: 'daily_bonus', value: 1.2 }
        ],
        badge: 'bronze'
    },
    vip2: {
        name: 'VIP2',
        minScore: 5000,
        benefits: [
            { type: 'ad_removal', value: 'all' },
            { type: 'daily_bonus', value: 1.5 },
            { type: 'expire_protection', days: 7 }
        ],
        badge: 'silver'
    },
    vip3: {
        name: 'VIP3',
        minScore: 20000,
        benefits: [
            { type: 'ad_removal', value: 'all' },
            { type: 'daily_bonus', value: 2 },
            { type: 'expire_protection', days: 14 },
            { type: 'exclusive_shop', value: true },
            { type: 'priority_support', value: true }
        ],
        badge: 'gold'
    },
    vip4: {
        name: 'VIP4',
        minScore: 50000,
        benefits: [
            { type: 'ad_removal', value: 'all' },
            { type: 'daily_bonus', value: 2.5 },
            { type: 'expire_protection', days: 30 },
            { type: 'exclusive_shop', value: true },
            { type: 'priority_support', value: true },
            { type: 'beta_access', value: true },
            { type: 'custom_avatar', value: true }
        ],
        badge: 'platinum'
    },
    vip5: {
        name: 'VIP5',
        minScore: 100000,
        benefits: [
            { type: 'ad_removal', value: 'all' },
            { type: 'daily_bonus', value: 3 },
            { type: 'expire_protection', days: 60 },
            { type: 'exclusive_shop', value: true },
            { type: 'priority_support', value: true },
            { type: 'beta_access', value: true },
            { type: 'custom_avatar', value: true },
            { type: 'name_color', value: 'gold' },
            { type: 'dedicated_channel', value: true }
        ],
        badge: 'diamond'
    }
};

let _vipDataCache = null;

function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getVipData() {
    if (_vipDataCache) {
        return { ..._vipDataCache };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _vipDataCache = JSON.parse(raw);
            return { ..._vipDataCache };
        }
    } catch {}

    _vipDataCache = {
        lastUpdated: _todayYmd(),
        currentVip: 'vip0',
        totalScore: 0,
        lifetimeScore: 0,
        vipHistory: [],
        benefitsUsed: {},
        exclusiveUnlocks: []
    };
    return { ..._vipDataCache };
}

function _saveVipData(data) {
    _vipDataCache = data;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

function _calculateVipLevel(totalScore) {
    let currentLevel = 'vip0';

    for (const [levelId, config] of Object.entries(VIP_LEVELS)) {
        if (totalScore >= config.minScore) {
            currentLevel = levelId;
        }
    }

    return currentLevel;
}

export function updateVipScore(scoreToAdd) {
    const vipData = getVipData();
    const today = _todayYmd();

    vipData.totalScore += scoreToAdd;
    vipData.lifetimeScore += scoreToAdd;

    const newLevel = _calculateVipLevel(vipData.lifetimeScore);

    if (newLevel !== vipData.currentVip) {
        const oldLevel = vipData.currentVip;
        vipData.currentVip = newLevel;
        vipData.vipHistory.push({
            from: oldLevel,
            to: newLevel,
            timestamp: today,
            lifetimeScore: vipData.lifetimeScore
        });

        const newBenefits = VIP_LEVELS[newLevel].benefits;
        for (const benefit of newBenefits) {
            if (!vipData.benefitsUsed[newLevel]) {
                vipData.benefitsUsed[newLevel] = [];
            }
            if (!vipData.benefitsUsed[newLevel].includes(benefit.type)) {
                vipData.benefitsUsed[newLevel].push(benefit.type);
            }
        }
    }

    vipData.lastUpdated = today;
    _saveVipData(vipData);

    return {
        currentLevel: vipData.currentVip,
        levelName: VIP_LEVELS[vipData.currentVip].name,
        badge: VIP_LEVELS[vipData.currentVip].badge,
        leveledUp: newLevel !== vipData.currentVip,
        previousLevel: vipData.vipHistory.length > 0
            ? vipData.vipHistory[vipData.vipHistory.length - 1].from
            : null
    };
}

export function getVipStatus() {
    const vipData = getVipData();
    const levelConfig = VIP_LEVELS[vipData.currentVip];

    const nextLevel = _getNextVipLevel(vipData.currentVip);
    const progress = nextLevel
        ? Math.round(((vipData.lifetimeScore - levelConfig.minScore) /
            (nextLevel.minScore - levelConfig.minScore)) * 100)
        : 100;

    return {
        currentLevel: vipData.currentVip,
        levelName: levelConfig.name,
        badge: levelConfig.badge,
        totalScore: vipData.totalScore,
        lifetimeScore: vipData.lifetimeScore,
        nextLevel: nextLevel ? {
            id: nextLevel.id,
            name: nextLevel.name,
            requiredScore: nextLevel.minScore,
            scoreNeeded: nextLevel.minScore - vipData.lifetimeScore
        } : null,
        progress,
        benefits: levelConfig.benefits,
        leveledUpCount: vipData.vipHistory.length,
        benefitsUsed: vipData.benefitsUsed[vipData.currentVip] || []
    };
}

function _getNextVipLevel(currentLevel) {
    const levels = Object.entries(VIP_LEVELS);
    const currentIndex = levels.findIndex(([id]) => id === currentLevel);

    if (currentIndex < levels.length - 1) {
        return { id: levels[currentIndex + 1][0], ...levels[currentIndex + 1][1] };
    }
    return null;
}

export function getVipBenefits() {
    const vipData = getVipData();
    const levelConfig = VIP_LEVELS[vipData.currentVip];

    const activeBenefits = [];

    for (const benefit of levelConfig.benefits) {
        activeBenefits.push({
            type: benefit.type,
            value: benefit.value,
            description: _getBenefitDescription(benefit),
            active: true
        });
    }

    return activeBenefits;
}

function _getBenefitDescription(benefit) {
    const descriptions = {
        ad_removal: benefit.value === 'all' ? '移除所有广告' : '移除插屏广告',
        daily_bonus: `每日登录奖励 x${benefit.value}`,
        expire_protection: `道具过期保护 ${benefit.days} 天`,
        exclusive_shop: '专属商店',
        priority_support: '优先客服支持',
        beta_access: '测试版功能优先体验',
        custom_avatar: '自定义头像框',
        name_color: '专属名字颜色',
        dedicated_channel: '专属客服频道'
    };
    return descriptions[benefit.type] || benefit.type;
}

export function canAccessVipFeature(featureType) {
    const vipData = getVipData();
    const levelConfig = VIP_LEVELS[vipData.currentVip];

    for (const benefit of levelConfig.benefits) {
        if (benefit.type === featureType) {
            return { allowed: true, value: benefit.value };
        }
    }

    return { allowed: false, required: _getFeatureRequiredVip(featureType) };
}

function _getFeatureRequiredVip(featureType) {
    const requirements = {
        exclusive_shop: 'vip2',
        priority_support: 'vip3',
        beta_access: 'vip4',
        custom_avatar: 'vip4',
        name_color: 'vip5',
        dedicated_channel: 'vip5'
    };
    return requirements[featureType] || 'vip1';
}

export function getVipLeaderboard() {
    const vipData = getVipData();
    return {
        currentRank: 1,
        totalVipMembers: Object.keys(VIP_LEVELS).length - 1,
        topLevel: vipData.currentVip,
        percentAhead: 50
    };
}

export function invalidateVipCache() {
    _vipDataCache = null;
}