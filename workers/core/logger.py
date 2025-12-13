"""
CallScript V2 - Logging Configuration

Configures structured logging to stdout and file.
"""

import logging
import sys
from pathlib import Path


def setup_logging(
    name: str,
    log_file: str,
    level: str = "INFO",
) -> logging.Logger:
    """
    Configure logging to stdout and file.

    Args:
        name: Logger name (e.g., "worker", "judge")
        log_file: Full path to log file
        level: Log level (DEBUG, INFO, WARNING, ERROR)

    Returns:
        Configured logger instance
    """
    # Ensure log directory exists
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # Create logger
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Prevent duplicate handlers on repeated calls
    if logger.handlers:
        return logger

    # Format: timestamp [LEVEL] message
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File handler (append mode)
    file_handler = logging.FileHandler(log_file, mode="a", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)  # Capture everything in file
    file_handler.setFormatter(formatter)

    # Stdout handler
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(getattr(logging, level.upper(), logging.INFO))
    stdout_handler.setFormatter(formatter)

    # Add handlers
    logger.addHandler(file_handler)
    logger.addHandler(stdout_handler)

    return logger


def get_worker_logger(log_file: str = "/workspace/worker.log", level: str = "INFO"):
    """Get logger configured for Factory Lane worker."""
    return setup_logging("worker", log_file, level)


def get_judge_logger(log_file: str = "/workspace/judge.log", level: str = "INFO"):
    """Get logger configured for Judge Lane worker."""
    return setup_logging("judge", log_file, level)
