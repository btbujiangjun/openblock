# RL v9.1 深度分析

> **来源**：由 Canvas `rl-v9-1-deep-analysis.canvas.tsx` 转换。  
> **定位**：分析 RL v9.1 在 400-500 分平台期的根因排序、风险登记和下一轮实验路线。

---

## 1. 主诊断

当前代码已经补强 ranked reward、3-ply teacher、visit_pi 蒸馏和配对 seed，但更深层瓶颈是：

- 策略观测不到颜色 bonus，导致同色整线 bonus 无法被稳定规划。
- 评估门控语义可能过松，训练指标改善不一定等价于真实得分突破。

| 指标 | 数值 |
|------|------|
| P0 阻塞风险 | 2 |
| P1 实现 / 建模风险 | 3 |
| 下一步实验 | 5 |
| 最高杠杆特征改动 | 颜色信息 |

---

## 2. 风险登记

| 等级 | 风险 | 为什么重要 | 下一步动作 |
|------|------|------------|------------|
| P0 | 颜色信息缺失 | 状态只编码占用和形状，不编码棋盘/候选块颜色；同色整线 bonus 无法被策略稳定预判 | 新增颜色通道或行列同色摘要，重训对比 bonus 率与 avg score |
| P0 | EvalGate 语义过松 | `winRatio=0.55` 当前实现是 candidate >= baseline × 0.55，不是候选超过基线 55% 或配对胜率 55% | 改用配对分差、配对胜率或置信区间作为晋级依据 |
| P1 | 价值目标高分段饱和 | `score/threshold` clip 到 2；400-500 分接近上限，value 对更高分的辨别变钝 | 尝试 log-score target 或更高上限，并消融 `outcomeValueMix` |
| P1 | Feasibility 监督过弱 | 只判断每块各自有位置，不判断是否存在三块顺序可全部放完 | 加入三块 DFS 可解叶子数或序贯可行性辅助头 |
| P1 | 3-ply r3 打包脆弱 | 用 `STATE_FEATURE_DIM` 首行存 `r3_arr`；第三层合法动作数超过 162 时有异常风险 | 改成独立 `r3` list 与 `ns3` batch，避免隐式维度耦合 |

---

## 3. 行业对齐

单人 puzzle 的 AlphaZero-like 方法通常需要：

- Ranked Reward。
- Policy-guided MCTS。
- Value normalization。
- 将 visit counts 作为直接策略目标。

OpenBlock 已覆盖 ranked reward 和 visit_pi，但仍缺：

- 单人分数任务里的 value normalization 校准。
- 颜色 bonus 的可观测表示。
- 三块序贯可行性的显式监督。

---

## 4. 指标陷阱

`qdst`、`vpi`、`rr` 下降或转正，只表示模型更贴近 teacher 或历史分位，不保证绝对分数提升。

下一轮评估应同时观察：

- 同 seed 配对分差。
- p90 / p95。
- bonus 率。
- 死局前序贯可解性。
- 高压局的 leaf count。

---

## 5. 实验路线

| 顺序 | 实验 | 改动 | 决策信号 |
|------|------|------|----------|
| A | 只修评估 | EvalGate 改配对分差；离线同 seed 比 candidate/base | 排除“日志 PASS 但棋力没涨” |
| B | 颜色特征消融 | 占用特征 + 颜色摘要 vs 多通道颜色 one-hot | 验证同色 bonus 是否是 400+ 天花板主因 |
| C | 价值目标消融 | `outcomeMix` 0.3/0.5/0.7，score clip 2/4/log | 看 p90/p95 是否先于 avg100 抬升 |
| D | Teacher 可靠性 | 2-ply、3-ply、MCTS 50 sims 分别训练；记录 teacher entropy、top1 margin | 区分搜索弱、蒸馏弱、策略吸收弱 |
| E | 序贯可行性 | 现 feasibility vs DFS leaf count 辅助头 | 降低“各块都能放但顺序死局”的误导 |

---

## 6. 优先级建议

1. 先修 EvalGate 语义，确保晋级门槛真实反映棋力。
2. 补颜色表示并做消融，验证 bonus-aware 是否突破 400-500 平台期。
3. 引入序贯可行性辅助头，避免三块规划被单块可放性误导。
4. 扩充训练日志的 teacher 质量指标，为后续 MCTS/beam 调参提供依据。

