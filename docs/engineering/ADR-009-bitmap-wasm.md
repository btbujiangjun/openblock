# ADR-009: bitmap 算法 WebAssembly 化

**Status**: Proposed（NN-F4 路线图）
**Date**: 2026-06-19

## Context

`grid.js` bitmap 操作（`_buildMonoFlushBitmaps` / `bestMonoFlushPotential`
/ `bestMonoFlushBuildup` / `countGapFills` / `findGapPositions`）占 DFS
~80% wall time。NN-A3 cache 已让同帧调用省 ~50%，但 inner loop 仍是 JS。

理论：WASM SIMD + 64-bit pack 应能再加速 2-3×。

## Decision（Proposed）

用 **AssemblyScript** 重写核心 bitmap 函数（语法接近 TypeScript，编译
到 WASM）。**保留 JS 实现作 fallback**，platform check 在加载时选路径。

## 不要做（YAGNI 但反例）

- ❌ **完全 WASM 化 grid.js**：Grid 类含 cells / cellMeta / Map / 高层逻辑，
  这些 V8 优化得很好，移 WASM 反而慢
- ❌ **AOT 编译整个 web/src**：构建复杂度爆炸

## 实施路线（NN-F4.x）

| 子任务 | 描述 | 估时 |
|---|---|---|
| F4.1 | AssemblyScript 项目骨架 + popcount/ctz 写起 | 1w |
| F4.2 | `_buildMonoFlushBitmaps` WASM 移植 + dispatcher | 1w |
| F4.3 | Benchmark：8×8 grid 5000 次调用 vs JS 基线 | 0.5w |
| F4.4 | mini-program / cocos WASM 加载兼容性测试 | 1w |
| F4.5 | Production rollout + perf-check baseline 重 capture | 0.5w |

总估时 ~4 周。**ROI 关键阈值**：实测必须 ≥2× 加速才值得（否则 WASM
加载 + 调度开销 wash out 收益）。

## 风险

1. **mini-program WASM 兼容性**：微信小程序 WASM 支持限制大
   - 缓解：mini-program 仍走 JS 路径，仅 web/cocos 用 WASM
2. **bundle 体积**：WASM 二进制 + AssemblyScript runtime ~50-100KB
   - 缓解：lazy load（DFS 路径首次触发时下载）
3. **构建复杂度**：CI 多一个 wasm-pack 步骤
   - 缓解：CI 缓存 WASM 产物（按 source hash）

## Revisit Trigger

- perf-check baseline 显示 bitmap 操作仍占 >60% wall time（cache 后）
- 加 12×12 grid（盘面变大，bitmap 复杂度 N²）
- mini-program WASM 支持显著改善
- 现有 NN-A* JS 优化都做完仍不达性能预算

## Related

- NN-A1 / NN-A3 / MM1 / LL1：JS 路径 bitmap 优化（必须先做完）
- ADR-001 / ADR-004：决议影响（WASM 化后 grid.js 反而需要拆模块）
