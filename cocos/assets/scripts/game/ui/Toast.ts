import { Node, UITransform, Graphics, Label, Color, UIOpacity, tween, Tween, v3 } from 'cc';
import { inheritLayer, button, PillButton, Modal } from './uiKit';
import { Motion } from '../platform/Motion';

/**
 * 统一非模态浮条（严格对齐 web `#seasonal-toast` + `#easter-egg-toast`）。
 *
 * 两个 tier：
 *  - `bar`        底部玻璃条（默认）：转盘可用 / 分享结果 / 道具提示等普通信息，可带一个 action 胶囊按钮。
 *  - `celebrate`  盘面中心庆贺卡：周末/生日/节日推荐/里程碑/段位晋升等「庆祝」信息，金色强调、更大字、弹出动效。
 *
 * 与 web 对齐的关键语义：
 *  - **单槽队列**：同一时刻只显示一个浮条；多条排队按 `GAP_MS` 间隔依次播放（对齐 web 单 DOM 容器替换 + 队列）。
 *  - **代际丢弃**：`bumpGeneration()`（开新局时调用）会作废仍在排队、未播放的旧浮条，避免跨局串台（对齐 `_toastGeneration`）。
 *  - **模态期抑制**：Modal 打开（结算卡/弹窗）时不抢播，待关闭后再 drain（对齐 web `body.game-over-active` 抑制 toast）。
 *  - **reduced-motion**：跳过滑入/缩放，仅做透明度淡入淡出。
 *
 * 纯 tween 驱动、无需 Component update；浮条结束后自销毁。容器挂在传入 root 上、siblingIndex 低于 Modal(9999)。
 */
export interface ToastSpec {
    text: string;
    /** 显示时长（毫秒），不含进出动画。默认 bar=3500 / celebrate=4000。 */
    durationMs?: number;
    tier?: 'bar' | 'celebrate';
    /** 可选 action 胶囊按钮文案（仅 bar tier 渲染；如「去抽」「切换」）。 */
    actionLabel?: string;
    onAction?: () => void;
    /** celebrate 强调色（默认暖金）。 */
    accent?: Color;
    /** 内部：入队时打上的代际，drain 时丢弃过期项。 */
    _gen?: number;
}

const GAP_MS = 320;
const BAR_DURATION_MS = 3500;
const CELEBRATE_DURATION_MS = 4000;

