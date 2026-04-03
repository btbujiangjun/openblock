/**
 * Block Blast - Entry Point
 * Initialize and start the game
 * 全局样式见 index.html 中的 ./styles/main.css（public 目录，不依赖本文件加载）
 */
import { Game } from './game.js';
import { initRLPanel } from './bot/rlPanel.js';

document.addEventListener('DOMContentLoaded', async () => {
    const bootErr = document.getElementById('boot-error');
    try {
        const game = new Game();
        await game.init();
        window.blockBlastGame = game;
        initRLPanel(game);
        if (bootErr) {
            bootErr.hidden = true;
        }
        console.log('Block Blast initialized successfully');
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
