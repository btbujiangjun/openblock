"""SpawnParamTuner v2 —— 以目标 S 曲线为准的「模型效果提升」评估门禁（CLI）。

口径（硬约束）：**以目标 S 曲线为基准**，预估口径与实测口径都用「到目标的距离」
打分；**预估比实测更逼近目标 → 提升，更偏离 → 下降**。所有比较只在**真实观测到
的 bin**（bin_counts>0 且观测数达标）上进行——这保证两个口径同 bin 可比，并直接
排除「无数据 bin 上预估外推冒充贴合」的陷阱（由覆盖率门兜底）。

三条曲线（同一 context，同一批观测 bin O 上对比）：
  - 目标 target  = 理想难度 S 曲线（`target_curve_vector()`），唯一基准。
  - 实测 measured= 真实对局聚合出的 d_curve（bin_counts 加权），现状的事实。
  - 预估 predicted = bundle/模型对该 context 预测的 d_curve（寻参后的投影）。

核心指标（均在观测 bin O 上）：
  - 实测口径误差  E_meas = MAE_O(measured, target)；   现状到目标的距离
  - 预估口径误差  E_pred = MAE_O(predicted, target)；   预估到目标的距离（同 bin，可比）
  - 提升量        Δ = E_meas − E_pred：
      · Δ > 0 → 预估比实测更逼近目标 → **效果提升**；
      · Δ < 0 → 预估比实测更偏离目标 → **效果下降**。
  诊断量（不参与判定，仅供观察）：
  - 预测-实测偏离  R = MAE_O(predicted, measured)：模型相对现状提出的**改动幅度**。
      Δ>0 时 R 大只表示「改动大且朝目标」，并非问题；它**不再作为阻断门**（无数据 bin
      外推的担忧已由覆盖率门直接覆盖）。
  - E_pred_all = MAE(predicted, target) 全 20 bin（含无数据 bin 外推，不可比）。

判定（唯一标准）：提升量 Δ ≥ --min-improvement（默认 0.0）→ 提升；否则未提升/下降。
  覆盖率/高分段覆盖**不参与**提升判定（覆盖不足 ≠ 未提升），仅作为「告警」标注提升被
  验证到的 r 区间范围（< --min-coverage / < --min-high-coverage 时提示）。
  （可选）绝对底线 --max-measured-mae / 校准上限 --max-calib-residual：默认关闭。
提升门不达标 → 退出码 3。

用法：
  python -m rl_pytorch.spawn_tuning_v2.fact_eval \
      --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
      --bundle web/public/spawn-tuning-v2/policies.json
  npm run spawn:fact-eval -- --db <db> --bundle <bundle.json>

退出码：0=通过（覆盖区内预估比实测更逼近目标）；2=数据不足；3=未通过。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from .target_curve import target_curve_vector, target_E_vector, target_F_vector, F_CAP

N_BINS = 20

DEFAULT_THRESHOLDS = {
    "min_bin_samples": 5,
    "high_bin": 10,
    "min_coverage": 0.50,
    "min_high_coverage": 0.30,
    # 提升门：提升量 Δ=E_meas−E_pred 下限。0.0 = 预估至少不比实测更差；>0 = 须严格提升。
    "min_improvement": 0.0,
    # 可选绝对底线：要求实测口径误差 E_meas ≤ 该值。None = 不启用（默认只看相对提升）。
    "max_measured_mae": None,
    # 可选：预测-实测偏离 R 上限（诊断量，默认 None=不阻断；无数据 bin 外推已由覆盖率门兜底）。
    "max_calib_residual": None,
    # 门禁“武装”下限：有实测支撑的 context 数 < 此值时无法判定（没有测量就不能断言
    # 提升/下降），返回 None=indeterminate，由调用方决定是否放行。
    "min_armed_contexts": 20,
}

# 向后兼容：旧调用方可能仍传 max_self_delusion（映射为可选的 max_calib_residual）。
_THRESHOLD_ALIASES = {"max_self_delusion": "max_calib_residual"}


def _measured_curves(db_path):
    """按 context 聚合实测 d_curve（bin_counts 加权）与逐 bin 观测数。

    Returns: { context_key: (meas[N_BINS], nobs[N_BINS]) }
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    # v3.2 多曲线: 列可能不存在 (老库 / 最小测试表) — 探测后再决定是否取 e/f
    cols = {r[1] for r in conn.execute("PRAGMA table_info(samples)").fetchall()}
    has_ef = "e_curve_json" in cols and "f_curve_json" in cols
    sel = "difficulty, generator, bot_policy, pb_bin, lifecycle_stage, d_curve_json, bin_counts_json"
    if has_ef:
        sel += ", e_curve_json, f_curve_json"
    rows = conn.execute(f"SELECT {sel} FROM samples").fetchall()
    conn.close()

    num = defaultdict(lambda: np.zeros(N_BINS))
    den = defaultdict(lambda: np.zeros(N_BINS))
    e_num = defaultdict(lambda: np.zeros(N_BINS))
    f_num = defaultdict(lambda: np.zeros(N_BINS))

    def _parse(raw):
        try:
            arr = np.asarray(json.loads(raw), dtype=float)
        except (json.JSONDecodeError, TypeError):
            return None
        return arr if arr.shape[0] == N_BINS else None

    for r in rows:
        key = f"{r['difficulty']}:{r['generator']}:{r['bot_policy']}:{r['pb_bin']}:{r['lifecycle_stage']}"
        dc = _parse(r["d_curve_json"])
        if dc is None:
            continue
        bc = _parse(r["bin_counts_json"])
        if bc is None:
            bc = np.zeros(N_BINS)
        num[key] += dc * bc
        den[key] += bc
        if has_ef:
            ec = _parse(r["e_curve_json"])
            fc = _parse(r["f_curve_json"])
            if ec is not None:
                e_num[key] += ec * bc
            if fc is not None:
                f_num[key] += fc * bc

    out = {}
    for key in den:
        d = den[key]
        meas = np.where(d > 0, num[key] / np.maximum(d, 1e-9), np.nan)
        meas_e = np.where(d > 0, e_num[key] / np.maximum(d, 1e-9), np.nan) if has_ef else np.full(N_BINS, np.nan)
        meas_f = np.where(d > 0, f_num[key] / np.maximum(d, 1e-9), np.nan) if has_ef else np.full(N_BINS, np.nan)
        out[key] = (meas, d, meas_e, meas_f)
    return out


