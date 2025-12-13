#!/usr/bin/env python3
"""
CallScript V2 - Health Check HTTP Server

Exposes fleet health via HTTP for external monitoring (UptimeRobot, Pingdom, etc.)

Endpoints:
    GET /health     → Full health check with queue stats
    GET /ping       → Simple liveness check
    GET /metrics    → Prometheus-compatible metrics (future)

Returns:
    200 OK          → System healthy
    503 Unavailable → System critical (workers down, DB unreachable)

Server: Runs on port 8080 by default
"""

import json
import logging
import os
import signal
import subprocess
import sys
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client

# =============================================================================
# CONFIGURATION
# =============================================================================
DEFAULT_PORT = 8080
EXPECTED_WORKERS = {
    "ingest": 1,
    "vault": 1,
    "judge": 1,
    "factory": 4,
}
TOTAL_EXPECTED = sum(EXPECTED_WORKERS.values())

# Queue thresholds for health status
QUEUE_WARNING_THRESHOLD = 100  # pending > 100 = warning
QUEUE_CRITICAL_THRESHOLD = 500  # pending > 500 = critical
STUCK_CRITICAL_THRESHOLD = 5   # stuck > 5 = critical

# =============================================================================
# LOGGING
# =============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("health_server")

# =============================================================================
# HEALTH CHECK LOGIC
# =============================================================================
def get_worker_counts() -> dict[str, int]:
    """Count running worker processes by type."""
    counts = {}

    patterns = {
        "ingest": "ingest/worker.py",
        "vault": "vault/worker.py",
        "judge": "judge/worker.py",
        "factory": "factory/worker.py",
    }

    for name, pattern in patterns.items():
        try:
            result = subprocess.run(
                ["pgrep", "-f", pattern],
                capture_output=True,
                text=True,
                timeout=5,
            )
            # Count lines (each line is a PID)
            pids = [p for p in result.stdout.strip().split("\n") if p]
            counts[name] = len(pids)
        except Exception:
            counts[name] = 0

    return counts


def get_queue_stats(supabase_url: str, supabase_key: str) -> dict[str, int]:
    """Get queue status counts from database."""
    try:
        client = create_client(supabase_url, supabase_key)
        schema = client.schema("core")

        stats = {}
        statuses = ["pending", "downloaded", "processing", "transcribed", "flagged", "safe", "failed"]

        for status in statuses:
            response = (
                schema.from_("calls")
                .select("id", count="exact")
                .eq("status", status)
                .execute()
            )
            stats[status] = response.count or 0

        # Check for stuck calls (processing > 30 min)
        stuck_response = (
            schema.from_("calls")
            .select("id", count="exact")
            .eq("status", "processing")
            .lt("updated_at", (datetime.now(timezone.utc).isoformat()))
            .execute()
        )
        # Note: Proper stuck detection would need SQL, approximating here
        stats["stuck"] = 0  # Would need raw SQL for time comparison

        stats["total"] = sum(stats.get(s, 0) for s in statuses)

        return stats
    except Exception as e:
        logger.error(f"Failed to get queue stats: {e}")
        return {"error": str(e)}


def check_database_connection(supabase_url: str, supabase_key: str) -> bool:
    """Verify database is reachable."""
    try:
        client = create_client(supabase_url, supabase_key)
        # Simple query to test connection
        client.schema("core").from_("calls").select("id").limit(1).execute()
        return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False


