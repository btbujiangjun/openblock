"""RL 评估门控（Eval Gate）— v7

参考 AlphaZero 训练循环第三步：
  "评估：新网络 vs 旧网络对弈，胜率>55% 则替换"

使用方式：
  在 train_loop 中周期性调用 eval_gate_check(candidate, baseline, device)。
  返回 (passed, metrics)；passed=True 表示候选模型更优，可更新基线。

环境变量：
  RL_EVAL_GATE_HARD=1   — 硬门控：失败时自动恢复到基线权重（默认关闭，仅日志警告）
"""

from __future__ import annotations

import copy
import os
import random

import numpy as np
import torch
import torch.nn.functional as F

from .features import build_phi_batch
from .device import tensor_to_device


def run_eval_games(
    net,
    device: torch.device,
    n_games: int = 50,
    win_threshold: float | None = None,
    temperature: float = 0.0,
    seeds: list[int] | None = None,
    use_search: bool = False,
    search_gamma: float = 0.99,
) -> dict:
    """贪心（temperature=0）或低温度采样方式运行 N 局评估。

    Args:
        net: 策略-价值网络（须支持 forward_policy_logits）
        device: 推理设备
        n_games: 评估局数
        win_threshold: 胜利分数阈值；None 则读取训练配置默认值
        temperature: 采样温度；0.0=纯贪心（argmax）

    Returns:
        dict with keys: win_rate, avg_score, n_games, win_threshold
    """
    from .config import WIN_SCORE_THRESHOLD
    from .simulator import OpenBlockSimulator

    if win_threshold is None:
        win_threshold = float(WIN_SCORE_THRESHOLD)

    wins = 0
    total_scores: list[float] = []

    net.eval()
    with torch.no_grad():
        for i in range(n_games):
            if seeds is not None and i < len(seeds):
                seed = int(seeds[i])
                random.seed(seed)
                np.random.seed(seed)
                torch.manual_seed(seed)
            sim = OpenBlockSimulator("normal")
            sim.win_score_threshold = win_threshold

            while not sim.is_terminal():
                legal = sim.get_legal_actions()
                if not legal:
                    break

                _state_np, phi_np = build_phi_batch(sim, legal)
                if phi_np.shape[0] == 0:
                    break

                phi = tensor_to_device(torch.from_numpy(phi_np), device)
                logits = net.forward_policy_logits(phi)

                if use_search:
                    q_scores: list[float] = []
                    snap = sim.save_state()
                    for a in legal:
                        sim.restore_state(snap)
                        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
                        v = 0.0
                        if not sim.is_terminal():
                            next_legal = sim.get_legal_actions()
                            if next_legal:
                                next_state_np, _ = build_phi_batch(sim, next_legal)
                                if next_state_np.shape[0] > 0 and callable(getattr(net, "forward_value", None)):
                                    st = tensor_to_device(torch.from_numpy(next_state_np[0:1]), device)
                                    v = float(net.forward_value(st).reshape(-1)[0].item())
                        q_scores.append(r + search_gamma * v)
                    sim.restore_state(snap)
                    q_t = tensor_to_device(torch.tensor(q_scores, dtype=torch.float32), device)
                    logits = logits * 0.15 + q_t

                if temperature <= 1e-6:
                    chosen = int(logits.argmax().item())
                else:
                    probs = F.softmax(logits / temperature, dim=-1)
                    chosen = int(torch.multinomial(probs.clamp_min(1e-10), 1).item())

                a = legal[chosen]
                sim.step(a["block_idx"], a["gx"], a["gy"])

            total_scores.append(float(sim.score))
            if sim.score >= win_threshold:
                wins += 1

    return {
        "win_rate": wins / max(n_games, 1),
        "avg_score": float(np.mean(total_scores)) if total_scores else 0.0,
        "scores": total_scores,
        "n_games": n_games,
        "win_threshold": float(win_threshold),
    }


