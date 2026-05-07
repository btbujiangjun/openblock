"""
Database connection managers - PostgreSQL and Redis
"""

import os
import json
from contextlib import contextmanager
from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)


class DatabaseManager:
    """PostgreSQL connection manager"""

    _instance = None

    def __init__(self, config=None):
        self.config = config
        self._pool = None

    @classmethod
    def get_instance(cls, config=None):
        if cls._instance is None:
            cls._instance = cls(config)
        return cls._instance

    def connect(self):
        """Create connection pool"""
        try:
            import psycopg2
            from psycopg2 import pool

            self._pool = pool.ThreadedConnectionPool(
                minconn=2,
                maxconn=10,
                host=self.config.database.host,
                port=self.config.database.port,
                database=self.config.database.database,
                user=self.config.database.user,
                password=self.config.database.password,
            )
            logger.info("PostgreSQL connection pool created")
        except ImportError:
            logger.warning("psycopg2 not installed, falling back to SQLite")
            self._pool = None

    @contextmanager
    def get_connection(self):
        """Get a connection from pool"""
        if self._pool is None:
            raise Exception("Database pool not initialized")

        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            self._pool.putconn(conn)

    def execute_query(self, query: str, params: tuple = None):
        """Execute a query and return results"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or ())
            if cursor.description:
                columns = [desc[0] for desc in cursor.description]
                results = cursor.fetchall()
                return [dict(zip(columns, row)) for row in results]
            return []

    def execute_one(self, query: str, params: tuple = None):
        """Execute a query and return single result"""
        results = self.execute_query(query, params)
        return results[0] if results else None

    def close(self):
        """Close all connections"""
        if self._pool:
            self._pool.closeall()


class RedisManager:
    """Redis client manager"""

    _instance = None

    def __init__(self, config=None):
        self.config = config
        self._client = None

    @classmethod
    def get_instance(cls, config=None):
        if cls._instance is None:
            cls._instance = cls(config)
        return cls._instance

    def connect(self):
        """Connect to Redis"""
        try:
            import redis

            self._client = redis.Redis(
                host=self.config.redis.host,
                port=self.config.redis.port,
                password=self.config.redis.password,
                db=self.config.redis.db,
                decode_responses=True,
            )
            self._client.ping()
            logger.info("Redis connection established")
        except ImportError:
            logger.warning("redis-py not installed")
            self._client = None
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")
            self._client = None

    def get_client(self):
        """Get Redis client"""
        return self._client

    def get(self, key: str) -> Optional[str]:
        """Get value by key"""
        if not self._client:
            return None
        return self._client.get(key)

    def set(self, key: str, value: str, expire: int = None):
        """Set key-value with optional expiration"""
        if not self._client:
            return False
        if expire:
            return self._client.setex(key, expire, value)
        return self._client.set(key, value)

    def delete(self, key: str):
        """Delete key"""
        if not self._client:
            return False
        return self._client.delete(key)

    def get_json(self, key: str) -> Optional[dict]:
        """Get JSON value"""
        value = self.get(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return None
        return None

    def set_json(self, key: str, value: dict, expire: int = None):
        """Set JSON value"""
        return self.set(key, json.dumps(value), expire)

    def incr(self, key: str) -> int:
        """Increment counter"""
        if not self._client:
            return 0
        return self._client.incr(key)

    def zadd(self, key: str, mapping: dict):
        """Add to sorted set"""
        if not self._client:
            return False
        return self._client.zadd(key, mapping)

    def zrevrange(self, key: str, start: int, end: int, withscores: bool = True):
        """Get sorted set range"""
        if not self._client:
            return []
        return self._client.zrevrange(key, start, end, withscores=withscores)

    def zrank(self, key: str, member: str):
        """Get member rank in sorted set"""
        if not self._client:
            return None
        return self._client.zrank(key, member)

    def close(self):
        """Close Redis connection"""
        if self._client:
            self._client.close()


_db_manager = None
_redis_manager = None


def init_db_manager(config):
    global _db_manager
    _db_manager = DatabaseManager.get_instance(config)
    _db_manager.connect()
    return _db_manager


def init_redis_manager(config):
    global _redis_manager
    _redis_manager = RedisManager.get_instance(config)
    _redis_manager.connect()
    return _redis_manager


def get_postgres_db():
    """Get PostgreSQL database manager"""
    return _db_manager


def get_redis_client():
    """Get Redis client"""
    if _redis_manager:
        return _redis_manager.get_client()
    return None
