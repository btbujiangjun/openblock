# 算法与模型手册（Algorithms & Models Handbook）

> 本手册是 OpenBlock 全部算法系统的**统一索引与导读**。  
> 设计原则：**索引尽量短** + **分册尽量深**。本文不重复分册内容；只给读者**一页纸读懂"项目里有哪些算法、它们在哪、怎么读"**。  
> 状态：✅ v1.2，与 v6 拓扑/Ability/Commercial 模型化和算法工程师写作规范同步

---

## 1. 谁应该读哪里

| 你的角色 | 必读 | 选读 | 跳过 |
|---------|-----|------|------|
| **算法工程师 · 新人** | 本手册 § 2~4 → [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md) → [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) / [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) | 商业化（除非负责） |
| **算法工程师 · 优化训练** | [`RL_README.md`](./RL_README.md) → [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) / [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md) | 历史实验记录 |
| **算法工程师 · 商业化/CRM** | [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md) § 8~9 + [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) + [`MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) | [`MONETIZATION_CUSTOMIZATION.md`](../operations/MONETIZATION_CUSTOMIZATION.md) | RL |
| **数据/分析** | [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) + [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) | KPI 章节于 [`MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) | RL 训练细节 |
| **游戏/玩法工程师** | [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md) + [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) + [`CLEAR_SCORING.md`](../product/CLEAR_SCORING.md) | [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) | RL/商业化 |
| **运营** | [`MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) | [`STRATEGY_GUIDE.md`](../engineering/STRATEGY_GUIDE.md) | 公式细节 |

---

## 2. 算法系统全景

OpenBlock 内部存在**五个有边界的算法子系统**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ┌──────────────────┐        ┌──────────────────┐                      │
│   │  A. 出块算法     │  →     │  C. 玩家画像     │ →  D. 商业化推断     │
│   │  Spawn          │        │  PlayerProfile   │    Monetization     │
│   │  规则 + ML       │        │  EMA / 心流 / …  │    鲸鱼分 / 规则    │
│   └────────┬─────────┘        └────────┬─────────┘    └──────┬───────┘ │
│            ↓                           ↓                     ↓         │
│            └──────── 共同输入 ─────────┘                     ↓         │
│                          ↓                                   ↓         │
│                ┌──────────────────────┐               UI / Trigger     │
│                │  B. 计分             │               (广告/IAP/任务)  │
│                │  ClearScoring c²     │                                │
│                └──────────────────────┘                                │
│                                                                         │
│            ┌────────────────────────────────────────┐                  │
│            │     E. RL 落子智能体（独立分支）        │                 │
│            │     PPO + DockBoardAttention           │                  │
│            │     用于 Bot 自博弈，不影响真人对局     │                  │
│            └────────────────────────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| 子系统 | 领域 | 算法类型 | 主文档 |
|--------|------|---------|--------|
| **A. 出块算法** | 候选三连块的生成 | 规则引擎 + 加权抽样 + 可选 SpawnTransformer | [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md) |
| **B. 计分** | 消行得分公式 | 二次方 + Bonus 线 | [`CLEAR_SCORING.md`](../product/CLEAR_SCORING.md) |
| **C. 玩家画像** | 实时玩家状态推断 | 5 维加权 + EMA + 历史融合 + 心流规则 | [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) |
| **D. 商业化推断** | 分群 / 策略推荐 / LTV | 线性加权 + 规则引擎 L1/L2/L3 | [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) |
| **E. RL 智能体** | Bot 自动落子 | PPO + GAE + 直接监督 + 可选 MCTS/Beam | [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) |

> ⚠️ **关键边界**：E（RL Bot）与 A/B/C/D（真人路径）**不直接耦合**。RL 用静态 strategy + 自博弈训练，落子选择在 `web/src/bot/`；真人对局走 `web/src/game.js` + `adaptiveSpawn.js`。
>
> 面向算法工程师的统一建模视角见 [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md)：该文按“问题定义 → 假设 → 特征 → 网络/规则结构 → 优化目标 → 应用机制”串联全部模型。

---

## 3. 算法 vs 数据：双源检查清单

许多 Bug 来自"代码改了但数据没改"。每次涉及算法相关变更，请按下表自检：

| 变量 | 唯一数据源 | 变更需要同步 |
|------|----------|-------------|
| 形状定义（28 个多连块） | `shared/shapes.json` | 浏览器 `shapes.js`、Python `simulator.py` |
| 状态特征维度 (181) / 动作维度 (12) / φ 维度 (193) | `shared/game_rules.json` `featureEncoding` | `features.js` + `features.py` 同步；checkpoint **失效**需重训 |
| 计分公式（`baseUnit · c²`） | `shared/game_rules.json` `scoring` | `clearScoring.js` + `simulator.py` `_clear_score_gain` |
| 自适应出块 10 档 profile | `shared/game_rules.json` `adaptiveSpawn` | 仅 `adaptiveSpawn.js` 读取 |
| AbilityVector 权重/分档/护栏 | `shared/game_rules.json` `playerAbilityModel` | `playerAbilityModel.js` + `adaptiveSpawn.js` 消费；回放 snapshot 字段同步 |
| RL 奖励权重 | `shared/game_rules.json` `rlRewardShaping` | `simulator.py` `step()`、`train.py` 读取 |
| 商业化模型权重/护栏 | `mon_model_config` 表 + `strategyConfig.js` `commercialModel` 默认 | `personalization.js` 拉取后注入；`strategyHelp.js` 登记 cursor:help |
| 心流/挫败阈值 | `shared/game_rules.json` `adaptiveSpawn.engagement` | `playerProfile.js` 读取 |

**强制约定**：项目已有"算法代码不直接写魔术数字"原则——所有数值都必须从 JSON / DB 读，否则会被 review 拒绝。

---

## 4. 核心数学符号约定

为避免分册间混淆，以下符号本手册统一使用：

| 符号 | 含义 | 取值 | 来源 |
|------|------|------|------|
| $s$ | 棋盘状态（特征向量，含颜色摘要） | $\mathbb{R}^{181}$ | `extract_state_features` |
| $\psi(a)$ | 动作特征 | $\mathbb{R}^{12}$ | `extract_action_features` |
| $\phi(s,a)$ | 状态-动作联合特征 | $\mathbb{R}^{193}$ = $[s; \psi(a)]$ | `build_phi_batch` |
| $h(s)$ | 网络 trunk 输出 | $\mathbb{R}^{128}$（width） | `_encode_state` |
| $\pi(a\mid s)$ | 策略分布 | softmax over legal actions | `policy_fuse` |
| $V(s)$ | 状态价值 | 标量 | `value_head` |
| $r_t$ | 单步奖励 | gain + ΔΦ + winBonus | `simulator.step` |
| $G_t$ | 蒙特卡洛回报 / GAE | $\sum \gamma^k r$ | `train.py` |
| $A_t$ | 优势函数 | $G_t - V(s_t)$ 或 GAE | `compute_gae` |
| $c$ | 单步消行行+列总数 | 0~6 | `grid.checkLines` |
| **PlayerProfile** ||||
| $r_t^{\text{skill}}$ | 即时技能 raw | $[0,1]$ | `_computeRawSkill` |
| $s_t^{\text{skill}}$ | EMA 平滑技能 | $[0,1]$ | `smoothSkill` |
| $\alpha$ | EMA 衰减 | 0.35 (前 5 步) → 0.15 | `adaptiveSpawn` 配置 |
| $F(t)$ | 心流偏差 | $[0, +\infty)$ | `flowDeviation` |
| **商业化** ||||
| $\text{whale\_score}$ | 鲸鱼分代理 | $[0,1]$ | `_compute_user_profile` |
| $\vec{w} = (w_0, w_1, w_2)$ | 鲸鱼分权重 | $(0.4, 0.3, 0.3)$ 默认 | `mon_model_config` |

---

## 5. 算法分册速查（One-Page Cheatsheet）

下表是**所有核心算法的一页摘要**，详见各分册：

### 5.1 RL 落子智能体（[`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)）

