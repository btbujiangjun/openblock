import { _decorator, Component, Node, UITransform, Graphics, Label, Color, Vec2, Vec3, tween, Button, Camera, Canvas, director } from 'cc';

const { ccclass } = _decorator;

/** 模态状态：任一全屏面板打开时，GameController 暂停盘面输入。 */
export const Modal = {
    _count: 0,
    open(): void { this._count++; },
    close(): void { this._count = Math.max(0, this._count - 1); },
    isOpen(): boolean { return this._count > 0; },
    reset(): void { this._count = 0; },
};

/**
 * 全局点击总线 —— 原生 iOS 端 node.on(TOUCH_*) 节点级触摸不稳定（拖拽走全局 input 才可靠），
 * 故所有按钮/可点区域统一注册到这里，由 GameController 的全局 input 命中分发，保证按钮可点。
 *
 * 命中规则：按注册逆序（后注册=更靠上，如弹窗在游戏之上）取第一个命中的 active 目标；
 * 节点锚点按 0.5 处理，命中域 = contentSize。点击即触发（按下即响应）。
 */
export interface TapTarget {
    node: Node;
    onTap: () => void;
}

const _tapTargets: TapTarget[] = [];

/** 代码创建的 UI 节点默认 layer=DEFAULT，需与父级（UI_2D）对齐 camera.hitTest 才可靠。 */
export function inheritLayer(child: Node, parent: Node): void {
    child.layer = parent.layer;
}

/**
 * EventTouch.getUILocation 经引擎 _convertToUISpace 后已是「中心原点」UI 坐标（与节点 setPosition 同系）。
 * 切勿再减 visibleSize/2——FIXED_WIDTH 超高屏（如 720×1558）上会整体偏移导致完全点不中。
 */
export function uiToDesign(uiX: number, uiY: number): Vec2 {
    return new Vec2(uiX, uiY);
}

let _uiCam: Camera | null = null;

/** Canvas 上的 UI 相机（与引擎 hitTest / screenToWorld 同路径）。 */
export function getUICamera(): Camera {
    if (_uiCam?.node?.isValid) return _uiCam;
    const scene = director.getScene();
    const canvas = scene?.getComponentInChildren(Canvas);
    _uiCam = canvas?.cameraComponent ?? null;
    if (!_uiCam && scene) {
        for (const c of scene.getComponentsInChildren(Camera)) {
            _uiCam = c;
            break;
        }
    }
    return _uiCam as Camera;
}

/**
 * 屏幕坐标 → 节点局部坐标（AR）。
 * getUILocation 是 UI 空间，不能直接喂 convertToNodeSpaceAR（它需要世界坐标）——
 * 候选区/盘面拖拽必须走 screenToWorld，否则 FIXED_WIDTH 超高屏上整块候选区点不动。
 */
export function screenToLocal(node: Node, screenX: number, screenY: number): Vec3 {
    const uit = node.getComponent(UITransform);
    if (!uit) return new Vec3();
    const cam = getUICamera();
    if (!cam) return new Vec3();
    const world = new Vec3();
    cam.screenToWorld(new Vec3(screenX, screenY, 0), world);
    return uit.convertToNodeSpaceAR(world);
}

function nodeHit(node: Node, uit: UITransform, screenPt: Vec2, uiPt: Vec2): boolean {
    // 整体 try/catch：原生端（JSB v8 binding）当 UITransform 所属节点的 Camera/Scene 处于
    // 半销毁中间态时，`uit.isHit / uit.hitTest` 会抛 native 异常（Object.cpp:821
    // `Invoking function failed`），导致 onTouchEnd → dispatchTap 整条调用栈每次都炸，
    // UI 出现"点击无响应"的假死。安卓上系统手势（顶部下拉通知中心）截断 touch 序列时
    // 触发该路径，且引擎随后会以 ~80ms 频率重发 fake touch-end 让现象持续刷屏。
    // 任何异常视为不命中，让上层继续遍历下一个 target。
    try {
        const isHitFn = (uit as UITransform & { isHit?: (p: Vec2) => boolean }).isHit;
        if (isHitFn?.(uiPt)) return true;
        if (uit.hitTest(screenPt)) return true;
        const p = screenToLocal(node, screenPt.x, screenPt.y);
        const hw = uit.contentSize.width / 2;
        const hh = uit.contentSize.height / 2;
        return hw > 0 && hh > 0 && Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
    } catch {
        return false;
    }
}

