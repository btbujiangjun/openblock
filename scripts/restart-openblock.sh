#!/usr/bin/env bash
# 一键重启 OpenBlock 后端 (Flask) + 前端 (Vite)
#
# 用法:
#   bash scripts/restart-openblock.sh              # 快速重启（杀端口 → 后台启动）
#   bash scripts/restart-openblock.sh --full       # git pull + npm install + 重启（服务器部署）
#   bash scripts/restart-openblock.sh --install    # 仅 npm install + 重启
#   npm run restart                              # 同上（快速）
#
# 环境变量:
#   OPENBLOCK_VENV   额外 Python venv 路径（优先用仓库内 .venv / venv）
#   SKIP_PULL=1      等同默认快速模式
#   SKIP_INSTALL=1   跳过 npm install
#
# 日志: logs/server.log  logs/dev.log
# PID:  logs/server.pid  logs/dev.pid

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="quick"
for arg in "$@"; do
  case "$arg" in
    --full)    MODE="full" ;;
    --install) MODE="install" ;;
    --quick)   MODE="quick" ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $arg（可用 --quick | --full | --install | -h）" >&2
      exit 1
      ;;
  esac
done

# ── Python venv（本地优先 .venv）──
_activate_venv() {
  local d
  for d in "${REPO_ROOT}/.venv" "${REPO_ROOT}/venv" "${OPENBLOCK_VENV:-}"; do
    [[ -n "$d" && -f "${d}/bin/activate" ]] || continue
    # shellcheck source=/dev/null
    source "${d}/bin/activate"
    echo "Python: ${d}/bin/python ($(python3 --version 2>/dev/null || true))"
    return 0
  done
  echo "Python: $(command -v python3) ($(python3 --version 2>/dev/null || true))"
}

_activate_venv

if [[ "$MODE" == "full" ]]; then
  echo "==> git pull"
  git pull
  echo "==> npm install"
  npm install
elif [[ "$MODE" == "install" ]]; then
  echo "==> npm install"
  npm install
fi

mkdir -p logs

_has_lsof() { command -v lsof >/dev/null 2>&1; }
_has_fuser() { command -v fuser >/dev/null 2>&1; }

