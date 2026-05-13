# 商业化模型架构设计

> 本文是 OpenBlock 商业化模型（`commercialModel.js` 与算法层扩展模块）的
> **算法工程师视角架构设计**，包括建模思路、推理流水线、训练-推理契约与灰度策略。
>
> 范围：propensity 建模 / 三腿流失合并 / 价格弹性 / 广告插入 RL / 推送时机 /
> 算法层扩展模块的接入方式。
>
> 不在范围：业务规则配置、A/B 实验流程、运营 SOP（请见
> [`../operations/COMMERCIAL_STRATEGY_REVIEW.md`](../operations/COMMERCIAL_STRATEGY_REVIEW.md)
> 与 [`../operations/MONETIZATION.md`](../operations/MONETIZATION.md)）。

## 1. 模型本质

### 1.1 一句话刻画

`commercialModel.buildCommercialModelVector(ctx)` 是一个**多输出可解释打分器**：
4 个 propensity 头（iap / rewarded / interstitial / churn）+ 1 个 payerScore +
1 个 adFatigueRisk + 4 个 guardrail 布尔位。

数学形式上是**截断仿射映射**：

```
propensity_t = clip₀¹( Σ_i w_t,i · feature_i + Σ_j v_t,j · 1[discrete_j] + abilityBias_t )
recommendedAction = argmax 阈值规则（带优先级）
```

特点：

- **没有** sigmoid 概率层 / 特征交互项 / 在线学习
- 所有权重在 `strategyConfig.commercialModel`，可由后端 `mon_model_config` 深合并
  覆盖
- 决策由 `actionThresholds` 与 `guardrail` 控制，propensity 只是参考分

### 1.2 优势与代价

| 维度 | 优势 | 代价 |
|------|------|------|
| 解释性 | 每条权重都能直接讲故事；任何决策都能拆成"哪几个特征贡献最大" | 表达能力有限；非线性行为捕捉弱 |
| 延迟 | 全部纯函数 + clamp01，单次 < 50µs | 无需，除非引入 ML 推理 |
| 热更 | 权重在 `getStrategyConfig().commercialModel`，RemoteConfig 即可推 | 离线训练→推理仍需 bundle 注入 |
| 防呆 | guardrail 把"概率高也不能推"的硬约束放在外层 | 多目标耦合（4 个 head 不共享底层） |
| 概率语义 | — | propensity ∈ [0,1] 但不是 P(buy\|x)；阈值（如 iapRecommend=0.68）需经验调参 |
| 选择偏差 | — | 训练标签全部来自"模型推荐过的 action"，需要探索流量提供无偏样本 |

### 1.3 与 ML 推理的解耦原则

仓库**不**在客户端做训练。所有 ML 部分都遵循：

1. **离线训练**（Python：lifelines / sklearn / EconML / lightgbm）→ 产出 JSON
   `bundle`
2. **推理函数**（`web/src/monetization/ml/*.js`）只读 `bundle`，做矩阵乘 + 标量
   函数；权重由 `setXxxWeights({...})` 注入
3. **Feature Flag 灰度**：所有改变决策的能力默认 `false`，先观察 metric / drift
4. **统一特征 schema**（`commercialFeatureSnapshot.js`）：训练管线与客户端共享
   schema，避免训练-推理 skew

## 2. 关键算法决策

### 2.1 unifiedRisk 三腿合并

```
unifiedRisk = (w_pred · predictor + w_mat · maturity + w_com · commercial)
              / Σ active_weights
```

默认权重 `0.45 / 0.35 / 0.20`（`lifecycleSignals.CHURN_BLEND_WEIGHTS_DEFAULT`），
是产品先验，不是离线学习结果。

**注入接口**：`setChurnBlendWeights({ predictor, maturity, commercial })`，传入
后自动归一到和 = 1；任一来源缺失时自动退化到剩余权重的归一化。

**典型用法**：拿到 14 天 churn 标签后跑 PR-AUC，按比例归一注入：

