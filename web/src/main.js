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
} from './i18n/i18n.js';
import { Game } from './game.js';
import { initRLPanel } from './bot/rlPanel.js';
import { initPlayerInsightPanel } from './playerInsightPanel.js';
import { initReplayUI } from './replayUI.js';
import { initSpawnModelPanel } from './spawnModelPanel.js';
import { applySkinToDocument, getActiveSkin } from './skins.js';
import { mountBlockWordmarks } from './blockWordmark.js';
import { initMonetization } from './monetization/index.js';
import { ReviveManager } from './revive.js';
import { createEffectLayer } from './effects/effectLayer.js';
import { BlockPool } from './bot/blockPool.js';
import { generateDockShapes } from './bot/blockSpawn.js';
import { initLevelEditorPanel, openLevelEditorPanel } from './levelEditorPanel.js';
import { initSeasonPass, toggleSeasonPass } from './seasonPass.js';
import { initPushNotification } from './pushNotification.js';
import { initChannelAttribution } from './channelAttribution.js';
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
/* v10.17：asyncPkStub / replayAlbumStub 已被 ./social/asyncPk.js / ./social/replayAlbum.js 替换 */
import { initFirstUnlockCelebration } from './effects/firstUnlockCelebration.js';
import { initExtremeAchievements } from './achievements/extremeAchievements.js';
import { initSkinSoundPalettes } from './effects/skinSoundPalettes.js';
import { initSeasonalBorder } from './effects/seasonalBorder.js';
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
import { initSeasonPassEntry } from './daily/seasonPassEntry.js';
import { initLightningMode } from './playmodes/lightning.js';
import { initZenMode } from './playmodes/zen.js';
import { initFreeze } from './skills/freeze.js';
import { initPreview } from './skills/preview.js';
import { initReroll } from './skills/reroll.js';
import { initRankSystem } from './progression/rankSystem.js';
import { initReplayAlbum } from './social/replayAlbum.js';
import { initAsyncPk } from './social/asyncPk.js';
import { initPersonalDashboard } from './progression/personalDashboard.js';
import { initSkinFragments } from './progression/skinFragments.js';
import { initMonthlyMilestone } from './checkin/monthlyMilestone.js';

document.addEventListener('DOMContentLoaded', async () => {
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

    // 复活系统（低侵入性插件：装饰 game.showNoMovesWarning）
    const reviveManager = new ReviveManager({ limit: 1, clearCells: 12 });
    reviveManager.init(game);
    window.__reviveManager = reviveManager;
    // 新局开始时重置复活次数
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
    initDailyMaster({ game, audio: audioFx });
    initSkinLore({ audio: audioFx });
    /* v10.17：原 stub 替换为完整实装 */
    initReplayAlbum({ game });
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
    initPersonalDashboard();
    initMonthlyMilestone();
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
    /* 先于 game.init() 绑定回放/RL：init 因 API 失败抛错时，回放列表仍可点开（只读会话与 move_sequences） */
    initReplayUI(game);
    initPlayerInsightPanel(game);
    initRLPanel(game);
    initSpawnModelPanel(game);
    initLevelEditorPanel(game);

    // 关卡编辑器触发按钮（index.html 中已预留 #level-editor-btn）
    const leBtn = document.getElementById('level-editor-btn');
    if (leBtn) leBtn.addEventListener('click', openLevelEditorPanel);

    // 运营看板（初始化 Screen + 菜单按钮绑定）
    initOpsDashboard(game);
    document.getElementById('ops-menu-btn')?.addEventListener('click', openOpsDashboard);

    // 渠道归因（页面加载时解析 UTM 参数）
    initChannelAttribution();

    try {
        await game.init();
        if (bootErr) {
            bootErr.hidden = true;
        }

        // 局间小目标（主要服务 A 类用户）
        const miniGoals = initMiniGoals(game);
        window.__miniGoals = miniGoals;

        // 赛季通行证
        const seasonPass = initSeasonPass(game);
        window.__seasonPass = seasonPass;
        // 菜单中加入赛季入口（若有 #season-pass-btn）
        document.getElementById('season-pass-btn')?.addEventListener('click', () => toggleSeasonPass());
        /* v10.17：自动注入战令入口 + 红点提示（如 index.html 没有 button 也能展示） */
        initSeasonPassEntry({ seasonPass, toggleSeasonPass });

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

        /* v10.16: 7 日签到日历 + 连登勋章 + 周末转盘 — 等 game.init 完成后弹出 */
        initLoginStreak({ audio: audioFx });
        initCheckIn({ audio: audioFx });
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
