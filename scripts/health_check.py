#!/usr/bin/env python3
"""
CallScript V2 - Watchdog Health Check

Quick pulse check of the entire backend:
- Worker processes
- Database connectivity
- Queue health (stall detection)

Usage:
    python scripts/health_check.py          # Full check
    python scripts/health_check.py --json   # JSON output for monitoring

Exit Codes:
    0 = Healthy
    1 = Critical (workers down)
    2 = Warning (queue stalled)
"""

import os
import subprocess
import sys
from datetime import datetime, timezone

# Ensure workspace is in path for imports
sys.path.insert(0, "/workspace")

from supabase import create_client

from workers.core import get_settings, create_repository

# =============================================================================
# CONFIGURATION
# =============================================================================
EXPECTED_WORKERS = 4
WORKER_SCRIPT_PATTERN = "workers/factory/worker.py"


# =============================================================================
# CHECK FUNCTIONS
# =============================================================================

def check_workers() -> tuple[str, int, bool]:
    """
    Check worker process count.

    Returns:
        (status_message, worker_count, is_healthy)
    """
    try:
        result = subprocess.run(
            ["pgrep", "-fc", f"python3.*{WORKER_SCRIPT_PATTERN}"],
            capture_output=True,
            text=True,
        )
        count = int(result.stdout.strip()) if result.returncode == 0 else 0
    except (subprocess.SubprocessError, ValueError):
        count = 0

    is_healthy = count == EXPECTED_WORKERS

    if count == EXPECTED_WORKERS:
        emoji = "✅"
        status = "HEALTHY"
    elif count > 0:
        emoji = "⚠️"
        status = "DEGRADED"
    else:
        emoji = "🔴"
        status = "DOWN"

    message = f"{emoji} Workers: {count}/{EXPECTED_WORKERS} running ({status})"
    return message, count, is_healthy


def check_database(settings) -> tuple[str, bool]:
    """
    Check database connectivity.

    Returns:
        (status_message, is_healthy)
    """
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = create_repository(client)

        # Simple connectivity test - fetch one row
        schema = client.schema("core")
        schema.from_("calls").select("id").limit(1).execute()

        return "✅ Database: Connected", True

    except Exception as e:
        error_msg = str(e)[:50]
        return f"🔴 Database: Connection failed ({error_msg})", False


def check_queue(settings) -> tuple[str, dict, bool, bool]:
    """
    Check queue health and detect stalls.

    Returns:
        (status_message, stats, is_healthy, is_stalled)
    """
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = create_repository(client)
        stats = repo.get_queue_stats()

        processing = stats.get("processing", 0)
        downloaded = stats.get("downloaded", 0)
        pending = stats.get("pending", 0)
        transcribed = stats.get("transcribed", 0)
        flagged = stats.get("flagged", 0)
        safe = stats.get("safe", 0)
        failed = stats.get("failed", 0)

        # Calculate totals
        success = transcribed + flagged + safe
        total = sum(stats.values())

        # Stall detection: Workers idle but work available
        is_stalled = processing == 0 and downloaded > 0

        # Build status message
        lines = []

        if is_stalled:
            lines.append("⚠️  Queue: STALLED (workers idle with work available)")
        else:
            lines.append("✅ Queue: Healthy")

        lines.append(f"   ├─ Processing:  {processing:>5}")
        lines.append(f"   ├─ Ready:       {downloaded:>5}")
        lines.append(f"   ├─ Waiting:     {pending:>5}")
        lines.append(f"   ├─ Success:     {success:>5} (transcribed={transcribed}, flagged={flagged}, safe={safe})")
        lines.append(f"   └─ Failed:      {failed:>5}")
        lines.append(f"   Total: {total}")

        message = "\n".join(lines)
        return message, stats, True, is_stalled

    except Exception as e:
        error_msg = str(e)[:50]
        return f"🔴 Queue: Failed to fetch stats ({error_msg})", {}, False, False


def check_gpu() -> tuple[str, bool]:
    """
    Check GPU availability and memory.

    Returns:
        (status_message, is_healthy)
    """
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            return "🔴 GPU: nvidia-smi failed", False

        parts = result.stdout.strip().split(", ")
        if len(parts) >= 4:
            name, mem_used, mem_total, util = parts[0], parts[1], parts[2], parts[3]
            mem_pct = (float(mem_used) / float(mem_total)) * 100
            return f"✅ GPU: {name} | {mem_used}/{mem_total} MB ({mem_pct:.0f}%) | Util: {util}%", True

        return f"✅ GPU: {result.stdout.strip()}", True

    except subprocess.TimeoutExpired:
        return "🔴 GPU: nvidia-smi timeout", False
    except FileNotFoundError:
        return "⚠️  GPU: nvidia-smi not found", False
    except Exception as e:
        return f"🔴 GPU: Error ({str(e)[:30]})", False


# =============================================================================
# MAIN
# =============================================================================

def main():
    """Run all health checks and report status."""

    # Parse args
    json_output = "--json" in sys.argv

    # Header
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    if not json_output:
        print("")
        print("=" * 55)
        print(f"  🐕 CallScript Watchdog [{timestamp}]")
        print("=" * 55)
        print("")

    # Track overall health
    is_critical = False
    is_warning = False
    results = {}

    # Load settings
    try:
        settings = get_settings()
    except Exception as e:
        print(f"🔴 CRITICAL: Failed to load settings: {e}")
        sys.exit(1)

    # Check 1: Workers
    worker_msg, worker_count, workers_healthy = check_workers()
    results["workers"] = {"count": worker_count, "expected": EXPECTED_WORKERS, "healthy": workers_healthy}
    if not json_output:
        print(worker_msg)
    if worker_count == 0:
        is_critical = True
    elif not workers_healthy:
        is_warning = True

    # Check 2: Database
    db_msg, db_healthy = check_database(settings)
    results["database"] = {"healthy": db_healthy}
    if not json_output:
        print(db_msg)
    if not db_healthy:
        is_critical = True

    # Check 3: Queue
    queue_msg, stats, queue_healthy, is_stalled = check_queue(settings)
    results["queue"] = {"stats": stats, "healthy": queue_healthy, "stalled": is_stalled}
    if not json_output:
        print(queue_msg)
    if not queue_healthy:
        is_critical = True
    if is_stalled:
        is_warning = True

    # Check 4: GPU
    gpu_msg, gpu_healthy = check_gpu()
    results["gpu"] = {"healthy": gpu_healthy}
    if not json_output:
        print(gpu_msg)

    # Footer
    if not json_output:
        print("")
        print("-" * 55)
        if is_critical:
            print("  Status: 🔴 CRITICAL - Immediate attention required")
        elif is_warning:
            print("  Status: ⚠️  WARNING - Check worker logs")
        else:
            print("  Status: ✅ ALL SYSTEMS OPERATIONAL")
        print("-" * 55)
        print("")

    # JSON output
    if json_output:
        import json
        results["timestamp"] = timestamp
        results["status"] = "critical" if is_critical else ("warning" if is_warning else "healthy")
        print(json.dumps(results, indent=2))

    # Exit code
    if is_critical:
        sys.exit(1)
    elif is_warning:
        sys.exit(2)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
