# 玩家生命周期与成熟度运营蓝图

> 本文是 OpenBlock **生命周期 × 成熟度** 双轴体系的事实入口：阶段定义、能力建模、
> 指标体系、运营接入点。
>
> 与代码的边界：
> - 数据来源以 `web/src/lifecycle/lifecycleSignals.js` 的统一 snapshot 为准
> - 任何上层（出块 / 商业化 / 推送）通过 **订阅 `lifecycle:*` 总线事件** 接入，
>   禁止直接 import retention 模块
> - 详细分层架构见 [`../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md`](../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md)

---

## 0. 北极星与护栏

| 角色 | 指标 | 目标 |
|------|------|------|
| 核心北极星 | D30 留存 | 见基准（§3.1） |
| 增长护栏 | D1 留存 | ≥ 45% |
| 习惯护栏 | D7 留存 | ≥ 20% |
| 商业化护栏 | IAP + IAA 双轮 | IAA ARPDAU 不下滑且 IAP 转化率 ≥ 行业基准 |

护栏意味着：任何提升一个指标的实验，必须在另外三个指标上**不显著负向**（≤ 95%
置信度负向变化）。

---

## 1. 双轴模型：生命周期 × 成熟度

> 生命周期回答"玩家当前在哪个阶段"；成熟度回答"玩家当前会不会玩、愿不愿深玩、
> 愿不愿付费"。两个维度**解耦**建模，再在运营策略层合并。

### 1.1 A 轴：生命周期（行为时序）

| 阶段 | 判定窗口 | 主目标 | 主风险 | 策略重心 |
|------|----------|--------|--------|----------|
| **S0 新入场** | D0–D1 / 首 3 局 | 完成 FTUE + 首次爽点 | 教程流失 | 减阻、快反馈、首局胜任感 |
| **S1 激活** | D2–D7 / 4–20 局 | 形成重复回访 | 玩法单薄感 | 每日目标、轻任务、首批元进度 |
| **S2 习惯** | D8–D30 / 20–120 局 | 周节奏与事件参与 | 中期疲劳 | 周循环活动、社交轻触达、分段难度 |
| **S3 稳定** | D31–D90 / 120–400 局 | 提升 LTV 与长期价值 | 内容消耗快 | 分层 LiveOps、赛季驱动、个性化报价 |
| **S4 回流** | 近 7/14/30 天未活跃 | 重启动机与回归路径 | 高折损召回 | 高价值奖励、低打扰频控、回流引导 |

### 1.2 B 轴：成熟度（能力与价值）

| 等级 | 能力特征 | 行为特征 | 价值特征 | 应对策略 |
|------|----------|----------|----------|----------|
| **M0 新手** | 首手自由度波动大、误放率高 | 会话短，撤销/提示依赖高 | 尚无稳定付费/广告偏好 | 强引导 + 低惩罚 + 首日保护 |
| **M1 成长** | 基础策略形成、连消稳定 | 回访频率上升 | 开始看激励广告 | 任务驱动 + 技能教学 + 轻付费试探 |
| **M2 熟练** | 可规划 2–3 步、压力应对稳定 | 周活稳定、活动参与 | 广告 / IAP 开始分化 | 难度分层 + 活动分层 + 报价分层 |
| **M3 资深** | 复杂局面可控、追求效率 | 高频参与排行榜 / 挑战 | 中高 ARPPU 或高广告价值 | 高挑战内容 + 竞争机制 + 赛季目标 |
| **M4 核心** | 策略深度高、容错需求低 | 长期稳定在线 | 高 LTV + 高社交扩散 | VIP 权益 + 专属内容 + 社区共创 |

### 1.3 双轴决策矩阵（5×5 锚点示例）

完整 25 格策略矩阵由 `web/src/retention/lifecyclePlaybook.js` 配置驱动；下表为
锚点示例：

