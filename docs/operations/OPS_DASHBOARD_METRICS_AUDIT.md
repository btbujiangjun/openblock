# 运营看板指标口径与数据库接入审计

> **定位**：对 `/ops` 运营看板与 `/api/ops/dashboard` 指标口径做工程审计，回答“指标是否正确、是否接入数据库、哪些指标需要谨慎解释”。  
> **适用角色**：运营、产品、数据分析、后端、测试。  
> **代码入口**：`web/src/opsDashboard.js`、`web/public/ops-dashboard.html`、`server.py`。  
> **数据库入口**：默认 `openblock.db`，可由 `OPENBLOCK_DB_PATH` 或兼容变量 `BLOCKBLAST_DB_PATH` 覆盖。

---

## 1. 总体结论

当前运营看板 **已经接入 SQLite 数据库**，不是静态 mock 数据。后端服务启动时打印数据库路径，例如：

```text
Open Block API — http://0.0.0.0:5000  (db: /Users/admin/Documents/work/opensource/openblock/openblock.db)
```

数据库连接生命周期如下：

1. 每个请求通过 `get_db()` 打开或复用 Flask request-scoped SQLite 连接。
2. 连接设置 `row_factory=sqlite3.Row`，并尝试启用 `WAL` 与 `busy_timeout=5000`。
3. 请求结束时由 `@app.teardown_appcontext` 的 `close_connection()` 自动关闭连接。

因此，“是否接数据库”的结论是：**已接入数据库，且每个请求结束会关闭数据库连接**。截图中的 `DAU=4`、`人均局数=372.75`、`DAU/MAU=80.0%` 等来自当前本地库的真实聚合结果。

但当前看板也存在几个需要运营解释时注意的口径问题：

| 结论 | 说明 |
|------|------|
| `近7天` 下的 `DAU=4` 不是严格“单日 DAU” | 后端字段 `activity.dau` 实际计算的是所选窗口内去重活跃用户数；当选择近 7 天时更接近 WAU。 |
| 留存为 `0.0%` 不一定代表产品留存差 | 小样本库只有 5 个 `user_stats` 用户，且 cohort 时间窗可能为空或很小。 |
| 收入、广告、IAP 多数为 `0` 是数据源未接入或事件为空 | 当前 `payments=0`，广告点击/展示/收入事件未形成稳定写入。 |
| 成就完成率可超过 100% | 当前公式是 `achievements / active_users`，含义更像“人均成就解锁数”，不是真正完成率。 |
| 人均局数极高 | 当前库可能含大量开发/自动测试 session；历史版本 `PATCH /api/session/<id>` 未写 `duration`，会导致平均时长长期为 0。 |

---

## 2. 数据链路

```text
前端 /ops 或游戏内 Ops Screen
        ↓
web/src/opsDashboard.js
        ↓ fetch('/api/ops/dashboard?days=N')
server.py::ops_dashboard()
        ↓
SQLite: sessions / user_stats / behaviors / payments / achievements / ab_events
        ↓
JSON: activity / retention / coreMetrics / businessMetrics / trend / segments
```

看板有两个入口：

| 入口 | 文件 | 用途 |
|------|------|------|
| `/ops` 独立页面 | `web/public/ops-dashboard.html` | 浏览器直接查看运营看板 |
| 游戏内 Screen | `web/src/opsDashboard.js` | 作为游戏内运营面板打开 |

两者都读取同一个后端接口：`GET /api/ops/dashboard?days=1|7|30`。

---

## 3. 写入链路审计

指标正确性不仅取决于读 SQL，还取决于写入事件是否完整、幂等、单位一致、结束态正确。当前写入链路如下：

