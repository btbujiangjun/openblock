# SQLite 数据库模式说明

> 版本：1.1 | 事实来源：`server.py`（`init_db` / `_migrate_schema`）、`monetization_backend.py`（`mon_*`）  
> 前端读写：`web/src/database.js` → Flask `/api/*`

本文描述仓库默认持久化使用的 **单文件 SQLite** 库：表结构、用途、主要 HTTP 入口及表间关系。**第 3 章**补充各字段**内容格式、业务含义与 JSON 示例**；**第 4 章**为核心表**列级速查**，便于直连 SQLite 排障或与前端结构对照。

---

## 1. 数据库文件与连接

| 项 | 说明 |
|----|------|
| **默认路径** | 仓库根目录 `openblock.db`（与 `server.py` 同目录层级约定） |
| **环境变量** | `OPENBLOCK_DB_PATH`（或兼容旧名 `BLOCKBLAST_DB_PATH`）覆盖路径 |
| **连接配置** | `PRAGMA journal_mode=WAL`、`busy_timeout=5000`（降低锁冲突） |
| **访问方式** | 浏览器经 `getApiBaseUrl()` 请求 Flask；**勿**在生产环境对公网暴露原始 SQL 调试接口（见 `OPENBLOCK_DB_DEBUG`） |

商业化模块 `init_mon_db()` 使用同一 `OPENBLOCK_DB_PATH` 解析规则下的文件（未配置时默认亦为仓库根 `openblock.db`），与主应用共用一套库文件。

---

## 2. 表一览（按职责）

### 2.1 核心游戏与行为（`server.py` · `init_db`）

| 表名 | 用途摘要 |
|------|-----------|
| **sessions** | 一局游戏的会话根实体：用户、策略、时间、分数、状态、`game_stats` JSON 等 |
| **behaviors** | 细粒度行为事件（放置、未消行等），关联 `session_id` |
| **scores** | 每次上报的分数流水，供排行榜类聚合 |
| **user_stats** | 每用户一行聚合统计（总局数、最高分、总时长、消除数等） |
| **achievements** | 成就解锁：`PRIMARY KEY (user_id, achievement_id)` |
| **replays** | 兼容路径：保存与 `behaviors` 同源的「事件 tail」JSON；**非**Deterministic 回放主存储 |
| **skill_wallets** | 技能包 / 钱包等业务 JSON，`payload` + `updated_at` |
| **browser_rl_linear_agents** | 浏览器线性 RL 权重：`user_id` 主键，`payload` 为 `{ W, Vw }` JSON；API `GET/PUT /api/rl/browser-linear-agent` |
| **move_sequences** | **回放主数据**：`frames`（落子序列）+ 可选 `analysis`（复盘摘要），`session_id` 主键 |

### 2.2 客户端与拓展

| 表名 | 用途摘要 |
|------|-----------|
| **client_strategies** | 客户端持久化的策略条目（如 RL 策略配置），`PRIMARY KEY (id, user_id)` |

### 2.3 按需创建（首次相关 API 调用时建表）

| 表名 | 用途摘要 |
|------|-----------|
| **ab_events** | A/B 实验上报：`experiment`、`bucket`、`event`、`meta` |
| **season_pass** | 赛季通行证进度：`progress` / `completed` JSON、`points`、`premium` 等 |

### 2.4 商业化（`monetization_backend.py`，前缀 `mon_`）

仅在商业化 Blueprint 成功挂载且执行过 `init_mon_db()` 后出现；与核心表**同一数据库文件**。

| 表名 | 用途摘要 |
|------|-----------|
| **mon_daily_scores** | 按日排行榜提交记录（`date_ymd`、`score`、`strategy`） |
| **mon_user_segments** | 用户分群快照缓存（鲸鱼/海豚等画像字段） |
| **mon_model_config** | 个性化模型参数 JSON（默认 id=`default`） |
| **mon_strategy_log** | 策略曝光 / 转化日志 |

---

## 3. 字段内容格式、含义与示例（详解）

下列 JSON 示例为**演示结构**：真实数据中数值、键是否齐全取决于版本与玩法路径。权威定义以对应源码为准。

### 3.1 时间与数值约定

