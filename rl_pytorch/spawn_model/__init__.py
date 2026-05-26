"""SpawnPolicyNet —— L1 出块策略·神经版（详见 docs/algorithms/SPAWN_OVERVIEW.md）。

包路径 ``rl_pytorch.spawn_model`` 是历史磁盘命名（外部引用 30+ 处保留不动）；
对外产品命名统一为 ``SpawnPolicyNet``。

  from rl_pytorch.spawn_model import SpawnPolicyNet

模块结构
--------
- model         : SpawnTransformerV2（已废弃历史实现，仅供旧 checkpoint 兼容；仓库内部使用）
- model_v3      : SpawnPolicyNet（当前权威实现）
- dataset       : SQLite move_sequences → 训练样本
- train         : V2 训练入口（已废弃，仅兼容老 V2 权重）
- train_v3      : SpawnPolicyNet 训练入口
- personalize   : 基于 LoRA 的单玩家 fine-tune
- feasibility   : 形状落点可解性检查（mask + soft weight）
- lora          : LoRALinear 适配器与 inject/load 工具
- shape_proposer: 程序化形状生成（PCGRL 雏形）

运行示例
--------
  训练:           python -m rl_pytorch.spawn_model.train_v3 --epochs 30
  个性化 LoRA:    python -m rl_pytorch.spawn_model.personalize --user-id alice
"""
from .model_v3 import SpawnPolicyNet

__all__ = ["SpawnPolicyNet"]
