# 生命周期 / 成熟度策略架构：数据层 + 编排层 + 策略层

**适用**：Web 客户端 + 小程序（小程序按本文 §6 同步）
**关联模块**：`web/src/lifecycle/*`、`web/src/playerProfile.js`、`web/src/playerAbilityModel.js`、`web/src/adaptiveSpawn.js`、`web/src/monetization/*`、`web/src/retention/*`
**配套蓝图**：[`operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md`](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)

---

## 1. 背景：四套成熟度家族 + 三套流失风险并存

历史上，"生命周期 / 成熟度"信号源散落在 4 个互不归一的实现里：

| 家族                                 | 入口                                                         | 输出标签                              | 主要消费方                                  |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------- |
| `PlayerProfile.isNewPlayer / isInOnboarding / returningWarmupStrength` | `web/src/playerProfile.js`                                   | bool / 0..1                           | `adaptiveSpawn`、`commercialModel`          |
| `playerLifecycleDashboard.getPlayerLifecycleStage` | `web/src/retention/playerLifecycleDashboard.js`              | `onboarding..veteran` (5 段) + S0..S4 | `strategyAdvisor`、`socialIntroTrigger`     |
| `playerMaturity.getPlayerMaturity / getMaturityBand` | `web/src/retention/playerMaturity.js`                        | L1..L4 / M0..M4                       | `difficultyAdapter`、`commercialInsight`    |
| `playerProfile.segment5`             | `web/src/playerProfile.js`                                   | A..E                                  | `adaptiveSpawn` (B 类挑战档)、`personalization` |

同期"流失风险"也有三套：

| 模型                                 | 入口                                                        | 输出范围   | 备注                                          |
| ------------------------------------ | ----------------------------------------------------------- | ---------- | --------------------------------------------- |
| `commercialModel.churnRisk`          | `web/src/monetization/commercialModel.js`                   | 0..1       | 规则模型加权 segment / frustration 等         |
| `churnPredictor.calculateChurnRisk`  | `web/src/retention/churnPredictor.js`                       | 0..100     | 近 7 天 vs 前 7 天会话 / 分数 / 时长下降率    |
| `playerMaturity._calculateChurnRisk` | `web/src/retention/playerMaturity.js`                       | 离散标签   | 历史 SkillScore 斜率                          |

三套流失各产出不同结果、上层模块各自挑一个使用 —— 同一个玩家在商业化、出块、运营干预里被打成不同档位，决策互相抵消。

更严重的是，6 个模块"已实装但生产代码无任何调用方"：

| 模块                                                    | 现状                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `churnPredictor.recordSessionMetrics`                   | 全仓 0 调用 → 整套流失风险评估退化为常量                                                    |
| `winbackProtection.getActivePreset / activateWinback`   | 全仓 0 调用 → 回流玩家无任何保护                                                            |
| `playerLifecycleDashboard.shouldTriggerIntervention`    | 仅在 Dev Panel 渲染时调用 → 干预触发结果未流入推送 / 弹窗                                    |
| `firstPurchaseFunnel.getRecommendedOffer / recordPurchase` | 全仓 0 调用 → 首充漏斗永远不会触发                                                          |
| `vipSystem.updateVipScore`                              | 全仓 0 调用 → VIP 等级永远是初始 V0                                                         |
| `playerAbilityModel.getPlayerAbilityModel`              | 4 个商业化模块 import 期望 `{getPersona, getRealtimeState, getLTV}`，但本文件从未导出      |

## 2. 设计原则

> 底层采用尽可能统一的数据层，数据层负责指标定义、数据采集和数据存储；
> 在数据层之上，按照业务需求（如游戏体验出块、运营、商业化）进行策略设计和指标数据消费。

落地为三段式：

```
源数据 (PlayerProfile + retention/* + winbackProtection.localStorage)
        ↓
[ 数据层 ]   web/src/lifecycle/lifecycleSignals.js
              · 指标定义（unifiedSnapshot 字段契约）
              · 信号归一（4 套家族 / 3 套 churnRisk）
              · 缓存（300ms TTL）
              · 纯函数；不写 storage、不发事件
        ↓
[ 编排层 ]   web/src/lifecycle/lifecycleOrchestrator.js
              · 会话生命周期钩子（onSessionStart / onSessionEnd）
              · 把"上层数据触发"翻译成"retention 模块动作 + 总线事件"
              · 失败软化（try/catch）；可关闭（feature flag）
        ↓
[ 策略层 ]   按业务需求订阅 lifecycle:* 总线
              ┌────────────────┬───────────────────────┬────────────────────┐
              │ adaptiveSpawn  │ lifecycleAwareOffers  │ pushNotifications  │
              │ (出块体验)     │ (商业化)              │ (运营)             │
              └────────────────┴───────────────────────┴────────────────────┘
```

