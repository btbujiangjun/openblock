#!/usr/bin/env python3
"""
seed_demo_data.py — 为运营看板写入 Demo 数据（B 类「接通管线 + Demo 数据」）

让 /ops 各卡片（北极星 / Cohort LTV·ROAS / K 因子 / 埋点健康 / 分渠道留存 / 对账）
在无真实流量时也能展示非空、自洽的数据。所有数据写入 OPENBLOCK_DB_PATH 指定库。

用法：
    OPENBLOCK_DB_PATH=/tmp/openblock_demo.db python3 scripts/seed_demo_data.py [--users 200] [--days 30]
"""

import os
import sys
import json
import time
import random
import argparse
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

# 与 web/src/monetization/providerConfig.js channelMix 对齐
# 买量用户单价（CPI）统一按 2 元/安装计（需求 1）。
CPI_CNY = 2.0
CHANNELS = [
    # (source, medium, campaign, content, weight, cpi_cny, pay_rate, ecpm_factor)
    ("organic", "organic", "organic", "", 0.42, 0.0, 0.012, 1.0),
    ("applovin", "cpi", "al_global_roas", "cr_video_01", 0.22, CPI_CNY, 0.030, 1.15),
    ("unity", "cpi", "unity_ww", "cr_playable_02", 0.16, CPI_CNY, 0.024, 1.05),
    ("google_uac", "cpi", "uac_install", "cr_html_03", 0.13, CPI_CNY, 0.028, 1.10),
    ("facebook", "cpi", "fb_aaa", "cr_carousel_04", 0.07, CPI_CNY, 0.035, 1.20),
]
SKUS = [("remove_ads", 1800), ("weekly_pass", 1200), ("monthly_pass", 2800), ("starter_pack", 300)]


def _weighted_channel(rng):
    r = rng.random() * sum(c[4] for c in CHANNELS)
    for c in CHANNELS:
        r -= c[4]
        if r <= 0:
            return c
    return CHANNELS[0]


