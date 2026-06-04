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
#   - 出块与线上一致（需本机 node + vite；RL_SPAWN_ONLINE=0 回退启发式 block_spawn）
#   - 每局随机 strategyId（easy/normal/hard），state 含 3 维策略 one-hot（190 维，旧 ckpt 不兼容）
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
# 用法（macOS / Linux 通用）
# ────
#   ./scripts/train_full_mcts.sh                  # 默认 50k ep, mps/cuda 自动
#   EPISODES=20000 ./scripts/train_full_mcts.sh   # 自定义 ep 数
#   DEVICE=cpu ./scripts/train_full_mcts.sh       # 强制 CPU（仅调试）
#   RESUME=1 ./scripts/train_full_mcts.sh         # 从上次 checkpoint 续训
#
# 也可用 `sh scripts/train_full_mcts.sh`：脚本会自动查找 bash 并重新执行
# （Linux 的 /bin/sh 多为 dash，macOS 为 bash 3.2 兼容模式，均不支持 pipefail）。
# ─────────────────────────────────────────────────────────────────────────

# ── 非 bash 启动时（sh/dash/ash）自动切到 bash ──
# 本段必须【仅 POSIX sh 语法】：Ubuntu/Debian 的 `sh`→dash 会从头解析整文件，
# 若此处写 `[[` / `local` / `pipefail`，在 exec bash 之前就会报错。
if [ -z "${BASH_VERSION:-}" ]; then
    _OB_BASH=""
    if command -v bash >/dev/null 2>&1; then
        _OB_P="$(command -v bash)"
        if [ -n "${_OB_P}" ] && [ -x "${_OB_P}" ]; then
            _OB_BASH="${_OB_P}"
        fi
    fi
    if [ -z "${_OB_BASH}" ]; then
        for _OB_P in /usr/bin/bash /bin/bash /usr/local/bin/bash /opt/homebrew/bin/bash; do
            if [ -x "${_OB_P}" ]; then
                _OB_BASH="${_OB_P}"
                break
            fi
        done
    fi
    if [ -z "${_OB_BASH}" ]; then
        echo "[error] 需要 bash（≥3.2）。Ubuntu/Debian: apt install bash；macOS: brew install bash" >&2
        exit 1
    fi
    exec "${_OB_BASH}" "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

_OB_OS="$(uname -s 2>/dev/null || echo unknown)"
_OB_ARCH="$(uname -m 2>/dev/null || echo unknown)"

# ── Python 3（≥3.9；macOS 勿用裸 python=2.7；Linux 优先 venv 再 PATH）──
_ob_python_ok() {
    local exe="$1"
    [[ -n "${exe}" && -x "${exe}" ]] || return 1
    "${exe}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null
}

_resolve_python() {
    local d exe
    for d in "${REPO_ROOT}/.venv" "${REPO_ROOT}/venv" "${OPENBLOCK_VENV:-}"; do
        [[ -n "${d}" ]] || continue
        exe="${d}/bin/python"
        if _ob_python_ok "${exe}"; then
            echo "${exe}"
            return 0
        fi
        exe="${d}/bin/python3"
        if _ob_python_ok "${exe}"; then
            echo "${exe}"
            return 0
        fi
    done
    local cmd
    for cmd in python3 python3.12 python3.11 python3.10 python3.9; do
        if command -v "${cmd}" >/dev/null 2>&1; then
            exe="$(command -v "${cmd}")"
            if _ob_python_ok "${exe}"; then
                echo "${exe}"
                return 0
            fi
        fi
    done
    echo "[error] 未找到 Python ≥3.9。macOS/Linux: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
    return 1
}
PYTHON="$(_resolve_python)"

