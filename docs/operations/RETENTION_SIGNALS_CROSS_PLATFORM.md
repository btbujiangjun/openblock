# 留存信号跨平台分析与策略优化

> **定位**：基于 iOS × Android 双平台的留存相关性数据（Pearson r × 区分度），
> 识别"哪些行为信号真正预测留存"、"两平台之间的结构差异"，并把结论转化为可落地的
> OpenBlock 出块 / 商业化 / 复活策略优化项。
>
> **适用角色**：产品 / 主策划 / 商业化算法 / 运营 / 客户端工程师
>
> **代码入口**：
> - `web/src/bot/blockSpawn.js`（`MONO_FLUSH_PICK_PROBABILITY` / `_tryInjectSpecial`）
> - `web/src/adaptiveSpawn.js`（`spawnHints.multiClearBonus`）
> - `web/src/revive.js`（复活漏斗）
> - `web/src/monetization/strategy/strategyConfig.js`（广告 trigger 权重）
> - `web/src/derivation/intentResolver.js`（intent 优先级矩阵）
>
> **配套阅读**：
> - [生命周期与成熟度蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) — S0–S4 × M0–M4 分群基础
> - [最佳分追逐策略](../player/BEST_SCORE_CHASE_STRATEGY.md) §5.α — PB 后救济（同局保护）
> - [自适应出块 §10.7](../algorithms/ADAPTIVE_SPAWN.md#107-形状池扩展v1600--v16044独立库事件注入系统) — v1.60.44 三类触发分级

---

## 0. TL;DR

| 维度 | iOS | Android |
|---|---|---|
| 强信号数量 (\|r(D7)\| ≥ 0.15) | **2 项**（广告完播 0.349、广告播放 0.256） | **6 项**（高分 0.276、广告完播 0.253、高Combo 0.207、多消 0.205、时长 0.181、复活触发 0.173） |
| 留存抓手 | 广告漏斗 + 复合评分（PRS） | 爽感时刻 + 复活漏斗 + 高分频次 |
| 用户群假设 | 同质化（行为分布窄，单指标解释力弱） | 多元化（行为分布宽，单指标即可分化） |
| 共性问题 | "突破最高分" 全平台负相关（iOS −0.126、Android −0.094） | 同左 |

**核心结论**：iOS 与 Android 留存信号**结构完全不同**——同一套出块 / 商业化 / 复活策略不能两平台通吃，需要平台化分发。OpenBlock 现有 `adaptiveSpawn` + `intentResolver` + `strategyConfig` 三套配置已具备平台化条件，只需在入口处加平台判断即可承接。

---

## 1. 数据基础

### 1.1 双平台 D7 留存相关性矩阵

> **采样**：D1 / D3 / D7 / D15 留存 × 16 项行为指标 × iOS / Android 双平台；
> Pearson r ∈ [−1, 1] 度量线性关联，区分度（UV 加权离散度 75% + 头尾桶留存差 25%，归一化 0~100%）度量"留存好/差人群的分布差异"。
>
> **阈值约定**（休闲游戏数据集相对标定，非统计显著性判断）：
> - 强信号：\|r\| ≥ 0.2；中等：\|r\| ≥ 0.1；弱：\|r\| ≥ 0.05；噪声：\|r\| < 0.05
> - 强区分：≥ 60%；中等：30~60%；弱：< 30%

#### 1.1.1 全量指标对照（D7）

| 桶 | 指标 | iOS r(D7) | iOS 区分(D7) | Android r(D7) | Android 区分(D7) | Δr (Android−iOS) |
|---|---|---:|---:|---:|---:|---:|
| 广告 | **广告完播次数** | **+0.349** | 31% | +0.253 | 19% | −0.096 |
| 广告 | 广告播放次数 | +0.256 | 40% | +0.148 | 19% | −0.108 |
| 分数 | **达到高分次数** | +0.172 | 41% | **+0.276** | 21% | **+0.104** |
| 时刻 | 达到高Combo次数 | +0.134 | 43% | **+0.207** | 32% | **+0.073** |
| 时刻 | 多消次数 | +0.089 | 34% | **+0.205** | 29% | **+0.116** |
| 时刻 | 高消次数 | +0.085 | 37% | +0.138 | 29% | +0.053 |
| 时长 | 游戏时长 | +0.107 | 32% | +0.181 | 27% | +0.074 |
| 复活 | **触发复活次数** | 0.000 | 39% | **+0.173** | 20% | **+0.173** |
| 复活 | 点击复活次数 | +0.061 | 17% | +0.088 | 11% | +0.027 |
| 复活 | 复活成功次数 | 0.000 | 15% | 0.000 | 10% | 0.000 |
| 时刻 | 进入Combo次数 | +0.066 | 8% | +0.100 | 6% | +0.034 |
| 时刻 | Combo中断次数 | +0.054 | 7% | +0.095 | 5% | +0.041 |
| 基线 | 消除次数 | +0.066 | 8% | +0.108 | 6% | +0.042 |
| 技巧 | 清屏次数 | +0.095 | 6% | +0.119 | 5% | +0.024 |
| 技巧 | 解决难题次数 | +0.088 | 5% | +0.080 | 4% | −0.008 |
| 分数 | **突破最高分次数** | **−0.126** | 29% | **−0.094** | 22% | +0.032 |

> 加粗 = 关键观察点（强信号、显著负信号、或跨平台 Δr 极大）

#### 1.1.2 时间窗口衰减（D1 → D15，仅强信号）

| 指标 | 平台 | r(D1) | r(D15) | 衰减率 |
|---|---|---:|---:|---:|
| 广告完播 | iOS | +0.400 | +0.310 | −22.5% |
| 广告完播 | Android | +0.392 | +0.216 | **−44.9%**（衰减最快） |
| 达到高分 | iOS | +0.158 | +0.170 | +7.6%（反向增强） |
| 达到高分 | Android | +0.239 | +0.265 | +10.9% |
| 突破最高分 | iOS | −0.096 | −0.128 | 负相关加深 |
| 突破最高分 | Android | −0.046 | −0.096 | 负相关加深 |

**两点关键解读**：
1. **广告完播 Android 短期强、长期衰减快**——D1 时与 iOS 几乎持平，D15 时衰减接近一半，意味着 Android 不应重度依赖广告维系长期留存
2. **突破最高分**在两个平台都是 r 随时间窗拉长**更加负**——这是 PB 后流失加剧的强证据，PB 跨局保护是全平台 P0

---

## 2. 跨平台 6 个关键发现

### 2.1 触发复活：iOS 非线性 vs Android 强线性正（差异最大）

| 平台 | r(D7) | 区分度(D7) | 解读 |
|---|---:|---:|---|
| iOS | 0.000 | 39% | 典型 U 型非线性（高区分 + 零相关），分布两极化 |
| Android | **+0.173** | 20% | 单调正相关：复活越多越留存 |

**Δr = +0.173 是全表最大跨平台差异**。意味着：
- **iOS**：复活机制存在 U 型拐点（推测：极少复活 = 硬核短局，多次复活 = 休闲被卡死，**中段触发频次最差**）。需要分桶研究定位拐点，盲目放宽复活反而可能劣化留存
- **Android**：复活是**直接的留存抓手**，应主动拉高触发机会（条件放宽、点位增加、广告复活点优化）

### 2.2 爽感时刻：Android r 全面碾压 iOS

| 指标 | iOS r(D7) | Android r(D7) | 倍数 |
|---|---:|---:|---:|
| 多消次数 | 0.089 | **0.205** | **×2.3** |
| 达到高Combo | 0.134 | 0.207 | ×1.5 |
| 高消次数 | 0.085 | 0.138 | ×1.6 |

Android 上"爽感时刻"是 `adaptiveSpawn` 引擎的**最强发力点**。建议按平台分发参数（详见 §4.2）。

### 2.3 广告价值：iOS 完播为王 vs Android 完播衰减快

- **iOS**：广告完播 D1=0.400 → D15=0.310，**长效信号**
- **Android**：广告完播 D1=0.392 → D15=**0.216**，**短期为王长期失效**
- **iOS 广告播放** r=0.256（D7）vs **Android 广告播放** r=0.148——iOS 广告渗透有效率显著更高

**运营含义**：
- iOS：广告完播应**升为核心 KPI 之一**，按完播率分层运营
- Android：广告价值**主要是收益指标**，不应作为留存抓手（弱关联且衰减快）；留存重心应转向爽感 + 复活

### 2.4 突破最高分负相关（全平台 P0 共性）

| 平台 | r(D7) | r(D15) | 区分度(D7) |
|---|---:|---:|---:|
| iOS | −0.126 | −0.128 | 29% |
| Android | −0.094 | −0.096 | 22% |

两个平台都**显著负相关**，且随时间窗拉长**进一步加深**。这与"达到高分次数"强正相关形成鲜明对比——同样是分数事件，"达到较高分数"是爽感，"突破历史最好"触发"成就完结感"。

OpenBlock 现状：
- v1.56 [`bestScoreBuckets`](../../web/src/bestScoreBuckets.js) + v1.60.37 末段强救济 = **同局保护**已落地
- **跨局保护是新空白**——PB 后 1~15 天才是真正的流失高峰

### 2.5 信号集中度：iOS 稀疏 vs Android 分散

- iOS 强信号仅 2 项（且都在广告漏斗）→ **必须构建复合评分** PRS 才能拉开人群
- Android 强信号 6 项（分散在爽感、分数、复活、时长）→ **单指标即可独立驱动运营**

### 2.6 达到高分双面性：r 与区分度反差

| 平台 | r(D7) | 区分度(D7) | 运营模型 |
|---|---:|---:|---|
| iOS | 0.172 | 41% | **稀缺爽感模型**——少数玩家达成即拉大留存差 |
| Android | **0.276** | 21% | **频次激励模型**——多数玩家可达，越多越好 |

→ 推论：Android 适合"每日 3 次高分挑战"日常任务系统；iOS 应保持稀缺爽感本性，不引入频次稀释。

---

## 3. 与 OpenBlock 现有架构的衔接分析

| 数据洞察 | 现有机制（v1.60.44 基线） | 差距 / 行动 |
|---|---|---|
| PB 后跨平台都流失加剧 | v1.56 `bestScoreBuckets` 分桶 + v1.60.37 末段强救济（**同局**保护） | ❌ 缺**跨局保护**：PB 触发 → 下一局起强推次级目标 + 3 日内 push 召回 |
| Android 爽感时刻 r 远高 iOS | `MONO_FLUSH_PICK_PROBABILITY=0.033` 全局常量；`multiClearBonus` 不按平台分发 | ⚠️ 需平台化调参档：Android 提至 0.05、`multiClearBonus +30%` |
| iOS 广告完播 = 最强信号 | `monetization/strategy/strategyConfig.js` 已有 skin/coins/revive 三类 trigger | ⚠️ 缺**按完播率分层** + **按 platform 分发权重** |
| Android 复活线性正、iOS 非线性 | `revive.js` 装饰 `_handleNoMoves`；`REVIVE_LIMIT=1`、`REVIVE_CLEAR_CELLS=12` 全平台同参 | ⚠️ Android：放宽 limit 至 2、增加点位；iOS：先做分桶研究，**不动**避免误劣化 |
| 爽感时刻强区分（共性） | `intentResolver` 已有 relief/harvest/payoff 引擎 | ⚠️ 缺**个体爽感监控闭环**：`playerProfile.roundsSinceLastDelight` 字段未实现 |
| iOS 单指标 r 上限低（0.349） | `playerProfile.skillLevel / momentum / frustration` 三轴（建模能力，非留存预测） | ⚠️ 缺**复合留存评分 PRS**（与 skillLevel 正交，预测留存） |
| 基础指标区分度个位数 | 打点 schema 记录绝对次数 | ⚠️ 应改造为**个人化比率 / 单位时长密度** |
| Android 达到高分 r 强但区分弱 | 无频次激励任务系统 | ⚠️ Android 新增每日 3 次高分挑战 task |

---

## 4. 优化方案（按平台 × 按优先级）

### 4.1 P0 共性 A — PB 后跨局留存保护链

**问题**：v1.56 + v1.60.37 仅覆盖**同局内**的崩盘窗口；数据揭示真正风险在 PB 后 3-15 天，且两平台共性。

**落地**：

1. **下一局起强推次级目标**
   - PB 突破事件触发后，下一局开始时 UI 切到"挑战 110% PB" / "周PB" / "完美清屏 PB" / "主题 PB" 等次级目标卡片
   - 让"达到高分次数"（r 强正）持续触发，稀释"绝对 PB"（r 强负）的终结感
   - 代码位：扩展 `web/src/bestScoreBuckets.js` 增加 `nextChallenge()` API；UI 接入 `bestStrategyBadge`

2. **PB 后 1d / 3d push 召回**
   - 条件式触发：D2–D7 内未活跃 → 文案"你的 PB 已被 N% 玩家追上"
   - 代码位：新增 `web/src/retention/pbWinbackPlaybook.js`，订阅 `lifecycle:pb-broken` 事件

3. **PB 庆祝动效从"成就感"降级为"序章感"**
   - 当前 v1.60.37 升级徽章金色胶囊偏向"完成感"——改为"已解锁下一段位的入场券"叙事
   - 代码位：`web/src/game.js::_showPbCelebration` 与 i18n 文案

**验证指标**：PB 触发后 D3 / D7 留存差（实验组 vs 对照组），目标提升 ≥ 1.5 pp（iOS）/ 1.0 pp（Android）

---

### 4.2 P0 Android — 爽感时刻引擎平台化调参

**问题**：Android 多消 / 高Combo / 高消 r 平均比 iOS 高 1.5–2.3 倍，是 `adaptiveSpawn` 主战场，但当前全平台同参数。

**落地**：

1. **新增 platform-aware 配置**（关键基础设施）
   - 新建 `web/src/config/platformProfile.js`，导出 `getPlatformProfile(): { id: 'ios' | 'android' | 'web' | 'wechat' }`
   - 浏览器侧通过 `navigator.userAgent` + Capacitor `Device.getInfo()` 双源判定
   - 小程序侧硬编码 `'wechat'`（与 Android 同档）

2. **MONO_FLUSH_PICK_PROBABILITY 平台化**
   - 现 `web/src/bot/blockSpawn.js:145` 硬编码 `0.033`
   - 改为：`{ ios: 0.033, android: 0.050, wechat: 0.050, web: 0.040 }`
   - 同 cap 也按平台抬高：Android 上限 0.15 / iOS 上限 0.10

3. **multiClearBonus 平台化**
   - `web/src/adaptiveSpawn.js:1719` `let multiClearBonus = Math.max(deriveMultiClearBonus(ctx, _boardFill), delight.multiClearBoost)`
   - Android 默认底 +0.15（即 `multiClearBonus = Math.max(基础值, 0.15)`）
   - iOS 保持现状

4. **roundsSinceLastDelight 阈值平台化**（与 §4.5 配合）
   - Android: 5 局未触爽感 → 强制 `forceReliefIntent = true`
   - iOS: 7 局阈值（与现有 `roundsSinceClear >= 2/4` 阈值同序）

**配套**：在 `tests/blockSpawn.test.js` 增加 platform-aware 测试，确保 Android 档 monoFlush 命中率 ≥ 7%（iOS 档 ≥ 3%）。

**验证指标**：Android 包"爽感覆盖率"（7 日内触发任一 multiClear ≥ 2 / pcClear / comboHigh 的 DAU 占比）目标 ≥ 80%（基线待打点回流）

---

### 4.3 P0 Android — 复活漏斗扩张

**问题**：Android 触发复活 r=0.173（单调正相关），但当前 `REVIVE_LIMIT=1` + 仅"无可放置时"一个点位，远未覆盖该信号的留存价值。

**落地**：

1. **`REVIVE_LIMIT` Android 提至 2**
   - 代码位：`web/src/revive.js:31`；按 platform 分发
   - 风险：广告价值稀释——Android 广告完播 r 衰减快，单条广告减少不会显著影响留存

2. **新增复活点位**（Android only，先行）
   - 当前仅"无可放置时"触发；新增：
     - **PB 进度即将丢失时**（已达 90% 个人 PB 但即将死局）
     - **首次连续 3 局死局时**（玩家可能在学习新机制）
   - 代码位：`web/src/game.js::_handleNoMoves` 扩展触发条件链

3. **复活后强制 force relief + clearGuarantee=3**
   - 当前复活只是清空 12 格，下一局仍走原 spawn 路径
   - 新版：复活成功 → 下一局 `ctx.forceReliefIntent = true` + `spawnHints.clearGuarantee = 3`，避免"复活后立刻再死"
   - 代码位：`web/src/revive.js::reviveByAd` 触发后写入 `game._postReviveBoost` 标记，spawn 入口消费

4. **iOS 暂不动**（避免反向劣化）
   - 数据显示 iOS 复活非线性（U 型），盲目放宽可能落到拐点反向区
   - 先行动作：增加分桶打点（按"触发复活次数 0/1/2-3/4-7/8+"五桶），上线后 4 周回收数据再调

**验证指标**：Android 复活成功后 D1 留存（vs 未复活同水位玩家）提升 ≥ 3 pp；广告完播率不显著下降（≥ 95% 置信）

---

### 4.4 P1 iOS — 广告完播率北极星化

**问题**：iOS 广告完播 r=0.349 是数据集最强单一信号，但当前未将其升为核心 KPI。

**落地**：

1. **完播率 → iOS 平台核心 KPI**
   - 与 D7 留存并列，写入 [生命周期蓝图 §0 北极星护栏](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md#0-北极星与护栏)
   - 新增运营看板字段 `adCompletionRateD7`

2. **按完播率分层运营**（iOS only）
   - 高完播玩家（≥ 80%）→ 更多 IAA 暴露 + 更长视频
   - 低完播玩家（< 30%）→ 减少打扰，转向 IAP 软营销
   - 代码位：`web/src/monetization/strategy/strategyConfig.js` 按 platform + completionRateTier 双轴分发权重

3. **奖励梯度优化**
   - 完播 vs 中断的奖励差距从当前固定值拉到 1.5–2x
   - 代码位：`web/src/monetization/adapters/adAdapter.js` reward callback 引入 `completionBonus` 系数

**Android 不引入**：广告完播 r 长期衰减至 0.216，分层投入边际收益低。

---

### 4.5 P1 共性 — 爽感监控闭环（roundsSinceLastDelight）

**问题**：`adaptiveSpawn` 输出 multiClear / comboHigh 等候选，但对玩家个体"N 局内是否真触爽"无闭环监控。

**落地**：

1. **playerProfile 新增字段**
   - `roundsSinceLastDelight: number`（每次发生 multiClear≥2 / pcClear / comboHigh / monoFlush 命中时清零，每轮 +1）
   - 代码位：`web/src/playerProfile.js`；事件 hook 接入 `game.js::onClearEvent`

2. **阈值触发强 relief intent**
   - 超过阈值（Android 5 局 / iOS 7 局）→ `intentResolver.forceReliefIntent = true`
   - 代码位：`web/src/derivation/intentResolver.js` 新增 `delightStarvation` 规则（priority 95，介于 relief 100 与 engage 90 之间）

3. **打点 + 看板**
   - 新增"爽感覆盖率"指标：7 日内触发过任一爽感时刻的 DAU 占比，目标 ≥ 75%
   - 加入 `/api/ops/dashboard` 输出

---

### 4.6 P1 iOS — 复合留存评分 PRS

**问题**：iOS 单指标 r 上限 0.349（广告完播），远不足以可靠预测留存。行业经验 5-8 指标融合后 r 可达 0.55-0.65。

**落地**：

1. **PRS 公式（iOS 专用）**

   ```
   PRS_iOS = 0.50 × normalize(adCompletes, 7d)
           + 0.25 × normalize(highScoreReaches, 7d)
           + 0.15 × normalize(comboHighReaches, 7d)
           + 0.10 × normalize(sessionMinutes, 7d)
           − 0.10 × normalize(pbBreaks, 7d)
   ```
   - 系数从 r 比例映射；负权重直接处理 PB 突破的反向信号
   - normalize 用 D7 内的累计值除以人群 P90 分位数（封顶 1.0）

2. **存储与消费**
   - 写入 `playerProfile.prsScore`（与 `skillLevel` / `momentum` 正交，预测**留存**而非**能力**）
   - 用作：个性化召回 push 触发、IAP 礼包推荐分层、ad trigger 权重调整

3. **Android 暂不实施**
   - 6 个强信号已足够单独驱动运营，PRS 边际价值较小；先观察 §4.2/§4.3 落地后效果

---

### 4.7 P1 Android — 高分频次激励（每日挑战任务）

**问题**：Android 达到高分 r=0.276 强正、区分度 21% 弱——"多数玩家可达，越多越好"的典型频次激励特征。

**落地**：

- 每日"3 次高分达成"任务系统
- "高分阈值" = 玩家历史 P50 分位数（个人化，避免新手过高门槛）
- 完成奖励：金币 / 皮肤试用 / 复活机会（与 §4.3 联动）
- 代码位：新建 `web/src/retention/dailyChallengePlaybook.js`；订阅 `lifecycle:high-score-reached` 事件

**iOS 不引入**：稀缺爽感模型不应被频次任务稀释。

---

### 4.8 P2 共性 — 基础指标改造（个人化比率）

5 项个位数区分度指标（消除次数 / 清屏 / 解决难题 / 进入Combo / Combo中断）当前几乎不带信息。改造方向：

- **消除/清屏/解决难题次数** → "占个人历史中位数比例"（个人化）
- **Combo 中断** → "中断时高度"（中断 7→0 vs 0→1 完全不同质）
- **时长** → "单位时长内的关键动作密度"

预期效果：5 项指标区分度提升至 15-25%；为 §4.6 PRS 融合提供更多有效维度。

代码位：`web/src/analytics/playerEvents.js` schema 扩展，向后兼容（旧字段保留，新增 `*Ratio` / `*Density` 派生字段）

---

## 5. 整合实施路线图

| # | 项目 | 平台 | 优先级 | 依赖 | 工作量估计 |
|---|---|---|---|---|---|
| **A** | PB 后跨局保护链 | 共性 | **P0** | `bestScoreBuckets` 扩展 | 1.5 周 |
| **B** | 平台化 platformProfile + monoFlush/multiClearBonus 分发 | Android | **P0** | 新建 platform 配置 | 1 周 |
| **C** | Android 复活漏斗扩张 + 复活后强 relief | Android | **P0** | `revive.js` + `_handleNoMoves` 扩展 | 1.5 周 |
| **D** | iOS 广告完播率北极星化 + 分层运营 | iOS | P1 | `strategyConfig` 双轴扩展 | 1 周 |
| **E** | 爽感监控闭环 (roundsSinceLastDelight) | 共性 | P1 | `playerProfile` + `intentResolver` | 1 周 |
| **F** | iOS PRS 复合留存评分 | iOS | P1 | 打点回流 + 模型上线 | 2 周 |
| **G** | Android 每日 3 次高分挑战 task | Android | P1 | 新建 `dailyChallengePlaybook` | 1 周 |
| **H** | 基础指标改造（个人化比率） | 共性 | P2 | 打点 schema 扩展 | 1.5 周 |

**建议节奏**：
- **第 1 周**：B（基础设施 platformProfile）+ A（PB 跨局保护设计稿）
- **第 2-3 周**：A 实施 + C 实施
- **第 4-5 周**：D + E（共性闭环）
- **第 6-8 周**：F + G + H

---

## 6. 验证方法与护栏

### 6.1 A/B 实验通用框架

任何平台化分发的变更**必须 50/50 A/B**验证因果方向，避免反向因果误导（详见 §7.1）。最小实验周期 14 天（覆盖 D7 完整窗口 + 1 周回报）。

### 6.2 各项目核心指标 + 护栏指标

| 项目 | 核心指标 | 主护栏 | 次护栏 |
|---|---|---|---|
| A. PB 跨局保护 | PB 后 D3 / D7 留存差 | D1 留存不下滑 | PB 总数不显著下降 |
| B. Android 爽感调参 | Android D7 留存 + 爽感覆盖率 | iOS 留存不受影响（实验隔离） | 单局时长不下降 |
| C. Android 复活扩张 | Android D1 / D7 留存 | 广告完播率不下降 ≥ 95% 置信 | 单局时长上升 < 30% |
| D. iOS 广告分层 | iOS 广告 ARPDAU + D7 留存 | IAP 转化率不下滑 | 用户投诉率不上升 |
| E. 爽感监控闭环 | 爽感覆盖率 D7 | 出块算法 K 复杂度不上升 | 实验组性能指标不下降 |
| F. iOS PRS | PRS 与 D14 留存 r ≥ 0.50 | 召回 push 退订率 < 5% | — |
| G. Android 每日挑战 | 任务完成率 + D7 留存 | 单局动机不被任务挤压（任务完成率 ≥ 60%） | — |
| H. 指标改造 | 5 项指标新区分度 ≥ 15% | 打点埋点错误率 < 0.1% | — |

### 6.3 反向因果防护

广告完播 r=0.4 **可能是反向因果**（留存好→玩得多→广告多）。在 D（iOS 广告分层）实施前必须做工具变量分析：
- 用"广告 SDK 重载延迟"等外生变量做 IV 估计真实因果效应
- 若 IV 估计与 OLS 显著不同，调整公式系数

---

## 7. 已知边界与风险

### 7.1 r ≠ 因果

所有 r 值都是相关而非因果。两个最危险的反向因果场景：
- **广告完播 → 留存**：可能是"留存好的玩家广告多"
- **触发复活 → 留存（Android）**：可能是"留存好的玩家玩得久、自然死局次数多"

→ 实施前用 IV / Difference-in-Differences 验证。

### 7.2 平台差异 ≠ 用户差异

Android r 普遍更高是因为用户群多元（行为分布宽），不代表 Android 用户更"在意"游戏体验。iOS 用户更同质化（IDFA 限制 + 设备一致性 + 苹果用户偏好趋同）→ 单指标解释力弱。**这是统计特性而非偏好特性**，不应据此判断"iOS 用户体验更好"。

### 7.3 幸存者偏差

D15 留存样本只剩 D1 的一小撮，r 衰减不一定是信号变弱，可能是高 r 人群已全部留存（饱和）。在 PRS 模型训练时应分桶建模而非全样本回归。

### 7.4 Android 内部细分待补

Android 设备 / 系统 / 网络 / 地域差异巨大，本数据是平均值。**下一步**建议拆 Android：
- 中高端机 vs 低端机
- 印度 / 巴西 / 中文区 vs 欧美
- Android 12+ vs 旧版本

可能发现 Android 内部异质性 > iOS 与 Android 间差异。

### 7.5 阈值是相对的

\|r\| > 0.1 才算信号在游戏行为数据中是**相对宽松**的阈值——统计教材 > 0.3 才算中等。本文阈值用于"在 16 维指标中识别信号强者"的相对排序，不构成统计显著性判断。

---

## 8. 与现有文档关系

| 关联文档 | 关系 |
|---|---|
| [生命周期与成熟度蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | 提供 S0–S4 × M0–M4 分群基础；本文提供"按平台二级切片"的补充 |
| [商业化系统全景](./MONETIZATION.md) | 本文 §4.4 iOS 广告分层是其下层落地 |
| [最佳分追逐策略 §5.α](../player/BEST_SCORE_CHASE_STRATEGY.md) | 本文 §4.1 PB 跨局保护是 §5.α "末段救济"的跨局延续 |
| [自适应出块 §10.7](../algorithms/ADAPTIVE_SPAWN.md#107-形状池扩展v1600--v16044独立库事件注入系统) | 本文 §4.2 平台化调参是 v1.60.44 三类触发分级的平台化扩展 |
| [运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md) | 本文 §4.4 / §4.5 新增 KPI 需在此口径化 |

---

## 9. 数据来源与版本

- **数据采样**：iOS / Android 双平台用户行为打点（具体平台与时间窗口未在原始报表中标注）
- **分析方法**：Pearson r（线性相关性） × 区分度（UV 加权离散度 75% + 头尾桶留存差 25%）
- **文档版本**：v1.0（2026-05），基于截图复刻；后续真实打点回流后应做版本迭代
- **代码基准**：v1.60.44（adaptiveSpawn 三类触发分级、`_tryInjectSpecial` 阶段绑定）

---

**反馈与迭代**：本文为留存策略的可行性分析与落地路线图，实施过程中如发现数据与现有架构无法对齐、或 A/B 结果与预期相反，应回流至本文并标记"已验证不成立"，避免成为长期失效文档。


---

## 留存优化快赢清单

> **定位**：[留存信号跨平台分析](./RETENTION_SIGNALS_CROSS_PLATFORM.md) 是策略层；本文是**工程落地层**——精确到要改哪个文件、哪个函数、哪一行，改动前后什么样、配套测试怎么写、上线护栏指标是什么。
>
> **使用方式**：按 § 序号领取任务；每个 § 是一个独立 PR，可平行实施。
>
> **代码基准**：��提交 `7c5913d`）
>
> **实施状态**：✅ §1–§10 已全部完成，2129 个回归测试通过）。本文保留作为
> 设计依据 + 验证清单——线上数据回流后按 §6 验证方法回写 A/B 结果。

---

### 优化点速查表

| # | 标题 | 平台 | 工作量 | 文件 | 难度 | 阻塞依赖 |
|---|---|---|---|---|---|---|
| **§1** | platformProfile 基础设施 | 共性 | 0.5d | 新建 1 文件 | ★☆☆ | 无（其余 §2–§4 依赖） |
| **§2** | `MONO_FLUSH_PICK_PROBABILITY` 平台化 | Android | 0.5d | `blockSpawn.js` | ★☆☆ | §1 |
| **§3** | `multiClearBonus` Android 抬高 | Android | 0.5d | `adaptiveSpawn.js` | ★☆☆ | §1 |
| **§4** | `REVIVE_LIMIT` 平台化 | Android | 0.5d | `revive.js` | ★☆☆ | §1 |
| **§5** | `roundsSinceLastDelight` 追踪 + intent 规则 | 共性 | 1.5d | `playerProfile.js` + `intentResolver.js` + `game.js` | ★★☆ | 无 |
| **§6** | 复活后强 `forceReliefIntent` | 共性 | 0.5d | `revive.js` + `game.js` | ★☆☆ | §5（共用 forceReliefIntent 通路） |
| **§7** | PB 突破后次级目标 | 共性 | 1d | `bestScoreBuckets.js` + `game.js` | ★★☆ | 无 |
| **§8** | "爽感覆盖率" 看板指标 | 共性 | 1d | `server.py` + `opsDashboard.js` | ★★☆ | §5 |
| **§9** | iOS 广告分层（按完播率分桶） | iOS | 1d | `strategyConfig.js` | ★★☆ | §1 |
| **§10** | Android 每日 3 次高分挑战 | Android | 2d | 新建 `dailyChallengePlaybook.js` | ★★★ | §1 |

总工作量约 **9 人日**。强烈建议从 §1 → §2/§3/§4 串行（共享基础设施），其他可并行。

---

### §1. 基础设施：`platformProfile` 单源平台判定

**问题**：当前 `web/src/` 全局无平台判定函数，无法实现"按平台分发参数"。

**新建文件**：`web/src/config/platformProfile.js`

```javascript
/**
 * platformProfile.js — 单源平台判定（Web / iOS / Android / WeChat）。
 *
 * 设计原则：
 *   - 单源：所有需要按平台分发的配置（出块、复活、商业化）都从这里读
 *   - 静态：一次启动只判定一次，缓存为 module-level const，避免运行时反复查询
 *   - 渐进：浏览器侧用 navigator.userAgent；Capacitor 壳里覆盖为 'ios'/'android'；
 *           小程序侧引入时硬编码 'wechat'
 *
 * 取值：
 *   - 'ios'      — iOS WebView（Safari / Capacitor iOS）
 *   - 'android'  — Android WebView（Chrome / Capacitor Android）
 *   - 'wechat'   — 微信小程序（小程序入口注入）
 *   - 'web'      — 桌面浏览器 / 未识别
 */

let _cached = null;

function _detect() {
    if (typeof globalThis !== 'undefined' && globalThis.__OPENBLOCK_PLATFORM__) {
        // 小程序 / Capacitor 壳启动时显式注入
        return String(globalThis.__OPENBLOCK_PLATFORM__);
    }
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 'web';
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    return 'web';
}

/** 平台 id（'ios' | 'android' | 'wechat' | 'web'）。 */
export function getPlatform() {
    if (_cached === null) _cached = _detect();
    return _cached;
}

/** 仅供测试用：强制覆写平台缓存（生产代码勿用）。 */
export function _setPlatformForTest(p) { _cached = p; }

/**
 * 平台化配置查询：传入 { ios, android, wechat, web, default } map，
 * 返回当前平台对应值；未命中返回 default 或 undefined。
 *
 * @example
 *   const monoFlushRate = pickByPlatform({
 *       ios: 0.033, android: 0.050, wechat: 0.050, default: 0.033
 *   });
 */
export function pickByPlatform(map) {
    const p = getPlatform();
    if (map[p] !== undefined) return map[p];
    return map.default;
}
```

**测试**：新建 `tests/platformProfile.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { getPlatform, pickByPlatform, _setPlatformForTest } from '../web/src/config/platformProfile.js';

describe('platformProfile', () => {
    beforeEach(() => { _setPlatformForTest(null); });

    it('UA = iPhone → ios', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit' },
            configurable: true,
        });
        expect(getPlatform()).toBe('ios');
    });

    it('UA = Android → android', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit' },
            configurable: true,
        });
        expect(getPlatform()).toBe('android');
    });

    it('__OPENBLOCK_PLATFORM__ override 优先', () => {
        globalThis.__OPENBLOCK_PLATFORM__ = 'wechat';
        expect(getPlatform()).toBe('wechat');
        delete globalThis.__OPENBLOCK_PLATFORM__;
    });

    it('pickByPlatform 命中 + 回落 default', () => {
        _setPlatformForTest('android');
        expect(pickByPlatform({ ios: 'a', android: 'b', default: 'c' })).toBe('b');
        expect(pickByPlatform({ ios: 'a', default: 'c' })).toBe('c');
    });
});
```

**小程序壳同步**：`miniprogram/app.js` 启动前注入 `globalThis.__OPENBLOCK_PLATFORM__ = 'wechat'`。

**护栏**：`tests/platformProfile.test.js` 4/4 通过 + UA fallback 行为不变。

---

### §2. `MONO_FLUSH_PICK_PROBABILITY` 平台化（Android Combo 爽感加强）

**问题**：Android 多消 r=0.205 是 iOS（0.089）的 2.3 倍，但 monoFlush 概率全平台同档 0.033。

**改动文件**：`web/src/bot/blockSpawn.js`

**改动前**（line 145）：

```javascript
const MONO_FLUSH_PICK_PROBABILITY = 0.033;
```

**改动后**：

```javascript
import { pickByPlatform } from '../config/platformProfile.js';

/**
 * ��按平台分发 monoFlush 命中概率。
 *
 * 数据依据（docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2）：
 *   Android 爽感时刻 r 平均比 iOS 高 1.5-2.3 倍，monoFlush 作为视觉爽感
 *   彩蛋应在 Android 抬高，iOS 维持稀缺。
 */
const MONO_FLUSH_PICK_PROBABILITY = pickByPlatform({
    ios:     0.033,
    android: 0.050,  // +50%，与 r 倍数差异对齐
    wechat:  0.050,  // 与 Android 同档
    web:     0.040,  // 折中
    default: 0.033,
});
```

**配套测试更新**（`tests/blockSpawn.test.js`）：

- 新增分组 ` — MONO_FLUSH_PICK_PROBABILITY 平台化`
- 4 个测试：iOS / Android / WeChat / web 各跑 100 次 strong scenario，验证命中率落在 [基础值 ±2%] 区间
- 已有 monoFlush 命中率测试保持原阈值（默认走 web/iOS 档）

**护栏**：
- 全部既有 monoFlush 测试不动改前后差异（默认平台档 = 0.033，不变）
- 新增 Android 档命中率 ≥ 5% / 单 dock 1 块限制不被破坏

---

### §3. `multiClearBonus` Android 抬高

**问题**：multiClearBonus 全平台同公式，Android 上爽感时刻边际价值显著更高。

**改动文件**：`web/src/adaptiveSpawn.js`

**改动前**（line 1719-1722）：

```javascript
let multiClearBonus = Math.max(
    deriveMultiClearBonus(ctx, _boardFill ?? 0),
    delight.multiClearBoost
);
```

**改动后**：

```javascript
import { pickByPlatform } from '../config/platformProfile.js';

let multiClearBonus = Math.max(
    deriveMultiClearBonus(ctx, _boardFill ?? 0),
    delight.multiClearBoost
);
/* ��Android 多消 r=0.205（iOS 0.089）→ 抬高底值确保多消时刻可达。
 * 数据依据 docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2 / §4.2。
 * 仅抬底，不上限（避免无限叠加）。 */
const platformFloor = pickByPlatform({
    ios:     0,      // 维持现状
    android: 0.15,   // 抬底 → 即使其他信号为 0 也保证一定的多消鼓励
    wechat:  0.15,
    default: 0,
});
multiClearBonus = Math.max(multiClearBonus, platformFloor);
```

**护栏**：
- iOS 档：默认行为完全不变（测试不动）
- Android 档：multiClearBonus 最低值 ≥ 0.15；上限仍受现有 max 限制（约 0.50）
- 新增 1 个测试：Android 档下"中性意图 + 无 nearMiss"场景，multiClearBonus 应 ≥ 0.15

---

### §4. `REVIVE_LIMIT` Android 提至 2

**问题**：Android 触发复活 r=+0.173 单调正相关，但 `REVIVE_LIMIT=1` 全平台同档，浪费了线性留存抓手。

**改动文件**：`web/src/revive.js`

**改动前**（line 31-32）：

```javascript
const REVIVE_LIMIT_DEFAULT = 1;   // 每局最多复活次数
const REVIVE_CLEAR_CELLS   = 12;  // 复活时清除的格子数
```

**改动后**：

```javascript
import { pickByPlatform } from './config/platformProfile.js';

/* ��复活次数按平台分发。
 *
 * Android（r=+0.173 单调正相关）：放宽至 2，每局最多 2 次复活；
 * iOS（r≈0 非线性 U 型）：维持 1，避免反向劣化（数据：docs/operations/
 * RETENTION_SIGNALS_CROSS_PLATFORM.md §2.1 / §4.3）。 */
const REVIVE_LIMIT_DEFAULT = pickByPlatform({
    android: 2,
    wechat:  2,
    default: 1,   // iOS / web 维持现状
});
const REVIVE_CLEAR_CELLS   = 12;
```

**风险与护栏**：
- 风险 1：广告价值稀释 → 监控 Android 广告 ARPDAU，不显著下降 ≥ 95% 置信
- 风险 2：游戏时长拉长但留存未提升（伪信号）→ A/B 14 天验证 D1/D7 留存差
- 测试：`tests/revive.test.js`（若不存在则新建）验证 Android 档下连续触发 2 次复活后第 3 次走原 `_handleNoMoves`

---

### §5. `roundsSinceLastDelight` 追踪 + 强 relief 兜底

**问题**：adaptiveSpawn 输出爽感候选但对玩家"是否真触爽"无闭环。

#### 5.1 PlayerProfile 新字段

**改动文件**：`web/src/playerProfile.js`

**插入位置**（line ~115，`_consecutiveNonClears = 0` 之后）：

```javascript
/* ��爽感覆盖率追踪。
 *
 * roundsSinceLastDelight：自上次"爽感时刻"（multiClear≥2 / pcClear /
 * comboHigh≥4 / monoFlush 命中）以来的轮数。超过阈值（Android 5 / iOS 7）
 * 时 intentResolver 强制 forceReliefIntent=true，保证爽感可达性 ≥ 90%。
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5。 */
this._roundsSinceLastDelight = 0;
```

**新增 API**（在 recordSpawn 附近）：

```javascript
/** 爽感时刻触发时调用：清零计数器。由 game.js 在消行/Combo 事件中 hook。 */
recordDelight(kind /* 'multiClear' | 'pcClear' | 'comboHigh' | 'monoFlush' */) {
    this._roundsSinceLastDelight = 0;
    this._lastDelightKind = kind;
    this._lastDelightTs = Date.now();
}

/** 每轮 spawn 时调用：计数器 +1。由 game.js 在 _spawnDock 入口 hook。 */
tickRoundForDelight() {
    this._roundsSinceLastDelight = (this._roundsSinceLastDelight ?? 0) + 1;
}

/** 当前是否处于爽感饥渴状态（用于 intentResolver 强 relief）。 */
isDelightStarved() {
    const platform = (typeof getPlatform === 'function') ? getPlatform() : 'web';
    const threshold = platform === 'android' || platform === 'wechat' ? 5 : 7;
    return (this._roundsSinceLastDelight ?? 0) >= threshold;
}
```

（import `getPlatform` 加在文件顶部）

#### 5.2 intentResolver 新规则

**改动文件**：`web/src/derivation/intentResolver.js`

**在 INTENT_RULES 数组中插入**（line 98 之后，priority 100 与 90 之间）：

```javascript
{
    id: 'relief',
    priority: 100,
    /* ... 现有 ... */
},
{
    /* ��爽感饥渴 → 强制 relief。
     * 与"playerDistress 主动救济"语义不同：前者基于挫败信号，
     * 后者基于"长期无爽感"的运营观测——同档优先级（介于 relief 与 engage 之间），
     * 一旦触发同样走 relief 分支让 adaptiveSpawn 偏好多消/小块。 */
    id: 'delight_starved',
    priority: 95,
    guard: (s) => !!s.delightStarved,
    reason: () => 'delightStarved=true（爽感饥渴：连续 N 轮无 multiClear/pcClear/monoFlush）',
},
{
    id: 'engage',
    priority: 90,
    /* ... 现有 ... */
},
```

#### 5.3 输入字段流动

**改动文件**：`web/src/derivation/selectors.js`（或 adaptiveSpawn 入参组装处）

确保 `delightStarved: playerProfile.isDelightStarved()` 写入 intent inputs。

#### 5.4 game.js hook

**改动文件**：`web/src/game.js`

- `_spawnDock()` 入口调用 `playerProfile.tickRoundForDelight()`
- 消行处理中（约 `processClear`）按 `lines >= 2` / `isPerfectClear` / `comboCount >= 4` / `monoFlushHit` 调用 `playerProfile.recordDelight(kind)`

**测试**：新增 `tests/playerProfileDelight.test.js`

- 5 轮无爽感 → `isDelightStarved()` Android 档应 true
- 7 轮无爽感 → iOS 档应 true
- recordDelight 后清零
- `delight_starved` 规则触发后 winnerIntent === 'relief'

---

### §6. 复活后强制 `forceReliefIntent`（避免"复活了立刻再死"）

**问题**：复活只清空 12 格，下一局仍走原 spawn，玩家很快再次死局——浪费复活机会。

**改动文件**：`web/src/revive.js`

**插入位置**（_performRevive 成功后，约 line 130-160 区间）：

```javascript
_performRevive(method) {
    // ... 现有清除 12 格逻辑 ...

    /* ��复活成功 → 标记下一局 spawn 走强 relief。
     * 数据依据：复活成功 r≈0 表明"复活后体验未传导到留存"，可能是
     * 复活后局面仍差很快再死。下一轮强 relief 给玩家"喘息"机会。 */
    if (this._game) {
        this._game._postReviveBoost = {
            forceReliefIntent: true,
            clearGuarantee: 3,
            ttlRounds: 2,  // 持续 2 轮，避免长期影响
        };
    }
}
```

**改动文件**：`web/src/game.js`（_spawnDock 或 _spawnContext 组装处）

**插入**：

```javascript
if (this._postReviveBoost && this._postReviveBoost.ttlRounds > 0) {
    spawnHints.forceReliefIntent = true;
    spawnHints.clearGuarantee = Math.max(spawnHints.clearGuarantee ?? 1, this._postReviveBoost.clearGuarantee);
    this._postReviveBoost.ttlRounds--;
    if (this._postReviveBoost.ttlRounds <= 0) this._postReviveBoost = null;
}
```

**测试**：`tests/revive.test.js` 增加 "复活后下一局 spawnHints.forceReliefIntent === true 且 clearGuarantee >= 3"。

---

### §7. PB 突破后次级目标卡片（同局保护 → 跨局保护）

**问题**： 只覆盖**同局**末段救济；数据显示 PB 后 D3-D15 流失加剧（iOS r=-0.126 → -0.128）。

#### 7.1 bestScoreBuckets 扩展

**改动文件**：`web/src/bestScoreBuckets.js`

**新增 API**（文件末尾）：

```javascript
const PB_BREAK_TS_KEY = 'openblock_pb_break_ts_v1';

/**
 * ��记录最近一次 PB 突破时间戳，供跨局保护链 / D3-D7 push 召回判定。
 * @param {number} score 突破分数
 */
export function notePbBreak(score) {
    _safeWriteJson(PB_BREAK_TS_KEY, {
        ts: Date.now(),
        score,
    });
}

/**
 * 距上次 PB 突破的天数（用于 winback push 触发判定）。
 * @returns {number|null} null 表示从未突破
 */
export function daysSinceLastPbBreak() {
    const rec = _safeReadJson(PB_BREAK_TS_KEY);
    if (!rec || !rec.ts) return null;
    return (Date.now() - rec.ts) / 86400000;
}

/**
 * ��基于当前 PB + 玩家历史生成"次级目标"列表，供 UI 展示。
 * 避免玩家因"我已破 PB 了"产生终结感——给出"还有挑战"叙事。
 *
 * @param {number} currentPb 当前难度档 PB
 * @returns {Array<{ id: string, label: string, target: number }>}
 */
export function getNextChallenges(currentPb) {
    if (!Number.isFinite(currentPb) || currentPb <= 0) return [];
    return [
        { id: 'pb_110', label: `挑战 ${Math.round(currentPb * 1.1)} 分`,
          target: Math.round(currentPb * 1.1) },
        { id: 'weekly_pb', label: '本周新高', target: getPeriodBest('weekly') || 0 },
        { id: 'pc_pb', label: '完美清屏 PB', target: 0 /* TODO 引入 pcClearBest */ },
    ].filter(c => c.target > 0 || c.id === 'pc_pb');
}
```

#### 7.2 game.js 触发点

**改动文件**：`web/src/game.js`（PB 检测处，搜索 `recordBestByStrategy` 调用点）

**插入**：

```javascript
if (newPb) {
    recordBestByStrategy(this.currentStrategy, this.score);
    notePbBreak(this.score);
    // 下一局开局展示次级目标
    this._showNextChallengesOnNextStart = true;
}
```

**新局开始时**：

```javascript
start() {
    // ... 现有 ...
    if (this._showNextChallengesOnNextStart) {
        const challenges = getNextChallenges(getBestByStrategy(this.currentStrategy));
        this._renderChallengeCards(challenges);  // 新增 UI 渲染
        this._showNextChallengesOnNextStart = false;
    }
}
```

**测试**：`tests/bestScoreBuckets.test.js` 增加 notePbBreak + daysSinceLastPbBreak + getNextChallenges 三组用例。

---

### §8. 看板新增「爽感覆盖率」KPI

**问题**：`/ops` 看板缺爽感覆盖率指标，无法验证 §3 / §5 落地效果。

#### 8.1 后端 SQL

**改动文件**：`server.py`（`ops_dashboard` 端点）

**新增字段**：

```python
# ��爽感覆盖率 — 7 日内触发任一爽感时刻的 DAU 占比
delight_cur = conn.execute("""
    SELECT COUNT(DISTINCT user_id) AS delight_users,
           (SELECT COUNT(DISTINCT user_id) FROM behaviors WHERE ts > ?) AS total_users
    FROM behaviors
    WHERE ts > ?
      AND event IN ('multi_clear', 'perfect_clear', 'combo_high', 'mono_flush')
""", (cutoff_7d, cutoff_7d)).fetchone()

delight_coverage_rate = (
    delight_cur['delight_users'] / delight_cur['total_users']
    if delight_cur['total_users'] else 0
)

result['coreMetrics']['delightCoverageRate'] = round(delight_coverage_rate, 4)
result['coreMetrics']['delightCoverageThreshold'] = 0.75  # 目标线
```

#### 8.2 前端展示

**改动文件**：`web/src/opsDashboard.js`

**新增卡片**：

```javascript
{
    label: '爽感覆盖率（7日）',
    value: pct(metrics.delightCoverageRate),
    hint: `目标 ≥ ${pct(metrics.delightCoverageThreshold)}（multiClear/pcClear/comboHigh/monoFlush 任一触发）`,
    tone: metrics.delightCoverageRate >= metrics.delightCoverageThreshold ? 'success' : 'warning',
}
```

#### 8.3 打点埋点

**改动文件**：`web/src/game.js`（消行处理 / Combo 处理）

```javascript

if (lines >= 2) analytics.track('multi_clear', { lines });
if (isPerfectClear) analytics.track('perfect_clear');
if (comboCount >= 4) analytics.track('combo_high', { comboCount });
if (monoFlushHit) analytics.track('mono_flush');
```

**测试**：`tests/opsDashboard.test.js` 增加新字段存在性 + 类型 check。

---

### §9. iOS 广告分层（按完播率分桶）

**问题**：iOS 广告完播 r=0.349（最强单一信号），但当前 trigger 权重无完播率分层。

**改动文件**：`web/src/monetization/strategy/strategyConfig.js`

**新增 segments**（在 segments 配置段）：

```javascript
segments: {
    // ... 现有 whale / dolphin / minnow / churn_risk ...

    /* ��iOS 广告完播率分层（仅 iOS 生效，Android 走默认）。
     * 数据依据：iOS 广告完播 r=0.349（最强单一信号），D15 仍 0.310。
     * 完播率分层让运营按"真实变现意愿"差异化触发。 */
    ios_ad_completer_high: {
        rule: (player) => getPlatform() === 'ios'
            && (player.adCompletionRateD7 ?? 0) >= 0.80,
        label: 'iOS 高完播玩家（≥80%）',
    },
    ios_ad_completer_low: {
        rule: (player) => getPlatform() === 'ios'
            && (player.adCompletionRateD7 ?? 0) > 0
            && (player.adCompletionRateD7 ?? 0) < 0.30,
        label: 'iOS 低完播玩家（<30%）',
    },
},
```

**新增 rules**：

```javascript
rules: [
    // ... 现有 ...

    {
        id: 'ios_high_completer_more_rewarded',
        segments: ['ios_ad_completer_high'],
        action: { type: 'ads', format: 'rewarded', frequencyBoost: 1.5 },
        priority: 'high',
        why: 'iOS 高完播玩家广告价值高，频次抬升 50% 不影响留存',
        effect: 'IAA ARPDAU +20-30%',
    },
    {
        id: 'ios_low_completer_iap_pivot',
        segments: ['ios_ad_completer_low'],
        action: { type: 'iap', product: 'starter_pack', priority: 'medium' },
        priority: 'medium',
        why: 'iOS 低完播玩家广告价值低，转 IAP 软营销避免留存伤害',
        effect: 'IAP 转化 +5-10%，广告退订率 −15%',
    },
],
```

**配套数据来源**：`adCompletionRateD7` 字段需要打点 → 后端聚合 → `/api/strategy` 接口下发。

**护栏**：A/B 14 天，iOS 高完播组 ARPDAU 与 D7 留存双显著正向；低完播组留存正向且广告退订率不上升。

---

### §10. Android 每日 3 次高分挑战任务（频次激励模型）

**问题**：Android 达到高分 r=0.276（最强）+ 区分度仅 21%（弱），是"普遍可达、越多越好"的频次激励模型。

**新建文件**：`web/src/retention/dailyChallengePlaybook.js`

```javascript
/**
 * dailyChallengePlaybook.js — Android 每日高分挑战。
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.7
 *   Android 达到高分 r=0.276 强正、区分度 21% 弱 → 普遍可达频次激励特征。
 *   iOS 不引入（稀缺爽感模型不应被频次稀释）。
 *
 * 任务规则：
 *   - 高分阈值 = playerProfile.getHighScoreMedian() × 0.95（个人化避免门槛过高）
 *   - 每日 3 次完成解锁组合奖励：金币 200 / 皮肤试用 1 / 复活机会 +1
 *   - 累计 7 天解锁周礼包
 *
 * 触发：lifecycle 事件 'high-score-reached'（>= 个人 P50）。
 */

import { getPlatform } from '../config/platformProfile.js';

const STORAGE_KEY = 'openblock_daily_challenge_v1';

const DAILY_TARGET = 3;
const WEEKLY_TARGET = 21; // 3 × 7

function _today() { return new Date().toISOString().slice(0, 10); }

function _read() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { date: _today(), count: 0, weekStart: _today(), weekCount: 0 };
    } catch { return { date: _today(), count: 0, weekStart: _today(), weekCount: 0 }; }
}

function _write(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch {}
}

/** 仅 Android / wechat 启用，其他平台 noop（避免污染 iOS 稀缺爽感）。 */
export function isEnabled() {
    const p = getPlatform();
    return p === 'android' || p === 'wechat';
}

/** 高分事件触发；返回 { dailyDone, weeklyDone, reward } */
export function noteHighScore() {
    if (!isEnabled()) return null;
    const today = _today();
    const state = _read();

    // 日重置
    if (state.date !== today) {
        state.date = today;
        state.count = 0;
    }
    // 周重置
    const weekAge = (Date.now() - new Date(state.weekStart).getTime()) / 86400000;
    if (weekAge >= 7) {
        state.weekStart = today;
        state.weekCount = 0;
    }

    state.count++;
    state.weekCount++;
    _write(state);

    const dailyDone = state.count === DAILY_TARGET;
    const weeklyDone = state.weekCount === WEEKLY_TARGET;

    return {
        dailyDone,
        weeklyDone,
        reward: dailyDone ? { coins: 200, skinTrial: 1, reviveBonus: 1 } : null,
        weeklyReward: weeklyDone ? { coins: 2000, skinUnlock: 1 } : null,
    };
}

export function getProgress() {
    if (!isEnabled()) return null;
    const state = _read();
    return {
        daily: { count: state.count, target: DAILY_TARGET },
        weekly: { count: state.weekCount, target: WEEKLY_TARGET },
    };
}
```

**game.js 接入**：

```javascript
// 玩家达到个人 P50 高分时
const dchallenge = noteHighScore();
if (dchallenge?.reward) {
    this._showDailyChallengeReward(dchallenge.reward);
}
```

**测试**：新建 `tests/dailyChallengePlaybook.test.js`

- iOS 平台 isEnabled() === false
- Android 3 次触发 → dailyDone, reward 非空
- 跨日自动重置
- 跨周自动重置

---

### 实施次序建议

```
Week 1（基础设施 + 快赢）
├─ §1 platformProfile（必做，其他依赖）         [0.5d]
├─ §2 monoFlush 平台化                          [0.5d]
├─ §3 multiClearBonus Android 抬高              [0.5d]
└─ §4 REVIVE_LIMIT Android 提至 2               [0.5d]

Week 2（爽感闭环 + 复活救济）
├─ §5 roundsSinceLastDelight 追踪                [1.5d]
├─ §6 复活后强 relief                            [0.5d]
└─ §7 PB 突破后次级目标                          [1d]

Week 3（数据回流 + 平台精细化）
├─ §8 爽感覆盖率看板 KPI                         [1d]
├─ §9 iOS 广告分层                               [1d]
└─ §10 Android 每日高分挑战                      [2d]
```

每周末做一次 A/B 切流验证，14 天后回收数据迭代。

---

### 不在本清单的事项（明确不做）

| 事项 | 原因 |
|---|---|
| iOS 复活漏斗扩张 | 数据显示 iOS 复活非线性 U 型，需先分桶研究避免反向劣化 |
| Android 广告分层 | 广告 r 长期衰减至 0.216，分层投入边际收益低 |
| iOS 每日高分挑战 | iOS 稀缺爽感模型，频次任务会稀释爽感价值 |
| Android PRS 复合评分 | 6 个强信号已能单独驱动运营，先看 §3/§4/§7/§10 效果再评估 |
| 基础指标改造（绝对次数→比率） | 打点 schema 改造大 |

---

### 数据回流验证清单

每个 § 上线后必须能在 `/ops` 看板看到对应变化：

| § | 验证字段 | 验证维度 |
|---|---|---|
| §2 | `chosen.reason='special-monoFlush'` 出现率 | 按 platform 切片，Android 应 ≥ 5% |
| §3 | `spawnHints.multiClearBonus ≥ 0.15` 比例 | Android 100% / iOS 0% |
| §4 | "复活成功次数" 在 Android 包均值 | 提升 ≥ 30%（基线待回收） |
| §5 | `delightCoverageRate` 7 日值 | 全平台 ≥ 75% |
| §6 | 复活后下一局 `reason='special-relief'` 出现率 | 接近 100% |
| §7 | PB 突破事件 / 下一局展示次级目标比率 | 接近 100% |
| §8 | 看板 `delightCoverageRate` 字段 | 字段存在且非 null |
| §9 | iOS 高完播组 IAA ARPDAU | 14 天后 +20-30% |
| §10 | Android `dailyChallenge.dailyDone` 触发 | 7 日内 ≥ 30% Android DAU |

---

### 文档关系

| 上游 | 关系 |
|---|---|
| [留存信号跨平台分析](./RETENTION_SIGNALS_CROSS_PLATFORM.md) | 提供数据洞察与策略层方案；本文是其工程落地清单 |
| [自适应出块 §10.7](../algorithms/ADAPTIVE_SPAWN.md#107-形状池扩展v1600--v16044独立库事件注入系统) | 三类触发分级；§2/§3 在此基础上做平台分发 |
| [生命周期蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | §0 北极星与护栏；新增"爽感覆盖率"为次级 KPI |
