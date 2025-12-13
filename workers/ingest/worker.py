#!/usr/bin/env python3
"""
CallScript V2 - Ingest Lane Worker

Syncs call metadata from Ringba API to Supabase database.
This is the entry point for all calls into the system.

Architecture:
- Polls Ringba every 60 seconds
- Fetches last 5 minutes of call data (overlapping windows for reliability)
- Upserts to database with deduplication on ringba_call_id
- Does NOT overwrite status on conflict (preserves pipeline progress)

Usage:
    # Normal mode (continuous, last 5 minutes)
    python workers/ingest/worker.py

    # Backfill mode (one-time, last N hours)
    python workers/ingest/worker.py --backfill --hours 24

    # Backfill mode (one-time, specific date range)
    python workers/ingest/worker.py --backfill --start "2025-12-01" --end "2025-12-10"

    # Backfill mode (one-time, last N days)
    python workers/ingest/worker.py --backfill --days 7

Server: RunPod (Ubuntu 22.04) or any Linux server
Database: Supabase (PostgreSQL)
API: Ringba Call Logs
"""

import argparse
import logging
import signal
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import requests
from supabase import create_client

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from workers.core import get_settings, setup_logging

# =============================================================================
# CONFIGURATION
# =============================================================================
SYNC_INTERVAL = 60  # Seconds between sync cycles
LOOKBACK_MINUTES = 5  # How far back to fetch (overlap for reliability)
PAGE_SIZE = 1000  # Ringba API page size
REQUEST_TIMEOUT = 30  # API request timeout

# Default Organization ID (from migration 01_core_schema.sql)
DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001"

# Ringba API columns to fetch
RINGBA_COLUMNS = [
    {"column": "callDt"},
    {"column": "inboundPhoneNumber"},
    {"column": "buyer"},
    {"column": "callLengthInSeconds"},
    {"column": "campaignId"},
    {"column": "campaignName"},
    {"column": "publisherId"},
    {"column": "conversionAmount"},
    {"column": "payoutAmount"},
    {"column": "recordingUrl"},
    {"column": "inboundCallId"},
]

# =============================================================================
# GLOBALS
# =============================================================================
shutdown_requested = False
logger: logging.Logger


