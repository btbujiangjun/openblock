"""异步训练 job 执行器测试。

验证:
  - _claim_one_job: 原子标记 queued → running
  - _parse_log_line: JSONL 解析
  - _update_job_metrics: 字段更新
  - 完整 end-to-end (跑短 epoch, 验证 status=done + model 写入)
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2 import job_executor


SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "schemas", "spawn_tuning_v2.sql",
)


@pytest.fixture
def db_path():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name
    conn = sqlite3.connect(path)
    with open(SCHEMA_PATH) as fh:
        conn.executescript(fh.read())
    conn.close()
    yield path
    try:
        os.unlink(path)
    except OSError:
        pass


def _insert_job(db_path, **overrides):
    defaults = {
        "name": "test_job",
        "status": "queued",
        "model_type": "resnet",
        "arch_json": "{}",
        "loss_weights": "{}",
        "sample_set_ids": "[1]",
        "created_at": int(time.time()),
    }
    defaults.update(overrides)
    cols = ",".join(defaults)
    ph = ",".join("?" * len(defaults))
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        f"INSERT INTO training_jobs ({cols}) VALUES ({ph})",
        tuple(defaults.values()),
    )
    jid = cur.lastrowid
    conn.commit()
    conn.close()
    return jid


class TestClaimJob:
    def test_no_queued_returns_none(self, db_path):
        assert job_executor._claim_one_job(db_path) is None

    def test_queued_returns_one(self, db_path):
        jid = _insert_job(db_path)
        job = job_executor._claim_one_job(db_path)
        assert job is not None
        assert job["job_id"] == jid
        # 现在应是 running
        conn = sqlite3.connect(db_path)
        r = conn.execute("SELECT status FROM training_jobs WHERE job_id=?", (jid,)).fetchone()
        conn.close()
        assert r[0] == "running"

    def test_claim_twice_returns_different(self, db_path):
        """两次连续 claim 应分别拿不同 job (or 第二次 None)。"""
        j1 = _insert_job(db_path)
        j2 = _insert_job(db_path)
        a = job_executor._claim_one_job(db_path)
        b = job_executor._claim_one_job(db_path)
        ids = {a["job_id"], b["job_id"]}
        assert ids == {j1, j2}

    def test_already_running_not_claimed(self, db_path):
        jid = _insert_job(db_path, status="running")
        assert job_executor._claim_one_job(db_path) is None


class TestParseLogLine:
    def test_valid_epoch_json(self):
        line = '{"type": "epoch", "step": 12, "epoch": 5, "train_loss": 0.08, "val_curve_mae": 0.04}'
        d = job_executor._parse_log_line(line)
        assert d is not None
        assert d["epoch"] == 5

    def test_backward_compat_no_type(self):
        """旧 JSONL 没有 type 字段, 但有 epoch + train_loss → 视为 epoch end record."""
        line = '{"epoch": 5, "train_loss": 0.08, "val_curve_mae": 0.04}'
        d = job_executor._parse_log_line(line)
        assert d == {"epoch": 5, "train_loss": 0.08, "val_curve_mae": 0.04}

    def test_batch_line_skipped(self):
        """type=batch 行不应更新 jobs 表 (只用于前端 metrics-history 渲染)."""
        line = '{"type": "batch", "step": 4, "epoch": 0, "batch": 4, "train_loss_batch": 0.12}'
        assert job_executor._parse_log_line(line) is None

    def test_epoch_without_train_loss(self):
        """epoch 字段在但缺 train_loss 也不更新 (防御不完整行)."""
        line = '{"epoch": 5, "lr": 0.001}'
        assert job_executor._parse_log_line(line) is None

    def test_no_epoch_returns_none(self):
        line = '{"foo": "bar"}'
        assert job_executor._parse_log_line(line) is None

    def test_invalid_json_returns_none(self):
        assert job_executor._parse_log_line("not json") is None
        assert job_executor._parse_log_line("") is None
        assert job_executor._parse_log_line("[train_v2] foo") is None


class TestUpdateMetrics:
    def test_basic_update(self, db_path):
        jid = _insert_job(db_path)
        job_executor._update_job_metrics(
            db_path, jid,
            epochs_done=5, train_loss=0.08, val_curve_mae=0.04,
        )
        conn = sqlite3.connect(db_path)
        r = conn.execute(
            "SELECT epochs_done, train_loss, val_curve_mae FROM training_jobs WHERE job_id=?",
            (jid,),
        ).fetchone()
        conn.close()
        assert r[0] == 5
        assert r[1] == pytest.approx(0.08)
        assert r[2] == pytest.approx(0.04)

    def test_empty_update_noop(self, db_path):
        jid = _insert_job(db_path)
        # 不应抛
        job_executor._update_job_metrics(db_path, jid)

    def test_db_locked_does_not_raise(self, db_path, capsys):
        """v2.9.3: db locked 时 _update_job_metrics 应只打 warning, 不抛异常,
        不让 worker_loop 落入无限错误循环。"""
        jid = _insert_job(db_path)
        # 在外部连接上拿 EXCLUSIVE 写锁, 让 _update_job_metrics 必然超时
        holder = sqlite3.connect(db_path, isolation_level=None)
        holder.execute("BEGIN EXCLUSIVE")
        try:
            # 临时把 timeout 调到 0.5s 让测试快速完成 (默认 10s)
            import unittest.mock
            real_connect = sqlite3.connect

            def fast_connect(p, **kw):
                kw["timeout"] = 0.3
                return real_connect(p, **kw)

            with unittest.mock.patch.object(job_executor.sqlite3, "connect", fast_connect):
                # 不应抛, 应静默返回 (只 print warning)
                job_executor._update_job_metrics(
                    db_path, jid, epochs_done=99, train_loss=0.0,
                )
            captured = capsys.readouterr()
            assert "skipped" in captured.out or "locked" in captured.out.lower()
        finally:
            holder.execute("ROLLBACK")
            holder.close()


class TestBuildCmd:
    def test_basic_cmd(self, db_path):
        job = {
            "job_id": 1, "model_type": "resnet",
            "arch_json": json.dumps({"epochs": 10, "batch_size": 64}),
            "sample_set_ids": "[1, 2]",
            "base_model_id": None,
        }
        cmd = job_executor._build_train_cmd(
            job, "/tmp/out.pt", "/tmp/log", db_path,
        )
        assert "rl_pytorch.spawn_tuning_v2.train" in cmd
        assert "--sample-sets" in cmd
        assert "1,2" in cmd
        assert "--epochs" in cmd
        assert "10" in cmd
        assert "--base-model" not in cmd

    def test_with_base_model(self, db_path):
        # 先建一个 model 记录
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO models (name, model_type, weights_path, status, created_at) "
            "VALUES (?, ?, ?, 'staging', ?)",
            ("base", "resnet", "/tmp/base.pt", int(time.time())),
        )
        base_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        conn.close()

        job = {
            "job_id": 2, "model_type": "resnet",
            "arch_json": "{}",
            "sample_set_ids": "[1]",
            "base_model_id": base_id,
        }
        cmd = job_executor._build_train_cmd(job, "/tmp/o.pt", "/tmp/l", db_path)
        assert "--base-model" in cmd
        assert "/tmp/base.pt" in cmd


class TestKillJob:
    """v2.8.4: kill_job 函数测试 — 直接 mock subprocess.Popen 避免真启动训练。"""

    def teardown_method(self):
        # 每个测试后清理 registry, 防止跨用例污染
        with job_executor._registry_lock:
            job_executor._RUNNING_PROCS.clear()

    def test_kill_not_running(self):
        """job 不在 registry → not_running, 不抛错。"""
        r = job_executor.kill_job(99999)
        assert r["ok"] is False
        assert r["action"] == "not_running"

    def test_kill_already_exited(self):
        """注册表里有 proc 但已自然结束 (poll() != None) → already_exited。"""
        class FakeProc:
            returncode = 0
            def poll(self): return 0
            def terminate(self): pass
            def kill(self): pass
            def wait(self, timeout=None): return 0
        with job_executor._registry_lock:
            job_executor._RUNNING_PROCS[42] = FakeProc()
        r = job_executor.kill_job(42)
        assert r["ok"] is True
        assert r["action"] == "already_exited"
        # registry 已清理
        assert 42 not in job_executor._RUNNING_PROCS

    def test_kill_sigterm_success(self):
        """SIGTERM 后 proc 优雅停止 (wait 不超时)。"""
        class FakeProc:
            returncode = None
            _terminated = False
            def poll(self): return None if not self._terminated else -15
            def terminate(self): self._terminated = True
            def kill(self): pass
            def wait(self, timeout=None):
                self.returncode = -15  # SIGTERM
                return -15
        with job_executor._registry_lock:
            job_executor._RUNNING_PROCS[43] = FakeProc()
        r = job_executor.kill_job(43, timeout=0.5)
        assert r["ok"] is True
        assert r["action"] == "sigterm"
        assert 43 not in job_executor._RUNNING_PROCS

    def test_kill_sigkill_after_timeout(self):
        """SIGTERM 超时 → SIGKILL 强杀。"""
        import subprocess as _sp
        class FakeProc:
            returncode = None
            _killed = False
            def poll(self): return None if not self._killed else -9
            def terminate(self): pass  # SIGTERM 无响应
            def kill(self): self._killed = True
            wait_call_count = 0
            def wait(self, timeout=None):
                self.wait_call_count += 1
                if self.wait_call_count == 1:
                    # 第一次 wait (SIGTERM 后) → TimeoutExpired
                    raise _sp.TimeoutExpired(cmd="fake", timeout=timeout)
                # 第二次 wait (SIGKILL 后) → 正常返回
                self.returncode = -9
                return -9
        with job_executor._registry_lock:
            job_executor._RUNNING_PROCS[44] = FakeProc()
        r = job_executor.kill_job(44, timeout=0.1)
        assert r["ok"] is True
        assert r["action"] == "sigkill"
        assert 44 not in job_executor._RUNNING_PROCS


class TestExecutorLifecycle:
    def test_start_stop(self, db_path):
        # 临时禁掉 executor 自动启动 (其实模块全局,但我们手动调)
        assert job_executor.start_job_executor(db_path) is True
        # 第二次启动幂等
        assert job_executor.start_job_executor(db_path) is False
        # 停止
        job_executor.stop_job_executor(timeout=2)
