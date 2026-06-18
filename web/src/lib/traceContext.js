/**
 * v1.71 NN-F1: 轻量 trace context（OpenTelemetry-style 但零依赖）。
 *
 * 用途：把游戏内一次"用户动作 → DFS 计算 → metricsRecorder 记录 →
 * logger 输出 → alert 触发"链路用同一 traceId 串起来，便于事后排查
 * "某次卡顿到底走了什么路径"。
 *
 * 设计原则（保持极简，避免引入 OpenTelemetry 几 MB 依赖）：
 *   1. traceId：16 字符 hex（96 bit 熵足够单局唯一）
 *   2. spanId：8 字符 hex（一次 trace 内可有多个 span）
 *   3. parent context：栈式 push/pop（with* 模式）
 *   4. 与现有 metricsRecorder / logger 集成方式：
 *      调用方在 record 时附 `_traceId` / `_spanId` 字段；
 *      未提供时 fallback 'untraced'
 *
 * 不做的事（YAGNI）：
 *   - 不做 distributed tracing（没有跨服务调用）
 *   - 不做 sampling（前期全 trace，量大再加）
 *   - 不做 OpenTelemetry exporter（量大再用专门方案）
 *
 * 落地状态：MVP；现有 metricsRecorder / logger 接入待 NN-F1.x 后续
 * （本次只引入 API，零侵入；未来逐步在 hot path 用 withTrace 包裹）。
 */

const HEX = '0123456789abcdef';

/** 16 字符 hex traceId（96 bit 熵）。 */
export function newTraceId() {
    let s = '';
    for (let i = 0; i < 16; i++) s += HEX[(Math.random() * 16) | 0];
    return s;
}

/** 8 字符 hex spanId（48 bit 熵）。 */
export function newSpanId() {
    let s = '';
    for (let i = 0; i < 8; i++) s += HEX[(Math.random() * 16) | 0];
    return s;
}

/** @typedef {{ traceId: string, spanId: string, parentSpanId?: string, name?: string }} TraceCtx */

let _current = /** @type {TraceCtx | null} */ (null);

/** 当前 trace context（无激活返回 null）。 */
export function currentTrace() {
    return _current;
}

/**
 * 启动新 trace + 在 fn 内激活。
 * @template T
 * @param {string} name 顶层 span 名（如 'placeShape' / 'dfsRun'）
 * @param {(ctx: TraceCtx) => T} fn
 * @returns {T}
 */
export function withNewTrace(name, fn) {
    const ctx = { traceId: newTraceId(), spanId: newSpanId(), name };
    const prev = _current;
    _current = ctx;
    try {
        return fn(ctx);
    } finally {
        _current = prev;
    }
}

/**
 * 在已激活的 trace 中新增 child span，激活 fn。
 * 若无激活 trace，自动起新 trace。
 * @template T
 * @param {string} name
 * @param {(ctx: TraceCtx) => T} fn
 * @returns {T}
 */
export function withSpan(name, fn) {
    if (!_current) return withNewTrace(name, fn);
    const ctx = {
        traceId: _current.traceId,
        spanId: newSpanId(),
        parentSpanId: _current.spanId,
        name,
    };
    const prev = _current;
    _current = ctx;
    try {
        return fn(ctx);
    } finally {
        _current = prev;
    }
}

/**
 * 给一个 event payload 附 trace 元数据（无 trace 时 untraced）。
 * @template T
 * @param {T} payload
 * @returns {T & { _traceId: string, _spanId: string, _spanName?: string }}
 */
export function annotate(payload) {
    if (_current) {
        return { ...payload, _traceId: _current.traceId, _spanId: _current.spanId, _spanName: _current.name };
    }
    return { ...payload, _traceId: 'untraced', _spanId: '00000000' };
}

/** 测试用：强制重置 current（供 vitest setup）。 */
export function _resetTraceContext() {
    _current = null;
}
