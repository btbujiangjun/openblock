# SpawnParamTuner — 用户手册

> 出块算法寻参系统操作指南
>
> 本文档面向**第一次使用本系统的工程师**,演示从 0 到部署上线的完整流程。
> 算法原理见 [SPAWN_TUNING_V2.md](./SPAWN_TUNING_V2.md)。

## 0. 系统架构一览

```
样本采集 (浏览器/小程序)
  ↓ POST /sample-sets/<id>/samples
SQLite 数据库 (spawn-tuning-v2.sqlite)
  ↓ 训练任务
PyTorch 模型 (ResNet-MLP 或 Transformer)
  ↓ build-and-export
离线策略 Bundle (web/public + miniprogram)
  ↓ 客户端加载
游戏运行时 (ctx → 查表 → predicted d_curve → 调整 adaptiveSpawn)
```

## 1. 启动系统

```bash
# 启动后端 Flask server (端口 5000)
python server.py

# 启动前端 dev server (vite)
npm run dev

# 访问看板
open http://localhost:5173/spawn-tuning-v2-dashboard.html
```

后端启动时会自动启动 `job_executor` 后台线程轮询训练任务,无需额外操作。

## 2. 看板 5-tab 工作流

| Tab | 功能 | 典型操作 |
|---|---|---|
| ① 总览 | 系统状态卡片 + 当前 deployed model | 查看 |
| ② 样本构建 | 创建样本集 + chips 加权采集 + 预览 + **质量分析 (G1)** | 采样 |
| ③ 训练 | 提交训练任务 + 任务队列 + 训练曲线 + **参数推荐 (G3)** | 训练 |
| ④ 模型库 | 模型列表 + d_curve 推断 + **对比 (G2)** + 删除 | 选模型 |
| ⑤ 部署 | 一键 build+export bundle + 灰度 + 状态 | 上线 |

## 3. 端到端流程示例 (新项目)

### Step 1 — 采集样本 (Tab ②)

1. **新建样本集**:点 "新建样本集",填名字 (e.g. `prod-baseline`)
2. **配置 chips**:5 维各选一些值 (例:`difficulty=normal/hard, generator=rule, bot_policy=clear-greedy, pb_bin=1500/4000, lifecycle_stage=growth/mature`)。v3.0.8 起 generator 只有 2 个值:`rule`(启发式,游戏页面 default) / `generative`(SpawnPolicyNet 生成式),与 `getSpawnPolicyMode()` 严格 1:1 对齐
3. **加权** (可选):右键 chip → 设权重 1-9 (默认 5),控制该选项在采样中占比
4. **样本数量**:建议 5000 起步 (调参)、72000 (生产)
5. **点 "开始采集"**:浏览器跑 OpenBlockSimulator,每秒处理 ~50 局
6. **完成后**:点 🧪 质量 查看数据质量分析

#### 质量分析关键指标 (G1)

| 指标 | 健康值 | 不健康时怎么办 |
|---|---|---|
| 综合评分 | > 0.7 | < 0.4 时数据有问题,重新采集 |
| 破 PB 率 | 10-20% | < 5% 表示 bot 太弱,无 r>1 数据 |
| d_curve 跨度 | > 0.4 | < 0.3 表示 d_step 计算有 bug |
| r 分布 | r<0.2 占比 < 40% | > 50% 表示 bot 弱,需重 repair_dcurves |
| 倒退 bin 数 | < 3 | > 5 表示算法有问题 |
| no_move 率 | 1-10% | ≈ 0% 表示模型预测无法到 ideal 顶部 |

### Step 2 — 训练模型 (Tab ③)

1. **选样本集**:multi-select 一个或多个 (推荐 ≥ 1 个 v2.10.x 样本集)
   - 若选了 [⚠v2.9 旧] 老数据会弹窗警告
2. **模型类型**:
   - **ResNet** (推荐):326K 参数,训练快,性价比高
   - **Transformer**:407K 参数,序列建模更好但慢 4×
3. **参数会自动推荐 (G3)**:
   - 选了样本集 + model_type 后,epochs/batch_size/lr 自动填好
   - 用户可继续修改 (会标 dirty 不被覆盖)
4. **设备**:自动检测 cuda > mps > cpu
5. **增量训练 (G4)**:选 "增量基础模型" 进入 fine-tune 模式
   - lr 自动 × 0.1 防灾难性遗忘
   - epochs 建议 20-30
   - 适合"已有 deployed 模型,小幅修正参数"场景
6. **点 "▶ 提交训练任务"**:job_executor 自动开始
7. **观察训练曲线**:点 "曲线" 弹出 13 sub-charts
   - ★ 关注 `val_ideal_mae`(★ 业务核心 — model vs ideal target,目标 < 0.05)
   - 关注 `val_curve_mae`(model vs sample,噪声地板 ~0.075,做参照)
   - 关注 `val_curve_var`(健康 > 0.1,< 0.05 说明退化)
   - 状态 badge:✓ 学到 / 🔒 数据满足 / 🔥 训练中 / ⚠ 退化 / 🚫 仅展示

