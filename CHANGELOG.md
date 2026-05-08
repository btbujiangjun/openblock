# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (v1.26 — AdaptiveSpawn Live Geometry Override)
- **`adaptiveSpawn` 在决策前接入 live 几何覆盖（nearFull/multiClear）**：
  为减少“策略卡按 live+dock、而 adaptiveSpawn 仍读旧 ctx 快照”的时序偏差，新增
  `_mergeLiveGeometrySignals(ctx)`：
  - 当 `spawnContext._gridRef` 存在时，先用 `analyzeBoardTopology(grid)` 重算
    `nearFullLines`
  - `multiClearCandidates` 优先按 `_dockShapePool` 统计（若不可用回退全形状库）
  - 再覆盖进本轮 `ctx` 参与 `spawnIntent` / `rhythmPhase` / `multiClearBonus` /
    `multiLineTarget` 等判定
- **`game.js` 调用 `resolveAdaptiveStrategy` 时注入 `_gridRef` 与 `_dockShapePool`**
  （不污染持久 `_spawnContext`，仅单次调用上下文生效）。
- 新增测试：`tests/adaptiveSpawn.test.js` 覆盖“陈旧快照=0，但 live 网格具备 nearFull/multiClear”
  时仍可正确走 `spawnIntent='harvest'`。

### Changed (v1.25 — Multi-Clear Candidate Must Match Current Dock)
- **`playerInsightPanel` 的 `liveMultiClearCandidates` 改为 dock 优先统计**：
  旧版按 `getAllShapes()` 全形状库统计“可多消块种数”，会出现“策略提示有多消机会，
  但当前候选三块（dock）根本打不中”的体感偏差。新版优先只统计 `game.dockBlocks`
  中未放置块（玩家当下真能用的 3 块）里可达 `multiClear>=2` 的数量；仅在 dock 不可用
  时回退全形状库（兼容开局/测试桩）。这样「多消候选 N」pill 与策略建议均与当前候选块一致。

### Changed (v1.24 — Flow Narrative Phase Variants)
- **`stressMeter.SPAWN_INTENT_NARRATIVE.flow` 拆按 rhythmPhase 选变体表**：
  旧版 `flow` 文案硬编码"心流稳定，节奏进入收获期，准备享受多消快感。"，但 spawnIntent='flow'
  的触发条件是 `delight.mode === 'flow_payoff' || rhythmPhase === 'payoff'`——
  `delight.mode='flow_payoff'` 在 R1 空盘 + flow=flow + skill≥0.55 时也会成立，此时实际
  `rhythmPhase` 因 v1.21 的 `nearGeom` mutex 会 fall through 到 `'setup'`。结果三方对立
  （截图复现）：
  - story："心流稳定，**节奏进入收获期**…"
  - spawn 决策 pill：「节奏 **搭建**」+「意图 心流」
  - strategyAdvisor 卡：🏗️ **搭建期** + "稳定堆叠、预留消行通道"
  
  修复：新增 `FLOW_NARRATIVE_BY_PHASE` 变体表（payoff / setup / neutral 各一句），
  `buildStoryLine` 遇 `spawnIntent='flow'` 时按当前 `rhythmPhase` 选变体；rhythmPhase
  缺失时兜底 `SPAWN_INTENT_NARRATIVE.flow`（已去掉"收获期"硬编码改为通用文案
  "心流稳定，系统继续维持流畅的出块节奏。"）。其他 intent 仍走单一映射。
  新增 5 条 buildStoryLine 单测（setup/payoff/neutral 变体 + 兼容 + 不影响其他 intent）。

### Changed (v1.23 — Story Priority + Live-Geometry Harvest Card)
- **`stressMeter.buildStoryLine`：spawnIntent 永远优先（不再被 frust/recovery 绕过）**：
  v1.16 把 spawnIntent 设为最高优先级，但 gating 条件 `frust > -0.08 && recovery > -0.08`
  让 frustRelief 触发时绕过 `SPAWN_INTENT_NARRATIVE.relief`（"盘面通透又是兑现窗口…"），
  退回老严厉文案"检测到挫败感偏高"。v1.18 stressMeter label/vibe 已诚实化为
  「放松（救济中）」+「系统正在为你减压」，story 仍是"挫败感偏高"——同一面板三方拉扯
  （截图复现：label 友好 + vibe 友好 + story 严厉）。
  
  改为：`boardRisk ≥ 0.6` 仍让"保活"叙事抢占（极端硬信号），其余情况下 spawnIntent
  存在就直接用 `SPAWN_INTENT_NARRATIVE`。老严厉文案降级为"spawnIntent 缺失（pv=2 早期
  回放）的兼容兜底"。新增 4 条 buildStoryLine 单测覆盖优先级 + 兼容路径。
