"""
tests/server_batch3_test.py — Batch 3 后端：DA-2（A/B uplift）、SO-2（邀请/K 因子）

跑法：
    OPENBLOCK_DB_PATH=/tmp/b3_test.db python3 -m pytest tests/server_batch3_test.py -v
或：
    python3 tests/server_batch3_test.py
"""
import os
import time
import sqlite3
import tempfile
import unittest


class PureFunctions(unittest.TestCase):
    def test_two_proportion_uplift_significant(self):
        from server_authority import two_proportion_uplift
        r = two_proportion_uplift(
            {"n": 1000, "conversions": 100},   # 10%
            {"n": 1000, "conversions": 160},   # 16%
        )
        self.assertAlmostEqual(r["controlRate"], 0.10, places=4)
        self.assertAlmostEqual(r["treatmentRate"], 0.16, places=4)
        self.assertGreater(r["upliftAbs"], 0)
        self.assertTrue(r["significant"])
        self.assertEqual(len(r["ci95"]), 2)
        self.assertLess(r["ci95"][0], r["ci95"][1])

    def test_two_proportion_uplift_insufficient(self):
        from server_authority import two_proportion_uplift
        r = two_proportion_uplift({"n": 0, "conversions": 0}, {"n": 10, "conversions": 1})
        self.assertTrue(r["insufficientData"])
        self.assertFalse(r["significant"])

    def test_ab_uplift_from_counts(self):
        from server_authority import ab_uplift_from_counts
        buckets = {
            "0": {"exposure": 500, "conversion": 50},
            "1": {"exposure": 500, "conversion": 90},
        }
        out = ab_uplift_from_counts(buckets)
        self.assertEqual(len(out), 2)
        self.assertTrue(out[0]["isControl"])
        self.assertFalse(out[1]["isControl"])
        self.assertGreater(out[1]["upliftAbs"], 0)

    def test_k_factor(self):
        from server_authority import k_factor
        r = k_factor(invites_sent=200, conversions=80, active_users=100)
        # i = 2.0, c = 0.4 → K = 0.8
        self.assertAlmostEqual(r["invitesPerUser"], 2.0, places=4)
        self.assertAlmostEqual(r["conversionRate"], 0.4, places=4)
        self.assertAlmostEqual(r["kFactor"], 0.8, places=4)
        self.assertFalse(r["viral"])
        r2 = k_factor(300, 150, 100)  # i=3, c=0.5 → K=1.5
        self.assertTrue(r2["viral"])

    def test_k_factor_zero_guards(self):
        from server_authority import k_factor
        r = k_factor(0, 0, 0)
        self.assertEqual(r["kFactor"], 0.0)

    def test_telemetry_quality(self):
        from server_authority import telemetry_quality
        recs = [{"sentTs": 0, "ackTs": 100}, {"sentTs": 0, "ackTs": 200},
                {"sentTs": 0, "lost": True}, {"sentTs": 0}, {"sentTs": 100, "ackTs": 50}]
        q = telemetry_quality(recs)
        self.assertEqual(q["total"], 5)
        self.assertEqual(q["lost"], 3)
        self.assertEqual(q["delivered"], 2)
        self.assertAlmostEqual(q["lossRate"], 0.6, places=4)
        self.assertFalse(q["healthy"])  # 高丢失率
        self.assertTrue(q["lowSample"])

    def test_telemetry_quality_healthy(self):
        from server_authority import telemetry_quality
        recs = [{"sentTs": 0, "ackTs": 100} for _ in range(100)]
        q = telemetry_quality(recs)
        self.assertTrue(q["healthy"])
        self.assertEqual(q["alerts"], [])


class Endpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.mkdtemp(prefix="b3-e2e-")
        os.environ["OPENBLOCK_DB_PATH"] = os.path.join(cls._tmp, "test.db")
        os.environ["OPENBLOCK_REQUIRE_WRITE_AUTH"] = "0"
        import server
        cls.server = server
        cls.client = server.app.test_client()
        server.init_db()

    @classmethod
    def tearDownClass(cls):
        import shutil
        os.environ.pop("OPENBLOCK_REQUIRE_WRITE_AUTH", None)
        shutil.rmtree(cls._tmp, ignore_errors=True)

    def _seed_ab(self, experiment, bucket, event, n):
        for _ in range(n):
            self.client.post("/api/ab/report", json={
                "userId": f"u{bucket}_{_}", "experiment": experiment,
                "bucket": bucket, "event": event, "ts": int(time.time() * 1000),
            })

    def test_ab_uplift_endpoint(self):
        exp = "warmrun_v1"
        self._seed_ab(exp, 0, "exposure", 100)
        self._seed_ab(exp, 0, "conversion", 10)
        self._seed_ab(exp, 1, "exposure", 100)
        self._seed_ab(exp, 1, "conversion", 25)
        r = self.client.get(f"/api/ops/ab-uplift?experiment={exp}")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["experiment"], exp)
        buckets = {b["bucket"]: b for b in body["buckets"]}
        self.assertTrue(buckets["0"]["isControl"])
        self.assertGreater(buckets["1"]["upliftAbs"], 0)

    def test_ab_uplift_requires_experiment(self):
        r = self.client.get("/api/ops/ab-uplift")
        self.assertEqual(r.status_code, 400)

    def test_invite_record_and_k_factor(self):
        # 制造 active users（sessions）
        conn = sqlite3.connect(self.server.DATABASE)
        now_ms = int(time.time() * 1000)
        for i in range(4):
            conn.execute(
                "INSERT INTO sessions (user_id, score, start_time) VALUES (?,?,?)",
                (f"kf_user{i}", 100, now_ms),
            )
        conn.commit()
        conn.close()

        r1 = self.client.post("/api/invite/record", json={
            "inviter_id": "kf_user0", "invitee_id": "newbie_a", "invite_code": "X1",
        })
        self.assertTrue(r1.get_json()["success"])
        # 幂等：同一被邀请者重复 → deduped
        r2 = self.client.post("/api/invite/record", json={
            "inviter_id": "kf_user0", "invitee_id": "newbie_a", "invite_code": "X1",
        })
        self.assertTrue(r2.get_json().get("deduped"))
        self.client.post("/api/invite/record", json={
            "inviter_id": "kf_user1", "invitee_id": "newbie_b", "invite_code": "X2",
        })

        r = self.client.get("/api/ops/k-factor?days=30")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["invitesSent"], 2)
        self.assertEqual(body["conversions"], 2)
        self.assertGreaterEqual(body["activeUsers"], 4)
        self.assertIn("kFactor", body)

    def test_invite_requires_inviter(self):
        r = self.client.post("/api/invite/record", json={"invitee_id": "x"})
        self.assertEqual(r.status_code, 400)

    def test_telemetry_report_and_health(self):
        recs = [{"event": "analytics_events", "sentTs": 1000, "ackTs": 1100} for _ in range(40)]
        recs.append({"event": "analytics_events", "sentTs": 1000, "lost": True})
        r = self.client.post("/api/telemetry/report", json={"user_id": "tel_u", "records": recs})
        self.assertTrue(r.get_json()["success"])
        self.assertEqual(r.get_json()["inserted"], 41)
        h = self.client.get("/api/ops/telemetry-health?days=7").get_json()
        self.assertEqual(h["total"], 41)
        self.assertEqual(h["lost"], 1)
        self.assertIn("latencyP95", h)
        self.assertIn("alerts", h)

    def test_telemetry_report_requires_records(self):
        r = self.client.post("/api/telemetry/report", json={"user_id": "x", "records": []})
        self.assertEqual(r.status_code, 400)

    def test_leaderboard_board_scopes(self):
        import sqlite3
        conn = sqlite3.connect(self.server.DATABASE)
        now = int(time.time())
        # all/weekly：scores 表
        for uid, sc in [("lb_a", 500), ("lb_b", 900), ("lb_c", 300)]:
            conn.execute("INSERT INTO scores (user_id, score, timestamp) VALUES (?,?,?)", (uid, sc, now))
        # 旧分（8 天前）不计入周榜
        conn.execute("INSERT INTO scores (user_id, score, timestamp) VALUES (?,?,?)",
                     ("lb_old", 9999, now - 8 * 86400))
        conn.commit(); conn.close()

        allb = self.client.get("/api/leaderboard/board?scope=all&limit=10").get_json()
        self.assertEqual(allb["scope"], "all")
        self.assertEqual(allb["entries"][0]["user_id"], "lb_old")  # 历史最高

        wk = self.client.get("/api/leaderboard/board?scope=weekly&limit=10").get_json()
        wk_ids = [e["user_id"] for e in wk["entries"]]
        self.assertIn("lb_b", wk_ids)
        self.assertNotIn("lb_old", wk_ids)  # 8 天前不计入
        self.assertEqual(wk["entries"][0]["user_id"], "lb_b")

    def test_leaderboard_friends(self):
        import sqlite3
        conn = sqlite3.connect(self.server.DATABASE)
        now = int(time.time())
        for uid, sc in [("fr_me", 100), ("fr_x", 800), ("fr_y", 400), ("stranger", 5000)]:
            conn.execute("INSERT INTO scores (user_id, score, timestamp) VALUES (?,?,?)", (uid, sc, now))
        conn.commit(); conn.close()
        # 邀请关系：me 邀请 x；y 邀请 me
        self.client.post("/api/invite/record", json={"inviter_id": "fr_me", "invitee_id": "fr_x"})
        self.client.post("/api/invite/record", json={"inviter_id": "fr_y", "invitee_id": "fr_me"})

        fr = self.client.get("/api/leaderboard/board?scope=friends&user_id=fr_me").get_json()
        ids = [e["user_id"] for e in fr["entries"]]
        self.assertIn("fr_me", ids)
        self.assertIn("fr_x", ids)
        self.assertIn("fr_y", ids)
        self.assertNotIn("stranger", ids)  # 非好友不在榜
        self.assertEqual(fr["entries"][0]["user_id"], "fr_x")  # 800 最高
        self.assertIsNotNone(fr["myRank"])

    def test_leaderboard_friends_requires_user(self):
        r = self.client.get("/api/leaderboard/board?scope=friends")
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
