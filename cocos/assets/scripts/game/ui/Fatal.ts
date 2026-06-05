import { Node, UITransform, Graphics, Label, Color } from 'cc';

/**
 * 原生端兜底错误显示：原生（iOS/Android）看不到 JS console，启动期异常会表现为
 * 「卡在启动屏 → 黑屏」。此处把捕获到的异常画到屏幕上，把黑屏变成可读报错，便于定位。
 * 用法：Bootstrap 早期 setFatalRoot(this.node)；关键入口 try/catch 调 reportFatal(tag, err)。
 */
let _root: Node | null = null;

export function setFatalRoot(n: Node): void {
    _root = n;
}

function fmt(err: unknown): string {
    if (err instanceof Error) return `${err.message}\n${err.stack ?? ''}`;
    try { return String(err); } catch { return '<unprintable error>'; }
}

export function reportFatal(tag: string, err: unknown): void {
    // 同时打到 console（web/编辑器可见）。
    try { console.error(`[OpenBlock][FATAL][${tag}]`, err); } catch { /* ignore */ }
    try {
        const root = _root;
        if (!root || !root.isValid) return;
        const n = new Node(`Fatal_${tag}`);
        n.parent = root;
        n.setSiblingIndex(root.children.length - 1);
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0.5, 0.5);
        ut.setContentSize(720, 1280);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(12, 0, 0, 245);
        g.rect(-1000, -1500, 2000, 3000);
        g.fill();

        const msg = new Node('msg');
        msg.parent = n;
        const mt = msg.addComponent(UITransform);
        mt.setAnchorPoint(0.5, 1);
        mt.setContentSize(680, 1180);
        msg.setPosition(0, 600, 0);
        const l = msg.addComponent(Label);
        l.string = `FATAL [${tag}]\n\n${fmt(err)}`;
        l.fontSize = 20;
        l.lineHeight = 24;
        l.color = new Color(255, 180, 180, 255);
        l.horizontalAlign = Label.HorizontalAlign.LEFT;
        l.verticalAlign = Label.VerticalAlign.TOP;
        l.enableWrapText = true;
        l.overflow = Label.Overflow.CLAMP;
    } catch { /* 兜底里再崩就放弃 */ }
}

/** 包裹一段可能抛错的逻辑：抛错时显示并吞掉（返回是否成功）。 */
export function guard(tag: string, fn: () => void): boolean {
    try { fn(); return true; } catch (e) { reportFatal(tag, e); return false; }
}
