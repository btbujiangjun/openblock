"""Spawn Transformer 模型与工具集（角色：`L1 · SpawnPolicyNet`）。

命名规范（统一术语，详见 docs/algorithms/SPAWN_OVERVIEW.md）
-----------------------------------------------------------
本包对外的「产品命名」是 ``SpawnPolicyNet``（出块策略·神经版）。
``SpawnTransformerV3`` / ``SpawnTransformerV2`` 是内部权重 / 实现版本号，
不再用于公共 API 与文档；新代码请用 ``SpawnPolicyNet``。

  from rl_pytorch.spawn_model import SpawnPolicyNet   # ✅ 推荐
  from rl_pytorch.spawn_model.model_v3 import SpawnTransformerV3  # ⚠ 旧名，仅供 checkpoint 兼容

模块结构
--------
- model        : SpawnTransformerV2（联合分布 + 多样性 + 反膨胀；旧版权重路径）
- model_v3     : SpawnTransformerV3（V2 + autoregressive + 风格 + 可解性 + LoRA-ready；当前 SpawnPolicyNet 实现）
- dataset      : SQLite move_sequences → 训练样本
- train        : V2 训练入口
- train_v3     : V3 训练入口（含 feasibility / playstyle 多任务损失）
- personalize  : 基于 LoRA 的单玩家 fine-tune
- feasibility  : 形状落点可解性检查（mask + soft weight）
- lora         : LoRALinear 适配器与 inject/load 工具
- shape_proposer: 程序化形状生成（PCGRL 雏形）

运行示例
--------
  V2 训练:        python -m rl_pytorch.spawn_model.train --epochs 30
  V3 训练:        python -m rl_pytorch.spawn_model.train_v3 --epochs 30
  个性化 LoRA:    python -m rl_pytorch.spawn_model.personalize --user-id alice
"""
from .model import SpawnTransformerV2
from .model_v3 import SpawnTransformerV3

# 唯一的角色化 alias：SpawnPolicyNet（神经版出块决策的产品命名）。
# V2 是历史实现，仓库内仍用 SpawnTransformerV2 名引用，不再赘加角色别名。
SpawnPolicyNet = SpawnTransformerV3

__all__ = [
    "SpawnPolicyNet",
    "SpawnTransformerV2",
    "SpawnTransformerV3",
]
