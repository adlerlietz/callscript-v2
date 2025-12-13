#!/usr/bin/env python3
"""
CallScript V2 - Vault Lane Worker

Downloads audio files from Ringba URLs and stores them in Supabase Storage.
This worker unblocks the Factory Lane by moving calls from 'pending' to 'downloaded'.

Architecture:
- IO-bound workload: Uses ThreadPoolExecutor for parallel downloads
- Batch processing: Fetches 10 calls at a time, processes 5 concurrently
- Graceful error handling: Permanent failures vs. transient errors

Server: RunPod (Ubuntu 22.04) or any Linux server
Database: Supabase (PostgreSQL + Storage)
"""

import logging
import os
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from supabase import create_client

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from workers.core import get_settings, setup_logging

# =============================================================================
# CONFIGURATION
# =============================================================================
BATCH_SIZE = 10  # Calls to fetch per batch
MAX_WORKERS = 5  # Concurrent download threads
DOWNLOAD_TIMEOUT = 60  # Seconds before download timeout
POLL_INTERVAL = 5  # Seconds to wait when queue is empty
STORAGE_BUCKET = "calls_audio"

# HTTP status codes that indicate permanent failure (no retry)
PERMANENT_FAILURE_CODES = {401, 403, 404, 410}

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
# VAULT REPOSITORY
# =============================================================================
class VaultRepository:
    """
    Repository for Vault Lane operations.

    Handles:
    - Fetching pending calls with audio URLs
    - Uploading to Supabase Storage
    - Updating call status
    """

    def __init__(self, client):
        """
        Initialize repository.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")
        self.storage = client.storage.from_(STORAGE_BUCKET)

    def fetch_pending_calls(self, limit: int = BATCH_SIZE) -> list[dict[str, Any]]:
        """
        Fetch batch of pending calls ready for audio download.

        Query logic:
        - status = 'pending'
        - audio_url IS NOT NULL (has Ringba recording URL)
        - ORDER BY start_time_utc DESC (LIFO - newest first)

        Args:
            limit: Maximum calls to fetch

        Returns:
            List of call dicts with id, audio_url, start_time_utc
        """
        try:
            response = (
                self.schema
                .from_("calls")
                .select("id, audio_url, start_time_utc")
                .eq("status", "pending")
                .not_.is_("audio_url", "null")
                .order("start_time_utc", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data or []
        except Exception as e:
            logger.error(f"Failed to fetch pending calls: {e}")
            raise

    def upload_audio(self, storage_path: str, audio_bytes: bytes) -> None:
        """
        Upload audio file to Supabase Storage.

        Args:
            storage_path: Path in bucket (e.g., "2024/12/13/uuid.mp3")
            audio_bytes: Raw audio file bytes
        """
        try:
            self.storage.upload(
                path=storage_path,
                file=audio_bytes,
                file_options={"content-type": "audio/mpeg"}
            )
            logger.debug(f"Uploaded {len(audio_bytes)} bytes to {storage_path}")
        except Exception as e:
            # Check if file already exists (not an error)
            if "Duplicate" in str(e) or "already exists" in str(e).lower():
                logger.debug(f"File already exists at {storage_path}, skipping upload")
                return
            logger.error(f"Failed to upload to {storage_path}: {e}")
            raise

    def mark_downloaded(self, call_id: str, storage_path: str) -> None:
        """
        Mark call as successfully downloaded.

        Args:
            call_id: UUID of the call
            storage_path: Path where audio was stored
        """
        try:
            self.schema.from_("calls").update({
                "status": "downloaded",
                "storage_path": storage_path,
                "processing_error": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call_id).execute()

            logger.info(f"Downloaded: {call_id} -> {storage_path}")
        except Exception as e:
            logger.error(f"Failed to mark {call_id} as downloaded: {e}")
            raise

    def mark_failed(self, call_id: str, error: str) -> None:
        """
        Mark call as permanently failed.

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

            logger.warning(f"Failed: {call_id} - {error[:100]}")
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
# DOWNLOAD LOGIC
# =============================================================================
def generate_storage_path(call_id: str, start_time_utc: str) -> str:
    """
    Generate storage path for audio file.

    Format: YYYY/MM/DD/{call_id}.mp3
    Uses call's start_time_utc to organize by date.

    Args:
        call_id: UUID of the call
        start_time_utc: ISO timestamp of call start

    Returns:
        Storage path string
    """
    try:
        # Parse the timestamp
        if isinstance(start_time_utc, str):
            dt = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
        else:
            dt = start_time_utc
    except (ValueError, TypeError):
        # Fallback to today's date
        dt = datetime.now(timezone.utc)

    return f"{dt.year}/{dt.month:02d}/{dt.day:02d}/{call_id}.mp3"


def download_audio(url: str, timeout: int = DOWNLOAD_TIMEOUT) -> bytes:
    """
    Download audio from URL.

    Args:
        url: Audio URL (Ringba recording URL)
        timeout: Request timeout in seconds

    Returns:
        Audio file bytes

    Raises:
        requests.HTTPError: For HTTP errors
        requests.Timeout: For timeout
    """
    response = requests.get(
        url,
        timeout=timeout,
        headers={
            "User-Agent": "CallScript/2.0 AudioVault",
            "Accept": "audio/*",
        },
        stream=True,
    )
    response.raise_for_status()
    return response.content


