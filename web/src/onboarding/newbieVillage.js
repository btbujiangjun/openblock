/**
 * newbieVillage.js — 新手村（First-Login Guided Tutorial）
 *
 * 目标
 * ----
 * 对「首次登录」的用户，在进入真实对局前，提供一个**自包含、零侵入**的交互式
 * 引导沙盒，手把手带玩家走完 5 类消行演示，并用**与真实对局完全一致**的计分规则
 * 即时结算、展示得分拆解：
 *   1. 单消（c=1）
 *   2. 多消（一手同时消除多行/列，c≥2，基础分按 c² 放大）
 *   3. 同花消除（整行/列同色 → iconBonus ×5）
 *   4. 连击 combo（连续多手消行，♥N 累积，♥3 起倍率递增）
 *   5. 清屏 perfect（清空整个棋盘 → ×10）
 *
 * 计分一致性
 * ----------
 * 直接复用 `clearScoring.js` 的 `computeClearScore / detectBonusLines /
 * deriveNextComboCount`（数据源 shared/game_rules.json），杜绝与主局漂移。
 * 棋盘单元存「colorIdx（0~7）」而非 CSS 颜色，这样同花判定与主局口径一致。
 * 每一「课」开始时重置 combo 链（每课是独立演示）；combo 课内连续 3 手保持链路，
 * 真切展示 ♥N×倍率的增长——这与真实对局「combo 跨整局延续」的语义在注释中说明。
 *
 * 设计原则
 * --------
 * - **零耦合**：不依赖 game.js 的盘面 / 出块 / 遥测；独立 DOM 小棋盘 + 自带逻辑。
 * - **首登判定**：localStorage 未完成/未跳过，且 playerProfile.lifetimeGames === 0。
 * - **可跳过**：右上角「跳过」随时退出，永久不再弹出（不强迫）。
 * - **保证成功**：消行步骤把落点锁定在高亮目标，玩家不会卡死。
 * - **优雅降级**：无 document / 无钱包时静默跳过，绝不阻塞开局。
 *
 * 接入路径
 * --------
 *   import { runNewbieVillageIfFirstLogin } from './onboarding/newbieVillage.js';
 *   await runNewbieVillageIfFirstLogin({ game, audio: audioFx });
 */

import { getWallet } from '../skills/wallet.js';
import {
    NEWBIE_VILLAGE_STORAGE_KEY,
    NV_COLS as COLS,
    NV_ROWS as ROWS,
    NV_PALETTE as PALETTE,
    SCENARIO,
    computeClears,
    scorePlacement,
    breakdownText,
    deriveNextComboCount,
    ICON_BONUS_LINE_MULT,
    PERFECT_CLEAR_MULT,
    loadVillageState,
    saveVillageState,
    shouldShowNewbieVillageCore,
    emptyNvBoard,
    isPlacementValid,
} from './newbieVillageCore.js';

export {
    NEWBIE_VILLAGE_STORAGE_KEY,
    SCENARIO,
    applyPiece,
    computeClears,
    scorePlacement,
    shapeCells,
    toGridLike,
} from './newbieVillageCore.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('newbieVillage');


function _loadState() {
    return loadVillageState(typeof localStorage !== 'undefined' ? localStorage : null);
}

function _saveState(patch) {
    saveVillageState(typeof localStorage !== 'undefined' ? localStorage : null, patch);
}

/** 是否应当为当前用户展示新手村 */
export function shouldShowNewbieVillage({ game } = {}) {
    if (typeof document === 'undefined' || typeof localStorage === 'undefined') return false;
    let force = false;
    let skip = false;
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('novillage') === '1') skip = true;
        if (url.searchParams.get('village') === '1') force = true;
    } catch { /* ignore */ }
    return shouldShowNewbieVillageCore({ game, storage: localStorage, force, skip });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 样式注入（自包含，不依赖 main.css，避免 SW 缓存导致样式缺失）
 * ──────────────────────────────────────────────────────────────────────────── */
