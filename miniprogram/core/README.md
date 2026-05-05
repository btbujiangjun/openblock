# core/ — 小程序玩家端纯逻辑模块

小程序当前定位为玩家端轻量包，只包含核心游戏、皮肤和语言设置。模型训练、RL 无头模拟器、状态监控、后端同步和训练看板代码不进入小程序包。

## 保留模块

| 说明 | 路径 |
|------|------|
| 棋盘数据结构与基础消行 | `grid.js` |
| 方块形状与权重抽样 | `shapes.js` / `shapesData.js` |
| 玩家端玩法策略 | `gameRulesData.js` / `gameRules.js` / `config.js` |
| 皮肤核心渲染字段 | `skins.js` |
| 同色 / 同 icon 消行加分 | `bonusScoring.js` |
| 本地语言设置 | `i18n.js` |

## 数据来源

小程序运行时不直接 `require` JSON 文件，避免微信开发工具在部分配置下把 JSON 解析为 `.json.js` 造成模块加载问题。

| 数据 | 小程序运行时模块 | 上游来源 |
|------|------------------|----------|
| 玩法规则 | `gameRulesData.js` | `shared/game_rules.json` 的玩家端裁剪版 |
| 方块形状 | `shapesData.js` | `shared/shapes.json` |

`core/game_rules.json`、`core/shapes.json` 和 `miniprogram/package.json` 不进入小程序包。

## 不进入小程序包

| 类型 | 说明 |
|------|------|
| 模型训练 | RL curriculum、self-play simulator、feature encoder、training environment |
| 状态监控 | 训练状态、模型状态、运营/算法看板 |
| 后端同步 | API base URL、会话同步、PyTorch RL 后端选择 |
| 关卡实验 | 关卡包、关卡目标与星级管理 |

## 小程序端体验差异

- 出块使用 `utils/spawnHeuristic.js` 的启发式三块生成与可玩性 guard，对齐 Web 端核心手感。
- 皮肤在 `skins.js` 中进行手机端二次优化：白色系盘面、方块对比度、主题水印和 emoji 图标可读性。
- 皮肤名由 `i18n.js` 提供 `zh-CN` / `en` 翻译，`getSkinListMeta()` 会按当前语言返回名称。
- 音效与触觉反馈在 `utils/audioFx.js`，主菜单与游戏页共享 `openblock_audiofx_v1` 偏好。

## 皮肤同步

```bash
# 同步 web/src/skins.js 的核心皮肤字段到小程序
node scripts/sync-miniprogram-skins.cjs
```
