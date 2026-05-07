"""
Service configuration - loads from environment variables
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class DatabaseConfig:
    host: str = os.getenv("POSTGRES_HOST", "localhost")
    port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    database: str = os.getenv("POSTGRES_DB", "openblock")
    user: str = os.getenv("POSTGRES_USER", "postgres")
    password: str = os.getenv("POSTGRES_PASSWORD", "postgres")

    @property
    def url(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


@dataclass
class RedisConfig:
    host: str = os.getenv("REDIS_HOST", "localhost")
    port: int = int(os.getenv("REDIS_PORT", "6379"))
    password: Optional[str] = os.getenv("REDIS_PASSWORD")
    db: int = int(os.getenv("REDIS_DB", "0"))

    @property
    def url(self) -> str:
        if self.password:
            return f"redis://:{self.password}@{self.host}:{self.port}/{self.db}"
        return f"redis://{self.host}:{self.port}/{self.db}"


@dataclass
class CDNConfig:
    enabled: bool = os.getenv("CDN_ENABLED", "false").lower() == "true"
    base_url: str = os.getenv("CDN_BASE_URL", "")
    assets_path: str = os.getenv("CDN_ASSETS_PATH", "/assets")


@dataclass
class ServiceConfig:
    name: str = "service"
    host: str = os.getenv("SERVICE_HOST", "0.0.0.0")
    port: int = int(os.getenv("SERVICE_PORT", "8080"))
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"

    database: DatabaseConfig = None
    redis: RedisConfig = None
    cdn: CDNConfig = None

    def __post_init__(self):
        if self.database is None:
            self.database = DatabaseConfig()
        if self.redis is None:
            self.redis = RedisConfig()
        if self.cdn is None:
            self.cdn = CDNConfig()

    @classmethod
    def for_service(cls, name: str):
        return cls(
            name=name, database=DatabaseConfig(), redis=RedisConfig(), cdn=CDNConfig()
        )
