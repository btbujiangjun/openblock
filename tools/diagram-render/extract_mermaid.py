#!/usr/bin/env python3
"""Extract fenced ```mermaid blocks from a markdown file into individual `.mmd` files.

Usage:
    python tools/diagram-render/extract_mermaid.py <input.md> <out_dir> <basename_prefix>

Each block is written to ``<out_dir>/<basename_prefix>-<index>.mmd`` (1-indexed).
A small JSON manifest is also written to ``<out_dir>/<basename_prefix>-manifest.json``
recording each block's start/end line numbers in the source markdown so the
post-render rewriter can deterministically replace them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def extract(md_path: Path, out_dir: Path, prefix: str) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = md_path.read_text(encoding="utf-8").splitlines()

    blocks: list[dict] = []
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped == "```mermaid":
            start = i
            j = i + 1
            while j < len(lines) and lines[j].strip() != "```":
                j += 1
            if j >= len(lines):
                raise SystemExit(f"Unterminated mermaid block starting at line {start + 1}")
            body = "\n".join(lines[start + 1 : j])
            idx = len(blocks) + 1
            mmd_name = f"{prefix}-{idx:02d}.mmd"
            (out_dir / mmd_name).write_text(body + "\n", encoding="utf-8")
            blocks.append(
                {
                    "index": idx,
                    "start_line": start + 1,
                    "end_line": j + 1,
                    "mmd": mmd_name,
                }
            )
            i = j + 1
        else:
            i += 1

    manifest_path = out_dir / f"{prefix}-manifest.json"
    manifest_path.write_text(
        json.dumps({"source": str(md_path), "blocks": blocks}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return blocks


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    md_path = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    prefix = sys.argv[3]
    blocks = extract(md_path, out_dir, prefix)
    print(f"Extracted {len(blocks)} mermaid block(s) → {out_dir}")
    for b in blocks:
        print(f"  - {b['mmd']:30s} L{b['start_line']:>4} - L{b['end_line']:>4}")


if __name__ == "__main__":
    main()
