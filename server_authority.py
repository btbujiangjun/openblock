"""
server_authority.py — 服务端权威度量与防作弊（纯函数，零三方依赖）

CS-1 服务端权威分（plausibility 权威）
-------------------------------------
不做完整回放重算（需在服务端跑整套引擎），而是基于「本局可验证统计」给出
可达上界与一致性约束，标记不可能/越界的上报分数：
  - score < 0           → 非法
  - score > 0 且 落子=0  → 不可能（没落子不可能得分）
  - score > 可达上界     → 越界（落子/消行/连击推导的宽松上界）
默认仅"标记+记录"，不拒绝（避免误杀边缘真人）；可由调用方按需拒绝。

DA-1 北极星指标（6 项 PB 指标 + 爽感覆盖率）
------------------------------------------
围绕"最佳分追逐"心流主线，给出可由会话聚合算出的北极星指标。

UA-2/3 渠道 × 素材 Cohort LTV / ROAS
-----------------------------------
与 web/src/monetization/cohortAnalytics.js 同口径的 Python 实现，供 /api/ops/* 复用。
"""

import math
from typing import Iterable


# ── CS-1：权威分 plausibility ───────────────────────────────────────────────

# 宽松上界系数：休闲方块单次落子/消行的经验上限（防作弊只抓量级越界，不抠精确）。
DEFAULT_SCORE_BOUND = {
    "per_placement": 60,     # 单次落子的最大计分（含放置基础分）
    "per_clear": 300,        # 单次消行（含多行/同时消）的最大计分
    "combo_bonus_max": 5000, # 连击/特殊事件的额外上界
    "base_slack": 200,       # 兜底松弛
}


def authoritative_score_check(reported_score, stats, bound_cfg=None):
    """
    返回 { ok, bound, reason }。
    stats: { placements, clears, maxCombo }（来自 session.game_stats）。
    """
    cfg = {**DEFAULT_SCORE_BOUND, **(bound_cfg or {})}
    try:
        score = float(reported_score)
    except (TypeError, ValueError):
        return {"ok": False, "bound": 0, "reason": "non_numeric"}

    placements = max(0, int((stats or {}).get("placements", 0) or 0))
    clears = max(0, int((stats or {}).get("clears", 0) or 0))

    if score < 0:
        return {"ok": False, "bound": 0, "reason": "negative_score"}
    if score > 0 and placements == 0:
        return {"ok": False, "bound": 0, "reason": "score_without_placements"}

    bound = (
        placements * cfg["per_placement"]
        + clears * cfg["per_clear"]
        + cfg["combo_bonus_max"]
        + cfg["base_slack"]
    )
    if score > bound:
        return {"ok": False, "bound": bound, "reason": "exceeds_bound"}
    return {"ok": True, "bound": bound, "reason": None}


# ── DA-1：北极星指标 ────────────────────────────────────────────────────────

JUICE_DURATION_SEC = 60  # 单局"有效游玩"时长门槛（爽感/参与）


def _avg(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 4) if vals else 0.0


