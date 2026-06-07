import { _decorator, Component, Node, Color, UITransform, UIOpacity, Vec3, tween } from 'cc';
import { Modal, dimBg, card, label, button, closeX, TapBus } from './uiKit';
import { Motion } from '../platform/Motion';

const { ccclass } = _decorator;

export interface ModalButton {
    label: string;
    /** 点击回调。返回 `false` 表示「操作未完成」，阻止自动关闭（如金币不足）。 */
    onClick: () => void | boolean;
    color?: Color;
    /** 主操作（强调态 pill 样式）。 */
    primary?: boolean;
    /** 禁用态（灰显、点击无响应）。 */
    disabled?: boolean;
    /** 点击后是否自动关闭面板（默认 true） */
    close?: boolean;
}

export interface ModalOptions {
    title: string;
    /** 标题下方的大号强调值（如结束卡的本局得分，对齐 web `.game-over-score`）。 */
    bigValue?: string;
    lines?: string[];
    buttons: ModalButton[];
    /** 点背景关闭（默认 false） */
    dismissable?: boolean;
    /** 隐藏右上角 × （如结束卡：背景即「再来一局」，不需要额外关闭键）。 */
    noCloseX?: boolean;
    onClose?: () => void;
}

/** 通用弹窗：标题 + 多行文案 + 纵向按钮列。复活/宝箱/模式/排行/回流等复用。 */
@ccclass('ModalPanel')
export class ModalPanel extends Component {
    private onCloseCb: (() => void) | null = null;
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;
    /** 防双触发关闭：button onClick → close 与 dim TapBus → close 可能在同一帧叠加，
     *  若不守卫会导致 Modal.close 重复扣减 → Modal._count 偏负 → 后续 open 抬到 1 但场景空 →
     *  全局 onTouchStart 永远命中 `Modal.isOpen() return` → 候选块无法激活的「假性僵尸」。 */
    private _closed = false;

    static show(parent: Node, opts: ModalOptions): ModalPanel {
        const root = new Node('Modal');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const panel = root.addComponent(ModalPanel);
        try {
            panel.build(opts);
        } catch (err) {
            // build 在 Modal.open() 之后任一步抛错（dimBg / card / label / button / closeX 失败），
            // 会留下「计数 +1 但屏幕无 modal」的永久泄漏 → onTouchStart 全局拦截。
            // 这里强制走 close() 路径回滚 + 销毁残骸，避免漏发奖励/卡死交互。
            console.warn('[OpenBlock] ModalPanel.build failed', err);
            try { panel.close(); } catch { /* 已尽力 */ }
            throw err;
        }
        // 入场补粒：fade + 轻微 scale-up（180ms cubicOut）。Motion.reduced 时跳过，直接显示。
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.92, 0.92, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return panel;
    }

    private build(opts: ModalOptions): void {
        Modal.open();
        this.onCloseCb = opts.onClose ?? null;

        const lines = opts.lines ?? [];
        const bigH = opts.bigValue ? 96 : 0;
        const h = 240 + bigH + lines.length * 42 + opts.buttons.length * 84;
        const w = 600;
        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        // 遮罩先注册（低优先级）：非 dismissable 仅吸收点击防点穿；dismissable 点空白关闭。
        // 按钮在下方循环里后注册，逆序命中时按钮优先（对齐 MetaPanel / SkinPanel 约定）。
        this._unregDim = TapBus.add(dim, () => { if (opts.dismissable) this.close(); });
        const c = card(this.node, w, h);
        let y = h / 2 - 72;
        label(c, opts.title, 40, 0, y, new Color(255, 220, 130, 255));
        y -= 74;
        if (opts.bigValue) {
            label(c, opts.bigValue, 88, 0, y - 18, new Color(255, 255, 255, 255));
            y -= bigH;
        }
        for (const ln of lines) {
            label(c, ln, 26, 0, y);
            y -= 42;
        }
        y -= 12;
        for (const b of opts.buttons) {
            button(c, b.label, 0, y, 28, () => {
                const keep = b.onClick();
                if (b.close !== false && keep !== false) this.close();
            }, b.color, { primary: b.primary, disabled: b.disabled });
            y -= 84;
        }

        // 可点背景关闭的弹窗，右上角补一个 × 关闭按钮（对齐 web）；noCloseX 时省略。
        if (opts.dismissable && !opts.noCloseX) {
            this._unregClose = closeX(c, w / 2 - 44, h / 2 - 44, () => this.close());
        }
    }

    close(): void {
        // 双触发守卫：button onClick + dim TapBus + closeX 任一组合都可能在同一帧/连贯帧内触发 close，
        // 重复扣 Modal._count 会让计数器陷入「负偏移」（被 Math.max(0, ...) 钳到 0），
        // 然后任一正常 Modal.open 都会让 isOpen() 永远为 true → 全局触摸被错误拦截。
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        // onCloseCb 的副作用（重开 / 发奖 / 自身再开新 modal）若抛错，也必须把节点销毁兜底，
        // 否则屏幕上会残留空白透明 modal 同时计数已扣减 → 视觉无东西但事实上没有，
        // 反而是「计数正确 + 节点泄露」更糟。
        try { if (this.onCloseCb) this.onCloseCb(); } catch (err) { console.warn('[OpenBlock] ModalPanel onClose', err); }
        if (this.node?.isValid) this.node.destroy();
    }
}
