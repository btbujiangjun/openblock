# 最佳分追逐策略：挑战自我而不轻易超越（Best Score Chase Strategy）

> **读者**：主策划人、策略设计师、运营策略负责人；二级读者：体验算法工程师、运营 QA。  
> **定位**：本文以"挑战玩家**自己的**最佳得分（personal best）"为核心主策略，沉淀**当前实现的事实**、**玩家四维关系矩阵**与**改进/优化点**，是 OpenBlock 体验设计在"留存动力"维度上的策划契约文档。  
> **不是**：本文不是计分规则手册（详见 `docs/product/CLEAR_SCORING.md`），不是难度模式说明（详见 `docs/product/DIFFICULTY_MODES.md`），不是自适应出块算法手册（详见 `docs/algorithms/ADAPTIVE_SPAWN.md`）；本文聚焦"**最佳分这条主线**"在不同玩家身上**应该如何呈现、如何调控**。  
> **维护**：改动 `getSpawnStressFromScore` / `deriveScoreMilestones` / `LIFECYCLE_STRESS_CAP_MAP` / `_maybeCelebrateNewBest` / `best.gap.*` 文案 / `dynamicDifficulty` / `runDifficulty` 配置时，必须同步更新本文的"当前事实"对应小节与改进项编号。
>
> **v1.55 落地状态（2026-05-16）**：§4.1 / §4.2 / §4.3 / §4.4 / §4.5 / §4.6 / §4.7 / §4.8 / §4.9 / §4.10 / §4.11 / §4.12 / §4.13 全部完成代码落地与单测覆盖（共 50 个新增单测，文件 `tests/bestScoreChaseStrategy.test.js`；全量 1407 个测试通过）。`§5` 季度规划改为"已交付"快照；§6 验证清单的对应条目都可勾选。
>
> **v1.55.10 修订（2026-05-16，用户反馈驱动）**：
> 1. **PB 双源 / 跨局泄漏 / 可疑 PB 皇冠** 5 个风险点全部修复（见 §4 末"v1.55.10 修复"）。
> 2. **局内 score milestone toast 大幅克制**：MIN_BEST=500 门槛 + [0.50, 0.75, 0.90] 三档 + base/post-PB 各 1 次（每局最多 2 次激励）；文案从"分数突破 490!"改为**"已达最佳 50%"** 百分比格式。
> 3. **新增「追平最佳」轻量特效**：score === bestScore 且 best ≥ 500 时触发一次绿色 toast，与"金色破 PB"形成"追平→突破"的两段叙事。
> 4. 测试 1429 个全通过、lint 0 errors。
>
> **v1.55.11 收敛（2026-05-16，用户反馈驱动）**：
> 1. **撤销「追平最佳」特效**（`_maybeCelebrateTiePersonalBest` 改为 no-op）；
> 2. **撤销「已达最佳 N%」milestone toast 渲染**（adaptiveSpawn 的 `scoreMilestoneHit` 数据流保留给 DFV / 分析侧）；
> 3. **「刷新最佳」单局只触发一次**（CELEBRATIONS_PER_RUN_CAP 3 → 1），二度 / 三度纪录只静默更新 `bestScore`；
> 4. **「刷新最佳」文案统一加 🏆 前缀 + 感叹号**（19 个 i18n 语言全覆盖），zh-CN 由"新纪录"改为"🏆 刷新最佳！"。
> 5. 测试 1428 个全通过、lint 0 errors。详见 §5.y。
>
> **stress 域口径（v1.55.17）**：本文 §4 / §4.9 等小节中的 `stress < 0.7`、`min(0.85, stress + …)`、`stress × 0.7` 等公式均为**算法内部 raw 域 `[-0.2, 1]`**，与源码一致便于维护时直接对照；面板 / DFV / 玩家可见的 stress 是经 `(raw + 0.2) / 1.2` 归一化后的 norm 域 `[0, 1]`（raw `0.7` ≈ norm `0.75`、raw `0.85` ≈ norm `0.875`）。详见 [自适应出块 §3.5](../algorithms/ADAPTIVE_SPAWN.md#35-stress-域口径v15517) 的完整对照表与例外说明。
>
> **v1.56.7 HUD 三数自洽修复（2026-05-18，用户反馈驱动）**：
> 1. **updateUI 顺序 bug**：`_maybeCelebrateNewBest()` 从 `updateUI` 末尾移到开头，修复 "得分 210 / 最佳 140 / 已超 190" 三数错乱（"最佳" DOM 慢一帧）。
> 2. **gap=0 隐藏 HUD**：D4 进入条件从 `gap <= 0` 收紧为 `gap < 0`；追平基线那一帧由 PB 烟花独立反馈，不再显示 "已超 0 分" / "本局 +0"。
> 3. **文案明确化**：`已超 N 分` → `本局 +N`（zh-CN）/ `+N pts` → `Run +N`（en），让玩家能从 `score - "本局 +N"` 自洽推断开局基线。
> 4. 1552 个测试全通过、lint 0 errors。详见 §5.α.10。
>
> **v1.57 stress 感知化层（2026-05-18，用户反馈驱动："stress 指标不太能体现到玩家感受上来"）**：
> 1. **诊断**：算法精算的 stress 经 5 个渠道传导，其中 **音效/震动/视觉氛围/主 HUD/节奏** 全部断层，唯一生效的是出块差异化（但玩家说不清"为什么块变难了"）。stressMeter 在 insightPanel 内，多数玩家从不打开。结果：策略隐性原则被错误执行成"策略隐形"。
> 2. **修复**：新增 `web/src/stressAmbience.js` 模块，把 finalStress (norm) 通过 4 个独立渠道渗透到玩家感官：
>    - **A 棋盘氛围光**：`#game-wrapper::before` outer box-shadow 颜色随 stress 6 档变化（冷青/薄荷/暖绿/琥珀/橙红/暗红）
>    - **B 呼吸节奏**：`--stress-ambience-breath-ms` 驱动外缘 opacity 呼吸（低 stress 4.2s 缓慢 / 高 stress 1.5s 急促）
>    - **C 震动幅度**：装饰 `renderer.setShake` 让 intensity × `[0.85, 1.30]` 倍率（高压震动更强）
>    - **D 音频低通滤波**：BiquadFilter 插入 audioFx.master → destination，cutoff 随 stress 调节（高压闷感）
> 3. **策略隐性保持**：所有反馈都是"氛围"不是"信息"，不写任何数字 / 标签到主 HUD（契约测试验证 export 列表不含 render/show/label/text 类）。
> 4. 1595 个测试全通过（+43 个 stressAmbience 用例）、lint 0 errors。详见 §5.α.11。
>
> **v1.57.1 stress → 出块算法精算细化（2026-05-18，用户追问驱动："stress 反应到出块算法上，如何体现"）**：
> 1. **诊断**：stress 在算法层的 5 条传导路径（profile 插值 / spawnTargets 投影 / targetSolutionRange / orderRigor / spawnIntent）中 **后三条存在台阶感或断档**——stress=0.55 跨阈值"突然变难"，0.35~0.60 区间无难度差，D4 段顺序刚性弱。
> 2. **修复 4 项算法增强**：
>    - **P0** `orderRigor` 改用 softplus ramp（`stressTerm = softplus((stress-0.55)/0.08) * 0.08 * 1.6`），消除 0.55 跨阈值台阶感
>    - **P1** `solutionDifficulty.ranges` 新增 '渐紧' 档（minStress=0.5, max=64），让 0.5~0.6 区间也有可感知软上限
>    - **P2** D4 段 + stress ≥ 0.85 时 orderRigor 注入额外 +0.25 强锁死（`pbChase.overshoot.orderBoostInD4HighStress`），把 maxValidPerms 真正压到 tight=2
>    - **P3** `spawnIntent` 新增 'sprint' 中间档（stress ∈ [0.45, 0.55)），平滑 maintain → pressure 过渡，避免 hints 套装一脚跨进 pressure
> 3. **面板/i18n 同步**：`stressMeter.SPAWN_INTENT_NARRATIVE` / `decisionFlowViz.SPAWN_INTENT_COLOR+DESC` / `playerInsightPanel.SPAWN_INTENT_LABEL` / `intent_lexicon.json` / `dfv.intent.sprint+dfv.reason.sprint` 全链路同步新增 sprint。
> 4. **策略隐性保持**：sprint 文案"节奏渐紧，逐步收束"中性陈述；中文标签"渐紧"在 insightPanel 才可见；主 HUD 不暴露。
> 5. 1614 个测试全通过（+19 个 P0–P3 用例）、lint 0 errors。详见 §5.α.12。
>
> **v1.57.1 多端同步（2026-05-18，用户驱动："策略从 web 主端同步到其他三端"）**：
> 1. **mobile**（Capacitor iOS/Android shell）：`webDir: "../dist"` 直接复用 web 构建产物，**零改动自动同步**。
> 2. **miniprogram**（微信小程序）：P0/P1/P3 完整同步；P2 在 `gameRulesData.js` 补 `pbChase.overshoot.orderBoostInD4HighStress=0.25 / orderHighStressMin=0.85` 配置占位（D4 算法链路本身未移植，因小程序简化版整体缺 pbOvershoot/pbExtremeOrderBoost 等前置依赖）。
> 3. **rl_pytorch / spawn_model**（行为克隆 V3 模型）：`SPAWN_INTENT_VOCAB` 末尾加 'sprint'（6→7 维），`BEHAVIOR_CONTEXT_DIM` 56→57，`intent_slice` 切片 `[48:54]→[48:55]`，`test_v3.py` 断言 `(B, 6)→(B, 7)`。否则新数据中的 `'sprint'` 会被 dataset 静默映射成 `'maintain'`，破坏行为克隆对齐。**vocab 末尾追加保证 idx 0~5 与旧版兼容**；`BEHAVIOR_CONTEXT_DIM` 变化导致旧 checkpoint 需重训（input shape 不匹配，预期破坏）。
> 4. **rl_pytorch / policy 主线**（PPO/MCTS，`STATE_FEATURE_DIM=181`）：不消费 spawnIntent，**零改动**。
> 5. **rl_pytorch / game_rules.py**：不主动读取 `adaptiveSpawn` / `topologyDifficulty` / `pbChase` / `sprintIntent` 节点，**零改动**。
> 6. 多端验证：web 1614 / miniprogram node check / rl_pytorch spawn_model 5/5 / rl_pytorch 全量 76/76 全部通过。详见 §5.α.12 "多端同步策略" 小节。

---

## 0. 一句话主张（One-liner Pitch）

> **"再差一点点，就能刷新自己。"**  
> OpenBlock 把"打破个人最佳分"作为**单玩家、无尽模式、无关卡终局**下的**唯一长期目标**：所有自适应难度、节奏调控、叙事文案、奖励兑现都围绕**让玩家感到这件事很近但需要付出**展开——不轻易超越，又不至于绝望。

---

## 1. 设计哲学：为什么以"挑战最佳分"为核心

### 1.1 品类背景（行业事实）

| 现象 | 主流休闲游戏经验 | 对 OpenBlock 的启示 |
|------|------------------|-----------------------|
| **High Score Loop** | 街机时代到当代 endless（Hoppy2D / Flappy Bird / Block Blast）的核心驱动力都是"刷新前一次的自己"。即时反馈 + 短局 + 立刻重来 = "再一把"心理。 | 必须把 personal best 写入主 HUD，并在玩家**接近**它时主动放大临场感。 |
| **Near-Miss > 胜利 ≈ 失败** | 差 1-2 步未达标时续玩率高于"轻松达成"和"惨败"（差一点效应；Candy Crush 心理学实证）。 | 接近最佳分时反而要**温和加压**，让玩家在"几乎成功"的状态收尾，而非"提早封顶后空虚"。 |
| **个人最佳是节奏锚点** | Endless 的"好 PB"通常 = 上一次 PB ×（1.05–1.30）。一次性翻倍要么是 outlier，要么意味着"上次太水"。 | 自适应难度应当让 PB 增长**有节奏**（每 N 局升 5%–25%），避免某局玩家凭运气翻倍后此后再也不可能更新。 |
| **"Personal" > "Global"** | 个人 PB 的"我可以">>排行榜的"别人更强"。后者会让中低水位玩家放弃。 | OpenBlock 已把局内 stress 锚定 `bestScore` 而非全球档位；社交/排行榜是次级激励，不是主线。 |
| **奖励要稀有但可期** | Variable Ratio Reward；"打破 PB 的烟花"只能少见才珍贵。 | 仅在**严格大于** `bestScore` 时触发新纪录庆祝；每局只一次。 |

### 1.2 OpenBlock 的产品取舍

> 这些是**与品类默认做法不同**的具体选择，便于评审/复盘判断它们是否仍适用。

| 取舍 | 选择 | 代价 | 回报 |
|------|------|------|------|
| **PB 是不是唯一终局目标** | 是（无尽模式默认）；关卡模式/赛季有独立目标但不取代 PB 作为长线驱动力。 | 缺少"通关感"的玩家偏好可能转向竞品。 | 不需要做"内容生产 treadmill"也能维持长期留存。 |
| **PB 是否影响难度** | **是**，scoreStress 直接由 `score / max(bestScore, floor)` 派生（v1.13）。 | 老玩家比新玩家的同分数表现更难（必要预期）。 | 老玩家不会"开局 0 分被 6 个里程碑连击"，也不会"过末档后压力锁死最高"。 |
| **PB 临近时是否额外加压** | **是**（"B 类挑战加压"），但**有上限**与**心流互抑**。 | 部分玩家会觉得"越接近 PB 越难"，需要叙事配合解释。 | 把"差一点"的临场感放大；同时防止破纪录后体验断崖。 |
| **PB 庆祝的强度** | 全屏震屏 + 双闪光 + 浮层弹幕；但**一局一次**。 | 重复刷新 PB 的玩家只能拿到首次的烟花。 | 保持稀有性，避免成为 spam。 |
| **PB 是否区分难度档** | v1.55 起客户端层按难度分桶（`bestScoreBuckets.js`），HUD 显示当前难度的 PB；后端 `db.getBestScore()` 仍为全难度（保留容灾合并空间）。 | 服务器侧仍是全难度合并值，跨设备同步走 `localStorageStateSync` 同步分桶字段。 | Easy / Normal / Hard 各自独立 PB；详见 §4.4。 |

### 1.3 与既有体验模型的关系

本文不重复 [体验设计基石（5 轴体验结构）](./EXPERIENCE_DESIGN_FOUNDATIONS.md) 与 [策略体验栈（L1–L4 通用模型）](./STRATEGY_EXPERIENCE_MODEL.md) 的方法论，而是**把它们投影到 PB 这条主线**上：

- **挑战-能力轴（C）**：PB 接近度是高承受力玩家的天然挑战源；为承受力不足的玩家（新手 / 回流 / 高挫败）按 `LIFECYCLE_STRESS_CAP_MAP` 软封顶。
- **节奏-报偿轴（R）**：分数里程碑（绝对/相对双制）按"上一次 PB × {0.25, 0.5, 0.75, 1.0, 1.25}"切节奏，让接近 PB 的最后一段更有冲刺感。
- **情感-共鸣轴（E）**：`best.gap.victory`（"即将刷新最佳！冲刺！"）与新纪录烟花做情感锚定；`best.gap.far` 给"继续努力~"做长尾陪伴。
- **认知-学习轴（K）**：score-push 守卫（v1.31）把 intense 档"保活"叙事改成"冲分仪式感"，避免空盘高压违和。
- **掌控-心流轴（F）**：占用率衰减（occupancyDamping）防止 scoreStress 在低占用时单独把 stress 推到高压。

---

## 2. 玩家关系矩阵：四维差异化

> 本节定义"差异化"的判据。同一个 PB 距离，对不同玩家应当呈现不同的体验。  
> 矩阵维度：**生命周期阶段 S** × **成熟度档位 M** × **PB 距离档 D** × **本局阶段 P**。

### 2.1 维度 1：生命周期阶段 S（参考 `getPlayerLifecycleStageDetail`）

| Code | 名称 | 判定（days × sessions） | 对 PB 策略的影响 |
|------|------|--------------------------|--------------------|
| **S0** | 新入场（onboarding） | days ≤ 3 且 sessions ≤ 10 | 不强调 PB；强调"今天比昨天好"。stress cap=0.50，adjust=−0.15。 |
| **S1** | 激活（exploration） | days ≤ 14 且 sessions ≤ 50 | 引入 PB 概念；首次破 PB 是核心激活事件。cap=0.60–0.70。 |
| **S2** | 习惯（growth） | days ≤ 30 且 sessions ≤ 200 | PB 成为主要驱动力；按 M 档拉开承受力。cap=0.65–0.82。 |
| **S3** | 稳定（stability） | days ≤ 90 且 sessions ≤ 500 | PB 增长曲线放缓；引入"季度 PB"等次级目标（改进项 §4.7）。cap=0.72–0.88。 |
| **S4** | 回流（veteran/winback） | 超过 stability 上界，或 daysSinceLastActive ≥ 7 | **首要任务是回到上一次 PB 附近**，而不是继续突破；preset cap=0.55–0.80 + winbackPreset stressCap=0.60。 |

### 2.2 维度 2：成熟度档位 M（参考 `getMaturityBand`，源于 SkillScore）

| Code | 名称 | SkillScore 区间 | 对 PB 策略的影响 |
|------|------|------------------|--------------------|
| **M0** | 新手 | 0–39 | PB 自身就是奖励；不要叠加 B 类挑战加压。 |
| **M1** | 成长 | 40–59 | 里程碑节奏感最重要；按相对档位 [0.25..1.25] 拉满。 |
| **M2** | 熟练 | 60–79 | PB ±10% 是"心流可冲刺区"；建议保留 challengeBoost。 |
| **M3** | 资深 | 80–89 | 接受 orderRigor（顺序刚性，v1.32）+ challengeBoost 上限 0.15。 |
| **M4** | 核心 | ≥ 90 | 接受 stress cap=0.88、orderRigor 满档；新 PB 之间间隔应控制在数局内，避免"高原期"。 |

### 2.3 维度 3：PB 距离档 D（本文新引入的策划口径）

> 当前代码中只有 `best.gap` UI 走过 0.02 / 0.05 两档；本节统一为四档便于策略设计。

| Code | 名称 | 定义（`pct = score / max(bestScore, 1)`） | 当前 UI / 算法挂钩 |
|------|------|---------------------------------------------|---------------------|
| **D0** | 远征 | pct < 0.50 | scoreStress × decayFactor=0.4；UI `best.gap.far`（"继续努力~"）。 |
| **D1** | 跟随 | 0.50 ≤ pct < 0.80 | scoreStress 按插值直通；UI `best.gap.neutral`（"差 N 分"）。 |
| **D2** | 临近 | 0.80 ≤ pct < 0.95 | **触发 B 类挑战加压**（challengeBoost ≤ 0.15）；UI `best.gap.neutral`。 |
| **D3** | 决战 | 0.95 ≤ pct ≤ 1.02 | UI `best.gap.close`（≤0.05）/ `best.gap.victory`（≤0.02）；challengeBoost ≈ 0.15 上限；score-push 守卫激活叙事。 |
| **D4** | 突破段 | pct > 1.02 | scoreStress 按 `percentileMaxOver=0.2` 外推；触发 `_maybeCelebrateNewBest`；之后进入"破纪录后释放窗口"。 |

### 2.4 维度 4：本局阶段 P（参考 `sessionArc`）

| Code | 名称 | 判据 | 对 PB 策略的影响 |
|------|------|------|--------------------|
| **P0** | warmup | 本局前 3 轮出块 | 不展示 best.gap；避免开局焦虑。 |
| **P1** | peak | 中段 | 主舞台；challengeBoost / 里程碑 / `best.gap.*` 都在此阶段生效。 |
| **P2** | cooldown | profile.sessionPhase = 'late' | 不主动加压；若 D ≥ D2，叙事维持冲刺感。 |

### 2.5 当前策略矩阵（已实现）

> 简化表：S × M 给 stress cap/adjust（见 §3.5）；其余维度叠加（D 与 P）以下方表头标注。

|  | M0 新手 | M1 成长 | M2 熟练 | M3 资深 | M4 核心 |
|---|---|---|---|---|---|
| **S0 新入场** | 0.50 / −0.15 | — | — | — | — |
| **S1 激活** | 0.60 / −0.10 | 0.65 / −0.05 | 0.70 / 0 | — | — |
| **S2 习惯** | 0.65 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.82 / +0.10 | — |
| **S3 稳定** | — | 0.72 / 0 | 0.78 / +0.05 | 0.85 / +0.10 | 0.88 / +0.12 |
| **S4 回流** | 0.55 / −0.15 | 0.60 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.80 / +0.08 |

- 表外组合（如 S2·M4、S3·M0）当前**不应用 cap/adjust**（`getLifecycleStressCap` 返回 null）。改进项 §4.1 提出补全。
- D 维度调制仅在 `isBClassChallenge` 命中时进入（D2/D3）；D4（突破段）允许 stress 短暂外推到 `1 + percentileMaxOver`。
- P0（warmup）阶段不应触发 best.gap UI 与 challengeBoost；当前实现已通过 `sessionArc` 间接覆盖，但缺乏显式 gate（改进项 §4.5）。

---

## 3. 当前策略详细陈述

> 本节按"数据 → 算法 → 反馈"自下而上展开。所有事实均能追到 `web/src/` 与 `shared/game_rules.json`。

### 3.1 数据基础与持久化

| 字段 | 文件 / 位置 | 物理含义 | 写入时机 |
|------|--------------|-----------|------------|
| `Game.bestScore` | `web/src/game.js` | 玩家账号历史最佳分（跨所有难度档共享） | 局末 if `score > _bestScoreAtRunStart` 写 SQLite（`db.saveScore`） |
| `Game._bestScoreAtRunStart` | `web/src/game.js` | **本局开始时**的 bestScore 快照；防止本局新刷的 PB 触发"自我超越"判定循环 | 每局 `start()` 时拷贝 |
| `Game._newBestCelebrated` | `web/src/game.js` | 本局已触发烟花的开关（一局一次） | `_maybeCelebrateNewBest` 首次命中后置位 |
| `_spawnContext.bestScore` | `web/src/game.js` → `_spawnContext` | 传给 `adaptiveSpawn` 的副本 | 每局开始时一次性灌入 |

**已知边界**：`bestScore` 当前不区分难度档（Easy/Normal/Hard 共用同一字段）；改进项 §4.4 提议分桶。

### 3.2 scoreStress：个人百分位映射（v1.13）

**入口**：`web/src/difficulty.js → getSpawnStressFromScore(score, { bestScore })`，由 `adaptiveSpawn.resolveAdaptiveStrategy` 调用。

**关键算法**：

```
denom = max(bestScore, dynamicDifficulty.scoreFloor=180)
pct   = score / denom
projected = min(milestonesLast × (1 + percentileMaxOver=0.2), pct × milestonesLast)
stress = interpolate(milestones [0,45,90,135,180] → spawnStress [0,0.18,0.38,0.58,0.78], projected)
if pct < percentileDecayThreshold=0.5  →  stress *= percentileDecayFactor=0.4
```

**策略语义**：

| 段 | 行为 | 设计意图 |
|----|------|------------|
| `bestScore = 0` | 退回旧绝对档位（首次开局） | 新装机玩家用绝对节奏 |
| `pct < 0.5` | stress × 0.4 | **前半程放心冲**，不要让老玩家在低分段就被加压 |
| `0.5 ≤ pct < 1.0` | 直接插值到曲线 | "进入冲刺区"；与 D1/D2 区段对齐 |
| `pct ≥ 1.0` | 按 `percentileMaxOver=0.2` 外推 | **允许突破段比上次 PB 多 20% 内仍可调控难度**，之后不再加压（防破纪录后断崖） |

**配置位**：`shared/game_rules.json → dynamicDifficulty.{milestones, spawnStress, scoreFloor, percentileDecayThreshold, percentileDecayFactor, percentileMaxOver}`。

### 3.3 分数里程碑：绝对/相对双制（v1.49）

**入口**：`web/src/adaptiveSpawn.js → deriveScoreMilestones(bestScore)`。

| bestScore | 里程碑表 | 设计意图 |
|----|----|----|
| `< 200` | `[50, 100, 150, 200, 300, 500]` | 新手或初始玩家拿稳定"50→100→150"节奏 |
| `≥ 200` | `[0.25, 0.5, 0.75, 1.0, 1.25] × bestScore` | 老玩家在开局后**仍能感受到 5 个里程碑**，最后一个 1.25× 是"挑战刷新"节点 |

**触发效果**：跨过里程碑时 `_scoreMilestoneHit = true`，由 `strategyAdvisor` 生成"里程碑达成"卡片（priority 0.85），并触发 `effect.scoreMilestone` 浮层（"分数突破 N！"）。

**与 PB 的耦合点**：相对档位的 `1.0 × bestScore` 节点几乎就是"D3 决战段入口"；`1.25 × bestScore` 是"破纪录后继续征服"的目标线（改进项 §4.6 提议补成"PB+25% 二度里程碑"叙事）。

### 3.4 B 类挑战加压：接近 PB 自动加难

**入口**：`web/src/adaptiveSpawn.js`（约 L941–L965）。

**触发条件**（必须同时满足）：

1. `profile.segment5 === 'B'`（中度无尽玩家）**或** `profile.sessionTrend !== 'declining'`（不在下行趋势）；
2. `ctx.bestScore > 0`（已建立 PB 锚点）；
3. `score >= ctx.bestScore × 0.8`（**进入 D2 临近 / D3 决战段**）；
4. `stress < 0.7`（避免叠加溢出）。

**幅度**：

```
challengeBoost = min(0.15, (score / bestScore − 0.8) × 0.75)
if friendlyBoardRelief < −0.09  →  challengeBoost *= 0.42   // v1.29 互抑
stress = min(0.85, stress + challengeBoost)
```

**策略语义**：

- 0.8 是"明确接近"的阈值；0.15 上限保证不会越过 `tense → intense` 一档以上。
- 与 friendlyBoardRelief（友好盘面救济，v1.13）互抑：盘面 holes=0 且 nearFullLines≥2 且 payoff 期时 friendlyBoardRelief 介入；如果同帧两者都强，challengeBoost ×0.42 让位，避免"既要救济又要加压"的锯齿。
- 不进入 D4 突破段（pct > 1）后不再加压：让玩家感受到"破纪录瞬间反而轻盈"。

### 3.5 生命周期 × 成熟度 stress cap

**入口**：`web/src/lifecycle/lifecycleStressCapMap.js → LIFECYCLE_STRESS_CAP_MAP`（v1.50 抽出，详见 [生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)）。

**应用顺序**（`adaptiveSpawn.js`）：

```
1. 多信号融合得 raw stress
2. 查 LIFECYCLE_STRESS_CAP_MAP[`${stage}·${band}`]
3. if stress > cap → stress = cap，写 lifecycleCapAdjust
4. stress += adjust，写 lifecycleBandAdjust
5. clamp [−0.2, 1]
6. occupancyDamping（低填充衰减）
7. smoothStress（最多每帧 +0.18 / −0.28）
8. winbackPreset.stressCap（≥7 天回流玩家二次封顶到 0.6）
9. challengeBoost（B 类挑战加压）
10. flowPayoffStressCap（flow 期高压互斥保护）
```

**对 PB 主线的意义**：cap 决定了"高承受力玩家在 D3 决战段能感受到多大压力"——同样是 `score = 0.95 × bestScore`，S0·M0 玩家被压回 cap=0.50；S3·M4 玩家可以一路冲到 cap=0.88。这是 PB 体验差异化的**核心阀门**。

### 3.6 新手保护与回流保护

| 场景 | 触发判据 | 对 PB 的影响 |
|------|----------|----------------|
| **新手保护**（首局 5 spawn 内） | `profile.isInOnboarding === true` | stress 强制 `≤ firstSessionStressOverride = −0.15`；不展示 best.gap；不触发 challengeBoost。 |
| **Winback 保护**（≥7 天未活跃） | `getActiveWinbackPreset()` 返回 preset | stress cap 强制 `≤ 0.60`；clearGuarantee +1；保留 3 局保护期。 |
| **挫败救济** | `profile.needsRecovery === true` 或 `frustrationLevel ≥ 5` | 救场期间禁用 `minStressFloor` / 禁用 orderRigor；建议同步禁用 challengeBoost（改进项 §4.2）。 |
| **被困救济**（v1.30 bottleneckRelief） | `firstMoveFreedom ≤ 阈值` | 同上；目前仍可与 challengeBoost 同帧（改进项 §4.2）。 |

### 3.7 叙事与 UI

#### 3.7.1 `best.gap` HUD（实时距离提示）

| 文案 key | 触发（`ratio = gap / bestScore`） | i18n（zh-CN） |
|----------|-------------------------------------|-----------------|
| `best.gap.victory` | `gap > 0` 且 `ratio ≤ 0.02`（D3 决战段最近） | "即将刷新最佳！冲刺！" |
| `best.gap.close` | `0.02 < ratio ≤ 0.05` | "接近了！💪" |
| `best.gap.neutral` | 其他 `gap > 0` 时 | "差 {{gap}} 分" |
| `best.gap.far` | （目前未挂接到实际触发，i18n 资源已就位） | "继续努力~" |

**已知缺口**：`best.gap.far` 文案存在但无触发路径；改进项 §4.3。

#### 3.7.2 Score-push 高压守卫（v1.31）

`intent ∈ {flow, harvest}` 且 `level ∈ {tense, intense}` 且 `boardFill < 0.30` 且 `holes === 0` → 改用 `SCORE_PUSH_HIGH_STRESS_NARRATIVE_BY_LEVEL` 叙事："冲击新高，节奏紧绷；盘面仍开阔，稳住关键落点把分数稳稳推上去"。

**意义**：消除"空盘 + intense + 'flow 保活' 文案"的认知冲突。

#### 3.7.3 新纪录庆祝（`_maybeCelebrateNewBest`）

仅在 `score > _bestScoreAtRunStart` 时触发；一局一次：

- `triggerBonusMatchFlash(3)` + `triggerPerfectFlash()` + `setShake(18, 900)`
- `.new-best-popup` 浮层 2.3 s
- 局末 over-score 旁加 `.new-best-crown`（🏆）
- 写入 SQLite + 更新 `runStats`

#### 3.7.4 `runDifficulty`（连战局间）

仅在"再来一局"连续路径生效：`maxStreak=6` × `fillBonusPerGame=0.01` + `spawnStressBonusPerGame=0.045`；回菜单即清零。  
**对 PB 主线的意义**：玩家连战时初始填充与压力都略高，更难"凭运气"刷新 PB；间接保护"PB 是真实能力的标定"。

### 3.8 当前策略事实清单一图速查

```
                                  + Run Streak (+0.045/局, max 6)
                                  + B-Class Challenge Boost (≤0.15, D2-D3 only)
ScoreStress(pct, bestScore) ─┐
   |  (pct<0.5 → ×0.4)        │
Lifecycle Stage S0..S4 ──────┤    + Lifecycle Band Adjust (±0.15)
Maturity Band  M0..M4 ───────┼──► Raw Stress ──► Cap (LIFECYCLE_STRESS_CAP_MAP)
                              │                       │
Onboarding/Winback Bypass ───┘                       ├─► Occupancy Damping
                                                      ├─► Smooth (+0.18/-0.28/step)
                                                      ├─► Winback Cap (≤0.60)
                                                      ├─► Challenge Boost
                                                      └─► Flow-Payoff Cap (≤0.79)
                                                              │
                                                              ▼
                                                       Final Stress
                                                              │
                                       ┌──────────────────────┼───────────────────────┐
                                       ▼                      ▼                       ▼
                              Difficulty Profile      SpawnHints              UI Narrative
                              (10 档插值)              (clearGuarantee /        (best.gap.* /
                                                       multiClearBonus /       score-push 守卫 /
                                                       orderRigor)             new-best 庆祝)
```

---

## 4. 改进与优化点（编号 + 优先级 + 落地难度）

> 每个改进项都标注：触发的原因（"现实问题 / 玩家体验差距"）、改进方向、估计代价、风险。  
> **本文只做规划，不在本次提交修改代码**。后续拆 PR 时按编号引用。

### 4.1 LIFECYCLE_STRESS_CAP_MAP 死键与跨格补全（P0）　✅ v1.55 已落地

**问题**：调制表当前缺 `S0·M1+`、`S2·M4`、`S3·M0` 等组合（约 8 个 `S·M` 死键）。`getLifecycleStressCap` 返回 null 时下游静默跳过 cap/adjust，**raw stress 直通**——若此时 challengeBoost / scoreStress 同时活跃，会让中等画像玩家偶发拿到与表外预期不符的高 stress。

**改进**（已落地）：

1. ✅ 已补全 25 格 `S·M`（5×5）映射：见 `web/src/lifecycle/lifecycleStressCapMap.js`，按"行内单调（M0→M4 cap 递增）+ S0 整体 cap≤0.65 + S4 < S2/S3 同 band"原则插值；
2. ✅ `LIFECYCLE_STAGE_CODES` / `LIFECYCLE_BAND_CODES` 已对外导出，供 panel 与单测枚举使用；
3. ✅ 新增单测 `§4.1 LIFECYCLE_STRESS_CAP_MAP 25 格全覆盖（无死键）` 4 条：枚举 25 组合全有效 + 行内单调 + S0 钳制 + S4 ≤ S2/S3。

**风险**：补的新格会改变线上分布；已让既有契约测试 `tests/challengeDesignOptimization.test.js` P1-1 反映新事实（S3·M0 现 cap=0.65）。

### 4.2 救济期与 challengeBoost 互斥（P0）　✅ v1.55 已落地

**问题**：当前 `isBClassChallenge` 仅看 `segment5/sessionTrend` 与 PB 距离，**没有把 `profile.needsRecovery` / `hasBottleneckSignal` / `frustrationLevel ≥ frustThreshold` 排除**。极端 case：玩家被困（firstMoveFreedom=1）+ 接近 PB → bottleneckRelief −0.12 与 challengeBoost +0.15 同帧抵消，玩家感受到"加压被悄悄消掉"，PB 临场感被稀释。

**改进**（已落地）：

在 `web/src/adaptiveSpawn.js` 重构 `isBClassChallenge` 为 8 段优先级 bypass 判定：

```js
let challengeBoostBypass = null;
if (!pbDistanceClose)                              challengeBoostBypass = 'pb_distance_far';
else if (!(segment5 === 'B' || sessionTrend !== 'declining'))
                                                   challengeBoostBypass = 'segment_declining';
else if (!(stress < 0.7))                          challengeBoostBypass = 'stress_saturated';
else if (profile.needsRecovery === true)           challengeBoostBypass = 'recovery';
else if (hasBottleneckSignal)                      challengeBoostBypass = 'bottleneck';
else if (frustrationLevel >= frustThreshold)       challengeBoostBypass = 'frustration';
else if (sessionArc === 'warmup')                  challengeBoostBypass = 'warmup';        // §4.5
else if (ctx.postPbReleaseActive === true)         challengeBoostBypass = 'post_pb_release'; // §4.9
const isBClassChallenge = challengeBoostBypass === null;
```

`stressBreakdown.challengeBoostBypass` 持久化 bypass 原因（DFV / stressMeter / 单测可见）。

**单测**：`§4.2 + §4.5 isBClassChallenge bypass` 7 条，逐项覆盖 8 种 bypass + 字段存在性。

### 4.3 `best.gap.far` 触发挂接 + D0 远征陪伴叙事（P1）　✅ v1.55 已落地

**问题**：i18n 19 个语言包都备好了 `best.gap.far`（"继续努力~"），但 `updateUI` 中 `ratio` 只走 victory/close/neutral 三档，**远征区（D0）无任何陪伴文案**。

**改进**（已落地）：

1. ✅ `best.gap.far` 触发阈值改为 `ratio > 0.50`（pct < 0.5，对应 D0 远征段）；
2. ✅ 新增轮换文案池：`best.gap.far` / `best.gap.far.alt1` / `best.gap.far.alt2`，按本局已落子数 `placements % 3` 选一条；alt2 / 主文案都用 `{{best}}` 占位 PB 数值，给玩家数值锚定（"本次最佳 1200 · 慢慢追"）；
3. ✅ zh-CN 与 en 两个核心语言包都补齐 3 条；其他 17 语言走 zh-CN fallback（与既有 `best.gap.victory / close / neutral / far` 同等级处理，不强制 19 全有）；
4. ✅ §4.5 warmup gate 同时启用：本局前 3 个落子不展示任何 best.gap 文案，避免开局拥堵。

**单测**：`§4.3 best.gap.far 远征陪伴文案（主 + alt1 + alt2）` 4 条覆盖文案存在 + {{best}} 占位 + zh-CN/en 平价。

### 4.4 PB 按难度档分桶（P1）　✅ v1.55 已落地（客户端层）

**问题**：当前 `db.saveScore(score, strategy)` 写入了 strategy 字段但 `db.getBestScore()` 仅返回**全难度**最高分。

**改进**（已落地客户端层 MVP）：

1. ✅ 新建 `web/src/bestScoreBuckets.js`：`submitScoreToBucket(strategy, score)` / `getBestByStrategy(strategy)` / `getAllBestByStrategy()`；持久化 key=`openblock_best_by_strategy_v1`；
2. ✅ `Game.init()` 启动时读 bucket PB，若小于全账号 PB 则用 bucket 值（更精确，避免 Easy 刷分污染 Normal）；
3. ✅ 每局 endGame 写入对应 strategy 的 bucket；未知 strategy 自动回退到 `normal`；
4. ✅ HUD 新增 `best-strategy-badge` 元素，hard 时显示 🔥 HARD 金色闪烁，easy 时显示 🌱 EASY 绿色；normal 隐藏（减少视觉噪音）；
5. ✅ 服务器侧 `db.saveScore` 保持原状（仍写单一全账号 PB），分桶 PB 走 localStorage + §4.11 跨设备同步；后端 schema 改动留待大型 PR。

**单测**：`§4.4 + §4.7 bestScoreBuckets` 8 条覆盖 submit / get / 跨 strategy 隔离 / 未知 strategy fallback。

### 4.5 D × P 显式 gate（P1）　✅ v1.55 已落地（best.gap warmup + challengeBoost warmup bypass）

**问题**：当前 `best.gap` 与 `challengeBoost` 在 P0（warmup）阶段也会触发，开局头三个落子玩家就被告知"差 500 分"。

**改进**（已落地）：

1. ✅ `Game.updateUI` 中以 `gameStats.placements < 3` 为 warmup 判据隐藏 best.gap；
2. ✅ `isBClassChallenge` 增加 `sessionArc === 'warmup'` bypass（bypass='warmup'），见 §4.2 落地实现；
3. ⏳ P2（cooldown）阶段的 `runStreakHint` 抑制留待 §5 Q+2 单独 PR。

**单测**：与 §4.2 合并为 `§4.2 + §4.5` 套件，warmup 段（totalRounds ≤ 3）必返回 `challengeBoostBypass='warmup'`。

### 4.6 D3 决战段 + D4 突破段的"二度里程碑"（P1）　✅ v1.55 已落地

**问题**：当前相对里程碑 `[0.25, 0.5, 0.75, 1.0, 1.25] × bestScore` 在玩家**破纪录后**就只剩一个 1.25× 节点。

**改进**（已落地）：

1. ✅ `deriveScoreMilestones(bestScore, currentScore)` 当 `currentScore > bestScore` 时把 `[bestScore × 1.10, bestScore × 1.25]` 合并去重并升序注入；
2. ✅ `_maybeCelebrateNewBest` 改为支持单局多次：首次走完整烟花 + `effect.newRecord`；2-3 次走弱版烟花 + `effect.newRecord.second`（带 `{{delta}}`，i18n 已添加）；4 次起静默更新 bestScore（CELEBRATIONS_PER_RUN_CAP=3）；
3. ✅ `_newBestCelebrationCount` 计数 + `compareBase` 滑动比较基线（已庆祝时用 `bestScore` 而非 `runStartBest`），确保连续 score 增长触发多次"再破纪录"而非反复触发"首次"；
4. ✅ CSS 添加 `.new-best-popup--second` 子样式（22px 标题 + 28px score + 1.3s 缩短）。

**单测**：`§4.6 二度里程碑` 5 条覆盖未破/+10%/+25%/新手 bestScore=0/effect 文案。

### 4.7 季度 / 周期 PB（P2）　✅ v1.55 已落地（基础）

**改进**（已落地）：

1. ✅ `bestScoreBuckets.js` 中 `submitPeriodBest(score)` + `getPeriodBest()`：滚动 ISO 周 + 自然月 PB；
2. ✅ `deriveWeekKey` 按 ISO 8601 周（周一为起点）派生；`deriveMonthKey` 按自然月；跨周/跨月自动重置；
3. ✅ `Game.endGame` 自动写入周期 PB；命中 weekly/monthly 更新时通过 `MonetizationBus` emit `lifecycle:period_best`，订阅方可推送"周冠军"等运营事件；
4. ⏳ HUD 切换"本周 PB / 历史 PB"留待 UI 后续 PR。

**与 §4.4 协同**：周期 PB 全难度合并（避免对 Easy / Hard 双重周冠）；如需按难度档分周期 PB，可在 submitPeriodBest 增加 strategy 字段。

**单测**：`§4.7` 4 条覆盖周/月 key 派生 + 跨窗口重置 + localStorage key 命名。

### 4.8 PB 距离感的"反向引导"——给 D3/D4 玩家发出可见的策略卡（P2）　✅ v1.55 已落地

**改进**（已落地）：

1. ✅ `strategyAdvisor.generateStrategyTips` 新增 `pbChase` 类别：
   - **D4 释放窗口**（`postPbReleaseActive=true`）：🎆 庆功小憩（priority 0.76）；
   - **D3.victory**（pct ≥ 1.0 且 celebrationCount > 0，释放窗口已结束）：🚀 再破纪录（priority 0.78）；展示下一节点 `bestScore × 1.10`；
   - **D3.close**（pct 0.95~0.999）：🏁 决战一脚（priority 0.84）；展示剩余分数；
2. ✅ `playerInsightPanel` 把 `pbContext = { currentScore, bestScore, postPbReleaseActive, celebrationCount }` 注入 gridInfo；
3. ✅ 与 `applyTipCategoryDiversity` 兼容：pbChase 是非 survival，可自动替换三连 survival 中的最弱一条；
4. ✅ 优先级 0.76~0.84，低于生存卡（fill>0.75 时 0.95）但高于构型/节奏卡，符合"保命优先 + PB 情感锚定"原则。

**单测**：`§4.8 strategyAdvisor pbChase 策略卡` 5 条覆盖 D4 / D3.victory / D3.close / D0–D2 不出 / pbContext 缺失兜底。

### 4.9 破纪录后"释放窗口"（P2）　✅ v1.55 已落地

**改进**（已落地）：

1. ✅ `Game._startPostPbReleaseWindow()` 在 `_maybeCelebrateNewBest` 内被自动调用，写入 `_spawnContext.postPbReleaseActive=true` + `postPbReleaseRemaining=3`；
2. ✅ `adaptiveSpawn` 主路径在 stress final clamp 后消费 `ctx.postPbReleaseActive`：正向 stress × 0.7 + `stressBreakdown.postPbReleaseStressAdjust` 持久化；
3. ✅ 同帧 `challengeBoost` bypass='post_pb_release'（见 §4.2）；
4. ✅ spawnHints.clearGuarantee 最低 +1 至 2、sizePreference 偏小块；
5. ✅ `_commitSpawn` 每轮 spawn 完成后 `postPbReleaseRemaining -= 1`，归零时自动清 active；
6. ✅ `_postPbReleaseUsed` cooldown：单局只用一次（即使连续刷新 PB 也不重置），避免后续过度轻量。

**单测**：`§4.9 postPbReleaseWindow` 4 条覆盖 active=true 时 stress 衰减 + challengeBoost bypass + clearGuarantee≥2 + active=false 时不衰减。

### 4.10 PB 失效守卫与异常分阈值（P2）　✅ v1.55 已落地

**改进**（已落地异常分守卫）：

1. ✅ `Game.endGame` saveScore 路径前加 sanity check：`previousBest >= minBase(默认 50) && score > previousBest × multiplier(默认 5)` 时进入审核态；
2. ✅ 审核态：内存中 `this.bestScore` 更新（让本局 UI 正常展示），但 **不**写后端 `db.saveScore`；同时 emit `lifecycle:suspicious_pb` 到 MonetizationBus，让风控订阅方接力；
3. ✅ `GAME_RULES.bestScoreSanity = { enabled, multiplier=5, minBase=50 }`，运营可在 `shared/game_rules.json` 动态调整；
4. ⏳ 回流玩家 bestScore 折扣留待 §5 Q+2 单独 PR（与 winback 保护包重叠，需联合调优）。

**单测**：`§4.10 异常分守卫` 4 条覆盖配置存在性 + 触发判定 + minBase 新手保护 + 阈值边界。

### 4.11 跨设备 PB 同步与"账号合并"策划口径（P3）　✅ v1.55 已落地（核心字段）

**改进**（已落地基础）：

1. ✅ `web/src/localStorageStateSync.js` `CORE_KEYS` 已加入 `openblock_best_by_strategy_v1` 与 `openblock_period_best_v1`：
   - 走 core section（5 秒一推、跨设备 hydrate）；
   - 合并策略沿用现有 `_mergeRemoteIntoLocal`：远端只补齐本地缺项，本地已有值优先；分桶字段是 JSON 字符串，合并粒度是整个对象（如需更细粒度的 max(local, remote) per bucket 可后续拆分）。
2. ⏳ 全账号 `openblock_best_score` 字段已在 v1.50 加入 CORE_KEYS（早于本次），跨设备 hydrate 已生效。
3. ⏳ 账号合并 / 赛季重置等运营动作待 §5 Q+3 与运营单独评审。

**单测**：`§4.11 跨设备 PB 同步` 2 条，确认 `_sectionForKey('openblock_best_by_strategy_v1')==='core'` + `_sectionForKey('openblock_period_best_v1')==='core'`。

### 4.12 数据反馈环：把 PB 行为写入 `MonetizationBus` 与 `lifecycleSignals`（P2）　✅ v1.55 已落地（事件部分）

**改进**（已落地）：

1. ✅ `Game._emitPersonalBestEvent` 在每次 `_maybeCelebrateNewBest` 后 emit `lifecycle:new_personal_best`：
   ```ts
   { previousBest, newBest, delta, celebrationIndex, isFirst, strategy, sessionPlacements, ts }
   ```
2. ✅ `Game._maybeEmitNearPersonalBest` 在 `updateUI` 后判定：`pct = score / bestScoreAtRunStart`；首次达到 0.95 时 emit `lifecycle:near_personal_best`（每局只一次）：
   ```ts
   { bestScore, score, pct, strategy, sessionPlacements, ts }
   ```
3. ✅ §4.10 异常分守卫触发时同时 emit `lifecycle:suspicious_pb`，供风控订阅；
4. ✅ §4.7 周期 PB 更新时 emit `lifecycle:period_best`，供周冠运营订阅；
5. ⏳ "近 30 局 PB 增长轨迹"写入 playerProfile 留待 §5 Q+2 单独 PR（与 churnPredictor early signal 联合调优）；
6. ⏳ MONETIZATION_EVENT_BUS_CONTRACT.md 契约扩展待评审（本次先在事件源头落地，订阅方按需接入；事件 schema 已稳定）。

**单测**：`§4.12 PB 事件总线` 4 条覆盖 `_emitPersonalBestEvent` payload 字段 + `_maybeEmitNearPersonalBest` pct 阈值 + 每局只一次 + bestScore=0 兜底。

### 4.13 高难度模式（Hard）与 PB 主线的衔接（P3）　✅ v1.55 已落地

**改进**（已落地）：

1. ✅ HUD `#best-strategy-badge` 元素 + CSS：hard 时显示 🔥 HARD 金色烟火闪烁 + `box-shadow` 脉冲；easy 时显示 🌱 EASY 绿色；normal 隐藏；
2. ✅ `_maybeCelebrateNewBest` 在 hard 模式时烟花强度 ×1.3：
   - 首次破 PB：bonusMatchFlash 3→4 / setShake 18→23 / 持续 900→1170ms；
   - 二度/三度：bonusMatchFlash 1→2 / setShake 9→12 / 持续 450→585ms；
3. ✅ 与 §4.4 分桶协同：hard PB 与 normal PB 互不污染。

**单测**：`§4.13 Hard 模式 PB UI` 2 条覆盖 hardScale=1.3 / normalScale=1.0 计算精度。

---

## 5. 落地交付快照（v1.55 一次性集成 PR）

> 原计划分四个季度递进的 13 项改进在 v1.55 单次 PR 内全部落地（代码、单测、文档同步）。下表保留为"事实快照"，便于后续策划/算法判断"哪些项已实装、哪些项还需观察 + 后续 PR 增强"。

| 季度（原计划） | 项目 | 实际交付 | 后续观察 / 后续 PR 关注点 |
|------|------|----------|---------------------------|
| Q+0 | §4.1 | ✅ 25 格全覆盖 + 4 测试 | 监控 S3·M0 cap=0.65 上线后 stress 分布是否符合预期 |
| Q+0 | §4.2 | ✅ 8 段优先级 bypass + 字段持久化 | DFV 可见 bypass 原因；监控 challengeBoost 触发率变化 |
| Q+0 | §4.5 | ✅ warmup 段 best.gap 隐藏 + bypass | 仅做 warmup；cooldown 段 runStreakHint 抑制留待后续 |
| Q+1 | §4.3 | ✅ ratio>0.50 触发 + 3 文案池 | i18n 17 语言走 zh-CN fallback；需要时再全量翻译 |
| Q+1 | §4.6 | ✅ +10%/+25% 二度档 + newRecord.second 弱版 UI | 单局上限 3 次；监控连刷 PB 玩家的留局率 |
| Q+1 | §4.8 | ✅ pbChase 三段策略卡 + pbContext 注入 | 监控 D3/D4 策略卡曝光与玩家继续游玩的相关性 |
| Q+1 | §4.9 | ✅ 3 spawn 释放窗口 + clearGuarantee+1 + cooldown | 监控 PB 后 5 spawn 留存率（KPI §7） |
| Q+2 | §4.4 | ✅ 客户端层 bucket cache + HUD strategy badge | 后端 schema 改动留待大型迁移 PR（与 leaderboards 联动） |
| Q+2 | §4.12 | ✅ new_personal_best / near_personal_best / suspicious_pb / period_best 4 事件 | 订阅方（personalShop / shareCard / dailyTasks）接入待商业化 PR |
| Q+2 | §4.7 | ✅ weeklyBest / monthlyBest ISO 周 + 自然月 + period_best 事件 | HUD 切换 "本周 PB / 历史 PB" UI 留待后续 PR |
| Q+2 | §4.10 | ✅ 异常分守卫 + lifecycle:suspicious_pb | 回流玩家 bestScore 折扣留待与 winback 联合调优 |
| Q+3 | §4.11 | ✅ openblock_best_by_strategy_v1 / openblock_period_best_v1 已纳入 core | 账号合并 / 赛季重置策略待运营评审 |
| Q+3 | §4.13 | ✅ HUD strategy badge + hardScale=1.3 烟花强度 | 后续可加 hard PB 专属皮肤 / 词条 |

---

### 5.x v1.55.10 修复（用户反馈 → 5 风险 + milestone 文案与频次 + 追平特效）

> 2026-05-16 用户反馈两点：
>   (a) "得分等于最佳分时应该出现特效，多次修复均未生效"——核心诉求是 `score === bestScore` 这个独特心理时刻应有反馈；
>   (b) "局内特效只出现一次"——三档 milestone 连弹审美疲劳；
>   (c) "局内激励语莫名其妙，玩家不能理解什么意思"——"分数突破 490!" 文案对玩家无意义；
>   (d) "总分很低时容易达成最佳，给激励特效不符合认知"——新手 best=0/50 触发 toast 削弱"挑战 PB"叙事；
> 同时本轮顺带修复了前次代码审计发现的 **PB 5 处风险点**。所有改动覆盖单测（1429 个全通过）。

| 风险 / 需求 | 修复 | 代码 / 测试 |
|------|------|------|
| **R3 跨局状态泄漏** | `start()` 复位 `_newBestCelebrationCount` / `_nearPbEmittedThisRun` / `_postPbReleaseUsed` / `_tiedBestCelebratedThisRun` / `_bestScoreSanityFlagged` | `web/src/game.js` start() v1.55.10 注释段 |
| **R4 可疑 PB 仍显示皇冠** | `endGame` 结算页皇冠 `isNewBest` 判定增加 `&& !this._bestScoreSanityFlagged` 守卫 | `web/src/game.js` over-score 皇冠分支 |
| **R1 init 早于 hydrate** | 新增 `game.refreshBestScoreFromBucket()`，main.js 在 `await initLocalStorageStateSync()` 之后调用一次；分桶 PB ≤ 总账号 PB 时采用 | `web/src/game.js` + `web/src/main.js` |
| **R5 socialLeaderboard 双源** | `getMyBestScore()` 改为 max(分桶 PB, legacy key)；endGame 破账号 PB 时也写入 `openblock_best_score` 保留 hydrate 兼容 | `web/src/monetization/socialLeaderboard.js` + `web/src/game.js` |
| **R2 双源（db getBestScore MAX 全表）** | 标注为后续清理项（不在本轮变更范围） | `docs/player/BEST_SCORE_CHASE_STRATEGY.md` 待办项 |
| **(d) MIN_BEST 门槛** | `MIN_BEST_FOR_MILESTONE_TOAST = 500`：bestScore < 500 时 `deriveScoreMilestones` 返回空表 → 任何分数都不出 milestone toast | `web/src/adaptiveSpawn.js` + `tests/bestScoreChaseStrategy.test.js` "bestScore < 500 时不触发任何里程碑" |
| **(b) 局内一次（分段）** | `_milestoneToastBaseFiredThisRun` / `_milestoneToastPostPbFiredThisRun` 两个 gate；base 段（≤ PB）+ post-PB 段（> PB）各 1 次，单局最多 2 次激励 | `web/src/adaptiveSpawn.js` `checkScoreMilestone` |
| **(c) 百分比文案** | i18n 新增 `effect.scoreMilestonePct = '已达最佳 {{pct}}%'`；game.js 渲染时计算 `pct = round(score / baseBest * 100)`；旧 `effect.scoreMilestone` 保留作为 bestScore 缺失时的兜底 | `web/src/game.js` showFloatScore + `web/src/i18n/locales/{zh-CN,en}.js` |
| **档位克制** | `SCORE_MILESTONES_REL` 从 `[0.25, 0.5, 0.75, 1.0, 1.25]` 改为 `[0.50, 0.75, 0.90]`（1.0 与"追平"撞车、1.25 与"破 PB"撞车都已去除） | `web/src/adaptiveSpawn.js` |
| **(a) 追平最佳特效** | 新增 `_maybeCelebrateTiePersonalBest()`：score === bestScore 且 best ≥ 500 且本局首次且未破 PB 时触发绿色 `.float-tie-best` toast；i18n `effect.tieBest = '🏁 追平最佳！'` | `web/src/game.js` + `web/public/styles/main.css` + `tests/gameBestScore.test.js` 6 个新测 |

**三态颜色叙事**（v1.55.10 起）：

| 时刻 | 特效 | 颜色 | 频次 | 持续 |
|------|------|------|------|------|
| 分数到达 PB 的 50% / 75% / 90% | `.float-milestone` "已达最佳 X%" | 蓝色 | base 段每局 1 次 | 2.8s |
| score === bestScore | `.float-tie-best` "🏁 追平最佳！" | 绿色 | 每局 1 次 | 1.8s |
| score > bestScore（首次） | `.float-new-best` "刷新最佳！" + 烟花 + 震屏 | 金色 | 每局 ≤ 3 次 | 2.3s |
| 已破 PB 后到 110% / 125% | `.float-milestone` "已达最佳 110%" 等 | 蓝色 | post-PB 段每局 1 次 | 2.8s |

> 工程契约：所有 milestone 触发要求 bestScore ≥ 500；追平特效要求 bestScore ≥ 500；这避免了"新手 best=0 跨过 50 就出激励"的违和感。低 best 玩家（< 500）的"分数情绪反馈"完全由 PB 庆祝 / 追平 / near-PB 推送接管（更聚焦"真正的努力时刻"）。

### 5.y v1.55.11 收敛（撤销中间态特效 + 单局一次 + 🏆 前缀）

> 2026-05-16 第二次用户反馈，明确"中间态特效（追平、百分比 milestone）干扰主线情绪"，要求收敛到**只有"刷新最佳"一种激励事件**，且**单局只发生一次**。本节是上一节 §5.x（v1.55.10 三态叙事）的**直接收敛**——回到"单事件 + 单出现 + 强符号"的极简模型。

**改动清单**：

| 项 | 变更 | 代码位置 |
|----|------|---------|
| **PB 庆祝次数** | `CELEBRATIONS_PER_RUN_CAP` 从 `3` 改为 `1`；二度 / 三度纪录代码分支保留为不可达 fallback，便于灰度恢复 | `web/src/game.js` `_maybeCelebrateNewBest` |
| **PB 文案前缀** | 19 语言 `effect.newRecord` 统一在文本前加 `🏆 ` + 句末感叹号；zh-CN 从"新纪录"改为"🏆 刷新最佳！" | `web/src/i18n/locales/*.js` |
| **milestone toast 渲染** | `playClearEffect`（消行回调）不再调 `showFloatScore('scoreMilestone')`；`showFloatScore` 的 `isScoreMilestone` 分支变为防御性 early `return`；`adaptiveSpawn` 的 `_lastAdaptiveInsight.scoreMilestoneHit` 仍如旧 reset，保留数据流给 DFV 与分析 | `web/src/game.js` |
| **追平特效** | `updateUI` 不再调用 `_maybeCelebrateTiePersonalBest`；方法本体改为 `return false`，单测仍验证"始终 false + 无 DOM 副作用"契约 | `web/src/game.js` |
| **CSS** | 删除 `.float-tie-best` 规则（绿色 tie-best 样式不再需要） | `web/public/styles/main.css` |
| **i18n** | `effect.scoreMilestone` / `effect.scoreMilestonePct` / `effect.tieBest` 标注 `@deprecated`，保留 key 以便 i18n 平台回滚 | `web/src/i18n/locales/{zh-CN,en}.js` |
| **测试** | `tests/gameBestScore.test.js` 追平特效从 6 个"验证触发"改为 4 个"始终 false" + 1 个"无 DOM 副作用"（共 5 个）；其他 milestone 测试不变（只断言 `_scoreMilestoneHit` 数据流） | `tests/gameBestScore.test.js` |

**收敛后的单一情绪事件**：

| 时刻 | 特效 | 颜色 | 频次 | 持续 |
|------|------|------|------|------|
| score > bestScore 的第一次 | `.new-best-popup` "🏆 刷新最佳！" + 完整烟花 + 震屏 + post-PB release 窗口 | 金色 | **每局 1 次** | 2.3s |
| 同局内后续刷新 PB | 静默更新 `this.bestScore`，无任何 UI | — | 不限次但不显示 | — |
| score === bestScore | 无 | — | — | — |
| score 跨过 50%/75%/90% 等档位 | 无 UI；`_lastAdaptiveInsight.scoreMilestoneHit` 仍在 DFV 可见 | — | — | — |

> **设计意图**：把"挑战自己 PB"压缩为唯一的爆点事件。中间态的"半程""冲刺"由 HUD 的 `best.gap.*` 文案与背景压力曲线（adaptiveSpawn）承担——这是**持续叙事**；而"🏆 刷新最佳！"作为**唯一爆点**，确保稀有性 → 珍贵 → 情绪冲击最大化。

---

### 5.z 基于 SGAZ 实证的规则层调控（未来方向，v1.55.17）

> **外部锚点**：Wang C-J. et al., *Evaluating Game Difficulty in Tetris Block Puzzle*, arXiv:2603.18994。论文用 SGAZ 在 8×8 Tetris Block Puzzle 上实证：**候选块数 `h` > 形状库 > `shapeWeights` > 预览数 `p`** 是难度调控的杠杆强度排序（详见 [ADAPTIVE_SPAWN §10.6](../algorithms/ADAPTIVE_SPAWN.md#106-外部实证基线sgaz--tetris-block-puzzlev15517) 与 [SPAWN_ALGORITHM §2.6](../algorithms/SPAWN_ALGORITHM.md#26-难度调控杠杆层级基于-sgaz-实证--v15517)）。

#### 当前 PB 策略的"难度天花板"诊断

§4 落地的 13 个改进项（`LIFECYCLE_STRESS_CAP_MAP`、`challengeBoost`、`postPbReleaseStressAdjust`、`best.gap` 文案、二度里程碑、释放窗口…）**全部聚焦在 `shapeWeights` 调控这一中等强度杠杆上**。论文实证：当 OpenBlock 默认配置 `dock=3, p=0, 标准 tetromino` = 论文 classic `h=3, p=0` baseline 时，强 AI（SGAZ）训练奖励已达 6544/6750（97%）、收敛仅需 61 iter——**意味着我们当前的 stress 调控空间整体处于"强 AI 已摸顶"的难度边界内**。

这给"挑战自我"主线留下一个**未被探索的难度提升通道**：当玩家 PB ≥ 某门槛（如 D4 突破段 + S3·M4）时，可以通过**规则层**（而非 stress 数值）制造真正的"难超越自己"质感。

#### 路线图（按工作量与价值排序）

| 优先级 | 行动 | 论文支撑 | OpenBlock 改动面 | 预估工作量 | 风险 |
|---|---|---|---|---|---|
| **P3** | **实质性 `h=1` 警报兜底**：在 `bottleneckRelief` 旁挂"dock 三块持续 N 轮全不可放 → 强制保消" | `h=1` 让 SGAZ 几乎不可玩；论文证明实质性单候选是难度悬崖 | `web/src/adaptiveSpawn.js` + 单测 | 2~3 小时 | 中 |
| **P3** | **preview 字段试点**：给 S0·M0 / S4 玩家加 1 格 preview UI（弱杠杆即弱影响） | `p` 是弱杠杆，"主观感受好 + 实际胜率影响小" → 适合作为新手 / 回流保护 | spawnHints 增 `previewSlots` 字段 + UI 1 格 + 形状库预生成 | 4~6 小时 | 中（UI 改动） |
| **P4** | **PB 冲刺段 `dock=2` 极限模式**：D3 决战段 / D4 突破段且 `stress norm ≥ 0.83` 时，临时给 1 个 spawn 改 dock=2 | `h=3→h=2` 收敛+162%；这是论文最强难度杠杆 | spawnHints 增 `dockOverride` + 三连块约束改造（`targetSolutionRange` 需适配） | 1~2 天 | **高**（架构变动，需先验证二连块场景下的解空间公式） |
| **P5** | **pentomino 解锁挑战形状**：D4 突破段 + S3·M4 临时把 1~2 个候选位换成 T-pentomino，作为"PB 冲刺时的真正挑战" | T-pentomino 是论文实证最强加难形状 | 形状库 / spawnHints / 模型 / UI / 美术全栈 | 3~5 天 | 高 |
| **P5** | **SGAZ 难度回归 CI**：基于 MiniZero 或自研轻量 SGAZ，给每次 `game_rules.json` 修改跑 baseline 训练对比 | 论文方法论本身 | `tools/eval_rule_difficulty.py` + CI 集成 | 1~2 周 | 高（基础设施） |

#### 与"挑战自我而不轻易超越"主张的契合度

| 路线图项 | 主线契合点 |
|---|---|
| 实质性 `h=1` 警报 | "**不轻易超越**" 不等于 "**让玩家卡死**"——防御性兜底，避免运气性悬崖 |
| preview 试点（S0/S4） | "**挑战自我**" 的前提是先让玩家**回到游戏中**——新手 / 回流期降低规则压力 |
| PB 冲刺 `dock=2` | "**挑战自我**" 的核心—— 在距离 PB 最近的 5% 区间制造**真实的难超越质感**，与 §4.4 `challengeBoost` 形成"数值压 + 规则压"双重曲线 |
| pentomino 解锁 | 给 D4 突破段玩家**真正的难度新维度**，避免 stress 已封顶（norm 1.0）但形状池仍是常规 tetromino 的"挑战感失真" |
| SGAZ CI | 把 §3.5 lifecycle cap、§4 改进项的"经验设置"逐步替换为**实证锚定**，避免凭直觉调 25 格 cap |

#### 落地前的硬约束（先验证后实施）

1. **`dock=2` / pentomino 必须通过 `tripletSequentiallySolvable` 改造**：当前可解性校验假设 dock=3，若临时变 dock=2 / 加入 5 格形状，需先证明"二连块或含 pentomino 时仍能保证 fail-recoverable"。
2. **任何规则层调控必须可被玩家感知**：dock 变化 / preview 出现 / pentomino 解锁，都应有**显式 UI 提示**（如顶部条 "极限挑战！候选块 3→2"），否则会被玩家归因为"卡顿/bug"而非"主动加难"。
3. **规则层调控不进入 `stress` 求和**：作为 `spawnHints` 的旁路通道，避免破坏 17 个 stress 分量的语义稳定性。

> **本节仅为设计原则录入**，**不引入任何代码改动**；具体实施需要单独 PR 提案，并通过实证（SGAZ 短训练 / 玩家测试）验证后再落地。

---

### 5.α v1.56 PB 段差异化升级（Q+0 + Q+1，11 项一次性集成）

> **背景**：v1.55 的 13 项改进项让"挑战自我"主线在 `shapeWeights` 层做到了较精细的差异化（25 格 cap、challengeBoost bypass、postPbRelease 释放窗口、二度里程碑…），但产品评审复盘指出三个仍待补齐的体验缺口：
>
> 1. **D0 远征段（pct &lt; 0.5）开局畏难**：从 0 出发追千分以上的 PB 时，开局的 `challengeBoost` 和"差 N 分"文案构成"压力先于奖励"的体感，远征段流失率偏高。
> 2. **D1/D2 文案不分档**：旧版 `best.gap` 在 `ratio > 0.05` 一律走 `best.gap.neutral` "差 N 分"，缺少"靠近"与"冲刺"两种情绪密度的区分。
> 3. **D3 决战段缺乏"质感加难"**：靠近 PB 95~100% 时，`challengeBoost` 只是把 stress 数值往上推，玩家感受到的是"系统在跟我作对"而非"我面对的是真正难的局面"。
> 4. **D4 突破段失锚**：破 PB 后 HUD 的 best.gap 直接 hidden，玩家失去"我现在已经超了多少"的实时锚点，二度激励链路断开。
> 5. **PB 持续突破缺乏荣誉感**：连续多次刷新 PB 没有"成就感复利"机制。
>
> v1.56 把上一节"未来方向"中**不依赖 SGAZ 实证**的高 ROI 项目合并成 11 项一次性集成（Q+0 6 项 + Q+1 5 项），定位为**"在不动 stress 求和、不动 dock=3 规则的前提下，把 PB 距离段差异化做到极致"**。本节为完整代码事实清单。

#### §5.α.1 改进项落地表（11 项）

| 编号 | 类别 | 改进项 | 触发条件 | 实现位置 | 验证测试 |
|------|------|--------|----------|----------|----------|
| §2.1 | 算法 | `farFromPBBoost` 远征送爽 | `pct &lt; 0.30` ∧ 无救济/瓶颈/warmup/postPbRelease/pbGrowthFast/nearMiss | `web/src/adaptiveSpawn.js` + `shared/game_rules.json adaptiveSpawn.engagement.farFromPBBoost` | bestScoreChaseStrategy §2.1 (5 case) |
| §2.3 | 算法 | D3 `pbExtremeOrderBoost` 顺序刚性 | `0.95 ≤ pct &lt; 1.0` ∧ 无 postPbRelease/recovery/bottleneck/warmup/onboarding | `web/src/adaptiveSpawn.js`（orderRigor 公式注入 `+0.20`） | bestScoreChaseStrategy §2.3 (3 case) |
| §2.4 | 算法 | `pbGrowthFast` 节流 | 最近 5 次 PB 几何平均增长率 ≥ 10% | `web/src/pbGrowthTracker.js` + `game.js start()` 透传到 `_spawnContext.pbGrowthFast` | bestScoreChaseStrategy §2.4 pbGrowthTracker (7 case) |
| §2.5 | 算法 | 远征段多消潜力倾斜 | `spawnHints.farFromPBBoostActive === true` ∧ 候选 `s.multiClear ≥ 2` | `web/src/bot/blockSpawn.js`（权重 ×1.15） | 集成在 §2.1 farFromPBBoost case |
| §3.1 | 文案 | D1/D2 best-gap 细分 | `0.05 &lt; ratio ≤ 0.20` → chase；`0.20 &lt; ratio ≤ 0.50` → follow | `web/src/game.js updateUI()` + `i18n/locales/{zh-CN,en}.js` | bestScoreChaseStrategy §3.1 i18n (8 case) |
| §3.2 | 文案 | D4 突破段 HUD「已超 N 分」 | `gap ≤ 0` ∧ `bestScore &gt; 0` 三档（toNext10 / toNext25 / legend） | 同 §3.1 + CSS `.best-gap--over` | bestScoreChaseStrategy §3.2 i18n (3 case) |
| §3.4 | 文案 | 终局差一口气 banner | `endGame` 时未破 PB ∧ `pct ≥ 0.85` 两档（D2/D3） | `web/src/game.js endGame()` + CSS `.near-miss-banner` | bestScoreChaseStrategy §3.4 i18n (2 case) |
| §4.1 | 特效 | D0 多消特效振幅 ×1.3 | `pct &lt; 0.5` ∧ 多消/perfect/bonusLines | `web/src/game.js playClearEffect()` | 视觉手测 + 集成在 §2.1 case |
| §4.2 | 特效 | D3 单线特效克制 | `0.95 ≤ pct &lt; 1.0` ∧ 未破 PB ∧ count=1 ∧ 无 perfect ∧ 无 bonusLines | 同 §4.1（fallthrough 走 minimal shake） | 视觉手测 |
| §4.3 | 叙事 | stressMeter PB 联动 | `spawnHints.farFromPBBoostActive === true` 或 `breakdown.pbExtremeOrderBoost &gt; 0` | `web/src/stressMeter.js buildStoryLine()` 抢占 score-push 守卫之前 | bestScoreChaseStrategy §4.3 (3 case) |
| §4.4 | 叙事 | 连续突破徽章 `pb-streak-badge` | 7 天内 ≥ 2 次入栈 PB（`computePbStreakCount() ≥ 2`） | `web/src/game.js _updateProgressionHud()` + `web/index.html` + CSS `.pb-streak-badge` | bestScoreChaseStrategy §2.4 streak (3 case) |

#### §5.α.2 配置新增（`shared/game_rules.json`）

```json
"engagement": {
  "farFromPBBoost": {
    "enabled": true,
    "pctThreshold": 0.30,
    "clearGuaranteeBoost": 1,
    "multiClearBonusFloor": 0.45,
    "iconBonusTargetFloor": 0.30,
    "sizePreferenceShift": -0.12
  }
}
```

**调参指引**：

- `pctThreshold` 默认 0.30（D0 段定义）。运营若发现 PB 通胀过快，可降到 0.25 收缩远征段范围。
- `multiClearBonusFloor` 与 `iconBonusTargetFloor` 是 `Math.max` floor，不是 setter——如果上游几何（pcSetup / nearFullLines）已经把这两个值推得更高，本配置不会回退。
- 关闭整段送爽：`"enabled": false`；breakdown 仍会写 `farFromPBBoostBypass="config_disabled"`，便于 DFV 排查。

#### §5.α.3 spawnHints / stressBreakdown 新增字段

| 字段 | 类型 | 写入端 | 消费端 | 含义 |
|------|------|--------|--------|------|
| `spawnHints.farFromPBBoostActive` | `boolean` | adaptiveSpawn §2.1 | blockSpawn §2.5、stressMeter §4.3、DFV | 远征送爽是否激活（与下方 bypass 互补） |
| `stressBreakdown.farFromPBBoostBypass` | `string \| null` | adaptiveSpawn §2.1 | DFV / 单测 | 未触发原因：`config_disabled` / `no_best_score` / `pct_above_threshold` / `warmup` / `recovery` / `near_miss` / `pb_growth_throttled` / `post_pb_release` |
| `stressBreakdown.pbExtremeOrderBoost` | `number` | adaptiveSpawn §2.3 | stressMeter §4.3、DFV | D3 决战段 orderRigor 额外提升量（仅触发时存在，0.20） |
| `ctx.pbGrowthFast` | `boolean` | game.js start() → pbGrowthTracker | adaptiveSpawn §2.1 | 跨局 PB 增长率是否过快（阈值 0.10 / 局） |

#### §5.α.4 设计取舍

**取舍 1：D0 段送爽是"主动加好处"而非"减少难度"。**

旧版思路（v1.55）"D0 段不加 challengeBoost"是被动的——只是不加压。v1.56 主动注入 `clearGuarantee+1 / multiClearBonus≥0.45 / iconBonusTarget≥0.30 / sizePreference≤-0.12`，配合 §2.5 形状层 ×1.15 倾斜与 §4.1 特效 ×1.3，让玩家在远征段开局能切实感受到"系统在帮我开局"。

**取舍 2：D3 段加难走"规则刚性"而非"数值加压"。**

v1.55 的 `challengeBoost` 在 D3 段最多再加 `+0.15` stress（已被 cap 0.85 限制）。v1.56 的 `pbExtremeOrderBoost=0.20` 走 orderRigor 路径，让 6 种排列里允许的可解数从 4 收紧到 2，把"必须按特定顺序摆放"变成 D3 段的核心质感——与 §4.2 单线特效克制配合，把"破 PB 烟花"的对比度推到最高。

**取舍 3：`pbGrowthFast` 是节流不是封禁。**

最近 5 次 PB 几何平均增长率 ≥ 10% 时，仅让远征送爽（§2.1）跳过；challengeBoost、orderRigor、postPbRelease 等其他机制全部正常运行。这避免了"PB 涨太快 → 反过来惩罚玩家"的认知冲突——只是收回主动送爽的额外糖，并不主动加码难度。

**取舍 4：「7 天内连续突破」 vs 「绝对次数」。**

`pb-streak-badge` 用"最近 7 天内连续 N 次入栈 PB"而非"历史总 PB 次数"。设计原因：

- 7 天窗口让回归玩家有"重启 streak"的可能性，避免老玩家几个月不上线后 streak 永久挂着
- 累计次数会被 §2.4 `pbGrowthFast` 节流机制冲淡（节流期间 PB 暂停增长）
- 与产品 `weeklyBest` / `monthlyBest` 一致的"近期高光"叙事

#### §5.α.5 文档关联

- 算法详解 → [docs/algorithms/ADAPTIVE_SPAWN.md §13.3 farFromPBBoost / pbExtremeOrderBoost / farFromPBBoostBypass](../algorithms/ADAPTIVE_SPAWN.md)
- 出块算法侧 → [docs/algorithms/SPAWN_ALGORITHM.md §2.5 远征段多消潜力倾斜](../algorithms/SPAWN_ALGORITHM.md)
- 测试位置 → `tests/bestScoreChaseStrategy.test.js` v1.56 §5.α 段（共 22 个新测试用例）

#### §5.α.9 D4 段加压链路 4 处冲突完整修复（v1.56.6）

> **背景**：v1.56.4 §5.α.8 在算法**逻辑层**新增了 pbOvershootBoost / D4 spawnHints 收紧 / D4 pbExtremeOrderBoost 延续，但端到端 stress 链路审计发现**4 处机制反向消解了 D4 加压**，stress 维度的"超 PB 越来越难"实际未生效。本节是对完整链路的收口。

##### 系统性诊断：D4 加压被消解的 4 处冲突

| # | 冲突源 | 旧机制行为 | 净效果 | 优先级 |
|---|--------|------------|--------|--------|
| C2 | `occupancyDamping` | 玩家破 PB 通常伴随 perfect clear / 多消大消 → fill 骤降 → stress×0.4~0.5 | **加压被狠狠撤销** | 🔴 P0 |
| C3 | `flowPayoffCap` | 玩家破 PB 时常处 flow + payoff 状态 → stress ≤ 0.79 | 加压被 cap 截断 | 🔴 P0 |
| C4 | `smoothStress maxStepUp=0.18` | 限制单 spawn 上扬幅度 | "突然变难"被平滑掉 | 🟡 P1 |
| C1 | `scoreStress percentileMaxOver=0.2` | 限制 projected≤lastMilestone×1.2，pct>1.2 时 scoreStress 完全不再升高 | D4 内部无 stress 递增 | 🟡 P1 |

**修复前实测**：D4 段（pct=1.5 + 低 fill + flow + payoff）finalStress ≈ 0.50，与 D2 段（pct=0.85）finalStress ≈ 0.40 几乎相同——"超 PB 加压"在 stress 维度完全无感。

##### 完整修复方案（4 处冲突 + 2 处配置化）

###### P0-C2：`occupancyDamping` D4 段豁免

```js
const _ohActiveBypassOcc = pbOvershootActive && cfg.pbChase.overshoot.bypassOccupancyDamping !== false;
if (stress > 0 && !_ohActiveBypassOcc) {
  // 原有 damping 公式
}
stressBreakdown.occupancyDampingBypassed = _ohActiveBypassOcc;
```

→ D4 段 pbOvershootBoost / challengeBoost 的加压不再被 ×0.5 消解。

###### P0-C3：`flowPayoffCap` D4 段豁免

```js
if (... && !pbOvershootActive) {
  stress = Math.min(stress, flowPayoffCap);
}
```

→ D4 段即使在 flow + payoff 状态下也保留完整加压。

###### P1-C4：`smoothStress.maxStepUp` D4 段动态提升

```js
const _smoothingCfg = pbOvershootActive
  ? { ...cfg.stressSmoothing, maxStepUp: cfg.pbChase.overshoot.smoothMaxStepUp }  // 0.25
  : cfg.stressSmoothing;  // 0.18
```

→ D4 段允许单 spawn 上扬 0.25（旧 0.18），"突然变难"在 1 个 spawn 内完成传达。

###### P1-C1：`scoreStress.percentileMaxOver` 0.2 → 0.5

```json
"dynamicDifficulty": { "percentileMaxOver": 0.5 }
```

→ D4 段（pct ∈ (1.0, 1.5]）scoreStress 仍能继续递增，与 pbOvershootBoost 协同形成"超 PB 越来越难"完整曲线。

###### P2：`challengeBoost.baseCap` 0.15 → 0.18（配置化）

```json
"pbChase": { "challengeBoost": { "baseCap": 0.18 } }
```

→ D3 段（pct=0.95）加压增量从 17% 提到 ~20%，"决战感"在 stress 维度更可感。

###### P2：`postPbReleaseWindow.spawns` 3 → 5（配置化）

```json
"pbChase": { "postPbReleaseWindow": { "spawns": 5, "stressReleaseFactor": 0.7 } }
```

→ 破纪录爽感窗口从 3 spawn（约 5~10s）扩到 5 spawn（约 10~20s），与玩家心理时长对齐。

##### 修复前后效果对比

| 场景 | pct | fill | flow+payoff | 修复前 finalStress | 修复后 finalStress | 增量 |
|------|-----|------|-------------|---------------------|---------------------|------|
| D2 临近 | 0.85 | 0.10 | 否 | ≈ 0.40 | ≈ 0.40 | 0（D2 不受影响） |
| D2 临近 | 0.85 | 0.40 | 否 | ≈ 0.66 | ≈ 0.66 | 0 |
| **D4 超 PB** | **1.50** | **0.10** | **是** | **≈ 0.50** 🔴 | **≈ 0.85** ✅ | **+0.35** |
| **D4 超 PB** | **1.20** | **0.20** | **是** | **≈ 0.45** 🔴 | **≈ 0.75** ✅ | **+0.30** |
| D3 决战 | 0.97 | 0.40 | 否 | ≈ 0.68 | ≈ 0.71 | +0.03（P2 cap 提升） |

→ D4 段净加压**从无效到显著生效**，与 D2 段形成明显落差（0.10+），玩家可感"超 PB 后越来越紧"。

##### 实现挂点

| 文件 | 改动 |
|------|------|
| `shared/game_rules.json` | `dynamicDifficulty.percentileMaxOver` 0.2→0.5；`adaptiveSpawn.pbChase.overshoot.{bypassOccupancyDamping,bypassFlowPayoffCap,smoothMaxStepUp}`；`adaptiveSpawn.pbChase.challengeBoost.baseCap=0.18`；`adaptiveSpawn.pbChase.postPbReleaseWindow={spawns:5,...}` |
| `web/src/adaptiveSpawn.js` | 3 处插入豁免（occupancyDamping / smoothStress 动态 maxStepUp / flowPayoffCap）+ challengeBoost cap 配置化；breakdown 增 `occupancyDampingBypassed` / `flowPayoffCapBypassed` / `smoothingDynamicMaxStepUp` |
| `web/src/game.js` | `_emitPersonalBestEvent` postPbReleaseRemaining 从 GAME_RULES 读取 |
| `tests/bestScoreChaseStrategy.test.js` | +8 用例（4 处冲突豁免 + 端到端 D4 vs D2 落差断言 + 2 处配置化） |

##### 同源 bypass 链一致性

所有 v1.56.6 修复严格遵循同源 bypass 约束：
- `pbOvershootActive` 在 v1.56.4 §5.α.8 已经被 5 路 bypass 守卫（低 PB / postPbRelease / recovery / bottleneck / warmup / onboarding）
- 因此 P0/P1 三处豁免（occupancyDamping / flowPayoffCap / smoothMaxStepUp）**继承** pbOvershootActive 的全部 bypass，不会在新手 / 救济期 / 释放窗口期内被误触发

##### 不修复项（设计取舍）

- **远 PB 段 farFromPBBoost 不动 stress**：farFromPBBoost 仅改 spawnHints / 形状层，不动 stress 是有意为之——D0 段 stress 已经被 scoreStress×0.4 充分削减（净 stress ~0.03~0.10），叠加额外减压会过度饱和、抑制其他必要信号（如 boardRisk 高时仍需保留警示）。

#### §5.α.10 三数关系自洽修复（v1.56.7）

> **背景**：v1.56.5 修复了 "已超 0 分"（破 PB 后 over 永远归零）的 bug，把 best-gap 的 over 基线切换到 `_bestScoreAtRunStart`。但用户随后又反馈截图 "得分 210 / 最佳 140 / 已超 190" —— 三个数字关系仍然对不上（用户标记"逻辑错误"）。本节是对 HUD 三数关系的最终对齐。

##### 根因分解

| Bug | 位置 | 后果 |
|------|------|------|
| **updateUI 调用顺序错乱** | `_maybeCelebrateNewBest()` 在 `updateUI` 末尾调用（line 3518），而 `document.getElementById('best').textContent = this.bestScore` 在开头执行（line 3404） | "最佳" DOM 永远比内存 `bestScore` 慢一帧——玩家破 PB 后看到 "得分 210 / 最佳 140" 的瞬间错位 |
| **静默分支不刷新 DOM** | `_maybeCelebrateNewBest` 在 `celebrations ≥ CELEBRATIONS_PER_RUN_CAP` 静默分支直接 `return false`，不调用 `updateUI()` | 加重时序错乱，破 PB 后连续 score 增长时 DOM "最佳" 持续滞后 |
| **gap=0 走 over 分支** | `else { const over = score - pbBaseline; ... }`（`gap <= 0` 都进 over 分支） | 玩家追平开局基线那一帧显示 "已超 0 分"（即截图所示） |
| **文案歧义** | `'best.over.neutral': '已超 {{over}} 分'` | 没说明"超谁"——玩家看到 "得分 210 / 最佳 210 / 已超 190" 无法将 190 与 UI 上任何可见数字对齐 |

##### 修复方案

1. **updateUI 顺序调整**：把 `_maybeCelebrateNewBest()` 从 line 3518 移到 line 3399 之前，确保 `bestScore` 在 DOM 写入之前已经同步到 `score`。
   - 内部安全：庆祝分支嵌套调用 `updateUI` 时，由于 `_newBestCelebrated=true` 且 `celebrations≥1`，必然走静默分支立即 return，无递归风险。
2. **gap=0 隐藏 best-gap**：把 D4 进入条件从 `gap <= 0` 收紧为 `gap < 0`；`gap === 0` 时 `msg` 保持 undefined，末尾 `if (msg) ... else { gapEl.hidden = true; }` 自然隐藏 HUD。
   - 追平基线那一帧由 `_maybeCelebrateNewBest` 触发的 PB 烟花独自承担反馈（更强、更明确）。
3. **文案明确化**：
   - zh-CN：`已超 {{over}} 分` → `本局 +{{over}}`（"本局" 明确暗示"相比本局开局的 PB"）
   - en：`+{{over}} pts` → `Run +{{over}}`
   - 玩家心算 `score - "本局 +N"` 即可推断开局基线，三数关系自洽。

##### 修复后三数关系

| 场景 | score | bestScore（实时） | best-gap | 三数关系 |
|------|-------|------|----------|----------|
| 开局未破 PB | 80 | 200 | `差 120 分` | `80 + 120 = 200` ✓ |
| 追平开局基线 | 200 | 200 | （隐藏） | 由 PB 烟花反馈，无文字 |
| 破 PB（修复后） | 210 | 210 | `本局 +190` | `210 - 190 = 20`（开局基线）✓ |
| 破 PB（修复前 bug） | 210 | 140 | `已超 190 分` | ❌ 三数无任何代数关系 |

##### 配套测试

| 测试文件 | 覆盖场景 |
|---------|----------|
| `tests/gameBestScore.test.js`（+3） | updateUI 内 `_maybeCelebrateNewBest` 调用时 DOM 仍是上一帧值（顺序契约）；用户截图复刻；gap=0 时 HUD 隐藏 |
| `tests/bestScoreChaseStrategy.test.js`（更新） | `score===baseline` 返回 `{visible:false, mode:'tie'}` 而非 `over:0`；用户截图复刻 `score=210/baseline=20→over=190` |

##### 不修复项（设计取舍）

- **deprecated over 文案池**（`best.over.toNext10` / `toNext25` / `legend`）保留 "已超 N 分" 不改：这些 key 自 v1.56.3 起已不被生产代码消费，只供 i18n 平台灰度回滚。改文案反而会让回滚路径与新文案不一致。

#### §5.α.11 stress 感知化层：4 档反馈渠道（v1.57）

> **背景**：用户反馈 "stress 指标不太能体现到玩家感受上来"。系统审计发现 v1.55~v1.56 的所有 stress 精算（lifecycle cap / occupancyDamping / smoothStress / flowPayoffCap / challengeBoost / pbOvershootBoost 等十几条机制）唯一对玩家产生可观察效果的渠道是 **出块差异化**，而其他 4 个本可承载 stress 感知的渠道全部断层。本节是对玩家感知通道的系统补全。

##### 系统性诊断：v1.56.7 stress → 玩家感知的 5 个渠道

| 渠道 | 现状 | 与 stress 的耦合度 |
|------|------|----------------------|
| 主战场 HUD 显示 | ❌ 无 | stressMeter 在 insightPanel 内（多数玩家从不打开） |
| 视觉氛围（棋盘边框/背景） | ❌ 无 | `main.css` 无 `--stress-*` 系列变量驱动主棋盘 |
| 音效 / BGM | ❌ 无 | `playClearEffect` / setShake 只看 bonusCount，与 stress 完全无关 |
| 震动幅度 | ❌ 无 | `renderer.setShake` 由 perfectClear / combo / hard 决定，stress 不参与 |
| 出块差异化 | ✅ 唯一生效 | `shapeWeights` / `spawnTargets` / `orderRigor` 都读 raw stress |

**症结**：v1.56.3 策略隐性原则"算法调整通过游戏体验感知不直白告诉玩家"，被错误执行成了"策略隐形"（除了出块外，玩家几乎察觉不到任何 stress 变化）。

##### 4 档反馈渠道（stressAmbience.js）

| 档位 | 渠道 | 技术实现 | 玩家体感 |
|------|------|----------|----------|
| **A** | 棋盘氛围光 | `#game-wrapper::before` outer box-shadow，颜色由 `--stress-ambience-glow` CSS 变量驱动 | 棋盘外缘冷青→暖绿→琥珀→橙红→暗红 6 档色相变化（潜意识级别） |
| **B** | 呼吸节奏 | `--stress-ambience-breath-ms` 驱动 `stress-ambience-breath` keyframe 周期 | 外缘呼吸：低 stress 4.2s 缓慢（"安稳"暗示）/ 高 stress 1.5s 急促（"紧张"暗示） |
| **C** | 消行震动幅度 | 装饰器包 `renderer.setShake`，intensity × `_stressShakeMultiplier` (`[0.85, 1.30]`) | 高压消行震感更强（释放感）/ 低压消行轻柔（不打扰）|
| **D** | 音频低通滤波 | BiquadFilter 插入 `audioFx.master → destination`，cutoff 随 stress 调节（`[4000, 14000] Hz`） | 高压时 BGM/音效"闷"（高频被削）/ 低压时明亮（完整高频） |

##### 6 档氛围映射（与 `stressMeter.STRESS_LEVELS` 同步）

| stress norm | band | glow 主色 | breathMs | shakeMult | audioCutoff |
|-------------|------|-----------|----------|-----------|-------------|
| < 0.125 | calm | 冷青 (120, 200, 230) | 4200ms | 0.85 | 14000 Hz |
| 0.125~0.333 | easy | 薄荷绿 (160, 220, 200) | 3600ms | 0.92 | 12000 Hz |
| 0.333~0.542 | flow | 暖绿 (180, 220, 160) | 3000ms | 1.00 | 10000 Hz |
| 0.542~0.708 | engaged | 琥珀 (230, 200, 140) | 2400ms | 1.10 | 7500 Hz |
| 0.708~0.833 | tense | 橙红 (230, 160, 120) | 1900ms | 1.20 | 5500 Hz |
| ≥ 0.833 | intense | 暗红 (220, 100, 100) | 1500ms | 1.30 | 4000 Hz |

##### 严格遵守的护栏

- **策略隐性**：stressAmbience.js 不导出任何 `render*` / `show*` / `*Label` / `*Text` 函数（契约测试验证）；不写 `textContent` / `innerHTML`；不修改 stressMeter 在 insightPanel 内的现有渲染。
- **shakeMult ∈ [0.85, 1.30]**：超过 ±40% 会被玩家反馈"震动忽强忽弱很烦"。
- **audioCutoff ≥ 800 Hz**：低于此值会让 BGM/音效完全失真；setStressAmbienceCutoff 内部钳制到 `[800, 20000]`。
- **CSS 过渡 800ms ease-out**：stress 突变时颜色/呼吸节奏平滑过渡，避免视觉跳跃。
- **`prefers-reduced-motion`**：关闭呼吸动画（保留静态光环）。
- **`:root.quality-low`**：低端设备完全关闭氛围光（与 game-board-flow-bg 同口径）。

##### 接入路径

| 文件 | 改动 |
|------|------|
| `web/src/stressAmbience.js`（新增） | 6 档配置 + `getStressAmbience` / `applyStressToDOM` / `attachStressShakeMultiplier` / `attachStressAudioFilter` / `pushStressAmbience` |
| `web/src/game.js` | import + `_captureAdaptiveInsight` 末尾调用 `pushStressAmbience({stressNorm, rootEl, renderer, audioFx})` |
| `web/src/main.js` | 启动期 `attachStressShakeMultiplier(game.renderer)` + `attachStressAudioFilter(audioFx)` 一次性绑定装饰器 |
| `web/public/styles/main.css` | `#game-wrapper::before` 氛围光 + `@keyframes stress-ambience-breath` + 降级路径 |
| `tests/stressAmbience.test.js`（新增） | 6 档单调性 / 阈值同步 / 安全护栏 / 幂等 / 策略隐性契约共 43 个用例 |

##### 不做项（设计取舍）

- **不在主 HUD 显示 stress 数字**：违反 v1.56.3 策略隐性原则，被用户已明确否决。
- **不联动落子音音调**：每次落子都有音色变化会被玩家感知为"游戏不稳定"，反而扰乱体验。落子音保持稳定，只通过 BGM/消行音的低通滤波渗透 stress。
- **不在 hard 模式特别加强 stress 氛围**：hard 模式的 cap 已通过 `LIFECYCLE_STRESS_CAP_MAP` 在算法层加权，氛围层只忠实呈现 finalStress，不二次放大。

#### §5.α.12 stress → 出块算法的精算细化：4 项算法增强（v1.57.1）

> **背景**：v1.57 §5.α.11 把 stress 的"玩家感知断层"修复在了感官层（氛围光 / 呼吸 / 震动 / 音频）。但用户进一步追问 "stress 反应到出块算法上，如何体现"——审计发现 stress 在算法层的 5 条传导路径中，**有 4 处存在台阶感、断档或锁死不彻底**。本节是对算法精算的精细收口。

##### 系统性诊断：stress → 出块算法的 5 条传导路径与缺陷

| 传导路径 | 现状 | 缺陷 |
|---------|------|------|
| **A. profile 插值** | `interpolateProfileWeights(profiles, stress)` 在 10 档 profile 间连续插值 shapeWeights | ✅ 已平滑（无缺陷） |
| **B. spawnTargets 投影** | `deriveSpawnTargets(stress)` 投影到 6 轴目标 | ✅ 已平滑（无缺陷） |
| **C. targetSolutionRange 软过滤** | `solutionDifficulty.ranges` 按 stress 选区间，标准档 (0.35) → 紧张档 (0.6) 之间没有过渡 | ❌ 0.35~0.60 的 0.25 跨度内 `max=null`，玩家在 stress=0.5 与 stress=0.4 感受不到难度差 |
| **D. orderRigor 顺序刚性** | `stressTerm = max(0, stress - 0.55) * 1.6` 硬阈值 | ❌ stress=0.55 跨越点"突然变难"台阶感；D4 段顺序刚性弱（仅 0.08） |
| **E. spawnIntent 离散意图** | 6 档枚举（relief/engage/harvest/pressure/flow/maintain），0.55 处一脚跨进 pressure | ❌ maintain → pressure 缺过渡，hints 套装翻盘 |

##### 4 项算法增强（P0–P3）

| 编号 | 改进 | 实现位置 | 配置 |
|------|------|----------|------|
| **P0** | orderRigor 改用 softplus ramp，消除 0.55 跨阈值台阶感 | `web/src/adaptiveSpawn.js` orderRigor 块 | `topologyDifficulty.orderRigorStressSmoothness=0.08` |
| **P1** | `solutionDifficulty.ranges` 新增 '渐紧' 档（minStress=0.5, max=64），让 0.5~0.6 区间也有软上限 | `shared/game_rules.json` | `adaptiveSpawn.solutionDifficulty.ranges` 第 4 档 |
| **P2** | D4 段（pbOvershootActive=true）+ stress ≥ 0.85 时给 orderRigor 注入额外 +0.25，把 maxValidPerms 真正压到 tight=2 | `web/src/adaptiveSpawn.js` orderRigor 块 | `pbChase.overshoot.orderBoostInD4HighStress=0.25` / `orderHighStressMin=0.85` |
| **P3** | `spawnIntent` 新增 'sprint' 中间档（stress ∈ [0.45, 0.55)），平滑 maintain → pressure 过渡；sprint hints：sizePreference +0.10, multiClearBonus ≥ 0.40 | `web/src/adaptiveSpawn.js` spawnIntent 块 | `adaptiveSpawn.sprintIntent.enabled=true / minStress=0.45 / maxStress=0.55` |

##### P0 softplus 数学性质

旧公式 `stressTerm = max(0, stress - threshold) * orderScale`（threshold=0.55, orderScale=1.6）在 threshold 处一阶不连续；新公式 `stressTerm = softplus((stress - threshold) / smoothness) * smoothness * orderScale`（smoothness=0.08）在 threshold 处一阶可导。

| stress | 旧公式 stressTerm | 新公式 stressTerm | 差异 |
|--------|-----------------|-----------------|------|
| 0.40 | 0 | 0.018 | 阈值以下也有轻微输出，去硬零 |
| 0.55 | 0 | 0.089 | 阈值正点已有 0.089 而非 0 |
| 0.70 | 0.240 | 0.258 | 接近 |
| 0.85 | 0.480 | 0.484 | 几乎一致 |

设计原则：threshold ± 2×smoothness 范围内平滑过渡，远离 threshold 时与旧公式渐近一致——既消除台阶感又不破坏高 stress 段的强约束。

##### P2 D4 段强锁死的双重 boost 设计

- **弱档**：`orderBoostInD4=0.08`——只要 pbOvershootActive 触发（D4 段任意 stress），都给 0.08 弱顺序约束（已存在 v1.56.4）。
- **强档**：`orderBoostInD4HighStress=0.25`——pbOvershootActive=true **且** stress ≥ 0.85 时**叠加**额外 0.25 boost，让 orderRigor 总和 ≥ 0.55，触发 `maxValidPerms=Math.round(4 - 2 * orderRigor) ≤ 2` 的强约束。

互补意义：D4 段 + 普通 stress（如玩家刚破 PB 不久）走弱档；D4 段 + 高 stress（玩家已大幅超过 PB 且盘面紧）走强档，**避免对刚破 PB 的玩家立即上"顺序刚性"，但对持续超 PB 的玩家逐步加码**。

##### P3 spawnIntent 优先级

```
relief > engage > harvest > pressure > sprint > flow > maintain
```

- sprint 优先级 **低于 pressure**（challengeBoost > 0 时仍走 pressure 不被 sprint 吞掉）
- sprint 优先级 **高于 flow / maintain**（避免 stress=0.5 落入"看起来比较轻松"的误导叙事）
- sprint 触发条件：`stress ∈ [sprintMin, sprintMax)` 且无前置主导意图

##### 落地清单

| 文件 | 改动 |
|------|------|
| `shared/game_rules.json` | `topologyDifficulty.orderRigorStressSmoothness=0.08`（P0）；`solutionDifficulty.ranges` 加第 4 档（P1）；`pbChase.overshoot.orderBoostInD4HighStress=0.25 + orderHighStressMin=0.85`（P2）；`adaptiveSpawn.sprintIntent` 块（P3） |
| `shared/intent_lexicon.json` | sprint 词条（label_zh/label_en/in_game_narrative_zh/in_game_narrative_en/out_of_game_push_zh/out_of_game_push_en/out_of_game_task_zh/out_of_game_task_en/tone/preferred_stages/preferred_bands） |
| `web/src/adaptiveSpawn.js` | P0 softplus 公式；P2 pbOvershootOrderBoost 累加；P3 sprint 分支 + hints 应用层 |
| `miniprogram/core/adaptiveSpawn.js` + `miniprogram/core/gameRulesData.js` | P0/P1/P3 同步（P2 跳过，因小程序无 pbOvershoot 系列依赖） |
| `web/src/stressMeter.js` | `SPAWN_INTENT_NARRATIVE.sprint` 中性化文案；`SIGNAL_LABELS.pbOvershootOrderBoost` tooltip；`summarizeContributors` skip 集合加 `pbOvershootOrderBoost` |
| `web/src/decisionFlowViz.js` | `SPAWN_INTENT_COLOR.sprint='#0ea5e9'` / `SPAWN_INTENT_DESC.sprint='渐紧过渡'` / `dfv.reason.sprint` 触发原因 |
| `web/src/playerInsightPanel.js` | `SPAWN_INTENT_LABEL.sprint='渐紧'`；`SPAWN_TOOLTIP.spawnIntent` 更新加 sprint 说明 |
| `web/src/i18n/locales/{zh-CN,en}.js` | `dfv.intent.sprint` / `dfv.reason.sprint` 新增 |
| `tests/adaptiveSpawnV1571.test.js`（新增） | P0 平滑性 / P1 区间 / P2 锁死 / P3 sprint 跳转共 19 个用例 |

##### 严格遵守的边界

- **策略隐性原则不破**：sprint 文案"节奏渐紧，逐步收束"是中性陈述，不暴露"算法在过渡"这种术语；中文标签"渐紧"在 insightPanel（玩家主动打开）才可见，主 HUD 不暴露。
- **P2 bypass 链与现有 orderRigor 一致**：onboarding/recovery/bottleneck/holes>3/boardFill<0.5/inOnboarding 全部直接跳过——避免新手或挫败期玩家被"顺序刚性"双重打击。
- **P3 sprint 不与 challengeBoost 冲突**：challengeBoost > 0 时 spawnIntent 仍走 pressure（优先级链保证）；sprint 仅在 stress ∈ [0.45, 0.55) 且其他主导意图均未命中时填补过渡。
- **P0 数学性质保证渐近一致**：高 stress（≥ 0.80）时 softplus 输出与旧公式偏差 < 0.5%，保证 D3/D4 段强约束效果不变。

##### 与 §5.α.11 stress 感知化层的协同

| stress 区间 | §5.α.11 感官反馈（玩家显性感知） | §5.α.12 算法精算（玩家潜意识感知） |
|------------|------------------------------|--------------------------------|
| [0.45, 0.55) 渐紧过渡 | 氛围光从 flow（绿）转 engaged（暖琥珀）；呼吸节奏从 3.0s 加快到 2.4s | spawnIntent='sprint'；hints 中等偏紧（sizePref +0.10, multiClearBonus ≥ 0.40）；targetSolutionRange max=64 |
| [0.55, 0.85) 高压区 | 氛围光转 tense（橙红）；呼吸节奏 1.9s；震动 ×1.20；音频低通 5.5kHz | orderRigor 通过 softplus 平滑上升；spawnIntent 走 pressure；targetSolutionRange max=32 |
| ≥ 0.85 极限区 + D4 | 氛围光 intense（深红）；呼吸节奏 1.5s；震动 ×1.30；音频低通 4.0kHz | orderRigor + pbOvershootOrderBoost=0.25 → maxValidPerms=2（顺序锁死）；targetSolutionRange max=12 |

##### 验证

```
npx vitest run tests/adaptiveSpawnV1571.test.js
# Test Files  1 passed (1)
#      Tests  19 passed (19)
```

##### 多端同步策略（v1.57.1 关键产出）

> 本节是 v1.57.1 真正落地的"全端一致性收口"——4 个 P 级改进在 web 主端落地后，需要把策略同步到其他三个端（mobile / miniprogram / rl_pytorch）。各端按"现实依赖关系"采取不同同步策略，避免破坏现有约束。

| 端 | 集成方式 | v1.57.1 同步状态 | 改动文件 |
|------|---------|----------------|---------|
| **mobile**（iOS / Android） | Capacitor 包装，`capacitor.config.json` 的 `webDir: "../dist"` 指向 web 构建产物 | **零改动自动同步**——`npm run build` 时 web 端改动自动进入 dist | （无） |
| **miniprogram**（微信小程序） | 简化平行实现，仅含 stress 主链与 spawnIntent 6 档，**无** pbChase/D4/pbOvershoot 链路 | P0/P1/P3 完整同步；P2 配置占位（D4 链路本身未移植，待后续专项 PR） | `miniprogram/core/adaptiveSpawn.js`（P0 softplus + P3 sprint）；`miniprogram/core/gameRulesData.js`（P0/P1/P3 配置 + pbChase 顶层占位） |
| **rl_pytorch / spawn_model**（行为克隆模型） | 通过 SQLite `move_sequences.frames.ps.adaptive.spawnHints.spawnIntent` 提取标签 | **必须同步**——否则新数据中的 `'sprint'` 会被 dataset 静默映射成 `'maintain'`，破坏行为克隆对齐 | `rl_pytorch/spawn_model/dataset.py`（`BEHAVIOR_CONTEXT_DIM 56→57` + `_SPAWN_INTENTS` 加 sprint）；`model_v3.py`（`SPAWN_INTENT_VOCAB` 加 sprint）；`train_v3.py`（`intent_slice` 切片 `[48:54]→[48:55]`）；`test_v3.py`（断言 `(B, 6)→(B, 7)`） |
| **rl_pytorch / policy 主线**（PPO/MCTS） | `STATE_FEATURE_DIM=181` 棋盘+dock+标量编码，**不消费** spawnIntent | **零改动**——sprint 引入不影响 policy 模型输入维 | （无） |
| **rl_pytorch / game_rules.py** | 不主动读取 `adaptiveSpawn` / `topologyDifficulty` / `pbChase` / `sprintIntent` 节点 | **零改动**——RL env 与 web 自适应出块本就不在同一路径对齐 | （无） |

##### rl_pytorch spawn_model 向后兼容性

- **vocab 末尾追加 sprint**（而非中间插入）：idx 0~5 与旧版完全一致，旧 checkpoint 若加载后用于推理，仍能输出旧 6 种 intent；仅新增的 sprint（idx=6）永远输出为 0。
- **`BEHAVIOR_CONTEXT_DIM` 56→57** 不可避免地让 `board_proj.in_features` 从 `64+56=120` 变为 `64+57=121`，旧 checkpoint 加载会 shape mismatch 失败 — **这是预期破坏**，需重训。dataset.py 文件头注释已明确标记升级路径。
- **旧数据（无 sprint 标签）的样本**：`_intent_one_hot` 内 `_SPAWN_INTENTS.index('sprint')` 永远不会被命中（旧日志没这个值），样本的 sprint one-hot 维度恒为 0，对训练目标无干扰。

##### 多端验证清单

| 验证项 | 命令 | 结果 |
|--------|------|------|
| web 主端 1614 单测 | `npx vitest run` | ✅ 1614 passed |
| miniprogram JSON 语法 | `node --check miniprogram/core/gameRulesData.js` | ✅ OK |
| miniprogram 算法语法 | `node --check miniprogram/core/adaptiveSpawn.js` | ✅ OK |
| rl_pytorch spawn_model | `pytest rl_pytorch/spawn_model/test_v3.py -v` | ✅ 5 passed |
| rl_pytorch 全量 | `pytest rl_pytorch/ -x` | ✅ 76 passed |

#### §5.α.8 三原则下的算法完整闭环：D4 持续加压 + D0 分级减压 + PB 增长率反向加压（v1.56.4）

> **背景**：v1.56.3 §5.α.7 确立"策略隐性"原则后，对**算法层是否真正贯彻三大原则**做了系统性诊断，发现 3 处关键缺口与原则严重不符。本节是对算法层的完整收口。

##### 系统性诊断：v1.56.3 算法在三大原则下的缺口

| 缺口 | 位置 | 与哪条原则冲突 |
|------|------|----------------|
| **D4 段无持续加压** | `challengeBoost` 公式 `Math.min(0.15, (pct-0.8)·0.75)` 在 pct ≥ 1.0 时直接饱和到 0.15，pct=1.5 与 pct=1.0 加压量完全相同 | **"超 PB 高强度加压防分数膨胀，避免透支生命周期"完全做不到** |
| **D4 段 spawnHints 无收紧** | farFromPBBoost / pbExtremeOrderBoost 之外没有针对 `score > best` 的形态调整 | 玩家破 PB 后出块体感与 D1 段无差异 |
| **pbExtremeOrderBoost D4 不触发** | `score < ctx.bestScore` 硬条件 | 破 PB 后顺序约束立即消失，与"持续防膨胀"矛盾 |
| **farFromPBBoost 不分极远档** | pct < 0.30 一档处理，pct=0.05 与 pct=0.29 同强度 | 真正"畏难期"未得到差异化送爽 |
| **pbGrowthFast 只 bypass 不加压** | 当前仅触发 `farFromPBBoostBypass='pb_growth_throttled'` | 从"被动节流"应升级为"主动制动" |

##### 三层完整闭环

###### 1) D4 段：`pbOvershootBoost` 对数加压（stress 维度）

```
pbOvershootBoost = maxBoost · log10(1 + slope·overshoot) / log10(1 + slope)
其中 overshoot = score/best - 1.0
```

| pct = score / best | overshoot | pbOvershootBoost（默认 maxBoost=0.16, slope=5.0） |
|---|---|---|
| 1.00 | 0.00 | 0.000（临界，不触发） |
| 1.10 | 0.10 | ~0.040 |
| 1.25 | 0.25 | ~0.082 |
| 1.50 | 0.50 | ~0.117 |
| 2.00 | 1.00 | ~0.160（接近 cap） |

- **对数曲线** 保证"超得越多越难，但边际递减"，避免线性失控；
- 与 `challengeBoost` 共享 cap，stress 调到 `capStress=0.90`（高于普通 0.85）；
- 同源 bypass：低 PB 守卫 / postPbRelease / recovery / bottleneck / warmup / onboarding。

###### 2) D4 段：`pbExtremeOrderBoost` 延续 + `spawnHints` 收紧（形态维度）

| 维度 | D3（pct ∈ [0.95, 1)）| D4（pct > 1.0） |
|------|--------------------|------------------|
| stress | challengeBoost cap=0.15 + pbExtremeOrderBoost=0.20 | challengeBoost（饱和 0.15）+ **pbOvershootBoost 0~0.16** + **pbExtremeOrderBoost 0.08（D4 弱版）** |
| multiClearBonus | 不约束 | **上限 0.18**（抑制多消继续刷分） |
| sizePreference | 不调整 | **+0.12**（更密集大块） |
| clearGuarantee | 不调整 | **-1**（减少白送一块易消行） |
| 多消形状权重 | x1.0 | **x0.78**（blockSpawn 层） |
| 大块形状权重（cellCount ≥ 4） | x1.0 | **x1.20**（blockSpawn 层） |

效果：玩家在 D4 段的体感是「多消变难、出现更多 4 格+ 大块、需要更精细的安排」，连续可感地传达"超 PB 后越来越紧"。

###### 3) D0 段：`farRamp` 分级减压

| 子档 | 触发条件 | multiClearBonus floor | iconBonusTarget floor | sizePreference shift | 形状层权重 |
|------|---------|------------------------|------------------------|---------------------|-------------|
| 极远档（D0-α） | pct < 0.15 | **0.55**（v1.56 原 0.45） | **0.40**（原 0.30） | **-0.18**（原 -0.12） | 多消大块 x1.15 x1.13 ≈ x1.30 |
| 边缘档（D0-β） | 0.15 ≤ pct < 0.30 | 0.45 | 0.30 | -0.12 | 多消大块 x1.15 |

> **设计意图**：用户原则"离 PB 较远时减压，让玩家有信心进入挑战 PB 模式"。pct=0.05（极远，畏难最强）与 pct=0.29（边缘，即将进 D1）的玩家心态完全不同——极远段需要更强"敢挑战"的兑现信号，边缘段则不应继续大幅送爽（避免 PB 加速膨胀）。

###### 4) `pbGrowthFast` 反向加压：从被动节流到主动制动

| 状态 | v1.56 旧行为 | v1.56.4 新行为 |
|------|---------------|-----------------|
| `pbGrowthFast=false` | farFromPBBoost 正常激活 / challengeBoost cap=0.15 | 同左 |
| `pbGrowthFast=true` | farFromPBBoost bypass='pb_growth_throttled'（停送爽，不加压） | farFromPBBoost bypass 不变 **+ challengeBoost cap 临时上调到 0.20** |

> 触发条件：`pbGrowthTracker` 检测到 7 天内 PB 连续 ≥ 10% 增长。此时玩家正在"快速变强"，单纯停送爽不足以遏制膨胀，需要在 D2/D3 段提前进入更强加压区，让 PB 增长曲线平缓。

##### 三大原则 → 算法机制映射

| 原则 | 算法机制 | 体感传递通道 |
|------|---------|---------------|
| **远 PB 减压（让玩家敢挑战）** | farFromPBBoost（D0-β）+ farRamp.extreme（D0-α）+ 远征特效 ×1.3 | "我得分变顺了，奖励兑现更亮" |
| **近 PB 加压（挑战 PB 决战感）** | challengeBoost（D2/D3）+ pbExtremeOrderBoost（D3 强）+ 单线特效弱化 + best-gap--close/--chase 红橙提示 | "突然变难，每一步都更紧" |
| **超 PB 加压（防分数膨胀）** | **pbOvershootBoost（D4 对数）+ pbExtremeOrderBoost（D4 弱）+ D4 spawnHints 收紧 + 多消权重抑制/大块鼓励** | "超 PB 后越来越紧，多消变难、大块变多" |
| **PB 增长率反向加压** | **pbGrowthThrottle**（challengeBoost cap 0.15→0.20） | "刚连续刷过 PB，再追时手感更紧" |

##### 实现挂点

| 文件 | 改动 |
|------|------|
| `shared/game_rules.json` | `adaptiveSpawn.pbChase.overshoot / farRamp / pbGrowthThrottle` 三组配置 + 完整 comment |
| `web/src/adaptiveSpawn.js` | 4 处插入：challengeBoost cap 动态化 / pbOvershootBoost 对数加压 / pbExtremeOrderBoost D4 延续 / farRamp 极远档 / D4 spawnHints 收紧 / 新 flag 暴露 |
| `web/src/bot/blockSpawn.js` | 消费 `farExtremeBoostActive` / `pbOvershootActive`：多消权重 × 1.13 / × 0.78 + 大块权重 × 1.20 |
| `web/src/stressMeter.js` | SIGNAL_LABELS 新增 `farExtremeBoostActive` / `pbOvershootBoost` / `pbOvershootActive` / `challengeBoostGrowthCapBonus` 4 个中性标签 |
| `tests/bestScoreChaseStrategy.test.js` | +13 个用例（8 个 D4 对数曲线 + spawnHints / 2 个 D0 极远档 / 2 个 pbGrowthFast 加压 + 1 个 pbExtremeOrder D4） |

##### 单测覆盖矩阵

| 测试组 | 用例数 |
|--------|--------|
| D4 pbOvershootBoost：pct=1.0/1.25/1.5/2.0 临界与曲线 | 4 |
| D4 单调性（pct=1.1<1.3<1.7） | 1 |
| D4 与低 PB 守卫 / postPbRelease bypass | 2 |
| D4 spawnHints 收紧 + pbExtremeOrderBoost 延续 | 2 |
| D0 极远档 / 边缘档分级 | 2 |
| pbGrowthFast 反向加压（false / true） | 2 |

#### §5.α.7 策略隐性原则：远 PB 减压 / 近 PB 加压 / 超 PB 加压在算法层暗中执行（v1.56.3）

> **核心原则**：「远 PB 减压让玩家敢挑战 / 近 PB 加压制造决战感 / 超 PB 高强度加压防止分数膨胀」是**游戏背后的策略**，应通过**算法层、出块体感、HUD 视觉变化**让玩家感知，**不应在 UI 文字层直白告诉玩家"系统在为你做什么"**。

##### 反例（v1.56.0 ~ v1.56.2 早期实现违反此原则的位置）

| 位置 | 暴露策略意图的文案 | 问题 |
|------|---------------------|------|
| `best.gap.chase` | "冲刺区！还差 {{gap}} 分" | "冲刺区" 暗示系统进入了某种模式 |
| `best.gap.victory` | "即将刷新最佳！冲刺！" | 命令式煽情，与"系统在悄悄加难"的实际行为冲突 |
| `best.gap.close` | "接近了！💪" | 教练式鸡血，与事实陈述风格不一致 |
| `best.over.legend` | "🏆 超越 +{{overPct}}% · 封神时刻" | 系统在偷偷加难，玩家被狂吹，文/行为割裂 |
| `best.over.toNext25` | "突破 +10%！再追 {{next}}" | 与上同理 |
| `endGame.nearMiss.D3` | "差 {{gap}} 分 · 这把差点就刷了" | 系统的全知评价，破坏玩家自主感 |
| `endGame.nearMiss.D2` | "差 {{gap}} 分 · 状态不错，再来一把" | 教练式评价 |
| `stressMeter.PB_DISTANCE_NARRATIVE.farBoostActive` | "远征段送爽中：候选块更易消、更易触发同色奖励。" | **极其直白**——直接告诉玩家"系统在送爽" |
| `stressMeter.PB_DISTANCE_NARRATIVE.pbExtremeChase` | "冲刺区！系统已切到顺序约束模式 — 摆放先后比"哪块好放"更重要。" | **极其直白**——工程描述泄露给玩家 |
| `SIGNAL_LABELS.pbExtremeOrderBoost.label` | "D3 决战刚性" | 调试面板可能被玩家看到，暴露内部段位 |
| `SIGNAL_LABELS.farFromPBBoostActive.label` | "远征送爽" | 同上 |
| `pbStreak.badge` | "🏆 {{n}} 连破" | "🏆" 与 effect.newRecord 重复打鸡血 |

##### 三层重构

**1. 文字层（i18n）**——所有 best-gap / best.over / endGame.nearMiss 文案统一为「事实陈述」：

| Key | v1.56.3 zh-CN | v1.56.3 en |
|-----|----------------|------------|
| `best.gap` / `best.gap.neutral` | "差 {{gap}} 分" | "{{gap}} pts short" |
| `best.gap.far`（D0 远段锚点） | "历史最佳 {{best}}" | "Best {{best}}" |
| `best.over.neutral` | "已超 {{over}} 分" | "+{{over}} pts" |
| `endGame.nearMiss`（合并 D2/D3） | "差 {{gap}} 分" | "{{gap}} pts short" |
| `pbStreak.badge` | "连破 {{n}} 次" | "{{n}}× PB" |

五档（D0~D4）的差异化只通过 **CSS 样式** + **算法机制**体现，文字保持中性。

旧 key（victory / close / chase / follow / toNext10 / toNext25 / legend / nearMiss.D3 / nearMiss.D2）全部 `@deprecated`，内容降级为同样的事实陈述，但保留 key 以兼容 i18n 平台灰度回滚。

**2. 视觉层（CSS / extraClass）**——情绪密度差异只通过样式传达：

| 段 | extraClass | 视觉表达 |
|----|------------|----------|
| D3（pct ≥ 0.95） | `best-gap--close` | 红色高亮 → 紧张感 |
| D2（0.80 ≤ pct < 0.95） | `best-gap--chase` | 橙色 → 冲刺感 |
| D1（0.50 ≤ pct < 0.80） | （无） | 默认色 → 中性跟随 |
| D0（pct < 0.50） | （无） | 默认色 → 远征锚点 |
| D4（gap ≤ 0） | `best-gap--over` | 金色 → 突破感 |
| D2/D3 终局 banner | `near-miss-banner` / `near-miss-banner--D3` | banner 样式区分紧张度 |

**3. 算法层（出块 / 特效）**——策略静默执行，玩家通过体感感知：

| 段 | 算法机制 | 玩家体感 |
|----|---------|---------|
| D0 远段 | `farFromPBBoost`（multiClearBonus / iconBonusTarget / clearGuarantee 上调）+ blockSpawn 多消权重 ×1.15 | "我得分更顺了" |
| D2/D3 临近段 | `challengeBoost` 数值加压（v1.55 §4.2，cap 0.15） | "突然变难一点" |
| D3 决战段 | `pbExtremeOrderBoost`（orderRigor +0.20，顺序约束加强） | "感觉每一步都更紧" |
| D0 远段特效 | `playClearEffect` 振幅 ×1.3（多消 / perfect / bonusLines） | "庆祝感更强" |
| D3 决战特效 | 单线消行弱化（仅底色动画 + 微弱 shake） | "单线没那么爽了" |
| D4 超 PB | challengeBoost 继续加压 + 出块更紧 | "超出后越来越难继续刷" |

##### 同步动作

| 文件 | 改动 |
|------|------|
| `web/src/i18n/locales/{zh-CN,en}.js` | 13 个 key 降级为事实陈述（保留 key 兼容回滚） + 新增 `endGame.nearMiss` 合并 D2/D3 |
| `web/src/stressMeter.js` | 移除 `buildStoryLine §4.3` 抢占块；`PB_DISTANCE_NARRATIVE` 内容中性化；`SIGNAL_LABELS.pbExtremeOrderBoost.label="PB 临近调整"` / `farFromPBBoostActive.label="PB 远段倾斜"` |
| `web/src/game.js updateUI` | 五档分支合并文案到 `best.gap.neutral` / `best.gap.far` / `best.over.neutral`，extraClass 逻辑保留 |
| `web/src/game.js endGame` | D2/D3 banner 文案合并到 `endGame.nearMiss`，banner 样式继续区分 |
| `tests/bestScoreChaseStrategy.test.js` | 新增 §5.α.7 反向断言（13 个用例）：所有文案不含"冲刺/封神/送爽/系统已切/模式/教练评价"等暴露词 |

**算法行为零变化**——`farFromPBBoost` / `pbExtremeOrderBoost` / `challengeBoost` / `playClearEffect` 振幅调制 / nearMiss banner 触发条件全部保留，仅文字和叙事层"去策略暴露"。

##### 单测覆盖

`tests/bestScoreChaseStrategy.test.js` v1.56.3 §5.α.7 段：

| 测试组 | 用例数 |
|--------|--------|
| i18n 文案 key 存在性（包含 @deprecated 历史索引） | 12 |
| zh-CN / en 反向断言：不含"冲刺区/封神/送爽/Sprint zone/Legend mode/..."等 13 个暴露词 | 14 |
| `endGame.nearMiss` 事实陈述格式断言（含 {{gap}} 占位符、无煽情符号） | 2 |
| `stressMeter` PB 距离段不再抢占叙事 + `PB_DISTANCE_NARRATIVE` 内容中性化 + `SIGNAL_LABELS` 标签中性化 | 5 |

#### §5.α.6 认知一致性守卫：低 PB 时所有激烈文案降级（v1.56.2）

> **核心原则**：激励的激烈程度必须与"实际达成的不平凡程度"成正比。`bestScore=80` 时显示"差 5 分就到最佳！冲刺！"或破 PB 后写"🏆 封神时刻"会与玩家实际水平形成**喜剧反差**——5 分对低水位玩家不算"差点"，"封神"对 100 分的成绩也是夸张。

**统一阈值（运营可调）**：

```json
"adaptiveSpawn": {
  "pbChase": {
    "minBestScoreForIntenseFeedback": 200
  }
}
```

200 分对应：玩家完成 ~3-4 次多消组合 + 几次单线消行 = 已掌握基本玩法。低于此阈值时，**算法 + UI + 特效**三层同时降级或 bypass。

**作用范围（4 个 UI 触点 + 2 个算法机制 + 1 个特效层）**：

| 触发面 | 低 PB 行为 | 高 PB 行为（默认） |
|--------|-----------|---------------------|
| `best-gap` HUD（D0~D4） | 统一走 `best.gap.neutral` "差 N 分" / `best.over.neutral` "已超 N 分" | 5 档分层（victory / close / chase / follow / far）+ over 三档（toNext10 / toNext25 / legend） |
| `endGame` nearMiss banner | 不展示 | `pct ≥ 0.85` 时展示 D2/D3 banner |
| `pb-streak-badge` 连续突破徽章 | 不展示 | 7 天内 ≥ 2 次入栈 PB 时展示 "🏆 N 连破" |
| `playClearEffect` 远征 ×1.3 振幅放大 | 关闭（保持原始振幅） | D0 段（pct &lt; 0.5）多消 / perfect / bonusLines 振幅 ×1.3 |
| `adaptiveSpawn farFromPBBoost` | `bypass='low_best_score'` | 5 路 bypass 检查正常 |
| `adaptiveSpawn pbExtremeOrderBoost` | 不触发（直接跳过 orderRigor 注入） | `pct ∈ [0.95, 1)` 时注入 +0.20 |

**不受影响的部分**（设计取舍）：

- ✅ **PB 烟花本身不降级**：新手第一次破 PB 的仪式感（`_maybeCelebrateNewBest` 的 `triggerBonusMatchFlash / triggerPerfectFlash`）与 best 数值无关——这正是低水位玩家继续玩下去的核心激励，绝不能阉割。
- ✅ **`challengeBoost`（v1.55 §4.2）不变**：该机制本身已经 cap 在 0.15 内，且 `score / bestScore ≥ 0.8` 触发，低 best 时的"过度加压"风险已经被原有 5 路 bypass 覆盖。
- ✅ **`postPbReleaseStressAdjust`（v1.55 §4.9）不变**：破 PB 后 3 个 spawn 内 stress×0.7 是奖励性减压，对新手同样有意义。

**单测覆盖**：`tests/bestScoreChaseStrategy.test.js` v1.56.2 §5.α.6 段（共 12 个用例）：

| 测试 | 用例数 |
|------|--------|
| 算法 bypass：`farFromPBBoost(best=80)` / `pbExtremeOrderBoost(best=150)` / 阈值边界 200 / 199 / challengeBoost 不被影响 | 5 |
| `Game._isLowBestForIntenseCopy` 判定：best=0 / 199 / 200 / 5000 / NaN | 5 |
| i18n 中性文案存在性 + 反向断言（不含 "封神 / Legend"） | 2 |

---

## 6. 验证清单（用于评审 / QA）

> 任何涉及 PB 主线的改动 PR，须自检以下清单。括号内是 v1.55 落地后的状态。

- [x] `getSpawnStressFromScore(score=0, { bestScore })` 输出为 0（不论 bestScore 多少）。
- [x] `bestScore = 0` 时 `scoreStress` 走旧绝对档位，行为与首次开局玩家一致。
- [x] `pct < 0.5` 时 stress 必然被 `×0.4` 衰减（远征陪伴）。
- [x] `pct > 1.02` 时 stress 不再继续上升（突破段不加压）。
- [x] `_bestScoreAtRunStart` 在本局开始时被快照，本局新刷的 PB 不会让 challengeBoost / new-best 触发陷入循环。
- [x] `_newBestCelebrated` + `_newBestCelebrationCount` 单局上限 **1 次**（v1.55.11 由 3 收敛回 1；2+ 次起静默更新——见 §5.y）。
- [x] `S·M` 调制表 25 格全覆盖（§4.1 已落地：`tests/bestScoreChaseStrategy.test.js`）。
- [x] 救济期 / 瓶颈 / 挫败 / warmup / postPbRelease 时 challengeBoost = 0；具体 bypass 原因见 `stressBreakdown.challengeBoostBypass`（§4.2 已落地）。
- [x] `best.gap.far` 文案在 D0 段（ratio > 0.50）被触发，且按 placements % 3 轮换 3 条 alt 文案（§4.3 已落地）。
- [x] Hard 模式 `bestScore` 不再被 Easy 模式覆盖（§4.4 已落地：客户端层 `bestScoreBuckets.js` bucket cache）。
- [x] DFV 面板能完整显示当前 stress 的 `lifecycleCapAdjust / lifecycleBandAdjust / challengeBoost / postPbReleaseStressAdjust / challengeBoostBypass` 五段贡献。
- [x] 破 PB 后 3 spawn 内 stress×0.7 + clearGuarantee+1（§4.9 已落地）。
- [x] 破 PB 自动 emit `lifecycle:new_personal_best`；D3 段（pct ≥ 0.95）首次自动 emit `lifecycle:near_personal_best`（§4.12 已落地）。
- [x] 单局得分 > previousBest × 5（默认）进入审核态：内存更新但不写后端 PB；emit `lifecycle:suspicious_pb`（§4.10 已落地）。
- [x] `openblock_best_by_strategy_v1` / `openblock_period_best_v1` 已纳入 `localStorageStateSync` core section（§4.11 已落地）。
- [x] hard 模式破 PB 时 setShake / bonusMatchFlash 强度 ×1.3（§4.13 已落地）。
- [x] `tests/adaptiveSpawn.test.js` 76 个测试全绿。
- [x] `tests/nearMissAndMilestone.test.js` `best.gap.*` / scoreMilestone 套件全绿。
- [x] `tests/challengeDesignOptimization.test.js` 25 个测试全绿（P1-1 已根据 §4.1 新事实调整为 "S3 cap 依实际 band 而定"）。
- [x] `tests/bestScoreChaseStrategy.test.js` 50 个测试全绿，覆盖本文档 13 个改进项。
- [x] 全量 `npm test`：93 文件 / 1407 测试全部通过。
- [x] `npm run lint`：0 errors（22 pre-existing warnings 与本次改动无关）。
- [x] **v1.55.10**：start() 复位 5 个跨局 PB 状态、可疑 PB 不显示结算页皇冠（§5.x R3/R4）。
- [x] **v1.55.10**：`refreshBestScoreFromBucket()` 在 hydrate 之后调用，跨设备首次加载分桶 PB 正确（§5.x R1）。
- [x] **v1.55.10**：socialLeaderboard 的"我的最佳"以分桶 PB 为权威源，legacy `openblock_best_score` 仅作 hydrate 兼容（§5.x R5）。
- [x] **v1.55.10**：bestScore < 500 时任何分数都不触发 milestone toast；base / post-PB 段各 1 次（§5.x b/d）。
- [x] **v1.55.10**：milestone toast 文案为"已达最佳 X%"百分比格式，玩家直观可读（§5.x c）。
- [x] **v1.55.10**：score === bestScore（且 best ≥ 500、本局首次、未破 PB）触发 `.float-tie-best` 绿色追平特效（§5.x a）—— v1.55.11 已撤销。
- [x] **v1.55.10**：全量测试 1429 / 1429 通过 —— v1.55.11 收敛后为 1428 / 1428。
- [x] **v1.55.11**：`CELEBRATIONS_PER_RUN_CAP = 1`，PB 庆祝单局只放一次烟花（§5.y）。
- [x] **v1.55.11**：19 语言 `effect.newRecord` 统一加 `🏆 ` 前缀 + 感叹号；zh-CN 为"🏆 刷新最佳！"，en 为"🏆 New Record!"（§5.y）。
- [x] **v1.55.11**：`showFloatScore('scoreMilestone')` 不再被调用且分支早返回；任何输入都不产生 `.float-milestone` DOM（§5.y）。
- [x] **v1.55.11**：`_maybeCelebrateTiePersonalBest` 始终返回 false 且无 DOM 副作用；契约由 `tests/gameBestScore.test.js` 锁定（§5.y）。
- [x] **v1.55.11**：全量测试 1428 / 1428 通过、lint 0 errors。

---

## 7. 数据指标（建议接入 ops 看板）

| 指标 | 维度 | 期望区间 | 含义 |
|------|------|------------|--------|
| **PB 破纪录率** | 按 S × M 切片 | M0: 30%/局，M4: 5%/局 | 每局触发 `_maybeCelebrateNewBest` 的比例；过高 = 难度松；过低 = 难度过严 |
| **D2/D3 停留时长** | 按 S × M 切片 | 平均 ≥ 30 s（D3 ≥ 10 s） | "冲刺感"是否真的形成；过短 = challengeBoost 未生效 |
| **PB 后 5 spawn 停留率** | 全玩家 | ≥ 80% | 破纪录后玩家是否继续玩；过低 = §4.9 释放窗口缺失 |
| **PB 增长速率** | 按 M 切片，滚动 30 局 | M0: +10%/局，M4: +1%/局 | 是否仍有进步空间；停滞 → §4.7 周期 PB 救场 |
| **PB 异常分占比** | 全玩家 | ≤ 0.1% | 触发 §4.10 审核态的频次 |
| **near-PB lifecycle 事件转化** | 商业化 | 推送转化率 ≥ 均值的 1.5× | 验证 §4.12 价值 |

---

## 8. 文档关联

- 上游方法论：[体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md)（5 轴体验结构）
- 系统通用模型：[策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md)（L1–L4 通用分层）
- 同层实时管线：[实时策略系统](./REALTIME_STRATEGY.md)（指标字典、L4 卡片生成）
- 算法事实：[自适应出块](../algorithms/ADAPTIVE_SPAWN.md)（多信号 stress 融合 / `spawnHints` 派生）
- 出块机制：[出块算法：三层架构 §2.5 策略 → 出块翻译机制](../algorithms/SPAWN_ALGORITHM.md#25-策略--出块翻译机制v15516)（`spawnHints` 如何变成具体 3 个块：5 阶段流水线 + 30+ 加权乘子 + 硬约束 + 场景跑步）
- 跨局画像：[生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)（S0–S4 × M0–M4）
- 计分规则：[消行计分](../product/CLEAR_SCORING.md)（如何把"消行"转成 score）
- 难度档：[难度模式](../product/DIFFICULTY_MODES.md)（Easy/Normal/Hard 与自适应协作）
- 行业实证：[休闲游戏品类分析](../domain/CASUAL_GAME_ANALYSIS.md) §10、[领域知识](../domain/DOMAIN_KNOWLEDGE.md)

---

*文档版本：1.55.11（2026-05-16 初版；2026-05-16 v1.55 落地版 — §4.1~§4.13 全部交付；2026-05-16 v1.55.10 修订版 — PB 5 风险点 + milestone 文案与频次重塑 + 追平最佳新特效；2026-05-16 v1.55.11 收敛版 — 撤销追平 + 撤销 milestone toast 渲染 + PB 庆祝单局 1 次 + 19 语言文案加 🏆 前缀）。*
*以仓库主分支为事实来源。*
*维护者：策划组 + 体验算法组联合维护；改动需走 PR 评审并同步更新 §4 改进项编号与 §6 验证清单。*
