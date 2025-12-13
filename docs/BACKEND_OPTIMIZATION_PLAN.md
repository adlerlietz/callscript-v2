# CallScript V2 - Backend Optimization Master Plan

**Created**: December 13, 2025
**Status**: APPROVED FOR EXECUTION
**Estimated Effort**: 4 Phases over 2-3 days

---

## Executive Summary

The 4-Lane Pipeline (Ingest → Vault → Factory → Judge) is operational. This plan addresses the remaining backend gaps to achieve production-grade reliability and observability.

### Current State
- ✅ All 4 workers deployed and running on RunPod
- ✅ Database schema with zombie killer, triggers, indexes
- ✅ Basic health check scripts exist
- ⚠️ No external monitoring endpoint
- ⚠️ Slack alerts not wired up
- ⚠️ 1,807 calls stuck in `failed` status
- ⚠️ No historical backfill capability
- ⚠️ Workers don't auto-restart on crash

---

## Phase 1: External Monitoring & Alerting (CRITICAL)
**Goal**: Enable monitoring from outside RunPod + get Slack alerts working

### 1.1 Health Check HTTP Endpoint
Create a lightweight HTTP server that exposes fleet health for external monitoring (UptimeRobot, Pingdom, etc.)

**File**: `workers/health_server.py`

```
GET /health → 200 OK {"status": "healthy", "workers": 7, "queue": {...}}
GET /health → 503 Service Unavailable {"status": "critical", "error": "..."}
```

**Implementation**:
- Flask/FastAPI micro-server on port 8080
- Checks: worker process count, DB connectivity, queue stats
- Returns JSON with queue breakdown
- Runs as separate daemon alongside workers

**Deployment**:
- Add `scripts/start_health_server.sh`
- Expose port 8080 on RunPod (already available)

### 1.2 Slack Webhook Integration
Wire up the existing `core.check_queue_and_alert()` function.

**Steps**:
1. Get Slack Incoming Webhook URL
2. Set in Supabase: `ALTER DATABASE postgres SET app.settings.slack_webhook = 'https://hooks.slack.com/...'`
3. Test: `SELECT core.check_queue_and_alert();`

**Already Implemented** (just needs config):
- Queue backup alert (pending > 200)
- Stall detection (processing > 1 hour)
- Zombie killer notifications

### 1.3 External Uptime Monitor
After health endpoint is live:
- Configure UptimeRobot/Pingdom to hit `http://<runpod-ip>:8080/health`
- Alert on non-200 response
- 1-minute check interval

**Deliverables**:
- [ ] `workers/health_server.py` - HTTP health endpoint
- [ ] `scripts/start_health_server.sh` - Launcher script
- [ ] Slack webhook configured in Supabase
- [ ] External monitor configured

---

## Phase 2: Failed Call Recovery (CRITICAL)
**Goal**: Recover the 1,807 calls stuck in `failed` status

### 2.1 Analyze Failed Calls
First, understand why they failed:

```sql
SELECT
  processing_error,
  COUNT(*) as count
FROM core.calls
WHERE status = 'failed'
GROUP BY processing_error
ORDER BY count DESC
LIMIT 20;
```

**Common Recoverable Errors**:
- CUDA OOM → Retry (Factory handles chunking now)
- Pyannote timeout → Retry
- Network transient → Retry
- Zombie reset → Retry

**Non-Recoverable Errors**:
- HTTP 404 (audio deleted) → Permanent fail
- HTTP 403 (auth expired) → Need fresh URL from Ringba
- Corrupted audio → Permanent fail

### 2.2 Recovery Script Enhancement
Enhance existing `scripts/recover_failed.py`:

```python
# Mode 1: Analyze only (default)
python scripts/recover_failed.py

# Mode 2: Recover with storage_path (re-run Factory)
python scripts/recover_failed.py --recover-with-audio

# Mode 3: Recover all (re-run from Vault)
python scripts/recover_failed.py --recover-all --execute

# Mode 4: Re-fetch from Ringba (refresh audio URLs)
python scripts/recover_failed.py --refresh-urls --execute
```

