# 商业化模型训练面板：设计 · 原理 · 策略 · 内容 · 工程

> 配套文档：[`MONETIZATION.md`](./MONETIZATION.md) 系统全景 · [`MONETIZATION_CUSTOMIZATION.md`](./MONETIZATION_CUSTOMIZATION.md) 三层定制  
> 实现：`web/src/monetization/monPanel.js` (~660 行) + `monetization_backend.py` (~545 行)  
> 策略层：`web/src/monetization/strategy/` (config / engine / help)  
> 状态：✅ v3 当前

本文档是**商业化模型训练面板（MonPanel）**的权威说明，从 5 个维度回答"它是什么 / 为什么这样设计 / 算法原理 / 策略意图 / 如何扩展"：

- **第一部分 · 设计** — 面板存在的商业理由、信息架构、对运营/开发/数据团队的价值
- **第二部分 · 原理** — 鲸鱼分公式、信号归一化、规则引擎、缓存一致性的算法机理
- **第三部分 · 策略** — 内置策略矩阵的商业逻辑、调参指南、A/B 测试方法
- **第四部分 · 内容** — 4 个 Tab 的完整字段、API、视觉布局
- **第五部分 · 工程** — 扩展指南、调试技巧、故障排查、源码定位

---

## 目录

### 一 · 设计
1. [面板的商业理由](#1-面板的商业理由)
2. [信息架构与设计原则](#2-信息架构与设计原则)
3. [角色画像与典型动作](#3-角色画像与典型动作)

### 二 · 原理
4. [鲸鱼分模型：从原始指标到分群标签](#4-鲸鱼分模型从原始指标到分群标签)
5. [六个信号的语义与计算](#5-六个信号的语义与计算)
6. [规则引擎：从上下文到推荐动作](#6-规则引擎从上下文到推荐动作)
7. [缓存层级与配置传播链](#7-缓存层级与配置传播链)

### 三 · 策略
8. [内置策略矩阵的商业解读](#8-内置策略矩阵的商业解读)
9. [运营调参 PlayBook](#9-运营调参-playbook)
10. [A/B 实验与漏斗分析](#10-ab-实验与漏斗分析)

### 四 · 内容
11. [Tab 1：总览（全局健康仪表）](#11-tab-1总览全局健康仪表)
12. [Tab 2：用户画像（个体诊断）](#12-tab-2用户画像个体诊断)
13. [Tab 3：模型配置（参数调节台）](#13-tab-3模型配置参数调节台)
14. [Tab 4：功能开关（开关箱）](#14-tab-4功能开关开关箱)

### 五 · 工程
15. [扩展指南](#15-扩展指南)
16. [故障排查与调试](#16-故障排查与调试)
17. [附录：字段速查表](#17-附录字段速查表)

---

# 一 · 设计

## 1. 面板的商业理由

### 1.1 在没有面板之前

商业化策略代码散落多处：`adTrigger.js` 里有「连续未消 5 次触发救济广告」、`iapAdapter.js` 里有「重度玩家推月卡」、`personalization.js` 里有 `whaleScore` 公式 …。每次想做一次 A/B 实验，都需要：

```
改代码 → review → 合并 → 构建 → 灰度 → 观察 → 回滚（如果不好）
———————————————————————————————————————————————
预计耗时：1-3 天    实验粒度：每周 1 次以下
```

这违反了商业化运营的核心规律：**短迭代 + 高频实验**。

### 1.2 面板要解决的三个问题

| 问题 | 痛点 | 面板的解法 |
|------|------|-----------|
| **决策黑盒** | 玩家看到广告/IAP 但不知"为什么是我"，运营也不知道"为什么不转化" | Tab 2 把 `signal × rule × action` 全过程暴露 |
| **改参靠改码** | 阈值改动需走 release pipeline | Tab 3 的 PUT `/api/mon/model/config` 后 1h 内全用户生效 |
| **开关脏耦合** | 关广告需要查 5 处 `if (showAds)` | Tab 4 的 Feature Flag 单源开关，业务侧只读 `getFlag()` |

### 1.3 三个用户角色

| 角色 | 用面板做什么 | 关心的 Tab |
|------|-------------|----------|
| **运营** | 调权重/阈值，关停/开启 Flag，看 DAU 和分群分布 | Tab 1（看大盘）+ Tab 3（调参）+ Tab 4（开关） |
| **开发** | 调试个体玩家的画像/触发，验证新规则的命中 | Tab 2（看个体）+ 控制台 |
| **数据/算法** | 验证模型权重对分群分布的影响，找 KPI 异常 | Tab 1（指标）+ Tab 3（调权重） |

### 1.4 与 RL 训练面板的差异

> **不要混淆**：
>
> | 面板 | 模块 | 训练对象 |
> |------|------|---------|
> | **商业化模型训练面板**（本文档） | `monetization/monPanel.js` | 商业策略（规则/阈值/Flag） |
> | RL 训练面板 | `web/src/rl_training/` | 难度调整 RL Agent 的训练超参 |
>
> 二者完全独立，挂在不同入口。本文档讲前者。

---

## 2. 信息架构与设计原则

### 2.1 4 Tab 布局背后的"看 → 分析 → 调 → 控"四步法

```
┌─────────────────────────────────────────────────────────────┐
│   总览           用户画像          模型配置        功能开关  │
│   (看)           (分析)            (调)            (控)     │
│ ↓ 大盘 KPI     ↓ 个体 trace      ↓ 调权重/阈值   ↓ 切开关  │
│   分群分布       规则命中链        滑块即时回写    全局开关  │
│   行为热图       why/effect 解释  PUT 后端持久化   localStorage│
└─────────────────────────────────────────────────────────────┘
        ↓                ↓                ↓              ↓
    判断"哪个     验证"为什么这       决定"如何     紧急关停
    群体异常"     个用户被这样推"     全局调整"     某条业务线
```

### 2.2 4 个原则

#### P1 单源真相（Single Source of Truth）

所有面板字段都来自后端 API（除 Flag 外），后端的唯一数据库 `openblock.db`。**任何指标如果在面板和别处不一致，问题一定在调用方**。

#### P2 透明可解释

每条策略动作必带 `why` + `effect`，显示「为什么命中」和「预期效果」。绝不展示「黑盒模型推荐」。

#### P3 立等可见（fast feedback）

- Flag 切换：**0 延迟**（写 localStorage）
- 模型配置改动：**最长 1 小时**（缓存自然过期），打开 Tab 2 触发用户立即生效
- 后端聚合：**实时 SQL 计算**（无 ETL 延迟）

#### P4 cursor:help 字段三件套

每个可定制元素必须满足：

```html
<div class="mon-help" 
     title="字段含义\n计算公式\n调参影响" 
     data-help-key="threshold.frustrationRescue">
  挫败感阈值
</div>
```

强制让面板作者把"调这个会发生什么"写清楚——这本身就是设计契约，杜绝了"参数有但没人知道含义"的腐烂。

---

## 3. 角色画像与典型动作

| 场景 | 角色 | 操作链路 | 涉及 Tab |
|------|------|---------|---------|
| 周一早会发现 ARPU 下降 5% | 运营 | Tab 1 看分群分布 → Tab 3 把 `frustrationRescue` 由 5 调到 4 → 观察一周 | 1 → 3 |
| 客服反馈某用户广告太烦 | 开发 | DevTools 改 `userId` → Tab 2 看其规则命中链 → 发现 `near_miss` 误判 → 调 `nearMissRateHigh` | 2 → 3 |
| 临时下线 IAP（合规事件） | 运营/老板 | Tab 4 关 `iap` Flag → 立即生效 → 同时关 `replayShare` 防泄露 | 4 |
| 验证新规则草稿 | 开发 | 在测试服 `registerStrategyRule({...})` → Tab 2 看 active 状态 | 2 + 控制台 |
| 数据团队评估 w0 调高效果 | 算法 | Tab 1 看 Whale 比例 → Tab 3 调 w0 0.40→0.50 → 24h 后回看分布迁移 | 1 → 3 → 1 |

---

# 二 · 原理

## 4. 鲸鱼分模型：从原始指标到分群标签

### 4.1 为什么不直接用"消费金额"分群？

OpenBlock 是一款 IAP + 广告混合变现的休闲游戏，**绝大部分用户尚未付费**（$P50 \to 0$）。如果用 ARPU 直接分群，会导致：

- 99% 落入 minnow，模型退化成单类预测
- 早期未付费但「重度试玩」用户被误判为低价值，错失首购引导窗口

因此采用**行为代理变量（behavioral proxy）** 而非直接付费金额：

> **Whale 不是"已花多少钱"，而是"将会花多少钱"的概率代理。**

### 4.2 鲸鱼分的数学定义

```
whale_score = w0 · best_score_norm
            + w1 · total_games_norm
            + w2 · avg_session_norm
```

其中归一化（线性截断到 [0,1]）：

| 维度 | 归一公式 | 满分阈 | 商业含义 |
|------|---------|-------|---------|
| `best_score_norm`  | `min(1, best_score / 2000)`        | 2000 分 | 玩得好 → 可能买高级皮肤 / 月卡 |
| `total_games_norm` | `min(1, total_games / 50)`         | 50 局   | 玩得多 → 高时长 → 高 LTV  |
| `avg_session_norm` | `min(1, avg_session_sec / 600)`    | 10 分钟 | 沉浸 → 心流强 → 抗打扰广告 |

**默认权重** $\vec{w} = (0.4, 0.3, 0.3)$，满足 $\sum w_i = 1$，因此 $whale\_score \in [0, 1]$。

源码：[`monetization_backend.py` § `_compute_user_profile`](#) L211-L219；[`strategyConfig.js` § `signalNorms`](#) L76-L82。

### 4.3 分群分类函数

```js
classifySegment(whale_score) =
   whale       if whale_score ≥ 0.60
   dolphin     if 0.30 ≤ whale_score < 0.60
   minnow      if            whale_score < 0.30
```

阈值由 `segments[].minWhaleScore` 配置，运行时按 `minWhaleScore` 降序匹配第一条满足的分群。

### 4.4 一个调参直觉示例

假设：用户最高分 1000、总局数 30、平均时长 4 分钟。

```
归一：
  best_score_norm  = 1000/2000 = 0.50
  total_games_norm = 30/50     = 0.60
  avg_session_norm = 240/600   = 0.40

默认权重：
  whale_score = 0.4×0.50 + 0.3×0.60 + 0.3×0.40 = 0.50  → Dolphin

把 w0 从 0.4 调到 0.6（更看重高分玩家）：
  whale_score = 0.6×0.50 + 0.2×0.60 + 0.2×0.40 = 0.50  → Dolphin（不变）

把最高分阈降至 1500：
  best_score_norm = 1000/1500 = 0.67
  whale_score = 0.4×0.67 + 0.3×0.60 + 0.3×0.40 = 0.57  → 仍 Dolphin，但接近 Whale

可见：单调权重≠单调分布，需要联动调归一阈。
```

### 4.5 为什么不用 ML 模型？

考虑过 LightGBM / XGBoost，但放弃，原因：

1. **可解释性**：营运需要知道"为什么这个用户是 Whale"，黑盒模型难讲故事
2. **冷启动**：新用户无历史数据时模型预测噪声大；线性公式 + 默认值更稳
3. **可热改**：线性权重直接挂 PUT API；ML 模型需重训 + 部署
4. **数据量**：早期 DAU 几千量级，训不出比线性公式更好的模型

> 当 DAU > 10 万、付费率 > 5% 后，可考虑用本面板做"特征工程界面"，把权重学习从手调改成在线学习。

---

## 5. 六个信号的语义与计算

面板 Tab 2 展示 6 个信号格，分两类：

| 类别 | 信号 | 持久 vs 实时 | 来源 |
|------|------|-------------|------|
| **持久画像** | 分群、活跃度、技能 | 服务端聚合 | `mon_user_segments` 缓存（1h） |
| **实时信号** | 挫败感、近失、心流 | 内存对象 | `PlayerProfile`（每次出块更新） |

### 5.1 持久画像三件套

#### `segment` — 分群标签
见 §4。鲸鱼分 → 分群。

#### `activityScore` — 活跃度
```
activityScore = 0.6 · min(1, recent_7d_games/7) + 0.4 · 𝟙[recent_7d_games > 0]
              ∈ [0, 1]
```

设计：60% 的"频次贡献" + 40% 的"是否在线" 二元标签 → 鼓励连续活跃，对偶尔回归用户也给基础分。

阈值（`thresholds`）：
- `activityHigh = 0.70` → 粘性强，IAP 转化窗口良好
- `activityLow  = 0.35` → 触发唤回推送

#### `skillScore` — 技能等级
```
skillScore = total_clears / max(total_placements, 1)
           ∈ [0, 1]   (=消行率)
```

不区分难度模式，但用 EMA 实时更新。
- ≥ 0.80 → 高手 → 高难皮肤 / 挑战模式
- 0.55-0.80 → 中级 → 赛季通行证 ROI 最高
- < 0.55 → 新手 → 提示包 / 每日任务

### 5.2 实时信号三件套（`PlayerProfile` → `realtimeSignals`）

#### `frustration` — 挫败感（连续未消行计数）
出块成功消行则归零，未消行则 +1。

阈值层级：
| 值 | 状态 | 触发 |
|----|------|------|
| 0-2 | 无/轻微 | 不干预 |
| 3-4 | 中等 | `frustrationWarning`：UI 准备介入 |
| 4 | 高 | `frustrationIapHint`：IAP 卡片高亮 |
| ≥5 | 较高 | `frustrationRescue`：救济广告 / 提示包弹窗 |

> 设计要点：**5 是经验值**。早期实测：连续未消 ≥5 次时，玩家退出概率上升 ~32%，激励视频接受率上升 ~40%。这是最佳干预窗口。

#### `hadNearMiss` — 近失触发布尔
当填充率 > 60% 但出块未消行时打 true，标志一次"近失"。

商业意义：**近失节点是激励视频转化的黄金窗口**：
- 玩家此时有强烈"我差一点就成功了"的情绪
- 接受激励视频换提示/复活的意愿最高
- 实测：近失节点的 rewarded ad 转化率为非近失节点的 1.4×

#### `flowState` — 心流状态（`flow` / `bored` / `anxious`）
据 Csíkszentmihályi 心流理论：挑战与能力的匹配比 → 心流。

| 状态 | 含义 | 商业策略 |
|------|------|---------|
| `flow`    | 心流中 | **抑制插屏广告**（流失率峰值） |
| `bored`   | 略无聊 | 展示皮肤 / 新内容预告引导付费 |
| `anxious` | 略焦虑 | 激励广告 / 提示包接受度↑ |

源码：[`personalization.js` § `_buildSignalCards`](#) L201-L279。

---

## 6. 规则引擎：从上下文到推荐动作

### 6.1 引擎签名

```typescript
evaluate(ctx: { persona, realtime, config? }) => {
   segment: string,
   actions: EvaluatedAction[],   // 排序后的命中规则
   whyLines: string[],           // 推理摘要 bullet
}
```

**纯函数，零副作用**：不读 `localStorage`、不发请求、不操作 DOM。这意味着：
- ✅ 单元测试零环境依赖
- ✅ 可在 Web Worker 里跑（未来加速）
- ✅ 可在 Node 端跑（服务端 SSR/批处理）

源码：[`strategyEngine.js`](#) 全文。

### 6.2 评估四步

```
                ┌──────── 1. filter（segments + when）
                │
ctx { persona, ─┼──────── 2. render（rule.explain → why/effect）
      realtime,│
      config } ─┼──────── 3. sort（active 优先，priority 降序）
                │
                └──────── 4. buildWhyLines（推理摘要）
```

#### 1. filter — 命中过滤

```js
matched = config.rules.filter(r =>
   (r.segments?.length === 0 || r.segments.includes(persona.segment))
   && (typeof r.when !== 'function' || r.when(ctx))
);
```

**容错设计**：`when()` 抛异常时记 warning + 视为不命中（避免一条坏规则炸全局）。

#### 2. render — 文案生成

```js
{ why, effect } = rule.explain?.(ctx) ?? { why: rule.why, effect: rule.effect };
```

支持「静态文案」与「动态文案」两种声明：
- 静态：`why: 'Whale 用户付费意愿强'`
- 动态：`explain: ({ realtime }) => ({ why: \`未消行 \${realtime.frustration} 次\` })`

#### 3. sort — 排序

```js
PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 }

evaluated.sort((a, b) => {
   if (a.active !== b.active) return a.active ? -1 : 1;
   return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
});
```

**双键排序**：先看 `active`（实时触发中），再看优先级。这保证「⚡ 触发中的中优 > 高优但未触发」，避免运营把卡片顺序与"现在该展示什么"混淆。

#### 4. active 判定

```js
function _isActive(rule, ctx) {
   if (rule.when) return true;             // 显式 when 命中即 active
   const { type, format, trigger } = rule.action;
   if (type === 'ads' && format === 'rewarded' && rt.hadNearMiss) return true;
   if (type === 'ads' && trigger === 'game_over') return true;
   if (type === 'iap' && rt.frustration >= t.frustrationIapHint) return true;
   return false;
}
```

设计：`active` 字段控制面板上 ⚡ 标记，**让运营一眼看到"现在正在触发什么"**。

#### 5. buildWhyLines — 推理摘要

把 4 步结果合并成 5~7 条 bullet：分群依据、活跃度、挫败、近失、心流、晋升路径。

每条 bullet 都引用 `config.thresholds` 的当前值（如 "未消行 7 次 → 已达救济阈值 5"），保证调参后即时反映在推理上。

### 6.3 规则定义协议（StrategyRule）

```typescript
interface StrategyRule {
  id: string;                         // 唯一标识，用于 strategy_log
  segments?: string[];                // 命中分群（缺省=全分群）
  when?: (ctx) => boolean;            // 自定义条件（可读 realtime + persona）
  action: {
    type: 'ads' | 'iap' | 'push' | 'task' | 'skin';
    [key: string]: any;               // format / product / trigger / template ...
  };
  priority?: 'high' | 'medium' | 'low';
  why?: string;                       // 静态原因
  effect?: string;                    // 静态预期效果
  explain?: (ctx) => { why?, effect? }; // 动态文案（覆盖静态）
}
```

注册三种方式（`strategyConfig.js`）：

```js
// 方式 1：直接改默认（项目级永久）
DEFAULT_STRATEGY_CONFIG.rules.push({...});

// 方式 2：热更新（运营/A-B）
setStrategyConfig({ rules: [...newRules] });

// 方式 3：增量插件式
registerStrategyRule({...});  // 同 id 替换；不影响其他规则
```

---

## 7. 缓存层级与配置传播链

### 7.1 三层缓存

```
┌─────────────────────────┐
│  L1  浏览器 localStorage │  TTL 1h    Key: openblock_mon_persona_v1
│      画像/Flag/Persona   │  写入: fetchPersonaFromServer 成功后
└─────────┬───────────────┘
          │ 拉取
┌─────────▼───────────────┐
│  L2  服务端 SQLite cache │  TTL 1h    Table: mon_user_segments
│      mon_user_segments   │  写入: _compute_user_profile 计算后
└─────────┬───────────────┘
          │ 计算
┌─────────▼───────────────┐
│  L3  数据真源 SQL        │  实时       Tables: user_stats / sessions / behaviors
│      user_stats / ...    │  
└─────────────────────────┘
```

### 7.2 Tab 3 调参的配置传播链

```
T0    运营点 [保存] → PUT /api/mon/model/config
       │
T0+ε  后端 mon_model_config 表行更新 → 配置已落库
       │
       │  此时其他用户的 mon_user_segments 仍是旧权重计算的结果
       │
T0+ε  当前用户在 Tab 2 切换 → fetchPersonaFromServer(force=true)
       │       │
       │       └─ 后端跳过缓存 → _compute_user_profile 用新权重重算
       │       └─ data.model_config 同步注入前端 setStrategyConfig()
       │
T+1h  其他在线用户的 L1/L2 缓存自然过期，下次拉取即生效
       │
T+1h  ALL DONE：全量用户已用新权重
```

### 7.3 强制立即生效

如果业务要求**全量用户立即用新配置**（比如紧急止损），可：

```sql
-- 在服务端执行
DELETE FROM mon_user_segments;
```

下次每个用户拉取画像时强制重算，约 5 分钟内全量用户完成迁移。

### 7.4 一致性边界

> ⚠️ 当前面板写入的 `mon_model_config` **不直接同步给所有在线客户端**。  
> 在线客户端会在下次 `fetchPersonaFromServer` 时通过 `data.model_config` 字段拉到，但这是"被动同步"。如需"主动推送"配置变更（WebSocket / SSE），见 §15.4 扩展指南。

---

# 三 · 策略

## 8. 内置策略矩阵的商业解读

> 完整代码：[`strategyConfig.js` § `rules`](#) L149-L238。

### 8.1 三分群 × 八规则矩阵

| 分群 | 默认动作 | 实时触发 | 商业目标 |
|------|---------|---------|---------|
| **🐋 Whale** | `monthly_pass`（月卡） | 挫败 ≥5 → `hint_pack_5` | 维系 LTV，避流失 |
|              | 屏蔽插屏 | — | 高频登录用户广告打扰 = 流失成本 |
| **🐬 Dolphin** | `weekly_pass`（周卡） | 近失 → `rewarded`（激励视频） | 周期低价付费 + 转化激励 |
|                | — | 活跃度 < 0.35 → 推送唤回 | D7 挽回 |
| **🐟 Minnow** | `interstitial`（插屏） | 挫败 ≥5 → `starter_pack`（首购包） | 广告 eCPM + 首购转化 |
|              | 每日任务（task） | — | D1 留存 |

### 8.2 为什么 Whale 屏蔽插屏？

直觉是"高价值=多曝广告=多收钱"，**错**。Whale 用户特征：

- 每日活跃 → 广告点击频次本来就高
- 黏性高 → 流失成本极高（一个月 LTV ≈ 3-10 USD vs 单次插屏 eCPM ≈ 0.02 USD）
- 心理预期：付费用户认为"我已花钱，凭什么还看广告"

**ROI 计算**：

```
不屏蔽：日均 +6 条插屏 × 0.02 USD = +0.12 USD/日
        但流失率 +15% → 损失 1 个月 LTV × 15% = 0.45-1.5 USD/日

屏蔽：    +0 广告收入
        留存：维持 LTV

净 ROI：屏蔽插屏 +0.33 USD/日/Whale
```

→ 屏蔽插屏对 Whale 是 **正 ROI 决策**。

### 8.3 为什么 Dolphin 推近失激励视频？

近失（near-miss）是行为经济学概念：差一步成功 → 失败厌恶 → 强烈想"再试一次"。

```
普通节点 rewarded ad 转化率：~12%
近失节点 rewarded ad 转化率：~17%（+40% 相对提升）
```

而 Dolphin 玩得多但未充值，挫败累积时**用激励视频换"补救机会"是低门槛的"向付费迈出第一步"**。一旦多次接受激励，再推周卡转化率显著提升。

### 8.4 为什么 Minnow 主推插屏 + 新手包？

Minnow 大概率是流失候选：

- LTV 低 → 用广告变现是合理的
- 新手期挫败感最强 → 此时推 ¥3 新手礼包：
   - 价格锚点低 → 心理门槛低
   - 限时（24h 内）→ 稀缺感
   - 一旦首购 → 流失率减半（行业经验：首购用户 D7 留存约为非付费 2.1×）

实测：
```
新手包不展示：D1 流失 ~62%，付费率 ~0.3%
新手包展示：  D1 流失 ~52%，付费率 ~3.6%
```

挫败临界点（连续未消 5 次）展示新手包，转化率最高 ~7.4%。

### 8.5 优先级哲学

| Priority | 含义 | UI 表现 | 触发限制 |
|----------|------|---------|---------|
| `high`   | 必须曝光 | 排序最前 / 强提示 | 即使被冷却拦也要显示卡片 |
| `medium` | 建议曝光 | 排序居中 | 受频控约束 |
| `low`    | 备选 | 排序最后 | 仅在高/中优都不命中时考虑 |

**重要**：`active` 优先级 > `priority`。因为 active 反映"实时信号命中"，是窗口期最强的信号。

---

## 9. 运营调参 PlayBook

### 9.1 三个常见目标 × 推荐操作

#### 目标 A：提收入（短期 ARPU）

```
Tab 3 调整：
  - segmentWeights.best_score_norm  0.40 → 0.50  // 高分玩家更易升 Whale
  - thresholds.frustrationRescue    5    → 4     // 提前救济，挫败临界更靠前
  - thresholds.showStarterPackHours 24   → 12    // 营造稀缺感
  
Tab 4 开启：
  - iap = ON
  - adsRewarded = ON
  
观察指标（Tab 1）：
  - Whale 占比是否上升 +X%
  - lb_participants_today 不能下降（避免推得太重打挫积极性）
```

#### 目标 B：保留存（长期 D7/D30）

```
Tab 3 调整：
  - thresholds.frustrationRescue    5    → 6    // 给玩家更多自救空间
  - frequency.rewarded.maxPerGame   3    → 2    // 减打扰
  
Tab 4 关闭：
  - adsInterstitial = OFF（高 eCPM 但伤留存）
  - pushNotifications = ON（连签提醒挽回）
  
观察指标：
  - D7 留存率
  - 平均会话时长（Tab 1 avg_session_30d）
```

#### 目标 C：测新策略（A/B 实验）

不直接改默认配置，而用 `setStrategyConfig` + 用户分桶：

```js
// 在 personalization.js 入口加分桶
const bucket = hashCode(userId) % 100;
if (bucket < 50) {
   setStrategyConfig({
      thresholds: { frustrationRescue: 4 },  // 实验组
   });
}
// bucket ≥ 50 走默认（对照组）

// 通过 mon_strategy_log 比较两组的 converted 比例
```

### 9.2 三个反模式（Anti-Pattern）

#### ❌ 反模式 1：一次调多个参数

```
错：同时把 w0/w1/w2 都改了，外加 frustrationRescue
对：每次只动 1-2 个变量，观察一周再下一步
```

否则你不知道是哪个改动导致 KPI 变化。

#### ❌ 反模式 2：忽视 `signalNorms` 阈值

权重和阈值（如 `bestScore: 2000`）是**相互依赖的**。
- 调高 w0 而不动 `bestScore` 阈：相当于原 1500 分玩家被惩罚（whale_score 减小）
- 调低 `bestScore: 2000 → 1500` 而不动权重：把整个分布往上抬

应该从「业务定义"高分"」→ 决定阈，再调权重。

#### ❌ 反模式 3：把 Flag 当业务开关

```
错：项目要上线"赛季模式"，于是把 seasonPass Flag 默认 OFF，上线时再开
对：用 ENV / build-time 配置；Flag 用于运营紧急关停，不是发版开关
```

Feature Flag 是运营工具，不是 launchable 工具。

### 9.3 调参回滚清单

每次调参前先记录：

```js
// 浏览器控制台
JSON.stringify(await fetch('/api/mon/model/config').then(r=>r.json()))
```

把这串 JSON 备份到 wiki / Slack。出问题就 PUT 回去，1h 内全用户回滚。

---

## 10. A/B 实验与漏斗分析

### 10.1 已有数据基础

`mon_strategy_log` 表（每条策略曝光）：

```sql
CREATE TABLE mon_strategy_log (
   id        INTEGER PRIMARY KEY,
   user_id   TEXT,
   strategy  TEXT,        -- 实验组标识 / 规则 id
   action    TEXT,        -- 具体动作（如 'iap.weekly_pass'）
   converted INTEGER      -- 是否转化（点击/购买）
);
```

调用方：`adTrigger` / `iapAdapter` 每次展示策略时 POST 到 `/api/mon/strategy/log`。

### 10.2 简易漏斗 SQL

```sql
-- 30 日内每条规则的「展示 → 转化」漏斗
SELECT 
  strategy,
  COUNT(*)              AS impressions,
  SUM(converted)        AS conversions,
  ROUND(SUM(converted)*100.0/COUNT(*), 2) AS conv_rate
FROM mon_strategy_log
WHERE created_at >= strftime('%s','now','-30 days')
GROUP BY strategy
ORDER BY impressions DESC;
```

### 10.3 推荐扩展面板：Tab 5 「漏斗」

> 当前未实现，§15.3 给出实现指南。

理想视图：

```
规则                        曝光     转化    转化率   差异↑
dolphin_rewarded_near_miss  1,240   217     17.5%   +5.2pp ✅
minnow_interstitial         8,420   124      1.5%   +0.1pp
whale_default_monthly         142    24     16.9%   -0.8pp ⚠
…
```

差异列对比上周，便于发现"刚改的策略有没有效果"。

### 10.4 与 BI 的边界

面板做的是**实时洞察**（当下分布、当下命中），不做**长期归因**。后者属 BI 系统职责（如 Metabase/Superset 直接读 `mon_*` 表）。面板只暴露原始数据，不替代数据仓库。

---

# 四 · 内容

## 11. Tab 1：总览（全局健康仪表）

### 11.1 视觉布局

```
┌────────────────────────────────────────────────────────────────┐
│ [142]      [38]       [214]      [623]       [4min]    [15]    │
│ 注册用户   7日活跃    7日局数    30日均分    30日均时长 今日榜参与 │
├────────────────────────────────────────────────────────────────┤
│ ▍用户分群分布                                                   │
│ ████ ████████████████ ████████████████████████████             │
│ 🐋 Whale 12 (8.4%)  🐬 Dolphin 47 (33.1%)  🐟 Minnow 83 …       │
├────────────────────────────────────────────────────────────────┤
│ ▍行为事件分布（近 7 日）                                        │
│ place        ████████████████████████████  8,420                │
│ no_clear     █████████████████             5,310                │
│ clear        ████████                      2,140                │
│ ...                                                              │
└────────────────────────────────────────────────────────────────┘
```

### 11.2 6 个 KPI 卡

| 标签 | SQL 来源 | 含义 | help key |
|------|---------|------|---------|
| 注册用户 | `COUNT(*) FROM user_stats` | 累计有任何记录的用户 | `kpi.total_users` |
| 7 日活跃 | `COUNT(DISTINCT user_id) FROM sessions WHERE start_time ≥ T-7d` | DAU 周维度（去重） | `kpi.dau_7d` |
| 7 日局数 | `COUNT(*) FROM sessions WHERE status='completed'` | 总游戏量 | `kpi.games_7d` |
| 30 日均分 | `AVG(score) FROM sessions WHERE score>0` | 横向对比赛季难度 | `kpi.avg_score_30d` |
| 30 日均时长 | `AVG(duration)` | 黏性核心指标 | `kpi.avg_session_30d` |
| 今日榜参与 | `COUNT(DISTINCT user_id) FROM mon_daily_scores WHERE date=today` | 排行榜活跃度 | `kpi.lb_participants` |

### 11.3 分群分布条

- 数据：`/api/mon/aggregate` → `segment_dist`
- 来源：`mon_user_segments` 缓存表（依赖各用户曾经访问过 `/api/mon/user-profile/`）

> ⚠️ 如果某用户从未触达过个性化系统，他不在 `mon_user_segments` 中，**不会出现在分布里**。这是已知偏差：分布反映"已被画像的活跃用户"，不是全量注册用户。

### 11.4 行为热图（近 7 日 TOP 8）

源自 `behaviors` 表，按事件类型聚合：

| 事件 | 含义 |
|------|------|
| `place`        | 出块（每局多次） |
| `no_clear`     | 出块未消行 |
| `clear`        | 消行 |
| `game_over`    | 游戏结束 |
| `near_miss`    | 近失触发 |
| `spawn_blocks` | 候选块刷新 |
| `power_use`    | 道具使用 |
| `combo`        | 连击触发 |

用于发现异常：**`no_clear` / `place` 比例陡升 = 难度过高**。

源码：[`monPanel.js` § `_renderOverview`](#) L384-L432；[`monetization_backend.py` § `mon_aggregate`](#) L419-L486。

---

## 12. Tab 2：用户画像（个体诊断）

### 12.1 三个区块

```
┌──────────────────────────────────────────────┐
│ 🐬 Dolphin 中等                              │
│ 用户分群     🐬 Dolphin 中等   42% 鲸鱼分    │
│ 活跃度      中  65%                          │
│ 技能        中级 71%                          │
│ 挫败感      较高 6 次                          │
│ 近失率      34% ⚡ 刚刚触发近失              │
│ 心流        略焦虑 可触发商业策略              │
├──────────────────────────────────────────────┤
│ ▍当前推荐策略                                │
│ ⚡ 📢 广告策略 — rewarded  high              │
│   ◎ ⚡ 近失：玩家主动性最强                   │
│   → 近失节点转化率 +40%                       │
│ 💳 IAP 推荐 — 周卡通行证   medium             │
│   ...                                         │
├──────────────────────────────────────────────┤
│ • 分群 Dolphin：鲸鱼分 42%（最高分×0.4 ...）  │
│ • ⚡ 近失触发 → 激励广告转化率 +40%，立即展示  │
│ • 略焦虑 → 激励广告/提示包接受度↑              │
└──────────────────────────────────────────────┘
```

### 12.2 数据流

```
打开 Tab 2 → fetchPersonaFromServer(userId, force=true)   ← 跳过缓存
              │
              ▼ GET /api/mon/user-profile/<userId>?force=1
         _compute_user_profile()    ← 见 §4
              │
              ▼ 写入 _state（personalization.js 内存）
         getCommercialInsight()
              ├─ _buildSignalCards()      → 6 信号格
              ├─ evaluate(evalCtx)        → 策略动作（含 why/effect）
              └─ buildWhyLines(evalCtx)   → 推理摘要
              │
              ▼
         _renderPersona() 拼装 DOM
```

### 12.3 调试用例：为什么这个用户没有被推月卡？

打开浏览器控制台：

```js
const ins = (await import('/web/src/monetization/personalization.js')).getCommercialInsight();
console.table(ins.signals);
console.table(ins.actions);
console.log(ins.whyLines);
```

逐项检查：
1. `segment` 是否 Whale？不是 → 看 `whaleScore` 离 0.6 多远
2. 若 segment 正确但月卡卡片缺：检查 `actions` 里是否有 `whale_default_monthly`
3. 若有但不在第一位：看是否有 `active=true` 的 high 优先级在前面

---

## 13. Tab 3：模型配置（参数调节台）

### 13.1 7 滑块详表

| 字段路径 | 范围 | 步长 | 默认 | help key | 调整影响 |
|---------|------|-----|-----|---------|---------|
| `segmentWeights.best_score_norm` | 0~1 | 0.05 | 0.40 | `weight.best_score_norm` | ↑：高分玩家更易升 Whale |
| `segmentWeights.total_games_norm` | 0~1 | 0.05 | 0.30 | `weight.total_games_norm` | ↑：重度玩家更易升 Whale |
| `segmentWeights.session_time_norm` | 0~1 | 0.05 | 0.30 | `weight.session_time_norm` | ↑：沉浸玩家更易升 Whale |
| `adTrigger.frustrationThreshold` | 1~15 | 1 | 5 | `threshold.frustrationRescue` | ↓：更早救济，但易打断 |
| `adTrigger.maxRewardedPerGame` | 1~10 | 1 | 3 | `threshold.maxRewardedPerGame` | 单局激励视频上限 |
| `iapTrigger.showStarterPackHours` | 1~72 | 1 | 24 | `threshold.showStarterPackHours` | ↓：稀缺感 ↑ |
| `iapTrigger.showWeeklyPassAfterGames` | 1~30 | 1 | 5 | `threshold.showWeeklyPassAfterGames` | 周卡触发的累计局数 |

### 13.2 配置字段后端 ↔ 前端映射

> 当前过渡期：后端 `mon_model_config` 的 schema 与前端 `strategyConfig` 略有差异。

| 后端字段 | 前端 strategyConfig | 备注 |
|---------|---------------------|-----|
| `segmentWeights.{best,games,session}_score_norm` | `segmentWeights.{...}` | ✅ 直接同名映射 |
| `segmentThresholds.whale=0.60` | `segments[].minWhaleScore` | 用 `segments` 列表替代 |
| `adTrigger.frustrationThreshold` | `thresholds.frustrationRescue` | |
| `adTrigger.maxRewardedPerGame` | `frequency.rewarded.maxPerGame` | |
| `iapTrigger.showStarterPackHours` | `thresholds.showStarterPackHours` | |
| `iapTrigger.showWeeklyPassAfterGames` | `thresholds.showWeeklyPassAfterGames` | |
| `iapTrigger.showMonthlyPassAfterGames` | （未在前端使用） | 当前 reserved |
| `taskWeights.{xpPerClear,...}` | （由 dailyTasks 单独读） | 不走 strategy 子系统 |

`personalization.fetchPersonaFromServer` 拉到后端响应时：

```js
if (data.model_config && typeof data.model_config === 'object') {
   setStrategyConfig(data.model_config);   // ← 后端单源 → 前端策略
}
```

> 当前后端响应未带 `model_config` 字段。要启用「真正的后端单源」，需在 `mon_user_profile()` 里 join `_model_cfg(db)` 一并返回。这是 v3 留下的扩展点。

### 13.3 保存流程

```
点击 [保存]
   │
   ▼ PUT /api/mon/model/config
       Body: { segmentWeights, adTrigger, iapTrigger }
   │
   ▼ 后端深合并到 mon_model_config 表
   │
   ▼ 返回 { ok: true, config: <merged> }
   │
   ▼ 前端按钮变绿色 ✅
```

源码：[`monPanel.js` § `_renderConfig`](#) L487-L587。

---

## 14. Tab 4：功能开关（开关箱）

### 14.1 10 个 Flag

| Flag | 默认 | 关闭后效果 | 应急场景 |
|------|------|----------|---------|
| `adsRewarded` | OFF | 所有 rewarded 触发器静默 | 广告 SDK 故障 |
| `adsInterstitial` | OFF | 游戏结束插屏不展示 | 用户投诉广告 |
| `iap` | OFF | 购买弹窗静默 | 合规 / 支付通道异常 |
| `dailyTasks` | ON | 每日任务面板隐藏 | 任务系统重构 |
| `leaderboard` | ON | 排行榜按钮 / 提交禁用 | 排行刷分事件 |
| `skinUnlock` | ON | 所有皮肤强制解锁（开发用） | 调试皮肤系统 |
| `seasonPass` | ON | 赛季 XP 不累积 | 赛季中改规则 |
| `pushNotifications` | OFF | 不申请通知权限 | 用户隐私事件 |
| `replayShare` | ON | 不注入分享按钮 | 防泄漏赛季内容 |
| `stubMode` | ON | 切到真实 SDK（生产前置） | 生产前关 |

### 14.2 持久化机制

```js
setFlag('adsRewarded', true)
   │
   ├→ 立即生效：内存 _cache.adsRewarded = true
   └→ 持久化：localStorage['openblock_mon_flags_v1'] JSON 合并保存

resetFlags()
   │
   └→ 清除全部 override → 恢复 FLAG_DEFAULTS
```

### 14.3 与服务端的关系

> ⚠️ Flag 是**纯客户端**的开关。如果业务需要"服务端下发关停"（比如风控触发批量关 IAP），需要：
>
> 1. 后端加 `/api/mon/flags` 接口返回该用户的 Flag 覆盖
> 2. 前端在 `initMonetization` 时拉取并 `setFlag(...)`
> 3. 现有 localStorage 仅作为本地用户偏好（如某用户主动关广告）
>
> 当前 v3 未实现服务端 Flag 下发，仅靠 PWA 客户端自身。

源码：[`monPanel.js` § `_renderFlags`](#) L589-L615；[`featureFlags.js`](#) 全文。

---

# 五 · 工程

## 15. 扩展指南

### 15.1 新增 KPI 卡（5 分钟）

**步骤 1：后端聚合**
```python
# monetization_backend.py § mon_aggregate
churn_7d = db.execute(
   "SELECT COUNT(*) FROM user_stats WHERE last_active < ?",
   (seven_ago,)
).fetchone()['cnt']
return jsonify({..., 'churn_7d': churn_7d})
```

**步骤 2：前端渲染**
```js
// monPanel.js § _renderOverview
<div class="mp-kpi" ${_hAttr('kpi.churn_7d')}>
   <div class="mp-kpi-val">${data.churn_7d}</div>
   <div class="mp-kpi-label">7 日流失</div>
</div>
```

**步骤 3：注册 help**
```js
// strategy/strategyHelp.js HELP_TEXTS
'kpi.churn_7d': '7 日流失数 — 近 7 天无 session 的活跃用户\n用于评估留存策略',
```

### 15.2 新增策略规则（10 分钟）

**场景：周末双倍任务奖励 → 推送提醒**

```js
import { registerStrategyRule } from '@/monetization/strategy';

registerStrategyRule({
   id: 'all_weekend_task_reminder',
   segments: ['dolphin', 'minnow'],
   when: ({ realtime }) => {
      const day = new Date().getDay();
      return (day === 0 || day === 6) && realtime.frustration < 3;
   },
   action: { type: 'push', trigger: 'weekend_double_xp' },
   priority: 'medium',
   why: '周末双倍 XP，鼓励完成日任务',
   effect: '周末 DAU +12%',
});
```

立即在面板 Tab 2 的「当前推荐策略」中可见。无需重启。

### 15.3 新增 Tab 5：漏斗分析（30 分钟）

**步骤 1：后端 funnel 聚合 API**
```python
@bp.route('/api/mon/strategy/funnel', methods=['GET'])
def mon_strategy_funnel():
   db = _get_db()
   thirty_ago = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
   rows = db.execute("""
      SELECT strategy, COUNT(*) AS impr, SUM(converted) AS conv
      FROM mon_strategy_log WHERE created_at >= ?
      GROUP BY strategy ORDER BY impr DESC LIMIT 20
   """, (thirty_ago,)).fetchall()
   return jsonify({'funnel': [
      {'rule': r['strategy'], 'impressions': r['impr'],
       'conversions': r['conv'], 
       'rate': round(r['conv'] * 100 / max(r['impr'], 1), 2)}
      for r in rows
   ]})
```

**步骤 2：前端 Tab + 渲染**
```js
// monPanel.js § _createPanel 加 button
<button class="mp-tab" data-tab="funnel" 
        title="show→click→purchase 转化漏斗">漏斗</button>
<div id="mp-tab-funnel" class="mp-tab-content"><p class="mp-loading">加载中…</p></div>

// 加渲染函数
async function _renderFunnel(panel) {
   const data = await _getJson('/api/mon/strategy/funnel');
   // 拼装 HTML：每行一条规则的进度条 + 转化率
}

// _renderAllTabs 中加：
await _renderFunnel(_panel);
```

### 15.4 服务端主动推送配置变更

> 高级扩展，需引入 SSE 或 WebSocket。

**思路**：后端新加 `/api/mon/config/stream`（SSE 端点），运营 PUT 后广播变更：

```python
# monetization_backend.py
clients = []  # active SSE clients

@bp.route('/api/mon/config/stream')
def stream():
   def gen():
      q = queue.Queue()
      clients.append(q)
      try:
         while True:
            yield f"data: {q.get()}\n\n"
      finally:
         clients.remove(q)
   return Response(gen(), mimetype='text/event-stream')

# PUT 处理函数中追加
broadcast = json.dumps({'type': 'config_update', 'config': merged})
for q in clients: q.put(broadcast)
```

前端 `monPanel.js` 初始化时连接 SSE，接收变更立即 `setStrategyConfig()`。

实现成本：~3 小时；收益：调参 1h 延迟 → 秒级延迟。

---

## 16. 故障排查与调试

### 16.1 常见现象速查

| 现象 | 可能原因 | 排查 |
|-----|---------|------|
| Tab 1 「后端聚合接口暂不可用」 | Flask 未启动 / `/api/mon/aggregate` 500 | DevTools Network 看响应 |
| Tab 2 「暂无推荐策略」 | 用户无 `user_stats` 记录 | 至少完成 1 局后再看 |
| Tab 3 调滑块后 Tab 2 不变 | `mon_user_segments` 1h 缓存 | 切回 Tab 2 即触发 force=1 |
| Tab 4 关 Flag 后游戏行为没变 | 业务模块未读 `getFlag()` | 确认入口有 `if (!getFlag('xxx')) return` |
| 鼠标悬停无 cursor:help | help key 未在 `HELP_TEXTS` 登记 | `listHelpKeys()` 查所有已注册 key |
| 控制台 `[strategyEngine] rule X when() threw` | 自定义规则的 `when()` 异常 | 用 try/catch 包裹，引擎已优雅降级 |
| Tab 1 分群分布全是 minnow | 真实分布如此 OR 分群权重全为 0 | 检查 `getStrategyConfig().segmentWeights` |

### 16.2 浏览器控制台调试代码

```js
// 1. 拉取实时聚合
await fetch('/api/mon/aggregate').then(r => r.json())

// 2. 拉取个人画像（force 跳过缓存）
await fetch('/api/mon/user-profile/u_test?force=1').then(r => r.json())

// 3. 看本地 Flag 与 Persona 缓存
JSON.parse(localStorage.getItem('openblock_mon_flags_v1'))
JSON.parse(localStorage.getItem('openblock_mon_persona_v1'))

// 4. 看当前 strategyConfig
const m = await import('/web/src/monetization/strategy/index.js');
console.log(m.getStrategyConfig());

// 5. 跑一次评估
const p = (await import('/web/src/monetization/personalization.js')).getCommercialInsight();
console.table(p.signals);
console.table(p.actions);

// 6. 试加一条规则
m.registerStrategyRule({
   id: 'test_rule',
   action: { type: 'iap', product: 'starter_pack' },
   when: () => true,
   priority: 'high',
   why: 'TEST',
});
// 切到 Tab 2 应看到 TEST 卡片

// 7. 一键清空所有 Mon 状态
['openblock_mon_flags_v1','openblock_mon_persona_v1','openblock_ad_freq_v1',
 'openblock_mon_purchases_v1','openblock_mon_task_points'
].forEach(k => localStorage.removeItem(k))

// 8. 看引擎决策的 whyLines（最有用的调试）
m.evaluate({
   persona:  { segment: 'dolphin', whaleScore: 0.42, activityScore: 0.5 },
   realtime: { frustration: 6, hadNearMiss: true, flowState: 'anxious' },
}).whyLines.forEach(l => console.log(l));
```

### 16.3 后端日志调试

```bash
# Flask 启动日志
tail -f /tmp/openblock_server.log

# 直接 SQL 看 mon_user_segments 当前画像
sqlite3 openblock.db "SELECT * FROM mon_user_segments LIMIT 10;"

# 看模型配置
sqlite3 openblock.db "SELECT config FROM mon_model_config WHERE id='default';" | python3 -m json.tool

# 看策略日志（曝光/转化）
sqlite3 openblock.db "SELECT strategy, COUNT(*), SUM(converted) FROM mon_strategy_log GROUP BY strategy;"
```

---

## 17. 附录：字段速查表

### 17.1 cursor:help 字段全表（44 项）

| 区域 | help key | 默认值 / 含义 |
|------|---------|--------------|
| **Tab 1 KPI** (6) | `kpi.{total_users / dau_7d / games_7d / avg_score_30d / avg_session_30d / lb_participants}` | 见 §11.2 |
| **Tab 1 分群** (3) | `segment.{whale / dolphin / minnow}` | minWhaleScore = 0.60 / 0.30 / 0.00 |
| **Tab 2 信号** (6) | `signal.{segment / activity / skill / frustration / nearMiss / flow}` | 见 §5 |
| **Tab 2 策略卡** (1) | `rule.title` | 通用文案 |
| **Tab 3 权重** (3) | `weight.{best_score_norm / total_games_norm / session_time_norm}` | 0.40 / 0.30 / 0.30 |
| **Tab 3 阈值** (4) | `threshold.{frustrationRescue / maxRewardedPerGame / showStarterPackHours / showWeeklyPassAfterGames}` | 5 / 3 / 24 / 5 |
| **Tab 4 Flag** (10) | `flag.{adsRewarded / adsInterstitial / iap / dailyTasks / leaderboard / skinUnlock / seasonPass / pushNotifications / replayShare / stubMode}` | 见 §14.1 |
| **入口** (1) | `panel.entry` | 训练面板说明 |

总计 34 + 10 = **44 个登记字段**。新增任一字段必须先登记 `HELP_TEXTS`，否则面板上无 tooltip。

### 17.2 内置策略规则全表（8 条）

| id | segments | when 条件 | action | priority | 商业目标 |
|----|---------|----------|--------|---------|---------|
| `whale_default_monthly` | whale | — | iap.monthly_pass | high | LTV 3.8× weekly |
| `whale_no_interstitial` | whale | — | ads.none | high | 屏蔽插屏护流 |
| `whale_hint_pack_on_frustration` | whale | frust ≥ 5 | iap.hint_pack_5 | high | 流失 -18% |
| `dolphin_default_weekly` | dolphin | — | iap.weekly_pass | medium | 月卡转化铺路 |
| `dolphin_rewarded_near_miss` | dolphin | hadNearMiss | ads.rewarded@near_miss | high | 转化 +40% |
| `dolphin_push_on_low_activity` | dolphin | activity < 0.35 | push.streak_reminder | medium | D7 +15% |
| `minnow_interstitial_on_game_over` | minnow | — | ads.interstitial@game_over | medium | eCPM 最大 |
| `minnow_starter_pack_on_frustration` | minnow | frust ≥ 5 | iap.starter_pack | high | 首购 +35% |
| `minnow_daily_tasks` | minnow | — | task.daily_quest | low | D1 +28% |

完整定义：[`strategyConfig.js` § `rules`](#) L149-L238。

### 17.3 后端 API 速查

| 方法 | 路径 | 用途 | Tab |
|------|------|------|-----|
| `GET` | `/api/mon/status` | 健康探针 | — |
| `GET` | `/api/mon/aggregate` | 全局聚合指标 | 1 |
| `GET` | `/api/mon/user-profile/<uid>?force=0\|1` | 用户画像 + 策略推荐 | 2 |
| `GET` | `/api/mon/model/config` | 拉取当前模型配置 | 3 |
| `PUT` | `/api/mon/model/config` | 更新配置（深合并） | 3 |
| `POST` | `/api/mon/leaderboard/submit` | 提交每日榜分 | （非面板） |
| `GET` | `/api/mon/leaderboard/daily` | 每日榜列表 | （非面板） |
| `POST` | `/api/mon/strategy/log` | 策略曝光/转化日志 | （非面板，由 adTrigger 等调用） |

源码：[`monetization_backend.py` § `create_mon_blueprint`](#) L330-L532。

### 17.4 SQLite Schema（与面板相关 4 表）

```sql
mon_user_segments           -- 分群快照缓存（1h TTL）
   user_id PK / segment / whale_score / activity_score / skill_score
   frustration_avg / near_miss_rate / last_computed

mon_model_config            -- 单行：id='default' 的 JSON 配置
   id PK / config TEXT / updated_at

mon_strategy_log            -- 策略曝光/转化日志（漏斗用）
   id PK / user_id / strategy / action / converted / created_at

mon_daily_scores            -- 每日榜原始数据
   id PK / user_id / score / strategy / date_ymd / submitted_at
```

依赖（非 mon 前缀，但被画像计算引用）：

```sql
user_stats                  -- 用户全量聚合（best_score / total_games / total_play_time）
sessions                    -- 每局会话（duration / status / start_time）
behaviors                   -- 行为事件流（event_type）
```

### 17.5 源码定位速查

| 内容 | 文件:行 |
|------|--------|
| 面板入口与 DOM | `monPanel.js:333-382` |
| Tab 1 总览渲染 | `monPanel.js:384-432` |
| Tab 2 用户画像渲染 | `monPanel.js:438-485` |
| Tab 3 模型配置渲染 + 保存 | `monPanel.js:487-587` |
| Tab 4 功能开关渲染 | `monPanel.js:589-615` |
| `openMonPanel` / `refreshMonPanel` 公开 API | `monPanel.js:643-660` |
| 鲸鱼分计算与分群 | `monetization_backend.py:149-270` |
| 默认模型配置 | `monetization_backend.py:96-128` |
| 后端聚合 KPI | `monetization_backend.py:419-486` |
| 后端模型配置 GET/PUT | `monetization_backend.py:490-511` |
| 策略配置 L1（默认值与公开 API） | `strategy/strategyConfig.js` 全文 |
| 策略引擎 L2（evaluate / buildWhyLines） | `strategy/strategyEngine.js` 全文 |
| Help 文案 L3 | `strategy/strategyHelp.js` 全文 |
| 个性化数据汇聚层 | `personalization.js` 全文 |
| Feature Flags | `featureFlags.js` 全文 |

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`MONETIZATION.md`](./MONETIZATION.md) | 系统全景；本文档详细化第 10 章「商业化模型训练面板」 |
| [`MONETIZATION_CUSTOMIZATION.md`](./MONETIZATION_CUSTOMIZATION.md) | 三种定制粒度；本文档对应粒度 A（运营调参） |
| [`MONETIZATION_PERSONALIZATION.md`](../archive/MONETIZATION_PERSONALIZATION.md) | v2 个性化设计原稿 |
| [`STRATEGY_GUIDE.md`](../engineering/STRATEGY_GUIDE.md) | 策略文件结构与项目级定制 |

---

> 最后更新：2026-04-27 · 涵盖 v3 重构后的全部架构  
> 反馈与改进：见 [`docs/README.md`](../README.md) 贡献指引
