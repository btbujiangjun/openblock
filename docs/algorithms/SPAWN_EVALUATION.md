# 出块评估与可视化工具

> 目标：把“出块是否公平、奖励是否有节奏、玩家选择是否有意义”从主观体感变成可重复跑的指标基线。

## 1. 工具入口

### CLI

```bash
npm run spawn:eval -- --sessions 120 --max-steps 360 --strategies easy,normal,hard --out .cursor-stress-logs/spawn-eval.json
```

对比 baseline / P1 / P2：

```bash
npm run spawn:eval -- --sessions 120 --max-steps 360 \
  --strategies easy,normal,hard \
  --policies random,clear-greedy,survival \
  --spawn-generators baseline,triplet-p1,budget-p2 \
  --out .cursor-stress-logs/spawn-eval-p1-p2.json
```

常用参数：

- `--sessions`：每个难度 × bot 组合跑多少局。
- `--max-steps`：单局最大落子数，防止强 bot 长局无限跑。
- `--max-triplets`：P1/P2 每次出块最多评估的三块组合数，默认 `80`，调参时可降到 `32` 先看趋势。
- `--best-score`：PB 双 S 曲线评估用个人最佳分，默认 `1000`。
- `--seed`：随机种子；同一参数应产出相同摘要。
- `--strategies`：难度列表，默认 `normal`。
- `--policies`：bot 列表，默认 `random,clear-greedy,survival`。
- `--spawn-generators`：出块生成器列表，默认 `baseline`；可选 `baseline,triplet-p1,budget-p2`。
- `--personalization`：P2 个性化强度，按玩家偏好向量微调体验预算。
- `--temperature`：P2 受控随机温度，只在合法 Top 组合内 softmax 采样。
- `--surprise-gain`：P2 惊喜预算增长速度，影响低频趣味倾向。
- `--surprise-cooldown`：P2 惊喜预算冷却轮次。
- `--out`：写入 JSON 报告；不传时输出到 stdout。

### 可视化页面

开发服务启动后访问：

```text
http://localhost:3000/spawn-eval.html
```

页面复用 `web/src/bot/spawnEvaluation.js`，但计算在 `web/src/spawnEval.worker.js`
中运行，避免评估时阻塞浏览器主线程。页面默认不自动评估，必须点击“运行评估”或“自动寻优”才开始。正式调参建议用 CLI 跑更大样本并归档 JSON。

Web 首页菜单的「出块评估 · 优化器」会打开同一个页面。

## 1.1 策略参数优化器

可视化页已从只读评估升级为“参数方案 → 寻优 → 保存/加载”的闭环：

- 自定义寻优：调整 `noMove / rewardAgency / skillLift / fallback / pacing` 五类目标权重后运行评估。
- 模型化参数：`personalizationStrength / temperature / surpriseBudgetGain / surpriseCooldown` 分别控制个性化强度、受控随机、惊喜预算增长和冷却。
- 自动寻优：在浏览器 Worker 内枚举 baseline / P1 / P2、不同 `maxTriplets` 与个性化/随机/惊喜参数，按综合评分选择当前最优方案。
- 参数持久化：点击“保存到 SQLite”写入 `/api/spawn-optimizer/configs`；若后端不可用，自动保存到浏览器 `localStorage`。
- 参数加载：从“已保存方案”选择后点击“加载生效”，页面控件立即填充，并对下一次评估生效；无服务端时本地方案同样可用。

后端表：`spawn_optimizer_configs`，字段包含 `user_id / name / payload / is_active / created_at / updated_at`。

无服务端降级：SQLite API 不可用时，方案保存/加载自动降级到 `localStorage`，优化器仍可完整使用。

## 2. Bot 分层

评估使用三类 bot，分别模拟不同玩家质量：

- `random`：随机合法落子，代表低规划或误触玩家。
- `clear-greedy`：优先选择立即消行，代表追求短期奖励的普通玩家。
- `survival`：优先保留后续机动性，代表更会规划空间的玩家。

三类 bot 不是为了替代真实玩家，而是用于拆解“出块质量”：

- 随机 bot 也能活很久，说明出块过度喂牌。
- 生存 bot 也频繁死局，说明公平性或机动性不足。
- 贪心 bot 与随机 bot 差距很小，说明奖励兑现不够依赖玩家选择。

## 3. 核心指标