```js
const auc = { predictor: 0.71, maturity: 0.66, commercial: 0.63 };
const sum = auc.predictor + auc.maturity + auc.commercial;
setChurnBlendWeights({
    predictor: auc.predictor / sum,
    maturity:  auc.maturity  / sum,
    commercial: auc.commercial / sum,
});
```

边界：三路 PR-AUC 差距 < ±0.02 时建议保留产品先验，避免估计噪声。

### 2.2 _abilityBias

`commercialModel._abilityBias(ctx)` 把 `playerAbilityVector` 的 5 个能力维度作为
微小偏置项叠加到 propensity 上：

```js
iapBias       = (planning   - 0.5) * 0.16 + (skill - 0.5) * 0.08
payerBias     = (planning   - 0.5) * 0.12
churnBias     = -(confidence - 0.5) * 0.14
interBias     = -(clearEff   - 0.5) * 0.12
rewardedBias  = (risk       - 0.5) * 0.18
```

每项在 0.5 处取 0；总修正幅度约 ±0.15。统计意义上等价于 Bayesian shrinkage
prior——给每个能力维度一个先验权重，但不会在新分布下自适应。

进一步演进：用 `multiTaskEncoder` 替代——把 ability 5 维直接作为 feature 喂给
encoder，让 latent representation 自动学到哪些能力维度对哪个 propensity 更
重要。

### 2.3 dynamicPricing 5×3 矩阵

`paymentManager.DYNAMIC_PRICING_MATRIX[stage][riskBucket] → discount` 是
离散化的二维 kernel regression——5 个 stage × 3 个 risk bucket = 15 个折扣点。

进一步演进：使用 `priceElasticityModel.recommendDiscount({ stageCode,
riskBucket, basePrice })`，在 `setDemandCurve(...)` 注入连续 demand curve 后
做 argmax 反算 expected revenue。

## 3. 算法层扩展模块

下表汇总 `web/src/monetization/` 下用于校准、监控、探索与离线模型注入的模块。
所有模块默认通过 feature flag 灰度，未启用时不影响原有决策路径。

### 3.1 观测层

| 模块 | 文件 | Flag | 用途 |
|------|------|------|------|
| `propensityCalibrator` | `calibration/propensityCalibrator.js` | `commercialCalibration` (默认 false) | isotonic / Platt scaling；离线产出 calibration 表 |
| `modelQualityMonitor` | `quality/modelQualityMonitor.js` | `commercialModelQualityRecording` (默认 true) | 滑动缓冲 PR-AUC / Brier / log-loss / hit-rate@10 |
| `actionOutcomeMatrix` | `quality/actionOutcomeMatrix.js` | `actionOutcomeMatrix` (默认 true) | 推荐 action × 实际 outcome 矩阵；自动 Bus 接线 |
| `distributionDriftMonitor` | `quality/distributionDriftMonitor.js` | `distributionDriftMonitoring` (默认 true) | 10-bin 直方图 + KL divergence per feature |

### 3.2 决策层

| 模块 | 文件 | Flag | 用途 |
|------|------|------|------|
| `epsilonGreedyExplorer` | `explorer/epsilonGreedyExplorer.js` | `explorerEpsilonGreedy` (默认 false) | 5–10% 探索流量 + IPS propensity + 用户级冷却 |
| `multiTaskEncoder` | `ml/multiTaskEncoder.js` | `multiTaskEncoder` (默认 false) | 共享 latent h ∈ ℝ^16 + 4 sigmoid heads |
| `contextualBandit` (LinUCB) | `ml/contextualBandit.js` | `adInsertionBandit` (默认 false) | 在线学习广告插入策略 |
| `commercialPolicy.decideAndRecord` | `commercialPolicy.js` | — | 推理 → 探索包装 → 矩阵记录三合一入口 |

### 3.3 离线模型注入

