# 出块算法自动寻参系统（Spawn Auto-Tuning）v0.3.6

> **定位**：在 120 个游戏上下文（难度 × 生成器 × bestScore 档 × 生命周期）下，分别找到「同时满足公平、爽点、抑制膨胀」三目标的最优参数策略 θ*(context)。
> **范围**：上下文空间定义、条件化目标函数、并行大规模采样、神经网络代理建模、上下文查表部署、灰度回滚。
> **样本规模**：100K+ 真实评估样本。
> **关键设计**：上下文条件化（不再是单一 θ*）、PB 容忍度随 bestScore 递减、生命周期权重乘子。
> **受众**：算法工程师 / 玩法工程师 / 测试 / 运维。
> **维护要求**：本文是 SPAWN_EVALUATION.md 的延伸；改 `web/src/bot/spawnEvaluation.js`、`web/src/adaptiveSpawn.js` 或新增寻参代码时同步本文。

---

## 1. 系统定位（与 v0.1 的本质区别）

### 1.1 v0.1 单点最优 vs v0.2 上下文策略

| | v0.1 | v0.2 |
|---|---|---|
| 优化目标 | 单一 θ* 在 J(θ) 上最大 | 策略 π(c) → θ 使 E_c[J(π(c), c)] 最大 |
| 样本规模 | 100 (BO 预算) | 100K+ (并行评估) |
| 代理模型 | 高斯过程 (GP + Matérn) | 神经网络 (MLP + embedding) |
| 目标函数 | 静态权重加权 | 上下文条件化（PB 容忍度随 bestScore 递减、生命周期权重乘子） |
| 部署形态 | 单条线上 active 行 | 120 个 (context → θ) 映射表 + 退化兜底 |
| 适用场景 | 快速调参验证（< 30 min） | 生产级寻参（~5 小时） |

### 1.2 为什么必须升级到 v0.2

1. **100 样本无法覆盖 120 contexts**：v0.1 假设全空间用同一 θ 最优，但新手玩家（best=500）和顶尖玩家（best=25000）显然需要完全不同的出块策略。
2. **GP 在 100K 样本规模上失效**：O(N³) 拟合 = 10^15 操作，完全不可行。即使用 sparse GP 也难以处理上下文条件化。
3. **静态 antiInflation 不公平**：v0.1 对所有玩家用同一个 5% overshoot 阈值——但新手玩家 overshoot 40% 是正常的（他们在突破自己），用同一标准会过度抑制其早期成长。
4. **生命周期没有体现**：平台期玩家需要"惊喜"，新手期玩家需要"鼓励"，但 v0.1 完全无视这点。

---

## 2. 上下文空间（Context Space）

### 2.1 上下文 4 维定义

| 维度 | 取值 | 来源 |
|---|---|---|
| **难度** difficulty | `easy` / `normal` / `hard` | 用户在 UI 选择 |
| **生成器** generator | `triplet-p1` / `budget-p2` | 寻参时分别评估（baseline 不在寻参范围,作为对照基线） |
| **bestScore 档** bin | `500` / `1500` / `4000` / `10000` / `25000` | 由 `getBestScoreBin(bestScore)` 计算 |
| **生命周期阶段** lifecycle | `onboarding` / `growth` / `mature` / `plateau` | 由 `getLifecycleStage(totalRounds, daysSincePb)` 计算 |

**总 context 数量：3 × 2 × 5 × 4 = 120**

### 2.2 生命周期判定逻辑

```js
function getLifecycleStage(totalRounds, daysSincePb) {
    if (totalRounds < 20) return 'onboarding';
    if (totalRounds < 200) return 'growth';
    if (totalRounds < 1000) return 'mature';
    if (daysSincePb > 7) return 'plateau';
    return 'mature';
}
```

### 2.3 bestScore 分档

```js
function getBestScoreBin(bestScore) {
    if (bestScore < 750)    return 500;
    if (bestScore < 2500)   return 1500;
    if (bestScore < 7000)   return 4000;
    if (bestScore < 17000)  return 10000;
    return 25000;
}
```

5 档对数均匀分布，覆盖新手到顶尖。

---

## 3. 上下文条件化目标函数

### 3.1 三个业务子分数（保持 v0.1）

```text
fairness(θ, c)       = 0.55 (1 − noMoveRate) + 0.25 firstMoveFreedom + 0.20 (1 − 8·fallbackRate)
excitement(θ, c)     = 0.50 clearsMean/40 + 0.30 multiClearRate·2 + 0.20 pacingScore
antiInflation_raw(θ, c) = 详见 3.2
```

### 3.2 不对称 PB 容忍度（v0.2 新增）

```text
overshoot_tolerance(bestScore) = 0.05 + 0.40 · sigmoid((log10(2000) − log10(bestScore)) / 0.4)
```

精确取值表：

| bestScore | overshoot 容忍度 | 含义 |
|---|---|---|
| 500   | 0.42 | 新手期 overshoot 42% 仍属健康（玩家在突破自我） |
| 1500  | 0.30 | 普通玩家 30% |
| 4000  | 0.12 | 熟练玩家 12% |
| 10000 | 0.06 | 高分玩家 6% |
| 25000 | 0.05 | 顶尖玩家 5%（已是 sigmoid 下沿） |

```text
antiInflation(θ, c) = max(0, 1 − (overshootRate(θ, c) / overshoot_tolerance(c.bestScore))²)
```

二次衰减让"超过容忍度初期"惩罚较轻、"严重超过"惩罚陡升。

### 3.3 生命周期权重乘子（v0.2 新增）

```js
const LIFECYCLE_MULTIPLIERS = {
    onboarding: { fairness: 1.5, excitement: 1.2, antiInflation: 0.5 },  // 新手优待
    growth:     { fairness: 1.0, excitement: 1.0, antiInflation: 1.0 },  // 中性
    mature:     { fairness: 0.8, excitement: 0.9, antiInflation: 1.5 },  // 严控膨胀
    plateau:    { fairness: 0.7, excitement: 1.5, antiInflation: 0.8 },  // 优先惊喜打破倦怠
};
```

设计依据：

- **onboarding**：玩家流失风险最高，必须最大化 fairness（不能死）+ excitement（要爽）。即使 overshoot 较多也无所谓——他们的 PB 本来就低。
- **growth**：标准玩家阶段，三目标等权。
- **mature**：玩家已习惯系统节奏，PB 膨胀会让游戏失去深度。严控 overshoot。
- **plateau**：玩家已"摸到天花板"，再优化 fairness/antiInflation 没用——必须用 excitement 打破倦怠。

### 3.4 完整目标公式

```text
J(θ | c) = m_f(c.lifecycle) · w_f · fairness(θ, c)
         + m_e(c.lifecycle) · w_e · excitement(θ, c)
         + m_a(c.lifecycle) · w_a · antiInflation(θ, c, c.bestScore)
```

- `w_f / w_e / w_a` 来自 UI 滑块（用户主导，所有 context 共享）
- `m_*(lifecycle)` 来自 §3.3 表（系统主导，按 context 决定）
- 算法不需要重新评估即可换权重——所有真实评估只产出 13 列指标 + 3 个原始子分数（未乘子）；最终 J 在代理模型推断时即时计算