/** 引擎 Button.CLICK（节点级命中），原生 iOS 比纯 TapBus 更可靠；与 TapBus 可并存。
 *  与 TapBus 共用 `shouldDedupeTap`，避免同一次点击被双通道分发两次。 */
export function bindEngineClick(node: Node, onClick: () => void): () => void {
    const btn = node.getComponent(Button) || node.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    btn.interactable = true;
    btn.target = node;
    const handler = () => { if (!shouldDedupeTap(node)) safeInvokeTap(node.name, onClick); };
    node.on(Button.EventType.CLICK, handler, node);
    return () => node.off(Button.EventType.CLICK, handler, node);
}

/**
 * 命中后跨"通道"去重：同一节点在 TAP_DEDUPE_MS 内重复触发只算一次。
 * 避免 TapBus(global input) + Button.CLICK(engine) 双通道叠加，
 * 或 START+END 两阶段同时分发，导致技能扣两次币 / 按钮触发两次。
 */
const TAP_DEDUPE_MS = 320;
const _lastFireTs = new WeakMap<Node, number>();

/** 仅供 PillButton / TapBus 等内部使用：判定本次触发是否需要被去重忽略。 */
export function shouldDedupeTap(node: Node): boolean {
    const now = Date.now();
    const last = _lastFireTs.get(node) ?? 0;
    if (now - last < TAP_DEDUPE_MS) return true;
    _lastFireTs.set(node, now);
    return false;
}

/**
 * 安全调用点击处理器：任何处理器抛错都就地吞掉并打日志，绝不让异常冒泡到引擎的
 * 原生→JS 事件分发层。原生（iOS JSB）上未捕获异常会被记为 SE_ERROR `Invoking function failed`，
 * 可能使引擎处于不一致态（残留触摸态 / 渲染异常）。这里把单个按钮的失败隔离成一条可定位日志。
 */
function safeInvokeTap(label: string, fn: () => void): void {
    try {
        fn();
    } catch (err) {
        console.error(`[OpenBlock] tap handler threw (${label}); contained to avoid native crash`, err);
    }
}

export const TapBus = {
    /** 注册一个可点节点，返回取消注册函数。 */
    add(node: Node, onTap: () => void): () => void {
        const t: TapTarget = { node, onTap };
        _tapTargets.push(t);
        return () => {
            const i = _tapTargets.indexOf(t);
            if (i >= 0) _tapTargets.splice(i, 1);
        };
    },
    /**
     * 命中分发：`isHit(ui)` / `hitTest(screen)` / 手算 AABB 任一命中即触发（原生端坐标系差异大）。
     * 命中后做"短时去重"，避免 START+END 双阶段或 TapBus+Button 双通道导致同一次点击执行两次。
     */
    hit(screenX: number, screenY: number, uiX: number, uiY: number): boolean {
        const screenPt = new Vec2(screenX, screenY);
        const uiPt = new Vec2(uiX, uiY);
        for (let i = _tapTargets.length - 1; i >= 0; i--) {
            const t = _tapTargets[i];
            const node = t.node;
            if (!node || !node.isValid || !node.activeInHierarchy) continue;
            const uit = node.getComponent(UITransform);
            if (!uit) continue;
            if (nodeHit(node, uit, screenPt, uiPt)) {
                if (shouldDedupeTap(node)) return true;
                safeInvokeTap(node.name, t.onTap);
                return true;
            }
        }
        return false;
    },
    /**
     * 纯命中探测：与 `hit` 用同一套命中测试，但**不触发 onTap、不去重**——仅回答
     * 「这次点击是否落在某个可交互目标上」。供 GameController 的「泄漏守卫兜底」判断
     * 一次被守卫拦住的点击究竟是落在合法弹窗按钮/遮罩上（合法交互、不该恢复），
     * 还是落在死区（疑似僵尸守卫态、可恢复）。
     */
    probe(screenX: number, screenY: number, uiX: number, uiY: number): boolean {
        const screenPt = new Vec2(screenX, screenY);
        const uiPt = new Vec2(uiX, uiY);
        for (let i = _tapTargets.length - 1; i >= 0; i--) {
            const t = _tapTargets[i];
            const node = t.node;
            if (!node || !node.isValid || !node.activeInHierarchy) continue;
            const uit = node.getComponent(UITransform);
            if (!uit) continue;
            if (nodeHit(node, uit, screenPt, uiPt)) return true;
        }
        return false;
    },
    reset(): void { _tapTargets.length = 0; },
};

