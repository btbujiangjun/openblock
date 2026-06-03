# 决策派生层架构

> **版本：v1.59.17（2026-05）**
> 适用范围：web 主端 UI 层（DFV / stressMeter / playerInsightPanel / algorithmDynamicsCard / 后续新 UI）
> 文档身份：v1.57.5 6 项 UI 一致性 bug 治理后的"长效解决方案" + v1.59 DFV 决策动态可视化增强 + v1.59.2 左炸裂/右文本重构 + v1.59.3 三项使用修复 + v1.59.4 决策过程可读性深度优化 + v1.59.5 信号节点紧凑布局 + 灵敏度误报治理 + v1.59.6 意图时间线删除 / 灵敏度对替换 / 信号节点撑满 / 右栏无滚动条。
>
> **版本演进**：
> - v1.58.0（架构落地）：派生层 4 模块 + 10 个性质（I1–I10），单点替换 DFV chip override / playerInsightPanel boardFill。
> - v1.58.1（截图 1 治理）：节奏承诺-几何兑现一致性（flow.payoff 拆 ready/waiting + harvestReady 派生 + I11/I12/I12b）。
> - v1.58.2（截图 2 治理）：算法信号-盘面几何反差（struggling emoji + relief.endgame 加 boardFill>=0.45 守卫，新增 concerned 中间档 / endgame.soft 降级 + I13/I13b/I14）。
> - v1.58.3（截图 3 治理）：DFV chip 自描述化 + 跨维度信号冲突可视化（CHIP_DEFS 加 reason 函数 + 4 个信号诊断 chip + conflicts 数组 + I15/I16/I17）。
> - v1.58.4（全系统自查）：6 处残留风险一并修补（relief.hole/boardRisk 几何守卫 + harvest.default 文案改写 + flow.intense/tense 守卫 + 拓展 stressVsBoardFill 冲突 + flow.payoff.waiting 文案去"收获期" + I18/I19/I20/I21）。
> - v1.59.1（DFV 决策动态层首版）：新增 `algorithmDynamicsCard.js` 纯函数库（6 模块 + 39 unit test），DFV 左侧 stage 内嵌一个 dynamics 子区承载 3 个模块。
> - v1.59.2（DFV 整体重构 · 左炸裂/右文本）：DFV 重新定位为"出块算法从信号到决策的动态过程透视面板"——左视觉炸裂 / 右文本聚合双轨。
> - v1.59.3（v1.59.2 三项使用问题修复）：卡片扩容（540→640 / 680→820）+ 4 阶段流程导航 overlay + HUB 不换行 + label 防贴边 + 球状图给 nav 让位。
> - v1.59.4（决策过程可读性深度优化）：信号节点贡献高亮 + 压力归因竖排重做 + 时间线 chip 提亮 + 灵敏度副标题。
> - v1.59.5（信号节点紧凑布局 + 灵敏度误报治理）：信号节点固定 gap 28~36 居中；MIN_N 4→8；WEAK_R=0.30 / STRONG_R=0.50；VAR_FLAT 1e-5 方差守卫；文案柔化。
> - v1.59.6（意图时间线删除 / 灵敏度对替换 / 信号节点撑满 / 右栏无滚动条）：删除 §A 时间线；clearRate⇄stress→clearRate⇄clearG 避 confounder 伪反向；信号节点撑满全高；section 紧凑 + max-height 900 让 7 段默认无滚动。
> - v1.59.7（顶部节点遮挡修复 + 形状权重 3 列）：sigTop 加节点半径预留 + flowNavReserve 28→32；形状权重 2 列→3 列。
> - **v1.59.17（DFV 球状图补全阶段③ 出块：3 chosen shape 末端可视化）**——v1.59.15/16 完成阶段 2（adaptiveSpawn 5 派生）的视觉一致化后，球状图仍止步于"决策意图"，**未呈现算法真正末端**——`blockSpawn.generateDockShapes()` 把派生输出转为玩家实际看到的 3 chosen shape。v1.59.17 按代码事实补全阶段③：
>   1. **顶部 flow-nav 加 `3 出块` 末端步骤**：`1 信号 → 2① 压力 ∥ 2② 策略 ∥ 2③ 目标 ∥ 2④ 调度 ∥ 2⑤ 意图 ▶ 3 出块`，新增 `.dfv-flow-step--spawn` 青绿亮色样式（与派生 5 步视觉区分）
>   2. **几何重排为 6 层 1/8 分布**：stress 1.0/8、5 分量 2.3/8、6 spawnTargets 3.4/8、4 调度 4.4/8、intent 5.5/8、**3 chosen shape 7.0/8**
>   3. **3 chosen shape 节点行**：消费 `insight.spawnDiagnostics.chosen[]`（来自 `getLastSpawnDiagnostics()`，game.js L488 已透传），每节点 category 色 + id 缩写（`_summarizeShapeId` 把 'L_horizontal' / 'rect_2x3' → 'LH' / 'R23'）+ reason 短标签（`SPAWN_REASON_CN` 字典 + `_summarizeReason` 兜底截断 4 字）
>   4. **intent → chosen 实色因果连线**：不同于阶段 2 的虚线（共变·非因果），3 条实色 bezier（base + halo）表达**真因果传递**（intent 是 blockSpawn 的直接输入之一），强度由 `attempt`（0..22）反向驱动 — 算法轻松找到合法组合则边变粗变亮，22 次重试兜底则边变细变暗
>   5. **attempt + solutionRejects badge**：chosen 行右侧 mini 字 `尝试N·拒M`，让用户看见"算法这次为找到合法 3 shape 重试了几次 + 各 9 项 target* 软过滤拒了多少候选"，揭示阶段③ 的"难度"
>   6. **新增常量**：`SHAPE_CATEGORY_COLOR`（7 category 与 STRATEGY/SPAWN_TARGET 色系协调）+ `SPAWN_REASON_CN`（≤4 字中文 reason 字典）
>   7. **新增方法**：`_renderChosenShapes(insight)` + `_renderChosenCausalLinks(attemptNorm)`，dirty check 避免无变化时重渲染
>   8. **完整链路达成**：DFV 球状图现在**端到端覆盖** `信号 → 5 派生 → blockSpawn → 玩家看到的 3 shape` 全链路 6 层 30 节点，与算法实际数据流 1:1 对应。后续 game.js → 玩家放置 → 反馈回 profile 的闭环由右侧 §F 响应灵敏度（皮尔逊相关）承担
>
> - v1.59.16（DFV 球状图统一 5 派生层信号边特效·按 intensity 驱动）——v1.59.15 拓展到 5 派生后用户指出"信号→压力 是实色强化、信号→其他 4 派生是静态弱虚线"视觉不一致，5 派生并列同源应当**视觉等强**。v1.59.16 让 4 派生层（5 分量/6 spawnTargets/4 调度/intent）的派生虚线也按各自节点 intensity（0..1）驱动 opacity（0.18→0.68）与 width（0.7→1.6），与"信号→stress"实色边的强度逻辑同步：
>   1. **新增方法 `_renderDeriveLinks(links, intensity)`**：统一的派生虚线强化函数，按 intensity 线性映射 opacity/width，让 5 派生层视觉一致
>   2. **每个派生节点存自己的 `deriveLinks` 引用**：5 分量 `comp.deriveLinks`、6 spawnTargets `t.deriveLinks`、4 调度 `p.deriveLinks`、intent 复用 `this._intentDeriveLinks`
>   3. **`_renderStressToStrategy` / `_renderSpawnTargets` / `_renderScheduleParams` / `_renderSpawnIntent` 同步驱动**：每个 _render* 在更新节点后调用 `_renderDeriveLinks(deriveLinks, intensity)`
>   4. **intent 强度规则**：`'maintain'`（priority=0 兜底）= 0，明确 intent = 1（"已被规则触发"）
>   5. **效果**：当心流 active 时，6 目标的 novelty 虚线变实变粗；高负荷时，clearGuarantee 虚线显形；多消机会时，multiClearBonus 虚线流光——5 派生层视觉**实时同强响应**信号变化，彻底消除"压力抢戏"
>
> - v1.59.15（DFV 球状图拓展到 adaptiveSpawn 完整对外字段：3 派生 → 5 派生并列）——用户指出 v1.59.14 球状图只覆盖核心 3 派生（stress / 5 hints / intent），缺失 `spawnTargets` 6 维 + 4 调度参数（multiClearBonus/multiLineTarget/perfectClearBoost/iconBonusTarget），未"完整透视算法决策全过程"。v1.59.15 按 `adaptiveSpawn.js` 真实派生函数将球状图扩展为 5 派生层垂直堆叠：
>   1. **新增常量 `SPAWN_TARGET_DEFS` + `SPAWN_TARGET_DRIVER_SIGNALS`**：6 维目标向量（shapeComplexity/solutionSpacePressure/clearOpportunity/spatialPressure/payoffIntensity/novelty），驱动信号按 `deriveSpawnTargets()` L404-432 真实公式映射（如 shapeComplexity ← skill/frust，clearOpportunity ← frust/boardFill）
>   2. **新增常量 `SCHEDULE_PARAM_DEFS` + `SCHEDULE_PARAM_DRIVER_SIGNALS`**：4 调度参数节点，驱动信号按各自 derive 函数真实读取字段映射（multiClearBonus ← `deriveMultiClearBonus(ctx, fill)` 读 boardFill/clearRate，perfectClearBoost ← `deriveDelightTuning(skill, momentum, flow, ...)` 读 skill/flow）
>   3. **几何重排为 5 派生层**：stress（1/7）→ 5 分量（2.5/7）→ 6 spawnTargets（3.7/7）→ 4 调度（4.7/7）→ intent（6/7），5 层都对齐 centerX 并列排布，明示「五者并列同源自信号集」
>   4. **顶部 flow-nav 拓展为 5 步**：`1 信号 → 2① 压力 ∥ 2② 策略 ∥ 2③ 目标 ∥ 2④ 调度 ∥ 2⑤ 意图`，新增 `--target`（绿）/`--schedule`（黄）两类样式
>   5. **派生依赖虚线 + spawn pulse flash**：每个新节点都按其 driver 信号画弱虚线（与 v1.59.13 同视觉语言：1px、dasharray '2 3'、节点同色），spawn 时随 `_hintDeriveLinks` 一起闪烁
>   6. **新增 `_renderSpawnTargets` / `_renderScheduleParams`**：value 实时更新、fill-opacity 由强度（0..1）线性映射 0.5..1.0、glow 半径随强度微胀
>   7. **节点尺寸 r=10**（mini）：与 5 核心分量 r=15 形成视觉层级，27 节点（10 信号+1 stress+5 分量+6 targets+4 调度+1 intent）总密度可读
>   8. **完整性达成**：DFV 球状图现已覆盖 `adaptiveSpawn` `spawnHints` 全部主要对外字段（5 核心 + 6 spawnTargets + 4 调度 + intent = 16 字段），加上 stress 球本身（_adaptiveStress），共 17 字段，相对原 7 字段拓展 +143%。其余 9 项 target* 难度区间 + winback/farExtreme 元信息保留在右侧详情面板（球状图不再扩展，避免视觉过载）
>
> - v1.59.14（DFV 球状图删除"压力→意图"残留粒子流·按代码事实修正 spawn 动效）——用户反馈截图发现 spawn 时仍有"压力球→意图球"的粒子流（v1.51.6 时代"压力→意图串联"叙事的遗留），与"3 派生并列同源"代码事实严重不符（intentResolver INTENT_RULES：relief 100/harvest 80/flow 50 等 guard **完全不读 stress**，pressure/sprint 把 stress 当 guard 阈值数值判断而非因果传递）。v1.59.14 三项修正：
>   1. **彻底删除 `_triggerSpawnPulse` L1601-1620 段"stress→intent" 5 颗粒子流**
>   2. **新增 `_triggerIntentDeriveFlash`**：spawn 时让"信号→5分量"+ "信号→intent"派生虚线短暂高亮（stroke-opacity 0.22→0.78、stroke-width 0.8→1.6、520ms 后回弹）——与"信号→stress"实色粒子流形成"3 派生从信号集同步派生"的对称视觉表达
>   3. **新增 `_hintDeriveLinks` / `_intentDeriveLinks` SVG ref 数组**：buildScene 时收集派生虚线节点，spawn pulse 时同步闪烁
>   4. **效果**：spawn 一次 = 信号集同时向 3 派生输出粒子/闪烁，再无"压力球先变 → 粒子流向意图 → 意图变更"的串联错觉，视觉与"adaptiveSpawn 单次调用并列产出 stress/5 向量/intent"代码事实一致
>
> - v1.59.13（DFV 球状图补画"信号→5分量"+"信号→意图"派生依赖虚线·按代码事实修正）——v1.59.12 把"压力→分量→意图"串联连线全删后，5 分量与意图球**视觉孤立**，看不出它们"也是从信号集派生"，与"3 派生并列同源自信号集"描述不符。v1.59.13 按代码事实补画两套派生依赖虚线：
>   1. **新增常量 `HINT_DRIVER_SIGNALS`**：每个 spawnHints 分量的主驱动信号集合，按 adaptiveSpawn.js L1706-2130 + L445-475 实际读取的 ctx/profile 字段映射（如 clearGuarantee ← frust/momentum/missRate/load，comboChain ← combo/skill/momentum）。每个 (hint, signal) 对都对应至少一条 if-branch 同时读取信号字段并改写 hint
>   2. **新增常量 `INTENT_DRIVER_SIGNALS`**：spawnIntent 的主驱动信号集合，按 intentResolver.js INTENT_RULES guard 实际读取的字段映射（relief←frust / harvest←boardFill / flow←flow / sprint/pressure←stress自身派生跳过 / 简化为 5 路 frust·boardFill·flow·session·momentum）
>   3. **可视化**：每个分量节点 + 意图节点，向其 driver 信号画 1px 弱虚线（stroke-opacity 0.22、dasharray '2 3'、节点同色），用 `svg.insertBefore` 放最底层不抢戏。与"信号→stress"实色加压/救济边形成视觉对比：**实色 = 量化贡献（stressBreakdown）、虚色 = 派生依赖（hint/intent 由该信号路径生成）**
>   4. **代码事实约束**：HINT_DRIVER_SIGNALS / INTENT_DRIVER_SIGNALS 每个映射关系都引用源码行号，新增 hint 或 intent rule 时必须同步更新映射
>   5. **视觉效果**：3 派生节点都从左侧信号集扇形发散——压力球用粗实色边量化"谁加压了多少"，5 分量 + 意图用弱虚线暗示"由哪些信号派生而来"，**真实反映"adaptiveSpawn 单次调用产出 stress / 5 向量 / intent 三者并列、都从信号集派生"的代码事实**
>
> - v1.59.12（DFV 球状图几何彻底重排：图像层修正，不再靠文字解释）——v1.59.11 用 i18n + 虚线 + 脚部 hint 试图"用文字告诉用户这是并列"，但用户反馈"核心不是文字，图像表达是关键"——视觉布局本身仍是 U 型流水线（stress 右上 / 5 分量中 / intent 底），无论文字怎么改、连线怎么虚化都仍像因果传递。v1.59.12 三项**视觉层根治**：
>   1. **几何重排·3 派生节点垂直三等分**：在 sigTop..sigBottom 区间内派生节点按 1/6 · 3/6 · 5/6 高度比定位——stress 上、5 分量中、intent 下，三者**等大小、等间距、x 锚定同列**，视觉上形成"3 个等距并列派生兄弟"的几何关系，杜绝"U 型 / 上→中→下因果链"的形态误读
>   2. **删除中央纵轴 trunk + out + inbound 连线**：v1.59.11 把这些线虚化（stroke-dasharray '3 3'），但**物理画了线就仍然误导**——`adaptiveSpawn` 单次调用产出 stress / 5 向量 / intent 是并列输出（intentResolver 不读 5 向量、clearGuarantee 不读 stress），它们之间**根本不该有连线**。v1.59.12 彻底删除 SVG 元素，`_strategyLinkEl.trunk = null` + `comp.out/inbound = null`，下游渲染加 null-safe 守卫
>   3. **删除 `_triggerStrategyArc` 的 "分量→intent" 粒子流**：旧版 spawn 时高位分量向 intent 球喷射粒子，视觉上像"分量驱动 intent"。v1.59.12 删除该粒子流，只保留分量节点周围本地扩散（表达"该分量本帧高位"）
>   4. **视觉效果**：左侧 10 信号 → 右侧 3 派生（压力球·5 分量·意图球，垂直等距并列），3 派生之间**完全无视觉关联**，只各自从左侧信号集扇形发散。图像层第一次忠于源码事实，杜绝"压力→分量→意图"串联误读
>
> - v1.59.11（DFV 球状图按源码事实修正：从"压力→策略→意图串行链"改为"信号→3 并列派生"）——用户深度提问"压力与 5 向量、5 向量与 intent 的关系"，源码审视后发现 v1.59.3 以来的视觉叙事**与源码事实不符**：
>   1. **源码事实**：`adaptiveSpawn(profile, ctx, ...)` 单次调用同时产出 3 个**并列输出（兄弟节点）**：
>      - **派生①** `insight.stress` ← stressBreakdown 12+ 分量加权 + normalize
>      - **派生②** `insight.spawnHints` 5 向量 ← 30+ 条 Math.max/min 独立路径并发累加，**全文不读 stress**
>      - **派生③** `insight.spawnHints.spawnIntent` ← `resolveIntent()` 7 规则按优先级，guard 只读 `playerDistress/forceReliefIntent/afkEngageActive/challengeBoost/delightMode/rhythmPhase/stress/sprintCfg/geometry`，**全文不读 5 向量**
>      - 三者彼此**无直接因果传递**，统计上共变源于"共同底层信号集"（如 R10 截图 `harvest + clearG=2 + stress=0.36` 共同源自 `nearFullLines≥2` 几何信号）
>   2. **DFV 视觉误导**：v1.59.3 的 flow-nav `1 信号 → 2 压力 → 3 策略 → 4 意图` 用 `▶` 串联 4 步，stage 内 stress→5分量→intent 用实线连接——视觉上像因果传递链，但源码上是 3 个并列派生的共时快照
>   3. **修正措施（4 项 + i18n）**：
>      - **flow-nav 重映射**：4 步序号改为 `1 信号 → 2① 压力 ∥ 2② 策略 ∥ 2③ 意图`，3 个派生用 `∥` 分隔表达并列同源；新增 `.dfv-flow-parallel` CSS 类，hover 显示"并列同源·彼此无因果传递"
>      - **step__num 药丸化**：原 13×13 圆形 → `min-width:16px + padding:0 3px` 药丸形，容纳"2①/2②/2③"两字符序号
>      - **球状图纵轴连线虚化**：`trunkBase` + `outBase` + `inBase` 全部 `stroke-dasharray: '3 3'`、opacity 微降，新增 CSS class `.dfv-strategy-link--covary` 作语义标识。halo/flow 流光层保持实线（承接 spawn 脉冲的决策事件叙事）
>      - **脚部图例新增 covary hint**：`虚线=派生共变·非因果` 一句话说明 + 完整 tooltip 解释纵轴语义
>      - **i18n step tip 重写**：4 个 tip 文案按源码事实重写，标注源码位置（`adaptiveSpawn.js` / `intentResolver.js`），明确"不读 stress"/"不读 5 向量"
>   4. **价值**：DFV 从"漂亮的视觉叙事编排"升级为"忠于源码的算法决策结构镜像"——杜绝用户误读为"因果传递链"，让"3 个并列派生+共时共变"的真实算法架构在 UI 层可读
>
> - v1.59.10（响应灵敏度配对全重做：从"伪反向修复"升级为"机制纯净度优先"）——R15 截图实测 3 对全部异常（`clearRate⇄clearG r=+0.50 ⚠ 反向`、`missRate⇄clearG r=— 玩家这项无变化`、`momentum⇄救济 r=— 算法这项无调整`），系统排查发现**v1.59.6/9 只在做局部"伪反向修复"，没有从机制层面审视"算法响应变量是否真的由该玩家信号驱动"**：
>   1. **根因·v1.59.6/9 配对的系统性缺陷**：
>      - `clearRate⇄clearG`：`clearGuarantee` 是 `adaptiveSpawn.js` 里由 30+ 条 `Math.max` 路径累加的聚合输出，**代码中没有任何路径直接读 `metrics.clearRate`**。clearRate↑ 时 score/combo 共变让 milestone/comboChain 通道间接抬高 clearG = 与 momentum⇄stress 同类的 confounder 伪反向
>      - `missRate⇄clearG`：高玩家段 missRate=0 持续整窗口 → 方差守卫触发 = 99% 时间无数据；clearG 与 missRate 也只通过 frust/needsRecovery 间接关联，机制不纯
>      - `momentum⇄救济`：peak/early 阶段救济通道恒为 0（仅 cooldown/late 触发）→ 99% 时间无数据
>   2. **修复·机制纯净度优先 3 对重做**：审视 `adaptiveSpawn.js` 所有 `stressBreakdown` 分量的驱动方程，**仅 3 个分量是单一玩家信号的纯响应**（无 score 共变、无聚合累加）：
>      | 配对 | expected | 算法响应分量 | 源码位置 | 驱动方程 |
>      |------|----------|-------------|----------|---------|
>      | `skill ⇄ skillAdjust` | **pos** | `stressBreakdown.skillAdjust` | L951 | `(skill - 0.5) × 0.3 × confGate` 全线性 |
>      | `frust ⇄ frustRelief` | **neg** | `stressBreakdown.frustrationRelief` | L974 | `frust ≥ 4 → -0.18` 阈值阶跃 |
>      | `momentum ⇄ 救济` | **pos** | `sessionArcAdjust + endSessionDistress` | L1000-1015 | `momentum < -0.2 → 减压` 阈值阶跃（保留 v1.59.9） |
>   3. **机制最纯的 `skillAdjust`**：唯一全线性纯响应分量，输出 = `(skill-0.5)×0.3×confGate`，无任何 score/clearRate 共变干扰；玩家 skill 从 ability 模型派生，演化较慢但有变化 → 灵敏度卡新主轴。系统设计意图（"算法对高手加压、对新手减压"）可以被 Pearson 直接验证
>   4. **价值升级**：v1.59.6/9 修了"红警"但留下"无数据"和"机制不纯"的剩余问题；v1.59.10 把视角从"统计修补"上升到"机制审视"——配对组成为**算法设计意图的真实诊断仪**，而非"任何 spawnHints 输出 + 任何玩家信号 = 一对"的拼凑
>
> - v1.59.9（momentum ⇄ stress 红警根治：替换为 momentum ⇄ 救济）——R12 截图实测 `momentum ⇄ stress r=-0.68 ⚠ 反向，请查算法`，深度排查后确认是 v1.59.6 治理同根因的 confounder 伪反向，**非算法 bug**：
>   1. **算法实际机制**：`adaptiveSpawn.js` 全文 momentum→stress 的因果路径只有 2 条（`sessionArcAdjust` 在 cooldown+momentum<-0.2 时减压、`endSessionDistress` 在 late+momentum≤-0.30 时减压），**且都是阈值触发型减压**——momentum≥-0.2 时算法对 momentum 完全无响应。`expected=pos` 的"动量↑→stress↑"假设本身就与算法实际机制不符
>   2. **r=-0.68 反向成因**：`stress` 主体由 `scoreStress` 等开环成分驱动（与 v1.59.6 治理 `clearRate ⇄ stress` 同根因）；R12 截图窗口中 score 累加让 `scoreStress↑→stress 主体↑`，而 `momentum` 是 throughput/nearMiss 短期合成在 ±0.4 区间震荡，Pearson 把"stress 单调↑ vs momentum 震荡末段下降"算出 r=-0.68 = 经典 confounder 伪反向（辛普森悖论）
>   3. **修复**：把 `momentum ⇄ stress` 替换为 **`momentum ⇄ 救济`**——响应变量改为 `stressBreakdown.sessionArcAdjust + stressBreakdown.endSessionDistress`（adaptiveSpawn.js L998-1016 的 momentum **纯响应通道**，去除所有 confounder）。expected=pos：momentum↑→救济通道值接近 0；momentum↓（强负）→救济通道更负（同向）
>   4. **副效应**：正动量 / 弱负 momentum 段救济通道恒为 0，触发"算法这项无调整"文案——这是**正确诊断**（算法本来就只在 momentum<-0.2 才响应），不再被强行解读为"反向"。配对组终态：① `clearRate ⇄ clearG` ② `missRate ⇄ clearG` ③ `momentum ⇄ 救济`，3 对全部去除了 stress 主体共变 confounder
>
> - v1.59.8（节点身份色 / 灵敏度文案口语化 / sparkline 动效增强）——针对用户反馈"加载时和过程中保持初始化且维持彩色；响应灵敏度看不明白；底部线条动效太弱"：
>   1. **节点身份色 baseColor 策略**：v1.59.7 前节点初始 fill=`#1e293b`（深灰）+ stroke=`#475569`，无数据时全部退化为灰，看不出"这是哪个信号"。v1.59.8 给 SIGNAL_NODES 10 项每项加 `baseColor`（技能=金黄 / 动量=橙 / 挫败=红 / 心流=绿 / 阶段=蓝 / 负荷=紫 / 消行率=翠绿 / 占盘=青 / 连击=粉 / 失放率=朱红），intent 节点身份色=`#a78bfa`（maintain 紫）。**核心 fill 始终 = baseColor 不变身份**，强度由 `fill-opacity` 驱动（0.55..1.0）；idle（无数据/加载初）由 CSS 类 `.dfv-node--idle` 限 opacity 0.35 + 1.8s 缓慢呼吸（"待机但活着"），永不退化为灰
>   2. **响应灵敏度 verdict 文案口语化（6 档统一为短句 + 符号）**：旧文案"信号稳定，无法测算" / "反向倾向 r=0.30（弱信号，多为窗口噪声/上游共变）"过于统计学术化，玩家/策划秒看不懂。新文案：
>      - ⏳ `数据攒中 N/8`              样本不足
>      - · `玩家这项无变化`             玩家方差≈0
>      - · `算法这项无调整`             算法方差≈0
>      - · `关联弱（迟钝）`             |r| < 0.30
>      - ✓ `方向对（弱 r=0.35）`        弱档方向匹配
>      - ~ `方向反（弱 r=−0.35，多为噪声）`  弱档反向（中性，不报红）
>      - ✓✓ `灵敏 r=0.62`              强档方向匹配
>      - ⚠ `反向 r=0.62，请查算法`     强档反向（唯一红警档）
>   3. **底部 sparkline 动效增强**：旧 sparkline 仅一条 stroke-width=1.4 折线，玩家感知不到"实时变化"。v1.59.8 三层升级：① stroke 1.4→1.8 加粗；② 新增 `.dfv-spark-fill` 半透明趋势带（fill-opacity 0.14 + 线下闭合 path）让"趋势"可视；③ 新增 `.dfv-spark-dot` 末点 pulsing 圆点跟随最新采样位置，CSS `dfvSparkDotPulse` 1.1s 缩放呼吸动画 + `drop-shadow` 让"最新数据点"持续可见 — idle（无数据）时 cx=-9 隐藏 + 弱化呼吸
>   1. **§A 意图时间线·彻底删除**：n 帧 chip 链信息密度低（切换次数右栏"出块意图"段已统计 + 当前 intent 决策标志已可读），占用右栏 ~30px 垂直空间挤压其他段。`_renderDynamicsLayer` 不再调用 `renderIntentTimeline`；副标题"时间线·归因·灵敏度"→"归因·灵敏度"。模块本身保留（其他面板可复用）
>   2. **§C 响应灵敏度·配对结构性纠错**（v1.59.5 治理统计阈值后剩余的"指标选择"问题）——
>      - 根因：`stress` 内含 `scoreStress` 等**开环成分**（score↑ 直接抬 stress，与玩家是否动态变化无关），而 `clearRate` 又与玩家 score/skill 共变。两者因 score 这个**共同潜变量**呈现正相关 = 经典 **confounder 伪反向（辛普森悖论）**，并非"算法响应反向"——实战中 R10 截图就出"反向 r=0.55，建议查算法"误报
>      - 修复·**clearRate ⇄ stress → clearRate ⇄ clearGuarantee**：与 `missRate ⇄ clearG` 对称，分别从"消行成功"与"消行失败"两侧衡量算法对玩家消行表现的响应——`clearGuarantee` 是 spawnHints 直接输出，无开环成分，方向纯净
>      - 配对组终态：① `clearRate ⇄ clearG`（expected=neg）② `missRate ⇄ clearG`（expected=pos）③ `momentum ⇄ stress`（expected=pos）
>   3. **左侧·信号节点撑满全高**：v1.59.5 固定 gap=28~36 中心对齐让 R10 截图 stage 下方大量空白；v1.59.6 改回"sigSpan/9 撑满全高 + gap 上限 80px 防极端窄高"——leftN=10 节点平均铺满 `sigTop..sigBottom` 整列，与中央压力球/意图球并行覆盖整 stage 高度
>   4. **右侧·默认无滚动条**：§A 删除让右栏总高 ~减 30px；进一步紧凑 section（padding 3-6-4 → 2-5-3 / title margin 0-0-2 → 0-0-1 / details gap 3 → 2）；card max-height 820 → min(92vh, 900px) — 7 段 details 在主流分辨率（≥900px 高）下默认完整放下，绝不触发滚动
>
> **当前统计**：派生层 79 单元测试 + 23 性质（I1–I21）+ algorithmDynamicsCard 41 单元测试 = 143 锁定，全量 1850 测试 0 回归。

