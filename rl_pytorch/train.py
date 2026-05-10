"""
自博弈 + PPO / REINFORCE 策略梯度，PyTorch — v5 直接监督重构。

v5 核心改动（修复不收敛根因）：
  - 纯 outcome 价值目标：V 学习预测 final_score/threshold（低方差、无信用分配问题）
  - 三个直接监督辅助损失（每步即时梯度，不依赖稀疏 MC returns）：
    board_quality_loss: MSE，回归 board_potential（棋盘结构质量）
    feasibility_loss:   BCE，预测"剩余 dock 块是否全部可放"
    survival_loss:      MSE，回归 steps_to_end / 30（生存预期）
    topology_aux_loss:  SmoothL1，预测落子后的 8 维拓扑分量
  - 精简奖励：仅保留得分增量 + 势函数塑形 + 胜利奖励；
    placeBonus / holePenalty / heightPenalty 等噪声项已移除
  - DockBoardAttention（conv-shared 架构）：dock 块对棋盘 CNN 特征做交叉注意力
  - 保留 v4 的 clear_pred / hole_aux / PPO / LR warmup / value clip

--device：``auto`` | ``cpu`` | ``mps`` | ``cuda`` | ``cuda:N``
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Union

from . import torch_env  # noqa: F401 — 须在 import torch 之前（NNPACK 警告 / CPU 环境）

import numpy as np
import torch
import torch.nn.functional as F
from torch.distributions import Categorical, Dirichlet

from .config import WIN_SCORE_THRESHOLD
from .game_rules import (
    FEATURE_ENCODING,
    RL_REWARD_SHAPING,
    rl_curriculum_enabled,
    rl_win_threshold_for_episode,
    rl_adaptive_curriculum_config,
    rl_win_threshold_from_virtual_ep,
)
from .device import (
    adam_for_training,
    apply_cpu_training_tuning,
    apply_throughput_tuning,
    device_summary_line,
    maybe_mps_synchronize,
    resolve_cuda_device_ids_for_data_parallel,
    resolve_training_device,
    tensor_to_device,
)
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch, extract_state_features
from .model import (
    ConvSharedPolicyValueNet,
    LightPolicyValueNet,
    LightSharedPolicyValueNet,
    PolicyValueNet,
    SharedPolicyValueNet,
)
from .simulator import OpenBlockSimulator, board_potential, _BOARD_POT_NORM, _SURVIVAL_NORM

# ---------------------------------------------------------------------------
# 多进程 worker（CPU 推理采集，GPU 专做更新）
# ---------------------------------------------------------------------------
_pool_net: AnyNet | None = None
_pool_device = torch.device("cpu")
_pool_shared_table = None   # SharedZobristTable 附加对象（worker 端）


def _pool_worker_init(
    arch: str,
    width: int,
    pd: int,
    vd: int,
    mr: float,
    cc: int = 32,
    shm_name: str = "",
    shm_slots: int = 0,
):
    """每个 worker 进程初始化一份模型（CPU）。

    shm_name / shm_slots：若非空，附加到主进程创建的 SharedZobristTable，
    使跨进程 Zobrist 缓存生效。
    """
    global _pool_net, _pool_device, _pool_shared_table
    _pool_net = build_policy_net(arch, width, pd, vd, mr, _pool_device, conv_channels=cc)
    _pool_net.eval()
    if shm_name and shm_slots > 0:
        try:
            from .mcts import SharedZobristTable  # type: ignore[attr-defined]
            _pool_shared_table = SharedZobristTable.attach(shm_name, shm_slots)
        except Exception:
            _pool_shared_table = None


def _pool_worker_collect(args: tuple) -> list[dict]:
    """Worker：加载最新权重 → 采集若干局 → 返回轨迹。

    config tuple: (global_ep, temp_floor, explore_first_moves, explore_temp_mult,
                   dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
    第 7 个元素 win_threshold_override 为可选（None 表示使用线性课程）。
    """
    global _pool_net, _pool_device
    state_dict, configs = args
    _pool_net.load_state_dict(state_dict)
    return [
        collect_episode(
            _pool_net, _pool_device,
            cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5],
            win_threshold_override=cfg[6] if len(cfg) > 6 else None,
        )
        for cfg in configs
    ]


def _normalize_advantages(adv: torch.Tensor, min_std: float = 1e-4) -> torch.Tensor:
    adv = torch.nan_to_num(adv, nan=0.0, posinf=0.0, neginf=0.0)
    adv = torch.clamp(adv, -500.0, 500.0)
    if adv.numel() < 2:
        return torch.clamp(adv, -30.0, 30.0)
    std = adv.std(unbiased=False)
    if float(std) < min_std:
        return torch.clamp(adv, -30.0, 30.0)
    out = (adv - adv.mean()) / (std + 1e-8)
    return torch.clamp(out, -30.0, 30.0)


def _clamp_log_probs_pg(log_probs: torch.Tensor) -> torch.Tensor:
    x = torch.nan_to_num(log_probs, nan=0.0, posinf=0.0, neginf=-50.0)
    return x.clamp(min=-50.0, max=0.0)


def _module_tensors_finite(net: torch.nn.Module, *, check_grads: bool = False) -> bool:
    for p in net.parameters():
        t = p.grad if check_grads else p
        if t is None:
            continue
        if not bool(torch.isfinite(t).all().item()):
            return False
    return True


def _safe_metric(v, *, max_abs: float = 1e6, min_value: float | None = None, max_value: float | None = None) -> float | None:
    if hasattr(v, "detach"):
        try:
            v = v.detach().item()
        except (TypeError, ValueError, RuntimeError):
            return None
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(fv) or abs(fv) > max_abs:
        return None
    if min_value is not None and fv < min_value:
        return None
    if max_value is not None and fv > max_value:
        return None
    return fv


AnyNet = Union[PolicyValueNet, SharedPolicyValueNet, LightPolicyValueNet, LightSharedPolicyValueNet, ConvSharedPolicyValueNet]


class _ValueForward(torch.nn.Module):
    """供 ``data_parallel`` 仅前向价值头（与主网共享参数）。"""

    def __init__(self, net: AnyNet):
        super().__init__()
        self.net = net

    def forward(self, state_feat: torch.Tensor) -> torch.Tensor:
        return self.net.forward_value(state_feat)


class _TrunkForward(torch.nn.Module):
    """供 ``data_parallel`` 切分共享主干 batch（与主网共享参数）。"""

    def __init__(self, net: AnyNet):
        super().__init__()
        self.net = net

    def forward(self, state_feat: torch.Tensor) -> torch.Tensor:
        return self.net.forward_trunk(state_feat)


def _checkpoint_meta(
    net: AnyNet,
    device: torch.device,
    gamma: float,
    lr: float,
    arch: str,
    mlp_ratio: float,
    policy_depth: int,
    value_depth: int,
) -> dict:
    meta: dict = {
        "gamma": gamma,
        "lr": lr,
        "device": str(device),
        "phi_dim": PHI_DIM,
        "state_dim": STATE_FEATURE_DIM,
        "arch": arch,
    }
    if isinstance(net, ConvSharedPolicyValueNet):
        meta["width"] = net.width
        meta["conv_channels"] = net.conv_channels
        meta["action_embed_dim"] = net.action_embed_dim
    elif isinstance(net, LightSharedPolicyValueNet):
        meta["width"] = net.width
        meta["action_embed_dim"] = net.action_embed_dim
    elif isinstance(net, LightPolicyValueNet):
        meta["width"] = net.policy_fc1.out_features
    elif isinstance(net, SharedPolicyValueNet):
        meta["width"] = int(net.shared_stem.out_features)
        meta["shared_depth"] = len(net.shared_blocks)
        meta["policy_depth"] = policy_depth
        meta["value_depth"] = value_depth
        meta["mlp_ratio"] = mlp_ratio
    else:
        meta["width"] = int(net.policy_stem.out_features)
        meta["policy_depth"] = len(net.policy_blocks)
        meta["value_depth"] = len(net.value_blocks)
        meta["mlp_ratio"] = mlp_ratio
    return meta


def build_policy_net(
    arch: str,
    width: int,
    policy_depth: int,
    value_depth: int,
    mlp_ratio: float,
    device: torch.device,
    conv_channels: int = 32,
    use_point_encoder: bool = False,
) -> AnyNet:
    arch = (arch or "conv-shared").lower()
    if arch == "conv-shared":
        return ConvSharedPolicyValueNet(
            width=width,
            conv_channels=conv_channels,
            use_point_encoder=use_point_encoder,
        ).to(device)
    if arch == "light-shared":
        return LightSharedPolicyValueNet(width=width).to(device)
    if arch == "light":
        return LightPolicyValueNet(width=width).to(device)
    if arch == "shared":
        return SharedPolicyValueNet(
            width=width,
            shared_depth=policy_depth,
            mlp_ratio=mlp_ratio,
        ).to(device)
    return PolicyValueNet(
        width=width,
        policy_depth=policy_depth,
        value_depth=value_depth,
        mlp_ratio=mlp_ratio,
    ).to(device)


def _clear_pred_coef() -> float:
    if (raw := os.environ.get("RL_CLEAR_PRED_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("clearPredLossCoef") or 0.15)


def _outcome_value_mix() -> float:
    """v5 默认 1.0（纯 outcome 价值目标）。"""
    ocfg = RL_REWARD_SHAPING.get("outcomeValueMix") or {}
    if (raw := os.environ.get("RL_OUTCOME_VALUE_MIX", "").strip()) != "":
        return float(raw)
    if not ocfg.get("enabled", False):
        return 1.0
    return float(ocfg.get("mix", 1.0))


def _outcome_value_target(score: float, threshold: float) -> float:
    """终局分数价值目标，默认 log 变换以保留 400+ 高分段差异。"""
    ocfg = RL_REWARD_SHAPING.get("outcomeValueMix") or {}
    mode = os.environ.get("RL_OUTCOME_VALUE_MODE", str(ocfg.get("targetMode", "log"))).strip().lower()
    max_value = float(os.environ.get("RL_OUTCOME_VALUE_MAX", str(ocfg.get("maxValue", 3.0))))
    denom = max(float(threshold), 1.0)
    if mode == "linear":
        val = float(score) / denom
    else:
        val = float(np.log1p(max(float(score), 0.0)) / np.log1p(denom))
    return float(np.clip(val, 0.0, max(max_value, 1.0)))


def _board_quality_coef() -> float:
    if (raw := os.environ.get("RL_BQ_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("boardQualityLossCoef") or 0.5)


def _feasibility_coef() -> float:
    if (raw := os.environ.get("RL_FEAS_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("feasibilityLossCoef") or 0.3)


def _survival_coef() -> float:
    if (raw := os.environ.get("RL_SURV_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("survivalLossCoef") or 0.2)


def _topology_aux_coef() -> float:
    if (raw := os.environ.get("RL_TOPO_AUX_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("topologyAuxLossCoef") or 0.0)


def _bonus_clear_aux_coef() -> float:
    if (raw := os.environ.get("RL_BONUS_AUX_COEF", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("bonusClearAux") or {}
    if isinstance(cfg, dict):
        if not cfg.get("enabled", False):
            return 0.0
        return float(cfg.get("coef", 0.08))
    return 0.0


def _scheduled_coef(cfg: dict, base: float, global_ep: int) -> float:
    """线性退火辅助系数；默认不退火。"""
    end = float(cfg.get("annealEndCoef", base))
    episodes = int(cfg.get("annealEpisodes", 0) or 0)
    if episodes <= 0:
        return base
    t = min(1.0, max(0, global_ep) / max(episodes, 1))
    return float(base + (end - base) * t)


def _q_distill_coef(global_ep: int = 0) -> float:
    """Q 分布蒸馏损失系数；来自 rlRewardShaping.qDistillation.coef 或 RL_Q_DISTILL_COEF。"""
    if (raw := os.environ.get("RL_Q_DISTILL_COEF", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    if not cfg.get("enabled", False):
        return 0.0
    return _scheduled_coef(cfg, float(cfg.get("coef", 0.1)), global_ep)


def _q_distill_tau() -> float:
    """Q → target_pi 的软化温度；越小分布越尖锐，越大越均匀。"""
    if (raw := os.environ.get("RL_Q_DISTILL_TAU", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    return float(cfg.get("tau", 1.0))


def _q_distill_norm_mode() -> str:
    if (raw := os.environ.get("RL_Q_DISTILL_NORM", "").strip()) != "":
        return raw.lower()
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    return str(cfg.get("normalize", "zscore")).lower()


def _q_distill_min_std() -> float:
    if (raw := os.environ.get("RL_Q_DISTILL_MIN_STD", "").strip()) != "":
        return max(1e-6, float(raw))
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    return max(1e-6, float(cfg.get("minStd", 0.25)))


def _normalize_teacher_q(qv: np.ndarray, mode: str, min_std: float = 1e-6) -> np.ndarray:
    """单状态 teacher Q 归一化，降低单人分数任务的尺度漂移。"""
    arr = np.asarray(qv, dtype=np.float32)
    if arr.size <= 1 or mode in ("", "none", "raw"):
        return arr
    if mode in ("rank", "ranks"):
        order = np.argsort(arr)
        ranks = np.empty_like(order, dtype=np.float32)
        ranks[order] = np.arange(arr.size, dtype=np.float32)
        return (ranks / max(arr.size - 1, 1)) * 2.0 - 1.0
    mean = float(np.mean(arr))
    std = float(np.std(arr))
    denom = max(std, float(min_std), 1e-6)
    return np.clip((arr - mean) / denom, -4.0, 4.0).astype(np.float32)


def _visit_pi_coef(global_ep: int = 0) -> float:
    """MCTS visit distribution 直接 CE 蒸馏系数；区别于 beam Q distillation。"""
    if (raw := os.environ.get("RL_VISIT_PI_COEF", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("visitPiDistillation") or {}
    if not cfg.get("enabled", False):
        return 0.0
    return _scheduled_coef(cfg, float(cfg.get("coef", 0.15)), global_ep)


def _visit_pi_tau() -> float:
    if (raw := os.environ.get("RL_VISIT_PI_TAU", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("visitPiDistillation") or {}
    return float(cfg.get("tau", 1.0))


def _ranked_reward_config() -> dict:
    """单人自博弈 ranked reward：把绝对分数转为相对分位奖励，缓解 400-500 平台期。"""
    cfg = {
        "enabled": False,
        "window": 2048,
        "warmup": 128,
        "targetPercentile": 0.50,
        "targetPercentileEnd": 0.70,
        "rampEpisodes": 30000,
        "deadband": 0.04,
        "bonusScale": 14.0,
        "penaltyScale": 6.0,
        "maxAbs": 16.0,
    }
    cfg.update(RL_REWARD_SHAPING.get("rankedReward") or {})
    raw = os.environ.get("RL_RANKED_REWARD", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        cfg["enabled"] = True
    elif raw in ("0", "false", "no", "off"):
        cfg["enabled"] = False
    for key, env_key, cast in (
        ("window", "RL_RANKED_WINDOW", int),
        ("warmup", "RL_RANKED_WARMUP", int),
        ("targetPercentile", "RL_RANKED_TARGET", float),
        ("targetPercentileEnd", "RL_RANKED_TARGET_END", float),
        ("rampEpisodes", "RL_RANKED_RAMP_EPISODES", int),
        ("deadband", "RL_RANKED_DEADBAND", float),
        ("bonusScale", "RL_RANKED_BONUS_SCALE", float),
        ("penaltyScale", "RL_RANKED_PENALTY_SCALE", float),
        ("maxAbs", "RL_RANKED_MAX_ABS", float),
    ):
        if (raw_v := os.environ.get(env_key, "").strip()) != "":
            cfg[key] = cast(raw_v)
    cfg["window"] = max(16, int(cfg["window"]))
    cfg["warmup"] = max(0, int(cfg["warmup"]))
    cfg["targetPercentile"] = float(np.clip(float(cfg["targetPercentile"]), 0.05, 0.95))
    cfg["targetPercentileEnd"] = float(np.clip(float(cfg["targetPercentileEnd"]), 0.05, 0.95))
    cfg["rampEpisodes"] = max(1, int(cfg["rampEpisodes"]))
    cfg["deadband"] = max(0.0, float(cfg["deadband"]))
    cfg["maxAbs"] = max(0.0, float(cfg["maxAbs"]))
    return cfg


def _ranked_reward_target_for_episode(global_ep: int, cfg: dict) -> float:
    start = float(cfg.get("targetPercentile", 0.5))
    end = float(cfg.get("targetPercentileEnd", start))
    span = max(1, int(cfg.get("rampEpisodes", 30000)))
    t = min(1.0, max(0, global_ep) / span)
    return float(np.clip(start + (end - start) * t, 0.05, 0.95))


def _ranked_reward_for_score(score: float, score_history, cfg: dict) -> tuple[float, float]:
    """返回 (reward_adjustment, percentile)。history 只使用过去局，避免同批自比较。"""
    n = len(score_history)
    if n < int(cfg.get("warmup", 0)):
        return 0.0, 0.5
    hist = np.asarray(score_history, dtype=np.float32)
    lt = float(np.sum(hist < score))
    eq = float(np.sum(hist == score))
    pct = (lt + 0.5 * eq) / max(1.0, float(n))
    target = float(cfg.get("targetPercentile", 0.5))
    deadband = float(cfg.get("deadband", 0.04))
    delta = pct - target
    if abs(delta) <= deadband:
        return 0.0, pct
    if delta > 0:
        denom = max(1e-6, 1.0 - target - deadband)
        reward = float(cfg.get("bonusScale", 14.0)) * ((delta - deadband) / denom)
    else:
        denom = max(1e-6, target - deadband)
        reward = -float(cfg.get("penaltyScale", 6.0)) * ((-delta - deadband) / denom)
    max_abs = float(cfg.get("maxAbs", 16.0))
    if max_abs > 0:
        reward = float(np.clip(reward, -max_abs, max_abs))
    return reward, pct


def _remaining_unplaced_dock_blocks(sim: OpenBlockSimulator) -> int:
    """当前 dock 中尚未放置的块数；dock 元素本身不会因 placed 变成 None。"""
    return sum(1 for b in sim.dock if b is not None and not bool(b.get("placed", False)))


def _mcts_risk_adaptive_sims(sim: OpenBlockSimulator, legal: list[dict], base_sims: int, cfg: dict) -> int:
    """高风险局面提升 MCTS sims，普通局面节省预算。"""
    raw_enabled = os.environ.get("RL_MCTS_RISK_ADAPTIVE", "").strip().lower()
    enabled = (
        raw_enabled not in ("0", "false", "no", "off")
        if raw_enabled
        else bool(cfg.get("riskAdaptive", False))
    )
    if not enabled:
        return base_sims
    gnp = sim._ensure_grid_np()
    fill = float(np.mean(gnp >= 0))
    mobility = len(legal)
    risk = 0.0
    if fill >= float(cfg.get("riskFill", 0.58)):
        risk += 0.35
    if mobility <= int(cfg.get("riskMobility", 16)):
        risk += 0.35
    try:
        if sim.count_sequential_solution_leaves(leaf_cap=2, node_budget=500) <= 1:
            risk += 0.30
    except Exception:
        pass
    mult = 1.0 + min(1.0, risk) * (float(cfg.get("riskMaxMultiplier", 2.0)) - 1.0)
    max_sims = int(os.environ.get("RL_MCTS_MAX_SIMS", int(cfg.get("maxSimulations", max(base_sims, 80)))))
    return max(base_sims, min(max_sims, int(round(base_sims * mult))))


def _beam3_risk_adaptive_params(sim: OpenBlockSimulator, legal: list[dict], cfg: dict) -> tuple[int, int, int, int, float]:
    """高风险局面动态提高 3-ply beam 宽度；普通局保持默认吞吐。"""
    top_k = int(cfg.get("topK", 15))
    top_k2 = int(cfg.get("topK2", 5))
    max_actions = int(cfg.get("maxActions", 100))
    max_actions2 = int(cfg.get("maxActions2", 50))
    raw_enabled = os.environ.get("RL_BEAM_RISK_ADAPTIVE", "").strip().lower()
    enabled = (
        raw_enabled not in ("0", "false", "no", "off")
        if raw_enabled
        else bool(cfg.get("riskAdaptive", False))
    )
    if not enabled:
        return top_k, max_actions, top_k2, max_actions2, 0.0

    gnp = sim._ensure_grid_np()
    fill = float(np.mean(gnp >= 0))
    mobility = len(legal)
    risk = 0.0
    if fill >= float(cfg.get("riskFill", 0.56)):
        risk += 0.35
    if mobility <= int(cfg.get("riskMobility", 18)):
        risk += 0.35
    try:
        leaves = sim.count_sequential_solution_leaves(leaf_cap=2, node_budget=600)
        if leaves <= int(cfg.get("riskLeafCount", 1)):
            risk += 0.30
    except Exception:
        pass

    risk = float(np.clip(risk, 0.0, 1.0))
    mult = 1.0 + risk * (float(cfg.get("riskMaxMultiplier", 1.8)) - 1.0)
    max_top_k = int(cfg.get("riskTopKMax", max(top_k, 24)))
    max_top_k2 = int(cfg.get("riskTopK2Max", max(top_k2, 8)))
    max_a = int(cfg.get("riskMaxActionsMax", max(max_actions, 140)))
    max_a2 = int(cfg.get("riskMaxActions2Max", max(max_actions2, 80)))
    return (
        min(max_top_k, max(top_k, int(round(top_k * mult)))),
        min(max_a, max(max_actions, int(round(max_actions * mult)))),
        min(max_top_k2, max(top_k2, int(round(top_k2 * mult)))),
        min(max_a2, max(max_actions2, int(round(max_actions2 * mult)))),
        risk,
    )


def _replay_config() -> dict:
    cfg = {
        "enabled": False,
        "maxEpisodes": 256,
        "sampleRatio": 0.5,
        "maxSamples": 8,
        "minPriority": 0.0,
    }
    cfg.update(RL_REWARD_SHAPING.get("searchReplay") or {})
    raw = os.environ.get("RL_SEARCH_REPLAY", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        cfg["enabled"] = True
    elif raw in ("0", "false", "no", "off"):
        cfg["enabled"] = False
    return cfg


def _episode_replay_priority(ep: dict) -> float:
    traj = ep.get("trajectory") or []
    score = float(ep.get("score", 0.0))
    priority = score / 100.0
    if traj:
        tail = traj[-min(5, len(traj)):]
        priority += 0.5 * sum(1 for s in tail if float(s.get("feasibility", 1.0)) < 0.5)
        priority += 0.25 * sum(1 for s in tail if int(s.get("clears", 0)) <= 0)
    if not ep.get("won", False):
        priority += 1.0
    return float(priority)


def _lr_warmup(step: int, warmup_steps: int, base_lr: float) -> float:
    if warmup_steps <= 0 or step >= warmup_steps:
        return base_lr
    return base_lr * (step + 1) / warmup_steps


def _hole_aux_coef_and_denom() -> tuple[float, float]:
    """空洞辅助损失：系数来自 rlRewardShaping.holeAuxLossCoef 或 RL_HOLE_AUX_COEF；目标除以 holeAuxTargetMax / maxHoles。"""
    if (raw := os.environ.get("RL_HOLE_AUX_COEF", "").strip()) != "":
        coef = float(raw)
    else:
        coef = float(RL_REWARD_SHAPING.get("holeAuxLossCoef") or 0.0)
    raw_max = RL_REWARD_SHAPING.get("holeAuxTargetMax")
    if raw_max is not None:
        denom = float(raw_max)
    else:
        denom = float((FEATURE_ENCODING.get("actionNorm") or {}).get("maxHoles") or 16.0)
    return coef, max(denom, 1e-6)


def _effective_entropy_coef(global_ep: int, base: float) -> float:
    """随局数线性降低熵系数；衰减周期与课程爬坡对齐。"""
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.008"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "60000"))
    if span <= 0 or base <= lo:
        return base
    t = min(1.0, max(0, global_ep) / span)
    return base - (base - lo) * t


def _dirichlet_epsilon_for_ep(global_ep: int, base: float) -> float:
    """随训练局数降低 Dirichlet 混合权重，减轻后期无效探索（可用 RL_DIRICHLET_DECAY_EPISODES=0 关闭衰减）。"""
    span = float(os.environ.get("RL_DIRICHLET_DECAY_EPISODES", "25000"))
    end = float(os.environ.get("RL_DIRICHLET_EPS_END", "0.06"))
    if span <= 0 or base <= end:
        return base
    t = min(1.0, max(0, global_ep - 1) / span)
    return end + (base - end) * (1.0 - t)


def _temperature_for_move(global_ep: int, step_idx: int, temp_floor: float, explore_first_moves: int, explore_mult: float) -> float:
    decay_rate = float(os.environ.get("RL_TEMP_DECAY_RATE", "0.00005"))
    base = max(temp_floor, 1.0 - global_ep * decay_rate)
    if explore_first_moves > 0 and step_idx < explore_first_moves:
        base *= explore_mult
    return max(temp_floor, base)


def _mix_dirichlet_and_sample(
    logits: torch.Tensor,
    temperature: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    if temperature > 1e-6:
        logits = logits / temperature
    probs = F.softmax(logits, dim=-1)
    n = probs.shape[0]
    if dirichlet_epsilon > 1e-8 and dirichlet_alpha > 1e-8 and n > 0:
        conc = max(1e-4, float(dirichlet_alpha) / max(n, 1))
        conc_t = torch.full((n,), conc, dtype=logits.dtype)
        # PyTorch MPS 未实现 Dirichlet 采样，CPU 采样后拷回
        if logits.device.type == "mps":
            d = Dirichlet(conc_t.cpu())
            noise = d.sample().to(logits.device, dtype=logits.dtype)
        else:
            d = Dirichlet(conc_t.to(logits.device))
            noise = d.sample()
        probs = (1.0 - dirichlet_epsilon) * probs + dirichlet_epsilon * noise
        probs = probs / probs.sum().clamp_min(1e-10)
    dist = Categorical(probs=probs.clamp_min(1e-10))
    idx = dist.sample()
    log_p = dist.log_prob(idx)
    ent = dist.entropy()
    return idx, log_p, ent


def compute_gae_advantages_and_returns(
    rewards: list[float],
    values: torch.Tensor,
    gamma: float,
    lam: float,
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    """GAE(λ)；returns = adv + V(s) 作为价值头目标。"""
    t = len(rewards)
    if t == 0:
        z = torch.zeros(0, device=device, dtype=torch.float32)
        return z, z
    r = tensor_to_device(torch.tensor(rewards, dtype=torch.float32), device)
    v = values.detach().reshape(-1)[:t]
    if v.shape[0] < t:
        v = F.pad(v, (0, t - v.shape[0]))
    next_v = torch.zeros(t, device=device, dtype=torch.float32)
    if t > 1:
        next_v[:-1] = v[1:]
    deltas = r + gamma * next_v - v
    adv = torch.zeros(t, device=device, dtype=torch.float32)
    gae_acc = 0.0
    for i in range(t - 1, -1, -1):
        gae_acc = float(deltas[i].item()) + gamma * lam * gae_acc
        adv[i] = gae_acc
    rets = adv + v
    return adv, rets


def _lookahead_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
) -> np.ndarray | None:
    """1-step lookahead: Q(s,a) = r(s,a) + γ·V(s')。

    对每个合法动作模拟一步，评估后继状态的 V(s')。
    返回 Q 值数组；若动作数过多（>150）则跳过以节约时间。
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > 150:
        return None

    saved = sim.save_state()
    rewards = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)

    for i, a in enumerate(legal):
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        rewards[i] = r
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v_next = net.forward_value(ns_t).cpu().numpy()

    return rewards + gamma * v_next


def _beam_2ply_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
    top_k: int = 15,
    max_actions: int = 100,
) -> np.ndarray | None:
    """三块组合 2-ply beam 搜索：Q_2ply(s,a1) = r1 + γ · max_{a2}[r2 + γ·V(s'')]。

    针对 Block Puzzle 一轮三块的强耦合特性——当 dock 仍有 ≥2 块时，展开第二层
    以捕捉跨块放置的协同效应。具体流程：

      1. 第一层（全部动作）：计算 r1 + γ·V(s') → Q_1ply
      2. 按 Q_1ply 选出 top-k 动作做第二层展开
      3. 第二层所有 s'' 合并批量推理（单次 GPU forward），避免循环内多次调用
      4. 其余动作保持 Q_1ply 值（退化为 1-step）

    Guard 条件：
      - n_actions > max_actions：直接返回 None（同 1-step 的 >150 保护）
      - dock 剩余块 < 2：退化为 1-step lookahead（2-ply 无意义）
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > max_actions:
        return None

    # dock 仅剩 ≤1 块时，2-ply 无额外信息，退化为 1-step
    blocks_remain = _remaining_unplaced_dock_blocks(sim)
    if blocks_remain < 2:
        return _lookahead_q_values(net, device, sim, legal, gamma)

    saved = sim.save_state()

    # ——— 第一层：计算所有动作的 r1 + V(s') ———
    r1_arr = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
    for i, a in enumerate(legal):
        r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v1 = net.forward_value(ns_t).cpu().numpy().flatten()

    q1 = r1_arr + gamma * v1
    q2ply = q1.copy()

    # ——— 第二层：对 top-k 批量收集所有 s'' 再统一推理 ———
    top_k_actual = min(top_k, n_actions)
    top_k_idxs = np.argsort(q1)[-top_k_actual:]

    # 结构：(action_index, r1, r2_arr, ns2_states)
    ply2_batches: list[tuple[int, float, np.ndarray, np.ndarray]] = []

    for i in top_k_idxs:
        a1 = legal[int(i)]
        r1 = float(sim.step(a1["block_idx"], a1["gx"], a1["gy"]))
        legal2 = sim.get_legal_actions()

        if not legal2:
            q2ply[i] = r1  # 第一步后已终局，V=0
            sim.restore_state(saved)
            continue

        n2 = len(legal2)
        saved2 = sim.save_state()
        r2_arr = np.empty(n2, dtype=np.float32)
        ns2 = np.empty((n2, STATE_FEATURE_DIM), dtype=np.float32)
        for j, a2 in enumerate(legal2):
            r2_arr[j] = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            ns2[j] = extract_state_features(sim.grid, sim.dock)
            sim.restore_state(saved2)

        ply2_batches.append((int(i), r1, r2_arr, ns2))
        sim.restore_state(saved)

    if ply2_batches:
        # 合并所有 s'' 做一次批量 V 推理
        all_ns2 = np.concatenate([b[3] for b in ply2_batches], axis=0)
        with torch.no_grad():
            ns2_t = tensor_to_device(torch.from_numpy(all_ns2), device)
            all_v2 = net.forward_value(ns2_t).cpu().numpy().flatten()

        offset = 0
        for (i, r1, r2_arr, _ns2) in ply2_batches:
            n2 = len(r2_arr)
            v2 = all_v2[offset : offset + n2]
            q2ply[i] = r1 + gamma * float(np.max(r2_arr + gamma * v2))
            offset += n2

    return q2ply


def _beam_3ply_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
    top_k: int = 15,
    max_actions: int = 100,
    top_k2: int = 5,
    max_actions2: int = 50,
) -> np.ndarray | None:
    """三块全排列 3-ply beam：Q_3ply(s,a1) = r1+γ·max_{a2}[r2+γ·max_{a3}[r3+γ·V(s''')]].

    扩展 2-ply：对 top_k 中的每个 a1，再对 top_k2 个 a2 展开第三层，
    全部 s''' 合并一次批量 V 推理。

    Guard 条件：
      - dock 剩余块 < 3：退化为 2-ply（仍有意义）或 1-step（仅 1 块时）
      - n_actions > max_actions：直接返回 None
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > max_actions:
        return None

    blocks_remain = _remaining_unplaced_dock_blocks(sim)
    if blocks_remain < 3:
        # 退化为 2-ply（或 1-step）
        return _beam_2ply_q_values(net, device, sim, legal, gamma, top_k, max_actions)

    saved = sim.save_state()

    # ——— 第一层：计算所有动作的 r1 + V(s') ———
    r1_arr = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
    for i, a in enumerate(legal):
        r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v1 = net.forward_value(ns_t).cpu().numpy().flatten()

    q1 = r1_arr + gamma * v1
    q3ply = q1.copy()

    top_k_actual = min(top_k, n_actions)
    top_k_idxs = np.argsort(q1)[-top_k_actual:]

    # ——— 第二 / 三层批量收集 ———
    # ply3_items: (a1_idx, r1, a2_idx_local, r2, ns3_states_2d)
    ply2_best: dict[int, tuple[float, np.ndarray, np.ndarray]] = {}  # a1→(r1, r2_arr, ns2)

    for i in top_k_idxs:
        a1 = legal[int(i)]
        r1 = float(sim.step(a1["block_idx"], a1["gx"], a1["gy"]))
        legal2 = sim.get_legal_actions()

        if not legal2 or len(legal2) > max_actions2:
            q3ply[i] = r1
            sim.restore_state(saved)
            continue

        n2 = len(legal2)
        saved2 = sim.save_state()
        r2_arr = np.empty(n2, dtype=np.float32)
        ns2 = np.empty((n2, STATE_FEATURE_DIM), dtype=np.float32)
        for j, a2 in enumerate(legal2):
            r2_arr[j] = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            ns2[j] = extract_state_features(sim.grid, sim.dock)
            sim.restore_state(saved2)

        ply2_best[int(i)] = (r1, r2_arr, ns2)
        sim.restore_state(saved)

    if not ply2_best:
        return q3ply

    # ——— 第二层 V 批量推理（确定 top_k2 ）———
    all_ns2_concat = np.concatenate([v[2] for v in ply2_best.values()], axis=0)
    with torch.no_grad():
        ns2_t = tensor_to_device(torch.from_numpy(all_ns2_concat), device)
        all_v2 = net.forward_value(ns2_t).cpu().numpy().flatten()

    # ply3_batches: (a1_idx, r1, r2, r3_arr, ns3_states)
    ply3_batches: list[tuple[int, float, float, np.ndarray, np.ndarray]] = []
    v2_offset = 0
    q2_map: dict[int, tuple[float, np.ndarray]] = {}  # a1→(r1, q2_arr)
    for i, (r1, r2_arr, ns2) in ply2_best.items():
        n2 = len(r2_arr)
        v2 = all_v2[v2_offset: v2_offset + n2]
        q2_arr = r2_arr + gamma * v2
        q2_map[i] = (r1, q2_arr)
        v2_offset += n2

    # 对每个 a1，选 top_k2 个 a2 展开第三层
    for i, (r1, q2_arr) in q2_map.items():
        n2 = len(q2_arr)
        top_k2_actual = min(top_k2, n2)
        top2_idxs = np.argsort(q2_arr)[-top_k2_actual:]

        # 需要重新模拟以收集 ns3
        a1 = legal[i]
        sim.step(a1["block_idx"], a1["gx"], a1["gy"])
        legal2_cur = sim.get_legal_actions()
        if not legal2_cur:
            q3ply[i] = r1
            sim.restore_state(saved)
            continue

        saved2 = sim.save_state()
        for j in top2_idxs:
            if j >= len(legal2_cur):
                sim.restore_state(saved2)
                continue
            a2 = legal2_cur[j]
            r2_val = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            legal3 = sim.get_legal_actions()

            if not legal3:
                ply3_batches.append((
                    i,
                    r1,
                    r2_val,
                    np.empty(0, dtype=np.float32),
                    np.empty((0, STATE_FEATURE_DIM), dtype=np.float32),
                ))
                sim.restore_state(saved2)
                continue

            n3 = len(legal3)
            saved3 = sim.save_state()
            r3_arr = np.empty(n3, dtype=np.float32)
            ns3 = np.empty((n3, STATE_FEATURE_DIM), dtype=np.float32)
            for k, a3 in enumerate(legal3):
                r3_arr[k] = float(sim.step(a3["block_idx"], a3["gx"], a3["gy"]))
                ns3[k] = extract_state_features(sim.grid, sim.dock)
                sim.restore_state(saved3)
            ply3_batches.append((i, r1, r2_val, r3_arr, ns3))
            sim.restore_state(saved2)
        sim.restore_state(saved)

    if ply3_batches:
        # 合并所有 ns3 做一次批量推理
        ns3_list = []
        for _, _, _, _r3_arr, ns3 in ply3_batches:
            if ns3.shape[0] > 0:
                ns3_list.append(ns3)
        all_v3 = np.empty(0, dtype=np.float32)
        if ns3_list:
            all_ns3 = np.concatenate(ns3_list, axis=0)
            with torch.no_grad():
                ns3_t = tensor_to_device(torch.from_numpy(all_ns3), device)
                all_v3 = net.forward_value(ns3_t).cpu().numpy().flatten()

        v3_off = 0
        # 用 a1-level 的 best_q3 dict 做 max 聚合
        best_q3: dict[int, float] = {}
        for (i, r1, r2_val, r3_arr, ns3) in ply3_batches:
            if ns3.shape[0] <= 0:
                q3_val = r2_val  # 第三层无动作，V=0
            else:
                n3 = len(r3_arr)
                v3 = all_v3[v3_off: v3_off + n3]
                q3_val = float(r2_val + gamma * np.max(r3_arr + gamma * v3))
                v3_off += n3
            # 对同一 a1，取不同 a2 的最大 q3_val
            if i not in best_q3 or q3_val > best_q3[i]:
                best_q3[i] = q3_val

        for i, q3_best in best_q3.items():
            r1 = q2_map[i][0]
            q3ply[i] = r1 + gamma * q3_best

    return q3ply


# ---------------------------------------------------------------------------
# 进程级 Zobrist 缓存单例（v8.2）
# ---------------------------------------------------------------------------
_GLOBAL_ZOBRIST_CACHE: "ZobristCache | None" = None  # type: ignore[name-defined]


def _get_global_zobrist_cache():
    """返回进程唯一的 ZobristCache 实例（含可选 SharedZobristTable 后端）。

    大小由 RL_ZOBRIST_CACHE_SIZE 环境变量控制（0 或负数则禁用本地缓存）。
    game_rules.json lightMCTS.zobristCacheSize 作为默认值（5000）。
    若 worker 进程已初始化 _pool_shared_table，将其挂载为跨进程共享后端。
    """
    global _GLOBAL_ZOBRIST_CACHE
    if _GLOBAL_ZOBRIST_CACHE is not None:
        return _GLOBAL_ZOBRIST_CACHE

    # 读取配置（game_rules._DATA 的顶层 lightMCTS 节点）
    from .game_rules import _DATA as _GR_DATA  # type: ignore[attr-defined]
    rules = _GR_DATA.get("lightMCTS", {})
    default_size = int(rules.get("zobristCacheSize", 5000))
    size = int(os.environ.get("RL_ZOBRIST_CACHE_SIZE", default_size))
    if size <= 0:
        return None   # 禁用本地缓存

    from .mcts import ZobristHasher, _make_zobrist_cache_with_shared  # type: ignore[attr-defined]
    hasher = ZobristHasher(grid_size=8)
    # 挂载跨进程共享表（仅 worker 进程附加了 _pool_shared_table）
    shared_tbl = globals().get("_pool_shared_table", None)
    _GLOBAL_ZOBRIST_CACHE = _make_zobrist_cache_with_shared(
        hasher, local_size=size, shared_table=shared_tbl
    )
    return _GLOBAL_ZOBRIST_CACHE


def collect_episode(
    net: AnyNet,
    device: torch.device,
    global_ep: int,
    temp_floor: float,
    explore_first_moves: int,
    explore_temp_mult: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
    win_threshold_override: int | None = None,
) -> dict:
    """no_grad 采集：只存 numpy，不建计算图；更新时由 GPU 批量再评估。

    新增参数 win_threshold_override：自适应课程时由 train_loop 动态传入，
    覆盖基于 global_ep 的线性计算结果。
    """
    sim = OpenBlockSimulator("normal")
    if win_threshold_override is not None:
        sim.win_score_threshold = win_threshold_override
    else:
        sim.win_score_threshold = rl_win_threshold_for_episode(global_ep)
    trajectory: list[dict] = []
    gamma = float(os.environ.get("RL_GAMMA", "0.99"))
    use_lookahead = os.environ.get("RL_LOOKAHEAD", "1").lower() not in ("0", "false", "no")
    lookahead_mix = float(os.environ.get("RL_LOOKAHEAD_MIX", "0.5"))

    # --- 搜索策略选择（优先级：MCTS > 3-ply beam > 2-ply beam > 1-step）---
    _mcts_cfg = RL_REWARD_SHAPING.get("lightMCTS") or {}
    use_mcts = (
        _mcts_cfg.get("enabled", False)
        or os.environ.get("RL_MCTS", "0").lower() not in ("0", "false", "no")
    )
    # 显式 RL_MCTS=0 时强制关闭（否则 game_rules 里 lightMCTS.enabled 无法局部关掉）
    _mcts_env_neg = os.environ.get("RL_MCTS", "").strip().lower()
    if _mcts_env_neg in ("0", "false", "no", "off"):
        use_mcts = False
    _mcts_sims = int(_mcts_cfg.get("numSimulations", 20))
    _mcts_cpuct = float(_mcts_cfg.get("cPuct", 1.5))
    _mcts_depth = int(_mcts_cfg.get("maxDepth", 8))
    # v8.1：MCTS 树复用 + 多温度采样 + SpawnPredictor
    _use_mcts_reuse = (
        use_mcts
        and os.environ.get("RL_MCTS_REUSE", "1").lower() not in ("0", "false", "no")
    )
    _mcts_train_temp = float(os.environ.get("RL_MCTS_TRAIN_TEMP", "1.0"))
    _spawn_pred: "SpawnPredictor | None" = None
    if use_mcts and os.environ.get("RL_MCTS_STOCHASTIC", "0") not in ("0", "false", "no"):
        from .spawn_predictor import SpawnPredictor as _SP
        _spawn_pred = _SP.load(device=device)
    # v8.3：渐进式模拟次数（默认跟 game_rules lightMCTS.adaptiveSims；显式 RL_MCTS_ADAPTIVE 覆盖）
    _adapt_env = os.environ.get("RL_MCTS_ADAPTIVE", "").strip().lower()
    if _adapt_env in ("0", "false", "no", "off"):
        _mcts_adaptive = False
    elif _adapt_env in ("1", "true", "yes", "on"):
        _mcts_adaptive = bool(use_mcts)
    else:
        _mcts_adaptive = bool(use_mcts and _mcts_cfg.get("adaptiveSims", False))
    _mcts_min_sims = int(os.environ.get("RL_MCTS_MIN_SIMS", max(10, _mcts_sims // 4)))
    _mcts_confidence = float(os.environ.get("RL_MCTS_CONFIDENCE", "3.0"))

    _beam3ply_cfg = RL_REWARD_SHAPING.get("beam3ply") or {}
    use_beam3ply = (
        (_beam3ply_cfg.get("enabled", False)
         or os.environ.get("RL_BEAM3PLY", "0").lower() not in ("0", "false", "no"))
        and not use_mcts
    )
    _b3_topk = int(_beam3ply_cfg.get("topK", 15))
    _b3_topk2 = int(_beam3ply_cfg.get("topK2", 5))
    _b3_max = int(_beam3ply_cfg.get("maxActions", 100))
    _b3_max2 = int(_beam3ply_cfg.get("maxActions2", 50))

    _beam2ply_cfg = RL_REWARD_SHAPING.get("beam2ply") or {}
    use_beam2ply = (
        _beam2ply_cfg.get("enabled", True)
        and os.environ.get("RL_BEAM2PLY", "1").lower() not in ("0", "false", "no")
        and not use_mcts and not use_beam3ply
    )
    _beam2ply_topk = int(_beam2ply_cfg.get("topK", 15))
    _beam2ply_max_actions = int(_beam2ply_cfg.get("maxActions", 100))

    # MCTS 树状态（跨步复用 + 可选 Zobrist 跨局热启动）
    from .mcts import MCTSTreeState as _MCTSTreeState, select_action_from_visits as _select_mcts
    if _use_mcts_reuse:
        _zobrist_cache = _get_global_zobrist_cache()   # 进程级单例
        _mcts_tree = _MCTSTreeState(zobrist_cache=_zobrist_cache)
        _mcts_tree.try_warm_start(sim)                 # 尝试从缓存热启动
    else:
        _mcts_tree = None
    _prev_dock_remain: int = _remaining_unplaced_dock_blocks(sim)

    step_idx = 0
    while True:
        if sim.is_terminal():
            break
        legal = sim.get_legal_actions()
        if not legal:
            break

        state_np, phi_np = build_phi_batch(sim, legal)
        if phi_np.shape[0] == 0:
            break

        with torch.no_grad():
            phi = tensor_to_device(torch.from_numpy(phi_np), device)
            logits = net.forward_policy_logits(phi)

        # dock 刷新检测（三块放完后 dock 重新生成）→ 失效树复用
        cur_dock_remain = _remaining_unplaced_dock_blocks(sim)
        if _mcts_tree is not None and cur_dock_remain > _prev_dock_remain:
            _mcts_tree.invalidate()
        _prev_dock_remain = cur_dock_remain

        q_vals = None
        _visit_pi = None
        _beam_risk = 0.0
        if use_lookahead and step_idx >= explore_first_moves:
            if use_mcts:
                mcts_sims_eff = _mcts_risk_adaptive_sims(sim, legal, _mcts_sims, _mcts_cfg)
                if _mcts_adaptive:
                    # v8.3：渐进式模拟次数（adaptive sims）
                    from .mcts import run_mcts_adaptive as _adaptive_fn
                    _visit_pi, _sims_used = _adaptive_fn(
                        net, device, sim,
                        min_sims=_mcts_min_sims,
                        max_sims=mcts_sims_eff,
                        confidence_ratio=_mcts_confidence,
                        c_puct=_mcts_cpuct,
                        max_depth=_mcts_depth,
                        tree_state=_mcts_tree,
                        spawn_predictor=_spawn_pred,
                    )
                    if _visit_pi is not None:
                        eps = 1.0 / max(len(_visit_pi) * 10, 100)
                        q_arr = np.log(_visit_pi + eps)
                        q_arr -= q_arr.mean()
                        q_vals = q_arr
                else:
                    # 轻量 MCTS：访问分布→伪 Q 值（类 AlphaZero 策略目标）
                    from .mcts import mcts_q_proxy as _mcts_fn
                    q_vals = _mcts_fn(
                        net, device, sim,
                        n_simulations=mcts_sims_eff,
                        c_puct=_mcts_cpuct,
                        max_depth=_mcts_depth,
                        gamma=gamma,
                        spawn_predictor=_spawn_pred,
                        tree_state=_mcts_tree,
                    )
                # 获取原始访问分布（用于温度采样）
                if _mcts_tree is not None and _mcts_tree.root is not None:
                    from .mcts import _extract_visit_pi as _evp
                    _visit_pi = _evp(_mcts_tree.root, len(legal))
            elif use_beam3ply:
                # 3-ply beam：还有 3 个未放置 dock 块时展开，否则自动退化为 2-ply/1-step
                _b3_topk_eff, _b3_max_eff, _b3_topk2_eff, _b3_max2_eff, _beam_risk = _beam3_risk_adaptive_params(
                    sim, legal, _beam3ply_cfg
                )
                q_vals = _beam_3ply_q_values(
                    net, device, sim, legal, gamma,
                    top_k=_b3_topk_eff, max_actions=_b3_max_eff,
                    top_k2=_b3_topk2_eff, max_actions2=_b3_max2_eff,
                )
            elif use_beam2ply:
                # 2-ply beam：当 dock≥2 块时展开第二层，否则自动退化为 1-step
                q_vals = _beam_2ply_q_values(
                    net, device, sim, legal, gamma,
                    top_k=_beam2ply_topk,
                    max_actions=_beam2ply_max_actions,
                )
            else:
                q_vals = _lookahead_q_values(net, device, sim, legal, gamma)

        if q_vals is not None:
            q_t = tensor_to_device(torch.from_numpy(q_vals), device)
            q_logits = q_t / max(temp_floor, 0.1)
            combined = (1.0 - lookahead_mix) * logits + lookahead_mix * q_logits
        else:
            combined = logits

        temp = _temperature_for_move(
            global_ep, step_idx, temp_floor, explore_first_moves, explore_temp_mult
        )
        d_eps = _dirichlet_epsilon_for_ep(global_ep, dirichlet_epsilon)

        # --- 多温度动作选择 ---
        # MCTS 模式：优先用访问分布按温度采样（AlphaZero 风格）
        # 非 MCTS 模式：沿用原有 Dirichlet + softmax 采样
        if use_mcts and _visit_pi is not None:
            visit = np.asarray(_visit_pi, dtype=np.float64)
            if _mcts_train_temp <= 1e-6:
                chosen = int(np.argmax(visit))
                old_log_prob = 0.0
            else:
                visit_adj = np.power(visit + 1e-10, 1.0 / max(_mcts_train_temp, 1e-6))
                s = float(visit_adj.sum())
                if s <= 1e-12:
                    chosen = int(np.argmax(visit))
                    old_log_prob = 0.0
                else:
                    visit_adj = visit_adj / s
                    chosen = int(np.random.choice(len(visit_adj), p=visit_adj))
                    old_log_prob = float(np.log(max(visit_adj[chosen], 1e-10)))
        else:
            idx, old_lp_t, _ = _mix_dirichlet_and_sample(
                combined, temp, d_eps, dirichlet_alpha
            )
            chosen = int(idx.item())
            old_log_prob = float(old_lp_t.item())

        a = legal[chosen]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        clears_step = min(getattr(sim, "_last_clears", 0), 3)
        bonus_lines_step = min(getattr(sim, "_last_bonus_lines", 0), 3)

        # MCTS 树复用：推进树根到已选动作的子节点
        if _mcts_tree is not None:
            _mcts_tree.advance(chosen)

        sup = sim.get_supervision_signals()
        trajectory.append({
            "state": state_np.copy(),
            "action_feats": phi_np[:, STATE_FEATURE_DIM:].copy(),
            "n_actions": phi_np.shape[0],
            "chosen_idx": chosen,
            "reward": r,
            "old_log_prob": old_log_prob,
            "holes_after": int(sim.count_holes()),
            "clears": clears_step,
            "bonus_lines": bonus_lines_step,
            "board_quality": sup["board_quality"],
            "feasibility": sup["feasibility"],
            "topology_after": sup.get("topology_after"),
            # Q 分布蒸馏目标：MCTS 访问分布 or beam Q 值
            "q_vals": q_vals.tolist() if q_vals is not None else None,
            # MCTS 访问分布（visit_pi）：用于直接 CE 损失（可选，比 q_proxy 更准确）
            "visit_pi": _visit_pi.tolist() if _visit_pi is not None else None,
            "teacher_beam_risk": float(_beam_risk),
        })
        step_idx += 1

    won = sim.score >= sim.win_score_threshold
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if trajectory and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        trajectory[-1]["reward"] += sp

    # 局末将当前根节点存入 Zobrist 缓存（供下局热启动）
    if _mcts_tree is not None:
        _mcts_tree.flush_to_cache()

    total = len(trajectory)
    for i in range(total):
        trajectory[i]["steps_to_end"] = total - i - 1

    return {
        "trajectory": trajectory,
        "score": sim.score,
        "steps": sim.steps,
        "clears": sim.total_clears,
        "won": won,
        "win_threshold": int(sim.win_score_threshold),
    }


def episode_returns(rewards: list[float], gamma: float) -> torch.Tensor:
    g = 0.0
    out: list[float] = []
    for r in reversed(rewards):
        g = r + gamma * g
        out.append(g)
    out.reverse()
    return torch.tensor(out, dtype=torch.float32)


def _forward_and_log_probs(
    net: AnyNet,
    states_t: torch.Tensor,
    action_feats_t: torch.Tensor,
    n_actions_t: torch.Tensor,
    all_n_actions: list[int],
    total_steps: int,
    device: torch.device,
    values_precomputed: torch.Tensor | None = None,
    trunk_hidden: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """前向传播 → 返回 (log_prob_2d, values, mask, col_range)。"""
    if hasattr(net, "forward_batched"):
        fb_kw: dict = {}
        if values_precomputed is not None:
            fb_kw["values_precomputed"] = values_precomputed
        if trunk_hidden is not None:
            fb_kw["trunk_hidden"] = trunk_hidden
        logits_flat, values_flat = net.forward_batched(
            states_t, action_feats_t, n_actions_t, **fb_kw
        )
    elif isinstance(net, SharedPolicyValueNet):
        values_flat = net.forward_value(states_t)
        parts: list[torch.Tensor] = []
        a_off = 0
        for i in range(total_steps):
            n = all_n_actions[i]
            phi_i = torch.cat([states_t[i : i + 1].expand(n, -1), action_feats_t[a_off : a_off + n]], dim=-1)
            parts.append(net.forward_policy_logits(phi_i))
            a_off += n
        logits_flat = torch.cat(parts)
    else:
        values_flat = net.forward_value(states_t)
        s_exp = torch.repeat_interleave(states_t, n_actions_t, dim=0)
        phi_cat = torch.cat([s_exp, action_feats_t], dim=-1)
        logits_flat = net.forward_policy_logits(phi_cat)

    values_flat = torch.nan_to_num(values_flat, nan=0.0, posinf=1e5, neginf=-1e5).clamp(-1e5, 1e5)

    logits_flat = torch.nan_to_num(logits_flat, nan=0.0, posinf=30.0, neginf=-30.0).clamp(-30.0, 30.0)

    max_n = int(n_actions_t.max().item())
    padded = logits_flat.new_full((total_steps, max_n), float("-inf"))
    col_range = torch.arange(max_n, device=device)
    mask = col_range.unsqueeze(0) < n_actions_t.unsqueeze(1)
    padded[mask] = logits_flat
    lp_2d = torch.log_softmax(padded, dim=1)
    return lp_2d, values_flat, mask, col_range


def _reevaluate_and_update(
    net: AnyNet,
    opt: torch.optim.Optimizer,
    batch: list[dict],
    device: torch.device,
    gamma: float,
    gae_lambda: float,
    return_scale: float,
    value_coef: float,
    entropy_coef: float,
    normalize_adv: bool,
    adv_min_std: float,
    value_huber_beta: float,
    grad_clip: float,
    ppo_epochs: int = 1,
    ppo_clip: float = 0.2,
    global_ep: int = 0,
) -> dict | None:
    """v5: outcome 价值目标 + 直接监督三头 + GAE advantage + PPO。"""
    valid = [ep for ep in batch if ep["trajectory"]]
    if not valid:
        return None

    all_states: list[np.ndarray] = []
    all_action_feats: list[np.ndarray] = []
    all_n_actions: list[int] = []
    all_chosen: list[int] = []
    all_rewards: list[float] = []
    all_old_lp: list[float] = []
    all_holes_after: list[float] = []
    all_clears: list[int] = []
    all_bonus_lines: list[int] = []
    all_board_quality: list[float] = []
    all_feasibility: list[float] = []
    all_steps_to_end: list[float] = []
    all_topology_after: list[np.ndarray] = []
    all_q_vals: list[np.ndarray | None] = []
    all_visit_pi: list[np.ndarray | None] = []
    all_pg_weights: list[float] = []
    ep_lengths: list[int] = []
    ep_scores: list[float] = []
    ep_thresholds: list[float] = []
    ep_replay_flags: list[bool] = []
    ep_replay_ages: list[float] = []

    for ep in valid:
        traj = ep["trajectory"]
        is_replay = bool(ep.get("_replay_sample", False))
        pg_weight = 0.0 if is_replay else 1.0
        ep_lengths.append(len(traj))
        ep_scores.append(float(ep.get("score", 0)))
        ep_thresholds.append(float(ep.get("win_threshold", WIN_SCORE_THRESHOLD)))
        ep_replay_flags.append(is_replay)
        ep_replay_ages.append(float(ep.get("_replay_age", 0.0)) if is_replay else 0.0)
        for step in traj:
            all_states.append(step["state"])
            all_action_feats.append(step["action_feats"])
            all_n_actions.append(step["n_actions"])
            all_chosen.append(step["chosen_idx"])
            all_rewards.append(step["reward"])
            all_old_lp.append(step.get("old_log_prob", 0.0))
            if "holes_after" in step:
                all_holes_after.append(float(step["holes_after"]))
            all_clears.append(int(step.get("clears", 0)))
            all_bonus_lines.append(int(step.get("bonus_lines", 0)))
            all_board_quality.append(float(step.get("board_quality", 0.0)))
            all_feasibility.append(float(step.get("feasibility", 1.0)))
            all_steps_to_end.append(float(step.get("steps_to_end", 0)))
            topo = step.get("topology_after")
            if topo is not None:
                all_topology_after.append(np.asarray(topo, dtype=np.float32))
            qv = step.get("q_vals")
            all_q_vals.append(np.array(qv, dtype=np.float32) if qv is not None else None)
            vp = step.get("visit_pi")
            all_visit_pi.append(np.array(vp, dtype=np.float32) if vp is not None else None)
            all_pg_weights.append(pg_weight)

    total_steps = len(all_states)
    if total_steps == 0:
        return None

    states_t = tensor_to_device(torch.from_numpy(np.stack(all_states)), device)
    action_feats_t = tensor_to_device(
        torch.from_numpy(np.concatenate(all_action_feats, axis=0)), device
    )
    n_actions_t = torch.tensor(all_n_actions, device=device, dtype=torch.long)
    chosen_t = torch.tensor(all_chosen, device=device, dtype=torch.long).unsqueeze(1)
    old_lp_t = tensor_to_device(torch.tensor(all_old_lp, dtype=torch.float32), device)
    pg_weight_t = tensor_to_device(torch.tensor(all_pg_weights, dtype=torch.float32), device)
    pg_weight_sum = pg_weight_t.sum().clamp_min(1.0)

    hole_coef, hole_denom = _hole_aux_coef_and_denom()
    clear_pred_coef = _clear_pred_coef()
    outcome_mix = _outcome_value_mix()
    bq_coef = _board_quality_coef()
    feas_coef = _feasibility_coef()
    surv_coef = _survival_coef()
    topo_coef = _topology_aux_coef()
    bonus_clear_coef = _bonus_clear_aux_coef()
    q_distill_coef = _q_distill_coef(global_ep)
    q_distill_tau = _q_distill_tau()
    q_distill_norm = _q_distill_norm_mode()
    q_distill_min_std = _q_distill_min_std()
    visit_pi_coef = _visit_pi_coef(global_ep)
    visit_pi_tau = _visit_pi_tau()

    step_starts = torch.zeros(total_steps + 1, dtype=torch.long, device=device)
    step_starts[1:] = torch.cumsum(n_actions_t, dim=0)
    chosen_rows = step_starts[:-1] + chosen_t.squeeze(1)
    chosen_action_feats = action_feats_t[chosen_rows]

    use_hole_aux = (
        hole_coef > 1e-12
        and callable(getattr(net, "forward_hole_aux", None))
        and len(all_holes_after) == total_steps
    )
    holes_target: torch.Tensor | None = None
    if use_hole_aux:
        holes_target = (
            torch.tensor(all_holes_after, dtype=torch.float32, device=device) / hole_denom
        ).clamp(0.0, 1.0)

    use_clear_pred = (
        clear_pred_coef > 1e-12
        and callable(getattr(net, "forward_clear_pred", None))
        and len(all_clears) == total_steps
    )
    clears_target: torch.Tensor | None = None
    if use_clear_pred:
        clears_target = torch.tensor(
            [min(c, 3) for c in all_clears], dtype=torch.long, device=device
        )

    use_topology_aux = (
        topo_coef > 1e-12
        and callable(getattr(net, "forward_topology_aux", None))
        and len(all_topology_after) == total_steps
    )
    topology_target_t: torch.Tensor | None = None
    if use_topology_aux:
        topology_target_t = tensor_to_device(
            torch.from_numpy(np.stack(all_topology_after).astype(np.float32)),
            device,
        ).clamp(0.0, 1.0)

    use_bonus_clear_aux = (
        bonus_clear_coef > 1e-12
        and callable(getattr(net, "forward_bonus_clear_aux", None))
        and len(all_bonus_lines) == total_steps
    )
    bonus_clear_target_t: torch.Tensor | None = None
    if use_bonus_clear_aux:
        bonus_clear_target_t = tensor_to_device(
            torch.tensor([1.0 if b > 0 else 0.0 for b in all_bonus_lines], dtype=torch.float32),
            device,
        )

    # --- 直接监督目标 ---
    has_aux_heads = callable(getattr(net, "forward_aux_all", None))
    bq_target_t = tensor_to_device(
        torch.tensor(all_board_quality, dtype=torch.float32), device
    )
    feas_target_t = tensor_to_device(
        torch.tensor(all_feasibility, dtype=torch.float32), device
    )
    surv_target_t = tensor_to_device(
        torch.tensor([s / _SURVIVAL_NORM for s in all_steps_to_end], dtype=torch.float32), device
    ).clamp(0.0, 1.0)

    # Q 分布蒸馏目标张量（变长 Q 数组 → 对齐到 max_n 的 padded 矩阵）
    q_vals_padded: torch.Tensor | None = None
    q_has_vals: torch.Tensor | None = None
    q_std_vals: list[float] = []
    q_margin_vals: list[float] = []
    q_entropy_vals: list[float] = []
    q_entropy_norm_vals: list[float] = []
    if q_distill_coef > 1e-12 and len(all_q_vals) == total_steps:
        max_n_q = int(n_actions_t.max().item())
        q_padded_np = np.full((total_steps, max_n_q), -1e9, dtype=np.float32)
        has_q_np = np.zeros(total_steps, dtype=bool)
        for t_i, qv in enumerate(all_q_vals):
            if qv is not None and len(qv) == all_n_actions[t_i]:
                q_norm = _normalize_teacher_q(
                    qv, q_distill_norm, q_distill_min_std
                )
                q_padded_np[t_i, : len(qv)] = q_norm
                q_std_vals.append(float(np.std(qv)))
                if len(q_norm) >= 2:
                    top2 = np.sort(np.partition(q_norm, -2)[-2:])
                    q_margin_vals.append(float(top2[-1] - top2[-2]))
                else:
                    q_margin_vals.append(0.0)
                logits_np = q_norm / max(q_distill_tau, 0.1)
                logits_np = logits_np - float(np.max(logits_np))
                probs_np = np.exp(logits_np)
                probs_np = probs_np / max(float(np.sum(probs_np)), 1e-12)
                ent = -float(np.sum(probs_np * np.log(np.clip(probs_np, 1e-12, 1.0))))
                q_entropy_vals.append(ent)
                q_entropy_norm_vals.append(ent / max(float(np.log(max(len(q_norm), 2))), 1e-12))
                has_q_np[t_i] = True
        if has_q_np.any():
            q_vals_padded = tensor_to_device(torch.from_numpy(q_padded_np), device)
            q_has_vals = torch.from_numpy(has_q_np).to(device)

    # MCTS visit distribution 直接蒸馏目标（AlphaZero 风格），与 beam Q 蒸馏分开记录。
    visit_pi_padded: torch.Tensor | None = None
    visit_pi_has_vals: torch.Tensor | None = None
    visit_entropy_vals: list[float] = []
    visit_entropy_norm_vals: list[float] = []
    if visit_pi_coef > 1e-12 and len(all_visit_pi) == total_steps:
        max_n_vp = int(n_actions_t.max().item())
        vp_padded_np = np.zeros((total_steps, max_n_vp), dtype=np.float32)
        has_vp_np = np.zeros(total_steps, dtype=bool)
        for t_i, vp in enumerate(all_visit_pi):
            if vp is None or len(vp) != all_n_actions[t_i]:
                continue
            s = float(np.sum(vp))
            if s <= 1e-8:
                continue
            vp_norm = vp / s
            vp_padded_np[t_i, : len(vp)] = vp_norm
            ent_vp = -float(np.sum(vp_norm * np.log(np.clip(vp_norm, 1e-12, 1.0))))
            visit_entropy_vals.append(ent_vp)
            visit_entropy_norm_vals.append(ent_vp / max(float(np.log(max(len(vp_norm), 2))), 1e-12))
            has_vp_np[t_i] = True
        if has_vp_np.any():
            visit_pi_padded = tensor_to_device(torch.from_numpy(vp_padded_np), device)
            visit_pi_has_vals = torch.from_numpy(has_vp_np).to(device)

    dp_ids = resolve_cuda_device_ids_for_data_parallel()
    use_dp_trunk = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and os.environ.get("RL_CUDA_DP_TRUNK", "1").lower() not in ("0", "false", "no")
        and hasattr(net, "forward_trunk")
    )
    use_dp_value_only = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and not use_dp_trunk
        and os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
        and isinstance(net, (LightPolicyValueNet, LightSharedPolicyValueNet, ConvSharedPolicyValueNet))
    )
    trunk_h_init: torch.Tensor | None = None
    values_dp: torch.Tensor | None = None
    if use_dp_trunk:
        from torch.nn.parallel import data_parallel as dp_fn

        trunk_h_init = dp_fn(_TrunkForward(net), states_t, device_ids=dp_ids, output_device=device)
    elif use_dp_value_only:
        from torch.nn.parallel import data_parallel as dp_fn

        values_dp = dp_fn(_ValueForward(net), states_t, device_ids=dp_ids, output_device=device)

    lp_2d_init, values_init, mask, _col = _forward_and_log_probs(
        net,
        states_t,
        action_feats_t,
        n_actions_t,
        all_n_actions,
        total_steps,
        device,
        values_precomputed=values_dp,
        trunk_hidden=trunk_h_init,
    )

    # --- 价值目标：outcome-based（纯终局得分） + GAE advantage ---
    _vtc = float(os.environ.get("RL_VALUE_TARGET_CLIP", "512"))
    _gae_dc = float(os.environ.get("RL_GAE_DELTA_CLIP", "80"))
    vals_np = values_init.detach().cpu().numpy()
    adv_np = np.empty(total_steps, dtype=np.float32)
    rets_np = np.empty(total_steps, dtype=np.float32)
    v_off = 0
    r_off = 0
    for ep_i, ep_len in enumerate(ep_lengths):
        v = vals_np[v_off : v_off + ep_len]
        r = np.array([all_rewards[r_off + j] * return_scale for j in range(ep_len)], dtype=np.float32)
        t_len = ep_len
        outcome_val = _outcome_value_target(ep_scores[ep_i], ep_thresholds[ep_i])

        if ep_replay_flags[ep_i]:
            # Replay 轨迹可能来自旧策略/旧 ranked window；只保留终局 outcome 作为稳定 value 监督。
            adv_np[v_off : v_off + ep_len] = 0.0
            rets_np[v_off : v_off + ep_len] = outcome_val
            v_off += ep_len
            r_off += ep_len
            continue

        # GAE advantages（用于策略梯度）
        if gae_lambda > 1e-8:
            next_v = np.zeros(t_len, dtype=np.float32)
            if t_len > 1:
                next_v[:-1] = v[1:]
            deltas = r + gamma * next_v - v
            if _gae_dc > 0:
                deltas = np.clip(deltas, -_gae_dc, _gae_dc)
            gae_acc = 0.0
            for i in range(t_len - 1, -1, -1):
                gae_acc = float(deltas[i]) + gamma * gae_lambda * gae_acc
                adv_np[v_off + i] = gae_acc
            rets_np[v_off : v_off + ep_len] = adv_np[v_off : v_off + ep_len] + v
        else:
            g = 0.0
            for i in range(t_len - 1, -1, -1):
                g = float(r[i]) + gamma * g
                rets_np[v_off + i] = g
            adv_np[v_off : v_off + ep_len] = rets_np[v_off : v_off + ep_len] - v

        # outcome 价值目标（替换 GAE returns 用于 value loss）
        if outcome_mix > 1e-8:
            for i in range(ep_len):
                rets_np[v_off + i] = (1.0 - outcome_mix) * rets_np[v_off + i] + outcome_mix * outcome_val

        v_off += ep_len
        r_off += ep_len

    if _vtc > 0:
        rets_np = np.clip(rets_np, -_vtc, _vtc)
    rets_clean = np.nan_to_num(rets_np, nan=0.0, posinf=65504.0, neginf=-65504.0)
    if _vtc > 0:
        rets_clean = np.clip(rets_clean, -_vtc, _vtc)
    adv_cat = tensor_to_device(torch.from_numpy(adv_np), device)
    rets_cat = tensor_to_device(torch.from_numpy(rets_clean), device)
    if normalize_adv:
        pg_mask = pg_weight_t > 0.5
        if bool(pg_mask.any().item()):
            active_adv = adv_cat[pg_mask]
            mean = active_adv.mean()
            std = active_adv.std(unbiased=False)
            if torch.isfinite(std).item() and float(std.item()) >= adv_min_std:
                adv_cat = (adv_cat - mean) / (std + 1e-8)
            else:
                adv_cat = adv_cat - mean
            adv_cat = torch.nan_to_num(adv_cat, nan=0.0, posinf=10.0, neginf=-10.0).clamp(-10, 10)
        else:
            adv_cat = _normalize_advantages(adv_cat, min_std=adv_min_std)
    else:
        adv_cat = torch.nan_to_num(adv_cat, nan=0.0, posinf=1e3, neginf=-1e3).clamp(-100, 100)

    values_old_for_clip = values_init.detach()

    last_result: dict | None = None
    n_epochs = max(1, ppo_epochs)

    for epoch_i in range(n_epochs):
        if epoch_i == 0:
            lp_2d = lp_2d_init
            values_flat = values_init
        else:
            trunk_h_e: torch.Tensor | None = None
            if use_dp_trunk:
                from torch.nn.parallel import data_parallel as dp_fn

                trunk_h_e = dp_fn(_TrunkForward(net), states_t, device_ids=dp_ids, output_device=device)
            lp_2d, values_flat, mask, _col = _forward_and_log_probs(
                net,
                states_t,
                action_feats_t,
                n_actions_t,
                all_n_actions,
                total_steps,
                device,
                trunk_hidden=trunk_h_e,
            )

        new_lp = _clamp_log_probs_pg(lp_2d.gather(1, chosen_t).squeeze(1))
        probs_2d = lp_2d.exp() * mask.float()
        ent_t = -(probs_2d * lp_2d.masked_fill(~mask, 0.0)).sum(dim=1)

        if n_epochs > 1:
            log_ratio = (new_lp - old_lp_t).clamp(-10.0, 10.0)
            ratio = torch.exp(log_ratio)
            surr1 = ratio * adv_cat
            surr2 = torch.clamp(ratio, 1.0 - ppo_clip, 1.0 + ppo_clip) * adv_cat
            policy_loss = -(torch.min(surr1, surr2) * pg_weight_t).sum() / pg_weight_sum
        else:
            policy_loss = -((new_lp * adv_cat) * pg_weight_t).sum() / pg_weight_sum

        v_clipped = values_old_for_clip + torch.clamp(
            values_flat - values_old_for_clip, -ppo_clip, ppo_clip
        )
        vl_unclipped = F.smooth_l1_loss(values_flat, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        vl_clipped = F.smooth_l1_loss(v_clipped, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        value_loss = torch.max(vl_unclipped, vl_clipped).mean()

        entropy_mean = torch.nan_to_num(
            (ent_t * pg_weight_t).sum() / pg_weight_sum,
            nan=0.0,
            posinf=0.0,
            neginf=0.0,
        )

        hole_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_hole_aux and holes_target is not None:
            pred_h = net.forward_hole_aux(states_t, chosen_action_feats)
            hole_aux_loss = F.smooth_l1_loss(pred_h, holes_target, reduction="mean", beta=1.0)

        clear_pred_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_clear_pred and clears_target is not None:
            clear_logits = net.forward_clear_pred(states_t, chosen_action_feats)
            clear_pred_loss = F.cross_entropy(clear_logits, clears_target, reduction="mean")

        topology_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_topology_aux and topology_target_t is not None:
            pred_topo = net.forward_topology_aux(states_t, chosen_action_feats)
            topology_aux_loss = F.smooth_l1_loss(pred_topo, topology_target_t, reduction="mean", beta=1.0)

        bonus_clear_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_bonus_clear_aux and bonus_clear_target_t is not None:
            bonus_logits = net.forward_bonus_clear_aux(states_t, chosen_action_feats)
            bonus_clear_loss = F.binary_cross_entropy_with_logits(
                bonus_logits, bonus_clear_target_t, reduction="mean"
            )

        bq_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        feas_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        surv_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if has_aux_heads and (bq_coef > 1e-12 or feas_coef > 1e-12 or surv_coef > 1e-12):
            aux = net.forward_aux_all(states_t)
            if bq_coef > 1e-12:
                bq_loss = F.smooth_l1_loss(aux["board_quality"], bq_target_t, reduction="mean", beta=1.0)
            if feas_coef > 1e-12:
                feas_loss = F.binary_cross_entropy_with_logits(
                    aux["feasibility"], feas_target_t, reduction="mean"
                )
            if surv_coef > 1e-12:
                surv_loss = F.smooth_l1_loss(aux["survival"], surv_target_t, reduction="mean", beta=1.0)

        # Q 分布蒸馏：策略头模仿 lookahead Q 的 softmax 分布（AlphaZero 策略改进的轻量实现）
        q_distill_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if (
            q_distill_coef > 1e-12
            and q_vals_padded is not None
            and q_has_vals is not None
            and bool(q_has_vals.any().item())
        ):
            q_rows = q_vals_padded[q_has_vals]        # (n_q, max_n)
            q_mask = mask[q_has_vals]                  # (n_q, max_n) bool
            lp_q = lp_2d[q_has_vals]                  # (n_q, max_n) log-probs
            tau = max(q_distill_tau, 0.1)
            # softmax(Q/τ) 作为 target_pi；padded 位置填 -inf → softmax=0
            target_pi = torch.softmax(
                q_rows.masked_fill(~q_mask, float("-inf")) / tau, dim=1
            )
            # 有效位置上的 CE 损失：-Σ target_pi * log_prob
            target_pi_safe = target_pi.masked_fill(~q_mask, 0.0)
            lp_q_safe = lp_q.masked_fill(~q_mask, 0.0)
            q_distill_loss = -(target_pi_safe * lp_q_safe).sum(dim=1).mean()
            q_distill_loss = torch.nan_to_num(q_distill_loss, nan=0.0, posinf=0.0, neginf=0.0)

        visit_pi_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if (
            visit_pi_coef > 1e-12
            and visit_pi_padded is not None
            and visit_pi_has_vals is not None
            and bool(visit_pi_has_vals.any().item())
        ):
            vp_rows = visit_pi_padded[visit_pi_has_vals]
            vp_mask = mask[visit_pi_has_vals]
            lp_vp = lp_2d[visit_pi_has_vals]
            tau_vp = max(visit_pi_tau, 0.1)
            if abs(tau_vp - 1.0) > 1e-6:
                vp_rows = torch.pow(vp_rows.clamp_min(1e-10), 1.0 / tau_vp)
                vp_rows = vp_rows / vp_rows.sum(dim=1, keepdim=True).clamp_min(1e-10)
            vp_safe = vp_rows.masked_fill(~vp_mask, 0.0)
            lp_vp_safe = lp_vp.masked_fill(~vp_mask, 0.0)
            visit_pi_loss = -(vp_safe * lp_vp_safe).sum(dim=1).mean()
            visit_pi_loss = torch.nan_to_num(visit_pi_loss, nan=0.0, posinf=0.0, neginf=0.0)

        def _safe_aux(t):
            return t if torch.isfinite(t).item() else torch.zeros_like(t)

        policy_loss = _safe_aux(policy_loss)
        value_loss_safe = _safe_aux(value_loss)

        loss = (
            policy_loss
            + value_coef * value_loss_safe
            - entropy_coef * entropy_mean
            + hole_coef * _safe_aux(hole_aux_loss)
            + clear_pred_coef * _safe_aux(clear_pred_loss)
            + topo_coef * _safe_aux(topology_aux_loss)
            + bonus_clear_coef * _safe_aux(bonus_clear_loss)
            + bq_coef * _safe_aux(bq_loss)
            + feas_coef * _safe_aux(feas_loss)
            + surv_coef * _safe_aux(surv_loss)
            + q_distill_coef * _safe_aux(q_distill_loss)
            + visit_pi_coef * _safe_aux(visit_pi_loss)
        )

        opt.zero_grad()
        stepped = False
        skip_reason = ""
        if torch.isfinite(loss).item():
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
            if not torch.isfinite(grad_norm).item() or not _module_tensors_finite(net, check_grads=True):
                skip_reason = "non_finite_grad"
                opt.zero_grad(set_to_none=True)
            else:
                pre_sd = {k: v.detach().clone() for k, v in net.state_dict().items()}
                pre_opt_sd = copy.deepcopy(opt.state_dict())
                opt.step()
                stepped = True
                if not _module_tensors_finite(net):
                    net.load_state_dict(pre_sd)
                    opt.load_state_dict(pre_opt_sd)
                    opt.zero_grad(set_to_none=True)
                    skip_reason = "non_finite_param_after_step"
                    stepped = False
        else:
            skip_reason = "non_finite_loss"
            opt.zero_grad(set_to_none=True)

        if stepped:
            opt.zero_grad(set_to_none=True)
        else:
            if not skip_reason:
                skip_reason = "optimizer_step_skipped"

        pg_steps_num = int(round(float(pg_weight_t.detach().sum().cpu().item())))
        pg_steps_num = max(0, min(int(total_steps), pg_steps_num))
        replay_steps_num = max(0, int(total_steps) - pg_steps_num)

        last_result = {
            "policy_loss": _safe_metric(policy_loss),
            "value_loss": _safe_metric(value_loss),
            "entropy": _safe_metric(entropy_mean, min_value=0.0, max_value=10.0),
            "loss_hole_aux": _safe_metric(hole_aux_loss),
            "loss_clear_pred": _safe_metric(clear_pred_loss),
            "loss_topology_aux": _safe_metric(topology_aux_loss),
            "loss_bonus_clear_aux": _safe_metric(bonus_clear_loss),
            "loss_bq": _safe_metric(bq_loss),
            "loss_feas": _safe_metric(feas_loss),
            "loss_surv": _safe_metric(surv_loss),
            "loss_q_distill": _safe_metric(q_distill_loss),
            "loss_visit_pi": _safe_metric(visit_pi_loss),
            "hole_aux_coef": float(hole_coef),
            "clear_pred_coef": float(clear_pred_coef),
            "topology_aux_coef": float(topo_coef),
            "bonus_clear_aux_coef": float(bonus_clear_coef),
            "q_distill_coef": float(q_distill_coef),
            "visit_pi_coef": float(visit_pi_coef),
            "pg_steps": pg_steps_num,
            "replay_steps": replay_steps_num,
            "replay_age": float(np.mean([a for a in ep_replay_ages if a > 0])) if any(a > 0 for a in ep_replay_ages) else 0.0,
            "teacher_q_coverage": float(len(q_std_vals) / max(total_steps, 1)),
            "teacher_q_std": float(np.mean(q_std_vals)) if q_std_vals else 0.0,
            "teacher_q_margin": float(np.mean(q_margin_vals)) if q_margin_vals else 0.0,
            "teacher_q_entropy": float(np.mean(q_entropy_vals)) if q_entropy_vals else 0.0,
            "teacher_q_entropy_norm": float(np.mean(q_entropy_norm_vals)) if q_entropy_norm_vals else 0.0,
            "teacher_visit_coverage": float(len(visit_entropy_vals) / max(total_steps, 1)),
            "teacher_visit_entropy": float(np.mean(visit_entropy_vals)) if visit_entropy_vals else 0.0,
            "teacher_visit_entropy_norm": float(np.mean(visit_entropy_norm_vals)) if visit_entropy_norm_vals else 0.0,
            "optimizer_stepped": stepped,
            "optimizer_skip_reason": skip_reason,
        }

        if not stepped and epoch_i > 0:
            break

    return last_result


def _auto_n_workers(device: torch.device) -> int:
    """自动选择多进程 worker 数：GPU 设备留 1 核给主线程，CPU 模式不启多进程。"""
    if device.type == "cpu":
        return 1
    n_cpu = os.cpu_count() or 1
    return max(2, min(n_cpu - 1, 6))


def train_loop(
    net: AnyNet,
    device: torch.device,
    episodes: int,
    lr: float,
    value_coef: float,
    gamma: float,
    log_every: int,
    save_every: int,
    ckpt_path: Path | None,
    resume: Path | None,
    entropy_coef: float = 0.01,
    normalize_adv: bool = True,
    grad_clip: float = 1.0,
    adv_min_std: float = 1e-4,
    value_huber_beta: float = 10.0,
    gae_lambda: float = 0.95,
    temp_floor: float = 0.3,
    explore_first_moves: int = 2,
    explore_temp_mult: float = 1.2,
    dirichlet_epsilon: float = 0.08,
    dirichlet_alpha: float = 0.28,
    train_arch: str = "conv-shared",
    mlp_ratio: float = 2.0,
    policy_depth_arg: int = 4,
    value_depth_arg: int = 4,
    batch_episodes: int = 8,
    n_workers: int = 0,
    ppo_epochs: int = 4,
    ppo_clip: float = 0.2,
    eval_gate_every: int = 0,
    eval_gate_games: int = 50,
    eval_gate_win_ratio: float = 0.55,
) -> int:
    import collections
    import multiprocessing as mp

    opt = adam_for_training(net.parameters(), lr=lr)

    # --- 评估门控：基线权重 + 历史最优保留（v8）---
    _baseline_sd: dict | None = None
    _last_gate_ep: int = 0
    _best_ever_sd: dict | None = None   # 历史最优模型权重（从不降级）
    _best_ever_wr: float = 0.0          # 历史最优对应胜率
    if eval_gate_every > 0:
        _baseline_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
        _best_ever_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}

    # --- 自适应课程（v8）---
    _adap_cfg = rl_adaptive_curriculum_config()
    _use_adaptive = _adap_cfg.get("enabled", False) and rl_curriculum_enabled()
    _adap_window = int(_adap_cfg.get("window", 200))
    _adap_target_wr = float(_adap_cfg.get("targetWinRate", 0.5))
    _adap_step_up = float(_adap_cfg.get("stepUp", 2))
    _adap_step_down = float(_adap_cfg.get("stepDown", 0))
    _adap_check_every = int(_adap_cfg.get("checkEvery", 50))
    # 虚拟局数：课程推进速度由滑动胜率决定，可快于/慢于实际局数
    _virtual_ep: float = 0.0
    _win_history: collections.deque = collections.deque(maxlen=_adap_window)
    _last_adap_check_ep: int = 0

    # --- Ranked Reward（single-player self-play）：把绝对分数转成滚动分位奖励 ---
    _rank_cfg = _ranked_reward_config()
    _use_ranked = bool(_rank_cfg.get("enabled", False))
    _rank_history: collections.deque = collections.deque(maxlen=int(_rank_cfg.get("window", 2048)))
    _ranked_last_avg = 0.0
    _ranked_last_pct = 0.5

    # --- 困难样本 replay：重放高分但未通关/低可行性尾局，减少搜索 teacher 样本浪费 ---
    _replay_cfg = _replay_config()
    _use_replay = bool(_replay_cfg.get("enabled", False))
    _replay_buffer: collections.deque = collections.deque(maxlen=int(_replay_cfg.get("maxEpisodes", 256)))

    start_ep = 0
    if resume and resume.is_file():
        try:
            ckpt = torch.load(resume, map_location=device, weights_only=False)
        except TypeError:
            ckpt = torch.load(resume, map_location=device)
        ckpt_arch = str((ckpt.get("meta") or {}).get("arch", train_arch))
        if ckpt_arch != train_arch:
            print(
                f"警告: checkpoint arch={ckpt_arch} 与当前 --arch {train_arch} 不一致，加载可能失败",
                file=sys.stderr,
            )
        try:
            inco = net.load_state_dict(ckpt["model"], strict=False)
            if inco.missing_keys or inco.unexpected_keys:
                print(
                    f"注意: checkpoint 非严格加载 missing={len(inco.missing_keys)} "
                    f"unexpected={len(inco.unexpected_keys)}（如新增 hole_aux 头时属正常）",
                    file=sys.stderr,
                )
            if "optimizer" in ckpt:
                opt.load_state_dict(ckpt["optimizer"])
            start_ep = int(ckpt.get("episodes", 0))
            print(f"已从 {resume} 恢复，继续自第 {start_ep} 局", file=sys.stderr)
        except RuntimeError as e:
            print(
                f"警告: checkpoint 权重与当前模型不兼容，忽略旧权重从头训练: {e}",
                file=sys.stderr,
            )

    # --- 共享 Zobrist 转置表（跨进程，v8.3） ---
    _shared_ztable = None
    _shm_slots = int(os.environ.get("RL_ZOBRIST_SHARED_SLOTS", "0"))
    if _shm_slots <= 0:
        from .game_rules import _DATA as _GR_DATA  # type: ignore[attr-defined]
        _shm_slots = int(_GR_DATA.get("lightMCTS", {}).get("sharedZobristSlots", 8192))
    _use_shared_ztable = (
        _shm_slots > 0
        and os.environ.get("RL_ZOBRIST_SHARED", "1") not in ("0", "false")
        and os.environ.get("RL_MCTS", "0") in ("1", "true")
    )

    # --- 多进程 worker pool（0=自动检测） ---
    pool = None
    actual_workers = n_workers if n_workers > 0 else _auto_n_workers(device)
    if actual_workers > 1:
        w = getattr(net, "width", 128)
        cc = getattr(net, "conv_channels", 32)

        # 主进程创建共享转置表，把 name + slots 传给 worker 初始化函数
        shm_name, shm_slots = "", 0
        if _use_shared_ztable:
            try:
                from .mcts import SharedZobristTable  # type: ignore[attr-defined]
                _shared_ztable = SharedZobristTable.create(n_slots=_shm_slots)
                shm_name, shm_slots = _shared_ztable.name, _shm_slots
                print(
                    f"Zobrist 跨进程共享表: {_shm_slots} slots "
                    f"({_shm_slots * 8 // 1024} KB, shm={shm_name})",
                    file=sys.stderr,
                )
            except Exception as e:
                print(f"警告: 共享 Zobrist 表创建失败，退化为本地缓存: {e}", file=sys.stderr)

        ctx = mp.get_context("spawn")
        pool = ctx.Pool(
            actual_workers,
            initializer=_pool_worker_init,
            initargs=(train_arch, w, policy_depth_arg, value_depth_arg, mlp_ratio, cc,
                      shm_name, shm_slots),
        )
        print(f"多进程采集: {actual_workers} workers (CPU inference → GPU update) + pipeline overlap", file=sys.stderr)

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "1.0"))
    last_update: dict | None = None
    last_log_ep = start_ep
    mps_sync = device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes")

    warmup_batches = int(os.environ.get("RL_LR_WARMUP_BATCHES", "20"))
    batch_count = 0

    # 流水线状态：上一轮异步采集的 AsyncResult
    _pending_async = None
    t_collect_ms = 0.0
    t_train_ms = 0.0

    def _make_pool_args(ep_start: int, count: int, win_thr: int | None = None):
        """构建 pool worker 的参数列表。

        每个 config 为 7-tuple：(global_ep, temp_floor, explore_first_moves,
            explore_temp_mult, dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
        """
        configs = [
            (ep_start + i + 1, temp_floor, explore_first_moves, explore_temp_mult,
             dirichlet_epsilon, dirichlet_alpha, win_thr)
            for i in range(count)
        ]
        chunks: list[list] = [[] for _ in range(actual_workers)]
        for i, cfg in enumerate(configs):
            chunks[i % actual_workers].append(cfg)
        cpu_sd = {k: v.detach().cpu() for k, v in net.state_dict().items()}
        return [(cpu_sd, chunk) for chunk in chunks if chunk]

    ep_cursor = start_ep
    try:
        while ep_cursor < start_ep + episodes:
            bs = min(batch_episodes, start_ep + episodes - ep_cursor)

            if warmup_batches > 0:
                effective_lr = _lr_warmup(batch_count, warmup_batches, lr)
                for pg in opt.param_groups:
                    pg["lr"] = effective_lr

            # --- 自适应课程：计算当前有效胜利门槛 ---
            if _use_adaptive:
                cur_win_thr: int | None = rl_win_threshold_from_virtual_ep(int(_virtual_ep))
            else:
                cur_win_thr = None  # None = collect_episode 内部按线性课程计算

            # --- 采集（含流水线重叠）---
            tc0 = time.perf_counter()

            if pool is not None:
                if _pending_async is not None:
                    results = _pending_async.get()
                    batch = [ep for worker_eps in results for ep in worker_eps]
                else:
                    args_list = _make_pool_args(ep_cursor, bs, cur_win_thr)
                    results = pool.map(_pool_worker_collect, args_list)
                    batch = [ep for worker_eps in results for ep in worker_eps]

                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

                # 预发射下一批采集（与本轮 GPU 训练重叠）
                next_ep = ep_cursor + bs
                next_bs = min(batch_episodes, start_ep + episodes - next_ep)
                if next_bs > 0:
                    next_args = _make_pool_args(next_ep, next_bs, cur_win_thr)
                    _pending_async = pool.map_async(_pool_worker_collect, next_args)
                else:
                    _pending_async = None
            else:
                batch = [
                    collect_episode(
                        net, device,
                        ep_cursor + i + 1, temp_floor,
                        explore_first_moves, explore_temp_mult,
                        dirichlet_epsilon, dirichlet_alpha,
                        win_threshold_override=cur_win_thr,
                    )
                    for i in range(bs)
                ]
                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

            # --- Ranked Reward：只使用历史分数计算分位，把奖励加到终局步，避免改变局内局势模拟 ---
            if _use_ranked:
                ranked_vals: list[float] = []
                ranked_pcts: list[float] = []
                batch_rank_cfg = dict(_rank_cfg)
                batch_rank_cfg["targetPercentile"] = _ranked_reward_target_for_episode(ep_cursor, _rank_cfg)
                for ep in batch:
                    rr, pct = _ranked_reward_for_score(float(ep.get("score", 0.0)), _rank_history, batch_rank_cfg)
                    traj = ep.get("trajectory") or []
                    if traj and abs(rr) > 1e-12:
                        traj[-1]["reward"] = float(traj[-1].get("reward", 0.0)) + rr
                    ep["ranked_reward"] = rr
                    ep["ranked_percentile"] = pct
                    ranked_vals.append(rr)
                    ranked_pcts.append(pct)
                for ep in batch:
                    _rank_history.append(float(ep.get("score", 0.0)))
                _ranked_last_avg = float(np.mean(ranked_vals)) if ranked_vals else 0.0
                _ranked_last_pct = float(np.mean(ranked_pcts)) if ranked_pcts else 0.5

            for ep in batch:
                scores.append(ep["score"])
                won = ep["won"]
                if won:
                    wins += 1
                if _use_adaptive:
                    _win_history.append(1 if won else 0)
            ep_cursor += bs

            # --- 自适应课程：每 checkEvery 局更新虚拟进度 ---
            if _use_adaptive and ep_cursor - _last_adap_check_ep >= _adap_check_every:
                _last_adap_check_ep = ep_cursor
                if len(_win_history) >= 10:
                    recent_wr = sum(_win_history) / len(_win_history)
                    if recent_wr > _adap_target_wr:
                        # 超过目标胜率：加速推进（额外增加虚拟局数）
                        _virtual_ep += _adap_step_up * _adap_check_every
                    elif recent_wr < _adap_target_wr * 0.6:
                        # 远低于目标：暂停推进（保持当前虚拟局数）
                        _virtual_ep += max(0.0, _adap_step_down * _adap_check_every)
                    else:
                        # 正常范围：按实际局数推进
                        _virtual_ep += float(_adap_check_every)
                else:
                    _virtual_ep += float(_adap_check_every)

            # --- GPU 批量更新（PPO 或 REINFORCE）---
            tt0 = time.perf_counter()
            ent_eff = _effective_entropy_coef(ep_cursor, entropy_coef)
            replay_sample: list[dict] = []
            if _use_replay and len(_replay_buffer) > 0:
                replay_n = min(
                    int(_replay_cfg.get("maxSamples", 8)),
                    max(1, int(round(len(batch) * float(_replay_cfg.get("sampleRatio", 0.5))))),
                    len(_replay_buffer),
                )
                replay_sample = copy.deepcopy(random.sample(list(_replay_buffer), replay_n))
                for ep in replay_sample:
                    ep["_replay_sample"] = True
                    ep["_replay_age"] = max(0, ep_cursor - int(ep.get("_replay_added_ep", ep_cursor)))
            update_batch = batch + replay_sample
            result = _reevaluate_and_update(
                net, opt, update_batch, device, gamma, gae_lambda,
                return_scale, value_coef, ent_eff, normalize_adv,
                adv_min_std, value_huber_beta, grad_clip,
                ppo_epochs=ppo_epochs, ppo_clip=ppo_clip, global_ep=ep_cursor,
            )
            tt1 = time.perf_counter()
            t_train_ms = (tt1 - tt0) * 1000

            if result:
                result["replay_samples"] = len(replay_sample)
                last_update = result
            if _use_replay:
                min_pri = float(_replay_cfg.get("minPriority", 0.0))
                ranked_batch = sorted(batch, key=_episode_replay_priority, reverse=True)
                keep_n = min(len(ranked_batch), max(1, int(_replay_cfg.get("keepPerBatch", max(1, len(batch) // 2)))))
                for ep in ranked_batch[:keep_n]:
                    if _episode_replay_priority(ep) >= min_pri:
                        ep_copy = copy.deepcopy(ep)
                        ep_copy["_replay_added_ep"] = ep_cursor
                        _replay_buffer.append(ep_copy)
            batch_count += 1
            if mps_sync:
                maybe_mps_synchronize(device)

            # --- 日志 ---
            if ep_cursor % log_every < bs or ep_cursor >= start_ep + episodes:
                dt = time.perf_counter() - t0
                n = min(100, len(scores))
                avg = sum(scores[-n:]) / n if n else 0.0
                eps_since = ep_cursor - last_log_ep
                wr = 100.0 * wins / max(eps_since, 1)
                wins = 0
                last_log_ep = ep_cursor
                last_ep = batch[-1]
                # 自适应课程时显示虚拟局数对应的门槛
                if _use_adaptive and cur_win_thr is not None:
                    wt = cur_win_thr
                else:
                    wt = last_ep.get("win_threshold", WIN_SCORE_THRESHOLD)
                def _fmt_update(name: str, digits: int = 4) -> str:
                    v = last_update.get(name) if last_update else None
                    return f"{v:.{digits}f}" if isinstance(v, (int, float)) and math.isfinite(float(v)) else "N/A"

                def _num_update(name: str) -> float:
                    v = last_update.get(name) if last_update else None
                    return float(v) if isinstance(v, (int, float)) and math.isfinite(float(v)) else 0.0

                lp_str = _fmt_update("policy_loss")
                lv_str = _fmt_update("value_loss")
                he_str = _fmt_update("entropy", 3)
                hole_str = ""
                if last_update and _num_update("hole_aux_coef") > 1e-12:
                    hole_str = f"  hole={_fmt_update('loss_hole_aux')}"
                if last_update and _num_update("clear_pred_coef") > 1e-12:
                    hole_str += f"  clr={_fmt_update('loss_clear_pred')}"
                if last_update and _num_update("topology_aux_coef") > 1e-12:
                    hole_str += f"  topo={_fmt_update('loss_topology_aux')}"
                if last_update and _num_update("bonus_clear_aux_coef") > 1e-12:
                    hole_str += f"  bonus={_fmt_update('loss_bonus_clear_aux')}"
                if last_update and _num_update("loss_bq") > 1e-6:
                    hole_str += f"  bq={_fmt_update('loss_bq')}"
                if last_update and _num_update("loss_feas") > 1e-6:
                    hole_str += f"  feas={_fmt_update('loss_feas')}"
                if last_update and _num_update("loss_surv") > 1e-6:
                    hole_str += f"  surv={_fmt_update('loss_surv')}"
                if last_update and _num_update("q_distill_coef") > 1e-12:
                    hole_str += f"  qdst={_fmt_update('loss_q_distill')}"
                if last_update and _num_update("visit_pi_coef") > 1e-12:
                    hole_str += f"  vpi={_fmt_update('loss_visit_pi')}"
                if last_update and last_update.get("replay_samples", 0):
                    hole_str += f"  replay={last_update.get('replay_samples', 0)}/age{_num_update('replay_age'):.0f}"
                if last_update and _num_update("teacher_q_coverage") > 0:
                    hole_str += (
                        f"  tq={_num_update('teacher_q_coverage') * 100:.0f}%"
                        f"/std{_num_update('teacher_q_std'):.2f}"
                        f"/m{_num_update('teacher_q_margin'):.2f}"
                        f"/H{_num_update('teacher_q_entropy_norm'):.2f}"
                    )
                if last_update and _num_update("teacher_visit_coverage") > 0:
                    hole_str += (
                        f"  tv={_num_update('teacher_visit_coverage') * 100:.0f}%"
                        f"/H{_num_update('teacher_visit_entropy_norm'):.2f}"
                    )
                if last_update and not last_update.get("optimizer_stepped", True):
                    hole_str += f"  skip={last_update.get('optimizer_skip_reason') or 'unknown'}"
                ppo_tag = f"ppo×{ppo_epochs}" if ppo_epochs > 1 else "pg"
                gpu_pct = 100.0 * t_train_ms / max(t_collect_ms + t_train_ms, 1)
                # 自适应课程：显示虚拟进度
                adap_tag = f"  vep={_virtual_ep:.0f}" if _use_adaptive else ""
                rank_tag = (
                    f"  rr={_ranked_last_avg:+.2f}@p{_ranked_last_pct * 100:.0f}/t{_ranked_reward_target_for_episode(ep_cursor, _rank_cfg) * 100:.0f}"
                    if _use_ranked and len(_rank_history) >= int(_rank_cfg.get("warmup", 0))
                    else ""
                )
                print(
                    f"ep {ep_cursor}  |  {ppo_tag}  |  dev={device.type}  |  thr={wt}{adap_tag}  |  "
                    f"sc={last_ep['score']:.0f}  avg100={avg:.1f}  win%={wr:.1f}%  steps={last_ep['steps']}  |  "
                    f"π={lp_str}  V={lv_str}  H={he_str}{hole_str}{rank_tag}  |  "
                    f"C={t_collect_ms:.0f}ms T={t_train_ms:.0f}ms GPU≈{gpu_pct:.0f}%  |  {dt:.1f}s",
                    file=sys.stderr,
                )
                t0 = time.perf_counter()

            # --- 评估门控（v8：软/硬门控 + 历史最优保留）---
            # 软门控（默认）：仅记录，不回滚
            # 硬门控（RL_EVAL_GATE_HARD=1）：失败时恢复到历史最优（非仅基线）
            if (
                eval_gate_every > 0
                and _baseline_sd is not None
                and ep_cursor - _last_gate_ep >= eval_gate_every
            ):
                from .eval_gate import eval_gate_check as _gate_fn

                _gate_w = getattr(net, "width", 128)
                _gate_cc = getattr(net, "conv_channels", 32)
                _baseline_net = build_policy_net(
                    train_arch, _gate_w, policy_depth_arg, value_depth_arg,
                    mlp_ratio, device, conv_channels=_gate_cc,
                )
                _baseline_net.load_state_dict(
                    {k: v.to(device) for k, v in _baseline_sd.items()}
                )
                _gate_passed, _gate_m = _gate_fn(
                    net, _baseline_net, device,
                    n_games=eval_gate_games,
                    win_ratio=eval_gate_win_ratio,
                    win_threshold=float(cur_win_thr if cur_win_thr is not None else rl_win_threshold_for_episode(ep_cursor)),
                    gate_rule=str((RL_REWARD_SHAPING.get("evalGate") or {}).get("rule", "win")),
                    rounds=int((RL_REWARD_SHAPING.get("evalGate") or {}).get("rounds", 1)),
                )
                _cwr = _gate_m["candidate"]["win_rate"]
                _bwr = _gate_m["baseline"]["win_rate"]
                _pair_wr = float(_gate_m.get("paired_score_win_rate", 0.0))
                _pair_nl = float(_gate_m.get("paired_score_non_loss_rate", 0.0))
                _avg_d = float(_gate_m.get("avg_score_delta", 0.0))
                _hard = os.environ.get("RL_EVAL_GATE_HARD", "0").lower() not in ("0", "false", "no")

                if _gate_passed:
                    # 候选超过基线 → 更新基线
                    _baseline_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
                    # 检查是否超过历史最优
                    if _cwr > _best_ever_wr:
                        _best_ever_wr = _cwr
                        _best_ever_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
                        best_tag = "  ★ 历史最优已更新"
                    else:
                        best_tag = f"  (历史最优胜率={_best_ever_wr:.1%})"
                    print(
                        f"[EvalGate] ep={ep_cursor}  ✓ PASSED  cand_wr={_cwr:.1%}  base_wr={_bwr:.1%}"
                        f"  pair_wr={_pair_wr:.1%} pair_nl={_pair_nl:.1%} Δavg={_avg_d:+.2f}"
                        f"  → 基线已更新{best_tag}",
                        file=sys.stderr,
                    )
                else:
                    if _hard and _best_ever_sd is not None:
                        # 硬门控：回滚到历史最优（而非仅当前基线）
                        net.load_state_dict({k: v.to(device) for k, v in _best_ever_sd.items()})
                        restore_tag = f"  [已恢复历史最优 best_wr={_best_ever_wr:.1%}]"
                    else:
                        restore_tag = "  [软门控：继续训练]"
                    print(
                        f"[EvalGate] ep={ep_cursor}  ✗ FAILED  cand_wr={_cwr:.1%}  base_wr={_bwr:.1%}"
                        f"  pair_wr={_pair_wr:.1%} pair_nl={_pair_nl:.1%} Δavg={_avg_d:+.2f}"
                        + restore_tag,
                        file=sys.stderr,
                    )
                _last_gate_ep = ep_cursor
                del _baseline_net

            # --- 存档 ---
            se = max(1, save_every)
            if ckpt_path and (ep_cursor % se < bs or ep_cursor >= start_ep + episodes):
                ckpt_path.parent.mkdir(parents=True, exist_ok=True)
                torch.save(
                    {
                        "model": net.state_dict(),
                        "optimizer": opt.state_dict(),
                        "episodes": ep_cursor,
                        "meta": _checkpoint_meta(
                            net, device, gamma, lr, train_arch,
                            mlp_ratio, policy_depth_arg, value_depth_arg,
                        ),
                    },
                    ckpt_path,
                )
    finally:
        if pool is not None:
            pool.close()
            pool.join()
        if _shared_ztable is not None:
            try:
                _shared_ztable.close_and_unlink()
            except Exception:
                pass

    return ep_cursor


def main() -> None:
    p = argparse.ArgumentParser(description="Open Block PyTorch 自博弈 RL（支持 MPS/CUDA）")
    p.add_argument("--episodes", type=int, default=5000)
    p.add_argument(
        "--lr",
        type=float,
        default=3e-4,
        help="Adam 学习率；128 宽模型推荐 3e-4",
    )
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=1.0, help="价值头损失权重；加大以加速 value 拟合")
    p.add_argument(
        "--value-huber-beta",
        type=float,
        default=1.0,
        help="smooth_l1 beta；return_scale=1 下回报在 [-5, 50] 区间，beta=1 合理",
    )
    p.add_argument(
        "--adv-min-std",
        type=float,
        default=1e-4,
        help="advantage 标准差低于此则不做标准化",
    )
    p.add_argument(
        "--entropy-coef",
        type=float,
        default=0.025,
        help="策略熵 bonus；防止策略过早确定化",
    )
    p.add_argument(
        "--no-adv-norm",
        action="store_true",
        help="关闭 advantage 标准化",
    )
    p.add_argument("--grad-clip", type=float, default=1.0, help="梯度裁剪范数")
    p.add_argument(
        "--width",
        type=int,
        default=128,
        help="隐层宽度；conv-shared 推荐 128（~132K 参数）；加大以提高价值/策略拟合能力",
    )
    p.add_argument(
        "--policy-depth",
        type=int,
        default=4,
        help="残差塔深度（仅 shared/split 架构使用）",
    )
    p.add_argument("--value-depth", type=int, default=4)
    p.add_argument("--mlp-ratio", type=float, default=2.0)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--device",
        type=str,
        default="auto",
        help="auto | cpu | mps | cuda | cuda:N（多卡见 RL_CUDA_DEVICE_IDS、RL_CUDA_DP_VALUE）",
    )
    p.add_argument("--save", type=str, default="rl_checkpoints/bb_policy.pt")
    p.add_argument("--resume", type=str, default="")
    p.add_argument("--log-every", type=int, default=50, help="每隔多少局打印一行统计")
    p.add_argument(
        "--save-every",
        type=int,
        default=200,
        help="每隔多少局保存 checkpoint",
    )
    p.add_argument(
        "--arch",
        type=str,
        default="conv-shared",
        choices=("conv-shared", "light-shared", "light", "shared", "split"),
        help="conv-shared=残差CNN+dock MLP+共享主干（默认，~132K）；light-shared=轻量共享（~20K）；shared/split=旧版重模型",
    )
    p.add_argument(
        "--conv-channels",
        type=int,
        default=32,
        help="conv-shared 架构的 CNN 通道数；增大以捕捉更丰富的空间模式",
    )
    p.add_argument(
        "--batch-episodes",
        type=int,
        default=128,
        help="采集多少局后做一次梯度更新（大 batch 提高梯度稳定性）",
    )
    p.add_argument(
        "--ppo-epochs",
        type=int,
        default=4,
        help="每批数据的 PPO 更新轮数；1=退化为 REINFORCE",
    )
    p.add_argument(
        "--ppo-clip",
        type=float,
        default=0.2,
        help="PPO clipped surrogate ε；仅 ppo-epochs>1 时生效",
    )
    p.add_argument(
        "--gae-lambda",
        type=float,
        default=0.85,
        help="GAE λ；v5 默认 0.85（outcome 目标下 V 收敛更快，可用较低 λ 降方差）",
    )
    p.add_argument(
        "--temp-floor",
        type=float,
        default=0.35,
        help="温度下限；保持足够随机性以防过早收敛",
    )
    p.add_argument(
        "--explore-first-moves",
        type=int,
        default=2,
        help="开局前若干步只做高温探索、不算 beam/MCTS teacher（省算力）；默认 2，"
        "避免短局（十余步）整局无搜索监督。设为 0 则全程启用 teacher。",
    )
    p.add_argument(
        "--explore-temp-mult",
        type=float,
        default=1.3,
        help="与 explore-first-moves 联用；v6 降为 1.3 配合 Dirichlet 探索",
    )
    p.add_argument(
        "--dirichlet-epsilon",
        type=float,
        default=0.15,
        help="Dirichlet 混合权重初值；v6 默认 0.15 增强早期探索",
    )
    p.add_argument(
        "--dirichlet-alpha",
        type=float,
        default=0.28,
        help="Dirichlet 总浓度（dirichlet-epsilon=0 时无效）",
    )
    p.add_argument(
        "--n-workers",
        type=int,
        default=0,
        help="多进程并行采集 worker 数；0=自动（GPU 设备按 CPU 核数），1=单进程，>1=CPU 多进程 + GPU 更新 + 流水线重叠",
    )
    p.add_argument(
        "--eval-gate-every",
        type=int,
        default=int((RL_REWARD_SHAPING.get("evalGate") or {}).get("everyEpisodes", 0))
        if (RL_REWARD_SHAPING.get("evalGate") or {}).get("enabled", False)
        else 0,
        help="评估门控触发间隔（局数），0=关闭；每隔 N 局对比候选/基线胜率，候选≥基线×win-ratio 才更新基线",
    )
    p.add_argument(
        "--eval-gate-games",
        type=int,
        default=int((RL_REWARD_SHAPING.get("evalGate") or {}).get("nGames", 50)),
        help="评估门控每侧运行的贪心评估局数",
    )
    p.add_argument(
        "--eval-gate-win-ratio",
        type=float,
        default=float((RL_REWARD_SHAPING.get("evalGate") or {}).get("winRatio", 0.55)),
        help="门控胜率倍数阈值；0.55 = 候选须超过基线胜率的 55%%（AlphaZero 默认标准）",
    )
    # ── v8 新增参数 ──────────────────────────────────────────────────────
    p.add_argument(
        "--adaptive-curriculum",
        action="store_true",
        help="启用自适应课程（RL_ADAPTIVE_CURRICULUM=1 亦可）：根据滑动胜率动态调整"
             "课程门槛推进速度；胜率高则加速，胜率低则减速",
    )
    p.add_argument(
        "--beam3ply",
        action="store_true",
        help="启用 3-ply beam（RL_BEAM3PLY=1 亦可）：还有 3 个未放置 dock 块时三层全排列展开，"
             "其余情况自动退化为 2-ply；注意显著增加每步采集耗时",
    )
    p.add_argument(
        "--mcts",
        action="store_true",
        help="启用轻量 MCTS（RL_MCTS=1 亦可）：用 UCT 搜索取代 beam Q 值，"
             "访问分布作为策略目标（类 AlphaZero）；与 beam 互斥，MCTS 优先级更高",
    )
    p.add_argument(
        "--mcts-sims",
        type=int,
        default=0,
        help="MCTS 每步模拟次数；0=使用 game_rules.json 中的 lightMCTS.numSimulations（默认 20）",
    )
    p.add_argument(
        "--mcts-no-reuse",
        action="store_true",
        help="禁用 MCTS 树复用（默认启用）：每步重新建树；用于消融对比",
    )
    p.add_argument(
        "--mcts-train-temp",
        type=float,
        default=1.0,
        help="MCTS 训练时动作采样温度（T=1 按访问频率采样，T=0 贪心，T>1 均匀探索）",
    )
    p.add_argument(
        "--mcts-stochastic",
        action="store_true",
        help="MCTS 叶子节点评估时随机采样出块分布（需 SpawnPredictor 检查点）",
    )
    p.add_argument(
        "--spawn-model-path",
        type=str,
        default="",
        help="SpawnTransformerV2 检查点路径；用于 --mcts-stochastic",
    )
    p.add_argument(
        "--point-encoder",
        action="store_true",
        help="使用 DockPointEncoder（PointNet 形状感知编码）替代默认 DockBoardAttention；"
             "需重新训练，与旧 checkpoint 不兼容",
    )
    p.add_argument(
        "--mcts-batch-size",
        type=int,
        default=0,
        help="v8.2：批量叶子评估并发模拟数（8~32）；0=使用 game_rules.json 中的 evalBatchSize（默认 8）；"
             "n_simulations≥50 时自动启用批量模式",
    )
    p.add_argument(
        "--zobrist-cache-size",
        type=int,
        default=0,
        help="v8.2：Zobrist hash 跨局节点缓存上限（节点数）；0=使用 game_rules.json（默认 5000）；-1=禁用",
    )
    p.add_argument(
        "--zobrist-shared-slots",
        type=int,
        default=0,
        help="v8.3：共享 Zobrist 转置表槽位数（0=使用 game_rules.json 默认 8192）；-1=禁用跨进程共享",
    )
    p.add_argument(
        "--no-zobrist-shared",
        action="store_true",
        help="v8.3：禁用跨进程共享 Zobrist 表（默认启用，仅多 worker 时生效）",
    )
    p.add_argument(
        "--mcts-adaptive",
        action="store_true",
        help="v8.3：启用渐进式模拟次数（adaptive sims）：先跑 --mcts-min-sims，"
             "top1/top2 访问比超过 --mcts-confidence 后提前停止，最多跑 --mcts-sims 次",
    )
    p.add_argument(
        "--mcts-min-sims",
        type=int,
        default=0,
        help="v8.3：adaptive 模式下的最小模拟次数（默认 = mcts-sims / 4）",
    )
    p.add_argument(
        "--mcts-confidence",
        type=float,
        default=3.0,
        help="v8.3：adaptive 模式收敛阈值：top1/top2 访问比 ≥ 此值时提前停止（默认 3.0）",
    )
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = resolve_training_device(args.device)
    apply_throughput_tuning(device)
    apply_cpu_training_tuning(device)
    print(f"使用设备: {device_summary_line(device)}", file=sys.stderr)
    if device.type == "cuda":
        dp_ids = resolve_cuda_device_ids_for_data_parallel()
        if len(dp_ids) > 1:
            trunk_on = os.environ.get("RL_CUDA_DP_TRUNK", "1").lower() not in ("0", "false", "no")
            val_on = os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
            print(
                f"  CUDA data_parallel 卡: {dp_ids}  |  共享主干: {'on' if trunk_on else 'off'} (RL_CUDA_DP_TRUNK)"
                f"  |  仅价值头: {'on' if val_on else 'off'} (RL_CUDA_DP_VALUE，无 forward_trunk 时)",
                file=sys.stderr,
            )

    # v8/v8.1 功能开关（命令行参数 → 环境变量，传递给 collect_episode）
    if getattr(args, "adaptive_curriculum", False):
        os.environ["RL_ADAPTIVE_CURRICULUM"] = "1"
    if getattr(args, "beam3ply", False):
        os.environ["RL_BEAM3PLY"] = "1"
    if getattr(args, "mcts", False):
        os.environ["RL_MCTS"] = "1"
    if getattr(args, "mcts_sims", 0) > 0:
        os.environ["RL_MCTS_SIMS"] = str(args.mcts_sims)
    # v8.1 新增
    if getattr(args, "mcts_no_reuse", False):
        os.environ["RL_MCTS_REUSE"] = "0"
    if getattr(args, "mcts_train_temp", 1.0) != 1.0:
        os.environ["RL_MCTS_TRAIN_TEMP"] = str(args.mcts_train_temp)
    if getattr(args, "mcts_stochastic", False):
        os.environ["RL_MCTS_STOCHASTIC"] = "1"
    if getattr(args, "spawn_model_path", ""):
        os.environ["RL_SPAWN_MODEL_PATH"] = args.spawn_model_path
    # v8.2 新增
    if getattr(args, "mcts_batch_size", 0) > 0:
        os.environ["RL_MCTS_BATCH_SIZE"] = str(args.mcts_batch_size)
    _zobrist_cache_size = getattr(args, "zobrist_cache_size", 0)
    if _zobrist_cache_size != 0:
        os.environ["RL_ZOBRIST_CACHE_SIZE"] = str(_zobrist_cache_size)
    _use_point_encoder = getattr(args, "point_encoder", False)
    # v8.3 新增
    _zshared_slots = getattr(args, "zobrist_shared_slots", 0)
    if _zshared_slots != 0:
        os.environ["RL_ZOBRIST_SHARED_SLOTS"] = str(_zshared_slots)
    if getattr(args, "no_zobrist_shared", False):
        os.environ["RL_ZOBRIST_SHARED"] = "0"
    if getattr(args, "mcts_adaptive", False):
        os.environ["RL_MCTS_ADAPTIVE"] = "1"
    if getattr(args, "mcts_min_sims", 0) > 0:
        os.environ["RL_MCTS_MIN_SIMS"] = str(args.mcts_min_sims)
    if getattr(args, "mcts_confidence", 3.0) != 3.0:
        os.environ["RL_MCTS_CONFIDENCE"] = str(args.mcts_confidence)

    arch = args.arch.strip().lower()
    net = build_policy_net(
        arch,
        width=args.width,
        policy_depth=args.policy_depth,
        value_depth=args.value_depth,
        mlp_ratio=args.mlp_ratio,
        device=device,
        conv_channels=getattr(args, "conv_channels", 32),
        use_point_encoder=_use_point_encoder,
    )

    resume_path = Path(args.resume) if args.resume else None
    save_path = Path(args.save)

    algo_label = f"PPO(epochs={args.ppo_epochs}, clip={args.ppo_clip})" if args.ppo_epochs > 1 else "REINFORCE"
    n_params = sum(p.numel() for p in net.parameters())
    print(f"架构: {arch}  |  参数量: {n_params:,}  |  算法: {algo_label}", file=sys.stderr)

    total_eps = train_loop(
        net,
        device,
        episodes=args.episodes,
        lr=args.lr,
        value_coef=args.value_coef,
        gamma=args.gamma,
        log_every=args.log_every,
        save_every=args.save_every,
        ckpt_path=save_path,
        resume=resume_path,
        entropy_coef=args.entropy_coef,
        normalize_adv=not args.no_adv_norm,
        grad_clip=args.grad_clip,
        adv_min_std=args.adv_min_std,
        value_huber_beta=args.value_huber_beta,
        gae_lambda=args.gae_lambda,
        temp_floor=args.temp_floor,
        explore_first_moves=args.explore_first_moves,
        explore_temp_mult=args.explore_temp_mult,
        dirichlet_epsilon=args.dirichlet_epsilon,
        dirichlet_alpha=args.dirichlet_alpha,
        train_arch=arch,
        mlp_ratio=args.mlp_ratio,
        policy_depth_arg=args.policy_depth,
        value_depth_arg=args.value_depth,
        batch_episodes=args.batch_episodes,
        n_workers=args.n_workers,
        ppo_epochs=args.ppo_epochs,
        ppo_clip=args.ppo_clip,
        eval_gate_every=args.eval_gate_every,
        eval_gate_games=args.eval_gate_games,
        eval_gate_win_ratio=args.eval_gate_win_ratio,
    )

    save_path.parent.mkdir(parents=True, exist_ok=True)
    final_meta = _checkpoint_meta(
        net,
        device,
        args.gamma,
        args.lr,
        arch,
        args.mlp_ratio,
        args.policy_depth,
        args.value_depth,
    )
    final_meta["win_threshold"] = WIN_SCORE_THRESHOLD
    final_meta["gae_lambda"] = args.gae_lambda
    final_meta["ppo_epochs"] = args.ppo_epochs
    final_meta["ppo_clip"] = args.ppo_clip
    final_meta["rl_curriculum"] = rl_curriculum_enabled()
    torch.save(
        {
            "model": net.state_dict(),
            "episodes": total_eps,
            "meta": final_meta,
        },
        save_path,
    )
    meta_path = save_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(
            {
                "checkpoint": str(save_path),
                "episodes": total_eps,
                "device": str(device),
                "note": "与 rl_pytorch 模拟器一致；浏览器端需另行对接。",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"已保存 {save_path}（累计局数 {total_eps}）", file=sys.stderr)


if __name__ == "__main__":
    main()
