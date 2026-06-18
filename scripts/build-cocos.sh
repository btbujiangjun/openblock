#!/usr/bin/env bash
# 一键打包 Cocos 客户端：先做同源校验 + 严格类型检查，再用 Cocos Creator 无头 CLI 构建。
#
# 用法：
#   scripts/build-cocos.sh [platform] [debug]
#     platform: web-mobile(默认) | web-desktop | wechatgame | ios | android | huawei-quick-game | ...
#     debug:    false(默认) | true
#
# 指定 Creator 路径（自动探测失败时）：
#   COCOS_CREATOR="/path/to/CocosCreator.app/Contents/MacOS/CocosCreator" scripts/build-cocos.sh wechatgame
#
# 跳过校验（不推荐）：SKIP_VERIFY=1 scripts/build-cocos.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COCOS_PROJ="$ROOT/cocos"
PLATFORM="${1:-web-mobile}"
DEBUG="${2:-false}"

echo "==> 项目: $COCOS_PROJ"
echo "==> 平台: $PLATFORM (debug=$DEBUG)"

echo "==> 同步 Cocos 资源包"
( cd "$ROOT" && node scripts/sync-cocos-resources.mjs )

# 1) 出包前校验（同源 + 类型）
if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  echo "==> [1/2] 校验：sync 同源 + tsc strict"
  ( cd "$ROOT" && npm run verify:cocos-core && npm run typecheck:cocos )
else
  echo "==> [1/2] 跳过校验 (SKIP_VERIFY=1)"
fi

