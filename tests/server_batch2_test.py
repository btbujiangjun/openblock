"""
tests/server_batch2_test.py — Batch 2 后端：CS-1/CS-2、MO-5、DA-1、UA-2/3 集成测试

跑法：
    OPENBLOCK_DB_PATH=/tmp/b2_test.db python3 -m pytest tests/server_batch2_test.py -v
或：
    python3 tests/server_batch2_test.py
"""
import os
import time
import json
import sqlite3
import tempfile
import unittest


# 纯函数单测（无需 DB / app）
class PureFunctions(unittest.TestCase):
    def test_signing_roundtrip(self):
        from server_security import sign_request, verify_request
        sig = sign_request("POST", "/api/score", {"a": 1, "b": 2})
        ok, err = verify_request(sig, "POST", "/api/score", {"b": 2, "a": 1})
        self.assertTrue(ok, err)

    def test_signing_tamper_and_expired(self):
        from server_security import sign_request, verify_request
        sig = sign_request("POST", "/api/score", {"a": 1})
        ok, _ = verify_request(sig, "POST", "/api/score", {"a": 2})
        self.assertFalse(ok)
        old = sign_request("POST", "/api/score", {"a": 1}, ts=int(time.time()) - 9999)
        ok, err = verify_request(old, "POST", "/api/score", {"a": 1})
        self.assertFalse(ok)
        self.assertEqual(err, "signature_expired")

    def test_entitlement_roundtrip(self):
        from server_security import issue_entitlement, verify_entitlement
        tok = issue_entitlement("u1", "remove_ads", expires_at=None)
        payload, err = verify_entitlement(tok)
        self.assertIsNone(err)
        self.assertEqual(payload["uid"], "u1")
        self.assertEqual(payload["sku"], "remove_ads")

    def test_entitlement_tamper_and_expiry(self):
        from server_security import issue_entitlement, verify_entitlement
        tok = issue_entitlement("u1", "remove_ads")
        body, _, sig = tok.partition(".")
        bad = body + "." + ("0" * len(sig))
        _, err = verify_entitlement(bad)
        self.assertEqual(err, "signature_mismatch")
        expired = issue_entitlement("u1", "weekly_pass", expires_at=int(time.time()) - 10)
        _, err2 = verify_entitlement(expired)
        self.assertEqual(err2, "expired")

    def test_authoritative_score(self):
        from server_authority import authoritative_score_check
        self.assertTrue(authoritative_score_check(500, {"placements": 50, "clears": 5})["ok"])
        self.assertFalse(authoritative_score_check(-5, {})["ok"])
        r = authoritative_score_check(100, {"placements": 0, "clears": 0})
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "score_without_placements")
        r2 = authoritative_score_check(10_000_000, {"placements": 3, "clears": 0})
        self.assertFalse(r2["ok"])
        self.assertEqual(r2["reason"], "exceeds_bound")

    def test_north_star(self):
        from server_authority import north_star_metrics
        m = north_star_metrics([
            {"score": 120, "best_before": 100, "clears": 3, "placements": 10, "combo": 2, "duration": 90},
            {"score": 50, "best_before": 100, "clears": 0, "placements": 8, "combo": 0, "duration": 30},
        ])
        self.assertEqual(m["sessions"], 2)
        self.assertAlmostEqual(m["pbBreakRate"], 0.5, places=4)
        self.assertAlmostEqual(m["juiceCoverage"], 0.5, places=4)
        self.assertAlmostEqual(m["engagedSessionRate"], 0.5, places=4)

    def test_cohort_roi(self):
        from server_authority import cohort_roi
        out = cohort_roi([
            {"key": "applovin", "installs": 100, "spend": 500, "revenue": 800, "retainedD1": 40},
            {"key": "organic", "installs": 50, "spend": 0, "revenue": 50, "retainedD1": 5},
        ])
        self.assertEqual(out[0]["key"], "applovin")
        self.assertAlmostEqual(out[0]["roas"], 1.6, places=4)
        self.assertIsNone(out[1]["roas"])  # spend=0 → ROAS null


class Endpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.mkdtemp(prefix="b2-e2e-")
        os.environ["OPENBLOCK_DB_PATH"] = os.path.join(cls._tmp, "test.db")
        os.environ["OPENBLOCK_REQUIRE_WRITE_AUTH"] = "0"
        import server
        cls.server = server
        cls.app = server.app
        cls.client = server.app.test_client()
        server.init_db()

    @classmethod
    def tearDownClass(cls):
        import shutil
        os.environ.pop("OPENBLOCK_REQUIRE_WRITE_AUTH", None)
        shutil.rmtree(cls._tmp, ignore_errors=True)

    def _seed_session(self, user_id, score, stats, attribution=None, start_offset_days=0):
        conn = sqlite3.connect(self.server.DATABASE)
        start_ms = int((time.time() - start_offset_days * 86400) * 1000)
        conn.execute(
            "INSERT INTO sessions (user_id, score, start_time, duration, game_stats, attribution) VALUES (?,?,?,?,?,?)",
            (user_id, score, start_ms, 90, json.dumps(stats), json.dumps(attribution or {})),
        )
        conn.commit()
        conn.close()

    def test_score_audit_recorded(self):
        self._seed_session("audit_user", 0, {"placements": 50, "clears": 5})
        r = self.client.post("/api/score", json={"user_id": "audit_user", "score": 500})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["success"])
        self.assertTrue(body["audit"]["ok"])

    def test_score_implausible_flagged_not_rejected_by_default(self):
        self._seed_session("cheater", 0, {"placements": 1, "clears": 0})
        r = self.client.post("/api/score", json={"user_id": "cheater", "score": 9_000_000})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["audit"]["ok"])

    def test_entitlement_flow(self):
        # 无购买 → not granted
        r0 = self.client.post("/api/entitlement/issue", json={"user_id": "ent_user", "sku": "remove_ads"})
        self.assertFalse(r0.get_json()["granted"])
        # 写一笔已完成支付，再签发
        self.client.post("/api/payment/verify", json={
            "user_id": "ent_user", "sku": "remove_ads", "provider": "stub",
            "provider_ref": "ref1", "amount_minor": 1800, "status": "completed",
        })
        r1 = self.client.post("/api/entitlement/issue", json={"user_id": "ent_user", "sku": "remove_ads"})
        body = r1.get_json()
        self.assertTrue(body["granted"])
        token = body["token"]
        r2 = self.client.post("/api/entitlement/verify", json={"token": token})
        v = r2.get_json()
        self.assertTrue(v["valid"])
        self.assertEqual(v["entitlement"]["sku"], "remove_ads")

    def test_north_star_endpoint(self):
        self._seed_session("ns1", 120, {"placements": 10, "clears": 3, "maxCombo": 2})
        r = self.client.get("/api/ops/north-star?days=7")
        self.assertEqual(r.status_code, 200)
        m = r.get_json()
        self.assertIn("juiceCoverage", m)
        self.assertGreaterEqual(m["sessions"], 1)

    def test_cohort_ltv_endpoint(self):
        self._seed_session("ch1", 100, {"placements": 5}, {"utm_source": "applovin", "utm_content": "v1"})
        self.client.post("/api/payment/verify", json={
            "user_id": "ch1", "sku": "remove_ads", "provider": "stub",
            "provider_ref": "chref", "amount_minor": 1800, "status": "completed",
        })
        r = self.client.get("/api/ops/cohort-ltv?days=30")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertFalse(body["spendImported"])
        self.assertTrue(any(c["key"] == "applovin" for c in body["channels"]))

    def test_write_auth_enforced_when_enabled(self):
        os.environ["OPENBLOCK_REQUIRE_WRITE_AUTH"] = "1"
        try:
            # 缺签名 → 401
            r = self.client.post("/api/score", json={"user_id": "wa", "score": 10})
            self.assertEqual(r.status_code, 401)
            # 正确签名 → 通过
            from server_security import sign_request
            body = {"user_id": "wa", "score": 10}
            sig = sign_request("POST", "/api/score", body)
            r2 = self.client.post("/api/score", json=body, headers={"X-Signature": sig})
            self.assertEqual(r2.status_code, 200)
        finally:
            os.environ["OPENBLOCK_REQUIRE_WRITE_AUTH"] = "0"


if __name__ == "__main__":
    unittest.main(verbosity=2)