def eval_gate_check(
    candidate_net,
    baseline_net,
    device: torch.device,
    n_games: int = 50,
    win_ratio: float = 0.55,
    win_threshold: float | None = None,
    gate_rule: str | None = None,
    rounds: int = 1,
) -> tuple[bool, dict]:
    """对比候选模型与基线模型的贪心胜率。

    判定规则：
      - candidate 与 baseline 使用同一批 seed，逐局配对比较分数
      - 可配置 gate_rule：
          * win（默认）：paired_score_win_rate >= win_ratio
          * nonloss：paired_score_non_loss_rate >= win_ratio
      - 两种规则都要求 avg_score_delta >= 0

    Args:
        candidate_net: 待评估的新模型
        baseline_net: 当前基线模型（旧版本权重）
        device: 推理设备
        n_games: 每侧运行的评估局数
        win_ratio: 配对分数严格胜率阈值（0.55 = 同 seed 下至少 55% 局分数高于基线）
        win_threshold: 胜利分数阈值
        gate_rule: 门控规则（win 或 nonloss）；None 时读取 RL_EVAL_GATE_RULE，默认 win

    Returns:
        (passed, metrics)
        passed: True 表示候选模型更优
        metrics: 包含 candidate/baseline 各自 run_eval_games 结果
    """
    rounds = max(1, int(os.environ.get("RL_EVAL_GATE_ROUNDS", rounds)))
    all_cand_scores: list[float] = []
    all_base_scores: list[float] = []
    round_metrics: list[dict] = []
    dual_eval = os.environ.get("RL_EVAL_DUAL", "1").strip().lower() not in ("0", "false", "no", "off")
    all_cand_search_scores: list[float] = []
    all_base_search_scores: list[float] = []
    rng = random.Random(20260502)
    for r in range(rounds):
        seeds = [rng.randrange(1, 2**31 - 1) for _ in range(max(n_games, 1))]
        cand_r = run_eval_games(candidate_net, device, n_games, win_threshold, seeds=seeds)
        base_r = run_eval_games(baseline_net, device, n_games, win_threshold, seeds=seeds)
        cand_search_r = base_search_r = None
        if dual_eval:
            cand_search_r = run_eval_games(candidate_net, device, n_games, win_threshold, seeds=seeds, use_search=True)
            base_search_r = run_eval_games(baseline_net, device, n_games, win_threshold, seeds=seeds, use_search=True)
        cand_scores_r = np.array(cand_r.get("scores") or [], dtype=np.float32)
        base_scores_r = np.array(base_r.get("scores") or [], dtype=np.float32)
        n_pair_r = min(len(cand_scores_r), len(base_scores_r))
        if n_pair_r > 0:
            delta_r = cand_scores_r[:n_pair_r] - base_scores_r[:n_pair_r]
            metric_r = {
                "paired_score_win_rate": float(np.mean(delta_r > 0)),
                "paired_score_non_loss_rate": float(np.mean(delta_r >= 0)),
                "avg_score_delta": float(np.mean(delta_r)),
                "seed_bucket": r,
            }
            if cand_search_r is not None and base_search_r is not None:
                cs = np.array(cand_search_r.get("scores") or [], dtype=np.float32)
                bs = np.array(base_search_r.get("scores") or [], dtype=np.float32)
                ns = min(len(cs), len(bs))
                if ns > 0:
                    ds = cs[:ns] - bs[:ns]
                    metric_r.update({
                        "search_paired_score_win_rate": float(np.mean(ds > 0)),
                        "search_paired_score_non_loss_rate": float(np.mean(ds >= 0)),
                        "search_avg_score_delta": float(np.mean(ds)),
                    })
            round_metrics.append(metric_r)
        all_cand_scores.extend(float(x) for x in cand_r.get("scores") or [])
        all_base_scores.extend(float(x) for x in base_r.get("scores") or [])
        if cand_search_r is not None and base_search_r is not None:
            all_cand_search_scores.extend(float(x) for x in cand_search_r.get("scores") or [])
            all_base_search_scores.extend(float(x) for x in base_search_r.get("scores") or [])

    from .config import WIN_SCORE_THRESHOLD
    eval_threshold = float(win_threshold if win_threshold is not None else WIN_SCORE_THRESHOLD)
    cand = {
        "win_rate": float(np.mean(np.array(all_cand_scores) >= eval_threshold)) if all_cand_scores else 0.0,
        "avg_score": float(np.mean(all_cand_scores)) if all_cand_scores else 0.0,
        "scores": all_cand_scores,
        "n_games": len(all_cand_scores),
        "win_threshold": eval_threshold,
    }
    base = {
        "win_rate": float(np.mean(np.array(all_base_scores) >= eval_threshold)) if all_base_scores else 0.0,
        "avg_score": float(np.mean(all_base_scores)) if all_base_scores else 0.0,
        "scores": all_base_scores,
        "n_games": len(all_base_scores),
        "win_threshold": eval_threshold,
    }

    cand_scores = np.array(cand.get("scores") or [], dtype=np.float32)
    base_scores = np.array(base.get("scores") or [], dtype=np.float32)
    n_pair = min(len(cand_scores), len(base_scores))
    if n_pair > 0:
        delta = cand_scores[:n_pair] - base_scores[:n_pair]
        paired_win_rate = float(np.mean(delta > 0))
        paired_non_loss_rate = float(np.mean(delta >= 0))
        avg_delta = float(np.mean(delta))
        rule = (os.environ.get("RL_EVAL_GATE_RULE", gate_rule or "win")).strip().lower()
        if rule in ("nonloss", "non_loss", "draw_ok", "drawok"):
            passed = paired_non_loss_rate >= win_ratio and avg_delta >= 0.0
            active_rule = "paired_score_non_loss_rate>=win_ratio and avg_score_delta>=0"
        else:
            passed = paired_win_rate >= win_ratio and avg_delta >= 0.0
            active_rule = "paired_score_win_rate>=win_ratio and avg_score_delta>=0"
    else:
        paired_win_rate = 0.0
        paired_non_loss_rate = 0.0
        avg_delta = cand["avg_score"] - base["avg_score"]
        passed = avg_delta >= 0.0
        active_rule = "avg_score_delta>=0 (fallback:no_pairs)"

    search_metrics = None
    if dual_eval and all_cand_search_scores and all_base_search_scores:
        cand_search_arr = np.array(all_cand_search_scores, dtype=np.float32)
        base_search_arr = np.array(all_base_search_scores, dtype=np.float32)
        ns = min(len(cand_search_arr), len(base_search_arr))
        search_delta = cand_search_arr[:ns] - base_search_arr[:ns]
        search_metrics = {
            "candidate": {
                "win_rate": float(np.mean(cand_search_arr >= eval_threshold)),
                "avg_score": float(np.mean(cand_search_arr)),
                "scores": all_cand_search_scores,
                "n_games": len(all_cand_search_scores),
                "win_threshold": eval_threshold,
            },
            "baseline": {
                "win_rate": float(np.mean(base_search_arr >= eval_threshold)),
                "avg_score": float(np.mean(base_search_arr)),
                "scores": all_base_search_scores,
                "n_games": len(all_base_search_scores),
                "win_threshold": eval_threshold,
            },
            "paired_score_win_rate": float(np.mean(search_delta > 0)),
            "paired_score_non_loss_rate": float(np.mean(search_delta >= 0)),
            "avg_score_delta": float(np.mean(search_delta)),
        }

    return passed, {
        "candidate": cand,
        "baseline": base,
        "policy_only": {"candidate": cand, "baseline": base},
        "policy_search": search_metrics,
        "passed": passed,
        "paired_score_win_rate": paired_win_rate,
        "paired_score_non_loss_rate": paired_non_loss_rate,
        "avg_score_delta": avg_delta,
        "paired_win_ratio_required": win_ratio,
        "gate_rule": active_rule,
        "rounds": rounds,
        "round_metrics": round_metrics,
    }
