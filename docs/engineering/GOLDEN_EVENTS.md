# 黄金事件字典（版本化约定）

> 与 `web/src/config.js` · `GAME_EVENTS`、商业化 `MonetizationBus`、后端 `behaviors.event_type` 对齐。  
> 变更事件名或 `event_data` 形状时，应更新本文件主版本号并在 PR 中注明迁移。

## 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-05-02 | 首版：玩法事件 + 埋点字段约定 |

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
