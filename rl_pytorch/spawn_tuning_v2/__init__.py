"""
OpenBlock 出块算法参数寻优器（角色：`L2 · SpawnParamTuner`）。

命名规范（统一术语，详见 docs/algorithms/SPAWN_OVERVIEW.md）
-----------------------------------------------------------
本包对外的「产品命名」是 ``SpawnParamTuner``（出块参数·寻优器）。
- 包路径 ``rl_pytorch.spawn_tuning_v2`` 中的 ``_v2`` 是内部 schema 迭代号，
  因外部引用较多暂不重命名；任何新代码 / 文档引用请用 ``SpawnParamTuner`` 角色名。
- ``SpawnTuningResNetMLP`` / ``SpawnTuningTransformer`` 是实现类型名（按网络结构区分），
  已重命名为 ``SpawnParamTunerResNet`` / ``SpawnParamTunerTransformer``；旧名保留为 alias。

  from rl_pytorch.spawn_tuning_v2 import SpawnParamTuner, SpawnParamTunerResNet  # ✅ 推荐
  from rl_pytorch.spawn_tuning_v2.model import SpawnTuningResNetMLP              # ⚠ 旧名，向后兼容

职责（与 L1 · SpawnPolicyNet / SpawnPolicyRules 正交）
------------------------------------------------------
本包**不产 3 个候选块**，只学 ``(ctx_5, theta_9) → d_curve_20``，
再用梯度上升搜 θ\*，输出 ``policies.json`` 喂回 ``SpawnPolicyRules``。

包含 7 个核心模块:
  target_curve      — 目标 S 曲线 (业务目标量化)
  extractor         — 从单局轨迹提取 d_curve 标签
  model             — ResNet-MLP / Transformer 实现 (L4, 235K 参数)
  losses            — 10 项加权损失函数 (v2.9.1)
  train             — 训练管线 (支持增量训练)
  feature_io        — SQLite 数据读写
  optimize_theta    — Phase C 梯度上升寻参

详细设计见 docs/algorithms/SPAWN_TUNING_V2.md
"""
from .model import SpawnTuningResNetMLP, SpawnTuningTransformer, build_default_model, build_model

SpawnParamTunerResNet = SpawnTuningResNetMLP
SpawnParamTunerTransformer = SpawnTuningTransformer
SpawnParamTuner = SpawnTuningResNetMLP

__version__ = "2.0.0"

__all__ = [
    "SpawnParamTuner",
    "SpawnParamTunerResNet",
    "SpawnParamTunerTransformer",
    "SpawnTuningResNetMLP",
    "SpawnTuningTransformer",
    "build_default_model",
    "build_model",
]
