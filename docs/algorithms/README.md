# 算法文档

出块、玩家画像、强化学习和商业化推断的算法与模型文档。

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

- [自适应出块](./ADAPTIVE_SPAWN.md)
- [出块三层架构](./SPAWN_ALGORITHM.md)
- [解法数量难度](./SPAWN_SOLUTION_DIFFICULTY.md) —— 含 §13–§14 顺序刚性 `orderRigor`
- [出块建模](./SPAWN_BLOCK_MODELING.md)
- [候选块概率图鉴](./CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md)

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
