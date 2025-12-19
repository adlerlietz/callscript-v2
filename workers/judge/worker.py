#!/usr/bin/env python3
"""
CallScript V2 - Judge Lane Worker (Turbo Edition)

Analyzes transcribed calls using GPT-4o-mini to detect compliance violations,
score quality, and flag problematic calls for review.

Architecture:
- Batch processing: Fetches 10 calls at a time
- Multithreaded: ThreadPoolExecutor for parallel OpenAI API calls
- Atomic locking: Uses qa_flags as lock to prevent duplicate processing
- Structured outputs: Pydantic models for type-safe responses
- Automatic retries: tenacity handles rate limits and transient errors

Performance: ~200+ calls/hour (vs ~20/hour sequential)

Server: RunPod (Ubuntu 22.04) or any Linux server
Database: Supabase (PostgreSQL)
AI: OpenAI GPT-4o-mini
"""

import logging
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
QA_VERSION = "v2.1-turbo"
BATCH_SIZE = 10  # Calls to fetch per batch
MAX_WORKERS = 10  # Concurrent OpenAI API threads
POLL_INTERVAL = 2  # Seconds to wait when queue is empty
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
    logger.info("Shutdown signal received, finishing current batch...")


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
# SYSTEM PROMPT (Base + Dynamic Rules)
# =============================================================================
BASE_SYSTEM_PROMPT = """You are a QA Compliance Officer for a Pay-Per-Call marketing operation.

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
- Any CRITICAL rule violation detected (see rules below)

{dynamic_rules}

Respond with a structured JSON analysis."""


def build_system_prompt(rules: list[dict[str, Any]]) -> str:
    """
    Build system prompt with dynamic rules.

    Args:
        rules: List of QA rules from database

    Returns:
        Complete system prompt with rules injected
    """
    if not rules:
        return BASE_SYSTEM_PROMPT.format(dynamic_rules="")

    # Build rules section
    rule_sections = []

    # Group by severity for better organization
    critical_rules = [r for r in rules if r.get("severity") == "critical"]
    warning_rules = [r for r in rules if r.get("severity") == "warning"]

    if critical_rules:
        rule_sections.append("**CRITICAL RULES (Must Flag if Violated):**")
        for r in critical_rules:
            name = r.get("name", "Unnamed Rule")
            prompt = r.get("prompt_fragment", "")
            if prompt:
                rule_sections.append(f"- **{name}**: {prompt}")

    if warning_rules:
        rule_sections.append("\n**WARNING RULES (Flag if Multiple Violations):**")
        for r in warning_rules:
            name = r.get("name", "Unnamed Rule")
            prompt = r.get("prompt_fragment", "")
            if prompt:
                rule_sections.append(f"- **{name}**: {prompt}")

    dynamic_rules = "\n".join(rule_sections)
    return BASE_SYSTEM_PROMPT.format(dynamic_rules=dynamic_rules)


