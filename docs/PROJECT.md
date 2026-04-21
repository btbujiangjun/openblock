# OpenBlock 技术总览

本文描述当前实现与数据流，与根目录 `README.md` 配合使用。

## 前端分层（`web/src`）

| 模块 | 职责 |
|------|------|
| `main.js` | 入口：挂载 `Game`（样式由 `index.html` 链入 `public/styles/main.css`） |
| `game.js` | 流程编排：开始/结束局、拖拽、计分、调用存储与可选同步 |
| `grid.js` | 棋盘、放置、整行/列消除、初始铺块 |
| `renderer.js` | Canvas 绘制与动效；`setGridSize` 与策略网格边长对齐 |
| `shapes.js` | 多连块定义与分类（数据见 `shared/shapes.json`：含 1×4/1×5 长条、五连 L 四朝向等；与 `rl_pytorch/shapes_data.py` 共用） |
| `config.js` | 常量、策略、成就；`getApiBaseUrl` / `isBackendSyncEnabled` / `isSqliteClientDatabase` |
| `database.js` | 经 Flask REST 写入 SQLite：会话、行为、分数、成就、回放、move 序列 |
| `api.js` | REST 客户端 |
| `services/backendSync.js` | `VITE_SYNC_BACKEND` 且非 SQLite 主存储时，额外建会话/刷 batch/结束会话；SQLite 主路径下由 `database.js` 写入，避免重复 |
| `bot/` | 无头模拟器 + 线性 REINFORCE 自博弈（`simulator.js`、`linearAgent.js`、`trainer.js`、`rlPanel.js`） |
| `bot/blockSpawn.js` | 出块执行层：接受策略权重 + `spawnHints`，生成三连块（含 solvability 验证） |
| `playerProfile.js` | 玩家实时能力画像：滑动窗口行为追踪 → 多维技能 + 状态信号（心流 / 节奏 / 挫败 / 差一点） |
| `adaptiveSpawn.js` | 自适应出块策略引擎：**10 信号融合** → stress → 10 档 profile 插值 + spawnHints。详见 **`docs/ADAPTIVE_SPAWN.md`** |
| `playerInsightPanel.js` | 左侧玩家画像 UI；投放区指标文案与悬停说明见 **`docs/PANEL_PARAMETERS.md`** §4 |
| `difficulty.js` | 原有 score→stress 难度映射（被 `adaptiveSpawn.js` 内部调用） |

## PyTorch RL（`rl_pytorch/`）

- **规则与方块数据**：`shared/game_rules.json`、`shared/shapes.json` 为 Web / PyTorch / MLX 共用；Python 经 `game_rules.py`、`shapes_data.py` 加载。玩法与 RL 分层说明见 **`docs/RL_AND_GAMEPLAY.md`**。
- **动力学**：`grid.py`、`simulator.py` 实现铺块、出块、计分、终局判定（须与主游戏 `Grid` 一致）。
- **特征**：`features.py` 与 `web/src/bot/features.js` 对齐；状态 ψ 为 **15 维全局统计 + 棋盘占用（maxGridWidth²）+ 待选块形状掩码（dockSlots×dockMaskSide²）**，维度见 `shared/game_rules.json` 的 `featureEncoding.stateDim`；φ(s,a) 为其与动作描述拼接。
- **模型**：`model.py` 为策略/价值**残差 MLP**（Pre-LN + GELU）；split 双塔对 φ(s,a) 打分、shared 主干对 ψ(s) 与动作嵌入融合；对 ψ(s) 输出 V(s)。CLI/`RL_*` 默认隐层 **256**、深度 **4**、`--arch shared`（旧 checkpoint 可能为 384/双塔，以 meta 为准）；**旧 checkpoint（22 维 φ）与新版不兼容，须重训**。
- **设备**：`python -m rl_pytorch.train --device auto|mps|cuda|cpu`。`auto` 在 **macOS 上优先 MPS**，其他系统为 CUDA → MPS → CPU。Flask `RL_DEVICE` 与 `rl_pytorch/device.py` 逻辑一致；可选 `PYTORCH_ENABLE_MPS_FALLBACK=1`。**MPS 吞吐**：`apply_throughput_tuning`（`set_float32_matmul_precision('high')`）与 `adam_for_training`（优先 `foreach=True`）在 `train.py` 与 `rl_backend` 初始化时启用；`RL_MPS_SYNC=1` 仅用于多线程/调试，默认关闭以利吞吐（见 `.env.example`）。
- **训练**：REINFORCE + 价值基线（`smooth_l1`）；`train.py` 默认 GAE；checkpoint 含 `model`/`optimizer`/`episodes`。浏览器与 `rl_backend` 可用 **`RL_RETURN_SCALE`**（默认 `0.032`）缩放蒙特卡洛回报以稳定价值头、减弱 Lv 尖峰；**`RL_ENTROPY_DECAY_EPISODES` / `RL_ENTROPY_COEF_MIN`** 对熵系数做线性衰减。详见 `rl_backend.py` 文件头与 `.env.example`。
- **浏览器对接**：Flask `rl_backend.py` 提供 `/api/rl/status`、`/api/rl/select_action`、`/api/rl/train_episode`、`/api/rl/save`、`/api/rl/load`、**`/api/rl/training_log`**（查询 `training.jsonl` 最近条目）。默认 **`RL_AUTOLOAD=1`**：若 `RL_CHECKPOINT_SAVE`（默认 `rl_checkpoints/bb_policy.pt`）已存在则**自动热加载**；`RL_SAVE_EVERY`（默认每 **100** 局）定期写回同路径，减少 I/O；**`RL_TRAINING_LOG`**（默认 `rl_checkpoints/training.jsonl`）追加 JSONL：服务启动、每局训练损失、每次 checkpoint。

