/**
 * NewbieVillage.ts — Cocos 新手村（首登 5 课交互引导，对齐 web newbieVillage.js）
 */
import {
    _decorator, Component, Node, Graphics, Label, UITransform, Color, UIOpacity,
    input, Input, EventTouch, Vec3, tween, view,
} from 'cc';
import { Wallet } from '../../core';
import { Storage } from '../platform/Storage';
import { Modal, button, label, inheritLayer, screenToLocal } from './uiKit';
import { Motion } from '../platform/Motion';
import { hexToColor } from '../skin/palette';
import { AudioManager } from '../audio/AudioManager';
import { Haptics } from '../platform/Haptics';
// @ts-ignore 引擎同步纯逻辑
import {
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
    NEWBIE_VILLAGE_STORAGE_KEY,
} from '../../engine/onboarding/newbieVillageCore.mjs';

const { ccclass } = _decorator;

const BOARD_PAD = 10;
const BOARD_GAP = 4;

type NvBoard = (number | null)[][];
interface NvPiece {
    shapeId: string;
    cells: [number, number][];
    colorIdx: number;
    target?: [number, number];
}

export interface NewbieVillageOpts {
    parent: Node;
    game?: { playerProfile?: { lifetimeGames?: number } };
    wallet?: Wallet;
}

const storageAdapter = {
    getItem: (k: string) => Storage.get(k, null),
    setItem: (k: string, v: string) => { Storage.set(k, v); },
};

export function shouldShowNewbieVillage(opts: NewbieVillageOpts): boolean {
    const decision = shouldShowNewbieVillageCore({
        game: opts.game,
        storage: storageAdapter,
    });
    // 诊断日志（logcat / 浏览器控制台过滤 [NewbieVillage]）：一眼看出未触发的原因。
    const raw = storageAdapter.getItem(NEWBIE_VILLAGE_STORAGE_KEY);
    console.log(
        `[NewbieVillage] shouldShow=${decision} lifetimeGames=${opts.game?.playerProfile?.lifetimeGames} `
        + `storedState=${raw ?? 'null'} active=${_active != null}`,
    );
    return decision;
}

let _active: NewbieVillagePanel | null = null;

/** 首登则展示新手村；结束时 resolve，永不抛错。 */
export function runIfFirstLogin(opts: NewbieVillageOpts): Promise<boolean> {
    try {
        if (!shouldShowNewbieVillage(opts)) return Promise.resolve(false);
        if (_active) return Promise.resolve(false);
        return new Promise((resolve) => {
            const root = new Node('NewbieVillage');
            root.parent = opts.parent;
            root.layer = opts.parent.layer;
            root.setSiblingIndex(9999);
            inheritLayer(root, opts.parent);
            const comp = root.addComponent(NewbieVillagePanel);
            _active = comp;
            comp.setup({
                wallet: opts.wallet,
                onFinish: () => {
                    _active = null;
                    resolve(true);
                },
            });
        });
    } catch (e) {
        console.warn('[NewbieVillage] skip (error):', e);
        return Promise.resolve(false);
    }
}

@ccclass('NewbieVillagePanel')
class NewbieVillagePanel extends Component {
    private _wallet: Wallet | null = null;
    private _onFinish: (() => void) | null = null;
    private _stepIndex = 0;
    private _score = 0;
    private _comboCount = 0;
    private _roundsSinceClear = Infinity;
    private _board: NvBoard = emptyNvBoard();
    private _queue: NvPiece[] = [];
    private _queueIdx = 0;
    private _lastScored: ReturnType<typeof scorePlacement> | null = null;
    private _cellPx = 32;
    private _busy = false;
    private _finished = false;
    private _awaitingPlacement = false;
    private _drag: { piece: NvPiece; grabX: number; grabY: number } | null = null;

