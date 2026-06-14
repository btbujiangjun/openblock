"""
server_flywheel_test.py — 增长飞轮：行为批量上报 / 广告按次计费回流（ad_revenue）/
ecpm 正确性 / 混合 ARPDAU / Cohort 广告收益并入 ROAS。隔离进程（独立 DB）。
"""

import os
import json
import time
import sqlite3
import tempfile
import unittest

os.environ["OPENBLOCK_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ob_fw_{os.getpid()}.db")

import server  # noqa: E402


class BehaviorBatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()

    def test_batch_inserts_behaviors(self):
        r = self.client.post("/api/behavior/batch", json={"events": [
            {"event_type": "game_start", "user_id": "b_u", "session_id": "s1", "timestamp": int(time.time() * 1000)},
            {"event_type": "game_end", "user_id": "b_u", "session_id": "s1", "data": {"score": 100}},
        ]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["inserted"], 2)
        conn = sqlite3.connect(server.DATABASE)
        cnt = conn.execute("SELECT COUNT(*) FROM behaviors WHERE user_id=?", ("b_u",)).fetchone()[0]
        conn.close()
        self.assertEqual(cnt, 2)

    def test_batch_requires_events(self):
        self.assertEqual(self.client.post("/api/behavior/batch", json={}).status_code, 400)


class AdImpressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()

    def test_ad_impression_records_revenue_and_behaviors(self):
        r = self.client.post("/api/ad/impression", json={
            "user_id": "ad_u", "kind": "rewarded", "revenue_minor": 5,
            "filled": True, "completed": True, "event_id": "e_ad_1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["recorded"], 1)
        self.assertEqual(r.get_json()["revenueMinor"], 5)
        conn = sqlite3.connect(server.DATABASE)
        rev = conn.execute("SELECT SUM(revenue_minor) FROM ad_revenue WHERE user_id=?", ("ad_u",)).fetchone()[0]
        shows = conn.execute("SELECT COUNT(*) FROM behaviors WHERE user_id=? AND event_type='ad_show'", ("ad_u",)).fetchone()[0]
        comps = conn.execute("SELECT COUNT(*) FROM behaviors WHERE user_id=? AND event_type='ad_complete'", ("ad_u",)).fetchone()[0]
        conn.close()
        self.assertEqual(rev, 5)
        self.assertEqual(shows, 1)
        self.assertEqual(comps, 1)

    def test_ad_impression_dedup_by_event_id(self):
        payload = {"user_id": "dd_u", "kind": "interstitial", "revenue_minor": 2,
                   "filled": True, "completed": True, "event_id": "e_dup"}
        self.client.post("/api/ad/impression", json=payload)
        self.client.post("/api/ad/impression", json=payload)  # 重复
        conn = sqlite3.connect(server.DATABASE)
        cnt = conn.execute("SELECT COUNT(*) FROM ad_revenue WHERE event_id=?", ("e_dup",)).fetchone()[0]
        conn.close()
        self.assertEqual(cnt, 1)

    def test_ad_impression_batch(self):
        r = self.client.post("/api/ad/impression", json={"events": [
            {"user_id": "bt_u", "kind": "rewarded", "revenue_minor": 5, "filled": True, "completed": True, "event_id": "bt1"},
            {"user_id": "bt_u", "kind": "interstitial", "revenue_minor": 2, "filled": True, "completed": True, "event_id": "bt2"},
        ]})
        self.assertEqual(r.get_json()["recorded"], 2)
        self.assertEqual(r.get_json()["revenueMinor"], 7)


class OpsAdMetricsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()
        now_ms = int(time.time() * 1000)
        conn = sqlite3.connect(server.DATABASE)
        # 一个活跃用户（用于 DAU/ARPDAU 分母）
        conn.execute("INSERT INTO sessions (user_id, score, start_time) VALUES (?,?,?)", ("om_u", 300, now_ms))
        # 4 次广告展示（行为）+ 收益 20 分（¥0.20）
        for i in range(4):
            conn.execute("INSERT INTO behaviors (user_id, event_type, event_data, timestamp) VALUES (?,?,?,?)",
                         ("om_u", "ad_show", "{}", now_ms))
            conn.execute("INSERT INTO ad_revenue (event_id, user_id, kind, revenue_minor, filled, ts) VALUES (?,?,?,?,?,?)",
                         (f"om_{i}", "om_u", "rewarded", 5, 1, now_ms))
        conn.commit(); conn.close()

    def test_ecpm_and_blended_arpdau(self):
        d = self.client.get("/api/ops/dashboard?days=7").get_json()
        ads = d["businessMetrics"]["ads"]
        rev = d["coreMetrics"]["revenue"]
        # ecpm 由 ad_revenue 表驱动（修复此前恒为 0 的缺陷），且 > 0
        self.assertGreater(ads["ecpm"], 0.0)
        self.assertGreater(rev["adRevenue"], 0.0)
        # 按 DB 实际值核对 ecpm 公式正确性（窗口内 收益*1000/展示数），对共享库稳健
        since_ms = (int(time.time()) - 7 * 86400) * 1000
        conn = sqlite3.connect(server.DATABASE)
        rev_minor = conn.execute("SELECT COALESCE(SUM(revenue_minor),0) FROM ad_revenue WHERE ts >= ?", (since_ms,)).fetchone()[0]
        shows = conn.execute("SELECT COUNT(*) FROM behaviors WHERE event_type='ad_show' AND timestamp >= ?", (since_ms,)).fetchone()[0]
        conn.close()
        expected = round((rev_minor / 100.0) * 1000.0 / shows, 4)
        self.assertAlmostEqual(ads["ecpm"], expected, places=2)
        # 混合 ARPDAU ≥ 纯 IAP ARPDAU（含广告收益）
        self.assertGreaterEqual(rev["arpdau"], rev["iapArpdau"])

    def test_cohort_blends_ad_revenue(self):
        co = self.client.get("/api/ops/cohort-ltv?days=30").get_json()
        # 至少应有渠道（organic 兜底），且 LTV 计入广告收益不报错
        self.assertIn("channels", co)


if __name__ == "__main__":
    unittest.main()