| 字段上下文 | 单位 | 说明 |
|------------|------|------|
| `sessions.start_time` / `end_time` | **毫秒** | 与浏览器 `Date.now()` 一致；服务端 `_row_session_api` 会对「疑似秒」的旧值 ×1000 修正 |
| `behaviors.timestamp`（batch 写入） | **毫秒** | `record_behaviors_batch` 接收后标准化 |
| `sessions.created_at`、`skill_wallets.updated_at`、`scores.timestamp` 等 | **Unix 秒** | 整数 |
| `sessions.duration` | **秒**（整数） | 会话结束 PATCH 时写入 |
| `user_id` | TEXT | 前端 `localStorage` `bb_user_id`，形如 `u<时间戳>_<随机>` |
| `client_ip` / `last_ip` | TEXT | 后端从 `X-Forwarded-For`、`X-Real-IP`、`CF-Connecting-IP`、`request.remote_addr` 解析；可用 `OPENBLOCK_TRUST_PROXY_HEADERS=0` 禁用代理头 |

### 3.2 `sessions.strategy_config` 与 `game_stats`

- **`strategy_config`**：`POST /api/session` 时 `JSON.stringify(strategyConfig)`，缺省为 `{}`。内容与 `shared/game_rules.json` 中策略可选覆盖字段相关（由前端传入）。
- **`game_stats`**：会话进行中/结算时 PATCH，整对象序列化。_runtime 形态示例：

```json
{
  "score": 420,
  "clears": 12,
  "maxLinesCleared": 3,
  "maxCombo": 3,
  "placements": 28,
  "misses": 4,
  "startTime": 1735689600000,
  "replayAnalysis": {
    "rating": 4,
    "tags": ["清线效率高"],
    "summary": "本局得分 420，成功落子 28 次…"
  }
}
```

`replayAnalysis` 仅在局末写入 `sessions.game_stats` 时出现（来自 `buildReplayAnalysis`，见 `web/src/moveSequence.js`）。

### 3.3 `behaviors.event_type` / `event_data` / `game_state`

**`event_type`**：与 `web/src/config.js` · `GAME_EVENTS` 字符串一致，例如：

| event_type | 含义 |
|------------|------|
| `place` | 成功落子 |
| `place_failed` | 落子失败（非法位等） |
| `clear` | 消除行列 |
| `no_clear` | 落子后未消行 |
| `game_over` | 无合法步结束 |
| `spawn_blocks` | 新一轮三块候选刷新 |
| `select_block` / `drag_start` / `drag_end` | 交互细分 |

**`event_data`**：`logBehavior(eventType, data)` 的 `data` 原样 `JSON.stringify`。文档化约定（摘自 `GAME_EVENTS` 注释）：

| 事件 | data 典型字段 |
|------|----------------|
| `place` | `shape`, `position`, `cleared`, `boardFill`, `combo` |
| `clear` | `count`, `lines`, `score`, `combo` |
| `no_clear` | `boardFill`, `nearMiss`, `placement` |
| `game_over` | `finalScore`, `totalClears`, `maxCombo`, `duration` |
| `spawn_blocks` | `shapes`, `adaptiveInsight`, `stress` |

示例（`place`）：

```json
{
  "shape": "L",
  "position": { "x": 3, "y": 5 },
  "cleared": 1,
  "boardFill": 0.42,
  "combo": 2
}
```

**`game_state`**：每条行为附带快照，当前实现至少包含：

```json
{ "score": 380, "clears": 10 }
```

### 3.4 `move_sequences.frames`（schema v1）

存 **`JSON.stringify(frames)`**，`frames` 为数组，元素由 `web/src/moveSequence.js` 生成，`v === 1`（`MOVE_SEQUENCE_SCHEMA`）。

**帧类型 `t`**：

| t | 含义 | 关键字段 |
|---|------|-----------|
| `init` | 开局 | `strategy`, `grid`（`{ size, cells }`，`cells` 为二维占用矩阵）, `scoring`，可选 `ps` |
| `spawn` | 新一轮候选块 | `dock`: `[{ id, shape, colorIdx, placed }]`，可选 `ps` |
| `place` | 一步落子 | `i`（dock 下标）, `x`, `y`（棋盘格坐标），可选 `ps`（含 `linesCleared` 等） |

