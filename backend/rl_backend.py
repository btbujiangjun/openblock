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
  RL_BATCH_SIZE       在线训练攒批大小，默认 32；>1 且缓冲满时用批量 PPO，并启用与 train_loop 一致的 searchReplay（见 game_rules）
  浏览器轨迹可选字段 q_teacher（每步与 phi 行数相同的 Q 数组）：开启自博弈 1-step lookahead 时由前端上报 r+γV(s')，服务端写入 q_vals 参与 Q 蒸馏（弱 teacher，非 MCTS）；关闭 lookahead 或无该字段则 teacher_q_coverage 仍为 0
  RL_SEARCH_REPLAY    设为 0/false/off 可关闭 searchReplay（与 train.py 一致）
  RL_MPS_SYNC         设为 1 时训练步后对 MPS 同步（多线程下更稳，**默认关闭**以利 M4/MPS 吞吐）
  RL_CPU_DISABLE_MKLDNN  默认 1：CPU 上关闭 oneDNN 卷积后端，避免部分环境 Conv2d 报 could not create a primitive；设为 0 可恢复加速
  PYTORCH_ENABLE_MPS_FALLBACK  未实现算子回退 CPU（见 PyTorch 文档）
  PYTORCH_MPS_HIGH_WATERMARK_RATIO  可选 0.0~1.0，调节 MPS 显存水位（须在进程早期设置，见 README）
"""

from __future__ import annotations

import collections
import copy
import json
import math
import os
import random
import sys
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

_ROOT = Path(__file__).resolve().parent.parent  # 仓库根；用于 import rl_pytorch.* 等顶层包
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

# 后台 train_loop 状态
_bg_train_lock = threading.Lock()
_bg_train_thread: threading.Thread | None = None
_bg_train_stop_event: threading.Event | None = None
_bg_train_status: dict = {"running": False, "episodes_done": 0, "error": None}

# P0-C · OOM/异常退出自动 resume 重启限速器
# 11.5h 长跑后 macOS jetsam SIGKILL 训练进程，从此训练静默停摆。需要后端在监测到
# bg_training_end with rc!=0 时自动 resume。但必须限速：
#   - 同进程崩溃链式（启动 → 立即崩 → 重启 → 立即崩 ...）会变成 fork-bomb
#   - 用滑动窗口"最近 N 分钟最多 K 次"控制频率；超限改为 alert 不再自启
_bg_train_restart_history: list[float] = []
_BG_TRAIN_RESTART_WINDOW_SEC = 1800   # 30 分钟
_BG_TRAIN_RESTART_MAX_IN_WINDOW = 3   # 同一 30 分钟内最多 3 次自动 resume

def _maybe_auto_resume_training(launch_args: dict, exit_code: int) -> tuple[bool, str]:
    """决定是否对一次异常退出做自动 resume。

    返回 (will_restart, reason)。仅对真实异常（非 SIGINT=-2/SIGTERM=-15）触发；
    限速窗口超限时拒绝并把结果写入 training.jsonl 供看板观察。
    """
    now = time.time()
    # 用户主动 stop 走 SIGINT/SIGTERM，不应该自动续；只在「内核杀（-9）/Python 异常退出码非 0」时拉起
    if exit_code in (0, -2, -15):
        return False, "user_stop_or_completed"
    # P2 周期性重启：exit code 99 是训练循环主动请求重启，不受限速器约束（属正常释放内存路径）
    if exit_code == 99:
        return True, "periodic_restart_request"
    # 清理过期重启历史
    _bg_train_restart_history[:] = [t for t in _bg_train_restart_history if now - t < _BG_TRAIN_RESTART_WINDOW_SEC]
    if len(_bg_train_restart_history) >= _BG_TRAIN_RESTART_MAX_IN_WINDOW:
        return False, f"rate_limited:{len(_bg_train_restart_history)}_in_{_BG_TRAIN_RESTART_WINDOW_SEC}s"
    _bg_train_restart_history.append(now)
    return True, f"auto_resume_after_exit_{exit_code}"

# 持久化后台训练状态：Flask debug reloader/重启会清空内存全局，导致已启动的训练子进程
# 变成「追踪不到的孤儿」（stop 找不到、status 误判已停）。落盘 pid 等元信息后，
# 后端重启可据此恢复对存活子进程的管理。
_BG_STATE_PATH = _ROOT / "rl_checkpoints" / "bg_train_state.json"


def _pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # 进程存在但属于其它用户/权限受限，视为存活
        return True


def _save_bg_state(meta: dict) -> None:
    """落盘后台训练元信息（含 pid、目标局数等）。"""
    try:
        _BG_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _BG_STATE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_BG_STATE_PATH)
    except Exception:
        pass


def _load_bg_state() -> dict | None:
    try:
        if not _BG_STATE_PATH.is_file():
            return None
        return json.loads(_BG_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def _clear_bg_state() -> None:
    try:
        _BG_STATE_PATH.unlink(missing_ok=True)
    except Exception:
        pass


def _latest_logged_episodes() -> int:
    """从 training.jsonl 尾部读取最新的累计局数，用于展示训练进度。"""
    try:
        path = _training_log_path()
        if not path.is_file():
            return 0
        for ln in reversed(_read_jsonl_tail_lines(path, 50)):
            try:
                obj = json.loads(ln)
            except json.JSONDecodeError:
                continue
            ep = obj.get("episodes")
            if isinstance(ep, (int, float)):
                return int(ep)
        return 0
    except Exception:
        return 0


def _hydrate_bg_status_from_disk_locked() -> None:
    """在持有 _bg_train_lock 的前提下，若内存无 pid 但磁盘记录的进程仍存活，则恢复跟踪。"""
    if _bg_train_status.get("pid"):
        return
    disk = _load_bg_state()
    if not disk:
        return
    pid = disk.get("pid")
    if _pid_alive(pid):
        _bg_train_status["pid"] = pid
        _bg_train_status["running"] = True
        _bg_train_status.setdefault("error", None)
        _bg_train_status["episodes_target"] = disk.get("episodes_target")
        _bg_train_status["recovered"] = True
    else:
        # 磁盘记录的进程已不在，清理陈旧状态
        _clear_bg_state()


def _get_bg_training_info() -> dict:
    """获取后台训练状态，通过进程存活检测避免 Flask reloader 状态不同步。"""
    with _bg_train_lock:
        _hydrate_bg_status_from_disk_locked()
        pid = _bg_train_status.get("pid")
        running = _bg_train_status["running"]
        if pid:
            alive = _pid_alive(pid)
            if running and not alive:
                _bg_train_status["running"] = False
                running = False
                _clear_bg_state()
            elif not running and alive:
                _bg_train_status["running"] = True
                running = True
        episodes_done = _latest_logged_episodes()
        if episodes_done:
            _bg_train_status["episodes_done"] = episodes_done
        return {
            "running": running,
            "episodes_done": _bg_train_status.get("episodes_done", 0),
            "error": _bg_train_status["error"],
            "pid": pid,
            "episodes_target": _bg_train_status.get("episodes_target"),
            "recovered": _bg_train_status.get("recovered", False),
        }


DEFAULT_CKPT_NAME = "rl_checkpoints/bb_policy.pt"
DEFAULT_TRAINING_LOG = "rl_checkpoints/training.jsonl"

# 后台训练子进程只继承与设备/运行时相关的 RL_*，搜索、出块、teacher、监督等语义变量
# env 透传策略：旧白名单只 19 个，导致 restart-openblock.sh 显式 export 的
#   RL_VALUE_COEF / RL_BATCH_SIZE / RL_BEST_GUARD / RL_KL_REF_COEF / RL_RETURN_SCALE / ...
# 等管理员调参全部被吞掉（bg_training_start.dropped_rl_env 实证），等于"我们调的没生效"。
# rl_pytorch 全家桶实际读取 115+ 个 RL_* env，逐一白名单维护既不现实也易遗漏。
#
# 改为**黑名单**：默认透传所有 RL_*；仅 deny 几个会被搜索预设/请求体强制覆盖的"易污染"开关
# （前端切预设时 Flask 进程会保留上次的 RL_LOOKAHEAD=0，下次启用 MCTS 会被静默禁用——
#  这是历史 bug 的真根因；白名单是当时治标，本次改为精准 deny 治本）。
_RL_TRAIN_ENV_DENYLIST = {
    "RL_LOOKAHEAD",       # 看板按 preset 强制覆盖；继承上次会让 MCTS 启用后仍被静默禁用
    "RL_MCTS",            # 同上：MCTS 开关由 mcts_sims 计算后写入
    "RL_BEAM2PLY",        # 同上：beam 开关由 preset_beam2 写入
    "RL_BEAM3PLY",        # 同上：beam 开关由 preset_beam3 写入
    "RL_SUPERVISION",     # 同上：performance 预设强制覆盖
    "RL_SPAWN_CHEAP",     # 同上：spawn_cheap 显式 opt-in
}


def _clean_training_subprocess_env() -> tuple[dict, list[str]]:
    """构造训练子进程 env：透传所有 RL_*，仅过滤一小撮易污染开关。

    Returns:
        (env_dict, denied_keys) — denied_keys 列出本次 drop 掉的 env 名，供日志可见。
    """
    env = {k: v for k, v in os.environ.items() if k not in _RL_TRAIN_ENV_DENYLIST}
    denied = sorted(k for k in os.environ if k in _RL_TRAIN_ENV_DENYLIST)
    return env, denied


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
        return None
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


def _module_tensors_finite(model: torch.nn.Module, *, check_grads: bool = False) -> bool:
    for p in model.parameters():
        t = p.grad if check_grads else p
        if t is None:
            continue
        if not bool(torch.isfinite(t).all().item()):
            return False
    return True


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
    from rl_pytorch.train import (
        _episode_replay_priority,
        _normalize_teacher_q,
        _q_distill_coef,
        _q_distill_min_std,
        _q_distill_norm_mode,
        _q_distill_tau,
        _reevaluate_and_update as _batch_ppo_update_fn,
        _replay_config,
        _topology_aux_coef,
    )
except ImportError as e:
    torch = None
    resolve_training_device = None  # type: ignore
    apply_cpu_training_tuning = None  # type: ignore
    tensor_to_device = None  # type: ignore
    maybe_mps_synchronize = None  # type: ignore
    rl_win_threshold_for_episode = None  # type: ignore
    _batch_ppo_update_fn = None  # type: ignore
    _replay_config = None  # type: ignore
    _topology_aux_coef = None  # type: ignore
    _episode_replay_priority = None  # type: ignore
    _normalize_teacher_q = None  # type: ignore
    _q_distill_coef = None  # type: ignore
    _q_distill_tau = None  # type: ignore
    _q_distill_norm_mode = None  # type: ignore
    _q_distill_min_std = None  # type: ignore
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
            n_act = int(phi_np.shape[0])
            row = {
                "state": state_np,
                "action_feats": action_feats,
                "n_actions": n_act,
                "chosen_idx": idx,
                "reward": float(st["reward"]),
                "old_log_prob": old_lp,
                "holes_after": int(st.get("holes_after", 0)),
                "clears": int(st.get("clears", 0)),
                "board_quality": float(st.get("board_quality", 0.0)),
                "feasibility": float(st.get("feasibility", 1.0)),
                "topology_after": st.get("topology_after"),
                "steps_to_end": 0,
            }
            qt = st.get("q_teacher")
            if isinstance(qt, list) and len(qt) == n_act:
                row["q_vals"] = np.array(qt, dtype=np.float32)
            trajectory.append(row)

    total = len(trajectory)
    for i in range(total):
        trajectory[i]["steps_to_end"] = total - i - 1

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
    """对 replay buffer 中所有累积 episode 执行一次批量 PPO 更新。

    与 ``train_loop`` 对齐：在 ``game_rules.rlRewardShaping.searchReplay`` 开启时，
    从 ``search_replay_buffer`` 抽样困难局混入本批更新，并在更新后写回缓冲区
    （使看板 ``replay_steps`` / replay ratio 在非零时有统计意义）。
    """
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

    update_batch = list(buf)
    replay_sample: list[dict] = []
    if _replay_config is not None and _episode_replay_priority is not None:
        cfg = _replay_config()
        if bool(cfg.get("enabled", False)):
            maxlen = max(16, int(cfg.get("maxEpisodes", 256)))
            srb = _state.setdefault(
                "search_replay_buffer",
                collections.deque(maxlen=maxlen),
            )
            if len(srb) > 0:
                replay_n = min(
                    int(cfg.get("maxSamples", 8)),
                    max(1, int(round(len(buf) * float(cfg.get("sampleRatio", 0.5))))),
                    len(srb),
                )
                replay_sample = copy.deepcopy(random.sample(list(srb), replay_n))
                for ep in replay_sample:
                    ep["_replay_sample"] = True
                update_batch = list(buf) + replay_sample

    result = _batch_ppo_update_fn(
        model,
        opt,
        update_batch,
        device,
        gamma,
        gae_lambda,
        return_scale,
        value_coef,
        entropy_coef,
        normalize_adv,
        adv_min_std,
        value_huber_beta,
        grad_clip,
        ppo_epochs=ppo_epochs,
        ppo_clip=ppo_clip,
        global_ep=ep_next,
    )

    if _replay_config is not None and _episode_replay_priority is not None:
        cfg = _replay_config()
        if bool(cfg.get("enabled", False)):
            srb = _state.get("search_replay_buffer")
            if srb is not None:
                min_pri = float(cfg.get("minPriority", 0.0))
                ranked_batch = sorted(buf, key=_episode_replay_priority, reverse=True)
                keep_n = min(
                    len(ranked_batch),
                    max(1, int(cfg.get("keepPerBatch", max(1, len(buf) // 2)))),
                )
                for ep in ranked_batch[:keep_n]:
                    if _episode_replay_priority(ep) >= min_pri:
                        srb.append(copy.deepcopy(ep))

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
        "loss_q_distill": _lf(r.get("loss_q_distill")),
        "loss_visit_pi": _lf(r.get("loss_visit_pi")),
        "q_distill_coef": _lf(r.get("q_distill_coef")),
        "visit_pi_coef": _lf(r.get("visit_pi_coef")),
        "entropy": _lf(r.get("entropy")),
        "loss_hole_aux": _lf(r.get("loss_hole_aux")),
        "loss_clear_pred": _lf(r.get("loss_clear_pred")),
        "loss_topology_aux": _lf(r.get("loss_topology_aux")),
        "loss_bq": _lf(r.get("loss_bq")),
        "loss_feas": _lf(r.get("loss_feas")),
        "loss_surv": _lf(r.get("loss_surv")),
        "pg_steps": int(r.get("pg_steps", 0) or 0),
        "replay_steps": int(r.get("replay_steps", 0) or 0),
        "replay_samples": int(r.get("replay_samples", 0) or 0),
        "teacher_q_coverage": _lf(r.get("teacher_q_coverage")),
        "teacher_q_std": _lf(r.get("teacher_q_std")),
        "teacher_q_margin": _lf(r.get("teacher_q_margin")),
        "teacher_q_entropy": _lf(r.get("teacher_q_entropy")),
        "teacher_q_entropy_norm": _lf(r.get("teacher_q_entropy_norm")),
        "teacher_visit_coverage": _lf(r.get("teacher_visit_coverage")),
        "teacher_visit_entropy": _lf(r.get("teacher_visit_entropy")),
        "teacher_visit_entropy_norm": _lf(r.get("teacher_visit_entropy_norm")),
        "score": avg_score,
        "won": win_rate > 0.5,
        "win_count": wins,
        "win_rate": round(win_rate, 4),
        "step_count": round(float(avg_steps), 2) if avg_steps is not None else None,
        "optimizer_step": bool(r.get("optimizer_stepped", False)),
        "optimizer_skip_reason": str(r.get("optimizer_skip_reason") or ""),
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

        ep_next = _state["episodes"] + 1
        q_dc = float(_q_distill_coef(ep_next))
        q_tau = max(float(_q_distill_tau()), 0.1)
        q_nm = str(_q_distill_norm_mode())
        q_ms = float(_q_distill_min_std())
        q_distill_acc = torch.tensor(0.0, device=device, dtype=torch.float32)
        q_teacher_n = 0

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
            if q_dc > 1e-12:
                qt = st.get("q_teacher")
                n_act = int(phi_t.shape[0])
                if isinstance(qt, list) and len(qt) == n_act:
                    qv = np.asarray(qt, dtype=np.float32)
                    q_norm = _normalize_teacher_q(qv, q_nm, q_ms)
                    q_tv = tensor_to_device(torch.tensor(q_norm, dtype=torch.float32), device)
                    tgt_pi = torch.softmax(q_tv / q_tau, dim=0)
                    q_distill_acc = q_distill_acc + -(tgt_pi * log_probs).sum()
                    q_teacher_n += 1
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
        entropy_coef_eff = _effective_entropy_coef(ep_next)
        q_distill_loss = (
            q_distill_acc / q_teacher_n if q_teacher_n > 0
            else torch.tensor(0.0, device=device, dtype=torch.float32)
        )
        q_distill_loss = torch.nan_to_num(q_distill_loss, nan=0.0, posinf=0.0, neginf=0.0)
        hole_coef, hole_denom = _hole_aux_coef_and_denom()
        cp_coef = _clear_pred_coef()
        topo_coef = float(_topology_aux_coef() if _topology_aux_coef is not None else (RL_REWARD_SHAPING.get("topologyAuxLossCoef") or 0.0))
        hole_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        clear_pred_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        topology_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        state_mat = None
        chosen_a = None
        if (
            (hole_coef > 1e-12 or cp_coef > 1e-12 or topo_coef > 1e-12)
            and all("holes_after" in st for st in steps)
        ):
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
        if (
            topo_coef > 1e-12
            and callable(getattr(model, "forward_topology_aux", None))
            and state_mat is not None
            and all(isinstance(st.get("topology_after"), list) for st in steps)
        ):
            topo_tgt = tensor_to_device(
                torch.tensor([st["topology_after"] for st in steps], dtype=torch.float32), device
            ).clamp(0.0, 1.0)
            topology_aux_loss = F.smooth_l1_loss(
                model.forward_topology_aux(state_mat, chosen_a),
                topo_tgt,
                reduction="mean",
                beta=1.0,
            )

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
            + topo_coef * _safe(topology_aux_loss)
            + _safe(bq_loss)
            + _safe(feas_loss)
            + _safe(surv_loss)
            + q_dc * _safe(q_distill_loss)
        )

        model.train()
        opt.zero_grad()
        stepped = False
        skip_reason = ""
        if torch.isfinite(loss).item():
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), max(grad_clip, 1e-8))
            if not torch.isfinite(grad_norm).item() or not _module_tensors_finite(model, check_grads=True):
                skip_reason = "non_finite_grad"
                opt.zero_grad(set_to_none=True)
            else:
                pre_sd = {k: v.detach().clone() for k, v in model.state_dict().items()}
                pre_opt_sd = copy.deepcopy(opt.state_dict())
                opt.step()
                stepped = True
                if not _module_tensors_finite(model):
                    model.load_state_dict(pre_sd)
                    opt.load_state_dict(pre_opt_sd)
                    opt.zero_grad(set_to_none=True)
                    skip_reason = "non_finite_param_after_step"
                    stepped = False
        else:
            skip_reason = "non_finite_loss"
            opt.zero_grad(set_to_none=True)
        if stepped:
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

        cov_q = (q_teacher_n / tlen) if tlen else None
        log_row = {
            "event": "train_episode",
            "episodes": ep,
            "loss_policy": _loss_scalar_for_log(policy_loss),
            "loss_value": _loss_scalar_for_log(value_loss),
            "loss_q_distill": _loss_scalar_for_log(q_distill_loss),
            "loss_hole_aux": _log_float(hole_aux_loss),
            "loss_clear_pred": _log_float(clear_pred_loss),
            "loss_topology_aux": _log_float(topology_aux_loss),
            "loss_bq": _log_float(bq_loss),
            "loss_feas": _log_float(feas_loss),
            "loss_surv": _log_float(surv_loss),
            "entropy": _log_float(entropy_mean),
            "q_distill_coef": _loss_scalar_for_log(q_dc),
            "teacher_q_coverage": round(float(cov_q), 6) if cov_q is not None else None,
            "step_count": tlen,
            "optimizer_step": stepped,
            "optimizer_skip_reason": skip_reason,
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
                "loss_q_distill": _loss_scalar_for_log(q_distill_loss),
                "loss_hole_aux": _log_float(hole_aux_loss),
                "loss_clear_pred": _log_float(clear_pred_loss),
                "loss_topology_aux": _log_float(topology_aux_loss),
                "loss_bq": _log_float(bq_loss),
                "loss_feas": _log_float(feas_loss),
                "loss_surv": _log_float(surv_loss),
                "entropy": _log_float(entropy_mean),
                "q_distill_coef": float(q_dc),
                "teacher_q_coverage": cov_q,
                "optimizer_step": stepped,
                "optimizer_skip_reason": skip_reason,
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
        mps_available = False
        try:
            _mb = getattr(torch.backends, "mps", None)
            mps_available = _mb is not None and bool(_mb.is_available())
        except Exception:
            mps_available = False
        try:
            cuda_available = bool(torch.cuda.is_available())
        except Exception:
            cuda_available = False
        from rl_pytorch.game_rules import rl_training_presets, rl_active_training_preset
        return jsonify(
            {
                "available": True,
                "device": str(_state["device"]),
                "device_env": os.environ.get("RL_DEVICE", "auto"),
                "mps_available": mps_available,
                "cuda_available": cuda_available,
                "platform": sys.platform,
                "episodes": _state["episodes"],
                "checkpoint_loaded": _state["checkpoint_loaded"],
                "save_path": str(_state["save_path"]),
                "training_log": str(_training_log_path()),
                "save_every": int(os.environ.get("RL_SAVE_EVERY", "500")),
                "autoload": os.environ.get("RL_AUTOLOAD", "1"),
                "meta": _state["meta"],
                "training_preset": rl_active_training_preset(),
                "training_presets": {
                    k: {"label": v.get("label", k), "description": v.get("description", "")}
                    for k, v in rl_training_presets().items()
                    if k != "comment"
                },
                "bg_training": _get_bg_training_info(),
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
                    "optimizer_step": bool(result.get("optimizer_stepped", False)) if result else False,
                    "optimizer_skip_reason": str(result.get("optimizer_skip_reason") or "") if result else "",
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

    @bp.route("/api/rl/eval_greedy", methods=["POST"])
    def rl_eval_greedy():
        """离线式贪心评估当前加载的权重；写入 training.jsonl 一行 ``event: eval_greedy``。

        body 可选：n_games（默认 64，上限 512）、rounds（默认 3，上限 16）、
        temperature（默认 0）、win_threshold（默认 game_rules）、seed_base（默认 20260503）。
        """
        if torch is None:
            return jsonify({"error": "torch not installed"}), 503
        try:
            _ensure_initialized()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        data = request.get_json(force=True, silent=True) or {}
        n_games = max(1, min(512, int(data.get("n_games", 64))))
        rounds = max(1, min(16, int(data.get("rounds", 3))))
        temperature = float(data.get("temperature", 0.0))
        seed_base = int(data.get("seed_base", 20260503))
        wt_raw = data.get("win_threshold")
        win_threshold = float(wt_raw) if wt_raw is not None else None

        from rl_pytorch.config import WIN_SCORE_THRESHOLD as _WT
        from rl_pytorch.eval_gate import run_eval_games

        rng = random.Random(seed_base)
        agg_scores: list[float] = []
        last_metrics: dict | None = None
        with _rl_lock:
            model = _state["model"]
            device = _state["device"]
            model.eval()
            try:
                with torch.no_grad():
                    for _ in range(rounds):
                        seeds = [rng.randrange(1, 2**31 - 1) for _ in range(n_games)]
                        last_metrics = run_eval_games(
                            model,
                            device,
                            n_games,
                            win_threshold,
                            temperature=temperature,
                            seeds=seeds,
                        )
                        agg_scores.extend(float(x) for x in (last_metrics.get("scores") or []))
            finally:
                model.train()

        thr = float(last_metrics.get("win_threshold", _WT)) if last_metrics else float(_WT)
        wins = sum(1 for s in agg_scores if s >= thr)
        summary = {
            "event": "eval_greedy",
            "ok": True,
            "n_games_total": len(agg_scores),
            "rounds": rounds,
            "n_games_per_round": n_games,
            "win_threshold": thr,
            "win_rate": wins / max(len(agg_scores), 1),
            "avg_score": sum(agg_scores) / max(len(agg_scores), 1) if agg_scores else 0.0,
            "temperature": temperature,
            "checkpoint_episodes": _state["episodes"],
            "seed_base": seed_base,
        }
        _append_training_log(summary)
        return jsonify({k: v for k, v in summary.items() if k != "event"})

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

    @bp.route("/api/rl/training_preset", methods=["GET", "POST"])
    def rl_training_preset():
        """GET: 返回当前预设和所有可选项。POST body: { preset: "performance"|"balanced"|"quality" }"""
        from rl_pytorch.game_rules import (
            rl_training_presets,
            rl_active_training_preset,
            rl_set_training_preset,
        )
        if request.method == "GET":
            presets = rl_training_presets()
            return jsonify({
                "active": rl_active_training_preset(),
                "presets": {
                    k: {"label": v.get("label", k), "description": v.get("description", "")}
                    for k, v in presets.items()
                    if k != "comment"
                },
            })
        data = request.get_json(force=True, silent=True) or {}
        name = str(data.get("preset", "")).strip()
        if not name:
            return jsonify({"error": "preset field required"}), 400
        prev = rl_active_training_preset()
        cfg = rl_set_training_preset(name)
        if cfg is None:
            return jsonify({"error": f"unknown preset: {name}"}), 400
        # 页面刷新/多标签会重复 POST 同一 preset；仅真正切换时写日志，避免 training.jsonl 刷屏
        if name != prev:
            _append_training_log({
                "event": "preset_changed",
                "preset": name,
                "label": cfg.get("label", name),
            })
        return jsonify({"ok": True, "active": name, "label": cfg.get("label", name), "changed": name != prev})

    @bp.route("/api/rl/start_training", methods=["POST"])
    def rl_start_training():
        """启动后台 train_loop 子进程（与 python -m rl_pytorch.train 完全一致）。

        body (全部可选):
          episodes        目标局数，默认 50000
          mcts_sims       MCTS 模拟次数，0=关闭 MCTS（默认 0）
          n_workers       并行 worker 数，0=自动（默认 0）
          batch_episodes  每批局数（默认 64）
          ppo_epochs      PPO 轮数（默认 4）
          save_every      每 N 局保存 checkpoint（默认 50，页面训练防重启丢进度）
          eval_gate_every 每 N 局评估一次（默认 2000，0=关闭）
          resume          是否从 checkpoint 续训（默认 true）
        """
        import subprocess

        global _bg_train_thread, _bg_train_stop_event, _bg_train_status

        with _bg_train_lock:
            # 先尝试从磁盘恢复：避免 Flask 重启后内存丢失、误判「无训练」而重复启动孤儿进程
            _hydrate_bg_status_from_disk_locked()
            if _bg_train_status["running"] and _pid_alive(_bg_train_status.get("pid")):
                return jsonify({
                    "error": "训练已在运行中",
                    "episodes_done": _bg_train_status.get("episodes_done", 0),
                    "pid": _bg_train_status.get("pid"),
                }), 409

        data = request.get_json(force=True, silent=True) or {}
        episodes = int(data.get("episodes", 50000))
        preset = str(data.get("preset", "balanced")).strip()
        try:
            from rl_pytorch.game_rules import rl_training_presets
            preset_cfg = dict(rl_training_presets().get(preset) or {})
        except Exception:
            preset_cfg = {}
        preset_mcts = dict(preset_cfg.get("mcts") or {})
        preset_beam3 = dict(preset_cfg.get("beam3ply") or {})
        preset_beam2 = dict(preset_cfg.get("beam2ply") or {})
        # lookahead 显式开关：None=按 preset；False=强制关闭每步前瞻搜索（MCTS/beam/1-step），
        # 采集退化为「每步一次策略前向」，单局快 1~2 个数量级（吞吐优先，弱 teacher 信号）。
        _lookahead_raw = data.get("lookahead", None)
        force_no_lookahead = _lookahead_raw is False
        if force_no_lookahead:
            mcts_sims = 0
        elif "mcts_sims" in data:
            mcts_sims = int(data.get("mcts_sims", 0))
        elif preset_mcts.get("enabled", False):
            mcts_sims = int(preset_mcts.get("numSimulations", 0) or 0)
        else:
            mcts_sims = 0
        # n_workers：POST 显式优先，否则读 RL_N_WORKERS env（restart-openblock.sh 默认 4），
        # 都没设时走 0=auto（train.py 内 _auto_n_workers，CPU-2 与 10 取小）。
        # 用户报内存 79G 后建议固定 4，避免 spawn 模式下 8 worker × 1.5GB 副本拉爆。
        try:
            _default_nw = int(os.environ.get("RL_N_WORKERS", "0") or "0")
        except (TypeError, ValueError):
            _default_nw = 0
        n_workers = int(data.get("n_workers", _default_nw))
        batch_episodes = int(data.get("batch_episodes", 16))
        ppo_epochs = int(data.get("ppo_epochs", 4))
        # 后台/看板训练默认关闭评估门：eval_gate_check 会跑 paired+dual+search 共数百局
        # 且单局无步数上限，触发时会冻结 train loop 数分钟、期间不产出 train_episode 日志
        # （表现为「日志不刷新」）。看板场景重在持续监控，门控属离线训练范畴，默认关闭；
        # 调用方仍可显式传 eval_gate_every>0 启用。
        eval_gate_every = int(data.get("eval_gate_every", 0))
        eval_gate_games = int(data.get("eval_gate_games", 50))
        do_resume = bool(data.get("resume", True))
        training_stage = str(data.get("training_stage", data.get("stage", "single"))).strip() or "single"
        stage_plan = str(data.get("stage_plan", "")).strip()
        # 价值头损失权重：Lv 较 Lπ 收敛慢，看板模式默认 1.5 加速 value 拟合（决策更稳）
        value_coef = float(data.get("value_coef", os.environ.get("RL_VALUE_COEF", "1.0")))
        # 指标落盘频率：默认与 batch_episodes 对齐，确保每批训练都写一条 train_episode
        # JSONL（train.py 内 ep_cursor % log_every < bs 恒真），前端轮询即可逐批看到指标变化。
        log_every = int(data.get("log_every", batch_episodes))
        save_every = int(data.get("save_every", 50))
        save_path = os.environ.get("RL_CHECKPOINT_SAVE", "rl_checkpoints/bb_policy.pt")

        cmd = [
            sys.executable, "-m", "rl_pytorch.train",
            "--episodes", str(episodes),
            "--batch-episodes", str(batch_episodes),
            "--log-every", str(log_every),
            "--ppo-epochs", str(ppo_epochs),
            "--eval-gate-every", str(eval_gate_every),
            "--eval-gate-games", str(eval_gate_games),
            "--value-coef", str(value_coef),
            "--save-every", str(save_every),
            "--save", save_path,
            "--training-stage", training_stage,
        ]
        if stage_plan:
            cmd += ["--stage-plan", stage_plan]
        if n_workers > 0:
            cmd += ["--n-workers", str(n_workers)]
        if do_resume and Path(save_path).exists():
            cmd += ["--resume", save_path]
        if mcts_sims > 0:
            cmd += ["--mcts", "--mcts-sims", str(mcts_sims)]

        env, denied_rl_env = _clean_training_subprocess_env()
        # 列出关键 RL_* 调参实际传给训练子进程的值，方便排查"参数没生效"问题
        # （之前白名单只 19 个，restart-openblock.sh 16 个 export 被静默丢弃，
        #  此次改黑名单后默认 deny 仅 6 个搜索开关，其余全透传）
        _key_rl_env_summary = {
            k: env.get(k) for k in (
                "RL_TARGET_KL", "RL_PPO_CLIP", "RL_VALUE_COEF", "RL_VALUE_RETURN_SCALE",
                "RL_ENTROPY_COEF", "RL_ENTROPY_COEF_MIN", "RL_AUX_LOSS_CLIP",
                "RL_BEST_GUARD_REGRESS", "RL_BEST_GUARD_WINDOW", "RL_BEST_GUARD_EVERY",
                "RL_BATCH_SIZE", "RL_GRAD_CLIP", "RL_RETURN_SCALE", "RL_RETURNS_CLIP",
                "RL_KL_REF_COEF", "RL_HIGH_SCORE_REPLAY", "RL_OUTCOME_REF_SCORE",
                "RL_EMPTY_CACHE_EVERY", "RL_REPLAY_MAX_STEPS",
                "RL_AUTO_PERIODIC_RESTART_EVERY", "RL_N_WORKERS", "RL_MP_CONTEXT",
                "PYTORCH_MPS_HIGH_WATERMARK_RATIO", "PYTORCH_MPS_LOW_WATERMARK_RATIO",
            ) if k in env
        }
        env["RL_TRAINING_LOG"] = str(_training_log_path())
        env["RL_TRAINING_PRESET"] = preset
        env["RL_TRAINING_STAGE"] = training_stage
        if stage_plan:
            env["RL_STAGE_PLAN"] = stage_plan
        # 页面训练强调可中断/可重启，BestGuard 窗口比离线长跑更短，
        # 让 checkpoint 尽早保存“近期最好”而不是退化中的最后权重。
        env.setdefault("RL_BEST_GUARD_WINDOW", "80")
        env.setdefault("RL_BEST_GUARD_EVERY", "40")
        # P1：决定性设置每步搜索相关 env，绝不沿用继承自常驻 Flask 进程 os.environ 的脏值。
        # 历史 bug：performance 预设留下的 RL_LOOKAHEAD=0 会泄漏给后续 balanced+MCTS 启动，
        # 而 MCTS/beam 整段都包在 `if use_lookahead:` 内 → use_lookahead=False 时被静默跳过，
        # 表现为 banner 显示「MCTS×N」实则一步搜索都没跑。这里按请求+预设强制覆盖。
        _want_beam = bool(
            data.get("beam3ply")
            or data.get("beam2ply")
            or preset_beam3.get("enabled", False)
            or preset_beam2.get("enabled", False)
        )
        if force_no_lookahead:
            # 纯策略采集（每步一次前向），最大吞吐；瓶颈是纯 Python 模拟器内循环。
            env["RL_MCTS"] = "0"
            env["RL_BEAM3PLY"] = "0"
            env["RL_BEAM2PLY"] = "0"
            env["RL_LOOKAHEAD"] = "0"
        elif mcts_sims > 0:
            # 显式启用 MCTS：必须强制 RL_LOOKAHEAD=1，否则被泄漏的 0 静默禁用整段搜索。
            env["RL_MCTS"] = "1"
            env["RL_LOOKAHEAD"] = "1"
            # P3：MCTS 在 GPU/MPS 上把叶子评估攒批前向，吃满闲置算力。把批量触发阈值
            # 降到本次模拟次数，使中等模拟量（如 quality 默认 12~20）也走 run_mcts_batched。
            try:
                _dev = resolve_training_device(os.environ.get("RL_DEVICE", "auto"))
                if _dev.type in ("cuda", "mps"):
                    env.setdefault("RL_MCTS_BATCH_THRESHOLD", str(max(2, mcts_sims)))
            except Exception:
                pass
        elif _want_beam:
            # 启用 beam 搜索：清掉可能泄漏的 RL_MCTS / RL_BEAM*=0，回落到预设配置。
            env.pop("RL_MCTS", None)
            env.pop("RL_BEAM3PLY", None)
            env.pop("RL_BEAM2PLY", None)
            env["RL_LOOKAHEAD"] = "1"
        else:
            # 无 MCTS、无 beam：纯策略 1 次前向，关闭所有搜索以最大化采集吞吐。
            env.pop("RL_MCTS", None)
            env["RL_BEAM3PLY"] = "0"
            env["RL_BEAM2PLY"] = "0"
            env["RL_LOOKAHEAD"] = "0"

        # performance 预设 = 吞吐优先的轻量热路径，但必须保持「部署保真」：真实出块仍走
        # 在线/构造式（与 web/小程序真实游戏同分布），否则策略会在随机 dock 上过拟合、
        # 上线水土不服且自博弈得分塌方（实测 avg100 从 ~500 跌到 ~130）。
        #   - RL_SUPERVISION=0：仅关掉辅助监督头的每步计算（不改变对局分布，质量影响极小）；
        #   - RL_SPAWN_CHEAP：**重度改变训练分布，默认关闭**，仅在显式传 spawn_cheap=true 时
        #     开启（用于纯吞吐压测/管线验证，不产出可上线模型）。
        if preset == "performance":
            if "supervision" in data:
                env["RL_SUPERVISION"] = "1" if data.get("supervision") else "0"
            else:
                env["RL_SUPERVISION"] = "0"
        # cheap-spawn 为全局显式 opt-in（任何预设均需主动传 spawn_cheap=true 才启用）。
        if "spawn_cheap" in data:
            env["RL_SPAWN_CHEAP"] = "1" if data.get("spawn_cheap") else "0"
        else:
            env.pop("RL_SPAWN_CHEAP", None)
        # 即便启用评估门，也默认关闭双路搜索评估（per-step per-action 子模拟，开销极大），
        # 避免后台训练触发门控时长时间冻结、日志停更。
        if eval_gate_every > 0:
            env.setdefault("RL_EVAL_DUAL", "0")
        if denied_rl_env:
            env["RL_ENV_DENIED_KEYS"] = ",".join(denied_rl_env[:64])

        # P0-C · 把启动 subprocess 抽成可重入函数，monitor 在异常退出时按限速再调
        def _spawn_training_proc() -> subprocess.Popen:
            # cmd 内已含 `--resume <save_path>`（do_resume 计算后写入 cmd 列表），重启自动续训
            log_fd_local = open(str(_ROOT / "logs" / "bg_train.log"), "a")
            return subprocess.Popen(
                cmd,
                cwd=str(_ROOT),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=log_fd_local,
                start_new_session=True,
            )

        def _monitor_process(proc: subprocess.Popen):
            global _bg_train_status
            current_proc = proc
            while True:
                try:
                    _append_training_log({
                        "event": "bg_training_start",
                        "pid": current_proc.pid,
                        "episodes_target": episodes,
                        "mcts_sims": mcts_sims,
                        "n_workers": n_workers,
                        "batch_episodes": batch_episodes,
                        "log_every": log_every,
                        "save_every": save_every,
                        "preset": preset,
                        "value_coef": value_coef,
                        "resume": do_resume,
                        "clean_env": True,
                        # 改名：从「whitelist 之外被丢的」→「denylist 命中被强制覆盖的」
                        "denied_rl_env": denied_rl_env,
                        # 新增：实际生效的关键调参摘要，便于看板验收"我设的 env 是否真传进来"
                        "rl_env_effective": _key_rl_env_summary,
                        "training_stage": training_stage,
                        "stage_plan": stage_plan,
                    })
                    current_proc.wait()
                    rc = current_proc.returncode
                    with _bg_train_lock:
                        if rc == 0:
                            _bg_train_status["error"] = None
                        else:
                            _bg_train_status["error"] = f"进程退出码 {rc}"
                    _append_training_log({
                        "event": "bg_training_end",
                        "pid": current_proc.pid,
                        "exit_code": rc,
                        "reason": "stopped" if rc == -15 or rc == -2 else ("error" if rc != 0 else "completed"),
                    })
                    # 训练结束后重新加载 checkpoint 到在线推理 _state
                    if rc == 0:
                        try:
                            _ensure_initialized()
                            sp = Path(save_path)
                            if sp.exists():
                                loaded = _load_checkpoint_into_model(sp, _state["device"])
                                with _rl_lock:
                                    _state["model"] = loaded["model"]
                                    _state["episodes"] = loaded["episodes"]
                                    _state["meta"] = loaded["meta"]
                        except Exception:
                            pass

                    # P0-C · 异常退出（如 SIGKILL=-9 OOM）按限速自动 resume
                    should_restart, reason = _maybe_auto_resume_training(
                        {"save_path": save_path}, rc
                    )
                    if should_restart:
                        _append_training_log({
                            "event": "bg_training_auto_resume",
                            "previous_pid": current_proc.pid,
                            "previous_exit_code": rc,
                            "reason": reason,
                        })
                        try:
                            time.sleep(2.0)  # 给 OS 一点时间清理 leaked semaphore/shared_memory
                            new_proc = _spawn_training_proc()
                        except Exception as exc:
                            _append_training_log({
                                "event": "bg_training_auto_resume_failed",
                                "error": str(exc),
                            })
                            break
                        # 更新内存 + 落盘状态指向新进程
                        with _bg_train_lock:
                            _bg_train_status["running"] = True
                            _bg_train_status["pid"] = new_proc.pid
                            _bg_train_status["error"] = None
                            _save_bg_state({
                                "pid": new_proc.pid,
                                "episodes_target": episodes,
                                "batch_episodes": batch_episodes,
                                "preset": preset,
                                "training_stage": training_stage,
                                "save_path": save_path,
                                "started_at": int(time.time()),
                            })
                        current_proc = new_proc
                        continue
                    else:
                        if rc != 0:
                            _append_training_log({
                                "event": "bg_training_auto_resume_skipped",
                                "exit_code": rc,
                                "reason": reason,
                            })
                        break
                except Exception as exc:
                    with _bg_train_lock:
                        _bg_train_status["error"] = str(exc)
                    break
            with _bg_train_lock:
                _bg_train_status["running"] = False
            _clear_bg_state()

        try:
            log_fd = open(str(_ROOT / "logs" / "bg_train.log"), "a")
            proc = subprocess.Popen(
                cmd,
                cwd=str(_ROOT),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=log_fd,
                start_new_session=True,
            )
        except Exception as exc:
            return jsonify({"error": f"启动训练进程失败: {exc}"}), 500

        with _bg_train_lock:
            _bg_train_stop_event = None
            _bg_train_status = {
                "running": True,
                "episodes_done": 0,
                "error": None,
                "pid": proc.pid,
                "episodes_target": episodes,
            }
            _save_bg_state({
                "pid": proc.pid,
                "episodes_target": episodes,
                "batch_episodes": batch_episodes,
                "preset": preset,
                "training_stage": training_stage,
                "save_path": save_path,
                "started_at": int(time.time()),
            })
            _bg_train_thread = threading.Thread(
                target=_monitor_process, args=(proc,), daemon=True, name="bg-train-monitor"
            )
            _bg_train_thread.start()

        return jsonify({
            "ok": True,
            "pid": proc.pid,
            "episodes_target": episodes,
            "mcts_sims": mcts_sims,
            "n_workers": n_workers,
            "batch_episodes": batch_episodes,
            "log_every": log_every,
            "preset": preset,
            "training_stage": training_stage,
        })

    @bp.route("/api/rl/stop_training", methods=["POST"])
    def rl_stop_training():
        """停止后台训练子进程（SIGINT → 等待 → SIGKILL）。"""
        import signal as _signal
        with _bg_train_lock:
            # 先从磁盘恢复，确保 Flask 重启后仍能停止之前启动的训练进程
            _hydrate_bg_status_from_disk_locked()
            pid = _bg_train_status.get("pid")
            if not _bg_train_status["running"] and not _pid_alive(pid):
                _clear_bg_state()
                return jsonify({"ok": True, "message": "当前没有运行中的训练"})
        if pid:
            try:
                os.killpg(os.getpgid(pid), _signal.SIGINT)
            except (ProcessLookupError, PermissionError):
                try:
                    os.kill(pid, _signal.SIGINT)
                except ProcessLookupError:
                    pass

            def _ensure_killed():
                time.sleep(6)
                try:
                    os.kill(pid, 0)
                    os.killpg(os.getpgid(pid), _signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    try:
                        os.kill(pid, _signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                # 进程已确定停止：清理内存与磁盘状态（恢复的孤儿没有 monitor 线程兜底）
                with _bg_train_lock:
                    _bg_train_status["running"] = False
                _clear_bg_state()

            threading.Thread(target=_ensure_killed, daemon=True).start()
        return jsonify({"ok": True, "message": "已发送停止信号"})

    @bp.route("/api/rl/training_status", methods=["GET"])
    def rl_training_status():
        """查询后台训练状态（通过进程存活检测）。"""
        return jsonify(_get_bg_training_info())

    return bp


def register_rl_routes(app):
    """在 Flask app 上注册 RL 蓝图。"""
    app.register_blueprint(create_rl_blueprint())