def seed(users=200, days=30, seed_val=42):
    rng = random.Random(seed_val)
    server.init_db()
    conn = sqlite3.connect(server.DATABASE)
    cur = conn.cursor()
    now = int(time.time())
    now_ms = now * 1000

    # 按次计费配置（与 web/src/monetization/providerConfig.js 对齐）
    ad_price_minor = {"interstitial": 2, "rewarded": 5}  # ¥0.02 / ¥0.05
    ad_fill = 0.92

    # 清理旧 demo（避免重复累积）
    for tbl in ("sessions", "scores", "payments", "ad_spend", "telemetry_events",
                "invites", "attributions", "user_stats", "ad_revenue", "behaviors"):
        cur.execute(f"DELETE FROM {tbl} WHERE 1=1")

    channel_installs = {}
    paid_users = []
    for i in range(users):
        uid = f"demo_{i:04d}"
        ch = _weighted_channel(rng)
        source, medium, campaign, content, _, cpi, pay_rate, ecpm_f = ch
        key = f"{source}/{content}" if content else source
        channel_installs[key] = channel_installs.get(key, 0) + 1

        # 安装日（过去 days 天内）
        install_day = rng.randint(0, days - 1)
        install_ts = now - install_day * 86400 - rng.randint(0, 86400)
        attr = {
            "utm_source": source, "utm_medium": medium,
            "utm_campaign": campaign, "utm_content": content, "ts": install_ts * 1000,
        }
        attr_json = json.dumps(attr)

        cur.execute(
            "INSERT OR REPLACE INTO attributions (user_id, media_source, medium, campaign, adset, creative, resolver, via, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (uid, source, medium, campaign, "", content, "stub", "resolved", install_ts),
        )

        # 该用户的若干会话（留存衰减：买量略好）
        n_sessions = 1 + int(rng.random() * (8 if source != "organic" else 5))
        best = 0
        total_score = 0
        total_clears = 0
        for s in range(n_sessions):
            sess_day = min(days - 1, install_day - int(rng.random() * (install_day + 1)))
            start_ms = (now - sess_day * 86400 - rng.randint(0, 86400)) * 1000
            score = int(rng.gauss(2600, 1400))
            score = max(120, score)
            duration = int(rng.gauss(95, 45)) * 1000
            duration = max(8000, duration)
            clears = max(0, int(score / rng.randint(70, 130)))
            placements = clears + rng.randint(10, 60)
            combo = rng.randint(0, 6)
            stats = {"clears": clears, "placements": placements, "maxCombo": combo}
            cur.execute(
                "INSERT INTO sessions (user_id, strategy, score, start_time, end_time, duration, status, game_stats, attribution) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (uid, "normal", score, start_ms, start_ms + duration, duration, "ended", json.dumps(stats), attr_json),
            )
            cur.execute("INSERT INTO scores (user_id, score, strategy, timestamp) VALUES (?,?,?,?)",
                        (uid, score, "normal", start_ms // 1000))
            best = max(best, score)
            total_score += score
            total_clears += clears

        cur.execute(
            "INSERT OR REPLACE INTO user_stats (user_id, total_games, total_score, best_score, total_clears, last_seen, last_ip) "
            "VALUES (?,?,?,?,?,?,?)",
            (uid, n_sessions, total_score, best, total_clears, now, "127.0.0.1"),
        )

        # 广告按次计费回流（需求 2）：每用户若干次激励/插屏展示。
        n_ads = int(rng.random() * (n_sessions + 2))
        for k in range(n_ads):
            kind = "rewarded" if rng.random() < 0.55 else "interstitial"
            ad_ts = (now - rng.randint(0, days * 86400)) * 1000
            filled = rng.random() < ad_fill
            rev = ad_price_minor[kind] if filled else 0
            eid = f"seed_ad_{uid}_{k}"
            cur.execute(
                "INSERT OR IGNORE INTO ad_revenue (event_id, user_id, kind, revenue_minor, platform, filled, ts) "
                "VALUES (?,?,?,?,?,?,?)",
                (eid, uid, kind, rev, "web", 1 if filled else 0, ad_ts),
            )
            cur.execute(
                "INSERT INTO behaviors (user_id, event_type, event_data, timestamp) VALUES (?,?,?,?)",
                (uid, "ad_show", json.dumps({"kind": kind}), ad_ts),
            )
            if filled:
                cur.execute(
                    "INSERT INTO behaviors (user_id, event_type, event_data, timestamp) VALUES (?,?,?,?)",
                    (uid, "ad_complete", json.dumps({"kind": kind, "revenue_minor": rev}), ad_ts),
                )

        # 付费（按渠道 pay_rate）
        if rng.random() < pay_rate * 3:  # 放大以保证 demo 有足够付费样本
            paid_users.append(uid)
            n_pay = 1 + (1 if rng.random() < 0.3 else 0)
            for _ in range(n_pay):
                sku, amt = rng.choice(SKUS)
                pay_ts = install_ts + rng.randint(0, days * 86400 // 2)
                cur.execute(
                    "INSERT INTO payments (user_id, sku, provider, provider_ref, amount_minor, currency, status, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (uid, sku, "stub", f"demo_{uid}_{sku}_{pay_ts}", amt, "CNY", "completed", pay_ts),
                )

    # 买量花费（organic 无花费）。CPI 统一 ¥2：花费 = 归因安装数 × 2，使 cohort
    # 口径 cpi = spend / installs 恰好等于 2（installs 与 cohort 归因用户数一致）。
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    for source, medium, campaign, content, weight, cpi, *_ in CHANNELS:
        if cpi <= 0:
            continue
        key = f"{source}/{content}" if content else source
        installs = channel_installs.get(key, 0)
        if installs <= 0:
            continue
        spend_minor = int(installs * CPI_CNY * 100)
        cur.execute(
            "INSERT OR REPLACE INTO ad_spend (date, channel_key, source, content, spend_minor, installs, currency) "
            "VALUES (?,?,?,?,?,?,?)",
            (today, key, source, content, spend_minor, installs, "CNY"),
        )

    # 埋点回执（绝大多数成功，少量丢失/高延迟）
    for _ in range(800):
        sent = now_ms - rng.randint(0, days * 86400 * 1000)
        if rng.random() < 0.015:
            cur.execute("INSERT INTO telemetry_events (user_id, event, sent_ts, ack_ts, lost) VALUES (?,?,?,?,?)",
                        ("demo", "analytics_events", sent, None, 1))
        else:
            lat = int(abs(rng.gauss(220, 160))) + 30
            cur.execute("INSERT INTO telemetry_events (user_id, event, sent_ts, ack_ts, lost, latency_ms) VALUES (?,?,?,?,?,?)",
                        ("demo", "analytics_events", sent, sent + lat, 0, lat))

    # 邀请（K 因子）：部分用户邀请他人
    inviters = rng.sample([f"demo_{i:04d}" for i in range(users)], k=max(1, users // 6))
    for inv in inviters:
        for _ in range(rng.randint(1, 3)):
            invitee = f"demo_{rng.randint(0, users - 1):04d}"
            if invitee == inv:
                continue
            cur.execute("INSERT INTO invites (inviter_id, invitee_id, status, created_at) VALUES (?,?,?,?)",
                        (inv, invitee, "converted", now - rng.randint(0, days * 86400)))

    conn.commit()
    summary = {
        "users": users, "days": days,
        "sessions": cur.execute("SELECT COUNT(*) FROM sessions").fetchone()[0],
        "payments": cur.execute("SELECT COUNT(*) FROM payments").fetchone()[0],
        "revenueCny": (cur.execute("SELECT COALESCE(SUM(amount_minor),0) FROM payments").fetchone()[0]) / 100.0,
        "adSpendRows": cur.execute("SELECT COUNT(*) FROM ad_spend").fetchone()[0],
        "adSpendCny": (cur.execute("SELECT COALESCE(SUM(spend_minor),0) FROM ad_spend").fetchone()[0]) / 100.0,
        "telemetry": cur.execute("SELECT COUNT(*) FROM telemetry_events").fetchone()[0],
        "invites": cur.execute("SELECT COUNT(*) FROM invites").fetchone()[0],
        "paidUsers": len(set(paid_users)),
        "adImpressions": cur.execute("SELECT COUNT(*) FROM ad_revenue").fetchone()[0],
        "adRevenueCny": (cur.execute("SELECT COALESCE(SUM(revenue_minor),0) FROM ad_revenue").fetchone()[0]) / 100.0,
    }
    conn.close()
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    summary = seed(args.users, args.days, args.seed)
    print("[seed_demo_data] DB:", server.DATABASE)
    print("[seed_demo_data] " + json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
