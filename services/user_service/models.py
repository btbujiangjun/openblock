"""
User service database models
"""

from datetime import datetime
from typing import Optional
from ..common.models import BaseModel


class User(BaseModel):
    table_name = "users"

    def __init__(
        self,
        id: str = None,
        username: str = None,
        email: str = None,
        password_hash: str = None,
        created_at: datetime = None,
        updated_at: datetime = None,
        last_login: datetime = None,
        is_active: bool = True,
        is_premium: bool = False,
        profile_data: dict = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=created_at, updated_at=updated_at)
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.last_login = last_login
        self.is_active = is_active
        self.is_premium = is_premium
        self.profile_data = profile_data or {}


class UserProfile(BaseModel):
    table_name = "user_profiles"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        display_name: str = None,
        avatar_url: str = None,
        bio: str = None,
        settings: dict = None,
        preferences: dict = None,
        created_at: datetime = None,
        updated_at: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=created_at, updated_at=updated_at)
        self.user_id = user_id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.bio = bio
        self.settings = settings or {}
        self.preferences = preferences or {}


class FriendRelationship(BaseModel):
    table_name = "friend_relationships"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        friend_id: str = None,
        status: str = "pending",
        created_at: datetime = None,
        updated_at: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=created_at, updated_at=updated_at)
        self.user_id = user_id
        self.friend_id = friend_id
        self.status = status


class Session(BaseModel):
    table_name = "sessions"

    def __init__(
        self,
        id: str = None,
        user_id: str = None,
        token: str = None,
        refresh_token: str = None,
        expires_at: datetime = None,
        created_at: datetime = None,
        updated_at: datetime = None,
        **kwargs,
    ):
        super().__init__(id=id, created_at=created_at, updated_at=updated_at)
        self.user_id = user_id
        self.token = token
        self.refresh_token = refresh_token
        self.expires_at = expires_at
