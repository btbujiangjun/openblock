"""SQLite ↔ PyTorch Tensor 双向桥接。

约定:
  - samples 表保存原始字段, theta_json / d_curve_json 为 JSON 字符串
  - 模型输入需要的整数索引在这里集中映射 (与 model.py 保持一致)
"""
from __future__ import annotations
import json
import math
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np


# ─────────── 索引映射 (必须与 schema CHECK 一致) ───────────

DIFFICULTY_INDEX = {"easy": 0, "normal": 1, "hard": 2}
GENERATOR_INDEX = {"triplet-p1": 0, "budget-p2": 1}
BOT_INDEX = {"random": 0, "clear-greedy": 1, "survival": 2}
PB_BIN_INDEX = {500: 0, 1500: 1, 4000: 2, 10000: 3, 25000: 4}
LIFECYCLE_INDEX = {"onboarding": 0, "growth": 1, "mature": 2, "plateau": 3}

# θ 参数顺序 (9 维, 与 model.py 的 N_THETA 一致)
#
# v2.2: 把 adaptiveSpawn.js 里 PB 双 S 曲线的 4 个硬编码常数提到 modelConfig
#       (DEFAULT_SPAWN_PARAMS_PB_CURVE in adaptiveSpawn.js), 现在它们也是真实生效的 θ。
# v2.1: 原 14 维收缩到 5 维 (剔除 9 个装饰性参数)。
#
# 所有 θ 必须满足: simulator/adaptiveSpawn/spawnExperiments 中至少有 1 处真实消费。
#
THETA_KEYS = [
    # ─ 组 A: 个性化 + 选拔 (5 个, samplerV2 → simulator.modelConfig → spawnExperiments)
    "personalizationStrength",   # 把 playerProfile 信号注入候选权重
    "temperature",                # 候选选拔时的随机温度
    "surpriseBudgetGain",         # 惊喜事件触发增益
    "surpriseCooldown",           # 惊喜事件冷却轮数
    "maxEvaluatedTriplets",       # 三块组合最大评估数 (推理预算)
    # ─ 组 B: PB 双 S 曲线 (4 个, samplerV2 → simulator.modelConfig → derivePbCurve)
    "pbTensionCenter",            # 张力 sigmoid 拐点 (玩家接近 PB 多少时开始增加难度)
    "pbTensionWidth",             # 张力斜率宽度 (越小越陡)
    "pbBrakeCenter",              # 刹车 sigmoid 拐点 (超 PB 多少倍后强力压制 payoff)
    "pbBrakeWidth",               # 刹车斜率宽度
]

# 各参数的 (min, max) 用于 min-max 归一化
# 注: PB 曲线参数的默认 (中点) ≈ DEFAULT_SPAWN_PARAMS_PB_CURVE in adaptiveSpawn.js
THETA_RANGES = {
    "personalizationStrength": (0.05, 0.18),
    "temperature": (0.03, 0.08),
    "surpriseBudgetGain": (0.05, 0.10),
    "surpriseCooldown": (4.0, 10.0),
    "maxEvaluatedTriplets": (32.0, 128.0),
    "pbTensionCenter": (0.70, 0.92),    # default 0.82
    "pbTensionWidth":  (0.04, 0.15),    # default 0.08 (越小越陡)
    "pbBrakeCenter":   (0.98, 1.15),    # default 1.05
    "pbBrakeWidth":    (0.03, 0.12),    # default 0.06
}


def normalize_theta(theta_dict: Dict[str, float]) -> np.ndarray:
    """θ dict → (14,) numpy [0, 1]"""
    out = np.zeros(len(THETA_KEYS), dtype=np.float32)
    for i, k in enumerate(THETA_KEYS):
        v = float(theta_dict.get(k, sum(THETA_RANGES[k]) / 2))  # 缺失填中点
        lo, hi = THETA_RANGES[k]
        out[i] = (v - lo) / max(1e-9, hi - lo)
        out[i] = max(0.0, min(1.0, out[i]))
    return out


def denormalize_theta(theta_norm: np.ndarray) -> Dict[str, float]:
    """(14,) numpy [0, 1] → θ dict"""
    out: Dict[str, float] = {}
    for i, k in enumerate(THETA_KEYS):
        lo, hi = THETA_RANGES[k]
        out[k] = float(theta_norm[i] * (hi - lo) + lo)
    return out