const STYLE_ID = 'newbie-village-styles';
const STYLE_TEXT = `
.nv-overlay{position:fixed;inset:0;z-index:12000;display:flex;flex-direction:column;
  align-items:center;justify-content:flex-start;gap:12px;padding:max(20px,env(safe-area-inset-top)) 14px 22px;
  background:radial-gradient(120% 120% at 50% 0%,rgba(30,41,59,.96),rgba(10,14,22,.98));
  color:#f1f5f9;opacity:0;transition:opacity .35s ease;overflow-y:auto;overflow-x:hidden;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-tap-highlight-color:transparent;}
.nv-overlay.is-visible{opacity:1;}
.nv-overlay.is-closing{opacity:0;}
.nv-topbar{width:100%;max-width:540px;display:flex;align-items:center;justify-content:space-between;}
.nv-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px;letter-spacing:.5px;}
.nv-brand .nv-spark{font-size:20px;}
.nv-skip{appearance:none;border:1px solid rgba(148,163,184,.35);background:rgba(148,163,184,.12);
  color:#cbd5e1;font-size:13px;padding:6px 14px;border-radius:999px;cursor:pointer;transition:.2s;}
.nv-skip:hover{background:rgba(148,163,184,.22);color:#fff;}
.nv-progress{display:flex;gap:7px;margin-top:1px;}
.nv-dot{width:9px;height:9px;border-radius:50%;background:rgba(148,163,184,.3);transition:.3s;}
.nv-dot.is-active{background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.8);}
.nv-dot.is-done{background:#34d399;}
.nv-coach{width:100%;max-width:540px;display:flex;gap:12px;align-items:flex-start;
  background:linear-gradient(180deg,rgba(30,41,59,.92),rgba(20,28,42,.92));
  border:1px solid rgba(56,189,248,.28);border-radius:16px;padding:13px 15px;
  box-shadow:0 12px 36px rgba(0,0,0,.45);}
.nv-coach__icon{font-size:28px;line-height:1;flex:0 0 auto;}
.nv-coach__title{font-size:15.5px;font-weight:800;margin-bottom:5px;}
.nv-coach__body{font-size:13px;line-height:1.6;color:rgba(226,232,240,.86);}
.nv-coach__body b{color:#fbbf24;font-weight:800;}
.nv-stage{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:2px;}
.nv-hud{display:flex;align-items:center;gap:14px;min-height:24px;}
.nv-score{font-size:15px;font-weight:800;letter-spacing:.3px;color:#fbbf24;
  text-shadow:0 2px 8px rgba(251,191,36,.35);}
.nv-combo{display:none;align-items:center;gap:3px;font-size:14px;font-weight:900;color:#fb7185;
  padding:2px 10px;border-radius:999px;background:rgba(251,113,133,.14);border:1px solid rgba(251,113,133,.4);}
.nv-combo.is-on{display:inline-flex;animation:nv-pop .35s ease;}
.nv-board{position:relative;display:grid;gap:4px;padding:10px;border-radius:16px;
  background:linear-gradient(180deg,rgba(15,23,42,.9),rgba(8,12,20,.95));
  border:1px solid rgba(148,163,184,.18);box-shadow:0 14px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.05);
  touch-action:none;}
.nv-board.is-shake{animation:nv-shake .42s cubic-bezier(.36,.07,.19,.97);}
.nv-cell{border-radius:6px;background:rgba(148,163,184,.08);box-shadow:inset 0 0 0 1px rgba(148,163,184,.07);
  transition:background .15s,box-shadow .15s,transform .15s;}
.nv-cell.is-filled{box-shadow:inset 0 -3px 6px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.25);}
.nv-cell.is-ghost-ok{background:rgba(56,189,248,.35)!important;box-shadow:inset 0 0 0 2px rgba(56,189,248,.9);}
.nv-cell.is-ghost-bad{background:rgba(248,113,113,.25)!important;box-shadow:inset 0 0 0 2px rgba(248,113,113,.8);}
.nv-cell.is-target{animation:nv-pulse 1.1s ease-in-out infinite;
  box-shadow:inset 0 0 0 2px rgba(56,189,248,.85),0 0 14px rgba(56,189,248,.55);}
.nv-cell.is-clearing{animation:nv-clear .42s ease forwards;}
.nv-tray{display:flex;align-items:center;justify-content:center;gap:10px;min-height:70px;margin-top:1px;}
.nv-piece{display:grid;gap:4px;cursor:grab;touch-action:none;padding:6px;border-radius:12px;
  background:rgba(148,163,184,.06);transition:transform .12s;}
.nv-piece:active{cursor:grabbing;}
.nv-piece.is-pulse{animation:nv-bob 1.4s ease-in-out infinite;}
.nv-piece.is-dragging{position:fixed;z-index:12050;pointer-events:none;opacity:.95;
  filter:drop-shadow(0 10px 18px rgba(0,0,0,.5));}
.nv-pcell{border-radius:6px;box-shadow:inset 0 -3px 6px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.3);}
.nv-float{position:absolute;font-size:26px;font-weight:900;color:#fbbf24;pointer-events:none;white-space:nowrap;
  text-shadow:0 2px 10px rgba(251,191,36,.6);animation:nv-float-up 1.25s ease-out forwards;z-index:12060;}
.nv-banner{position:absolute;top:36%;left:50%;transform:translate(-50%,-50%) scale(.4);
  font-size:30px;font-weight:900;letter-spacing:1.5px;color:#fff;pointer-events:none;opacity:0;z-index:12060;
  text-shadow:0 0 18px rgba(56,189,248,.9),0 2px 6px rgba(0,0,0,.6);animation:nv-banner 1s ease-out forwards;}
.nv-banner--perfect{color:#fde68a;text-shadow:0 0 24px rgba(251,191,36,1),0 2px 6px rgba(0,0,0,.6);font-size:34px;}
.nv-banner--mono{color:#a7f3d0;text-shadow:0 0 22px rgba(52,211,153,.95),0 2px 6px rgba(0,0,0,.6);}
.nv-flash{position:absolute;inset:0;border-radius:16px;background:radial-gradient(circle,rgba(255,255,255,.7),transparent 70%);
  pointer-events:none;opacity:0;animation:nv-flash .5s ease-out forwards;z-index:12055;}
.nv-flash--gold{background:radial-gradient(circle,rgba(251,191,36,.85),transparent 72%);}
.nv-particle{position:fixed;width:8px;height:8px;border-radius:2px;pointer-events:none;z-index:12058;
  will-change:transform,opacity;}
.nv-reveal{width:100%;max-width:540px;background:linear-gradient(180deg,rgba(16,32,28,.95),rgba(10,20,18,.96));
  border:1px solid rgba(52,211,153,.4);border-radius:16px;padding:13px 15px;box-shadow:0 12px 36px rgba(0,0,0,.5);
  opacity:0;transform:translateY(10px);transition:.3s;}
.nv-reveal.is-visible{opacity:1;transform:translateY(0);}
.nv-reveal__title{font-size:15px;font-weight:800;color:#6ee7b7;margin-bottom:5px;}
.nv-reveal__body{font-size:13px;line-height:1.6;color:rgba(209,250,229,.9);}
.nv-reveal__calc{margin-top:7px;font-size:12.5px;font-weight:700;color:#fde68a;font-variant-numeric:tabular-nums;}
.nv-cta{appearance:none;border:none;cursor:pointer;font-size:15px;font-weight:800;color:#0b1220;
  padding:12px 30px;border-radius:999px;background:linear-gradient(135deg,#38bdf8,#34d399);
  box-shadow:0 10px 26px rgba(56,189,248,.45);transition:transform .15s,box-shadow .15s;margin-top:4px;}
.nv-cta:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(56,189,248,.55);}
.nv-cta:active{transform:translateY(0);}
.nv-graduate{display:flex;flex-direction:column;align-items:center;gap:13px;text-align:center;max-width:440px;}
.nv-graduate__emoji{font-size:58px;animation:nv-bob 1.6s ease-in-out infinite;}
.nv-graduate__title{font-size:23px;font-weight:900;}
.nv-graduate__body{font-size:14px;line-height:1.7;color:rgba(226,232,240,.85);}
.nv-graduate__body b{color:#fbbf24;}
.nv-graduate__reward{display:inline-flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:14px;
  background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);border-radius:14px;padding:10px 18px;color:#fde68a;}
@keyframes nv-float-up{0%{transform:translateY(0) scale(.7);opacity:0;}
  20%{transform:translateY(-6px) scale(1.1);opacity:1;}100%{transform:translateY(-72px) scale(1);opacity:0;}}
@keyframes nv-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.06);}}
@keyframes nv-pop{0%{transform:scale(.5);}60%{transform:scale(1.18);}100%{transform:scale(1);}}
@keyframes nv-bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}
@keyframes nv-clear{0%{transform:scale(1);}40%{transform:scale(1.18);filter:brightness(2);}
  100%{transform:scale(0);opacity:0;}}
@keyframes nv-flash{0%{opacity:0;}30%{opacity:.85;}100%{opacity:0;}}
@keyframes nv-banner{0%{opacity:0;transform:translate(-50%,-50%) scale(.4);}
  35%{opacity:1;transform:translate(-50%,-50%) scale(1.15);}
  70%{opacity:1;transform:translate(-50%,-50%) scale(1);}100%{opacity:0;transform:translate(-50%,-50%) scale(1);}}
@keyframes nv-shake{10%,90%{transform:translateX(-2px);}20%,80%{transform:translateX(4px);}
  30%,50%,70%{transform:translateX(-7px);}40%,60%{transform:translateX(7px);}}
@media (prefers-reduced-motion:reduce){
  .nv-board.is-shake,.nv-piece.is-pulse,.nv-cell.is-target,.nv-graduate__emoji,.nv-combo.is-on{animation:none;}
}`;

