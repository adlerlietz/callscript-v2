#!/usr/bin/env python3
"""
CallScript V2 - Dead Letter Recovery Script

Analyzes failed calls and recovers those that can be retried.

Usage:
    python scripts/recover_failed.py                    # Dry run (analyze only)
    python scripts/recover_failed.py --execute          # Recover all recoverable
    python scripts/recover_failed.py --storage-only     # Only recover with storage_path
    python scripts/recover_failed.py --execute --force  # Force recover even max retries

Recovery Categories:
    1. Has storage_path → Reset to 'downloaded' (re-run Factory)
    2. Has audio_url only → Reset to 'pending' (re-run Vault)
    3. No audio → Unrecoverable (stays failed)

Recoverable Errors:
    - CUDA out of memory (Factory now handles chunking)
    - Pyannote/diarization errors
    - Timeout/network transient errors
    - Zombie killer resets

Non-Recoverable Errors:
    - No audio_url (Ringba didn't provide recording)
    - HTTP 404/403 (audio deleted or unauthorized)
    - Empty/corrupted audio
"""

import argparse
import os
import sys
import re
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client

# =============================================================================
# ERROR PATTERN CLASSIFICATION
# =============================================================================

# Patterns that indicate recoverable errors
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
    r"Zombie reset",
    r"timeout",
    r"transient",
    r"retry",
    r"batch_size.*too large",
]

# Patterns that indicate permanent failures
NON_RECOVERABLE_PATTERNS = [
    r"No audio URL",
    r"No audio_url",
    r"Empty audio",
    r"Content-Length: 0",
    r"HTTP 404",
    r"HTTP 403",
    r"HTTP 401",
    r"HTTP 410",
    r"Corrupted",
    r"Invalid audio",
    r"not found",
    r"Access denied",
]


def classify_error(error: str) -> tuple[bool, str]:
    """
    Classify an error as recoverable or not.

    Returns:
        (is_recoverable, reason)
    """
    if not error:
        return False, "No error message"

    # Check non-recoverable patterns first (takes precedence)
    for pattern in NON_RECOVERABLE_PATTERNS:
        if re.search(pattern, error, re.IGNORECASE):
            return False, f"Matches non-recoverable pattern: {pattern}"

    # Check recoverable patterns
    for pattern in RECOVERABLE_PATTERNS:
        if re.search(pattern, error, re.IGNORECASE):
            return True, f"Matches recoverable pattern: {pattern}"

    # Default: not recoverable unless has storage_path
    return False, "No matching pattern"


