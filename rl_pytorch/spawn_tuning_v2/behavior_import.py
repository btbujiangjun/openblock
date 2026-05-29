"""玩家真实行为 → v2 寻参样本(samples)转换器。

设计动机
========
v2 寻参样本历来只有「构造样本」(bot 自博弈 + θ 扫描, samplerV2.js 产出)。
玩家真实对局(move_sequences / spawn_dataset_samples)本质上也是「同一种样本」——
只是数据来源不同:一类是构造的、一类是真人打的。把真人对局整理成与构造样本
**完全相同的 schema**(5 维 context + θ + 20 维 d_curve + 辅助标签),即可作为
普通数据集与构造样本一起进 v2 训练/评估管线。

口径一致性
==========
d_curve 的逐步难度公式直接复用 `extractor.extract_d_curve`(与 samplerV2.js /
policyMetricsV2.js 跨语言一致, 由 test_cross_lang_dcurve 钉死):
    state_d = 0.30*fillRate + 0.50*(1-actionFreedom) + 0.20*trend
    d_step  = (1-0.40)*state_d + 0.40*sigmoid((r-θc)/θw)        # r = score/PB
其中 θc/θw 取该局**实际生效**的 pbCurveParams(从帧 ps.adaptive 读), 与真人当时
体验的难度曲线一致。

字段来源(真人局)
==================
  difficulty       帧/会话, 缺省 'normal'
  generator        spawn provenance.spawnSource: 'model-v3' → 'generative' 否则 'rule'
  bot_policy       真人占位(默认 'clear-greedy', 可配); v2 schema 无 'human' 枚举
  pb_bin           _v2_pb_bin(pb) 最近邻分档
  lifecycle_stage  totalRounds 规则(<5 onboarding / <30 growth / <100 mature / else plateau)
  theta_json       DEFAULT_THETA 叠加该局实际 pbCurveParams(4 维)
  d_curve_json     逐 place 帧轨迹 → extract_d_curve
  action_freedom   由帧内 grid(cells) + dock(shapes) 回放合法落子数 / 64 估计
                   (action_freedom 未落库, 此处从盘面重算; 同一三元组内按剩余件数递减)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

from .extractor import extract_d_curve, StepInfo
from .target_curve import CURVE_N_BINS, CURVE_R_MAX, r_to_bin

GRID_SIZE = 8
TOTAL_CELLS = GRID_SIZE * GRID_SIZE  # 64, action_freedom 归一化分母(与 samplerV2 一致)
PB_BINS = [500, 1500, 4000, 10000, 25000]

# 27 维 θ 默认值(= THETA_RANGES 注释里的 hand-tuned 默认, 与 clientPolicyV2.DEFAULT_THETA_V2 对齐)
DEFAULT_THETA: Dict[str, float] = {
    "personalizationStrength": 0.12, "temperature": 0.05, "surpriseBudgetGain": 0.07,
    "surpriseCooldown": 6.0, "maxEvaluatedTriplets": 64.0,
    "pbTensionCenter": 0.82, "pbTensionWidth": 0.08, "pbBrakeCenter": 1.05, "pbBrakeWidth": 0.06,
    "perfectClearWeight": 25.0, "multiClearBaseFactor": 0.6, "nearFullFactor": 2.0,
    "exactFitBonus": 1.5, "monoFlushBoost": 0.4, "payoffWeight": 1.7,
    "sizePreferenceGain": 1.5, "diversityPenalty": 1.0,
    "complexityFromStress": 0.75, "complexityRiskRelief": -0.45, "solutionFromStress": 0.7,
    "pbTensionTargetWeight": 0.10, "pbBrakeTargetWeight": 0.10,
    "challengeBoostSlope": 0.75, "challengeBoostCap": 0.18, "pbOvershootMax": 0.16,
    "releaseFactor": 0.7, "farFromPBBoost": 0.45,
}

ALGO_VERSION = "real-v1"   # 区分真人样本与构造样本(v3.1)

# 真人样本「无效数据」质量门(导入时过滤 + 已入库清理, 自动同步安全):
#   - survived_steps < min_steps : 轨迹太短, 无难度信息
#   - n_bins_filled  < min_bins  : d_curve 实际观测 bin 太少, 基本靠外推
#   - final_score    < min_score : 0 分/秒死的废局
REAL_QUALITY_DEFAULTS = {"min_steps": 5, "min_bins": 2, "min_score": 1}


def is_valid_real_sample(s: Optional[dict], min_steps: int = 5,
                         min_bins: int = 2, min_score: int = 1) -> bool:
    """转换后的真人样本是否「有效」(可进训练集)。无效 = 废局/无难度信号。"""
    if not s:
        return False
    if (s.get("survived_steps") or 0) < min_steps:
        return False
    if (s.get("n_bins_filled") or 0) < min_bins:
        return False
    if (s.get("final_score") or 0) < min_score:
        return False
    return True


# ─────────── 形状几何 + 合法落子 ───────────

_SHAPES_CACHE: Optional[Dict[str, List[List[int]]]] = None


def _load_shapes() -> Dict[str, List[List[int]]]:
    """加载 shared/shapes.json → {id: 0/1 矩阵}。"""
    global _SHAPES_CACHE
    if _SHAPES_CACHE is not None:
        return _SHAPES_CACHE
    path = Path(__file__).resolve().parents[2] / "shared" / "shapes.json"
    out: Dict[str, List[List[int]]] = {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for shapes in (data.get("byCategory") or {}).values():
            for s in shapes:
                sid, mat = s.get("id"), s.get("data")
                if sid and isinstance(mat, list):
                    out[sid] = mat
    except (OSError, ValueError):
        pass
    _SHAPES_CACHE = out
    return out


def _parse_cells(grid_json) -> List[List[bool]]:
    """grid.cells (非 None = 占用) → GRID_SIZE×GRID_SIZE 布尔占用矩阵。"""
    board = [[False] * GRID_SIZE for _ in range(GRID_SIZE)]
    cells = (grid_json or {}).get("cells") or []
    for y in range(min(GRID_SIZE, len(cells))):
        row = cells[y] or []
        for x in range(min(GRID_SIZE, len(row))):
            if row[x] is not None:
                board[y][x] = True
    return board


def _fits(board: List[List[bool]], mat: List[List[int]], top: int, left: int) -> bool:
    h = len(mat)
    for dy in range(h):
        rowm = mat[dy]
        for dx in range(len(rowm)):
            if not rowm[dx]:
                continue
            y, x = top + dy, left + dx
            if y < 0 or y >= GRID_SIZE or x < 0 or x >= GRID_SIZE or board[y][x]:
                return False
    return True


def _legal_count(board: List[List[bool]], mats: List[List[List[int]]]) -> int:
    """棋盘上一组形状的合法 (形状, 锚点) 落子总数。"""
    total = 0
    for mat in mats:
        if not mat:
            continue
        h, w = len(mat), max((len(r) for r in mat), default=0)
        for top in range(GRID_SIZE - h + 1):
            for left in range(GRID_SIZE - w + 1):
                if _fits(board, mat, top, left):
                    total += 1
    return total


# ─────────── context 推导 ───────────

def _v2_pb_bin(pb: float) -> int:
    """最近邻 PB 分档(与 web/src/game.js _v2_pbBin 一致)。"""
    pb = max(0.0, float(pb or 0))
    return min(PB_BINS, key=lambda b: abs(b - pb))


def _lifecycle_from_rounds(total_rounds) -> str:
    n = int(total_rounds or 0)
    if n < 5:
        return "onboarding"
    if n < 30:
        return "growth"
    if n < 100:
        return "mature"
    return "plateau"


# 运营 S0–S4(stressBreakdown.lifecycleStage)→ v2 四阶段映射
_S_STAGE_MAP = {
    "S0": "onboarding", "S1": "growth", "S2": "mature", "S3": "plateau", "S4": "plateau",
}


def _lifecycle_from_s_stage(s) -> Optional[str]:
    return _S_STAGE_MAP.get(s) if isinstance(s, str) else None


def _norm_difficulty(d) -> str:
    return d if d in ("easy", "normal", "hard") else "normal"


def _norm_generator(g) -> str:
    return "generative" if g in ("generative", "model-v3", "modelV3") else "rule"


def _norm_bot_policy(p) -> str:
    return p if p in ("random", "clear-greedy", "survival", "rl-bot") else "clear-greedy"


def _ps_get(ps, *path, default=None):
    cur = ps
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


# ─────────── 单局 → v2 样本 ───────────

def session_to_v2_sample(frames: List[dict], meta: Optional[dict] = None) -> Optional[dict]:
    """把一局 frames 转成 1 条 v2 sample dict(与 bulk_insert_samples schema 对齐)。

    返回 None 表示该局不可用(无 place 帧 / 无有效 pb)。
    meta 可覆盖/补充: difficulty, generator, bot_policy, lifecycle_stage,
                     total_rounds, pb_baseline, score, died。
    """
    meta = meta or {}
    if not isinstance(frames, list) or not frames:
        return None
    shapes = _load_shapes()

    cur_grid = None
    remaining_mats: List[List[List[int]]] = []
    steps: List[StepInfo] = []
    step_idx = 0
    best_score_seen = 0.0
    gen_votes = {"rule": 0, "generative": 0}
    pb_curve_params = None
    s_stage = None
    final_score = 0
    last_fill = 0.0

    for fr in frames:
        t = fr.get("t")
        if t == "init":
            cur_grid = fr.get("grid")
        elif t == "spawn":
            dock = fr.get("dock") or []
            remaining_mats = [shapes[d.get("id")] for d in dock if d.get("id") in shapes]
            ps = fr.get("ps") or {}
            bs = _ps_get(ps, "bestScore")
            if isinstance(bs, (int, float)) and bs > best_score_seen:
                best_score_seen = float(bs)
            src = _ps_get(ps, "provenance", "spawnSource", default="")
            gen_votes["generative" if src in ("model-v3", "generative", "modelV3") else "rule"] += 1
            pcp = _ps_get(ps, "adaptive", "stressBreakdown", "pbCurveParams")
            if isinstance(pcp, dict):
                pb_curve_params = pcp
            ls = _ps_get(ps, "adaptive", "stressBreakdown", "lifecycleStage")
            if ls:
                s_stage = ls
        elif t == "place":
            ps = fr.get("ps") or {}
            score = _ps_get(ps, "score", default=0) or 0
            fill = _ps_get(ps, "boardFill", default=0.0) or 0.0
            clears = int(_ps_get(ps, "linesCleared", default=0) or 0)
            board_before = _parse_cells(cur_grid) if cur_grid else [[False] * GRID_SIZE for _ in range(GRID_SIZE)]
            legal = _legal_count(board_before, remaining_mats) if remaining_mats else TOTAL_CELLS
            action_freedom = min(1.0, legal / TOTAL_CELLS)
            steps.append(StepInfo(
                step_idx=step_idx, score=int(score), fill_rate=float(fill),
                action_freedom=action_freedom, no_move=False, clears=clears,
            ))
            step_idx += 1
            final_score = int(score)
            last_fill = float(fill)
            if remaining_mats:
                remaining_mats.pop(0)   # 该三元组剩余件数 -1(身份未落库, 仅维持件数)
            after = fr.get("gridAfter")
            if after:
                cur_grid = after

    if not steps:
        return None

    # 死局: 追加 no_move 步(d_step=1.0), 与 extractor 死局口径一致
    died = bool(meta.get("died")) or meta.get("game_over_reason") in ("jam", "level_fail")
    if died:
        steps.append(StepInfo(
            step_idx=step_idx, score=final_score, fill_rate=last_fill,
            action_freedom=0.0, no_move=True, clears=0,
        ))

    # PB 解析: pb_baseline > 帧内最大 bestScore > final_score > 500 floor
    pb = next((float(v) for v in (
        meta.get("pb_baseline"), best_score_seen, final_score, 500,
    ) if v and float(v) > 0), 500.0)

    # θ: 默认 + 该局实际 pbCurveParams 覆盖(4 维)
    theta = dict(DEFAULT_THETA)
    if isinstance(pb_curve_params, dict):
        for k in ("pbTensionCenter", "pbTensionWidth", "pbBrakeCenter", "pbBrakeWidth"):
            v = pb_curve_params.get(k)
            if isinstance(v, (int, float)):
                theta[k] = float(v)

    labels = extract_d_curve(
        steps, pb,
        theta_pb_tension_center=theta["pbTensionCenter"],
        theta_pb_tension_width=theta["pbTensionWidth"],
    )

    # bin_counts(extract_d_curve 不返回, 这里同口径重算: 按每步 r 分 bin 计数)
    bin_counts = [0] * CURVE_N_BINS
    for st in steps:
        r = min(CURVE_R_MAX - 1e-9, st.score / pb)
        bin_counts[r_to_bin(r, n_bins=CURVE_N_BINS, r_max=CURVE_R_MAX)] += 1

    generator = _norm_generator(meta.get("generator")
                                or ("generative" if gen_votes["generative"] > gen_votes["rule"] else "rule"))
    return {
        "difficulty": _norm_difficulty(meta.get("difficulty")),
        "generator": generator,
        "bot_policy": _norm_bot_policy(meta.get("bot_policy")),
        "pb_bin": _v2_pb_bin(pb),
        "lifecycle_stage": (
            meta.get("lifecycle_stage")
            if meta.get("lifecycle_stage") in ("onboarding", "growth", "mature", "plateau")
            else (
                _lifecycle_from_rounds(meta.get("total_rounds"))
                if meta.get("total_rounds")
                else (_lifecycle_from_s_stage(s_stage) or "growth")
            )
        ),
        "theta_json": json.dumps(theta),
        "d_curve_json": json.dumps([round(v, 6) for v in labels.d_curve]),
        "final_score": labels.final_score,
        "survived_steps": labels.survived_steps,
        "clear_rate": labels.clear_rate,
        "noMove_step": labels.noMove_step,
        "pb_broke": bool(labels.pb_broke),
        "surprise_count": labels.surprise_count,
        "n_bins_filled": labels.n_bins_filled,
        "bin_counts": bin_counts,
        "algo_version": ALGO_VERSION,
    }
