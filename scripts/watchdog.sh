#!/bin/bash
# =============================================================================
# CallScript V2 - Watchdog Health Monitor
# =============================================================================
# Continuous background process that:
#   1. Monitors worker health (restarts dead workers)
#   2. Checks queue depth (alerts on backup)
#   3. Reports to Slack webhook (optional)
#
# Run: nohup ./scripts/watchdog.sh &
# =============================================================================

set -euo pipefail

# Configuration
readonly CHECK_INTERVAL=60         # seconds between checks
readonly QUEUE_ALERT_THRESHOLD=200 # alert if pending > this
readonly FACTORY_EXPECTED=4
readonly LOG_FILE="/workspace/logs/watchdog.log"
readonly FLEET_MANAGER="/workspace/scripts/manage_fleet.sh"

# Slack webhook (optional - set in .env as SLACK_WEBHOOK_URL)
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"

# Load environment
if [[ -f /workspace/.env ]]; then
    set -a
    source <(grep -v '^#' /workspace/.env | grep -v '^$' | grep '=')
    set +a
    SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WATCHDOG: $1" >> "$LOG_FILE"
}

alert_slack() {
    local message="$1"
    local severity="${2:-warning}"  # warning, critical

    if [[ -z "$SLACK_WEBHOOK" ]]; then
        log "ALERT (no slack): $message"
        return
    fi

    local emoji="⚠️"
    [[ "$severity" == "critical" ]] && emoji="🚨"

    local payload=$(cat <<EOF
{
    "text": "${emoji} *CallScript Alert*\n${message}",
    "username": "CallScript Watchdog",
    "icon_emoji": ":dog:"
}
EOF
)

    curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" "$SLACK_WEBHOOK" >/dev/null 2>&1 || true

    log "ALERT sent to Slack: $message"
}

count_factory_workers() {
    pgrep -fc "python3.*factory/worker.py" 2>/dev/null || echo 0
}

is_judge_running() {
    pgrep -f "python3.*judge.py" >/dev/null 2>&1
}

get_queue_depth() {
    # Query Supabase for pending count
    # This requires curl + service role key
    local key="${SUPABASE_SERVICE_ROLE_KEY:-}"
    local url="${SUPABASE_URL:-}"

    if [[ -z "$key" || -z "$url" ]]; then
        echo "-1"
        return
    fi

    local response
    response=$(curl -s "${url}/rest/v1/calls?select=id&status=eq.pending" \
        -H "apikey: $key" \
        -H "Authorization: Bearer $key" \
        -H "Prefer: count=exact" \
        -I 2>/dev/null | grep -i 'content-range' || echo "")

    if [[ -z "$response" ]]; then
        echo "-1"
        return
    fi

    # Parse content-range: */123 format
    local count
    count=$(echo "$response" | sed -n 's/.*\/\([0-9]*\).*/\1/p' | tr -d '\r')
    echo "${count:-0}"
}

check_gpu_health() {
    if ! nvidia-smi &>/dev/null; then
        return 1
    fi

    # Check GPU memory usage
    local mem_used mem_total
    mem_used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1)
    mem_total=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)

    if [[ -n "$mem_used" && -n "$mem_total" ]]; then
        local pct=$((mem_used * 100 / mem_total))
        if [[ $pct -gt 95 ]]; then
            log "WARN: GPU memory at ${pct}%"
            return 2  # Warning, not failure
        fi
    fi

    return 0
}

restart_workers() {
    log "Restarting workers..."
    cd /workspace

    export PYTHONPATH=/workspace
    export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

    bash "$FLEET_MANAGER" restart >> "$LOG_FILE" 2>&1
}

# =============================================================================
# MAIN LOOP
# =============================================================================
log "=== Watchdog Started ==="
log "Check interval: ${CHECK_INTERVAL}s"
log "Queue threshold: ${QUEUE_ALERT_THRESHOLD}"
log "Slack webhook: $([ -n "$SLACK_WEBHOOK" ] && echo 'configured' || echo 'not set')"

last_alert_time=0
ALERT_COOLDOWN=300  # Don't spam - 5 min cooldown

while true; do
    current_time=$(date +%s)

    # -----------------------------------------------------------------
    # Check 1: Worker Health
    # -----------------------------------------------------------------
    factory_count=$(count_factory_workers)
    judge_running=false
    is_judge_running && judge_running=true

    workers_healthy=true

    if [[ $factory_count -lt $FACTORY_EXPECTED ]]; then
        workers_healthy=false
        log "CRITICAL: Only $factory_count/$FACTORY_EXPECTED Factory workers running"

        if [[ $((current_time - last_alert_time)) -gt $ALERT_COOLDOWN ]]; then
            alert_slack "Factory workers degraded: $factory_count/$FACTORY_EXPECTED running" "critical"
            last_alert_time=$current_time
        fi
    fi

    if [[ "$judge_running" != "true" ]]; then
        workers_healthy=false
        log "CRITICAL: Judge worker not running"

        if [[ $((current_time - last_alert_time)) -gt $ALERT_COOLDOWN ]]; then
            alert_slack "Judge worker is DOWN" "critical"
            last_alert_time=$current_time
        fi
    fi

    # Auto-restart if workers are down
    if [[ "$workers_healthy" != "true" ]]; then
        log "Attempting automatic restart..."
        restart_workers
        sleep 10  # Give workers time to start

        # Check again
        factory_count=$(count_factory_workers)
        is_judge_running && judge_running=true || judge_running=false

        if [[ $factory_count -eq $FACTORY_EXPECTED ]] && [[ "$judge_running" == "true" ]]; then
            log "Restart successful: Factory=$factory_count, Judge=running"
            alert_slack "Workers recovered after restart: Factory=$factory_count/4, Judge=OK" "warning"
        else
            log "Restart FAILED: Factory=$factory_count, Judge=$judge_running"
            alert_slack "Worker restart FAILED - manual intervention needed" "critical"
        fi
    fi

    # -----------------------------------------------------------------
    # Check 2: GPU Health
    # -----------------------------------------------------------------
    if ! check_gpu_health; then
        log "CRITICAL: GPU not responding"
        if [[ $((current_time - last_alert_time)) -gt $ALERT_COOLDOWN ]]; then
            alert_slack "GPU not responding - pod may need restart" "critical"
            last_alert_time=$current_time
        fi
    fi

    # -----------------------------------------------------------------
    # Check 3: Queue Depth
    # -----------------------------------------------------------------
    pending=$(get_queue_depth)
    if [[ "$pending" -gt "$QUEUE_ALERT_THRESHOLD" ]]; then
        log "WARN: Queue backup - $pending pending calls"
        if [[ $((current_time - last_alert_time)) -gt $ALERT_COOLDOWN ]]; then
            alert_slack "Queue backup: $pending pending calls (threshold: $QUEUE_ALERT_THRESHOLD)" "warning"
            last_alert_time=$current_time
        fi
    fi

    # -----------------------------------------------------------------
    # Heartbeat log (every 10 checks)
    # -----------------------------------------------------------------
    if [[ $((RANDOM % 10)) -eq 0 ]]; then
        log "Heartbeat: Factory=$factory_count, Judge=$judge_running, Pending=$pending"
    fi

    sleep "$CHECK_INTERVAL"
done