| 数据表 | 主要写入入口 | 前端来源 | 写入正确性结论 |
|--------|--------------|----------|----------------|
| `sessions` | `POST /api/session`、`PATCH /api/session/<id>`、`PUT /api/session/<id>` | `Database.saveSession()`、`Database.updateSession()`、`BackendSync.endSession()` | **已修正**：SQLite 主路径使用 `PATCH`，现在会在 `endTime` 存在时补写 `duration`，并在首次完成时更新 `user_stats.best_score/total_play_time`。 |
| `user_stats` | `PUT /api/client/stats`、`PATCH /api/session/<id>`、`POST /api/score` | 新局、局末统计、最高分保存 | **已修正**：`POST /api/score` 现在同步更新 `user_stats.best_score`，避免看板 Top 分数只看 `user_stats` 时长期为 0。 |
| `scores` | `POST /api/score`、`PUT /api/session/<id>` | 仅当本局超过历史最高分时写入 | 写入是稀疏的最高分事件，不等于每局得分流水；看板 Top 分数应回看 `scores.MAX(score)`。 |
| `behaviors` | `POST /api/behavior/batch`、`POST /api/behavior` | `Database.saveBehaviors()`、`BackendSync.flushBatch()`、离线队列 | **已修正**：单条上报现在兼容 `eventType/userId/sessionId/timestamp`，并统一毫秒时间戳；批量上报已有毫秒修正。 |
| `payments` | `POST /api/payment/verify` | `paymentManager`、`iapAdapter` | **已修正**：按 `user_id + sku + provider + provider_ref` 做幂等返回，避免重试造成收入重复计入。 |
| `achievements` | `POST /api/achievement` | `Database.unlockAchievement()` | 使用 `(user_id, achievement_id)` 主键与 `INSERT OR IGNORE`，写入幂等正确。 |
| `ab_events` | `POST /api/ab/report` | `abTest.trackEvent()` | 写入事件计数正确；没有幂等键，适合“事件次数”而非“唯一转化人数”。 |
| `sessions.game_stats` | `PATCH /api/session/<id>` | `game.js → saveSession()` | 已写入 `bestScoreChase / nearBestQuality / bestBreakSource / lifecycle`；Ops 看板据此聚合个人最佳突破来源。 |

> v1.34 之后，后端会在上述核心写入链路记录访问 IP：事件级表使用 `client_ip`，用户聚合表使用 `user_stats.last_ip`。解析优先级为 `X-Forwarded-For` 首个地址、`X-Real-IP`、`CF-Connecting-IP`、`True-Client-IP`、`request.remote_addr`；如部署环境不信任反向代理头，可设置 `OPENBLOCK_TRUST_PROXY_HEADERS=0`。

### 3.1 已确认的历史写入问题

| 问题 | 影响指标 | 原因 | 当前处理 |
|------|----------|------|----------|
| `sessions.duration` 全为空或 0 | 平均时长、总游玩时长 | SQLite 主路径局末调用 `PATCH`，旧版 `patch_session()` 没有持久化 `duration` | `patch_session()` 已按 `endTime - start_time` 计算秒级 duration；读侧也对历史数据用 `end_time-start_time` 兜底。 |
| `user_stats.best_score` 长期为 0 | Top 分数、分群 | 前端最高分写入 `scores`，但旧版 `POST /api/score` 不更新 `user_stats.best_score` | `POST /api/score` 已同步更新；看板 Top 分数/分群改为 `MAX(user_stats.best_score, scores.MAX(score))`。 |
| 单条行为上报字段不兼容 | 广告、质量、社交、内容事件 | `offlineManager.logBehavior()` 发送 `eventType`，旧版后端只读 `event_type` | `POST /api/behavior` 已同时兼容 snake_case 和 camelCase。 |
| 单条行为时间戳被服务端覆盖为秒 | 行为事件趋势、广告/质量窗口 | 旧版 `record_behavior()` 忽略客户端 timestamp，且写秒级时间 | 已统一写毫秒时间戳，与 `sessions.start_time` 和批量行为一致。 |
| 支付验证重复插入 | 收入、ARPU、LTV、IAP 复购 | 客户端重试或重复点击可能重复写同一 `provider_ref` | `verify_payment()` 已做 provider_ref 幂等返回。 |

### 3.2 仍需注意的写入边界

