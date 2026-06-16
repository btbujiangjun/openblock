#!/usr/bin/env bash
#
# patch-ios-native.sh —— 将 build-templates/ios 原生渲染修复同步到 native/engine/ios。
#
# 背景：Cocos Creator 构建时会从 build-templates 覆盖 native/engine，但在某些流程
# （仅 xcodebuild、reset native/、手动改 native 后）模板可能未生效。本脚本在
# build-ios.sh 成功后强制对齐，确保 iOS 与 Android AppActivity 的渲染策略严格同构。
#
# 用法：
#   cocos/scripts/patch-ios-native.sh [cocos_dir]
#
# 同步文件：
#   build-templates/ios/AppDelegate.mm   → native/engine/ios/AppDelegate.mm
#   build-templates/ios/ViewController.mm → native/engine/ios/ViewController.mm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COCOS_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
TEMPLATES="$COCOS_DIR/build-templates/ios"
NATIVE="$COCOS_DIR/native/engine/ios"

if [[ ! -d "$TEMPLATES" ]]; then
    echo "✗ patch-ios-native.sh: 缺少 $TEMPLATES" >&2
    exit 1
fi
if [[ ! -d "$NATIVE" ]]; then
    echo "⚠ patch-ios-native.sh: native 目录不存在，跳过：$NATIVE" >&2
    exit 0
fi

sync_file() {
    local name="$1"
    local src="$TEMPLATES/$name"
    local dst="$NATIVE/$name"
    if [[ ! -f "$src" ]]; then
        echo "⚠ 跳过（模板不存在）：$src" >&2
        return 0
    fi
    if cmp -s "$src" "$dst" 2>/dev/null; then
        echo "✔ $name 已是最新"
        return 0
    fi
    cp "$src" "$dst"
    echo "✔ 已同步 $name → native/engine/ios/"
}

echo "▶ patch-ios-native: 对齐 iOS 原生渲染模板"
sync_file "AppDelegate.mm"
sync_file "ViewController.mm"
echo "✔ iOS 原生渲染模板同步完成"