def north_star_metrics(sessions: Iterable[dict]):
    """
    sessions: 每局 dict，含可选字段
      { score, best_before, clears, placements, duration, combo }
    返回 6 项 PB 指标 + 爽感覆盖率。
    """
    rows = list(sessions or [])
    n = len(rows)
    if n == 0:
        return {
            "sessions": 0,
            "pbBreakRate": 0.0,
            "pbChaseRate": 0.0,
            "avgClearRate": 0.0,
            "comboReachRate": 0.0,
            "engagedSessionRate": 0.0,
            "avgDuration": 0.0,
            "juiceCoverage": 0.0,
        }

    pb_break = 0       # 刷新个人最佳
    pb_chase = 0       # 逼近个人最佳（≥80%）
    juice = 0          # 至少一次消行（即时正反馈）
    combo_reach = 0    # 触发连击（≥2）
    engaged = 0        # 时长达门槛
    clear_rates = []
    durations = []

    for r in rows:
        score = float(r.get("score", 0) or 0)
        best = float(r.get("best_before", 0) or 0)
        clears = int(r.get("clears", 0) or 0)
        placements = int(r.get("placements", 0) or 0)
        duration = float(r.get("duration", 0) or 0)
        combo = int(r.get("combo", 0) or 0)

        if score > best > 0 or (best == 0 and score > 0):
            pb_break += 1
        if best > 0 and score >= 0.8 * best:
            pb_chase += 1
        if clears > 0:
            juice += 1
        if combo >= 2:
            combo_reach += 1
        if duration >= JUICE_DURATION_SEC:
            engaged += 1
        if placements > 0:
            clear_rates.append(clears / placements)
        durations.append(duration)

    return {
        "sessions": n,
        "pbBreakRate": round(pb_break / n, 4),
        "pbChaseRate": round(pb_chase / n, 4),
        "avgClearRate": _avg(clear_rates),
        "comboReachRate": round(combo_reach / n, 4),
        "engagedSessionRate": round(engaged / n, 4),
        "avgDuration": _avg(durations),
        "juiceCoverage": round(juice / n, 4),
    }


# ── UA-2/3：Cohort LTV / ROAS（与 cohortAnalytics.js 同口径） ────────────────


def compute_roas(revenue, spend):
    s = max(0.0, float(spend or 0))
    if s == 0:
        return None
    return round(max(0.0, float(revenue or 0)) / s, 4)


def cohort_ltv_curve(revenue_events, cohort_size, horizon=90):
    n = max(0, int(cohort_size or 0))
    h = max(0, int(horizon))
    daily = [0.0] * (h + 1)
    for ev in revenue_events or []:
        d = int(ev.get("dayIndex", -1))
        if 0 <= d <= h:
            daily[d] += max(0.0, float(ev.get("amount", 0) or 0))
    curve = []
    cum = 0.0
    for d in range(h + 1):
        cum += daily[d]
        curve.append(round(cum / n, 4) if n > 0 else 0.0)
    return curve


# ── DA-2：A/B uplift 统计（双比例 z 检验 + 95% 置信区间） ────────────────────


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def two_proportion_uplift(control, treatment):
    """
    control/treatment: { n, conversions }。
    返回 { controlRate, treatmentRate, upliftAbs, upliftRel, z, pValue,
           ci95: [lo, hi], significant }（双尾 95%）。
    """
    n1 = max(0, int((control or {}).get("n", 0) or 0))
    x1 = max(0, int((control or {}).get("conversions", 0) or 0))
    n2 = max(0, int((treatment or {}).get("n", 0) or 0))
    x2 = max(0, int((treatment or {}).get("conversions", 0) or 0))
    if n1 == 0 or n2 == 0:
        return {
            "controlRate": 0.0, "treatmentRate": 0.0, "upliftAbs": 0.0,
            "upliftRel": None, "z": 0.0, "pValue": 1.0, "ci95": [0.0, 0.0],
            "significant": False, "insufficientData": True,
        }
    p1 = x1 / n1
    p2 = x2 / n2
    diff = p2 - p1
    pooled = (x1 + x2) / (n1 + n2)
    se_pool = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2)) or 1e-12
    z = diff / se_pool
    p_value = 2.0 * (1.0 - _norm_cdf(abs(z)))
    se_diff = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    lo = diff - 1.96 * se_diff
    hi = diff + 1.96 * se_diff
    return {
        "controlRate": round(p1, 6),
        "treatmentRate": round(p2, 6),
        "upliftAbs": round(diff, 6),
        "upliftRel": round(diff / p1, 6) if p1 > 0 else None,
        "z": round(z, 4),
        "pValue": round(p_value, 6),
        "ci95": [round(lo, 6), round(hi, 6)],
        "significant": p_value < 0.05,
        "insufficientData": False,
    }


