# 🧱 ENGINEERING PITFALLS & HOW WE OVERCAME THEM

**CallScript V2 – Engineering Failure Prevention Guide**

**Version:** 1.0

**Date:** December 10, 2025

---

## 📌 Purpose of This Document

V1 of the CallScript platform failed for three core reasons:

1. **Architectural brittleness** (Monolithic Docker containers).
2. **Lack of invariants** (No database constraints or locking).
3. **Undocumented tribal knowledge** (Fixes lived in Slack, not code).

This document fixes that by explaining **What went wrong**, **Why it went wrong**, and **How V2's architecture prevents recurrence**. It exists as a permanent engineering companion to the Master Bible.

---

## ⚠️ SECTION 1: INGESTION FAILURES

### Pitfall 1: Pagination Drift (Ringba API inconsistency)

**What went wrong:**

We relied on Ringba's `totalCount` to determine when pagination should end. Ringba API often returns short pages (e.g., 95 records instead of 1000) or partial results, causing offset drift.

**Result:** Missing pages, duplicate pages, and days of incomplete data.

**How V2 Fixes It:**

- **Fixed-step pagination:** Always increment offset by `PAGE_SIZE` (1000). Never by `records.length`.
- **3 Stop Conditions:**
  1. `records.length < PAGE_SIZE`
  2. `partialResult == true`
  3. `fetched >= reportTotal`

📖 **Bible Ref:** 5.1 Ingest Lane (Hardened).

---

### Pitfall 2: Not Idempotent → Duplicate Call Records

**What went wrong:**

V1 inserted calls without a unique constraint or idempotency key. Overlapping fetch windows created duplicate entries.

**How V2 Fixes It:**

- **Unique Constraint:** `ringba_call_id` is defined as `UNIQUE` in Postgres.
- **Upsert Strategy:** Ingest uses `ON CONFLICT DO UPDATE`, never `INSERT` blindly.

---

### Pitfall 3: Ingest Functions Crashed Under Load

**What went wrong:**

V1 used long-running server code (Python scripts) that choked when Ringba returned 30k+ calls.

**How V2 Fixes It:**

- **Serverless:** Supabase Edge Functions handle concurrency automatically.
- **Small Windows:** 15-minute rolling fetch window limits payload size (<5000 records).
- **Hardened Termination:** Logic ensures deterministic sync even if API is slow.

---

## ⚠️ SECTION 2: AUDIO INGESTION FAILURES

### Pitfall 4: Downloading Audio in the Worker

**What went wrong:**

V1 attempted to pull audio from Ringba inside the GPU workers. This stalled expensive GPUs waiting for network I/O and filled up ephemeral disk space.

**How V2 Fixes It:**

- **Vault Lane:** Audio downloading moved to a dedicated Serverless Function (`recording-watcher`).
- **Separation:** Workers ONLY process audio that already exists in Supabase Storage.

📖 **Bible Ref:** 2.1 The 4-Lane System.

---

### Pitfall 5: Audio URLs Expired Before Downloading

**What went wrong:**

Ringba audio URLs expire in ~24 hours. V1 often processed backlog calls too late, resulting in 404 errors.

**How V2 Fixes It:**

- **Immediate Archival:** `recording-watcher` runs every 2 minutes.
- **Stream Pipe:** Audio is streamed directly to Supabase Private Storage.
- **Constraint:** Workers are forbidden from accessing `audio_url` directly; they use `storage_path`.

---

## ⚠️ SECTION 3: WORKER FAILURES & GPU PROBLEMS

### Pitfall 6: No Job Locking → Duplicate Work

**What went wrong:**

V1 workers used simple `SELECT ... LIMIT 1` queries. Multiple workers grabbed the same job, leading to double-billing and DB locks.

**How V2 Fixes It:**

- **Atomic Locking:** `FOR UPDATE SKIP LOCKED`.
- **Constraints:** `valid_processing_state` constraint ensures audio exists before locking.

