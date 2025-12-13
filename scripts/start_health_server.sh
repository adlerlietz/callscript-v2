#!/bin/bash
# =============================================================================
# CallScript V2 - Health Server Launcher
# =============================================================================
# Runs the HTTP health check server for external monitoring.
# Exposes /health, /ping, /metrics endpoints on port 8080.
#
# Usage:
#   ./start_health_server.sh           # Start in foreground
#   ./start_health_server.sh --daemon  # Start in background
#   ./start_health_server.sh --stop    # Stop background server
#   ./start_health_server.sh --status  # Check if running
# =============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${SCRIPT_DIR}/.."
HEALTH_SCRIPT="${WORKSPACE}/workers/health_server.py"
ENV_FILE="${WORKSPACE}/.env"
LOG_DIR="${WORKSPACE}/logs"
PID_FILE="${WORKSPACE}/pids/health_server.pid"
LOG_FILE="${LOG_DIR}/health_server.log"
DEFAULT_PORT=8080

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

get_pid() {
    pgrep -f "python3.*health_server.py" 2>/dev/null || true
}

is_running() {
    local pid
    pid=$(get_pid)
    [[ -n "$pid" ]]
}

start_foreground() {
    log_info "Starting Health Server (foreground)..."

    if [[ ! -f "$HEALTH_SCRIPT" ]]; then
        log_error "Health script not found: $HEALTH_SCRIPT"
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
    export HEALTH_PORT="${HEALTH_PORT:-$DEFAULT_PORT}"

    log_info "Port: $HEALTH_PORT"

    exec python3 "$HEALTH_SCRIPT"
}

start_daemon() {
    log_info "Starting Health Server (daemon)..."

    if is_running; then
        log_warn "Health server is already running (PID: $(get_pid))"
        exit 0
    fi

    if [[ ! -f "$HEALTH_SCRIPT" ]]; then
        log_error "Health script not found: $HEALTH_SCRIPT"
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
    export HEALTH_PORT="${HEALTH_PORT:-$DEFAULT_PORT}"

    # Start daemon
    nohup python3 "$HEALTH_SCRIPT" >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    sleep 2

    if is_running; then
        log_info "Health server started (PID: $pid)"
        log_info "Port: $HEALTH_PORT"
        log_info "Log: $LOG_FILE"
        log_info "Test: curl http://localhost:$HEALTH_PORT/health"
    else
        log_error "Health server failed to start - check $LOG_FILE"
        exit 1
    fi
}

stop_daemon() {
    log_info "Stopping Health Server..."

    local pid
    pid=$(get_pid)

    if [[ -z "$pid" ]]; then
        log_info "Health server is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    kill -TERM "$pid" 2>/dev/null || true

    local elapsed=0
    while [[ $elapsed -lt 10 ]]; do
        sleep 1
        ((elapsed++))
        if ! is_running; then
            log_info "Health server stopped"
            rm -f "$PID_FILE"
            return 0
        fi
    done

    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    log_info "Health server force stopped"
}

show_status() {
    echo ""
    echo "=========================================="
    echo "  Health Server Status"
    echo "=========================================="
    echo ""

    if is_running; then
        local pid
        pid=$(get_pid)
        local port="${HEALTH_PORT:-$DEFAULT_PORT}"

        echo -e "  Status: ${GREEN}RUNNING${NC}"
        echo "  PID:    $pid"
        echo "  Port:   $port"
        echo ""
        echo "  Endpoints:"
        echo "    GET /ping    - Liveness check"
        echo "    GET /health  - Full health check"
        echo "    GET /metrics - Prometheus metrics"
        echo ""
        echo "  Test Command:"
        echo "    curl http://localhost:$port/health"
    else
        echo -e "  Status: ${RED}STOPPED${NC}"
    fi

    echo ""
    echo "=========================================="
    echo ""
}

show_help() {
    cat << EOF
CallScript V2 - Health Server

Usage: $0 [command]

Commands:
  (default)    Start in foreground (Ctrl+C to stop)
  --daemon     Start in background
  --stop       Stop background server
  --status     Check if running
  --help       Show this help

The health server exposes HTTP endpoints for external monitoring:
  /ping    - Simple liveness (always 200)
  /health  - Full system health (200=ok, 503=critical)
  /metrics - Prometheus-compatible metrics

Environment:
  HEALTH_PORT  - Server port (default: 8080)

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
