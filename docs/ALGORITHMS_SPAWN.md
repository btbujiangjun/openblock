# 出块算法：算法工程师手册

> 本文是 OpenBlock **出块子系统**的算法侧统一手册。  
> 范围：规则引擎双轨 + SpawnTransformerV2 ML 模型的训练/推理 + 数学化形式。  
> 与现有文档的关系：本文是 `SPAWN_ALGORITHM.md`（工程分层）/ `ADAPTIVE_SPAWN.md`（信号矩阵）/ `SPAWN_BLOCK_MODELING.md`（设计 rationale）的**算法 + 模型工程深化**——补充 ML 路径的网络结构、训练流程、与 RL 的接口。

---

## 目录

1. [问题形式化](#1-问题形式化)
2. [双轨架构](#2-双轨架构)
3. [规则引擎：约束 + 偏好分布](#3-规则引擎约束--偏好分布)
4. [自适应映射：从画像到 stress](#4-自适应映射从画像到-stress)
5. [SpawnTransformerV2 网络结构](#5-spawntransformerv2-网络结构)
6. [SpawnTransformer 训练流程](#6-spawntransformer-训练流程)
7. [SpawnTransformer 推理与回退](#7-spawntransformer-推理与回退)
8. [SpawnPredictor：服务于 RL MCTS](#8-spawnpredictor服务于-rl-mcts)
9. [完整公式速查](#9-完整公式速查)
10. [完整参数表](#10-完整参数表)
11. [演进与开放问题](#11-演进与开放问题)

---

## 1. 问题形式化

### 1.1 任务

每轮给玩家**三个不重复的形状** $(s_1, s_2, s_3)$，使得：

```
约束 (Hard Constraints):
  ∀ permutation π : 三块顺序放置都至少有一种存在解
  最低机动性 minMobility(fill) 满足
  形状唯一性 s_1 ≠ s_2 ≠ s_3

目标 (Soft Objectives):
  - 公平：玩家有合理概率消行
  - 心流：根据玩家状态调节难度
  - 多样性：避免重复出现同类形状
  - 节奏：与 sessionPhase / runStreak 契合
```

### 1.2 数学化

形式化为**条件分布采样**：

$$
(s_1, s_2, s_3) \sim P(s_1, s_2, s_3 \mid \text{board}, \text{profile}, \text{history}) \cdot \mathbb{1}_{\mathcal{F}}
$$

- $\mathcal{F}$：可行域（满足硬约束）
- $P$：偏好分布（由策略组合编码）
- $\mathbb{1}_{\mathcal{F}}$：拒绝采样

### 1.3 不退化为单步问题的原因

如果只看"放第一块"，问题简化但不充分——**三块的协同**很重要：
- 三块都偏大 → 玩家很难放第三块
- 三块都偏小 → 玩家无法多消，节奏单调
- 三块都同色 → 偶然出现 bonus line，但缺乏多样性

→ 必须建模**联合分布**而非独立分布。

---

## 2. 双轨架构

### 2.1 路线对比

| 路线 | 核心思想 | 优势 | 代价 |
|------|---------|------|------|
| **轨道一：规则引擎** | 手工特征 + 多层启发式 + 硬约束过滤 | 解释性强 / 可保证公平 / 零延迟 | 规则复杂 / 风格难极致拟合 |
| **轨道二：SpawnTransformerV2** | 学习 $P(s_1, s_2, s_3 \mid \text{ctx})$ | 拟合真实玩家分布 | 需数据 / 需防"分数膨胀"等捷径 |

### 2.2 切换逻辑

`web/src/game.js` 根据 `getSpawnMode()`：

```js
function spawnNextBlocks() {
    if (spawnMode === 'transformer' && spawnTransformer.ready) {
        try {
            const triplet = spawnTransformer.sample(boardCtx);
            if (validate(triplet)) return triplet;
        } catch (err) {
            console.warn('SpawnTransformer 失败，回退规则引擎', err);
        }
    }
    // Fallback: 规则引擎
    return generateDockShapes(grid, profile, ctx);
}
```

**回退原则**：ML 推理失败 / 输出不合法 / 模型未加载 → 自动用规则引擎。

### 2.3 部署位置

```
轨道一（规则）：浏览器内 JS（web/src/bot/blockSpawn.js）
轨道二（ML）：
  - 训练：rl_pytorch/spawn_model/（Python + PyTorch）
  - 推理：可选导出到前端（ONNX / TorchScript）或后端服务化
  - 当前主用途：MCTS 出块预测（rl_pytorch/spawn_predictor.py）
```

---

## 3. 规则引擎：约束 + 偏好分布

### 3.1 三层架构

```
Layer 1：盘面瞬时（几何 + 拓扑）
   ↓
Layer 2：局内体验（combo + 节奏 + 多样性）
   ↓
Layer 3：跨局/会话（热身 + 里程碑 + 冷却）
```

详见 [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md)。

### 3.2 算法核心

```python
def generateDockShapes(grid, profile, ctx, max_attempts=22):
    for attempt in range(max_attempts):
        # 1. 形状级评分
        for shape in all_28_shapes:
            features[shape] = analyze(grid, shape)  
            # gapFills, multiClear, holeReduce, mobility
            weight[shape] = base_weight(strategy) * augment_layers(features, profile)
        
        # 2. 两阶段构造 triplet
        triplet = []
        if clearGuarantee > 0:
            # 阶段 1：从能消行的子集占坑
            triplet += sample_from_clear_pool(weight, k=clearGuarantee)
        # 阶段 2：剩余槽位加权采样
        triplet += pick_weighted(remaining_pool, k=3 - len(triplet))
        
        # 3. 约束验证
        if not check_mobility(triplet, fill, attempt): continue
        if fill >= 0.52 and not triplet_sequentially_solvable(grid, triplet): continue
        
        # 4. 顺序随机化
        return fisher_yates_shuffle(triplet)
    
    # 失败：兜底简化路径
    return fallback_simple(grid)
```

### 3.3 加权抽样公式

```
P(shape_i selected) = w_i / Σ w_j

其中 w_i 是 base_weight × Π adjustments
adjustments 包括：
  - shapeWeights[category]            (策略基础)
  - mobility_factor                    (能放几次)
  - hole_reduction_bonus              (能补洞？)
  - multi_clear_bonus                 (能多消？)
  - combo_bonus                        (链 combo？)
  - sizePreference_factor             (适配大小偏好)
  - diversity_penalty                 (该类已用过？)
  - milestone_bonus                   (里程碑相关？)
```

### 3.4 序贯可解性

`tripletSequentiallySolvable(grid, triplet, budget)`:

```python
def solvable(grid, triplet, budget=300):
    # 对 6 种排列做 DFS
    for perm in permutations(triplet):
        if dfs_place(grid.copy(), perm, budget) == True:
            return True
    return False

def dfs_place(g, blocks, budget):
    if not blocks: return True
    if budget <= 0: return False
    block = blocks[0]
    for pos in g.legal_positions(block):
        g.place(pos)
        if dfs_place(g, blocks[1:], budget - 1):
            return True
        g.undo()
    return False
```

**复杂度**：最坏 $O(\text{positions}^3)$，一般 budget 早终止 → 实际 < 10ms。

### 3.5 危险态严格校验

```
fill ∈ [0.68, 0.75): 抬高 minMobility 与 budget × 1.5
fill ∈ [0.75, 0.88): budget × 2，预算耗尽即拒绝（不再放行）
fill ∈ [0.88, ∞]   : budget × 3，danger zone，最严格
```

---

## 4. 自适应映射：从画像到 stress

### 4.1 stress 综合公式

`adaptiveSpawn.js` 的 `resolveAdaptiveStrategy`：

```js
stress = scoreStress         // 分数段里程碑触发
       + difficultyBias      // easy(-0.12) / normal(0) / hard(+0.12)
       + skillAdjust         // 高技能加压
       + flowAdjust          // bored 加 / anxious 减
       + recoveryAdjust      // needsRecovery 减
       + frustRelief         // frustration ≥ 4 → -0.18
       + comboAdjust         // combo ≥ 3 → +0.06
       + nearMissAdjust      // hadRecentNearMiss → -0.10
       + feedbackBias        // 闭环反馈 ±0.10
       + trendAdjust         // trend 进步加压（×conf）
       + sessionArcAdjust;   // warmup -0.08

stress = clamp(stress, -0.2, 1);
```

### 4.2 10 档 profile 插值

`shapeWeights` 在 10 档预设之间按 stress 线性插值：

```
profile_levels = [-0.2, -0.1, 0, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0]
         （每档对应一组 shapeWeights）

if stress ∈ [a, b]:
    t = (stress - a) / (b - a)
    weight[k] = profile_a[k] · (1 - t) + profile_b[k] · t
```

### 4.3 spawnHints

除了 stress（连续量），还输出离散结构：

```js
{
    clearGuarantee: 0|1|2|3,     // 必须消行的形状数
    sizePreference: -1..1,        // -1 偏小 / +1 偏大
    diversityBoost: 0|1|2,        // 多样性强度
    comboChain: bool,             // 是否鼓励连击
    multiClearBonus: bool,        // 是否鼓励大消
    rhythmPhase: 'tension'|'release',
    milestoneEcho: 'pre'|'post'|null
}
```

---

## 5. SpawnTransformerV2 网络结构

### 5.1 整体架构（`rl_pytorch/spawn_model/model.py`）

```
输入：
  board:    [B, 8, 8] float（占用 0/1）
  context:  [B, 24] float（玩家画像 + 实时信号）
  history:  [B, 3, 3] long（最近 3 轮的 3 个 shape_id）
  target_difficulty: [B, 1] float（0~1，可控压力）

编码层：
  state_token = LayerNorm(GELU(Linear(board.flat ⊕ context, d_model)))   # [B, 1, 128]
  diff_token  = LayerNorm(GELU(Linear(target_difficulty, d_model)))       # [B, 1, 128]
  history_emb = shape_embed(history.flat) + positional_embed              # [B, 9, 128]
  cls_token   = learnable_param                                           # [B, 1, 128]

序列：
  tokens = [CLS, state, diff, history_0, history_1, ..., history_8]       # [B, 12, 128]

Transformer Encoder：
  num_layers = 2
  nhead = 4
  dim_feedforward = 256
  activation = GELU
  → tokens_out [B, 12, 128]

输出头（从 CLS token）：
  cls_out = norm(tokens_out[:, 0])                                        # [B, 128]
  
  shape_logits_0 = head_0(cls_out)  # [B, NUM_SHAPES=28]
  shape_logits_1 = head_1(cls_out)
  shape_logits_2 = head_2(cls_out)
  
  diversity_logits = diversity_head(cls_out)  # [B, NUM_CATEGORIES * 3]
  difficulty_pred  = difficulty_head(cls_out) # [B, 1]
```

### 5.2 关键设计

#### 三个独立 shape head

```
head_0 / head_1 / head_2 各自输出 28 维 logits
```

**为什么不是 softmax 共享**？

- 三槽**不对称**：第一槽通常重要（玩家习惯先选）
- 各槽独立学的概率分布更精细
- 三槽分布**联合**才形成 dock，下游可做 max-product 联合采样

#### 难度条件化

```python
target_difficulty: [B, 1] in [0, 1]
diff_token = embed(target_difficulty)
```

推理时可**主动控制**：

```python
# 想要简单 dock：
predictor.predict(board, ctx, history, target_difficulty=torch.tensor([[0.2]]))
# 想要困难 dock：
predictor.predict(board, ctx, history, target_difficulty=torch.tensor([[0.8]]))
```

这是 v2 相对 v1 的关键改进——v1 只能"输出无条件分布"。

#### 辅助 head：对抗"分数膨胀"

```
diversity_head:    预测三槽的品类分布（鼓励多样）
difficulty_head:   预测真实难度（监督训练防与 target_difficulty 偏离）
```

防止网络学到"反正怎么都给容易消行的块" 的捷径。

### 5.3 参数量

```
shape_embed:           29 × 128       =  3712
board_proj:            (64+24)×128 + 128×128 ≈ 27K
difficulty_proj:       1×128 + 128×128 ≈ 16K
history_pos:           9 × 128        =  1152
cls_token:             128
TransformerEncoder × 2: ~133K
norm:                  128 × 2        =  256
3 × shape_head:        128 × 28 × 3   =  10752
diversity_head:        128 × NUM_CAT × 3 ≈ 2.7K
difficulty_head:       128 × 1        =  128

总计 ≈ 195K-200K 参数
```

属于**轻量级 Transformer**，可在 CPU 实时推理（< 5ms）。

---

## 6. SpawnTransformer 训练流程

### 6.1 训练数据来源

```
来源 1：人类对局回放
   - 真实玩家 dock 选择（"专家示范"）
   - 训练目标：拟合真实玩家分布
   
来源 2：规则引擎对局
   - generateDockShapes 输出 + 同步 board context
   - 训练目标：让 ML 至少能复现规则的好性质
   
来源 3：自博弈生成
   - 用 RL Bot 玩规则引擎对局
   - 收集 (board, context, dock) 样本
```

### 6.2 数据格式

```python
sample = {
    'board':            (8, 8) int 0/1,
    'context':          (24,) float（player_profile + realtime signals）,
    'history':          (3, 3) int（前 3 轮 dock）,
    'target_dock':      (3,) int（实际给出的 shape_ids）,
    'difficulty':       float（实际难度估计）,
    'category_dist':    (NUM_CATEGORIES * 3,) float（三槽品类 one-hot 拼接）
}
```

### 6.3 24 维 context

| 索引 | 含义 |
|-----|------|
| 0-3 | profile.skillLevel, .historicalSkill, .trend, .confidence |
| 4-7 | profile.flowDeviation, .frustrationLevel, .momentum, .cognitiveLoad |
| 8-9 | profile.sessionPhase, .pacingPhase（one-hot 简化） |
| 10-13 | adaptive.scoreStress, .totalStress, .recoveryAdjust, .frustRelief |
| 14-17 | hints.clearGuarantee, .sizePreference, .diversityBoost, .comboChain |
| 18-21 | runStreak, gameOverCount, totalSpawns, sessionDuration |
| 22-23 | reserved |

### 6.4 损失函数

$$
\mathcal{L} = \mathcal{L}_{\text{shape}} + \alpha \cdot \mathcal{L}_{\text{div}} + \beta \cdot \mathcal{L}_{\text{diff}}
$$

#### Shape loss（主任务）

$$
\mathcal{L}_{\text{shape}} = -\sum_{i=0}^{2} \log P(s_i^* \mid \text{ctx})
$$

三个槽位的交叉熵之和。

#### Diversity loss（辅助）

$$
\mathcal{L}_{\text{div}} = \text{CrossEntropy}(\text{div\_logits}, \text{category\_dist}^*)
$$

让网络学会预测三槽的**品类分布**。

#### Difficulty loss（辅助）

$$
\mathcal{L}_{\text{diff}} = (\text{diff\_pred} - \text{difficulty}^*)^2
$$

训练时 `target_difficulty` 喂入，预测应 ≈ 真实难度。

#### 默认权重

```
α (diversity) = 0.1
β (difficulty) = 0.05
```

主任务为主，辅助为 regularization。

### 6.5 训练命令

```bash
python -m rl_pytorch.spawn_model.train \
    --data-path data/spawn_training.jsonl \
    --epochs 50 \
    --batch-size 256 \
    --lr 3e-4 \
    --output rl_checkpoints/spawn_v2.pt
```

### 6.6 训练监控

| 指标 | 健康值 |
|-----|-------|
| shape_loss | 下降到 < 1.5（28 类 random ~ ln 28 ≈ 3.3） |
| div_loss | 下降到 < 0.5 |
| diff_loss | 下降到 < 0.05 |
| top-1 acc per slot | > 25%（> uniform） |
| top-5 acc | > 65% |

---

## 7. SpawnTransformer 推理与回退

### 7.1 推理流程

```python
def predict_next_shapes(board, ctx, history, target_diff=0.5):
    with torch.no_grad():
        out = model(board, ctx, history, target_diff)
        # out = {logits: (l_0, l_1, l_2), div_logits, diff_pred}
    
    probs_0 = softmax(out.logits[0])  # [28]
    probs_1 = softmax(out.logits[1])
    probs_2 = softmax(out.logits[2])
    
    # 联合采样：避免重复
    s_0 = sample(probs_0)
    probs_1[s_0] = 0; probs_1 /= probs_1.sum()  # mask
    s_1 = sample(probs_1)
    probs_2[s_0] = 0; probs_2[s_1] = 0; probs_2 /= probs_2.sum()
    s_2 = sample(probs_2)
    
    return [s_0, s_1, s_2]
```

### 7.2 推理验证

```python
def validate(triplet, grid, profile):
    if len(set(triplet)) != 3: return False  # 不重复
    if not triplet_sequentially_solvable(grid, triplet): return False
    if not check_mobility(triplet, grid.fill_ratio): return False
    return True
```

**关键**：ML 输出的 dock 仍要过**规则引擎的硬约束**——避免给玩家不公平的死局。

### 7.3 回退策略

```
Step 1: 模型未加载 → 规则引擎
Step 2: 推理失败（OOM / NaN）→ 规则引擎
Step 3: 验证失败（不公平）→ 重采样 max 3 次 → 规则引擎
Step 4: 多次回退后 → 标记降级（log + metric）
```

### 7.4 性能

| 指标 | CPU | MPS/CUDA |
|-----|-----|---------|
| 单次推理 | 3-8 ms | < 1 ms |
| 内存 | ~50 MB | ~30 MB |
| ModelLoad | ~200 ms | ~150 ms |

---

## 8. SpawnPredictor：服务于 RL MCTS

### 8.1 用途

RL Bot 在 MCTS 模拟时面临一个困境：

```
MCTS 节点 N → 模拟 K 步
  当前 dock 是确定的 d
  但 K 步后玩家会消耗 d，下一轮 dock' 是哪 3 个？
```

**简单方案**：假设 dock' 与 d 相同（**乐观偏差**——不切实际）。  
**完美方案**：用 SpawnTransformer 预测 dock' 分布，对多个 sample 取期望 V。

### 8.2 SpawnPredictor 接口

```python
class SpawnPredictor:
    @classmethod
    def load(cls, ckpt_path, device):
        ...
    
    def predict_next_shapes(self, board, context, history) -> dict:
        """返回每槽的概率分布"""
        return { 'probs': [(28,), (28,), (28,)] }
    
    def sample_dock_from_distribution(self, distr, n_samples=4):
        """采样 n 组 dock"""
        return [[s_0, s_1, s_2], ...]
    
    def expected_value(self, sim, policy_net, n_samples=4):
        """对 n 组 dock 取平均 V(s)"""
        v_total = 0
        for dock_sample in self.sample_dock_from_distribution(...):
            sim_copy = copy(sim)
            sim_copy.set_dock(dock_sample)
            v = policy_net.forward_value(sim_copy.state)
            v_total += v
        return v_total / n_samples
```

### 8.3 在 MCTS 中的使用

```python
# rl_pytorch/mcts.py 节选
def expand_node(node, predictor, policy_net):
    if node.dock_consumed:  # 三块都用完了
        v_expected = predictor.expected_value(node.sim, policy_net, n_samples=4)
        node.value = v_expected
    else:
        node.value = policy_net.forward_value(node.state)
```

预期效果：
- 价值估计偏差 ↓
- MCTS 探索更准确
- 蒸馏到策略网络的 Q target 质量提升

### 8.4 与 RL 主线的解耦

```
SpawnTransformer 是"独立训练的辅助模型"：
  - 训练：spawn_model/train.py
  - checkpoint: rl_checkpoints/spawn_v2.pt
  - 加载：仅在 SpawnPredictor.load() 时

主 RL 训练循环 (rl_pytorch/train.py)：
  - 默认：assume next dock = current dock（简化）
  - 启用：SpawnPredictor 提升 MCTS 准确性
```

环境变量控制：

```bash
RL_SPAWN_PREDICTOR=1   # 启用
RL_SPAWN_MODEL_PATH=path/to/spawn.pt  # 自定义路径
```

---

## 9. 完整公式速查

### 9.1 stress 综合

$$
\text{stress} = \text{clamp}\left(\sum_i \text{adjust}_i, -0.2, 1\right)
$$

### 9.2 profile 插值

$$
w_k = w_k^{(a)} \cdot (1 - t) + w_k^{(b)} \cdot t, \quad t = \frac{\text{stress} - \text{stress}_a}{\text{stress}_b - \text{stress}_a}
$$

### 9.3 加权抽样

$$
P(\text{shape}_i) = \frac{w_i \cdot \prod_j f_j(\text{shape}_i, \text{ctx})}{\sum_k w_k \cdot \prod_j f_j(\text{shape}_k, \text{ctx})}
$$

### 9.4 SpawnTransformer 损失

$$
\mathcal{L} = \sum_{i=0}^{2} \text{CE}(\text{logits}_i, s_i^*) + 0.1 \cdot \text{CE}(\text{div\_logits}, c^*) + 0.05 \cdot (\hat{d} - d^*)^2
$$

### 9.5 联合采样（避免重复）

$$
P(s_2 \mid s_0, s_1) = \frac{P(s_2)}{1 - P(s_0) - P(s_1)} \cdot \mathbb{1}_{s_2 \neq s_0, s_1}
$$

---

## 10. 完整参数表

### 10.1 规则引擎

| 参数 | 默认 |
|------|------|
| `MAX_SPAWN_ATTEMPTS` | 22 |
| `SURVIVE_SEARCH_BUDGET` | 300 |
| `FILL_SURVIVABILITY_ON` | 0.52 |
| `DANGER_ZONE_FILL` | 0.68 |
| `STRICT_DANGER_FILL` | 0.75 |
| `EXTREME_DANGER_FILL` | 0.88 |
| 形状池大小 | 28 |
| dock 槽位 | 3 |

### 10.2 难度模式

| Mode | difficultyBias | initialFill |
|------|---------------|-------------|
| easy | -0.12 | 0.0 |
| normal | 0 | 0.20 |
| hard | +0.12 | 0.25 |

### 10.3 SpawnTransformerV2

| 参数 | 默认 |
|------|------|
| d_model | 128 |
| nhead | 4 |
| num_layers | 2 |
| dim_feedforward | 256 |
| dropout | 0.1 |
| NUM_SHAPES | 28 |
| CONTEXT_DIM | 24 |
| HISTORY_LEN | 3（轮）× 3（槽） |
| 总参数量 | ~200K |

### 10.4 训练

| 参数 | 默认 |
|------|------|
| epochs | 50 |
| batch_size | 256 |
| lr | 3e-4 |
| optimizer | Adam |
| α (diversity) | 0.1 |
| β (difficulty) | 0.05 |

---

## 11. 演进与开放问题

### 11.1 已识别的设计权衡

| 决策 | 优势 | 代价 |
|-----|------|-----|
| 规则引擎为主 | 公平 + 可解 | 风格难极致拟合 |
| ML 仅做先验 / MCTS | 不影响真人公平性 | ML 价值受限 |
| 28 个固定形状 | 易测 / 易回放 | 多样性上限 |
| 三槽独立 head | 精度 | 联合分布建模弱 |

### 11.2 v3 候选改进

1. **联合分布建模**：用 autoregressive 输出 $P(s_2 \mid s_0, s_1)$
2. **形状自动生成**：从固定 28 个 → 程序化生成（PCGRL）
3. **真人优先级**：ML 直接服务真人对局（当前主用 MCTS）
4. **风格化 dock**：根据 playstyle 输出风格化 dock

### 11.3 开放研究点

- **可解性如何嵌入网络**？让 ML 直接输出"硬约束满足"的 dock
- **个性化 fine-tune**：基于单玩家数据微调小模型
- **多玩家迁移**：跨玩家共享 trunk，玩家专属 head

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 总索引 |
| [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) | 工程分层 |
| [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) | 信号矩阵 |
| [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) | 设计 rationale |
| [`DIFFICULTY_MODES.md`](./DIFFICULTY_MODES.md) | 三档难度 |
| [`PLAYSTYLE_DETECTION.md`](./PLAYSTYLE_DETECTION.md) | 玩法风格 → dock 调整 |
| [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | RL 与 SpawnPredictor 接口 |

---

> 最后更新：2026-04-27 · 与 SpawnTransformerV2 v8.1 对齐  
> 维护：算法工程团队
