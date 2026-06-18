#!/usr/bin/env bash
#
# patch-android-app-name.sh —— 确保 Cocos Android 工程桌面显示名为 OpenBlock。
#
# 用法：
#   patch-android-app-name.sh <android_proj_dir>
#
# 背景：Cocos Creator 构建时会从 build-configs/android.json 的 appName 生成
# strings.xml，但偶发被包名/工程名（openblock-cocos）覆盖；build-templates 里的
# strings.xml 也可能在部分流程未合并。本脚本在 Gradle 打包前幂等写入 app_name。
#
# 对齐：
#   - cocos/build-configs/android.json → "appName": "OpenBlock"
#   - cocos/build-templates/android/app/res/values/strings.xml
#   - AndroidManifest android:label="@string/app_name"

set -uo pipefail

ANDROID_PROJ="${1:-}"
APP_NAME="OpenBlock"

if [[ -z "$ANDROID_PROJ" || ! -d "$ANDROID_PROJ" ]]; then
    echo "⚠ patch-android-app-name.sh: 无效 Android 工程目录，跳过" >&2
    exit 0
fi

# 覆盖所有 res/values/strings.xml —— 关键是 proj/res/values/strings.xml：app 模块
# sourceSets res.srcDirs 含 "${RES_PATH}/proj/res"，其 app_name 由构建器按 gradle 工程名
# 生成为 openblock-cocos，会赢得 @string/app_name 解析。仅匹配 src/main 会漏掉它。
STRINGS_LIST="$(
    {
        find "$ANDROID_PROJ" -path '*/res/values/strings.xml' -type f 2>/dev/null
        find "$ANDROID_PROJ" -path '*/src/main/res/values/strings.xml' -type f 2>/dev/null
    } | sort -u
)"
if [[ -z "$STRINGS_LIST" ]]; then
    STRINGS_LIST="$ANDROID_PROJ/app/src/main/res/values/strings.xml"
fi

write_strings() {
    local file="$1"
    mkdir -p "$(dirname "$file")"
    cat >"$file" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${APP_NAME}</string>
    <string name="title_activity_main">${APP_NAME}</string>
</resources>
EOF
}

printf '%s\n' "$STRINGS_LIST" | while IFS= read -r STRINGS; do
    [[ -z "$STRINGS" ]] && continue
    if [[ ! -f "$STRINGS" ]]; then
        write_strings "$STRINGS"
        echo "✔ 已创建 strings.xml → app_name=${APP_NAME}"
        echo "  $STRINGS"
        continue
    fi
    if grep -q 'name="app_name"' "$STRINGS" 2>/dev/null; then
        # 兼容 <string name="app_name">…</string> 与带属性的 <string name="app_name" translatable="false">…</string>
        sed -E "s|(<string name=\"app_name\"[^>]*>)[^<]*</string>|\1${APP_NAME}</string>|" "$STRINGS" >"${STRINGS}.tmp" 2>/dev/null \
            && mv "${STRINGS}.tmp" "$STRINGS" || rm -f "${STRINGS}.tmp"
    else
        sed "/<\/resources>/i\\
    <string name=\"app_name\">${APP_NAME}</string>" "$STRINGS" >"${STRINGS}.tmp" 2>/dev/null \
            && mv "${STRINGS}.tmp" "$STRINGS" || write_strings "$STRINGS"
    fi
    if grep -q 'name="title_activity_main"' "$STRINGS" 2>/dev/null; then
        sed "s|<string name=\"title_activity_main\">[^<]*</string>|<string name=\"title_activity_main\">${APP_NAME}</string>|" "$STRINGS" >"${STRINGS}.tmp" 2>/dev/null \
            && mv "${STRINGS}.tmp" "$STRINGS" || rm -f "${STRINGS}.tmp"
    else
        sed "/<\/resources>/i\\
    <string name=\"title_activity_main\">${APP_NAME}</string>" "$STRINGS" >"${STRINGS}.tmp" 2>/dev/null \
            && mv "${STRINGS}.tmp" "$STRINGS" || write_strings "$STRINGS"
    fi
    echo "✔ 已确保 strings.xml 名称 → ${APP_NAME}"
    echo "  $STRINGS"
done

MANIFEST_LIST="$(
    {
        find "$ANDROID_PROJ" -path '*/src/main/AndroidManifest.xml' -type f 2>/dev/null
        find "$ANDROID_PROJ" -path '*/app/AndroidManifest.xml' -type f 2>/dev/null
    } | sort -u
)"
printf '%s\n' "$MANIFEST_LIST" | while IFS= read -r MANIFEST; do
    [[ -z "$MANIFEST" || ! -f "$MANIFEST" ]] && continue
    sed 's|android:label="@string/app_name"|android:label="OpenBlock"|g; s|android:label="[^"]*"|android:label="OpenBlock"|g' "$MANIFEST" >"${MANIFEST}.tmp" 2>/dev/null \
        && mv "${MANIFEST}.tmp" "$MANIFEST" || rm -f "${MANIFEST}.tmp"
    echo "✔ 已确保 AndroidManifest label → ${APP_NAME}"
    echo "  $MANIFEST"
done
