# OpenBlock 玩家生命周期与成熟度运营蓝图

> **来源**：由 Canvas `player-lifecycle-maturity-ops-blueprint.canvas.tsx` 转换。
> **定位**：把 OpenBlock 从“规则驱动的局内策略系统”升级为“生命周期驱动的产品 + 运营闭环”，统一留存、成长、商业化与召回策略；为 PM、运营、算法、客户端工程师提供同一张可落地的执行图。
> **维护要求**：本文是当前事实入口；任何与 `web/src/retention/*` 与 `web/src/monetization/*` 的接口、阈值、字段变更必须同步本文“四、可落地任务清单”和“五、八个实验”。

---

## 0. 北极星与护栏

| 角色 | 指标 | 目标 |
|------|------|------|
| 核心北极星 | D30 留存 | 见基准（§3.4） |
| 增长护栏 | D1 留存 | ≥ 45% |
| 习惯护栏 | D7 留存 | ≥ 20% |
| 商业化护栏 | IAP + IAA 双轮 | IAA ARPDAU 不下滑且 IAP 转化率 ≥ 行业基准 |

护栏意味着：任何提升一个指标的实验，必须在另外三个指标上不显著负向（≤ 95% 置信度负向变化）。

---

## 1. 双轴模型：生命周期 × 成熟度

> 生命周期回答“玩家当前在哪个阶段”；成熟度回答“玩家当前会不会玩、愿不愿深玩、愿不愿付费”。两个维度必须**解耦**建模，再在运营策略层合并。

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

### 1.3 双轴决策矩阵（节选示例）

> 完整 5×5 = 25 格策略矩阵在 §4.1 P1 任务“分层运营矩阵”落地后由配置生成；下表为锚点示例。

| 阶段 \\ 成熟度 | M0 | M1 | M2 | M3 | M4 |
|----------------|----|----|----|----|----|
| **S0** | FTUE 极简 + 全程辅助 | — | — | — | — |
| **S1** | 瓶颈预警提示 + 任务保底 | 任务密度 +1，引入轻挑战 | 直接进周循环活动 | — | — |
| **S2** | 友好出块 + 首充券预热 | 周活动主推、首充包 | 周活动 + 限时挑战 + 报价分层 | 高难度赛季关 | — |
| **S3** | 不应留存于此（晋升或召回） | 阶段升级任务 | 赛季目标 + 报价升级 | 排行榜与社区 | VIP 权益 |
| **S4** | 回流前 3 局减压 + 高价值小奖 | 同 + 首充召回 | 召回挑战 + 报价回归 | 召回挑战 + 排行榜重置 | VIP 召回礼包 |

---

## 2. 指标体系（可直接埋点落地）

### 2.1 生命周期指标（Stage KPI）

| 指标 | 定义 | 目标用途 | 数据源 |
|------|------|----------|--------|
| D1 / D3 / D7 / D14 / D30 | 按 cohort 回访率 | 识别阶段性流失断点 | `monetization/retentionAnalyzer.js` |
| FTUE 完成率 | `ftue_complete / ftue_start` | 定位新手引导摩擦 | `analyticsTracker.ANALYTICS_FUNNELS.ONBOARDING` |
| 首局爽点率 | 首局发生 `clear_lines` 或 perfect | 验证首日正反馈 | `ANALYTICS_EVENTS.CLEAR_LINES` + `game.js` |
| 活跃天占比 | `ActiveDays7 / 7`、`ActiveDays30 / 30` | 衡量习惯形成 | `retention/retentionManager.js` |
| 回流 7 日留存 | 回流后 7 天仍活跃比例 | 验证召回质量 | `monetization/pushNotificationSystem.js` + `retentionAnalyzer` |
| 事件参与率 | 参与活动人数 / 活跃人数 | 检验 LiveOps 吸引力 | `monetization/dailyTasks.js` + `seasonPass.js` |

### 2.2 成熟度指标（Maturity KPI）

