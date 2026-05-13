# MonetizationBus 事件契约

> 本文档定义 OpenBlock 商业化、生命周期与广告系统在
> [`web/src/monetization/MonetizationBus.js`](../../web/src/monetization/MonetizationBus.js)
> 上交换的事件，包含**显式事件**与**通过 `attach(game)` 透传的游戏事件**两类。
> 新模块订阅或 emit 时以本文档为单一权威源。

## 1. 总线机制

```
┌─────────────────────────┐   emit    ┌──────────────────────┐   on    ┌──────────────────────┐
│ 业务模块                │  ────►    │ MonetizationBus      │  ────►  │ 订阅方               │
│  - iapAdapter           │           │ (轻量发布订阅 + 关停) │         │  - lifecycleAwareOffers│
│  - adAdapter            │           └──────────────────────┘         │  - offerToast          │
│  - lifecycleOrchestrator│                                            │  - lifecycleOutreach   │
│  - dailyTasks / seasonPass / ...                                     │  - analyticsTracker    │
└─────────────────────────┘                                            └──────────────────────┘
```

`MonetizationBus` 提供五个 API：`on(type, handler)`、`off(type, handler)`、
`emit(type, data)`、`attach(game)`、`detach()`。

`attach(game)` 会包装 `game.logBehavior(eventType, data)`：原始逻辑保留；同时把
**任意** `eventType` 转发到总线，从而所有游戏行为事件（`game_over` /
`spawn_blocks` / `no_clear` / …）都可在不修改 `game.js` 的前提下被商业化模块
订阅。

设计约束：

- **事件名稳定**：发布即视为 public API；新增子类型用 `payload.type` 区分而不是
  引入新事件名。
- **payload 单向**：事件不接受订阅者返回值；如需双向通信用单独的请求/响应 API
  （如 `getActiveWinbackPreset()`）。
- **失败软化**：总线在调用每个 handler 时已 `try/catch` 并打 `console.error`；
  订阅方仍应自行处理业务异常。
- **追加只增不改**：删除字段需走废弃 → 1 个版本的过渡。

## 2. 显式事件

### 2.1 生命周期编排（`lifecycle/lifecycleOrchestrator.js`）

| 事件 | payload | 触发时机 | 主要订阅方 |
|---|---|---|---|
| `lifecycle:session_start` | `{ snapshot, winback }` | `onSessionStart` 末尾 | `lifecycleAwareOffers`、`pushNotificationManager` |
| `lifecycle:session_end` | `{ snapshot, churnUpdate, churnLevel, winback, earlyWinback, firstPurchaseSignal, interventions }` | `onSessionEnd` 末尾 | `lifecycleAwareOffers`、`analyticsDashboard` |
| `lifecycle:intervention` | `{ type, priority, content, reason, snapshot }` | `shouldTriggerIntervention` 命中 | 推送 / 弹窗 / 任务系统 |
| `lifecycle:offer_available` | 见下表 | 多路 emit | `offerToast`、`lifecycleOutreach` |
| `lifecycle:early_winback` | `{ reason, score, signals, snapshot }` | `evaluateEarlyWinbackSignal.trigger=true` | `offerToast`、`lifecycleOutreach` |

### 2.2 生命周期 offer / IAP（`monetization/lifecycleAwareOffers.js`）

| 事件 | payload | 触发时机 |
|---|---|---|
| `lifecycle:offer_available` | `{ type, stage, band, reason, offer? }` | `_onSessionStart` 三路：`winback_user`、`first_purchase`、复购 |
| `lifecycle:churn_high` | `{ level, unifiedRisk, sources, stage, band }` | `_onSessionEnd`：`unifiedRisk ≥ 0.5` 或 `churnLevel ∈ {high, critical}` |
| `lifecycle:first_purchase` | `{ productId, price, currency }` | `_onPurchaseCompleted`：`firstPurchaseFunnel.recordPurchase` 返回 `isFirst=true` |

`lifecycle:offer_available` 的 `type` 全集（来自所有 emit 点）：

