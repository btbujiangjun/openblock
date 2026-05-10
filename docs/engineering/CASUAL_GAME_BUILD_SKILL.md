# 休闲游戏全栈构建 Skill（OpenBlock 沉淀版）

> **用途**：供 Cursor、OpenCode、Codex 等 AI 编码助手在**从零或增量开发休闲游戏**时作为工作流与检查清单；以本仓库工程实践为事实来源。  
> **项目内 Skill 文件**：`.cursor/skills/casual-game-build/SKILL.md`（Cursor Agent 可加载）。  
> **全部 Skill 索引**：[CURSOR_SKILLS.md](./CURSOR_SKILLS.md)（含可选用个人 Skill 场景表）。  
> **版本**：1.1 · 2026-05-10  
> **沉淀来源**：OpenBlock 从核心消除玩法、启发式出块、生成式出块、PyTorch/浏览器 RL、体验策略文档、截图驱动 UI 修复、测试清理到模型系统文档化的完整迭代过程。

---

## 何时加载本 Skill

在用户提到「做一款休闲游戏 / 超休闲 / 益智消除 / 关卡无尽 / 要上小程序或 Web / 要接广告内购 / 要留存任务」等场景时，按下列**阶段顺序**拆解任务，并优先采用 **规则数据化、模块边界清晰、可测试、可渐进商业化** 的交付方式。

若用户提到「自适应难度、策略合理性、出块算法、玩家体验、RL 训练、Bot、自博弈、截图 UI bug、模型文档」等关键词，也应加载本 Skill，并把实现同时落到 **代码、测试、诊断面板、文档契约** 四个面。

---

## OpenBlock 复盘出的核心原则

| 原则 | 做法 | 反模式 |
|------|------|--------|
| 体验模型先于复杂系统 | 先定义玩家状态、压力、奖励兑现、恢复/加压节奏，再写策略 | 只堆功能，不知道为什么变好玩 |
| 规则和模型分层 | 启发式规则保公平和低延迟，生成式/RL 学偏好和策略 | 让神经网络绕过玩法不变量 |
| 指标必须有物理含义 | 每个面板字段写清来源、范围、解释和作用 | 只显示缩写/曲线，无法评估合理性 |
| 可解性优先于刺激 | 高难可以缩小解空间，但不能破坏基本可放、序贯可解和回退 | 为了难度制造随机死局 |
| 奖励概率与几何约束分离 | 清屏、多消、同 icon 是概率倾向，仍受盘面几何校验 | 直接承诺奖励但盘面无法兑现 |
| 截图驱动 UI 修复 | 根据实际截图定位浮层锚点、对比度、可移动区域和视觉遮挡 | 只凭代码推测 UI 正确 |
| 文档是策略契约 | 算法、状态、字段、损失函数、网络结构和测试入口同步更新 | 代码改了，文档仍停留在旧语义 |
| 回归测试保护体验 bug | 分数特效、出块概率、压力状态等用户可感知逻辑都要补测试 | 修一次、之后同类问题反复出现 |

---

## 阶段 0：产品与核心循环（先于写代码）

| 步骤 | 产出 | AI 应做到的约束 |
|------|------|------------------|
| 定义 **60 秒体验** | 一句 pitch + 首局目标 | 先收敛 scope，拒绝一次性堆砌系统 |
| **核心循环** | 输入 → 状态更新 → 反馈 → 结束条件 | 循环必须可在无网络下完整跑通 |
| **失败与再来一局** | 终局规则、是否复活、冷却 | 明确是否允许「付费/广告」介入点 |
| **会话边界** | 何为「一局」、何为 meta 进度 | 便于后续 `sessions` 与埋点设计 |
| **体验结构** | 压力、爽感、恢复、挑战、掌控感 | 用可观测信号表达心理目标，不写空泛愿景 |

