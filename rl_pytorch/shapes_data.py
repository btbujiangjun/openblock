"""多连块定义：来自 shared/shapes.json，与 web/src/shapes.js 一致。"""

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

SPECIAL_SHAPE_IDS: frozenset[str] = frozenset(_BUNDLE.get("specialShapeIds", []))


def is_special_shape(shape_id: str) -> bool:
    return shape_id in SPECIAL_SHAPE_IDS


def get_all_shapes(*, include_special: bool = True) -> list[dict]:
    out = []
    for k in ORDER:
        for s in SHAPES[k]:
            if not include_special and s["id"] in SPECIAL_SHAPE_IDS:
                continue
            out.append(s)
    return out


def get_regular_shapes() -> list[dict]:
    """仅常规形状（排除事件注入用 special 形状），与 web getRegularShapes 同口径。"""
    return get_all_shapes(include_special=False)


def shape_category(shape_id: str) -> str:
    for shapes in SHAPES.values():
        for s in shapes:
            if s["id"] == shape_id:
                return str(s["category"])
    return "squares"


def pick_random_shape_weighted(
    shape_weights: dict[str, float] | None = None,
    *,
    include_special: bool = False,
) -> dict:
    """与 web pickShapeByCategoryWeights 一致：按类别权重选一条形状。
    默认排除 special 形状（与 web 行为对齐）。"""
    pool = get_all_shapes(include_special=include_special)
    if not pool:
        raise RuntimeError("shapes.json 无形状")
    sw = shape_weights or {}
    total = sum(sw.get(shape_category(s["id"]), 1.0) for s in pool)
    r = random.random() * total
    for s in pool:
        r -= sw.get(shape_category(s["id"]), 1.0)
        if r <= 0:
            return s
    return pool[0]
