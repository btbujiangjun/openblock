"""
Analytics Service - Handles event tracking, retention, funnels, revenue
"""

from .app import create_app
from .models import Event, UserActivity, Revenue

__all__ = ["create_app", "Event", "UserActivity", "Revenue"]
