# 黄金事件字典（版本化约定）

> 与 `web/src/config.js` · `GAME_EVENTS`、商业化 `MonetizationBus`、后端 `behaviors.event_type` 对齐。  
> 变更事件名或 `event_data` 形状时，应更新本文件主版本号并在 PR 中注明迁移。

## 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-05-02 | 首版：玩法事件 + 埋点字段约定 |
| 1.1 | 2026-05-12 | 新增生命周期 / 成熟度类事件（蓝图 P0-4 + P1-4 + P2-1 + P2-3） |

## 玩法事件（MonetizationBus / game）

| 事件常量 | 字符串值 | `data` 核心字段 |
|----------|----------|-----------------|
| `PLACE` | `place` | `shape`, `position`, `cleared`, `boardFill`, `combo` |
| `PLACE_FAILED` | `place_failed` | `shape`, `reason` |
| `CLEAR` | `clear` | `count`, `lines`, `score`, `combo` |
| `NO_CLEAR` | `no_clear` | `boardFill`, `nearMiss`, `placement` |
| `GAME_OVER` | `game_over` | `finalScore`, `totalClears`, `duration`, `strategy` |
| `SPAWN_BLOCKS` | `spawn_blocks` | `shapes`, `adaptiveInsight`, `stress` |
| `SELECT_BLOCK` | `select_block` | `blockIndex`, `shape` |
| `DRAG_START` | `drag_start` | `blockIndex` |
| `DRAG_END` | `drag_end` | `placed` |

权威源码：`web/src/config.js` 中 `GAME_EVENTS` 注释块。

## 后端 behaviors 写入约定

- `event_type`：建议使用与前端一致的 snake_case 字符串（如 `game_over`、`iap_purchase`）。
- `event_data`：JSON 对象字符串；字段集合随版本扩展时应向后兼容（新增可选键）。
- `timestamp`：毫秒或秒混合历史存在；新写入应以毫秒为主（见 `SQLITE_SCHEMA.md`）。

## 商业化扩展事件（建议前缀）

| event_type | 说明 |
|------------|------|
| `ad_rewarded_shown` | 激励展示/完成（可与 `ad_impressions` 表并存） |
| `ad_interstitial_shown` | 插屏展示 |
| `iap_purchase` | 内购成功（客户端上报补充） |

服务端广告占位表：`ad_impressions`（见 `enterprise_extensions.py`、`ENTERPRISE_EXTENSIONS.md`）。

## 生命周期 / 成熟度事件（v1.1）

> 由 [玩家生命周期与成熟度运营蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) §4.1 P0-4、§4.2 P1-4、§4.3 P2-1/P2-3 引入。
> 全部声明在 `web/src/monetization/analyticsTracker.js` 的 `ANALYTICS_EVENTS`，category 统一为 `lifecycle`。

| event_type | 触发模块 | 关键 `properties` |
|------------|----------|-------------------|
| `ftue_step_complete` | FTUE 流程 / `playerLifecycleDashboard.shouldTriggerIntervention` | `step`, `attempts`, `durationMs` |
| `intent_exposed` | `web/src/strategyAdvisor.js`（建议出现给玩家） | `intent`, `stage`, `band`, `stress` |
| `intent_followed` | `web/src/strategyAdvisor.js`（玩家在 3 步内执行） | `intent`, `followStep`, `tookHint` |
| `bottleneck_hit` | `web/src/bot/blockSpawn.js`（`firstMoveFreedom ≤ 2`） | `firstMoveFreedom`, `dockRound`, `solutionCount` |
| `recovery_success` | `web/src/adaptiveSpawn.js` / `web/src/stressMeter.js`（stress > 0.65 → < 0.45） | `peakStress`, `recoverSteps`, `valley` |
| `maturity_milestone_complete` | `web/src/retention/maturityMilestones.js` | `milestoneId`, `band`, `stage` |
| `weekly_challenge_join` | `web/src/monetization/weeklyChallenge.js` | `challengeId`, `cycle`, `stage`, `band` |
| `weekly_challenge_complete` | 同上 | `challengeId`, `score`, `cycle`, `durationMs` |
| `winback_session_started` | `web/src/retention/winbackProtection.js` | `daysSinceLastActive`, `protectionPreset` |
| `winback_session_completed` | 同上 | `protectedRounds`, `survived`, `score` |

### 命名与维护规约

1. event_type 全小写 snake_case，建议带模块前缀（`weekly_challenge_*` / `winback_*` / `intent_*` 等）。
2. `properties` 字段集合可向后兼容扩展（仅追加键）。删除/重命名键须升级本文件 minor 版本。
3. 所有 lifecycle 事件都应可被 `analyticsTracker.getUserJourney()` 重放，UI 字段名与本表一致。
