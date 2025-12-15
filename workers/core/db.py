"""
CallScript V2 - Database Operations

All Supabase interactions for the worker pipeline.
Implements LIFO queue with atomic locking and retry logic.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from supabase import Client

logger = logging.getLogger("worker")


class CallsRepository:
    """
    Repository for core.calls table operations.

    Implements the queue invariants:
    - LIFO ordering (newest first)
    - Atomic locking (prevent duplicate processing)
    - Retry limit enforcement (max 3 attempts)
    """

    def __init__(self, client: Client):
        """
        Initialize repository with Supabase client.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")

    # =========================================================================
    # QUEUE OPERATIONS
    # =========================================================================

    def fetch_next_pending_call(self) -> dict[str, Any] | None:
        """
        Fetch next call from queue (LIFO order) that's ready for processing.

        Query logic:
        - status = 'downloaded' (audio secured in vault)
        - retry_count < 3 (skip poison pills)
        - ORDER BY start_time_utc DESC (LIFO - newest first)

        Returns:
            Call dict with id, storage_path, retry_count or None if queue empty
        """
        try:
            response = (
                self.schema
                .from_("calls")
                .select("id, storage_path, retry_count")
                .eq("status", "downloaded")
                .lt("retry_count", 3)
                .order("start_time_utc", desc=True)
                .limit(1)
                .execute()
            )

            if not response.data:
                return None

            call = response.data[0]
            # Handle NULL retry_count from database
            if call.get("retry_count") is None:
                call["retry_count"] = 0

            return call

        except Exception as e:
            logger.error(f"Failed to fetch next pending call: {e}")
            raise

    def lock_call(self, call_id: str, current_retry_count: int) -> dict[str, Any] | None:
        """
        Atomically lock a call for processing.

        Uses optimistic locking: only succeeds if status is still 'downloaded'.
        This prevents race conditions when multiple workers poll simultaneously.

        Args:
            call_id: UUID of the call to lock
            current_retry_count: Current retry count (will be incremented)

        Returns:
            Updated call record if lock successful, None if lock failed
        """
        new_retry_count = current_retry_count + 1

        try:
            response = (
                self.schema
                .from_("calls")
                .update({
                    "status": "processing",
                    "retry_count": new_retry_count,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", call_id)
                .eq("status", "downloaded")  # Optimistic lock condition
                .execute()
            )

            if not response.data:
                logger.warning(f"Lock failed for {call_id} - likely claimed by another worker")
                return None

            logger.debug(f"Locked call {call_id} (attempt {new_retry_count}/3)")
            return response.data[0]

        except Exception as e:
            logger.error(f"Failed to lock call {call_id}: {e}")
            raise

    def release_call(self, call_id: str) -> bool:
        """
        Release a locked call back to the queue without incrementing retry count.

        Used when a worker cannot process a call due to resource constraints
        (e.g., low GPU memory) but the call itself is not problematic.

        Args:
            call_id: UUID of the call to release

        Returns:
            True if release successful, False otherwise
        """
        try:
            response = (
                self.schema
                .from_("calls")
                .update({
                    "status": "downloaded",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", call_id)
                .eq("status", "processing")  # Only release if we own it
                .execute()
            )

            if response.data:
                logger.info(f"Released call {call_id} back to queue (resource constraint)")
                return True
            else:
                logger.warning(f"Could not release call {call_id} - status may have changed")
                return False

        except Exception as e:
            logger.error(f"Failed to release call {call_id}: {e}")
            return False

    # =========================================================================
    # RESULT OPERATIONS
    # =========================================================================

    def save_transcription(
        self,
        call_id: str,
        text: str,
        segments: list[dict],
    ) -> None:
        """
        Save successful transcription results.

        Args:
            call_id: UUID of the call
            text: Full transcript text
            segments: Diarization segments [{start, end, speaker}, ...]
        """
        try:
            self.schema.from_("calls").update({
                "status": "transcribed",
                "transcript_text": text,
                "transcript_segments": segments,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "processing_error": None,  # Clear any previous error
            }).eq("id", call_id).execute()

            logger.info(f"Saved transcription for {call_id} | Len: {len(text)} chars | Segments: {len(segments)}")

        except Exception as e:
            logger.error(f"Failed to save transcription for {call_id}: {e}")
            raise

    def mark_failed(
        self,
        call_id: str,
        error: str,
        current_retry_count: int,
    ) -> None:
        """
        Mark call as failed or reset for retry.

        Logic:
        - If retry_count < max_retries (3): Reset to 'downloaded' for retry
        - If retry_count >= max_retries: Mark as 'failed' (dead letter)

        Args:
            call_id: UUID of the call
            error: Error message (truncated to 500 chars)
            current_retry_count: Current retry count
        """
        max_retries = 3
        is_dead_letter = current_retry_count >= max_retries

        new_status = "failed" if is_dead_letter else "downloaded"
        error_truncated = error[:500] if error else "Unknown error"

        try:
            self.schema.from_("calls").update({
                "status": new_status,
                "processing_error": error_truncated,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            if is_dead_letter:
                logger.error(f"Call {call_id} permanently failed after {current_retry_count} attempts: {error_truncated[:100]}")
            else:
                logger.warning(f"Call {call_id} reset to downloaded (attempt {current_retry_count}/{max_retries}): {error_truncated[:100]}")

        except Exception as e:
            logger.error(f"Failed to mark call {call_id} as failed: {e}")
            raise

    # =========================================================================
    # JUDGE OPERATIONS
    # =========================================================================

    def fetch_next_transcribed_call(self) -> dict[str, Any] | None:
        """
        Fetch next transcribed call ready for QA analysis.

        Query logic:
        - status = 'transcribed'
        - qa_flags IS NULL (not yet judged)
        - ORDER BY start_time_utc DESC (LIFO)

        Returns:
            Call dict or None if queue empty
        """
        try:
            response = (
                self.schema
                .from_("calls")
                .select("id, transcript_text, transcript_segments, start_time_utc")
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
        qa_flags: dict,
        qa_version: str,
        judge_model: str,
        new_status: str,
    ) -> None:
        """
        Save QA analysis results.

        Args:
            call_id: UUID of the call
            qa_flags: QA analysis results dict
            qa_version: Version of QA analysis (e.g., "v1.0")
            judge_model: Model used for analysis (e.g., "gpt-4o-mini")
            new_status: New status ('safe' or 'flagged')
        """
        try:
            self.schema.from_("calls").update({
                "qa_flags": qa_flags,
                "qa_version": qa_version,
                "judge_model": judge_model,
                "status": new_status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            score = qa_flags.get("score", "?")
            logger.info(f"Saved QA results for {call_id} | Score: {score} | Status: {new_status}")

        except Exception as e:
            logger.error(f"Failed to save QA results for {call_id}: {e}")
            raise

    def mark_qa_skipped(self, call_id: str, reason: str) -> None:
        """
        Mark a call as skipped by QA (e.g., transcript too short).

        Args:
            call_id: UUID of the call
            reason: Why the call was skipped
        """
        try:
            self.schema.from_("calls").update({
                "qa_flags": {
                    "skipped": True,
                    "reason": reason,
                    "skipped_at": datetime.now(timezone.utc).isoformat(),
                },
                "status": "failed",
                "processing_error": reason,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.warning(f"QA skipped for {call_id}: {reason}")

        except Exception as e:
            logger.error(f"Failed to mark QA skipped for {call_id}: {e}")
            raise

    # =========================================================================
    # UTILITY OPERATIONS
    # =========================================================================

    def get_queue_stats(self) -> dict[str, int]:
        """
        Get current queue statistics by status.

        Returns:
            Dict of status -> count
        """
        stats = {}
        statuses = ["pending", "downloaded", "processing", "transcribed", "flagged", "safe", "failed"]

        for status in statuses:
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

    def download_audio(self, storage_path: str) -> bytes:
        """
        Download audio file from Supabase storage.

        Args:
            storage_path: Path in calls_audio bucket

        Returns:
            Audio file bytes
        """
        try:
            audio_bytes = self.client.storage.from_("calls_audio").download(storage_path)
            logger.debug(f"Downloaded {len(audio_bytes)} bytes from {storage_path}")
            return audio_bytes
        except Exception as e:
            logger.error(f"Failed to download audio from {storage_path}: {e}")
            raise


def create_repository(client: Client) -> CallsRepository:
    """
    Factory function to create a CallsRepository.

    Args:
        client: Authenticated Supabase client

    Returns:
        Configured CallsRepository instance
    """
    return CallsRepository(client)