---

## §-1 v1.59.6 — 意图时间线删除 / 灵敏度对替换 / 信号节点撑满 / 右栏无滚动条

### §-1.1 触发动机（用户反馈 4 条）

R10 截图（10 帧窗口）实测后用户提出 4 个问题：

1. **意图时间线无意义，删除**——10 帧 chip 链信息密度低
2. **排查红色反向信息**——`clearRate ⇄ stress r=0.55 反向（强信号，建议查算法）` 是否真算法 bug
3. **左侧过于紧凑，空间利用率低，自适应填充满面板（无遮挡）**——v1.59.5 中心对齐让 stage 下方大量空白
4. **右侧信息适度紧凑布局，默认不出现滚动条**——R10 截图右侧 7 段总高超出 v1.59.3 max-height 820px

### §-1.2 §A 意图时间线·删除

**保留 vs 删除决策**：

| 维度 | 评估 |
|------|------|
| 信息独占性 | 否——切换次数已在右栏"出块意图"段统计；当前 intent 在"决策标志/出块意图"双显 |
| 时间维度价值 | 低——10 帧 chip 链人眼难总结趋势；切换原因（boundary/throttle）已折叠为右上 `切换 N 次` |
| 占用成本 | 高——~30px 垂直空间挤压"调度提示/形状权重/出块目标"易触发滚动 |
| 替代方案 | 右栏"出块意图 + 决策标志"已覆盖；后续如需历史趋势可加 sparkline（非 chip 链） |

