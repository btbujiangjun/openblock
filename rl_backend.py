"""
Flask 路由：对接 rl_pytorch 策略网络，供浏览器自博弈「热启动 + 持续学习」。

环境变量（可选）:
  RL_CHECKPOINT       显式指定要加载的 .pt；若文件不存在则回退自动加载逻辑
  RL_CHECKPOINT_SAVE  定期保存与「自动热加载」的默认路径，默认 rl_checkpoints/bb_policy.pt
  RL_AUTOLOAD         默认 1：未显式指定 RL_CHECKPOINT 时，若 RL_CHECKPOINT_SAVE 存在则加载（续训）
  RL_TRAINING_LOG     训练 JSONL 日志路径，默认 rl_checkpoints/training.jsonl
  RL_DEVICE           auto | cpu | mps | cuda | cuda:N（多卡见 RL_CUDA_DEVICE_IDS、RL_CUDA_DP_TRUNK；Flask 推理单卡）
  RL_LR               Adam 学习率，默认 3e-4
  RL_GAMMA            折扣因子，默认 0.99
  RL_VALUE_COEF       价值损失权重，默认 1.0
  RL_VALUE_HUBER_BETA smooth_l1 的 beta，默认 1.0
  RL_ENTROPY_COEF     策略熵 bonus 系数（越大越敢探索），默认 0.025；设 0 关闭
  RL_ENTROPY_COEF_MIN 熵系数线性衰减下限（配合 RL_ENTROPY_DECAY_EPISODES），默认 0.008
  RL_ENTROPY_DECAY_EPISODES  从 RL_ENTROPY_COEF 线性降到 MIN 的局数，默认 60000；设 0 关闭衰减
  RL_RETURN_SCALE     蒙特卡洛回报缩放（仅训练用），默认 1.0
  RL_RETURNS_CLIP     单局 train_episode 路径上，对折扣回报 G 的逐元素裁剪上界（±），默认 512；与游戏单步奖励量级匹配，抑制 Lv 因长局累加而爆炸
  RL_LOG_LOSS_CLIP      写入 training.jsonl 的 loss_policy/loss_value 绝对值上限，默认 1e6；防止异常步污染看板纵轴
  RL_HOLE_AUX_COEF    覆盖 game_rules 中 holeAuxLossCoef；留空则用 JSON（0 关闭空洞辅助 loss）
  RL_ADV_NORM         设为 1 时对每局 advantage 做零均值单位方差（REINFORCE 更稳），默认 1
  RL_ADV_MIN_STD      低于该标准差时不做去均值标准化（避免短局/平坦 V 时整段 A≈0 无策略梯度），默认 1e-4
  RL_GRAD_CLIP        梯度裁剪范数，默认 1.0
  RL_SAVE_EVERY       每训练 N 局落盘 checkpoint，默认 500（减少磁盘 I/O 利于提速）
  RL_MPS_SYNC         设为 1 时训练步后对 MPS 同步（多线程下更稳，**默认关闭**以利 M4/MPS 吞吐）
  RL_CPU_DISABLE_MKLDNN  默认 1：CPU 上关闭 oneDNN 卷积后端，避免部分环境 Conv2d 报 could not create a primitive；设为 0 可恢复加速
  PYTORCH_ENABLE_MPS_FALLBACK  未实现算子回退 CPU（见 PyTorch 文档）
  PYTORCH_MPS_HIGH_WATERMARK_RATIO  可选 0.0~1.0，调节 MPS 显存水位（须在进程早期设置，见 README）
"""

from __future__ import annotations

import json
import math
import os
import sys
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import numpy as np

_rl_lock = threading.Lock()
_log_lock = threading.Lock()
_state: dict = {
    "error": None,
    "device": None,
    "model": None,
    "optimizer": None,
    "episodes": 0,
    "checkpoint_loaded": None,
    "save_path": None,
    "meta": {},
    "replay_buffer": [],
}

DEFAULT_CKPT_NAME = "rl_checkpoints/bb_policy.pt"
DEFAULT_TRAINING_LOG = "rl_checkpoints/training.jsonl"


def _training_log_path() -> Path:
    return Path(os.environ.get("RL_TRAINING_LOG", DEFAULT_TRAINING_LOG))


def _read_jsonl_tail_lines(path: Path, max_lines: int, chunk_bytes: int = 768 * 1024) -> list[str]:
    """只读文件末尾若干字节，避免 training.jsonl 过大导致全量读取超时或内存暴涨。"""
    if not path.is_file():
        return []
    try:
        size = path.stat().st_size
    except OSError:
        return []
    if size <= 0:
        return []
    try:
        with open(path, "rb") as f:
            if size <= chunk_bytes:
                raw = f.read()
            else:
                f.seek(max(0, size - chunk_bytes))
                f.readline()
                raw = f.read()
        text = raw.decode("utf-8", errors="replace")
        lines = [ln for ln in text.split("\n") if ln.strip()]
        return lines[-max_lines:]
    except OSError:
        return []