def signal_handler(sig, frame):
    """Handle graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    logger.info("Shutdown signal received, finishing current sync...")


# =============================================================================
# INGEST REPOSITORY
# =============================================================================
class IngestRepository:
    """
    Repository for Ingest Lane operations.

    Handles:
    - Upserting calls with deduplication
    - Managing campaigns
    - Preserving status on conflict
    """

    def __init__(self, client):
        """
        Initialize repository.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")
        self._campaign_cache: dict[str, str] = {}  # ringba_campaign_id -> uuid

    def ensure_campaign(
        self, ringba_campaign_id: str, campaign_name: str, org_id: str
    ) -> Optional[str]:
        """
        Ensure campaign exists and return its UUID.

        Uses cache to minimize database queries.

        Args:
            ringba_campaign_id: Ringba's campaign ID
            campaign_name: Campaign name from Ringba
            org_id: Organization UUID

        Returns:
            Campaign UUID or None if creation failed
        """
        if not ringba_campaign_id:
            return None

        # Check cache first
        if ringba_campaign_id in self._campaign_cache:
            return self._campaign_cache[ringba_campaign_id]

        try:
            # Try to find existing
            response = (
                self.schema.from_("campaigns")
                .select("id")
                .eq("ringba_campaign_id", ringba_campaign_id)
                .eq("org_id", org_id)
                .maybe_single()
                .execute()
            )

            if response.data:
                self._campaign_cache[ringba_campaign_id] = response.data["id"]
                return response.data["id"]

            # Create new campaign
            response = (
                self.schema.from_("campaigns")
                .insert(
                    {
                        "ringba_campaign_id": ringba_campaign_id,
                        "name": campaign_name or "Unknown Campaign",
                        "org_id": org_id,
                    }
                )
                .select("id")
                .single()
                .execute()
            )

            campaign_id = response.data["id"]
            self._campaign_cache[ringba_campaign_id] = campaign_id
            logger.info(f"Created campaign: {campaign_name} ({ringba_campaign_id[:8]}...)")
            return campaign_id

        except Exception as e:
            # May fail due to race condition - try to fetch again
            logger.warning(f"Campaign upsert conflict, refetching: {e}")
            try:
                response = (
                    self.schema.from_("campaigns")
                    .select("id")
                    .eq("ringba_campaign_id", ringba_campaign_id)
                    .eq("org_id", org_id)
                    .single()
                    .execute()
                )
                if response.data:
                    self._campaign_cache[ringba_campaign_id] = response.data["id"]
                    return response.data["id"]
            except Exception:
                pass
            return None

    def upsert_calls(self, calls: list[dict[str, Any]]) -> tuple[int, int]:
        """
        Upsert calls to database with smart conflict handling.

        On conflict (ringba_call_id exists):
        - DO NOT update status (preserves pipeline progress)
        - Only update mutable fields: audio_url, duration_seconds, revenue

        Args:
            calls: List of call records to upsert

        Returns:
            Tuple of (total_processed, new_inserted)
        """
        if not calls:
            return 0, 0

        # Get existing call IDs to determine what's new
        ringba_ids = [c["ringba_call_id"] for c in calls if c.get("ringba_call_id")]

        try:
            existing_response = (
                self.schema.from_("calls")
                .select("ringba_call_id")
                .in_("ringba_call_id", ringba_ids)
                .execute()
            )
            existing_ids = {r["ringba_call_id"] for r in (existing_response.data or [])}
        except Exception as e:
            logger.warning(f"Failed to check existing calls: {e}")
            existing_ids = set()

        # Split into new vs existing
        new_calls = [c for c in calls if c["ringba_call_id"] not in existing_ids]
        existing_calls = [c for c in calls if c["ringba_call_id"] in existing_ids]

        inserted = 0
        updated = 0

        # Insert new calls (with status = 'pending')
        if new_calls:
            try:
                self.schema.from_("calls").insert(new_calls).execute()
                inserted = len(new_calls)
                logger.debug(f"Inserted {inserted} new calls")
            except Exception as e:
                logger.error(f"Failed to insert new calls: {e}")

        # Update existing calls (only mutable fields, NOT status)
        for call in existing_calls:
            try:
                update_data = {
                    "audio_url": call.get("audio_url"),
                    "duration_seconds": call.get("duration_seconds"),
                    "revenue": call.get("revenue"),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                # Remove None values
                update_data = {k: v for k, v in update_data.items() if v is not None}

                if update_data:
                    self.schema.from_("calls").update(update_data).eq(
                        "ringba_call_id", call["ringba_call_id"]
                    ).execute()
                    updated += 1
            except Exception as e:
                logger.warning(f"Failed to update call {call['ringba_call_id'][:8]}...: {e}")

        return len(calls), inserted

    def get_queue_stats(self) -> dict[str, int]:
        """Get count of calls by status."""
        stats = {}
        for status in [
            "pending",
            "downloaded",
            "processing",
            "transcribed",
            "flagged",
            "safe",
            "failed",
        ]:
            try:
                response = (
                    self.schema.from_("calls")
                    .select("id", count="exact")
                    .eq("status", status)
                    .execute()
                )
                stats[status] = response.count or 0
            except Exception:
                stats[status] = -1
        return stats


# =============================================================================
# RINGBA API
# =============================================================================
def fetch_ringba_calls(
    account_id: str,
    token: str,
    start_time: datetime,
    end_time: datetime,
) -> list[dict[str, Any]]:
    """
    Fetch call logs from Ringba API.

    Uses pagination to handle large result sets.

    Args:
        account_id: Ringba account ID
        token: Ringba API token
        start_time: Start of time window
        end_time: End of time window

    Returns:
        List of call records from Ringba
    """
    all_records = []
    offset = 0

    while True:
        payload = {
            "reportStart": start_time.isoformat(),
            "reportEnd": end_time.isoformat(),
            "size": PAGE_SIZE,
            "offset": offset,
            "valueColumns": RINGBA_COLUMNS,
        }

        try:
            response = requests.post(
                f"https://api.ringba.com/v2/{account_id}/calllogs",
                headers={
                    "Authorization": f"Token {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )

            response.raise_for_status()
            data = response.json()

            records = data.get("report", {}).get("records", [])
            partial_result = data.get("report", {}).get("partialResult", False)

            logger.debug(f"Fetched {len(records)} records at offset {offset}")

            # Terminate on empty, partial, or incomplete page
            if not records or partial_result:
                break

            all_records.extend(records)

            # Stop if we got less than page size (last page)
            if len(records) < PAGE_SIZE:
                break

            offset += PAGE_SIZE

        except requests.HTTPError as e:
            if e.response.status_code in (401, 403):
                logger.error(f"Ringba auth error: {e.response.status_code}")
                raise ValueError("Invalid Ringba credentials")
            raise

        except requests.RequestException as e:
            logger.error(f"Ringba API error: {e}")
            raise

    return all_records


def map_ringba_to_call(
    record: dict[str, Any],
    org_id: str,
    campaign_id: Optional[str],
) -> dict[str, Any]:
    """
    Map Ringba record to database call format.

    Args:
        record: Ringba call record
        org_id: Organization UUID
        campaign_id: Campaign UUID (may be None)

    Returns:
        Dict ready for database insert
    """
    # Parse call datetime
    call_dt = record.get("callDt")
    if call_dt:
        try:
            if isinstance(call_dt, (int, float)):
                start_time = datetime.fromtimestamp(call_dt / 1000, tz=timezone.utc)
            else:
                start_time = datetime.fromisoformat(call_dt.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            start_time = datetime.now(timezone.utc)
    else:
        start_time = datetime.now(timezone.utc)

    return {
        "ringba_call_id": record.get("inboundCallId"),
        "org_id": org_id,
        "campaign_id": campaign_id,
        "start_time_utc": start_time.isoformat(),
        "caller_number": record.get("inboundPhoneNumber"),
        "duration_seconds": record.get("callLengthInSeconds"),
        "revenue": record.get("conversionAmount", 0) or 0,
        "audio_url": record.get("recordingUrl"),
        "status": "pending",
    }


# =============================================================================
# SYNC LOGIC
# =============================================================================
def run_sync_cycle(
    repo: IngestRepository,
    account_id: str,
    token: str,
    lookback_minutes: int = LOOKBACK_MINUTES,
) -> tuple[int, int]:
    """
    Run a single sync cycle.

    Args:
        repo: Ingest repository
        account_id: Ringba account ID
        token: Ringba API token
        lookback_minutes: How far back to fetch

    Returns:
        Tuple of (fetched_count, inserted_count)
    """
    # Calculate time window: NOW - 5 minutes to NOW
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(minutes=lookback_minutes)

    logger.info(f"Syncing {start_time.strftime('%H:%M:%S')} -> {now.strftime('%H:%M:%S')} UTC")

    # Fetch from Ringba
    records = fetch_ringba_calls(account_id, token, start_time, now)

    if not records:
        logger.debug("No new records from Ringba")
        return 0, 0

    logger.info(f"Fetched {len(records)} records from Ringba")

    # Process campaigns and map calls
    calls = []
    for record in records:
        ringba_call_id = record.get("inboundCallId")
        if not ringba_call_id:
            continue

        # Ensure campaign exists
        campaign_id = None
        ringba_campaign_id = record.get("campaignId")
        if ringba_campaign_id:
            campaign_id = repo.ensure_campaign(
                ringba_campaign_id,
                record.get("campaignName", "Unknown"),
                DEFAULT_ORG_ID,
            )

        # Map to database format
        call = map_ringba_to_call(record, DEFAULT_ORG_ID, campaign_id)
        calls.append(call)

    # Upsert to database (preserves status on conflict)
    total, inserted = repo.upsert_calls(calls)

    logger.info(f"Processed {total} calls: {inserted} new, {total - inserted} updated")

    return len(records), inserted


# =============================================================================
# BACKFILL LOGIC
# =============================================================================
def run_backfill(
    repo: IngestRepository,
    account_id: str,
    token: str,
    start_time: datetime,
    end_time: datetime,
    chunk_hours: int = 24,
) -> tuple[int, int]:
    """
    Run backfill for a date range, chunked into smaller windows.

    Args:
        repo: Ingest repository
        account_id: Ringba account ID
        token: Ringba API token
        start_time: Start of backfill window
        end_time: End of backfill window
        chunk_hours: Size of each chunk in hours (default 24)

    Returns:
        Tuple of (total_fetched, total_inserted)
    """
    total_fetched = 0
    total_inserted = 0
    chunk_count = 0

    current_start = start_time
    chunk_delta = timedelta(hours=chunk_hours)

    logger.info(f"Backfill: {start_time.strftime('%Y-%m-%d %H:%M')} -> {end_time.strftime('%Y-%m-%d %H:%M')} UTC")
    logger.info(f"Chunk size: {chunk_hours} hours")

    while current_start < end_time:
        current_end = min(current_start + chunk_delta, end_time)
        chunk_count += 1

        logger.info(f"[Chunk {chunk_count}] {current_start.strftime('%Y-%m-%d %H:%M')} -> {current_end.strftime('%Y-%m-%d %H:%M')}")

        try:
            # Fetch from Ringba
            records = fetch_ringba_calls(account_id, token, current_start, current_end)

            if records:
                logger.info(f"  Fetched {len(records)} records")

                # Process campaigns and map calls
                calls = []
                for record in records:
                    ringba_call_id = record.get("inboundCallId")
                    if not ringba_call_id:
                        continue

                    campaign_id = None
                    ringba_campaign_id = record.get("campaignId")
                    if ringba_campaign_id:
                        campaign_id = repo.ensure_campaign(
                            ringba_campaign_id,
                            record.get("campaignName", "Unknown"),
                            DEFAULT_ORG_ID,
                        )

                    call = map_ringba_to_call(record, DEFAULT_ORG_ID, campaign_id)
                    calls.append(call)

                # Upsert to database
                total, inserted = repo.upsert_calls(calls)
                total_fetched += len(records)
                total_inserted += inserted

                logger.info(f"  Processed: {inserted} new, {total - inserted} existing")
            else:
                logger.info("  No records in this chunk")

            # Rate limiting: 1 second between chunks to avoid Ringba throttling
            time.sleep(1)

        except Exception as e:
            logger.error(f"  Error in chunk {chunk_count}: {e}")
            # Continue to next chunk

        current_start = current_end

    return total_fetched, total_inserted


# =============================================================================
# MAIN LOOP
# =============================================================================
def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="CallScript V2 Ingest Worker",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Run in backfill mode (one-time, then exit)",
    )
    parser.add_argument(
        "--hours",
        type=int,
        help="Backfill last N hours (e.g., --hours 24)",
    )
    parser.add_argument(
        "--days",
        type=int,
        help="Backfill last N days (e.g., --days 7)",
    )
    parser.add_argument(
        "--start",
        type=str,
        help="Backfill start date (YYYY-MM-DD or YYYY-MM-DD HH:MM)",
    )
    parser.add_argument(
        "--end",
        type=str,
        help="Backfill end date (YYYY-MM-DD or YYYY-MM-DD HH:MM)",
    )
    parser.add_argument(
        "--chunk-hours",
        type=int,
        default=24,
        help="Chunk size in hours for backfill (default: 24)",
    )
    return parser.parse_args()


def parse_datetime(date_str: str) -> datetime:
    """Parse datetime string in various formats."""
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Could not parse date: {date_str}")


def main():
    """Main worker entry point."""
    global logger

    args = parse_args()

    # Initialize settings and logging
    settings = get_settings()
    logger = setup_logging("ingest", f"{settings.log_dir}/ingest.log", settings.log_level)

    logger.info("=" * 60)
    if args.backfill:
        logger.info("CallScript V2 Ingest Worker - BACKFILL MODE")
    else:
        logger.info("CallScript V2 Ingest Worker Starting")
    logger.info("=" * 60)

    # Setup signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Validate Ringba credentials
    try:
        account_id, token = settings.require_ringba()
        logger.info(f"Ringba account: {account_id[:12]}...")
    except ValueError as e:
        logger.critical(str(e))
        sys.exit(1)

    # Connect to Supabase
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = IngestRepository(client)
        logger.info("Connected to Supabase")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # Log configuration
    logger.info(f"Default org_id: {DEFAULT_ORG_ID}")

    # Log initial stats
    stats = repo.get_queue_stats()
    logger.info(f"Queue stats: pending={stats.get('pending', 0)}, total={sum(v for v in stats.values() if v > 0)}")
    logger.info("=" * 60)

    # ==========================================================================
    # BACKFILL MODE
    # ==========================================================================
    if args.backfill:
        now = datetime.now(timezone.utc)

        # Determine time range
        if args.start and args.end:
            start_time = parse_datetime(args.start)
            end_time = parse_datetime(args.end)
        elif args.hours:
            end_time = now
            start_time = now - timedelta(hours=args.hours)
        elif args.days:
            end_time = now
            start_time = now - timedelta(days=args.days)
        else:
            logger.error("Backfill mode requires --hours, --days, or --start/--end")
            sys.exit(1)

        # Run backfill
        total_fetched, total_inserted = run_backfill(
            repo,
            account_id,
            token,
            start_time,
            end_time,
            chunk_hours=args.chunk_hours,
        )

        # Summary
        logger.info("=" * 60)
        logger.info("BACKFILL COMPLETE")
        logger.info(f"Total fetched: {total_fetched}")
        logger.info(f"Total inserted: {total_inserted}")
        stats = repo.get_queue_stats()
        logger.info(f"Queue stats: pending={stats.get('pending', 0)}, total={sum(v for v in stats.values() if v > 0)}")
        logger.info("=" * 60)
        return

    # ==========================================================================
    # NORMAL MODE (continuous loop)
    # ==========================================================================
    logger.info(f"Config: interval={SYNC_INTERVAL}s, lookback={LOOKBACK_MINUTES}min")

    total_fetched = 0
    total_inserted = 0
    sync_count = 0

    while not shutdown_requested:
        try:
            sync_count += 1
            fetched, inserted = run_sync_cycle(repo, account_id, token)

            total_fetched += fetched
            total_inserted += inserted

            # Log milestone every 10 syncs
            if sync_count % 10 == 0:
                stats = repo.get_queue_stats()
                logger.info(
                    f"Sync #{sync_count} | Session: {total_fetched} fetched, {total_inserted} inserted | "
                    f"Pending: {stats.get('pending', 0)}"
                )

            # Wait for next sync
            logger.debug(f"Sleeping {SYNC_INTERVAL}s until next sync...")
            time.sleep(SYNC_INTERVAL)

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
            break

        except ValueError as e:
            # Configuration error - exit
            logger.critical(str(e))
            break

        except Exception as e:
            logger.error(f"Sync error: {e}")
            # Continue running, will retry next cycle
            time.sleep(SYNC_INTERVAL)

    # Shutdown summary
    logger.info("=" * 60)
    logger.info("Ingest Worker Shutdown")
    logger.info(f"Total syncs: {sync_count}")
    logger.info(f"Total fetched: {total_fetched}")
    logger.info(f"Total inserted: {total_inserted}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
