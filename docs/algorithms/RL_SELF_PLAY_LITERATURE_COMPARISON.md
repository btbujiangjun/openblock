# 自博弈 RL 文献对照与 OpenBlock 适配

> **来源**：由 Canvas `rl-self-play-literature-comparison.canvas.tsx` 转换。  
> **定位**：将 OpenBlock RL 与 AlphaZero、MuZero、Ranked Reward、Expert Iteration、Gumbel AlphaZero 等游戏自博弈路线横向对照，明确应借鉴和应暂缓的方向。

---

## 1. 核心结论

OpenBlock 已经接近 AlphaZero / Expert Iteration 的轻量工程版本：有搜索 teacher、visit/Q 蒸馏、Ranked Reward 和 EvalGate。真正差距在单人分数游戏特有的：

- Value / Q 归一化。
- 随机出块建模。
- 困难样本重放。
- Bonus-aware 表示。

| 指标 | 数值 |
|------|------|
| 评审算法家族 | 8 |
| 已部分实现 | 3 |
| 最高杠杆缺口 | 2 |
| 低优先家族 | 1 |

---

## 2. 算法适配矩阵

| 算法家族 | 最适合场景 | 核心思想 | OpenBlock 适配 | 对照结论 |
|----------|------------|----------|----------------|----------|
| AlphaZero | 双人完美信息 | MCTS + policy/value + visit CE + eval gate | 已具备一部分 | 已有 visit_pi CE、EvalGate、MCTS 可选；但仍是 PPO 混合训练，不是纯 AZ policy iteration |
| MuZero | 未知规则 / Atari | 学习 dynamics/reward/value/policy 供搜索 | 低优先 | OpenBlock 有精确 simulator；更适合把 spawn 随机性做 chance model，而非完整 MuZero |
| Ranked Reward R2 | 单人稀疏分数 | 滑动窗口分位奖励，把单人任务变成相对自博弈 | 已实现 | 已加 p50→p70 爬坡；后续关注绝对分与 ranked 指标是否背离 |
| Single-player MCTS / SameGame | 单人 puzzle | 单人 value normalization、max backup、policy-guided search | 高度相关 | 当前缺少明确的单人 Q/value normalization，这是分数上探的关键缺口 |
| Expert Iteration | 搜索专家 + 网络学生 | 搜索生成更强标签，网络蒸馏，再反哺搜索 | 高度相关 | 当前 q/visit 蒸馏是 ExIt-lite；应加入 replay buffer 和蒸馏退火 |
| Gumbel AlphaZero | 少模拟高效搜索 | 无放回采样 + Q policy improvement，少量 simulation 仍有效 | 高性价比 | 适合 OpenBlock 每步动作多、预算有限；可替代部分 root visit 逻辑 |
| Policy/Search Distillation | 工程化搜索蒸馏 | 把 MCTS/beam 分布压进快速策略 | 已部分实现 | 需要 teacher 质量监控、entropy/margin、分阶段降低蒸馏权重 |
| Dreamer / World Models | 视觉 / 未知动态任务 | 学习 latent world model 并 imagination RL | 中低优先 | 完整世界模型不划算；可借鉴 reward/value transform 与随机出块建模 |

---

## 3. 现在应借鉴的内容

| 来源 | 借鉴点 | OpenBlock 落地方式 |
|------|--------|--------------------|
| Single-player MCTS | 对无界分数做归一化，把搜索值视为下界式改进 | 对 beam/MCTS Q 做 per-state rank、z-score 或 softmax 温度校准 |
| Expert Iteration | 搜索标签成为可复用训练集，不只作为临时 batch 信号 | 建立 search-improved replay buffer，并按困难状态重放 |
| Gumbel AlphaZero | 小预算下提高 root action 选择质量 | 在根节点采样 top actions 后做少量 Q 评估 |
| Ranked Reward | 单人任务用滚动分位制造相对进步信号 | 继续保留 p50→p70 爬坡，但同时监控绝对分 |
| Policy/Search Distillation | 快策略吸收慢搜索能力 | 记录 teacher entropy、Q margin、覆盖率，逐步退火蒸馏权重 |

---

## 4. 当前应避免的内容

- 不宜完整替换为纯 AlphaZero：单人分数任务没有双人胜负结构，且每步动作多，纯 MCTS policy iteration 成本高。
- 不宜直接做完整 MuZero / Dreamer：OpenBlock 有精确 simulator 和低维结构化状态，完整世界模型投入产出比偏低。
- 不宜让 teacher 永久主导训练：搜索标签应帮助突破平台期，后续要降低蒸馏权重，避免策略只模仿固定搜索偏差。

---

## 5. 推荐路线

| 优先级 | 优化 | 实现 | 预期效果 |
|--------|------|------|----------|
| 1 | 单人搜索值归一化 | 对 beam/MCTS Q 做 per-state z-score、rank 或 softmax 温度校准 | 减少 teacher/value 标度错位，提升高分段信号 |
| 2 | ExIt 化训练缓存 | 保留 search-improved targets，按困难/高分/失败前状态重放 | 提升样本效率，不只依赖最新 batch |
| 3 | Gumbel root improvement | 根节点采样 top actions 后做小预算 Q 评估 | 少模拟下提升 root policy target 质量 |
| 4 | Chance-aware dock refill | dock 放完前后加入 spawn predictor 或多样本期望 | 降低对已知当前三块的过拟合 |
| 5 | Bonus-aware 表示升级 | 从颜色摘要进到行列同色进度 / 颜色平面 | 提高同色 bonus 命中率和 600+ 上限 |
| 6 | 稳健评估套件 | 固定 seed、分位数、bonus 率、死亡前 leaf_count、gate A/B | 避免指标好看但真实分不涨 |

---

## 6. 评估注意事项

- 评估要同时看绝对分、分位排名、bonus 率、死局前可解叶子数。
- 搜索 teacher 的 entropy 太低可能过拟合，太高可能没有指导性。
- replay buffer 要记录 teacher 版本和样本年龄，避免旧 teacher 污染新策略。
- 单人分数任务的 value 不应简单照搬双人胜负 value 标度。

