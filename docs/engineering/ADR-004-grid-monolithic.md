# ADR-004: grid.js 保持单文件（不抽 geometry/bitmaps 模块）

**Status**: Accepted（NN-D2 评估结论）
**Date**: 2026-06-19

## Context

`web/src/grid.js` 1775 行。NN-D2 候选：抽 `geometry/bitmaps.js` 含
`_popcount32` / `_ctz32` / `_iterateBits` / `_iterateBitsUntil` /
`_buildMonoFlushBitmaps`。

## Decision

**保持单文件**。

## 理由

1. **跨平台 sync 复杂度**（同 ADR-003）
2. **bitmap helpers 是 Grid 内部实现细节**：
   - 仅 grid.js 内部消费
   - 不导出（前缀 `_` 表明）
   - 拆出后仍只服务 grid.js → 抽离价值低
3. **V8 内联优化跨模块边界更差**：
   - 同文件 helpers 易被 inline
   - 跨模块需要 V8 重新分析 + ICache invalidate
4. **本身已经按 v1.71 系列分段注释**（LL1/MM1/NN-A1/NN-A3 等 tag）

## 例外：何时该拆

- bitmap helpers 被 grid.js **以外**消费（例如新模块 placementValidator
  也要 popcount）→ 此时抽 helpers 到 `geometry/bitmaps.js`
- bitmap 移到 WASM（NN-F4）需要独立模块边界

## Related

- NN-A1 / NN-A3 / MM1 / LL1: bitmap helpers 演进
- NN-F4: WASM 落地后必然要抽模块边界

## Revisit Trigger

- grid.js > 3000 行
- bitmap helpers 被 grid.js 外部消费
- NN-F4 WASM 化启动
