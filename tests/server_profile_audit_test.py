"""
tests/server_profile_audit_test.py — server.py 玩家画像 audit 端点集成测试

跑法（不依赖 CI 的 services/tests 套件）：
    OPENBLOCK_DB_PATH=/tmp/audit_test.db python3 -m pytest tests/server_profile_audit_test.py -v

也可以直接用 stdlib 运行（无需 pytest）：
    OPENBLOCK_DB_PATH=/tmp/audit_test.db python3 tests/server_profile_audit_test.py

端点覆盖：
    POST   /api/profile-audit/<session_id>
    GET    /api/profile-audit/<session_id>
    DELETE /api/profile-audit/<session_id>
    GET    /api/profile-audit/recent
"""
import os
import tempfile
import unittest


def _sample_report(score=84, frames=80, contract_passed=False):
    return {
        "schema": 1,
        "healthScore": score,
        "summary": {
            "totalFrames": frames, "sessionsCount": 1,
            "passedContracts": 8 if contract_passed else 7,
            "failedContracts": 0 if contract_passed else 1,
            "coldFrames": 3, "coldFramesRatio": 0.037,
        },
        "contracts": [
            {"id": "clearRate-vs-boardFill", "desc": "x", "passed": True},
            {"id": "score-monotone-increasing", "desc": "y", "passed": contract_passed},
        ],
        "linkages": {"stressDominator": {"key": "difficultyBias", "shareOfAbs": 0.41}},
        "hints": ([] if contract_passed else [
            {"severity": "error", "code": "CONTRACT_VIOLATION", "contract": "score-monotone-increasing"},
            {"severity": "warn", "code": "REDUNDANT_PAIR"},
            {"severity": "info", "code": "STRESS_DOMINATED"},
        ]),
    }


class ProfileAuditEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 为本测试套件准备临时 sqlite，避免污染开发数据库
        cls._tmp_dir = tempfile.mkdtemp(prefix="audit-e2e-")
        os.environ["OPENBLOCK_DB_PATH"] = os.path.join(cls._tmp_dir, "test.db")
        import server  # 必须在 env 设好后再 import
        cls.app = server.app
        cls.client = server.app.test_client()

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls._tmp_dir, ignore_errors=True)

    def test_get_nonexistent_returns_null(self):
        r = self.client.get("/api/profile-audit/9999991")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json, {"report": None})

    def test_post_invalid_payload_returns_400(self):
        r = self.client.post("/api/profile-audit/9999992", json={"report": {"hints": []}})
        self.assertEqual(r.status_code, 400)

    def test_post_get_delete_roundtrip(self):
        sid = 9999993
        r = self.client.post(f"/api/profile-audit/{sid}",
                             json={"user_id": "uTest", "report": _sample_report(score=84)})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json["success"])
        self.assertEqual(r.json["summary"]["health_score"], 84)
        self.assertEqual(r.json["summary"]["hint_errors"], 1)

        r = self.client.get(f"/api/profile-audit/{sid}")
        self.assertEqual(r.json["report"]["healthScore"], 84)
        self.assertGreater(r.json["updated_at"], 0)

        r = self.client.delete(f"/api/profile-audit/{sid}")
        self.assertEqual(r.json["deleted"], 1)
        r = self.client.get(f"/api/profile-audit/{sid}")
        self.assertEqual(r.json, {"report": None})

    def test_recent_aggregation(self):
        # 准备 4 局让 topRegressions 触发（>=3 局阈值）
        for i, score in enumerate([84, 60, 70, 50]):
            self.client.post(
                f"/api/profile-audit/{9000010 + i}",
                json={"user_id": "uAgg", "report": _sample_report(score=score, frames=50)},
            )
        r = self.client.get("/api/profile-audit/recent?days=1&user_id=uAgg")
        agg = r.json
        self.assertEqual(agg["sessionsCount"], 4)
        self.assertEqual(agg["framesTotal"], 200)
        self.assertIsNotNone(agg["healthScore"])
        self.assertEqual(agg["healthScore"]["count"], 4)
        self.assertEqual(agg["healthScore"]["min"], 50)
        self.assertEqual(agg["healthScore"]["max"], 84)

        # score-monotone 4 局全失败
        m = next((c for c in agg["contractStats"] if c["id"] == "score-monotone-increasing"), None)
        self.assertIsNotNone(m)
        self.assertEqual(m["violationRate"], 1.0)
        self.assertTrue(any(c["id"] == "score-monotone-increasing" for c in agg["topRegressions"]))

        # CONTRACT_VIOLATION 出现 4 次，severity=error 排第一
        cv = next((h for h in agg["hintCounts"] if h["code"] == "CONTRACT_VIOLATION"), None)
        self.assertIsNotNone(cv)
        self.assertEqual(cv["count"], 4)
        self.assertEqual(cv["severity"], "error")

        # stressDominator 4 局都是 difficultyBias
        sd = agg["stressDominatorCounts"][0]
        self.assertEqual(sd["key"], "difficultyBias")
        self.assertEqual(sd["count"], 4)

    def test_recent_user_isolation(self):
        self.client.post("/api/profile-audit/9000099",
                         json={"user_id": "uIso", "report": _sample_report()})
        r = self.client.get("/api/profile-audit/recent?days=1&user_id=uIso")
        self.assertEqual(r.json["sessionsCount"], 1)

    def test_recent_days_clamp(self):
        # 0/-1/100 都应该被夹到 [1, 90]
        r = self.client.get("/api/profile-audit/recent?days=0")
        self.assertEqual(r.json["days"], 1)
        r = self.client.get("/api/profile-audit/recent?days=200")
        self.assertEqual(r.json["days"], 90)

    def test_sessions_requires_user_or_debug(self):
        """跨用户列表必须经过 OPENBLOCK_DB_DEBUG 门控"""
        prev = os.environ.pop("OPENBLOCK_DB_DEBUG", None)
        try:
            # 不带 user_id 且未开 debug → 403
            r = self.client.get("/api/profile-audit/sessions")
            self.assertEqual(r.status_code, 403)
            # 带 user_id 应该正常返回（即使空列表）
            r = self.client.get("/api/profile-audit/sessions?user_id=uDoesNotExist")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json, [])
        finally:
            if prev is not None:
                os.environ["OPENBLOCK_DB_DEBUG"] = prev

    def test_sessions_list_with_user_id(self):
        """列出已 audit 的 session：合成一个 move_sequences 行 + audit → 应能查到"""
        import sqlite3
        import json as _json
        db_path = os.environ["OPENBLOCK_DB_PATH"]
        conn = sqlite3.connect(db_path)
        try:
            # 准备一个完整 session：sessions + move_sequences + profile_audits
            conn.execute(
                "INSERT INTO sessions (id, user_id, strategy, score, start_time, status) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (777001, "uList", "normal", 100, int(__import__('time').time()) - 100, "completed"),
            )
            conn.execute(
                "INSERT INTO move_sequences (session_id, user_id, frames) VALUES (?, ?, ?)",
                (777001, "uList", _json.dumps([{"t": "init"}, {"t": "place"}])),
            )
            conn.commit()
        finally:
            conn.close()

        # 上传 audit
        self.client.post(
            "/api/profile-audit/777001",
            json={"user_id": "uList", "report": _sample_report(score=72)},
        )

        # 列表应包含这个 session，且 hasAudit=true、auditHealthScore=72
        r = self.client.get("/api/profile-audit/sessions?user_id=uList&limit=10")
        self.assertEqual(r.status_code, 200)
        items = r.json
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["sessionId"], 777001)
        self.assertEqual(item["userId"], "uList")
        self.assertEqual(item["strategy"], "normal")
        # 末帧无 ps.score → fallback 到 sessions.score=100
        self.assertEqual(item["score"], 100)
        self.assertEqual(item["rawSessionScore"], 100)
        self.assertEqual(item["placeSteps"], 1)
        self.assertTrue(item["hasAudit"])
        self.assertEqual(item["auditHealthScore"], 72)
        self.assertIsNotNone(item["framesByteLen"])

    def test_sessions_score_uses_last_ps_score_not_session_score(self):
        """关键回归：list 端点的 score 必须用「末帧 ps.score」（终局真实分），不能直接读 sessions.score。

        之前 bug：sessions.score 是对局进行中的最后同步值，与 /api/replay-sessions 不一致，
        导致 audit 页和回放页显示的分数对不上（截图：回放显示 700/1000/4020，audit 显示 0/0/6030）。
        """
        import sqlite3
        import json as _json
        db_path = os.environ["OPENBLOCK_DB_PATH"]
        conn = sqlite3.connect(db_path)
        try:
            # 模拟真实数据：sessions.score=0（进行中未同步），但末帧 ps.score=4020 是真实终局分
            conn.execute(
                "INSERT INTO sessions (id, user_id, strategy, score, start_time, status) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (888777, "uScoreTest", "normal", 0, int(__import__('time').time()), "completed"),
            )
            conn.execute(
                "INSERT INTO move_sequences (session_id, user_id, frames) VALUES (?, ?, ?)",
                (888777, "uScoreTest", _json.dumps([
                    {"t": "init", "ps": {"score": 0}},
                    {"t": "place", "ps": {"score": 100}},
                    {"t": "place", "ps": {"score": 2300}},
                    {"t": "place", "ps": {"score": 4020}},
                ])),
            )
            conn.commit()
        finally:
            conn.close()

        r = self.client.get("/api/profile-audit/sessions?user_id=uScoreTest")
        items = r.json
        self.assertEqual(len(items), 1)
        item = items[0]
        # ★ 关键断言：score 走末帧 ps.score 口径（4020），而不是 sessions.score（0）
        self.assertEqual(item["score"], 4020,
                         "score 应当来自末帧 ps.score（4020），不是 sessions.score（0）")
        self.assertEqual(item["rawSessionScore"], 0)
        self.assertEqual(item["placeSteps"], 3)

    def test_users_list_requires_db_debug(self):
        """跨用户列表默认锁死，未开 OPENBLOCK_DB_DEBUG 返回空 [] 不暴露 user_id"""
        prev = os.environ.pop("OPENBLOCK_DB_DEBUG", None)
        try:
            r = self.client.get("/api/profile-audit/users")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json, [])
        finally:
            if prev is not None:
                os.environ["OPENBLOCK_DB_DEBUG"] = prev

    def test_users_list_returns_all_when_debug_enabled(self):
        """开 OPENBLOCK_DB_DEBUG=1 → 列出所有有 session 的 user_id"""
        import sqlite3
        import json as _json
        prev = os.environ.get("OPENBLOCK_DB_DEBUG", "")
        os.environ["OPENBLOCK_DB_DEBUG"] = "1"
        try:
            db_path = os.environ["OPENBLOCK_DB_PATH"]
            conn = sqlite3.connect(db_path)
            try:
                for sid, uid in [(888001, "uAlice"), (888002, "uBob"), (888003, "uAlice")]:
                    conn.execute(
                        "INSERT INTO sessions (id, user_id, strategy, score, start_time, status) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (sid, uid, "normal", 50, 1700000000 + sid, "completed"),
                    )
                    conn.execute(
                        "INSERT INTO move_sequences (session_id, user_id, frames) VALUES (?, ?, ?)",
                        (sid, uid, _json.dumps([{"t": "init"}])),
                    )
                conn.commit()
            finally:
                conn.close()
            self.client.post(
                "/api/profile-audit/888002",
                json={"user_id": "uBob", "report": _sample_report(score=72)},
            )
            r = self.client.get("/api/profile-audit/users")
            self.assertEqual(r.status_code, 200)
            users = {u["userId"]: u for u in r.json}
            self.assertIn("uAlice", users)
            self.assertIn("uBob", users)
            self.assertEqual(users["uAlice"]["sessionCount"], 2)
            self.assertEqual(users["uAlice"]["auditCount"], 0)
            self.assertEqual(users["uBob"]["sessionCount"], 1)
            self.assertEqual(users["uBob"]["auditCount"], 1)
            self.assertEqual(users["uBob"]["latestHealthScore"], 72)
        finally:
            if prev:
                os.environ["OPENBLOCK_DB_DEBUG"] = prev
            else:
                os.environ.pop("OPENBLOCK_DB_DEBUG", None)

    def test_sessions_without_audit_returns_hasAudit_false(self):
        """没跑过 audit 的 session：hasAudit=false、auditHealthScore=null"""
        import sqlite3
        import json as _json
        db_path = os.environ["OPENBLOCK_DB_PATH"]
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                "INSERT INTO sessions (id, user_id, strategy, score, start_time, status) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (777002, "uPending", "normal", 50, int(__import__('time').time()), "active"),
            )
            conn.execute(
                "INSERT INTO move_sequences (session_id, user_id, frames) VALUES (?, ?, ?)",
                (777002, "uPending", _json.dumps([{"t": "init"}])),
            )
            conn.commit()
        finally:
            conn.close()

        r = self.client.get("/api/profile-audit/sessions?user_id=uPending")
        items = r.json
        self.assertEqual(len(items), 1)
        self.assertFalse(items[0]["hasAudit"])
        self.assertIsNone(items[0]["auditHealthScore"])


if __name__ == "__main__":
    # 无 pytest 时也能直接 `python3 tests/server_profile_audit_test.py` 跑
    unittest.main(verbosity=2)