| 阶段 \ 成熟度 | M0 | M1 | M2 | M3 | M4 |
|----------------|----|----|----|----|----|
| **S0** | FTUE 极简 + 全程辅助 | — | — | — | — |
| **S1** | 瓶颈预警提示 + 任务保底 | 任务密度 +1，引入轻挑战 | 直接进周循环活动 | — | — |
| **S2** | 友好出块 + 首充券预热 | 周活动主推、首充包 | 周活动 + 限时挑战 + 报价分层 | 高难度赛季关 | — |
| **S3** | 不应留存于此（晋升或召回） | 阶段升级任务 | 赛季目标 + 报价升级 | 排行榜与社区 | VIP 权益 |
| **S4** | 回流前 3 局减压 + 高价值小奖 | 同 + 首充召回 | 召回挑战 + 报价回归 | 召回挑战 + 排行榜重置 | VIP 召回礼包 |

---

## 2. 成熟度建模

### 2.1 双分制（必须解耦）

`web/src/retention/playerMaturity.js` 实现 SkillScore（能力）与 ValueScore（价值）
两条独立路径：

```
SkillScore = w1 * normalize(avgSessionCount, 10)
           + w2 * normalize(sessionDuration, 300)
           + w3 * normalize(returnFrequency, 7)
           + w4 * featureAdoption
           + w5 * normalize(maxLevel, 50)
           + w6 * normalize(totalScore, 100000)
           + w7 * normalize(achievementCount, 30)

ValueScore = v1 * normalize(totalSpend, 100)
           + v2 * normalize(adExposureCount, 50)
           + v3 * normalize(retainedDays, 30)

MatureIndex(展示用) = α * SkillScore + (1-α) * ValueScore   // 默认 α = 0.6
```

- 分群以 `SkillScore` 为准映射 M0–M4
- 商业化以 `ValueScore` 单独驱动报价 / 频控
- `tests/playerMaturity.test.js` 已锁死"不可在 SkillScore 里塞商业化"这条不变量

### 2.2 生命周期阶段判定

`web/src/retention/playerLifecycleDashboard.js` 的 `getPlayerLifecycleStageDetail`
返回 `{ stage, confidence, hits }`：

- 阶段判定使用 **AND** 条件而非 OR（避免高频玩家被错分到 onboarding）
- `daysSinceLastActive` 参与 recency 衰减
- `getLifecycleMaturitySnapshot` 返回 `{ stageCode, band, shortLabel, ... }` 供
  panel / advisor 复用

---

## 3. 指标体系

### 3.1 行业基准（用于校准）

- Teak 生命周期分层：New / Core / Risk / Lapsed / Dormant / Resurrected
- Solsten / GameRefinery 公开报告（休闲品类基准）：D1 ≈ 40–50% / D7 ≈ 20% /
  D30 ≈ 8–12%
- GameAnalytics LiveOps 框架：Acquisition / Retention / Monetization 三柱 + 实验闭环

校准方法：以 D7 = 20% 为最低及格线，D7 < 15% 视为产品级风险。

### 3.2 生命周期指标

| 指标 | 定义 | 目标用途 | 数据源 |
|------|------|----------|--------|
| D1 / D3 / D7 / D14 / D30 | 按 cohort 回访率 | 识别阶段性流失断点 | `monetization/retentionAnalyzer.js` |
| FTUE 完成率 | `ftue_complete / ftue_start` | 定位新手引导摩擦 | `analyticsTracker.ANALYTICS_FUNNELS.ONBOARDING` |
| 首局爽点率 | 首局发生 `clear_lines` 或 perfect | 验证首日正反馈 | `ANALYTICS_EVENTS.CLEAR_LINES` + `game.js` |
| 活跃天占比 | `ActiveDays7 / 7`、`ActiveDays30 / 30` | 衡量习惯形成 | `retention/retentionManager.js` |
| 回流 7 日留存 | 回流后 7 天仍活跃比例 | 验证召回质量 | `monetization/pushNotificationSystem.js` + `retentionAnalyzer` |
| 事件参与率 | 参与活动人数 / 活跃人数 | 检验 LiveOps 吸引力 | `monetization/dailyTasks.js` + `seasonPass.js` |