| 模块 | 文件 | 注入接口 | 用途 |
|------|------|----------|------|
| `zilnLtvModel` | `ml/zilnLtvModel.js` | `setZilnParams(payload)` | Zero-Inflated Lognormal LTV |
| `priceElasticityModel` | `ml/priceElasticityModel.js` | `setDemandCurve(payload)` | DML demand curve；argmax_d E[revenue] |
| `survivalPushTiming` | `ml/survivalPushTiming.js` | `setSurvivalParams(payload)` | Cox 比例风险 push 时机 |

### 3.4 工程基础设施

| 模块 | 文件 | 用途 |
|------|------|------|
| `commercialFeatureSnapshot` | `commercialFeatureSnapshot.js` | 25 维统一 schema；不可变 snapshot；`_missing` 字段记录线上信号缺失率 |
| `getCommercialChurnRisk01` 缓存 | `commercialModel.js` | 50ms TTL；同一 ctx 重复调用直接复用 |
| `adInsertionRL.featuresByKey` | `ad/adInsertionRL.js` | array + dict 双视图；下游可按语义 key 取值 |

## 4. 推理流水线

启用所有相关 flag 时的完整路径：

```
┌─────────────────────────────────────────────────────────────────────┐
│  buildCommercialFeatureSnapshot(ctx)                                │
│    ├─ schema-versioned, frozen, 25-dim vector                       │
│    └─ snapshot.vector + snapshot.features + snapshotDigest          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  buildCommercialModelVector(ctx)                                    │
│    ├─ 线性加权    → vector.iapPropensity / churnRisk / ...          │
│    ├─ + calibratePropensityVector(vector)  → vector.calibrated      │
│    ├─ + predictAllTasks(snapshot.vector)   → vector.mtl  (灰度 off) │
│    └─ + recordSnapshotForDrift(snapshot)   → KL 累积                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  decideAndRecord(ctx, { userId })                                   │
│    ├─ deterministic → vector.recommendedAction                      │
│    ├─ wrapWithExplorer (ε=0.05, 用户每小时 6 次冷却)                │
│    └─ recordRecommendation(action, { snapshotDigest, propensities })│
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  outcome 事件回流（MonetizationBus）                                │
│    ├─ purchase_completed   → recordOutcome('buy')                   │
│    ├─ ad_complete          → recordOutcome('watch_rewarded'|...)    │
│    └─ lifecycle:session_end (churnLevel) → recordOutcome('churn')   │
└─────────────────────────────────────────────────────────────────────┘
```

## 5. 关键算法公式

### 5.1 Calibration（propensityCalibrator）

**Isotonic regression**：训练样本按 raw_score 降序，分桶 N=20，每桶 P(y=1) 作为
校准后概率，最后做 monotone enforcement。推理时 binary search 找 bin → 返回
bin.p；落入边界做线性插值。

**Platt scaling**：`σ(a · s + b)`；fit 用 BCE loss，等价于 logistic regression。

注入：

```js
setCalibrationBundle({
    schemaVersion: 1, fittedAt: 1234567890,
    tables: {
        iap:          { method: 'isotonic', bins: [...] },
        rewarded:     { method: 'platt',    a: 1.2, b: -0.4 },
        interstitial: { method: 'isotonic', bins: [...] },
        churn:        { method: 'platt',    a: 0.9, b:  0.1 },
    },
});
```

### 5.2 Quality 指标（modelQualityMonitor）

```
Brier   = (1/N) Σ (p - y)²                       越小越好
LogLoss = -(1/N) Σ [y log p + (1-y) log(1-p)]    极端错误重罚
PR-AUC  = ∫₀¹ Precision dR                       不平衡数据敏感
Hit@10  = 正样本数@top10% / N@top10%             推荐场景常用
```

每个 task 滑动缓冲 max 2000 样本 + 24h 报告。

### 5.3 Action-outcome attribution（actionOutcomeMatrix）

- 优先按 `snapshotDigest` 精确匹配
- 30min 内有未匹配的推荐 → 取最近一条做 attribution
- 完全无 pending → action='unrecommended'

### 5.4 ε-greedy + IPS（epsilonGreedyExplorer）

