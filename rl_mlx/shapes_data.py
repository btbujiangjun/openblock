"""来自 shared/shapes.json，与 rl_pytorch/shapes_data 一致。"""

from __future__ import annotations

import json
import random
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_PATH = _ROOT / "shared" / "shapes.json"

with open(_PATH, encoding="utf-8") as _f:
    _BUNDLE = json.load(_f)

ORDER: list[str] = list(_BUNDLE["categoryOrder"])
SHAPES: dict[str, list[dict]] = {}
for cat in ORDER:
    SHAPES[cat] = []
    for s in _BUNDLE["byCategory"].get(cat, []):
        SHAPES[cat].append(
            {
                "id": s["id"],
                "category": s.get("category") or cat,
                "data": s["data"],
            }
        )


def get_all_shapes():
    out = []
    for k in ORDER:
        out.extend(SHAPES[k])
    return out


def shape_category(shape_id: str) -> str:
    for shapes in SHAPES.values():
        for s in shapes:
            if s["id"] == shape_id:
                return str(s["category"])
    return "squares"


def pick_random_shape_weighted(shape_weights: dict[str, float] | None = None) -> dict:
    all_shapes = get_all_shapes()
    if not all_shapes:
        raise RuntimeError("shapes.json 无形状")
    sw = shape_weights or {}
    total = sum(sw.get(shape_category(s["id"]), 1.0) for s in all_shapes)
    r = random.random() * total
    for s in all_shapes:
        r -= sw.get(shape_category(s["id"]), 1.0)
        if r <= 0:
            return s
    return all_shapes[0]
