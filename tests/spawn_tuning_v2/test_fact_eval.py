"""fact_eval —— 以目标 S 曲线为准的「模型效果提升」门禁的单元/集成测试。

锁定核心语义（新口径，以目标 S 为准）：
  - 提升判定唯一标准 = Δ = E_meas − E_pred = |实测−S| − |预估−S| ≥ 0（预估更逼近目标 → 提升）；
  - gate() 三态：True(Δ≥阈值=提升) / False(Δ<阈值=未提升/下降) / None(实测不足)；
  - 覆盖率/高分段覆盖 **不参与**提升判定，仅由 coverage_caveats() 输出告警（验证范围）；
  - 预测-实测偏离 R 仅作诊断，默认不阻断；
  - evaluate_policies() 仅用真实观测到的 bin，且 E_meas/E_pred 在同一批 bin 上可比。
"""
import json
import sqlite3

import numpy as np
import pytest

from rl_pytorch.spawn_tuning_v2.fact_eval import (
    aggregate_metrics, gate, coverage_caveats, evaluate_policies, DEFAULT_THRESHOLDS, N_BINS,
)
from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector


def _metrics(**kw):
    """构造一个带全部新口径键的 metrics dict，缺省给安全默认值。"""
    base = {
        "n_contexts": 360, "n_with_data": 200,
        "n_improved": 100, "n_regressed": 0,
        "coverage": 0.80, "high_coverage": 0.60,
        "measured_mae": 0.12, "pred_mae_obs": 0.07,
        "pred_mae_all": 0.05, "calib_residual": 0.03,
        "improvement": 0.05,
    }
    base.update(kw)
    return base


def test_gate_indeterminate_when_data_insufficient():
    # 有数据 context 少于 min_armed_contexts → None（无法判定）
    m = _metrics(n_with_data=3, coverage=0.0, high_coverage=0.0,
                 measured_mae=float("nan"), pred_mae_obs=float("nan"),
                 calib_residual=float("nan"), improvement=float("nan"))
    passed, fails = gate(m)
    assert passed is None
    assert any("实测支撑不足" in f for f in fails)


def test_low_coverage_is_caveat_not_fail():
    # 覆盖/高分段低，但 Δ>0(预估更逼近目标) → 仍判提升；覆盖只进 caveat，不进 fail
    m = _metrics(n_with_data=108, coverage=0.153, high_coverage=0.092,
                 measured_mae=0.161, pred_mae_obs=0.0884,
                 improvement=0.161 - 0.0884)  # Δ=+0.0726 (复刻图中场景)
    passed, fails = gate(m)
    assert passed is True
    assert fails == []
    cav = coverage_caveats(m)
    assert len(cav) == 2
    assert any("覆盖" in c for c in cav)
    assert any("高分段" in c for c in cav)


def test_gate_passes_when_improved_even_if_residual_large():
    # 覆盖充足 + Δ>0(预估更逼近目标) → 提升；预测-实测偏离大不阻断（默认不启用校准上限）
    m = _metrics(measured_mae=0.20, pred_mae_obs=0.05, calib_residual=0.18,
                 improvement=0.15)
    passed, fails = gate(m)
    assert passed is True
    assert fails == []


def test_gate_optional_calib_ceiling_when_explicitly_set():
    # 显式传 max_calib_residual 才把 R 当作阻断门
    m = _metrics(measured_mae=0.20, pred_mae_obs=0.05, calib_residual=0.18,
                 improvement=0.15)
    passed, fails = gate(m, {"max_calib_residual": 0.08})
    assert passed is False
    assert any("预测-实测偏离" in f for f in fails)


def test_gate_fails_when_no_improvement():
    # 预估比实测更偏离目标（Δ<0）→ 下降 → False
    m = _metrics(measured_mae=0.05, pred_mae_obs=0.12, calib_residual=0.04,
                 improvement=-0.07)
    passed, fails = gate(m)
    assert passed is False
    assert any("提升量" in f for f in fails)


def test_gate_passes_when_calibrated_and_improved():
    m = _metrics(measured_mae=0.12, pred_mae_obs=0.05, calib_residual=0.03,
                 improvement=0.07)
    passed, fails = gate(m)
    assert passed is True
    assert fails == []


def test_gate_accepts_legacy_self_delusion_alias():
    # 旧调用方仍可传 max_self_delusion，映射为可选的 max_calib_residual（显式启用才阻断）
    m = _metrics(calib_residual=0.12, improvement=0.05)
    passed, _ = gate(m, {"max_self_delusion": 0.20})
    assert passed is True
    passed2, _ = gate(m, {"max_self_delusion": 0.08})
    assert passed2 is False


