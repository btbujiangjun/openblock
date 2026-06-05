import { Node, Vec3, tween } from 'cc';

/**
 * 屏幕抖动（作用于游戏根容器节点）。基于初始位置做衰减随机偏移再归位。
 */
export class ScreenShake {
    private static running = new WeakSet<Node>();

    static shake(node: Node, intensity = 12, duration = 0.28): void {
        if (!node) return;
        const base = node.position.clone();
        if (this.running.has(node)) {
            // 已在抖动，叠加不重复绑定 base，避免漂移
            return;
        }
        this.running.add(node);
        const steps = 6;
        const seq = tween(node);
        for (let i = 0; i < steps; i++) {
            const k = 1 - i / steps;
            const dx = (Math.random() * 2 - 1) * intensity * k;
            const dy = (Math.random() * 2 - 1) * intensity * k;
            seq.to(duration / steps, { position: new Vec3(base.x + dx, base.y + dy, base.z) });
        }
        seq.to(duration / steps, { position: base })
            .call(() => this.running.delete(node))
            .start();
    }
}
