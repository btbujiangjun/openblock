"""spawnTargets / PB θ 分布漂移监控（PSI）。

用途
----
SpawnPolicyNet 是行为克隆：它假设服务期看到的 behaviorContext 分布 ≈ 训练集分布。
当 L2 `SpawnParamTuner` 换了一组 θ（或玩家群体变化）时，behaviorContext 的 spawnTargets 段
（[38:44]，由 PB 曲线 θ 调制）会漂移到模型没训过的区域 → OOD 外推 → 出块质量退化。

本模块在「重训 / 部署前」对比参考集（训练集）与线上 / holdout 集的分布漂移，作为
L2→L1-Net 耦合的安全护栏；配合 v1.61.0 的「4 维 PB θ 显式条件输入」一起使用：
  - 显式 θ 条件：让模型有机会对 θ 泛化（治本）；
  - 漂移监控：当漂移仍超阈值时报警 / 阻断部署，提示重训（兜底）。

PSI（Population Stability Index），按参考集分位分箱：
    PSI = Σ_bin (live% − ref%) · ln(live% / ref%)
经验阈值：<0.10 稳定；0.10~0.25 中度漂移（关注）；≥0.25 显著漂移（建议重训）。
"""

from __future__ import annotations

import numpy as np

# behaviorContext 中各特征段索引（必须与 dataset._parse_behavior_context 对齐）。
SPAWN_TARGETS_SLICE = (38, 44)
SPAWN_TARGETS_LABELS = [
    'shapeComplexity', 'solutionSpacePressure', 'clearOpportunity',
    'spatialPressure', 'payoffIntensity', 'novelty',
]
PB_THETA_SLICE = (57, 61)
PB_THETA_LABELS = ['pbTensionCenter', 'pbTensionWidth', 'pbBrakeCenter', 'pbBrakeWidth']

DRIFT_WARN = 0.10
DRIFT_ALARM = 0.25


def population_stability_index(ref, live, bins: int = 10, eps: float = 1e-6) -> float:
    """单特征 PSI；分箱边界来自参考集分位。两分布相同 → 0。"""
    ref = np.asarray(ref, dtype=np.float64).ravel()
    live = np.asarray(live, dtype=np.float64).ravel()
    if ref.size == 0 or live.size == 0:
        return 0.0

    edges = np.unique(np.quantile(ref, np.linspace(0.0, 1.0, bins + 1)))
    if edges.size < 2:
        # 参考集为常数列（如单一 θ-regime）：live 仍基本等于该常数 → 无漂移；
        # 明显偏离 → 显著漂移。atol=1e-3 容忍 float16 参考画像的舍入误差（归一化特征量级 ~1）。
        return 0.0 if np.allclose(live, ref[0], atol=1e-3) else float('inf')
    edges[0], edges[-1] = -np.inf, np.inf

    ref_hist = np.histogram(ref, bins=edges)[0] / ref.size
    live_hist = np.histogram(live, bins=edges)[0] / live.size
    ref_pct = np.clip(ref_hist, eps, None)
    live_pct = np.clip(live_hist, eps, None)
    return float(np.sum((live_pct - ref_pct) * np.log(live_pct / ref_pct)))


