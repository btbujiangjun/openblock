"""
Game service database models
"""

from datetime import datetime
from ..common.models import BaseModel


class GameSession(BaseModel):
    table_name = "game_sessions"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        mode: str = "endless",
        started_at: datetime = None,
        ended_at: datetime = None,
        score: int = 0,
        clears: int = 0,
        max_combo: int = 0,
        blocks_placed: int = 0,
        game_data: dict = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=started_at, updated_at=ended_at)
        self.user_id = user_id
        self.mode = mode
        self.started_at = started_at
        self.ended_at = ended_at
        self.score = score
        self.clears = clears
        self.max_combo = max_combo
        self.blocks_placed = blocks_placed
        self.game_data = game_data or {}


class Leaderboard(BaseModel):
    table_name = "leaderboards"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        score: int = 0,
        clears: int = 0,
        mode: str = "global",
        period: str = "all_time",
        rank: int = 0,
        created_at: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=created_at)
        self.user_id = user_id
        self.score = score
        self.clears = clears
        self.mode = mode
        self.period = period
        self.rank = rank


class Achievement(BaseModel):
    table_name = "achievements"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        achievement_id: str = None,
        unlocked_at: datetime = None,
        progress: int = 0,
        completed: bool = False,
        **kwargs,
    ):
        super().__init__(id=id, created_at=unlocked_at)
        self.user_id = user_id
        self.achievement_id = achievement_id
        self.unlocked_at = unlocked_at
        self.progress = progress
        self.completed = completed


class LevelProgress(BaseModel):
    table_name = "level_progress"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        level_id: str = None,
        stars: int = 0,
        best_score: int = 0,
        attempts: int = 0,
        completed: bool = False,
        completed_at: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=completed_at)
        self.user_id = user_id
        self.level_id = level_id
        self.stars = stars
        self.best_score = best_score
        self.attempts = attempts
        self.completed = completed
        self.completed_at = completed_at
