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
import platform
import random
import sys
import tempfile
import time
import uuid
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
    disable_cpu_conv_backends,
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
from .strategy_features import sample_rl_training_strategy_id

# ---------------------------------------------------------------------------
# training.jsonl 追加（主进程 + worker 共用；fcntl 避免多进程交错写）
# ---------------------------------------------------------------------------


def _append_training_jsonl_entry(entry: dict) -> None:
    """与 rl_backend._append_training_log 字段对齐，看板 rlTrainingCharts.js 可读。"""
    path_str = os.environ.get("RL_TRAINING_LOG", "").strip()
    if not path_str:
        return
    path = Path(path_str)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": int(time.time()), **entry}
        line = json.dumps(row, ensure_ascii=False) + "\n"
        with open(path, "a", encoding="utf-8") as f:
            try:
                import fcntl

                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    f.write(line)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            except (ImportError, AttributeError, OSError):
                f.write(line)
    except OSError:
        pass  # 写日志失败不应阻塞训练


def _emit_train_progress_heartbeat(global_ep: int, ep_data: dict) -> None:
    """采集进度心跳：每打完一局即写一条，看板可逐局刷新局数/得分。"""
    _append_training_jsonl_entry({
        "event": "train_progress",
        "episodes": int(global_ep),
        "score": float(ep_data.get("score", 0.0)),
        "steps": int(ep_data.get("steps", 0)),
        "won": bool(ep_data.get("won", False)),
    })


def _git_sha_short() -> str:
    try:
        import subprocess
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(Path(__file__).resolve().parents[1]),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2.0,
        )
        return out.strip()
    except Exception:
        return ""


def _safe_env_manifest() -> dict:
    """只记录影响训练语义/吞吐的关键 env，避免把 shell 环境和潜在秘密写入日志。"""
    keys = (
        "RL_TRAINING_PRESET", "RL_DEVICE", "RL_MCTS", "RL_MCTS_SIMS",
        "RL_MCTS_MIN_SIMS", "RL_MCTS_MAX_SIMS", "RL_MCTS_CONFIDENCE",
        "RL_MCTS_BATCH_THRESHOLD", "RL_MCTS_BATCH_SIZE", "RL_MCTS_ADAPTIVE",
        "RL_BEAM2PLY", "RL_BEAM3PLY", "RL_LOOKAHEAD", "RL_SUPERVISION",
        "RL_SPAWN_ONLINE", "RL_SPAWN_CHEAP", "RL_SPAWN_LEGACY",
        "RL_WORKER_THREADS", "RL_NO_NUMBA", "RL_COLLECT_SCHEDULER",
        "RL_WEIGHT_BROADCAST", "RL_TRAINING_STAGE",
    )
    return {k: os.environ.get(k) for k in keys if os.environ.get(k) is not None}


def _quality_gate_manifest() -> dict:
    """训练效率优化的质量护栏；仅记录阈值，实际对比由评估/看板消费。"""
    def _f(name: str, default: float) -> float:
        try:
            return float(os.environ.get(name, str(default)))
        except ValueError:
            return default

    return {
        "teacher_coverage_drop_max": _f("RL_GATE_TEACHER_COVERAGE_DROP_MAX", 0.02),
        "avg100_drop_max_ratio": _f("RL_GATE_AVG100_DROP_MAX_RATIO", 0.03),
        "spawn_drift_max": _f("RL_GATE_SPAWN_DRIFT_MAX", 0.05),
        "throughput_must_improve": os.environ.get("RL_GATE_THROUGHPUT_REQUIRED", "1") not in ("0", "false", "no", "off"),
    }


# ---------------------------------------------------------------------------
# 多进程 worker（CPU 推理采集，GPU 专做更新）
# ---------------------------------------------------------------------------
_pool_net: AnyNet | None = None
_pool_device = torch.device("cpu")
_pool_shared_table = None   # SharedZobristTable 附加对象（worker 端）
_pool_w_version: int = -1   # P2：worker 端已加载权重的版本号，避免同批内重复 load_state_dict


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
    # 性能关键：每个 worker 是独立进程，torch 默认按物理核数开 intra-op 线程；
    # N workers × N threads 在 CPU 上严重超额订阅（context-switch + 缓存抖动），
    # 而 21 万参数小网络做单样本/小批 CPU 推理用多线程几乎零收益。固定单线程后，
    # 实际并行度 = worker 数，单局采集吞吐显著提升（可用 RL_WORKER_THREADS 调整）。
    try:
        _wt = max(1, int(os.environ.get("RL_WORKER_THREADS", "1") or "1"))
    except ValueError:
        _wt = 1
    try:
        torch.set_num_threads(_wt)
    except Exception:
        pass
    try:
        if hasattr(torch, "set_num_interop_threads"):
            torch.set_num_interop_threads(1)
    except Exception:
        # 已初始化过：只能设一次，忽略
        pass
    # spawn 子进程不继承主进程的 torch.backends 状态，须在此各自关闭
    # NNPACK / oneDNN，否则旧 CPU 上 Conv2d 会抛 could not create a primitive。
    disable_cpu_conv_backends()
    _pool_net = build_policy_net(arch, width, pd, vd, mr, _pool_device, conv_channels=cc)
    _pool_net.eval()
    if shm_name and shm_slots > 0:
        try:
            from .mcts import SharedZobristTable  # type: ignore[attr-defined]
            _pool_shared_table = SharedZobristTable.attach(shm_name, shm_slots)
            # P0-2 · worker 退出时主动 close，避免 resource_tracker 报
            # "leaked shared_memory objects" 并产生 /psm_xxx 物理段碎片
            import atexit as _atexit
            def _close_shared_table_on_exit():
                try:
                    if _pool_shared_table is not None:
                        _pool_shared_table.close()
                except Exception:
                    pass
            _atexit.register(_close_shared_table_on_exit)
        except Exception:
            _pool_shared_table = None


def _pool_worker_collect(args: tuple) -> list[dict]:
    """Worker：加载最新权重 → 采集若干局 → 返回轨迹。

    args = (weight_version, weight_bytes, configs[, weight_path])。
    - 默认用 weight_path：主进程每批 torch.save 一次到临时文件，任务只传短路径；
    - 兼容旧 bytes 路径：weight_bytes 非空时从 bytes 加载；
    - 同批次所有 per-episode 任务共享同一 weight_version，worker 仅在版本变化时
      torch.load + load_state_dict 一次，其余任务直接复用 _pool_net，省去重复反序列化。

    config tuple: (global_ep, temp_floor, explore_first_moves, explore_temp_mult,
                   dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
    第 7 个元素 win_threshold_override 为可选（None 表示使用线性课程）。
    """
    global _pool_net, _pool_device, _pool_w_version
    weight_version, weight_bytes, configs = args[:3]
    weight_path = args[3] if len(args) > 3 else ""
    if weight_bytes is not None and weight_version != _pool_w_version:
        import io as _io
        sd = torch.load(_io.BytesIO(weight_bytes), map_location="cpu")
        _pool_net.load_state_dict(sd)
        _pool_w_version = weight_version
    elif weight_path and weight_version != _pool_w_version:
        sd = torch.load(str(weight_path), map_location="cpu")
        _pool_net.load_state_dict(sd)
        _pool_w_version = weight_version
    episodes_out: list[dict] = []
    # L8 性能优化：worker 推理用 inference_mode 替代默认 eval+autograd 跟踪。
    # - 关闭 view tracking / version counter / autograd metadata，省 ~20% 临时张量元数据；
    # - simulator 内部所有 net.forward / forward_value / forward_trunk 调用一并受益；
    # - 仅采集场景安全（不反传），写采集 trajectory 时已用 .copy()/.numpy() 解耦张量。
    with torch.inference_mode():
        for cfg in configs:
            ep_data = collect_episode(
                _pool_net, _pool_device,
                cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5],
                win_threshold_override=cfg[6] if len(cfg) > 6 else None,
            )
            episodes_out.append(ep_data)
            # 多 worker 并行采集时也逐局写心跳（与单进程路径一致），避免整批攒满前看板无输出。
            _emit_train_progress_heartbeat(cfg[0], ep_data)
    return episodes_out


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


def _sanitize_grads(net: torch.nn.Module) -> bool:
    """将各参数梯度中的 nan/inf 分量原地置零，保留有限分量。

    返回是否检测到并清理了非有限梯度。相比「整批丢弃更新」，只清理坏分量能保住
    其余健康样本/参数的学习信号，把偶发数值毛刺从「半数更新被浪费」降为「局部置零」。
    """
    sanitized = False
    for p in net.parameters():
        g = p.grad
        if g is None:
            continue
        if not bool(torch.isfinite(g).all().item()):
            sanitized = True
            # 用 nan_to_num_ 原地清零（MPS 兼容；布尔索引原地赋值在 MPS 上不可靠）
            torch.nan_to_num_(g, nan=0.0, posinf=0.0, neginf=0.0)
        # 钳到大的有限范围，避免极大有限梯度在 clip_grad_norm_ 求 Σg² 时溢出成 inf
        # （随后 clip_grad_norm_ 会把总范数归一化到 grad_clip，此处上限不影响正常更新）。
        g.clamp_(-1e4, 1e4)
    return sanitized


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


def _pack_training_state(
    *,
    use_quantile: bool,
    quant_score_history,
    quant_ema: float,
    quant_ema_inited: bool,
    quant_peak: float,
    quant_last_thr: int,
    quant_last_action: str,
    quant_last_target: float,
    guard_on: bool,
    guard_best_sd,
    guard_best_avg: float,
    guard_rollbacks: int,
    guard_scores,
    guard_best_stats=None,
    guard_observed_means=None,
    guard_health=None,
) -> dict:
    """落盘 quantile 课程 + BestGuard 运行时状态，供 resume 续训不重新 bootstrap。

    v2: 新增 guard_best_stats / guard_observed_means / guard_health 三项，
    用于显著性检验、启动自检和健康度恢复。三者均可选（旧 ckpt 兼容）。
    """
    state: dict = {}
    if use_quantile:
        state["quantile"] = {
            "score_history": [float(x) for x in quant_score_history],
            "ema": float(quant_ema),
            "ema_inited": bool(quant_ema_inited),
            "peak": float(quant_peak),
            "last_thr": int(quant_last_thr),
            "last_action": str(quant_last_action),
            "last_target": float(quant_last_target),
        }
    if guard_on and guard_best_sd is not None:
        bg_entry: dict = {
            "best_avg": float(guard_best_avg),
            "rollbacks": int(guard_rollbacks),
            "recent_scores": [float(x) for x in guard_scores],
        }
        if guard_best_stats is not None:
            bg_entry["best_stats"] = {
                "avg": float(guard_best_stats.avg),
                "std": float(guard_best_stats.std),
                "n": int(guard_best_stats.n),
                "median": float(guard_best_stats.median),
            }
        if guard_observed_means is not None:
            bg_entry["observed_means"] = [float(x) for x in guard_observed_means]
        if guard_health is not None:
            bg_entry["health"] = {
                "rollback_events": list(guard_health.rollback_events),
                "suspended_until_ep": int(guard_health.suspended_until_ep),
                "last_alert_ep": int(guard_health.last_alert_ep),
                "consecutive_severe": int(guard_health.consecutive_severe),
            }
        state["best_guard"] = bg_entry
    return state


def _restore_training_runtime_state(
    ckpt: dict,
    *,
    net,
    lr: float,
    use_quantile: bool,
    guard_on: bool,
    quant_window: int,
    guard_window: int,
    ref_net,
) -> tuple[dict, list[str]]:
    """从 checkpoint 恢复 quantile + BestGuard；返回 (patches, log_lines)。

    patches 键名与 train_loop 局部变量对应，由调用方逐项写回。
    best_guard 恢复时调用方应重建 Adam（动量与 best 权重不对齐）。
    """
    import collections

    meta = ckpt.get("meta") or {}
    ts = ckpt.get("training_state") or {}
    patches: dict = {}
    logs: list[str] = []

    if use_quantile and "quantile" in ts:
        q = ts["quantile"]
        hist = q.get("score_history") or []
        patches["quant_score_history"] = collections.deque(
            (float(x) for x in hist),
            maxlen=max(1, quant_window),
        )
        patches["quant_ema"] = float(q.get("ema", 0.0))
        patches["quant_ema_inited"] = bool(q.get("ema_inited", False))
        patches["quant_peak"] = float(q.get("peak", 0.0))
        patches["quant_last_thr"] = int(q.get("last_thr", 40))
        patches["quant_last_action"] = str(q.get("last_action", "restored"))
        patches["quant_last_target"] = float(q.get("last_target", -1.0))
        logs.append(
            f"  ↳ quantile 已恢复: thr={patches['quant_last_thr']} "
            f"n={len(patches['quant_score_history'])} ema={patches['quant_ema']:.1f} "
            f"peak={patches['quant_peak']:.1f}"
        )
    elif use_quantile:
        logs.append(
            "  ↳ quantile 无 training_state（旧 checkpoint）→ 将从 bootstrap 热身，"
            "重启后 avg100/胜率可能短暂失真"
        )

    saved_as = str(meta.get("saved_model") or "")
    bg = ts.get("best_guard") or {}
    if guard_on and (saved_as == "best_guard" or bg):
        best_avg = float(bg.get("best_avg") or meta.get("guard_best_avg") or 0.0)
        rollbacks = int(
            bg.get("rollbacks")
            if bg.get("rollbacks") is not None
            else meta.get("guard_rollbacks") or 0
        )
        patches["guard_best_avg"] = best_avg
        patches["guard_rollbacks"] = rollbacks
        patches["guard_best_sd"] = {k: v.clone().cpu() for k, v in net.state_dict().items()}
        rs = bg.get("recent_scores") or []
        if rs:
            patches["guard_scores"] = collections.deque(
                (float(x) for x in rs),
                maxlen=max(1, guard_window),
            )
        # v2: 恢复 best 窗口统计量；旧 ckpt 没有该字段时回退到 (avg, 0, 200)
        bs = bg.get("best_stats") or {}
        if bs:
            patches["guard_best_stats"] = {
                "avg": float(bs.get("avg", best_avg)),
                "std": float(bs.get("std", 0.0)),
                "n": int(bs.get("n", max(1, guard_window))),
                "median": float(bs.get("median", 0.0)),
            }
        else:
            patches["guard_best_stats"] = {
                "avg": float(best_avg),
                "std": 0.0,
                "n": max(1, guard_window),
                "median": 0.0,
            }
        # v2: 恢复观测历史和健康度（用于启动自检与速率限制）
        obs = bg.get("observed_means") or []
        if obs:
            patches["guard_observed_means"] = collections.deque(
                (float(x) for x in obs),
                maxlen=500,
            )
        hs = bg.get("health") or {}
        if hs:
            patches["guard_health"] = {
                "rollback_events": tuple(int(x) for x in hs.get("rollback_events", [])),
                "suspended_until_ep": int(hs.get("suspended_until_ep", -1)),
                "last_alert_ep": int(hs.get("last_alert_ep", -(10 ** 9))),
                "consecutive_severe": int(hs.get("consecutive_severe", 0)),
            }
        patches["rebuild_optimizer"] = True
        if ref_net is not None:
            ref_net.load_state_dict(net.state_dict())
        logs.append(
            f"  ↳ BestGuard 已恢复: best_avg={best_avg:.1f} rollbacks={rollbacks} "
            f"(Adam 将重建以匹配 best 权重)"
        )

    return patches, logs


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


def _outcome_value_ref() -> float:
    """outcome 价值目标的固定绝对参考分。

    历史实现用「当前课程门槛」作分母，但门槛在 quantile 课程下会随策略退化一起下跌，
    导致同一分数映射出更高的 value 目标（价值头"自我安慰"）、目标非平稳 → Lv 上升、
    丧失对退化的纠偏能力。改用固定绝对参考分，使 value 目标平稳且与课程解耦。
    """
    ocfg = RL_REWARD_SHAPING.get("outcomeValueMix") or {}
    if (raw := os.environ.get("RL_OUTCOME_REF_SCORE", "").strip()) != "":
        return max(float(raw), 1.0)
    return max(float(ocfg.get("refScore", 1500.0)), 1.0)


def _outcome_value_target(score: float, threshold: float | None = None) -> float:
    """终局分数价值目标，默认 log 变换以保留高分段差异。

    分母为固定绝对参考分（见 _outcome_value_ref），不再依赖随课程漂移的 threshold。
    threshold 形参仅为兼容旧调用，已忽略。
    """
    ocfg = RL_REWARD_SHAPING.get("outcomeValueMix") or {}
    mode = os.environ.get("RL_OUTCOME_VALUE_MODE", str(ocfg.get("targetMode", "log"))).strip().lower()
    max_value = float(os.environ.get("RL_OUTCOME_VALUE_MAX", str(ocfg.get("maxValue", 3.0))))
    denom = _outcome_value_ref()
    if mode == "linear":
        val = float(score) / denom
    else:
        val = float(np.log1p(max(float(score), 0.0)) / np.log1p(denom))
    return float(np.clip(val, 0.0, max(max_value, 1.0)))


