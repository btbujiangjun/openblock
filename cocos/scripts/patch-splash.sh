#!/usr/bin/env bash
#
# patch-splash.sh —— 把 Cocos 开机 splash 的 logo 替换为 OpenBlock 产品 icon。
#
# 用法：
#   patch-splash.sh <data_dir>
#   其中 <data_dir> 是 Cocos 构建输出根目录，里面有 src/settings.json。
#     Android: cocos/build/android/data
#     iOS:     cocos/build/ios/data
#
# 背景：Cocos Creator 每次构建都会把内置的「Created with Cocos」logo 写进
#   data/src/settings.json 的 splashScreen.logo.base64（默认 totalTime 2000ms）。
#   团队/CI 无法靠 Editor 勾选稳定复现，且会随每次 Creator 构建被覆盖回 cocos logo。
#
# 实现：构建后把 splashScreen.logo 替换为 cocos/build-assets/splash-logo.png（产品 icon）
#   的 base64，并保证 totalTime > 0 让产品 logo 可见。纯 Python stdlib（base64 + json），
#   不依赖 Pillow，Android/iOS 构建环境都能跑。
#
# Cocos 官方虽然推荐去 Editor → Build 面板里手动换 logo，但那只能存编辑器本地 profile，
# 团队/CI 无法稳定复现。在这里做最后一公里的字段级修改，对源工程零侵入。

set -uo pipefail

DATA_DIR="${1:-}"
if [[ -z "$DATA_DIR" ]]; then
    echo "✗ patch-splash.sh 缺少参数：data_dir" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COCOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGO_PNG="$COCOS_DIR/build-assets/splash-logo.png"

SETTINGS="$DATA_DIR/src/settings.json"
if [[ ! -f "$SETTINGS" ]]; then
    echo "⚠ patch-splash.sh: 找不到 $SETTINGS，跳过" >&2
    exit 0
fi
if [[ ! -f "$LOGO_PNG" ]]; then
    echo "⚠ patch-splash.sh: 找不到产品 splash 图 $LOGO_PNG，跳过（splash 维持 Creator 默认）" >&2
    exit 0
fi

# 用 python3 做 JSON in-place 编辑，比 sed/awk 更可靠（JSON 中可能有任意字符）。
python3 - "$SETTINGS" "$LOGO_PNG" <<'PYEOF' || { echo "✗ patch-splash.sh: 替换 splashScreen.logo 失败" >&2; exit 1; }
import base64, json, sys

settings_path, logo_path = sys.argv[1], sys.argv[2]

with open(settings_path, 'r', encoding='utf-8') as f:
    d = json.load(f)

ss = d.get('splashScreen')
if not ss:
    print(f"⚠ {settings_path} 没有 splashScreen 字段，无需修改", file=sys.stderr)
    sys.exit(0)

with open(logo_path, 'rb') as f:
    b64 = base64.b64encode(f.read()).decode('ascii')
data_uri = f"data:image/png;base64,{b64}"

# 替换为产品 icon logo；totalTime <= 0 时给个默认值，保证产品 logo 可见。
logo = ss.get('logo')
if not isinstance(logo, dict):
    logo = {}
prev_len = len(logo.get('base64', '')) if isinstance(logo.get('base64'), str) else 0
logo['type'] = 'custom'
logo['base64'] = data_uri
ss['logo'] = logo

prev_total = ss.get('totalTime')
if not isinstance(prev_total, (int, float)) or prev_total <= 0:
    ss['totalTime'] = 2000

with open(settings_path, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

print(f"✔ splash logo 已替换为产品 icon："
      f"base64 {prev_len}B → {len(data_uri)}B，totalTime={ss.get('totalTime')}")
PYEOF
