#!/usr/bin/env bash
#
# patch-native-engine.sh —— 修补 Cocos Creator 内置 native 引擎，消除 Xcode 16+ 编译错误/警告。
#
# 背景：
#   - enoki/half.h 对 std::is_floating_point 等的特化在新版 libc++ 中非法 → 编译错误
#   - tetgen.cpp 大量使用 sprintf → -Wdeprecated-declarations 警告
#
# 用法：在 iOS 原生编译（Xcode / xcodebuild）前执行一次即可；build-ios.sh 会自动调用。
#
# 环境变量：
#   COCOS_CREATOR  指向 CocosCreator 可执行文件（默认 3.8.8）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES_DIR="$(cd "$SCRIPT_DIR/../native-patches" && pwd)"
CREATOR="${COCOS_CREATOR:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"

if [[ ! -x "$CREATOR" ]]; then
    echo "✗ patch-native-engine.sh: 找不到 Cocos Creator：$CREATOR" >&2
    exit 1
fi

ENGINE_ROOT="$(cd "$(dirname "$CREATOR")/../Resources/resources/3d/engine/native" && pwd)"
if [[ ! -d "$ENGINE_ROOT" ]]; then
    echo "✗ patch-native-engine.sh: 引擎目录不存在：$ENGINE_ROOT" >&2
    exit 1
fi

HALF_SRC="$PATCHES_DIR/external/sources/enoki/half.h"
HALF_DST="$ENGINE_ROOT/external/sources/enoki/half.h"
TETGEN_DST="$ENGINE_ROOT/cocos/gi/light-probe/tetgen.cpp"

if [[ ! -f "$HALF_SRC" ]]; then
    echo "✗ patch-native-engine.sh: 缺少补丁 $HALF_SRC" >&2
    exit 1
fi

if ! cmp -s "$HALF_SRC" "$HALF_DST"; then
    cp "$HALF_SRC" "$HALF_DST"
    echo "✔ 已修补 enoki/half.h（移除非法 std trait 特化）"
else
    echo "✔ enoki/half.h 已是最新补丁"
fi

if [[ -f "$TETGEN_DST" ]]; then
    if ! grep -q 'OPENBLOCK_PATCH: ignore deprecated sprintf' "$TETGEN_DST"; then
        python3 - "$TETGEN_DST" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    text = f.read()
needle = '#ifdef __clang__\n    #pragma clang diagnostic ignored "-Wshorten-64-to-32"\n#endif'
insert = (
    '#ifdef __clang__\n'
    '    #pragma clang diagnostic ignored "-Wshorten-64-to-32"\n'
    '    // OPENBLOCK_PATCH: ignore deprecated sprintf in third-party TetGen\n'
    '    #pragma clang diagnostic ignored "-Wdeprecated-declarations"\n'
    '#endif'
)
if needle not in text:
    raise SystemExit(f'✗ tetgen.cpp 结构变化，无法注入 pragma：{path}')
text = text.replace(needle, insert, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('✔ 已修补 tetgen.cpp（忽略 sprintf 弃用警告）')
PYEOF
    else
        echo "✔ tetgen.cpp 已是最新补丁"
    fi
else
    echo "⚠ 未找到 tetgen.cpp，跳过：$TETGEN_DST" >&2
fi
