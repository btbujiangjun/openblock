"""
common/ - Shared utilities for microservices
"""

from .config import ServiceConfig
from .database import (
    DatabaseManager,
    get_postgres_db,
    get_redis_client,
    init_db_manager,
    init_redis_manager,
)
from .models import BaseModel
from .exceptions import ServiceException, ValidationException, NotFoundException
from .logging import setup_logging, get_logger

__all__ = [
    "ServiceConfig",
    "DatabaseManager",
    "get_postgres_db",
    "get_redis_client",
    "init_db_manager",
    "init_redis_manager",
    "BaseModel",
    "ServiceException",
    "ValidationException",
    "NotFoundException",
    "setup_logging",
    "get_logger",
]