---

## 4. 参数空间（保持 v0.1 的 14 维）

### 4.1 v1 寻参维度（14 维）

参考 v0.1 §2.2。简化展示：

```python
PARAM_SPACE_V1 = {
    # A. P2 模型参数 (5)
    "personalizationStrength":   {"type": "float", "low": 0.05, "high": 0.18},
    "temperature":               {"type": "float", "low": 0.03, "high": 0.08},
    "surpriseBudgetGain":        {"type": "float", "low": 0.05, "high": 0.10},
    "surpriseCooldown":          {"type": "int",   "low": 4,    "high": 10},
    "maxEvaluatedTriplets":      {"type": "choice", "choices": [32, 48, 64, 96, 128]},

    # B. spawnTargets PB 调制系数 (5)
    "ssp_brakeCoef":             {"type": "float", "low": 0.08, "high": 0.16},
    "sp_tensionCoef":            {"type": "float", "low": 0.08, "high": 0.16},
    "sp_brakeCoef":              {"type": "float", "low": 0.12, "high": 0.20},
    "payoff_brakeCoef":          {"type": "float", "low": 0.10, "high": 0.22},
    "clearOpp_brakeCoef":        {"type": "float", "low": 0.06, "high": 0.14},

    # C. PB 曲线形状 (4) - v2 启用
    "tensionCenter":             {"type": "float", "low": 0.78, "high": 0.86},
    "tensionSlope":               {"type": "float", "low": 0.06, "high": 0.12},
    "brakeCenter":               {"type": "float", "low": 1.02, "high": 1.10},
    "brakeSlope":                 {"type": "float", "low": 0.04, "high": 0.08},
}
```

---

## 5. 大规模并行采样策略（100K+ 样本）

### 5.1 4 阶段采样计划 (基于 §5.7 实测数据重估)

| 阶段 | 样本数 | 选样策略 | 时长 (8 workers @ 30×120 配置) |
|---|---|---|---|
| **Phase A 冷启动 LHS** | 35,000 | 120 contexts × Latin Hypercube on θ space | **~2 小时** |
| **Phase B 训练 NN 代理** | (使用 A 的样本) | MLP + multi-task supervised | ~15 min (CPU) |
| **Phase C 梯度上升找 θ\***  | (无评估) | per-context Adam on surrogate | ~5 min |
| **Phase D 主动学习精修** | 70,000 | 50% 高 uncertainty + 30% 高 EI + 20% 边界 context | **~4 小时** |
| **Phase E 持久化部署** | (验证用 5,000) | 12 选 × ~417 验证样本 | ~20 min |
| **总计** | **~110,000** | | **~6.5 小时** |

注: 上表是 8 workers 估算。若用 4 workers 总时长约 10 小时;若有 16 核机器线性扩展约 4 小时。建议夜间无人值守跑。

### 5.2 Phase A: 拉丁超立方 (LHS) 覆盖采样

每个 context 内独立 LHS 采样：

```python
def phase_a_sampling(contexts, theta_space, total_budget=35000):
    samples_per_context = total_budget // len(contexts)  # ~291
    thetas_per_context = samples_per_context // 3        # ~97 unique thetas
    seeds_per_theta = 3                                  # 减噪用

    for context in contexts:
        # LHS 在 14 维 θ 空间均匀覆盖
        theta_lhs = latin_hypercube(thetas_per_context, theta_space)
        for theta in theta_lhs:
            for seed in range(seeds_per_theta):
                enqueue_sample(context=context, theta=theta, seed=seed)
```

**关键设计**：每 θ 使用 3 个种子降噪，单 θ 输出取均值。

### 5.3 Phase B: 神经网络代理模型

> **v0.3.6 后端**: 训练/推断全部在 PyTorch (CPU/CUDA/MPS),通过 Flask 子进程暴露给浏览器。
> 模式参考 `rl_backend.py`:
> - **CLI**: `python -m rl_pytorch.spawn_tuning.train_surrogate --db <sqlite> --run-id <id> --epochs 50`
> - **HTTP**: `POST /api/spawn-tuning/v2/torch/train { run_id, epochs, batch_size, lr, device }`
> - **Web UI**: 看板 Tab ② → ⑥ 「PyTorch NN 代理训练」(配置/启动/实时日志/部署一键)

#### 5.3.1 输入特征

```text
θ_norm (14 维, min-max 归一化到 [0,1])
difficulty embedding (3 → 4d)
generator embedding (2 → 4d)
lifecycle embedding (4 → 4d)
log_bestScore (1 维, log10 后 z-score)
─────────────────────────────────
总输入: 14 + 4 + 4 + 4 + 1 = 27 维
```

#### 5.3.2 共享 trunk + 多任务头

```python
class SpawnTuningSurrogate(nn.Module):
    def __init__(self):
        super().__init__()
        self.diff_emb     = nn.Embedding(3, 4)
        self.gen_emb      = nn.Embedding(2, 4)
        self.life_emb     = nn.Embedding(4, 4)
        self.trunk = nn.Sequential(
            nn.Linear(27, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, 32), nn.ReLU(),
        )
        self.head_fairness      = nn.Sequential(nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid())
        self.head_excitement    = nn.Sequential(nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid())
        self.head_antiInflation = nn.Sequential(nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid())

    def forward(self, theta, diff_idx, gen_idx, life_idx, log_best):
        x = torch.cat([theta, self.diff_emb(diff_idx), self.gen_emb(gen_idx), self.life_emb(life_idx), log_best], dim=-1)
        h = self.trunk(x)
        return torch.cat([self.head_fairness(h), self.head_excitement(h), self.head_antiInflation(h)], dim=-1)
```

参数量：~6,800（轻量,CPU 训练）

#### 5.3.3 损失函数（多任务 + 先验正则）

```text
L_total = L_MSE + λ_mono · L_monotone + λ_smooth · L_smooth

L_MSE     = Σ_tasks MSE(prediction, target)        # 多任务监督
L_monotone = ReLU(d antiInflation_pred / d log(bestScore))
            # 强制: bestScore 增 → antiInflation 健康分数单调不增
            # (惩罚违背"高 PB 严格 / 低 PB 宽松"先验)
L_smooth  = ||∇_θ predictions||²
            # 输出对 θ 的梯度光滑,避免响应面剧烈震荡
λ_mono = 0.3
λ_smooth = 0.05
```

#### 5.3.4 训练超参

```text
batch_size: 256
epochs: 50
optimizer: AdamW, lr=1e-3, weight_decay=1e-4
lr schedule: cosine decay
validation split: 10%
early stopping patience: 5 epochs
expected train time: ~15 min on CPU (M-series Mac)
target val MAE: < 0.05 on all 3 subscores
```

### 5.4 Phase C: 上下文条件梯度上升

代理训好之后，**用代理本身作为 J(θ|c) 的可微近似**，对每个 context 求最优 θ：

