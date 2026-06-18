# ADR-006: 轻量 trace context（不引入 OpenTelemetry）

**Status**: Accepted（NN-F1 评估结论）
**Date**: 2026-06-19

## Context

现有观测体系（metricsRecorder / logger / alerts）各自记录但缺统一 trace。
NN-F1 候选：引入 OpenTelemetry-style trace context 串联 hot path。

OpenTelemetry JS SDK 完整方案 ~3MB（核心 + exporter + propagator），对
mini-program / cocos 都太重。

## Decision

**实现极简自有 trace context**，零依赖：
- `web/src/lib/traceContext.js`（~80 行）
- API: `newTraceId / newSpanId / withNewTrace / withSpan / annotate / currentTrace`
- 与现有 metricsRecorder / logger 集成方式：调用方 `annotate(payload)`
  自动注入 `_traceId / _spanId`，下游 sink（Prometheus / IndexedDB）保留字段

## 渐进接入路线

**P0（本次 NN-F1 落地）**：
- ✅ traceContext.js 引入 + 单测
- ❌ hot path 暂不强制 wrap（避免一次性大改动）

**P1（NN-F1.1）**：在 `placeShape` 入口 `withNewTrace('placeShape', () => ...)`
- 影响：blockSpawn / DFS / clearScoring 同一 trace 内
- 落地点：`web/src/game.js` 中 placeShape 调用方

**P2（NN-F1.2）**：metricsRecorder / logger 接受 `_traceId` 字段并持久化
- 影响：Grafana / 日志查询可按 traceId 串联

**P3（NN-F1.3）**：cross-frame trace（一次完整 dock cycle）
- 需要在 dock spawn 起 trace，持续到 placement done

## 替代方案对比

| 方案 | bundle 增量 | 标准化 | 学习曲线 | 决议 |
|---|---|---|---|---|
| OpenTelemetry SDK | +3MB | ✅ | 中 | ❌ 太重 |
| **自有 ~80 行** | +1KB | ❌ | 极低 | ✅ MVP |
| 不做 | 0 | — | — | ❌ 观测断链 |

## Revisit Trigger

- 接入云端 APM（Datadog / NewRelic）→ 改 OpenTelemetry 标准
- 出现跨 worker / cross-iframe 调用 → 需 propagator
- bundle 体积预算放宽 → 评估 @opentelemetry/api（仅 API 层 ~50KB）

## Related

- 现有：U/V/Z 系列 metricsRecorder + logger
- 后续 NN-F1.x 子任务（hot path wrap / sink 持久化）