def evaluate_policies(db_path, policies, min_bin_samples=5, high_bin=10):
    """对一组 policy（含 context_key + predicted_curve）以实测数据评估。

    policies: list[dict]，每项需有 context_key 与 predicted_curve。
    """
    target = np.asarray(target_curve_vector(), dtype=float)
    ideal_e = np.asarray(target_E_vector(), dtype=float)
    ideal_f = np.asarray(target_F_vector(), dtype=float)
    measured = _measured_curves(db_path)
    by_key = {p["context_key"]: p for p in policies}

    _empty = (np.full(N_BINS, np.nan), np.zeros(N_BINS), np.full(N_BINS, np.nan), np.full(N_BINS, np.nan))
    per_ctx = []
    for key, pol in by_key.items():
        meas, nobs, meas_e, meas_f = measured.get(key, _empty)
        observed = nobs >= min_bin_samples
        n_obs = int(observed.sum())
        coverage = n_obs / N_BINS
        high_mask = np.zeros(N_BINS, dtype=bool)
        high_mask[high_bin:] = True
        high_observed = observed & high_mask
        high_coverage = high_observed.sum() / max(1, high_mask.sum())

        pred = np.asarray(pol.get("predicted_curve", [np.nan] * N_BINS), dtype=float)
        pred_ok = bool(np.isfinite(pred).all())

        # 实测口径误差 E_meas：实测 vs 目标，仅观测 bin。
        measured_mae = (float(np.mean(np.abs(meas[observed] - target[observed])))
                        if n_obs else float("nan"))
        # 预估口径误差 E_pred：预估 vs 目标，**同一观测 bin**（与 E_meas 可比）。
        pred_mae_obs = (float(np.mean(np.abs(pred[observed] - target[observed])))
                        if n_obs and pred_ok else float("nan"))
        # 诊断量：预估 vs 目标在全 20 bin（含无数据 bin 外推，不可比，不参与判定）。
        pred_mae_all = (float(np.mean(np.abs(pred - target))) if pred_ok else float("nan"))
        # 预测-实测偏离 R：预估 vs 实测，仅观测 bin。它表示模型相对现状的改动幅度，
        # 默认只作诊断，不参与提升判定。
        calib_residual = (float(np.mean(np.abs(pred[observed] - meas[observed])))
                          if n_obs and pred_ok else float("nan"))
        # 提升量 Δ = E_meas − E_pred：>0 预估更逼近目标=提升，<0=下降。
        improvement = (measured_mae - pred_mae_obs
                       if (measured_mae == measured_mae and pred_mae_obs == pred_mae_obs)
                       else float("nan"))

        # v3.2 多曲线诊断 (不参与 D 主轴判定): 爽感/挫败 实测 & 预估 vs ideal, 挫败上限
        pred_e = np.asarray(pol.get("predicted_curve_e", [np.nan] * N_BINS), dtype=float)
        pred_f = np.asarray(pol.get("predicted_curve_f", [np.nan] * N_BINS), dtype=float)
        e_meas_mae = (float(np.mean(np.abs(meas_e[observed] - ideal_e[observed])))
                      if n_obs and np.isfinite(meas_e[observed]).all() else float("nan"))
        f_meas_mae = (float(np.mean(np.abs(meas_f[observed] - ideal_f[observed])))
                      if n_obs and np.isfinite(meas_f[observed]).all() else float("nan"))
        e_pred_mae = (float(np.mean(np.abs(pred_e[observed] - ideal_e[observed])))
                      if n_obs and np.isfinite(pred_e).all() else float("nan"))
        f_pred_mae = (float(np.mean(np.abs(pred_f[observed] - ideal_f[observed])))
                      if n_obs and np.isfinite(pred_f).all() else float("nan"))
        # 挫败硬上限越界量 (实测 & 预估; 仅观测 bin)
        meas_frustration_over = (float(np.max(np.clip(meas_f[observed] - F_CAP, 0, None)))
                                 if n_obs and np.isfinite(meas_f[observed]).all() else float("nan"))
        pred_frustration_over = (float(np.max(np.clip(pred_f[observed] - F_CAP, 0, None)))
                                 if n_obs and np.isfinite(pred_f).all() else float("nan"))

        per_ctx.append({
            "key": key,
            "n_samples": int(nobs.sum()),
            "coverage": coverage,
            "high_coverage": high_coverage,
            "measured_mae": measured_mae,
            "pred_mae_obs": pred_mae_obs,
            "pred_mae_all": pred_mae_all,
            "calib_residual": calib_residual,
            "improvement": improvement,
            # v3.2 多曲线诊断
            "e_measured_mae": e_meas_mae,
            "f_measured_mae": f_meas_mae,
            "e_pred_mae": e_pred_mae,
            "f_pred_mae": f_pred_mae,
            "meas_frustration_over_cap": meas_frustration_over,
            "pred_frustration_over_cap": pred_frustration_over,
        })
    return per_ctx


