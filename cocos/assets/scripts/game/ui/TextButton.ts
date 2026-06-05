import { _decorator, Component, Label, UITransform, Color, tween, Vec3 } from 'cc';
import { TapBus } from './uiKit';

const { ccclass } = _decorator;

/** 极简文本按钮（无资源）。点击缩放反馈 + onClick 回调。
 *  点击通过全局 TapBus 分发（原生端 node 级触摸不可靠），由 GameController 命中触发。 */
@ccclass('TextButton')
export class TextButton extends Component {
    private label!: Label;
    private onClick: (() => void) | null = null;
    private _unreg: (() => void) | null = null;

    /**
     * @param hit 显式命中区尺寸（可选）。emoji 的 `text.length` 是代理对长度（如 '🎨'.length===2），
     *            按文字推算的命中区只有约 52×42，相邻按钮间留大片死区、在原生端极难点中；
     *            HUD 图标按钮统一传入更大的固定命中区，保证可靠点击。
     */
    init(text: string, fontSize: number, onClick: () => void, hit?: { w: number; h: number }): TextButton {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        if (hit) uit.setContentSize(hit.w, hit.h);
        else uit.setContentSize(fontSize * Math.max(2, text.length), fontSize + 16);
        this.label = this.node.getComponent(Label) || this.node.addComponent(Label);
        this.label.string = text;
        this.label.fontSize = fontSize;
        this.label.lineHeight = fontSize + 4;
        this.label.color = new Color(230, 235, 245, 255);
        this.onClick = onClick;
        this._unreg = TapBus.add(this.node, () => this.fire());
        return this;
    }

    setText(text: string): void {
        if (this.label) this.label.string = text;
    }

    private fire(): void {
        // 轻微按压反馈
        tween(this.node)
            .to(0.06, { scale: new Vec3(0.92, 0.92, 1) })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
        if (this.onClick) this.onClick();
    }

    onDestroy(): void {
        if (this._unreg) this._unreg();
        this._unreg = null;
    }
}
