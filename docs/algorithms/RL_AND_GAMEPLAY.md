# 玩法与强化学习：解耦架构

## 单一数据源

| 内容 | 文件 | 说明 |
|------|------|------|
| 难度、得分、棋盘宽高、胜局分、RL 训练用策略 id、特征维度与归一化常数、**RL 奖励塑形** `rlRewardShaping`、**RL 与主局对齐的加分/染色** `rlBonusScoring` | `shared/game_rules.json` | 改玩法优先只改此处 |
| 多连块几何 | `shared/shapes.json` | 与 `web` / `rl_pytorch` / `rl_mlx` 共用 |

## 分层

1. **规则与数据**：上述 JSON。
2. **环境（对局动力学）**：`web/src/bot/simulator.js`、`miniprogram/core/bot/simulator.js`、`rl_pytorch/simulator.py`、`rl_mlx/simulator.py` 等实现落子、消除、得分、**每轮 dock 三色采样**；须与主游戏 `Grid` / `clearScoring` 逻辑一致。  
   - **得分**：消行前 `detectBonusLines` → `computeClearScore`，与主局公式相同。训练路径不用玩家当前皮肤，而用 `shared/game_rules.json` → **`rlBonusScoring`**：`canonicalSkinId`（默认 `titanium`，无 icon 时退化为**同色整线** bonus）或显式 **`blockIcons`**；网页/小程序由 `getRlTrainingBonusLineSkin()` 解析，PyTorch/MLX 仅在 JSON 提供非空 `blockIcons` 时启用 icon 判定（与网页不一致时可手动填入同序图标）。  
   - **dock 染色偏置**：仅依据盘面可见的近满线几何 + 上述同一套 icon/同色规则调用 `monoNearFullLineColorWeights`，**不是** adaptiveSpawn / spawnHints；观测 φ 亦不得含出块算法内部状态。  
   - **出块形状**：仍由 `block_spawn.generate_*` 与策略配置生成（训练侧不传网页自适应 hints）。
3. **观测编码（与策略网络绑定）**：`web/src/bot/features.js`、`rl_pytorch/features.py`；向量维度与语义由 `featureEncoding` 约束（v9.2 为 181 维 state：42 维标量含颜色摘要 + 棋盘占用 + dock 形状掩码）。**若改 stateDim/actionDim 或特征公式，旧 checkpoint 失效，需重训。**
4. **RL 训练入口（不直接碰棋盘）**：`web/src/bot/gameEnvironment.js` 的 `RlGameplayEnvironment`、`web/src/bot/trainer.js` 中的自博弈循环。

## 自适应出块（网页端）

网页端出块由 `adaptiveSpawn.js` 替代原有 `resolveLayeredStrategy`，综合玩家行为信号在 10 档策略权重 profile 间实时插值，并向 `blockSpawn.js` 传递 `spawnHints`（含 `clearGuarantee`、`sizePreference`、`diversityBoost`、`comboChain`、`multiClearBonus`、`multiLineTarget`、`rhythmPhase`、`sessionArc` 等）。无步可走局终还可经 `localStorage` 触发下一局短窗「局间热身」（`warmupRemaining` / `warmupClearBoost`）。RL 训练（Python 侧 `simulator.py`）不受此影响，仍使用固定策略。

完整设计文档见 **[`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md)**。

## 修改玩法时建议顺序

- 只调难度/分数字段：编辑 `shared/game_rules.json`（必要时同步检查 Python/JS 模拟器是否仍适用同一套 `scoring` 键名映射）。
- 改方块集合：编辑 `shared/shapes.json`，并确认各端 `shapes_data` / `shapes.js` 能加载（无需改 trainer）。
- 改观测或网络输入维度：改 `featureEncoding` + `features.js` / `features.py` + 模型与权重。

## PyTorch 与浏览器线性模型：收敛速度差异（简析）

| 因素 | 线性 `LinearAgent` | PyTorch `PolicyValueNet` / `SharedPolicyValueNet` |
|------|---------------------|---------------------------------------------------|
| 参数量 | ≈161（策略）+154（价值） | 默认约 **256 宽 × 残差块**（可调 `--width` / `--*-depth`） |
| 每局梯度步数 | `reinforceUpdate` 对轨迹**逐步**更新 | `train.py` 默认对**整局**一次 `backward`（等价 batch 更大、步长相对小） |
| 回报与价值 | 蒙特卡洛回报，无缩放 | `RL_RETURN_SCALE`（默认 **0.032**）+ GAE + `smooth_l1` 价值头 |
| 探索 | 温度 softmax | 温度衰减 + Dirichlet + 熵 bonus，利于探索但有效策略更新更「钝」 |
| 动作空间 | 同环境：每步大量合法放置 | 高方差策略梯度；**shared** 架构减轻重复编码 φ 的开销 |

**调参建议**：新训默认已改为 `--arch shared --width 256 --policy-depth 4`、`--lr 3e-4`、环境变量 `RL_RETURN_SCALE=0.032`；旧 checkpoint 若用 384/双塔，加载时仍以 **checkpoint 内 meta** 为准，勿混用结构。需要与旧版行为一致时可显式 `RL_WIDTH=384` `RL_ARCH=split` `RL_LR=1.5e-4`。
