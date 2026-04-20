/**
 * 广告触发器（OPT-01）
 *
 * 将广告展示时机与游戏事件信号深度绑定：
 *   - 游戏结束 → 插屏广告（付费用户跳过）
 *   - frustration_relief 信号 → 弹出激励视频（续关/获得救济）
 *   - near-miss 检测 → 激励视频钩子（通过 playerProfile 信号）
 *
 * 通过 MonetizationBus 监听事件，不修改 game.js
 */

import { getFlag } from './featureFlags.js';
import { on } from './MonetizationBus.js';
import { showRewardedAd, showInterstitialAd } from './adAdapter.js';
import { emit } from './MonetizationBus.js';

/** 本局激励广告已触发次数（防刷上限） */
let _rewardedThisGame = 0;
const MAX_REWARDED_PER_GAME = 3;

function _resetGameAdCount() { _rewardedThisGame = 0; }

/** 封装：展示激励视频 + 结果广播 */
async function _triggerRewarded(reason, rewardEvent) {
    if (!getFlag('adsRewarded')) return;
    if (_rewardedThisGame >= MAX_REWARDED_PER_GAME) return;

    _rewardedThisGame++;
    const result = await showRewardedAd(reason);
    if (result.rewarded && rewardEvent) {
        emit(rewardEvent, { reason });
    }
}

export function initAdTrigger() {
    if (!getFlag('adsRewarded') && !getFlag('adsInterstitial')) return;

    // 新局开始时重置计数
    on('spawn_blocks', _resetGameAdCount);

    // 游戏结束：插屏广告
    on('game_over', async ({ data }) => {
        await showInterstitialAd();
    });

    // Near-miss（填充率高但未消行）→ 激励视频钩子
    // PlayerProfile.hadRecentNearMiss：上一步非 miss、未消行、fill>0.6
    on('no_clear', ({ data, game }) => {
        const profile = game?.playerProfile;
        if (!profile) return;
        if (profile.hadRecentNearMiss) {
            void _triggerRewarded('差一点！看广告获得一次消行救助', 'ad_reward_near_miss');
        }
    });

    // 挫败感累积 → 激励视频（续关救济）
    on('no_clear', ({ data, game }) => {
        const profile = game?.playerProfile;
        if (!profile) return;
        if (profile.frustrationLevel >= 5 && _rewardedThisGame < MAX_REWARDED_PER_GAME) {
            void _triggerRewarded('连续未消行！看广告获得一次救济块', 'ad_reward_frustration');
        }
    });
}
