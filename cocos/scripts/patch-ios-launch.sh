#!/usr/bin/env bash
#
# patch-ios-launch.sh —— 覆盖 iOS LaunchScreen 启动图为 OpenBlock 自有图标。
#
# 必须在 Cocos Creator 构建之后、xcodebuild 之前调用，原因：
#   Cocos Creator 每次构建都会读 settings/v2 的 splashScreen.logo.base64（默认是 Cocos 官方 logo），
#   渲染成 native/engine/ios/LaunchScreenBackgroundPortrait.png 和 LaunchScreenBackgroundLandscape.png。
#   这两张图随后被 CMake 拷成 LaunchScreenBackground.png（首次）或被 Xcode 直接放进 .app。
#   因此即使我们一次性手动改了 PNG，下次 Creator 构建仍会覆盖回 Cocos logo。
#
# 解决：构建后用本脚本以 Pillow 实时生成三张 OpenBlock 启动图，覆盖 Cocos 生成的副本。
# 这样保证 Creator → 我们 → xcodebuild 的顺序，xcodebuild 看到的就是我们的图。
#
# 用法：
#   patch-ios-launch.sh <cocos_dir>
#     cocos_dir：cocos 工程根，里面有 native/engine/ios/ 和 build-templates/ios/。
#
# 依赖：python3 + Pillow（已经在 build-ios.sh 同环境验证）。

set -uo pipefail

COCOS_DIR="${1:-}"
if [[ -z "$COCOS_DIR" ]]; then
    echo "✗ patch-ios-launch.sh 缺少参数：cocos_dir" >&2
    exit 1
fi

ICON="$COCOS_DIR/native/engine/ios/Images.xcassets/AppIcon.appiconset/1024.png"
if [[ ! -f "$ICON" ]]; then
    echo "⚠ patch-ios-launch.sh: 找不到图标源 $ICON，跳过" >&2
    exit 0
fi

python3 - "$COCOS_DIR" "$ICON" <<'PYEOF' || { echo "✗ patch-ios-launch.sh: 生成启动图失败（Pillow 未安装？）" >&2; exit 1; }
import sys, os
from PIL import Image

cocos_dir, icon_path = sys.argv[1], sys.argv[2]

# 深蓝背景 + 居中应用图标。和 Android 的 launch_screen.xml 视觉保持一致。
BG = (0x0A, 0x1F, 0x3F)

def make(w, h, out):
    img = Image.new("RGB", (w, h), BG)
    icon = Image.open(icon_path).convert("RGBA")
    size = int(min(w, h) * 0.30)
    icon = icon.resize((size, size), Image.LANCZOS)
    img.paste(icon, ((w - size) // 2, (h - size) // 2), icon)
    img.save(out, "PNG", optimize=True)
    print(f"  wrote {out}  ({w}x{h}, {os.path.getsize(out)}B)")

# storyboard 已固化的尺寸：1242x2208（竖）/ 2208x1242（横）。
targets = [
    (1242, 2208, f"{cocos_dir}/native/engine/ios/LaunchScreenBackground.png"),
    (1242, 2208, f"{cocos_dir}/native/engine/ios/LaunchScreenBackgroundPortrait.png"),
    (2208, 1242, f"{cocos_dir}/native/engine/ios/LaunchScreenBackgroundLandscape.png"),
    # build-templates 同步一份，避免有人 reset native/ 时丢失。
    (1242, 2208, f"{cocos_dir}/build-templates/ios/LaunchScreenBackground.png"),
    (1242, 2208, f"{cocos_dir}/build-templates/ios/LaunchScreenBackgroundPortrait.png"),
    (2208, 1242, f"{cocos_dir}/build-templates/ios/LaunchScreenBackgroundLandscape.png"),
]
for w, h, p in targets:
    if not os.path.isdir(os.path.dirname(p)):
        continue
    make(w, h, p)
print("✔ iOS LaunchScreen 已替换为 OpenBlock 图标")
PYEOF
