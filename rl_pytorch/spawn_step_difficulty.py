"""单步出块难度（Spawn Step Difficulty）—— web/src/spawnStepDifficulty.js 的 Python 镜像。

无尽模式无「题目」概念，难度的最小单元是「当前盘面 × 本轮候选三块」，由确定性特征逐步
算出。本模块把分散的单步难度原语（boardDifficulty / DFS solutionMetrics / 几何 scd）
consolidate 成 0~1 难度分 + 5 档桶，用于：
  - RL / 出块模型 **数据集标注**（按难度桶分层、加权、反事实分组）；
  - 离线「难度桶 × 算法」聚合（scripts/aggregate-step-difficulty.mjs 的 Python 侧对照）。

两侧公式必须保持一致（跨语言契约测试见 tests/test_spawn_step_difficulty.py 与
tests/spawnStepDifficulty.test.js）。`spawn_step_difficulty_features` 暴露的 4 维子向量
已正式拼入 RL 落子 state（当前 204 维：另含 2 维客观几何 contiguousRegions/concaveCorners
与 v1.67 的 3 维空间规划 regionEntropy/largestRegionRatio/smallRegionCellRatio），
由 rl_pytorch/features.py 与 web/src/bot/features.js 共同调用，保证 JS/Python 逐位一致。
v1.67：compute_spawn_step_difficulty 新增 fragmentation 项（spatial_features 激活时）。

详见 docs/algorithms/ALGORITHMS_SPAWN.md §14.二 与 docs/algorithms/ALGORITHMS_RL.md §3。
"""
from __future__ import annotations

from typing import Callable, Iterable, List, Optional, Sequence

SPAWN_STEP_DIFFICULTY_VERSION = 1

DIFFICULTY_BUCKETS = ("trivial", "easy", "standard", "hard", "extreme")
_BUCKET_UPPER = (0.2, 0.4, 0.6, 0.8)

DEFAULT_STEP_DIFFICULTY_CONFIG = {
    "boardSize": 8,
    "scdAmple": 0.3,
    "scdTight": 0.5,
    "scdSaturation": 0.6,
    "killerMinCells": 5,
    "killerMaxPlacements": 6,
    "longBarMinLength": 4,
    "solutionAbundant": 24,
    "flexibilityFree": 24,
    "comboCellsNorm": 15,
    # v1.67 空间规划：fragmentation 项 = regionEntropy + smallRegionCellRatio 合成。
    # 仅当 compute_spawn_step_difficulty 收到 spatial_features 时生效；缺省自动重分配权重。
    "fragmentationFrom": {"regionEntropy": 0.6, "smallRegionCellRatio": 0.4},
    "weights": {
        "scd": 0.26,
        "board": 0.18,
        "flexibility": 0.18,
        "solution": 0.13,
        "killer": 0.13,
        "fragmentation": 0.12,
    },
}

Matrix = Sequence[Sequence[float]]


