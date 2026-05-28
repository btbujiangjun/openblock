#!/usr/bin/env bash
# 停止 restart-openblock.sh 启动的后端 + 前端（按 logs/*.pid 与 .env 端口）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

_read_env_var() {
  local key=$1 default=$2 val
  val=$(grep -E "^\s*${key}\s*=" "${REPO_ROOT}/.env" 2>/dev/null | head -1 | sed 's/^[^=]*=\s*//' | tr -d '[:space:]"')
  echo "${val:-$default}"
}

API_PORT=$(_read_env_var PORT 5000)
DEV_PORT=$(_read_env_var VITE_PORT 3000)

_stop_pid() {
  local f=$1 label=$2
  [[ -f "$f" ]] || return 0
  local pid
  pid=$(tr -d '[:space:]' <"$f")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "已停止 ${label} pid=${pid}"
  fi
  rm -f "$f"
}

_stop_pid logs/server.pid "server"
_stop_pid logs/dev.pid "dev"

if command -v lsof >/dev/null 2>&1; then
  for port in "$API_PORT" "$DEV_PORT"; do
    pids=$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    [[ -z "${pids//[$' \t\n']}" ]] && continue
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill "$pid" 2>/dev/null || true
      echo "已释放端口 ${port} pid=${pid}"
    done <<<"$pids"
  done
fi

echo "OpenBlock 前后端已停止（API :${API_PORT}  DEV :${DEV_PORT}）"