### 3.3 成熟度指标

| 指标 | 定义 | 数据源 |
|------|------|--------|
| 首手瓶颈中位数 | `P50(firstMoveFreedom)` 7 天窗口 | `web/src/game.js` + `bot/blockSpawn.js` |
| 策略执行率 | 建议动作触发后 3 步内兑现率 | `web/src/strategyAdvisor.*` + replay |
| 压力恢复时间 | `stress > 0.65` → 回落 `< 0.45` 步数 | `web/src/adaptiveSpawn.js` + `stressMeter.js` |
| 容错依赖比 | `(undo + hint) / 总局数` | `web/src/skills/*` + `analyticsTracker` |
| 操作效率 | 每局 `clears / placements` | `analyticsTracker.GAME_END` |
| 价值成熟度 | IAA 倾向 + IAP 倾向 + 付费深度 | `monetization/adAdapter.js` + `iapAdapter.js` |

---

## 4. 系统能力与运营接入点

### 4.1 数据层

| 能力 | 模块 | 入口 |
|------|------|------|
| 双分制成熟度 | `web/src/retention/playerMaturity.js` | `getPlayerMaturity()` 返回 `{ skillScore, valueScore, matureIndex, band }` |
| 生命周期阶段 | `web/src/retention/playerLifecycleDashboard.js` | `getPlayerLifecycleStageDetail()` / `getLifecycleMaturitySnapshot()` |
| 留存 / 漏斗 / 趋势 | `web/src/monetization/retentionAnalyzer.js` | `_calculateRetention` per-user cohort；`getRetentionTrend()` 真实数据 |
| 统一 snapshot | `web/src/lifecycle/lifecycleSignals.js` | `getUnifiedLifecycleSnapshot(profile)` |
| Bus 事件 | `web/src/monetization/MonetizationBus.js` | 详见 [事件契约](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) |

### 4.2 策略层

| 能力 | 模块 | 入口 |
|------|------|------|
| 阶段 × 成熟度策略矩阵 | `web/src/retention/lifecyclePlaybook.js` | `resolveActions(stage, band)` / `getCoverage()` |
| 周循环活动 | `web/src/monetization/weeklyChallenge.js` | `startCycle / joinChallenge / completeChallenge / getCurrentPhase` |
| 成熟度晋升任务 | `web/src/retention/maturityMilestones.js` | 3 个里程碑 + 幂等持久化 |
| Winback 保护 | `web/src/retention/winbackProtection.js` | `activateWinback / consumeProtectedRound`（默认 3 局保护） |
| 故事线 / Intent 词典 | `shared/intent_lexicon.json` + `web/src/intentLexicon.js` | `getInGameNarrative / getOutOfGamePush / getOutOfGameTaskCopy / suggestIntentForSegment` |
| 实验模板库 | `web/src/monetization/lifecycleExperiments.js` | `LIFECYCLE_EXPERIMENT_TEMPLATES`（E1–E8 + E_TG）|

### 4.3 触达层

| 能力 | 模块 | 入口 |
|------|------|------|
| UI Toast | `web/src/monetization/offerToast.js` | 订阅 `lifecycle:offer_available` 等 |
| Push / 分享卡 | `web/src/monetization/lifecycleOutreach.js` | 由 `pushNotifications` flag 控制 |
| 事件埋点 | `web/src/monetization/analyticsTracker.js` | `ANALYTICS_EVENTS` 含 lifecycle 类（`FTUE_STEP_COMPLETE` / `INTENT_EXPOSED` / `INTENT_FOLLOWED` / `BOTTLENECK_HIT` / `RECOVERY_SUCCESS` 等） |
| 玩家面板 S/M 标签 | `web/src/playerInsightPanel.js` | 共用 `.insight-signal` 样式 |

### 4.4 局内联动

