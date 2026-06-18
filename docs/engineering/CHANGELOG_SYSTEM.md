# 系统改进系列 CHANGELOG（U → NN）

本文件索引 v1.71 起的系统优化 / 重构系列任务。每系列约 5 个子任务，
按主题分组。**ADR**（架构决策）链接到独立文档。

> 命名约定：tag 系列 → 主题 → commit。grep `<TAG>` 即可定位历史代码上下文。

---

## v1.71 系列总览

| 系列 | 主题 | 状态 |
|---|---|---|
| **U** | 系统观测起点（DFS budget / outbox / 等基础度量） | 已完成 |
| **V-Z** | 各系统观测 + 内聚度初步抽取 | 已完成 |
| **AA-EE** | grid bitmap 优化 + 分窗口指标 | 已完成 |
| **FF-HH** | 模块边界 + 配置抽取 + DFS 修剪 | 已完成 |
| **II** | bitmap canPlace 加速 + 报告/CI 闸门 | 已完成 |
| **JJ** | 持续优化 + 历史压缩 + workflow lint 起步 | 已完成 |
| **KK** | 配置外移 + dashboard 链接 + secret 规范 | 已完成 |
| **LL** | 共享工具 + audit-artifacts + SHA pinning + schema 版本 | 已完成 |
| **MM** | _iterateBits + injection 守护 + audit workflow + perf-baseline 守护 | 已完成 |
| **NN** | review-driven：性能/安全/schema/重构/闸门/愿景 | **本次** |

---

## NN 系列（本次）— Review-Driven 全面改进

### NN-A 性能 / 算法
| ID | 主题 | commit | 状态 |
|---|---|---|---|
| A1 | `_iterateBitsUntil` 替换 countGapFills 含 break 模式 | `a51dd30` | ✅ |
| A2 | n>30 不拓展 BigUint64 | [ADR-001](ADR-001-bitmap-n30-limit.md) | 🟡 wont-fix |
| A3 | `_monoBitmapCache` 同帧 grid 投影复用 | `d6d4b1a` | ✅ |
| A4 | `findGapPositions` 不 SoA 化 | [ADR-002](ADR-002-findgappositions-soa.md) | 🟡 wont-fix |

### NN-B 安全 / CI 防御
| ID | 主题 | commit | 状态 |
|---|---|---|---|
| B1 | 修 MM2 死字段 `bottleneckClearGuarantee` | `ef71a87` | ✅ |
| B2 | `no-untrusted-input-script`（github-script JS 注入） | `e9...` | ✅ |
| B3 | `no-prt-checkout-head`（pull_request_target RCE，P0） | 同上 | ✅ |
| B4 | `no-untrusted-input-if`（if 表达式注入） | 同上 | ✅ |
| B5 | weekly audit 固定 Issue tracker | 同上 | ✅ |

### NN-C Schema 演进 / 可观测
| ID | 主题 | commit | 状态 |
|---|---|---|---|
| C1 | perf-baseline `_migrateBaseline` 对称 LL5 | `3d302ef` | ✅ |
| C2 | Grafana dashboards `schemaVersion` lint contract | 同上 | ✅ |
| C3 | game_rules `_migrateRules` + 客户端守护 | 同上 | ✅ |
| C4 | `scripts/_lib/schemaGuard.mjs` 公共工具 | 同上 | ✅ |

### NN-D 重构 / 内聚度
| ID | 主题 | commit | 状态 |
|---|---|---|---|
| D1 | adaptiveSpawn 保持单文件 | [ADR-003](ADR-003-adaptivespawn-monolithic.md) | 🟡 wont-fix |
| D2 | grid.js 保持单文件 | [ADR-004](ADR-004-grid-monolithic.md) | 🟡 wont-fix |
| D3 | `scripts/_lib/` cli + markdownReport 公共工具 | 同 commit | ✅ |
| D4 | tests/ 保持扁平 | [ADR-005](ADR-005-tests-flat-layout.md) | 🟡 wont-fix |

### NN-E 工程闸门
| ID | 主题 | commit | 状态 |
|---|---|---|---|
| E1 | 修 feedbackToggles + observabilityWindowSchema pre-existing 失败 | (本次) | ✅ |
| E2 | `npm run preflight` 聚合 lint + verify + test | (本次) | ✅ |
| E3 | 本文档（系统 CHANGELOG 索引） | (本次) | ✅ |
| E4 | `check-dead-config-keys.mjs` 防 MM2 同类死字段复发 | (本次) | ✅ |

### NN-F 架构层（更大胆，多数 ADR）
| ID | 主题 | 状态 |
|---|---|---|
| F1 | OpenTelemetry-style trace context | ADR / 评估中 |
| F2 | gameRules remote config CDN | ADR / 评估中 |
| F3 | adaptiveSpawn 规则 DSL | ADR / 评估中 |
| F4 | bitmap 移到 WebAssembly | ADR / 评估中 |

---

## 历史快速索引（U→MM 简表）

| 系列 | 5 句话总结 |
|---|---|
| U-W | DFS budget 起点；outbox 持久化；analytics IDB + LS fallback |
| X-Y | DFS skipMeta 加速；config 外移；relays/sinks 分离 |
| Z | observability *_window schema 起步 |
| AA-CC | grid bitmap fast path；canPlace O(1) 化 |
| DD-EE | findGapPositions bitmap；countGapFills 绕开 helper 直走 popcount |
| FF-HH | DFS 剪枝；fillRatio 优化；模块边界初始划分 |
| II | bestMonoFlushPotential canPlace 加速；trend WoW sparkline；CI artifact retention |
| JJ | bestMonoFlushBuildup 同 II；adaptiveSpawn baseRules 抽 helpers；workflow lint 起步 |
| KK | buildup 内圈预剪枝；riskReliefTable 外移；dashboard 关联 alerts；perf-check 状态分桶 |
| LL | `_buildMonoFlushBitmaps` 共享；audit-artifacts；SHA pinning；trend schemaVersion |
| MM | `_iterateBits`；holesRule cfg 外移；weekly audit；injection check；perf-baseline schemaVersion |

## ADR 索引

- [ADR-001](ADR-001-bitmap-n30-limit.md) - grid n>30 不拓展 BigUint64
- [ADR-002](ADR-002-findgappositions-soa.md) - findGapPositions 保持 AoS
- [ADR-003](ADR-003-adaptivespawn-monolithic.md) - adaptiveSpawn 单文件
- [ADR-004](ADR-004-grid-monolithic.md) - grid.js 单文件
- [ADR-005](ADR-005-tests-flat-layout.md) - tests/ 扁平布局

## 维护规则

- 每次新增系列（如 OO）+ 5 任务时在本文件加表
- ADR 决议必须列 **Revisit Trigger**，让未来重启条件清晰
- "🟡 wont-fix" 不代表永久放弃，只是当前 ROI 不合算
- 命名前缀（NN-A1 / NN-B3 等）在代码注释 / commit message / test 文件名一致出现
