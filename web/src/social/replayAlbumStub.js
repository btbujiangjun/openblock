/**
 * replayAlbumStub.js — v10.16 历史最佳棋谱回放 + 里程碑相册（P2 骨架）
 *
 * 当前实施
 * --------
 * - 已有 monetization/replayShare.js 提供基础回放分享能力
 * - 本模块占位"本地保存 Top N 棋谱 + 100/500/1000 局节点纪念相册"
 *
 * 待实施 TODO
 * -----------
 * 1. 本地保存：每次 endGame 时调 game._moveSequence → 序列化到 IndexedDB
 *    最多保留 Top 10 局（按分数）
 * 2. 相册 UI：图鉴式 grid，每个 slot 显示分数 + 皮肤 + 关键回合截图（盘面 snapshot）
 * 3. 回放：选中后用 game.replayPlaybackLocked 流程逐步重现
 * 4. 里程碑：第 100 / 500 / 1000 局自动锁定为「纪念页」（不可删除）
 *
 * 接入路径
 * --------
 *   import { initReplayAlbum } from './social/replayAlbumStub.js';
 *   initReplayAlbum({ game });
 */

const STORAGE_KEY = 'openblock_replay_album_v1';
const MAX_TOP_N = 10;

function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}
function _save(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
    catch { /* ignore */ }
}

let _origEndGame = null;

export function initReplayAlbumStub({ game } = {}) {
    if (!game || _origEndGame) return;

    _origEndGame = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const ret = await _origEndGame(...args);
        try { _maybeRecord(game); } catch (e) { console.warn('[replayAlbum]', e); }
        return ret;
    };

    if (typeof window !== 'undefined') {
        window.__replayAlbum = {
            getTopN: () => _load(),
            isImplemented: () => false,    // 真正回放未实施
        };
    }
}

function _maybeRecord(game) {
    const score = game.score | 0;
    if (score < 200) return;    // 低分不记
    const arr = _load();
    arr.push({
        score,
        ymd: new Date().toISOString().slice(0, 10),
        skinId: window.localStorage?.getItem('openblock_skin') || 'classic',
        ts: Date.now(),
        /* 真实回放需要 moveSequence — 此处留 TODO */
        gameStats: game.gameStats ? { ...game.gameStats } : null,
    });
    arr.sort((a, b) => b.score - a.score);
    _save(arr.slice(0, MAX_TOP_N));
}
