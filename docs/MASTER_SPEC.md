# 🏗️ CallScript V2 – Master Technical Specification

| **Document Meta** | **Details** |
| :--- | :--- |
| **Version** | **4.2 (The Final "Factory" Build)** |
| **Status** | **APPROVED FOR CONSTRUCTION** |
| **Objective** | Automated Pay-Per-Call QA Platform (Serverless + Dedicated Hybrid) |
| **KPIs** | <$15/day cost @ 10k calls. <5m Latency. 92% Detection. |
| **Companion Doc** | [See `docs/ENGINEERING_PITFALLS.md`](ENGINEERING_PITFALLS.md) for historical failure modes. |

---

## 1. Executive Summary

**The Mission:** Replace the legacy V1 stack with a high-volume automated QA factory. The system ingests call audio from marketing providers (Ringba), transcribes it using telephony-optimized AI, and flags compliance violations for immediate refund.

**Strategic Architecture:**

We utilize a **Hybrid Architecture** to decouple ingestion from processing:

1. **Ingest:** Serverless Edge Functions (Supabase) handle traffic spikes instantly without server maintenance.
2. **Processing:** Dedicated Bare-Metal GPUs (RunPod) provide factory-scale AI processing at flat-rate pricing.

**Project Non-Goals (Scope Containment):**

* ❌ **No Real-Time Streaming:** Post-call processing only.
* ❌ **No Multi-Tenancy:** V2 is single-tenant (Internal Tool). No complex Org/RBAC structures.
* ❌ **No Webhooks:** Pull-based architecture only.

---

## 2. System Architecture

The system operates as a **Unidirectional Data Pipeline** split into 4 distinct "Lanes."

### The 4-Lane Traffic System

| Lane | Technology | Frequency | Responsibility |
| :--- | :--- | :--- | :--- |
| **1. Ingest Lane** | Supabase Edge | 5 min | **Metadata Sync.** Pulls Ringba JSON via hardened pagination. Handles 429s. Upserts to DB. |
| **2. Vault Lane** | Supabase Edge | 2 min | **Audio Proxy.** Streams Ringba URL → Supabase Storage (Private). Validates file integrity. |
| **3. Factory Lane** | **RunPod GPU** | **Always On** | **Processing.** Persistent Python Workers (4x) poll DB → Transcribe → Diarize. |
| **4. Judge Lane** | Supabase Edge | 1 min | **QA.** Sends Transcript + Vertical Rules to GPT-4o-mini → Updates DB Flags. |

---

## 3. Core Invariants ("Laws of Physics")

*Violating these rules will cause system failure. They are non-negotiable.*

1. **LIFO is Law:** All worker queries MUST use `.order('start_time_utc', { ascending: false })`. We prioritize *now*.
2. **Audio First:** No call enters `processing` unless audio is secured in the Vault (`storage_path IS NOT NULL`).
3. **Atomic Locking:** Workers MUST use `FOR UPDATE SKIP LOCKED` to prevent duplicate processing.
4. **Hardened Pagination:** Ingest MUST use **Fixed-Step Offsets** (`offset += size`). Never trust `records.length`.
5. **Idempotency:** `ringba_call_id` is the **ONLY** unique key. Never use timestamps for deduping.
6. **Pull-Only:** We do not use webhooks. We rely on periodic `pg_cron` jobs to pull data.

---

## 4. Tech Stack Specifications

* **Frontend:** Next.js 15 (App Router) + Shadcn/UI + Vercel.
* **Database:** Supabase (Postgres 15) + `pg_cron` + `pg_net` + `pgcrypto`.
* **Backend:** Supabase Edge Functions (Deno).
* **Storage:** Supabase Storage (Private S3 buckets).
* **AI Hardware:** RunPod Secure Cloud (**1x RTX 3090** / 24GB VRAM).
* **AI Models:**
    * **Text:** `nvidia/parakeet-tdt-0.6b` (Int8 Quantized).
    * **Speakers:** `pyannote/speaker-diarization-3.1`.
