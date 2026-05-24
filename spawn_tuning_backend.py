"""
Spawn Tuning PyTorch 后端 API — 把 NN 代理训练 (Phase B/C/D) 暴露给浏览器。

参考 rl_backend.py 模式:
    - 独立模块,通过 register_spawn_tuning_routes(app) 注册到主 Flask app
    - 失败 import 不阻塞 server 启动 (torch 不装也能跑评估)
    - 异步子进程跑 Python 训练脚本,通过 job_id 跟踪状态

API 路由 (前缀 /api/spawn-tuning/v2/torch/*):
    GET  /torch/status              检查 torch 可用性 + 显示当前 jobs + checkpoints
    POST /torch/train               启动 Phase B (训 NN 代理)
    POST /torch/optimize            启动 Phase C (梯度上升找 120 contexts θ*)
    POST /torch/active-sample       启动 Phase D (主动学习采样,生成任务清单)
    GET  /torch/jobs                列出最近 jobs
    GET  /torch/jobs/<job_id>       查询单 job 状态 + 日志 tail
    POST /torch/jobs/<job_id>/cancel  取消运行中 job (SIGTERM)
    GET  /torch/checkpoints         列出可用 checkpoint
    POST /torch/policies/load-and-deploy  从 policies.json 文件加载并部署

设计取舍:
    - 子进程 stdout 重定向到日志文件,客户端轮询 tail 显示
    - job 元数据存内存 (重启 server 会丢);policies/checkpoint 落盘持久
    - 不引入 celery/redis 等重度依赖,subprocess.Popen 足够
"""

import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, request

# === 全局状态 ===
_active_jobs: Dict[str, Dict[str, Any]] = {}  # job_id -> {process, started_at, log_file, kind, ...}

_DEFAULT_CHECKPOINTS_DIR = Path(os.environ.get("SPAWN_TUNING_CHECKPOINTS", "checkpoints"))
_DEFAULT_LOGS_DIR = Path(os.environ.get("SPAWN_TUNING_LOGS", ".cursor-stress-logs/spawn-tuning-jobs"))
_DEFAULT_DB_PATH = Path(os.environ.get("SPAWN_TUNING_DB", ".cursor-stress-logs/spawn-tuning.sqlite"))

# 离线 bundle 目标路径 (Vite 会把 web/public/* 原样拷贝到 dist/, Capacitor 再带进 APK/IPA)
_DEFAULT_BUNDLE_DIR = Path(os.environ.get(
    "SPAWN_TUNING_BUNDLE_DIR", "web/public/spawn-tuning"
))
# 小程序 CJS 数据模块 (sync-core.sh 期望的位置;也可由本 endpoint 直接写)
_DEFAULT_MP_TARGET = Path(os.environ.get(
    "SPAWN_TUNING_MP_TARGET", "miniprogram/core/tuning/spawnPolicies.js"
))


def _ensure_dirs():
    _DEFAULT_CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    _DEFAULT_LOGS_DIR.mkdir(parents=True, exist_ok=True)


def _new_job_id() -> str:
    return f"job-{int(time.time() * 1000)}"


def _read_log_tail(path: Path, max_lines: int = 100) -> str:
    """读日志文件的最后 N 行,无文件返回空字符串。"""
    if not path or not Path(path).exists():
        return ""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


def _process_status(job: dict) -> str:
    """根据 process.poll() 返回 'running' / 'completed' / 'failed (exit N)'。"""
    p = job.get("process")
    if p is None:
        return "unknown"
    rc = p.poll()
    if rc is None:
        return "running"
    if rc == 0:
        return "completed"
    return f"failed (exit {rc})"


def _job_to_dict(job_id: str, job: dict, include_log: bool = False) -> dict:
    elapsed = time.time() - job.get("started_at", time.time())
    out = {
        "job_id": job_id,
        "kind": job.get("kind"),
        "started_at": job.get("started_at"),
        "elapsed_s": round(elapsed, 1),
        "status": _process_status(job),
        "run_id": job.get("run_id"),
        "ckpt_file": job.get("ckpt_file"),
        "output": job.get("output"),
        "command": job.get("command"),
    }
    if include_log:
        out["log_tail"] = _read_log_tail(job.get("log_file"))
    return out


