#!/usr/bin/env python3
"""
CallScript V2 - Dead Letter Recovery Script

Analyzes failed calls and recovers those that can be retried.

Usage:
    python scripts/recover_failed.py           # Dry run (preview)
    python scripts/recover_failed.py --execute # Actually recover

Recoverable errors (will reset to downloaded):
    - CUDA out of memory
    - Pyannote/diarization errors
    - Timeout errors
    - Network transient errors

Non-recoverable (stays failed):
    - No audio_url (data issue)
    - Empty audio file
    - Corrupted audio
    - Max retries exceeded (retry_count >= 3)
"""

import os
import sys
import re
from datetime import datetime, timezone
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client

# Patterns for recoverable errors
RECOVERABLE_PATTERNS = [
    r"CUDA out of memory",
    r"OutOfMemoryError",
    r"Pyannote.*error",
    r"diarization.*failed",
    r"Connection.*timed out",
    r"Read timed out",
    r"ConnectionResetError",
    r"Network is unreachable",
    r"Temporary failure",
    r"ServiceUnavailable",
    r"Zombie reset",  # Zombie killer resets are always recoverable
]

# Patterns for non-recoverable errors
NON_RECOVERABLE_PATTERNS = [
    r"No audio_url",
    r"Empty audio file",
    r"Content-Length: 0",
    r"HTTP 404",
    r"HTTP 403",
    r"Corrupted",
    r"Invalid audio",
]

def is_recoverable(error: str) -> bool:
    """Check if an error is recoverable."""
    if not error:
        return False

    error_lower = error.lower()

    # Check non-recoverable first (takes precedence)
    for pattern in NON_RECOVERABLE_PATTERNS:
        if re.search(pattern, error, re.IGNORECASE):
            return False

    # Check recoverable patterns
    for pattern in RECOVERABLE_PATTERNS:
        if re.search(pattern, error, re.IGNORECASE):
            return True

    return False


def main():
    execute = "--execute" in sys.argv

    # Connect to Supabase
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    client = create_client(url, key)
    schema = client.schema("core")

    print("=" * 65)
    print("  CALLSCRIPT V2 - DEAD LETTER RECOVERY")
    print("  Mode:", "EXECUTE" if execute else "DRY RUN (preview)")
    print("=" * 65)

    # Fetch all failed calls
    print("\n[1] Fetching failed calls...")
    response = schema.from_("calls").select(
        "id, processing_error, retry_count, storage_path, audio_url"
    ).eq("status", "failed").execute()

    failed_calls = response.data or []
    print(f"    Found {len(failed_calls)} failed calls")

    if not failed_calls:
        print("\n    No failed calls to recover!")
        return

    # Analyze and categorize
    print("\n[2] Analyzing errors...")
    recoverable = []
    non_recoverable = []
    error_counts = Counter()

    for call in failed_calls:
        error = call.get("processing_error") or ""
        retry = call.get("retry_count") or 0
        has_storage = bool(call.get("storage_path"))
        has_audio_url = bool(call.get("audio_url"))

        # Categorize error
        error_short = error[:60] if error else "No error message"
        error_counts[error_short] += 1

        # Check recoverability
        can_recover = False

        if retry >= 3:
            # Already at max retries - check if it was zombie killed
            if "Zombie reset" in error:
                can_recover = True  # Zombie resets don't count as real retries
        elif has_storage:
            # Has audio in storage - can retry if error is transient
            can_recover = is_recoverable(error)
        elif has_audio_url:
            # Has audio URL but not downloaded - may be able to re-vault
            can_recover = is_recoverable(error)

        if can_recover:
            recoverable.append(call)
        else:
            non_recoverable.append(call)

    # Report
    print(f"\n[3] Analysis Results")
    print("-" * 50)
    print(f"    Recoverable:     {len(recoverable)}")
    print(f"    Non-recoverable: {len(non_recoverable)}")

    print(f"\n[4] Error Pattern Summary (Top 10)")
    print("-" * 50)
    for error, count in error_counts.most_common(10):
        print(f"    [{count:>4}x] {error}...")

    # Show recoverable sample
    if recoverable:
        print(f"\n[5] Recoverable Calls Sample (first 5)")
        print("-" * 50)
        for call in recoverable[:5]:
            error = (call.get("processing_error") or "")[:50]
            print(f"    {call['id'][:8]}... | retry={call.get('retry_count', 0)} | {error}...")

    # Execute recovery
    if execute and recoverable:
        print(f"\n[6] EXECUTING RECOVERY")
        print("-" * 50)

        recovered = 0
        errors = 0

        for call in recoverable:
            try:
                # Determine target status based on what we have
                if call.get("storage_path"):
                    new_status = "downloaded"  # Re-run through Factory
                else:
                    new_status = "pending"  # Re-run through Vault first

                schema.from_("calls").update({
                    "status": new_status,
                    "retry_count": 0,  # Reset retry count
                    "processing_error": f"Recovered at {datetime.now(timezone.utc).isoformat()} | Previous: {call.get('processing_error', '')[:100]}",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", call["id"]).execute()

                recovered += 1

                if recovered % 100 == 0:
                    print(f"    Progress: {recovered}/{len(recoverable)}")

            except Exception as e:
                errors += 1
                print(f"    ERROR recovering {call['id'][:8]}: {e}")

        print(f"\n    COMPLETE: {recovered} recovered, {errors} errors")

    elif recoverable:
        print(f"\n[6] DRY RUN - No changes made")
        print(f"    Run with --execute to recover {len(recoverable)} calls")

    print("\n" + "=" * 65)


if __name__ == "__main__":
    main()