- `scores` 表不是每局得分表，而是“超过历史最高分才写”的稀疏记录；每局流水应以 `sessions.score` 为准。
- `behaviors` 事件没有全局 event id；批量离线队列在服务端成功但客户端未标记 synced 的极端情况下，仍可能重复上报。
- `ab_events` 记录的是事件次数，不是唯一用户转化；做 A/B 转化率时需按 `user_id` 去重。
- `client_ip` 只能作为排障、风控、反作弊和粗粒度来源追踪字段；代理、NAT、移动网络会导致多人共用 IP，不能把 IP 等同于自然人身份。
- 当前本地库已有历史脏数据，代码修正只保证后续写入正确；历史指标需要迁移或按读侧兜底解释。

---

## 4. 本次本地数据核验

本次审计读取当前本地数据库：

| 表 | 当前记录数 | 用途 |
|----|------------|------|
| `sessions` | 3673 | 活跃、局数、时长、趋势、留存 cohort |
| `user_stats` | 5 | 用户分群、最高分、流失预警 |
| `behaviors` | 61118 | 广告、社交、质量、内容使用等事件 |
| `payments` | 0 | IAP、广告收入、LTV、ARPU、ARPDAU |
| `achievements` | 35 | 成就相关指标 |
| `ab_events` | 1 | A/B 实验统计 |

截图选择的是“近7天”，接口返回的关键值为：

| 指标 | 接口值 | 截图表现 | 判断 |
|------|--------|----------|------|
| 活跃用户 | 4 | `DAU=4` | 数值匹配，但标签应解释为“窗口活跃用户”。 |
| 总局数 | 1491 | 未直接展示 | 用于计算人均局数。 |
| 人均局数 | 372.75 | `372.75 局/人` | 公式正确，但样本明显偏开发/测试。 |
| D1/D7/D30 | 0/0/0 | `0.0%` | 数值匹配；cohort 小，不能作为产品结论。 |
| DAU/MAU | 0.8 | `80.0%` | 公式为窗口活跃用户 / 近30天活跃用户。 |
| 流失预警 | 0.2 | `20.0%` | 数值匹配。 |
| 支付/IAP/广告收入 | 0 | 全部 `¥0.00` 或 `0.0%` | 数据库没有支付记录，广告收入也未稳定接入。 |
| 成就完成率 | 2.75 | `275.0%` | 公式不是“率”，应改名为“人均成就解锁数”或修改分母。 |

写入修正后重新请求近 7 天接口，读侧已能从 `end_time-start_time` 和 `scores` 表兜底：

| 指标 | 修正后接口值 | 说明 |
|------|--------------|------|
| 平均时长 | `455.3s` | 历史 `duration` 为空时用 `end_time-start_time` 计算。 |
| Top1 分数 | `7420` | 来自 `scores.MAX(score)`，不再被 `user_stats.best_score=0` 污染。 |
| 分群 | `A=1, B=1, C=2` | 分群使用修正后的最高分兜底后更接近真实高分用户。 |
| 个人最佳挑战指标 | `bestScoreStats` | 从 `sessions.game_stats.bestScoreChase.finalRatio / bestBreakSource / nearBestQuality` 聚合，前端展示 `best_80_rate / best_95_rate / best_break_rate`、来源占比与 S/M 分组主来源；样本少时只作观测。 |

---

## 5. 指标口径逐项说明

### 5.1 活跃与局数

| 前端名称 | 后端字段 | 当前公式 | 正确性 |
|----------|----------|----------|--------|
| 日活 / DAU | `activity.dau` | `COUNT(DISTINCT user_id)` where `sessions.start_time >= since_ms` | **部分正确**：`days=1` 时是 DAU；`days=7/30` 时是窗口活跃用户。 |
| 人均局数 | `activity.avgSessionsPerUser` | `total_sessions / active_users` | **公式正确**，但开发库 session 极多，容易异常偏高。 |
| 平均时长 | `activity.avgDurationSec` | 优先 `sessions.duration`，历史缺失时用 `(end_time-start_time)/1000` 兜底 | **已修正写入与读侧兜底**；历史 active session 仍不计入。 |
| DAU/MAU | `coreMetrics.activity.dauMau` | `active_users(window) / active_users(30d)` | **命名需注意**：严格 DAU/MAU 应使用当天 DAU / 30日 MAU。 |

