import { _decorator, Component, director, input, Input, Node, game, Game } from 'cc';

const { ccclass } = _decorator;

/** 冻屏自愈外部回调（由 Bootstrap 注入）：触发 relayout + safeRedraw，尝试重发 draw command。 */
let _onFrozenRecover: (() => void) | null = null;
export function setFrozenRecoverHandler(fn: (() => void) | null): void {
    _onFrozenRecover = fn;
}

/**
 * 轻量运行时性能 / 冻屏 / 泄漏监控（诊断「越玩越卡 → 黑屏 / 触摸无响应」专用）。
 *
 * 每 WINDOW_MS 打一行汇总日志（Xcode / logcat / devtools 可见）：
 *   [OpenBlock][Perf] t=120s fps=58 heapMB=86(+12) nodes=742(+30) touches=4 lowFps=0
 *
 * 关注点：
 *   - fps 是否随时长单调下滑（持续高强度绘制 / 主线程渐重）；
 *   - heapMB 是否单调上涨且不回落（JS 侧内存泄漏：节点/闭包/数组未释放）；
 *   - nodes 是否单调上涨（场景节点泄漏：创建未销毁/未回收进池）；
 *   - touches：本窗口的全局触摸事件计数。
 *     ⭐ 「fps 正常 + 连续多个窗口 touches=0」= 冻屏指纹：Activity 已被系统重建 / EGL surface 失效，
 *        JS 主循环仍在跑（看似一切正常），但所有触摸事件被原生层丢弃 → 玩家看到「全屏无响应」。
 *        此态下日志升级为 `[Frozen?]` warn，便于在长日志中检索冻屏的精确开始时刻。
 *   ＋ 字段 = 相对「基线（第 2 个窗口，跳过启动抖动）」的增量；持续为正且增大即为泄漏信号。
 *
 * 设计为零依赖、低噪音（每 5s 一行），定位完问题后把 ENABLED 置 false 即可彻底静默。
 * heapMB 仅 Chromium / Android WebView 暴露 performance.memory；iOS WKWebView / 原生 JSB 上为 -1（正常）。
 */
@ccclass('PerfMonitor')
export class PerfMonitor extends Component {
    /** 总开关：定位完成后改 false 即彻底静默（也可由 Bootstrap 决定是否 attach）。 */
    static ENABLED = true;

    private static readonly WINDOW_MS = 5000;
    /** fps 低于此阈值的帧计为「卡顿帧」，窗口内累计上报。 */
    private static readonly LOW_FPS = 45;

    private _frames = 0;
    private _lowFrames = 0;
    private _windowStartMs = 0;
    private _bootMs = 0;
    private _lastDt = 1 / 60;
    /** 基线（第 2 个窗口建立，避开启动期的资源加载抖动）。 */
    private _baseHeapMB = -1;
    private _baseNodes = -1;
    private _baselined = false;
    /** 本窗口触摸事件计数（任一通道：start/move/end/cancel）。 */
    private _touches = 0;
    /** 连续无触摸的窗口数；≥ FROZEN_THRESHOLD_WINDOWS 时升级冻屏告警。 */
    private _idleTouchWindows = 0;
    /** 连续多少个窗口（5s/窗口）「fps 正常 + 0 触摸」判定为冻屏；3 ≈ 15s 静默，对玩家无干扰但能稳定捕捉。 */
    private static readonly FROZEN_THRESHOLD_WINDOWS = 3;
    /** 冻屏持续多少个窗口后强制触发自愈（relayout + safeRedraw + LOW_MEMORY trim）。
     *  6 窗口 = 30s 持续冻屏 → 比 FROZEN_THRESHOLD_WINDOWS=3（15s）更保守，避免玩家"思考时间长"的误伤
     *  （15s 已经报警但不动手，30s 仍未恢复才动手）。每次触发后冷却 12 窗口=60s 避免风暴。 */
    private static readonly FROZEN_RECOVER_WINDOWS = 6;
    private static readonly FROZEN_RECOVER_COOLDOWN_WINDOWS = 12;
    private _recoverCooldown = 0;

    private _onTouch = (): void => { this._touches++; };

