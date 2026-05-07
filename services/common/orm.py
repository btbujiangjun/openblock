"""
orm.py — SQLAlchemy 2.0 base + engine factory.

This module replaces the hand-rolled raw-SQL `BaseModel.save()` /
`find_by_id()` from `services/common/models.py`. The legacy module is
kept around for any code path that still uses it; new repositories
should import from here.

Design:
  - Single `Base` (DeclarativeBase) shared across services so Alembic
    autogenerate can see every model.
  - `build_engine()` reads env vars and constructs an engine for either
    SQLite (default; no creds) or Postgres. SQLite is used by tests so
    the suite doesn't require a running DB.
  - `session_scope()` is the standard "with"-block transactional
    boundary so call-sites don't forget to commit/rollback.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    """Shared declarative base for every services/* ORM model."""


def build_engine(url: Optional[str] = None, *, echo: Optional[bool] = None) -> Engine:
    """Build a SQLAlchemy engine using env vars or an explicit `url`.

    Resolution order for `url`:
      1. Argument
      2. `DATABASE_URL` env (libpq-style URL)
      3. Postgres composed from POSTGRES_* envs
      4. SQLite in-memory (tests / first boot)
    """
    if url is None:
        url = os.getenv("DATABASE_URL")

    if url is None:
        host = os.getenv("POSTGRES_HOST")
        if host:
            user = os.getenv("POSTGRES_USER", "openblock")
            pw = os.getenv("POSTGRES_PASSWORD", "")
            db = os.getenv("POSTGRES_DB", "openblock")
            port = os.getenv("POSTGRES_PORT", "5432")
            url = f"postgresql+psycopg2://{user}:{pw}@{host}:{port}/{db}"
        else:
            url = "sqlite:///:memory:"

    echo_flag = (
        echo
        if echo is not None
        else os.getenv("SQLALCHEMY_ECHO", "0").lower() in ("1", "true", "yes", "on")
    )
    # `future=True` unlocks SQLAlchemy 2.0 style; default in 2.x but
    # set explicitly so behaviour is stable across versions.
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, echo=echo_flag, future=True, connect_args=connect_args)


def make_sessionmaker(engine: Engine):
    """Return a sessionmaker bound to `engine`. Idempotent for tests."""
    return sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        future=True,
    )


@contextmanager
def session_scope(SessionLocal) -> Iterator[Session]:
    """Standard transactional boundary.

    Usage:
        with session_scope(SessionLocal) as s:
            s.add(obj)
    """
    session: Session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