    private _boardG!: Graphics;
    private _boardNode!: Node;
    private _trayNode!: Node;
    private _pieceNode: Node | null = null;
    private _coachTitle!: Label;
    private _coachBody!: Label;
    private _coachIcon!: Label;
    private _scoreLbl!: Label;
    private _comboLbl!: Label;
    private _revealNode!: Node;
    private _revealTitle!: Label;
    private _revealBody!: Label;
    private _revealCalc!: Label;
    private _dots: Node[] = [];
    private _stageNode!: Node;
    private _bannerLbl: Label | null = null;

    setup(opts: { wallet?: Wallet; onFinish: () => void }): void {
        this._wallet = opts.wallet ?? null;
        this._onFinish = opts.onFinish;
        this._cellPx = this.computeCellPx();
        Modal.open();
        this.buildUi();
        this.renderStep();
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        if (!Motion.reduced) {
            const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
            op.opacity = 0;
            tween(op).to(0.35, { opacity: 255 }, { easing: 'cubicOut' }).start();
        }
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        Modal.close();
    }

    private computeCellPx(): number {
        // 自适应可见宽高：高屏放大棋格填充空间，矮屏收缩避免溢出。
        const vs = view.getVisibleSize();
        const byW = (vs.width - 72 - BOARD_PAD * 2) / COLS;
        const byH = (vs.height - 540) / ROWS;
        return Math.max(28, Math.min(58, Math.floor(Math.min(byW, byH))));
    }

    /** 约束 Label 宽度 + 对齐 + 是否换行（正文卡内自动换行用）。 */
    private constrainLabel(l: Label, width: number, align: number, wrap: boolean): void {
        const uit = l.node.getComponent(UITransform);
        if (!uit) return;
        uit.setContentSize(width, l.lineHeight);
        l.horizontalAlign = align;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        l.enableWrapText = wrap;
        l.overflow = wrap ? Label.Overflow.RESIZE_HEIGHT : Label.Overflow.CLAMP;
    }

