# 最佳分追逐策略：挑战自我而不轻易超越

> **读者**：主策划、策略设计师、运营策略负责人（二级：算法工程师、运营 QA）  
> **定位**：以"挑战自身最佳得分（PB）"为核心主策略，沉淀当前实现事实、四维关系矩阵与改进点，是"留存动力"维度的策划契约。  
> **非本文内容**：计分规则 → `docs/product/CLEAR_SCORING.md`；难度模式 → `docs/product/DIFFICULTY_MODES.md`；自适应出块 → `docs/algorithms/ADAPTIVE_SPAWN.md`。本文聚焦"最佳分主线"在不同玩家身上的呈现与调控。  
> **维护**：修改 `getSpawnStressFromScore`、`deriveScoreMilestones`、`LIFECYCLE_STRESS_CAP_MAP`、`_maybeCelebrateNewBest`、`best.gap.*` 文案、`dynamicDifficulty`、`runDifficulty` 配置时，同步更新本文对应小节与改进项编号。
>
---

## 一、一句话主张（One-liner Pitch）

> **"再差一点点，就能刷新自己。"**  
> OpenBlock 把"打破个人最佳分"作为**单玩家、无尽模式、无关卡终局**下的**唯一长期目标**：所有自适应难度、节奏调控、叙事文案、奖励兑现都围绕**让玩家感到这件事很近但需要付出**展开——不轻易超越，又不至于绝望。

---

## 二、设计哲学：为什么以"挑战最佳分"为核心

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

## 三、玩家关系矩阵：四维差异化

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
| **D4** | 突破段 | pct > 1.02 | scoreStress 按 `percentileMaxOver=0.5` 外推；与 `pbOvershootBoost` 协同形成「超 PB 越来越难」；触发 `_maybeCelebrateNewBest`；之后进入"破纪录后释放窗口"。 |

### 2.3.1 PB 声音符号层（研究实现）

PB 追逐 BGM 是**游戏级声音符号**，不跟随皮肤音色变化；它服务于"快破纪录了"这条长期目标，而不是某个皮肤世界观。当前研究实现使用真实 OGG 音频文件，不使用程序化合成音：

| PB 段 | 触发条件 | 音频文件 | 播放策略 |
|------|----------|----------|----------|
| D2 临近 | `0.80 ≤ score / runStartPB < 0.95` | `pb_near.ogg` | 低音量循环，提示本局进入 PB 区。 |
| D3 决战 | `0.95 ≤ score / runStartPB ≤ 1.0` | `pb_sprint.ogg` | 稍高音量循环，强化临门一脚的专注感。 |
| D4 突破 | `score > runStartPB` 首次命中 | `pb_release.ogg` | 单次播放，作为破 PB 的音乐释放。 |

跨端资源路径统一为 `audio/game/pb_chase/`，对应 Web、小程序、Cocos 三端资源目录。该层共享现有音效开关；关闭音效时 PB BGM 静默。`runStartPB` 必须使用开局快照，不能用局内实时抬升后的 `bestScore`，否则破 PB 后会丢失 release 判定。

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

## 四、当前策略详细陈述

> 本节按"数据 → 算法 → 反馈"自下而上展开。所有事实均能追到 `web/src/` 与 `shared/game_rules.json`。

### 3.1 数据基础与持久化

| 字段 | 文件 / 位置 | 物理含义 | 写入时机 |
|------|--------------|-----------|------------|
| `Game.bestScore` | `web/src/game.js` | 玩家账号历史最佳分（跨所有难度档共享） | 局末 if `score > _bestScoreAtRunStart` 写 SQLite（`db.saveScore`） |
| `Game._bestScoreAtRunStart` | `web/src/game.js` | **本局开始时**的 bestScore 快照；防止本局新刷的 PB 触发"自我超越"判定循环 | 每局 `start()` 时拷贝 |
| `Game._newBestCelebrated` | `web/src/game.js` | 本局已触发烟花的开关（一局一次） | `_maybeCelebrateNewBest` 首次命中后置位 |
| `_spawnContext.bestScore` | `web/src/game.js` → `_spawnContext` | 传给 `adaptiveSpawn` 的副本 | 每局开始时一次性灌入 |

**已知边界**：`bestScore` 当前不区分难度档（Easy/Normal/Hard 共用同一字段）；改进项 §4.4 提议分桶。

### 3.2 scoreStress：个人百分位映射（基于 effectivePB）

**入口**：`web/src/difficulty.js → getSpawnStressFromScore(score, { bestScore })`，由 `adaptiveSpawn.resolveAdaptiveStrategy` 调用。

**关键算法**：

```
denom     = deriveEffectivePb(bestScore, dynamicDifficulty)      // ★ 见 §3.2.1 双坐标设计
pct       = score / denom                                         // 「难度进度坐标 r_difficulty」
projected = min(milestonesLast × (1 + percentileMaxOver=0.5), pct × milestonesLast)
stress    = interpolate(milestones [0,45,90,135,180] → spawnStress [0,0.18,0.38,0.58,0.78], projected)
if pct < percentileDecayThreshold=0.5  →  stress *= percentileDecayFactor=0.4
```

**`deriveEffectivePb` 与旧式 `max(bestScore, scoreFloor)` 的关系**：当 `pbProgress` 配置缺失时，`deriveEffectivePb` 自动退化为 `max(bestScore, scoreFloor=180)`，行为完全等价旧版本；启用 `pbProgress` 后才在两端注入下限/压缩，主线 S 曲线本身**完全不动**。详见 §3.2.1。

**策略语义**：

| 段 | 行为 | 设计意图 |
|----|------|------------|
| `bestScore = 0` | 退回旧绝对档位（首次开局） | 新装机玩家用绝对节奏 |
| `pct < 0.5` | stress × 0.4 | **前半程放心冲**，不要让老玩家在低分段就被加压 |
| `0.5 ≤ pct < 1.0` | 直接插值到曲线 | "进入冲刺区"；与 D1/D2 区段对齐 |
| `pct ≥ 1.0` | 按 `percentileMaxOver=0.5` 外推 | **允许突破段比上次 PB 多 50% 内仍可调控难度**，与 `pbOvershootBoost` 协同形成「超 PB 越来越难」的完整曲线 |

**配置位**：`shared/game_rules.json → dynamicDifficulty.{milestones, spawnStress, scoreFloor, percentileDecayThreshold, percentileDecayFactor, percentileMaxOver, pbProgress}`。

### 3.2.1 难度坐标 vs 纪录坐标：双坐标设计（effectivePB）

> **设计动机**：主线难度沿 `r = score / PB` 的 S 曲线展开，但直接用真实 PB 当分母会在两端失真。`pbProgress` 引入 `effectivePB` 解耦「出块难度坐标」与「PB 纪录坐标」，让一条主公式同时优雅服务新手与高手，而不引入分支判断或阈值跳变。

**两个坐标各司其职**：

| 坐标 | 公式 | 服务谁 | 修什么 |
|------|------|--------|--------|
| **`r_difficulty`** | `score / deriveEffectivePb(bestScore)` | `scoreStress` / `spawnHints` / `expertEarlyBoost`（§4.15）/ `spawnStepDifficulty` | **出块难度节奏**。新手抬下限防早熟、高手压上限缩铺垫，两端 corner 一并优雅修。 |
| **`r_record`** | `score / bestScore`（真实 PB） | `derivePbCurve` / `challengeBoost`（§3.4）/ `pbOvershootBoost`（§13.9.1）/ `postPbReleaseWindow`（§4.9）/ `best.gap.*` HUD / `_maybeCelebrateNewBest`（§3.7.3） | **纪录情绪与事件**。高手被难度压缩后不会误触发"快破纪录"叙事，破纪录的稀有性绝对保留。 |