```
算法：    PPO（n_epochs > 1）/ REINFORCE-with-baseline（n_epochs = 1）
网络：    ConvSharedPolicyValueNet (width=128)
          - CNN(32) + 2×ResConv 编码 8×8 棋盘
          - DockBoardAttention：dock(3 槽) 对 grid 特征做交叉注意力
          - 三段拼合 → trunk(128) → policy / value / 多个辅助监督头
状态：    s ∈ ℝ¹⁸¹ (42 标量 + 64 grid + 75 dock)
动作：    每步合法落子 (block_idx, gx, gy)，长度可变
奖励：    r = ΔScore + 0.8 · ΔΦ(holes/transitions/wells/...) + winBonus(35)
          stuckPenalty = -8（终局未赢加在最后一步）
价值目标：V_target = (1 - mix) · GAE_return + mix · clip(score/threshold, 0, 2)
          mix = 0.5
探索：    softmax(logits/T) 与 Dirichlet(α=0.28, ε=0.08) 混合采样
推理：    POST /api/rl/select_action；侧栏可选 1-step lookahead → POST /api/rl/eval_values（默认关）
训练：    python -m rl_pytorch.train（Python 自博弈）
          或浏览器 → /api/rl/train_episode（在线 PPO；轨迹可含 q_teacher，见 RL_PYTORCH_SERVICE.md）
```

