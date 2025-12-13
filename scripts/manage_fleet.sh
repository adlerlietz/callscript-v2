#!/bin/bash
# =============================================================================
# CallScript V2 - Production Fleet Manager
# =============================================================================
# Manages concurrent Python workers for GPU-accelerated transcription.
#
# Usage:
#   ./manage_fleet.sh start    - Start all workers
#   ./manage_fleet.sh stop     - Stop all workers gracefully
#   ./manage_fleet.sh restart  - Stop then start
#   ./manage_fleet.sh status   - Check fleet health
#   ./manage_fleet.sh logs [n] - Tail worker n's log (default: 1)
#
# Server: RunPod (Ubuntu 22.04, RTX 3090)
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURATION - Edit these variables as needed
# =============================================================================
readonly FACTORY_WORKER_COUNT=4
readonly FACTORY_SCRIPT="/workspace/workers/factory/worker.py"
readonly JUDGE_SCRIPT="/workspace/workers/judge.py"
readonly ENV_FILE="/workspace/.env"
readonly LOG_DIR="/workspace/logs"
readonly PID_DIR="/workspace/pids"

# -----------------------------------------------------------------------------
# CRITICAL: PyTorch Memory Optimization for Multi-Worker GPU Sharing
# -----------------------------------------------------------------------------
# When multiple workers share a single GPU (RTX 3090), PyTorch's default memory
# allocator can cause fragmentation, leading to OOM errors even with available
# VRAM. The "expandable_segments" option uses a different allocation strategy
# that handles fragmentation better by allowing memory segments to grow.
#
# Without this: Workers crash with "CUDA out of memory" after ~10 transcriptions
# With this: Workers run stably for 1000+ transcriptions
# -----------------------------------------------------------------------------
readonly PYTORCH_MEMORY_FIX="expandable_segments:True"

# Stagger delay between worker launches (seconds)
# Prevents thundering herd on model loading
readonly LAUNCH_DELAY=5

# Graceful shutdown timeout before SIGKILL (seconds)
readonly SHUTDOWN_TIMEOUT=30

# =============================================================================
# COLORS & FORMATTING
# =============================================================================
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly BOLD='\033[1m'
readonly NC='\033[0m' # No Color

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC}  $1"; }

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

# Get PIDs of running Factory worker processes
get_factory_pids() {
    pgrep -f "python3.*${FACTORY_SCRIPT}" 2>/dev/null || true
}

# Get PID of running Judge worker (exclude bash wrapper)
get_judge_pid() {
    pgrep -f "python3.*judge.py" 2>/dev/null | grep -v "^$$" | tail -1 || true
}

# Count running Factory workers
count_factory_workers() {
    local pids
    pids=$(get_factory_pids)
    if [[ -z "$pids" ]]; then
        echo 0
    else
        echo "$pids" | wc -l | tr -d ' '
    fi
}

# Check if Judge is running
is_judge_running() {
    local pid
    pid=$(get_judge_pid)
    if [[ -n "$pid" ]]; then
        return 0
    else
        return 1
    fi
}

# Validate prerequisites before starting
validate_prerequisites() {
    local errors=0

    # Check environment file
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        ((errors++))
    fi

    # Check Factory worker script
    if [[ ! -f "$FACTORY_SCRIPT" ]]; then
        log_error "Factory script not found: $FACTORY_SCRIPT"
        ((errors++))
    fi

    # Check Judge worker script
    if [[ ! -f "$JUDGE_SCRIPT" ]]; then
        log_error "Judge script not found: $JUDGE_SCRIPT"
        ((errors++))
    fi

    # Check Python available
    if ! command -v python3 &>/dev/null; then
        log_error "python3 not found in PATH"
        ((errors++))
    fi

    # Check CUDA available (non-fatal warning)
    if ! python3 -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
        log_warn "CUDA not available - Factory workers may fail"
    fi

    if [[ $errors -gt 0 ]]; then
        log_error "Prerequisites check failed with $errors error(s)"
        exit 1
    fi

    log_info "Prerequisites validated"
}

# =============================================================================
# FLEET COMMANDS
# =============================================================================