**`deriveEffectivePb` 的单调连续变换**：

```js
function deriveEffectivePb(pb, dd) {
    const pp = dd.pbProgress ?? {};
    const noviceFloor = pp.noviceFloor ?? dd.scoreFloor ?? 180;   // ① 新手抬下限
    let eff = Math.max(pb, noviceFloor);
    if (eff > pp.expertSoftCap) {                                  // ② 高手对数压缩
        eff = pp.expertSoftCap
            + pp.expertScale * Math.log1p((eff - pp.expertSoftCap) / pp.expertScale);
    }
    return eff;
}
```

**当前生产值**（`shared/game_rules.json → dynamicDifficulty.pbProgress`）：

```json
{
  "noviceFloor": 240,
  "expertSoftCap": 1200,
  "expertScale": 600
}
```

**效果矩阵**（以 `r=0.75` 进挑战区为锚点）：

| 玩家画像 | 真实 PB | effectivePB | 进挑战区所需 score | 旧实现下所需 score | 改善 |
|----------|---------|-------------|---------------------|---------------------|------|
| 新手 | 60 | **240** | 180 | 45（早熟） | 不再几十分就被推入挑战区 |
| 普通 | 800 | 800 | 600 | 600 | 完全等价 |
| 中阶 | 1200 | 1200 | 900 | 900 | 完全等价 |
| 高手 | 5000 | **~2400** | ~1800 | 3750（铺垫过长） | 提前 ~52% 进挑战区 |
| 顶尖 | 10000 | **~2850** | ~2138 | 7500 | 提前 ~71% 进挑战区 |

**关键设计性质**（用一条连续变换同时修两端,代替阈值分支）：

- **连续无跳变**：`noviceFloor=240` / `expertSoftCap=1200` 两个分段点都是 C⁰ 连续，PB 从 60 长到 240、从 1200 长到 5000 的过程中，`effectivePB` 不会出现任何跳变。
- **严格单调**：`pb₁ < pb₂ ⇒ eff(pb₁) ≤ eff(pb₂)`，玩家 PB 上涨永远不会让难度反向下降。
- **边际递减**：`d(eff)/d(pb)` 在 `pb > expertSoftCap` 后随 `pb` 增大而减小，越高的高手压缩比越大（避免"PB 越高，前期越无聊"无上界发散）。
- **退化兼容**：移除 `pbProgress` 配置即等价旧 `max(pb, scoreFloor)`，向后完全兼容。

**为什么必须解耦两坐标（不直接覆盖真实 PB）**：

如果直接把"压缩后的 effectivePB"当真实 PB 用，会出现"score 仅 1800、effectivePB 2400 时 `r=0.75` → 触发 best.gap.close → 弹'即将刷新最佳！'"，但玩家明白自己 PB 是 5000、远未接近——叙事撒谎，灾难性认知失谐。所以：

- **难度系统**：吃 `r_difficulty`，让难度按"主观可达感"演进。
- **纪录系统**：吃 `r_record`，让叙事与事件按"客观真实进度"演进。

两套数字独立存在、独立消费、互不污染，是本方案优雅的根因。

**与 `farFromPBBoost`（§13.2）的互补关系**：

| 机制 | 坐标 | 触发条件 | 服务的玩家段 |
|------|------|----------|--------------|
| `farFromPBBoost` | `r_record` | `pct < 0.30` | 所有有 PB 的玩家在 D0 远征段 |
| `expertEarlyBoost`（§4.15） | `r_difficulty` | `bestScore ≥ 1200 ∧ r_difficulty < 0.45` | 仅高手在 effectivePB 定义的早期相位 |

高手在 raw `pct ∈ [0.30, 0.80)` 这段（D1 跟随段），`farFromPBBoost` 已退出而 `challengeBoost` 还没启动，旧实现下是纯"赶路"的无聊真空；`expertEarlyBoost` 用 `r_difficulty` 把"挑战区之前"重新对齐到这段空窗，让分数自然加速跨越。两机制处于同一 `spawnHints` 段（`adaptiveSpawn.js` 同源代码相邻），可并存可单触发。

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

仅在"再来一局"连续路径生效。**v1.68 起**默认走 **`curve='humped'`** 驼峰曲线：

| runStreak | 0 | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---:|---:|---:|---:|---:|---:|---:|
| `stressBonus` | 0 | +0.03 | **+0.05** | **+0.05** | +0.02 | −0.05 | −0.10 |
| `fillDelta` | 0 | +0.01 | +0.02 | +0.02 | +0.01 | −0.01 | −0.03 |

第 2-3 局达峰（黄金挑战窗口），第 5 局后**强制 breather**（与 Candy Crush "easier level after hard" 同源）。
回菜单即重置。旧 `linear` 曲线（`maxStreak=6` × `fillBonusPerGame=0.01` + `spawnStressBonusPerGame=0.045`）
作为 fallback 保留，由 `runDifficulty.curve` 字段切换。

#### 3.7.5 `runOverRunArc`（v1.68 局间难度弧线）

新增"今日第几局/距离上次休息多久"维度，派生五档 arc：

| arc | 触发 | 调制 |
|---|---|---|
| `opener` | 今日首局 或 空闲 ≥30min | lifecycle cap ×0.85，D 曲线封顶 0.9 |
| `momentum` | 今日第 2-3 局 | 无调制（基线） |
| `peak` | 今日第 4-5 局 | 无调制（基线） |
| `fatigue` | 今日 ≥6 局 或 连续 3 局 score < 0.6·PB | lifecycle cap ×0.80, adjust −0.10；D 曲线 brake 段右移 0.15 |
| `cooldown` | 60s 内崩盘重开链 ≥2（赌气保护） | lifecycle cap ×0.70, adjust −0.15；D 曲线 brake 段右移 0.20 |

