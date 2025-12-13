#!/bin/bash
# =============================================================================
# CallScript V2 - RunPod Auto-Start Script
# =============================================================================
# This script runs on pod boot to automatically start workers.
#
# Installation:
#   1. Copy to RunPod: scp scripts/runpod_startup.sh root@<pod>:/workspace/
#   2. SSH into pod and run:
#      echo '/workspace/runpod_startup.sh' >> /root/.bashrc
#   OR for systemd (more reliable):
#      See /workspace/scripts/install_autostart.sh
#
# What it does:
#   1. Waits for GPU to be available
#   2. Starts Fleet Manager (Factory + Judge workers)
#   3. Starts Watchdog (background health monitor)
# =============================================================================

set -euo pipefail

readonly LOG_FILE="/workspace/logs/startup.log"
readonly FLEET_MANAGER="/workspace/scripts/manage_fleet.sh"
readonly WATCHDOG_SCRIPT="/workspace/scripts/watchdog.sh"
readonly MAX_GPU_WAIT=120  # seconds

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Ensure log directory exists
mkdir -p /workspace/logs

log "=== CallScript RunPod Startup ==="
log "Pod boot detected, initializing..."

# -----------------------------------------------------------------------------
# 1. Wait for GPU to be available
# -----------------------------------------------------------------------------
log "Waiting for GPU..."
gpu_ready=false
elapsed=0

while [[ $elapsed -lt $MAX_GPU_WAIT ]]; do
    if nvidia-smi &>/dev/null; then
        gpu_ready=true
        break
    fi
    sleep 5
    ((elapsed+=5))
    log "GPU not ready, waiting... ($elapsed/$MAX_GPU_WAIT s)"
done

if [[ "$gpu_ready" != "true" ]]; then
    log "ERROR: GPU not available after $MAX_GPU_WAIT seconds"
    exit 1
fi

log "GPU ready: $(nvidia-smi --query-gpu=name --format=csv,noheader)"

# -----------------------------------------------------------------------------
# 2. Check prerequisites
# -----------------------------------------------------------------------------
if [[ ! -f "/workspace/.env" ]]; then
    log "ERROR: /workspace/.env not found"
    exit 1
fi

if [[ ! -f "$FLEET_MANAGER" ]]; then
    log "ERROR: Fleet manager not found at $FLEET_MANAGER"
    exit 1
fi

# -----------------------------------------------------------------------------
# 3. Start Fleet (Factory + Judge workers)
# -----------------------------------------------------------------------------
log "Starting Fleet Manager..."
cd /workspace

# Source environment
set -a
source <(grep -v '^#' /workspace/.env | grep -v '^$' | grep '=')
set +a

# Export required vars
export PYTHONPATH=/workspace
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Start fleet
bash "$FLEET_MANAGER" start >> "$LOG_FILE" 2>&1

# -----------------------------------------------------------------------------
# 4. Start Watchdog (optional - for continuous monitoring)
# -----------------------------------------------------------------------------
if [[ -f "$WATCHDOG_SCRIPT" ]]; then
    log "Starting Watchdog..."
    nohup bash "$WATCHDOG_SCRIPT" >> /workspace/logs/watchdog.log 2>&1 &
    log "Watchdog started (PID: $!)"
else
    log "WARN: Watchdog script not found, skipping"
fi

log "=== Startup Complete ==="
log "Workers: $(pgrep -fc 'python3.*worker' || echo 0) running"