    private buildUi(): void {
        // 取真实可见尺寸（FIXED_WIDTH：宽≈720，高随设备比例可达 1600+）。
        // 沉浸式铺底必须按可见高度铺满，否则高屏上下会露出底层游戏 UI。
        const vs = view.getVisibleSize();
        const halfW = vs.width / 2;
        const halfH = vs.height / 2;
        const overscan = 120;

        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(vs.width, vs.height);
        uit.setAnchorPoint(0.5, 0.5);

        const bg = new Node('Bg');
        bg.parent = this.node;
        inheritLayer(bg, this.node);
        const bgG = bg.addComponent(Graphics);
        // 不透明深底，铺满整屏 + 过扫，完全遮住下层盘面/技能栏。
        bgG.fillColor = new Color(8, 11, 18, 255);
        bgG.rect(-halfW - overscan, -halfH - overscan, vs.width + overscan * 2, vs.height + overscan * 2);
        bgG.fill();
        // 顶部加一层渐变氛围带，呼应 web 主端沉浸感。
        bgG.fillColor = new Color(14, 21, 36, 255);
        bgG.rect(-halfW - overscan, halfH - 220, vs.width + overscan * 2, 220 + overscan);
        bgG.fill();

        // ── 垂直栈整体居中 ──────────────────────────────────────────────
        // 标题 → 进度点 → 教练卡 → 总分 → 盘面 → 候选区 作为一个整体在可见区纵向居中，
        // 避免「头部贴顶 + 中间大空档」。所有 Y 由统一游标 cy 自顶向下推算。
        const bw = COLS * this._cellPx + (COLS - 1) * BOARD_GAP + BOARD_PAD * 2;
        const bh = ROWS * this._cellPx + (ROWS - 1) * BOARD_GAP + BOARD_PAD * 2;
        const boardCenterY = 40;                  // 盘面节点在 stage 内的相对位置（拖拽几何依赖此值不变）
        const boardTopY = boardCenterY + bh / 2;  // stage 相对：盘面面板顶
        const coachH = 118;
        const trayH = 100;
        const titleH = 26;
        const dotsH = 12;
        const gTitle = 14;
        const gDots = 20;
        const gCoach = 14;
        const coachTopToPanelTop = coachH + gCoach + 36; // 36：总分标签（面板顶上方 26 + 半高）占位
        const headerH = titleH + gTitle + dotsH + gDots;
        const clusterH = coachTopToPanelTop + bh + 50 + trayH / 2;
        let cy = Math.min((headerH + clusterH) / 2, halfH - 36);
        const titleY = cy - titleH / 2; cy -= titleH + gTitle;
        const dotsY = cy - dotsH / 2; cy -= dotsH + gDots;
        const coachCenterY = cy - coachH / 2;
        const panelTopAbs = (coachCenterY + coachH / 2) - coachTopToPanelTop;
        const stageY = (panelTopAbs - bh / 2) - boardCenterY;

        // 顶部：标题 / 跳过 / 进度点
        label(this.node, '🏕️ 新手村', 18, 0, titleY, new Color(241, 245, 249, 255));
        const skipBtn = button(this.node, '跳过引导', halfW - 78, titleY, 13, () => this.finish({ skipped: true }),
            new Color(148, 163, 184, 80), { minWidth: 120, radius: 18 });
        skipBtn.node.name = 'SkipBtn';

        const dotRow = new Node('Dots');
        dotRow.parent = this.node;
        dotRow.setPosition(0, dotsY, 0);
        inheritLayer(dotRow, this.node);
        const dotStep = 16;
        const dotStart = -((SCENARIO.length - 1) * dotStep) / 2;
        for (let i = 0; i < SCENARIO.length; i++) {
            const d = new Node(`dot${i}`);
            d.parent = dotRow;
            d.setPosition(dotStart + i * dotStep, 0, 0);
            d.addComponent(UITransform).setContentSize(9, 9);
            d.addComponent(Graphics);
            this._dots.push(d);
        }

        // 教练卡：图标(左上) + 标题(顶部居中) + 正文(卡内自动换行居中)
        const coach = new Node('Coach');
        coach.parent = this.node;
        coach.setPosition(0, coachCenterY, 0);
        inheritLayer(coach, this.node);
        const cardW = 560;
        coach.addComponent(UITransform).setContentSize(cardW, coachH);
        const coachG = coach.addComponent(Graphics);
        coachG.fillColor = new Color(30, 41, 59, 235);
        coachG.roundRect(-cardW / 2, -coachH / 2, cardW, coachH, 16);
        coachG.fill();
        coachG.strokeColor = new Color(56, 189, 248, 72);
        coachG.lineWidth = 1;
        coachG.roundRect(-cardW / 2, -coachH / 2, cardW, coachH, 16);
        coachG.stroke();
        this._coachIcon = label(coach, '', 24, -cardW / 2 + 30, coachH / 2 - 26, Color.WHITE);
        this._coachTitle = label(coach, '', 15, 14, coachH / 2 - 26, new Color(241, 245, 249, 255));
        this.constrainLabel(this._coachTitle, cardW - 96, Label.HorizontalAlign.LEFT, false);
        this._coachBody = label(coach, '', 12.5, 0, -8, new Color(226, 232, 240, 225));
        this.constrainLabel(this._coachBody, cardW - 52, Label.HorizontalAlign.CENTER, true);

        // 舞台（盘面+总分+候选区），整体随 stageY 定位
        this._stageNode = new Node('Stage');
        this._stageNode.parent = this.node;
        this._stageNode.setPosition(0, stageY, 0);
        inheritLayer(this._stageNode, this.node);

        // 分数/连击标签置于盘面面板正上方，避免压到顶行棋格。
        this._scoreLbl = label(this._stageNode, '总分 0', 16, -70, boardTopY + 26, new Color(251, 191, 36, 255));
        this._comboLbl = label(this._stageNode, '', 14, 80, boardTopY + 26, new Color(251, 113, 133, 255));
        this._comboLbl.node.active = false;

        this._boardNode = new Node('Board');
        this._boardNode.parent = this._stageNode;
        this._boardNode.setPosition(0, boardCenterY, 0);
        inheritLayer(this._boardNode, this._stageNode);
        this._boardNode.addComponent(UITransform).setContentSize(bw, bh);
        const boardBg = this._boardNode.addComponent(Graphics);
        boardBg.fillColor = new Color(15, 23, 42, 230);
        boardBg.roundRect(-bw / 2, -bh / 2, bw, bh, 16);
        boardBg.fill();
        boardBg.strokeColor = new Color(148, 163, 184, 46);
        boardBg.lineWidth = 1;
        boardBg.roundRect(-bw / 2, -bh / 2, bw, bh, 16);
        boardBg.stroke();
        this._boardG = this._boardNode.addComponent(Graphics);

        this._trayNode = new Node('Tray');
        this._trayNode.parent = this._stageNode;
        this._trayNode.setPosition(0, -bh / 2 - 50, 0);
        inheritLayer(this._trayNode, this._stageNode);
        this._trayNode.addComponent(UITransform).setContentSize(400, trayH);

        this._revealNode = new Node('Reveal');
        this._revealNode.parent = this.node;
        this._revealNode.setPosition(0, -halfH + 120, 0);
        this._revealNode.active = false;
        inheritLayer(this._revealNode, this.node);
        const rvG = this._revealNode.addComponent(Graphics);
        rvG.fillColor = new Color(16, 32, 28, 240);
        rvG.roundRect(-270, -55, 540, 110, 16);
        rvG.fill();
        rvG.strokeColor = new Color(52, 211, 153, 100);
        rvG.lineWidth = 1;
        rvG.roundRect(-270, -55, 540, 110, 16);
        rvG.stroke();
        this._revealTitle = label(this._revealNode, '', 15, 0, 28, new Color(110, 231, 183, 255));
        this._revealBody = label(this._revealNode, '', 13, 0, 0, new Color(209, 250, 229, 230));
        this._revealCalc = label(this._revealNode, '', 12.5, 0, -28, new Color(253, 230, 138, 255));
    }

