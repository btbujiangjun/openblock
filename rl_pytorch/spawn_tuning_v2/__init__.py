"""
OpenBlock 出块算法寻参系统 v2.0 — Python 训练管线。

包含 5 个核心模块:
  target_curve      — 目标 S 曲线 (业务目标量化)
  extractor         — 从单局轨迹提取 d_curve 标签
  model             — ResNet-MLP (L4, 235K 参数)
  losses            — 5 项加权损失函数
  train             — 训练管线 (支持增量训练)
  feature_io        — SQLite 数据读写
  optimize_theta    — Phase C 梯度上升寻参

详细设计见 docs/algorithms/SPAWN_TUNING_V2.md
"""

__version__ = "2.0.0"
