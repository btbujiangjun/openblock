# 出块算法：算法工程师手册

> 本文是 OpenBlock **出块子系统**的算法侧统一手册。
> 范围：规则算法与 SpawnTransformerV3 生成式推荐双轨、共享上下文、护栏校验、训练/推理与数学化形式。
> 与现有文档的关系：本文是 `SPAWN_ALGORITHM.md`（工程分层）/ `ADAPTIVE_SPAWN.md`（信号矩阵）/ `SPAWN_BLOCK_MODELING.md`（设计 rationale）的**算法 + 模型工程深化**——补充 ML 路径的网络结构、训练流程、与 RL 的接口。
> 若需要横向理解 Spawn 与 RL、玩家画像、商业化、LTV、PCGRL 的模型契约，先读 [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md)。

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
11. [演进、开放问题与 V3 落地（v3 已实装）](#11-演进开放问题与-v3-落地v3-已实装)
   - 11.1 已识别的设计权衡
   - 11.2 V3 候选改进 — 详细方案 × 实现（联合分布 / 风格化 / 真人接入 / PCGRL）
   - 11.3 开放研究点 — 实装方案（feasibility 嵌入 / LoRA / 多玩家迁移）
   - 11.4 V3 训练 / 推理 / 部署 全链路
   - 11.5 V3 完整损失公式
   - 11.6 实测参数与性能
   - 11.7 仍开放的研究问题
   - 11.8 文件入口速查

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
      - 爽感：把能力/心流/盘面机会转为多消、清屏兑现概率
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
| **轨道一：规则算法** | 手工特征 + 多层启发式 + 硬约束过滤 | 解释性强 / 可保证公平 / 零延迟 / 可兜底 | 规则复杂 / 风格难极致拟合 |
| **轨道二：生成式推荐（SpawnTransformerV3）** | 学习 $P(s_1, s_2, s_3 \mid \text{ctx})$，带 feasibility、playstyle 与 LoRA 个性化 | 拟合真实玩家序列体验 / 支持个性化 | 需服务端模型 / 需前端护栏和回退 |

两条轨道共享 `buildSpawnModelContext()` 生成的上下文：难度模式、`AbilityVector`、`PlayerProfile` 实时状态、盘面拓扑、局内节奏、局间弧线、近期出块历史和规则轨 `spawnHints`。规则轨直接消费 `spawnHints`；生成式轨把同一份上下文编码为 V3 的 `board/context/history/playstyle/targetDifficulty` 请求，避免 V2 旧 24 维向量与 V3 请求各自拼字段造成口径漂移。

### 2.2 切换逻辑

`web/src/game.js` 根据 `getSpawnMode()` 在 `rule` 与 `model-v3` 间切换；历史值 `model` 会被 `spawnModel.js` 自动兼容为 `model-v3`：

```js
function spawnNextBlocks() {
    const ctx = buildSpawnModelContext(grid, profile, adaptiveInsight);
    const ruleFallback = generateDockShapes(grid, layered, spawnContext);

    if (spawnMode === 'model-v3') {
        const result = await predictShapesV3(grid, profile, history, adaptiveInsight, ctx);
        if (result?.shapes && validateSpawnTriplet(grid, result.shapes).ok) {
            return result.shapes;
        }
        return ruleFallback; // 带 fallbackReason 记录到面板
    }
    return ruleFallback;
}
```

**回退原则**：V3 服务不可用、输出不足 3 块、重复块、不可放、低机动性、危险填充下序贯不可解 → 自动用规则算法，并记录 `fallbackReason` 供面板诊断。

### 2.3 部署位置

```
轨道一（规则算法）：浏览器内 JS（web/src/adaptiveSpawn.js + web/src/bot/blockSpawn.js）
轨道二（生成式推荐）：
  - 训练：rl_pytorch/spawn_model/（Python + PyTorch）
  - 推理：Flask `/api/spawn-model/v3/predict`
  - 真人网页主流程：`web/src/spawnModel.js` → `predictShapesV3()`
  - 仍保留：MCTS 出块预测（rl_pytorch/spawn_predictor.py）
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
  - delight_bonus                     (能力/心流驱动的爽感兑现)
  - perfect_clear_bonus               (清屏机会兑现)
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
       + difficultyBias      // easy(-0.22) / normal(0) / hard(+0.22)
       + skillAdjust         // 高技能加压
       + flowAdjust          // bored 加 / anxious 减
       + recoveryAdjust      // needsRecovery 减
       + frustRelief         // frustration ≥ 4 → -0.18
       + comboAdjust         // combo ≥ 3 → +0.06
       + nearMissAdjust      // hadRecentNearMiss → -0.10
       + feedbackBias        // 闭环反馈 ±0.10
       + trendAdjust         // trend 进步加压（×conf）
       + sessionArcAdjust    // warmup -0.08
       + holeReliefAdjust    // 不可覆盖空洞压力触发减压
       + delightStressAdjust;// 高技能无聊轻加压；焦虑/恢复降压

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
    delightBoost: 0..1,           // 能力/心流驱动的多消爽感兑现
    perfectClearBoost: 0..1,      // 清屏兑现强度
    targetSolutionRange: object,  // 解法数量目标区间
    holePressure: implicit,       // 来自 spawnContext.holes 的拓扑压力
    delightMode: string,          // challenge_payoff / flow_payoff / relief / neutral
    rhythmPhase: 'tension'|'release',
    milestoneEcho: 'pre'|'post'|null
}
```

### 4.4 爽感兑现层（v3.3）

`adaptiveSpawn.js` 额外计算 `deriveDelightTuning()`，把 `skillLevel`、`flowState`、`momentum`、`needsRecovery` 与 `spawnContext.nearFullLines/pcSetup` 映射到三类信号：

- `challenge_payoff`：高技能且无聊时，略提高 stress，并提高 `delightBoost` / `multiLineTarget`，让难度上升同时给出多消回报。
- `flow_payoff`：玩家处于心流或释放期时，不强行升压，主要提高多消/清屏候选概率。
- `relief`：焦虑或恢复态时降低 stress、偏小块、提高消行保证，同时保留救援式多消机会。

`blockSpawn.js` 消费这些信号时只改变软权重：`pcPotential`、`multiClear`、`gapFills` 的排序和抽样倍率会上升；若存在一手清屏块，会优先占用一个出块槽位。但三连块仍必须通过 `minMobilityTarget`、序贯可解性和解法数量过滤，避免“为了爽感破坏公平”。

临消与多消机会采用 **可填充感知** 口径：`nearFullLines` / `close1` / `close2` 不只看行列还差几个空格，还要求这些缺口能被当前形状库的某个合法放置覆盖。不可覆盖空洞造成的“假近满行”不会再触发 payoff、多消或清屏兑现加权。

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

## 11. 演进、开放问题与 V3 落地（v3 已实装）

> 自 2026-04-27 起，下面表中的 4 个 v3 候选改进与 3 个开放研究点已**全部完成第一版实装**——汇总在 `SpawnTransformerV3` + `feasibility` + `lora` + `shape_proposer` 四组模块；本节给出**深化设计 + 算法方案 + 实现路径**。

### 11.1 已识别的设计权衡（保留）

| 决策 | 优势 | 代价 | V3 是否解决 |
|-----|------|-----|------------|
| 规则引擎为主 | 公平 + 可解 | 风格难极致拟合 | △（仍保留 fallback） |
| ML 仅做先验 / MCTS | 不影响真人公平性 | ML 价值受限 | ✅（V3 服务真人，硬约束兜底） |
| 28 个固定形状 | 易测 / 易回放 | 多样性上限 | ✅（PCGRL 雏形作研究入口） |
| 三槽独立 head | 精度 | 联合分布建模弱 | ✅（V3 改为 autoregressive） |

### 11.2 V3 候选改进 — 详细方案 × 实现

#### 11.2.1 联合分布建模 — Autoregressive joint decoding

**问题**：V2 三槽独立 head 输出 $P(s_0)$、$P(s_1)$、$P(s_2)$，三者无条件依赖。但实际三块协同性极强（全大块/全小块/全同色都是糟糕组合）。

**方案**：把三槽改写为**自回归**生成

$$
P(s_0, s_1, s_2 \mid \text{ctx}) = P(s_0 \mid \text{ctx}) \cdot P(s_1 \mid \text{ctx}, s_0) \cdot P(s_2 \mid \text{ctx}, s_0, s_1)
$$

实现要点（`rl_pytorch/spawn_model/model_v3.py:SpawnTransformerV3`）：

- `head_0: Linear(d_model → 28)`
- `head_1: Linear(d_model + d_model → 28)`，输入拼接 `[CLS_out, embed(s_0) + slot_pos[0]]`
- `head_2: Linear(d_model + 2·d_model → 28)`，再拼上 `embed(s_1) + slot_pos[1]`
- 训练时用 **teacher forcing**：把 GT 的前两槽喂入 `prev_shapes`
- 推理用 **left-to-right 采样**：先抽 $s_0$，再抽 $s_1$，再抽 $s_2$（带去重 mask）

**代码入口**：

```python
# 训练（自回归 teacher forcing）
out = model(board, ctx, hist, target_diff,
            playstyle_id=ps, prev_shapes=targets[:, :2])
l0, l1, l2 = out['logits']
loss_ce = (CE(l0, t0) + CE(l1, t1) + CE(l2, t2)) / 3.0

# 推理（autoregressive sampling）
triplet = model.sample(board, ctx, hist, target_difficulty=0.5,
                       playstyle='balanced',
                       feasibility_mask=mask, top_k=8)
```

**为什么不用 Transformer decoder？** 我们试过 cross-attn decoder 但参数翻倍且显著拖慢推理；改成"hidden state 拼接 + 独立 head"在 28 类小词表上效果接近，CPU 推理 < 5 ms。

---

#### 11.2.2 风格化 dock — Playstyle conditioning

**问题**：玩家风格差异巨大（perfect_hunter 偏好长条整片消除；survival 偏好规整方块续命）。同一 ctx 给所有人同样 dock 等于"群体平均"。

**方案**：引入**风格 token**

- 5 类风格：`balanced / perfect_hunter / multi_clear / combo / survival`（与 `web/src/playerProfile.js#playstyle` 完全一致）
- `playstyle_embed = nn.Embedding(5, d_model)`
- 把 `style_token` 注入 transformer 输入序列：`[CLS, state, diff, style, hist]`
- 训练时从 `context` 启发式推断弱标签；推理时由前端显式传 `playstyle` 参数

**自监督副任务** — `style_head: Linear(d_model → 5)` 预测玩家风格。这给主任务一个"风格判别"梯度，迫使表示空间区分风格。

**实现**：

- 风格映射逻辑：`rl_pytorch/spawn_model/train_v3.py#_infer_playstyle_from_context`，与 web `playerProfile.js#playstyle` getter 规则对齐
- 损失：`L_style = CE(style_logits, style_targets)`，权重 0.15（默认 `--w-st`）

---

#### 11.2.3 真人对局 ML 接入路径

**问题**：V2 主要服务于 RL MCTS（仅作分布先验）。真人对局走规则引擎，ML 价值受限。

**方案**：新增 **V3 推理端点** `POST /api/spawn-model/v3/predict`，**默认开启硬约束**，可被真人玩法直接调用。

| 关卡 | 动作 |
|------|------|
| 1. 入参 | board / context / history / playstyle / userId / targetDifficulty |
| 2. 后端 | 用 board 算 `feasibility_mask`；若可行集合 < 3 → 拒绝并降级到规则引擎 |
| 3. 加载 | 若 userId 有 LoRA adapter，注入到 trunk 副本，否则用群体模型 |
| 4. 采样 | autoregressive + top-k + 去重 + feasibility-mask |
| 5. 返回 | `{shapes, modelVersion, personalized, feasibleCount}` |

前端入口：`web/src/spawnModel.js#predictShapesV3`，可在主出块流程中直接接入：

```js
const v3 = await predictShapesV3(grid, profile, recentHistory, adaptiveInsight, {
  playstyle: profile.playstyle,
  userId: currentUser?.id,
  enforceFeasibility: true,
});
if (v3 && validateTriplet(grid, v3.shapes)) {
  return v3.shapes;        // ← 走 V3
}
return generateDockShapes(grid, profile, ctx);  // ← 失败回退规则引擎
```

**关键安全策略**：

1. **硬约束兜底**：可行集合 < 3 → 422，立刻回退；
2. **二次验证**：即使 V3 给出 dock，仍要走 `triplet_sequentially_solvable`；
3. **降级 metric**：每次回退都打点（`spawn_v3_fallback_count`）。

---

#### 11.2.4 程序化形状生成 — PCGRL 雏形

**问题**：28 个固定形状是有限词典，无法支持季节限定 / 课程多样性 / RL 数据增强。

**方案**（`rl_pytorch/spawn_model/shape_proposer.py`）：

```
随机种点 → 4-邻域 random walk + 分支扩张 → 连通块
  → 修剪到最小包围盒 → 旋转/镜像签名去重
  → 评分（boxiness / elongation / cells / bbox）
```

接口：

```python
batch = propose_unique_batch(
    n=8, n_cells_dist={3: 0.2, 4: 0.5, 5: 0.3},
    existing_signatures=set_of_existing,  # 与现有 28 个去重
)
# 每个元素：{'shape': [[1,1,0],[0,1,1]], 'sig': '...', 'score': {...}}
```

**为什么不直接换主形状池？** 形状池更换会破坏：

- 训练数据兼容性（embedding(28+1) 维度变化）
- 回放系统（历史回放含旧 shape_id）
- A/B 实验（玩家社区认知断裂）

→ 因此 PCGRL 雏形定位为：**离线候选生成器**，由策划人工挑选后再正式接入。

后端入口：`POST /api/spawn-model/v3/propose-shapes` 直接返回候选 + 评分。

### 11.3 开放研究点 — 实装方案

#### 11.3.1 可解性嵌入网络（Feasibility-aware learning）

**问题**：V2 完全数据驱动，可能把概率质量放在不可放形状上 → 系统偏差。

**方案**：把可解性以**两条信号**注入：

| 信号 | 来源 | 用途 |
|------|------|------|
| **Hard mask** | `feasibility.build_feasibility_mask(board, vocab, smap)` | 推理前对不可放形状 logit 减 1e4 |
| **Aux head BCE** | `feasibility_head: Linear(d_model → 28)` + GT mask | 学习"内嵌 feasibility predictor"——离线设备无法实时算 mask 时使用 |
| **Soft penalty** | `-log(Σ P(s) · mask(s))` | 训练时把主分布从不可行集合拉走 |

数学：

$$
\mathcal{L}_{\text{feas}} = \text{BCE}(\sigma(\text{feas\_logits}), \text{mask}_{\text{GT}})
$$

$$
\mathcal{L}_{\text{soft\_infeas}} = -\frac{1}{3}\sum_{i=0}^{2} \log\!\Big(\sum_{j} P(s_i = j \mid \cdot) \cdot \text{mask}_{\text{GT}}(j)\Big)
$$

**复杂度**：每 batch 多 O(B × 28 × 8 × 8) ≈ 110K ops，CPU 训练 < 0.5 ms / batch；推理时 mask 计算 < 0.05 ms。

**消融建议**：v3 训练默认 `--w-feas 0.4 --w-si 0.2`；如发现主任务收敛过慢可降到 0.2 / 0.1。

---

#### 11.3.2 个性化 fine-tune — LoRA Adapter

**问题**：每玩家训练独立模型成本不可接受；统一模型丢失个性化。

**方案**：**LoRA**（Low-Rank Adaptation）

```
W' = W (frozen) + (α/r) · B · A,    A ∈ ℝ^(r×in),  B ∈ ℝ^(out×r),  r=4
```

实现（`rl_pytorch/spawn_model/lora.py`）：

- `LoRALinear(base_linear, r=4, α=8)`：包装 `nn.Linear`，旁路 `B·A` 残差
- `inject_lora_into_model(model, target_substrings=('head_', 'diversity', 'difficulty', 'style'))`：自动替换头部 Linear 为 LoRALinear，**保留 transformer 主干不变**
- `freeze_non_lora(model)`：冻结全部非 LoRA 参数
- `lora_state_dict / load_lora_state_dict`：仅持久化 LoRA 张量（每玩家 ~5K 参数）

参数量对比（实测）：

```
SpawnTransformerV3 trunk: 312,331 params
LoRA (r=4, 5 个头部 Linear): 5,568 params (~1.8%)
→ 100 名玩家全部存档 ≈ 550K params，比一份完整模型还小
```

**训练流水**（`rl_pytorch/spawn_model/personalize.py`）：

```
1. 加载 V3 trunk
2. inject_lora + freeze_non_lora
3. 用单玩家会话样本 fine-tune 10 epoch（仅 LoRA 参数反向）
4. 保存 lora_<user_id>.pt（含 r/α/base_ckpt 元信息）
```

**推理切换**（`server.py#_load_spawn_v3_model`）：

```python
trunk = _spawn_v3_cache  # 共享
if user_id:
    personalized = deepcopy(trunk)
    inject_lora_into_model(personalized, r, α)
    load_lora_state_dict(personalized, user_lora)
    return personalized
return trunk
```

---

#### 11.3.3 多玩家迁移 — Shared trunk + per-player adapter

**问题**：玩家社区有"长尾分布"——头部 1% 玩家有海量数据，长尾 99% 数据稀疏。两种极端均不适合：

- 群体模型：不个性化
- 独立模型：长尾过拟合

**方案**：与 11.3.2 同一架构的 **副产品**——

| 角色 | 加载策略 |
|------|---------|
| 新玩家 | 仅用 trunk（群体先验） |
| 活跃玩家（≥ 50 局） | trunk + 个人 LoRA |
| 跨玩家迁移 | trunk + LoRA 群体平均（kNN/聚类后取中心 LoRA） |

接口 `GET /api/spawn-model/v3/status` 返回 `personalizedUsers` 列表，便于前端做"今日个性化生效"提示。

后续工作（仍是 open question）：

- 学习"风格簇"代表性 LoRA（避免每玩家都训）
- 跨玩家 meta-learning：用 MAML / Reptile 优化 trunk 使新玩家少样本即可个性化
- 隐私：LoRA 权重的本地化部署 + 联邦学习

### 11.4 V3 训练 / 推理 / 部署 全链路

```
                     ┌────────────────────────┐
   离线训练流程      │  数据库 sessions       │
                     │  + move_sequences      │
                     └─────────┬──────────────┘
                               │
                               ▼
            ┌─────────────────────────────────────┐
            │  python -m rl_pytorch.spawn_model   │
            │             .train_v3                │
            │  L = ce + div + anti + diff         │
            │      + feas + soft_infeas + style   │
            └─────────┬───────────────────────────┘
                      │  models/spawn_transformer_v3.pt
                      │
   在线推理流程       ▼
   ┌───────────────────────────────────────────┐
   │  POST /api/spawn-model/v3/predict         │
   │    1. 算 feasibility_mask                 │
   │    2. 加载 trunk + 可选 LoRA(user_id)      │
   │    3. autoregressive sampling             │
   │    4. 返回 dock + meta                    │
   └─────────┬─────────────────────────────────┘
             │
             ▼
   ┌─────────────────────────────────┐
   │  web/src/spawnModel.js          │
   │    predictShapesV3(...)         │
   │    validate / fallback to rules │
   └─────────────────────────────────┘

   离线个性化:
     POST /api/spawn-model/v3/personalize { userId }
       → models/lora_<userId>.pt

   形状候选生成:
     POST /api/spawn-model/v3/propose-shapes { n, nCellsDist }
       → 程序化候选 + 评分
```

### 11.5 V3 完整损失公式

$$
\mathcal{L}_{\text{V3}} = \underbrace{w_{\text{ce}} \cdot \mathcal{L}_{\text{ce-AR}}}_{\text{自回归主损失}} + w_{\text{div}}\mathcal{L}_{\text{div}} + w_{\text{anti}}\mathcal{L}_{\text{anti}} + w_{\text{diff}}\mathcal{L}_{\text{diff}} + \underbrace{w_{\text{feas}}\mathcal{L}_{\text{feas}}}_{\text{BCE 监督}} + \underbrace{w_{\text{si}}\mathcal{L}_{\text{soft-infeas}}}_{\text{软不可行惩罚}} + \underbrace{w_{\text{st}}\mathcal{L}_{\text{style}}}_{\text{风格自监督}}
$$

默认权重：`w_ce=1.0, w_div=0.3, w_anti=0.5, w_diff=0.1, w_feas=0.4, w_si=0.2, w_st=0.15`

### 11.6 实测参数与性能（CPU x86 / Apple M2）

| 项 | 数值 |
|----|------|
| 模型参数（V3 trunk） | 312K |
| LoRA 参数（r=4） | 5.6K（~1.8%） |
| 单次 V3 推理（含 mask） | 4-8 ms |
| feasibility_mask 计算（28 个 shape） | < 0.05 ms |
| LoRA 加载 + deepcopy | ~30 ms（仅切换玩家时一次性） |
| 端到端真人接入开销 | < 15 ms（与规则引擎相当） |

### 11.7 仍开放的研究问题

- **跨形状池迁移**：未来若主形状池扩大到 40+，如何最小化 retraining
- **离线奖励对齐**：用 RL Reward 校准 SpawnTransformer，而不仅仅模仿数据
- **可解释性**：把 feasibility_head 输出作为面板展示，让玩家"看见"为何这一组 dock 被选
- **联邦个性化**：LoRA 在玩家本地训练，仅上传聚合统计

### 11.8 文件入口速查

| 文件 | 角色 |
|------|------|
| `rl_pytorch/spawn_model/model_v3.py` | V3 网络（autoregressive + style + LoRA-ready） |
| `rl_pytorch/spawn_model/feasibility.py` | feasibility mask / weight / torch helpers |
| `rl_pytorch/spawn_model/lora.py` | LoRALinear + inject / freeze / save / load |
| `rl_pytorch/spawn_model/shape_proposer.py` | PCGRL 雏形（连通 random walk + 签名去重 + 评分） |
| `rl_pytorch/spawn_model/train_v3.py` | V3 多任务训练（含 feasibility / playstyle 损失） |
| `rl_pytorch/spawn_model/personalize.py` | LoRA 个性化微调脚本 |
| `rl_pytorch/spawn_model/test_v3.py` | 5 项端到端自检（feasibility / forward / sample / LoRA / shape_proposer / helpers） |
| `server.py` `/api/spawn-model/v3/*` | 状态 / 预测 / 训练 / 个性化 / 形状候选 4 个 RESTful 端点 |
| `web/src/spawnModel.js` | 前端 V3 客户端（`predictShapesV3` / `proposeShapes` / `startPersonalize`） |

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 总索引 |
| [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) | 工程分层 |
| [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) | 信号矩阵 |
| [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) | 设计 rationale |
| [`DIFFICULTY_MODES.md`](../product/DIFFICULTY_MODES.md) | 三档难度 |
| [`PLAYSTYLE_DETECTION.md`](../player/PLAYSTYLE_DETECTION.md) | 玩法风格 → dock 调整 |
| [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | RL 与 SpawnPredictor 接口 |

---

> 最后更新：2026-04-27 · §11 全部 7 个候选/开放问题已在 SpawnTransformerV3 中落地  
> 维护：算法工程团队
