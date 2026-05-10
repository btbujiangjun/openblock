# Cursor Skills 索引（学习与使用）

> **目的**：集中说明在本仓库中如何发现、启用与配合 **Cursor Agent Skills**（及同类 AI IDE 可读的 `SKILL.md`），便于学习与日常开发。  
> **Cursor 官方概念**：Skill 为带 YAML 头信息的 `SKILL.md`，由 Agent 按 `description` 匹配或用户显式 `@` 引用。

---

## 1. Skill 存放位置（优先级）

| 位置 | 路径 | 适用场景 |
|------|------|----------|
| **本仓库（团队共享）** | `.cursor/skills/<skill-name>/SKILL.md` | 克隆本仓库即可被 Cursor 扫描；适合项目专属流程 |
| **个人全局** | `~/.cursor/skills/<skill-name>/SKILL.md` | 仅本机账号；适合个人偏好、跨项目复用 |
| **文档-only（无 SKILL 文件）** | `docs/engineering/*.md` | 给人读或由 Rules 引用；Agent 不会自动当 Skill 加载 |

> 勿在仓库中提交 `~/.cursor/skills-cursor/`（该目录为 Cursor 内置 Skill，由产品维护）。

---

## 2. 本仓库已注册的 Project Skills

下列目录已纳入版本控制，可直接在 Cursor 对话中通过 **Skill 名称**或 **`@`** 面板选用（具体交互以当前 Cursor 版本为准）。

| Skill `name` | 目录 | 何时使用 |
|--------------|------|----------|
| `casual-game-build` | [`.cursor/skills/casual-game-build/`](../../.cursor/skills/casual-game-build/SKILL.md) | 从零或增量搭建休闲游戏：核心循环、规则数据化、体验策略、自适应出块、模型/RL、自博弈、截图 UI QA、商业化插座、数据与 CI；完整正文见 [CASUAL_GAME_BUILD_SKILL.md](./CASUAL_GAME_BUILD_SKILL.md) |

**深化阅读（非 Skill 文件，但与 AI 协作强相关）**

| 文档 | 用途 |
|------|------|
| [CASUAL_GAME_BUILD_SKILL.md](./CASUAL_GAME_BUILD_SKILL.md) | 休闲游戏全栈阶段清单、OpenBlock 复盘原则与策略/模型/RL 映射 |
| [DEV_GUIDE.md](./DEV_GUIDE.md) | 二次开发与扩展约定 |
| [TESTING.md](./TESTING.md) | 提交前验证命令与回归范围 |
| [GOLDEN_EVENTS.md](./GOLDEN_EVENTS.md) | 埋点与事件命名约定 |

---

## 3. 可选用：建议在个人目录安装的技能（官方 / 社区模板）

下列 Skill 常见于 Cursor 附带或文档示例，**默认不在本仓库内**；需要时在个人目录创建 `~/.cursor/skills/<name>/SKILL.md`，或从 Cursor 文档 / 模板复制。

| 场景 | 建议 Skill 主题 | 说明 |
|------|-----------------|------|
| PR 合并前修 CI、处理评论 | `babysit` 类 | 保持分支可合并状态 |
| 大改动拆多个 PR | `split-to-prs` 类 | 降低审查粒度 |
| 数据表、审计报告、Dashboard | `canvas` 类 | 适合可视化交付物 |
| 编写 Cursor Hooks | `create-hook` 类 | 自动化 Agent 事件 |
| 编写 `.cursor/rules` | `create-rule` 类 | 持久化项目规范 |
| 新建 Skill 骨架 | `create-skill` 类 | 统一 `SKILL.md` 结构 |
| `@cursor/sdk` 自动化 | `cursor-sdk` 类 | 脚本化调用 Agent |
| CLI 状态栏 | `statusline` 类 | 终端提示增强 |
| 改 VS Code/Cursor `settings.json` | `update-cursor-settings` 类 | 统一编辑器配置 |

安装后，在 **Cursor Settings → Rules / Skills**（或等价入口）中确认已启用；详细步骤以 [Cursor 文档](https://cursor.com/docs) 为准。

---

## 4. 与本仓库协作时的推荐用法

1. **改玩法 / 新休闲原型**：启用 **`casual-game-build`**，并打开 `docs/engineering/CASUAL_GAME_BUILD_SKILL.md`。  
2. **改后端 / SQLite / 企业扩展**：在 Rules 或对话中引用 `docs/engineering/SQLITE_SCHEMA.md`、`docs/integrations/ENTERPRISE_EXTENSIONS.md`。  
3. **提交 PR 前**：本地执行 `npm test`、`npm run lint`、`npm run build`（与 CI 一致）；需要时可搭配个人 **`babysit`** 类 Skill。  
4. **新建项目级 Skill**：复制 `.cursor/skills/casual-game-build/` 结构，修改 `name` 与 `description`，并向本文档 **§2** 追加一行登记。

---

## 5. 维护约定（贡献者）

- 新增 **仓库内** Skill：必须包含合法 YAML（`name` + `description`），且在本文件 **§2** 表格中登记。  
- 同时在 `server.py` 的 `_DOC_CATEGORIES` 中若新增独立说明文档，应把 **本文档** 或新子页加入「工程与扩展」分类（见文档中心侧栏）。  
- Skill 正文过长时：`SKILL.md` 保持摘要，权威长文放在 `docs/engineering/` 并由 Skill 链接。

---

## 相关链接

- 文档中心首页：[docs/README.md](../README.md)  
- 架构：[ARCHITECTURE.md](../../ARCHITECTURE.md)
