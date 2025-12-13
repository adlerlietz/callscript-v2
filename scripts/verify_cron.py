#!/usr/bin/env python3
"""
CallScript V2 - pg_cron Verification

Verifies all scheduled jobs are in place and provides status.

Usage:
    python scripts/verify_cron.py
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client

# Expected cron jobs
EXPECTED_JOBS = {
    "core_zombie_killer": {
        "schedule": "*/30 * * * *",
        "description": "Reset stuck processing calls (every 30 min)",
        "critical": True,
    },
    "sync_ringba_realtime": {
        "schedule": "*/5 * * * *",
        "description": "Ingest Lane - sync calls from Ringba (every 5 min)",
        "critical": True,
    },
    "vault_recording_watcher": {
        "schedule": "*/2 * * * *",
        "description": "Vault Lane - download audio to storage (every 2 min)",
        "critical": True,
    },
    "queue_alert_check": {
        "schedule": "*/15 * * * *",
        "description": "Queue backup alerts (every 15 min)",
        "critical": False,
    },
    "stall_detection": {
        "schedule": "15,45 * * * *",
        "description": "Pipeline stall detection (every 30 min offset)",
        "critical": False,
    },
}


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    client = create_client(url, key)

    print("=" * 65)
    print("  CALLSCRIPT V2 - pg_cron VERIFICATION")
    print("  " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("=" * 65)

    # Query cron.job table
    print("\n[1] Querying cron.job table...")

    try:
        # Use raw SQL via RPC
        response = client.rpc("get_cron_jobs").execute()
        jobs = response.data or []
    except Exception as e:
        # Fallback: try direct table access
        print(f"    RPC not available, trying direct access...")
        try:
            response = client.from_("cron.job").select("*").execute()
            jobs = response.data or []
        except Exception as e2:
            print(f"    ERROR: Cannot access cron.job table")
            print(f"    This might be a permissions issue.")
            print(f"    Try running the verification SQL directly in Supabase SQL Editor:")
            print()
            print("    SELECT jobname, schedule, active, command")
            print("    FROM cron.job")
            print("    WHERE database = current_database();")
            print()
            jobs = []

    if not jobs:
        print("\n    No cron jobs found or cannot access cron schema")
        print("\n    MANUAL CHECK REQUIRED:")
        print("    1. Go to Supabase Dashboard -> SQL Editor")
        print("    2. Run: SELECT * FROM cron.job;")
        print("    3. Verify these jobs exist:")
        for name, info in EXPECTED_JOBS.items():
            critical = "[CRITICAL]" if info["critical"] else ""
            print(f"       - {name} ({info['schedule']}) {critical}")
        print()

        # Show migration files to run
        print("    MIGRATIONS TO RUN (if jobs missing):")
        print("    1. 05_cron.sql - Zombie Killer")
        print("    2. 10_schedule_ingest.sql - Ingest Lane")
        print("    3. 11_schedule_vault.sql - Vault Lane")
        print("    4. 12_queue_alerts.sql - Alerting")
        return

    # Parse and display jobs
    print(f"\n[2] Found {len(jobs)} cron jobs")
    print("-" * 65)

    found_jobs = {}
    for job in jobs:
        name = job.get("jobname", "unknown")
        schedule = job.get("schedule", "?")
        active = job.get("active", False)
        found_jobs[name] = {
            "schedule": schedule,
            "active": active,
        }

    # Compare with expected
    print("\n[3] Verification Results")
    print("-" * 65)

    missing = []
    misconfigured = []
    inactive = []

    for name, expected in EXPECTED_JOBS.items():
        found = found_jobs.get(name)

        if not found:
            status = "MISSING"
            emoji = "🔴" if expected["critical"] else "⚠️"
            missing.append(name)
        elif not found["active"]:
            status = "INACTIVE"
            emoji = "⚠️"
            inactive.append(name)
        elif found["schedule"] != expected["schedule"]:
            status = f"WRONG SCHEDULE ({found['schedule']})"
            emoji = "⚠️"
            misconfigured.append(name)
        else:
            status = "OK"
            emoji = "✅"

        critical = "[CRITICAL]" if expected["critical"] else ""
        print(f"    {emoji} {name}: {status} {critical}")
        print(f"       Expected: {expected['schedule']} - {expected['description']}")
        print()

    # Summary
    print("=" * 65)
    print("  SUMMARY")
    print("=" * 65)

    if not missing and not misconfigured and not inactive:
        print("\n  ✅ ALL CRON JOBS CONFIGURED CORRECTLY")
    else:
        if missing:
            print(f"\n  🔴 MISSING JOBS ({len(missing)}):")
            for name in missing:
                print(f"     - {name}")

        if inactive:
            print(f"\n  ⚠️  INACTIVE JOBS ({len(inactive)}):")
            for name in inactive:
                print(f"     - {name}")

        if misconfigured:
            print(f"\n  ⚠️  MISCONFIGURED ({len(misconfigured)}):")
            for name in misconfigured:
                print(f"     - {name}")

        print("\n  FIX: Run the following migrations in Supabase SQL Editor:")
        print("     1. supabase/migrations/05_cron.sql")
        print("     2. supabase/migrations/10_schedule_ingest.sql")
        print("     3. supabase/migrations/11_schedule_vault.sql")
        print("     4. supabase/migrations/12_queue_alerts.sql")

    print("\n" + "=" * 65)


if __name__ == "__main__":
    main()