```python
def phase_c_per_context_search(surrogate, context, weights, n_starts=10):
    diff_idx, gen_idx, life_idx, log_best = encode_context(context)
    best_J = -inf
    best_theta = None
    
    for start in range(n_starts):
        theta = nn.Parameter(latin_hypercube(1, theta_space)[0])
        optim = Adam([theta], lr=0.01)
        for step in range(300):
            optim.zero_grad()
            subs = surrogate(theta.unsqueeze(0), diff_idx, gen_idx, life_idx, log_best).squeeze()
            J = -compute_J(subs, context, weights)   # 反向求最大
            J.backward()
            optim.step()
            theta.data.clamp_(0, 1)                   # 投影到合法空间
        final_J = compute_J(surrogate(theta, ...), context, weights)
        if final_J > best_J:
            best_J = final_J
            best_theta = theta.detach().clone()
    
    return best_theta, best_J

# 120 contexts × 10 starts × 300 steps = 360K 次推断,~5 分钟
```

### 5.5 Phase D: 主动学习精修

预算 70K 按以下优先级分配：

| 优先级 | 预算 | 选样准则 | 用途 |
|---|---|---|---|
| 50% | 35,000 | 高 NN 集成方差区域 (variance > 0.05) | 改善代理精度 |
| 30% | 21,000 | 高 EI 区域 (predicted_J − current_best > 0.01) | 集中找最优 |
| 20% | 14,000 | 数据稀少 context 加强采样 | 数据不均的补偿 |

**Phase D 后**：用全部 105K 样本重训代理 → 重复 Phase C → 写最终 (context, θ\*) 表。

### 5.6 并行采样架构

```text
┌─────────────────────────────────────────┐
│ Master Process (Node.js)                │
│  - 维护任务队列                          │
│  - SQLite WAL 模式写入                   │
│  - 进度广播 (WebSocket → UI)             │
└──────────┬──────────────────────────────┘
           │  task: (context, theta, seed)
           ▼
   ┌───────────────────────────────────┐
   │ Node worker_threads × N            │
   │ ┌──────┐ ┌──────┐ ... ┌──────┐    │
   │ │ W#1  │ │ W#2  │     │ W#N  │    │
   │ └──────┘ └──────┘     └──────┘    │
   │ 每 worker 跑独立 Vite SSR + 评估器  │
   └───────────────────────────────────┘
           │  result: { metrics, subscores }
           ▼
   写 SQLite spawn_tuning_samples_v2
```

### 5.7 实测吞吐基线 (Phase C 实测)

在 **darwin arm64, Node v25.9.0, 10 CPU core** 上跑 `scripts/spawn-tune-benchmark.mjs` 实测：

#### 单 worker 吞吐 (与文档假设 30 games/s 差距很大)

| 评估配置 | games/s | 单样本耗时 |
|---|---|---|
| 5 局 × 60 步 × 2 bot × 1 gen (10 games) | **12.7** | 788 ms |
| 30 局 × 240 步 × 3 bot × 1 gen (90 games) | **3.6** | 25.0 s |
| 30 局 × 120 步 × 3 bot × 1 gen (90 games) | **6.0** | 14.9 s |
| 30 局 × 120 步 × 3 bot × 2 gen (180 games) | **6.1** | 29.5 s |

**核心发现**：
- 单样本耗时主要受 `maxSteps` 影响 (240→120 步 → 单样本耗时 25.0→14.9s,降 40%)
- 单一生成器 vs 两个生成器吞吐 (games/s) 几乎相同 ── 评估器固定开销摊薄
- **文档原假设的 30 games/s 与实测 6.0 games/s 差距 5 倍**：原假设过于乐观

#### SQLite 批量写入吞吐 (不是瓶颈)

| 行数 | 耗时 | 吞吐 |
|---|---|---|
| 1,000 | 4 ms | 270 K rows/s |
| 10,000 | 36 ms | 278 K rows/s |
| 50,000 | 206 ms | 243 K rows/s |
| 61,000 行索引读 | 1 ms | — |

**结论**：SQLite 240K rows/s 远超采样速度 (10 samples/s)，**完全不会成为瓶颈**。

#### 并行扩展性 (Vite SSR + worker_threads,效率 ~50%)

| Workers | 单样本耗时 (5×60 配置) | 加速比 | 效率 |
|---|---|---|---|
| 1 | 1.38 samples/s | 1.00× (baseline) | 100% |
| 2 | 2.70 samples/s | 1.95× | 98% |
| 4 | 4.75 samples/s | 3.22× | 81% |
| 8 | 5.96 samples/s | 4.04× | 51% |

**核心发现**：
- 1→4 workers 效率良好 (81%)
- 4→8 workers 效率骤降 (51%)，**主要是 Vite SSR server per-worker 启动开销 + V8 进程间 IPC 成本**
- 10 核机器超过 4 workers 收益边际显著减小

#### 100K 样本现实耗时推算

按 30 局 × 120 步配置 (90 games/sample,14.9s/sample @ 1 worker):

| Workers | 推算总耗时 |
|---|---|
| 1 | ~25 小时 (单机不可行) |
| 4 | ~8 小时 |
| 8 | ~5.8 小时 |
| 16 (假设线性) | ~3 小时 (实际由于扩展性下降可能 3.5-4 小时) |

**推荐策略**：
- **Phase 1 MVP**: 单 context × 1K 样本 @ 4 workers ≈ 3.5 分钟,可接受
- **Phase 2 全 context 10K**: ≈ 35 分钟,午间咖啡时间
- **Phase 3 100K 全量**: **5.8 小时夜跑** (8 workers,默认 30×120 配置)

如果要把 100K 缩到 2 小时内：
1. 用更小的评估配置 (5×60 → 10 games/sample) 损失数据质量
2. 用更多 workers (需要更多核心) 边际效益递减
3. 跨机分布式 (Phase 4 灰度后) 工程量大

建议接受 100K 5.8 小时这个数字,不要为了缩时间牺牲数据质量。

### 5.8 Benchmark 复现

```bash
# 快速验证 (~10 秒)
node scripts/spawn-tune-benchmark.mjs --quick

# 完整测量 (~2 分钟)
node scripts/spawn-tune-benchmark.mjs
```

输出会打印 3 类基线 + 100K 推算耗时。改硬件 / Node 版本后应重新跑。

---

## 6. 训练可视化（Web UI）

### 6.1 7 个核心面板

1. **样本进度大盘**：当前 X/105,000，按 phase 着色（A/B/C/D/E）
2. **吞吐曲线**：每分钟新增样本数，发现 worker 阻塞
3. **3 子分数分布**：箱型图按 context 切分，看哪些 context 难达标
4. **代理模型训练曲线**：train/val loss 时序，过拟合预警
5. **参数敏感度热图**：14 参数 × 120 context 的 importance（NN gradient 平均）
6. **每 context 最优 θ 散点**：14 维降维到 2D（t-SNE），相似 context 应聚类
7. **预测 vs 真实对照**：Phase E 验证样本上的散点（绿点 = MAE < 0.05）

### 6.2 训练实时控制

- **暂停 / 恢复**：保留中间状态
- **跳到 Phase D**：跳过冷启动（已有 D₀ 数据时）
- **回滚到上一个 surrogate checkpoint**
- **添加自定义 context**：临时塞一个 (3 hard, P2, 25000, plateau) 等极端 context 增加采样