📖 **Bible Ref:** 3.1 Laws of Physics.

---

### Pitfall 7: "Zombie" Jobs (Silent Failures)

**What went wrong:**

If a V1 worker crashed (OOM), the call remained flagged as `processing` forever.

**How V2 Fixes It:**

- **Zombie Killer:** A DB Cron resets `processing` calls older than 30m.
- **Dead Letter:** Retries max 3 times, then marks as `failed`.
- **Watchdog:** Alerts Slack if backlog piles up.

---

### Pitfall 8: Cold Start Latency

**What went wrong:**

V1 Serverless workers re-downloaded 2GB AI models on every boot, adding 45s+ latency per call.

**How V2 Fixes It:**

- **Dedicated Factory:** We use persistent GPU workers.
- **VRAM Caching:** Models are loaded into VRAM once on boot. Inference starts instantly (0ms cold start).

---

## ⚠️ SECTION 4: DATABASE FAILURES

### Pitfall 9: Invalid State Transitions

**What went wrong:**

V1 allowed calls to jump states (e.g., `pending` -> `flagged`) without data, causing UI crashes.

**How V2 Fixes It:**

- **SQL Constraints:**
  - `valid_processing_state`
  - `status_valid` (Enum enforcement)
  - `retry_limit`

📖 **Bible Ref:** 4. DATABASE SPECIFICATIONS.

---

### Pitfall 10: Slow Queue Performance

**What went wrong:**

V1 used random queries to find work, leading to 5-10 sec scan times as the table grew.

**How V2 Fixes It:**

- **LIFO Index:** `CREATE INDEX idx_calls_queue ON core.calls(status, start_time_utc DESC);`.
- **Result:** Worker polling is O(1) instant.

---

## ⚠️ SECTION 5: LLM QA FAILURES

### Pitfall 11: Prompt Drift

**What went wrong:**

V1 QA prompts weren't versioned. Changing a rule rewrote history for all past calls.

**How V2 Fixes It:**

- **Versioning:** Store `qa_version` + `judge_model` on every call record.
- **Immutable Flags:** Flags are stored as JSONB snapshot, independent of current rules.

---

### Pitfall 12: LLM Token Overflow

**What went wrong:**

V1 sent the entire transcript + metadata + all rules, hitting context limits and causing hallucinations.

**How V2 Fixes It:**

- **Vertical Injection:** Only inject rules relevant to the call's vertical (e.g., ACA Rules).
- **Truncation:** Limit input to 4k tokens.
- **Strict JSON:** Force `response_format: { "type": "json_object" }`.

---

## ⚠️ SECTION 6: OBSERVABILITY FAILURES

### Pitfall 13: Silent Failures

**What went wrong:**

V1 had no alerting. If ingestion broke, we found out days later when a client complained.

**How V2 Fixes It:**

- **Watchdog:** Monitors pending queue size & age. Alerts Slack if >100 calls are stuck.
- **Logs:** All backend functions write to `core.sys_logs`.

---

## ⚠️ SECTION 7: FRONTEND FAILURES

### Pitfall 14: Poor Review UX

**What went wrong:**

V1 audio player didn't sync with the transcript timestamps. Reviewers had to manually hunt for the "bad part."

**How V2 Fixes It:**

- **Auto-Jump:** Clicking a flag card jumps the audio player to that exact timestamp.
- **Searchable Transcript:** Full text search highlights terms in the transcript view.

📖 **Bible Ref:** 7. FRONTEND SPECIFICATIONS.

---

## ✅ FINAL SUCCESS CRITERIA

V2 is working correctly if:

1. ✅ Ingest is always < 2 minutes behind real time.
2. ✅ Audio is never missing for a downloaded call.
3. ✅ Workers never double-process a single call.
4. ✅ Flags appear in the dashboard < 5 minutes after hang-up.
5. ✅ Metrics (Cost, Volume) match Ringba data exactly.

**If any of these fail → use this document to diagnose.**

