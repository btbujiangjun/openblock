# 玩法与强化学习（解耦说明）

## 单一数据源

| 内容 | 文件 | 说明 |
|------|------|------|
| 难度、得分、棋盘宽高、胜局分、RL 训练用策略 id、特征维度与归一化常数、**RL 奖励塑形** `rlRewardShaping` | `shared/game_rules.json` | 改玩法优先只改此处 |
| 多连块几何 | `shared/shapes.json` | 与 `web` / `rl_pytorch` / `rl_mlx` 共用 |

## 分层

1. **规则与数据**：上述 JSON。
2. **环境（对局动力学）**：`web/src/bot/simulator.js`、`rl_pytorch/simulator.py` 等实现落子、消除、得分；须与主游戏 `Grid` 逻辑一致。
3. **观测编码（与策略网络绑定）**：`web/src/bot/features.js`、`rl_pytorch/features.py`；向量维度与语义由 `featureEncoding` 约束（含棋盘栅格化占用与待选区形状掩码，见 JSON 内 `maxGridWidth` / `dockMaskSide` 等）。**若改 stateDim/actionDim 或特征公式，旧 checkpoint 失效，需重训。**
4. **RL 训练入口（不直接碰棋盘）**：`web/src/bot/gameEnvironment.js` 的 `RlGameplayEnvironment`、`web/src/bot/trainer.js` 中的自博弈循环。

## 修改玩法时建议顺序

- 只调难度/分数字段：编辑 `shared/game_rules.json`（必要时同步检查 Python/JS 模拟器是否仍适用同一套 `scoring` 键名映射）。
- 改方块集合：编辑 `shared/shapes.json`，并确认各端 `shapes_data` / `shapes.js` 能加载（无需改 trainer）。
- 改观测或网络输入维度：改 `featureEncoding` + `features.js` / `features.py` + 模型与权重。
