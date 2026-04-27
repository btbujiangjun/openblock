"""Spawn Transformer 模型与工具集。

模块结构
--------
- model        : SpawnTransformerV2（联合分布 + 多样性 + 反膨胀）
- model_v3     : SpawnTransformerV3（V2 + autoregressive + 风格 + 可解性 + LoRA-ready）
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