    private paletteColor(idx: number): Color {
        return hexToColor(PALETTE[idx % PALETTE.length] || '#38bdf8');
    }

    private boardOrigin(): { ox: number; oy: number } {
        const unit = this._cellPx + BOARD_GAP;
        const bw = COLS * this._cellPx + (COLS - 1) * BOARD_GAP;
        const bh = ROWS * this._cellPx + (ROWS - 1) * BOARD_GAP;
        return { ox: -bw / 2, oy: bh / 2 };
    }

    private cellRect(col: number, row: number): { x: number; y: number; s: number } {
        const { ox, oy } = this.boardOrigin();
        const unit = this._cellPx + BOARD_GAP;
        return {
            x: ox + BOARD_PAD + col * unit,
            y: oy - BOARD_PAD - (row + 1) * this._cellPx - row * BOARD_GAP,
            s: this._cellPx,
        };
    }

    private paintBoard(ghost?: { ok: boolean; cells: [number, number][] } | null): void {
        const g = this._boardG;
        g.clear();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const { x, y, s } = this.cellRect(c, r);
                const idx = this._board[r][c];
                if (idx !== null) {
                    g.fillColor = this.paletteColor(idx);
                    g.roundRect(x, y, s, s, 6);
                    g.fill();
                    g.fillColor = new Color(255, 255, 255, 60);
                    g.roundRect(x, y + s * 0.7, s, s * 0.3, 4);
                    g.fill();
                } else {
                    g.fillColor = new Color(148, 163, 184, 20);
                    g.roundRect(x, y, s, s, 6);
                    g.fill();
                }
            }
        }
        const piece = this._queue[this._queueIdx];
        if (piece?.target && this._awaitingPlacement) {
            for (const [dx, dy] of piece.cells) {
                const tc = piece.target[0] + dx;
                const tr = piece.target[1] + dy;
                const { x, y, s } = this.cellRect(tc, tr);
                g.strokeColor = new Color(56, 189, 248, 220);
                g.lineWidth = 2;
                g.roundRect(x, y, s, s, 6);
                g.stroke();
            }
        }
        if (ghost) {
            for (const [dx, dy] of ghost.cells) {
                const { x, y, s } = this.cellRect(dx, dy);
                g.fillColor = ghost.ok
                    ? new Color(56, 189, 248, 90)
                    : new Color(248, 113, 113, 70);
                g.roundRect(x, y, s, s, 6);
                g.fill();
            }
        }
    }

    private renderStep(): void {
        const step = SCENARIO[this._stepIndex];
        if (!step) { this.graduate(); return; }
        this._board = step.seed() as NvBoard;
        this._queue = step.pieces.slice() as NvPiece[];
        this._queueIdx = 0;
        this._comboCount = 0;
        this._roundsSinceClear = Infinity;
        this._lastScored = null;
        this._awaitingPlacement = true;
        this._coachIcon.string = step.coach.icon;
        this._coachTitle.string = step.coach.title;
        this._coachBody.string = step.coach.body.replace(/\*\*/g, '');
        this._scoreLbl.string = `总分 ${this._score}`;
        this.updateComboBadge();
        this._revealNode.active = false;
        this._dots.forEach((d, i) => {
            const dg = d.getComponent(Graphics)!;
            dg.clear();
            const active = i === this._stepIndex;
            const done = i < this._stepIndex;
            dg.fillColor = done
                ? new Color(52, 211, 153, 255)
                : active
                    ? new Color(56, 189, 248, 255)
                    : new Color(148, 163, 184, 80);
            dg.circle(0, 0, 4.5);
            dg.fill();
        });
        this.paintBoard();
        this.buildTray(this._queue[0]);
    }

    private pieceExtent(piece: NvPiece): { maxX: number; maxY: number } {
        let maxX = 0;
        let maxY = 0;
        for (const [x, y] of piece.cells) {
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        return { maxX, maxY };
    }

    private buildTray(piece: NvPiece | undefined): void {
        this._pieceNode?.destroy();
        this._pieceNode = null;
        if (!piece) return;
        const el = new Node('Piece');
        el.parent = this._trayNode;
        inheritLayer(el, this._trayNode);
        el.setPosition(0, 0, 0);
        const { maxX, maxY } = this.pieceExtent(piece);
        const pw = (maxX + 1) * this._cellPx + maxX * BOARD_GAP + 20;
        const ph = (maxY + 1) * this._cellPx + maxY * BOARD_GAP + 20;
        el.addComponent(UITransform).setContentSize(pw, ph);
        const pg = el.addComponent(Graphics);
        const filled = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
        const unit = this._cellPx + BOARD_GAP;
        for (let y = 0; y <= maxY; y++) {
            for (let x = 0; x <= maxX; x++) {
                if (!filled.has(`${x},${y}`)) continue;
                const px = (x - (maxX + 1) / 2) * unit + unit / 2;
                const py = ((maxY + 1) / 2 - y - 1) * unit + unit / 2;
                pg.fillColor = this.paletteColor(piece.colorIdx);
                pg.roundRect(px - this._cellPx / 2, py - this._cellPx / 2, this._cellPx, this._cellPx, 6);
                pg.fill();
            }
        }
        this._pieceNode = el;
    }

    private onTouchStart(e: EventTouch): void {
        if (this._finished || this._busy || !this._awaitingPlacement || this._drag || !this._pieceNode) return;
        // ⚠️ 必须用 getLocation()（屏幕像素），screenToLocal 内部走 cam.screenToWorld；
        // 误用 getUILocation()（UI 空间）会让命中测试坐标系错位 → 完全拖不动（与主盘面同一约定）。
        const loc = e.getLocation();
        if (!this.hitNode(this._pieceNode, loc.x, loc.y)) return;
        const piece = this._queue[this._queueIdx];
        if (!piece) return;
        this.onPieceTouchStart(e, piece);
    }

    private onPieceTouchStart(e: EventTouch, piece: NvPiece): void {
        const loc = e.getLocation();
        const local = screenToLocal(this._stageNode, loc.x, loc.y);
        this._drag = { piece, grabX: local.x, grabY: local.y };
        if (this._pieceNode) {
            this._pieceNode.setPosition(local.x, local.y, 0);
            this._pieceNode.parent = this._stageNode;
        }
        try { AudioManager.sfxPlace(); } catch { /* ignore */ }
    }

    private hitNode(node: Node, sx: number, sy: number): boolean {
        const uit = node.getComponent(UITransform);
        if (!uit || !node.activeInHierarchy) return false;
        const local = screenToLocal(node, sx, sy);
        const hw = uit.contentSize.width / 2;
        const hh = uit.contentSize.height / 2;
        return local.x >= -hw && local.x <= hw && local.y >= -hh && local.y <= hh;
    }

    private onTouchMove(e: EventTouch): void {
        const d = this._drag;
        if (!d || !this._pieceNode) return;
        const loc = e.getLocation();
        const local = screenToLocal(this._stageNode, loc.x, loc.y);
        this._pieceNode.setPosition(local.x, local.y, 0);
        if (d.piece.target) {
            const cells: [number, number][] = [];
            const [ox, oy] = d.piece.target;
            for (const [dx, dy] of d.piece.cells) cells.push([ox + dx, oy + dy]);
            this.paintBoard({ ok: true, cells });
        } else {
            const origin = this.originFromLocal(local.x - d.grabX, local.y - d.grabY);
            if (origin) {
                const cells: [number, number][] = [];
                const [ox, oy] = origin;
                for (const [dx, dy] of d.piece.cells) cells.push([ox + dx, oy + dy]);
                this.paintBoard({ ok: isPlacementValid(this._board, d.piece, origin), cells });
            } else {
                this.paintBoard();
            }
        }
    }

    private onTouchEnd(e: EventTouch): void {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        const loc = e.getLocation();
        const local = screenToLocal(this._stageNode, loc.x, loc.y);
        const origin = this.tryPlacementOrigin(d.piece);
        this.paintBoard();
        if (origin) {
            this.commitPlacement(d.piece, origin);
        } else {
            this.resetPieceToTray(d.piece);
            try { AudioManager.sfxInvalid(); } catch { /* ignore */ }
        }
    }

    private onTouchCancel(): void {
        if (!this._drag) return;
        const piece = this._drag.piece;
        this._drag = null;
        this.resetPieceToTray(piece);
        this.paintBoard();
    }

    private resetPieceToTray(piece: NvPiece): void {
        if (this._pieceNode) {
            this._pieceNode.parent = this._trayNode;
            this._pieceNode.setPosition(0, 0, 0);
        } else {
            this.buildTray(piece);
        }
    }

    private screenToNode(node: Node, sx: number, sy: number): Vec3 {
        return screenToLocal(node, sx, sy);
    }

    private originFromLocal(left: number, top: number): [number, number] | null {
        const { ox, oy } = this.boardOrigin();
        const unit = this._cellPx + BOARD_GAP;
        const col = Math.round((left - ox - BOARD_PAD) / unit);
        const row = Math.round((oy - BOARD_PAD - top - this._cellPx) / unit);
        if (col < -1 || row < -1 || col > COLS || row > ROWS) return null;
        return [col, row];
    }

    private tryPlacementOrigin(piece: NvPiece): [number, number] | null {
        if (piece.target && isPlacementValid(this._board, piece, piece.target)) {
            return piece.target;
        }
        return null;
    }

    private commitPlacement(piece: NvPiece, origin: [number, number]): void {
        this._awaitingPlacement = false;
        const [ox, oy] = origin;
        for (const [dx, dy] of piece.cells) this._board[oy + dy][ox + dx] = piece.colorIdx;
        this._pieceNode?.destroy();
        this._pieceNode = null;
        this.paintBoard();
        try { AudioManager.sfxPlace(); Haptics.light(); } catch { /* ignore */ }

        const cleared = computeClears(this._board).lines > 0;
        this._comboCount = deriveNextComboCount(this._comboCount, this._roundsSinceClear, cleared);
        this._roundsSinceClear = cleared ? 0 : this._roundsSinceClear + 1;

        if (cleared) {
            const scored = scorePlacement(this._board, this._comboCount);
            this._lastScored = scored;
            this._score += scored.score.clearScore;
            this._busy = true;
            this.runClear(piece, scored);
        } else {
            this._busy = true;
            this.scheduleOnce(() => { this._busy = false; this.afterPlacement(); }, 0.46);
        }
    }

    private runClear(piece: NvPiece, scored: ReturnType<typeof scorePlacement>): void {
        const { result, score } = scored;
        const lines = result.count;
        const mono = (result.bonusLines || []).length > 0;
        const comboMult = score.comboMultiplier;
        const perfect = scored.perfect;

        if (perfect) this.showBanner(`PERFECT ×${PERFECT_CLEAR_MULT}`, 'perfect');
        else if (comboMult > 1) this.showBanner(`COMBO ♥${this._comboCount} ×${comboMult}`, 'combo');
        else if (mono) this.showBanner(`同花 BONUS ×${ICON_BONUS_LINE_MULT}`, 'mono');
        else if (lines >= 2) this.showBanner(`多消 ×${lines}`, 'multi');

        const strong = perfect || comboMult > 1 || mono || lines >= 2;
        try {
            if (strong) AudioManager.sfxCombo(this._comboCount);
            else AudioManager.sfxClear(lines);
            if (strong) Haptics.medium();
        } catch { /* ignore */ }

        this.floatScore(score.clearScore);

        this.scheduleOnce(() => {
            this._board = scored.afterBoard as NvBoard;
            this.paintBoard();
            this._scoreLbl.string = `总分 ${this._score}`;
            this.updateComboBadge();
            this._busy = false;
            this.afterPlacement();
        }, 0.46);
    }

    private afterPlacement(): void {
        if (this._finished) return;
        this._queueIdx += 1;
        if (this._queueIdx < this._queue.length) {
            this._awaitingPlacement = true;
            this.buildTray(this._queue[this._queueIdx]);
            this.paintBoard();
            return;
        }
        const step = SCENARIO[this._stepIndex];
        if (step?.reveal) this.showReveal(step.reveal, this._lastScored);
        this.scheduleOnce(() => this.advance(), step?.reveal ? 2.7 : 0.7);
    }

    private advance(): void {
        if (this._finished) return;
        this._stepIndex += 1;
        if (this._stepIndex >= SCENARIO.length) this.graduate();
        else this.renderStep();
    }

    private updateComboBadge(): void {
        if (this._comboCount > 0) {
            const mult = this._lastScored?.score?.comboMultiplier || 1;
            this._comboLbl.string = mult > 1 ? `♥${this._comboCount} ×${mult}` : `♥${this._comboCount}`;
            this._comboLbl.node.active = true;
        } else {
            this._comboLbl.node.active = false;
        }
    }

    private showBanner(text: string, _variant: string): void {
        this._bannerLbl?.node.destroy();
        const n = new Node('Banner');
        n.parent = this._stageNode;
        n.setPosition(0, 120, 0);
        inheritLayer(n, this._stageNode);
        this._bannerLbl = label(n, text, 28, 0, 0, Color.WHITE);
        this._bannerLbl.color = _variant === 'perfect'
            ? new Color(253, 230, 138, 255)
            : _variant === 'mono'
                ? new Color(167, 243, 208, 255)
                : Color.WHITE;
        if (!Motion.reduced) {
            n.setScale(0.4, 0.4, 1);
            tween(n).to(0.35, { scale: new Vec3(1.1, 1.1, 1) }).to(0.65, { scale: new Vec3(1, 1, 1) }).start();
            tween(n.getComponent(UIOpacity) || n.addComponent(UIOpacity))
                .delay(0.7).to(0.3, { opacity: 0 }).call(() => n.destroy()).start();
        } else {
            this.scheduleOnce(() => n.destroy(), 1);
        }
    }

    private floatScore(amount: number): void {
        const n = new Node('Float');
        n.parent = this._stageNode;
        n.setPosition(0, 40, 0);
        inheritLayer(n, this._stageNode);
        const l = label(n, `+${amount}`, 26, 0, 0, new Color(251, 191, 36, 255));
        if (!Motion.reduced) {
            tween(n).by(1.2, { position: new Vec3(0, 72, 0) }).start();
            tween(l.node.getComponent(UIOpacity) || l.node.addComponent(UIOpacity))
                .delay(0.2).to(1, { opacity: 0 }).call(() => n.destroy()).start();
        } else {
            this.scheduleOnce(() => n.destroy(), 1);
        }
    }

    private showReveal(reveal: { title: string; body: string }, scored: ReturnType<typeof scorePlacement> | null): void {
        this._revealNode.active = true;
        this._revealTitle.string = reveal.title;
        this._revealBody.string = reveal.body;
        this._revealCalc.string = scored ? breakdownText(scored) : '';
    }

    private grantReward(): string {
        try {
            const w = this._wallet;
            if (!w) return '';
            w.addBalance('hintToken', 2, 'newbie_village');
            w.addBalance('undoToken', 1, 'newbie_village');
            w.addBalance('coin', 100, 'newbie_village');
            return '提示×2 · 撤销×1 · 金币×100';
        } catch {
            return '';
        }
    }

    private graduate(): void {
        if (this._finished) return;
        const reward = this.grantReward();
        this._stageNode.active = false;
        this._revealNode.active = false;
        this.node.getChildByName('Coach')!.active = false;
        this._dots.forEach((d) => {
            const dg = d.getComponent(Graphics)!;
            dg.clear();
            dg.fillColor = new Color(52, 211, 153, 255);
            dg.circle(0, 0, 4.5);
            dg.fill();
        });

        const card = new Node('Graduate');
        card.parent = this.node;
        card.setPosition(0, 0, 0);
        inheritLayer(card, this.node);
        label(card, '🎉', 58, 0, 120, Color.WHITE);
        label(card, '出师啦！', 23, 0, 50, new Color(241, 245, 249, 255));
        label(card,
            `你已掌握 单消 / 多消 / 同花 / 连击 / 清屏，\n训练赛累计得分 ${this._score}。真实对局采用同样计分规则！`,
            14, 0, -10, new Color(226, 232, 240, 220));
        if (reward) {
            label(card, `🎁 新手礼包：${reward}`, 14, 0, -70, new Color(253, 230, 138, 255));
        }
        button(card, '开始游戏', 0, -140, 15, () => this.finish({ done: true }),
            new Color(56, 189, 248, 255), { primary: true, minWidth: 200 });
        try { AudioManager.sfxUnlock(); } catch { /* ignore */ }
    }

    private finish(opts: { done?: boolean; skipped?: boolean } = {}): void {
        if (this._finished) return;
        this._finished = true;
        saveVillageState(storageAdapter, { done: !!(opts.done || opts.skipped), skipped: !!opts.skipped });
        const done = this._onFinish;
        this._onFinish = null;
        if (!Motion.reduced) {
            const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
            tween(op).to(0.36, { opacity: 0 }).call(() => {
                done?.();
                if (this.node?.isValid) this.node.destroy();
            }).start();
        } else {
            done?.();
            if (this.node?.isValid) this.node.destroy();
        }
    }
}

export { NEWBIE_VILLAGE_STORAGE_KEY };
