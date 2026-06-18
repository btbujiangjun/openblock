/**
 * NewbieVillage.ts — Cocos 新手村（首登 5 课交互引导，对齐 web newbieVillage.js）
 */
import {
    _decorator, Component, Node, Graphics, Label, UITransform, Color, UIOpacity,
    input, Input, EventTouch, Vec3, tween, view, Tween, sys,
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
    pickSmartSnap,
    NEWBIE_VILLAGE_STORAGE_KEY,
} from '../../engine/onboarding/newbieVillageCore.mjs';
// @ts-ignore 引擎同步多语言文案字典
import { nvT } from '../../engine/onboarding/newbieVillageStrings.mjs';
import { getLocale } from '../../core/i18n';

const { ccclass } = _decorator;

const BOARD_PAD = 10;
const BOARD_GAP = 4;
/** 触屏拖拽跟手倍率：明显放大手指位移，让从候选区拖到盘面的体感与主局一致（GameController
 *  里 `DRAG_TOUCH_TRACK_GAIN = 2.0`）。鼠标/桌面端仍保持 1:1 不放大，避免桌测调试时跟手太「滑」。
 *  Web 端拖拽是 DOM pointer 直接跟手且块小（cellPx 26~46），1:1 已经够快；Cocos 端 cellPx 可达 92
 *  + 真机手指行程长，不放大会让玩家觉得「拉了半天还没到目标格」。 */
const NV_TOUCH_TRACK_GAIN = 2.0;
/** 智能吸附半径（格）。1 格容差已覆盖"差半格"的常见 finger drift。 */
const NV_SNAP_RADIUS = 1;

