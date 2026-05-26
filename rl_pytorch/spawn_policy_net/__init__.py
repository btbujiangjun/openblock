"""SpawnPolicyNet 角色化入口（thin re-export shim）。

本包仅作为 ``rl_pytorch.spawn_model`` 的角色化 re-export shim，
旨在让命名规范（详见 ``docs/algorithms/SPAWN_OVERVIEW.md``）贯通到 import 路径层。

* **权威实现**：仍在 ``rl_pytorch.spawn_model.*`` 下（包目录名因外部引用较多暂不重命名）。
* **新代码推荐**：优先用本包路径，以贯彻 ``SpawnPolicyNet`` 角色名约定。

  from rl_pytorch.spawn_policy_net import SpawnPolicyNet   # ✅ 推荐
  from rl_pytorch.spawn_model.model_v3 import SpawnTransformerV3  # ⚠ 旧路径（仍可用）

迁移路径
--------
当外部引用全部切换到本包路径后，``rl_pytorch.spawn_model`` 可降级为内部实现私有目录。
当前阶段两条路径并存，无任何行为差异。
"""
from rl_pytorch.spawn_model import (
    SpawnPolicyNet,
    SpawnTransformerV2,
    SpawnTransformerV3,
)

__all__ = [
    "SpawnPolicyNet",
    "SpawnTransformerV2",
    "SpawnTransformerV3",
]
