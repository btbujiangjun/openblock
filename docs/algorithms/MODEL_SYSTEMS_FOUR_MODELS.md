# 四模型系统设计：启发式出块、生成式出块、PyTorch RL 与浏览器 RL

> **定位**：面向算法工程师、玩法工程师和测试角色的系统设计文档。  
> **范围**：梳理 OpenBlock 当前四类核心模型：启发式出块算法、生成式出块模型、PyTorch RL 落子模型、浏览器 RL 模型。  
> **写作口径**：参考程序化内容生成（PCG）、Transformer、PPO/GAE、REINFORCE、LoRA 等学术路线，但以本仓库代码事实为准。  
> **维护要求**：改 `shared/game_rules.json`、`web/src/bot/features.js`、`rl_pytorch/features.py`、`rl_pytorch/model.py`、`rl_pytorch/spawn_model/*`、`web/src/adaptiveSpawn.js`、`web/src/bot/blockSpawn.js` 时同步核对本文。

---

## 1. 总览

OpenBlock 的“模型”不是单一神经网络，而是四条职责边界明确的决策链路：

| 模型 | 解决的问题 | 算法类型 | 线上职责 | 是否学习参数 |
|------|------------|----------|----------|--------------|
| 启发式出块算法 | 下一轮给玩家哪 3 个候选块 | 多信号规则模型 + 加权抽样 + 硬约束拒绝采样 | 真人默认出块路径 | 否 |
| 生成式出块模型 | 从历史样本学习三连块条件分布 | Transformer 自回归生成 + 多任务监督 + LoRA 个性化 | 可选 `model-v3` 出块路径，失败回退规则轨 | 是 |
| PyTorch RL 算法模型 | 给定棋盘和候选块，选择怎么落子 | PPO / GAE / 策略价值网络 / 辅助监督 / 搜索蒸馏 | Bot 推理、服务端训练、评估 | 是 |
| 浏览器 RL 模型 | 浏览器内轻量自博弈与演示训练 | 线性 softmax policy + value baseline + REINFORCE | 训练面板、本地演示、远端 RL 客户端 | 是 |

关键边界：

- 出块模型回答 **“给什么块”**；RL 模型回答 **“已有这些块时怎么放”**。
- 真人主链路默认走 `game.js → adaptiveSpawn.js → blockSpawn.js`；RL 不直接改真人出块。
- 生成式出块只替代“候选块来源”，不替代 `validateSpawnTriplet`、序贯可解、机动性和规则回退。
- RL 特征只读当前可见棋盘和 dock，不读 `spawnHints`、adaptive 内部权重或未来块。

---

## 2. 学术与工程参考

