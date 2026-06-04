#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Open Block · 完整 MCTS + 闭环课程训练启动器（v11.1）
#
# 用途
# ────
# 切换到 `python -m rl_pytorch.train` 主循环训练，启用所有 v8+ 改进：
#   - lightMCTS（visit_pi + Q teacher 蒸馏）
#   - searchReplay（困难样本回放）
#   - 3-ply beam（跨块协同 Q）
#   - adaptiveCurriculum v11（四档闭环胜率反馈）
#   - Dirichlet root noise（提升早期探索）
#   - 3 进程 worker pool（CPU 推理 + GPU 更新流水线）
#
# 与现有训练的差异
# ────────────────
# 当前默认训练栈是「浏览器 trainer.js 采集 → rl_backend.py mini-batch PPO」，
# 仅用 PG + 辅助监督头，**不接 MCTS / 不走 v11 闭环 / Lv 容易高位震荡**。
# 本脚本启动的是独立 PyTorch 主循环训练，与浏览器训练**互斥**——同时跑两个会
# 互相覆盖 checkpoint。请确认浏览器面板的「停止」按钮已点击后再用本脚本。
#
# 输出
# ────
#   - checkpoint:  ./rl_checkpoints/full_mcts.pt
#   - 训练日志:    ./logs/rl/train_full_mcts.jsonl（看板可读）
#   - 控制台日志:  ./logs/rl/train_full_mcts.log
#
# 用法
# ────
#   ./scripts/train_full_mcts.sh                  # 默认 50k ep, mps/cuda 自动
#   EPISODES=20000 ./scripts/train_full_mcts.sh   # 自定义 ep 数
#   DEVICE=cpu ./scripts/train_full_mcts.sh       # 强制 CPU（仅调试）
#   RESUME=1 ./scripts/train_full_mcts.sh         # 从上次 checkpoint 续训
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ── Python 3（rl_pytorch 要求 ≥3.9；macOS 默认 `python` 常为 2.7，禁止用裸 python）──
_resolve_python() {
    local d py
    for d in "${REPO_ROOT}/.venv" "${REPO_ROOT}/venv" "${OPENBLOCK_VENV:-}"; do
        [[ -n "${d}" && -x "${d}/bin/python" ]] || continue
        py="$("${d}/bin/python" -c 'import sys; print(sys.version_info.major)' 2>/dev/null)" || continue
        if [[ "${py}" == "3" ]]; then
            echo "${d}/bin/python"
            return 0
        fi
    done
    if command -v python3 >/dev/null 2>&1; then
        echo "python3"
        return 0
    fi
    echo "[error] 未找到 Python 3。请安装 python3 或创建 .venv：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
    return 1
}
PYTHON="$(_resolve_python)"

# ── 用户可覆盖的参数（环境变量优先）───────────────────────────────────────
EPISODES="${EPISODES:-50000}"
DEVICE="${DEVICE:-auto}"
ARCH="${ARCH:-conv-shared}"
WIDTH="${WIDTH:-128}"
BATCH_EPISODES="${BATCH_EPISODES:-64}"
PPO_EPOCHS="${PPO_EPOCHS:-4}"
GAE_LAMBDA="${GAE_LAMBDA:-0.85}"
DIRICHLET_EPSILON="${DIRICHLET_EPSILON:-0.20}"        # v11.1 上调 0.15 → 0.20
DIRICHLET_ALPHA="${DIRICHLET_ALPHA:-0.28}"
N_WORKERS="${N_WORKERS:-3}"
EVAL_GATE_EVERY="${EVAL_GATE_EVERY:-2000}"
EVAL_GATE_GAMES="${EVAL_GATE_GAMES:-50}"
SAVE_PATH="${SAVE_PATH:-rl_checkpoints/full_mcts.pt}"
MCTS_SIMS="${MCTS_SIMS:-32}"                              # 24 → 32：略增 teacher 质量