    onLoad(): void {
        const now = Date.now();
        this._windowStartMs = now;
        this._bootMs = now;
        // 在全局 input 通道注册轻量计数器：与 GameController 的触摸处理是同一通道，
        // 若这里收不到事件 = 原生层就根本没派发上来（surface/Activity 异常的指纹）。
        input.on(Input.EventType.TOUCH_START, this._onTouch);
        input.on(Input.EventType.TOUCH_END, this._onTouch);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouch);
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouch);
        input.off(Input.EventType.TOUCH_END, this._onTouch);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouch);
    }

    update(dt: number): void {
        if (!PerfMonitor.ENABLED) return;
        this._frames++;
        this._lastDt = dt;
        if (dt > 0 && 1 / dt < PerfMonitor.LOW_FPS) this._lowFrames++;

        const now = Date.now();
        const elapsed = now - this._windowStartMs;
        if (elapsed < PerfMonitor.WINDOW_MS) return;

        const fps = Math.round((this._frames * 1000) / elapsed);
        const lowFps = this._lowFrames;
        const heapMB = this.heapMB();
        const nodes = this.countNodes();
        const tSec = Math.round((now - this._bootMs) / 1000);

        // 第 2 个窗口建立基线（首窗口含启动加载，不具代表性）。
        if (!this._baselined && tSec >= Math.round(PerfMonitor.WINDOW_MS / 1000)) {
            this._baseHeapMB = heapMB;
            this._baseNodes = nodes;
            this._baselined = true;
        }

        const heapDelta = this._baseHeapMB >= 0 && heapMB >= 0 ? heapMB - this._baseHeapMB : 0;
        const nodeDelta = this._baseNodes >= 0 ? nodes - this._baseNodes : 0;
        const heapStr = heapMB >= 0 ? `${heapMB}(${heapDelta >= 0 ? '+' : ''}${heapDelta})` : 'n/a';

        // 冻屏检测：fps 正常但本窗口 0 触摸 → idleWindows+1；任一触摸 → 清零。
        if (this._touches === 0 && fps >= 20) this._idleTouchWindows++;
        else this._idleTouchWindows = 0;
        const frozen = this._idleTouchWindows >= PerfMonitor.FROZEN_THRESHOLD_WINDOWS;

        const line = `[OpenBlock][Perf] t=${tSec}s fps=${fps} heapMB=${heapStr} nodes=${nodes}(${nodeDelta >= 0 ? '+' : ''}${nodeDelta}) touches=${this._touches} lowFps=${lowFps}`;
        if (frozen) {
            // 冻屏指纹：JS 心跳健康但触摸不可达。多在 Activity 被系统重建 / EGL surface 失效后出现，
            // 是 Android 「玩一会儿后顶部工具栏弹出 → 全屏无响应」/ iOS 系统中断态的稳定标识。
            // 注意：玩家正常思考也会触发 0 触摸窗口；阈值 3×5s=15s 排除了思考态，仅在真正冻屏时报警。
            console.warn(`${line} [Frozen?] idleWindows=${this._idleTouchWindows} ⚠️`);
            // 冻屏持续 30s 且不在冷却中 → 尝试主动自愈：通知 Bootstrap 重发 draw command 并
            // 自己触发一次 Game.EVENT_LOW_MEMORY（模拟系统内存预警）让 trim 路径跑一遍。
            // 这是 JS 侧能做的最后一道防线 —— 若 surface 真彻底失效仍无法救回，但能覆盖"软冻屏"。
            if (this._idleTouchWindows >= PerfMonitor.FROZEN_RECOVER_WINDOWS && this._recoverCooldown <= 0) {
                this._recoverCooldown = PerfMonitor.FROZEN_RECOVER_COOLDOWN_WINDOWS;
                console.warn(`[OpenBlock][Perf] frozen for ${this._idleTouchWindows * (PerfMonitor.WINDOW_MS / 1000)}s → triggering recover (relayout + LOW_MEMORY trim)`);
                try { _onFrozenRecover?.(); } catch (e) { console.warn('[OpenBlock][Perf] recover handler threw', e); }
                try { game.emit(Game.EVENT_LOW_MEMORY); } catch (e) { console.warn('[OpenBlock][Perf] emit LOW_MEMORY threw', e); }
            }
        } else if (fps < 30 || heapDelta > 64 || nodeDelta > 300) {
            console.warn(`${line} ⚠️`);
        } else {
            console.log(line);
        }
        if (this._recoverCooldown > 0) this._recoverCooldown--;

        this._frames = 0;
        this._lowFrames = 0;
        this._touches = 0;
        this._windowStartMs = now;
    }

    /** JS 堆占用（MB）；不支持的平台返回 -1。 */
    private heapMB(): number {
        const perf = (globalThis as unknown as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance;
        const used = perf?.memory?.usedJSHeapSize;
        return typeof used === 'number' ? Math.round(used / (1024 * 1024)) : -1;
    }

    /** 递归统计当前场景活动节点数（每窗口一次，成本可忽略）。 */
    private countNodes(): number {
        const scene = director.getScene();
        if (!scene) return 0;
        let count = 0;
        const walk = (n: Node): void => {
            count++;
            const kids = n.children;
            for (let i = 0; i < kids.length; i++) walk(kids[i]);
        };
        walk(scene as unknown as Node);
        return count;
    }
}