**`ps`（玩家状态快照）**：`buildPlayerStateSnapshot` 产物，至少含 `pv`（版本）、`phase`、`score`、`boardFill`、`strategyId`、画像字段（`skill`、`flowState`…）及 `metrics`（`thinkMs`、`clearRate` 等）；若存在自适应快照则有 `adaptive` 子对象。

**`pv` 版本演进：**

| `pv` | 版本 | 关键变更 |
|---|---|---|
| 1 | v1.12 及之前 | `metrics.{thinkMs,clearRate,comboRate,missRate}` 直接写 `PlayerProfile.metrics` 的占位值（3000 / 0.3 / 0.1 / 0.1）。回放无法区分「真实测量」与「冷启动兜底」。 |
| 2 | v1.13+ | 新增顶层 `coldStart`、`cognitiveLoadHasData` 与 `metrics.{samples,activeSamples}`；`samples=0` 时 `metrics.{thinkMs,clearRate,comboRate,missRate}` 与 `cognitiveLoad` 全部置 `null`，避免离线管线把占位值当真实测量统计。 |

> 旧 `pv=1` 对局仍可直接回放；`formatPlayerStateForReplay` 与 `buildReplayAnalysis` 会按 `(thinkMs===3000 && clearRate===0.3)` 启发式补回冷启动标识。

**极简示例（三段各一行，真实序列更长）：**

```json
[
  {
    "v": 1,
    "t": "init",
    "strategy": "normal",
    "grid": { "size": 8, "cells": [[null, 1, ...]] },
    "scoring": { "singleLine": 20, "multiLine": 40, "combo": 60 }
  },
  {
    "v": 1,
    "t": "spawn",
    "dock": [
      { "id": "a1", "shape": [[1, 1], [1, 0]], "colorIdx": 3, "placed": false }
    ]
  },
  {
    "v": 1,
    "t": "place",
    "i": 0,
    "x": 2,
    "y": 5,
    "ps": {
      "pv": 2,
      "phase": "place",
      "score": 120,
      "boardFill": 0.35,
      "linesCleared": 1,
      "coldStart": false,
      "cognitiveLoadHasData": true,
      "metrics": { "thinkMs": 1820, "clearRate": 0.42, "missRate": 0.05, "samples": 18, "activeSamples": 16 }
    }
  }
]
```

### 3.5 `move_sequences.analysis`

局末由 `buildReplayAnalysis` 写入，整对象 JSON。顶层字段包含：`schema`, `generatedAt`, `rating`（1–5）, `summary`, `tags`, `metrics`, `thirds`, `abstractRead`, `designRead`, `recommendations` 等。示例片段：

```json
{
  "schema": 1,
  "generatedAt": 1735690000000,
  "rating": 4,
  "summary": "本局得分 520，成功落子 32 次，消线 14 条。",
  "tags": ["清线效率高"],
  "metrics": {
    "score": 520,
    "placements": 32,
    "totalCleared": 14,
    "clearRate": 0.41,
    "longestNoClear": 5,
    "coldFrames": 1,
    "coldFramesRatio": 0.03,
    "firstWarmFrameIdx": 1
  }
}
```

> **`coldFrames` / `coldFramesRatio` / `firstWarmFrameIdx`（v1.13+）**：标记本局中处于「冷启动占位」状态的帧数与比例。pv≥2 直读 `ps.coldStart`；pv=1 老对局按 `(thinkMs===3000 && clearRate===0.3)` 启发式回填。  
> 离线管线建议在做分群均值/分布对比时**过滤** `idx < firstWarmFrameIdx` 的帧；当 `coldFramesRatio > 0.25` 时 `tags` 会自动加上「冷启动样本偏多」并在 `recommendations` 给出过滤建议。

### 3.6 `skill_wallets.payload`

即 `PUT /api/wallet` 的 `wallet` 对象序列化，结构与 `web/src/skills/wallet.js` · `_emptyState()` 一致：

