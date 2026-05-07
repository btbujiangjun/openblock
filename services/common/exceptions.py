"""
Service exceptions
"""


class ServiceException(Exception):
    """Base service exception"""

    def __init__(self, message: str, code: int = 500):
        self.message = message
        self.code = code
        super().__init__(message)


class ValidationException(ServiceException):
    """Validation error"""

    def __init__(self, message: str):
        super().__init__(message, 400)


class NotFoundException(ServiceException):
    """Resource not found"""

    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, 404)


class UnauthorizedException(ServiceException):
    """Unauthorized access"""

    def __init__(self, message: str = "Unauthorized"):
        super().__init__(message, 401)


class ForbiddenException(ServiceException):
    """Forbidden access"""

    def __init__(self, message: str = "Forbidden"):
        super().__init__(message, 403)


class ConflictException(ServiceException):
    """Resource conflict"""

    def __init__(self, message: str = "Resource conflict"):
        super().__init__(message, 409)


class ExternalServiceException(ServiceException):
    """External service error"""

    def __init__(self, message: str, service: str):
        self.service = service
        super().__init__(f"{service}: {message}", 502)