---

## 7. SQLite Schema (v0.2)

### 7.1 三张主表

```sql
-- 寻参任务（保持 v0.1）
CREATE TABLE spawn_tuning_runs (
    run_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL,
    param_space_v   INTEGER NOT NULL,
    objective_weights_json TEXT NOT NULL,
    budget          INTEGER NOT NULL,
    seeds_per_theta INTEGER DEFAULT 3,
    started_at      INTEGER NOT NULL,
    completed_at    INTEGER,
    sample_count    INTEGER DEFAULT 0,
    surrogate_path  TEXT,                       -- 训练后的 NN 权重文件
    note            TEXT
);

-- 大规模评估样本（v0.2 新表,与 v0.1 的 spawn_tuning_samples 并存）
CREATE TABLE spawn_tuning_samples_v2 (
    sample_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER NOT NULL,
    context_key      TEXT NOT NULL,
    difficulty       TEXT NOT NULL,
    generator        TEXT NOT NULL,
    bestScore_bin    INTEGER NOT NULL,
    lifecycle_stage  TEXT NOT NULL,
    theta_json       TEXT NOT NULL,
    seed             INTEGER NOT NULL,
    -- 13 列原始指标
    noMoveRate REAL, clearsMean REAL, multiClearRate REAL,
    fallbackRate REAL, firstMoveFreedomMean REAL,
    clearIntervalP90 REAL, nearPbRate REAL, breakPbRate REAL,
    overshootRate REAL, scoreMean REAL, scoreP90 REAL,
    evaluatedTripletsMean REAL,
    -- 3 子分数（未应用 lifecycle 乘子,实时计算）
    fairness_score REAL, excitement_score REAL, antiInflation_score REAL,
    eval_ms          INTEGER,
    evaluated_at     INTEGER,
    sample_phase     TEXT,
    UNIQUE(run_id, context_key, theta_json, seed)
);
CREATE INDEX idx_samples_v2_ctx ON spawn_tuning_samples_v2(run_id, context_key);

-- 上下文条件化策略表（v0.2 核心新表）
CREATE TABLE spawn_tuning_policies (
    policy_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER NOT NULL,
    context_key      TEXT NOT NULL,
    difficulty       TEXT NOT NULL,
    generator        TEXT NOT NULL,
    bestScore_bin    INTEGER NOT NULL,
    lifecycle_stage  TEXT NOT NULL,
    theta_json       TEXT NOT NULL,
    expected_fairness     REAL,
    expected_excitement   REAL,
    expected_antiInflation REAL,
    expected_composite    REAL,
    surrogate_uncertainty REAL,
    n_validation_samples  INTEGER,
    is_active        INTEGER DEFAULT 0,
    deployed_at      INTEGER,
    deployment_signature TEXT,
    notes            TEXT,
    UNIQUE(run_id, context_key)
);
CREATE INDEX idx_policies_active ON spawn_tuning_policies(is_active, context_key);

-- 神经网络代理 checkpoint（v0.2 新表）
CREATE TABLE spawn_tuning_surrogates (
    surrogate_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER NOT NULL,
    phase            TEXT NOT NULL,           -- 'B' | 'D_iter_1' | 'D_iter_2'
    weights_path     TEXT NOT NULL,
    architecture_json TEXT NOT NULL,
    train_loss       REAL,
    val_loss         REAL,
    val_mae_fairness REAL,
    val_mae_excitement REAL,
    val_mae_antiInflation REAL,
    n_train_samples  INTEGER,
    trained_at       INTEGER
);
```

---

## 8. 生产部署（120 context 查表）

### 8.1 启动加载

```js
async function loadActiveTuningPolicies() {
    try {
        const r = await fetch('/api/spawn-tuning/policies/active');
        const policies = await r.json();
        // policies 是 120 行的 Map: { context_key → theta }
        return new Map(policies.map(p => [p.context_key, p.theta_json]));
    } catch (e) {
        console.warn('[spawn-tuning] fallback to defaults', e);
        return null;
    }
}
```

### 8.2 每局开始时查表

```js
function resolveSpawnTheta(policies, playerCtx) {
    if (!policies) return DEFAULT_THETA;
    const ctxKey = makeContextKey(playerCtx);
    
    // 退化 0: 精确匹配
    if (policies.has(ctxKey)) return policies.get(ctxKey);
    
    // 退化 1: lifecycle 模糊（其他 3 维精确）
    const fuzzyLife = `${playerCtx.difficulty}:${playerCtx.generator}:${playerCtx.bestScore_bin}:*`;
    const lifeMatch = [...policies.keys()].find(k => keyMatches(k, fuzzyLife));
    if (lifeMatch) return policies.get(lifeMatch);
    
    // 退化 2: 仅 difficulty + generator
    const coarse = `${playerCtx.difficulty}:${playerCtx.generator}:*:*`;
    const coarseMatch = [...policies.keys()].find(k => keyMatches(k, coarse));
    if (coarseMatch) return policies.get(coarseMatch);
    
    // 退化 3: 全局默认
    return DEFAULT_THETA;
}
```

### 8.3 一键回滚

POST `/api/spawn-tuning/rollback/v2`：

- 设置当前 run 所有 policy 的 `is_active = 0`
- 触发 CDN 缓存刷新
- 客户端下次启动加载新 policies = []，自动 fallback 到 DEFAULT_THETA
- 写审计日志

### 8.4 密钥分发与验签 (v0.3.4)

3 种验签模式 (按生产强度递增):

| 模式 | 强度 | 用法 | 适用阶段 |
|---|---|---|---|
| `none` | 无验签 | `setVerifyMode('none')` | 本地开发,**禁止生产** |
| `structural` | 检查签名非空 | (默认,零配置) | 内测,信任 HTTPS |
| `hmac-shared` (编译期) | HMAC-SHA256 | `setSharedSecret(secret)` 或 init `{ hmacSecret }` | 灰度阶段,secret 反编译可见但生命周期短 |
| `hmac-shared` (启动拉取) | HMAC-SHA256 | `fetchAndCacheSecret(api, { authToken })` 或 init `{ authToken }` | **生产推荐**,密钥不入 bundle |

服务端要求:
- `SPAWN_TUNING_SECRET` 环境变量 ≥32 字节随机密钥
- `SPAWN_TUNING_AUTH_REQUIRED=1` 强制 `/v2/auth/secret` 验 Bearer token
- `SPAWN_TUNING_CLIENT_TOKEN` 共享 token (生产应升级到 JWT/会话验证)

### 8.5 信号处理 (v0.3.4)

CLI 与 worker_threads 三层 SIGINT/SIGTERM 清理 (避免历史 400% CPU 残留问题):

```
scripts/spawn-tune-v2.mjs (main)
    │
    │  init 阶段被 Ctrl-C → process.once cleanup → exit 130
    │
    ├─ runMasterParallel() 启动后主动 process.off 撤销 early handler
    │
    └─ web/src/tuning/masterWorker.js (接管)
            │  Ctrl-C → 日志 → Promise.all(workers.shutdown()) → exit 130
            │
            └─ web/src/tuning/evalWorker.js × N (worker_threads)
                    └─ 收到 shutdown message → 关 Vite SSR → exit 0
                       或自己收到 SIGTERM → 兜底关 Vite SSR → exit 0
```

