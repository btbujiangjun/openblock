"""
server_replay.py — 服务端回放重算（CS-1，权威分数进阶）

在 plausibility（authoritative_score_check）之上，提供基于操作日志的**确定性重算**：
客户端上报 move/clear 事件序列，服务端用同一套计分规则复算总分，与上报分比对，
偏差超阈值判为异常。规则口径需与 shared/game_rules.json 保持一致（此处取通用线性
计分：每行基础分 + 连击加成 + 全清奖励）。纯函数，便于单测。
"""

from __future__ import annotations

DEFAULT_SCORE_RULES = {
    "pointsPerLine": 10,
    "multiLineBonus": 10,   # 一次消除多行的额外加成（每多一行）
    "comboBonus": 5,        # 每级连击加成
    "perfectClearBonus": 100,
    "tolerance": 0,         # 允许的绝对误差（确定性应为 0）
}


def recompute_score(events, rules=None):
    """
    根据事件序列重算分数。
    events: [{ type:'clear', lines:int, combo:int, perfect:bool } | { type:'place', ... }]
    返回 { score, clears, placements, maxCombo }。
    """
    r = {**DEFAULT_SCORE_RULES, **(rules or {})}
    score = 0
    clears = 0
    placements = 0
    max_combo = 0
    for ev in events or []:
        etype = ev.get("type")
        if etype == "place":
            placements += 1
        elif etype == "clear":
            lines = max(0, int(ev.get("lines", 0) or 0))
            combo = max(0, int(ev.get("combo", 0) or 0))
            if lines <= 0:
                continue
            clears += 1
            max_combo = max(max_combo, combo)
            score += lines * r["pointsPerLine"]
            if lines > 1:
                score += (lines - 1) * r["multiLineBonus"]
            score += combo * r["comboBonus"]
            if ev.get("perfect"):
                score += r["perfectClearBonus"]
    return {"score": score, "clears": clears, "placements": placements, "maxCombo": max_combo}


def verify_replay(reported_score, events, rules=None):
    """
    比对重算分与上报分。返回 { ok, recomputed, reported, diff, reason }。
    """
    r = {**DEFAULT_SCORE_RULES, **(rules or {})}
    recomputed = recompute_score(events, r)
    rs = int(recomputed["score"])
    reported = int(reported_score or 0)
    diff = abs(rs - reported)
    if not events:
        return {"ok": False, "recomputed": rs, "reported": reported, "diff": diff, "reason": "no_events"}
    ok = diff <= int(r["tolerance"])
    return {
        "ok": ok,
        "recomputed": rs,
        "reported": reported,
        "diff": diff,
        "reason": "ok" if ok else "score_mismatch",
        "stats": recomputed,
    }