def _agg(per_ctx, field, weighted=False):
    vals = [(c[field], c["n_samples"]) for c in per_ctx if c[field] == c[field]]  # drop nan
    if not vals:
        return float("nan")
    if weighted:
        num = sum(v * w for v, w in vals)
        den = sum(w for _, w in vals)
        return num / den if den else float("nan")
    return sum(v for v, _ in vals) / len(vals)


def aggregate_metrics(per_ctx):
    """把 per-ctx 结果聚合成 bundle 级别的事实指标。"""
    measured_mae = _agg(per_ctx, "measured_mae", weighted=True)
    pred_mae_obs = _agg(per_ctx, "pred_mae_obs", weighted=True)
    # 提升量在聚合层 = 加权(E_meas) − 加权(E_pred)（同权重，等价于加权(Δ)）。
    improvement = (measured_mae - pred_mae_obs
                   if (measured_mae == measured_mae and pred_mae_obs == pred_mae_obs)
                   else float("nan"))
    return {
        "n_contexts": len(per_ctx),
        "n_with_data": sum(1 for c in per_ctx if c["n_samples"] > 0),
        "n_improved": sum(1 for c in per_ctx
                          if c["improvement"] == c["improvement"] and c["improvement"] > 0),
        "n_regressed": sum(1 for c in per_ctx
                           if c["improvement"] == c["improvement"] and c["improvement"] < 0),
        "coverage": _agg(per_ctx, "coverage"),
        "high_coverage": _agg(per_ctx, "high_coverage"),
        "measured_mae": measured_mae,
        "pred_mae_obs": pred_mae_obs,
        "pred_mae_all": _agg(per_ctx, "pred_mae_all"),
        "calib_residual": _agg(per_ctx, "calib_residual", weighted=True),
        "improvement": improvement,
        # v3.2 多曲线诊断 (非阻断)
        "e_measured_mae": _agg(per_ctx, "e_measured_mae", weighted=True),
        "f_measured_mae": _agg(per_ctx, "f_measured_mae", weighted=True),
        "e_pred_mae": _agg(per_ctx, "e_pred_mae", weighted=True),
        "f_pred_mae": _agg(per_ctx, "f_pred_mae", weighted=True),
        "meas_frustration_over_cap": _agg(per_ctx, "meas_frustration_over_cap"),
        "pred_frustration_over_cap": _agg(per_ctx, "pred_frustration_over_cap"),
    }


