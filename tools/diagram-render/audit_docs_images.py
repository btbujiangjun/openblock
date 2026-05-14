#!/usr/bin/env python3
"""docs/ 图片资源完整性审计脚本。

用途：在每次新增/重命名图片资源后执行一次，确保：
  1. markdown 中所有 ``![](src)`` / ``<img src>`` 引用的物理文件存在
  2. 文件扩展名与真实二进制魔术头一致（避免再次出现 ``.png`` 实为 JPEG
     的 MIME / 扩展名不一致问题，那会被 Chrome 等浏览器拒绝渲染）
  3. ``/docs/asset/<path>`` HTTP 路由实际可达且返回 200
  4. HTTP ``Content-Type`` 与扩展名预期一致（防御服务端配置漂移）

用法::

    # 默认连本地 Flask :5000；如服务跑在别处可显式指定
    python3 tools/diagram-render/audit_docs_images.py
    OPENBLOCK_API_BASE=http://127.0.0.1:5050 python3 tools/diagram-render/audit_docs_images.py

退出码：发现任意问题 → 1，全绿 → 0（便于接 CI / pre-commit hook）。
"""
from __future__ import annotations

import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
API_BASE = os.environ.get("OPENBLOCK_API_BASE", "http://127.0.0.1:5000").rstrip("/")

IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)

# 与 server.py:_DOC_ASSET_EXT_MIME 对齐
EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

MAGIC = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",
}


def detect_mime(path: Path) -> str | None:
    """根据魔术字节判定真实 MIME（svg 走文本嗅探）。"""
    head = path.read_bytes()[:16]
    for sig, mime in MAGIC.items():
        if head.startswith(sig):
            return mime
    if head.lstrip().startswith(b"<svg") or head.lstrip().startswith(b"<?xml"):
        return "image/svg+xml"
    return None


def http_status(url: str) -> tuple[int, str]:
    """返回 (status_code, content_type)，连接失败返回 (-1, error_message)。"""
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001 — 任何网络异常都视为失败
        return -1, str(e)


def main() -> int:
    issues: list[tuple[str, Path, str]] = []
    seen_urls: set[str] = set()
    md_files = sorted(DOCS.rglob("*.md"))
    print(f"=== docs 图片审计：扫描 {len(md_files)} 个 markdown，API_BASE={API_BASE} ===\n")

    for md in md_files:
        text = md.read_text(encoding="utf-8")
        rel_md = md.relative_to(ROOT)
        srcs: list[tuple[str, int]] = []
        for m in IMG_RE.finditer(text):
            srcs.append((m.group(1), text[: m.start()].count("\n") + 1))
        for m in HTML_IMG_RE.finditer(text):
            srcs.append((m.group(1), text[: m.start()].count("\n") + 1))

        for src, lineno in srcs:
            if re.match(r"^(?:https?:|data:|blob:|/)", src):
                continue
            clean = src.split("#")[0].split("?")[0].lstrip("./")
            doc_dir = rel_md.parent.relative_to("docs")
            asset_path = DOCS / doc_dir / clean
            asset_rel_to_docs = (doc_dir / clean).as_posix()

            if not asset_path.is_file():
                issues.append(("FILE_MISSING", rel_md,
                               f"L{lineno} src={src!r} → {asset_path.relative_to(ROOT)}"))
                continue

            ext = asset_path.suffix.lower()
            expected = EXT_MIME.get(ext)
            actual = detect_mime(asset_path)
            if expected and actual and expected != actual:
                issues.append(("MIME_MISMATCH", rel_md,
                               f"L{lineno} {asset_path.relative_to(ROOT)}: "
                               f"ext={ext} → {expected}, actual={actual}"))

            url = f"{API_BASE}/docs/asset/{asset_rel_to_docs}"
            if url in seen_urls:
                continue
            seen_urls.add(url)
            code, ct = http_status(url)
            if code != 200:
                issues.append(("HTTP_FAIL", rel_md, f"L{lineno} GET {url} → {code}"))
            elif expected and ct.split(";")[0].strip() != expected:
                issues.append(("HTTP_CT_MISMATCH", rel_md,
                               f"L{lineno} {url} → CT={ct!r}, expected {expected}"))

    if not issues:
        print(f"✅ 全绿：{len(seen_urls)} 个唯一图片 URL 全部 200 + MIME 一致")
        return 0

    print(f"❌ 发现 {len(issues)} 个问题：\n")
    by_kind: dict[str, list] = {}
    for kind, md, msg in issues:
        by_kind.setdefault(kind, []).append((md, msg))
    for kind, items in by_kind.items():
        print(f"--- {kind} ({len(items)}) ---")
        for md, msg in items:
            print(f"  {md}: {msg}")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