- **`strategyAdvisor`「💎 收获期」卡加 live 几何 mutex + 待兑现变体**：
  rhythmPhase 是 spawn 时锁定的快照，spawn 后玩家落了块（消了 / 没消），live 几何
  已经变化（multiClearCands→0、nearFullLines→0），此时仍说「积极消除拿分」是空头建议
  （截图复现：spawn 决策 多消 0.95 + 多线×2 + 目标保消 3，但 live 多消候选 0、近满 0，
  dock 是 4 块 volleyball L 形，根本无从兑现）。v1.20 已经给「多消机会/逐条清理/瓶颈块」
  3 张卡都加了 live 几何 mutex，本次补上「收获期」卡。
  
  当 `_liveMultiClearCands < 1 && _liveNearFull < 2` 时切诚实变体「💎 收获期·待兑现」+
  文案"上一次 spawn 锁定了'收获'节奏，但当前 dock 与盘面暂时没对上消行机会，先稳住手等
  下次 spawn 兑现。"；live 几何支持时仍出原「💎 收获期」卡。新增 4 条单测覆盖（live=0 切
  待兑现 / live=2 仍出原文案 / nearFull≥2 任一条满足即可 / 旧 panel 无 live 注入回退）。

### Changed (v1.22 — Card Mutex (Build vs Harvest) + Sparkline Help Decoder)
- **`strategyAdvisor`「规划堆叠」卡加 `harvestNow` 互斥**：
  v1.17 已为「提升挑战」卡加了 `harvestNow = (rhythmPhase==='payoff' || spawnIntent==='harvest')`
  的互斥（避免与「收获期」卡叙事拉扯），但同文件第 11 张「构型建议 → 规划堆叠」卡
  仍只看 `fill<0.3 && skill>0.5`，导致线上截图复现：rhythmPhase=payoff + 板面 30% +
  skill 78% 时一帧出现两张方向相反的卡——
  - 💎 收获期：「积极消除享分」（要求当下兑现）
  - 🏗️ 规划堆叠：「留出 1~2 列通道为后续做准备」（要求蓄力搭建）
  
  修复同样加 `&& !harvestNow` 闸，`payoff` / `harvest` 时跳过此卡，搭建/中性期仍
  保留长期建议。新增 3 条互斥单测（payoff 抑制 / harvest 单独抑制 / neutral 仍可触发）。
- **REPLAY_METRICS 19 条 sparkline tooltip 全量补「📈 看图」解读段**：
  原 tooltip 只解释"是什么"（指标定义），不解释"曲线怎么读"。新增统一的 `📈 看图：…` 段，
  说明：典型范围、上行/下行/平台/拐点的含义、与哪条相邻曲线互相印证、什么读数对应
  哪种 strategyAdvisor 卡 / spawnIntent 切换。覆盖：得分 / 技能 / 板面 / 消行率 / 压力 /
  F(t) / 动量 / 未消行 / 负荷 / 失误 / 思考 / 闭环 + 6 条 stress 分量（难度 / 心流 /
  松紧 / 救济 / 会话 / **挑战**）。
- **「挑战」(challengeBoost) sparkline tooltip 显式说明触发条件**：
  玩家常因看到曲线长期为 0 而怀疑指标失效。新 tooltip 写明：
  > 触发条件 `score ≥ bestScore × 0.8` 且 `stress < 0.7`，公式
  > `min(0.15, (score/best - 0.8) × 0.75)`。在到达 80% 阈值前曲线恒为 0 是预期；
  > 从 0 抬到正值说明你正在冲击新高、系统要把节奏推到"决赛圈"。同时会把
  > spawnIntent 切到 pressure。本局最佳为 0 时（首局）也恒为 0。
  
  机制本身（adaptiveSpawn.js:615-622 + v1.20 5 条单测）已健壮，本次只补叙事层。

### Changed (v1.21 — Phase Coherence + Snapshot Marker + Borderline Damping)
- **`adaptiveSpawn.deriveRhythmPhase`：`'setup'` 与 `'harvest'` 互斥兜底**：
  v1.17 加 `canPromoteToPayoff` 时只堵了 `'neutral'→'payoff'` 的提升路径，没堵
  `'setup'` 在有几何时被错误返回。线上截图复现：`pacingPhase='tension' &&
  roundsSinceClear=0 && nearFullLines>=2` 同时满足时 → 一帧出现 pill「节奏 搭建」+
  「意图 兑现」+ stress story「投放促清形状」+ strategyAdvisor「搭建期 稳定堆叠
  留通道」对立叙事。修复给 `'setup'` 分支加 `&& !nearGeom`：紧张期开头若几何
  已经支持兑现就 fall through 到 `'neutral'`、由后续 `canPromoteToPayoff` 升 `'payoff'`，
  与 `spawnIntent='harvest'` 同口径。