_listen_pids() {
  local port=$1
  shift
  local runner=("$@")
  if [[ ${#runner[@]} -gt 0 ]]; then
    "${runner[@]}" lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
  else
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
  fi
}

_port_is_free() {
  local port=$1
  shift
  local runner=("$@")
  local pids
  if _has_lsof; then
    pids=$(_listen_pids "$port" "${runner[@]+"${runner[@]}"}")
    [[ -z "${pids//[$' \t\n']}" ]]
  elif _has_fuser; then
    if [[ ${#runner[@]} -gt 0 ]]; then
      "${runner[@]}" fuser "${port}/tcp" >/dev/null 2>&1 && return 1 || return 0
    else
      fuser "${port}/tcp" >/dev/null 2>&1 && return 1 || return 0
    fi
  else
    return 1
  fi
}

_kill_listeners_lsof() {
  local port=$1
  shift
  local runner=("$@")
  local pids sig

  _kill_round() {
    sig=$1
    pids=$(_listen_pids "$port" "${runner[@]+"${runner[@]}"}")
    [[ -z "${pids//[$' \t\n']}" ]] && return 0
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      if [[ ${#runner[@]} -gt 0 ]]; then
        "${runner[@]}" kill "-${sig}" "$pid" 2>/dev/null || true
      else
        kill "-${sig}" "$pid" 2>/dev/null || true
      fi
    done <<<"$pids"
  }

  _kill_round TERM
  sleep 0.25
  _kill_round KILL
}

_kill_listeners_fuser() {
  local port=$1
  shift
  local runner=("$@")
  if [[ ${#runner[@]} -gt 0 ]]; then
    "${runner[@]}" fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  else
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}

_clear_port() {
  local port=$1
  shift
  local runner=("$@")
  local tries=0

  if ! _has_lsof && ! _has_fuser; then
    echo "error: 未找到 lsof 或 fuser，无法释放端口 ${port}" >&2
    exit 1
  fi

  while [[ $tries -lt 20 ]]; do
    if _port_is_free "$port" "${runner[@]+"${runner[@]}"}"; then
      return 0
    fi
    if _has_lsof; then
      _kill_listeners_lsof "$port" "${runner[@]+"${runner[@]}"}"
    else
      _kill_listeners_fuser "$port" "${runner[@]+"${runner[@]}"}"
    fi
    sleep 0.35
    tries=$((tries + 1))
  done

  if _port_is_free "$port" "${runner[@]+"${runner[@]}"}"; then
    return 0
  fi
  echo "error: 端口 ${port} 仍被占用" >&2
  _has_lsof && lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  exit 1
}

_read_env_var() {
  local key=$1 default=$2 val
  val=$(grep -E "^\s*${key}\s*=" "${REPO_ROOT}/.env" 2>/dev/null | head -1 | sed 's/^[^=]*=\s*//' | tr -d '[:space:]"')
  echo "${val:-$default}"
}

# 以独立会话启动后台进程：用 Python start_new_session=True（等价 setsid，macOS 无 setsid）
# 让子进程成为新的会话/进程组首领，彻底脱离当前 shell 的进程组。这样即便父 shell
# （如 IDE 集成终端 / 自动化工具会话）被按进程组回收，服务也不会被连带杀掉——
# 这正是之前 nohup+disown 仍被回收的根因（disown 只去作业控制，进程组未变）。
# 用法：PID=$(_spawn_detached <logfile> <cmd> [args...])
_spawn_detached() {
  local log=$1
  shift
  REPO_ROOT="$REPO_ROOT" python3 - "$log" "$@" <<'PY'
import os, subprocess, sys
log_path = sys.argv[1]
cmd = sys.argv[2:]
# 截断写入：每次启动清空日志，避免上一轮的「Open Block API」就绪标记误导本轮等待检测。
f = open(log_path, "wb", buffering=0)
p = subprocess.Popen(
    cmd,
    cwd=os.environ.get("REPO_ROOT") or None,
    stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
    start_new_session=True,
)
print(p.pid)
PY
}

API_HOST=$(_read_env_var API_HOST 127.0.0.1)
API_PORT=$(_read_env_var PORT 5000)
DEV_PORT=$(_read_env_var VITE_PORT 3000)

# 让后端 / 前端实际绑定到 .env 指定端口（server.py 与 vite 均读 env，而非 bash 变量）。
export PORT="${API_PORT}"
export VITE_PORT="${DEV_PORT}"

echo "==> 释放端口 API:${API_PORT}  DEV:${DEV_PORT}"
_clear_port "${API_PORT}"
if [[ "${DEV_PORT}" -lt 1024 ]]; then
  _clear_port "${DEV_PORT}" sudo
else
  _clear_port "${DEV_PORT}"
fi

# 停掉上次记录的 PID（若进程仍存活）
_stop_pid_file() {
  local f=$1
  [[ -f "$f" ]] || return 0
  local pid
  pid=$(tr -d '[:space:]' <"$f" 2>/dev/null || true)
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  rm -f "$f"
}
_stop_pid_file logs/server.pid
_stop_pid_file logs/dev.pid

# 收割孤儿训练进程：detached `rl_pytorch.train` 不在 PID 文件中，历次重启会累积；
# 多个训练写同一 checkpoint/training.jsonl 会互相回滚、交错日志、注入旧代码的异常值
# （如 approx_kl=1e29）。重启前必须先全部杀掉，确保只剩本次拉起的单一训练进程。
_kill_orphan_trainers() {
  command -v pgrep >/dev/null 2>&1 || return 0
  local pids
  pids=$(pgrep -f "rl_pytorch.train" 2>/dev/null || true)
  [[ -z "${pids//[$' \t\n']}" ]] && return 0
  echo "==> 收割孤儿训练进程: $(echo "$pids" | tr '\n' ' ')"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done <<<"$pids"
  sleep 0.6
  pids=$(pgrep -f "rl_pytorch.train" 2>/dev/null || true)
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done <<<"$pids"
}
_kill_orphan_trainers
sleep 0.2

# ── 浏览器 RL 在线训练优化（后端 PPO 旋钮，全部可被外部 env 覆盖）─────────────
# 针对「浏览器/后端在线路径」实测问题调参（teacher 覆盖=0 时的纯 PG + 辅助头训练）：
#   · non_finite_grad 偏高（离群高分局 → 回报/梯度暴冲）：增大批稀释离群 + 收紧裁剪
#   · 熵深谷（残局采样过度确定化）：抬熵系数与其衰减下限维持探索
#   · 价值损失常年不降（baseline 欠拟合）：略增价值头损失权重
# 想接弱 teacher 仍需在面板勾选「1-step lookahead」（本脚本不强制改默认）。
export RL_RETURN_SCALE="${RL_RETURN_SCALE:-1.0}"          # 固定回报缩放，配 huber-beta=1
export RL_RETURNS_CLIP="${RL_RETURNS_CLIP:-384}"         # 512→384：削离群局回报尾巴
export RL_GRAD_CLIP="${RL_GRAD_CLIP:-0.5}"               # 1.0→0.5：更保守的梯度裁剪
export RL_BATCH_SIZE="${RL_BATCH_SIZE:-64}"             # 32→64：稀释离群、降方差
export RL_VALUE_COEF="${RL_VALUE_COEF:-1.25}"           # 1.0→1.25：价值头多吃梯度，加速拟合
export RL_ENTROPY_COEF="${RL_ENTROPY_COEF:-0.03}"      # 0.025→0.03：维持探索
export RL_ENTROPY_COEF_MIN="${RL_ENTROPY_COEF_MIN:-0.02}"   # 0.012→0.02：抗熵塌缩（日志见熵均值塌到 ~0.15），残局保留探索
# ── v13 防退化栈（针对「得分越来越低」根因，全部可被外部 env 覆盖）──
export RL_TARGET_KL="${RL_TARGET_KL:-5.0}"             # 0.1→5.0：基于实测真实 KL 分布（mean≈20, median≈2.4）放宽。
                                                       # 旧值 0.1 是基于「MPS .sum() bug 导致 approx_kl=1e21」误判而设；
                                                       # 修复 MPS reduction 后真实 KL 因蒸馏+BC 主导 + 小 batch 而稳定在
                                                       # 个位数到几十，0.1 会 100% 早停 PPO 到 1 epoch。5.0 覆盖 ~98% 真实
                                                       # 样本，让 4-epoch PPO 真正生效；仍在策略真发散（KL>5）时早停。
export RL_VALUE_RETURN_SCALE="${RL_VALUE_RETURN_SCALE:-0.5}"  # 灰度压低价值头 returns 目标量纲，缓解 loss_value 高位不降（MCTS 已 Q 归一化对尺度免疫）
export RL_BEST_GUARD="${RL_BEST_GUARD:-1}"             # best-checkpoint 守护：滚动均分创新高即快照、显著回撤即回滚到 best
export RL_BEST_GUARD_EVERY="${RL_BEST_GUARD_EVERY:-200}"     # 守护检查间隔（局）
export RL_BEST_GUARD_REGRESS="${RL_BEST_GUARD_REGRESS:-0.85}"  # 回撤阈值：均分 < best×此值 即回滚
export RL_OUTCOME_REF_SCORE="${RL_OUTCOME_REF_SCORE:-1500}"  # outcome 价值目标固定参考分（去课程门槛耦合，目标平稳）
export RL_KL_REF_COEF="${RL_KL_REF_COEF:-0.05}"        # KL-to-reference：软约束策略不远离历史最优快照（每批多一次参考前向；0=关）
export RL_HIGH_SCORE_REPLAY="${RL_HIGH_SCORE_REPLAY:-1}"  # 高分优先回放：按 score 加权采样/保留 + 对高分局 chosen 动作行为克隆
echo "==> RL 在线训练旋钮: returns_clip=${RL_RETURNS_CLIP} grad_clip=${RL_GRAD_CLIP} batch=${RL_BATCH_SIZE} value_coef=${RL_VALUE_COEF} value_return_scale=${RL_VALUE_RETURN_SCALE} entropy=${RL_ENTROPY_COEF}->${RL_ENTROPY_COEF_MIN}"
echo "==> RL 防退化栈: target_kl=${RL_TARGET_KL} best_guard=${RL_BEST_GUARD}(every=${RL_BEST_GUARD_EVERY},regress=${RL_BEST_GUARD_REGRESS}) outcome_ref=${RL_OUTCOME_REF_SCORE} kl_ref=${RL_KL_REF_COEF} hi_replay=${RL_HIGH_SCORE_REPLAY}"

# ── RL 看板/后台训练所需环境（训练日志落盘、热加载检查点、设备/网络宽度）──
# 缺失时后台训练无法把指标写入 training.jsonl，看板将看不到实时日志。
export RL_TRAINING_LOG="${RL_TRAINING_LOG:-rl_checkpoints/training.jsonl}"
export RL_CHECKPOINT_SAVE="${RL_CHECKPOINT_SAVE:-rl_checkpoints/bb_policy.pt}"
export RL_AUTOLOAD="${RL_AUTOLOAD:-1}"
export RL_DEVICE="${RL_DEVICE:-auto}"
export RL_WIDTH="${RL_WIDTH:-128}"
export RL_SAVE_EVERY="${RL_SAVE_EVERY:-500}"

echo "==> 启动 Flask 后端 :${API_PORT} → logs/server.log"
SERVER_PID=$(_spawn_detached ./logs/server.log npm run server)
echo "$SERVER_PID" > logs/server.pid

echo "==> 启动 Vite 前端 :${DEV_PORT} → logs/dev.log"
if [[ "${DEV_PORT}" -lt 1024 ]]; then
  DEV_PID=$(_spawn_detached ./logs/dev.log sudo -E env PATH="$PATH" npm run dev:sudo)
else
  DEV_PID=$(_spawn_detached ./logs/dev.log npm run dev)
fi
echo "$DEV_PID" > logs/dev.pid

# 等待后端打印就绪（最多 25s）
echo -n "==> 等待后端就绪"
_ready=0
for _ in $(seq 1 50); do
  if grep -q "Open Block API" logs/server.log 2>/dev/null; then
    _ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "error: 后端进程已退出，请查看 logs/server.log" >&2
    tail -n 30 logs/server.log >&2 || true
    exit 1
  fi
  echo -n "."
  sleep 0.5
done
echo ""

if [[ "$_ready" -eq 0 ]]; then
  echo "warn: 25s 内未在日志中看到「Open Block API」，可能仍在加载，请 tail -f logs/server.log"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  已重启  server pid=${SERVER_PID}  →  http://${API_HOST}:${API_PORT}"
echo "          dev    pid=${DEV_PID}    →  http://127.0.0.1:${DEV_PORT}"
echo "  Spawn 调参看板: http://127.0.0.1:${DEV_PORT}/spawn-tuning-v2-dashboard.html"
echo "  日志: tail -f logs/server.log | tail -f logs/dev.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
