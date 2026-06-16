#!/usr/bin/env bash
#
# Android 开发环境探测与导出（Cocos 原生 + Capacitor 壳共用）。
#
# 用法：
#   bash scripts/android-env.sh --check              # 诊断，缺关键项时 exit 1
#   bash scripts/android-env.sh --print-exports      # 打印可写入 ~/.zshrc 的 export
#   bash scripts/android-env.sh --java-home cocos    # Cocos/Gradle 推荐 JDK 17
#   bash scripts/android-env.sh --java-home mobile   # Capacitor APK 推荐 JDK 21
#   bash scripts/android-env.sh --find-studio        # Android Studio .app 路径
#   bash scripts/android-env.sh --install-studio     # brew 安装 Android Studio
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

android_default_sdk() {
    echo "${ANDROID_HOME:-$HOME/Library/Android/sdk}"
}

android_find_studio_app() {
    local app
    for app in \
        "/Applications/Android Studio.app" \
        "$HOME/Applications/Android Studio.app"; do
        if [[ -d "$app" ]]; then
            echo "$app"
            return 0
        fi
    done
    if command -v mdfind >/dev/null 2>&1; then
        app="$(mdfind "kMDItemCFBundleIdentifier == 'com.google.android.studio'" 2>/dev/null | head -1)"
        if [[ -n "$app" && -d "$app" ]]; then
            echo "$app"
            return 0
        fi
    fi
    return 1
}

android_java_candidates() {
    local role="${1:-cocos}"
    if [[ "$role" == "mobile" ]]; then
        cat <<'EOF'
/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home
/Applications/Android Studio.app/Contents/jbr/Contents/Home
EOF
    else
        cat <<'EOF'
/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
/opt/homebrew/opt/temurin@17/libexec/openjdk.jdk/Contents/Home
/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
/Applications/Android Studio.app/Contents/jbr/Contents/Home
EOF
    fi
}

android_resolve_java_home() {
    local role="${1:-cocos}"
    local home candidate

    if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
        echo "$JAVA_HOME"
        return 0
    fi

    if [[ "$role" == "cocos" ]]; then
        home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
        if [[ -n "$home" && -x "$home/bin/java" ]]; then
            echo "$home"
            return 0
        fi
    else
        home="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
        if [[ -n "$home" && -x "$home/bin/java" ]]; then
            echo "$home"
            return 0
        fi
    fi

    while IFS= read -r candidate; do
        [[ -z "$candidate" ]] && continue
        if [[ -x "$candidate/bin/java" ]]; then
            echo "$candidate"
            return 0
        fi
    done < <(android_java_candidates "$role")

    return 1
}

android_detect_sdk_env() {
    local sdk ndk
    sdk="$(android_default_sdk)"
    if [[ -d "$sdk" ]]; then
        export ANDROID_HOME="$sdk"
        export ANDROID_SDK_ROOT="$sdk"
        if [[ -z "${ANDROID_NDK_HOME:-}" && -d "$sdk/ndk" ]]; then
            ndk="$(ls -d "$sdk/ndk/"* 2>/dev/null | sort -V | tail -1)"
            if [[ -n "$ndk" ]]; then
                export ANDROID_NDK_HOME="$ndk"
                export NDK_ROOT="$ndk"
            fi
        fi
    fi
}

android_open_studio() {
    local project="$1"
    local app
    if ! app="$(android_find_studio_app)"; then
        echo "✗ 未找到 Android Studio。" >&2
        echo "  安装：bash scripts/android-env.sh --install-studio" >&2
        echo "  或手动打开工程：$project" >&2
        echo "  命令行打包：cocos/scripts/build-android.sh --apk  |  npm run mobile:apk:debug" >&2
        return 1
    fi
    echo "▶ 打开 Android Studio：$project"
    open -a "$app" "$project"
}