// 高频路径（paintCells / paintTarget / paintGhost 每次拖动都调）共用色常量 ——
// 复用 Color 实例，避免每帧 `new Color()` 触发 GC。
const NV_EMPTY_FILL = new Color(148, 163, 184, 20);
const NV_TARGET_FILL = new Color(56, 189, 248, 60);
const NV_TARGET_STROKE = new Color(56, 189, 248, 220);
const NV_GHOST_OK_FILL = new Color(56, 189, 248, 90);
const NV_GHOST_OK_STROKE = new Color(56, 189, 248, 230);
const NV_GHOST_BAD_FILL = new Color(248, 113, 113, 64);
const NV_GHOST_BAD_STROKE = new Color(248, 113, 113, 200);
// 已落块「外暗描边」与「内白高光」—— 复刻 web `.nv-cell.is-filled` 的 inset shadow 视觉
// （顶部 1px 白线 + 底部 3px 暗影）。主局 paintCartoon 同款三步：外暗 → 主色面 → 内白描边。
const NV_BLOCK_OUTLINE = new Color(0, 0, 0, 112);
const NV_BLOCK_INNER = new Color(255, 255, 255, 88);

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
    /** 新手村展示期间需要临时隐藏的兄弟节点（主游戏 Play / Dock / Hud / SkillBar / Ghost ...）。
     *  Cocos UI 渲染按 sibling index 顺序叠加，但底层主游戏盘面与 dock 候选块仍会出现在新手村 bg
     *  之上的某些场景（candidate 节点 cellPx 与新手村不同、位置正好落在新手村空白处 → 截图反馈
     *  右下角出现"花朵 emoji 候选块"+ 深红色 ghost）。直接 `node.active = false` 比拼层级稳。
     *  新手村 finish 时按原顺序恢复 active=true。 */
    hideDuring?: Node[];
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
            // 记录并隐藏底层主游戏节点：截图反馈在新手村之上漏出主游戏 dock 候选块（带皮肤
            // emoji 的方块）+ ghost 残影。直接 active=false 比拼 sibling 层级稳。
            const hidden: Node[] = [];
            for (const n of (opts.hideDuring || [])) {
                if (!n?.isValid) continue;
                if (!n.active) continue;          // 原本就隐藏的不动，避免 finish 时误开启
                hidden.push(n);
                n.active = false;
            }
            comp.setup({
                wallet: opts.wallet,
                onFinish: () => {
                    _active = null;
                    for (const n of hidden) { if (n?.isValid) n.active = true; }
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
    /** startX/startY：touch-start 屏幕坐标，move/end 用 `start + (cur-start)*gain` 放大跟手位移。 */
    private _drag: { piece: NvPiece; grabX: number; grabY: number; startX: number; startY: number } | null = null;

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

    /**
     * 新手村本地翻译辅助 —— 走独立字典 `newbieVillageStrings.mjs`（19 语言文案集中维护）。
     * 缺译时三级回退：当前 locale → en → zh-CN → fallback 兜底字符串。
     *
     * @param key  例如 'ui.title' / 'scenario.single.coach.title'
     * @param vars `{{name}}` 占位符替换
     * @param fallback 字典都没命中时回退（如 SCENARIO 内嵌中文原文），保证文本不为空。
     */
    private _t(key: string, vars?: Record<string, string | number>, fallback?: string): string {
        return nvT(getLocale(), key, vars, fallback);
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
        // 顶部氛围带 —— 独立节点，结业页 graduate() 会 setActive(false) 关闭，
        // 避免「上半 #0e1524 / 下半 #080b12」两段色分层的不协调感（玩家反馈）。
        const topBand = new Node('TopBand');
        topBand.parent = this.node;
        inheritLayer(topBand, this.node);
        const tbG = topBand.addComponent(Graphics);
        tbG.fillColor = new Color(14, 21, 36, 255);
        tbG.rect(-halfW - overscan, halfH - 220, vs.width + overscan * 2, 220 + overscan);
        tbG.fill();

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
        const titleStr = this._t('ui.title', undefined, '🏕️ 新手村');
        const titleLbl = label(this.node, titleStr, 18, 0, titleY, new Color(241, 245, 249, 255));
        titleLbl.node.name = 'NvTitle';
        const skipStr = this._t('ui.skip', undefined, '跳过引导');
        const skipBtn = button(this.node, skipStr, halfW - 78, titleY, 13, () => this.finish({ skipped: true }),
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

    /**
     * 单格已落方块的统一画法（与主局 paintCartoon 同思路）：外暗描边 → 主色面 → 内白描边。
     * 复刻 web `.nv-cell.is-filled`（inset 顶部 1px 白光 + 底部 3px 暗影）的视觉。
     *
     * ⚠️ Cocos Graphics 无 createLinearGradient；不要再叠"格子下部 0.74 处一道白条"或多段渐变
     *    band 模拟渐变 —— 那会在视觉上把方块切成上下两段，玩家反馈"方块底色不同色块、很割裂"。
     *    本三步法各端表现一致，与 web inset shadow 设计意图等价。
     */
    private _paintFilledCell(g: Graphics, x: number, y: number, s: number, face: Color): void {
        const r = 6;
        // 1. 外暗描边：遮住主色 fill 边缘锯齿，同时模拟 web 底部 inset shadow 的轮廓收紧。
        g.lineWidth = 2;
        g.fillColor = NV_BLOCK_OUTLINE;
        g.strokeColor = NV_BLOCK_OUTLINE;
        g.roundRect(x, y, s, s, r);
        g.stroke();
        // 2. 主色面（缩进 1px 覆盖描边内侧，方块面保持纯色不分裂）
        g.fillColor = face;
        g.roundRect(x + 1, y + 1, s - 2, s - 2, Math.max(1, r - 1));
        g.fill();
        // 3. 内白描边：极细顶部高光，对齐 web `inset 0 1px 0 rgba(255,255,255,.25)`
        g.lineWidth = 1;
        g.strokeColor = NV_BLOCK_INNER;
        g.roundRect(x + 1.5, y + 1.5, s - 3, s - 3, Math.max(0, r - 1.5));
        g.stroke();
    }

    private paintCells(): void {
        const g = this._boardG;
        g.clear();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const { x, y, s } = this.cellRect(c, r);
                const idx = this._board[r][c];
                if (idx !== null) {
                    this._paintFilledCell(g, x, y, s, this.paletteColor(idx));
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
        // 教程文案走 i18n：缺译回退 SCENARIO 内嵌中文原文（icon 不翻译，跨语言统一 emoji）。
        this._coachIcon.string = step.coach.icon;
        this._coachTitle.string = this._t(`scenario.${step.id}.coach.title`, undefined, step.coach.title);
        const body = this._t(`scenario.${step.id}.coach.body`, undefined, step.coach.body);
        this._coachBody.string = String(body || '').replace(/\*\*/g, '');
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
                // 候选块用与盘面已落块同一画法（外暗描边 → 主色面 → 内白描边），
                // 保证「拖动前 vs 落子后」视觉一致，玩家不会感到色块割裂。
                this._paintFilledCell(pg, px - this._cellPx / 2, py - this._cellPx / 2, this._cellPx, color);
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
        this._drag = { piece, grabX: pieceLocal.x, grabY: pieceLocal.y, startX: loc.x, startY: loc.y };
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

    /** 按跟手倍率把当前触点屏幕坐标转换为「控制点」屏幕坐标（仅移动端启用 gain，对齐主局体验）。 */
    private aimScreenPoint(curX: number, curY: number): { x: number; y: number } {
        const d = this._drag;
        if (!d) return { x: curX, y: curY };
        const gain = (sys.isMobile || sys.isNative) ? NV_TOUCH_TRACK_GAIN : 1;
        if (gain === 1) return { x: curX, y: curY };
        return {
            x: d.startX + (curX - d.startX) * gain,
            y: d.startY + (curY - d.startY) * gain,
        };
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
        // 按跟手倍率放大相对位移，让移动端拖拽体感与主局一致（GameController DRAG_TOUCH_TRACK_GAIN=2.0）。
        const aim = this.aimScreenPoint(loc.x, loc.y);
        const stageLocal = screenToLocal(this._stageNode, aim.x, aim.y);
        // 节点位置 = 控制点（stage 坐标）- 按下时块内偏移（grab），保持「手指相对块」恒定，对齐 web 行为
        this._pieceNode.setPosition(stageLocal.x - d.grabX, stageLocal.y - d.grabY, 0);
        const aimOrigin = this.boardLocalToOrigin(aim.x, aim.y, d.grabX, d.grabY);
        // 智能吸附：aim 落在 target 邻域 / 自由步骤合法格附近 → 吸到吸附位（ghost 显示与最终落点同一格）。
        const snap = aimOrigin ? pickSmartSnap(this._board, d.piece, aimOrigin, NV_SNAP_RADIUS) : null;
        const origin = snap || aimOrigin;
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
        const loc = e.getLocation();
        // ⚠️ 必须先按 gain 算 aim 再清 _drag —— aimScreenPoint 依赖 _drag.startX/Y。
        const aim = this.aimScreenPoint(loc.x, loc.y);
        this._drag = null;
        const aimOrigin = this.boardLocalToOrigin(aim.x, aim.y, d.grabX, d.grabY);
        const snap = aimOrigin ? pickSmartSnap(this._board, d.piece, aimOrigin, NV_SNAP_RADIUS) : null;
        const origin = snap || aimOrigin;
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
        if (step?.reveal) {
            // 走 i18n：reveal.title/body 通过 scenario.<id>.reveal.* key 翻译，缺译回退内嵌中文。
            this.showReveal({
                title: this._t(`scenario.${step.id}.reveal.title`, undefined, step.reveal.title),
                body: this._t(`scenario.${step.id}.reveal.body`, undefined, step.reveal.body),
            }, this._lastScored);
        }
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

    /**
     * 消行格「原色保持」覆盖层 —— 对齐主局 LineClearFx 的极简观感：
     *   - 仅用方块自身 palette 色重画一遍（commitPlacement 已把底层格子清空），
     *     不叠暖光圈、不叠高光描边、不喧宾夺主；
     *   - 整体「略放大 → 急速缩小 + 淡出」，物理上等同"方块被炸碎"；
     *   - 真正的「亮 / 爆」由 burstParticles 的粒子系统承担（主局完全相同思路）。
     */
    private flashClearingCells(cells: Array<[number, number]>): void {
        if (Motion.reduced) return;
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
            if (idx == null) continue;
            const base = this.paletteColor(idx);
            const { x, y, s } = this.cellRect(c, r);
            g.fillColor = new Color(base.r, base.g, base.b, 255);
            g.roundRect(x, y, s, s, 6);
            g.fill();
        }
        const op = overlay.addComponent(UIOpacity);
        op.opacity = 255;
        tween(overlay)
            .to(0.14, { scale: new Vec3(1.10, 1.10, 1) }, { easing: 'cubicOut' })
            .to(0.20, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'cubicIn' })
            .call(() => overlay.destroy())
            .start();
        tween(op)
            .delay(0.14)
            .to(0.20, { opacity: 0 }, { easing: 'cubicIn' })
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

    /**
     * 消行粒子爆炸（参考主局 FxLayer.burstClear 的「主粒子 + 火花 + 中心 glow」三层结构）：
     *   - **每格粒子量分级**：single 10 / double 13 / combo+ 17 / perfect 22（接近主局口径）
     *   - **主粒子**：向 360° 随机方向发射，cubicOut 曲线在 0.9~1.1s 内飞 60~120px，
     *     带「先上抛后回落」（vy 起始负值 + 末段 +dy 模拟轻量重力）
     *   - **火花**：combo/perfect 时每格再加 4~6 粒小号金色/彩虹（更亮更快）
     *   - **中心 glow**：每格 50% 概率扩散一个柔光大圆（外亮内透）
     */
    private burstParticles(cells: Array<[number, number]>, piece: NvPiece, perfect: boolean, mono: boolean): void {
        if (Motion.reduced) return;
        const count = cells.length;
        const isCombo = !perfect && count >= 16; // 2 行以上才算 combo 级别（8×2=16 格）
        const isDouble = !perfect && !isCombo && count >= 14;

        // 主粒子调色板
        const RAINBOW = ['#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#38bdf8', '#fb7185', '#fde68a'];
        let colors: string[];
        if (perfect) colors = RAINBOW;
        else if (mono) colors = PALETTE as string[];
        else colors = [PALETTE[piece.colorIdx % PALETTE.length] as string, '#fde68a', '#ffffff'];

        // 每格主粒子数量 + 速度 + 寿命（对齐主局 burstClear 的分级）
        const perCell = perfect ? 22 : isCombo ? 17 : isDouble ? 13 : 10;
        const speedBase = perfect ? 1.55 : isCombo ? 1.30 : isDouble ? 1.15 : 1.0;
        const lifeS = perfect ? 1.20 : isCombo ? 1.05 : isDouble ? 0.95 : 0.85;
        const sparkCount = (perfect ? 6 : isCombo ? 4 : 0); // combo+ 才加火花

        // 控制总量（cells 多于 18 时按比例削减，避免 perfect 满盘 64 格 × 22 粒爆 GPU）
        const sample = count > 18 ? cells.slice(0, 18) : cells;

        for (let idx = 0; idx < sample.length; idx++) {
            const [r, c] = sample[idx];
            const { x, y, s } = this.cellRect(c, r);
            const cx = x + s / 2;
            const cy = y + s / 2;

            // 主粒子（移除「中心 glow 柔光大圆」—— 玩家反馈"眩晕光环"；
            // 主局 FxLayer 的 glow 半径仅 cell*1.6 / 4 层 alpha 较低，但在 NewbieVillage
            // 小窗口下相对盘面占比过大、扩散到 1.4× 后易产生压迫感，干脆移除，靠纯粒子表现爆裂。）
            for (let i = 0; i < perCell; i++) {
                const ang = Math.random() * Math.PI * 2;
                const sp = (28 + Math.random() * 64) * speedBase;
                const dxx = Math.cos(ang) * sp;
                // y 向上为正：起始向上抛（-jump），末段叠加重力下落（+gravity * t²）
                const jump = 18 + Math.random() * 24;
                const gravity = 80 + Math.random() * 60;
                const dyy = Math.sin(ang) * sp * 0.7 + jump - gravity * 0.4;
                const colHex = colors[(i + idx) % colors.length];
                const size = (perfect ? 4 : isCombo ? 4 : 3.5) + Math.random() * 3;
                this._spawnParticle(cx, cy, dxx, dyy, size, colHex, lifeS + Math.random() * 0.2);
            }

            // 3) 火花（combo+ / perfect）：金/奶白小粒子，更快更亮
            for (let j = 0; j < sparkCount; j++) {
                const ang = Math.random() * Math.PI * 2;
                const sp = (60 + Math.random() * 80) * speedBase;
                const dxx = Math.cos(ang) * sp;
                const dyy = Math.sin(ang) * sp - (24 + Math.random() * 20);
                const colHex = perfect
                    ? RAINBOW[j % RAINBOW.length]
                    : (j % 2 === 0 ? '#ffd700' : '#fff8dc');
                this._spawnParticle(cx, cy, dxx, dyy, 2 + Math.random() * 2.5, colHex,
                    lifeS * 1.2 + Math.random() * 0.2);
            }
        }
    }

    /**
     * 单粒子飞出 + 旋转 + 缩小 + 淡出（方块碎屑，对齐主局 FxLayer 风格）：
     *   - 圆形粒子在 360° 等距发射时极易在视觉上构成「光环」，玩家反馈"圆环动效"——
     *     改为带随机旋转的矩形碎屑，配合不规则尺寸彻底破除环形错觉。
     *   - 起始随机偏移 ±s/4，让粒子不是同一中心点出发，进一步消除同心感。
     */
    private _spawnParticle(
        cx: number, cy: number, dx: number, dy: number, size: number, colorHex: string, life: number,
    ): void {
        const p = new Node('p');
        p.parent = this._boardNode;
        inheritLayer(p, this._boardNode);
        // 起点小幅抖动，避免所有粒子从同一点齐射构成环
        const jitter = size * 0.8;
        const sx = cx + (Math.random() - 0.5) * jitter * 2;
        const sy = cy + (Math.random() - 0.5) * jitter * 2;
        p.setPosition(sx, sy, 0);
        p.addComponent(UITransform).setContentSize(size * 2, size * 2);
        // 随机起始旋转 + 飞行中继续旋转 → 视觉上是「碎屑」而非「光点圆环」
        const rot0 = Math.random() * 360;
        p.angle = rot0;
        const pg = p.addComponent(Graphics);
        pg.fillColor = hexToColor(colorHex);
        // 矩形碎屑（长宽比 1.3 增强方向感，与主局 FxLayer 一致）
        const w = size * 1.3;
        const h = size;
        pg.roundRect(-w / 2, -h / 2, w, h, 1.5);
        pg.fill();
        const op = p.addComponent(UIOpacity);
        op.opacity = 255;
        const rotDelta = (Math.random() - 0.5) * 540;
        tween(p)
            .to(life,
                { position: new Vec3(sx + dx, sy + dy, 0),
                    scale: new Vec3(0.2, 0.2, 1),
                    angle: rot0 + rotDelta },
                { easing: 'cubicOut' })
            .call(() => p.destroy())
            .start();
        // 寿命前 60% 全显，后 40% 淡出（与主局粒子余韵一致）
        tween(op).delay(life * 0.6).to(life * 0.4, { opacity: 0 }).start();
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

    /**
     * 发放奖励 + 返回拼接好的中文兜底文案（用于日志/分析；UI 不再使用此字符串，
     * 改用 _buildRewardItems() 直接按 i18n key 渲染，避免文本解析的本地化盲点）。
     */
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

    /**
     * 结业页（首登转化关键界面）—— 全屏「奖杯仪式感」布局：
     *
     * 上中下三段撑满整屏（vs.height），避免下半屏空白：
     *   - **上段 (~32% 屏高)**：装饰光晕背景 + 大号 🎉 (98px) + 标题 (42px) + 副标题
     *   - **中段 (~38% 屏高)**：训练成果卡（+1080 数字 56px 大号金色）+ 5 技能 checklist (emoji 38px / 标签 16px)
     *   - **下段 (~30% 屏高)**：礼包卡（h 76px，emoji 36px，文案 18px）+ 主 CTA (h 64px / 文字 18px) + 副钩子
     *
     * 所有字号 / 间距按 vs.height 自适应（基准 820px → scale=1，矮屏 480 → scale=0.78）。
     * 跳过引导按钮（屏右上）保持不变，玩家随时可关闭。
     */
    private graduate(): void {
        if (this._finished) return;
        this.clearIdleHint();
        const reward = this.grantReward();
        this._stageNode.active = false;
        this._revealNode.active = false;
        this.node.getChildByName('Coach')!.active = false;
        // 关闭玩法阶段顶部 220px 渐变带 —— 否则结业页顶部会有"两种深色"分层（玩家反馈）。
        const topBand = this.node.getChildByName('TopBand');
        if (topBand) topBand.active = false;
        // 隐藏玩法阶段顶部「🏕️ 新手村」标题 + 跳过按钮 + 进度点 ——
        // 否则它们与结业页的 🎉 emoji + 标题在同一垂直区域重叠（玩家反馈）。
        // 按 node name 识别，i18n 切换语言后字面量已变，但 node name 不变（最稳）。
        const nvTitle = this.node.getChildByName('NvTitle');
        if (nvTitle) nvTitle.active = false;
        const skipBtn = this.node.getChildByName('SkipBtn');
        if (skipBtn) skipBtn.active = false;
        const dotRow = this.node.getChildByName('Dots');
        if (dotRow) dotRow.active = false;

        const vs = view.getVisibleSize();
        const halfH = vs.height / 2;
        const scale = Math.max(0.85, Math.min(1.05, vs.height / 820));

        const card = new Node('Graduate');
        card.parent = this.node;
        card.setPosition(0, 0, 0);
        inheritLayer(card, this.node);

        // 背景仅保留五彩纸屑（已移除 halo 径向光圈 —— 玩家反馈"圆环干扰主体信息"）
        this._paintGraduateAmbient(card, vs);

        // 均匀分布：屏幕主体（上下各 ~8% 留白）等距 6 锚点，顺序对齐玩家阅读流：
        //   emoji → 标题 → 技能(消除类型) → 分数 → 礼包 → CTA
        const topPad = halfH * 0.86;
        const bottomPad = -halfH * 0.92;
        const usableH = topPad - bottomPad;
        const step = usableH / 6;
        const yEmoji = topPad - step * 0.40;
        const yTitle = topPad - step * 1.20;        // emoji 与标题间距 0.8 step → 杜绝重叠
        const ySkills = topPad - step * 2.30;
        const yScore = topPad - step * 3.30;
        const yReward = topPad - step * 4.20;
        // CTA 上移到屏中下偏上（玩家反馈"过于居下"）—— 锚点放在屏高 ~80% 处，
        // 下方留 ~20% 空间给副钩子 + Home Indicator，整体重心更聚焦上中部。
        const yCta = topPad - step * 5.10;
        const ySubtitle = yTitle - 44 * scale;
        const yCtaHint = yCta - 52 * scale;

        // 1) 🎉 emoji 110px
        const emojiLbl = label(card, '🎉', Math.round(110 * scale), 0, yEmoji, Color.WHITE);
        if (!Motion.reduced) {
            const en = emojiLbl.node;
            const base = en.position.clone();
            tween(en).repeatForever(
                tween(en)
                    .to(0.9, { position: new Vec3(base.x, base.y + 6, 0) }, { easing: 'sineInOut' })
                    .to(0.9, { position: base }, { easing: 'sineInOut' }),
            ).start();
        }

        // 2) 主标题 48px + 副标题 16px
        label(card, this._t('graduate.title', undefined, '出师啦！'),
            Math.round(48 * scale), 0, yTitle, new Color(248, 250, 252, 255));
        label(card, this._t('graduate.subtitle', undefined, '— 新手训练全部完成 —'),
            Math.round(16 * scale), 0, ySubtitle, new Color(148, 163, 184, 230));

        // 3) 技能 checklist（消除类型）—— emoji 固定（跨语言统一），文字走 i18n。
        const skills: Array<[string, string, string]> = [
            ['🧩', this._t('graduate.skill.single', undefined, '单消'), 'single'],
            ['✨', this._t('graduate.skill.multi', undefined, '多消'), 'multi'],
            ['🌈', this._t('graduate.skill.mono', undefined, '同花'), 'mono'],
            ['🔥', this._t('graduate.skill.combo', undefined, '连击'), 'combo'],
            ['🌟', this._t('graduate.skill.perfect', undefined, '清屏'), 'perfect'],
        ];
        const skillStep = Math.min(86, (vs.width - 40) / skills.length);
        const skillStart = -((skills.length - 1) * skillStep) / 2;
        const skillsRow = new Node('Skills');
        skillsRow.parent = card;
        inheritLayer(skillsRow, card);
        skillsRow.setPosition(0, ySkills, 0);
        skills.forEach(([emoji, name], i) => {
            const x = skillStart + i * skillStep;
            label(skillsRow, emoji, Math.round(46 * scale), x, 18 * scale, Color.WHITE);
            label(skillsRow, name, Math.round(17 * scale), x, -26 * scale,
                new Color(226, 232, 240, 245));
            label(skillsRow, '✓', Math.round(17 * scale), x + 26 * scale, 32 * scale,
                new Color(52, 211, 153, 255));
            // 第 3 元 skillId 暂未使用（保留用于未来按 id 切高亮 / 链接到具体课程回放）
        });

        // 4) 训练得分（放到消除类型下方）—— 上下两行：
        //   上行：小号灰色「训练得分」标签 (17px)
        //   下行：大号金色 +1080 (60px)
        //   两行垂直排布，避免之前"水平并排导致大数字宽度撞到标签"的重叠问题。
        label(card, this._t('graduate.scoreLabel', undefined, '训练得分'),
            Math.round(17 * scale), 0, yScore + 32 * scale, new Color(148, 163, 184, 235));
        const scoreStr = `+${this._score}`;
        const scoreFs = scoreStr.length >= 6 ? 48 : scoreStr.length >= 5 ? 54 : 60;
        const scoreLbl = label(card, scoreStr, Math.round(scoreFs * scale), 0, yScore - 6 * scale,
            new Color(253, 224, 71, 255));
        if (!Motion.reduced) {
            const sn = scoreLbl.node;
            sn.setScale(0.4, 0.4, 1);
            tween(sn).to(0.45, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
                .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }).start();
        }

        // 5) 新手礼包（参考技能 checklist 的 emoji + 标签 横排方式）
        //    直接按 i18n key 构建结构化条目（emoji + 已翻译文案），不再用文本解析，
        //    避免 _parseReward 在非中文环境无法识别"提示/撤销/金币"关键字。
        if (reward) {
            const rewardItems: Array<[string, string]> = [
                ['💡', this._t('graduate.reward.hint', undefined, '提示×2')],
                ['↩️', this._t('graduate.reward.undo', undefined, '撤销×1')],
                ['💰', this._t('graduate.reward.coin', undefined, '金币×100')],
            ];
            label(card, this._t('graduate.reward.title', undefined, '🎁 新手礼包'),
                Math.round(16 * scale), 0, yReward + 36 * scale, new Color(252, 211, 77, 230));
            const rStep = Math.min(110, (vs.width - 32) / Math.max(rewardItems.length, 1));
            const rStart = -((rewardItems.length - 1) * rStep) / 2;
            const rewardRow = new Node('RewardRow');
            rewardRow.parent = card;
            inheritLayer(rewardRow, card);
            rewardRow.setPosition(0, yReward - 8 * scale, 0);
            rewardItems.forEach(([icon, text], i) => {
                const x = rStart + i * rStep;
                label(rewardRow, icon, Math.round(38 * scale), x, 12 * scale, Color.WHITE);
                label(rewardRow, text, Math.round(15 * scale), x, -22 * scale,
                    new Color(253, 230, 138, 245));
            });
            if (!Motion.reduced) {
                const op = rewardRow.addComponent(UIOpacity);
                op.opacity = 220;
                tween(op).repeatForever(
                    tween(op)
                        .to(1.2, { opacity: 255 }, { easing: 'sineInOut' })
                        .to(1.2, { opacity: 220 }, { easing: 'sineInOut' }),
                ).start();
            }
        }

        // 6) 主 CTA「开始挑战」（中部居下，整屏视觉焦点）+ 副钩子
        const ctaW = Math.min(340, vs.width - 48);
        const ctaH = Math.round(72 * scale);
        const cta = button(card, this._t('graduate.cta', undefined, '🚀  开始挑战'),
            0, yCta, Math.round(20 * scale),
            () => this.finish({ done: true }),
            new Color(56, 189, 248, 255),
            { primary: true, width: ctaW, height: ctaH, radius: ctaH / 2 });
        if (!Motion.reduced) {
            tween(cta.node).repeatForever(
                tween(cta.node)
                    .to(1.6, { scale: new Vec3(1.045, 1.045, 1) }, { easing: 'sineInOut' })
                    .to(1.6, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();
        }
        label(card, this._t('graduate.ctaHint', undefined, '正式对局规则一致 · PB 等你刷新 🏆'),
            Math.round(13 * scale), 0, yCtaHint, new Color(148, 163, 184, 235));

        try { AudioManager.sfxUnlock(); } catch { /* ignore */ }
    }

    /**
     * 结业页背景氛围：
     *   - 中心金色径向光斑（多层 alpha 圆叠加近似 radial gradient）；
     *   - 5 色斜飞带（confetti 简化版），自顶向中部飞落，循环往复。
     * 全部装饰元素挂在 graduate 卡最底层，不阻挡上层文字 / 按钮命中。
     */
    private _paintGraduateAmbient(parent: Node, vs: { width: number; height: number }): void {
        // 仅保留五彩纸屑斜飞带（已移除中央径向光圈 —— 玩家反馈"圆环干扰主体信息"）。
        if (Motion.reduced) return;
        const confettiColors: Color[] = [
            new Color(251, 191, 36, 220),  // 金
            new Color(56, 189, 248, 220),  // 蓝
            new Color(248, 113, 113, 210), // 红
            new Color(167, 243, 208, 220), // 薄荷
            new Color(244, 114, 182, 210), // 粉
        ];
        const confettiLayer = new Node('Confetti');
        confettiLayer.parent = parent;
        inheritLayer(confettiLayer, parent);
        confettiLayer.setSiblingIndex(1);
        for (let i = 0; i < 14; i++) {
            const c = new Node(`c${i}`);
            c.parent = confettiLayer;
            inheritLayer(c, confettiLayer);
            const startX = (Math.random() - 0.5) * vs.width;
            const startY = vs.height / 2 + 40;
            c.setPosition(startX, startY, 0);
            const w = 6 + Math.random() * 6;
            const h = 10 + Math.random() * 8;
            c.addComponent(UITransform).setContentSize(w, h);
            const cg = c.addComponent(Graphics);
            cg.fillColor = confettiColors[i % confettiColors.length];
            cg.roundRect(-w / 2, -h / 2, w, h, 2);
            cg.fill();
            const op = c.addComponent(UIOpacity);
            op.opacity = 0;
            const dur = 3.4 + Math.random() * 2.2;
            const dx = (Math.random() - 0.5) * 220;
            const delay = Math.random() * 2.8;
            const dy = -vs.height - 80;
            tween(c).delay(delay).repeatForever(
                tween(c)
                    .set({ position: new Vec3(startX, startY, 0) })
                    .to(dur, { position: new Vec3(startX + dx, startY + dy, 0) }, { easing: 'sineInOut' })
                    .delay(0.4 + Math.random() * 1.6),
            ).start();
            tween(op).delay(delay).repeatForever(
                tween(op)
                    .set({ opacity: 0 })
                    .to(0.4, { opacity: 200 })
                    .delay(dur - 1)
                    .to(0.6, { opacity: 0 })
                    .delay(0.4 + Math.random() * 1.6),
            ).start();
        }
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