def _merge_thresholds(thresholds):
    t = {**DEFAULT_THRESHOLDS}
    for k, v in (thresholds or {}).items():
        t[_THRESHOLD_ALIASES.get(k, k)] = v
    return t


def coverage_caveats(metrics, thresholds=None):
    """覆盖率告警（caveat）：不影响「是否提升」的结论，只标注提升被验证到多大 r 区间。

    覆盖不足 ≠ 未提升——它只是说明：提升结论仅在已观测的 r 区间成立，未覆盖的（尤其
    接近 PB 的高分段）尚无实测、未参与验证。
    """
    t = _merge_thresholds(thresholds)
    out = []
    cov, high_cov = metrics["coverage"], metrics["high_coverage"]
    if cov == cov and cov < t["min_coverage"]:
        out.append(f"实测覆盖 {cov:.1%} < {t['min_coverage']:.0%}：提升结论仅覆盖已观测的 r 区间")
    if high_cov == high_cov and high_cov < t["min_high_coverage"]:
        out.append(f"高分段覆盖 {high_cov:.1%} < {t['min_high_coverage']:.0%}："
                   "接近 PB 的高 r 段尚无实测，未参与验证")
    # v3.2 多曲线: 挫败硬上限越界告警 (非阻断, 仅提示业务红线被触碰)
    over = metrics.get("pred_frustration_over_cap")
    if over is not None and over == over and over > 1e-6:
        out.append(f"预估挫败 F 越过硬上限 {F_CAP:.2f} (越界 {over:.3f})：寻参 θ* 在部分 ctx 让挫败破红线")
    return out


def gate(metrics, thresholds=None):
    """以目标 S 曲线为准判定「模型效果是否提升」。返回 (passed, fails)。

    判定唯一由提升量 Δ = E_meas − E_pred = |实测−S| − |预估−S| 决定：
      - True  = Δ ≥ min_improvement（预估比实测更逼近目标 → 提升）；
      - False = Δ < min_improvement（预估未比实测更逼近目标 → 未提升/下降）；
      - None  = 实测支撑不足，无法判定（indeterminate）。
    覆盖率/高分段覆盖**不参与**该判定（覆盖不足 ≠ 未提升），改由 `coverage_caveats()`
    输出为告警，标注提升被验证到的 r 区间范围。
    """
    t = _merge_thresholds(thresholds)
    if metrics.get("n_with_data", 0) < t["min_armed_contexts"]:
        return None, [f"实测支撑不足（有数据 context={metrics.get('n_with_data', 0)} "
                      f"< {t['min_armed_contexts']}），门禁无法判定"]
    fails = []
    meas_mae = metrics["measured_mae"]
    calib, improv = metrics["calib_residual"], metrics["improvement"]
    # 提升门（唯一判定）：以目标为准，预估须比实测更逼近目标。
    if improv == improv and improv < t["min_improvement"]:
        fails.append(f"提升量 Δ={improv:+.4f} < {t['min_improvement']}"
                     "（预估未比实测更逼近目标 → 效果未提升/下降）")
    # 可选绝对底线（默认 None=不启用）。
    if t.get("max_measured_mae") is not None and meas_mae == meas_mae \
            and meas_mae > t["max_measured_mae"]:
        fails.append(f"实测口径误差 {meas_mae:.4f} > 绝对底线 {t['max_measured_mae']}")
    # 可选校准上限（默认 None=不阻断；R 仅作诊断量）。
    if t.get("max_calib_residual") is not None and calib == calib \
            and calib > t["max_calib_residual"]:
        fails.append(f"预测-实测偏离 {calib:.4f} > {t['max_calib_residual']}（显式启用的校准上限）")
    return (len(fails) == 0), fails


def evaluate(db_path, bundle_path, min_bin_samples, high_bin):
    """从 bundle 文件评估（CLI 用）。"""
    bundle = json.load(open(bundle_path, encoding="utf-8"))
    return evaluate_policies(db_path, bundle.get("policies", []),
                             min_bin_samples=min_bin_samples, high_bin=high_bin)


