import {
    _decorator, Component, Node, Graphics, UITransform, Color, view, screen, sys, ResolutionPolicy,
    Sprite, SpriteFrame, UIOpacity, tween, resources, director, game, Game,
} from 'cc';
import { AudioManager } from './audio/AudioManager';
import {
    GameModel, MetaState, createEngineSpawner, initLocale, getConfig, flag, Analytics,
    applyAprilFoolsIfActive, PlayerContext, setSpawnContextProvider, configureLocalePersistence, t,
    initSpawnTuningV2, createPlayerProfile, getLocale, setLocale,
} from '../core';
import { BoardView } from './BoardView';
import { DockView } from './DockView';
import { Hud } from './Hud';
import { LineClearFx } from './effects/LineClearFx';
import { FxLayer } from './effects/FxLayer';
import { AmbientFx } from './effects/AmbientFx';
import { OverlayFx } from './effects/OverlayFx';
import { GameController } from './GameController';
import { SkillBar } from './skills/SkillBar';
import { MetaPanel } from './ui/MetaPanel';
import { MainMenu } from './ui/MainMenu';
import { Tutorial } from './ui/Tutorial';
import { Modal, TapBus, button, PillButton } from './ui/uiKit';
import { Wordmark } from './ui/Wordmark';
import { setFatalRoot, guard } from './ui/Fatal';
import { Storage, STORAGE_KEYS, setStorageWriteErrorHandler } from './platform/Storage';
import { Platform } from './platform/Platform';
import { registerWechat } from './platform/wechat/WechatAdapters';
import { registerNativeMonetization, hasNativeMonetization } from './platform/NativeMonetization';
import { makeAnalyticsSink } from './platform/AnalyticsSink';
import { CloudSync } from './platform/CloudSync';
import { Motion, initMotion } from './platform/Motion';
import { VisualFx, initVisualFx } from './platform/VisualFx';
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
    private _hudComp: Hud | null = null;
    private _skillBar: Node | null = null;
    private _buttons: Node[] = [];
    private _board: BoardView | null = null;
    private _ambientFx: AmbientFx | null = null;
    private _lineFx: LineClearFx | null = null;
    private _fx: FxLayer | null = null;
    private _overlayFx: OverlayFx | null = null;
    private _ctrl: GameController | null = null;
    /** 上次实际应用的分辨率/窗口尺寸键，用于跳过冗余的 setDesignResolutionSize/canvas-resize。 */
    private _lastViewKey = '';
    // 首帧布局稳定后置 true：之后任何 relayout 都只在 JS 重排节点，绝不再
    // setDesignResolutionSize / emit('canvas-resize') → 杜绝交换链/表面在渲染线程重建。
    //   · iOS：CCMTLSwapchain::doInit 跑在 consumer 线程里非法访问 -[UIView layer] → 主线程检查器冻屏；
    //   · Android：沉浸式 surfaceChanged 风暴 → EGL surface 反复重配 → 渲染线程顶死 / 黑屏（稳定复现端）。
    private _resolutionLocked = false;

    onLoad(): void {
        // 最早注册兜底根：之后任何启动异常都画到屏幕（原生黑屏 → 可读报错）。
        setFatalRoot(this.node);
        guard('Bootstrap.onLoad', () => this.boot());
    }

    private boot(): void {
        Modal.reset();
        TapBus.reset();
        // 先接好语言持久化 hook 再 init，让用户上次选择的 locale 优先生效（与 mobile/ios web 端一致）。
        configureLocalePersistence(
            () => Storage.get(STORAGE_KEYS.locale, null),
            (id) => Storage.set(STORAGE_KEYS.locale, id),
        );
        initLocale();
        // 一次性读 Storage + 系统 prefers-reduced-motion 偏好；后续 UI/FX 在执行动效前查 Motion.reduced。
        initMotion();
        initVisualFx();
        Analytics.useSink(makeAnalyticsSink());
        // 节日彩蛋（对齐 web）：4/1 把所有皮肤 blockIcons 换成表情 emoji。必须在建模/渲染前执行。
        applyAprilFoolsIfActive({ optOut: Storage.get(STORAGE_KEYS.aprilFoolsOptout, '0') === '1' });
        // 出块寻参 v2（SpawnParamTuner）：安装离线 θ bundle 并挂到 globalThis，
        // 使 createEngineSpawner → resolveAdaptiveStrategy 内的 resolveThetaV2 取到策略，θ 与 web 同源生效。
        //
        // ⚡ 冷启动优化：把 23k 行 θ bundle 的安装处理循环（install loop）从同步 boot 路径移到首帧之后，
        //   避免它阻塞第一帧渲染（首屏更快）。代价是「第一副 dock」在 install 完成前用 DEFAULT θ，
        //   约 1 帧后 install 完成、从第 2 副 dock 起用 v2 θ —— 这正是代码既有的「未部署/失败软回退」
        //   语义（resolveThetaV2 取不到 __openblockClientPolicyV2 时返回 DEFAULT θ），不影响可玩性。
        //   下一帧远早于任何用户落子/refillDock，故仅首副 dock 受影响。bundle 解析成本仍在引擎脚本
        //   加载期（静态 import 不可免），此处仅省去同步安装循环对首帧的阻塞。
        this.scheduleOnce(() => {
            if (!this.node?.isValid) return;
            try { initSpawnTuningV2(); } catch (e) { console.warn('[OpenBlock] deferred initSpawnTuningV2', e); }
        }, 0);

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

        // 真实玩家画像（与 web/小程序同源）：喂给 resolveAdaptiveStrategy 使寻参 θ 生效，
        // 并由 GameController 在落子/消行处驱动（recordPlace/recordMiss…）。
        const profile = createPlayerProfile();
        const userId = getConfig().cloudHttp?.userId || '';

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
                getProfile: () => profile,
                getScore: () => model.score,
                getBest: () => model.best,
                getUserId: () => userId,
            }),
        });
        const meta = new MetaState();
        meta.fromJSON(Storage.getJSON(STORAGE_KEYS.meta, null));

        const bgNode = this.buildBackground(model);

        // ⭐ 必须给 Bootstrap 节点本身加 UITransform —— ghost / 部分动效节点的 parent 是 this.node，
        // 业务代码（GameController.placeGhostAtTouch / moveGhost / repositionGhost）会调
        // `screenToLocal(this.ghost.parent, ...)` 把屏幕坐标换算成 parent 的局部坐标；
        // 若 parent 没有 UITransform，screenToLocal 会直接 early-return 一个 (0,0,0) 的 Vec3，
        // 表现就是「ghost 永远卡在 Bootstrap 节点的 (0,0) 上，怎么拖都不跟手」。
        // 历史成因：场景文件 Game.scene 里 Canvas 有 UITransform，但 Bootstrap node 没有 ——
        // 之前 `updateSnap` 还会在板面画半透明落点预览掩盖了这个 bug；最近为了消除「双重渲染」
        // 移除了那段渲染，bug 才暴露成「候选块完全不跟手」。
        // 注：size 不影响 convertToNodeSpaceAR 的换算（那只用 worldMatrix），传 1×1 + anchor (0.5,0.5)
        // 仅为最小化对场景内既有命中判定的影响；锚点保持中心，与 Canvas 子节点的常规约定一致。
        if (!this.node.getComponent(UITransform)) {
            this.node.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        }

        // 依据真实可见区域 + 安全区计算各组件锚位（顶部贴灵动岛/刘海之下，底部贴 Home 指示条之上）。
        const { buttonsY, hudY, skillY, dockY, dockWidth, dockHeight, dockCell, boardCenterY, boardPx } = L;

        // 盘面容器（屏幕抖动作用于此，候选区/HUD 不受影响）
        const play = new Node('Play');
        play.parent = this.node;
        play.setPosition(0, boardCenterY, 0);
        play.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        const board = this.attach(play, 'Board', 0, 0, BoardView, (v) => { v.boardPx = boardPx; });
        // 环境粒子层（皮肤主题：樱花/落叶/气泡…）置于盘面之上、消行特效之下，
        // 对齐 web fxCanvas 中 renderAmbient → 消行粒子的绘制顺序。
        const ambientFx = this.attach(play, 'BoardAmbient', 0, 0, AmbientFx, (v) => { v.boardPx = boardPx; });
        const lineFx = this.attach(play, 'BoardLineFx', 0, 0, LineClearFx, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });
        const fx = this.attach(play, 'BoardFx', 0, 0, FxLayer, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });
        // 全屏消行闪光层（combo/double/perfect/bonus），置于最顶 → 与 web fxCanvas 全屏闪光同层级。
        const overlayFx = this.attach(play, 'BoardOverlayFx', 0, 0, OverlayFx, (v) => { v.boardPx = boardPx; v.size = model.grid.size; });

        const dock = this.attach(this.node, 'Dock', 0, dockY, DockView, (v) => {
            v.setLayout(dockWidth, dockHeight, dockCell);
        });
        this._dockView = dock;
        const hud = this.attach(this.node, 'Hud', 0, hudY, Hud);
        const skillBar = this.attach(this.node, 'SkillBar', 0, skillY, SkillBar);
        this._play = play;
        this._dock = dock.node;
        this._hud = hud.node;
        this._hudComp = hud;
        this._skillBar = skillBar.node;
        this._board = board;
        this._ambientFx = ambientFx;
        this._lineFx = lineFx;
        this._fx = fx;
        this._overlayFx = overlayFx;

        const ghost = new Node('Ghost');
        ghost.parent = this.node;
        // ghost 与父节点同 layer，否则 UI camera 可能漏渲染（与 dock/board 同 UI_2D 层级）。
        ghost.layer = this.node.layer;
        ghost.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        ghost.addComponent(Graphics);
        // 显式加 UIOpacity 让 prepareGhost / reject 抖动能稳定操控透明度，
        // 避免某些设备上 node.opacity 与 Graphics fill 之间的语义错位。
        ghost.addComponent(UIOpacity).opacity = 255;

        const metaPanel = this.attach(this.node, 'MetaPanel', 0, 0, MetaPanel);

        const ctrl = this.node.addComponent(GameController);
        ctrl.wire({ model, meta, board, ambientFx, lineFx, fx, overlayFx, dock, hud, ghost, skillBar, metaPanel, shakeTarget: play, bgNode, playerCtx, profile });
        // 结束结算卡「菜单」链接 → 回主菜单（对齐 web `.game-over-links` 菜单项）。
        ctrl.onRequestMenu = () => this.showMainMenu(ctrl, model, model.mode, 0);
        this._ctrl = ctrl;
        // 存档写入失败时让 GameController 用 fx.floatText 提示一次（30s 节流），
        // 避免微信沙箱/iOS 配额满时玩家无感知地丢进度。
        setStorageWriteErrorHandler((key, err) => {
            console.warn('[OpenBlock] storage write failed', key, err);
            ctrl.notifyStorageFailure();
        });

        // 顶部按钮行：左一按钮由原「☰ 主菜单」改为中/英语言切换，点击后原地生效。
        // 按启用项数量自适应排布（居中铺满），保证每个图标按钮有足够触摸区且不超出屏宽。
        const soundOn = Storage.get(STORAGE_KEYS.sound, '1') !== '0';
        const hapticOn = Storage.get(STORAGE_KEYS.haptics, '1') !== '0';
        type ButtonKind = 'locale' | 'sound' | 'haptic' | 'motion';
        const defs: Array<{ name: string; icon: string; onClick: () => void; kind?: ButtonKind }> = [];
        defs.push({ name: 'LocaleBtn', icon: this.localeIcon(), onClick: () => { /* 占位，下方注入 */ }, kind: 'locale' });
        defs.push({ name: 'SkinBtn', icon: '🎨', onClick: () => ctrl.openSkinPanel() });
        if (flag('modes')) defs.push({ name: 'ModeBtn', icon: '🎮', onClick: () => ctrl.selectMode() });
        defs.push({ name: 'MetaBtn', icon: '📅', onClick: () => ctrl.toggleMeta() });
        if (flag('wheel')) defs.push({ name: 'WheelBtn', icon: '🎡', onClick: () => ctrl.openWheel() });
        if (flag('leaderboard')) defs.push({ name: 'RankBtn', icon: '🏆', onClick: () => ctrl.showLeaderboard() });
        if (flag('share')) defs.push({ name: 'ShareBtn', icon: '📤', onClick: () => ctrl.doShare() });
        defs.push({ name: 'SoundBtn', icon: soundOn ? '🔊' : '🔇', onClick: () => { /* 占位，下方注入 */ }, kind: 'sound' });
        defs.push({ name: 'HapticBtn', icon: hapticOn ? '📳' : '🚫', onClick: () => { /* 占位，下方注入 */ }, kind: 'haptic' });
        // 视觉/动效切换：严格对齐 web 主端 feedbackToggles —— ✨ 开启 / ✦ 关闭。
        // 不再使用 🐢，避免误读成“慢速模式/性能卡顿”。
        defs.push({ name: 'MotionBtn', icon: VisualFx.enabled ? '✨' : '✦', onClick: () => { /* 占位，下方注入 */ }, kind: 'motion' });

        this._buttons = [];
        const n = defs.length;
        // 用固定设计宽（FIXED_WIDTH 策略下恒为 720）布局 X，避免 onLoad 阶段 visibleSize 过渡态导致错位。
        const fullW = 720;
        const step = Math.min(102, (fullW - 24) / n); // 居中铺满，两侧各留 12 余量
        const btnW = Math.min(92, step - 10);
        const startX = -((n - 1) * step) / 2;
        defs.forEach((d, i) => {
            const x = startX + i * step;
            if (d.kind === 'locale') {
                const pb = this.iconButton(d.name, x, buttonsY, d.icon, btnW, () => {
                    const next = getLocale() === 'zh-CN' ? 'en' : 'zh-CN';
                    setLocale(next);
                    pb.setText(this.localeIcon());
                    ctrl.fx.floatText(next === 'zh-CN' ? '中文' : 'English', new Color(180, 230, 255, 255), 80);
                    this.refreshVisibleUiAfterLocaleChange(ctrl);
                }, 24);
                this._buttons.push(pb.node);
            } else if (d.kind === 'sound') {
                const pb = this.iconButton(d.name, x, buttonsY, d.icon, btnW, () => {
                    const on = ctrl.toggleSound();
                    pb.setText(on ? '🔊' : '🔇');
                });
                this._buttons.push(pb.node);
            } else if (d.kind === 'haptic') {
                const pb = this.iconButton(d.name, x, buttonsY, d.icon, btnW, () => {
                    const on = ctrl.toggleHaptics();
                    pb.setText(on ? '📳' : '🚫');
                });
                this._buttons.push(pb.node);
            } else if (d.kind === 'motion') {
                const pb = this.iconButton(d.name, x, buttonsY, d.icon, btnW, () => {
                    const enabled = VisualFx.toggle();
                    pb.setText(enabled ? '✨' : '✦');
                    // 切换即时反馈：用 floatText 提示当前状态（i18n motion.full/reduced）。
                    // floatText 签名 (text, color, yOffset)，颜色按状态区分以提升可识别度。
                    ctrl.fx.floatText(
                        enabled ? t('motion.full') : t('motion.reduced'),
                        enabled ? new Color(255, 220, 130, 255) : new Color(180, 200, 220, 255),
                        80,
                    );
                }, 22);
                this._buttons.push(pb.node);
            } else {
                this._buttons.push(this.iconButton(d.name, x, buttonsY, d.icon, btnW, d.onClick).node);
            }
        });

        this.detectPlatform();
        this.showSplash();
        // 移动套壳端冷启动直达对局。不要自动弹礼包/FTUE，避免启动时进入不可关闭模态导致“卡住”。

        // 多次重排：onLoad / 首帧阶段原生视图尺寸常处于过渡态（getVisibleSize 与父节点世界变换暂不一致），
        // 在视图稳定后再重排，让候选区等子节点的最终位置收敛到正确值。
        this.scheduleOnce(() => this.relayout(), 0);
        this.scheduleOnce(() => this.relayout(), 0.3);
        this.scheduleOnce(() => this.relayout(), 0.8);
        // 启动期 safe-area 稳定后锁定分辨率：此后 relayout 只重排节点、不再重建交换链。
        // 1.5s 给足三次延迟 relayout 把分辨率/相机收敛到正确值，之后游戏期 resize 不再踩 swapchain 雷。
        this.scheduleOnce(() => { this._resolutionLocked = true; console.log('[OpenBlock] resolution locked (no more canvas-resize)'); }, 1.5);

        // 心跳诊断：确认 boot 跑完 + 帧循环是否推进（区分「卡死」与「画了但不可见」）。
        // Cocos 3.x 的 totalFrames 是私有字段（实际为 _totalFrames），公共 API 是 getTotalFrames()。
        // 之前直接读 director.totalFrames 拿到 undefined，相当于心跳诊断永远报 undefined → 失去监测价值。
        console.log(`[OpenBlock] boot() done. children=${this.node.children.length} scene=${director.getScene()?.name}`);
        const readFrames = (): number | string => {
            try {
                const d = director as unknown as { getTotalFrames?: () => number; _totalFrames?: number; totalFrames?: number };
                if (typeof d.getTotalFrames === 'function') return d.getTotalFrames();
                if (typeof d._totalFrames === 'number') return d._totalFrames;
                if (typeof d.totalFrames === 'number') return d.totalFrames;
            } catch { /* ignore */ }
            return 'n/a';
        };
        // 分钟级诊断采样：每 2s 打印 帧增量(测 fps/卡死) + 场景节点总数(测节点泄漏) + JS堆(若可用)，
        // 持续 ~90s。复现「~1 分钟无响应/黑屏」时对照日志即可一锤定音定位泄漏类别：
        //   · dframes 在某段骤降到 ~0 → 主线程/渲染线程卡死（ANR 类，查长任务 / resize / EGL）；
        //   · nodes 单调持续上升        → 节点泄漏（瞬态特效/Label 未回收 → 原生内存增长 → OOM）；
        //   · heapMB 持续上升           → JS 堆泄漏（数组/闭包累积）。
        // 关闭：把下方 schedule 注释掉即可（纯诊断，不影响逻辑）。
        let prevFrames = Number(readFrames()) || 0;
        let diagN = 0;
        const sampler = (): void => {
            if (!this.node?.isValid) { this.unschedule(sampler); return; }
            const f = Number(readFrames()) || 0;
            const dframes = f - prevFrames;
            prevFrames = f;
            const nodes = this.countSceneNodes();
            const heap = this.readJsHeapMB();
            console.log(`[OpenBlock][diag] t=${(++diagN) * 2}s dframes=${dframes} nodes=${nodes}${heap != null ? ` heapMB=${heap}` : ''}`);
            if (diagN >= 45) this.unschedule(sampler);
        };
        this.schedule(sampler, 2);
    }

    /** 递归统计当前场景节点总数——节点泄漏（瞬态特效/Label 未回收）会让该值随时间单调上升。 */
    private countSceneNodes(): number {
        try {
            const scene = director.getScene();
            if (!scene) return -1;
            let n = 0;
            const walk = (node: { children?: unknown[] } | null): void => {
                if (!node) return;
                n++;
                const kids = node.children as Array<{ children?: unknown[] }> | undefined;
                if (kids) for (const k of kids) walk(k);
            };
            walk(scene as unknown as { children?: unknown[] });
            return n;
        } catch { return -1; }
    }

    /** JS 堆占用(MB)，仅浏览器/部分引擎暴露 performance.memory；原生 JSB 通常取不到 → 返回 null。 */
    private readJsHeapMB(): number | null {
        try {
            const mem = (globalThis as unknown as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory;
            if (mem?.usedJSHeapSize != null) return Math.round(mem.usedJSHeapSize / 1048576);
        } catch { /* ignore */ }
        return null;
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

        // 字标兜底（图标加载成功后隐藏）。统一用 Wordmark 像素字标，与局内/菜单同源。
        const word = new Node('word');
        word.parent = root;
        word.layer = root.layer;
        word.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const wm = word.addComponent(Wordmark);
        wm.redraw({ cellW: 11, cellH: 14 });

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

    private iconButton(name: string, x: number, y: number, icon: string, w: number, onClick: () => void, fontSize = 34): PillButton {
        // 对齐 web `.feedback-toggle-btn`：深色半透明圆角芯片（rgba(22,26,38,.78)）+ 浅边框 + 亮图标。
        const pb = button(this.node, icon, x, y, fontSize, onClick, new Color(22, 26, 38, 215), {
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
        // 尺寸/旋转变化时重新铺满并重排布局（不仅仅是重设分辨率）。
        // ⚠️ 必须防抖：iOS 在「状态栏弹出 / 分屏拖拽 / 旋转」过渡期会以动画形式连发多个 window-resize，
        //   每个中间尺寸都是一个新 viewport key → 各触发一次 applyResolutionPolicy 的 `canvas-resize`
        //   → Metal swapchain 在渲染线程反复重建（碰 CAMetalLayer，Cocos 3.x 已知主线程违例）。
        //   过渡期高频重建会把渲染线程顶死 → 表现为「顶部系统栏弹出后全屏无响应 / 黑屏」。
        //   防抖把这串中间态收敛为「停稳 ~180ms 后只重建一次」，根治该 freeze。
        screen.on('window-resize', this.onViewportChanged, this);
        screen.on('orientation-change', this.onViewportChanged, this);
        // App 前后台生命周期：Cocos 在切后台时暂停主循环，切回前台时若不主动「重发绘制指令」，
        // 基于 Graphics 的静态内容（盘面/候选区/HUD 都是一次性绘制后缓存的 draw command）在
        // GL/Metal 表面被系统回收后不会自动重画 → 回前台黑屏。这里在 EVENT_SHOW 强制重排+重绘恢复。
        game.on(Game.EVENT_HIDE, this.onAppHide, this);
        game.on(Game.EVENT_SHOW, this.onAppShow, this);
    }

    /** 防抖后的视口重排：连续 resize 事件停稳后只跑一次，避免过渡期反复重建 GPU swapchain。 */
    private onViewportChanged(): void {
        this.unschedule(this._debouncedRelayout);
        this.scheduleOnce(this._debouncedRelayout, 0.18);
    }

    private _debouncedRelayout = (): void => {
        if (!this.node?.isValid) return;
        this.relayout();
    };

    /** 切后台：停 BGM（保留意愿，回前台自动恢复）+ 取消进行中的拖拽，避免后台残留 setInterval / 僵尸拖拽态。 */
    private onAppHide(): void {
        try { AudioManager.stopBgm(); } catch { /* ignore */ }
        try { this._ctrl?.cancelActiveDrag(); } catch { /* ignore */ }
    }

    /**
     * 切回前台：恢复渲染与音频。
     *   1) relayout()：重新计算布局并对盘面/候选区/HUD 全量重绘——重发 Graphics draw command，
     *      修复「GL/Metal 表面被系统回收后静态内容不自动重画」导致的回前台黑屏；
     *      其中 applyResolutionPolicy 按 viewport key 去重，回前台尺寸通常不变 → 不会触发
     *      脆弱的 canvas-resize/swapchain 重建，仅做安全的内容重绘。
     *   2) 恢复 BGM 开启意愿；重新 arm 音频解锁（iOS 切后台会 suspend AudioContext）。
     */
    private onAppShow(): void {
        if (!this.node?.isValid) return;
        // 立即重绘一次。但安卓回前台时 GLSurfaceView 的 EGL surface 往往要到下一渲染帧才重建完成，
        // 此刻同步 relayout 的 draw command 可能打在尚未就绪的 surface 上 → 仍黑屏到下次真实绘制。
        // 故再补「下一帧」与「~0.35s 后」两次延迟重绘兜底（relayout 幂等、viewport-key 去重，开销极低），
        // 与启动期「首帧后多次延迟 relayout」同一思路，稳定根治回前台黑屏。
        try { this.relayout(); } catch (e) { console.warn('[OpenBlock] onAppShow relayout', e); }
        this.unschedule(this._resumeRedraw);
        this.scheduleOnce(this._resumeRedraw, 0);
        this.scheduleOnce(this._resumeRedraw, 0.35);
        try { AudioManager.armUnlock(); } catch { /* ignore */ }
        // 仅恢复「此前主动开过」的 BGM，切后台不改变用户的开关意愿。
        try { AudioManager.resumeBgmIfWanted(); } catch { /* ignore */ }
    }

    /** 回前台延迟兜底重绘：等 EGL/Metal 表面真正重建后再发一次 draw command，避免黑屏残留。 */
    private _resumeRedraw = (): void => {
        if (!this.node?.isValid) return;
        try { this.relayout(); } catch { /* ignore */ }
    };

    /** 组件销毁时摘除全局监听 + 取消挂起的防抖重排，避免悬挂回调访问已失效节点。 */
    onDestroy(): void {
        try { screen.off('window-resize', this.onViewportChanged, this); } catch { /* ignore */ }
        try { screen.off('orientation-change', this.onViewportChanged, this); } catch { /* ignore */ }
        try { game.off(Game.EVENT_HIDE, this.onAppHide, this); } catch { /* ignore */ }
        try { game.off(Game.EVENT_SHOW, this.onAppShow, this); } catch { /* ignore */ }
        try { this.unschedule(this._debouncedRelayout); } catch { /* ignore */ }
        try { this.unschedule(this._resumeRedraw); } catch { /* ignore */ }
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
        // HUD 由 v1.64 起 wordmark 加大到 7×8（~360×56），整体高度 ~196px
        // （wordmark 顶 y≈+83，overLabel 底 y≈-110）。比旧版多 ~20px，需要更深的避让。
        // 把 HUD 中心从 buttons-124 下沉到 buttons-144，再把 boardTop 从 hud-76 推到 hud-90：
        //   - wordmark 顶 → buttons 底距离 ≈ 144-42-83 = 19px（旧版 23px，仍宽松）
        //   - HUD 底 → 盘面顶距离 ≈ 90-55 = 35px（bottomRow 之外仍有间距）
        const hudY = buttonsY - 144;
        // 对齐移动套壳端垂直顺序：盘面 → skill-bar → block-dock（dock 贴底安全区）。
        // dock 内始终是“小规格预览”：3 槽 × 5 格必须完整显示；点击后才用盘面格尺寸生成激活 ghost。
        const dockWidth = Math.min(vis.width - 20, 700);
        const boardTop = hudY - 74;     // 对齐 web PC：HUD 下方紧接大棋盘，保留少量呼吸感
        const sideMargin = 12;
        const wBudget = vis.width - sideMargin * 2;
        const dockCell = Math.min(42, Math.max(28, Math.floor((dockWidth - 36) / 15)));
        const dockHeight = Math.max(132, Math.round(dockCell * 5 + 24));
        const dockYEst = -halfH + inset.bottom + dockHeight / 2 + 8;
        const skillH = 58;
        const skillYEst = dockYEst + dockHeight / 2 + 10 + skillH / 2;
        const boardBottomEst = skillYEst + skillH / 2 + 10;
        const vBudget = boardTop - boardBottomEst;
        const boardPx = Math.max(240, Math.min(wBudget, vBudget));
        const dockY = -halfH + inset.bottom + dockHeight / 2 + 8;
        const skillY = dockY + dockHeight / 2 + 10 + skillH / 2;
        const boardBottom = skillY + skillH / 2 + 10;
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
        // applyResolutionPolicy 内部带"viewport key 不变就不 setDesignResolutionSize / canvas-resize"的去重，
        // 保证 GPU swapchain 重建只发生在窗口真变（旋转、分屏）的时刻；
        // 而下面的"重新计算 layout + setPosition + redrawBoard"每次都跑——iOS 真机的 safe-area
        // 可能在 t=0 时还是 0，要到 t≈0.3/0.8s 才稳定，必须跑后续两次延迟 relayout 才能拿到正确值。
        this.applyResolutionPolicy(720, 1280);
        this._ctrl?.cancelActiveDrag();
        const m = this.computeLayout();
        if (this._play) this._play.setPosition(0, m.boardCenterY, 0);
        if (this._dock) this._dock.setPosition(0, m.dockY, 0);
        this._dockView?.setLayout(m.dockWidth, m.dockHeight, m.dockCell);
        if (this._hud) {
            this._hud.setPosition(0, m.hudY, 0);
            this._hudComp?.relayoutCols();
        }
        // 伙伴也按新可见宽决定显隐 / 偏移。
        this._ctrl?.relayoutCompanion();
        if (this._skillBar) this._skillBar.setPosition(0, m.skillY, 0);
        for (const b of this._buttons) b.setPosition(b.position.x, m.buttonsY, 0);
        // 盘面/特效层同步边长并重绘（保持正方形铺满）。
        if (this._board) this._board.setBoardPx(m.boardPx);
        if (this._ambientFx) this._ambientFx.setBoardPx(m.boardPx);
        if (this._lineFx) this._lineFx.setBoardPx(m.boardPx);
        if (this._fx) this._fx.setBoardPx(m.boardPx);
        if (this._overlayFx) this._overlayFx.setBoardPx(m.boardPx);
        this._ctrl?.redrawBoard();
        this._ctrl?.refreshDock();
    }

    /**
     * 竖屏锁定游戏统一用 FIXED_WIDTH：设计宽(720)恒等于屏幕宽，左右铺满、上下按屏幕比例延伸，
     * 不留黑边、不裁剪横向内容（按钮在 ±330 内）。早期自动按比例选轴在原生端取不到稳定窗口尺寸时
     * 会误选 FIXED_HEIGHT，导致可见宽变窄、盘面"横向铺满"，故此处固定为 FIXED_WIDTH。
     */
    private applyResolutionPolicy(designW: number, designH: number): void {
        // 🔒 首帧布局稳定后锁定：游戏期的 window-resize（系统栏/导航栏弹出、安全区变化、来电横幅、
        //    安卓沉浸式 surfaceChanged）一律不重设分辨率、不 emit('canvas-resize')，从根上消除
        //    「交换链/EGL surface 在渲染线程重建」这条故障链（iOS 报 -[UIView layer] 越线冻屏，
        //    安卓表现为沉浸式 resize 风暴顶死渲染线程 / 黑屏）。竖屏锁定游戏的 drawable 在系统栏
        //    切换时并不真正改变尺寸，跳过重建安全；布局自适应交给 relayoutImpl 的节点重排完成。
        if (this._resolutionLocked) return;
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
        if (key === this._lastViewKey) return;
        this._lastViewKey = key;
        view.setDesignResolutionSize(designW, designH, policy);
        // 3.8.4+ setDesignResolutionSize 不再自动重排 Canvas/相机，需手动 canvas-resize，
        // 否则相机按旧设计分辨率渲染（画面缩在中央、四周黑边）。
        // 原生 iOS 上 emit('canvas-resize') 触发 Metal swapchain 在 render 线程重建并访问 CAMetalLayer
        // （Cocos 3.x 已知的 main-thread 违例：会被 iOS Main Thread Checker 报"UIView layer 在后台线程被改"）。
        // 这里去重后只在 key 真变时 emit 一次；启动期的 3 次延迟 relayout 中只有第一次会走到这里，
        // 后续 2 次因 key 不变直接 return。
        try { view.emit('canvas-resize'); } catch { /* ignore */ }
        // 诊断日志：在 Xcode 控制台确认原生端真实尺寸是否就绪（若 win 远小于真机像素 = iOS 兼容缩放/启动屏缺失）。
        // 注意：仅在 key 真变时记一次，避免启动期 3 次 relayout 打出 3 行相同日志的视觉噪音。
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
        // 非微信端：若 remoteConfig 配了 cloudHttp.base 就装 HTTP 适配器；否则保持纯本地。
        // 装载顺序：先安装适配器，再 pull / flush，保证后续 push 走得到 HTTP 通道。
        const cloudHttp = getConfig().cloudHttp;
        if (flag('cloudSave') && cloudHttp?.base && cloudHttp?.userId && !Platform.isWechat()) {
            CloudSync.configureHttp(cloudHttp);
            // 入场尝试 flush 一次离线队列（上次断网未上传的最新一份）。
            CloudSync.flush();
        }
        // 拉云存档（best 取较大者；coins 取较大者；save 仅在本地为空时灌入，避免覆盖更新的本地局况）
        if (flag('cloudSave')) {
            CloudSync.pull((cloud) => {
                if (!cloud) return;
                const localBest = Storage.getNumber(STORAGE_KEYS.best, 0);
                if (typeof cloud.best === 'number' && cloud.best > localBest) {
                    Storage.setNumber(STORAGE_KEYS.best, cloud.best);
                }
                const localCoins = Storage.getNumber(STORAGE_KEYS.coins, 0);
                if (typeof cloud.coins === 'number' && cloud.coins > localCoins) {
                    Storage.setNumber(STORAGE_KEYS.coins, cloud.coins);
                }
                if (cloud.save != null && !Storage.get(STORAGE_KEYS.save, null)) {
                    Storage.setJSON(STORAGE_KEYS.save, cloud.save);
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

    /** 顶栏语言按钮：显示点击后将切换到的目标语言。 */
    private localeIcon(): string {
        return getLocale() === 'zh-CN' ? 'En' : '中';
    }

    /** 语言切换后原地刷新可见 UI。 */
    private refreshVisibleUiAfterLocaleChange(ctrl: GameController): void {
        this._hudComp?.refreshI18nLabels();
        ctrl.refreshDock();
        ctrl.redrawBoard();
        if (this._skillBar?.isValid) {
            // skill bar 没有文字，但 refresh 可同步余额/禁用态，确保切换后 UI 仍完整。
            this._skillBar.getComponent(SkillBar)?.refresh();
        }
    }

    private showMainMenu(ctrl: GameController, model: GameModel, mode: GameMode, delay = 0): void {
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
        // 手动菜单立即显示；若调用方传 delay，则等 viewport/Splash 稳定后显示。
        this.scheduleOnce(() => menu.show(), delay);
    }
}
