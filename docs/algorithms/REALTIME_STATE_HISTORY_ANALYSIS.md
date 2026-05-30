# 用户实时状态历史序列分析

> 数据来源：本地 `openblock.db` 的 `move_sequences.frames[*].ps`。  
> 分析范围：222 局、13,347 个实时状态帧、4,496 个反应样本帧、2 个用户。  
> 口径说明：历史帧里的 `stressBreakdown` 是当时保存的事实值；涉及新阈值的 `reactionAdjust` 使用当前 `900/2200ms` 配置做模拟判断。

## 0. 工具化更新流程

后续更新历史数据后，直接触发工具即可重新分析并生成调参建议：

```bash
npm run spawn:realtime-tune -- --sqlite openblock.db --pretty
npm run spawn:realtime-tune -- --sqlite openblock.db --apply --pretty
```

第一条只分析并更新本报告；第二条会把推荐参数写入 `shared/game_rules.json`，并同步 `miniprogram/core/gameRulesData.js`。

常用选项：

- `--days 30`：只分析最近 30 天。
- `--sessions tmp/replay-sessions.json`：从导出的 replay sessions JSON 分析。
- `--json-out tmp/realtime-tune.json`：额外输出结构化分析结果，便于 CI 或看板消费。
- `--min-sessions` / `--min-frames`：样本不足时禁止 `--apply`。

## 1. 总结

历史序列显示，`stress` 不是由单一“焦虑”或“反应慢”驱动，而是由分数推进、板面占用、技能估计、消行表现和多条救济链共同作用。最值得优化的不是继续调单点阈值，而是以下复合链路：

- `clearRate < 0.25` 到 `frustration >= 4` 的前置救济。
- `boardFill >= 0.58` 与高挫败共现时的死局感救济。
- `flowState=anxious` 与 `cognitiveLoad >= 0.6` 共振时的决策减负。
- `reactionAdjust` 的阈值已经可触发，但强度曲线需要饱和区间。
- `feedbackBias` 历史上长期偏正，需要在困境中做去偏/削弱。

## 2. 关键指标分布

| 指标 | 物理含义 | p10 | p50 | p90 | p95 | 解读 |
|---|---:|---:|---:|---:|---:|---|
| `stress` | 压力输出 | -0.20 | 0.00 | 0.45 | 0.82 | 中位数很低，但尾部可达高压；历史版本混合，需看分量而非只看终值 |
| `boardFill` | 板面占用 | 0.00 | 0.28 | 0.53 | 0.58 | 高板面帧不多，但进入后很容易和挫败共振 |
| `cognitiveLoad` | 认知负荷 | 0.21 | 0.30 | 1.00 | 1.00 | 高负荷帧占比高，是焦虑状态的主解释变量 |
| `frustration` | 连续未消行 | 0 | 0 | 3 | 5 | p95 已到强救济区，应关注低消行到挫败的转化速度 |
| `thinkMs` | 平均思考时间 | 2531ms | 3000ms | 4479ms | 5095ms | 包含观察、选块、拖动，不能替代纯反应 |
| `pickToPlaceMs` | 纯反应时间 | 1011ms | 1442ms | 1978ms | 2164ms | 适合做轻量尾部信号；`900/2200ms` 更接近真实分布 |
| `clearRate` | 近期消行率 | 0.13 | 0.30 | 0.47 | 0.50 | 与 `stress` 正相关，主要反映系统对顺局玩家加挑战 |
| `missRate` | 失误率 | 0.00 | 0.07 | 0.10 | 0.13 | 与 `stress` 负相关，说明失误救济链已在降压 |

## 3. 状态触发占比

| 条件 | 帧占比 |
|---|---:|
| `cognitiveLoad >= 0.6` | 32.6% |
| `clearRate < 0.25` | 18.2% |
| `flowState = anxious` | 11.5% |
| `frustration >= 4` | 9.3% |
| `flowState = bored` | 7.1% |
| `boardFill >= 0.58` | 4.9% |
| `pickToPlaceMs > 2200ms` | 1.4% |
| `pickToPlaceMs < 900ms` | 1.3% |

## 4. 与 `stress` 的相关性

| 指标 | Pearson r | 解释 |
|---|---:|---|
| `boardFill` | 0.519 | 板面越满，系统越倾向加压/进入高压段，但高板面同时需要救济护栏 |
| `skill` | 0.453 | 高能力玩家被持续加挑战 |
| `clearRate` | 0.433 | 顺局玩家被提高挑战，符合心流曲线 |
| `flowDeviation` | 0.360 | 心流偏移仍是有效压力输入 |
| `cognitiveLoad` | 0.205 | 认知负荷与压力同向，但更适合触发“决策减负” |
| `thinkMs` | 0.098 | 思考时间是弱信号 |
| `pickToPlaceMs` | 0.055 | 纯反应是弱信号，只适合微调 |
| `frustration` | 0.048 | 高挫败常被救济链压回去，所以相关性不高 |
| `missRate` | -0.208 | 失误越高，系统越降压，说明救济方向正确 |

## 5. 关键互操作链路

