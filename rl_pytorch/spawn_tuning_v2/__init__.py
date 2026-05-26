"""SpawnParamTuner —— L2 出块参数·寻优器（详见 docs/algorithms/SPAWN_OVERVIEW.md）。

包路径 ``rl_pytorch.spawn_tuning_v2`` 是历史磁盘命名（``_v2`` 是 schema 迭代号，
DB / bundle URL / env var 等运维契约也用此字符串，故保留不动）；
对外产品命名统一为 ``SpawnParamTuner``。

  from rl_pytorch.spawn_tuning_v2 import SpawnParamTunerResNet, SpawnParamTunerTransformer

职责（与 L1 · SpawnPolicyNet / SpawnPolicyRules 正交）
------------------------------------------------------
本包**不产 3 个候选块**，只学 ``(ctx_5, theta_9) → d_curve_20``，
再用梯度上升搜 theta*，输出 ``policies.json`` 喂回 ``SpawnPolicyRules``。

实现选择
--------
- ``SpawnParamTunerResNet``     : ResNet-MLP (L4, ~325K 参数)；默认实现
- ``SpawnParamTunerTransformer``: 序列化 Transformer，适合大数据规模
- ``build_default_model()``     : 返回默认实现（ResNet）
- ``build_model('resnet'|'transformer')`` : 工厂方法

包含 7 个核心模块
-----------------
  target_curve      — 目标 S 曲线（业务目标量化）
  extractor         — 从单局轨迹提取 d_curve 标签
  model             — ResNet-MLP / Transformer 实现
  losses            — 10 项加权损失函数（v2.9.1）
  train             — 训练管线（支持增量训练）
  feature_io        — SQLite 数据读写
  optimize_theta    — Phase C 梯度上升寻参

详细设计见 docs/algorithms/SPAWN_TUNING_V2.md
"""
from .model import (
    SpawnParamTunerResNet,
    SpawnParamTunerTransformer,
    build_default_model,
    build_model,
)

__version__ = "2.0.0"

__all__ = [
    "SpawnParamTunerResNet",
    "SpawnParamTunerTransformer",
    "build_default_model",
    "build_model",
]
