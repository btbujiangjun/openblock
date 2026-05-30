# 最佳分追逐策略：挑战自我而不轻易超越（Best Score Chase Strategy）

> **读者**：主策划人、策略设计师、运营策略负责人；二级读者：体验算法工程师、运营 QA。  
> **定位**：本文以"挑战玩家**自己的**最佳得分（personal best）"为核心主策略，沉淀**当前实现的事实**、**玩家四维关系矩阵**与**改进/优化点**，是 OpenBlock 体验设计在"留存动力"维度上的策划契约文档。  
> **不是**：本文不是计分规则手册（详见 `docs/product/CLEAR_SCORING.md`），不是难度模式说明（详见 `docs/product/DIFFICULTY_MODES.md`），不是自适应出块算法手册（详见 `docs/algorithms/ADAPTIVE_SPAWN.md`）；本文聚焦"**最佳分这条主线**"在不同玩家身上**应该如何呈现、如何调控**。  
> **维护**：改动 `getSpawnStressFromScore` / `deriveScoreMilestones` / `LIFECYCLE_STRESS_CAP_MAP` / `_maybeCelebrateNewBest` / `best.gap.*` 文案 / `dynamicDifficulty` / `runDifficulty` 配置时，必须同步更新本文的"当前事实"对应小节与改进项编号。
>
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
| **PB 是否影响难度** | **是**，scoreStress 直接由 `score / max(bestScore, floor)` 派生。 | 老玩家比新玩家的同分数表现更难（必要预期）。 | 老玩家不会"开局 0 分被 6 个里程碑连击"，也不会"过末档后压力锁死最高"。 |
| **PB 临近时是否额外加压** | **是**（"B 类挑战加压"），但**有上限**与**心流互抑**。 | 部分玩家会觉得"越接近 PB 越难"，需要叙事配合解释。 | 把"差一点"的临场感放大；同时防止破纪录后体验断崖。 |
| **PB 庆祝的强度** | 全屏震屏 + 双闪光 + 浮层弹幕；但**一局一次**。 | 重复刷新 PB 的玩家只能拿到首次的烟花。 | 保持稀有性，避免成为 spam。 |
| **PB 是否区分难度档** | 客户端层按难度分桶（`bestScoreBuckets.js`），HUD 显示当前难度的 PB；后端 `db.getBestScore()` 仍为全难度（保留容灾合并空间）。 | 服务器侧仍是全难度合并值，跨设备同步走 `localStorageStateSync` 同步分桶字段。 | Easy / Normal / Hard 各自独立 PB；详见 §4.4。 |

### 1.3 与既有体验模型的关系

本文不重复 [体验设计基石（5 轴体验结构）](./EXPERIENCE_DESIGN_FOUNDATIONS.md) 与 [策略体验栈（L1–L4 通用模型）](./STRATEGY_EXPERIENCE_MODEL.md) 的方法论，而是**把它们投影到 PB 这条主线**上：

- **挑战-能力轴（C）**：PB 接近度是高承受力玩家的天然挑战源；为承受力不足的玩家（新手 / 回流 / 高挫败）按 `LIFECYCLE_STRESS_CAP_MAP` 软封顶。
- **节奏-报偿轴（R）**：分数里程碑（绝对/相对双制）按"上一次 PB × {0.25, 0.5, 0.75, 1.0, 1.25}"切节奏，让接近 PB 的最后一段更有冲刺感。
- **情感-共鸣轴（E）**：`best.gap.victory`（"即将刷新最佳！冲刺！"）与新纪录烟花做情感锚定；`best.gap.far` 给"继续努力~"做长尾陪伴。
- **认知-学习轴（K）**：score-push 守卫把 intense 档"保活"叙事改成"冲分仪式感"，避免空盘高压违和。
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
| **M3** | 资深 | 80–89 | 接受 orderRigor（顺序刚性）+ challengeBoost 上限 0.15。 |
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

