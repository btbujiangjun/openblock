# Spawn Tuning v2 — 工业化版

> 设计文档: [`docs/algorithms/SPAWN_TUNING_V2.md`](../../docs/algorithms/SPAWN_TUNING_V2.md)

## 模块清单

| 文件 | 行数 | 职责 |
|---|---|---|
| `target_curve.py` | 105 | 目标 S 曲线 (业务目标 → 数学函数) |
| `extractor.py` | 175 | 单局轨迹 → 20 维 d_curve + 6 个辅助标签 |
| `model.py` | 175 | ResNet-MLP (L4, ~325K 参数) |
| `losses.py` | 240 | 5 项加权 loss (shape/balance/surprise/breaking/smooth + aux) |
| `feature_io.py` | 270 | SQLite ↔ numpy/torch 桥接 + θ 归一化 |
| `train.py` | 285 | 训练管线 (从头/增量) + CLI |
| `optimize_theta.py` | TODO PR2 | Phase C 梯度上升寻 360 contexts 最优 θ |

## 快速使用

### 1. 初始化数据库 schema

```bash
sqlite3 .cursor-stress-logs/spawn-tuning-v2.sqlite < schemas/spawn_tuning_v2.sql
```

### 2. 跑测试

```bash
# Python
python3 -m pytest tests/spawn_tuning_v2/ -v

# JS
npx vitest run tests/tuning/v2/
```

### 3. 训练一个模型 (假设已有 sample_set_id=1)

```bash
python3 -m rl_pytorch.spawn_tuning_v2.train \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --sample-sets 1 \
    --output checkpoints/v2/run_001.pt \
    --epochs 50 --batch-size 256 --lr 1e-3 \
    --device mps
```

### 4. 增量训练 (在已有模型基础上)

```bash
python3 -m rl_pytorch.spawn_tuning_v2.train \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --sample-sets 4,5 \
    --base-model checkpoints/v2/run_001.pt \
    --rehearsal-sets 1 --rehearsal-ratio 0.15 \
    --output checkpoints/v2/run_002.pt \
    --epochs 20 --lr 1e-4
```

## 测试覆盖

```
tests/spawn_tuning_v2/
├── test_target_curve.py    15 tests — 4 段连续性 / 单调性 / 边界 clip
├── test_extractor.py       19 tests — 单步公式 / 整局 / 空 bin 插值 / 聚合
├── test_model.py           12 tests — 参数量 / 形状 / 梯度反传 / 自定义架构
├── test_losses.py          17 tests — 5 项 loss 数学正确性 / 综合 / smooth ∂/∂θ
├── test_feature_io.py      10 tests — 归一化互逆 / SQLite 读写 / 端到端
└── test_cross_lang.py       9 tests — 与 JS 端固定参考点严格匹配

tests/tuning/v2/
└── targetSCurve.test.js    18 tests — 关键点 / 单调 / 边界 (与 Python 镜像)
```

**总计 100 测试，全部通过**。

## 设计原则

1. **业务目标显式量化** — d_curve 直接对应 S 曲线，不通过 fairness/excitement 等中间标量
2. **5 维 context** — bot_policy 独立成为维度，与 difficulty/generator/pb_bin/lifecycle 同等
3. **跨语言一致性** — Python 与 JS 实现同一 target_S_curve, 测试用相同参考点
4. **数据库 first-class** — `sample_sets` / `models` / `training_jobs` 都是 CRUD 实体
5. **增量训练** — 新样本不必从头训, 旧样本 rehearsal 防遗忘
6. **可解释 loss** — 5 项 loss 各自对应一个明确业务约束

## 与 v1 的差异

| | v1 | v2 |
|---|---|---|
| 标签 | 3 标量 (fairness/excitement/anti) | 20 维 d_curve + 5 辅助 |
| 模型 | MLP 9.7K | ResNet-MLP L4 ~325K |
| 上下文 | 4 维 | 5 维 (含 bot_policy) |
| 元数据 | run_id 兼用 | sample_sets / models / training_jobs 分立 |
| 增量训练 | 无 | 支持 + rehearsal |
| 跨语言验证 | 无 | Python + JS 严格镜像 |

详细对照见设计文档 §8。

## 下一步 (PR2-4)

- **PR2**: `optimize_theta.py` — Phase C 梯度上升在 360 contexts 上找最优 θ*
- **PR3**: 看板重构 — ②/③/④/⑤ 4 个 tab + d_curve 可视化组件
- **PR4**: 真实玩家 SDK + 灰度部署 + 一键回滚