### 5.2 玩家画像 PlayerProfile（[`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md)）

```
技能即时分（raw）：
  r = 0.15·thinkScore + 0.30·clearScore + 0.20·comboScore
    + 0.20·missScore + 0.15·loadScore

技能平滑（EMA）：
  s_t = s_{t-1} + α(r_t - s_{t-1})
  α = 0.35 (前 5 步) | 0.15 (之后)

历史融合：
  histSkill = Σ 0.85^{n-1-i} · skill_i / Σ 0.85^{n-1-i}
  skillLevel = (1 - histW) · smooth + histW · histSkill
  histW = (1 - smoothW) · confidence

挫败感（连续未消行计数）：
  frustrationLevel = consecutive_no_clear_steps
  阈值：3 (warn) / 4 (iap_hint) / 5 (rescue)

近失（实时布尔）：
  hadRecentNearMiss = !lastMove.miss && !lastMove.cleared && fill > 0.6

心流：
  F(t) = | boardPressure / max(0.05, skill) - 1 |
  boardPressure = 0.45·avgFill + 0.35·clearDeficit + 0.2·cogLoad
  flowState ∈ {bored, flow, anxious}（规则树判定）

动量：
  Δ = clearRate(后半窗) - clearRate(前半窗)
  momentum = clamp(Δ / 0.3, -1, 1)
```

### 5.3 商业化推断（[`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md)）

```
鲸鱼分（线性加权代理变量）：
  whale_score = w₀·(min(1, best_score/2000))
              + w₁·(min(1, total_games/50))
              + w₂·(min(1, avg_session_sec/600))
  默认 w⃗ = (0.4, 0.3, 0.3)

分群（按 minWhaleScore 阈值降序匹配）：
  whale     if score ≥ 0.60
  dolphin   if score ∈ [0.30, 0.60)
  minnow    if score < 0.30

策略引擎四步：
  1. filter   按 segments + when() 过滤命中规则
  2. render   rule.explain(ctx) → why / effect 文案
  3. sort     active 优先，priority 降序
  4. whyLines 生成 5~7 条推理摘要

LTV 启发式（ltvPredictor.js）：
  P(pay) ≈ σ(α₀ + α₁·whale_score + α₂·activityScore - α₃·frustrationDays)
  E[LTV] = Σ ARPDAU_segment · retention(d) · P(stay)^d
```

### 5.4 出块算法（[`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md)）

```
轨道一：规则引擎（默认）
  Layer 0：从 28 个固定形状池按 shapeWeights 加权抽样
  Layer 1：可解性约束（DFS 检查三连块顺序可放）
  Layer 2：自适应 stress 调节
    stress = scoreStress + difficultyBias + skillAdjust + flowAdjust
           + recoveryAdjust + frustRelief + comboAdjust + ...
    profileBlend(stress) → 在 10 档 profile 间插值
  Layer 3：sessionArc 收尾衰减

轨道二：SpawnTransformer（可选）
  P(s₁, s₂, s₃ | board, profile) 条件分布建模
  推理失败回退轨道一
```

### 5.5 计分（[`CLEAR_SCORING.md`](../product/CLEAR_SCORING.md)）

```
基础分：     baseScore = baseUnit · c²
Bonus 线：   iconBonus = baseUnit · c · min(b, c) · (5 - 1)
总分：       clearScore = baseScore + iconBonus
其中：
  c    = 行+列消除数（0~6）
  b    = 同色 bonus 行/列数
  baseUnit = 20（默认 singleLine）
```

---

## 6. 文件入口索引（按子系统）

### A. 出块算法
- 主入口：`web/src/bot/blockSpawn.js` → `generateDockShapes()`
- 自适应：`web/src/adaptiveSpawn.js` → `resolveAdaptiveStrategy()`
- 难度：`web/src/difficulty.js` → `resolveLayeredStrategy()`
- 形状：`web/src/shapes.js` + `shared/shapes.json`
- ML 模型：`web/src/spawnTransformer/`（如启用）

### B. 计分
- `web/src/clearScoring.js` → `computeClearScore()`
- `web/src/grid.js` → `checkLines()`

