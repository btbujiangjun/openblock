"""
SQLAlchemy-backed `UserRepository` implementation.

Same interface as `_MemoryRepo` so the route layer is agnostic. Used
when `USE_POSTGRES=true` (or when tests pass an explicit engine bound
to SQLite in-memory).
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from ..common.orm import Base, make_sessionmaker, session_scope
from .orm_models import UserOrm


class SqlUserRepository:
    """Persistent repository for `UserOrm`."""

    def __init__(self, engine: Engine):
        self._engine = engine
        self._SessionLocal = make_sessionmaker(engine)

    def create_schema(self) -> None:
        """Create all tables. Tests / first boot only; production uses Alembic."""
        Base.metadata.create_all(self._engine)

    def create(self, *, username: str, email: str, password_hash: str) -> dict:
        with session_scope(self._SessionLocal) as session:
            user = UserOrm(
                username=username, email=email, password_hash=password_hash
            )
            session.add(user)
            try:
                session.flush()  # surface IntegrityError before commit
            except IntegrityError as exc:
                # Surface the same ValueError that _MemoryRepo raises so
                # the route handler maps it to a 409 generically.
                raise ValueError("username already exists") from exc
            return user.to_dict()

    def get_by_username(self, username: str) -> Optional[dict]:
        with session_scope(self._SessionLocal) as session:
            user = (
                session.query(UserOrm)
                .filter(UserOrm.username == username)
                .first()
            )
            return user.to_dict() if user else None

    def get_by_id(self, user_id: str) -> Optional[dict]:
        with session_scope(self._SessionLocal) as session:
            user = session.get(UserOrm, user_id)
            return user.to_dict() if user else None