| 指标 | 定义 | 当前模块 | 落地动作 |
|------|------|----------|----------|
| 首手瓶颈中位数 | `P50(firstMoveFreedom)` 7 天窗口 | `web/src/game.js` + `bot/blockSpawn.js` | 输出到 dashboard，不参与商业化分群 |
| 策略执行率 | 建议动作触发后 3 步内兑现率 | `web/src/strategyAdvisor.*` + replay | 新事件 `intent_followed`（§4.1 P0-4） |
| 压力恢复时间 | `stress > 0.65` → 回落 `< 0.45` 步数 | `web/src/adaptiveSpawn.js` + `stressMeter.js` | 新事件 `recovery_success` |
| 容错依赖比 | `undo + hint` 使用次数 / 总局数 | `web/src/skills/*` + `analyticsTracker` | 新事件 `skill_use`（已存在则补属性） |
| 操作效率 | 每局 `clears / placements` | `analyticsTracker.GAME_END` 属性 | 派生字段 |
| 价值成熟度 | IAA 倾向 + IAP 倾向 + 付费深度 | `monetization/adAdapter.js` + `iapAdapter.js` | 单独 `ValueScore`，不混入 SkillScore |

### 2.3 双分制成熟度建模（替代当前单分）

> 现状：`web/src/retention/playerMaturity.js` 把 `totalSpend` / `adExposureCount` 与玩法能力混合在同一分（`MATURITY_WEIGHTS` 共 9 项），导致“付费多 = 成熟度高”，会让免费高玩被错分到 L1，付费新手被错分到 L3。

新模型：

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

* 分群以 `SkillScore` 为准映射 M0–M4；商业化以 `ValueScore` 单独驱动报价 / 频控。
* 落地时保留 `MATURITY_THRESHOLDS` 接口签名以兼容下游 dashboard，但内部由两条分支独立计算。

---

## 3. 现状诊断与代码对照

| 模块 | 现状 | 风险 | 优先级 |
|------|------|------|--------|
| `web/src/retention/playerMaturity.js` | 已有 L1–L4 评分框架 | 权重固定、阈值硬编码、混入 `adExposure` 让成熟度商业化偏向 | **P0** |
| `web/src/retention/playerLifecycleDashboard.js` | 已有阶段定义与干预建议 | 阶段判定使用 `days OR session`，易把高频玩家错分到低阶段 | **P0** |
| `web/src/monetization/retentionAnalyzer.js` | 覆盖留存/漏斗/生命周期接口 | `_conversionData.users` 用 `Set` 不可序列化；`_calculateRetention` 把 `_userSessions[0]` 当 cohort 起点；`getRetentionTrend` 含随机模拟值 | **P0** |
| Web 局内策略链路 | `stress + spawnIntent + firstMoveFreedom` 已非常强 | 与生命周期运营层映射不足，难做精细分群运营 | **P1** |
| `web/src/monetization/realTimeDashboard.js` | 有实时汇总卡 | 缺生命周期分群视角与实验看板 | **P1** |
| CRM / 触达策略 | 有推送与召回模块 (`pushNotificationSystem.js`) | 缺频控、内容实验、分层模板编排 | **P1** |

### 3.4 行业基准（用于校准）

* Teak 的生命周期分层：New / Core / Risk / Lapsed / Dormant / Resurrected。
* Solsten / GameRefinery 公开报告给出的休闲品类基准：D1 ≈ 40–50%、D7 ≈ 20%、D30 ≈ 8–12%。
* GameAnalytics LiveOps 框架：Acquisition / Retention / Monetization 三柱 + 实验闭环。

> 校准方法：以 D7 = 20% 为最低及格线，D7 < 15% 时视为产品级风险，先调整 §4.1 P0 而非新增内容。

---

## 4. 90 天可落地任务清单

> 每项任务给出：**目标 / 改动模块 / 新事件或字段 / 验收标准 / 状态**。任务 ID 用 `P{阶段}-{序号}` 表达；状态图例：✅ 已落地（含单测）· 🚧 已落地脚手架（默认 disabled，待运营接入与上线）· ⏳ 仍待启动。
> 本轮（2026-05-12）落地了 **P0 全部 5 项 + P1 中的 P1-1/P1-3/P1-4 + P2 中的 P2-1/P2-3/P2-4**，所有改动配套单测见 `tests/playerMaturity.test.js`、`tests/playerLifecycleDashboard.test.js`、`tests/lifecycleBlueprint.test.js`。

### 4.1 0–30 天 · Measurement First（P0）

