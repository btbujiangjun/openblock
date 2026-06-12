# 算法文档

出块、玩家画像、强化学习和商业化推断的算法与模型文档。

---

## 一、一图入门

![OpenBlock 算法架构总览：六层 + 七子模型 + 反馈闭环](./assets/algorithm-architecture.png)

- [算法架构图（设计参考 + 紧凑概念图 + 8 子图）](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md)
  —— **视图 A 设计参考稿**：六层（数据输入 / 核心模型 / 决策输出 / 训练优化 / 支撑 / 反馈闭环）+ 七大具名子模型 + 中央融合决策引擎；
  **视图 B 紧凑概念图**：信号采集 / 算法核心 / 决策策略 / 训练监控四层 + 反馈环；
  **8 子图**：每个算法模型的内部结构、阈值与默认值
- [算法架构图生成 Prompt](./ALGORITHM_DIAGRAM_PROMPT.md) —— 重生成视图 B + 8 子图的可复用 prompt 模板（含完整事实包）
- [系统架构图生成 Prompt](./ARCHITECTURE_DIAGRAM_PROMPT.md) —— 完整重建 6 张 Mermaid 系统架构图的 prompt 模板

---

## 总——权威手册与总览

- [算法与模型手册](./ALGORITHMS_HANDBOOK.md) —— 总索引与符号约定，全算法体系入口
- [模型工程总览](./MODEL_ENGINEERING_GUIDE.md) —— 全部模型的工程地图：文件位置、数据流、依赖关系
- [四模型系统设计](./MODEL_SYSTEMS_FOUR_MODELS.md) —— 启发式 / 生成式 / PyTorch RL / 浏览器 RL 四类模型的选型与架构对比

## 分——出块算法专题

![出块算法架构图：9层流水线（输入层→染色层）](./assets/spawn-architecture.png)

> **上图速读**：`generateDockShapes` 的完整 9 层流水线——从原始棋盘状态一路到候选块输出与颜色绑定。

