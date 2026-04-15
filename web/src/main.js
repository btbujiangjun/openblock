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

document.addEventListener('DOMContentLoaded', async () => {
    const bootErr = document.getElementById('boot-error');
    applySkinToDocument(getActiveSkin());
    mountBlockWordmarks();
    const game = new Game();
    window.blockBlastGame = game;
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
