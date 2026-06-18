# ADR-003: adaptiveSpawn.js 暂保持单文件（不拆 spawnHints/ 子目录）

**Status**: Accepted（NN-D1 评估结论）
**Date**: 2026-06-19

## Context

`web/src/adaptiveSpawn.js` 现有 3905 行。NN-D1 候选：拆成 `spawnHints/`
子目录，按 rule 类别（baseRules / riskRelief / topology / phase 等）分文件。

## Decision

**保持单文件**。不拆分。

## 理由

1. **跨平台同步成本**：
   - `npm run sync:core` 当前用 sed/awk 单文件复制到 mini-program / cocos
   - 拆目录需要：① 改 sync 脚本支持目录树 ② 处理 mini-program import 语法
     差异（无 `from` 路径别名）③ cocos `.mjs` 路径分隔符
   - 三端同步出问题代价 = spawnGolden 全红 + 用户行为差异
2. **已通过 helper 抽取充分降低复杂度**：
   - LL2 / JJ2 / MM2 抽出 ~15 个 helper（_applySpawnHintsXxxRule）
   - 每个 helper 独立测试（220+ adaptiveSpawnHelpers 测试）
   - `_applySpawnHintsBaseRules` 已是纯 helper 调用序列
3. **IDE 跳转 + outline 解决了"找代码慢"**：
   - VS Code outline 显示所有 export
   - `Cmd+Click` 跳转到 helper 等价分文件
4. **拆分后仍需 import 链**：
   - rule 间数据依赖（topoCfg / s / cfg）每文件都要 import
   - 实际"小文件多"未必比"大文件单"易读

## Consequences

- ✅ 保持 sync:core 简单稳定
- ✅ 不破坏 spawnGolden 18 测试和 helpers 220+ 测试
- ❌ 单文件 3905 行——新人初次阅读心智负担
  - 缓解：已有 30+ 行级注释 + `v1.71 LL2/JJ2/MM2` tag 索引位置

## Related

- LL2 / JJ2 / MM2: helper 抽取（已落地）
- NN-F3 候选: rule DSL 数组化（更激进的解法，若做了即可消化大文件）

## Revisit Trigger

- 文件超过 5000 行
- 跨平台 sync 已支持目录树（与 sync:resources 同等能力）
- NN-F3 DSL 落地，rule 元数据驱动后单文件价值下降