```
P(a | x) = (1 - ε) · 1[a == optimal] + ε / |A|

exploit:  P = (1 - ε) + ε/|A|   ≈ 0.95 + 0.017 = 0.967  (ε=0.05, |A|=3)
explore:  P =      ε/|A|        ≈ 0.017
```

下游做 IPS-weighted training 时把 P 作为 weight。

### 5.5 MTL 推理（multiTaskEncoder）

```
features (FEATURE_SCHEMA_SIZE) → [encoder W ∈ ℝ^(L×F), b ∈ ℝ^L] → h ∈ ℝ^L → ReLU
h → [head_t: w ∈ ℝ^L, b ∈ ℝ] → σ(w·h + b) → P_t
```

L = 16；4 个 head（iap / rewarded / interstitial / churn）。**默认 identity
encoder + uniform head**：等价于"未注入参数时不引入新偏差"，仅在 vector 上
增加 `mtl` 字段供 dashboard 对照。

### 5.6 ZILN-LTV（zilnLtvModel）

```
P(LTV = 0 | x)        = σ(w_z · x + b_z)
P(LTV | x, LTV>0)     = LogNormal(μ(x), σ²)
E[LTV | x]            = (1 - p_zero) · exp(μ + σ²/2)
Var[LTV | x]          = (1 - p_zero) · exp(2μ + σ²) · (exp(σ²) - 1)
                      + p_zero · (1 - p_zero) · exp(μ + σ²/2)²
```

适用于 95%+ 用户 LTV = 0 的游戏数据；付费用户金额近似 lognormal（Pareto 80/20）。

### 5.7 DML demand curve（priceElasticityModel）

```
demand(x, d)            = σ( logit(baseline_p) + α · (-d) + β · d² )
expected_revenue(x, d)  = (1 - d) · price · demand(x, d)
recommend_discount(x)   = argmax_d expected_revenue
```

DML 训练时用 cross-fitting 控制 confounding（玩家 segment、时间、活动期）。
ATE = α 是"折扣 1 单位的边际购买概率提升"。

### 5.8 KL drift（distributionDriftMonitor）

```
KL(p_live ‖ p_train) = Σᵢ p_live(i) · log(p_live(i) / p_train(i))   (smoothed by ε=1e-7)
```

每个特征 10 bins 直方图。阈值：

| KL | 含义 |
|----|------|
| > 0.05 | medium drift |
| > 0.10 | high drift（建议重训练） |
| > 0.25 | critical（建议下线） |

### 5.9 LinUCB contextual bandit（contextualBandit）

```
A_a = D_a^T D_a + I        (d×d, ridge regression 协方差)
b_a = D_a^T r_a            (d×1, reward sum)

inference:
θ_a = A_a^{-1} b_a
UCB = θ_a^T x + α · √(x^T A_a^{-1} x)
action = argmax_a UCB
```

α=0.5 默认；α 越大越偏 exploration。每次 update 是 O(d²)。在线策略，无需重训。

### 5.10 Cox 比例风险 push timing（survivalPushTiming）

```
h(t | x) = h_0(t) · exp(β^T x)
S(t | x) ≈ S_0(t)^{exp(β^T x)}
```

baseline survival S_0(t) 离线产出（按天分桶 5..30 天）+ β 离线训练。推理时
找 "S(t|x) 第一次跌破 0.7" 的天数 → 推送时机。

## 6. 训练-推理契约

