#!/usr/bin/env bash
#
# build-ios.sh —— 一键构建 Cocos iOS 工程并过滤退出噪音。
#
# 背景：Cocos Creator 命令行（无头 Electron）在「构建成功后退出」时，会打印两条无害的
# IPC 拆除错误（mach_port_rendezvous / shared_memory_switch），并让进程返回非 0 退出码。
# 这两条与构建结果无关，本脚本据「build Task (...)Finished」判定真正的成功与否，
# 同时把这些噪音从输出中过滤掉，避免误判失败。
#
# 用法：
#   cocos/scripts/build-ios.sh                       # 仅构建 JS 包 + 生成 Xcode 工程
#   cocos/scripts/build-ios.sh --open                # 构建后自动用 Xcode 打开工程
#   cocos/scripts/build-ios.sh --run                 # 构建后用 xcodebuild 编译并安装到已连真机
#   cocos/scripts/build-ios.sh path/to/ios.json --open  # 指定配置 + 自动打开
#
# 说明：
#   --open  最稳妥：随后在 Xcode 里 ⌘R 跑到真机（签名已固化，无需再导证书/Bundle）。
#   --run   命令行直达真机：需已用数据线连接 + 信任设备；底层走 xcodebuild + xcrun devicectl。
#           （Xcode 15+ 自带 devicectl；旧版可改用 ios-deploy。）
#
# 退出码：构建成功 0；失败 1。

set -uo pipefail

# Creator 可执行文件（可用环境变量 COCOS_CREATOR 覆盖版本/路径）
CREATOR="${COCOS_CREATOR:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"

# 定位工程根：脚本在 cocos/scripts/ 下，向上两级即仓库根，cocos 目录即工程目录。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COCOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 解析参数：可选的配置文件路径（非 -- 开头）+ 标志 --open / --run。
CONFIG=""
DO_OPEN=0
DO_RUN=0
for arg in "$@"; do
    case "$arg" in
        --open) DO_OPEN=1 ;;
        --run)  DO_RUN=1 ;;
        --*)    echo "✗ 未知参数：$arg" >&2; exit 1 ;;
        *)      CONFIG="$arg" ;;
    esac
done
CONFIG="${CONFIG:-$COCOS_DIR/build-configs/ios.json}"