# P0：监督被跳过时填入的中性默认（与 update 消费端的 .get 默认一致，不影响 aux 损失）。
_SUP_NEUTRAL: dict = {
    "board_quality": 0.0,
    "feasibility": 1.0,
    "topology_after": None,
    "spawn_difficulty_after": None,
}


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


def _spawn_diff_aux_coef() -> float:
    """v12 单步出块难度辅助监督系数。"""
    if (raw := os.environ.get("RL_SPAWN_DIFF_AUX_COEF", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("spawnDiffAux") or {}
    if isinstance(cfg, dict):
        if not cfg.get("enabled", False):
            return 0.0
        return float(cfg.get("coef", 0.05))
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


def _mcts_risk_adaptive_sims(sim: OpenBlockSimulator, legal: list[dict], base_sims: int, cfg: dict, risk_node_budget: int = 150) -> int:
    """高风险局面提升 MCTS sims；低风险降 sims 仅在显式配置时启用。

    质量约束：默认行为保持“普通局面不低于 base_sims”，避免为了吞吐削弱 teacher。
    需要更激进的吞吐实验时，可设 RL_MCTS_RISK_LOW_MULT=0.75 等显式降低低风险局面 sims。
    """
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
    # 高分支局面虽然不一定危险，但 teacher 更容易分歧；可由 preset/env 追加预算。
    branch_thr = int(os.environ.get("RL_MCTS_RISK_BRANCHING", int(cfg.get("riskBranching", 0) or 0)))
    if branch_thr > 0 and mobility >= branch_thr:
        risk += float(cfg.get("riskBranchingWeight", 0.15))
    try:
        if sim.count_sequential_solution_leaves(leaf_cap=2, node_budget=risk_node_budget) <= 1:
            risk += 0.30
    except Exception:
        pass
    risk = float(np.clip(risk, 0.0, 1.0))
    if risk <= 1e-9:
        low_mult = float(os.environ.get("RL_MCTS_RISK_LOW_MULT", cfg.get("riskLowMultiplier", 1.0)))
        return max(1, int(round(base_sims * max(0.1, min(1.0, low_mult)))))
    mult = 1.0 + risk * (float(cfg.get("riskMaxMultiplier", 2.0)) - 1.0)
    max_sims = int(os.environ.get("RL_MCTS_MAX_SIMS", int(cfg.get("maxSimulations", max(base_sims, 80)))))
    return max(base_sims, min(max_sims, int(round(base_sims * mult))))


def _beam3_risk_adaptive_params(sim: OpenBlockSimulator, legal: list[dict], cfg: dict, risk_node_budget: int = 150) -> tuple[int, int, int, int, float]:
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
        leaves = sim.count_sequential_solution_leaves(leaf_cap=2, node_budget=risk_node_budget)
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
        "keepTopRatio": 0.5,
        "scorePower": 1.5,
        "minScorePercentile": 0.55,
        "minPriority": 0.0,
        # 高分优先回放（防退化锚）：保留/采样改为偏好高分局，并对其 chosen 动作做
        # 轻量行为克隆（"记住有效打法"），抵抗灾难性遗忘。默认开启。
        "highScoreReplay": True,
        "bcCoef": 0.1,
        # BC 退火：强行为锚定早期防遗忘、后期让位策略继续上探，避免被历史分布绑死。
        # bcAnnealEpisodes<=0 或 bcCoefEnd==bcCoef 时不退火（向后兼容）。
        "bcCoefEnd": 0.1,
        "bcAnnealEpisodes": 0,
    }
    cfg.update(RL_REWARD_SHAPING.get("searchReplay") or {})
    cfg.setdefault("bcCoefEnd", cfg.get("bcCoef", 0.1))
    if (raw_hs := os.environ.get("RL_HIGH_SCORE_REPLAY", "").strip().lower()) in ("1", "true", "yes", "on"):
        cfg["highScoreReplay"] = True
    elif raw_hs in ("0", "false", "no", "off"):
        cfg["highScoreReplay"] = False
    if (raw_bc := os.environ.get("RL_REPLAY_BC_COEF", "").strip()) != "":
        cfg["bcCoef"] = float(raw_bc)
    if (raw_bce := os.environ.get("RL_REPLAY_BC_COEF_END", "").strip()) != "":
        cfg["bcCoefEnd"] = float(raw_bce)
    if (raw_bca := os.environ.get("RL_REPLAY_BC_ANNEAL_EP", "").strip()) != "":
        cfg["bcAnnealEpisodes"] = int(raw_bca)
    for key, env_key, cast in (
        ("sampleRatio", "RL_REPLAY_SAMPLE_RATIO", float),
        ("maxSamples", "RL_REPLAY_MAX_SAMPLES", int),
        ("keepTopRatio", "RL_REPLAY_KEEP_TOP_RATIO", float),
        ("scorePower", "RL_REPLAY_SCORE_POWER", float),
        ("minScorePercentile", "RL_REPLAY_MIN_SCORE_PCT", float),
    ):
        if (raw_v := os.environ.get(env_key, "").strip()) != "":
            cfg[key] = cast(raw_v)
    raw = os.environ.get("RL_SEARCH_REPLAY", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        cfg["enabled"] = True
    elif raw in ("0", "false", "no", "off"):
        cfg["enabled"] = False
    cfg["sampleRatio"] = float(np.clip(float(cfg.get("sampleRatio", 0.5)), 0.0, 2.0))
    cfg["maxSamples"] = max(0, int(cfg.get("maxSamples", 8)))
    cfg["keepTopRatio"] = float(np.clip(float(cfg.get("keepTopRatio", 0.5)), 0.0, 1.0))
    cfg["scorePower"] = max(0.0, float(cfg.get("scorePower", 1.5)))
    cfg["minScorePercentile"] = float(np.clip(float(cfg.get("minScorePercentile", 0.55)), 0.0, 1.0))
    cfg["bcCoef"] = max(0.0, float(cfg.get("bcCoef", 0.1)))
    cfg["bcCoefEnd"] = max(0.0, float(cfg.get("bcCoefEnd", cfg["bcCoef"])))
    cfg["bcAnnealEpisodes"] = max(0, int(cfg.get("bcAnnealEpisodes", 0)))
    return cfg


def _replay_bc_coef_at(cfg: dict, episode: int) -> float:
    """按训练进度线性退火 BC 系数：start→end，over bcAnnealEpisodes。"""
    start = float(cfg.get("bcCoef", 0.1))
    end = float(cfg.get("bcCoefEnd", start))
    horizon = int(cfg.get("bcAnnealEpisodes", 0))
    if horizon <= 0 or abs(end - start) < 1e-9:
        return start
    frac = min(1.0, max(0.0, float(episode) / float(horizon)))
    return start + (end - start) * frac


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
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.005"))
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

    with sim.search_mode():
        for i, a in enumerate(legal):
            r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
            rewards[i] = r
            next_states[i] = sim.extract_state()
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

    with sim.search_mode():
        # ——— 第一层：计算所有动作的 r1 + V(s') ———
        r1_arr = np.empty(n_actions, dtype=np.float32)
        next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
        for i, a in enumerate(legal):
            r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
            next_states[i] = sim.extract_state()
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
                ns2[j] = sim.extract_state()
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

    with sim.search_mode():
        # ——— 第一层：计算所有动作的 r1 + V(s') ———
        r1_arr = np.empty(n_actions, dtype=np.float32)
        next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
        for i, a in enumerate(legal):
            r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
            next_states[i] = sim.extract_state()
            sim.restore_state(saved)

        with torch.no_grad():
            ns_t = tensor_to_device(torch.from_numpy(next_states), device)
            v1 = net.forward_value(ns_t).cpu().numpy().flatten()

        q1 = r1_arr + gamma * v1
        q3ply = q1.copy()

        top_k_actual = min(top_k, n_actions)
        top_k_idxs = np.argsort(q1)[-top_k_actual:]

        # ——— 第二 / 三层批量收集 ———
        ply2_best: dict[int, tuple[float, np.ndarray, np.ndarray]] = {}

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
                ns2[j] = sim.extract_state()
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
    with sim.search_mode():
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
                    ns3[k] = sim.extract_state()
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
    try:
        from . import spawn_online as _spawn_stats_mod
        _spawn_stats_mod.reset_spawn_stats()
    except Exception:
        _spawn_stats_mod = None

    ep_strategy = sample_rl_training_strategy_id()
    # v12 风格族 token：训练时按 conditionToken.samplingProb 随机注入 (arc, intent)；
    # 同时让 simulator 拿到当前 episode 的难度桶 scd 上限以做 dock 重抽。
    from .condition_token import sample_condition
    from .simulator import max_scd_for_episode
    cond_arc, cond_intent = sample_condition()
    max_scd = max_scd_for_episode(global_ep)
    sim = OpenBlockSimulator(
        ep_strategy,
        condition_arc=cond_arc,
        condition_intent=cond_intent,
        max_scd=max_scd,
    )
    if win_threshold_override is not None:
        sim.win_score_threshold = win_threshold_override
    else:
        sim.win_score_threshold = rl_win_threshold_for_episode(global_ep)
    # E：开启局内精确 phi 缓存（同盘面重复 build_phi_batch 命中即复用，逐字段等价）。
    try:
        from .features import phi_cache_begin_episode as _phi_cache_begin
        _phi_cache_begin()
    except Exception:
        pass
    trajectory: list[dict] = []
    mcts_sims_used_vals: list[int] = []
    gamma = float(os.environ.get("RL_GAMMA", "0.99"))
    use_lookahead = os.environ.get("RL_LOOKAHEAD", "1").lower() not in ("0", "false", "no")
    lookahead_mix = float(os.environ.get("RL_LOOKAHEAD_MIX", "0.5"))

    # --- 训练预设覆盖（performance / balanced / quality）---
    from .game_rules import rl_active_preset_config
    _preset = rl_active_preset_config()
    _preset_mcts = _preset.get("mcts") or {}
    _preset_b3 = _preset.get("beam3ply") or {}
    _preset_b2 = _preset.get("beam2ply") or {}
    _feasibility_budget = int(_preset.get("feasibilityNodeBudget", 200))
    _risk_budget = int(_preset.get("riskNodeBudget", 150))

    # P0：监督税开关化。get_supervision_signals 每步跑可行性 DFS + 棋盘势能 + 拓扑，
    # 仅当对应辅助头系数 > 0 时才有意义。系数全为 0（如 performance 预设）时整段跳过，
    # 复刻早期纯 PPO 的轻量热路径。RL_SUPERVISION 可显式覆盖（0 强制关 / 1 强制开）。
    _sup_env = os.environ.get("RL_SUPERVISION", "").strip().lower()
    if _sup_env in ("0", "false", "no", "off"):
        _need_sup = False
    elif _sup_env in ("1", "true", "yes", "on"):
        _need_sup = True
    else:
        _need_sup = (
            _board_quality_coef() > 1e-9
            or _feasibility_coef() > 1e-9
            or _topology_aux_coef() > 1e-9
            or _spawn_diff_aux_coef() > 1e-9
        )

    # --- 搜索策略选择（优先级：MCTS > 3-ply beam > 2-ply beam > 1-step）---
    _mcts_cfg = RL_REWARD_SHAPING.get("lightMCTS") or {}
    # preset 可覆盖 enabled / numSimulations 等
    _mcts_cfg_eff = {**_mcts_cfg, **_preset_mcts}
    use_mcts = (
        _mcts_cfg_eff.get("enabled", False)
        or os.environ.get("RL_MCTS", "0").lower() not in ("0", "false", "no")
    )
    # 显式 RL_MCTS=0 时强制关闭（否则 game_rules 里 lightMCTS.enabled 无法局部关掉）
    _mcts_env_neg = os.environ.get("RL_MCTS", "").strip().lower()
    if _mcts_env_neg in ("0", "false", "no", "off"):
        use_mcts = False
    _mcts_sims = int(_mcts_cfg_eff.get("numSimulations", 20))
    _mcts_cpuct = float(_mcts_cfg.get("cPuct", 1.5))
    _mcts_depth = int(_mcts_cfg.get("maxDepth", 8))
    # v8.1：MCTS 树复用 + 多温度采样 + SpawnPredictor
    _use_mcts_reuse = (
        use_mcts
        and os.environ.get("RL_MCTS_REUSE", "1").lower() not in ("0", "false", "no")
    )
    _mcts_train_temp = float(os.environ.get("RL_MCTS_TRAIN_TEMP", "1.0"))
    _spawn_pred: "SpawnPredictor | None" = None
    _stoch_env = os.environ.get("RL_MCTS_STOCHASTIC", "").strip().lower()
    if _stoch_env in ("1", "true", "yes", "on"):
        _mcts_stochastic = True
    elif _stoch_env in ("0", "false", "no", "off"):
        _mcts_stochastic = False
    else:
        _mcts_stochastic = bool(_mcts_cfg_eff.get("stochastic", False))
    if use_mcts and _mcts_stochastic:
        from .spawn_predictor import SpawnPredictor as _SP
        _spawn_pred = _SP.load(device=device)
    # v8.3：渐进式模拟次数（默认跟 game_rules lightMCTS.adaptiveSims；显式 RL_MCTS_ADAPTIVE 覆盖）
    _adapt_env = os.environ.get("RL_MCTS_ADAPTIVE", "").strip().lower()
    if _adapt_env in ("0", "false", "no", "off"):
        _mcts_adaptive = False
    elif _adapt_env in ("1", "true", "yes", "on"):
        _mcts_adaptive = bool(use_mcts)
    else:
        _mcts_adaptive = bool(use_mcts and _mcts_cfg_eff.get("adaptiveSims", False))
    _mcts_min_sims = int(os.environ.get("RL_MCTS_MIN_SIMS", max(10, _mcts_sims // 4)))
    _mcts_confidence = float(os.environ.get("RL_MCTS_CONFIDENCE", "3.0"))

    # D：优先级 teacher（默认关闭）。在「策略高置信 + 低风险 + mobility 充足」的步上跳过昂贵
    # 搜索，把 teacher 预算留给困难步。改变 teacher 覆盖分布，必须经 rl-quality-gate A/B 验证
    # （teacher 覆盖下降 ≤2%、avg100/eval 不退化）后再开。RL_TEACHER_GATE=1 启用。
    _teacher_gate_enabled = os.environ.get("RL_TEACHER_GATE", "0").strip().lower() in ("1", "true", "yes", "on")
    _tg_conf = float(os.environ.get("RL_TEACHER_GATE_CONF", "0.92"))
    _tg_maxfill = float(os.environ.get("RL_TEACHER_GATE_MAXFILL", "0.55"))
    _tg_minlegal = int(os.environ.get("RL_TEACHER_GATE_MINLEGAL", "12"))
    _teacher_skipped = 0
    _teacher_eligible = 0

    _beam3ply_cfg = {**(RL_REWARD_SHAPING.get("beam3ply") or {}), **_preset_b3}
    use_beam3ply = (
        (_beam3ply_cfg.get("enabled", False)
         or os.environ.get("RL_BEAM3PLY", "0").lower() not in ("0", "false", "no"))
        and not use_mcts
    )
    _b3_topk = int(_beam3ply_cfg.get("topK", 15))
    _b3_topk2 = int(_beam3ply_cfg.get("topK2", 5))
    _b3_max = int(_beam3ply_cfg.get("maxActions", 100))
    _b3_max2 = int(_beam3ply_cfg.get("maxActions2", 50))

    _beam2ply_cfg = {**(RL_REWARD_SHAPING.get("beam2ply") or {}), **_preset_b2}
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
        # D：优先级 teacher 门控——置信且低风险的步跳过搜索，预算留给困难步。
        _run_teacher = True
        if _teacher_gate_enabled and use_lookahead and step_idx >= explore_first_moves:
            _teacher_eligible += 1
            with torch.no_grad():
                _top1 = float(torch.softmax(logits, dim=-1).max().item())
            _gnp_gate = sim._ensure_grid_np()
            _fill = float((_gnp_gate >= 0).sum()) / float(max(_gnp_gate.size, 1))
            if _top1 >= _tg_conf and _fill <= _tg_maxfill and len(legal) >= _tg_minlegal:
                _run_teacher = False
                _teacher_skipped += 1
        if use_lookahead and step_idx >= explore_first_moves and _run_teacher:
            if use_mcts:
                mcts_sims_eff = _mcts_risk_adaptive_sims(sim, legal, _mcts_sims, _mcts_cfg, risk_node_budget=_risk_budget)
                _sims_used = int(mcts_sims_eff)
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
                if q_vals is not None or _visit_pi is not None:
                    mcts_sims_used_vals.append(int(_sims_used))
            elif use_beam3ply:
                # 3-ply beam：还有 3 个未放置 dock 块时展开，否则自动退化为 2-ply/1-step
                _b3_topk_eff, _b3_max_eff, _b3_topk2_eff, _b3_max2_eff, _beam_risk = _beam3_risk_adaptive_params(
                    sim, legal, _beam3ply_cfg, risk_node_budget=_risk_budget
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

        if _need_sup:
            # F0-3 简单隔离：simulator 内部 feasibility DFS / spawn_online 偶发抛异常
            # （日志 259 次 Traceback 多来自 sim.get_supervision_signals → 触发 SIGTERM 重启），
            # 这些信号是辅助 head 监督，失败时给中性默认值即可，不应炸整个 episode collection
            try:
                sup = sim.get_supervision_signals(feasibility_node_budget=_feasibility_budget)
            except Exception:
                sup = _SUP_NEUTRAL
        else:
            sup = _SUP_NEUTRAL
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
            "spawn_difficulty_after": sup.get("spawn_difficulty_after"),
            # Q 分布蒸馏目标：MCTS 访问分布 or beam Q 值
            # L4 性能优化：保留 ndarray（float32），不再 .tolist()
            # 原 tolist 把 numpy float32 转 Python float → 4B → 28B（7× 膨胀），
            # replay 256 traj × 100 step × ~150 float ≈ 750MB 纯反模式开销；
            # 下游 update 用 np.asarray(...) 零拷贝读取，pickle/spawn IPC 也更高效。
            "q_vals": np.asarray(q_vals, dtype=np.float32) if q_vals is not None else None,
            "visit_pi": np.asarray(_visit_pi, dtype=np.float32) if _visit_pi is not None else None,
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
        "spawn_stats": _spawn_stats_mod.get_spawn_stats(reset=True) if _spawn_stats_mod is not None else {},
        "spawn_difficulty": sim.spawn_difficulty_stats(),
        "teacher_stats": {
            "mcts_steps": int(len(mcts_sims_used_vals)),
            "mcts_sims_avg": float(np.mean(mcts_sims_used_vals)) if mcts_sims_used_vals else 0.0,
            "mcts_sims_max": int(max(mcts_sims_used_vals)) if mcts_sims_used_vals else 0,
            "teacher_eligible": int(_teacher_eligible),
            "teacher_skipped": int(_teacher_skipped),
        },
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
    target_kl: float = 0.0,
    ref_net: "AnyNet | None" = None,
    kl_ref_coef: float = 0.0,
    bc_replay_coef: float = 0.0,
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
    all_spawn_diff_after: list[np.ndarray] = []
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
            sd = step.get("spawn_difficulty_after")
            if sd is not None:
                all_spawn_diff_after.append(np.asarray(sd, dtype=np.float32))
            qv = step.get("q_vals")
            # L4 · 上游已存为 ndarray（dtype=float32），asarray 零拷贝直接复用
            all_q_vals.append(np.asarray(qv, dtype=np.float32) if qv is not None else None)
            vp = step.get("visit_pi")
            all_visit_pi.append(np.asarray(vp, dtype=np.float32) if vp is not None else None)
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
    # 用 Python 端计数（pg_weight 仅 0/1），避免 MPS 上 .sum() 偶发返回 inf/nan
    pg_weight_sum = max(1.0, float(sum(all_pg_weights)))

    hole_coef, hole_denom = _hole_aux_coef_and_denom()
    clear_pred_coef = _clear_pred_coef()
    outcome_mix = _outcome_value_mix()
    bq_coef = _board_quality_coef()
    feas_coef = _feasibility_coef()
    surv_coef = _survival_coef()
    topo_coef = _topology_aux_coef()
    bonus_clear_coef = _bonus_clear_aux_coef()
    spawn_diff_coef = _spawn_diff_aux_coef()
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

    use_spawn_diff_aux = (
        spawn_diff_coef > 1e-12
        and callable(getattr(net, "forward_spawn_diff_aux", None))
        and len(all_spawn_diff_after) == total_steps
    )
    spawn_diff_target_t: torch.Tensor | None = None
    if use_spawn_diff_aux:
        spawn_diff_target_t = tensor_to_device(
            torch.from_numpy(np.stack(all_spawn_diff_after).astype(np.float32)),
            device,
        ).clamp(0.0, 1.0)

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
    # 价值目标缩放（实验，默认 1.0=不变=零回归）：单独压缩 GAE/MC returns 分量的
    # 量纲，缓解长局 G_t 达数千导致 loss_value 过大、价值估计滞后。注意一致性：
    # 缩放后 V 与 sim.step() 原始奖励不同尺度，会影响 lookahead/beam 的 r+γV teacher
    # （MCTS 路径已用 MinMaxStats Q 归一化，对尺度免疫）。启用前建议灰度观察。
    _vrs = float(os.environ.get(
        "RL_VALUE_RETURN_SCALE",
        str(RL_REWARD_SHAPING.get("valueReturnScale", 1.0)),
    ))
    vals_np = values_init.detach().cpu().numpy()
    adv_np = np.empty(total_steps, dtype=np.float32)
    rets_np = np.empty(total_steps, dtype=np.float32)
    v_off = 0
    r_off = 0
    for ep_i, ep_len in enumerate(ep_lengths):
        v = vals_np[v_off : v_off + ep_len]
        r = np.array([all_rewards[r_off + j] * return_scale for j in range(ep_len)], dtype=np.float32)
        t_len = ep_len
        outcome_val = _outcome_value_target(ep_scores[ep_i])

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

        # 价值目标缩放（仅缩放 returns 分量，不动 advantage/策略梯度）
        if _vrs != 1.0:
            rets_np[v_off : v_off + ep_len] *= _vrs

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

    # KL-to-reference：参考策略（冻结的历史最优）的动作分布只需算一次（不随 epoch 变）
    # L11 优化：用 inference_mode 替代 no_grad
    # - inference_mode 关闭 view-tracking / version-counter，比 no_grad 省 ~15-20% 临时张量
    # - ref_net 在 train_loop 创建时已 requires_grad_(False)，不会有梯度
    # - 输出张量 .clone() 一次脱离 inference 模式，下游 PPO loss 才能正常 backward 引用
    ref_lp_2d: torch.Tensor | None = None
    if ref_net is not None and kl_ref_coef > 0.0:
        with torch.inference_mode():
            ref_lp_2d, _rv, _rmask, _rc = _forward_and_log_probs(
                ref_net, states_t, action_feats_t, n_actions_t,
                all_n_actions, total_steps, device,
            )
        # 跳出 inference_mode 后再 clone 一份普通 tensor 供 PPO 主图引用
        ref_lp_2d = ref_lp_2d.detach().clone()

    # 高分回放行为克隆：replay 步（pg_weight≈0）的掩码，BC 仅作用于这些"好例"步
    bc_mask = (pg_weight_t < 0.5) if bc_replay_coef > 0.0 else None
    bc_sum = float(bc_mask.float().sum().item()) if bc_mask is not None else 0.0

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

        # ─── MPS reduction 防御层 ───────────────────────────────────────────
        # 背景：MPS 设备 .sum()/.mean() 已知偶发返回 1e21 量级的"假大数"或 0（同文件 line 1810
        # pg_weight_sum 注释即对该 bug 做了 Python 兜底）。最近 906 局 92% 的 approx_kl
        # 落在 ≥1e10，导致 target_kl 早停被错误触发 93%；policy_loss/entropy 也被同样
        # 静默 0 化（看板 π=N/A H=N/A）。
        #
        # 策略：把最终 reduction 搬到 CPU（.to('cpu').sum()）—— .to() 是可微算子，梯度
        # 仍能流回 MPS 上的输入张量，反向传播不受影响；仅多一次 ~KB 级别的设备搬移，
        # 单步 <0.5ms，可忽略。元素级先 nan_to_num+clamp，再 reduce，双重保险。
        def _mps_safe_weighted_mean(values: torch.Tensor, weights: torch.Tensor,
                                    denom: float, elem_clip: float) -> torch.Tensor:
            """device 上元素 clamp+nan，搬 CPU 求和并除常数 denom，保留梯度。"""
            x = torch.nan_to_num(values * weights, nan=0.0, posinf=0.0, neginf=0.0)
            x = x.clamp(min=-elem_clip, max=elem_clip)
            return x.to("cpu", non_blocking=False).sum() / max(1.0, float(denom))

        approx_kl = 0.0
        if n_epochs > 1:
            # F0-1 根治 policy_loss 50% 批次极端值（[-6631, +2208] 重尾分布）
            # 真凶：log_ratio clamp [-10, 10] 后 ratio ∈ [4.5e-5, 22026]；
            # adv ∈ [-10, 10] → surr1 = ratio*adv ∈ [-220260, 220260]。
            # min(surr1, surr2) 在 adv<0 时 surr1 取负无穷主导，policy_loss = -mean → +1e5
            # 修复：
            #   (a) ratio 入口 clamp 到 [1/(1+5ε), 1+5ε]（约 [0.21, 1.75]，trust region 5× ppo_clip）
            #       这是 PPO 文献推荐做法（OpenAI Baselines/Spinning Up 都这样）
            #   (b) elem_clip 1e4→50，强制 policy loss 元素 |x|≤50（前提保险）
            log_ratio = (new_lp - old_lp_t).clamp(-10.0, 10.0)
            ratio = torch.exp(log_ratio)
            _ratio_cap = float(os.environ.get("RL_PPO_RATIO_CAP_MULT", "5.0")) * ppo_clip
            ratio_safe = ratio.clamp(min=max(1e-6, 1.0 - _ratio_cap), max=1.0 + _ratio_cap)
            surr1 = ratio_safe * adv_cat
            surr2 = torch.clamp(ratio, 1.0 - ppo_clip, 1.0 + ppo_clip) * adv_cat
            # policy_loss 在反向链上：CPU reduce 保留 grad，避免 MPS sum 静默置 0
            policy_loss = -_mps_safe_weighted_mean(
                torch.min(surr1, surr2), pg_weight_t, pg_weight_sum,
                elem_clip=float(os.environ.get("RL_POLICY_ELEM_CLIP", "50.0")),
            )
            # Schulman 近似 KL：E[(r-1) - log r] ≥ 0，比 -log r 方差更低、恒非负
            with torch.no_grad():
                # 元素级裁到数学上界（log_ratio 已 clamp[-10,10] → 元素 ≤ e^10-1+10≈22035），
                # 再到 CPU reduce：MPS .sum() 偶发返回 inf/1e21（line 1810 即此 bug 兜底），
                # 否则日志会出现 approx_kl=1e21 这种非物理值并 99% 触发 early_stop_kl。
                kl_t = torch.nan_to_num(
                    ((ratio - 1.0) - log_ratio) * pg_weight_t,
                    nan=0.0, posinf=0.0, neginf=0.0,
                ).clamp_(min=0.0, max=2.5e4)
                approx_kl = float(kl_t.detach().to("cpu").sum().item()) / max(1.0, pg_weight_sum)
                if not math.isfinite(approx_kl):
                    approx_kl = 1e3
        else:
            policy_loss = -_mps_safe_weighted_mean(
                new_lp * adv_cat, pg_weight_t, pg_weight_sum, elem_clip=1e4
            )

        v_clipped = values_old_for_clip + torch.clamp(
            values_flat - values_old_for_clip, -ppo_clip, ppo_clip
        )
        vl_unclipped = F.smooth_l1_loss(values_flat, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        vl_clipped = F.smooth_l1_loss(v_clipped, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        value_loss = torch.max(vl_unclipped, vl_clipped).mean()

        # entropy_mean：既参与反向（熵奖励），又落盘日志；同样走 CPU reduce 抗 MPS sum bug
        # ent_t 元素 ≤ ln(action_dim)，通常 ≤ 5；放宽 elem_clip=20 防极端
        entropy_mean = _mps_safe_weighted_mean(
            ent_t, pg_weight_t, pg_weight_sum, elem_clip=20.0
        )
        entropy_mean = torch.nan_to_num(entropy_mean, nan=0.0, posinf=0.0, neginf=0.0)

        # KL-to-reference：KL(π_ref‖π) 在有效动作上求和，拉当前策略回历史最优附近（防漂移）
        kl_ref_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if ref_lp_2d is not None:
            pi_ref = ref_lp_2d.exp() * mask.float()
            kl_per_step = (pi_ref * (ref_lp_2d - lp_2d).masked_fill(~mask, 0.0)).sum(dim=1)
            kl_ref_loss = torch.nan_to_num(kl_per_step.mean(), nan=0.0, posinf=0.0, neginf=0.0)

        # 高分回放行为克隆：最大化 replay（高分局）chosen 动作的 log π，"记住有效打法"
        bc_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if bc_mask is not None and bc_sum > 0.5:
            bc_loss = torch.nan_to_num(
                -(new_lp * bc_mask.float()).sum() / bc_sum, nan=0.0, posinf=0.0, neginf=0.0
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

        spawn_diff_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_spawn_diff_aux and spawn_diff_target_t is not None:
            pred_sd = net.forward_spawn_diff_aux(states_t)
            spawn_diff_loss = F.smooth_l1_loss(pred_sd, spawn_diff_target_t, reduction="mean", beta=1.0)

        bq_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        feas_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        surv_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if has_aux_heads and (bq_coef > 1e-12 or feas_coef > 1e-12 or surv_coef > 1e-12):
            aux = net.forward_aux_all(states_t)
            # F0-2 根治 bq/feas/surv head 数值发散（实测 jsonl 出现 loss_bq=936449, loss_feas=±7.8e5）
            # 这些 head 是 Linear→GELU→Linear 无任何 bound；trunk hidden 极端时输出可达 ±1e3-1e5。
            # SmoothL1(|pred-target|>1) 是线性，BCE_with_logits 在 |logits|=1e5 时 = 1e5。
            # _clip_aux(±20) 只 clamp 总 loss 不能消除 head 输出梯度抖动，必须在 head 输出阶段 clamp。
            _bq_pred_clip = float(os.environ.get("RL_BQ_PRED_CLIP", "10.0"))
            _surv_pred_clip = float(os.environ.get("RL_SURV_PRED_CLIP", "3.0"))
            _feas_logit_clip = float(os.environ.get("RL_FEAS_LOGIT_CLIP", "10.0"))
            if bq_coef > 1e-12:
                bq_pred = aux["board_quality"].clamp(min=-_bq_pred_clip, max=_bq_pred_clip)
                bq_loss = F.smooth_l1_loss(bq_pred, bq_target_t, reduction="mean", beta=1.0)
            if feas_coef > 1e-12:
                # BCE logits clamp 到 ±10：sigmoid(±10) ≈ 0/1 已足够，再大无信息且让 loss 线性发散
                feas_logits = aux["feasibility"].clamp(min=-_feas_logit_clip, max=_feas_logit_clip)
                feas_loss = F.binary_cross_entropy_with_logits(
                    feas_logits, feas_target_t, reduction="mean"
                )
            if surv_coef > 1e-12:
                # surv_target 已归一化到 [0, ~1]，pred clip ±3 远超合理范围
                surv_pred = aux["survival"].clamp(min=-_surv_pred_clip, max=_surv_pred_clip)
                surv_loss = F.smooth_l1_loss(surv_pred, surv_target_t, reduction="mean", beta=1.0)

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

        # P1-1 · 辅助损失单步幅值硬裁剪（防奖励 shaping 数值爆炸）
        # 真凶：6/21 日志 ep 140816 起 bonus_clear_loss=128→1026，topo=4.5→9.4 暴涨，
        # 触发"梯度炸碎-BestGuard 回滚-丢历史进度"的循环（已回滚 947 次）。
        # 异常源头是某些边界状态的 aux head 输出数量级失控，正常时 aux loss 均在 ±5；
        # 这里做 hard clamp（默认 ±20，env RL_AUX_LOSS_CLIP 可调），不影响正常梯度，
        # 仅掐爆值。policy_loss / value_loss 是主目标，不参与本 clip。
        _aux_clip_cap = float(os.environ.get("RL_AUX_LOSS_CLIP", "20.0"))

        def _clip_aux(t):
            if not torch.isfinite(t).item():
                return torch.zeros_like(t)
            if _aux_clip_cap <= 0.0:
                return t
            return torch.clamp(t, min=-_aux_clip_cap, max=_aux_clip_cap)

        policy_loss = _safe_aux(policy_loss)
        value_loss_safe = _safe_aux(value_loss)

        loss = (
            policy_loss
            + value_coef * value_loss_safe
            - entropy_coef * entropy_mean
            + hole_coef * _clip_aux(hole_aux_loss)
            + clear_pred_coef * _clip_aux(clear_pred_loss)
            + topo_coef * _clip_aux(topology_aux_loss)
            + bonus_clear_coef * _clip_aux(bonus_clear_loss)
            + spawn_diff_coef * _clip_aux(spawn_diff_loss)
            + bq_coef * _clip_aux(bq_loss)
            + feas_coef * _clip_aux(feas_loss)
            + surv_coef * _clip_aux(surv_loss)
            + q_distill_coef * _clip_aux(q_distill_loss)
            + visit_pi_coef * _clip_aux(visit_pi_loss)
            + kl_ref_coef * _clip_aux(kl_ref_loss)
            + bc_replay_coef * _clip_aux(bc_loss)
        )

        opt.zero_grad()
        stepped = False
        skip_reason = ""
        if torch.isfinite(loss).item():
            loss.backward()
            # 先把梯度里的 nan/inf 分量置零（保留健康分量），再裁剪：避免偶发数值毛刺
            # 导致整批更新被丢弃（此前 ~50% 批次因 non_finite_grad 跳过、学习效率减半）。
            grads_sanitized = _sanitize_grads(net)
            grad_norm = torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
            if not torch.isfinite(grad_norm).item() or not _module_tensors_finite(net, check_grads=True):
                # 消毒后仍非有限属极端异常，保持原有「丢弃该批」兜底
                skip_reason = "non_finite_grad"
                opt.zero_grad(set_to_none=True)
            else:
                if grads_sanitized:
                    skip_reason = "grad_sanitized"
                # L1 性能优化：每批不再 deepcopy opt.state_dict()（Adam state 2.5MB×5-10/s
                # = 17-34 MB/s MPS↔CPU 搅动，是 owned unmapped (graphics) 碎片的主因）。
                # `pre_sd` 也只在 RL_PARAM_PRESTEP_SNAPSHOT=1 时保留——观测 947 次回滚日志
                # 没有一次 non_finite_param_after_step 触发，意味着 99.9% 快照纯浪费。
                # 罕见触发时：仍能用 detect→opt 重建+best 权重恢复，比全 opt 副本更优。
                _need_prestep_snap = os.environ.get("RL_PARAM_PRESTEP_SNAPSHOT", "0").lower() in ("1", "true", "yes")
                pre_sd = {k: v.detach().clone() for k, v in net.state_dict().items()} if _need_prestep_snap else None
                opt.step()
                stepped = True
                if not _module_tensors_finite(net):
                    if pre_sd is not None:
                        net.load_state_dict(pre_sd)
                    else:
                        # 兜底：参数非有限 → 退到 best_guard 快照（外层 BestGuard 已持有）；
                        # 这里仅做 opt 重建避免动量带毒，主回滚由 BestGuard 触发。
                        try:
                            _bad_lr = float(opt.param_groups[0].get("lr", 3e-4)) if opt.param_groups else 3e-4
                        except (TypeError, ValueError, AttributeError):
                            _bad_lr = 3e-4
                        opt = adam_for_training(net.parameters(), lr=_bad_lr)
                    opt.zero_grad(set_to_none=True)
                    skip_reason = "non_finite_param_after_step"
                    stepped = False
                pre_sd = None  # 显式释放
        else:
            skip_reason = "non_finite_loss"
            opt.zero_grad(set_to_none=True)

        if stepped:
            opt.zero_grad(set_to_none=True)
        else:
            if not skip_reason:
                skip_reason = "optimizer_step_skipped"

        # 直接用 Python 端计数，避开 MPS .sum()/.item() 偶发 inf（曾导致
        # OverflowError: cannot convert float infinity to integer）
        pg_steps_num = int(round(float(sum(all_pg_weights))))
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
            "loss_spawn_diff_aux": _safe_metric(spawn_diff_loss),
            "loss_bq": _safe_metric(bq_loss),
            "loss_feas": _safe_metric(feas_loss),
            "loss_surv": _safe_metric(surv_loss),
            "loss_q_distill": _safe_metric(q_distill_loss),
            "loss_visit_pi": _safe_metric(visit_pi_loss),
            "loss_kl_ref": _safe_metric(kl_ref_loss),
            "loss_bc_replay": _safe_metric(bc_loss),
            "hole_aux_coef": float(hole_coef),
            "clear_pred_coef": float(clear_pred_coef),
            "topology_aux_coef": float(topo_coef),
            "bonus_clear_aux_coef": float(bonus_clear_coef),
            "spawn_diff_aux_coef": float(spawn_diff_coef),
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
            "approx_kl": float(approx_kl),
            "ppo_epochs_run": epoch_i + 1,
        }

        if not stepped and epoch_i > 0:
            break
        # 信任域早停：单批 KL 超阈值即停止剩余 epoch，防止小批多轮过拟合导致策略漂移。
        if target_kl > 0.0 and approx_kl > target_kl and not math.isnan(approx_kl):
            last_result["optimizer_skip_reason"] = (skip_reason + "|" if skip_reason else "") + "early_stop_kl"
            break

    return last_result


def _auto_n_workers(device: torch.device) -> int:
    """自动选择多进程 worker 数。

    所有设备类型都启用多进程采集（worker 用 CPU 推理，主进程用 GPU/MPS 更新），
    充分利用多核并行 rollout 来喂满 GPU。
    留 2 核给主进程（GPU 更新 + 系统），其余全部用于采集。
    """
    n_cpu = os.cpu_count() or 1
    if device.type == "cpu":
        return max(2, min(n_cpu - 2, 8))
    return max(2, min(n_cpu - 2, 10))


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
    target_kl: float = 0.0,
    eval_gate_every: int = 0,
    eval_gate_games: int = 50,
    eval_gate_win_ratio: float = 0.55,
    stop_event: "threading.Event | None" = None,
) -> int:
    import collections
    import multiprocessing as mp

    # P1-2 · lr_initial 用于 BestGuard 回滚 lr 衰减计算 floor
    # （否则 floor=lr×0.2 会用上一轮已衰减的 lr 二次衰减，最终跌穿成 0）
    _lr_initial = float(lr)
    opt = adam_for_training(net.parameters(), lr=lr)

    # --- 自适应目标熵：把策略熵稳定在目标带内，避免熵系数过高把策略推向随机 ---
    # 熵过高 → 落子随机 → 提前死局（观测到 step_count 48→31 同步退化）。
    # 反馈控制：实测熵高于目标带则下调熵系数（减探索压力），低于则上调，乘子有界。
    _ent_target = float(os.environ.get("RL_TARGET_ENTROPY", "0.0"))  # >0 启用自适应
    _ent_target_band = float(os.environ.get("RL_TARGET_ENTROPY_BAND", "0.2"))
    _ent_adapt: float = 1.0

    # --- 评估门控：基线权重 + 历史最优保留（v8）---
    _baseline_sd: dict | None = None
    _last_gate_ep: int = 0
    _best_ever_sd: dict | None = None   # 历史最优模型权重（从不降级）
    _best_ever_wr: float = 0.0          # 历史最优对应胜率
    if eval_gate_every > 0:
        _baseline_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
        _best_ever_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}

    # --- 轻量 best-checkpoint 守护（默认开启，防退化主力）---
    # 重型 eval_gate_check 因 self-play 评估会卡顿故看板模式默认关闭；这里改用「免费」的
    # 训练 rollout 滚动均分做守护：均分创新高即快照 best，显著回撤即回滚到 best 并重置
    # 优化器动量。直接对症「得分越来越低」——保证模型权重单调不退化。
    #
    # v2 升级（治根 8834 / 28 次误回滚问题）：判定改为基于 pooled standard error
    # 的 z-test（统计学显著性检验），并引入：
    #   1) 启动自检：检测 ckpt.guard_best_avg 是否被运气峰值污染，自动暴露并修复。
    #   2) 健康度跟踪：回滚速率限制 + 自动暂停，杜绝"自我实现的衰减循环"。
    #   3) Trimmed mean：双侧 5% 裁剪，抗右偏长尾分布对窗口均值的拉动。
    # 详见 rl_pytorch/best_guard.py 文档。
    from .best_guard import (
        BestGuardConfig,
        BestGuardStats,
        HealthState,
        assess_best_avg_pollution,
        decide_best_guard_action,
        update_health_state,
    )

    _guard_on = os.environ.get("RL_BEST_GUARD", "1").lower() not in ("0", "false", "no")
    _guard_every = int(os.environ.get("RL_BEST_GUARD_EVERY", "200"))
    _guard_window = int(os.environ.get("RL_BEST_GUARD_WINDOW", "200"))
    # v2 z-score 阈值（覆盖 v1 的 _guard_margin / _guard_regress / _guard_severe 固定比例）
    _bg_cfg = BestGuardConfig(
        window=max(1, _guard_window),
        check_every=max(1, int(os.environ.get("RL_BEST_GUARD_EVERY", "200"))),
        k_upgrade=float(os.environ.get("RL_BEST_GUARD_K_UPGRADE", "1.5")),
        k_regress=float(os.environ.get("RL_BEST_GUARD_K_REGRESS", "2.0")),
        k_severe=float(os.environ.get("RL_BEST_GUARD_K_SEVERE", "3.5")),
        confirm=max(1, int(os.environ.get("RL_BEST_GUARD_CONFIRM", "2"))),
        max_pollution_margin=float(os.environ.get("RL_BEST_GUARD_POLLUTION_MARGIN", "0.10")),
        rate_limit_window=max(1, int(os.environ.get("RL_BEST_GUARD_RATE_WINDOW", "1000"))),
        rate_limit_threshold=max(1, int(os.environ.get("RL_BEST_GUARD_RATE_LIMIT", "5"))),
        suspend_episodes=max(0, int(os.environ.get("RL_BEST_GUARD_SUSPEND_EP", "2000"))),
        use_trimmed_mean=os.environ.get("RL_BEST_GUARD_TRIM", "1").lower() not in ("0", "false", "no"),
        trim_ratio=float(os.environ.get("RL_BEST_GUARD_TRIM_RATIO", "0.05")),
    )
    _guard_scores: collections.deque = collections.deque(maxlen=max(1, _guard_window))
    # v2: best_stats 替代单值 best_avg（包含 mean/std/n 以支持显著性检验）；
    # 仍保留 _guard_best_avg 浮点字段以兼容现有持久化/日志 API。
    _guard_best_stats = BestGuardStats(avg=0.0, std=0.0, n=0, median=0.0)
    _guard_best_avg: float = 0.0
    _guard_best_sd: dict | None = None
    _guard_health = HealthState()
    # 观测历史：用于启动时检测 best_avg 污染；每次 decide 后追加 cur 窗口均值。
    _guard_observed_means: collections.deque = collections.deque(maxlen=500)
    # L2 死代码移除：历史上 _guard_best_opt_sd 保存 best 时刻的 opt.state_dict()，
    # 但回滚路径只调 `opt = adam_for_training(net.parameters(), lr=lr)` 重建优化器，
    # 从未真正 load_state_dict(_guard_best_opt_sd)；每次 best 创建/刷新 deepcopy
    # 完整 Adam state（2.5MB × 含 MPS tensor），是 MPS→CPU 隐式拷贝热点之一。
    _guard_last_ep: int = 0
    _guard_rollbacks: int = 0
    _guard_pending_regress: int = 0
    # 数值发散回归监控：记录上次告警 episode 与累计次数（限速，避免刷屏）。
    _loss_warn_last_ep: int = -(10 ** 9)
    _loss_warn_count: int = 0

    # --- KL-to-reference 锚定：以「历史最优快照」为冻结参考策略，软约束当前策略不远离 ---
    # 与硬回滚守护互补：守护是"事后兜底"，KL-ref 是"过程中持续拉回"，抑制策略缓慢漂移。
    # 参考网随 best 快照更新（只会换成更好的策略）。每批仅多一次参考前向，开销可忽略。
    _kl_ref_coef = float(os.environ.get("RL_KL_REF_COEF", "0.0"))  # >0 启用
    _ref_net: AnyNet | None = None
    if _kl_ref_coef > 0.0:
        _ref_net = build_policy_net(
            train_arch, getattr(net, "width", 128), policy_depth_arg, value_depth_arg,
            mlp_ratio, device, conv_channels=getattr(net, "conv_channels", 32),
        )
        _ref_net.load_state_dict(net.state_dict())
        _ref_net.eval()
        for _p in _ref_net.parameters():
            _p.requires_grad_(False)

    # --- 课程模式三选一（v11.2，详见 rl_pytorch/game_rules.py:rl_curriculum_mode）---
    #   linear   = 固定线性 ramp（v8 默认）
    #   adaptive = v11 闭环（compute_curriculum_action 调 virtual_ep 间接调 thr）
    #   quantile = v11.2 分位数自适应（compute_quantile_threshold 直接计算 thr）
    from .curriculum_feedback import compute_curriculum_action  # local import 避免循环
    from .curriculum_quantile import compute_quantile_threshold
    from .game_rules import rl_curriculum_mode, rl_quantile_config

    _curr_mode = rl_curriculum_mode() if rl_curriculum_enabled() else "linear"
    _adap_cfg = rl_adaptive_curriculum_config()
    _use_adaptive = _curr_mode == "adaptive" and _adap_cfg.get("enabled", False) and rl_curriculum_enabled()
    _use_quantile = _curr_mode == "quantile" and rl_curriculum_enabled()

    # v11 adaptive 状态（仅 _use_adaptive 时使用）
    _adap_window = int(_adap_cfg.get("window", 200))
    _adap_check_every = int(_adap_cfg.get("checkEvery", 50))
    _virtual_ep: float = 0.0
    _win_history: collections.deque = collections.deque(maxlen=_adap_window)
    _last_adap_check_ep: int = 0
    _last_adap_action: str = "warmup"
    _last_adap_wr: float = -1.0
    _adap_action_counts: dict[str, int] = {
        "accel": 0, "hold": 0, "pause": 0,
        "rollback": 0, "severe": 0, "warmup": 0,
    }

    # v11.2 quantile 状态（仅 _use_quantile 时使用）
    _quant_cfg = rl_quantile_config()
    _quant_window = int(_quant_cfg.get("windowEpisodes", 500))
    _quant_score_history: collections.deque = collections.deque(maxlen=_quant_window)
    _quant_ema: float = 0.0
    _quant_ema_inited: bool = False
    _quant_peak: float = 0.0  # 棘轮高水位：门槛历史峰值，防止门槛追随策略退化下跌
    _quant_ratchet_decay: float = float(_quant_cfg.get("ratchetDecay", 0.9))
    _quant_last_thr: int = int(_quant_cfg.get("bootstrapThreshold", 40))
    _quant_last_action: str = "bootstrap"
    _quant_last_target: float = -1.0

    # v11.2 方案 B：平滑奖励整形（opt-in，默认 off）
    from .reward_shaping_smooth import compute_smooth_terminal_reward
    from .game_rules import rl_smooth_win_bonus_config

    _smooth_cfg = rl_smooth_win_bonus_config()
    _use_smooth_wb = bool(_smooth_cfg.get("enabled", False))
    _smooth_window = int(_smooth_cfg.get("windowEpisodes", 500))
    _smooth_score_history: collections.deque = (
        collections.deque(maxlen=_smooth_window) if _use_smooth_wb else collections.deque(maxlen=1)
    )
    _smooth_last_target: float = 0.0
    _smooth_last_span: float = 0.0
    _smooth_last_action: str = "off"
    _smooth_last_reward: float = 0.0
    _wb_default = float((RL_REWARD_SHAPING or {}).get("winBonus") or 0.0)
    if _use_smooth_wb:
        # 通过 env 让 simulator（worker pool 子进程也能继承）跳过 sparse winBonus
        os.environ["RL_SMOOTH_WIN_BONUS"] = "1"
        print(
            f"  Smooth winBonus (方案 B): enabled  win_bonus={_wb_default}  "
            f"target=p{_smooth_cfg.get('targetPercentile')}  "
            f"span=[p{_smooth_cfg.get('spanLowPercentile')}, p{_smooth_cfg.get('spanHighPercentile')}]  "
            f"window={_smooth_window}  saturationClip={_smooth_cfg.get('saturationClip')}",
            file=sys.stderr,
        )

    # v11.2 方案 C：RND Curiosity（opt-in，默认 off + trigger 监测）
    from .game_rules import rl_rnd_curiosity_config
    from .intrinsic_rnd import (
        RNDConfig,
        RNDRewardNormalizer,
        compute_rnd_trigger,
    )

    _rnd_cfg = rl_rnd_curiosity_config()
    _use_rnd = bool(_rnd_cfg.get("enabled", False))
    _rnd_trigger_every = int(_rnd_cfg.get("triggerCheckEvery", 2000))
    _rnd_avg_score_history: list[float] = []
    _rnd_entropy_history: list[float] = []
    _last_rnd_trigger_ep = 0
    _last_rnd_trigger: dict = {}

    _rnd_target = None
    _rnd_predictor = None
    _rnd_opt = None
    _rnd_normalizer = RNDRewardNormalizer()
    _rnd_last_intrinsic_mean = 0.0
    _rnd_last_intrinsic_max = 0.0
    _rnd_last_predictor_loss = 0.0
    _rnd_last_grad_norm = 0.0
    _rnd_step_counter = 0
    _rnd_update_every_steps = int(_rnd_cfg.get("updateEverySteps", 1))

    if _use_rnd:
        _rnd_strict_cfg = RNDConfig(
            enabled=True,
            state_dim=int(_rnd_cfg.get("stateDim", 42)),
            hidden_dim=int(_rnd_cfg.get("hiddenDim", 64)),
            output_dim=int(_rnd_cfg.get("outputDim", 32)),
            beta=float(_rnd_cfg.get("beta", 0.1)),
            learning_rate=float(_rnd_cfg.get("learningRate", 1e-4)),
            update_every_steps=_rnd_update_every_steps,
            normalize_intrinsic=bool(_rnd_cfg.get("normalizeIntrinsic", True)),
            grad_clip=float(_rnd_cfg.get("gradClip", 5.0)),
        )
        from .intrinsic_rnd import build_rnd_networks
        _rnd_target, _rnd_predictor, _rnd_opt = build_rnd_networks(_rnd_strict_cfg, device=device)
        print(
            f"  RND Curiosity (方案 C): enabled  β={_rnd_strict_cfg.beta}  "
            f"hidden={_rnd_strict_cfg.hidden_dim}  out={_rnd_strict_cfg.output_dim}  "
            f"lr={_rnd_strict_cfg.learning_rate}  normalize={_rnd_strict_cfg.normalize_intrinsic}",
            file=sys.stderr,
        )
    else:
        print(
            f"  RND Curiosity (方案 C): disabled  (trigger check every {_rnd_trigger_every} ep, "
            f"minEpisode={_rnd_cfg.get('minEpisode')})",
            file=sys.stderr,
        )

    # ----- 训练日志 JSONL（与 rl_backend.py 同 schema，看板 rlTrainingCharts.js 可读）-----
    _training_log_env = os.environ.get("RL_TRAINING_LOG", "").strip()
    _training_log_path: Path | None = Path(_training_log_env) if _training_log_env else None
    if _training_log_path is not None:
        _training_log_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  Training JSONL: {_training_log_path}", file=sys.stderr)

    def _append_training_jsonl(entry: dict) -> None:
        if _training_log_path is None:
            return
        _append_training_jsonl_entry(entry)

    if _use_quantile:
        print(
            f"  Curriculum 模式: quantile  p={_quant_cfg.get('p')}  "
            f"window={_quant_window}  emaAlpha={_quant_cfg.get('emaAlpha')}  "
            f"bootstrap={_quant_cfg.get('bootstrapEpisodes')}ep@{_quant_cfg.get('bootstrapThreshold')}分  "
            f"(目标 win_rate≈{100 - float(_quant_cfg.get('p', 70)):.0f}%)",
            file=sys.stderr,
        )
    elif _use_adaptive:
        print(
            f"  Curriculum 模式: adaptive (v11)  window={_adap_window}  "
            f"checkEvery={_adap_check_every}  target_wr={_adap_cfg.get('targetWinRate')}",
            file=sys.stderr,
        )
    else:
        from .game_rules import _DATA as _GR_DATA  # type: ignore[attr-defined]
        if rl_curriculum_enabled():
            _lin_cfg = _GR_DATA.get("rlCurriculum", {})
            print(
                f"  Curriculum 模式: linear  start={_lin_cfg.get('winThresholdStart', 40)}"
                f"->end={_lin_cfg.get('winThresholdEnd', 600)} "
                f"over {_lin_cfg.get('rampEpisodes', 40000)} ep",
                file=sys.stderr,
            )
        else:
            print("  Curriculum: 已禁用（固定 winScoreThreshold）", file=sys.stderr)

    # --- Ranked Reward（single-player self-play）：把绝对分数转成滚动分位奖励 ---
    _rank_cfg = _ranked_reward_config()
    _use_ranked = bool(_rank_cfg.get("enabled", False))
    _rank_history: collections.deque = collections.deque(maxlen=int(_rank_cfg.get("window", 2048)))
    _ranked_last_avg = 0.0
    _ranked_last_pct = 0.5

    # --- 困难样本 replay：重放高分但未通关/低可行性尾局，减少搜索 teacher 样本浪费 ---
    _replay_cfg = _replay_config()
    _use_replay = bool(_replay_cfg.get("enabled", False))
    _high_score_replay = bool(_replay_cfg.get("highScoreReplay", True))
    # BC 系数随 ep_cursor 退火，实际取值见 _replay_bc_coef_at()（在 update 调用处计算）。
    _replay_buffer: collections.deque = collections.deque(maxlen=int(_replay_cfg.get("maxEpisodes", 256)))
    # P0-B · replay buffer 总步数硬上限（防 OOM）：
    # 每条 episode 携带数百步状态张量（state/action_feats/q_vals/visit_pi 等多个 ndarray），
    # 仅靠 maxEpisodes 数量限制无法保证内存有界——长 episode（>200 步）+ 256 槽容易吃几 GB，
    # 是 11.5h OOM 的次要推手。这里独立维护"按步数"的硬上限：当 sum(len(ep.trajectory)) 超阈值，
    # 按 FIFO（最旧）驱逐，与原 deque maxlen 双重保护。
    try:
        _replay_max_steps = int(os.environ.get("RL_REPLAY_MAX_STEPS",
                                               str(_replay_cfg.get("maxTotalSteps", 30000))))
    except (TypeError, ValueError):
        _replay_max_steps = 30000

    def _replay_total_steps() -> int:
        s = 0
        for ep in _replay_buffer:
            traj = ep.get("trajectory") or []
            s += len(traj)
        return s

    def _replay_trim_to_step_cap() -> None:
        """从队首（最旧）逐条剔除直到总步数 ≤ _replay_max_steps；deque 本身 O(1) popleft。"""
        if _replay_max_steps <= 0:
            return
        cap = _replay_max_steps
        cur = _replay_total_steps()
        while cur > cap and len(_replay_buffer) > 1:
            ep = _replay_buffer.popleft()
            cur -= len(ep.get("trajectory") or [])

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
            _ckpt_meta = ckpt.get("meta") or {}
            _saved_as = str(_ckpt_meta.get("saved_model") or "")
            # best_guard 落盘的是最优权重，但 optimizer 是当时「当前轨迹」的 Adam；
            # 直接 load 会导致动量与 best 权重错位。恢复路径在 _restore 里重建 Adam。
            if _saved_as != "best_guard" and "optimizer" in ckpt:
                opt.load_state_dict(ckpt["optimizer"])
            start_ep = int(ckpt.get("episodes", 0))
            _rt_patches, _rt_logs = _restore_training_runtime_state(
                ckpt,
                net=net,
                lr=lr,
                use_quantile=_use_quantile,
                guard_on=_guard_on,
                quant_window=_quant_window,
                guard_window=_guard_window,
                ref_net=_ref_net,
            )
            if "quant_score_history" in _rt_patches:
                _quant_score_history = _rt_patches["quant_score_history"]
                _quant_ema = _rt_patches["quant_ema"]
                _quant_ema_inited = _rt_patches["quant_ema_inited"]
                _quant_peak = _rt_patches["quant_peak"]
                _quant_last_thr = _rt_patches["quant_last_thr"]
                _quant_last_action = _rt_patches["quant_last_action"]
                _quant_last_target = _rt_patches["quant_last_target"]
            if "guard_best_avg" in _rt_patches:
                _guard_best_avg = _rt_patches["guard_best_avg"]
                _guard_rollbacks = _rt_patches["guard_rollbacks"]
                _guard_best_sd = _rt_patches["guard_best_sd"]
                if "guard_scores" in _rt_patches:
                    _guard_scores = _rt_patches["guard_scores"]
                # v2: 恢复 best 统计量、观测历史、健康度
                if "guard_best_stats" in _rt_patches:
                    _bs = _rt_patches["guard_best_stats"]
                    _guard_best_stats = BestGuardStats(
                        avg=_bs["avg"], std=_bs["std"], n=_bs["n"], median=_bs["median"],
                    )
                else:
                    _guard_best_stats = BestGuardStats(
                        avg=_guard_best_avg, std=0.0,
                        n=max(1, _guard_window), median=0.0,
                    )
                if "guard_observed_means" in _rt_patches:
                    _guard_observed_means = _rt_patches["guard_observed_means"]
                if "guard_health" in _rt_patches:
                    _hs = _rt_patches["guard_health"]
                    _guard_health = HealthState(
                        rollback_events=_hs["rollback_events"],
                        suspended_until_ep=_hs["suspended_until_ep"],
                        last_alert_ep=_hs["last_alert_ep"],
                        consecutive_severe=_hs["consecutive_severe"],
                    )
                if _rt_patches.get("rebuild_optimizer"):
                    opt = adam_for_training(net.parameters(), lr=lr)

                # v2 启动自检：检测 best_avg 是否被运气峰值污染（治根 8834 / 7209 问题）
                _pollution = assess_best_avg_pollution(
                    _guard_best_avg,
                    _guard_observed_means,
                    _bg_cfg,
                )
                if _pollution.polluted:
                    _auto_fix = os.environ.get(
                        "RL_BEST_GUARD_AUTO_FIX_POLLUTION", "1",
                    ).lower() not in ("0", "false", "no")
                    _fix_tag = " → 自动重置" if _auto_fix else " (设 RL_BEST_GUARD_AUTO_FIX_POLLUTION=1 启用自动修复)"
                    print(
                        f"[BestGuard:HEALTH:CRITICAL] checkpoint best_avg 污染检测：\n"
                        f"  {_pollution.reason}{_fix_tag}",
                        file=sys.stderr,
                    )
                    try:
                        _append_training_jsonl({
                            "event": "best_guard_pollution",
                            "ts": int(time.time()),
                            "episodes": int(start_ep),
                            "best_avg": _pollution.best_avg,
                            "observed_max": _pollution.observed_max,
                            "pollution_ratio": round(_pollution.pollution_ratio, 3),
                            "suggested_reset_to": _pollution.suggested_reset_to,
                            "reason": _pollution.reason,
                            "auto_fixed": bool(_auto_fix),
                        })
                    except Exception:
                        pass
                    if _auto_fix:
                        _guard_best_avg = _pollution.suggested_reset_to
                        _guard_best_stats = BestGuardStats(
                            avg=_pollution.suggested_reset_to,
                            std=max(_guard_best_stats.std, 1.0),
                            n=max(1, _guard_best_stats.n),
                            median=_pollution.suggested_reset_to,
                        )
                        # 重置 health 状态，避免延续之前的 rollback 风暴
                        _guard_health = HealthState()
                        _guard_pending_regress = 0
                        _guard_rollbacks = 0
                        print(
                            f"  ↳ best_avg 已重置为 {_guard_best_avg:.1f}；"
                            f"rollback 历史与健康度状态已清零。",
                            file=sys.stderr,
                        )
            print(f"已从 {resume} 恢复，继续自第 {start_ep} 局", file=sys.stderr)
            for _ln in _rt_logs:
                print(_ln, file=sys.stderr)
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
    try:
        _worker_threads = max(1, int(os.environ.get("RL_WORKER_THREADS", "1") or "1"))
    except ValueError:
        _worker_threads = 1

    _run_id = os.environ.get("RL_RUN_ID", "").strip() or uuid.uuid4().hex[:12]
    _training_stage = os.environ.get("RL_TRAINING_STAGE", "").strip().lower() or "single"
    _manifest = {
        "event": "run_manifest",
        "run_id": _run_id,
        "git_sha": _git_sha_short(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "device": device_summary_line(device),
        "training_stage": _training_stage,
        "stage_plan": os.environ.get("RL_STAGE_PLAN", ""),
        "quality_gates": _quality_gate_manifest(),
        "env": _safe_env_manifest(),
        "model": {
            "arch": train_arch,
            "width": int(getattr(net, "width", 0) or 0),
            "conv_channels": int(getattr(net, "conv_channels", 0) or 0),
            "policy_depth": int(policy_depth_arg),
            "value_depth": int(value_depth_arg),
            "mlp_ratio": float(mlp_ratio),
            "params": int(sum(p.numel() for p in net.parameters())),
        },
        "train": {
            "episodes_target": int(episodes),
            "start_ep": int(start_ep),
            "batch_episodes": int(batch_episodes),
            "ppo_epochs": int(ppo_epochs),
            "lr": float(lr),
            "gamma": float(gamma),
            "value_coef": float(value_coef),
            "target_kl": float(target_kl),
            "save_every": int(save_every),
            "log_every": int(log_every),
            "resume": str(resume or ""),
            "checkpoint": str(ckpt_path or ""),
        },
        "pipeline": {
            "n_workers": int(actual_workers),
            "worker_threads": int(_worker_threads),
            "weight_broadcast": os.environ.get("RL_WEIGHT_BROADCAST", "file"),
            "collect_scheduler": os.environ.get("RL_COLLECT_SCHEDULER", "dynamic-prefetch"),
            "numba_disabled": os.environ.get("RL_NO_NUMBA", "").lower() in ("1", "true", "yes", "on"),
        },
    }
    _append_training_jsonl(_manifest)
    if _manifest["pipeline"]["numba_disabled"]:
        _append_training_jsonl({
            "event": "run_warning",
            "run_id": _run_id,
            "code": "numba_disabled",
            "message": "RL_NO_NUMBA is enabled; fast_grid hot kernels will use numpy fallback.",
        })
    for _risk_key in ("RL_SPAWN_CHEAP", "RL_LOOKAHEAD"):
        _risk_val = os.environ.get(_risk_key)
        if (_risk_key == "RL_SPAWN_CHEAP" and str(_risk_val).lower() in ("1", "true", "yes", "on")) or (
            _risk_key == "RL_LOOKAHEAD" and str(_risk_val).lower() in ("0", "false", "no", "off")
        ):
            _append_training_jsonl({
                "event": "run_warning",
                "run_id": _run_id,
                "code": _risk_key.lower(),
                "message": f"{_risk_key}={_risk_val} may reduce teacher quality or change train/deploy distribution.",
            })
    if actual_workers > 1:
        # 让 spawn 出的 worker 在 import torch 时即以单线程加载底层 BLAS/OMP，
        # 配合 _pool_worker_init 里的 set_num_threads 双重保证不超额订阅 CPU。
        _wt_env = str(_worker_threads)
        for _thr_key in (
            "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS",
        ):
            os.environ.setdefault(_thr_key, _wt_env)
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
                # F1-1 · 主进程也注册 atexit unlink（覆盖 KeyboardInterrupt/SIGTERM 兜底）。
                # 上次 commit 只给 worker 注册了 atexit，主进程异常退出时 shm 段会变孤儿；
                # 这里双保险——主进程 atexit 也调 close_and_unlink。
                import atexit as _atexit_main
                def _shm_main_atexit():
                    try:
                        if _shared_ztable is not None:
                            _shared_ztable.close_and_unlink()
                    except Exception:
                        pass
                _atexit_main.register(_shm_main_atexit)
            except Exception as e:
                print(f"警告: 共享 Zobrist 表创建失败，退化为本地缓存: {e}", file=sys.stderr)

        # 采集前在父进程预热 numba 热核（编译+写盘缓存），避免 8 个 spawn worker 并发冷编译。
        try:
            from .fast_grid import warmup_numba_kernels
            if warmup_numba_kernels():
                print("numba 热核已预编译（fast_grid），worker 直接命中缓存", file=sys.stderr)
        except Exception as _e:
            print(f"numba 预热跳过: {_e}", file=sys.stderr)

        # P0-3 · 多进程上下文可切换：RL_MP_CONTEXT=forkserver 可让 worker 复用一个
        # 已 import torch 的 server 进程 fork 出来，省去每 worker 重新 import 的内存
        # 副本（spawn 模式下 8 worker × 完整 torch import ≈ 12-16GB）；保留 spawn 为默认
        # 以兼容历史行为。forkserver 在 macOS Python 3.9+ 受支持，注意 worker 用 CPU
        # 推理（line 163 `_pool_device = torch.device("cpu")`），不触碰 MPS fork-safety 问题。
        _mp_ctx_name = os.environ.get("RL_MP_CONTEXT", "spawn").strip() or "spawn"
        try:
            ctx = mp.get_context(_mp_ctx_name)
        except ValueError:
            ctx = mp.get_context("spawn")
            _mp_ctx_name = "spawn"
        pool = ctx.Pool(
            actual_workers,
            initializer=_pool_worker_init,
            initargs=(train_arch, w, policy_depth_arg, value_depth_arg, mlp_ratio, cc,
                      shm_name, shm_slots),
        )
        print(
            f"多进程采集: {actual_workers} workers × {_worker_threads} thread "
            f"(CPU inference → GPU update) + pipeline overlap [ctx={_mp_ctx_name}]",
            file=sys.stderr,
        )

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
    _pending_weight_path: str | None = None
    t_collect_ms = 0.0
    t_train_ms = 0.0

    _weight_version_holder = [0]
    # L5 · 固定 weight broadcast 路径（per-pid 防多训练实例冲突）
    _broadcast_weight_path = str(
        Path(tempfile.gettempdir()) / f"openblock_rl_weights_pid{os.getpid()}.pt"
    )

    def _cleanup_weight_file(path: str | None) -> None:
        """删除指定 weight 文件；L5 改造后所有版本共用同一路径，仅 finally 调用一次。"""
        if not path:
            return
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass

    def _aggregate_spawn_stats(batch_items: list[dict]) -> dict:
        total = {
            "requests": 0,
            "ok": 0,
            "failures": 0,
            "legacy_fallbacks": 0,
            "latency_ms_total": 0.0,
            "latency_ms_max": 0.0,
        }
        for ep in batch_items:
            st = ep.get("spawn_stats") or {}
            total["requests"] += int(st.get("requests", 0) or 0)
            total["ok"] += int(st.get("ok", 0) or 0)
            total["failures"] += int(st.get("failures", 0) or 0)
            total["legacy_fallbacks"] += int(st.get("legacy_fallbacks", 0) or 0)
            total["latency_ms_total"] += float(st.get("latency_ms_total", 0.0) or 0.0)
            total["latency_ms_max"] = max(total["latency_ms_max"], float(st.get("latency_ms_max", 0.0) or 0.0))
        total["latency_ms_avg"] = total["latency_ms_total"] / max(total["requests"], 1)
        total["failure_rate"] = total["failures"] / max(total["requests"], 1)
        return total

    def _aggregate_spawn_difficulty(batch_items: list[dict]) -> dict:
        count = 0
        scd_sum = 0.0
        scd_max = 0.0
        buckets: dict[str, int] = {}
        for ep in batch_items:
            sd = ep.get("spawn_difficulty") or {}
            c = int(sd.get("count", 0) or 0)
            if c <= 0:
                continue
            count += c
            scd_sum += float(sd.get("scd_avg", 0.0) or 0.0) * c
            scd_max = max(scd_max, float(sd.get("scd_max", 0.0) or 0.0))
            for k, v in (sd.get("bucket_counts") or {}).items():
                buckets[str(k)] = int(buckets.get(str(k), 0)) + int(v or 0)
        dist = {k: (v / max(count, 1)) for k, v in sorted(buckets.items())}
        return {
            "count": int(count),
            "scd_avg": scd_sum / max(count, 1),
            "scd_max": scd_max,
            "bucket_counts": buckets,
            "bucket_dist": dist,
        }

    def _aggregate_teacher_stats(batch_items: list[dict]) -> dict:
        steps = 0
        sims_sum = 0.0
        sims_max = 0
        eligible = 0
        skipped = 0
        for ep in batch_items:
            st = ep.get("teacher_stats") or {}
            eligible += int(st.get("teacher_eligible", 0) or 0)
            skipped += int(st.get("teacher_skipped", 0) or 0)
            n = int(st.get("mcts_steps", 0) or 0)
            if n <= 0:
                continue
            steps += n
            sims_sum += float(st.get("mcts_sims_avg", 0.0) or 0.0) * n
            sims_max = max(sims_max, int(st.get("mcts_sims_max", 0) or 0))
        return {
            "mcts_steps": int(steps),
            "mcts_sims_avg": sims_sum / max(steps, 1),
            "mcts_sims_max": int(sims_max),
            "teacher_eligible": int(eligible),
            "teacher_skipped": int(skipped),
            "teacher_skip_rate": (skipped / eligible) if eligible > 0 else 0.0,
        }

    def _make_pool_args(ep_start: int, count: int, win_thr: int | None = None):
        """构建 pool worker 的参数列表（每局一个任务，动态分发）。

        早期静态分发把 count 局按 i%actual_workers 预切成 actual_workers 个大块，
        每个 worker 领固定一块；局长差异大时严重负载不均（实测 99/33/19/3/0/0/0/0）。
        改为「每局一个任务 + chunksize=1」后，空闲 worker 动态领下一局，自然均衡。

        权重默认 torch.save 一次到临时文件（同批所有任务共享、版本号一致），worker 端按
        版本号缓存，仅首个任务真正反序列化，避免每个 task pickle 携带完整 state_dict bytes。
        RL_WEIGHT_BROADCAST=bytes 可退回旧 bytes 模式。

        每个 config 为 7-tuple：(global_ep, temp_floor, explore_first_moves,
            explore_temp_mult, dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
        """
        import io as _io
        configs = [
            (ep_start + i + 1, temp_floor, explore_first_moves, explore_temp_mult,
             dirichlet_epsilon, dirichlet_alpha, win_thr)
            for i in range(count)
        ]
        cpu_sd = {k: v.detach().cpu() for k, v in net.state_dict().items()}
        _buf = _io.BytesIO()
        torch.save(cpu_sd, _buf)
        wbytes = _buf.getvalue()
        _weight_version_holder[0] += 1
        version = _weight_version_holder[0]
        if os.environ.get("RL_WEIGHT_BROADCAST", "file").strip().lower() in ("bytes", "pickle"):
            return [(version, wbytes, [cfg]) for cfg in configs], None
        # L5 · weight broadcast 零臃肿：固定文件路径（per-pid）+ atomic rename。
        # 旧实现每批 mkstemp 一个新文件，长跑 / SIGKILL 会留 720+ 个 /tmp/openblock_rl_w*.pt
        # 残留（GB 量级），且 inode 不可整理。改为单文件 inplace 覆写：
        #   1) 写到 path.tmp（避免 worker 读半写）
        #   2) os.replace 原子重命名为目标路径（version 由文件内容自带，无需文件名编码）
        # worker 端通过 (version, path) 二元组识别版本变化触发 load_state_dict。
        _path = _broadcast_weight_path
        _tmp = _path + f".tmp.{version}"
        try:
            with open(_tmp, "wb") as f:
                f.write(wbytes)
            os.replace(_tmp, _path)
        except Exception:
            try:
                Path(_tmp).unlink(missing_ok=True)
            except OSError:
                pass
            raise
        return [(version, None, [cfg], _path) for cfg in configs], _path

    ep_cursor = start_ep
    _last_spawn_stats: dict = {}
    _last_spawn_difficulty: dict = {}
    _last_teacher_stats: dict = {}
    try:
        while ep_cursor < start_ep + episodes:
            if stop_event is not None and stop_event.is_set():
                print(f"[train_loop] 收到外部停止信号，ep={ep_cursor}", file=sys.stderr)
                break
            bs = min(batch_episodes, start_ep + episodes - ep_cursor)

            if warmup_batches > 0:
                effective_lr = _lr_warmup(batch_count, warmup_batches, lr)
                for pg in opt.param_groups:
                    pg["lr"] = effective_lr

            # --- 课程：计算当前有效胜利门槛（mode 互斥）---
            if _use_quantile:
                _q_dec = compute_quantile_threshold(
                    score_history=_quant_score_history,
                    ema_state=_quant_ema,
                    p=float(_quant_cfg.get("p", 70.0)),
                    ema_alpha=float(_quant_cfg.get("emaAlpha", 0.05)),
                    bootstrap_episodes=int(_quant_cfg.get("bootstrapEpisodes", 100)),
                    bootstrap_threshold=int(_quant_cfg.get("bootstrapThreshold", 40)),
                    floor=int(_quant_cfg.get("floor", 40)),
                    ceil=int(_quant_cfg.get("ceil", 9999)),
                    ema_initialized=_quant_ema_inited,
                    ratchet_peak=_quant_peak,
                    ratchet_decay=_quant_ratchet_decay,
                )
                _quant_ema = _q_dec.new_ema
                _quant_peak = _q_dec.new_peak
                if _q_dec.action in ("ema_init", "quantile"):
                    _quant_ema_inited = True
                _quant_last_thr = _q_dec.new_threshold
                _quant_last_action = _q_dec.action
                _quant_last_target = _q_dec.target_quantile
                cur_win_thr: int | None = _q_dec.new_threshold
            elif _use_adaptive:
                cur_win_thr = rl_win_threshold_from_virtual_ep(int(_virtual_ep))
            else:
                cur_win_thr = None  # None = collect_episode 内部按线性课程计算

            # --- 采集（含流水线重叠）---
            _append_training_jsonl({
                "event": "batch_collect_start",
                "batch_size": bs,
                "ep_cursor": ep_cursor,
                "episodes_from": ep_cursor + 1,
                "episodes_to": ep_cursor + bs,
            })
            tc0 = time.perf_counter()

            if pool is not None:
                if _pending_async is not None:
                    try:
                        results = _pending_async.get()
                    finally:
                        _cleanup_weight_file(_pending_weight_path)
                        _pending_weight_path = None
                    batch = [ep for worker_eps in results for ep in worker_eps]
                else:
                    args_list, weight_path = _make_pool_args(ep_cursor, bs, cur_win_thr)
                    # chunksize=1：每局一个任务，空闲 worker 动态领取，治负载不均
                    try:
                        results = pool.map(_pool_worker_collect, args_list, chunksize=1)
                    finally:
                        _cleanup_weight_file(weight_path)
                    batch = [ep for worker_eps in results for ep in worker_eps]

                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

                # 预发射下一批采集（与本轮 GPU 训练重叠）
                next_ep = ep_cursor + bs
                next_bs = min(batch_episodes, start_ep + episodes - next_ep)
                if next_bs > 0:
                    next_args, next_weight_path = _make_pool_args(next_ep, next_bs, cur_win_thr)
                    _pending_async = pool.map_async(_pool_worker_collect, next_args, chunksize=1)
                    _pending_weight_path = next_weight_path
                else:
                    _pending_async = None
                    _pending_weight_path = None
            else:
                batch = []
                for i in range(bs):
                    _ep_data = collect_episode(
                        net, device,
                        ep_cursor + i + 1, temp_floor,
                        explore_first_moves, explore_temp_mult,
                        dirichlet_epsilon, dirichlet_alpha,
                        win_threshold_override=cur_win_thr,
                    )
                    batch.append(_ep_data)
                    _emit_train_progress_heartbeat(ep_cursor + i + 1, _ep_data)
                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

            _last_spawn_stats = _aggregate_spawn_stats(batch)
            _last_spawn_difficulty = _aggregate_spawn_difficulty(batch)
            _last_teacher_stats = _aggregate_teacher_stats(batch)
            _append_training_jsonl({
                "event": "batch_collect_done",
                "run_id": _run_id,
                "batch_size": int(bs),
                "ep_cursor": int(ep_cursor),
                "collect_ms": float(t_collect_ms),
                "scheduler": os.environ.get("RL_COLLECT_SCHEDULER", "dynamic-prefetch"),
                "weight_broadcast": os.environ.get("RL_WEIGHT_BROADCAST", "file"),
                "spawn": dict(_last_spawn_stats),
                "spawn_difficulty": dict(_last_spawn_difficulty),
                "teacher": dict(_last_teacher_stats),
            })

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

            # v11.2 方案 B：终局奖励整形（注入到本批每局 traj 最后一步）
            # 注意顺序：先用"上一批分布"计算 smooth_reward 注入本批，再追加本批分数
            # 到 history（避免本批分数自我影响）。
            if _use_smooth_wb:
                for ep in batch:
                    _sdec = compute_smooth_terminal_reward(
                        final_score=float(ep["score"]),
                        score_history=_smooth_score_history,
                        enabled=True,
                        win_bonus=_wb_default,
                        target_percentile=float(_smooth_cfg.get("targetPercentile", 50.0)),
                        span_low_percentile=float(_smooth_cfg.get("spanLowPercentile", 25.0)),
                        span_high_percentile=float(_smooth_cfg.get("spanHighPercentile", 75.0)),
                        bootstrap_episodes=int(_smooth_cfg.get("bootstrapEpisodes", 200)),
                        bootstrap_target=float(_smooth_cfg.get("bootstrapTarget", 100.0)),
                        bootstrap_span=float(_smooth_cfg.get("bootstrapSpan", 60.0)),
                        span_floor=float(_smooth_cfg.get("spanFloor", 5.0)),
                        saturation_clip=float(_smooth_cfg.get("saturationClip", 1.5)),
                    )
                    _traj = ep.get("trajectory") or []
                    if _traj and abs(_sdec.reward) > 1e-12:
                        _traj[-1]["reward"] = float(_traj[-1].get("reward", 0.0)) + _sdec.reward
                    ep["smooth_reward"] = _sdec.reward
                    _smooth_last_target = _sdec.target
                    _smooth_last_span = _sdec.span
                    _smooth_last_action = _sdec.action
                    _smooth_last_reward = _sdec.reward

            # v11.2 方案 C：RND intrinsic reward 注入（仅 _use_rnd 时）
            if _use_rnd and _rnd_target is not None and _rnd_predictor is not None:
                import numpy as _rnd_np
                _rnd_all_states: list = []
                _rnd_step_indices: list[tuple[int, int]] = []  # (ep_idx, step_idx)
                for _ep_idx, _ep in enumerate(batch):
                    _traj = _ep.get("trajectory") or []
                    for _step_idx, _tr in enumerate(_traj):
                        # trajectory step 用 'state' 存 extract_state_features 的输出
                        # shape=(STATE_FEATURE_DIM,)；RND 直接复用该特征空间
                        _sf = _tr.get("state")
                        if _sf is None:
                            continue
                        if hasattr(_sf, "shape"):
                            if _sf.shape[-1] != _rnd_strict_cfg.state_dim:
                                continue
                        elif len(_sf) != _rnd_strict_cfg.state_dim:
                            continue
                        _rnd_all_states.append(_sf)
                        _rnd_step_indices.append((_ep_idx, _step_idx))
                if _rnd_all_states:
                    import torch as _t
                    from .intrinsic_rnd import compute_intrinsic_reward
                    _arr = _rnd_np.stack([_rnd_np.asarray(s, dtype=_rnd_np.float32) for s in _rnd_all_states])
                    _states_t = _t.from_numpy(_arr).to(device)
                    _rewards_t, _pred_loss = compute_intrinsic_reward(
                        _rnd_target, _rnd_predictor, _states_t,
                    )
                    _rewards_cpu = _rewards_t.cpu().numpy().tolist()
                    # 内在 reward 归一化 + 加权注入到 trajectory step
                    if _rnd_strict_cfg.normalize_intrinsic:
                        _rnd_normalizer.update_batch(_rewards_cpu)
                        _rewards_norm = _rnd_normalizer.normalize_many(_rewards_cpu)
                    else:
                        _rewards_norm = list(_rewards_cpu)
                    for _i, (_ep_idx, _step_idx) in enumerate(_rnd_step_indices):
                        _ri = _rnd_strict_cfg.beta * float(_rewards_norm[_i])
                        batch[_ep_idx]["trajectory"][_step_idx]["reward"] = (
                            float(batch[_ep_idx]["trajectory"][_step_idx].get("reward", 0.0)) + _ri
                        )
                    _rnd_last_intrinsic_mean = float(sum(_rewards_cpu) / max(1, len(_rewards_cpu)))
                    _rnd_last_intrinsic_max = float(max(_rewards_cpu))
                    _rnd_last_predictor_loss = float(_pred_loss.item())
                    # predictor 训练一步
                    _rnd_step_counter += 1
                    if _rnd_step_counter % max(1, _rnd_update_every_steps) == 0:
                        _rnd_opt.zero_grad()
                        _pred_loss.backward()
                        _gn = _t.nn.utils.clip_grad_norm_(
                            _rnd_predictor.parameters(), _rnd_strict_cfg.grad_clip,
                        )
                        _rnd_opt.step()
                        _rnd_last_grad_norm = float(_gn.item()) if hasattr(_gn, "item") else float(_gn)

            # ── 本批分数 / 胜负累计（必须在 reward 整形之后，使 history 用最终 reward 视角的 score）──
            for ep in batch:
                scores.append(ep["score"])
                if _guard_on:
                    _guard_scores.append(float(ep["score"]))
                won = ep["won"]
                if won:
                    wins += 1
                if _use_adaptive:
                    _win_history.append(1 if won else 0)
                if _use_quantile:
                    _quant_score_history.append(float(ep["score"]))
                if _use_smooth_wb:
                    _smooth_score_history.append(float(ep["score"]))

            # ── RND trigger 监测（即使 disabled 也定期评估并在触发时打 alert）──
            if (ep_cursor + bs) - _last_rnd_trigger_ep >= _rnd_trigger_every:
                _last_rnd_trigger_ep = ep_cursor + bs
                # 累计 trigger 评估所需的轻量历史（每 log 段一个点）
                if scores:
                    _rnd_avg_score_history.append(sum(scores[-min(len(scores), 100):]) / min(len(scores), 100))
                _trig = compute_rnd_trigger(
                    episode=ep_cursor + bs,
                    avg_score_history=_rnd_avg_score_history,
                    entropy_history=_rnd_entropy_history,
                    min_episode=int(_rnd_cfg.get("minEpisode", 50000)),
                    score_slope_window=int(_rnd_cfg.get("scoreSlopeWindow", 5000)),
                    score_slope_threshold=float(_rnd_cfg.get("scoreSlopeThreshold", 1e-3)),
                    entropy_collapse_threshold=float(_rnd_cfg.get("entropyCollapseThreshold", 0.2)),
                    expected_score_at_collapse=(
                        float(_rnd_cfg["expectedScoreAtCollapse"])
                        if _rnd_cfg.get("expectedScoreAtCollapse") is not None
                        else None
                    ),
                    score_collapse_ratio=float(_rnd_cfg.get("scoreCollapseRatio", 0.8)),
                )
                _last_rnd_trigger = {
                    "should_enable": _trig.should_enable,
                    "reason": _trig.reason,
                    "metric_value": _trig.metric_value,
                    "explanation": _trig.explanation,
                }
                if _trig.should_enable and not _use_rnd:
                    print(
                        f"  ⚠️  RND Trigger: {_trig.reason} | {_trig.explanation} | "
                        f"建议设 RL_RND=1 或 game_rules.json rndCuriosity.enabled=true",
                        file=sys.stderr,
                    )
            ep_cursor += bs

            # ── P2 · 周期性自请求退出，由后端 P0-C 自启逻辑限速 resume ─────────
            # 11.5h 长跑后 train_ms 从 5.4s 涨到 7.7s（+44%），存在不通过 empty_cache
            # 也清不掉的 Python 端泄漏（multiprocessing 留 leaked semaphore）。
            # 显式正常退出（exit code = 99 哨兵）让后端识别为"周期重启请求"，按限速 resume。
            try:
                _periodic_restart_every = int(os.environ.get("RL_AUTO_PERIODIC_RESTART_EVERY", "0"))
            except (TypeError, ValueError):
                _periodic_restart_every = 0
            if _periodic_restart_every > 0 and (ep_cursor - start_ep) > 0 and \
               (ep_cursor - start_ep) >= _periodic_restart_every:
                print(
                    f"  [P2] 已训练 {ep_cursor - start_ep} 局（≥ RL_AUTO_PERIODIC_RESTART_EVERY="
                    f"{_periodic_restart_every}），主动退出让后端 resume 释放内存碎片",
                    file=sys.stderr,
                )
                # 99 = 周期重启请求哨兵（区别于 -9 OOM 与 -2/-15 用户停止）
                # 退出前依赖 --save-every（看板默认 50 局）已保留近期 checkpoint，
                # 失去的最多是末段 <50 局；后端 P0-C 限速 resume 后从该 checkpoint 续训
                sys.exit(99)

            # ── P0-A · 周期性清理设备缓存防 OOM ─────────────────────────────
            # 真凶（vmmap 6/21 12:03 排查）：MPS allocator 持有的 owned unmapped (graphics)
            # 区域 = MTLBuffer 物理页面，启动 4 分钟即达 15.3GB（Total footprint 20GB）。
            # torch.mps.empty_cache() 只回到 PyTorch 内部池，并不还给 OS——必须配合
            # PYTORCH_MPS_HIGH/LOW_WATERMARK_RATIO（已在 torch_env.py 在 import torch 前设默认）。
            # 当前周期：empty_cache + synchronize + 显存监控日志。
            try:
                _empty_cache_every = int(os.environ.get("RL_EMPTY_CACHE_EVERY", "100"))
            except (TypeError, ValueError):
                _empty_cache_every = 100
            if _empty_cache_every > 0 and (ep_cursor // max(1, bs)) % _empty_cache_every == 0:
                try:
                    if device.type == "mps":
                        torch.mps.empty_cache()
                        if hasattr(torch.mps, "synchronize"):
                            torch.mps.synchronize()
                        # P0-A+ · 显存监控：把 driver/current 占用打到 jsonl，看板可观测
                        # 同时一旦 driver_allocated > 高水位 80% 触发额外 trim
                        try:
                            _drv_alloc = float(torch.mps.driver_allocated_memory()) / (1024 ** 3) if hasattr(torch.mps, "driver_allocated_memory") else 0.0
                            _cur_alloc = float(torch.mps.current_allocated_memory()) / (1024 ** 3) if hasattr(torch.mps, "current_allocated_memory") else 0.0
                            if last_update is not None:
                                last_update["mps_driver_gb"] = round(_drv_alloc, 2)
                                last_update["mps_current_gb"] = round(_cur_alloc, 2)
                        except Exception:
                            pass
                    elif device.type == "cuda":
                        torch.cuda.empty_cache()
                        torch.cuda.synchronize()
                except Exception:
                    pass

            # --- 自适应课程：每 checkEvery 局做一次四档闭环反馈（v11） ---
            if _use_adaptive and ep_cursor - _last_adap_check_ep >= _adap_check_every:
                _last_adap_check_ep = ep_cursor
                _decision = compute_curriculum_action(
                    win_history=_win_history,
                    virtual_ep=_virtual_ep,
                    target_win_rate=float(_adap_cfg.get("targetWinRate", 0.5)),
                    accel_band=float(_adap_cfg.get("accelBand", 0.1)),
                    hold_band=float(_adap_cfg.get("holdBand", 0.1)),
                    low_win_rate_band=float(_adap_cfg.get("lowWinRateBand", 0.2)),
                    severe_win_rate_band=float(_adap_cfg.get("severeWinRateBand", 0.4)),
                    step_up=float(_adap_cfg.get("stepUp", 2)),
                    step_down=float(_adap_cfg.get("stepDown", 1.0)),
                    check_every=int(_adap_check_every),
                    min_virtual_ep=float(_adap_cfg.get("minVirtualEp", 0)),
                    rollback_on_severe_drop=bool(_adap_cfg.get("rollbackOnSevereDrop", True)),
                    severe_rollback_factor=float(_adap_cfg.get("severeRollbackFactor", 0.5)),
                    min_samples_for_action=int(_adap_cfg.get("minSamplesForAction", 10)),
                )
                _virtual_ep = _decision.new_virtual_ep
                _last_adap_action = _decision.action
                _last_adap_wr = _decision.win_rate
                _adap_action_counts[_decision.action] = (
                    _adap_action_counts.get(_decision.action, 0) + 1
                )

            # --- GPU 批量更新（PPO 或 REINFORCE）---
            tt0 = time.perf_counter()
            ent_eff = _effective_entropy_coef(ep_cursor, entropy_coef) * _ent_adapt
            replay_sample: list[dict] = []
            if _use_replay and len(_replay_buffer) > 0:
                replay_n = min(
                    int(_replay_cfg.get("maxSamples", 8)),
                    max(1, int(round(len(batch) * float(_replay_cfg.get("sampleRatio", 0.5))))),
                    len(_replay_buffer),
                )
                _buf_list = list(_replay_buffer)
                if _high_score_replay:
                    # 按 score^power 加权无放回采样：高分局更可能被回放（行为锚）。
                    _score_power = float(_replay_cfg.get("scorePower", 1.5))
                    _w = [
                        max(1e-3, float(ep.get("score", 0.0))) ** _score_power
                        for ep in _buf_list
                    ]
                    _picked: list = []
                    _pool = list(range(len(_buf_list)))
                    for _ in range(min(replay_n, len(_pool))):
                        _ws = [_w[i] for i in _pool]
                        _idx = random.choices(_pool, weights=_ws, k=1)[0]
                        _picked.append(_buf_list[_idx])
                        _pool.remove(_idx)
                    replay_sample = copy.deepcopy(_picked)
                else:
                    replay_sample = copy.deepcopy(random.sample(_buf_list, replay_n))
                for ep in replay_sample:
                    ep["_replay_sample"] = True
                    ep["_replay_age"] = max(0, ep_cursor - int(ep.get("_replay_added_ep", ep_cursor)))
            update_batch = batch + replay_sample
            result = _reevaluate_and_update(
                net, opt, update_batch, device, gamma, gae_lambda,
                return_scale, value_coef, ent_eff, normalize_adv,
                adv_min_std, value_huber_beta, grad_clip,
                ppo_epochs=ppo_epochs, ppo_clip=ppo_clip, global_ep=ep_cursor,
                target_kl=target_kl,
                ref_net=_ref_net, kl_ref_coef=_kl_ref_coef,
                bc_replay_coef=(_replay_bc_coef_at(_replay_cfg, ep_cursor) if _high_score_replay else 0.0),
            )
            tt1 = time.perf_counter()
            t_train_ms = (tt1 - tt0) * 1000

            if result:
                result["replay_samples"] = len(replay_sample)
                last_update = result
                # 自适应熵反馈（一批滞后）：用实测熵把熵系数乘子推向目标带，乘子限幅防失稳
                if _ent_target > 0.0:
                    _ent_meas = float(result.get("entropy", 0.0))
                    if _ent_meas > _ent_target + _ent_target_band:
                        _ent_adapt *= 0.98
                    elif _ent_meas < _ent_target - _ent_target_band:
                        _ent_adapt *= 1.02
                    _ent_adapt = float(min(3.0, max(0.2, _ent_adapt)))
                    result["entropy_coef_adapt"] = _ent_adapt
            if _use_replay:
                min_pri = float(_replay_cfg.get("minPriority", 0.0))
                # 高分模式：按 score 保留高分局（"好例锚"）；否则按难例优先级保留（难例挖掘）
                _key = (lambda e: float(e.get("score", 0.0))) if _high_score_replay else _episode_replay_priority
                ranked_batch = sorted(batch, key=_key, reverse=True)
                if _high_score_replay:
                    keep_ratio = float(_replay_cfg.get("keepTopRatio", 0.5))
                    keep_default = max(1, int(math.ceil(len(batch) * keep_ratio)))
                else:
                    keep_default = max(1, len(batch) // 2)
                keep_n = min(len(ranked_batch), max(1, int(_replay_cfg.get("keepPerBatch", keep_default))))
                for ep in ranked_batch[:keep_n]:
                    if _high_score_replay:
                        pct = ep.get("ranked_percentile")
                        min_pct = float(_replay_cfg.get("minScorePercentile", 0.55))
                        ranked_ready = len(_rank_history) >= int(_rank_cfg.get("warmup", 0))
                        if ranked_ready and pct is not None and float(pct) < min_pct:
                            continue
                    elif _episode_replay_priority(ep) < min_pri:
                        continue
                    ep_copy = copy.deepcopy(ep)
                    ep_copy["_replay_added_ep"] = ep_cursor
                    _replay_buffer.append(ep_copy)
                # P0-B · 按总步数硬上限驱逐最旧条目（deque maxlen 之上的第二道防线）
                _replay_trim_to_step_cap()
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
                wins_since = int(wins)  # 保留给 jsonl 写入
                wins = 0
                last_log_ep = ep_cursor
                last_ep = batch[-1]
                if (_use_quantile or _use_adaptive) and cur_win_thr is not None:
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
                if last_update and _num_update("spawn_diff_aux_coef") > 1e-12:
                    hole_str += f"  sdiff={_fmt_update('loss_spawn_diff_aux')}"
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
                if _use_adaptive:
                    _wr_str = f"{_last_adap_wr * 100:.0f}%" if _last_adap_wr >= 0 else "—"
                    adap_tag = (
                        f"  [adap wr={_wr_str} vep={_virtual_ep:.0f}"
                        f" act={_last_adap_action}]"
                    )
                elif _use_quantile:
                    _q_target_str = (
                        f"{_quant_last_target:.0f}" if _quant_last_target >= 0 else "—"
                    )
                    adap_tag = (
                        f"  [quant p{int(_quant_cfg.get('p', 70))}"
                        f" tgt={_q_target_str} ema={_quant_ema:.1f}"
                        f" n={len(_quant_score_history)}"
                        f" act={_quant_last_action}]"
                    )
                else:
                    adap_tag = ""
                if _use_smooth_wb:
                    adap_tag += (
                        f"  [smooth tgt={_smooth_last_target:.0f}"
                        f" span={_smooth_last_span:.0f}"
                        f" r={_smooth_last_reward:+.1f}"
                        f" act={_smooth_last_action}]"
                    )
                if _use_rnd:
                    adap_tag += (
                        f"  [rnd ī={_rnd_last_intrinsic_mean:.3f}"
                        f" Lp={_rnd_last_predictor_loss:.3f}"
                        f" σ={_rnd_normalizer.std:.3f}]"
                    )
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

                # ----- 写 training.jsonl（看板字段，与 rl_backend.py 对齐 + 新增课程字段） -----
                if _training_log_path is not None:
                    _jsonl_row: dict = {
                        "event": "train_episode",
                        "run_id": _run_id,
                        "training_stage": _training_stage,
                        "episodes": ep_cursor,
                        "batch_size": int(bs),
                        "ppo_epochs": int(ppo_epochs),
                        "loss_policy": _num_update("policy_loss") if last_update else None,
                        "loss_value": _num_update("value_loss") if last_update else None,
                        "entropy": _num_update("entropy") if last_update else None,
                        "loss_q_distill": _num_update("loss_q_distill") if last_update else None,
                        "loss_visit_pi": _num_update("loss_visit_pi") if last_update else None,
                        "loss_kl_ref": _num_update("loss_kl_ref") if last_update else None,
                        "loss_bc_replay": _num_update("loss_bc_replay") if last_update else None,
                        "approx_kl": _num_update("approx_kl") if last_update else None,
                        "ppo_epochs_run": int(last_update.get("ppo_epochs_run", 0) or 0) if last_update else None,
                        "q_distill_coef": _num_update("q_distill_coef") if last_update else None,
                        "visit_pi_coef": _num_update("visit_pi_coef") if last_update else None,
                        "loss_hole_aux": _num_update("loss_hole_aux") if last_update else None,
                        "loss_clear_pred": _num_update("loss_clear_pred") if last_update else None,
                        "loss_topology_aux": _num_update("loss_topology_aux") if last_update else None,
                        "loss_spawn_diff_aux": _num_update("loss_spawn_diff_aux") if last_update else None,
                        "loss_bq": _num_update("loss_bq") if last_update else None,
                        "loss_feas": _num_update("loss_feas") if last_update else None,
                        "loss_surv": _num_update("loss_surv") if last_update else None,
                        "pg_steps": int(last_update.get("pg_steps", 0) or 0) if last_update else 0,
                        "replay_steps": int(last_update.get("replay_steps", 0) or 0) if last_update else 0,
                        "replay_samples": int(last_update.get("replay_samples", 0) or 0) if last_update else 0,
                        "teacher_q_coverage": _num_update("teacher_q_coverage") if last_update else None,
                        "teacher_q_std": _num_update("teacher_q_std") if last_update else None,
                        "teacher_q_margin": _num_update("teacher_q_margin") if last_update else None,
                        "teacher_q_entropy_norm": _num_update("teacher_q_entropy_norm") if last_update else None,
                        "teacher_visit_coverage": _num_update("teacher_visit_coverage") if last_update else None,
                        "teacher_visit_entropy_norm": _num_update("teacher_visit_entropy_norm") if last_update else None,
                        "teacher_mcts_steps": int(_last_teacher_stats.get("mcts_steps", 0) or 0),
                        "teacher_mcts_sims_avg": float(_last_teacher_stats.get("mcts_sims_avg", 0.0) or 0.0),
                        "teacher_mcts_sims_max": int(_last_teacher_stats.get("mcts_sims_max", 0) or 0),
                        "teacher_skip_rate": float(_last_teacher_stats.get("teacher_skip_rate", 0.0) or 0.0),
                        "teacher_skipped": int(_last_teacher_stats.get("teacher_skipped", 0) or 0),
                        "optimizer_step": bool(last_update.get("optimizer_stepped", True)) if last_update else True,
                        "optimizer_skip_reason": str(last_update.get("optimizer_skip_reason") or "") if last_update else "",
                        "score": float(last_ep["score"]),
                        "step_count": int(last_ep["steps"]),
                        "won": bool(last_ep["won"]),
                        "win_threshold": int(wt),
                        "win_count_recent": wins_since,
                        "eps_since_last_log": int(eps_since),
                        "win_rate": (wins_since / max(eps_since, 1)) if eps_since > 0 else 0.0,
                        "avg100": float(avg),
                        "collect_ms": float(t_collect_ms),
                        "train_ms": float(t_train_ms),
                        "gpu_util_est": float(gpu_pct),
                        "spawn_online_requests": int(_last_spawn_stats.get("requests", 0) or 0),
                        "spawn_online_failures": int(_last_spawn_stats.get("failures", 0) or 0),
                        "spawn_online_failure_rate": float(_last_spawn_stats.get("failure_rate", 0.0) or 0.0),
                        "spawn_online_latency_ms_avg": float(_last_spawn_stats.get("latency_ms_avg", 0.0) or 0.0),
                        "spawn_online_latency_ms_max": float(_last_spawn_stats.get("latency_ms_max", 0.0) or 0.0),
                        "spawn_legacy_fallbacks": int(_last_spawn_stats.get("legacy_fallbacks", 0) or 0),
                        "spawn_scd_count": int(_last_spawn_difficulty.get("count", 0) or 0),
                        "spawn_scd_avg": float(_last_spawn_difficulty.get("scd_avg", 0.0) or 0.0),
                        "spawn_scd_max": float(_last_spawn_difficulty.get("scd_max", 0.0) or 0.0),
                        "spawn_bucket_dist": dict(_last_spawn_difficulty.get("bucket_dist", {}) or {}),
                        "curriculum_mode": _curr_mode,
                    }
                    # best-checkpoint 守护状态（防退化）
                    if _guard_on and _guard_best_sd is not None:
                        _jsonl_row.update({
                            "guard_best_avg": round(_guard_best_avg, 1),
                            "guard_rollbacks": int(_guard_rollbacks),
                        })
                    # MPS 显存监控（在 last_update 由 P0-A empty_cache 分支挂载；
                    # 历史 bug：曾仅 last_update["mps_*"]=... 而未拷贝到 _jsonl_row，
                    # 导致 21 万行 jsonl 全无该字段，看板曲线永远为空）
                    if last_update is not None:
                        for _k in ("mps_driver_gb", "mps_current_gb"):
                            if _k in last_update:
                                _jsonl_row[_k] = last_update[_k]
                    # 课程模式特定字段
                    if _use_quantile:
                        _jsonl_row.update({
                            "quantile_thr": int(_quant_last_thr),
                            "quantile_target": float(_quant_last_target) if _quant_last_target >= 0 else None,
                            "quantile_ema": float(_quant_ema),
                            "quantile_action": str(_quant_last_action),
                            "quantile_n": int(len(_quant_score_history)),
                            "quantile_p": float(_quant_cfg.get("p", 70.0)),
                        })
                    if _use_adaptive:
                        _jsonl_row.update({
                            "adap_action": str(_last_adap_action),
                            "adap_wr": float(_last_adap_wr) if _last_adap_wr >= 0 else None,
                            "adap_virtual_ep": float(_virtual_ep),
                        })
                    if _use_smooth_wb:
                        _jsonl_row.update({
                            "smooth_wb_enabled": True,
                            "smooth_wb_target": float(_smooth_last_target),
                            "smooth_wb_span": float(_smooth_last_span),
                            "smooth_wb_reward_last": float(_smooth_last_reward),
                            "smooth_wb_action": str(_smooth_last_action),
                        })
                    if _use_rnd:
                        _jsonl_row.update({
                            "rnd_enabled": True,
                            "rnd_intrinsic_mean": float(_rnd_last_intrinsic_mean),
                            "rnd_intrinsic_max": float(_rnd_last_intrinsic_max),
                            "rnd_predictor_loss": float(_rnd_last_predictor_loss),
                            "rnd_grad_norm": float(_rnd_last_grad_norm),
                            "rnd_norm_std": float(_rnd_normalizer.std),
                            "rnd_norm_count": int(_rnd_normalizer.count),
                            "rnd_beta": float(_rnd_strict_cfg.beta),
                        })
                    if _last_rnd_trigger:
                        _jsonl_row["rnd_trigger"] = dict(_last_rnd_trigger)
                    _append_training_jsonl(_jsonl_row)

                    # ── 数值发散回归监控 ────────────────────────────────────
                    # 记录的是 clamp 进梯度前的「裸」损失值（_safe_metric 上限 1e6）。6/22 前
                    # aux head 无 bound 致 loss_feas/bq/policy 达 ±1e6，触发梯度炸碎→回滚循环。
                    # 修复（head 输出 clamp）后裸值应 <50；越界即落 run_warning（仅观测，按 ep 限速），
                    # 便于回归监控 head clamp 是否失效或出现新发散源。阈值/冷却可经 env 调。
                    try:
                        _lw_aux = float(os.environ.get("RL_LOSS_WARN_AUX", "50.0"))
                        _lw_policy = float(os.environ.get("RL_LOSS_WARN_POLICY", "50.0"))
                        _lw_value = float(os.environ.get("RL_LOSS_WARN_VALUE", "500.0"))
                        _lw_cooldown = int(os.environ.get("RL_LOSS_WARN_COOLDOWN", "400"))
                    except (TypeError, ValueError):
                        _lw_aux, _lw_policy, _lw_value, _lw_cooldown = 50.0, 50.0, 500.0, 400
                    if _lw_cooldown > 0 and ep_cursor - _loss_warn_last_ep >= _lw_cooldown:
                        _offenders: dict = {}
                        for _lk, _cap in (
                            ("loss_policy", _lw_policy), ("loss_value", _lw_value),
                            ("loss_feas", _lw_aux), ("loss_bq", _lw_aux), ("loss_surv", _lw_aux),
                            ("loss_hole_aux", _lw_aux), ("loss_clear_pred", _lw_aux),
                            ("loss_topology_aux", _lw_aux), ("loss_spawn_diff_aux", _lw_aux),
                        ):
                            _lv = _jsonl_row.get(_lk)
                            if isinstance(_lv, (int, float)) and abs(float(_lv)) > _cap:
                                _offenders[_lk] = round(float(_lv), 2)
                        if _offenders:
                            _loss_warn_last_ep = ep_cursor
                            _loss_warn_count += 1
                            _append_training_jsonl({
                                "event": "run_warning",
                                "run_id": _run_id,
                                "code": "loss_divergence",
                                "episodes": ep_cursor,
                                "offenders": _offenders,
                                "warn_count": _loss_warn_count,
                                "message": "原始损失越界，疑似 aux head/策略数值发散；"
                                           "检查 head 输出 clamp / lr / grad_clip。",
                            })
                            print(
                                f"  [LossWarn] ep={ep_cursor} 损失越界 {_offenders} "
                                f"(累计 {_loss_warn_count} 次)",
                                file=sys.stderr,
                            )

                # 累计 entropy 历史，供 RND trigger 监测使用
                _ent_v = _num_update("entropy") if last_update else None
                if isinstance(_ent_v, (int, float)) and math.isfinite(float(_ent_v)):
                    _rnd_entropy_history.append(float(_ent_v))

                t0 = time.perf_counter()

            # --- BestGuard v2：基于显著性检验的轻量 best-checkpoint 守护 ---
            # 详见 rl_pytorch/best_guard.py：纯函数 decide_best_guard_action()
            # 返回 action ∈ {init, upgrade, regress_pending, regress_severe,
            # regress_confirmed, hold, suspended}，本处仅做副作用执行。
            if (
                _guard_on
                and len(_guard_scores) >= _guard_window
                and ep_cursor - _guard_last_ep >= _guard_every
            ):
                _guard_last_ep = ep_cursor
                _bg_decision = decide_best_guard_action(
                    _bg_cfg,
                    _guard_best_stats,
                    list(_guard_scores),
                    pending_count=_guard_pending_regress,
                    health=_guard_health,
                    ep_cursor=ep_cursor,
                )
                _cur_stats = _bg_decision.cur_stats
                _cur_avg = _cur_stats.avg  # 兼容下游日志/事件
                _guard_observed_means.append(float(_cur_avg))
                _guard_pending_regress = _bg_decision.pending_count

                if _bg_decision.action in ("init", "upgrade"):
                    # 首次或显著提升 → 快照为新 best，并同步 KL-ref 参考网
                    _guard_best_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
                    _prev_avg = _guard_best_stats.avg
                    _guard_best_stats = _cur_stats
                    _guard_best_avg = _cur_avg
                    if _ref_net is not None:
                        _ref_net.load_state_dict(net.state_dict())
                    # P1-2 · 创新高时 lr 回弹到初始值，避免衰减期 lr 永久停在低位学不动
                    _lr_restored = False
                    if _bg_decision.action == "upgrade" and abs(float(lr) - _lr_initial) > 1e-12:
                        lr = _lr_initial
                        opt = adam_for_training(net.parameters(), lr=lr)
                        _lr_restored = True
                    if _bg_decision.action == "init":
                        print(
                            f"[BestGuard] ep={ep_cursor}  ◇ 初始化 best avg={_cur_avg:.1f}"
                            f" std={_cur_stats.std:.1f} n={_cur_stats.n}",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            f"[BestGuard] ep={ep_cursor}  ★ 新高 avg={_cur_avg:.1f} "
                            f"(prev={_prev_avg:.1f}, z=+{_bg_decision.z_score:.2f}σ) "
                            f"→ 已快照 best"
                            + (f" + lr↺{lr:.2e}" if _lr_restored else ""),
                            file=sys.stderr,
                        )
                elif _bg_decision.action == "regress_pending":
                    # 观察期：保留窗口继续累积，等待下一次检查确认是否为真实退化
                    print(
                        f"[BestGuard] ep={ep_cursor}  ⏳ 观察回撤 avg={_cur_avg:.1f} "
                        f"(z={_bg_decision.z_score:+.2f}σ) "
                        f"[{_guard_pending_regress}/{_bg_cfg.confirm}，未达确认/严重阈值]",
                        file=sys.stderr,
                    )
                elif _bg_decision.action in ("regress_severe", "regress_confirmed"):
                    # 确认/严重回撤 → 回滚到 best 并重置优化器动量
                    if _guard_best_sd is not None:
                        net.load_state_dict({k: v.to(device) for k, v in _guard_best_sd.items()})
                    _guard_rollbacks += 1
                    _is_severe = _bg_decision.action == "regress_severe"
                    # P1-2 · 连续回滚自动降学习率
                    try:
                        _lr_decay_after = int(os.environ.get("RL_GUARD_LR_DECAY_AFTER", "5"))
                        _lr_decay_factor = float(os.environ.get("RL_GUARD_LR_DECAY_FACTOR", "0.7"))
                        _lr_floor_ratio = float(os.environ.get("RL_GUARD_LR_FLOOR_RATIO", "0.2"))
                    except (TypeError, ValueError):
                        _lr_decay_after, _lr_decay_factor, _lr_floor_ratio = 5, 0.7, 0.2
                    _lr_decayed = False
                    if _lr_decay_after > 0 and _guard_rollbacks % _lr_decay_after == 0:
                        _lr_floor = max(1e-8, _lr_initial * _lr_floor_ratio)
                        _new_lr = max(_lr_floor, float(lr) * _lr_decay_factor)
                        if abs(_new_lr - float(lr)) > 1e-12:
                            lr = _new_lr
                            _lr_decayed = True
                    opt = adam_for_training(net.parameters(), lr=lr)
                    _guard_scores.clear()
                    print(
                        f"[BestGuard] ep={ep_cursor}  ✗ 回撤 avg={_cur_avg:.1f} "
                        f"(z={_bg_decision.z_score:.2f}σ, thr={_bg_decision.regress_threshold:.1f}, "
                        f"sev_thr={_bg_decision.severe_threshold:.1f})"
                        f"  → 已回滚到 best(avg={_guard_best_stats.avg:.1f}) 并重置优化器"
                        + (f" + lr→{lr:.2e}" if _lr_decayed else "")
                        + (" [严重]" if _is_severe else " [确认]")
                        + f"  [第{_guard_rollbacks}次]",
                        file=sys.stderr,
                    )

                # 健康度跟踪：根据决策更新 HealthState，必要时发出 health alert
                _guard_health, _bg_alert = update_health_state(
                    _guard_health, _bg_decision, ep_cursor, _bg_cfg,
                )
                if _bg_alert:
                    print(_bg_alert, file=sys.stderr)
                # 把 health/decision 写入 jsonl 训练日志，供看板/事后审计
                try:
                    _append_training_jsonl({
                        "event": "best_guard",
                        "ts": int(time.time()),
                        "episodes": ep_cursor,
                        "action": _bg_decision.action,
                        "cur_avg": round(_cur_avg, 2),
                        "cur_std": round(_cur_stats.std, 2),
                        "cur_n": _cur_stats.n,
                        "best_avg": round(_guard_best_stats.avg, 2),
                        "best_std": round(_guard_best_stats.std, 2),
                        "best_n": _guard_best_stats.n,
                        "pooled_se": round(_bg_decision.pooled_se, 2),
                        "z_score": round(_bg_decision.z_score, 3),
                        "upgrade_thr": round(_bg_decision.upgrade_threshold, 2),
                        "regress_thr": round(_bg_decision.regress_threshold, 2),
                        "severe_thr": round(_bg_decision.severe_threshold, 2),
                        "rollbacks_total": _guard_rollbacks,
                        "rollbacks_recent": _guard_health.rollbacks_in_window(
                            ep_cursor, _bg_cfg.rate_limit_window,
                        ),
                        "suspended_until": _guard_health.suspended_until_ep,
                        "consec_severe": _guard_health.consecutive_severe,
                        "lr": float(lr),
                        "note": _bg_decision.note,
                    })
                except Exception:
                    pass

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
                model_sd = _guard_best_sd if _guard_best_sd is not None else net.state_dict()
                # best_guard 落盘时不再保存「当前轨迹」Adam（resume 会重建以匹配 best 权重）；
                # current 落盘仍保存 optimizer 供无缝续训。
                opt_sd = (
                    None
                    if _guard_best_sd is not None
                    else opt.state_dict()
                )
                _training_state = _pack_training_state(
                    use_quantile=_use_quantile,
                    quant_score_history=_quant_score_history,
                    quant_ema=_quant_ema,
                    quant_ema_inited=_quant_ema_inited,
                    quant_peak=_quant_peak,
                    quant_last_thr=_quant_last_thr,
                    quant_last_action=_quant_last_action,
                    quant_last_target=_quant_last_target,
                    guard_on=_guard_on,
                    guard_best_sd=_guard_best_sd,
                    guard_best_avg=_guard_best_avg,
                    guard_rollbacks=_guard_rollbacks,
                    guard_scores=_guard_scores,
                    guard_best_stats=_guard_best_stats,
                    guard_observed_means=_guard_observed_means,
                    guard_health=_guard_health,
                )
                _save_payload: dict = {
                    "model": model_sd,
                    "episodes": ep_cursor,
                    "training_state": _training_state,
                    "meta": _checkpoint_meta(
                        net, device, gamma, lr, train_arch,
                        mlp_ratio, policy_depth_arg, value_depth_arg,
                    ) | ({
                        "guard_best_avg": float(_guard_best_avg),
                        "guard_rollbacks": int(_guard_rollbacks),
                        "saved_model": "best_guard",
                    } if _guard_best_sd is not None else {"saved_model": "current"}),
                }
                if opt_sd is not None:
                    _save_payload["optimizer"] = opt_sd
                torch.save(_save_payload, ckpt_path)
    finally:
        _cleanup_weight_file(_pending_weight_path)
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
    import signal

    def _sigterm_handler(signum, frame):
        raise KeyboardInterrupt("SIGTERM received")

    signal.signal(signal.SIGTERM, _sigterm_handler)

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
        default=float(os.environ.get("RL_PPO_CLIP", "0.2")),
        help="PPO clipped surrogate ε；仅 ppo-epochs>1 时生效（env RL_PPO_CLIP 覆盖默认）",
    )
    p.add_argument(
        "--target-kl",
        type=float,
        default=float(os.environ.get("RL_TARGET_KL", "0.03")),
        help="信任域早停阈值：单批近似 KL 超此值即停止剩余 PPO epoch（0=关闭）。防小批多轮过拟合漂移",
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
    p.add_argument(
        "--training-stage",
        type=str,
        default=os.environ.get("RL_TRAINING_STAGE", "single"),
        choices=("single", "performance", "balanced", "quality"),
        help="分阶段训练标记，仅记录到 run_manifest；推荐 performance→balanced→quality。",
    )
    p.add_argument(
        "--stage-plan",
        type=str,
        default=os.environ.get("RL_STAGE_PLAN", ""),
        help="分阶段训练计划说明/ID，仅记录到 run_manifest，便于固定评估集对比。",
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
    os.environ["RL_TRAINING_STAGE"] = str(args.training_stage)
    if args.stage_plan:
        os.environ["RL_STAGE_PLAN"] = str(args.stage_plan)

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
        target_kl=args.target_kl,
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
    final_meta["target_kl"] = args.target_kl
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
