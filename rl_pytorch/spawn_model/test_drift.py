"""spawnTargets 漂移监控 + v1.61.0 显式 θ 条件 单元自检。

运行：
  python -m rl_pytorch.spawn_model.test_drift
"""

from __future__ import annotations

import sys

import numpy as np


def _make_contexts(n, fill_targets=None, fill_theta=None, dim=66, seed=0):
    rng = np.random.default_rng(seed)
    ctx = np.zeros((n, dim), dtype=np.float64)
    if fill_targets is not None:
        lo, hi = fill_targets
        ctx[:, 38:44] = rng.uniform(lo, hi, size=(n, 6))
    if fill_theta is not None:
        lo, hi = fill_theta
        ctx[:, 57:61] = rng.uniform(lo, hi, size=(n, 4))
    return ctx


def test_psi_identical_is_zero():
    from .drift import spawn_targets_drift, summarize_drift

    ctx = _make_contexts(500, fill_targets=(0.0, 1.0), seed=1)
    drift = spawn_targets_drift(ctx, ctx)
    s = summarize_drift(drift)
    assert set(drift.keys()) == {
        'shapeComplexity', 'solutionSpacePressure', 'clearOpportunity',
        'spatialPressure', 'payoffIntensity', 'novelty',
    }, "spawnTargets 应有 6 个标签"
    assert s["max"] < 1e-9, f"同分布 PSI 应≈0，实际 {s['max']}"
    assert s["level"] == "stable"
    print("[OK] PSI 同分布 ≈ 0")


def test_psi_shift_alarms_and_asserts():
    from .drift import spawn_targets_drift, summarize_drift, assert_spawn_targets_drift

    ref = _make_contexts(500, fill_targets=(0.0, 0.4), seed=2)
    live = _make_contexts(500, fill_targets=(0.6, 1.0), seed=3)
    s = summarize_drift(spawn_targets_drift(ref, live))
    assert s["max"] >= 0.25, f"明显平移应触发 alarm，实际 max PSI={s['max']}"
    assert s["level"] == "alarm"

    raised = False
    try:
        assert_spawn_targets_drift(ref, live, threshold=0.25)
    except AssertionError:
        raised = True
    assert raised, "漂移超阈值应抛 AssertionError"

    # 阈值放宽后不应抛
    assert_spawn_targets_drift(ref, ref, threshold=0.25)
    print("[OK] PSI 漂移报警 + 断言")


def test_pb_theta_drift_detects_theta_change():
    from .drift import pb_theta_drift, summarize_drift

    ref = _make_contexts(400, fill_theta=(0.40, 0.55), seed=4)
    live = _make_contexts(400, fill_theta=(0.80, 0.95), seed=5)
    s = summarize_drift(pb_theta_drift(ref, live))
    assert set(s["per_feature"].keys()) == {
        'pbTensionCenter', 'pbTensionWidth', 'pbBrakeCenter', 'pbBrakeWidth',
    }
    assert s["max"] >= 0.25, f"θ 段平移应被检出，实际 {s['max']}"
    print("[OK] PB θ 段漂移检出")


def test_dataset_dim_and_explicit_theta():
    from .dataset import (
        BEHAVIOR_CONTEXT_DIM,
        _parse_behavior_context,
        _norm_pb_theta,
        theta_regime_id,
        _PB_THETA_DEFAULTS,
    )

    assert BEHAVIOR_CONTEXT_DIM == 66, "v1.67：behaviorContext 应为 66 维（61 + 2 维客观几何 + 3 维空间规划）"

    # 缺省 θ → 默认域归一化（pbTensionCenter 0.82 → (0.82-0.70)/0.22 ≈ 0.5455）。
    default_norm = _norm_pb_theta(None)
    assert len(default_norm) == 4
    assert abs(default_norm[0] - (0.82 - 0.70) / (0.92 - 0.70)) < 1e-6

    # 空 ps → 全 0（含 θ 尾段为 0，因为整体补零路径）。
    assert _parse_behavior_context(None).shape[0] == 66

    # 带 pbCurveParams 的 ps → θ 尾段反映显式值。
    ps = {
        'adaptive': {
            'stressBreakdown': {
                'pbCurveParams': {
                    'pbTensionCenter': 0.92, 'pbTensionWidth': 0.15,
                    'pbBrakeCenter': 1.15, 'pbBrakeWidth': 0.12,
                }
            }
        }
    }
    vec = _parse_behavior_context(ps)
    assert vec.shape[0] == 66
    # 全部取区间上界 → 归一化应为 1.0。
    assert np.allclose(vec[57:61], [1.0, 1.0, 1.0, 1.0]), f"上界 θ 应归一化为 1，实际 {vec[57:61]}"

    # theta_regime_id：相同 θ 稳定、不同 θ 不同、缺省固定。
    rid_a = theta_regime_id({'pbTensionCenter': 0.80})
    rid_a2 = theta_regime_id({'pbTensionCenter': 0.80})
    rid_default = theta_regime_id(None)
    rid_default2 = theta_regime_id(_PB_THETA_DEFAULTS)
    assert rid_a == rid_a2, "相同 θ 应得相同 regime id"
    assert rid_default == rid_default2, "缺省 θ 应与显式默认 θ 同 regime"
    assert rid_a != rid_default, "不同 θ 应得不同 regime id"
    print("[OK] dataset 66 维 + 显式 θ + 客观几何 + 空间规划 + theta_regime_id")


