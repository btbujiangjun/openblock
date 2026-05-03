# OpenBlock 测试指南

> 面向贡献者、QA、算法和产品的验证入口。目标不是只“跑过测试”，而是证明玩法、算法、数据和体验没有回归。

## 1. 测试分层

| 层级 | 关注点 | 主要证据 |
|------|--------|----------|
| 单元测试 | Grid、形状、计分、技能、出块、商业化规则等局部行为 | `npm test` |
| 静态检查 | ESM、未使用变量、明显 API 调用错误 | `npm run lint` |
| 构建验证 | Vite 打包、资源引用、模块依赖 | `npm run build` |
| 算法回归 | 出块公平性、心流调节、RL 数值稳定、指标趋势 | 针对性测试 + 看板指标 |
| 手动体验 | 拖拽、动效、面板、回放、移动端/小程序适配 | 测试清单与截图/录屏 |

## 2. 本地验证命令

```bash
npm test
npm run lint
npm run build
```

PyTorch 策略 checkpoint 的**离线贪心评估**（与网页看板滑动统计独立）：`npm run rl:eval -- --checkpoint rl_checkpoints/bb_policy.pt --n-games 128 --rounds 3`。说明见 [RL_PYTORCH_SERVICE.md](../algorithms/RL_PYTORCH_SERVICE.md)。

前端性能相关策略与回归清单见 [PERFORMANCE.md](./PERFORMANCE.md)。

按场景可补充：

```bash
npm run dev
npm run server
npm run server:rl
```

Python RL 或 spawn model 相关改动，应额外运行对应 Python 测试或最小训练/推理 smoke test。若改动涉及 MPS/CUDA，记录设备、环境变量和训练日志路径。

## 3. 核心回归清单

### 3.1 玩法与棋盘

- 方块能否正确放置、拒绝非法位置、触发行/列消除。
- `CLEAR_SCORING.md` 中的多消、bonus 线、整十分约束是否仍成立。
- 关卡、复活、技能道具不会绕过核心棋盘不变量。
- 回放序列能记录 `spawn/place/end`，并可还原关键过程。

相关测试：`tests/grid.test.js`、`tests/grid-extended.test.js`、`tests/clearRules.test.js`、`tests/bonusLineFeature.test.js`、`tests/moveSequence*.test.js`。

### 3.2 出块与难度

- 三连块满足最低机动性与中高填充下的序贯可解性。
- `adaptiveSpawn` 的心流、挫败、恢复、爽感兑现不会破坏公平性约束。
- `shared/game_rules.json` 改动后，Web 与小程序规则保持一致。
- 高填充、久未消行、清屏准备、多消机会四类局面都要有样例验证。

相关测试：`tests/blockSpawn.test.js`、`tests/adaptiveSpawn.test.js`、`tests/spawnLayers.test.js`、`tests/difficulty.test.js`。

### 3.3 玩家画像与策略

- `skillLevel`、`flowState`、`frustrationLevel`、`momentum` 在典型行为序列下符合预期。
- UI 面板指标与算法输出一致，tooltip 不误导。
- `StrategyAdvisor` 的建议与当前局面和 spawn diagnostics 对齐。

相关测试：`tests/playerProfile.test.js`、`tests/playstyle.test.js`、`tests/strategyEngine.test.js`、`tests/hintEngine.test.js`。

### 3.4 RL 与训练看板

- 特征维度与 `shared/game_rules.json.featureEncoding` 一致。
- 训练日志不应出现持续 `NaN/Inf`、异常大的 `loss_value` 或长期 `optimizer_step=false`。
- 看板摘要、趋势图、skip reason 与后端 `training.jsonl` 对齐。
- 改 reward、feature、action 维度时，旧 checkpoint 默认视为不兼容。

相关测试与文档：`tests/features.test.js`、`tests/simulator.test.js`、[RL 数值稳定](../algorithms/RL_TRAINING_NUMERICAL_STABILITY.md)、[训练看板趋势](../algorithms/RL_TRAINING_DASHBOARD_TRENDS.md)。

### 3.5 商业化与运营

- 广告/IAP 默认 Stub 模式不影响核心游戏。
- 触发策略满足频控，不在新手、焦虑或高风险局面造成体验打断。
- 运营面板和后端策略日志字段一致。

相关测试：`tests/monetization.test.js`、`tests/adFreq.test.js`、`tests/abTest.test.js`。

### 3.6 平台与内容

- 小程序核心逻辑同步后，API 差异有适配层而不是散落判断。
- 新皮肤满足 icon 唯一性、语义一致性和渲染管线约束。
- i18n 文案新增时，同步语言包和 DOM key。

相关测试：`tests/i18n.test.js`、`tests/shapes.test.js`、`tests/blockPool.test.js`。

## 4. 提交前检查

| 改动类型 | 最低验证 |
|----------|----------|
| 文档 | 链接有效、术语与代码一致、更新文档中心索引 |
| UI / CSS | `npm run build` + 手动打开关键面板 |
| 游戏规则 | `npm test` + 出块/计分/棋盘相关测试 |
| `game_rules.json` | Web/小程序配置同步 + 特征维度影响评估 |
| 出块算法 | `blockSpawn` / `adaptiveSpawn` 测试 + 高填充手动局面 |
| RL 训练 | feature/simulator 测试 + 最小训练 smoke test + 看板日志 |
| 商业化 | monetization/adFreq 测试 + Stub 模式手动验证 |

## 5. 缺陷报告模板

提交 issue 或 PR 说明时，建议包含：

- 复现步骤：从启动命令到具体操作。
- 实际结果与期望结果。
- 影响范围：Web、小程序、后端、RL、文档。
- 证据：控制台日志、测试输出、截图、回放 session id、训练日志片段。
- 环境：OS、浏览器、Node、Python、是否启用 RL 后端。

## 6. 测试设计原则

- 优先覆盖不变量：棋盘合法性、可解性、配置维度、数据持久化格式。
- 算法测试用“构造局面 + 预期趋势”，避免依赖完全随机的单次结果。
- 对体验策略测试区间和方向，不测试某个随机样本必须出现。
- 每个新配置项都应有默认值、边界值和文档说明。
- 对跨端副本保持同步验证，避免 Web 修复、小程序回归。
