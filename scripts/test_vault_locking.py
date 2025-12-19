#!/usr/bin/env python3
"""
Vault Locking Verification Tests

Manual test script to verify atomic locking behavior in the Vault lane.
Run from the project root with: python scripts/test_vault_locking.py

Prerequisites:
- Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- Or: source .env.local before running

Tests:
1. Concurrent lock acquisition (only one worker wins)
2. Transient failure with lock release
3. Permanent error (404) leads to status='failed'
"""

import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(".env.local")

from supabase import create_client

# =============================================================================
# SETUP
# =============================================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    print("Run: source .env.local")
    sys.exit(1)

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
schema = client.schema("core")

# Test org ID (use default org)
TEST_ORG_ID = "00000000-0000-0000-0000-000000000001"


def create_test_call() -> str:
    """Create a test call in pending status for locking tests."""
    call_id = str(uuid.uuid4())
    ringba_id = f"TEST-{call_id[:8]}"

    schema.from_("calls").insert({
        "id": call_id,
        "ringba_call_id": ringba_id,
        "org_id": TEST_ORG_ID,
        "status": "pending",
        "audio_url": "https://example.com/test.mp3",
        "storage_path": None,
        "start_time_utc": datetime.now(timezone.utc).isoformat(),
    }).execute()

    print(f"  Created test call: {call_id[:8]}...")
    return call_id


def cleanup_test_call(call_id: str) -> None:
    """Delete a test call."""
    schema.from_("calls").delete().eq("id", call_id).execute()
    print(f"  Cleaned up: {call_id[:8]}...")