# 允许传相对路径
case "$CONFIG" in
    /*) ;;                                   # 绝对路径，原样使用
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

echo "▶ 构建 iOS：project=$COCOS_DIR"
echo "  config=$CONFIG"

# ── 寻参 bundle 同步 + 校验 ──────────────────────────────────────────
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

# 过滤退出噪音的正则
# - mach_port_rendezvous / shared_memory_switch / No rendezvous client：CLI 退出时的 Electron IPC 拆除噪音
# - Recovery window failed / window\.json: Unexpected end of JSON / 紧随其后的 SyntaxError 栈：
#   CLI 模式下 Creator 仍会尝试初始化 GUI「恢复窗口」，读到空的 ~/.CocosCreator/editor/window.json.backup
#   会抛 SyntaxError 并把进程退码搞成 36；与构建产物无关，整段栈一并屏蔽。
NOISE='mach_port_rendezvous|shared_memory_switch|No rendezvous client|Recovery window failed|window\.json: Unexpected end of JSON|^SyntaxError:|^\s+at (JSON\.parse|_readFile|Object\.(startup|window)|async Promise\.all|launch|/Applications/Cocos/)'

# 用临时文件留存完整日志，便于据「Finished」判定成功（管道里 $? 是 grep 的码，不可靠）。
LOG="$(mktemp -t cocos-build-ios)"

# ⚠️ ELECTRON_RUN_AS_NODE 必须 unset：某些开发环境（Cursor agent shell、部分 IDE
#   集成终端）会把它注入子进程，让 CocosCreator 走 Node CLI 模式 → 报 "bad option: --project"。
unset ELECTRON_RUN_AS_NODE

"$CREATOR" \
    --project "$COCOS_DIR" \
    --build "configPath=$CONFIG" 2>&1 | tee "$LOG" | grep -Ev "$NOISE"

# 真正的成功判据：日志里出现「build Task (...)Finished」。
if ! grep -Eq 'build Task .*Finished' "$LOG"; then
    echo "" >&2
    echo "✗ 构建未完成（日志未出现 Finished）。完整日志已保留：$LOG" >&2
    # 失败时把真实错误（排除噪音）摘出来便于排查
    grep -E 'ERROR|error|Error|失败|Failed' "$LOG" | grep -Ev "$NOISE" | tail -20 >&2 || true
    exit 1
fi
rm -f "$LOG"
echo ""
echo "✔ Cocos 构建成功。"

# 修补内置 native 引擎（half.h / tetgen.cpp），消除 Xcode 16+ 编译错误与 sprintf 警告。
if [[ -x "$SCRIPT_DIR/patch-native-engine.sh" ]]; then
    "$SCRIPT_DIR/patch-native-engine.sh" || {
        echo "✗ patch-native-engine.sh 失败；请在 Xcode 编译前手动运行。" >&2
        exit 1
    }
fi

# 关闭开机 splash（详见 patch-splash.sh）。在 Cocos 输出后修改 data/src/settings.json，
# Xcode 工程会把它作为 bundle resource 拷进 ipa。失败不致命，仅 warning。
if [[ -x "$SCRIPT_DIR/patch-splash.sh" ]]; then
    "$SCRIPT_DIR/patch-splash.sh" "$COCOS_DIR/build/ios/data" || true
fi

# 同步 iOS 原生渲染模板（AppDelegate/ViewController，对齐 Android AppActivity 渲染策略）。
if [[ -x "$SCRIPT_DIR/patch-ios-native.sh" ]]; then
    "$SCRIPT_DIR/patch-ios-native.sh" "$COCOS_DIR" || {
        echo "✗ patch-ios-native.sh 失败；请在 Xcode 编译前手动运行。" >&2
        exit 1
    }
fi

# 覆盖 iOS LaunchScreen 启动图（详见 patch-ios-launch.sh）。Cocos Creator 每次 build 都会从
# 内置 splash 模板重新生成 native/engine/ios/LaunchScreenBackground{,Portrait,Landscape}.png
# （Cocos 官方 logo），所以必须在 Creator 后、xcodebuild 前把它们覆盖成我们的图。
# 同时把上一次 xcodebuild 缓存到 .app 里的旧图删掉，强制 Xcode 重拷。
if [[ -x "$SCRIPT_DIR/patch-ios-launch.sh" ]]; then
    "$SCRIPT_DIR/patch-ios-launch.sh" "$COCOS_DIR" || true
    find "$COCOS_DIR/build/ios/proj" -name "LaunchScreenBackground.png" -path "*/Debug-iphoneos/*" -delete 2>/dev/null || true
    find "$COCOS_DIR/build/ios/proj" -name "LaunchScreenBackground.png" -path "*/Release-iphoneos/*" -delete 2>/dev/null || true
    find "$COCOS_DIR/build/ios/proj" -name "LaunchScreen.storyboardc" -type d -exec rm -rf {} + 2>/dev/null || true
fi

# 定位生成的 Xcode 工程
PROJ="$(ls -d "$COCOS_DIR/build/ios/proj/"*.xcodeproj 2>/dev/null | head -1)"
if [[ -z "$PROJ" ]]; then
    echo "✗ 未找到 Xcode 工程（build/ios/proj/*.xcodeproj）。" >&2
    exit 1
fi

# --open：用 Xcode 打开工程，随后 ⌘R 跑真机
if [[ "$DO_OPEN" -eq 1 && "$DO_RUN" -eq 0 ]]; then
    echo "▶ 打开 Xcode 工程：$PROJ"
    open "$PROJ"
    exit 0
fi

# --run：命令行编译并安装到已连真机
if [[ "$DO_RUN" -eq 1 ]]; then
    SCHEME="$(/usr/bin/xcodebuild -list -project "$PROJ" 2>/dev/null | awk '/Schemes:/{f=1;next} f&&NF{print $1; exit}')"
    SCHEME="${SCHEME:-openblock}"
    DERIVED="$COCOS_DIR/build/ios/_derived"
    echo "▶ xcodebuild 编译到真机（scheme=$SCHEME, Debug）…"
    if ! /usr/bin/xcodebuild \
        -project "$PROJ" \
        -scheme "$SCHEME" \
        -configuration Debug \
        -destination 'generic/platform=iOS' \
        -derivedDataPath "$DERIVED" \
        -allowProvisioningUpdates \
        build; then
        echo "✗ xcodebuild 编译失败（多为签名/描述文件问题）。建议改用 --open 在 Xcode 内编译查看详细报错。" >&2
        exit 1
    fi

    # Cocos 的 CMake 生成工程常把产物落在 proj/Debug-iphoneos 而非 derivedDataPath，
    # 两处都找一遍，避免「BUILD SUCCEEDED 却报未找到 .app」。
    APP="$(ls -d "$DERIVED/Build/Products/Debug-iphoneos/"*.app 2>/dev/null | head -1)"
    [[ -z "$APP" ]] && APP="$(ls -d "$COCOS_DIR/build/ios/proj/Debug-iphoneos/"*.app 2>/dev/null | head -1)"
    [[ -z "$APP" ]] && APP="$(ls -dt "$COCOS_DIR/build/ios/proj/"*"/openblock.app" 2>/dev/null | head -1)"
    if [[ -z "$APP" ]]; then
        echo "✗ 未找到编译产物 .app（已在 derivedData 与 build/ios/proj 下查找）。" >&2
        exit 1
    fi
    echo "  产物：$APP"

    # 取第一台已连接的真机 UDID（Xcode 15+ 的 devicectl）
    DEV_ID=""
    if xcrun devicectl list devices >/dev/null 2>&1; then
        DEV_ID="$(xcrun devicectl list devices 2>/dev/null | awk -F'  +' '/connected/{print $3; exit}')"
    fi
    if [[ -z "$DEV_ID" ]]; then
        echo "⚠ 未检测到已连接真机（或当前 Xcode 不支持 devicectl）。" >&2
        echo "  产物已生成：$APP" >&2
        echo "  连上设备后可手动安装：xcrun devicectl device install app --device <UDID> \"$APP\"" >&2
        exit 1
    fi

    echo "▶ 安装到设备 $DEV_ID …"
    if xcrun devicectl device install app --device "$DEV_ID" "$APP"; then
        echo "✔ 已安装到真机。在设备上点开 App 即可（首次需在 设置 > 通用 > VPN与设备管理 信任开发者）。"
        exit 0
    fi
    echo "✗ 安装失败。产物：$APP" >&2
    exit 1
fi

# 默认：仅构建，提示后续
echo "  打开 Xcode 编译到真机： open \"$PROJ\""
echo "  或下次直接： cocos/scripts/build-ios.sh --open   （构建后自动打开）"
echo "         真机： cocos/scripts/build-ios.sh --run    （构建后命令行装到真机）"
exit 0
