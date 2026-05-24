"""
Spawn Auto-Tuning Phase B-D — NN 代理模型训练 + 梯度上升找 θ*。

模块组成 (docs/algorithms/SPAWN_AUTO_TUNING.md §5):
    - surrogate_model.py:  MLP 代理网络 (embedding + 共享 trunk + 3 任务头)
    - train_surrogate.py:  Phase B 训练入口
    - optimize_theta.py:   Phase C 梯度上升找 θ*(context)
    - active_sampling.py:  Phase D 主动学习采样策略
    - feature_io.py:       SQLite 样本读取 + θ/context 编码

依赖:
    pip install torch numpy pandas matplotlib

使用流程:
    1. 先用 scripts/spawn-tune-v2.mjs 跑 Phase A 收集 35K 样本到 SQLite
    2. python -m rl_pytorch.spawn_tuning.train_surrogate --db PATH --run-id RID
    3. python -m rl_pytorch.spawn_tuning.optimize_theta --run-id RID --output policies.json
    4. POST policies.json 到 /api/spawn-tuning/v2/policies/deploy
"""

__version__ = "0.3.0"