* **QA Logic:** OpenAI `gpt-4o-mini` (JSON Mode).

---

## 5. Database Schema (`core`)

```sql
CREATE SCHEMA IF NOT EXISTS core;

-- 1. CAMPAIGNS (Smart Lookup)
CREATE TABLE core.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ringba_campaign_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    vertical TEXT DEFAULT 'General',
    inference_source TEXT CHECK (inference_source IN ('regex', 'manual', 'unknown')),
    is_verified BOOLEAN DEFAULT false
);

-- 2. CALLS (Master State Machine)
CREATE TABLE core.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ringba_call_id TEXT NOT NULL UNIQUE, -- Canonical Idempotency Key
    campaign_id UUID REFERENCES core.campaigns(id),
    
    start_time_utc TIMESTAMPTZ NOT NULL, -- Normalized UTC
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Metadata (Crucial for V3 Analytics)
    caller_number TEXT,
    duration_seconds INTEGER,
    revenue NUMERIC(12,4) DEFAULT 0,
    cost NUMERIC(12,4) DEFAULT 0,
    
    -- Pipeline
    audio_url TEXT,         -- Expiring Source
    storage_path TEXT,      -- Permanent Vault Path
    
    -- State: pending -> downloaded -> processing -> transcribed -> flagged/safe -> failed
    status TEXT DEFAULT 'pending', 
    retry_count INTEGER DEFAULT 0,
    processing_error TEXT,
    
    -- Artifacts
    transcript_text TEXT,
    transcript_segments JSONB, 
    processing_meta JSONB, -- { "gpu_time": 2.4s, "model": "parakeet" }
    qa_flags JSONB,
    qa_version TEXT,
    
    -- Constraints
    CONSTRAINT valid_processing CHECK (status != 'processing' OR storage_path IS NOT NULL),
    CONSTRAINT retry_limit CHECK (retry_count <= 3),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'downloaded', 'processing', 'transcribed', 'flagged', 'safe', 'failed'))
);

-- 3. INDEXES (LIFO Speed)
CREATE INDEX idx_calls_queue ON core.calls(status, start_time_utc DESC);
CREATE INDEX idx_calls_dedupe ON core.calls(ringba_call_id);
```

---

## 6. Service Logic Specifications

### 6.1 Ingest Service (Hardened)

* **Endpoint:** `POST https://api.ringba.com/v2/{ACCOUNT_ID}/calllogs`
* **Trigger:** Every 5 minutes.
* **Windowing:** Uses a 15-minute rolling window with overlap (e.g., fetch last 20 minutes) to safely handle clock drift and late-arriving data.
* **Pagination Logic:**
    * Offset += 1000 (Fixed Step).
    * Stop Immediately IF: `records < 1000`, `partialResult=true`, or `fetched >= total`.
    * Strictly re-create request body per page (Immutable).
* **Reliability:** Exponential backoff on 429/5xx errors.
* **Vertical Inference:** DB Trigger maps Campaign Name -> Vertical via Regex rules (e.g., `/ACA/` -> `'ACA'`).

### 6.2 Vault Service (Audio Proxy)

* **Logic:** Stream `audio_url` -> Supabase Storage (Private Bucket).
* **Pre-Checks (Cost Savings):**
    * If `duration < 15s` -> Mark `safe` (Skip AI).
    * If `size = 0` -> Mark `processing_error`.
* **Output:** Updates `storage_path` in DB.

### 6.3 Factory Service (AI Worker)

* **Deployment:** "Script-in-a-Box" (Python scripts on RunPod Volume). No Dockerfiles.
* **Model Loading:** Models are loaded into VRAM once at worker startup; never per-call.
* **Concurrency:** `start_factory.sh` runs 4x concurrent workers on one GPU.
* **Worker Logic:**
    1. **Poll:** `SELECT ... WHERE status='downloaded' ORDER BY start_time_utc DESC LIMIT 1`.
    2. **Lock:** `FOR UPDATE SKIP LOCKED` (Atomic).
    3. **Infer:** Parakeet (Text) + Pyannote (Speakers) -> JSON Timeline.
    4. **Save:** Update DB.

