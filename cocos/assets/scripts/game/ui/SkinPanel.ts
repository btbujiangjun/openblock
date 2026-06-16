import { _decorator, Component, Node, Color, UITransform, Label, Graphics, UIOpacity, Vec3, tween, view, Mask, EventTouch } from 'cc';
import { Modal, dimBg, card, label, closeX, TapBus, bindEngineClick, inheritLayer, screenToLocal } from './uiKit';
import { SKINS, listSkinIds, Skin, t, getSkinCategories, tSkinName } from '../../core';
import { blockColor, gridOuterColor, cellEmptyColor, blockIcon } from '../skin/palette';
import { iconFontSize } from '../skin/blockPaint';
import { Motion } from '../platform/Motion';

const { ccclass } = _decorator;

/**
 * 皮肤选择面板 —— 对齐 web 的「皮肤列表选择器」（#skin-select：列出全部皮肤、可选任意）。
 * 网格陈列所有皮肤的迷你预览（外框 + 数块方块 + emoji），当前皮肤高亮，点选即应用。
 *
 * 滚动方案：viewport（Mask 裁剪）+ content（移动 y）+ 透明触摸拦截层（Node.EventType.TOUCH_*）。
 * 用节点级触摸而非全局 input，避免与 GameController 的全局 input 监听冲突导致原生端收不到 MOVE。
 */
@ccclass('SkinPanel')
export class SkinPanel extends Component {
    private onPick: ((id: string) => void) | null = null;
    private currentId = '';
    private _unregs: Array<() => void> = [];
    private swatches: Map<string, { g: Graphics; skin: Skin; w: number; h: number; node: Node }> = new Map();
    private closed = false;

    /** 滚动状态 */
    private _scrollContent: Node | null = null;
    private _scrollMin = 0;
    private _scrollMax = 0;
    private _scrollLastY = 0;
    /** 速度采样时间戳（秒），用于把逐帧 dy 换算成与帧率无关的 px/s 速度。 */
    private _scrollLastT = 0;
    /** 抛掷速度，单位 px/s（松手后惯性按 velocity*dt 推进，帧率无关）。 */
    private _scrollVelocity = 0;
    /** 手指是否按下：按住期间只跟手，不跑惯性，避免「跟手 + 惯性」双重位移。 */
    private _pressed = false;
    /** 本次手势是否已判定为滚动（兼作点击抑制：松手后短暂保持以吞掉误触点选）。 */
    private _scrollDragging = false;
    private _touchLayer: Node | null = null;
    private _viewport: Node | null = null;
    /** swatch 在 content 本地坐标系中的位置（用于点击判定） */
    private _swatchRects: Array<{ id: string; cx: number; cy: number; w: number; h: number }> = [];

    static show(parent: Node, currentId: string, onPick: (id: string) => void): SkinPanel {
        const root = new Node('SkinPanel');
        root.parent = parent;
        inheritLayer(root, parent);
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(SkinPanel);
        p.onPick = onPick;
        p.currentId = currentId;
        p.build();
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.92, 0.92, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return p;
    }