# =============================================================================
# JUDGE REPOSITORY
# =============================================================================
class JudgeRepository:
    """
    Repository for Judge Lane operations.

    Handles:
    - Fetching and locking batches of transcribed calls
    - Saving QA analysis results
    - Marking calls as skipped or failed
    """

    def __init__(self, client):
        """
        Initialize repository.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")

    def fetch_qa_rules(self, vertical: Optional[str] = None) -> list[dict[str, Any]]:
        """
        Fetch applicable QA rules for a given vertical.

        Returns:
            - All enabled global rules (scope='global')
            - All enabled rules for the specific vertical (scope='vertical', vertical=vertical)

        Args:
            vertical: The campaign vertical ID (e.g., 'medicare', 'solar')

        Returns:
            List of rule dicts with name, severity, prompt_fragment
        """
        try:
            # Build query for global rules + vertical-specific rules
            query = (
                self.schema
                .from_("qa_rules")
                .select("id, name, slug, severity, prompt_fragment, scope, vertical")
                .eq("enabled", True)
            )

            # Filter: global rules OR rules matching this vertical
            if vertical:
                query = query.or_(f"scope.eq.global,and(scope.eq.vertical,vertical.eq.{vertical})")
            else:
                query = query.eq("scope", "global")

            response = query.order("display_order", desc=False).execute()

            rules = response.data or []
            logger.debug(f"Fetched {len(rules)} QA rules for vertical={vertical}")
            return rules

        except Exception as e:
            logger.warning(f"Failed to fetch QA rules: {e} - using base prompt")
            return []

    def fetch_and_lock_batch(self, limit: int = BATCH_SIZE) -> list[dict[str, Any]]:
        """
        Fetch and atomically lock a batch of transcribed calls for QA analysis.

        Uses qa_flags as a lock marker to prevent race conditions.
        Only fetches calls where qa_flags IS NULL (not yet claimed).

        Args:
            limit: Maximum calls to fetch

        Returns:
            List of successfully locked call dicts (includes campaign vertical)
        """
        locked_calls = []

        try:
            # Step 1: Fetch candidate calls with campaign vertical
            response = (
                self.schema
                .from_("calls")
                .select("id, transcript_text, transcript_segments, start_time_utc, duration_seconds, campaign_id, campaigns(vertical)")
                .eq("status", "transcribed")
                .is_("qa_flags", "null")  # postgrest-py uses "null" string for IS NULL
                .order("start_time_utc", desc=True)
                .limit(limit)
                .execute()
            )

            logger.debug(f"Fetched {len(response.data) if response.data else 0} candidate calls")

            if not response.data:
                return []

            # Step 2: Try to lock each call atomically
            lock_time = datetime.now(timezone.utc).isoformat()

            for call in response.data:
                call_id = call["id"]

                # Atomic lock: only succeeds if qa_flags is still NULL
                lock_response = (
                    self.schema
                    .from_("calls")
                    .update({
                        "qa_flags": {"_locked": True, "_locked_at": lock_time},
                        "updated_at": lock_time,
                    })
                    .eq("id", call_id)
                    .eq("status", "transcribed")
                    .is_("qa_flags", "null")
                    .execute()
                )

                if lock_response.data:
                    locked_calls.append(call)
                    logger.debug(f"Locked: {call_id[:8]}...")

            return locked_calls

        except Exception as e:
            logger.error(f"Failed to fetch/lock batch: {e}")
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

            logger.debug(
                f"Saved: {call_id[:8]}... | Score={analysis.score} | Status={new_status}"
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

            logger.debug(f"Skipped: {call_id[:8]}... | Reason={reason}")
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
                "qa_flags": {"error": error[:200], "failed_at": datetime.now(timezone.utc).isoformat()},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.warning(f"Failed: {call_id[:8]}... | {error[:50]}")
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
    system_prompt: str,
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
        system_prompt: Dynamic system prompt with rules injected

    Returns:
        Parsed QAAnalysis object

    Raises:
        Exception: If all retries fail
    """
    completion = openai_client.beta.chat.completions.parse(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this call transcript:\n\n{transcript}"},
        ],
        response_format=QAAnalysis,
        temperature=0.3,
        max_tokens=1000,
    )

    analysis = completion.choices[0].message.parsed

    if analysis is None:
        raise ValueError("GPT returned None - parsing failed")

    return analysis


# =============================================================================
# CALL PROCESSING
# =============================================================================
# Thread-local cache for rules (keyed by vertical)
_rules_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
RULES_CACHE_TTL = 60  # seconds


def get_rules_cached(repo: JudgeRepository, vertical: Optional[str]) -> list[dict[str, Any]]:
    """
    Get QA rules with caching to avoid repeated DB calls.

    Args:
        repo: Judge repository
        vertical: Campaign vertical ID

    Returns:
        List of applicable rules
    """
    cache_key = vertical or "_global_"
    now = time.time()

    if cache_key in _rules_cache:
        cached_time, cached_rules = _rules_cache[cache_key]
        if now - cached_time < RULES_CACHE_TTL:
            return cached_rules

    # Fetch fresh rules
    rules = repo.fetch_qa_rules(vertical)
    _rules_cache[cache_key] = (now, rules)
    return rules


def process_single_call(
    call: dict[str, Any],
    repo: JudgeRepository,
    openai_client: OpenAI,
) -> tuple[str, bool, str]:
    """
    Process a single call through the QA pipeline.

    Designed to be called from a thread pool.

    Args:
        call: Call dict with id, transcript_text, campaigns join, etc.
        repo: Judge repository
        openai_client: OpenAI client

    Returns:
        Tuple of (call_id, success, status_or_error)
    """
    call_id = call["id"]
    transcript = call.get("transcript_text") or ""

    # Extract vertical from joined campaign data
    campaign_data = call.get("campaigns")
    vertical = None
    if campaign_data:
        # Supabase returns nested object or None
        if isinstance(campaign_data, dict):
            vertical = campaign_data.get("vertical")
        elif isinstance(campaign_data, list) and campaign_data:
            vertical = campaign_data[0].get("vertical")

    # Cost control: Skip very short transcripts
    if len(transcript.strip()) < MIN_TRANSCRIPT_LENGTH:
        repo.mark_skipped(
            call_id,
            reason="transcript_too_short",
            transcript_length=len(transcript),
        )
        return (call_id, True, "skipped")

    try:
        # Fetch applicable rules (cached)
        rules = get_rules_cached(repo, vertical)

        # Build dynamic prompt with rules
        system_prompt = build_system_prompt(rules)

        # Log rules being applied (INFO level for visibility)
        if vertical and rules:
            vertical_rules = [r for r in rules if r.get("scope") == "vertical"]
            if vertical_rules:
                logger.info(f"Call {call_id[:8]}... vertical={vertical}, applying {len(vertical_rules)} vertical-specific rules")

        # Analyze with GPT-4o-mini
        analysis = analyze_with_gpt(openai_client, transcript, system_prompt)

        # Save results
        repo.save_qa_results(call_id, analysis)

        status = "flagged" if analysis.flagged or analysis.score < FLAG_THRESHOLD else "safe"
        return (call_id, True, status)

    except (RateLimitError, APIConnectionError, APIError) as e:
        # OpenAI API error after all retries
        error_msg = f"OpenAI API error: {str(e)[:100]}"
        repo.mark_failed(call_id, error_msg)
        return (call_id, False, error_msg)

    except Exception as e:
        # Unexpected error
        error_msg = f"Error: {str(e)[:100]}"
        repo.mark_failed(call_id, error_msg)
        return (call_id, False, error_msg)


