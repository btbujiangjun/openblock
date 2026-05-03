# PyTorch RL：在线服务与离线评估

> 说明 **Flask `/api/rl/*` 在线训练** 与 **`python -m rl_pytorch.train` 离线训练** 的差异，以及如何做强对照的 **贪心评估**。  
> 与 [RL 算法手册](./ALGORITHMS_RL.md) §14 互补。

## 1. 两条训练路径

| 路径 | 采样来源 | Teacher（q_vals / visit_pi） | Search replay（困难局混合） |
|------|-----------|------------------------------|-----------------------------|
| **离线** `python -m rl_pytorch.train` | Python `OpenBlockSimulator` + `collect_episode` | 可有（beam / MCTS / 1-step，依 `game_rules`） | 有（`train_loop` 内） |
| **在线** 浏览器 → `/api/rl/train_episode` | 浏览器仿真 + POST 轨迹 | **可有**：侧栏 **勾选「1-step lookahead」** 时，每步用 `r + γ V(s')` 选步并 POST **`q_teacher`**；服务端写入 `q_vals` 参与 **Q 蒸馏**（弱 teacher，**不是** MCTS）。未勾选时每步走 **`select_action`**，轨迹无 teacher。**visit_pi** 仍仅在离线或未来协议扩展时出现 | **有**（批量 flush 时与 `train_loop` 对齐，见 §2） |

结论：`teacher_q_coverage` / `loss_q_distill` 在在线路径上**可以为正**，前提是 **`game_rules.rlRewardShaping.qDistillation` 启用**、侧栏 **勾选 lookahead**、且 **`/api/rl/eval_values` 成功**（合法动作 ≤120 时启用 lookahead 分支）。程序化调用：`trainSelfPlay({ useBackend: true, useLookahead: true })`；未传 **`useLookahead`** 时默认 **`false`**（与侧栏默认一致）。若关闭 lookahead 或 `eval_values` 失败/响应非法，则 **回退 `select_action`**，该步无 `q_teacher`。

### 1.1 侧栏 UI 与训练循环行为

- **复选框**：`web/index.html` → **`1-step lookahead`**（`#rl-lookahead`），**默认不勾选**；勾选后「开始训练」「评估一局」均会在 PyTorch 后端路径下启用 lookahead。
- **`trainSelfPlay` / `runSelfPlayEpisode`**（`web/src/bot/trainer.js`）：未传 **`useLookahead`** 时默认为 **`false`**（在线后端路径）。
- **`startBatch`**（`web/src/bot/rlPanel.js`）：使用 **`try/catch/finally`**，训练异常或刷新失败时仍恢复按钮状态，并将错误摘要写入 **「训练进展」**。

### 1.2 浏览器 POST 字段

- **`q_teacher`**：`number[]`，长度等于该步 `phi` 行数，与合法动作顺序一致（由 `pytorchBackend.js` → `trainEpisodeRemote` 序列化）。  
- **`visit_pi`**：在线默认不传；需要与离线一致的 MCTS 访问分布时仍应用 **`python -m rl_pytorch.train`**。

### 1.3 `/api/rl/eval_values` 前端校验与回退

- **`evalValuesRemote`**（`web/src/bot/pytorchBackend.js`）：要求响应体含 **`values`**，且 **数组长度与请求的 `states` 条数一致**；将元素剥嵌套后转为 **`number`**。不满足则抛错。
- **`_selectWithLookahead`**（`web/src/bot/trainer.js`）：请求失败或返回值长度与合法动作数不一致时，**回退 `select_action`**，并返回 **`qTeacher: null`**（该步不参与 Q 蒸馏）。

### 1.4 服务端：`q_teacher` → `q_vals` 与单局日志

- **`_convert_episode_for_ppo`**（`rl_backend.py`）：若某步含 **`q_teacher`** 且长度与 `phi` 行数一致，写入该步 **`q_vals`**，供 `_reevaluate_and_update` 与离线一致的 Q 蒸馏逻辑使用。
- **`RL_BATCH_SIZE=1`**（`rl_backend.py` → **`_rl_train_episode_inner`**）：步上含 **`q_teacher`** 时同样计算 Q 蒸馏项；`training.jsonl` 的 **`train_episode`** 事件可含 **`loss_q_distill`、`q_distill_coef`、`teacher_q_coverage`**，与批量 flush 日志字段对齐。
- **模块头注释**：`rl_backend.py` 顶部环境变量说明中含 **`q_teacher`** 语义摘要。

## 2. 在线批量 PPO 与 search replay（已实现）

当 `RL_BATCH_SIZE`（默认 32）> 1 且轨迹攒满缓冲时，服务端调用与离线相同的 `_reevaluate_and_update`。

- **`shared/game_rules.json` → `rlRewardShaping.searchReplay`**：控制是否启用、抽样比例、`minPriority`、`keepPerBatch` 等。  
- 环境变量 **`RL_SEARCH_REPLAY=0`** 可关闭（与 `train.py` 一致）。  
- 服务端维护内存队列 **`search_replay_buffer`**：每次 flush 后把本批高优先级局写入，下次 flush 按 `sampleRatio` / `maxSamples` 混入更新；日志中的 **`replay_steps` / replay ratio** 将反映混合批次（需缓冲非空且启用 searchReplay）。

单局 `RL_BATCH_SIZE=1` 时仍走轻量 `train_episode` 路径，**无**上述 search replay 混合；若轨迹含 **`q_teacher`**，仍可有 **Q 蒸馏** 与 **`teacher_q_coverage`**（见 §1.4）。

## 3. 轨迹字段：`steps_to_end`

在线转换轨迹时，服务端会按轨迹长度重写每步 **`steps_to_end`**，与离线 `collect_episode` 一致，便于 **survival** 辅助头目标正确。

## 4. 独立评估（与看板滑动窗分离）

### 4.1 命令行：`npm run rl:eval` / `python3 -m rl_pytorch.eval_cli`

对 checkpoint 做 **多轮随机种子** 的模拟器贪心（或低温度） rollout，输出 **胜率 / 均分 / 标准差**，**不依赖** `training.jsonl` 里的滑动统计。

```bash
npm run rl:eval -- --checkpoint rl_checkpoints/bb_policy.pt --n-games 128 --rounds 3
python3 -m rl_pytorch.eval_cli --checkpoint rl_checkpoints/bb_policy.pt --json
```

常用参数：`--device`、`--temperature`、`--win-threshold`、`--seed-base`。

### 4.2 HTTP：`POST /api/rl/eval_greedy`

在 **已启动 `server.py` 且 PyTorch 可用** 的前提下，对**当前内存中加载的权重**跑评估，并 **追加一行** `training.jsonl`（`event: "eval_greedy"`），便于与训练事件对照时间线。

Body 可选字段：`n_games`、`rounds`、`temperature`、`win_threshold`、`seed_base`。

前端封装：`web/src/bot/pytorchBackend.js` → **`evalGreedyRemote(opts)`**。

## 5. 吞吐与批次

- **`RL_BATCH_SIZE`**：在线攒批大小；更大则更接离线 PPO，但 **单次 flush 延迟**更高。  
- **`RL_PPO_EPOCHS_ONLINE`**：每批 PPO epoch 数。  
- 手动 **`POST /api/rl/flush_buffer`**：未满批也可触发更新（与 `flushBufferRemote()` 对应）。

## 6. 推荐阅读顺序

1. [RL 算法手册 §14](./ALGORITHMS_RL.md#14-推理流程与服务化) — API 总览  
2. [RL 训练看板趋势](./RL_TRAINING_DASHBOARD_TRENDS.md) — 指标口径  
3. [测试指南](../engineering/TESTING.md) — 提交前命令  
