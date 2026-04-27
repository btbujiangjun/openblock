"""
Feasibility 模块 — 把"可解性"作为可微约束注入到 SpawnTransformer。

设计动机
--------
SpawnTransformerV2 完全是数据驱动的拟合，输出可能是「在当前盘面无解」的形状，
推理时只能依赖**外部规则引擎**做一次后置过滤；这导致三个问题：

  P1. 模型仍可能将概率质量放在不合法形状上 → 学到的分布与"真正可用 dock"
      之间存在系统偏差；
  P2. 训练阶段没有可解性信号 → 反向传播无法引导模型避开不合法区域；
  P3. 对极端紧迫盘面（fill ≥ 0.75）的 OOM-recovery，
      模型很容易陷入"把全部分布给死局"的失败模式。

本模块提供两种可解性信号：

  1. **feasibility mask**（推理期硬约束）：
     给定 board 与 shape，返回 1/0 表示「至少存在一个合法落点」。
     用法：在 sampling/argmax 前把不合法 shape 的 logit 置 -inf。

  2. **feasibility weight**（训练期软约束）：
     连续值 [0, 1]，对每个形状返回"合法落点比例"（normalize 后）。
     用法：作为辅助监督信号 - 让模型预测每个 shape 的可放性，
           训练时与 GT 比较；并在主损失上加一项
           soft penalty (=−log(1 − P(infeasible))) 抑制不可行概率。

为什么是"可微"
--------------
mask 本身是 0/1 不可微，但：

  - 训练时把 mask 当作 supervision target（BCE on auxiliary head）
    → 网络学到一个 feasibility predictor，间接获得梯度。
  - 推理时直接用真实 mask，避免依赖 predictor 的精度。
  - 可选：softmax 之前减去 (1 - feasibility_pred) * λ，使 differentiable。

复杂度
------
对单个 shape：O(8×8) — 遍历所有可能左上角。
对全部 28 个 shape：O(28 × 8 × 8) ≈ 1.8K ops，CPU < 0.05 ms。

接口
----
  - check_shape_feasibility(board_2d, shape_data)            -> bool
  - count_feasible_positions(board_2d, shape_data)           -> int
  - build_feasibility_mask(board_2d, shape_vocab, shape_map) -> np.ndarray (NUM_SHAPES,)
  - build_feasibility_weight(board_2d, shape_vocab, shape_map) -> np.ndarray (NUM_SHAPES,)
  - apply_feasibility_mask_torch(logits, mask, neg_inf=-1e4) -> torch.Tensor
"""

from __future__ import annotations

from typing import Iterable

import numpy as np


def check_shape_feasibility(board: np.ndarray, shape: Iterable[Iterable[int]]) -> bool:
    """形状是否在 board 上至少有一个合法落点。

    Args:
        board: (H, W) numpy；0=空，>0=占用
        shape: 二维列表/数组；非零位置代表方块占据

    Returns:
        True 当存在 (ox, oy) 使整个 shape 落入棋盘并且不冲突
    """
    bnp = np.asarray(board)
    H, W = bnp.shape
    s = np.asarray(shape, dtype=np.uint8)
    sh, sw = s.shape
    if sh > H or sw > W:
        return False
    occ = (bnp > 0).astype(np.uint8)

    for oy in range(H - sh + 1):
        for ox in range(W - sw + 1):
            patch = occ[oy:oy + sh, ox:ox + sw]
            if not np.any(patch & s):
                return True
    return False


def count_feasible_positions(board: np.ndarray, shape: Iterable[Iterable[int]]) -> int:
    """统计形状在 board 上的合法落点数。"""
    bnp = np.asarray(board)
    H, W = bnp.shape
    s = np.asarray(shape, dtype=np.uint8)
    sh, sw = s.shape
    if sh > H or sw > W:
        return 0
    occ = (bnp > 0).astype(np.uint8)

    count = 0
    for oy in range(H - sh + 1):
        for ox in range(W - sw + 1):
            patch = occ[oy:oy + sh, ox:ox + sw]
            if not np.any(patch & s):
                count += 1
    return count


def build_feasibility_mask(
    board: np.ndarray,
    shape_vocab: list[str],
    shape_map: dict,
) -> np.ndarray:
    """生成 (NUM_SHAPES,) 的 0/1 mask：1=至少一个合法落点。

    Args:
        board: (H, W) 棋盘占用矩阵
        shape_vocab: 形状 ID 列表（顺序定义索引）
        shape_map:   {shape_id: shape_data(list[list[int]])}

    Returns:
        np.ndarray 形状 (len(shape_vocab),)，dtype=float32
    """
    n = len(shape_vocab)
    mask = np.zeros(n, dtype=np.float32)
    for i, sid in enumerate(shape_vocab):
        data = shape_map.get(sid)
        if data is None:
            continue
        if check_shape_feasibility(board, data):
            mask[i] = 1.0
    return mask


def build_feasibility_weight(
    board: np.ndarray,
    shape_vocab: list[str],
    shape_map: dict,
    normalize: str = "max",
) -> np.ndarray:
    """生成 (NUM_SHAPES,) 的连续可解性权重（合法落点比例）。

    用作辅助监督的 GT，亦可用作 soft mask 缩放 logits（保留梯度）。

    Args:
        board: 棋盘
        shape_vocab: 形状 ID 列表
        shape_map: {id: data}
        normalize:
          - "max": 除以全局最大落点数（保留各 shape 间相对差异）
          - "shape": 除以该 shape 的理论最大落点（H-sh+1)*(W-sw+1)
          - "none": 原始计数（int）

    Returns:
        np.ndarray (NUM_SHAPES,) float32，∈ [0, 1]（normalize 后）
    """
    n = len(shape_vocab)
    counts = np.zeros(n, dtype=np.float32)
    bnp = np.asarray(board)
    H, W = bnp.shape

    for i, sid in enumerate(shape_vocab):
        data = shape_map.get(sid)
        if data is None:
            continue
        s = np.asarray(data, dtype=np.uint8)
        sh, sw = s.shape
        if sh > H or sw > W:
            continue
        c = count_feasible_positions(bnp, data)
        if normalize == "shape":
            denom = max(1, (H - sh + 1) * (W - sw + 1))
            counts[i] = c / denom
        else:
            counts[i] = float(c)

    if normalize == "max":
        m = counts.max()
        if m > 0:
            counts = counts / m
    return counts


def apply_feasibility_mask_torch(logits, mask, neg_inf: float = -1e4):
    """torch 接口：把 mask=0 的位置 logit 置为 neg_inf（推理硬约束）。

    Args:
        logits: torch.Tensor 形状 (..., NUM_SHAPES)
        mask:   numpy or torch 形状 (NUM_SHAPES,) 或可广播的
        neg_inf: 屏蔽用的负值（避免 -inf 触发 NaN）

    Returns:
        新的 logits（原 logits 不变）
    """
    import torch
    if not isinstance(mask, torch.Tensor):
        mask = torch.as_tensor(mask, dtype=logits.dtype, device=logits.device)
    if mask.dim() < logits.dim():
        for _ in range(logits.dim() - mask.dim()):
            mask = mask.unsqueeze(0)
    return logits + (mask - 1.0) * (-neg_inf)
