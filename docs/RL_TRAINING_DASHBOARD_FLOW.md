# 训练看板：数据流与刷新机制

> 版本：1.0 | 更新：2026-04-17

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

1. `refreshTrainingCharts()`：拉取日志 → `updateRlTrainingCharts` 重绘摘要条与六条曲线。
2. 若勾选 PyTorch：`refreshServerTrainingLog()` 更新 RL 面板内 **「训练损失」** 文本预读；`syncEpisodesFromServer()` 用服务端 `episodes` 与本地 `totalEpisodes` 取 **max**，对齐左侧 **局数**。

因此按钮不仅刷新右侧看板，也保证 **局数 / 损失预读** 与 Flask 一致（尤其在空闲时手动刷新）。

## 4. 有效性自检清单

- 勾选 PyTorch、启动训练：观察摘要 **末局** 序号与 `training.jsonl` 中最新 `train_episode.episodes` 应一起增长。
- 关闭自动刷新、只点「刷新图表」：曲线与摘要应跳变为当前文件内容。
- 切换「最近 N 局」：立即重绘（同一次 `refreshDashboardFull` 链路）。

更细的数值与损失含义见 `docs/RL_TRAINING_NUMERICAL_STABILITY.md`。  
**趋势判读与训练是否正常**：见 `docs/RL_TRAINING_DASHBOARD_TRENDS.md`。
