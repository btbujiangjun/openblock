/**
 * 商业化插件主入口
 *
 * 使用（main.js 中仅需两行）：
 *   import { initMonetization } from './monetization/index.js';
 *   initMonetization(game);  // game 实例创建后调用，可在 game.init() 前或后
 *
 * 热插拔：
 *   import { shutdownMonetization } from './monetization/index.js';
 *   shutdownMonetization(); // 恢复 game.logBehavior 原始方法，清除所有订阅
 */

import { attach, detach, on } from './MonetizationBus.js';
import { initAds } from './adAdapter.js';
import { initAdTrigger } from './adTrigger.js';
import { initDailyTasks } from './dailyTasks.js';
import { initLeaderboard } from './leaderboard.js';
import { initSeasonPass } from './seasonPass.js';
import { initPushNotifications, scheduleStreakReminder } from './pushNotifications.js';
import { initReplayShare } from './replayShare.js';
import { injectMonStyles } from './styles.js';
import { fetchPersonaFromServer, updateRealtimeSignals } from './personalization.js';
import { initCommercialInsight } from './commercialInsight.js';
import { initMonPanel } from './monPanel.js';

let _initialized = false;
/** 保存所有 unsubscribe 函数，供 shutdown 清理 */
const _cleanups = [];

/**
 * 初始化商业化插件系统
 * @param {object} game  Game 实例
 */
export function initMonetization(game) {
    if (_initialized) return;
    _initialized = true;

    // 1. 注入 CSS（所有 mon-* 组件共用）
    injectMonStyles();

    // 2. 附加事件总线（包装 game.logBehavior）
    attach(game);

    // 3. 初始化各功能模块
    initAds();
    initAdTrigger();
    initDailyTasks();
    initLeaderboard();
    initSeasonPass();
    initPushNotifications();
    initReplayShare();

    // 4. 个性化引擎：拉取服务端画像（延迟 2s，不阻塞游戏启动）
    const userId = game?.db?.userId ?? null;
    if (userId) {
        setTimeout(() => fetchPersonaFromServer(userId), 2000);
    }

    // 5. 商业化策略解释区（注入玩家画像面板）
    initCommercialInsight(game);

    // 6. 商业化模型训练面板（右下角悬浮按钮）
    initMonPanel(game);

    // 7. 连签提醒 + 实时信号刷新
    _cleanups.push(
        on('game_over', () => scheduleStreakReminder()),
        on('spawn_blocks', ({ game: g }) => {
            updateRealtimeSignals(g?.playerProfile ?? game.playerProfile);
        })
    );

    console.debug('[Monetization] plugin initialized');
}

/**
 * 卸载商业化插件（热拔出）
 */
export function shutdownMonetization() {
    for (const cleanup of _cleanups) {
        try { cleanup(); } catch { /* ignore */ }
    }
    _cleanups.length = 0;
    detach();
    _initialized = false;
    console.debug('[Monetization] plugin shutdown');
}