| 图中层号 | 层名 | 对应文档章节 |
|:---:|---|---|
| 层 0 | 输入层 | [出块架构 §二](./ALGORITHMS_SPAWN.md#十二出块算法架构总览工程分层) |
| 层 1 | 盘面感知层 | [自适应出块 §10.8.2](./ADAPTIVE_SPAWN.md#1082-阶段-0盘面感知) |
| 层 2 | 评分构建层 | [自适应出块 §10.8.3](./ADAPTIVE_SPAWN.md#1083-阶段-1全形状池评分scored-构建) |
| 层 3 | 优先选拔层 | [自适应出块 §10.8.4–§10.8.5](./ADAPTIVE_SPAWN.md#1084-阶段-2stage-1--消行优先席clearseats) |
| 层 4 | 加权补齐层 | [出块架构 §二](./ALGORITHMS_SPAWN.md#十二出块算法架构总览工程分层)（加权乘子表） |
| 层 5 | 约束验证层 | [出块架构 §二](./ALGORITHMS_SPAWN.md#十二出块算法架构总览工程分层)（硬约束表）· [出块难度 §一](./ALGORITHMS_SPAWN.md#十四出块难度与评估) |
| 层 6 | 注入优化层 | [自适应出块 §10.8.7](./ADAPTIVE_SPAWN.md#1087-阶段-5l2-特殊形状注入_tryinjectspecial) |
| 层 7 | 输出层 | [自适应出块 §10.8.9](./ADAPTIVE_SPAWN.md#1089-阶段-7输出与-dfv-标注) |
| 层 8 | 染色层 | [自适应出块 §10.8.10](./ADAPTIVE_SPAWN.md#10810-阶段-8染色绑定gamejs) |

- [**出块算法手册**](./ALGORITHMS_SPAWN.md) —— 出块子系统**统一权威文档**：问题形式化、双轨架构、SpawnTransformer 网络/训练/推理（§1–§11），并整合：
  - [§12 架构总览（工程分层）](./ALGORITHMS_SPAWN.md#十二出块算法架构总览工程分层) —— L1/L2 四角色 + 三层架构 + 5 阶段流水线 + 30+ 加权乘子 + 架构图 Prompt
  - [§13 出块建模与设计 rationale](./ALGORITHMS_SPAWN.md#十三出块建模双轨实现与设计-rationale) —— 规则引擎 + SpawnPolicyNet 双轨、PB 双 S 曲线、个性化与受控随机实验轨、候选块概率图鉴
  - [§14 出块难度与评估](./ALGORITHMS_SPAWN.md#十四出块难度与评估) —— 解法数量难度 + 单步难度细化 + CLI/Web 评估工具
  - [§15 出块参数寻优（SpawnParamTuner）](./ALGORITHMS_SPAWN.md#十五出块参数寻优spawnparamtuner) —— 工业化 L2 ResNet-MLP 寻参管线 + 操作手册
- [自适应出块](./ADAPTIVE_SPAWN.md) —— 运行时 **10 信号融合引擎深潜**：§10.8 完整流水线（v1.60.35 代码基准）+ §10.10.10 生命周期×成熟度 25 格调制矩阵
- [局间难度（RoR）](./ALGORITHMS_SPAWN.md#十六局间难度ror) —— 5 档 arc × humped 连战曲线 × arc-aware D 曲线形变；含 5×5×5 立方矩阵与跨语言契约
- [出块算法信号透视仪](./spawn-signal-explorer.html) —— 交互式 HTML 工具：L1/L2/L3 信号条目随代码自动计数，含 v1.66 `pressurePhase`/`phaseFreq`、v1.67 构造式预扫描（C1/C2/C3）、Intent 优先级矩阵、Stress 分量全表、完整链路依赖图（代码口径 v1.67）

## 分——玩家画像算法

- [**玩家画像与能力评估手册**](./ALGORITHMS_PLAYER_MODEL.md) —— 玩家建模子系统**统一权威文档**：能力建模公式、特征、参数、`AbilityVector`、建模方法与评估指标（§1–§16），并整合：
  - [§17 画像指标自评估与自我优化（profileAudit）](./ALGORITHMS_PLAYER_MODEL.md#十七画像指标自评估与自我优化profileaudit) —— 四层评估 + 预期关系契约 + 健康分 + 全库自闭环工具链
  - [§18 实时状态历史序列分析](./ALGORITHMS_PLAYER_MODEL.md#十八实时状态历史序列分析) —— 基于 `move_sequences.frames[*].ps` 的历史实时状态分布、互操作关系与 stress 分量贡献
  - [§19 离线聚合画像与偏好分析（playerAnalytics）](./ALGORITHMS_PLAYER_MODEL.md#十九离线聚合画像与偏好分析playeranalytics) —— 跨局聚合的能力 6 维 + 时序特质（trend/endurance/clutch）+ 软概率偏好 + `spawnAdvice` 出块建议层，及其与实时 `adaptiveSpawn` 的同质性对比；入口「📈 能力偏好分析」

## 分——强化学习专题

- [**RL 训练与推理手册**](./ALGORITHMS_RL.md) —— RL 子系统**统一权威文档**：状态/动作/奖励、网络结构、训练/推理、探索/课程/搜索增强（§1–§20），并整合：
  - [**RL 契约与在线服务**](./RL_CONTRACT_AND_SERVICE.md) —— 玩法边界、Flask `/api/rl/*`、离线 `train.py`；**[§2.6 三条路径对照](./RL_CONTRACT_AND_SERVICE.md#26-rl-训练机制三条路径对照权威)**（离线 MCTS / 浏览器 RL / 线上）为机制事实表唯一维护处
  - [§21 RL 契约与在线服务](./ALGORITHMS_RL.md#二十一rl-契约与在线服务) —— 与上同文摘录（索引入口）
  - [§22 RL 训练监控与排障](./ALGORITHMS_RL.md#二十二rl-训练监控与排障) —— 看板数据流/趋势解读/数值稳定与裁剪
  - [§23 RL 研究：复杂度、瓶颈与文献对照](./ALGORITHMS_RL.md#二十三rl-研究复杂度瓶颈与文献对照) —— 复杂度分析/瓶颈诊断/自博弈文献对照
- [AlphaZero/MCTS 历史实验档案](./RL_ALPHAZERO_OPTIMIZATION.md) —— v6–v8.3 优化实验、消融矩阵与训练配方（独立档案，从手册交叉链接）

## 分——商业化算法

- [商业化算法手册](./ALGORITHMS_MONETIZATION.md) —— 鲸鱼分 / 规则引擎 / LTV / 广告频控
- [商业化模型架构设计](./COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 算法层扩展模块的架构与公式

## 分——决策推导架构

- [决策推导架构](./DECISION_DERIVATION_ARCHITECTURE.md) —— 决策推导管线设计

适合算法工程师、研究型贡献者和需要评估模型行为的测试角色。
