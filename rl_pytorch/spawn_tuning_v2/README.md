# Spawn Tuning v2 — 工业化版

> 设计文档: [`docs/algorithms/SPAWN_TUNING_V2.md`](../../docs/algorithms/SPAWN_TUNING_V2.md)

## 原始需求对照表

| 需求 (原文) | 实现状态 | 文件 |
|---|---|---|
| 业务目标 S 型难度曲线 | ✅ | `target_curve.py` 4 段函数 |
| **特征设计**: 选择影响难度的特征 | ✅ | 14 维 θ 分 3 组 (`paramSpace`-like in feature_io.py) |
| **样本采样**: 5 维分桶 (难度/算法/bot/PB/成熟度) | ✅ | schema + `samplerV2.js` (浏览器跑底层 simulator 真实轨迹) |
| 通过 bot 策略实际跑分 | ✅ | `samplerV2.js` 用 `OpenBlockSimulator` |
| 数据库持久化 | ✅ | `schemas/spawn_tuning_v2.sql` (5 张表) |
| 样本管理 | ✅ 后端 + ✅ 前端 | backend 7 endpoint + `dashboardV2.js` Tab② |
| **模型设计**: ResNet-MLP L4 | ✅ | `model.py` (~325K 参数) |
| **模型训练** + 选择样本集 | ✅ | `train.py` CLI 支持多 sample_set_ids union |
| 模型管理 | ✅ 后端 + ✅ 前端 | `models` 表 + `dashboardV2.js` Tab③ |
| 增量训练 | ✅ | `train.py --base-model --rehearsal-ratio` |
| 训练过程可视化 + metrics | ✅ JSONL 日志 + 看板 jobs 表 | log_path + `val_curve_mae` 等 6 项 |
| **模型部署** + rollback | ✅ | `/models/<id>/deploy` + `/rollback` |

## 模块清单

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

## PR 完成状态

### ✅ PR1 — 核心算法 (target_curve / extractor / model / losses / train / feature_io)
### ✅ PR2 — Phase C 寻参 (落地完成)
- `optimize_theta.py` — 在 NN 上跑梯度上升, 360 contexts × N starts
- CLI: `python -m rl_pytorch.spawn_tuning_v2.optimize_theta --checkpoint ... --output ...`
- 9 个测试 (枚举/单 ctx/全集/MAE 聚合)

### ✅ PR3 — 后端 API + 可视化骨架 (落地完成)
- `spawn_tuning_v2_backend.py` — Flask blueprint, 19 个 endpoint
  - sample_sets CRUD / samples 批量 / aggregate
  - models 列表 / deploy / rollback
  - jobs queue
  - target-curve / active-policies
- `web/src/tuning/v2/dCurveChart.js` — Canvas 业务图 (目标 vs 预测 vs 实测)
- 18 个 backend API 端到端测试

### ✅ PR4 — 真实玩家闭环 SDK + field-metrics 

(以上 PR1-4 详细内容见前次 commit, README 历史版本)

### ✅ PR5 — 异步训练 job 执行器 (落地完成)
- `job_executor.py` — daemon thread 轮询 training_jobs 表
- 原子 claim queued → running, subprocess.Popen 跑 train.py
- 实时解析 JSONL 日志, 增量更新 jobs 表 6 项 metrics
- 子进程结束 → 写 models 表, status=done
- 看板 ③ 加「提交训练任务」按钮 → POST /jobs → 后台自动执行
- 12 个测试 (claim/parse/update/build_cmd/lifecycle)

### ✅ PR6 — 离线 Bundle 导出 (落地完成)
- `/policies/bundle/export` endpoint — policies.json → 客户端 bundle
- 写出 3 个文件:
  - `web/public/spawn-tuning-v2/policies.json` (Web/Android/iOS)
  - `web/public/spawn-tuning-v2/policies.meta.json` (SHA-256 / 时间)
  - `miniprogram/core/tuning/spawnPoliciesV2.js` (微信小程序 CJS)
- `/policies/bundle/status` 查询当前 bundle 状态
- server.py 加 `/spawn-tuning-v2/<path>` 静态路由
- 看板 ③ 加「📦 烘焙到 bundle」按钮

### ✅ PR7 — 灰度切量 + 4 层 fallback (落地完成)
- `clientPolicyV2.js` — 完整客户端策略解析
  - `hashUserToBucket(userId)` → [0, 100)
  - bucket < rollout_pct 才吃 v2 (否则 source='gate-out')
  - 4 层 fallback: exact → fuzzy-lifecycle → coarse-gen → DEFAULT_THETA_V2
  - `loadPoliciesFromBundleV2()` / `loadPoliciesFromServerV2()` / `initClientPolicyV2()`
- 19 个测试 (hash/buildKey/install/4-layer/灰度抽样/bundle load)

### ✅ PR8 — game.js 接入 (落地完成)
- `main.js` 启动时调 `initPolicyMetricsV2` + `initClientPolicyV2`
- `game.js` gameOver 钩子调 `reportEpisode` (自动提取 d_curve)
- 与 v1 policyMetrics 并存, 互不干扰

## 测试统计 (累计)
- **Python**: 130 tests (target_curve 15 / extractor 19 / model 12 / losses 17 /
                       feature_io 10 / cross_lang 9 / optimize_theta 9 /
                       backend_api 27 / job_executor 12)
- **JS**: 65 tests (targetSCurve 18 / policyMetricsV2 12 / samplerV2 16 / clientPolicyV2 19)
- **总计**: 195 tests, 全部通过

---

[移除旧的 PR2-4 详细块, 内容已合并到上方]
- `web/src/tuning/v2/policyMetricsV2.js` — 客户端 SDK
  - 单步钩子 `recordStep`
  - 局结束 `reportEpisode` (自动提取 d_curve)
  - 60s 自动 flush, 失败保留 sessionStorage
- 后端 `/field-metrics` POST + `/aggregate` GET
- 与 Python `extractor.py` 跨语言一致 (相同公式, 已测试验证)
- 12 个 JS 测试

(PR2-4 详细内容保留)

## 完整 CLI 串

```bash
# Step A: 采样 (PR1 工具)
# 通过看板 UI 或独立脚本

# Step B: 训练 NN
python -m rl_pytorch.spawn_tuning_v2.train \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --sample-sets 1 \
    --output checkpoints/v2/run_001.pt \
    --epochs 50 --batch-size 256 --device mps

# Step C: Phase C 寻参 (PR2)
python -m rl_pytorch.spawn_tuning_v2.optimize_theta \
    --checkpoint checkpoints/v2/run_001.pt \
    --output checkpoints/v2/policies-001.json \
    --n-starts 8 --steps 300 --device mps

# Step D: 部署 (通过 API)
curl -X POST http://localhost:5000/api/spawn-tuning-v2/models/1/deploy
```

## 集成到 server.py

```python
try:
    from spawn_tuning_v2_backend import register_v2_routes
    register_v2_routes(app)
except Exception as e:
    print("v2 backend 未启用:", e)
```

## 测试运行

```bash
# Python (114 tests)
python3 -m pytest tests/spawn_tuning_v2/ -v

# JS (30 tests)
npx vitest run tests/tuning/v2/
```
