# 算法文档

出块、玩家画像、强化学习和商业化推断的算法与模型文档。

## 一图入门

![OpenBlock 算法架构总览：六层 + 七子模型 + 反馈闭环](./assets/algorithm-architecture.png)

- [算法架构图（设计参考 + 紧凑概念图 + 8 子图）](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md)
  —— **视图 A 设计参考稿**（上图）：六层（数据输入 / 核心模型 / 决策输出
  / 训练优化 / 支撑 / 反馈闭环）+ 七大具名子模型（PlayerProfile ·
  AbilityVector · CommercialPolicy · AdTrigger · AdInsertionRL ·
  LifecycleOrchestrator · ActionOutcomeMetrics）+ 中央融合决策引擎；
  **视图 B 紧凑概念图**：信号采集 / 算法核心 / 决策策略 / 训练监控四层
  + 反馈环；每个算法模型的内部结构、阈值与默认值都在子图里
- [算法架构图生成 Prompt](./ALGORITHM_DIAGRAM_PROMPT.md) —— 重生成视图 B
  + 8 子图的可复用 prompt 模板（含完整事实包）

## 权威手册

- [算法与模型手册](./ALGORITHMS_HANDBOOK.md) —— 总索引与符号约定
- [模型工程总览](./MODEL_ENGINEERING_GUIDE.md) —— 全部模型的工程地图
- [四模型系统设计](./MODEL_SYSTEMS_FOUR_MODELS.md) —— 启发式 / 生成式 / PyTorch RL / 浏览器 RL 四类模型
- [出块算法手册](./ALGORITHMS_SPAWN.md) —— 规则 + SpawnTransformer
- [玩家画像算法](./ALGORITHMS_PLAYER_MODEL.md) —— 玩家能力建模
- [RL 算法手册](./ALGORITHMS_RL.md) —— PPO / GAE / 网络结构 / 奖励
- [商业化算法手册](./ALGORITHMS_MONETIZATION.md) —— 鲸鱼分 / 规则引擎 / LTV / 广告频控
- [商业化模型架构设计](./COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 算法层扩展模块的架构与公式

## 出块专题

![出块算法架构图：9层流水线（输入层→染色层）](./assets/spawn-architecture.png)

> **上图速读**：`generateDockShapes` 的完整 9 层流水线——从原始棋盘状态一路到
> 候选块输出与颜色绑定。各层对应关系：
>
> | 图中层号 | 层名 | 对应文档章节 |
> |---|---|---|
> | 层 0 | 输入层（棋盘 / 策略配置 / 调度参数） | [三层架构 §2](./SPAWN_ALGORITHM.md#2-数据流) |
> | 层 1 | 盘面感知层（填充率 / 清屏机会 / 同花顺信号 / 彩蛋概率） | [自适应出块 §10.8.2](./ADAPTIVE_SPAWN.md#1082-阶段-0盘面感知) |
> | 层 2 | 评分构建层（8 维真模拟打分：缺口 / 多消 / 清屏 / 精确卡入 / 同花顺 / 空洞减少）| [自适应出块 §10.8.3](./ADAPTIVE_SPAWN.md#1083-阶段-1全形状池评分scored-构建) |
> | 层 3 | 优先选拔层（候选筛选 / 席位数量 / 选拔优先级 / 同花预算守卫）| [自适应出块 §10.8.4–§10.8.5](./ADAPTIVE_SPAWN.md#1084-阶段-2stage-1--消行优先席clearseats) |
> | 层 4 | 加权补齐层（14 维权重链：机动性 / 直接清屏 / 多消 / 同花 / 精确卡入 / PB 距段…）| [三层架构 §2.5.2 表 B](./SPAWN_ALGORITHM.md#b-决定剩下槽位选什么阶段-3-加权乘子) |
> | 层 5 | 约束验证层（最低机动性 / 顺序可解性 / 解法空间 / 最小空洞 / 九维区间 / 22 次重试）| [三层架构 §2.5.2 表 C](./SPAWN_ALGORITHM.md#c-决定3-块能不能一起出阶段-4-硬约束) · [解法数量难度](./SPAWN_SOLUTION_DIFFICULTY.md) |
> | 层 6 | 注入优化层（救援 / 压力注入替换弱槽 · 品类多样化注入减少重复）| [自适应出块 §10.8.7](./ADAPTIVE_SPAWN.md#1087-阶段-5l2-特殊形状注入_tryinjectspecial) |
> | 层 7 | 输出层（三块候选组 / 选择元数据 / 5 种选择原因标注 / 诊断快照）| [自适应出块 §10.8.9](./ADAPTIVE_SPAWN.md#1089-阶段-7输出与-dfv-标注) |
> | 层 8 | 染色层（同花顺锁色 / 三色无放回抽样 / 决策流可视化）| [自适应出块 §10.8.10](./ADAPTIVE_SPAWN.md#10810-阶段-8染色绑定gamejs) |
>
> 详细文字说明见 [自适应出块 §10.8](./ADAPTIVE_SPAWN.md#108-出块算法完整流水线v16035-代码基准)。

- [**出块算法信号透视仪**](./spawn-signal-explorer.html) —— 交互式 HTML 工具：22 个 L1 原始信号 × 30 个 L2 派生信号 × 7 个 L3 管道阶段，含 Intent 优先级矩阵、Stress 分量全表、完整链路依赖图，代码口径精确校验至 v1.61
- [自适应出块](./ADAPTIVE_SPAWN.md) —— 含 §10.8 出块算法完整流水线（v1.60.35 代码基准）
  - [§10.10.10 生命周期 × 成熟度如何作用于出块算法](./ADAPTIVE_SPAWN.md#101010-生命周期--成熟度如何作用于出块算法)
    —— S0–S4 × M0–M4 的 25 格 stress cap/adjust 调制矩阵、SkillScore 7 维计算公式、
    onboarding 硬覆写与 winback 保护包三条接入路径、完整影响链图解与典型示例
- [出块三层架构](./SPAWN_ALGORITHM.md) —— 三层架构 + 5 阶段流水线 + 30+ 加权乘子 + 硬约束表
- [解法数量难度](./SPAWN_SOLUTION_DIFFICULTY.md) —— 含 §13–§14 顺序刚性 `orderRigor`
- [出块建模](./SPAWN_BLOCK_MODELING.md)
- [候选块概率图鉴](./CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md)
- [**出块算法架构图生成 Prompt**](./SPAWN_DIAGRAM_PROMPT.md) —— 喂给大模型即生成
  `generateDockShapes` 9 层流水线 PNG 架构图（事实包 + 视觉规范 + 自检清单）

## RL 专题

- [RL 文档导航](./RL_README.md)
- [玩法与 RL 解耦](./RL_AND_GAMEPLAY.md)
- [PyTorch RL 服务与评估](./RL_PYTORCH_SERVICE.md)
- [RL 训练数值稳定](./RL_TRAINING_NUMERICAL_STABILITY.md)
- [RL 看板数据流与刷新机制](./RL_TRAINING_DASHBOARD_FLOW.md)
- [RL 看板趋势解读](./RL_TRAINING_DASHBOARD_TRENDS.md)
- [AlphaZero 优化方案](./RL_ALPHAZERO_OPTIMIZATION.md)
- [自博弈文献对照与 OpenBlock 适配](./RL_SELF_PLAY_LITERATURE_COMPARISON.md)
- [RL 复杂度与瓶颈研究](./RL_ANALYSIS.md)

历史 sprint 分析（v9.x 平台期诊断、训练优化清单、浏览器优化、自博弈路线图）已收敛
到 [`../archive/algorithms/`](../archive/algorithms/)，保留作演进背景，不作为当前
事实入口。

适合算法工程师、研究型贡献者和需要评估模型行为的测试角色。