def test_reference_build_and_check():
    from .drift import build_drift_reference, check_against_reference

    ref_ctx = _make_contexts(3000, fill_targets=(0.0, 0.4), fill_theta=(0.40, 0.55), seed=10)
    ref = build_drift_reference(ref_ctx, max_rows=2000)
    assert ref['n'] == 3000, "应记录原始样本数"
    assert ref['spawn_targets'].shape == (2000, 6), "应按 max_rows 抽样"
    assert ref['pb_theta'].shape == (2000, 4)

    # 同分布线上数据 → 通过。
    live_same = _make_contexts(800, fill_targets=(0.0, 0.4), fill_theta=(0.40, 0.55), seed=11)
    rep_same = check_against_reference(ref, live_same, threshold=0.25)
    assert rep_same['passed'] is True, f"同分布不应判漂移：{rep_same['spawn_targets']}"

    # spawnTargets 明显平移 → 不通过。
    live_drift = _make_contexts(800, fill_targets=(0.6, 1.0), fill_theta=(0.40, 0.55), seed=12)
    rep_drift = check_against_reference(ref, live_drift, threshold=0.25)
    assert rep_drift['passed'] is False, "明显平移应判漂移"
    assert rep_drift['spawn_targets']['level'] == 'alarm'
    print("[OK] drift_reference 构建 + 服务期对照")


def test_constant_theta_regime_no_false_alarm():
    """单一 θ-regime（常数列）+ float16 参考 → 不应误报 inf 漂移。"""
    from .drift import build_drift_reference, check_against_reference, population_stability_index

    # 常数 θ 列（模拟无 Tuner 部署、全默认 θ）。
    ctx = _make_contexts(1500, fill_targets=(0.0, 0.5), seed=20)
    ctx[:, 57:61] = 0.5454545  # 全部相同（默认 pbTensionCenter 归一化值附近）
    ref = build_drift_reference(ctx, max_rows=1000)

    live = _make_contexts(500, fill_targets=(0.0, 0.5), seed=21)
    live[:, 57:61] = 0.5454545
    rep = check_against_reference(ref, live, threshold=0.25)
    assert rep['pb_theta']['level'] == 'stable', f"常数 θ 同值不应报警：{rep['pb_theta']}"
    assert np.isfinite(rep['pb_theta']['max'])

    # 常数参考 vs 偏离 live → 仍应判显著漂移（inf）。
    assert population_stability_index(np.full(50, 0.5), np.full(50, 0.9)) == float('inf')
    print("[OK] 常数 θ-regime 无误报 + 偏离仍报警")


def main():
    tests = [
        test_psi_identical_is_zero,
        test_psi_shift_alarms_and_asserts,
        test_pb_theta_drift_detects_theta_change,
        test_dataset_dim_and_explicit_theta,
        test_reference_build_and_check,
        test_constant_theta_regime_no_false_alarm,
    ]
    failed = 0
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"[FAIL] {t.__name__}: {e}")
            failed += 1
            import traceback
            traceback.print_exc()
    if failed:
        print(f"\n{failed}/{len(tests)} 个测试失败")
        sys.exit(1)
    print(f"\n全部 {len(tests)} 项漂移/θ 自检通过")


if __name__ == '__main__':
    main()
