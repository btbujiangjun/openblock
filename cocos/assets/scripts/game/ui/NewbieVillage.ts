/**
 * NewbieVillage.ts — Cocos 新手村（首登 5 课交互引导，对齐 web newbieVillage.js）
 */
import {
    _decorator, Component, Node, Graphics, Label, UITransform, Color, UIOpacity,
    input, Input, EventTouch, Vec3, tween, view, Tween,
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

// 高频路径（paintCells / paintTarget / paintGhost 每次拖动都调）共用色常量 ——
// 复用 Color 实例，避免每帧 `new Color()` 触发 GC。
const NV_HIGHLIGHT = new Color(255, 255, 255, 64);
const NV_EMPTY_FILL = new Color(148, 163, 184, 20);
const NV_TARGET_FILL = new Color(56, 189, 248, 60);
const NV_TARGET_STROKE = new Color(56, 189, 248, 220);
const NV_GHOST_OK_FILL = new Color(56, 189, 248, 90);
const NV_GHOST_OK_STROKE = new Color(56, 189, 248, 230);
const NV_GHOST_BAD_FILL = new Color(248, 113, 113, 64);
const NV_GHOST_BAD_STROKE = new Color(248, 113, 113, 200);

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

    // 联机调试计数（限流，避免 logcat 刷屏）
    private _dbgTouchCount = 0;
    private _dbgMoveCount = 0;

    private _boardG!: Graphics;
    private _targetG!: Graphics;
    private _targetNode!: Node;
    private _clearFxG!: Graphics;
    private _clearFxNode!: Node;
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
    // 无操作引导：静置一段时间后，手指图标从候选块循环滑向目标格，提示玩家「按住拖到这里」。
    private _hintNode: Node | null = null;
    private readonly _hintFn = (): void => this.showIdleHint();

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
        const vs = view.getVisibleSize();
        // mount 时打印关键节点 worldPosition，诊断渲染坐标 vs hit-test 坐标的一致性
        const rwp = this.node.worldPosition;
        const swp = this._stageNode.worldPosition;
        const twp = this._trayNode.worldPosition;
        const bwp = this._boardNode.worldPosition;
        const pwp = this._pieceNode?.worldPosition;
        console.log(
            `[NewbieVillage] mounted cellPx=${this._cellPx} cols=${COLS} rows=${ROWS} `
            + `visible=${vs.width.toFixed(0)}x${vs.height.toFixed(0)} `
            + `rootUit=${this.node.getComponent(UITransform)?.contentSize.width.toFixed(0)}x${this.node.getComponent(UITransform)?.contentSize.height.toFixed(0)} `
            + `modalOpen=${(() => { try { return Modal.isOpen() ? 1 : 0; } catch { return -1; } })()}`,
        );
        console.log(
            `[NewbieVillage] worldPos root=(${rwp.x.toFixed(0)},${rwp.y.toFixed(0)}) `
            + `stage=(${swp.x.toFixed(0)},${swp.y.toFixed(0)}) `
            + `board=(${bwp.x.toFixed(0)},${bwp.y.toFixed(0)}) `
            + `tray=(${twp.x.toFixed(0)},${twp.y.toFixed(0)}) `
            + `piece=(${pwp?.x.toFixed(0) ?? '?'},${pwp?.y.toFixed(0) ?? '?'})`,
        );
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
        this.clearIdleHint();
        Modal.close();
    }

    private computeCellPx(): number {
        // 全屏盘面：对齐主界面「盘面占满可见宽（仅留 ~12px 边距）」的口径，cell 由宽度主导放大，
        // 让新手村棋盘和真实对局一样铺满，不再是中间一小块。矮屏时退回按高度收缩避免溢出。
        // 计入格间隙与内边距，使 bw = COLS*cell + (COLS-1)*GAP + PAD*2 ≈ 可见宽 - 2*边距。
        const vs = view.getVisibleSize();
        const sideMargin = 12;
        const byW = (vs.width - sideMargin * 2 - BOARD_PAD * 2 - (COLS - 1) * BOARD_GAP) / COLS;
        // 纵向预算：标题+进度点+教练卡(~250) + 总分(40) + 候选区(130) + 上下余量 ≈ 480。
        const byH = (vs.height - 480 - BOARD_PAD * 2 - (ROWS - 1) * BOARD_GAP) / ROWS;
        return Math.max(34, Math.min(92, Math.floor(Math.min(byW, byH))));
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
        // ⚠️ 不能加 BlockInputEvents：Cocos 3.x 该组件会吞掉「全局 input.on(TOUCH_*)」事件 ——
        // 新手村自身的拖拽监听就会收不到 START/MOVE/END，表现为「完全拖不动」。
        // 主局触摸拦截仅依靠 `Modal.open()` 即可（见 GameController.onTouchStart 内 Modal.isOpen() 守卫）。

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
        // 教练正文（不支持 RichText 时退化为 Label；**bold** 强调会被去除符号但用更亮色统一显示）
        this._coachBody = label(coach, '', 12.5, 0, -8, new Color(252, 211, 77, 235));
        this.constrainLabel(this._coachBody, cardW - 52, Label.HorizontalAlign.CENTER, true);

        // 舞台（盘面+总分+候选区），整体随 stageY 定位。
        // ⚠️ 必须给 stageNode 加 UITransform：拖拽几何走 `screenToLocal(stageNode, ...)`，
        // 而 screenToLocal 对没 UITransform 的节点直接返回 (0,0)，会导致 piece 不跟手 + origin 永远算错 → 完全拖不动。
        this._stageNode = new Node('Stage');
        this._stageNode.parent = this.node;
        this._stageNode.setPosition(0, stageY, 0);
        inheritLayer(this._stageNode, this.node);
        this._stageNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

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

        // Target 高亮层（独立节点 + UIOpacity，循环脉冲 0.45→1.0），对齐 web `.is-target` 动画
        this._targetNode = new Node('TargetOverlay');
        this._targetNode.parent = this._boardNode;
        inheritLayer(this._targetNode, this._boardNode);
        this._targetNode.addComponent(UITransform).setContentSize(bw, bh);
        this._targetG = this._targetNode.addComponent(Graphics);
        const targetOp = this._targetNode.addComponent(UIOpacity);
        targetOp.opacity = 255;
        if (!Motion.reduced) {
            tween(targetOp)
                .repeatForever(
                    tween(targetOp)
                        .to(0.55, { opacity: 110 }, { easing: 'sineInOut' })
                        .to(0.55, { opacity: 255 }, { easing: 'sineInOut' }),
                )
                .start();
        }

        // Clear FX 层（消行格白闪 + ghost 预览），覆盖在 board 之上
        this._clearFxNode = new Node('ClearFx');
        this._clearFxNode.parent = this._boardNode;
        inheritLayer(this._clearFxNode, this._boardNode);
        this._clearFxNode.addComponent(UITransform).setContentSize(bw, bh);
        this._clearFxG = this._clearFxNode.addComponent(Graphics);

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

    /**
     * 整体重绘：64 格底面 + target 高亮 + 可选 ghost。
     * ⚠️ 拖拽 move 高频路径**不要**调本函数，改调 `paintGhost(ghost)` —— 主面在拖拽期间完全不变，
     * 每次 move 仍全量 clear+128 个 roundRect 会把 fps 拉到 30 以下（实测 lowFps=152/200s）。
     */
    private paintBoard(ghost?: { ok: boolean; cells: [number, number][] } | null): void {
        this.paintCells();
        this.paintTarget(!!ghost);
        this.paintGhost(ghost ?? null);
    }

    private paintCells(): void {
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
                    g.fillColor = NV_HIGHLIGHT;
                    g.roundRect(x, y + s * 0.74, s, s * 0.22, 4);
                    g.fill();
                } else {
                    g.fillColor = NV_EMPTY_FILL;
                    g.roundRect(x, y, s, s, 6);
                    g.fill();
                }
            }
        }
    }

    private paintTarget(hasGhost: boolean): void {
        const tg = this._targetG;
        tg.clear();
        const piece = this._queue[this._queueIdx];
        if (!piece?.target || !this._awaitingPlacement || hasGhost) return;
        for (const [dx, dy] of piece.cells) {
            const tc = piece.target[0] + dx;
            const tr = piece.target[1] + dy;
            const { x, y, s } = this.cellRect(tc, tr);
            tg.fillColor = NV_TARGET_FILL;
            tg.roundRect(x, y, s, s, 6);
            tg.fill();
            tg.strokeColor = NV_TARGET_STROKE;
            tg.lineWidth = 2;
            tg.roundRect(x, y, s, s, 6);
            tg.stroke();
        }
    }

    private paintGhost(ghost: { ok: boolean; cells: [number, number][] } | null): void {
        const fxg = this._clearFxG;
        fxg.clear();
        if (!ghost) return;
        for (const [cc, rr] of ghost.cells) {
            if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
            const { x, y, s } = this.cellRect(cc, rr);
            fxg.fillColor = ghost.ok ? NV_GHOST_OK_FILL : NV_GHOST_BAD_FILL;
            fxg.roundRect(x, y, s, s, 6);
            fxg.fill();
            fxg.strokeColor = ghost.ok ? NV_GHOST_OK_STROKE : NV_GHOST_BAD_STROKE;
            fxg.lineWidth = 2;
            fxg.roundRect(x, y, s, s, 6);
            fxg.stroke();
        }
    }

    private renderStep(): void {
        const step = SCENARIO[this._stepIndex];
        console.log(`[NewbieVillage] renderStep #${this._stepIndex} id=${step?.id ?? 'none'}`);
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
        this._coachBody.string = String(step.coach.body || '').replace(/\*\*/g, '');
        this._scoreLbl.string = `总分 ${this._score}`;
        this.updateComboBadge();
        this._revealNode.active = false;
        this._dots.forEach((d, i) => {
            const dg = d.getComponent(Graphics)!;
            dg.clear();
            const active = i === this._stepIndex;
            const done = i < this._stepIndex;
            if (active) {
                // 光晕：外圈半透蓝，对齐 web `.nv-dot.is-active{box-shadow:0 0 10px rgba(56,189,248,.8)}`
                dg.fillColor = new Color(56, 189, 248, 70);
                dg.circle(0, 0, 9);
                dg.fill();
            }
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
        // tray 半透明底框（对齐 web `.nv-piece` 圆角浅底）
        pg.fillColor = new Color(148, 163, 184, 16);
        pg.roundRect(-pw / 2, -ph / 2, pw, ph, 12);
        pg.fill();
        const filled = new Set(piece.cells.map(([x, y]) => `${x},${y}`));
        const unit = this._cellPx + BOARD_GAP;
        const color = this.paletteColor(piece.colorIdx);
        for (let y = 0; y <= maxY; y++) {
            for (let x = 0; x <= maxX; x++) {
                if (!filled.has(`${x},${y}`)) continue;
                const px = (x - (maxX + 1) / 2) * unit + unit / 2;
                const py = ((maxY + 1) / 2 - y - 1) * unit + unit / 2;
                pg.fillColor = color;
                pg.roundRect(px - this._cellPx / 2, py - this._cellPx / 2, this._cellPx, this._cellPx, 6);
                pg.fill();
                // 顶缘高光，呼应主盘 piece 质感
                pg.fillColor = new Color(255, 255, 255, 70);
                pg.roundRect(px - this._cellPx / 2, py - this._cellPx / 2 + this._cellPx * 0.74, this._cellPx, this._cellPx * 0.22, 4);
                pg.fill();
            }
        }
        this._pieceNode = el;
        // bob 浮动动画（对齐 web `.nv-piece.is-pulse` keyframes nv-bob）
        if (!Motion.reduced) {
            const base = el.position.clone();
            tween(el)
                .repeatForever(
                    tween(el)
                        .to(0.7, { position: new Vec3(base.x, base.y + 6, 0) }, { easing: 'sineInOut' })
                        .to(0.7, { position: base }, { easing: 'sineInOut' }),
                )
                .start();
        }
        // 新候选块就绪 → 重置无操作引导计时（状态不符时 showIdleHint 内部会自行跳过）。
        this.scheduleIdleHint();
    }

    private onTouchStart(e: EventTouch): void {
        this._dbgTouchCount++;
        const loc = e.getLocation();
        // 限流日志（前 8 次）：诊断「事件是否到达 + 各守卫是否拦截 + 命中区计算」。
        if (this._dbgTouchCount <= 8) {
            const pn = this._pieceNode;
            const pUit = pn?.getComponent(UITransform);
            const pwp = pn?.worldPosition;
            console.log(
                `[NewbieVillage] touch-start#${this._dbgTouchCount} loc=(${loc.x | 0},${loc.y | 0}) `
                + `finished=${this._finished} busy=${this._busy} await=${this._awaitingPlacement} `
                + `drag=${this._drag != null} pieceNode=${pn != null} `
                + `pieceWorld=(${pwp?.x.toFixed(0) ?? '?'},${pwp?.y.toFixed(0) ?? '?'}) `
                + `pieceSize=(${pUit?.contentSize.width.toFixed(0) ?? '?'}x${pUit?.contentSize.height.toFixed(0) ?? '?'})`,
            );
        }
        if (this._finished || this._busy || !this._awaitingPlacement || this._drag || !this._pieceNode) return;
        // ⚠️ 必须用 getLocation()（屏幕像素），screenToLocal 内部走 cam.screenToWorld；
        // 误用 getUILocation()（UI 空间）会让命中测试坐标系错位 → 完全拖不动（与主盘面同一约定）。
        const hit = this.hitNode(this._pieceNode, loc.x, loc.y);
        if (this._dbgTouchCount <= 8) {
            console.log(`[NewbieVillage] hit-test piece -> ${hit}`);
        }
        if (!hit) return;
        const piece = this._queue[this._queueIdx];
        if (!piece) return;
        this.onPieceTouchStart(e, piece);
    }

    private onPieceTouchStart(e: EventTouch, piece: NvPiece): void {
        const loc = e.getLocation();
        // grabX/grabY：按下时手指在 piece 节点内的局部偏移（用于 move 时把节点对齐手指）
        const stageLocal = screenToLocal(this._stageNode, loc.x, loc.y);
        const pieceLocal = screenToLocal(this._pieceNode!, loc.x, loc.y);
        console.log(
            `[NewbieVillage] grab piece=${piece.shapeId} `
            + `stageLocal=(${stageLocal.x.toFixed(1)},${stageLocal.y.toFixed(1)}) `
            + `pieceLocal=(${pieceLocal.x.toFixed(1)},${pieceLocal.y.toFixed(1)}) `
            + `target=${piece.target ? `[${piece.target[0]},${piece.target[1]}]` : 'free'}`,
        );
        this._drag = { piece, grabX: pieceLocal.x, grabY: pieceLocal.y };
        this.clearIdleHint();  // 玩家已开始拖拽 → 撤掉手指引导
        if (this._pieceNode) {
            Tween.stopAllByTarget(this._pieceNode);
            this._pieceNode.parent = this._stageNode;
            inheritLayer(this._pieceNode, this._stageNode);
            this._pieceNode.setPosition(stageLocal.x - pieceLocal.x, stageLocal.y - pieceLocal.y, 0);
        }
        // 进入拖拽：清掉 target overlay（避免 target + ghost 双层叠加渲染）
        this.paintTarget(true);
        try { AudioManager.sfxTick(); } catch { /* ignore */ }
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
        const stageLocal = screenToLocal(this._stageNode, loc.x, loc.y);
        // 节点位置 = 指尖（stage 坐标）- 按下时块内偏移（grab），保持「手指相对块」恒定，对齐 web 行为
        this._pieceNode.setPosition(stageLocal.x - d.grabX, stageLocal.y - d.grabY, 0);
        const origin = this.boardLocalToOrigin(loc.x, loc.y, d.grabX, d.grabY);
        this._dbgMoveCount++;
        // 日志限流：仅前 4 次出，之后完全静音（实测每秒 ~60 次 console.log 直接把 fps 拉到 30）
        if (this._dbgMoveCount <= 4) {
            console.log(
                `[NewbieVillage] move#${this._dbgMoveCount} `
                + `loc=(${loc.x | 0},${loc.y | 0}) `
                + `nodePos=(${(stageLocal.x - d.grabX).toFixed(1)},${(stageLocal.y - d.grabY).toFixed(1)}) `
                + `origin=${origin ? `[${origin[0]},${origin[1]}]` : 'null'}`,
            );
        }
        // 拖拽期间只刷 ghost 层；底盘 64 格 + target 不变，避免每帧 128 个 roundRect 重绘。
        if (origin) {
            const cells: [number, number][] = [];
            const [ox, oy] = origin;
            for (const [dx, dy] of d.piece.cells) cells.push([ox + dx, oy + dy]);
            this.paintGhost({ ok: isPlacementValid(this._board, d.piece, origin), cells });
        } else {
            this.paintGhost(null);
        }
    }

    private onTouchEnd(e: EventTouch): void {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        const loc = e.getLocation();
        const origin = this.boardLocalToOrigin(loc.x, loc.y, d.grabX, d.grabY);
        const ok = !!(origin && isPlacementValid(this._board, d.piece, origin));
        const tgt = d.piece.target;
        console.log(
            `[NewbieVillage] touch-end loc=(${loc.x | 0},${loc.y | 0}) `
            + `origin=${origin ? `[${origin[0]},${origin[1]}]` : 'null'} ok=${ok} `
            + `target=${tgt ? `[${tgt[0]},${tgt[1]}]` : 'free'}`,
        );
        this.paintBoard();
        if (ok && origin) {
            this.commitPlacement(d.piece, origin);
        } else {
            this.resetPieceToTray(d.piece);
            try { AudioManager.sfxInvalid(); Haptics.light(); } catch { /* ignore */ }
        }
    }

    /**
     * 屏幕坐标 → 棋盘 origin 格（与 web `_originFromPointer` 同语义）：
     * 计算「piece 左上格 (0,0) 中心」在 board 局部坐标，再四舍五入到 col/row。
     * piece 节点位置（stage 坐标）= stageLocal - grab；
     * 节点内每格中心绘制于 ((x-(maxX+1)/2)*unit + unit/2, ((maxY+1)/2 - y - 1)*unit + unit/2)；
     * 故 (0,0) 格中心节点偏移 = (-maxX*unit/2, +maxY*unit/2)。
     */
    private boardLocalToOrigin(screenX: number, screenY: number, grabX: number, grabY: number): [number, number] | null {
        const drag = this._drag;
        const piece = drag?.piece || this._queue[this._queueIdx];
        if (!piece) return null;
        const stageLocal = screenToLocal(this._stageNode, screenX, screenY);
        const { maxX, maxY } = this.pieceExtent(piece);
        const unit = this._cellPx + BOARD_GAP;
        const pieceCenterStageX = stageLocal.x - grabX;
        const pieceCenterStageY = stageLocal.y - grabY;
        const topLeftCenterStageX = pieceCenterStageX - (maxX * unit) / 2;
        const topLeftCenterStageY = pieceCenterStageY + (maxY * unit) / 2;
        // stage → board：board 在 stage 内 Y 偏移 boardCenterY=40（见 buildUi）
        const boardCenterY = 40;
        const topLeftBoardX = topLeftCenterStageX;
        const topLeftBoardY = topLeftCenterStageY - boardCenterY;
        const { ox, oy } = this.boardOrigin();
        const col = Math.round((topLeftBoardX - (ox + BOARD_PAD + this._cellPx / 2)) / unit);
        const row = Math.round(((oy - BOARD_PAD - this._cellPx / 2) - topLeftBoardY) / unit);
        if (col < -1 || row < -1 || col > COLS || row > ROWS) return null;
        return [col, row];
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
            const el = this._pieceNode;
            Tween.stopAllByTarget(el);
            el.parent = this._trayNode;
            inheritLayer(el, this._trayNode);
            el.setPosition(0, 0, 0);
            el.setScale(1, 1, 1);
            // 恢复 bob 浮动（对齐 web 拖错回弹后 `.is-pulse` 继续脉冲）
            if (!Motion.reduced) {
                const base = el.position.clone();
                tween(el)
                    .repeatForever(
                        tween(el)
                            .to(0.7, { position: new Vec3(base.x, base.y + 6, 0) }, { easing: 'sineInOut' })
                            .to(0.7, { position: base }, { easing: 'sineInOut' }),
                    )
                    .start();
            }
        } else {
            this.buildTray(piece);
        }
        // 拖错回弹后重新计时引导（buildTray 分支已计时，这里覆盖重置幂等无副作用）。
        this.scheduleIdleHint();
    }

    private commitPlacement(piece: NvPiece, origin: [number, number]): void {
        this.clearIdleHint();
        console.log(`[NewbieVillage] commitPlacement step=${this._stepIndex} qIdx=${this._queueIdx} piece=${piece.shapeId}/${piece.colorIdx} at=[${origin[0]},${origin[1]}]`);
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

        console.log(`[NewbieVillage] commit done cleared=${cleared} combo=${this._comboCount}`);
        if (cleared) {
            const scored = scorePlacement(this._board, this._comboCount);
            this._lastScored = scored;
            this._score += scored.score.clearScore;
            this._busy = true;
            console.log(`[NewbieVillage] runClear → lines=${scored.result.count} mono=${(scored.result.bonusLines||[]).length>0} perfect=${scored.perfect} score=${scored.score.clearScore}`);
            try {
                this.runClear(piece, scored);
            } catch (e) {
                console.error(`[NewbieVillage] runClear threw, force-resume: ${e && (e as any).message}`);
                this._busy = false;
                this.scheduleOnce(() => this.afterPlacement(), 0);
            }
        } else {
            this._busy = true;
            this.scheduleOnce(() => { this._busy = false; this.afterPlacement(); }, 0.46);
        }
    }

    private runClear(piece: NvPiece, scored: ReturnType<typeof scorePlacement>): void {
        const { clears, result, score } = scored;
        const lines = result.count;
        const mono = (result.bonusLines || []).length > 0;
        const comboMult = score.comboMultiplier;
        const perfect = scored.perfect;

        const cells = clears.cells || [];
        // ── 关键消除闪动 ──────────────────────────────────────────────
        // 旧实现：覆盖层 0.42s 淡完 → 底盘 0.46s 才重画成 afterBoard，中间 ~40ms 把已消失的
        // 方块又显回来再消失，眼里就是「闪一下」。
        // 现在：先用「仍填充的 _board」画白闪覆盖层（正确取色），随后立刻把底盘切到 afterBoard
        // （待消格已空），覆盖层在空底盘之上平滑缩放淡出 —— 全程无回闪。
        this.flashClearingCells(cells);          // 读取仍填充的 _board 取色
        this._board = scored.afterBoard as NvBoard;
        this.paintBoard();                        // 底盘即时变空，覆盖层在其上淡出
        // 板面抖动（web `.nv-board.is-shake`）
        this.shakeBoard();
        // 粒子 burst（web `_burstParticles`）
        this.burstParticles(cells, piece, perfect, mono);

        if (perfect) this.showBanner(`PERFECT ×${PERFECT_CLEAR_MULT}`, 'perfect');
        else if (comboMult > 1) this.showBanner(`COMBO ♥${this._comboCount} ×${comboMult}`, 'combo');
        else if (mono) this.showBanner(`同花 BONUS ×${ICON_BONUS_LINE_MULT}`, 'mono');
        else if (lines >= 2) this.showBanner(`多消 ×${lines}`, 'multi');

        const strong = perfect || comboMult > 1 || mono || lines >= 2;
        // ⚠️ 不再做整板翻闪：Cocos Graphics 无 web 的 radial-gradient，整板实色矩形淡入淡出
        // 在玩家眼里就是「闪动」（已多次反馈）。强反馈改由 逐格白闪 + 粒子 burst + banner 承担，
        // 既够强调又零闪屏。
        try {
            if (strong) AudioManager.sfxCombo(this._comboCount);
            else AudioManager.sfxClear(lines);
            if (strong) Haptics.medium();
        } catch { /* ignore */ }

        this.floatScore(score.clearScore);

        this.scheduleOnce(() => {
            console.log(`[NewbieVillage] runClear.finalize step=${this._stepIndex}`);
            // 盘面已在开头切到 afterBoard，这里只收尾分数/连击与状态机推进。
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
        // reveal 卡：入场 0.3s + 阅读 ~1.5s 已足够，避免「想点下一题但要干等 3s」的拖沓感；
        // 无 reveal 步骤更短，仅留 0.45s 让最后一格消除动画收尾。
        this.scheduleOnce(() => this.advance(), step?.reveal ? 1.8 : 0.45);
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
        // 旧 banner 在自身 tween 末尾已 n.destroy() —— 那次销毁会让 Label 组件的 .node 变成 null，
        // 这里再调 `.node.destroy()` 就抛 "Cannot read properties of null (reading 'destroy')"，
        // 进而被 commitPlacement 的 catch 走 force-resume：跳过 460ms 清除动画 + reveal 入场，
        // 多步连击/同花/PERFECT 节奏被打乱。先校验 isValid 再销毁。
        const prevNode = this._bannerLbl?.node;
        if (prevNode && prevNode.isValid) prevNode.destroy();
        this._bannerLbl = null;
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
        const clearRef = () => { if (this._bannerLbl?.node === n) this._bannerLbl = null; };
        if (!Motion.reduced) {
            n.setScale(0.4, 0.4, 1);
            tween(n).to(0.35, { scale: new Vec3(1.1, 1.1, 1) }).to(0.65, { scale: new Vec3(1, 1, 1) }).start();
            tween(n.getComponent(UIOpacity) || n.addComponent(UIOpacity))
                .delay(0.7).to(0.3, { opacity: 0 }).call(() => { clearRef(); if (n.isValid) n.destroy(); }).start();
        } else {
            this.scheduleOnce(() => { clearRef(); if (n.isValid) n.destroy(); }, 1);
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
        // 入场动画：translateY + opacity，对齐 web `.nv-reveal.is-visible`
        if (!Motion.reduced) {
            const op = this._revealNode.getComponent(UIOpacity) || this._revealNode.addComponent(UIOpacity);
            op.opacity = 0;
            const basePos = this._revealNode.position.clone();
            this._revealNode.setPosition(basePos.x, basePos.y - 10, 0);
            Tween.stopAllByTarget(this._revealNode);
            Tween.stopAllByTarget(op);
            tween(op).to(0.3, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(this._revealNode).to(0.3, { position: basePos }, { easing: 'cubicOut' }).start();
        }
    }

    /* ── 特效（对齐 web newbieVillage.js）────────────────────── */

    /** 消行格白闪 + 缩放消失，对齐 web `.nv-cell.is-clearing` keyframes nv-clear */
    private flashClearingCells(cells: Array<[number, number]>): void {
        if (Motion.reduced) return;
        const fxg = this._clearFxG;
        // 用「逐帧渐变」叠加白光：用一个独立 Graphics + UIOpacity 自补间。
        // 简化：开一个临时 Graphics 节点，画所有 clearing cell 的白盖板，做 0.42s 的 brightness pulse + 缩到 0。
        const overlay = new Node('ClearCells');
        overlay.parent = this._boardNode;
        inheritLayer(overlay, this._boardNode);
        const uit = overlay.addComponent(UITransform);
        const bw = COLS * this._cellPx + (COLS - 1) * BOARD_GAP + BOARD_PAD * 2;
        const bh = ROWS * this._cellPx + (ROWS - 1) * BOARD_GAP + BOARD_PAD * 2;
        uit.setContentSize(bw, bh);
        const g = overlay.addComponent(Graphics);
        for (const [r, c] of cells) {
            const idx = this._board[r]?.[c];
            const base = idx != null ? this.paletteColor(idx) : new Color(255, 255, 255, 255);
            const { x, y, s } = this.cellRect(c, r);
            g.fillColor = new Color(base.r, base.g, base.b, 255);
            g.roundRect(x, y, s, s, 6);
            g.fill();
            g.fillColor = new Color(255, 255, 255, 200);
            g.roundRect(x, y, s, s, 6);
            g.fill();
        }
        const op = overlay.addComponent(UIOpacity);
        op.opacity = 255;
        tween(overlay)
            .to(0.18, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'cubicOut' })
            .to(0.24, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'cubicIn' })
            .call(() => overlay.destroy())
            .start();
        tween(op)
            .delay(0.18)
            .to(0.24, { opacity: 0 }, { easing: 'cubicIn' })
            .start();
    }

    /** 棋盘抖动，对齐 web `.nv-board.is-shake` keyframes nv-shake */
    private shakeBoard(): void {
        if (Motion.reduced) return;
        const node = this._boardNode;
        Tween.stopAllByTarget(node);
        const base = node.position.clone();
        const seq = tween(node)
            .to(0.04, { position: new Vec3(base.x - 6, base.y, 0) })
            .to(0.05, { position: new Vec3(base.x + 7, base.y, 0) })
            .to(0.05, { position: new Vec3(base.x - 7, base.y, 0) })
            .to(0.05, { position: new Vec3(base.x + 5, base.y, 0) })
            .to(0.05, { position: new Vec3(base.x - 3, base.y, 0) })
            .to(0.05, { position: new Vec3(base.x + 2, base.y, 0) })
            .to(0.05, { position: base }, { easing: 'cubicOut' });
        seq.start();
    }

    /** 消行粒子 burst（最多 18 格 × 4 粒），对齐 web `_burstParticles` */
    private burstParticles(cells: Array<[number, number]>, piece: NvPiece, perfect: boolean, mono: boolean): void {
        if (Motion.reduced) return;
        let colors: string[];
        if (perfect) colors = ['#fde68a', '#fbbf24', '#ffffff'];
        else if (mono) colors = PALETTE as string[];
        else colors = [PALETTE[piece.colorIdx % PALETTE.length] as string, '#fde68a'];

        const sample = cells.slice(0, 18);
        for (const [r, c] of sample) {
            const { x, y, s } = this.cellRect(c, r);
            const cx = x + s / 2;
            const cy = y + s / 2;
            for (let i = 0; i < 4; i++) {
                const p = new Node('p');
                p.parent = this._boardNode;
                inheritLayer(p, this._boardNode);
                p.setPosition(cx, cy, 0);
                p.addComponent(UITransform).setContentSize(7, 7);
                const pg = p.addComponent(Graphics);
                const col = hexToColor(colors[(i + r + c) % colors.length]);
                pg.fillColor = col;
                pg.roundRect(-3.5, -3.5, 7, 7, 2);
                pg.fill();
                const op = p.addComponent(UIOpacity);
                op.opacity = 255;
                const ang = Math.random() * Math.PI * 2;
                const dist = 28 + Math.random() * 44;
                const dx = Math.cos(ang) * dist;
                const dy = Math.sin(ang) * dist + 18;
                tween(p)
                    .to(0.6 + Math.random() * 0.2, { position: new Vec3(cx + dx, cy + dy, 0), scale: new Vec3(0.2, 0.2, 1) }, { easing: 'cubicOut' })
                    .call(() => p.destroy())
                    .start();
                tween(op).delay(0.2).to(0.5, { opacity: 0 }).start();
            }
        }
    }

    /* ── 无操作手指引导 ─────────────────────────────────────────── */

    /** 候选块就绪后调用：静置 2.6s 无操作则弹出「候选块 → 目标格」手指滑动提示。 */
    private scheduleIdleHint(): void {
        this.clearIdleHint();
        if (this._finished) return;
        this.scheduleOnce(this._hintFn, 2.6);
    }

    /** 取消计时并销毁手指节点（玩家开始拖拽 / 落子 / 结束时调用）。 */
    private clearIdleHint(): void {
        this.unschedule(this._hintFn);
        if (this._hintNode) {
            Tween.stopAllByTarget(this._hintNode);
            const op = this._hintNode.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            if (this._hintNode.isValid) this._hintNode.destroy();
            this._hintNode = null;
        }
    }

    private showIdleHint(): void {
        // 仅在「等待落子且未拖拽/未忙」且当前步骤有目标格时提示（自由步骤不强引导）。
        if (this._finished || this._busy || this._drag || !this._awaitingPlacement || !this._pieceNode) return;
        const piece = this._queue[this._queueIdx];
        if (!piece?.target) return;

        // 起点：候选块（tray）在 stage 内的位置；终点：目标格中心（board 内 + boardCenterY 偏移）。
        const tp = this._trayNode.position;
        const boardCenterY = 40;
        let sx = 0;
        let sy = 0;
        for (const [dx, dy] of piece.cells) {
            const { x, y, s } = this.cellRect(piece.target[0] + dx, piece.target[1] + dy);
            sx += x + s / 2;
            sy += y + s / 2;
        }
        const n = piece.cells.length || 1;
        const startPos = new Vec3(tp.x, tp.y, 0);
        const endPos = new Vec3(sx / n, sy / n + boardCenterY, 0);

        const hint = new Node('IdleHint');
        hint.parent = this._stageNode;
        inheritLayer(hint, this._stageNode);
        hint.setSiblingIndex(9999);
        label(hint, '👆', 34, 0, 0, Color.WHITE);
        const op = hint.addComponent(UIOpacity);
        op.opacity = 0;
        hint.setPosition(startPos);
        this._hintNode = hint;

        if (Motion.reduced) { op.opacity = 180; return; }
        // 位移循环（周期 1.74s）：起点停顿 → 滑到目标 → 轻「按」一下 → 停顿 → 跳回起点。
        tween(hint)
            .repeatForever(
                tween(hint)
                    .set({ position: startPos, scale: new Vec3(1, 1, 1) })
                    .delay(0.3)
                    .to(0.8, { position: endPos }, { easing: 'sineInOut' })
                    .to(0.12, { scale: new Vec3(0.78, 0.78, 1) }, { easing: 'sineOut' })
                    .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
                    .delay(0.4),
            )
            .start();
        // 透明度循环（同周期 1.74s 对齐）：起点淡入 → 全程实显 → 跳回前淡出，避免硬切回闪。
        tween(op)
            .repeatForever(
                tween(op)
                    .set({ opacity: 0 })
                    .to(0.25, { opacity: 235 })
                    .delay(1.14)
                    .to(0.25, { opacity: 0 })
                    .delay(0.1),
            )
            .start();
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
        this.clearIdleHint();
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

        // emoji bob 动画，对齐 web `.nv-graduate__emoji{animation:nv-bob...}`
        const emojiLbl = label(card, '🎉', 58, 0, 120, Color.WHITE);
        if (!Motion.reduced) {
            const en = emojiLbl.node;
            const base = en.position.clone();
            tween(en)
                .repeatForever(
                    tween(en)
                        .to(0.8, { position: new Vec3(base.x, base.y + 6, 0) }, { easing: 'sineInOut' })
                        .to(0.8, { position: base }, { easing: 'sineInOut' }),
                )
                .start();
        }

        label(card, '出师啦！', 23, 0, 50, new Color(241, 245, 249, 255));

        // 正文：与 web 文案严格一致；分两行 Label 显示，第一行强调用金色
        // 用 CLAMP（不换行）+ 固定行距 26，避免 RESIZE_HEIGHT 导致两行重叠/位移
        const bodyTop = label(card,
            '你已掌握 单消 / 多消 / 同花 / 连击 / 清屏，',
            14, 0, 0, new Color(253, 224, 71, 245));
        this.constrainLabel(bodyTop, 520, Label.HorizontalAlign.CENTER, false);
        const bodyBot = label(card,
            `训练赛累计得分 ${this._score}。真实对局采用同样的计分规则，去冲击最高分吧！`,
            13.5, 0, -26, new Color(226, 232, 240, 220));
        this.constrainLabel(bodyBot, 520, Label.HorizontalAlign.CENTER, false);

        if (reward) {
            // 奖励框：底色 + 边框，对齐 web `.nv-graduate__reward`
            const rewardNode = new Node('Reward');
            rewardNode.parent = card;
            inheritLayer(rewardNode, card);
            rewardNode.setPosition(0, -80, 0);
            const rw = 320;
            const rh = 40;
            rewardNode.addComponent(UITransform).setContentSize(rw, rh);
            const rg = rewardNode.addComponent(Graphics);
            rg.fillColor = new Color(251, 191, 36, 30);
            rg.roundRect(-rw / 2, -rh / 2, rw, rh, 14);
            rg.fill();
            rg.strokeColor = new Color(251, 191, 36, 90);
            rg.lineWidth = 1;
            rg.roundRect(-rw / 2, -rh / 2, rw, rh, 14);
            rg.stroke();
            label(rewardNode, `🎁 新手礼包：${reward}`, 14, 0, 0, new Color(253, 230, 138, 255));
        }
        button(card, '开始游戏', 0, -150, 15, () => this.finish({ done: true }),
            new Color(56, 189, 248, 255), { primary: true, minWidth: 200 });
        try { AudioManager.sfxUnlock(); } catch { /* ignore */ }
    }

    private finish(opts: { done?: boolean; skipped?: boolean } = {}): void {
        if (this._finished) return;
        this._finished = true;
        this.clearIdleHint();
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