### 3.2 scoreStress：个人百分位映射

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

### 3.3 分数里程碑：绝对/相对双制

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
if friendlyBoardRelief < −0.09  →  challengeBoost *= 0.42   // 互抑
stress = min(0.85, stress + challengeBoost)
```

**策略语义**：

- 0.8 是"明确接近"的阈值；0.15 上限保证不会越过 `tense → intense` 一档以上。
- 与 friendlyBoardRelief（友好盘面救济）互抑：盘面 holes=0 且 nearFullLines≥2 且 payoff 期时 friendlyBoardRelief 介入；如果同帧两者都强，challengeBoost ×0.42 让位，避免"既要救济又要加压"的锯齿。
- 不进入 D4 突破段（pct > 1）后不再加压：让玩家感受到"破纪录瞬间反而轻盈"。

### 3.5 生命周期 × 成熟度 stress cap

**入口**：`web/src/lifecycle/lifecycleStressCapMap.js → LIFECYCLE_STRESS_CAP_MAP`（详见 [生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)）。

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
| **被困救济**（bottleneckRelief） | `firstMoveFreedom ≤ 阈值` | 同上；目前仍可与 challengeBoost 同帧（改进项 §4.2）。 |

### 3.7 叙事与 UI

#### 3.7.1 `best.gap` HUD（实时距离提示）

| 文案 key | 触发（`ratio = gap / bestScore`） | i18n（zh-CN） |
|----------|-------------------------------------|-----------------|
| `best.gap.victory` | `gap > 0` 且 `ratio ≤ 0.02`（D3 决战段最近） | "即将刷新最佳！冲刺！" |
| `best.gap.close` | `0.02 < ratio ≤ 0.05` | "接近了！💪" |
| `best.gap.neutral` | 其他 `gap > 0` 时 | "差 {{gap}} 分" |
| `best.gap.far` | （目前未挂接到实际触发，i18n 资源已就位） | "继续努力~" |

**已知缺口**：`best.gap.far` 文案存在但无触发路径；改进项 §4.3。

#### 3.7.2 Score-push 高压守卫

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

### 4.1 LIFECYCLE_STRESS_CAP_MAP 死键与跨格补全（P0）

**问题**：调制表当前缺 `S0·M1+`、`S2·M4`、`S3·M0` 等组合（约 8 个 `S·M` 死键）。`getLifecycleStressCap` 返回 null 时下游静默跳过 cap/adjust，**raw stress 直通**——若此时 challengeBoost / scoreStress 同时活跃，会让中等画像玩家偶发拿到与表外预期不符的高 stress。

**改进**（已落地）：

1. ✅ 已补全 25 格 `S·M`（5×5）映射：见 `web/src/lifecycle/lifecycleStressCapMap.js`，按"行内单调（M0→M4 cap 递增）+ S0 整体 cap≤0.65 + S4 < S2/S3 同 band"原则插值；
2. ✅ `LIFECYCLE_STAGE_CODES` / `LIFECYCLE_BAND_CODES` 已对外导出，供 panel 与单测枚举使用；
3. ✅ 新增单测 `§4.1 LIFECYCLE_STRESS_CAP_MAP 25 格全覆盖（无死键）` 4 条：枚举 25 组合全有效 + 行内单调 + S0 钳制 + S4 ≤ S2/S3。

**风险**：补的新格会改变线上分布；已让既有契约测试 `tests/challengeDesignOptimization.test.js` P1-1 反映新事实（S3·M0 现 cap=0.65）。

### 4.2 救济期与 challengeBoost 互斥（P0）

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

### 4.3 `best.gap.far` 触发挂接 + D0 远征陪伴叙事（P1）

**问题**：i18n 19 个语言包都备好了 `best.gap.far`（"继续努力~"），但 `updateUI` 中 `ratio` 只走 victory/close/neutral 三档，**远征区（D0）无任何陪伴文案**。

**改进**（已落地）：

1. ✅ `best.gap.far` 触发阈值改为 `ratio > 0.50`（pct < 0.5，对应 D0 远征段）；
2. ✅ 新增轮换文案池：`best.gap.far` / `best.gap.far.alt1` / `best.gap.far.alt2`，按本局已落子数 `placements % 3` 选一条；alt2 / 主文案都用 `{{best}}` 占位 PB 数值，给玩家数值锚定（"本次最佳 1200 · 慢慢追"）；
3. ✅ zh-CN 与 en 两个核心语言包都补齐 3 条；其他 17 语言走 zh-CN fallback（与既有 `best.gap.victory / close / neutral / far` 同等级处理，不强制 19 全有）；
4. ✅ §4.5 warmup gate 同时启用：本局前 3 个落子不展示任何 best.gap 文案，避免开局拥堵。

**单测**：`§4.3 best.gap.far 远征陪伴文案（主 + alt1 + alt2）` 4 条覆盖文案存在 + {{best}} 占位 + zh-CN/en 平价。

### 4.4 PB 按难度档分桶（P1）

**问题**：当前 `db.saveScore(score, strategy)` 写入了 strategy 字段但 `db.getBestScore()` 仅返回**全难度**最高分。

**改进**（已落地客户端层 MVP）：

1. ✅ 新建 `web/src/bestScoreBuckets.js`：`submitScoreToBucket(strategy, score)` / `getBestByStrategy(strategy)` / `getAllBestByStrategy()`；持久化 key=`openblock_best_by_strategy_v1`；
2. ✅ `Game.init()` 启动时读 bucket PB，若小于全账号 PB 则用 bucket 值（更精确，避免 Easy 刷分污染 Normal）；
3. ✅ 每局 endGame 写入对应 strategy 的 bucket；未知 strategy 自动回退到 `normal`；
4. ✅ HUD 新增 `best-strategy-badge` 元素，hard 时显示 🔥 HARD 金色闪烁，easy 时显示 🌱 EASY 绿色；normal 隐藏（减少视觉噪音）；
5. ✅ 服务器侧 `db.saveScore` 保持原状（仍写单一全账号 PB），分桶 PB 走 localStorage + §4.11 跨设备同步；后端 schema 改动留待大型 PR。

**单测**：`§4.4 + §4.7 bestScoreBuckets` 8 条覆盖 submit / get / 跨 strategy 隔离 / 未知 strategy fallback。

### 4.5 D × P 显式 gate（P1）

**问题**：当前 `best.gap` 与 `challengeBoost` 在 P0（warmup）阶段也会触发，开局头三个落子玩家就被告知"差 500 分"。

**改进**（已落地）：

1. ✅ `Game.updateUI` 中以 `gameStats.placements < 3` 为 warmup 判据隐藏 best.gap；
2. ✅ `isBClassChallenge` 增加 `sessionArc === 'warmup'` bypass（bypass='warmup'），见 §4.2 落地实现；
3. ⏳ P2（cooldown）阶段的 `runStreakHint` 抑制留待 §5 Q+2 单独 PR。

**单测**：与 §4.2 合并为 `§4.2 + §4.5` 套件，warmup 段（totalRounds ≤ 3）必返回 `challengeBoostBypass='warmup'`。

### 4.6 D3 决战段 + D4 突破段的"二度里程碑"（P1）

**问题**：当前相对里程碑 `[0.25, 0.5, 0.75, 1.0, 1.25] × bestScore` 在玩家**破纪录后**就只剩一个 1.25× 节点。

**改进**（已落地）：

1. ✅ `deriveScoreMilestones(bestScore, currentScore)` 当 `currentScore > bestScore` 时把 `[bestScore × 1.10, bestScore × 1.25]` 合并去重并升序注入；
2. ✅ `_maybeCelebrateNewBest` 改为支持单局多次：首次走完整烟花 + `effect.newRecord`；2-3 次走弱版烟花 + `effect.newRecord.second`（带 `{{delta}}`，i18n 已添加）；4 次起静默更新 bestScore（CELEBRATIONS_PER_RUN_CAP=3）；
3. ✅ `_newBestCelebrationCount` 计数 + `compareBase` 滑动比较基线（已庆祝时用 `bestScore` 而非 `runStartBest`），确保连续 score 增长触发多次"再破纪录"而非反复触发"首次"；
4. ✅ CSS 添加 `.new-best-popup--second` 子样式（22px 标题 + 28px score + 1.3s 缩短）。

**单测**：`§4.6 二度里程碑` 5 条覆盖未破/+10%/+25%/新手 bestScore=0/effect 文案。

### 4.7 季度 / 周期 PB（P2）

**改进**（已落地）：

1. ✅ `bestScoreBuckets.js` 中 `submitPeriodBest(score)` + `getPeriodBest()`：滚动 ISO 周 + 自然月 PB；
2. ✅ `deriveWeekKey` 按 ISO 8601 周（周一为起点）派生；`deriveMonthKey` 按自然月；跨周/跨月自动重置；
3. ✅ `Game.endGame` 自动写入周期 PB；命中 weekly/monthly 更新时通过 `MonetizationBus` emit `lifecycle:period_best`，订阅方可推送"周冠军"等运营事件；
4. ⏳ HUD 切换"本周 PB / 历史 PB"留待 UI 后续 PR。

**与 §4.4 协同**：周期 PB 全难度合并（避免对 Easy / Hard 双重周冠）；如需按难度档分周期 PB，可在 submitPeriodBest 增加 strategy 字段。

**单测**：`§4.7` 4 条覆盖周/月 key 派生 + 跨窗口重置 + localStorage key 命名。

### 4.8 PB 距离感的"反向引导"——给 D3/D4 玩家发出可见的策略卡（P2）

**改进**（已落地）：

1. ✅ `strategyAdvisor.generateStrategyTips` 新增 `pbChase` 类别：
   - **D4 释放窗口**（`postPbReleaseActive=true`）：🎆 庆功小憩（priority 0.76）；
   - **D3.victory**（pct ≥ 1.0 且 celebrationCount > 0，释放窗口已结束）：🚀 再破纪录（priority 0.78）；展示下一节点 `bestScore × 1.10`；
   - **D3.close**（pct 0.95~0.999）：🏁 决战一脚（priority 0.84）；展示剩余分数；
2. ✅ `playerInsightPanel` 把 `pbContext = { currentScore, bestScore, postPbReleaseActive, celebrationCount }` 注入 gridInfo；
3. ✅ 与 `applyTipCategoryDiversity` 兼容：pbChase 是非 survival，可自动替换三连 survival 中的最弱一条；
4. ✅ 优先级 0.76~0.84，低于生存卡（fill>0.75 时 0.95）但高于构型/节奏卡，符合"保命优先 + PB 情感锚定"原则。

**单测**：`§4.8 strategyAdvisor pbChase 策略卡` 5 条覆盖 D4 / D3.victory / D3.close / D0–D2 不出 / pbContext 缺失兜底。

### 4.9 破纪录后"释放窗口"（P2）

**改进**（已落地）：

1. ✅ `Game._startPostPbReleaseWindow()` 在 `_maybeCelebrateNewBest` 内被自动调用，写入 `_spawnContext.postPbReleaseActive=true` + `postPbReleaseRemaining=3`；
2. ✅ `adaptiveSpawn` 主路径在 stress final clamp 后消费 `ctx.postPbReleaseActive`：正向 stress × 0.7 + `stressBreakdown.postPbReleaseStressAdjust` 持久化；
3. ✅ 同帧 `challengeBoost` bypass='post_pb_release'（见 §4.2）；
4. ✅ spawnHints.clearGuarantee 最低 +1 至 2、sizePreference 偏小块；
5. ✅ `_commitSpawn` 每轮 spawn 完成后 `postPbReleaseRemaining -= 1`，归零时自动清 active；
6. ✅ `_postPbReleaseUsed` cooldown：单局只用一次（即使连续刷新 PB 也不重置），避免后续过度轻量。

**单测**：`§4.9 postPbReleaseWindow` 4 条覆盖 active=true 时 stress 衰减 + challengeBoost bypass + clearGuarantee≥2 + active=false 时不衰减。

### 4.10 PB 失效守卫与异常分阈值（P2）

**改进**（已落地异常分守卫）：

1. ✅ `Game.endGame` saveScore 路径前加 sanity check：`previousBest >= minBase(默认 50) && score > previousBest × multiplier(默认 5)` 时进入审核态；
2. ✅ 审核态：内存中 `this.bestScore` 更新（让本局 UI 正常展示），但 **不**写后端 `db.saveScore`；同时 emit `lifecycle:suspicious_pb` 到 MonetizationBus，让风控订阅方接力；
3. ✅ `GAME_RULES.bestScoreSanity = { enabled, multiplier=5, minBase=50 }`，运营可在 `shared/game_rules.json` 动态调整；
4. ⏳ 回流玩家 bestScore 折扣留待 §5 Q+2 单独 PR（与 winback 保护包重叠，需联合调优）。

**单测**：`§4.10 异常分守卫` 4 条覆盖配置存在性 + 触发判定 + minBase 新手保护 + 阈值边界。

### 4.11 跨设备 PB 同步与"账号合并"策划口径（P3）

**改进**（已落地基础）：

1. ✅ `web/src/localStorageStateSync.js` `CORE_KEYS` 已加入 `openblock_best_by_strategy_v1` 与 `openblock_period_best_v1`：
   - 走 core section（5 秒一推、跨设备 hydrate）；
   - 合并策略沿用现有 `_mergeRemoteIntoLocal`：远端只补齐本地缺项，本地已有值优先；分桶字段是 JSON 字符串，合并粒度是整个对象（如需更细粒度的 max(local, remote) per bucket 可后续拆分）。
2. ⏳ 全账号 `openblock_best_score` 字段已加入 CORE_KEYS，跨设备 hydrate 已生效。
3. ⏳ 账号合并 / 赛季重置等运营动作待 §5 Q+3 与运营单独评审。

**单测**：`§4.11 跨设备 PB 同步` 2 条，确认 `_sectionForKey('openblock_best_by_strategy_v1')==='core'` + `_sectionForKey('openblock_period_best_v1')==='core'`。

### 4.12 数据反馈环：把 PB 行为写入 `MonetizationBus` 与 `lifecycleSignals`（P2）

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

### 4.13 高难度模式（Hard）与 PB 主线的衔接（P3）

**改进**（已落地）：

1. ✅ HUD `#best-strategy-badge` 元素 + CSS：hard 时显示 🔥 HARD 金色烟火闪烁 + `box-shadow` 脉冲；easy 时显示 🌱 EASY 绿色；normal 隐藏；
2. ✅ `_maybeCelebrateNewBest` 在 hard 模式时烟花强度 ×1.3：
   - 首次破 PB：bonusMatchFlash 3→4 / setShake 18→23 / 持续 900→1170ms；
   - 二度/三度：bonusMatchFlash 1→2 / setShake 9→12 / 持续 450→585ms；
