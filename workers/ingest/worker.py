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

Multi-Org Support:
- Single-tenant: Uses RINGBA_ACCOUNT_ID and RINGBA_TOKEN from env vars
- Multi-tenant: Fetches credentials per-org from organization_credentials table

Usage:
    # Normal mode (continuous, last 5 minutes, single-tenant)
    python workers/ingest/worker.py

    # Multi-org mode (fetches all orgs with Ringba credentials)
    python workers/ingest/worker.py --multi-org

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
# NOTE: All fields listed here are returned by Ringba API and mapped in map_ringba_to_call()
# IMPORTANT: Only include columns that exist in the Ringba account - unknown columns cause 422 errors
RINGBA_COLUMNS = [
    # Core identifiers
    {"column": "inboundCallId"},
    {"column": "callDt"},
    {"column": "callLengthInSeconds"},
    {"column": "inboundPhoneNumber"},
    {"column": "recordingUrl"},
    # Campaign
    {"column": "campaignId"},
    {"column": "campaignName"},
    # Publisher attribution (critical for analytics)
    {"column": "publisherId"},
    {"column": "publisherSubId"},
    {"column": "publisherName"},
    # Buyer/Target routing
    {"column": "buyer"},
    {"column": "targetId"},
    {"column": "targetName"},
    # Financial
    {"column": "conversionAmount"},  # Maps to revenue
    {"column": "payoutAmount"},      # Maps to payout
    # NOTE: Operational metrics columns (endCallSource, callStatus, etc.) are NOT available
    # in this Ringba account. The database columns exist but remain NULL.
    # To populate them, use the raw_payload JSONB field in backfill operations.
]

# =============================================================================
# GLOBALS
# =============================================================================
shutdown_requested = False
logger: logging.Logger
# Area code to state mapping (loaded once from database)
AREA_CODE_MAP: dict[str, str] = {}


