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

# v3.0.8: GENERATOR 与游戏页面 getSpawnPolicyMode() 1:1 严格对齐 (无 alias / 无历史枚举).
#   - 'rule'       = 启发式 — game.js _commitSpawn 走规则路径
#                    + θ 来自 deployed bundle (有则用) / DEFAULT_THETA_V2 (无 bundle)
#   - 'generative' = 生成式 — game.js _spawnBlocksWithModel 调 SpawnPolicyNet
GENERATOR_INDEX = {"rule": 0, "generative": 1}

BOT_INDEX = {"random": 0, "clear-greedy": 1, "survival": 2, "rl-bot": 3}
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
    # ─ A. 候选选拔 / 个性化 (5)
    "personalizationStrength",     # playerProfile 信号注入候选权重
    "temperature",                  # 候选选拔随机温度
    "surpriseBudgetGain",           # 惊喜事件触发增益
    "surpriseCooldown",             # 惊喜事件冷却轮数
    "maxEvaluatedTriplets",         # 三块组合最大评估数
    # ─ B. PB 双 S 曲线 (4)
    "pbTensionCenter",              # 张力 sigmoid 拐点
    "pbTensionWidth",               # 张力斜率宽度
    "pbBrakeCenter",                # 刹车 sigmoid 拐点
    "pbBrakeWidth",                 # 刹车斜率宽度
    # ─ C. augmentPool 乘性加权 (8, blockSpawn.js generateDockShapes)
    "perfectClearWeight",           # 清屏潜力倍率
    "multiClearBaseFactor",         # 多消基础倍率系数
    "nearFullFactor",               # 临消行倍率系数
    "exactFitBonus",                # 完美卡入加权斜率
    "monoFlushBoost",               # 同花顺基础加权
    "payoffWeight",                 # payoff 阶段加权
    "sizePreferenceGain",           # sizePref 加权斜率
    "diversityPenalty",             # 品类多样性惩罚强度
    # ─ D. deriveSpawnTargets 翻译矩阵 (5, adaptiveSpawn.js)
    "complexityFromStress",         # stress → shapeComplexity 系数
    "complexityRiskRelief",         # riskRelief → shapeComplexity 系数 (负向)
    "solutionFromStress",           # stress → solutionSpacePressure 系数
    "pbTensionTargetWeight",        # PB 张力对 6 类目标的调制力度
    "pbBrakeTargetWeight",          # 超 PB 段对目标的二次拐弯
    # ─ E. PB 段细节弯折 (5, adaptiveSpawn.js)
    "challengeBoostSlope",          # 追 PB 加压斜率
    "challengeBoostCap",            # 追 PB 加压上限
    "pbOvershootMax",               # 超 PB 后对数加压幅度
    "releaseFactor",                # 破 PB 释放窗口 stress 衰减
    "farFromPBBoost",               # D0 远征段送爽强度
]

