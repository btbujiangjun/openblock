# Contributing to OpenBlock

感谢你对 OpenBlock 的贡献兴趣！本文档说明如何参与开发。

---

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [测试要求](#测试要求)
- [文档贡献](#文档贡献)
- [模块开发指引](#模块开发指引)

---

## 行为准则

- 尊重所有贡献者，包容不同背景和经验
- 聚焦技术讨论，避免人身攻击
- 代码评审以改进为目的，非批评个人

---

## 如何贡献

### 报告 Bug

1. 搜索已有 [Issues](https://github.com/btbujiangjun/openblock/issues)，避免重复
2. 使用 [Bug Report 模板](.github/ISSUE_TEMPLATE/bug_report.md)
3. 包含：复现步骤、期望行为、实际行为、环境信息（OS、Node.js/Python 版本、浏览器）

### 功能建议

1. 使用 [Feature Request 模板](.github/ISSUE_TEMPLATE/feature_request.md)
2. 说明使用场景和动机
3. 大功能建议先讨论再开始实现

### Pull Request 流程

```bash
# 1. Fork 仓库，克隆到本地
git clone https://github.com/YOUR_NAME/openblock.git
cd openblock

# 2. 创建功能分支（基于 main）
git checkout -b feat/your-feature-name
# 或: fix/issue-description、docs/update-topic

# 3. 开发并测试
npm install && pip install -r requirements.txt
npm run dev    # 验证功能
npm test       # 运行测试
npm run lint   # 检查代码规范

# 4. 提交（遵循提交规范）
git add .
git commit -m "feat(spawn): add custom spawn profile support"

# 5. 推送并创建 PR
git push origin feat/your-feature-name
# 在 GitHub 上创建 PR，使用 PR 模板填写说明
```

---

## 开发环境

### 环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 18.0+ | 前端开发与构建 |
| Python | 3.10+ | 后端与 RL 训练 |
| pip | 23.0+ | Python 包管理 |

### 快速配置

```bash
# 前端依赖
npm install

# 后端依赖（基础）
pip install -r requirements.txt

# RL 训练依赖（可选）
pip install -r requirements-rl.txt

# 环境变量
cp .env.example .env
# 根据需要编辑 .env
```

### 双进程开发

```bash
# 终端 1：Vite 前端（含热更新）
npm run dev

# 终端 2：Flask 后端（含 auto-reload）
npm run server
```

访问 `http://localhost:3000`（前端），`http://localhost:5000/docs`（文档中心）。

---

## 代码规范

### JavaScript（前端）

- **ESM 模块**：使用 `import/export`，不使用 CommonJS
- **JSDoc**：公开函数和类必须有 JSDoc 注释，包括 `@param`、`@returns`
- **命名**：
  - 文件：`camelCase.js`（如 `playerProfile.js`）
  - 常量：`UPPER_SNAKE_CASE`
  - 私有变量：`_underscore` 前缀
- **无副作用 import**：模块 import 不应触发 DOM 操作或网络请求
- **错误处理**：异步函数用 `try/catch`，不静默吞掉错误（至少 `console.error`）

```js
// ✅ 好的示例
/**
 * 展示激励广告
 * @param {string} reason 触发原因，用于 UI 展示
 * @returns {Promise<{ rewarded: boolean }>}
 */
export async function showRewardedAd(reason = '') {
    if (!getFlag('adsRewarded')) return { rewarded: false };
    try {
        return await _provider.showRewarded(reason);
    } catch (e) {
        console.error('[AdAdapter] showRewardedAd failed:', e);
        return { rewarded: false };
    }
}

// ❌ 避免
export async function showAd(r) {
    return _p.show(r); // 无类型信息、无错误处理
}
```

### Python（后端）

- **类型注解**：函数签名使用类型注解
- **Docstring**：公开函数写 Google 风格 docstring
- **错误处理**：API 路由统一返回 JSON 格式错误信息
- **SQL**：使用参数化查询，禁止字符串拼接 SQL

```python
# ✅ 好的示例
def _compute_user_profile(db: sqlite3.Connection, user_id: str) -> dict:
    """计算用户商业化画像并缓存到 mon_user_segments。

    Args:
        db: SQLite 连接
        user_id: 用户唯一标识

    Returns:
        包含 segment, whaleScore, strategy 等字段的字典
    """
    ...
```

### 通用原则

- **最小侵入**：商业化、RL 等可选模块不修改游戏核心（`game.js`、`grid.js`）
- **配置外化**：阈值、权重等数值写入 `shared/game_rules.json` 或 `.env`，不硬编码
- **向后兼容**：修改公开 API 需要在 PR 中说明迁移路径
- **可测试性**：新功能配套单元测试

---

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

[可选 body]

[可选 footer]
```

**Type**：

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `refactor` | 重构（不含新功能或修复） |
| `test` | 测试相关 |
| `chore` | 构建/工具链/依赖更新 |
| `perf` | 性能优化 |

**Scope**（可选）：`game`、`spawn`、`rl`、`monetization`、`player`、`backend`、`docs`

**示例**：
```
feat(spawn): add custom stress profile support via game_rules.json

Allow external developers to define custom stress-to-weight profiles
without modifying adaptiveSpawn.js engine code.

Closes #42
```

---

## 测试要求

### 运行测试

```bash
npm test          # 全量测试（Vitest）
npm test -- --reporter=verbose  # 详细输出
```

### 测试覆盖范围

| 模块 | 测试文件 | 覆盖点 |
|------|---------|--------|
| 核心游戏 | `tests/grid.test.js` | 放置、消行、终局判定 |
| 配置 | `tests/config.test.js` | API URL、策略常量 |
| 商业化 | `tests/monetization.test.js` | 广告、IAP、任务、赛季、个性化 |

### 新功能测试要求

- 新增商业化模块：需有对应的集成测试（`tests/monetization.test.js`）
- 新增核心功能：需有单元测试
- Bug 修复：需有回归测试防止复现

### 测试编写规范

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MyModule', () => {
    beforeEach(() => {
        // 重置状态，避免测试间污染
    });

    it('should do something specific', () => {
        // Arrange - Given
        // Act - When
        // Assert - Then
        expect(result).toBe(expected);
    });
});
```

---

## 文档贡献

### 文档位置

| 类型 | 位置 | 说明 |
|------|------|------|
| 用户文档 | `docs/*.md` | 在 `/docs` 页面展示 |
| 架构文档 | `ARCHITECTURE.md` | 系统设计 |
| 开发指南 | `docs/DEV_GUIDE.md` | 二次开发 |
| API 文档 | JSDoc 注释 | 通过注释生成 |

### 文档规范

- Markdown 格式，UTF-8 编码
- 标题层次清晰（H1 → H2 → H3）
- 代码块标注语言（` ```js `、` ```python `）
- 数字/数据来源于代码，不凭空编造
- 修改代码后同步更新相关文档

---

## 模块开发指引

### 新增商业化模块

详见 [docs/DEV_GUIDE.md](docs/DEV_GUIDE.md#2-新增商业化模块)。最小模板：

```js
// web/src/monetization/myModule.js
import { on } from './MonetizationBus.js';
import { getFlag } from './featureFlags.js';

/**
 * 初始化我的模块
 * @returns {() => void} 清理函数
 */
export function initMyModule() {
    if (!getFlag('myModule')) return () => {};

    const unsub = on('game_over', ({ data, game }) => {
        // 处理游戏结束事件
    });

    return unsub; // 返回清理函数
}
```

在 `featureFlags.js` 的 `FLAG_DEFAULTS` 中添加对应开关，  
在 `monetization/index.js` 的 `initMonetization` 中调用初始化。

### 新增出块策略

修改 `shared/game_rules.json` 中的 `adaptiveSpawn` 配置，无需触碰引擎代码：

```json
{
  "adaptiveSpawn": {
    "profiles": [
      { "stress": -0.2, "shapeWeights": { "small": 0.7, "medium": 0.3 } },
      { "stress":  0.5, "shapeWeights": { "small": 0.3, "medium": 0.5, "large": 0.2 } }
    ]
  }
}
```

详见 [docs/STRATEGY_GUIDE.md](docs/STRATEGY_GUIDE.md)。

---

## 问题与讨论

- **Bug 报告**：使用 GitHub Issues
- **功能讨论**：使用 GitHub Discussions
- **架构问题**：在 PR 中 @ 维护者

感谢你的贡献！🎮
