# 个性化商业化策略设计文档

> 版本 v2 · 2026-04-20  
> 在 [MONETIZATION_OPTIMIZATION.md](./MONETIZATION_OPTIMIZATION.md)（v1）基础上，补充基于用户行为序列的个性化能力

---

## 一、整体架构

```
SQLite 行为数据                   PlayerProfile 实时信号
(sessions / behaviors /           (skillLevel / frustration /
 user_stats / scores)              hadNearMiss / flowState)
        │                                  │
        ▼                                  ▼
 [后端] /api/mon/user-profile   ←→   [前端] personalization.js
  ├─ 分群计算（Whale/Dolphin/Minnow）
  ├─ 策略矩阵（见第三节）
  └─ 缓存到 mon_user_segments
        │
        ├──► commercialInsight.js → 注入 #insight-commercial（玩家画像面板）
        │
        └──► monPanel.js → 悬浮训练面板（总览 / 用户画像 / 模型配置 / 功能开关）
```

### 数据流时序

```
游戏启动
  └─ initMonetization(game)
       ├─ attach(game)                   ← 包装 game.logBehavior
       ├─ initCommercialInsight(game)    ← 注入策略解释区（立即渲染）
       ├─ initMonPanel(game)             ← 右下角悬浮按钮
       └─ fetchPersonaFromServer(userId) ← 延迟 2s 拉取服务端画像

每次出块 (spawn_blocks)
  └─ updateRealtimeSignals(playerProfile) → _refreshCommercialSection(game)

每次游戏结束 (game_over)
  └─ leaderboard.submitScore → seasonPass.addSeasonXp(estimated)
       └─ commercialInsight 200ms 后刷新
```

---

## 二、用户分群（Segmentation）

### 2.1 分群维度与计算公式

| 维度 | 数据来源 | 计算方式 | 权重 |
|------|----------|----------|------|
| **最高分** | `user_stats.best_score` | `min(1, score/2000)` | 0.40（默认） |
| **总局数** | `user_stats.total_games` | `min(1, games/50)` | 0.30 |
| **平均时长** | `sessions.duration` | `min(1, avg_sec/600)` | 0.30 |

```
whale_score = w0 × best_score_norm + w1 × total_games_norm + w2 × avg_session_norm
```

- **Whale** （鲸鱼）：`whale_score ≥ 0.60` → 高价值用户
- **Dolphin**（海豚）：`0.30 ≤ whale_score < 0.60` → 中等用户
- **Minnow** （小鱼）：`whale_score < 0.30` → 轻度/新用户

### 2.2 活跃度评分

```
activity_score = 0.6 × min(1, recent_7d_games/7) + 0.4 × (recent_7d_games > 0 ? 1 : 0)
```

### 2.3 分群缓存

计算结果写入 `mon_user_segments`，有效期 1 小时（服务端）/ 1 小时（客户端 localStorage）。  
`GET /api/mon/user-profile/<user_id>?force=1` 可强制重新计算。

---

## 三、个性化策略矩阵

| 分群 | 实时信号 | 推荐策略 | 原因 |
|------|----------|----------|------|
| Whale | 任意 | 月卡通行证（IAP） | 高价值用户付费意愿强 |
| Whale | frustration ≥ 5 | 提示包（IAP） | 降低流失风险 |
| Whale | 任意 | 禁止插屏广告 | 避免高价值用户流失 |
| Dolphin | 任意 | 周卡通行证 | 中等用户 ROI 最高 |
| Dolphin | hadNearMiss=true | 激励视频广告（near-miss 触发） | 近失时转化率 +40% |
| Dolphin | activity_score < 0.4 | 推送连签提醒 | 提升 D7 留存 |
| Minnow | game_over | 插屏广告 | 轻度用户广告收入占比高 |
| Minnow | frustration ≥ 5 | 新手礼包（限时 IAP） | 高挫败感激活首次付费 |
| Minnow | 任意 | 每日任务 | 提升 D1 留存，为后续转化蓄力 |

---

## 四、实时信号说明

| 信号 | 来源 | 含义 | 触发阈值 |
|------|------|------|----------|
| `frustrationLevel` | `PlayerProfile._consecutiveNonClears` | 连续未消行次数 | ≥ 5 触发救济广告/提示包 |
| `hadRecentNearMiss` | `PlayerProfile.hadRecentNearMiss` | 上一步填充>60%但未消行 | 触发激励广告 |
| `flowState` | `PlayerProfile.flowState` | 心流状态（flow/bored/anxious） | flow 状态抑制广告 |
| `skillLevel` | `PlayerProfile.skillLevel` | 技能评分 0~1 | 影响策略显示标签 |
| `sessionPhase` | `PlayerProfile.sessionPhase` | 会话阶段（early/peak/late） | 影响策略优先级权重 |

