"""BestGuard v2：基于统计学显著性检验的训练防退化守护。

设计动机
--------
v1 BestGuard（train.py 内联，约 3979~4062 行）的核心缺陷：

1. **best_avg 锚定运气峰值**：右偏长尾得分（实测 std ≈ mean，CV ≈ 100%）下，
   200 局窗口均值会被极端高分单局拉升 20% 以上。一旦 `best_avg` 被这种 outlier
   窗口锁定，正常水平就会被反复判为"严重回撤"。
2. **阈值用固定比例 (×0.85 / ×0.70) 而非显著性检验**：忽略了分数本身的方差量纲。
   高 CV 分布下，固定比例几乎一定会误触发。
3. **CONFIRM=1 二次确认形同虚设**：连续 1 次跌破就回滚；严重档直接跳过确认。
4. **回滚 = 重建 Adam + 衰减 lr**：本身是损伤性操作。误触发的连锁代价远大于"防退化"
   收益（实测累计 28 次回滚 + lr 3e-4→1.5e-4，模型困死在污染峰值附近）。

v2 解决方案
-----------
**显著性检验**：把 best/regress/severe 判定改为"基于 pooled standard error 的
z-test"，回到一阶统计语言：

    SE_pooled = √(σ²_best / n_best + σ²_cur / n_cur)
    upgrade   ⇔ cur_avg > best_avg + k_up   * SE_pooled
    regress   ⇔ cur_avg < best_avg - k_reg  * SE_pooled
    severe    ⇔ cur_avg < best_avg - k_sev  * SE_pooled

默认 k_up=1.5, k_reg=2.0, k_sev=3.5（约 87%/97.5%/99.95% 置信）。

**抗污染自检**：启动时根据"观测到的滚动窗口均值历史最大值"校验 best_avg。
若 best_avg / observed_max > 1.10（含 10% 噪声裕度）即判定为污染，自动重置。

**速率限制**：滑窗内回滚次数超阈值即触发 health alert（默认 1000 ep 内 >5 次）。
连续高频触发即自动暂停 BestGuard 一段时间，避免"自我实现的衰减循环"。

**Trimmed mean（默认）**：对 best/cur 窗口都用 5% trim mean 计算 avg，
进一步抑制极端单局对窗口均值的拉动。

接口
----
- decide_best_guard_action(cfg, best_stats, cur_window): BestGuardDecision
- assess_best_avg_pollution(best_avg, observed_history): PollutionAssessment
- update_health_state(state, decision, ep_cursor): HealthState

所有接口均为**纯函数**（无 I/O / 无全局副作用），便于单测覆盖。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Iterable, Literal, Sequence


# ─────────────────────────────────────────────────────────────────────
# 配置 & 数据结构
# ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BestGuardConfig:
    """BestGuard v2 全部超参（环境变量覆盖在 train.py 注入）。

    所有阈值都是 z-score（标准误的倍数），与分数量纲解耦。
    """

    # 滚动窗口大小（局数）
    window: int = 200
    # 触发判定的最小间隔（局数）；< window 时退化为每 window 局一次
    check_every: int = 200
    # best 升级显著性：cur > best + k_up * SE_pooled
    k_upgrade: float = 1.5
    # 回撤显著性：cur < best - k_regress * SE_pooled
    k_regress: float = 2.0
    # 严重回撤显著性（无需二次确认即回滚）
    k_severe: float = 3.5
    # 二次确认：非严重回撤需要连续 N 次判定跌破才回滚
    confirm: int = 2
    # 抗污染裕度：best_avg / observed_max_window_mean ≤ 1 + max_pollution_margin 视为合理
    max_pollution_margin: float = 0.10
    # 速率限制：每 rate_limit_window 局内 rollback ≥ rate_limit_threshold 即 unhealthy
    rate_limit_window: int = 1000
    rate_limit_threshold: int = 5
    # unhealthy 状态下自动暂停 BestGuard 的局数
    suspend_episodes: int = 2000
    # 是否启用 trimmed mean（双侧 5% 裁剪）以抗异常单局
    use_trimmed_mean: bool = True
    trim_ratio: float = 0.05
    # 数值兜底（避免 std=0 时 z-score 爆炸）
    min_pooled_se: float = 1.0


@dataclass(frozen=True)
class BestGuardStats:
    """best 快照对应的窗口统计量。

    n=0 表示尚未建立 best；调用方应初始化为 from_window(...)。
    """

    avg: float
    std: float
    n: int
    median: float = 0.0

    @classmethod
    def from_window(cls, window: Sequence[float], cfg: BestGuardConfig) -> "BestGuardStats":
        return cls(
            avg=_robust_mean(window, cfg),
            std=_robust_std(window, cfg),
            n=len(window),
            median=_median(window),
        )

    def is_empty(self) -> bool:
        return self.n <= 0


GuardAction = Literal["init", "upgrade", "regress_pending", "regress_severe",
                      "regress_confirmed", "hold", "suspended"]


@dataclass(frozen=True)
class BestGuardDecision:
    """单次 BestGuard 检查的结果。"""

    action: GuardAction
    cur_stats: BestGuardStats
    best_stats: BestGuardStats
    pooled_se: float
    z_score: float                # (cur - best) / SE_pooled
    upgrade_threshold: float      # best + k_up * SE
    regress_threshold: float      # best - k_reg * SE
    severe_threshold: float       # best - k_sev * SE
    pending_count: int            # 累计未确认的 regress 次数
    note: str = ""


@dataclass(frozen=True)
class PollutionAssessment:
    """checkpoint 中持久化的 best_avg 与训练观测历史的一致性评估。"""

    polluted: bool
    best_avg: float
    observed_max: float
    pollution_ratio: float  # best_avg / max(observed_max, 1)
    suggested_reset_to: float
    reason: str


@dataclass(frozen=True)
class HealthState:
    """BestGuard 健康度跟踪器（每次 decide 后调用 update_health_state 演进）。"""

    rollback_events: tuple[int, ...] = ()   # rollback 触发的 ep_cursor 列表
    suspended_until_ep: int = -1            # < 0 表示未暂停
    last_alert_ep: int = -10**9
    consecutive_severe: int = 0             # 连续 severe rollback 计数

    def is_suspended(self, ep_cursor: int) -> bool:
        return ep_cursor < self.suspended_until_ep

    def rollbacks_in_window(self, ep_cursor: int, window: int) -> int:
        lo = ep_cursor - window
        return sum(1 for e in self.rollback_events if e >= lo)


# ─────────────────────────────────────────────────────────────────────
# 内部数值工具
# ─────────────────────────────────────────────────────────────────────


def _median(xs: Sequence[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    n = len(s)
    if n % 2 == 1:
        return float(s[n // 2])
    return 0.5 * (s[n // 2 - 1] + s[n // 2])


def _robust_mean(xs: Sequence[float], cfg: BestGuardConfig) -> float:
    n = len(xs)
    if n == 0:
        return 0.0
    if not cfg.use_trimmed_mean or cfg.trim_ratio <= 0 or n < 20:
        return float(sum(xs) / n)
    k = max(1, int(n * cfg.trim_ratio))
    s = sorted(xs)
    trimmed = s[k:n - k]
    m = len(trimmed)
    if m <= 0:
        return float(sum(s) / n)
    return float(sum(trimmed) / m)


def _robust_std(xs: Sequence[float], cfg: BestGuardConfig) -> float:
    """样本标准差（n-1）；可选 trim 两端后计算。"""
    n = len(xs)
    if n < 2:
        return 0.0
    if cfg.use_trimmed_mean and cfg.trim_ratio > 0 and n >= 20:
        k = max(1, int(n * cfg.trim_ratio))
        s = sorted(xs)
        trimmed = s[k:n - k]
        m = len(trimmed)
        if m >= 2:
            mean = sum(trimmed) / m
            var = sum((x - mean) ** 2 for x in trimmed) / (m - 1)
            return math.sqrt(max(0.0, var))
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs) / (n - 1)
    return math.sqrt(max(0.0, var))


def _pooled_se(best: BestGuardStats, cur: BestGuardStats, cfg: BestGuardConfig) -> float:
    """两窗口均值差的标准误。Welch SE 形式：√(σ²_a/n_a + σ²_b/n_b)。"""
    n_b = max(1, best.n)
    n_c = max(1, cur.n)
    var = (best.std ** 2) / n_b + (cur.std ** 2) / n_c
    return max(cfg.min_pooled_se, math.sqrt(max(0.0, var)))


# ─────────────────────────────────────────────────────────────────────
# 核心决策函数
# ─────────────────────────────────────────────────────────────────────


def decide_best_guard_action(
    cfg: BestGuardConfig,
    best_stats: BestGuardStats,
    cur_window: Sequence[float],
    *,
    pending_count: int = 0,
    health: HealthState | None = None,
    ep_cursor: int = 0,
) -> BestGuardDecision:
    """根据 best_stats 与当前 cur_window 决策守护动作。

    返回 BestGuardDecision，由调用方根据 decision.action 执行：

    - "init"               → 首次或 best 为空，调用方应快照当前为 best。
    - "upgrade"            → 真正显著提升，调用方应快照当前为新 best。
    - "regress_severe"     → 严重回撤，立即回滚。
    - "regress_confirmed"  → 累计达到 confirm 次，回滚。
    - "regress_pending"    → 跌破但未确认，调用方仅记录 pending_count+1。
    - "hold"               → 窗口正常或恢复，调用方应清零 pending_count。
    - "suspended"          → BestGuard 暂停期内，调用方不做任何动作。
    """
    cur_stats = BestGuardStats.from_window(cur_window, cfg)

    if health is not None and health.is_suspended(ep_cursor):
        return BestGuardDecision(
            action="suspended",
            cur_stats=cur_stats,
            best_stats=best_stats,
            pooled_se=0.0,
            z_score=0.0,
            upgrade_threshold=best_stats.avg,
            regress_threshold=best_stats.avg,
            severe_threshold=best_stats.avg,
            pending_count=pending_count,
            note=f"BestGuard 暂停中，剩余 {max(0, health.suspended_until_ep - ep_cursor)} ep",
        )

    if best_stats.is_empty():
        return BestGuardDecision(
            action="init",
            cur_stats=cur_stats,
            best_stats=cur_stats,
            pooled_se=0.0,
            z_score=0.0,
            upgrade_threshold=cur_stats.avg,
            regress_threshold=cur_stats.avg,
            severe_threshold=cur_stats.avg,
            pending_count=0,
            note="首次建立 best 基准",
        )

    se = _pooled_se(best_stats, cur_stats, cfg)
    z = (cur_stats.avg - best_stats.avg) / max(cfg.min_pooled_se, se)
    up_thr = best_stats.avg + cfg.k_upgrade * se
    rg_thr = best_stats.avg - cfg.k_regress * se
    sv_thr = best_stats.avg - cfg.k_severe * se

    if cur_stats.avg > up_thr:
        return BestGuardDecision(
            action="upgrade",
            cur_stats=cur_stats,
            best_stats=best_stats,
            pooled_se=se,
            z_score=z,
            upgrade_threshold=up_thr,
            regress_threshold=rg_thr,
            severe_threshold=sv_thr,
            pending_count=0,
            note=f"显著提升 z=+{z:.2f}σ",
        )

    if cur_stats.avg < sv_thr:
        return BestGuardDecision(
            action="regress_severe",
            cur_stats=cur_stats,
            best_stats=best_stats,
            pooled_se=se,
            z_score=z,
            upgrade_threshold=up_thr,
            regress_threshold=rg_thr,
            severe_threshold=sv_thr,
            pending_count=0,
            note=f"严重回撤 z={z:.2f}σ < -{cfg.k_severe:.1f}σ",
        )

    if cur_stats.avg < rg_thr:
        new_pending = pending_count + 1
        confirm_n = max(1, cfg.confirm)
        if new_pending >= confirm_n:
            return BestGuardDecision(
                action="regress_confirmed",
                cur_stats=cur_stats,
                best_stats=best_stats,
                pooled_se=se,
                z_score=z,
                upgrade_threshold=up_thr,
                regress_threshold=rg_thr,
                severe_threshold=sv_thr,
                pending_count=0,
                note=f"连续 {new_pending} 次回撤确认 z={z:.2f}σ",
            )
        return BestGuardDecision(
            action="regress_pending",
            cur_stats=cur_stats,
            best_stats=best_stats,
            pooled_se=se,
            z_score=z,
            upgrade_threshold=up_thr,
            regress_threshold=rg_thr,
            severe_threshold=sv_thr,
            pending_count=new_pending,
            note=f"回撤观察 {new_pending}/{confirm_n} z={z:.2f}σ",
        )

    return BestGuardDecision(
        action="hold",
        cur_stats=cur_stats,
        best_stats=best_stats,
        pooled_se=se,
        z_score=z,
        upgrade_threshold=up_thr,
        regress_threshold=rg_thr,
        severe_threshold=sv_thr,
        pending_count=0,
        note=f"健康区间 z={z:+.2f}σ",
    )


# ─────────────────────────────────────────────────────────────────────
# 启动自检：暴露并修复 best_avg 污染
# ─────────────────────────────────────────────────────────────────────


def assess_best_avg_pollution(
    best_avg: float,
    observed_window_means: Iterable[float],
    cfg: BestGuardConfig,
) -> PollutionAssessment:
    """根据"历史观测过的窗口均值"判断 ckpt 中的 best_avg 是否被污染。

    判定标准：best_avg > observed_max × (1 + max_pollution_margin)，
    则视为污染（来自一个未持久化的运气峰值，或异常单点采样）。

    建议重置值 = observed_p95（保守，比当前历史 p95 略乐观一点点）。
    若 observed 历史为空（首次训练），返回 polluted=False。
    """
    obs = [float(x) for x in observed_window_means if math.isfinite(x)]
    if not obs:
        return PollutionAssessment(
            polluted=False,
            best_avg=float(best_avg),
            observed_max=0.0,
            pollution_ratio=1.0,
            suggested_reset_to=float(best_avg),
            reason="无观测历史，无法评估（可能为首次训练）",
        )

    obs_max = max(obs)
    obs_sorted = sorted(obs)
    p95 = obs_sorted[min(len(obs_sorted) - 1, int(0.95 * len(obs_sorted)))]
    safe_max = obs_max * (1.0 + cfg.max_pollution_margin)
    ratio = float(best_avg) / max(obs_max, 1e-6)

    if best_avg <= safe_max or obs_max <= 0:
        return PollutionAssessment(
            polluted=False,
            best_avg=float(best_avg),
            observed_max=float(obs_max),
            pollution_ratio=ratio,
            suggested_reset_to=float(best_avg),
            reason=f"best_avg={best_avg:.1f} 在合理范围内（observed_max={obs_max:.1f}）",
        )

    return PollutionAssessment(
        polluted=True,
        best_avg=float(best_avg),
        observed_max=float(obs_max),
        pollution_ratio=ratio,
        suggested_reset_to=float(p95),
        reason=(
            f"best_avg={best_avg:.1f} > observed_max={obs_max:.1f} × "
            f"(1+{cfg.max_pollution_margin:.2f}) = {safe_max:.1f}；"
            f"建议重置为 p95={p95:.1f}（来自 {len(obs)} 个历史窗口）"
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# 健康度跟踪：速率限制 + 自动暂停
# ─────────────────────────────────────────────────────────────────────


def update_health_state(
    state: HealthState,
    decision: BestGuardDecision,
    ep_cursor: int,
    cfg: BestGuardConfig,
) -> tuple[HealthState, str | None]:
    """根据决策结果演进 HealthState；返回（新状态, 可选告警字符串）。

    暂停规则：rate_limit_window 内 rollback 次数 ≥ rate_limit_threshold → 暂停
    suspend_episodes 局。连续 ≥ 3 次 severe 告警则额外触发 critical 告警。
    """
    new_events = state.rollback_events
    new_consec_severe = state.consecutive_severe

    if decision.action in ("regress_severe", "regress_confirmed"):
        cutoff = ep_cursor - max(1, cfg.rate_limit_window) * 4
        new_events = tuple(e for e in state.rollback_events if e >= cutoff) + (ep_cursor,)
        new_consec_severe = (
            state.consecutive_severe + 1
            if decision.action == "regress_severe"
            else 0
        )
    elif decision.action == "upgrade":
        new_consec_severe = 0

    new_state = replace(
        state,
        rollback_events=new_events,
        consecutive_severe=new_consec_severe,
    )

    alert: str | None = None
    rb_count = new_state.rollbacks_in_window(ep_cursor, cfg.rate_limit_window)
    if rb_count >= cfg.rate_limit_threshold and not new_state.is_suspended(ep_cursor):
        new_state = replace(
            new_state,
            suspended_until_ep=ep_cursor + max(1, cfg.suspend_episodes),
            last_alert_ep=ep_cursor,
        )
        alert = (
            f"[BestGuard:HEALTH:CRITICAL] ep={ep_cursor} 最近 {cfg.rate_limit_window} 局内"
            f"回滚 {rb_count} 次（阈值={cfg.rate_limit_threshold}）→ 自动暂停 "
            f"{cfg.suspend_episodes} 局；疑似 best_avg 已被运气峰值污染。"
            f"\n  ↳ 缓解建议：使用 scripts/repair_best_guard.py 修复 ckpt 中的 best_avg，"
            f"或调高 RL_BEST_GUARD_K_REGRESS（默认 2.0）。"
        )
    elif new_consec_severe >= 3 and ep_cursor - state.last_alert_ep > cfg.rate_limit_window:
        new_state = replace(new_state, last_alert_ep=ep_cursor)
        alert = (
            f"[BestGuard:HEALTH:WARN] ep={ep_cursor} 连续 {new_consec_severe} 次 severe rollback；"
            f"若再继续，BestGuard 将自动暂停。"
        )

    return new_state, alert


__all__ = [
    "BestGuardConfig",
    "BestGuardStats",
    "BestGuardDecision",
    "PollutionAssessment",
    "HealthState",
    "decide_best_guard_action",
    "assess_best_avg_pollution",
    "update_health_state",
]