**结论**：删除 — 实施 `_renderDynamicsLayer` 不再调用 `renderIntentTimeline`，副标题"时间线 · 归因 · 灵敏度" → "归因 · 灵敏度"。模块 `renderIntentTimeline` 自身保留（pure 函数，其他面板可复用，38 unit test 不动）。

### §-1.3 §C 响应灵敏度·配对结构性纠错（v1.59.5 治理后剩余的"指标选择"问题）

#### §-1.3.1 误报根因——confounder 伪反向（辛普森悖论）

R10 截图 `clearRate ⇄ stress r=0.55 反向（强信号，建议查算法）` —— `|r|=0.55 ≥ STRONG_R=0.50` 通过 v1.59.5 阈值，n=10 ≥ MIN_N=8 通过样本量守卫，方差也足够。**统计层面无误**，但**指标对选择有结构性缺陷**：

```
score（潜变量）
   ├─→ scoreStress 分量 ──→ 算法 stress↑（开环响应 score）
   └─→ skill 间接 ──→ 玩家 clearRate↑
```

两条路径都驱动 `clearRate↑ ⇒ stress↑` 正相关，但**算法并非在响应玩家 clearRate**，而是在响应 `score` 的累加；玩家 `clearRate` 升高是因为 skill 跟着 score 一起涨。这是典型 **confounder**（混淆变量 = score）导致的**伪反向**——`expected=neg` 时检测到正相关，被报"算法响应反向"，但实际算法根本没在响应这条玩家信号。

