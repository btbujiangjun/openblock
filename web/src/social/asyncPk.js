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

import { t as i18nT } from '../i18n/i18n.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('asyncPk');


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

    /* 监听 game.endGame，用户分数高于 200 时在结算面板"次级链接行"追加一个"挑战"按钮。
     *
     * v1.60.2：从"局后 1.2s 弹独立 fixed toast"改为"结算面板内嵌行"——消除浮层叠加。
     * v1.60.3：把内嵌行进一步折叠为单个 link 按钮，与「菜单·回放·海报·分享」并列
     *   （用户截图反馈：内嵌行视觉太重，应与其他次级 CTA 同层），点击 = 复制挑战
     *   链接到剪贴板，按钮文案变"已复制"。 */
    const orig = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const score = game.score | 0;
        const r = await orig(...args);
        if (score >= 200) {
            /* 用 rAF 等结算面板 DOM 就位（endGame 内会同步 active+digest），再注入 */
            requestAnimationFrame(() => _mountChallengeLinkInLinksRow(score));
        }
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
            log.warn('[asyncPk] start failed', e);
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

/**
 * v1.60.3：把"挑战分享 CTA"折叠为单个 link 按钮"挑战"，追加到结算面板的次级链接
 * 行 `.game-over-links`，与"菜单·回放·海报·分享"并列，统一所有次级 CTA 的视觉
 * 层级（用户截图反馈：v1.60.2 的内嵌行视觉太重）。
 *
 * 行为：
 *   - 文案选用"挑战"（短 + 表达 PK 玩法），aria-label="复制挑战链接"
 *   - 点击 → navigator.clipboard.writeText(url)，按钮 textContent 变"已复制"，置 disabled
 *   - 跨局清理由 game.js start() 一并 remove `#apk-challenge-btn` / `#apk-challenge-sep`
 *   - 同一局多次注入：先 remove 旧的 sep+btn 再追加（防御同 id 冲突）
 */
function _mountChallengeLinkInLinksRow(score) {
    if (typeof document === 'undefined') return;
    const linksRow = document.querySelector('#game-over .game-over-links');
    if (!linksRow) return;
    /* 防御：同一局已注入过则不重复 */
    linksRow.querySelector('#apk-challenge-btn')?.remove();
    linksRow.querySelector('#apk-challenge-sep')?.remove();

    const { url } = _createChallenge(score);

    /* 中点分隔符 — 与 index.html 中已有的 .game-over-link-sep 视觉一致 */
    const sep = document.createElement('span');
    sep.id = 'apk-challenge-sep';
    sep.className = 'game-over-link-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '·';

    /* "挑战"按钮 — 复用 .game-over-link 样式，与其他次级 link 完全同层 */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'apk-challenge-btn';
    btn.className = 'game-over-link';
    btn.dataset.url = url;
    btn.textContent = '挑战';
    btn.setAttribute('aria-label', '复制挑战链接');

    btn.addEventListener('click', () => {
        const u = btn.dataset.url;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(u).catch(() => { /* 忽略权限失败 */ });
        }
        btn.textContent = i18nT('toast.copied');
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
    });

    linksRow.appendChild(sep);
    linksRow.appendChild(btn);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
export const __test_only__ = { _encodePayload, _decodePayload, _isValidChallenge };