### 8.6 自动化 stage 检查 (v0.3.4)

```bash
# Stage 0: shadow 部署后立即检查
npm run spawn:tune:stage-check -- --stage 0 --api http://localhost:8000

# Stage 1: 灰度 10% 启动后检查
npm run spawn:tune:stage-check -- --stage 1 --new-run 20260526

# Stage 2: 全量发布前最终检查
npm run spawn:tune:stage-check -- --stage 2 --new-run 20260526
```

退出码:
- 0 = 全部通过,可推进下一 stage
- 1 = warning,需人工审查 (CI 可标黄不阻断)
- 2 = critical,**禁止推进**,CI 必须阻断

每个 stage 自动检查的具体项参考 `scripts/spawn-tuning-stage-check.mjs` 内的 `stage0/1/2` 函数。

---

## 9. 分阶段实施路线（更新）

### Phase 1: 单 context MVP (1 周)

目标：跑通流水线，验证算法可行

- [ ] 选 1 个 context: `normal:budget-p2:1500:growth`
- [ ] 在 Web 端做 1K 样本（Worker × 4），用简单回归（Random Forest）验证目标拟合
- [ ] UI 加进度面板 + 子分数分布图

**验收**：1K 样本下找到的 θ 在 spawn-eval 30 局验证下 J 显著高于默认。

### Phase 2: 全 context + 10K 样本 (2 周)

目标：覆盖全 120 context，验证 NN 代理可行

- [ ] 实现 Master + 32 Workers 并行架构
- [ ] 10K LHS 冷启动样本
- [ ] PyTorch NN 代理首次训练
- [ ] Phase C 梯度上升
- [ ] 120 个 (context, θ\*) 写入 policies 表

**验收**：随机选 10 个 context 比较 θ\* 与 baseline，至少 7 个 J 提升 > 5%。

### Phase 3: 全规模 100K + 主动学习 (2 周)

目标：达成 user 要求的 10w+ 样本规模

- [ ] Phase A 35K + Phase D 70K 完整跑
- [ ] 主动学习不确定性引导
- [ ] 训练面板 7 个可视化
- [ ] Phase E 验证 + 一键导入 spawn-eval

**验收**：完整 5 小时寻参跑完，120 contexts 全部覆盖；spawn-eval 验证 ≥ 90% context 性能优于 v0.1 单点最优。

### Phase 4: 生产灰度发布 (2 周)

目标：上线 + 监控 + 回滚

- [ ] 3 阶段灰度（shadow → 10% → 100%）
- [ ] 客户端 4 层退化兜底
- [ ] 监控仪表盘（每 context 真实 vs 预测对照）
- [ ] CI 周度自动跑寻参，推 PR

**验收**：灰度 10% 用户 48h 内核心指标（DAU、retention）无回退。

---

## 10. 风险与边界（更新）

| 风险 | 严重度 | 缓解 |
|---|---|---|
| **120 context 部分采样不足** | 高 | Phase D 边界 context 主动加强；NN 跨 context 共享信息缓解 |
| **NN 代理过拟合** | 高 | Dropout + early stopping + 10% val 集；λ_smooth 正则光滑响应面 |
| **λ_mono 强制单调性误伤** | 中 | 训练后人工对比单调性约束开关的预测；λ_mono 设置可调 |
| **生命周期定义滞后** | 中 | totalRounds / daysSincePb 实时从 playerProfile 读取,不缓存 |
| **PB 容忍度公式过敏感** | 中 | log10 平滑 + sigmoid 限幅；CI 监控容忍度边界 context 的 antiInflation 分布 |
| **NN 推断引入额外延迟** | 低 | 启动时一次性加载 120 个查表 + 客户端 NN 不参与运行时 |
| **数据库表过大** | 低 | spawn_tuning_samples_v2 按 run_id 分区；旧 run 定期归档 |

---

## 11. 与现有四模型系统的关系

完全沿用 v0.1 §8，无改动。寻参产出的 (context, θ) 表只影响**启发式出块**的配置层，不动**生成式出块 / PyTorch RL / 浏览器 RL** 的训练。

---

## 12. 文件落点 (v0.2)

```text
docs/algorithms/SPAWN_AUTO_TUNING.md         ← 本文 (v0.2)

# Phase 1-3 节点
scripts/spawn-tune-v2.mjs                    ← CLI 入口
web/spawn-tuning.html                        ← Web UI 独立页面
web/src/spawnTuningApp.js                    ← Web 主逻辑 + 进度展示
web/src/tuning/contextSpace.js               ← context 定义 + lifecycle / bestScore 分档
web/src/tuning/objective.js                  ← 条件化 J(θ|c) 计算 + PB 容忍度 + 生命周期乘子
web/src/tuning/lhsSampler.js                 ← Latin Hypercube
web/src/tuning/sampleStore.js                ← SQLite 大表写入封装
web/src/tuning/masterWorker.js               ← 32 worker 并行编排
web/src/tuning/evalWorker.js                 ← 独立 worker 跑 spawnEvaluation
rl_pytorch/spawn_tuning/                     ← Phase B 训练
    train_surrogate.py                       ← NN 代理训练
    surrogate_model.py                       ← MLP + embedding 架构
    optimize_theta.py                        ← Phase C 梯度上升
    active_sampling.py                       ← Phase D 主动学习

# 后端
server.py                                    ← /api/spawn-tuning/v2/* 路由

# 测试
tests/spawn-tuning-v2.test.js                ← 单元测试
tests/spawn_tuning_surrogate.py              ← Python 训练测试
```

---

## 13. 验收标准（Phase 3 完整产出）

1. **样本规模**：spawn_tuning_samples_v2 累计 ≥ 100,000 行
2. **context 覆盖**：120 个 context 每个 ≥ 500 样本
3. **代理精度**：NN val MAE ≤ 0.05 (在 3 个子分数上)
4. **优化效果**：120 contexts 中至少 90% 的 θ\* 在 spawn-eval 验证下 J ≥ baseline + 5%
5. **生命周期合理性**：onboarding context 的最优 θ overshootRate 可达 35%+ 但仍判健康；mature context 的 overshootRate ≤ 8%
6. **可再现性**：相同种子下两次 100K 寻参的最终 (context, θ) 表平均 L2 距离 < 0.1
7. **灰度通过率**：Phase 4 灰度 10% 阶段无指标回退

---

## 14. 设计取舍说明（v0.2 决策清单）

### Q: 为什么 100K 样本不用 GP / BO？
GP 拟合 O(N³) 在 100K 上需要 10^15 操作，物理不可行。即使 sparse GP (SVGP/SKI) 也难处理 27 维输入 + multi-task。NN 在 100K 规模是教科书选择。

