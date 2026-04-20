/**
 * 回放分享（OPT-08）
 *
 * 设计：
 *   - 监听 game_over 事件，在游戏结束界面插入「分享」按钮
 *   - 将 game canvas 截图为 data URL 并调用 Web Share API
 *   - Web Share 不可用时退回到复制链接到剪贴板
 *   - 与 replayUI.js 完全解耦（不修改其代码）
 */

import { getFlag } from './featureFlags.js';
import { on } from './MonetizationBus.js';

const SHARE_CONTAINER_ID = 'mon-share-btn-container';

/** 截取游戏画布为 Blob */
async function _captureCanvas() {
    if (typeof document === 'undefined') return null;
    const canvas = document.getElementById('game-grid');
    if (!canvas || typeof canvas.toBlob !== 'function') return null;
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** 生成分享文案 */
function _shareText(score) {
    return `我在 Open Block 方块拼图中得了 ${score.toLocaleString()} 分！来挑战我吧 🧩`;
}

/** 执行分享 */
async function _doShare(score, game) {
    const text = _shareText(score);
    const url = typeof window !== 'undefined' ? window.location.href : '';

    if (typeof navigator === 'undefined') return;

    // Web Share API（移动端原生弹出）
    if (navigator.share) {
        try {
            const blob = await _captureCanvas();
            const shareData = { title: 'Open Block 方块拼图', text, url };
            if (blob) {
                const file = new File([blob], 'openblock.png', { type: 'image/png' });
                if (navigator.canShare?.({ files: [file] })) {
                    shareData.files = [file];
                }
            }
            await navigator.share(shareData);
            return;
        } catch (e) {
            if (e.name !== 'AbortError') console.warn('[Share]', e);
        }
    }

    // 回退：复制到剪贴板
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(`${text}\n${url}`);
            _showCopyToast();
        } catch { /* ignore */ }
    }
}

function _showCopyToast() {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'mon-toast mon-share-toast';
    el.textContent = '📋 分享链接已复制到剪贴板';
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('mon-toast-visible'), 10);
    setTimeout(() => { el.classList.remove('mon-toast-visible'); setTimeout(() => el.remove(), 400); }, 3000);
}

/** 在游戏结束界面注入「分享」按钮 */
function _injectShareButton(score, game) {
    if (typeof document === 'undefined') return;

    // 避免重复注入
    document.getElementById(SHARE_CONTAINER_ID)?.remove();

    const gameOverEl = document.getElementById('game-over');
    if (!gameOverEl) return;

    const container = document.createElement('div');
    container.id = SHARE_CONTAINER_ID;
    container.className = 'mon-share-container';

    const btn = document.createElement('button');
    btn.className = 'mon-share-btn';
    btn.innerHTML = '📤 分享成绩';
    btn.onclick = () => _doShare(score, game);

    container.appendChild(btn);

    // 插入到 game-over 界面的合适位置
    const overScore = gameOverEl.querySelector('#over-score');
    if (overScore?.parentElement) {
        overScore.parentElement.insertAdjacentElement('afterend', container);
    } else {
        gameOverEl.appendChild(container);
    }
}

/** 初始化：监听 game_over 注入分享按钮 */
export function initReplayShare() {
    if (!getFlag('replayShare')) return;

    on('game_over', ({ data, game }) => {
        const score = data?.finalScore ?? game?.score ?? 0;
        // 延迟注入，等待 game-over 界面渲染完成
        setTimeout(() => _injectShareButton(score, game), 500);
    });
}
