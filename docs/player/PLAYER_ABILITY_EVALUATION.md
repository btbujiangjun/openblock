# 玩家能力评估系统

> Open Block 自适应出块引擎的核心：基于多层时间尺度的玩家技能建模。

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│  数据层                                                              │
│  ───────                                                             │
│  即时（步级）  滑动窗口 15 步       thinkMs / cleared / fill / miss  │
│  中期（局级）  sessionHistory[30]   每局摘要：score/clearRate/skill   │
│  长期（聚合）  后端 user_stats      totalGames/Score/Clears/Misses   │
│                                                                      │
│  计算层                                                              │
│  ───────                                                             │
│  smoothSkill    指数平滑实时技能（前 5 步贝叶斯快速收敛）             │
│  historicalSkill 会话历史加权均值 × 后端统计基线                      │
│  trend          指数加权线性回归斜率 → 进步/退步                      │
│  confidence     局数 × 新鲜度 → 数据可信程度                         │
│  skillLevel     blend(smoothSkill, historicalSkill, confidence)       │
│                                                                      │
│  消费层                                                              │
│  ───────                                                             │
│  adaptiveSpawn  10 维信号合成 stress → profile 插值 → shapeWeights   │
│  spawnHints     clearGuarantee / sizePreference / diversityBoost     │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. 核心指标定义

### 2.1 即时能力（步级）

| 指标 | 公式 | 范围 | 说明 |
|------|------|------|------|
| `smoothSkill` | `s += α(raw - s)` | 0~1 | 5 维加权原始分 × 指数平滑 |
| `momentum` | 窗口前半/后半 clearRate 差 | -1~1 | 局内表现趋势 |
| `cognitiveLoad` | thinkMs 方差 / 阈值 | 0~1 | 犹豫程度 |
| `engagementAPM` | 窗口操作次/分钟 | ≥0 | 参与活跃度 |
| `flowDeviation` | \|boardPressure/skill - 1\| | 0~2 | 心流偏离度 |

**原始技能 5 维权重：**

| 维度 | 权重 | 计算 |
|------|------|------|
| 思考速度 | 0.15 | `1 - clamp((thinkMs - 800) / 12000)` |
| 消行率 | 0.30 | `clamp(clearRate / 0.55)` |
| 多行占比 | 0.20 | `clamp(comboRate / 0.45)` |
| 无失误率 | 0.20 | `1 - clamp(missRate / 0.3)` |
| 认知从容 | 0.15 | `1 - cognitiveLoad` |

### 2.2 中期能力（局级）

| 指标 | 来源 | 范围 | 说明 |
|------|------|------|------|
| `historicalSkill` | sessionHistory + statsBaseline | 0~1 | 长周期综合技能 |
| `trend` | 指数加权线性回归 | -1~1 | 跨局进步/退步方向 |
| `confidence` | 局数 × 新鲜度 | 0~1 | 历史数据可信度 |

### 2.3 最终输出 `skillLevel`

```
stepsInSession = 当前局内步数
halfWindow     = 滑窗大小 / 2
smoothWeight   = min(1, stepsInSession / halfWindow)
histWeight     = (1 - smoothWeight) × confidence
skillLevel     = smoothSkill × (1 - histWeight) + historicalSkill × histWeight
```

**效果：**
- 开局 0 步 → `smoothWeight=0` → 完全依赖 historicalSkill（冷启动不再盲猜）
- 局中 8+ 步 → `smoothWeight=1` → 完全依赖 smoothSkill（实时反应优先）
- 新玩家（confidence≈0）→ `histWeight≈0` → 保守回到 0.5

## 3. 会话历史环（Session History Ring）

### 存储

```javascript
// localStorage: openblock_player_profile.sessionHistory
[
  { score: 1200, placements: 45, clears: 12, misses: 3,
    maxCombo: 4, clearRate: 0.267, skill: 0.62,
    duration: 180000, ts: 1713100000000 },
  // ... 最多 30 条
]
```

### 指数加权均值

```
decay = 0.85
histSkill = Σ(skill_i × 0.85^(n-1-i)) / Σ(0.85^(n-1-i))
```

最近一局权重 = 1.0，倒数第二局 = 0.85，第三 = 0.72 …… 远古局自然衰减。

### 与后端统计融合

```
sessionWeight = min(1, historyLength / 10)
finalHistorical = histSkill × sessionWeight + statsBaseline × (1 - sessionWeight)
```

会话记录不足 10 条时，后端聚合统计作为补充；10 条以上则完全由会话历史驱动。

## 4. 趋势计算（Trend）

对 `sessionHistory` 中的 `skill` 序列做**指数加权最小二乘回归**：

```
x_i = i / (n-1)        （归一化序列位置）
y_i = skill_i
w_i = 0.9^(n-1-i)      （近期权重大）

slope = (Σw · Σwxy - Σwx · Σwy) / (Σw · Σwx² - (Σwx)²)
trend = clamp(slope × 2, -1, 1)
```

| trend 值 | 含义 | 自适应响应 |
|----------|------|-----------|
| > 0.3 | 明显进步 | stress +δ（可承受更大挑战） |
| -0.1 ~ 0.1 | 稳定 | 无额外调整 |
| < -0.3 | 明显退步 | stress -δ（减压保留乐趣） |