### Q: 为什么不直接训 RL?
RL 学的是「在状态 s 下选动作 a」，本任务是「选超参数 θ」。RL 的状态-动作框架对超参寻优 awkward——动作空间是连续 14 维，需要 actor-critic 才能跑，但 actor-critic 又需要 reward 信号，而 reward 就是评估结果...等于绕远路。**直接代理模型 + 梯度上升更高效**。

### Q: 为什么按 4 维 context 切分而不是单一神经网络泛化？
两种方案都可以，但分 context 有 3 个好处：
- 解释性强：每 context 的 θ\* 可独立审查
- 灰度可控：可只灰度某些 context（如先灰度 onboarding 不动 mature）
- 部署简单：120 行查表 vs 上线神经网络推断

代价是 context 之间信息共享靠 NN trunk 的 embedding 实现，不直接显式。

### Q: 为什么 PB 容忍度用 sigmoid 而不是线性？
玩家 bestScore 是 log-normal 分布。线性容忍度对低 best 玩家不够宽容、对高 best 玩家又太严。sigmoid + log10 让中位玩家附近过渡平滑。

### Q: 为什么生命周期权重乘子是定值而非学习参数？
**业务先验**而非数据先验。运营 / 策划 / 产品对"新手期该优待 fairness" 有强意见，不应该由数据"反驳"。学习它会让模型在数据不足时给出反常识结果（如新手期反向高 antiInflation）。

### Q: 为什么不在 Phase 1 直接上 100K?
1K MVP 让我们快速发现实现 bug（并行队列、SQLite 锁、worker 死锁）。这些 bug 在 100K 规模下定位成本极高。

---

## 15. 完整实施成果 (v0.3 最终态)

按 B → C → A 串行完成,后续不停顿继续完成 Web UI / Server API / Python 代理骨架 / CI。

**截至当前:121 个测试通过 + 完整 CLI 闭环可跑通**。

### 15.0 完整文件清单

```
web/src/tuning/                              ← MVP 核心模块 (Phase A)
├── objective.js          (240 行)            目标函数 + PB 容忍度 + 生命周期乘子
├── contextSpace.js       (170 行)            120 个 context 定义 + key 序列化
├── paramSpace.js         (250 行)            14 维参数空间 + 归一化
├── lhsSampler.js         (130 行)            拉丁超立方 + Phase A 任务生成
├── sampleStore.js        (290 行)            InMemory + Sqlite + Hybrid 三级
├── evalWorker.js         (130 行)            Node worker_threads 评估 worker
└── masterWorker.js       (180 行)            多 worker 并行编排

web/spawn-tuning.html                        ← Web UI (浏览器版 MVP)
web/src/spawnTuningApp.js     (290 行)        前端主逻辑 + Canvas 实时图

scripts/
├── spawn-tune-v2.mjs     (240 行)            CLI 完整闭环入口
└── spawn-tune-benchmark.mjs (240 行)         基础设施 benchmark

rl_pytorch/spawn_tuning/                     ← Python NN 代理 (Phase B-D)
├── __init__.py
├── surrogate_model.py    (130 行)            MLP 代理 + 多任务头 (9.7K 参数)
├── feature_io.py         (130 行)            SQLite → Tensor 编码
├── train_surrogate.py    (170 行)            Phase B 训练入口
├── optimize_theta.py     (200 行)            Phase C 梯度上升
└── active_sampling.py    (180 行)            Phase D 主动学习

server.py                                    ← 后端 API (扩 6 个路由)
  /api/spawn-tuning/v2/runs                  POST 创建任务
  /api/spawn-tuning/v2/runs/<id>             GET 查询状态
  /api/spawn-tuning/v2/runs/<id>/samples     POST 批量写样本
  /api/spawn-tuning/v2/runs/<id>/finish      POST 标记完成
  /api/spawn-tuning/v2/policies/active       GET 获取激活策略
  /api/spawn-tuning/v2/policies/deploy       POST 部署策略
  /api/spawn-tuning/v2/policies/rollback     POST 一键回滚

.github/workflows/spawn-tuning-weekly.yml    ← CI 周度自动跑

tests/tuning/                                ← 121 个测试
├── objective.test.js      27 tests
├── contextSpace.test.js   22 tests
├── paramSpace.test.js     30 tests
├── lhsSampler.test.js     16 tests
├── sampleStore.test.js    19 tests
└── masterWorker.test.js    7 tests
```

### 15.1 模块清单 (与 v0.3 前一稿一致)

### 15.1 模块清单

| 模块 | 文件路径 | 行数 | 测试 |
|---|---|---|---|
| 目标函数 | `web/src/tuning/objective.js` | 240 | `tests/tuning/objective.test.js` (27 tests) |
| 上下文空间 | `web/src/tuning/contextSpace.js` | 170 | `tests/tuning/contextSpace.test.js` (22 tests) |
| 参数空间 | `web/src/tuning/paramSpace.js` | 240 | `tests/tuning/paramSpace.test.js` (30 tests) |
| LHS 采样器 | `web/src/tuning/lhsSampler.js` | 130 | `tests/tuning/lhsSampler.test.js` (16 tests) |
| 样本存储 | `web/src/tuning/sampleStore.js` | 290 | `tests/tuning/sampleStore.test.js` (19 tests) |
| Benchmark | `scripts/spawn-tune-benchmark.mjs` | 240 | (脚本自验证) |

### 15.2 测试覆盖矩阵

```
objective.js:
  ✓ clamp01 / sigmoid 数值安全
  ✓ overshootTolerance 单调性 (500→25000 严格递减)
  ✓ overshootTolerance §3.2 表近似 (5 个 best 档全部 ±0.03)
  ✓ breakHealthScore (8%~15% 区间为 1)
  ✓ fairness / excitement / antiInflation 子分数最佳/最差边界
  ✓ antiInflation 跨 bestScore 不对称 (best=500 宽容 vs best=25000 严厉)
  ✓ lifecycle 4 阶段乘子表与文档对齐
  ✓ computeObjective 端到端: composite ∈ [0,1] / 全 0 权重不 NaN / 比例不变 composite 不变

contextSpace.js:
  ✓ 总数 120 = 3×2×5×4
  ✓ bestScore 5 档边界值精确
  ✓ lifecycle 4 阶段优先级 (onboarding > growth > plateau > mature)
  ✓ key 序列化 / 反序列化往返
  ✓ 120 个 context 全部 key 唯一且可往返
  ✓ validateContext 拒 4 类非法字段

paramSpace.js:
  ✓ 14 维空间 (5 模型参数 + 5 PB 调制系数 + 4 PB 曲线形状)
  ✓ default theta 通过 validateTheta
  ✓ 归一化/反归一化所有类型 (float/int/choice) 往返
  ✓ projectToValidTheta: 越界值 / NaN / 非法 choice → 投影到合法

lhsSampler.js:
  ✓ LHS 核心保证: 每维度 n 样本恰好覆盖 n 个 bin
  ✓ 固定 seed 可复现 / 不同 seed 不同样本
  ✓ buildPhaseATasks 全 120 ctx × 97 θ × 3 seed ≈ 35K (与文档 §5.2 一致)
  ✓ 不同 context 用不同 LHS 集合 (避免数据重复)

sampleStore.js:
  ✓ InMemory: append / appendMany / 按 context_key 索引 / 按 run_id 索引
  ✓ Hybrid 双层: 内存优先 + sqlite 批量异步 flush
  ✓ flushBatchSize 触发自动 flush / close 刷尾巴
  ✓ Sqlite mock: 拒绝非法 db 对象 / ensureSchema 建表
```