建议：

- 前端在 `days=7/30` 时把 `DAU` 文案改为 `窗口活跃用户`，或后端同时返回 `dauToday`、`wau`、`mau`。
- 排除开发/测试用户或增加环境标签，否则人均局数会被本地调试 session 放大。

### 5.2 留存

| 指标 | 当前公式 | 正确性 |
|------|----------|--------|
| D1 | 查找 cohort 首次 session 后第 1 天是否再次出现 session | **方法可用**，但 cohort 窗口与 `days` 参数耦合，样本小时波动大。 |
| D7 | 使用第 6-8 天宽松窗口 | **需明示**：不是严格第 7 自然日。 |
| D30 | 使用第 29-31 天宽松窗口 | **需明示**：样本小或不足 30 天时通常为 0。 |

风险：

- 当前注释称“近7日注册用户”，实际 `_retention(delta_min, delta_max)` 的 base window 是 `time - (delta_max + days)` 到 `time - delta_min`，会随所选 `days` 改变，不是固定注册 cohort。
- 对小样本本地库，`0%` 留存更可能是 cohort 不完整，而不是产品失败。

### 5.3 分群

| 指标 | 数据源 | 当前逻辑 | 正确性 |
|------|--------|----------|--------|
| 用户分群 | `MAX(user_stats.best_score, scores.MAX(score))`、`user_stats.total_games` | 规则阈值映射 A/B/C/D/E | **可作为粗略运营分层**，但与前端 `PlayerProfile.segment5` 不是完全同一公式。 |

建议：

- 文档和 UI 中标记为“后端运营粗分群”。
- 若用于精细个性化，应持久化前端 `behaviorSegment` / `motivationIntent`，不要只用分数和局数。

### 5.4 收入与 IAP

| 指标 | 当前公式 | 判断 |
|------|----------|------|
| ARPDAU | `sum(payments.amount_minor)/100 / active_users` | 公式正确；当前 `payments=0` 所以为 0。 |
| ARPU | `revenue / paying_users` | 当前实现更接近 ARPPU（付费用户平均收入），不是全量用户 ARPU。 |
| LTV | 历史总收入 / 历史去重用户 | 可作为粗略 LTV proxy；没有 cohort 生命周期分层。 |
| IAP 转化率 | `paying_users / active_users` | 公式可用；当前无支付记录。 |
| 客单价 | `revenue / order_count` | 公式可用。 |
| 复购率 | `购买次数>=2的用户 / paying_users` | 公式可用。 |

建议：

- 将当前 `arpu` 改名为 `arppu`，另增 `arpu = revenue / active_users` 或保留 `arpdau`。
- 支付接入后应过滤退款、测试订单、沙盒订单。

### 5.5 广告

| 指标 | 当前公式 | 判断 |
|------|----------|------|
| 展示率 | `ad_show / ad_trigger`，无 trigger 时用 `total_sessions` | 可用，但依赖埋点完整性。 |
| 点击率 | `ad_click / ad_show` | 可用。 |
| 完播率 | `ad_complete / ad_show` | 可用。 |
| eCPM | `ad_revenue * 1000 / ad_show` | 当前用 `payments.provider in ('ad','ads','admob','unityads')` 近似广告收入，实际广告 SDK 接入后应独立收入表。 |

当前截图广告全 0 的原因：本地库没有稳定 `ad_show/ad_click/ad_complete` 与广告收入记录。

### 5.6 质量、社交、内容

