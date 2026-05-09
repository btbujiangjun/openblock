#!/usr/bin/env python3
"""
检查 docs/ 下所有 Markdown 文档是否已注册到 server.py 的 _DOC_CATEGORIES。

退出码：
  0 — 全部已注册（或仅有合法豁免）
  1 — 有未注册文档（控制台打印缺失清单 + 建议补丁位置）

豁免规则（无需注册）：
  - 子目录 README.md（如 docs/player/README.md）：作为目录索引页，
    用户已能从分类标题进入；不进侧栏。
  - docs/README.md：例外，本身是「文档中心」分类（已在 _DOC_CATEGORIES 里）。

适合作为：
  - 本地一次性核对：`python scripts/check_docs_registered.py`
  - CI 门：在 `.github/workflows/*.yml` 加 `python scripts/check_docs_registered.py`
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "docs"
SERVER_PY = REPO_ROOT / "server.py"


def collect_filesystem_docs() -> set[str]:
    """枚举 docs/ 下所有应注册的相对路径。"""
    docs = set()
    for path in DOCS_DIR.rglob("*.md"):
        rel = path.relative_to(DOCS_DIR).as_posix()
        # 子目录索引页 README.md 不进侧栏（顶层 docs/README.md 例外，作为「文档中心」分类）。
        # 注意：仅过滤文件名严格为 README.md 的，避免误伤 RL_README.md 等内容文件。
        if path.name == "README.md" and "/" in rel:
            continue
        docs.add(rel)
    return docs


_DOC_RE = re.compile(r'"([\w/\-]+\.md)"')


def collect_registered_docs() -> set[str]:
    """从 server.py 的 _DOC_CATEGORIES 块抓取已注册路径。

    简单基于源码扫描，避免引入 Flask 依赖。块边界以 `_DOC_CATEGORIES = [` 开头到
    匹配的右方括号 `]\\n` 收尾。
    """
    text = SERVER_PY.read_text("utf-8", errors="replace")
    start = text.find("_DOC_CATEGORIES = [")
    if start < 0:
        raise SystemExit("ERROR: _DOC_CATEGORIES 未在 server.py 中找到")
    # 简单匹配：找到首个 `\n]\n` 即可（_DOC_CATEGORIES 末尾以 `]` 单独占行）
    end = text.find("\n]\n", start)
    if end < 0:
        raise SystemExit("ERROR: _DOC_CATEGORIES 块结束符未找到")
    block = text[start : end + 1]
    return set(_DOC_RE.findall(block))


def main() -> int:
    fs = collect_filesystem_docs()
    reg = collect_registered_docs()

    missing = sorted(fs - reg)
    extra = sorted(reg - fs)

    print(f"[check] 文件系统中应注册的 .md：{len(fs)} 篇")
    print(f"[check] server.py 已注册：    {len(reg)} 项")

    if extra:
        print("\n[WARN] 已注册但文件不存在（可能拼写错或文件已删）：")
        for r in extra:
            print(f"  - {r}")

    if missing:
        print("\n[FAIL] 以下文档存在于 docs/ 但未注册到 server.py 左侧目录：")
        for m in missing:
            print(f"  - {m}")
        print(
            "\n→ 修复：编辑 server.py 中的 _DOC_CATEGORIES，在合适的分类下追加这些路径。"
        )
        print("  详见 _DOC_CATEGORIES 顶部的「维护规约」注释。\n")
        return 1

    print("\n[OK] 所有文档已注册到左侧目录。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
