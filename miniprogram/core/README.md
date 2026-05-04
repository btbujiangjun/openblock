# core/ — 小程序玩家端纯逻辑模块

小程序当前定位为玩家端轻量包，只包含核心游戏、皮肤和语言设置。模型训练、RL 无头模拟器、状态监控、后端同步和训练看板代码不进入小程序包。

## 保留模块

| 说明 | 路径 |
|------|------|
| 棋盘数据结构与基础消行 | `grid.js` |
| 方块形状与权重抽样 | `shapes.js` / `shapes.json` |
| 玩家端玩法策略 | `game_rules.json` / `gameRules.js` / `config.js` |
| 皮肤核心渲染字段 | `skins.js` |
| 同色 / 同 icon 消行加分 | `bonusScoring.js` |
| 本地语言设置 | `i18n.js` |

## 不进入小程序包

| 类型 | 说明 |
|------|------|
| 模型训练 | RL curriculum、self-play simulator、feature encoder、training environment |
| 状态监控 | 训练状态、模型状态、运营/算法看板 |
| 后端同步 | API base URL、会话同步、PyTorch RL 后端选择 |
| 关卡实验 | 关卡包、关卡目标与星级管理 |

## 皮肤同步

```bash
# 同步 web/src/skins.js 的核心皮肤字段到小程序
node scripts/sync-miniprogram-skins.cjs
```
