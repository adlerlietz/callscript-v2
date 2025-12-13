#!/usr/bin/env python3
"""
CallScript V2 - Judge Lane Worker

Analyzes transcribed calls using GPT-4o-mini to detect compliance violations,
score quality, and flag problematic calls for review.

Architecture:
- Sequential processing: 1 call at a time (API calls are fast)
- Structured outputs: Pydantic models for type-safe responses
- Automatic retries: tenacity handles rate limits and transient errors
- Cost control: Skips transcripts under 50 characters

Server: RunPod (Ubuntu 22.04) or any Linux server
Database: Supabase (PostgreSQL)
AI: OpenAI GPT-4o-mini
"""

import json
import logging
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from openai import OpenAI, APIError, RateLimitError, APIConnectionError
from pydantic import BaseModel, Field
from supabase import create_client
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from workers.core import get_settings, setup_logging

# =============================================================================
# CONFIGURATION
# =============================================================================
MODEL_NAME = "gpt-4o-mini"
QA_VERSION = "v2.0"
POLL_INTERVAL = 5  # Seconds to wait when queue is empty
MIN_TRANSCRIPT_LENGTH = 50  # Skip transcripts shorter than this
FLAG_THRESHOLD = 70  # Score below this = flagged

# =============================================================================
# GLOBALS
# =============================================================================
shutdown_requested = False
logger: logging.Logger


def signal_handler(sig, frame):
    """Handle graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    logger.info("Shutdown signal received, finishing current call...")


# =============================================================================
# PYDANTIC MODELS FOR STRUCTURED OUTPUTS
# =============================================================================
class QAAnalysis(BaseModel):
    """Structured QA analysis response from GPT-4o."""

    score: int = Field(
        ...,
        ge=0,
        le=100,
        description="Overall quality score 0-100. Below 70 = flagged.",
    )
    flagged: bool = Field(
        ...,
        description="True if call has compliance issues or quality problems.",
    )
    summary: str = Field(
        ...,
        max_length=500,
        description="Brief 1-2 sentence summary of the call.",
    )
    issues: list[str] = Field(
        default_factory=list,
        description="List of specific issues found (compliance, quality, etc.).",
    )
    # Extended analysis fields
    pii_detected: bool = Field(
        default=False,
        description="True if PII (SSN, credit card, etc.) was shared.",
    )
    hostility_detected: bool = Field(
        default=False,
        description="True if hostility, abuse, or inappropriate language detected.",
    )
    sales_success: bool = Field(
        default=False,
        description="True if the call resulted in a successful sale/conversion.",
    )
    customer_sentiment: str = Field(
        default="neutral",
        description="Customer sentiment: positive, neutral, or negative.",
    )
    compliance_risk: str = Field(
        default="low",
        description="Compliance risk level: low, medium, high, critical.",
    )


# =============================================================================
# SYSTEM PROMPT
# =============================================================================
SYSTEM_PROMPT = """You are a QA Compliance Officer for a Pay-Per-Call marketing operation.

Analyze the provided call transcript and evaluate it for:

1. **PII Leakage**: Did anyone share sensitive personal information (SSN, credit card numbers, bank accounts, medical info)?

2. **Hostility/Abuse**: Was there any hostility, inappropriate language, threats, or unprofessional behavior from either party?

3. **Sales Success**: Did the call result in a successful sale, appointment, or conversion?

4. **Compliance Issues**: Look for TCPA violations, deceptive practices, failure to disclose, or other regulatory concerns.

5. **Overall Quality**: Rate the call on professionalism, communication clarity, and proper call handling.

**Scoring Guidelines:**
- 90-100: Excellent call. Professional, compliant, successful outcome.
- 70-89: Good call. Minor issues but acceptable quality.
- 50-69: Problematic call. Multiple issues requiring review.
- 0-49: Critical issues. Major compliance violations or abuse.

**Set flagged=true if:**
- Score is below 70
- Any PII was leaked
- Any hostility/abuse detected
- High or critical compliance risk