- **`playerInsightPanel._buildWhyLines(insight, profile)`：纯 live 量改 live 优先**：
  v1.20 已经把 pill 的 F(t) / 闭环反馈改 live，但策略解释段（`_buildWhyLines`）还在
  用 `insight.flowDeviation` / `insight.feedbackBias` / `insight.flowState`（spawn 快照），
  造成"sparkline F(t)=0.82 / pill 0.82 / 解释 0.78"三态打架。改为双参签名，
  纯 live 量优先 `profile.*`，spawn 决策类（spawnIntent / spawnHints / stressBreakdown / 
  strategyId / difficultyBias）继续读 `insight.*`。
- **`playerInsightPanel`：spawn 决策 pill 之前插入「📷 R{n} spawn 决策」marker**：
  spawn 决策类 pill（意图/目标保消/尺寸/多样/节奏/弧线/连击/多消/多线×/形状权重）
  与上方 live pill（压力/F(t)/闭环反馈/占用/救济通路）和下方 live 几何 pill
  （多消候选/近满/空洞/平整/解法/合法序）混排，玩家分不清"spawn 决策快照"与
  "live 实时状态"，于是看到「意图 兑现 + 多消候选 0」会误判为撞墙。
  插入虚线边框的 marker pill，hover tooltip 解释"spawn 后保持不变直到下次 spawn"，
  视觉上把两组分开。CSS 新增 `.insight-weight--snapshot`。
- **`playerProfile.flowState`：borderline 去抖**：旧版 `fd > 0.5 && clearRate > 0.4` 在
  玩家停留在阈值附近时会因 micro-sample 抖动反复在 'bored' / 'flow' 翻面，造成同帧
  snapshot=bored / live=flow 对不上。两条阈值各加 5% 缓冲（`fd > 0.55 && clearRate > 0.42`），
  borderline 默认 fall through 到 'flow'，单向偏好心流。

### Tests (v1.21)
- **`tests/adaptiveSpawn.test.js`** ：新增 2 条 v1.21 互斥测试
  （tension+roundsSinceClear=0+nearFullLines≥2 → 不再 setup；同条件无几何 → 仍 setup）。
- **`tests/playerProfile.test.js`** ：新增 1 条 borderline 去抖测试
  （fd≈0.52 + clearRate=0.41 紧贴旧阈值上方 → 不再 bored，fall through 到 flow）。
- v1.20 基线 766 → v1.21 **769** 测试，全绿；lint / build / bundle 预算通过

### Changed (v1.20 — Live/Snapshot Alignment + Label Decoupling)
- **`strategyAdvisor`：多消机会卡 / 瓶颈块卡改读 live 几何（替代 spawn 快照）**：
  v1.18 引入 `nearFullLines` / `multiClearCandidates` 双卡分流后，仍走 `diag.layer1.*`
  即 spawn 时快照。玩家在 spawn 后放过 1~3 块、几何已变（清掉了一行 / 已经放完
  多消候选块）时，策略卡仍按"4 个多消放置 + 3 接近满行"叙述，而面板 pill
  「多消候选 N」走 live 算 0，两者撞墙。
  v1.20 让 `playerInsightPanel` 把 `liveTopology` + `liveMultiClearCandidates` 注入
  `gridInfo`，`strategyAdvisor` 优先读 live、回退 snapshot；`_liveNearFull` /
  `_liveMultiClearCands` 两个变量统一卡内引用，避免再次混用。
- **`playerInsightPanel`：F(t) / 闭环反馈 pill 改读 PlayerProfile live**：
  原本 `F(t) <pill>` 读 `ins.flowDeviation`（spawn 时快照）、左侧 sparkline 末点读
  `profile.flowDeviation`（live），同一帧出现 0.59 vs 0.47 的 0.12 量级偏差。
  v1.20 起两侧统一读 PlayerProfile.live；spawn 决策类字段（`spawnIntent` / 
  `multiClearBonus` 等）仍读 `ins.*` 维持 spawn 时一致。
