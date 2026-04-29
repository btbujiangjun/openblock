/**
 * shareCard.js — v10.16 分享海报艺术化（Top P0 #5）
 *
 * Canvas 程序化合成「分数 + 皮肤名 + 主题色 + 盘面缩略 + 二维码占位」分享海报。
 * 在 #game-over 弹窗增加「生成海报」按钮，点击后下载 PNG。
 *
 * 设计要点
 * --------
 * - **零外部依赖**：纯 Canvas 2D 绘制
 * - **主题色取自当前皮肤**：海报背景 = cssBg，标题色 = blockColors[0]
 * - **盘面缩略**：直接 drawImage 当前 #game-grid（局末时盘面状态即终局）
 * - **品牌区**：底部固定「OpenBlock · 你能玩多远」+ 占位二维码
 * - **下载**：toDataURL → a.download 触发下载，部分浏览器降级用 navigator.share
 */

import { getActiveSkin } from '../skins.js';

const POSTER_W = 720;
const POSTER_H = 1280;

let _audio = null;

export function initShareCard({ game, audio = null } = {}) {
    _audio = audio;
    void game;
    _installButton();
    if (typeof window !== 'undefined') {
        window.__shareCard = { generatePoster, downloadPoster, sharePoster };
    }
}

function _installButton() {
    const tryInstall = () => {
        const over = document.getElementById('game-over');
        if (!over) return false;
        if (over.querySelector('.share-card-btn')) return true;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'share-card-btn';
        btn.textContent = '生成分享海报';
        btn.addEventListener('click', async () => {
            try {
                const dataUrl = await generatePoster();
                if (navigator.share) {
                    await sharePoster(dataUrl);
                } else {
                    downloadPoster(dataUrl);
                }
                _audio?.play?.('unlock');
            } catch (e) {
                console.warn('[shareCard]', e);
            }
        });

        const actions = over.querySelector('.over-actions') || over;
        actions.appendChild(btn);
        return true;
    };
    if (!tryInstall()) {
        // game-over 模态可能在 game.init 后才挂载，延迟尝试
        setTimeout(tryInstall, 1200);
        setTimeout(tryInstall, 2400);
    }
}

/* ============================================================
 *  Canvas 海报合成
 * ========================================================== */

export async function generatePoster() {
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const ctx = canvas.getContext('2d');

    const skin = getActiveSkin();
    const bg = skin.cssBg || skin.gridOuter || '#0F1014';
    const accent = skin.blockColors?.[0] || '#FFD160';
    const accent2 = skin.blockColors?.[3] || '#FF8060';

    /* ─── 1. 背景：渐变（主题色 → 主题色 0.7 alpha） ─── */
    const bgGrad = ctx.createLinearGradient(0, 0, 0, POSTER_H);
    bgGrad.addColorStop(0, bg);
    bgGrad.addColorStop(1, _shiftLuma(bg, -0.18));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    /* ─── 2. 顶部色带（主色斜切） ─── */
    ctx.save();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(POSTER_W, 0);
    ctx.lineTo(POSTER_W, 80);
    ctx.lineTo(0, 130);
    ctx.closePath();
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.restore();

    /* ─── 3. 品牌字 OpenBlock ─── */
    ctx.fillStyle = _readableTextOn(accent);
    ctx.font = 'bold 44px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('OpenBlock', 50, 60);
    ctx.font = '20px sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText('· 空间与节奏', 280, 65);
    ctx.globalAlpha = 1;

    /* ─── 4. 大字号分数 ─── */
    const score = (window.openBlockGame?.score | 0) || 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 220px "Bebas Neue", "Oswald", "Impact", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(score), 50, 200);

    ctx.font = '24px sans-serif';
    ctx.globalAlpha = 0.78;
    ctx.fillText('本局得分', 50, 470);
    ctx.globalAlpha = 1;

    /* ─── 5. 皮肤标签 ─── */
    const skinName = skin.name || skin.id || 'classic';
    ctx.fillStyle = accent2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(50, 530, 280, 56, 28) : ctx.rect(50, 530, 280, 56);
    ctx.fill();
    ctx.fillStyle = _readableTextOn(accent2);
    ctx.font = 'bold 24px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🎨 ${skinName}`, 80, 558);

    /* ─── 6. 盘面缩略：drawImage 当前棋盘 ─── */
    const gameCanvas = document.getElementById('game-grid');
    if (gameCanvas) {
        const imgSize = 580;
        const ix = (POSTER_W - imgSize) / 2;
        const iy = 640;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        try {
            ctx.drawImage(gameCanvas, ix, iy, imgSize, imgSize);
        } catch { /* ignore SecurityError 等 */ }
        ctx.restore();
    }

    /* ─── 7. 底部品牌区 ─── */
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, POSTER_H - 130, POSTER_W, 130);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '22px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('你能玩多远？github.com/btbujiangjun/openblock', 50, POSTER_H - 65);

    /* ─── 8. 占位二维码（伪几何图形 — 真二维码需要外部库）─── */
    _drawPseudoQR(ctx, POSTER_W - 130, POSTER_H - 110, 90, accent);

    return canvas.toDataURL('image/png', 0.95);
}

export function downloadPoster(dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `openblock-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

export async function sharePoster(dataUrl) {
    if (!navigator.share) return downloadPoster(dataUrl);
    try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'openblock-share.png', { type: 'image/png' });
        await navigator.share({
            title: 'OpenBlock 战绩',
            text: '一起来玩方块消除！',
            files: [file],
        });
    } catch {
        downloadPoster(dataUrl);
    }
}

/* ============================================================
 *  工具函数
 * ========================================================== */

function _shiftLuma(hex, delta) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    let r = (v >> 16) & 0xff;
    let g = (v >> 8) & 0xff;
    let b = v & 0xff;
    const adj = (c) => Math.max(0, Math.min(255, Math.round(c + delta * 255)));
    r = adj(r); g = adj(g); b = adj(b);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function _readableTextOn(bg) {
    const m = /^#?([0-9a-f]{6})$/i.exec(bg || '#000000');
    if (!m) return '#FFFFFF';
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.55 ? '#1B1F2A' : '#FFFFFF';
}

function _drawPseudoQR(ctx, x, y, size, accent) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
    ctx.fillStyle = '#000';
    const cells = 8;
    const cs = size / cells;
    // 三个定位框
    const drawAnchor = (cx, cy) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(x + cx * cs, y + cy * cs, 3 * cs, 3 * cs);
        ctx.fillStyle = '#FFF';
        ctx.fillRect(x + cx * cs + cs * 0.5, y + cy * cs + cs * 0.5, 2 * cs, 2 * cs);
        ctx.fillStyle = accent;
        ctx.fillRect(x + cx * cs + cs, y + cy * cs + cs, cs, cs);
    };
    drawAnchor(0, 0); drawAnchor(5, 0); drawAnchor(0, 5);
    // 散点（模拟二维码数据区）
    ctx.fillStyle = '#000';
    let seed = 42;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
            if ((i < 3 && j < 3) || (i > 4 && j < 3) || (i < 3 && j > 4)) continue;
            if (rng() > 0.55) ctx.fillRect(x + i * cs, y + j * cs, cs - 1, cs - 1);
        }
    }
}