### 6.4 Judge Service (QA)

* **Logic:** `gpt-4o-mini` with `response_format: json_object`.
* **Prompt Engineering:**
    * Inject Vertical-Specific Rules only.
    * Limit input to 4k tokens (truncate middle of very long calls).
    * Store `qa_version` (e.g., `"v1.0"`) for audit trails.

---

## 7. Reliability & Recovery

| Mechanism | Frequency | Logic |
| :--- | :--- | :--- |
| **Zombie Killer** | 30m Cron | Resets `processing` jobs > 30m old. If `retry_count >= 3`, mark `failed`. |
| **Watchdog** | 1h Cron | Alerts Slack if >100 `pending` calls are >1h old. |
| **Sys Logs** | Always | All backend functions log to `core.sys_logs` (`id`, `source`, `level`, `message`). |
| **Backfill Script** | Manual | `scripts/backfill_ringba.ts` replays specific date windows using the hardened ingest logic. |

---

## 8. Frontend Specification (Next.js 15)

### 8.1 Sitemap & Functionality

| Page | Route | Key Functionality |
| :--- | :--- | :--- |
| **Login** | `/login` | Invite-only Auth. No Signup. |
| **Dashboard** | `/dashboard` | Executive View. High-level KPIs (Volume, Flag %, Savings). Traffic Chart. |
| **Inbox** | `/flags` | Work Queue. Table of `status='flagged'`. Filters (Vertical, Severity). Bulk Actions. |
| **Workspace** | `/calls/[id]` | Investigation. Waveform Player (Auto-play at flag). Searchable Transcript. QA Card. |
| **Archive** | `/calls` | History. Searchable table of all calls. CSV Export. |
| **Settings** | `/settings` | Config. Edit Rule Prompts. Map Unknown Campaigns. |

### 8.2 Resiliency Rules

* **Stable Fields:** Detail View MUST NOT reset `recording_url` during polling.
* **Timezones:** ALL UI dates displayed in User Local Time (converted from UTC).
* **Progressive Load:** Transcript loads skeleton first, then segments.

---

## 9. Project Structure

```
callscript-v2/
├── app/                        <-- Next.js 15 Frontend
│   ├── dashboard/              <-- Executive KPIs
│   ├── flags/                  <-- Work Queue (Inbox)
│   ├── calls/[id]/             <-- Workspace (Detail)
│   └── login/                  <-- Invite-only Auth
├── supabase/
│   ├── migrations/             <-- SQL Schemas
│   └── functions/              <-- Deno Edge Functions
│       ├── sync-ringba/        <-- Hardened Ingest
│       ├── recording-watcher/  <-- Audio Proxy
│       └── analyze-qa/         <-- Judge
├── runpod-worker/              <-- AI Factory
│   ├── worker.py               <-- Processor Script
│   ├── start.sh                <-- Boot/Install Script
│   └── start_factory.sh        <-- Supervisor Script
├── scripts/
│   └── backfill_ringba.ts      <-- Manual Backfill Tool
└── docs/
    ├── MASTER_SPEC.md          <-- This file
    └── ENGINEERING_PITFALLS.md <-- Lessons Learned
```

---

## 10. Credentials (Provision Day 1)

* `RINGBA_ACCOUNT_ID`, `RINGBA_API_TOKEN` (Read Access)
* `RUNPOD_API_KEY` (Deploy Access)
* `OPENAI_API_KEY` (gpt-4o-mini)
* `HF_TOKEN` (HuggingFace Read Access)
* `SUPABASE_SERVICE_ROLE_KEY` (Admin Access)

---

## 11. Execution Roadmap

* **Phase 1 (Foundation):** Init DB, Deploy Hardened Ingest, Deploy Vault.
* **Phase 2 (Factory):** Rent GPU, Upload Scripts, Scale to 4x, Deploy Judge.
* **Phase 3 (Experience):** Build UI, Auth, Work Queue, Launch.
