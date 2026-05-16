/**
 * Open Block - Entry Point
 * Initialize and start the game
 * 全局样式见 index.html 中的 ./styles/main.css（public 目录，不依赖本文件加载）
 */
import {
    initI18n,
    applyDom,
    applyMeta,
    setLocale,
    getLocale,
    subscribeLocale,
    AVAILABLE_LOCALES,
    t,
} from './i18n/i18n.js';
import { Game } from './game.js';
import { initPlayerInsightPanel } from './playerInsightPanel.js';
import { initReplayUI } from './replayUI.js';
import { applySkinToDocument, getActiveSkin } from './skins.js';
import { mountBlockWordmarks } from './blockWordmark.js';
import { initMonetization } from './monetization/index.js';
import { ReviveManager } from './revive.js';
import { createEffectLayer } from './effects/effectLayer.js';
import { BlockPool } from './bot/blockPool.js';
import { generateDockShapes } from './bot/blockSpawn.js';
import { initPushNotification } from './pushNotification.js';
import { initChannelAttribution } from './channelAttribution.js';
import { fetchRemoteConfig } from './remoteConfig.js';
import { initMiniGoals } from './miniGoals.js';
import { initOpsDashboard, openOpsDashboard } from './opsDashboard.js';
// v10.15 P0 彩蛋 / 惊喜系统
import { createAudioFx } from './effects/audioFx.js';
import { installSkinTransition } from './effects/skinTransition.js';
import { createAmbientParticles } from './effects/ambientParticles.js';
import {
    applyAprilFoolsIfActive,
    applySeasonalRecommendation,
    applyWeekendActivityIfEligible,
    applyBirthdayIfEligible,
    markSkinUserChosen,
} from './seasonalSkin.js';
import { initEasterEggs } from './easterEggs.js';
// v10.16 剩余 24 项接入
import { initHintEconomy } from './skills/hintEconomy.js';
import { initUndo } from './skills/undo.js';
import { initBomb } from './skills/bomb.js';
import { initRainbow } from './skills/rainbow.js';
import { initCheckIn } from './checkin/checkInPanel.js';
import { initLoginStreak } from './checkin/loginStreak.js';
import { initEndGameChest } from './rewards/endGameChest.js';
import { initLuckyWheel } from './rewards/luckyWheel.js';
import { initSeasonChest } from './rewards/seasonChest.js';
import { initShareCard } from './social/shareCard.js';
import { initDailyMaster } from './social/dailyMaster.js';
import { initDbDebugPage } from './debug/dbDebugPage.js';
/* v10.17：asyncPkStub / replayAlbumStub 已被 ./social/asyncPk.js / ./social/replayAlbum.js 替换 */
import { initFirstUnlockCelebration } from './effects/firstUnlockCelebration.js';
import { initExtremeAchievements } from './achievements/extremeAchievements.js';
import { initSkinSoundPalettes } from './effects/skinSoundPalettes.js';
import { initSeasonalBorder } from './effects/seasonalBorder.js';
import { initFeedbackToggles } from './feedbackToggles.js';
import { initSkinLore } from './lore/skinLore.js';
import { initBgm } from './effects/bgmStub.js';
import { initRotationStub } from './playmodes/rotationStub.js';
import { initWeatherStub } from './seasonalSkin.weather.js';
import { initCompanionStub } from './companion/companionStub.js';
/* v10.17 留存 / 活跃提升 sprint */
import { initFtue } from './onboarding/ftue.js';
import { initFirstDayPack } from './onboarding/firstDayPack.js';
import { initWowMoments } from './onboarding/wowMoments.js';
import { initWelcomeBack } from './onboarding/welcomeBack.js';
import { initFirstWinBoost } from './daily/firstWinBoost.js';
import { initDailyDish } from './daily/dailyDish.js';
import { initProgressDigest } from './daily/progressDigest.js';
import { initLightningMode } from './playmodes/lightning.js';
import { initZenMode } from './playmodes/zen.js';
import { initFreeze } from './skills/freeze.js';
import { initPreview } from './skills/preview.js';
import { initReroll } from './skills/reroll.js';
import { initRankSystem } from './progression/rankSystem.js';
import { initAsyncPk } from './social/asyncPk.js';
import { initSkinFragments } from './progression/skinFragments.js';
import { initMonthlyMilestone } from './checkin/monthlyMilestone.js';
import { hydrateCheckinFromServer } from './checkin/checkinSync.js';
import { initLocalStorageStateSync } from './localStorageStateSync.js';
import { initVisitTracker } from './visitTracker.js';
import { initCursorHelpTooltip } from './helpTooltip.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 统一 cursor:help 提示等待时长：1.5 秒。
    initCursorHelpTooltip({ delayMs: 1500 });

    initI18n();
    applyDom(document.documentElement);
    applyMeta();
    const localeSel = document.getElementById('locale-select');
    if (localeSel) {
        localeSel.innerHTML = AVAILABLE_LOCALES.map(
            ({ code, nativeName }) => `<option value="${code}">${nativeName}</option>`,
        ).join('');
        localeSel.value = getLocale();
        localeSel.addEventListener('change', () => {
            setLocale(localeSel.value);
            applyDom(document.documentElement);
            applyMeta();
            window.openBlockGame?.updateUI?.();
        });
    }
    subscribeLocale(() => {
        applyDom(document.documentElement);
        applyMeta();
        if (localeSel) localeSel.value = getLocale();
        window.openBlockGame?.refreshSkinSelectOptions?.();
        window.openBlockGame?.updateUI?.();
    });

    const bootErr = document.getElementById('boot-error');
    /* v10.15: 4.1 节日 emoji 覆盖必须在 applySkinToDocument 之前执行
       （applyAprilFoolsIfActive 修改 SKINS[*].blockIcons，让 renderer 后续读到的是 emoji） */
    applyAprilFoolsIfActive();
    applySkinToDocument(getActiveSkin());
    mountBlockWordmarks();
    /* v10.15: 程序化音效系统（首次用户交互后自动 unlock AudioContext）
       audioFx 暴露到 window.__audioFx，便于其他模块和控制台调用。 */
    const audioFx = createAudioFx();
    /* v10.15: 皮肤切换转场（0.6s 主题色一闪 + 淡入淡出）
       通过装饰 setActiveSkinId 实现，对其他模块透明。 */
    installSkinTransition({ audio: audioFx });
    /* v10.15: 暴露 markSkinUserChosen 到 window，供 game.js 在用户主动切皮肤时调用 */
    window.__seasonalSkin = { markSkinUserChosen };
    /* v10.16: 皮肤专属音色（hook audioFx 的内部音色函数，按当前皮肤切换 palette） */
    initSkinSoundPalettes({ audioFx });
    /* v10.16: 首次解锁庆祝（onSkinAfterApply 订阅，与 transition 动画并存） */
    initFirstUnlockCelebration({ audio: audioFx, currentSkinId: getActiveSkin().id });
    const game = new Game();
    window.openBlockGame = game;
    initMonetization(game);

    // v10.18.5：复活系统默认关闭——它会在 game-over 之前先弹一个浮层，与新版结算卡形成「两次浮层」。
    // 仍保留 ReviveManager 实例（API 不变、单测不变），仅 enabled:false 不装饰 showNoMovesWarning。
    // 后续如要恢复："new ReviveManager({ limit: 1, clearCells: 12 })"。
    const reviveManager = new ReviveManager({ limit: 1, clearCells: 12, enabled: false });
    reviveManager.init(game);
    window.__reviveManager = reviveManager;
    // 新局开始时重置复活次数（即便禁用也保持 wallet 路径一致）
    const _origStart = game.start.bind(game);
    game.start = async (...args) => {
        reviveManager.resetForNewGame();
        blockPool.resetForNewGame();
        return _origStart(...args);
    };

    // 效果层（解耦渲染调用）：init 后 renderer 已存在，可安全绑定
    const effectLayer = createEffectLayer(game);
    window.__effectLayer = effectLayer;

    /* v10.15: 程序化音效装饰 renderer 的 trigger* 方法
       零侵入接入：不改 game.js / EffectLayer，仅装饰 renderer 调用点。 */
    audioFx.attachToRenderer(game.renderer);

    /* v10.15: 皮肤环境粒子层（樱花/落叶/气泡/萤火虫/流星）
       根据当前皮肤激活预设；未匹配的皮肤零开销空跑。
       v10.16: 流体背景（aurora 极光带 / koi 涟漪）通过同模块的预设扩展 */
    const ambient = createAmbientParticles({ renderer: game.renderer });
    ambient.applySkin(getActiveSkin().id);
    game.renderer.setAmbientLayer(ambient);
    window.__feedbackToggles = initFeedbackToggles({ game, audioFx, ambient });

    /* v10.16: 各类道具与系统接入 game */
    initHintEconomy({ game, audio: audioFx });
    initUndo({ game, audio: audioFx });
    initBomb({ game, audio: audioFx });
    initRainbow({ game, audio: audioFx });
    initEndGameChest({ game, audio: audioFx });
    initSeasonChest({ audio: audioFx });
    initSeasonalBorder({ game });
    initExtremeAchievements({ game, audio: audioFx });
    initShareCard({ game, audio: audioFx });
    // v10.18.3：结算卡内单一分享入口（合并旧「生成海报」与「分享成绩」按钮）
    _wireShareBtn(game, audioFx);
    initDailyMaster({ game, audio: audioFx });
    initDbDebugPage(game);
    initSkinLore({ audio: audioFx });
    /* v10.17：原 stub 替换为完整实装 */
    initAsyncPk({ game });
    /* v10.17：道具池扩展 +3 件（与 hint/undo/bomb/rainbow 同钱包同 UI） */
    initFreeze({ game, audio: audioFx });
    initPreview({ game, audio: audioFx });
    initReroll({ game, audio: audioFx });
    /* v10.17：W1-W4 留存模块 */
    initFtue({ game });
    initFirstDayPack();
    initWowMoments({ game, audio: audioFx });
    initWelcomeBack();
    initFirstWinBoost({ game });
    initDailyDish({ game });
    initProgressDigest({ game });
    initLightningMode({ game });
    initZenMode({ game });
    initRankSystem({ game });
    initSkinFragments({ game });
    /* monthlyMilestone 在 game.init + hydrateCheckinFromServer 之后启动，避免先于服务端 totalDays 计时 */
    /* P2 大工程占位：BGM 与角色伙伴依赖外部资产 (~5MB OGG / 180 张立绘) 暂保持 stub */
    initBgm();
    initRotationStub();
    initWeatherStub();
    initCompanionStub();
    /* 旧 asyncPkStub / replayAlbumStub 已被新版替换，不再调用 */

    // 块池管理（新鲜度保障）：包装 generateDockShapes
    const blockPool = new BlockPool({ recentWindow: 9, penaltyFactor: 0.4 });
    // 暴露包装后函数供 game.js 通过 window.__spawnFn 读取（可选）
    window.__blockPool = blockPool;
    window.__spawnFn = blockPool.wrap(generateDockShapes);
    /* 先于 game.init() 绑定回放与洞察：init 因 API 失败抛错时，回放列表仍可点开（只读会话与 move_sequences）。
       RL / Spawn 实验室 / 关卡编辑器 / 回放专辑 / 仪表盘 / 赛季通行证 在 init 成功后懒加载（initDeferredPanels.js）。 */
    initReplayUI(game);
    initPlayerInsightPanel(game);

    // 运营看板（初始化 Screen + 菜单按钮绑定）
    initOpsDashboard(game);
    document.getElementById('ops-menu-btn')?.addEventListener('click', openOpsDashboard);
    document.getElementById('menu-personal-data-btn')?.addEventListener('click', async () => {
        try {
            const mod = await import('./progression/personalDashboard.js');
            mod.initPersonalDashboard();
            window.__personalDashboard?.open?.();
        } catch (e) {
            console.error(e);
        }
    });
    // 渠道归因（页面加载时解析 UTM 参数）
    initChannelAttribution();
    void fetchRemoteConfig();

    try {
        await game.init();
        if (bootErr) {
            bootErr.hidden = true;
        }

        const { initDeferredPanels } = await import('./initDeferredPanels.js');
        await initDeferredPanels({ game });

        // 局间小目标（主要服务 A 类用户）
        const miniGoals = initMiniGoals(game);
        window.__miniGoals = miniGoals;

        // Push 通知（初始化后检查召回，游戏结束时记录活跃）
        const pushMgr = initPushNotification(game);
        const _origEndGame = game.endGame.bind(game);
        game.endGame = async (opts = {}) => {
            const r = await _origEndGame(opts);
            pushMgr.onGameEnd();
            return r;
        };

        /* v10.15: 节日 / 时段自动换皮推荐（4.1 已在最前置阶段处理；这里处理春节 / 中秋 / 万圣等）
           游戏 init 完成后调用，可访问 game.renderer / game.score 等运行时状态。 */
        applySeasonalRecommendation({ game, audio: audioFx });
        /* v10.16: 周末活动皮肤（每周一次发 48h 试穿券） + 生日皮肤（24h 试穿） */
        applyWeekendActivityIfEligible();
        applyBirthdayIfEligible();

        /* v10.15: Konami Code 隐藏皮肤 + 数字彩蛋 + 控制台 cheat 命令
           initEasterEggs 内部对 window.openBlockGame 做了延迟绑定，安全。 */
        initEasterEggs({ game, audio: audioFx });

        /* 签到 / 连登 / 月度进度：从 SQLite 恢复后再挂载弹窗与计时器 */
        await hydrateCheckinFromServer();
        /* v1.52：按业务分区同步 localStorage ↔ SQLite（防回滚合并 + 分频增量写入） */
        await initLocalStorageStateSync();
        /* v1.53：访问会话日志（start/ping/end）落库，用于运营看板访客分析。 */
        await initVisitTracker();
        initLoginStreak({ audio: audioFx });
        initCheckIn({ audio: audioFx });
        initMonthlyMilestone();
        initLuckyWheel({ audio: audioFx });

        // 初始化完成后直接进入游戏，跳过菜单界面
        await game.start({ fromChain: false });
        console.log('Open Block initialized successfully');
    } catch (error) {
        console.error('Failed to initialize game:', error);
        if (bootErr) {
            bootErr.hidden = false;
            bootErr.textContent =
                '初始化失败：' +
                (error instanceof Error ? error.message : String(error)) +
                '。请使用 npm run dev，勿用 file:// 打开。';
        }
    }
});

