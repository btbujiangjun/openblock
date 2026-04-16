#!/usr/bin/env bash
# 一键拉代码、装依赖、杀端口、后台启动 Flask(5000) + Vite(80)。
# Linux / macOS 通用：优先用 lsof 查 LISTEN 并杀进程（mac 无可靠 fuser -k tcp）；
# 若无 lsof 则回退到 Linux 常见用法 fuser。
#
# 用法:
#   bash scripts/restart-openblock.sh
# 可选环境变量:
#   OPENBLOCK_VENV  Python venv 路径，默认 /root/.venv（不存在则跳过 activate）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VENV="${OPENBLOCK_VENV:-/root/.venv}"
if [[ -f "${VENV}/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "${VENV}/bin/activate"
fi

git pull
npm install

mkdir -p logs

_has_lsof() { command -v lsof >/dev/null 2>&1; }
_has_fuser() { command -v fuser >/dev/null 2>&1; }

# 返回占用 port 的 LISTEN 进程 PID（每行一个）；无则空
_listen_pids() {
  local port=$1
  shift
  local runner=("$@")
  if ((${#runner[@]})); then
    "${runner[@]}" lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
  else
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
  fi
}

# 端口上无 LISTEN 则返回 0（空闲）
_port_is_free() {
  local port=$1
  shift
  local runner=("$@")
  local pids
  if _has_lsof; then
    pids=$(_listen_pids "$port" "${runner[@]}")
    [[ -z "${pids//[$' \t\n']}" ]]
  elif _has_fuser; then
    if ((${#runner[@]})); then
      ! "${runner[@]}" fuser "${port}/tcp" >/dev/null 2>&1
    else
      ! fuser "${port}/tcp" >/dev/null 2>&1
    fi
  else
    return 1
  fi
}

# 用 lsof 找到监听进程：先 TERM 再 KILL（与 Linux fuser -k 效果接近）
_kill_listeners_lsof() {
  local port=$1
  shift
  local runner=("$@")
  local pids

  _kill_round() {
    local sig=$1
    pids=$(_listen_pids "$port" "${runner[@]}")
    [[ -z "${pids//[$' \t\n']}" ]] && return 0
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      if ((${#runner[@]})); then
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
  if ((${#runner[@]})); then
    "${runner[@]}" fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  else
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}

# 反复清理直到端口空闲（应对 Flask debug 子进程等）
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
    if _port_is_free "$port" "${runner[@]}"; then
      return 0
    fi
    if _has_lsof; then
      _kill_listeners_lsof "$port" "${runner[@]}"
    else
      _kill_listeners_fuser "$port" "${runner[@]}"
    fi
    sleep 0.35
    tries=$((tries + 1))
  done

  if _port_is_free "$port" "${runner[@]}"; then
    return 0
  fi
  echo "error: 端口 ${port} 仍被占用，已放弃启动。请检查:" >&2
  if _has_lsof; then
    if ((${#runner[@]})); then
      echo "  sudo lsof -nP -iTCP:${port} -sTCP:LISTEN" >&2
    else
      echo "  lsof -nP -iTCP:${port} -sTCP:LISTEN" >&2
    fi
  else
    echo "  fuser -v ${port}/tcp" >&2
  fi
  exit 1
}

_clear_port 5000
_clear_port 80 sudo

echo "启动 server（日志: logs/server.log）…"
nohup npm run server > ./logs/server.log 2>&1 &
SERVER_PID=$!
disown "${SERVER_PID}" 2>/dev/null || true

echo "启动 dev:80（日志: logs/dev.log）…"
sudo -E env PATH="$PATH" nohup npm run dev:80 > ./logs/dev.log 2>&1 &
DEV_PID=$!
disown "${DEV_PID}" 2>/dev/null || true

echo "已后台启动: server pid=${SERVER_PID}, dev:80 pid=${DEV_PID}"
echo "tail -f logs/server.log   # Flask"
echo "tail -f logs/dev.log      # Vite :80"
