"""通过 Node worker 调用线上 adaptiveSpawn + blockSpawn 出块。"""

from __future__ import annotations

import json
import math
import os
import subprocess
import threading
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_WORKER = _ROOT / "scripts" / "rl-spawn-worker.mjs"

_warned_legacy = False
_lock = threading.Lock()
_proc: subprocess.Popen | None = None
_stats_lock = threading.Lock()
_stats = {
    "requests": 0,
    "ok": 0,
    "failures": 0,
    "latency_ms_total": 0.0,
    "latency_ms_max": 0.0,
    "legacy_fallbacks": 0,
}


def reset_spawn_stats() -> None:
    """重置本进程 online spawn 统计；用于按 episode 聚合 worker 指标。"""
    with _stats_lock:
        for k in _stats:
            _stats[k] = 0.0 if k.startswith("latency") else 0


def get_spawn_stats(reset: bool = False) -> dict:
    """返回本进程 online spawn 健康指标（多进程下由 ep_data 带回主进程聚合）。"""
    with _stats_lock:
        out = dict(_stats)
        req = int(out.get("requests", 0) or 0)
        out["latency_ms_avg"] = float(out.get("latency_ms_total", 0.0)) / max(req, 1)
        if reset:
            for k in _stats:
                _stats[k] = 0.0 if k.startswith("latency") else 0
        return out


def _record_spawn_request(dt_ms: float, ok: bool) -> None:
    with _stats_lock:
        _stats["requests"] = int(_stats["requests"]) + 1
        if ok:
            _stats["ok"] = int(_stats["ok"]) + 1
        else:
            _stats["failures"] = int(_stats["failures"]) + 1
        _stats["latency_ms_total"] = float(_stats["latency_ms_total"]) + float(dt_ms)
        _stats["latency_ms_max"] = max(float(_stats["latency_ms_max"]), float(dt_ms))


def record_legacy_fallback() -> None:
    with _stats_lock:
        _stats["legacy_fallbacks"] = int(_stats["legacy_fallbacks"]) + 1


def spawn_online_enabled() -> bool:
    if os.environ.get("RL_SPAWN_ONLINE", "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    if os.environ.get("RL_SPAWN_LEGACY", "").strip().lower() in ("1", "true", "yes", "on"):
        return False
    return _WORKER.is_file()


def _ensure_worker() -> subprocess.Popen:
    global _proc
    with _lock:
        if _proc is not None and _proc.poll() is None:
            return _proc
        _proc = subprocess.Popen(
            ["node", str(_WORKER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(_ROOT),
            env={**os.environ, "NODE_NO_WARNINGS": "1"},
        )
        return _proc


def _json_sanitize(obj):
    if isinstance(obj, float):
        if math.isinf(obj):
            return 1e30 if obj > 0 else -1e30
        if math.isnan(obj):
            return None
    if isinstance(obj, dict):
        return {k: _json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_sanitize(v) for v in obj]
    return obj


def spawn_dock_online(snapshot: dict) -> dict:
    """调用 web 同源出块；失败时抛出 RuntimeError。"""
    t0 = time.perf_counter()
    ok = False
    proc = _ensure_worker()
    try:
        safe = _json_sanitize(snapshot)
        line = json.dumps({"op": "spawn", "snapshot": safe}, ensure_ascii=False) + "\n"
        with _lock:
            if proc.stdin is None or proc.stdout is None:
                raise RuntimeError("rl-spawn-worker stdin/stdout unavailable")
            proc.stdin.write(line)
            proc.stdin.flush()
            # 协议规定一行 JSON 一条响应；跳过启动期可能混入 stdout 的空行/非 JSON 行，
            # 直到读到以 '{' 开头的响应行，避免单条脏行触发 JSONDecodeError 并造成请求/响应错位。
            resp = None
            for _ in range(64):
                out_line = proc.stdout.readline()
                if not out_line:
                    raise RuntimeError("rl-spawn-worker closed stdout")
                stripped = out_line.strip()
                if not stripped or stripped[0] != "{":
                    continue
                try:
                    resp = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                break
        if resp is None:
            raise RuntimeError("rl-spawn-worker no JSON response")
        if not resp.get("ok"):
            raise RuntimeError(resp.get("error") or "spawn worker error")
        ok = True
        return resp
    finally:
        _record_spawn_request((time.perf_counter() - t0) * 1000.0, ok)


def warn_legacy_fallback_once(exc: Exception | None = None) -> None:
    global _warned_legacy
    record_legacy_fallback()
    if _warned_legacy:
        return
    _warned_legacy = True
    import sys

    reason = f"（原因: {type(exc).__name__}: {exc}）" if exc is not None else ""
    print(
        "[rl_pytorch] RL_SPAWN_ONLINE disabled or node worker unavailable; "
        f"using legacy block_spawn.py{reason}",
        file=sys.stderr,
    )