```json
{
  "balance": {
    "hintToken": 2,
    "undoToken": 1,
    "bombToken": 0,
    "rainbowToken": 0,
    "freezeToken": 0,
    "previewToken": 0,
    "rerollToken": 0,
    "coin": 100,
    "trialPass": 0,
    "fragment": 0
  },
  "dailyConsumed": { "2026-05-02": { "hintToken": 1, "undoToken": 0 } },
  "dailyGranted": { "2026-05-02": { "hintToken": 3 } },
  "trials": [{ "skinId": "neon", "expiresAt": 1735776000000 }],
  "lastSeenYmd": "2026-05-02"
}
```

### 3.7 `replays.events`

与局末 `saveReplay(sessionId, tail)` 一致：`tail` 为 **behavior 对象数组** 的 JSON（字段含 `sessionId`、`eventType`、`data`、`timestamp`、`gameState` 等）。用于兼容旧分析路径；确定性回放以 `move_sequences.frames` 为准。

### 3.8 `client_strategies.payload`

`JSON.stringify` 的策略条目。常见为 RL 面板保存的配置对象（具体键随版本变化），示例形态：

```json
{
  "id": "main",
  "name": "PPO default",
  "updatedAt": 1735690000000,
  "weights": {}
}
```

实际内容以 `PUT /api/client/strategies` 请求体为准。

### 3.9 `achievements`

- **`achievement_id`**：与 `web/src/config.js` · `ACHIEVEMENTS` / `ACHIEVEMENTS_BY_ID` 中 id 对齐，如 `first_clear`、`score_500`。
- **`unlocked_at`**：Unix 秒。

### 3.10 `scores`

一行一次上报：`user_id` + 当时分数 + `strategy` + `timestamp`（秒）+ `client_ip`。用于历史最高分流水、排行榜聚合和访问来源排查。

### 3.11 `user_stats`

聚合维度整数；`last_seen` 为 Unix 秒，`last_ip` 为该用户最近一次后端写入链路解析到的访问 IP。由会话生命周期与 `PUT /api/client/stats` 共同维护。

### 3.12 `season_pass`

- **`progress`**：JSON 对象，键为任务/层级 id → 进度数值或结构（由前端赛季模块约定）。
- **`completed`**：JSON 数组，已完成项 id 列表。
- **`premium`**：0/1；**`points`**：通行证点数。

示例：

```json
{
  "progress": { "tier1": 5, "daily_login": 1 },
  "completed": ["welcome_task"]
}
```

### 3.13 `ab_events`

- **`meta`**：JSON，附加维度；核心维度在 `experiment`、`bucket`、`event`、`ts`。
- **`client_ip`**：后端接收上报时解析到的访问 IP，便于按实验事件追踪来源。

```json
{
  "screen": "menu",
  "variant": "B"
}
```

### 3.14 `mon_*` 字段语义摘要

| 表 | 要点 |
|----|------|
| **mon_daily_scores** | `date_ymd` 为 `YYYY-MM-DD`（UTC）；`submitted_at` 秒级 |
| **mon_user_segments** | `segment` 如 minnow/dolphin/whale；各 `*_score` 为算法算出的 0–1 量级实数 |
| **mon_model_config** | `config` 为 JSON 文本（权重、阈值、广告/IAP 触发等），默认行 `id='default'` |
| **mon_strategy_log** | `action` 曝光动作短字符串；`converted` 0/1 |

---

## 4. 字段级参考（核心表）

以下为当前代码中的建表/迁移结果；若本地库较旧，以运行时 `PRAGMA table_info(<表名>)` 为准。

### 4.1 `sessions`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 会话 ID，被 behaviors / move_sequences / replays 引用 |
| user_id | TEXT | 客户端生成的用户标识 |
| strategy | TEXT | 策略 id，默认 `normal` |
| strategy_config | TEXT | JSON 字符串 |
| score | INTEGER | 当前/结算分数 |
| start_time / end_time | INTEGER | 毫秒时间戳 |
| duration | INTEGER | 时长（秒级约定见 API） |
| status | TEXT | 如 `active` / `completed` |
| game_stats | TEXT | JSON，可含复盘摘要等 |
| attribution | TEXT | JSON：UTM / `gclid` / `fbclid` 等会话级归因（见 `channelAttribution.js`） |
| client_ip | TEXT | 开局/结束链路记录的访问 IP |
| created_at | INTEGER | Unix 秒 |

