# OpenBlock 技术说明

本文描述当前实现与数据流，与根目录 `README.md` 配合使用。

## 前端分层（`web/src`）

| 模块 | 职责 |
|------|------|
| `main.js` | 入口：挂载 `Game`（样式由 `index.html` 链入 `public/styles/main.css`） |
| `game.js` | 流程编排：开始/结束局、拖拽、计分、调用存储与可选同步 |
| `grid.js` | 棋盘、放置、整行/列消除、初始铺块 |
| `renderer.js` | Canvas 绘制与动效；`setGridSize` 与策略网格边长对齐 |
| `shapes.js` | 多连块定义与分类 |
| `config.js` | 常量、策略、成就；`getApiBaseUrl` / `isBackendSyncEnabled` / `isSqliteClientDatabase` |
| `database.js` | 经 Flask REST 写入 SQLite：会话、行为、分数、成就、回放、move 序列 |
| `api.js` | REST 客户端 |
| `services/backendSync.js` | `VITE_SYNC_BACKEND` 且非 SQLite 主存储时，额外建会话/刷 batch/结束会话；SQLite 主路径下由 `database.js` 写入，避免重复 |
| `bot/` | 无头模拟器 + 线性 REINFORCE 自博弈（`simulator.js`、`linearAgent.js`、`trainer.js`、`rlPanel.js`） |

## PyTorch RL（`rl_pytorch/`）

- **规则与方块数据**：`shared/game_rules.json`、`shared/shapes.json` 为 Web / PyTorch / MLX 共用；Python 经 `game_rules.py`、`shapes_data.py` 加载。玩法与 RL 分层说明见 **`docs/RL_AND_GAMEPLAY.md`**。
- **动力学**：`grid.py`、`simulator.py` 实现铺块、出块、计分、终局判定（须与主游戏 `Grid` 一致）。
- **特征**：`features.py` 与 `web/src/bot/features.js` 对齐；状态 ψ 为 **15 维全局统计 + 棋盘占用（maxGridWidth²）+ 待选块形状掩码（dockSlots×dockMaskSide²）**，维度见 `shared/game_rules.json` 的 `featureEncoding.stateDim`；φ(s,a) 为其与动作描述拼接。
- **模型**：`model.py` 为策略/价值**双塔残差 MLP**（Pre-LN + GELU）；对 φ(s,a) 输出各合法动作 logit，对 ψ(s) 输出 V(s)。默认隐层 **384**、策略塔 **6** 层、价值塔 **5** 层（CLI/`RL_WIDTH` 等可改）；**旧 checkpoint（22 维 φ）与新版不兼容，须重训**。
- **设备**：`python -m rl_pytorch.train --device auto|mps|cuda|cpu`。`auto` 在 **macOS 上优先 MPS**，其他系统为 CUDA → MPS → CPU。Flask `RL_DEVICE` 与 `rl_pytorch/device.py` 逻辑一致；可选 `PYTORCH_ENABLE_MPS_FALLBACK=1`、`RL_MPS_SYNC=1`（见 `.env.example`）。
- **训练**：REINFORCE + 价值基线（`smooth_l1`）；checkpoint 含 `model`/`optimizer`/`episodes`。浏览器与 `rl_backend` 可用 **`RL_RETURN_SCALE`**（默认 `0.025`）缩放蒙特卡洛回报以稳定价值头、减弱 Lv 尖峰；**`RL_ENTROPY_DECAY_EPISODES` / `RL_ENTROPY_COEF_MIN`** 对熵系数做线性衰减。详见 `rl_backend.py` 文件头与 `.env.example`。
- **浏览器对接**：Flask `rl_backend.py` 提供 `/api/rl/status`、`/api/rl/select_action`、`/api/rl/train_episode`、`/api/rl/save`、`/api/rl/load`、**`/api/rl/training_log`**（查询 `training.jsonl` 最近条目）。默认 **`RL_AUTOLOAD=1`**：若 `RL_CHECKPOINT_SAVE`（默认 `rl_checkpoints/bb_policy.pt`）已存在则**自动热加载**；`RL_SAVE_EVERY`（默认每 **100** 局）定期写回同路径，减少 I/O；**`RL_TRAINING_LOG`**（默认 `rl_checkpoints/training.jsonl`）追加 JSONL：服务启动、每局训练损失、每次 checkpoint。

## 行为与后端契约

- 本地 `logBehavior` 使用 `GAME_EVENTS` 字符串。
- 写入 Flask 时字段名为后端约定：`session_id`、`userId`、`eventType`、`data`、`gameState`、`timestamp`（毫秒；`/api/behavior/batch` 对小于 `1e12` 的值按秒兼容并乘 1000）。

## 后端要点（`server.py`）

- `DATABASE` 由环境变量 `BLOCKBLAST_DB_PATH` 覆盖。
- 模块导入末尾调用 `init_db()`，便于 `gunicorn server:app` 首次即有表结构。
- `GET /api/export` 已修复对 `user_stats` 的重复 `fetchone()` 问题。

## 测试

- `tests/grid.test.js`、`tests/config.test.js` 引用 `web/src/*`。
- Vitest 通过 `define` 注入 `import.meta.env.VITE_*`，避免在 Node 中未定义。

## 历史说明

早期 `index.html` 曾内嵌完整游戏脚本，已与 `web/src` 重复逻辑删除，避免双轨维护。
