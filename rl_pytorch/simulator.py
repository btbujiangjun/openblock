"""与 web/src/bot/simulator.js 对齐的无头对局。"""

from __future__ import annotations

import copy
import random
from .config import NORMAL_STRATEGY
from .grid import Grid
from .shapes_data import get_all_shapes, shape_category


def generate_blocks_for_grid(grid: Grid, strategy_config: dict) -> list[dict]:
    all_shapes = get_all_shapes()
    weights = strategy_config["shape_weights"]

    scored = []
    for shape in all_shapes:
        data = shape["data"]
        can = grid.can_place_anywhere(data)
        gap_fills = grid.count_gap_fills(data) if can else 0
        cat = shape_category(shape["id"])
        w = weights.get(cat, 1.0)
        scored.append({"shape": shape, "can_place": can, "gap_fills": gap_fills, "weight": w})

    scored = [s for s in scored if s["can_place"]]
    if not scored:
        return []

    scored.sort(key=lambda s: s["gap_fills"], reverse=True)
    blocks: list[dict] = []
    used_ids: set[str] = set()

    clear_candidates = [s for s in scored if s["gap_fills"] > 0]
    if clear_candidates:
        k = min(3, len(clear_candidates))
        pick = clear_candidates[random.randint(0, k - 1)]
        blocks.append(pick["shape"])
        used_ids.add(pick["shape"]["id"])

    remaining = [s for s in scored if s["shape"]["id"] not in used_ids]
    while len(blocks) < 3 and remaining:
        total_w = sum(s["weight"] for s in remaining)
        r = random.random() * total_w
        sel_i = 0
        for i, s in enumerate(remaining):
            r -= s["weight"]
            if r <= 0:
                sel_i = i
                break
        blocks.append(remaining[sel_i]["shape"])
        used_ids.add(remaining[sel_i]["shape"]["id"])
        remaining.pop(sel_i)

    for i in range(len(blocks) - 1, 0, -1):
        j = random.randint(0, i)
        blocks[i], blocks[j] = blocks[j], blocks[i]

    while len(blocks) < 3:
        blocks.append(random.choice(all_shapes))

    return blocks[:3]


class BlockBlastSimulator:
    def __init__(self, strategy_id: str = "normal"):
        self.strategy_id = strategy_id
        self.reset()

    def reset(self) -> None:
        cfg = NORMAL_STRATEGY
        self.strategy_config = cfg
        self.scoring = cfg["scoring"]
        self.grid = Grid(cfg["grid_width"])
        self.grid.init_board(cfg["fill_ratio"])
        self.score = 0
        self.total_clears = 0
        self.steps = 0
        self.placements = 0
        self._spawn_dock()

    def _spawn_dock(self) -> None:
        shapes = generate_blocks_for_grid(self.grid, self.strategy_config)
        colors = list(range(8))
        random.shuffle(colors)
        self.dock: list[dict] = []
        all_shapes = get_all_shapes()
        for i in range(3):
            shape = shapes[i] if i < len(shapes) else all_shapes[0]
            self.dock.append(
                {
                    "id": shape["id"],
                    "shape": copy.deepcopy(shape["data"]),
                    "color_idx": colors[i % len(colors)],
                    "placed": False,
                }
            )

    def get_legal_actions(self) -> list[dict[str, int]]:
        actions = []
        for bi, b in enumerate(self.dock):
            if b["placed"]:
                continue
            for gy in range(self.grid.size):
                for gx in range(self.grid.size):
                    if self.grid.can_place(b["shape"], gx, gy):
                        actions.append({"block_idx": bi, "gx": gx, "gy": gy})
        return actions

    def count_clears_if_placed(self, block_idx: int, gx: int, gy: int) -> int:
        b = self.dock[block_idx]
        sim = self.grid.clone()
        sim.place(b["shape"], b["color_idx"], gx, gy)
        return sim.check_lines()["count"]

    def is_terminal(self) -> bool:
        remaining = [b for b in self.dock if not b["placed"]]
        if not remaining:
            return False
        return not self.grid.has_any_move(self.dock)

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

        self.grid.place(b["shape"], b["color_idx"], gx, gy)
        self.placements += 1
        self.steps += 1

        result = self.grid.check_lines()
        gain = 0.0
        if result["count"] > 0:
            self.total_clears += result["count"]
            c = result["count"]
            s = self.scoring
            if c == 1:
                gain = float(s["single_line"])
            elif c == 2:
                gain = float(s["multi_line"])
            else:
                gain = float(s["combo"] + (c - 2) * s["multi_line"])
            self.score += gain

        b["placed"] = True
        if all(x["placed"] for x in self.dock):
            self._spawn_dock()

        return gain