def get_gpu_info() -> dict[str, Any]:
    """Get GPU utilization info (if nvidia-smi available)."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split(", ")
            return {
                "utilization_pct": int(parts[0]),
                "memory_used_mb": int(parts[1]),
                "memory_total_mb": int(parts[2]),
                "available": True,
            }
    except Exception:
        pass
    return {"available": False}


def perform_health_check() -> dict[str, Any]:
    """
    Perform comprehensive health check.

    Returns dict with:
        - status: "healthy" | "warning" | "critical"
        - workers: count by type
        - queue: status counts
        - database: connected bool
        - gpu: utilization info
        - timestamp: check time
    """
    # Get environment
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    # Collect data
    workers = get_worker_counts()
    total_workers = sum(workers.values())

    db_connected = check_database_connection(supabase_url, supabase_key) if supabase_url else False

    queue = get_queue_stats(supabase_url, supabase_key) if db_connected else {"error": "DB not connected"}

    gpu = get_gpu_info()

    # Determine overall status
    status = "healthy"
    issues = []

    # Check workers
    if total_workers == 0:
        status = "critical"
        issues.append("No workers running")
    elif total_workers < TOTAL_EXPECTED:
        if status != "critical":
            status = "warning"
        missing = TOTAL_EXPECTED - total_workers
        issues.append(f"Missing {missing} workers (expected {TOTAL_EXPECTED})")

    # Check database
    if not db_connected:
        status = "critical"
        issues.append("Database unreachable")

    # Check queue health
    if "error" not in queue:
        pending = queue.get("pending", 0)
        stuck = queue.get("stuck", 0)

        if pending > QUEUE_CRITICAL_THRESHOLD or stuck > STUCK_CRITICAL_THRESHOLD:
            status = "critical"
            issues.append(f"Queue backup: {pending} pending, {stuck} stuck")
        elif pending > QUEUE_WARNING_THRESHOLD:
            if status == "healthy":
                status = "warning"
            issues.append(f"Queue elevated: {pending} pending")

    return {
        "status": status,
        "issues": issues,
        "workers": {
            "counts": workers,
            "total": total_workers,
            "expected": TOTAL_EXPECTED,
        },
        "queue": queue,
        "database": {
            "connected": db_connected,
        },
        "gpu": gpu,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
    }


# =============================================================================
# HTTP SERVER
# =============================================================================
class HealthHandler(BaseHTTPRequestHandler):
    """HTTP request handler for health endpoints."""

    def log_message(self, format, *args):
        """Override to use our logger."""
        logger.info(f"{self.address_string()} - {format % args}")

    def send_json(self, data: dict, status_code: int = 200):
        """Send JSON response."""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode())

    def do_GET(self):
        """Handle GET requests."""
        if self.path == "/ping":
            # Simple liveness check
            self.send_json({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})

        elif self.path == "/health":
            # Full health check
            result = perform_health_check()
            status_code = 200 if result["status"] == "healthy" else 503
            self.send_json(result, status_code)

        elif self.path == "/metrics":
            # Prometheus metrics (basic implementation)
            result = perform_health_check()
            metrics = self.format_prometheus_metrics(result)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(metrics.encode())

        else:
            self.send_json({"error": "Not found", "endpoints": ["/ping", "/health", "/metrics"]}, 404)

    def format_prometheus_metrics(self, health: dict) -> str:
        """Format health data as Prometheus metrics."""
        lines = [
            "# HELP callscript_up Whether the system is up (1=healthy, 0=critical)",
            "# TYPE callscript_up gauge",
            f"callscript_up {1 if health['status'] == 'healthy' else 0}",
            "",
            "# HELP callscript_workers_running Number of running workers",
            "# TYPE callscript_workers_running gauge",
        ]

        for worker_type, count in health["workers"]["counts"].items():
            lines.append(f'callscript_workers_running{{type="{worker_type}"}} {count}')

        lines.append("")
        lines.append("# HELP callscript_workers_expected Expected number of workers")
        lines.append("# TYPE callscript_workers_expected gauge")
        lines.append(f"callscript_workers_expected {health['workers']['expected']}")

        if "error" not in health["queue"]:
            lines.append("")
            lines.append("# HELP callscript_queue_size Number of calls by status")
            lines.append("# TYPE callscript_queue_size gauge")
            for status, count in health["queue"].items():
                if status not in ["error", "total", "stuck"]:
                    lines.append(f'callscript_queue_size{{status="{status}"}} {count}')

        if health["gpu"].get("available"):
            lines.append("")
            lines.append("# HELP callscript_gpu_utilization GPU utilization percentage")
            lines.append("# TYPE callscript_gpu_utilization gauge")
            lines.append(f"callscript_gpu_utilization {health['gpu']['utilization_pct']}")
            lines.append("")
            lines.append("# HELP callscript_gpu_memory_used_mb GPU memory used in MB")
            lines.append("# TYPE callscript_gpu_memory_used_mb gauge")
            lines.append(f"callscript_gpu_memory_used_mb {health['gpu']['memory_used_mb']}")

        return "\n".join(lines) + "\n"


# =============================================================================
# MAIN
# =============================================================================
def main():
    """Start the health check HTTP server."""
    port = int(os.environ.get("HEALTH_PORT", DEFAULT_PORT))

    # Load environment from .env if not set
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists() and not os.environ.get("SUPABASE_URL"):
        logger.info(f"Loading environment from {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())

    server = HTTPServer(("0.0.0.0", port), HealthHandler)

    # Graceful shutdown
    def shutdown_handler(sig, frame):
        logger.info("Shutting down health server...")
        server.shutdown()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    logger.info(f"Health server starting on port {port}")
    logger.info(f"Endpoints: /ping, /health, /metrics")
    logger.info("=" * 50)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        logger.info("Health server stopped")


if __name__ == "__main__":
    main()
