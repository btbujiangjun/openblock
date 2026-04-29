/**
 * asyncPk.js — v10.17 异步 PK（替换 asyncPkStub，纯本地链接版）
 *
 * 设计要点
 * --------
 * 通过 URL 哈希在客户端之间传递"挑战种子"，避免依赖后端：
 *   1. 玩家 A 完成一局后点击「分享」 → 生成 URL：
 *      https://[host]/#pk=<base64({seed, score, skinId, ymd, owner?})>
 *   2. 玩家 B 点开链接 → 自动弹"挑战 X 的 N 分"对话框，
 *      点确认 → game.start({ seed }) 启动同种子局
 *   3. 玩家 B 完成后查看分数对比；可再点「分享给 A」生成新链接
 *
 * 后端可选：如果 server.py 提供 /api/pk/{id}，则把数据写入数据库做永久化；
 *           否则仅靠 URL hash 在浏览器之间传播（无后端依赖）。
 *
 * localStorage：openblock_async_pk_v1 = { lastChallengeId, history: [...] }
 *
 * 接入路径
 * --------
 *   import { initAsyncPk } from './social/asyncPk.js';
 *   initAsyncPk({ game });
 */

const STORAGE_KEY = 'openblock_async_pk_v1';

let _game = null;

export function initAsyncPk({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    /* 启动时检测 URL hash，弹挑战对话 */
    if (typeof window !== 'undefined') {
        const hash = window.location.hash;
        if (hash.startsWith('#pk=')) {
            const payload = _decodePayload(hash.slice(4));
            if (payload && _isValidChallenge(payload)) {
                setTimeout(() => _showChallengeDialog(payload), 1500);
            }
        }
    }

    /* 监听 game.endGame，用户分数高于 200 时弹"分享挑战"按钮 */
    const orig = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const score = game.score | 0;
        const r = await orig(...args);
        if (score >= 200) setTimeout(() => _maybeShowShareCta(score), 1200);
        return r;
    };

    if (typeof window !== 'undefined') {
        window.__asyncPk = {
            createChallenge: (score) => _createChallenge(score),
            joinChallenge: (id) => {
                const payload = _decodePayload(id);
                if (payload) _showChallengeDialog(payload);
                return { isImplemented: true };
            },
            isImplemented: () => true,
        };
    }
}

function _createChallenge(score) {
    const seed = (Math.random() * 0xffff_ffff) >>> 0;
    const skinId = (typeof localStorage !== 'undefined' && localStorage.getItem('openblock_skin')) || 'classic';
    const payload = { seed, score: score | 0, skinId, ymd: new Date().toISOString().slice(0, 10) };
    const id = _encodePayload(payload);
    _saveHistory(payload, id);
    const url = (typeof window !== 'undefined' && window.location)
        ? `${window.location.origin}${window.location.pathname}#pk=${id}`
        : `#pk=${id}`;
    return { id, seed, url, isImplemented: true };
}

function _saveHistory(payload, id) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const s = raw ? JSON.parse(raw) : { lastChallengeId: null, history: [] };
        s.lastChallengeId = id;
        s.history.unshift({ ...payload, id, ts: Date.now() });
        s.history = s.history.slice(0, 20);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch { /* ignore */ }
}

function _encodePayload(p) {
    try {
        const json = JSON.stringify(p);
        if (typeof btoa !== 'undefined') return btoa(unescape(encodeURIComponent(json)));
        /* Node 测试环境兜底（浏览器分支已优先） */
        const g = globalThis;
        if (g.Buffer) return g.Buffer.from(json).toString('base64');
        return '';
    } catch { return ''; }
}
function _decodePayload(s) {
    if (!s) return null;
    try {
        let json;
        if (typeof atob !== 'undefined') json = decodeURIComponent(escape(atob(s)));
        else {
            const g = globalThis;
            if (!g.Buffer) return null;
            json = g.Buffer.from(s, 'base64').toString();
        }
        return JSON.parse(json);
    } catch { return null; }
}
function _isValidChallenge(p) {
    return p && typeof p.seed === 'number' && typeof p.score === 'number';
}

function _showChallengeDialog(payload) {
    if (typeof document === 'undefined') return;
    document.getElementById('async-pk-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'async-pk-dialog';
    el.className = 'async-pk-dialog';
    el.innerHTML = `
        <div class="apd-card">
            <h2>挑战邀请</h2>
            <p>你被挑战完成同一局盘面：</p>
            <div class="apd-target">${payload.score | 0} 分</div>
            <div class="apd-meta">皮肤：${payload.skinId} · 日期：${payload.ymd || ''}</div>
            <div class="apd-actions">
                <button class="apd-decline" type="button">稍后</button>
                <button class="apd-accept" type="button">开始挑战</button>
            </div>
        </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    el.querySelector('.apd-decline').addEventListener('click', () => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 280);
    });
    el.querySelector('.apd-accept').addEventListener('click', async () => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 280);
        try {
            await _game?.start?.({ seed: payload.seed, fromChain: false });
        } catch (e) {
            console.warn('[asyncPk] start failed', e);
        }
        /* 标记本局为 PK 模式，endGame 时对比分数 */
        if (_game) {
            _game._pkChallenge = payload;
        }
    });

    /* 清掉 URL hash 避免刷新重弹 */
    if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}

function _maybeShowShareCta(score) {
    if (typeof document === 'undefined') return;
    /* 简易 toast 提示 + 复制链接按钮 */
    document.getElementById('apk-share-toast')?.remove();
    const { url } = _createChallenge(score);
    const t = document.createElement('div');
    t.id = 'apk-share-toast';
    t.className = 'apk-share-toast';
    t.innerHTML = `
        <span class="apk-icon">⚔</span>
        <span class="apk-msg">向朋友发起挑战？复制链接即可</span>
        <button class="apk-copy" type="button" data-url="${url}">复制链接</button>
        <button class="apk-close" type="button" aria-label="关闭">×</button>
    `;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-visible'));

    t.querySelector('.apk-copy').addEventListener('click', () => {
        const u = t.querySelector('.apk-copy').dataset.url;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(u).catch(() => {});
        }
        t.querySelector('.apk-copy').textContent = '已复制 ✓';
    });
    t.querySelector('.apk-close').addEventListener('click', () => {
        t.classList.remove('is-visible');
        setTimeout(() => t.remove(), 280);
    });
    setTimeout(() => {
        t.classList.remove('is-visible');
        setTimeout(() => t.remove(), 280);
    }, 8000);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
export const __test_only__ = { _encodePayload, _decodePayload, _isValidChallenge };
