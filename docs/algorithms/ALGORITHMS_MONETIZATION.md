# 商业化推断：算法工程师手册

> 本文是 OpenBlock **商业化算法子系统**的统一手册。  
> 范围：分群（whale_score）/ 实时策略引擎 / LTV 预测 / 与买量出价的接口。  
> 与现有文档的关系：本文是 `MONETIZATION.md` / `MONETIZATION_TRAINING_PANEL.md` / `MONETIZATION_CUSTOMIZATION.md` 的**算法侧深化**——补充被简化的公式、阈值默认值与代码事实。

---

## 目录

1. [问题域与分层架构](#1-问题域与分层架构)
2. [鲸鱼分模型（whale_score）](#2-鲸鱼分模型whale_score)
3. [实时信号体系](#3-实时信号体系)
4. [策略规则引擎（L2）](#4-策略规则引擎l2)
5. [active 判定与排序](#5-active-判定与排序)
6. [whyLines 推理摘要](#6-whylines-推理摘要)
7. [LTV 预测器](#7-ltv-预测器)
8. [广告触发与 Cap 算法](#8-广告触发与-cap-算法)
9. [配置覆盖与热更新](#9-配置覆盖与热更新)
10. [缓存与一致性](#10-缓存与一致性)
11. [完整公式速查](#11-完整公式速查)
12. [完整参数表](#12-完整参数表)
13. [演进与开放问题](#13-演进与开放问题)

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
│      44 项可定制字段的人类可读说明                             │
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

### 1.3 设计哲学

#### 为什么不用 ML 模型分群

| 选项 | 优势 | 代价 |
|------|------|------|
| 线性规则（当前） | 解释性强，调参直观，零延迟 | 准确度上限有限 |
| LightGBM/XGBoost | 准确度高 | 黑盒，需 model store，需训练数据 |
| Deep Learning | 可学复杂特征 | 数据量需求大，部署复杂 |

**结论**：玩家 LTV 是**长尾分布 + 稀疏标签**，规则引擎的边际收益高于 ML。  
未来可在**规则不变的前提下**，把 `whale_score` 替换为 ML 模型输出（保持下游不动）。

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

| 规则 ID | Segment | 触发条件 | Action | Priority |
|--------|--------|---------|--------|----------|
| whale_default_monthly | whale | always | iap.monthly_pass | high |
| whale_no_interstitial | whale | always | ads.none | high |
| whale_hint_pack_on_frustration | whale | frustration ≥ 5 | iap.hint_pack_5 | high |
| dolphin_rewarded_near_miss | dolphin | hadNearMiss | ads.rewarded | high |
| dolphin_weekly_pass | dolphin | active_30d | iap.weekly_pass | medium |
| minnow_interstitial | minnow | game_over | ads.interstitial | medium |
| minnow_rewarded_revive | minnow | game_over + revive | ads.rewarded | medium |
| activity_low_pushback | any | activity < 0.35 | push.recall | low |
| flow_anti_interstitial | any | flowState=flow | ads.suppress | high |

可通过 `setStrategyConfig({ rules: [...] })` 整体替换或 `registerStrategyRule(rule)` 增量。

### 4.4 优先级权重

```js
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
```

排序逻辑：

```
排序键 = (active DESC, priority DESC, ruleId ASC)
```

`active = true` 始终在前。

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

### 6.2 生成逻辑（5 个分组）

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
    let base = min(1.3, 0.6 + games * 0.02);  // 5 局后 +1%/局
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
    if (segment === 'E') return 0.5;     // 特殊：高技能低付费
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

## 8. 广告触发与 Cap 算法

详见 `web/src/monetization/adTrigger.js`，本节做算法摘要。

### 8.1 频次控制（Cap）

```
const FREQUENCY = {
    interstitial: { 
        per_session: 3,           // 单局最多 3 次
        min_interval_sec: 60      // 间隔 60s
    },
    rewarded: { 
        per_session: 10,          // 激励无强 cap
        min_interval_sec: 0
    }
};
```

### 8.2 触发逻辑

```
trigger(format, context) {
    if (atomic_cooldown) return false;
    if (count >= cap.per_session) return false;
    if (segment === 'whale' && format === 'interstitial') return false;
    
    if (context === 'near_miss' && format === 'rewarded') {
        return shouldTriggerRule('dolphin_rewarded_near_miss', { persona, realtime });
    }
    if (context === 'game_over' && format === 'interstitial') {
        return true;
    }
    return false;
}
```

### 8.3 与策略引擎的解耦

`adTrigger` **不**直接读规则；通过 `shouldTriggerRule(ruleId, ctx)` 询问。  
好处：改 rule 时无需改 trigger 代码。

---

## 9. 配置覆盖与热更新

### 9.1 配置层级

```
默认 (DEFAULT_STRATEGY_CONFIG)
   ↓ deep merge
后端覆盖 (mon_model_config 表 / GET /api/mon/model/config)
   ↓ deep merge
A/B 实验覆盖 (实验组特有)
   ↓
最终运行时配置
```

### 9.2 热替换 API

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

### 9.3 数组语义

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

### 9.4 持久化

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

## 10. 缓存与一致性

### 10.1 缓存层级

```
L0: PlayerProfile 内存（实时）
L1: localStorage（端侧，跨刷新）
L2: SQLite mon_user_segments（后端，共享）
L3: 后端聚合统计 user_stats（每日 cron 重建）
```

### 10.2 失效策略

| 缓存 | TTL | 失效触发 |
|------|-----|---------|
| `_cachedHistorical` | 永久 | session 结束 / ingestStats |
| `mon_user_segments` | 1h | _compute_user_profile 重算 |
| `user_stats` | 24h | 定时任务 |

### 10.3 一致性保证

- **最终一致**：实时信号优先级 > 持久画像
- **谁是真相源**：DB 聚合 > 客户端 localStorage
- **冲突解决**：本地 toJSON/load 仅做加速，启动时拉服务端覆盖

---

## 11. 完整公式速查

### 11.1 鲸鱼分

$$
\text{whale\_score} = 0.4 \cdot \min(1, \tfrac{S}{2000}) + 0.3 \cdot \min(1, \tfrac{G}{50}) + 0.3 \cdot \min(1, \tfrac{T}{600})
$$

### 11.2 LTV

$$
\text{LTV}_{30d} = 2.5 \cdot c_{\text{seg}} \cdot c_{\text{chan}} \cdot c_{\text{act}} \cdot c_{\text{skill}}
$$

### 11.3 出价

$$
\text{bid} = \text{LTV}_{30d} \cdot \text{ROI}_{\text{target}}
$$

### 11.4 排序键

$$
\text{排序} = (\text{active}, \text{priorityWeight}) \quad \text{降序}
$$

### 11.5 活跃度

```
activityScore = 0.6 · min(1, recent_7d_games / 7) + 0.4 · (streak > 0 ? 1 : 0)
```

---

## 12. 完整参数表

### 12.1 鲸鱼分

| 参数 | 默认 | 来源 |
|------|------|------|
| `best_score_norm` 权重 | 0.40 | DB / 默认 |
| `total_games_norm` 权重 | 0.30 | DB / 默认 |
| `session_time_norm` 权重 | 0.30 | DB / 默认 |
| `bestScore 归一` | / 2000 | `signalNorms.bestScore` |
| `totalGames 归一` | / 50 | `signalNorms.totalGames` |
| `avgSessionSec 归一` | / 600 | `signalNorms.avgSessionSec` |

### 12.2 阈值

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

### 12.3 LTV

| 参数 | 默认 |
|------|------|
| `BASE_LTV_A.ltv30` | 2.5 元 |
| `BASE_LTV_A.ltv60` | 4.0 元 |
| `BASE_LTV_A.ltv90` | 5.2 元 |
| `CONF_HIGH` | 30 局 |
| `CONF_MEDIUM` | 8 局 |
| `roiTarget` (D 类) | 0.60 |
| `roiTarget` (其他) | 0.40 |

### 12.4 5 分群 ARPU

| Segment | 系数 |
|---------|-----|
| A | 1.00 |
| B | 2.64 |
| C | 9.00 |
| D | 5.56 |
| E | 0.27 |

### 12.5 渠道

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

### 12.6 频次

| 格式 | per_session | min_interval |
|------|-------------|--------------|
| interstitial | 3 | 60s |
| rewarded | 10 | 0 |
| native | 5 | 30s |

---

## 13. 演进与开放问题

### 13.1 已识别的设计权衡

| 决策 | 优势 | 代价 |
|------|------|------|
| 线性 whale_score 而非 ML | 解释 + 零延迟 | 准确度上限 |
| 9 条静态规则 | 可解释 + 易测试 | 复杂场景需多条规则组合 |
| 5 分群离线聚类 | 稳定 | 类间漂移需手工调整 |
| LTV 系数硬编码 | 直观 | 需定期回归调系数 |

### 13.2 v4 候选改进

1. **whale_score → ML 预测**：保持下游不变，替换为 LightGBM
2. **规则学习**：用历史数据自动发现 high-LTV 行为模式 → 自动生成规则候选
3. **分时优化**：不同时段（早晨 / 夜晚）的规则权重不同
4. **多目标优化**：同时优化 ARPU + Retention + Satisfaction（多目标 RL）

### 13.3 开放研究点

- **冷启动用户**：前 3 局如何更准确预测 LTV？
- **跨设备 ID**：同一用户多设备如何聚合？
- **实验设计**：A/B 测试在小样本下如何快速发现显著差异？
- **隐私保护**：在不收集 PII 的前提下做精细化分群

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 总索引 |
| [`MONETIZATION.md`](../operations/MONETIZATION.md) | 商业化 v3 全景 |
| [`MONETIZATION_TRAINING_PANEL.md`](../operations/MONETIZATION_TRAINING_PANEL.md) | 面板设计/原理/策略五维 |
| [`MONETIZATION_CUSTOMIZATION.md`](../operations/MONETIZATION_CUSTOMIZATION.md) | 三层定制指南 |
| [`COMMERCIAL_OPERATIONS.md`](../operations/COMMERCIAL_OPERATIONS.md) | 运营视角 |
| [`COMPETITOR_USER_ANALYSIS.md`](../domain/COMPETITOR_USER_ANALYSIS.md) | 竞品分群数据来源 |
| [`MONETIZATION_PERSONALIZATION.md`](../archive/MONETIZATION_PERSONALIZATION.md) | 历史归档 |
| [`ALGORITHMS_PLAYER_MODEL.md`](./ALGORITHMS_PLAYER_MODEL.md) | 实时信号上游 |

---

> 最后更新：2026-04-27 · 与 v3 商业化分层架构对齐  
> 维护：算法工程团队
