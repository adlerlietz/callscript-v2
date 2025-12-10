# 📖 CALLSCRIPT V2 – THE MASTER BIBLE

**Unified PRD, Engineering Scope, & Architecture Guide**

| **Document Meta** | **Details** |
| :--- | :--- |
| **Version** | **6.1 (Final Production Spec)** |
| **Date** | December 10, 2025 |
| **Status** | **APPROVED FOR CONSTRUCTION** |
| **Objective** | Automated Pay-Per-Call QA Platform (Serverless + Dedicated Hybrid) |
| **KPIs** | <$15/day cost @ 10k calls. <5m Latency. 92% Detection. |

---

## 1. EXECUTIVE SUMMARY

### The Mission:

Replace the legacy, high-maintenance V1 stack with a high-volume automated QA factory. The system ingests call audio from marketing providers (Ringba), transcribes it using telephony-optimized AI, and flags compliance violations for immediate refund.

### Key Performance Indicators:

| KPI | Target | How |
| :--- | :--- | :--- |
| **Cost Efficiency** | < $0.0015 per call (vs. $0.05 legacy) | Achieved via Dedicated GPU utilization. |
| **Latency** | < 5 minutes | LIFO Processing ensures new calls are flagged within 5 minutes of hang-up. |
| **Reliability** | Zero Data Loss | Via hardened ingestion logic and self-healing "Zombie Killer" redundancy. |
| **Accuracy** | > 92% detection of "Bad Calls" | Utilizing GPT-4o-mini with vertical-specific rule injection. |

### Strategic Pivot:

We operate a **Hybrid Architecture**:

1. **Ingest:** Serverless Edge Functions (Supabase) handle traffic spikes instantly.
2. **Processing:** Dedicated Bare-Metal GPUs (RunPod) provide factory-scale AI processing at flat-rate pricing.

---

## 2. SYSTEM ARCHITECTURE & DATA FLOW

### 2.1 The "4-Lane" Traffic System

We decouple the system into lanes. If one lane jams, the others keep moving.

| Lane | Technology | Frequency | Responsibility |
| :--- | :--- | :--- | :--- |
| **1. Ingest Lane** | Supabase Edge | Every 5 min | **Sync.** Fetches Metadata via Ringba `/calllogs`. Upserts to DB. Auto-tags Campaigns. |
| **2. Vault Lane** | Supabase Edge | Every 2 min | **Archive.** Streams audio from Ringba URL → Supabase Storage (Private). |
| **3. Factory Lane** | RunPod GPU | Always On | **Processing.** Persistent Python Workers (4x) poll DB → Transcribe → Diarize. |
| **4. Judge Lane** | Supabase Edge | Every 1 min | **QA.** Sends Transcript + Rules to GPT-4o-mini → Updates DB with Flags. |

---

### 2.2 Data Flow Trace (The Life of a Call)

**Example:** A call ends at 2:32 PM.

| Time | Event | Status |
| :--- | :--- | :--- |
| **2:33 PM** | Ingest Lane runs. Fetches metadata. Call appears in DB. | `pending` |
| **2:34 PM** | Vault Lane runs. Streams audio to Private Storage. | `downloaded` |
| **2:35 PM** | Factory Lane (GPU) polls DB. Locks job. | `processing` |
| **2:36 PM** | Parakeet (Text) + Pyannote (Speakers) finish. | `transcribed` |
| **2:36 PM** | Judge Lane runs. GPT-4o flags "TCPA Violation". | `flagged` |
| **2:37 PM** | Admin refreshes Dashboard. Call appears in `/flags` Inbox. | ✅ |

**Total Latency: 5 Minutes.**

---

## 3. CORE INVARIANTS & SCALABILITY

### 3.1 The "Laws of Physics" (Never Break These)

1. **LIFO is Law:** All worker queries MUST use `.order('start_time_utc', { ascending: false })`. We prioritize *now*.

2. **Audio First:** No call enters `processing` unless audio is secured in the Vault (`storage_path IS NOT NULL`).

