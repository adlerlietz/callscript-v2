# CallScript V2 – Engineering Rules (RULES.md)

These rules MUST be followed at all times. Breaking them risks corrupting the pipeline.

---

## 0. GLOBAL ENGINEERING STANDARDS

- Use structured error handling (never silent failures).
- Every public function must include a concise docstring with purpose, inputs, outputs.
- Validate preconditions before destructive or high-impact operations.
- No eval, unsafe shell calls, or injection vectors.
- No hardcoded secrets; use env vars only.
- KISS: Keep solutions simple and readable.
- YAGNI: No speculative abstractions or future-proofing.
- SOLID-lite:
  - Single Responsibility
  - Dependency Inversion: isolate external SDKs behind service layers.
- All new logic must include unit tests or integration tests.
- Documentation must stay in sync with code.

---

## 1. CALLSCRIPT V2 SYSTEM INVARIANTS

### 1.1 The 4-Lane Architecture

These MUST be preserved:

1. **Ingest Lane:**
   - Sync metadata only
   - Pagination must use fixed-step offsets
   - Idempotent (`ON CONFLICT DO NOTHING/UPDATE`)

2. **Vault Lane:**
   - Secure audio
   - `status = 'pending' → 'downloaded'` ONLY after confirming `storage_path` exists

3. **Factory Lane (GPU):**
   - Transcription + diarization
   - `status = 'downloaded' → 'processing'`

4. **Judge Lane:**
   - QA rules + flagging
   - `status = 'processing' → 'completed' | 'flagged' | 'failed'`

---

### 1.2 Queue Invariants

- **LIFO is LAW:**
  Every worker must use:

  ```sql
  ORDER BY start_time_utc DESC
  ```

- **Atomic locking:**
  Must use:

  ```sql
  FOR UPDATE SKIP LOCKED
  ```

- **Statuses must be atomic and deterministic.**

Allowed status values:

- `pending`
- `downloaded`
- `processing`
- `completed`
- `flagged`
- `failed`

---

## 2. FRONTEND (Next.js 15 + React)

- Components must be functional only.
- Use Shadcn/UI primitives for UI consistency.
- Separate logic from presentation via custom hooks.
- Prefer server state (TanStack Query or equivalent) over global state.
- No raw SQL in frontend.
- All data access flows through:
  - Supabase client (typed)
  - Edge Functions
- UI must gracefully support:
  - loading
  - error
  - empty states

---

## 3. API / EDGE FUNCTIONS (Supabase)

- TypeScript only, fully typed.
- Validate all inputs (zod recommended).
- No cross-schema writes; all project data lives in `core`.
- All pagination must be hardened (no naive totalCount).
- Ingestion MUST be idempotent and safe to rerun.
- All edge functions must:
  - handle errors explicitly
  - log context safely (no PII)

---

## 4. WORKERS (PYTHON + RUNPOD)

- Fully typed Python (use type hints, Pydantic or dataclasses).
- Clear separation of modules:
  - `db.py` (Postgres access)
  - `transcribe.py` (WhisperX / Pyannote)
  - `queue.py` (LIFO selection)
  - `main.py` (loop + orchestration)
- Use structured retries:
  - Increment `retry_count`
  - Max 3 attempts → `failed`
- Never log raw PII or entire transcripts.
- Ensure GPU operations support:
  - timeout
  - cancellation
  - batch diarization (>10 min guarded)

---

## 5. DATABASE RULES (POSTGRES)

- Use only the `core` schema.
- No `SELECT *` from `core.calls` (the table is too wide).
- All ingestion uses a UNIQUE constraint:

  ```sql
  UNIQUE(provider, external_call_id)
  ```

- Index required:

  ```sql
  CREATE INDEX ON core.calls(status, start_time_utc DESC);
  ```

- All migrations must be reversible.

---

## 6. EXTENSIBILITY RULES

- New features must not break:
  - LIFO queueing
  - Vault behavior
  - Status transitions
- Any new lane or pipeline change must be documented in:
  - @docs/MASTER_BIBLE.md

