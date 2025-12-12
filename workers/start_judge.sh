#!/bin/bash

# Kill existing judge process
pkill -f 'python3.*judge.py' 2>/dev/null

# Load environment variables from .env file
if [ -f /workspace/.env ]; then
    export $(grep -v '^#' /workspace/.env | xargs)
fi

# Verify required vars
if [ -z "$OPENAI_API_KEY" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "ERROR: Missing required environment variables in /workspace/.env"
    echo "Required: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Launch judge worker
cd /workspace
nohup python3 -u judge.py > judge.log 2>&1 &

echo "Judge worker launched with PID $!"
