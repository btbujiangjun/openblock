# 商业化推断：算法工程师手册

> 本文是 OpenBlock **商业化算法子系统**的统一手册。
> 范围：分群（whale_score）/ 实时策略引擎 / CommercialModelVector / LTV 预测 / 与买量出价的接口。
> 与现有文档的关系：本文维护商业化算法、公式、阈值默认值与代码事实；`MONETIZATION.md` 维护运营系统全景，`MONETIZATION_TRAINING_PANEL.md` 和 `MONETIZATION_CUSTOMIZATION.md` 只作为专题接入说明。
> 若需要横向理解 CommercialModelVector 与 PlayerProfile、AbilityVector、LTV、广告频控和 RL/Spawn 边界，先读 [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md)。

---

## 目录

1. [问题域与分层架构](#1-问题域与分层架构)
2. [鲸鱼分模型（whale_score）](#2-鲸鱼分模型whale_score)
3. [实时信号体系](#3-实时信号体系)
4. [策略规则引擎（L2）](#4-策略规则引擎l2)
5. [active 判定与排序](#5-active-判定与排序)
6. [whyLines 推理摘要](#6-whylines-推理摘要)
7. [LTV 预测器](#7-ltv-预测器)
8. [CommercialModelVector：模型化商业决策](#8-commercialmodelvector模型化商业决策)
9. [广告触发与 Cap 算法](#9-广告触发与-cap-算法)
10. [配置覆盖与热更新](#10-配置覆盖与热更新)
11. [缓存与一致性](#11-缓存与一致性)
12. [完整公式速查](#12-完整公式速查)
13. [完整参数表](#13-完整参数表)
14. [演进与开放问题](#14-演进与开放问题)
15. [算法层扩展模块](#15-算法层扩展模块)

---

## 1. 问题域与分层架构

### 1.1 商业化算法的三个核心问题

```
Q1: 这个用户值多少钱？           → 鲸鱼分 + LTV
Q2: 现在该给他展示什么？          → 实时策略引擎
Q3: 怎么把决策变成可定制的资产？   → L1/L2/L3 分层
```

### 1.2 v3 三层架构

```
┌───────────────────────────────────────────────────────────────┐
│  L3: cursor:help 文案中心 (strategyHelp.js)                   │
│      可定制字段的人类可读说明（HELP_TEXTS，41 项）             │
└───────────────────────────────────────────────────────────────┘
                               ↑
┌───────────────────────────────────────────────────────────────┐
│  L2: 策略规则引擎 (strategyEngine.js)                         │
│      纯函数：context → ranked actions + whyLines              │
│      四步：filter → render → sort → buildWhyLines             │
└───────────────────────────────────────────────────────────────┘
                               ↑ 配置依赖
┌───────────────────────────────────────────────────────────────┐
│  L1: 配置层 (strategyConfig.js)                                │
│      DEFAULT_STRATEGY_CONFIG                                   │
│      - segments, weights, thresholds, rules, products          │
│      可热替换：setStrategyConfig(patch) / registerStrategyRule │
└───────────────────────────────────────────────────────────────┘

           上：Persona 数据汇聚 (personalization.js)
           ↓
┌───────────────────────────────────────────────────────────────┐
│  数据源：                                                      │
│   - 后端 /api/mon/user-profile (whale_score, segment)         │
│   - 前端 PlayerProfile (frustration, hadNearMiss, flowState)  │
│   - 后端 /api/mon/model/config (动态权重)                     │
└───────────────────────────────────────────────────────────────┘
```

### 1.3 建模方法对比

商业化推断是多目标决策：短期收入、长期留存、心流保护、付费用户保护和合规频控同时存在。当前采用“可解释规则模型 + CommercialModelVector + 硬护栏”，不是单纯按收益最大化。

| 方法 | 建模对象 | 优势 | 代价 | 适用阶段 |
|------|----------|------|------|----------|
| 线性 whale_score（当前） | 长期价值代理变量 | 解释性强、冷启动可用、可由 DB 配置热更 | 非线性行为表达弱，需人工校准 | 默认分群与运营解释 |
| 规则策略引擎（当前） | context → ranked actions | 可测试、可审计、运营可控 | 规则组合多时维护成本上升 | 产品策略与合规护栏 |
| CommercialModelVector（当前） | IAP/广告/流失/疲劳多目标评分 | 下游动作统一门控，未来可替换 baseline | 当前仍是规则权重，不直接学习 uplift | 广告触发与面板解释 |
| LightGBM / XGBoost | 付费、广告完播、流失概率 | 表格特征强、样本效率高、可离线校准 | 需要模型版本与特征一致性；解释需 SHAP/分桶 | 有稳定标签后替换 propensity baseline |
| Uplift model | 展示动作的增量收益 | 比普通分类更接近“展示是否有用” | 需要随机实验或准实验数据 | A/B 曝光数据充足后 |
| Contextual Bandit | state/action/reward 在线探索 | 能动态平衡探索与利用 | 需要严格护栏、流量和实验治理 | 成熟商业化阶段 |
| Deep RL 排序 | 长期收益序列优化 | 理论上可优化长期 LTV | 数据量和安全风险高，解释弱 | 当前不建议直接上真人路径 |

结论：商业化模型先保持规则可解释和护栏稳定；当曝光、点击、完播、购买和留存标签足够时，用 ML 只替换 baseline 分数，不删除硬频控与合规护栏。

#### 为什么三层

- **L1 配置可序列化** → 可存 DB / 远程更新 / A/B 测试
- **L2 引擎纯函数** → 单测覆盖率 100%，可移植
- **L3 文案集中** → 改文案不动逻辑，多语言友好

---

## 2. 鲸鱼分模型（whale_score）

### 2.1 数学定义

$$
\text{whale\_score} = w_0 \cdot \text{bestScoreNorm} + w_1 \cdot \text{totalGamesNorm} + w_2 \cdot \text{sessionTimeNorm}
$$

其中：

```
bestScoreNorm  = min(1, best_score    / 2000)
totalGamesNorm = min(1, total_games   / 50)
sessionTimeNorm= min(1, avg_session_sec / 600)

默认权重：w0=0.40, w1=0.30, w2=0.30
```

代码：`monetization_backend.py` `_compute_user_profile`：

```python
best_score_norm  = min(1.0, best_score / 2000.0)
total_games_norm = min(1.0, total_games / 50.0)
avg_session_norm = min(1.0, avg_session_sec / 600.0)

whale_score = w0 * best_score_norm + w1 * total_games_norm + w2 * avg_session_norm
```

### 2.2 为什么是这三个分量

| 分量 | 物理意义 | 与 LTV 的相关性 |
|------|---------|---------------|
| `best_score` | 玩家**能力天花板** | 高分玩家更容易**长期留存** |
| `total_games` | 玩家**累计投入** | 局数多 = 习惯养成 = 不易流失 |
| `avg_session_sec` | 单次**沉浸深度** | 沉浸时间长 = 高内驱 = 付费意愿强 |

> 三者**正交**：能玩很多但每局短的（碎片化），能玩长但局数少的（深度但少时间）。组合起来才能定位"鲸鱼候选"。

### 2.3 归一化标度的合理性

| 标度 | 默认 | 物理对应 |
|------|-----|---------|
| best_score / 2000 | 2000 = 中等鲸鱼水平 | 大多数玩家 < 1500 |
| total_games / 50 | 50 局 ≈ 中等用户上限 | 重度玩家 200+ 局 |
| avg_session_sec / 600 | 10 min/局是合理上限 | 长局 15-20 min |

**调参建议**：观察 D7 留存与 whale_score 分布的相关性，回归调系数。

### 2.4 分群判定

按 `minWhaleScore` 阈值降序匹配（避免覆盖问题）：

```python
if whale_score >= 0.60:
    segment = 'whale'
elif whale_score >= 0.30:
    segment = 'dolphin'
else:
    segment = 'minnow'
```

> 阈值 0.60 / 0.30 来自竞品行业基准（鲸鱼 5%-10% 用户，海豚 25%-40%），实际项目应**按自家 P95/P75 分位数校准**。

### 2.5 与 PlayerProfile.segment5 的差异

| 系统 | 字段 | 用途 |
|------|-----|-----|
| 后端商业化 | `segment ∈ {whale, dolphin, minnow}` | 服务端分群 → 个性化策略 |
| 前端 PlayerProfile | `segment5 ∈ {A, B, C, D, E}` | 客户端分群 → LTV 预测 |
| 关系 | 5 分群是 3 分群的细分（约略） | 二者**独立维护**（数据源不同） |

**注意**：`segment5` 用 K-Means 离线聚类或规则离散化（详见 `playerProfile.js`），与服务端 `segment` 不一定一致——这是合理的，因为客户端能看到行为方差等更多信息。

---

## 3. 实时信号体系

### 3.1 数据来源

```
realtimeSignals = {
    frustration:   profile.frustrationLevel,    // 整数计数
    hadNearMiss:   profile.hadRecentNearMiss,   // 布尔
    flowState:     profile.flowState,           // 'flow'|'bored'|'anxious'
    momentum:      profile.momentum,            // [-1, 1]
    sessionPhase:  profile.sessionPhase,        // 'early'|'peak'|'late'
}
```

由 `personalization.js` 的 `updateRealtimeSignals(profile)` 在每步 / 每个 spawn 时刷新。

### 3.2 信号阈值

`strategyConfig.thresholds`：

| 阈值 | 默认 | 触发的策略 |
|------|-----|-----------|
| `frustrationWarning` | 3 | UI 显示挫败警告 |
| `frustrationIapHint` | 4 | 弹 hint pack（弱促） |
| `frustrationRescue` | 5 | 弹激励广告（强救援） |
| `activityLow` | 0.35 | 触发唤回推送 |
| `activityHigh` | 0.70 | 启动 IAP 转化窗口 |
| `nearMissRateHigh` | 0.30 | 高紧张玩家偏好激励广告 |

### 3.3 信号 vs 持久画像

```
┌─────────────────────────────────────────────────────────┐
│  Persona（持久）                                         │
│  - segment, whaleScore (从后端拉)                        │
│  - activityScore, skillScore（聚合）                     │
│  - nearMissRate, frustrationAvg（7日聚合）               │
│  更新频率：会话开始 / 局间                                │
│                                                          │
│  Realtime（实时）                                         │
│  - frustration, hadNearMiss（PlayerProfile 实时）        │
│  - flowState, momentum                                  │
│  更新频率：每步 / 每 spawn                                │
└─────────────────────────────────────────────────────────┘
```

策略规则可同时使用两者：

```js
{
    when: ({ persona, realtime, config }) => 
        persona.segment === 'whale' && 
        realtime.frustration >= config.thresholds.frustrationRescue,
    action: { type: 'iap', product: 'hint_pack_5' }
}
```

---

## 4. 策略规则引擎（L2）

### 4.1 evaluate 主流程

```js
export function evaluate(ctx) {
    const config = ctx?.config ?? getStrategyConfig();
    const persona  = ctx?.persona  ?? {};
    const realtime = ctx?.realtime ?? {};
    const segment  = persona.segment ?? 'minnow';
    const evalCtx  = { persona, realtime, config, segment };

    // 1. Filter: 按 segments + when() 过滤
    const matched = config.rules.filter(r => 
        matchSegment(r, segment) && evalWhen(r, evalCtx)
    );

    // 2. Render: 调 explain() 生成动态 why/effect
    const evaluated = matched.map(r => _renderAction(r, evalCtx));

    // 3. Sort: active 优先，priority 降序
    evaluated.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    });

    // 4. WhyLines: 生成推理摘要
    const whyLines = buildWhyLines(evalCtx);

    return { segment, actions: evaluated, whyLines };
}
```

### 4.2 规则定义结构

```js
{
    id: 'whale_hint_pack_on_frustration',     // 唯一 ID
    segments: ['whale'],                       // 命中分群
    when: ({ realtime, config }) =>            // 可选：动态条件
        realtime.frustration >= config.thresholds.frustrationRescue,
    action: { type: 'iap', product: 'hint_pack_5' },
    priority: 'high',                           // high|medium|low
    why: '未消行 N 次，提示需求明确',          // 静态文案
    effect: '降低即时流失率约 18%',
    explain: ({ realtime }) => ({               // 可选：动态文案
        why: `未消行 ${realtime.frustration} 次，提示需求明确`,
        effect: '降低即时流失率约 18%'
    })
}
```

### 4.3 内置规则矩阵（默认 9 条）

来源：`web/src/monetization/strategy/strategyConfig.js` `DEFAULT_STRATEGY_CONFIG.rules`。

| 规则 ID | Segment | 触发条件 | Action | Priority |
|--------|--------|---------|--------|----------|
| whale_default_monthly | whale | 默认（无 when） | iap.monthly_pass | high |
| whale_no_interstitial | whale | 默认（无 when） | ads.none | high |
| whale_hint_pack_on_frustration | whale | frustration ≥ thresholds.frustrationRescue (=5) | iap.hint_pack_5 | high |
| dolphin_default_weekly | dolphin | 默认（无 when） | iap.weekly_pass | medium |
| dolphin_rewarded_near_miss | dolphin | realtime.hadNearMiss | ads.rewarded（trigger=near_miss） | high |
| dolphin_push_on_low_activity | dolphin | persona.activityScore < thresholds.activityLow (=0.35) | push（trigger=streak_reminder） | medium |
| minnow_interstitial_on_game_over | minnow | 默认（无 when） | ads.interstitial（trigger=game_over） | medium |
| minnow_starter_pack_on_frustration | minnow | frustration ≥ thresholds.frustrationRescue (=5) | iap.starter_pack | high |
| minnow_daily_tasks | minnow | 默认（无 when） | task（trigger=daily_quest） | low |

可通过 `setStrategyConfig({ rules: [...] })` 整体替换或 `registerStrategyRule(rule)` 增量。

### 4.4 优先级权重

```js
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
```

排序逻辑（`strategyEngine.evaluate` 实际实现）：

```
排序键 = (active DESC, priority DESC)
```

`active = true` 始终在前；priority 同档内保持原始数组顺序。

---

## 5. active 判定与排序

### 5.1 active 的语义

`active` 表示规则当前**正在被实时信号触发**——用于 UI 高亮 ⚡。

### 5.2 判定逻辑（`_isActive`）

```js
function _isActive(rule, evalCtx) {
    const { realtime, config } = evalCtx;

    // 显式带 when 的规则视为 active（已被 filter 通过）
    if (typeof rule.when === 'function') return true;

    // 默认规则的 active：按动作类型 + 信号判断
    const a = rule.action ?? {};
    const t = config.thresholds ?? {};
    if (a.type === 'ads' && a.format === 'rewarded' && realtime.hadNearMiss) return true;
    if (a.type === 'ads' && a.trigger === 'game_over') return true;
    if (a.type === 'iap' && realtime.frustration >= (t.frustrationIapHint ?? 4)) return true;
    return false;
}
```

### 5.3 排序示例

假设三条规则同 segment 命中：

```
A: { priority: 'high', active: false }       (静态规则 like monthly_pass)
B: { priority: 'medium', active: true }      (实时触发 hint_pack)
C: { priority: 'low', active: false }
```

排序后：`[B (active+medium), A (high), C (low)]`

> **核心设计**：实时触发的规则即使 priority 较低，也排在前面——保证"现在就该做的事"在 UI 顶部。

---

## 6. whyLines 推理摘要

### 6.1 输出格式

`buildWhyLines(evalCtx)` 返回 5~7 条 bullet：

```
[
  "分群 Whale：鲸鱼分 72%（最高分×0.4 + 局数×0.3 + 时长×0.3）",
  "活跃度高（85%）→ IAP 转化窗口良好",
  "未消行 5 次 → 已达救济阈值，激励广告/提示包转化率最高",
  "⚡ 近失触发 → 激励广告转化率 +40%，立即展示最佳",
  "心流中 → 抑制插屏广告，流失率峰值",
  "距晋升 whale 差 12 分 → 提升最高分或时长"
]
```

### 6.2 生成逻辑（6 个分组）

```
1. 分群依据  → 总是输出
2. 活跃度    → 仅在 high/low 阈值时输出
3. 挫败感    → 仅在 ≥ warning 阈值时输出
4. 近失      → 实时优先 / 历史次之
5. 心流      → 三态各有文案
6. 晋升路径  → gap < 0.20 时给提示
```

### 6.3 与 cursor:help 的关系

`whyLines` 是**当前 context 的解释**，cursor:help 是**字段定义的解释**。  
两者协同：
- whyLines：为什么**现在**触发这条规则
- cursor:help：这个**字段是什么意思**

详见 `MONETIZATION_TRAINING_PANEL.md` 的"为什么这个建议"章节。

---

## 7. LTV 预测器

### 7.1 数学模型（`ltvPredictor.js`）

$$
\text{LTV}_{30d} = \text{base} \times c_{\text{seg}} \times c_{\text{chan}} \times c_{\text{act}} \times c_{\text{skill}}
$$

各项含义：

| 系数 | 范围 | 来源 |
|------|------|------|
| base | 2.5 元（A 类基准） | 市场均值 |
| $c_{\text{seg}}$ | 0.27 ~ 9.0 | 5 分群 ARPU 比例 |
| $c_{\text{chan}}$ | 1.0 ~ 1.4 | 渠道质量加成 |
| $c_{\text{act}}$ | 0.51 ~ 1.50 | 活跃度（局数 + 趋势） |
| $c_{\text{skill}}$ | 0.85 ~ 1.15（E类0.5） | 技能 |

### 7.2 5 分群 ARPU 比例

```js
const SEGMENT_ARPU_RATIO = {
    A: 1.0,    // 28% 用户产生 28% 收入（baseline）
    B: 2.64,   // 14% 用户产生 37% 收入（中等付费）
    C: 9.0,    // 2% 用户产生 9% 收入（鲸鱼）
    D: 5.56,   // 9% 用户产生 25% 收入（中鲸）
    E: 0.27,   // 0.6% 用户产生 0.8% 收入（高技能但不付费）
};
```

数据来源：竞品行业报告（详见 `COMPETITOR_USER_ANALYSIS.md`）。

### 7.3 渠道系数

```js
const CHANNEL_COEFF = {
    applovin:   1.40,   // 头部买量平台
    unity:      1.35,
    ironsource: 1.30,
    mintegral:  1.25,
    facebook:   1.20,
    google_uac: 1.15,
    organic:    1.05,   // 自然流量略高于未知
    unknown:    1.00,
};
```

**直觉**：买量渠道经过算法投放过滤，留存的用户质量更高 → LTV 更高。

### 7.4 活跃度系数

```js
function _activityCoeff(profile) {
    const games = profile._totalLifetimeGames ?? 0;
    const trend = profile.sessionTrend ?? 'stable';
    let base = Math.min(1.3, 0.6 + games * 0.02);
    if (trend === 'rising')    base *= 1.15;
    if (trend === 'declining') base *= 0.85;
    return base;
}
```

```
games = 0  → 0.6
games = 5  → 0.7
games = 10 → 0.8
games = 35+ → 1.3 (上限)
```

### 7.5 技能系数

```js
function _skillCoeff(profile) {
    const skill = profile.skillLevel ?? 0.3;
    const seg   = profile.segment5 ?? 'A';
    if (seg === 'E') return 0.5;          // 特殊：高技能低付费
    return 0.85 + skill * 0.3;            // 0.85 ~ 1.15
}
```

E 类的 0.5 是经验调整——高技能玩家通常不为内购付费，但他们带来 PR 价值与广告浏览量。

### 7.6 30/60/90 天

```
ltv30 = base.ltv30 × multiplier  // 2.5 × 系数乘积
ltv60 = base.ltv60 × multiplier  // 4.0 × 系数乘积
ltv90 = base.ltv90 × multiplier  // 5.2 × 系数乘积

base.ltv60/ltv30 = 1.6  →  60 天比 30 天多 60%
base.ltv90/ltv30 = 2.08 →  90 天比 30 天多 108%
```

衰减形态来自典型移动游戏 LTV 曲线（前 30 天占 40-50%，后 60 天占 50-60%）。

### 7.7 出价推荐

```js
const roiTarget = segment === 'D' ? 0.60 : 0.40;
bidRecommendation = ltv30 × roiTarget;
```

| Segment | ROI 目标 | 含义 |
|---------|---------|------|
| D 类（中鲸） | 60% | 已知付费倾向，可提价吸引 |
| 其他 | 40% | 保守 30 日回本 ROI |

```
A 类用户：ltv30 = 2.5 × 1.0 × 1.0 × 1.0 × 1.0 ≈ 2.5
         bid = 2.5 × 0.4 = 1.0 元

D 类用户（applovin 来）：ltv30 = 2.5 × 5.56 × 1.4 × 1.0 × 1.0 ≈ 19.5
                       bid = 19.5 × 0.6 ≈ 11.7 元
```

### 7.8 置信度

```js
games >= 30: 'high'
games >= 8:  'medium'
else:        'low'
```

低置信时 UI 显示灰色，运营理解为"参考值，需观察"。

### 7.9 与 ML 模型的对接

如果未来引入 ML 预测，可保持下游不变：

```js
// 替换 getLTVEstimate 内部实现
function getLTVEstimate(profile, attribution) {
    const features = extractFeatures(profile, attribution);
    const ltv30 = mlModel.predict(features);  // ← 替换点
    // ... 其他逻辑不变
}
```

下游 `bidRecommendation`、UI 展示、归因决策完全无感。

---

## 8. CommercialModelVector：模型化商业决策

业界成熟商业化建模一般不只做一个“鲸鱼分”，而是拆成多个可解释子目标：

- **LTV 预测**：用 D1/D7 行为、渠道、分群预测 LTV30/60/90，用于买量出价和 IAP 优先级。
- **IAP propensity**：预测某个上下文下展示 IAP offer 的期望收益。
- **Ad propensity**：区分激励广告和插屏广告接受度，激励广告更适合近失/救援，插屏只适合自然断点。
- **Churn risk**：焦虑、挫败、低活跃和广告疲劳会抬高流失风险。
- **Frequency guard**：日上限、冷却、体验分、付费用户保护必须在模型之外作为硬护栏。
- **Contextual bandit 路线**：记录 state/action/reward，周期性训练模型，在 exploitation 与 exploration 间平衡。

OpenBlock 对应实现为 `web/src/monetization/commercialModel.js`，当前使用端侧规则模型输出 `CommercialModelVector`，后续可接 LightGBM / TFLite / 服务端预测值。

模型权重与护栏阈值不写在 `commercialModel.js` 中，统一来自 `strategyConfig.js → commercialModel`，并可由后端 `mon_model_config` 深合并覆盖；字段解释登记在 `strategyHelp.js → model.*` cursor:help。

### 8.1 输出字段

| 字段 | 范围 | 含义 |
|------|------|------|
| `payerScore` | 0~1 | 付费潜力，融合 whaleScore、LTV、活跃、技能、分群 |
| `iapPropensity` | 0~1 | 当前是否适合 IAP offer |
| `rewardedAdPropensity` | 0~1 | 当前是否适合激励广告 |
| `interstitialPropensity` | 0~1 | 当前是否适合插屏广告 |
| `churnRisk` | 0~1 | 流失风险 |
| `adFatigueRisk` | 0~1 | 广告疲劳风险 |
| `guardrail` | object | 付费保护、插屏抑制、激励抑制、全部抑制 |
| `recommendedAction` | string | `iap_offer` / `rewarded_ad` / `interstitial` / `task_or_push` / `observe` / `suppress` |

### 8.2 模型输入

```js
{
  persona: { segment, whaleScore, activityScore, skillScore, frustrationAvg, nearMissRate },
  realtime: { frustration, hadNearMiss, flowState, momentum, sessionPhase, segment5 },
  ltv: { ltv30, ltv60, ltv90, confidence },
  adFreq: { rewardedCount, interstitialCount, experienceScore, inRecoveryPeriod }
}
```

### 8.3 决策护栏

模型输出不是直接展示广告，而是提供一层决策评分；最终触发必须同时通过：

1. Feature Flag 开启；
2. 广告频控通过；
3. 弹窗 quiet window 通过；
4. `shouldAllowMonetizationAction(model, action)` 通过。

当前硬护栏：

- `commercialModel.guardrail.protectPayerScore` 或 `segment=whale`：保护付费用户，屏蔽插屏。
- `flowState=flow`：抑制插屏，避免打断心流。
- `commercialModel.guardrail.suppressInterstitialChurnRisk`：抑制插屏，转向救援/任务。
- `commercialModel.guardrail.suppressInterstitialFatigue`：抑制插屏；`suppressRewardedFatigue` 抑制激励广告。
- `inRecoveryPeriod=true`：全部广告抑制。

### 8.4 数据闭环

模型化后应记录 state/action/reward：

- `state`：`CommercialModelVector` + `PlayerProfile` + 频控状态。
- `action`：展示的 IAP / rewarded / interstitial / push / task。
- `reward`：点击、完播、购买、次日回访、局长变化。

短期继续使用规则模型；中期可用 SQLite `mon_strategy_log`、`behaviors`、`sessions` 训练 IAP/广告倾向模型；长期按 contextual bandit 方式让模型直接选择 offer。

### 8.5 未来 ML 损失函数口径

当前 `commercialModel.js` 是规则评分模型，不直接反向传播训练；但字段契约已经按未来 ML baseline 设计。若引入离线模型，建议按子目标分别训练并保持下游 guardrail 不变：

| 子模型 | 标签 | 损失函数 | 关键评估 |
|--------|------|----------|----------|
| IAP propensity | 曝光后 1/7/30 天是否付费、付费金额分桶 | BCE / Focal Loss；金额可用 Huber 或 Tweedie | AUC、校准曲线、分群 lift |
| Rewarded ad propensity | 是否点击、是否完播、完播后是否继续游戏 | BCE + 完播样本加权 | 完播率 uplift、后续局长变化 |
| Interstitial tolerance | 展示后是否流失、是否继续下一局 | BCE / uplift loss | D1 留存、退出率、投诉/疲劳 |
| Churn risk | D1/D3/D7 未回访 | BCE / time-to-event survival loss | AUC、PR-AUC、分渠道校准 |
| Ad fatigue | 日内广告后体验分下降、恢复期触发 | Ordinal loss / Huber | 疲劳分校准、护栏命中率 |
| Action ranking | state-action-reward 日志 | Pairwise ranking / contextual bandit IPS loss | 长期 ARPDAU、留存约束下 uplift |

训练数据注意事项：

- 普通转化分类只能回答“谁会转化”，不能回答“展示是否带来增量”，因此高价值动作最终应以 uplift 或 A/B 结果校准。
- 训练样本必须包含未展示对照组，否则容易把“本来就会付费”的用户误判为 IAP offer 有效。
- 所有模型输出只能作为 `modelBaseline` 或 `commercialModel` 子分数来源；`shouldAllowMonetizationAction` 的护栏必须保留。

---

## 9. 广告触发与 Cap 算法

详见 `web/src/monetization/adTrigger.js`，本节做算法摘要。

### 9.1 频次控制（Cap）

来源：`web/src/monetization/adTrigger.js` `AD_CONFIG`，与
`strategyConfig.frequency` 镜像。

```js
const AD_CONFIG = {
    rewarded: {
        maxPerGame: 3,        // 单局上限
        maxPerDay:  12,       // 日上限
        cooldownMs: 90_000,   // 两次之间最短间隔（90s）
    },
    interstitial: {
        maxPerDay:  6,        // 日上限
        cooldownMs: 180_000,  // 最短间隔（180s）
        minSessionsBeforeFirst: 3,  // 新用户前 3 局豁免插屏
    },
};
```

补充护栏（来自 `adTrigger._canShowInterstitial` / `_canShowRewarded`）：

- 心流（`flowState === 'flow'`）+ 反应时退化（`pickToPlaceMs > baseline*1.5`）→ 硬阻拦
- LTV 防护（feature flag `ltvAdShield` on，`vip.tier ≥ T2` 或 `lifetimeSpend ≥ 50`）→
  插屏 70% 概率主动跳过
- 体验分（`experienceScore < frequency.experienceRecoveryBelow=60`）→ 进入恢复期

### 9.2 触发逻辑

```
on('game_over')
  ├─ if !_canShowInterstitial(game): return
  ├─ ctx = getCommercialModelContext(game)
  ├─ vector = buildCommercialModelVector(ctx)
  ├─ if !shouldAllowMonetizationAction(vector, 'interstitial'): return
  └─ runAfterPopupQuiet(() => showInterstitialAd())

on('near_miss')
  ├─ if !_canShowRewarded(game): return
  ├─ ctx = getCommercialModelContext(game)
  ├─ vector = buildCommercialModelVector(ctx)
  ├─ if vector.rewardedAdPropensity < actionThresholds.allowAction (=0.45): return
  └─ showRewardedAd('near_miss')
```

可选委托：`adDecisionEngine` 灰度 on（feature flag `adDecisionEngine`）时，`game_over`
路径走 `adDecisionEngine.requestAd`；`adInsertionRL` 灰度 on 时，决策由
`buildAdInsertionState + selectAdInsertionAction` 输出（详见
[`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md)）。

### 9.3 与策略引擎的解耦

`adTrigger` 不直接决定“用户该不该商业化”，而是先执行硬频控，再调用 `CommercialModelVector` 的护栏。策略规则仍负责解释与推荐卡片，模型向量负责实时触发门控。
好处：改规则不影响广告 SDK 触发链路，未来替换为服务端/端侧 ML 预测也只改模型输出层。

---

## 10. 配置覆盖与热更新

### 10.1 配置层级

```
默认 (DEFAULT_STRATEGY_CONFIG)
   ↓ deep merge
后端覆盖 (mon_model_config 表 / GET /api/mon/model/config)
   ↓ deep merge
A/B 实验覆盖 (实验组特有)
   ↓
最终运行时配置
```

### 10.2 热替换 API

```js
// 整体替换
setStrategyConfig({
    segments: [...],
    rules: [...],
    thresholds: {...}
});

// 增量注册
registerStrategyRule({
    id: 'experiment_xyz',
    segments: ['dolphin'],
    when: ({realtime}) => realtime.flowState === 'bored',
    action: { type: 'push', message: '试试新关卡' }
});
```

### 10.3 数组语义

```js
const _deepMerge = (target, patch) => {
    if (Array.isArray(patch)) return patch;  // 数组直接替换
    if (typeof patch === 'object') {
        // 递归 merge object
    }
    return patch;  // 标量直接覆盖
};
```

**关键**：`rules` 数组**整体替换**而非合并——避免规则 ID 冲突。

### 10.4 持久化

`mon_model_config` 表：

```sql
CREATE TABLE mon_model_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_json TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
```

每次面板修改 → INSERT 新行 + 通知所有客户端拉取。

---

## 11. 缓存与一致性

### 11.1 缓存层级

```
L0: PlayerProfile 内存（实时）
L1: localStorage（端侧，跨刷新）
L2: SQLite mon_user_segments（后端，共享）
L3: 后端聚合统计 user_stats（每日 cron 重建）
```

### 11.2 失效策略

| 缓存 | TTL | 失效触发 |
|------|-----|---------|
| `_cachedHistorical` | 永久 | session 结束 / ingestStats |
| `mon_user_segments` | 1h | _compute_user_profile 重算 |
| `user_stats` | 24h | 定时任务 |

### 11.3 一致性保证

- **最终一致**：实时信号优先级 > 持久画像
- **谁是真相源**：DB 聚合 > 客户端 localStorage
- **冲突解决**：本地 toJSON/load 仅做加速，启动时拉服务端覆盖

---

## 12. 完整公式速查

### 12.1 鲸鱼分

$$
\text{whale\_score} = 0.4 \cdot \min(1, \tfrac{S}{2000}) + 0.3 \cdot \min(1, \tfrac{G}{50}) + 0.3 \cdot \min(1, \tfrac{T}{600})
$$

### 12.2 LTV

$$
\text{LTV}_{30d} = 2.5 \cdot c_{\text{seg}} \cdot c_{\text{chan}} \cdot c_{\text{act}} \cdot c_{\text{skill}}
$$

### 12.3 出价

$$
\text{bid} = \text{LTV}_{30d} \cdot \text{ROI}_{\text{target}}
$$

### 12.4 排序键

$$
\text{排序} = (\text{active}, \text{priorityWeight}) \quad \text{降序}
$$

### 12.5 活跃度

来源：`monetization_backend.py` `_compute_user_profile`。

```
activityScore = 0.6 · min(1, recent_7d_games / 7) + 0.4 · (recent_7d_games > 0 ? 1 : 0)
```

### 12.6 模型化动作门控

```
allowInterstitial = !protectPayer
                  && !suppressAll
                  && !suppressInterstitial
                  && interstitialPropensity >= 0.45

allowRewarded     = !suppressAll
                  && !suppressRewarded
                  && rewardedAdPropensity >= 0.45
```

---

## 13. 完整参数表

### 13.1 鲸鱼分

| 参数 | 默认 | 来源 |
|------|------|------|
| `best_score_norm` 权重 | 0.40 | DB / 默认 |
| `total_games_norm` 权重 | 0.30 | DB / 默认 |
| `session_time_norm` 权重 | 0.30 | DB / 默认 |
| `bestScore 归一` | / 2000 | `signalNorms.bestScore` |
| `totalGames 归一` | / 50 | `signalNorms.totalGames` |
| `avgSessionSec 归一` | / 600 | `signalNorms.avgSessionSec` |

### 13.2 阈值

| 参数 | 默认 |
|------|-----|
| `whale.minWhaleScore` | 0.60 |
| `dolphin.minWhaleScore` | 0.30 |
| `frustrationWarning` | 3 |
| `frustrationIapHint` | 4 |
| `frustrationRescue` | 5 |
| `activityLow` | 0.35 |
| `activityHigh` | 0.70 |
| `nearMissRateHigh` | 0.30 |

### 13.3 LTV

| 参数 | 默认 |
|------|------|
| `BASE_LTV_A.ltv30` | 2.5 元 |
| `BASE_LTV_A.ltv60` | 4.0 元 |
| `BASE_LTV_A.ltv90` | 5.2 元 |
| `CONF_HIGH` | 30 局 |
| `CONF_MEDIUM` | 8 局 |
| `roiTarget` (D 类) | 0.60 |
| `roiTarget` (其他) | 0.40 |

### 13.4 5 分群 ARPU

| Segment | 系数 |
|---------|-----|
| A | 1.00 |
| B | 2.64 |
| C | 9.00 |
| D | 5.56 |
| E | 0.27 |

### 13.5 渠道

| Channel | 系数 |
|---------|-----|
| applovin | 1.40 |
| unity | 1.35 |
| ironsource | 1.30 |
| mintegral | 1.25 |
| facebook | 1.20 |
| google_uac | 1.15 |
| organic | 1.05 |
| unknown | 1.00 |

### 13.6 广告频次（adTrigger.AD_CONFIG）

| 格式 | maxPerGame | maxPerDay | cooldownMs | 其它 |
|------|------------|-----------|------------|------|
| rewarded | 3 | 12 | 90 000 | — |
| interstitial | — | 6 | 180 000 | minSessionsBeforeFirst = 3 |

补充：`strategyConfig.frequency.experienceRecoveryBelow = 60`（广告体验分低于此值进入恢复期，抑制广告）。

### 13.7 CommercialModelVector 配置

来源：`web/src/monetization/strategy/strategyConfig.js → commercialModel`，线上可由后端 `mon_model_config` 深合并覆盖。新增字段必须同步 `strategyHelp.js → model.*`。

| 分组 | 参数 | 默认 | 用途 |
|------|------|------|------|
| `commercialModel` | `version` | 1 | 模型配置版本 |
| `commercialModel` | `ltvNormMax` | 20 | `ltv30` 归一化分母 |
| `ltvConfidence` | high / medium / low | 0.9 / 0.6 / 0.25 | LTV 置信度映射 |
| `bands` | high / mid | 0.72 / 0.42 | 输出分数分档 |
| `baseline` | `payerBlendScale` | 0.35 | 服务端/离线 payer baseline 融合比例 |
| `adFatigue` | `rewardedMax` / `interstitialMax` | 12 / 6 | 广告疲劳归一化 |
| `adFatigue.weights` | experience / rewardedCount / interstitialCount | 0.5 / 0.2 / 0.3 | `adFatigueRisk` 加权 |
| `payerScoreWeights` | whaleScore / ltvScore / activityScore / skillScore | 0.34 / 0.28 / 0.18 / 0.10 | `payerScore` 主体加权 |
| `payerScoreWeights` | segmentWhaleBonus / segmentDolphinBonus | 0.10 / 0.04 | 分群附加分 |
| `churnRiskWeights` | inactivity / frustration / anxiousFlow / flowRelief / frustrationAvg / adFatigue | 0.26 / 0.24 / 0.18 / -0.08 / 0.12 / 0.20 | `churnRisk` 加权 |
| `propensityWeights.iap` | payerScore / frustration / boredFlow / anxiousFlow / ltvConfidence / adFatigue | 0.55 / 0.15 / 0.10 / 0.05 / 0.10 / -0.08 | `iapPropensity` 加权 |
| `propensityWeights.rewarded` | nonPayer / nearMissRate / hadNearMiss / frustration / lowFatigue | 0.18 / 0.18 / 0.28 / 0.18 / 0.18 | `rewardedAdPropensity` 加权 |
| `propensityWeights.interstitial` | nonPayer / lowChurn / lowFatigue / flowPenalty / minnowBonus | 0.36 / 0.22 / 0.22 / -0.18 / 0.16 | `interstitialPropensity` 加权 |
| `norms` | frustrationIap / frustrationRewarded / frustrationChurn | 5 / 5 / 6 | 挫败信号归一化 |
| `guardrail` | protectPayerScore / suppressInterstitialPayerScore | 0.68 / 0.55 | 付费用户保护与插屏抑制 |
| `guardrail` | suppressInterstitialChurnRisk / suppressInterstitialFatigue | 0.62 / 0.55 | 流失/疲劳插屏护栏 |
| `guardrail` | suppressRewardedFatigue / suppressAllFatigue | 0.72 / 0.82 | 激励广告与全部商业化抑制 |
| `actionThresholds` | iapRecommend / rewardedRecommend / interstitialRecommend | 0.68 / 0.55 / 0.50 | 推荐动作阈值 |
| `actionThresholds` | churnTask / lowPayerTask / allowAction | 0.62 / 0.35 / 0.45 | 任务/观察与触发门控阈值 |

---

## 14. 演进与开放问题

### 14.1 已识别的设计权衡

| 决策 | 优势 | 代价 |
|------|------|------|
| 线性 whale_score 而非 ML | 解释 + 零延迟 | 准确度上限 |
| 静态规则矩阵（9 条） | 可解释 + 易测试 | 复杂场景需多条规则组合 |
| 5 分群离线聚类 | 稳定 | 类间漂移需手工调整 |
| LTV 系数硬编码 | 直观 | 需定期回归调系数 |
| Propensity 作为线性加权（非概率） | 零依赖、易上线 | 与真实概率有偏差，需要 isotonic / Platt 校准 |
| 决策记录散落各处 | 实现简单 | 难以做 IPS / 反事实评估，需统一 actionOutcomeMatrix |

### 14.2 候选演进方向

1. **whale_score / 各 propensity → 机器学习**：保持下游不变，替换为
   LightGBM/MTL，输出经 isotonic 校准 → 真实概率
2. **规则发现**：从历史 (snapshot, action, outcome) 三元组中挖掘高 LTV 行为
   模式，自动生成规则候选
3. **多目标优化**：同时优化 ARPU + Retention + Satisfaction（多目标 RL 或 Pareto
   规则筛选）
4. **价格弹性**：从 starter pack / weekly pass 折扣样本估算需求曲线，把
   `priceElasticityModel.recommendDiscount` 接入推荐流

### 14.3 开放研究点

- **冷启动用户**：前 3 局如何更准确预测 LTV
- **跨设备 ID**：同一用户多设备的聚合策略
- **实验设计**：A/B 测试在小样本下如何快速发现显著差异
- **隐私保护**：在不收集 PII 的前提下做精细化分群

---

## 15. 算法层扩展模块

线性引擎之外，仓库提供一组 **opt-in** 的算法层扩展，用于校准、监控、探索与离线模型注入。所有模块默认通过 feature flag 灰度，未启用时不影响原有决策路径。

| 主题 | 模块 | 文件 | 默认 flag |
|------|------|------|-----------|
| 统一特征 | CommercialFeatureSnapshot | `web/src/monetization/commercialFeatureSnapshot.js` | 始终启用 |
| 校准 | propensityCalibrator | `web/src/monetization/calibration/propensityCalibrator.js` | `commercialCalibration=false` |
| 质量监控 | modelQualityMonitor | `web/src/monetization/quality/modelQualityMonitor.js` | `commercialModelQualityRecording=true` |
| 行为-结果 | actionOutcomeMatrix | `web/src/monetization/quality/actionOutcomeMatrix.js` | `actionOutcomeMatrix=true` |
| 漂移监控 | distributionDriftMonitor | `web/src/monetization/quality/distributionDriftMonitor.js` | `distributionDriftMonitoring=true` |
| 探索 | epsilonGreedyExplorer | `web/src/monetization/explorer/epsilonGreedyExplorer.js` | `explorerEpsilonGreedy=false` |
| 多任务 | multiTaskEncoder | `web/src/monetization/ml/multiTaskEncoder.js` | `multiTaskEncoder=false` |
| 弹性定价 | priceElasticityModel | `web/src/monetization/ml/priceElasticityModel.js` | 推理函数（注入式） |
| 价值评估 | zilnLtvModel | `web/src/monetization/ml/zilnLtvModel.js` | 推理函数（注入式） |
| 在线学习 | contextualBandit (LinUCB) | `web/src/monetization/ml/contextualBandit.js` | `adInsertionBandit=false` |
| 推送时机 | survivalPushTiming | `web/src/monetization/ml/survivalPushTiming.js` | 推理函数（注入式） |
| 决策包装 | commercialPolicy.decideAndRecord | `web/src/monetization/commercialPolicy.js` | — |
| churn 权重 | setChurnBlendWeights | `web/src/lifecycle/lifecycleSignals.js` | 始终启用 |

详细架构、公式、训练-推理契约与灰度策略见独立设计文档
[`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md)。

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 算法手册总索引 |
| [`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md) | 商业化模型架构设计（snapshot / 校准 / MTL / 漂移 / bandit / 决策包装） |
| [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) | 实时信号与玩家画像上游 |
| [`../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) | MonetizationBus 事件契约 |
| [`../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md`](../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md) | 生命周期数据 → 策略分层 |
| [`../operations/MONETIZATION.md`](../operations/MONETIZATION.md) | 商业化系统全景与 API |
| [`../operations/MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) | MonPanel 字段、界面与调试 |
| [`../operations/MONETIZATION_CUSTOMIZATION.md`](../operations/MONETIZATION_CUSTOMIZATION.md) | 策略定制指南 |
| [`../operations/COMMERCIAL_STRATEGY_REVIEW.md`](../operations/COMMERCIAL_STRATEGY_REVIEW.md) | 商业化系统能力总览 |
| [`../operations/COMMERCIAL_OPERATIONS.md`](../operations/COMMERCIAL_OPERATIONS.md) | 运营视角参考分析 |
| [`../domain/COMPETITOR_USER_ANALYSIS.md`](../domain/COMPETITOR_USER_ANALYSIS.md) | 竞品分群数据来源 |
