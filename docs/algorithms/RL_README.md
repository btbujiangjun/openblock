# 强化学习文档导航

> 当前定位：本文是 RL 栏目的抽象索引，不重复维护公式和实现细节。
> 权威事实来源为 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)；若其他 RL 专题文档与其冲突，以 `ALGORITHMS_RL.md` 和代码为准。

---

## 1. 阅读入口

| 需求 | 先读 |
|------|------|
| 理解当前 RL 算法、状态/动作、奖励、网络、训练和推理 | [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) |
| 理解 RL 与玩法规则、出块、计分的边界 | [`RL_AND_GAMEPLAY.md`](./RL_AND_GAMEPLAY.md) |
| 部署或排查 `/api/rl/*`、离线训练、贪心评估 | [`RL_PYTORCH_SERVICE.md`](./RL_PYTORCH_SERVICE.md) |
| 看训练曲线、判断训练是否正常 | [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md) |
| 排查 Lv 爆炸、loss 抖动、回报尺度异常 | [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) |

---

## 2. 文档分层

### 2.1 当前权威

| 文档 | 维护内容 |
|------|----------|
| [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | PPO/GAE/辅助头/search teacher/浏览器 fallback/服务化推理的统一说明 |

### 2.2 契约与服务

| 文档 | 维护内容 |
|------|----------|
| [`RL_AND_GAMEPLAY.md`](./RL_AND_GAMEPLAY.md) | RL 与主玩法的解耦边界、共享 JSON、模拟器一致性、特征维度失效规则 |
| [`RL_PYTORCH_SERVICE.md`](./RL_PYTORCH_SERVICE.md) | Flask 在线训练、离线训练、HTTP 评估、批量 PPO 与 search replay |

### 2.3 训练观测与排障

| 文档 | 维护内容 |
|------|----------|
| [`RL_TRAINING_DASHBOARD_FLOW.md`](./RL_TRAINING_DASHBOARD_FLOW.md) | 训练看板数据从哪里来、何时刷新、如何自检 |
| [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md) | 八图趋势解读、异常研判、调参优先级 |
| [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) | 回报裁剪、GAE delta 裁剪、loss 幅值、环境变量 |

### 2.4 分析与实验记录

这些文档用于理解方案演进和历史取舍，不作为当前实现事实入口：

| 文档 | 用途 |
|------|------|
| [`RL_ANALYSIS.md`](./RL_ANALYSIS.md) | 复杂度分析、瓶颈诊断、优化候选池 |
| [`RL_BROWSER_OPTIMIZATION.md`](../archive/algorithms/RL_BROWSER_OPTIMIZATION.md) | 浏览器线性 RL fallback 的实验结论（已归档） |
| [`RL_TRAINING_OPTIMIZATION.md`](../archive/algorithms/RL_TRAINING_OPTIMIZATION.md) | 直接监督头等训练架构演进记录（已归档） |
| [`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero/MCTS 对比和搜索蒸馏思路 |

---

## 3. 维护原则

- 算法公式、网络结构、状态/动作维度、奖励口径只在 `ALGORITHMS_RL.md` 维护。
- 玩法规则、得分、形状、特征维度以 `shared/game_rules.json` 和 `shared/shapes.json` 为准。
- 看板字段和曲线口径只在 dashboard 相关文档维护。
- 历史实验文档可以保留失败原因和取舍结论，但不要把旧版本号写成当前状态。