**典型 API**：`POST /api/session`、`PATCH|PUT /api/session/<id>`、`GET /api/sessions`、`GET /api/replay-sessions`。

### 4.2 `behaviors`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| session_id | INTEGER FK → sessions.id | 可空（历史兼容） |
| user_id | TEXT | |
| event_type | TEXT | 如 `place`、`no_clear` |
| event_data / game_state | TEXT | JSON |
| timestamp / created_at | INTEGER | |
| client_ip | TEXT | 该行为写入请求解析到的访问 IP |

**典型 API**：`POST /api/behavior`、`POST /api/behavior/batch`、`GET /api/behaviors/...`。

### 4.3 `scores`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| user_id | TEXT | |
| score | INTEGER | |
| strategy | TEXT | |
| timestamp | INTEGER | |
| client_ip | TEXT | 该分数写入请求解析到的访问 IP |

**典型 API**：`POST /api/score`、`GET /api/leaderboard`、`GET /api/scores/best`。

### 4.4 `user_stats`

| 列 | 类型 | 说明 |
|----|------|------|
| user_id | TEXT PK | |
| total_games / total_score / best_score | INTEGER | |
| total_play_time | INTEGER | |
| total_clears / max_combo / total_placements / total_misses | INTEGER | |
| perfect_placements | INTEGER | 迁移补列 |
| last_ip | TEXT | 最近一次核心写入链路解析到的访问 IP |
| last_seen | INTEGER | |

**典型 API**：`GET|PUT /api/client/stats`，以及会话结束链路中的更新逻辑。

### 4.5 `achievements`

| 列 | 类型 | 说明 |
|----|------|------|
| user_id | TEXT | |
| achievement_id | TEXT | |
| client_ip | TEXT | 解锁请求解析到的访问 IP |
| unlocked_at | INTEGER | |
| **PK** | | `(user_id, achievement_id)` |

**典型 API**：`POST /api/achievement`、`GET /api/achievements/<user_id>`。

> **迁移说明**：旧库若曾为 `(user_id, id)`  schema，迁移时会将表改名为 `achievements_legacy` 再导入新表并删除临时表（见 `server.py` · `_migrate_schema`）。

### 4.6 `replays`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| session_id | INTEGER FK | |
| user_id | TEXT | |
| events | TEXT | JSON 数组（历史上与 behavior tail 同源） |
| created_at | INTEGER | |

**典型 API**：`POST /api/replays`、`GET /api/replays`、`GET /api/replay/<session_id>`。

**写入条件**：前端在会话结束且 `behaviors.length > 0` 时仍会 `saveReplay`（见 `web/src/game.js`）。若该局未积累 behaviors，**表可为空**，不代表废弃。

### 4.7 `skill_wallets`

| 列 | 类型 | 说明 |
|----|------|------|
| user_id | TEXT PK | |
| payload | TEXT | 钱包 JSON |
| updated_at | INTEGER | |

**典型 API**：`GET|PUT /api/wallet`（与 client stats 解耦）。

### 4.8 `move_sequences`

| 列 | 类型 | 说明 |
|----|------|------|
| session_id | INTEGER PK FK → sessions.id | 一局一条 |
| user_id | TEXT | |
| frames | TEXT | JSON：`moveSequence` 帧列表 |
| analysis | TEXT | 可选 JSON：复盘评级、标签等 |
| updated_at | INTEGER | |

**典型 API**：`PUT|GET /api/move-sequence/<session_id>`。  
**回放 UI** 主要依赖本表（见 `web/src/replayUI.js`、`web/src/moveSequence.js`）。

### 4.9 `client_strategies`

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT | 策略条目 id |
| user_id | TEXT | |
| payload | TEXT | JSON |
| updated_at | INTEGER | |
| **PK** | | `(id, user_id)` |

**典型 API**：`GET|PUT /api/client/strategies`。

### 4.10 `ab_events`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| user_id / experiment / event | TEXT | |
| bucket | INTEGER | |
| ts | INTEGER | |
| meta | TEXT | JSON |
| client_ip | TEXT | 实验上报请求解析到的访问 IP |