Respond with a structured JSON analysis."""


# =============================================================================
# JUDGE REPOSITORY
# =============================================================================
class JudgeRepository:
    """
    Repository for Judge Lane operations.

    Handles:
    - Fetching transcribed calls ready for QA
    - Saving QA analysis results
    - Marking calls as skipped
    """

    def __init__(self, client):
        """
        Initialize repository.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")

    def fetch_next_transcribed_call(self) -> Optional[dict[str, Any]]:
        """
        Fetch next transcribed call ready for QA analysis.

        Query logic:
        - status = 'transcribed'
        - qa_flags IS NULL (not yet judged)
        - ORDER BY start_time_utc DESC (LIFO - newest first)

        Returns:
            Call dict or None if queue empty
        """
        try:
            response = (
                self.schema
                .from_("calls")
                .select("id, transcript_text, transcript_segments, start_time_utc, duration_seconds")
                .eq("status", "transcribed")
                .is_("qa_flags", "null")
                .order("start_time_utc", desc=True)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Failed to fetch next transcribed call: {e}")
            raise

    def save_qa_results(
        self,
        call_id: str,
        analysis: QAAnalysis,
    ) -> None:
        """
        Save QA analysis results.

        Args:
            call_id: UUID of the call
            analysis: Parsed QA analysis from GPT
        """
        # Determine final status
        new_status = "flagged" if analysis.flagged or analysis.score < FLAG_THRESHOLD else "safe"

        # Build qa_flags JSONB
        qa_flags = {
            "score": analysis.score,
            "flagged": analysis.flagged,
            "summary": analysis.summary,
            "issues": analysis.issues,
            "pii_detected": analysis.pii_detected,
            "hostility_detected": analysis.hostility_detected,
            "sales_success": analysis.sales_success,
            "customer_sentiment": analysis.customer_sentiment,
            "compliance_risk": analysis.compliance_risk,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            self.schema.from_("calls").update({
                "qa_flags": qa_flags,
                "qa_version": QA_VERSION,
                "judge_model": MODEL_NAME,
                "status": new_status,
                "processing_error": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.info(
                f"Saved QA: {call_id[:8]}... | Score={analysis.score} | "
                f"Status={new_status} | Issues={len(analysis.issues)}"
            )
        except Exception as e:
            logger.error(f"Failed to save QA results for {call_id}: {e}")
            raise

    def mark_skipped(self, call_id: str, reason: str, transcript_length: int) -> None:
        """
        Mark a call as skipped (transcript too short, etc.).

        Args:
            call_id: UUID of the call
            reason: Why the call was skipped
            transcript_length: Length of the transcript
        """
        qa_flags = {
            "skipped": True,
            "reason": reason,
            "transcript_length": transcript_length,
            "skipped_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            self.schema.from_("calls").update({
                "qa_flags": qa_flags,
                "qa_version": QA_VERSION,
                "judge_model": "skipped",
                "status": "safe",  # Don't flag short transcripts
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.warning(f"Skipped: {call_id[:8]}... | Reason={reason}")
        except Exception as e:
            logger.error(f"Failed to mark {call_id} as skipped: {e}")

    def mark_failed(self, call_id: str, error: str) -> None:
        """
        Mark a call as failed during QA analysis.

        Args:
            call_id: UUID of the call
            error: Error message
        """
        try:
            self.schema.from_("calls").update({
                "status": "failed",
                "processing_error": error[:500],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.error(f"Failed: {call_id[:8]}... | Error={error[:100]}")
        except Exception as e:
            logger.error(f"Failed to mark {call_id} as failed: {e}")

    def get_queue_stats(self) -> dict[str, int]:
        """Get count of calls by status."""
        stats = {}
        for status in ["pending", "downloaded", "processing", "transcribed", "flagged", "safe", "failed"]:
            try:
                response = (
                    self.schema
                    .from_("calls")
                    .select("id", count="exact")
                    .eq("status", status)
                    .execute()
                )
                stats[status] = response.count or 0
            except Exception:
                stats[status] = -1
        return stats


# =============================================================================
# OPENAI ANALYSIS
# =============================================================================
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIError)),
    reraise=True,
)
def analyze_with_gpt(
    openai_client: OpenAI,
    transcript: str,
) -> QAAnalysis:
    """
    Analyze transcript using OpenAI GPT-4o-mini with structured outputs.

    Uses tenacity for automatic retries on:
    - Rate limit errors (429)
    - Connection errors
    - Server errors (500+)

    Args:
        openai_client: Configured OpenAI client
        transcript: Call transcript text

    Returns:
        Parsed QAAnalysis object

    Raises:
        Exception: If all retries fail
    """
    logger.debug(f"Sending to GPT-4o-mini ({len(transcript)} chars)...")

    completion = openai_client.beta.chat.completions.parse(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Analyze this call transcript:\n\n{transcript}"},
        ],
        response_format=QAAnalysis,
        temperature=0.3,
        max_tokens=1000,
    )

    analysis = completion.choices[0].message.parsed

    if analysis is None:
        raise ValueError("GPT returned None - parsing failed")

    logger.debug(f"GPT response: Score={analysis.score}, Flagged={analysis.flagged}")
    return analysis


# =============================================================================
# CALL PROCESSING
# =============================================================================
def process_call(
    call: dict[str, Any],
    repo: JudgeRepository,
    openai_client: OpenAI,
) -> bool:
    """
    Process a single call through the QA pipeline.

    Args:
        call: Call dict with id, transcript_text, etc.
        repo: Judge repository
        openai_client: OpenAI client

    Returns:
        True if processed successfully, False otherwise
    """
    call_id = call["id"]
    transcript = call.get("transcript_text") or ""
    duration = call.get("duration_seconds", 0)

    logger.info(f"Processing: {call_id[:8]}... | Duration={duration}s | Transcript={len(transcript)} chars")

    # Cost control: Skip very short transcripts
    if len(transcript.strip()) < MIN_TRANSCRIPT_LENGTH:
        repo.mark_skipped(
            call_id,
            reason="transcript_too_short",
            transcript_length=len(transcript),
        )
        return True  # Counts as processed

    try:
        # Analyze with GPT-4o-mini
        analysis = analyze_with_gpt(openai_client, transcript)

        # Save results
        repo.save_qa_results(call_id, analysis)

        return True

    except (RateLimitError, APIConnectionError, APIError) as e:
        # OpenAI API error after all retries
        error_msg = f"OpenAI API error after retries: {str(e)[:200]}"
        logger.error(f"{call_id[:8]}...: {error_msg}")
        repo.mark_failed(call_id, error_msg)
        return False

    except Exception as e:
        # Unexpected error
        error_msg = f"Unexpected error: {str(e)[:200]}"
        logger.error(f"{call_id[:8]}...: {error_msg}")
        repo.mark_failed(call_id, error_msg)
        return False


# =============================================================================
# MAIN LOOP
# =============================================================================
def main():
    """Main worker entry point."""
    global logger

    # Initialize settings and logging
    settings = get_settings()
    logger = setup_logging("judge", f"{settings.log_dir}/judge.log", settings.log_level)

    logger.info("=" * 60)
    logger.info("CallScript V2 Judge Worker Starting")
    logger.info("=" * 60)

    # Setup signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Validate OpenAI key
    openai_api_key = settings.require_openai()
    openai_client = OpenAI(api_key=openai_api_key)
    logger.info(f"OpenAI client initialized (model: {MODEL_NAME})")

    # Connect to Supabase
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = JudgeRepository(client)
        logger.info("Connected to Supabase")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # Log initial stats
    stats = repo.get_queue_stats()
    logger.info(f"Queue stats: transcribed={stats.get('transcribed', 0)}, flagged={stats.get('flagged', 0)}, safe={stats.get('safe', 0)}")
    logger.info(f"Config: model={MODEL_NAME}, qa_version={QA_VERSION}, flag_threshold={FLAG_THRESHOLD}")
    logger.info("=" * 60)

    # Main loop
    total_processed = 0
    total_flagged = 0
    total_safe = 0
    total_failed = 0

    while not shutdown_requested:
        try:
            # Fetch next transcribed call
            call = repo.fetch_next_transcribed_call()

            if call is None:
                # Queue empty - wait and retry
                logger.debug(f"Queue empty, waiting {POLL_INTERVAL}s...")
                time.sleep(POLL_INTERVAL)
                continue

            # Process the call
            success = process_call(call, repo, openai_client)

            if success:
                total_processed += 1

                # Track flagged vs safe (approximation based on last save)
                # Real counts come from get_queue_stats()

                # Log milestone every 50 calls
                if total_processed % 50 == 0:
                    stats = repo.get_queue_stats()
                    logger.info(
                        f"Milestone: {total_processed} processed | "
                        f"Flagged={stats.get('flagged', 0)} | Safe={stats.get('safe', 0)}"
                    )
            else:
                total_failed += 1

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
            break

        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            total_failed += 1
            time.sleep(POLL_INTERVAL)

    # Shutdown summary
    logger.info("=" * 60)
    logger.info("Judge Worker Shutdown")
    logger.info(f"Total processed: {total_processed}")
    logger.info(f"Total failed: {total_failed}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
