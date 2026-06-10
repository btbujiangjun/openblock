#!/usr/bin/env bash
#
# build-android.sh —— 一键构建 Cocos Android 工程，并可继续打包 APK/AAB。
#
# 用法：
#   cocos/scripts/build-android.sh                         # 仅构建 JS 包 + 生成 Android 工程
#   cocos/scripts/build-android.sh --open                  # 构建后用 Android Studio 打开工程
#   cocos/scripts/build-android.sh --apk                   # 构建后打 debug/release APK（按配置 debug 字段决定）
#   cocos/scripts/build-android.sh --aab                   # 构建后打 Android App Bundle
#   cocos/scripts/build-android.sh --install               # 构建 APK 并安装到已连接设备
#   cocos/scripts/build-android.sh path/to/android.json --apk
#
# 环境变量：
#   COCOS_CREATOR   覆盖 Cocos Creator 可执行文件路径
#   ANDROID_HOME    Android SDK 根目录（Gradle/adb 需要）
#   JAVA_HOME       JDK 路径（Cocos/Gradle 需要）
#
# 退出码：构建成功 0；失败 1。

set -uo pipefail

CREATOR="${COCOS_CREATOR:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COCOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG=""
DO_OPEN=0
DO_APK=0
DO_AAB=0
DO_INSTALL=0

for arg in "$@"; do
    case "$arg" in
        --open)    DO_OPEN=1 ;;
        --apk)     DO_APK=1 ;;
        --aab)     DO_AAB=1 ;;
        --install) DO_INSTALL=1; DO_APK=1 ;;
        --*)       echo "✗ 未知参数：$arg" >&2; exit 1 ;;
        *)         CONFIG="$arg" ;;
    esac
done

