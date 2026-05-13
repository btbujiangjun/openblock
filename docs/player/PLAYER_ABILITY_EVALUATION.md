# 玩家能力评估：产品与接入说明

> 当前状态：本文只保留产品语义、消费方和接入边界。
> 公式、特征、参数、优化目标和建模方法的权威说明见 [`ALGORITHMS_PLAYER_MODEL.md`](../algorithms/ALGORITHMS_PLAYER_MODEL.md)；跨模型契约见 [`MODEL_ENGINEERING_GUIDE.md`](../algorithms/MODEL_ENGINEERING_GUIDE.md)。

---

## 1. 当前能力输出

玩家能力系统由两层组成：

| 层 | 代码入口 | 职责 |
|----|----------|------|
| `PlayerProfile` | `web/src/playerProfile.js` | 维护实时技能、心流、挫败、近失、动量、风格和置信度 |
| `AbilityVector` | `web/src/playerAbilityModel.js` | 将画像、拓扑和局内统计聚合为统一能力向量 |

`AbilityVector` 当前输出（v2，2026-05）：

| 字段 | 产品语义 | 主要消费方 | v2 增量 |
|------|----------|------------|---------|
| `skillScore` | 综合能力 | `adaptiveSpawn`、玩家洞察面板 | — |
| `controlScore` | 操作稳定性 | 玩家洞察面板 | 接入「反应」(`pickToPlaceMs`)，反应快/稳更高分 |
| `clearEfficiency` | 消行效率 | 玩家洞察面板、离线样本 | 接入多消深度 + 清屏稀缺事件，会做大消除的玩家显著拉开 |
| `boardPlanning` | 盘面规划 | 玩家洞察面板、离线样本 | — |
| `riskTolerance` | 风险偏好 | 个性化与后续分析 | — |
| `riskLevel` | 短期死局风险 | `adaptiveSpawn` 减压门控 | 接入填充加速度 + dock 锁死概率（区分"静态满"vs"急速满"、"还能落子"vs"全锁死"） |
| `confidence` | 当前判断可信度 | 所有消费者的门控 | 接入近期活跃度衰减（exp(-days/14)），长草玩家自动衰减 |

> v2 同时引入"各能力指标使用独立时间窗口"（控制 8 步 / 消行 16 步 / 规划瞬时）与"6 维 hover 雷达图"。详见 [`ALGORITHMS_PLAYER_MODEL.md §13.7`](../algorithms/ALGORITHMS_PLAYER_MODEL.md)。

---

## 2. 作用机制

```text
玩家落子 / miss / clear
  ↓
PlayerProfile.recordPlace / recordMiss
  ↓
skillLevel / flowState / frustration / playstyle
  ↓
buildPlayerAbilityVector(profile, ctx)
  ↓
adaptiveSpawn stress 修正 + playerInsightPanel 展示 + moveSequence 回放快照
```

关键原则：

- 能力模型只影响难度和解释，不直接替玩家决策。
- 低 `confidence` 时，`AbilityVector` 对出块压力的影响会被弱化。
- `riskLevel` 高时优先降低出块压力，避免高风险局面继续加压。
- 回放中的 `ps.ability` 用于离线训练样本，不作为人工真值。

---

## 3. 配置与调参入口

| 调参对象 | 权威配置 |
|----------|----------|
| EMA 窗口、心流、挫败、恢复 | `shared/game_rules.json → adaptiveSpawn` |
| AbilityVector 权重、分档、baseline 融合 | `shared/game_rules.json → playerAbilityModel` |
| 面板展示文案 | `web/src/playerInsightPanel.js` |
| 回放训练样本导出 | `web/src/database.js → getAbilityTrainingDataset()` |

详细参数表见 [`ALGORITHMS_PLAYER_MODEL.md`](../algorithms/ALGORITHMS_PLAYER_MODEL.md) §15。

---

## 4. 验证方式

| 验证目标 | 测试/检查 |
|----------|-----------|
| PlayerProfile 实时指标稳定 | `npm test -- tests/playerProfile.test.js` |
| AbilityVector 有界、风险随高填充上升 | `npm test -- tests/playerAbilityModel.test.js` |
| 出块消费能力向量不破坏可解性 | `npm test -- tests/adaptiveSpawn.test.js tests/blockSpawn.test.js` |
| 面板无空字段 | 手动打开玩家洞察面板，观察能力卡和解释行 |

---

## 5. 关联文档

| 文档 | 定位 |
|------|------|
| [`ALGORITHMS_PLAYER_MODEL.md`](../algorithms/ALGORITHMS_PLAYER_MODEL.md) | 算法工程师权威手册 |
| [`MODEL_ENGINEERING_GUIDE.md`](../algorithms/MODEL_ENGINEERING_GUIDE.md) | 跨模型契约和训练/上线检查 |
| [`PANEL_PARAMETERS.md`](./PANEL_PARAMETERS.md) | UI 指标解释 |
| [`REALTIME_STRATEGY.md`](./REALTIME_STRATEGY.md) | PlayerProfile → AdaptiveSpawn 实时链路 |
| [`PLAYSTYLE_DETECTION.md`](./PLAYSTYLE_DETECTION.md) | 玩法风格分类 |
