#!/usr/bin/env python3
"""
CallScript V2 - Full System Verification
Proves each lane is working with concrete evidence.
"""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from collections import Counter

sys.path.insert(0, "/workspace")

from dotenv import load_dotenv
load_dotenv("/workspace/.env")

from supabase import create_client

def main():
    client = create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    schema = client.schema("core")

    print("=" * 65)
    print("  CALLSCRIPT V2 - FULL SYSTEM VERIFICATION")
    print("  " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
    print("=" * 65)

    # =========================================================================
    # 1. QUEUE STATUS
    # =========================================================================
    print("\n[1] QUEUE STATUS (Exact Counts)")
    print("-" * 50)

    statuses = ["pending", "downloaded", "processing", "transcribed", "flagged", "safe", "failed"]
    counts = {}
    total = 0

    for s in statuses:
        result = schema.from_("calls").select("id", count="exact").eq("status", s).execute()
        count = result.count or 0
        counts[s] = count
        total += count
        print(f"  {s:12}: {count:>6}")

    print(f"  {'TOTAL':12}: {total:>6}")

    # =========================================================================
    # 2. WORKER PROCESSES
    # =========================================================================
    print("\n[2] WORKER PROCESSES")
    print("-" * 50)

    try:
        result = subprocess.run(
            ["pgrep", "-afc", "python3.*workers/factory/worker.py"],
            capture_output=True, text=True
        )
        factory_count = int(result.stdout.strip()) if result.returncode == 0 else 0
    except:
        factory_count = 0

    print(f"  Factory Workers: {factory_count}/4 {'✅' if factory_count == 4 else '🔴'}")

    # Check for vault/judge workers (may not exist yet)
    for name, pattern in [("Vault", "vault/worker.py"), ("Judge", "judge/worker.py")]:
        try:
            result = subprocess.run(
                ["pgrep", "-fc", f"python3.*{pattern}"],
                capture_output=True, text=True
            )
            count = int(result.stdout.strip()) if result.returncode == 0 else 0
        except:
            count = 0
        status = "✅" if count > 0 else "⚪ (not deployed)"
        print(f"  {name} Workers:   {count}/1 {status}")

    # =========================================================================
    # 3. PENDING CALLS ANALYSIS (Vault Lane Input)
    # =========================================================================
    print("\n[3] VAULT LANE INPUT (Pending Calls)")
    print("-" * 50)

    if counts["pending"] > 0:
        pending = schema.from_("calls").select(
            "id, audio_url, start_time_utc"
        ).eq("status", "pending").order("start_time_utc", desc=False).limit(10).execute()

        if pending.data:
            with_url = sum(1 for c in pending.data if c.get("audio_url"))
            oldest = pending.data[0].get("start_time_utc", "N/A")[:19] if pending.data else "N/A"

            print(f"  Total pending: {counts['pending']}")
            print(f"  With audio_url: {with_url}/{len(pending.data)} (sample)")
            print(f"  Oldest pending: {oldest}")

            if with_url > 0:
                print(f"  Status: 🔴 VAULT LANE NEEDED - {counts['pending']} calls waiting for audio download")
            else:
                print(f"  Status: ⚠️ Pending calls have no audio_url (Ingest issue?)")
    else:
        print("  No pending calls - Vault lane has no work ✅")

    # =========================================================================
    # 4. DOWNLOADED CALLS ANALYSIS (Factory Lane Input)
    # =========================================================================
    print("\n[4] FACTORY LANE INPUT (Downloaded Calls)")
    print("-" * 50)

    if counts["downloaded"] > 0:
        downloaded = schema.from_("calls").select(
            "id, storage_path, retry_count, start_time_utc"
        ).eq("status", "downloaded").lt("retry_count", 3).order("start_time_utc", desc=True).limit(10).execute()

        processable = len(downloaded.data) if downloaded.data else 0
        print(f"  Total downloaded: {counts['downloaded']}")
        print(f"  Processable (retry<3): {processable} (sample)")

        if processable > 0 and factory_count > 0:
            print(f"  Status: ✅ Factory workers processing")
        elif processable > 0 and factory_count == 0:
            print(f"  Status: 🔴 Work available but no workers!")
        else:
            print(f"  Status: ⚠️ All downloaded calls have retry_count >= 3")
    else:
        print("  No downloaded calls - Factory lane has no work")
        if counts["pending"] > 0:
            print("  Status: 🔴 Blocked - need Vault to download audio first")
        else:
            print("  Status: ✅ Queue empty")

    # =========================================================================
    # 5. PROCESSING CALLS (Active Work)
    # =========================================================================
    print("\n[5] ACTIVE PROCESSING")
    print("-" * 50)

    if counts["processing"] > 0:
        processing = schema.from_("calls").select(
            "id, updated_at"
        ).eq("status", "processing").execute()

        print(f"  Currently processing: {counts['processing']}")

        # Check for stuck jobs
        now = datetime.now(timezone.utc)
        stuck = 0
        for c in processing.data:
            updated = c.get("updated_at")
            if updated:
                try:
                    updated_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                    age_minutes = (now - updated_dt).total_seconds() / 60
                    if age_minutes > 30:
                        stuck += 1
                except:
                    pass

        if stuck > 0:
            print(f"  Stuck (>30 min): {stuck} 🔴 ZOMBIE KILLER NEEDED")
        else:
            print(f"  All jobs healthy ✅")
    else:
        print("  No jobs currently processing")

    # =========================================================================
    # 6. TRANSCRIBED CALLS (Judge Lane Input)
    # =========================================================================
    print("\n[6] JUDGE LANE INPUT (Transcribed Calls)")
    print("-" * 50)

    if counts["transcribed"] > 0:
        transcribed = schema.from_("calls").select(
            "id, transcript_text"
        ).eq("status", "transcribed").is_("qa_flags", "null").limit(5).execute()

        awaiting_qa = len(transcribed.data) if transcribed.data else 0
        print(f"  Total transcribed: {counts['transcribed']}")
        print(f"  Awaiting QA: {awaiting_qa}+ (sample)")
        print(f"  Status: 🔴 JUDGE LANE NEEDED - calls waiting for QA analysis")
    else:
        print("  No transcribed calls awaiting QA ✅")

    # =========================================================================
    # 7. SUCCESS METRICS
    # =========================================================================
    print("\n[7] SUCCESS METRICS")
    print("-" * 50)

    success_count = counts["flagged"] + counts["safe"]
    print(f"  Fully processed: {success_count}")
    print(f"    - Flagged: {counts['flagged']}")
    print(f"    - Safe: {counts['safe']}")
    print(f"  Failed: {counts['failed']}")

    if total > 0:
        success_rate = (success_count / total) * 100
        print(f"  Success rate: {success_rate:.1f}%")

    # =========================================================================
    # 8. FAILED CALLS ANALYSIS
    # =========================================================================
    print("\n[8] FAILED CALLS ANALYSIS")
    print("-" * 50)

    if counts["failed"] > 0:
        failed = schema.from_("calls").select(
            "processing_error"
        ).eq("status", "failed").limit(200).execute()

        errors = Counter()
        for c in failed.data:
            err = str(c.get("processing_error") or "No error")[:60]
            errors[err] += 1

        print(f"  Total failed: {counts['failed']}")
        print(f"  Top error patterns:")
        for err, count in errors.most_common(5):
            print(f"    [{count:>4}x] {err}...")
    else:
        print("  No failed calls ✅")

    # =========================================================================
    # 9. RECENT ACTIVITY
    # =========================================================================
    print("\n[9] RECENT ACTIVITY (Last Hour)")
    print("-" * 50)

    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    for status in ["transcribed", "flagged", "safe"]:
        result = schema.from_("calls").select(
            "id", count="exact"
        ).eq("status", status).gte("updated_at", one_hour_ago).execute()
        count = result.count or 0
        print(f"  New {status}: {count}")

    # =========================================================================
    # 10. ZOMBIE KILLER STATUS
    # =========================================================================
    print("\n[10] ZOMBIE KILLER STATUS")
    print("-" * 50)

    # Can't directly query cron.job from Supabase client, so check for stuck jobs
    stuck_check = schema.from_("calls").select(
        "id", count="exact"
    ).eq("status", "processing").lt(
        "updated_at",
        (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    ).execute()

    stuck_count = stuck_check.count or 0
    if stuck_count > 0:
        print(f"  Stuck jobs (>30 min): {stuck_count} 🔴")
        print(f"  Status: ZOMBIE KILLER NOT WORKING or NOT INSTALLED")
    else:
        print(f"  No stuck jobs detected ✅")
        print(f"  Note: Verify pg_cron job exists in Supabase Dashboard")

    # =========================================================================
    # SUMMARY
    # =========================================================================
    print("\n" + "=" * 65)
    print("  SUMMARY")
    print("=" * 65)

    issues = []

    if factory_count < 4:
        issues.append(f"Factory workers: {factory_count}/4")

    if counts["pending"] > 0:
        issues.append(f"Vault Lane needed: {counts['pending']} calls waiting")

    if counts["transcribed"] > 0:
        issues.append(f"Judge Lane needed: {counts['transcribed']} calls waiting")

    if stuck_count > 0:
        issues.append(f"Zombie Killer needed: {stuck_count} stuck jobs")

    if issues:
        print("\n  🔴 ISSUES TO FIX:")
        for issue in issues:
            print(f"    - {issue}")
    else:
        print("\n  ✅ ALL SYSTEMS OPERATIONAL")

    print("\n" + "=" * 65)


if __name__ == "__main__":
    main()
