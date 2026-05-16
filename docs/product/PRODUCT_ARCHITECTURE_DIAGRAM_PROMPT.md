# OpenBlock 产品架构图生成 Prompt

> **定位**：可复用的“喂给大模型即生成 OpenBlock 产品架构图集合”的 prompt 模板。  
> **使用方式**：复制 §“Prompt 全文”整段粘贴给具备长上下文 + Mermaid 输出能力的大模型，即可获得 1 张产品总览图 + 6 张产品子图与解读。  
> **维护要求**：当核心玩法、best-score chase、生命周期分层、进度/宝箱/任务/商业化触点发生结构性变化时，同步更新本文事实包。

## 适用场景

- 为文档首页或产品评审材料生成“产品架构”图。
- 给主策划、产品、运营、策略算法协作者一份自包含的产品地图。
- 在新增玩法模式、元系统、商业化触点前，检查它是否破坏核心循环和体验边界。
- 派生定制：只画个人最佳分挑战、生命周期分层、体验五轴或元进度闭环。

## 设计原则

1. **产品逻辑优先**：图应以玩家旅程、体验目标、系统反馈和运营闭环为主线，不要画成文件依赖图。
2. **核心循环不可被外围淹没**：拖拽放置、消行反馈、压力变化、失败/复盘、再来一局必须处于中心。
3. **挑战个人最佳分是主目标**：bestScoreChase、scoreStress、challengeBoost、new-best feedback 必须显式出现。
4. **生命周期差异必须可见**：S0/S1/S2/S3/S4 与 M0/M1/M2/M3/M4 的分层不是运营附属，而是体验调控输入。
5. **诚实标注成熟度**：文档中已设计但未实现的内容必须标注“规划 / 建议”；已在代码中的内容标注代码入口。

---

## Prompt 全文

````markdown
# 角色

你是一位资深休闲游戏主策划人、产品架构师和策略设计师，擅长把游戏产品拆解为玩家旅程、核心循环、体验结构、成长系统、生命周期运营和商业化边界。你的产出物用于公开产品文档与策略评审，必须严格基于“事实包”中给出的模块、文档和代码入口，**不得发明不存在的玩法、不得把规划项画成已上线、不得把产品图画成纯技术依赖图**。

# 任务

为开源项目 **OpenBlock**（方块益智 + 自适应出块 + 玩家画像 + 强化学习训练 + 可插拔商业化框架）生成一套**产品架构图**，用 Mermaid 语法输出，并配以简短解读。要求覆盖 §4 列出的 1 张总览图 + 6 张产品子图，每张图独立、可编译、可读。

# §1 产品一句话定位

> OpenBlock 是一款以“挑战自己的最佳分”为核心长期目标的方块益智游戏。玩家通过拖拽候选块、完成消行、管理空间、追赶个人最佳分，在短会话中获得掌控、爽感、压力与成长；系统通过实时画像、自适应出块、生命周期分层和可控商业化触点，让不同阶段玩家获得差异化挑战，而不是用固定关卡或粗暴难度曲线服务所有人。

# §2 事实包（必须严格采用）

## 2.1 产品北极星

OpenBlock 的产品北极星：

```text
让玩家在多数有效会话中看到“接近自己最佳分”的希望，
在少数高质量会话中完成真实突破，
并在失败后知道下一局为什么可能更好。
```

三条产品约束：

- **短循环成立**：单局必须离线可玩，拖拽放置 → 消行反馈 → 再来一局不依赖元系统。
- **挑战不廉价**：个人最佳分进入压力和出块策略，但受 boardRisk、bottleneck、frustration、生命周期保护约束。
- **复盘可解释**：临近新高失败时，应能用 holes、firstMoveFreedom、clearRate、pickToPlaceMs、nearFullLines 等事实解释。

## 2.2 核心玩家旅程

