# Player System Docs

玩家能力画像、实时策略、面板参数和玩法风格检测文档。

## 当前事实入口

- [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) — **顶层方法论**：心理学根基（9 条经验研究）→ 休闲游戏设计理念（7 条工业实践）→ OpenBlock 5 轴体验结构 + 设计审查清单（v1.32 新增 `orderRigor` 正例验证 — Yerkes-Dodson 上限延展）
- [挑战个人最佳分策略设计](./BEST_SCORE_CHALLENGE_STRATEGY.md) — 面向主策划人与策略算法设计师：围绕“挑战自己但不轻易破纪录”的体验结构、当前实现审计、生命周期/成熟度分层策略与优化路线
- [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) — 通用四层模型、`spawnIntent`、几何门控与 OpenBlock 映射（v1.32 新增顺序刚性高难度算法升级章节）
- [玩家能力评估接入说明](./PLAYER_ABILITY_EVALUATION.md)
- [玩家面板参数](./PANEL_PARAMETERS.md)
- [实时策略系统](./REALTIME_STRATEGY.md) — 指标定义、物理含义、策略生成与合理性评估（v2.0；v1.32 起 spawnHints 矩阵新增 `orderRigor` / `orderMaxValidPerms` + 互抑表新增三条 bypass）
- [玩法风格检测](./PLAYSTYLE_DETECTION.md)

## 阅读路径建议

| 角色 | 起点 | 后续 |
|------|------|------|
| **新加入的设计师/产品** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part A→C→D | [挑战个人最佳分策略设计](./BEST_SCORE_CHALLENGE_STRATEGY.md) → [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md) → [实时策略系统](./REALTIME_STRATEGY.md) |
| **算法工程师调参** | [实时策略系统](./REALTIME_STRATEGY.md) §3 + §5 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part C 互抑表 |
| **测试 / 质量** | [实时策略系统](./REALTIME_STRATEGY.md) §6 评审清单 | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part D 审查清单 |
| **运营 / 商业化** | [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md) Part B（B.7）| `docs/domain/CASUAL_GAME_ANALYSIS.md` §10 |

## 算法权威文档

- [玩家画像算法手册](../algorithms/ALGORITHMS_PLAYER_MODEL.md)：公式、特征、参数、AbilityVector、建模方法和评估指标。

适合产品、算法、运营和测试角色理解玩家状态如何影响体验与策略。
