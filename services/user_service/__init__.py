"""
User Service - Handles user management, authentication, profiles
"""

from .app import create_app
from .models import User, UserProfile, FriendRelationship, Session

__all__ = ["create_app", "User", "UserProfile", "FriendRelationship", "Session"]