#### §-1.3.2 修复·配对替换

`clearRate ⇄ stress` → `clearRate ⇄ clearGuarantee`：

| 旧对 | 问题 | 新对 | 优势 |
|------|------|------|------|
| `clearRate ⇄ stress`（expected=neg）| stress 含 scoreStress 开环；clearRate 与 score 共变 → 伪反向 | `clearRate ⇄ clearG`（expected=neg）| `clearGuarantee` 是 spawnHints 直接输出，闭环响应玩家消行率，与 `missRate ⇄ clearG` 对称 |

配对组终态（3 对）：

```
clearRate ⇄ clearG    expected=neg   玩家消行率↑ → 算法保消档↓（消行好不用救济）
missRate ⇄ clearG     expected=pos   玩家失误↑   → 算法保消档↑（失误多上救济）
momentum ⇄ stress     expected=pos   玩家动量↑   → 算法 stress↑（节奏强加压）
```

`momentum ⇄ stress` 保留：`momentum` 不与 score 直接共变（是 throughput/timing 派生），confounder 风险低。

### §-1.4 左侧·信号节点撑满全高

```js
// v1.59.5 → v1.59.6 关键改动
const sigGap = Math.min(80, sigSpanRaw / Math.max(1, leftN - 1));
const sigUsedH = sigGap * (leftN - 1);
const sigBaseY = sigTop + ((sigBottom - sigTop) - sigUsedH) / 2;
```

- v1.59.5 固定 gap=28~36 + 中心对齐 H/2 → 在常见 H≈700 stage 下 leftN=10 占用 288px 仅居中 41% 高度，上下大量留白
- v1.59.6 改回 `sigSpan/9` 撑满 + 上限 80px 防极端窄高（如折叠态 H<300）下间距过大
- 结果：10 节点平均铺满 `sigTop..sigBottom` 整列空间，视觉上与中央压力球/意图球并行覆盖整 stage 高度

### §-1.5 右侧·默认无滚动条

7 段（决策动态 + 出块意图 + 压力贡献 + 决策标志 + 形状权重 + 出块目标 + 调度提示）紧凑化策略：

| 项 | v1.59.5 | v1.59.6 | Δ |
|----|---------|---------|---|
| §A 意图时间线 | 存在（~30px） | 删除 | -30px |
| `.dfv-section` padding | 3px 6px 4px | 2px 5px 3px | -2px/段 × 6 = -12px |
| `.dfv-sec-title` margin-bottom | 2px | 1px | -1px/段 × 7 = -7px |
| `.dfv-details` gap | 3px | 2px | -1px × 6 = -6px |
| card max-height | min(88vh, 820px) | min(92vh, 900px) | +80px 上限 |
| 总效益 | — | — | **~133px 可用空间** |

主流分辨率（≥900px 高度）下 7 段在 max-height 900 内**完整放下**，scrollbar 仅在折叠态/极矮窗触发。`.dfv-details::-webkit-scrollbar` 宽度 4px → 3px 进一步弱化。

### §-1.6 质量门

| 项 | 状态 |
|----|------|
| algorithmDynamicsCard 单元测试 | 41 / 41 通过（含改名后的 clearRate ⇄ clearG 用例） |
| 派生层单元 + 性质 | 79 + 23 / 全通过 |
| 全量 vitest | 1850 / 1850 通过 |
| eslint | 0 错误 0 警告 |

---

## §0 v1.59.2 — DFV 整体重构：左视觉炸裂 / 右文本聚合

### §0.1 触发动机

v1.59.1 把决策动态 3 模块嵌进了左侧 `.dfv-stage` 下半区（`.dfv-stage-dynamics`），但实际使用发现两个问题：

1. **左栏视觉混乱**：球状图（图形动态）+ 三个 adc-* 紧凑模块（细密文本/堆叠条/灵敏度三灯）共享有限高度，球状图被压缩 + 下半区文字过密
2. **左右职责模糊**：左栏既有图形又有文本，右栏只有文本，没有形成"视觉/文本"的清晰分工

v1.59.2 重新定位 DFV："**整面板透视出块算法从信号到决策的动态过程**"，落到具体形态——

- **左栏（视觉）**：纯视觉表演，"炸裂样式"承载算法的"瞬时事件"（spawn 震波、stress 高压脉动、辐射粒子）+ "持续场感"（背景能量场呼吸/旋转）
- **右栏（文本）**：所有 chip / 数值 / 列表 / 时间线 / 归因 / 灵敏度等"可读信息"集中聚合

### §0.2 重构边界

- **HTML 结构调整**：
  - `.dfv-stage` 取消上下双区嵌套，**球状图重新独占整个 stage**（恢复 v1.58 之前的单层结构 + 加 `.dfv-stage-aura` / `.dfv-stage-shock` 两个炸裂层）
  - `.dfv-details` 顶部新增 `.dfv-section--dynamics` 区段，承载 `#dfv-dynamics-host`，依然 import 同样 3 个 adc-* 模块
- **CSS 调整**：
  - `.dfv-body` grid `1fr|220px → 1fr|260px`：右栏 +40px 承载新区段
  - `.dfv-stage` 加炸裂效果：`background` 三层径向渐变 + `.dfv-stage-aura` conic 渐变缓慢旋转 + breath 呼吸动画 + `.dfv-stage-shock` 单次径向震波 keyframe + `.dfv-stage--high-stress` 边缘红光脉动 keyframe
- **JS 调整**：
  - `_dynamicsHost` query 从 `#dfv-stage-dynamics` 改为 `#dfv-dynamics-host`（右栏内部）
  - `ResizeObserver` 监听对象从 `#dfv-stage-canvas` 改回 `#dfv-stage`（球状图重新独占）
  - `_triggerSpawnPulse` 末尾追加：toggle `.dfv-stage--shock` 触发一次震波动画 + 从 stress 球放射 8 颗短寿命爆裂粒子
  - `_renderStressBall` 末尾差分 toggle `.dfv-stage--high-stress`（sm > 0.72 时，与 stressMeter 阈值同源）
- **3 个 DFV 集成模块不变**：复用 `algorithmDynamicsCard.js` export 的 `renderIntentTimeline` / `renderStressBreakdownStack` / `renderResponseSensitivityCard`
- **`algorithmDynamicsCard.js` 完全不动**（纯函数库，输出 HTML 字符串）
- **数据采集**：`_appendLiveInsightSample` `dockCategories` 字段保留（v1.59 已加）
- **playerInsightPanel 完全不动**

### §0.3 集成到 DFV 的 3 个子模块

| 模块                              | 球状图缺失维度补充                                                                    | 数据源                                                              |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| §B `renderIntentTimeline`       | **时间维度**——最近 18 轮 spawnIntent chip 链（按 spawnRound 聚合）；切换点黄色高亮 + hover 看切换原因 + 切换次数统计 + stress mini bar | `game._insightLiveHistory`                                       |
| §C `renderStressBreakdownStack` | **分量归因**——17+ 项 stress 分量水平左负-右正堆叠 + sum_pos/\|sum_neg\|/net 三标签 + net≠stress 时提示 clamp/平滑/封顶被踩到 | `insight.stressBreakdown` + `summarizeContributors`              |
| §F `renderResponseSensitivityCard` | **响应灵敏度**——3 对玩家信号 ⇄ 算法响应 Pearson r 粗估（clearRate⇄stress / missRate⇄clearG / momentum⇄stress） + 方向期望对比（灵敏 / 迟钝 / 反向） | `history[*].metrics` + `history[*].adaptive`                    |

