"""Spawn Tuning v2 异步训练任务执行器。

设计:
  - 后台线程轮询 training_jobs 表 (status='queued') 拿任务
  - 用 subprocess.Popen 启动 train.py (隔离进程, 一个崩不影响其他)
  - 实时把 stdout/stderr tail 到 jobs.log_path 文件
  - 解析每行 [train_v2] / JSONL 日志 → 更新 jobs 表的 metrics 字段
  - 子进程结束 → 写 status='done' (or 'failed') + 写 models 表

并发: 单 worker 串行执行 (避免争 SQLite + GPU)
  - 多机器并发可后续接 Celery / Redis Queue

启动:
  在 spawn_tuning_v2_backend.register_v2_routes() 末尾调 start_job_executor()
  worker 是 daemon thread, 跟随主进程退出

CLI 独立运行 (调试用):
    python -m rl_pytorch.spawn_tuning_v2.job_executor \
        --db .cursor-stress-logs/spawn-tuning-v2.sqlite
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional


# ─────────── 配置 ───────────

POLL_INTERVAL_S = 3.0          # 轮询间隔
TRAIN_PYTHON = sys.executable or "python3"
TRAIN_MODULE = "rl_pytorch.spawn_tuning_v2.train"
CHECKPOINTS_DIR = Path(os.environ.get("SPAWN_TUNING_V2_CHECKPOINTS", "checkpoints/v2"))
LOGS_DIR = Path(os.environ.get("SPAWN_TUNING_V2_LOGS", ".cursor-stress-logs/spawn-tuning-v2-jobs"))

# v2.8.4: 运行中 subprocess 注册表 — 让 backend DELETE endpoint 能 kill 进程
# 键 = job_id, 值 = subprocess.Popen
_RUNNING_PROCS: dict[int, "subprocess.Popen"] = {}
_registry_lock = threading.Lock()


def kill_job(job_id: int, timeout: float = 3.0) -> dict:
    """SIGTERM 该 job 的训练子进程, 超时未停则 SIGKILL。

    Returns:
      {ok: bool, action: "sigterm"/"sigkill"/"not_running", exit_code: ...}
    """
    with _registry_lock:
        proc = _RUNNING_PROCS.get(job_id)
    if proc is None:
        return {"ok": False, "action": "not_running", "msg": f"job {job_id} not in running registry"}
    if proc.poll() is not None:
        # 已自然结束
        with _registry_lock:
            _RUNNING_PROCS.pop(job_id, None)
        return {"ok": True, "action": "already_exited", "exit_code": proc.returncode}

    # SIGTERM
    try:
        proc.terminate()
    except Exception as e:
        return {"ok": False, "action": "sigterm_failed", "msg": str(e)}

    # 等待 timeout 秒
    try:
        proc.wait(timeout=timeout)
        with _registry_lock:
            _RUNNING_PROCS.pop(job_id, None)
        return {"ok": True, "action": "sigterm", "exit_code": proc.returncode}
    except subprocess.TimeoutExpired:
        pass

    # 强 SIGKILL
    try:
        proc.kill()
        proc.wait(timeout=2.0)
        with _registry_lock:
            _RUNNING_PROCS.pop(job_id, None)
        return {"ok": True, "action": "sigkill", "exit_code": proc.returncode}
    except Exception as e:
        return {"ok": False, "action": "sigkill_failed", "msg": str(e)}


def _ensure_dirs():
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


# ─────────── 单 job 执行 ───────────

def _claim_one_job(db_path: str) -> Optional[dict]:
    """从 queued 任务里挑一个, 原子地标 running。

    v2.9.3: 用 IMMEDIATE 而非 EXCLUSIVE — IMMEDIATE 仅在写时排他,
    EXCLUSIVE 连读都阻塞, 跟 backend Flask 请求容易死锁。
    """
    conn = sqlite3.connect(db_path, isolation_level="IMMEDIATE", timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM training_jobs WHERE status = 'queued' "
            "ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
        if not row:
            conn.commit()
            return None
        job_id = row["job_id"]
        conn.execute(
            "UPDATE training_jobs SET status = 'running', started_at = ? WHERE job_id = ?",
            (int(time.time()), job_id),
        )
        conn.commit()
        return dict(row)
    finally:
        conn.close()


def _build_train_cmd(job: dict, output_path: Path, log_path: Path, db_path: str) -> list[str]:
    """根据 job 配置组装 train.py CLI 命令。"""
    arch = json.loads(job.get("arch_json") or "{}")
    sample_set_ids = job.get("sample_set_ids") or "[]"
    if isinstance(sample_set_ids, str):
        try:
            sample_set_ids = json.loads(sample_set_ids)
        except Exception:
            sample_set_ids = []
    # v2.9: model_type 从 jobs.model_type 列读 (job dict) 或 arch.model_type fallback
    model_type = job.get("model_type") or arch.get("model_type") or "resnet"
    cmd = [
        TRAIN_PYTHON, "-u", "-m", TRAIN_MODULE,
        "--db", db_path,
        "--sample-sets", ",".join(str(x) for x in sample_set_ids),
        "--output", str(output_path),
        "--epochs", str(arch.get("epochs", 50)),
        "--batch-size", str(arch.get("batch_size", 256)),
        "--lr", str(arch.get("lr", 1e-3)),
        "--device", arch.get("device", "cpu"),
        "--model-type", str(model_type),
    ]
    # G10 v2.10.9: 模型超参透传
    if model_type == "transformer":
        if "d_model" in arch:  cmd.extend(["--d-model", str(arch["d_model"])])
        if "n_layers" in arch: cmd.extend(["--n-layers", str(arch["n_layers"])])
    else:
        if "hidden_dim" in arch: cmd.extend(["--hidden-dim", str(arch["hidden_dim"])])
        if "n_blocks" in arch:   cmd.extend(["--n-blocks", str(arch["n_blocks"])])
    if job.get("base_model_id"):
        # base_model_id → 查 weights_path
        conn = sqlite3.connect(db_path)
        r = conn.execute(
            "SELECT weights_path FROM models WHERE model_id = ?",
            (job["base_model_id"],),
        ).fetchone()
        conn.close()
        if r and r[0]:
            cmd.extend(["--base-model", r[0]])
    return cmd


def _update_job_metrics(db_path: str, job_id: int, **updates):
    """v2.9.3: 加 timeout=10s + 内部 try/except, 避免 db locked 把 worker_loop 抛出去
    导致后续无限重试刷错日志。"""
    if not updates:
        return
    cols = ", ".join(f"{k} = ?" for k in updates)
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        try:
            conn.execute(
                f"UPDATE training_jobs SET {cols} WHERE job_id = ?",
                list(updates.values()) + [job_id],
            )
            conn.commit()
        finally:
            conn.close()
    except sqlite3.OperationalError as e:
        # db locked / busy → 仅打 warning, 下一轮轮询会再尝试
        print(f"[job_executor] warn: _update_job_metrics({job_id}) skipped: {e}")


def _parse_log_line(line: str) -> Optional[dict]:
    """解析 train.py 输出的 JSONL 行 (从 .log 文件)。

    返回 None 的情况:
      - 空行 / 非 JSON
      - batch-level 行 (type=batch, 不更新 jobs 表的 epoch metrics)
      - 缺少 epoch 字段
    返回 epoch-end record dict 用于更新 jobs 表。
    """
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        d = json.loads(line)
        # 跳过 batch-level 行 (它们只有 train_loss_batch, 不更新 epochs_done)
        if d.get("type") == "batch":
            return None
        if "epoch" not in d or "train_loss" not in d:
            return None
        return d
    except Exception:
        return None


def _execute_job(job: dict, db_path: str):
    """串行跑一个 job: 启动 subprocess → 监控 → 写结果。"""
    job_id = job["job_id"]
    job_name = job.get("name") or f"job-{job_id}"

    _ensure_dirs()
    output_path = CHECKPOINTS_DIR / f"job_{job_id}_{int(time.time())}.pt"
    log_path = LOGS_DIR / f"job_{job_id}.log"
    train_jsonl_path = Path(str(output_path) + ".log")  # train.py 写的 JSONL

    _update_job_metrics(db_path, job_id, log_path=str(log_path))

    cmd = _build_train_cmd(job, output_path, log_path, db_path)
    log_fp = open(log_path, "w", encoding="utf-8", buffering=1)
    log_fp.write(f"[job_executor] cmd: {' '.join(cmd)}\n")

    try:
        proc = subprocess.Popen(
            cmd, stdout=log_fp, stderr=subprocess.STDOUT,
            cwd=os.getcwd(),
        )
    except Exception as e:
        log_fp.write(f"[job_executor] spawn failed: {e}\n")
        log_fp.close()
        _update_job_metrics(
            db_path, job_id,
            status="failed",
            error_message=f"spawn failed: {e}",
            completed_at=int(time.time()),
        )
        return

    # v2.8.4: 注册到全局 process registry, 让 backend DELETE endpoint 能 kill 它
    with _registry_lock:
        _RUNNING_PROCS[job_id] = proc

    # 监控 (轮询 jsonl + proc.poll)
    last_jsonl_size = 0
    while True:
        rc = proc.poll()
        # 增量读 JSONL 更新 metrics
        if train_jsonl_path.exists():
            try:
                with open(train_jsonl_path, "rb") as f:
                    f.seek(last_jsonl_size)
                    chunk = f.read()
                    last_jsonl_size += len(chunk)
                if chunk:
                    for line in chunk.decode("utf-8", errors="ignore").splitlines():
                        d = _parse_log_line(line)
                        if d:
                            _update_job_metrics(
                                db_path, job_id,
                                epochs_done=d.get("epoch", 0) + 1,
                                train_loss=d.get("train_loss"),
                                val_loss=d.get("val_loss"),
                                val_curve_mae=d.get("val_curve_mae"),
                                val_balance=d.get("val_balance"),
                                val_surprise_rate=d.get("val_surprise"),
                                val_breaking=d.get("val_breaking"),
                            )
            except Exception:
                pass
        if rc is not None:
            break
        time.sleep(2.0)

    log_fp.close()

    # v2.8.4: 从 registry 移除 — 进程已结束 (正常 / 被 kill / 异常)
    with _registry_lock:
        _RUNNING_PROCS.pop(job_id, None)

    # 收尾
    completed_at = int(time.time())
    if rc == 0 and output_path.exists():
        # 写 models 表
        weights = output_path.read_bytes()
        sha = hashlib.sha256(weights).hexdigest()

        # v2.9.2: 优先读 sidecar JSON (train.py 写的 .pt.meta.json),
        #         避免在 daemon thread 内 import torch + load mps ckpt 时死锁。
        #         实测 job_16 卡在 torch.load 上, 持着 SQLite EXCLUSIVE 锁,
        #         导致整个 backend 写操作 hang 数分钟。
        metrics = _read_metrics_sidecar(output_path)

        try:
            conn = sqlite3.connect(db_path, timeout=10.0)
            try:
                cur = conn.execute(
                    """INSERT INTO models (
                        name, version, model_type, weights_path, sha256, size_bytes,
                        parent_model_id, train_job_id, metrics_json, status, tags, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?)""",
                    (
                        job_name, "v0.0.1", job.get("model_type", "resnet"),
                        str(output_path), sha, len(weights),
                        job.get("base_model_id"), job_id,
                        json.dumps(metrics), "", completed_at,
                    ),
                )
                model_id = cur.lastrowid
                conn.execute(
                    "UPDATE training_jobs SET status='done', completed_at=?, output_model_id=? WHERE job_id=?",
                    (completed_at, model_id, job_id),
                )
                conn.commit()
            finally:
                conn.close()
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"[job_executor] ✓ done, model_id={model_id}\n")
        except sqlite3.IntegrityError as e:
            # CHECK / FK 约束失败 — 让 job 进 failed 状态, 至少不卡 running
            _update_job_metrics(
                db_path, job_id,
                status="failed",
                error_message=f"models insert failed: {e}",
                completed_at=completed_at,
            )
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"[job_executor] ✗ models insert failed: {e}\n")
        except Exception as e:
            _update_job_metrics(
                db_path, job_id,
                status="failed",
                error_message=f"db write failed: {e}",
                completed_at=completed_at,
            )
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"[job_executor] ✗ db write failed: {e}\n")
    else:
        _update_job_metrics(
            db_path, job_id,
            status="failed",
            error_message=f"subprocess exit code {rc}",
            completed_at=completed_at,
        )
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[job_executor] ✗ failed, rc={rc}\n")


def _read_metrics_sidecar(ckpt_path: Path) -> dict:
    """v2.9.2: 从 .pt.meta.json sidecar 读 metrics, 不依赖 torch。

    train.py _save_checkpoint 在写 .pt 时同步写 sidecar JSON;
    如果 sidecar 不存在 (老 ckpt / 写失败), fallback 到从 .pt.log JSONL 末尾推算。
    """
    sidecar = ckpt_path.with_suffix(ckpt_path.suffix + ".meta.json")
    if sidecar.exists():
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
            return dict(data.get("metrics") or {})
        except Exception:
            pass
    # fallback: 扫 train JSONL 找最佳 val_curve_mae
    jsonl = Path(str(ckpt_path) + ".log")
    if jsonl.exists():
        try:
            best = None
            with open(jsonl, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or '"type": "epoch"' not in line:
                        continue
                    d = json.loads(line)
                    if best is None or d.get("val_curve_mae", 1e9) < best.get("val_curve_mae", 1e9):
                        best = d
            if best is not None:
                best["best_epoch"] = best.get("epoch")
                return {k: v for k, v in best.items() if k not in ("type", "step")}
        except Exception:
            pass
    return {}


# ─────────── 后台线程 ───────────

_executor_thread: Optional[threading.Thread] = None
_executor_stop = threading.Event()


def _worker_loop(db_path: str):
    """后台 worker 主循环。

    v2.9.3: 错误退避 (exponential backoff) — db locked 等重复错误不再每 3 秒刷一次,
    而是 3s → 6s → 12s → 24s → 60s (cap), 减少日志噪声。
    """
    print(f"[job_executor] started, db={db_path}, poll={POLL_INTERVAL_S}s")
    error_wait = POLL_INTERVAL_S
    last_error_msg = ""
    while not _executor_stop.is_set():
        try:
            job = _claim_one_job(db_path)
            error_wait = POLL_INTERVAL_S  # 成功 claim, 重置退避
            last_error_msg = ""
            if job:
                print(f"[job_executor] picked job_id={job['job_id']} name={job.get('name')}")
                try:
                    _execute_job(job, db_path)
                except Exception as e:
                    print(f"[job_executor] error executing job {job['job_id']}: {e}")
                    _update_job_metrics(
                        db_path, job["job_id"],
                        status="failed",
                        error_message=str(e),
                        completed_at=int(time.time()),
                    )
            else:
                _executor_stop.wait(POLL_INTERVAL_S)
        except Exception as e:
            msg = str(e)
            # 重复同样的错误只打第一次, 减少日志噪声
            if msg != last_error_msg:
                print(f"[job_executor] loop error: {msg} (backing off to {error_wait:.1f}s)")
                last_error_msg = msg
            _executor_stop.wait(error_wait)
            # exponential backoff, cap 60s
            error_wait = min(error_wait * 2, 60.0)
    print("[job_executor] stopped")


def start_job_executor(db_path: str):
    """启动后台 worker。多次调用幂等。"""
    global _executor_thread
    if _executor_thread and _executor_thread.is_alive():
        return False
    _executor_stop.clear()
    _executor_thread = threading.Thread(
        target=_worker_loop, args=(db_path,),
        name="spawn-tuning-v2-job-executor", daemon=True,
    )
    _executor_thread.start()
    return True


def stop_job_executor(timeout: float = 5.0):
    """停止 worker (用于测试 + 优雅关闭)。"""
    _executor_stop.set()
    if _executor_thread:
        _executor_thread.join(timeout=timeout)


# ─────────── CLI ───────────

def main():
    p = argparse.ArgumentParser(description="Spawn Tuning v2 异步 job 执行器")
    p.add_argument("--db", required=True)
    p.add_argument("--once", action="store_true", help="只跑一个 queued job 后退出 (调试)")
    args = p.parse_args()

    if args.once:
        job = _claim_one_job(args.db)
        if not job:
            print("[job_executor] no queued jobs")
            return
        _execute_job(job, args.db)
        return

    start_job_executor(args.db)
    try:
        # 阻塞主线程, 等 SIGINT
        signal.pause()
    except (KeyboardInterrupt, AttributeError):
        # AttributeError: Windows 没 signal.pause
        try:
            while _executor_thread and _executor_thread.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    stop_job_executor()


if __name__ == "__main__":
    main()