完整设计见 [`ALGORITHMS_SPAWN.md §十六`](../algorithms/ALGORITHMS_SPAWN.md#十六局间难度ror)。  
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

## 五、改进与优化点（编号 + 优先级 + 落地难度）

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

### 4.14 effectivePB 难度进度坐标：新手早熟 + 高手长铺垫的同时修复（P0）

**问题**：S 曲线 `r = score / PB` 是主线难度公式，但直接用真实 PB 当分母在两端失真——

- **新手 corner**：PB 很低（30~80），`r` 增长过快，几十分就被推入挑战区 → 早熟挫败、失去兴趣。  
  早期"`scoreFloor=180` 兜底"虽缓解了新手早熟，但只是单端修复，且与"挑战区起点"挂钩不清晰；
- **高手 corner**：PB 很高（数千），`r` 长期贴近 0，前期需漫长铺垫才进挑战区 → 前期无趣放弃。  
  旧实现下 PB=5000 玩家要打到 3750 分才进 `r=0.75` 挑战区，过程中几乎无 PB 段调控介入。

**改进**（已落地）：

1. ✅ `web/src/difficulty.js` 新增 `deriveEffectivePb(pb, dd)`：用**同一条单调连续变换**同时修两端（设计与性质详见 §3.2.1）：

   ```js
   eff = max(pb, noviceFloor)                                       // 新手抬下限
   if (eff > expertSoftCap) {                                       // 高手对数压缩
       eff = expertSoftCap + expertScale * ln(1 + (eff - expertSoftCap) / expertScale);
   }
   ```

2. ✅ `getSpawnStressFromScore` 的分母从 `max(personalBest, scoreFloor)` 改为 `deriveEffectivePb(personalBest, dd)`；其余流程（百分位、衰减、外推）保持不变。

3. ✅ `shared/game_rules.json → dynamicDifficulty.pbProgress` 配置化：`noviceFloor=240 / expertSoftCap=1200 / expertScale=600`。**移除配置即自动退化为旧 `max(personalBest, scoreFloor)` 行为**，完全向后兼容。

4. ✅ **纪录线不动**：`derivePbCurve` / `challengeBoost` / `pbOvershootBoost` / `postPbReleaseWindow` / `best.gap.*` / `_maybeCelebrateNewBest` 全部仍用真实 PB，叙事与事件不受难度坐标压缩影响。详见 §3.2.1 双坐标解耦说明。

5. ✅ 各端同源：通过 `npm run sync:core` 同步到 `cocos/assets/scripts/engine/difficulty.mjs` 与 `miniprogram/core/difficulty.js`。

**风险与护栏**：

- **救济优先级不变**：`effectivePB` 只改 `scoreStress` 基础输入，frustration / recovery / nearMiss / 临满盘面的减压信号仍在其后叠加并能压过它。压缩绝不能 bypass relief。
- **PB 噪声**：新手 PB 可能是一局走运打出来的。当前仅用常数 `noviceFloor`；后续可演进为 `max(noviceFloor, 近 N 局得分中位数)` 之类的稳健估计，避免一次手气把难度永久抬高。
- **看板监控**：`stressBreakdown` 中可读 `scoreStress` 实际值，看板增加 `effectivePB / r_difficulty / r_record` 三字段曲线，验证"新手不再早熟、高手铺垫缩短"。

**单测**：`tests/difficulty.test.js → describe('deriveEffectivePb …')` 8 条覆盖：

- 新手抬 `noviceFloor` 下限
- 中档原样透传
- 高手对数软压缩（`effectivePB < 真实 PB`）
- 单调非减且连续（`expertSoftCap` 邻域差值 < 2）
- 压缩边际递减（`r(10000) < r(5000)`）
- 配置缺失退化兼容
- corner 修复实证：高手 score=1800/PB=5000 进入挑战爬坡、新手 score=120/PB=60 不被推入高压

### 4.15 expertEarlyBoost：高手早期"得分机会"加速（P0）

**问题**：§4.14 的 `effectivePB` 在「难度坐标」上让高手更快进入挑战区，但要让"分数是玩家真打出来的"——光压缩坐标不够，前期盘面也需要主动产出更多多消/清屏/续 combo 机会，使真实 score 上升更快、更早穿过铺垫区。

否则高手会感受到"难度系统认识我了（节奏紧凑），但盘面机会没变"，仍需打 raw 30%~80% 这段"赶路"过程。

**改进**（已落地）：

1. ✅ `web/src/adaptiveSpawn.js` 紧接 `farFromPBBoost` 之后注入 `expertEarlyBoost` 段，仅对**高手早期**触发：

   ```js
   const effPb = deriveEffectivePb(ctx.bestScore, GAME_RULES.dynamicDifficulty);
   const rDifficulty = score / effPb;
   if (ctx.bestScore >= expertThreshold && rDifficulty < earlyRampUntil) {
       // 抬高得分机会 floor / boost
       multiClearBonus  = max(multiClearBonus,  multiClearBonusFloor=0.5);
       perfectClearBoost = max(perfectClearBoost, perfectClearBoostFloor=0.5);
       clearGuarantee   = min(3, clearGuarantee + clearGuaranteeBoost=1);
   }
   ```

2. ✅ **救济优先 bypass 链**（6 路，与 `farFromPBBoost` 同样守护）：

   ```
   not_expert / past_early_phase / warmup / recovery / near_miss / post_pb_release
   ```

   `stressBreakdown.expertEarlyBoostActive` + `expertEarlyBoostBypass` 持久化，DFV / 单测可见。

3. ✅ `shared/game_rules.json → adaptiveSpawn.pbChase.expertEarlyBoost` 配置化：

   ```json
   {
     "enabled": true,
     "expertThreshold": 1200,
     "earlyRampUntil": 0.45,
     "multiClearBonusFloor": 0.5,
     "perfectClearBoostFloor": 0.5,
     "clearGuaranteeBoost": 1
   }
   ```

   `expertThreshold` 与 `dynamicDifficulty.pbProgress.expertSoftCap` 同值对齐——压缩从哪开始，加速也从哪开始。

4. ✅ **与 `farFromPBBoost` 互补、非替代**：详细对比见 §3.2.1 末尾矩阵。简言之：

   - `farFromPBBoost`：按 raw `pct=score/bestScore<0.30` 对**所有**有 PB 的玩家送爽；高 PB 玩家在 raw 30%~挑战区之间会失去该加成。
   - `expertEarlyBoost`：仅对 `bestScore≥1200` 高手，按 `r_difficulty<0.45` 触发；正好覆盖前者顾不到的 raw 30%~挑战区真空。

5. ✅ **形成"warmup 友好 → expertEarly 送爽 → 挑战区"的平滑接力**：warmup 段（`totalRounds≤3`）本就有专属友好化（`clearGuarantee+2` 等），让位给 warmup；前 3 轮过后 expertEarlyBoost 接力，直到 `r_difficulty≥0.45` 退出。

6. ✅ 各端同源：通过 `npm run sync:core` 同步到 cocos / miniprogram。

6.5 ✅ **与 §4.16 `earlyOvershootGuard`（PEOG）的优先级约定**：当玩家同时落入「高手早期」与「中高 PB 段开局」两个切片时，**PEOG cap 优先于本节 floor**——

```js
// adaptiveSpawn.js 应用顺序（伪代码）：
applyFarFromPBBoost();              // 远征送爽
applyExpertEarlyBoost();            // 高手早期送爽（写入 floor=0.5）
// ...
return applyWarmRun(out, ctx);      // 温暖局钳制
// ↓ ↓ ↓ 由 spawn/peog.js applyPeogSpawnHintsCap 在 warmRun 之后收紧：
applyPeogSpawnHintsCap();           // multiClearBonus = min(floor=0.5, cap=0.45) = 0.45
```

PEOG bypass 12 路任一触发（详见 §4.16）时本节 floor 自动恢复完整效果。设计层语义：PEOG 是更窄切片的更强约束，子集 override 父集是合理的；本机制保证「高手早期送爽」对中高 PB 玩家仍生效（只是更克制），既不破坏 §4.15 设计本意，也不让 §4.16 守卫被绕过。

**单测**：`tests/peog.test.js → 'applyPeogSpawnHintsCap … expertEarlyBoost'` 覆盖：
- PEOG active 时 multiClearBonus = min(expertEarlyBoost floor=0.5, PEOG cap=0.45) = 0.45；
- PEOG bypass='recovery' 时直接透传输入（expertEarlyBoost floor 完整恢复）。

**关键差异**（与现有 spawnHints 加成的语义边界）：

| 机制 | 性质 | 触发 |
|------|------|------|
| `postPbRelease`（§4.9） | **奖励性减压**：刚破 PB | `postPbReleaseActive=true` |
| `recovery / nearMiss` | **救济性减压**：玩家陷入困境 | `needsRecovery / hadRecentNearMiss` |
| `farFromPBBoost`（§13.2） | **送爽性减压**：D0 远征段所有玩家 | `raw pct<0.30` |
| `expertEarlyBoost`（§4.15） | **加速性送爽**：高手早期 | `bestScore≥1200 ∧ r_difficulty<0.45` |
| `earlyOvershootGuard`（§4.16） | **保护性压制**：中高 PB 段开局守卫 | `bestScore≥1200 ∧ spawnsUsed<8 ∧ pct<0.85` |

**单测**：`tests/adaptiveSpawn.test.js → expertEarlyBoost ===` 4 条覆盖：

- 高手早期触发（`expertEarlyBoostActive=true`、`multiClearBonus≥0.5`、`perfectClearBoost≥0.5`）
- 低 PB 玩家 bypass=`not_expert`
- 高手已过早期相位 bypass=`past_early_phase`
- warmup 段 bypass=`warmup`

### 4.16 PEOG（PB 早期超越守卫）：中高分段开局生命透支防护（P0）

**问题**：PB ≥ 1200 的中高分段玩家在以下叠加路径上会经历"开局生命透支"——

1. 温暖局命中 T3/T4/T5（连挫 / 流失高危 / 跨局连挫），整段释放大块 / multiClear / perfectClear；
2. 构造算法 `findMultiClearCompleter` / `findPerfectClearTriplet` / `findLargeBlockCompleter` 不感知 PB 距离，候选命中率高；
3. `expertEarlyBoost`（§4.15）在 `r_difficulty < 0.45` 时把 multiClearBonus / perfectClearBoost 抬到 ≥ 0.5；
4. 三者同帧叠加 → 高手在前 6 个 spawn 内可累计 ≥ PB 的分数（典型 PB=1500，一次 PerfectClearTriplet 估算 yield≈ 12800 ≫ PB×8）；
5. 早早进入 D4（pct > 1.02）→ `_maybeCelebrateNewBest` 在 P0/P1 warmup 段触发，烟花/release BGM/HUD victory 提前消费；
6. 紧接 `pbOvershootBoost + orderRigor` 把 stress 推到 0.85+，剩余 80% 时间高压硬挺，崩盘后玩家本局成就感与生理状态双重透支。

这违反 §1.1「PB 增长节奏 = 上次 PB × {1.05–1.30}」与 §3.7.3「新纪录庆祝稀有性」两条契约。

**改进**（已落地）：

1. ✅ `web/src/spawn/peog.js` 新增 PEOG 模块：`buildPeogState` / `evaluatePeogActive` / `consumePeogOnPlace` / `applyPeogSpawnHintsCap` / `applyPeogYieldCap` / `estimateConstructiveYield`；
2. ✅ 工具：构造算子候选的 `estimateConstructiveYield`（与 `CLEAR_SCORING.md` `baseScore = baseUnit × c²` 公式同源）+ 单帧 `maxYieldPerSpawnRatio` cap；
3. ✅ **强度二档**（cap 语义见下「v-research §改进」——已由逐帧限速改为累计预算，下列比率现为**单帧下限**）：
   - `peog_mild`（默认）：单帧下限 = PB × 0.16；`spawnHints.multiClearBonus ≤ 0.60 / perfectClearBoost ≤ 0.35 / sizePreference ≤ 0.60 / iconBonusTarget ≥ 0.55`（机会面 cap 仅在临近 ceiling 才施加）；保留 perfectClearTriplet 但 yield 受累计预算约束；
   - `peog_strong`：单帧下限 = PB × 0.10；`spawnHints.perfectClearBoost ≤ 0.15`、`perfectClearAllowed=false`；连续 3 次 pct 触达 `0.85 × 0.95 = 0.8075` 时自动升级（不可降级）；
4. ✅ **温暖局协同**：`pickWarmTarget` 在 PEOG active 时映射 `PERFECT_CLEAR → MULTI_CLEAR_NOW` 与 `MULTI_CLEAR_NOW → SETUP_FOR_MULTI`；`buildWarmBudget` 在 `peogIntensity` 注入时改写 `guaranteedDelights` 为 `{multiClear:1, monoFlush:2, perfectClear:0}`（mild）或 `{multiClear:1, monoFlush:1, perfectClear:0}`（strong）；
5. ✅ **不动**真实 PB / 计分公式 / `_maybeCelebrateNewBest` / `bestScore.gap.*` 叙事——仅改"机会面"（spawnHints + 构造算子候选过滤）；
6. ✅ **12 路 bypass 优先级链**（与 §4.2 `challengeBoostBypass` / §4.15 同纪律）：

   | # | reason | 判定阶段 | 含义 |
   |---|--------|----------|------|
   | 1 | `disabled` | buildPeogState | 配置 `enabled=false` |
   | 2 | `rollout_out` | buildPeogState | 灰度未命中 |
   | 3 | `low_pb` | buildPeogState | `bestScoreAtRunStart < midHighFloor` |
   | 4 | `t1_newbie` | buildPeogState | 温暖局 T1 触发（兜底，PB 本就低不应命中） |
   | 5 | `winback_first_run` | buildPeogState | 温暖局 T2 + `runsAfterReturn=0`（让回流玩家找回手感） |
   | 6 | `manual_remote_force` | buildPeogState | 温暖局 T7 远端强制 |
   | 7 | `recovery` | evaluatePeogActive | `profile.needsRecovery=true` |
   | 8 | `near_miss` | evaluatePeogActive | `ctx.hadRecentNearMiss=true` |
   | 9 | `bottleneck` | evaluatePeogActive | `ctx.hasBottleneckSignal=true` |
   | 10 | `post_pb_release` | evaluatePeogActive | §4.9 释放窗口 |
   | 11 | `late_phase` | evaluatePeogActive | `spawnsUsed ≥ guardSpawns(8)` 自然到期 |
   | 12 | `approach_handoff` | evaluatePeogActive | `pct ≥ pbApproachCeiling(0.85)` 交棒 challengeBoost |

   bypass 是**单调永久的**——一旦触发整局不再恢复 active，避免"recovery 解除 → PEOG 又把分压回去"的反复折腾。
7. ✅ **与 §4.15 `expertEarlyBoost` 冲突解决**：详见 §4.15 §6.5 patch。结论：PEOG cap 优先（`min(floor, cap)`），bypass 时 expertEarlyBoost floor 完整恢复。
8. ✅ **配置位**：`shared/game_rules.json → adaptiveSpawn.pbChase.earlyOvershootGuard`：
   ```json
   {
     "enabled": true,
     "rolloutPercent": 100,
     "midHighFloor": 1200,
     "pbApproachCeiling": 0.85,
     "earlyOvershootGuardSpawns": 8,
     "escalateAfterApproachCount": 3,
     "hintsCapHeadroomRatio": 0.25,
     "intensities": {
       "peog_mild":   { "maxYieldPerSpawnRatio": 0.16, ... },
       "peog_strong": { "maxYieldPerSpawnRatio": 0.10, "perfectClearAllowed": false, ... }
     }
   }
   ```
   `midHighFloor` 与 `dynamicDifficulty.pbProgress.expertSoftCap` 同值对齐——压缩从哪开始，守卫也从哪开始。

> **v-research §改进（恢复高 PB 局初得分率）**：旧版 PEOG 是「逐帧限速」（单帧 yield ≤ PB×0.08 恒成立），上线后实测**高 PB 局初得分率被钉死、爆块（多消/清屏/大块）几乎被抽干 → 冲 PB 过慢、前期兴趣下降**。改进后：
> - `applyPeogYieldCap` 单帧 cap = `max(PB×maxYieldPerSpawnRatio[下限], PB×pbApproachCeiling − consumedYield[剩余额度])`——局初 `remaining` 充裕 → 爆点照常放行，仅累计逼近 ceiling 才收紧到下限；
> - `applyPeogSpawnHintsCap` 改为「仅当 `remaining < PB×hintsCapHeadroomRatio`(0.25) 即临近 ceiling 才封顶机会面」，否则透传 `multiClearBonus/perfectClearBoost/sizePreference`；
> - 各 `spawnHints` cap 与 `maxYieldPerSpawnRatio` 同步放宽（见上）；
> - 守卫的硬下线仍由 `approach_handoff(pct≥ceiling)` 兜底，故累计预算不会越权推过纪录线。
> 语义：PEOG 回归其**唯一职责——「防开局提前破纪录」**，不再承担「压制得分率」。回归 `tests/peog.test.js`(47) 全绿。
9. ✅ **可观测**：`stressBreakdown.peogActive / peogIntensity / peogBypass`（DFV 面板 / 单测可见）；MonetizationBus emit `lifecycle:peog_engaged`（守卫激活时）+ `lifecycle:peog_overshoot_prevented`（late_phase / approach_handoff 自然到期且全程守住 ceiling 时，每局一次）；
10. ✅ **跨端同源**：`bash scripts/sync-core.sh` 同步到 `miniprogram/core/spawn/peog.js` + `cocos/assets/scripts/engine/spawn/peog.mjs`。

**看板指标**（接入 §七）：

- 中高 PB 段早期超越率（**目标 < 5%/局**，基线测算 ~20%）；
- 中高 PB 段 `_maybeCelebrateNewBest` 触发时机 P50（**目标 ≥ session 总长 × 0.55**）；
- 中高 PB 段 D4 累计停留占比（**目标 ≤ 30%**）；
- `lifecycle:peog_overshoot_prevented` / `lifecycle:new_personal_best` 比值（**应 ≤ 5**，过高说明守卫挡掉了太多破纪录）；
- PEOG bypass 分布（recovery+nearMiss+bottleneck 合计 **< 15%**，避免误伤救济）。

**回归红线**（任一触发即回滚到上一灰度阶）：

- 中高 PB 段人均时长下降 > 3%；
- 中高 PB 段单局得分下降 > 8%（机会被压得太狠）；
- overshoot_prevented:new_pb > 5（守卫过头）。

**单测**：`tests/peog.test.js` 47 条覆盖 12 路 bypass + 升级单向性 + yield 估算（5 种算子）+ **累计预算（局初放行 / 临近 ceiling 收紧 / 降级）** + spawnHints headroom 门控 + warm target 映射 + guaranteedDelights override + 跨端镜像同源（mini）；`tests/warmRun.test.js` 30 条无回归；`tests/adaptiveSpawn.test.js` 90 条无回归。

### 4.17 难度相对论：体感难度不变量 × 客观难度个性化（S 曲线主线下的 θ⃗ × b⃗ × EDPCG）（P-research，✅ 已落地·默认开 rollout 100%）

> **状态**：核心闭环（θ⃗ 标定器 → b⃗ 投影 → b* 反解 → 等体感选块 → 阶段5 形状先验 → 跨局持久化激活链）**已实现并默认启用**（`adaptiveSpawn.difficultyRelativity.enabled=true` / `rolloutPercent=100`），通过单元 + 全量回归 + 跨端同源校验；`enabled=false` 时全链路恒等（行为=现状）。本节是**策划契约**；**算法侧实现清单 + 落地状态表 + 验证清单见 [`ALGORITHMS_SPAWN.md §2.10`](../algorithms/ALGORITHMS_SPAWN.md)**。另在 [`ALGORITHMS_PLAYER_MODEL.md §16.2`](../algorithms/ALGORITHMS_PLAYER_MODEL.md) 与 [`DOMAIN_KNOWLEDGE.md §13`](../domain/DOMAIN_KNOWLEDGE.md) 留有交叉引用。
>
> ⚠️ **v-research §改进（恢复体感波动性/爽感）**：默认启用后实测「**难度被钉在线上、爽块被等体感对齐确定性剔除、波动性与趣味下降**」。根因：等体感选块用**确定性 argmax** 取对齐度最高（=最贴 b\*）者，把高 combo/perfectClear 爆点（`align` 最低）系统性剔除。已修复为 **softmax 采样 + 爽点预算**，并把个性化强度/对齐锐度降为「温和偏置」：
> - 选块：`burstReleaseProb`(0.2) 概率放行最偏离 b\* 的爆点 + 否则 `softmax(align/alignTemperature(0.15))` 采样（有 `ctx.rng` 时；无则退回 argmax）；
> - 锐度：`alignmentMultiplier` 的 `sharpness` 由 3 → 可配 `alignSharpness`(2.0)；
> - 参数：`personalizationStrength` 0.3→0.18、`weaknessBoost` 1.5→1.15、`candidateK` 4→3、`shapePrior.strength/cap` 0.6/0.30→0.4/0.20。
> 详见 [`ALGORITHMS_SPAWN.md §2.10`「选块软化」](../algorithms/ALGORITHMS_SPAWN.md)。后续观测切片（面板 θ⃗ 展示、透视仪、RL state 落 b⃗）仍待。
>
> **核心设定（不可动摇的前提）**：**难度 + S 形 stress 曲线仍是游戏调控主线**。本方案不替换、不旁路 S 曲线；它精确化 S 曲线控制的语义为「**目标体感难度**」，并在「体感 → 客观题目」之间插入一层**按玩家能力个性化的标定**——因为「难」是相对能力的主观量。

**问题（缺陷的精确定位）**：当前难度引擎是**维度坍缩 + 锚点单一**的——

```
r = score / deriveEffectivePb(bestScore)                 # 难度坐标（单标量）
stress = interpolate(milestones → spawnStress, r)         # 全局同一条 S 曲线
shapeWeights = interpolateProfileWeights(profiles, stress) # 内容 = stress 的查表（adaptiveSpawn.js L2254）
spawnHints   = f(stress)                                   # clearGuarantee / multiClearBonus / orderRigor ...
```

| 层面 | 现状 | 缺陷 |
|------|------|------|
| **锚点** | 难度沿 `score/PB` 展开，PB 是唯一长期锚 | PB 是**滞后、单标量、含运气噪声**的代理，混淆"打多远（毅力/运气）"与"有多强（技能）"。`effectivePB` 只在 x 轴重映射（新手抬底 / 高手压顶），锚点仍是 PB |
| **难度** | 所有信号融合成**一个标量 `stress`** | S 曲线形状对**所有人完全相同**；`LIFECYCLE_STRESS_CAP_MAP` 只裁顶部、生命周期只 ±0.15 加性微调——**不改变挑战的种类** |
| **题目** | 内容（shapeWeights / spawnHints）是 `stress` 的函数 | 同一 `stress` 下所有玩家拿到**同类盘面压力**。`shapeCompetence` / `topologyForm.weakness` 已采集，却只走离线展示或 ±5~10% 的有界"风味偏置"（`applySpawnPrior`），**不驱动题目种类** |

**一句话**：系统对玩家"测量得丰富（AbilityVector 6 维 + playerAnalytics），执行时却压成 1 个标量"。新手与资深的差异仅体现在"同一轨道上爬多高 / 多快 / 封顶多少"，而**不体现在题目本身的结构 / 考点**——即"无论新手资深面对同样的难度-PB 关系、题目某种程度上一致"。

**领域研究映射**：

| 研究 / 框架 | 核心思想 | 启示 |
|-------------|----------|------|
| **EDPCG**（Yannakakis & Togelius, 2011） | 内容生成由"玩家体验计算模型"驱动，对候选内容按"它在该玩家身上引发的体验"打分再搜索 | 把 spawn 从"`stress`→查表"升级为"**对候选盘面 / 出块按 per-player 目标体验打分**"；现有 5 阶段流水线 + 30+ 乘子即天然候选评估器 |
| **IRT / Elo / Glicko / TrueSkill 用于单人**（CAT、关卡匹配；NSF 2020、Antal 2013） | 把"能力 θ"与"题目难度 b"放同一标度，按 logistic(θ−b) 预测成败、按结果**同时更新 θ 与 b**，选题让成败概率≈目标（Desired Loss Rate） | **与 PB 解耦的关键**：把"题目 / 局"当对手，维护带不确定度的潜在能力 θ⃗。仓库旧判断"Elo 不适合单人"在 CAT / 关卡匹配语境下被推翻 |
| **多维 DDA + ZPD**（Legends of Hoa'Manu, EPFL/UNIGE 2024） | **同时独立调多个参数**保持各自最近发展区；**概率扰动**避免可预测、促进技能迁移 | 用多维难度向量取代单 `stress`；每维各自目标 + 受控随机性 |
| **PCG-GBA + 玩家建模**（IJSG 2025） | 难度由玩家能力而非纯技术参数决定，按技能分量对齐题目 | 题目对齐**具体能力短板**（空间 / 连消 / 高压恢复 / 顺序刚性） |
| **课程学习**（Bengio 2009） | 由易到难、定向训练薄弱项 | 个性化"训练弱项 + 巩固强项"课程编排 |

**升级核心设定：S 曲线仍是主线，"难"是相对能力的主观量**（本节相对初版方案的关键修正）：

- **主线不变**：`milestones → spawnStress` 的曲线形状、由 `score/PB`（及全部生命周期 / PEOG / challengeBoost 调制）决定"玩家此刻应处于曲线哪个位置"——**这一整套全部保留**。变化只是把 S 曲线控制的语义**精确化为「目标体感难度」（perceived difficulty / 心流位置）**，而非客观题目难度。
- **关键洞察**：**"难"是相对玩家能力的主观量**。同一客观盘面（客观难度 `b`）对低能力玩家体感"难"、对高能力玩家体感"易"。形式化（与 IRT / 心流同构，且仓库 `F(t)=|boardPressure/skill−1|` 已是雏形）：

  ```
  d_perceived ≈ b ⊖ θ          # 体感难度 = 客观难度 − 能力（按考点维度）
  ```

- **升级 = 在「主线」与「内容」之间插入"个性化体感↔客观标定"**：S 曲线给出目标体感 `d* = stress`；按玩家能力 θ⃗ **反解客观目标** `b* = θ⃗ ⊕ d*`；内容侧选块让候选客观难度 `b(candidate) ≈ b*`。

  > 结果：**同一条 S 曲线、同一个 stress 目标**，对资深玩家落到**客观更难**、对新手落到**客观更易**的题目，使两者**体感难度一致（心流一致）**、但**客观题目结构千人千面**——既守住"S 曲线是主线"，又解决"题目同质"。

- **θ⃗ 的角色被重定位**：θ⃗ **不取代 PB 作锚点**（PB 仍驱动 stress 主线），而是"**体感↔客观难度的个性化标定器**"。现有 `effectivePB`（按 PB 档位在 x 轴粗粒度重映射）正是这一标定的**一维、PB 代理版前身**；升级即把它**多维化（按考点维 θ_d）+ 能力化（弃用 PB 当技能代理）**。低置信 θ⃗ → 退化为恒等标定 → 完全等于当前行为。

**改进方向（五支柱）**：

1. **支柱① 体感标定器 θ⃗（多维能力，作映射、不作锚点）**：复用 `AbilityVector` 6 维与 `playerAnalytics` 稳健估计作为观测，其上加 TrueSkill/Glicko 风格后验 `θ_d ~ N(μ_d, σ_d²)`；每局/每里程碑段作一次"答题"，用本局客观 `spawnStepDifficulty` 作题目难度 `b`、用"该难度下预期消行/存活是否达成"作成败信号更新 μ/σ。**θ⃗ 只吃行为质量与盘面应对，不吃绝对分数**——"耐心刷高 PB 的新手"与"3 局高 PB 的天才"得到不同 θ⃗（`effectivePB` 做不到）。**θ⃗ 仅用于反解 `b*=θ⃗⊕stress`、不改 stress 主线**；σ_d 门控标定强度，低置信 → 恒等标定（即当前 `effectivePB` 行为）。
2. **支柱② 客观题目难度向量 b⃗**：把 `spawnStepDifficulty` 的标量/4 维子向量扩展为显式考点向量 `{b_spatial, b_combo, b_order, b_recovery, b_tempo, b_clearEff}`，作为"客观难度"的量尺；它同时是 θ⃗ 贝叶斯更新的"答题难度"输入，构成 IRT 闭环。
3. **支柱③ 等体感选块（EDPCG 候选评估）**：S 曲线产出目标体感 `d* = stress` → 反解客观目标 `b* = clamp(θ⃗ ⊕ d* + Δ⃗)` → spawn 候选打分新增对齐项 `score += −w·‖difficultyVec(候选) − b*‖`（弱项维度加大 w）。语义即"**在等体感前提下，给不同能力玩家不同客观难度 / 不同考点结构的题目**"。**沿用现有可解性/公平护栏（DFS 存活验证）**；救济 / PEOG / warmup 永远 bypass 目标项。
4. **支柱④ 个性化课程 + ZPD + 概率扰动**：`Δ⃗` 在最弱维（对齐 `topologyForm.weakness`）给正向增量、在疲劳/高挫败维给负增量；`b*` 叠加受控噪声，防可预测 / 防策略溢出（针对 E 类瓶颈、C 类前 50 局波动）。注意 `Δ⃗` 作用在**客观目标 `b*`**、不抬高目标体感 `d*`——体感仍由 S 曲线主线锁定。
5. **支柱⑤ 玩家原型/段位的"题目结构"差异化**：在等体感约束下，把 `b*` 的**考点形状**按 archetype 差异化（新手低 `b_order`+ 高 `b_clearEff`；资深高 `b_order`+ 高 `b_recovery`；aggressive 高 `b_combo` 窗口）；把现有 `playstyleNudge` 的 ±5~10% 升级为"客观目标向量的结构偏置"。

**与现有系统衔接（增量而非推倒）**：

| 现有机制 | 处置 |
|----------|------|
| `score/PB` 主线 + `getSpawnStressFromScore` + S 曲线 | **完全保留，仍是调控主线**：决定目标体感 `d*=stress`（曲线位置 / 形状 / 全部调制不变） |
| 双坐标（r_difficulty / r_record，§3.2.1） | **stress 曲线本身不动**；体感↔客观标定只作用在 r_difficulty 的"客观难度落地"环节（内容侧选块）；**r_record（纪录线 / 庆祝 / PEOG / best.gap）完全不动**（保叙事零回归） |
| `deriveEffectivePb`（§4.14） | **它就是本标定的一维、PB 代理版前身**——升级是把它多维化（按考点维 θ_d）+ 能力化（弃用 PB 当技能代理），而非废弃；θ⃗ 恒等时退化为其特例 |
| `LIFECYCLE_STRESS_CAP_MAP` / 救济链 / PEOG / warmup | **全部保留，且优先级高于目标项**（个性化不得绕过安全/公平护栏） |
| `playerAnalytics.spawnAdvice`（shapeCompetence / topologyForm.weakness / comfortFillBand） | **从展示 / 有界 nudge 升级为 Δ⃗/T⃗ 一等输入**（文档已标注此为"增量最高的空白区"） |
| `spawnStepDifficulty` + `SpawnTransformerV2` | **复用为 b⃗ 与离线校准 / 难度预测器**（IRT 的题目难度一半已就绪） |
| `move_sequences` 6000+ 局回放 | **离线校准 θ⃗/b⃗ 标度与分位锚点** |

**落地路线（分阶段灰度）**：

| 阶段 | 内容 | 灰度 / 风险 |
|------|------|-------------|
| **0 影子离线** | 用 `move_sequences` 跑 TrueSkill triplet（玩家×题目难度×结果），验证 θ⃗ 对未来 N 局表现的 Spearman 相关**优于 PB / skillLevel**；标定 b⃗ 分位锚点 | 纯离线，0 线上风险 |
| **1 影子推断** | 线上**计算但不消费** θ⃗/b⃗/T⃗，写 `stressBreakdown` 与回放帧，看板对比 | Feature flag 关执行 |
| **2 内容侧灰度** | 仅高置信 θ⃗ 玩家启用等体感选块对齐项（`b*=θ⃗⊕stress`），强度受 `personalizationStrength` 上限约束；救济/PEOG/warmup 全 bypass | `rolloutPercent` 逐步放量 |
| **3 标定升级** | 把 `effectivePB` 的一维 PB 档位体感标定，升级为 θ⃗ 多维能力标定（**S 曲线 / stress 主线不变，PB 仍驱动曲线位置与纪录线**） | A/B 验证后切换，保留一键回退 |

**看板指标**：θ⃗ vs PB/skillLevel 对未来表现的预测相关性（θ⃗ 应更高）；**等体感约束下客观目标 `b*` 是否随 θ⃗ 单调上移（资深更难、新手更易）**；按 θ⃗ 分层的心流命中率与客观难度匹配误差 `‖b⃗−b*‖`（应下降）；弱项维度成长斜率（定向训练是否生效）；新手早熟率 / 高手铺垫时长（应不劣于 effectivePB）；救济/PEOG bypass 占比（避免误伤）。

**回归红线（任一触发即回滚灰度阶）**：人均时长下降 > 3%；心流偏离方差上升；破纪录率偏离健康区间；救济 bypass 误伤 > 15%。

**风险与护栏**：① 冷启动/低置信必须降级回 `score/PB`，σ_d 门控个性化强度；② 目标项**永远在硬约束（DFS 可解）与救济链之后**，不得制造死局或绕过救济；③ 个性化**只动机会面（spawnHints/候选），绝不动纪录线**（避免叙事撒谎，沿用双坐标设计动机）；④ 所有新量（θ⃗/b⃗/T⃗/Δ⃗）落 `stressBreakdown` 与回放帧，接 profileAudit 契约做回归卡口；⑤ 受控随机性 + `personalizationStrength` 上限，防过度个性化 / 策略溢出。

**研究参考**：Yannakakis & Togelius (2011) *Experience-Driven PCG*；Togelius et al. (2011) *Search-Based PCG*；Pasqualotto et al. (2024) *Multidimensional DDA / Legends of Hoa'Manu*（EPFL/UNIGE）；Antal (2013) *Elo Rating for Adaptive Assessment*；IJSG (2025) *Adaptive Puzzle-Level Generation for GBA*；Bengio et al. (2009) *Curriculum Learning*。

#### §4.17.x 系统性优化 O1–O5（v1.68，✅ 已落地）

> 📍 **修复目标**：commit `8ff29f4f` 首版相对论上线后 4 类体感回退——新手出块碎/高 PB 早期得分慢/构造式爽消被对齐评分挑掉/温暖局策略被覆盖。**O1–O5 不是开关**，是相对论与既有相位/状态机的架构级耦合软化。

| 编号 | 名称 | 解决问题 | 关键改动 | 配置位 |
|---|---|---|---|---|
| **O1** | 相位化对齐预算 `relativityIntent` | 顺玩家相位（harvest/warmup/pb_chase）被对齐评分挑掉爽消 | 4 档分级：`off / prior_only / kbest_only / full`。bypass + recovery/onboarding/bottleneck/near_miss → off；harvest/warm/warmup/pb_chase/release → prior_only；其它 full | `difficultyRelativity.js :: resolveRelativityIntent` |
| **O2** | 相位化几何信号增益 `phaseGeomGain` | 新手/温暖局期 1 个 close1 就把 ability riskLevel 拉高、形状漂向 t/z | onboarding=0.3 / warmRun=0.5 / 默认 1.0。仅衰减负向项（holePenalty/nearClearScore/lockRiskScore），正向 spatialPlanning 不变 | `game_rules.json :: adaptiveSpawn.phaseGeomGain` |
| **O3** | PEOG bottleneck/near_miss 延迟让位 | 瞬时几何谷值打断 PB 加压窗口 | `_bottleneckHits / _nearMissHits` 累计，连续 ≥ 阈值（默认 2）才 `_bypassNow`；信号消失立即归零 | `pbChase.earlyOvershootGuard.{bottleneckYieldHits, nearMissYieldHits}` |
| **O4** | `difficultyVec` 真实化 | 6 维客观难度被旧 5 项 term 平均，clearEff/recovery/combo 与玩家爽点 / 回收能力错位 | 新增 `clearPotential / cleanPath / permVariance`（由 `solutionMetrics` 派生），`projectDifficultyVector` 缺省 term 自动从加权和剔除（向后兼容） | `spawnStepDifficulty.vectorWeights` + `difficultyRelativity.shapePrior.dimAffinity` |
| **O5** | b\* 早期上界 `earlyPhaseBStarCap` | 高 PB 玩家局初被高 θ 拉到客观偏难，得分慢、进不去 PB 调整状态 | 低 d\* 阶段（< `earlyPhaseDStar=0.40`）把任一维 b\* 钳制在 `d + earlyPhaseBStarCap=0.10` 以内；中后段自动让位 | `adaptiveSpawn.difficultyRelativity.{earlyPhaseDStar, earlyPhaseBStarCap}` |

**优先级（同帧多生效时的语义层级，由高到低）**：
1. 硬约束/救济链（不变，**始终最高**）；
2. O3 PEOG 延迟让位（达到累计阈值时直接 bypass 相对论）；
3. O5 b\* 早期上界（在 b\* 公式内钳制）；
4. O1 intent 门控（决定是否走 shapePrior / best-of-K）；
5. O2 phaseGeomGain（影响 ability 输入，间接影响 b\*/intent）；
6. O4 difficultyVec 升级（影响 best-of-K 评分尺度）。

**回归红线（与 §4.17 主条款共享 + 新增）**：① O2 全 1.0 时 ability 行为完全等价旧版（向后兼容）；② O3 单帧瞬时信号不让位（hits 计数器被信号消失重置）；③ O4 `solutionMetrics.truncated=true` 时新 term 全 null，scalar `stepDifficulty` fixture 不变；④ O5 高 d\* 阶段（≥ `earlyPhaseDStar`）b\* 不受钳制；⑤ O1 `off` 档下完全等价"未启用相对论"行为。

**数据流接入**：`insight.relativity` / `frames[].ps.adaptive.relativity` 透出新字段 `intent / phaseGeomGain / earlyPhaseCapHit / peogYieldHits`；REPLAY_METRICS 新增 4 条 sparkline；playerInsightPanel / algorithmDynamicsCard / DFV / spawn-signal-explorer.html 同步消费；RL `behaviorContext` 72→78（intent one-hot 4 + phaseGeomGain 1 + earlyPhaseCapHit 1）。详见 `docs/algorithms/ALGORITHMS_SPAWN.md §2.10/§4.17`。

---

## 六、验证清单（用于评审 / QA）

> 任何涉及 PB 主线的改动 PR，须自检以下清单。

- [x] `getSpawnStressFromScore(score=0, { bestScore })` 输出为 0（不论 bestScore 多少）。
- [x] `bestScore = 0` 时 `scoreStress` 走旧绝对档位，行为与首次开局玩家一致。
- [x] `pct < 0.5` 时 stress 必然被 `×0.4` 衰减（远征陪伴）。
- [x] `pct > 1.02` 时 stress 不再继续上升（突破段不加压）。
- [x] `deriveEffectivePb` 单调非减且连续；`expertSoftCap` 邻域差值 < 2；`pbProgress` 缺失时退化为 `max(personalBest, scoreFloor)`。
- [x] 双坐标解耦：高手 PB=5000 在 score=1800 时 `r_difficulty≈0.75` 已进入挑战区，但 `r_record=0.36` 远未触发任何 `best.gap.*` / `_maybeCelebrateNewBest` 叙事。
- [x] `expertEarlyBoost` 仅在 `bestScore≥expertThreshold ∧ r_difficulty<earlyRampUntil` 同时满足时 active；warmup / recovery / nearMiss / postPbRelease 期间 bypass，原因写入 `stressBreakdown.expertEarlyBoostBypass`。
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
- [x] PEOG 12 路 bypass 全覆盖；bypass 单向永久（active=false 后不再恢复）。
- [x] PEOG 强度升级单向：mild → strong 后即便 pct 回落也不降级。
- [x] PEOG cap 取 `min(expertEarlyBoostFloor, peogCap)` —— PEOG bypass 时 expertEarlyBoost floor 完整恢复。
- [x] 中高 PB 段开局 PerfectClearTriplet 候选被 yield cap 全部拒绝（typical yield≈12800 ≫ cap=120）。
- [x] `pickWarmTarget` 在 PEOG active 时 PERFECT_CLEAR → MULTI_CLEAR_NOW、MULTI_CLEAR_NOW → SETUP_FOR_MULTI。
- [x] `buildWarmBudget(intensity, { peogIntensity })` 改写 `guaranteedDelights` 为保护配比（perfectClear:0）。
- [x] `lifecycle:peog_engaged` 在守卫激活时 emit；`lifecycle:peog_overshoot_prevented` 在 `late_phase`/`approach_handoff` 自然到期时 emit（每局一次）。
- [x] `tests/peog.test.js` 45 个测试全绿。
- [x] `tests/adaptiveSpawn.test.js` 76 个测试全绿。
- [x] `tests/nearMissAndMilestone.test.js` `best.gap.*` / scoreMilestone 套件全绿。
- [x] `tests/challengeDesignOptimization.test.js` 25 个测试全绿。
- [x] `tests/bestScoreChaseStrategy.test.js` 50 个测试全绿，覆盖本文档 13 个改进项。
- [x] 全量 `npm test`：93 文件 / 1407 测试全部通过。
- [x] `npm run lint`：0 errors（22 pre-existing warnings 与本次改动无关）。

---

## 七、数据指标（建议接入 ops 看板）

| 指标 | 维度 | 期望区间 | 含义 |
|------|------|------------|--------|
| **PB 破纪录率** | 按 S × M 切片 | M0: 30%/局，M4: 5%/局 | 每局触发 `_maybeCelebrateNewBest` 的比例；过高 = 难度松；过低 = 难度过严 |
| **D2/D3 停留时长** | 按 S × M 切片 | 平均 ≥ 30 s（D3 ≥ 10 s） | "冲刺感"是否真的形成；过短 = challengeBoost 未生效 |
| **PB 后 5 spawn 停留率** | 全玩家 | ≥ 80% | 破纪录后玩家是否继续玩；过低 = §4.9 释放窗口缺失 |
| **PB 增长速率** | 按 M 切片，滚动 30 局 | M0: +10%/局，M4: +1%/局 | 是否仍有进步空间；停滞 → §4.7 周期 PB 救场 |
| **PB 异常分占比** | 全玩家 | ≤ 0.1% | 触发 §4.10 审核态的频次 |
| **near-PB lifecycle 事件转化** | 商业化 | 推送转化率 ≥ 均值的 1.5× | 验证 §4.12 价值 |

## 八、文档关联

- 上游方法论：[体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md)（5 轴体验结构）
- 系统通用模型：[策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md)（L1–L4 通用分层）
- 同层实时管线：[实时策略系统](../algorithms/REALTIME_STRATEGY.md)（指标字典、L4 卡片生成）
- 算法事实：[自适应出块](../algorithms/ADAPTIVE_SPAWN.md)（多信号 stress 融合 / `spawnHints` 派生）
- 出块机制：[出块架构 §二 §2.5](../algorithms/ALGORITHMS_SPAWN.md#十二出块算法架构总览工程分层)（`spawnHints` 如何变成具体 3 个块：5 阶段流水线 + 30+ 加权乘子 + 硬约束 + 场景跑步）
- 跨局画像：[生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)（S0–S4 × M0–M4）
- 计分规则：[消行计分](../product/CLEAR_SCORING.md)（如何把"消行"转成 score）
- 难度档：[难度模式](../product/DIFFICULTY_MODES.md)（Easy/Normal/Hard 与自适应协作）
- 行业实证：[休闲游戏品类分析](../domain/DOMAIN_KNOWLEDGE.md#十三休闲游戏品类分析与系统研究附录) §13、[领域知识](../domain/DOMAIN_KNOWLEDGE.md)

*以仓库主分支为事实来源。*
*维护者：策划组 + 体验算法组联合维护；改动需走 PR 评审并同步更新 §4 改进项编号与 §6 验证清单。*