| 模块 | bundle schema 字段 | 来源（线下） | 注入接口（线上） |
|------|-------------------|--------------|-------------------|
| propensityCalibrator | `{ schemaVersion, fittedAt, tables }` | sklearn `IsotonicRegression` / `Platt` | `setCalibrationBundle` |
| multiTaskEncoder | `{ schemaVersion, encoder: { W, b }, heads }` | PyTorch / sklearn | `setMultiTaskWeights` |
| zilnLtvModel | `{ schemaVersion, zero: { w, b }, amount: { mu, sigma2 } }` | TensorFlow Probability / 自研 | `setZilnParams` |
| priceElasticityModel | `{ schemaVersion, groups, alpha, beta, baselineLogit }` | EconML / DoubleML | `setDemandCurve` |
| survivalPushTiming | `{ schemaVersion, beta, baselineSurvival }` | lifelines | `setSurvivalParams` |
| distributionDriftMonitor | `{ schemaVersion, features }` (训练分布直方图) | 训练数据离线统计 | `setTrainingDistribution` |
| churn blend weights | `{ predictor, maturity, commercial }` | 离线 PR-AUC | `setChurnBlendWeights` |

所有 schema 通过 `SCHEMA_VERSION` 常量做版本协商；推理函数遇到不支持的版本会
fallback 到默认参数并 `console.warn`。

## 7. 灰度策略

观测 → 校准 → 探索 → 升级 四步走，避免一次性切换决策路径：

1. **观测层先行**：`commercialModelQualityRecording` / `actionOutcomeMatrix` /
   `distributionDriftMonitoring` 默认开启，纯观测
2. **校准接通**：训练首版 calibration table → `setCalibrationBundle()` 注入；
   开 `commercialCalibration` 灰度 5%；对比 calibrated vs raw 在 PR-AUC / Brier
   上的提升
3. **探索铺设**：开 `explorerEpsilonGreedy` 5%；让 actionOutcomeMatrix 收到
   无偏样本
4. **模型升级**：训练 MTL → 开 `multiTaskEncoder` 灰度对照；ZILN-LTV / DML / Cox /
   LinUCB 视业务方需求逐项接通

每一步都需先确认前一步的 metrics 收敛。

## 8. 测试覆盖

| 模块 | 测试文件 |
|------|----------|
| commercialFeatureSnapshot | [`tests/commercialFeatureSnapshot.test.js`](../../tests/commercialFeatureSnapshot.test.js) |
| propensityCalibrator | [`tests/propensityCalibrator.test.js`](../../tests/propensityCalibrator.test.js) |
| modelQualityMonitor | [`tests/modelQualityMonitor.test.js`](../../tests/modelQualityMonitor.test.js) |
| actionOutcomeMatrix | [`tests/actionOutcomeMatrix.test.js`](../../tests/actionOutcomeMatrix.test.js) |
| epsilonGreedyExplorer | [`tests/epsilonGreedyExplorer.test.js`](../../tests/epsilonGreedyExplorer.test.js) |
| multiTaskEncoder | [`tests/multiTaskEncoder.test.js`](../../tests/multiTaskEncoder.test.js) |
| churnBlendWeights | [`tests/churnBlendWeights.test.js`](../../tests/churnBlendWeights.test.js) |
| zilnLtvModel | [`tests/zilnLtvModel.test.js`](../../tests/zilnLtvModel.test.js) |
| priceElasticityModel | [`tests/priceElasticityModel.test.js`](../../tests/priceElasticityModel.test.js) |
| distributionDriftMonitor | [`tests/distributionDriftMonitor.test.js`](../../tests/distributionDriftMonitor.test.js) |
| contextualBandit | [`tests/contextualBandit.test.js`](../../tests/contextualBandit.test.js) |
| survivalPushTiming | [`tests/survivalPushTiming.test.js`](../../tests/survivalPushTiming.test.js) |
| commercialPolicy | [`tests/commercialPolicy.test.js`](../../tests/commercialPolicy.test.js) |

## 9. 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) | 商业化算法手册（whale_score / 规则引擎 / LTV 等基础层） |
| [`../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) | MonetizationBus 事件契约 |
| [`../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md`](../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md) | 数据→信号→策略分层 |
| [`../operations/MONETIZATION.md`](../operations/MONETIZATION.md) | 商业化系统全景与 API |
| [`../operations/COMMERCIAL_STRATEGY_REVIEW.md`](../operations/COMMERCIAL_STRATEGY_REVIEW.md) | 商业化系统能力总览 |