# 2) 定位 Cocos Creator 可执行文件
find_creator() {
  if [ -n "${COCOS_CREATOR:-}" ] && [ -x "$COCOS_CREATOR" ]; then
    echo "$COCOS_CREATOR"; return 0
  fi
  local uname_s; uname_s="$(uname -s)"
  local candidates=()
  if [ "$uname_s" = "Darwin" ]; then
    # 取版本号最大的一个
    while IFS= read -r p; do candidates+=("$p"); done < <(
      ls -d /Applications/Cocos*/Creator/*/CocosCreator.app/Contents/MacOS/CocosCreator \
            "$HOME/Applications/Cocos"*/Creator/*/CocosCreator.app/Contents/MacOS/CocosCreator \
            /Applications/CocosCreator*.app/Contents/MacOS/CocosCreator 2>/dev/null | sort -V
    )
  else
    while IFS= read -r p; do candidates+=("$p"); done < <(
      ls -d /opt/Cocos*/Creator/*/CocosCreator \
            "$HOME"/Cocos*/Creator/*/CocosCreator 2>/dev/null | sort -V
    )
  fi
  if [ "${#candidates[@]}" -gt 0 ]; then
    echo "${candidates[$((${#candidates[@]} - 1))]}"; return 0
  fi
  return 1
}

echo "==> [2/2] 定位 Cocos Creator"
if ! CREATOR="$(find_creator)"; then
  cat <<EOF
✗ 未找到 Cocos Creator 可执行文件。

请用 Cocos Dashboard 安装 3.8.x，然后任选其一：
  1) 直接在 Creator 里打开 cocos/ → 打开 Game.scene → 菜单「项目 → 构建发布」构建（最稳）；
  2) 指定路径再跑本脚本：
     COCOS_CREATOR="/Applications/Cocos/Creator/3.8.x/CocosCreator.app/Contents/MacOS/CocosCreator" \\
       npm run build:cocos -- $PLATFORM
EOF
  exit 1
fi
echo "    使用: $CREATOR"

# iOS/Mac 原生工程生成依赖完整版 Xcode（CommandLineTools 缺 xcodebuild/iOS SDK）。
# 若 xcode-select 仍指向 CommandLineTools 但已装 Xcode.app，则用 DEVELOPER_DIR 覆盖（免 sudo）。
if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "mac" ]]; then
  if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
    echo "==> 使用 Xcode: $DEVELOPER_DIR"
  fi
fi

# iOS 平台必须提供 packages.ios.packageName（Bundle ID），通过 configPath 传入。
BUILD_ARGS="platform=${PLATFORM};debug=${DEBUG}"
CFG="$COCOS_PROJ/build-configs/${PLATFORM}.json"
if [[ -f "$CFG" ]]; then
  BUILD_ARGS="platform=${PLATFORM};configPath=${CFG}"
  echo "==> 使用构建配置: $CFG"
fi

# 3) 无头构建（首次会自动导入资源、生成 library/，耗时较长）
# 注意：必须清除 ELECTRON_RUN_AS_NODE，否则 Electron 宿主（如 Cursor/VSCode 终端）注入该变量
# 会让 Creator 以纯 Node 模式启动 → 报 "bad option: --project"。
echo "==> 构建中…"
OUT="$COCOS_PROJ/build/${PLATFORM}"
case "$PLATFORM" in
  web-mobile|web-desktop) ARTIFACT="$OUT/index.html" ;;
  ios)                    ARTIFACT="$OUT/proj/openblock-cocos.xcodeproj" ;;
  android)                ARTIFACT="$OUT/proj/build.gradle" ;;
  wechatgame)             ARTIFACT="$OUT/application.js" ;;
  *)                      ARTIFACT="$OUT/data" ;;
esac

# 跑一次无头构建到 $1（日志文件）。无头 Creator 退出时常因 Electron teardown
# （mach_port_rendezvous 等）返回非零码，但产物已生成 —— 退出码仅作参考。
run_creator_build() {
  set +e
  env -u ELECTRON_RUN_AS_NODE "$CREATOR" --project "$COCOS_PROJ" --build "$BUILD_ARGS" 2>&1 | tee "$1"
  CREATOR_EXIT=${PIPESTATUS[0]}
  set -e
  CREATOR_EXIT="${CREATOR_EXIT:-1}"
}

# 以「成功日志行 + 平台主产物存在」判定构建是否完成（规避退出码误报）。
build_ok() { grep -qE "build task\(${PLATFORM}\) in [0-9]+" "$1" && [ -e "$ARTIFACT" ]; }

# 方案B 黑屏防护网：无头构建在 `Asset DB is paused` 后用当前 asset-db 索引打包，
# 若 asset-db 尚未导入项目资源（尤其场景），main bundle 会被打成空壳（builder 日志
# `Number of all scenes: 0`），运行时找不到启动场景 → 黑屏。
# 这里扫描产物里所有 bundle 的 cc.config.json，只要有一个 scenes 非空即视为「场景已进包」。
scene_packed() {
  node -e '
    const fs = require("fs"), path = require("path");
    const out = process.argv[1];
    const stack = [out];
    while (stack.length) {
      const dir = stack.pop();
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        // 跳过原生 gradle/xcode 中间产物里的副本，只看 Creator 直出的 bundle。
        if (e.isDirectory()) { if (!p.includes("/proj/build/")) stack.push(p); }
        else if (e.name === "cc.config.json") {
          try { const c = JSON.parse(fs.readFileSync(p, "utf8"));
            if (c.scenes && Object.keys(c.scenes).length > 0) process.exit(0);
          } catch {}
        }
      }
    }
    process.exit(1);
  ' "$OUT"
}

BUILD_LOG="$(mktemp -t cocos-build-XXXX.log)"
run_creator_build "$BUILD_LOG"
if ! build_ok "$BUILD_LOG"; then
  echo "✗ 构建失败 (exit=${CREATOR_EXIT}) 。完整日志: ${BUILD_LOG}"
  exit "$CREATOR_EXIT"
fi

# 校验启动场景是否真的进了 bundle；为空说明首次构建只完成了资源导入
# （已落盘 library/ + temp/asset-db），自动重跑一次即可命中已就绪的 asset-db。
if ! scene_packed; then
  echo "⚠ 启动场景未进 bundle（asset-db 首次导入未就绪）→ 自动重试构建一次…"
  rm -f "$BUILD_LOG"; BUILD_LOG="$(mktemp -t cocos-build-XXXX.log)"
  run_creator_build "$BUILD_LOG"
  if ! build_ok "$BUILD_LOG"; then
    echo "✗ 重试构建失败 (exit=${CREATOR_EXIT}) 。完整日志: ${BUILD_LOG}"
    exit "$CREATOR_EXIT"
  fi
  if ! scene_packed; then
    cat >&2 <<EOF
✗ 启动场景仍未进包（所有 bundle 的 scenes 都为空）→ 安装后必定黑屏，已中止。
  本机 asset-db 没能在无头构建里导入项目资源。请先用 Cocos Creator GUI 打开：
      $COCOS_PROJ
  等右下角资源导入进度条彻底跑完（会落盘 library/ 与 temp/asset-db），再重跑本脚本。
EOF
    exit 1
  fi
fi

if [ "$CREATOR_EXIT" -ne 0 ]; then
  echo "  (忽略 Creator 退出码 ${CREATOR_EXIT} : 仅为无头进程退出噪声，产物已生成)"
fi
echo "  ✓ 启动场景已确认打进 bundle（无空包黑屏风险）"
rm -f "$BUILD_LOG"

# iOS / Android 原生工程在 Xcode / Android Studio 中编译前，需先修补 Creator 内置引擎。
if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "android" ]]; then
    PATCH_SCRIPT="$ROOT/cocos/scripts/patch-native-engine.sh"
    if [[ -x "$PATCH_SCRIPT" ]]; then
        echo "==> 修补 Cocos native 引擎（Xcode/clang 兼容）"
        "$PATCH_SCRIPT" || { echo "✗ patch-native-engine.sh 失败" >&2; exit 1; }
    fi
fi

# 关闭 Cocos 内置 splash 水印 —— 原始 Creator 3.8 默认 splashScreen.logo.type='default'，
# 触发 splash-screen.ts 的 initWaterMark()，而该方法在我们这个没装默认 render-pipeline
# settings asset 的项目里会 `Cannot read properties of undefined (reading 'getBinding')`，
# 整个 cc 引擎 init 抛错 → Bootstrap.onLoad 永不触发 → APK 黑屏。
# 修复方式：build 产物里的 settings.json 把 splashScreen.logo.type 改成 'none'，
# 让 splash-screen.ts L150 早返回（totalTime=0 + logo undefined 二选一）。
# 注意：构建配置文件里直接放 splashScreen 字段 Creator CLI 会忽略，必须 patch 产物。
patch_splash_settings() {
    local settings_file="$1"
    [[ -f "$settings_file" ]] || return 0
    node -e "
const fs = require('fs');
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
if (j.splashScreen) {
    j.splashScreen.totalTime = 0;
    j.splashScreen.logo = { type: 'none' };
    j.splashScreen.background = { type: 'none' };
    j.splashScreen.watermarkLocation = 'none';
    fs.writeFileSync(p, JSON.stringify(j));
    console.log('[patch-splash] disabled default watermark in ' + p);
}
" "$settings_file"
}
if [[ "$PLATFORM" == "android" || "$PLATFORM" == "ios" ]]; then
    # Creator 出包后落点 1：build/{platform}/data/src/settings.json
    # 这是 gradle 后续 mergeDebugAssets 任务的真正源 → patch 这里能让 APK 里的 assets 也是关闭的。
    patch_splash_settings "$OUT/data/src/settings.json"
    # 落点 2：已 merge 到 intermediates 的产物（如果 gradle 已跑过一次但仍用旧 cache，确保被覆盖）
    while IFS= read -r f; do patch_splash_settings "$f"; done < <(
        find "$OUT/proj" -name "settings.json" -path "*/assets/*" 2>/dev/null
    )
fi
if [[ "$PLATFORM" == "web-mobile" || "$PLATFORM" == "web-desktop" || "$PLATFORM" == "wechatgame" ]]; then
    patch_splash_settings "$OUT/src/settings.json"
fi

echo "✓ 完成。产物目录: $OUT"
case "$PLATFORM" in
  wechatgame) echo "  用『微信开发者工具』打开该目录预览/上传。" ;;
  web-mobile|web-desktop) echo "  部署到任意静态服务器即可访问。" ;;
  ios) echo "  用 Xcode 打开 $OUT/proj/openblock-cocos.xcodeproj 继续编译/签名上架。" ;;
  android) echo "  用 Android Studio 打开 $OUT/proj 继续编译。" ;;
esac
