#!/usr/bin/env python3
"""
打印候选块形状及其在「按类别权重均匀抽形状」下的概率。

与 web pickShapeByCategoryWeights / Python pick_random_shape_weighted 一致：
每个形状的权重 = shapeWeights[category]，概率 = 该权重 / 全库权重之和。

说明：对局中 generateBlocks 会先尝试塞入能填缝消行的块，再对剩余槽位做加权抽样，
因此实际 Dock 边缘分布会与下表略有差别；开局 initBoard 与本表一致。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from rl_pytorch.shapes_data import get_all_shapes, shape_category  # noqa: E402


def cell_count(data: list[list[int]]) -> int:
    return sum(sum(row) for row in data)


def main() -> None:
    rules_path = _ROOT / "shared" / "game_rules.json"
    with open(rules_path, encoding="utf-8") as f:
        rules = json.load(f)

    shapes = get_all_shapes()
    strategies = rules["strategies"]

    for sid in ("easy", "normal", "hard"):
        s = strategies[sid]
        name = s.get("name", sid)
        weights = {k: float(v) for k, v in s["shapeWeights"].items()}

        entries = []
        total_w = 0.0
        for sh in shapes:
            cat = shape_category(sh["id"])
            w = weights.get(cat, 1.0)
            total_w += w
            entries.append((sh["id"], cat, w, cell_count(sh["data"])))

        entries.sort(key=lambda x: (x[1], x[0]))

        print(f"\n=== {name} ({sid}) ===")
        print(f"全库权重和 = {total_w:.6f}  （形状数 = {len(shapes)}）\n")
        print(f"{'id':<10} {'category':<10} {'cells':>5}  {'weight':>8}  {'P(抽中)':>10}")
        print("-" * 52)
        for eid, cat, w, cells in entries:
            p = w / total_w
            print(f"{eid:<10} {cat:<10} {cells:>5}  {w:>8.4f}  {p:>9.2%}")
        print("-" * 52)
        print(f"{'合计':<10} {'':<10} {'':>5}  {total_w:>8.4f}  {'100.00%':>10}")


if __name__ == "__main__":
    main()