def process_single_call(
    call: dict[str, Any],
    repo: VaultRepository,
) -> tuple[str, bool, str]:
    """
    Process a single call: download and upload audio.

    Args:
        call: Call dict with id, audio_url, start_time_utc
        repo: Vault repository instance

    Returns:
        Tuple of (call_id, success, message)
    """
    call_id = call["id"]
    audio_url = call.get("audio_url")
    start_time = call.get("start_time_utc", "")

    # Validate audio URL
    if not audio_url:
        repo.mark_failed(call_id, "Audio URL is missing")
        return (call_id, False, "Missing audio URL")

    try:
        # Step 1: Download from Ringba
        audio_bytes = download_audio(audio_url)

        if len(audio_bytes) == 0:
            repo.mark_failed(call_id, "Downloaded audio is empty (0 bytes)")
            return (call_id, False, "Empty audio file")

        # Step 2: Generate storage path
        storage_path = generate_storage_path(call_id, start_time)

        # Step 3: Upload to Supabase Storage
        repo.upload_audio(storage_path, audio_bytes)

        # Step 4: Update database
        repo.mark_downloaded(call_id, storage_path)

        return (call_id, True, f"OK ({len(audio_bytes)} bytes)")

    except requests.HTTPError as e:
        status_code = e.response.status_code if e.response else 0

        if status_code in PERMANENT_FAILURE_CODES:
            # Permanent failure - mark as failed immediately
            error_msg = f"Audio URL expired or unavailable (HTTP {status_code})"
            repo.mark_failed(call_id, error_msg)
            return (call_id, False, error_msg)
        else:
            # Transient error - leave as pending for retry
            error_msg = f"HTTP error {status_code} - will retry"
            logger.warning(f"{call_id}: {error_msg}")
            return (call_id, False, error_msg)

    except requests.Timeout:
        # Transient error - leave as pending
        error_msg = "Download timeout - will retry"
        logger.warning(f"{call_id}: {error_msg}")
        return (call_id, False, error_msg)

    except requests.RequestException as e:
        # Network error - leave as pending
        error_msg = f"Network error: {str(e)[:100]} - will retry"
        logger.warning(f"{call_id}: {error_msg}")
        return (call_id, False, error_msg)

    except Exception as e:
        # Unexpected error - log but don't mark failed (might be transient)
        error_msg = f"Unexpected error: {str(e)[:100]}"
        logger.error(f"{call_id}: {error_msg}")
        return (call_id, False, error_msg)


def process_batch(
    calls: list[dict[str, Any]],
    repo: VaultRepository,
    max_workers: int = MAX_WORKERS,
) -> tuple[int, int]:
    """
    Process a batch of calls concurrently.

    Args:
        calls: List of call dicts
        repo: Vault repository
        max_workers: Maximum concurrent downloads

    Returns:
        Tuple of (success_count, failure_count)
    """
    success_count = 0
    failure_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all downloads
        futures = {
            executor.submit(process_single_call, call, repo): call["id"]
            for call in calls
        }

        # Collect results
        for future in as_completed(futures):
            call_id = futures[future]
            try:
                _, success, message = future.result()
                if success:
                    success_count += 1
                else:
                    failure_count += 1
            except Exception as e:
                logger.error(f"Unexpected error processing {call_id}: {e}")
                failure_count += 1

    return success_count, failure_count


# =============================================================================
# MAIN LOOP
# =============================================================================
def main():
    """Main worker entry point."""
    global logger

    # Initialize settings and logging
    settings = get_settings()
    logger = setup_logging("vault", f"{settings.log_dir}/vault.log", settings.log_level)

    logger.info("=" * 60)
    logger.info("CallScript V2 Vault Worker Starting")
    logger.info("=" * 60)

    # Setup signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Connect to Supabase
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = VaultRepository(client)
        logger.info("Connected to Supabase")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # Log initial stats
    stats = repo.get_queue_stats()
    logger.info(f"Queue stats: pending={stats.get('pending', 0)}, downloaded={stats.get('downloaded', 0)}")
    logger.info(f"Config: batch_size={BATCH_SIZE}, max_workers={MAX_WORKERS}, timeout={DOWNLOAD_TIMEOUT}s")
    logger.info("=" * 60)

    # Main loop
    total_success = 0
    total_failure = 0
    batch_count = 0

    while not shutdown_requested:
        try:
            # Fetch batch of pending calls
            calls = repo.fetch_pending_calls(limit=BATCH_SIZE)

            if not calls:
                # Queue empty - wait and retry
                logger.debug(f"Queue empty, waiting {POLL_INTERVAL}s...")
                time.sleep(POLL_INTERVAL)
                continue

            batch_count += 1
            logger.info(f"Batch {batch_count}: Processing {len(calls)} calls...")

            # Process batch concurrently
            success, failure = process_batch(calls, repo, MAX_WORKERS)

            total_success += success
            total_failure += failure

            logger.info(f"Batch {batch_count} complete: {success} success, {failure} failed")

            # Log milestone every 100 successful downloads
            if total_success > 0 and total_success % 100 == 0:
                logger.info(f"Milestone: {total_success} total downloads")

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
            break

        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            time.sleep(5)  # Back off on errors

    # Shutdown summary
    logger.info("=" * 60)
    logger.info(f"Vault Worker Shutdown")
    logger.info(f"Total: {total_success} success, {total_failure} failed")
    logger.info(f"Batches processed: {batch_count}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
