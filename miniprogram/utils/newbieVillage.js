/**
 * newbieVillage.js — 小程序新手村（首登引导 · 5 课消行演示）
 *
 * 逻辑来自 core/onboarding/newbieVillageCore.js；本层负责 Canvas 2D 盘面、
 * 触控拖拽与 WXML overlay（nv* 字段）数据绑定。
 */

const storage = require('../adapters/storage');
const {
  NEWBIE_VILLAGE_STORAGE_KEY,
  NV_COLS,
  NV_ROWS,
  NV_PALETTE,
  SCENARIO,
  computeClears,
  scorePlacement,
  deriveNextComboCount,
  breakdownText,
  ICON_BONUS_LINE_MULT,
  PERFECT_CLEAR_MULT,
  saveVillageState,
  shouldShowNewbieVillageCore,
  emptyNvBoard,
  isPlacementValid,
  pickSmartSnap,
} = require('../core/onboarding/newbieVillageCore');
const { nvT } = require('../core/onboarding/newbieVillageStrings');
const i18n = require('../core/i18n');

/** 新手村本地翻译辅助：当前 locale → en → zh-CN → fallback → key 五级回退。 */
function _t(key, vars, fallback) {
  const locale = typeof i18n.getLanguage === 'function' ? i18n.getLanguage() : 'zh-CN';
  return nvT(locale, key, vars, fallback);
}

const BOARD_PAD = 10;
const BOARD_GAP = 4;
const TRAY_H = 72;
/** 智能吸附半径（格）。1 格容差已覆盖"差半格"的常见 finger drift。 */
const NV_SNAP_RADIUS = 1;
/** 候选块就绪后无操作多久弹「小手」引导（毫秒）。对齐 cocos / web 的 2.6s。 */
const NV_IDLE_HINT_DELAY_MS = 2600;
/** 小手位移循环周期（毫秒）。对齐 cocos showIdleHint 的 1.74s。 */
const NV_HINT_PERIOD_MS = 1740;

