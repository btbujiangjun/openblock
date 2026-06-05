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
    echo "${candidates[-1]}"; return 0
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
BUILD_LOG="$(mktemp -t cocos-build-XXXX.log)"
set +e
env -u ELECTRON_RUN_AS_NODE "$CREATOR" --project "$COCOS_PROJ" --build "$BUILD_ARGS" 2>&1 | tee "$BUILD_LOG"
CREATOR_EXIT=${PIPESTATUS[0]}
set -e

# 无头 Creator 退出时常因 Electron teardown（mach_port_rendezvous 等）返回非零码，
# 但产物已生成。以「成功日志行 + 平台主产物存在」为准判定，规避该误报。
CREATOR_EXIT="${CREATOR_EXIT:-1}"
case "$PLATFORM" in
  web-mobile|web-desktop) ARTIFACT="$OUT/index.html" ;;
  ios)                    ARTIFACT="$OUT/proj/openblock-cocos.xcodeproj" ;;
  android)                ARTIFACT="$OUT/proj/build.gradle" ;;
  wechatgame)             ARTIFACT="$OUT/application.js" ;;
  *)                      ARTIFACT="$OUT/data" ;;
esac
if grep -qE "build task\(${PLATFORM}\) in [0-9]+" "$BUILD_LOG" && [ -e "$ARTIFACT" ]; then
  if [ "$CREATOR_EXIT" -ne 0 ]; then
    echo "  (忽略 Creator 退出码 ${CREATOR_EXIT} : 仅为无头进程退出噪声，产物已生成)"
  fi
else
  echo "✗ 构建失败 (exit=${CREATOR_EXIT}) 。完整日志: ${BUILD_LOG}"
  exit "$CREATOR_EXIT"
fi
rm -f "$BUILD_LOG"

echo "✓ 完成。产物目录: $OUT"
case "$PLATFORM" in
  wechatgame) echo "  用『微信开发者工具』打开该目录预览/上传。" ;;
  web-mobile|web-desktop) echo "  部署到任意静态服务器即可访问。" ;;
  ios) echo "  用 Xcode 打开 $OUT/proj/openblock-cocos.xcodeproj 继续编译/签名上架。" ;;
  android) echo "  用 Android Studio 打开 $OUT/proj 继续编译。" ;;
esac