/**
 * v10.18.4：结算卡的「海报 / 分享」次操作均接 shareCard 工具函数。
 *  - #poster-btn：永远生成海报并触发下载（离线产物）
 *  - #share-btn：优先调起系统分享面板携带海报；不支持时降级为下载
 * 缺失任一按钮时静默跳过，便于旧版 HTML 兼容。
 */
function _wireShareBtn(game, audio) {
    void game;
    const sc = () => (typeof window !== 'undefined' ? window.__shareCard : null);

    const posterBtn = document.getElementById('poster-btn');
    if (posterBtn) {
        posterBtn.addEventListener('click', async () => {
            posterBtn.disabled = true;
            try {
                const api = sc();
                if (!api) return;
                const dataUrl = await api.generatePoster();
                api.downloadPoster(dataUrl);
                audio?.play?.('unlock');
            } catch (e) {
                console.warn('[poster]', e);
            } finally {
                posterBtn.disabled = false;
            }
        });
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            shareBtn.disabled = true;
            try {
                const api = sc();
                if (!api) return;
                const dataUrl = await api.generatePoster();
                if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                    await api.sharePoster(dataUrl);
                } else {
                    api.downloadPoster(dataUrl);
                }
                audio?.play?.('unlock');
            } catch (e) {
                console.warn('[share]', e);
            } finally {
                shareBtn.disabled = false;
            }
        });
    }

    /* #replay-btn：一键打开"刚结束这一局"的回放，无需用户去回放列表里找。
     * 数据源直接读 game.moveSequence（结算后仍在内存里，下一局 startGame 才清空），
     * 复用 replayUI 的回放屏 + slider/play/pause + 序列面板。
     * 退出回放后通过 exitTarget='game-over' 让 viewBack 回到结算面板而不是回放列表，
     * 用户可以接着点「再来一局」/「分享」/「海报」继续操作。 */
    const replayBtn = document.getElementById('replay-btn');
    if (replayBtn) {
        replayBtn.addEventListener('click', () => {
            const frames = game?.moveSequence;
            const ui = typeof window !== 'undefined' ? window.__replayUI : null;
            if (!Array.isArray(frames) || frames.length < 2 || !ui?.openFromFrames) {
                _showReplayToast(t('game.replay.noFrames'));
                return;
            }
            const ok = ui.openFromFrames(frames, {
                score: game?.score,
                exitTarget: 'game-over',
            });
            if (!ok) {
                _showReplayToast(t('game.replay.noFrames'));
                return;
            }
            audio?.play?.('unlock');
        });
    }
}

/** 轻量 toast：复用 .mon-toast 类，避免引入新样式依赖。 */
function _showReplayToast(text) {
    if (typeof document === 'undefined' || !text) return;
    const el = document.createElement('div');
    el.className = 'mon-toast mon-share-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('mon-toast-visible'), 10);
    setTimeout(() => {
        el.classList.remove('mon-toast-visible');
        setTimeout(() => el.remove(), 400);
    }, 2400);
}
