"""
Logging configuration
"""

import logging
import sys
from typing import Optional


def setup_logging(
    level: str = "INFO", format_string: Optional[str] = None
) -> logging.Logger:
    """Setup logging configuration"""

    if format_string is None:
        format_string = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format=format_string,
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    return logging.getLogger()


def get_logger(name: str) -> logging.Logger:
    """Get logger for module"""
    return logging.getLogger(name)
