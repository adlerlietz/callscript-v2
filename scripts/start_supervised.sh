#!/bin/bash
# =============================================================================
# CallScript V2 - Supervisor-Managed Start Script
# =============================================================================
# Starts all workers under supervisor for auto-restart capability.
#
# Usage:
#   ./scripts/start_supervised.sh           # Start all workers
#   ./scripts/start_supervised.sh stop      # Stop all workers
#   ./scripts/start_supervised.sh restart   # Restart all workers
#   ./scripts/start_supervised.sh status    # Check status
#   ./scripts/start_supervised.sh logs      # Follow all logs
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${SCRIPT_DIR}/.."
SUPERVISOR_CONF="${WORKSPACE}/supervisord.conf"
ENV_FILE="${WORKSPACE}/.env"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

check_supervisor() {
    if ! command -v supervisord &> /dev/null; then
        log_error "supervisord not found. Installing..."
        pip install supervisor
    fi
}

load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=')
        set +a
        export PYTHONPATH="$WORKSPACE"
    else
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi
}

start_workers() {
    log_info "Starting CallScript V2 workers under supervisor..."

    # Create required directories
    mkdir -p "$WORKSPACE/logs"
    mkdir -p "$WORKSPACE/pids"

    # Stop any existing manual workers
    pkill -f "workers/ingest/worker.py" 2>/dev/null || true
    pkill -f "workers/vault/worker.py" 2>/dev/null || true
    pkill -f "workers/judge/worker.py" 2>/dev/null || true
    pkill -f "workers/factory/worker.py" 2>/dev/null || true
    pkill -f "workers/health_server.py" 2>/dev/null || true

    sleep 2

    # Start supervisor
    if pgrep -f "supervisord.*supervisord.conf" > /dev/null; then
        log_warn "Supervisor already running, restarting workers..."
        supervisorctl -c "$SUPERVISOR_CONF" restart all
    else
        supervisord -c "$SUPERVISOR_CONF"
        sleep 3
    fi

    # Show status
    show_status
}

stop_workers() {
    log_info "Stopping all workers..."

    if pgrep -f "supervisord.*supervisord.conf" > /dev/null; then
        supervisorctl -c "$SUPERVISOR_CONF" stop all
        supervisorctl -c "$SUPERVISOR_CONF" shutdown
    fi

    # Kill any stragglers
    pkill -f "workers/ingest/worker.py" 2>/dev/null || true
    pkill -f "workers/vault/worker.py" 2>/dev/null || true
    pkill -f "workers/judge/worker.py" 2>/dev/null || true
    pkill -f "workers/factory/worker.py" 2>/dev/null || true
    pkill -f "workers/health_server.py" 2>/dev/null || true

    log_info "All workers stopped"
}

restart_workers() {
    log_info "Restarting all workers..."

    if pgrep -f "supervisord.*supervisord.conf" > /dev/null; then
        supervisorctl -c "$SUPERVISOR_CONF" restart all
        sleep 3
        show_status
    else
        log_warn "Supervisor not running, starting fresh..."
        start_workers
    fi
}

show_status() {
    echo ""
    echo "=========================================="
    echo "  CallScript V2 - Worker Status"
    echo "=========================================="
    echo ""

    if pgrep -f "supervisord.*supervisord.conf" > /dev/null; then
        supervisorctl -c "$SUPERVISOR_CONF" status
    else
        log_warn "Supervisor not running"
        echo ""
        echo "Manual workers:"
        pgrep -af "worker.py" || echo "  No workers running"
    fi

    echo ""
    echo "=========================================="
}

follow_logs() {
    log_info "Following all logs (Ctrl+C to stop)..."
    tail -f "$WORKSPACE/logs"/*.log
}

show_help() {
    cat << EOF
CallScript V2 - Supervisor Manager

Usage: $0 [command]

Commands:
  (default)    Start all workers under supervisor
  stop         Stop all workers and supervisor
  restart      Restart all workers
  status       Show worker status
  logs         Follow all log files
  help         Show this help

Supervisor provides:
  - Automatic restart on crash
  - Process group management
  - Log rotation
  - Status monitoring

EOF
}

# Load environment
load_env
check_supervisor

# Main
case "${1:-start}" in
    start)
        start_workers
        ;;
    stop)
        stop_workers
        ;;
    restart)
        restart_workers
        ;;
    status)
        show_status
        ;;
    logs)
        follow_logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
