# Player System Docs

玩家能力画像、实时策略、面板参数与玩法风格检测文档。

## 总——设计理念与体验框架

- [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) —— **顶层方法论**：9条心理学经验研究（心流/SDT/变比强化）→ 7条休闲游戏工业设计理念 → 5轴体验结构 + 设计审查清单（8问）
- [策略体验栈模型](./STRATEGY_EXPERIENCE_MODEL.md) —— L1–L4四层通用模型：状态估计 → 策略解析 → 内容生成 → 体验呈现；`spawnIntent` 枚举、压力叙事职责分离、几何门控
- [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) —— **主策划契约**：以"挑战自我最佳分"为核心主线，四维差异化矩阵（S×M×D×P）、设计哲学（差一点效应/Near-Miss/PB节奏锚点）

## 分——实时策略与评估

- [实时策略系统](../algorithms/REALTIME_STRATEGY.md) —— L1指标字典（thinkMs/pickToPlaceMs/clearRate等20+滑动窗口）、stress管线公式、6档压力表、策略卡与决策树、合理性评估清单（v1.68 起归类至 `docs/algorithms/`）
- [玩法风格检测](../algorithms/REALTIME_STRATEGY.md#玩法偏好识别与出块联动) —— 从滑动窗口推算多消率/清屏率/平均消除条数，`playstyle` 枚举（`perfect_hunter` / `multi_clear` / `combo` / `survival` / `balanced`）与出块对齐轻推机制
- [玩家能力评估](./PANEL_PARAMETERS.md#附录玩家能力评估产品语义与接入说明) —— `AbilityVector` 7维输出字段的产品语义、消费方、作用机制（→stress修正→面板展示→回放快照）、调参与验证方式
- [玩家面板参数手册](./PANEL_PARAMETERS.md) —— 面板5个功能区、每个参数的数学定义/物理含义/取值范围/系统作用/异常解读（694行完整参考）

## 分——下游算法参考

- [玩家画像算法手册](../algorithms/ALGORITHMS_PLAYER_MODEL.md)：公式、特征、参数、`AbilityVector`、建模方法和评估指标（位于 `docs/algorithms/`）

## 阅读路径建议

| 角色 | 起点 | 后续 |
|------|------|------|
| **主策划 / 策略设计师** | [产品架构图](../architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §二–§四 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) → [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) → [生命周期蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) |
| **新加入的设计师/产品** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) §一→§三→§四 | [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) → [实时策略系统](../algorithms/REALTIME_STRATEGY.md) → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) |
| **算法工程师调参** | [实时策略系统](../algorithms/REALTIME_STRATEGY.md) §三 + §五 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) §三 互抑表 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §四 |
| **测试 / 质量** | [实时策略系统](../algorithms/REALTIME_STRATEGY.md) §六 评审清单 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) §四 审查清单 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §六 验证清单 |
| **运营 / 商业化** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) §二（2.7）| [`docs/domain/DOMAIN_KNOWLEDGE.md`](../domain/DOMAIN_KNOWLEDGE.md) §13 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §4.12（PB事件总线对接） |

适合产品、算法、运营和测试角色理解玩家状态如何影响体验与策略。