```text
进入游戏
  → 选择难度 / 模式
  → 开局棋盘 + 三块 dock
  → 拖拽候选块
  → 放置成功 / 失败
  → 消行 / 多消 / Perfect Clear / 同 icon bonus
  → stress 与策略状态变化
  → 追赶个人最佳分
  → 新纪录 / 近失 / 死局
  → 结算、复盘、奖励、再来一局
```

关键入口：

- `web/src/game.js`：主控、分数、bestScore、game over、new-best popup、moveSequence。
- `web/src/grid.js`：棋盘状态机、canPlace、place、checkLines。
- `web/src/renderer.js`：棋盘、方块、特效绘制。
- `web/src/playerProfile.js`：skill、flowState、frustration、momentum、pickToPlaceMs。
- `web/src/adaptiveSpawn.js`：stress、spawnHints、spawnIntent、challengeBoost、orderRigor。
- `web/src/bot/blockSpawn.js`：三连块生成、可解性、机动性、顺序刚性。
- `web/src/stressMeter.js`：压力表、叙事、score-push 文案。
- `web/src/strategyAdvisor.js`：策略卡、live topology、瓶颈块、多消机会。

## 2.3 产品分层

| 产品层 | 玩家问题 | 系统能力 | 代码 / 文档入口 |
|---|---|---|---|
| 核心玩法层 | 我能不能一眼懂、马上玩？ | 8×8 棋盘、三块 dock、拖拽、消行、失败 | `game.js`、`grid.js`、`renderer.js`、`CLEAR_SCORING.md` |
| 体验调控层 | 这局为什么变紧或变松？ | stress、flowState、frustration、pacing、spawnIntent | `adaptiveSpawn.js`、`REALTIME_STRATEGY.md` |
| 目标与成长层 | 我在追什么？有没有进步？ | bestScore、scoreMilestone、XP、等级、成熟度 | `BEST_SCORE_CHALLENGE_STRATEGY.md`、`progression.js` |
| 情感与记忆层 | 这局有没有爽点？失败后想不想再来？ | 多消、PC、同 icon、near-miss、新纪录、结算 | `EASTER_EGGS_AND_DELIGHT.md`、`nearMissPlaceFeedback.js` |
| 生命周期运营层 | 我是新手、习惯玩家、核心还是回流？ | S0–S4、M0–M4、stress cap、回流保护、任务 | `PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md` |
| 商业化边界层 | 变现是否服务体验？ | feature flag、广告/IAP adapter、宝箱、钱包、offer | `MONETIZATION.md`、`CHEST_AND_WALLET.md` |

## 2.4 核心循环（必须居中）

最小循环：

```text
观察棋盘 → 选择候选块 → 拖拽放置 → 判断合法性 → 消行/不得分 → 反馈 → 下一步
```

长循环：

```text
单局表现 → 分数/最佳分/画像更新 → 自适应出块 → 策略卡/压力叙事 → 结算复盘 → 再来一局
```

元循环：

```text
局末奖励 → XP/等级/钱包/宝箱/任务/签到 → 回访动机 → 下一次会话
```

## 2.5 体验五轴（来自 EXPERIENCE_DESIGN_FOUNDATIONS）

| 轴 | 玩家感受 | 系统入口 | 测量信号 |
|---|---|---|---|
| 挑战-能力轴 | 有压力但可控 | stress、skillLevel、orderRigor、solutionSpacePressure | flowDeviation、boardRisk、firstMoveFreedom |
| 节奏-报偿轴 | 紧张与释放交替 | pacing、rhythmPhase、payoffIntensity | nearFullLines、multiClearCandidates、combo |
| 掌控-公平轴 | 输赢可归因 | canPlace、validPerms、bottleneckRelief、strategy tips | holes、solutionCount、missRate |
| 情感-记忆轴 | 爽点、近失、新纪录 | perfect clear、new-best popup、near-miss toast | maxLinesCleared、bestRatio、nearMiss |
| 成长-身份轴 | 我在变强 | bestScore、XP、maturity、lifecycle | bestZone、skillScore、stage/band |