def ab_uplift_from_counts(buckets, exposure_event="exposure", success_event="conversion"):
    """
    buckets: { bucketId: { exposure_event: n, success_event: x, ... } }（来自 ab_events 聚合）。
    以 bucket 0 为对照，对其余每桶算 uplift。返回 list（按 bucket 升序）。
    """
    def _count(b, ev):
        return int((buckets.get(b, {}) or {}).get(ev, 0) or 0)

    ids = sorted(buckets.keys(), key=lambda x: (int(x) if str(x).lstrip("-").isdigit() else 0))
    if not ids:
        return []
    control_id = ids[0]
    ctrl = {"n": _count(control_id, exposure_event), "conversions": _count(control_id, success_event)}
    out = []
    for b in ids:
        treat = {"n": _count(b, exposure_event), "conversions": _count(b, success_event)}
        stat = two_proportion_uplift(ctrl, treat)
        out.append({
            "bucket": b,
            "isControl": b == control_id,
            "n": treat["n"],
            "conversions": treat["conversions"],
            **stat,
        })
    return out


# ── DA-3：护栏指标自动告警 / 自动暂停 ──────────────────────────────────────

DEFAULT_GUARDRAIL_CFG = {
    "warnRelRegression": 0.03,   # 相对回归 ≥3% 告警
    "pauseRelRegression": 0.05,  # 相对回归 ≥5% 或显著恶化 → 建议暂停
}


def evaluate_guardrails(uplift_buckets, cfg=None):
    """
    对 ab_uplift_from_counts 的结果做护栏判定（护栏指标=越低越坏，如留存/爽感）。
    返回 { alerts, recommendPause, worstRel }。
    """
    c = {**DEFAULT_GUARDRAIL_CFG, **(cfg or {})}
    alerts = []
    recommend_pause = False
    worst_rel = 0.0
    for b in uplift_buckets or []:
        if b.get("isControl") or b.get("insufficientData"):
            continue
        rel = b.get("upliftRel")
        if rel is None:
            continue
        worst_rel = min(worst_rel, rel)
        ci_hi = (b.get("ci95") or [0, 0])[1]
        sig_regress = b.get("significant") and ci_hi < 0
        if sig_regress or rel <= -c["pauseRelRegression"]:
            recommend_pause = True
            alerts.append({
                "bucket": b.get("bucket"), "severity": "error", "upliftRel": rel,
                "message": f"桶 {b.get('bucket')} 护栏指标显著回归 {rel * 100:.1f}%（建议暂停）",
            })
        elif rel <= -c["warnRelRegression"]:
            alerts.append({
                "bucket": b.get("bucket"), "severity": "warn", "upliftRel": rel,
                "message": f"桶 {b.get('bucket')} 护栏指标回归 {rel * 100:.1f}%（观察）",
            })
    return {"alerts": alerts, "recommendPause": recommend_pause, "worstRel": round(worst_rel, 6)}


# ── DA-4：埋点质量（与 web/src/telemetry/telemetryQuality.js 同口径） ─────────

DEFAULT_TELEMETRY_THRESHOLDS = {
    "maxLossRate": 0.02,
    "maxLatencyP95": 2000,
    "minSamples": 30,
}


def _percentile(sorted_values, q):
    n = len(sorted_values)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_values[0])
    idx = q * (n - 1)
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return float(sorted_values[lo])
    frac = idx - lo
    return sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac


