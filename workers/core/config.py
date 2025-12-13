"""
CallScript V2 - Configuration Management

Single source of truth for all environment variables and model settings.
Uses pydantic-settings for validation and type safety.
"""

from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Required secrets will cause app to crash if missing.
    Model configs are locked to known working values.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # =========================================================================
    # SECRETS (Required)
    # =========================================================================

    supabase_url: str = Field(
        ...,
        description="Supabase project URL",
    )

    supabase_service_role_key: str = Field(
        ...,
        alias="SUPABASE_SERVICE_ROLE_KEY",
        description="Supabase service role key (admin access)",
    )

    hf_token: str = Field(
        ...,
        description="HuggingFace token for Pyannote access",
    )

    openai_api_key: Optional[str] = Field(
        default=None,
        description="OpenAI API key (required for Judge Lane only)",
    )

    # =========================================================================
    # PATHS
    # =========================================================================

    tmp_dir: str = Field(
        default="/workspace/tmp",
        description="Temporary directory for audio processing",
    )

    log_dir: str = Field(
        default="/workspace",
        description="Directory for log files",
    )

    # =========================================================================
    # MODEL CONFIGS (Locked to working values - DO NOT CHANGE)
    # =========================================================================

    asr_model: str = Field(
        default="nvidia/parakeet-tdt-0.6b-v2",
        description="NeMo ASR model name (TDT architecture)",
    )

    diarization_model: str = Field(
        default="pyannote/speaker-diarization-3.1",
        description="Pyannote diarization pipeline",
    )

    # CRITICAL: Beam decoding fixes CUDA graph failures on RTX 3090
    decoding_strategy: str = Field(
        default="beam",
        description="TDT decoding strategy (beam fixes CUDA issues)",
    )

    beam_size: int = Field(
        default=1,
        ge=1,
        le=10,
        description="Beam search width (1 = greedy-equivalent but stable)",
    )

    # =========================================================================
    # WORKER SETTINGS
    # =========================================================================

    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR)",
    )

    max_retries: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Maximum retry attempts before marking call as failed",
    )

    poll_interval: float = Field(
        default=1.0,
        ge=0.5,
        le=10.0,
        description="Seconds to wait when queue is empty",
    )

    # =========================================================================
    # JUDGE SETTINGS
    # =========================================================================

    judge_model: str = Field(
        default="gpt-4o-mini",
        description="OpenAI model for QA analysis",
    )

    qa_version: str = Field(
        default="v1.0",
        description="QA analysis version for tracking",
    )

    flag_threshold: int = Field(
        default=70,
        ge=0,
        le=100,
        description="Score threshold: below = flagged, above = safe",
    )

    # =========================================================================
    # VALIDATORS
    # =========================================================================

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Ensure log level is valid."""
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in valid_levels:
            raise ValueError(f"log_level must be one of {valid_levels}")
        return upper

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, v: str) -> str:
        """Ensure Supabase URL is valid."""
        if not v.startswith("https://"):
            raise ValueError("supabase_url must start with https://")
        if "supabase.co" not in v:
            raise ValueError("supabase_url must be a Supabase URL")
        return v

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    def require_openai(self) -> str:
        """
        Get OpenAI API key or raise error.

        Use this in Judge Lane to enforce key requirement.
        """
        if not self.openai_api_key:
            raise ValueError(
                "OPENAI_API_KEY is required for Judge Lane. "
                "Add it to your .env file."
            )
        return self.openai_api_key

    @property
    def worker_log_path(self) -> str:
        """Full path to worker log file."""
        return f"{self.log_dir}/worker.log"

    @property
    def judge_log_path(self) -> str:
        """Full path to judge log file."""
        return f"{self.log_dir}/judge.log"


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Uses lru_cache to ensure settings are only loaded once.
    Will raise ValidationError if required env vars are missing.
    """
    return Settings()
