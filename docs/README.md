# OpenBlock 文档导航

> 最后更新：2026-04-26  
> 在线查阅：[文档中心](http://localhost:5000/docs)（服务运行时可用）  
> 根目录文档：[README.md](../README.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) · [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 文档分类

### 0. 开发者指南（二次开发首读）

| 文档 | 说明 | 状态 |
|------|------|------|
| [二次开发指南](./DEV_GUIDE.md) | 新增模块/接入 SDK/扩展后端/测试规范；完整代码示例 | ✅ 当前 |
| [策略定制指南](./STRATEGY_GUIDE.md) | 出块权重/Stress信号/难度/广告/IAP/分群/个性化/RL 策略全集 | ✅ 当前 |
| [领域知识文档](./DOMAIN_KNOWLEDGE.md) | 游戏机制/心流理论/玩家心理/商业化原理/RL 基础 | ✅ 当前 |

---

### 1. 项目总览

| 文档 | 说明 | 状态 |
|------|------|------|
| [OpenBlock 技术总览](./PROJECT.md) | 前端分层、PyTorch RL、行为契约、商业化栈、后端要点 | ✅ 当前 |

---

### 2. 品类研究

| 文档 | 说明 | 状态 |
|------|------|------|
| [休闲游戏品类分析与系统研究](./CASUAL_GAME_ANALYSIS.md) | 竞品对标、能力模型、心流/挫败/节奏、Gap 分析（2026-04-08 快照） | ⚠️ 商业化分群部分已更新 |

---

### 3. 游戏设计

| 文档 | 说明 | 状态 |
|------|------|------|
| [难度模式：设计与实现](./DIFFICULTY_MODES.md) | Easy / Normal / Hard 全链路、计分、填充率、自适应 difficultyBias | ✅ 当前 |
| [消行计费规则](./CLEAR_SCORING.md) | 多消基础分、同 icon/同色 bonus、整十分约束、与形状库最大消除数；商业化策略存储索引 | ✅ 当前 |

---

### 4. 玩家系统

| 文档 | 说明 | 状态 |
|------|------|------|
| [玩家能力评估系统](./PLAYER_ABILITY_EVALUATION.md) | smoothSkill / historicalSkill / skillLevel 公式；会话历史环；置信度门控 | ✅ 当前 |
| [玩家面板参数手册](./PANEL_PARAMETERS.md) | 面板五区结构；各指标数学定义、tooltip、异常解读；参数关联图谱 | ✅ 当前 |
| [实时策略系统：信号流与出块链路](./REALTIME_STRATEGY.md) | PlayerProfile → 10 信号 → AdaptiveSpawn → StrategyAdvisor → UI 全链路 | ✅ 当前 |

---

### 5. 出块算法

| 文档 | 说明 | 状态 |
|------|------|------|
| [出块算法：三层架构](./SPAWN_ALGORITHM.md) | Layer 1-3 实现说明；game.js → adaptiveSpawn → blockSpawn 数据流 | ✅ 当前 |
| [自适应出块引擎：10 信号融合](./ADAPTIVE_SPAWN.md) | 10 维 stress 信号；10 档 profile 插值；spawnHints（Layer 2/3） | ✅ 当前 |
| [出块建模：规则引擎与 SpawnTransformer](./SPAWN_BLOCK_MODELING.md) | 规则引擎 vs SpawnTransformerV2 双轨；约束采样；ML 路径与网络结构 | ✅ 当前 |

---

### 6. 强化学习

| 文档 | 说明 | 状态 |
|------|------|------|
| [玩法与强化学习：解耦架构](./RL_AND_GAMEPLAY.md) | game_rules.json 单一数据源；网页自适应与 Python 训练解耦；改玩法顺序 | ✅ 当前 |
| [RL 分析：复杂度、模型与优化路径](./RL_ANALYSIS.md) | 状态/动作空间；训练瓶颈；课程阈值 40→220 / 40k ep | ✅ 当前 |
| [AlphaZero 对比与 RL v7 优化方案](./RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero 三支柱；差距诊断；v6/v7 优化（Q蒸馏/2-ply beam/评估门控）；消融实验命令 | ✅ 当前 |
| [浏览器端 RL 优化 v3](./RL_BROWSER_OPTIMIZATION.md) | 饱和根因；MLP 失败；线性模型 + 回报标准化方案；training.jsonl 联通 | ✅ 当前 |
| [RL 训练架构 v5：直接监督头](./RL_TRAINING_OPTIMIZATION.md) | v4 不收敛根因；DockBoardAttention；三直接监督头；精简奖励 | ✅ 当前 |
| [RL 训练：数值稳定与指标解读](./RL_TRAINING_NUMERICAL_STABILITY.md) | Lv 爆炸根因；裁剪与日志上限；环境变量表 | ✅ 当前 |
| [训练看板：数据流与刷新机制](./RL_TRAINING_DASHBOARD_FLOW.md) | 浏览器 vs PyTorch 数据源；轮询；refreshDashboardFull 步骤 | ✅ 当前 |
| [训练看板：趋势解读与调优建议](./RL_TRAINING_DASHBOARD_TRENDS.md) | 六图含义；健康/警惕形态；长训判读；优化优先级 | ✅ 当前 |

---

### 7. 商业化

| 文档 | 说明 | 状态 |
|------|------|------|
| [商业化策略完整文档（v3）](./MONETIZATION.md) | **唯一事实来源**：混合变现、分群矩阵、个性化引擎、所有模块与 API | ✅ 当前 |
| [商业化定制化指南](./MONETIZATION_CUSTOMIZATION.md) | **v3 重构后**：分层架构、三种定制粒度、cursor:help 字段速查、规则引擎扩展 | ✅ 当前 |
| [商业化模型训练面板：设计·原理·策略·内容·工程](./MONETIZATION_TRAINING_PANEL.md) | **5 维全方位**：商业理由 / 鲸鱼分模型 / 规则引擎 / 策略矩阵商业解读 / 调参 PlayBook / 4 Tab 详解 / 扩展指南 | ✅ 当前 |
| [📦 商业化路径研究（v1 归档）](./MONETIZATION_OPTIMIZATION.md) | 行业调研、竞品表、OPT-01~10 清单（§3 缺口已在 v3 全量实现） | 📦 归档 |
| [📦 个性化商业化设计（v2 归档）](./MONETIZATION_PERSONALIZATION.md) | 分群公式、策略矩阵、API 设计（内容已并入 v3） | 📦 归档 |

---

### 8. 平台扩展

| 文档 | 说明 | 状态 |
|------|------|------|
| [微信小程序适配说明](./WECHAT_MINIPROGRAM.md) | miniprogram/ 结构；adapters/；sync-core.sh；26 款皮肤、20 关关卡、动画链与出块保命同步 | ✅ 当前 |
| [微信小程序发布流程](./WECHAT_RELEASE.md) | 账号与类目、本地检查、上传、提审、上线、回滚与运维清单 | ✅ 当前 |

---

## 快速参考

### 核心事实（以代码为准）

| 问题 | 答案 | 来源 |
|------|------|------|
| 自适应 stress 信号维数 | **10 个**（scoreStress / runStreakStress / skillAdjust / flowAdjust / pacingAdjust / recoveryAdjust / frustrationRelief / comboReward / trendAdjust / confidenceGate） | `web/src/adaptiveSpawn.js` |
| 出块危险态保命 | `fill ≥ 0.68` 或 `roundsSinceClear ≥ 3` 进入严格可解性；`roundsSinceClear ≥ 2/4` 提升 `clearGuarantee` | `web/src/bot/blockSpawn.js`、`web/src/adaptiveSpawn.js` |
| 微信小程序皮肤数量 | **26 款**，由 `scripts/sync-miniprogram-skins.cjs` 从 `web/src/skins.js` 同步核心字段 | `miniprogram/core/skins.js` |
| 微信小程序关卡数量 | **20 关**，兼容 Web `target/minRounds/starThresholds` 目标字段 | `miniprogram/core/levelPack.js`、`levelManager.js` |
| RL 课程阈值 | `winThresholdStart=40`，`winThresholdEnd=220`，`rampEpisodes=40000` | `shared/game_rules.json` |
| Feature Flag 默认值 | 广告/IAP/Push 默认 **关**；任务/排行榜/皮肤/通行证/分享/Stub 默认 **开** | `web/src/monetization/featureFlags.js` |
| adTrigger 挫败阈值 | `frustrationLevel ≥ 5`（硬编码，未读 model config） | `web/src/monetization/adTrigger.js` |
| 商业化主文档 | [MONETIZATION.md](./MONETIZATION.md)（v3），其余商业化文档已归档 | — |
| 赛季 XP 估算 | `max(10, score×0.12 + clears×1.5)` | `web/src/monetization/seasonPass.js` |

### 阅读路线推荐

**新来的开发者（想做定制）** → [ARCHITECTURE.md](../ARCHITECTURE.md) → [DEV_GUIDE.md](./DEV_GUIDE.md) → [STRATEGY_GUIDE.md](./STRATEGY_GUIDE.md)  
**了解整体架构** → PROJECT.md  
**了解出块逻辑** → SPAWN_ALGORITHM.md → ADAPTIVE_SPAWN.md → SPAWN_BLOCK_MODELING.md  
**了解玩家感知** → PLAYER_ABILITY_EVALUATION.md → REALTIME_STRATEGY.md → PANEL_PARAMETERS.md  
**了解 RL 训练** → RL_AND_GAMEPLAY.md → RL_ANALYSIS.md → RL_TRAINING_OPTIMIZATION.md → RL_ALPHAZERO_OPTIMIZATION.md（v7 改进）  
**了解商业化** → MONETIZATION.md（直接看 v3 即可）  
**领域背景知识** → [DOMAIN_KNOWLEDGE.md](./DOMAIN_KNOWLEDGE.md)
