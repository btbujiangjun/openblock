# OpenBlock 文档导航

> 最后更新：2026-04-20  
> 所有文档均可在 [文档中心](http://localhost:5000/docs) 在线查阅（服务运行时）。

---

## 权威文档（以本表为准）

| 文档 | 定位 | 状态 |
|------|------|------|
| [PROJECT.md](./PROJECT.md) | 技术总览：前端分层、RL、行为契约、商业化栈、后端要点 | ✅ 当前 |
| [MONETIZATION.md](./MONETIZATION.md) | **商业化策略唯一事实来源**（v3，合并 v1+v2） | ✅ 当前 |
| [SPAWN_ALGORITHM.md](./SPAWN_ALGORITHM.md) | 出块三层架构（Layer1-3 实现说明） | ✅ 当前 |
| [ADAPTIVE_SPAWN.md](./ADAPTIVE_SPAWN.md) | 自适应出块引擎：10 信号融合 + spawnHints | ✅ 当前 |
| [SPAWN_BLOCK_MODELING.md](./SPAWN_BLOCK_MODELING.md) | 出块算法建模：规则引擎 vs SpawnTransformer | ✅ 当前 |
| [PLAYER_ABILITY_EVALUATION.md](./PLAYER_ABILITY_EVALUATION.md) | 玩家能力评估：smoothSkill / historicalSkill 公式 | ✅ 当前 |
| [PANEL_PARAMETERS.md](./PANEL_PARAMETERS.md) | 玩家画像面板各指标定义与物理含义 | ✅ 当前 |
| [REALTIME_STRATEGY.md](./REALTIME_STRATEGY.md) | 实时策略链路：PlayerProfile → AdaptiveSpawn → UI | ✅ 当前 |
| [DIFFICULTY_MODES.md](./DIFFICULTY_MODES.md) | 难度模式全链路（Easy / Normal / Hard） | ✅ 当前 |
| [RL_AND_GAMEPLAY.md](./RL_AND_GAMEPLAY.md) | 玩法与 RL 解耦说明 | ✅ 当前 |
| [RL_ANALYSIS.md](./RL_ANALYSIS.md) | RL 游戏复杂度与模型合理性分析 | ✅ 当前 |
| [RL_ALPHAZERO_OPTIMIZATION.md](./RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero 对比与 v6 优化方案 | ✅ 当前 |
| [RL_BROWSER_OPTIMIZATION.md](./RL_BROWSER_OPTIMIZATION.md) | 浏览器端 RL v3 优化（饱和修复） | ✅ 当前 |
| [RL_TRAINING_OPTIMIZATION.md](./RL_TRAINING_OPTIMIZATION.md) | RL 训练架构 v5：直接监督头 | ✅ 当前 |
| [RL_TRAINING_NUMERICAL_STABILITY.md](./RL_TRAINING_NUMERICAL_STABILITY.md) | 数值稳定与看板指标解读 | ✅ 当前 |
| [RL_TRAINING_DASHBOARD_FLOW.md](./RL_TRAINING_DASHBOARD_FLOW.md) | 训练看板数据流与刷新行为 | ✅ 当前 |
| [RL_TRAINING_DASHBOARD_TRENDS.md](./RL_TRAINING_DASHBOARD_TRENDS.md) | 训练看板趋势解读与优化建议 | ✅ 当前 |
| [CASUAL_GAME_ANALYSIS.md](./CASUAL_GAME_ANALYSIS.md) | 休闲游戏领域分析（2026-04-08 快照） | ⚠️ 部分内容早于商业化落地 |
| [WECHAT_MINIPROGRAM.md](./WECHAT_MINIPROGRAM.md) | 微信小程序适配说明 | ✅ 当前 |
| [MONETIZATION_OPTIMIZATION.md](./MONETIZATION_OPTIMIZATION.md) | 商业化调研报告 v1（历史快照） | 📦 归档 |
| [MONETIZATION_PERSONALIZATION.md](./MONETIZATION_PERSONALIZATION.md) | 个性化商业化设计文档 v2（已并入 v3） | 📦 归档 |

---

## 按主题索引

### 游戏设计 & 玩法
- [DIFFICULTY_MODES.md](./DIFFICULTY_MODES.md) — Easy/Normal/Hard 全链路
- [CASUAL_GAME_ANALYSIS.md](./CASUAL_GAME_ANALYSIS.md) — 竞品与品类研究
- [WECHAT_MINIPROGRAM.md](./WECHAT_MINIPROGRAM.md) — 小程序平台差异

### 玩家系统
- [PLAYER_ABILITY_EVALUATION.md](./PLAYER_ABILITY_EVALUATION.md) — 能力评估公式
- [PANEL_PARAMETERS.md](./PANEL_PARAMETERS.md) — 面板指标定义
- [REALTIME_STRATEGY.md](./REALTIME_STRATEGY.md) — 信号流与实时策略链

### 出块算法
- [SPAWN_ALGORITHM.md](./SPAWN_ALGORITHM.md) — 三层架构总览
- [ADAPTIVE_SPAWN.md](./ADAPTIVE_SPAWN.md) — 自适应引擎细节
- [SPAWN_BLOCK_MODELING.md](./SPAWN_BLOCK_MODELING.md) — 建模与 SpawnTransformer

### 强化学习
- [RL_AND_GAMEPLAY.md](./RL_AND_GAMEPLAY.md) — 解耦说明
- [RL_ANALYSIS.md](./RL_ANALYSIS.md) — 复杂度分析
- [RL_ALPHAZERO_OPTIMIZATION.md](./RL_ALPHAZERO_OPTIMIZATION.md) — v6 方案
- [RL_BROWSER_OPTIMIZATION.md](./RL_BROWSER_OPTIMIZATION.md) — 浏览器端优化
- [RL_TRAINING_OPTIMIZATION.md](./RL_TRAINING_OPTIMIZATION.md) — 训练架构
- [RL_TRAINING_NUMERICAL_STABILITY.md](./RL_TRAINING_NUMERICAL_STABILITY.md) — 数值稳定
- [RL_TRAINING_DASHBOARD_FLOW.md](./RL_TRAINING_DASHBOARD_FLOW.md) — 看板数据流
- [RL_TRAINING_DASHBOARD_TRENDS.md](./RL_TRAINING_DASHBOARD_TRENDS.md) — 趋势解读

### 商业化
- [MONETIZATION.md](./MONETIZATION.md) — **主文档**（v3，唯一事实来源）
- [MONETIZATION_OPTIMIZATION.md](./MONETIZATION_OPTIMIZATION.md) — 📦 v1 调研（归档）
- [MONETIZATION_PERSONALIZATION.md](./MONETIZATION_PERSONALIZATION.md) — 📦 v2 设计（归档）

### 项目架构
- [PROJECT.md](./PROJECT.md) — 全栈技术说明

---

## 常见问题（FAQ）

**Q: 商业化看哪份文档？**  
A: 只看 [MONETIZATION.md](./MONETIZATION.md)（v3），其余两份商业化文档已归档，仅作历史参考。

**Q: 出块算法看哪份？**  
A: 实现架构看 [SPAWN_ALGORITHM.md](./SPAWN_ALGORITHM.md)；自适应引擎细节看 [ADAPTIVE_SPAWN.md](./ADAPTIVE_SPAWN.md)；ML 建模看 [SPAWN_BLOCK_MODELING.md](./SPAWN_BLOCK_MODELING.md)。

**Q: 自适应压力有几个信号维度？**  
A: **10 个**（scoreStress / runStreakStress / skillAdjust / flowAdjust / pacingAdjust / recoveryAdjust / frustrationRelief / comboReward / trendAdjust / confidenceGate）。详见 `web/src/adaptiveSpawn.js` 头部注释与 [ADAPTIVE_SPAWN.md](./ADAPTIVE_SPAWN.md)。

**Q: RL 课程阈值是多少？**  
A: 默认 `winThresholdStart=40`，`winThresholdEnd=220`，`rampEpisodes=40000`（见 `shared/game_rules.json`）。

**Q: Feature Flag 默认状态？**  
A: 广告（rewarded/interstitial）和 IAP、Web Push 默认 **关闭（false）**；每日任务、排行榜、皮肤解锁、赛季通行证、回放分享、Stub 模式默认 **开启（true）**。