**OpenBlock 对照**：`docs/domain/DOMAIN_KNOWLEDGE.md`、`product/DIFFICULTY_MODES.md`、`docs/player/EXPERIENCE_DESIGN_FOUNDATIONS.md`、`docs/player/STRATEGY_EXPERIENCE_MODEL.md`。

---

## 阶段 1：核心玩法层（状态机 + 规则）

| 步骤 | 做法 | 反模式 |
|------|------|--------|
| **单一真实状态** | 棋盘/实体状态放在一个纯逻辑模块（易测、无 DOM） | 状态散落在 UI |
| **规则外置** | 格子尺寸、形状库、计分参数 → JSON 或等价配置 | 魔法数字遍布代码 |
| **合法动作 API** | `tryMove` / `place` 返回明确错误枚举 | 静默失败 |
| **确定性** | 相同种子 + 相同输入序列 → 相同结局 | 隐式随机未播种 |
| **回放最小集** | 记录开局种子 + 决策序列（或关键帧） | 只录视频无法调试 |
| **策略快照** | 对关键决策记录输入、输出、诊断和拒绝原因 | 出了坏块但无法复盘 |

**OpenBlock 对照**：`web/src/grid.js`、`shared/game_rules.json`、`shared/shapes.json`、`web/src/moveSequence.js`。

---

## 阶段 2：表现与输入（渲染与手感）

| 步骤 | 做法 |
|------|------|
| **渲染与逻辑分离** | Canvas/DOM 只订阅状态 diff |
| **输入管线** | 拖拽/点击统一成「意图」再交给逻辑层 |
| **Juice** | 粒子/缩放/音效挂钩在明确事件上（消除、连击、失败） |
| **帧与耗电** | `requestAnimationFrame`、可见性节流、`docs/engineering/PERFORMANCE.md` 类策略 |
| **盘面锚点** | 浮层、候选块可移动区域、失败/提示 UI 以棋盘为中心，不以窗口为中心 |
| **画质档位** | 低/中/高画质对应粒子、帧率、水印漂移等明确开关 |
| **视觉 QA** | 截图中检查对比度、遮挡、文字可读性、可交互边界 |

**OpenBlock 对照**：`web/src/renderer.js`、`web/src/game.js`、`web/src/effects/`。

---

## 阶段 3：难度、关卡与自适应（可选但高杠杆）

| 步骤 | 做法 |
|------|------|
| **难度维度** | 显式参数（速度、密度、容错、奖励倍率） |
| **曲线** | 按会话进度或分数里程碑调参，而非硬编码关卡堆叠 |
| **自适应** | 用可观测信号（挫败、无聊、连胜）驱动权重；保留 **公平性与可解性约束** |
| **文档化假设** | 每个旋钮对应体验假设，便于 AB |
| **压力状态枚举** | high / medium / low 等状态写清判定条件、提示语和作用 |
| **盘面难度事实** | 难度不仅看填充率，也看空洞、近满线、解法数和机动性 |
| **奖励兑现** | 清屏、多消、同 icon 作为概率倾向；必须经过几何和可解性校验 |
| **高难顺序规划** | 可用 `orderRigor` 缩小可解排列数，但要保留至少一条序贯可解路径 |

**OpenBlock 对照**：`web/src/adaptiveSpawn.js`、`web/src/bot/blockSpawn.js`、`docs/algorithms/ADAPTIVE_SPAWN.md`、`docs/player/REALTIME_STRATEGY.md`、`product/CLEAR_SCORING.md`。

---

## 阶段 4：Meta、留存与社交壳（休闲刚需）

| 步骤 | 做法 |
|------|------|
| **进度** | XP/等级/解锁路径与核心分数脱钩一层，避免刷分破坏平衡 |
| **每日/每周循环** | 任务池小步可完成，奖励可预期 |
| **召回触点** | Push/邮件/订阅占位；权限与频次分离 |
| **社交轻量** | 排行榜、分享图、异步影子 PK（可选） |