## 2.6 个人最佳分挑战系统

当前已实现事实：

- `game.js` 开局读取 `bestScore`，保存为 `_bestScoreAtRunStart`。
- `adaptiveSpawn.js` 用 `getSpawnStressFromScore(score, { bestScore })` 生成 `scoreStress`。
- `adaptiveSpawn.js` 已有 `challengeBoost`：通常在 `score / bestScore >= 0.8` 后加压，最高约 `+0.15`。
- `deriveScoreMilestones(bestScore)`：低 best 用绝对里程碑 `[50,100,150,200,300,500]`；高 best 用 `[0.25,0.5,0.75,1.0,1.25] × bestScore`。
- `game.js` 在刷新最佳时触发 `new-best-popup`、皇冠、闪光、震屏。
- `stressMeter.js` 有 score-push 高压叙事守卫，避免空盘冲分被误说成“保活”。

已设计、待实现的产品策略（必须标注为“规划”）：

- `bestScoreChase`：`bestRatio / gapRatio / overBestRatio / zone / dangerPressure`。
- 分区：`best_unknown / warmup / build / approach / push / breakthrough / extend / legend`。
- `nearBestQuality`：衡量接近最佳但未破纪录的失败质量。
- `bestBreakSource`：`skill_break / payoff_break / rescue_break / risk_break / random_like_break`。
- `pushFairnessGuard`：冲刺段公平性护栏。
- `breakthroughGraceWindow`：破纪录后 1–2 次 spawn 稳定窗口。

## 2.7 生命周期 × 成熟度

生命周期 S 轴：

- S0 新入场：D0–D1 / 首 3 局，目标是 FTUE + 首次爽点。
- S1 激活：D2–D7 / 4–20 局，目标是重复回访。
- S2 习惯：D8–D30 / 20–120 局，目标是周节奏。
- S3 稳定：D31–D90 / 120–400 局，目标是长期价值。
- S4 回流：近 7/14/30 天未活跃，目标是恢复旧水平。

成熟度 M 轴：

- M0 新手：误放率高、依赖提示、会话短。
- M1 成长：基础策略形成，开始看广告。
- M2 熟练：可规划 2–3 步，活动参与稳定。
- M3 资深：追求效率、排行榜、挑战。
- M4 核心：高策略深度、高 LTV、高扩散。

出块调制入口：

- `web/src/lifecycle/lifecycleStressCapMap.js`
- `LIFECYCLE_STRESS_CAP_MAP` 使用 `stage·band → { cap, adjust }`
- S0/S4 低 cap + 负 adjust；S2/S3 高 band 更高 cap + 正 adjust。

## 2.8 元进度与外围产品系统

已存在产品系统：

- `progression.js`：XP、等级、头衔。
- `skills/*`：undo、bomb、freeze、rainbow、preview、hintEconomy。
- `checkin/`：签到与 streak。
- `daily/seasonPassEntry.js`、`seasonPass.js`：赛季/通行证。
- `rewards/endGameChest.js`、`rewards/luckyWheel.js`：局末宝箱、幸运转盘。
- `social/`：dailyMaster、asyncPk、replayAlbum。
- `lore/skinLore.js`、`seasonalSkin.js`、`skins.js`：皮肤和主题。
- `monetization/`：广告/IAP/offer/商业化看板。

约束：

- 元进度不能替代核心循环。
- 商业化触点必须默认可关闭，并经 feature flag 控制。
- 变现压力不能在玩家高挫败、高风险或回流保护期叠加。

## 2.9 文档入口

