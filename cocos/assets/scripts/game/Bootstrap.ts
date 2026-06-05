import {
    _decorator, Component, Node, Graphics, UITransform, Color, view, screen, sys, ResolutionPolicy,
    Sprite, SpriteFrame, UIOpacity, Label, tween, resources, director,
} from 'cc';
import {
    GameModel, MetaState, createEngineSpawner, initLocale, getConfig, flag, Analytics,
    applyAprilFoolsIfActive, PlayerContext, setSpawnContextProvider,
} from '../core';
import { BoardView } from './BoardView';
import { DockView } from './DockView';
import { Hud } from './Hud';
import { LineClearFx } from './effects/LineClearFx';
import { FxLayer } from './effects/FxLayer';
import { GameController } from './GameController';
import { SkillBar } from './skills/SkillBar';
import { MetaPanel } from './ui/MetaPanel';
import { MainMenu } from './ui/MainMenu';
import { Tutorial } from './ui/Tutorial';
import { Modal, TapBus, button, PillButton } from './ui/uiKit';
import { setFatalRoot, guard } from './ui/Fatal';
import { Storage, STORAGE_KEYS } from './platform/Storage';
import { Platform } from './platform/Platform';
import { registerWechat } from './platform/wechat/WechatAdapters';
import { registerNativeMonetization, hasNativeMonetization } from './platform/NativeMonetization';
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
    private _dockView: DockView | null = null;
    private _hud: Node | null = null;
    private _skillBar: Node | null = null;
    private _buttons: Node[] = [];
    private _board: BoardView | null = null;
    private _lineFx: LineClearFx | null = null;
    private _fx: FxLayer | null = null;
    private _ctrl: GameController | null = null;
    /** 上次实际应用的分辨率/窗口尺寸键，用于跳过冗余的 setDesignResolutionSize/canvas-resize。 */
    private _lastViewKey = '';

    onLoad(): void {
        // 最早注册兜底根：之后任何启动异常都画到屏幕（原生黑屏 → 可读报错）。
        setFatalRoot(this.node);
        guard('Bootstrap.onLoad', () => this.boot());
    }

    private boot(): void {
        Modal.reset();
        TapBus.reset();
        initLocale();
        Analytics.useSink(makeAnalyticsSink());
        // 节日彩蛋（对齐 web）：4/1 把所有皮肤 blockIcons 换成表情 emoji。必须在建模/渲染前执行。
        applyAprilFoolsIfActive({ optOut: Storage.get(STORAGE_KEYS.aprilFoolsOptout, '0') === '1' });

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

        // 玩家画像 / 出块上下文（web _spawnContext 的引擎无关下沉）：注入 provider 喂给真实引擎，
        // 并以 onRound 推进节奏计数。GameController 负责在消行/计分事件里更新。
        const playerCtx = new PlayerContext();
        playerCtx.setBest(best);
        setSpawnContextProvider(() => playerCtx.snapshot());

        // 接入与 web 完全同源的真实出块闭包；引擎异常时 GameModel 自动回退内置自适应。
        const model: GameModel = new GameModel({
            best,
            coins,
            skinId,
            mode,
            spawnFn: createEngineSpawner({
                strategyId: 'normal',
                getSkin: () => model.skin,
                onRound: () => playerCtx.onRound(),
            }),
        });
        const meta = new MetaState();
        meta.fromJSON(Storage.getJSON(STORAGE_KEYS.meta, null));

        const bgNode = this.buildBackground(model);

        // 依据真实可见区域 + 安全区计算各组件锚位（顶部贴灵动岛/刘海之下，底部贴 Home 指示条之上）。
        const { buttonsY, hudY, skillY, dockY, dockWidth, dockHeight, dockCell, boardCenterY, boardPx } = L;

        // 盘面容器（屏幕抖动作用于此，候选区/HUD 不受影响）
        const play = new Node('Play');
        play.parent = this.node;
        play.setPosition(0, boardCenterY, 0);
        play.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        const board = this.attach(play, 'Board', 0, 0, BoardView, (v) => { v.boardPx = boardPx; });
        const lineFx = this.attach(play, 'BoardLineFx', 0, 0, LineClearFx, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });
        const fx = this.attach(play, 'BoardFx', 0, 0, FxLayer, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });

        const dock = this.attach(this.node, 'Dock', 0, dockY, DockView, (v) => {
            v.setLayout(dockWidth, dockHeight, dockCell);
        });
        this._dockView = dock;
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
        ctrl.wire({ model, meta, board, lineFx, fx, dock, hud, ghost, skillBar, metaPanel, shakeTarget: play, bgNode, playerCtx });
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
        this.showSplash();
        this.showMainMenu(ctrl, model, mode);

        // 多次重排：onLoad / 首帧阶段原生视图尺寸常处于过渡态（getVisibleSize 与父节点世界变换暂不一致），
        // 在视图稳定后再重排，让候选区等子节点的最终位置收敛到正确值。
        this.scheduleOnce(() => this.relayout(), 0);
        this.scheduleOnce(() => this.relayout(), 0.3);
        this.scheduleOnce(() => this.relayout(), 0.8);

        // 心跳诊断：确认 boot 跑完 + 帧循环是否推进（区分「卡死」与「画了但不可见」）。
        console.log(`[OpenBlock] boot() done. children=${this.node.children.length} scene=${director.getScene()?.name}`);
        this.scheduleOnce(() => console.log(`[OpenBlock] heartbeat t=1s frames=${director.totalFrames}`), 1);
        this.scheduleOnce(() => console.log(`[OpenBlock] heartbeat t=3s frames=${director.totalFrames}`), 3);
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
    /**
     * 启动画面：用 App 图标（assets/resources/launch.png）铺在品牌深色底（#0f1525，与 web theme-color 一致）
     * 上居中展示，约 1s 后淡出销毁。非交互（不注册 TapBus），不会拦截 HUD 点击。
     * 图标加载失败时回退为「OPEN BLOCK」字标，保证任何情况下都有体面的启动屏。
     */
    private showSplash(): void {
        const root = new Node('Splash');
        root.parent = this.node;
        root.setSiblingIndex(this.node.children.length - 1);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const op = root.addComponent(UIOpacity);
        op.opacity = 255;

        // 品牌深色满屏底（取足够大尺寸覆盖各机型可见区）。
        const bg = new Node('bg');
        bg.parent = root;
        bg.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = bg.addComponent(Graphics);
        g.fillColor = new Color(15, 21, 37, 255);
        g.rect(-1500, -2200, 3000, 4400);
        g.fill();

        // 字标兜底（图标加载成功后隐藏）。
        const word = new Node('word');
        word.parent = root;
        word.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const wl = word.addComponent(Label);
        wl.string = 'OPEN BLOCK';
        wl.fontSize = 64;
        wl.lineHeight = 72;
        wl.color = new Color(120, 220, 255, 255);

        const iconNode = new Node('icon');
        iconNode.parent = root;
        const it = iconNode.addComponent(UITransform);
        it.setAnchorPoint(0.5, 0.5);
        const side = 460;
        it.setContentSize(side, side);
        const sp = iconNode.addComponent(Sprite);
        if (sp.sizeMode !== undefined && Sprite.SizeMode) sp.sizeMode = Sprite.SizeMode.CUSTOM;
        iconNode.active = false;

        resources.load('launch/spriteFrame', SpriteFrame, (err: unknown, sf: unknown) => {
            if (!iconNode.isValid) return;
            if (err || !sf) return; // 加载失败：保留字标兜底
            sp.spriteFrame = sf;
            iconNode.active = true;
            word.active = false;
        });

        // 约 1s 展示后淡出并销毁；用 UIOpacity 让整棵子树一起渐隐。
        this.scheduleOnce(() => {
            if (!root.isValid) return;
            tween(op).to(0.45, { opacity: 0 }).call(() => { if (root.isValid) root.destroy(); }).start();
        }, 1.0);
    }

    private iconButton(name: string, x: number, y: number, icon: string, w: number, onClick: () => void): PillButton {
        // 对齐 web `.feedback-toggle-btn`：深色半透明圆角芯片（rgba(22,26,38,.78)）+ 浅边框 + 亮图标。
        const pb = button(this.node, icon, x, y, 34, onClick, new Color(22, 26, 38, 215), {
            width: w, height: 80, radius: 18,
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
        dockWidth: number; dockHeight: number; dockCell: number;
        boardPx: number; boardCenterY: number;
    } {
        const vis = view.getVisibleSize();
        const inset = this.safeAreaInsets(vis.height);
        const halfH = vis.height / 2;
        // 顶部图标按钮高约 84，留足半高 + 余量，整排稳稳落在安全区之下（避免上缘被刘海/灵动岛吞触摸）。
        const buttonsY = halfH - inset.top - 58;
        const hudY = buttonsY - 112;
        // 底部技能栏略上移，候选区再抬高并放大（格子和槽区更宽更高）。
        const skillY = -halfH + inset.bottom + 72;
        const dockY = skillY + 118;
        const dockWidth = Math.min(vis.width - 20, 700);
        const boardTop = hudY - 60;     // HUD 文本之下留白
        const sideMargin = 12;
        const wBudget = vis.width - sideMargin * 2;
        // 先算盘面边长，再令候选格 = 盘面格（对齐 web _getDockCellPx ↔ board display cell）。
        const dockHeightEst = 160;
        const boardBottomEst = dockY + dockHeightEst / 2 + 32;
        const vBudget = boardTop - boardBottomEst;
        const boardPx = Math.max(240, Math.min(wBudget, vBudget));
        const boardCell = boardPx / 8;
        const dockCell = boardCell;
        const dockHeight = Math.max(132, Math.round(dockCell * 5 + 28));
        const boardBottom = dockY + dockHeight / 2 + 32;
        const boardCenterY = (boardTop + boardBottom) / 2;
        return {
            width: vis.width, halfH, safeTop: inset.top, safeBottom: inset.bottom,
            buttonsY, hudY, skillY, dockY, dockWidth, dockHeight, dockCell,
            boardPx, boardCenterY,
        };
    }

    /** 按当前可见区域 + 安全区重新计算并应用所有组件锚位与盘面尺寸（首帧后 / 尺寸变化时调用）。 */
    private relayout(): void {
        guard('Bootstrap.relayout', () => this.relayoutImpl());
    }

    private relayoutImpl(): void {
        this.applyResolutionPolicy(720, 1280);
        const m = this.computeLayout();
        if (this._play) this._play.setPosition(0, m.boardCenterY, 0);
        if (this._dock) this._dock.setPosition(0, m.dockY, 0);
        this._dockView?.setLayout(m.dockWidth, m.dockHeight, m.dockCell);
        if (this._hud) this._hud.setPosition(0, m.hudY, 0);
        if (this._skillBar) this._skillBar.setPosition(0, m.skillY, 0);
        for (const b of this._buttons) b.setPosition(b.position.x, m.buttonsY, 0);
        // 盘面/特效层同步边长并重绘（保持正方形铺满）。
        if (this._board) this._board.setBoardPx(m.boardPx);
        if (this._lineFx) this._lineFx.setBoardPx(m.boardPx);
        if (this._fx) this._fx.setBoardPx(m.boardPx);
        this._ctrl?.redrawBoard();
        this._ctrl?.refreshDock();
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
        const policy = ResolutionPolicy.FIXED_WIDTH;
        // 仅在「窗口尺寸真正变化」时重设分辨率 + 触发 canvas-resize。
        // 原因：原生 iOS 上 emit('canvas-resize') 会触发 Metal swapchain 在渲染线程重建（碰 CAMetalLayer），
        // 启动期多次重复调用会反复踩 UIKit 主线程检查 → 卡死/黑屏。去重后只在确有变化时做一次。
        const key = `${designW}x${designH}@${fw}x${fh}`;
        if (key !== this._lastViewKey) {
            this._lastViewKey = key;
            view.setDesignResolutionSize(designW, designH, policy);
            // 3.8.4+ setDesignResolutionSize 不再自动重排 Canvas/相机，需手动 canvas-resize，
            // 否则相机按旧设计分辨率渲染（画面缩在中央、四周黑边）。
            try { view.emit('canvas-resize'); } catch { /* ignore */ }
        }
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
        console.log(`[OpenBlock] platform = ${p} appId = ${getConfig().appId}`);
        // 微信小游戏：配置了 adUnitId 即注入真实激励视频/IAP 适配器
        const ad = getConfig().adUnitIds;
        const hasAd = Object.values(ad).some((v) => !!v);
        if (Platform.isWechat() && hasAd) {
            registerWechat(ad);
        }
        // 原生 iOS/Android 壳：若注入了原生桥（__openblockNative），接入原生广告/IAP 适配器。
        if (Platform.isNative() && hasNativeMonetization()) {
            const ok = registerNativeMonetization();
            console.log(`[OpenBlock] native monetization bridge = ${ok ? 'installed' : 'absent'}`);
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

    /**
     * 主菜单首屏（对齐 web `#menu`）：盖在已就绪的牌局之上，点「开始/继续」后淡出，
     * 并触发入场流程（回归礼包）+ 首次引导。游戏在菜单期间因 Modal 暂停输入/计时。
     */
    /** 进入对局后把顶栏 HUD 按钮提到最上层，避免被残留浮层挡住点击。 */
    private raiseHudButtons(): void {
        if (!this._buttons.length) return;
        const top = this.node.children.length - 1;
        this._buttons.forEach((b, i) => b.setSiblingIndex(Math.max(0, top - i)));
    }

    private showMainMenu(ctrl: GameController, model: GameModel, mode: GameMode): void {
        const menuNode = new Node('MainMenu');
        menuNode.parent = this.node;
        menuNode.layer = this.node.layer;
        const menu = menuNode.addComponent(MainMenu);
        menu.setup({
            best: model.best,
            mode,
            resumable: ctrl.hasResumableSave(),
            onPlay: (m: GameMode) => {
                this.raiseHudButtons();
                // 入场礼包弹窗关闭后再出首次引导，避免引导全屏 TapBus 盖住弹窗按钮。
                ctrl.enterFromMenu(m, () => this.maybeShowTutorial());
            },
            onSkin: () => ctrl.openSkinPanel(),
            onLore: () => ctrl.openLore(),
            onReplay: () => ctrl.openReplays(),
            onMeta: () => ctrl.toggleMeta(),
            onLeaderboard: flag('leaderboard') ? () => ctrl.showLeaderboard() : null,
            onWheel: flag('wheel') ? () => ctrl.openWheel() : null,
        });
        // 等 viewport 稳定且启动屏结束后再显示菜单，避免 Splash 盖住主 CTA。
        this.scheduleOnce(() => menu.show(), 1.05);
    }
}