def _slice(contexts, sl):
    arr = np.asarray(contexts, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError("contexts 必须是 (N, D) 矩阵")
    if arr.shape[1] < sl[1]:
        raise ValueError(f"contexts 维度 {arr.shape[1]} < 所需 {sl[1]}")
    return arr[:, sl[0]:sl[1]]


def feature_drift(ref_contexts, live_contexts, sl, labels, bins: int = 10) -> dict:
    """逐特征 PSI；返回 {label: psi}。"""
    ref = _slice(ref_contexts, sl)
    live = _slice(live_contexts, sl)
    return {
        name: population_stability_index(ref[:, i], live[:, i], bins=bins)
        for i, name in enumerate(labels)
    }


def spawn_targets_drift(ref_contexts, live_contexts, bins: int = 10) -> dict:
    return feature_drift(ref_contexts, live_contexts, SPAWN_TARGETS_SLICE, SPAWN_TARGETS_LABELS, bins)


def pb_theta_drift(ref_contexts, live_contexts, bins: int = 10) -> dict:
    return feature_drift(ref_contexts, live_contexts, PB_THETA_SLICE, PB_THETA_LABELS, bins)


def summarize_drift(drift: dict) -> dict:
    """聚合：max / argmax / 级别（stable|warn|alarm）。"""
    if not drift:
        return {"max": 0.0, "argmax": None, "level": "stable", "per_feature": {}}
    argmax = max(drift, key=lambda k: drift[k])
    mx = float(drift[argmax])
    level = "alarm" if mx >= DRIFT_ALARM else ("warn" if mx >= DRIFT_WARN else "stable")
    return {"max": mx, "argmax": argmax, "level": level, "per_feature": drift}


def assert_spawn_targets_drift(ref_contexts, live_contexts, threshold: float = DRIFT_ALARM, bins: int = 10) -> dict:
    """spawnTargets 漂移超阈值则抛 AssertionError（用于部署门禁 / CI）。"""
    summary = summarize_drift(spawn_targets_drift(ref_contexts, live_contexts, bins))
    if summary["max"] >= threshold:
        raise AssertionError(
            f"spawnTargets 分布漂移过大：{summary['argmax']} PSI={summary['max']:.3f} ≥ {threshold}；"
            f"建议在当前 θ/玩家分布下重训 SpawnPolicyNet。明细={summary['per_feature']}"
        )
    return summary


# ---------------------------------------------------------------------------
# 训练期参考画像 + 服务期对照（baked-in reference）
# ---------------------------------------------------------------------------
REFERENCE_MAX_ROWS = 2000


def build_drift_reference(contexts, max_rows: int = REFERENCE_MAX_ROWS, seed: int = 0) -> dict:
    """从训练集 behaviorContext 抽取紧凑参考画像，存入 checkpoint 供服务期对照。

    仅保留 spawnTargets[38:44] 与 PB θ[57:61] 两段（float16，最多 max_rows 行）。
    """
    arr = np.asarray(contexts, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError("contexts 必须是 (N, D) 矩阵")
    st = _slice(arr, SPAWN_TARGETS_SLICE)
    th = (_slice(arr, PB_THETA_SLICE) if arr.shape[1] >= PB_THETA_SLICE[1]
          else np.zeros((arr.shape[0], len(PB_THETA_LABELS)), dtype=np.float32))
    n = arr.shape[0]
    if n > max_rows:
        idx = np.random.default_rng(seed).choice(n, size=max_rows, replace=False)
        st, th = st[idx], th[idx]
    return {
        "spawn_targets": st.astype(np.float16),
        "pb_theta": th.astype(np.float16),
        "n": int(n),
    }


def check_against_reference(reference: dict, live_contexts, threshold: float = DRIFT_ALARM, bins: int = 10) -> dict:
    """用 baked-in 参考画像对照线上 behaviorContext，返回 {spawn_targets, pb_theta, passed}。"""
    live = np.asarray(live_contexts, dtype=np.float64)
    if live.ndim != 2:
        raise ValueError("live_contexts 必须是 (N, D) 矩阵")

    ref_st = np.asarray(reference["spawn_targets"], dtype=np.float64)
    live_st = _slice(live, SPAWN_TARGETS_SLICE)
    st_drift = {
        SPAWN_TARGETS_LABELS[i]: population_stability_index(ref_st[:, i], live_st[:, i], bins)
        for i in range(len(SPAWN_TARGETS_LABELS))
    }
    result = {"spawn_targets": summarize_drift(st_drift)}

    if reference.get("pb_theta") is not None and live.shape[1] >= PB_THETA_SLICE[1]:
        ref_th = np.asarray(reference["pb_theta"], dtype=np.float64)
        live_th = _slice(live, PB_THETA_SLICE)
        th_drift = {
            PB_THETA_LABELS[i]: population_stability_index(ref_th[:, i], live_th[:, i], bins)
            for i in range(len(PB_THETA_LABELS))
        }
        result["pb_theta"] = summarize_drift(th_drift)

    result["passed"] = bool(result["spawn_targets"]["max"] < threshold)
    return result
