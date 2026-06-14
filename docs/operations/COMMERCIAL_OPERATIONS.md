# 商业运营参考分析

> 文档状态：运营机会池与策略参考，不作为当前实现事实来源。
> 当前商业化实现以 [MONETIZATION.md](./MONETIZATION.md)、[ALGORITHMS_MONETIZATION.md](../algorithms/ALGORITHMS_MONETIZATION.md) 和代码为准。
> 视角：商业运营（Growth / Monetization Operations）

**逐项落地状态（61 条）**见 [本文「商业化与企业能力对照表」](#商业化与企业能力对照表)（含 API、代码路径与「脚手架/已实现」标注）。

---

## 导言：当前商业化能力评估

Open Block 已建立完整的商业化**基础设施**（IAA Stub、IAP Stub、分群引擎、赛季通行证、LTV 预测），但从**商业运营视角**看，仍存在两类根本性缺口：

1. **变现能力停留在 Stub（模拟）层**：真实 SDK 未接入，没有产生分毫真实收入
2. **运营闭环断裂**：缺少数据看板、A/B 测试、活动系统等运营必需工具——即使接入真实 SDK，也无法科学地调优和增长

以下按优先级分层列出所有改进点，并给出具体方案。

---

## 目录

零、[增长闭环：发行(买量) → 体验(承接) → 商业化(再投放) 飞轮诊断](#零增长闭环发行买量--体验承接--商业化再投放飞轮诊断)
一、[P0 · 真实变现接入（立即阻塞）](#一p0--真实变现接入)
二、[P1 · 运营数据看板（关键决策工具）](#二p1--运营数据看板)
三、[P2 · A/B 测试框架（科学调优）](#三p2--ab-测试框架)
四、[P3 · 价格体系与 IAP 漏斗优化](#四p3--价格体系与-iap-漏斗优化)
五、[P4 · 广告频控与体验平衡](#五p4--广告频控与体验平衡)
六、[P5 · 运营活动系统（动态内容）](#六p5--运营活动系统)
七、[P6 · 社交传播与病毒系数](#七p6--社交传播与病毒系数)
八、[P7 · 用户召回体系完善](#八p7--用户召回体系完善)
九、[优先级矩阵总览](#九-优先级矩阵总览)
十、[KPI 基线定义](#十-kpi-基线定义)

---

## 零、增长闭环：发行(买量) → 体验(承接) → 商业化(再投放) 飞轮诊断

> 视角：把 OpenBlock 当作「需要持续买量的商业产品」审视——单一功能再强，只要 **飞轮无法闭合**，规模化增长就无从谈起。

### 0.1 飞轮模型

休闲游戏的可规模化增长是一个自我强化的闭环，能否成立取决于一个不等式：**LTV > CPI**（单用户终身价值 > 单用户获取成本，即 ROAS > 1）。

```
        ┌──────────────────────────────────────────────┐
        │                                                │
        ▼                                                │
  ① 发行 / 买量 (UA)                                      │
   投放素材 → 归因 → 按 LTV 出价竞价                       │
        │  新用户涌入                                      │
        ▼                                                │
  ② 游戏体验 / 买量承接 (Retention)                        │
   冷启动 FTUE → 自适应难度承接 → D1/D7 留存 → PB 追逐      │
        │  留下来的活跃用户                                │
        ▼                                                │
  ③ 商业化 / 赚钱 (Monetization)                          │
   IAA + IAP → ARPDAU → 真实 LTV                          │
        │  产生现金流                                      │
        ▼                                                │
  ④ 再投放：ROAS=LTV/CPI > 1 → 把利润投回 ① 放大规模 ──────┘
```

**核心判据**：飞轮能转 = `真实 LTV / CPI > 1` 且 **每一环都可度量、可归因、可回流校准**。任一环断裂，飞轮停转。

### 0.2 三阶段健康度诊断

| 环节 | 角色 | 当前能力 | 健康度 | 关键缺口 |
|------|------|----------|--------|----------|
| ① 发行/买量 | 把钱变成用户 | 归因字段（UTM/gclid/fbclid）已落库；`ltvPredictor` 有规则版 CPI 出价建议 | 🟡 **基建半成品** | 无 MMP 对接、无渠道/素材级 Cohort LTV、无 ROAS 看板、出价无真实回流校准 |
| ② 体验/承接 | 把用户变成留存 | 自适应难度、心流、PB 追逐、Warm Run 新手保护、winback | 🟢 **强（产品最大资产）** | 买量用户 vs 自然用户**未分流承接**；FTUE 漏斗未度量；首局冷启动体验未专门优化 |
| ③ 商业化/再投放 | 把留存变成现金再投放 | 总线/护栏/SKU/分群/季票齐备 | 🔴 **断裂（Stub，零真实收入）** | 无真实 SDK/验单 → **无真实 LTV** → 飞轮无法闭合 |

### 0.3 闭环断点：飞轮为什么转不起来

当前飞轮在 **③ 与 ① 两端同时断裂**，而 ② 是被浪费的强项：

1. **③ 无真实收入 → 无真实 LTV**：`stubMode=true`，广告/IAP 为模拟，LTV 全靠规则乘法估算（`BASE_30d=¥2.5`），无付费历史校准。
2. **① 无 ROAS 度量 → 出价是「盲投」**：`ltvPredictor.bidRecommendation` 给出 CPI 建议，但没有「渠道 × 素材 × Cohort 真实回收」对账，无法验证出价是否 ROAS>1。
3. **回流链路缺失**：付费数据未回流 `playerMaturity`（编排层仍传 `totalSpend=0`），ValueScore/LTV 长期失真，飞轮第④步「用利润校准出价」无数据可用。
4. **② 的强承接被浪费**：优秀的留存承接（飞轮第②环）在没有①的精准买量和③的真实变现下，**无法转化为可复投的现金流**——等于「承接能力过剩，灌不进水也接不住钱」。

> 结论：**飞轮当前是一条「断头路」**——强在中段（承接），断在首尾（精准买量 + 真实变现 + 回流校准）。优先级应是「先接通首尾让飞轮能转一圈，再优化转速」，而非继续加深中段。

### 0.4 增长闭环改进清单（按飞轮环节）

> 状态图例同本文档末尾：✅ 已实现 / ⚠️ 部分 / ⛔ 规划中 / 🔌 外部依赖。下列为「让飞轮闭合」所需的最小增量，详细方案落在第一~八章对应条目。

#### ① 发行 / 买量（UA）

- [ ] **接入 MMP 归因**（AppsFlyer/Adjust）🔌 —— `channelAttribution.js` 已留参数位，需账号 + SDK 打通安装归因（详见能力对照表 #21）
- [ ] **渠道 × 素材级 Cohort LTV 报表** ⛔ —— 新增 `/api/ops/cohort-ltv`，按 `attribution.utm_source/utm_content` 聚合 N 日真实回收（对照表 #37）
- [ ] **ROAS 看板** ⛔ —— `/ops` 增加 `ROAS = cohortRevenue / cohortSpend` 卡片（需先有③的真实收入 + 导入买量花费）
- [ ] **出价建议接入真实回流校准** ⚠️ —— `ltvPredictor` 的 `bidRecommendation` 用「真实 30d 回收」回归修正系数，替代纯规则乘法
- [ ] **素材维度 ROI 聚合** ⚠️ —— `attribution.utm_content` 已进会话，补 UI/API 聚合各创意的 CPI/留存/LTV（对照表 #36）

#### ② 游戏体验 / 买量承接（Retention）

- [ ] **买量 vs 自然用户分流承接** ⛔ —— 依据 `attribution.utm_source` 给付费渠道用户更强的首会话 Warm Run（买量用户预期更冷、更易流失）
- [ ] **FTUE 漏斗度量** ⛔ —— 埋点首次「开局→首消→首局结束→次日回访」漏斗，定位买量承接的流失断点
- [ ] **冷启动首局体验专项** ⚠️ —— `warmRun` T1 已覆盖新手，补「首局必出可解高爽感开局 + 即时正反馈」以最大化 D0→D1（详见 [RETENTION_SIGNALS_CROSS_PLATFORM](./RETENTION_SIGNALS_CROSS_PLATFORM.md)）
- [ ] **承接 KPI 进看板** ⚠️ —— `/ops` 已有 D1/D7，补「分渠道留存」切片，把②的成效与①的渠道质量挂钩

#### ③ 商业化 / 再投放（Monetization）

- [ ] **真实广告 SDK** 🔌 —— AdMob/AppLovin（对照表 #1/#2，详见第一章）
- [ ] **真实 IAP + 服务端密码学验单** 🔌/⚠️ —— Stripe/微信/支付宝 + Webhook 收据校验（对照表 #5–8）
- [ ] **ARPDAU / 真实 LTV 口径** ⚠️ —— `/api/ops/dashboard` 返回 ARPDAU；用真实流水替换 `ltvPredictor` 估算（对照表 #16）
- [ ] **付费数据回流建模** ⛔ —— 编排层 `updateMaturity` 传入真实 `totalSpend/adExposureCount`，修复 ValueScore/LTV 失真，闭合飞轮第④步
- [ ] **「移除广告 / 订阅」服务端确权** ⛔ —— 权益服务端令牌校验，防客户端篡改（对照表 #10/#11）

### 0.5 飞轮闭合的最小可行路径（MVP Loop）

只为「让飞轮转起来第一圈」所需的关键链路（其余优化后置）：

```
真实变现(③: AdMob + Stripe + 验单)
   → 真实 LTV 入库(③: ARPDAU + iap_orders/ad_impressions)
      → 付费回流建模(③→④: totalSpend 回流 maturity)
         → Cohort LTV 报表(①: /api/ops/cohort-ltv)
            → ROAS 看板(①: LTV/CPI)
               → 出价校准(①: bidRecommendation 回归修正)
                  → 按 ROAS 放大买量 ↺
```

> 度量护栏：在飞轮闭合前，任何「加大买量」的动作都应被视为高风险——因为 ROAS 不可知。先接通度量与变现，再谈规模。

### 0.6 完整改进清单（全量 · 去重 · 排期）

> 跨「买量飞轮 + 策略设计 + 运营」三视角去重后的 **39 项主清单**。`0.4` 是其中「让飞轮闭合」的子集；本表是全量。
> 优先级 P0（阻塞，必须先做）→ P3（长期）；人日为粗估；状态图例同文末（✅/⚠️/⛔/🔌，此处用文字「已实现/部分/规划中/外部依赖/缺陷」）。
>
> **汇总**：P0 × 6（其中外部依赖 3）、P1 × 15、P2 × 17、P3 × 1；自研总估工 ≈ 105 人日（不含外部对接）。
>
> **🟢 Batch 1 已落地（飞轮度量与回流逻辑核心 · 纯逻辑 SSOT · 全测试 · 已同步各端）**：
> - `SG-1` 统一分群 SSOT → `web/src/segmentation.js`（spendTier / valueTier T0–T5 / segment5 / lifecycleStage 单一真源），已同步 miniprogram + cocos。
> - `SG-2` VIP↔adTrigger T-tier 对齐 → `vipSystem.getCurrentTier()` + `window.__vipSystem` 注册，修复曾经的死键护盾。
> - `UA-4` 出价真实回流校准 → `ltvPredictor.computeCalibrationFactor / calibrateLtv / getCalibratedLTVEstimate`（经验贝叶斯收缩）。
> - `UA-2/3/5 · MO-3` 度量纯函数 → `web/src/monetization/cohortAnalytics.js`（cohort LTV 曲线 / ROAS / payback / ARPDAU / 留存 / 素材 ROI 聚合）；后端聚合 endpoint 入 Batch 2。
> - `MO-4` 付费数据回流 → `iapAdapter.getLifetimeSpend()` 账本 → `lifecycleOrchestrator` 真实 `totalSpend` 喂 `updateMaturity`（替换硬编码 0）。
> - `RT-2` FTUE 漏斗度量 → `web/src/retention/ftueFunnel.js`（幂等打点 + `computeFunnelRates` + 断点定位）。
> - `LO-2` goalSystem 持久化 + 每日刷新 → 跨会话保留进度/已领取状态（防刷）+ `refreshDaily`。
> - 测试：`tests/segmentation|vipTierAlignment|ltvCalibration|cohortAnalytics|ftueFunnel|lifetimeSpend|goalSystemPersistence.test.js`（39 例全绿）。

> **🟢 Batch 2 已落地（后端安全与权威度量核心 · 自包含纯模块 · 全测试 · 各端已同步）**：
> - `CS-2` 行为上报鉴权 → `server_security.py`（HMAC-SHA256 请求签名 `X-Signature: <ts>.<hex>` + `require_write_auth` 装饰器，env `OPENBLOCK_REQUIRE_WRITE_AUTH` 灰度，默认关；已挂 `/api/score`、`/api/payment/verify`）。
> - `MO-5` 权益服务端确权 → `server_security.issue_entitlement / verify_entitlement`（签名令牌，依据 payments 表有效购买签发）+ `POST /api/entitlement/issue`、`/api/entitlement/verify`，杜绝本地 `isAdsRemoved` 篡改。
> - `CS-1` 服务端权威分 → `server_authority.authoritative_score_check`（基于落子/消行的可达上界 plausibility）接入 `/api/score`，写入 `score_audits` 表；默认仅标记，env `OPENBLOCK_REJECT_IMPLAUSIBLE_SCORE=1` 时拒绝越界分。完整回放重算入后续。
> - `DA-1` 北极星 SQL → `server_authority.north_star_metrics`（6 项 PB 指标 + 爽感覆盖率）+ `GET /api/ops/north-star`。
> - `UA-2/3` Cohort LTV/ROAS 后端聚合 → `server_authority.cohort_roi` + `GET /api/ops/cohort-ltv`（按 `utm_source[/utm_content]` 聚合真实回收；spend 待外部花费导入，未导入时 ROAS=null）。
> - `RT-1` 买量分流承接 → `warmRun.js` 新增 `T8_paid_acquisition`（付费渠道首会话最强承接 `warm_rescue`），`game.js` 注入 `runContext.isPaidChannel`；config 入 `game_rules.json adaptiveSpawn.warmRun.triggers.T8`（已同步 mp/cocos）。
> - `RT-2` FTUE 打点接主循环 → `game.js` 接 `ftueFunnel`：`app_open`(构造)→`game_start`(开局)→`first_clear`(首消)→`first_game_end`(局尾)→`d1_return`(跨日)。
> - 测试：`tests/server_batch2_test.py`（13 例全绿，纯函数 + 端点集成 + 写鉴权强制路径）；`tests/warmRun.test.js` 新增 T8 三例。
> - 说明：后端为单实例无需多端同步；RT-2 为 web 端模块；RT-1 的 `isPaidChannel` 注入目前在 web `game.js`，mp/cocos 可后续接入（触发器本体已同步全端）。

> **🟢 Batch 3 已落地（数据闭环统计 + 留存 Meta 主循环 + 增长循环 + 部署修复 · 全测试）**：
> - `DA-2` A/B uplift 统计 → `server_authority.two_proportion_uplift / ab_uplift_from_counts`（双比例 z 检验 + 95% CI + 显著性，以 bucket 0 为对照）+ `GET /api/ops/ab-uplift`。
> - `DA-4` 埋点质量监控 → `web/src/telemetry/telemetryQuality.js`（丢失率 + 延迟 p50/p95 + 阈值告警，纯函数供 `/ops` 卡片与 CI 守门）。
> - `SO-2` 邀请增长闭环 → `server.py` 新增 `invites` 表 + `POST /api/invite/record`（幂等转化）+ `GET /api/ops/k-factor`（`server_authority.k_factor`：人均邀请 × 转化率）；客户端 `inviteRewardSystem.js` 的 `/api/invite/record` 端点补齐。
> - `LO-2/LO-3` 留存 Meta 主循环接线 → `game.js endGame` 接 `retentionManager.afterGameEnd`（驱动 `goalSystem.updateProgress + checkGoals` 与 `difficultyPredictor.recordGameResult`），完成目标系统与难度预测的局后回流。
> - `ML-2` 寻参 v2 离线包部署修复 → 恢复 git 已跟踪但工作树缺失的 `web/public/spawn-tuning-v2/policies.json` + `policies.meta.json`，`spawnBundleSync` 4 例转绿（web↔mp↔cocos bundle 一致）。
> - 测试：`tests/server_batch3_test.py`（9 例：uplift/k-factor 纯函数 + ab-uplift/invite/k-factor 端点）、`tests/telemetryQuality.test.js`（8 例）、`tests/spawnBundleSync.test.js`（4 例恢复）。

> **🟢 Batch 3.1 看板接线（已就绪后端数据渲染进 `/ops`）**：`web/src/opsDashboard.js` 新增「增长闭环」分区与卡片——
> - 北极星卡片（DA-1）：PB 刷新/逼近率、爽感覆盖率、连击/有效局占比（`/api/ops/north-star`）。
> - K 因子卡片（SO-2）：病毒系数 + 人均邀请 × 转化率（`/api/ops/k-factor`）。
> - 渠道 Cohort 卡片（UA-2/3）：CPI/ARPU/ROAS/D1 表（`/api/ops/cohort-ltv`；花费未导入时 ROAS 显示 —）。
> - A/B uplift 卡片（DA-2）：每实验逐桶 uplift + 95% CI + p 值 + 显著性（`/api/ops/ab-uplift`，对每个实验并发拉取）。
> - 说明：DA-4 埋点质量为客户端纯库（`telemetryQuality.js`），缺服务端 telemetry 事件源，`/ops` 卡片待埋点回执上报落库后接入。

> **🟢 Batch 3.2 完整实现（DA-4 全链路 + SO-1 真排行榜 UI · 全测试 · cocos 已同步）**：
> - `DA-4` 埋点质量全链路打通：
>   - 客户端 `web/src/telemetry/telemetryReporter.js`（`instrumentedFetch` 量 sentTs/ackTs/lost + 缓冲 + 周期 flush + `globalThis.__telemetryReporter` 全局 hook），`main.js` 初始化；`analyticsTracker._syncEventsToServer` 经 hook 打点（跨端安全，无静态依赖）。
>   - 服务端 `telemetry_events` 表 + `POST /api/telemetry/report`（批量回执，写鉴权）+ `GET /api/ops/telemetry-health`（`server_authority.telemetry_quality` 聚合，与 JS 同口径）。
>   - 看板 `/ops` 新增「数据质量 · 埋点健康」卡片（健康度/丢失率/p50/p95/告警）。
> - `SO-1` 真排行榜 UI：
>   - 服务端 `GET /api/leaderboard/board?scope=all|weekly|friends`（全服历史最高 / 近 7 日 / 基于 `invites` 邀请关系图的好友榜，返回 `myRank`）。
>   - 客户端 `web/src/social/leaderboardScreen.js`（全服/周榜/好友 三 tab Screen + 我的排名条 + 前三奖牌），`index.html` 新增「🏆 排行榜」菜单卡片，`main.js` 注册；i18n（zh-CN/en）。
> - 测试：`tests/telemetryReporter.test.js`（8）、`server_batch3_test.py` 扩展至 16 例（telemetry_quality/telemetry-report/health + leaderboard all/weekly/friends）；cocos `analyticsTracker.mjs` 已重新同步含 hook。

> **🟢 Batch 4/5/6 全量落地（A 配置化外部接入 + B Demo 管线 + C 15 项纯工程 · 230 测试全绿）**：
> - **A 类（外部接入配置化 + 桩，拿到密钥即插即用）**
>   - 配置 SSOT `web/src/monetization/providerConfig.js`：ad/iap/attribution 选型与凭据全配置化，默认 `stub`；构建期 `globalThis.__OPENBLOCK_PROVIDERS__` / 运行期 `localStorage` 可覆盖灰度。
>   - `MO-1` 广告：`adProviders.js`（stub eCPM/fill 计收益 + admob/applovin 骨架）接入 `adAdapter`；曝光收益回流 `revenue_minor`。
>   - `UA-1` 归因：`attribution/attributionProvider.js`（无 UTM 时按 channelMix 模拟 MMP 解析）+ `/api/attribution/postback` + `attributions` 表。
>   - `MO-2` 验单：`server_payments.py` provider 注册表（stub HMAC 验单 + 微信/支付宝/Stripe 骨架）接 `/api/payment/verify`（拒付返回 402）。
>   - `CS-4` 退款对账：`/api/payment/webhook`（验签→审计→payment upsert / 退款写 `entitlement_revocations`→令牌失效）+ `/api/ops/reconcile`。
> - **B 类（接通管线 + 写入 Demo 数据）**
>   - `UA-3`：`ad_spend` 表 + `/api/ops/spend/import`（幂等 UPSERT）；`/api/ops/cohort-ltv` 读 spend 算真实 ROAS（`spendImported=true`）。
>   - `scripts/seed_demo_data.py`：写入 sessions(归因)/payments/ad_spend/telemetry/invites/scores，使 `/ops` 北极星·Cohort ROAS·K 因子·埋点健康·分渠道留存·对账全部非空。
> - **C 类（15 项纯工程）**
>   - `RT-4` 分渠道留存 `/api/ops/retention-by-channel` + 卡片；`DA-3` 护栏 `evaluate_guardrails` + `/api/ops/guardrails`（autopause 写 `experiment_state`）+ `/api/experiment/state` + 卡片；`EX-3` `tests/contractSync.test.js`（79 例，守护四端同步漂移）。
>   - `LO-1` `retention/campaignManager.js` + `shared/campaigns.json`；`LO-4` `retention/winbackTiers.js`（3/7/14/30 天分层）；`LO-5` 二者随 `sync-core`/`sync-cocos` 同步至小程序/cocos；`SO-3` `/api/social/pb-compare`（好友 PB 差距挑战）。
>   - `DA-5` `experiment/experimentUnified.js`（abTest 为唯一分桶口径 + 合并注册表 + 尊重 DA-3 暂停）；`ML-1` `ml/mlGovernance.js`（ziln/mtl/bandit 显式封存）；`EX-1` `engine/complexityGuard.js`（难度斜率上限 + 强制释放）；`EX-2` `feedGuard.js`（喂分透明 + 跨平台差异审计）；`CS-1` `server_replay.py` + `/api/score/replay-verify`（确定性回放重算）；`CS-3` `privacy/consentManager.js`（CMP + 未成年人策略）；`SG-3` `player_profiles` 表 + `/api/profile/sync|get`（跨设备 rev）。
> - 测试：`providerConfig`(11) `contractSync`(79) `retentionC2`(7) `c3pure`(15) `telemetryReporter`(8) + `server_batch4`(11) `server_batch5`(8)；连同既有合计 **JS 182 + PY 48 全绿**。

> **🟢 增长飞轮打通（配置化桩 · 买量→体验→变现→再投放 闭环 · 各端无网络缓存+联网上报）**：
> - **买量单价 CPI=¥2**：`providerConfig.acquisition.cpiCny=2`；`seed_demo_data` 写 `ad_spend.spend = 归因安装数 × 2`，使 `/api/ops/cohort-ltv` 的 `cpi` 恰为 2；`/api/ops/dashboard` 的 `获客·成本` 改读 `ad_spend`（窗口内花费）。
> - **广告按次计费**：插屏 ¥0.02/次、激励 ¥0.05/次，配置 SSOT `providerConfig.ad.stub.revenuePerShowCny`；`adProviders.simulateAdRevenueMinor` 按次计费（兼容旧 eCPM 兜底）。**各端**模拟展示+计费：web `adAdapter`、小程序 `utils/adSim.js`、cocos `platform/Ads.ts`（插屏/激励均回流）。
> - **无网络本地缓存 + 联网上报（各端 · 行为 + 广告统一通路）**：
>   - web `net/reportingOutbox.js`（localStorage 持久化 + `online`/可见性触发 flush + event_id 去重 + 失败保留断网重发，上限 FIFO）；`analyticsTracker` 经 `globalThis.__reportingOutbox` 入队（**修复此前每 30s 重发最近 50 条的重复上报缺陷**）；`adAdapter` 广告收益入队。
>   - 小程序 `utils/reportingOutbox.js`（wx.setStorageSync + wx.request + `onNetworkStatusChange` 重连补传），`app.js` 初始化 + 持久化匿名 uid + `app_open`；`game.js` 上报 `game_start/game_end` + 局末插屏。
>   - cocos `platform/ReportingOutbox.ts`（sys.localStorage + XMLHttpRequest），`AnalyticsSink` 行为入队、`Ads` 广告入队，`Bootstrap` 由 `cloudHttp.base` 推导 apiBase 配置。
> - **服务端落库 + 看板正确性**：`/api/behavior/batch`（批量行为）、`/api/ad/impression`（`ad_revenue` 表，event_id `UNIQUE` 去重 + 配套 `ad_show/ad_complete` 行为）；`/api/ops/dashboard` 的 `ecpm` 改由 `ad_revenue` 驱动（**修复此前恒为 0**），`ARPDAU` 改为 (IAP+广告)/DAU 混合口径并新增 `adRevenue/iapArpdau`；`/api/ops/cohort-ltv` 把广告收益并入 LTV → ROAS 反映双重变现。
> - **看板 UI**：运营看板「支付看板（IAP·对账）」改 `ops-card--full` 横向网格（参考业务指标）；主页「排行榜」入口补 `.menu-card--leaderboard` 冠军金→皇家紫渐变 + 图标投影（与其他入口同构）。
> - 测试：新增 `reportingOutbox`(4) + `providerConfig` 按次计费用例 + `server_flywheel`(7：行为批量/广告计费/ecpm 公式/混合 ARPDAU/cohort 并收益)；seed 烟测 `/ops` 广告收入·ecpm·CPI=2·ROAS 全非空。**当前累计 JS 177 文件 / 3102 例（1 skip）+ PY 各 batch 隔离全绿 + lint 0**。

> **🟢 飞轮模型驱动升级（统一信号 SSOT · 多目标协调 · 受治理探索 · 消除拉扯）**：
> 把「发行/体验/变现」三飞轮从各自启发式升级为**同一信号 · 同一目标函数 · 同一约束**下的协调决策。
> 新增 `web/src/coordination/` 四模块（纯逻辑 · 强单测 · 默认影子不改线上）：
>
> - **底层信号统一**（`unifiedSignals.js`）：为每个语义信号选**唯一权威源（SSOT）**并冻结成一份带 `provenance` 的快照——`churnRisk`←`lifecycleSignals`（三路投票）、`ltv/ltvBid`←`ltvPredictor`（含 UA-4 校准）、`segment/stage/maturity`←生命周期收敛家族、`skill/flow/frustration`←`PlayerProfile`。300ms 周期缓存保证「同一帧所有飞轮读完全一致的值」，根除调研发现的 skill(4 套)/churn(3 套)/LTV(3 套) 分叉与一轮拷贝 skew。
> - **共同货币 + 多目标标量化**（`flywheelObjective.js`）：所有动作折算到 `{revenue, retention, experience}` 三目标向量（revenue 以归一 pLTV `ltvNorm` 为强度），用**损失厌恶标量化**（MORL 保守变换：放大损失多于收益、收益边际递减）压成单一效用 → 天然「不烧用户」；硬约束 `constraints()` 砍越界动作（flow 中不插屏、高 churn 不加压/不加价、保护付费/新手/召回）。
> - **跨飞轮协调器**（`policyArbiter.js`）：`coordinate(signals)` 一次产出**一致指令束** `{uaBid, experience, ad, offer}`——例如高 churn 玩家会同时得到 `experience=relief + ad 抑制插屏 + offer=retention_gift + 不加价 + UA 出价随留存健康度收缩`，五个动作方向一致、互不拉扯；付费玩家心流中插屏被 `flow_protect/payer_protect` 直接砍掉。每个 domain 用标量化排序得确定性最优 + `why` 可解释。
> - **受治理上下文老虎机**（`coordinationBandit.js`）：Thompson(Beta 共轭) 在**约束安全候选集**内做探索/利用，上下文 = `unifiedSignals` 离散 key，奖励统一用 LTV 折算 [0,1]（与目标同货币）。经 `mlGovernance('coordination_bandit')` **默认 sealed → 退回确定性最优，不改线上**；放量改治理状态即可（金丝雀）。
> - **接入（`coordinationArbiter` flag · 默认 off=影子）**：on 时 `adTrigger._canShowInterstitial` 在既有频控/flow/疲劳护栏之上**叠加**统一信号+仲裁门控（只更严不放宽）；`paymentManager.getDynamicPricingBonus` 高 churn 禁加价（与 `retention_gift/relief` 同向）。UA 出价以统一 `ltvBid × 留存健康度` 与体验/变现一致。
> - **一致性原则**：thin client（小程序/cocos）信号栈较薄，协调「大脑」运行在信号最全的 web 端为权威，后续经 RemoteConfig/服务端下发指令束；`lifecycleSignals` 等底层 SSOT 已跨端一致。
> - 测试：`tests/coordination.test.js`(19：损失厌恶/约束/信号统一兜底/高churn 五动作一致/付费心流拦插屏/新手保护/uaBid 单调/老虎机治理与后验/arbitrate 单域 ranked)。老虎机上下文按 domain 命名空间隔离，避免 `none` 等臂名跨域串台。**当前累计 JS 177 文件 / 3102 例（1 skip）全绿 + lint 0**。

#### ① 发行 / 买量（UA）

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| UA-1 | 接入 MMP 归因（AppsFlyer/Adjust），打通安装归因 | P0 | 外部 | 账号+SDK | ✅ 配置化管线：`attributionProvider`（stub MMP 解析）+ `/api/attribution/postback` + `attributions` 表（Batch 4）；填 AppsFlyer/Adjust devKey 即切真实 |
| UA-2 | 渠道 × 素材级 Cohort LTV 报表（`/api/ops/cohort-ltv`，按 `utm_source/utm_content` 聚合 N 日真实回收） | P1 | 3 | ③真实收入 | ✅ 后端 endpoint 已落地（`server_authority.cohort_roi` + `/api/ops/cohort-ltv`，Batch 2） |
| UA-3 | ROAS 看板（`ROAS=cohortRevenue/cohortSpend`，`/ops` 卡片） | P1 | 2 | UA-2 + 花费导入 | ✅ 全通：`ad_spend` 表 + `/api/ops/spend/import` + cohort-ltv 读 spend 算 ROAS + Demo 数据（Batch 5）；真实花费导入即生效 |
| UA-4 | 出价建议接入真实回流校准（`bidRecommendation` 用真实 30d 回收回归修正） | P1 | 2 | 真实回收 | ✅ 已实现（calibrate*） |
| UA-5 | 素材维度 ROI 聚合（`utm_content` → 各创意 CPI/留存/LTV） | P2 | 2 | — | `aggregateChannelRoi` 已实现 ✅ |

#### ② 游戏体验 / 承接（Retention）

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| RT-1 | 买量 vs 自然用户分流承接（按 `utm_source` 加强付费渠道用户首会话 Warm Run） | P1 | 2 | 归因 | ✅ `warmRun T8_paid_acquisition` + `game.js` 注入 `isPaidChannel`（Batch 2，已同步全端触发器） |
| RT-2 | FTUE 漏斗度量（开局→首消→首局结束→次日回访） | P1 | 2 | — | ✅ 度量 + 主循环打点全落地（`ftueFunnel` + `game.js` 5 步钩子，Batch 2） |
| RT-3 | 冷启动首局体验专项（必出可解高爽感开局 + 即时正反馈，最大化 D0→D1） | P1 | 3 | — | 部分 |
| RT-4 | 分渠道留存切片进 `/ops` 看板 | P2 | 1 | — | ✅ `/api/ops/retention-by-channel`（按归因分组 D1/D7）+ `/ops` 卡片（Batch 6） |

#### ③ 商业化 / 再投放（Monetization）

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| MO-1 | 真实广告 SDK（AdMob/AppLovin），`adAdapter.setAdProvider` 接线 | P0 | 3 | 账号 | ✅ 配置化：`adProviders`（stub eCPM/fill + admob/applovin 骨架）按 `providerConfig` 安装（Batch 4）；填 appId/unitId 即切真实 |
| MO-2 | 真实 IAP + 服务端密码学验单（Stripe/微信/支付宝 + Webhook 收据校验） | P0 | 5 | 账号 | ✅ 配置化：`server_payments` 验单注册表（stub HMAC + 渠道骨架）接 `/api/payment/verify`（Batch 4）；填商户凭据即切真实 |
| MO-3 | ARPDAU / 真实 LTV 口径（`/api/ops/dashboard` 返回 ARPDAU，真实流水替换估算） | P0 | 2 | MO-1/2 | `computeArpdau` 口径已实现 ✅；后端返回接线入 Batch 2 |
| MO-4 | 付费数据回流建模（`updateMaturity` 传真实 `totalSpend`，闭合飞轮第④步） | P1 | 1 | MO-3 | ✅ 已实现（getLifetimeSpend→updateMaturity） |
| MO-5 | 「移除广告/订阅」服务端确权（令牌校验防客户端篡改） | P1 | 2 | — | ✅ `server_security.issue/verify_entitlement` + `/api/entitlement/*`（Batch 2） |

#### ④ 数据闭环 / 看板 / 实验

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| DA-1 | 北极星 SQL 落地（6 项 PB 指标 + 爽感覆盖率） | P1 | 4 | — | ✅ `north_star_metrics` + `/api/ops/north-star` + `/ops` 北极星卡片（Batch 2/3.1） |
| DA-2 | A/B uplift 统计（置信区间，非纯计数） | P2 | 2 | — | ✅ `two_proportion_uplift` + `/api/ops/ab-uplift` + `/ops` uplift 卡片（双比例 z 检验 + 95% CI，Batch 3/3.1） |
| DA-3 | 护栏指标自动告警 / 自动暂停实验 | P2 | 2 | — | ✅ `evaluate_guardrails` + `/api/ops/guardrails`（autopause→`experiment_state`）+ `/api/experiment/state` + `/ops` 护栏卡片（Batch 6） |
| DA-4 | 埋点质量监控（丢失率 / 延迟告警） | P2 | 2 | — | ✅ 全链路：`telemetryReporter`（采集）→ `/api/telemetry/report`+`telemetry_events`（落库）→ `/api/ops/telemetry-health`（聚合）→ `/ops` 埋点健康卡片（Batch 3.2） |
| DA-5 | 双 A/B 系统合并策略（`abTest.js` vs `experiment_configs`） | P2 | 1 | — | ✅ `experimentUnified`：abTest 为唯一分桶口径 + 合并注册表 + 尊重 DA-3 暂停（Batch 6） |

#### ⑤ 分群 / 画像一致性

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| SG-1 | 统一分群 SSOT（whale/segment5/cohort/VIP 收敛为一套） | P1 | 3 | — | ✅ 已实现（segmentation.js，已同步各端） |
| SG-2 | VIP tier ↔ `adTrigger` T-tier 对齐 + 权益自动联动 | P1 | 1 | — | ✅ 已修复（getCurrentTier + window 钩子） |
| SG-3 | 服务端画像 + 跨设备同步 | P2 | 5 | — | ✅ `player_profiles` 表 + `/api/profile/sync|get`（rev 版本号，换设备恢复，Batch 6） |

#### ⑥ LiveOps / 留存 Meta

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| LO-1 | 运营活动日历 + 配置化下发（`campaignManager` / CMS UI） | P2 | 5 | — | ✅ `retention/campaignManager.js`（窗口/周期/受众解析）+ `shared/campaigns.json`（Batch 6，已同步各端） |
| LO-2 | `goalSystem` 持久化 + 每日刷新 + 接入主循环 | P2 | 3 | — | ✅ 持久化+每日刷新+主循环接线全落地（`game.js endGame`→`retentionManager.afterGameEnd`→`goalSystem`，Batch 3） |
| LO-3 | `retentionManager` 接入 game loop | P2 | 1 | — | ✅ `game.js endGame` 调 `retentionManager.afterGameEnd`（Batch 3） |
| LO-4 | 召回分层（3/7/14/30 天）+ 回归礼包 | P2 | 3 | — | ✅ `retention/winbackTiers.js`（分层 + 礼包梯度，Batch 6，已同步各端） |
| LO-5 | 小程序 `lifecycle` 对齐 Web | P2 | 3 | — | ✅ 纯决策模块（segmentation/campaignManager/winbackTiers）已纳入 `sync-core`/`sync-cocos`，小程序/cocos 与 Web 一致（Batch 6） |

#### ⑦ 社交 / 竞争循环

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| SO-1 | 真排行榜 UI（全服 / 好友 / 周榜） | P2 | 3 | 接口已有 | ✅ `leaderboardScreen.js`（全服/周榜/好友三 tab + 我的排名）+ `/api/leaderboard/board` + 菜单入口（Batch 3.2） |
| SO-2 | 分享入口 + `ref` 邀请奖励（拉动 K 因子） | P2 | 2 | replayShare 已有 | ✅ 客户端 `inviteRewardSystem` + 服务端 `invites`/`/api/invite/record`/`/api/ops/k-factor` + `/ops` K 因子卡片（Batch 3/3.1） |
| SO-3 | 好友 PB 对比 / 挑战 | P2 | 3 | SO-2 | ✅ `/api/social/pb-compare`（invites 关系图，返回 myRank/gapToNext/nextFriend，Batch 6） |

#### ⑧ 模型 / ML（兑现或止损）

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| ML-1 | ZILN LTV / MTL / bandit 灰度 A/B 放量或显式封存 | P2 | 5 | DA-2 | ✅ `ml/mlGovernance.js` 显式封存（sealed/canary/ga + rolloutPct + 原因），`isMlFeatureEnabled` 统一门控（Batch 6） |
| ML-2 | `SpawnPolicyNet` / L2 `policies.json` 部署同步（git 已删，部署风险） | P1 | 1 | — | ✅ 恢复 git 跟踪但工作树缺失的 `policies.json`+`policies.meta.json`，`spawnBundleSync` 转绿（Batch 3）；部署须确保该 600KB 离线包随构建产出 |

#### ⑨ 策略设计 / 体验健康

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| EX-1 | 降复杂度 / 调参治理（`profileAudit` session-arc 违反 67%） | P2 | 5 | — | ✅ `engine/complexityGuard.js`（难度斜率上限 + 连升强制释放 + `evaluateArcHealth` 复核，Batch 6） |
| EX-2 | 感知操控守卫（喂分透明度 + 平台分化喂分审视） | P3 | 2 | — | ✅ `monetization/feedGuard.js`（透明助力记录 + 强度夹紧 + 跨平台差异审计，Batch 6） |
| EX-3 | 维度/契约 CI 校验（`GAME_EVENTS`、四端 hash 同步） | P2 | 2 | — | ✅ `tests/contractSync.test.js`（79 例守护 sync-core/sync-cocos 漂移 + game_rules 契约，Batch 6） |

#### ⑩ 合规 / 安全（上线必备）

| ID | 改进动作 | 优先级 | 人日 | 依赖 | 状态 |
|----|----------|:----:|:----:|------|------|
| CS-1 | 服务端权威分数（回放重算，防作弊） | P1 | 5 | — | ✅ plausibility（Batch 2）+ 确定性回放重算 `server_replay.py` + `/api/score/replay-verify`（操作日志复算比对，Batch 6） |
| CS-2 | 行为上报鉴权（Token / 签名） | P1 | 1 | — | ✅ `server_security.require_write_auth`（HMAC 签名，env 灰度，已挂 score/payment，Batch 2） |
| CS-3 | 隐私同意 CMP UI + 未成年人策略 | P1 | 3 | — | ✅ `privacy/consentManager.js`（opt-in CMP 弹层 + 未成年人强制关闭个性化/分析 + 类目门控，Batch 6） |
| CS-4 | 订单对账 / 退款 Webhook | P1 | 3 | MO-2 | ✅ `/api/payment/webhook`（验签→退款→`entitlement_revocations` 令牌失效）+ `/api/ops/reconcile`（Batch 4） |

#### 三阶段实施节奏（建议）

| 阶段 | 周期 | 目标 | 纳入项 |
|------|------|------|--------|
| **一** | ≈ 2 周 | 真实变现 + 基础度量 | MO-1~4、UA-1、DA-1、CS-2、CS-4 |
| **二** | ≈ 1 月 | 闭环度量 + 一致性 | UA-2/3/4、RT-1~4、SG-1/2、ML-2、CS-1/3 |
| **三** | 季度 | 规模化运营 | LO-1~5、SO-1~3、ML-1、DA-2~5、EX-1~3、SG-3、UA-5 |

> **闭环顺序铁律**：先 ③ 真实变现 → 真实 LTV → ④ 付费回流 → ① Cohort LTV / ROAS / 出价校准，再按 ROAS 放大买量。② 承接已是强项，应「分流精修」而非重复加深。

#### 剩余项分类（已于 Batch 4/5/6 全量落地，下表为「真实接入」收尾说明）

> A/B/C 三类均已落地：A 用「配置化 Provider + 桩」端到端跑通，B 接通管线并写入 Demo
> 数据，C 15 项纯工程全部实现。下表标注从「桩」切「真实」时仅需补的外部材料与挂点。

**A. 已配置化 + 桩跑通 —— 拿到密钥仅需切 `providerConfig` 即生效**

| ID | 状态 | 切真实所需材料 | 代码挂点（已就位） |
|----|------|----------------|----------------------|
| UA-1 | ✅ stub MMP | AppsFlyer/Adjust **dev key** + App ID | `attributionProvider`（改 `attribution.type`）+ `/api/attribution/postback` + `attributions` 表 |
| MO-1 | ✅ stub 广告 | AdMob **App ID + Ad Unit ID** 或 AppLovin **SDK Key + 单元** | `adProviders`（改 `ad.type` + 填 key）+ `adAdapter` 自动安装 Provider |
| MO-2 | ✅ stub 验单 | 微信 **mchid+APIv3 key+证书** / 支付宝 **appid+私钥+公钥** / Stripe **secret+webhook secret** | `server_payments.verify_purchase` 渠道分支 + `/api/payment/verify` |
| CS-4 | ✅ 全通 | 同 MO-2（退款回调 URL + 验签密钥） | `/api/payment/webhook`（`verify_webhook_signature` 渠道分支）+ `/api/ops/reconcile` |

**B. 管线已接通 + Demo 数据 —— 导入真实数据即替换**

| ID | 状态 | 缺什么 | 一旦补齐 |
|----|------|--------|----------|
| UA-3 | ✅ 全通 | 真实媒体花费（API 或 CSV → `/api/ops/spend/import`） | `/ops` Cohort ROAS 由 Demo 变真实值 |
| MO-3 | ✅ 口径就位 | MO-1/2 真实流水 | `arpdau/ltv` 由估算变真实 |
| ML-2 | ✅ 已转绿 | — | EX-3 契约测试已覆盖同步漂移 |

> Demo 数据生成：`OPENBLOCK_DB_PATH=... python3 scripts/seed_demo_data.py --users 200 --days 30`

**C. 纯工程 —— 全部已实现（见上表 ✅）**

> RT-4 / DA-3 / DA-5 / LO-1 / LO-4 / LO-5 / SO-3 / ML-1 / EX-1 / EX-2 / EX-3 / CS-1 / CS-3 / SG-3 均已落地并通过测试（Batch 6）。RT-3 冷启动首局已由既有 `warmRun`（T8_paid_acquisition）覆盖。

#### 已就绪的运行开关（接入外部前可先验证链路）

| 环境变量 | 作用 | 默认 |
|----------|------|------|
| `API_SECRET_KEY` | CS-2 写鉴权 / MO-5 令牌的 HMAC 密钥 | 必填（生产） |
| `OPENBLOCK_REQUIRE_WRITE_AUTH` | 开启写接口签名校验（score/payment/invite/telemetry） | off（灰度） |
| `OPENBLOCK_REJECT_IMPLAUSIBLE_SCORE` | CS-1 拒收不合理分数（否则仅审计入 `score_audits`） | off |
| `WECHAT_MCH_ID` / `WECHAT_APIV3_KEY` | MO-2 微信支付验单凭据（缺则该渠道返回 `unconfigured`） | 空（走 stub） |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` | MO-2 支付宝验单凭据 | 空（走 stub） |
| `STRIPE_SECRET_KEY` | MO-2 Stripe 验单凭据 | 空（走 stub） |

> 客户端 Provider 选型见 `web/src/monetization/providerConfig.js`（默认全 `stub`；构建期注入 `globalThis.__OPENBLOCK_PROVIDERS__` 或运行期 `localStorage['openblock_provider_config']` 覆盖）。

#### 增长飞轮上报通路（各端「无网络本地缓存 → 联网批量上报」）

| 端 | 模块 | 行为通路 | 广告计费通路 |
|----|------|----------|--------------|
| Web / Cocos | `web/src/net/reportingOutbox.js`、`cocos/.../platform/ReportingOutbox.ts` | `analyticsTracker`/`AnalyticsSink` → `/api/behavior/batch` | `adAdapter`/`Ads` → `/api/ad/impression` |
| 小程序 | `miniprogram/utils/reportingOutbox.js` | `game.js`/`app.js` → `/api/behavior/batch` | `miniprogram/utils/adSim.js` → `/api/ad/impression` |

> 计费口径：插屏 ¥0.02/次、激励 ¥0.05/次（SSOT `providerConfig.ad.stub.revenuePerShowCny`，各端对齐）；买量 CPI ¥2（`providerConfig.acquisition.cpiCny`）。
> 服务端：`/api/ad/impression` 写 `ad_revenue`（event_id `UNIQUE` 去重）+ `ad_show/ad_complete` 行为；`/api/ops/dashboard` 的 `ecpm` 由 `ad_revenue` 驱动、`ARPDAU` 为 (IAP+广告)/DAU 混合口径；`/api/ops/cohort-ltv` 把广告收益并入 LTV/ROAS。
> 离线策略：每条带 `event_id`、本地持久化、上报成功才出队（at-least-once）；`online`/重连/可见性变更触发 flush；队列 FIFO 上限防离线无限增长。

> **🟢 各端 ↔ 统一后端联通能力强化（统一配置格式 · 离线缓存/联网同步 · 后端分端统计）**：
> - **统一配置格式（SSOT）**：`shared/client_net_config.json` 声明全端同构的网络上报配置 schema + 默认值——`{ apiBase, platform, appVersion, enabled, flushIntervalMs, batchSize, maxQueue, maxRetryBackoffMs, channels }`。Web 经 `web/src/net/netConfig.js` 的 `resolveNetConfig()` 合并；小程序/cocos 内联同名字段镜像（无构建期 JSON import）。三端 `initReportingOutbox/configure` 接受**完全相同的配置形状**。
> - **离线缓存 + 联网同步（各端同协议）**：行为 + 广告统一走「本地持久化队列 → 联网批量上报」；每条自动盖 **envelope**（`event_id` 去重 + `platform`/`app_version` + `ts`），批次级 meta 同样带 `platform`/`app_version`；上报成功才出队（at-least-once）；新增**纯失败指数退避**（仅作用于周期触发，封顶 `maxRetryBackoffMs`；`online`/重连/显式 flush 立即清退避），断网不空打、重连即补传。
> - **平台注入**：`main.js`→`platform:'web'`（`appVersion` 取 `VITE_APP_VERSION`）、`app.js`→`miniprogram`、`Bootstrap.ts`→`cocos`/`wechat_game`（按 `Platform.isWechat()` 细分）。
> - **后端分端统计**：`behaviors` 表新增 `platform`/`app_version` 列（`ad_revenue` 增 `app_version`，迁移幂等）；`/api/behavior/batch`、`/api/ad/impression` 读取「事件级 → 批次级」platform/app_version 并落库（`ad_show/ad_complete` 行为同样带 platform）；**新增 `/api/ops/by-platform?days=N`** 按端聚合 `activeUsers / events / adShows / adRevenueCny`（缺失归 `unknown`），供运营看板做 Web/小程序/Cocos/微信小游戏 分端拆分对比。
> - 测试：`reportingOutbox`(7：含 envelope/统一配置/批次 meta/不覆盖自带 platform) + `server_platform`(4：事件级/批次级 platform 落库、广告 platform 透传、by-platform 聚合)。**当前累计 JS 177 文件 / 3102 例（1 skip）+ PY 各 batch 隔离全绿 + lint 0**。

---

## 一、P0 · 真实变现接入

**现状**：`adAdapter.js`、`iapAdapter.js` 均处于 `stubMode=true`，所有广告展示为弹窗模拟，IAP 为确认框模拟。**不产生任何真实收入**。

### 1.1 广告 SDK 接入

#### 接入路径建议（优先级排序）

| 平台 | SDK | 适用场景 | eCPM 均值（休闲） |
|------|-----|---------|----------------|
| **Google AdMob** | `window.adsbygoogle` / AdMob Web Beta | PWA / Web 首选 | ¥8–20 |
| **AppLovin MAX** | MAX Web SDK | 竞价（Bidding）最优 | ¥12–35 |
| **Unity Ads** | Unity Web Monetization | 休闲游戏生态匹配 | ¥10–28 |
| **Meta Audience Network** | FAN Web | 社交定向精准 | ¥15–40 |

#### 接入改造点（最小侵入性）

`adAdapter.js` 的 `setAdProvider(provider)` 接口已预留，真实接入只需：

```javascript
// 接入 AdMob（示例）
import { setAdProvider } from './adAdapter.js';

setAdProvider({
    showRewarded: async (reason) => {
        return new Promise(resolve => {
            googletag.pubads()... // 真实 AdMob 调用
            resolve({ rewarded: true });
        });
    },
    showInterstitial: async () => {
        // 真实插屏调用
    }
});
```

**待办**：
- [ ] 申请 AdMob 账号，生成广告单元 ID
- [ ] 在 `index.html` 引入 AdMob Web SDK
- [ ] 在 `featureFlags.js` 将 `stubMode: true` 改为生产环境 `false`

### 1.2 IAP 支付接入

#### 支付渠道建议

| 渠道 | 适用 | 手续费 | 开发工作量 |
|------|------|--------|----------|
| **Stripe Web** | PC/PWA 全平台 | 2.9% + ¥0.3 | 低（已有接口） |
| **微信支付 JS-SDK** | 国内微信内置浏览器 | 0.6% | 中 |
| **支付宝 JSAPI** | 国内支付宝内置 | 0.6% | 中 |
| **Apple IAP** | iOS Safari PWA | 30% | 高（需 App Store 账号） |

**待办**：
- [ ] Stripe 账号 → 生成 Publishable Key
- [ ] `iapAdapter.js` 中的 `setIapProvider` 注入真实 Stripe 流程
- [ ] 服务端 `server.py` 新增 `/api/payment/verify` 对账接口（防刷单）
- [ ] 国内用户判断：根据 IP/语言识别后切换支付宝/微信

---

## 二、P1 · 运营数据看板

**现状**：`monPanel.js` 提供了「商业化模型训练面板」，但面向**技术人员**，展示的是分群信号、模型参数等。运营人员需要的是**业务指标看板**。

**缺口**：没有任何运营向的指标仪表盘（留存率、ARPDAU、转化漏斗、分群趋势）。

### 2.1 需要的关键指标

#### 留存层

| 指标 | 定义 | 目标基线 | 数据来源 |
|------|------|---------|---------|
| **D1 留存** | 次日再游率 | ≥40% | `sessions` 表 |
| **D7 留存** | 第7天再游率 | ≥20% | `sessions` 表 |
| **D30 留存** | 第30天再游率 | ≥8% | `sessions` 表 |
| **Session 长度** | 平均单次游戏时长 | ≥4 分钟 | `sessions.duration` |
| **每日局数** | 用户日均游戏局数 | ≥3 局 | `sessions` 表 |

#### 变现层

| 指标 | 定义 | 目标基线 | 数据来源 |
|------|------|---------|---------|
| **ARPDAU** | 每日活跃用户平均收入 | ≥¥0.15 | 广告收益 + IAP |
| **广告 Fill Rate** | 广告请求填充率 | ≥85% | `adAdapter` 埋点 |
| **激励视频 CVR** | 看完广告/弹出率 | ≥75% | `adTrigger` 埋点 |
| **IAP 首购率** | 付费玩家/活跃用户 | ≥1.5% | `iapAdapter` 埋点 |
| **LTV_30d 实际值** | 真实 vs 预测误差 | <20% 误差 | 收益对账 |

#### 用户层

| 指标 | 定义 | 目标 |
|------|------|------|
| **分群分布** | A/B/C/D/E 各占比 | D 类占比 >8% |
| **段位流失** | 各分群 7 日未游率 | C 类 <15% |
| **局间任务完成率** | miniGoals 完成/生成 | >55% |
| **小目标触发转化** | 看广告兑换/任务完成 | >30% |

### 2.2 看板技术方案

**建议**：在 `server.py` 中新增 `/api/ops/dashboard` 聚合接口，在 `docs.html` 侧边栏增加「运营看板」入口，复用现有 Bootstrap 风格。

```python
# server.py 新增 /api/ops/dashboard
@app.route('/api/ops/dashboard', methods=['GET'])
def ops_dashboard():
    """运营看板聚合接口（按日期范围）"""
    days = int(request.args.get('days', 7))
    # 留存、局数、分群分布、任务完成率等
    ...
```

**待办**：
- [ ] `server.py` 新增 `/api/ops/dashboard` 聚合查询（留存/ARPDAU/分群趋势）
- [ ] 在 `web/docs/` 目录新建 `ops-dashboard.html` 运营看板页
- [ ] `docs.html` 侧边栏增加「运营看板」快捷入口

---

## 三、P2 · A/B 测试框架

**现状**：所有商业化参数（广告频率、IAP 价格、弹出时机）均为单一值，无法验证优化假设。

**问题**：没有 A/B 测试能力，等于在盲目猜测最优参数。

### 3.1 需要 A/B 测试的关键变量

| 测试变量 | 实验组设置 | 对照组 | 核心指标 |
|---------|----------|--------|---------|
| 广告弹出时机 | 游戏结束后 3s | 立即弹 | 广告 CVR、次日留存 |
| 激励广告触发条件 | 连续 3 次无消 | 连续 5 次 | 激励广告曝光/次 |
| IAP 首购价格 | ¥6 入门包 | ¥12 入门包 | IAP CVR、ARPU |
| 复活弹窗倒计时 | 4 秒 | 8 秒 | 复活转化率 |
| 小目标难度 | easy 档 n×0.8 | 原始 n | 任务完成率、留存 |

### 3.2 轻量 A/B 框架设计

```javascript
// web/src/abTest.js（新建）
const AB_SALT = 'openblock_ab_v1';

/**
 * 根据用户 ID 和实验名稳定分桶
 * @param {string} userId
 * @param {string} experiment  实验名
 * @param {number} buckets     分桶数（默认2）
 * @returns {number} 0 ~ buckets-1
 */
export function getBucket(userId, experiment, buckets = 2) {
    // 简单哈希确保同一用户在同一实验中恒定分桶
    const hash = [...`${AB_SALT}:${experiment}:${userId}`]
        .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
    return hash % buckets;
}

/**
 * 获取实验组参数
 * @param {string} experiment  实验名
 * @param {Array}  variants    各桶的参数值
 */
export function getVariant(userId, experiment, variants) {
    const bucket = getBucket(userId, experiment, variants.length);
    return variants[bucket];
}
```

**待办**：
- [ ] 新建 `web/src/abTest.js`（哈希分桶，无后端依赖）
- [ ] 对「复活倒计时」、「小目标难度」、「广告触发阈值」接入 A/B 分桶
- [ ] `server.py` 新增 `/api/ab/report` 接收实验数据，存入 `ab_events` 表
- [ ] 1 周后对比各组核心指标，选择胜出方案

---

## 四、P3 · 价格体系与 IAP 漏斗优化

**现状**：`iapAdapter.js` 中有 4 个固定产品（移除广告 ¥18、提示包 ¥6、周卡 ¥12、月卡 ¥30），缺乏**首购引导**和**动态礼包**设计。

### 4.1 价格体系缺口

#### 当前产品目录问题

| 问题 | 说明 | 影响 |
|------|------|------|
| 无入门钩子 | 最低 ¥6，对新用户仍有摩擦 | 首购率低 |
| 无限时礼包 | 无折扣感/紧迫感 | 冲动购买无触发 |
| 无年卡/终身 | 订阅只有周卡/月卡 | C 类鲸鱼无长期产品 |
| 价格固定 | 所有用户同一价格 | D 类高价值用户未被充分挖掘 |

#### 建议补充的产品

```javascript
// 补充到 iapAdapter.js PRODUCTS
starter_pack: {
    id: 'starter_pack',
    name: '新手礼包',
    desc: '提示 ×3 + 皮肤 1 款（仅首购可用）',
    price: '¥3',            // 低门槛首购引导
    priceNum: 3,
    type: 'one_time',
    firstPurchaseOnly: true,
},
weekly_pass_discount: {
    id: 'weekly_pass_discount',
    name: '限时周卡（7折）',
    desc: '7天每日奖励翻倍，限时特惠',
    price: '¥8',            // ¥12→¥8 折扣版
    priceNum: 8,
    type: 'limited_time',
    expireHours: 48,        // 48h 倒计时
},
annual_pass: {
    id: 'annual_pass',
    name: '年度通行证',
    desc: '365天每日奖励 + 全皮肤 + 去广告',
    price: '¥88',
    priceNum: 88,
    type: 'subscription',
    period: 'yearly',
},
```

### 4.2 IAP 转化漏斗优化

```
曝光（弹出 IAP 界面）
    → 查看商品详情
        → 点击购买
            → 完成支付
                → 首购
```

**各环节优化点**：

| 漏斗节点 | 当前问题 | 改进方案 |
|---------|---------|---------|
| 曝光时机 | 只在游戏结束/复活触发 | 增加「好局完成后」主动推荐（损失厌恶低时更易接受） |
| 产品展示 | 列表平铺，无视觉层次 | 使用「推荐标签」突出高转化产品，热门商品置顶 |
| 购买障碍 | 没有「已有其他用户购买」社交证明 | 增加购买人数显示（虚拟或真实） |
| 首购后续 | 无留存钩子 | 首购后7天推送「回归礼包」（续费折扣） |

**待办**：
- [ ] `iapAdapter.js` 增加 `starter_pack`、`weekly_pass_discount`、`annual_pass`
- [ ] 新建 IAP 展示 UI（分层卡片，高亮「推荐」商品）
- [ ] 接入首购特判逻辑（`firstPurchaseOnly` 标记）
- [ ] 限时礼包倒计时组件

---

## 五、P4 · 广告频控与体验平衡

**现状**：`adTrigger.js` 中有 `MAX_REWARDED_PER_GAME = 3` 的单局上限，但没有：
- 跨局全局频控（每日上限）
- 广告冷却时间（相邻两次的最小间隔）
- 付费用户自动跳过（已有 `isAdsRemoved` 标记，但插屏无差异化）

### 5.1 广告频控参数建议

```javascript
// adTrigger.js 缺失的控制参数
const AD_CONFIG = {
    rewarded: {
        maxPerGame: 3,       // 单局上限（现有）
        maxPerDay: 12,       // 日上限（缺失）
        cooldownMs: 90_000,  // 两次之间最短间隔 90s（缺失）
    },
    interstitial: {
        minSessionsBeforeFirst: 3,  // 新用户前3局不弹（缺失）
        cooldownMs: 180_000,        // 3分钟间隔（缺失）
        skipForPaidUsers: true,     // 付费用户跳过（缺失）
    },
    banner: {
        enabled: false,    // 暂不开启 Banner（eCPM 低，影响布局）
    }
};
```

### 5.2 广告体验评分（Ad Experience Score）

建议引入「广告体验分」自动评估：

```
体验分 = 100
    - (本日激励视频次数 - 8) × 5   [超出8次扣分]
    - (本日插屏次数 - 4) × 10      [超出4次重罚]
    + 看完率 × 10                  [用户主动看加分]
```

若体验分 < 60，触发「休养期」（48h 内降低广告频率），防止流失。

**待办**：
- [ ] `adTrigger.js` 增加日上限计数器（`localStorage` 跨局持久）
- [ ] 增加冷却时间（`lastAdTs` 记录上次展示时间戳）
- [ ] 插屏：新用户前 3 局豁免 + 付费用户静默跳过
- [ ] 实现广告体验分评估，自动触发「休养期」

---

## 六、P5 · 运营活动系统

**现状**：赛季通行证的任务和奖励完全**硬编码**在 `seasonPass.js`（`CURRENT_SEASON` 对象），无法通过服务端动态下发活动内容。

**问题**：
- 节庆活动（春节皮肤、周年庆限时模式）需要**上线改代码**才能生效
- A/B 测试不同活动内容无法实施
- 多地区差异化运营无法支持

### 6.1 运营活动配置化方案

```
┌──────────────────────────────────────────────────┐
│              运营活动管理（后端）                    │
│  /api/ops/campaign                               │
│  ├─ 当前活动列表（id, type, startTs, endTs）      │
│  ├─ 活动内容（任务、奖励、UI皮肤、特效）            │
│  └─ 分群定向（target: ['C', 'D'] 只对C/D推送）    │
└────────────────────────────┬─────────────────────┘
                             │ 下发（启动时 fetch）
┌────────────────────────────▼─────────────────────┐
│              前端活动系统（新建）                   │
│  campaignManager.js                              │
│  ├─ fetchCampaigns()    拉取当前有效活动            │
│  ├─ isActive(id)        判断活动是否对本用户生效     │
│  └─ renderBanner(id)    渲染活动入口横幅            │
└──────────────────────────────────────────────────┘
```

#### 活动类型设计

| 活动类型 | 触发场景 | 示例 |
|---------|---------|------|
| `seasonal_skin` | 节日期间 | 春节皮肤（红色方块主题）限时解锁 |
| `double_xp` | 周末 | 周末双倍赛季积分 |
| `flash_sale` | 运营需要 | 月卡48小时7折 |
| `milestone_challenge` | 里程碑激活 | 累计消除1000行送皮肤 |
| `recall_gift` | 7日未登录用户 | 「回来就送」限时道具包 |

**待办**：
- [ ] `server.py` 新增 `/api/ops/campaign` 接口（活动 CRUD）
- [ ] 新建 `web/src/campaignManager.js`（活动拉取、渲染、分群过滤）
- [ ] `seasonPass.js` 的任务配置改为从服务端读取（fallback 本地硬编码）
- [ ] 数据库新增 `campaigns` 表

---

## 七、P6 · 社交传播与病毒系数

**现状**：`replayShare.js` 和 `leaderboard.js` 已存在，但：
- 回放分享：**无 UI 入口**（未集成到游戏结算界面）
- 排行榜：**只有自己的历史**（无多用户对比）
- 无任何邀请机制（口碑传播路径断裂）

**影响**：K 因子（Viral Coefficient）= 0，所有新用户依赖买量，CAC 居高不下。

### 7.1 社交传播改进路径

#### 分享机制（低成本，高 ROI）

```
游戏结算界面
  → 「分享成绩」按钮
      → Web Share API（手机）/ 复制链接（PC）
          → 带 UTM 参数的分享链接（?utm_source=share&utm_medium=friend&ref=userId）
              → 新用户安装后，分享者获得奖励（激励循环）
```

| 分享内容 | 实现方式 | 病毒潜力 |
|---------|---------|---------|
| 成绩截图 | `canvas.toBlob()` + Web Share API | 中 |
| 对战挑战 | 「挑战我的 {score} 分」链接 | 高 |
| 回放片段 | Canvas 录制 GIF（已有 `replayShare.js`） | 高 |

#### 排行榜改造

```
现状：本地存储（无多用户）
目标：
  ├─ 全服排行（现有 /api/leaderboard 接口，但 UI 未展示）
  ├─ 好友排行（基于分享链接引入的关联用户）
  └─ 周榜（每周重置，提供持续竞争动机）
```

**待办**：
- [ ] 游戏结算界面增加「分享」按钮（Web Share API + fallback 复制链接）
- [ ] 分享链接携带 `ref=userId` 参数，`channelAttribution.js` 解析后发放邀请奖励
- [ ] `leaderboard.js` 接入 `/api/leaderboard` 接口，渲染多用户排行榜 UI
- [ ] 增加周榜（服务端按周区间聚合分数）

---

## 八、P7 · 用户召回体系完善

**现状**：`pushNotification.js` 实现了 Web Push 框架，但：
- 召回条件仅有「沉默 24h」一种
- 消息文案分群差异化有限
- 无「回归礼包」触达（用户回来没有钩子）

### 8.1 召回分层设计

| 沉默时长 | 分群 | 触达方式 | 内容 |
|---------|------|---------|------|
| 24h | 所有 | Web Push | 「你的连续积分记录还在等你」 |
| 3天 | A/B | Web Push | 「3天没玩了！今天的小目标还没完成」 |
| 7天 | C/D | Web Push + 回归礼包 | 「久违了！回归专属礼包已备好」 |
| 14天 | C/D | 邮件（若已登录） | 「你还记得自己的最高分吗？」+ 新内容介绍 |
| 30天 | 所有 | 渠道再营销（DSP） | 程序化广告触达（需 UUID 上传 DMP） |

### 8.2 回归礼包设计

```javascript
// 新增：回归礼包（沉默 7 天后回来的用户）
recall_gift: {
    id: 'recall_gift',
    name: '回归礼包',
    desc: '欢迎回来！提示 ×3 + 本周免费赛季积分 ×50',
    condition: 'silence_7d',   // 7天未登录
    expires: 48,               // 领取后有效48h
    free: true,                // 免费，不需要付费
}
```

**待办**：
- [ ] `pushNotification.js` 增加 3 天、7 天分层触达
- [ ] 新增「回归礼包」逻辑（沉默 7 天后首次开局弹出）
- [ ] `server.py` 新增 `/api/recall-gift/claim` 接口防止重复领取

---

## 九、优先级矩阵总览

```
投入产出比
  高 │ P0 真实变现接入  ──────────────── P2 A/B 测试框架
     │ (能产生收入)         (低成本验证假设)
     │
  中 │ P3 价格体系优化  P6 社交传播      P5 活动系统
     │ (提升 ARPU)    (降低 CAC)        (内容持续性)
     │
  低 │ P1 运营看板      P4 广告频控      P7 召回体系
     │ (辅助决策)      (体验保障)        (长期留存)
     └─────────────────────────────────────────────
       短期（2周）        中期（1月）       长期（季度）
                          实施周期
```

### 分阶段实施建议（参考）

#### 第一阶段（2 周）—— 真实变现

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| AdMob Web SDK 接入 | `adAdapter.js` | 3天 |
| Stripe 支付接入 | `iapAdapter.js` + `server.py` | 3天 |
| `featureFlags` 生产配置 | `featureFlags.js` | 0.5天 |
| 支付验签接口 | `server.py /api/payment/verify` | 1天 |

#### 第二阶段（1 个月）—— 运营工具

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| 运营数据看板 | `server.py` + `ops-dashboard.html` | 5天 |
| A/B 测试框架 | `abTest.js` | 2天 |
| IAP 漏斗优化 | `iapAdapter.js` + UI | 3天 |
| 广告频控完善 | `adTrigger.js` | 2天 |

#### 第三阶段（季度）—— 规模化运营

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| 活动配置化系统 | `campaignManager.js` + `server.py` | 7天 |
| 社交分享 + 排行榜 | `replayShare.js` + `leaderboard.js` | 5天 |
| 召回体系分层 | `pushNotification.js` + `server.py` | 4天 |
| DSP 再营销对接 | 外部对接 | 外包 |

---

## 十、KPI 基线定义

### 变现健康度指标

| 指标 | 冷启动目标（1月） | 成熟目标（6月） |
|------|------------|------------|
| ARPDAU | ¥0.05 | ¥0.20 |
| IAP 首购率 | 0.5% | 2.0% |
| 激励视频完播率 | 60% | 80% |
| 日均激励视频曝光/用户 | 4次 | 10次 |
| LTV_30d（D 类） | ¥3 | ¥12 |

### 留存健康度指标

| 指标 | 基线（当前） | 目标 |
|------|----------|------|
| D1 留存 | — | 40% |
| D7 留存 | — | 20% |
| 小目标完成率 | — | 55% |
| 赛季任务参与率 | — | 35% |
| 召回 Push 点开率 | — | 12% |

### 传播效率指标

| 指标 | 目标 |
|------|------|
| K 因子（病毒系数） | ≥0.15（每10位用户带1.5位新用户） |
| 分享率 | ≥8%（结算界面触达率） |
| 邀请转化率 | ≥25%（点开链接→安装） |

---

## 附录：商业运营 vs 已实现技术能力对照

| 运营需求 | 现有技术能力 | 状态 |
|---------|-----------|------|
| 真实广告收入 | `adAdapter.js` Stub 完备 | ❌ 无真实 SDK 接入（需申请 AdMob 账号） |
| 真实 IAP 收入 | `iapAdapter.js` Stub 完备 | ❌ 无真实支付接入（需 Stripe/微信支付） |
| 动态活动下发 | `seasonPass.js` 硬编码 | ❌ 当前无配置化活动系统 |
| 病毒传播 | `replayShare.js` 有代码，无 UI | ⚠️ 有基础能力，当前无完整入口 |
| 分层召回 | `pushNotification.js` 单层 | ⚠️ 有框架，当前无分层运营闭环 |
| 运营数据看板 | `/api/ops/dashboard` + `ops-dashboard.html` | ✅ 已实现 |
| A/B 测试框架 | `abTest.js`（5个内置实验，哈希分桶） | ✅ 已实现（测试 13/13 通过） |
| IAP 首购引导 | `starter_pack`(¥3) + `weekly_pass_discount` + `annual_pass` | ✅ 已实现 |
| 广告频控完善 | 日上限/冷却时间/新用户豁免/体验分 | ✅ 已实现（测试 22/22 通过） |
| LTV 预测 | `ltvPredictor.js` 完整 | ✅ 已实现（规则引擎） |
| 用户五分群 | `playerProfile.segment5` | ✅ 已实现 |
| 赛季通行证 | `seasonPass.js` + 服务端同步 | ✅ 已实现 |
| 局间小目标 | `miniGoals.js` | ✅ 已实现 |
| B 类进阶难度 | `adaptiveSpawn.js` 挑战档 | ✅ 已实现 |

## 第一轮代码落地总结

### ✅ P2：A/B 测试框架（`web/src/abTest.js`）

**设计**：哈希分桶（userId × 实验名 → bucket），纯客户端确定，无后端依赖。

**5 个内置实验**：

| 实验名 | 对照组 | 实验组 | 核心指标 |
|--------|--------|--------|---------|
| `interstitial_delay` | 立即展示 | 延迟 3s | 广告 CVR、D1 留存 |
| `rewarded_threshold` | 连续 5 次未消行 | 连续 3 次 | 激励曝光次/用户 |
| `iap_starter_price` | ¥6 | ¥3 | IAP 首购率 |
| `revive_countdown` | 8 秒 | 4 秒 | 复活转化率 |
| `minigoal_difficulty` | 原始 n | n×0.8 | 任务完成率 |

**运营工具**：`forceVariant(exp, bucket)` 可强制 QA 指定变体；`debugReport(userId)` 查看所有实验状态。

**后端接入**：`/api/ab/report` 接收转化事件，`/api/ab/results` 汇总实验结果。

---

### ✅ P3：IAP 价格体系补全（`iapAdapter.js`）

新增 3 款产品：

| 产品 | 价格 | 类型 | 特点 |
|------|------|------|------|
| `starter_pack` | ¥3 | 首购限定 | 低门槛首购引导（`firstPurchaseOnly=true`） |
| `weekly_pass_discount` | ¥8 | 限时折扣 | 48h 倒计时（`expireHours=48`） |
| `annual_pass` | ¥88 | 年度订阅 | 365天+全皮肤+永久去广告 |

新增工具函数：`canPurchaseStarterPack()`、`getLimitedTimeRemaining()`、`createLimitedTimeOffer()`。

---

### ✅ P4：广告频控完善（`adTrigger.js v2`）

| 控制维度 | 旧版 | 新版 |
|---------|------|------|
| 单局激励上限 | 3次 | 3次 |
| **日激励上限** | ❌ | 12次/天 |
| **激励冷却** | ❌ | 90s |
| **日插屏上限** | ❌ | 6次/天 |
| **插屏冷却** | ❌ | 180s |
| **新用户豁免** | ❌ | 前3局不展示插屏 |
| **付费用户静默** | 部分 | 月卡/年卡/annual_pass 完整豁免 |
| **广告体验分** | ❌ | 自动计算，<60 触发休养期 |
| **A/B 接入** | ❌ | 插屏延迟/激励阈值 A/B 分桶 |

---

### ✅ P1：运营看板（`/ops` 路由 + `ops-dashboard.html`）

访问 `http://localhost:5000/ops` 查看：

- **活跃度卡片**：DAU / 人均局数 / 平均时长
- **留存率表**：D1/D7 留存 + 目标基线对比
- **用户分群分布**：A/B/C/D/E 五分群占比可视化
- **DAU 趋势图**：按天柱状图（支持 1/7/30 天切换）
- **Top10 分数排行**
- **A/B 实验结果汇总**：各实验各桶转化事件数对比

---

*本文档面向商业运营视角，技术实现细节参见 [MONETIZATION.md](./MONETIZATION.md)*


---

## 商业化与企业能力对照表

> 本文是 OpenBlock 商业化 / 企业能力的**能力对照表**，按主题列出每项能力在本仓库
> 的实现状态与验证依据，供集成团队、审计与运营核对使用。
>
> 当前事实以 [`MONETIZATION.md`](./MONETIZATION.md)、代码和测试为准；本文只做交叉
> 索引，不替代实现文档。
>
> **图例**
>
> | 符号 | 含义 |
> |------|------|
> | ✅ | 仓库内置 —— 可运行、可调用、有测试 |
> | ⚠️ | 部分内置 —— 有骨架/占位，缺少生产闭环的关键环节 |
> | 📋 | 仅文档 —— 流程或规范类，无对应自动化代码 |
> | 🔌 | 外部依赖 —— 需商户号、法务、买量合同等才能闭环 |
> | ⛔ | 规划中 —— 仓库内尚无可验收实现（非外部账号即可补齐） |

文末附 **「外部依赖汇总」** 与 **「规划中能力」** 索引。

---

### 能力矩阵

| # | 改进项 | 结论 | 验证依据（路径 / 接口） | 备注 |
|---|--------|------|-------------------------|------|
| 1 | 真实激励视频 SDK | 🔌 外部依赖 | `web/src/monetization/adAdapter.js` · `setAdProvider` | 须 AdMob 等账号与 SDK 脚本 |
| 2 | 真实插屏 SDK | 🔌 外部依赖 | 同上 | 同上 |
| 3 | 广告聚合 Mediation | 🔌 外部依赖 | `docs/integrations/ADS_IAP_SETUP.md` | 瀑布在广告平台配置，非本仓库代码 |
| 4 | 广告收益与展示埋点 | ⚠️ 部分实现 | `adAdapter.js` → `POST /api/enterprise/ad-impression`、`backend/enterprise_extensions.py` · `ad_impressions` | 已落库占位字段；**无真实 eCPM 回传解析**，收益须接入平台 API |
| 5 | Stripe Web IAP | 🔌 外部依赖 | `iapAdapter.js` · `setIapProvider`、`ADS_IAP_SETUP.md` | 须 Stripe 商户与前端 Checkout |
| 6 | 微信支付 | 🔌 外部依赖 | `docs/platform/WECHAT_MINIPROGRAM.md`、`ADS_IAP_SETUP.md` | 须微信商户与类目审核 |
| 7 | 支付宝 JSAPI | 🔌 外部依赖 | `ADS_IAP_SETUP.md` | 须支付宝开放平台应用 |
| 8 | 服务端支付校验/幂等 | ⚠️ 部分实现 | `POST /api/payment/verify`、`iap_orders` | **幂等与入库已实现**；**非** Stripe/微信/Apple **密码学收据校验**（生产须扩展 Webhook/verify） |
| 9 | 订单对账与退款策略 | ⛔ 未实现 | — | 无专用对账任务/Webhook 路由；仅 `DEPLOYMENT.md §8` 文字 |
| 10 | 「移除广告」服务端确权 | ⛔ 未实现 | `iapAdapter.js`、本地 `localStorage` | 权益仍以客户端为准；无服务端令牌校验链路 |
| 11 | 订阅周期管理 | ⚠️ 部分实现 | `iap_orders.expires_at`、`iapAdapter.js` · `_syncPurchaseToServer` | 写入过期时间；**无周期扣款/续订 webhook** |
| 12 | 地区化定价 | 📋 仅文档 | `iapAdapter.js` · `PRODUCTS` | 单一静态目录；无 Geo/IP SKU 映射 API |
| 13 | 黄金事件字典（版本化） | ⚠️ 部分实现 | `docs/engineering/REFERENCE.md`（§一）、`web/src/config.js` · `GAME_EVENTS` | **文档与常量对齐**；**无 CI 校验** `GAME_EVENTS` ↔ behaviors |
| 14 | 会话归因字段 | ✅ 已实现 | `sessions.attribution`、`server.py` · `create_session`/`patch_session`、`channelAttribution.js`、`database.js` | 含 UTM、gclid、fbclid |
| 15 | 留存报表 D1/D7/D30 | ✅ 已实现 | `GET /api/ops/dashboard` · `retention.d1/d7/d30`、`web/src/opsDashboard.js` | **D7 为 6–8 日宽松窗口**（与函数 `_retention` 一致）；口径见 `server.py` 注释 |
| 16 | ARPDAU / ARPU | ⚠️ 部分实现 | `iap_orders`、`ad_impressions` | 表可聚合；**无现成 `/api/ops` 字段返回 ARPDAU** |
| 17 | 变现漏斗 | ⚠️ 部分实现 | `GET /api/enterprise/funnel` | 按 `behaviors.event_type` 计数；**非标准漏斗步骤定义** |
| 18 | 填充率 / 激励完成率 | ⚠️ 部分实现 | `ad_impressions.filled` | 有字段；**无请求数/填充失败拆分**，无专用报表 API |
| 19 | 事件导出管道 | ⚠️ 部分实现 | `GET /api/enterprise/analytics-export.ndjson` | NDJSON 导出 behaviors；**非自动同步至云仓**（BigQuery 等须外部管线） |
| 20 | 第三方分析镜像 | ⚠️ 部分实现 | `web/src/analyticsBridge.js`、`analytics_mirror_dlq` | gtag 可选 + DLQ；**未内置 GA4/Amplitude SDK** |
| 21 | MMP / 归因对接 | 🔌 外部依赖 | `channelAttribution.js`（预留参数） | AppsFlyer/Adjust 须账号与 SDK |
| 22 | Remote Config | ✅ 已实现 | `GET /api/enterprise/remote-config`、`remoteConfig.js`、`shared/remote_config.default.json`、`OPENBLOCK_REMOTE_CONFIG_JSON` | |
| 23 | 活动配置 DSL + 时间窗 | ⚠️ 部分实现 | `live_ops_entries`、`GET/POST /api/enterprise/live-ops` | JSON + 时间窗；**无校验 schema、无 CMS UI** |
| 24 | 赛季/通行证配置外置 | ⛔ 未实现 | `web/src/monetization/seasonPass.js` 等 | 逻辑在前端；未读远程配置驱动通行证轨道 |
| 25 | 每日任务模板库 | ⛔ 未实现 | `web/src/monetization/dailyTasks.js` | 硬编码/模块内规则；无服务端模板表 |
| 26 | 限时活动类型扩充 | 📋 仅文档 | `live_ops_entries.payload_json` | 依赖自定义 payload；无预制玩法类型代码 |
| 27 | 运营日历视图 | ⛔ 未实现 | — | 无日历 UI；可查 DB 或外部 BI |
| 28 | 分地区/分桶活动 | ⚠️ 部分实现 | `live_ops_entries.tz`、`abTest.js` | 字段/分桶具备；**无「地区→活动」路由逻辑** |
| 29 | 实验配置服务端存储 | ✅ 已实现 | `experiment_configs`、`GET/POST /api/enterprise/experiments` | POST 需 `X-Ops-Token`（若配置） |
| 30 | 实验生命周期 | ⚠️ 部分实现 | `experiment_configs.status`、`starts_at`、`ends_at` | **无状态机/审批 API** |
| 31 | 护栏指标 | ⚠️ 部分实现 | `guardrail_json` 列 | **存储占位**；无自动告警或暂停实验任务 |
| 32 | 统计报表 uplift | ⛔ 未实现 | `GET /api/ab/results` | 聚合计数；**无置信区间/uplift 计算** |
| 33 | 实验与 Feature Flag 合并策略 | 📋 仅文档 | `web/src/abTest.js` vs `experiment_configs` | 双轨并存；需团队约定 |
| 34 | 埋点质量监控 | ⛔ 未实现 | — | 无丢失率/延迟告警 |
| 35 | Deep Link | 🔌 外部依赖 | — | 依赖域名、Universal Links、宿主 App |
| 36 | Creative 维度报表 | ⚠️ 部分实现 | `attribution.utm_content` | 数据可进会话；**无创意维度聚合 UI/API** |
| 37 | Cohort LTV | ⛔ 未实现 | `backend/monetization_backend.py`、画像 API | 无「cohort × 流水」专用接口 |
| 38 | CI 流水线 | ✅ 已实现 | `.github/workflows/ci.yml` | lint / test / build / Python import |
| 39 | 分环境配置 | ⚠️ 部分实现 | `.env`、`OPENBLOCK_*` | 依赖部署实践；**无 env 模板清单文档集中维护**（分散在各集成文档） |
| 40 | 制品与版本号 | ⚠️ 部分实现 | `package.json` · `version` | **无发布 changelog 门禁或与 Git tag 联动脚本** |
| 41 | 灰度发布 | 📋 仅文档 | Remote Config、实验桶 | 无网关级百分比放量组件 |
| 42 | DB 备份 Runbook | 📋 仅文档 | `docs/operations/DEPLOYMENT.md §8` | 无自动备份脚本 |
| 43 | 水平扩展预案 | 📋 仅文档 | `SQLITE_SCHEMA.md`、架构文档 | 迁移方案未脚本化 |
| 44 | 速率限制 | ⚠️ 部分实现 | `OPENBLOCK_RATE_LIMIT_PER_MIN`、`backend/enterprise_extensions.py` | **进程内存计数**；多实例**不共享** |
| 45 | 隐私同意横幅 | ⛔ 未实现 | `POST /api/compliance/consent` | API 有；**无 UI 横幅/CMP** |
| 46 | 导出/删除用户数据 | ⚠️ 部分实现 | `GET /api/compliance/export-user`、`POST /api/compliance/delete-user` | 需 Ops Token；**删除范围未覆盖 achievements/move_sequences 等全部表**（见实现代码） |
| 47 | 未成年人策略 | 📋 仅文档 | `DEPLOYMENT.md §8` | 无年龄门/限额代码 |
| 48 | 服务端权威分数 | ⛔ 未实现 | `POST /api/score`、`leaderboard` | 仍以客户端上报为主；无回放重算分数 |
| 49 | 行为上报鉴权 | ⛔ 未实现 | `POST /api/behavior` | 无默认 Token/签名校验 |
| 50 | 日志脱敏 | 📋 仅文档 | `DEPLOYMENT.md §8` | 应用日志未统一掩码中间件 |
| 51 | 策略版本注册表 | ✅ 已实现 | `shared/strategy_registry.json`、`GET /api/enterprise/strategy-registry`、`OPENBLOCK_ACTIVE_STRATEGY_VERSION` | 标注用；**不自动切换 RL 权重文件** |
| 52 | 影子流量 | ⛔ 未实现 | — | 无镜像流量或双写对比 |
| 53 | 一键回滚 | 📋 仅文档 | `DEPLOYMENT.md §8` | 无自动化回滚按钮/脚本 |
| 54 | RL 离线评估门禁 | ✅ 已实现 | `npm run rl:eval`、`docs/engineering/TESTING.md` | **非 CI 强制门禁**（workflow 未默认执行 rl:eval） |
| 55 | 训练记录与复现 | ⚠️ 部分实现 | `RL_*` 文档、`training.jsonl`（若启用） | 依赖环境与 env；无中心化实验 registry |
| 56 | 共享规则包 | ⚠️ 部分实现 | `shared/game_rules.json`、`docs/platform/SYNC_CONTRACT.md` | Web 权威源；**小程序未 CI 校验 hash 同步** |
| 57 | 埋点契约统一 | ⚠️ 部分实现 | `REFERENCE.md`（§一）、`SYNC_CONTRACT.md` | 契约文档；**小程序/多端自动化对齐测试缺失** |
| 58 | 小程序商业化对齐 | 📋 仅文档 | `miniprogram/`、`SYNC_CONTRACT.md` | 双端代码并行；未统一 SDK 封装 |
| 59 | 小程序合规清单 | 📋 仅文档 | `docs/platform/WECHAT_MINIPROGRAM.md（微信小程序发布流程）` | 非可执行代码 |
| 60 | 文档与代码对齐 | ⚠️ 部分实现 | 本文档、`COMMERCIAL_OPERATIONS.md` | 持续维护项；以 `backend/enterprise_extensions.py` 与 `server.py` 为准 |
| 61 | 运营 SOP | 📋 仅文档 | `DEPLOYMENT.md §8` | 流程文本；无工单系统集成 |

---

### 🔌 外部依赖汇总

**项号**：1、2、3、5、6、7、21、35

涉及广告平台 / 支付牌照 / MMP / 域名与宿主 App 等，必须由企业与服务商签约后在本仓库接口上接线。

---

### ⛔ 规划中能力

**项号**：9、10、24、25、27、32、34、37、45、48、49、52

若需闭环，须新增路由、任务、UI 或算法（例如 Webhook 对账、服务端确权分数、CMP UI、实验 uplift 统计等）。

---

### 相关入口

- API：`docs/integrations/ENTERPRISE_EXTENSIONS.md`  
- 广告/IAP：`docs/integrations/ADS_IAP_SETUP.md`  
- 数据库：`docs/engineering/SQLITE_SCHEMA.md`、`enterprise_extensions.migrate_enterprise_schema`  
- 事件字典：`docs/engineering/REFERENCE.md`（§一）