### Step 3 — 模型对比 (Tab ④, G2)

训练完几个模型后,点 "⚖ 对比模型":
1. 勾选 ≥ 2 个模型
2. 点 "▶ 对比"
3. 系统对每个模型在 `default ctx (normal/rule/clear-greedy/4000/mature)` 推断 d_curve
4. SVG 叠加图 + metric 对比表(val_ideal_mae / val_curve_mae / val_curve_var / val_anchor / val_target_fit)

挑选标准:
- ★ `val_ideal_mae` 最低 → 业务拟合最好(model 跟 ideal target 距离最近)
- `val_curve_var > 0.1` → 不是退化解
- d_curve 形态严格单调 + 跨度合理

### Step 4 — 部署 Bundle (Tab ⑤)

**v3.0.9 起推荐路径**:在 Tab ③ 提交训练任务时,**勾选「训完自动部署」⚡ 一键闭环** checkbox(默认勾选)。训完后端会自动调 `build-and-export?optimize_theta=true`,把每个 ctx 的 best θ\* 直接写入 bundle 完成部署,**无需手动来 Tab ⑤**。

如果不勾,或想手动控制:

1. **选模型**:dropdown 选 staging 模型
2. **灰度比例**:1-100,先 10 然后逐渐上调
3. **★ 勾选「优化 θ 寻参」**(默认勾选)— 对每个 ctx 跑 surrogate Adam 优化找 best θ\*,而非默认 0.5
4. **点 "📦 导出 Bundle (Web + 小程序)"**
5. 系统会:
   - 加载 model checkpoint
   - 若勾选「优化 θ 寻参」:对 360 ctx × 8 starts × 300 steps 跑 `optimize_theta`(约 60-90s)
     - **未勾选**:全部用 `[0.5]*9`(快但闭环断裂,模型学到的 θ 映射被丢弃)
   - **PAVA 单调投影** 保证客户端策略严格 S 形 (v2.10.7)
   - 写出 4 个文件:
     - `web/public/spawn-tuning-v2/policies.json`(含 `build_mode` 字段标识)
     - `web/public/spawn-tuning-v2/policies.meta.json`
     - `miniprogram/core/tuning/spawnPoliciesV2.js`
     - `checkpoints/v2/<job>.policies.json` (sidecar)
6. **客户端自动拉取**:web 页面下次加载时 fetch 新 bundle
7. **部署到生产**:`bash scripts/sync-core.sh` 同步小程序包

> 看 `policies.meta.json` 的 `build_mode`:`model-inference-best-theta`(已寻参)/ `model-inference-default-theta`(没寻参,旧逻辑)。

### Step 5 — 闭环迭代精化 (v3.0.6 / 简化操作见 v3.0.9)

部署完一轮 best θ\* bundle 后,**回到 Tab ② 重新采集**,把 θ 来源从「LHS · 全空间探索 (首训)」**切到「围绕 deployed θ\* 抖动 (迭代精化)」**:

```
迭代 i (i ≥ 1):
  1. Tab ② 采集 (θ 来源 = 围绕 deployed θ* 抖动)  ← 在 best 邻域加密
     ⇒ 新 set #N+1
  2. Tab ③ 训练新模型 model_{i+1}                 ← model 在 best 邻域更精细
  3. Tab ⑤ 导出 bundle (勾选优化 θ 寻参)           ← 找到更优 θ_{i+1}*
  4. 用 default θ vs best θ 跑 baseline 对比, 看实测 MAE 撬动了多少
  5. 若 MAE 仍在下降 → 进入迭代 i+1; 否则停止
```

**预期收敛轨迹(实测 d_curve vs ideal MAE)**:

| 迭代 | θ 来源 | 实测 MAE | 撬动 |
|------|--------|----------|------|
| 0 | LHS + default θ 部署 | 0.27 | baseline |
| 1 | LHS + best θ\* 部署(G1) | 0.22-0.24 | **-15%** |
| 2 | bundle-perturb 采集 + best θ\*(G1+G2) | 0.20-0.22 | -7% |
| 3+ | 同上 | 收敛 ~0.18 | -5%/轮 |

**v3.0.9 (G3) 直接量化撬动幅度**:Tab ⑤ d_curve 对照图新增「baseline 对照」dropdown,选一个 default θ 跑的 sample set 后,chart 显示橙色虚线 = baseline 实测,主线 = best θ\* 实测,meta 区显示 `⚡ θ 撬动 = +0.05 (+18%)`,直观看到本轮迭代的实际收益。

收敛阈值的物理极限大约在 **0.18 附近**(θ 只能撬动 spawn 决策,改不动 fillRate 物理)。要再突破需要把 θ 接入 simulator.spawn(见 `SPAWN_TUNING_V2.md §12.5`)。