- 文档首页：`docs/README.md`
- 产品架构 prompt：`docs/product/PRODUCT_ARCHITECTURE_DIAGRAM_PROMPT.md`
- 体验设计：`docs/player/EXPERIENCE_DESIGN_FOUNDATIONS.md`
- 最佳分挑战：`docs/player/BEST_SCORE_CHALLENGE_STRATEGY.md`
- 实时策略：`docs/player/REALTIME_STRATEGY.md`
- 策略体验栈：`docs/player/STRATEGY_EXPERIENCE_MODEL.md`
- 生命周期成熟度：`docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md`
- 难度模式：`docs/product/DIFFICULTY_MODES.md`
- 消行计分：`docs/product/CLEAR_SCORING.md`
- 商业化：`docs/operations/MONETIZATION.md`

# §3 输出要求

请输出以下内容：

1. 先给一段不超过 150 字的产品架构总述。
2. 生成 §4 的 7 张 Mermaid 图，每张图必须：
   - 使用独立代码块；
   - Mermaid 语法可编译；
   - 节点标签用中文为主，必要时括号写代码入口；
   - 已实现与规划项要区分，规划项节点用“规划：”前缀或虚线。
3. 每张图后写 3–5 条解读，说明主策划/产品/策略设计应如何使用该图。
4. 最后输出“产品架构自检清单”。

# §4 必须生成的图

## 图 1：产品架构总览

要求：
- 以“挑战个人最佳分”为中心。
- 周围连接核心玩法、体验调控、目标成长、情感记忆、生命周期运营、商业化边界。
- 标出核心循环、长循环、元循环。

## 图 2：玩家旅程与会话闭环

要求：
- 从进入游戏到再来一局。
- 标出每个阶段的玩家心理：理解、掌控、紧张、爽点、近失、新纪录、复盘。
- 标出系统反馈：stress、spawnIntent、策略卡、结算。

## 图 3：体验五轴架构

要求：
- 五轴分别是挑战-能力、节奏-报偿、掌控-公平、情感-记忆、成长-身份。
- 每轴连接系统入口和测量信号。
- 标注跨轴互抑：高风险时抑制冲分加压；收获期避免高压叙事冲突。

## 图 4：个人最佳分挑战架构

要求：
- 展示当前已实现路径：bestScore → scoreStress → challengeBoost → stress → spawnHints → new-best feedback。
- 展示规划路径：bestScoreChase zone、nearBestQuality、bestBreakSource、pushFairnessGuard、breakthroughGraceWindow。
- 区分当前实现与规划项。

## 图 5：生命周期 × 成熟度产品策略矩阵

要求：
- 横轴 M0–M4，纵轴 S0–S4。
- 不需要画满 25 格细节，但必须画出代表格：
  - S0/M0 新手保护
  - S1/M1 轻挑战
  - S2/M2 周目标
  - S3/M3 排行榜/高压冲刺
  - S3/M4 核心荣誉
  - S4/M0 回归保护
  - S4/M4 核心召回
- 连接到 `lifecycleStressCapMap`。

## 图 6：元进度与商业化边界

要求：
- 核心玩法在中心，元进度/任务/宝箱/皮肤/签到/社交/商业化围绕外圈。
- 明确商业化只能通过事件总线和 feature flag 接入。
- 标注“体验劣化时抑制变现压力”。

## 图 7：产品数据与迭代闭环

要求：
- 玩家行为 → PlayerProfile → bestScoreChase / lifecycle snapshot → 自适应出块 / 策略卡 / 商业化触达 → 行为结果 → replayAnalysis / opsDashboard。
- 标出可评审指标：best_80_rate、best_95_rate、best_break_rate、near_best_quality、best_source_mix、push_suppression_rate。

# §5 自检清单

输出前检查：

- 是否把“挑战个人最佳分”放在产品架构中心？
- 是否区分当前已实现与规划项？
- 是否没有发明不存在的玩法系统？
- 是否没有把商业化画成核心循环的一部分？
- 是否体现 S/M 生命周期和成熟度差异？
- 是否体现体验五轴，而不是只画功能模块？
- 是否能让主策划据此判断每个系统服务什么玩家心理？
- 是否能让策略算法工程师据此定位字段、指标和调制入口？
````
