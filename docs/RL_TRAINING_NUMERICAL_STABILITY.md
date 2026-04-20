# RL 训练数值稳定与看板指标解读

> 版本：1.0 | 更新：2026-04-17  
> 对应现象：训练看板中 **Lv（价值损失）纵轴出现 10³⁰ 量级**、Lπ 剧烈抖动，而胜率/得分仍上升。

---

## 1. 根因归纳

### 1.1 单局 `train_episode` 路径（`rl_backend._rl_train_episode_inner`）

- 价值目标为 **蒙特卡洛折扣回报** \(G_t\) 与 **当前价值估计** \(V(s)\) 的 smooth L1。
- 长局、单步奖励与得分增量较大时，\(G_t\) 沿时间反向累加，**尺度可达数百～数千**；而价值头若仍接近初始化量级，**|G−V|** 很大 → `loss_value` 数值高。
- 若再配合偶发 **非有限梯度 / 异常步**，日志里可能出现极端标量，**拖垮看板纵轴比例**（即使策略仍在改善）。

### 1.2 批量 PPO 路径（`rl_pytorch/train._reevaluate_and_update`）

- 使用 **GAE** 构造优势与回报；**TD 误差** \(\delta_t = r + \gamma V_{t+1} - V_t\) 在长局、大 \(r\) 时可在时间上累积放大。
- 原实现对价值目标 `rets_np` 使用 **±1e5** 的宽松裁剪，与 **outcome 混合目标**（约 \([0,2]\)）尺度不一致时，**价值分支仍可能学在错误量级上**，表现为 Lv 尖峰或不稳定。

### 1.3 与「表现变好」不矛盾

- 策略梯度主要由 **标准化后的优势** 驱动；价值头偏差大时，**策略仍可沿奖励信号上升**。
- 但若 **Critic 长期尺度不对**，存在 **后期性能天花板或突然恶化** 的风险，故需从目标尺度与日志两侧收紧。

---

## 2. 代码侧优化（已实现）

| 位置 | 改动 |
|------|------|
| `rl_backend.py` | `RL_RETURNS_CLIP`（默认 ±512）裁剪单局 MC 回报，再算 `value_loss`。 |
| `rl_backend.py` | `_loss_scalar_for_log`：写入 `training.jsonl` 与 API 的 `loss_policy` / `loss_value` 做 **有限性检查** 与 **`RL_LOG_LOSS_CLIP`（默认 1e6）** 幅值上限。 |
| `rl_pytorch/train.py` | `RL_VALUE_TARGET_CLIP`（默认 512）裁剪批量路径上用于价值损失的回报目标。 |
| `rl_pytorch/train.py` | `RL_GAE_DELTA_CLIP`（默认 80）裁剪 GAE 的 \(\delta_t\)，抑制优势沿时间爆炸。 |
| `web/src/bot/rlTrainingCharts.js` | 绘制 Lπ/Lv 曲线时对 **超过阈值的异常点** 置为 `NaN`，避免旧日志污染纵轴（仅显示层）。 |

---

## 3. 环境变量参考

| 变量 | 默认 | 作用 |
|------|------|------|
| `RL_RETURNS_CLIP` | `512` | 单局路径：`|G|` 逐元素上限；设为 `0` 可关闭（不推荐）。 |
| `RL_VALUE_TARGET_CLIP` | `512` | 批量 PPO：价值回归目标逐元素上限；`0` 关闭 numpy 裁剪（仍经 `nan_to_num`）。 |
| `RL_GAE_DELTA_CLIP` | `80` | 批量 PPO：TD 误差裁剪后再做 GAE 递推；`0` 关闭。 |
| `RL_LOG_LOSS_CLIP` | `1e6` | 写入日志/API 的损失标量绝对值上限。 |

与现有 `RL_RETURN_SCALE`、`RL_VALUE_COEF`、`RL_GRAD_CLIP` 等可同时调节；**先调裁剪与回报尺度，再动学习率** 更安全。

---

## 4. 看板解读建议

- **Lv**：优先看 **粗线滑动平均**；若仍偶发尖峰，对照是否 **旧 JSONL** 或未重启后端（仍写旧尺度日志）。
- **Lπ**：高噪声常见；与 **熵**、**胜率** 同向则多为可接受。
- **胜率 / 得分 / 步数**：外在指标；与 Lv 解耦判断时，以「趋势 + 平台」为主。

更完整的算法背景见 `docs/RL_TRAINING_OPTIMIZATION.md`。  
**按看板曲线做全过程是否正常判断与优化清单**：见 `docs/RL_TRAINING_DASHBOARD_TRENDS.md`。
