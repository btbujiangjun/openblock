"""
server_batch5_test.py — C1 类：RT-4 分渠道留存 / DA-3 护栏自动暂停。隔离进程。
"""

import os
import json
import time
import tempfile
import sqlite3
import unittest

os.environ["OPENBLOCK_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ob_b5_{os.getpid()}.db")

import server  # noqa: E402
from server_authority import evaluate_guardrails  # noqa: E402


class GuardrailUnitTest(unittest.TestCase):
    def test_significant_regression_recommends_pause(self):
        buckets = [
            {"bucket": "0", "isControl": True},
            {"bucket": "1", "isControl": False, "upliftRel": -0.12, "significant": True,
             "ci95": [-0.08, -0.02], "insufficientData": False},
        ]
        v = evaluate_guardrails(buckets)
        self.assertTrue(v["recommendPause"])
        self.assertEqual(v["alerts"][0]["severity"], "error")

    def test_small_regression_warns_only(self):
        buckets = [
            {"bucket": "0", "isControl": True},
            {"bucket": "1", "isControl": False, "upliftRel": -0.04, "significant": False,
             "ci95": [-0.06, 0.02], "insufficientData": False},
        ]
        v = evaluate_guardrails(buckets)
        self.assertFalse(v["recommendPause"])
        self.assertEqual(v["alerts"][0]["severity"], "warn")

    def test_healthy_no_alerts(self):
        buckets = [
            {"bucket": "0", "isControl": True},
            {"bucket": "1", "isControl": False, "upliftRel": 0.05, "significant": True,
             "ci95": [0.01, 0.09], "insufficientData": False},
        ]
        v = evaluate_guardrails(buckets)
        self.assertEqual(v["alerts"], [])


class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()
        cls.db = server.DATABASE

    def _seed_ab(self, exp, bucket, event, n):
        for i in range(n):
            self.client.post("/api/ab/report", json={
                "userId": f"u{bucket}_{i}", "experiment": exp, "bucket": bucket, "event": event})

    def test_guardrails_autopause(self):
        exp = "exp_guard"
        # 对照桶 D1 回访好，处理桶明显差 → 显著回归
        self._seed_ab(exp, 0, "exposure", 200)
        self._seed_ab(exp, 0, "d1_return", 100)   # 50%
        self._seed_ab(exp, 1, "exposure", 200)
        self._seed_ab(exp, 1, "d1_return", 60)    # 30%
        r = self.client.get(f"/api/ops/guardrails?experiment={exp}&autopause=1").get_json()
        self.assertTrue(r["recommendPause"])
        self.assertTrue(r["paused"])
        # 状态可读
        st = self.client.get(f"/api/experiment/state?experiment={exp}").get_json()
        self.assertTrue(st["paused"])

    def test_pb_compare(self):
        # 好友关系：me 邀请 hi（高分），lo 邀请 me（低分）
        conn = sqlite3.connect(self.db)
        for uid, sc in [("pb_me", 500), ("pb_hi", 900), ("pb_lo", 200), ("pb_stranger", 5000)]:
            conn.execute("INSERT INTO scores (user_id, score, timestamp) VALUES (?,?,?)", (uid, sc, int(time.time())))
        conn.commit(); conn.close()
        self.client.post("/api/invite/record", json={"inviter_id": "pb_me", "invitee_id": "pb_hi"})
        self.client.post("/api/invite/record", json={"inviter_id": "pb_lo", "invitee_id": "pb_me"})
        r = self.client.get("/api/social/pb-compare?user_id=pb_me").get_json()
        self.assertEqual(r["myBest"], 500)
        self.assertEqual(r["gapToNext"], 400)        # 900 - 500
        self.assertEqual(r["nextFriend"], "pb_hi")
        ids = [e["user_id"] for e in r["ranking"]]
        self.assertNotIn("pb_stranger", ids)

    def test_retention_by_channel(self):
        conn = sqlite3.connect(self.db)
        day_ms = 86400000
        base = int(time.time() * 1000) - 3 * day_ms
        # applovin 用户：D0 + D1 回访
        conn.execute("INSERT INTO sessions (user_id, score, start_time, attribution) VALUES (?,?,?,?)",
                     ("rc_a", 100, base, json.dumps({"utm_source": "applovin"})))
        conn.execute("INSERT INTO sessions (user_id, score, start_time, attribution) VALUES (?,?,?,?)",
                     ("rc_a", 120, base + day_ms, json.dumps({"utm_source": "applovin"})))
        # organic 用户：仅 D0
        conn.execute("INSERT INTO sessions (user_id, score, start_time, attribution) VALUES (?,?,?,?)",
                     ("rc_o", 90, base, json.dumps({"utm_source": "organic"})))
        conn.commit(); conn.close()
        r = self.client.get("/api/ops/retention-by-channel?days=14").get_json()
        chans = {c["channel"]: c for c in r["channels"]}
        self.assertIn("applovin", chans)
        self.assertGreaterEqual(chans["applovin"]["d1"], chans["organic"]["d1"])


class ReplayAndProfileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()

    def test_replay_recompute_ok_and_mismatch(self):
        from server_replay import recompute_score
        events = [
            {"type": "place"},
            {"type": "clear", "lines": 2, "combo": 1},   # 2*10 + 1*10 + 1*5 = 35
            {"type": "clear", "lines": 1, "combo": 0, "perfect": True},  # 10 + 100 = 110
        ]
        rc = recompute_score(events)
        self.assertEqual(rc["score"], 145)
        self.assertEqual(rc["clears"], 2)

        ok = self.client.post("/api/score/replay-verify", json={"reported_score": 145, "events": events}).get_json()
        self.assertTrue(ok["ok"])
        bad = self.client.post("/api/score/replay-verify", json={"reported_score": 9999, "events": events}).get_json()
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["reason"], "score_mismatch")

    def test_profile_sync_and_get(self):
        r = self.client.post("/api/profile/sync", json={
            "user_id": "sg_u", "profile": {"skill": 0.7, "fav": "zen"},
            "spendTier": "dolphin", "valueTier": "T3", "segment": "B", "lifecycleStage": "growth"})
        self.assertTrue(r.get_json()["success"])
        self.assertEqual(r.get_json()["rev"], 1)
        # 二次写 rev 自增
        r2 = self.client.post("/api/profile/sync", json={"user_id": "sg_u", "profile": {"skill": 0.8}})
        self.assertEqual(r2.get_json()["rev"], 2)
        # 跨设备拉取
        g = self.client.get("/api/profile/get?user_id=sg_u").get_json()
        self.assertTrue(g["exists"])
        self.assertEqual(g["profile"]["skill"], 0.8)
        self.assertEqual(g["rev"], 2)
        miss = self.client.get("/api/profile/get?user_id=nobody").get_json()
        self.assertFalse(miss["exists"])


if __name__ == "__main__":
    unittest.main()
