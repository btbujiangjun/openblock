"""
server_batch4_test.py — A/B 类：支付 Provider 验单 / Webhook 退款撤权 / 归因回传 /
花费导入 + Cohort ROAS。隔离进程运行（独立 OPENBLOCK_DB_PATH）。
"""

import os
import json
import time
import tempfile
import unittest

os.environ["OPENBLOCK_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ob_b4_{os.getpid()}.db")

import server  # noqa: E402
from server_payments import (  # noqa: E402
    verify_purchase, sign_receipt, sign_webhook, parse_webhook_event,
)


class PaymentsUnitTest(unittest.TestCase):
    def test_verify_stub_ok(self):
        ok, status, reason = verify_purchase(
            {"provider": "stub", "amount_minor": 1800, "provider_ref": "r1", "user_id": "u", "sku": "remove_ads"})
        self.assertTrue(ok)
        self.assertEqual(status, "completed")

    def test_verify_stub_reject_no_amount(self):
        ok, status, reason = verify_purchase({"provider": "stub", "amount_minor": 0, "provider_ref": "r"})
        self.assertFalse(ok)
        self.assertEqual(reason, "missing_amount_or_ref")

    def test_verify_stub_signature(self):
        payload = {"provider": "stub", "amount_minor": 1800, "provider_ref": "r1",
                   "user_id": "u", "sku": "remove_ads", "currency": "CNY"}
        payload["signature"] = sign_receipt(payload)
        ok, _, _ = verify_purchase(payload)
        self.assertTrue(ok)
        payload["signature"] = "bad"
        ok, _, reason = verify_purchase(payload)
        self.assertFalse(ok)
        self.assertEqual(reason, "bad_signature")

    def test_verify_channel_unconfigured(self):
        ok, status, _ = verify_purchase({"provider": "wechat", "amount_minor": 100, "provider_ref": "r"})
        self.assertFalse(ok)
        self.assertEqual(status, "unconfigured")

    def test_parse_webhook_event(self):
        e = parse_webhook_event("stub", {"event_type": "refund", "user_id": "u", "sku": "s", "amount_minor": 100})
        self.assertEqual(e["type"], "refund")
        e2 = parse_webhook_event("stub", {"event_type": "payment", "user_id": "u", "sku": "s"})
        self.assertEqual(e2["type"], "payment")


class PaymentsEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.client = server.app.test_client()

    def test_verify_endpoint_ok_and_reject(self):
        r = self.client.post("/api/payment/verify", json={
            "user_id": "ep_u", "sku": "remove_ads", "provider": "stub",
            "provider_ref": "epref", "amount_minor": 1800, "status": "completed"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["success"])
        r = self.client.post("/api/payment/verify", json={
            "user_id": "ep_u", "sku": "x", "provider": "stub", "provider_ref": "", "amount_minor": 0})
        self.assertEqual(r.status_code, 402)

    def test_refund_revokes_entitlement(self):
        self.client.post("/api/payment/verify", json={
            "user_id": "rf_u", "sku": "remove_ads", "provider": "stub",
            "provider_ref": "rfref", "amount_minor": 1800, "status": "completed"})
        tok = self.client.post("/api/entitlement/issue", json={"user_id": "rf_u", "sku": "remove_ads"}).get_json()["token"]
        self.assertTrue(self.client.post("/api/entitlement/verify", json={"token": tok}).get_json()["valid"])

        body = json.dumps({"event_type": "refund", "user_id": "rf_u", "sku": "remove_ads", "amount_minor": 1800}).encode()
        r = self.client.post("/api/payment/webhook?provider=stub", data=body,
                             headers={"X-OB-Signature": sign_webhook(body), "Content-Type": "application/json"})
        self.assertEqual(r.status_code, 200)
        v = self.client.post("/api/entitlement/verify", json={"token": tok}).get_json()
        self.assertFalse(v["valid"])
        self.assertEqual(v["reason"], "revoked")

    def test_webhook_bad_signature(self):
        body = json.dumps({"event_type": "payment", "user_id": "u", "sku": "s"}).encode()
        r = self.client.post("/api/payment/webhook?provider=stub", data=body, headers={"X-OB-Signature": "bad"})
        self.assertEqual(r.status_code, 401)

    def test_webhook_payment_inserts(self):
        body = json.dumps({"event_type": "payment", "user_id": "wh_u", "sku": "weekly_pass",
                           "amount_minor": 1200, "provider_ref": "whref"}).encode()
        r = self.client.post("/api/payment/webhook?provider=stub", data=body,
                             headers={"X-OB-Signature": sign_webhook(body), "Content-Type": "application/json"})
        self.assertEqual(r.get_json()["type"], "payment")
        rec = self.client.get("/api/ops/reconcile?days=7").get_json()
        self.assertGreaterEqual(rec["webhookPayments"]["count"], 1)

    def test_attribution_postback_idempotent(self):
        for _ in range(2):
            r = self.client.post("/api/attribution/postback", json={
                "user_id": "at_u", "media_source": "applovin", "campaign": "al", "creative": "cr1"})
            self.assertEqual(r.status_code, 200)
        row = server.get_db_for_test() if hasattr(server, "get_db_for_test") else None
        # 直接查库验证唯一
        import sqlite3
        conn = sqlite3.connect(server.DATABASE)
        cnt = conn.execute("SELECT COUNT(*) FROM attributions WHERE user_id=?", ("at_u",)).fetchone()[0]
        conn.close()
        self.assertEqual(cnt, 1)

    def test_spend_import_and_cohort_roas(self):
        import sqlite3
        conn = sqlite3.connect(server.DATABASE)
        now_ms = int(time.time() * 1000)
        # 一个 applovin 渠道用户 + 付费
        conn.execute("INSERT INTO sessions (user_id, score, start_time, attribution) VALUES (?,?,?,?)",
                     ("co_u", 500, now_ms, json.dumps({"utm_source": "applovin", "utm_content": "cr1"})))
        conn.execute("INSERT INTO payments (user_id, sku, provider, provider_ref, amount_minor, status) VALUES (?,?,?,?,?,?)",
                     ("co_u", "remove_ads", "stub", "cref", 1800, "completed"))
        conn.commit(); conn.close()

        today = time.strftime("%Y-%m-%d", time.gmtime())
        r = self.client.post("/api/ops/spend/import", json={"rows": [
            {"date": today, "source": "applovin", "spend": 10.0, "installs": 5}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["imported"], 1)

        co = self.client.get("/api/ops/cohort-ltv?days=30").get_json()
        self.assertTrue(co["spendImported"])
        al = [c for c in co["channels"] if c["key"] == "applovin"]
        self.assertTrue(al)
        self.assertIsNotNone(al[0].get("roas"))


if __name__ == "__main__":
    unittest.main()
