# ADR-005: tests/ 保持扁平布局（不按系列分桶）

**Status**: Accepted（NN-D4 评估结论）
**Date**: 2026-06-19

## Context

`tests/` 目录现 400+ 文件。NN-D4 候选：按系列分桶（`tests/v1.71/MM/...`）。

## Decision

**保持扁平**。

## 理由

1. **import 路径破坏**：
   - 现有所有 test 用 `import ... from '../web/src/xxx'`
   - 分目录后变 `../../web/src/xxx` → 改 400+ 行 import
2. **vitest config glob 简化**：
   - 当前 `tests/**/*.test.js` 一招通吃
   - 嵌套后需校验所有 globs 命中
3. **文件名已编码系列**：
   - `gridIterateBitsMM1.test.js` / `bottleneckCfgNNB1.test.js`
   - Fuzzy file finder（VS Code Cmd+P）按系列搜效果等价目录分桶
4. **CI 性能影响 = 0**：
   - vitest 并发 worker 与目录结构无关
5. **若真要分桶**：
   - 直接用文件命名规约（已在做）+ `npm test -- tests/*MM*` 选择性跑

## Consequences

- ✅ 不破坏现有 400+ test imports
- ✅ vitest config 保持简单
- ❌ 单目录文件多，scroll bar 长
  - 缓解：IDE 文件树支持搜索过滤

## Related

- ADR-003 (adaptiveSpawn 单文件) / ADR-004 (grid 单文件) 同思路

## Revisit Trigger

- 测试文件 > 1000
- 加入测试分组并行需要按目录调度（如 frontend / backend / e2e 分离）
