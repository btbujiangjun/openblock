#!/usr/bin/env bash
# ---------------------------------------------------------------
# sync-core.sh
# 将 web/src 中的纯逻辑模块同步到 miniprogram/core/，
# 自动完成 ES Module → CommonJS 转换。
#
# 用法：
#   bash scripts/sync-core.sh
# ---------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web/src"
DST="$ROOT/miniprogram/core"
SHARED="$ROOT/shared"

echo "=== sync-core: $SRC → $DST ==="

mkdir -p "$DST/bot"
mkdir -p "$DST/lib"
mkdir -p "$DST/tuning/v2"

# 小程序包不直接携带 JSON，避免开发工具把 JSON 解析成 .json.js 或提示未上传。
# 共享数据以 CommonJS 数据模块形式进入运行时。
node <<NODE
const fs = require('fs');
const path = require('path');

const pairs = [
  ['game_rules.json', 'gameRulesData.js', '小程序运行时数据模块；避免直接 require JSON 导致部分开发工具配置下解析为 .json.js。\\n * 数据来自 shared/game_rules.json。'],
  ['shapes.json', 'shapesData.js', '小程序运行时不稳定支持 require JSON；这里以 JS 模块形式提供形状数据。\\n * 数据来自 shared/shapes.json。']
];

for (const [source, target, comment] of pairs) {
  const data = JSON.parse(fs.readFileSync(path.join('$SHARED', source), 'utf8'));
  const body = JSON.stringify(data, null, 2);
  fs.writeFileSync(
    path.join('$DST', target),
    '/**\\n * ' + comment + '\\n */\\nmodule.exports = ' + body + ';\\n'
  );
}
NODE

# 要同步的纯逻辑文件列表
FILES=(
  "lib/seededRng.js"
  "lib/math.js"
  "grid.js"
  "shapes.js"
  "gameRules.js"
  "difficulty.js"
  "boardTopology.js"
  "playerAbilityModel.js"
  "adaptiveSpawn.js"
  "playerProfile.js"
  "spawnStepDifficulty.js"
  "bot/constructiveSpawn.js"
  "bot/blockSpawn.js"
  "tuning/v2/clientPolicyV2.js"
)

for f in "${FILES[@]}"; do
  src_file="$SRC/$f"
  dst_file="$DST/$f"

  if [ ! -f "$src_file" ]; then
    echo "  [SKIP] $f (not found)"
    continue
  fi

  # 读取源文件内容并做 ES → CJS 转换
  content=$(cat "$src_file")

  # 1. import { X } from './Y.js'  →  const { X } = require('./Y')
  #    用 perl -0 处理 adaptiveSpawn / simulator 这类多行具名 import。
  content=$(printf "%s" "$content" | perl -0pe "s/import\s+\{([^}]+)\}\s+from\s+'([^']+)\.js';/const {\1} = require('\2');/gs")

  # 1b. v1.60.0：import * as X from './Y.js' → const X = require('./Y')
  #     covers playerAbilityModel 的 personalization / ltvPredictor / MonetizationBus 等动态导入场景。
  content=$(echo "$content" | sed -E "s/import \* as ([A-Za-z_][A-Za-z0-9_]*) from '([^']+)\.js'/const \1 = require('\2')/g")

  # 2. import X from './Y.json'  →  const X = require('./Y.json')
  content=$(echo "$content" | sed -E "s/import ([A-Za-z_][A-Za-z0-9_]*) from '([^']+\.json)'/const \1 = require('\2')/g")

  # 3. import X from './Y.js'  →  const X = require('./Y')
  content=$(echo "$content" | sed -E "s/import ([A-Za-z_][A-Za-z0-9_]*) from '([^']+)\.js'/const \1 = require('\2')/g")

  # 4. export class X  →  class X
  content=$(echo "$content" | sed -E 's/^export class /class /g')

  # 5. export function X  →  function X
  content=$(echo "$content" | sed -E 's/^export function /function /g')

  # 6. export const X  →  const X
  content=$(echo "$content" | sed -E 's/^export const /const /g')

  # 7. export { X }  →  // (handled by module.exports below)
  content=$(echo "$content" | sed -E 's/^export \{[^}]*\}.*$//')

  # 8. 收集所有被导出的符号名，生成 module.exports
  #    从原始文件找 export 的名字
  exports=$(grep -oE '^export (const|function|class) ([A-Za-z_][A-Za-z0-9_]*)' "$src_file" \
    | sed -E 's/^export (const|function|class) //' || true)
  re_exports=$(grep -oE "^export \{([^}]+)\}" "$src_file" \
    | sed -E 's/export \{//; s/\}//' | tr ',' '\n' | sed 's/^ *//; s/ *$//' || true)

  all_exports=$(echo -e "$exports\n$re_exports" | sort -u | grep -v '^$' || true)

  if [ -n "$all_exports" ]; then
    exports_obj=$(echo "$all_exports" | paste -sd ',' - | sed 's/,/, /g')
    content="$content