export const Toast = {
    _root: null as Node | null,
    _barY: -360,
    _celebrateY: 60,
    _queue: [] as ToastSpec[],
    _activeNode: null as Node | null,
    _generation: 0,

    /** 由 Bootstrap 在布局就绪后注入容器根与两 tier 的 Y 锚位（设计坐标，原点居中）。 */
    configure(root: Node, barY: number, celebrateY: number): void {
        this._root = root;
        this._barY = barY;
        this._celebrateY = celebrateY;
    },

    /** 开新局时调用：作废仍在排队、尚未播放的旧浮条（不影响正在显示的那条）。 */
    bumpGeneration(): void {
        this._generation++;
        this._queue.length = 0;
    },

    reset(): void {
        this._queue.length = 0;
        if (this._activeNode?.isValid) this._activeNode.destroy();
        this._activeNode = null;
    },

    show(spec: ToastSpec): void {
        if (!this._root || !this._root.isValid) return;
        spec._gen = this._generation;
        this._queue.push(spec);
        this._drain();
    },

    _drain(): void {
        if (this._activeNode?.isValid) return;
        if (!this._root || !this._root.isValid) return;
        // 模态期抑制：不抢播，稍后重试（对齐 web 结算卡期间不弹 toast）。
        if (Modal.isOpen()) {
            this._scheduleRetry();
            return;
        }
        let spec: ToastSpec | undefined;
        while ((spec = this._queue.shift())) {
            if (spec._gen === this._generation) break;
            spec = undefined;
        }
        if (!spec) return;
        this._present(spec);
    },

    /** 用一个临时节点的 tween 当延时器，避免引入 Component 调度。 */
    _scheduleRetry(): void {
        const root = this._root;
        if (!root || !root.isValid) return;
        const timer = new Node('toastRetry');
        timer.parent = root;
        timer.addComponent(UITransform);
        tween(timer)
            .delay(0.4)
            .call(() => { if (timer.isValid) timer.destroy(); this._drain(); })
            .start();
    },

    _present(spec: ToastSpec): void {
        const root = this._root!;
        const tier = spec.tier ?? 'bar';
        const reduced = Motion.reduced;
        const accent = spec.accent ?? new Color(255, 210, 120, 255);
        const durationMs = spec.durationMs ?? (tier === 'celebrate' ? CELEBRATE_DURATION_MS : BAR_DURATION_MS);

        const root2 = new Node('toast');
        root2.parent = root;
        inheritLayer(root2, root);
        root2.setSiblingIndex(9000);
        root2.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const op = root2.addComponent(UIOpacity);
        op.opacity = 0;
        this._activeNode = root2;

        const fontSize = tier === 'celebrate' ? 30 : 24;
        const padX = tier === 'celebrate' ? 46 : 34;
        const hasAction = tier === 'bar' && !!spec.actionLabel && !!spec.onAction;
        const actionW = hasAction ? 132 : 0;
        // 估算宽度：中文/emoji 约 fontSize 宽，英文更窄，统一按 0.62×fontSize 估算并夹紧。
        const textW = Math.ceil(spec.text.length * fontSize * 0.62);
        const minW = tier === 'celebrate' ? 360 : 300;
        const maxW = 640;
        const w = Math.max(minW, Math.min(maxW, textW + padX * 2 + actionW));
        const h = tier === 'celebrate' ? 92 : 64;
        const y = tier === 'celebrate' ? this._celebrateY : this._barY;
        root2.setPosition(0, y, 0);

        const g = root2.addComponent(Graphics);
        // 底卡：深色玻璃 + 描边；celebrate 用金色描边强调。
        g.fillColor = new Color(22, 28, 42, tier === 'celebrate' ? 244 : 232);
        g.roundRect(-w / 2, -h / 2, w, h, tier === 'celebrate' ? 22 : h / 2);
        g.fill();
        if (tier === 'celebrate') {
            // 顶部柔光 + 金边
            g.fillColor = new Color(255, 255, 255, 16);
            g.roundRect(-w / 2 + 10, h / 2 - 30, w - 20, 22, 12);
            g.fill();
            g.lineWidth = 3;
            g.strokeColor = new Color(accent.r, accent.g, accent.b, 235);
            g.roundRect(-w / 2, -h / 2, w, h, 22);
            g.stroke();
        } else {
            g.lineWidth = 2;
            g.strokeColor = new Color(94, 108, 142, 200);
            g.roundRect(-w / 2, -h / 2, w, h, h / 2);
            g.stroke();
        }

        // 文本：有 action 按钮时整体左移给按钮腾位。
        const textColor = tier === 'celebrate' ? accent : new Color(235, 240, 250, 255);
        const textX = hasAction ? -(actionW / 2) : 0;
        const txt = new Node('toastText');
        txt.parent = root2;
        inheritLayer(txt, root2);
        txt.setPosition(textX, 0, 0);
        txt.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const lbl = txt.addComponent(Label);
        lbl.string = spec.text;
        lbl.fontSize = fontSize;
        lbl.lineHeight = fontSize + 4;
        lbl.color = textColor;

        let actionBtn: PillButton | null = null;
        if (hasAction) {
            actionBtn = button(
                root2, spec.actionLabel!, w / 2 - actionW / 2 - 12, 0, 20,
                () => {
                    try { spec.onAction!(); } catch { /* ignore */ }
                    this._dismiss(root2, reduced, true);
                },
                new Color(245, 158, 11, 255),
                { primary: true, width: actionW - 16, height: 44 },
            );
        }

        // 进场：reduced 仅淡入；否则 bar 从下滑入 / celebrate 弹出缩放。
        if (reduced) {
            tween(op).to(0.2, { opacity: 255 }).start();
        } else if (tier === 'celebrate') {
            root2.setScale(0.8, 0.8, 1);
            tween(root2).to(0.3, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
            tween(op).to(0.22, { opacity: 255 }).start();
        } else {
            root2.setPosition(0, y - 36, 0);
            tween(root2).to(0.28, { position: v3(0, y, 0) }, { easing: 'cubicOut' }).start();
            tween(op).to(0.28, { opacity: 255 }).start();
        }

        // 自动消失：hold durationMs 后淡出（除非被 action 提前关闭）。
        tween(op)
            .delay(0.28 + durationMs / 1000)
            .call(() => this._dismiss(root2, reduced, false))
            .start();
        void actionBtn;
    },

    _dismiss(node: Node, reduced: boolean, immediate: boolean): void {
        if (!node?.isValid) {
            if (this._activeNode === node) this._activeNode = null;
            this._drain();
            return;
        }
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        const finish = (): void => {
            if (node.isValid) node.destroy();
            if (this._activeNode === node) this._activeNode = null;
            // 间隔 GAP_MS 再播下一条，避免两条浮条视觉黏连。
            const root = this._root;
            if (root?.isValid) {
                const timer = new Node('toastGap');
                timer.parent = root;
                timer.addComponent(UITransform);
                tween(timer)
                    .delay(GAP_MS / 1000)
                    .call(() => { if (timer.isValid) timer.destroy(); this._drain(); })
                    .start();
            }
        };
        Tween.stopAllByTarget(op);
        if (reduced || immediate) {
            tween(op).to(0.16, { opacity: 0 }).call(finish).start();
        } else {
            tween(op).to(0.3, { opacity: 0 }).call(finish).start();
            tween(node).to(0.3, { position: v3(node.position.x, node.position.y + 24, 0) }, { easing: 'quadIn' }).start();
        }
    },
};
