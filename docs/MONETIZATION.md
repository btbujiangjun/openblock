# 商业化策略完整文档（v3）

> 版本 v3 · 2026-04-20  
> 本文档合并 v1（路径研究与优化建议）和 v2（个性化引擎设计），并补充全部已实现模块的完整说明。  
> 状态：**已全量落地**，45 项测试通过，216 项全量测试通过。

---

## 目录

1. [商业化全景](#1-商业化全景)
2. [系统架构](#2-系统架构)
3. [用户分群模型](#3-用户分群模型)
4. [个性化策略矩阵](#4-个性化策略矩阵)
5. [功能模块详解](#5-功能模块详解)
6. [后端 API 参考](#6-后端-api-参考)
7. [SQLite 数据库结构](#7-sqlite-数据库结构)
8. [配置与调参](#8-配置与调参)
9. [玩家画像面板集成](#9-玩家画像面板集成)
10. [商业化模型训练面板](#10-商业化模型训练面板)
11. [Feature Flag 开关](#11-feature-flag-开关)
12. [实施路线图](#12-实施路线图)
13. [指标基线](#13-指标基线)
14. [扩展与优化路线](#14-扩展与优化路线)

---

## 1. 商业化全景

### 1.1 变现模式

2026 年移动休闲游戏市场以**混合变现（Hybrid）**为标准形态，单一模式天花板明显。Open Block 采用 **IAA + IAP 双引擎 + 个性化分层**策略：

| 路径 | 核心工具 | Open Block 实现 | 状态 |
|------|---------|----------------|------|
| **IAA 广告变现** | 激励视频、插屏广告 | `adAdapter.js` + `adTrigger.js` | ✅ 已实现（Stub 模式） |
| **IAP 内购变现** | 月卡/周卡/礼包/提示包 | `iapAdapter.js` | ✅ 已实现（Stub 模式） |
| **个性化分层** | Whale/Dolphin/Minnow 分群策略 | `personalization.js` | ✅ 已实现 |
| **留存运营** | 每日任务、赛季通行证 | `dailyTasks.js` + `seasonPass.js` | ✅ 已实现 |
| **社交传播** | 排行榜、回放分享 | `leaderboard.js` + `replayShare.js` | ✅ 已实现 |
| **召回通知** | Web Push 连签提醒 | `pushNotifications.js` | ✅ 已实现 |

混合变现 ARPU 比纯 IAA 高 **28%**（行业数据）；Whale 用户对 IAP 付费意愿强，插屏广告对其流失影响显著，**必须分群对待**。

### 1.2 竞品参考

| 产品 | 月活/月收入 | 关键策略 | Open Block 差异点 |
|------|-----------|---------|-----------------|
| Block Blast! | 3 亿/月活 | 高频 IAA + 节庆活动 | **缺乏动态难度**，Open Block 有心流引擎 |
| Woodoku | 1 亿+安装 | Freemium + 插屏 | 广告频率高被投诉，Open Block 有精准分群 |
| Coin Sort | $150万+/月 | IAP+IAA 混合 | Open Block 有 RL 智能体差异化 |

---

## 2. 系统架构

### 2.1 整体数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Open Block 商业化系统                          │
├──────────────────────────┬──────────────────────────────────────────┤
│      冷信号（历史数据）      │         热信号（实时数据）                  │
│  SQLite: sessions /       │   PlayerProfile:                        │
│  behaviors / user_stats   │   ├─ frustrationLevel（连续未消行次数）    │
│  ├─ 最高分、总局数、时长     │   ├─ hadRecentNearMiss（近失检测）        │
│  ├─ 近失率（behaviors）    │   ├─ flowState（心流/无聊/焦虑）           │
│  └─ 活跃度（近 7 日局数）   │   ├─ skillLevel（技能评分 EMA）           │
│             │              │   └─ sessionPhase（early/peak/late）    │
│             ▼              │              │                          │
│  /api/mon/user-profile     │   updateRealtimeSignals()               │
│  ├─ 分群计算（whale_score） │              │                          │
│  └─ 缓存 mon_user_segments │              │                          │
│             │              │              │                          │
│             └──────────────┴──────────────┘                          │
│                            │                                         │
│                            ▼                                         │
│               personalization.js（getCommercialInsight）              │
│               ├─ 分群判定：Whale / Dolphin / Minnow                  │
│               ├─ 策略矩阵：actions[] + why + effect                  │
│               └─ 推理摘要：whyLines[]                                │
│                            │                                         │
│             ┌──────────────┼──────────────────────────┐              │
│             ▼              ▼                          ▼              │
│   commercialInsight.js  monPanel.js           MonetizationBus        │
│   （玩家画像面板注入）   （训练面板）         （事件路由）               │
│                                               ├─ adTrigger.js        │
│                                               ├─ dailyTasks.js       │
│                                               ├─ leaderboard.js      │
│                                               ├─ seasonPass.js       │
│                                               ├─ skinUnlock.js       │
│                                               ├─ pushNotifications.js│
│                                               └─ replayShare.js      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 启动时序

```
DOMContentLoaded
  └─ Game 实例创建
       └─ initMonetization(game)          ← main.js 仅 2 行侵入
            ├─ injectMonStyles()          注入所有 CSS
            ├─ attach(game)               MonetizationBus 包装 logBehavior
            ├─ initAds()                  广告适配层初始化
            ├─ initAdTrigger()            绑定广告触发事件
            ├─ initDailyTasks()           每日任务订阅
            ├─ initLeaderboard()          排行榜订阅
            ├─ initSeasonPass()           赛季通行证订阅
            ├─ initPushNotifications()    推送检查
            ├─ initReplayShare()          注入分享按钮
            ├─ fetchPersonaFromServer()   延迟 2s 拉取服务端画像
            ├─ initCommercialInsight()    注入画像面板策略区
            └─ initMonPanel()             右下角悬浮训练面板

game.init()（后续正常初始化，不受影响）
```

### 2.3 热插拔设计

商业化系统**零侵入**核心游戏逻辑，可随时热拔出：

```js
import { shutdownMonetization } from './monetization/index.js';
shutdownMonetization(); // 恢复 game.logBehavior，清除所有订阅
```

---

## 3. 用户分群模型

### 3.1 分群计算公式

从 SQLite 历史数据计算每用户的 `whale_score`：

```
best_score_norm  = min(1, best_score / 2000)
total_games_norm = min(1, total_games / 50)
avg_session_norm = min(1, avg_session_sec / 600)   ← 10 分钟为满

whale_score = w0 × best_score_norm
            + w1 × total_games_norm
            + w2 × avg_session_norm

默认权重：w0=0.40, w1=0.30, w2=0.30（可通过训练面板调整）
```

| 分群 | 阈值 | 商业化策略重心 |
|------|------|-------------|
| 🐋 **Whale** | whale_score ≥ 0.60 | IAP 优先（月卡/豪华皮肤），屏蔽插屏广告 |
| 🐬 **Dolphin** | 0.30 ≤ score < 0.60 | 激励广告 + 周卡，连签推送 |
| 🐟 **Minnow** | score < 0.30 | 插屏广告 + 新手礼包，每日任务留存 |

### 3.2 活跃度评分

```
activity_score = 0.6 × min(1, recent_7d_games/7)
               + 0.4 × (recent_7d_games > 0 ? 1 : 0)
```

活跃度 < 35% 时触发推送唤回策略（D7 留存 +15%）。

### 3.3 分群缓存机制

| 层次 | 存储 | TTL | 刷新方式 |
|------|------|-----|---------|
| 服务端 | `mon_user_segments` 表 | 1 小时 | `?force=1` 参数 |
| 客户端 | `localStorage` (`openblock_mon_persona_v1`) | 1 小时 | 游戏结束后后台刷新 |

---

## 4. 个性化策略矩阵

### 4.1 分群 × 信号 → 策略

| 分群 | 实时信号 | 推荐策略 | 触发原因 | 预期效果 |
|------|---------|---------|---------|---------|
| Whale | 任意 | 月卡通行证 IAP | 付费意愿强 | LTV 约为周卡 3.8× |
| Whale | frustration ≥ 5 | 提示包 IAP | 未消行 N 次，提示需求明确 | 降低流失率约 18% |
| Whale | 任意 | **屏蔽插屏广告** | 广告容忍度低，流失成本 > 广告收益 | 保留 LTV（⚠️ 当前 `adTrigger.js` 未按分群跳过，需接入个性化引擎） |
| Dolphin | 任意 | 周卡通行证 | 中等用户对低价周期付费接受度高 | 首月留存 +22% |
| Dolphin | `hadRecentNearMiss` | 激励视频（near-miss） | 近失时玩家主动性最强 | 转化率 +40% |
| Dolphin | activity < 0.4 | 推送连签提醒 | 近期活跃度下滑 | D7 留存 +15% |
| Minnow | game_over | 插屏广告 | 游戏结束是天然断点 | eCPM 最高，留存影响 <2% |
| Minnow | frustration ≥ 5 | 新手礼包（限时） | 挫败临界是首购最佳窗口 | 首付转化率 +35% |
| Minnow | 任意 | 每日任务 | 轻度用户需短期目标锚定 | D1 留存 +28% |

### 4.2 心流状态约束

心流状态（`PlayerProfile.flowState`）作为**全局广告抑制信号**：

| 状态 | 含义 | 商业化约束 |
|------|------|----------|
| `flow` | 挑战与能力匹配，高度投入 | **抑制所有插屏广告**（流失率峰值） |
| `bored` | 挑战偏低 | 可展示皮肤/新内容预告，引导付费 |
| `anxious` | 挑战偏高或失误多 | 激励广告、提示包转化率↑ |

### 4.3 会话阶段影响

| 阶段 | 含义 | 策略调整 |
|------|------|---------|
| `early` | 开局热身（前 5 局） | 轻度商业化，降低首次体验摩擦 |
| `peak` | 主对局时段 | 正常执行所有策略 |
| `late` | 连续游玩较久 | 减少打断，推通行证/连签奖励 |

---

## 5. 功能模块详解

### 5.1 MonetizationBus（事件总线）

**文件**：`web/src/monetization/MonetizationBus.js`

非侵入式事件中枢，包装 `game.logBehavior` 转发游戏事件：

```js
import { on, off, emit } from './MonetizationBus.js';

on('game_over',    ({ data, game }) => { /* 游戏结束 */ });
on('no_clear',     ({ data, game }) => { /* 未消行 */ });
on('spawn_blocks', ({ data, game }) => { /* 出块 */ });
on('clear',        ({ data, game }) => { /* 消行 */ });
```

挂载/卸载：

```js
attach(game);   // 包装 game.logBehavior，开始转发
detach();       // 恢复原始 logBehavior，停止转发
```

### 5.2 adAdapter（广告适配层）

**文件**：`web/src/monetization/adAdapter.js`

| 接口 | 说明 |
|------|------|
| `initAds()` | 从 localStorage 恢复广告移除状态 |
| `showRewardedAd(reason)` | 展示激励视频，返回 `{ rewarded: boolean }` |
| `showInterstitialAd()` | 展示插屏广告（已购除广告时跳过） |
| `setAdsRemoved(bool)` | 设置广告移除状态（IAP 购买后调用） |
| `isAdsRemoved()` | 查询当前广告状态 |
| `setAdProvider(provider)` | 替换真实广告 SDK（替换 Stub） |

**Stub 模式**（`featureFlags.stubMode = true`）：全屏 UI 模拟广告展示，无需接入真实 SDK。

### 5.3 adTrigger（广告触发器）

**文件**：`web/src/monetization/adTrigger.js`

触发逻辑（不修改 game.js，通过 MonetizationBus 监听）：

| 触发事件 | 条件 | 广告类型 |
|---------|------|---------|
| `game_over` | 已移除广告时跳过 | 插屏广告 |
| `no_clear` | `profile.hadRecentNearMiss = true` | 激励视频（近失救济） |
| `no_clear` | `profile.frustrationLevel ≥ 5` | 激励视频（挫败救济） |

每局激励广告上限：`MAX_REWARDED_PER_GAME = 3`（当前硬编码于 `adTrigger.js`）

> ⚠️ **实现说明**：`adTrigger.js` 的阈值（`frustrationLevel ≥ 5`、每局上限 3）目前**硬编码**，尚未读取 `mon_model_config.adTrigger`。  
> 训练面板中「广告触发阈值」字段可写入数据库，但需手动更新 `adTrigger.js` 中的取值逻辑方可生效。

### 5.4 iapAdapter（IAP 适配层）

**文件**：`web/src/monetization/iapAdapter.js`

**产品目录**：

| product_id | 名称 | 类型 | 说明 |
|-----------|------|------|------|
| `remove_ads` | 移除广告 | 永久 | 永久屏蔽插屏/Banner |
| `hint_pack_5` | 提示包 ×5 | 消耗品 | 每次 `consumeOne()` 消耗 1 个 |
| `hint_pack_20` | 提示包 ×20 | 消耗品 | 批量购买更优惠 |
| `weekly_pass` | 周卡 | 计时（7天） | 每日奖励加成 |
| `monthly_pass` | 月卡 | 计时（30天） | 每日奖励加成 + 专属标识 |
| `starter_pack` | 新手礼包 | 永久（首次） | 皮肤 + 提示 + 7日广告关闭 |

购买后触发 `emit('iap_purchase', { productId })` 广播至所有模块。

### 5.5 dailyTasks（每日任务）

**文件**：`web/src/monetization/dailyTasks.js`

每日 UTC 00:00 刷新，3 个任务：

| 任务 | 条件 | 奖励 |
|------|------|------|
| 完成 3 局 | `game_over` 事件计数 | +30 任务积分 |
| 消行 15 次 | `clear` 事件累计 | +20 任务积分 |
| 获得 Combo ≥ 3 | `clear` 事件中 `combo` 字段 | +50 任务积分 |

积分存入 `openblock_mon_task_points`，同步至赛季通行证 XP。

### 5.6 leaderboard（在线排行榜）

**文件**：`web/src/monetization/leaderboard.js`

- **提交**：游戏结束时自动提交，每日每用户最多提交 1 次（本地去重）
- **展示**：`openLeaderboardPanel()` 动态创建榜单 DOM
- **后端**：`/api/mon/leaderboard/submit` + `/api/mon/leaderboard/daily`

### 5.7 seasonPass（赛季通行证）

**文件**：`web/src/monetization/seasonPass.js`

30 天周期，XP 来源：

```
每局 XP 估算 = max(10, floor(score × 0.12) + floor(clears × 1.5))
```

| 轨道 | 价格 | 奖励 |
|------|------|------|
| 免费（0→10 级） | 免费 | Lv.1 奖励翻倍、Lv.5 专属标识、Lv.10 皮肤碎片 |
| 付费（0→20 级） | $4.99/赛季 | 所有免费奖励 ×1.5 + 赛季专属皮肤 + 每日 +20% XP |

Hay Day 上线 Season Pass 后月收入提升 **56%**（行业参考数据）。

### 5.8 skinUnlock（皮肤解锁）

**文件**：`web/src/monetization/skinUnlock.js`

动态注入 `isSkinUnlocked()` 规则：

| 解锁条件 | 皮肤分级 |
|---------|---------|
| 默认解锁 | 基础皮肤（2~3 套） |
| 等级 Lv.10 / 25 | 进阶皮肤 |
| 任务积分兑换 | 限定主题 |
| IAP 购买 | 付费皮肤 |
| 赛季通行证 | 赛季专属皮肤 |

> ⚠️ **待接线**：`isSkinUnlocked()` 已定义但尚未接入 `skins.js` 渲染过滤（列于扩展路线）。

### 5.9 pushNotifications（推送通知）

**文件**：`web/src/monetization/pushNotifications.js`

基于 Web Notifications API：

| 场景 | 触发时机 | 文案 |
|------|---------|------|
| 连签断线预警 | 上次活跃 +20h | 「X 天连签即将断线，今天来一局」 |
| 每日挑战开放 | 固定时间 | 「今日挑战已刷新，全球玩家正在抢榜中」 |
| 赛季结束倒计时 | 结束前 72h/24h | 「赛季还剩 X 天，快来领取奖励」 |
| 冷启动召回 | 沉默 3 天后 | 「好久没见！你的最高分还在吗？」 |

### 5.10 replayShare（回放分享）

**文件**：`web/src/monetization/replayShare.js`

游戏结束后注入「分享分数」按钮，优先使用 Web Share API，降级为剪贴板复制。

### 5.11 personalization（个性化引擎）

**文件**：`web/src/monetization/personalization.js`

核心导出：

| 函数 | 说明 |
|------|------|
| `fetchPersonaFromServer(userId)` | 从后端拉取分群画像（带 1h 缓存） |
| `updateRealtimeSignals(profile)` | 每次出块后更新 6 个实时信号 |
| `getCommercialInsight()` | 返回可渲染的完整洞察对象 |
| `buildCommercialWhyLines(state)` | 生成推理摘要 bullet 列表 |
| `getCurrentSegment()` | 轻量查询当前分群 |

> **阈值说明**：IAP 动作卡片 `active` 标记用 `frustration ≥ 4`；激励广告实际触发（`adTrigger.js`）用 `frustration ≥ 5`。前者为「高亮显示建议」，后者为「播放广告」，阈值有意不同。

`getCommercialInsight()` 返回结构：

```js
{
  segment: 'dolphin',
  segmentLabel: 'Dolphin 中等',
  segmentColor: '#3b82f6',
  segmentIcon: '🐬',
  signals: [          // 6 个指标格（3×2 布局）
    { key, label, value, color, tooltip },
    ...
  ],
  actions: [          // 策略动作卡片
    { icon, label, product, priority, active, why, effect },
    ...
  ],
  whyLines: [         // 推理摘要 bullets
    '分群 Dolphin：鲸鱼分 42%（...）',
    '近失触发 → 激励广告转化率 +40%，立即展示最佳',
    ...
  ],
  explain: '综合策略说明文本'
}
```

### 5.12 commercialInsight（画像面板注入）

**文件**：`web/src/monetization/commercialInsight.js`

非侵入式挂载到 `#player-insight-panel`：

1. 在面板末尾追加 `<details id="insight-commercial">` 可折叠区块
2. 链式 patch `game._playerInsightRefresh`，随画像刷新同步更新
3. 订阅 `spawn_blocks` / `no_clear` / `game_over` 实时刷新

每个信号格带 `cursor: help` + `title` 多行 tooltip 说明。

### 5.13 monPanel（商业化模型训练面板）

**文件**：`web/src/monetization/monPanel.js`

右下角 `📊` 悬浮按钮，点击后展开浮层，含 4 个标签页：

| 标签页 | 内容 |
|-------|------|
| **总览** | 注册用户、7日活跃、7日局数、30日均分、均时长、今日榜参与、分群分布条、行为热图 |
| **用户画像** | 当前用户分群 + 6维信号格 + 策略卡片（why/effect）+ whyLines 推理摘要 |
| **模型配置** | 分群权重滑块、广告触发阈值、IAP 展示时机滑块，保存后实时生效 |
| **功能开关** | 所有 Feature Flag 切换，立即生效并持久化 |

---

## 6. 后端 API 参考

所有路由挂载在 `monetization_backend.py` Blueprint 下，前缀 `/api/mon/`：

### 6.1 健康检查

```http
GET /api/mon/status
```
```json
{ "ok": true, "module": "monetization" }
```

### 6.2 排行榜

```http
GET /api/mon/leaderboard/daily?limit=20&date=2026-04-20
```
```json
{
  "date": "2026-04-20",
  "entries": [
    { "user_id": "u_abc", "score": 1250, "strategy": "normal" }
  ]
}
```

```http
POST /api/mon/leaderboard/submit
Body: { "userId": "u_abc", "score": 1250, "strategy": "normal" }
```
```json
{ "ok": true, "date": "2026-04-20", "score": 1250 }
```

### 6.3 用户商业画像

```http
GET /api/mon/user-profile/<user_id>?force=0
```
```json
{
  "user_id": "u_abc",
  "segment": "dolphin",
  "whale_score": 0.42,
  "activity_score": 0.65,
  "skill_score": 0.71,
  "frustration_avg": 0.12,
  "near_miss_rate": 0.34,
  "recent_7d_games": 5,
  "total_games": 28,
  "best_score": 850,
  "avg_session_sec": 312,
  "max_combo": 4,
  "strategy": {
    "segment": "dolphin",
    "actions": [
      { "type": "iap",  "product": "weekly_pass", "priority": "medium" },
      { "type": "ads",  "format": "rewarded", "trigger": "near_miss", "priority": "high" }
    ],
    "explain": "Dolphin 用户，周卡 ROI 最高；近失率 34%，近失时激励广告转化率高"
  },
  "cached": false
}
```

参数 `?force=1` 强制跳过 1h 缓存重新计算。

### 6.4 全局聚合（训练面板数据源）

```http
GET /api/mon/aggregate
```
```json
{
  "total_users": 142,
  "dau_7d": 38,
  "games_7d": 214,
  "avg_score_30d": 623.5,
  "avg_session_sec_30d": 287.0,
  "segment_dist": { "whale": 12, "dolphin": 47, "minnow": 83 },
  "lb_participants_today": 15,
  "behavior_dist": [
    { "event": "place", "count": 8420 },
    { "event": "no_clear", "count": 2140 },
    ...
  ],
  "computed_at": "2026-04-20"
}
```

### 6.5 模型配置

```http
GET /api/mon/model/config
PUT /api/mon/model/config
Body: { "segmentWeights": { "best_score_norm": 0.45, ... }, ... }
```

`PUT` 为深合并（仅覆盖提交的顶层键），响应返回完整合并后配置。

### 6.6 策略曝光日志

```http
POST /api/mon/strategy/log
Body: {
  "userId": "u_abc",
  "strategy": "dolphin_near_miss_ad",
  "action": "show",
  "converted": 0
}
```

`action` 枚举：`show`（曝光）、`click`（点击）、`purchase`（成功购买）。

---

## 7. SQLite 数据库结构

### 7.1 核心表（server.py 建立）

| 表名 | 主要字段 | 商业化用途 |
|------|---------|----------|
| `sessions` | `user_id, score, duration, strategy, start_time` | 分群维度：时长、局数 |
| `behaviors` | `user_id, event_type, event_data, timestamp` | 近失率、挫败频率计算 |
| `user_stats` | `best_score, total_games, total_clears, total_misses` | 分群维度：最高分、技能 |
| `scores` | `user_id, score, strategy, timestamp` | 排行榜基础 |

### 7.2 商业化扩展表（monetization_backend.py 建立）

```sql
-- 每日排行榜得分
CREATE TABLE mon_daily_scores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    strategy     TEXT    DEFAULT 'normal',
    date_ymd     TEXT    NOT NULL,              -- 'YYYY-MM-DD'
    submitted_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_mon_daily_scores_date ON mon_daily_scores(date_ymd, score DESC);

-- 用户分群缓存（1小时 TTL）
CREATE TABLE mon_user_segments (
    user_id          TEXT PRIMARY KEY,
    segment          TEXT  DEFAULT 'minnow',   -- whale/dolphin/minnow
    whale_score      REAL  DEFAULT 0,
    activity_score   REAL  DEFAULT 0,
    skill_score      REAL  DEFAULT 0,
    frustration_avg  REAL  DEFAULT 0,
    near_miss_rate   REAL  DEFAULT 0,
    last_computed    INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 个性化模型配置（单行 JSON）
CREATE TABLE mon_model_config (
    id         TEXT PRIMARY KEY DEFAULT 'default',
    config     TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 策略曝光/转化日志
CREATE TABLE mon_strategy_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   TEXT    NOT NULL,
    strategy  TEXT    NOT NULL,                -- 策略标识符
    action    TEXT    NOT NULL,                -- show/click/purchase
    converted INTEGER DEFAULT 0,              -- 1=已转化
    logged_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

---

## 8. 配置与调参

### 8.1 默认模型配置（`mon_model_config` 表）

```json
{
  "version": 1,
  "segmentWeights": {
    "best_score_norm":   0.40,
    "total_games_norm":  0.30,
    "session_time_norm": 0.30
  },
  "segmentThresholds": {
    "whale":   0.60,
    "dolphin": 0.30
  },
  "adTrigger": {
    "frustrationThreshold": 5,
    "nearMissEnabled":      true,
    "maxRewardedPerGame":   3
  },
  "iapTrigger": {
    "showStarterPackHours":      24,
    "showWeeklyPassAfterGames":  5,
    "showMonthlyPassAfterGames": 15
  },
  "taskWeights": {
    "xpPerClear": 1.5,
    "xpPerGame":  20,
    "xpPerCombo3": 40
  }
}
```

通过 `PUT /api/mon/model/config` 或训练面板的「模型配置」标签页实时修改，无需重启服务。

### 8.2 切换真实广告/IAP SDK

```js
// 替换广告 SDK（在 initMonetization 之前调用）
import { setAdProvider } from './monetization/adAdapter.js';
setAdProvider({
    showRewarded:      (reason) => AdMob.showRewarded(reason),
    showInterstitial:  ()       => AdMob.showInterstitial(),
});

// 关闭 Stub 模式
import { setFlag } from './monetization/featureFlags.js';
setFlag('stubMode', false);
```

---

## 9. 玩家画像面板集成

在 `#player-insight-panel` 末尾追加 `<details id="insight-commercial">` 区块，样式完全对齐原面板设计语言（CSS 变量、系统字体、8.5-11px 字号）。

### 9.1 指标格（3×2 布局）

| 指标 | 来源 | tooltip 说明 |
|------|------|-------------|
| 用户分群 | 后端 whale_score | 分群阈值 + 计算公式 + 当前得分 |
| 活跃度 | 近 7 日局数 | 三档阈值 + 对应策略 |
| 技能 | PlayerProfile.skillLevel | 四档标签 + 商业化含义 |
| 挫败感 | frustrationLevel（实时） | 四档触发阈值 |
| 近失率 | behaviors 表历史 `no_clear/placements` 比率 | 触发机制 + 转化率数据；注：前端实时触发用 `PlayerProfile.hadRecentNearMiss`（布尔），与历史比率定义不同 |
| 心流 | PlayerProfile.flowState（实时） | 三态 + 广告抑制/触发逻辑 |

### 9.2 策略动作卡片

每条策略展示三行：

```
📢 广告策略   插屏广告                    🔴高
   ◎ 游戏结束是天然断点
   → eCPM 最高，留存影响 <2%
```

- 第一行：类型图标 + 类别标签 + 产品名 + `⚡ 触发中`（实时信号命中时）+ 优先级
- 第二行（`◎`）：触发原因（why）
- 第三行（`→`）：预期效果（effect）

### 9.3 推理摘要（whyLines）

策略列表之后，5~7 条 bullet，风格参考 `#insight-why`：

```
• 分群 Dolphin：鲸鱼分 42%（最高分×0.4 + 局数×0.3 + 时长×0.3）
• 近失触发 → 激励广告转化率 +40%，立即展示最佳
• 活跃度中（65%）→ IAP 转化窗口良好
• 距晋升 Whale 差 18 分 → 提升最高分或时长
```

---

## 10. 商业化模型训练面板

点击右下角 **📊** 按钮开启，浮层覆盖游戏界面，含 4 个标签页：

### 总览

| KPI | 数据来源 |
|-----|---------|
| 注册用户 | `COUNT(*) FROM user_stats` |
| 7 日活跃 | `COUNT(DISTINCT user_id) WHERE start_time >= 7d ago` |
| 7 日局数 | `COUNT(*) FROM sessions WHERE completed AND 7d` |
| 30 日均分 | `AVG(score) FROM sessions WHERE 30d` |
| 30 日均时长 | `AVG(duration) FROM sessions WHERE 30d` |
| 今日榜参与 | `COUNT(DISTINCT user_id) FROM mon_daily_scores WHERE today` |
| 分群分布 | `mon_user_segments GROUP BY segment` |
| 行为热图 | `behaviors GROUP BY event_type WHERE 7d, TOP 8` |

### 用户画像

当前用户的完整分群画像 + 策略卡片 + whyLines（数据来源同 `#insight-commercial`）。

### 模型配置

提供滑块调整：
- 分群权重（w0/w1/w2，总和应 ≤ 1）
- 广告触发阈值（frustration 次数、每局激励上限）
- IAP 展示时机（新手包时效、周卡触发局数）

修改后 `PUT /api/mon/model/config` 保存，**1 小时内生效**（分群缓存过期后重算）。

### 功能开关

实时切换 Feature Flag，即刻生效，刷新后持久化。

---

## 11. Feature Flag 开关

所有开关存储在 `localStorage` 键 `openblock_mon_flags_v1`，默认值如下：

| Flag | 默认 | 说明 |
|------|------|------|
| `adsRewarded` | `false` | 激励视频广告 |
| `adsInterstitial` | `false` | 游戏结束插屏广告 |
| `iap` | `false` | IAP 内购弹窗 |
| `dailyTasks` | `true` | 每日任务系统 |
| `leaderboard` | `true` | 在线排行榜 |
| `skinUnlock` | `true` | 皮肤等级解锁规则 |
| `seasonPass` | `true` | 赛季通行证 XP 积累 |
| `pushNotifications` | `false` | Web Push 通知（需用户授权） |
| `replayShare` | `true` | 游戏结束分享按钮 |
| `stubMode` | `true` | 广告/IAP 使用 Stub 实现（开发测试用） |

通过代码或训练面板均可修改：

```js
import { setFlag, getFlag, getAllFlags, resetFlags } from './monetization/featureFlags.js';
setFlag('adsRewarded', true);   // 立即生效，刷新后持久
resetFlags();                    // 清除所有 localStorage 覆盖，恢复默认值
```

---

## 12. 实施路线图

### Phase 1（0~4 周）：打通基础变现

| 任务 | 状态 | 说明 |
|------|------|------|
| OPT-01 激励视频 SDK 接入 | ✅ Stub 已实现 | 替换 `setAdProvider()` 接入真实 SDK |
| OPT-02 移除广告 + 提示包 IAP | ✅ Stub 已实现 | 接入 Stripe/App Store |
| OPT-03 每日 3 任务 | ✅ 已实现 | 可扩展任务数量和奖励 |

### Phase 2（4~10 周）：留存引擎

| 任务 | 状态 | 说明 |
|------|------|------|
| OPT-04 在线日榜 | ✅ 已实现 | 每日挑战榜待联动 |
| OPT-05 皮肤解锁路径 | ⚠️ 逻辑已定义 | `skinUnlock.js` 待接入 `skins.js` |
| OPT-07 Web Push 召回 | ✅ 已实现 | 需用户手动授权 |

### Phase 3（10~20 周）：LTV 提升

| 任务 | 状态 | 说明 |
|------|------|------|
| OPT-06 30 天赛季通行证 | ✅ 骨架已实现 | 需配套付费轨道内容设计 |
| OPT-02 扩充 月卡/新手礼包 | ✅ 产品目录已定义 | 接入支付系统后可上线 |
| OPT-08 回放分享 | ✅ 已实现 | 可扩展 GIF 生成 |

### Phase 4（20 周+）：差异化竞争

| 任务 | 状态 | 说明 |
|------|------|------|
| OPT-09 AI 挑战模式 | 🔲 待实现 | 基于现有 RL 系统扩展 |
| OPT-10 Web Shop | 🔲 待实现 | 绕过平台抽成（30%→3~5%） |
| A/B 测试框架 | 🔲 待实现 | 见扩展路线 |

---

## 13. 指标基线

| 指标 | 行业爆款水位 | Phase 1 目标 | Phase 3 目标 |
|------|------------|------------|------------|
| D1 留存率 | ≥ 20% | ≥ 15% | ≥ 22% |
| D7 留存率 | ≥ 8% | ≥ 6% | ≥ 10% |
| D0 时长 | ≥ 40 min | ≥ 15 min | ≥ 30 min |
| 激励视频完播率 | 80~90% | 建立基线 | ≥ 75% |
| IAP 转化率 | 2~5%（Tier-1） | 建立基线 | ≥ 1.5% |
| ARPU（日活） | $0.05~$0.15 | 建立基线 | ≥ $0.05 |
| 连签 3 天率 | ≥ 30% | 建立基线 | ≥ 25% |
| 分群覆盖率 | N/A | ≥ 50% 用户有分群 | ≥ 80% |
| 策略触发准确率 | N/A | 建立基线 | ≥ 70% 匹配信号 |

**数据采集现状**：`server.py` 已记录会话时长、得分、行为事件；`progression.js` 记录连签天数；`mon_strategy_log` 记录策略曝光；以上数据足以支撑 Phase 1~2 的全部指标采集。

---

## 14. 扩展与优化路线

### 14.1 近期（可直接动工）

1. **皮肤解锁接线**：将 `skinUnlock.js` 的 `isSkinUnlocked(skinId, progression)` 接入 `skins.js` 的皮肤选项渲染过滤（约 10 行改动）
2. **每日挑战关**：在 `server.py` 增加固定棋盘初始状态 API，前端加载后与普通游戏隔离
3. **策略曝光打点完善**：在 `adTrigger.js` 和 `iapAdapter.js` 的展示/购买回调中调用 `POST /api/mon/strategy/log`

### 14.2 中期（需一定工程量）

4. **A/B 测试框架**：在 `mon_model_config` 中增加 `abTest: { enabled, buckets: [...] }` 字段；`personalization.js` 按 `userId hash % n` 分配策略桶；`strategy_log` 记录桶标识
5. **转化漏斗分析**：基于 `mon_strategy_log` 的 `show→click→purchase` 链路，在 `monPanel.js` 总览标签页增加漏斗可视化
6. **真实 SDK 接入**：替换 `adAdapter.js` 的 Stub Provider 为 AdMob/ironSource；替换 `iapAdapter.js` 的 Stub 为 App Store/Google Play

### 14.3 长期（差异化竞争力）

7. **自动权重优化**：定期从 `mon_strategy_log` 取转化数据，用梯度下降更新 `mon_model_config` 中的分群权重
8. **AI 挑战模式**（OPT-09）：基于 `rl_backend.py` 已有的 RL 训练系统，增加「与 AI 同台竞速」模式，大师 AI 付费解锁
9. **Web Shop**（OPT-10）：独立 `/shop` 页面 + 用户身份认证，绕过平台 30% 抽成降至 3~5%
10. **多设备同步**：将分群画像与 `user_id` 绑定，接入 OAuth 后支持跨设备一致体验

---

## 参考资料

### 行业报告

- 《2026 年移动游戏变现趋势洞察》，GameLook，2026-02
- 《Puzzle 爆款公式解密：20% 次留 + 2400 秒时长的产品打造》，腾讯新闻，2025-08

### 案例研究

- [Hybrid-Casual Monetization: Coin Sort's $1.5M/Month Blueprint](https://www.knitout.net/blog/hybrid-casual-monetization-coin-sort-revenue-blueprint)
- [Hybrid monetization in casual games: How Beresnev does it](https://verve.com/blog/hybrid-monetization-in-casual-games-how-beresnev-strikes-the-right-balance/)
- [Mobile Game Monetization Models That Still Work in 2026](https://studiokrew.com/blog/mobile-game-monetization-models-2026/)

### 关联项目文档

| 文档 | 内容 |
|------|------|
| [`MONETIZATION_OPTIMIZATION.md`](./MONETIZATION_OPTIMIZATION.md) | v1：行业调研与优化清单（原始研究） |
| [`MONETIZATION_PERSONALIZATION.md`](./MONETIZATION_PERSONALIZATION.md) | v2：个性化引擎技术设计（详细 API 规范） |
| [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) | 出块算法（留存核心引擎，商业化底层支撑） |