/**
 * 模态遮罩：全屏暗底，挡住盘面，避免弹窗背后盘面透出造成画面混乱。
 * web 标准弹窗用 `rgba(0,0,0,0.55)`，但 web 盘面是浅色棋盘，0.55 已足够「压住」背景；
 * cocos 盘面是深色 + 高饱和方块，0.55 下亮色方块仍会透出 → 视觉混乱，故这里用更高不透明度
 * （alpha 230 ≈ 0.9）以达到与 web 一致的「弹窗时盘面不干扰」观感。
 * 默认尺寸 2000×3000，确保 FIXED_WIDTH 超高屏上也铺满，避免盘面从遮罩边缘透出。
 */
export function dimBg(parent: Node, w = 2000, h = 3000, alpha = 230): Node {
    const n = new Node('dim');
    n.parent = parent;
    inheritLayer(n, parent);
    n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, alpha);
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    return n;
}

export function card(parent: Node, w: number, h: number, y = 0): Node {
    const n = new Node('card');
    n.parent = parent;
    inheritLayer(n, parent);
    n.setPosition(0, y, 0);
    n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(28, 32, 44, 250);
    g.roundRect(-w / 2, -h / 2, w, h, 24);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(90, 110, 150, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 24);
    g.stroke();
    return n;
}

/** 右上角圆形 × 关闭按钮（对齐 web `.popup-close-btn`）。返回取消注册函数。 */
export function closeX(parent: Node, x: number, y: number, onTap: () => void): () => void {
    const n = new Node('closeX');
    n.parent = parent;
    inheritLayer(n, parent);
    n.setPosition(x, y, 0);
    const uit = n.addComponent(UITransform);
    uit.setAnchorPoint(0.5, 0.5);
    uit.setContentSize(56, 56);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(255, 255, 255, 26);
    g.circle(0, 0, 22);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(200, 210, 230, 150);
    g.circle(0, 0, 22);
    g.stroke();

    const t = new Node('x');
    t.parent = n;
    t.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    t.setPosition(0, 1, 0);
    const l = t.addComponent(Label);
    l.string = '✕';
    l.fontSize = 28;
    l.lineHeight = 30;
    l.color = new Color(225, 230, 240, 255);

    const unTap = TapBus.add(n, onTap);
    const unBtn = bindEngineClick(n, onTap);
    return () => { unTap(); unBtn(); };
}

export function label(parent: Node, text: string, size: number, x: number, y: number, color = new Color(235, 240, 250, 255)): Label {
    const n = new Node('label');
    n.parent = parent;
    inheritLayer(n, parent);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 4;
    l.color = color;
    return l;
}

export interface PillStyle {
    /** 主操作（强调态：accent 底色 + 更亮高光）。 */
    primary?: boolean;
    /** 自定义底色（不传时按 primary 取默认 accent / 中性蓝）。 */
    color?: Color;
    /** 禁用态：去高光、降饱和、文字变灰，点击无响应。 */
    disabled?: boolean;
    /** 最小宽度（默认 200）。 */
    minWidth?: number;
    /** 固定宽度（图标按钮用：不按文字长度推算）。 */
    width?: number;
    /** 固定高度（图标按钮用）。 */
    height?: number;
    /** 圆角半径（默认按胶囊取 min(h/2,22)）。 */
    radius?: number;
}

