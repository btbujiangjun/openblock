"""SpawnPolicyNet / SpawnParamTuner 角色化入口 thin re-export shim 烟雾测试 (pytest)。

验证：
  - rl_pytorch.spawn_policy_net      → 转发 rl_pytorch.spawn_model
  - rl_pytorch.spawn_param_tuner     → 转发 rl_pytorch.spawn_tuning_v2

详见 docs/algorithms/SPAWN_OVERVIEW.md 与本仓库 PR 链路 PR-3。
"""
from __future__ import annotations


def test_spawn_policy_net_shim_reexports_authority():
    from rl_pytorch import spawn_model as authority
    from rl_pytorch import spawn_policy_net as shim

    assert shim.SpawnPolicyNet is authority.SpawnPolicyNet
    assert shim.SpawnPolicyNet is authority.SpawnTransformerV3
    # 旧名 SpawnTransformerV2 仍透过 shim 可用（向后兼容），但不再赘加 Legacy 角色别名。
    assert shim.SpawnTransformerV2 is authority.SpawnTransformerV2
    assert "SpawnPolicyNet" in shim.__all__


def test_spawn_param_tuner_shim_reexports_authority():
    from rl_pytorch import spawn_tuning_v2 as authority
    from rl_pytorch import spawn_param_tuner as shim

    assert shim.SpawnParamTuner is authority.SpawnParamTuner
    assert shim.SpawnParamTunerResNet is authority.SpawnTuningResNetMLP
    assert shim.SpawnParamTunerTransformer is authority.SpawnTuningTransformer
    assert shim.build_default_model is authority.build_default_model
    assert "SpawnParamTuner" in shim.__all__


def test_spawn_param_tuner_instantiable_via_shim():
    from rl_pytorch.spawn_param_tuner import SpawnParamTuner

    model = SpawnParamTuner()
    # v2.10.8 实测 ResNet-MLP (L4) 参数量 326K（略大于设计目标 235K，因 hidden=128 + 8 blocks）
    n = model.count_parameters()
    assert 200_000 < n < 500_000, f"参数量异常: {n}"