### C. 玩家画像
- `web/src/playerProfile.js`（核心）
- `web/src/playerAbilityModel.js` → `buildPlayerAbilityVector()`
- `web/src/moveSequence.js` → `buildPlayerStateSnapshot()`
- 配置：`shared/game_rules.json` → `adaptiveSpawn` / `playerAbilityModel`

### D. 商业化推断
- 分群：`monetization_backend.py` → `_compute_user_profile()`
- 模型化决策：`web/src/monetization/commercialModel.js` → `buildCommercialModelVector()`
- 规则引擎：`web/src/monetization/strategy/strategyEngine.js`
- 配置：`web/src/monetization/strategy/strategyConfig.js` → `commercialModel`
- LTV：`web/src/monetization/ltvPredictor.js`

### E. RL 智能体
- 训练：`rl_pytorch/train.py` → `train_loop()` / `collect_episode()`
- 网络：`rl_pytorch/model.py` → `ConvSharedPolicyValueNet`
- 特征：`rl_pytorch/features.py` + `web/src/bot/features.js`
- 模拟器：`rl_pytorch/simulator.py` + `web/src/bot/simulator.js`
- HTTP 推理：`rl_backend.py` → `/api/rl/*`
- 浏览器自博弈：`web/src/bot/trainer.js`

---

## 7. 算法变更检查清单

每次提 PR 涉及算法变更，请按下表自检：

### 7.0 算法分册写作要求

面向算法工程师的分册必须回答“这个模型解决什么问题、为什么这样建模、如何训练/调参、线上如何生效”。新增或重写算法文档时，至少包含以下内容：

| 模块 | 必写内容 | 说明 |
|------|----------|------|
| 问题定义与假设 | 输入、输出、约束、不可用信息、冷启动假设 | 明确是否是 MDP、监督学习、规则评分、排序或生成问题 |
| 建模方法与优化目标 | 当前方法、候选方法、目标函数或代理指标 | 规则模型也要写清楚优化的是体验、收益、风险还是可解释性 |
| 特征与数据来源 | 特征字典、维度、归一化、唯一数据源 | 数值必须指向 JSON / DB / API，不允许只写代码常量 |
| 结构与实现 | 网络结构、规则树、打分公式、关键代码入口 | 深度模型写网络层级；规则模型写公式、阈值和执行顺序 |
| 损失函数与优化 | PPO/CE/MSE/Huber/蒸馏/阈值搜索/A-B 校准 | 当前未训练的规则模型要写“未来 ML baseline 的 loss 口径” |
| 方法优劣对比 | 当前方案 vs ML / RL / 搜索 / bandit 等 | 给出解释性、冷启动、延迟、数据需求、上线风险的权衡 |
| 作用机制与示例 | 线上调用链、输入样例、输出样例、失败回退 | 必须说明谁消费模型输出，以及护栏如何兜底 |
| 评估与上线 | 离线指标、在线指标、灰度、checkpoint/配置兼容 | 破坏字段或维度时必须说明重训和迁移计划 |

### 7.1 通用
- [ ] 改了魔术数字 → 是否已挪到 JSON？
- [ ] 改了公式 → 是否同步更新分册文档？
- [ ] 改了维度 → 是否同步前端 + 后端？checkpoint 是否需重训？
- [ ] 加了新字段 → 是否登记到 cursor:help（如商业化字段）？

### 7.2 RL 专用
- [ ] 改了状态/动作维度 → `featureEncoding` 同步？
- [ ] 改了奖励形式 → `rlRewardShaping` JSON 同步？
- [ ] 改了网络结构 → 旧 checkpoint 弃用计划？
- [ ] 改了超参 → 是否在 `RL_*` 环境变量中暴露？

### 7.3 玩家画像专用
- [ ] 改了 EMA 系数 → 测试是否仍能在合理时间收敛？
- [ ] 改了心流阈值 → 是否影响出块策略 stress？
- [ ] 加了新字段 → snapshot 是否同步？

### 7.4 商业化专用
- [ ] 改了鲸鱼分公式 → 测试集分群分布是否漂移？
- [ ] 改了规则 → A/B 实验对照组准备？
- [ ] 改了 LTV 公式 → 与 BI 报表口径核对？

---

## 8. 算法演进路线

