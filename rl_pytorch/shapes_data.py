"""与 web/src/shapes.js 一致的多连块定义。"""

SHAPES = {
    "lines": [
        {"id": "1x4", "category": "lines", "data": [[1, 1, 1, 1]]},
        {"id": "4x1", "category": "lines", "data": [[1], [1], [1], [1]]},
    ],
    "squares": [
        {"id": "2x2", "category": "squares", "data": [[1, 1], [1, 1]]},
        {"id": "3x3", "category": "squares", "data": [[1, 1, 1], [1, 1, 1], [1, 1, 1]]},
    ],
    "tshapes": [
        {"id": "t-up", "category": "tshapes", "data": [[1, 1, 1], [0, 1, 0]]},
        {"id": "t-down", "category": "tshapes", "data": [[0, 1, 0], [1, 1, 1]]},
        {"id": "t-left", "category": "tshapes", "data": [[0, 1], [1, 1], [0, 1]]},
        {"id": "t-right", "category": "tshapes", "data": [[1, 0], [1, 1], [1, 0]]},
    ],
    "zshapes": [
        {"id": "z-h", "category": "zshapes", "data": [[1, 1, 0], [0, 1, 1]]},
        {"id": "z-h2", "category": "zshapes", "data": [[0, 1, 1], [1, 1, 0]]},
        {"id": "z-v", "category": "zshapes", "data": [[0, 1], [1, 1], [1, 0]]},
        {"id": "z-v2", "category": "zshapes", "data": [[1, 0], [1, 1], [0, 1]]},
    ],
    "lshapes": [
        {"id": "l-1", "category": "lshapes", "data": [[1, 0], [1, 0], [1, 1]]},
        {"id": "l-2", "category": "lshapes", "data": [[1, 1, 1], [1, 0, 0]]},
        {"id": "l-3", "category": "lshapes", "data": [[1, 1], [0, 1], [0, 1]]},
        {"id": "l-4", "category": "lshapes", "data": [[0, 0, 1], [1, 1, 1]]},
    ],
    "jshapes": [
        {"id": "j-1", "category": "jshapes", "data": [[0, 1], [0, 1], [1, 1]]},
        {"id": "j-2", "category": "jshapes", "data": [[1, 0, 0], [1, 1, 1]]},
        {"id": "j-3", "category": "jshapes", "data": [[1, 1], [1, 0], [1, 0]]},
        {"id": "j-4", "category": "jshapes", "data": [[1, 1, 1], [0, 0, 1]]},
    ],
}


def get_all_shapes():
    order = ["lines", "squares", "tshapes", "zshapes", "lshapes", "jshapes"]
    out = []
    for k in order:
        out.extend(SHAPES[k])
    return out


def shape_category(shape_id: str) -> str:
    for shapes in SHAPES.values():
        for s in shapes:
            if s["id"] == shape_id:
                return s["category"]
    return "squares"
