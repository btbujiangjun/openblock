"""
ShapeProposer — 程序化形状生成（PCGRL 雏形）。

设计动机
--------
当前 28 个固定形状是「人工策划」的有限词典。一旦想做季节限定形状、
新难度或 RL 课程多样性，需要重新策划。本模块提供「由若干基础原语 +
连通性约束 + 评分函数」自动产出新形状候选的能力。

它**不替换**现有形状池（用于稳定性与可回放性），而是作为：
  - 关卡/课程编辑器的形状灵感源；
  - SpawnTransformer 训练数据增强；
  - PCGRL 风格的研究入口。

核心算法
--------
基于「Random walk on grid」+ 「Connectivity check」+ 「Symmetry filter」：

  1. 在 k×k 网格上随机选起点 (r0, c0)；
  2. 反复 4-邻域扩张：以 0.7 概率选择"延展"，0.3 选择"分支"；
  3. 直到达到目标格子数 n_cells（典型 3~5）；
  4. 后处理：上 / 下 / 左 / 右 修剪到最小包围盒；
  5. 拒绝重复（与已有形状库去重，含 4 种旋转 + 镜像）。

评分函数（用于课程化采样）
--------------------------
对每个候选形状打分：
  - boxiness: 包围盒面积 / 实际格子数（接近 1 表示规整方块）
  - elongation: max(h, w) / min(h, w)（接近 1 表示方形）
  - solvability: 在 8×8 满盘加一个 hole 时能否放入（"末压保命"难度）

接口
----
  - propose_shape(n_cells=4, seed=None) -> list[list[int]]
  - propose_unique_batch(n=10, n_cells_dist={3:0.2,4:0.5,5:0.3}, existing=None)
  - shape_signature(shape) -> str
  - score_shape(shape) -> dict
"""

from __future__ import annotations

import random
from typing import Iterable

import numpy as np


def _normalize(grid: np.ndarray) -> list[list[int]]:
    """裁剪到最小包围盒并返回 list[list[int]]。"""
    rows = np.where(grid.any(axis=1))[0]
    cols = np.where(grid.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return [[0]]
    rmin, rmax = rows.min(), rows.max()
    cmin, cmax = cols.min(), cols.max()
    sub = grid[rmin:rmax + 1, cmin:cmax + 1].astype(int)
    return sub.tolist()


def shape_signature(shape: Iterable[Iterable[int]]) -> str:
    """规范化签名：每个旋转/镜像中字符串最小者。"""
    arr = np.asarray(shape, dtype=int)
    candidates = []
    for k in range(4):
        rot = np.rot90(arr, k)
        candidates.append(_to_string(rot))
        candidates.append(_to_string(np.fliplr(rot)))
    return min(candidates)


def _to_string(arr: np.ndarray) -> str:
    arr = np.asarray(arr, dtype=int)
    rows = np.where(arr.any(axis=1))[0]
    cols = np.where(arr.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return "0"
    sub = arr[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    return "|".join("".join(str(int(c)) for c in row) for row in sub)


def propose_shape(
    n_cells: int = 4,
    *,
    seed: int | None = None,
    max_dim: int = 4,
    branch_prob: float = 0.3,
) -> list[list[int]]:
    """生成一个 n_cells 格的连通形状。

    Args:
        n_cells: 目标格子数（3~5 推荐）
        seed: 随机种子
        max_dim: 包围盒最大边长（避免出现"巨型"形状）
        branch_prob: 每步以多大概率从已放置的随机一格分支（vs 当前格延伸）

    Returns:
        list[list[int]]，已规范化到最小包围盒
    """
    if seed is not None:
        rng = random.Random(seed)
    else:
        rng = random.Random()

    side = max(3, max_dim + 2)
    grid = np.zeros((side, side), dtype=int)
    cx, cy = side // 2, side // 2
    grid[cy][cx] = 1
    placed = [(cx, cy)]

    while sum(1 for v in grid.flatten() if v) < n_cells:
        if rng.random() < branch_prob and len(placed) > 1:
            ax, ay = rng.choice(placed)
        else:
            ax, ay = placed[-1]
        directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
        rng.shuffle(directions)
        moved = False
        for dx, dy in directions:
            nx, ny = ax + dx, ay + dy
            if 0 <= nx < side and 0 <= ny < side and grid[ny][nx] == 0:
                grid[ny][nx] = 1
                placed.append((nx, ny))
                moved = True
                break
        if not moved:
            placed = placed[:-1]
            if not placed:
                break

    norm = _normalize(grid)
    h, w = len(norm), len(norm[0])
    if h > max_dim or w > max_dim:
        return propose_shape(n_cells=n_cells, seed=seed, max_dim=max_dim,
                             branch_prob=branch_prob)
    return norm


def score_shape(shape: list[list[int]]) -> dict:
    """打分：boxiness / elongation / connectivity / cells / bbox_area。"""
    arr = np.asarray(shape, dtype=int)
    cells = int(arr.sum())
    h, w = arr.shape
    bbox = h * w
    boxiness = cells / max(1, bbox)
    elongation = max(h, w) / max(1, min(h, w))
    return {
        'cells': cells,
        'bbox': bbox,
        'h': h,
        'w': w,
        'boxiness': round(boxiness, 3),
        'elongation': round(elongation, 3),
    }


def propose_unique_batch(
    n: int = 10,
    *,
    n_cells_dist: dict | None = None,
    existing_signatures: set | None = None,
    seed: int | None = None,
    max_attempts_factor: int = 5,
) -> list[dict]:
    """生成 n 个互不重复（也不与 existing 重复）的形状候选。

    Args:
        n: 目标数量
        n_cells_dist: {n_cells: prob} 比例
        existing_signatures: 已有签名集合（去重用）
        seed: 起始种子（每个候选自增）
        max_attempts_factor: 最多尝试次数 = n × factor

    Returns:
        list[{ 'shape': list[list[int]], 'sig': str, 'score': dict }]
    """
    rng = random.Random(seed)
    dist = n_cells_dist or {3: 0.2, 4: 0.5, 5: 0.3}
    sizes = list(dist.keys())
    weights = [dist[k] for k in sizes]
    seen = set(existing_signatures or [])
    out = []
    attempts = 0
    max_attempts = n * max_attempts_factor

    while len(out) < n and attempts < max_attempts:
        attempts += 1
        n_cells = rng.choices(sizes, weights=weights, k=1)[0]
        sub_seed = rng.randint(0, 1 << 30)
        shape = propose_shape(n_cells=n_cells, seed=sub_seed)
        sig = shape_signature(shape)
        if sig in seen:
            continue
        seen.add(sig)
        out.append({
            'shape': shape,
            'sig': sig,
            'score': score_shape(shape),
        })

    return out


def shape_pool_signatures(shape_pool: list[dict]) -> set:
    """对现有 shape_pool 提取去重签名集合。"""
    return {shape_signature(s.get('data') or s.get('shape')) for s in shape_pool}
