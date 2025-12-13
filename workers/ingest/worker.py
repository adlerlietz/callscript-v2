#!/usr/bin/env python3
"""
CallScript V2 - Ingest Lane Worker

Syncs call metadata from Ringba API to Supabase database.
This is the entry point for all calls into the system.

Architecture:
- Polls Ringba every 60 seconds
- Fetches last 5 minutes of call data (overlapping windows for reliability)
- Upserts to database with deduplication on ringba_call_id
- Sets org_id for multi-tenant support

Server: RunPod (Ubuntu 22.04) or any Linux server
Database: Supabase (PostgreSQL)
API: Ringba Call Logs
"""

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
DEFAULT_ORG_SLUG = "default"  # Organization slug to use

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
    - Looking up default organization
    - Upserting calls with deduplication
    - Managing campaigns
    """

    def __init__(self, client):
        """
        Initialize repository.

        Args:
            client: Authenticated Supabase client
        """
        self.client = client
        self.schema = client.schema("core")
        self._org_id_cache: Optional[str] = None
        self._campaign_cache: dict[str, str] = {}  # ringba_campaign_id -> uuid

    def get_default_org_id(self) -> str:
        """
        Get the default organization ID.

        Caches the result to avoid repeated queries.

        Returns:
            UUID of the default organization

        Raises:
            ValueError: If default org doesn't exist
        """
        if self._org_id_cache is not None:
            return self._org_id_cache

        try:
            response = (
                self.schema
                .from_("organizations")
                .select("id")
                .eq("slug", DEFAULT_ORG_SLUG)
                .single()
                .execute()
            )

            if not response.data:
                raise ValueError(f"Default organization '{DEFAULT_ORG_SLUG}' not found")

            self._org_id_cache = response.data["id"]
            logger.info(f"Cached default org_id: {self._org_id_cache}")
            return self._org_id_cache

        except Exception as e:
            logger.error(f"Failed to get default org: {e}")
            raise

    def ensure_campaign(self, ringba_campaign_id: str, campaign_name: str, org_id: str) -> Optional[str]:
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
        # Check cache first
        if ringba_campaign_id in self._campaign_cache:
            return self._campaign_cache[ringba_campaign_id]

        try:
            # Try to find existing
            response = (
                self.schema
                .from_("campaigns")
                .select("id")
                .eq("ringba_campaign_id", ringba_campaign_id)
                .eq("org_id", org_id)
                .maybeSingle()
                .execute()
            )

            if response.data:
                self._campaign_cache[ringba_campaign_id] = response.data["id"]
                return response.data["id"]

            # Create new campaign
            response = (
                self.schema
                .from_("campaigns")
                .insert({
                    "ringba_campaign_id": ringba_campaign_id,
                    "name": campaign_name or "Unknown Campaign",
                    "org_id": org_id,
                })
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
                    self.schema
                    .from_("campaigns")
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
        Upsert calls to database with deduplication.

        Args:
            calls: List of call records to upsert

        Returns:
            Tuple of (inserted_count, updated_count)
        """
        if not calls:
            return 0, 0

        try:
            # Upsert with conflict on ringba_call_id
            # ignoreDuplicates=False means we update existing records
            response = (
                self.schema
                .from_("calls")
                .upsert(
                    calls,
                    on_conflict="ringba_call_id",
                    ignore_duplicates=True,  # Don't update existing (preserve status)
                )
                .execute()
            )

            # Count results (approximation since upsert doesn't distinguish)
            return len(calls), 0

        except Exception as e:
            logger.error(f"Failed to upsert calls: {e}")
            raise

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
        # Ringba returns ISO format or Unix timestamp
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
        Tuple of (fetched_count, upserted_count)
    """
    # Calculate time window
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(minutes=lookback_minutes)

    logger.info(f"Syncing {start_time.strftime('%H:%M:%S')} -> {now.strftime('%H:%M:%S')} UTC")

    # Get default org_id (cached after first call)
    org_id = repo.get_default_org_id()

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
                org_id,
            )

        # Map to database format
        call = map_ringba_to_call(record, org_id, campaign_id)
        calls.append(call)

    # Upsert to database
    inserted, updated = repo.upsert_calls(calls)

    logger.info(f"Upserted {inserted} calls (deduped from {len(records)} records)")

    return len(records), inserted


# =============================================================================
# MAIN LOOP
# =============================================================================
def main():
    """Main worker entry point."""
    global logger

    # Initialize settings and logging
    settings = get_settings()
    logger = setup_logging("ingest", f"{settings.log_dir}/ingest.log", settings.log_level)

    logger.info("=" * 60)
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

    # Verify default org exists
    try:
        org_id = repo.get_default_org_id()
        logger.info(f"Default org: {org_id}")
    except ValueError as e:
        logger.critical(str(e))
        sys.exit(1)

    # Log initial stats
    stats = repo.get_queue_stats()
    logger.info(f"Queue stats: pending={stats.get('pending', 0)}, total={sum(stats.values())}")
    logger.info(f"Config: interval={SYNC_INTERVAL}s, lookback={LOOKBACK_MINUTES}min")
    logger.info("=" * 60)

    # Main loop
    total_fetched = 0
    total_upserted = 0
    sync_count = 0

    while not shutdown_requested:
        try:
            sync_count += 1
            fetched, upserted = run_sync_cycle(repo, account_id, token)

            total_fetched += fetched
            total_upserted += upserted

            # Log milestone every 10 syncs
            if sync_count % 10 == 0:
                stats = repo.get_queue_stats()
                logger.info(
                    f"Sync #{sync_count} | Total: {total_fetched} fetched, {total_upserted} upserted | "
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
    logger.info(f"Total upserted: {total_upserted}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
