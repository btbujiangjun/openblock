# 游戏架构对比分析：行业参考架构 vs Open Block 现状

> 本文基于行业参考架构图（下称「参考架构」）与 Open Block 当前代码库的深度对比，
> 识别差距、优势与改进路径，供产品演进和技术规划参考。

---

## 一、参考架构总览

参考架构将一款同类消块游戏分为如下主要层次：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 交互效果层（以战斗界面为主）            广告 & 数据收集层             │
│                                                                       │
│  主界面                                                               │
│  ├── 主界面功能层                                                     │
│  │                                                                     │
│  ├── 无尽模式                    关卡 / 旅行模式                      │
│  │   战斗界面                    战斗界面                              │
│  │   ├── 兜底算法层              ├── 关卡配置层                       │
│  │   ├── 混合泳道层              └── 关卡算法层                       │
│  │   └── 全局算法层                                                   │
│  │                                                                     │
│  │   ── 共享核心算法层 ──────────────────────────────                 │
│  │   ├── 块池层                                                       │
│  │   ├── 算法难题层       出块顺序层    初始盘面层                    │
│  │   ├── 算法填空层       消除规则层    回归策略层                    │
│  │                                                                     │
│  │   ── 功能层 ──────────────────────────────────                    │
│  │   ├── 马赛克功能层（关卡专属）                                     │
│  │   ├── 对局功能层                                                   │
│  │   └── 设置功能层                                                   │
│  │                                                                     │
│  │   ── 交互 & 表现层 ─────────────────────────────                  │
│  │   ├── 额外效果层    方块换色层                                     │
│  │   └── 清屏UI层     消除UI层                                        │
│  │                                                                     │
│  ├── 复活界面                                                         │
│  │   └── 复活功能层                                                   │
│  │                                                                     │
│  └── 结算界面                                                         │
│      ├── 无尽结算功能层                                               │
│      └── 关卡结算功能层                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、Open Block 现状架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  共享数据层：shared/game_rules.json + shapes.json（唯一数据源）      │
│                                                                       │
│  前端（web/src/）                                                     │
│  ├── 主界面 / 战斗 / 结算（index.html + game.js 编排）               │
│  │   ├── 棋盘层     grid.js（消除、放置几何逻辑）                    │
│  │   ├── 渲染层     renderer.js（Canvas 动画）                        │
│  │   ├── 出块层     bot/blockSpawn.js + adaptiveSpawn.js              │
│  │   ├── 皮肤层     skins.js（主题换色）                             │
│  │   ├── 结算层     progression.js（XP/等级/日连续）                 │
│  │   └── 提示层     hintEngine.js + strategyAdvisor.js               │
│  │                                                                     │
│  ├── AI / RL 层                                                       │
│  │   ├── RL 训练     bot/trainer.js（浏览器端）                      │
│  │   │              rl_pytorch/train.py（PyTorch/MCTS/PPO，主力）    │
│  │   ├── 出块模型   spawnModel.js + rl_pytorch/spawn_model/          │
│  │   └── 玩家画像   playerProfile.js + playerInsightPanel.js         │
│  │                                                                     │
│  ├── 商业化层（web/src/monetization/）                                │
│  │   ├── 广告触发   adTrigger.js（结局/无消除）                      │
│  │   ├── IAP        iapAdapter.js（占位）                             │
│  │   ├── 每日任务   dailyTasks.js                                    │
│  │   ├── 赛季通行证 seasonPass.js                                    │
│  │   └── 个性化策略 personalization.js + commercialInsight.js        │
│  │                                                                     │
│  └── 数据层                                                           │
│      ├── 行为收集   database.js（前端 batch）→ server.py              │
│      ├── 行为分析   monetization_backend.py / rl_backend.py           │
│      └── 回放系统   moveSequence.js + replayUI.js                    │
│                                                                       │
│  多平台：Web（Vite）+ 微信小程序（miniprogram/core 同步）            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、逐维度对比