start_fleet() {
    echo ""
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD}  CallScript Fleet Manager - START${NC}"
    echo -e "${BOLD}========================================${NC}"
    echo ""

    # Step 1: Ensure clean slate (idempotent)
    log_step "Ensuring clean slate..."
    local existing
    existing=$(count_factory_workers)
    if [[ "$existing" -gt 0 ]] || is_judge_running; then
        log_warn "Found existing worker(s), stopping first..."
        stop_fleet
        sleep 2
    fi

    # Step 2: Validate prerequisites
    log_step "Validating prerequisites..."
    validate_prerequisites

    # Step 3: Create directories
    log_step "Creating directories..."
    mkdir -p "$LOG_DIR"
    mkdir -p "$PID_DIR"

    # Step 4: Load environment variables
    log_step "Loading environment from $ENV_FILE..."
    set -a  # Auto-export all variables
    # shellcheck source=/dev/null
    source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=')
    set +a

    # Step 5: Set critical environment variables
    log_step "Setting runtime environment..."

    # PYTHONPATH: Required for worker to import from workers/core/
    export PYTHONPATH=/workspace
    log_info "PYTHONPATH=$PYTHONPATH"

    # PyTorch memory optimization (see comments in config section)
    export PYTORCH_CUDA_ALLOC_CONF="$PYTORCH_MEMORY_FIX"
    log_info "PYTORCH_CUDA_ALLOC_CONF=$PYTORCH_CUDA_ALLOC_CONF"

    # Step 6: Launch Factory workers with staggered startup
    log_step "Launching $FACTORY_WORKER_COUNT Factory workers..."
    echo ""

    for i in $(seq 1 "$FACTORY_WORKER_COUNT"); do
        local log_file="${LOG_DIR}/factory_${i}.log"
        local pid_file="${PID_DIR}/factory_${i}.pid"

        # Rotate large logs (>50MB)
        if [[ -f "$log_file" ]]; then
            local size
            size=$(stat -c%s "$log_file" 2>/dev/null || stat -f%z "$log_file" 2>/dev/null || echo 0)
            if [[ "$size" -gt 52428800 ]]; then
                mv "$log_file" "${log_file}.$(date +%Y%m%d_%H%M%S).old"
                log_info "Rotated large log file for Factory $i"
            fi
        fi

        # Launch Factory worker in background
        nohup python3 "$FACTORY_SCRIPT" >> "$log_file" 2>&1 &
        local pid=$!
        echo "$pid" > "$pid_file"

        log_info "Started Factory $i (PID: $pid) -> $(basename "$log_file")"

        # Stagger startup to prevent model loading race conditions
        if [[ $i -lt $FACTORY_WORKER_COUNT ]]; then
            log_info "Waiting ${LAUNCH_DELAY}s before next worker (model loading)..."
            sleep "$LAUNCH_DELAY"
        fi
    done

    # Step 7: Launch Judge worker
    echo ""
    log_step "Launching Judge worker..."
    local judge_log="${LOG_DIR}/judge.log"
    local judge_pid_file="${PID_DIR}/judge.pid"

    # Rotate large Judge log
    if [[ -f "$judge_log" ]]; then
        local size
        size=$(stat -c%s "$judge_log" 2>/dev/null || stat -f%z "$judge_log" 2>/dev/null || echo 0)
        if [[ "$size" -gt 52428800 ]]; then
            mv "$judge_log" "${judge_log}.$(date +%Y%m%d_%H%M%S).old"
            log_info "Rotated large log file for Judge"
        fi
    fi

    nohup python3 "$JUDGE_SCRIPT" >> "$judge_log" 2>&1 &
    local judge_pid=$!
    echo "$judge_pid" > "$judge_pid_file"
    log_info "Started Judge (PID: $judge_pid) -> judge.log"

    # Step 8: Verify startup
    echo ""
    log_step "Verifying fleet startup..."
    sleep 3

    local factory_running judge_status
    factory_running=$(count_factory_workers)
    if is_judge_running; then
        judge_status="running"
    else
        judge_status="failed"
    fi

    echo ""
    echo -e "${BOLD}========================================${NC}"
    if [[ "$factory_running" -eq "$FACTORY_WORKER_COUNT" ]] && [[ "$judge_status" == "running" ]]; then
        echo -e "  ${GREEN}FLEET STARTED: Factory=$factory_running/$FACTORY_WORKER_COUNT, Judge=OK${NC}"
    else
        echo -e "  ${YELLOW}PARTIAL START: Factory=$factory_running/$FACTORY_WORKER_COUNT, Judge=$judge_status${NC}"
        log_warn "Some workers may have failed - check logs"
    fi
    echo -e "${BOLD}========================================${NC}"
    echo ""

    # Show quick status
    check_status
}