## 行为与后端契约

- 本地 `logBehavior` 使用 `GAME_EVENTS` 字符串。
- 写入 Flask 时字段名为后端约定：`session_id`、`userId`、`eventType`、`data`、`gameState`、`timestamp`（毫秒；`/api/behavior/batch` 对小于 `1e12` 的值按秒兼容并乘 1000）。

## 后端要点（`server.py`）

- `DATABASE` 由环境变量 `OPENBLOCK_DB_PATH` 覆盖。
- 模块导入末尾调用 `init_db()`，便于 `gunicorn server:app` 首次即有表结构。
- `GET /api/export` 已修复对 `user_stats` 的重复 `fetchone()` 问题。

## 测试

- `tests/grid.test.js`、`tests/config.test.js` 引用 `web/src/*`。
- Vitest 通过 `define` 注入 `import.meta.env.VITE_*`，避免在 Node 中未定义。

## 商业化子系统（`web/src/monetization/`）

完整设计见 **[`docs/MONETIZATION.md`](./MONETIZATION.md)**（v3，唯一事实来源）。

| 模块 | 职责 |
|------|------|
| `index.js` | 商业化插件总入口：`initMonetization(game)` 串联所有子模块 |
| `MonetizationBus.js` | 事件总线：包装 `game.logBehavior`，解耦观察与核心逻辑 |
| `featureFlags.js` | 功能开关（`localStorage` 持久化）；广告/IAP 默认关，任务/排行榜/通行证默认开 |
| `adAdapter.js` | 广告适配层（Stub / 真实 SDK 热插拔） |
| `adTrigger.js` | 广告触发器：`game_over` 插屏；`no_clear` 近失/挫败激励 |
| `iapAdapter.js` | IAP 适配层（Stub / 真实支付 SDK 热插拔） |
| `dailyTasks.js` | 每日三任务系统 |
| `leaderboard.js` | 在线日榜 |
| `seasonPass.js` | 30 天赛季通行证（XP 估算 = `score×0.12 + clears×1.5`，min 10） |
| `pushNotifications.js` | Web Push 召回通知 |
| `replayShare.js` | 游戏结束分享 |
| `personalization.js` | 个性化引擎：拉取后端用户画像 + 实时信号 → 商业策略 |
| `commercialInsight.js` | 将商业策略区块注入玩家画像面板 `#player-insight-panel` |
| `monPanel.js` | 右下角「商业化训练面板」浮层（总览/画像/模型配置/Flag 开关） |

**后端**：`monetization_backend.py`（Flask Blueprint）提供 `/api/mon/*` 路由：  
`GET /api/mon/user-profile/<userId>`、`GET /api/mon/aggregate`、  
`GET|PUT /api/mon/model/config`、`POST /api/mon/strategy/log`。

---

## 文档索引

全部 21 份文档的导航与权威说明见 **[`docs/README.md`](./README.md)**。

---

## 历史说明

早期 `index.html` 曾内嵌完整游戏脚本，已与 `web/src` 重复逻辑删除，避免双轨维护。
