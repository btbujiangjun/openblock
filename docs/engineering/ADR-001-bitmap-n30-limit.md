# ADR-001: grid bitmap 路径 n>30 限制保持不拓展

**Status**: Accepted（NN-A2 评估结论）
**Date**: 2026-06-19
**Context**: NN 系列性能改进评估

## Context

`web/src/grid.js` 的 bitmap 优化路径（`_buildBitmapView` / `bestMonoFlushPotential`
/ `bestMonoFlushBuildup` / `countGapFills` / `findGapPositions` / `getFillRatio`）
均限制 `n <= 30`，n>30 走 N² 慢路径。原因是 JS 位运算操作数自动转 int32（31 位
+ 符号位），`1 << 31` 会溢出符号扩展导致 mask 错误。

NN-A2 候选方案：用 `BigUint64Array` 拓展到 n>30，让大盘面也走 bitmap 优化。

## Decision

**保持现状。** 不拓展 BigUint64 路径。理由：

1. **实际场景全部 8×8**：
   - `shared/game_rules.json` 三个 strategy 全部 `gridWidth: 8`
   - 默认 `CONFIG.GRID_SIZE = 8`
   - simulator / RL / moveSequence 均 fallback `|| 8`
   - 即使未来加 10×10 / 12×12，距 n=30 边界仍极远

2. **BigInt 比 int32 慢**：
   - V8 BigInt 算法用堆分配 + GC 路径（不像 SMI 寄存器内联）
   - `Math.clz32` 等 popcount 工具无 BigInt 等价（需 polyfill）
   - 实际拓展会让 8×8 主流路径**变慢** ~30%（与初衷相反）

3. **n>30 fallback 已经存在**：
   - 慢路径 `_findGapPositionsSlow` 等已实测正确
   - 真的有人开 31+ 盘面也不会崩，只是慢些（可接受）

4. **维护成本**：
   - 拓展会引入 ~200 行 BigUint64 helper + 双路径分支
   - 测试矩阵爆炸（每个 fast path 都要加 n>30 case）

## Consequences

- ✅ 主流 8×8 路径保持极致性能（int32 寄存器内联）
- ✅ 代码量不膨胀
- ❌ 未来若加 31+ 盘面玩法（如 endless mode）会回到 N² 慢路径
  - 缓解：那时再针对该模式做专项优化（如 cell streaming）

## Related

- NN-A1：`_iterateBitsUntil` 已在 int32 路径完成（已落地）
- NN-A3：`_buildMonoFlushBitmaps` 缓存（int32 路径优化，与本 ADR 不冲突）
- NN-A4：`findGapPositions` SoA 化（同上）

## Revisit Trigger

若任一发生，需重新评估本 ADR：
- 引入 `gridWidth >= 16` 的策略
- 大盘面 RL training 成为性能瓶颈（perf-check baseline 触发）
- BigInt JIT 优化在 V8/JSC 显著提升（如 inline BigInt 64-bit）