3. ✅ 与 §4.4 分桶协同：hard PB 与 normal PB 互不污染。

**单测**：`§4.13 Hard 模式 PB UI` 2 条覆盖 hardScale=1.3 / normalScale=1.0 计算精度。


## 6. 验证清单（用于评审 / QA）

> 任何涉及 PB 主线的改动 PR，须自检以下清单。

- [x] `getSpawnStressFromScore(score=0, { bestScore })` 输出为 0（不论 bestScore 多少）。
- [x] `bestScore = 0` 时 `scoreStress` 走旧绝对档位，行为与首次开局玩家一致。
- [x] `pct < 0.5` 时 stress 必然被 `×0.4` 衰减（远征陪伴）。
- [x] `pct > 1.02` 时 stress 不再继续上升（突破段不加压）。
- [x] `_bestScoreAtRunStart` 在本局开始时被快照，本局新刷的 PB 不会让 challengeBoost / new-best 触发陷入循环。
- [x] `_newBestCelebrated` + `_newBestCelebrationCount` 单局上限 **1 次**（2+ 次起静默更新）。
- [x] `S·M` 调制表 25 格全覆盖。
- [x] 救济期 / 瓶颈 / 挫败 / warmup / postPbRelease 时 challengeBoost = 0；具体 bypass 原因见 `stressBreakdown.challengeBoostBypass`。
- [x] `best.gap.far` 文案在 D0 段（ratio > 0.50）被触发，且按 placements % 3 轮换 3 条 alt 文案。
- [x] Hard 模式 `bestScore` 不再被 Easy 模式覆盖（客户端层 `bestScoreBuckets.js` bucket cache）。
- [x] DFV 面板能完整显示当前 stress 的 `lifecycleCapAdjust / lifecycleBandAdjust / challengeBoost / postPbReleaseStressAdjust / challengeBoostBypass` 五段贡献。
- [x] 破 PB 后 3 spawn 内 stress×0.7 + clearGuarantee+1。
- [x] 破 PB 自动 emit `lifecycle:new_personal_best`；D3 段（pct ≥ 0.95）首次自动 emit `lifecycle:near_personal_best`。
- [x] 单局得分 > previousBest × 5（默认）进入审核态：内存更新但不写后端 PB；emit `lifecycle:suspicious_pb`。
- [x] `openblock_best_by_strategy_v1` / `openblock_period_best_v1` 已纳入 `localStorageStateSync` core section。
- [x] hard 模式破 PB 时 setShake / bonusMatchFlash 强度 ×1.3。
- [x] `tests/adaptiveSpawn.test.js` 76 个测试全绿。
- [x] `tests/nearMissAndMilestone.test.js` `best.gap.*` / scoreMilestone 套件全绿。
- [x] `tests/challengeDesignOptimization.test.js` 25 个测试全绿。
- [x] `tests/bestScoreChaseStrategy.test.js` 50 个测试全绿，覆盖本文档 13 个改进项。
- [x] 全量 `npm test`：93 文件 / 1407 测试全部通过。
- [x] `npm run lint`：0 errors（22 pre-existing warnings 与本次改动无关）。

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

