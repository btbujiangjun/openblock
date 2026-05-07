"""
SQLAlchemy 2.0 ORM models for the user service.

These coexist with `services/user_service/models.py` (the legacy
hand-rolled BaseModel). New code should prefer ORM models; the legacy
class remains for callers we haven't migrated yet.

Schema decisions:
  - `id` is a UUID (string) — keeps clients SDK-friendly across
    languages and stays compatible with the in-memory repo.
  - All audit timestamps default to UTC `datetime.now(timezone.utc)`
    (UTC-aware, no naive datetimes ever stored).
  - `password_hash` is intentionally `nullable=False` and we never
    store the plaintext.
  - `is_active` / `is_premium` are bool flags carried over from legacy.
  - `profile_data` is JSONB on Postgres / TEXT on SQLite.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..common.orm import Base


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _uuid4() -> str:
    return str(uuid.uuid4())


class UserOrm(Base):
    """`users` table."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now_utc, onupdate=_now_utc, nullable=False
    )
    last_login: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    profile_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sessions: Mapped[list["SessionOrm"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "password_hash": self.password_hash,
            "is_active": self.is_active,
            "is_premium": self.is_premium,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "profile_data": json.loads(self.profile_data) if self.profile_data else {},
        }


class SessionOrm(Base):
    """`user_sessions` table — refresh-token tracking for revocation.

    Rows are inserted on /api/auth/login and deleted on /api/auth/logout.
    Used by the JWT revocation store backend in v1.16+; in v1.15 it's
    schema only.
    """

    __tablename__ = "user_sessions"
    __table_args__ = (UniqueConstraint("jti", name="uq_user_sessions_jti"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid4)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jti: Mapped[str] = mapped_column(String(36), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now_utc, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[UserOrm] = relationship(back_populates="sessions")
