#!/usr/bin/env bash
#
# patch-splash.sh —— 关闭 Cocos 启动 splash（去掉「Powered by Cocos」开机 logo）。
#
# 用法：
#   patch-splash.sh <data_dir>
#   其中 <data_dir> 是 Cocos 构建输出根目录，里面有 src/settings.json。
#     Android: cocos/build/android/data
#     iOS:     cocos/build/ios/data
#
# 实现：直接把 settings.json 里的 splashScreen.totalTime 改为 0，且把 base64 logo 清空。
#   - totalTime=0 → 引擎跳过 splash 阶段，不渲染 logo。
#   - 同时把 base64 字段置空，减小最终包体（默认 logo 约 35KB）。
#
# Cocos 官方虽然推荐去 Editor → Build 面板里手动取消勾选，但那只能存编辑器本地 profile，
# 团队/CI 无法稳定复现。在这里做最后一公里的字段级修改，对源工程零侵入。

set -uo pipefail

DATA_DIR="${1:-}"
if [[ -z "$DATA_DIR" ]]; then
    echo "✗ patch-splash.sh 缺少参数：data_dir" >&2
    exit 1
fi

SETTINGS="$DATA_DIR/src/settings.json"
if [[ ! -f "$SETTINGS" ]]; then
    echo "⚠ patch-splash.sh: 找不到 $SETTINGS，跳过" >&2
    exit 0
fi

# 用 python3 做 JSON in-place 编辑，比 sed/awk 更可靠（JSON 中可能有任意字符）。
python3 - <<PYEOF || { echo "✗ patch-splash.sh: 修改 splashScreen 失败" >&2; exit 1; }
import json, sys
p = "$SETTINGS"
with open(p, 'r', encoding='utf-8') as f:
    d = json.load(f)
ss = d.get('splashScreen')
if not ss:
    print(f"⚠ {p} 没有 splashScreen 字段，无需修改", file=sys.stderr)
    sys.exit(0)
prev_total = ss.get('totalTime')
ss['totalTime'] = 0
if isinstance(ss.get('logo'), dict):
    ss['logo']['base64'] = ''
with open(p, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
print(f"✔ splash 已关闭：totalTime {prev_total} → 0，logo base64 已清空")
PYEOF
