"""
Feature I/O — 从 SQLite spawn_tuning_samples_v2 读取样本并编码为张量。

数据流:
    SQLite rows (run_id) → DataFrame → Tensor (theta, context_idx, log_best, target)
"""

import json
import math
import sqlite3
from typing import Tuple

import numpy as np
import torch

from .surrogate_model import DIFFICULTIES, GENERATORS, LIFECYCLE_STAGES


# 与 web/src/tuning/paramSpace.js PARAM_KEYS 保持顺序一致
PARAM_KEYS = [
    "personalizationStrength",
    "temperature",
    "surpriseBudgetGain",
    "surpriseCooldown",
    "maxEvaluatedTriplets",
    "ssp_brakeCoef",
    "sp_tensionCoef",
    "sp_brakeCoef",
    "payoff_brakeCoef",
    "clearOpp_brakeCoef",
    "tensionCenter",
    "tensionSlope",
    "brakeCenter",
    "brakeSlope",
]

# 与 paramSpace.js 一致的归一化区间 (low, high)
PARAM_RANGES = {
    "personalizationStrength": (0.05, 0.18),
    "temperature": (0.03, 0.08),
    "surpriseBudgetGain": (0.05, 0.10),
    "surpriseCooldown": (4, 10),
    "maxEvaluatedTriplets": (32, 128),  # choice 视为 minmax 之间
    "ssp_brakeCoef": (0.08, 0.16),
    "sp_tensionCoef": (0.08, 0.16),
    "sp_brakeCoef": (0.12, 0.20),
    "payoff_brakeCoef": (0.10, 0.22),
    "clearOpp_brakeCoef": (0.06, 0.14),
    "tensionCenter": (0.78, 0.86),
    "tensionSlope": (0.06, 0.12),
    "brakeCenter": (1.02, 1.10),
    "brakeSlope": (0.04, 0.08),
}

# bestScore log10 归一化用的均值/方差 (固定锚点,避免训练集偏移)
LOG_BEST_MEAN = math.log10(2000.0)  # 与 objective.js 的 sigmoid center 一致
LOG_BEST_STD = 0.5                  # 覆盖 ~ 500 到 25000 一个 std 内


def encode_theta(theta_dict: dict) -> np.ndarray:
    """归一化 θ 到 [0, 1]^14。"""
    out = np.zeros(len(PARAM_KEYS), dtype=np.float32)
    for i, key in enumerate(PARAM_KEYS):
        if key not in theta_dict:
            raise KeyError(f"theta missing: {key}")
        low, high = PARAM_RANGES[key]
        v = float(theta_dict[key])
        out[i] = (v - low) / (high - low) if high > low else 0.0
    return np.clip(out, 0, 1)


def encode_log_best(best_score: float) -> float:
    """log10(bestScore) z-score。"""
    return (math.log10(max(1.0, best_score)) - LOG_BEST_MEAN) / LOG_BEST_STD


def context_to_idx(difficulty: str, generator: str, lifecycle: str) -> Tuple[int, int, int]:
    """把字符串 context 转 embedding 索引。"""
    return (
        DIFFICULTIES.index(difficulty),
        GENERATORS.index(generator),
        LIFECYCLE_STAGES.index(lifecycle),
    )


def load_samples_from_sqlite(db_path: str, run_id: int) -> dict:
    """读 SQLite,返回训练用的 torch.Tensor 字典。

    返回:
        {
            "theta": [N, 14],
            "diff_idx": [N],
            "gen_idx": [N],
            "life_idx": [N],
            "log_best": [N, 1],
            "target": [N, 3],
            "n": N,
            "raw_records": [...],  # 原始字典列表,便于调试
        }
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT theta_json, difficulty, generator, bestScore_bin, lifecycle_stage,
               fairness_score, excitement_score, antiInflation_score
        FROM spawn_tuning_samples_v2
        WHERE run_id = ?
        """,
        (run_id,),
    ).fetchall()
    conn.close()

    if not rows:
        raise ValueError(f"no samples found for run_id={run_id}")

    n = len(rows)
    theta_arr = np.zeros((n, len(PARAM_KEYS)), dtype=np.float32)
    diff_idx = np.zeros(n, dtype=np.int64)
    gen_idx = np.zeros(n, dtype=np.int64)
    life_idx = np.zeros(n, dtype=np.int64)
    log_best = np.zeros((n, 1), dtype=np.float32)
    target = np.zeros((n, 3), dtype=np.float32)
    raw = []

    for i, r in enumerate(rows):
        theta = json.loads(r["theta_json"])
        theta_arr[i] = encode_theta(theta)
        d, g, l = context_to_idx(r["difficulty"], r["generator"], r["lifecycle_stage"])
        diff_idx[i] = d
        gen_idx[i] = g
        life_idx[i] = l
        log_best[i, 0] = encode_log_best(r["bestScore_bin"])
        target[i] = [r["fairness_score"], r["excitement_score"], r["antiInflation_score"]]
        raw.append(dict(r))

    return {
        "theta": torch.from_numpy(theta_arr),
        "diff_idx": torch.from_numpy(diff_idx),
        "gen_idx": torch.from_numpy(gen_idx),
        "life_idx": torch.from_numpy(life_idx),
        "log_best": torch.from_numpy(log_best),
        "target": torch.from_numpy(target),
        "n": n,
        "raw_records": raw,
    }


def decode_theta(theta_norm: np.ndarray) -> dict:
    """把 [0, 1]^14 反归一化回 θ 字典 (对应 paramSpace.vectorToTheta)。"""
    if len(theta_norm) != len(PARAM_KEYS):
        raise ValueError(f"expected {len(PARAM_KEYS)}-d, got {len(theta_norm)}")
    out = {}
    for i, key in enumerate(PARAM_KEYS):
        low, high = PARAM_RANGES[key]
        v = low + float(theta_norm[i]) * (high - low)
        if key in ("surpriseCooldown",):
            v = int(round(v))
        elif key == "maxEvaluatedTriplets":
            # 投到最近的 choice
            choices = [32, 48, 64, 80, 96, 128]
            v = min(choices, key=lambda c: abs(c - v))
        out[key] = v
    return out
