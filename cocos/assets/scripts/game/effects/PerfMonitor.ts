import { _decorator, Component, director, Node } from 'cc';

const { ccclass } = _decorator;

/**
 * 轻量运行时性能 / 泄漏监控（诊断「越玩越卡 → 黑屏」专用）。
 *
 * 每 WINDOW_MS 打一行汇总日志（Xcode / logcat / devtools 可见）：
 *   [OpenBlock][Perf] t=120s fps=58 heapMB=86(+12) nodes=742(+30) lowFps=0
 *
 * 关注点：
 *   - fps 是否随时长单调下滑（持续高强度绘制 / 主线程渐重）；
 *   - heapMB 是否单调上涨且不回落（JS 侧内存泄漏：节点/闭包/数组未释放）；
 *   - nodes 是否单调上涨（场景节点泄漏：创建未销毁/未回收进池）。
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

    onLoad(): void {
        const now = Date.now();
        this._windowStartMs = now;
        this._bootMs = now;
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

        const line = `[OpenBlock][Perf] t=${tSec}s fps=${fps} heapMB=${heapStr} nodes=${nodes}(${nodeDelta >= 0 ? '+' : ''}${nodeDelta}) lowFps=${lowFps}`;
        // 明显劣化（fps 低 / 堆涨 >64MB / 节点涨 >300）升级为 warn，便于在长日志里检索。
        if (fps < 30 || heapDelta > 64 || nodeDelta > 300) console.warn(`${line} ⚠️`);
        else console.log(line);

        this._frames = 0;
        this._lowFrames = 0;
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
