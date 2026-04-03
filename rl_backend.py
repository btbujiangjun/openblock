"""
Flask 路由：对接 rl_pytorch 策略网络，供浏览器自博弈「热启动 + 持续学习」。

环境变量（可选）:
  RL_CHECKPOINT       启动时加载的 .pt 路径（热启动）
  RL_CHECKPOINT_SAVE  持续学习时保存路径，默认与 RL_CHECKPOINT 或 ./rl_checkpoints/bb_policy.pt
  RL_DEVICE           auto | mps | cuda | cpu
  RL_LR               Adam 学习率，默认 3e-4
  RL_SAVE_EVERY       每训练 N 局落盘，默认 10
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_rl_lock = threading.Lock()
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

try:
    import torch
    import torch.nn.functional as F
    from torch.distributions import Categorical

    from rl_pytorch.model import PolicyValueNet
except ImportError as e:
    torch = None
    _state["error"] = f"import failed: {e}"


def _resolve_device(pref: str):
    if torch is None:
        raise RuntimeError("torch 未安装")
    pref = (pref or "auto").lower().strip()
    if pref == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is not None and mps_b.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if pref == "cuda":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if pref == "mps":
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is None or not mps_b.is_available():
            return torch.device("cpu")
        return torch.device("mps")
    return torch.device("cpu")


def _default_meta():
    return {
        "width": int(os.environ.get("RL_WIDTH", "256")),
        "policy_depth": int(os.environ.get("RL_POLICY_DEPTH", "4")),
        "value_depth": int(os.environ.get("RL_VALUE_DEPTH", "4")),
        "mlp_ratio": float(os.environ.get("RL_MLP_RATIO", "2.0")),
    }


def _build_model(meta: dict) -> PolicyValueNet:
    return PolicyValueNet(
        width=meta.get("width", 256),
        policy_depth=meta.get("policy_depth", 4),
        value_depth=meta.get("value_depth", 4),
        mlp_ratio=meta.get("mlp_ratio", 2.0),
    )


def _load_checkpoint_into_model(path: Path, device: torch.device) -> dict:
    try:
        ckpt = torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        ckpt = torch.load(path, map_location=device)
    meta = ckpt.get("meta") or {}
    arch = {**_default_meta(), **{k: meta[k] for k in ("width", "policy_depth", "value_depth", "mlp_ratio") if k in meta}}
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
        device = _resolve_device(os.environ.get("RL_DEVICE", "auto"))
        _state["device"] = device
        ck_env = os.environ.get("RL_CHECKPOINT", "").strip()
        save_default = Path(os.environ.get("RL_CHECKPOINT_SAVE", "rl_checkpoints/bb_policy.pt"))
        _state["save_path"] = Path(ck_env) if ck_env else save_default

        lr = float(os.environ.get("RL_LR", "3e-4"))
        if ck_env and Path(ck_env).is_file():
            loaded = _load_checkpoint_into_model(Path(ck_env), device)
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
            _state["checkpoint_loaded"] = str(Path(ck_env).resolve())
            _state["optimizer"] = torch.optim.Adam(_state["model"].parameters(), lr=lr)
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
            _state["optimizer"] = torch.optim.Adam(_state["model"].parameters(), lr=lr)


def _save_checkpoint():
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
                "meta": _state["meta"],
            }
        )

    @bp.route("/api/rl/select_action", methods=["POST"])
    def rl_select_action():
        """body: { phi: number[][], state: number[15], temperature: number } -> { index: int }"""
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
            phi_t = torch.tensor(phi, dtype=torch.float32, device=device)
            model.eval()
            with torch.no_grad():
                logits = model.forward_policy_logits(phi_t)
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
          steps: [{ phi: number[][], state: number[15], idx: number, reward: number }],
          gamma?: number, value_coef?: number
        }
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
        gamma = float(data.get("gamma", 0.99))
        value_coef = float(data.get("value_coef", 0.5))

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

            log_probs_list = []
            values_list = []
            for i, st in enumerate(steps):
                phi_t = torch.tensor(st["phi"], dtype=torch.float32, device=device)
                s_t = torch.tensor(st["state"], dtype=torch.float32, device=device).unsqueeze(0)
                idx = int(st["idx"])
                logits = model.forward_policy_logits(phi_t)
                log_probs = torch.log_softmax(logits, dim=0)
                log_p = log_probs[idx]
                v = model.forward_value(s_t).squeeze(0)
                log_probs_list.append(log_p)
                values_list.append(v)

            log_probs_t = torch.stack(log_probs_list, dim=0)
            values = torch.stack(values_list, dim=0)
            adv = returns_t - values.detach()
            policy_loss = -(log_probs_t * adv).mean()
            value_loss = F.mse_loss(values, returns_t)
            loss = policy_loss + value_coef * value_loss

            model.train()
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            _state["episodes"] += 1
            ep = _state["episodes"]

            save_every = max(1, int(os.environ.get("RL_SAVE_EVERY", "10")))
            if ep % save_every == 0:
                _save_checkpoint()

            return jsonify(
                {
                    "ok": True,
                    "episodes": ep,
                    "loss_policy": float(policy_loss.item()),
                    "loss_value": float(value_loss.item()),
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
            _save_checkpoint()
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
            device = _state["device"] or _resolve_device(os.environ.get("RL_DEVICE", "auto"))
            _state["device"] = device
            loaded = _load_checkpoint_into_model(Path(path), device)
            _state["model"] = loaded["model"]
            _state["episodes"] = loaded["episodes"]
            _state["meta"] = loaded["meta"]
            _state["checkpoint_loaded"] = str(Path(path).resolve())
            lr = float(os.environ.get("RL_LR", "3e-4"))
            _state["optimizer"] = torch.optim.Adam(_state["model"].parameters(), lr=lr)
            osh = loaded.get("optimizer_state")
            if osh:
                try:
                    _state["optimizer"].load_state_dict(osh)
                except Exception:
                    pass
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