    private build(): void {
        Modal.open();
        const categories = getSkinCategories();
        const cols = 4;
        const swatch = 136;
        const swatchH = 132;
        const gapX = 10;
        const gapY = 10;
        const catLabelH = 38;
        const catGap = 14;
        const gridW = cols * swatch + (cols - 1) * gapX;

        let totalContentH = 0;
        for (const cat of categories) {
            totalContentH += catLabelH + catGap;
            const catRows = Math.ceil(cat.skins.length / cols);
            totalContentH += catRows * swatchH + (catRows - 1) * gapY + catGap;
        }

        const titleBarH = 100;
        const cardPadBottom = 30;
        const idealCardH = totalContentH + titleBarH + cardPadBottom;
        const w = gridW + 60;

        const vis = view.getVisibleSize();
        const maxCardH = vis.height - 80;
        const cardH = Math.min(idealCardH, maxCardH);
        const needScroll = idealCardH > maxCardH;

        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        this._unregs.push(TapBus.add(dim, () => this.close()));

        const c = card(this.node, w, cardH);
        const topY = cardH / 2 - 54;
        label(c, t('skin.title'), 38, 0, topY, new Color(255, 220, 130, 255));
        this._unregs.push(closeX(c, w / 2 - 44, cardH / 2 - 44, () => this.close()));

        const viewportH = cardH - titleBarH - cardPadBottom;
        const viewportTop = topY - 52;

        const viewport = new Node('viewport');
        viewport.parent = c;
        inheritLayer(viewport, c);
        const vpUit = viewport.addComponent(UITransform);
        vpUit.setAnchorPoint(0.5, 1);
        vpUit.setContentSize(w - 20, viewportH);
        viewport.setPosition(0, viewportTop, 0);

        this._viewport = viewport;
        if (needScroll) {
            const mask = viewport.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_RECT;
        }

        const content = new Node('content');
        content.parent = viewport;
        inheritLayer(content, viewport);
        const contentUit = content.addComponent(UITransform);
        contentUit.setAnchorPoint(0.5, 1);
        contentUit.setContentSize(w - 20, totalContentH);
        content.setPosition(0, 0, 0);

        const startX = -gridW / 2 + swatch / 2;
        let curY = -catGap / 2;

        for (const cat of categories) {
            label(content, cat.label, 22, 0, curY, new Color(180, 195, 220, 255));
            curY -= catLabelH + catGap;

            cat.skins.forEach((skin, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = startX + col * (swatch + gapX);
                const y = curY - row * (swatchH + gapY) - swatchH / 2;
                this.makeSwatch(content, skin, x, y, swatch, swatchH);
            });
            const catRows = Math.ceil(cat.skins.length / cols);
            curY -= catRows * swatchH + (catRows - 1) * gapY + catGap;
        }

        this._scrollContent = content;
        if (needScroll) {
            this._scrollMin = 0;
            this._scrollMax = totalContentH - viewportH;
            this._scrollVelocity = 0;

            // 直接在 viewport 上注册触摸事件驱动滚动，不使用 touchLayer 拦截层
            viewport.on(Node.EventType.TOUCH_START, this._onScrollStart, this);
            viewport.on(Node.EventType.TOUCH_MOVE, this._onScrollMove, this);
            viewport.on(Node.EventType.TOUCH_END, this._onScrollEnd, this);
            viewport.on(Node.EventType.TOUCH_CANCEL, this._onScrollEnd, this);
            this._touchLayer = viewport;

            // 底部渐变提示
            const fadeH = 28;
            const fade = new Node('fade');
            fade.parent = c;
            inheritLayer(fade, c);
            const fadeUit = fade.addComponent(UITransform);
            fadeUit.setAnchorPoint(0.5, 0);
            fadeUit.setContentSize(w - 20, fadeH);
            fade.setPosition(0, viewportTop - viewportH, 0);
            fade.setSiblingIndex(9998);
            const fg = fade.addComponent(Graphics);
            for (let i = 0; i < fadeH; i++) {
                const a = Math.floor(255 * (1 - i / fadeH));
                fg.fillColor = new Color(28, 32, 44, a);
                fg.rect(-(w - 20) / 2, i, w - 20, 1);
                fg.fill();
            }
        }
    }