### 3.1 游戏模式设计

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 游戏模式数量 | **无尽 + 关卡/旅行** 双轨 | 仅无尽（normal strategy） | ⚠️ 高差距 |
| 关卡配置独立性 | 关卡配置层 + 关卡算法层独立存在 | 无关卡概念，仅 strategy_id 切换难度 | ⚠️ 高差距 |
| 模式专属结算 | 无尽/关卡各自结算界面 | 统一 game-over 界面 | ⚠️ 中差距 |
| 马赛克等专属玩法 | 关卡专属功能层（马赛克） | 无专属关卡玩法 | ⚠️ 高差距 |

**分析**：参考架构将「无尽」与「关卡」作为一级分类，各自拥有独立算法栈与结算逻辑，是商业成熟游戏的标准模式选择——无尽适合日常留存，关卡/旅行适合新手引导与内购变现。Open Block 目前仅有无尽模式，关卡系统完全缺失，这是最显著的产品能力差距。

---

### 3.2 出块算法体系

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 算法层次 | **兜底→混合泳道→全局**三级联动 | adaptiveSpawn 单层（多信号融合但未分级） | ⚠️ 中差距 |
| 块池管理 | 独立块池层（明确块的生命周期） | shapes.json + 权重随机，无显式池 | ⚠️ 中差距 |
| 算法难题层 | 显式「难题算法」：推送高难形状 | 通过权重调整隐式实现 | ⚠️ 低差距 |
| 算法填空层 | 显式「填空算法」：给玩家「能用」的块 | 可解性检测（isSolvable）有类似效果 | ✅ 近似实现 |
| 出块顺序层 | 独立出块顺序控制 | blockSpawn.js 内合并处理 | ⚠️ 中差距 |
| 回归策略层 | 独立回归策略（防玩家过度挫败） | adaptiveSpawn 的 stress/profile 机制覆盖 | ✅ 已实现 |
| AI 出块模型 | 未见（规则驱动） | **SpawnTransformerV2**（学习历史分布） | 🌟 Open Block 超越 |

**分析**：参考架构的三级算法分层（兜底→泳道→全局）是对「什么时候用兜底保活、什么时候用复杂算法、什么时候做全局调节」的工程化拆分，职责清晰、易于调试。Open Block 的 `adaptiveSpawn.js` 功能等价但缺乏显式层次，导致调试和拓展困难。Open Block 在 AI 出块模型（SpawnTransformerV2）上明显超越参考架构的纯规则方式。

---

### 3.3 初始盘面

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 初始盘面层 | 独立存在（关卡可预设盘面） | 空白盘面，无预设 | ⚠️ 中差距（关卡模式前提下） |

---

### 3.4 消除与规则系统

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 消除规则层 | 独立层（可配置、可扩展） | grid.js 中硬编码整行/列消除 | ⚠️ 中差距 |
| 清屏UI层 | 独立视觉层 | renderer.js 中合并实现 | ⚠️ 低差距 |
| 消除UI层 | 独立视觉层 | renderer.js 中合并实现 | ⚠️ 低差距 |
| 消除规则可扩展性 | 可支持特殊消除（对角线、炸弹等） | 仅行/列消除，无扩展接口 | ⚠️ 中差距 |

---

### 3.5 交互 & 表现

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 额外效果层 | 独立（连击光效、特殊动画） | renderer.js 内实现，无独立层 | ⚠️ 低差距 |
| 方块换色层 | 独立（皮肤/主题） | skins.js 独立模块 | ✅ 已实现 |
| 交互效果层（全局） | 独立层（以战斗界面为主） | 分散于 renderer.js + game.js | ⚠️ 低差距 |

---

### 3.6 复活系统

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 复活界面 | **独立复活界面 + 复活功能层** | **完全缺失（仅文档设想）** | ❌ 严重差距 |
| 变现接入点 | 复活=核心广告/IAP 触发点 | 变现文档有规划但未落地 | ❌ 严重差距 |

