"""
Analytics service database models
"""

from datetime import datetime
from ..common.models import BaseModel


class Event(BaseModel):
    table_name = "analytics_events"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        event_type: str = None,
        event_data: dict = None,
        timestamp: datetime = None,
        session_id: str = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=timestamp)
        self.user_id = user_id
        self.event_type = event_type
        self.event_data = event_data or {}
        self.timestamp = timestamp
        self.session_id = session_id


class UserActivity(BaseModel):
    table_name = "user_activities"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        date: str = None,
        active_minutes: int = 0,
        sessions_count: int = 0,
        total_score: int = 0,
        retention_d1: bool = False,
        retention_d7: bool = False,
        retention_d30: bool = False,
        **kwargs,
    ):
        super().__init__(id=id)
        self.user_id = user_id
        self.date = date
        self.active_minutes = active_minutes
        self.sessions_count = sessions_count
        self.total_score = total_score
        self.retention_d1 = retention_d1
        self.retention_d7 = retention_d7
        self.retention_d30 = retention_d30


class Revenue(BaseModel):
    table_name = "revenue"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        amount: float = 0,
        currency: str = "USD",
        product_id: str = None,
        purchase_date: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=purchase_date)
        self.user_id = user_id
        self.amount = amount
        self.currency = currency
        self.product_id = product_id
        self.purchase_date = purchase_date