    private makeSwatch(parent: Node, skin: Skin, x: number, y: number, w: number, h: number): void {
        const n = new Node(`sk-${skin.id}`);
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);
        n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);

        const g = n.addComponent(Graphics);
        this.swatches.set(skin.id, { g, skin, w, h, node: n });
        this._swatchRects.push({ id: skin.id, cx: x, cy: y, w, h });
        this.drawSwatchFrame(g, skin, w, h);

        const { previewSize, px0, py0 } = this.previewGeom(w, h);
        this.drawMiniBoard(g, skin, px0, py0, previewSize);
        this.drawMiniIcons(n, skin, px0, py0, previewSize);

        const nameNode = new Node('name');
        nameNode.parent = n;
        nameNode.setPosition(0, -h / 2 + 22, 0);
        nameNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const nl = nameNode.addComponent(Label);
        nl.string = tSkinName(skin);
        nl.fontSize = 17;
        nl.lineHeight = 20;
        nl.color = new Color(225, 230, 240, 255);

        const pick = () => {
            if (this.closed) return;
            if (this._scrollDragging) return;
            if (this.currentId !== skin.id && this.onPick) {
                this.onPick(skin.id);
            }
            this.close();
        };
        this._unregs.push(TapBus.add(n, pick));
        this._unregs.push(bindEngineClick(n, pick));
    }

    // ────────────────── 节点级触摸滚动 ──────────────────

    /** 累计滑动距离（绝对值），超过阈值才判定为「滚动」而非「点击」。 */
    private _scrollAccumDist = 0;
    private static readonly SCROLL_TAP_THRESHOLD = 8;
    /** 惯性衰减：每秒保留的速度比例（≈ 60fps 下逐帧 0.92）。帧率无关。 */
    private static readonly INERTIA_DECAY = 0.0067;
    /** 越界（橡皮筋区）时的额外快速衰减，制造「冲出后被拉回」的回弹手感。 */
    private static readonly OVERSCROLL_DECAY = 0.0008;
    /** 回弹刚度（越大回弹越快）。 */
    private static readonly BOUNCE_STIFFNESS = 16;
    /** 抛掷速度上限（px/s），防止超快甩动导致瞬移。 */
    private static readonly MAX_FLING = 4200;

    private _onScrollStart(e: EventTouch): void {
        if (!this._scrollContent || this.closed) return;
        const loc = e.getUILocation();
        this._scrollLastY = loc.y;
        this._scrollLastT = SkinPanel._now();
        this._scrollVelocity = 0;
        this._pressed = true;
        this._scrollDragging = false;
        this._scrollAccumDist = 0;
        e.propagationStopped = true;
    }

    private _onScrollMove(e: EventTouch): void {
        if (!this._scrollContent || this.closed) return;
        const loc = e.getUILocation();
        const now = SkinPanel._now();
        const dy = loc.y - this._scrollLastY;
        // 采样间隔钳制在 [1/120s, 1/15s]，避免稀疏/抖动事件算出离谱速度
        const dt = Math.min(1 / 15, Math.max(1 / 120, now - this._scrollLastT));
        this._scrollLastY = loc.y;
        this._scrollLastT = now;
        this._scrollAccumDist += Math.abs(dy);
        if (this._scrollAccumDist > SkinPanel.SCROLL_TAP_THRESHOLD) this._scrollDragging = true;
        if (!this._scrollDragging) return;
        // 1) 纯跟手：直接按 dy 位移（越界橡皮筋阻尼），不再在 move 里设惯性
        this._applyScroll(dy);
        // 2) 速度采样：瞬时速度（px/s）与历史做加权平滑，偏重最近一帧以获得灵敏的 fling
        const inst = dy / dt;
        this._scrollVelocity = this._scrollVelocity * 0.35 + inst * 0.65;
        e.propagationStopped = true;
    }

    private _onScrollEnd(e: EventTouch): void {
        e.propagationStopped = true;
        this._pressed = false;
        if (this._scrollDragging) {
            // 松手后立即进入惯性（update 因 _pressed=false 接管）；
            // _scrollDragging 再保持一小段时间用于吞掉误触点选，然后清除。
            this._scrollVelocity = Math.max(-SkinPanel.MAX_FLING, Math.min(SkinPanel.MAX_FLING, this._scrollVelocity));
            this.scheduleOnce(() => { this._scrollDragging = false; }, 0.06);
            return;
        }
        if (this.closed || !this._scrollContent?.isValid) return;

        // 将屏幕触摸点转换为 content 的本地坐标，基于布局位置判定命中
        const loc = e.getLocation();
        const local = screenToLocal(this._scrollContent, loc.x, loc.y);

        for (const rect of this._swatchRects) {
            const left = rect.cx - rect.w / 2;
            const bottom = rect.cy - rect.h / 2;
            if (local.x >= left && local.x <= left + rect.w &&
                local.y >= bottom && local.y <= bottom + rect.h) {
                if (this.currentId !== rect.id && this.onPick) {
                    this.onPick(rect.id);
                }
                this.close();
                return;
            }
        }
    }

    /** 当前时间（秒），优先用高精度时钟。 */
    private static _now(): number {
        const p = (globalThis as { performance?: { now(): number } }).performance;
        return (p && typeof p.now === 'function' ? p.now() : Date.now()) / 1000;
    }

    /** 跟手位移：越界进入橡皮筋区（位移按 0.3 衰减），不直接 clamp 以保留可拉拽的回弹空间。 */
    private _applyScroll(deltaY: number): void {
        if (!this._scrollContent) return;
        const pos = this._scrollContent.position;
        let newY = pos.y + deltaY;
        if (newY < this._scrollMin) {
            newY = this._scrollMin + (newY - this._scrollMin) * 0.3;
        } else if (newY > this._scrollMax) {
            newY = this._scrollMax + (newY - this._scrollMax) * 0.3;
        }
        this._scrollContent.setPosition(pos.x, newY, pos.z);
    }

    update(dt: number): void {
        const content = this._scrollContent;
        if (!content) return;
        // 按住期间完全由 move 跟手驱动，update 不介入（杜绝双重位移 / 按住漂移）
        if (this._pressed) return;
        if (dt <= 0) return;

        const pos = content.position;
        let y = pos.y;
        const min = this._scrollMin;
        const max = this._scrollMax;
        const outOfBounds = y < min || y > max;

        // 惯性推进（px/s，帧率无关）
        if (Math.abs(this._scrollVelocity) > 2) {
            y += this._scrollVelocity * dt;
            const decay = outOfBounds ? SkinPanel.OVERSCROLL_DECAY : SkinPanel.INERTIA_DECAY;
            this._scrollVelocity *= Math.pow(decay, dt);
        } else {
            this._scrollVelocity = 0;
        }

        // 边界回弹（指数趋近，帧率无关）
        const k = Math.min(1, dt * SkinPanel.BOUNCE_STIFFNESS);
        if (y < min) {
            y += (min - y) * k;
            if (min - y < 0.5) { y = min; this._scrollVelocity = 0; }
        } else if (y > max) {
            y += (max - y) * k;
            if (y - max < 0.5) { y = max; this._scrollVelocity = 0; }
        }

        content.setPosition(pos.x, y, pos.z);
    }

    // ────────────────── 渲染辅助 ──────────────────

    private previewGeom(w: number, h: number): { previewSize: number; px0: number; py0: number } {
        const previewSize = Math.min(w - 36, h - 58);
        const px0 = -previewSize / 2;
        const py0 = h / 2 - 18 - previewSize;
        return { previewSize, px0, py0 };
    }

    private drawSwatchFrame(g: Graphics, skin: Skin, w: number, h: number): void {
        const selected = skin.id === this.currentId;
        g.fillColor = new Color(24, 28, 40, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fill();
        g.lineWidth = selected ? 4 : 1.5;
        g.strokeColor = selected ? new Color(120, 200, 255, 255) : new Color(70, 84, 110, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.stroke();
    }

    /** 根据皮肤 id 生成差异化的 4×4 预览布局——不同皮肤展示不同的方块分布。 */
    private static previewPattern(skin: Skin): number[][] {
        let h = 0;
        for (let i = 0; i < skin.id.length; i++) h = (h * 31 + skin.id.charCodeAt(i)) | 0;
        h = Math.abs(h);
        const nc = skin.blockColors.length;
        const grid: number[][] = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
        let placed = 0;
        for (let i = 0; i < 16 && placed < 8; i++) {
            const idx = (h + i * 7) % 16;
            const gy = (idx >> 2) & 3, gx = idx & 3;
            if (grid[gy][gx] === 0) {
                grid[gy][gx] = (placed % nc) + 1;
                placed++;
            }
        }
        return grid;
    }

    private drawMiniBoard(g: Graphics, skin: Skin, x0: number, y0: number, size: number): void {
        const n = 4;
        const cell = size / n;
        const inset = 2;
        const r = Math.min(5, cell * 0.16);
        g.fillColor = gridOuterColor(skin);
        g.roundRect(x0 - 3, y0 - 3, size + 6, size + 6, 8);
        g.fill();
        const pattern = SkinPanel.previewPattern(skin);
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                const cx = x0 + gx * cell;
                const cy = y0 + (n - 1 - gy) * cell;
                const v = pattern[gy][gx];
                if (v === 0) {
                    const inn = cell - 2;
                    g.fillColor = cellEmptyColor(skin);
                    g.roundRect(cx + 1, cy + 1, inn, inn, Math.min(5, inn * 0.18));
                    g.fill();
                } else {
                    // 纯色圆角方块，不走复杂的 paintBlockFace（高光/描边在小预览中太杂乱）
                    const fsize = cell - inset * 2;
                    g.fillColor = blockColor(skin, v - 1);
                    g.roundRect(cx + inset, cy + inset, fsize, fsize, r);
                    g.fill();
                }
            }
        }
    }

    private drawMiniIcons(parent: Node, skin: Skin, x0: number, y0: number, size: number): void {
        if (!skin.blockIcons || !skin.blockIcons.length) return;
        const n = 4;
        const cell = size / n;
        const fs = iconFontSize(cell - (skin.blockInset ?? 2) * 2);
        if (fs <= 0) return;
        const pattern = [
            [1, 0, 2, 0],
            [0, 3, 0, 4],
            [5, 0, 6, 0],
            [0, 7, 0, 8],
        ];
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                const v = pattern[gy][gx];
                if (v === 0) continue;
                const em = blockIcon(skin, v - 1);
                if (!em) continue;
                const cx = x0 + gx * cell + cell / 2;
                const cy = y0 + (n - 1 - gy) * cell + cell / 2;
                const ic = new Node('ic');
                ic.parent = parent;
                ic.setPosition(cx, cy, 0);
                ic.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                const l = ic.addComponent(Label);
                l.string = em;
                l.fontSize = fs;
                l.lineHeight = fs;
            }
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const u of this._unregs) u();
        this._unregs = [];
        if (this._touchLayer?.isValid) {
            this._touchLayer.off(Node.EventType.TOUCH_START, this._onScrollStart, this);
            this._touchLayer.off(Node.EventType.TOUCH_MOVE, this._onScrollMove, this);
            this._touchLayer.off(Node.EventType.TOUCH_END, this._onScrollEnd, this);
            this._touchLayer.off(Node.EventType.TOUCH_CANCEL, this._onScrollEnd, this);
        }
        Modal.close();
        if (Motion.reduced || !this.node.isValid) {
            this.node.destroy();
            return;
        }
        const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        const self = this.node;
        tween(op).to(0.14, { opacity: 0 }, { easing: 'cubicIn' }).start();
        tween(self).to(0.14, { scale: new Vec3(0.94, 0.94, 1) }, { easing: 'cubicIn' })
            .call(() => { if (self.isValid) self.destroy(); })
            .start();
    }

    onDestroy(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
        if (this._touchLayer?.isValid) {
            this._touchLayer.off(Node.EventType.TOUCH_START, this._onScrollStart, this);
            this._touchLayer.off(Node.EventType.TOUCH_MOVE, this._onScrollMove, this);
            this._touchLayer.off(Node.EventType.TOUCH_END, this._onScrollEnd, this);
            this._touchLayer.off(Node.EventType.TOUCH_CANCEL, this._onScrollEnd, this);
        }
    }
}