| 能力 | 模块 | 入口 |
|------|------|------|
| S/M → 出块难度调制 | `web/src/adaptiveSpawn.js` | `lifecycleStressCapMap`：按阶段 × 成熟度查表得 stress cap + adjust |
| 实验保真守卫 | `web/src/monetization/lifecycleExperiments.js` | `E_TG-spawn-fidelity-guard` 严格白名单 `clearGuarantee` / `sizePreference` |
| 策略提示 lifecycle 标签 | `web/src/strategyAdvisor.js` + `playerInsightPanel.js` | `lifecycleStrategyMap` 按 `${stage}·${band}` 查表 |

---

## 5. 推荐实验模板（E1–E8 + E_TG）

`web/src/monetization/lifecycleExperiments.js` 中 `LIFECYCLE_EXPERIMENT_TEMPLATES`
共 9 项，全部默认 `defaultEnabled: false`。调用
`registerLifecycleExperiments(getABTestManager())` 即可批量登记到 ABTest 平台。

| ID | 实验 | 目标人群 | 核心假设 | 主负责模块 |
|----|------|----------|----------|-----------|
| **E1** | 首日爽点加速 | S0-M0 | 首局 90 秒内出现一次高价值反馈可显著抬升 D1 | `bot/blockSpawn.js` + `game.js` |
| **E2** | 瓶颈预警提示 | S1-M0/M1 | `firstMoveFreedom ≤ 2` 时给轻提示可降低早期流失 | `playerInsightPanel.js` + `strategyAdvisor` |
| **E3** | 周活动节律 | S2-M1/M2 | 72h 活动 + 空窗优于连续活动 | `weeklyChallenge.js` |
| **E4** | 挑战包分层 | S2/S3-M2+ | 按成熟度发挑战可提升留存且不伤满意度 | `dailyTasks.js` + `experimentPlatform` |
| **E5** | 回流三局保护 | S4 全体 | 回流首 3 局减压可提升回流 7 日留存 | `winbackProtection.js` |
| **E6** | 广告疲劳频控 | IAA 高曝光人群 | 按 ad fatigue 动态限频可减少流失 | `adTrigger.js` + `adAdapter.js` |
| **E7** | 首充时机模型 | S1/S2-M1 | 首次高峰体验后 1–2 局推首充转化更高 | `firstPurchaseFunnel.js` + `iapAdapter.js` |
| **E8** | Intent 文案统一 | 全体 | `spawnIntent` 与运营文案一致可提升策略理解 | `intent_lexicon.json` |
| **E_TG** | 玩法保真守卫 | 全体（治理） | 严格限定 spawn 实验变量，避免破坏核心节奏 | `adaptiveSpawn.js` |

---

## 6. 维护规约

1. **本文档先于代码改动同步**：增加新阶段 / 等级 / 实验时，先在本文增加表格条目
   并给出验收标准，再在 PR 中实现
2. **不可在"成熟度"里塞商业化**：`SkillScore` 与 `ValueScore` 必须分开；任何把
   `totalSpend` 加进 `SkillScore` 的改动应被拒绝
3. **指标单一来源**：留存 / 漏斗以 `monetization/retentionAnalyzer.js` 为准；
   玩家成熟度以 `retention/playerMaturity.js` 为准；生命周期以
   `retention/playerLifecycleDashboard.js` 为准；UI 不得再算第二份
4. **实验灰度护栏**：任何 P1/P2 实验上线前，先确认 §0 四条护栏 30 天基线不被
   破坏。`E_TG-spawn-fidelity-guard` 的 `allowedVariables` 严格限定为
   `clearGuarantee` / `sizePreference`，PR 不得新增字段
5. **本文与 Canvas 同步**：原始 Canvas 见
   [`../engineering/CANVAS_ARTIFACTS.md`](../engineering/CANVAS_ARTIFACTS.md) 登记

---

## 7. S/M 标签在玩家面板的展示机制

### 7.1 数据源