def _loss_scalar_for_log(v) -> float | None:
    """供 training.jsonl / API 返回：有限值 + 幅值上限，避免看板曲线被单点撑爆。"""
    if v is None:
        return None
    if hasattr(v, "detach"):
        try:
            v = float(v.detach().item())
        except (TypeError, ValueError, RuntimeError):
            return None
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(fv):
        return None
    cap = float(os.environ.get("RL_LOG_LOSS_CLIP", "1e6"))
    if abs(fv) > cap:
        return float(max(-cap, min(cap, fv)))
    return fv


def _append_training_log(entry: dict) -> None:
    """追加一行 JSON（带时间戳），供续训与可视化。单独锁，避免与模型锁嵌套死锁。"""
    path = _training_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {"ts": int(time.time()), **entry}
    with _log_lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _stable_logits(logits):
    """抑制 MPS 上偶发 NaN/Inf，避免 Categorical 报错。"""
    return torch.nan_to_num(logits, nan=0.0, posinf=30.0, neginf=-30.0).clamp(-30.0, 30.0)


def _normalize_advantages(adv: "torch.Tensor", min_std: float = 1e-4) -> "torch.Tensor":
    """按轨迹做 advantage 标准化，降低 REINFORCE 方差。

    若 std 过小仍做「去均值」，整段 A 会变成全 0（常出现在 V≈G 的短局），策略梯度消失，
    日志表现为 loss_policy≈0、loss_value≈0。
    """
    adv = torch.nan_to_num(adv, nan=0.0, posinf=0.0, neginf=0.0)
    adv = torch.clamp(adv, -500.0, 500.0)
    if adv.numel() < 2:
        return torch.clamp(adv, -30.0, 30.0)
    std = adv.std(unbiased=False)
    if float(std) < min_std:
        return torch.clamp(adv, -30.0, 30.0)
    out = (adv - adv.mean()) / (std + 1e-8)
    return torch.clamp(out, -30.0, 30.0)


def _effective_entropy_coef(global_episode: int) -> float:
    """随全局局数线性降低熵奖励；衰减周期与课程爬坡对齐。"""
    base = float(os.environ.get("RL_ENTROPY_COEF", "0.025"))
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.008"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "60000"))
    if span <= 0 or base <= lo:
        return base
    t = min(1.0, max(0, global_episode) / span)
    return base - (base - lo) * t


def _clamp_log_probs_pg(log_probs: torch.Tensor) -> torch.Tensor:
    """再算一遍 forward 时，曾采样动作的 log π 可能为 -∞，与 advantage 相乘会得到 NaN。"""
    x = torch.nan_to_num(log_probs, nan=0.0, posinf=0.0, neginf=-50.0)
    return x.clamp(min=-50.0, max=0.0)


def _resolve_checkpoint_paths(save_path: Path):
    """
    返回 (save_path, load_path_or_none)。
    自动热加载：RL_AUTOLOAD 为真且未强制无效路径时，若 save 文件存在则加载。
    """
    explicit = os.environ.get("RL_CHECKPOINT", "").strip()
    autoload = os.environ.get("RL_AUTOLOAD", "1").lower() not in ("0", "false", "no", "")

    load_path: Path | None = None
    if explicit:
        p = Path(explicit)
        if p.is_file():
            load_path = p
        elif autoload and save_path.is_file():
            load_path = save_path
    elif autoload and save_path.is_file():
        load_path = save_path

    return save_path, load_path

try:
    import torch
    import torch.nn.functional as F
    from torch.distributions import Categorical

    # 关闭 NNPACK（不支持的 CPU 上 Conv2d 会崩）
    _nnpack = getattr(torch.backends, "nnpack", None)
    if _nnpack is not None and hasattr(_nnpack, "enabled"):
        _nnpack.enabled = False
    elif _nnpack is not None and hasattr(_nnpack, "set_flags"):
        try:
            _nnpack.set_flags(_enabled=False)
        except TypeError:
            pass

    # 关闭 oneDNN/MKLDNN（部分虚拟机/旧 CPU 上 Conv2d 报 could not create a primitive）
    _mkldnn = getattr(torch.backends, "mkldnn", None)
    if _mkldnn is not None and hasattr(_mkldnn, "enabled"):
        _mkldnn.enabled = False

    from rl_pytorch.device import (
        adam_for_training,
        apply_cpu_training_tuning,
        apply_throughput_tuning,
        maybe_mps_synchronize,
        resolve_training_device,
        tensor_to_device,
    )
    from rl_pytorch.features import STATE_FEATURE_DIM, ACTION_FEATURE_DIM
    from rl_pytorch.game_rules import FEATURE_ENCODING, RL_REWARD_SHAPING, rl_win_threshold_for_episode
    from rl_pytorch.model import ConvSharedPolicyValueNet, LightPolicyValueNet, LightSharedPolicyValueNet, PolicyValueNet, SharedPolicyValueNet
    from rl_pytorch.train import _reevaluate_and_update as _batch_ppo_update_fn
except ImportError as e:
    torch = None
    resolve_training_device = None  # type: ignore
    apply_cpu_training_tuning = None  # type: ignore
    tensor_to_device = None  # type: ignore
    maybe_mps_synchronize = None  # type: ignore
    rl_win_threshold_for_episode = None  # type: ignore
    _batch_ppo_update_fn = None  # type: ignore
    _state["error"] = f"import failed: {e}"