- **`moveSequence`：sparkline `pacingAdjust` 标签 「节奏」→「松紧」**：
  v1.17 把 `pacingPhase` UI 标签解耦成「Session 张弛」，但 sparkline 还在用
  「节奏」展示 `pacingAdjust`，结果与右侧 `spawnHints.rhythmPhase` pill「节奏 收获」
  再次撞名（两者一个是相位枚举、一个是数值偏移）。本次改为「松紧」，并在
  `stressMeter.SIGNAL_LABELS.pacingAdjust` 同步更名 + tooltip 说明二者区别。

### Tests (v1.20)
- **`tests/adaptiveSpawn.test.js`** ：填补 `challengeBoost` 触发 4 条件单测覆盖
  （v1.19 之前 0 测试）—— 不触发（`score < 0.8 * bestScore`、`bestScore = 0`）+
  触发幅度（`min(0.15, (ratio-0.8) * 0.75)` 公式校验）+ `spawnIntent='pressure'`
  联动；共 **5** 条新增。
- v1.19 基线 761 → v1.20 **766** 测试，全绿；lint / build / bundle 预算通过

### Changed (v1.19 — Geometry-Honest Spawn Bias)
- **`adaptiveSpawn`：`multiClearBonus` / `multiLineTarget` 几何兜底（v1.17 cg 兜底姊妹补丁）**：
  在所有偏好规则之后加一道软封顶 —— 当
  ① 当前盘面 `multiClearCandidates < 1`
  ② `nearFullLines < 2`（连"清一条剩两条"都做不到）
  ③ 不是真 perfect-clear 窗口（`pcSetup ≥ 1` 但 `fill < PC_SETUP_MIN_FILL` 是噪声）
  ④ 不在 warmup 阶段，且未触发 AFK engage
  四条同时成立时，把 `multiClearBonus` 软封顶到 0.4、`multiLineTarget` 归 0。
  避免出现 `playstyle='multi_clear'`、`pcSetup` 噪声、或 v10.x 偏好继承等
  路径把 bonus 顶到 0.65～0.75，但盘面物理上根本不可能多消，导致 dock 里
  全是长条 + 玩家落地后只能触发单行消除，「明显多消导向」与现实脱钩。
  **保留对 cg 兜底的语义对称**：cg 是「承诺」必须可兑现，warmup/AFK 也要兜底；
  multiClearBonus/multiLineTarget 是「偏好」可以前瞻，warmup/AFK 显式豁免。
- **`playerInsightPanel`：救济 pill 自动化为 top-N 负贡献（替代 v1.18 硬编码三件套）**：
  v1.18 把 `frustrationRelief` / `recoveryAdjust` / `nearMissAdjust` 三个分量直接 pill 化，
  解决了"为什么 stress 这么低"的可解释性问题，但只覆盖 3 条救济。当 `spawnIntent='relief'`
  来自 `delight.mode` / `flowAdjust` / `pacingAdjust` / `friendlyBoardRelief` 等其他
  减压源时，三件套全为 0，玩家依然看不出谁在救济。
  改为复用 `stressMeter.summarizeContributors`，从 `stressBreakdown` 自动挑出当前帧
  贡献最大的 **top 2 负向分量**（绝对值 ≥ 0.04），标签 + tooltip 直接复用 `SIGNAL_LABELS`，
  覆盖所有 17 条救济/加压通路。

### Tests (v1.19)
- **`tests/adaptiveSpawn.test.js`** ：新增 5 个 v1.19 兜底用例（`playstyle=multi_clear` 无几何 → 兜底；
  `nearFullLines ≥ 2` 不触发；`multiClearCandidates ≥ 1` 不触发；warmup 豁免；低 fill + pcSetup=1 噪声触发）。
  并把 `multiLineTarget is 2 when pcSetup>=1` 的 fill 从 0.4 提到 0.5（≥ PC_SETUP_MIN_FILL 的真窗口）。
- **`tests/playstyle.test.js`** ：把 `perfect_hunter` / `multi_clear` 两个 multiClearBonus 期望
  补上 `nearFullLines: 2` 上下文 —— 玩家偏好不应单独把 bonus 顶到 0.85/0.65，需要盘面真有兑现机会。
- v1.18 基线 756 → v1.19 **761** 测试，全绿；lint / build / bundle 预算通过

### Added (v1.18 — Narrative Granularity)
- **`stressMeter.getStressDisplay(stress, spawnIntent)` —— 救济变体头像/文案**：
  当 `spawnIntent==='relief'` 且 stress 已被压到 ≤ −0.05（落入 calm 档）时，
  原本的「😌 放松 / 盘面整洁，心情舒缓」改为 **「🤗 放松（救济中）/
  系统正在为你减压…」**。解决"😌 放松"+"挫败感偏高"叙事撞车的问题，
  让玩家理解"我现在轻松，是因为系统正在帮我"。easy/flow 等中性档不切，
  避免过度提示。
