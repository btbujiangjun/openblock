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
#   cocos/scripts/build-android.sh --debug                 # 静默：强制 debug APK → adb 安装 → 启动 App
#   cocos/scripts/build-android.sh --debug --logcat        # 静默部署后实时抓取该 App 的 logcat
#   cocos/scripts/build-android.sh path/to/android.json --apk
#
# 环境变量：
#   COCOS_CREATOR   覆盖 Cocos Creator 可执行文件路径
#   ANDROID_HOME    Android SDK 根目录（Gradle/adb 需要）
#   JAVA_HOME       JDK 路径（Cocos/Gradle 需要）
#   ADB_SERIAL      指定目标设备序列号（多设备时透传给 adb -s）
#
# 退出码：构建成功 0；失败 1。

set -uo pipefail

CREATOR="${COCOS_CREATOR:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COCOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$COCOS_DIR/.." && pwd)"
# shellcheck source=../../scripts/android-env.sh
source "$REPO_ROOT/scripts/android-env.sh"

CONFIG=""
DO_OPEN=0
DO_APK=0
DO_AAB=0
DO_INSTALL=0
DO_DEBUG=0
DO_LAUNCH=0
DO_LOGCAT=0

for arg in "$@"; do
    case "$arg" in
        --open)    DO_OPEN=1 ;;
        --apk)     DO_APK=1 ;;
        --aab)     DO_AAB=1 ;;
        --install) DO_INSTALL=1; DO_APK=1 ;;
        # --debug：静默打 debug 包并部署到设备进行 adb 调试。
        #   强制 debug 变体（不看配置 debug 字段）+ 打 APK + adb 安装 + 启动 App。
        --debug)   DO_DEBUG=1; DO_APK=1; DO_INSTALL=1; DO_LAUNCH=1 ;;
        --logcat)  DO_LOGCAT=1 ;;
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
    local home
    if ! home="$(android_resolve_java_home cocos)"; then
        return 1
    fi
    export JAVA_HOME="$home"
    return 0
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
    android_detect_sdk_env
    local sdk
    sdk="$(android_default_sdk)"
    if [[ -n "${ANDROID_HOME:-}" ]]; then
        if [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
            SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        elif [[ -x "$ANDROID_HOME/tools/bin/sdkmanager" ]]; then
            SDKMANAGER="$ANDROID_HOME/tools/bin/sdkmanager"
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

print_scene_import_help() {
    cat >&2 <<EOF

检测到「初始场景不存在 / Number of all scenes: 0」：Cocos 没有把项目资源识别为场景。
根因：assets 下的 .meta 仍是占位（"importer": "*"），从未被 Cocos 编辑器正确导入。
注意：命令行 \`cocos --build\`（即本脚本）不会做完整导入，它要求项目先被【Cocos
编辑器 GUI】导入过——清空 library/ 缓存重试也无效（已验证）。

修复（一次性，必须用 GUI，不是 Android Studio）：
  1. 用 Cocos Creator 编辑器打开本项目，等右下角资源导入进度跑完。
     编辑器会保留现有 UUID，仅把 importer 从 "*" 纠正为 scene/typescript/image 等，
     并生成正确的 library 产物，不会破坏脚本/预制体间的引用：
       open -a "Cocos Creator" || "$CREATOR" --project "$COCOS_DIR"
     （或在 Cocos Dashboard 里手动打开 $COCOS_DIR 这个工程目录）
  2. 验证已修复：下面这行应从 "*" 变成 "scene"
       grep importer "$COCOS_DIR/assets/scene/Game.scene.meta"
  3. 关闭编辑器后重新无头打包：
       cocos/scripts/build-android.sh --debug

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

# ── 寻参 bundle 同步 + 校验 ──────────────────────────────────────────
# Cocos 端的 spawnPoliciesV2.mjs 必须与 web/public/spawn-tuning-v2/policies.json
# 保持一致；此处在构建前自动同步并校验，避免打包到过期/空的 θ bundle。
REPO_ROOT="$(cd "$COCOS_DIR/.." && pwd)"
RES_SYNC_SCRIPT="$REPO_ROOT/scripts/sync-cocos-resources.mjs"
if [[ -f "$RES_SYNC_SCRIPT" ]]; then
    echo "▶ 同步 Cocos 资源包 (sync-cocos-resources) ..."
    node "$RES_SYNC_SCRIPT" || { echo "✗ sync-cocos-resources 失败" >&2; exit 1; }
    echo "  校验资源包一致性 ..."
    node "$RES_SYNC_SCRIPT" --verify || { echo "✗ Cocos 资源包校验失败：源资源与 cocos/assets/resources 不一致" >&2; exit 1; }
fi

SYNC_SCRIPT="$REPO_ROOT/scripts/sync-spawn-bundle.mjs"
if [[ -f "$SYNC_SCRIPT" ]]; then
    echo "▶ 同步寻参 bundle (sync-spawn-bundle) ..."
    node "$SYNC_SCRIPT" || { echo "✗ sync-spawn-bundle 失败" >&2; exit 1; }
    echo "  校验 web ↔ cocos bundle 一致性 ..."
    node "$SYNC_SCRIPT" --verify || { echo "✗ 寻参 bundle 校验失败：web ↔ cocos 不一致" >&2; exit 1; }
fi

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
    if grep -Eq '初始场景不存在|在 Bundle 中，无法设置为初始场景|Number of all scenes: 0' "$LOG"; then
        print_scene_import_help
    fi
    exit 1
fi

if ! grep -Eq 'build Task .*Finished' "$LOG"; then
    echo "" >&2
    echo "✗ Cocos Android 构建未完成（日志未出现 Finished）。完整日志已保留：$LOG" >&2
    grep -E "$BUILD_ERROR" "$LOG" | grep -Ev "$NOISE" | tail -30 >&2 || true
    exit 1
fi

find_android_studio_app() { android_find_studio_app; }

open_android_studio() {
    android_open_studio "$1"
}

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

# 品牌化开机 splash 为产品 icon（详见 patch-splash.sh）。在 Cocos 输出后、gradle 打包前修改 data/src/settings.json，
# gradle 会把它作为 asset 拷进 APK。失败不致命，仅 warning。
# ⚠️ 用 $COCOS_DIR/scripts 而非 $SCRIPT_DIR：第 31 行 source android-env.sh 时，其内部同名
#    SCRIPT_DIR 会覆盖本脚本的 SCRIPT_DIR（指向 repo/scripts），导致 patch-splash 守卫永远 false、
#    被静默跳过（splash 退回 cocos logo 的真正根因）。COCOS_DIR 在 source 之前算好且不被污染。
SPLASH_PATCH="$COCOS_DIR/scripts/patch-splash.sh"
if [[ -x "$SPLASH_PATCH" ]]; then
    "$SPLASH_PATCH" "$COCOS_DIR/build/android/data" || true
else
    echo "⚠ 未找到可执行的 patch-splash.sh（$SPLASH_PATCH），splash 维持 Creator 默认。" >&2
fi

if [[ "$DO_OPEN" -eq 1 && "$DO_APK" -eq 0 && "$DO_AAB" -eq 0 ]]; then
    if command -v open >/dev/null 2>&1; then
        open_android_studio "$ANDROID_PROJ" || exit 1
    else
        echo "  请手动用 Android Studio 打开：$ANDROID_PROJ"
    fi
    exit 0
fi

if [[ "$DO_APK" -eq 0 && "$DO_AAB" -eq 0 ]]; then
    echo "  打开 Android Studio： cocos/scripts/build-android.sh --open"
    echo "  或下次直接： cocos/scripts/build-android.sh --open"
    echo "         打 APK： cocos/scripts/build-android.sh --apk"
    echo "         打 AAB： cocos/scripts/build-android.sh --aab"
    echo "       安装真机： cocos/scripts/build-android.sh --install"
    echo "   静默 adb 调试： cocos/scripts/build-android.sh --debug [--logcat]"
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
# --debug 静默调试链路：忽略配置里的 debug 字段，强制 debug 变体（带可调试签名/标志）。
if [[ "$DO_DEBUG" -eq 1 ]]; then VARIANT="Debug"; fi

# Gradle 增量构建会因为 assets 未变而跳过打包（UP-TO-DATE），导致 APK 不更新。
# 清理 APK 输出目录，强制 Gradle 重新执行 package + assemble，确保每次构建产出最新 APK。
echo "▶ 清理旧 APK 输出 ..."
rm -rf "$ANDROID_PROJ/build/openblock-cocos/outputs/apk" 2>/dev/null || true
# patch-splash 改写的是 data/src/settings.json（assets 软链源）。Gradle 的 mergeAssets 任务
# 可能因增量判定沿用上一次合并结果（旧 cocos splash），故清掉已合并的 assets 中间产物，
# 强制本次从 patch 后的 data 重新合并，确保产品 icon splash 真正进包。
rm -rf "$ANDROID_PROJ/build/openblock-cocos/intermediates/assets" 2>/dev/null || true

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

android_package_name() {
    grep -E '"packageName"[[:space:]]*:' "$CONFIG" \
        | sed -E 's/.*"packageName"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
        | head -1
}

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

    # 多设备时用 ADB_SERIAL 指定目标；否则在恰好一台设备时自动选中，便于静默部署。
    ADB_ARGS=()
    if [[ -n "${ADB_SERIAL:-}" ]]; then
        ADB_ARGS=(-s "$ADB_SERIAL")
    fi

    DEVICE_COUNT="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
    if [[ "${DEVICE_COUNT:-0}" -eq 0 ]]; then
        echo "✗ 未检测到已连接的 adb 设备。请连接真机（开启 USB 调试）或启动模拟器。" >&2
        echo "  检查：\"$ADB\" devices" >&2
        exit 1
    fi
    if [[ "$DEVICE_COUNT" -gt 1 && -z "${ADB_SERIAL:-}" ]]; then
        echo "✗ 检测到多台 adb 设备，请用环境变量 ADB_SERIAL 指定目标：" >&2
        "$ADB" devices | awk 'NR>1 && $2=="device" {print "    "$1}' >&2
        exit 1
    fi

    APK="$(find "$ANDROID_PROJ" -path "*/outputs/apk/*/*.apk" -type f 2>/dev/null | sort | tail -1)"
    if [[ -z "$APK" ]]; then
        echo "✗ 未找到 APK，无法安装。" >&2
        exit 1
    fi
    PKG="$(android_package_name)"

    echo "▶ 安装到已连接设备：$APK"
    INSTALL_OUT="$("$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} install -r "$APK" 2>&1)"
    INSTALL_RC=$?
    echo "$INSTALL_OUT"
    if [[ "$INSTALL_RC" -ne 0 ]]; then
        # 签名不一致（设备上已装了用其它 keystore 签名的同包名 App）无法原地覆盖更新。
        # debug 部署场景下自动卸载旧包再装一次；卸载会清除该 App 的本地数据。
        if echo "$INSTALL_OUT" | grep -q 'INSTALL_FAILED_UPDATE_INCOMPATIBLE\|signatures do not match'; then
            if [[ -n "$PKG" ]]; then
                echo "⚠ 设备上已存在签名不同的 $PKG，自动卸载旧包后重装（会清除其本地数据）..." >&2
                "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} uninstall "$PKG" >/dev/null 2>&1 || true
                "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} install -r "$APK" || {
                    echo "✗ adb 安装失败（卸载重装后仍失败）。" >&2
                    exit 1
                }
            else
                echo "✗ adb 安装失败：签名不一致，且未能解析 packageName 无法自动卸载。" >&2
                echo "  请手动卸载后重试： \"$ADB\" uninstall <packageName>" >&2
                exit 1
            fi
        else
            echo "✗ adb 安装失败。" >&2
            exit 1
        fi
    fi

    if [[ "$DO_LAUNCH" -eq 1 ]]; then
        if [[ -z "$PKG" ]]; then
            echo "⚠ 未能从配置解析 packageName，跳过自动启动。" >&2
        else
            echo "▶ 启动 App：$PKG"
            "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} shell monkey -p "$PKG" \
                -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || {
                echo "⚠ 自动启动失败，请手动在设备上打开 App。" >&2
            }

            if [[ "$DO_LOGCAT" -eq 1 ]]; then
                echo "▶ 抓取 logcat（Ctrl-C 退出）..."
                # 清空旧日志后按进程过滤；进程可能尚未就绪，短暂重试。
                "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} logcat -c >/dev/null 2>&1 || true
                PID=""
                for _ in 1 2 3 4 5 6 7 8 9 10; do
                    PID="$("$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} shell pidof "$PKG" 2>/dev/null | tr -d '\r')"
                    [[ -n "$PID" ]] && break
                    sleep 0.5
                done
                if [[ -n "$PID" ]]; then
                    exec "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} logcat --pid "$PID"
                else
                    echo "⚠ 未取到进程 PID，回退为全量 logcat。" >&2
                    exec "$ADB" ${ADB_ARGS[@]+"${ADB_ARGS[@]}"} logcat
                fi
            fi
        fi
    fi
fi

exit 0