def _clear_pred_coef() -> float:
    if torch is None:
        return 0.0
    if (raw := os.environ.get("RL_CLEAR_PRED_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("clearPredLossCoef") or 0.15)


def _hole_aux_coef_and_denom() -> tuple[float, float]:
    if torch is None:
        return 0.0, 16.0
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


def _default_meta():
    """无 checkpoint 时新建网络的默认结构（与 python -m rl_pytorch.train 新默认对齐）。"""
    return {
        "width": int(os.environ.get("RL_WIDTH", "128")),
        "policy_depth": int(os.environ.get("RL_POLICY_DEPTH", "4")),
        "value_depth": int(os.environ.get("RL_VALUE_DEPTH", "4")),
        "mlp_ratio": float(os.environ.get("RL_MLP_RATIO", "2.0")),
        "arch": os.environ.get("RL_ARCH", "conv-shared"),
    }


def _build_model(meta: dict):
    d = _default_meta()
    arch = str(meta.get("arch", d["arch"]))
    width = int(meta.get("width", d["width"]))
    if arch == "conv-shared":
        cc = int(meta.get("conv_channels", 32))
        aed = int(meta.get("action_embed_dim", 48))
        return ConvSharedPolicyValueNet(width=width, conv_channels=cc, action_embed_dim=aed)
    if arch == "light-shared":
        aed = int(meta.get("action_embed_dim", 32))
        return LightSharedPolicyValueNet(width=width, action_embed_dim=aed)
    if arch == "light":
        return LightPolicyValueNet(width=width)
    mlp_ratio = float(meta.get("mlp_ratio", d["mlp_ratio"]))
    if arch == "shared":
        sd = int(meta.get("shared_depth", meta.get("policy_depth", d["policy_depth"])))
        return SharedPolicyValueNet(width=width, shared_depth=sd, mlp_ratio=mlp_ratio)
    return PolicyValueNet(
        width=width,
        policy_depth=int(meta.get("policy_depth", d["policy_depth"])),
        value_depth=int(meta.get("value_depth", d["value_depth"])),
        mlp_ratio=mlp_ratio,
    )


def _load_checkpoint_into_model(path: Path, device: torch.device) -> dict:
    try:
        ckpt = torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        ckpt = torch.load(path, map_location=device)
    meta = ckpt.get("meta") or {}
    merge_keys = ("width", "policy_depth", "value_depth", "mlp_ratio", "arch", "shared_depth")
    arch = {**_default_meta(), **{k: meta[k] for k in merge_keys if k in meta}}
    model = _build_model(arch)
    try:
        model.load_state_dict(ckpt["model"])
    except RuntimeError as e:
        import logging
        logging.warning(
            "Checkpoint %s 与当前模型架构不兼容，将忽略旧权重从头训练: %s", path, e
        )
        arch = _default_meta()
        model = _build_model(arch)
        model.to(device)
        model.train()
        return {
            "model": model,
            "episodes": 0,
            "meta": arch,
            "optimizer_state": None,
            "compat_warning": str(e),
        }
    model.to(device)
    model.train()
    episodes = int(ckpt.get("episodes", 0))
    opt_state = ckpt.get("optimizer")
    return {
        "model": model,
        "episodes": episodes,
        "meta": {**arch, **meta},
        "optimizer_state": opt_state,
    }


def _ensure_initialized():
    if torch is None:
        raise RuntimeError(_state.get("error") or "PyTorch 不可用")
    with _rl_lock:
        if _state["model"] is not None:
            return
        device = resolve_training_device(os.environ.get("RL_DEVICE", "auto"))
        apply_throughput_tuning(device)
        if apply_cpu_training_tuning is not None:
            apply_cpu_training_tuning(device)
        _state["device"] = device
        save_path = Path(os.environ.get("RL_CHECKPOINT_SAVE", DEFAULT_CKPT_NAME))
        _state["save_path"] = save_path
        _, load_path = _resolve_checkpoint_paths(save_path)

        lr = float(os.environ.get("RL_LR", "3e-4"))
        loaded = None
        if load_path is not None:
            try:
                loaded = _load_checkpoint_into_model(load_path, device)
            except Exception as exc:
                import logging
                logging.warning("Checkpoint 加载失败，回退到新模型: %s", exc)

        if loaded is not None:
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
            if loaded.get("compat_warning"):
                _state["checkpoint_loaded"] = None
            else:
                _state["checkpoint_loaded"] = str(load_path.resolve())
            _state["optimizer"] = adam_for_training(_state["model"].parameters(), lr=lr)
            osh = loaded.get("optimizer_state")
            if osh:
                try:
                    _state["optimizer"].load_state_dict(osh)
                except Exception:
                    pass
        else:
            meta = _default_meta()
            model = _build_model(meta)
            model.to(device)
            model.train()
            _state["model"] = model
            _state["episodes"] = 0
            _state["meta"] = meta
            _state["checkpoint_loaded"] = None
            _state["optimizer"] = adam_for_training(_state["model"].parameters(), lr=lr)

    _append_training_log(
        {
            "event": "server_init",
            "device": str(_state["device"]),
            "episodes": _state["episodes"],
            "checkpoint_loaded": _state["checkpoint_loaded"],
            "save_path": str(_state["save_path"]),
            "training_log": str(_training_log_path()),
            "save_every": int(os.environ.get("RL_SAVE_EVERY", "500")),
            "autoload": os.environ.get("RL_AUTOLOAD", "1"),
        }
    )


def _save_checkpoint(reason: str = "periodic"):
    if torch is None or _state["model"] is None:
        return
    sd = _state["model"].state_dict()
    if any(torch.isnan(v).any() for v in sd.values()):
        import logging
        logging.warning("跳过保存：模型权重包含 NaN（episodes=%d）", _state["episodes"])
        return
    path = _state["save_path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    device = _state["device"]
    payload = {
        "model": sd,
        "optimizer": _state["optimizer"].state_dict(),
        "episodes": _state["episodes"],
        "meta": {
            **_state["meta"],
            "device": str(device),
        },
    }
    torch.save(payload, path)
    _append_training_log(
        {
            "event": "checkpoint_saved",
            "reason": reason,
            "episodes": _state["episodes"],
            "path": str(path.resolve()),
        }
    )


def _online_batch_size() -> int:
    return max(1, int(os.environ.get("RL_BATCH_SIZE", "32")))


def _convert_episode_for_ppo(data: dict, steps: list, model, device) -> dict:
    """将 Flask POST 数据转换为 train.py _reevaluate_and_update 所需的 episode 格式。

    关键步骤：对每步做无梯度前向推理获取 old_log_prob（PPO ratio 需要）。
    """
    trajectory = []
    with torch.no_grad():
        for st in steps:
            phi_arr = st["phi"]
            state_arr = st["state"]
            idx = int(st["idx"])

            phi_t = tensor_to_device(
                torch.tensor(phi_arr, dtype=torch.float32), device
            )
            logits = _stable_logits(model.forward_policy_logits(phi_t))
            log_probs = torch.log_softmax(logits, dim=0)
            old_lp = float(log_probs[idx].item())

            phi_np = np.array(phi_arr, dtype=np.float32)
            state_np = np.array(state_arr, dtype=np.float32)
            action_feats = phi_np[:, STATE_FEATURE_DIM:]

            trajectory.append({
                "state": state_np,
                "action_feats": action_feats,
                "n_actions": phi_np.shape[0],
                "chosen_idx": idx,
                "reward": float(st["reward"]),
                "old_log_prob": old_lp,
                "holes_after": int(st.get("holes_after", 0)),
                "clears": int(st.get("clears", 0)),
                "board_quality": float(st.get("board_quality", 0.0)),
                "feasibility": float(st.get("feasibility", 1.0)),
                "steps_to_end": int(st.get("steps_to_end", 0)),
            })

    score = float(data.get("score", 0))
    won = bool(data.get("won", False))
    ep_num = _state["episodes"] + len(_state.get("replay_buffer", [])) + 1
    win_thr = (rl_win_threshold_for_episode(ep_num)
               if rl_win_threshold_for_episode is not None else 220)

    return {
        "trajectory": trajectory,
        "score": score,
        "steps": len(trajectory),
        "clears": sum(int(st.get("clears", 0)) for st in steps),
        "won": won,
        "win_threshold": win_thr,
    }


def _flush_replay_buffer() -> dict | None:
    """对 replay buffer 中所有累积 episode 执行一次批量 PPO 更新。"""
    buf = _state.get("replay_buffer", [])
    if not buf or _batch_ppo_update_fn is None:
        return None

    model = _state["model"]
    device = _state["device"]
    opt = _state["optimizer"]
    gamma = float(os.environ.get("RL_GAMMA", "0.99"))
    gae_lambda = float(os.environ.get("RL_GAE_LAMBDA", "0.85"))
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "1.0"))
    value_coef = float(os.environ.get("RL_VALUE_COEF", "1.0"))
    value_huber_beta = float(os.environ.get("RL_VALUE_HUBER_BETA", "1.0"))
    normalize_adv = os.environ.get("RL_ADV_NORM", "1").lower() not in ("0", "false", "no", "")
    adv_min_std = float(os.environ.get("RL_ADV_MIN_STD", "1e-4"))
    grad_clip = float(os.environ.get("RL_GRAD_CLIP", "1.0"))
    ppo_epochs = max(1, int(os.environ.get("RL_PPO_EPOCHS_ONLINE", "3")))
    ppo_clip = float(os.environ.get("RL_PPO_CLIP", "0.2"))
    ep_next = _state["episodes"] + len(buf)
    entropy_coef = _effective_entropy_coef(ep_next)

    result = _batch_ppo_update_fn(
        model, opt, buf, device, gamma, gae_lambda,
        return_scale, value_coef, entropy_coef, normalize_adv,
        adv_min_std, value_huber_beta, grad_clip,
        ppo_epochs=ppo_epochs, ppo_clip=ppo_clip,
    )

    if device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes"):
        maybe_mps_synchronize(device)

    _state["episodes"] += len(buf)
    ep = _state["episodes"]

    save_every = max(1, int(os.environ.get("RL_SAVE_EVERY", "500")))
    if ep % save_every < len(buf):
        _save_checkpoint("periodic")

    scores = [e.get("score", 0) for e in buf]
    wins = sum(1 for e in buf if e.get("won"))
    r = result or {}
    def _lf(v):
        return _loss_scalar_for_log(v)
    avg_score = sum(scores) / len(scores) if scores else 0
    win_rate = wins / len(buf) if buf else 0
    step_lens = [max(0, int(e.get("steps", 0) or 0)) for e in buf]
    avg_steps = sum(step_lens) / len(step_lens) if step_lens else None
    _append_training_log({
        "event": "train_episode",
        "episodes": ep,
        "batch_size": len(buf),
        "ppo_epochs": ppo_epochs,
        "loss_policy": _lf(r.get("policy_loss")),
        "loss_value": _lf(r.get("value_loss")),
        "entropy": _lf(r.get("entropy")),
        "loss_hole_aux": _lf(r.get("loss_hole_aux")),
        "loss_clear_pred": _lf(r.get("loss_clear_pred")),
        "loss_bq": _lf(r.get("loss_bq")),
        "loss_feas": _lf(r.get("loss_feas")),
        "loss_surv": _lf(r.get("loss_surv")),
        "score": avg_score,
        "won": win_rate > 0.5,
        "win_count": wins,
        "win_rate": round(win_rate, 4),
        "step_count": round(float(avg_steps), 2) if avg_steps is not None else None,
        "optimizer_step": bool(r.get("optimizer_stepped", False)),
    })
    _state["replay_buffer"] = []
    return result


def _rl_train_episode_inner(
    data: dict,
    steps: list,
    gamma: float,
    value_coef: float,
    value_huber_beta: float,
    return_scale: float,
    adv_norm: bool,
    adv_min_std: float,
    grad_clip: float,
):
    """在已校验 steps 形状后执行训练（供 train_episode 捕获异常并返回 JSON）。"""
    with _rl_lock:
        model = _state["model"]
        device = _state["device"]
        opt = _state["optimizer"]

        rewards = [float(s["reward"]) for s in steps]
        tlen = len(rewards)
        if tlen == 0:
            return jsonify({"ok": True, "episodes": _state["episodes"], "skipped": True})

        returns = [0.0] * tlen
        acc = 0.0
        for i in range(tlen - 1, -1, -1):
            acc = rewards[i] + gamma * acc
            returns[i] = acc
        returns_t = torch.tensor(returns, dtype=torch.float32, device=device)
        returns_t = torch.nan_to_num(returns_t, nan=0.0, posinf=1e5, neginf=-1e5)
        returns_t = torch.clamp(returns_t, -1e5, 1e5)
        if return_scale != 1.0:
            returns_t = returns_t * return_scale
        # 与批量 PPO 路径一致：限制 MC 回报量级，避免 V 与 G 尺度脱节导致 Lv 天文数字（长局累加）
        _rc = float(os.environ.get("RL_RETURNS_CLIP", "512"))
        if _rc > 0:
            returns_t = torch.clamp(returns_t, -_rc, _rc)

        log_probs_list = []
        values_list = []
        entropies_list = []
        for i, st in enumerate(steps):
            phi_t = tensor_to_device(torch.tensor(st["phi"], dtype=torch.float32), device)
            s_t = tensor_to_device(
                torch.tensor(st["state"], dtype=torch.float32).unsqueeze(0), device
            )
            idx = int(st["idx"])
            logits = _stable_logits(model.forward_policy_logits(phi_t))
            log_probs = torch.log_softmax(logits, dim=0)
            log_p = log_probs[idx]
            p = log_probs.exp()
            ent = -(p * log_probs).sum()
            v = model.forward_value(s_t).squeeze(0)
            log_probs_list.append(log_p)
            values_list.append(v)
            entropies_list.append(ent)

        log_probs_t = torch.stack(log_probs_list, dim=0)
        values = torch.stack(values_list, dim=0)
        entropies_t = torch.stack(entropies_list, dim=0)
        values = torch.nan_to_num(values, nan=0.0, posinf=1e5, neginf=-1e5)
        values = torch.clamp(values, -1e5, 1e5)
        log_probs_t = _clamp_log_probs_pg(log_probs_t)

        adv = returns_t - values.detach()
        if adv_norm:
            adv = _normalize_advantages(adv, min_std=adv_min_std)
        else:
            adv = torch.nan_to_num(adv, nan=0.0, posinf=1e3, neginf=-1e3)
            adv = torch.clamp(adv, -100.0, 100.0)
        policy_loss = -(log_probs_t * adv).mean()
        value_loss = F.smooth_l1_loss(
            values, returns_t, reduction="mean", beta=max(value_huber_beta, 1e-6)
        )
        entropy_mean = torch.nan_to_num(entropies_t.mean(), nan=0.0, posinf=0.0, neginf=0.0)
        ep_next = _state["episodes"] + 1
        entropy_coef_eff = _effective_entropy_coef(ep_next)
        hole_coef, hole_denom = _hole_aux_coef_and_denom()
        cp_coef = _clear_pred_coef()
        hole_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        clear_pred_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        state_mat = None
        chosen_a = None
        if (hole_coef > 1e-12 or cp_coef > 1e-12) and all("holes_after" in st for st in steps):
            state_rows = [st["state"] for st in steps]
            act_rows = [st["phi"][int(st["idx"])][STATE_FEATURE_DIM:] for st in steps]
            state_mat = tensor_to_device(torch.tensor(state_rows, dtype=torch.float32), device)
            chosen_a = tensor_to_device(torch.tensor(act_rows, dtype=torch.float32), device)
        if (
            hole_coef > 1e-12
            and callable(getattr(model, "forward_hole_aux", None))
            and state_mat is not None
        ):
            targ_list = [float(st["holes_after"]) / hole_denom for st in steps]
            targ_t = tensor_to_device(torch.tensor(targ_list, dtype=torch.float32), device).clamp(
                0.0, 1.0
            )
            pred = model.forward_hole_aux(state_mat, chosen_a)
            hole_aux_loss = F.smooth_l1_loss(pred, targ_t, reduction="mean", beta=1.0)
        if (
            cp_coef > 1e-12
            and callable(getattr(model, "forward_clear_pred", None))
            and state_mat is not None
            and all("clears" in st for st in steps)
        ):
            clears_tgt = tensor_to_device(
                torch.tensor([min(int(st.get("clears", 0)), 3) for st in steps], dtype=torch.long), device
            )
            clear_logits = model.forward_clear_pred(state_mat, chosen_a)
            clear_pred_loss = F.cross_entropy(clear_logits, clears_tgt, reduction="mean")

        bq_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        feas_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        surv_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        has_aux = callable(getattr(model, "forward_aux_all", None))
        if has_aux and state_mat is not None:
            aux = model.forward_aux_all(state_mat)
            bq_c = float(RL_REWARD_SHAPING.get("boardQualityLossCoef") or 0.5)
            feas_c = float(RL_REWARD_SHAPING.get("feasibilityLossCoef") or 0.3)
            surv_c = float(RL_REWARD_SHAPING.get("survivalLossCoef") or 0.2)
            if bq_c > 1e-12 and all("board_quality" in st for st in steps):
                bq_tgt = tensor_to_device(
                    torch.tensor([float(st["board_quality"]) for st in steps], dtype=torch.float32), device
                )
                bq_loss = bq_c * F.smooth_l1_loss(aux["board_quality"], bq_tgt, beta=1.0)
            if feas_c > 1e-12 and all("feasibility" in st for st in steps):
                feas_tgt = tensor_to_device(
                    torch.tensor([float(st["feasibility"]) for st in steps], dtype=torch.float32), device
                )
                feas_loss = feas_c * F.binary_cross_entropy_with_logits(aux["feasibility"], feas_tgt)
            if surv_c > 1e-12 and all("steps_to_end" in st for st in steps):
                surv_tgt = tensor_to_device(
                    torch.tensor([float(st["steps_to_end"]) / 30.0 for st in steps], dtype=torch.float32), device
                ).clamp(0.0, 1.0)
                surv_loss = surv_c * F.smooth_l1_loss(aux["survival"], surv_tgt, beta=1.0)

        def _safe(t):
            return t if torch.isfinite(t).item() else torch.tensor(0.0, device=device)

        loss = (
            policy_loss
            + value_coef * value_loss
            - entropy_coef_eff * entropy_mean
            + hole_coef * _safe(hole_aux_loss)
            + cp_coef * _safe(clear_pred_loss)
            + _safe(bq_loss)
            + _safe(feas_loss)
            + _safe(surv_loss)
        )

        model.train()
        opt.zero_grad()
        stepped = bool(torch.isfinite(loss).item())
        if stepped:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max(grad_clip, 1e-8))
            opt.step()
            if any(torch.isnan(p).any() for p in model.parameters()):
                opt.zero_grad(set_to_none=True)
                stepped = False
        else:
            opt.zero_grad(set_to_none=True)
        if device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes"):
            maybe_mps_synchronize(device)

        _state["episodes"] += 1
        ep = _state["episodes"]

        save_every = max(1, int(os.environ.get("RL_SAVE_EVERY", "500")))
        if ep % save_every == 0:
            _save_checkpoint("periodic")

        def _log_float(t) -> float | None:
            v = float(t.detach().item())
            return v if math.isfinite(v) else None

        log_row = {
            "event": "train_episode",
            "episodes": ep,
            "loss_policy": _loss_scalar_for_log(policy_loss),
            "loss_value": _loss_scalar_for_log(value_loss),
            "loss_hole_aux": _log_float(hole_aux_loss),
            "loss_clear_pred": _log_float(clear_pred_loss),
            "loss_bq": _log_float(bq_loss),
            "loss_feas": _log_float(feas_loss),
            "loss_surv": _log_float(surv_loss),
            "entropy": _log_float(entropy_mean),
            "step_count": tlen,
            "optimizer_step": stepped,
        }
        if data.get("score") is not None:
            try:
                log_row["score"] = float(data["score"])
            except (TypeError, ValueError):
                pass
        if data.get("won") is not None:
            log_row["won"] = bool(data["won"])
        if data.get("game_steps") is not None:
            try:
                log_row["game_steps"] = int(data["game_steps"])
            except (TypeError, ValueError):
                pass
        _append_training_log(log_row)

        return jsonify(
            {
                "ok": True,
                "episodes": ep,
                "loss_policy": _loss_scalar_for_log(policy_loss),
                "loss_value": _loss_scalar_for_log(value_loss),
                "loss_hole_aux": _log_float(hole_aux_loss),
                "loss_clear_pred": _log_float(clear_pred_loss),
                "loss_bq": _log_float(bq_loss),
                "loss_feas": _log_float(feas_loss),
                "loss_surv": _log_float(surv_loss),
                "entropy": _log_float(entropy_mean),
                "optimizer_step": stepped,
            }
        )


