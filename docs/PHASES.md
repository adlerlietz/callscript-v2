# CallScript V2 – Build Phases & Checklist

See [ROADMAP.md](./ROADMAP.md) for detailed task breakdowns.

---

## Phase 0 – Repo & Governance (✅ Complete)

- [x] Create callscript-v2 repo (local + GitHub)
- [x] Add CLAUDE.md AI control plane
- [x] Add MASTER_BIBLE.md, RULES.md, SECURITY.md, TESTING.md
- [x] Add .github PR + Issue templates
- [x] Create base folder structure

---

## Phase 1 – Database Schema (✅ Complete)

- [x] 00_extensions.sql – pgcrypto, pg_cron, pg_net
- [x] 01_schema.sql – core schema
- [x] 02_tables.sql – campaigns, calls
- [x] 03_indexes.sql – LIFO queue index
- [x] 04_triggers.sql – updated_at, auto-tag, zombie killer
- [x] 05_cron.sql – scheduled jobs
- [x] 06_calls_enrichment.sql – additional columns

---

## Phase 2 – Edge Functions (✅ Complete)

- [x] sync-ringba-realtime – Ingest Lane (metadata sync)
- [x] recording-watcher – Vault Lane (audio download)
- [ ] analyze-qa – Judge Lane (moved to Phase 5)

---

## Phase 3 – Multi-Tenant Architecture (✅ Complete)

- [x] 13_organizations.sql – org tables
- [x] 14_add_org_id.sql – tenant columns
- [x] 15_org_indexes.sql – composite indexes
- [x] 16_rls_policies.sql – row-level security
- [x] 17_vault_functions.sql – credential management
- [x] auth-hook – JWT org injection
- [x] onboard-org – user onboarding API
- [x] Backfill existing data to default org

---

## Phase 4 – Factory Lane / GPU Workers (🚧 In Progress)

**Goal:** Transcribe audio with WhisperX + Pyannote on RunPod

- [x] workers/core/ – shared modules (db, config, logging)
- [x] workers/factory/worker.py – base structure
- [ ] RunPod provisioning (RTX 3090)
- [ ] WhisperX integration
- [ ] Pyannote diarization
- [ ] LIFO queue with atomic locking
- [ ] start_factory.sh (4x workers)
- [ ] Health monitoring integration

**Exit:** `downloaded` → `transcribed` with transcript_text populated

---

## Phase 5 – Judge Lane / QA Analysis (❌ Not Started)

**Goal:** Flag compliance violations using GPT-4o-mini

- [ ] analyze-qa Edge Function
- [ ] QA rules engine (per-vertical prompts)
- [ ] qa_flags JSONB structure
- [ ] Batch processing for efficiency
- [ ] Cost tracking (token usage)

**Exit:** `transcribed` → `flagged`|`safe` with qa_flags populated

---

## Phase 6 – Frontend Core (🚧 Partial)

**Goal:** Build main UI for reviewing flagged calls

- [x] Basic layout and routing
- [x] Dashboard page (recording coverage)
- [ ] `/flags` – Work queue table
- [ ] `/calls/[id]` – Call workspace
- [ ] Audio player with waveform
- [ ] Transcript viewer (searchable, click-to-seek)
- [ ] Flag cards with evidence
- [ ] Bulk actions (Mark Safe, Confirm Bad)
- [ ] `/settings` – Rule editor

**Exit:** Reviewers can see flagged calls and take action

---

## Phase 7 – Auth & User Management (❌ Not Started)

**Goal:** Secure multi-tenant authentication

- [ ] Enable auth-hook in Supabase Dashboard
- [ ] Login/logout pages
- [ ] Signup flow (open or invite-only)
- [ ] Onboarding wizard (org + Ringba setup)
- [ ] Role management (owner/admin/reviewer)
- [ ] Team invites

**Exit:** Users can sign up, create org, and see only their data

---

## Phase 8 – Polish & Launch (❌ Not Started)

**Goal:** Production-ready deployment

- [ ] Error handling and logging
- [ ] Loading/error states on all pages
- [ ] Query optimization
- [ ] Sentry monitoring
- [ ] Custom domain + SSL
- [ ] User documentation

**Exit:** Live in production with monitoring

---

## Current Pipeline Status

```
Ringba API
    │
    ▼
┌─────────────────┐
│ sync-ringba     │ ✅ Working
│ (Ingest Lane)   │
└────────┬────────┘
         │ status: pending
         ▼
┌─────────────────┐
│ recording-      │ ✅ Working
│ watcher (Vault) │
└────────┬────────┘
         │ status: downloaded
         ▼
┌─────────────────┐
│ GPU Worker      │ ❌ Not Working
│ (Factory Lane)  │
└────────┬────────┘
         │ status: transcribed
         ▼
┌─────────────────┐
│ analyze-qa      │ ❌ Not Working
│ (Judge Lane)    │
└────────┬────────┘
         │ status: flagged/safe
         ▼
┌─────────────────┐
│ Frontend        │ 🚧 Partial
│ (Review UI)     │
└─────────────────┘
```

---

## Next Priority

**Phase 4: Factory Lane** – Get transcription working so calls flow through the full pipeline.