### §0.4 algorithmDynamicsCard.js 完整 6 模块

虽然 DFV 当前只集成 3 个，但纯函数库完整 export 了 6 个模块 + 39 unit test 覆盖。剩余 3 个作为 v2 候选（独立诊断面板 / RL 训练 dashboard / panel 二次重构等场景可复用）：

| 模块                                | 解决的 insight                                                          | 状态 |
| --------------------------------- | -------------------------------------------------------------------- | --- |
| §A `renderDecisionSnapshotCard`   | "当前帧算法在做什么"：intent + spawnSource + 节奏/弧线 + delight + PB 触发器 + 上游诊断 chip + stress bar | v2 候选 |
| §B `renderIntentTimeline`         | 算法 N 轮意图节奏时间线                                                        | ✓ DFV 集成 |
| §C `renderStressBreakdownStack`   | stress 分量正负堆叠                                                         | ✓ DFV 集成 |
| §D `renderDecisionReasoningCard`  | resolveIntent 全 trace + 每个非默认 hint 字段← 驱动源 + v1.58.3 conflicts        | v2 候选 |
| §E `renderShapeWeightsDrift`      | shapeWeights 算法承诺 vs 实际接收偏差柱                                          | v2 候选 |
| §F `renderResponseSensitivityCard` | 算法响应灵敏度 Pearson r 粗估                                                  | ✓ DFV 集成 |

### §0.5 设计原则

1. **左视觉 / 右文本职责清晰**：左栏负责"瞬时事件 + 持续场感"（炸裂样式 + 背景能量场 + 球状图），右栏负责"可读信息"（chip / 数值 / 时间线 / 归因 / 灵敏度）；不再混杂
2. **纯函数渲染**：3 个 adc-* 模块输入 model、输出 HTML string；DOM 挂载交给消费方（DFV `#dfv-dynamics-host` / 未来其他 UI）
3. **派生层 SSOT 单向流**：所有 chip 颜色 / intent label / conflict 检测都走派生层 export（`SPAWN_INTENT_COLOR` / `deriveChipsFromCtx` / `deriveConflicts` / `resolveIntent`），绝不复刻判断逻辑
4. **降级安全**：每个模块都有 empty path（空 insight / 空 history / 样本不足 / 方差为 0），不抛错
5. **炸裂效果阈值同源**：`.dfv-stage--high-stress` 触发阈值 `stress > 0.72` 与 stressMeter 高位提示同源，避免视觉冲突；`.dfv-stage--shock` 仅在 `_triggerSpawnPulse`（即真实 spawn 事件）触发，绝不假事件

### §0.6 价值

- **左栏炸裂感**：spawn 时全栏震波 + 8 颗辐射粒子，让"算法刚做出一次决策"具有视觉冲击；高压时边缘红光脉动 + 背景能量场呼吸/旋转，让"算法持续运转"成为持续感知
- **右栏信息密度**：所有文本/数值/灵敏度集中聚合，从顶到底"决策动态 → 出块意图 → 压力贡献 → 决策标志 → 形状权重 → 出块目标 → 调度提示"7 段式阅读节奏，符合"决策因果 → 决策内容"的认知顺序
- **意图节奏审计**：右栏决策动态首段即可看到最近 18 轮意图节奏指纹（切换频率 / 平均 stress）
- **stress 因果归因**：堆叠条让"哪个分量在加压 / 哪个在救济"零认知成本可读
- **响应灵敏度量化**：Pearson r 第一次量化"算法是否在跟着玩家变"，方向反向 = 算法 bug 信号
- **球状图回归独占**：取消嵌套压缩，球状图节点排布更舒展，stress 球 / 意图六边形 / 5 个策略节点的相对位置回归 v1.58 之前的可读性

### §0.7 关键文件索引

- 纯函数库：`web/src/algorithmDynamicsCard.js`
- DFV 集成：`web/src/decisionFlowViz.js`
  - `_build()` HTML 模板：左栏 `.dfv-stage`（含 `.dfv-stage-aura` / `.dfv-stage-shock` / `.dfv-flow-nav` 4-step 流程导航） + 右栏 `.dfv-section--dynamics`
  - `_buildScene()`：`signalX = max(58, W*0.20)` + 顶部 28px `flowNavReserve` 给 nav 让位
  - `_renderDynamicsLayer()` 写入 `#dfv-dynamics-host`
  - `_triggerSpawnPulse()` 末尾 toggle `.dfv-stage--shock` + 放射 8 颗爆裂粒子（连带 nav 一次 pulse）
  - `_renderStressBall()` 末尾 toggle `.dfv-stage--high-stress`（连带 step 2 持续提亮）
  - `_injectStyles()` CSS：`.dfv-stage` 炸裂效果 + `.dfv-flow-nav` 4-step pipeline + `.dfv-dynamics-host` 紧凑节奏（含 `.adc-stack-seg` 单行覆盖）
  - `.dfv-card` 默认 width 640px / max-height min(88vh, 820px)
- 数据采集：`web/src/playerInsightPanel.js` `_appendLiveInsightSample` 保留 `dockCategories`
- 通用样式：`web/public/styles/main.css` 文件末尾 `.adc-*` 通用色/布局
- i18n：`web/src/i18n/locales/{en,zh-CN}.js`
  - `dfv.sec.dynamics(Sub)`
  - `dfv.flowNav.aria` / `dfv.flowStep.{signal,stress,strategy,intent}` + 对应 `*Tip`（hover 详解）
- 测试：`tests/algorithmDynamicsCard.test.js`（39 unit test 覆盖 6 模块 × 3 类边界 + Pearson 纯函数）

---

## 一、为什么需要派生层

### 1.1 v1.57.5 之前的痛点

v1.57.5 的 6 项 UI 一致性 bug（占盘双显 / 盘面通透撒谎 / chip 高亮但被覆盖 / 笑脸 vs 紧盘面）**根因都是同一个**：

> **同一指标有 N 个 cache，更新触发器各不相同，UI 各拿各的。**

举例：

- `boardFill` 在 3 处存在：`game.grid.getFillRatio()`（实时） / `_lastAdaptiveInsight.boardFill`（上次 spawn 快照） / `spawnDiagnostics.layer1.fill`（v1.57.4 实时刷新）
- DFV 节点读其中一个，sparkline 读另一个，playerInsightPanel 读第三个
- 同一帧出现"占盘 0.40 / 0.69"双显

每次发现就单点修：v1.57.5 §A 给 DFV fingerprint 加 `liveBoardFill`，§B 给 friendly 文案加 `fill<0.5` 守卫，§G 给 emoji 加 `crowded` 变体……**6 个 bug 修 6 处**，下次还会再爆。

类比代码味道：这是典型的 **"散弹枪手术（Shotgun Surgery）"** + **"特性嫉妒（Feature Envy）"** 双层异味——UI 层在嫉妒 game 内部字段，又把同一逻辑散播到多处。

### 1.2 v1.58 的解决思路

**收口"算法层 → UI 层"之间的派生过程**，让 UI 只读一个 **PresentationModel**：

```
┌────────────────┐   ┌─────────────────────────────┐   ┌────────────┐
│  算法层         │   │      derivation/             │   │  UI 层      │
│  (adaptive-    │ → │  (SSOT + Resolver + Contract │ → │ (DFV /     │
│   Spawn /       │   │   + Reducer)                 │   │  stress    │
│   stress 链)    │   │                              │   │  Meter /   │
└────────────────┘   └─────────────────────────────┘   │  panel)     │
       原始信号           PresentationModel              └────────────┘
                       (唯一消费源 + trace)
```

**4 个子模块各司其职**：

| 模块                       | 职责                                                                    | 解决的痛点              |
| ------------------------ | --------------------------------------------------------------------- | ------------------ |
| `selectors.js`           | SSOT。封装 `game.grid` / `_lastAdaptiveInsight` 访问，统一实时几何 + insight 读取入口 | 同一指标多 cache 不同步     |
| `intentResolver.js`      | 优先级矩阵表驱动，返回 winner + **trace** + **overrides set**                    | chip 高亮但被覆盖、无可追溯    |
| `displayContracts.js`    | 文案 / emoji / chip 契约 DSL，运行时自动校验 + 降级链                                | 文案/emoji 与几何撒谎     |
| `presentationReducer.js` | 中间层，把"算法状态 + 实时几何 → 唯一 PresentationModel"，UI 唯一消费源                    | UI 层散落 if-else 拼装  |

---

## 二、子模块详解

### 2.1 `derivation/selectors.js` — Single Source of Truth

**强制约束**（未来可固化为 ESLint 规则）：

```
❌ 禁止：game.grid.getFillRatio()                  （UI 直接读 grid）
❌ 禁止：game._lastAdaptiveInsight.boardFill        （UI 直接读 cached 字段）
❌ 禁止：profile.metrics.clearRate                  （UI 直接读 profile）

✅ 应当：selectLiveBoardFill(game)
✅ 应当：selectInsightWithLiveGeometry(game)
✅ 应当：selectLiveClearRate(game)
```

**核心 API**：

| API                                    | 返回                                                                                                  | 用途                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `selectLiveBoardFill(game)`            | `number` 0..1                                                                                       | 优先 `grid.getFillRatio()`，多级降级 |
| `selectLiveClearRate(game)`            | `number`                                                                                            | 走 `profile.metrics.clearRate` |
| `selectLiveGeometry(game)`             | `{fill, holes, nearFullLines, multiClearCandidates, pcSetup}`                                       | 5 字段实时几何快照                    |
| `selectInsightWithLiveGeometry(game)`  | merged insight                                                                                      | 把实时几何注入 insight 顶层 + layer1   |
| `selectReducerInputs(game)`            | `{intent, stress, geometry, breakdown, hints, intentInputs, distress, afkEngageActive, ...}` | reducer / contracts 的最小输入     |
| `selectSpawnIntent(game)`              | `string\|null`                                                                                     | 优先 `spawnHints.spawnIntent`   |
| `selectProfileForPresentation(game)`   | subset of profile                                                                                   | 派生层不暴露整个 profile，字段重命名解耦       |