# ─────────── DataLoader ───────────

class SamplesDataset:
    """从 SQLite 加载 samples → numpy 数组的简单 Dataset。

    用法:
        ds = SamplesDataset.from_sqlite(db_path, set_ids=[1, 2, 3])
        x, y = ds[0]  # 单样本
        len(ds)        # 样本总数
    """

    def __init__(
        self,
        difficulty_idx: np.ndarray,
        generator_idx: np.ndarray,
        bot_idx: np.ndarray,
        pb_bin_idx: np.ndarray,
        lifecycle_idx: np.ndarray,
        log_pb: np.ndarray,
        theta_norm: np.ndarray,
        # 标签
        d_curve: np.ndarray,
        pb_broke: np.ndarray,
        noMove_norm: np.ndarray,
        log_score: np.ndarray,
        survival: np.ndarray,
    ):
        self.difficulty_idx = difficulty_idx
        self.generator_idx = generator_idx
        self.bot_idx = bot_idx
        self.pb_bin_idx = pb_bin_idx
        self.lifecycle_idx = lifecycle_idx
        self.log_pb = log_pb
        self.theta_norm = theta_norm
        self.d_curve = d_curve
        self.pb_broke = pb_broke
        self.noMove_norm = noMove_norm
        self.log_score = log_score
        self.survival = survival

    def __len__(self) -> int:
        return self.difficulty_idx.shape[0]

    @classmethod
    def from_sqlite(
        cls,
        db_path: str | Path,
        set_ids: Sequence[int],
        max_score: float = 100_000.0,
        max_survived_steps: int = 1_000,
    ) -> "SamplesDataset":
        """从 SQLite 加载多个 sample_set 的全部样本。

        Args:
            db_path:         SQLite 文件路径
            set_ids:         样本集 ID 列表 (支持 union)
            max_score:       log_score 归一化用的上界
            max_survived_steps: noMove_step 归一化用的上界
        """
        if not set_ids:
            raise ValueError("set_ids cannot be empty")
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        placeholders = ",".join("?" * len(set_ids))
        rows = conn.execute(
            f"""
            SELECT difficulty, generator, bot_policy, pb_bin, lifecycle_stage,
                   theta_json, d_curve_json,
                   final_score, survived_steps, clear_rate, noMove_step, pb_broke
            FROM samples
            WHERE set_id IN ({placeholders})
            """,
            tuple(set_ids),
        ).fetchall()
        conn.close()

        n = len(rows)
        if n == 0:
            raise ValueError(f"no samples found in sets {list(set_ids)}")

        diff = np.zeros(n, dtype=np.int64)
        gen = np.zeros(n, dtype=np.int64)
        bot = np.zeros(n, dtype=np.int64)
        pb_b = np.zeros(n, dtype=np.int64)
        life = np.zeros(n, dtype=np.int64)
        log_pb = np.zeros(n, dtype=np.float32)
        theta = np.zeros((n, len(THETA_KEYS)), dtype=np.float32)  # (n, N_THETA=5)
        d_curve = np.zeros((n, 20), dtype=np.float32)
        pb_broke = np.zeros(n, dtype=np.float32)
        noMove_norm = np.zeros(n, dtype=np.float32)
        log_score = np.zeros(n, dtype=np.float32)
        survival = np.zeros(n, dtype=np.float32)

        for i, r in enumerate(rows):
            diff[i] = DIFFICULTY_INDEX[r["difficulty"]]
            gen[i] = GENERATOR_INDEX[r["generator"]]
            bot[i] = BOT_INDEX[r["bot_policy"]]
            pb_b[i] = PB_BIN_INDEX[r["pb_bin"]]
            life[i] = LIFECYCLE_INDEX[r["lifecycle_stage"]]
            log_pb[i] = math.log10(max(1.0, float(r["pb_bin"])))
            theta[i] = normalize_theta(json.loads(r["theta_json"]))
            curve = json.loads(r["d_curve_json"])
            if len(curve) != 20:
                # 容错: 长度不对则填充/截断
                curve = (list(curve) + [curve[-1] if curve else 0.5] * 20)[:20]
            d_curve[i] = np.array(curve, dtype=np.float32)
            pb_broke[i] = float(r["pb_broke"] or 0)
            # noMove_step ∈ [-1, max_steps]; -1=未死局 → 1.0 (满步存活), 否则归一化
            n_step = r["noMove_step"]
            if n_step is None or n_step < 0:
                noMove_norm[i] = 1.0  # 未死局
            else:
                noMove_norm[i] = min(1.0, float(n_step) / max_survived_steps)
            log_score[i] = math.log10(max(1.0, float(r["final_score"] or 1.0)))
            survival[i] = 1.0 if (r["noMove_step"] is None or r["noMove_step"] < 0) else 0.0

        # log_pb z-score (用样本内统计)
        if log_pb.std() > 1e-9:
            log_pb = (log_pb - log_pb.mean()) / log_pb.std()

        return cls(
            difficulty_idx=diff,
            generator_idx=gen,
            bot_idx=bot,
            pb_bin_idx=pb_b,
            lifecycle_idx=life,
            log_pb=log_pb,
            theta_norm=theta,
            d_curve=d_curve,
            pb_broke=pb_broke,
            noMove_norm=noMove_norm,
            log_score=log_score,
            survival=survival,
        )

    def train_val_split(
        self, val_ratio: float = 0.1, seed: int = 42
    ) -> Tuple["SamplesDataset", "SamplesDataset"]:
        """随机切分 train / val。"""
        n = len(self)
        rng = np.random.RandomState(seed)
        indices = rng.permutation(n)
        n_val = max(1, int(n * val_ratio))
        val_idx = indices[:n_val]
        train_idx = indices[n_val:]
        return self._index(train_idx), self._index(val_idx)

    def _index(self, idx: np.ndarray) -> "SamplesDataset":
        return SamplesDataset(
            difficulty_idx=self.difficulty_idx[idx],
            generator_idx=self.generator_idx[idx],
            bot_idx=self.bot_idx[idx],
            pb_bin_idx=self.pb_bin_idx[idx],
            lifecycle_idx=self.lifecycle_idx[idx],
            log_pb=self.log_pb[idx],
            theta_norm=self.theta_norm[idx],
            d_curve=self.d_curve[idx],
            pb_broke=self.pb_broke[idx],
            noMove_norm=self.noMove_norm[idx],
            log_score=self.log_score[idx],
            survival=self.survival[idx],
        )

    def iter_batches(self, batch_size: int = 256, shuffle: bool = True, seed: int = 0):
        """生成 mini-batch 的 dict (numpy)。"""
        n = len(self)
        if shuffle:
            rng = np.random.RandomState(seed)
            order = rng.permutation(n)
        else:
            order = np.arange(n)
        for start in range(0, n, batch_size):
            idx = order[start:start + batch_size]
            yield {
                "difficulty_idx": self.difficulty_idx[idx],
                "generator_idx": self.generator_idx[idx],
                "bot_idx": self.bot_idx[idx],
                "pb_bin_idx": self.pb_bin_idx[idx],
                "lifecycle_idx": self.lifecycle_idx[idx],
                "log_pb": self.log_pb[idx],
                "theta_norm": self.theta_norm[idx],
                "d_curve": self.d_curve[idx],
                "pb_broke": self.pb_broke[idx],
                "noMove": self.noMove_norm[idx],
                "score": self.log_score[idx],
                "survival": self.survival[idx],
            }


# ─────────── 模型持久化 ───────────

def save_model_record(
    db_path: str | Path,
    name: str,
    model_type: str,
    weights_path: str,
    sha256: str,
    size_bytes: int,
    metrics: Dict[str, float],
    train_job_id: Optional[int] = None,
    parent_model_id: Optional[int] = None,
    version: str = "v0.0.1",
    tags: str = "",
) -> int:
    """写入 models 表, 返回 model_id。"""
    import time
    conn = sqlite3.connect(str(db_path))
    cur = conn.execute(
        """
        INSERT INTO models (
            name, version, model_type, weights_path, sha256, size_bytes,
            parent_model_id, train_job_id, metrics_json, status, tags, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?)
        """,
        (name, version, model_type, weights_path, sha256, size_bytes,
         parent_model_id, train_job_id, json.dumps(metrics), tags, int(time.time())),
    )
    model_id = cur.lastrowid
    conn.commit()
    conn.close()
    return model_id
