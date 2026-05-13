# 商业化系统综合报告

> 本文是 OpenBlock 商业化系统的**架构与能力综合报告**：模块拓扑、信号—决策—回流
> 闭环、关键能力清单、KPI 监控点。
>
> 关联文档：
> - [`MONETIZATION.md`](./MONETIZATION.md) —— 商业化系统全景与 API
> - [`MONETIZATION_CUSTOMIZATION.md`](./MONETIZATION_CUSTOMIZATION.md) —— 策略定制
> - [`PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md`](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) —— 生命周期 × 成熟度蓝图
> - [`COMMERCIAL_IMPROVEMENTS_CHECKLIST.md`](./COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) —— 能力对照表
> - [`../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) —— 事件契约
> - [`../algorithms/ALGORITHMS_MONETIZATION.md`](../algorithms/ALGORITHMS_MONETIZATION.md) —— 算法手册
> - [`../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`](../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 模型架构设计

## 1. 模块拓扑

```
                    ┌──────────────────────┐
                    │   PlayerProfile      │ (源数据)
                    │   metrics / lifecyclePayload │
                    └──────────┬───────────┘
                               │
                ┌──────────────┴──────────────────────┐
                │   playerAbilityModel.buildAbilityVector │
                │   {confidence, boardPlanning, ...}      │
                └──────────────┬──────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼─────────┐   ┌────────▼──────────┐   ┌───────▼────────┐
│ adaptiveSpawn   │   │ commercialModel   │   │ adTrigger      │
│  - stress       │   │  - payerScore     │   │  - rewarded    │
│  - lifecycle    │   │  - churnRisk      │   │  - interstitial│
│  - winback cap  │   │  - propensities   │   │  - guardrails  │
└─────────────────┘   └────────┬──────────┘   └───────┬────────┘
                               │                      │
                ┌──────────────┴──────────────────────┘
                │
        ┌───────▼───────────┐         ┌──────────────────────┐
        │ paymentManager    │◄────────│ lifecycleOrchestrator│
        │  - LIMITED_OFFERS │  events │  - onSessionStart/End│
        │  - dynamicPricing │         │  - emit lifecycle:*  │
        └───────┬───────────┘         └──────────┬───────────┘
                │                                │
        ┌───────▼───────────┐         ┌──────────▼───────────┐
        │ iapAdapter        │         │ MonetizationBus      │ (订阅)
        │  - emit purchase  │────────►│  - offerToast        │
        │  - VIP / funnel   │         │  - lifecycleOutreach │
        └───────────────────┘         │  - analyticsTracker  │
                                      │  - actionOutcomeMatrix│
                                      └──────────────────────┘
```

数据流向：

1. **信号汇聚**：`PlayerProfile` → `playerAbilityModel` → `commercialModel` /
   `adaptiveSpawn` / `adTrigger`
2. **决策**：`commercialModel` 输出 propensity vector → `paymentManager` 决定 offer，
   `adTrigger` 决定广告触发
3. **生命周期编排**：`lifecycleOrchestrator` 在 `onSessionStart/End` 广播
   `lifecycle:*` 事件
4. **回流**：`iapAdapter` / `adAdapter` emit 结果事件 → `actionOutcomeMatrix` 记录
   推荐 × outcome；`modelQualityMonitor` 计算 PR-AUC / Brier

## 2. 关键能力

### 2.1 信号体系

| 信号源 | 模块 | 输出 |
|--------|------|------|
| 行为统计 | `personalization.updateRealtimeSignals` | `frustration`, `hadNearMiss`, `flowState`, `momentum`, `sessionPhase` |
| 能力评估 | `playerAbilityModel.buildAbilityVector` | 5 维 ability：`confidence`, `planning`, `skill`, `risk`, `clearEff` |
| 长期画像 | `playerProfile` + `monetization_backend.py` | `whaleScore`, `segment3 ∈ {whale, dolphin, minnow}`, `segment5 ∈ {A..E}` |
| 生命周期 | `lifecycle/lifecycleSignals.js` | `stage ∈ {S0..S4}`, `band ∈ {bottom, middle, top}`, `unifiedRisk` |
| 广告体验 | `adTrigger.getAdGuardrailState` | `inFlow`, `experienceScore`, `ltvShielded` |

### 2.2 决策模块

| 模块 | 输出 | 控制 |
|------|------|------|
| `commercialModel.buildCommercialModelVector` | `iapPropensity`, `rewardedAdPropensity`, `interstitialPropensity`, `churnRisk`, `payerScore`, `adFatigueRisk` + 4 个 guardrail | `actionThresholds` + `guardrail` |
| `strategyEngine.evaluate` | `rankedActions[]` + `whyLines[]` | `strategyConfig.rules`（9 条默认） |
| `paymentManager.triggerOffer` | LIMITED_OFFERS 命中 → 折扣方案 | `dynamicPricing` flag + stage × risk 矩阵 |
| `adTrigger._triggerInterstitial / _triggerRewarded` | 是否展示广告 | `AD_CONFIG` 频控 + commercialModel 护栏 |
| `lifecycleOrchestrator.onSessionStart/End` | `lifecycle:*` 事件 | 内部 evaluator |

### 2.3 算法层扩展（opt-in）

详见 [`../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`](../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) §3。

| 主题 | 模块 | 默认 flag |
|------|------|-----------|
| 统一特征 | `commercialFeatureSnapshot` | 始终启用 |
| 校准 | `propensityCalibrator` | `commercialCalibration=false` |
| 质量监控 | `modelQualityMonitor` | `commercialModelQualityRecording=true` |
| 行为-结果 | `actionOutcomeMatrix` | `actionOutcomeMatrix=true` |
| 漂移监控 | `distributionDriftMonitor` | `distributionDriftMonitoring=true` |
| 探索 | `epsilonGreedyExplorer` | `explorerEpsilonGreedy=false` |
| 多任务 | `multiTaskEncoder` | `multiTaskEncoder=false` |
| 弹性定价 | `priceElasticityModel` | 推理函数（注入式） |
| 价值评估 | `zilnLtvModel` | 推理函数（注入式） |
| 在线学习 | `contextualBandit` (LinUCB) | `adInsertionBandit=false` |
| 推送时机 | `survivalPushTiming` | 推理函数（注入式） |

### 2.4 UI / 触达

| 模块 | 用途 |
|------|------|
| `monPanel` | 调试面板：4 个 Tab（总览 / 用户画像 / 模型配置 / 功能开关） |
| `offerToast` | `lifecycle:offer_available` 等事件的 UI Toast，cooldown 24h |
| `lifecycleOutreach` | push 通知 + 分享卡生成（按 `pushNotifications` flag） |
| `commercialInsight` | 把 commercial vector + insights 写到玩家面板 |

## 3. 关键路径监控

### 3.1 漏斗 KPI

| 漏斗 | 阶段 | 健康基线 |
|------|------|----------|
| `IAP_FIRST_PURCHASE` | awareness → consideration → trial → purchase | 末段 ≥ 2% |
| `AD_WATCH` | trigger → show → complete → revenue | complete / show ≥ 80% |
| `OFFER_TOAST_CTR` | `offer_available` → user click | 5–15% |
| `LIFECYCLE_INTERVENTION` | trigger → outcome（churn 减少 / 复购） | trigger ≥ 0.1/DAU |

### 3.2 流失 / 挽留指标

| 指标 | 解读 |
|------|------|
| `unifiedRisk` 三腿覆盖率 | 三路（predictor / maturity / commercial）非空比例 |
| `lifecycle:early_winback` 触发率 | 比真 winback（≥ 7 天）提前 1–3 天命中比例 |
| winback offer 转化率 | `winback_user` 折扣券下单率 |

### 3.3 体验保护

| 指标 | 解读 |
|------|------|
| `getAdGuardrailState.inFlow=true` 时插屏被阻次数 | flow 护栏触发率 |
| `ltvShielded=true` 时插屏被跳次数 | 高 LTV 玩家保护率 |
| 广告体验分（`experienceScore`） | < 60 触发恢复期，整体抑制广告 |

### 3.4 模型质量（启用对应 flag 时）

| 指标 | 来源 | 解读 |
|------|------|------|
| `getModelQualityReport()` 各 task PR-AUC / Brier / hit@10 | `modelQualityMonitor` | 校准前后对照 |
| `getDriftReport()` 各特征 KL | `distributionDriftMonitor` | > 0.10 触发重训练 |
| `getMatrix()` action × outcome | `actionOutcomeMatrix` | 推荐价值评估 |
| `getPolicyGain()` | `actionOutcomeMatrix` | IPS-weighted 反事实 |

## 4. 演进方向

详细方案见各算法手册与设计文档；本节列出在产品/工程视角下的高价值方向：

1. **离线模型 bundle**：把训练管线（Python lifelines + sklearn isotonic + lifelines
   Cox + sklearn DML）产出统一打包成"商业化模型 bundle JSON"，通过 RemoteConfig 推送
2. **OPS 看板**：`/api/ops/dashboard` 暴露 `getModelQualityReport()` +
   `getDriftReport()` + `getPolicyGain()` 三组数据
3. **服务端事件管道**：`ad_show` / `ad_complete` 写本地 + 服务端
   `POST /api/enterprise/ad-events`
4. **小程序对齐**：`miniprogram/` 按 [`SYNC_CONTRACT.md`](../platform/SYNC_CONTRACT.md)
   同步事件名与 payload
5. **bandit 升级**：ε-greedy → LinUCB（`contextualBandit` 已就位，按 PR-AUC 提升量
   梯度灰度）