android_print_exports() {
    local java_cocos java_mobile sdk ndk
    java_cocos="$(android_resolve_java_home cocos || true)"
    java_mobile="$(android_resolve_java_home mobile || true)"
    android_detect_sdk_env
    sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    ndk="${ANDROID_NDK_HOME:-}"

    cat <<EOF
# OpenBlock Android（Cocos 原生 + Capacitor 壳）
export ANDROID_HOME="$sdk"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
${ndk:+export ANDROID_NDK_HOME="$ndk"}
${ndk:+export NDK_ROOT="\$ANDROID_NDK_HOME"}
# Cocos / Gradle 构建用 JDK 17：
${java_cocos:+export JAVA_HOME="$java_cocos"}
# Capacitor APK 脚本会自行选用 JDK 21；如需全局默认 21 可取消下一行注释：
# export JAVA_HOME="$java_mobile"
export PATH="\$ANDROID_HOME/platform-tools:\$PATH"
${java_cocos:+export PATH="\$JAVA_HOME/bin:\$PATH"}
EOF
}

android_check() {
    local ok=1 java_cocos java_mobile sdk ndk studio api=34
    echo "▶ OpenBlock Android 环境检查"
    echo ""

    if studio="$(android_find_studio_app)"; then
        echo "  ✔ Android Studio  $studio"
    else
        echo "  ✗ Android Studio  未安装（--open / npm run mobile:android 需要）"
        ok=0
    fi

    if java_cocos="$(android_resolve_java_home cocos)"; then
        echo "  ✔ JDK 17 (Cocos)  $java_cocos"
    else
        echo "  ✗ JDK 17 (Cocos)  未找到 → brew install --cask temurin@17"
        ok=0
    fi

    if java_mobile="$(android_resolve_java_home mobile)"; then
        echo "  ✔ JDK 21 (Mobile) $java_mobile"
    else
        echo "  ✗ JDK 21 (Mobile) 未找到 → brew install openjdk@21"
        ok=0
    fi

    android_detect_sdk_env
    sdk="$(android_default_sdk)"
    if [[ -d "$sdk" ]]; then
        echo "  ✔ Android SDK     $sdk"
    else
        echo "  ✗ Android SDK     未找到 → 安装 Android Studio 后完成 SDK 向导"
        ok=0
    fi

    if [[ -d "${ANDROID_NDK_HOME:-}" ]]; then
        echo "  ✔ Android NDK     $ANDROID_NDK_HOME"
    else
        echo "  ✗ Android NDK     未找到 → sdkmanager \"ndk;26.3.11579264\""
        ok=0
    fi

    if [[ -d "$sdk/platforms/android-$api" ]]; then
        echo "  ✔ Platform API $api"
    else
        echo "  ✗ Platform API $api → sdkmanager \"platforms;android-$api\""
        ok=0
    fi

    echo ""
    echo "── 两条构建链路 ──"
    echo "  Cocos 原生：  cocos/scripts/build-android.sh [--open|--apk]"
    echo "  Capacitor 壳：npm run mobile:android | npm run mobile:apk:debug"
    echo ""
    if [[ "$ok" -eq 1 ]]; then
        echo "✔ 环境就绪。可将以下配置写入 ~/.zshrc："
        echo ""
        android_print_exports
        return 0
    fi

    echo "✗ 仍有缺失项。修复后可执行："
    echo "    bash scripts/android-env.sh --install-studio   # 安装 IDE"
    echo "    bash scripts/android-env.sh --print-exports    # 生成环境变量"
    return 1
}

android_install_studio() {
    if android_find_studio_app >/dev/null; then
        echo "✔ Android Studio 已安装：$(android_find_studio_app)"
        return 0
    fi
    if ! command -v brew >/dev/null 2>&1; then
        echo "✗ 需要 Homebrew：https://brew.sh" >&2
        return 1
    fi
    echo "▶ 通过 Homebrew 安装 Android Studio（体积较大，请耐心等待）…"
    brew install --cask android-studio
}

case "${1:-}" in
    --check)            android_check ;;
    --print-exports)    android_print_exports ;;
    --java-home)
        role="${2:-cocos}"
        android_resolve_java_home "$role"
        ;;
    --find-studio)      android_find_studio_app ;;
    --open)
        project="${2:-$ROOT/mobile/android}"
        android_open_studio "$project"
        ;;
    --install-studio)   android_install_studio ;;
    --help|-h)
        sed -n '2,12p' "$0"
        ;;
    *)
        echo "用法：bash scripts/android-env.sh --check | --print-exports | --java-home cocos|mobile | --find-studio | --open [path] | --install-studio" >&2
        exit 1
        ;;
esac