**OpenBlock 对照**：`web/src/progression.js`、`monetization/dailyTasks.js`、`seasonPass.js`、`docs/product/RETENTION_ROADMAP_V10_17.md`。

---

## 阶段 5：商业化「插座」（先架构后 SDK）

| 步骤 | 做法 |
|------|------|
| **事件总线** | 玩法发事件， monetization 只订阅（最小侵入） |
| **Feature Flag** | 每条变现路径独立开关，默认安全关闭 |
| **适配器模式** | `setAdProvider` / `setIapProvider`；默认 Stub，上线替换 SDK |
| **服务端校验占位** | 订单幂等、收据验证接口预留，不信任纯前端 |

**OpenBlock 对照**：`web/src/monetization/`、`docs/operations/MONETIZATION.md`、`enterprise_extensions.py`、`docs/integrations/ADS_IAP_SETUP.md`。

---

## 阶段 6：数据、隐私与运营闭环

| 步骤 | 做法 |
|------|------|
| **黄金事件字典** | 事件名、`event_data` 形状版本化（文档 + CI 可选） |
| **会话模型** | `user_id`、`session_id`、时间戳单位（ms/s）统一 |
| **归因** | UTM / 渠道参数进入会话或首启快照 |
| **合规 API** | 同意记录、导出、删除路径在设计早期占位 |
| **策略可观测性** | 面板展示曲线优先，重复文本指标去重；每个指标能追溯到计算逻辑 |
| **样本质量** | 训练/分析样本记录 schema 版本、维度、来源和权重 |

**OpenBlock 对照**：`docs/engineering/GOLDEN_EVENTS.md`、`docs/engineering/SQLITE_SCHEMA.md`、`web/src/database.js`、`docs/operations/COMPLIANCE_AND_SOPS.md`。

---

## 阶段 7：多端与交付

| 步骤 | 做法 |
|------|------|
| **共享规则包** | 玩法 JSON 单一来源，Web/小程序同步契约 |
| **构建** | 现代打包（如 Vite）；环境变量区分 API  origin |
| **小程序差异** | 宿主 API、支付、开放数据会话分开适配层 |

**OpenBlock 对照**：`docs/platform/SYNC_CONTRACT.md`、`docs/platform/WECHAT_MINIPROGRAM.md`。

---

## 阶段 8：AI / RL（可选）

| 步骤 | 做法 |
|------|------|
| **环境与玩法契约** | 训练 env 与线上规则同源（共享配置） |
| **推理接口** | HTTP 或 WASM；超时与降级到启发式 |
| **离线门禁** | `eval` 脚本或 CI 可选一步 |
| **四类模型分工** | 启发式出块保公平；生成式出块学分布；PyTorch RL 学落子；浏览器 RL 做轻量演示/采样 |
| **特征字段字典** | 完整列出 `state`、`action`、`behaviorContext`、策略 hints 的物理含义 |
| **自博弈参考谱系** | 对照 TD-Gammon、AlphaGo/Zero、AlphaZero、Expert Iteration、MuZero、OpenSpiel，选择适合单人游戏的子集 |
| **搜索蒸馏** | `qTeacher / visit_pi` 先作为离线或轻量 teacher，不直接强制线上每步 MCTS |
| **模型图与损失** | 网络结构、优化目标、损失项用 Markdown 兼容格式写清，避免依赖特定渲染器 |
| **失败回退** | 模型输出非法、重复、不可放、超时或低机动性时回退规则轨 |

**OpenBlock 对照**：`rl_pytorch/`、`rl_backend.py`、`docs/algorithms/RL_PYTORCH_SERVICE.md`、`docs/algorithms/MODEL_SYSTEMS_FOUR_MODELS.md`、`web/src/bot/`。

---

## 阶段 9：质量与发布

