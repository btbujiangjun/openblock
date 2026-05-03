"""与 web/src/grid.js 核心规则一致：落子、满行/列消除。"""

from __future__ import annotations

import random
from .shapes_data import pick_random_shape_weighted


class Grid:
    def __init__(self, size: int = 8):
        self.size = size
        self.cells: list[list[int | None]] = self._empty()

    def _empty(self) -> list[list[int | None]]:
        return [[None] * self.size for _ in range(self.size)]

    def clear(self) -> None:
        self.cells = self._empty()

    def clone(self) -> Grid:
        g = Grid(self.size)
        for y in range(self.size):
            for x in range(self.size):
                g.cells[y][x] = self.cells[y][x]
        return g

    def can_place(self, shape: list[list[int]], gx: int, gy: int) -> bool:
        for y, row in enumerate(shape):
            for x, v in enumerate(row):
                if v:
                    nx, ny = gx + x, gy + y
                    if nx < 0 or nx >= self.size or ny < 0 or ny >= self.size:
                        return False
                    if self.cells[ny][nx] is not None:
                        return False
        return True

    def place(self, shape: list[list[int]], color_idx: int, gx: int, gy: int) -> None:
        for y, row in enumerate(shape):
            for x, v in enumerate(row):
                if v:
                    self.cells[gy + y][gx + x] = color_idx

    def check_lines(self, bonus_block_icons: list[str] | None = None) -> dict:
        full_rows: list[int] = []
        full_cols: list[int] = []
        for y in range(self.size):
            if all(c is not None for c in self.cells[y]):
                full_rows.append(y)
        for x in range(self.size):
            if all(self.cells[y][x] is not None for y in range(self.size)):
                full_cols.append(x)

        def line_is_bonus_mono(vals: list[int | None]) -> bool:
            if not vals or vals[0] is None:
                return False
            first = vals[0]
            if bonus_block_icons:
                bi = bonus_block_icons

                def gi(ci: int) -> str:
                    return str(bi[int(ci) % len(bi)])

                icon0 = gi(int(first))
                return all(v is not None and gi(int(v)) == icon0 for v in vals)
            return all(c == first for c in vals)

        bonus_lines: list[dict] = []
        for y in full_rows:
            row = self.cells[y]
            if line_is_bonus_mono(row):
                bonus_lines.append({"type": "row", "idx": y, "color_idx": row[0]})
        for x in full_cols:
            col = [self.cells[yy][x] for yy in range(self.size)]
            if col[0] is None:
                continue
            if line_is_bonus_mono(col):
                bonus_lines.append({"type": "col", "idx": x, "color_idx": col[0]})

        cleared_cells: list[dict] = []
        seen: set[str] = set()
        for y in full_rows:
            for x in range(self.size):
                k = f"{x},{y}"
                if k not in seen:
                    seen.add(k)
                    cleared_cells.append({"x": x, "y": y, "color": self.cells[y][x]})
        for x in full_cols:
            for y in range(self.size):
                k = f"{x},{y}"
                if k not in seen:
                    seen.add(k)
                    cleared_cells.append({"x": x, "y": y, "color": self.cells[y][x]})

        for y in full_rows:
            for x in range(self.size):
                self.cells[y][x] = None
        for x in full_cols:
            for y in range(self.size):
                self.cells[y][x] = None

        count = len(full_rows) + len(full_cols)
        return {"count": count, "cells": cleared_cells, "bonus_lines": bonus_lines}

    def has_any_move(self, blocks: list[dict]) -> bool:
        for b in blocks:
            if not b or b.get("placed"):
                continue
            shape = b["shape"]
            for gy in range(self.size):
                for gx in range(self.size):
                    if self.can_place(shape, gx, gy):
                        return True
        return False

    def can_place_anywhere(self, shape_data: list[list[int]]) -> bool:
        for gy in range(self.size):
            for gx in range(self.size):
                if self.can_place(shape_data, gx, gy):
                    return True
        return False

    def would_clear(self, shape_data: list[list[int]], gx: int, gy: int) -> bool:
        temp = [row[:] for row in self.cells]
        for y, row in enumerate(shape_data):
            for x, v in enumerate(row):
                if v:
                    temp[gy + y][gx + x] = 1
        for y in range(self.size):
            if all(c is not None for c in temp[y]):
                return True
        for x in range(self.size):
            if all(temp[y][x] is not None for y in range(self.size)):
                return True
        return False

    def find_gap_positions(self) -> list[dict]:
        gaps: list[dict] = []
        for y in range(self.size):
            positions = [{"x": x, "y": y} for x in range(self.size) if self.cells[y][x] is None]
            empty = len(positions)
            if 1 <= empty <= 4:
                gaps.append({"type": "row", "y": y, "empty": empty, "positions": positions})
        for x in range(self.size):
            positions = [{"x": x, "y": y} for y in range(self.size) if self.cells[y][x] is None]
            empty = len(positions)
            if 1 <= empty <= 4:
                gaps.append({"type": "col", "x": x, "empty": empty, "positions": positions})
        gaps.sort(key=lambda g: g["empty"])
        return gaps

    def count_gap_fills(self, shape_data: list[list[int]]) -> int:
        fills = 0
        for gap in self.find_gap_positions():
            for pos in gap["positions"]:
                if self.can_place(shape_data, pos["x"], pos["y"]):
                    fills += max(1, 4 - gap["empty"])
                    break
        return fills

    def init_board(self, fill_ratio: float, shape_weights: dict[str, float] | None = None) -> None:
        self.clear()
        placed_cells = 0
        target = int(self.size * self.size * fill_ratio)
        for _ in range(100):
            if placed_cells >= target:
                break
            shape = pick_random_shape_weighted(shape_weights)
            data = shape["data"]
            w, h = len(data[0]), len(data)
            x = random.randint(0, max(0, self.size - w))
            y = random.randint(0, max(0, self.size - h))
            if self.can_place(data, x, y) and not self.would_clear(data, x, y):
                color = random.randint(0, 7)
                self.place(data, color, x, y)
                placed_cells += sum(1 for row in data for c in row if c)
