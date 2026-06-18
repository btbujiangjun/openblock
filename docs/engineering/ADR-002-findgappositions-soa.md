# ADR-002: findGapPositions 暂不 SoA 化

**Status**: Accepted（NN-A4 评估结论）
**Date**: 2026-06-19
**Context**: NN 系列性能改进评估

## Context

NN-A4 候选方案：把 `Grid.findGapPositions()` 返回的
`positions: [{x,y}, ...]` AoS（Array of Structures）改成
`xs: Int32Array, ys: Int32Array` SoA（Structure of Arrays），消除 V8
hidden class 分配 + 提升 CPU cache locality。

## Decision

**保持现状 AoS。** 不做 SoA 化。理由：

1. **无生产消费者**：
   - grep `findGapPositions(` 全工程：**仅在测试和文档中出现**
   - 生产代码（blockSpawn / clearScoring / adaptiveSpawn / DFS）均不调
   - 真正的 hot path `countGapFills`（EE3）已绕开 `findGapPositions`
     直接走 `_buildBitmapView` + popcount，**不分配 `{x,y}` 对象**

2. **测试 API 价值**：
   - `findGapPositions` 主要供调试 / 单测 / 算法验证（fast == slow）
   - 测试场景对 `{x,y}` AoS 结构更直观（`expect(positions[0]).toEqual({x:3,y:5})`）
   - 改 SoA 会让 50+ 测试断言变得难写难读

3. **过早优化反例**：
   - 真生产路径已无对象分配（EE3 已优化）
   - SoA 是为 **百万次/秒** 调用准备的，本 API 单局调用 <100 次
   - V8 SMI 对象 in-line cache 已能消化 8×8=64 个 `{x,y}` 的分配（μs 级）

## Consequences

- ✅ 不破坏现有测试 API（50+ 断言保持）
- ✅ 维护成本最低（不引入双 API/接口转换层）
- ❌ 未来若需 1万+ 次/秒调用 findGapPositions，会有 GC 压力
  - 缓解：那时加 `findGapPositionsSoA()` 平行 API（不替换）

## Related

- EE3：`countGapFills` 已直接走 bitmap，无 `{x,y}` 分配
- NN-A3：`_monoBitmapCache` 已在 grid 投影层省分配
- DD3：`findGapPositions` bitmap fast path 已优化

## Revisit Trigger

若任一发生，需重新评估：
- 引入 RL self-play 时 findGapPositions 每帧多次调用（性能 profile 命中）
- 引入 Monte Carlo tree search 在 inner loop 调 findGapPositions
- perf-check baseline 显示 findGapPositions 占 >5% wall time