def _seed_samples(db_path, contexts_curves, n_per_bin=10):
    """写最小 samples 表。contexts_curves: {context_key: curve(np array len 20 或带 nan)}。
    nan bin → 该 bin 不写观测（模拟未覆盖）。"""
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE samples (difficulty TEXT, generator TEXT, bot_policy TEXT, "
        "pb_bin INTEGER, lifecycle_stage TEXT, d_curve_json TEXT, bin_counts_json TEXT)"
    )
    for key, curve in contexts_curves.items():
        d, g, b, pb, life = key.split(":")
        dc = [float(x) if x == x else 0.5 for x in curve]
        bc = [n_per_bin if x == x else 0 for x in curve]  # nan → 0 观测
        conn.execute(
            "INSERT INTO samples VALUES (?,?,?,?,?,?,?)",
            (d, g, b, int(pb), life, json.dumps(dc), json.dumps(bc)),
        )
    conn.commit()
    conn.close()


def test_evaluate_policies_only_credits_observed_bins(tmp_path):
    target = np.asarray(target_curve_vector(), dtype=float)
    db = str(tmp_path / "s.sqlite")
    key = "normal:rule:clear-greedy:500:growth"
    # 实测：全 20 bin 都贴合目标 → 实测/预估口径误差≈0，覆盖 100%
    _seed_samples(db, {key: target.copy()}, n_per_bin=20)
    policies = [{"context_key": key, "predicted_curve": list(target)}]
    per_ctx = evaluate_policies(db, policies, min_bin_samples=5)
    m = aggregate_metrics(per_ctx)
    assert m["n_with_data"] == 1
    assert m["coverage"] == pytest.approx(1.0)
    assert m["measured_mae"] < 1e-6
    assert m["pred_mae_obs"] < 1e-6
    assert m["calib_residual"] < 1e-6
    assert abs(m["improvement"]) < 1e-6  # 都贴合目标 → 无提升也无下降


def test_evaluate_policies_improvement_when_pred_closer(tmp_path):
    target = np.asarray(target_curve_vector(), dtype=float)
    db = str(tmp_path / "s_imp.sqlite")
    key = "normal:rule:clear-greedy:500:growth"
    # 实测整体偏离目标；预估正好贴合目标 → 预估更逼近 → 提升量>0；预估口径误差≈0
    _seed_samples(db, {key: np.clip(target + 0.1, 0, 1)}, n_per_bin=20)
    policies = [{"context_key": key, "predicted_curve": list(target)}]
    m = aggregate_metrics(evaluate_policies(db, policies, min_bin_samples=5))
    assert m["measured_mae"] > 0.05
    assert m["pred_mae_obs"] < 1e-6
    # 预估贴合目标 → 提升量 = 实测口径误差；预测-实测偏离也 = 实测口径误差(pred=target)
    assert m["improvement"] == pytest.approx(m["measured_mae"], abs=1e-9)
    assert m["improvement"] > 0  # Δ>0 = 提升
    assert m["calib_residual"] == pytest.approx(m["measured_mae"], abs=1e-9)


def test_evaluate_policies_low_coverage_is_caveat(tmp_path):
    target = np.asarray(target_curve_vector(), dtype=float)
    db = str(tmp_path / "s2.sqlite")
    key = "normal:rule:random:4000:growth"
    # 只有低分段(前5 bin)有数据且偏离目标；高分段全 nan(无数据)；预估贴合目标
    curve = np.full(N_BINS, np.nan)
    curve[:5] = 0.5  # 实测平 0.5，目标前5≈0.10-0.11 → 偏离
    _seed_samples(db, {key: curve}, n_per_bin=30)
    policies = [{"context_key": key, "predicted_curve": list(target)}]
    per_ctx = evaluate_policies(db, policies, min_bin_samples=5)
    m = aggregate_metrics(per_ctx)
    assert m["coverage"] == pytest.approx(5 / N_BINS)
    assert m["high_coverage"] == 0.0
    # 观测 bin 上预估=目标 → Δ>0 → 仍判提升；低覆盖只是 caveat（验证范围有限），不判未提升
    assert m["improvement"] > 0
    passed, fails = gate(m, {"min_armed_contexts": 1})
    assert passed is True
    assert fails == []
    cav = coverage_caveats(m)
    assert len(cav) == 2  # 覆盖率 + 高分段 两条告警


def main():
    test_gate_indeterminate_when_data_insufficient()
    test_low_coverage_is_caveat_not_fail()
    test_gate_passes_when_improved_even_if_residual_large()
    test_gate_optional_calib_ceiling_when_explicitly_set()
    test_gate_fails_when_no_improvement()
    test_gate_passes_when_calibrated_and_improved()
    test_gate_accepts_legacy_self_delusion_alias()
    print("[OK] gate 提升门(唯一判定) + 覆盖率仅 caveat + 可选上限")
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as d:
        test_evaluate_policies_only_credits_observed_bins(pathlib.Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_evaluate_policies_improvement_when_pred_closer(pathlib.Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_evaluate_policies_low_coverage_is_caveat(pathlib.Path(d))
    print("[OK] evaluate_policies 提升量 + 覆盖率 caveat")
    print("\n全部 fact_eval 测试通过")


if __name__ == "__main__":
    main()
