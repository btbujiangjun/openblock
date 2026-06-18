# ADR-007: gameRules remote config（CDN + 客户端 24h 拉取）

**Status**: Proposed（NN-F2 路线图，本次未落地实施）
**Date**: 2026-06-19

## Context

KK2 / MM2 / NN-B1 把 spawn 参数外移到 `game_rules.json`，但配置仍随
版本发版（app store 审核 + cocos 编译 + mini-program 审核 = 2-7 天）。
运营改一个 `holeClearGuarantee` 需要 release-train 等多天，难以快速 A/B 测试。

## Decision（Proposed）

引入 remote config 机制（前端拉 JSON CDN，客户端 24h 缓存）：

```
client startup:
  1. 读 bundle 内置 GAME_RULES（fallback）
  2. 异步拉 https://cdn.example.com/openblock/game_rules.{version}.json
     - 验证 schemaVersion 兼容（NN-C3 _migrateRules）
     - 验证签名（防 CDN tamper）
  3. 24h 后台 refresh，下次启动生效
```

## 不在本 ADR 范围

- CDN 选型 / 签名方案（依业务规划另开 ADR）
- 客户端缓存机制（localStorage 还是 IndexedDB）
- 灰度 / canary 协议
- 服务端管理后台 UI

## 风险

1. **schema 漂移**：服务端推 v2 rules 但客户端二进制是 v1
   - 缓解：NN-C3 `_migrateRules` 已加 throw 保护（fallback bundle 内置）
2. **CDN 故障**：拉取失败
   - 缓解：bundle 内置 fallback；2-3 次失败后退回 fallback 长期不再尝试
3. **签名验证开销**：每次启动 CPU 增加
   - 缓解：仅启动一次；缓存 24h
4. **A/B 测试 split**：同一用户应稳定走同 bucket
   - 缓解：bucket key = userId hash，CDN URL 含 bucket 路径

## 实施路线（NN-F2.x）

| 子任务 | 描述 | 估时 |
|---|---|---|
| F2.1 | 客户端 fetchRules + 24h cache | 2d |
| F2.2 | 签名验证（Ed25519 small） | 3d |
| F2.3 | A/B bucket 路由 | 2d |
| F2.4 | 服务端管理 + 灰度后台（独立项目） | 2-3w |
| F2.5 | mini-program / cocos 平台适配 | 1w |

总估时 ~5-6 周。当前 ROI 不足以立项，但若运营提出明确 A/B 需求即启动。

## Revisit Trigger

- 运营提出"想 A/B 测试 X 配置"3 次以上
- 多次 hotfix 仅改 game_rules.json（发版浪费严重）
- 引入实时大盘观测（动态调控）