| 链路 | 条件概率 | 基线 | 结论 |
|---|---:|---:|---|
| 高板面 -> 高挫败 | P(`frustration>=4` \| `boardFill>=0.58`) = 40.0% | 9.3% | 板面风险不是单独问题，常伴随连续未消行，需要提前救济 |
| 低消行 -> 高挫败 | P(`frustration>=4` \| `clearRate<0.25`) = 33.9% | 9.3% | 低消行是挫败链早期信号，适合前置 `clearGuarantee` |
| 焦虑 -> 高负荷 | P(`cognitiveLoad>=0.6` \| anxious) = 72.3% | 32.6% | 焦虑主要是认知负担共振，不只是压力标量过高 |
| 高负荷 -> 慢反应 | P(`pickToPlaceMs>2200` \| `cognitiveLoad>=0.6`) = 3.3% | 1.4% | 慢反应能补充高负荷，但样本稀疏，不应成为主判据 |
| 无聊 -> 快反应 | P(`pickToPlaceMs<900` \| bored) = 1.2% | 1.3% | 快反应与 bored 不强绑定，快端加压必须保持弱信号 |

## 6. stress 分量贡献

| 分量 | 非零率 | meanAbs | mean | 判断 |
|---|---:|---:|---:|---|
| `lifecycleBandAdjust` | 100.0% | 0.150 | -0.150 | 稳定降压底座，可能掩盖局内短周期信号 |
| `scoreStress` | 91.4% | 0.106 | +0.106 | 分数推进是最大加压源 |
| `feedbackBias` | 91.6% | 0.057 | +0.053 | 闭环反馈长期偏正，可能偏向加压 |
| `smoothingAdjust` | 81.3% | 0.052 | -0.025 | 平滑器在大量帧里抵消波动 |
| `skillAdjust` | 100.0% | 0.043 | +0.041 | 能力高时持续加挑战 |
| `friendlyBoardRelief` | 24.7% | 0.043 | -0.043 | 板面友好救济已承担主要局面降压 |
| `flowAdjust` | 81.0% | 0.040 | +0.020 | 心流调节偏加压，需要关注 bored 判定 |
| `pacingAdjust` | 37.1% | 0.019 | +0.005 | 节奏张弛相对温和 |
| `frustrationRelief` | 7.7% | 0.014 | -0.014 | 触发较少，但一旦触发强度明确 |
| `reactionAdjust` | 0.0% | 0.000 | 0.000 | 历史帧旧值未重算；当前阈值模拟约 8.3% 会触发 |

## 7. 已落实的优化

### 7.1 `reactionAdjust` 强度曲线

原先只改到 `fastMs=900`、`slowMs=2200` 后，触发范围变合理，但强度仍偏弱。例如 `700ms` 只产生约 `+0.011`，对出块几乎无感。

已新增饱和区间：

- `fastMs=900`：进入快端尾部。
- `fastFullMs=500`：到达/低于该值时接近 `+0.05`。
- `slowMs=2200`：进入慢端尾部。
- `slowFullMs=3200`：到达/高于该值时接近 `-0.05`。

### 7.2 低消行前置救济

新增 `preFrustrationRelief`：

- 条件：`clearRate < 0.25` 且 `boardFill >= 0.45` 且尚未进入强挫败。
- 效果：小幅降低 stress，`clearGuarantee >= 2`，`sizePreference <= -0.18`，`multiClearBonus >= 0.42`。
- 目标：在 `frustration >= 4` 前介入。

### 7.3 高板面 × 挫败复合救济

新增 `boardFrustrationRelief`：

- 条件：`boardFill >= 0.58` 且 `frustration >= 3`。
- 效果：更强降压，`clearGuarantee >= 2`，`sizePreference <= -0.28`，`multiClearBonus >= 0.55`。
- 目标：处理“盘面快满 + 多步不消”的死局感合流。

### 7.4 焦虑状态的认知减负

新增 `decisionLoadRelief`：

- 条件：`flowState === anxious` 且 `cognitiveLoad >= 0.60`。
- stress：小幅降压。
- spawnTargets：降低 `shapeComplexity`、`solutionSpacePressure`、`spatialPressure`，提高 `clearOpportunity`。
- orderRigor：作为 bypass 条件，避免高负荷时继续加顺序刚性。
- spawnHints：提高 `clearGuarantee`，偏小块，保留适度多样性。

### 7.5 `feedbackBias` 困境去偏

新增 `feedbackBiasDampingAdjust`：

- 条件：`feedbackBias > 0` 且玩家处在低消行、高板面挫败、决策负荷或高挫败等困境。
- 效果：按困境强度抵消一部分正向 `feedbackBias`，上限 `0.08`。
- 目标：避免闭环反馈长期偏正时，在玩家已经困难的帧继续隐性加压。

## 8. 修改位置

| 模块 | 变更 |
|---|---|
| `shared/game_rules.json` | 新增 `reactionAdjust.fastFullMs/slowFullMs` 与 `adaptiveSpawn.realtimeStateTuning` |
| `web/src/adaptiveSpawn.js` | 接入新分量、spawnHints、spawnTargets、orderRigor/challengeBoost bypass |
| `miniprogram/core/gameRulesData.js` | 同步配置 |
| `miniprogram/core/adaptiveSpawn.js` | 同步逻辑 |
| `tests/adaptiveSpawn.test.js` | 覆盖反应饱和、低消行前置救济、高板面挫败、认知减负、feedbackBias 去偏 |

## 9. 后续观察指标

- `preFrustrationRelief` 触发后，后续 3–5 帧内 `frustration` 是否下降。
- `boardFrustrationRelief` 触发后，`noMove` / game over 前的高板面帧是否减少。
- `decisionLoadRelief` 触发后，`thinkMs` 与 `cognitiveLoad` 是否回落。
- `reactionAdjust` 非零率是否稳定在 5%–12%，避免变成主导分量。
- `feedbackBiasDampingAdjust` 是否只在困境帧出现，避免削弱顺局正反馈。
