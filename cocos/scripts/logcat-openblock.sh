#!/usr/bin/env bash
#
# logcat-openblock.sh —— 抓取 com.openblock.game 的 logcat（带 OpenBlock 标签过滤 + 全量备份）。
#
# 用法：
#   cocos/scripts/logcat-openblock.sh                 # 持续抓，Ctrl+C 结束
#   cocos/scripts/logcat-openblock.sh 60              # 抓 60 秒后自动结束
#
# 输出（每次运行生成 2 份）：
#   cocos/logs/logcat-YYYYMMDD-HHMMSS-full.log        所有日志（用于上下文）
#   cocos/logs/logcat-YYYYMMDD-HHMMSS-openblock.log   仅 [OpenBlock] 行（用于分析）
#
# 排查"安卓偶发无法拖动候选块"专用：复现卡死前启动本脚本，复现后 Ctrl+C，把 openblock 日志贴回。

set -uo pipefail

ADB="${ADB:-/Users/admin/Library/Android/sdk/platform-tools/adb}"
PKG="${PKG:-com.openblock.game}"
DURATION="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/logs"
mkdir -p "$LOG_DIR"

if [[ ! -x "$ADB" ]]; then
    echo "✗ 找不到 adb：$ADB" >&2
    echo "  可设置 ADB 环境变量指向正确路径。" >&2
    exit 1
fi

DEVICE=$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')
if [[ -z "$DEVICE" ]]; then
    echo "✗ 未检测到已连接设备。请确保 adb devices 能看到设备且授权了 USB 调试。" >&2
    exit 1
fi
echo "✔ 使用设备：$DEVICE"

PID=$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r')
if [[ -z "$PID" ]]; then
    echo "⚠ $PKG 当前未运行 —— 将抓全设备日志。请尽快打开 app 复现。" >&2
    PID_FLAG=""
else
    echo "✔ 目标进程 PID=$PID"
    PID_FLAG="--pid=$PID"
fi

STAMP=$(date +%Y%m%d-%H%M%S)
FULL="$LOG_DIR/logcat-$STAMP-full.log"
OB="$LOG_DIR/logcat-$STAMP-openblock.log"

echo
echo "▶ 清空 logcat 缓冲区"
"$ADB" logcat -c

echo "▶ 抓取中：$FULL"
echo "  + 过滤副本：$OB"
echo "  请此刻在手机上复现「无法拖动候选块」的卡死。"
if [[ -n "$DURATION" ]]; then
    echo "  将在 ${DURATION} 秒后自动结束。"
else
    echo "  Ctrl+C 结束。"
fi
echo

cleanup() {
    [[ -n "${LCPID:-}" ]] && kill "$LCPID" 2>/dev/null
    wait "${LCPID:-0}" 2>/dev/null || true
    echo
    echo "▶ 抓取结束。统计："
    if [[ -f "$FULL" ]]; then
        echo "  - 全量日志：$(wc -l < "$FULL") 行 → $FULL"
    fi
    # 从全量日志里提取 [OpenBlock] 命中
    grep -E '\[OpenBlock\]' "$FULL" > "$OB" 2>/dev/null || true
    if [[ -s "$OB" ]]; then
        echo "  - OpenBlock 行：$(wc -l < "$OB") 行 → $OB"
        echo
        echo "▶ 关键探针检查（带新版本日志说明 APK 已更新）："
        grep -E 'GameController\.onEnable|isMobile=|input listeners registered' "$OB" | head -3 || echo "  ✗ 未见 onEnable 探针 —— 设备上仍是旧 APK"
        echo
        echo "▶ 冻屏告警检查："
        grep -E 'Frozen\?' "$OB" | tail -5 || echo "  ✓ 本次未见 [Frozen?] 报警"
        echo
        echo "▶ 拖拽自愈告警检查："
        grep -E 'heal stale drag|drag watchdog reset|FLOOD|ghost-modal heal|gameOver heal' "$OB" | tail -10 || echo "  ✓ 本次未触发任何自愈告警"
    else
        echo "  ✗ 0 行 OpenBlock 日志 —— 可能 app 没启动或 console.log 没被打出。"
    fi
}
trap cleanup INT TERM EXIT

if [[ -n "$PID_FLAG" ]]; then
    "$ADB" logcat -v time $PID_FLAG > "$FULL" &
else
    "$ADB" logcat -v time > "$FULL" &
fi
LCPID=$!

if [[ -n "$DURATION" ]]; then
    sleep "$DURATION"
else
    wait "$LCPID"
fi