| `type` | 触发模块 | 含义 |
|---|---|---|
| `winback_user` | `lifecycleAwareOffers` | 沉默 7 天回流候选 |
| `first_purchase` | `lifecycleAwareOffers` | 首充漏斗窗口 |
| 业务定义的 `nextOffer.type` | `lifecycleAwareOffers` | 复购窗口（如 `weekend_special`） |
| `early_winback` | `lifecycleOrchestrator` | 提前挽留窗口 |
| `first_purchase_window` | `lifecycleOrchestrator` | 首充时机优化 |

### 2.3 IAP 结算（`monetization/iapAdapter.js`）

| 事件 | payload | 触发时机 |
|---|---|---|
| `purchase_completed` | `{ productId, product, price, currency, transactionId, timestamp }` | 任意 IAP 结算成功 |
| `iap_purchase` | `{ productId, product }` | 同上，向后兼容（旧订阅方） |

`iap_purchase` 与 `purchase_completed` 是**双 emit**：`purchase_completed` 是首选载荷，
`iap_purchase` 仅供老订阅方继续读取 `productId`。

订阅链（`lifecycleAwareOffers._onPurchaseCompleted` 监听
`purchase_completed`）：

```
purchase_completed
  ├─► firstPurchaseFunnel.recordPurchase
  ├─► vipSystem.updateVipScore (price * VIP_SCORE_PER_RMB)
  ├─► paymentManager.recordPurchase（首充奖励 / 触发后续 promo）
  ├─► analyticsTracker.trackEvent('iap_purchase', { productId, price, currency, isFirst, transactionId })
  └─► emit('lifecycle:first_purchase', { productId, price, currency })  // 仅 isFirst=true
```

### 2.4 广告（`monetization/adAdapter.js`）

| 事件 | payload | 触发时机 |
|---|---|---|
| `ad_show` | `{ type: 'rewarded' \| 'interstitial', reason? }` | 广告 UI 即将出现 |
| `ad_complete` | `{ type, reason?, rewarded: boolean }` | 广告流程结束（含完播标记） |

订阅方 `analyticsTracker.funnels.AD_WATCH` 通过 `ad_show` / `ad_complete` 推进
`ad_trigger → ad_show → ad_complete → ad_revenue` 漏斗。

### 2.5 任务与赛季（`monetization/dailyTasks.js`、`monetization/seasonPass.js`）

| 事件 | payload | 触发时机 |
|---|---|---|
| `daily_task_complete` | `{ task }` | `dailyTasks.markComplete` 触发任务通过 |
| `season_tier_unlocked` | `{ tier, track: 'free' \| 'paid' }` | `seasonPass` 解锁新阶 |

## 3. 通过 `attach(game)` 透传的游戏事件

`MonetizationBus.attach(game)` 会拦截 `game.logBehavior(eventType, data)`，把
**任意** `eventType` 转发到总线。常见订阅点：

| 事件 | 订阅方 | 用途 |
|---|---|---|
| `game_over` | `adTrigger`（插屏触发） | 局末插屏 + commercial guardrail |
| `spawn_blocks` | `commercialInsight` | 写入实时提示 / 行为度量 |
| `no_clear` | `commercialInsight`、`adTrigger`（near_miss 检测） | 触发激励广告 / 挫败提示 |
| `score_update` | （可选）`commercialInsight` | 高分弹幕 / 庆祝特效 |

游戏侧未来新增 `logBehavior` 事件名时无需修改本契约，订阅方按需对接即可；但
**新事件名一旦被任何商业化模块订阅，即应在本节登记**。

## 4. 订阅方索引