3. **Single Ownership:** Workers MUST use atomic locking (`FOR UPDATE SKIP LOCKED`) to prevent duplicate processing.

4. **Hardened Pagination:** Ringba Sync MUST use **Fixed-Step Offsets** (Section 5.1). Never trust `totalCount`.

---

### 3.2 Scalability Model

How we handle growth without rewriting code.

| Component | Scaling Method | Capacity Limit |
| :--- | :--- | :--- |
| **Ingest & Vault** | Serverless (Supabase) | Infinite (Auto-scaling). |
| **Factory (AI)** | Dedicated GPU (RunPod) | 10k calls/day per RTX 3090 unit. |
| **Judge (QA)** | Serverless + OpenAI | Infinite (Rate-limited by budget). |
| **Database** | Postgres (Single Tenant) | ~50M rows before partitioning needed. |

---

## 4. DATABASE SPECIFICATIONS (Single-Tenant)

* **Schema:** `core`
* **Extensions:** `pgcrypto`, `pg_cron`, `pg_net`.

### 4.1 Master Schema

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

-- 2. CALLS (The Master State Machine)
CREATE TABLE core.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ringba_call_id TEXT NOT NULL UNIQUE, -- Idempotency Key
    campaign_id UUID REFERENCES core.campaigns(id),
    
    start_time_utc TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Metadata (Crucial for V3 Analytics)
    caller_number TEXT,
    duration_seconds INTEGER,
    revenue NUMERIC(12,4) DEFAULT 0,
    
    -- Audio Pipeline
    audio_url TEXT,         -- Expiring Source Link
    storage_path TEXT,      -- Permanent Vault Path
    
    -- State Workflow
    status TEXT DEFAULT 'pending', 
    retry_count INTEGER DEFAULT 0,
    processing_error TEXT,
    
    -- AI Artifacts
    transcript_text TEXT,
    transcript_segments JSONB, -- [{speaker, start, end, text}]
    
    -- QA Results
    qa_flags JSONB,
    qa_version TEXT,
    judge_model TEXT,
    
    -- Constraint 1: Logic Safety
    CONSTRAINT valid_processing_state CHECK (status != 'processing' OR storage_path IS NOT NULL),
    
    -- Constraint 2: State Enum Enforcement
    CONSTRAINT status_valid CHECK (status IN ('pending', 'downloaded', 'processing', 'transcribed', 'flagged', 'safe', 'failed')),

    -- Constraint 3: Retry Limit
    CONSTRAINT retry_limit CHECK (retry_count <= 3)
);