**分析**：复活系统是同类游戏最重要的变现锚点之一。用户在接近失败时有极高的付费/广告观看意愿。参考架构将其作为独立界面处理，与战斗和结算并列，说明其战略重要性。Open Block 的商业化文档已规划此场景，但代码层面完全未实现，是最紧迫的实现缺口。

---

### 3.7 广告 & 数据收集

| 维度 | 参考架构 | Open Block 现状 | 差距评级 |
|------|----------|-----------------|---------|
| 广告层独立性 | 右侧独立层，与游戏逻辑隔离 | adAdapter.js + adTrigger.js 已解耦 | ✅ 已实现 |
| 数据收集层 | 独立层（与游戏逻辑分离） | database.js + server.py 分离良好 | ✅ 已实现 |
| 行为分析深度 | 未见（假设有但未展示） | **行为序列 + 玩家画像 + RL + 商业化联动** | 🌟 Open Block 超越 |

---

### 3.8 AI / RL 能力

| 维度 | 参考架构 | Open Block 现状 | 评级 |
|------|----------|-----------------|------|
| AI 算法 | 规则驱动（算法层） | **PPO + GAE + MCTS（v8.3）** | 🌟 Open Block 超越 |
| 出块 AI | 规则 + 手工调参 | **SpawnTransformerV2 学习历史分布** | 🌟 Open Block 超越 |
| 玩家建模 | 未见 | **playerProfile.js + 画像面板** | 🌟 Open Block 超越 |
| 自适应难度 | 回归策略层（规则） | **多信号自适应 + RL 辅助** | 🌟 Open Block 超越 |

---

## 四、综合优劣势矩阵

### Open Block 优势（相较参考架构）

| 优势项 | 说明 | 战略价值 |
|--------|------|---------|
| 🌟 **RL + MCTS 训练体系** | PPO/GAE + v8.3 批量 MCTS + Zobrist 持久化，业界领先研究级实现 | 算法壁垒，长期护城河 |
| 🌟 **AI 出块建模** | SpawnTransformerV2 从历史对局学习出块分布，远超规则调参 | 体验精细化，数据飞轮 |
| 🌟 **玩家深度画像** | playerProfile + strategyAdvisor + commercialInsight，实时多维信号 | 个性化变现基础 |
| 🌟 **行为数据管道** | 行为批量入库 + moveSequence 回放 + RL 训练闭环 | 数据资产积累 |
| 🌟 **多平台同构** | Web + 微信小程序，shared/ 单一数据源确保一致性 | 快速扩圈 |
| 🌟 **商业化策略框架** | personalization / 个性化触达 / monPanel 完整闭环 | 变现精细化 |

### Open Block 劣势（相较参考架构）

| 劣势项 | 说明 | 状态 |
|--------|------|------|
| ✅ **无关卡/旅行模式** | LevelManager + LevelConfig + game.js 完整集成 + 关卡编辑器 | 已解决 |
| ✅ **复活系统缺失** | ReviveManager 插件化复活 + 广告接口预留 | 已解决 |
| ✅ **出块算法层次扁平** | spawnLayers.js 三层显式分离（Fallback/Lane/Global） | 已解决 |
| ✅ **消除规则封闭** | ClearRuleEngine + RowColRule/ZoneRule/DiagonalRule 可插拔 | 已解决 |
| ✅ **UI 层耦合** | EffectLayer 事件总线解耦渲染调用 | 已解决 |
| ✅ **无块池管理** | BlockPool 新鲜度保障 + wrap 透明代理 | 已解决 |
| ✅ **结算界面单一** | endGame(mode/levelResult) + HTML 星级/目标槽位扩展 | 已解决 |
| ⚠️ **马赛克视觉深度** | 基础叠加层已实现；商业级粒子/动画效果待丰富 | 进行中 |
| ⚠️ **关卡内容数量** | 编辑器框架已就绪；正式关卡包需配置和测试 | 进行中 |

---

