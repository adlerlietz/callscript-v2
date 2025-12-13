#!/bin/bash
# =============================================================================
# CallScript V2 - Install Auto-Start on RunPod
# =============================================================================
# Run this script ONCE on a fresh RunPod pod to enable auto-restart on reboot.
#
# Usage:
#   scp scripts/install_autostart.sh root@<pod>:/workspace/
#   ssh root@<pod> 'bash /workspace/scripts/install_autostart.sh'
#
# What it does:
#   1. Creates systemd service for CallScript workers
#   2. Enables service to start on boot
#   3. Starts the service immediately
# =============================================================================

set -euo pipefail

echo "=== CallScript Auto-Start Installation ==="

# Check we're on Linux with systemd
if [[ ! -d /etc/systemd/system ]]; then
    echo "ERROR: systemd not found. This script is for RunPod/Linux only."
    exit 1
fi

# Check required files exist
if [[ ! -f /workspace/.env ]]; then
    echo "ERROR: /workspace/.env not found"
    exit 1
fi

if [[ ! -f /workspace/scripts/manage_fleet.sh ]]; then
    echo "ERROR: /workspace/scripts/manage_fleet.sh not found"
    exit 1
fi

# Create systemd service
echo "Creating systemd service..."

cat > /etc/systemd/system/callscript.service << 'EOF'
[Unit]
Description=CallScript V2 Worker Fleet
After=network.target

[Service]
Type=forking
User=root
WorkingDirectory=/workspace
Environment=PYTHONPATH=/workspace
Environment=PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# Source environment variables
ExecStartPre=/bin/bash -c 'set -a && source /workspace/.env && set +a'

# Start the fleet
ExecStart=/workspace/scripts/manage_fleet.sh start

# Stop the fleet gracefully
ExecStop=/workspace/scripts/manage_fleet.sh stop

# Restart on failure
Restart=on-failure
RestartSec=30

# Give workers time to start/stop
TimeoutStartSec=120
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

# Create watchdog service (optional, runs alongside main service)
echo "Creating watchdog service..."

cat > /etc/systemd/system/callscript-watchdog.service << 'EOF'
[Unit]
Description=CallScript V2 Watchdog
After=callscript.service
Requires=callscript.service

[Service]
Type=simple
User=root
WorkingDirectory=/workspace
EnvironmentFile=/workspace/.env

ExecStart=/workspace/scripts/watchdog.sh

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable services
echo "Enabling services..."
systemctl enable callscript.service
systemctl enable callscript-watchdog.service

# Start services
echo "Starting services..."
systemctl start callscript.service
sleep 5
systemctl start callscript-watchdog.service

# Show status
echo ""
echo "=== Installation Complete ==="
echo ""
systemctl status callscript.service --no-pager || true
echo ""
systemctl status callscript-watchdog.service --no-pager || true

echo ""
echo "Commands:"
echo "  systemctl status callscript       # Check status"
echo "  systemctl restart callscript      # Restart workers"
echo "  journalctl -u callscript -f       # Watch logs"
echo ""