**设计原则**：

1. **逐级降级，永不抛错**：`grid` 异常 → 走 cached `insight.boardFill` → 走 0
2. **不引入响应式**：纯函数，性能透明
3. **字段重命名只改一处**：上层全部走 selector，重构成本恒定

### 2.2 `derivation/intentResolver.js` — 表驱动优先级矩阵 + Trace

**v1.57.4 `deriveSpawnIntent`** 的实现是：

```js
if (playerDistress < -0.10) return 'relief';
if (afkEngageActive) return 'engage';
if (harvestable) return 'harvest';
...
```

**3 个隐性代价**：

1. 优先级隐式 → DFV chip 想知道"AFK 被 relief 覆盖"必须手写 `(intent === 'relief') && afkEngage`（v1.57.5 §D）
2. 决策不可追溯 → 返回 'relief' 但不知道是哪个条件主导
3. 新增规则成本高 → 一个改动要同步 4 处

**v1.58 表驱动**：

```js
INTENT_RULES = [
    { id: 'relief',  priority: 100, guard: (s) => ..., reason: (s) => '...' },
    { id: 'engage',  priority:  90, guard: (s) => ..., reason: (s) => '...' },
    { id: 'harvest', priority:  80, guard: (s) => ..., reason: (s) => '...' },
    { id: 'pressure',priority:  70, guard: (s) => ..., reason: (s) => '...' },
    { id: 'sprint',  priority:  60, guard: (s) => ..., reason: (s) => '...' },
    { id: 'flow',    priority:  50, guard: (s) => ..., reason: (s) => '...' },
    { id: 'maintain',priority:   0, guard: () => true, reason: () => '...' },
];

resolveIntent(inputs) → {
    intent: 'relief',
    trace: [
        { id: 'relief',  priority: 100, passed: true,  isWinner: true,  reason: 'playerDistress=-0.18<-0.10' },
        { id: 'engage',  priority:  90, passed: true,  isWinner: false, reason: 'afkEngageActive=true' },
        { id: 'harvest', priority:  80, passed: false, isWinner: false, reason: null },
        ...
    ],
    overrides: Set('engage', 'maintain'),  // 通过 guard 但被 winner 覆盖
}
```

**两条核心新 API**：

```js
isSignalOverridden('afkEngage', resolveIntent(...))   // true / false
formatIntentTrace(resolveIntent(...))                  // 'relief(100, ...) ← overrides[engage(90)]'
```

**与 `adaptiveSpawn.deriveSpawnIntent` 的关系**：

- 行为完全等价（被 `tests/derivationContracts.test.js` 9 条样例 + `derivationInvariants.test.js` 性质 I1 1500 次随机扫描锁定）
- adaptiveSpawn 保留作为算法层入口（不破坏既有 1707 测试 + miniprogram 镜像）
- 派生层 / UI 层全部改用 `resolveIntent`，享受 trace + overrides 元信息
- 未来 v1.58.x 可让 `deriveSpawnIntent` 内部委托 `resolveIntent` + 丢弃 trace，彻底单源化

### 2.3 `derivation/displayContracts.js` — 契约 DSL

每段文案 / emoji / chip 都用结构化字段声明：

- 我**需要**什么前置条件（`requires`）
- 我的**降级目标**是谁（`fallback`）
- 我的**优先级**（`_meta.priority`）

运行时统一校验 + 自动降级，未来可由 lint 规则做静态检查。

**谓词 DSL**：

| 谓词              | 语义                                                                       |
| --------------- | ------------------------------------------------------------------------ |
| 字面量             | `evalPredicate('relief', 'relief')` → strict equals                      |
| `{ lt: x }`     | `actual < x`                                                             |
| `{ lte: x }`    | `actual <= x`                                                            |
| `{ gt: x }`     | `actual > x`                                                             |
| `{ gte: x }`    | `actual >= x`                                                            |
| `{ eq: x }`     | `actual === x`                                                           |
| `{ neq: x }`    | `actual !== x`                                                           |
| `{ in: [...] }` | `arr.includes(actual)`                                                   |
| `{ not: p }`    | `!evalPredicate(actual, p)`                                              |
| 复合              | `{ gte: 0.125, lt: 0.333 }` → AND 所有操作符（v1.58 自测发现旧实现只看第一个 → 已修） |
| 嵌套对象            | 递归校验每个 key                                                                |

**契约示例**（relief.friendly）：

```js
{
    id: 'relief.friendly',
    requires: {
        intent: 'relief',
        breakdown: { friendlyBoardRelief: { lt: -0.05 } },
        geometry:  { boardFill: { lt: 0.5 } },        // ← v1.57.5 §B 守卫，由 contract 表声明而非散落 if
    },
    output: '盘面有可消行机会，悄悄给你减压享受多消。',
    fallback: 'relief.default',
    _meta: { priority: 90, since: 'v1.57.5', reason: 'friendly 守卫 fill<0.5 避免高 fill 撒谎' },
}
```

**调用方式**：

```js
selectNarrative(ctx) → { contract, text, trace }
selectEmoji(ctx)     → { contract, output, trace }
```

**完整性校验**（`validateContractTable`）：

- id 全局唯一
- fallback 必须指向已存在的 id
- 测试断言 `tests/derivationContracts.test.js §3b` 强制锁定

### 2.4 `derivation/presentationReducer.js` — 展示中间层

输入：`game` 实例
输出：**唯一的 PresentationModel**

```js
{
    // === 几何（实时）===
    liveGeometry: { fill, holes, nearFullLines, multiClearCandidates, pcSetup },
    liveBoardFill: 0.69,
    liveClearRate: 0.31,
    liveMissRate: 0.02,

    // === 意图（trace 化）===
    intent: { intent: 'relief', trace: [...], overrides: Set('engage') },
    intentLabel: '救济节奏',
    intentColor: '#22d3ee',
    intentTraceText: 'relief(100, distress=...) ← overrides[engage(90)]',

    // === 叙事 ===
    narrative: { text: '...', contractId: 'relief.friendly', trace: [...] },

    // === 头像 ===
    emoji: { face: '😅', label: '舒缓（盘面吃紧）', vibe: '...', id: 'easy-crowded', contractId: 'easy.crowded' },

    // === Decision Chips（含 overridden 标记，自动从 INTENT_RULES 派生）===
    chips: [
        { id: 'forceRelief',  label: '强制救济', kind: 'neg',     on: false, overridden: false, title: null },
        { id: 'afkEngage',    label: 'AFK 介入', kind: 'pos',     on: true,  overridden: true,  title: '...' },
        ...
    ],

    // === 原始 insight 直通（兼容旧调用方）===
    rawInsight, rawProfile, rawCtx,
}
```

**关键设计**：

1. **纯函数** —— 输入 game 状态 → 输出 PresentationModel，无副作用
2. **可独立测试** —— 任意 mock game 都能产出稳定结果
3. **trace 永远附带** —— 每个派生量都有 trace 字段，诊断面板 / Sentry 可读
4. **降级安全** —— 任一子派生失败不会让整个 reducer 抛错，对应字段为 null

---

## 三、测试基础设施

### 3.1 单元测试（`tests/derivationContracts.test.js`）

**63 用例 / 4 段落**：

- §1 selectors：SSOT 一致性、降级安全、字段口径（13 用例）
- §2 intentResolver：与 `deriveSpawnIntent` 行为等价 + trace + overrides（15 用例）
- §3 displayContracts：谓词 DSL + 契约表完整性 + 优先级匹配（27 用例）
- §4 presentationReducer：端到端 + chip overridden 自动派生 + 空 game 降级（8 用例）

### 3.2 性质测试（`tests/properties/derivationInvariants.test.js`）

**13 条不变式 × 1500 次随机扫描 = 19500 次状态验证**（v1.58.1 加 3 条）：

| 不变式  | 描述                                                                  |
| ---- | ------------------------------------------------------------------- |
| I1   | `resolveIntent` 与 `deriveSpawnIntent` 行为完全等价                         |
| I2   | `overrides` 永不包含 winner 本身                                           |
| I3   | trace 长度恒等于 `INTENT_RULES.length`，winner 唯一                          |
| I4   | "盘面通透/可消行机会" 字样永远不在 `boardFill >= 0.5` 时由 `relief.friendly` 输出      |
| I5   | "密集消行机会" 字样永远不在 `nearFullLines < 3` 时由 `harvest.dense` 输出            |
| I6   | emoji 😌 / 🙂 永远不在 `boardFill >= 0.66` 时出现（必须切到 crowded 或 struggling） |
| I7   | `lateCollapse` 或 `frustCritical` 触发时永远是 struggling face              |
| I8   | `afkEngage` chip 在 `intent=relief` 且 `on=true` 时 `overridden` 必为 true |
| I9   | 任何 chip 的 `overridden` 状态都蕴含 `on=true`                               |
| I10  | `boardRisk >= 0.6` 时 narrative 永远是"保活/紧张"类                          |
| **I11**  | **`flow.payoff.ready` 命中时 `geometry.harvestReady` 必为 true**（v1.58.1） |
| **I12**  | **任何含"享受多消/收获期"字样的 narrative 命中时，`nearFullLines+mcc+pcSetup >= 1`**（v1.58.1，跨 contract） |
| **I12b** | **任何含"享受多消"字样的 narrative 命中时，`geometry.harvestReady` 必为 true**（v1.58.1） |

**性质测试发现的真实 bug**：

- 旧 `evalPredicate` 复合谓词 `{ gte: 0.125, lt: 0.333 }` 只看第一个操作符（'lt'），导致 0.10 被误判通过 `gte` 守卫——已修。
- 浮点边界 `0.6499999...` 卡在 `gte: 0.65` 守卫前，让 I6 不变式留 1% 容差（产品意图本来就是"明显紧"，不是"精确 0.65"）。

### 3.3 测试矩阵