/**
 * 通用胶囊按钮（对齐 web `.btn` pill 样式）：
 * 单一可点节点（命中域 = 可见胶囊，修正旧实现「背板与文字命中区不一致」），
 * 背板 + 文字分属两个子节点（同节点不可并存两个 UI 渲染器），
 * 按压时整体缩放（旧实现只缩放文字、背板不动，观感「按了没反应」）。
 */
@ccclass('PillButton')
export class PillButton extends Component {
    private g!: Graphics;
    private lbl!: Label;
    private onClick: (() => void) | null = null;
    private _unreg: (() => void) | null = null;
    private _onBtnClick: (() => void) | null = null;
    private w = 200;
    private h = 56;
    private radius = 22;
    private base = new Color(58, 78, 120, 255);
    private primary = false;
    private _disabled = false;

    init(text: string, size: number, onClick: () => void, style?: PillStyle): PillButton {
        this.onClick = onClick;
        this.primary = !!style?.primary;
        this.base = style?.color ?? (this.primary ? new Color(45, 120, 210, 255) : new Color(58, 78, 120, 255));
        this._disabled = !!style?.disabled;
        const minW = style?.minWidth ?? 200;
        this.w = style?.width ?? Math.max(minW, size * Math.max(3.2, text.length * 1.05) + 36);
        this.h = style?.height ?? size + 30;
        this.radius = style?.radius ?? Math.min(this.h / 2, 22);

        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(this.w, this.h);

        const bgNode = new Node('bg');
        bgNode.parent = this.node;
        bgNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.g = bgNode.addComponent(Graphics);

        const lblNode = new Node('lbl');
        lblNode.parent = this.node;
        lblNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.lbl = lblNode.addComponent(Label);
        this.lbl.fontSize = size;
        this.lbl.lineHeight = size + 4;
        this.lbl.string = text;

        this.redraw();
        // 双通道：TapBus（全局 input）+ Button.CLICK（引擎节点级命中，原生 iOS 更稳）。
        this._unreg = TapBus.add(this.node, () => this.fire());
        this._onBtnClick = () => this.fire();
        const unbind = bindEngineClick(this.node, this._onBtnClick);
        const prevUnreg = this._unreg;
        this._unreg = () => { prevUnreg(); unbind(); };
        return this;
    }

    setText(text: string): void {
        if (this.lbl) this.lbl.string = text;
    }

    setDisabled(disabled: boolean): void {
        if (this._disabled === disabled) return;
        this._disabled = disabled;
        const btn = this.node.getComponent(Button);
        if (btn) btn.interactable = !disabled;
        this.redraw();
    }

    private redraw(): void {
        const { w, h } = this;
        const r = this.radius;
        const g = this.g;
        g.clear();
        const base = this._disabled ? new Color(52, 58, 74, 220) : this.base;
        g.fillColor = base;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        if (!this._disabled) {
            // 顶部一抹高光，模拟 web 渐变按钮的玻璃质感
            g.fillColor = new Color(255, 255, 255, this.primary ? 46 : 28);
            g.roundRect(-w / 2 + 3, 1, w - 6, h / 2 - 2, Math.max(2, r - 2));
            g.fill();
        }
        g.lineWidth = 2;
        g.strokeColor = this._disabled
            ? new Color(80, 88, 104, 160)
            : new Color(Math.min(255, base.r + 60), Math.min(255, base.g + 60), Math.min(255, base.b + 60), 255);
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();
        this.lbl.color = this._disabled ? new Color(150, 156, 170, 180) : new Color(245, 248, 255, 255);
    }

    private fire(): void {
        if (this._disabled) return;
        tween(this.node)
            .to(0.06, { scale: new Vec3(0.94, 0.94, 1) })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
        if (this.onClick) this.onClick();
    }

    onDestroy(): void {
        this._onBtnClick = null;
        if (this._unreg) this._unreg();
        this._unreg = null;
    }
}

export function button(
    parent: Node,
    text: string,
    x: number,
    y: number,
    size: number,
    onClick: () => void,
    color?: Color,
    style?: Omit<PillStyle, 'color'>,
): PillButton {
    const n = new Node('btn');
    n.parent = parent;
    inheritLayer(n, parent);
    n.setPosition(x, y, 0);
    return n.addComponent(PillButton).init(text, size, onClick, { color, ...style });
}
