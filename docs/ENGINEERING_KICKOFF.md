# 🚀 Engineering Kickoff: CallScript V2

**Objective:** Build the "Factory."

**Sprint:** 3 Weeks (Dec 10 - Dec 31)

**Stack:** Supabase (Serverless Ingest) + RunPod (Dedicated AI).

---

## 🎯 The Mission

We are replacing the fragile Docker stack with a system that can handle **10,000 calls/day** for **<$15/day**.

Our latency target is **<5 minutes** from hang-up to flag.

---

## 📜 Mandatory Reading (Before You Code)

1. **[MASTER_SPEC.md](MASTER_SPEC.md):** The architectural bible.
2. **[ENGINEERING_PITFALLS.md](ENGINEERING_PITFALLS.md):** The "Post-Mortem" of V1. Read this so you don't repeat the Ringba pagination bugs.

---

## 👥 Roles & Owners

| Role | Responsibility |
| :--- | :--- |
| **Adler (Product/Arch)** | Scope approval, QA of "Flags" dashboard, V3 Roadmap. |
| **Lead Backend** | Supabase setup, Ringba Sync (Hardened), Audio Vault, Python Workers. |
| **Lead Frontend** | Next.js setup, Inbox UI, Audio Player sync, Auth. |

---

## 📅 The 3-Week Sprint

### Week 1: The Foundation (Data Integrity)

*Goal: We trust the data in the database.*

* [ ] **Day 1:** Init Supabase Project + Run `02_SCHEMA.sql`.
* [ ] **Day 2:** Deploy `sync-ringba` Edge Function (Fixed-step pagination is mandatory).
* [ ] **Day 3:** Deploy `recording-watcher` (Vault). Audio must stream to private buckets.
* [ ] **Day 4:** Build `scripts/backfill_ringba.ts` and verify data against Ringba dashboard.
* [ ] **Day 5:** Setup `pg_cron` (Zombie Killer + Watchdog).

### Week 2: The Factory (Intelligence)

*Goal: We turn audio into structured data.*

* [ ] **Day 6:** Rent RunPod RTX 3090. Configure Network Volume.
* [ ] **Day 7:** Upload `worker.py` and `start.sh`. Achieve 1 successful transcription.
* [ ] **Day 8:** Scale to 4x workers. Stress test for OOM crashes.
* [ ] **Day 9:** Deploy `analyze-qa` (GPT-4o Judge). Verify JSON output.
* [ ] **Day 10:** End-to-End Test: Ingest 1,000 calls -> Verify Flags.

### Week 3: The Experience (User Interface)

*Goal: We enable the workflow.*

* [ ] **Day 11:** Init Next.js 15 + Shadcn/UI. Setup Auth.
* [ ] **Day 12:** Build `/flags` (Inbox). Focus on density and speed.
* [ ] **Day 13:** Build `/calls/[id]` (Workspace). Audio/Transcript sync.
* [ ] **Day 14:** Build `/dashboard` (KPIs).
* [ ] **Day 15:** Production Launch & Handoff.

---

## ✅ Definition of Done (DoD)

A feature is **NOT** done until:

1. **LIFO Checked:** All queries order by `start_time_utc DESC`.
2. **Logs Verified:** Backend writes to `core.sys_logs`.
3. **Resilient:** UI handles missing audio/transcripts gracefully.
4. **No Docker:** AI logic relies only on the Python script, not a container build.