- **`strategyAdvisor`：瓶颈块预警卡（v1.18）**：当 `solutionMetrics.validPerms ≤ 2`
  且 `fill ≥ 0.4`（解法度量已激活）时，弹「⏳ 瓶颈块」卡（priority 0.86），
  提醒玩家"先放可放置位最少的那块、别再贪连击"。文案带出 `firstMoveFreedom`
  辅助定位瓶颈。
- **`playerInsightPanel`：救济三分量 pill**：把 `stressBreakdown.frustrationRelief
  / recoveryAdjust / nearMissAdjust` 直接以紧凑 pill 形式（`挫败救济 −0.12 /
  恢复 −0.08 / 近失 −0.04`）暴露给玩家，不必再从故事线里倒推"现在 stress 是
  被哪条救济压下去的"。仅在分量 |v| ≥ 0.02 时显示，避免噪声铺屏。

### Changed (v1.18 — Narrative Granularity)
- **`strategyAdvisor` 多消机会卡分两文案** —— 旧版只要 `nearFullLines ≥ 3` 就
  鼓动"选择能同时完成多行的位置 / 争取大分"，但盘面 `multiClearCandidates < 2`
  时物理上无法多消。现在按几何兜底分两条：
  - `multiClearCands ≥ 2` → 沿用「🎯 多消机会」原文案 + 拼接候选数
  - `multiClearCands < 2` → 改为「✂️ 逐条清理：暂无多消组合，先把最容易消的
    那条清掉，缓解压力」
- **`PlayerProfile.flowState` 复合挣扎检测** —— 旧版要求 `F(t) ≥ 0.25` 才进入
  方向判定，会漏掉「思考 4 秒 + 失误 13% + 板面 58% + 消行率 25%」这种**单一阈值
  都没踩穿、但多个弱信号同时成立**的挣扎场景。新增前置判定：
  ```js
  const struggleSignals =
    (m.missRate > 0.10 ? 1 : 0)
    + (m.thinkMs > thinkTimeStruggleMs (3500) ? 1 : 0)
    + (m.clearRate < 0.30 ? 1 : 0)
    + (avgFill > 0.55 && m.clearRate < 0.40 ? 1 : 0);
  if (struggleSignals >= 3) return 'anxious';
  ```
  阈值刻意宽松，每条都是"轻度负面"，必须 ≥3 条同时成立才生效，避免误报。
  新增可调键 `flowZone.thinkTimeStruggleMs`（默认 3500ms）。

### Tests (v1.18)
- `tests/stressMeter.test.js` (+5)：`getStressDisplay` 在 calm + relief 时切变体；
  easy / flow 区不切；其它意图沿用基础档；未提供 intent 沿用基础档。
- `tests/strategyAdvisor.test.js` (+5)：多消机会 ↔ 逐条清理 分支；
  validPerms ≤ 2 + fill ≥ 0.4 弹「瓶颈块」高优先级卡；validPerms 充裕不弹；
  fill < 0.4 不报（避免冷启动误报）。
- `tests/playerProfile.test.js` (+2)：复合挣扎四信号 ≥3 → anxious；
  单一信号成立 → 不升 anxious。
- v1.17 基线 744 → v1.18 **756** 测试，全绿；lint / build / bundle 预算通过
  （index 231 KB / meta 325 KB / rl 72 KB）。

### Changed (v1.17 — Pressure-Strategy Coherence Patch)
- **`playerInsightPanel`：拆开"节奏相位"双重含义** —— v1.16 之前 UI 上同时
  存在两条都叫「节奏相位」的文案：紧凑 pill `节奏 收获` 来自
  `spawnHints.rhythmPhase`（setup/payoff/neutral，per-spawn），策略解释段
  `节奏相位：紧张期` 来自 `PlayerProfile.pacingPhase`（tension/release，
  session 周期内的张弛位置）。同名异义会被玩家视为系统自相矛盾。
  - `_pacingExplain()` 与 `TOOLTIP.pacing` 改写为 **「Session 张弛」** 专指
    `pacingPhase`；`spawnHints.rhythmPhase` 保留 `节奏相位` 的称谓。