# 各参数的 (min, max) — min-max 归一化用
# 所有 θ 必须在 simulator/adaptiveSpawn/blockSpawn 至少一处真实消费
THETA_RANGES = {
    # A
    "personalizationStrength": (0.05, 0.18),
    "temperature":             (0.03, 0.08),
    "surpriseBudgetGain":      (0.05, 0.10),
    "surpriseCooldown":        (4.0, 10.0),
    "maxEvaluatedTriplets":    (32.0, 128.0),
    # B
    "pbTensionCenter":         (0.70, 0.92),    # default 0.82
    "pbTensionWidth":          (0.04, 0.15),    # default 0.08
    "pbBrakeCenter":           (0.98, 1.15),    # default 1.05
    "pbBrakeWidth":            (0.03, 0.12),    # default 0.06
    # C
    "perfectClearWeight":      (15.0, 40.0),    # default 25.0
    "multiClearBaseFactor":    (0.4, 0.8),      # default 0.6
    "nearFullFactor":          (1.5, 2.5),      # default 2.0
    "exactFitBonus":           (1.2, 2.0),      # default 1.5
    "monoFlushBoost":          (0.2, 0.8),      # default 0.4
    "payoffWeight":            (1.2, 2.0),      # default 1.7
    "sizePreferenceGain":      (1.2, 2.0),      # default 1.5
    "diversityPenalty":        (0.5, 1.8),      # default 1.0
    # D
    "complexityFromStress":    (0.5, 1.0),      # default 0.75
    "complexityRiskRelief":    (-0.7, -0.2),    # default -0.45 (负向)
    "solutionFromStress":      (0.5, 1.0),      # default 0.7
    "pbTensionTargetWeight":   (0.05, 0.20),    # default 0.10
    "pbBrakeTargetWeight":     (0.05, 0.20),    # default 0.10
    # E
    "challengeBoostSlope":     (0.5, 1.0),      # default 0.75
    "challengeBoostCap":       (0.12, 0.25),    # default 0.18
    "pbOvershootMax":          (0.10, 0.22),    # default 0.16
    "releaseFactor":           (0.5, 0.85),     # default 0.7
    "farFromPBBoost":          (0.30, 0.60),    # default 0.45
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
        # v2.10.32 (P0.2): 逐 bin 真实观察数 (n, 20). 全 0 表示老样本 (无此数据), 训练时退化为均匀 weight=1
        bin_counts: np.ndarray | None = None,
        # v2.10.32 (P2.2): score/pb 比值 — multi-task 模型用作辅助 label
        r_value: np.ndarray | None = None,
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
        # bin_counts 默认全 0 (退化), 长度 n×20
        n = difficulty_idx.shape[0]
        self.bin_counts = bin_counts if bin_counts is not None else np.zeros((n, 20), dtype=np.float32)
        self.r_value = r_value if r_value is not None else np.zeros(n, dtype=np.float32)

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
        # v2.10.32 (P0.2): 加载 bin_counts_json + n_bins_filled (P2.2: final_score/pb_bin)
        rows = conn.execute(
            f"""
            SELECT difficulty, generator, bot_policy, pb_bin, lifecycle_stage,
                   theta_json, d_curve_json,
                   final_score, survived_steps, clear_rate, noMove_step, pb_broke,
                   bin_counts_json, n_bins_filled
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
        bin_counts = np.zeros((n, 20), dtype=np.float32)   # v2.10.32 (P0.2)
        r_value = np.zeros(n, dtype=np.float32)            # v2.10.32 (P2.2): score/pb

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
                curve = (list(curve) + [curve[-1] if curve else 0.5] * 20)[:20]
            d_curve[i] = np.array(curve, dtype=np.float32)
            pb_broke[i] = float(r["pb_broke"] or 0)
            n_step = r["noMove_step"]
            if n_step is None or n_step < 0:
                noMove_norm[i] = 1.0
            else:
                noMove_norm[i] = min(1.0, float(n_step) / max_survived_steps)
            log_score[i] = math.log10(max(1.0, float(r["final_score"] or 1.0)))
            survival[i] = 1.0 if (r["noMove_step"] is None or r["noMove_step"] < 0) else 0.0
            # v2.10.32 (P0.2): bin_counts_json 字段可能不存在 (老样本) 或为 None
            try:
                bc_json = r["bin_counts_json"]
            except (KeyError, IndexError):
                bc_json = None
            if bc_json:
                try:
                    bc_list = json.loads(bc_json)
                    if len(bc_list) == 20:
                        bin_counts[i] = np.array(bc_list, dtype=np.float32)
                except (ValueError, TypeError):
                    pass
            # v2.10.32 (P2.2): r = final_score / pb_bin, 用于 multi-task 辅助 head
            pb_val = float(r["pb_bin"]) if r["pb_bin"] else 1.0
            fs = float(r["final_score"] or 0.0)
            r_value[i] = min(2.0, fs / pb_val) if pb_val > 0 else 0.0

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
            bin_counts=bin_counts,
            r_value=r_value,
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
            bin_counts=self.bin_counts[idx],
            r_value=self.r_value[idx],
        )

    def _compute_ctx_id(self, idx: np.ndarray) -> np.ndarray:
        """v3.0.19: 把 5 维 ctx 编码成单个整数 id, 用于 loss_theta_diversity 内的 group-by.

        编码: (((diff * 2 + gen) * 4 + bot) * 5 + pb_bin) * 4 + lifecycle
        容量 = 3 * 2 * 4 * 5 * 4 = 480 (远小于 int64 上限)
        """
        return (
            (((self.difficulty_idx[idx].astype(np.int64) * 2
               + self.generator_idx[idx].astype(np.int64)) * 4
              + self.bot_idx[idx].astype(np.int64)) * 5
             + self.pb_bin_idx[idx].astype(np.int64)) * 4
            + self.lifecycle_idx[idx].astype(np.int64)
        )

    def iter_batches(
        self,
        batch_size: int = 256,
        shuffle: bool = True,
        seed: int = 0,
        # v3.0.19: 同 ctx 的 sample 至少要在一个 batch 内出现 ≥2 次, 否则 L_theta_diversity 永远 0.
        #   通过 group-aware shuffle 保证每 batch 内同 ctx 的 sample 聚簇出现.
        group_aware_batch: bool = True,
    ):
        """生成 mini-batch 的 dict (numpy)。

        v3.0.19: group_aware_batch=True 时, 按 ctx_id 对样本排序后再 chunk,
            保证 batch 内同 ctx 至少有 2-3 个 sample (供 L_theta_diversity 计算方差).
            打散方式: 仍 shuffle batch 之间的顺序, 仅在 batch 内保持 ctx 聚簇.
        """
        n = len(self)
        rng = np.random.RandomState(seed)
        if group_aware_batch:
            # 1) 先算所有 ctx_id, 把 idx 按 ctx_id 排序 → 同 ctx 邻近
            all_ctx_id = self._compute_ctx_id(np.arange(n))
            # 加 random tie-breaker, 同 ctx 内 sample 仍随机
            tie = rng.rand(n)
            order = np.lexsort((tie, all_ctx_id))
            # 2) chunk 成 batches, 然后打乱 batch 之间的顺序
            batches = [order[start:start + batch_size] for start in range(0, n, batch_size)]
            if shuffle:
                batch_order = rng.permutation(len(batches))
                batches = [batches[i] for i in batch_order]
            for idx in batches:
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
                    "bin_counts": self.bin_counts[idx],
                    "r_value": self.r_value[idx],
                    "ctx_id": self._compute_ctx_id(idx),
                }
            return

        if shuffle:
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
                "bin_counts": self.bin_counts[idx],
                "r_value": self.r_value[idx],
                "ctx_id": self._compute_ctx_id(idx),
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