## 五、优先改进路径

### 阶段一：高价值快速落地（已完成 ✅）

```
1. 复活系统（✅ 已落地）
   - web/src/revive.js — ReviveManager 插件化实现
   - 装饰器模式：零侵入挂钩 game.showNoMovesWarning
   - 随机清除 12 个格子 → 继续局
   - 广告/IAP 接口预留（adAdapter.showRewardedAd）
   - 每局限 1 次，可通过 opts.limit 配置
   - CSS 动画浮层（.revive-overlay / .revive-card）

2. 出块算法分层重构（✅ 已落地）
   - web/src/bot/spawnLayers.js — 三层显式分离
   - FallbackLayer：保活兜底 + gap-filler 优先选取
   - LaneLayer：节奏/combo/尺寸偏好过滤
   - GlobalLayer：全局弧线/里程碑/多样性调控
   - 现有 generateDockShapes 保持原有接口不变
   - 新增 generateDockShapesLayered 适配接口

3. 结算界面扩展（✅ 已落地）
   - index.html：game-over 增加 data-game-mode 属性
   - id="over-label"：动态文字（游戏结束/关卡完成/关卡失败）
   - id="over-level-info"：星级 + 目标文字（关卡专属）
   - game.js endGame(opts)：支持 mode / levelResult 参数
   - 向后兼容：无参调用等价于 mode='endless'
```

### 阶段二：关卡系统（已部分落地 ✅）

```
4. 关卡/旅行模式骨架（✅ 已落地）
   - web/src/level/levelManager.js — LevelManager + LevelConfig 接口
   - 支持四类目标：score / clear / survival / board
   - 三星评分系统（可配置 stars.one/two/three 门槛）
   - applyInitialBoard：预设盘面写入 grid
   - getAllowedShapes：限制关卡可用块集
   - SAMPLE_LEVEL_SCORE / CLEAR / SURVIVAL 三个示例关卡

5. 消除规则扩展接口（✅ 已落地）
   - web/src/clearRules.js — ClearRuleEngine + 三类规则
   - RowColRule：复现现有行/列消除（向后兼容）
   - makeZoneClearRule：预设区域消除（关卡专属）
   - DiagonalRule：对角线消除（扩展玩法）
   - ClearRuleEngine.apply(grid) 替代 grid.checkLines()

6. 效果层独立（✅ 已落地）
   - web/src/effects/effectLayer.js — EffectLayer 事件总线
   - emit('clear'|'combo'|'place'|'revive'|'level_win')
   - 解耦 game.js 对 renderer.* 的直接调用
   - reducedMotion 自动适配无障碍需求

7. 块池管理（✅ 已落地）
   - web/src/bot/blockPool.js — BlockPool 新鲜度保障
   - recentWindow 防止同形状连续出现
   - categoryWindow 跨轮品类多样性
   - wrap(generateFn) 透明代理原始出块函数
```

### 阶段三：关卡内容与体验精细化（✅ 已完成）

