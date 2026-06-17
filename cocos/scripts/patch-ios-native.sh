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

# Info.plist 显示名兜底：原生 Info.plist 默认用 ${PRODUCT_NAME} 占位 → 展开为
# 小写可执行名 "openblock" 显示在桌面。这里幂等地把 CFBundleDisplayName /
# CFBundleName 强制改为 "OpenBlock"，覆盖 Cocos 编辑器重生工程时把 plist
# 还原回 ${PRODUCT_NAME} 的场景；CFBundleExecutable 严禁动（必须等于 Mach-O 名）。
patch_display_name() {
    local plist="$NATIVE/Info.plist"
    if [[ ! -f "$plist" ]]; then
        echo "⚠ 跳过 Info.plist 显示名修补（文件不存在）：$plist" >&2
        return 0
    fi
    if ! command -v plutil >/dev/null 2>&1; then
        echo "⚠ 跳过 Info.plist 显示名修补（缺少 plutil 命令）" >&2
        return 0
    fi
    local want="OpenBlock"
    local changed=0
    for key in CFBundleDisplayName CFBundleName; do
        local cur
        cur="$(plutil -extract "$key" raw -o - "$plist" 2>/dev/null || true)"
        if [[ "$cur" != "$want" ]]; then
            plutil -replace "$key" -string "$want" "$plist"
            changed=1
        fi
    done
    if [[ $changed -eq 1 ]]; then
        echo "✔ 已修补 Info.plist 显示名 → $want"
    else
        echo "✔ Info.plist 显示名已是 $want"
    fi
}
patch_display_name

echo "✔ iOS 原生渲染模板同步完成"
