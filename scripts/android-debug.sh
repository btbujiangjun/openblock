#!/usr/bin/env bash
#
# Android 联机调试一站式脚本：构建（可选）→ 安装 → 启动 → 实时 logcat 过滤。
#
# 用法：
#   scripts/android-debug.sh                       # 默认: cocos 路径，跳过构建，安装+启动+logcat
#   scripts/android-debug.sh build                 # 完整构建 cocos android（Creator → assembleDebug）+ 安装 + 联机
#   scripts/android-debug.sh assemble              # 跳过 Creator，仅 ./gradlew assembleDebug + 安装 + 联机
#   scripts/android-debug.sh logcat                # 仅 logcat，不重装
#   scripts/android-debug.sh mobile                # Capacitor 套壳路径（mobile/android）
#   scripts/android-debug.sh mobile build          # 完整 mobile:apk:debug + 安装 + 联机
#
# 过滤目标：
#   - [NewbieVillage] —— 新手村事件 / 命中 / origin
#   - [OpenBlock]     —— Bootstrap / GameController touch-start / drag / Modal
#   - CocosLog/cocos  —— 引擎日志（崩溃栈、shader、纹理）
#   - JS / chromium   —— web 套壳的 console.log
#
# Tips:
#   - 设备未识别：开「开发者选项 → USB 调试」，第一次插线手机会弹「允许此电脑调试」对话框。
#   - 多设备：export ANDROID_SERIAL=<serial>，所有 adb 命令会路由到该设备。
#   - 想保留全量原始 logcat 副本：DUMP_LOG=1 scripts/android-debug.sh —— 同时另存到 /tmp/openblock-logcat-<ts>.log

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── 路径与包名 ─────────────────────────────────────────────────────────────
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
if [[ ! -x "$ADB" ]]; then
    if command -v adb >/dev/null 2>&1; then
        ADB="$(command -v adb)"
    else
        echo "✗ 找不到 adb。请安装 Android SDK Platform Tools 或设置 ADB=/path/to/adb。"
        exit 1
    fi
fi

# 解析参数
MODE="cocos"
ACTION="install_run_log"
for arg in "$@"; do
    case "$arg" in
        cocos|mobile)   MODE="$arg" ;;
        build)          ACTION="build_install_run_log" ;;
        assemble)       ACTION="assemble_install_run_log" ;;
        logcat)         ACTION="logcat_only" ;;
        *) echo "未识别参数: $arg"; exit 2 ;;
    esac
done

if [[ "$MODE" == "cocos" ]]; then
    PKG="com.openblock.game"
    ACTIVITY="com.openblock.game/com.cocos.game.AppActivity"
    ANDROID_PROJ="$ROOT/cocos/build/android/proj"
    # Cocos gradle 用 `project(':app').name = "openblock-cocos"` 重命名 module，
    # 故 APK 实际在 build/openblock-cocos/outputs/...（不是 app/build/outputs/...）。
    # glob 兼容未来重命名 / variant 切换。
    APK_PATH="$(ls -t "$ANDROID_PROJ"/build/*/outputs/apk/debug/*-debug.apk 2>/dev/null | head -1)"
    [[ -z "$APK_PATH" ]] && APK_PATH="$ANDROID_PROJ/build/openblock-cocos/outputs/apk/debug/openblock-cocos-debug.apk"
else
    # Capacitor 路径：包名以 mobile/android/app/build.gradle 为准
    PKG="$(grep -E 'applicationId' "$ROOT/mobile/android/app/build.gradle" 2>/dev/null \
        | head -1 | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/")"
    PKG="${PKG:-com.openblock.app}"
    ACTIVITY="$PKG/.MainActivity"
    ANDROID_PROJ="$ROOT/mobile/android"
    APK_PATH="$ANDROID_PROJ/app/build/outputs/apk/debug/app-debug.apk"
fi

echo "==> 模式: $MODE  包名: $PKG"
echo "==> Android 工程: $ANDROID_PROJ"
echo "==> adb: $ADB"

# ── 设备检查 ───────────────────────────────────────────────────────────────
SERIALS=()
while IFS= read -r line; do
    [[ -z "$line" || "$line" == *"List of devices"* || "$line" == *"daemon"* ]] && continue
    SERIALS+=("${line%%$'\t'*}")