| 订阅方 | 关注事件 | 关键动作 |
|---|---|---|
| `lifecycleAwareOffers` | `purchase_completed`、`lifecycle:session_start`、`lifecycle:session_end` | funnel/VIP/analytics 三路回写、根据 lifecycle 触发 LIMITED_OFFERS |
| `offerToast` | `lifecycle:offer_available`、`lifecycle:first_purchase`、`lifecycle:churn_high`、`lifecycle:early_winback` | 显示 UI Toast，cooldown 24h |
| `lifecycleOutreach` | 同上 | push 通知 + 分享卡生成 |
| `analyticsTracker.funnels.AD_WATCH` | `ad_show`、`ad_complete` | 漏斗推进 |
| `commercialInsight` | `spawn_blocks`、`no_clear`、`game_over` | 把 commercialModel vector + insights 写到玩家面板 |
| `actionOutcomeMatrix` | `purchase_completed`、`ad_complete`、`lifecycle:session_end` | 推荐 action × 结果归因 |
| `adTrigger` | `game_over`、`no_clear` | 插屏 + 激励广告频控 / 触发 |

## 5. 测试覆盖

| 测试文件 | 验证 |
|---|---|
| [`tests/lifecycleSignals.test.js`](../../tests/lifecycleSignals.test.js) | session_start/end + intervention + offer_available 链路 |
| [`tests/lifecycleOutreach.test.js`](../../tests/lifecycleOutreach.test.js) | push/share 适配器 |
| [`tests/adAdapterEvents.test.js`](../../tests/adAdapterEvents.test.js) | `ad_show` / `ad_complete` emit |
| [`tests/winbackEarlySignal.test.js`](../../tests/winbackEarlySignal.test.js) | early winback 规则 + RL 接口 |
| [`tests/adInsertionRL.test.js`](../../tests/adInsertionRL.test.js) | 状态特征 + 奖励 + 策略 |
| [`tests/firstPurchaseTiming.test.js`](../../tests/firstPurchaseTiming.test.js) | 首充时机信号 |
| [`tests/adTrigger.test.js`](../../tests/adTrigger.test.js) | 广告频控 / 护栏 |
| [`tests/actionOutcomeMatrix.test.js`](../../tests/actionOutcomeMatrix.test.js) | Bus 自动接线 + 30 分钟 attribution |

## 6. 与事件相关的 Feature Flag

下列 flag 直接影响**事件是否被 emit / 是否被订阅方处理**。完整 flag 清单见
[`web/src/monetization/featureFlags.js`](../../web/src/monetization/featureFlags.js)。

| Flag | 默认 | 影响事件 / 行为 |
|---|---|---|
| `lifecycleOfferToast` | true | `offerToast` 总开关 |
| `abilityCommercial` | true | `commercialModel` 引入 abilityVector bias |
| `dynamicPricing` | true | `paymentManager` stage×risk 动态折扣 |
| `firstPurchaseTiming` | true | `lifecycle:offer_available type=first_purchase_window` 是否 emit |
| `ltvAdShield` | true | 高 LTV 玩家插屏 70% 概率跳过 → 影响 `ad_show` 频率 |
| `adDecisionEngine` | false | `adTrigger.on('game_over')` 是否委托 `adDecisionEngine.requestAd` |
| `adInsertionRL` | false | RL scaffolding 介入广告类型选择 |
| `adInsertionBandit` | false | LinUCB bandit 介入 ad insertion 决策 |
| `pushNotifications` | false | `lifecycleOutreach` 是否真发 push |
| `actionOutcomeMatrix` | true | Bus 是否自动 attach action-outcome 记录 |
| `commercialModelQualityRecording` | true | 是否在 commercial 决策时调用 `recordSample` |
| `distributionDriftMonitoring` | true | 是否在 `buildCommercialModelVector` 时累积 KL 直方图 |

## 7. 关联文档

- [`LIFECYCLE_DATA_STRATEGY_LAYERING.md`](./LIFECYCLE_DATA_STRATEGY_LAYERING.md) —— 数据→信号→策略分层
- [`../algorithms/ALGORITHMS_MONETIZATION.md`](../algorithms/ALGORITHMS_MONETIZATION.md) —— 商业化算法手册
- [`../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`](../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 模型架构与决策包装
- [`../operations/MONETIZATION.md`](../operations/MONETIZATION.md) —— 商业化系统全景与运行时 API
