"""Alembic env script.

Hooks all `services/*/orm_models.py` modules into `Base.metadata` so
autogenerate can see every table without per-service env files.

Online mode reads `DATABASE_URL` env (preferred) and falls back to
`sqlalchemy.url` from alembic.ini.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

# Make sure `services` package is importable regardless of where alembic
# is launched from (CI runs it from repo root; developers may cd around).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from alembic import context
from sqlalchemy import engine_from_config, pool

from services.common.orm import Base

# Import every ORM model module so its mapped classes register with Base.
# Add new model modules here as services grow; CI's alembic-check job
# fails autogenerate diff if a new model is missing.
import services.user_service.orm_models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Env override beats the static config value.
db_url = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
config.set_main_option("sqlalchemy.url", db_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Generate SQL without DB connection (e.g. for review)."""
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations to a live DB."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