## 8. 文档关联

- 上游方法论：[体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md)（5 轴体验结构）
- 系统通用模型：[策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md)（L1–L4 通用分层）
- 同层实时管线：[实时策略系统](./REALTIME_STRATEGY.md)（指标字典、L4 卡片生成）
- 算法事实：[自适应出块](../algorithms/ADAPTIVE_SPAWN.md)（多信号 stress 融合 / `spawnHints` 派生）
- 出块机制：[出块算法：三层架构 §2.5 策略 → 出块翻译机制](../algorithms/SPAWN_ALGORITHM.md#25-策略--出块翻译机制)（`spawnHints` 如何变成具体 3 个块：5 阶段流水线 + 30+ 加权乘子 + 硬约束 + 场景跑步）
- 跨局画像：[生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)（S0–S4 × M0–M4）
- 计分规则：[消行计分](../product/CLEAR_SCORING.md)（如何把"消行"转成 score）
- 难度档：[难度模式](../product/DIFFICULTY_MODES.md)（Easy/Normal/Hard 与自适应协作）
- 行业实证：[休闲游戏品类分析](../domain/CASUAL_GAME_ANALYSIS.md) §10、[领域知识](../domain/DOMAIN_KNOWLEDGE.md)

*以仓库主分支为事实来源。*
*维护者：策划组 + 体验算法组联合维护；改动需走 PR 评审并同步更新 §4 改进项编号与 §6 验证清单。*
