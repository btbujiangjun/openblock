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

API_HOST=$(_read_env_var API_HOST 127.0.0.1)
API_PORT=$(_read_env_var PORT 5000)
DEV_PORT=$(_read_env_var VITE_PORT 3000)

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
sleep 0.2

echo "==> 启动 Flask 后端 :${API_PORT} → logs/server.log"
nohup npm run server > ./logs/server.log 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > logs/server.pid
disown "${SERVER_PID}" 2>/dev/null || true

echo "==> 启动 Vite 前端 :${DEV_PORT} → logs/dev.log"
if [[ "${DEV_PORT}" -lt 1024 ]]; then
  sudo -E env PATH="$PATH" nohup npm run dev:sudo > ./logs/dev.log 2>&1 &
else
  nohup npm run dev > ./logs/dev.log 2>&1 &
fi
DEV_PID=$!
echo "$DEV_PID" > logs/dev.pid
disown "${DEV_PID}" 2>/dev/null || true

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
