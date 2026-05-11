/**
 * easterEggs.js — v10.15 隐藏彩蛋系统（Top 5 高 ROI #5）
 *
 * 当前实装的彩蛋
 * --------------
 * 1. **Konami Code** ↑↑↓↓←→←→BA
 *    - 触发后解锁第 37 款隐藏皮肤 `og_geometry`（黑底白方，纯几何，致敬经典）
 *    - 立即切换到该皮肤 + 弹「已解锁开发者隐藏皮肤」toast + 播放 unlock 音效
 *    - localStorage `openblock_konami_unlocked` 持久化，皮肤选择面板可识别后展示
 *
 * 2. **数字彩蛋** — 分数到达 1234 / 8888 / 12345 时触发短特效
 *    - 闪光 + bonus 音效 + 飘字「神奇数字」
 *    - 单局每个数字仅触发一次（防重复）
 *
 * 3. **作者梗** — 控制台口令 `window.openBlockGame.cheat.help()`
 *    - 输出隐藏命令清单（god 模式 / 跳关 / 数据导出 等开发者口令）
 *
 * 设计要点
 * --------
 * - **零侵入**：通过装饰 / polling 接入，不改 game.js / renderer.js
 * - **降级安全**：缺少全局对象时静默不工作（测试环境兼容）
 * - **隐私友好**：所有触发记录仅存 localStorage，不上报
 *
 * 接入路径（main.js）
 * -------------------
 *   import { initEasterEggs } from './easterEggs.js';
 *   initEasterEggs({ game, audio: window.__audioFx });
 */

import { setActiveSkinId, SKINS } from './skins.js';
import { skipWhenDocumentHidden } from './lib/pageVisibility.js';

const KONAMI_KEY = 'openblock_konami_unlocked';
const HIDDEN_SKIN_ID = 'og_geometry';

/** 第 37 款隐藏皮肤定义（黑底白方，致敬 Tetris 1984） */
const HIDDEN_SKIN_DEF = {
    id: HIDDEN_SKIN_ID,
    name: 'OG 几何',
    description: 'Konami Code 解锁的第 37 款隐藏皮肤——致敬 1984',
    blockColors: ['#FFFFFF', '#E0E0E0', '#C8C8C8', '#A8A8A8', '#888888', '#686868', '#484848', '#282828'],
    cssBg: '#000000',
    gridOuter: '#0A0A0A',
    gridCell: '#1A1A1A',
    clearFlash: '#FFFFFF',
    blockStyle: 'flat',
    blockInset: 2,
    gridGap: 1,
    blockRadius: 0,
    cellStyle: 'flat',
    uiDark: true,
    cssVars: {
        '--bg-color':         '#000000',
        '--grid-bg':          '#0A0A0A',
        '--cell-empty':       '#1A1A1A',
        '--text-primary':     '#FFFFFF',
        '--text-secondary':   '#B8B8B8',
        '--accent-color':     '#FFFFFF',
        '--accent-dark':      '#FFFFFF',
        '--shadow':           'rgba(255,255,255,0.18)',
    },
};

const KONAMI_SEQUENCE = [
    'ArrowUp', 'ArrowUp',
    'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight',
    'ArrowLeft', 'ArrowRight',
    'b', 'a',
];

/* 数字彩蛋触发集 */
const SCORE_LANDMARKS = [
    { value: 1234,  msg: '神奇数字 1234'  },
    { value: 4321,  msg: '逆序四连 4321'  },
    { value: 8888,  msg: '八八大顺 8888'  },
    { value: 6666,  msg: '六六大顺 6666'  },
    { value: 12345, msg: '逐级登顶 12345' },
    { value: 65535, msg: '极客致敬 65535' },
];

let _initialized = false;

export function initEasterEggs(opts = {}) {
    if (_initialized) return;
    _initialized = true;

    _registerHiddenSkin();
    _installKonami(opts);
    _installScoreLandmarks(opts);
    _installCheatConsole(opts);
}

/* -----------------------------------------------------------
 * 1. 注册隐藏皮肤（不进 SKIN_LIST，仅在 SKINS 字典里可访问）
 * --------------------------------------------------------- */
function _registerHiddenSkin() {
    if (!SKINS[HIDDEN_SKIN_ID]) {
        SKINS[HIDDEN_SKIN_ID] = HIDDEN_SKIN_DEF;
    }
}

function _isKonamiUnlocked() {
    try { return localStorage.getItem(KONAMI_KEY) === '1'; } catch { return false; }
}

/* -----------------------------------------------------------
 * 2. Konami Code 监听
 * --------------------------------------------------------- */
function _installKonami(opts = {}) {
    if (typeof window === 'undefined') return;
    const buf = [];
    const onKey = (e) => {
        const k = e.key;
        if (!k) return;
        const lower = (k.length === 1) ? k.toLowerCase() : k;
        buf.push(lower);
        if (buf.length > KONAMI_SEQUENCE.length) buf.shift();
        if (buf.length !== KONAMI_SEQUENCE.length) return;
        for (let i = 0; i < KONAMI_SEQUENCE.length; i++) {
            if (buf[i] !== KONAMI_SEQUENCE[i]) return;
        }
        buf.length = 0;
        _onKonamiTriggered(opts);
    };
    window.addEventListener('keydown', onKey);
}