| 指标 | 当前公式 | 判断 |
|------|----------|------|
| 崩溃率 | `(crash/app_crash/fatal_error) / total_sessions` | 可用，依赖前端/平台崩溃上报。 |
| 卡顿率 | `(frame_drop/jank/lag) / total_sessions` | 可用，需定义事件触发频率，避免同一局多次上报导致偏高。 |
| 加载时长 | `behaviors.event_data.load_ms 或 duration_ms` 平均 | 可用；当前没有样本所以 0。 |
| 分享率 | `(share + invite_share) / active_users` | 可用，但更像人均分享次数。 |
| 邀请转化 | `invite_register / invite_click` | 可用。 |
| 好友数 | `friend_count/social_state` 事件中的 friends 平均 | 可用，依赖主动上报状态。 |
| 皮肤使用率 | `skin_use / active_users` | 更像人均使用次数。 |
| 道具消耗 | `(item_use + skill_use + hint_use + bomb_use + undo_use) / active_users` | 人均道具消耗次数。 |
| 成就完成率 | `achievements / active_users` | **命名不准确**，当前可超过 100%。 |

---

## 6. 截图指标是否“正确”

以当前代码与数据库状态判断：

| 类别 | 结论 |
|------|------|
| 数据是否来自数据库 | 是。截图数值能由 `openblock.db` 当前表数据复现。 |
| 活跃、局数、趋势 | 写入链路已补 duration；SQL 聚合基本正确；但 `DAU` 标签在 7/30 天窗口下不严谨。 |
| 留存 | 计算逻辑能运行，但本地样本太小，且窗口定义需标注，不宜作为真实留存结论。 |
| 收入/IAP/广告 | 0 值符合当前库状态，不代表功能不可用；代表真实收入与广告事件尚未接入或未产生数据。 |
| 内容指标 | “成就完成率 275%”不是完成率口径，应改名或改公式。 |
| 数据质量 | 当前库像开发/测试库：会话数很高、存在历史 duration/best_score 脏数据；指标适合验证链路，不适合做产品决策。 |

---

## 7. 建议修正优先级

| 优先级 | 建议 | 目的 |
|--------|------|------|
| P0 | UI 将 `days>1` 的 `DAU` 改为 `窗口活跃用户`，或后端新增 `dauToday/wau/mau` | 避免运营误读。 |
| P0 | `achievementCompletionRate` 改名为 `achievementUnlocksPerUser`，或按“已完成成就 / 可完成成就”计算 | 避免出现 275% 的“完成率”。 |
| P1 | 区分测试用户、开发 session、真实用户 | 降低人均局数和留存口径污染。 |
| P1 | `ARPU` 与 `ARPPU` 拆开 | 避免收入指标术语错误。 |
| P1 | 留存接口返回 cohort size、retained count、窗口说明 | 小样本时可解释性更强。 |
| P2 | 广告收入独立建表或接入 SDK 回调 | eCPM 不再依赖 `payments.provider=ad` 的近似。 |
| P2 | 增加指标 `dataQuality` 字段 | 前端可展示“样本不足 / 事件未接入 / 开发库”状态。 |

---

## 8. 验证命令

后端服务运行后，可用以下命令复核：

```bash
python3 - <<'PY'
import json, urllib.request
for days in (1, 7, 30):
    with urllib.request.urlopen(f'http://127.0.0.1:5000/api/ops/dashboard?days={days}') as r:
        data = json.load(r)
    print(days, data['activity'], data['retention'])
PY
```

数据库表计数：

```bash
python3 - <<'PY'
import os, sqlite3
path = os.environ.get('OPENBLOCK_DB_PATH') or os.environ.get('BLOCKBLAST_DB_PATH') or 'openblock.db'
con = sqlite3.connect(path)
for t in ['sessions','user_stats','behaviors','payments','achievements','ab_events']:
    print(t, con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
PY
```

---

## 9. 维护原则

- 看板指标文案必须与 SQL 口径一致，尤其是 DAU/WAU/MAU、ARPU/ARPPU、完成率/人均次数。
- 所有 0 值都要区分“真实为 0”和“未接入数据源”。
- 留存、付费、广告指标应显示样本量，避免小样本下过度解释。
- 本地开发库只能验证链路，不能代表真实运营表现。
- 新增指标时同步更新 `server.py`、`web/src/opsDashboard.js`、本文档和文档中心注册。