- **`adaptiveSpawn`：harvest / payoff 几何兜底** —— `pcSetup ≥ 1` 在低占用
  盘面（如 17% 散布）经常是噪声，但旧逻辑会无条件把 `spawnIntent='harvest'` /
  `rhythmPhase='payoff'` 拉满，于是 stressMeter 报「密集消行机会」、出块
  推 1×4 长条、strategyAdvisor 弹「收获期」，**而盘面其实根本没有任何近满
  行**。
  - 新增模块常量 `PC_SETUP_MIN_FILL = 0.45`。
  - `spawnIntent='harvest'` 现在要求 `nearFullLines ≥ 2` **或**
    `(pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL)`。
  - `deriveRhythmPhase` 与主路径 `pcSetup ≥ 1` 分支同口径门控。
  - `delight.mode='challenge_payoff'/'flow_payoff'`、`playstyle='multi_clear'`、
    `afkEngage` 等"基于玩家状态"的 `payoff` 升级现在统一通过
    `canPromoteToPayoff = nearFullLines ≥ 1 || multiClearCands ≥ 1 ||
    (pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL)` 兜底，避免出块偏向
    与 UI 叙事在空盘面上撒谎。
- **`adaptiveSpawn`：clearGuarantee 物理可行性兜底** —— `cg=3` 由 `warmup wb=1` /
  `roundsSinceClear ≥ 4` 顶上来时承诺"本轮强制 ≥3 块能立刻消行"。但若
  `multiClearCandidates < 2 && nearFullLines < 2`，盘面物理上无法兑现这条
  承诺，UI pill 「目标保消 3」即变成空头支票。新增最终兜底：当 `cg ≥ 3`
  且盘面无几何支撑时回钳到 `2`，仍保持友好出块语义但不撒谎。
- **`strategyAdvisor`：收获期 ↔ 提升挑战 互斥** —— 同面板上同时出现
  「💎 收获期：积极消除拿分」与「🚀 提升挑战：构建 3 行+ 同消」两条
  互相拉扯的目标（一个让玩家"现在兑现"，一个让玩家"蓄力搭建"）。
  当 `rhythmPhase==='payoff'` 或 `spawnIntent==='harvest'` 时不再追加
  「提升挑战」卡。同时盘面太稀（`fill < 0.18`）也不再推「3 行+」目标，
  因为多线候选物理上接近 0。

### Tests (v1.17)
- `tests/adaptiveSpawn.test.js` (+6)：低占用 + pcSetup=1 不再触发 harvest /
  rhythmPhase=payoff；高占用 + pcSetup=1 仍 harvest；nearFullLines=2 单独触发
  harvest；warmup 起手在空盘面 cg 兜底回钳 ≤2；multiClearCandidates ≥2 时
  cg=3 维持；cross-game warmup 测试样本补 `nearFullLines: 2`。
- `tests/strategyAdvisor.test.js` (+4，新文件)：rhythmPhase=payoff 时不出
  「提升挑战」；rhythmPhase=neutral + 中等占用仍出该卡；fill<0.18 抑制；
  spawnIntent=harvest 单独也能抑制。
- v1.16 基线 734 → v1.17 **744** 测试，全绿；lint / build / bundle 预算通过
  （index 231 KB / meta 323 KB / rl 72 KB）。

### Added (v1.16 — Pressure-Strategy Coherence)
- **`web/src/boardTopology.detectNearClears(grid, opts)`**: 「近完整行/列」检测的
  单一来源（返回 `{ rows, cols, nearFullLines, close1, close2 }`）。
  `analyzeBoardTopology` 与 `bot/blockSpawn.analyzePerfectClearSetup`
  现在共享同一实现，避免「近满 N」与 `pcSetup`/`multiClearCandidates`
  在不同视图下走调（这是 v1.15 之前 stress=0.89 + 多消候选=0 + 闭环=+0.190
  三者互相矛盾的根因）。
- **`adaptiveSpawn._stressBreakdown.occupancyDamping`**: 在 stress clamp
  之后、smoothing 之前对正向 stress 乘 `clamp(boardFill/0.5, 0.4, 1.0)`。
  低占用盘面（如 fill=0.39）的伪高压由 0.89 → ~0.69，进入 `tense` 而非
  `intense`。负向 stress（救济）不被衰减。
- **`spawnHints.spawnIntent` 枚举**：`relief / engage / pressure / flow /
  harvest / maintain` —— 出块意图的单一对外口径。`stressMeter.buildStoryLine`、
  `monetization/personalization.updateRealtimeSignals`、回放标签都读这同
  一字段，不再各自推断；同时通过 `_lastAdaptiveInsight.spawnIntent` 暴露
  给 panel。