**关键约束**：

1. **单向依赖**：策略层 → 编排层 → 数据层 → 源数据。策略层不直接 import retention 模块；如需写副作用必须经编排层。
2. **总线解耦**：策略层之间只通过 `MonetizationBus` 的 `lifecycle:*` 事件通信，不互相 import。
3. **稳定契约**：数据层输出带 `schemaVersion`；字段集合扩展时单调升版。

## 3. 数据层契约

### 3.1 `getUnifiedLifecycleSnapshot(profile, options) -> UnifiedLifecycleSnapshot`

```ts
{
  schemaVersion: 1,
  install: {
    daysSinceInstall: number,    // PlayerProfile.daysSinceInstall
    totalSessions: number,       // PlayerProfile.totalSessions
    totalPlacements: number,     // PlayerProfile.lifetimePlacements
    lastActiveTs: number,        // ms epoch
  },
  onboarding: {
    isNewPlayer: boolean,        // PlayerProfile.isNewPlayer
    isInOnboarding: boolean,     // PlayerProfile.isInOnboarding
    spawnRoundIndex: number,
  },
  returning: {
    daysSinceLastActive: number,
    warmupStrength: number,             // 0..1, PlayerProfile.returningWarmupStrength
    isWinbackCandidate: boolean,        // ≥ TRIGGER_DAYS_SINCE_LAST_ACTIVE
    protectionActive: boolean,          // winbackProtection.getWinbackStatus().active
  },
  stage: {
    code: 'S0' | 'S1' | 'S2' | 'S3' | 'S3+' | 'S4',
    name: 'onboarding' | 'exploration' | 'growth' | 'stability' | 'veteran',
    confidence: number,          // 0..1, dashboard 算的
  },
  maturity: {
    level: 'L1' | 'L2' | 'L3' | 'L4',
    band: 'M0' | 'M1' | 'M2' | 'M3' | 'M4',  // M4 真实可达（SkillScore ≥ 90）
    skillScore: number,          // 0..100
    valueScore: number,          // 0..100
  },
  churn: {
    unifiedRisk: number,         // 0..1, 三源加权
    level: 'critical' | 'high' | 'medium' | 'low' | 'stable',
    sources: { predictor, maturity, commercial },  // 各原始值，缺失为 null
  },
  segment: {
    behaviorSegment: string,
    motivationIntent: string,
    segment5: 'A' | 'B' | 'C' | 'D' | 'E',
  },
}
```

### 3.2 `getUnifiedChurnRisk(opts) -> { unifiedRisk, level, sources }`

| 来源                      | 默认权重 | 说明                                           |
| ------------------------- | -------- | ---------------------------------------------- |
| `predictor` (churnPredictor) | 0.45     | 基于 14 天会话 / 分数 / 时长 / engagement 下降率，时效最敏感 |
| `maturity` (playerMaturity) | 0.35     | 基于近 5 局 SkillScore 斜率，对"突然变差"敏感 |
| `commercial` (commercialModel) | 0.20     | 基于 segment + 实时 frustration 等代理量       |

**任一来源缺失自动重算权重**（不归零）；**三源全空 → unifiedRisk=0, level='stable'**。

档位阈值：

```
[critical] >= 0.70
[high]     >= 0.50
[medium]   >= 0.30
[low]      >= 0.15
[stable]   <  0.15
```

### 3.3 缓存

`getCachedLifecycleSnapshot` 提供 300ms TTL，缓存 key 包含 `_installTs / _lastSessionEndTs / _totalLifetimeGames / predictorRisk01 / commercialChurnRisk01`。`recordSessionEnd` / `activateWinback` 后调用 `invalidateLifecycleSnapshotCache` 强制失效。

## 4. 编排层契约

### 4.1 `onSessionStart(profile, { tracker })`

在 `web/src/game.js → start()` 内的 `recordNewGame()` 之后调用：

1. 失效 snapshot 缓存
2. 取 `getUnifiedLifecycleSnapshot`
3. 若 `snapshot.returning.isWinbackCandidate` → `winbackProtection.activateWinback()`
4. emit `lifecycle:session_start` `{ snapshot, winback }`

### 4.2 `onSessionEnd(profile, sessionResult, { tracker })`

