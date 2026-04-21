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

---

## 1. 出块策略定制

### 原理

出块引擎采用**三层架构**，策略在 Layer 2（体验优化层）通过 `stress → shapeWeights` 映射实现：

```
stress ∈ [-0.2, 1.0]  →  shapeWeights (形状类别权重)
  ↓
blockSpawn.js: 按权重随机采样方块组合
```

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
        "shapeWeights": {
          "single":    0.20,
          "domino":    0.30,
          "triomino":  0.30,
          "small_L":   0.15,
          "medium":    0.05,
          "large":     0.00,
          "five":      0.00
        }
      },
      {
        "stress": 0.0,
        "comment": "中性：标准混合出块",
        "shapeWeights": {
          "single":    0.05,
          "domino":    0.10,
          "triomino":  0.15,
          "small_L":   0.25,
          "medium":    0.30,
          "large":     0.10,
          "five":      0.05
        }
      },
      {
        "stress": 0.8,
        "comment": "高压力：挑战玩家极限",
        "shapeWeights": {
          "single":    0.00,
          "domino":    0.05,
          "triomino":  0.05,
          "small_L":   0.10,
          "medium":    0.25,
          "large":     0.35,
          "five":      0.20
        }
      }
    ]
  }
}
```

引擎会在相邻 profile 之间做**线性插值**，你可以添加任意数量的 profile 节点。

### 理解形状类别

| 类别 | 典型形状 | 占格数 | 难度 |
|------|---------|--------|------|
| `single` | 1×1 单格 | 1 | 极简 |
| `domino` | 1×2 直条 | 2 | 简单 |
| `triomino` | L形3格 | 3 | 简单 |
| `small_L` | 小 L/T 形 | 3-4 | 中等 |
| `medium` | 2×2/L4/Z形 | 4-5 | 中等 |
| `large` | 1×4/1×5 长条 | 4-5 | 困难 |
| `five` | 五连方块 | 5 | 极难 |

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

当前 10 维信号均在 `web/src/adaptiveSpawn.js` 中计算：

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
| 10 | 置信门控 | `confidenceGate` | [0, 1] | 低置信度收窄调节 |

### 禁用特定信号

在 `game_rules.json` 中添加信号配置（需在 `adaptiveSpawn.js` 中读取）：

```json
{
  "adaptiveSpawn": {
    "signals": {
      "runStreakStress": { "enabled": false },
      "trendAdjust":    { "enabled": false, "comment": "跨会话数据不可信时禁用" }
    }
  }
}
```

然后在 `adaptiveSpawn.js` 的信号计算中读取此配置（示例）：

```js
const signalCfg = cfg.signals ?? {};
const runStreakStress = (signalCfg.runStreakStress?.enabled ?? true)
    ? runMods.stressBonus
    : 0;
```

### 添加自定义信号

在 `adaptiveSpawn.js` 的 stress 合成区块添加：

```js
// 自定义：连续失误惩罚信号
const missStreakPenalty = profile.missRate > 0.6
    ? -0.1 * (profile.missRate - 0.6) / 0.4  // 失误率超 60% 时降压救济
    : 0;

stress += missStreakPenalty;
```

---

## 3. 难度模式定制

### 三档难度参数

在 `shared/game_rules.json` 中定义各难度的基线偏移：

```json
{
  "difficultyBias": {
    "easy":   -0.3,
    "normal":  0.0,
    "hard":    0.4
  }
}
```

`difficultyBias` 直接叠加到最终 stress 值，负值降低整体难度，正值提高。

### 新增难度档位

1. 在 `game_rules.json` 的 `difficultyBias` 中添加新键
2. 在 `web/src/difficulty.js` 的 `resolveLayeredStrategy` 中添加读取逻辑
3. 在 `web/src/config.js` 的 `STRATEGIES` 数组中添加新策略项

```js
// web/src/config.js
export const STRATEGIES = [
    { id: 'easy',   label: '简单',   icon: '🌱', difficultyBias: -0.3 },
    { id: 'normal', label: '普通',   icon: '⚡', difficultyBias:  0.0 },
    { id: 'hard',   label: '困难',   icon: '🔥', difficultyBias:  0.4 },
    { id: 'ultra',  label: '地狱',   icon: '💀', difficultyBias:  0.8 },  // 新增
];
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

> 有任何策略定制问题，欢迎在 [GitHub Discussions](https://github.com/btbujiangjun/openblock/discussions) 中讨论。
