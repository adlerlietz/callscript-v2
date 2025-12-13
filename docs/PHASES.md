# CallScript V2 – Build Phases & Checklist

This doc is a simple checklist of what we're building and in what order.

---

## Phase 0 – Repo & Governance (✅ Done)

- [x] Create callscript-v2 repo (local + GitHub)
- [x] Add CLAUDE.md AI control plane
- [x] Add MASTER_BIBLE.md, MASTER_SPEC.md, ENGINEERING_KICKOFF.md
- [x] Add RULES.md, ENGINEERING_PITFALLS.md, SECURITY.md, TESTING.md
- [x] Add .github PR + Issue templates
- [x] Create base folder structure (app/, supabase/, runpod-worker/, scripts/, docs/)

---

## Phase 1 – Supabase Schema & Migrations (✅ Done)

Goal: Have a clean `core` schema with tables, indexes, triggers, cron jobs.

- [x] 00_extensions.sql – enable pgcrypto, pg_cron, pg_net
- [x] 01_schema.sql – create core schema
- [x] 02_tables.sql – create core.campaigns and core.calls
- [x] 03_indexes.sql – create LIFO queue and helper indexes
- [x] 04_triggers.sql – updated_at triggers, auto-tag campaigns, zombie killer
- [x] 05_cron.sql – wire zombie killer into pg_cron

Exit criteria: ✅ All met
- All migrations run successfully in Supabase
- Inserting sample rows into core.calls respects constraints
- idx_calls_queue exists and supports LIFO queries

---

## Phase 2 – Edge Functions (Ingest, Vault, Judge) (✅ Done)

- [x] supabase/functions/sync-ringba-realtime/index.ts (Ingest Lane)
- [x] supabase/functions/recording-watcher/index.ts (Vault Lane)
- [ ] supabase/functions/analyze-qa/index.ts (Judge Lane - pending)

Exit: calls flow from pending → downloaded → transcribed → flagged/safe when functions are invoked.

---

## Phase 3 – Multi-Tenant Architecture (✅ Done)

Goal: Support multiple organizations with isolated data and credentials.

- [x] 12_queue_alerts.sql – Slack alerting for queue health
- [x] 13_organizations.sql – Create organizations, organization_members, organization_credentials tables
- [x] 14_add_org_id.sql – Add org_id to campaigns and calls
- [x] 15_org_indexes.sql – Create composite indexes for tenant + LIFO
- [x] 16_rls_policies.sql – Row-Level Security for tenant isolation
- [x] 17_vault_functions.sql – Credential storage/retrieval functions
- [x] supabase/functions/auth-hook/index.ts – JWT org_id injection
- [x] supabase/functions/onboard-org/index.ts – User onboarding flow
- [x] Update sync-ringba-realtime with org_id support

Exit criteria: ✅ All met
- RLS enforces tenant isolation
- Each org has isolated Ringba credentials
- Auth hook injects org_id into JWT
- Sync function tags calls with correct org_id

---

## Phase 4 – RunPod Worker (Factory Lane) (🚧 In Progress)

- [x] workers/core/ – Core database and queue modules
- [x] workers/factory/ – Transcription worker structure
- [ ] Full GPU worker integration with WhisperX/Pyannote
- [ ] workers/start_factory.sh

Exit: downloaded calls get transcribed on GPU and marked transcribed.

---

## Phase 5 – Next.js Frontend Skeleton

- [ ] app/layout.tsx
- [ ] app/page.tsx
- [ ] app/login/page.tsx
- [ ] app/dashboard/page.tsx
- [ ] app/flags/page.tsx
- [ ] app/calls/[id]/page.tsx

Exit: `npm run dev` shows all routes without runtime errors.

---

## Phase 6 – Ops Scripts & Backfill

- [ ] scripts/backfill_ringba.ts

---

## Phase 7 – Polish & Launch

- [ ] Filters, AI flags in UI, scrubber, etc.
