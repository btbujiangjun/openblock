"""
Flask 路由：对接 rl_pytorch 策略网络，供浏览器自博弈「热启动 + 持续学习」。

环境变量（可选）:
  RL_CHECKPOINT       显式指定要加载的 .pt；若文件不存在则回退自动加载逻辑
  RL_CHECKPOINT_SAVE  定期保存与「自动热加载」的默认路径，默认 rl_checkpoints/bb_policy.pt
  RL_AUTOLOAD         默认 1：未显式指定 RL_CHECKPOINT 时，若 RL_CHECKPOINT_SAVE 存在则加载（续训）
  RL_TRAINING_LOG     训练 JSONL 日志路径，默认 rl_checkpoints/training.jsonl
  RL_DEVICE           auto | mps | cuda | cpu（auto 在 macOS 上优先 MPS）
  RL_LR               Adam 学习率，默认 1.5e-4（较稳；可用 3e-4 加速）
  RL_GAMMA            折扣因子，默认 0.99
  RL_VALUE_COEF       价值损失权重，默认 0.18（缓和 value 尖峰对总梯度的占比）
  RL_VALUE_HUBER_BETA smooth_l1 的 beta，默认 150（回报尺度大时压低 loss_value 数值尖峰）
  RL_ENTROPY_COEF     策略熵 bonus 系数（越大越敢探索），默认 0.015；设 0 关闭
  RL_ENTROPY_COEF_MIN 熵系数线性衰减下限（配合 RL_ENTROPY_DECAY_EPISODES），默认 0.004
  RL_ENTROPY_DECAY_EPISODES  从 RL_ENTROPY_COEF 线性降到 MIN 的局数，默认 12000；设 0 关闭衰减
  RL_RETURN_SCALE     蒙特卡洛回报缩放（仅训练用），默认 0.025，使 V(s) 与 smooth_l1 更稳；设 1 关闭
  RL_ADV_NORM         设为 1 时对每局 advantage 做零均值单位方差（REINFORCE 更稳），默认 1
  RL_ADV_MIN_STD      低于该标准差时不做去均值标准化（避免短局/平坦 V 时整段 A≈0 无策略梯度），默认 1e-4
  RL_GRAD_CLIP        梯度裁剪范数，默认 1.0
  RL_SAVE_EVERY       每训练 N 局落盘 checkpoint，默认 500（减少磁盘 I/O 利于提速）
  RL_MPS_SYNC         设为 1 时训练步后对 MPS 同步（多线程下更稳，**默认关闭**以利 M4/MPS 吞吐）
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
    return torch.nan_to_num(logits, nan=0.0, posinf=80.0, neginf=-80.0)


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
    """随全局局数线性降低熵奖励，减轻后期仍高探索、难收敛的问题。"""
    base = float(os.environ.get("RL_ENTROPY_COEF", "0.015"))
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.004"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "12000"))
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

    from rl_pytorch.device import (
        adam_for_training,
        apply_throughput_tuning,
        maybe_mps_synchronize,
        resolve_training_device,
        tensor_to_device,
    )
    from rl_pytorch.model import PolicyValueNet, SharedPolicyValueNet
except ImportError as e:
    torch = None
    resolve_training_device = None  # type: ignore
    tensor_to_device = None  # type: ignore
    maybe_mps_synchronize = None  # type: ignore
    _state["error"] = f"import failed: {e}"


def _default_meta():
    return {
        "width": int(os.environ.get("RL_WIDTH", "384")),
        "policy_depth": int(os.environ.get("RL_POLICY_DEPTH", "6")),
        "value_depth": int(os.environ.get("RL_VALUE_DEPTH", "5")),
        "mlp_ratio": float(os.environ.get("RL_MLP_RATIO", "2.0")),
        "arch": os.environ.get("RL_ARCH", "split"),
    }


def _build_model(meta: dict):
    d = _default_meta()
    arch = str(meta.get("arch", d["arch"]))
    width = int(meta.get("width", d["width"]))
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
    model.load_state_dict(ckpt["model"])
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
        _state["device"] = device
        save_path = Path(os.environ.get("RL_CHECKPOINT_SAVE", DEFAULT_CKPT_NAME))
        _state["save_path"] = save_path
        _, load_path = _resolve_checkpoint_paths(save_path)

        lr = float(os.environ.get("RL_LR", "1.5e-4"))
        if load_path is not None:
            loaded = _load_checkpoint_into_model(load_path, device)
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
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
    path = _state["save_path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    device = _state["device"]
    payload = {
        "model": _state["model"].state_dict(),
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
          steps: [{ phi: number[][], state: number[] (ψ), idx: number, reward: number }],
          gamma?: number, value_coef?: number
        }
        未传的 gamma/value_coef 等由环境变量 RL_* 决定（见文件头注释）。
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
        value_coef = float(data.get("value_coef", os.environ.get("RL_VALUE_COEF", "0.18")))
        value_huber_beta = float(os.environ.get("RL_VALUE_HUBER_BETA", "150"))
        return_scale = float(os.environ.get("RL_RETURN_SCALE", "0.025"))
        adv_norm = os.environ.get("RL_ADV_NORM", "1").lower() not in ("0", "false", "no", "")
        adv_min_std = float(os.environ.get("RL_ADV_MIN_STD", "1e-4"))
        grad_clip = float(os.environ.get("RL_GRAD_CLIP", "1.0"))

        with _rl_lock:
            model = _state["model"]
            device = _state["device"]
            opt = _state["optimizer"]

            rewards = [float(s["reward"]) for s in steps]
            tlen = len(rewards)
            if tlen == 0:
                return jsonify({"ok": True, "episodes": _state["episodes"], "skipped": True})

            returns = []
            g = 0.0
            for r in reversed(rewards):
                g = r + gamma * g
                returns.insert(0, g)
            returns_t = torch.tensor(returns, dtype=torch.float32, device=device)
            returns_t = torch.nan_to_num(returns_t, nan=0.0, posinf=1e5, neginf=-1e5)
            returns_t = torch.clamp(returns_t, -1e5, 1e5)
            if return_scale != 1.0:
                returns_t = returns_t * return_scale

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
            loss = policy_loss + value_coef * value_loss - entropy_coef_eff * entropy_mean

            model.train()
            opt.zero_grad()
            stepped = bool(torch.isfinite(loss).item())
            if stepped:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max(grad_clip, 1e-8))
                opt.step()
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
                "loss_policy": _log_float(policy_loss),
                "loss_value": _log_float(value_loss),
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
                    "loss_policy": _log_float(policy_loss),
                    "loss_value": _log_float(value_loss),
                    "entropy": _log_float(entropy_mean),
                    "optimizer_step": stepped,
                }
            )

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
            loaded = _load_checkpoint_into_model(Path(path), device)
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
            _state["checkpoint_loaded"] = str(Path(path).resolve())
            lr = float(os.environ.get("RL_LR", "1.5e-4"))
            _state["optimizer"] = torch.optim.Adam(_state["model"].parameters(), lr=lr)
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
