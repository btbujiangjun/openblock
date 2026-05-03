# 训练看板：数据流与刷新机制

> 版本：1.1 | 更新：2026-05-03

## 1. 数据从哪来

| 模式 | 曲线与摘要 `#rl-dash-summary` | 左侧 RL「局数 / 均分 / 胜率 / 最佳」 |
|------|--------------------------------|--------------------------------------|
| **未勾选 PyTorch** | `browserTrainingLog.js`（localStorage 环形缓冲）；每局结束由 `appendBrowserTrainEpisode` 写入 `train_episode` | 本页会话内 `onEpisode` 累计 |
| **勾选 PyTorch** | `GET /api/rl/training_log?tail=5000` 读 `training.jsonl` 尾部；**不经过**浏览器缓冲 | 与 `onEpisode` 取 max；刷新时与 `GET /api/rl/status` 的 `episodes` 再对齐 |

请求带 `cache: 'no-store'`，避免浏览器缓存旧 JSON。

## 2. 训练中是否会自动更新

1. **每局结束** `onEpisode` → `scheduleDashRefresh()`：若勾选 **「训练中自动刷新」** 且当前在跑训练，约 **350ms** 后调用 `refreshDashboardFull()`。
2. **定时轮询** `syncChartPoll()`：同上条件时，每 **约 1.2s（浏览器）/ 1.8s（PyTorch）** 再调一次 `refreshDashboardFull()`，防止单局 debounce 遗漏。

若 **关闭**「训练中自动刷新」，则仅在点击 **「刷新图表」** 或改「最近 N 局」下拉时更新看板。

## 3.「刷新图表」做什么（`refreshDashboardFull`）

依次：

1. `refreshTrainingCharts()`：拉取日志 → `updateRlTrainingCharts` 重绘摘要条与 8 个同级面板（6 个主曲线 + 2 个 Teacher / Replay 诊断）；每个面板都有独立展开/收起按钮；**图例画在画布内右上角**（省侧栏高度），**悬停图例项**为 `cursor: help` 并更新 **`title`** 气泡。
2. 若勾选 PyTorch：`refreshServerTrainingLog()` 更新 RL 面板内 **「训练损失」** 文本预读；`syncEpisodesFromServer()` 用服务端 `episodes` 与本地 `totalEpisodes` 取 **max**，对齐左侧 **局数**。

因此按钮不仅刷新右侧看板，也保证 **局数 / 损失预读** 与 Flask 一致（尤其在空闲时手动刷新）。

## 4. 有效性自检清单

- 勾选 PyTorch、启动训练：观察摘要 **末局** 序号与 `training.jsonl` 中最新 `train_episode.episodes` 应一起增长。
- 关闭自动刷新、只点「刷新图表」：曲线与摘要应跳变为当前文件内容。
- 切换「最近 N 局」：立即重绘（同一次 `refreshDashboardFull` 链路）。
- PyTorch 批量训练 v9.3 后：若 `training.jsonl` 包含 `teacher_q_coverage` / `replay_steps` 等字段，第 7/8 个面板显示 Teacher / Replay 曲线；若字段存在但值全为 0，面板内会显示“暂无有效数据”的原因。

更细的数值与损失含义见 [RL 训练数值稳定](./RL_TRAINING_NUMERICAL_STABILITY.md)。  
**趋势判读与训练是否正常**：见 [RL 训练看板趋势](./RL_TRAINING_DASHBOARD_TRENDS.md)。

## 5. PyTorch 在线训练：lookahead 与左侧统计

- **「1-step lookahead」**（`#rl-lookahead`）：默认 **不勾选**。勾选后每步大量调用 **`eval_values`**，首局可能长时间看不到「上局 …」日志；不勾选则每步仅 **`select_action`**，局末更快结束一局。
- **左侧「局数」**：与 `onEpisode` 累计及服务端 **`GET /api/rl/status`** 的 **`episodes`** 取 **max**（见 §1），可能与「本页刚点的训练」不同步到同一零点。
- **「均分 / 胜率 / 最佳」**：主要由 **本会话内** `onEpisode` 写入的最近窗口统计；未完成第一局或窗口为空时可为 **「—」**，与局数栏是否已对齐服务端无关。

面板 **`startBatch`** 异常时会 **`finally`** 解锁按钮；错误摘要写在 **「训练进展」**。详见 [PyTorch RL 在线服务](./RL_PYTORCH_SERVICE.md) §1。
