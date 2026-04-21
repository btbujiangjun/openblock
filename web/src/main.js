/**
 * Open Block - Entry Point
 * Initialize and start the game
 * 全局样式见 index.html 中的 ./styles/main.css（public 目录，不依赖本文件加载）
 */
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

document.addEventListener('DOMContentLoaded', async () => {
    const bootErr = document.getElementById('boot-error');
    applySkinToDocument(getActiveSkin());
    mountBlockWordmarks();
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
    try {
        await game.init();
        if (bootErr) {
            bootErr.hidden = true;
        }
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
