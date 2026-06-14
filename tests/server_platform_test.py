"""
server_platform_test.py — 分端统计：behaviors/ad_revenue 落 platform/app_version +
/api/ops/by-platform 分端聚合。隔离进程（独立 DB）。
"""

import os
import time
import sqlite3
import tempfile
import unittest

os.environ["OPENBLOCK_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ob_plat_{os.getpid()}.db")

import server  # noqa: E402


class BehaviorPlatformTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()

    def test_event_level_platform_stored(self):
        r = self.client.post("/api/behavior/batch", json={"events": [
            {"event_type": "game_start", "user_id": "p_u1", "platform": "web", "app_version": "1.2.3"},
        ]})
        self.assertEqual(r.status_code, 200)
        conn = sqlite3.connect(server.DATABASE)
        row = conn.execute(
            "SELECT platform, app_version FROM behaviors WHERE user_id=?", ("p_u1",)
        ).fetchone()
        conn.close()
        self.assertEqual(row[0], "web")
        self.assertEqual(row[1], "1.2.3")

    def test_batch_level_platform_fallback(self):
        # 事件不带 platform → 用批次级 meta 兜底
        r = self.client.post("/api/behavior/batch", json={
            "platform": "miniprogram", "app_version": "2.0.0",
            "events": [{"event_type": "game_end", "user_id": "p_u2"}],
        })
        self.assertEqual(r.status_code, 200)
        conn = sqlite3.connect(server.DATABASE)
        row = conn.execute(
            "SELECT platform, app_version FROM behaviors WHERE user_id=?", ("p_u2",)
        ).fetchone()
        conn.close()
        self.assertEqual(row[0], "miniprogram")
        self.assertEqual(row[1], "2.0.0")

    def test_ad_impression_platform_propagates_to_behaviors(self):
        r = self.client.post("/api/ad/impression", json={
            "platform": "cocos",
            "events": [{"user_id": "p_u3", "kind": "rewarded", "revenue_minor": 5,
                        "filled": True, "completed": True, "event_id": "plat_ad_1"}],
        })
        self.assertEqual(r.status_code, 200)
        conn = sqlite3.connect(server.DATABASE)
        adp = conn.execute("SELECT platform FROM ad_revenue WHERE event_id=?", ("plat_ad_1",)).fetchone()[0]
        bhp = conn.execute(
            "SELECT platform FROM behaviors WHERE user_id=? AND event_type='ad_show'", ("p_u3",)
        ).fetchone()[0]
        conn.close()
        self.assertEqual(adp, "cocos")
        self.assertEqual(bhp, "cocos")


class ByPlatformEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()
        now = int(time.time() * 1000)
        # 用独立 platform 标签隔离，避免与同进程其他用例共享 DB 串扰。
        cls.client.post("/api/behavior/batch", json={"platform": "web_e2e", "events": [
            {"event_type": "game_start", "user_id": "we1", "timestamp": now},
            {"event_type": "game_start", "user_id": "we2", "timestamp": now},
        ]})
        cls.client.post("/api/ad/impression", json={"platform": "web_e2e", "events": [
            {"user_id": "we1", "kind": "interstitial", "revenue_minor": 2, "filled": True,
             "completed": True, "event_id": "bp_web_ad", "ts": now},
        ]})
        cls.client.post("/api/behavior/batch", json={"platform": "mp_e2e", "events": [
            {"event_type": "game_start", "user_id": "me1", "timestamp": now},
        ]})

    def test_by_platform_breakdown(self):
        r = self.client.get("/api/ops/by-platform?days=14")
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        by = {p["platform"]: p for p in data["platforms"]}
        self.assertIn("web_e2e", by)
        self.assertIn("mp_e2e", by)
        self.assertEqual(by["web_e2e"]["activeUsers"], 2)
        self.assertEqual(by["mp_e2e"]["activeUsers"], 1)
        # web_e2e 有一次插屏曝光 + 收入 0.02
        self.assertGreaterEqual(by["web_e2e"]["adShows"], 1)
        self.assertAlmostEqual(by["web_e2e"]["adRevenueCny"], 0.02, places=2)


if __name__ == "__main__":
    unittest.main()