function _coachBodyHtml(body) {
  return String(body || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function _pieceExtent(piece) {
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of piece.cells) {
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { maxX, maxY };
}

function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

class NewbieVillageSession {
  /**
   * @param {{
   *   setData: Function,
   *   getCanvasNode: () => Promise<{ node: object, dpr: number, rect: object }|null>,
   *   audio?: object,
   *   lifetimeGames?: number,
   *   onFinish?: Function,
   * }} opts
   */
  constructor(opts) {
    this._setData = opts.setData;
    this._getCanvasNode = opts.getCanvasNode;
    this._audio = opts.audio || null;
    this._lifetimeGames = Number(opts.lifetimeGames) || 0;
    this._onFinish = typeof opts.onFinish === 'function' ? opts.onFinish : () => {};

    this._stepIndex = 0;
    this._score = 0;
    this._comboCount = 0;
    this._roundsSinceClear = Infinity;
    this._board = emptyNvBoard();
    this._queue = [];
    this._queueIdx = 0;
    this._lastScored = null;
    this._cellPx = 32;
    this._canvas = null;
    this._ctx = null;
    this._dpr = 1;
    this._canvasRect = null;
    this._drag = null;
    this._busy = false;
    this._finished = false;
    this._awaitingPlacement = false;
    this._ghostOrigin = null;
    this._clearingCells = new Set();
    this._shakeUntil = 0;
    this._bannerUntil = 0;
    this._bannerText = '';
    this._bannerClass = '';
    this._floatUntil = 0;
    this._floatText = '';
    this._revealTimer = null;
    // 无操作小手引导：候选块就绪后 2.6s 弹出，对齐 cocos showIdleHint / web _showIdleHint。
    this._hintTimer = null;
    this._hintStartMs = 0;       // hint 起算时刻；>0 表示 hint 当前可见，由 _paint 内的循环重绘驱动
    this._hintRafTimer = null;   // setTimeout 循环（小程序无 rAF，用 setTimeout 50ms 节拍重绘）
  }

  _computeCellPx() {
    try {
      const sys = wx.getSystemInfoSync();
      const vw = sys.windowWidth || 375;
      const vh = sys.windowHeight || 667;
      const byW = Math.floor((Math.min(vw, 480) - 44 - BOARD_PAD * 2) / NV_COLS);
      const byH = Math.floor((vh * 0.36) / NV_ROWS);
      return Math.max(26, Math.min(46, Math.min(byW, byH)));
    } catch {
      return 32;
    }
  }

  _currentPiece() {
    return this._queue[this._queueIdx] || null;
  }

  async mount() {
    this._cellPx = this._computeCellPx();
    const boardPx = NV_COLS * this._cellPx + (NV_COLS - 1) * BOARD_GAP + BOARD_PAD * 2;
    const canvasH = boardPx + TRAY_H + 8;

    // 标题与跳过按钮的 i18n 文案在 overlay 首次挂载时一次性注入（语言运行时不会动态切换）。
    const titleStr = _t('ui.title', undefined, '🏕️ 新手村').replace(/^🏕️\s*/, '');
    this._setData({
      nvVisible: true,
      nvClosing: false,
      nvCanvasW: boardPx,
      nvCanvasH: canvasH,
      nvStageHidden: false,
      nvGraduateVisible: false,
      nvRevealVisible: false,
      nvBrand: titleStr,
      nvSkipText: _t('ui.skip', undefined, '跳过引导'),
      nvDots: SCENARIO.map((_, i) => ({ active: i === 0, done: false })),
    });

    await new Promise((resolve) => wx.nextTick(resolve));

    const info = await this._getCanvasNode();
    if (!info || !info.node) {
      this._finish({ skipped: true });
      return;
    }
    this._canvas = info.node;
    this._dpr = info.dpr || 1;
    this._canvasRect = info.rect || null;
    const w = boardPx;
    const h = canvasH;
    this._canvas.width = w * this._dpr;
    this._canvas.height = h * this._dpr;
    this._ctx = this._canvas.getContext('2d');
    if (!this._ctx) {
      this._finish({ skipped: true });
      return;
    }
    this._ctx.scale(this._dpr, this._dpr);

    this._renderStep();
    this._paint();
  }

  _patch(data, cb) {
    this._setData(data, cb);
  }

  _renderStep() {
    const step = SCENARIO[this._stepIndex];
    if (!step) {
      this._graduate();
      return;
    }
    this._board = step.seed();
    this._queue = step.pieces.slice();
    this._queueIdx = 0;
    this._comboCount = 0;
    this._roundsSinceClear = Infinity;
    this._lastScored = null;
    this._awaitingPlacement = true;
    this._clearingCells.clear();
    this._ghostOrigin = null;

    this._patch({
      // 教程文案走 i18n：缺译时回退 SCENARIO 内嵌中文原文。
      nvCoachIcon: step.coach.icon,
      nvCoachTitle: _t(`scenario.${step.id}.coach.title`, undefined, step.coach.title),
      nvCoachBodyHtml: _coachBodyHtml(
        _t(`scenario.${step.id}.coach.body`, undefined, step.coach.body)
      ),
      nvScoreText: _t('ui.totalScore', { n: this._score }, `总分 ${this._score}`),
      nvComboText: '',
      nvComboVisible: false,
      nvRevealVisible: false,
      nvShake: false,
      nvDots: SCENARIO.map((_, i) => ({
        active: i === this._stepIndex,
        done: i < this._stepIndex,
      })),
    });
    this._paint();
    // 新候选块就绪 → 重置无操作小手引导计时（与 cocos / web 同步语义）。
    this._scheduleIdleHint();
  }

  _boardOrigin() {
    return { x: BOARD_PAD, y: BOARD_PAD };
  }

  _trayOrigin() {
    const boardPx = NV_COLS * this._cellPx + (NV_COLS - 1) * BOARD_GAP + BOARD_PAD * 2;
    return { x: BOARD_PAD, y: boardPx - BOARD_PAD + 8 };
  }

  _cellAt(col, row) {
    const o = this._boardOrigin();
    const unit = this._cellPx + BOARD_GAP;
    return { x: o.x + col * unit, y: o.y + row * unit };
  }

  _touchLocal(touch) {
    if (!touch) return null;
    if (Number.isFinite(touch.x) && Number.isFinite(touch.y)) {
      return { x: touch.x, y: touch.y };
    }
    if (this._canvasRect && Number.isFinite(touch.clientX) && Number.isFinite(touch.clientY)) {
      return {
        x: touch.clientX - this._canvasRect.left,
        y: touch.clientY - this._canvasRect.top,
      };
    }
    return null;
  }

  _originFromTouch(touch) {
    const local = this._touchLocal(touch);
    if (!local) return null;
    const o = this._boardOrigin();
    const unit = this._cellPx + BOARD_GAP;
    const col = Math.round((local.x - o.x) / unit);
    const row = Math.round((local.y - o.y) / unit);
    if (col < -1 || row < -1 || col > NV_COLS || row > NV_ROWS) return null;
    return [col, row];
  }

  _paintCell(ctx, x, y, size, color, opts = {}) {
    const r = 6;
    _roundRect(ctx, x, y, size, size, r);
    if (opts.empty) {
      ctx.fillStyle = 'rgba(148,163,184,.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    if (opts.ghostOk) {
      ctx.fillStyle = 'rgba(56,189,248,.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    if (opts.ghostBad) {
      ctx.fillStyle = 'rgba(248,113,113,.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(248,113,113,.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    if (opts.target) {
      ctx.fillStyle = color || 'rgba(148,163,184,.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    const key = opts.cellKey;
    if (key && this._clearingCells.has(key)) {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = color;
    ctx.fill();
    const topG = ctx.createLinearGradient(x, y, x, y + size * 0.24);
    topG.addColorStop(0, 'rgba(255,255,255,0.25)');
    topG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = topG;
    _roundRect(ctx, x, y, size, size, r);
    ctx.fill();
    const botG = ctx.createLinearGradient(x, y + size * 0.68, x, y + size);
    botG.addColorStop(0, 'rgba(0,0,0,0)');
    botG.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = botG;
    _roundRect(ctx, x, y, size, size, r);
    ctx.fill();
  }

  _paintBoard(ctx) {
    const ghostSet = new Set();
    if (this._ghostOrigin) {
      const piece = this._drag?.piece || this._currentPiece();
      const ok = piece && isPlacementValid(this._board, piece, this._ghostOrigin);
      const [ox, oy] = this._ghostOrigin;
      if (piece) {
        for (const [dx, dy] of piece.cells) {
          ghostSet.add(`${oy + dy},${ox + dx}`);
        }
      }
      for (let r = 0; r < NV_ROWS; r++) {
        for (let c = 0; c < NV_COLS; c++) {
          const k = `${r},${c}`;
          const { x, y } = this._cellAt(c, r);
          const idx = this._board[r][c];
          if (ghostSet.has(k)) {
            this._paintCell(ctx, x, y, this._cellPx, null, { ghostOk: ok, ghostBad: !ok });
          } else if (idx !== null) {
            this._paintCell(ctx, x, y, this._cellPx, NV_PALETTE[idx % NV_PALETTE.length], { cellKey: k });
          } else {
            this._paintCell(ctx, x, y, this._cellPx, null, { empty: true });
          }
        }
      }
      return;
    }

    const piece = this._currentPiece();
    const targetSet = new Set();
    if (piece?.target && this._awaitingPlacement) {
      for (const [dx, dy] of piece.cells) {
        targetSet.add(`${piece.target[1] + dy},${piece.target[0] + dx}`);
      }
    }

    for (let r = 0; r < NV_ROWS; r++) {
      for (let c = 0; c < NV_COLS; c++) {
        const k = `${r},${c}`;
        const { x, y } = this._cellAt(c, r);
        const idx = this._board[r][c];
        if (idx !== null) {
          this._paintCell(ctx, x, y, this._cellPx, NV_PALETTE[idx % NV_PALETTE.length], { cellKey: k });
        } else if (targetSet.has(k)) {
          this._paintCell(ctx, x, y, this._cellPx, null, { target: true });
        } else {
          this._paintCell(ctx, x, y, this._cellPx, null, { empty: true });
        }
      }
    }
  }

  _paintTray(ctx) {
    if (this._drag) return;
    const piece = this._currentPiece();
    if (!piece || !this._awaitingPlacement) return;
    const tray = this._trayOrigin();
    const { maxX, maxY } = _pieceExtent(piece);
    const unit = this._cellPx + BOARD_GAP;
    const pw = (maxX + 1) * unit - BOARD_GAP;
    const ph = (maxY + 1) * unit - BOARD_GAP;
    const ox = tray.x + Math.max(0, (NV_COLS * unit - BOARD_GAP - pw) / 2);
    const oy = tray.y;
    _roundRect(ctx, ox - 6, oy - 6, pw + 12, ph + 12, 12);
    ctx.fillStyle = 'rgba(148,163,184,.06)';
    ctx.fill();
    for (const [dx, dy] of piece.cells) {
      this._paintCell(
        ctx,
        ox + dx * unit,
        oy + dy * unit,
        this._cellPx,
        NV_PALETTE[piece.colorIdx % NV_PALETTE.length],
      );
    }
    this._trayPieceOrigin = { x: ox, y: oy, piece };
  }

  _paintDragPiece(ctx) {
    const d = this._drag;
    if (!d) return;
    const unit = this._cellPx + BOARD_GAP;
    for (const [dx, dy] of d.piece.cells) {
      this._paintCell(
        ctx,
        d.left + dx * unit,
        d.top + dy * unit,
        this._cellPx,
        NV_PALETTE[d.piece.colorIdx % NV_PALETTE.length],
      );
    }
  }

  _paint() {
    const ctx = this._ctx;
    if (!ctx) return;
    const w = this._canvas.width / this._dpr;
    const h = this._canvas.height / this._dpr;
    ctx.clearRect(0, 0, w, h);

    const boardPx = NV_COLS * this._cellPx + (NV_COLS - 1) * BOARD_GAP + BOARD_PAD * 2;
    _roundRect(ctx, 0, 0, w, boardPx, 16);
    ctx.fillStyle = 'rgba(15,23,42,.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const shake = this._shakeUntil > Date.now();
    if (shake) {
      const dx = (Math.random() - 0.5) * 6;
      ctx.save();
      ctx.translate(dx, 0);
    }

    this._paintBoard(ctx);
    this._paintTray(ctx);
    this._paintDragPiece(ctx);

    if (shake) ctx.restore();

    const now = Date.now();
    if (this._bannerUntil > now && this._bannerText) {
      ctx.save();
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this._bannerClass.includes('perfect') ? '#fde68a' : '#fff';
      ctx.shadowColor = 'rgba(56,189,248,.8)';
      ctx.shadowBlur = 12;
      ctx.fillText(this._bannerText, w / 2, boardPx * 0.42);
      ctx.restore();
    }
    if (this._floatUntil > now && this._floatText) {
      ctx.save();
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.globalAlpha = Math.max(0, (this._floatUntil - now) / 900);
      ctx.fillText(this._floatText, w / 2, boardPx * 0.48);
      ctx.restore();
    }
    this._drawIdleHint(ctx);
  }

  async _refreshCanvasRect() {
    const info = await this._getCanvasNode();
    if (info?.rect) this._canvasRect = info.rect;
  }

  async handleTouchStart(e) {
    if (this._finished || this._busy || !this._awaitingPlacement) return;
    // 玩家已碰触 → 撤掉小手引导（不打断教学焦点）。
    this._clearIdleHint();
    await this._refreshCanvasRect();
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    const piece = this._currentPiece();
    if (!touch || !piece || !this._trayPieceOrigin) return;

    const unit = this._cellPx + BOARD_GAP;
    const { x: tx, y: ty, piece: tp } = this._trayPieceOrigin;
    const { maxX, maxY } = _pieceExtent(tp);
    const pw = (maxX + 1) * unit - BOARD_GAP;
    const ph = (maxY + 1) * unit - BOARD_GAP;

    const local = this._touchLocal(touch);
    if (!local) return;
    if (local.x < tx || local.y < ty || local.x > tx + pw || local.y > ty + ph) return;

    this._drag = {
      piece,
      grabX: local.x - tx,
      grabY: local.y - ty,
      left: tx,
      top: ty,
    };
    try { this._audio?.play?.('pick', { force: true }); } catch { /* ignore */ }
    this._paint();
  }

  handleTouchMove(e) {
    const d = this._drag;
    if (!d) return;
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!touch) return;
    const local = this._touchLocal(touch);
    if (!local) return;
    d.left = local.x - d.grabX;
    d.top = local.y - d.grabY;
    // ghost 走智能吸附：aim 命中 target / 邻近合法格时高亮吸附位（与最终落点同一格）。
    const aim = this._originFromTouch(touch);
    const snap = aim ? pickSmartSnap(this._board, d.piece, aim, NV_SNAP_RADIUS) : null;
    this._ghostOrigin = snap || aim;
    this._paint();
  }

  handleTouchEnd(e) {
    const d = this._drag;
    if (!d) return;
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    this._drag = null;
    this._ghostOrigin = null;
    const aim = touch ? this._originFromTouch(touch) : null;
    const snap = aim ? pickSmartSnap(this._board, d.piece, aim, NV_SNAP_RADIUS) : null;
    const origin = snap || aim;
    const ok = !!(origin && isPlacementValid(this._board, d.piece, origin));
    if (ok) {
      this._commitPlacement(d.piece, origin);
    } else {
      try { this._audio?.play?.('error', { force: true }); } catch { /* ignore */ }
      this._paint();
    }
  }

  _commitPlacement(piece, origin) {
    this._awaitingPlacement = false;
    this._clearIdleHint();
    const [ox, oy] = origin;
    for (const [dx, dy] of piece.cells) this._board[oy + dy][ox + dx] = piece.colorIdx;
    this._paint();
    try { this._audio?.play?.('place', { force: true }); } catch { /* ignore */ }
    try { this._audio?.vibrate?.([10]); } catch { /* ignore */ }

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
    const { clears, result, score, perfect } = scored;
    const lines = result.count;
    const mono = (result.bonusLines || []).length > 0;
    const comboMult = score.comboMultiplier;

    this._clearingCells = new Set(clears.cells.map(([r, c]) => `${r},${c}`));
    this._shakeUntil = Date.now() + 440;

    if (perfect) this._showBanner(_t('banner.perfect', { n: PERFECT_CLEAR_MULT }, `PERFECT ×${PERFECT_CLEAR_MULT}`), 'perfect');
    else if (comboMult > 1) this._showBanner(_t('banner.combo', { n: comboMult, hearts: this._comboCount }, `COMBO ♥${this._comboCount} ×${comboMult}`), 'combo');
    else if (mono) this._showBanner(_t('banner.mono', { n: ICON_BONUS_LINE_MULT }, `同花 BONUS ×${ICON_BONUS_LINE_MULT}`), 'mono');
    else if (lines >= 2) this._showBanner(_t('banner.multi', { n: lines }, `多消 ×${lines}`), 'multi');

    const strong = perfect || comboMult > 1 || mono || lines >= 2;
    try { this._audio?.play?.(strong ? 'comboClear' : 'clear', { force: true }); } catch { /* ignore */ }
    try { this._audio?.vibrate?.(strong ? [20, 40, 30] : [16]); } catch { /* ignore */ }

    this._floatText = `+${score.clearScore}`;
    this._floatUntil = Date.now() + 1200;
    this._paint();

    setTimeout(() => {
      this._board = scored.afterBoard;
      this._clearingCells.clear();
      const mult = this._lastScored?.score?.comboMultiplier || 1;
      this._patch({
        nvScoreText: _t('ui.totalScore', { n: this._score }, `总分 ${this._score}`),
        nvComboText: this._comboCount > 0
          ? (mult > 1 ? `♥${this._comboCount} ×${mult}` : `♥${this._comboCount}`)
          : '',
        nvComboVisible: this._comboCount > 0,
        nvShake: false,
      });
      this._busy = false;
      this._paint();
      this._afterPlacement();
    }, 460);
  }

  _showBanner(text, variant) {
    this._bannerText = text;
    this._bannerClass = variant || '';
    this._bannerUntil = Date.now() + 1000;
    this._patch({ nvShake: true });
    this._paint();
  }

  _afterPlacement() {
    if (this._finished) return;
    this._queueIdx += 1;
    if (this._queueIdx < this._queue.length) {
      this._awaitingPlacement = true;
      this._paint();
      return;
    }
    const step = SCENARIO[this._stepIndex];
    if (step?.reveal) {
      // reveal 走 i18n：title/body 各自按 scenario.<id>.reveal.* 翻译。
      this._showReveal({
        title: _t(`scenario.${step.id}.reveal.title`, undefined, step.reveal.title),
        body: _t(`scenario.${step.id}.reveal.body`, undefined, step.reveal.body),
      }, this._lastScored);
    }
    const delay = step?.reveal ? 1800 : 450;
    if (this._revealTimer) clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => {
      this._revealTimer = null;
      this._advance();
    }, delay);
  }

  _showReveal(reveal, scored) {
    this._patch({
      nvRevealVisible: true,
      nvRevealTitle: reveal.title,
      nvRevealBody: reveal.body,
      nvRevealCalc: scored ? breakdownText(scored) : '',
    });
  }

  _advance() {
    if (this._finished) return;
    this._stepIndex += 1;
    if (this._stepIndex >= SCENARIO.length) this._graduate();
    else this._renderStep();
  }

  _graduate() {
    if (this._finished) return;
    // 结业页文案全部走 i18n。body 含 {{n}} 占位符 → 整段翻译；
    // 礼包按 hint/undo/coin 三项拼接，避免文本拼接的本地化盲点。
    const bodyZh = `你已掌握单消 / 多消 / 同花 / 连击 / 清屏，训练赛累计得分 ${this._score}。真实对局采用同样的计分规则，去冲击最高分吧！`;
    const body = _t('graduate.bodyHtml', { n: this._score }, bodyZh)
      .replace(/<[^>]+>/g, ''); // wxml <text> 不渲染 HTML，剥离 <b> 等标签
    const rewardText = [
      _t('graduate.reward.title', undefined, '🎁 新手礼包'),
      [
        _t('graduate.reward.hint', undefined, '提示×2'),
        _t('graduate.reward.undo', undefined, '撤销×1'),
        _t('graduate.reward.coin', undefined, '金币×100'),
      ].join(' · '),
    ].join('：');
    this._patch({
      nvStageHidden: true,
      nvRevealVisible: false,
      nvGraduateVisible: true,
      nvGraduateScore: this._score,
      nvGraduateReward: '',
      nvGraduateTitle: _t('graduate.title', undefined, '出师啦！'),
      nvGraduateBody: body,
      nvGraduateRewardText: rewardText,
      nvGraduateCta: _t('graduate.cta', undefined, '🚀  开始挑战'),
      nvDots: SCENARIO.map(() => ({ active: false, done: true })),
    });
    try { this._audio?.play?.('unlock', { force: true }); } catch { /* ignore */ }
  }

  handleSkip() {
    this._finish({ skipped: true });
  }

  handleCta() {
    this._finish({ done: true });
  }

  _finish({ done = false, skipped = false } = {}) {
    if (this._finished) return;
    this._finished = true;
    this._clearIdleHint();
    if (this._revealTimer) {
      clearTimeout(this._revealTimer);
      this._revealTimer = null;
    }
    saveVillageState(storage, { done: done || skipped, skipped });
    this._patch({ nvClosing: true });
    setTimeout(() => {
      this._patch({ nvVisible: false, nvClosing: false });
      this._onFinish({ done, skipped });
    }, 360);
  }

  /* ── 无操作小手引导（对齐 cocos showIdleHint / web _showIdleHint） ─────── */

  /** 候选块就绪后调用：静置 NV_IDLE_HINT_DELAY_MS 无操作则启用「候选块 → 目标格」👆 滑动提示。 */
  _scheduleIdleHint() {
    this._clearIdleHint();
    if (this._finished) return;
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null;
      this._startIdleHint();
    }, NV_IDLE_HINT_DELAY_MS);
  }

  /** 取消计时与重绘循环，停止 hint 显示。 */
  _clearIdleHint() {
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
    if (this._hintRafTimer) {
      clearTimeout(this._hintRafTimer);
      this._hintRafTimer = null;
    }
    if (this._hintStartMs > 0) {
      this._hintStartMs = 0;
      this._paint();
    }
  }

  /** 启动 hint 显示：仅在等待落子 + 非自由步骤时；启动 50ms 节拍重绘循环驱动 emoji 位移。 */
  _startIdleHint() {
    if (this._finished || this._busy || this._drag || !this._awaitingPlacement) return;
    const piece = this._currentPiece();
    if (!piece?.target) return; // 自由步骤不强引导（对齐 cocos showIdleHint）
    this._hintStartMs = Date.now();
    const tick = () => {
      if (this._hintStartMs <= 0) return;
      this._paint();
      this._hintRafTimer = setTimeout(tick, 50);
    };
    tick();
  }

  /**
   * Canvas 内画 👆 emoji：相位 0~1 在「起点(候选块中心)→终点(目标格中心)」之间插值；
   * 末段按相位做 0.78× 缩小→1× 回弹，呼应 cocos 的轻按反馈。透明度按"两端淡入/淡出"包络。
   */
  _drawIdleHint(ctx) {
    if (this._hintStartMs <= 0) return;
    const piece = this._currentPiece();
    if (!piece?.target || !this._trayPieceOrigin) return;

    // 起点：候选块在 canvas 内中心
    const unit = this._cellPx + BOARD_GAP;
    const { x: tx, y: ty, piece: tp } = this._trayPieceOrigin;
    const { maxX, maxY } = _pieceExtent(tp);
    const sx = tx + ((maxX + 1) * unit - BOARD_GAP) / 2;
    const sy = ty + ((maxY + 1) * unit - BOARD_GAP) / 2;

    // 终点：目标格几何中心（piece.cells 几何中心）
    let ex = 0;
    let ey = 0;
    let n = 0;
    for (const [dx, dy] of piece.cells) {
      const cell = this._cellAt(piece.target[0] + dx, piece.target[1] + dy);
      ex += cell.x + this._cellPx / 2;
      ey += cell.y + this._cellPx / 2;
      n++;
    }
    if (!n) return;
    ex /= n;
    ey /= n;

    // 相位推进：phase ∈ [0,1)。位移区间 [0.17, 0.69]，前后留淡入淡出区。
    const elapsed = (Date.now() - this._hintStartMs) % NV_HINT_PERIOD_MS;
    const phase = elapsed / NV_HINT_PERIOD_MS;
    // 位移 t：起点段 stay→ 滑动 → 终点段 stay。
    let moveT;
    if (phase < 0.17) moveT = 0;
    else if (phase < 0.46) moveT = (phase - 0.17) / 0.29;       // 滑向终点
    else moveT = 1;                                              // 在终点 stay
    // sineInOut 缓动，呼应 cocos easing:'sineInOut'
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, moveT)));
    const cx = sx + (ex - sx) * eased;
    const cy = sy + (ey - sy) * eased;
    // 末段按压缩放（0.46~0.60 缩小，0.60~0.74 回弹）
    let scale = 1;
    if (phase >= 0.46 && phase < 0.60) scale = 1 - 0.22 * ((phase - 0.46) / 0.14);
    else if (phase >= 0.60 && phase < 0.74) scale = 0.78 + 0.22 * ((phase - 0.60) / 0.14);
    // 透明度：起点淡入(0~0.14)、中段满显、末段淡出(0.88~1)
    let alpha;
    if (phase < 0.14) alpha = phase / 0.14;
    else if (phase < 0.88) alpha = 1;
    else alpha = Math.max(0, 1 - (phase - 0.88) / 0.12);

    ctx.save();
    ctx.globalAlpha = 0.92 * alpha;
    ctx.font = `bold ${Math.round(28 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillText('👆', cx, cy);
    ctx.restore();
  }
}

let _active = null;

function shouldShowNewbieVillage({ controller, force = false, skip = false } = {}) {
  const profile = controller?.getPlayerProfileRef?.() || controller?.playerProfile || null;
  const lifetimeGames = Number(profile?.lifetimeGames);
  const game = Number.isFinite(lifetimeGames) ? { playerProfile: { lifetimeGames } } : {};
  return shouldShowNewbieVillageCore({ game, storage, force, skip });
}

/**
 * 首登则展示新手村，否则立即返回。
 * @returns {Promise<boolean>}
 */
async function runNewbieVillageIfFirstLogin({
  controller = null,
  audio = null,
  setData,
  getCanvasNode,
} = {}) {
  try {
    if (!shouldShowNewbieVillage({ controller })) return false;
    if (_active) return false;
    if (typeof setData !== 'function' || typeof getCanvasNode !== 'function') return false;

    const profile = controller?.getPlayerProfileRef?.() || null;
    const lifetimeGames = Number(profile?.lifetimeGames) || 0;

    return await new Promise((resolve) => {
      _active = new NewbieVillageSession({
        setData,
        getCanvasNode,
        audio,
        lifetimeGames,
        onFinish: () => {
          _active = null;
          resolve(true);
        },
      });
      _active.mount().catch(() => {
        _active = null;
        resolve(false);
      });
    });
  } catch (e) {
    try { console.warn('[newbieVillage] 跳过（异常）:', e); } catch { /* ignore */ }
    _active = null;
    return false;
  }
}

function getActiveSession() {
  return _active;
}

module.exports = {
  NEWBIE_VILLAGE_STORAGE_KEY,
  shouldShowNewbieVillage,
  runNewbieVillageIfFirstLogin,
  getActiveSession,
};
