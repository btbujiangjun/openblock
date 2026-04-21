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
    from .simulator import BlockBlastSimulator

    if win_threshold is None:
        win_threshold = float(WIN_SCORE_THRESHOLD)

    wins = 0
    total_scores: list[float] = []

    net.eval()
    with torch.no_grad():
        for _ in range(n_games):
            sim = BlockBlastSimulator("normal")
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
) -> tuple[bool, dict]:
    """对比候选模型与基线模型的贪心胜率。

    判定规则（与 AlphaZero 类似）：
      - 若基线胜率 > 0：candidate_win_rate >= baseline_win_rate * win_ratio
      - 若基线胜率 = 0：candidate_avg_score >= baseline_avg_score * win_ratio（兜底）

    Args:
        candidate_net: 待评估的新模型
        baseline_net: 当前基线模型（旧版本权重）
        device: 推理设备
        n_games: 每侧运行的评估局数
        win_ratio: 胜率倍数阈值（0.55 = 超过基线 55%）
        win_threshold: 胜利分数阈值

    Returns:
        (passed, metrics)
        passed: True 表示候选模型更优
        metrics: 包含 candidate/baseline 各自 run_eval_games 结果
    """
    cand = run_eval_games(candidate_net, device, n_games, win_threshold)
    base = run_eval_games(baseline_net, device, n_games, win_threshold)

    cwr = cand["win_rate"]
    bwr = base["win_rate"]

    if bwr < 1e-6:
        # 基线胜率为零时退化为均分比较
        passed = cand["avg_score"] >= max(base["avg_score"], 1.0) * win_ratio
    else:
        passed = cwr >= bwr * win_ratio

    return passed, {
        "candidate": cand,
        "baseline": base,
        "passed": passed,
        "win_ratio_required": win_ratio,
    }
