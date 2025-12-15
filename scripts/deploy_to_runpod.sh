#!/bin/bash
# =============================================================================
# CallScript V2 - Deploy to RunPod
# =============================================================================
# Syncs worker code to RunPod and restarts workers.
#
# Usage:
#   ./scripts/deploy_to_runpod.sh <runpod-ssh-host>
#
# Example:
#   ./scripts/deploy_to_runpod.sh root@123.456.789.0
#   ./scripts/deploy_to_runpod.sh runpod  # if configured in ~/.ssh/config
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${SCRIPT_DIR}/.."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <runpod-ssh-host>"
    echo ""
    echo "Example:"
    echo "  $0 root@123.456.789.0"
    echo "  $0 runpod  # if configured in ~/.ssh/config"
    exit 1
fi

RUNPOD_HOST="$1"
REMOTE_PATH="/workspace"

log_info "Deploying CallScript V2 to RunPod..."
log_info "Host: $RUNPOD_HOST"

# -----------------------------------------------------------------------------
# 1. Sync worker files
# -----------------------------------------------------------------------------
log_info "Syncing worker code..."

rsync -avz --progress \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'logs/*' \
    --exclude 'pids/*' \
    --exclude '.env.local' \
    --include 'workers/***' \
    --include 'scripts/***' \
    --include 'supervisord.conf' \
    --include '.env' \
    --exclude '*' \
    "$WORKSPACE/" "$RUNPOD_HOST:$REMOTE_PATH/"

# -----------------------------------------------------------------------------
# 2. Restart workers
# -----------------------------------------------------------------------------
log_info "Restarting workers on RunPod..."

ssh "$RUNPOD_HOST" << 'EOF'
    cd /workspace

    # Source environment
    set -a
    source <(grep -v '^#' /workspace/.env | grep -v '^$' | grep '=')
    set +a
    export PYTHONPATH=/workspace
    export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

    # Check if supervisor is running
    if pgrep -f "supervisord.*supervisord.conf" > /dev/null; then
        echo "Restarting workers via supervisor..."
        supervisorctl -c /workspace/supervisord.conf restart factory:*
        sleep 3
        supervisorctl -c /workspace/supervisord.conf status
    else
        echo "Supervisor not running, starting fresh..."
        # Kill any existing workers
        pkill -f "workers/factory/worker.py" 2>/dev/null || true
        sleep 2

        # Start via supervisor
        supervisord -c /workspace/supervisord.conf
        sleep 5
        supervisorctl -c /workspace/supervisord.conf status
    fi

    echo ""
    echo "GPU Memory Status:"
    nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv
EOF

log_info "Deployment complete!"
log_info ""
log_info "Monitor logs with:"
log_info "  ssh $RUNPOD_HOST 'tail -f /workspace/logs/factory_*.log'"