def _clamp01(x: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN
        return 0.0
    return max(0.0, min(1.0, v))


def _merge_config(cfg: Optional[dict]) -> dict:
    if not isinstance(cfg, dict):
        return DEFAULT_STEP_DIFFICULTY_CONFIG
    merged = dict(DEFAULT_STEP_DIFFICULTY_CONFIG)
    merged.update({k: v for k, v in cfg.items() if k != "weights"})
    merged["weights"] = dict(DEFAULT_STEP_DIFFICULTY_CONFIG["weights"])
    if isinstance(cfg.get("weights"), dict):
        merged["weights"].update(cfg["weights"])
    return merged


def shape_cell_count(data: Matrix) -> int:
    """形状矩阵占用格数（1=占用）。"""
    if not data:
        return 0
    n = 0
    for row in data:
        if not row:
            continue
        for v in row:
            if v:
                n += 1
    return n


def _bounding_box(data: Matrix):
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for y, row in enumerate(data or []):
        for x, v in enumerate(row or []):
            if v:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    if max_x < min_x:
        return 0, 0
    return int(max_x - min_x + 1), int(max_y - min_y + 1)


def is_long_bar(data: Matrix, cfg: Optional[dict] = None) -> bool:
    """长条（难度约束口径）：单行/单列且长度 ≥ longBarMinLength。"""
    c = _merge_config(cfg)
    cells = shape_cell_count(data)
    if cells < c["longBarMinLength"]:
        return False
    w, h = _bounding_box(data)
    single_row = h == 1 and w >= c["longBarMinLength"] and cells == w
    single_col = w == 1 and h >= c["longBarMinLength"] and cells == h
    return single_row or single_col


def is_killer_shape(
    data: Matrix,
    count_legal: Optional[Callable[[Matrix], int]] = None,
    cfg: Optional[dict] = None,
) -> bool:
    """致命块：大体积(≥killerMinCells)或长条，且当前盘面机动性低(≤killerMaxPlacements)。
    count_legal 缺省时退化为纯形状口径（仅体积/长条）。"""
    c = _merge_config(cfg)
    cells = shape_cell_count(data)
    bulky_or_bar = cells >= c["killerMinCells"] or is_long_bar(data, c)
    if not bulky_or_bar:
        return False
    if not callable(count_legal):
        return True
    legal = count_legal(data)
    return isinstance(legal, (int, float)) and legal <= c["killerMaxPlacements"]


def _family_of(shape, category_of: Optional[Callable]) -> str:
    if callable(category_of):
        cat = category_of(shape)
        if cat:
            return cat
    data = shape.get("data") if isinstance(shape, dict) else shape
    w, h = _bounding_box(data or [])
    if w == 1 or h == 1:
        return "lines"
    if w == h:
        return "squares"
    return "rects"


def classify_triplet(
    shapes: Iterable,
    count_legal: Optional[Callable[[Matrix], int]] = None,
    category_of: Optional[Callable] = None,
    cfg: Optional[dict] = None,
) -> dict:
    """三连块组合级分类（P1）。"""
    c = _merge_config(cfg)
    shape_list = list(shapes or [])
    datas = []
    for s in shape_list:
        d = s.get("data") if isinstance(s, dict) else s
        if d:
            datas.append(d)

    combo_total_cells = 0
    combo_killer_cnt = 0
    combo_long_bar_cnt = 0
    min_flexibility: Optional[int] = None
    families: List[str] = []

    for i, data in enumerate(datas):
        combo_total_cells += shape_cell_count(data)
        if is_long_bar(data, c):
            combo_long_bar_cnt += 1
        if is_killer_shape(data, count_legal, c):
            combo_killer_cnt += 1
        if callable(count_legal):
            legal = count_legal(data)
            if isinstance(legal, (int, float)):
                min_flexibility = legal if min_flexibility is None else min(min_flexibility, legal)
        src = shape_list[i] if i < len(shape_list) else data
        families.append(_family_of(src, category_of))

    is_homogeneous = len(families) >= 2 and all(f == families[0] for f in families)
    return {
        "comboTotalCells": combo_total_cells,
        "comboKillerCnt": combo_killer_cnt,
        "comboLongBarCnt": combo_long_bar_cnt,
        "isHomogeneousFamily": is_homogeneous,
        "minFlexibility": min_flexibility,
    }


def scd_score(combo_total_cells: float, occupied_count: float, cfg: Optional[dict] = None) -> float:
    """空间约束密度（P0）= 三块总格 / (空格数 + ε)。"""
    c = _merge_config(cfg)
    area = c["boardSize"] * c["boardSize"]
    free = max(0.0, area - (float(occupied_count) if occupied_count else 0.0))
    return (float(combo_total_cells) if combo_total_cells else 0.0) / (free + 0.001)


def scd_level(scd: float, cfg: Optional[dict] = None) -> str:
    c = _merge_config(cfg)
    if scd < c["scdAmple"]:
        return "ample"
    if scd < c["scdTight"]:
        return "tight"
    return "scarce"


SPAWN_STEP_DIFFICULTY_FEATURE_DIM = 4


def spawn_step_difficulty_features(
    shapes: Iterable,
    occupied_count: float = 0,
    cfg: Optional[dict] = None,
) -> List[float]:
    """RL 单步难度特征子向量（SSOT，确定性、廉价、无 DFS/无落点扫描）——
    供 rl_pytorch/features.py 与 web/src/bot/features.js 拼入 RL state 标量段（当前 204 维）。

    仅依赖「候选三块几何 + 盘面占用数」，可在 MCTS 热路径每节点调用。
    返回固定 4 维（均已 clamp 到 [0,1]）：
      [0] scdNorm          空间约束密度 / 饱和点
      [1] comboCellsNorm   三块总格 / comboCellsNorm
      [2] comboKillerNorm  致命块数（形状口径）/ dockSlots
      [3] comboLongBarNorm 长条数 / dockSlots
    """
    c = _merge_config(cfg)
    cls = classify_triplet(shapes, None, None, c)
    scd = scd_score(cls["comboTotalCells"], occupied_count, c)
    slots = 3.0
    return [
        _clamp01(scd / c["scdSaturation"]),
        _clamp01(cls["comboTotalCells"] / c["comboCellsNorm"]),
        _clamp01(cls["comboKillerCnt"] / slots),
        _clamp01(cls["comboLongBarCnt"] / slots),
    ]


def difficulty_bucket(step_difficulty: float) -> str:
    d = _clamp01(step_difficulty)
    for i, upper in enumerate(_BUCKET_UPPER):
        if d <= upper:
            return DIFFICULTY_BUCKETS[i]
    return DIFFICULTY_BUCKETS[-1]


def compute_spawn_step_difficulty(
    shapes: Iterable,
    occupied_count: float = 0,
    board_difficulty: Optional[float] = None,
    solution_metrics: Optional[dict] = None,
    count_legal: Optional[Callable[[Matrix], int]] = None,
    category_of: Optional[Callable] = None,
    spatial_features: Optional[Sequence[float]] = None,
    cfg: Optional[dict] = None,
) -> dict:
    """把单步难度原语 consolidate 成 0~1 分 + 5 档桶（P2）。与 JS 公式逐项对齐。

    spatial_features=[regionEntropy, largestRegionRatio, smallRegionCellRatio]（来自
    spatial_planning.spatial_planning_features）时启用 fragmentation 项；缺省自动重分配权重。
    """
    c = _merge_config(cfg)
    cls = classify_triplet(shapes, count_legal, category_of, c)
    scd = scd_score(cls["comboTotalCells"], occupied_count, c)
    scd_norm = _clamp01(scd / c["scdSaturation"])

    board_term = _clamp01(board_difficulty if isinstance(board_difficulty, (int, float)) else 0.0)

    if cls["minFlexibility"] is None:
        flex_term = 0.5
    else:
        flex_term = _clamp01(1 - cls["minFlexibility"] / c["flexibilityFree"])

    solution_term = 0.5
    solution_count = None
    if isinstance(solution_metrics, dict):
        if solution_metrics.get("capped") or solution_metrics.get("truncated"):
            solution_term = 0.0
        else:
            sc = solution_metrics.get("solutionCount")
            if isinstance(sc, (int, float)):
                solution_count = sc
                solution_term = _clamp01(1 - sc / c["solutionAbundant"])

    killer_term = _clamp01((cls["comboKillerCnt"] + cls["comboLongBarCnt"] * 0.5) / 3)

    ff = c.get("fragmentationFrom") or {}
    fragmentation_term = None
    if isinstance(spatial_features, (list, tuple)) and len(spatial_features) >= 3:
        region_entropy = _clamp01(spatial_features[0])
        small_region_cell_ratio = _clamp01(spatial_features[2])
        fragmentation_term = _clamp01(
            region_entropy * float(ff.get("regionEntropy", 0) or 0)
            + small_region_cell_ratio * float(ff.get("smallRegionCellRatio", 0) or 0)
        )

    w = c["weights"]
    w_frag_active = float(w.get("fragmentation", 0) or 0) if fragmentation_term is not None else 0.0
    w_sum = (
        float(w.get("scd", 0) or 0)
        + float(w.get("board", 0) or 0)
        + float(w.get("flexibility", 0) or 0)
        + float(w.get("solution", 0) or 0)
        + float(w.get("killer", 0) or 0)
        + w_frag_active
    )
    if w_sum > 0:
        step_difficulty = _clamp01(
            (
                w["scd"] * scd_norm
                + w["board"] * board_term
                + w["flexibility"] * flex_term
                + w["solution"] * solution_term
                + w["killer"] * killer_term
                + (w_frag_active * fragmentation_term if fragmentation_term is not None else 0.0)
            )
            / w_sum
        )
    else:
        step_difficulty = 0.0

    return {
        "version": SPAWN_STEP_DIFFICULTY_VERSION,
        "stepDifficulty": step_difficulty,
        "bucket": difficulty_bucket(step_difficulty),
        "scdScore": scd,
        "scdLevel": scd_level(scd, c),
        "comboTotalCells": cls["comboTotalCells"],
        "comboKillerCnt": cls["comboKillerCnt"],
        "comboLongBarCnt": cls["comboLongBarCnt"],
        "isHomogeneousFamily": cls["isHomogeneousFamily"],
        "minFlexibility": cls["minFlexibility"],
        "boardDifficulty": board_difficulty if isinstance(board_difficulty, (int, float)) else None,
        "solutionCount": solution_count,
        "fragmentation": fragmentation_term,
        "terms": {
            "scd": scd_norm,
            "board": board_term,
            "flexibility": flex_term,
            "solution": solution_term,
            "killer": killer_term,
            "fragmentation": fragmentation_term if fragmentation_term is not None else 0,
        },
    }