done < <("$ADB" devices | tail -n +2 | grep -E $'\t(device)$')
if [[ ${#SERIALS[@]} -eq 0 ]]; then
    echo "✗ 未发现 adb 已授权设备。"
    echo "   1) 手机/模拟器开『USB 调试』并接受电脑指纹；"
    echo "   2) $ADB devices 应能看到 <serial>\\tdevice。"
    exit 1
fi
echo "==> 设备: ${SERIALS[*]}"
if [[ ${#SERIALS[@]} -gt 1 && -z "${ANDROID_SERIAL:-}" ]]; then
    echo "ℹ︎ 多设备已识别，默认 adb 会失败。请 export ANDROID_SERIAL=<serial> 后重跑。"
    exit 1
fi

# ── JDK / Java 环境（cocos 路径走 JDK 17）──────────────────────────────────
find_jdk() {
    local want="$1" # 17 / 21
    if [[ -n "${JAVA_HOME:-}" && -d "$JAVA_HOME" ]]; then echo "$JAVA_HOME"; return; fi
    if command -v /usr/libexec/java_home >/dev/null 2>&1; then
        /usr/libexec/java_home -v "$want" 2>/dev/null && return
    fi
    local cand
    for cand in /opt/homebrew/opt/openjdk@${want} /usr/local/opt/openjdk@${want}; do
        [[ -d "$cand" ]] && { echo "$cand"; return; }
    done
}

case "$ACTION" in
    build_install_run_log)
        if [[ "$MODE" == "cocos" ]]; then
            echo "==> [1/4] Cocos Creator 出 Android 工程"
            npm run build:cocos -- android || exit 1
            JH="$(find_jdk 17)"; [[ -z "$JH" ]] && { echo "✗ 未找到 JDK 17"; exit 1; }
            export JAVA_HOME="$JH"; export PATH="$JH/bin:$PATH"
            echo "==> [2/4] gradlew assembleDebug (JDK=$JH)"
            ( cd "$ANDROID_PROJ" && ./gradlew assembleDebug ) || exit 1
        else
            echo "==> [1/2] npm run mobile:apk:debug"
            npm run mobile:apk:debug || exit 1
        fi
        ;;
    assemble_install_run_log)
        JH="$(find_jdk 17)"; [[ -z "$JH" ]] && { echo "✗ 未找到 JDK 17"; exit 1; }
        export JAVA_HOME="$JH"; export PATH="$JH/bin:$PATH"
        echo "==> gradlew assembleDebug (JDK=$JH)"
        ( cd "$ANDROID_PROJ" && ./gradlew assembleDebug ) || exit 1
        ;;
    install_run_log|logcat_only) ;;
esac

# ── 安装 / 启动 ────────────────────────────────────────────────────────────
if [[ "$ACTION" != "logcat_only" ]]; then
    if [[ ! -f "$APK_PATH" ]]; then
        echo "✗ 找不到 APK: $APK_PATH"
        echo "   请先跑：scripts/android-debug.sh $MODE build"
        exit 1
    fi
    echo "==> 安装 APK: $APK_PATH"
    "$ADB" install -r -d "$APK_PATH" || {
        echo "ℹ︎ 安装失败 → 先卸载旧版再装"
        "$ADB" uninstall "$PKG" >/dev/null 2>&1 || true
        "$ADB" install -r -d "$APK_PATH" || exit 1
    }
    echo "==> 启动: $ACTIVITY"
    "$ADB" shell am start -W -n "$ACTIVITY" || exit 1
fi

# ── logcat 实时过滤 ────────────────────────────────────────────────────────
echo "==> 实时 logcat（Ctrl+C 退出）"
echo "   过滤关键字: NewbieVillage | OpenBlock | CocosLog | cocos | JS | chromium | DEBUG | FATAL"

# 清掉历史 buffer，从此刻开始追踪本次启动
"$ADB" logcat -c
DUMP="${DUMP_LOG:-0}"
TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="/tmp/openblock-logcat-${TS}.log"

# 用 grep -E 而非 -s xxx：cocos 引擎/JS 日志的 TAG 在不同机型差异大，关键字过滤更可靠
FILTER='\[NewbieVillage\]|\[OpenBlock\]|CocosLog|cocos\.|chromium|^[A-Z]/JS|JS_Engine|libcocos|FATAL|AndroidRuntime|DEBUG\s+:'

if [[ "$DUMP" == "1" ]]; then
    echo "   全量原始日志同步保存到: $DUMP_FILE"
    "$ADB" logcat -v time | tee "$DUMP_FILE" | grep -E --line-buffered "$FILTER"
else
    "$ADB" logcat -v time | grep -E --line-buffered "$FILTER"
fi