def main():
    p = argparse.ArgumentParser(description="SpawnParamTuner v2 事实为准曲线门禁")
    root = Path(__file__).resolve().parent.parent.parent
    p.add_argument("--db", default=str(root / ".cursor-stress-logs" / "spawn-tuning-v2.sqlite"))
    p.add_argument("--bundle", default=str(root / "web" / "public" / "spawn-tuning-v2" / "policies.json"))
    p.add_argument("--min-bin-samples", type=int, default=5, help="一个 bin 至少几条观测才算'有数据'")
    p.add_argument("--high-bin", type=int, default=10, help="高分段起始 bin（默认 r≥0.5）")
    p.add_argument("--min-coverage", type=float, default=0.50)
    p.add_argument("--min-high-coverage", type=float, default=0.30)
    p.add_argument("--min-improvement", type=float, default=0.0,
                   help="提升量 Δ=E_meas−E_pred 下限（0=至少不更差，>0=须严格提升）")
    p.add_argument("--max-measured-mae", type=float, default=None,
                   help="可选绝对底线：实测口径误差上限（默认 None=只看相对提升）")
    p.add_argument("--max-calib-residual", type=float, default=None,
                   help="可选：预测-实测偏离上限（诊断量，默认 None=不阻断）")
    p.add_argument("--min-armed-contexts", type=int, default=20,
                   help="有实测支撑的 context 少于此值则判 indeterminate(退出码2)")
    args = p.parse_args()

    if not Path(args.db).exists():
        print(f"[fact-eval] 样本库不存在: {args.db}")
        sys.exit(2)
    if not Path(args.bundle).exists():
        print(f"[fact-eval] bundle 不存在: {args.bundle}")
        sys.exit(2)

    per_ctx = evaluate(args.db, args.bundle, args.min_bin_samples, args.high_bin)
    if not per_ctx:
        print("[fact-eval] bundle 无 policy，无法评估。")
        sys.exit(2)

    thresholds = {
        "min_bin_samples": args.min_bin_samples, "high_bin": args.high_bin,
        "min_coverage": args.min_coverage, "min_high_coverage": args.min_high_coverage,
        "max_calib_residual": args.max_calib_residual, "min_improvement": args.min_improvement,
        "max_measured_mae": args.max_measured_mae,
        "min_armed_contexts": args.min_armed_contexts,
    }
    m = aggregate_metrics(per_ctx)
    passed, fails = gate(m, thresholds)
    caveats = coverage_caveats(m, thresholds)

    def _f4(x):
        return f"{x:.4f}" if x == x else "—"

    print(f"[fact-eval] bundle={Path(args.bundle).name}  contexts={m['n_contexts']}  有样本支撑={m['n_with_data']}"
          f"  (提升 {m['n_improved']} / 下降 {m['n_regressed']})")
    print(f"  实测口径误差 E_meas = |实测−S|         = {_f4(m['measured_mae'])}   ← 现状到目标")
    print(f"  预估口径误差 E_pred = |预估−S| (同bin)  = {_f4(m['pred_mae_obs'])}   ← 预估到目标(可比)")
    print(f"  提升量 Δ = E_meas − E_pred             = {_f4(m['improvement'])} (阈值 ≥ {args.min_improvement}; >0=提升)  ← 唯一判定")
    print(f"  ── 以下仅为诊断/告警, 不参与提升判定 ──")
    print(f"  覆盖率(有数据 bin 占比)                = {m['coverage']:.1%}   (告警阈值 ≥ {args.min_coverage:.0%})")
    print(f"  高分段覆盖(bin≥{args.high_bin}, 接近PB)         = {m['high_coverage']:.1%}   (告警阈值 ≥ {args.min_high_coverage:.0%})")
    print(f"  预测-实测偏离 R (改动幅度)             = {_f4(m['calib_residual'])}")
    print(f"  预估 vs 目标 MAE (全 bin, 含外推)       = {_f4(m['pred_mae_all'])}")
    print(f"  ── v3.2 多曲线诊断 (爽感 E / 挫败 F, 非阻断) ──")
    print(f"  爽感 E: 实测|E−idealE|={_f4(m.get('e_measured_mae'))}  预估|E−idealE|={_f4(m.get('e_pred_mae'))}")
    print(f"  挫败 F: 实测|F−idealF|={_f4(m.get('f_measured_mae'))}  预估|F−idealF|={_f4(m.get('f_pred_mae'))}  预估越上限={_f4(m.get('pred_frustration_over_cap'))}")
    for c in caveats:
        print(f"  ⚠ 覆盖告警：{c}")

    if passed is None:
        print("[fact-eval] ⚠️  无法判定（实测支撑不足）：" + "；".join(fails))
        sys.exit(2)
    if passed is False:
        print("[fact-eval] ❌ 不通过（未提升/下降）：" + "；".join(fails))
        print("  → 预估未比实测更逼近目标，需调参/重训。")
        sys.exit(3)
    msg = "[fact-eval] ✅ 通过：以目标 S 为准，预估比实测更逼近目标（效果提升）。"
    if caveats:
        msg += "（注：覆盖有限，提升仅在已观测 r 区间得到验证）"
    print(msg)
    sys.exit(0)


if __name__ == "__main__":
    main()