---

## 五、新增后端 API

### 5.1 用户商业画像

```http
GET /api/mon/user-profile/<user_id>?force=0
```

**响应示例：**
```json
{
  "user_id": "u_abc",
  "segment": "dolphin",
  "whale_score": 0.42,
  "activity_score": 0.65,
  "skill_score": 0.71,
  "frustration_avg": 0.12,
  "near_miss_rate": 0.34,
  "recent_7d_games": 5,
  "total_games": 28,
  "best_score": 850,
  "avg_session_sec": 312,
  "max_combo": 4,
  "strategy": {
    "segment": "dolphin",
    "actions": [
      { "type": "iap", "product": "weekly_pass", "priority": "medium" },
      { "type": "ads", "format": "rewarded", "trigger": "near_miss", "priority": "high" }
    ],
    "explain": "中等用户（Dolphin），周卡 ROI 最高；近失率 34%，激励广告在 near-miss 时转化率高"
  },
  "cached": false
}
```

### 5.2 全局聚合（训练面板）

```http
GET /api/mon/aggregate
```

返回 `total_users`、`dau_7d`、`games_7d`、`avg_score_30d`、`avg_session_sec_30d`、
`segment_dist`（分群分布）、`behavior_dist`（行为事件 Top-10）、`lb_participants_today`。

### 5.3 模型配置

```http
GET  /api/mon/model/config       # 读取当前配置
PUT  /api/mon/model/config       # 更新配置（深合并顶层键）
```

**可调参数：**
- `segmentWeights` — 分群权重（`best_score_norm`、`total_games_norm`、`session_time_norm`）
- `segmentThresholds` — 分群阈值（`whale`、`dolphin`）
- `adTrigger` — 广告触发配置（`frustrationThreshold`、`maxRewardedPerGame`）
- `iapTrigger` — IAP 展示时机
- `taskWeights` — 任务经验值权重

### 5.4 策略曝光日志

```http
POST /api/mon/strategy/log
Body: { "userId": "u_abc", "strategy": "dolphin_near_miss_ad", "action": "show", "converted": 0 }
```

---

## 六、新增 SQLite 表

| 表名 | 字段 | 用途 |
|------|------|------|
| `mon_user_segments` | `user_id, segment, whale_score, activity_score, skill_score, frustration_avg, near_miss_rate, last_computed` | 分群缓存（1h TTL） |
| `mon_model_config` | `id, config(JSON), updated_at` | 个性化模型配置，默认行 `id='default'` |
| `mon_strategy_log` | `user_id, strategy, action, converted, logged_at` | 策略曝光/转化日志 |

---

## 七、前端模块索引

| 文件 | 职责 |
|------|------|
| `monetization/personalization.js` | 个性化引擎核心：拉取画像、维护实时信号、生成洞察对象 |
| `monetization/commercialInsight.js` | 非侵入式注入 `#insight-commercial` 到玩家画像面板 |
| `monetization/monPanel.js` | 商业化模型训练面板（浮动，右下角 📊 按钮） |
| `monetization/adTrigger.js` | 广告触发逻辑（已修复 nearMiss 信号路径） |
| `monetization/seasonPass.js` | 赛季通行证（已修复 XP 估算公式） |

---

## 八、已修复的历史 Bug

### Bug-1：adTrigger 引用不存在的 `nearMissBonus` 字段

- **原因**：`PlayerProfile` 无 `getSnapshot()` 方法，也无 `nearMissBonus` 字段
- **修复**：改为直接读 `profile.hadRecentNearMiss`（布尔 getter）
- **新增**：`frustrationLevel ≥ 5` 时也触发救济激励广告

### Bug-2：seasonPass 的 `xpGained` 永远为 0

- **原因**：`game.logBehavior(GAME_OVER)` 在 `applyGameEndProgression()` 之前触发，
  `data.xpGained` 不存在
- **修复**：改为从 `finalScore` + `totalClears` 估算 XP（与 `computeXpGain` 基础公式对齐）
  `estimatedXp = max(10, floor(score × 0.12) + floor(clears × 1.5))`

---

## 九、扩展路线

1. **A/B 测试框架**：在 `mon_model_config` 中增加 `abTest` 字段，随机分配用户到不同策略桶
2. **转化漏斗分析**：利用 `mon_strategy_log` 构建 show → click → purchase 转化率
3. **实时模型更新**：基于 `mon_strategy_log` 的转化数据，定期用梯度下降调整分群权重
4. **皮肤解锁接线**：将 `skinUnlock.js` 的 `isSkinUnlocked()` 接入 `skins.js` 渲染过滤
5. **多设备同步**：将 `mon_user_segments` 关联 `user_id`，支持跨设备画像读取