def _python_executable() -> str:
    """优先用 sys.executable (确保用同环境的 python);也允许 env override。"""
    return os.environ.get("SPAWN_TUNING_PYTHON", sys.executable or "python3")


def register_spawn_tuning_routes(app):
    """把 Spawn Tuning torch 后端路由注册到主 Flask app。

    参考 rl_backend.register_rl_routes 模式;在 server.py 末尾 try-import 调用。
    """
    bp = Blueprint("spawn_tuning_torch", __name__)
    _ensure_dirs()

    # === 1. 状态查询 ============================================
    @bp.route("/api/spawn-tuning/v2/torch/status", methods=["GET"])
    def torch_status():
        try:
            import torch
            available = True
            torch_version = torch.__version__
            try:
                cuda_available = bool(torch.cuda.is_available())
            except Exception:
                cuda_available = False
            try:
                mps_mod = getattr(torch.backends, "mps", None)
                mps_available = bool(mps_mod and mps_mod.is_available())
            except Exception:
                mps_available = False
        except ImportError:
            return jsonify({
                "available": False,
                "reason": "torch not installed (pip install torch)",
            })

        checkpoints = []
        try:
            for f in sorted(_DEFAULT_CHECKPOINTS_DIR.glob("*.pt"), key=lambda p: p.stat().st_mtime, reverse=True):
                stat = f.stat()
                checkpoints.append({
                    "name": f.name,
                    "path": str(f),
                    "size_bytes": stat.st_size,
                    "modified_at": int(stat.st_mtime),
                })
        except Exception:
            pass

        # 清理已结束的 jobs (>1 小时)
        now = time.time()
        for jid in list(_active_jobs.keys()):
            j = _active_jobs[jid]
            if _process_status(j) != "running" and now - j.get("started_at", now) > 3600:
                _active_jobs.pop(jid, None)

        return jsonify({
            "available": available,
            "torch_version": torch_version,
            "cuda": cuda_available,
            "mps": mps_available,
            "checkpoints_dir": str(_DEFAULT_CHECKPOINTS_DIR),
            "logs_dir": str(_DEFAULT_LOGS_DIR),
            "checkpoints": checkpoints,
            "active_jobs": [_job_to_dict(jid, j) for jid, j in _active_jobs.items()
                            if _process_status(j) == "running"],
            "recent_jobs_count": len(_active_jobs),
        })

    # === 1.5. Phase B 可训练的 run 列表 ============================
    @bp.route("/api/spawn-tuning/v2/torch/eligible-runs", methods=["GET"])
    def eligible_runs():
        """列出 SQLite 里"有样本可训"的 run_id (按样本数倒序)。

        Query params:
            min_samples (default 100) — Phase B 训练最少样本数门槛
            db (optional)             — DB 路径,默认 .cursor-stress-logs/spawn-tuning.sqlite

        返回字段:
            run_id / sample_count / context_count / unique_thetas /
            first_sample_at / last_sample_at / has_been_trained (是否有 checkpoint)
        """
        try:
            min_samples = int(request.args.get("min_samples", 100))
        except (TypeError, ValueError):
            min_samples = 100
        db_path = request.args.get("db") or str(_DEFAULT_DB_PATH)
        if not Path(db_path).exists():
            return jsonify({"runs": [], "db_path": db_path, "exists": False})

        try:
            import sqlite3
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT run_id,
                       COUNT(*)                          AS sample_count,
                       COUNT(DISTINCT context_key)       AS context_count,
                       COUNT(DISTINCT theta_json)        AS unique_thetas,
                       MIN(evaluated_at)                 AS first_sample_at,
                       MAX(evaluated_at)                 AS last_sample_at
                FROM spawn_tuning_samples_v2
                GROUP BY run_id
                HAVING sample_count >= ?
                ORDER BY sample_count DESC
                """,
                (min_samples,),
            ).fetchall()
            conn.close()
        except Exception as e:
            return jsonify({"error": f"db query failed: {e}", "runs": []}), 500

        # 检查每个 run 是否已有对应 checkpoint (文件名包含 run_id)
        ckpt_run_ids = set()
        try:
            for f in _DEFAULT_CHECKPOINTS_DIR.glob("surrogate-*.pt"):
                # 文件名格式: surrogate-<runid>-job-<ts>.pt
                parts = f.stem.split("-")
                if len(parts) >= 2 and parts[1].isdigit():
                    ckpt_run_ids.add(int(parts[1]))
        except Exception:
            pass

        runs = []
        for r in rows:
            rid = r["run_id"]
            runs.append({
                "run_id": rid,
                "sample_count": r["sample_count"],
                "context_count": r["context_count"],
                "unique_thetas": r["unique_thetas"],
                "first_sample_at": r["first_sample_at"],
                "last_sample_at": r["last_sample_at"],
                "has_been_trained": rid in ckpt_run_ids,
                # 衡量样本平铺程度: 平均每 context 多少样本
                "samples_per_context": round(r["sample_count"] / max(1, r["context_count"]), 1),
            })
        return jsonify({
            "runs": runs,
            "count": len(runs),
            "db_path": db_path,
            "min_samples": min_samples,
        })

    # === 1.6. Mirror: 从 CLI DB 拿 top-policies ===================
    # (主 server 的 /v2/runs/<id>/top-policies 查 openblock.db,
    #  但 CLI 把样本写到 .cursor-stress-logs/spawn-tuning.sqlite,
    #  这里提供一个走 CLI DB 的镜像 endpoint)
    @bp.route("/api/spawn-tuning/v2/torch/runs/<int:run_id>/top-policies", methods=["GET"])
    def cli_db_top_policies(run_id):
        try:
            w_f = float(request.args.get("w_fairness", 70))
            w_e = float(request.args.get("w_excitement", 45))
            w_a = float(request.args.get("w_anti_inflation", 60))
            limit = int(request.args.get("limit", 50))
        except (TypeError, ValueError):
            return jsonify({"error": "invalid weights"}), 400

        db_path = request.args.get("db") or str(_DEFAULT_DB_PATH)
        if not Path(db_path).exists():
            return jsonify({"top_policies": [], "context_count": 0, "db_path": db_path})

        lifecycle_mult = {
            "onboarding": (1.5, 1.2, 0.5),
            "growth":     (1.0, 1.0, 1.0),
            "mature":     (0.8, 0.9, 1.5),
            "plateau":    (0.7, 1.5, 0.8),
        }
        total = max(1e-9, w_f + w_e + w_a)
        wf, we, wa = w_f / total, w_e / total, w_a / total

        try:
            import sqlite3
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT context_key, difficulty, generator, bestScore_bin, lifecycle_stage,
                       theta_json, fairness_score, excitement_score, antiInflation_score,
                       scoreMean, noMoveRate, overshootRate
                FROM spawn_tuning_samples_v2
                WHERE run_id = ?
                """,
                (run_id,),
            ).fetchall()
            conn.close()
        except Exception as e:
            return jsonify({"error": f"db query failed: {e}", "top_policies": []}), 500

        best_by_ctx = {}
        for r in rows:
            mf, me, ma = lifecycle_mult.get(r["lifecycle_stage"], (1.0, 1.0, 1.0))
            num = (wf * mf * (r["fairness_score"] or 0)
                   + we * me * (r["excitement_score"] or 0)
                   + wa * ma * (r["antiInflation_score"] or 0))
            den = wf * mf + we * me + wa * ma
            composite = num / den if den > 0 else 0
            ctx_key = r["context_key"]
            if ctx_key not in best_by_ctx or composite > best_by_ctx[ctx_key]["composite"]:
                try:
                    theta = json.loads(r["theta_json"])
                except Exception:
                    theta = {}
                best_by_ctx[ctx_key] = {
                    "context_key": ctx_key,
                    "difficulty": r["difficulty"],
                    "generator": r["generator"],
                    "bestScore_bin": r["bestScore_bin"],
                    "lifecycle_stage": r["lifecycle_stage"],
                    "theta": theta,
                    "fairness": r["fairness_score"],
                    "excitement": r["excitement_score"],
                    "antiInflation": r["antiInflation_score"],
                    "composite": composite,
                    "scoreMean": r["scoreMean"],
                    "noMoveRate": r["noMoveRate"],
                    "overshootRate": r["overshootRate"],
                }
        sorted_top = sorted(best_by_ctx.values(), key=lambda x: -x["composite"])[:limit]
        return jsonify({
            "run_id": run_id,
            "weights": {"fairness": w_f, "excitement": w_e, "antiInflation": w_a},
            "context_count": len(best_by_ctx),
            "top_policies": sorted_top,
            "db_path": db_path,
        })

    # === 2. Phase B 训练 NN 代理 =================================
    @bp.route("/api/spawn-tuning/v2/torch/train", methods=["POST"])
    def start_train():
        data = request.get_json() or {}
        try:
            run_id = int(data.get("run_id", 0))
        except (TypeError, ValueError):
            return jsonify({"error": "invalid run_id"}), 400
        if run_id <= 0:
            return jsonify({"error": "run_id required"}), 400

        db_path = data.get("db_path") or str(_DEFAULT_DB_PATH)
        if not Path(db_path).exists():
            return jsonify({"error": f"db not found: {db_path}"}), 404

        # 校验样本数
        try:
            import sqlite3
            conn = sqlite3.connect(db_path)
            cnt = conn.execute(
                "SELECT COUNT(*) FROM spawn_tuning_samples_v2 WHERE run_id = ?", (run_id,)
            ).fetchone()[0]
            conn.close()
            if cnt < 100:
                return jsonify({
                    "error": f"run_id={run_id} only has {cnt} samples, minimum 100 required",
                }), 400
        except Exception as e:
            return jsonify({"error": f"db query failed: {e}"}), 500

        epochs = max(1, min(200, int(data.get("epochs", 50))))
        batch_size = max(8, min(1024, int(data.get("batch_size", 256))))
        lr = max(1e-5, min(1.0, float(data.get("lr", 1e-3))))
        device = data.get("device", "cpu")  # cpu / cuda / mps

        job_id = _new_job_id()
        log_file = _DEFAULT_LOGS_DIR / f"{job_id}.log"
        ckpt_file = _DEFAULT_CHECKPOINTS_DIR / f"surrogate-{run_id}-{job_id}.pt"

        cmd = [
            _python_executable(), "-u", "-m", "rl_pytorch.spawn_tuning.train_surrogate",
            "--db", db_path,
            "--run-id", str(run_id),
            "--output", str(ckpt_file),
            "--epochs", str(epochs),
            "--batch-size", str(batch_size),
            "--lr", str(lr),
            "--device", device,
        ]

        try:
            log_fp = open(log_file, "w", encoding="utf-8")
            proc = subprocess.Popen(
                cmd, stdout=log_fp, stderr=subprocess.STDOUT, cwd=os.getcwd(),
            )
        except Exception as e:
            return jsonify({"error": f"failed to spawn: {e}"}), 500

        _active_jobs[job_id] = {
            "process": proc,
            "started_at": time.time(),
            "log_file": log_file,
            "kind": "train",
            "run_id": run_id,
            "ckpt_file": str(ckpt_file),
            "command": " ".join(cmd),
        }
        return jsonify({
            "job_id": job_id,
            "status": "running",
            "ckpt_file": str(ckpt_file),
            "log_file": str(log_file),
            "pid": proc.pid,
        })

    # === 3. Phase C 找 120 contexts θ* ==========================
    @bp.route("/api/spawn-tuning/v2/torch/optimize", methods=["POST"])
    def start_optimize():
        data = request.get_json() or {}
        ckpt = data.get("checkpoint")
        if not ckpt:
            return jsonify({"error": "checkpoint required"}), 400
        if not Path(ckpt).exists():
            return jsonify({"error": f"checkpoint not found: {ckpt}"}), 404

        weights = data.get("weights") or {}
        wf = max(0, float(weights.get("fairness", 70)))
        we = max(0, float(weights.get("excitement", 45)))
        wa = max(0, float(weights.get("antiInflation", 60)))
        n_starts = max(2, min(20, int(data.get("n_starts", 8))))
        steps = max(50, min(1000, int(data.get("steps", 250))))

        job_id = _new_job_id()
        log_file = _DEFAULT_LOGS_DIR / f"{job_id}.log"
        out_file = _DEFAULT_CHECKPOINTS_DIR / f"policies-{job_id}.json"

        cmd = [
            _python_executable(), "-u", "-m", "rl_pytorch.spawn_tuning.optimize_theta",
            "--surrogate", str(ckpt),
            "--weights-fairness", str(wf),
            "--weights-excitement", str(we),
            "--weights-anti-inflation", str(wa),
            "--n-starts", str(n_starts),
            "--steps", str(steps),
            "--output", str(out_file),
        ]

        try:
            log_fp = open(log_file, "w", encoding="utf-8")
            proc = subprocess.Popen(
                cmd, stdout=log_fp, stderr=subprocess.STDOUT, cwd=os.getcwd(),
            )
        except Exception as e:
            return jsonify({"error": f"failed to spawn: {e}"}), 500

        _active_jobs[job_id] = {
            "process": proc,
            "started_at": time.time(),
            "log_file": log_file,
            "kind": "optimize",
            "output": str(out_file),
            "checkpoint": ckpt,
            "command": " ".join(cmd),
        }
        return jsonify({
            "job_id": job_id,
            "status": "running",
            "output": str(out_file),
            "log_file": str(log_file),
            "pid": proc.pid,
        })

    # === 4. Job 管理 ===========================================
    @bp.route("/api/spawn-tuning/v2/torch/jobs", methods=["GET"])
    def list_jobs():
        return jsonify({
            "jobs": [_job_to_dict(jid, j) for jid, j in sorted(
                _active_jobs.items(), key=lambda kv: kv[1].get("started_at", 0), reverse=True,
            )],
            "count": len(_active_jobs),
        })

    @bp.route("/api/spawn-tuning/v2/torch/jobs/<job_id>", methods=["GET"])
    def get_job(job_id):
        job = _active_jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        return jsonify(_job_to_dict(job_id, job, include_log=True))

    @bp.route("/api/spawn-tuning/v2/torch/jobs/<job_id>/cancel", methods=["POST"])
    def cancel_job(job_id):
        job = _active_jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        p = job.get("process")
        if p is None or p.poll() is not None:
            return jsonify({"job_id": job_id, "cancelled": False, "reason": "already finished"})
        try:
            p.send_signal(signal.SIGTERM)
            time.sleep(1)
            if p.poll() is None:
                p.kill()
        except Exception as e:
            return jsonify({"error": f"cancel failed: {e}"}), 500
        return jsonify({"job_id": job_id, "cancelled": True})

    # === 5. Checkpoint 列表 =====================================
    @bp.route("/api/spawn-tuning/v2/torch/checkpoints", methods=["GET"])
    def list_checkpoints():
        files = []
        for f in sorted(_DEFAULT_CHECKPOINTS_DIR.glob("*"),
                        key=lambda p: p.stat().st_mtime, reverse=True):
            if not f.is_file():
                continue
            stat = f.stat()
            files.append({
                "name": f.name,
                "path": str(f),
                "size_bytes": stat.st_size,
                "modified_at": int(stat.st_mtime),
                "kind": "checkpoint" if f.suffix == ".pt" else (
                    "policies" if f.name.startswith("policies") else "other"),
            })
        return jsonify({
            "checkpoints": files,
            "dir": str(_DEFAULT_CHECKPOINTS_DIR),
        })

    # === 6.5. 烘焙离线 bundle (Web/Android/iOS + 小程序) ============
    @bp.route("/api/spawn-tuning/v2/policies/bundle/export", methods=["POST"])
    def export_bundle():
        """把当前 active policies (或指定文件) 烘焙到客户端打包目录。

        POST body 可选:
            { source: 'active' | <path>, include_miniprogram: true, runId: '...' }

        效果:
            1. 写 web/public/spawn-tuning/policies.json  (Web/Android/iOS 共用)
            2. 写 web/public/spawn-tuning/policies.meta.json (生成时间 / sha256 / runId)
            3. (可选) 写 miniprogram/core/tuning/spawnPolicies.js (CJS 数据模块)

        客户端在 init 阶段先读 bundle 立即生效, 再异步去 server 拉最新灰度。
        """
        data = request.get_json() or {}
        source = data.get("source", "active")
        include_mp = bool(data.get("include_miniprogram", True))

        # 1. 拿到 policies 列表
        policies = []
        meta_extra = {}
        if source == "active":
            try:
                # 复用主 server 的 DATABASE 路径 (与 /policies/active 同源)
                import sqlite3
                _default_db = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), "openblock.db"
                )
                db_path = (os.environ.get("OPENBLOCK_DB_PATH")
                           or os.environ.get("BLOCKBLAST_DB_PATH")
                           or _default_db)
                if not Path(db_path).exists():
                    return jsonify({"error": f"DB not found at {db_path}"}), 500
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM spawn_tuning_policies "
                    "WHERE is_active = 1 ORDER BY context_key"
                ).fetchall()
                conn.close()
                for r in rows:
                    try:
                        theta = json.loads(r["theta_json"])
                    except Exception:
                        continue
                    p = {
                        "context_key": r["context_key"],
                        "difficulty": r["difficulty"],
                        "generator": r["generator"],
                        "bestScore_bin": r["bestScore_bin"],
                        "lifecycle_stage": r["lifecycle_stage"],
                        "theta": theta,
                        "expected_composite": r["expected_composite"],
                    }
                    sig = r["deployment_signature"] if "deployment_signature" in r.keys() else None
                    if sig:
                        p["signature"] = sig
                    policies.append(p)
                    if meta_extra.get("run_id") is None and "run_id" in r.keys():
                        meta_extra["run_id"] = r["run_id"]
                if len(policies) == 0:
                    return jsonify({"error": "no active policies in DB"}), 404
            except Exception as e:
                return jsonify({"error": f"db query failed: {e}"}), 500
        else:
            # source 是文件路径
            src_path = Path(source)
            if not src_path.exists():
                return jsonify({"error": f"file not found: {source}"}), 404
            try:
                content = json.loads(src_path.read_text(encoding="utf-8"))
                policies = content.get("policies", [])
                meta_extra["run_id"] = content.get("run_id") or content.get("runId")
                meta_extra["weights"] = content.get("weights")
                meta_extra["source_file"] = str(src_path)
            except Exception as e:
                return jsonify({"error": f"parse failed: {e}"}), 400

        if not policies:
            return jsonify({"error": "no policies to export"}), 400

        # 2. 构造 bundle payload (与 /policies/active 响应同结构)
        bundle_payload = {
            "policies": policies,
            "rollout_pct": 100,  # bundle 默认全量;线上 rollout 由 server fetch 覆盖
            "run_id": data.get("runId") or meta_extra.get("run_id") or "bundle",
            "generated_at": int(time.time()),
            "bundle": True,
        }
        bundle_json = json.dumps(bundle_payload, ensure_ascii=False, separators=(",", ":"))
        sha256 = hashlib.sha256(bundle_json.encode("utf-8")).hexdigest()

        # 3. 写 bundle 到 web/public (Vite/Capacitor 自动带进 APK/IPA)
        results = {"written": []}
        try:
            _DEFAULT_BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
            bundle_file = _DEFAULT_BUNDLE_DIR / "policies.json"
            bundle_file.write_text(bundle_json, encoding="utf-8")
            results["written"].append(str(bundle_file))
            results["bundle_size_bytes"] = bundle_file.stat().st_size

            # meta 文件 (人类可读)
            meta_file = _DEFAULT_BUNDLE_DIR / "policies.meta.json"
            meta_file.write_text(json.dumps({
                "run_id": bundle_payload["run_id"],
                "generated_at": bundle_payload["generated_at"],
                "generated_at_iso": time.strftime(
                    "%Y-%m-%dT%H:%M:%S", time.localtime(bundle_payload["generated_at"])
                ),
                "policies_count": len(policies),
                "sha256": sha256,
                **meta_extra,
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            results["written"].append(str(meta_file))
        except Exception as e:
            return jsonify({"error": f"write web bundle failed: {e}"}), 500

        # 4. 写小程序 CJS 数据模块 (可选)
        if include_mp:
            try:
                _DEFAULT_MP_TARGET.parent.mkdir(parents=True, exist_ok=True)
                mp_body = (
                    "/**\n"
                    " * 小程序运行时数据模块 — 出块寻参策略 (离线包)\n"
                    " *\n"
                    f" * 自动生成于: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f" * run_id: {bundle_payload['run_id']}\n"
                    f" * policies_count: {len(policies)}\n"
                    f" * sha256: {sha256}\n"
                    " *\n"
                    " * 来源: spawn_tuning_backend.export_bundle()\n"
                    " * 小程序不能直接 require JSON, 用 CJS 数据模块替代 (参考 gameRulesData.js)。\n"
                    " */\n"
                    "module.exports = " + json.dumps(
                        bundle_payload, ensure_ascii=False, indent=2
                    ) + ";\n"
                )
                _DEFAULT_MP_TARGET.write_text(mp_body, encoding="utf-8")
                results["written"].append(str(_DEFAULT_MP_TARGET))
                results["miniprogram_size_bytes"] = _DEFAULT_MP_TARGET.stat().st_size
            except Exception as e:
                results["miniprogram_error"] = str(e)

        return jsonify({
            "ok": True,
            "policies_count": len(policies),
            "run_id": bundle_payload["run_id"],
            "sha256": sha256,
            "generated_at": bundle_payload["generated_at"],
            **results,
            "note": "下次 vite build 时 dist/spawn-tuning/policies.json 会自动包含。Android/iOS 通过 Capacitor copy 一并打包,小程序读 miniprogram/core/tuning/spawnPolicies.js",
        })

    @bp.route("/api/spawn-tuning/v2/policies/bundle/status", methods=["GET"])
    def bundle_status():
        """查询当前已烘焙的 bundle 元数据。"""
        meta_file = _DEFAULT_BUNDLE_DIR / "policies.meta.json"
        bundle_file = _DEFAULT_BUNDLE_DIR / "policies.json"
        if not meta_file.exists() or not bundle_file.exists():
            return jsonify({
                "exists": False,
                "bundle_dir": str(_DEFAULT_BUNDLE_DIR),
                "mp_target": str(_DEFAULT_MP_TARGET),
                "mp_exists": _DEFAULT_MP_TARGET.exists(),
            })
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        return jsonify({
            "exists": True,
            "bundle_path": str(bundle_file),
            "bundle_size_bytes": bundle_file.stat().st_size,
            "bundle_modified_at": int(bundle_file.stat().st_mtime),
            "mp_target": str(_DEFAULT_MP_TARGET),
            "mp_exists": _DEFAULT_MP_TARGET.exists(),
            "mp_modified_at": int(_DEFAULT_MP_TARGET.stat().st_mtime) if _DEFAULT_MP_TARGET.exists() else None,
            "meta": meta,
        })

    # === 7. 一键: 从 policies.json 部署 ==========================
    @bp.route("/api/spawn-tuning/v2/torch/load-policies", methods=["POST"])
    def load_policies_file():
        """读 policies.json 文件,返回内容供前端调 /v2/policies/deploy。"""
        data = request.get_json() or {}
        path = data.get("path")
        if not path:
            return jsonify({"error": "path required"}), 400
        p = Path(path)
        if not p.exists() or not p.is_file():
            return jsonify({"error": "file not found"}), 404
        try:
            content = json.loads(p.read_text(encoding="utf-8"))
            return jsonify({
                "ok": True,
                "path": str(p),
                "size_bytes": p.stat().st_size,
                "policies_count": len(content.get("policies", [])),
                "weights": content.get("weights"),
                "content": content,
            })
        except Exception as e:
            return jsonify({"error": f"parse failed: {e}"}), 400

    app.register_blueprint(bp)