**典型 API**：`POST /api/ab/report`、`GET /api/ab/results`。

### 4.11 `season_pass`

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| user_id / season_id | TEXT | **UNIQUE(user_id, season_id)** |
| premium | INTEGER | 0/1 |
| progress / completed | TEXT | JSON |
| points | INTEGER | |
| purchased_at / updated_at | INTEGER | |

**典型 API**：`GET`、`POST|PUT /api/season-pass`。

### 4.12 商业化表 `mon_*`

字段定义以 `monetization_backend.py` · `_ensure_schema` 为准；运营侧说明亦可对照 `docs/operations/MONETIZATION.md` 等。

### 4.13 企业扩展表（`enterprise_extensions.migrate_enterprise_schema`）

| 表 | 用途 |
|----|------|
| **iap_orders** | IAP 占位订单，`idempotency_key` 幂等 |
| **experiment_configs** | 服务端实验定义（`guardrail_json` 等） |
| **user_consents** | 合规同意快照 |
| **live_ops_entries** | Live Ops 时间窗与 `payload_json` |
| **ad_impressions** | 广告曝光/填充占位 |
| **analytics_mirror_dlq** | 第三方分析镜像失败队列 |

**HTTP**：见 `docs/integrations/ENTERPRISE_EXTENSIONS.md`。

---

## 5. 关系示意（逻辑）

```text
users (逻辑实体，无独立 user 表)
  └── sessions (id, user_id, ...)
        ├── behaviors (session_id → sessions.id)
        ├── replays    (session_id → sessions.id)
        └── move_sequences (session_id PK/FK → sessions.id)

user_stats / achievements / skill_wallets / client_strategies：均按 user_id 关联
scores：按 user_id 流水，与 sessions 弱关联（通过上报时机）
```

---

## 6. 索引（部分）

| 索引 | 表 | 说明 |
|------|-----|------|
| idx_behaviors_session / user / type / timestamp / client_ip | behaviors | 按会话、用户、类型、时间、访问 IP 查询 |
| idx_sessions_user / client_ip | sessions | 用户会话列表、按访问 IP 追踪会话 |
| idx_replays_session | replays | 按会话查回放 |
| idx_mon_daily_scores_date | mon_daily_scores | 按日排行榜 |

---

## 7. 清空用户数据

`POST /api/client/clear` 会按用户删除：`behaviors`、`sessions`、`scores`、`achievements`、`replays`、`client_strategies`、`user_stats`、`skill_wallets` 及 **`move_sequences`** 中对应 `user_id` 行（见 `server.py` · `clear_user_data`）。

---

## 8. 「空表」是否废弃？

- **不能**仅凭「行数为 0」判定表废弃；新库、功能未触发、或写入条件未满足都会导致空表。
- **move_sequences** 与 **replays** 并存：`move_sequences` 为确定性回放主数据；**replays** 仍可能在有 behaviors tail 时写入。
- **client_strategies**、**season_pass**、**ab_events**、**mon_*** 等业务在未使用前为空属于正常。

---

## 9. 调试与运维

| 项 | 说明 |
|----|------|
| **首页「数据库调试」** | 需 Flask 运行；默认启用 `/api/db-debug/*`（生产公网请设 `OPENBLOCK_DB_DEBUG=0` 关闭） |
| **健康检查** | `GET /api/health` |
| **实现入口** | `server.py`：`init_db`、`get_db`、`/api/*`；`monetization_backend.py`：`init_mon_db`、`_ensure_schema` |

---

## 10. 相关文件索引

| 文件 | 内容 |
|------|------|
| `server.py` | 主 schema、迁移、REST API |
| `monetization_backend.py` | `mon_*` 表与 `/api/mon/*` |
| `web/src/database.js` | 浏览器侧 SQLite API 封装 |
| `web/src/game.js` | 会话结束、behaviors、saveReplay、move sequence flush |
| `web/src/moveSequence.js` | `frames` schema 与复盘分析结构 |

修订表结构时请 **同步更新本文** 与迁移逻辑（`init_db` / `_migrate_schema` / `_ensure_*`）。
