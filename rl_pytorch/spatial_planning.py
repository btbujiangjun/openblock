"""空间规划（Spatial Planning）—— web/src/spatialPlanning.js 的 Python 镜像（廉价 RL 子向量）。

填充率只衡量「占了多少」，本模块从盘面空白区域的拓扑/熵结构刻画「占得整齐 vs 占得稀碎」。
仅实现进 RL 落子 state 与生成式 behaviorContext 的廉价 3 维（单次 BFS，O(n²)）；完整层
（形状词表机动性 / optionEntropy / topologyDelta）只在 JS 评估/出块/面板路径使用，不入训练热路径。

两侧 cheap 3 维必须逐位一致（跨语言契约测试见 tests/test_spatial_planning.py 与
tests/spatialPlanning.test.js）。空格判定与 fast_grid 一致：grid_np 中 <0 视为空格。
"""
from __future__ import annotations

import math
from typing import List, Sequence

import numpy as np

SPATIAL_PLANNING_VERSION = 1
SPATIAL_PLANNING_FEATURE_DIM = 3

# 与 web/src/spatialPlanning.js DEFAULT_SPATIAL_PLANNING_CONFIG.smallRegionMaxSize 对齐。
_SMALL_REGION_MAX_SIZE = 4


def _clamp01(x: float) -> float:
    if x != x:  # NaN
        return 0.0
    return max(0.0, min(1.0, float(x)))


def shannon_entropy(counts: Sequence[float], norm_denom: float | None = None) -> float:
    """香农熵（自然对数），可选归一化分母（>0 时返回 H/norm_denom 并 clamp 到 [0,1]）。"""
    total = 0.0
    for c in counts:
        if c is not None and c == c and c > 0:
            total += float(c)
    if total <= 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c is not None and c == c and c > 0:
            p = float(c) / total
            h -= p * math.log(p)
    if norm_denom is not None and norm_denom > 0:
        return _clamp01(h / norm_denom)
    return h


def scan_empty_regions(grid_np: np.ndarray, small_max: int = _SMALL_REGION_MAX_SIZE) -> dict:
    """单次 BFS 扫描空格（<0）的 4-连通分量尺寸。与 JS scanEmptyRegions 同口径。"""
    res = {"sizes": [], "emptyCells": 0, "regionCount": 0, "maxSize": 0, "smallCells": 0}
    if grid_np is None or grid_np.size == 0:
        return res
    h, w = grid_np.shape
    visited = np.zeros((h, w), dtype=bool)
    for sy in range(h):
        for sx in range(w):
            if grid_np[sy, sx] >= 0 or visited[sy, sx]:
                continue
            stack = [(sy, sx)]
            visited[sy, sx] = True
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and grid_np[ny, nx] < 0:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            res["sizes"].append(size)
            res["emptyCells"] += size
            res["regionCount"] += 1
            if size > res["maxSize"]:
                res["maxSize"] = size
            if size <= small_max:
                res["smallCells"] += size
    return res


def spatial_planning_features(grid_np: np.ndarray) -> List[float]:
    """廉价 3 维 [regionEntropy, largestRegionRatio, smallRegionCellRatio]，均在 [0,1]。"""
    scan = scan_empty_regions(grid_np)
    empty = scan["emptyCells"]
    if empty <= 0:
        return [0.0, 0.0, 0.0]
    region_entropy = shannon_entropy(scan["sizes"], math.log(max(2, empty)))
    largest_region_ratio = _clamp01(scan["maxSize"] / empty)
    small_region_cell_ratio = _clamp01(scan["smallCells"] / empty)
    return [region_entropy, largest_region_ratio, small_region_cell_ratio]
