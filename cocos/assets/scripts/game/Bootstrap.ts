import { _decorator, Component, Node, Graphics, UITransform, Color, view, screen, sys, ResolutionPolicy } from 'cc';
import {
    GameModel, MetaState, createEngineSpawner, initLocale, getConfig, flag, Analytics,
} from '../core';
import { BoardView } from './BoardView';
import { DockView } from './DockView';
import { Hud } from './Hud';
import { LineClearFx } from './effects/LineClearFx';
import { FxLayer } from './effects/FxLayer';
import { GameController } from './GameController';
import { SkillBar } from './skills/SkillBar';
import { MetaPanel } from './ui/MetaPanel';
import { Tutorial } from './ui/Tutorial';
import { Modal, button, PillButton } from './ui/uiKit';
import { Storage, STORAGE_KEYS } from './platform/Storage';
import { Platform } from './platform/Platform';
import { registerWechat } from './platform/wechat/WechatAdapters';
import { makeAnalyticsSink } from './platform/AnalyticsSink';
import { CloudSync } from './platform/CloudSync';
import { bgColor } from './skin/palette';
import { seasonalSkinId } from './skin/seasonalSkin';
import { GameMode } from '../core';

const { ccclass, property } = _decorator;

/**
 * 代码优先启动器：挂到 Canvas 下空节点即可运行整局（Phase 0→4 全链路）。
 * 布局（设计分辨率约 720×1280）：HUD → 盘面+特效 → 候选区 → 技能栏，叠加元系统面板/引导。
 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {
    @property
    boardPx = 480;

    // 布局节点引用（用于尺寸变化/首帧后重排）
    private _play: Node | null = null;
    private _dock: Node | null = null;
    private _hud: Node | null = null;
    private _skillBar: Node | null = null;
    private _buttons: Node[] = [];
    private _board: BoardView | null = null;
    private _lineFx: LineClearFx | null = null;
    private _fx: FxLayer | null = null;
    private _ctrl: GameController | null = null;

    onLoad(): void {
        Modal.reset();
        initLocale();
        Analytics.useSink(makeAnalyticsSink());

        // 关键：代码优先工程必须显式锁定设计分辨率 + 铺满策略，并按安全区布局。
        // 否则原生 iOS 端会用引擎默认分辨率 → 画面留黑边（未铺满）且 getUILocation 坐标
        // 与节点世界坐标不在同一空间 → 候选区/盘面命中检测全部落空（界面无法交互）。
        this.setupViewport();
        const L = this.computeLayout();

        const best = Storage.getNumber(STORAGE_KEYS.best, 0);
        const coins = Storage.getNumber(STORAGE_KEYS.coins, 30);
        // 未手动选皮肤时按季节给默认皮肤（季节皮肤）
        const skinId = Storage.get(STORAGE_KEYS.skin, null) || seasonalSkinId();
        const mode = (Storage.get(STORAGE_KEYS.mode, 'classic') || 'classic') as GameMode;

        // 接入与 web 完全同源的真实出块闭包；引擎异常时 GameModel 自动回退内置自适应。
        const model: GameModel = new GameModel({
            best,
            coins,
            skinId,
            mode,
            spawnFn: createEngineSpawner({ strategyId: 'normal', getSkin: () => model.skin }),
        });
        const meta = new MetaState();
        meta.fromJSON(Storage.getJSON(STORAGE_KEYS.meta, null));

        const bgNode = this.buildBackground(model);

        // 依据真实可见区域 + 安全区计算各组件锚位（顶部贴灵动岛/刘海之下，底部贴 Home 指示条之上）。
        const { buttonsY, hudY, skillY, dockY, boardCenterY, boardPx } = L;

        // 盘面容器（屏幕抖动作用于此，候选区/HUD 不受影响）
        const play = new Node('Play');
        play.parent = this.node;
        play.setPosition(0, boardCenterY, 0);
        play.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        const board = this.attach(play, 'Board', 0, 0, BoardView, (v) => { v.boardPx = boardPx; });
        const lineFx = this.attach(play, 'BoardLineFx', 0, 0, LineClearFx, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });
        const fx = this.attach(play, 'BoardFx', 0, 0, FxLayer, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });

        const dock = this.attach(this.node, 'Dock', 0, dockY, DockView);
        const hud = this.attach(this.node, 'Hud', 0, hudY, Hud);
        const skillBar = this.attach(this.node, 'SkillBar', 0, skillY, SkillBar);
        this._play = play;
        this._dock = dock.node;
        this._hud = hud.node;
        this._skillBar = skillBar.node;
        this._board = board;
        this._lineFx = lineFx;
        this._fx = fx;

        const ghost = new Node('Ghost');
        ghost.parent = this.node;
        ghost.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        ghost.addComponent(Graphics);

        const metaPanel = this.attach(this.node, 'MetaPanel', 0, 0, MetaPanel);

        const ctrl = this.node.addComponent(GameController);
        ctrl.wire({ model, meta, board, lineFx, fx, dock, hud, ghost, skillBar, metaPanel, shakeTarget: play, bgNode });
        this._ctrl = ctrl;

        // 顶部按钮行：皮肤 / 模式 / 每日 / 转盘 / 排行 / 分享 / 声音
        // 按启用项数量自适应排布（居中铺满），保证每个图标按钮有足够触摸区且不超出屏宽。
        const soundOn = Storage.get(STORAGE_KEYS.sound, '1') !== '0';
        const defs: Array<{ name: string; icon: string; onClick: () => void; sound?: boolean }> = [];
        defs.push({ name: 'SkinBtn', icon: '🎨', onClick: () => ctrl.openSkinPanel() });
        if (flag('modes')) defs.push({ name: 'ModeBtn', icon: '🎮', onClick: () => ctrl.selectMode() });
        defs.push({ name: 'MetaBtn', icon: '📅', onClick: () => ctrl.toggleMeta() });
        if (flag('wheel')) defs.push({ name: 'WheelBtn', icon: '🎡', onClick: () => ctrl.openWheel() });
        if (flag('leaderboard')) defs.push({ name: 'RankBtn', icon: '🏆', onClick: () => ctrl.showLeaderboard() });
        if (flag('share')) defs.push({ name: 'ShareBtn', icon: '📤', onClick: () => ctrl.doShare() });
        defs.push({ name: 'SoundBtn', icon: soundOn ? '🔊' : '🔇', onClick: () => { /* 占位，下方注入 */ }, sound: true });

        this._buttons = [];
        const n = defs.length;
        // 用固定设计宽（FIXED_WIDTH 策略下恒为 720）布局 X，避免 onLoad 阶段 visibleSize 过渡态导致错位。
        const fullW = 720;
        const step = Math.min(102, (fullW - 24) / n); // 居中铺满，两侧各留 12 余量
        const btnW = Math.min(92, step - 10);
        const startX = -((n - 1) * step) / 2;
        defs.forEach((d, i) => {
            const x = startX + i * step;
            if (d.sound) {
                const pb = this.iconButton(d.name, x, buttonsY, d.icon, btnW, () => {
                    const on = ctrl.toggleSound();
                    pb.setText(on ? '🔊' : '🔇');
                });
                this._buttons.push(pb.node);
            } else {
                this._buttons.push(this.iconButton(d.name, x, buttonsY, d.icon, btnW, d.onClick).node);
            }
        });

        this.detectPlatform();
        this.maybeShowTutorial();

        // 多次重排：onLoad / 首帧阶段原生视图尺寸常处于过渡态（getVisibleSize 与父节点世界变换暂不一致），
        // 在视图稳定后再重排，让候选区等子节点的最终位置收敛到正确值。
        this.scheduleOnce(() => this.relayout(), 0);
        this.scheduleOnce(() => this.relayout(), 0.3);
        this.scheduleOnce(() => this.relayout(), 0.8);
    }

    private attach<T extends Component>(
        parent: Node, name: string, x: number, y: number, comp: new () => T, init?: (c: T) => void,
    ): T {
        const n = new Node(name);
        n.parent = parent;
        n.setPosition(x, y, 0);
        const c = n.addComponent(comp);
        if (init) init(c);
        return c;
    }

    /**
     * 顶部图标按钮（emoji + 可见圆角背景）。命中区 = 可见背景（约 92×84），远大于旧实现
     * 按 emoji 文字推算的 ~52×42，修复「相邻按钮间死区大、原生端点不动」。
     */
    private iconButton(name: string, x: number, y: number, icon: string, w: number, onClick: () => void): PillButton {
        const pb = button(this.node, icon, x, y, 34, onClick, new Color(40, 48, 68, 228), {
            width: w, height: 84, radius: 22,
        });
        pb.node.name = name;
        return pb;
    }

    /**
     * 锁定设计分辨率（720×1280）+ 铺满策略，并返回按安全区计算后的可见区域布局。
     * 旋转/窗口尺寸变化时自动重新铺满（iOS 竖屏锁定下主要兜底分屏/外接显示）。
     */
    private setupViewport(): void {
        this.applyResolutionPolicy(720, 1280);
        // 尺寸/旋转变化时重新铺满并重排布局（不仅仅是重设分辨率）
        screen.on('window-resize', () => this.relayout(), this);
        screen.on('orientation-change', () => this.relayout(), this);
    }

    /**
     * 依据当前可见区域 + 安全区计算全部布局指标。
     * 盘面保持正方形并"横向铺满"：边长取「屏宽预算」与「纵向预算」较小值——
     * 竖屏手机上屏宽通常更小 → 盘面边长 = 屏宽 - 2×边距（左右铺满）；
     * 极宽屏（如平板）则受纵向预算约束，避免压到 HUD/候选区（与 web clamp 同思路）。
     */
    private computeLayout(): {
        width: number; halfH: number; safeTop: number; safeBottom: number;
        buttonsY: number; hudY: number; skillY: number; dockY: number;
        boardPx: number; boardCenterY: number;
    } {
        const vis = view.getVisibleSize();
        const inset = this.safeAreaInsets(vis.height);
        const halfH = vis.height / 2;
        // 顶部图标按钮高约 84，留足半高 + 余量，整排稳稳落在安全区之下（避免上缘被刘海/灵动岛吞触摸）。
        const buttonsY = halfH - inset.top - 58;
        const hudY = buttonsY - 112;
        const skillY = -halfH + inset.bottom + 54;
        const dockY = skillY + 152;
        const boardTop = hudY - 60;     // HUD 文本之下留白
        const boardBottom = dockY + 80; // 候选区之上留白
        const vBudget = boardTop - boardBottom;
        const sideMargin = 12;
        const wBudget = vis.width - sideMargin * 2;
        const boardPx = Math.max(240, Math.min(wBudget, vBudget));
        const boardCenterY = (boardTop + boardBottom) / 2;
        return {
            width: vis.width, halfH, safeTop: inset.top, safeBottom: inset.bottom,
            buttonsY, hudY, skillY, dockY, boardPx, boardCenterY,
        };
    }

    /** 按当前可见区域 + 安全区重新计算并应用所有组件锚位与盘面尺寸（首帧后 / 尺寸变化时调用）。 */
    private relayout(): void {
        this.applyResolutionPolicy(720, 1280);
        const m = this.computeLayout();
        if (this._play) this._play.setPosition(0, m.boardCenterY, 0);
        if (this._dock) this._dock.setPosition(0, m.dockY, 0);
        if (this._hud) this._hud.setPosition(0, m.hudY, 0);
        if (this._skillBar) this._skillBar.setPosition(0, m.skillY, 0);
        for (const b of this._buttons) b.setPosition(b.position.x, m.buttonsY, 0);
        // 盘面/特效层同步边长并重绘（保持正方形铺满）。
        if (this._board) this._board.setBoardPx(m.boardPx);
        if (this._lineFx) this._lineFx.setBoardPx(m.boardPx);
        if (this._fx) this._fx.setBoardPx(m.boardPx);
        this._ctrl?.redrawBoard();
    }

    /**
     * 竖屏锁定游戏统一用 FIXED_WIDTH：设计宽(720)恒等于屏幕宽，左右铺满、上下按屏幕比例延伸，
     * 不留黑边、不裁剪横向内容（按钮在 ±330 内）。早期自动按比例选轴在原生端取不到稳定窗口尺寸时
     * 会误选 FIXED_HEIGHT，导致可见宽变窄、盘面"横向铺满"，故此处固定为 FIXED_WIDTH。
     */
    private applyResolutionPolicy(designW: number, designH: number): void {
        let fw = 0;
        let fh = 0;
        try {
            const ws = screen.windowSize;
            fw = ws.width;
            fh = ws.height;
        } catch { /* 仅用于日志 */ }
        view.setDesignResolutionSize(designW, designH, ResolutionPolicy.FIXED_WIDTH);
        const policy = ResolutionPolicy.FIXED_WIDTH;
        // 关键：3.8.4+ 起 setDesignResolutionSize 不会自动重排 Canvas/相机，必须手动触发 canvas-resize，
        // 否则相机仍按旧设计分辨率渲染（画面缩在屏幕中央、四周黑边）。
        try { view.emit('canvas-resize'); } catch { /* ignore */ }
        // 诊断日志：在 Xcode 控制台确认原生端真实尺寸是否就绪（若 win 远小于真机像素 = iOS 兼容缩放/启动屏缺失）
        try {
            const vis = view.getVisibleSize();
            const fr = view.getFrameSize();
            console.log(`[OpenBlock] viewport win=${fw}x${fh} frame=${fr.width}x${fr.height} visible=${vis.width}x${vis.height} dpr=${screen.devicePixelRatio} policy=${policy === ResolutionPolicy.FIXED_WIDTH ? 'FIXED_WIDTH' : 'FIXED_HEIGHT'}`);
        } catch { /* ignore */ }
    }

    /** 安全区内边距（设计坐标系）。参照 web：max(env(safe-area-inset), 兜底)，避免刘海/灵动岛/Home 条遮挡。 */
    private safeAreaInsets(visH: number): { top: number; bottom: number } {
        let top = 0;
        let bottom = 0;
        try {
            const sa = sys.getSafeAreaRect(); // 原点左下，已换算到当前可见设计坐标
            top = visH - (sa.y + sa.height);
            bottom = sa.y;
        } catch { /* 老设备/不支持时退化为兜底值 */ }
        const phone = sys.isMobile || sys.isNative;
        return {
            top: Math.max(top, phone ? 64 : 16),
            bottom: Math.max(bottom, phone ? 28 : 8),
        };
    }

    private buildBackground(model: GameModel): Node {
        const n = new Node('Bg');
        n.parent = this.node;
        n.setSiblingIndex(0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = bgColor(model.skin);
        g.rect(-1000, -1500, 2000, 3000);
        g.fill();
        return n;
    }

    private detectPlatform(): void {
        const p = Platform.name();
        console.log(`[OpenBlock] platform = ${p}`);
        // 微信小游戏：配置了 adUnitId 即注入真实激励视频/IAP 适配器
        const ad = getConfig().adUnitIds;
        const hasAd = Object.values(ad).some((v) => !!v);
        if (Platform.isWechat() && hasAd) {
            registerWechat(ad);
        }
        // 拉云存档（取 best 较大者合并）
        if (flag('cloudSave')) {
            CloudSync.pull((cloud) => {
                if (cloud && cloud.best > Storage.getNumber(STORAGE_KEYS.best, 0)) {
                    Storage.setNumber(STORAGE_KEYS.best, cloud.best);
                }
            });
        }
    }

    private maybeShowTutorial(): void {
        if (!Tutorial.shouldShow()) return;
        const n = new Node('Tutorial');
        n.parent = this.node;
        n.setSiblingIndex(this.node.children.length - 1);
        n.addComponent(Tutorial).setup();
    }
}