module.exports = { $exports_obj };"
  fi

  # 9. 修复 JSON/模块路径（shared/ 文件已复制到 core/）
  #    bot/ 与 lib/ 下的子目录文件引用 ../../shared/ → ../  (即 core/)
  #    core/ 根下的文件引用 ../shared/ → ./  (同目录)
  if [[ "$f" == bot/* || "$f" == lib/* ]]; then
    content=$(echo "$content" | sed "s|require('../../shared/|require('../|g")
    content=$(echo "$content" | sed "s|require('../shared/|require('../|g")
  elif [[ "$f" == tuning/v2/* ]]; then
    content=$(echo "$content" | sed "s|require('../../shared/|require('../../|g")
    content=$(echo "$content" | sed "s|require('../shared/|require('../../|g")
  else
    content=$(echo "$content" | sed "s|require('../shared/|require('./|g")
    content=$(echo "$content" | sed "s|require('../../shared/|require('./|g")
  fi

  content=$(echo "$content" | sed "s|require('./game_rules.json')|require('./gameRulesData')|g")
  content=$(echo "$content" | sed "s|require('./shapes.json')|require('./shapesData')|g")
  content=$(echo "$content" | sed "s|require('../game_rules.json')|require('../gameRulesData')|g")
  content=$(echo "$content" | sed "s|require('../shapes.json')|require('../shapesData')|g")

  # v1.60.0：对**未分发到小程序的子目录**（monetization / retention / lifecycle /
  # achievements / level / daily / playmodes / progression / services / rewards / ...）
  # 的 require 统一做 try-wrap 软依赖包装。
  #
  # 背景：miniprogram/core/ 严格只分发本脚本 FILES 名单 + bot/ 子目录（小程序包瘦身策略），
  # 而 web/src/ 下的逻辑模块（如 adaptiveSpawn.js）持续接入新子系统的 require。直接 require
  # 在小程序运行时会 Cannot find module 硬挂；改为 try-wrap 让它软失败回退到空对象，配合
  # 调用点已有的 typeof check / try-catch / 软失败逻辑，保持小程序运行时安全。
  #
  # 正则：匹配 `const X = require('./<subdir>/<modName>');` 但 <subdir> 不是 bot（已 sync）。
  content=$(printf "%s" "$content" | perl -pe "s|^const (\w+) = require\('\./(?!bot/)(\w+)/([^']+)'\);|let \$1 = {}; try { \$1 = require('./\$2/\$3'); } catch (_e) { /* miniprogram 不分发 \$2/ 子目录，软依赖回退空骨架 */ }|g")
  # 同样处理具名解构形式：`const { a, b } = require('./<subdir>/<modName>');`
  # 用 modName 做唯一后缀，避免同一作用域内多个 require 都来自同一 subdir 时 `let` 重复声明。
  content=$(printf "%s" "$content" | perl -pe "s|^const \{([^}]+)\} = require\('\./(?!bot/)(\w+)/([^']+)'\);|let _softDeps_\$3 = {}; try { _softDeps_\$3 = require('./\$2/\$3'); } catch (_e) { /* miniprogram 不分发 \$2/ 子目录，软依赖回退空骨架 */ } const {\$1} = _softDeps_\$3;|g")

  echo "$content" > "$dst_file"
  echo "  [OK] $f"
done

# --- Spawn tuning v2: 同步寻参离线 bundle 给小程序 ----------------------
node "$ROOT/scripts/sync-spawn-bundle.mjs"

echo ""
echo "=== 同步完成。请手动检查 miniprogram/core/config.js 的 localStorage / import.meta.env 替换 ==="