# =============================================================================
# MAIN SCRIPT
# =============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Recover failed calls in CallScript pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually perform recovery (default is dry run)",
    )
    parser.add_argument(
        "--storage-only",
        action="store_true",
        help="Only recover calls that have storage_path (safest)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recovery even if retry_count >= 3",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of calls to recover (0 = no limit)",
    )
    args = parser.parse_args()

    # Load environment
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())

    # Connect to Supabase
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    client = create_client(url, key)
    schema = client.schema("core")

    print("=" * 65)
    print("  CALLSCRIPT V2 - FAILED CALL RECOVERY")
    print(f"  Mode: {'EXECUTE' if args.execute else 'DRY RUN (preview)'}")
    if args.storage_only:
        print("  Filter: storage_path only")
    if args.force:
        print("  Force: ignoring retry_count")
    print("=" * 65)

    # ==========================================================================
    # STEP 1: Fetch and categorize failed calls
    # ==========================================================================
    print("\n[1] Fetching failed calls...")

    response = schema.from_("calls").select(
        "id, processing_error, retry_count, storage_path, audio_url"
    ).eq("status", "failed").execute()

    failed_calls = response.data or []
    print(f"    Total failed: {len(failed_calls)}")

    if not failed_calls:
        print("\n✅ No failed calls to recover!")
        return

    # ==========================================================================
    # STEP 2: Categorize by recovery potential
    # ==========================================================================
    print("\n[2] Categorizing calls...")

    # Categories
    with_storage_recoverable = []
    with_storage_not_recoverable = []
    with_audio_url_recoverable = []
    with_audio_url_not_recoverable = []
    no_audio = []

    error_counts = Counter()

    for call in failed_calls:
        error = call.get("processing_error") or ""
        retry_count = call.get("retry_count") or 0
        has_storage = bool(call.get("storage_path"))
        has_audio_url = bool(call.get("audio_url"))

        # Track error patterns
        error_short = error[:50] if error else "No error"
        error_counts[error_short] += 1

        # Classify
        is_recoverable, reason = classify_error(error)

        # Override: if has storage_path and CUDA OOM, always recoverable
        if has_storage and "CUDA out of memory" in error:
            is_recoverable = True

        # Check retry count (unless --force)
        if retry_count >= 3 and not args.force:
            # Check if zombie reset - those are always recoverable
            if "Zombie reset" not in error:
                is_recoverable = False

        # Categorize
        if has_storage:
            if is_recoverable:
                with_storage_recoverable.append(call)
            else:
                with_storage_not_recoverable.append(call)
        elif has_audio_url:
            if is_recoverable:
                with_audio_url_recoverable.append(call)
            else:
                with_audio_url_not_recoverable.append(call)
        else:
            no_audio.append(call)

    # ==========================================================================
    # STEP 3: Report analysis
    # ==========================================================================
    print("\n[3] Analysis Results")
    print("-" * 50)
    print(f"    WITH storage_path:")
    print(f"      ✅ Recoverable:     {len(with_storage_recoverable)}")
    print(f"      ❌ Not recoverable: {len(with_storage_not_recoverable)}")
    print(f"    WITH audio_url only:")
    print(f"      ✅ Recoverable:     {len(with_audio_url_recoverable)}")
    print(f"      ❌ Not recoverable: {len(with_audio_url_not_recoverable)}")
    print(f"    NO audio:")
    print(f"      ❌ Unrecoverable:   {len(no_audio)}")
    print("-" * 50)

    total_recoverable = len(with_storage_recoverable)
    if not args.storage_only:
        total_recoverable += len(with_audio_url_recoverable)

    print(f"    TOTAL RECOVERABLE:   {total_recoverable}")

    print(f"\n[4] Error Pattern Summary (Top 10)")
    print("-" * 50)
    for error, count in error_counts.most_common(10):
        print(f"    [{count:>4}x] {error}...")

    # ==========================================================================
    # STEP 4: Execute recovery
    # ==========================================================================
    if total_recoverable == 0:
        print("\n⚠️  No recoverable calls found")
        return

    # Build list of calls to recover
    to_recover = with_storage_recoverable[:]
    if not args.storage_only:
        to_recover.extend(with_audio_url_recoverable)

    # Apply limit
    if args.limit > 0:
        to_recover = to_recover[:args.limit]
        print(f"\n    (Limited to {args.limit} calls)")

    if not args.execute:
        print(f"\n[5] DRY RUN - No changes made")
        print(f"    Would recover {len(to_recover)} calls")
        print(f"\n    To execute, run:")
        print(f"    python scripts/recover_failed.py --execute")
        if args.storage_only:
            print(f"    python scripts/recover_failed.py --execute --storage-only")
        return

    print(f"\n[5] EXECUTING RECOVERY ({len(to_recover)} calls)")
    print("-" * 50)

    recovered = 0
    errors = 0

    for call in to_recover:
        try:
            # Determine target status
            if call.get("storage_path"):
                new_status = "downloaded"  # Re-run Factory
            else:
                new_status = "pending"  # Re-run Vault first

            # Update call
            schema.from_("calls").update({
                "status": new_status,
                "retry_count": 0,
                "processing_error": f"[Recovered {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}] {call.get('processing_error', '')[:200]}",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", call["id"]).execute()

            recovered += 1

            if recovered % 50 == 0:
                print(f"    Progress: {recovered}/{len(to_recover)}")

        except Exception as e:
            errors += 1
            print(f"    ❌ Error on {call['id'][:8]}: {e}")

    print(f"\n    ✅ Recovered: {recovered}")
    print(f"    ❌ Errors: {errors}")

    # ==========================================================================
    # SUMMARY
    # ==========================================================================
    print("\n" + "=" * 65)
    print("  RECOVERY COMPLETE")
    print("=" * 65)
    print(f"\n  Calls recovered: {recovered}")
    print(f"  Target status breakdown:")

    downloaded_count = sum(1 for c in to_recover[:recovered] if c.get("storage_path"))
    pending_count = recovered - downloaded_count

    print(f"    → 'downloaded' (Factory): {downloaded_count}")
    print(f"    → 'pending' (Vault):      {pending_count}")
    print(f"\n  These calls will be processed by the running workers.")
    print("")


if __name__ == "__main__":
    main()