### Step 6 — 监控 (Tab ⑤ 下方)

实际生产中会有真实玩家上报 `field_metrics_v2` 数据。如:
- A/B 对比:`GET /api/spawn-tuning-v2/field-metrics/ab-compare?hours=168`
- 详细聚合:`GET /api/spawn-tuning-v2/field-metrics/aggregate?hours=24`

当前 (v2.10.8) 客户端上报集成已完成 (`policyMetricsV2.reportEpisode`),
等真实流量跑起来后即可看 A/B 对比数据。

## 4. 常见问题 (FAQ)

### Q1. 模型预测曲线水平,没有 S 形?

90% 是**数据问题**而非模型问题:
1. 看样本集 algo_version 徽章 — 若是 `[⚠v2.9 旧]` → 用 v2.9 算法采集的数据,d_curve 跨度仅 0.20
2. 用 `🧪 质量` 看数据质量评分:
   - < 0.4 → 数据本身就没 S 形,模型再训也是平的
3. 解决:重新采样 (v2.10.6 自动用新算法) 或用 `repair_dcurves.py` 离线修复

### Q2. Transformer 训练失败 / 进入退化解?

Transformer 对 LR 极敏感:
- 默认 lr 5e-3 太大 → 自动 cap 到 5e-3 (v2.9.4)
- 推荐 lr 1e-3 (v2.10.6 G3 自动推荐)
- 若已经退化:check `val_curve_var`,< 0.05 就是退化解,重训

### Q3. val_curve_mae 卡在 0.07-0.10 不再下降?

不是 bug,是**理论下界**。
- 训练 label 含 ±0.15 的 `state_offset` 噪声 (棋盘状态扰动)
- mae 下界 ≈ 0.075
- 真正业务指标是 ★ `val_ideal_mae`(model 跟 ideal target 的 MAE),目标 < 0.05

### Q4. 部署 bundle 404?

老接口 `POST /policies/bundle/export` 要求 source 文件先存在。
**v2.10.4 后用 `POST /policies/build-and-export`** 一键完成 (前端默认走这个)。
直接选模型 → 点导出按钮即可。

### Q5. 任务卡在 running?

v2.10.x 已修复 (sidecar JSON + SQLite timeout)。
若仍出现:
```bash
# 看 job 日志
tail .cursor-stress-logs/spawn-tuning-v2-jobs/job_<N>.log
# 看进程
ps aux | grep train.py
# 数据库手动修
python -m rl_pytorch.spawn_tuning_v2.repair_dcurves --help
```

## 5. CLI 工具速查

```bash
# 训练 (CLI 入口)
python -m rl_pytorch.spawn_tuning_v2.train \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --sample-sets 6 \
    --output checkpoints/v2/mymodel.pt \
    --epochs 30 --batch-size 256 --lr 5e-3 \
    --model-type resnet

# 修复历史样本 d_curve (无需重采)
python -m rl_pytorch.spawn_tuning_v2.repair_dcurves \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --set-id 6 --apply

# 离线 build policies + bundle (跳过 UI)
python -m rl_pytorch.spawn_tuning_v2.optimize_theta \
    --checkpoint checkpoints/v2/mymodel.pt \
    --output checkpoints/v2/mymodel.policies.json
```

## 6. v2.10.x 优化历史速览

| 版本 | 关键修复 |
|---|---|
| v2.10 | d_step 加 PB 命题 (`PB_AWARE_*`) — 跟 r 关联 |
| v2.10.1 | 贝叶斯先验平滑空 bin (替代 fillna) + 离线 repair |
| v2.10.2 | 新加 `val_calibrated_mae`(已于 v3.0.4 移除,被 `val_ideal_mae` 替代) |
| v2.10.3 | 训练曲线智能 Y 轴 (反应细微变化) |
| v2.10.4 | 一键 build-and-export(修部署 404)|
| v2.10.5 | 训练指标状态 badge(✓ 学到 / 🔒 数据满足 / ⚠ 退化) |
| v2.10.6 | 端点拉宽 (0.30, 0.92) → 更接近 ideal |
| v2.10.7 | PAVA 单调投影 — 客户端策略严格 S 形 |
| **v2.10.8** | **G1-G6+G9** 工业化收尾(质量分析/对比/推荐/手册等) |

## 7. 何时考虑 v3?

当前 v2.10.8 已经接近**数据可达的物理上限**。若业务要求:
- 模型预测 MAE vs ideal < 0.05 (业务理想)
- D=1.0 极端难度可达

需要 v3 工作:
1. RL bot (替代规则 bot,模拟真实玩家)
2. 真实玩家数据 fine-tune (`field_metrics_v2` 已就绪)
3. 多步 lookahead 出块算法 (非当前的单步 brake)

参见 SPAWN_TUNING_V2.md 末尾的 "下一步" 章节。
