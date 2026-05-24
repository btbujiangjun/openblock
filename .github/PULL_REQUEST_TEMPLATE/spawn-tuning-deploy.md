# Spawn Tuning Policy Deployment PR

> 用本 template 提交「寻参 θ 部署」类 PR (而非代码改动 PR)。
> 模板对应 docs/algorithms/SPAWN_AUTO_TUNING.md §15.8 灰度发布 Runbook。

## 1. 寻参基本信息

- **Run ID**: `<填 spawn_tuning_runs.run_id>`
- **任务名称**: <寻参任务的 name 字段>
- **采样规模**: `<sample_count>` 样本 / `<context_count>` contexts
- **代理模型**: <Phase B checkpoint 路径>
- **离线 J 提升 (vs default)**: 平均 +X.XX,最大 +X.XX, 90% context J ≥ 0.7
- **目标权重**: `f=70 e=45 a=60` (公平 / 爽点 / 抑制膨胀)

## 2. 安全核对清单

### 离线指标必须满足 (来自看板 Tab ③)

- [ ] 平均 composite ≥ 0.70
- [ ] 死局率 (noMoveRate) 平均 ≤ baseline + 1%
- [ ] 兜底率 (fallbackRate) 平均 ≤ baseline + 0.5%
- [ ] 90% context 的 composite ≥ 0.65
- [ ] 顶尖 PB (best=25000) context 的 overshootRate ≤ 5%
- [ ] 新手 PB (best=500) context 的 antiInflation 子分 ≥ 0.6

### 跨 lifecycle 合理性检查

- [ ] onboarding 阶段 fairness 子分 ≥ growth 阶段 (新手友好)
- [ ] mature 阶段 antiInflation 子分 ≥ 0.8 (严控膨胀)
- [ ] plateau 阶段 excitement 子分 ≥ growth 阶段 (打破倦怠)

### Phase E 对照评估 (看板 Tab ④)

- [ ] 抽 3 个不同 lifecycle 的 ctx 跑 10 局对照 tuned vs default
- [ ] 至少 2/3 个 ctx 的 composite 提升 > 5%
- [ ] 无任何 ctx 的死局率显著回退 (绝对值不超 +3%)

## 3. 部署计划

### Stage 0: Shadow (本 PR 合并后立即)

```bash
# 服务端启动时设 secret
export SPAWN_TUNING_SECRET="<production-secret-from-secret-manager>"

# 部署 (默认 rollout_pct=100, 但客户端 release_pct=0 处于 shadow)
curl -X POST $API/api/spawn-tuning/v2/policies/deploy \
  -d '{ "run_id": <RID>, "rollout_pct": 100, "policies": [...] }'
```

- 当前线上客户端版本 (未 OTA) 看不到这批新 θ
- 看板可见 active=N,用于离线对照

### Stage 1: 灰度 10% (Stage 0 通过 7 天后)

需要客户端 OTA / 应用更新一次,主路径才会调 `resolveSpawnTheta` 拿 θ。
然后服务端调整 rollout_pct:

```bash
# (无专用 endpoint, 通过 deploy 重写 rollout)
curl -X POST $API/api/spawn-tuning/v2/policies/deploy \
  -d '{ "run_id": <RID>, "rollout_pct": 10, "policies": [...] }'
```

监控 48 小时,以下指标都不能回退 ≥5%:
- [ ] DAU
- [ ] 单局平均时长
- [ ] 留存 D1 / D7
- [ ] 平均 scoreP90 (防 PB 暴涨)
- [ ] 主算法 fallback 频次

### Stage 2: 全量 (Stage 1 通过 7 天后)

```bash
curl -X POST $API/api/spawn-tuning/v2/policies/deploy \
  -d '{ "run_id": <RID>, "rollout_pct": 100, "policies": [...] }'
```

持续监控 30 天。

## 4. 回滚预案

任一指标 ≥5% 回退,立即:

```bash
curl -X POST $API/api/spawn-tuning/v2/policies/rollback
```

效果: 服务端 `is_active=0`,客户端下次 fetch 拿到空 policies → 自动 fallback 到 DEFAULT_THETA。

## 5. 评审人 Sign-off

部署任何 Stage 都需要至少 2 位评审 Sign-off:

- [ ] **算法 owner**: 验证 θ 在离线指标上合理性
- [ ] **客户端 owner**: 验证主路径接入无副作用
- [ ] **运维 owner**: 验证回滚链路完备
- [ ] **业务 owner**: 验证灰度时段不撞活动 / 重大版本

## 6. 提交时附加材料

- [ ] 看板 Tab ① 总览截图 (active policies + rollout %)
- [ ] 看板 Tab ③ 指标表前 10 行截图
- [ ] 看板 Tab ④ 对照评估至少 3 个 ctx 截图
- [ ] 完整 policies.json (gzipped, 作为 PR 附件)
- [ ] Phase B 训练曲线 (train/val loss 图)

## 7. PR Title 规范

```
[spawn-tuning] Deploy Run #<RID> Stage <0/1/2>: <feature description>

例:
[spawn-tuning] Deploy Run #20260524 Stage 1 (10%): 公平性优化, 新手 fairness +12%
```