### 2.3 Ringba URL Refresh
For 404/403 errors, audio URLs expired. Need to:
1. Query Ringba API for fresh `recordingUrl` by `inboundCallId`
2. Update `core.calls.audio_url`
3. Reset status to `pending`

**New Script**: `scripts/refresh_audio_urls.py`

**Deliverables**:
- [ ] Failed call analysis report
- [ ] Enhanced `recover_failed.py` with multiple modes
- [ ] `refresh_audio_urls.py` for expired URLs
- [ ] Execute recovery, reduce failed count

---

## Phase 3: Historical Backfill (CRITICAL)
**Goal**: Ingest calls older than 5 minutes (the current lookback window)

### 3.1 Backfill Mode for Ingest Worker
Add `--backfill` flag to fetch historical data:

```bash
# Normal mode (last 5 minutes, continuous)
./scripts/start_ingest.sh --daemon

# Backfill mode (one-time, last 24 hours)
python workers/ingest/worker.py --backfill --hours 24

# Backfill mode (one-time, specific date range)
python workers/ingest/worker.py --backfill --start "2025-12-01" --end "2025-12-10"
```

**Implementation**:
- Add argparse for CLI flags
- Override `LOOKBACK_MINUTES` based on flags
- Run once and exit (not continuous loop)
- Progress logging: "Fetched page 1/10... 2/10..."

### 3.2 Edge Function Backfill
The `sync-ringba-realtime` Edge Function already supports backfill:

```bash
# Backfill last 24 hours (1440 minutes)
curl -X POST https://xxx.supabase.co/functions/v1/sync-ringba-realtime \
  -H "Authorization: Bearer <anon_key>" \
  -H "Content-Type: application/json" \
  -d '{"lookback": 1440}'
```

### 3.3 Backfill Strategy
1. **Week 1 (Recent)**: Backfill last 7 days via Python worker
2. **Week 2+ (Historical)**: Use Edge Function in batches (24h chunks)
3. **Monitoring**: Track ingested vs processed counts

**Deliverables**:
- [ ] `--backfill` mode in Ingest worker
- [ ] Backfill execution for last 7-30 days
- [ ] Documentation on backfill procedures

---

## Phase 4: Auto-Restart & Reliability (IMPORTANT)
**Goal**: Workers automatically restart after crash/reboot

### 4.1 Supervisor Configuration
Use `supervisord` on RunPod for process management:

**File**: `/workspace/supervisord.conf`

```ini
[supervisord]
nodaemon=true
logfile=/workspace/logs/supervisord.log

[program:ingest]
command=python3 /workspace/workers/ingest/worker.py
autostart=true
autorestart=true
stderr_logfile=/workspace/logs/ingest.err.log
stdout_logfile=/workspace/logs/ingest.log

[program:vault]
command=python3 /workspace/workers/vault/worker.py
autostart=true
autorestart=true
stderr_logfile=/workspace/logs/vault.err.log
stdout_logfile=/workspace/logs/vault.log

[program:judge]
command=python3 /workspace/workers/judge/worker.py
autostart=true
autorestart=true
stderr_logfile=/workspace/logs/judge.err.log
stdout_logfile=/workspace/logs/judge.log

[program:factory_1]
command=python3 /workspace/workers/factory/worker.py
autostart=true
autorestart=true
stderr_logfile=/workspace/logs/factory_1.err.log
stdout_logfile=/workspace/logs/factory_1.log

[program:factory_2]
command=python3 /workspace/workers/factory/worker.py
autostart=true
autorestart=true

[program:factory_3]
command=python3 /workspace/workers/factory/worker.py
autostart=true
autorestart=true

[program:factory_4]
command=python3 /workspace/workers/factory/worker.py
autostart=true
autorestart=true

[program:health_server]
command=python3 /workspace/workers/health_server.py
autostart=true
autorestart=true
```

