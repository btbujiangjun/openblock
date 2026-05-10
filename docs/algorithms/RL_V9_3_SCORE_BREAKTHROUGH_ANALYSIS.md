# RL v9.3 提分深度分析

> **来源**：由 Canvas `rl-v9-3-score-breakthrough-analysis.canvas.tsx` 转换。  
> **定位**：分析 v9.3 改造后下一阶段提分瓶颈，重点关注 replay 新鲜度、默认 beam teacher、目标尺度监控和评估口径。

---

## 1. 当前判断

当前改造已经把“搜索 teacher 能力”接入训练。下一阶段瓶颈会转向：

- Teacher 样本是否新鲜。
- 默认 beam 是否足够强。
- 评估指标是否衡量真实部署能力。

| 指标 | 数值 |
|------|------|
| 主要瓶颈 | 5 |
| 最高优先实验 | 2 |
| 下一步实现风险 | 低 |
| 预期算力增量 | 中 |

---

## 2. 已改善点

| 方向 | 说明 |
|------|------|
| 训练信号分工 | Replay 样本已从 PPO policy ratio 中剥离，方向正确 |
| Q 归一化 | Q 归一化加入 `minStd` 后，近似平局动作不再被 z-score 过度尖锐化 |
| EvalGate | 多 rounds 降低了 seed 偶然性，但也提高评估成本 |

---

## 3. 仍需验证的点

| 风险 | 说明 |
|------|------|
| 默认 MCTS 关闭 | 因此 riskAdaptive MCTS 不是日常训练的主要收益来源 |
| Replay 样本变旧 | Replay 仍可能携带旧 ranked reward 和旧 teacher Q，样本价值随训练推进衰减 |
| 颜色奖励归因 | 颜色特征已可观测，但缺少显式 bonus 规划监督 |

---

## 4. 瓶颈矩阵

| 瓶颈 | 优先级 | 原因 | 建议 |
|------|--------|------|------|
| Replay 目标新鲜度 | 中高 | 旧轨迹不再进 PPO 是正确的，但 value 的 GAE 半边、ranked reward、teacher Q 仍可能来自旧分布 | Replay 改成 outcome-only value，或对 replay 的 ranked reward 重新计算 |
| Teacher 覆盖率 | 高 | 默认仍是 3-ply beam；MCTS riskAdaptive 只有启用 MCTS 才生效。早期探索步也没有 teacher 监督 | 为 beam 增加风险自适应宽度，并允许早期动作只蒸馏不强制采样 |
| 目标尺度监控 | 中 | Q zscore + minStd 已防噪声尖锐化，但没有记录 target entropy / top1 margin | 训练日志加入 teacher entropy、Q std、top1-top2 margin |
| 评估口径 | 中 | EvalGate 是纯 policy 贪心；如果实际 bot 推理带 lookahead，门控可能低估候选 | 增加 policy-only 与 policy+search 两套评估指标 |
| 颜色奖励归因 | 中 | 颜色特征已加入，但 reward/aux 没有单独预测同色清除潜力 | 增加 bonus-line auxiliary 或 color-clear head |

---

## 5. 训练信号拆解

| 信号 | 应参与样本 | 分析 |
|------|------------|------|
| PPO policy | 只吃当前 batch | 保持 on-policy，避免 replay ratio 偏差 |
| Value loss | 当前 batch + replay | 建议 replay 切 outcome-only，减少旧轨迹 GAE 偏差 |
| Q distillation | 当前 batch + replay | 适合 replay，但要监控 teacher entropy 与 stale teacher 年龄 |
| visit_pi distillation | MCTS batch + replay | 默认 MCTS 关闭，短期不是主要贡献源 |
| Ranked Reward | 当前 batch 终局步 | 不建议直接重放旧 ranked reward，应按当前历史窗口刷新或只用于 on-policy |

---

## 6. 下一批实验优先级

| ID | 实验 | 改动 | 预期收益 | 风险 |
|----|------|------|----------|------|
| E1 | Replay outcome-only | 把 replay 的 value target 改为纯 outcome，禁用 replay GAE 与旧 ranked reward | 降低 off-policy value 噪声，稳定吸收困难局 | 低 |
| E2 | Beam risk adaptive | 在高填充/低 mobility 局面动态提高 3-ply topK/topK2 | 默认配置即可生效，比 MCTS 成本更可控 | 中 |
| E3 | Teacher metrics | 记录 Q std、target entropy、visit entropy、teacher coverage | 先判断 teacher 是太尖、太平，还是覆盖不足 | 低 |
| E4 | Gate dual eval | EvalGate 同时输出 raw policy 与 policy+search 指标 | 避免好策略因评估口径错位被误判 | 中 |
| E5 | Bonus auxiliary | 预测下一步/两步是否存在同色整线 bonus 机会 | 把颜色特征转成可学习的中间目标 | 中高 |

---

## 7. v10 已落地实现

| 改动 | 实现位置 | 说明 |
|------|----------|------|
| Replay outcome-only | `rl_pytorch/train.py` | replay 轨迹不参与 policy gradient，value target 使用终局 outcome，降低 off-policy GAE 噪声 |
| Teacher metrics | `rl_pytorch/train.py` | 日志输出 `teacher_q_coverage/std/margin/entropy`、`teacher_visit_*`、`replay_age` |
| Beam risk adaptive | `rl_pytorch/train.py` + `shared/game_rules.json` | 高填充、低 mobility、低 leaf count 时提高 3-ply `topK/topK2/maxActions` |
| Bonus auxiliary | `rl_pytorch/model.py`、`rl_pytorch/simulator.py`、`rl_pytorch/train.py` | Conv 模型新增 `bonus_clear_head`，监督是否触发同 icon / 同色 bonus line |
| Dual EvalGate | `rl_pytorch/eval_gate.py` | 输出 `policy_only` 与 `policy_search` 两套评估，并在 `round_metrics` 记录固定 seed bucket 分数差 |

这些改动默认保持旧 checkpoint 可加载：训练恢复使用 `strict=False`，新增 head 缺失权重时从随机初始化开始。

---

## 7. 建议下一步

优先实现 **E1 + E3**：

- 将 replay value 改成 outcome-only。
- 增加 teacher entropy、Q std、replay steps 的日志。
- 用最小代码风险确认平台期来自 teacher 太弱、蒸馏目标太噪，还是 replay 样本变旧。

这组改动风险低，能直接提升可观测性，并为 beam/MCTS 调参提供依据。