| 组件 | 数据来源 | 展示内容 |
|------|----------|----------|
| 实时策略卡片 | `strategyAdvisor.js` → `generateStrategyTips()` | 1~3 条策略建议，含 `lifecycle` category |
| 策略解释 | `playerInsightPanel.js` → `_buildWhyLines()` / `_hintsExplain()` | 按来源分组：自适应出块 / 出块决策 / 生命周期 |

### 7.2 25 格策略映射（节选）

| 标签 | 策略标题 | 核心意图 |
|------|----------|----------|
| S0·M0 | 🌱 新手保护 | 友好出块，快速建立消行节奏 |
| S1·M0 | 🎯 瓶颈引导 | 瓶颈提示 + 安全网 |
| S1·M1 | ⚡ 适度挑战 | 逐步提升难度 |
| S2·M2 | ⏱️ 限时挑战 | 限时挑战 + 层级礼包 |
| S3·M3 | 👑 排行榜冲刺 | 高段位竞争 |
| S3·M4 | 💎 VIP 特权 | 核心特权 + 加速通道 |
| S4·M0 | 🛡️ 回归保护 | 保护局 + 高价值小奖励 |
| S4·M4 | 👑 VIP 召回 | 核心回归礼包 |

完整表见 `web/src/strategyAdvisor.js` `lifecycleStrategyMap`。

### 7.3 策略优先级体系

| 优先级 | 类别 | 说明 |
|--------|------|------|
| 0.95+ | survival | 紧急清行、恢复模式 |
| 0.85+ | combo | 连击链、里程碑 |
| 0.78+ | lifecycle | S/M 标签策略 |
| 0.65+ | build | 构型建议 |
| 0.45+ | pace | 节奏建议 |

---

## 8. S/M 标签 → 出块难度调制

`web/src/adaptiveSpawn.js` 的 `lifecycleStressCapMap` 在综合 stress 计算完成后
按阶段 × 成熟度查表，对 stress 应用上限 + 偏移：

| 标签 | cap | adjust | 说明 |
|------|-----|--------|------|
| S0·M0 | 0.50 | -0.15 | 新手强保护 |
| S1·M0 | 0.60 | -0.10 | 探索期减压 |
| S1·M1 | 0.65 | -0.05 | |
| S1·M2 | 0.70 | 0 | |
| S2·M0 | 0.65 | -0.10 | 成长新手友好 |
| S2·M1 | 0.70 | 0 | |
| S2·M2 | 0.75 | 0.05 | |
| S2·M3 | 0.82 | 0.10 | 高手可承受更高压力 |
| S3·M1 | 0.72 | 0 | |
| S3·M2 | 0.78 | 0.05 | |
| S3·M3 | 0.85 | 0.10 | |
| S3·M4 | 0.88 | 0.12 | 核心玩家 |
| S4·M0 | 0.55 | -0.15 | 回流保护 |
| S4·M1 | 0.60 | -0.10 | |
| S4·M2 | 0.70 | 0 | |
| S4·M3 | 0.75 | 0.05 | |
| S4·M4 | 0.80 | 0.08 | |

结果写入 `stressBreakdown.lifecycleStage` / `lifecycleBand` /
`lifecycleStressAdjust`，与 `lifecyclePlaybook` 同步维护。

---

## 9. 关联文档

- 顶层方法论：[体验设计基石](../player/EXPERIENCE_DESIGN_FOUNDATIONS.md) ·
  [策略体验栈](../player/STRATEGY_EXPERIENCE_MODEL.md)
- 局内策略与压力体系：[实时策略系统](../player/REALTIME_STRATEGY.md)
- 商业化策略与分群：[商业化系统全景](./MONETIZATION.md) ·
  [商业化算法](../algorithms/ALGORITHMS_MONETIZATION.md)
- 数据层架构：[生命周期数据→策略分层](../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md)
- 看板与指标审计：[运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md)
- 事件字典：[黄金事件字典](../engineering/GOLDEN_EVENTS.md)
- Canvas 转换登记：[Canvas 转换文档索引](../engineering/CANVAS_ARTIFACTS.md)