- `scoreMean / scoreP50 / scoreP90`：分数分布，用于观察难度曲线和 PB 膨胀风险。
- `stepsMean`：平均局长，代表可玩时长。
- `noMoveRate`：无路可走终局比例，高值代表死局压力大。
- `terminalFillMean / terminalHolesMean`：失败时棋盘状态，帮助区分“满板自然失败”和“低填充不公平失败”。
- `clearIntervalMean / clearIntervalP90`：消行间隔，衡量奖励节奏是否过长。
- `multiClearRate / perfectClearRate`：多消、清屏频率，衡量爽点稀缺度。
- `fallbackRate / attemptMean`：出块器兜底与重抽压力，持续升高说明过滤条件过严。
- `firstMoveFreedomMean / solutionCountMean`：候选三块的容错与解空间。
- `spawnGenerator`：本行使用的出块生成器。
- `budgetMean`：P2 体验预算均值（`survival / payoff / pressure / novelty`）；baseline 为空。
- `evaluatedTripletsMean`：P1/P2 每次出块平均廉价扫描的候选三块组合数。
- `deepEvaluatedTripletsMean`：P1/P2 每次出块平均进入完整解法评估的组合数，默认最多 8。
- `optimizerScore`：报告解读层按自定义目标权重计算的综合评分。
- `budgetMean.personalizationStrength / surpriseBudget`：P2 预算中实际生效的个性化与惊喜预算强度。
- `budgetMean.pbTension / pbBrake / pbRelease`：P2 预算中实际生效的 PB 前张力、PB 后刹车、突破释放。
- `nearPbRate / breakPbRate / overshootRate`：达到 85% PB、突破 PB、超过 115% PB 的局占比。

派生指标：

- `naturalFairnessGap = random.noMoveRate - survival.noMoveRate`
  - 越高表示高手规划带来的生存收益越明显。
  - 过高时要检查普通玩家是否被“理论可解但体感不公平”的顺序刚性惩罚。
- `skillScoreLift = survival.scoreMean - random.scoreMean`
  - 衡量技巧对分数的贡献。
- `rewardAgencyGap = clearGreedy.clearsMean - random.clearsMean`
  - 衡量玩家主动追求消行是否真的得到奖励。

## 4. 已落地范围

本工具刻意不修改 `generateDockShapes()` 主路径，所有 P1/P2 逻辑先作为实验生成器评估：

1. 共享评估模块：`web/src/bot/spawnEvaluation.js`
2. CLI 入口：`scripts/evaluate-spawn.mjs`
3. Web 可视化：`web/spawn-eval.html`
4. 回归测试：`tests/spawnEvaluation.test.js`
5. P1/P2 实验生成器：`web/src/bot/spawnExperiments.js`

当前评估基于无头模拟器 `OpenBlockSimulator`，它复用 Web 实局规则轨：

```text
PlayerProfile + spawnContext
→ resolveAdaptiveStrategy()
→ generateDockShapes(grid, layered, spawnContext)
→ Grid.place / checkLines
→ computeClearScore()
```

也就是说，CLI 和可视化页评估的是 **Web 端规则轨实局出块**，包含自适应压力、`spawnHints`、多维解法过滤、特殊块注入节流、monoFlush 锁色与消行计分。

仍不包含的范围：

- SpawnTransformer V3 模型模式及其异步 fallback。
- DOM 输入手感、拖拽失败、toast、震动、粒子、音效等表现层。
- 数据库、广告、任务、生命周期运营触达等非出块链路。

若要评估真实玩家画像分布，后续应把真实 session 回放或匿名画像样本注入 `PlayerProfile` 初始状态，而不是只依赖三类 bot。

## 5. P1：组合级候选评分

P1 已落地为 `spawnGenerator=triplet-p1`。它把三块选择从“单块评分后拼接”推进到“候选 triplet 组合级评分”，但只在评估轨使用。

实现口径：

1. 从当前盘面可放的常规形状中筛出 Top 候选。
2. 枚举最多 `--max-triplets` 组三块组合，先用廉价特征筛 Top 8，再计算组合级深度特征：
   - 可解排列数
   - 第一步存活率
   - 解法数量
   - 平均终局填充率
   - 新空洞上下界
   - 消行潜力、精确卡入、品类多样性
3. 用组合总分选择三连块，并输出 `experimentMode / evaluatedTriplets / solutionMetrics` 诊断。
4. 不参与 special shape 事件注入；special 仍由 baseline 主路径保留。

## 6. P2：体验预算模型

P2 已落地为 `spawnGenerator=budget-p2`。它在 P1 组合评分之上，把出块意图显式拆成四类预算：

- `survival`：保活、低空洞、首步自由。
- `payoff`：消行、多消、清屏、同花。
- `pressure`：块体积、形状复杂度、顺序刚性。
- `novelty`：品类多样性、重复形状、特殊块节流。

