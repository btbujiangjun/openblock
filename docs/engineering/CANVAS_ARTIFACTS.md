# Canvas 转换文档索引

> **定位**：登记已从 Cursor Canvas 转换而来的 Markdown 文档，便于从文档中心直接阅读、检索和维护。  
> **原则**：文档中心只注册 `docs/` 内的 Markdown 文档；Canvas 是可视化草稿或分析来源，不作为侧栏入口。  
> **维护要求**：新增或修改 Canvas 后，应先转换为对应 Markdown 文档，再把 Markdown 文档注册到文档中心。

---

## 1. 使用方式

| 场景 | 做法 |
|------|------|
| 阅读稳定结论 | 从下表打开对应 `docs/` Markdown 文档 |
| 追溯来源 | 查看“来源 Canvas”列，确认原始可视化稿 |
| 更新分析 | 先修改 Canvas 或直接修改 Markdown；若 Canvas 仍保留，需同步更新转换文档 |
| 注册文档 | 只把 Markdown 文档加入 `server.py` 的 `_DOC_CATEGORIES` |

---

## 2. 已转换文档登记

### 2.1 全球化、用户研究与个性化

| 文档 | 来源 Canvas | 内容 |
|------|-------------|------|
| [全球休闲游戏个性化策略与调研方案](../domain/GLOBAL_CASUAL_GAME_RESEARCH.md) | `global-casual-game-research.canvas.tsx` | 全球市场、地区文化、年龄、性别、敏感属性边界、调研执行方案与 OpenBlock 个性化策略映射 |

### 2.2 玩法、产品与留存

| 文档 | 来源 Canvas | 内容 |
|------|-------------|------|
| [彩蛋 / 惊喜路线图](../product/EASTER_EGGS_ROADMAP.md) | `easter-eggs-roadmap.canvas.tsx` | 彩蛋、感官反馈、皮肤微动效、节日换皮、主动道具、隐藏惊喜、签到经济和社交分享机会池 |
| [玩家留存 / 活跃提升路线图](../product/PLAYER_RETENTION_ROADMAP.md) | `player-retention-roadmap.canvas.tsx` | 留存、活跃、任务、召回、社交和长期成长的路线图分析 |

### 2.3 出块、候选块与玩法解释

| 文档 | 来源 Canvas | 内容 |
|------|-------------|------|
| [候选块概率图鉴](../algorithms/CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md) | `candidate-blocks.canvas.tsx` | 28 个候选块形状、类别、基础概率、难度 profile 和动态因子的解释 |

### 2.4 RL、自博弈与算法分析

| 文档 | 来源 Canvas | 内容 |
|------|-------------|------|
| [RL v9.1 深度分析](../algorithms/RL_V9_1_DEEP_ANALYSIS.md) | `rl-v9-1-deep-analysis.canvas.tsx` | RL v9.1 训练瓶颈、优先修复项、实验方案和价值归一化问题 |
| [RL v9.3 提分深度分析](../algorithms/RL_V9_3_SCORE_BREAKTHROUGH_ANALYSIS.md) | `rl-v9-3-score-breakthrough-analysis.canvas.tsx` | 搜索 teacher、beam/MCTS、replay 新鲜度、评估口径和 bonus auxiliary 的提分分析 |
| [OpenBlock RL 自博弈提升路线图](../algorithms/RL_SELF_PLAY_ROADMAP.md) | `rl-self-play-roadmap.canvas.tsx` | 自博弈改进路线、搜索蒸馏、credit assignment、curriculum 和 OpenBlock 适配 |
| [自博弈 RL 文献对照与 OpenBlock 适配](../algorithms/RL_SELF_PLAY_LITERATURE_COMPARISON.md) | `rl-self-play-literature-comparison.canvas.tsx` | AlphaZero、MuZero、Gumbel AlphaZero、Expert Iteration 等自博弈论文与 OpenBlock 的横向对比 |

---

## 3. 状态与维护清单

| 检查项 | 要求 |
|--------|------|
| Markdown 转换 | 新增 Canvas 后必须先转换为对应 `docs/` Markdown 文档 |
| 分类登记 | 在本文按类别追加 Markdown 文档入口，而不是原始 Canvas 路径 |
| 文件命名 | 使用 kebab-case，后缀固定为 `.canvas.tsx` |
| 渲染兼容 | 只从 `cursor/canvas` 导入组件；不使用外部网络、相对导入或未声明 npm 包 |
| 敏感内容 | 全球化、人口学、商业化分析不得把敏感属性作为个体定向策略事实 |
| 归档处理 | 过期 Canvas 保留登记，但在“内容”中标记历史/归档，避免误当当前事实 |

---

## 4. 与权威文档的关系

Canvas 适合承载：

- 多表格、多维度调研。
- 路线图和优先级矩阵。
- 模型、实验和诊断对比。
- 需要并排查看的分析资产。

权威文档仍应承载：

- 当前实现事实。
- 算法字段和损失函数契约。
- 产品策略和合规承诺。
- 测试、验证和上线门禁。

因此，文档中心侧栏应注册转换后的 Markdown 文档；Canvas 文件本身不直接注册。