- **AFK 召回路径 (`engage`)**: `adaptiveSpawn` 在 `profile.metrics.afkCount ≥ 1`
  且 `stress < 0.55`、无救济触发时，主动提升 `clearGuarantee≥2 / multiClearBonus≥0.6 /
  multiLineTarget≥1 / diversityBoost≥0.15` 并把 rhythmPhase 从 `neutral`
  切到 `payoff`，给玩家「显著正反馈 + 可见目标」而非纯泄压。
- **`stressMeter.SPAWN_INTENT_NARRATIVE`**: spawnIntent → 玩家叙事的单一映射，
  `buildStoryLine` 优先取该映射；只在 `boardRisk≥0.6` 或挫败/恢复主导时被覆盖。
- **`playerInsightPanel` 新增「意图」pill**：直接显示当前 spawnIntent；
  「闭环」改名为「闭环反馈」并刷新 tooltip，明确强调它衡量「近期奖励是否
  高于预期」，与「近满 N / 多消候选」无关。

### Changed (v1.16 — Pressure-Strategy Coherence)
- **`PlayerProfile.momentum` 加噪声衰减**：在样本置信度之外再乘 `noiseDamping =
  clamp(1 - (var_old + var_new), 0.5, 1)`（伯努利方差噪声）。两半区
  接近 50/50 时 momentum 被收窄到原值的 0.5，避免「我状态稳定，UI 却显示
  动量 +1」。文档同时澄清 momentum **完全基于消行率**而非分数增量。
- **`monetization/personalization.updateRealtimeSignals(profile, extras?)`**：
  新增第二参数 `extras.spawnIntent`，由 `commercialInsight` 在 `spawn_blocks`
  事件中传入，实现策略文案与出块意图同源。

### Tests (v1.16)
- **`tests/boardTopology.test.js` (新增 6)**：detectNearClears 空盘 / close1 /
  close2 / requireFillable / 与 analyzeBoardTopology 一致 / maxEmpty。
- **`tests/adaptiveSpawn.test.js` (新增 8)**：occupancyDamping 衰减 /
  救济场景不衰减 / harvest intent / relief intent / AFK engage 提升 hints /
  AFK engage 让位 relief / momentum 噪声衰减 / spawnIntent 始终落入合法枚举。
- **总测试数**：720 → **734**（全部通过）。

### Added (v1.15)
- **Observability — metrics**: `services/common/metrics.py` (Prometheus
  Flask exporter); auto-attached to user / game / analytics services;
  monitoring service keeps its bespoke `/metrics`. Per-app
  `CollectorRegistry` so multiple apps in one process don't collide.
  Standard latency buckets (5ms..30s).
- **Observability — tracing**: `services/common/tracing.py` (OpenTelemetry
  SDK + Flask + requests + SQLAlchemy auto-instrumentation). Default
  is no-op; ship via OTLP/HTTP by setting
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **API documentation**: `services/user_service/openapi.py` (apispec +
  marshmallow). Spec at `GET /openapi.json`, Swagger UI at `GET /docs`.
  Routes carry YAML docstrings; reusable schemas in
  `components/schemas`.
- **Database layer**: `services/common/orm.py` (SQLAlchemy 2.0 base +
  engine factory + `session_scope` helper).
  `services/user_service/orm_models.py` (`UserOrm`, `SessionOrm`).
  `services/user_service/sql_repository.py` (`SqlUserRepository`) — same
  interface as `_MemoryRepo`, plug-in via `USE_POSTGRES=true`.
- **Alembic**: `services/alembic.ini`, `services/migrations/env.py`,
  baseline revision `e0ef3caf345f` covering `users` + `user_sessions`.
  CI fails on schema drift via the `alembic-check` job.
- **k8s manifests**: `k8s/base/{namespace,configmap,secret,user,game,analytics,monitoring,ingress}`.
  All deployments use non-root, read-only-rootfs, `cap_drop=ALL`,
  seccomp `RuntimeDefault`, HPA on user + game.
- **Helm chart**: `k8s/helm/openblock/` with `values.yaml`, templated
  Deployment / Service / HPA / ConfigMap / Ingress.
- **nginx hardening**: `services/nginx.conf` rewritten with
  per-route `limit_req` zones (auth/payment/api), security headers,
  per-upstream circuit breaker (`max_fails`/`fail_timeout`), JSON
  access log, `auth_request` subrequest hook to `/api/auth/verify`,
  TLS termination block scaffolded behind `# tls` markers.
- **Web bundle splitting**: `vite.config.js` `manualChunks` cuts the
  main `index.js` from 500 KB → 230 KB (-54%). New chunks: `meta`
  (player insights, monetization, panels) and `rl` (bot training).
  Enforced by `scripts/check-bundle-size.mjs` in CI.