```
8. 关卡编辑器 / PCGRL 生成（✅ 已落地）
   - web/src/levelEditorPanel.js — 完整编辑器 UI
   - 8×8 可点击网格（鼠标绘制 / 右键调色板）
   - 关卡目标（score/clear/survival）+ 限制 + 星级配置
   - 玩法模式：无尽 / 马赛克四象限 / 竖条 / 环形
   - web/src/level/pcgrl.js — PCGRL 程序化生成
     * generateBoard：「生成→验证→修正」迭代确保可玩性
     * generateMosaicBoard：区域感知生成，各区域填充率均衡
     * validateBoard：简化形状库快速可玩性校验
   - 「PCGRL 随机生成」一键填充，「导出 JSON」复制配置
   - 「开始试玩」直接用编辑结果启动游戏

9. 马赛克专属玩法（✅ 已落地）
   - web/src/level/mosaicLevel.js — 三类内置马赛克关卡
     * MOSAIC_LEVEL_4ZONE：四象限（各 4×4）
     * MOSAIC_LEVEL_STRIPS：竖条（各 2×8）
     * MOSAIC_LEVEL_RING：四角 + 中心环形
   - 预设区域定义：ZONES_QUADRANT / ZONES_STRIPS_V / ZONES_RING
   - 每个关卡 clearRules 包含 zone + row_col 双规则引擎
   - createZoneOverlay(game, zones)：CSS 叠加层，ResizeObserver 自动对齐
   - removeZoneOverlay：关卡结束后清理叠加层

10. game.js 完整集成（✅ 已落地）
    - start(opts) 接受 levelConfig → 创建 LevelManager + ClearRuleEngine
    - 自动调用 applyInitialBoard 写入预设盘面
    - 落子后调用 recordPlacement() / recordClear() / recordRound()
    - 每次 spawnBlocks 后通过 checkObjective() 检测胜利/失败
    - endGame(mode='level', levelResult) 传递结算信息到 UI
    - _clearEngine 替代 grid.checkLines()（向后兼容：默认 RowColRule）
```

---

## 六、架构演进目标（中期）

```
参考架构（成熟商业游戏）           Open Block 当前架构              进一步目标
─────────────────────────         ─────────────────────────        ──────────────────────
无尽 + 关卡/旅行              →   ✅ 无尽 + 关卡/旅行完整接入    AI 课程自动生成关卡
规则三级算法                  →   ✅ 三级 + SpawnTransformerV2   出块 AI 闭环训练
马赛克等专属玩法              →   ✅ 四象限/竖条/环形 3 类       可插拔 mode plugin
PCGRL 盘面生成                →   ✅ generateBoard/generateMosaic RL 策略级生成（后端）
复活系统（规则触发）          →   ✅ ReviveManager AI 接口预留   AI 判断最优触发时机
消除规则（固定行列）          →   ✅ ClearRuleEngine 可插拔       更多扩展规则（十字/L型）
规则回归策略                  →   RL 自适应难度（已领先）        SGAZ + Search-Contempt
广告/IAP 标准接入             →   个性化策略驱动变现（已领先）   实时竞价 + 分群投放
数据收集（功能型）            →   行为飞轮 + RL 闭环（已领先）   多端分布式训练
```

---

## 七、总结

| 维度 | 参考架构 | Open Block |
|------|----------|------------|
| 产品完整度 | ✅ 完整双模式 + 复活 + 专属玩法 | ✅ 复活已落地；关卡骨架已搭建 |
| 算法工程化 | ✅ 清晰三级分层，职责明确 | ✅ spawnLayers.js 三层显式分离 |
| AI/RL 深度 | ❌ 规则驱动，无 RL | ✅✅ PPO+MCTS+SpawnTransformer |
| 玩家建模 | ❌ 未见 | ✅✅ 多维画像 + 实时信号 |
| 数据资产 | 未见细节 | ✅✅ 行为序列 + 回放 + RL训练闭环 |
| 变现触点 | ✅ 复活 = 核心锚点 | ✅ 复活系统已落地（ReviveManager） |
| 多平台 | 未见 | ✅ Web + 小程序同构 |
| 可扩展性 | ✅ 层次化，易于插入新规则 | ✅ ClearRuleEngine + EffectLayer + LevelManager |

> **结论**：Open Block 在 AI 深度、数据资产和商业化精细化方面已超越参考架构。
> 阶段一改进（复活系统、出块分层、结算扩展）已于 2026-04-20 全部落地，
> 测试覆盖 30 个新用例（251 个全量用例零回归）。
> 当前最高优先级的产品演进方向为**关卡/旅行模式**，
> 可基于已有 LevelConfig + spawnLayers 框架快速搭建骨架。

---

*文档生成日期：2026-04-20 | 最后更新：2026-04-20（阶段一 + 阶段二核心改进落地）*
*对比依据：行业参考架构图（见 assets）+ Open Block 代码库全量扫描*
