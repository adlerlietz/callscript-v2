"""Core module for CallScript V2 workers."""

from .config import Settings, get_settings
from .logger import setup_logging
from .models import (
    load_asr_model,
    load_diarization_pipeline,
    verify_gpu_available,
    get_gpu_memory_free,
    check_memory_for_processing,
    get_audio_duration,
    transcribe,
    diarize,
)
from .db import CallsRepository, create_repository
from .circuit_breaker import (
    CircuitBreaker,
    CircuitOpenError,
    CircuitState,
    get_circuit,
    get_all_circuit_stats,
)

__all__ = [
    # Config
    "Settings",
    "get_settings",
    # Logging
    "setup_logging",
    # Models
    "load_asr_model",
    "load_diarization_pipeline",
    "verify_gpu_available",
    "get_gpu_memory_free",
    "check_memory_for_processing",
    "get_audio_duration",
    "transcribe",
    "diarize",
    # Database
    "CallsRepository",
    "create_repository",
    # Circuit Breaker
    "CircuitBreaker",
    "CircuitOpenError",
    "CircuitState",
    "get_circuit",
    "get_all_circuit_stats",
]
