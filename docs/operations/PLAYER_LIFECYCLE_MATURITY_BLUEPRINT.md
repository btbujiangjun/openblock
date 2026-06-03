# 玩家生命周期与成熟度运营蓝图

> 本文是 OpenBlock **生命周期 × 成熟度** 双轴体系的事实入口：阶段定义、能力建模、
> 指标体系、运营接入点。
>
> 与代码的边界：
> - 数据来源以 `web/src/lifecycle/lifecycleSignals.js` 的统一 snapshot 为准
> - 任何上层（出块 / 商业化 / 推送）通过 **订阅 `lifecycle:*` 总线事件** 接入，
>   禁止直接 import retention 模块
> - 详细分层架构见 [`./本文「生命周期/成熟度策略架构（数据层+编排层+策略层）」`](#生命周期成熟度策略架构数据层编排层策略层)

---

## 一、北极星与护栏

| 角色 | 指标 | 目标 |
|------|------|------|
| 核心北极星 | D30 留存 | 见基准（§3.1） |
| 增长护栏 | D1 留存 | ≥ 45% |
| 习惯护栏 | D7 留存 | ≥ 20% |
| 商业化护栏 | IAP + IAA 双轮 | IAA ARPDAU 不下滑且 IAP 转化率 ≥ 行业基准 |
| **体验护栏** | **爽感覆盖率（7d）** | **≥ 75%**（触发任一 multiClear / pcClear / monoFlush / comboHigh 的 DAU 占比；数据来源见 [跨平台分析 §4.5](./RETENTION_SIGNALS_CROSS_PLATFORM.md#45-p1-共性--爽感监控闭环roundssincelastdelight)） |

护栏意味着：任何提升一个指标的实验，必须在另外三个指标上**不显著负向**（≤ 95%
置信度负向变化）。

---

## 二、双轴模型：生命周期 × 成熟度

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

## 三、成熟度建模

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

## 四、指标体系

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
| 压力恢复时间 | norm `stress > 0.708` → 回落 `< 0.542` 步数（等价 raw `> 0.65 → < 0.45`） | `web/src/adaptiveSpawn.js` + `stressMeter.js` |
| 容错依赖比 | `(undo + hint) / 总局数` | `web/src/skills/*` + `analyticsTracker` |
| 操作效率 | 每局 `clears / placements` | `analyticsTracker.GAME_END` |
| 价值成熟度 | IAA 倾向 + IAP 倾向 + 付费深度 | `monetization/adAdapter.js` + `iapAdapter.js` |

---

## 五、系统能力与运营接入点

### 4.1 数据层

| 能力 | 模块 | 入口 |
|------|------|------|
| 双分制成熟度 | `web/src/retention/playerMaturity.js` | `getPlayerMaturity()` 返回 `{ skillScore, valueScore, matureIndex, band }` |
| 生命周期阶段 | `web/src/retention/playerLifecycleDashboard.js` | `getPlayerLifecycleStageDetail()` / `getLifecycleMaturitySnapshot()` |
| 留存 / 漏斗 / 趋势 | `web/src/monetization/retentionAnalyzer.js` | `_calculateRetention` per-user cohort；`getRetentionTrend()` 真实数据 |
| 统一 snapshot | `web/src/lifecycle/lifecycleSignals.js` | `getUnifiedLifecycleSnapshot(profile)` |
| Bus 事件 | `web/src/monetization/MonetizationBus.js` | 详见 [事件契约](./MONETIZATION_EVENT_BUS_CONTRACT.md) |

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

## 六、推荐实验模板（E1–E8 + E_TG）

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

## 七、维护规约

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
    [`../engineering/AI_COLLAB.md`](../engineering/AI_COLLAB.md) （§三）登记

---

## 八、S/M 标签在玩家面板的展示机制

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

## 九、S/M 标签 → 出块难度调制

> **全仓唯一接线点（Single Source of Truth）**：调制矩阵抽到独立模块
> `web/src/lifecycle/lifecycleStressCapMap.js`，导出 `LIFECYCLE_STRESS_CAP_MAP`、
> `LIFECYCLE_STAGE_LABEL`、`LIFECYCLE_BAND_LABEL`、`LIFECYCLE_*_COLOR`、
> `getLifecycleStressCap()`、`describeLifecycleStressCap()`。
>
> 全仓**只有以下三个消费方**读这张表，调表数据 = 改这一处：
>
> | 消费方 | 调用 | 用途 |
> |---|---|---|
> | `web/src/adaptiveSpawn.js` | `getLifecycleStressCap(stage, band)` | 真正的出块算法 stress 调制（每帧） |
> | `web/src/playerInsightPanel.js` | `getLifecycleStressCap` + `describeLifecycleStressCap` | 策略解释段两条 bullet（"阶段调制"+"成熟度横向影响"） |
> | `web/src/playerInsightPanel.js` | `LIFECYCLE_STAGE_LABEL` / `LIFECYCLE_BAND_LABEL` / `_COLOR` | 4×2 能力指标网格中两个 lifecycle pill 的中文 + 配色 |
>
> 其余早期实现已废止：
>
> - **`web/src/retention/difficultyAdapter.js`**：曾定义平行的 `MATURITY_DIFFICULTY_ADJUST = { L1:-15, L2:-5, L3:0, L4:+5 }`，但全仓**没有任何生产代码**调用它到 spawn 路径，仅自测引用。已删除，文档残链统一指向本节。
> - 任何复现 `'S0·M0': { cap: 0.50 }` 字面值的局部代码都属于反模式，应改为 `import { LIFECYCLE_STRESS_CAP_MAP } from 'lifecycle/lifecycleStressCapMap.js'`。
>
> ⚠️ **两个 SkillScore 不要混淆**——M-band 阈值用的是 `retention/playerMaturity.calculateSkillScore`（跨局画像、按天 EMA、不含付费/广告）；不是 `playerAbilityModel.buildPlayerAbilityVector` 输出的 `AbilityVector.skillScore`（局内 5 维 EMA、每帧刷新、直接进 `skillAdjust`）。两个文件 docstring 顶部都有警示表。

`web/src/adaptiveSpawn.js` 在综合 stress 计算完成后按阶段 × 成熟度查表，对 stress 应用上限 + 偏移（下表 **cap / adjust 均为 raw 域**，与 `lifecycleStressCapMap.js` 源码一致；面板对外 stress 经 `(raw + 0.2) / 1.2` 归一化到 `[0, 1]`，详见 [自适应出块 §3.5 stress 域口径](../algorithms/ADAPTIVE_SPAWN.md#35-stress-域口径v15517)）：

| 标签 | cap（raw） | adjust（raw delta） | 说明 |
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

## 十、关联文档

- 顶层方法论：[体验设计基石](../player/EXPERIENCE_DESIGN_FOUNDATIONS.md) ·
  [策略体验栈](../player/STRATEGY_EXPERIENCE_MODEL.md)
- 局内策略与压力体系：[实时策略系统](../player/REALTIME_STRATEGY.md)
- 商业化策略与分群：[商业化系统全景](./MONETIZATION.md) ·
  [商业化算法](../algorithms/ALGORITHMS_MONETIZATION.md)
- 数据层架构：[生命周期数据→策略分层](#十一生命周期成熟度策略架构数据层编排层策略层)
- 看板与指标审计：[运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md)
- 事件字典：[黄金事件字典](../engineering/REFERENCE.md)（§一）
- Canvas 转换登记：[AI 协作文档](../engineering/AI_COLLAB.md)（§三）


---

## 十一、生命周期/成熟度策略架构（数据层+编排层+策略层）

**适用**：Web 客户端 + 小程序（小程序按本文 §11.6 同步）
**关联模块**：`web/src/lifecycle/*`、`web/src/playerProfile.js`、`web/src/playerAbilityModel.js`、`web/src/adaptiveSpawn.js`、`web/src/monetization/*`、`web/src/retention/*`
**配套蓝图**：[`operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md`](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)

---

### 11.1 背景：四套成熟度家族 + 三套流失风险并存

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

### 11.2 设计原则

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

### 11.3 数据层契约

#### 11.3.1 `getUnifiedLifecycleSnapshot(profile, options) -> UnifiedLifecycleSnapshot`

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

#### 11.3.2 `getUnifiedChurnRisk(opts) -> { unifiedRisk, level, sources }`

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

#### 11.3.3 缓存

`getCachedLifecycleSnapshot` 提供 300ms TTL，缓存 key 包含 `_installTs / _lastSessionEndTs / _totalLifetimeGames / predictorRisk01 / commercialChurnRisk01`。`recordSessionEnd` / `activateWinback` 后调用 `invalidateLifecycleSnapshotCache` 强制失效。

### 11.4 编排层契约

#### 11.4.1 `onSessionStart(profile, { tracker })`

在 `web/src/game.js → start()` 内的 `recordNewGame()` 之后调用：

1. 失效 snapshot 缓存
2. 取 `getUnifiedLifecycleSnapshot`
3. 若 `snapshot.returning.isWinbackCandidate` → `winbackProtection.activateWinback()`
4. emit `lifecycle:session_start` `{ snapshot, winback }`

#### 11.4.2 `onSessionEnd(profile, sessionResult, { tracker })`

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

#### 11.4.3 总线事件契约（`MonetizationBus`）

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

#### 11.4.4 `getActiveWinbackPreset()`

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

### 11.5 策略层

#### 11.5.1 出块体验：`adaptiveSpawn.js`

接入位置：

- **stress cap**：在 `firstSessionStressOverride` 同位置之后，`stress = min(stress, preset.stressCap)`，并把 `winbackStressCap` 写入 `stressBreakdown` 供回放追踪。
- **spawnHints 加固**：`clearGuarantee += preset.clearGuaranteeBoost`、`sizePreference += preset.sizePreferenceShift`，并把 `winbackProtectionActive: true` 写入 `spawnHints` + 私有诊断 `_winbackPreset`。

#### 11.5.2 商业化：`monetization/lifecycleAwareOffers.js`

| 订阅事件                  | 动作                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `lifecycle:session_start` | 沉默 ≥ 7 天 → `paymentManager.triggerOffer('winback_user')`；未首充 → `firstPurchaseFunnel.getRecommendedOffer`；已首充 → `paymentManager.triggerOffer('returning_user')`；命中后 emit `lifecycle:offer_available` |
| `lifecycle:session_end`   | `vipSystem.updateVipScore(score)`；`unifiedRisk ≥ 0.5` → emit `lifecycle:churn_high` |
| `purchase_completed`      | `firstPurchaseFunnel.recordPurchase(payload)`                                        |

与 `commercialModel` 互补：前者管"现在能不能弹"（实时报价决策），后者管"会话结束后该不该送优惠券 / 累计 VIP 分"（跨日促销触发）。

#### 11.5.3 运营 / 推送：`pushNotificationManager` + Dev Panel

订阅 `lifecycle:intervention` / `lifecycle:offer_available` / `lifecycle:churn_high`。Dev Panel 也读取 `getCachedLifecycleSnapshot` 直接渲染。

### 11.6 实施清单 (P0-P3)

| 优先级 | 改动                                                                                            | 涉及文件                                                                                |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0-A   | `game.js → endGame` 调 `onSessionEnd`，让 churnPredictor 第一次有数据                          | `web/src/game.js`、`web/src/lifecycle/lifecycleOrchestrator.js`                          |
| P0-B   | `game.js → startGame` 调 `onSessionStart`；`adaptiveSpawn` 接 winback preset                   | `web/src/game.js`、`web/src/adaptiveSpawn.js`、`web/src/lifecycle/lifecycleOrchestrator.js` |
| P0-C   | 干预触发通过 `MonetizationBus` 解耦                                                             | `web/src/lifecycle/lifecycleOrchestrator.js`                                            |
| P1     | `difficultyAdapter._inferStage` 委托给 `playerLifecycleDashboard`；`getMaturityBand` 加 M4 阈值 | `web/src/retention/difficultyAdapter.js`、`web/src/retention/playerMaturity.js`         |
| P2     | `lifecycleAwareOffers` 接 firstPurchaseFunnel + vipSystem；三套 churnRisk 经数据层归一          | `web/src/monetization/lifecycleAwareOffers.js`、`web/src/monetization/index.js`          |
| P3     | `playerAbilityModel` 末尾追加 `getPlayerAbilityModel` facade，修复 4 个商业化模块的 import 报错 | `web/src/playerAbilityModel.js`                                                         |

### 11.7 单测覆盖 (`tests/lifecycleSignals.test.js`)

19 项端到端单测，按"数据层 → PlayerProfile getter → 编排层 → 策略层 → 死键修复"分组：

1. `getUnifiedLifecycleSnapshot` 字段完整性 + 沉默回流场景
2. `getUnifiedChurnRisk` 三源 / 单源 / 全空
3. `PlayerProfile.daysSinceInstall / totalSessions / daysSinceLastActive / lifecyclePayload` + `toJSON / fromJSON` 持久化 `installTs`
4. `onSessionStart`：自动激活 winback / 未沉默不激活
5. `onSessionEnd`：写 churnPredictor / 消耗保护轮 / 总线 emit / 全局开关
6. `lifecycleAwareOffers` attach 后 emit `lifecycle:offer_available`
7. `getMaturityBand` 死键修复：85→M3、90→M4、100→M4

### 11.8 小程序后续同步

`miniprogram/core/` 下没有 `lifecycle/` 目录，且 retention 模块未对应实现。后续按本文 §11.3–§11.5 在小程序侧建立同名层；为减少耦合，建议先把 `lifecycleSignals` 移植为纯函数模块（不依赖 `MonetizationBus`，事件总线可换成小程序 `wx.eventBus` 或自定义 emitter）。

### 11.9 已知限制 / 待办

- `lifecycleAwareOffers._onSessionEnd` 取 `score` 时优先用 `data.churnUpdate.signals[0].value`（兼容历史 schema），新 churnPredictor 写入 `avgScore`，可在下个版本统一字段名。
- `commercialModel.churnRisk` 输出 `0..1`，未在编排层接入；建议在 `commercialModel` 的实时计算入口暴露 `getCommercialChurnRisk01()`，再喂给 `getUnifiedChurnRisk` 的 `commercialChurnRisk01`，实现真正三源融合。
- `lifecycleOrchestration.enabled` feature flag 还未接到 `GAME_RULES`；目前通过 `setLifecycleOrchestrationEnabled(bool)` 全局函数控制（用于单测），生产默认 on。
