"""
Microservices for Open Block Backend

Services:
- user_service: User management, authentication, profiles
- game_service: Game sessions, leaderboards, achievements, levels
- analytics_service: Event tracking, retention, funnels, revenue
- monitoring: Metrics, alerts, anomaly detection
- security: Signing, rate limiting, encryption, payment verification

Usage:
    from services import create_user_service, create_game_service, create_analytics_service

    user_app = create_user_service()
    game_app = create_game_service()
    analytics_app = create_analytics_service()
    monitoring_app = create_metrics_app()
"""

from .user_service import create_app as create_user_service
from .game_service import create_app as create_game_service
from .analytics_service import create_app as create_analytics_service
from .monitoring import (
    create_metrics_app,
    MetricsCollector,
    AnomalyDetector,
    AlertManager,
)
from .security import (
    RequestSigner,
    verify_request_signature,
    create_signed_request,
    RateLimiter,
    check_rate_limit,
    get_rate_limit_info,
    PaymentVerifier,
    verify_payment_callback,
    DataEncryptor,
    encrypt_sensitive_data,
    decrypt_sensitive_data,
    TokenGenerator,
    PasswordHasher,
    DataMasker,
)

__all__ = [
    "create_user_service",
    "create_game_service",
    "create_analytics_service",
    "create_metrics_app",
    "MetricsCollector",
    "AnomalyDetector",
    "AlertManager",
    "RequestSigner",
    "verify_request_signature",
    "create_signed_request",
    "RateLimiter",
    "check_rate_limit",
    "get_rate_limit_info",
    "PaymentVerifier",
    "verify_payment_callback",
    "DataEncryptor",
    "encrypt_sensitive_data",
    "decrypt_sensitive_data",
    "TokenGenerator",
    "PasswordHasher",
    "DataMasker",
]

VERSION = "1.0.0"