| ID | 状态 | 目标 | 改动模块 / 入口 | 新事件 / 字段 | 验收标准 |
|----|------|------|------------------|----------------|----------|
| **P0-1** | ✅ | 双分制成熟度（SkillScore / ValueScore） | `web/src/retention/playerMaturity.js`：新增 `calculateSkillScore` / `calculateValueScore` / `calculateCombinedMatureIndex` / `getMaturityBand`；旧 `calculateMaturityScore` 等价 SkillScore 以兼容旧测 | `getPlayerMaturity()` 额外返回 `{ skillScore, valueScore, matureIndex, band }` | `tests/playerMaturity.test.js` "dual-score (SkillScore / ValueScore) — P0-1" 7 项断言全绿；纯付费玩家不再被推到 L4 |
| **P0-2** | ✅ | 生命周期改门槛 + 置信判定 | `web/src/retention/playerLifecycleDashboard.js`：`getPlayerLifecycleStageDetail` 返回 `{ stage, confidence, hits }`；判定从 OR → AND；新增 `getLifecycleMaturitySnapshot` 给 panel 用 | `daysSinceLastActive` 参与 recency 衰减；高频玩家（days=2, sessions=100）→ `growth` 而非 `onboarding` | `tests/playerLifecycleDashboard.test.js` "P0-2" + "P0-5" 6 项断言全绿 |
| **P0-3** | ✅ | 修复 `retentionAnalyzer` cohort/funnel/趋势 | `web/src/monetization/retentionAnalyzer.js`：`_loadData/_saveData` 序列化 Set；`_calculateRetention` 改 per-user cohort；`calculateFunnel` 直接读 `users.size`；`getRetentionTrend` 用真实数据 | 无新事件；只改计算口径 | `tests/lifecycleBlueprint.test.js` "P0-3" 4 项断言全绿；`getRetentionTrend()` 不再含随机值 |
| **P0-4** | ✅ | 关键事件埋点 | `web/src/monetization/analyticsTracker.js` `ANALYTICS_EVENTS` 新增 10 项（含 `FTUE_STEP_COMPLETE` / `INTENT_EXPOSED` / `INTENT_FOLLOWED` / `BOTTLENECK_HIT` / `RECOVERY_SUCCESS` 等） | 全部 `category=lifecycle`，命名见 [GOLDEN_EVENTS §生命周期 / 成熟度事件](../engineering/GOLDEN_EVENTS.md#生命周期--成熟度事件v11) | `docs/engineering/GOLDEN_EVENTS.md` v1.1 已同步；具体触发点接入由 P1/P2 模块完成（winback / weeklyChallenge / maturityMilestones 已直接 emit） |
| **P0-5** | ✅ | 局内策略与运营标签同屏 | `web/src/playerInsightPanel.js`：`elState` flags 行追加 `S?·M?` 标签；tooltip 接入 `_tooltipForLiveFlag` | UI 单标签 `shortLabel` 由 `getLifecycleMaturitySnapshot` 提供 | 默认对所有玩家可见但仅 dev/QA 关心；普通用户不被新增 UI 干扰（共用 `.insight-signal` 样式） |

### 4.2 31–60 天 · Segmented LiveOps（P1）

| ID | 状态 | 目标 | 改动模块 / 入口 | 新事件 / 字段 | 验收标准 |
|----|------|------|------------------|----------------|----------|
| **P1-1** | ✅ | 阶段 × 成熟度策略矩阵 | 新增 `web/src/retention/lifecyclePlaybook.js`：`resolveActions(stage, band)` + `getCoverage()` | `actions[]` 含 `{ id, tone, intent }`；缺省 intent 由 `intentLexicon.suggestIntentForSegment` 推荐 | `tests/lifecycleBlueprint.test.js` "P1-1 lifecyclePlaybook" 4 项断言全绿；非空格 ≥ 10 |
| **P1-2** | ⏳ | 召回实验框架 | 待接入 `web/src/monetization/pushNotificationSystem.js` + `experimentPlatform.js` | 维度：奖励强度 × 文案 tone × 触达时机；占位见 lifecycleExperiments.E_TG / E2 / E5 | 后续 sprint：在 push 模块内引用 `lifecycleExperiments` 模板 |
| **P1-3** | 🚧 | 玩法保真实验 | `web/src/monetization/lifecycleExperiments.js` 中 `E_TG-spawn-fidelity-guard`：`allowedVariables` 仅 `clearGuarantee` / `sizePreference` | adaptiveSpawn 仍保持单一意图字典（spawnIntent / stress 不动） | `tests/lifecycleBlueprint.test.js` "Lifecycle Experiments" 验证 E_TG 白名单严格匹配；接入 ABTest 灰度待 P1-2 |
| **P1-4** | ✅ | 周循环活动 | 新增 `web/src/monetization/weeklyChallenge.js`：`startCycle` / `joinChallenge` / `completeChallenge` / `getCurrentPhase` | `weekly_challenge_join` / `weekly_challenge_complete` 事件；`DEFAULT_CONFIG = 72h+18h` | `tests/lifecycleBlueprint.test.js` "P1-4 weeklyChallenge" 3 项断言全绿；UI 接入 dailyTasks 待后续 sprint |
| **P1-5** | ⏳ | 分群看板 | 待扩展 `web/src/monetization/realTimeDashboard.js` 增加 stage/maturity 切片 | 视图字段已由 `getLifecycleMaturitySnapshot` 提供 | 后续 sprint：`/ops` 增加分群下拉与 D1/D7/D30 重算 |

### 4.3 61–90 天 · Product + Ops Flywheel（P2）

| ID | 状态 | 目标 | 改动模块 / 入口 | 新事件 / 字段 | 验收标准 |
|----|------|------|------------------|----------------|----------|
| **P2-1** | ✅ | 成熟度晋升任务 | 新增 `web/src/retention/maturityMilestones.js`：3 个里程碑（首多消、连续 3 天回访、首活动完成） | `maturity_milestone_complete` 事件；幂等持久化 | `tests/lifecycleBlueprint.test.js` "P2-1 maturityMilestones" 2 项断言全绿；UI 反馈待后续 sprint |
| **P2-2** | ⏳ | 混合变现分层 | 待接入 `web/src/monetization/adTrigger.js` + `iapAdapter.js` 读取 ValueScore | 报价由 ValueScore 驱动 | 后续 sprint：在两模块内引用 `playerMaturity.calculateValueScore` |
| **P2-3** | ✅ | Winback 专区 | 新增 `web/src/retention/winbackProtection.js`：`activateWinback` / `consumeProtectedRound`；`DEFAULT_PROTECTION_PRESET = { stressCap=0.6, clearGuaranteeBoost=1, sizePreferenceShift=-0.3, hintCoupons=2, reviveTokens=1 }` | `winback_session_started` / `winback_session_completed` 事件；`PROTECTED_ROUNDS=3` | `tests/lifecycleBlueprint.test.js` "P2-3 winbackProtection" 3 项断言全绿 |
| **P2-4** | ✅ | 故事线运营（intent 词典统一） | 新增 `shared/intent_lexicon.json` + `web/src/intentLexicon.js`：`getInGameNarrative` / `getOutOfGamePush` / `getOutOfGameTaskCopy` / `suggestIntentForSegment` | 6 个 intent × 3 类文案；与 stressMeter `SPAWN_INTENT_NARRATIVE` 默认句对齐 | `tests/lifecycleBlueprint.test.js` "P2-4 intentLexicon" 4 项断言全绿 |
| **P2-5** | ⏳ | 周会机制 | 文档 + dashboard 视图 | 选 8 核心指标 + 3 个实验结论 | 后续 sprint：在 `OPS_DASHBOARD_METRICS_AUDIT.md` 落地周会面板规约 |

### 4.4 实验登记（E1–E8 + E_TG）— ✅ 已脚手架

`web/src/monetization/lifecycleExperiments.js` 中的 `LIFECYCLE_EXPERIMENT_TEMPLATES` 共 9 项（E1 首日爽点加速 · E2 瓶颈预警 · E3 周活动节律 · E4 挑战包分层 · E5 回流三局保护 · E6 广告疲劳频控 · E7 首充时机模型 · E8 Intent 文案统一 · E_TG 玩法保真守卫）。
全部默认 `defaultEnabled: false`，调用 `registerLifecycleExperiments(abTestManager)` 即可批量登记到 ABTest 平台。`tests/lifecycleBlueprint.test.js` "Lifecycle Experiments" 4 项断言验证模板完整性与 E_TG 变量白名单严格性。

---

## 5. 八个建议立刻启动的实验

| ID | 实验 | 目标人群 | 核心假设 | 变量 | 成功指标 | 主负责模块 |
|----|------|----------|----------|------|----------|-----------|
| **E1** | 首日爽点加速 | S0-M0 | 首局 90 秒内出现一次高价值反馈可显著抬升 D1 | `clearGuarantee` 阈值 + 首局 spawn pool | D1、FTUE 完成率 | `bot/blockSpawn.js` + `game.js` |
| **E2** | 瓶颈预警提示 | S1-M0/M1 | `firstMoveFreedom ≤ 2` 时给轻提示可降低早期流失 | UI 提示开关 + 触发阈值 | D3、失败后次局开启率 | `playerInsightPanel.js` + `strategyAdvisor` |
| **E3** | 周活动节律 | S2-M1/M2 | 72h 活动 + 空窗优于连续活动 | 活动持续/空窗时长 | 活动参与率、D14 | `weeklyChallenge.js`（P1-4） |
| **E4** | 挑战包分层 | S2/S3-M2+ | 按成熟度发挑战可提升留存且不伤满意度 | 挑战难度分桶 | D30、退出率 | `dailyTasks.js` + `experimentPlatform` |
| **E5** | 回流三局保护 | S4 全体 | 回流首 3 局减压可提升回流 7 日留存 | `winbackProtection` 开关 | 回流 7 日留存 | `winbackProtection.js`（P2-3） |
| **E6** | 广告疲劳频控 | IAA 高曝光人群 | 按 ad fatigue 动态限频可减少流失 | 时间窗口 + 单日上限 | 次日回访、IAA ARPDAU | `adTrigger.js` + `adAdapter.js` |
| **E7** | 首充时机模型 | S1/S2-M1 | 首次高峰体验后 1–2 局推首充转化更高 | 触发延迟、报价类型 | 首充转化率 | `firstPurchaseFunnel.js` + `iapAdapter.js` |
| **E8** | Intent 文案统一 | 全体 | `spawnIntent` 与运营文案一致可提升策略理解 | 词典版本 | 建议执行率、会话时长 | `intent_lexicon.json`（P2-4） |

> 实验登记位置：`web/src/monetization/lifecycleExperiments.js` 中 `LIFECYCLE_EXPERIMENT_TEMPLATES`，命名遵循 `E{编号}-{slug}` 与本表 ID 一致；调用 `registerLifecycleExperiments(getABTestManager())` 即可批量注册到 ABTest 平台。所有模板默认 `defaultEnabled: false`，避免登记动作造成意外曝光。

---

## 6. 维护规约

1. **本文档先于代码改动同步**：增加新阶段 / 等级 / 实验时，先在本文增加表格条目并给出验收标准，再在 PR 中实现。
2. **不可在“成熟度”里塞商业化**：`SkillScore` 与 `ValueScore` 必须分开；任何把 `totalSpend` 加进 `SkillScore` 的改动应被拒绝。`tests/playerMaturity.test.js` 已锁死该不变量。
3. **指标单一来源**：留存 / 漏斗以 `monetization/retentionAnalyzer.js` 为准；玩家成熟度以 `retention/playerMaturity.js` 为准；生命周期以 `retention/playerLifecycleDashboard.js` 为准；UI 不得再算第二份。
4. **实验灰度护栏**：任何 P1/P2 实验上线前，先确认四条护栏（§0）30 天基线不被破坏。`E_TG-spawn-fidelity-guard` 的 `allowedVariables` 严格限定为 `clearGuarantee` / `sizePreference`，PR 不得新增字段。
5. **本文与 Canvas 同步**：原始 Canvas 见 `docs/engineering/CANVAS_ARTIFACTS.md` 登记；Canvas 修改后必须更新本文。
6. **状态字段维护**：每完成一项任务，应同步更新本文 §4 表格的状态列（✅/🚧/⏳）与"指向实际代码 entrypoint"。新增脚手架但 UI 未上线时使用 🚧。

---

## 7. 入口与相关文档

* 顶层方法论：[体验设计基石](../player/EXPERIENCE_DESIGN_FOUNDATIONS.md) · [策略体验栈](../player/STRATEGY_EXPERIENCE_MODEL.md)
* 局内策略与压力体系：[实时策略系统](../player/REALTIME_STRATEGY.md)
* 留存与活跃路线图（产品视角）：[玩家留存 / 活跃提升路线图](../product/PLAYER_RETENTION_ROADMAP.md)
* 商业化策略与分群：[商业化策略](./MONETIZATION.md) · [商业化算法](../algorithms/ALGORITHMS_MONETIZATION.md)
* 看板与指标审计：[运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md)
* 事件字典：[黄金事件字典](../engineering/GOLDEN_EVENTS.md)
* Canvas 转换登记：[Canvas 转换文档索引](../engineering/CANVAS_ARTIFACTS.md)
