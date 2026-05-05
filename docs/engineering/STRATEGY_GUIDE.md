# 策略定制指南

> 本文档说明 OpenBlock 各类策略的原理与定制方法，所有修改均通过配置或插件接口完成，**无需修改引擎核心代码**。

---

## 目录

1. [出块策略定制](#1-出块策略定制)
2. [Stress 信号定制](#2-stress-信号定制)
3. [难度模式定制](#3-难度模式定制)
4. [广告策略定制](#4-广告策略定制-ad-sdk)
5. [IAP 策略定制](#5-iap-策略定制-iap-sdk)
6. [商业化分群策略](#6-商业化分群策略)
7. [个性化推荐策略](#7-个性化推荐策略)
8. [RL 训练策略](#8-rl-训练策略)
9. [玩家成长策略](#9-玩家成长策略)
10. [策略变更验证](#10-策略变更验证)

---

## 1. 出块策略定制

### 原理

出块引擎采用**三层架构**。`stress` 不再只映射为“方块更简单/更复杂”，而是先影响 `shapeWeights`，再投影为 `spawnTargets`，由 `blockSpawn.js` 在解空间、消行机会、空间压力、节奏兑现和新鲜度等多个维度消费：

```
stress ∈ [-0.2, 1.0]
  ├─ shapeWeights       # 形状品类权重插值
  ├─ spawnTargets       # 多轴目标：复杂度/解空间/消行/payoff/新鲜度
  └─ spawnHints         # clearGuarantee/sizePreference/multiLineTarget 等
  ↓
blockSpawn.js: 盘面拓扑 + 可解性护栏 + 多轴目标加权 → 三连块
```

三层职责：

| 层 | 关注点 | 主要文件 |
|----|--------|----------|
| Layer 1 | 盘面拓扑、合法落点、解法数量、空洞修复、清屏/多消机会 | `web/src/bot/blockSpawn.js` |
| Layer 2 | stress、心流、挫败、combo、节奏、爽感兑现 | `web/src/adaptiveSpawn.js` |
| Layer 3 | 单局弧线、里程碑、跨局热身、连战 | `web/src/adaptiveSpawn.js` / `web/src/game.js` |

### 定制 Profile（最常用）

修改 `shared/game_rules.json` 的 `adaptiveSpawn.profiles` 数组，**无需修改任何 JS 代码**：

```json
{
  "adaptiveSpawn": {
    "enabled": true,
    "profiles": [
      {
        "stress": -0.2,
        "comment": "极低压力：给大量简单小块，帮助新手建立信心",
        "shapeWeights": { "lines": 3.18, "rects": 2.2, "squares": 1.8, "tshapes": 0.45, "zshapes": 0.35, "lshapes": 0.53, "jshapes": 0.45 }
      },
      {
        "stress": 0.0,
        "comment": "中性：标准混合出块",
        "shapeWeights": { "lines": 2.15, "rects": 1.55, "squares": 1.35, "tshapes": 1.12, "zshapes": 1.12, "lshapes": 1.2, "jshapes": 1.12 }
      },
      {
        "stress": 0.8,
        "comment": "高压力：挑战玩家极限",
        "shapeWeights": { "lines": 1.58, "rects": 1.3, "squares": 1.55, "tshapes": 1.42, "zshapes": 1.48, "lshapes": 1.46, "jshapes": 1.38 }
      }
    ]
  }
}
```

引擎会在相邻 profile 之间做**线性插值**，你可以添加任意数量的 profile 节点。

### 理解形状类别

| 类别 | 典型形状 | 难度含义 |
|------|---------|----------|
| `lines` | 1×4、4×1、1×5、5×1 | 规整但可能占用长空间，低压时常用于救场和消行 |
| `rects` | 1×2、2×1、2×3 等 | 规整、易理解，适合舒适区和恢复区 |
| `squares` | 1×1、2×2、3×3 | 小块可救场，大方块增加空间压力 |
| `tshapes` | T 形 | 中高复杂度，考验局部规划 |
| `zshapes` | Z/S 形 | 高复杂度，容易制造空洞 |
| `lshapes` | L 形 | 中高复杂度，适合 setup / payoff 之间的转折 |
| `jshapes` | J 形 | 中高复杂度，与 L 形互补 |

完整形状定义见 `shared/shapes.json`。

### 禁用自适应出块（固定策略）

```json
{
  "adaptiveSpawn": {
    "enabled": false
  }
}
```

禁用后使用 `config.js` 中 strategy 定义的固定权重。

---

## 2. Stress 信号定制

### 信号列表与权重

Stress 在 `web/src/adaptiveSpawn.js` 中合成，配置来源是 `shared/game_rules.json`。当前实现会输出 `_stressBreakdown`，用于面板、回放和测试解释每轮加压/减压来源：

| # | 信号 | 变量名 | 典型范围 | 作用 |
|---|------|--------|---------|------|
| 1 | 分数压力 | `scoreStress` | [−0.15, 0.8] | 分数越高压力越大 |
| 2 | 连胜加成 | `runStreakStress` | [0, 0.3] | 连续多局加压 |
| 3 | 技能调节 | `skillAdjust` | [−0.15, 0.15] | 高手加压/新手减压 |
| 4 | 心流调节 | `flowAdjust` | [−0.24, 0.16] | 无聊+/焦虑−/心流0 |
| 5 | 节奏张弛 | `pacingAdjust` | [−0.12, 0.1] | tension+/release− |
| 6 | 恢复调节 | `recoveryAdjust` | [−0.15, 0] | 板满时降压 |
| 7 | 挫败救济 | `frustrationRelief` | [−0.2, 0] | 未消行降压 |
| 8 | Combo 正反馈 | `comboReward` | [0, 0.08] | 连击轻微加压 |
| 9 | 趋势调节 | `trendAdjust` | [−0.1, 0.1] | 历史趋势修正 |
| 10 | 盘面风险救济 | `boardRiskReliefAdjust` | [−0.1, 0] | 填充/空洞/能力风险统一减压 |
| 11 | 置信门控 | `confidenceGate` | [0, 1] | 低置信度收窄调节 |

### 配置信号开关与缩放

在 `game_rules.json` 中使用 `adaptiveSpawn.signals` 配置信号：

```json
{
  "adaptiveSpawn": {
    "signals": {
      "runStreakStress": { "enabled": false, "scale": 1 },
      "trendAdjust":    { "enabled": false, "scale": 1 },
      "flowAdjust":     { "enabled": true,  "scale": 0.8 }
    }
  }
}
```

当前实现会自动读取 `enabled` 与 `scale`：`enabled=false` 时信号不参与合成，`scale` 用于 A/B 或回放校准。最终结果会写入 `_stressBreakdown`，面板可展示各信号贡献。

常见用法：

| 目标 | 建议 |
|------|------|
| 连战太快变难 | 降低 `runStreakStress.scale` 或关闭 `runStreakStress` |
| 新手焦虑仍偏高 | 提高 `frustrationRelief.scale`、`recoveryAdjust.scale` 或 `boardRiskReliefAdjust.scale` |
| 高手觉得单调 | 提高 `skillAdjust.scale`、`flowAdjust.scale`，但不要直接把所有 profile 调难 |
| 跨会话趋势不可靠 | 关闭 `trendAdjust` |
| 面板解释异常 | 查看 `_stressBreakdown.rawStress / afterSmoothing / finalStress` |

### 添加自定义信号

如确实需要新增信号，在 `adaptiveSpawn.js` 的 stress 合成区块添加分量，并同步写入 `stressBreakdown`：

```js
// 自定义：连续失误惩罚信号
const missStreakPenalty = profile.missRate > 0.6
    ? -0.1 * (profile.missRate - 0.6) / 0.4  // 失误率超 60% 时降压救济
    : 0;

stressBreakdown.missStreakRelief = applySignal(signalCfg, 'missStreakRelief', missStreakPenalty);
```

新增信号后同时更新：

1. `shared/game_rules.json` 的 `adaptiveSpawn.signals`。
2. `tests/adaptiveSpawn.test.js` 的典型场景断言。
3. 本文档信号表。

---

## 3. 难度模式定制

### 三档难度参数

在 `shared/game_rules.json` 中定义各难度的 `adaptiveSpawn.difficultyTuning`：

```json
{
  "adaptiveSpawn": {
    "difficultyTuning": {
      "easy": {
        "stressBias": -0.22,
        "clearGuaranteeDelta": 1,
        "sizePreferenceDelta": -0.22,
        "multiClearBonusDelta": 0.05,
        "solutionStressDelta": -0.14
      },
      "normal": {
        "stressBias": 0,
        "clearGuaranteeDelta": 0,
        "sizePreferenceDelta": 0,
        "multiClearBonusDelta": 0,
        "solutionStressDelta": 0
      },
      "hard": {
        "stressBias": 0.22,
        "clearGuaranteeDelta": -1,
        "sizePreferenceDelta": 0.24,
        "multiClearBonusDelta": -0.08,
        "solutionStressDelta": 0.18,
        "minStress": 0.18
      }
    }
  }
}
```

其中：

| 字段 | 作用 |
|------|------|
| `stressBias` | 直接叠加到最终 stress 基线，负值降低整体难度，正值提高 |
| `clearGuaranteeDelta` | 调整三连块中消行友好块数量 |
| `sizePreferenceDelta` | 负值偏小块，正值偏大块 |
| `multiClearBonusDelta` | 调整多消候选权重 |
| `solutionStressDelta` | 只影响解法数量过滤压力 |
| `minStress` | 非救场状态下的最低压力下限 |

### Stress 平滑

`adaptiveSpawn.stressSmoothing` 控制普通状态下的 stress 滞后，避免连续几轮突然跳难：

```json
{
  "enabled": true,
  "alpha": 0.4,
  "maxStepUp": 0.18,
  "maxStepDown": 0.28
}
```

挫败、近失、恢复和高盘面风险属于救场信号，减压会立即生效，不被平滑延迟。

### 多轴消费

不要把 stress 只理解成“复杂方块比例”。`adaptiveSpawn` 会输出 `spawnHints.spawnTargets`：

```json
{
  "shapeComplexity": 0.62,
  "solutionSpacePressure": 0.54,
  "clearOpportunity": 0.35,
  "spatialPressure": 0.48,
  "payoffIntensity": 0.71,
  "novelty": 0.42
}
```

各轴的消费方式：

| 目标轴 | 影响对象 | 典型效果 |
|--------|----------|----------|
| `shapeComplexity` | `blockSpawn` 品类复杂度加权 | 高值偏 T/Z/L/J，低值偏 lines/rects/squares |
| `solutionSpacePressure` | 解法数量过滤、首手自由度 | 高值允许更窄解空间，低值要求更宽松 |
| `clearOpportunity` | `clearGuarantee`、gap/multiClear 权重 | 救场时增加即时消行块进入三连块的概率 |
| `spatialPressure` | 大块/小块占比、setup 阶段 | 高值偏更强空间规划，低值偏小块保活 |
| `payoffIntensity` | multiClear / perfectClear / payoff 加权 | 提高多消、清屏、连击兑现 |
| `novelty` | 同轮/跨轮品类重复惩罚 | 降低重复块型造成的疲劳 |

调参建议：

- 想让高压更像“规划挑战”，优先提高 `solutionSpacePressure` / `spatialPressure`，不要单纯提高异形块。
- 想做救场，优先提高 `clearOpportunity` 并降低 `solutionSpacePressure`。
- 想制造爽感兑现，调高 `payoffIntensity`，让多消/清屏候选更容易进入三连块。
- 想降低重复感，调高 `novelty`，让同轮和跨轮品类重复惩罚更强。

### 典型调参配方

| 体验目标 | 配置方向 |
|----------|----------|
| 新手更稳 | easy 的 `stressBias` 更低，`clearGuaranteeDelta` 提高，`sizePreferenceDelta` 更负；保留 `stressSmoothing` |
| 高手更有挑战 | hard 的 `solutionStressDelta` 提高，`shapeComplexity` 和 `solutionSpacePressure` 随 stress 增长；不要关闭可解性护栏 |
| 连续无消行救场 | 提高 `frustrationRelief.scale`，确保 `clearOpportunity` 上升、`solutionSpacePressure` 下降 |
| 更多爽感多消 | 提高 `payoffIntensity`、`multiClearBonusDelta`，并观察 `multiClearCandidates` |
| 减少重复出块 | 提高 `novelty` 或 `diversityBoost`，检查 `recentCatFreq` |

### 新增难度档位

1. 在 `shared/game_rules.json` 的 `adaptiveSpawn.difficultyTuning` 中添加新键。
2. 在 `web/src/config.js` 的 `STRATEGIES` 数组中添加新策略项。
3. 若 UI 语言包中展示难度名，同步更新 `web/src/i18n/locales/*`。
4. 补充 `tests/adaptiveSpawn.test.js` 的难度顺序和 spawnHints 断言。

```js
// web/src/config.js
export const STRATEGIES = [
    { id: 'easy',   label: '简单', icon: '🌱' },
    { id: 'normal', label: '普通', icon: '⚡' },
    { id: 'hard',   label: '困难', icon: '🔥' },
    { id: 'ultra',  label: '地狱', icon: '💀' }
];
```

`difficultyTuning` 示例：

```json
{
  "adaptiveSpawn": {
    "difficultyTuning": {
      "ultra": {
        "stressBias": 0.34,
        "clearGuaranteeDelta": -1,
        "sizePreferenceDelta": 0.32,
        "multiClearBonusDelta": -0.1,
        "solutionStressDelta": 0.26,
        "minStress": 0.28
      }
    }
  }
}
```

---

## 4. 广告策略定制（Ad SDK）

### 接口规范

广告 Provider 需实现以下接口（TypeScript 风格）：

```typescript
interface AdProvider {
    /**
     * 展示激励视频广告
     * @param reason 触发原因（展示给用户看）
     * @returns 是否已观看完整广告
     */
    showRewarded(reason: string): Promise<{ rewarded: boolean }>;

    /**
     * 展示插屏广告
     */
    showInterstitial(): Promise<void>;
}
```

### 触发策略定制

广告触发逻辑在 `web/src/monetization/adTrigger.js`，当前策略：

| 触发条件 | 广告类型 | 上限 |
|---------|---------|------|
| `game_over` | 插屏（不可跳过前 5s） | 每局 1 次 |
| `no_clear` + `hadRecentNearMiss` | 激励（近失救济） | 每局 3 次 |
| `no_clear` + `frustrationLevel ≥ 5` | 激励（挫败救济） | 每局 3 次（共享上限） |

**自定义触发策略**（修改 `adTrigger.js`）：

```js
// 示例：仅在高分局次触发插屏
on('game_over', ({ data, game }) => {
    if (!getFlag('adsInterstitial')) return;
    if (isAdsRemoved()) return;

    // 自定义：仅分数 ≥ 100 才触发
    if ((data?.finalScore ?? 0) >= 100) {
        void showInterstitialAd();
    }
});
```

**配置化阈值**（接入 model config）：

```js
// 从后端模型配置读取阈值（而不是硬编码）
import { getModelConfig } from './personalization.js';

const cfg = getModelConfig();
const threshold = cfg?.adTrigger?.frustrationThreshold ?? 5;

if (profile.frustrationLevel >= threshold) {
    void _triggerRewarded('挫败救济', 'ad_reward_frustration');
}
```

---

## 5. IAP 策略定制（IAP SDK）

### 接口规范

```typescript
interface IapProvider {
    purchase(productId: string): Promise<{ success: boolean; receipt?: string }>;
    restore(): Promise<string[]>;
    isPurchased(productId: string): boolean;
}
```

### 产品目录定制

在 `web/src/monetization/iapAdapter.js` 中定义产品目录：

```js
export const IAP_PRODUCTS = [
    {
        id: 'remove_ads',
        name: '移除广告',
        type: 'non-consumable',  // 永久
        price: '$1.99',
        description: '永久移除所有插屏/Banner 广告',
    },
    {
        id: 'starter_pack',
        name: '新手礼包',
        type: 'consumable',  // 一次性消耗
        price: '$0.99',
        description: '限时一次：包含 ×3 提示机会',
    },
    {
        id: 'weekly_pass',
        name: '周卡通行证',
        type: 'subscription',  // 订阅
        period: 'weekly',
        price: '$1.49/周',
        description: '每周通行证：额外任务 + 专属皮肤',
    },
    {
        id: 'monthly_pass',
        name: '月卡通行证',
        type: 'subscription',
        period: 'monthly',
        price: '$3.99/月',
        description: '每月通行证：最佳性价比',
    },
];
```

---

## 6. 商业化分群策略

### 分群算法

后端 `monetization_backend.py` 中的 `_compute_user_profile` 计算 `whale_score`：

```python
whale_score = (
    (best_score / BEST_SCORE_NORM) * W_BEST_SCORE +
    (total_games / TOTAL_GAMES_NORM) * W_TOTAL_GAMES +
    (session_time / SESSION_TIME_NORM) * W_SESSION_TIME
)

# 分群阈值（来自 mon_model_config）
if whale_score >= cfg['segmentThresholds']['whale']:    # 默认 0.60
    segment = 'whale'
elif whale_score >= cfg['segmentThresholds']['dolphin']:  # 默认 0.30
    segment = 'dolphin'
else:
    segment = 'minnow'
```

### 调整分群权重

通过 `PUT /api/mon/model/config` 或训练面板修改：

```json
{
  "segmentWeights": {
    "best_score_norm":   0.40,
    "total_games_norm":  0.30,
    "session_time_norm": 0.30
  },
  "segmentThresholds": {
    "whale":   0.60,
    "dolphin": 0.30
  }
}
```

### 自定义分群维度

在 `monetization_backend.py` 的 `_compute_user_profile` 中添加新维度：

```python
# 例：加入近7日活跃天数维度
active_days_7d = db.execute(
    "SELECT COUNT(DISTINCT date(start_time, 'unixepoch')) "
    "FROM sessions WHERE user_id = ? AND start_time > ?",
    (user_id, int(time.time()) - 7 * 86400)
).fetchone()[0] or 0

activity_score = min(1.0, active_days_7d / 7.0)  # 归一化到 [0,1]
```

---

## 7. 个性化推荐策略

### 策略矩阵

前端 `personalization.js` 的 `_build_strategy` 根据分群和实时信号生成推荐动作：

```js
// 当前策略矩阵（简化版）
const STRATEGY_MATRIX = {
    whale: [
        { type: 'iap', product: 'monthly_pass', priority: 'high',
          trigger: () => true,  // 始终推荐
          why: '付费意愿强，月卡 ROI 最优' },
    ],
    dolphin: [
        { type: 'ads', format: 'rewarded', priority: 'high',
          trigger: (rt) => rt.hadNearMiss,  // 近失时推荐
          why: '近失时激励广告转化率最高' },
        { type: 'iap', product: 'weekly_pass', priority: 'medium',
          trigger: () => true,
          why: '中等用户对低价周期付费接受度高' },
    ],
    minnow: [
        { type: 'iap', product: 'starter_pack', priority: 'high',
          trigger: (rt) => rt.frustration >= 4,  // 挫败时推荐
          why: '挫败临界是首购最佳窗口' },
        { type: 'task', product: 'daily_tasks', priority: 'medium',
          trigger: () => true,
          why: '轻度用户需短期目标锚定' },
    ],
};
```

### 添加新的推荐规则

在 `personalization.js` 的 `_build_strategy` 函数末尾（或新的条件分支）添加：

```js
// 示例：高技能玩家推荐挑战榜
if (rt.skill >= 0.8 && segment !== 'whale') {
    actions.push({
        type: 'social',
        label: '排行榜挑战',
        product: 'leaderboard',
        priority: 'medium',
        icon: '🏆',
        active: false,
        why: `技能 ${(rt.skill * 100).toFixed(0)}% 可冲击榜单前列`,
        effect: '社交竞争驱动日活 +18%',
    });
}
```

---

## 8. RL 训练策略

### 奖励塑形参数

```json
{
  "RL_REWARD_SHAPING": {
    "comment": "所有奖励参数，修改后重训生效",
    "clearReward":      1.0,   "comment_clear": "每次消行奖励",
    "multiClearBonus":  0.5,   "comment_multi": "多行同消额外奖励",
    "comboBonus":       0.3,   "comment_combo": "连击奖励",
    "gameOverPenalty": -2.0,   "comment_over":  "游戏结束惩罚",
    "winBonus":        35,     "comment_win":   "达到胜利阈值奖励",
    "stuckPenalty":    -8.0,   "comment_stuck": "无合法位置惩罚",
    "potentialShaping": {
      "enabled": true,
      "coef":   0.8,           "comment_coef":  "势函数系数（步骤级奖励密度）",
      "heightPenalty": 0.1     "comment_height":"高度惩罚系数"
    },
    "outcome_mix": 0.5,        "comment_mix":   "结果vs过程回报混合比"
  }
}
```

### 课程学习策略

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `winThresholdStart` | 40 | 课程起始胜利门槛 |
| `winThresholdEnd` | 220 | 最终胜利门槛（= `winScoreThreshold`） |
| `rampEpisodes` | 40000 | 线性爬坡局数 |

调整建议：
- 起点过高（>80）→ 早期 winBonus 触发率 <5%，策略无法区分好坏 → 降低起点
- 爬坡过慢 → 长期在简单环境，泛化差 → 减少 rampEpisodes
- 爬坡过快 → 策略还未学会低分局就要面对高分局 → 增加 rampEpisodes

### 网络架构选择

```bash
# 小型快速（浏览器/实时交互）
RL_WIDTH=64 RL_DEPTH=2 npm run server:rl

# 标准（默认）
RL_WIDTH=128 RL_DEPTH=4 npm run server:rl

# 大型（离线训练追求性能）
RL_WIDTH=256 RL_DEPTH=6 python3 -m rl_pytorch.train --arch shared
```

---

## 9. 玩家成长策略

### XP 计算参数

在 `web/src/progression.js` 的 `computeXpGain` 函数，主要参数：

```js
const XP_CONFIG = {
    basePerScore:    0.10,   // 每分得 0.1 XP
    bonusPerClear:   1.5,    // 每次消行额外 1.5 XP
    bonusPerCombo3:  5.0,    // 三连击额外 5 XP
    dailyBonusMult:  2.0,    // 每日首局双倍 XP
    streakMultMax:   3.0,    // 连签最高 3 倍（上限）
    minXpPerGame:   10,      // 每局最低 10 XP
};
```

### 等级曲线

当前等级公式：`level = 1 + floor(sqrt(totalXp / 100))`，封顶 99。

自定义等级曲线：修改 `progression.js` 中的 `getLevelFromTotalXp`：

```js
// 线性曲线（每 200 XP 升一级）
export function getLevelFromTotalXp(totalXp) {
    return Math.min(99, 1 + Math.floor(totalXp / 200));
}
```

### 赛季通行证配置

在 `web/src/monetization/seasonPass.js` 中修改免费/付费轨奖励：

```js
export const FREE_TIERS = [
    { tier: 1,  xp: 100,  reward: '普通皮肤 × 1' },
    { tier: 2,  xp: 300,  reward: '道具：提示 × 3' },
    { tier: 3,  xp: 600,  reward: '特效：消行彩虹' },
    // ... 最多 10 tier
];

export const PAID_TIERS = [
    { tier: 1,  xp: 100,  reward: '稀有皮肤 × 1' },
    { tier: 5,  xp: 1500, reward: '传说皮肤：黄金方块' },
    // ...
];
```

---

## 10. 策略变更验证

策略调参要同时证明“参数生效”和“没有破坏公平性”。建议按变更范围选择验证命令：

| 变更范围 | 必跑验证 |
|----------|----------|
| stress / spawnTargets / 难度 | `npm test -- tests/adaptiveSpawn.test.js tests/blockSpawn.test.js tests/spawnModel.test.js` |
| 规则数据或形状数据 | `npm test -- tests/clearRules.test.js tests/shapes.test.js tests/miniprogramCore.test.js` |
| 商业化策略 | `npm test -- tests/monetization.test.js tests/commercialModel.test.js tests/adFreq.test.js` |
| 玩家画像或实时策略 | `npm test -- tests/playerProfile.test.js tests/playerAbilityModel.test.js tests/playstyle.test.js` |
| 提交前完整验证 | `npm test && npm run lint && npm run build` |

人工回归重点：

- 面板中 `stressBreakdown.finalStress` 与 `spawnTargets` 是否符合预期。
- 高填充、空洞多、连续未消行时是否触发救场，而不是继续加压。
- 高 skill / bored 场景是否更有挑战，但仍能通过 sequential solvability 和 mobility 护栏。
- Payoff 阶段是否更容易出现多消/清屏机会，setup 阶段是否避免直接把盘面堵死。
- Android/iOS 复用 Web 构建产物；小程序若要同步规则数据，先确认同步脚本不会覆盖小程序轻量定制模块。

---

> 有任何策略定制问题，欢迎在 [GitHub Discussions](https://github.com/btbujiangjun/openblock/discussions) 中讨论。
