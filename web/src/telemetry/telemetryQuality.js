/**
 * telemetryQuality.js — 埋点质量监控（DA-4）
 *
 * 纯函数：从一批上报记录算出丢失率与延迟分位（p50/p95），并按阈值产出告警。
 * 用于 `/ops` 埋点健康卡片与 CI 守门，不依赖任何运行时（localStorage/network）。
 *
 * 记录形态（每条）：
 *   { sentTs, ackTs?, lost? }
 *     - lost === true            → 计为丢失
 *     - ackTs 缺失 / ≤ sentTs    → 计为丢失（无有效回执）
 *     - 否则 latency = ackTs - sentTs（毫秒）
 */

export const DEFAULT_TELEMETRY_THRESHOLDS = Object.freeze({
    maxLossRate: 0.02,      // 丢失率 > 2% 告警
    maxLatencyP95: 2000,    // p95 延迟 > 2s 告警
    minSamples: 30,         // 样本不足则只提示、不判定健康
});

/** 线性插值分位数（values 需已排序，q ∈ [0,1]）。 */
export function percentile(sortedValues, q) {
    const n = sortedValues.length;
    if (n === 0) return 0;
    if (n === 1) return sortedValues[0];
    const idx = q * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedValues[lo];
    const frac = idx - lo;
    return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

/**
 * 计算一批记录的埋点质量。
 * @param {Array<{sentTs:number, ackTs?:number, lost?:boolean}>} events
 * @returns {{ total, lost, delivered, lossRate, latencyP50, latencyP95, latencyAvg }}
 */
export function computeTelemetryQuality(events) {
    const list = Array.isArray(events) ? events : [];
    const total = list.length;
    const latencies = [];
    let lost = 0;
    for (const e of list) {
        const sent = Number(e?.sentTs);
        const ack = Number(e?.ackTs);
        if (e?.lost === true || !Number.isFinite(ack) || !Number.isFinite(sent) || ack <= sent) {
            lost += 1;
            continue;
        }
        latencies.push(ack - sent);
    }
    latencies.sort((a, b) => a - b);
    const delivered = latencies.length;
    const avg = delivered > 0 ? latencies.reduce((s, v) => s + v, 0) / delivered : 0;
    return {
        total,
        lost,
        delivered,
        lossRate: total > 0 ? Number((lost / total).toFixed(6)) : 0,
        latencyP50: Number(percentile(latencies, 0.5).toFixed(2)),
        latencyP95: Number(percentile(latencies, 0.95).toFixed(2)),
        latencyAvg: Number(avg.toFixed(2)),
    };
}

/**
 * 按阈值评估告警。
 * @param {object} quality computeTelemetryQuality 的返回
 * @param {object} [thresholds]
 * @returns {{ healthy:boolean, lowSample:boolean, alerts: Array<{code,severity,message}> }}
 */
export function evaluateTelemetryAlerts(quality, thresholds = {}) {
    const cfg = { ...DEFAULT_TELEMETRY_THRESHOLDS, ...thresholds };
    const alerts = [];
    const lowSample = (quality?.total ?? 0) < cfg.minSamples;

    if ((quality?.lossRate ?? 0) > cfg.maxLossRate) {
        alerts.push({
            code: 'HIGH_LOSS_RATE',
            severity: 'error',
            message: `埋点丢失率 ${(quality.lossRate * 100).toFixed(2)}% > 阈值 ${(cfg.maxLossRate * 100).toFixed(2)}%`,
        });
    }
    if ((quality?.latencyP95 ?? 0) > cfg.maxLatencyP95) {
        alerts.push({
            code: 'HIGH_LATENCY_P95',
            severity: 'warn',
            message: `埋点 p95 延迟 ${quality.latencyP95}ms > 阈值 ${cfg.maxLatencyP95}ms`,
        });
    }
    if (lowSample) {
        alerts.push({
            code: 'LOW_SAMPLE',
            severity: 'info',
            message: `样本量 ${quality?.total ?? 0} < ${cfg.minSamples}，健康判定仅供参考`,
        });
    }

    return {
        healthy: !lowSample && alerts.every((a) => a.severity !== 'error' && a.severity !== 'warn'),
        lowSample,
        alerts,
    };
}