def signal_handler(sig, frame):
    """Handle graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    logger.info("Shutdown signal received, finishing current sync...")


def load_area_codes(client) -> dict[str, str]:
    """
    Load area code to state mapping from database.

    Args:
        client: Supabase client

    Returns:
        Dict mapping area code (str) to state abbreviation (str)
    """
    try:
        response = client.schema("core").from_("area_code_states").select("area_code, state").execute()
        if response.data:
            return {row["area_code"]: row["state"] for row in response.data}
    except Exception as e:
        logger.warning(f"Failed to load area codes (table may not exist yet): {e}")
    return {}


def get_state_from_phone(phone_number: Optional[str]) -> Optional[str]:
    """
    Extract US state from phone number using area code lookup.

    Handles formats: +1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX, (XXX) XXX-XXXX

    Args:
        phone_number: Caller phone number in any format

    Returns:
        Two-letter state abbreviation or None if not found
    """
    global AREA_CODE_MAP

    if not phone_number or not AREA_CODE_MAP:
        return None

    # Remove all non-digits
    import re
    digits = re.sub(r'[^0-9]', '', phone_number)

    # Extract area code based on format
    area_code = None
    if len(digits) == 11 and digits.startswith('1'):
        # +1XXXXXXXXXX or 1XXXXXXXXXX
        area_code = digits[1:4]
    elif len(digits) == 10:
        # XXXXXXXXXX
        area_code = digits[0:3]

    if area_code:
        return AREA_CODE_MAP.get(area_code)

    return None


# =============================================================================
# MULTI-ORG CREDENTIAL FETCHING
# =============================================================================
def get_active_org_credentials(client) -> list[dict[str, Any]]:
    """
    Fetch all active organizations with valid Ringba credentials.

    Uses the organization_credentials table to get decrypted credentials.
    Only returns orgs with active status and valid credentials.

    Args:
        client: Supabase client

    Returns:
        List of dicts with org_id, account_id, and token
    """
    try:
        # Call the RPC function to get credentials for all orgs
        response = client.rpc(
            "get_all_org_ringba_credentials"
        ).execute()

        if not response.data:
            return []

        # Filter to only those with both account_id and token
        orgs = []
        for row in response.data:
            if row.get("account_id") and row.get("token"):
                orgs.append({
                    "org_id": row["org_id"],
                    "org_name": row.get("org_name", "Unknown"),
                    "account_id": row["account_id"],
                    "token": row["token"],
                })

        return orgs

    except Exception as e:
        logger.warning(f"Failed to fetch org credentials (may need migration): {e}")
        return []


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
        self._campaign_cache: dict[str, dict[str, Any]] = {}  # ringba_campaign_id -> {id, vertical}

    def ensure_campaign(
        self, ringba_campaign_id: str, campaign_name: str, org_id: str
    ) -> Optional[dict[str, Any]]:
        """
        Ensure campaign exists and return campaign info.

        Uses cache to minimize database queries.

        Args:
            ringba_campaign_id: Ringba's campaign ID
            campaign_name: Campaign name from Ringba
            org_id: Organization UUID

        Returns:
            Dict with 'id' and 'vertical' or None if creation failed
        """
        if not ringba_campaign_id:
            return None

        # Check cache first
        if ringba_campaign_id in self._campaign_cache:
            return self._campaign_cache[ringba_campaign_id]

        try:
            # Try to find existing (include vertical for denormalization)
            response = (
                self.schema.from_("campaigns")
                .select("id, vertical")
                .eq("ringba_campaign_id", ringba_campaign_id)
                .eq("org_id", org_id)
                .maybe_single()
                .execute()
            )

            if response.data:
                campaign_info = {"id": response.data["id"], "vertical": response.data.get("vertical")}
                self._campaign_cache[ringba_campaign_id] = campaign_info
                return campaign_info

            # Create new campaign (vertical is set by trigger infer_campaign_vertical)
            response = (
                self.schema.from_("campaigns")
                .insert(
                    {
                        "ringba_campaign_id": ringba_campaign_id,
                        "name": campaign_name or "Unknown Campaign",
                        "org_id": org_id,
                    }
                )
                .select("id, vertical")
                .single()
                .execute()
            )

            campaign_info = {"id": response.data["id"], "vertical": response.data.get("vertical")}
            self._campaign_cache[ringba_campaign_id] = campaign_info
            logger.info(f"Created campaign: {campaign_name} ({ringba_campaign_id[:8]}...)")
            return campaign_info

        except Exception as e:
            # May fail due to race condition - try to fetch again
            logger.warning(f"Campaign upsert conflict, refetching: {e}")
            try:
                response = (
                    self.schema.from_("campaigns")
                    .select("id, vertical")
                    .eq("ringba_campaign_id", ringba_campaign_id)
                    .eq("org_id", org_id)
                    .single()
                    .execute()
                )
                if response.data:
                    campaign_info = {"id": response.data["id"], "vertical": response.data.get("vertical")}
                    self._campaign_cache[ringba_campaign_id] = campaign_info
                    return campaign_info
            except Exception:
                pass
            return None

    def upsert_calls(
        self, calls: list[dict[str, Any]], force_update: bool = False
    ) -> tuple[int, int]:
        """
        Upsert calls to database with smart conflict handling.

        On conflict (ringba_call_id exists):
        - DO NOT update status (preserves pipeline progress)
        - Normal mode: Only update mutable fields: audio_url, duration_seconds, revenue
        - Force update mode: Update all analytics fields (for backfill)

        Args:
            calls: List of call records to upsert
            force_update: If True, update all analytics columns on existing records
                          (used for backfilling new columns to historical data)

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

        # Update existing calls
        for call in existing_calls:
            try:
                if force_update:
                    # FORCE UPDATE MODE: Update all analytics columns
                    # CRITICAL: Do NOT update pipeline fields (status, transcript, qa_flags, storage_path)
                    update_data = {
                        # Core metadata (safe to update)
                        "audio_url": call.get("audio_url"),
                        "duration_seconds": call.get("duration_seconds"),
                        # Financial
                        "revenue": call.get("revenue"),
                        "payout": call.get("payout"),
                        # Publisher attribution
                        "publisher_id": call.get("publisher_id"),
                        "publisher_sub_id": call.get("publisher_sub_id"),
                        "publisher_name": call.get("publisher_name"),
                        # Buyer/Target routing
                        "buyer_name": call.get("buyer_name"),
                        "target_id": call.get("target_id"),
                        "target_name": call.get("target_name"),
                        # Geographic
                        "caller_state": call.get("caller_state"),
                        "caller_city": call.get("caller_city"),
                        # Operational metrics (Phase 3)
                        "end_call_source": call.get("end_call_source"),
                        "call_status": call.get("call_status"),
                        "connected_duration": call.get("connected_duration"),
                        "time_to_answer": call.get("time_to_answer"),
                        "is_converted": call.get("is_converted"),
                        "target_response_status": call.get("target_response_status"),
                        # Raw payload
                        "raw_payload": call.get("raw_payload"),
                        # Timestamp
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    # Note: We intentionally include None values for force_update
                    # to overwrite any stale data. Only raw_payload None is skipped.
                    if update_data.get("raw_payload") is None:
                        del update_data["raw_payload"]
                else:
                    # NORMAL MODE: Only update basic mutable fields
                    update_data = {
                        "audio_url": call.get("audio_url"),
                        "duration_seconds": call.get("duration_seconds"),
                        "revenue": call.get("revenue"),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    # Remove None values in normal mode
                    update_data = {k: v for k, v in update_data.items() if v is not None}

                if update_data:
                    self.schema.from_("calls").update(update_data).eq(
                        "ringba_call_id", call["ringba_call_id"]
                    ).execute()
                    updated += 1
            except Exception as e:
                logger.warning(f"Failed to update call {call['ringba_call_id'][:8]}...: {e}")

        if force_update and updated > 0:
            logger.info(f"Force-updated {updated} existing calls with new analytics columns")

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
            "skipped",
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


def parse_bool(value: Any) -> Optional[bool]:
    """
    Parse various boolean representations to Python bool.

    Handles: True/False, "true"/"false", 1/0, "1"/"0", "yes"/"no"

    Args:
        value: Value to parse

    Returns:
        Boolean or None if unparseable
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes")
    return None


def determine_call_status(duration_seconds: Optional[int], audio_url: Optional[str]) -> tuple[str, Optional[str]]:
    """
    Determine initial status and skip_reason for a call based on duration and audio availability.

    Auto-skip logic:
    - duration = 0: skip (zero_duration) - no audio to process
    - duration < 5s: skip (too_short) - not enough audio to transcribe meaningfully
    - duration >= 5s with audio_url: pending - ready for pipeline
    - duration >= 5s without audio_url: pending - will wait for audio (or skip later)

    Args:
        duration_seconds: Call duration in seconds (may be None)
        audio_url: Recording URL from Ringba (may be None)

    Returns:
        Tuple of (status, skip_reason) where skip_reason is None for pending calls
    """
    # No duration data yet - stay pending, will be evaluated later
    if duration_seconds is None:
        return "pending", None

    # Zero duration - definitely no audio
    if duration_seconds == 0:
        return "skipped", "zero_duration"

    # Very short calls - not useful for transcription
    if duration_seconds < 5:
        return "skipped", "too_short"

    # Normal call - ready for processing
    return "pending", None


def map_ringba_to_call(
    record: dict[str, Any],
    org_id: str,
    campaign_info: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """
    Map Ringba record to database call format.

    Maps all Ringba fields to corresponding database columns.
    Stores the complete raw record for forensics and future field extraction.
    Auto-skips calls that are too short to transcribe.

    Args:
        record: Ringba call record (full API response for this call)
        org_id: Organization UUID
        campaign_info: Dict with 'id' and 'vertical' from campaigns table (may be None)

    Returns:
        Dict ready for database insert with all analytics columns populated
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

    # Parse connected duration (try multiple field names, default to 0 if null)
    connected_duration = (
        record.get("connectedCallLengthInSeconds")
        or record.get("connectedDuration")
        or record.get("talkTime")
        or 0
    )

    # Parse time to answer (try multiple field names)
    time_to_answer = (
        record.get("timeToAnswer")
        or record.get("timeToConnect")
        or record.get("ringDuration")
    )

    # Parse end call source (try multiple field names)
    end_call_source = (
        record.get("endCallSource")
        or record.get("hangupSource")
        or record.get("disconnectSource")
    )

    # Parse call status (try multiple field names)
    call_status = (
        record.get("callStatus")
        or record.get("callResult")
        or record.get("disposition")
    )

    # Parse target response (try multiple field names)
    target_response = (
        record.get("targetResponseStatus")
        or record.get("targetBuyerCallStatus")
        or record.get("targetStatus")
    )

    # Parse conversion flag (try multiple field names)
    is_converted = parse_bool(
        record.get("isConverted")
        or record.get("converted")
        or record.get("conversion")
    )

    # Determine status based on duration (auto-skip short calls)
    duration_seconds = record.get("callLengthInSeconds")
    audio_url = record.get("recordingUrl")
    status, skip_reason = determine_call_status(duration_seconds, audio_url)

    # Extract campaign info for denormalization
    campaign_id = campaign_info.get("id") if campaign_info else None
    campaign_vertical = campaign_info.get("vertical") if campaign_info else None
    campaign_name = record.get("campaignName")  # From Ringba record

    result = {
        # Core identifiers
        "ringba_call_id": record.get("inboundCallId"),
        "org_id": org_id,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,  # Denormalized for AI analytics
        "vertical": campaign_vertical,    # Denormalized for AI analytics
        "start_time_utc": start_time.isoformat(),
        "status": status,
        # Call metadata
        "caller_number": record.get("inboundPhoneNumber"),
        "duration_seconds": record.get("callLengthInSeconds"),
        "audio_url": record.get("recordingUrl"),
        # Financial
        "revenue": record.get("conversionAmount", 0) or 0,
        "payout": record.get("payoutAmount", 0) or 0,
        # Publisher attribution
        "publisher_id": record.get("publisherId"),
        "publisher_sub_id": record.get("publisherSubId"),
        "publisher_name": record.get("publisherName"),
        # Buyer/Target routing
        "buyer_name": record.get("buyer"),
        "target_id": record.get("targetId"),
        "target_name": record.get("targetName"),
        # Geographic (try Ringba fields first, then area code lookup as fallback)
        "caller_state": (
            record.get("state")
            or record.get("callerState")
            or get_state_from_phone(record.get("inboundPhoneNumber"))
        ),
        "caller_city": record.get("city") or record.get("callerCity"),
        # Operational metrics (Phase 3 - AI Root Cause Analysis)
        "end_call_source": end_call_source,
        "call_status": call_status,
        "connected_duration": connected_duration,
        "time_to_answer": time_to_answer,
        "is_converted": is_converted,
        "target_response_status": target_response,
        # Raw payload for forensics
        "raw_payload": record,
    }

    # Add skip_reason if call was auto-skipped
    if skip_reason:
        result["skip_reason"] = skip_reason

    return result


# =============================================================================
# SYNC LOGIC
# =============================================================================
def run_sync_cycle(
    repo: IngestRepository,
    account_id: str,
    token: str,
    org_id: str = DEFAULT_ORG_ID,
    lookback_minutes: int = LOOKBACK_MINUTES,
) -> tuple[int, int]:
    """
    Run a single sync cycle for an organization.

    Args:
        repo: Ingest repository
        account_id: Ringba account ID
        token: Ringba API token
        org_id: Organization UUID
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

        # Ensure campaign exists (returns {id, vertical} dict)
        campaign_info = None
        ringba_campaign_id = record.get("campaignId")
        if ringba_campaign_id:
            campaign_info = repo.ensure_campaign(
                ringba_campaign_id,
                record.get("campaignName", "Unknown"),
                org_id,
            )

        # Map to database format (includes campaign_name and vertical)
        call = map_ringba_to_call(record, org_id, campaign_info)
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
    org_id: str = DEFAULT_ORG_ID,
    chunk_hours: int = 24,
    lifo: bool = True,
    force_update: bool = False,
) -> tuple[int, int]:
    """
    Run backfill for a date range, chunked into smaller windows.

    LIFO Priority: Processes newest chunks first so recent calls
    enter the pipeline before older ones.

    Args:
        repo: Ingest repository
        account_id: Ringba account ID
        token: Ringba API token
        start_time: Start of backfill window
        end_time: End of backfill window
        org_id: Organization ID to associate calls with
        chunk_hours: Size of each chunk in hours (default 24)
        lifo: Process newest chunks first (default True)
        force_update: If True, update analytics columns on existing records

    Returns:
        Tuple of (total_fetched, total_inserted)
    """
    total_fetched = 0
    total_inserted = 0

    chunk_delta = timedelta(hours=chunk_hours)

    # Build list of chunks
    chunks = []
    current_start = start_time
    while current_start < end_time:
        current_end = min(current_start + chunk_delta, end_time)
        chunks.append((current_start, current_end))
        current_start = current_end

    # LIFO: Reverse to process newest first
    if lifo:
        chunks.reverse()

    total_chunks = len(chunks)
    logger.info(f"Backfill: {start_time.strftime('%Y-%m-%d %H:%M')} -> {end_time.strftime('%Y-%m-%d %H:%M')} UTC")
    logger.info(f"Chunk size: {chunk_hours} hours, Total chunks: {total_chunks}")
    logger.info(f"Order: {'LIFO (newest first)' if lifo else 'FIFO (oldest first)'}")
    if force_update:
        logger.info("⚡ FORCE UPDATE MODE: Will update analytics columns on existing records")

    for chunk_num, (chunk_start, chunk_end) in enumerate(chunks, 1):
        logger.info(f"[Chunk {chunk_num}/{total_chunks}] {chunk_start.strftime('%Y-%m-%d %H:%M')} -> {chunk_end.strftime('%Y-%m-%d %H:%M')}")

        try:
            # Fetch from Ringba
            records = fetch_ringba_calls(account_id, token, chunk_start, chunk_end)

            if records:
                logger.info(f"  Fetched {len(records)} records")

                # Process campaigns and map calls
                calls = []
                for record in records:
                    ringba_call_id = record.get("inboundCallId")
                    if not ringba_call_id:
                        continue

                    # Ensure campaign exists (returns {id, vertical} dict)
                    campaign_info = None
                    ringba_campaign_id = record.get("campaignId")
                    if ringba_campaign_id:
                        campaign_info = repo.ensure_campaign(
                            ringba_campaign_id,
                            record.get("campaignName", "Unknown"),
                            org_id,
                        )

                    call = map_ringba_to_call(record, org_id, campaign_info)
                    calls.append(call)

                # Upsert to database (with force_update for backfill if enabled)
                total, inserted = repo.upsert_calls(calls, force_update=force_update)
                total_fetched += len(records)
                total_inserted += inserted

                updated_count = total - inserted
                if force_update:
                    logger.info(f"  Processed: {inserted} new, {updated_count} force-updated")
                else:
                    logger.info(f"  Processed: {inserted} new, {updated_count} existing")
            else:
                logger.info("  No records in this chunk")

            # Rate limiting: 1 second between chunks to avoid Ringba throttling
            time.sleep(1)

        except Exception as e:
            logger.error(f"  Error in chunk {chunk_num}: {e}")
            # Continue to next chunk

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
        "--multi-org",
        action="store_true",
        help="Run in multi-org mode (fetch credentials per org from database)",
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
    parser.add_argument(
        "--fifo",
        action="store_true",
        help="Process oldest chunks first (default is LIFO/newest first)",
    )
    parser.add_argument(
        "--org-id",
        type=str,
        help="Specific org ID to backfill (for multi-org mode)",
    )
    parser.add_argument(
        "--force-update",
        action="store_true",
        help="Force update analytics columns on existing records (for backfilling new columns)",
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
    elif args.multi_org:
        logger.info("CallScript V2 Ingest Worker - MULTI-ORG MODE")
    else:
        logger.info("CallScript V2 Ingest Worker Starting (Single-Tenant)")
    logger.info("=" * 60)

    # Setup signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Connect to Supabase
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = IngestRepository(client)
        logger.info("Connected to Supabase")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # Load area code to state mapping for geo-lookup
    global AREA_CODE_MAP
    AREA_CODE_MAP = load_area_codes(client)
    if AREA_CODE_MAP:
        logger.info(f"Loaded {len(AREA_CODE_MAP)} area codes for geo-lookup")
    else:
        logger.warning("Area code lookup disabled (table may not exist yet)")

    # ==========================================================================
    # MULTI-ORG MODE
    # ==========================================================================
    if args.multi_org:
        logger.info("Fetching organization credentials from database...")

        # Fetch active orgs with credentials
        orgs = get_active_org_credentials(client)

        if not orgs:
            logger.error("No organizations with Ringba credentials found")
            sys.exit(1)

        # Filter to specific org if --org-id provided
        if args.org_id:
            orgs = [o for o in orgs if o["org_id"] == args.org_id]
            if not orgs:
                logger.error(f"No credentials found for org_id: {args.org_id}")
                sys.exit(1)

        logger.info(f"Found {len(orgs)} organization(s) with Ringba credentials")

        # ======================================================================
        # MULTI-ORG BACKFILL MODE
        # ======================================================================
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

            use_lifo = not args.fifo
            grand_total_fetched = 0
            grand_total_inserted = 0

            logger.info(f"Multi-org backfill: {len(orgs)} org(s)")
            logger.info(f"Date range: {start_time.strftime('%Y-%m-%d')} -> {end_time.strftime('%Y-%m-%d')}")
            logger.info(f"Order: {'LIFO (newest first)' if use_lifo else 'FIFO (oldest first)'}")
            logger.info("=" * 60)

            for i, org in enumerate(orgs, 1):
                org_name = org.get("org_name", "Unknown")[:30]
                logger.info(f"\n[Org {i}/{len(orgs)}] {org_name} ({org['org_id'][:8]}...)")

                fetched, inserted = run_backfill(
                    repo,
                    org["account_id"],
                    org["token"],
                    start_time,
                    end_time,
                    org_id=org["org_id"],
                    chunk_hours=args.chunk_hours,
                    lifo=use_lifo,
                    force_update=args.force_update,
                )

                grand_total_fetched += fetched
                grand_total_inserted += inserted
                if args.force_update:
                    logger.info(f"  [{org_name}] Backfill complete: {fetched} fetched, {inserted} new, rest force-updated")
                else:
                    logger.info(f"  [{org_name}] Backfill complete: {fetched} fetched, {inserted} new")

            # Summary
            logger.info("=" * 60)
            logger.info("MULTI-ORG BACKFILL COMPLETE")
            logger.info(f"Organizations processed: {len(orgs)}")
            logger.info(f"Total fetched: {grand_total_fetched}")
            logger.info(f"Total inserted: {grand_total_inserted}")
            stats = repo.get_queue_stats()
            logger.info(f"Queue stats: pending={stats.get('pending', 0)}")
            logger.info("=" * 60)
            return

        # ======================================================================
        # MULTI-ORG CONTINUOUS SYNC MODE
        # ======================================================================
        # Log initial stats
        stats = repo.get_queue_stats()
        logger.info(f"Queue stats: pending={stats.get('pending', 0)}, total={sum(v for v in stats.values() if v > 0)}")
        logger.info(f"Config: interval={SYNC_INTERVAL}s, lookback={LOOKBACK_MINUTES}min")
        logger.info("=" * 60)

        total_fetched = 0
        total_inserted = 0
        sync_count = 0

        while not shutdown_requested:
            try:
                sync_count += 1

                # Re-fetch active orgs each cycle (in case new orgs were added)
                orgs = get_active_org_credentials(client)

                if not orgs:
                    logger.warning("No organizations with Ringba credentials found")
                    time.sleep(SYNC_INTERVAL)
                    continue

                logger.info(f"Sync #{sync_count}: Processing {len(orgs)} organization(s)")

                # Sync each org
                for org in orgs:
                    if shutdown_requested:
                        break

                    org_name = org.get("org_name", "Unknown")[:20]
                    logger.info(f"  [{org_name}] Syncing...")

                    try:
                        fetched, inserted = run_sync_cycle(
                            repo,
                            org["account_id"],
                            org["token"],
                            org_id=org["org_id"],
                        )
                        total_fetched += fetched
                        total_inserted += inserted

                        if fetched > 0:
                            logger.info(f"  [{org_name}] {fetched} fetched, {inserted} new")

                    except Exception as org_e:
                        logger.error(f"  [{org_name}] Error: {org_e}")

                # Log milestone every 10 syncs
                if sync_count % 10 == 0:
                    stats = repo.get_queue_stats()
                    logger.info(
                        f"Milestone #{sync_count} | Session: {total_fetched} fetched, {total_inserted} inserted | "
                        f"Pending: {stats.get('pending', 0)}"
                    )

                # Wait for next sync
                logger.debug(f"Sleeping {SYNC_INTERVAL}s until next sync...")
                time.sleep(SYNC_INTERVAL)

            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                break

            except Exception as e:
                logger.error(f"Sync error: {e}")
                time.sleep(SYNC_INTERVAL)

        # Shutdown summary
        logger.info("=" * 60)
        logger.info("Ingest Worker Shutdown (Multi-Org)")
        logger.info(f"Total syncs: {sync_count}")
        logger.info(f"Total fetched: {total_fetched}")
        logger.info(f"Total inserted: {total_inserted}")
        logger.info("=" * 60)
        return

    # ==========================================================================
    # SINGLE-TENANT MODE (env vars)
    # ==========================================================================
    # Validate Ringba credentials from env vars
    try:
        account_id, token = settings.require_ringba()
        logger.info(f"Ringba account: {account_id[:12]}...")
    except ValueError as e:
        logger.critical(str(e))
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

        # LIFO is default, --fifo overrides
        use_lifo = not args.fifo

        # Run backfill (uses single-tenant env credentials)
        total_fetched, total_inserted = run_backfill(
            repo,
            account_id,
            token,
            start_time,
            end_time,
            org_id=DEFAULT_ORG_ID,
            chunk_hours=args.chunk_hours,
            lifo=use_lifo,
            force_update=args.force_update,
        )

        # Summary
        logger.info("=" * 60)
        if args.force_update:
            logger.info("BACKFILL COMPLETE (FORCE UPDATE MODE)")
        else:
            logger.info("BACKFILL COMPLETE")
        logger.info(f"Total fetched: {total_fetched}")
        logger.info(f"Total inserted: {total_inserted}")
        stats = repo.get_queue_stats()
        logger.info(f"Queue stats: pending={stats.get('pending', 0)}, total={sum(v for v in stats.values() if v > 0)}")
        logger.info("=" * 60)
        return

    # ==========================================================================
    # NORMAL MODE (continuous loop, single-tenant)
    # ==========================================================================
    logger.info(f"Config: interval={SYNC_INTERVAL}s, lookback={LOOKBACK_MINUTES}min")

    total_fetched = 0
    total_inserted = 0
    sync_count = 0

    while not shutdown_requested:
        try:
            sync_count += 1
            fetched, inserted = run_sync_cycle(repo, account_id, token, org_id=DEFAULT_ORG_ID)

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