### 4.2 RunPod Start Script
Update `/workspace/start.sh` to use supervisor:

```bash
#!/bin/bash
# Load environment
source /workspace/.env

# Start supervisor (manages all workers)
supervisord -c /workspace/supervisord.conf
```

### 4.3 Log Rotation
Add logrotate configuration:

**File**: `/workspace/logrotate.conf`

```
/workspace/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    size 50M
}
```

**Cron**: `0 0 * * * /usr/sbin/logrotate /workspace/logrotate.conf`

**Deliverables**:
- [ ] `supervisord.conf` for process management
- [ ] Updated `start.sh` for RunPod boot
- [ ] Log rotation configured
- [ ] Test: kill worker, verify auto-restart

---

## Phase 5: Observability & Metrics (NICE-TO-HAVE)
**Goal**: Production-grade monitoring with Prometheus/Grafana

### 5.1 Prometheus Metrics Endpoint
Add `/metrics` endpoint to health server:

```
# HELP callscript_queue_pending Number of pending calls
# TYPE callscript_queue_pending gauge
callscript_queue_pending 42

# HELP callscript_queue_processing Number of processing calls
# TYPE callscript_queue_processing gauge
callscript_queue_processing 4

# HELP callscript_workers_running Number of running workers
# TYPE callscript_workers_running gauge
callscript_workers_running 7

# HELP callscript_calls_processed_total Total calls processed
# TYPE callscript_calls_processed_total counter
callscript_calls_processed_total{status="flagged"} 431
callscript_calls_processed_total{status="safe"} 443
```

### 5.2 Grafana Dashboard
Pre-built dashboard showing:
- Queue depth over time
- Processing rate (calls/minute)
- Error rate by lane
- Worker uptime

### 5.3 Error Tracking
Integrate Sentry for exception tracking:
- Capture stack traces from workers
- Alert on new error types
- Track error frequency

**Deliverables**:
- [ ] Prometheus metrics endpoint
- [ ] Grafana dashboard JSON
- [ ] Sentry integration (optional)

---

## Execution Order

```
Week 1 (Days 1-2): CRITICAL ITEMS
├── Phase 1.1: Health HTTP Endpoint ............ 2 hours
├── Phase 1.2: Slack Webhook Setup ............. 30 mins
├── Phase 1.3: External Monitor ................ 30 mins
├── Phase 2.1: Analyze Failed Calls ............ 1 hour
├── Phase 2.2: Recovery Script ................. 2 hours
└── Phase 2.3: Execute Recovery ................ 1 hour

Week 1 (Days 2-3): IMPORTANT ITEMS
├── Phase 3.1: Backfill Mode ................... 2 hours
├── Phase 3.2: Execute Backfill ................ 1 hour
├── Phase 4.1: Supervisor Config ............... 2 hours
└── Phase 4.2: Test Auto-Restart ............... 1 hour

Week 2 (Optional): NICE-TO-HAVE
├── Phase 5.1: Prometheus Metrics .............. 3 hours
├── Phase 5.2: Grafana Dashboard ............... 2 hours
└── Phase 5.3: Sentry Integration .............. 2 hours
```

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Failed Calls | 1,807 | < 100 |
| External Monitoring | None | UptimeRobot active |
| Slack Alerts | Not wired | Firing on threshold |
| Auto-Restart | Manual | Supervisor managed |
| Historical Data | Last 5 min | Last 30 days |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Recovery breaks more calls | Run with `--dry-run` first |
| Backfill overwhelms Ringba API | Rate limit to 1 req/sec |
| Supervisor conflicts with manual | Stop all workers before supervisor |
| Health server port blocked | Use RunPod's exposed ports |

---

## Next Steps

1. **Approve this plan** or request modifications
2. **Start Phase 1.1** - Health HTTP Endpoint
3. **Provide Slack Webhook URL** for Phase 1.2

Ready to execute on your command.