## 5. 置信度（Confidence）

```
gameConf = min(1, totalGames / 20)
freshnessConf = 离线 > 24h ? max(0.3, 1 - (hours-24)/240) : 1.0
confidence = gameConf × freshnessConf
```

| 场景 | confidence | 效果 |
|------|-----------|------|
| 新用户 0 局 | 0 | skillAdjust 完全失效，保守策略 |
| 5 局活跃玩家 | ~0.25 | skillAdjust 仅 55% 幅度 |
| 20+ 局活跃玩家 | ~1.0 | skillAdjust 100% 幅度 |
| 20+ 局但离线 3 天 | ~0.7 | 技能估计向 0.5 回归，调节幅度适度 |

## 6. 自适应出块集成

`resolveAdaptiveStrategy` 中新增两个信号维度：

```javascript
// 置信度门控：低置信时收窄技能调节幅度
confGate = 0.4 + 0.6 × confidence
skillAdjust = (skillLevel - 0.5) × skillAdjustScale × confGate

// 趋势调节：进步玩家可承受更多挑战
trendAdjust = trend × trendAdjustScale × confidence

stress = scoreStress + runStreak + skillAdjust + flowAdjust
       + pacingAdjust + recoveryAdjust + frustrationRelief
       + comboReward + nearMissAdjust + feedbackBias
       + trendAdjust   // ← 新增
```

**关键设计：置信度门控（Confidence Gate）**

```
confGate = 0.4 + 0.6 × confidence
```

- confidence = 0（无历史）→ confGate = 0.4 → skillAdjust 仅 40% 力度
- confidence = 1（充分历史）→ confGate = 1.0 → 完全信任

这避免了：数据不足时过度相信 skillLevel → 出块难度剧烈波动。

## 7. 数据流

```
                      ┌─ init() ──────────────────────────┐
                      │  db.getStats() → ingestHistorical  │
                      └────────────────────────────────────┘
                                     │
                                     ▼
       ┌─ 新局 start() ───────────────────────────────────┐
       │  recordNewGame()                                   │
       │  resolveAdaptiveStrategy(skillLevel ← historical)  │
       └───────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              recordSpawn()    recordPlace()    recordMiss()
              feedbackBias     smoothSkill ↑     missRate ↑
                    │                │                │
                    └────────┬───────┘                │
                             ▼                        │
                    spawnBlocks() → resolveAdaptiveStrategy()
                    skillLevel = blend(smooth, historical, conf)
                    stress 合成 → shapeWeights 插值
                             │
                             ▼
                    ┌─ endGame() ──────────────────────┐
                    │  recordSessionEnd(gameStats)       │
                    │  → sessionHistory.push(summary)    │
                    │  → save() → localStorage           │
                    └──────────────────────────────────┘
```

## 8. 持久化格式

```json
{
  "smoothSkill": 0.62,
  "totalLifetimePlacements": 1450,
  "totalLifetimeGames": 38,
  "sessionHistory": [
    {
      "score": 1200,
      "placements": 45,
      "clears": 12,
      "misses": 3,
      "maxCombo": 4,
      "clearRate": 0.267,
      "skill": 0.62,
      "duration": 180000,
      "ts": 1713100000000
    }
  ],
  "savedAt": 1713100200000
}
```

## 9. 回放快照扩展

`buildPlayerStateSnapshot` 新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `historicalSkill` | number | 历史技能基线 |
| `trend` | number | 长周期趋势 |
| `confidence` | number | 数据置信度 |

adaptive 子对象中同步输出 `trend`、`confidence`、`historicalSkill`。

## 10. 可调参数一览

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `SESSION_HISTORY_CAP` | playerProfile.js | 30 | 会话历史环容量 |
| `SKILL_DECAY_HOURS` | playerProfile.js | 24 | 离线开始衰减的小时数 |
| `历史加权 decay` | _getHistoricalCache | 0.85 | 会话历史指数衰减因子 |
| `趋势回归 decay` | _getHistoricalCache | 0.9 | 趋势回归指数衰减因子 |
| `gameConf 上限` | _getHistoricalCache | 20 局 | 置信度饱和所需局数 |
| `freshnessConf 下限` | _getHistoricalCache | 0.3 | 长期离线的最低置信 |
| `confGate 下限` | adaptiveSpawn.js | 0.4 | 无历史时的 skillAdjust 保底系数 |
| `trendAdjustScale` | game_rules.json (flowZone) | 0.08 | 趋势对 stress 的调节幅度 |
| `statsBaseline 融合` | ingestHistoricalStats | 10 局 | 会话历史 vs 后端统计权重转折 |

## 11. 对比优化前后

| 维度 | 优化前 | 优化后 |
|------|--------|--------|
| 冷启动 | 固定 0.5 + 5 步快速收敛 | historicalSkill 作为强先验 |
| 跨局学习 | 无（仅存 smoothSkill） | 30 局会话历史 + 后端统计基线 |
| 趋势感知 | 无 | 指数加权线性回归 trend |
| 数据可信度 | 无 | confidence 门控 skillAdjust |
| 自适应稳定性 | 可能剧烈波动 | confGate 保底 40% |
| 新玩家识别 | 仅 placement < 20 | placement < 20 **且** 历史 < 3 局 |
