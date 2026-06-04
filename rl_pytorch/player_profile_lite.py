"""RL 训练用玩家画像轻量镜像（与 PlayerProfile.toJSON/fromJSON 兼容）。"""

from __future__ import annotations

import time
from typing import Any


class PlayerProfileLite:
    def __init__(self) -> None:
        self._smooth_skill = 0.5
        self._total_lifetime_placements = 0
        self._total_lifetime_games = 0
        self._session_history: list[dict] = []
        self._spawn_counter = 0
        self._session_start_ts = int(time.time() * 1000)
        self._last_action_ts = 0
        self._consecutive_non_clears = 0
        self._moves: list[dict] = []

    def record_new_game(self) -> None:
        self._spawn_counter = 0
        self._session_start_ts = int(time.time() * 1000)
        self._consecutive_non_clears = 0
        self._moves.clear()
        self._last_action_ts = self._session_start_ts

    def record_spawn(self) -> None:
        self._last_action_ts = int(time.time() * 1000)
        self._spawn_counter += 1

    def record_place(self, cleared: bool, lines_cleared: int, board_fill: float) -> None:
        now = int(time.time() * 1000)
        think_ms = min(max(now - self._last_action_ts, 0), 60_000) if self._last_action_ts else 2500
        self._moves.append(
            {
                "ts": now,
                "thinkMs": think_ms,
                "pickToPlaceMs": None,
                "cleared": bool(cleared),
                "lines": int(lines_cleared),
                "fill": float(board_fill),
                "miss": False,
            }
        )
        self._moves = self._moves[-15:]
        self._last_action_ts = now
        self._total_lifetime_placements += 1
        if cleared:
            self._consecutive_non_clears = 0
            alpha = 0.15
            target = min(1.0, 0.45 + 0.08 * lines_cleared)
        else:
            self._consecutive_non_clears += 1
            alpha = 0.08
            target = max(0.0, 0.5 - 0.03 * self._consecutive_non_clears)
        self._smooth_skill = (1 - alpha) * self._smooth_skill + alpha * target

    def to_json(self) -> dict[str, Any]:
        return {
            "smoothSkill": self._smooth_skill,
            "totalLifetimePlacements": self._total_lifetime_placements,
            "totalLifetimeGames": self._total_lifetime_games,
            "sessionHistory": list(self._session_history[-30:]),
            "savedAt": int(time.time() * 1000),
        }

    @classmethod
    def from_json(cls, data: dict | None) -> PlayerProfileLite:
        p = cls()
        if not data:
            return p
        if data.get("smoothSkill") is not None:
            p._smooth_skill = float(data["smoothSkill"])
        if data.get("totalLifetimePlacements") is not None:
            p._total_lifetime_placements = int(data["totalLifetimePlacements"])
        if data.get("totalLifetimeGames") is not None:
            p._total_lifetime_games = int(data["totalLifetimeGames"])
        if isinstance(data.get("sessionHistory"), list):
            p._session_history = list(data["sessionHistory"][-30:])
        return p
