---
name: casual-game-build
description: >-
  Guides end-to-end casual game engineering using proven patterns: core loop first,
  rule-driven gameplay state machine, rendering separation, adaptive difficulty hooks,
  monetization adapters with feature flags, session/analytics schema, multi-platform
  sync, optional RL backend, and CI/testing gates. Use when building or scoping
  hyper-casual/puzzle/endless Web or mini-program games, retention/meta systems,
  hybrid IAA+IAP, or when the user asks for a production-ready casual game architecture
  from OpenBlock-style practices.
---

# 休闲游戏全栈构建（Casual Game Build）

## 权威正文

完整阶段说明、检查清单与 OpenBlock 路径映射见：

**`docs/engineering/CASUAL_GAME_BUILD_SKILL.md`**

开发本仓库时优先打开该文档；在新项目中可将同文件复制为项目内规范。

## 指令摘要（Agent 执行顺序）

1. **阶段 0**：锁定核心循环、终局、会话边界；拒绝 scope 膨胀。  
2. **阶段 1**：纯逻辑状态机 + **规则 JSON** + **回放最小集**；先测后 UI。  
3. **阶段 2**：渲染/输入与逻辑解耦；手感挂在明确事件上。  
4. **阶段 3**：难度旋钮文档化；自适应需公平性约束。  
5. **阶段 4**：进度与单局分数分层；每日/召回轻量优先。  
6. **阶段 5**：Monetization **事件总线 + Feature Flag + Provider 适配器**；服务端校验占位。  
7. **阶段 6**：黄金事件字典、会话归因、合规（同意/导出/删除）。  
8. **阶段 7**：多端共享规则契约；构建与环境变量分离 API。  
9. **阶段 8**（可选）：RL 与玩法共享 `game_rules`；推理降级路径。  
10. **阶段 9**：单测核心逻辑 + lint/build CI + 健康检查与备份 Runbook。

## 用户可复制提示

```
按 docs/engineering/CASUAL_GAME_BUILD_SKILL.md 阶段 0→9 拆解；
MVP 必须可离线完整游玩；商业化仅预留接口与开关。
```