| 方向 | 参考 | 本项目采用方式 |
|------|------|----------------|
| 程序化内容生成（PCG） | Togelius et al. 的搜索式 PCG、Smith & Mateas 的约束式内容生成思想 | 启发式出块用“软目标 + 硬约束”，不是纯随机表 |
| 心流与自适应难度 | Csikszentmihalyi 心流理论、Yerkes-Dodson 唤醒曲线 | `stress`、`flowState`、`orderRigor` 与救济/加压分离 |
| REINFORCE | Williams, 1992, policy gradient | 浏览器 `LinearAgent` 本地训练 |
| PPO | Schulman et al., 2017, [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347) | PyTorch RL 批量更新与在线攒批路径 |
| GAE | Schulman et al., 2015, Generalized Advantage Estimation | PyTorch 离线训练降低价值估计方差 |
| Transformer | Vaswani et al., 2017, [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | SpawnTransformerV3.1 的条件序列编码与自回归头 |
| LoRA | Hu et al., 2021, [Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) | 个性化出块只训练小规模 LoRA 模块 |
| AlphaGo | Silver et al., 2016, [Mastering the game of Go with deep neural networks and tree search](https://www.nature.com/articles/nature16961) | 策略网络、价值网络与树搜索结合，启发 RL 的 policy-value-search 分工 |
| AlphaGo Zero | Silver et al., 2017, [Mastering the game of Go without human knowledge](https://www.nature.com/articles/nature24270) | 无人类棋谱、自博弈、MCTS 改进策略与策略价值网络闭环 |
| AlphaZero | Silver et al., 2018, [A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play](https://www.science.org/doi/10.1126/science.aar6404) | 通用规则驱动自博弈范式；本项目借鉴搜索 teacher、策略蒸馏与评估门禁 |
| MuZero | Schrittwieser et al., 2020, [Mastering Atari, Go, chess and shogi by planning with a learned model](https://www.nature.com/articles/s41586-020-03051-4) | 学习模型 + 规划搜索，启发“规则模型之外的价值/奖励/策略预测” |

工程取舍：

- 真人人机体验需要低延迟、可解释、可兜底，因此启发式出块仍是默认路径。
- 神经模型承担“分布拟合”和“策略学习”，但不能绕过玩法不变量。
- 所有模型的特征维度、奖励与规则优先从 `shared/game_rules.json` 或共享 shape/rule 文件读取。

### 2.1 游戏自博弈参考谱系

| 类别 | 代表论文 | 核心思想 | 对 OpenBlock 的启发 |
|------|----------|----------|---------------------|
| 早期神经自博弈 | Tesauro, 1995, [Temporal Difference Learning and TD-Gammon](https://bkgm.com/articles/tesauro/tdl.html) | 神经网络通过和自己对弈，用 TD 学习局面价值 | 证明无专家数据也可从自博弈中学到强策略；对应本项目离线自博弈采样 |
| 人类监督 + 自博弈 + 搜索 | Silver et al., 2016, [AlphaGo](https://www.nature.com/articles/nature16961) | 先用专家棋谱训练 policy，再用 RL 自博弈和 value network，推理时结合 MCTS | 对应 `policy/value/search` 分工；本项目不依赖专家落子库，但借鉴价值头和搜索 teacher |
| 纯规则自博弈 | Silver et al., 2017, [AlphaGo Zero](https://www.nature.com/articles/nature24270) | 从随机策略开始，只用规则、自博弈、MCTS 访问分布和终局结果训练 policy-value 网络 | 对应 `qTeacher / visit_pi` 的未来升级方向：搜索产生更强策略，再蒸馏给网络 |
| 通用自博弈算法 | Silver et al., 2018, [AlphaZero](https://www.science.org/doi/10.1126/science.aar6404) | 同一套自博弈 + MCTS + policy-value network 泛化到围棋、国际象棋、日本将棋 | 启发固定 seed 评估门禁、checkpoint 晋级和规则驱动训练 |
| 专家迭代 | Anthony, Tian & Barber, 2017, [Thinking Fast and Slow with Deep Learning and Tree Search](https://arxiv.org/abs/1705.08439) | 慢速树搜索作为 expert，快速神经网络学习 expert，再反过来指导搜索 | 对应本项目 beam/MCTS/lookahead teacher 与策略头蒸馏 |
| 学习模型规划 | Schrittwieser et al., 2020, [MuZero](https://www.nature.com/articles/s41586-020-03051-4) | 不显式知道环境动态，学习 reward、value、policy 的隐空间模型并规划 | 启发未来把 `board_quality / survival / topology` 预测用于轻量规划 |
| 不完美信息自博弈 | Heinrich & Silver, 2016, [Deep Reinforcement Learning from Self-Play in Imperfect-Information Games](https://arxiv.org/abs/1603.01121) | NFSP 结合 best response 与 average strategy，逼近纳什均衡 | 虽然 OpenBlock 是单人游戏，但可借鉴“平均策略池”来避免训练策略单一化 |
| 多智能体联赛自博弈 | Vinyals et al., 2019, [AlphaStar](https://www.nature.com/articles/s41586-019-1724-z) | 多智能体联赛、模仿学习、自博弈和对抗策略池 | 启发维护多 checkpoint / 多风格 bot，评估规则是否只适配单一策略 |
| 大规模团队游戏自博弈 | OpenAI et al., 2019, [Dota 2 with Large Scale Deep Reinforcement Learning](https://arxiv.org/abs/1912.06680) | 通过大规模分布式自博弈训练长时序、多角色协作策略 | 启发长 episode 稳定训练、版本迁移和训练中断恢复机制 |
| 游戏 RL 框架 | Lanctot et al., 2019/2020, [OpenSpiel](https://arxiv.org/abs/1908.09453) | 提供多类游戏、搜索、RL、评估与学习动态分析框架 | 启发把 OpenBlock 的固定 seed、指标门禁、策略对照做成可复现实验协议 |

这些论文提供的是方法谱系，不意味着项目应完整复刻 AlphaZero 或 MuZero。OpenBlock 是单人休闲消除游戏，目标包含高分、续航、盘面健康、爽感和可解释性，因此当前更适合采用 **PPO/GAE 主训练 + 搜索 teacher 蒸馏 + 多辅助头 + 固定评估门禁** 的工程路线。

---

## 3. 统一符号与共享数据

| 符号 / 字段 | 含义 | 当前维度 / 范围 | 权威来源 |
|-------------|------|-----------------|----------|
| `board` | 8×8 棋盘占用 | 64 | `grid.js` / `simulator.py` |
| `dock` | 当前 3 个候选块 | 3 slots | `game.js` / `OpenBlockSimulator` |
| `s` | RL 状态特征 | 181 | `shared/game_rules.json.featureEncoding` |
| `ψ(a)` | RL 动作特征 | 15 | `features.js` / `features.py` |
| `φ(s,a)` | RL 状态-动作拼接 | 196 | `features.js` / `features.py` |
| `behaviorContext` | Spawn V3.1 行为上下文 | 56 | `spawnModel.js` / `spawn_model/dataset.py` |
| `shape id` | 出块形状词表 | 28 | `shared/shapes.json` / `SHAPE_VOCAB` |
| `spawnHints` | 规则出块软目标 | object | `adaptiveSpawn.js` |
| `spawnTargets` | stress 投影后的多轴目标 | 6 轴 | `adaptiveSpawn.js` |

当前 RL 特征维度说明：

```text
state = 42 维标量（含颜色摘要） + 64 棋盘占用 + 75 dock 形状 = 181
action = 15 维（block、位置、尺寸、清行、风险、多消、同 icon、清屏等）
phi = state + action = 196
```

### 3.1 完整特征字段字典

#### RL 状态特征 `s[181]`

`s` 是 PyTorch RL 与浏览器 RL 共享的状态向量，权威实现为 `web/src/bot/features.js::extractStateFeatures` 与 `rl_pytorch/features.py`。

| 区间 / 下标 | 字段 | 归一化 | 物理含义 |
|-------------|------|--------|----------|
| 0 | `fillRatio` | `filled / 64` | 棋盘占用率，越高越接近死局 |
| 1 | `maxRowFill` | `[0,1]` | 最满行的填充比例，代表横向消行机会或拥塞 |
| 2 | `minRowFill` | `[0,1]` | 最空行的填充比例，代表空间分布是否极端 |
| 3 | `maxColFill` | `[0,1]` | 最满列的填充比例，代表纵向消行机会或堆高 |
| 4 | `minColFill` | `[0,1]` | 最空列的填充比例，衡量列间不均衡 |
| 5 | `almostFullRows` | `/ 8` | 接近满行数量，是清行和多消机会信号 |
| 6 | `almostFullCols` | `/ 8` | 接近满列数量，是竖向清行机会信号 |
| 7 | `unplacedDockRatio` | `/ 3` | 当前 dock 剩余未放块比例，影响一轮内规划压力 |
| 8 | `avgRowFill` | `[0,1]` | 行平均填充率，等价于全局密度的行视角 |
| 9 | `avgColFill` | `[0,1]` | 列平均填充率，等价于全局密度的列视角 |
| 10 | `rowFillStd` | 标准差 | 行填充分布离散度，越高说明横向结构不平 |
| 11 | `colFillStd` | 标准差 | 列填充分布离散度，越高说明纵向结构不平 |
| 12 | `rowFillRange` | `max-min` | 行填充峰谷差，代表局面是否偏向某些行拥堵 |
| 13 | `colFillRange` | `max-min` | 列填充峰谷差，代表局面是否偏向某些列拥堵 |
| 14 | `nearFullLineRatio` | `/ 16` | 近满行列合计比例，代表即时清行窗口密度 |
| 15 | `unfillableHoles` | `/ maxHoles` | 所有当前形状难以填入的空洞压力 |
| 16 | `rowTransitions` | `/ maxTransitions` | 行方向占空切换次数，代表破碎度 |
| 17 | `colTransitions` | `/ maxTransitions` | 列方向占空切换次数，代表纵向破碎度 |
| 18 | `wellDepth` | `/ maxWellDepth` | 被左右夹住的井状空格，代表未来卡死风险 |
| 19 | `close1` | `/ 8` | 差 1 格可消的行列数量，强即时机会 |
| 20 | `close2` | `/ 8` | 差 2 格可消的行列数量，中期 setup 机会 |
| 21 | `dockMobility` | `/ maxMobility` | 当前 dock 总合法落点数，代表操作自由度 |
| 22 | `heightStd` | 标准差 | 列高度离散度，代表表面平整度 |
| 23–30 | `colorOccupancy[0..7]` | `/ 64` | 每种颜色 / icon 在棋盘上的占比，用于 bonus 语义 |
| 31–38 | `monoPotential[0..7]` | `/ 8` | 每种颜色可形成同色/同 icon 线的最佳已有长度 |
| 39–41 | `dockColor[0..2]` | `/ 7` | 三个 dock 槽的颜色索引，帮助 RL 识别同 icon bonus 机会 |
| 42–105 | `gridOccupancy[8×8]` | `0/1` | 棋盘空间占用图，CNN / 线性策略都能读到的几何主体 |
| 106–180 | `dockMask[3×5×5]` | `0/1` | 每个候选块居中放入 5×5 mask 后的形状空间编码 |

#### RL 动作特征 `ψ(a)[15]`

`ψ(a)` 描述“如果选择某块并放在某坐标，会发生什么”。它与 `s` 拼接成 `φ(s,a)`。

| 下标 | 字段 | 归一化 | 物理含义 |
|------|------|--------|----------|
| 0 | `blockIdx` | `/ maxBlockIndex` | 选择第几个 dock 块 |
| 1 | `gx` | `/ gridSize` | 放置左上角 x 坐标 |
| 2 | `gy` | `/ gridSize` | 放置左上角 y 坐标 |
| 3 | `shapeWidth` | `/ shapeSpan` | 形状宽度，影响横向占用与消行覆盖 |
| 4 | `shapeHeight` | `/ shapeSpan` | 形状高度，影响纵向占用与堆高风险 |
| 5 | `cellCount` | `/ maxCells` | 形状格子数，代表占用压力 |
| 6 | `wouldClear` | `/ maxClearsHint` | 放置后可消除的行列数 |
| 7 | `nearFullHitRatio` | `[0,1]` | 该形状格子是否落在近满行/列上 |
| 8 | `blocksRemainAfter` | `/ 3` | 放完该块后本轮还剩几个候选块 |
| 9 | `adjacencyRatio` | `/ maxAdjacent` | 新块与已有块的边相邻程度，代表贴合度 |
| 10 | `heightAfter` | `/ gridSize` | 放置后形状底部高度，代表堆高风险 |
| 11 | `holesRiskAfter` | `/ maxHoles` | 放置并消行后不可填空洞风险 |
| 12 | `multiClear` | `/ (maxClearsHint-1)` | 多消强度，单消为 0，多行消除越高越大 |
| 13 | `bonusLine` | `/ maxClearsHint` | 同 icon / 同色 bonus 行列数 |
| 14 | `perfectClear` | `0/1` | 此动作消行后是否清空棋盘 |

#### Spawn V3.1 行为上下文 `behaviorContext[56]`

| 区间 / 下标 | 字段 | 物理含义 |
|-------------|------|----------|
| 0 | `scoreNorm` | 本局得分相对 500 的粗归一化，代表局内进展 |
| 1 | `fillRatio` | 当前棋盘填充率 |
| 2 | `skillLevel` | 玩家综合技能估计 |
| 3 | `momentum` | 最近表现动量，正值表示状态变好 |
| 4 | `frustrationLevel` | 挫败计数或连续未消行压力 |
| 5 | `cognitiveLoad` | 操作和局面复杂度造成的认知负荷 |
| 6 | `engagementAPM` | 操作活跃度，反映投入程度 |
| 7 | `flowDeviation` | 当前挑战与能力的偏离度 |
| 8 | `needsRecovery` | 是否处于恢复/救援态 |
| 9 | `hadRecentNearMiss` | 是否刚出现“差一点”近失体验 |
| 10 | `isNewPlayer` | 新手 / 冷启动保护信号 |
| 11 | `recentComboStreak` | 近期连击强度 |
| 12 | `clearRate` | 近期消行率 |
| 13 | `missRate` | 近期失误率 |
| 14 | `comboRate` | 近期连消 / 多消倾向 |
| 15 | `thinkMs` | 平均思考时间，过高可能代表焦虑或离开 |
| 16 | `afkCount` | AFK 次数，召回/重参与信号 |
| 17 | `historicalSkill` | 历史长期技能 |
| 18 | `trend` | 长期趋势，正值代表变强 |
| 19 | `confidence` | 画像置信度 |
| 20 | `adaptiveStress` | 自适应策略计算出的当前压力 |
| 21 | `flowState` | bored / flow / anxious 的数值编码 |
| 22 | `pacingPhase` | tension / release 等 session 张弛 |
| 23 | `sessionPhase` | warmup / peak / cooldown |
| 24 | `coldStart` | 样本不足时为 1 |
| 25 | `activeSamples` | 有效行为样本量 |
| 26 | `boardDifficulty` | 填充率 + 空洞折算后的盘面难度事实 |
| 27 | `holes` | 空洞数量 |
| 28 | `nearFullLines` | 近满行列数 |
| 29 | `close1` | 差 1 格可消的行列 |
| 30 | `close2` | 差 2 格可消的行列 |
| 31 | `solutionCount` | 当前或快照估算的解法数量 |
| 32 | `ability.skillScore` | AbilityVector 综合能力 |
| 33 | `ability.controlScore` | 操作稳定性 |
| 34 | `ability.clearEfficiency` | 消行效率 |
| 35 | `ability.boardPlanning` | 盘面规划能力 |
| 36 | `ability.riskTolerance` | 风险承受 / 偏好 |
| 37 | `ability.riskLevel` | 短期死局或卡住风险 |
| 38 | `target.shapeComplexity` | 目标形状复杂度 |
| 39 | `target.solutionSpacePressure` | 目标解空间压力 |
| 40 | `target.clearOpportunity` | 目标清行机会强度 |
| 41 | `target.spatialPressure` | 目标空间占用压力 |
| 42 | `target.payoffIntensity` | 目标多消/清屏爽感强度 |
| 43 | `target.novelty` | 目标新鲜度 |
| 44 | `hint.clearGuarantee` | 目标保消槽位数 |
| 45 | `hint.sizePreference` | 偏小/偏大块倾向 |
| 46 | `hint.multiClearBonus` | 多消偏好强度 |
| 47 | `hint.orderRigor` | 顺序刚性高难度强度 |
| 48–53 | `spawnIntent one-hot` | relief / engage / harvest / pressure / flow / maintain |
| 54 | `hint.multiLineTarget` | 多线兑现目标 |
| 55 | `sessionArc` | warmup / peak / cooldown 的出块弧线 |

#### 启发式出块策略字段

| 字段 | 类型 | 物理含义 |
|------|------|----------|
| `shapeWeights` | category → weight | 各形状族基础抽样权重，stress 插值得到 |
| `clearGuarantee` | 0–3 | 本轮期望至少多少槽能参与即时消行 |
| `sizePreference` | -1–1 | 负值偏小块，正值偏大块 |
| `diversityBoost` | 0–1 | 抑制同类重复，提高三连块多样性 |
| `comboChain` | 0–1 | 连击续链强度 |
| `multiClearBonus` | 0–1 | 多消候选加权强度 |
| `multiLineTarget` | 0–2 | 明确追求多线同时消除的强度 |
| `delightBoost` | 0–1 | 爽感兑现强度，主要推高多消/清屏机会 |
| `perfectClearBoost` | 0–1 | 清屏候选加权强度 |
| `iconBonusTarget` | 0–1 | 同 icon / 同色 bonus 的颜色采样目标 |
| `rhythmPhase` | enum | setup / payoff / neutral 的节奏相位 |
| `sessionArc` | enum | warmup / peak / cooldown 的局内弧线 |
| `spawnIntent` | enum | relief / engage / harvest / pressure / flow / maintain |
| `targetSolutionRange` | object | 解法数量软过滤区间 |
| `orderRigor` | 0–1 | 要求三连块按特定顺序规划的强度 |
| `orderMaxValidPerms` | 1–6 | 允许可解排列数量上限 |

---

## 4. 模型一：启发式出块算法

### 4.1 问题定义

启发式出块算法需要在每轮生成三块：

```text
T = (shape_0, shape_1, shape_2)
```

目标不是最大化单一分数，而是在以下目标间折中：

- 当前盘面必须至少有可放置路径。
- 高填充、高风险、被困时不能制造不可解三连块。
- 玩家无聊、高手、收获期时提供多消、清屏、同 icon 等高价值反馈。
- Easy/Normal/Hard、会话弧线、玩家风格和盘面几何需要一致。
- UI 叙事、面板指标和真实 dock 行为不能互相矛盾。

### 4.2 设计思路

启发式出块采用 **“可解释状态估计 → 多轴 soft target → 形状级加权 → 硬约束过滤”**：

```text
PlayerProfile + AbilityVector + boardTopology + score
  ↓
adaptiveSpawn.resolveAdaptiveStrategy()
  ↓
stress + shapeWeights + spawnHints + spawnTargets + spawnIntent
  ↓
blockSpawn.generateDockShapes()
  ↓
Layer1 形状特征评分
Layer2 消行 / 多消 / 清屏 / 奖励概率加权
Layer3 session / recent category / warmup 调节
  ↓
validateSpawnTriplet + sequential solvability + solution range
  ↓
三连块
```

这对应 PCG 中常见的 **constructive generation + generate-and-test** 路线：先用规则生成候选，再用约束过滤。

### 4.3 特性

| 特性 | 说明 |
|------|------|
| 冷启动稳定 | 无历史样本时仍能根据分数、fill、holes、nearFull 等运行 |
| 可解释 | `_stressBreakdown`、`spawnHints`、`spawnDiagnostics` 可直接展示 |
| 低延迟 | 全部在浏览器本地计算 |
| 可回退 | `adaptiveSpawn.enabled=false` 时回退基础 `difficulty.js` |
| 与 UI 一致 | `spawnIntent` 是压力表、策略卡和回放标签的单一口径 |
| 奖励概率目标 | `perfectClearBoost`、`multiClearBonus`、`iconBonusTarget` 分别提高清屏、多消、同 icon 概率 |

### 4.4 输入特征

| 类别 | 字段 | 来源 | 用途 |
|------|------|------|------|
| 分数与难度 | `score`、`bestScore`、difficulty mode | `game.js` / `config.js` | 基础 stress 与挑战曲线 |
| 玩家行为 | `thinkMs`、`clearRate`、`comboRate`、`missRate`、`afkCount` | `PlayerProfile.metrics` | 判断能力、心流、疲劳 |
| 玩家状态 | `flowState`、`frustrationLevel`、`needsRecovery`、`playstyle` | `playerProfile.js` | 救济、加压、风格化 |
| 能力向量 | `skillScore`、`clearEfficiency`、`boardPlanning`、`riskLevel` | `playerAbilityModel.js` | 高价值反馈与风险护栏 |
| 盘面拓扑 | `fill`、`holes`、`nearFullLines`、`pcSetup`、`multiClearCandidates` | `boardTopology.js` / `blockSpawn.js` | 几何兑现与可解性 |
| 会话弧线 | `totalRounds`、`roundsSinceClear`、`warmupRemaining` | `_spawnContext` | 热身、收获、恢复 |

### 4.5 策略生成与目标函数

规则轨没有可微损失函数，可形式化为：

> `score(shape)` =
> `w0 × baseCategory`
> `+ w1 × mobility`
> `+ w2 × clearOpportunity`
> `+ w3 × multiClear`
> `+ w4 × perfectClear`
> `+ w5 × holeRelief`
> `+ w6 × novelty`
> `+ w7 × sessionFit`

| 分量 | 物理含义 |
|------|----------|
| `baseCategory` | 形状类别的策略基准权重 |
| `mobility` | 可落位数量与后续机动性 |
| `clearOpportunity` | 即时消行或补临消线机会 |
| `multiClear` | 同步多行/列消除潜力 |
| `perfectClear` | 一手清屏或清屏准备窗口 |
| `holeRelief` | 修复不可填空洞的价值 |
| `novelty` | 形状新鲜度与去重复 |
| `sessionFit` | 热身、收获、恢复等会话节奏匹配 |

实际实现不是线性加法，而是多层乘性权重：

```text
finalWeight =
categoryWeight
× mobilityFactor
× pcPotentialFactor
× multiClearFactor
× gapFillFactor
× holeReduceFactor
× rhythmPhaseFactor
× sizePreferenceFactor
× diversityPenalty
× milestone/sessionFactor
```

其中：

- `shapeWeights` 来自 stress 在 10 档 profile 中插值。
- `clearGuarantee` 决定三槽中优先放入多少“能立即参与消行”的候选。
- `multiClearBonus / multiLineTarget` 增强 `bestMultiClearPotential >= 2` 的块。
- `perfectClearBoost` 增强 `pcPotential === 2` 与清屏准备期 gap 块。
- `iconBonusTarget` 不改变形状，而是在 `game.js` 中放大 `monoNearFullLineColorWeights()` 的 dock 颜色抽样权重。

### 4.6 硬约束与护栏

| 护栏 | 作用 |
|------|------|
| `canPlaceAnywhere` | 每块至少能放 |
| id 去重 | 一轮三块不重复 |
| `minMobilityTarget` | 高填充时要求更多合法落点 |
| `tripletSequentiallySolvable` | 三块存在某种顺序可全部放下 |
| `evaluateTripletSolutions` | 高填充时估算解法叶子数与首手自由度 |
| `targetSolutionRange` | stress 越高可允许解空间更窄，低 stress 要求更宽松 |
| `orderRigor` | 高难模式限制 6 种排列中可解排列数，制造顺序规划压力 |
| 几何兜底 | 无真实 nearFull / multiClear / pcSetup 时下调 payoff 与多消承诺 |
| fallback | 采样多次失败时退到简化合法出块 |

### 4.7 样本、诊断与测试

启发式出块不是从样本训练，但会产出可审计数据：

- `_stressBreakdown`：每个压力分量的贡献。
- `spawnHints`：出块软目标快照。
- `_spawnDiagnostics`：候选统计、chosen reason、solutionMetrics、reject reason。
- `moveSequence`：把 spawn 与 place 快照写入回放。

关键测试：

- `tests/adaptiveSpawn.test.js`
- `tests/blockSpawn.test.js`
- `tests/bonusLineFeature.test.js`

### 4.8 代码入口

| 文件 | 作用 |
|------|------|
| `web/src/adaptiveSpawn.js` | stress、spawnHints、spawnIntent、spawnTargets |
| `web/src/bot/blockSpawn.js` | 三连块生成、特征评分、可解性验证 |
| `web/src/game.js` | 调度出块、模型轨回退、dock 颜色偏置 |
| `shared/game_rules.json` | 配置 profile、阈值、难度、特征维度 |
| `docs/algorithms/ADAPTIVE_SPAWN.md` | 信号矩阵与策略解释 |
| `docs/algorithms/ALGORITHMS_SPAWN.md` | 出块算法总手册 |

---

## 5. 模型二：生成式出块模型 SpawnTransformerV3.1

### 5.1 问题定义

生成式出块模型学习：

> `P(s0, s1, s2 | board, behaviorContext, history, targetDifficulty, playstyle)`

它用于替代规则轨的“形状采样分布”，但不替代规则护栏。输出非法、重复、不可放、服务不可用或低机动性时，必须回退启发式出块。

### 5.2 设计思路

V3.1 的核心升级是从旧 24 维 context 扩展到 56 维 `behaviorContext`，让模型显式看到：

- 玩家行为窗口。
- AbilityVector。
- boardDifficulty / holes / nearFull / solutionCount。
- 规则轨已经推导出的 `spawnTargets`、`spawnHints`、`spawnIntent`。
- playstyle 和 session arc。

设计原则：

- 三块联合建模，避免三个槽独立采样造成组合失真。
- 多任务学习，把可解性、风格、意图、难度都作为辅助监督。
- LoRA 个性化只调小模块，避免为每个用户复制完整模型。
- 线上永远保留启发式校验与回退。

### 5.3 网络结构

实现类：`rl_pytorch/spawn_model/model_v3.py::SpawnTransformerV3`

面向论文评审时可把它理解成：**条件编码器把盘面、玩家行为、目标难度、玩家风格和历史出块转为 token 序列；Transformer 融合上下文；多个输出头同时预测三槽 shape 与辅助监督目标。**

**Figure 1. SpawnTransformerV3.1 条件生成网络结构**

```text
┌──────────────────────────── Input Conditions ────────────────────────────┐
│ board 8×8 ── flatten 64 ┐                                                │
│ behaviorContext 56 ─────┴─ concat 120 ─ board_proj ─ state token 128      │
│ targetDifficulty 1 ─────── difficulty_proj ─ difficulty token 128         │
│ playstyle id ───────────── embedding + style_pos ─ style token 128        │
│ history 3×3 shape ids ──── shape_embed + history_pos ─ 9 history tokens   │
│ learned CLS token ─────────────────────────────────────────────────────── │
└───────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────── Context Encoder ──────────────────────────────┐
│ token sequence: [CLS, state, difficulty, style, history×9]                │
│ TransformerEncoder: 2 layers, 4 heads, FFN 256, d_model 128               │
│ LayerNorm                                                                 │
└───────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                         CLS output h_c ∈ R^128
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        ▼                             ▼                              ▼
┌───────────────┐          ┌──────────────────┐           ┌────────────────────┐
│ head_0        │          │ head_1           │           │ head_2             │
│ P(shape0 | c) │          │ P(shape1 | c,s0) │           │ P(shape2 | c,s0,s1)│
└───────────────┘          └──────────────────┘           └────────────────────┘
        │                             │                              │
        └────────────── autoregressive triplet prediction ──────────┘

Auxiliary heads from h_c:
  diversity_head      -> 3 × category logits
  difficulty_head     -> target difficulty regression
  feasibility_head    -> 28-shape feasibility logits
  style_head          -> playstyle logits
  intent_head         -> spawnIntent logits
```

图注说明：`c` 表示条件上下文，包含棋盘、行为上下文、目标难度、玩家风格和历史出块。三槽主输出采用自回归分解，辅助头用于把难度、可行性、风格和策略意图注入共享表示。

| 模块 | 张量形状 | 结构 | 物理含义 |
|------|----------|------|----------|
| `board_proj` | `[B, 120] → [B, 128]` | Linear + GELU + LayerNorm | 把棋盘占用与玩家行为状态压缩成“当前生成条件” |
| `difficulty_proj` | `[B, 1] → [B, 128]` | Linear + GELU + LayerNorm | 把目标难度转成可被注意力读取的条件 token |
| `playstyle_embed` | `[B] → [B, 128]` | Embedding + positional bias | 表达玩家风格，如 balanced / combo / hunter 等 |
| `shape_embed + history_pos` | `[B, 9] → [B, 9, 128]` | Shape embedding + position embedding | 编码最近三轮三槽出块节奏，避免短期组合突兀 |
| `TransformerEncoder` | `[B, 13, 128] → [B, 13, 128]` | 2 layers, 4 heads, FFN 256 | 融合“盘面-行为-历史-风格-难度”的条件依赖 |
| `head_0/1/2` | `[B, 128/256/384] → [B, 28]` | Linear heads | 依次预测三槽 shape 分布，并显式依赖前序槽 |
| `feasibility_head` | `[B, 128] → [B, 28]` | Linear | 预测每个 shape 在当前盘面是否可放 |
| `diversity/style/intent/difficulty heads` | `[B, 128] → multi targets` | Linear | 让共享表示保留类别多样性、风格、意图和难度语义 |

结构参数：

| 参数 | 当前值 | 含义 |
|------|--------|------|
| `d_model` | 128 | token 隐层宽度 |
| `nhead` | 4 | 注意力头数 |
| `layers` | 2 | TransformerEncoder 层数 |
| `feedforward` | 256 | 前馈网络宽度 |
| `shape vocab` | 28 | 可生成的 shape id 数量 |

模型特性与物理含义：

| 特性 | 工程机制 | 物理含义 |
|------|----------|----------|
| 条件生成 | `board + behaviorContext + targetDifficulty + playstyle + history` 共同进入编码器 | 出块不只看棋盘，也看玩家状态、局内节奏和历史上下文 |
| 三槽联合 | `head_1/head_2` 拼接前序 shape embedding | 三个候选块形成组合，不把每个槽当独立随机变量 |
| 可行性辅助 | `feasibility_head` 对 28 个 shape 做 BCE | 学习哪些块在当前局面可放，降低无效出块概率 |
| 策略意图辅助 | `intent_head` 预测 `spawnIntent` | 让模型区分救援、加压、收获、维持心流等出块目的 |
| 难度回归 | `difficulty_head` 回归 `targetDifficulty` | 让输出分布受控于目标难度，而不是只复现历史频率 |
| 风格条件 | `playstyle_embed` 与 `style_head` | 支持对多消、清屏、保守等玩家偏好做个性化适配 |
| LoRA-ready | 关键 head 使用命名 Linear 层 | 个性化时只训练小秩增量，避免复制完整 base 模型 |
| 规则兜底 | 推理后仍走合法性、重复、机动性校验 | 神经网络给偏好，玩法规则保证安全边界 |

自回归分解：

> `P(s0, s1, s2 | c) = P(s0 | c) × P(s1 | c, s0) × P(s2 | c, s0, s1)`

其中 `c` 表示 `board + behaviorContext + history + targetDifficulty + playstyle` 的条件上下文。

推理时：

- 每个槽 top-k / temperature 采样。
- 已选 shape 做重复 mask。
- 可选 `feasibility_mask` 把不可放 shape mask 掉。
- 返回 `shapes`、`indices`、`feasibleCount`、`modelVersion`。

### 5.4 输入 schema

| 字段 | 形状 | 来源 |
|------|------|------|
| `board` | `(8,8)` | 当前棋盘 |
| `context` | 24 | 旧上下文，兼容字段 |
| `behaviorContext` | 56 | V3.1 权威上下文 |
| `history` | `(3,3)` | 近期三轮出块历史 |
| `targetDifficulty` | scalar `[0,1]` | 前端目标难度公式 |
| `playstyle` | 5 类 | `PlayerProfile.playstyle` |
| `userId` | string | LoRA 个性化 |
| `enforceFeasibility` | bool | 服务端是否构造可放 mask |

`behaviorContext` 分段：

| 区间 | 内容 |
|------|------|
| 0–23 | 旧基础 context：分数、填充、技能、心流、metrics、stress 等 |
| 24–31 | 数据可信度与拓扑：coldStart、samples、boardDifficulty、holes、solutionCount 等 |
| 32–37 | AbilityVector 六维 |
| 38–47 | spawnTargets + hints |
| 48–53 | spawnIntent one-hot |
| 54–55 | multiLineTarget、sessionArc |

### 5.5 损失函数

训练入口：`rl_pytorch/spawn_model/train_v3.py`

总损失：

> `Loss(V3.1)` =
> `w_ce × L_ce_AR`
> `+ w_div × L_div`
> `+ w_anti × L_anti`
> `+ w_diff × L_diff`
> `+ w_feas × L_feas`
> `+ w_si × L_soft_infeasible`
> `+ w_style × L_style`
> `+ w_intent × L_intent`

| 项 | 作用 |
|----|------|
| `L_ce_AR` | 三槽自回归交叉熵，训练目标为真实/规则轨生成的三块 |
| `L_div` | 预测形状品类，鼓励类别结构可学习 |
| `L_anti` | 反分数膨胀，抑制只追高分的捷径 |
| `L_diff` | 回归 `targetDifficulty` |
| `L_feas` | `feasibility_head` 对 28 个 shape 做 BCE |
| `L_soft-infeasible` | 主分布概率质量尽量落在可行集合 |
| `L_style` | 预测 playstyle 弱标签 |
| `L_intent` | 预测 `spawnIntent` 弱标签 |

默认权重见 `train_v3.py` CLI，HTTP `/api/spawn-model/v3/train` 目前只暴露部分权重覆盖。

### 5.6 样本构建

样本来源：SQLite `sessions` + `move_sequences.frames`。

构建流程：

1. 遍历回放 frame。
2. 找到 `spawn` 帧，取当轮 dock 三块为 `targets`。
3. 取上一帧或当前 frame 的棋盘为 `board`。
4. 从 `frame.ps` 解析 `context` 与 `behavior_context`。
5. 从历史 spawn 构造 `history(3×3)`。
6. 按 score / replay 质量 / session 条件给样本 `weight`。

权威实现：

- `rl_pytorch/spawn_model/dataset.py`
- `rl_pytorch/spawn_model/train_v3.py`
- `web/src/spawnModel.js`

### 5.7 训练、推理与个性化

| 流程 | 入口 | 说明 |
|------|------|------|
| 训练 | `python -m rl_pytorch.spawn_model.train_v3` | 输出 `models/spawn_transformer_v3.pt` |
| 状态 | `GET /api/spawn-model/v3/status` | 查看 base 模型与个性化用户 |
| 推理 | `POST /api/spawn-model/v3/predict` | 返回三块 shape id |
| 个性化 | `POST /api/spawn-model/v3/personalize` | 为用户训练 `lora_<userId>.pt` |
| 重载 | `POST /api/spawn-model/v3/reload` | 清空 base 与 LoRA 缓存 |

个性化 LoRA：

- 冻结 base 模型。
- 只训练注入到 head 等线性层的小秩矩阵。
- 损失以三槽 CE 为主。
- 线上按 `userId` 和 LoRA 文件 mtime 缓存个性化模型。

### 5.8 作用机制与策略

生成式模型擅长：

- 学习规则轨难以手写的长期形状组合偏好。
- 按 playstyle 生成更个性化的三连块。
- 从历史回放中复现玩家可接受的节奏与难度。

必须保留的护栏：

- 输出不足 3 块、重复块、不可放或低机动性时回退规则轨。
- 高 fill 下仍需规则轨序贯可解检查。
- 模型只学习偏好分布，不是公平性证明器。

---

## 6. 模型三：PyTorch RL 算法模型

### 6.1 问题定义

RL 落子模型把游戏建成有约束的 MDP：

> `MDP = (S, A(s), P, r, gamma)`

| 项 | 定义 |
|----|------|
| `S` | 当前棋盘、dock、拓扑、分数等可见状态 |
| `A(s)` | 所有合法 `(blockIdx, gx, gy)` |
| `P` | 放置、消行、刷新 dock 的转移 |
| `r` | 分数、清行、存活、拓扑塑形、终局奖励 |
| `γ` | 折扣因子 |

目标是最大化期望折扣回报：

> `J(theta) = E[Σ gamma^t × r_t]`

直观含义：策略 `π_theta` 希望在整局内获得更高的折扣累计奖励。

### 6.2 设计思路

PyTorch RL 是服务端重型策略价值模型：

- 使用 CNN 识别 8×8 棋盘空间结构。
- 使用 DockBoardAttention 让 dock 形状读取棋盘特征。
- 对每个合法动作用 `h(s) + ψ(a)` 计算 logit。
- 价值头学习 `V(s)`，降低策略梯度方差。
- 多个辅助头给稀疏奖励提供密集监督。
- 可接 beam/MCTS/1-step lookahead teacher 做蒸馏。

#### 6.2.1 与 AlphaGo / AlphaZero 系列的设计对比

OpenBlock PyTorch RL 可以定位为 **AlphaZero-inspired actor-critic**：它吸收了 policy-value network、自博弈、搜索 teacher、策略蒸馏等思想，但训练主干仍是 PPO/GAE，而不是完整 AlphaZero 的“MCTS 改进策略 → 网络拟合改进策略 → 再自博弈”闭环。

| 路线 | 训练信号 | 搜索角色 | 网络目标 | 与 OpenBlock 的关系 |
|------|----------|----------|----------|---------------------|
| AlphaGo | 人类专家棋谱监督 + RL 自博弈 | MCTS 结合 policy、value、rollout | 分离或组合的 policy / value 网络 | OpenBlock 没有人类专家落子库，更多依赖自博弈、规则环境和可选搜索 teacher |
| AlphaGo Zero | 纯规则自博弈，无人类数据 | MCTS 产生更强的访问分布 `π` | 单一 policy-value 网络拟合 `π` 和终局 `z` | OpenBlock 的 `qTeacher`、`visit_pi` 最接近此路线，但目前是辅助蒸馏，不是主闭环 |
| AlphaZero | 同一算法泛化到围棋、国际象棋、日本将棋 | MCTS 作为每步策略改进器 | 从规则和自博弈学习通用 policy-value | OpenBlock 可借鉴规则驱动自博弈和评估门禁，但需适配单人、随机出块和复合奖励 |
| OpenBlock PyTorch RL | PPO/GAE 回报、辅助监督、可选 teacher | beam / MCTS / 1-step lookahead 可作为 teacher | `policy_fuse`、`value_head`、多辅助头 | 工程上更轻，适合单人休闲游戏训练与服务端在线推理 |

关键差异：

| 维度 | AlphaZero 系列 | OpenBlock PyTorch RL |
|------|----------------|----------------------|
| 博弈形式 | 双人零和、完全信息棋类 | 单人休闲消除，出块由规则/模型生成 |
| 终局价值 | 胜 / 负 / 平，通常记为 `z` | 分数、存活、清行、空洞、盘面质量的复合回报 |
| 动作空间 | 棋盘落子或棋子走法，规则固定 | 每步枚举合法 `(blockIdx, gx, gy)`，并携带 `ψ(a)[15]` 动作物理特征 |
| 搜索成本 | MCTS 是核心推理环节 | 搜索更适合作为离线/轻量 teacher，线上可按成本选择 |
| 损失函数 | 策略 CE(`π`) + 价值回归(`z`) + 正则 | PPO clipped objective + value + entropy + aux losses + teacher distill |
| 设计目标 | 最强胜率 | 高分、续航、可学性、盘面健康与策略评估 |

对本项目最有价值的借鉴点：

1. **搜索改进策略闭环**：把 `qTeacher / visit_pi` 从可选字段提升为稳定 teacher，由 beam/MCTS/lookahead 输出动作价值或访问分布，再让策略头学习。
2. **统一 policy-value 表达**：继续强化共享 trunk，让 `h(s)` 同时服务动作选择、局面估值和拓扑辅助任务。
3. **评估门禁**：参考 AlphaZero 的新旧模型对抗思想，用固定 seed、平均分、存活步数、死局率、清行率、空洞风险等指标决定 checkpoint 是否替换。
4. **避免直接照搬 MCTS**：OpenBlock 的真人体验有延迟约束，且目标不是单一胜负；搜索应优先用于训练样本增强、离线评估和小规模 lookahead，而不是强制成为每步线上必需流程。

#### 6.2.2 与游戏自博弈参考谱系的比较

从 `2.1 游戏自博弈参考谱系` 看，OpenBlock PyTorch RL 当前处在 **“单人游戏自博弈 + PPO actor-critic + 辅助监督 + 可选搜索蒸馏”** 的位置。它不是纯 TD-Gammon、AlphaZero 或 MuZero，而是把这些路线中适合单人休闲消除游戏的组件组合起来。

| 参考路线 | 典型训练闭环 | PyTorch RL 当前对应 | 已采用程度 | 适配结论 |
|----------|--------------|---------------------|------------|----------|
| TD-Gammon | 自博弈生成轨迹，TD 学习局面价值 | `OpenBlockSimulator` 自博弈 + `value_head` 学习回报 | 高 | 适合作为基础范式：无需专家数据即可训练 bot |
| AlphaGo | 专家监督 policy + RL 自博弈 + value + MCTS | 无专家棋谱；有 policy/value 分工和搜索 teacher 接口 | 中 | 可借鉴 `policy/value/search` 分工，但不应引入人类棋谱依赖 |
| AlphaGo Zero / AlphaZero | MCTS 产生访问分布 `π`，网络拟合 `π` 和终局 `z`，再迭代自博弈 | `qTeacher / visit_pi` 可做蒸馏，但 PPO 仍是主损失 | 中低 | 最适合作为后续增强：把搜索输出稳定化为 teacher，而非马上替换 PPO |
| Expert Iteration | 慢速搜索作为 expert，快速网络学习 expert，并反向指导搜索 | beam / MCTS / 1-step lookahead → `q_distill / visit_pi` | 中 | 与当前工程最贴合，适合先做离线 teacher 数据集 |
| MuZero | 学习 reward/value/policy 隐模型，并在隐空间规划 | 目前只有 `board_quality / survival / topology` 辅助预测，没有 learned dynamics | 低 | 可借鉴“预测可规划量”，但完整 MuZero 成本过高 |
| NFSP | best response + average strategy，避免自博弈振荡 | 目前没有平均策略池；可保存多 checkpoint 做对照 | 低 | 可用于防止策略单一化，尤其适合 bot 评估而非真人链路 |
| AlphaStar / OpenAI Five | 多智能体联赛、大规模分布式自博弈、策略池和版本迁移 | 当前是单环境/单策略训练，可做 checkpoint gate | 低 | 只借鉴评估池、版本晋级和长 episode 稳定训练机制 |
| OpenSpiel | 标准化游戏环境、算法、评估和可复现实验 | 当前已有固定 seed / greedy eval / 指标门禁雏形 | 中 | 可借鉴实验协议，把训练结果变成可比较的算法报告 |

关键维度对照：

| 维度 | 自博弈论文常见做法 | OpenBlock PyTorch RL 当前做法 | 原因 |
|------|--------------------|-------------------------------|------|
| 价值目标 | 胜负 `z`、TD value 或最终排名 | 折扣累计奖励 + 分数 + 存活 + 盘面质量 | 单人消除没有对手胜负，体验目标是复合的 |
| 策略目标 | 拟合专家动作、MCTS 访问分布或 best response | PPO clipped objective，叠加 `qTeacher / visit_pi` 蒸馏 | PPO 更轻，适合可变动作空间和在线攒批 |
| 搜索位置 | AlphaZero/MuZero 中搜索是核心推理器 | 搜索更偏训练 teacher / lookahead 服务 | 真人体验和服务成本要求低延迟 |
| 动作表示 | 棋类通常是固定动作索引 | 合法 `(blockIdx, gx, gy)` + `ψ(a)[15]` | 候选块和可放位置每步变化，需要动作物理特征 |
| 环境模型 | 棋类规则确定；MuZero 学隐模型 | OpenBlock simulator 规则已知，出块可能由规则/模型生成 | 先用显式 simulator 更稳，不急于学习 dynamics |
| 策略多样性 | League / average strategy / opponent pool | 当前主要单 checkpoint，未来可扩展策略池 | 单人游戏更关注可学性和规则评估，不需要复杂对手池 |
| 评估协议 | 新旧模型对战、Elo、胜率、league ranking | 固定 seed、平均分、存活步数、死局率、空洞风险、清行率 | 单人游戏应以可复现实验指标替代胜率 |

推荐演进顺序：

1. **Expert Iteration 化**：先稳定生成 `qTeacher / visit_pi`，把搜索结果作为辅助监督数据，而不是改变线上推理。
2. **AlphaZero 化局部闭环**：在离线训练中加入“搜索改进策略 → 训练策略头 → 固定 seed 评估门禁”的小闭环。
3. **OpenSpiel 化评估协议**：固定实验配置、seed、指标面板和 checkpoint 晋级规则，保证不同算法版本可比较。
4. **MuZero 化可规划预测**：只在需要时把 `board_quality / survival / topology` 扩展成轻量 latent planning，不优先做完整 learned dynamics。
5. **League 化策略池**：保留多个不同风格/难度的 bot checkpoint，用于检验出块规则是否只对单一策略友好。

### 6.3 网络结构

实现：`rl_pytorch/model.py::ConvSharedPolicyValueNet`

这个网络按论文结构可描述为：**多模态状态编码器 + Dock-Board 交叉注意力 + 共享 actor-critic trunk + 动作条件策略头 + 多任务辅助头。**

**Figure 2. ConvSharedPolicyValueNet 策略价值网络结构**

```text
┌──────────────────────────── State Feature Split ─────────────────────────┐
│ s ∈ R^181                                                                │
│   ├─ scalars[42]: fill / holes / near-full / color summary               │
│   ├─ grid[64]   : 8×8 occupancy map                                      │
│   └─ dock[75]   : 3 dock masks, each 5×5                                 │
└──────────────────────────────────────────────────────────────────────────┘
             │                         │                         │
             ▼                         ▼                         ▼
┌──────────────────────┐   ┌─────────────────────────┐   ┌────────────────────┐
│ Scalar branch         │   │ Board CNN branch         │   │ Dock branch         │
│ identity 42           │   │ 1×8×8                    │   │ 3×5×5 masks         │
└──────────────────────┘   │ Conv2d + GELU             │   │                    │
             │             │ ResConv × 2               │   │                    │
             │             │ grid spatial C×8×8        │   │                    │
             │             │ global mean pool C        │   │                    │
             │             └─────────────┬─────────────┘   └──────────┬─────────┘
             │                           │                            │
             │                           ▼                            ▼
             │             ┌──────────────────────────────┐  ┌──────────────────────┐
             │             │ DockBoardAttention            │  │ optional             │
             │             │ Q = dock masks                │  │ DockPointEncoder     │
             │             │ K/V = grid spatial features   │  │ PointNet-style       │
             │             │ output: dock context 3×16     │  │ output: 3×16         │
             │             └─────────────┬────────────────┘  └──────────┬───────────┘
             │                           │                              │
             └───────────────────────────┴───────────────┬──────────────┘
                                                         ▼
┌──────────────────────────── Shared State Encoder ────────────────────────┐
│ concat: scalars 42 + grid pooled C + dock context 48                     │
│ LayerNorm                                                                │
│ residual MLP trunk: width 128                                            │
│ output: h(s) ∈ R^128                                                     │
└──────────────────────────────────────────────────────────────────────────┘
                         │                         │
                         │                         ▼
                         │          ┌─────────────────────────────┐
                         │          │ value_head                  │
                         │          │ output: V(s)                │
                         │          └─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────── Action-Conditioned Actor ────────────────────┐
│ legal action a = (blockIdx, gx, gy)                                      │
│ ψ(a) ∈ R^15 ─ action_proj ─ action_emb ∈ R^48                            │
│ concat[h(s), action_emb] ─ policy_fuse ─ logit(s,a)                      │
└──────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
                softmax over legal actions

Auxiliary heads:
  from h(s):              board_quality_head, feasibility_head, survival_head
  from [h(s), action_emb]: hole_aux_head, clear_pred_head, topology_aux_head
```

图注说明：`s[181]` 被拆为全局标量、8×8 棋盘占用和 3 个 dock 形状 mask；棋盘分支提取空间特征，dock 分支通过交叉注意力读取棋盘上下文；共享表示 `h(s)` 同时服务价值估计、动作打分和辅助监督。

| 模块 | 输入 → 输出 | 结构 | 物理含义 |
|------|-------------|------|----------|
| 标量分支 | `42 → 42` | 直连 | 保留 fill、holes、nearFull、颜色摘要等低维全局事实 |
| 棋盘 CNN | `1×8×8 → C×8×8` | Conv2d + 2 个 ResConvBlock | 识别缺口、拥塞、表面形态、行列结构等空间模式 |
| 全局池化 | `C×8×8 → C` | mean pooling | 把整体盘面形态压成全局语义 |
| DockBoardAttention | `3×25 + C×8×8 → 3×16` | dock 为 query，棋盘空间特征为 key/value | 判断“这个块适合补哪个区域”，建模块与盘面的匹配关系 |
| DockPointEncoder | `3×25 → 3×16` | PointNet-style 可选分支 | 不依赖棋盘，仅从点集几何中编码 shape 形态 |
| 共享 trunk | `42 + C + 48 → 128` | LayerNorm + 3 层残差 MLP | 得到统一局面表示 `h(s)` |
| 动作投影 | `ψ(a)[15] → 48` | Linear + GELU | 把候选动作的坐标、清行、风险、bonus 等转成动作 embedding |
| 策略头 | `h(s) + action_emb → logit` | MLP | 对每个合法动作输出偏好分数 |
| 价值头 | `h(s) → V(s)` | MLP | 估计当前局面未来回报 |
| 辅助头 | `h(s)` 或 `h(s)+action_emb` | 多任务 MLP | 提供 board quality、feasibility、survival、holes、clear、topology 监督 |

结构参数：

| 参数 | 当前值 | 含义 |
|------|--------|------|
| `stateDim` | 181 | 状态特征长度 |
| `actionDim` | 15 | 单个动作特征长度 |
| `phiDim` | 196 | `state + action` 拼接长度 |
| `width` | 128 | 共享 trunk 隐层宽度 |
| `conv_channels` | 32 | 棋盘 CNN 通道数 |
| `action_embed_dim` | 48 | 动作 embedding 宽度 |
| `dock_attn_head_dim` | 16 | 每个 dock 块的上下文向量宽度 |
| `dock_ctx_dim` | 48 | 三个 dock 块合计上下文宽度 |

动作打分流程：

| 步骤 | 数据 | 说明 |
|------|------|------|
| 1 | `state s[181]` | 编码一次当前局面，得到 `h(s)` |
| 2 | `legal actions` | 枚举所有合法 `(blockIdx, gx, gy)` |
| 3 | `ψ(a)[15]` | 为每个动作构造动作物理特征 |
| 4 | `[h(s), ψ(a)]` | 状态和动作融合 |
| 5 | `logit(s,a)` | 输出动作偏好，softmax 后采样或贪心选择 |

模型特性与物理含义：

| 特性 | 工程机制 | 物理含义 |
|------|----------|----------|
| 多模态状态编码 | 标量、棋盘 CNN、dock mask 三路输入 | 同时理解全局风险、空间几何和候选块形状 |
| Dock-Board 交互 | `DockBoardAttention(Q=dock, K/V=grid)` | 让块主动“看”棋盘，学习补洞、贴边、促清等匹配关系 |
| 动作条件策略 | 对每个合法动作构造 `ψ(a)` 并与 `h(s)` 融合 | 策略不是只选槽位，而是评价“某块放某处”的实际后果 |
| 共享 actor-critic trunk | `h(s)` 同时送入 policy 与 value | 使动作偏好和局面估值共享空间理解 |
| 多任务辅助监督 | board、feasibility、survival、hole、clear、topology 多头 | 把稀疏长期回报拆成更可学习的局部物理目标 |
| 搜索蒸馏接口 | `qTeacher`、`visit_pi` 可进入训练损失 | 吸收 beam/MCTS/lookahead 的更强动作评估 |
| 可替代 dock 编码器 | `use_point_encoder` 切换 PointNet-style 编码 | 便于比较“棋盘交互注意力”和“纯形状几何编码”的效果 |
| 线上成本可控 | 一次编码状态，对所有合法动作批量打分 | 适合服务端推理和浏览器采样上传 |

辅助头物理含义：

| Head | 监督目标 | 物理含义 |
|------|----------|----------|
| `board_quality_head` | 落子后棋盘质量 | 平整、低洞、高机动性的综合质量 |
| `feasibility_head` | 剩余块是否全可放 | 当前选择是否会把本轮后续块卡死 |
| `survival_head` | 还能存活多少步 | 长期续航能力 |
| `hole_aux_head` | 空洞风险 | 预测动作后不可填空洞压力 |
| `clear_pred_head` | 清行类别 | 预测动作是否产生单消、多消等 |
| `topology_aux_head` | 落子后拓扑向量 | 学习填充、近满线、破碎度等结构变化 |

### 6.4 特征与样本构建

权威维度：

```text
state = 181
action = 15
phi = 196
```

每步样本包含：

```js
{
  stateFeat,
  phiList,       // 每个合法动作一条 φ
  chosenIdx,
  reward,
  holes_after,
  clears,
  board_quality,
  feasibility,
  topology_after,
  qTeacher?,     // 可选搜索/估值 teacher
  steps_to_end
}
```

样本来源：

- 离线：`rl_pytorch/train.py` 调 `OpenBlockSimulator` 自博弈。
- 在线：浏览器 `trainer.js` 上传 episode 到 `/api/rl/train_episode`。
- 评估：固定 seed / greedy eval / eval gate。

### 6.5 优化目标与损失

PPO clipped surrogate：

> `PPO_clip = mean(min(ratio × advantage, clipped_ratio × advantage))`

其中：

| 符号 | 含义 |
|------|------|
| `ratio` | 新旧策略在同一动作上的概率比 |
| `advantage` | 当前动作相对价值基线的优势 |
| `clipped_ratio` | 把 `ratio` 限制在 `[1 - epsilon, 1 + epsilon]` 后的值 |

总损失可写为：

> `Loss(RL)` =
> `L_policy_PPO`
> `+ c_v × L_value`
> `- c_e × entropy(policy)`
> `+ Σ c_k × L_aux_k`
> `+ c_q × L_q_distill`
> `+ c_pi × L_visit_pi`

| 项 | 实现含义 |
|----|----------|
| `policy_loss` | PPO clipped objective；单局路径近似 REINFORCE-with-baseline |
| `value_loss` | Huber / smooth L1，目标为 return / GAE / outcome 混合 |
| `entropy` | 维持探索，随训练退火 |
| `aux losses` | board quality、feasibility、survival、holes、clear、topology |
| `q_distill` | 从 `q_teacher` 学习动作偏好 |
| `visit_pi` | 从搜索访问分布学习 |

优势估计：

- 离线路径使用 GAE。
- 在线单局路径使用折扣蒙特卡洛回报。
- 支持优势归一化、梯度裁剪、return clip。

### 6.6 训练与服务

| 场景 | 入口 | 机制 |
|------|------|------|
| 离线训练 | `python -m rl_pytorch.train` | 自博弈采样 + PPO 多 epoch 更新 |
| 在线训练 | `POST /api/rl/train_episode` | 单局或 replay buffer 攒批更新 |
| 推理 | `POST /api/rl/select_action` | 对所有合法动作算 logits 并采样 |
| 估值 | `POST /api/rl/eval_values` | 浏览器 lookahead 批量估计 `V(s')` |
| 贪心评估 | `POST /api/rl/eval_greedy` | 对当前 checkpoint 做评估 |
| 保存 | `RL_CHECKPOINT_SAVE` / `saveRemoteCheckpoint` | checkpoint 与 meta |

### 6.7 作用机制与策略

RL 模型主要用于：

- 自动玩家 / Bot 训练。
- 验证规则、难度、出块策略是否可被学习。
- 给策略设计提供反事实：同样 dock 下最优落子倾向。
- 用搜索 teacher 改善稀疏奖励下的样本效率。

它不直接用于真人出块，但其训练结果能帮助评估“当前规则是否导致不可学、不可玩或策略单一”。

---

## 7. 模型四：RL 浏览器模型

### 7.1 问题定义

浏览器 RL 模型是轻量级本地训练和远端 RL 调用的桥：

- 在不启动 Python 训练时，浏览器可以用线性策略做 REINFORCE 自博弈。
- 启动 PyTorch 服务时，浏览器作为采样器、可视化面板和在线训练客户端。
- 它必须在主线程、有限 CPU 和 localStorage 约束下稳定运行。

### 7.2 设计思路

浏览器本地模型选择线性架构而非 MLP：

- 参数少：`W[196] + Vw[181]`。
- 更新稳定：单局 REINFORCE 下比深层网络更不容易发散。
- 可序列化：直接存 localStorage / SQLite。
- 可解释：每个特征对策略 logit 的影响线性可读。

代码入口：

- `web/src/bot/linearAgent.js`
- `web/src/bot/trainer.js`
- `web/src/bot/features.js`
- `web/src/bot/gameEnvironment.js`
- `web/src/bot/simulator.js`
- `web/src/bot/pytorchBackend.js`
- `web/src/bot/rlPanel.js`

### 7.3 网络结构

浏览器 RL 是最轻量的线性 actor-critic。它没有隐藏层，结构上更像“可解释打分器”：

| 输出 | 公式 | 含义 |
|------|------|------|
| 策略 logit | `logit(a|s) = dot(W, phi(s,a))` | 用状态-动作特征给每个合法动作打分 |
| 状态价值 | `V(s) = dot(Vw, s)` | 估计当前局面后续可获得的回报 |

| 参数 | 形状 | 作用 |
|------|------|------|
| `W` | `[196]` | 策略权重；每一维直接对应 `φ(s,a)` 的贡献 |
| `Vw` | `[181]` | 价值权重；每一维直接对应 `s` 的贡献 |
| `temperature` | scalar | 控制探索，越高越随机 |
| `entropyBeta` | scalar | 防止策略过早塌缩到单一动作 |

推理流程：

| 步骤 | 数据 | 说明 |
|------|------|------|
| 1 | simulator 当前状态 | 读取棋盘、dock、分数等 |
| 2 | `buildDecisionBatch()` | 枚举合法动作并构造特征 |
| 3 | `stateFeat + phiList` | 每个合法动作都有一条 `φ(s,a)` |
| 4 | `dot(W, phi)` | 计算每个动作的 logit |
| 5 | `softmax(logits / temperature)` | 转成动作概率 |
| 6 | `sample action` | 采样动作，训练时保留概率用于梯度更新 |

### 7.4 优化目标与损失

折扣回报：

> `G_t = r_t + gamma × r_(t+1) + gamma^2 × r_(t+2) + ...`

优势：

> `A_t = normalized_return_t - V(s_t)`

策略更新：

> `policy_update = advantage × grad(log pi(action|state)) + beta × grad(entropy)`

价值更新：

> `Vw ← Vw + value_lr × (G_t - V(s_t)) × state`

工程增强：

- Welford 在线回报标准化，样本数足够后启用。
- 优势按局中心化 / 标准化。
- `maxGradNorm` 裁剪优势，避免单局极端回报炸权重。
- 熵正则维持探索。
- 温度随 episode 衰减。

### 7.5 样本构建

`runSelfPlayEpisode()` 每步产出：

```js
{
  stateFeat,
  phiList,
  probs,
  chosenIdx,
  reward,
  holes_after,
  clears,
  board_quality,
  feasibility,
  topology_after,
  qTeacher?,
  steps_to_end
}
```

与 PyTorch 路径的关系：

- 本地训练使用 `probs` 和 `chosenIdx` 做 REINFORCE。
- 远端训练把同一 trajectory 上传到 `/api/rl/train_episode`。
- 若启用 lookahead，浏览器对每个合法动作模拟一步并调用 `/api/rl/eval_values`，形成 `qTeacher`。

### 7.6 浏览器约束

| 约束 | 设计应对 |
|------|----------|
| 主线程不能长时间阻塞 | 训练循环定期 `await setTimeout(0)` 让出事件循环 |
| 后台标签页耗电 | `skipWhenDocumentHidden` 等配置 |
| localStorage 容量 | 只存线性权重 JSON |
| 合法动作过多 | lookahead 只在动作数 ≤ 120 时启用 |
| 弱设备稳定性 | 线性模型 + 梯度裁剪 + 温度保护 |

### 7.7 作用机制

浏览器 RL 的价值不在于成为最强 Bot，而在于：

- 让训练面板可即时演示策略学习。
- 作为 PyTorch RL 的在线采样客户端。
- 在没有 Python 服务时仍能提供轻量基线。
- 用同一套 `features.js` 检查前后端特征契约。

---

## 8. 四模型对比与协作策略

| 维度 | 启发式出块 | 生成式出块 | PyTorch RL | 浏览器 RL |
|------|------------|------------|------------|-----------|
| 决策对象 | 三连块形状 | 三连块形状 | 落子动作 | 落子动作 |
| 输入 | profile + topology + rules | board + behaviorContext + history | state + legal action features | state + legal action features |
| 输出 | shapes | shapes | action index | action index |
| 学习方式 | 无 | 监督学习 + 多任务 | PPO/GAE + aux + distill | REINFORCE + baseline |
| 失败策略 | fallback_simple | 回退启发式 | 不影响真人 | 回退本地/远端默认 |
| 可解释性 | 强 | 中 | 中 | 强 |
| 延迟 | 低 | 取决于服务端 | 取决于服务端 | 低 |
| 主要测试 | adaptive/blockSpawn | spawnModel/test_v3 | RL eval / service tests | features/simulator tests |

协作原则：

1. 真人体验优先由启发式出块保证公平和稳定。
2. 生成式出块只能在护栏内提高个性化与多样性。
3. RL 模型不能读出块内部信号，避免训练环境与真人路径互相污染。
4. 浏览器 RL 是 lightweight agent 和 PyTorch 客户端，不是 Spawn 模型。
5. 改特征维度必须同步 JS/Python、checkpoint、文档和测试。

---

## 9. 验证与上线清单

| 改动类型 | 必跑验证 |
|----------|----------|
| 启发式出块 | `npm test -- tests/adaptiveSpawn.test.js tests/blockSpawn.test.js` |
| 生成式出块 | `npm test -- tests/spawnModel.test.js`、`python -m rl_pytorch.spawn_model.test_v3` |
| RL 特征维度 | `npm test -- tests/features.test.js tests/simulator.test.js`，并检查 `rl_pytorch/features.py` |
| PyTorch RL 服务 | `python -m rl_pytorch.eval_cli` 或 `/api/rl/eval_greedy` |
| 浏览器 RL | `tests/features.test.js`、`tests/simulator.test.js`、手动训练面板 smoke |
| 文档变更 | `npm run lint` 不应受影响；检查 docs 索引链接 |

上线前必须确认：

- `shared/game_rules.json.featureEncoding` 与 `features.js / features.py` 一致。
- Spawn V3.1 checkpoint 的 `behavior_context_dim` 为 56。
- 模型轨失败会回退规则轨。
- RL checkpoint 的 meta 与当前特征维度一致。
- 文档中的公式和维度没有沿用旧 `181/12/193` 口径。

---

## 10. 代码入口速查

### 启发式出块

- `web/src/adaptiveSpawn.js`
- `web/src/bot/blockSpawn.js`
- `web/src/boardTopology.js`
- `web/src/game.js`
- `shared/game_rules.json`
- `tests/adaptiveSpawn.test.js`
- `tests/blockSpawn.test.js`

### 生成式出块

- `web/src/spawnModel.js`
- `server.py`
- `rl_pytorch/spawn_model/dataset.py`
- `rl_pytorch/spawn_model/model_v3.py`
- `rl_pytorch/spawn_model/train_v3.py`
- `rl_pytorch/spawn_model/personalize.py`
- `rl_pytorch/spawn_model/test_v3.py`
- `tests/spawnModel.test.js`

### PyTorch RL

- `rl_backend.py`
- `rl_pytorch/model.py`
- `rl_pytorch/train.py`
- `rl_pytorch/features.py`
- `rl_pytorch/simulator.py`
- `rl_pytorch/eval_cli.py`
- `web/src/bot/pytorchBackend.js`

### 浏览器 RL

- `web/src/bot/linearAgent.js`
- `web/src/bot/trainer.js`
- `web/src/bot/features.js`
- `web/src/bot/gameEnvironment.js`
- `web/src/bot/simulator.js`
- `web/src/bot/rlPanel.js`
- `tests/features.test.js`
- `tests/simulator.test.js`

---

## 11. 相关文档

- [模型工程总览](./MODEL_ENGINEERING_GUIDE.md)
- [出块算法手册](./ALGORITHMS_SPAWN.md)
- [出块建模](./SPAWN_BLOCK_MODELING.md)
- [自适应出块](./ADAPTIVE_SPAWN.md)
- [RL 算法手册](./ALGORITHMS_RL.md)
- [PyTorch RL 服务与评估](./RL_PYTORCH_SERVICE.md)
- [RL 与玩法契约](./RL_AND_GAMEPLAY.md)
- [浏览器 RL 优化（归档）](../archive/algorithms/RL_BROWSER_OPTIMIZATION.md)
- [实时策略系统](../player/REALTIME_STRATEGY.md)

---

## 12. 参考文献

1. Williams, R. J. (1992). Simple statistical gradient-following algorithms for connectionist reinforcement learning. *Machine Learning*.
2. Sutton, R. S., & Barto, A. G. (2018). *Reinforcement Learning: An Introduction*.
3. Schulman, J. et al. (2015). High-Dimensional Continuous Control Using Generalized Advantage Estimation.
4. Schulman, J. et al. (2017). [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347).
5. Vaswani, A. et al. (2017). [Attention Is All You Need](https://arxiv.org/abs/1706.03762).
6. Hu, E. J. et al. (2021). [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685).
7. Silver, D. et al. (2017). Mastering Chess and Shogi by Self-Play with a General Reinforcement Learning Algorithm.
8. Togelius, J. et al. (2011). Search-Based Procedural Content Generation.
9. Smith, A. M., & Mateas, M. (2011). Answer Set Programming for Procedural Content Generation.