| 层级               | 测试文件                                              | 用例数  | 范围                          |
| ---------------- | ------------------------------------------------- | ---- | --------------------------- |
| 单元 - selectors   | `derivationContracts.test.js §1`                  | 13   | SSOT + 降级 + 字段口径            |
| 单元 - resolver    | `derivationContracts.test.js §2`                  | 15   | 矩阵 + trace + 同源等价           |
| 单元 - contracts   | `derivationContracts.test.js §3`                  | 27   | DSL + 完整性 + 优先级             |
| 单元 - reducer     | `derivationContracts.test.js §4`                  | 8    | 端到端 + 降级                    |
| 性质 - 不变式 | `properties/derivationInvariants.test.js`         | 10   | 15000 次随机状态扫描               |
| 集成 - 旧测试        | 既有 1707 测试 | 1707 | 全部 0 回归                     |
| **总计**           |                                                   | **1780** | **vs v1.57.5 +73 = 73 新增 / 0 回归** |

---

## 四、UI rewire（接入示范）

### 4.1 v1.58 已接入

- **DFV chip override**：硬编码 `(intent === 'relief') && afkEngage` → `isSignalOverridden('afkEngage', resolveIntent(...))`，新增 intent/signal 不再需要改 DFV 渲染。
- **playerInsightPanel boardFill 读取**：4 处 `game.grid.getFillRatio()` → `selectLiveBoardFill(game)`，杜绝 v1.57.5 §A 类双显复发。

### 4.2 v1.58.x 渐进迁移路线（建议）

| 优先级 | 接入点                                                                  | 收益                                  |
| --- | -------------------------------------------------------------------- | ----------------------------------- |
| P0  | stressMeter `buildStoryLine` 走 `selectNarrative`                   | 删除 `RELIEF_NARRATIVE_BY_REASON` 散表 |
| P0  | stressMeter `getStressDisplay` 走 `selectEmoji`                     | 删除 4 个 if-else 变体分支                |
| P1  | DFV chip on 字段走 `reducePresentation().chips`                       | 删除 8 个硬编码 chip 渲染分支                |
| P1  | DFV `_intentInputs` 缺失分支走 `reducePresentation`                     | 老回放降级路径统一                          |
| P2  | sparkline / 历史快照消费 `selectInsightWithLiveGeometry`                  | 历史数据上报口径统一                          |

### 4.3 严禁后续违反

- 新 UI 模块禁止再写 `game.grid.getFillRatio()` 或 `game._lastAdaptiveInsight.X`
- 新 intent / signal 必须先在 `INTENT_RULES` / `SIGNAL_TO_INTENT` 表中登记
- 新文案必须用 contract 形式声明 `requires`（声明前置条件），不写散落 if
- 新 chip 覆盖判定必须走 `isSignalOverridden`（禁止 `(intent === 'X') && signal`）

---

## 五、与 v1.57.5 修复方案的对比

| 维度           | v1.57.5（散点修复）                                                                | v1.58（架构治理）                                                       |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **修复方式**     | 6 个 bug → 6 处单点改                                                            | 1 个根因 → 4 模块 + 73 测试                                             |
| **未来 bug 拦截** | 必须靠用户截图反馈                                                                  | 性质测试 15000 次扫描自动捕获                                              |
| **新增 intent 成本** | 改 4 处（deriveSpawnIntent + DFV chip + stressMeter narrative + emoji）          | 改 1 处（INTENT_RULES + 加 contract）                                |
| **新增文案守卫成本** | 写硬编码 if + 加单测                                                              | 写 contract `requires`，自动校验 + 自动降级                                |
| **决策不可追溯**   | 看 spawnIntent 字段反推                                                          | `formatIntentTrace` 一行字符串                                       |
| **代码量**      | +200 行（散落）                                                                  | +1700 行（聚合在 derivation/）                                        |
| **认知负担**     | 每个 UI 模块都要懂全链路                                                              | UI 只读 PresentationModel                                          |
| **静态可分析性**   | 否                                                                          | contract DSL 可由 lint 校验                                          |

---

## 六、后续工作

| Phase    | 工作项                                                                       | 状态 | 优先级 |
| -------- | ------------------------------------------------------------------------- | -- | --- |
| **v1.58.1** ✅ | flow.payoff / relief.friendly 加 `harvestReady` 几何兑现守卫；新增 I11/I12 性质 | **已交付** | P0 |
| **v1.58.2** ✅ | struggling emoji + relief.endgame 加 `boardFill>=0.45` 守卫；新增 concerned 中间档 + endgame.soft 降级；I7 升级 + I13/I13b/I14 | **已交付** | P0 |
| **v1.58.3** ✅ | DFV chip 自描述化（CHIP_DEFS 加 reason 函数 + 4 个信号诊断 chip）+ 跨维度信号冲突可视化（conflicts 数组：flowVsIntent / pressureVsForce）+ DFV 渲染走 `deriveChipsFromCtx`；I15/I16/I17 | **已交付** | P0 |
| **v1.58.4** ✅ | 全系统自查 6 处残留：relief.hole/boardRisk 几何守卫 + harvest.default 文案改写 + flow.intense/tense 加守卫 + 拓展 stressVsBoardFill 冲突 + flow.payoff.waiting 文案去"收获期"；I18/I19/I20/I21 | **已交付** | P0 |
| v1.58.5  | stressMeter `buildStoryLine` / `getStressDisplay` 完全走 contract DSL，删除冗余实现 | 待办 | P0  |
| v1.58.6  | 加 lint 规则：禁止 UI 模块直接 import `game.grid.getFillRatio` / `_lastAdaptiveInsight` | 待办 | P1  |
| v1.58.7  | `deriveSpawnIntent` 内部委托 `resolveIntent`，彻底单源化（含 miniprogram 镜像）          | 待办 | P1  |
| v1.59    | 决策 DAG 编译：把 INTENT_RULES + contract 表编译成静态依赖图，可视化分析 / 反例搜索               | 规划 | P2  |
| v1.59+   | 生产环境 trace 上报：把 `intentTraceText` + contract 命中率上报到 Sentry / Datadog       | 规划 | P2  |

### 6.1 v1.58.1 治理记录（节奏承诺-几何兑现一致性）

**触发**：v1.58 上线后用户截图复盘（盘面 fill=0.30 / nearFullLines=0 / mcc=0 / pcSetup=0），stressMeter 文案显示"心流稳定，节奏进入收获期，准备享受多消快感"——与盘面事实严重不符。同 panel 下方的"实时策略 - 待兑现"已诚实承认"暂时没出消行机会"，形成自我矛盾。

**根因**：v1.58 `flow.payoff` contract 守卫只检查 `intent='flow' + hints.rhythmPhase='payoff'`，**没有任何几何守卫**。`rhythmPhase='payoff'` 只代表算法层进入收获节奏，但当前 dock + 盘面是否真有可兑现路径是另一回事——这是 v1.57.5 §B"盘面通透撒谎"在 flow 链上的同构 bug。

**修复**（v1.58.1）：

1. **`selectors.js` 派生新字段 `geometry.harvestReady`**：

   ```js
   harvestReady = (nearFullLines >= 1) || (multiClearCandidates >= 1) || (pcSetup >= 1)
   ```

   表达"当前盘面确实存在可兑现的消行路径"。

2. **`displayContracts.js` 拆 `flow.payoff` 为 ready / waiting 两档**：

   ```js
   { id: 'flow.payoff.ready',
     requires: { intent:'flow', hints:{rhythmPhase:'payoff'}, geometry:{harvestReady:true} },
     output: '心流稳定，节奏进入收获期，准备享受多消快感。',
     _meta: { priority: 62 } },
   { id: 'flow.payoff.waiting',
     requires: { intent:'flow', hints:{rhythmPhase:'payoff'} },
     output: '心流稳定，节奏已锁定收获期，dock 在等下一波兑现窗口——先稳住手。',
     _meta: { priority: 60 } },
   ```

3. **同步补 `relief.friendly` 的 `harvestReady` 守卫**（语义包含"享受多消"，与 I12 跨 contract 不变式对齐）。

4. **新增 3 条性质不变式**：

   | 不变式  | 内容                                                                 |
   | ---- | ------------------------------------------------------------------ |
   | I11  | `flow.payoff.ready` 命中时 `geometry.harvestReady` 必为 true            |
   | I12  | 任何含"享受多消/收获期"字样的 narrative 命中时，`nearFullLines+mcc+pcSetup >= 1` |
   | I12b | 任何含"享受多消"字样的 narrative 命中时，`geometry.harvestReady` 必为 true        |

   每条 1500 次随机扫描 / 0 反例。

**测试结果**：1785 / 1785 全过（v1.58 的 1780 + 5 新增 v1.58.1 = 0 回归），lint 0 errors。

**架构启示**：v1.58 派生层的真正价值在 v1.58.1 体现——**整次根因治理只改了 2 个文件 + 加 3 条不变式**（合计 ~30 行新代码 + 3 测试），就让整个"节奏类承诺"得到结构性保护。如果是 v1.58 之前的散点架构，同一类 bug 在 `harvest.*` / 其它 spawnHints 链路上还会陆续爆 N 次。

### 6.2 v1.58.2 治理记录（算法信号-盘面几何反差）

**触发**：v1.58.1 上线后用户截图复盘（盘面 fill=0.31 / 解法=63 / 通透盘面 / forceReliefIntent=true），UI 显示：
- emoji 😣 "挣扎中（救济中）"——与玩家视觉看到的通透盘面严重不符
- narrative "本局接近收尾，正投放更稳的组合让你顺利收官"——盘面 31% 占盘，谈不上"接近收尾"

**根因**：`struggling.lateCollapse` / `struggling.frustCritical` / `relief.endgame` 三档守卫**只看算法侧信号**（sessionPhase / momentum / frustration / endSessionDistress），**没有任何盘面几何确证**。算法侧"末段崩盘信号"触发了 forceReliefIntent，但玩家盘面通透——是 v1.57.5 §G crowded 守卫的镜像问题（"盘面紧但 stress 低"的反向）。

**修复**（v1.58.2）：