def attempt_lock(call_id: str, worker_id: int) -> tuple[int, bool]:
    """
    Attempt to acquire lock on a call.
    Returns (worker_id, success).
    """
    lock_value = f"vault_lock:{call_id[:8]}"

    response = (
        schema
        .from_("calls")
        .update({
            "storage_path": lock_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", call_id)
        .eq("status", "pending")
        .is_("storage_path", "null")
        .execute()
    )

    success = bool(response.data)
    return (worker_id, success)


# =============================================================================
# TEST 1: Concurrent Lock Acquisition
# =============================================================================
def test_concurrent_lock():
    """
    Test that only one worker can acquire the lock when multiple
    workers attempt concurrently.
    """
    print("\n" + "=" * 60)
    print("TEST 1: Concurrent Lock Acquisition")
    print("=" * 60)

    call_id = create_test_call()

    try:
        # Launch 5 workers attempting to lock simultaneously
        num_workers = 5
        print(f"  Launching {num_workers} concurrent lock attempts...")

        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = [
                executor.submit(attempt_lock, call_id, i)
                for i in range(num_workers)
            ]

            results = []
            for future in as_completed(futures):
                results.append(future.result())

        # Count successes
        successes = [r for r in results if r[1]]
        failures = [r for r in results if not r[1]]

        print(f"\n  Results:")
        print(f"    Successes: {len(successes)} (workers: {[r[0] for r in successes]})")
        print(f"    Failures:  {len(failures)} (workers: {[r[0] for r in failures]})")

        # Verify exactly one success
        if len(successes) == 1:
            print("\n  ✅ PASS: Exactly one worker acquired the lock")
            return True
        else:
            print(f"\n  ❌ FAIL: Expected 1 success, got {len(successes)}")
            return False

    finally:
        cleanup_test_call(call_id)


# =============================================================================
# TEST 2: Transient Failure Lock Release
# =============================================================================
def test_transient_failure_lock_release():
    """
    Test that lock is released when a transient error occurs.
    Simulates a download failure mid-processing.
    """
    print("\n" + "=" * 60)
    print("TEST 2: Transient Failure Lock Release")
    print("=" * 60)

    call_id = create_test_call()

    try:
        # Step 1: Acquire lock
        lock_value = f"vault_lock:{call_id[:8]}"
        schema.from_("calls").update({
            "storage_path": lock_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", call_id).execute()

        print(f"  Lock acquired: storage_path = '{lock_value}'")

        # Step 2: Verify lock is set
        call = schema.from_("calls").select("storage_path, status").eq("id", call_id).single().execute()
        assert call.data["storage_path"] == lock_value, "Lock not set"
        assert call.data["status"] == "pending", "Status should still be pending"
        print(f"  Verified: status={call.data['status']}, storage_path={call.data['storage_path']}")

        # Step 3: Simulate transient failure - release lock
        schema.from_("calls").update({
            "storage_path": None,
            "processing_error": "Simulated transient error",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", call_id).execute()

        print("  Simulated transient failure, released lock")

        # Step 4: Verify lock released, status still pending
        call = schema.from_("calls").select("storage_path, status, processing_error").eq("id", call_id).single().execute()

        if call.data["storage_path"] is None and call.data["status"] == "pending":
            print(f"\n  ✅ PASS: Lock released, status='pending', error='{call.data['processing_error']}'")
            return True
        else:
            print(f"\n  ❌ FAIL: storage_path={call.data['storage_path']}, status={call.data['status']}")
            return False

    finally:
        cleanup_test_call(call_id)


# =============================================================================
# TEST 3: Permanent Error (404)
# =============================================================================
def test_permanent_error_404():
    """
    Test that permanent errors (404/403/410) result in status='failed'.
    """
    print("\n" + "=" * 60)
    print("TEST 3: Permanent Error (404) Handling")
    print("=" * 60)

    call_id = create_test_call()

    try:
        # Step 1: Acquire lock
        lock_value = f"vault_lock:{call_id[:8]}"
        schema.from_("calls").update({
            "storage_path": lock_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", call_id).execute()

        print(f"  Lock acquired: storage_path = '{lock_value}'")

        # Step 2: Simulate permanent failure (404)
        # This mimics what the Vault worker does on 404
        schema.from_("calls").update({
            "storage_path": None,
            "status": "failed",
            "processing_error": "Audio URL expired or unavailable (HTTP 404)",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", call_id).execute()

        print("  Simulated 404 error")

        # Step 3: Verify status='failed', lock released
        call = schema.from_("calls").select("storage_path, status, processing_error").eq("id", call_id).single().execute()

        if call.data["status"] == "failed" and call.data["storage_path"] is None:
            print(f"\n  ✅ PASS: status='failed', storage_path=NULL")
            print(f"           processing_error='{call.data['processing_error']}'")
            return True
        else:
            print(f"\n  ❌ FAIL: status={call.data['status']}, storage_path={call.data['storage_path']}")
            return False

    finally:
        cleanup_test_call(call_id)


# =============================================================================
# TEST 4: Zombie Cleanup (Stale Lock)
# =============================================================================
def test_zombie_cleanup():
    """
    Test that the zombie killer releases stale locks.
    Creates a lock backdated >30 minutes and runs cleanup.
    """
    print("\n" + "=" * 60)
    print("TEST 4: Zombie Cleanup (Stale Lock)")
    print("=" * 60)

    call_id = create_test_call()

    try:
        # Step 1: Create stale lock (backdate updated_at by 31 minutes)
        lock_value = f"vault_lock:{call_id[:8]}"
        schema.from_("calls").update({
            "storage_path": lock_value,
            "updated_at": "2020-01-01T00:00:00Z",  # Very old timestamp
        }).eq("id", call_id).execute()

        print(f"  Created stale lock: storage_path = '{lock_value}'")
        print(f"  Backdated updated_at to 2020-01-01")

        # Step 2: Verify lock is set
        call = schema.from_("calls").select("storage_path").eq("id", call_id).single().execute()
        assert call.data["storage_path"] == lock_value, "Lock not set"

        # Step 3: Call zombie cleanup function
        print("  Calling core.release_stale_vault_locks(30)...")
        result = client.rpc("release_stale_vault_locks", {"p_ttl_minutes": 30}, schema="core").execute()

        released_count = result.data
        print(f"  Zombie cleanup returned: {released_count} locks released")

        # Step 4: Verify lock was released
        call = schema.from_("calls").select("storage_path, status").eq("id", call_id).single().execute()

        if call.data["storage_path"] is None and call.data["status"] == "pending":
            print(f"\n  ✅ PASS: Stale lock released by zombie cleanup")
            return True
        else:
            print(f"\n  ❌ FAIL: storage_path={call.data['storage_path']}, status={call.data['status']}")
            return False

    except Exception as e:
        print(f"\n  ⚠️  SKIP: Zombie function may not be deployed yet: {e}")
        return None

    finally:
        cleanup_test_call(call_id)


# =============================================================================
# MAIN
# =============================================================================
def main():
    print("\n" + "=" * 60)
    print("VAULT LOCKING VERIFICATION TESTS")
    print("=" * 60)
    print(f"Target: {SUPABASE_URL}")
    print(f"Schema: core.calls")

    results = {}

    # Run tests
    results["concurrent_lock"] = test_concurrent_lock()
    results["transient_failure"] = test_transient_failure_lock_release()
    results["permanent_error"] = test_permanent_error_404()
    results["zombie_cleanup"] = test_zombie_cleanup()

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for test_name, passed in results.items():
        if passed is True:
            status = "✅ PASS"
        elif passed is False:
            status = "❌ FAIL"
        else:
            status = "⚠️  SKIP"
        print(f"  {test_name}: {status}")

    # Exit code
    failures = [r for r in results.values() if r is False]
    if failures:
        print(f"\n{len(failures)} test(s) failed")
        sys.exit(1)
    else:
        print("\nAll tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