| 步骤 | 做法 |
|------|------|
| **测试金字塔** | 核心逻辑单测 → 关键路径集成 → 手动清单 |
| **静态检查与构建** | ESLint、生产 build 进 CI |
| **运维** | 健康检查 `/api/health`、日志与备份 Runbook |
| **用户可感知回归** | 分数最佳特效、概率显示、压力状态、候选块边界等补专项测试 |
| **文档索引** | 新文档注册到 `docs/README.md` 和对应专题索引 |
| **无警告基线** | 修复已有 lint warning，避免真实问题被噪声淹没 |

**OpenBlock 对照**：`docs/engineering/TESTING.md`、`.github/workflows/ci.yml`。

---

## OpenBlock 迭代复盘模式

当开发中出现复杂策略、视觉体验或模型系统时，按这个循环推进：

1. **解释现状**：列出当前状态、字段、提示语、判定条件和代码入口。
2. **截图/回放复盘**：结合实际盘面或截图判断结果是否合理。
3. **定义物理含义**：把指标从缩写变成可解释字段，例如 fill、holes、solutionCount、stress、spawnIntent。
4. **修策略而非只修 UI**：如果显示暴露了策略缺陷，要回到算法判定和权重来源。
5. **代码与文档同改**：每个策略变更都同步更新算法文档、体验文档和索引。
6. **加回归测试**：凡是用户明确指出的体验 bug，都转成测试或检查清单。
7. **运行验证**：至少跑 lint；核心逻辑变更跑对应单测；文档变更检查链接和渲染兼容性。

适用例子：

- “等于最高分也触发 NEW BEST” → 明确 baseline、改严格大于、补回归测试。
- “压力状态为什么高压” → 拆解 fill、holes、nearFull、solutionCount、risk，再写入文档契约。
- “出块概率/快照指标看不懂” → 去重指标、优先曲线、字段改名、补物理含义。
- “Mermaid 没渲染” → 换成 Markdown 兼容文本框图，而不是要求用户换阅读器。

---

## AI 助手执行模板（可复制到对话）

```text
目标：[一句话游戏类型与平台]
约束：核心循环可离线、规则可配置、商业化可关闭

请按 CASUAL_GAME_BUILD_SKILL 阶段 0→9：
1. 列出最小可玩范围（MVP）与明确不做清单
2. 给出模块边界（状态 / 渲染 / meta / 数据）
3. 给出共享配置 schema 草稿（JSON）
4. 给出关键测试用例标题（不测 UI 像素）
5. 若含变现：只设计事件与适配器接口，不接真实 SDK
6. 若含策略/模型：列出字段物理含义、诊断面板、回退路径和文档更新点
```

---

## OpenBlock 仓库速查表

| 主题 | 路径或文档 |
|------|------------|
| 架构总览 | `ARCHITECTURE.md` |
| 工程地图 | `docs/engineering/PROJECT.md` |
| 二次开发 | `docs/engineering/DEV_GUIDE.md` |
| 数据库与 API | `docs/engineering/SQLITE_SCHEMA.md`、`docs/integrations/ENTERPRISE_EXTENSIONS.md` |
| 商业化清单 | `docs/operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md` |
| 体验策略 | `docs/player/EXPERIENCE_DESIGN_FOUNDATIONS.md`、`docs/player/STRATEGY_EXPERIENCE_MODEL.md` |
| 实时策略链路 | `docs/player/REALTIME_STRATEGY.md` |
| 四模型系统 | `docs/algorithms/MODEL_SYSTEMS_FOUR_MODELS.md` |

---

## 与其他项目复用方式

1. **整份 Skill**：复制本文档到新仓库 `docs/` 或 Wiki，并按项目改名。  
2. **Cursor**：将 `.cursor/skills/casual-game-build/` 目录一并复制，或在 User Rules 中引用本文档 URL/path。  
3. **维护**：玩法或管线变更时，只改「阶段」中与该项目相符的小节，避免 fork 全文失控。