1. **`displayContracts.js` `struggling.*` 加 `boardFill>=0.45` 守卫** + 新增 `concerned.softRescue.{late,frust}` 中间档（优先级 78/77）：盘面真有压力 → struggling；盘面通透 → concerned 😟 "稍专注（系统已减压）"——既承认算法在减压，又不撒谎"挣扎中"。
2. **`relief.endgame` 加 `boardFill>=0.45` 守卫** + 新增 `relief.endgame.soft` 降级（优先级 78）："临近收尾，系统已悄悄为你切到更稳节奏——盘面仍从容，继续稳住即可"。
3. **新增 3 条性质**：
   - I7 升级：lateCollapse/frustCritical 触发 + `boardFill>=0.46` 永远是 struggling
   - I13：struggling emoji 命中时 `distress.boardFill>=0.45`
   - I13b：concerned emoji 命中时算法侧信号必至少一条触发
   - I14："本局接近收尾" 字样的 narrative 命中时 `geometry.boardFill>=0.45`

**测试结果**：1796 / 1796 全过（v1.58.1 的 1785 + 11 新增 = 0 回归），lint 0 errors。

### 6.3 v1.58.3 治理记录（DFV chip 自描述化 + 跨维度信号冲突）

**触发**：v1.58.2 上线后用户截图复盘（DFV 决策流面板），发现 3 类一致性反差：
- **P0**：chip 表"强制救济"亮但其它 chip 全暗——玩家看不出 forceReliefIntent 由什么触发
- **P1**：flowState=bored（中长期玩家偏强）vs spawnIntent=relief（即时救济）——两个独立信号源对掐
- **P1**：chip 高亮但 title=null（hover 无任何 reason / 数值）

**根因**：
- v1.58 chip 表的 `lateCollapse` chip on 函数错写为 `endSessionDistress<-0.05`（v1.57.5 §D 之前的简化判定），与 stressMeter / adaptiveSpawn 实际定义 `sessionPhase=late && momentum<=-0.30` 不一致——同 panel 一致性 bug。
- chip 表只有 8 条，没有把 forceReliefIntent 的真实触发器全部暴露——玩家无法从 DFV 看到"为什么强制救济"。
- chip 表无 reason 字段——hover 没有数值，title 仅在"被覆盖"时才有内容。
- playerProfile.flowState（中长期估测）与 adaptiveSpawn.spawnIntent（即时判定）本就独立——v1.58.3 之前假装一致，v1.58.3 起显式承认冲突。

**修复**（v1.58.3）：

1. **`presentationReducer.js` CHIP_DEFS 扩展**：
   - 修正 `lateCollapse` on 函数：与 stressMeter / adaptiveSpawn 同源（`sessionPhase=late && momentum<=-0.30`）
   - 加 4 个**信号诊断 chip**（kind=neutral，非 forceRelief 上游）：`endSessionStress` / `lifecycleLateAccel` / `playerDistressFloor` / `delightModeRelief`——让 DFV 一眼看到所有压力链路信号
   - 全 chip 加 `reason(ctx)` 函数：高亮时 title 自动写"触发源：<具体数值>"

2. **`presentationReducer.js` 新增 `conflicts` 派生**：
   - `flowVsIntent`：flowState=bored vs intent=relief；flowState=challenged vs intent=engage
   - `pressureVsForce`：forceReliefIntent=true 但压力贡献净正向（绕过 stress 标量的抢占线路）
   - DFV 渲染到 chip 区下方一行 amber 提示 "⚠ 本帧识别到 N 处跨维度信号冲突"

3. **抽出公共 API**（避免与 reducer 漂移）：
   - `deriveChipsFromCtx(ctx, intentResolved)` + `buildChipCtxFromInsight(insight, profile)`
   - `deriveConflicts(ctx, intentResolved)`
   - DFV `_renderDetails` 全部走这两个 API，CHIP_DEFS 唯一同源

4. **新增 3 条性质**：

   | 不变式 | 内容                                                                |
   | ----- | ------------------------------------------------------------------ |
   | I15   | forceRelief chip 亮时，lateCollapse 或 frustCritical 至少 1 个亮（chip 表与算法层 adaptiveSpawn.js:2235 同源锁定） |
   | I16   | 任何 chip on=true 时 title 必非空（强制可读 reason）                          |
   | I17   | flowState='bored' 且 intent='relief' 时 conflicts 必含 flowVsIntent  |

**测试结果**：1798 / 1798 全过（v1.58.2 的 1796 + 6 单元 + 3 性质 = 0 回归），lint 0 errors。

**架构启示**：v1.58.3 暴露了 chip 表早期一个隐性缺陷——`lateCollapse` chip 的 on 函数与 stressMeter 实际定义不一致（前者用 endSessionDistress 近似，后者用 sessionPhase+momentum）。这种"两个文件用不同口径表达同一概念"的味道在散点架构里很难被发现，派生层 I15 性质（chip 表 vs 算法层同源）通过 fast-check 反向锁定，让这种漂移在 CI 阶段就被捕获。

### 6.4 v1.58.4 治理记录（全系统自查残留修补）

**触发**：v1.58.3 完成后做了一次系统性自查——grep + 人工审视所有 NARRATIVE_CONTRACTS / EMOJI_CONTRACTS / CHIP_DEFS，找"算法信号缺几何守卫"或"跨维度冲突未可视化"的潜在点。

**发现并修补的 6 处**：

| ID | 位置                          | 风险描述                                                                 | 修复                                                              |
| -- | ----------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| E1 | `relief.hole` contract        | "盘面空洞偏多" 文案守卫只看 `holeReliefAdjust`，holes=0 时仍可命中             | 加 `geometry: { holes: { gte: 1 } }` 守卫                          |
| E2 | `relief.boardRisk` contract   | "盘面压力较高" 文案守卫只看 `boardRiskReliefAdjust`，boardFill<0.3 时仍可命中 | 加 `geometry: { boardFill: { gte: 0.45 } }` 守卫                  |
| E3 | `harvest.default` contract    | 兜底文案 "识别到密集消行机会" 在 `nearFullLines=0` 时撒谎"密集/已识别"        | 改写文案 "系统已切到 harvest 节奏，正在寻找下一个消行窗口"            |
| E4 | `flow.intense` contract       | "进入高压区" 在 boardFill<0.3 时撒谎"高压"                                | 加 `boardFill>=0.45` 守卫 + 新增 `flow.intense.soft` 软降级文案    |
| E5 | `flow.tense` contract         | "压力正在抬升" 在通透盘面撒谎                                            | 加 `boardFill>=0.40` 守卫 + 新增 `flow.tense.soft` 软降级文案      |
| E6 | `reducer._deriveConflicts`    | stress 标量 vs 盘面几何强烈不一致时没有冲突可视化                            | 新增 `stressVsBoardFill` conflict（stress>=0.65 && boardFill<0.30） |
| 附加 | `flow.payoff.waiting` contract| 文案含"收获期"字样与 I12（任何含"收获期"必 harvestReady>=1）冲突           | 改写文案 "节奏已切到等待消行窗口的状态——dock 在留通道，先稳住手"     |

**新增 4 条性质**：

| 不变式 | 内容                                                                |
| ----- | ------------------------------------------------------------------ |
| I18   | "盘面空洞偏多" 字样的 narrative 命中时 `geometry.holes>=1`             |
| I19   | "盘面压力较高" 字样的 narrative 命中时 `geometry.boardFill>=0.45`     |
| I20   | "进入高压区" 字样的 narrative 命中时 `geometry.boardFill>=0.45`        |
| I21   | `harvest.default` 兜底 narrative 不能含 "密集" / "已识别" 字样          |

**测试结果**：**1809 / 1809 全过**（v1.58.3 的 1798 + 11 新增 = 0 回归），lint 0 errors。

**自查产出附录（其它已审视但本轮决定不改的 4 处）**：

| ID | 位置                             | 描述                                  | 不改原因                                                            |
| -- | --------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| N1 | `relief.bottleneck` contract     | 文案 "刚刚停顿较多"                       | bottleneck 是行为/时序信号，没有几何对应，文案是事实陈述               |
| N2 | `relief.frustration` contract    | 文案 "刚刚不太顺"                         | 措辞模糊，无强承诺；frustration 本来就是行为侧累加                      |
| N3 | `engage.default` contract        | 文案 "停顿了一下"                         | engage 由 afkEngage 触发，文案与触发条件一致                            |
| N4 | `pressure.default` contract      | 文案 "正在挑战自我，略加压"                | pressure 是行为/动量信号，与几何无关；文案是真实意图陈述                |

---

## 七、关键文件索引

| 文件                                                              | 行数（约）  | 说明              |
| --------------------------------------------------------------- | ------ | --------------- |
| `web/src/derivation/selectors.js`                               | 230  | SSOT 8 个 API（v1.58.3 distress 加 flowState） |
| `web/src/derivation/intentResolver.js`                          | 240  | INTENT_RULES + 3 公开 API |
| `web/src/derivation/displayContracts.js`                        | 540  | DSL + 32 contract（v1.58.2/3/4 加 concerned/endgame.soft/intense.soft/tense.soft 等） |
| `web/src/derivation/presentationReducer.js`                     | 410  | reducePresentation 主入口 + deriveChipsFromCtx + buildChipCtxFromInsight + deriveConflicts |
| `tests/derivationContracts.test.js`                             | 760  | 79 单元测试         |
| `tests/properties/derivationInvariants.test.js`                 | 550  | 23 性质（I1–I21 + I12b + I13b）/ ~30000 扫描 |
| `docs/algorithms/DECISION_DERIVATION_ARCHITECTURE.md`           | 本文     | 主架构文档           |
| `docs/algorithms/ADAPTIVE_SPAWN.md §3.6`                        | 见 §3.6 | 与算法层的衔接说明       |
| `docs/player/BEST_SCORE_CHASE_STRATEGY.md` v1.58 changelog      | 见顶部     | 玩家视角变更说明        |

---

> **维护者注**：本文档与 `derivation/` 子模块的代码同源——任何 INTENT_RULES / contract 表的修改都必须在本文档 §2 同步标注，由 `tests/derivationContracts.test.js` 的"同源锁定"断言强制约束。