预算来源：

- `layered._adaptiveStressRaw`
- `spawnHints.spawnTargets`
- `spawnHints.multiClearBonus / diversityBoost / delightMode`
- `spawnContext.roundsSinceClear / totalRounds`
- 当前棋盘填充率

P2 输出会在 JSON 中增加 `budgetMean`，用于观察不同策略、不同 bot 下 survival/payoff/pressure/novelty 的实际占比。

### 6.1 个性化、偶然性与自学习参数

P2 实验轨支持轻量模型化参数，但仍不绕过可解性和机动性约束：

- `personalizationStrength`：根据玩家偏好向量微调预算。偏好向量包含 `clearSeeker / comboPlanner / survivalist / riskTaker / noveltyLover`，来自玩家画像与当前局上下文。
- `temperature`：在 Top 合法组合中做 softmax 式受控随机。PB 压力期建议降低，热身和远离 PB 时可提高。
- `surpriseBudgetGain`：提高惊喜预算增长速度，用于低频同花、清屏铺垫、品类变化等趣味。
- `surpriseCooldown`：惊喜预算冷却轮次，值越高，稀有事件越克制。

自动寻优当前是浏览器内本地枚举，属于 contextual bandit 的前置形态：模型选择参数方案，候选三块仍由硬约束采样器生成。后续可把 SQLite 中保存的方案与真实局结果关联，升级为服务端 bandit。

## 7. 切主路径门槛

P1/P2 当前只用于离线评估和可视化，不直接替换 Web 实局主路径。进入主路径前至少需要满足：

- `noMoveRate` 不高于 baseline，且随机 bot 低填充失败不增加。
- `rewardAgencyGap` 高于 baseline，证明玩家主动消行选择更有收益。
- `fallbackRate` 不高于 baseline。
- `stepsMean / scoreP90` 不出现明显 PB 膨胀。
- `evaluatedTripletsMean` 对移动端性能可接受；必要时按设备档位降低组合上限。

建议先用 `--sessions 500` 对 `easy,normal,hard` 全量跑一版，再决定是否进入灰度。

## 8. 报告解读

页面会自动生成：

- 推荐方案：当前目标权重下综合评分最高的策略 / 生成器 / bot 组合。
- 关键发现：最高死局率、fallback 过高、P2 奖励自主性提升等。
- 改进建议：是否继续放大 P2 样本、是否提高 survival/payoff、是否降低 pressure。

这些建议只作为调参辅助，不直接写入线上出块。线上生效仍需走代码评审和切主路径门槛。

## 9. 决策数据流（DFV）展示口径

DFV 已同步当前出块算法字段：

- `baseline` 主规则轨：展示玩家信号、压力、`spawnHints`、`spawnTargets`、调度参数、三块 `chosen` 与 `topDriver`。
- P1 / P2 实验轨：`chosen.reason` 支持 `triplet-p1` / `budget-p2`，driver path 不再退化到 `balanced`。
- P2 体验预算：右侧“决策动态”展示 `survival / payoff / pressure / novelty`、`personalizationStrength`、`surpriseBudget`、`evaluatedTriplets / deepEvaluatedTriplets`。
- PB 曲线：展示 `pbTension / pbBrake / pbRelease`，由 `adaptiveSpawn.derivePbCurve()` 主规则轨输出，同一口径也被评估工具复用。
- 个性化偏好：展示 `clearSeeker / comboPlanner / survivalist / riskTaker / noveltyLover` 估算值。
- 出块目标、调度提示、PB/偏好/预算均使用 `n × 3` 紧凑布局；标题为 2 字短名，hover 展示完整含义、字段名、公式/语义与当前值解读。

注意：PB 双 S 曲线已作为正式诊断字段写入 `_lastAdaptiveInsight`；个性化偏好向量目前仍是 DFV 解释层估算。若后续将 P2 切入主出块，应把偏好向量也固化为正式诊断字段。

## 10. 四端一致性

- Web：权威规则轨。
- Android / iOS：Capacitor WebView 加载 `dist`，与 Web 同源。
- 微信小程序：`adaptiveSpawn / blockSpawn / playerProfile` 由 `scripts/sync-core.sh` 同步为 CJS；`miniprogram/utils/gameController.js` 维护与 Web 同语义的 `scoreMilestone` 桥接、`totalRounds`、special / duplicate 节流、诊断回写与玩家画像闭环。

P1/P2 优化器和 DFV 不进入小程序核心包；小程序保留规则轨本地对局体验。