stop_fleet() {
    echo ""
    log_step "Stopping all workers..."

    local factory_pids judge_pid all_pids
    factory_pids=$(get_factory_pids)
    judge_pid=$(get_judge_pid)

    # Combine all PIDs
    all_pids=""
    if [[ -n "$factory_pids" ]]; then
        all_pids="$factory_pids"
    fi
    if [[ -n "$judge_pid" ]]; then
        if [[ -n "$all_pids" ]]; then
            all_pids="${all_pids}"$'\n'"${judge_pid}"
        else
            all_pids="$judge_pid"
        fi
    fi

    if [[ -z "$all_pids" ]]; then
        log_info "No workers running"
        rm -f "${PID_DIR}"/*.pid 2>/dev/null || true
        return 0
    fi

    local count
    count=$(echo "$all_pids" | wc -l | tr -d ' ')
    log_info "Found $count worker(s) to stop (Factory + Judge)"

    # Phase 1: Graceful shutdown (SIGTERM)
    log_info "Sending SIGTERM for graceful shutdown..."
    echo "$all_pids" | xargs kill -TERM 2>/dev/null || true

    # Wait for graceful shutdown
    local elapsed=0
    while [[ $elapsed -lt $SHUTDOWN_TIMEOUT ]]; do
        sleep 1
        ((elapsed++))

        local remaining=0
        remaining=$(($(count_factory_workers)))
        if is_judge_running; then
            ((remaining++))
        fi

        if [[ "$remaining" -eq 0 ]]; then
            log_info "All workers stopped gracefully"
            rm -f "${PID_DIR}"/*.pid 2>/dev/null || true
            return 0
        fi

        if [[ $((elapsed % 5)) -eq 0 ]]; then
            log_info "Waiting for $remaining worker(s)... ($elapsed/${SHUTDOWN_TIMEOUT}s)"
        fi
    done

    # Phase 2: Force kill (SIGKILL)
    log_warn "Graceful shutdown timed out, sending SIGKILL..."
    factory_pids=$(get_factory_pids)
    judge_pid=$(get_judge_pid)
    if [[ -n "$factory_pids" ]]; then
        echo "$factory_pids" | xargs kill -9 2>/dev/null || true
    fi
    if [[ -n "$judge_pid" ]]; then
        kill -9 "$judge_pid" 2>/dev/null || true
    fi

    sleep 1
    rm -f "${PID_DIR}"/*.pid 2>/dev/null || true

    local final=0
    final=$(($(count_factory_workers)))
    if is_judge_running; then
        ((final++))
    fi

    if [[ "$final" -eq 0 ]]; then
        log_info "Workers force stopped"
    else
        log_error "Failed to stop $final worker(s)"
        return 1
    fi
}

restart_fleet() {
    log_info "Restarting fleet..."
    stop_fleet
    sleep 3
    start_fleet
}

check_status() {
    echo ""
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD}  CallScript Fleet Status${NC}"
    echo -e "${BOLD}========================================${NC}"
    echo ""

    local factory_running judge_status
    factory_running=$(count_factory_workers)
    if is_judge_running; then
        judge_status="${GREEN}running${NC}"
    else
        judge_status="${RED}stopped${NC}"
    fi

    # Health indicator
    local total_expected=$((FACTORY_WORKER_COUNT + 1))  # Factory + Judge
    local total_running=$factory_running
    if is_judge_running; then
        ((total_running++))
    fi

    if [[ "$total_running" -eq "$total_expected" ]]; then
        echo -e "  Status: ${GREEN}HEALTHY${NC}"
    elif [[ "$total_running" -gt 0 ]]; then
        echo -e "  Status: ${YELLOW}DEGRADED${NC}"
    else
        echo -e "  Status: ${RED}DOWN${NC}"
    fi

    echo -e "    Factory: $factory_running/$FACTORY_WORKER_COUNT workers"
    echo -e "    Judge:   $judge_status"

    # Process details
    echo ""
    echo "  Process Details:"
    echo "  ----------------"

    # Factory workers
    local factory_pids
    factory_pids=$(get_factory_pids)
    if [[ -n "$factory_pids" ]]; then
        echo "$factory_pids" | while read -r pid; do
            if [[ -n "$pid" ]]; then
                local mem cpu
                mem=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.1f", $1/1024}' || echo "N/A")
                cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "N/A")
                echo "    Factory PID $pid: CPU=${cpu}% MEM=${mem}MB"
            fi
        done
    fi

    # Judge worker
    local judge_pid
    judge_pid=$(get_judge_pid)
    if [[ -n "$judge_pid" ]]; then
        local mem cpu
        mem=$(ps -p "$judge_pid" -o rss= 2>/dev/null | awk '{printf "%.1f", $1/1024}' || echo "N/A")
        cpu=$(ps -p "$judge_pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "N/A")
        echo "    Judge   PID $judge_pid: CPU=${cpu}% MEM=${mem}MB"
    fi

    # Environment verification
    echo ""
    echo "  Environment:"
    echo "  ------------"
    if [[ -n "$factory_pids" ]]; then
        local sample_pid
        sample_pid=$(echo "$factory_pids" | head -1)
        if [[ -n "$sample_pid" ]]; then
            local cuda_conf
            cuda_conf=$(tr '\0' '\n' < /proc/"$sample_pid"/environ 2>/dev/null | grep PYTORCH_CUDA || echo "NOT SET")
            local pypath
            pypath=$(tr '\0' '\n' < /proc/"$sample_pid"/environ 2>/dev/null | grep PYTHONPATH || echo "NOT SET")
            echo "    $cuda_conf"
            echo "    $pypath"
        fi
    else
        echo "    (No Factory workers running)"
    fi

    # Log file status
    echo ""
    echo "  Log Files:"
    echo "  ----------"
    for i in $(seq 1 "$FACTORY_WORKER_COUNT"); do
        local log_file="${LOG_DIR}/factory_${i}.log"
        if [[ -f "$log_file" ]]; then
            local size
            size=$(du -h "$log_file" 2>/dev/null | cut -f1 || echo "?")
            local last_activity
            last_activity=$(tail -1 "$log_file" 2>/dev/null | cut -c1-60 || echo "empty")
            echo "    factory_${i}.log ($size): ${last_activity}..."
        else
            echo "    factory_${i}.log: [not created]"
        fi
    done

    # Judge log
    local judge_log="${LOG_DIR}/judge.log"
    if [[ -f "$judge_log" ]]; then
        local size
        size=$(du -h "$judge_log" 2>/dev/null | cut -f1 || echo "?")
        local last_activity
        last_activity=$(tail -1 "$judge_log" 2>/dev/null | cut -c1-60 || echo "empty")
        echo "    judge.log ($size): ${last_activity}..."
    else
        echo "    judge.log: [not created]"
    fi

    # Recent activity
    echo ""
    echo "  Recent Activity:"
    echo "  ----------------"
    if [[ -f "${LOG_DIR}/factory_1.log" ]]; then
        echo "  Factory:"
        tail -1 "${LOG_DIR}/factory_1.log" 2>/dev/null | sed 's/^/    /' || echo "    [no logs]"
    fi
    if [[ -f "${LOG_DIR}/judge.log" ]]; then
        echo "  Judge:"
        tail -1 "${LOG_DIR}/judge.log" 2>/dev/null | sed 's/^/    /' || echo "    [no logs]"
    fi

    echo ""
    echo -e "${BOLD}========================================${NC}"
    echo ""
}

show_logs() {
    local target="${1:-factory}"
    local log_file

    case "$target" in
        judge|j)
            log_file="${LOG_DIR}/judge.log"
            ;;
        factory|f|[1-4])
            if [[ "$target" =~ ^[1-4]$ ]]; then
                log_file="${LOG_DIR}/factory_${target}.log"
            else
                log_file="${LOG_DIR}/factory_1.log"
            fi
            ;;
        *)
            log_error "Unknown log target: $target (use: judge, factory, or 1-4)"
            exit 1
            ;;
    esac

    if [[ ! -f "$log_file" ]]; then
        log_error "Log file not found: $log_file"
        exit 1
    fi

    log_info "Tailing $log_file (Ctrl+C to exit)..."
    echo ""
    tail -f "$log_file"
}

show_help() {
    cat << EOF
CallScript V2 - Fleet Manager

Usage: $0 <command> [options]

Commands:
  start           Start the worker fleet (Factory + Judge)
  stop            Stop all workers gracefully (${SHUTDOWN_TIMEOUT}s timeout)
  restart         Stop then start the fleet
  status          Show fleet health and statistics
  logs [target]   Tail logs (judge, factory, 1-4)
  help            Show this help message

Configuration:
  Factory:    $FACTORY_WORKER_COUNT concurrent GPU workers
  Judge:      1 GPT-4o QA worker
  Logs:       $LOG_DIR/factory_*.log, $LOG_DIR/judge.log
  Memory Fix: PYTORCH_CUDA_ALLOC_CONF=$PYTORCH_MEMORY_FIX

Examples:
  $0 start          # Launch Factory (4) + Judge (1)
  $0 status         # Check fleet health
  $0 logs judge     # Watch Judge logs
  $0 logs 2         # Watch Factory worker 2
  $0 stop           # Shutdown fleet

EOF
}

# =============================================================================
# MAIN ENTRY POINT
# =============================================================================
main() {
    local command="${1:-help}"
    shift || true

    case "$command" in
        start)
            start_fleet
            ;;
        stop)
            stop_fleet
            ;;
        restart)
            restart_fleet
            ;;
        status)
            check_status
            ;;
        logs)
            show_logs "$@"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
