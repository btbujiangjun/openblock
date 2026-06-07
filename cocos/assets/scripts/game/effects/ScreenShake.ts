import { Node } from 'cc';

/**
 * 屏幕抖动 —— 已禁用（严格对齐 web PC 主端）。
 *
 * web 端 `renderer.setShake` 为空实现、`shakeOffset` 恒为 0，盘面与根容器固定不动；
 * 消行 / 完美清屏 / 多消的反馈全部由粒子、全屏闪光与 HUD 飘字承担。为保持两端
 * 一致，cocos 这里把 `shake` 收敛为 no-op，但保留方法签名与所有调用点
 * （GameController 的 perfect / multi-line 等），避免散落改动调用处。
 *
 * 如需恢复振屏：参见 git 历史中本文件的 tween 衰减实现，去掉下方 no-op 即可。
 */
export class ScreenShake {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static shake(_node: Node, _intensity = 12, _duration = 0.28): void {
        // no-op：盘面固定不动，与 web 主端一致。
    }
}