function _injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLE_TEXT;
    document.head.appendChild(el);
}

const BOARD_PAD = 10;
const BOARD_GAP = 4;

/* ────────────────────────────────────────────────────────────────────────────
 * 新手村控制器：DOM / 拖拽 / 真实计分结算 / 分类特效 / 收尾
 * ──────────────────────────────────────────────────────────────────────────── */
class NewbieVillage {
    constructor({ game = null, audio = null, onFinish } = {}) {
        this._game = game;
        this._audio = audio;
        this._onFinish = typeof onFinish === 'function' ? onFinish : () => {};
        this._stepIndex = 0;
        this._score = 0;
        this._comboCount = 0;
        this._roundsSinceClear = Infinity;
        this._board = emptyNvBoard();
        this._queue = [];
        this._queueIdx = 0;
        this._lastScored = null;
        this._cellPx = this._computeCellPx();
        this._cellEls = [];
        this._drag = null;
        this._busy = false;
        this._finished = false;
        this._awaitingPlacement = false;
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
    }

    _computeCellPx() {
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 380) || 380;
        const vh = (typeof window !== 'undefined' ? window.innerHeight : 700) || 700;
        const byW = Math.floor((Math.min(vw, 480) - 44 - BOARD_PAD * 2) / COLS);
        const byH = Math.floor((vh * 0.40) / ROWS);
        return Math.max(26, Math.min(46, Math.min(byW, byH)));
    }

    _currentPiece() {
        return this._queue[this._queueIdx] || null;
    }

    mount() {
        _injectStyles();
        const overlay = document.createElement('div');
        overlay.className = 'nv-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', '新手村教程');
        overlay.innerHTML = `
            <div class="nv-topbar">
                <div class="nv-brand"><span class="nv-spark">🏕️</span><span>新手村</span></div>
                <button class="nv-skip" type="button">跳过引导</button>
            </div>
            <div class="nv-progress">${SCENARIO.map(() => '<span class="nv-dot"></span>').join('')}</div>
            <div class="nv-coach">
                <div class="nv-coach__icon"></div>
                <div><div class="nv-coach__title"></div><div class="nv-coach__body"></div></div>
            </div>
            <div class="nv-stage">
                <div class="nv-hud"><span class="nv-score"></span><span class="nv-combo"></span></div>
                <div class="nv-board"></div>
                <div class="nv-tray"></div>
            </div>
            <div class="nv-reveal" hidden>
                <div class="nv-reveal__title"></div>
                <div class="nv-reveal__body"></div>
                <div class="nv-reveal__calc"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        this._overlay = overlay;
        this._coachIcon = overlay.querySelector('.nv-coach__icon');
        this._coachTitle = overlay.querySelector('.nv-coach__title');
        this._coachBody = overlay.querySelector('.nv-coach__body');
        this._boardEl = overlay.querySelector('.nv-board');
        this._trayEl = overlay.querySelector('.nv-tray');
        this._scoreEl = overlay.querySelector('.nv-score');
        this._comboEl = overlay.querySelector('.nv-combo');
        this._revealEl = overlay.querySelector('.nv-reveal');
        this._dotsEl = overlay.querySelectorAll('.nv-dot');

        overlay.querySelector('.nv-skip').addEventListener('click', () => this._finish({ skipped: true }));
        this._boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${this._cellPx}px)`;
        this._buildBoardCells();
        requestAnimationFrame(() => overlay.classList.add('is-visible'));
        this._renderStep();
    }

    _buildBoardCells() {
        this._boardEl.innerHTML = '';
        this._cellEls = [];
        for (let r = 0; r < ROWS; r++) {
            const row = [];
            for (let c = 0; c < COLS; c++) {
                const cell = document.createElement('div');
                cell.className = 'nv-cell';
                cell.style.width = `${this._cellPx}px`;
                cell.style.height = `${this._cellPx}px`;
                this._boardEl.appendChild(cell);
                row.push(cell);
            }
            this._cellEls.push(row);
        }
    }

    _paintBoard() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const idx = this._board[r][c];
                const el = this._cellEls[r][c];
                el.className = 'nv-cell';
                if (idx !== null) {
                    el.classList.add('is-filled');
                    el.style.background = PALETTE[idx % PALETTE.length];
                } else {
                    el.style.background = '';
                }
            }
        }
        const piece = this._currentPiece();
        if (piece?.target && this._awaitingPlacement) {
            for (const [dx, dy] of piece.cells) {
                const tc = piece.target[0] + dx;
                const tr = piece.target[1] + dy;
                this._cellEls[tr]?.[tc]?.classList.add('is-target');
            }
        }
    }

    _renderStep() {
        const step = SCENARIO[this._stepIndex];
        if (!step) { this._graduate(); return; }
        this._board = step.seed();
        this._queue = step.pieces.slice();
        this._queueIdx = 0;
        // 每课重置 combo 链：每课是独立演示（combo 课内连续 3 手仍保持链路）
        this._comboCount = 0;
        this._roundsSinceClear = Infinity;
        this._lastScored = null;
        this._awaitingPlacement = true;
        this._coachIcon.textContent = step.coach.icon;
        this._coachTitle.textContent = step.coach.title;
        this._coachBody.innerHTML = step.coach.body;
        this._scoreEl.textContent = `总分 ${this._score}`;
        this._updateComboBadge();
        this._revealEl.hidden = true;
        this._revealEl.classList.remove('is-visible');
        this._dotsEl.forEach((d, i) => {
            d.classList.toggle('is-active', i === this._stepIndex);
            d.classList.toggle('is-done', i < this._stepIndex);
        });
        this._paintBoard();
        this._buildTray(this._currentPiece());
    }

    _buildTray(piece) {
        this._trayEl.innerHTML = '';
        if (!piece) return;
        const el = document.createElement('div');
        el.className = 'nv-piece is-pulse';
        const { maxX, maxY } = this._pieceExtent(piece);
        el.style.gridTemplateColumns = `repeat(${maxX + 1}, ${this._cellPx}px)`;
        const filled = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
        for (let y = 0; y <= maxY; y++) {
            for (let x = 0; x <= maxX; x++) {
                const pc = document.createElement('div');
                pc.style.width = `${this._cellPx}px`;
                pc.style.height = `${this._cellPx}px`;
                if (filled.has(`${x},${y}`)) {
                    pc.className = 'nv-pcell';
                    pc.style.background = PALETTE[piece.colorIdx % PALETTE.length];
                } else {
                    pc.style.visibility = 'hidden';
                }
                el.appendChild(pc);
            }
        }
        el.addEventListener('pointerdown', (e) => this._onPointerDown(e, piece, el));
        this._trayEl.appendChild(el);
        this._pieceEl = el;
    }

    _pieceExtent(piece) {
        let maxX = 0;
        let maxY = 0;
        for (const [x, y] of piece.cells) {
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        return { maxX, maxY };
    }

    /* ── 拖拽 ─────────────────────────────────────────────── */
    _onPointerDown(e, piece, el) {
        if (this._finished || this._busy || !this._awaitingPlacement) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        this._drag = {
            piece,
            el,
            grabX: e.clientX - rect.left,
            grabY: e.clientY - rect.top,
        };
        el.classList.remove('is-pulse');
        el.classList.add('is-dragging');
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
        el.style.width = `${rect.width}px`;
        document.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        try { this._audio?.play?.('pick', { force: true }); } catch { /* ignore */ }
    }

    _onPointerMove(e) {
        const d = this._drag;
        if (!d) return;
        const left = e.clientX - d.grabX;
        const top = e.clientY - d.grabY;
        d.el.style.left = `${left}px`;
        d.el.style.top = `${top}px`;
        this._showGhost(d.piece, this._originFromPointer(left, top));
    }

    _onPointerUp(e) {
        const d = this._drag;
        if (!d) return;
        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        this._drag = null;
        const origin = this._originFromPointer(e.clientX - d.grabX, e.clientY - d.grabY);
        this._clearGhost();
        const ok = origin && this._isPlacement(d.piece, origin);
        d.el.classList.remove('is-dragging');
        d.el.style.left = '';
        d.el.style.top = '';
        d.el.style.width = '';
        if (ok) {
            this._commitPlacement(d.piece, origin);
        } else {
            d.el.classList.add('is-pulse');
            try { this._audio?.play?.('error', { force: true }); } catch { /* ignore */ }
        }
    }

    _originFromPointer(left, top) {
        const rect = this._boardEl.getBoundingClientRect();
        const unit = this._cellPx + BOARD_GAP;
        const col = Math.round((left - rect.left - BOARD_PAD) / unit);
        const row = Math.round((top - rect.top - BOARD_PAD) / unit);
        if (col < -1 || row < -1 || col > COLS || row > ROWS) return null;
        return [col, row];
    }

    /** 合法落点：界内、空格（=== null）；锁定 target 时必须与 target 一致 */
    _isPlacement(piece, origin) {
        return isPlacementValid(this._board, piece, origin);
    }

    _showGhost(piece, origin) {
        this._clearGhost();
        if (!origin) return;
        const ok = this._isPlacement(piece, origin);
        const [ox, oy] = origin;
        for (const [dx, dy] of piece.cells) {
            const el = this._cellEls[oy + dy]?.[ox + dx];
            if (el) el.classList.add(ok ? 'is-ghost-ok' : 'is-ghost-bad');
        }
    }

    _clearGhost() {
        for (const row of this._cellEls) {
            for (const el of row) el.classList.remove('is-ghost-ok', 'is-ghost-bad');
        }
    }

    /* ── 落子结算（复用真实计分链路） ──────────────────────── */
    _commitPlacement(piece, origin) {
        this._awaitingPlacement = false;
        const [ox, oy] = origin;
        for (const [dx, dy] of piece.cells) this._board[oy + dy][ox + dx] = piece.colorIdx;
        this._pieceEl?.remove();
        this._paintBoard();
        try { this._audio?.play?.('place', { force: true }); } catch { /* ignore */ }
        try { this._audio?.vibrate?.([10]); } catch { /* ignore */ }

        // 先判定本步是否清线，再按 grace 窗口推进 combo（与主局 deriveNextComboCount 同口径）
        const cleared = computeClears(this._board).lines > 0;
        this._comboCount = deriveNextComboCount(this._comboCount, this._roundsSinceClear, cleared);
        this._roundsSinceClear = cleared ? 0 : this._roundsSinceClear + 1;

        if (cleared) {
            const scored = scorePlacement(this._board, this._comboCount);
            this._lastScored = scored;
            this._score += scored.score.clearScore;
            this._busy = true;
            this._runClear(piece, scored);
        } else {
            this._busy = true;
            setTimeout(() => { this._busy = false; this._afterPlacement(); }, 460);
        }
    }

    _runClear(piece, scored) {
        const { clears, result, score, perfect, afterBoard } = scored;
        const lines = result.count;
        const mono = (result.bonusLines || []).length > 0;
        const comboMult = score.comboMultiplier;

        for (const [r, c] of clears.cells) this._cellEls[r][c].classList.add('is-clearing');
        this._flash(perfect);
        this._boardEl.classList.add('is-shake');
        setTimeout(() => this._boardEl.classList.remove('is-shake'), 440);

        // 粒子配色：清屏=金、同花=彩虹、其余=方块色
        let colors;
        if (perfect) colors = ['#fde68a', '#fbbf24', '#ffffff'];
        else if (mono) colors = PALETTE;
        else colors = [PALETTE[piece.colorIdx % PALETTE.length], '#fde68a'];
        this._burstParticles(clears.cells, colors);

        // 横幅优先级：清屏 > 连击(×>1) > 同花 > 多消
        if (perfect) this._banner(`PERFECT ×${PERFECT_CLEAR_MULT}`, 'perfect');
        else if (comboMult > 1) this._banner(`COMBO ♥${this._comboCount} ×${comboMult}`, 'combo');
        else if (mono) this._banner(`同花 BONUS ×${ICON_BONUS_LINE_MULT}`, 'mono');
        else if (lines >= 2) this._banner(`多消 ×${lines}`, 'multi');

        const strong = perfect || comboMult > 1 || mono || lines >= 2;
        try { this._audio?.play?.(strong ? 'comboClear' : 'clear', { force: true }); } catch { /* ignore */ }
        try { this._audio?.vibrate?.(strong ? [20, 40, 30] : [16]); } catch { /* ignore */ }

        this._floatScore(score.clearScore);

        setTimeout(() => {
            this._board = afterBoard;
            this._paintBoard();
            this._scoreEl.textContent = `总分 ${this._score}`;
            this._updateComboBadge();
            this._busy = false;
            this._afterPlacement();
        }, 460);
    }

    /** 一枚落子结算完毕：队列里还有就换下一枚，否则展示解说并进入下一课 */
    _afterPlacement() {
        if (this._finished) return;
        this._queueIdx += 1;
        if (this._queueIdx < this._queue.length) {
            this._awaitingPlacement = true;
            this._buildTray(this._currentPiece());
            this._paintBoard();
            return;
        }
        const step = SCENARIO[this._stepIndex];
        if (step?.reveal) this._showReveal(step.reveal, this._lastScored);
        setTimeout(() => this._advance(), step?.reveal ? 1800 : 450);
    }

    _advance() {
        if (this._finished) return;
        this._stepIndex += 1;
        if (this._stepIndex >= SCENARIO.length) this._graduate();
        else this._renderStep();
    }

    _updateComboBadge() {
        if (this._comboCount > 0) {
            const mult = this._lastScored?.score?.comboMultiplier || 1;
            this._comboEl.textContent = mult > 1 ? `♥${this._comboCount} ×${mult}` : `♥${this._comboCount}`;
            this._comboEl.classList.add('is-on');
        } else {
            this._comboEl.classList.remove('is-on');
            this._comboEl.textContent = '';
        }
    }

    /* ── 特效 ─────────────────────────────────────────────── */
    _flash(gold = false) {
        const f = document.createElement('div');
        f.className = gold ? 'nv-flash nv-flash--gold' : 'nv-flash';
        this._boardEl.appendChild(f);
        setTimeout(() => f.remove(), 520);
    }

    _banner(text, variant) {
        const b = document.createElement('div');
        b.className = 'nv-banner' + (variant === 'perfect' ? ' nv-banner--perfect' : variant === 'mono' ? ' nv-banner--mono' : '');
        b.textContent = text;
        this._boardEl.parentElement.appendChild(b);
        setTimeout(() => b.remove(), 1000);
    }

    _floatScore(amount) {
        const el = document.createElement('div');
        el.className = 'nv-float';
        el.textContent = `+${amount}`;
        const rect = this._boardEl.getBoundingClientRect();
        const stageRect = this._boardEl.parentElement.getBoundingClientRect();
        el.style.left = `${rect.left - stageRect.left + rect.width / 2 - 26}px`;
        el.style.top = `${rect.top - stageRect.top + rect.height / 2 - 16}px`;
        this._boardEl.parentElement.appendChild(el);
        setTimeout(() => el.remove(), 1260);
    }

    _burstParticles(cells, colors) {
        if (typeof document === 'undefined' || typeof document.body?.appendChild !== 'function') return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (reduce) return;
        const sample = cells.slice(0, 18);
        for (const [r, c] of sample) {
            const cellRect = this._cellEls[r][c].getBoundingClientRect();
            const cx = cellRect.left + cellRect.width / 2;
            const cy = cellRect.top + cellRect.height / 2;
            for (let i = 0; i < 4; i++) {
                const p = document.createElement('div');
                p.className = 'nv-particle';
                p.style.left = `${cx}px`;
                p.style.top = `${cy}px`;
                p.style.background = colors[(i + r + c) % colors.length];
                document.body.appendChild(p);
                if (typeof p.animate !== 'function') { setTimeout(() => p.remove(), 700); continue; }
                const ang = Math.random() * Math.PI * 2;
                const dist = 38 + Math.random() * 52;
                p.animate(
                    [
                        { transform: 'translate(0,0) scale(1)', opacity: 1 },
                        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 26}px) scale(.2)`, opacity: 0 },
                    ],
                    { duration: 640 + Math.random() * 240, easing: 'cubic-bezier(.2,.6,.3,1)' },
                ).onfinish = () => p.remove();
            }
        }
    }

    _showReveal(reveal, scored) {
        this._revealEl.hidden = false;
        this._revealEl.querySelector('.nv-reveal__title').textContent = reveal.title;
        this._revealEl.querySelector('.nv-reveal__body').textContent = reveal.body;
        this._revealEl.querySelector('.nv-reveal__calc').textContent = scored ? breakdownText(scored) : '';
        requestAnimationFrame(() => this._revealEl.classList.add('is-visible'));
    }

    /** 按真实结算结果生成得分拆解文案（与 computeClearScore 输出严格一致） */
    _breakdownText(scored) {
        return breakdownText(scored);
    }

    /* ── 收尾 ─────────────────────────────────────────────── */
    _graduate() {
        if (this._finished) return;
        const reward = this._grantReward();
        for (const sel of ['.nv-stage', '.nv-coach', '.nv-tray']) {
            const node = this._overlay.querySelector(sel);
            if (node) node.style.display = 'none';
        }
        this._revealEl.hidden = true;
        this._dotsEl.forEach((d) => d.classList.add('is-done'));

        const card = document.createElement('div');
        card.className = 'nv-graduate';
        const rewardHtml = reward ? `<div class="nv-graduate__reward">🎁 新手礼包：${reward}</div>` : '';
        card.innerHTML = `
            <div class="nv-graduate__emoji">🎉</div>
            <div class="nv-graduate__title">出师啦！</div>
            <div class="nv-graduate__body">你已掌握 <b>单消 / 多消 / 同花 / 连击 / 清屏</b>，
            训练赛累计得分 <b>${this._score}</b>。真实对局采用同样的计分规则，去冲击最高分吧！</div>
            ${rewardHtml}
            <button class="nv-cta" type="button">开始游戏</button>
        `;
        this._overlay.appendChild(card);
        try { this._audio?.play?.('unlock', { force: true }); } catch { /* ignore */ }
        card.querySelector('.nv-cta').addEventListener('click', () => this._finish({ done: true }));
    }

    _grantReward() {
        try {
            const wallet = getWallet();
            if (!wallet || typeof wallet.addBalance !== 'function') return '';
            wallet.addBalance('hintToken', 2, 'newbie_village');
            wallet.addBalance('undoToken', 1, 'newbie_village');
            wallet.addBalance('coin', 100, 'newbie_village');
            return '提示×2 · 撤销×1 · 金币×100';
        } catch {
            return '';
        }
    }

    _finish({ done = false, skipped = false } = {}) {
        if (this._finished) return;
        this._finished = true;
        _saveState({ done: done || skipped, skipped });
        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        this._overlay.classList.add('is-closing');
        setTimeout(() => {
            this._overlay?.remove();
            this._onFinish({ done, skipped });
        }, 360);
    }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 对外 API
 * ──────────────────────────────────────────────────────────────────────────── */

let _active = null;

/** 立即启动新手村（无视首登判定，调试 / 强制场景用）。返回 Promise，结束时 resolve。 */
export function startNewbieVillage({ game = null, audio = null } = {}) {
    if (typeof document === 'undefined') return Promise.resolve(false);
    if (_active) return Promise.resolve(false);
    return new Promise((resolve) => {
        _active = new NewbieVillage({
            game,
            audio,
            onFinish: (info) => { _active = null; resolve(info); },
        });
        _active.mount();
    });
}

/**
 * 首登则展示新手村，否则立即返回。阻塞式（await）以便调用方在结束后再开局。
 * 永不抛错——任何异常都降级为「不展示」，确保不阻塞开局。
 * @returns {Promise<boolean>} 是否实际展示了新手村
 */
export async function runNewbieVillageIfFirstLogin({ game = null, audio = null } = {}) {
    try {
        if (!shouldShowNewbieVillage({ game })) return false;
        await startNewbieVillage({ game, audio });
        return true;
    } catch (e) {
        try { log.warn('[newbieVillage] 跳过（异常）:', e); } catch { /* ignore */ }
        return false;
    }
}

/* 调试入口 */
if (typeof window !== 'undefined') {
    window.__newbieVillage = {
        start: (game) => startNewbieVillage({ game: game || window.openBlockGame, audio: window.__audioFx }),
        reset: () => { try { localStorage.removeItem(NEWBIE_VILLAGE_STORAGE_KEY); } catch { /* ignore */ } },
        state: () => _loadState(),
    };
}

/** 测试用：重置内部状态与本地存储 */
export function __resetForTest() {
    _active = null;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(NEWBIE_VILLAGE_STORAGE_KEY); } catch { /* ignore */ }
    }
}