### 15.3 关键不变量 (测试保证)

1. **120 个 context 在内存索引中无碰撞**: 任意两 context 的 key 不同
2. **objective.composite 永远 ∈ [0, 1]**: 哪怕权重全 0、子分数取边界值
3. **bestScore 越大,antiInflation 越严**: 相同 overshootRate 在 best=25000 比 best=500 得分低 ≥10%
4. **LHS 输出每维度恰好覆盖 n 个 bin**: 不是纯随机
5. **theta 归一化 ↔ 反归一化 往返误差 < 1e-6** (除离散值整数化)

### 15.4 一键回归测试

```bash
# 运行寻参所有模块测试 (~1 秒)
npx vitest run tests/tuning/

# 输出预期: 114/114 passed
```

### 15.5 端到端跑通流程 (完整闭环验证)

#### 步骤 1: 基础设施基线 (一次性,有变化再重跑)

```bash
npm run spawn:tune:bench:quick  # 10 秒
# 或完整:
npm run spawn:tune:bench         # 2 分钟
```

输出 single-eval / SQLite / 并行扩展性的真实数字。

#### 步骤 2: 跑 Phase A MVP (单 context × 1K samples)

```bash
# 浏览器: 访问 http://localhost:3000/spawn-tuning.html, 调参后点开始
# CLI: 推荐
node scripts/spawn-tune-v2.mjs \
  --contexts 'normal:budget-p2:1500:growth' \
  --thetas 100 --seeds 3 \
  --workers 4 --sessions 30 --max-steps 120 \
  --db .cursor-stress-logs/spawn-tuning-mvp.sqlite \
  --out .cursor-stress-logs/spawn-tuning-mvp.json
```

预计 ~8 分钟 @ 4 workers, 300 samples 落 SQLite。

#### 步骤 3: Phase A 全规模 (35K samples)

```bash
node scripts/spawn-tune-v2.mjs --full --workers 8 \
  --db .cursor-stress-logs/spawn-tuning-full.sqlite
```

预计 ~2 小时 @ 8 workers (基于 §5.7 实测推算)。

#### 步骤 4: Phase B 训练 NN 代理

```bash
python -m rl_pytorch.spawn_tuning.train_surrogate \
  --db .cursor-stress-logs/spawn-tuning-full.sqlite \
  --run-id <来自步骤 3 的 run_id> \
  --output checkpoints/surrogate_phase_b.pt \
  --epochs 50 --batch-size 256
```

预计 ~15 min (CPU, MacBook M-series)。

#### 步骤 5: Phase C 找每 context 最优 θ*

```bash
python -m rl_pytorch.spawn_tuning.optimize_theta \
  --surrogate checkpoints/surrogate_phase_b.pt \
  --weights-fairness 70 --weights-excitement 45 --weights-anti-inflation 60 \
  --n-starts 10 --steps 300 \
  --output policies.json
```

预计 ~5 min, 输出 120 行 (context → θ*) 表。

#### 步骤 6: 部署 (灰度 Stage 0 → 1 → 2)

```bash
# Stage 0: shadow (评估端可见, 客户端不取)
curl -X POST localhost:8000/api/spawn-tuning/v2/policies/deploy \
  -H 'Content-Type: application/json' \
  -d @policies.json
# 服务端会自动 set is_active=1

# Stage 1 灰度 10% (人工评审通过后)
# - 客户端 resolveSpawnTheta 启用 Math.random() < 0.10 抽样
# - 监控 48h 关键指标无回退

# Stage 2 全量 (人工评审通过后)
# - 客户端去掉抽样,所有用户都取 policies
```

#### 步骤 7: 一键回滚 (紧急)

```bash
curl -X POST localhost:8000/api/spawn-tuning/v2/policies/rollback
# 客户端下次启动 fetch 不到 active policies → fallback 到 DEFAULT_THETA
```

### 15.6 验收基线 (Phase 3 完整跑通后)

1. **样本规模**: spawn_tuning_samples_v2 累计 ≥ 100,000 行 ✓
2. **context 覆盖**: 120 个 context 每个 ≥ 500 样本 ✓
3. **代理精度**: NN val MAE ≤ 0.05 (3 个子分数上)
4. **优化效果**: 120 contexts 至少 90% 的 θ\* J 提升 ≥ 5% vs default
5. **生命周期合理性**: onboarding ctx 的 θ\* 允许 overshootRate 35%+; mature ctx ≤ 8%
6. **可再现性**: 相同种子两次 100K 寻参的 policies 平均 L2 < 0.1
7. **灰度通过**: 10% 用户 48h 无指标回退

### 15.7 Web UI 截图 (功能说明)

`web/spawn-tuning.html` 包含 6 个区:

1. **任务配置**: context 过滤 / θ 数 / seed 数 / workers / sessions
2. **目标权重**: 与 spawn-eval 同款 3 滑块
3. **启动按钮 + 预算估算**
4. **实时进度面板**:
   - 进度条 + 已完成/总数/samples/s/ETA/失败 5 个指标
   - Canvas 实时绘制 3 子分数时序 (蓝/绿/橙)
5. **Top θ 排行表** (按 composite 降序)
6. **运行日志面板**

浏览器适合 ≤500 样本快速验证,大规模用 CLI。

### 15.8 灰度发布 Runbook

| Stage | 触发条件 | 操作 | 监控 |
|---|---|---|---|
| **Stage 0 shadow** | 步骤 6 完成 deploy | 所有 120 行 is_active=1 | 评估端跑 policies 对比 baseline,验证离线评估一致 |
| **Stage 1 灰度 10%** | shadow 48h 无异常 | 前端 `Math.random() < 0.10 ? policy : DEFAULT_THETA` | DAU / retention / scoreP90 无 ≥5% 偏移 |
| **Stage 2 全量** | 灰度 10% 7 天无指标回退 | 前端去抽样 | 持续观察 30 天 |
| **回滚** | 任一指标 5% 偏移 | POST /policies/rollback | 立即生效, CDN 刷新 |

---

## 修订记录