-- 3. INDEXES (LIFO Speed)
CREATE INDEX idx_calls_queue ON core.calls(status, start_time_utc DESC);
```

---

### 4.2 Automation Triggers

* **Auto-Tagging:** DB Trigger on `INSERT campaigns` checks Regex (`/ACA/` -> `'ACA'`).
* **Zombie Killer:** DB Cron (Every 30m) resets calls stuck in `processing`.

---

## 5. SERVICE LOGIC (The "How")

### 5.1 Ingest Lane (Hardened)

* **Tech:** Supabase Edge Function.
* **Target:** Ringba API (`/calllogs` endpoint) over a 15-minute rolling window.
* **Logic:**
    1. Offset increments by `PAGE_SIZE` (1000). Never by record count.
    2. Terminate immediately if `records < 1000`, `partialResult=true`, or `fetched >= total`.
    3. Immutable request bodies per page.

---

### 5.2 Factory Lane (The Worker)

* **Tech:** Python Script on RunPod Volume ("Script-in-a-Box").
* **Boot:** `start.sh` installs `nemo_toolkit` & `pyannote`.
* **Worker Logic:**
    1. **Poll:** `SELECT * FROM calls WHERE status='downloaded' ORDER BY start_time_utc DESC LIMIT 1`.
    2. **Lock:** Atomic Update (`FOR UPDATE SKIP LOCKED`).
    3. **Infer:** Parakeet 0.6B (Text) + Pyannote 3.1 (Speakers).
    4. **Save:** Update DB.
* **Concurrency:** `start_factory.sh` launches 4 concurrent workers.

---

## 6. RELIABILITY & FAILURE MODES

| Failure Scenario | System Behavior | Recovery Action |
| :--- | :--- | :--- |
| **Ringba API Outage** | Ingest fails gracefully. | Retries automatically on next 5-min cron. |
| **Worker Crash (OOM)** | Job stuck in `processing`. | Zombie Killer resets to `downloaded` after 30m. |
| **Audio Link 404** | Vault logs error. | Mark `processing_error`. Requires manual "Proxy Fallback" script. |
| **Factory Offline** | Queue piles up (`pending`). | Watchdog alerts Slack if >100 calls pending >1h. |
| **Dead Letter** | Job fails 3 times. | Mark `status='failed'`. Admin investigation required. |

---

## 7. FRONTEND SPECIFICATIONS

* **Stack:** Next.js 15 + Shadcn/UI.
* **Auth:** Invite-Only (Single Tenant).

### 7.1 Sitemap

| Route | Page | Functionality |
| :--- | :--- | :--- |
| `/login` | **Gatekeeper** | No Signup. |
| `/dashboard` | **Executive View** | High-level KPIs (Volume, Flag %, Savings). Traffic Health Chart. |
| `/flags` | **Work Queue (Inbox)** | Table of `status='flagged'`. Columns: Severity Badge, Vertical, Flag Snippet. Actions: Bulk Select -> "Mark Safe" / "Confirm Bad". |
| `/calls/[id]` | **Workspace** | Audio Player (Waveform). Auto-plays at flag timestamp. Transcript (Searchable). QA Card (List of flags). |
| `/settings` | **Config** | Rule Editor (Edit Prompts) & Campaign Mapper. |

---

## 8. CREDENTIALS & INTEGRATIONS

**Provision these immediately.**

| Service | Keys | Access Level |
| :--- | :--- | :--- |
| **Ringba** | `RINGBA_ACCOUNT_ID`, `RINGBA_API_TOKEN` | Read Access |
| **RunPod** | `RUNPOD_API_KEY` | Deploy Access |
| **OpenAI** | `OPENAI_API_KEY` | gpt-4o-mini |
| **HuggingFace** | `HF_TOKEN` | Read Access for Pyannote |
| **Supabase** | `SERVICE_ROLE_KEY` | Admin Access |

---

## 9. V3 ROADMAP (Future Enhancements)

> ⚠️ The following features are **Planned V3 Upgrades** and are **NOT in V2 Scope**.

* **AI Assistant:** Natural-language Q&A ("Show me all calls where the agent was rude").
* **Revenue/Profit Analytics:** Deep dive charts (RPC, Revenue vs Cost) by Campaign/Publisher.
* **Semantic Search:** Embedding-based search to find calls by topic/theme.
* **Campaign Intelligence:** Automated vertical mapping and conversion proxy metrics.
* **Auto-Refund:** API integration to push "Confirmed Bad" calls back to Ringba for automatic credit.
* **Multi-Tenancy:** Role-Based Access Control (RBAC) and Organization schemas.

---

## 10. EXECUTION ROADMAP (3 Weeks)

### Week 1: The Foundation

- [ ] Init Supabase & Schema.
- [ ] Deploy Hardened `sync-ringba`.
- [ ] Deploy `recording-watcher`.
- [ ] Setup Zombie Killer & Watchdog.

### Week 2: The Factory

- [ ] Provision RunPod 3090.
- [ ] Upload Scripts (`worker.py`).
- [ ] Scale to 4x Workers.
- [ ] Deploy `analyze-qa` Judge.

### Week 3: The Experience

- [ ] Next.js Init & Auth.
- [ ] Build `/flags` Queue.
- [ ] Build `/calls/[id]` Workspace.
- [ ] Launch.

---

## This Document is Final.

It contains the architecture, the code standards, the reliability patches, and the deployment strategy.

**Status: ✅ READY FOR BUILD.**