def telemetry_quality(records, thresholds=None):
    """
    records: [{ sentTs, ackTs?, lost? }]（lost / 无 ack / ack<=sent 计为丢失）。
    返回质量指标 + 告警（与 JS 端 computeTelemetryQuality + evaluateTelemetryAlerts 一致）。
    """
    cfg = {**DEFAULT_TELEMETRY_THRESHOLDS, **(thresholds or {})}
    rows = list(records or [])
    total = len(rows)
    latencies = []
    lost = 0
    for r in rows:
        sent = r.get("sentTs")
        ack = r.get("ackTs")
        try:
            sent_f = float(sent)
            ack_f = float(ack)
        except (TypeError, ValueError):
            sent_f = ack_f = None
        if r.get("lost") is True or sent_f is None or ack_f is None or ack_f <= sent_f:
            lost += 1
            continue
        latencies.append(ack_f - sent_f)
    latencies.sort()
    delivered = len(latencies)
    avg = (sum(latencies) / delivered) if delivered else 0.0
    loss_rate = round(lost / total, 6) if total else 0.0
    p50 = round(_percentile(latencies, 0.5), 2)
    p95 = round(_percentile(latencies, 0.95), 2)

    alerts = []
    low_sample = total < cfg["minSamples"]
    if loss_rate > cfg["maxLossRate"]:
        alerts.append({"code": "HIGH_LOSS_RATE", "severity": "error",
                       "message": f"埋点丢失率 {loss_rate * 100:.2f}% > 阈值 {cfg['maxLossRate'] * 100:.2f}%"})
    if p95 > cfg["maxLatencyP95"]:
        alerts.append({"code": "HIGH_LATENCY_P95", "severity": "warn",
                       "message": f"埋点 p95 延迟 {p95}ms > 阈值 {cfg['maxLatencyP95']}ms"})
    if low_sample:
        alerts.append({"code": "LOW_SAMPLE", "severity": "info",
                       "message": f"样本量 {total} < {cfg['minSamples']}，健康判定仅供参考"})

    healthy = (not low_sample) and all(a["severity"] not in ("error", "warn") for a in alerts)
    return {
        "total": total,
        "lost": lost,
        "delivered": delivered,
        "lossRate": loss_rate,
        "latencyP50": p50,
        "latencyP95": p95,
        "latencyAvg": round(avg, 2),
        "healthy": healthy,
        "lowSample": low_sample,
        "alerts": alerts,
    }


# ── SO-2：K 因子（病毒系数） ────────────────────────────────────────────────


def k_factor(invites_sent, conversions, active_users):
    """
    K = i × c，其中 i = 人均发出邀请数，c = 邀请→激活转化率。
    返回 { invitesPerUser, conversionRate, kFactor, viral }（K≥1 即自传播）。
    """
    au = max(0, int(active_users or 0))
    sent = max(0, int(invites_sent or 0))
    conv = max(0, int(conversions or 0))
    i = (sent / au) if au > 0 else 0.0
    c = (conv / sent) if sent > 0 else 0.0
    k = i * c
    return {
        "invitesPerUser": round(i, 4),
        "conversionRate": round(c, 4),
        "kFactor": round(k, 4),
        "viral": k >= 1.0,
    }


def cohort_roi(rows):
    """
    rows: [{ key, installs, spend, revenue, retainedD1 }]
    按 key 聚合 → CPI/ARPU/ROAS/D1，按 ROAS 降序。
    """
    acc = {}
    for r in rows or []:
        key = str(r.get("key", "unknown"))
        c = acc.setdefault(key, {"key": key, "installs": 0, "spend": 0.0, "revenue": 0.0, "retainedD1": 0})
        c["installs"] += max(0, int(r.get("installs", 0) or 0))
        c["spend"] += max(0.0, float(r.get("spend", 0) or 0))
        c["revenue"] += max(0.0, float(r.get("revenue", 0) or 0))
        c["retainedD1"] += max(0, int(r.get("retainedD1", 0) or 0))
    out = []
    for c in acc.values():
        inst = c["installs"]
        out.append({
            "key": c["key"],
            "installs": inst,
            "cpi": round(c["spend"] / inst, 4) if inst else 0.0,
            "arpu": round(c["revenue"] / inst, 4) if inst else 0.0,
            "roas": compute_roas(c["revenue"], c["spend"]),
            "d1": round(c["retainedD1"] / inst, 4) if inst else None,
        })
    out.sort(key=lambda x: (x["roas"] if x["roas"] is not None else -1), reverse=True)
    return out