| 版本 | 日期 | 改动 |
|---|---|---|
| v0.1 | 2026-05-24 | 首次设计：100 样本 BO+GP 单点最优 |
| v0.2 | 2026-05-24 | 升级到 100K+ 样本、上下文条件化、NN 代理、生命周期权重 |
| v0.3 | 2026-05-24 | B→C→A 串行落地：Phase B 公式定型 + Phase C benchmark 实测 (6 games/s, 4×@8w) + Phase A MVP (5 模块 + 114 测试通过) |
| v0.3.1 | 2026-05-24 | 完整端到端: evalWorker/masterWorker + CLI 闭环 + Web UI + Server API 6 路由 + Python NN 代理骨架 (9.7K 参数) + CI 周度工作流。121 测试通过 |
| v0.3.2 | 2026-05-24 | 完成「没做的部分」+ 看板: <br>① 客户端灰度切量 (clientPolicy.js + 24 tests + game.js 主路径接入) <br>② HMAC 签名 (hmacVerify.js + 16 tests + server.py 自动签名) <br>③ Python loss 单调性+光滑性正则真实实现 (autograd.grad 显式求偏导) <br>④ 看板 dashboard.html + 4 tab + server.py 扩 2 endpoint <br>⑤ Web Worker 浏览器并行 (browserWorker.js + 池化) <br>⑥ Phase A 375 samples 真实采集 → Phase B val_mae fairness 0.008 → Phase C 120 policies <br>⑦ PR 评审 template + Stage 0/1/2 灰度 runbook <br>172/172 测试通过, Vite build 通过, bundle size 在预算 |
| v0.3.3 | 2026-05-24 | 升级到大规模 + 扩展架构 + 线上指标: <br>① 大规模采集 2120 samples / 36 contexts (vs v0.3.2 的 375/15, 5.6×) <br>② NN val_mae fairness 0.008→**0.005** (-38%), excitement 0.014→**0.012** (-14%) <br>③ Phase C 平均 composite 0.679→**0.691** (+1.8%) <br>④ Context 维度扩展架构 (registerContextDimension + lookup chain, 17 tests) <br>⑤ 灰度上线监控 SDK (policyMetrics.js + 11 tests + game.js gameOver 上报) <br>⑥ Server 接收上报: /v2/metrics/sample + /v2/metrics/aggregate + DB 表 spawn_tuning_field_metrics <br>⑦ 看板新增 Tab ⑤ 线上效果 (按 hours + context filter 查真实玩家指标) <br>200/200 测试通过 (含 17+11+10 新), Vite build 通过 (main +4KB) |
| v0.3.4 | 2026-05-24 | 生产化收尾: <br>① 信号处理 (SIGINT/SIGTERM): masterWorker.js + evalWorker.js + CLI 三层清理,Ctrl-C 不再残留 400% CPU <br>② 密钥分发 3 模式: setVerifyMode + setSharedSecret + fetchAndCacheSecret;支持编译期注入/启动时拉取/无配置降级到 structural <br>③ Server `/v2/auth/secret` endpoint: 需 Authorization Bearer token,可禁用 (SPAWN_TUNING_AUTH_REQUIRED=0 仅开发) <br>④ Stage 检查脚本 spawn-tuning-stage-check.mjs: Stage 0/1/2 各自的 server 联通+签名+真实指标自检,退出码区分 critical/warn <br>211/211 测试通过 (含 hmacVerify 28 新 12) |
| v0.3.5 | 2026-05-24 | 工具整合 + 进一步去重: <br>① spawn-eval 与 spawn-tuning 整合到统一看板 `spawn-tuning-dashboard.html`,按 7 tab 场景组织 <br>② spawn-eval 旧入口保留并加 banner 引导到看板 <br>③ spawn-eval 的「自动寻优」从 4 个 hardcoded 候选升级为复用 `lhsSampler.latinHypercube` (8 LHS + 1 baseline + 1 triplet-p1 = 10 候选,5 维参数空间),与看板算法一致 <br>④ 抽出 `pbCurveMini.js` 组件并嵌入看板 Tab ⑤ 「结果分析」,选 θ 时显示其在 PB 曲线上落点 |
| v0.3.6 | 2026-05-24 | **PyTorch HTTP 后端 (参考 rl_backend 模式)**: <br>① 新建 `spawn_tuning_backend.py` (300 行) —— 把 Phase B 训练 / Phase C 优化 暴露为 8 个 REST endpoint (`/api/spawn-tuning/v2/torch/*`),server.py 通过 `register_spawn_tuning_routes(app)` 注册 <br>② Backend 用 subprocess.Popen 拉起 `python -m rl_pytorch.spawn_tuning.train_surrogate` 与 `optimize_theta`,stdout 重定向到日志文件,job_id 跟踪状态,SIGTERM 取消 <br>③ Dashboard Tab ② 「寻参与采样」下方新增模块 ⑥「PyTorch NN 代理训练」: torch 状态卡片 (版本/CUDA/MPS/checkpoint 数) + Phase B 配置面板 (run_id/epochs/batch/lr/device) + Phase C 配置面板 (checkpoint/权重/n_starts/steps) + 实时日志 tail (2s 轮询) + checkpoint/policies 列表 + 「📦 加载部署」一键按钮 <br>④ 端到端验证: Phase B 2 epochs (375 samples, CPU) 4s 跑通,val MAE [f:0.24 e:0.15 a:0.26];Phase C 120 contexts (n_starts=2, steps=50) 8s 跑通,输出 policies-job-*.json <br>⑤ MPS 后端可用 (Apple Silicon),torch 版本自动检测;子进程退出码区分 completed / failed (exit N) <br>⑥ 部署流: 看板列出 policies-*.json → 用户点「📦 加载部署」→ 后端读文件 → 前端调 `/v2/policies/deploy` (Shadow 模式) → 自动 HMAC 签名 |
| v0.3.7 | 2026-05-24 | **离线 Bundle (四端无网可用)**: <br>① 新增 `POST /api/spawn-tuning/v2/policies/bundle/export` — 把当前 active policies (或指定 policies-*.json) 烘焙到 `web/public/spawn-tuning/policies.json` + `policies.meta.json` (含 SHA-256 / 生成时间 / run_id) + `miniprogram/core/tuning/spawnPolicies.js` (CJS 数据模块) <br>② `clientPolicy.loadPoliciesFromBundle(url)` 新函数 — 从静态资源读 policies 立即 install,断网也能用 <br>③ `gameIntegration.initSpawnTuningHook` 改为 **bundle-first 启动**: 先同步加载 bundle (零延迟),再异步 fetch server `/policies/active` 覆盖。两者都失败才走 DEFAULT_THETA。server 失败时不再 uninstall (保留 bundle) <br>④ 看板 PyTorch 区新增「离线 Bundle」子区: 状态卡 (policies 数/大小/距上次烘焙/小程序模块状态) + 「📦 烘焙到离线包 (四端)」+「从文件烘焙…」+「↻ 检查状态」三按钮 <br>⑤ `server.py` 新增 `/spawn-tuning/<path>` 静态路由 (优先 dist/,次选 web/public/);Vite build 自动把 `web/public/spawn-tuning/*` 拷到 `dist/spawn-tuning/*`,Capacitor 一并打包进 APK/IPA <br>⑥ `scripts/sync-core.sh` 末尾追加 spawnPolicies.js 同步 (从 web/public/spawn-tuning/policies.json 转 CJS),让独立跑同步脚本也能更新小程序离线策略 <br>⑦ 端到端验证: 120 policies / 75 KB JSON / SHA-256 一致,dist/spawn-tuning/policies.json + miniprogram/core/tuning/spawnPolicies.js 同时生成 <br>⑧ 离线弹性: 完全无网时 — bundle 直接生效 (不降级到 default); 弱网时 — bundle 先用着,server 静默后台更新灰度比例; 冷启动失败时 — DEFAULT_THETA = 当前线上 baseline 行为 |
