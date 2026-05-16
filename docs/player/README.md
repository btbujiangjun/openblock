# Player System Docs

玩家能力画像、实时策略、面板参数和玩法风格检测文档。

## 当前事实入口

- [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) — **顶层方法论**：心理学根基（9 条经验研究）→ 休闲游戏设计理念（7 条工业实践）→ OpenBlock 5 轴体验结构 + 设计审查清单（v1.32 新增 `orderRigor` 正例验证 — Yerkes-Dodson 上限延展）
- [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) — 通用四层模型、`spawnIntent`、几何门控与 OpenBlock 映射（v1.32 新增顺序刚性高难度算法升级章节）
- [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) — **主策划契约**：以"挑战自我最佳分"为核心主线的策略事实清单、S×M×D×P 四维差异化矩阵、13 项改进与优化项编号（v1.55 已全部落地：50 个新单测、`bestScoreBuckets.js` 模块、`challengeBoostBypass` / `postPbReleaseStressAdjust` 等新 stress 字段）
- [玩家能力评估接入说明](./PLAYER_ABILITY_EVALUATION.md)
- [玩家面板参数](./PANEL_PARAMETERS.md)
- [实时策略系统](./REALTIME_STRATEGY.md) — 指标定义、物理含义、策略生成与合理性评估（v2.0；v1.32 起 spawnHints 矩阵新增 `orderRigor` / `orderMaxValidPerms` + 互抑表新增三条 bypass）
- [玩法风格检测](./PLAYSTYLE_DETECTION.md)

## 阅读路径建议

| 角色 | 起点 | 后续 |
|------|------|------|
| **主策划 / 策略设计师** | [OpenBlock 产品架构图](../architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §1–§3 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) → [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) → [生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) |
| **新加入的设计师/产品** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part A→C→D | [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) → [实时策略系统](./REALTIME_STRATEGY.md) → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) |
| **算法工程师调参** | [实时策略系统](./REALTIME_STRATEGY.md) §3 + §5 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part C 互抑表 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §3 |
| **测试 / 质量** | [实时策略系统](./REALTIME_STRATEGY.md) §6 评审清单 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part D 审查清单 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §6 验证清单 |
| **运营 / 商业化** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part B（B.7）| `docs/domain/CASUAL_GAME_ANALYSIS.md` §10 → [最佳分追逐策略](./BEST_SCORE_CHASE_STRATEGY.md) §4.12（PB 事件总线对接） |

## 算法权威文档

- [玩家画像算法手册](../algorithms/ALGORITHMS_PLAYER_MODEL.md)：公式、特征、参数、AbilityVector、建模方法和评估指标。

适合产品、算法、运营和测试角色理解玩家状态如何影响体验与策略。
