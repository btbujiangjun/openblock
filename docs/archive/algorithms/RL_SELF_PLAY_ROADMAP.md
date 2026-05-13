# OpenBlock RL 自博弈提升路线图

> **来源**：由 Canvas `rl-self-play-roadmap.canvas.tsx` 转换。  
> **定位**：解释 400-500 分平台期的工程诊断，并给出搜索增强、Ranked Reward、困难样本和评估门控的训练路线。

---

## 1. 核心诊断

400-500 分平台期不主要是网络规模问题，而是 **搜索目标、信用分配和课程设计** 问题。OpenBlock 是单人三块规划 puzzle，因此下一步最强杠杆不是纯 policy-gradient rollout，而是从搜索改进后的决策中训练策略。

| 指标 | 数值 |
|------|------|
| 棋盘 | 8×8 |
| 每轮候选块 | 3 |
| 常见合法动作 | 30-80 |
| 首要路线 | 搜索 teacher 优先 |

---

## 2. 行业方法映射

| 方法 | 核心思想 | OpenBlock 适配性 |
|------|----------|------------------|
| AlphaZero / Neural MCTS | Policy-value network + search-improved target | 适合离散规划；成本高但样本效率好 |
| Ranked Reward | 用分位排名作为单人任务自博弈奖励 | 适合分数平台期，把 400-500 分变成相对阶梯 |
| Beam Search + Q Distillation | 用浅层搜索生成监督策略目标 | 最适合 OpenBlock 三块回合结构的第一步 |
| Offline Imitation / DAgger | 从 solver/beam 轨迹启动，再在线改进 | 快速 bootstrap，降低随机策略冷启动成本 |
| Hybrid Offline-Online RL | 重放强轨迹并继续 PPO/AWAC 式微调 | 稳定更新，同时保留探索能力 |

---

## 3. 平台期诊断

| 原因 | 为什么伤害训练 | 最佳响应 |
|------|----------------|----------|
| 短视野 | 单动作选择忽略剩余 dock pieces | 2-ply / 3-ply beam target |
| 高价值事件稀疏 | 多消和 bonus 罕见，得分梯度弱 | Ranked Reward + curriculum buckets |
| Value 噪声 | GAE 依赖不完美 V；平台期 advantage 小 | 辅助头和搜索标签 |
| 分布差异 | 训练 spawn 与玩家侧 adaptive spawn 不完全一致 | 固定 seed 套件和 stress buckets 评估 |
| 吞吐限制 | 枚举合法动作和模拟成本高 | 缓存 action features；beam prune top-K |

---

## 4. 推荐训练闭环

1. 在不同填充率和压力桶中生成固定 seed 与随机 seed。
2. 对每个状态，针对剩余 dock pieces 运行 2-ply 或 3-ply beam。
3. 将 beam 分数转换为 policy distillation 的软目标分布。
4. 使用带辅助头的 PPO 训练，但用搜索标签锚定 policy 更新。
5. 仅当 checkpoint 在固定 seed 套件上超过 baseline 时晋级。

---

## 5. 实现优先级

| 优先级 | 改动 | 具体做法 | 预期效果 |
|--------|------|----------|----------|
| P0 | Three-piece beam teacher | 枚举三块序列并剪枝；用搜索分布训练 policy | 突破短视野平台期 |
| P1 | Ranked Reward ladder | 奖励 = 当前分数相对同 curriculum 滚动缓冲区的分位 | 让 400-500 分不再是平信号 |
| P2 | Value target split | 分别学习 survival、next-round mobility、score potential、outcome | 降低 advantage 噪声 |
| P3 | Hard-state replay | 过采样高填充、高 regret、濒死状态 | 学会决定高分上限的关键决策 |
| P4 | Eval gate | 只晋级固定 seed 上击败 baseline 的 checkpoint | 防止噪声 PPO 回归 |

---

## 6. 工程落地原则

- 搜索 teacher 先用 beam，不急于全量 MCTS。
- 蒸馏目标必须记录 entropy、top1 margin 和覆盖率。
- Ranked Reward 要与绝对分数一起看，防止相对分位提升但真实分不涨。
- 固定 seed 评估要覆盖低压、中压、高压、濒死和高 bonus 窗口。
- 训练日志要区分 policy-only 和 policy+search 的部署口径。

---

## 7. 当前实现状态

| 路线 | 状态 | 工程说明 |
|------|------|----------|
| 搜索 teacher | 已实现 | 2-ply / 3-ply beam、MCTS visit pi、Q distillation 均已接入 |
| 困难样本 replay | 已实现并降噪 | replay 样本只保留 outcome value 监督，不再复用旧策略优势 |
| Teacher 诊断 | 已实现 | 覆盖率、Q std、top1-top2 margin、entropy 和 replay age 进入日志 |
| Beam risk adaptive | 已实现 | 风险局面扩展 beam 宽度，普通局保持吞吐 |
| Bonus/color auxiliary | 已实现 | Conv policy-value 网络新增 bonus clear 辅助头 |
| EvalGate 双口径 | 已实现 | 同 seed bucket 同时输出 policy-only 与 policy+search 指标 |

