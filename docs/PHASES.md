# CallScript V2 – Build Phases & Checklist

This doc is a simple checklist of what we’re building and in what order.

---

## Phase 0 – Repo & Governance (✅ Done)

- [x] Create callscript-v2 repo (local + GitHub)
- [x] Add CLAUDE.md AI control plane
- [x] Add MASTER_BIBLE.md, MASTER_SPEC.md, ENGINEERING_KICKOFF.md
- [x] Add RULES.md, ENGINEERING_PITFALLS.md, SECURITY.md, TESTING.md
- [x] Add .github PR + Issue templates
- [x] Create base folder structure (app/, supabase/, runpod-worker/, scripts/, docs/)

---

## Phase 1 – Supabase Schema & Migrations (🚧 In Progress)

Goal: Have a clean `core` schema with tables, indexes, triggers, cron jobs.

- [ ] 00_extensions.sql – enable pgcrypto, pg_cron, pg_net
- [ ] 01_schema.sql – create core schema
- [ ] 02_tables.sql – create core.campaigns and core.calls
- [ ] 03_indexes.sql – create LIFO queue and helper indexes
- [ ] 04_triggers.sql – updated_at triggers, auto-tag campaigns, zombie killer
- [ ] 05_cron.sql – wire zombie killer into pg_cron

Exit criteria:
- All migrations run successfully in Supabase
- Inserting sample rows into core.calls respects constraints
- idx_calls_queue exists and supports LIFO queries

---

## Phase 2 – Edge Functions (Ingest, Vault, Judge)

- [ ] supabase/functions/sync-ringba/index.ts
- [ ] supabase/functions/recording-watcher/index.ts
- [ ] supabase/functions/analyze-qa/index.ts

Exit: calls flow from pending → downloaded → transcribed → flagged/safe when functions are invoked.

---

## Phase 3 – RunPod Worker (Factory Lane)

- [ ] runpod-worker/start.sh
- [ ] runpod-worker/worker.py
- [ ] runpod-worker/start_factory.sh

Exit: downloaded calls get transcribed on GPU and marked transcribed.

---

## Phase 4 – Next.js Frontend Skeleton

- [ ] app/layout.tsx
- [ ] app/page.tsx
- [ ] app/login/page.tsx
- [ ] app/dashboard/page.tsx
- [ ] app/flags/page.tsx
- [ ] app/calls/[id]/page.tsx

Exit: `npm run dev` shows all routes without runtime errors.

---

## Phase 5 – Ops Scripts & Backfill

- [ ] scripts/backfill_ringba.ts

---

## Phase 6 – Polish & Launch

- [ ] Filters, AI flags in UI, scrubber, etc.