- **Tests**: `services/tests/test_metrics.py`, `test_tracing.py`,
  `test_openapi.py`, `test_sql_repository.py`. Total 69 services tests
  passing.
- **CI**: `bundle-size` step in the web job, `alembic-check` job
  (autogenerate diff must be empty).
- **Docs**: `docs/operations/OBSERVABILITY.md`,
  `docs/operations/K8S_DEPLOYMENT.md`. Updated `DEPLOYMENT.md`,
  `ARCHITECTURE.md`.
- **Dependencies** (`services/requirements.txt`): `alembic`,
  `prometheus-flask-exporter`, OpenTelemetry stack
  (`opentelemetry-api`, `opentelemetry-sdk`,
  `opentelemetry-instrumentation-{flask,requests,sqlalchemy}`,
  `opentelemetry-exporter-otlp-proto-http`), `apispec`,
  `apispec-webframeworks`, `marshmallow`.

### Added (v1.14)
- **services/Dockerfile.{user,game,analytics,monitoring}**: production-grade
  container images using `python:3.11-slim`, non-root `app` user, and
  HEALTHCHECK against `/health`.
- **services/.env.services.example**: template for the secrets that
  `services/docker-compose.yml` now requires (all `${VAR:?...}` style).
- **services/security/jwt_tokens.py**: JWT (PyJWT) issuance + verification
  with refresh rotation, pluggable `RevocationStore` and required claims.
- **services/security/password.py**: Argon2id password hashing module
  (`PasswordHasher.hash` / `verify` / `needs_rehash`) with OWASP defaults.
- **services/security/rate_limit.py**: pluggable `RateLimitBackend` API
  with `InMemoryBackend` (dev) and `RedisBackend` (production, atomic Lua).
- **services/tests/**: pytest suites for encryption, password, JWT,
  payment, rate limit and the user-service Flask app (in-memory repo).
- **.github/dependabot.yml**: weekly updates for npm, pip, Docker and
  GitHub Actions.
- **CI**: new `python-services` (pytest + pip-audit), `npm-audit`,
  `docker-compose-config` jobs in `.github/workflows/ci.yml`.
- **SECURITY.md**, **CHANGELOG.md**, **CODE_OF_CONDUCT.md**,
  **.github/CODEOWNERS**, PR / Issue templates.
- **docs/operations/SECURITY_HARDENING.md** and
  **docs/operations/DEPLOYMENT.md** describing the v1.14 production posture.

### Changed
- **services/security/encryption.py**: replaced XOR + Base64 obfuscation
  with **Fernet** (AES-128-CBC + HMAC-SHA256). The previous scheme is
  retained as `LegacyXorEncryptor` for one-shot migration only and its
  `encrypt()` is disabled.
- **services/security/payment.py**: removed the silent fall-back to a
  hard-coded `payment_secret`. `PaymentVerifier` now raises
  `PaymentConfigError` if `PAYMENT_SECRET_KEY` is missing or shorter than
  32 chars.
- **services/user_service/app.py**: rewritten on top of Argon2id +
  JWTs. `/api/auth/login` now actually verifies passwords and returns a
  JWT pair; `/api/auth/refresh` rotates refresh tokens and revokes the
  old one; `/api/auth/verify` exposes a token-introspection endpoint for
  the gateway.
- **services/docker-compose.yml**: every credential is sourced from
  `.env`, Postgres + Redis publish through configurable host ports, and
  Redis now requires `--requirepass`. `depends_on` waits on healthchecks.
- **server.py**: CORS now defaults to a tight allow-list (vite dev
  origins) and is configurable via `OPENBLOCK_ALLOWED_ORIGINS`. The
  `/api/db-debug/*` endpoints default to **disabled**; set
  `OPENBLOCK_DB_DEBUG=1` to opt in for local debugging.
- **requirements.txt** + **services/requirements.txt**: pinned versions
  for `argon2-cffi`, `cryptography`, `PyJWT`, `redis`, `structlog`,
  `prometheus-client`, `sentry-sdk[flask]`.

### Security
- **CVE class fixed**: insecure default secret in payment callback
  verification (forgeable callbacks).
- **CVE class fixed**: weak password hashing (sha256, no salt).
- **CVE class fixed**: opaque random tokens replaced with revocable JWTs.
- **CVE class fixed**: wildcard CORS replaced with allow-list.
- **CVE class fixed**: SQLite debug API exposed by default.
- **Hardening**: encryption requires explicit key; in-memory rate limit
  emits a warning so operators notice in multi-replica deployments.