function _onKonamiTriggered(opts = {}) {
    try { localStorage.setItem(KONAMI_KEY, '1'); } catch { /* ignore */ }
    try {
        opts.audio?.play?.('unlock');
        opts.audio?.vibrate?.([40, 80, 40, 80, 80]);
    } catch { /* ignore */ }
    _showFloatingToast('已解锁开发者隐藏皮肤：OG 几何');
    try { setActiveSkinId(HIDDEN_SKIN_ID); } catch { /* ignore */ }
}

/* -----------------------------------------------------------
 * 3. 分数里程碑彩蛋
 * --------------------------------------------------------- */
function _installScoreLandmarks(opts = {}) {
    if (typeof window === 'undefined') return;
    const triggered = new Set();
    let lastScore = -1;

    const tick = () => {
        const game = opts.game || window.openBlockGame;
        if (!game) return;
        const s = game.score | 0;
        if (s === lastScore) return;
        lastScore = s;
        for (const m of SCORE_LANDMARKS) {
            if (s === m.value && !triggered.has(m.value)) {
                triggered.add(m.value);
                _onScoreLandmark(m, opts);
            }
        }
    };

    setInterval(skipWhenDocumentHidden(tick), 350);

    const newGameWatcher = () => {
        const game = opts.game || window.openBlockGame;
        if (!game) return;
        const origStart = game.start?.bind(game);
        if (typeof origStart === 'function' && !game.__easterEggsStartHooked) {
            game.__easterEggsStartHooked = true;
            game.start = (...args) => {
                triggered.clear();
                return origStart(...args);
            };
        }
    };
    setTimeout(newGameWatcher, 1500);
}

function _onScoreLandmark(landmark, opts = {}) {
    try {
        opts.audio?.play?.('bonus');
        opts.audio?.vibrate?.([10, 20, 10]);
    } catch { /* ignore */ }
    const game = opts.game || window.openBlockGame;
    try {
        game?.renderer?.triggerBonusMatchFlash?.(2);
    } catch { /* ignore */ }
    _showFloatingToast(landmark.msg);
}

/* -----------------------------------------------------------
 * 4. 控制台 cheat 命令
 * --------------------------------------------------------- */
function _installCheatConsole(opts = {}) {
    if (typeof window === 'undefined') return;
    const game = opts.game || window.openBlockGame;
    if (!game) {
        setTimeout(() => _installCheatConsole(opts), 800);
        return;
    }
    if (game.cheat) return;

    const log = (msg) => { try { console.info('%c[OpenBlock] ' + msg, 'color:#FFD160;font-weight:bold'); } catch { /* ignore */ } };

    game.cheat = {
        help() {
            log('Cheat Console — Try the following:');
            log('  game.cheat.god()       — perfect flash + 999 bonus 振奋特效');
            log('  game.cheat.unlock()    — 强制解锁 OG 几何隐藏皮肤');
            log('  game.cheat.skins()     — 列出全部皮肤 id（含隐藏）');
            log('  game.cheat.skin(id)    — 切换到指定皮肤（含隐藏皮肤）');
            log('  game.cheat.sound(b)    — 开关音效  (true / false)');
            log('  game.cheat.haptic(b)   — 开关震动');
            log('  game.cheat.ambient(b)  — 开关皮肤环境粒子');
            log('  game.cheat.about()     — 致谢');
            return undefined;
        },
        god() {
            try {
                game.renderer?.triggerPerfectFlash?.();
                game.renderer?.triggerBonusMatchFlash?.(5);
                game.renderer?.setShake?.(20, 1200);
            } catch { /* ignore */ }
            log('GOD MODE 触发');
        },
        unlock() {
            try { localStorage.setItem(KONAMI_KEY, '1'); } catch { /* ignore */ }
            try { setActiveSkinId(HIDDEN_SKIN_ID); } catch { /* ignore */ }
            log('已解锁 OG 几何隐藏皮肤');
        },
        skins() {
            const ids = Object.keys(SKINS);
            log(`共 ${ids.length} 款：${ids.join(', ')}`);
            return ids;
        },
        skin(id) {
            try {
                const ok = setActiveSkinId(id);
                log(ok ? `已切换到 ${id}` : `皮肤 ${id} 不存在`);
            } catch (e) { console.warn(e); }
        },
        sound(b)   { window.__audioFx?.setEnabled?.(b); log(`音效 ${b ? 'on' : 'off'}`); },
        haptic(b)  { window.__audioFx?.setHaptic?.(b);  log(`震动 ${b ? 'on' : 'off'}`); },
        ambient(b) { window.__ambientParticles?.setEnabled?.(b); log(`环境粒子 ${b ? 'on' : 'off'}`); },
        about() {
            log('OpenBlock — 灵感来自 Tetris 1984，致敬所有方块消除游戏的设计者');
            log('源码：github.com/btbujiangjun/openblock');
        },
    };
}

/* -----------------------------------------------------------
 * 简易飘字 toast（不依赖任何 UI 库）
 * --------------------------------------------------------- */
function _showFloatingToast(msg) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.dataset.tier = 'celebrate';   // Konami / 数字彩蛋为罕见庆贺事件
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 4500);
}

/* 测试可用导出 */
export const __test_only__ = {
    KONAMI_SEQUENCE,
    SCORE_LANDMARKS,
    HIDDEN_SKIN_DEF,
    HIDDEN_SKIN_ID,
};