# ── 启用 v8+ 所有 search teacher（环境变量层强制开启）─────────────────────
export RL_MCTS="${RL_MCTS:-1}"                              # 开 lightMCTS visit_pi teacher
export RL_MCTS_REUSE="${RL_MCTS_REUSE:-1}"                  # 树复用
export RL_MCTS_STOCHASTIC="${RL_MCTS_STOCHASTIC:-0}"        # 默认确定性；改 1 启用 SpawnPredictor 随机展开
export RL_CURRICULUM="${RL_CURRICULUM:-1}"                  # 课程总闸
export RL_CURRICULUM_MODE="${RL_CURRICULUM_MODE:-quantile}" # v11.2 新默认：分位数自适应（可改 linear/adaptive 做 A/B）
export RL_LR_WARMUP_BATCHES="${RL_LR_WARMUP_BATCHES:-20}"   # 前 20 batch 学习率 warmup
export RL_TEMP_DECAY_RATE="${RL_TEMP_DECAY_RATE:-0.00005}"
export RL_DIRICHLET_DECAY_EPISODES="${RL_DIRICHLET_DECAY_EPISODES:-25000}"
export RL_ZOBRIST_SHARED="${RL_ZOBRIST_SHARED:-1}"          # 跨进程共享转置表

# ── checkpoint 续训判断 ───────────────────────────────────────────────────
RESUME_ARG=""
if [[ "${RESUME:-0}" == "1" && -f "${SAVE_PATH}" ]]; then
    RESUME_ARG="--resume ${SAVE_PATH}"
    echo "[hint] 从 ${SAVE_PATH} 续训"
else
    if [[ -f "${SAVE_PATH}" ]]; then
        echo "[warn] ${SAVE_PATH} 已存在但未传 RESUME=1，将覆盖。如需续训请加 RESUME=1"
    fi
fi

# ── 输出目录 ──────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${SAVE_PATH}")"
mkdir -p logs/rl

LOG_FILE="logs/rl/train_full_mcts.log"

# ── 训练入口 ──────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo " Open Block · 完整 MCTS 训练启动"
echo "───────────────────────────────────────────────────────────────"
echo "  episodes     : ${EPISODES}"
echo "  python       : ${PYTHON} ($("${PYTHON}" --version 2>&1 | head -1))"
echo "  device       : ${DEVICE}"
echo "  arch / width : ${ARCH} / ${WIDTH}"
echo "  batch / ppo  : ${BATCH_EPISODES} / ${PPO_EPOCHS}"
echo "  workers      : ${N_WORKERS}"
echo "  dirichlet    : eps=${DIRICHLET_EPSILON} alpha=${DIRICHLET_ALPHA}"
echo "  save         : ${SAVE_PATH}"
echo "  log          : ${LOG_FILE}"
echo "  env"
echo "    RL_MCTS                       = ${RL_MCTS}"
echo "    RL_CURRICULUM_MODE            = ${RL_CURRICULUM_MODE}"
echo "    RL_ZOBRIST_SHARED             = ${RL_ZOBRIST_SHARED}"
echo "    winThresholdEnd (linear only) = $("${PYTHON}" -c 'import json;print(json.load(open("shared/game_rules.json"))["rlCurriculum"]["winThresholdEnd"])')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# shellcheck disable=SC2086
exec "${PYTHON}" -m rl_pytorch.train \
    --episodes "${EPISODES}" \
    --device "${DEVICE}" \
    --arch "${ARCH}" \
    --width "${WIDTH}" \
    --batch-episodes "${BATCH_EPISODES}" \
    --ppo-epochs "${PPO_EPOCHS}" \
    --gae-lambda "${GAE_LAMBDA}" \
    --dirichlet-epsilon "${DIRICHLET_EPSILON}" \
    --dirichlet-alpha "${DIRICHLET_ALPHA}" \
    --n-workers "${N_WORKERS}" \
    --eval-gate-every "${EVAL_GATE_EVERY}" \
    --eval-gate-games "${EVAL_GATE_GAMES}" \
    --mcts \
    --mcts-sims "${MCTS_SIMS}" \
    --beam3ply \
    --save "${SAVE_PATH}" \
    ${RESUME_ARG} \
    2>&1 | tee "${LOG_FILE}"
