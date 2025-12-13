#!/bin/bash
# =============================================================================
# CallScript V2 - Ingest Worker Launcher
# =============================================================================
# Runs the Ingest Lane worker (Ringba sync).
# This is API-bound and does NOT require GPU.
#
# Can run on:
#   - RunPod (alongside other workers)
#   - Any Linux server with Python 3.10+
#   - Local development machine
#
# Usage:
#   ./start_ingest.sh           # Start in foreground
#   ./start_ingest.sh --daemon  # Start in background
#   ./start_ingest.sh --stop    # Stop background worker
#   ./start_ingest.sh --status  # Check if running
# =============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${SCRIPT_DIR}/.."
INGEST_SCRIPT="${WORKSPACE}/workers/ingest/worker.py"
ENV_FILE="${WORKSPACE}/.env"
LOG_DIR="${WORKSPACE}/logs"
PID_FILE="${WORKSPACE}/pids/ingest.pid"
LOG_FILE="${LOG_DIR}/ingest.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

# Get PID of running Ingest worker
get_ingest_pid() {
    pgrep -f "python3.*ingest/worker.py" 2>/dev/null || true
}

is_running() {
    local pid
    pid=$(get_ingest_pid)
    [[ -n "$pid" ]]
}

start_foreground() {
    log_info "Starting Ingest Worker (foreground)..."

    # Validate prerequisites
    if [[ ! -f "$INGEST_SCRIPT" ]]; then
        log_error "Ingest script not found: $INGEST_SCRIPT"
        exit 1
    fi

    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi

    # Load environment
    set -a
    source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=')
    set +a

    export PYTHONPATH="$WORKSPACE"

    # Verify Ringba credentials
    if [[ -z "${RINGBA_ACCOUNT_ID:-}" ]] || [[ -z "${RINGBA_TOKEN:-}" ]]; then
        log_error "RINGBA_ACCOUNT_ID and RINGBA_TOKEN must be set in .env"
        exit 1
    fi

    log_info "Ringba account: ${RINGBA_ACCOUNT_ID:0:12}..."

    # Run in foreground
    exec python3 "$INGEST_SCRIPT"
}

start_daemon() {
    log_info "Starting Ingest Worker (daemon)..."

    if is_running; then
        log_warn "Ingest worker is already running (PID: $(get_ingest_pid))"
        exit 0
    fi

    # Validate prerequisites
    if [[ ! -f "$INGEST_SCRIPT" ]]; then
        log_error "Ingest script not found: $INGEST_SCRIPT"
        exit 1
    fi

    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi

    # Create directories
    mkdir -p "$LOG_DIR"
    mkdir -p "$(dirname "$PID_FILE")"

    # Load environment
    set -a
    source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=')
    set +a

    export PYTHONPATH="$WORKSPACE"

    # Verify Ringba credentials
    if [[ -z "${RINGBA_ACCOUNT_ID:-}" ]] || [[ -z "${RINGBA_TOKEN:-}" ]]; then
        log_error "RINGBA_ACCOUNT_ID and RINGBA_TOKEN must be set in .env"
        exit 1
    fi

    # Rotate large log (>50MB)
    if [[ -f "$LOG_FILE" ]]; then
        local size
        size=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
        if [[ "$size" -gt 52428800 ]]; then
            mv "$LOG_FILE" "${LOG_FILE}.$(date +%Y%m%d_%H%M%S).old"
            log_info "Rotated large log file"
        fi
    fi

    # Start daemon
    nohup python3 "$INGEST_SCRIPT" >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    sleep 2

    if is_running; then
        log_info "Ingest worker started (PID: $pid)"
        log_info "Log: $LOG_FILE"
    else
        log_error "Ingest worker failed to start - check $LOG_FILE"
        exit 1
    fi
}

stop_daemon() {
    log_info "Stopping Ingest Worker..."

    local pid
    pid=$(get_ingest_pid)

    if [[ -z "$pid" ]]; then
        log_info "Ingest worker is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    # Graceful shutdown (SIGTERM)
    kill -TERM "$pid" 2>/dev/null || true

    # Wait up to 30 seconds
    local elapsed=0
    while [[ $elapsed -lt 30 ]]; do
        sleep 1
        ((elapsed++))
        if ! is_running; then
            log_info "Ingest worker stopped gracefully"
            rm -f "$PID_FILE"
            return 0
        fi
    done

    # Force kill
    log_warn "Graceful shutdown timed out, sending SIGKILL..."
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    log_info "Ingest worker force stopped"
}

show_status() {
    echo ""
    echo "=========================================="
    echo "  Ingest Worker Status"
    echo "=========================================="
    echo ""

    if is_running; then
        local pid
        pid=$(get_ingest_pid)
        local mem cpu
        mem=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.1f", $1/1024}' || echo "N/A")
        cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "N/A")

        echo -e "  Status: ${GREEN}RUNNING${NC}"
        echo "  PID:    $pid"
        echo "  CPU:    ${cpu}%"
        echo "  Memory: ${mem}MB"
    else
        echo -e "  Status: ${RED}STOPPED${NC}"
    fi

    echo ""
    if [[ -f "$LOG_FILE" ]]; then
        echo "  Recent Log:"
        tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
    fi
    echo ""
    echo "=========================================="
    echo ""
}

show_help() {
    cat << EOF
CallScript V2 - Ingest Worker

Usage: $0 [command]

Commands:
  (default)    Start in foreground (Ctrl+C to stop)
  --daemon     Start in background
  --stop       Stop background worker
  --status     Check if running
  --help       Show this help

The Ingest worker syncs call metadata from Ringba API
to the database every 60 seconds.

Environment: Requires .env file with:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - RINGBA_ACCOUNT_ID
  - RINGBA_TOKEN

EOF
}

# Main
case "${1:-}" in
    --daemon|-d)
        start_daemon
        ;;
    --stop|-s)
        stop_daemon
        ;;
    --status)
        show_status
        ;;
    --help|-h)
        show_help
        ;;
    "")
        start_foreground
        ;;
    *)
        log_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac
