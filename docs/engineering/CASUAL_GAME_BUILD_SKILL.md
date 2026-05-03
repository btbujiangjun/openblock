# 休闲游戏全栈构建 Skill（OpenBlock 沉淀版）

> **用途**：供 Cursor、OpenCode、Codex 等 AI 编码助手在**从零或增量开发休闲游戏**时作为工作流与检查清单；以本仓库工程实践为事实来源。  
> **项目内 Skill 文件**：`.cursor/skills/casual-game-build/SKILL.md`（Cursor Agent 可加载）。  
> **全部 Skill 索引**：[CURSOR_SKILLS.md](./CURSOR_SKILLS.md)（含可选用个人 Skill 场景表）。  
> **版本**：1.0 · 2026-05-03

---

## 何时加载本 Skill

在用户提到「做一款休闲游戏 / 超休闲 / 益智消除 / 关卡无尽 / 要上小程序或 Web / 要接广告内购 / 要留存任务」等场景时，按下列**阶段顺序**拆解任务，并优先采用 **规则数据化、模块边界清晰、可测试、可渐进商业化** 的交付方式。

---

## 阶段 0：产品与核心循环（先于写代码）

| 步骤 | 产出 | AI 应做到的约束 |
|------|------|------------------|
| 定义 **60 秒体验** | 一句 pitch + 首局目标 | 先收敛 scope，拒绝一次性堆砌系统 |
| **核心循环** | 输入 → 状态更新 → 反馈 → 结束条件 | 循环必须可在无网络下完整跑通 |
| **失败与再来一局** | 终局规则、是否复活、冷却 | 明确是否允许「付费/广告」介入点 |
| **会话边界** | 何为「一局」、何为 meta 进度 | 便于后续 `sessions` 与埋点设计 |

**OpenBlock 对照**：`docs/domain/DOMAIN_KNOWLEDGE.md`、`product/DIFFICULTY_MODES.md`。

---

## 阶段 1：核心玩法层（状态机 + 规则）

| 步骤 | 做法 | 反模式 |
|------|------|--------|
| **单一真实状态** | 棋盘/实体状态放在一个纯逻辑模块（易测、无 DOM） | 状态散落在 UI |
| **规则外置** | 格子尺寸、形状库、计分参数 → JSON 或等价配置 | 魔法数字遍布代码 |
| **合法动作 API** | `tryMove` / `place` 返回明确错误枚举 | 静默失败 |
| **确定性** | 相同种子 + 相同输入序列 → 相同结局 | 隐式随机未播种 |
| **回放最小集** | 记录开局种子 + 决策序列（或关键帧） | 只录视频无法调试 |

**OpenBlock 对照**：`web/src/grid.js`、`shared/game_rules.json`、`shared/shapes.json`、`web/src/moveSequence.js`。

---

## 阶段 2：表现与输入（渲染与手感）

| 步骤 | 做法 |
|------|------|
| **渲染与逻辑分离** | Canvas/DOM 只订阅状态 diff |
| **输入管线** | 拖拽/点击统一成「意图」再交给逻辑层 |
| **Juice** | 粒子/缩放/音效挂钩在明确事件上（消除、连击、失败） |
| **帧与耗电** | `requestAnimationFrame`、可见性节流、`docs/engineering/PERFORMANCE.md` 类策略 |

**OpenBlock 对照**：`web/src/renderer.js`、`web/src/game.js`、`web/src/effects/`。

---

## 阶段 3：难度、关卡与自适应（可选但高杠杆）

| 步骤 | 做法 |
|------|------|
| **难度维度** | 显式参数（速度、密度、容错、奖励倍率） |
| **曲线** | 按会话进度或分数里程碑调参，而非硬编码关卡堆叠 |
| **自适应** | 用可观测信号（挫败、无聊、连胜）驱动权重；保留 **公平性与可解性约束** |
| **文档化假设** | 每个旋钮对应体验假设，便于 AB |

**OpenBlock 对照**：`web/src/adaptiveSpawn.js`、`docs/algorithms/ADAPTIVE_SPAWN.md`、`product/CLEAR_SCORING.md`。

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

**OpenBlock 对照**：`rl_pytorch/`、`rl_backend.py`、`docs/algorithms/RL_PYTORCH_SERVICE.md`、`web/src/bot/`。

---

## 阶段 9：质量与发布

| 步骤 | 做法 |
|------|------|
| **测试金字塔** | 核心逻辑单测 → 关键路径集成 → 手动清单 |
| **静态检查与构建** | ESLint、生产 build 进 CI |
| **运维** | 健康检查 `/api/health`、日志与备份 Runbook |

**OpenBlock 对照**：`docs/engineering/TESTING.md`、`.github/workflows/ci.yml`。

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

---

## 与其他项目复用方式

1. **整份 Skill**：复制本文档到新仓库 `docs/` 或 Wiki，并按项目改名。  
2. **Cursor**：将 `.cursor/skills/casual-game-build/` 目录一并复制，或在 User Rules 中引用本文档 URL/path。  
3. **维护**：玩法或管线变更时，只改「阶段」中与该项目相符的小节，避免 fork 全文失控。