# 默认 worker 数：Linux nproc / macOS sysctl；未设置 N_WORKERS 时按 CPU 留 1 核，上限 8、下限 1
_ob_default_workers() {
    local n raw
    raw=""
    if command -v nproc >/dev/null 2>&1; then
        raw="$(nproc 2>/dev/null || true)"
    elif [[ "${_OB_OS}" == "Darwin" ]]; then
        raw="$(sysctl -n hw.logicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || true)"
    elif [[ -r /proc/cpuinfo ]]; then
        raw="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
    fi
    n="${raw//[^0-9]/}"
    [[ -z "${n}" || "${n}" -lt 1 ]] && n=3
    [[ "${n}" -gt 8 ]] && n=8
    if [[ "${n}" -gt 1 ]]; then
        n=$((n - 1))
    fi
    echo "${n}"
}

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
N_WORKERS="${N_WORKERS:-$(_ob_default_workers)}"
EVAL_GATE_EVERY="${EVAL_GATE_EVERY:-2000}"
EVAL_GATE_GAMES="${EVAL_GATE_GAMES:-50}"
SAVE_PATH="${SAVE_PATH:-rl_checkpoints/full_mcts.pt}"
MCTS_SIMS="${MCTS_SIMS:-32}"                              # 24 → 32：略增 teacher 质量

# ── 数值稳定旋钮（显式 pin，避免从浏览器会话泄漏的 env 把离线栈带偏）──────────
# 当前 conv-shared 栈的设计是「return_scale=1 + 裁剪式稳定」，与 --value-huber-beta=1
# 配套（回报落在 [-5,50] 区间）。切勿沿用旧 shared/width256 时代的 0.032，否则回报被
# 压扁 30×、advantage 退化、价值头与 huber beta 失配。若仍偶发 non_finite_grad，
# 优先调小 GAE_DELTA_CLIP / GRAD_CLIP，而非动 return scale。
RETURN_SCALE="${RETURN_SCALE:-1.0}"                       # RL_RETURN_SCALE：回报缩放（本栈固定 1.0）
GRAD_CLIP="${GRAD_CLIP:-1.0}"                             # --grad-clip：PPO 全局梯度范数上限
VALUE_TARGET_CLIP="${VALUE_TARGET_CLIP:-512}"            # RL_VALUE_TARGET_CLIP：价值回归目标裁剪
GAE_DELTA_CLIP="${GAE_DELTA_CLIP:-80}"                   # RL_GAE_DELTA_CLIP：TD 误差裁剪

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

# ── 数值稳定 env（显式 pin，覆盖任何泄漏值）────────────────────────────────
export RL_RETURN_SCALE="${RETURN_SCALE}"                    # 固定回报缩放，杜绝旧 0.032 泄漏
export RL_VALUE_TARGET_CLIP="${VALUE_TARGET_CLIP}"          # 价值目标裁剪
export RL_GAE_DELTA_CLIP="${GAE_DELTA_CLIP}"                # TD 误差裁剪

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
echo "  platform     : ${_OB_OS} / ${_OB_ARCH}"
echo "  episodes     : ${EPISODES}"
echo "  python       : ${PYTHON} ($("${PYTHON}" --version 2>&1 | head -n 1))"
echo "  device       : ${DEVICE}"
echo "  arch / width : ${ARCH} / ${WIDTH}"
echo "  batch / ppo  : ${BATCH_EPISODES} / ${PPO_EPOCHS}"
echo "  workers      : ${N_WORKERS}"
echo "  dirichlet    : eps=${DIRICHLET_EPSILON} alpha=${DIRICHLET_ALPHA}"
echo "  stability    : return_scale=${RETURN_SCALE} grad_clip=${GRAD_CLIP} value_target_clip=${VALUE_TARGET_CLIP} gae_delta_clip=${GAE_DELTA_CLIP}"
echo "  save         : ${SAVE_PATH}"
echo "  log          : ${LOG_FILE}"
echo "  env"
echo "    RL_MCTS                       = ${RL_MCTS}"
echo "    RL_CURRICULUM_MODE            = ${RL_CURRICULUM_MODE}"
echo "    RL_ZOBRIST_SHARED             = ${RL_ZOBRIST_SHARED}"
echo "    winThresholdEnd (linear only) = $("${PYTHON}" -c "import json; print(json.load(open('${REPO_ROOT}/shared/game_rules.json'))['rlCurriculum']['winThresholdEnd'])")"
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
    --grad-clip "${GRAD_CLIP}" \
    --save "${SAVE_PATH}" \
    ${RESUME_ARG} \
    2>&1 | tee "${LOG_FILE}"