def create_rl_blueprint() -> Blueprint:
    bp = Blueprint("rl", __name__)

    @bp.route("/api/rl/status", methods=["GET"])
    def rl_status():
        if torch is None:
            return jsonify(
                {
                    "available": False,
                    "reason": _state.get("error") or "torch not installed",
                }
            )
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"available": False, "reason": str(e)})
        return jsonify(
            {
                "available": True,
                "device": str(_state["device"]),
                "episodes": _state["episodes"],
                "checkpoint_loaded": _state["checkpoint_loaded"],
                "save_path": str(_state["save_path"]),
                "training_log": str(_training_log_path()),
                "save_every": int(os.environ.get("RL_SAVE_EVERY", "500")),
                "autoload": os.environ.get("RL_AUTOLOAD", "1"),
                "meta": _state["meta"],
            }
        )

    @bp.route("/api/rl/training_log", methods=["GET"])
    def rl_training_log():
        """查询训练 JSONL 最近若干条：?tail=200（仅读尾部，适配大文件）"""
        tail = max(1, min(5000, int(request.args.get("tail", "200"))))
        path = _training_log_path()
        if not path.is_file():
            return jsonify({"path": str(path), "entries": [], "exists": False})
        lines = _read_jsonl_tail_lines(path, tail)
        entries = []
        for ln in lines:
            try:
                entries.append(json.loads(ln))
            except json.JSONDecodeError:
                entries.append({"raw": ln})
        return jsonify({"path": str(path.resolve()), "entries": entries, "exists": True})

    @bp.route("/api/rl/select_action", methods=["POST"])
    def rl_select_action():
        """body: { phi: number[][], state: number[] (ψ 长度见 featureEncoding.stateDim), temperature } -> { index }"""
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        data = request.get_json(force=True, silent=True) or {}
        phi = data.get("phi")
        state = data.get("state")
        temperature = float(data.get("temperature", 1.0))
        if not phi or not state:
            return jsonify({"error": "phi and state required"}), 400
        with _rl_lock:
            model = _state["model"]
            device = _state["device"]
            phi_t = tensor_to_device(torch.tensor(phi, dtype=torch.float32), device)
            model.eval()
            with torch.no_grad():
                logits = _stable_logits(model.forward_policy_logits(phi_t))
                if temperature > 1e-8:
                    logits = logits / temperature
                dist = Categorical(logits=logits)
                idx = int(dist.sample().item())
            model.train()
        return jsonify({"index": idx})

    @bp.route("/api/rl/train_episode", methods=["POST"])
    def rl_train_episode():
        """
        body: {
          steps: [{ phi: number[][], state: number[] (ψ), idx: number, reward: number,
                    holes_after?: number }],
          gamma?: number, value_coef?: number
        }
        未传的 gamma/value_coef 等由环境变量 RL_* 决定（见文件头注释）。
        若每步均含 holes_after（落子后盘面空洞格数），且 rlRewardShaping.holeAuxLossCoef>0，
        则总 loss 增加空洞辅助项（与 python -m rl_pytorch.train 一致）。可用 RL_HOLE_AUX_COEF 覆盖系数。
        可选 meta：score（对局得分）, won（是否胜）, game_steps（模拟器步数，与轨迹长度一致时可不传）供看板可视化。
        """
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        data = request.get_json(force=True, silent=True) or {}
        steps = data.get("steps")
        if not steps:
            return jsonify({"error": "steps required"}), 400
        gamma = float(data.get("gamma", os.environ.get("RL_GAMMA", "0.99")))
        value_coef = float(data.get("value_coef", os.environ.get("RL_VALUE_COEF", "1.0")))
        value_huber_beta = float(os.environ.get("RL_VALUE_HUBER_BETA", "1.0"))
        return_scale = float(os.environ.get("RL_RETURN_SCALE", "1.0"))
        adv_norm = os.environ.get("RL_ADV_NORM", "1").lower() not in ("0", "false", "no", "")
        adv_min_std = float(os.environ.get("RL_ADV_MIN_STD", "1e-4"))
        grad_clip = float(os.environ.get("RL_GRAD_CLIP", "1.0"))

        for i, st in enumerate(steps):
            phi = st.get("phi")
            if not isinstance(phi, list) or len(phi) == 0:
                return jsonify({"error": f"step {i}: phi 须为非空二维数组（每行一条合法动作的 φ）"}), 400
            try:
                idx = int(st["idx"])
            except (TypeError, KeyError, ValueError):
                return jsonify({"error": f"step {i}: 缺少或非法的 idx"}), 400
            if idx < 0 or idx >= len(phi):
                return jsonify(
                    {
                        "error": f"step {i}: idx={idx} 超出 phi 行数 {len(phi)}",
                        "hint": "与 /api/rl/select_action 返回的 index 一致，且在当步合法动作数量范围内",
                    }
                ), 400
            state = st.get("state")
            if not isinstance(state, list) or len(state) != STATE_FEATURE_DIM:
                return jsonify(
                    {
                        "error": f"step {i}: state 长度须为 {STATE_FEATURE_DIM}（当前 {len(state) if isinstance(state, list) else type(state).__name__}）",
                    }
                ), 400

        try:
            batch_size = _online_batch_size()
            use_batch = batch_size > 1 and _batch_ppo_update_fn is not None

            if use_batch:
                with _rl_lock:
                    ep_data = _convert_episode_for_ppo(
                        data, steps, _state["model"], _state["device"]
                    )
                    _state["replay_buffer"].append(ep_data)
                    buf_len = len(_state["replay_buffer"])

                if buf_len < batch_size:
                    return jsonify({
                        "ok": True,
                        "buffered": True,
                        "buffer_size": buf_len,
                        "batch_threshold": batch_size,
                        "episodes": _state["episodes"],
                    })

                with _rl_lock:
                    result = _flush_replay_buffer()
                ep = _state["episodes"]

                def _lf(v):
                    return float(v) if v is not None and math.isfinite(float(v)) else None

                return jsonify({
                    "ok": True,
                    "buffered": False,
                    "batch_update": True,
                    "episodes": ep,
                    "loss_policy": _lf(result.get("policy_loss")) if result else None,
                    "loss_value": _lf(result.get("value_loss")) if result else None,
                    "entropy": _lf(result.get("entropy")) if result else None,
                    "optimizer_step": True,
                })

            return _rl_train_episode_inner(
                data,
                steps,
                gamma,
                value_coef,
                value_huber_beta,
                return_scale,
                adv_norm,
                adv_min_std,
                grad_clip,
            )
        except Exception as exc:
            import logging
            import traceback

            logging.exception("train_episode 失败: %s", exc)
            return (
                jsonify(
                    {
                        "error": str(exc),
                        "type": type(exc).__name__,
                        "traceback": traceback.format_exc(),
                    }
                ),
                500,
            )

    @bp.route("/api/rl/eval_values", methods=["POST"])
    def rl_eval_values():
        """批量评估 V(s)：body { states: number[][] } → { values: number[] }

        供浏览器端 1-step lookahead：对每个合法动作模拟后提取 state features，
        批量评估 V(s')，用 Q(s,a) = r(s,a) + γ·V(s') 选择更优动作。
        """
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        data = request.get_json(force=True, silent=True) or {}
        states = data.get("states")
        if not states or not isinstance(states, list):
            return jsonify({"error": "states required (list of state feature vectors)"}), 400
        with _rl_lock:
            model = _state["model"]
            device = _state["device"]
            model.eval()
            with torch.no_grad():
                s_t = tensor_to_device(
                    torch.tensor(states, dtype=torch.float32), device
                )
                vals = model.forward_value(s_t)
                values = vals.cpu().tolist()
            model.train()
        return jsonify({"values": values})

    @bp.route("/api/rl/flush_buffer", methods=["POST"])
    def rl_flush_buffer():
        """手动触发 replay buffer 的批量 PPO 更新（无需等 buffer 满）。"""
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        with _rl_lock:
            buf_len = len(_state.get("replay_buffer", []))
            if buf_len == 0:
                return jsonify({"ok": True, "message": "buffer empty", "episodes": _state["episodes"]})
            result = _flush_replay_buffer()
        return jsonify({
            "ok": True,
            "episodes": _state["episodes"],
            "flushed": buf_len,
            "result": result,
        })

    @bp.route("/api/rl/save", methods=["POST"])
    def rl_save():
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        data = request.get_json(force=True, silent=True) or {}
        path = data.get("path")
        if path:
            with _rl_lock:
                _state["save_path"] = Path(path)
        with _rl_lock:
            _save_checkpoint("manual")
        return jsonify({"ok": True, "path": str(_state["save_path"])})

    @bp.route("/api/rl/load", methods=["POST"])
    def rl_load():
        """body: { path: string } 热加载权重（不断开服务）。"""
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        data = request.get_json(force=True, silent=True) or {}
        path = data.get("path", "").strip()
        if not path or not Path(path).is_file():
            return jsonify({"error": "valid path required"}), 400
        with _rl_lock:
            device = _state["device"] or resolve_training_device(os.environ.get("RL_DEVICE", "auto"))
            _state["device"] = device
            try:
                loaded = _load_checkpoint_into_model(Path(path), device)
            except Exception as exc:
                return jsonify({"error": f"Checkpoint 加载失败: {exc}"}), 400
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
            warn = loaded.get("compat_warning")
            _state["checkpoint_loaded"] = None if warn else str(Path(path).resolve())
            lr = float(os.environ.get("RL_LR", "3e-4"))
            _state["optimizer"] = adam_for_training(_state["model"].parameters(), lr=lr)
            osh = loaded.get("optimizer_state")
            if osh:
                try:
                    _state["optimizer"].load_state_dict(osh)
                except Exception:
                    pass
        _append_training_log(
            {
                "event": "load_api",
                "checkpoint_loaded": _state["checkpoint_loaded"],
                "episodes": _state["episodes"],
            }
        )
        return jsonify(
            {
                "ok": True,
                "episodes": _state["episodes"],
                "checkpoint_loaded": _state["checkpoint_loaded"],
            }
        )

    return bp


def register_rl_routes(app):
    """在 Flask app 上注册 RL 蓝图。"""
    app.register_blueprint(create_rl_blueprint())