def process_batch(
    calls: list[dict[str, Any]],
    repo: JudgeRepository,
    openai_client: OpenAI,
    max_workers: int = MAX_WORKERS,
) -> tuple[int, int, int, int]:
    """
    Process a batch of calls concurrently using thread pool.

    Args:
        calls: List of call dicts
        repo: Judge repository
        openai_client: OpenAI client
        max_workers: Maximum concurrent threads

    Returns:
        Tuple of (success_count, failed_count, flagged_count, safe_count)
    """
    success_count = 0
    failed_count = 0
    flagged_count = 0
    safe_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all calls to thread pool
        futures = {
            executor.submit(process_single_call, call, repo, openai_client): call["id"]
            for call in calls
        }

        # Collect results as they complete
        for future in as_completed(futures):
            call_id = futures[future]
            try:
                _, success, status = future.result()
                if success:
                    success_count += 1
                    if status == "flagged":
                        flagged_count += 1
                    elif status == "safe":
                        safe_count += 1
                    # "skipped" counts as success but not flagged/safe
                else:
                    failed_count += 1
            except Exception as e:
                logger.error(f"Thread error for {call_id[:8]}...: {e}")
                failed_count += 1

    return success_count, failed_count, flagged_count, safe_count


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
    logger.info("CallScript V2 Judge Worker (Turbo Edition)")
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
    logger.info(f"Queue: transcribed={stats.get('transcribed', 0)}, flagged={stats.get('flagged', 0)}, safe={stats.get('safe', 0)}")
    logger.info(f"Config: batch={BATCH_SIZE}, threads={MAX_WORKERS}, model={MODEL_NAME}")

    # Test rule loading
    try:
        global_rules = repo.fetch_qa_rules(None)
        logger.info(f"Loaded {len(global_rules)} global QA rules from database")
        for r in global_rules[:3]:  # Show first 3
            logger.info(f"  - {r.get('name')} ({r.get('severity')})")
        if len(global_rules) > 3:
            logger.info(f"  ... and {len(global_rules) - 3} more")
    except Exception as e:
        logger.warning(f"Could not load QA rules: {e}")

    logger.info("=" * 60)

    # Main loop
    total_success = 0
    total_failed = 0
    total_flagged = 0
    total_safe = 0
    batch_count = 0

    while not shutdown_requested:
        try:
            # Fetch and lock batch of transcribed calls
            calls = repo.fetch_and_lock_batch(limit=BATCH_SIZE)

            if not calls:
                # Queue empty - wait and retry
                logger.debug("No calls to process, waiting...")
                time.sleep(POLL_INTERVAL)
                continue

            batch_count += 1
            logger.info(f"Batch {batch_count}: Processing {len(calls)} calls...")

            # Process batch concurrently
            success, failed, flagged, safe = process_batch(
                calls, repo, openai_client, MAX_WORKERS
            )

            total_success += success
            total_failed += failed
            total_flagged += flagged
            total_safe += safe

            logger.info(
                f"Batch {batch_count} complete: {success} OK, {failed} failed "
                f"| flagged={flagged}, safe={safe}"
            )

            # Log milestone every 100 successful calls
            if total_success > 0 and total_success % 100 < BATCH_SIZE:
                stats = repo.get_queue_stats()
                logger.info(
                    f"=== Milestone: {total_success} processed | "
                    f"Queue: {stats.get('transcribed', 0)} remaining ==="
                )

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
            break

        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            time.sleep(5)  # Back off on errors

    # Shutdown summary
    logger.info("=" * 60)
    logger.info("Judge Worker Shutdown (Turbo Edition)")
    logger.info(f"Total: {total_success} success, {total_failed} failed")
    logger.info(f"Results: {total_flagged} flagged, {total_safe} safe")
    logger.info(f"Batches: {batch_count}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
