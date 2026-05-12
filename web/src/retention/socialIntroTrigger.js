/**
 * socialIntroTrigger.js - 社交引入节点优化
 *
 * 在玩家生命周期关键节点引入社交功能，提升社交转化率
 * 与 friendSystem.js, guildSystem.js 配合
 */

import { t } from '../i18n/i18n.js';
import { getPlayerMaturity } from './playerMaturity.js';
import { getPlayerLifecycleStage, getLifecycleConfig } from './playerLifecycleDashboard.js';

const STORAGE_KEY = 'openblock_social_intro_v1';

const SOCIAL_INTRO_TRIGGERS = {
    add_friend: {
        stage: 'exploration',
        threshold: { games: 10, days: 5 },
        location: 'post_game',
        message: () => t('social.intro.addFriend'),
        reward: ['hint_token', 'x1']
    },
    join_guild: {
        stage: 'growth',
        threshold: { games: 30, days: 14 },
        location: 'main_menu',
        message: () => t('social.intro.joinGuild'),
        reward: ['coin', 'x100']
    },
    challenge_friend: {
        stage: 'growth',
        threshold: { games: 50, days: 21 },
        location: 'post_game',
        message: () => t('social.intro.challengeFriend'),
        reward: ['bonus_double']
    },
    share_replay: {
        stage: 'exploration',
        threshold: { games: 15, days: 7 },
        location: 'post_game',
        message: () => t('social.intro.shareReplay'),
        reward: ['coin', 'x50']
    },
    invite_friend: {
        stage: 'stability',
        threshold: { games: 100, days: 30 },
        location: 'main_menu',
        message: () => t('social.intro.inviteFriend'),
        reward: ['skin_fragment', 'x5']
    }
};

let _introDataCache = null;

function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getSocialIntroData() {
    if (_introDataCache) {
        return { ..._introDataCache };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _introDataCache = JSON.parse(raw);
            return { ..._introDataCache };
        }
    } catch {}

    _introDataCache = {
        lastUpdated: _todayYmd(),
        triggeredIntros: [],
        completedIntros: [],
        friendCount: 0,
        guildId: null
    };
    return { ..._introDataCache };
}

function _saveIntroData(data) {
    _introDataCache = data;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

export function checkSocialIntroTrigger(gameCount, daysSinceInstall) {
    const introData = getSocialIntroData();
    const maturity = getPlayerMaturity();
    const stage = getPlayerLifecycleStage({ daysSinceInstall, totalSessions: gameCount });

    const availableIntros = [];

    for (const [introId, config] of Object.entries(SOCIAL_INTRO_TRIGGERS)) {
        if (introData.triggeredIntros.includes(introId) || introData.completedIntros.includes(introId)) {
            continue;
        }

        if (config.stage !== stage && config.stage !== 'growth') {
            continue;
        }

        if (gameCount >= config.threshold.games || daysSinceInstall >= config.threshold.days) {
            const stageConfig = getLifecycleConfig(stage);

            availableIntros.push({
                id: introId,
                config,
                priority: _getIntroPriority(introId, stage),
                stageName: stageConfig.stageName
            });
        }
    }

    availableIntros.sort((a, b) => a.priority - b.priority);

    return {
        shouldTrigger: availableIntros.length > 0,
        nextIntro: availableIntros[0] || null,
        availableIntros
    };
}

function _getIntroPriority(introId, stage) {
    const priorities = {
        add_friend: stage === 'exploration' ? 1 : 3,
        share_replay: stage === 'exploration' ? 2 : 4,
        join_guild: stage === 'growth' ? 1 : 2,
        challenge_friend: stage === 'growth' ? 2 : 3,
        invite_friend: stage === 'stability' ? 1 : 2
    };
    return priorities[introId] || 5;
}

export function triggerSocialIntro(introId) {
    const introData = getSocialIntroData();

    if (!introData.triggeredIntros.includes(introId)) {
        introData.triggeredIntros.push(introId);
    }
    introData.lastUpdated = _todayYmd();

    _saveIntroData(introData);

    const config = SOCIAL_INTRO_TRIGGERS[introId];
    return {
        success: true,
        introId,
        message: config.message(),
        reward: config.reward,
        location: config.location
    };
}

export function completeSocialIntro(introId, context = {}) {
    const introData = getSocialIntroData();

    if (!introData.triggeredIntros.includes(introId)) {
        return { success: false, reason: 'Intro not triggered' };
    }

    if (introData.completedIntros.includes(introId)) {
        return { success: false, reason: 'Intro already completed' };
    }

    if (introId === 'add_friend') {
        introData.friendCount = (introData.friendCount || 0) + 1;
    } else if (introId === 'join_guild') {
        introData.guildId = context.guildId || 'temp';
    }

    introData.completedIntros.push(introId);
    introData.lastUpdated = _todayYmd();

    _saveIntroData(introData);

    return {
        success: true,
        introId,
        reward: SOCIAL_INTRO_TRIGGERS[introId].reward,
        completionBonus: context.bonus || null
    };
}

export function getSocialProgress() {
    const introData = getSocialIntroData();
    const allIntros = Object.keys(SOCIAL_INTRO_TRIGGERS);

    const completed = introData.completedIntros.length;
    const triggered = introData.triggeredIntros.length;
    const total = allIntros.length;

    return {
        completed,
        triggered,
        total,
        progress: Math.round((completed / total) * 100),
        friendCount: introData.friendCount,
        hasGuild: !!introData.guildId,
        nextMilestone: _getNextMilestone(completed),
        milestones: [
            { id: 'first_friend', name: '添加第一个好友', completed: introData.completedIntros.includes('add_friend') },
            { id: 'join_guild', name: '加入公会', completed: introData.completedIntros.includes('join_guild') },
            { id: 'first_challenge', name: '发起第一次挑战', completed: introData.completedIntros.includes('challenge_friend') },
            { id: 'share_first', name: '首次分享', completed: introData.completedIntros.includes('share_replay') },
            { id: 'invite_friend', name: '邀请好友', completed: introData.completedIntros.includes('invite_friend') }
        ]
    };
}

function _getNextMilestone(completed) {
    const milestones = [
        { count: 1, reward: '提示券 x2', name: '首个社交成就' },
        { count: 3, reward: '金币 x200', name: '社交达人' },
        { count: 5, reward: '限定头像框', name: '社交大师' }
    ];

    for (const m of milestones) {
        if (completed < m.count) {
            return { count: m.count, reward: m.reward, name: m.name };
        }
    }
    return null;
}

export function invalidateSocialIntroCache() {
    _introDataCache = null;
}