"""SpawnParamTuner 角色化入口（thin re-export shim）。

本包仅作为 ``rl_pytorch.spawn_tuning_v2`` 的角色化 re-export shim，
旨在让命名规范（详见 ``docs/algorithms/SPAWN_OVERVIEW.md``）贯通到 import 路径层。

* **权威实现**：仍在 ``rl_pytorch.spawn_tuning_v2.*`` 下（``_v2`` 是内部 schema 迭代号，
  因 DB schema / bundle URL / 历史引用众多暂不重命名）。
* **新代码推荐**：优先用本包路径，以贯彻 ``SpawnParamTuner`` 角色名约定。

  from rl_pytorch.spawn_param_tuner import SpawnParamTuner, SpawnParamTunerResNet  # ✅ 推荐
  from rl_pytorch.spawn_tuning_v2.model import SpawnTuningResNetMLP                # ⚠ 旧路径（仍可用）

职责（与 L1 · SpawnPolicyNet / SpawnPolicyRules 正交）
------------------------------------------------------
本包**不产 3 个候选块**，只学 ``(ctx_5, theta_9) → d_curve_20``，
再用梯度上升搜 theta*，输出 ``policies.json`` 喂回 ``SpawnPolicyRules``。

更多设计细节见 ``docs/algorithms/SPAWN_TUNING_V2.md``。
"""
from rl_pytorch.spawn_tuning_v2 import (
    SpawnParamTuner,
    SpawnParamTunerResNet,
    SpawnParamTunerTransformer,
    SpawnTuningResNetMLP,
    SpawnTuningTransformer,
    build_default_model,
    build_model,
)

__all__ = [
    "SpawnParamTuner",
    "SpawnParamTunerResNet",
    "SpawnParamTunerTransformer",
    "SpawnTuningResNetMLP",
    "SpawnTuningTransformer",
    "build_default_model",
    "build_model",
]
