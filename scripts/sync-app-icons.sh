#!/usr/bin/env bash
# 从 docs/architecture/assets/icon.png 生成 Web / Capacitor / 微信多端 各尺寸图标。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/architecture/assets/icon.png"

if [[ ! -f "$SRC" ]]; then
  echo "missing source icon: $SRC" >&2
  exit 1
fi

resize() {
  local size="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  sips -z "$size" "$size" "$SRC" --out "$out" >/dev/null
}

echo "source: $SRC"

# Web PWA / HTML
resize 180 "$ROOT/web/assets/images/icon-180.png"
resize 192 "$ROOT/web/assets/images/icon-192.png"
resize 512 "$ROOT/web/assets/images/icon-512.png"
resize 32 "$ROOT/web/assets/images/icon-32.png"

# Capacitor iOS
resize 1024 "$ROOT/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/icon.png"

# Capacitor Android — legacy launcher + adaptive foreground + round
DENSITIES="mdpi hdpi xhdpi xxhdpi xxxhdpi"
LAUNCHER_SIZES="48 72 96 144 192"
FOREGROUND_SIZES="108 162 216 324 432"

set -- $DENSITIES
densities=("$@")
set -- $LAUNCHER_SIZES
launcher_sizes=("$@")
set -- $FOREGROUND_SIZES
foreground_sizes=("$@")

for i in "${!densities[@]}"; do
  density="${densities[$i]}"
  base="$ROOT/mobile/android/app/src/main/res/mipmap-$density"
  resize "${launcher_sizes[$i]}" "$base/ic_launcher.png"
  cp "$base/ic_launcher.png" "$base/ic_launcher_round.png"
  resize "${foreground_sizes[$i]}" "$base/ic_launcher_foreground.png"
done

# 微信多端（project.miniapp.json）
MP="$ROOT/miniprogram/assets/icons"
resize 72 "$MP/android/hdpi.png"
resize 96 "$MP/android/xhdpi.png"
resize 144 "$MP/android/xxhdpi.png"
resize 192 "$MP/android/xxxhdpi.png"

resize 120 "$MP/ios/mainIcon120.png"
resize 180 "$MP/ios/mainIcon180.png"
resize 80 "$MP/ios/spotlightIcon80.png"
cp "$MP/ios/mainIcon120.png" "$MP/ios/spotlightIcon120.png"
resize 58 "$MP/ios/settingsIcon58.png"
resize 87 "$MP/ios/settingsIcon87.png"
resize 40 "$MP/ios/notificationIcon40.png"
resize 60 "$MP/ios/notificationIcon60.png"
resize 1024 "$MP/ios/appStore1024.png"

# 小程序上传参考（1024 主图）
mkdir -p "$MP/miniprogram"
cp "$SRC" "$MP/miniprogram/icon-1024.png"

echo "done — icons synced from $SRC"