| 版本 | 时间 | RL 主要变化 | 玩家画像 | 商业化 |
|------|-----|-----------|---------|-------|
| v1 | 早期 | 浏览器线性 REINFORCE + ε-greedy | 基础 EMA | 单一 ARPU |
| v2 | — | PyTorch 残差 MLP | + 历史会话融合 | + 三分群 |
| v3 | 当前 | 当前路线 | 当前 | **L1/L2/L3 分层引擎** |
| v4 | 历史 | 4 维 ψ → 7 维 → 12 维 | — | — |
| v5 | 当前 | **ConvShared + DockBoardAttention + 三辅助监督头 + outcome/GAE 混合价值** | — | — |
| v6 | 当前 | 拓扑辅助监督 / fillable-aware 指标 | **AbilityVector 统一能力输出** | **CommercialModelVector 模型化动作门控** |
| v7/v8 (实验) | 路线图 | + Q 蒸馏 / 2-ply Beam / 评估门控 | — | — |

详见各分册末尾的"演进与开放问题"。

---

## 9. 算法术语表（与外界对照）

| 本项目术语 | 学术标准 | 备注 |
|-----------|---------|------|
| 鲸鱼分 (whale_score) | proxy variable / behavioral score | 不是 ML 预测，是规则代理 |
| AbilityVector | interpretable player embedding | 玩家能力与风险的统一可解释向量 |
| CommercialModelVector | multi-objective action scoring | IAP/广告/流失/疲劳的模型化门控输出 |
| 心流偏差 (flowDeviation) | challenge-skill mismatch | 基于 Csíkszentmihályi 心流理论 |
| 近失 (near miss) | gambling 行为经济学概念 | 转化率提升源 |
| stress（出块压力） | DDA difficulty signal | 综合多源信号的标量 |
| 课程 (curriculum) | curriculum learning | RL 训练用的胜利门槛递增 |
| dock | tray / block reservoir | 候选块槽（3 个） |
| φ (phi) | state-action embedding | RL 网络输入拼接 |
| Dirichlet 探索 | AlphaZero-style noise | 替代 ε-greedy |

---

## 10. 关联文档矩阵

| 算法分册 | 关联实现文档 | 关联运营文档 |
|---------|------------|------------|
| [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md) | 全部模型的问题定义、假设、特征、结构、目标与应用机制总览 | — |
| [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | [`RL_README.md`](./RL_README.md) / [`RL_AND_GAMEPLAY.md`](./RL_AND_GAMEPLAY.md) / [`RL_PYTORCH_SERVICE.md`](./RL_PYTORCH_SERVICE.md) / [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) / [`RL_TRAINING_DASHBOARD_FLOW.md`](./RL_TRAINING_DASHBOARD_FLOW.md) / [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md) | [`RL_ANALYSIS.md`](./RL_ANALYSIS.md) / [`RL_TRAINING_OPTIMIZATION.md`](./RL_TRAINING_OPTIMIZATION.md) / [`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md) / [`RL_BROWSER_OPTIMIZATION.md`](./RL_BROWSER_OPTIMIZATION.md) |
| [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) | [`PLAYER_ABILITY_EVALUATION.md`](../player/PLAYER_ABILITY_EVALUATION.md) / [`PANEL_PARAMETERS.md`](../player/PANEL_PARAMETERS.md) / [`REALTIME_STRATEGY.md`](../player/REALTIME_STRATEGY.md) / [`PLAYSTYLE_DETECTION.md`](../player/PLAYSTYLE_DETECTION.md) | — |
| [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) | [`MONETIZATION.md`](../operations/MONETIZATION.md) / [`MONETIZATION_CUSTOMIZATION.md`](../operations/MONETIZATION_CUSTOMIZATION.md) | [`MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) / [`COMMERCIAL_OPERATIONS.md`](../operations/COMMERCIAL_OPERATIONS.md) |
| [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md) | [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) / [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) / [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) | [`DIFFICULTY_MODES.md`](../product/DIFFICULTY_MODES.md) |
| [`CLEAR_SCORING.md`](../product/CLEAR_SCORING.md) | — | — |

---

## 11. 反馈与贡献

发现错误 / 想加一节 / 公式与代码不一致：

1. 在仓库提 issue 标 `algo-doc`
2. 修改后必须同步更新本手册「§ 5 速查」对应行
3. 算法变更必须 PR 中附 *before/after 对比指标*（DAU 分布 / 收敛曲线 / 转化率等）

> **核心原则**：算法文档与代码同步。**代码可以无 review 改成"实验"，但实验稳定后必须回写文档**——这是文档化的契约。

---

> 最后更新：2026-05-04 · v1.2 · 增加算法工程师分册写作要求与模型契约清单
> 维护：算法工程团队
