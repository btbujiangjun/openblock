# Pull Request

## 变更描述
<!-- 清晰描述这个 PR 做了什么 -->

## 关联 Issue
<!-- 使用 "Closes #N" 自动关闭 Issue -->
Closes #

## 变更类型

- [ ] Bug 修复（`fix:`）
- [ ] 新功能（`feat:`）
- [ ] 重构（`refactor:`）
- [ ] 文档更新（`docs:`）
- [ ] 性能优化（`perf:`）
- [ ] 测试（`test:`）
- [ ] 构建/工具（`chore:`）

## 测试说明

- [ ] 已运行 `npm test` 通过
- [ ] 已运行 `npm run lint` 通过
- [ ] 手动测试了相关功能
- [ ] 新增/更新了测试用例

**测试步骤**：
1. 
2. 

## 对其他模块的影响

<!-- 这个 PR 是否影响以下模块？（若有影响请说明） -->
- [ ] 游戏核心逻辑（grid.js/game.js）
- [ ] 出块引擎（adaptiveSpawn.js）
- [ ] 商业化层（monetization/*）
- [ ] 后端 API（server.py）
- [ ] RL 训练（rl_pytorch/*）
- [ ] 数据库 Schema（需要迁移说明）

## 文档更新

- [ ] 已更新相关文档（docs/）
- [ ] 已更新 JSDoc 注释
- [ ] 无需文档更新

## Breaking Changes

- [ ] 无 Breaking Change
- [ ] 有 Breaking Change（请描述迁移路径）：

## 截图（如有 UI 变更）

## Checklist

- [ ] 代码遵循项目规范（见 CONTRIBUTING.md）
- [ ] commit message 遵循 Conventional Commits
- [ ] 所有新的公开 API 有 JSDoc 注释
- [ ] 配置参数写入 `game_rules.json` / `.env`，不硬编码