在 `web/src/game.js → endGame()` 内的 `recordSessionEnd()` 之后调用：

1. **写 churn 信号**（修复 P0-A）：
   ```js
   churnPredictor.recordSessionMetrics({
     sessionCount: 1, duration, score,
     engagement: 0.6 * min(1, duration/300_000) + 0.4 * (1 - misses/placements)
   })
   ```
2. **消耗 winback 保护**：`winbackProtection.consumeProtectedRound()`，达到 `PROTECTED_ROUNDS=3` 自动退出
3. 失效 snapshot 缓存，重新取 snapshot
4. **干预触发**：`shouldTriggerIntervention` 命中则按 trigger 列表 emit `lifecycle:intervention`
5. emit `lifecycle:session_end` `{ snapshot, churnUpdate, churnLevel, winback, interventions }`

### 4.3 总线事件契约（`MonetizationBus`）

| 事件                          | payload                                                        | 触发时机             | 期望订阅方                                         |
| ----------------------------- | -------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| `lifecycle:session_start`     | `{ snapshot, winback }`                                        | 每局开始             | `lifecycleAwareOffers`、`pushNotificationManager` |
| `lifecycle:session_end`       | `{ snapshot, churnUpdate, churnLevel, winback, earlyWinback, firstPurchaseSignal, interventions }` | 每局结束             | `lifecycleAwareOffers`、`analyticsDashboard`      |
| `lifecycle:intervention`      | `{ type, priority, content, reason, snapshot }`                | dashboard 命中干预条件 | 推送 / 弹窗 / 任务系统                             |
| `lifecycle:offer_available`   | `{ type, stage, band, offer, reason, priority?, recommendedOfferId? }` | `lifecycleAwareOffers` 触发 offer / **早回流** / **首充时机** | banner / 弹窗 / IAP UI / `offerToast` / `lifecycleOutreach` push |
| `lifecycle:churn_high`        | `{ level, unifiedRisk, sources, stage, band }`                 | unifiedRisk ≥ 0.5    | 推送 / 任务奖励兜底                                |
| `lifecycle:early_winback`     | `{ reason, score, signals, snapshot }`                         | confidence 衰减 + 沮丧叠加触发（玩家未达 7 天阈值但已有流失信号） | `offerToast`、`lifecycleOutreach` push |
| `lifecycle:first_purchase`    | `{ productId, price, isFirst:true, transactionId, ts }`        | 首充成功             | `offerToast`、`lifecycleOutreach`（生成首充分享卡） |
| `purchase_completed`          | `{ productId, price, currency, transactionId, timestamp }`     | IAP 结算成功（统一事件名）         | `lifecycleAwareOffers` → funnel/VIP/analytics 三路回写 |
| `iap_purchase`                | `{ productId, price, currency, isFirst }`                      | 同上（兼容旧订阅方，与 `purchase_completed` 双 emit） | 旧订阅方 |
| `ad_show`                     | `{ type: 'rewarded' | 'interstitial', reason? }`               | 广告 UI 出现        | `analyticsTracker.funnels.AD_WATCH`、看板 |
| `ad_complete`                 | `{ type, reason?, rewarded:boolean }`                          | 广告流程结束（含完播标记） | 同上 |

### 4.4 `getActiveWinbackPreset()`

给 `adaptiveSpawn` 的薄包装（避免 spawn 层直接 import retention 模块），返回当前激活的 preset 或 null：

```ts
{
  stressCap: 0.6,                // 本局 buildStoryLine 最大 stress 上限
  clearGuaranteeBoost: 1,        // spawnHints.clearGuarantee +1
  sizePreferenceShift: -0.3,     // spawnHints.sizePreference 偏小块
  hintCoupons: 2,                // 提示券补给
  reviveTokens: 1,               // 复活券
}
```

## 5. 策略层

### 5.1 出块体验：`adaptiveSpawn.js`

接入位置：

- **stress cap**：在 `firstSessionStressOverride` 同位置之后，`stress = min(stress, preset.stressCap)`，并把 `winbackStressCap` 写入 `stressBreakdown` 供回放追踪。
- **spawnHints 加固**：`clearGuarantee += preset.clearGuaranteeBoost`、`sizePreference += preset.sizePreferenceShift`，并把 `winbackProtectionActive: true` 写入 `spawnHints` + 私有诊断 `_winbackPreset`。

### 5.2 商业化：`monetization/lifecycleAwareOffers.js`