CONFIG="${CONFIG:-$COCOS_DIR/build-configs/android.json}"
case "$CONFIG" in
    /*) ;;
    *)  CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")" ;;
esac

if [[ ! -x "$CREATOR" ]]; then
    echo "✗ 找不到 Cocos Creator：$CREATOR" >&2
    echo "  可设置环境变量 COCOS_CREATOR 指向正确的可执行文件。" >&2
    exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
    echo "✗ 找不到构建配置：$CONFIG" >&2
    exit 1
fi

SDKMANAGER=""

detect_java_env() {
    # 优先复用用户显式配置；其次尝试 macOS java_home；最后尝试 Android Studio 自带 JBR。
    if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
        return 0
    fi

    local home=""
    home="$(/usr/libexec/java_home 2>/dev/null || true)"
    if [[ -n "$home" && -x "$home/bin/java" ]]; then
        export JAVA_HOME="$home"
        return 0
    fi

    local jbr
    for jbr in \
        "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
        "/Applications/Android Studio.app/Contents/jre/Contents/Home"; do
        if [[ -x "$jbr/bin/java" ]]; then
            export JAVA_HOME="$jbr"
            return 0
        fi
    done

    return 1
}

print_java_help() {
    cat >&2 <<'EOF'

未找到 Java Runtime/JDK。Android sdkmanager、Cocos Android 构建和 Gradle 都需要 JDK。

推荐安装方式：

1. 使用 Homebrew 安装 JDK 17：
   brew install --cask temurin@17

   安装后设置：
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)

2. 或安装 Android Studio，使用其内置 JBR。

验证：
   java -version
   echo "$JAVA_HOME"

EOF
}

detect_android_env() {
    local default_sdk="$HOME/Library/Android/sdk"
    if [[ -z "${ANDROID_HOME:-}" && -d "$default_sdk" ]]; then
        export ANDROID_HOME="$default_sdk"
    fi
    if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
        export ANDROID_SDK_ROOT="$ANDROID_HOME"
    fi

    if [[ -n "${ANDROID_HOME:-}" ]]; then
        if [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
            SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        elif [[ -x "$ANDROID_HOME/tools/bin/sdkmanager" ]]; then
            SDKMANAGER="$ANDROID_HOME/tools/bin/sdkmanager"
        fi
    fi

    # Cocos/Gradle 常见变量都补上；真正路径仍需在 Cocos GUI 外部程序里保存一次。
    if [[ -z "${ANDROID_NDK_HOME:-}" && -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/ndk" ]]; then
        local ndk
        ndk="$(ls -d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -1)"
        if [[ -n "$ndk" ]]; then
            export ANDROID_NDK_HOME="$ndk"
            export NDK_ROOT="$ndk"
        fi
    fi
}

android_api_level() {
    grep -E '"apiLevel"[[:space:]]*:' "$CONFIG" | sed -E 's/.*"apiLevel"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/' | head -1
}

print_android_env_help() {
    local api="${1:-34}"
    local ndk_pkg="${2:-ndk;26.3.11579264}"
    cat >&2 <<EOF

Android SDK/NDK 未配置或组件不完整。请先完成以下步骤：

1. 安装缺失组件（可复制执行）：
   "${SDKMANAGER:-sdkmanager}" "platform-tools" "build-tools;34.0.0" "platforms;android-$api" "$ndk_pkg"
   yes | "${SDKMANAGER:-sdkmanager}" --licenses

2. 在 Cocos Creator GUI 中保存路径：
   Cocos Creator -> 偏好设置 -> 外部程序
   Android SDK: ${ANDROID_HOME:-$HOME/Library/Android/sdk}
   Android NDK: ${ANDROID_NDK_HOME:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/ndk/<version>}

3. shell 环境变量参考：
   export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
   export ANDROID_SDK_ROOT="\$ANDROID_HOME"
   export ANDROID_NDK_HOME="<你的 NDK 路径>"
   export NDK_ROOT="\$ANDROID_NDK_HOME"

EOF
}

preflight_android_env() {
    if ! detect_java_env; then
        print_java_help
        exit 1
    fi
    echo "  JAVA_HOME=$JAVA_HOME"

    detect_android_env
    local api
    api="$(android_api_level)"
    api="${api:-34}"

    local missing=0
    if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
        echo "✗ 未找到 Android SDK。默认检查：$HOME/Library/Android/sdk" >&2
        missing=1
    elif [[ ! -d "$ANDROID_HOME/platforms/android-$api" ]]; then
        echo "✗ 缺少 Android platform：$ANDROID_HOME/platforms/android-$api" >&2
        missing=1
    fi

    if [[ -z "${ANDROID_NDK_HOME:-}" || ! -d "$ANDROID_NDK_HOME" ]]; then
        echo "✗ 未找到 Android NDK（$ANDROID_HOME/ndk 下没有版本目录）。" >&2
        missing=1
    fi

    if [[ "$missing" -eq 1 ]]; then
        print_android_env_help "$api"
        exit 1
    fi

    echo "  Android SDK=$ANDROID_HOME"
    echo "  Android NDK=$ANDROID_NDK_HOME"
}

echo "▶ 构建 Android：project=$COCOS_DIR"
echo "  config=$CONFIG"
preflight_android_env

# Cocos Creator 无头 Electron 构建成功后偶发输出 IPC 退出噪音。
# 注意：Android 插件失败时也可能打印 build Task Finished，因此不能只看 Finished。
# 过滤退出噪音：见 build-ios.sh 中的同名变量注释。
NOISE='mach_port_rendezvous|shared_memory_switch|No rendezvous client|Recovery window failed|window\.json: Unexpected end of JSON|^SyntaxError:|^\s+at (JSON\.parse|_readFile|Object\.(startup|window)|async Promise\.all|launch|/Applications/Cocos/)'
BUILD_ERROR='构建插件 android 的钩子函数 .*执行失败|找不到 Android NDK/SDK 路径|Android NDK/SDK|ERROR|Error:|error:|Failed|Exception'
# Cocos Creator 3.8.x may print these during a successful build. Treat them as
# noise unless the final "Finished" marker is missing.
# - [BABEL] ... deoptimised the styling ... exceeds the max of 500KB：Babel 对超大文件（如
#   生成的 spawnPoliciesV2.mjs）的降级提示，仅影响压缩耗时，构建结果正常；却带 Error:/error:
#   前缀命中 BUILD_ERROR，必须白名单，否则误报构建失败。
BENIGN_BUILD_ERROR='buildPolyfillsCommand.*Caught exception during build core-js|This may indicates the core-js polyfill is not necessary|Error: Exit process with code:null, signal:SIGTERM in task (build-script|build-engine)|\[BABEL\] Note: The code generator has deoptimised the styling|exceeds the max of [0-9]+KB'
LOG="$(mktemp -t cocos-build-android)"

# ⚠️ ELECTRON_RUN_AS_NODE 必须 unset：某些开发环境（如 Cursor agent shell、部分 IDE
#   集成终端）会把它注入子进程，导致 CocosCreator 这个 Electron 启动器走 Node CLI 模式，
#   把 --project 当作 Node module 路径解析 → 报 "bad option: --project" 然后退出，
#   完全无法构建。这里在 build 进程里强制 unset，恢复正常的 Electron app 启动行为。
unset ELECTRON_RUN_AS_NODE

"$CREATOR" \
    --project "$COCOS_DIR" \
    --build "configPath=$CONFIG" 2>&1 | tee "$LOG" | grep -Ev "$NOISE"

if grep -E "$BUILD_ERROR" "$LOG" | grep -Ev "$NOISE|$BENIGN_BUILD_ERROR" >/dev/null; then
    echo "" >&2
    echo "✗ Cocos Android 构建失败。完整日志已保留：$LOG" >&2
    grep -E "$BUILD_ERROR" "$LOG" | grep -Ev "$NOISE|$BENIGN_BUILD_ERROR" | tail -30 >&2 || true
    if grep -Eq '找不到 Android NDK/SDK 路径|Android NDK/SDK' "$LOG"; then
        print_android_env_help "$(android_api_level)"
    fi
    exit 1
fi

if ! grep -Eq 'build Task .*Finished' "$LOG"; then
    echo "" >&2
    echo "✗ Cocos Android 构建未完成（日志未出现 Finished）。完整日志已保留：$LOG" >&2
    grep -E "$BUILD_ERROR" "$LOG" | grep -Ev "$NOISE" | tail -30 >&2 || true
    exit 1
fi

find_android_project() {
    local candidates=(
        "$COCOS_DIR/build/android/proj"
        "$COCOS_DIR/build/android/proj/openblock"
        "$COCOS_DIR/build/android"
    )
    local p
    for p in "${candidates[@]}"; do
        if [[ -f "$p/gradlew" || -f "$p/build.gradle" || -f "$p/settings.gradle" || -f "$p/settings.gradle.kts" ]]; then
            echo "$p"
            return 0
        fi
    done
    p="$(find "$COCOS_DIR/build/android" -maxdepth 4 \( -name gradlew -o -name settings.gradle -o -name settings.gradle.kts \) 2>/dev/null | head -1)"
    if [[ -n "$p" ]]; then
        dirname "$p"
        return 0
    fi
    return 1
}

ANDROID_PROJ="$(find_android_project || true)"
if [[ -z "$ANDROID_PROJ" ]]; then
    echo "" >&2
    echo "✗ 未找到 Android Gradle 工程（已查找 build/android/**）。完整日志已保留：$LOG" >&2
    echo "  如果日志里有 Android SDK/NDK 相关错误，请先在 Cocos 偏好设置 -> 外部程序中配置路径。" >&2
    exit 1
fi
rm -f "$LOG"
echo ""
echo "✔ Cocos Android 工程构建成功。"
echo "  Android 工程：$ANDROID_PROJ"

if [[ "$DO_OPEN" -eq 1 && "$DO_APK" -eq 0 && "$DO_AAB" -eq 0 ]]; then
    echo "▶ 打开 Android Studio：$ANDROID_PROJ"
    if command -v open >/dev/null 2>&1; then
        open -a "Android Studio" "$ANDROID_PROJ" || open "$ANDROID_PROJ"
    else
        echo "  请手动用 Android Studio 打开：$ANDROID_PROJ"
    fi
    exit 0
fi

if [[ "$DO_APK" -eq 0 && "$DO_AAB" -eq 0 ]]; then
    echo "  打开 Android Studio： open -a \"Android Studio\" \"$ANDROID_PROJ\""
    echo "  或下次直接： cocos/scripts/build-android.sh --open"
    echo "         打 APK： cocos/scripts/build-android.sh --apk"
    echo "         打 AAB： cocos/scripts/build-android.sh --aab"
    echo "       安装真机： cocos/scripts/build-android.sh --install"
    exit 0
fi

cd "$ANDROID_PROJ" || exit 1

GRADLE="./gradlew"
if [[ ! -x "$GRADLE" ]]; then
    if [[ -f "$GRADLE" ]]; then chmod +x "$GRADLE"; fi
fi
if [[ ! -x "$GRADLE" ]]; then
    if command -v gradle >/dev/null 2>&1; then
        GRADLE="gradle"
    else
        echo "✗ 未找到 gradlew，且系统没有 gradle 命令。" >&2
        exit 1
    fi
fi

is_debug_config() {
    grep -Eq '"debug"[[:space:]]*:[[:space:]]*true' "$CONFIG"
}

VARIANT="Release"
if is_debug_config; then VARIANT="Debug"; fi

run_gradle_task() {
    local task="$1"
    echo "▶ Gradle $task ..."
    "$GRADLE" "$task"
}

if [[ "$DO_APK" -eq 1 ]]; then
    run_gradle_task "assemble$VARIANT" || {
        echo "✗ APK 打包失败。" >&2
        exit 1
    }
fi

if [[ "$DO_AAB" -eq 1 ]]; then
    run_gradle_task "bundle$VARIANT" || {
        echo "✗ AAB 打包失败。" >&2
        exit 1
    }
fi

echo ""
echo "✔ Gradle 打包完成。"
echo "  APK："
find "$ANDROID_PROJ" -path "*/outputs/apk/*/*.apk" -type f 2>/dev/null | sort | tail -5 | sed 's/^/    /' || true
echo "  AAB："
find "$ANDROID_PROJ" -path "*/outputs/bundle/*/*.aab" -type f 2>/dev/null | sort | tail -5 | sed 's/^/    /' || true

if [[ "$DO_INSTALL" -eq 1 ]]; then
    if ! command -v adb >/dev/null 2>&1; then
        if [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/platform-tools/adb" ]]; then
            ADB="$ANDROID_HOME/platform-tools/adb"
        else
            echo "✗ 未找到 adb。请安装 Android Platform Tools 或设置 ANDROID_HOME。" >&2
            exit 1
        fi
    else
        ADB="adb"
    fi

    APK="$(find "$ANDROID_PROJ" -path "*/outputs/apk/*/*.apk" -type f 2>/dev/null | sort | tail -1)"
    if [[ -z "$APK" ]]; then
        echo "✗ 未找到 APK，无法安装。" >&2
        exit 1
    fi
    echo "▶ 安装到已连接设备：$APK"
    "$ADB" install -r "$APK"
fi

exit 0