| 订阅事件                  | 动作                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `lifecycle:session_start` | 沉默 ≥ 7 天 → `paymentManager.triggerOffer('winback_user')`；未首充 → `firstPurchaseFunnel.getRecommendedOffer`；已首充 → `paymentManager.triggerOffer('returning_user')`；命中后 emit `lifecycle:offer_available` |
| `lifecycle:session_end`   | `vipSystem.updateVipScore(score)`；`unifiedRisk ≥ 0.5` → emit `lifecycle:churn_high` |
| `purchase_completed`      | `firstPurchaseFunnel.recordPurchase(payload)`                                        |

与 `commercialModel` 互补：前者管"现在能不能弹"（实时报价决策），后者管"会话结束后该不该送优惠券 / 累计 VIP 分"（跨日促销触发）。

### 5.3 运营 / 推送：`pushNotificationManager` + Dev Panel

订阅 `lifecycle:intervention` / `lifecycle:offer_available` / `lifecycle:churn_high`。Dev Panel 也读取 `getCachedLifecycleSnapshot` 直接渲染。

## 6. 实施清单 (P0-P3)

| 优先级 | 改动                                                                                            | 涉及文件                                                                                |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0-A   | `game.js → endGame` 调 `onSessionEnd`，让 churnPredictor 第一次有数据                          | `web/src/game.js`、`web/src/lifecycle/lifecycleOrchestrator.js`                          |
| P0-B   | `game.js → startGame` 调 `onSessionStart`；`adaptiveSpawn` 接 winback preset                   | `web/src/game.js`、`web/src/adaptiveSpawn.js`、`web/src/lifecycle/lifecycleOrchestrator.js` |
| P0-C   | 干预触发通过 `MonetizationBus` 解耦                                                             | `web/src/lifecycle/lifecycleOrchestrator.js`                                            |
| P1     | `difficultyAdapter._inferStage` 委托给 `playerLifecycleDashboard`；`getMaturityBand` 加 M4 阈值 | `web/src/retention/difficultyAdapter.js`、`web/src/retention/playerMaturity.js`         |
| P2     | `lifecycleAwareOffers` 接 firstPurchaseFunnel + vipSystem；三套 churnRisk 经数据层归一          | `web/src/monetization/lifecycleAwareOffers.js`、`web/src/monetization/index.js`          |
| P3     | `playerAbilityModel` 末尾追加 `getPlayerAbilityModel` facade，修复 4 个商业化模块的 import 报错 | `web/src/playerAbilityModel.js`                                                         |

## 7. 单测覆盖 (`tests/lifecycleSignals.test.js`)

19 项端到端单测，按"数据层 → PlayerProfile getter → 编排层 → 策略层 → 死键修复"分组：

1. `getUnifiedLifecycleSnapshot` 字段完整性 + 沉默回流场景
2. `getUnifiedChurnRisk` 三源 / 单源 / 全空
3. `PlayerProfile.daysSinceInstall / totalSessions / daysSinceLastActive / lifecyclePayload` + `toJSON / fromJSON` 持久化 `installTs`
4. `onSessionStart`：自动激活 winback / 未沉默不激活
5. `onSessionEnd`：写 churnPredictor / 消耗保护轮 / 总线 emit / 全局开关
6. `lifecycleAwareOffers` attach 后 emit `lifecycle:offer_available`
7. `getMaturityBand` 死键修复：85→M3、90→M4、100→M4

## 8. 小程序后续同步

`miniprogram/core/` 下没有 `lifecycle/` 目录，且 retention 模块未对应实现。后续按本文 §3-§5 在小程序侧建立同名层；为减少耦合，建议先把 `lifecycleSignals` 移植为纯函数模块（不依赖 `MonetizationBus`，事件总线可换成小程序 `wx.eventBus` 或自定义 emitter）。

## 9. 已知限制 / 待办

- `lifecycleAwareOffers._onSessionEnd` 取 `score` 时优先用 `data.churnUpdate.signals[0].value`（兼容历史 schema），新 churnPredictor 写入 `avgScore`，可在下个版本统一字段名。
- `commercialModel.churnRisk` 输出 `0..1`，未在编排层接入；建议在 `commercialModel` 的实时计算入口暴露 `getCommercialChurnRisk01()`，再喂给 `getUnifiedChurnRisk` 的 `commercialChurnRisk01`，实现真正三源融合。
- `lifecycleOrchestration.enabled` feature flag 还未接到 `GAME_RULES`；目前通过 `setLifecycleOrchestrationEnabled(bool)` 全局函数控制（用于单测），生产默认 on。
